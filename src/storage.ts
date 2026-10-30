import type { PlannerRecord, PlannerStore, RecordKind, RecordOf, StoreChange } from './model';
import { validateRecord } from './domain';
import {validateTaskLinks} from './task-planning';
import type {Task} from './model';
import {rememberTask,taskRevisions,sameTask,extendsTask,canonicalJSON} from './task-revisions';
import {eventRevisions,rememberEvent,eventKey,eventDescends} from './event-revisions';

/** Implemented by the host's mobile-compatible Vault API. list is recursive. */
export interface FileIO {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
  /** Exclusive creation: false means another file already occupies this path. */
  create?(path: string, text: string): Promise<boolean>;
  /** Host-level compare-and-swap; must throw without writing if source differs. */
  replace?(path: string, expectedText: string, newText: string): Promise<void>;
}
export interface StorageIssue { path: string; id?: string; message: string }

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function safeId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,239}$/.test(id) || id.includes('..')) throw new Error('Недопустимый ID записи.');
}

/** No index is authoritative: loading always validates the individual source files. */
export class RecordStore implements PlannerStore {
  private records = new Map<string, PlannerRecord>();
  private sources = new Map<string, string>();
  private problems: StorageIssue[] = [];
  private listeners = new Set<(change?:StoreChange) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private loaded = false;

