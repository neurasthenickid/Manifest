import {parseJSON} from '../json';
import {isCloudResult} from './results';
import {startTimeout,stopTimeout} from '../timers';
import type {LifeArea,PlannerStore} from '../model';
import type {FileIO} from '../storage';
import type {SecretStore} from './connection';
import {CaldavClient,DavTimeout,type DavCalendar,type DavHttp} from './caldav';
import {CalendarSync,syncHash,type SyncResult} from './calendar-sync';
import {TaskSync,type TaskSyncResult} from './task-sync';
import {normalizeCloud,type CloudSettings} from './cloud-settings';
import {YANDEX_CALDAV,trustedTaskUrl} from './caldav';
export interface CloudResult {at:string;events?:SyncResult;tasks?:TaskSyncResult;errors:string[]}
export type CloudClient=Pick<CaldavClient,'discover'|'list'|'get'|'put'|'remove'>;
export class CloudConnection {
 resources:DavCalendar[]=[];busy=false;status='Не подключено';error='';warning='';result?:CloudResult;lastSuccess?:string;
 private epoch=0;private session?:{key:string;password:string;secretId:string};private listeners=new Set<()=>void>();private disposed=false;private resourcesKey='';
 constructor(readonly settings:()=>CloudSettings,private save:(s:CloudSettings)=>Promise<void>,private io:FileIO,private store:PlannerStore,private http:DavHttp,readonly secrets:SecretStore|undefined,private areas:()=>LifeArea[],private assertFile:()=>Promise<void>=async()=>{},private timeouts={request:30000,operation:120000},private factory?:(s:CloudSettings,component:'VEVENT'|'VTODO',password:string)=>CloudClient){}
 reportError(e:unknown){this.error=e instanceof Error?e.message:'Подключение остановлено.';this.status='Требуется внимание';this.notify();}
 subscribe(fn:()=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn);};}
 private notify(){for(const fn of this.listeners)try{fn();}catch{/* Observer/history failures must not discard canonical records. */}}
 private key(s=this.settings()){try{return JSON.stringify([trustedTaskUrl(s.server,s.server),s.username.trim()]);}catch{return 'invalid-connection';}}
 private signature(s=this.settings()){return JSON.stringify(s);}
 private async secretKey(s=this.settings()){return 'life-planner-cloud-'+(await syncHash(this.key(s))).slice(0,32);}
 private credential(s=this.settings()){return this.session?.key===this.key(s)&&this.session.secretId===s.secretId?this.session.password:null;}
 get connected(){return !!this.credential();}
 get hasDiscovery(){return this.resourcesKey===this.key()&&this.settings().checked;}
 settingsChanged(){this.epoch++;if(this.session?.key!==this.key())this.session=undefined;if(this.resourcesKey!==this.key())this.resources=[];this.error='';this.status=this.connected?'Подключено':'Нужен вход на этом устройстве';this.notify();}
 async restore(){
  const s=normalizeCloud(this.settings()),signature=this.signature(),token=this.epoch;
  const current=()=>!this.disposed&&token===this.epoch&&signature===this.signature();
  if(!this.credential(s)&&this.secrets){
   this.session=undefined;const secretId=await this.secretKey(s);
   if(!current())return;
   // A shared reference is not authority to read an arbitrary device secret.
   // A mismatched modern reference also forbids falling back to legacy references.
   if(s.username&&s.secretId===secretId){const password=this.secrets.getSecret(secretId);if(password)this.session={key:this.key(s),secretId,password};}
   else if(s.username&&!s.secretId){
    const expected=['life-planner-onetask-'+(await syncHash(this.key(s))).slice(0,32)];
    if(s.server===YANDEX_CALDAV)expected.push('life-planner-yandex-'+(await syncHash(s.username.toLowerCase())).slice(0,32));
    if(!current())return;
    for(const id of s.legacySecrets){if(!expected.includes(id))continue;const password=this.secrets.getSecret(id);if(!password)continue;
     this.secrets.setSecret(secretId,password);if(this.secrets.getSecret(secretId)!==password)throw Error('Устройство не подтвердило сохранение пароля.');
     if(!current())return;await this.save({...s,secretId,legacySecrets:[]});
     if(this.key()===this.key(s)&&this.settings().secretId===secretId)this.session={key:this.key(s),secretId,password};break;
    }
   }
  }
  this.status=this.connected?'Подключено':'Нужен вход на этом устройстве';if(!this.secrets)this.warning='Obsidian не предоставляет SecretStorage. Обновите Obsidian до 1.11.4 или новее на этом устройстве. До обновления пароль доступен только в текущем сеансе.';await this.restoreResult();this.notify();
 }
 private client(s:CloudSettings,component:'VEVENT'|'VTODO'){const password=this.credential(s);if(!password)throw Error('Нужен пароль на этом устройстве. Войдите один раз; пароль из облака не передаётся.');return this.factory?this.factory(s,component,password):new CaldavClient(this.http,s.username,password,s.server,component,this.timeouts.request);}
 private live(token:number,s:CloudSettings){return !this.disposed&&token===this.epoch&&this.settings().enabled&&this.signature()===this.signature(s);}
 private async current(token:number,s:CloudSettings){if(!this.live(token,s))throw Error('Обмен выключен или аккаунт изменён. Новые отправки остановлены.');await this.assertFile();if(!this.live(token,s))throw Error('Подключение изменилось.');}
 private async run<T>(label:string,fn:(token:number)=>Promise<T>){if(this.busy)throw Error('Обмен уже выполняется.');if(this.disposed)throw Error('Подключение закрыто.');this.busy=true;this.status=label;this.error='';const token=++this.epoch;this.notify();let timer:ReturnType<typeof startTimeout>|undefined;try{return await Promise.race([fn(token),new Promise<never>((_,reject)=>{timer=startTimeout(()=>{if(this.epoch===token)this.epoch++;reject(new DavTimeout());},this.timeouts.operation);})]);}catch(e){this.error=e instanceof Error?e.message:'Не удалось выполнить обмен.';this.status='Требуется внимание';this.notify();throw Error(this.error);}finally{stopTimeout(timer);this.busy=false;this.notify();}}
 async connect(server:string,username:string,password?:string){return this.run('Подключаю…',async token=>{
  const prior=this.session;try{server=trustedTaskUrl(server,server);username=username.trim();const old=this.settings(),changed=this.key({...old,server,username})!==this.key(old);let s={...old,server,username,...(changed?{calendarUrl:'',taskUrl:'',secretId:'',legacySecrets:[],checked:false,enabled:false}:{})};
  s=normalizeCloud(s);if(!s.username.trim())throw Error('Укажите аккаунт.');if(password)this.session={key:this.key(s),secretId:s.secretId,password};
  const resources=await this.client(s,'VEVENT').discover();if(token!==this.epoch||this.disposed)throw Error('Подключение изменилось во время входа.');if(password){if(this.secrets){const secretId=await this.secretKey(s);this.secrets.setSecret(secretId,password);if(this.secrets.getSecret(secretId)!==password)throw Error('Устройство не подтвердило сохранение пароля. Повторите вход.');s.secretId=secretId;}else this.warning='Пароль действует только в этом сеансе. Для автоматического сохранения обновите Obsidian до 1.11.4 или новее.';}this.resources=resources;this.resourcesKey=this.key(s);
  for(const [kind,field] of [['VEVENT','calendarUrl'],['VTODO','taskUrl']] as const){const choices=resources.filter(r=>r.writable&&r.components.includes(kind));if(!choices.some(r=>r.url===s[field]))s[field]=choices.length===1?choices[0].url:'';}
  s.checked=true;s.enabled=!!(s.calendarUrl||s.taskUrl);await this.save(s);if(password)this.session={key:this.key(s),secretId:s.secretId,password};this.status='Подключено';this.notify();return resources;}catch(e){this.session=prior?.key===this.key()?prior:undefined;throw e;}
 });}
 async choose(field:'calendarUrl'|'taskUrl',url:string){const kind=field==='calendarUrl'?'VEVENT':'VTODO';if(!this.resources.some(r=>r.url===url&&r.writable&&r.components.includes(kind)))throw Error('Выберите доступный ресурс из обнаруженного списка.');await this.save({...this.settings(),[field]:url,enabled:true});this.settingsChanged();}
 private eventEngine(token:number,s:CloudSettings){return new CalendarSync(this.io,this.store,this.client(s,'VEVENT'),{server:s.server,username:s.username,calendarUrl:s.calendarUrl,areaId:'',mode:'both',allowUnassigned:true,canWrite:()=>this.live(token,s),assertCurrent:()=>this.current(token,s),canImport:()=>this.live(token,s)});}
 private taskEngine(token:number,s:CloudSettings){return new TaskSync(this.io,this.store,this.client(s,'VTODO'),{...s,listUrl:s.taskUrl,active:()=>this.live(token,s),areas:this.areas,assertConnectionCurrent:()=>this.current(token,s)});}
 async sync(){return this.run('Синхронизация…',async token=>{const s={...this.settings()};if(!s.enabled)throw Error('Автоматический обмен выключен.');if(!s.checked)throw Error('Сначала проверьте подключение.');if(!s.calendarUrl&&!s.taskUrl)throw Error('Нет выбранного доступного календаря или списка задач.');const result:CloudResult={at:new Date().toISOString(),errors:[]};
  if(s.calendarUrl)try{await this.current(token,s);const engine=this.eventEngine(token,s);result.events=await engine.sync();for(const e of this.store.all('event').filter(e=>!e.deleted)){await this.current(token,s);if(await engine.isLinked(e.id))continue;const problem=(this.store as PlannerStore&{issues?:{id?:string;message:string}[]}).issues?.find(i=>i.id===e.id);if(problem){result.events.issues.push({id:e.id,title:e.title,message:problem.message,conflict:true});continue;}try{await engine.publish(e.id);result.events.sent++;}catch(error){result.events.issues.push({id:e.id,title:e.title,message:error instanceof Error?error.message:'Не удалось отправить событие.',conflict:true});}}}catch(e){result.errors.push('События: '+(e instanceof Error?e.message:'обмен не выполнен'));}
  if(s.taskUrl)try{await this.current(token,s);result.tasks=await this.taskEngine(token,s).sync();}catch(e){result.errors.push('Задачи: '+(e instanceof Error?e.message:'обмен не выполнен'));}
  if(!this.live(token,s))throw Error('Обмен остановлен: подключение изменилось. Начатые отправки сохранены для согласования.');
  this.result=result;this.lastSuccess=result.errors.length?this.lastSuccess:result.at;this.error=result.errors.join(' · ');this.status=result.errors.length?'Часть обмена не выполнена':'Подключено';const dir='Planner/Data/cloud-sync/'+await syncHash(this.key(s));await this.io.mkdir(dir);await this.io.write(dir+'/'+crypto.randomUUID()+'.json',JSON.stringify({...result,lastSuccess:this.lastSuccess}));this.notify();return result;
 });}
 async resolve(kind:'events'|'tasks',id:string,choice:'remote'|'local'|'recreate'){return this.run('Согласую изменения…',async token=>{const s={...this.settings()};await this.current(token,s);if(kind==='events'){if(choice==='recreate')throw Error('Недопустимое действие.');await this.eventEngine(token,s).resolve(id,choice);}else await this.taskEngine(token,s).resolve(id,choice);this.status='Версия согласована';});}
 private async restoreResult(){const s={...this.settings()},dir='Planner/Data/cloud-sync/'+await syncHash(this.key(s));let latest:(CloudResult&{lastSuccess?:string})|undefined;for(const path of await this.io.list(dir))try{const r=parseJSON(await this.io.read(path)??'null');if(isCloudResult(r)&&(!latest||r.at>latest.at))latest=r;}catch{/* Observer/history failures must not discard canonical records. */}if(latest){this.result=latest;this.lastSuccess=latest.lastSuccess;}}
 dispose(){this.disposed=true;this.epoch++;this.session=undefined;this.listeners.clear();}
}
/** A coalescing scheduler; canonical records and adapter journals are the durable queue. */
export class CloudAutoSync {
 private timer?:ReturnType<typeof startTimeout>;private running=false;private dirty=false;private stopped=false;
 constructor(private connection:Pick<CloudConnection,'sync'|'settings'|'connected'>&Partial<Pick<CloudConnection,'busy'>>,private delay=600){}
 trigger(){if(this.stopped)return;if(!this.connection.settings().enabled||!this.connection.connected){stopTimeout(this.timer);this.dirty=false;return;}this.dirty=true;if(this.running)return;stopTimeout(this.timer);this.timer=startTimeout(()=>{void this.flush();},this.delay);}
 async flush(){if(this.stopped||this.running||!this.dirty)return;if(!this.connection.settings().enabled){stopTimeout(this.timer);this.dirty=false;return;}if(this.connection.busy){this.trigger();return;}stopTimeout(this.timer);this.timer=undefined;this.running=true;this.dirty=false;try{await this.connection.sync();}catch{/* Observer/history failures must not discard canonical records. */}finally{this.running=false;if(this.dirty)this.trigger();}}
 dispose(){this.stopped=true;stopTimeout(this.timer);this.dirty=false;}
}
