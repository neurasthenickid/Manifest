import type {FileIO} from '../storage';
import type {CalendarConnectionSettings} from './connection';
import type {TaskConnectionSettings} from './task-connection';
import {trustedTaskUrl,YANDEX_CALDAV} from './caldav';
import {canonicalJSON} from '../task-revisions';
import {isObject,object,parseJSON} from '../json';
interface CloudDocument {schemaVersion:1;settings:unknown;revision?:string;parents?:string[]}
interface CloudSnapshot extends CloudDocument {revision:string;parents:string[]}
function document(value:unknown):CloudDocument{
 if(!isObject(value)||value.schemaVersion!==1||!isObject(value.settings)||value.revision!==undefined&&typeof value.revision!=='string'||value.parents!==undefined&&(!Array.isArray(value.parents)||!value.parents.every((p:unknown)=>typeof p==='string')))throw Error('Некорректный снимок подключения.');
 return value as unknown as CloudDocument;
}
function snapshot(value:unknown):CloudSnapshot{const v=document(value);if(!v.revision||!Array.isArray(v.parents))throw Error('Некорректная история подключения.');return v as CloudSnapshot;}
export interface CloudSettings {server:string;username:string;secretId:string;enabled:boolean;calendarUrl:string;taskUrl:string;checked:boolean;legacySecrets:string[]}
export const cloudDefaults=():CloudSettings=>({server:YANDEX_CALDAV,username:'',secretId:'',enabled:false,calendarUrl:'',taskUrl:'',checked:false,legacySecrets:[]});
export function normalizeCloud(input:unknown):CloudSettings {
 const s=cloudDefaults(),v=object(input);let valid=true;
 try{if(v.server){if(typeof v.server!=='string')throw Error();s.server=trustedTaskUrl(v.server,v.server);}}catch{valid=false;}
 if(typeof v?.username==='string'&&v.username.length<320)s.username=v.username.trim();
 try{for(const k of ['calendarUrl','taskUrl'] as const)if(v[k]){if(typeof v[k]!=='string')throw Error();s[k]=trustedTaskUrl(v[k],s.server);}}catch{valid=false;}
 if(valid&&typeof v?.secretId==='string'&&/^life-planner-cloud-[a-f0-9]{32}$/.test(v.secretId))s.secretId=v.secretId;
 s.legacySecrets=valid&&Array.isArray(v.legacySecrets)?v.legacySecrets.filter((x:unknown):x is string=>typeof x==='string'&&/^life-planner-(yandex|onetask)-[a-f0-9]{32}$/.test(x)):[];
 s.checked=valid&&v?.checked===true;s.enabled=valid&&v?.enabled===true;return s;
}
export function migrateCloud(events:CalendarConnectionSettings,tasks:TaskConnectionSettings):CloudSettings {
 const conflict=!!events.username&&!!tasks.username&&(events.username!==tasks.username||tasks.server!==YANDEX_CALDAV);
 const useTasks=!events.username&&!!tasks.username;
 return normalizeCloud({server:useTasks?tasks.server:YANDEX_CALDAV,username:events.username||tasks.username,calendarUrl:events.calendarUrl,taskUrl:conflict?'':tasks.listUrl,secretId:'',enabled:!conflict&&(events.auto||tasks.enabled),checked:!conflict&&!!(events.calendarUrl||tasks.verifiedListUrl),legacySecrets:[events.secretId,...(!conflict?[tasks.secretId]:[])].filter(Boolean)});
}
/** Shared references only. Device secrets never enter this file. */
export class CloudSettingsFile {
 readonly path='Planner/Data/cloud-connection.json';private source:string|null=null;private loaded=false;
 constructor(private io:FileIO){}
 private readonly historyPath='Planner/Data/cloud-connection-history';
 private async history(){const entries=new Map<string,CloudSnapshot>();for(const path of await this.io.list(this.historyPath)){if(!path.startsWith(this.historyPath+'/')||!path.endsWith('.json'))continue;try{const v=snapshot(parseJSON(await this.io.read(path)??'null'));if(!path.endsWith('/'+v.revision+'.json'))throw Error();entries.set(v.revision,v);}catch{throw Error('Журнал подключения повреждён. Обмен остановлен; исходник сохранён.');}}return entries;}
 async load(fallback:CloudSettings=cloudDefaults()){const raw=await this.io.read(this.path);let settings=fallback,value:CloudDocument|undefined;
  if(raw!==null){try{value=document(parseJSON(raw));settings=normalizeCloud(value.settings);}catch{throw Error('Настройки связи с облаком повреждены. Обмен остановлен; исходник сохранён.');}}
  this.source=raw;this.loaded=true;await this.verify(value);return settings;
 }
 private async verify(value:CloudDocument|undefined){const entries=await this.history();if(!entries.size&&!value?.revision)return;if(!value?.revision||!Array.isArray(value.parents))throw Error('Облачная копия подключения устарела. Обмен остановлен; проверьте учётные данные и подключитесь заново.');const current=snapshot(value),confirmed=entries.get(current.revision);if(confirmed&&canonicalJSON(confirmed)!==canonicalJSON(current))throw Error('Конфликт содержимого подключения. Обмен остановлен; подключитесь заново.');entries.set(current.revision,current);const seen=new Set<string>(),visiting=new Set<string>(),visit=(id:string)=>{if(visiting.has(id))throw Error('Причинный журнал подключения повреждён.');if(seen.has(id))return;const node=entries.get(id);if(!node)throw Error('Подключение ожидает связанные облачные файлы. Обмен пока остановлен.');visiting.add(id);for(const parent of node.parents)visit(parent);visiting.delete(id);seen.add(id);};visit(current.revision);if([...entries.keys()].some(k=>!seen.has(k)))throw Error('Облачные версии подключения конфликтуют. Обмен остановлен; проверьте учётные данные и подключитесь заново.');}
 private async assertBytes(){if(!this.loaded||await this.io.read(this.path)!==this.source)throw Error('Подключение изменилось в хранилище. Новые отправки остановлены; перечитайте настройки.');}
 async assertCurrent(){await this.assertBytes();await this.verify(this.source?document(parseJSON(this.source)):undefined);}
 async save(settings:CloudSettings){await this.assertBytes();await this.io.mkdir('Planner/Data');const entries=await this.history(),revision=crypto.randomUUID(),snapshot={schemaVersion:1,settings:normalizeCloud(settings),revision,parents:[...entries.keys()]};await this.io.mkdir(this.historyPath);const history=this.historyPath+'/'+revision+'.json',raw=JSON.stringify(snapshot,null,2);if(this.io.create){if(!await this.io.create(history,raw))throw Error('Конфликт снимка подключения.');}else await this.io.write(history,raw);if(await this.io.read(history)!==raw)throw Error('Снимок подключения не подтверждён.');await this.assertBytes();if(this.source!==null&&this.io.replace)await this.io.replace(this.path,this.source,raw);else if(this.source===null&&this.io.create){if(!await this.io.create(this.path,raw))throw Error('Подключение изменено другим устройством. Перечитайте настройки.');}else await this.io.write(this.path,raw);if(await this.io.read(this.path)!==raw)throw Error('Сохранение подключения не подтверждено.');this.source=raw;}
}
