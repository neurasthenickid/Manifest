import {defaultAreas,enabledAreas,areaNoteFile} from './areas';
import { type LocalDate, type Period, type PeriodType } from './model';
import { isLocalDate, period, periodFromKey, formatDate } from './periods';
import type { FileIO } from './storage';
import { widgetBlocks, type WidgetModule } from './ui/modules';
import type { PlannerSettings } from './settings';

const PERIOD_TYPES: PeriodType[] = ['day', 'week', 'month', 'quarter', 'year'];
const FOLDERS: Record<PeriodType, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' };
const TITLES: Record<PeriodType, string> = { day: 'День', week: 'Неделя', month: 'Месяц', quarter: 'Квартал', year: 'Год' };

function scalar(raw: string): string {
  const value = raw.trim().replace(/\s+#.*$/, '').trim();
  if (value.startsWith('"')) { const parsed: unknown = JSON.parse(value); if (typeof parsed !== 'string') throw new Error('Ожидается строка metadata.'); return parsed; }
  if (value.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(value)) throw new Error('Некорректные кавычки metadata.');
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}
function metadata(markdown: string): Map<string, string> {
  const text = markdown.replace(/^\uFEFF/, '');
  const data = new Map<string, string>();
  if (!/^---\r?\n/.test(text)) return data;
  const end = text.slice(text.indexOf('\n') + 1).search(/^---\s*$/m);
  const content = text.slice(text.indexOf('\n') + 1);
  if (end < 0) throw new Error('Не закрыт блок metadata в начале заметки.');
  for (const line of content.slice(0, end).split(/\r?\n/)) {
    const match = line.match(/^(life-planner-type|life-planner-date)\s*:\s*(.*)$/);
    if (match) {
      if (data.has(match[1])) throw new Error(`Повторяющееся поле ${match[1]}.`);
      data.set(match[1], scalar(match[2]));
    }
  }
  return data;
}

/** Metadata is authoritative, including errors. Never substitutes the system date. */
export function resolveNoteContext(path: string, markdown: string): Period {
  const data = metadata(markdown);
  if (data.size) {
    const type = data.get('life-planner-type');
    const date = data.get('life-planner-date');
    if (!PERIOD_TYPES.includes(type as PeriodType) || !isLocalDate(date)) {
      throw new Error('Нужны корректные life-planner-type и life-planner-date (YYYY-MM-DD) в metadata заметки.');
    }
    return period(type as PeriodType, date);
  }
  const filename = path.split('/').at(-1)?.replace(/\.md$/i, '') ?? '';
  const type: PeriodType | undefined = /^\d{2}([.-])\d{2}\1\d{4}$/.test(filename) ? 'day'
    : /^\d{4}-W\d{2}$/.test(filename) ? 'week'
      : /^\d{2}-\d{4}$/.test(filename) ? 'month'
        : /^\d{4}-Q[1-4]$/.test(filename) ? 'quarter'
          : /^\d{4}$/.test(filename) ? 'year' : undefined;
  if (!type) throw new Error('Не удалось определить период. Добавьте metadata life-planner-type и life-planner-date.');
  return periodFromKey(type, filename);
}

/** Keep a legacy folder's naming convention so core Daily Notes never creates a second day. */
export async function dailyFilenameFormat(io:FileIO,folder:string):Promise<'DD-MM-YYYY'|'DD.MM.YYYY'>{
  let legacy=false,dotted=false;
  for(const path of await io.list(folder)){
    if(!path.startsWith(folder+'/')||path.slice(folder.length+1).includes('/'))continue;
    const match=/^(\d{2})([.-])(\d{2})\2(\d{4})\.md$/.exec(path.slice(folder.length+1));
    if(!match)continue;
    const text=await io.read(path);if(text===null)continue;
    try{if(resolveNoteContext(path,text).type!=='day')continue;}catch{continue;}
    if(match[2]==='-')legacy=true;else dotted=true;
  }
  if(legacy&&dotted)throw new Error('В папке дневных заметок смешаны имена с точками и дефисами. Сначала выберите единый формат имён; существующие заметки не изменены.');
  return legacy?'DD-MM-YYYY':'DD.MM.YYYY';
}

/** Core Daily Notes replaces formatted date variables; planner templates use ISO {{date}}. */
export function dailyNotesTemplate():string {return defaultTemplate('day').replace('{{date}}','{{date:YYYY-MM-DD}}').replace('{{related_links}}','');}
function legacyTemplate(type: PeriodType, layout?:WidgetModule[]): string {
  const prompt: Record<PeriodType, string> = {
    day: '',
    week: '## Фокус недели\n\n\n## Итоги недели\n\n\n',
    month: '## Намерения месяца\n\n\n## Итоги месяца\n\n\n',
    quarter: '## Направления квартала\n\n\n## Итоги квартала\n\n\n',
    year: '## Образ года\n\n\n## Итоги года\n\n\n',
  };
  return `---\nlife-planner-type: ${type}\nlife-planner-date: {{date}}\nlife-planner-template-version: 6\n---\n\n${managedWidgets(type,layout)}

${type==='day'?'## Свободные записи\n\n':`{{related_links}}\n\n${prompt[type]}## Свободные записи\n\n`}`;
}

export function defaultTemplate(type:PeriodType,layout?:WidgetModule[]):string {
  return `---\nlife-planner-type: ${type}\nlife-planner-date: {{date}}\nlife-planner-template-version: 7\n---\n\n${managedWidgets(type,layout)}\n\n## Свободные записи\n\n`;
}

/** Only exact empty stock headings outside fenced code; every other byte survives. */
export function simplifyStockSections(text:string,p:Period,relatedLine:string):string {
  const frontmatter=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  if(!frontmatter||!/^life-planner-template-version: 6\r?$/m.test(frontmatter)||text.split(WIDGET_START).length!==2||text.split(WIDGET_END).length!==2)return text;
  const stock:Record<PeriodType,string[]>={day:[],week:['Фокус недели','Итоги недели'],month:['Намерения месяца','Итоги месяца'],quarter:['Направления квартала','Итоги квартала'],year:['Образ года','Итоги года']};
  const lines=text.match(/[^\n]*\n|[^\n]+$/g)??[],removals:{start:number;end:number}[]=[],headings:{start:number;end:number;title:string}[]=[];let offset=0,fence='';
  for(const line of lines){const bare=line.replace(/\r?\n$/,'');const code=/^ {0,3}(`{3,}|~{3,})/.exec(bare);if(code){if(!fence)fence=code[1];else if(code[1][0]===fence[0]&&code[1].length>=fence.length)fence='';}else if(!fence){const h=/^(#{1,6}) (.+)$/.exec(bare);if(h&&h[1].length<=2)headings.push({start:offset,end:offset+line.length,title:h[1]==='##'?h[2]:''});if(bare===relatedLine&&!text.slice(text.indexOf(WIDGET_END)+WIDGET_END.length,offset).trim())removals.push({start:offset,end:offset+line.length});}offset+=line.length;}
  for(let i=0;i<headings.length;i++){const h=headings[i],end=headings[i+1]?.start??text.length;if(stock[p.type].includes(h.title)&&headings.filter(other=>other.title===h.title).length===1&&!text.slice(h.end,end).trim())removals.push({start:h.start,end});}
  let result=text;for(const r of removals.sort((a,b)=>b.start-a.start))result=result.slice(0,r.start)+result.slice(r.end);return result;
}

/** Creates documents only in explicit navigation actions, never during widget rendering. */
export class NotesService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly io: FileIO, readonly root = 'Planner',private settings?:()=>PlannerSettings) {}
  private areas(){return enabledAreas(this.settings?.().areas??defaultAreas());}
  async areaNote(id:string){const area=(this.settings?.().areas??defaultAreas()).find(a=>a.id===id);if(!area)throw new Error('Сфера не найдена.');const path=`${this.root}/Areas/${areaNoteFile(area)}`;return this.serial(async()=>{await this.createIfAbsent(path,`---\nlife-planner-area-id: ${area.id}\n---\n\n# ${area.title}\n\n## Долгосрочные планы\n\n- \n`);return path;});}
  private folder(type:PeriodType){return this.settings?.().folders[type]??FOLDERS[type];}
  isTemplate(path:string){return path.startsWith(this.root+'/Templates/');}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work); this.queue = result.catch(() => undefined); return result;
  }
  private async createIfAbsent(path: string, text: string): Promise<boolean> {
    if (await this.io.read(path) !== null) return false;
    await this.io.mkdir(path.slice(0, path.lastIndexOf('/')));
    if (this.io.create) { if (!await this.io.create(path, text)) return false; }
    else {
      if (await this.io.read(path) !== null) return false;
      await this.io.write(path, text);
    }
    if (await this.io.read(path) !== text) throw new Error(`Создание заметки не подтверждено: ${path}`);
    return true;
  }
  private async foundation(): Promise<void> {
    await this.createIfAbsent(`${this.root}/Manifest.md`, '# Манифест\n\n## Мои принципы\n\n- \n\n## Мои чек-листы\n\n- [ ] \n\n## Долгосрочные планы\n\n' + this.areas().map(area => `- [[${this.root}/Areas/${areaNoteFile(area).replace(/\.md$/,'')}|${area.title}]]`).join('\n') + '\n');
    for (const area of this.areas()) await this.createIfAbsent(`${this.root}/Areas/${areaNoteFile(area)}`, `---\nlife-planner-area-id: ${area.id}\n---\n\n# ${area.title}\n\n## Желаемый образ\n\n\n## Долгосрочные планы\n\n- \n\n## Ближайшие шаги\n\n- \n\n[[${this.root}/Manifest|Манифест]]\n`);
    for (const type of PERIOD_TYPES) await this.createIfAbsent(`${this.root}/Templates/${FOLDERS[type]}.md`, defaultTemplate(type,this.settings?.().layouts[type]));
    await this.createIfAbsent(`${this.root}/Templates/Obsidian Daily Notes.md`,dailyNotesTemplate());
  }
  ensureFoundation(): Promise<void> { return this.serial(() => this.foundation()); }
  simplifyStandardNotes():Promise<{updated:number;skipped:number}>{return this.serial(async()=>{
    let updated=0,skipped=0;
    for(const path of await this.io.list('')){
      if(!path.endsWith('.md')||path.startsWith(this.root+'/Data/'))continue;
      const text=await this.io.read(path);if(text===null)continue;let next=text;
      if(this.isTemplate(path)){
        const type=PERIOD_TYPES.find(t=>path===`${this.root}/Templates/${FOLDERS[t]}.md`&&text===legacyTemplate(t));
        if(type)next=defaultTemplate(type);else if(path===this.root+'/Templates/Obsidian Daily Notes.md'&&text===legacyTemplate('day').replace('{{date}}','{{date:YYYY-MM-DD}}').replace('{{related_links}}',''))next=dailyNotesTemplate();else{skipped++;continue;}
      }else{try{if(metadata(text).size!==2)continue;const p=resolveNoteContext(path,text);next=simplifyStockSections(text,p,this.relatedLinks(p.type,p.start));}catch{skipped++;continue;}}
      if(next===text)continue;
      if(!this.io.replace)throw new Error('Обновление заготовок требует защиты от конкурентной правки.');
      const backup=this.root+'/Data/note-backups/'+crypto.randomUUID()+'.md';await this.createIfAbsent(backup,text);
      if(await this.io.read(backup)!==text)throw new Error('Не подтверждена копия заметки.');
      await this.io.replace(path,text,next);if(await this.io.read(path)!==next)throw new Error('Не подтверждено обновление заготовки.');updated++;
    }return{updated,skipped};
  });}
  async context(path: string): Promise<Period> {
    const text = await this.io.read(path);
    if (text === null) throw new Error('Заметка не найдена.');
    return resolveNoteContext(path, text);
  }
  private relatedLinks(type:PeriodType,date:string):string {
    const rank=PERIOD_TYPES.indexOf(type),types=PERIOD_TYPES.slice(rank+1);
    return 'Периоды: '+types.map(t=>{const p=period(t,date);return '[['+this.root+'/Journal/'+this.folder(t)+'/'+p.key+'|'+TITLES[t]+']]';}).join(' · ');
  }
  async template(type:PeriodType){await this.ensureFoundation();return this.root+'/Templates/'+FOLDERS[type]+'.md';}
  /** Update only our marked code blocks. Unknown/interleaved text makes the region ineligible. */
  syncLayouts():Promise<{updated:number;skipped:number}> {return this.serial(async()=>{
    let updated=0,skipped=0;
    for(const path of await this.io.list('')){
      if(!path.endsWith('.md')||this.isTemplate(path)||path.startsWith(this.root+'/Data/'))continue;
      const text=await this.io.read(path);if(text===null)continue;if(!text.includes(WIDGET_START)&&!text.includes(LEGACY_WIDGET_START)){if(metadata(text).size)skipped++;continue;}
      const p=resolveNoteContext(path,text),next=replaceManagedWidgets(text,p.type,this.settings?.().layouts[p.type]);
      if(next===text)continue;
      if(!this.io.replace)throw new Error('Обновление компоновки требует защиты от конкурентной правки.');
      const backup=this.root+'/Data/note-backups/'+crypto.randomUUID()+'.md';await this.io.mkdir(this.root+'/Data/note-backups');
      if(!await this.createIfAbsent(backup,text))throw new Error('Не удалось сохранить исходную заметку.');
      if(await this.io.read(backup)!==text)throw new Error('Копия заметки не прошла проверку.');
      await this.io.replace(path,text,next);
      if(await this.io.read(path)!==next)throw new Error('Не подтверждено обновление компоновки: '+path);
      updated++;
    }return{updated,skipped};
  });}
  ensurePeriod(type: PeriodType, date: LocalDate): Promise<string> {
    return this.serial(async () => {
      const target = period(type, date);
      await this.foundation();
      const found: string[] = [];
      const canonicalFolder = `${this.root}/Journal/${this.folder(type)}/`;
      // Search the entire vault so moving or renaming a note preserves its identity.
      for (const path of await this.io.list('')) {
        if (!path.endsWith('.md') || path.startsWith(`${this.root}/Templates/`)||path.startsWith(this.root+'/Data/')) continue;
        const text = await this.io.read(path);
        if (text === null) continue;
        let context: Period;
        try {
          // Plain date-like filenames elsewhere may be unrelated personal notes.
          // Only explicit planner metadata permits discovery outside this folder.
          const explicit = metadata(text);
          if (!explicit.size && !path.startsWith(canonicalFolder)) continue;
          context = resolveNoteContext(path, text);
        } catch { continue; }
        if (context.type === target.type && context.start === target.start) found.push(path);
      }
      if (found.length > 1) throw new Error(`Найдено несколько заметок этого периода: ${found.join(', ')}. Сохраните одну корректную metadata перед продолжением.`);
      if (found.length === 1) return found[0];
      const filenameFormat=type==='day'?await dailyFilenameFormat(this.io,canonicalFolder.slice(0,-1)):undefined;
      const key = type === 'day' ? (filenameFormat==='DD-MM-YYYY'?formatDate(target.start).replaceAll('.','-'):formatDate(target.start)) : target.key;
      const path = `${this.root}/Journal/${this.folder(type)}/${key}.md`;
      const aliases = type === 'day' ? [path, `${canonicalFolder}${formatDate(target.start).replaceAll('.', '-')}.md`,`${canonicalFolder}${formatDate(target.start)}.md`] : [path];
      for (const alias of new Set(aliases)) {
        if (await this.io.read(alias) !== null) throw new Error(`Путь занят заметкой другого или некорректного периода: ${alias}`);
      }
      const template = await this.io.read(`${this.root}/Templates/${FOLDERS[type]}.md`);
      if (template === null) throw new Error('Шаблон периода не найден.');
      const values: Record<string, string> = { date: target.start, start: target.start, end: target.end, type, key: target.key, label: target.label, title: TITLES[type], date_display: formatDate(target.start), related_links:this.relatedLinks(type,target.start) };
      let content = template.replace(/\{\{(date|start|end|type|key|label|title|date_display|related_links)\}\}/g, (_, name: string) => values[name]);
      if(this.settings)content=replaceManagedWidgets(content,type,this.settings().layouts[type]);
      const explicit = metadata(content);
      const resolved = resolveNoteContext(path, content);
      if (explicit.size !== 2 || resolved.type !== target.type || resolved.start !== target.start) throw new Error('Шаблон должен сохранять правильные life-planner-type и life-planner-date: {{date}}.');
      if (!await this.createIfAbsent(path, content)) {
        const existing = await this.context(path);
        if (existing.type !== target.type || existing.start !== target.start) throw new Error('Другой файл занял путь создаваемой заметки.');
      }
      return path;
    });
  }
}

export const WIDGET_START='%% life-planner-widgets:start %%',WIDGET_END='%% life-planner-widgets:end %%';
export const LEGACY_WIDGET_START='<!-- life-planner-widgets:start -->',LEGACY_WIDGET_END='<!-- life-planner-widgets:end -->';
export function managedWidgets(type:PeriodType,layout?:WidgetModule[]):string {
 const body=widgetBlocks(type);
 return WIDGET_START+'\n'+body+'\n'+WIDGET_END;
}
export function replaceManagedWidgets(markdown:string,type:PeriodType,layout?:WidgetModule[]):string {
 const legacy=markdown.includes(LEGACY_WIDGET_START)||markdown.includes(LEGACY_WIDGET_END);
 if(legacy&&(markdown.includes(WIDGET_START)||markdown.includes(WIDGET_END)))throw new Error('Смешаны форматы границ виджетов. Текст не изменён.');
 const startMarker=legacy?LEGACY_WIDGET_START:WIDGET_START,endMarker=legacy?LEGACY_WIDGET_END:WIDGET_END,start=markdown.indexOf(startMarker),end=markdown.indexOf(endMarker);
 if(start<0&&end<0)return markdown;
 if(start<0||end<start||markdown.indexOf(startMarker,start+1)!==-1||markdown.indexOf(endMarker,end+1)!==-1)throw new Error('Неоднозначные границы виджетов. Текст не изменён.');
 const body=markdown.slice(start+startMarker.length,end),remaining=body.replace(/```life-planner\r?\n[a-z-]+\r?\n```/g,'').trim();
 if(remaining)throw new Error('В служебном участке есть пользовательский текст. Перенесите его между участками до смены порядка; текст не изменён.');
 return markdown.slice(0,start)+managedWidgets(type,layout)+markdown.slice(end+endMarker.length);
}
