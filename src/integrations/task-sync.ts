import type {Task,PlannerStore,LifeArea,PlannerRecord} from '../model';
import type {FileIO} from '../storage';
import {changeTask,localTimestamp,validateRecord} from '../domain';
import {sameTask,extendsTask,canonicalJSON,rememberTask} from '../task-revisions';
import {zonedStamp} from '../event-time';
import {syncHash} from './calendar-sync';
import {DavConflict,trustedTaskUrl,type DavResource} from './caldav';
import {readTodo,writeTodo,todoFields,UnsupportedTodo,type RemoteTodo} from './vtodo';
export interface TaskSyncClient {list(url:string):Promise<DavResource[]>;get(url:string):Promise<DavResource|null>;put(url:string,data:string,etag?:string):Promise<DavResource>}
export interface TaskSyncConfig {server:string;username:string;listUrl:string;active:()=>boolean;areas:()=>LifeArea[];assertConnectionCurrent?:()=>Promise<void>}
export interface TaskSyncIssue {id?:string;title:string;message:string;conflict?:boolean;gone?:boolean}
export interface TaskSyncResult {created:number;updated:number;received:number;conflicts:number;skipped:number;issues:TaskSyncIssue[];at:string}
export interface TaskJournal {schemaVersion:1;id:string;kind:'intent'|'ack'|'gone'|'conflict';parents:string[];task:Task;url:string;uid:string;etag:string;completion:string;fields:string;remote?:DavResource}
type SyncStore=PlannerStore&{reload?:()=>Promise<void>;assertCurrent?:(record:PlannerRecord)=>Promise<void>;issues?:{id?:string;message:string}[]};
export class TaskConflict extends Error {}
export function taskStatusToken(task:Task){const entry=task.history.filter((h,i)=>i===0||h.status!==task.history[i-1].status||h.completedAt!==task.history[i-1].completedAt).at(-1)!;return canonicalJSON([entry.status,entry.completedAt??null,entry.completedDate??null,entry.externalStatus?.receipt??entry.at]);}
export function taskUID(id:string){return id+'@life-planner.todo';}
export function taskURL(list:string,id:string){return list.replace(/\/?$/,'/')+encodeURIComponent(taskUID(id))+'.ics';}
export async function taskConnectionKey(config:Pick<TaskSyncConfig,'server'|'username'|'listUrl'>){return syncHash(JSON.stringify([new URL(config.server).origin,config.username,trustedTaskUrl(config.listUrl,config.server)]));}
/** Immutable DAG entries, not a cloud lock or a last-writer-wins state file. */
export class TaskSync {
 private running=false;private root='';private entries=new Map<string,TaskJournal[]>();
 constructor(private io:FileIO,private store:SyncStore,private client:TaskSyncClient,readonly config:TaskSyncConfig){}
 private assertActive(){if(!this.config.active())throw new Error('Обмен выключен или подключение изменилось. Новые записи остановлены; очередь сохранена.');}
 private local(id:string){const task=this.store.get(id);return task?.kind==='task'?task:undefined;}
 private area(task:Task){return this.config.areas().find(a=>a.id===task.areaId)??{title:task.areaId};}
 private heads(id:string){const all=this.entries.get(id)??[],parents=new Set(all.flatMap(e=>e.parents));return all.filter(e=>!parents.has(e.id));}
 private ancestors(entry:TaskJournal){const all=new Map((this.entries.get(entry.task.id)??[]).map(e=>[e.id,e])),seen=new Set<string>(),stack=[...entry.parents];while(stack.length){const id=stack.pop()!;if(seen.has(id))continue;seen.add(id);stack.push(...all.get(id)?.parents??[]);}return seen;}
 private bases(id:string){const a=(this.entries.get(id)??[]).filter(e=>e.kind==='ack'||e.kind==='gone'),covered=new Set(a.flatMap(e=>[...this.ancestors(e)]));return a.filter(e=>!covered.has(e.id));}
 private async append(kind:TaskJournal['kind'],task:Task,remote?:DavResource,fields=todoFields(task,this.area(task))){
  if(kind==='conflict'){const existing=this.heads(task.id).find(e=>e.kind==='conflict'&&sameTask(e.task,task)&&e.etag===(remote?.etag??''));if(existing)return existing;}
  const entry:TaskJournal={schemaVersion:1,id:crypto.randomUUID(),kind,parents:this.heads(task.id).map(e=>e.id),task:structuredClone(task),uid:taskUID(task.id),url:remote?.url??taskURL(this.config.listUrl,task.id),etag:remote?.etag??'',completion:remote?readTodo(remote.data).completion:'',fields,...(kind==='conflict'&&remote?{remote}: {})};
  const dir=this.root+'/'+task.id;await this.io.mkdir(dir);const path=dir+'/'+entry.id+'.json',raw=JSON.stringify(entry);
  if(this.io.create){if(!await this.io.create(path,raw))throw new Error('Квитанция уже существует. Повторите обмен.');}else await this.io.write(path,raw);
  if(await this.io.read(path)!==raw)throw new Error('Состояние обмена не подтверждено. Намерение сохранено; повторите проверку.');
  const entries=this.entries.get(task.id)??[];entries.push(entry);this.entries.set(task.id,entries);return entry;
 }
 private async load(){
  this.root='Planner/Data/task-sync/'+await taskConnectionKey(this.config);this.entries.clear();
  for(const path of await this.io.list(this.root)){
   const suffix=path.slice(this.root.length+1).split('/');if(!path.startsWith(this.root+'/')||suffix.length!==2||!path.endsWith('.json')||suffix[0]==='runs')continue;
   const raw=await this.io.read(path);if(raw===null)throw new Error('Квитанция исчезла во время чтения. Повторите обмен.');
   let entry:TaskJournal;try{entry=JSON.parse(raw) as TaskJournal;validateRecord(entry.task);if(entry.schemaVersion!==1||entry.task.kind!=='task'||entry.task.id!==suffix[0]||!['intent','ack','gone','conflict'].includes(entry.kind)||!Array.isArray(entry.parents)||entry.parents.length>50000||!entry.parents.every(p=>typeof p==='string'&&/^[a-z0-9-]{36}$/.test(p))||!/^[-a-z0-9]{36}$/.test(entry.id)||entry.uid!==taskUID(entry.task.id)||!trustedTaskUrl(entry.url,this.config.server).startsWith(this.config.listUrl.replace(/\/?$/,'/'))||typeof entry.etag!=='string'||typeof entry.completion!=='string'||typeof entry.fields!=='string')throw new Error();}catch{throw new Error('Повреждены связи задач. Обмен остановлен, исходный файл сохранён.');}
   const values=this.entries.get(entry.task.id)??[];const duplicate=values.find(v=>v.id===entry.id);if(duplicate&&canonicalJSON(duplicate)!==canonicalJSON(entry))throw new Error('Конфликт облачных копий квитанции. Требуется восстановление.');if(!duplicate)values.push(entry);this.entries.set(entry.task.id,values);
  }
  for(const values of this.entries.values())for(const entry of values){const ids=new Set(values.map(e=>e.id));if(entry.parents.some(p=>!ids.has(p)))throw new Error('Не все облачные квитанции загружены. Дождитесь синхронизации файлов и повторите.');if(this.ancestors(entry).has(entry.id))throw new Error('Цикл в истории обмена. Исходники сохранены.');}
 }
 private async current(task:Task){this.assertActive();await this.store.assertCurrent?.(task);await this.config.assertConnectionCurrent?.();const latest=this.local(task.id);if(!latest||!sameTask(latest,task))throw new TaskConflict('Задача изменилась во время запроса. Локальная правка сохранена; повторите обмен.');this.assertActive();}
 private async accept(task:Task,remote:DavResource,parsed:RemoteTodo,result:TaskSyncResult,openStatus:Task['status']='todo'){
  this.assertActive();const current=this.local(task.id);if(!current)throw new TaskConflict('Локальная задача отсутствует.');
  if(taskStatusToken(current)!==taskStatusToken(task))throw new TaskConflict('Выполнение изменено локально во время запроса. Выберите статус.');
  const receipt='todo-'+await syncHash(remote.url+'|'+remote.etag+'|'+parsed.completion);
  if(current.history.some(h=>h.externalStatus?.receipt===receipt)){if((current.status==='done')!==parsed.done)throw new TaskConflict('Эта внешняя отметка уже применялась и была изменена локально. Выберите статус.');return current;}
  if((current.status==='done')===parsed.done)return current;
  const observedAt=localTimestamp(),historyAt=localTimestamp(new Date(Math.max(Date.now(),Date.parse(current.history.at(-1)!.at))));const date=zonedStamp(parsed.actionAt?Date.parse(parsed.actionAt):Date.now(),'Europe/Moscow').slice(0,10);
  if(parsed.done&&(date<(current.createdDate??current.createdAt.slice(0,10))||Date.parse(parsed.actionAt??observedAt)>Date.now()+60000))throw new TaskConflict('Внешняя дата выполнения раньше создания или в будущем. Нужна проверка.');
  await this.current(current);
  const previousOpen=current.history.filter(h=>h.status!=='done').at(-1)?.status??openStatus;
  const saved=await this.store.save(changeTask(current,{status:parsed.done?'done':previousOpen==='doing'?'doing':'todo',externalStatus:{receipt,actionAt:parsed.actionAt,observedAt,unknownTime:!parsed.actionAt}},historyAt,parsed.done?date:undefined,parsed.done?date:current.completedDate??date),current.version);
  result.received++;if(parsed.done&&!parsed.actionAt)result.issues.push({id:task.id,title:task.title,message:'Сервер не сообщил точное время выполнения. Учётный день — день получения; время действия неизвестно.'});return saved;
 }
 private async send(task:Task,remote:DavResource|null,result:TaskSyncResult){
  await this.current(task);const fields=todoFields(task,this.area(task));await this.append('intent',task,remote??undefined,fields);await this.current(task);
  // No await between the live guard and initiating a conditional server write.
  this.assertActive();const saved=await this.client.put(remote?.url??taskURL(this.config.listUrl,task.id),writeTodo(task,taskUID(task.id),this.area(task),remote?.data),remote?.etag);
  const parsed=readTodo(saved.data),expected=readTodo(writeTodo(task,taskUID(task.id),this.area(task)));
  if(parsed.uid!==expected.uid||parsed.completion!==expected.completion)throw new TaskConflict('Отправка не подтверждена тем же статусом. Намерение сохранено; повторите обмен.');
  // A completed in-flight request is acknowledged in its old connection even after disable.
  await this.append('ack',task,saved,fields);remote?result.updated++:result.created++;
 }
 private async process(task:Task,remote:DavResource|null,result:TaskSyncResult,choice?:'remote'|'local'|'recreate'){
  this.assertActive();const baseHeads=this.bases(task.id);let base=baseHeads[0];
  if(!choice&&baseHeads.some(b=>b.kind!==base?.kind||b.completion!==base?.completion||b.fields!==base?.fields||taskStatusToken(b.task)!==taskStatusToken(base.task)))throw new TaskConflict('Устройства согласовали разные версии. Выберите статус; снимки обеих ветвей сохранены.');
  if(!choice&&base&&!sameTask(task,base.task)&&!extendsTask(task,base.task))throw new TaskConflict('Локальная облачная копия отстаёт или расходится с квитанцией. Обновите файлы, не отправляя старый статус.');
  if(task.archived){result.skipped++;result.issues.push({id:task.id,title:task.title,message:'Архивная задача: обмен приостановлен, внешняя запись и история сохранены.'});return;}
  if(!remote){
   if(base){if(choice==='recreate'){await this.send(task,null,result);return;}if(base.kind!=='gone')await this.append('gone',task);result.skipped++;result.issues.push({id:task.id,title:task.title,message:'Задача удалена снаружи. Локальные данные сохранены; автоматического восстановления нет.',gone:true});return;}
   if(task.status==='done'&&!this.entries.has(task.id))return;
   const uncertain=(this.entries.get(task.id)??[]).some(e=>e.kind==='intent');if(uncertain){throw new TaskConflict('Результат прежней отправки неизвестен, ресурс не найден. Проверьте сервер; создание заново — только явно.');}
   await this.send(task,null,result);return;
  }
  const parsed=readTodo(remote.data);if(parsed.uid!==taskUID(task.id))throw new TaskConflict('UID ресурса не совпадает с задачей.');
  if(base?.kind==='gone'&&!choice)throw new TaskConflict('Удалённая внешняя задача появилась снова. Нужен явный выбор.');
  const pending=(this.entries.get(task.id)??[]).filter(e=>e.kind==='intent'&&!this.entries.get(task.id)!.some(a=>a.kind==='ack'&&this.ancestors(a).has(e.id)));
  if(!base&&pending.length){const intent=pending[0];if(pending.some(i=>taskStatusToken(i.task)!==taskStatusToken(intent.task)))throw new TaskConflict('Несогласованные намерения двух устройств. Выберите статус.');base={...intent,kind:'ack',completion:readTodo(writeTodo(intent.task,intent.uid,this.area(intent.task))).completion};}
  let current=this.local(task.id)!;
  const changedLocal=base?taskStatusToken(current)!==taskStatusToken(base.task):current.history.some((h,i)=>i>0&&h.status!==current.history[i-1].status),changedRemote=base?parsed.completion!==base.completion:(current.status==='done')!==parsed.done;
  if(choice==='local'){await this.send(current,remote,result);return;}
  if(choice==='remote')current=await this.accept(current,remote,parsed,result,base?.task.status);
  else{
   if(changedLocal&&(changedRemote||base&&remote.etag!==base.etag)&&!(parsed.completion===readTodo(writeTodo(current,taskUID(current.id),this.area(current))).completion))throw new TaskConflict('Выполнение менялось с двух сторон. Выберите статус; часы устройств не определяют победителя.');
   if(changedRemote&&!changedLocal)current=await this.accept(current,remote,parsed,result,base?.task.status);
  }
  // A second device may see a resource before its cloud receipt. Never replace
  // that resource's metadata from an unbased (possibly stale) local snapshot.
  const fields=todoFields(current,this.area(current));const dirtyFields=!!base&&fields!==base.fields;
  const dirtyStatus=taskStatusToken(current)!==taskStatusToken(base?.task??current)&&(current.status==='done')!==parsed.done;
  if(parsed.fields!==fields)result.issues.push({id:task.id,title:current.title,message:'Внешние название, описание или срок отличаются. Поля Obsidian сохранены; снаружи принимается только выполнение.'});
  if(dirtyStatus||dirtyFields){await this.send(current,remote,result);return;}
  if(!base||remote.etag!==base.etag||baseHeads.length>1||choice||!sameTask(current,base.task))await this.append('ack',current,remote,base?.fields??fields);
 }
 private async guarded<T>(fn:()=>Promise<T>){if(this.running)throw new Error('Обмен задачами уже выполняется.');this.running=true;try{this.assertActive();await this.store.reload?.();await this.load();this.assertActive();return await fn();}finally{this.running=false;}}
 async sync():Promise<TaskSyncResult>{return this.guarded(async()=>{
  const result:TaskSyncResult={created:0,updated:0,received:0,conflicts:0,skipped:0,issues:[],at:new Date().toISOString()};
  const resources=await this.client.list(this.config.listUrl);this.assertActive();const byUid=new Map<string,DavResource>();
  for(const remote of resources){try{const p=readTodo(remote.data);if(byUid.has(p.uid))throw new TaskConflict('Сервер вернул две записи с одним UID. Обмен остановлен.');byUid.set(p.uid,remote);}catch(e){if(!(e instanceof UnsupportedTodo))throw e;result.skipped++;result.issues.push({title:'Внешняя задача',message:e.message});}}
  const all=this.store.all('task'),knownUIDs=new Set(all.map(t=>taskUID(t.id)));for(const uid of byUid.keys())if(!knownUIDs.has(uid)){result.skipped++;result.issues.push({title:'Внешняя задача',message:'Созданная снаружи задача не импортируется в Obsidian.'});}
  for(const id of new Set([...all.filter(t=>!t.archived&&t.status!=='done'||this.entries.has(t.id)||byUid.has(taskUID(t.id))).map(t=>t.id),...this.entries.keys()])){
   this.assertActive();let task=this.local(id);if(!task){result.skipped++;result.issues.push({id,title:'Задача',message:'Локальная запись отсутствует. Внешняя запись не удаляется.'});continue;}
   try{if(this.store.issues?.some(i=>i.id===id))throw new TaskConflict('Облачные копии задачи конфликтуют. Сначала восстановите нужную копию в данных.');await rememberTask(this.io,'Planner/Data',task);
    const remote=byUid.get(taskUID(id))??await this.client.get(this.bases(id)[0]?.url??taskURL(this.config.listUrl,id));this.assertActive();const latest=this.local(id);if(!latest)throw new TaskConflict('Локальная задача исчезла во время запроса.');if(taskStatusToken(latest)!==taskStatusToken(task))throw new TaskConflict('Выполнение изменено локально во время запроса. Повторите обмен.');task=latest;
    await this.process(task,remote,result);
   }catch(e){if(e instanceof DavConflict||e instanceof TaskConflict){result.conflicts++;result.issues.push({id,title:task.title,message:e.message,conflict:true});const remote=byUid.get(taskUID(id));await this.append('conflict',task,remote);}else if(e instanceof UnsupportedTodo){result.skipped++;result.issues.push({id,title:task.title,message:e.message});}else throw e;}
  }
  const dir=this.root+'/runs';await this.io.mkdir(dir);await this.io.write(dir+'/'+crypto.randomUUID()+'.json',JSON.stringify(result));return result;
 });}
 async resolve(id:string,choice:'remote'|'local'|'recreate'){return this.guarded(async()=>{const task=this.local(id);if(!task)throw new Error('Локальная задача не найдена.');await this.current(task);const remote=await this.client.get(this.bases(id)[0]?.url??taskURL(this.config.listUrl,id));const result:TaskSyncResult={created:0,updated:0,received:0,conflicts:0,skipped:0,issues:[],at:new Date().toISOString()};if(choice==='recreate'&&remote)throw new Error('Запись уже существует. Повторите обмен.');if(choice==='recreate'&&!this.bases(id).some(b=>b.kind==='gone')&&!(this.entries.get(id)??[]).some(e=>e.kind==='intent'))throw new Error('Нет подтверждённого удаления или неопределённой отправки.');if(choice==='recreate'){await this.send(task,null,result);return result;}await this.process(task,remote,result,choice);return result;});}
}