  constructor(private readonly io: FileIO, readonly root = 'Planner/Data') {}
  get ready(): boolean { return this.loaded; }
  get issues(): StorageIssue[] { return this.problems.map(issue => ({ ...issue })); }
  all<K extends RecordKind>(kind: K): RecordOf<K>[] {
    return [...this.records.values()].filter(record => record.kind === kind).map(clone) as RecordOf<K>[];
  }
  get(id: string): PlannerRecord | undefined { const record = this.records.get(id); return record ? clone(record) : undefined; }
  subscribe(listener: (change?:StoreChange) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async assertCurrent(record:PlannerRecord){if(!this.loaded||this.problems.some(p=>p.id===record.id)||this.records.get(record.id)?.version!==record.version||await this.io.read(this.path(record.id))!==this.sources.get(record.id))throw new Error('Локальная запись изменилась или конфликтует с облачной копией. Обновите данные; отправка остановлена.');}
  private notify(change?:StoreChange): void {
    // A view's exception cannot turn a verified disk save into a reported failure.
    for (const listener of this.listeners) { try { listener(change); } catch { /* host view owns its error */ } }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private path(id: string): string { safeId(id); return `${this.root}/records/${id}.json`; }
  private parse(text: string, id: string): PlannerRecord {
    const record: unknown = JSON.parse(text);
    validateRecord(record);
    if (record.id !== id || record.version < 1) throw new Error('ID/версия записи не соответствуют файлу.');
    return record;
  }
  load(): Promise<void> { return this.reload(); }
  reload(): Promise<void> {
    return this.serial(async () => {
      // A failed directory scan cannot leave writes enabled against a partial index.
      this.loaded = false;
      const paths = await this.io.list(`${this.root}/records`);
      const records = new Map<string, PlannerRecord>();
      const sources = new Map<string, string>();
      const problems: StorageIssue[] = [];
      for (const path of paths.sort()) {
        if (!path.startsWith(`${this.root}/records/`) || !path.endsWith('.json')) continue;
        const id = path.slice(`${this.root}/records/`.length, -5);
        try {
          safeId(id);
          const raw = await this.io.read(path);
          if (raw === null) throw new Error('Файл исчез во время чтения; выполните повторную загрузку.');
          sources.set(id, raw);
          records.set(id, this.parse(raw, id));
        } catch (error) {
          problems.push({ path, id, message: message(error) });
        }
      }
      const revisions=await taskRevisions(this.io,this.root);
      const eventHistory=await eventRevisions(this.io,this.root);
      for(const [id,record]of records){if(record.kind!=='event')continue;const key=await eventKey(record),cached=this.records.get(id);let known=[...eventHistory.values()].filter(r=>r.record.id===id);if(!known.length){if(cached?.kind==='event'&&cached.version>=record.version&&canonicalJSON(cached)!==canonicalJSON(record)){await rememberEvent(this.io,this.root,cached);eventHistory.set(await eventKey(cached),{record:cached,parents:[]});known=[{record:cached,parents:[]}];}else continue;}
        if(cached?.kind==='event'&&!known.some(r=>canonicalJSON(r.record)===canonicalJSON(cached))){await rememberEvent(this.io,this.root,cached);known=[...known,{record:cached,parents:[]}];eventHistory.set(await eventKey(cached),{record:cached,parents:[]});}
        const conflicting=[...eventHistory].filter(([knownKey,r])=>r.record.id===id&&!eventDescends(eventHistory,key,knownKey)).map(([,r])=>r);
        if(conflicting.length){if(!this.problems.some(p=>p.id===id)||this.sources.get(id)!==sources.get(id)){for(const r of new Map([record,...conflicting.map(r=>r.record)].map(r=>[canonicalJSON(r),r])).values())await this.preserve(id,JSON.stringify(r),'backups',r.version);}
          const representative=known.reduce((best,r)=>r.record.version>best.version?r.record:best,cached?.kind==='event'?cached:record);records.set(id,clone(representative));problems.push({path:this.path(id),id,message:'Конфликт облачных копий события: причинная версия не подтверждена. Все копии сохранены; требуется явное восстановление.'});}
      }
      for(const [id,record] of records){if(record.kind!=='task')continue;
        const known=[...(revisions.get(id)??[])];const cached=this.records.get(id);if(cached?.kind==='task')known.push({record:cached,recovered:false});
        const restored=known.filter(v=>v.recovered&&(sameTask(v.record,record)||extendsTask(record,v.record))).sort((a,b)=>a.record.version-b.record.version).at(-1);
        const incompatible=known.filter(v=>!sameTask(record,v.record)&&!extendsTask(record,v.record)&&!(restored&&restored.record.version>v.record.version));
        if(incompatible.length){
          if(!(revisions.get(id)??[]).some(v=>sameTask(v.record,record)))await rememberTask(this.io,this.root,record);
          if(cached?.kind==='task'&&!(revisions.get(id)??[]).some(v=>sameTask(v.record,cached)))await rememberTask(this.io,this.root,cached);
          if(!this.problems.some(p=>p.id===id)||this.sources.get(id)!==sources.get(id)){const copies=new Map([record,...incompatible.map(v=>v.record)].map(t=>[canonicalJSON(t),t]));for(const task of copies.values())await this.preserve(id,JSON.stringify(task),'backups',task.version);}
          const newest=known.reduce((best,v)=>v.record.version>best.version?v.record:best,cached?.kind==='task'?cached:record);records.set(id,clone(newest));
          problems.push({path:this.path(id),id,message:'Конфликт облачных копий задачи: старая или разветвлённая история. Оба снимка сохранены; требуется явное восстановление. Обмен и запись заблокированы.'});
        }
      }
      const tasks=[...records.values()].filter((r):r is Task=>r.kind==='task');for(const task of tasks)try{validateTaskLinks(task,tasks);}catch(error){problems.push({path:this.path(task.id),id:task.id,message:message(error)});}
      const changes:StoreChange['records'][number][]=[];
      for(const id of new Set([...this.sources.keys(),...sources.keys()]))if(this.sources.get(id)!==sources.get(id)){
        const record=records.get(id)??this.records.get(id),previous=this.records.get(id);if(record)changes.push({id,kind:record.kind});
        if(previous&&record&&previous.kind!==record.kind)changes.push({id,kind:previous.kind});
      }
      const issuesChanged=JSON.stringify(this.problems)!==JSON.stringify(problems);
      this.records = records;
      this.sources = sources;
      this.problems = problems;
      this.loaded = true;
      if(changes.length||issuesChanged)this.notify({records:changes,issuesChanged});
    });
  }
  save<T extends PlannerRecord>(record: T, expectedVersion: number): Promise<T> {
    // Capture immediately; a caller may edit its form while this save waits.
    const input = clone(record);
    return this.serial(async () => {
      if (!this.loaded) throw new Error('Хранилище не загружено. Повторите загрузку перед сохранением.');
      const path = this.path(input.id);
      if (this.problems.some(issue => issue.id === input.id)) throw new Error('Запись повреждена или недоступна. Сначала восстановите её явно.');
      const previous = this.records.get(input.id);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0 || (previous?.version ?? 0) !== expectedVersion || input.version !== expectedVersion) {
        throw new Error('Конфликт версий. Перезагрузите запись и повторите изменение.');
      }
      const updated = { ...input, version: expectedVersion + 1, updatedAt: new Date().toISOString() };
      // An ordinary form cannot silently strip recurrence by downgrading the format.
      if (previous?.schemaVersion === 2 && input.schemaVersion === 1) throw new Error('Понижение схемы допустимо только через явное восстановление копии.');
      validateRecord(updated);
      const dependencies=updated.kind==='task'?validateTaskLinks(updated,this.all('task')):[];
      if (previous && previous.kind !== updated.kind) throw new Error('Тип существующей записи нельзя изменить.');
      const original = this.sources.get(input.id) ?? null;
      if (await this.io.read(path) !== original) throw new Error('Файл изменён вне этого окна. Перезагрузите данные; изменение не сохранено.');
      await this.io.mkdir(`${this.root}/records`);
      if (previous && original !== null) await this.preserve(input.id, original, 'backups', previous.version);
      // The backup may take time; check the source again immediately before writing.
      if (await this.io.read(path) !== original) throw new Error('Файл изменён во время подготовки сохранения. Перезагрузите данные.');
      for(const id of dependencies)if(await this.io.read(this.path(id))!==this.sources.get(id))throw new Error('Связанная задача изменилась. Перезагрузите планы и повторите действие.');
      const raw = `${JSON.stringify(updated, null, 2)}\n`;
      try {
        if (original === null && this.io.create) {
          if (!await this.io.create(path, raw)) throw new Error('Файл уже создан другим действием. Перезагрузите данные.');
        } else if (original !== null && this.io.replace) await this.io.replace(path, original, raw);
        else await this.io.write(path, raw);
        const verified = await this.io.read(path);
        if (verified !== raw) throw new Error('Проверка сохранённого файла не пройдена.');
        this.parse(verified, input.id);
        if(updated.kind==='task')await rememberTask(this.io,this.root,updated);
        if(updated.kind==='event'){if(previous?.kind==='event')await rememberEvent(this.io,this.root,previous);await rememberEvent(this.io,this.root,updated,previous?.kind==='event'?[previous]:[]);}
      } catch (error) {
        // A write can fail after partially modifying the source; do not retry blindly.
        this.problems = this.problems.filter(issue => issue.id !== input.id);
        this.problems.push({ path, id: input.id, message: `Сохранение не подтверждено: ${message(error)}` });
        this.notify();
        throw new Error(`Не удалось подтвердить сохранение. Перезагрузите данные или восстановите копию. ${message(error)}`);
      }
      this.records.set(input.id, clone(updated));
      this.sources.set(input.id, raw);
      this.notify({records:[{id:input.id,kind:updated.kind}],issuesChanged:false});
      return clone<T>(updated);
    });
  }
  private async preserve(id: string, raw: string, folder: 'backups' | 'recovery-originals', version: number): Promise<string> {
    const dir = `${this.root}/${folder}/${id}`;
    await this.io.mkdir(dir);
    let path: string;
    for (let attempts = 0; ; attempts++) {
      if (attempts >= 32) throw new Error('Не удалось создать уникальную резервную копию; исходный файл не изменён.');
      path = `${dir}/v${version}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`;
      if (await this.io.read(path) !== null) continue;
      if (this.io.create) { if (!await this.io.create(path, raw)) continue; }
      else await this.io.write(path, raw);
      break;
    }
    if (await this.io.read(path) !== raw) throw new Error('Резервная копия не прошла проверку; исходный файл не изменён.');
    if (folder === 'backups') this.parse(raw, id);
    return path;
  }
  async backups(id: string): Promise<string[]> {
    safeId(id);
    const prefix = `${this.root}/backups/${id}/`;
    return (await this.io.list(prefix.slice(0, -1))).filter(path => path.startsWith(prefix) && path.endsWith('.json')).sort().reverse();
  }
  /** Explicit restore. The damaged/current original is preserved before replacement. */
  recover(id: string, backupPath: string): Promise<void> {
    return this.serial(async () => {
      if (!this.loaded) throw new Error('Сначала загрузите хранилище.');
      const path = this.path(id);
      const prefix = `${this.root}/backups/${id}/`;
      if (!backupPath.startsWith(prefix) || backupPath.slice(prefix.length).includes('/') || backupPath.includes('..') || !backupPath.endsWith('.json')) {
        throw new Error('Копия не принадлежит этой записи.');
      }
      const raw = await this.io.read(backupPath);
      if (raw === null) throw new Error('Резервная копия не найдена.');
      const backup = this.parse(raw, id);
      let highestBackupVersion = backup.version;
      for (const candidate of await this.backups(id)) {
        const candidateRaw = await this.io.read(candidate);
        if (candidateRaw === null) continue;
        try { highestBackupVersion = Math.max(highestBackupVersion, this.parse(candidateRaw, id).version); }
        catch { /* An unrelated damaged backup is never used as a recovery source. */ }
      }
      const original = await this.io.read(path);
      if (original !== null) await this.preserve(id, original, 'recovery-originals', this.records.get(id)?.version ?? 0);
      if (await this.io.read(path) !== original) throw new Error('Исходный файл изменился во время восстановления.');
      await this.io.mkdir(`${this.root}/records`);
      // A damaged source may have been the revision immediately after its backup.
      // Skip that revision too, so an old form cannot mistake restoration for it.
      const restored = { ...backup, version: Math.max(highestBackupVersion + 2, (this.records.get(id)?.version ?? 0) + 1), updatedAt: new Date().toISOString() };
      validateRecord(restored);
      if(restored.kind==='task')validateTaskLinks(restored,this.all('task'));
      const restoredRaw = `${JSON.stringify(restored, null, 2)}\n`;
      try {
        if (original === null && this.io.create) {
          if (!await this.io.create(path, restoredRaw)) throw new Error('Файл уже создан другим действием.');
        } else if (original !== null && this.io.replace) await this.io.replace(path, original, restoredRaw);
        else await this.io.write(path, restoredRaw);
        if (await this.io.read(path) !== restoredRaw) throw new Error('Проверка восстановления не пройдена.');
        if(restored.kind==='task')await rememberTask(this.io,this.root,restored,true);
        if(restored.kind==='event'){await rememberEvent(this.io,this.root,backup as typeof restored);const versions=[...await eventRevisions(this.io,this.root)].map(([,r])=>r.record).filter(r=>r.id===id);await rememberEvent(this.io,this.root,restored,versions);}
      } catch (error) {
        this.problems = this.problems.filter(issue => issue.id !== id);
        this.problems.push({ path, id, message: `Восстановление не подтверждено: ${message(error)}` });
        this.notify();
        throw error;
      }
      this.records.set(id, restored);
      this.sources.set(id, restoredRaw);
      this.problems = this.problems.filter(issue => issue.id !== id);
      this.notify();
    });
  }
}
