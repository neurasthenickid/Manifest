import type {LifeArea} from '../model';
import type {PlannerStore} from '../model';
import type {FileIO} from '../storage';
import {CaldavClient,type DavCalendar,type DavHttp} from './caldav';
import {CalendarSync,syncHash,type SyncResult} from './calendar-sync';
export interface CalendarConnectionSettings {username:string;calendarUrl:string;areaId:string;mode:'read'|'both';auto:boolean;secretId:string}
export const connectionDefaults=():CalendarConnectionSettings=>({username:'',calendarUrl:'',areaId:'',mode:'read',auto:false,secretId:''});
export interface SecretStore {getSecret(id:string):string|null;setSecret(id:string,value:string):void}
export class CalendarConnection {
 calendars:DavCalendar[]=[];result?:SyncResult;status='Не подключено';busy=false;
 private session?:{username:string;password:string};private engine?:CalendarSync;private engineKey='';
 constructor(private settings:()=>CalendarConnectionSettings,private save:(s:CalendarConnectionSettings)=>Promise<void>,private io:FileIO,private store:PlannerStore,private http:DavHttp,readonly secrets?:SecretStore,private areas?:()=>LifeArea[]){}
 async password(value:string,remember:boolean){if(this.busy)throw new Error('Дождитесь окончания обмена.');const s=this.settings();if(!s.username.trim()||!value)throw new Error('Укажите логин и пароль приложения.');if(remember){if(!this.secrets)throw new Error('Для сохранения пароля нужен Obsidian 1.11.4 или новее. Можно подключиться без сохранения.');const secretId='life-planner-yandex-'+(await syncHash(s.username.toLowerCase())).slice(0,32);this.secrets.setSecret(secretId,value);await this.save({...s,secretId});}this.engine=undefined;this.session={username:s.username,password:value};this.status='Пароль указан; проверьте подключение.';}
 private async client(){const s={...this.settings()};const secretId='life-planner-yandex-'+(await syncHash(s.username.toLowerCase())).slice(0,32);if(JSON.stringify(s)!==JSON.stringify(this.settings()))throw new Error('Подключение изменилось.');const p=this.session?.username===s.username?this.session.password:s.secretId===secretId?this.secrets?.getSecret(secretId):null;if(!p)throw new Error('Укажите пароль приложения на этом устройстве.');return new CaldavClient(this.http,s.username,p);}
 private async run<T>(fn:()=>Promise<T>){if(this.busy)throw new Error('Подключение уже выполняется.');this.busy=true;try{return await fn();}catch(e){this.status=e instanceof Error?e.message:'Подключение не удалось';throw new Error(this.status);}finally{this.busy=false;}}
 async discover(){return this.run(async()=>{this.status='Проверяю подключение…';this.calendars=await (await this.client()).discover();this.status=`Подключение проверено. Найдено календарей: ${this.calendars.length}.`;return this.calendars;});}
 private async syncEngine(){const s={...this.settings()};if(!s.calendarUrl)throw new Error('Не выбран календарь событий.');const key=JSON.stringify(s);if(!this.engine||this.engineKey!==key){this.engine=new CalendarSync(this.io,this.store,await this.client(),{...s,canWrite:()=>{const current=this.settings();return current.mode==='both'&&current.username===s.username&&current.calendarUrl===s.calendarUrl&&current.secretId===s.secretId;},canImport:()=>!!s.areaId&&(!this.areas||this.areas().some(a=>a.id===s.areaId&&a.enabled))});this.engineKey=key;}return this.engine;}
 async sync(){return this.run(async()=>{this.status='Синхронизация…';this.result=await (await this.syncEngine()).sync();this.status=`Получено: ${this.result.received} · отправлено: ${this.result.sent} · удалено: ${this.result.removed}.`+(this.result.issues.length?' Есть события, требующие внимания.':'');return this.result;});}
 async publish(id:string){return this.run(async()=>{await (await this.syncEngine()).publish(id);this.status='Событие отправлено в выбранный календарь.';});}
 async resolve(id:string,choice:'remote'|'local'){return this.run(async()=>{await (await this.syncEngine()).resolve(id,choice);if(this.result)this.result.issues=this.result.issues.filter(i=>i.id!==id);this.status='Выбранная версия сохранена.';});}
 async disconnect(){if(this.busy)throw new Error('Дождитесь окончания обмена.');await this.save({...connectionDefaults(),username:this.settings().username});this.session=undefined;this.engine=undefined;this.calendars=[];this.result=undefined;this.status='Отключено. Локальные события сохранены.';}
}
