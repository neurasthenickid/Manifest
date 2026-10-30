import type {CalendarEvent,PlannerStore} from '../model';
import type {FileIO} from '../storage';
import {CaldavClient,DavConflict, trustedDavUrl, trustedTaskUrl,type DavResource} from './caldav';
import {eventFingerprint,readEvent,writeEvent,UnsupportedCalendarEvent} from './ical';
export interface SyncConfig {username:string;calendarUrl:string;areaId:string;mode:'read'|'both';canImport?:()=>boolean;canWrite?:()=>boolean;server?:string;allowUnassigned?:boolean;assertCurrent?:()=>Promise<void>}
class CalendarWriteDenied extends Error {constructor(){super('Настройки обмена изменились или включён режим «только получать». Отправка остановлена; локальные правки и очередь сохранены.');}}
export interface SyncLink {id:string;uid:string;url:string;etag:string;raw:string;base:string;version:number;gone?:boolean}
export interface SyncIssue {id?:string;title:string;message:string;conflict?:boolean}
export interface SyncResult {received:number;sent:number;removed:number;issues:SyncIssue[];at:string}
interface State {schemaVersion:1;key:string;links:SyncLink[];lastSuccess?:string}
export async function syncHash(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
/** A single saved connection. No account secrets in the state or queue. */
export class CalendarSync {
 private running=false;private state?:State;private source:string|null=null;private path='';
 constructor(private io:FileIO,private store:PlannerStore,private client:Pick<CaldavClient,'list'|'get'|'put'|'remove'>,readonly config:SyncConfig){}
 // No await between the current permission check and starting an HTTP write.
 private async put(url:string,data:string,etag?:string,snapshot?:CalendarEvent){await this.config.assertCurrent?.();if(snapshot)await (this.store as PlannerStore&{assertCurrent?:(r:CalendarEvent)=>Promise<void>}).assertCurrent?.(snapshot);this.assertWrite();return this.client.put(url,data,etag);}
 private async remove(url:string,etag:string){await this.config.assertCurrent?.();this.assertWrite();return this.client.remove(url,etag);}
 private trusted(url:string){return this.config.server?trustedTaskUrl(url,this.config.server):trustedDavUrl(url);}
 async isLinked(id:string){return this.guarded(async()=>this.state!.links.some(l=>l.id===id));}
 private assertWrite(){if(this.config.mode!=='both'||this.config.canWrite&&!this.config.canWrite())throw new CalendarWriteDenied();}
 private async load(){
  const key=await syncHash(JSON.stringify([this.config.server&&new URL(this.config.server).origin!=='https://caldav.yandex.ru'?this.config.username:this.config.username.toLowerCase(),this.trusted(this.config.calendarUrl)]));this.path=`Planner/Data/calendar-sync/${key}.json`;this.source=await this.io.read(this.path);
  const s:State=this.source?JSON.parse(this.source) as State:{schemaVersion:1,key,links:[]};
  if(s.schemaVersion!==1||s.key!==key||!Array.isArray(s.links)||s.links.length>50000)throw new Error('Состояние обмена повреждено. Исходник сохранён.');
  const ids=new Set<string>(),uids=new Set<string>();for(const l of s.links){if(!/^[a-zA-Z0-9_-]{1,240}$/.test(l.id)||typeof l.uid!=='string'||!l.uid||typeof l.base!=='string'||typeof l.raw!=='string'||typeof l.etag!=='string'||!Number.isInteger(l.version)||l.version<0||ids.has(l.id)||uids.has(l.uid)||!this.trusted(l.url).startsWith(this.config.calendarUrl))throw new Error('Повреждённые связи календаря. Обмен остановлен.');ids.add(l.id);uids.add(l.uid);}this.state=s;
 }
 private async persist(){await this.io.mkdir('Planner/Data/calendar-sync');const raw=JSON.stringify(this.state,null,2);if(await this.io.read(this.path)!==this.source)throw new Error('Состояние обмена изменено другим устройством. Перезапустите синхронизацию.');if(this.source!==null&&this.io.replace)await this.io.replace(this.path,this.source,raw);else if(this.source===null&&this.io.create){if(!await this.io.create(this.path,raw))throw new Error('Связи созданы другим устройством. Повторите обмен.');}else await this.io.write(this.path,raw);if(await this.io.read(this.path)!==raw)throw new Error('Связи календаря не сохранены.');this.source=raw;}
 private local(l:SyncLink){const e=this.store.get(l.id);if(e&&e.kind!=='event')throw new Error('ID календаря занят другой записью.');return e;}
 private importMessage(){return this.config.areaId?'Сфера для импорта выключена. Выберите включённую сферу в настройках календаря.':'Не выбрана сфера для новых импортируемых событий. Уже связанные события продолжают обмен.';}
 private async accept(l:SyncLink,remote:DavResource,expected=this.local(l)?.version??0){
  await this.config.assertCurrent?.();const previous=this.local(l);if((previous?.version??0)!==expected)throw new DavConflict();if(!previous&&!this.config.areaId&&!this.config.allowUnassigned)throw new Error(this.importMessage());const parsed=readEvent(remote.data,previous?.areaId??this.config.areaId);if(parsed.uid!==l.uid)throw new Error('UID календарного ресурса изменился.');
  const e:CalendarEvent={...parsed.event,schemaVersion:previous?.schemaVersion??parsed.event.schemaVersion,id:l.id,version:previous?.version??0,...(previous?.featured===undefined?{}:{featured:previous.featured})};
  const saved=previous&&eventFingerprint(previous)===eventFingerprint(e)?previous:await this.store.save(e,previous?.version??0);
  Object.assign(l,{url:remote.url,etag:remote.etag,raw:remote.data,base:eventFingerprint(saved),version:saved.version,gone:false});await this.persist();
 }
 private async acknowledge(l:SyncLink,remote:DavResource,snapshot:CalendarEvent){
  const parsed=readEvent(remote.data,snapshot.areaId);if(parsed.uid!==l.uid||eventFingerprint(parsed.event)!==eventFingerprint({...snapshot,deleted:undefined}))throw new Error('Сервер сохранил отличающуюся версию. Повторите обмен для проверки.');
  Object.assign(l,{etag:remote.etag,raw:remote.data,base:eventFingerprint(snapshot),version:snapshot.version,gone:false});await this.persist();
 }
 private async guarded<T>(fn:()=>Promise<T>){if(this.running)throw new Error('Синхронизация уже выполняется.');this.running=true;try{await this.load();return await fn();}finally{this.running=false;}}
 async sync():Promise<SyncResult>{return this.guarded(async()=>{
  const result:SyncResult={received:0,sent:0,removed:0,issues:[],at:new Date().toISOString()};const resources=await this.client.list(this.config.calendarUrl),byUid=new Map<string,DavResource>(),skippedUrls=new Set<string>();
  for(const r of resources){try{const p=readEvent(r.data,this.config.allowUnassigned?'':this.config.areaId||'self');if(byUid.has(p.uid))throw new Error('Повтор UID на сервере.');byUid.set(p.uid,r);}catch(e){if(!(e instanceof UnsupportedCalendarEvent))throw e;skippedUrls.add(r.url);result.issues.push({title:'Внешнее событие',message:e.message});}}
  for(const [uid,r] of byUid){if(this.state!.links.some(l=>l.uid===uid))continue;if(!this.config.areaId&&!this.config.allowUnassigned||this.config.canImport&&!this.config.canImport()){result.issues.push({title:'Новые события',message:this.importMessage()});continue;}const owned=uid.endsWith('@life-planner')?this.store.get(uid.slice(0,-'@life-planner'.length)):undefined;const local=owned?.kind==='event'?owned:undefined;const id=local?.id??'caldav-'+await syncHash(this.state!.key+':'+uid);const l:SyncLink={id,uid,url:r.url,etag:'',raw:'',base:'',version:local?.version??0};this.state!.links.push(l);await this.persist();if(this.config.canImport&&!this.config.canImport())continue;if(!local){await this.accept(l,r,0);result.received++;}}
  for(const l of this.state!.links){let local=this.local(l);try{
   const localIssue=(this.store as PlannerStore&{issues?:{id?:string;message:string}[]}).issues?.find(i=>i.id===l.id);if(localIssue){result.issues.push({id:l.id,title:local?.title??'Событие',message:localIssue.message,conflict:true});continue;}
   // A resource seen but skipped in REPORT is present, never a deletion.
   if(skippedUrls.has(l.url))continue;
   // GET missing linked resources; absence from a REPORT is never a deletion.
   let remote=byUid.get(l.uid);if(!remote){const found=await this.client.get(l.url);if(found)remote=found;}
   if((this.local(l)?.version??0)!==(local?.version??0))throw new DavConflict();
   if(remote){const parsed=readEvent(remote.data,local?.areaId??(this.config.allowUnassigned?'':this.config.areaId||'self'));if(parsed.uid!==l.uid)throw new DavConflict();if(l.url!==remote.url){l.url=remote.url;await this.persist();}
    if(l.gone){result.issues.push({id:l.id,title:local?.title??parsed.event.title,message:'Удалённое событие появилось снова. Выберите версию.',conflict:true});continue;}
    if(!local||l.version===0){if(!this.config.areaId&&!this.config.allowUnassigned||this.config.canImport&&!this.config.canImport()){result.issues.push({title:'Новые события',message:this.importMessage()});continue;}await this.accept(l,remote,local?.version??0);result.received++;continue;}
    const dirty=eventFingerprint(local)!==l.base;
    if(!l.etag){if(!local.deleted&&eventFingerprint(parsed.event)===eventFingerprint(local)){await this.acknowledge(l,remote,local);continue;}throw new DavConflict();}
    if(dirty&&remote.etag!==l.etag){if(!local.deleted&&eventFingerprint(parsed.event)===eventFingerprint(local)){await this.acknowledge(l,remote,local);continue;}throw new DavConflict();}
    if(dirty){if(this.config.mode!=='both'){result.issues.push({id:l.id,title:local.title,message:'Есть локальные правки. Выберите двусторонний обмен или версию Яндекса.',conflict:true});continue;}
     if(local.deleted){await this.remove(l.url,remote.etag);l.gone=true;l.base=eventFingerprint(local);await this.persist();result.removed++;}
     else{const updated=await this.put(l.url,writeEvent(local,l.uid,remote.data),remote.etag,local);await this.acknowledge(l,updated,local);result.sent++;}
    }else if(remote.etag!==l.etag){await this.accept(l,remote,local.version);result.received++;}
   }else if(!l.gone){
    if(!l.etag&&l.version>0&&local&&!local.deleted){if(this.config.mode!=='both')continue;const created=await this.put(l.url,writeEvent(local,l.uid),undefined,local);await this.acknowledge(l,created,local);result.sent++;continue;}
    if(!local||l.version===0)throw new Error('Не найдена исходная запись. Связь сохранена для восстановления.');
    const dirty=eventFingerprint(local)!==l.base;if(dirty&&!local.deleted)throw new DavConflict();
    const deleted=local.deleted?local:await this.store.save({...local,deleted:true},local.version);l.base=eventFingerprint(deleted);l.version=deleted.version;l.gone=true;await this.persist();result.removed++;
   }
  }catch(e){if(e instanceof DavConflict||e instanceof UnsupportedCalendarEvent||e instanceof CalendarWriteDenied){result.issues.push({id:l.id,title:local?.title??'Событие',message:e.message,conflict:e instanceof DavConflict});}else throw e;}}
  this.state!.lastSuccess=result.at;await this.persist();return result;
 });}
 async publish(id:string){return this.guarded(async()=>{if(this.config.mode!=='both')throw new Error('Для отправки включите двусторонний обмен.');const local=this.store.get(id);if(!local||local.kind!=='event'||local.deleted)throw new Error('Выберите существующее событие.');if(this.state!.links.some(l=>l.id===id))throw new Error('Событие уже связано: используйте синхронизацию.');const uid=local.id+'@life-planner',url=this.config.calendarUrl.replace(/\/?$/,'/')+encodeURIComponent(uid)+'.ics';const raw=writeEvent(local,uid);const l:SyncLink={id,uid,url,etag:'',raw:'',base:'',version:local.version};this.state!.links.push(l);await this.persist();const existing=await this.client.get(url);if(existing){await this.acknowledge(l,existing,local);return;}const remote=await this.put(url,raw,undefined,local);await this.acknowledge(l,remote,local);});}
 async resolve(id:string,choice:'remote'|'local'){return this.guarded(async()=>{const l=this.state!.links.find(l=>l.id===id);if(!l)throw new Error('Связь не найдена.');const local=this.local(l),remote=await this.client.get(l.url);if((this.local(l)?.version??0)!==(local?.version??0))throw new DavConflict();
  if(choice==='remote'){if(remote)await this.accept(l,remote,local?.version??0);else{if(local&&!local.deleted)await this.store.save({...local,deleted:true},local.version);l.gone=true;l.base=local?eventFingerprint({...local,deleted:true}):'';await this.persist();}return;}
  if(this.config.mode!=='both'||!local)throw new Error('Локальную версию можно отправить только при двустороннем обмене.');
  if(local.deleted){if(remote)await this.remove(l.url,remote.etag);l.gone=true;l.base=eventFingerprint(local);await this.persist();}else{const saved=await this.put(l.url,writeEvent(local,l.uid,remote?.data),remote?.etag,local);await this.acknowledge(l,saved,local);}
 });}
}
