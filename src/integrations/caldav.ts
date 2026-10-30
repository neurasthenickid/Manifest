import {startTimeout,stopTimeout} from '../timers';
export const YANDEX_CALDAV='https://caldav.yandex.ru/';
export interface DavResponse {status:number;headers:Record<string,string>;text:string}
export type DavHttp=(request:{url:string;method:string;headers:Record<string,string>;body?:string})=>Promise<DavResponse>;
export interface DavCalendar {url:string;title:string;components:string[];writable:boolean}
export interface DavResource {url:string;etag:string;data:string}
interface DavEntry {url:string;status:number;props:Element[]}
const DAV='DAV:',CAL='urn:ietf:params:xml:ns:caldav';
function direct(parent:Element,ns:string,name:string){return [...parent.children].filter(e=>e.namespaceURI===ns&&e.localName===name);}
function first(props:Element[],ns:string,name:string){return props.find(p=>p.namespaceURI===ns&&p.localName===name);}
function status(text:string|null){const m=/^HTTP\/\S+\s+(\d{3})(?:\s|$)/.exec(text?.trim()??'');if(!m)throw new Error('Неверный статус ответа календаря.');return Number(m[1]);}
/** No recovery from malformed XML: a partial list must never imply deletion. */
export function readDav(text:string):DavEntry[]{
 if(text.length>30_000_000||/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('Недопустимый ответ календаря.');
 const doc=new DOMParser().parseFromString(text,'application/xml');
 if(doc.getElementsByTagName('parsererror').length||doc.documentElement.namespaceURI!==DAV||doc.documentElement.localName!=='multistatus')throw new Error('Сервер вернул неверный XML календаря.');
 return direct(doc.documentElement,DAV,'response').map(r=>{
  const url=direct(r,DAV,'href')[0]?.textContent?.trim();if(!url)throw new Error('Нет адреса календарного ресурса.');
  const props:Element[]=[];let code=direct(r,DAV,'status')[0]?status(direct(r,DAV,'status')[0].textContent):200;
  for(const p of direct(r,DAV,'propstat')){const s=status(direct(p,DAV,'status')[0]?.textContent??null);if(s===200){const prop=direct(p,DAV,'prop')[0];if(!prop)throw new Error('Нет свойств календаря.');props.push(...prop.children);}else if(s!==404)code=s;}
  return{url,status:code,props};
 });
}
export function trustedDavUrl(href:string,base=YANDEX_CALDAV){
 const url=new URL(href,base);if(url.origin!==new URL(YANDEX_CALDAV).origin||url.username||url.password||url.hash||url.search)throw new Error('Сервер вернул чужой адрес: подключение остановлено.');return url.href;
}
/** The user chooses the HTTPS origin; discovered hrefs cannot move credentials elsewhere. */
export function trustedTaskUrl(href:string,base:string){const origin=new URL(base),url=new URL(href,base);if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||url.origin!==origin.origin||url.username||url.password||url.search||url.hash)throw new Error('Нужен адрес HTTPS того же сервера без пароля в URL.');return url.href;}
export class DavTimeout extends Error {constructor(){super('Сервер не ответил вовремя. Повторите синхронизацию; результат отправки будет проверен по прежнему UID.');}}
export class DavConflict extends Error {constructor(){super('Событие изменилось на сервере. Нужен выбор версии.');}}
export class CaldavClient {
 constructor(private http:DavHttp,private username:string,private password:string,private server=YANDEX_CALDAV,private component:'VEVENT'|'VTODO'='VEVENT',private timeoutMs=30000){if(!username.trim()||!password)throw new Error('Введите логин и пароль приложения.');trustedTaskUrl(server,server);}
 private url(href:string){return trustedTaskUrl(href,this.server);}
 private async request(url:string,method:string,body?:string,extra:Record<string,string>={}){
  const bytes=new TextEncoder().encode(this.username+':'+this.password);let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
  let r:DavResponse,timer:ReturnType<typeof startTimeout>|undefined;try{r=await Promise.race([this.http({url:this.url(url),method,body,headers:{Authorization:'Basic '+btoa(binary),...extra}}),new Promise<never>((_,reject)=>{timer=startTimeout(()=>reject(new DavTimeout()),this.timeoutMs);})]);}catch(e){if(e instanceof DavTimeout)throw e;throw new Error('Не удалось связаться с сервером. Проверьте интернет и повторите.');}finally{stopTimeout(timer);}
  if(r.status===401||r.status===403)throw new Error('Сервер отказал в доступе. Проверьте логин, пароль приложения и права списка.');
  if(r.status===412)throw new DavConflict();return r;
 }
 private async propfind(url:string,properties:string,depth='0'){
  const r=await this.request(url,'PROPFIND',`<d:propfind xmlns:d="DAV:" xmlns:c="${CAL}"><d:prop>${properties}</d:prop></d:propfind>`,{Depth:depth,'Content-Type':'application/xml; charset=utf-8'});
  if(r.status!==207)throw new Error('Сервер не вернул список календарей (HTTP '+r.status+').');return readDav(r.text);
 }
 async discover():Promise<DavCalendar[]>{
  const root=await this.propfind(this.server,'<d:current-user-principal/>');
  const principal=first(root[0]?.props??[],DAV,'current-user-principal')?.getElementsByTagNameNS(DAV,'href')[0]?.textContent;
  if(!principal)throw new Error('Сервер не сообщил адрес аккаунта.');
  const user=await this.propfind(this.url(principal),'<c:calendar-home-set/>');
  const home=first(user[0]?.props??[],CAL,'calendar-home-set')?.getElementsByTagNameNS(DAV,'href')[0]?.textContent;
  if(!home)throw new Error('Сервер не сообщил папку календарей.');
  const rows=await this.propfind(this.url(home),'<d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><d:current-user-privilege-set/>','1');
  return rows.filter(r=>r.status===200&&first(r.props,DAV,'resourcetype')?.getElementsByTagNameNS(CAL,'calendar').length).map(r=>{
   const rights=first(r.props,DAV,'current-user-privilege-set');const names=[...rights?.getElementsByTagNameNS(DAV,'privilege')??[]].flatMap(p=>[...p.children].map(c=>c.localName));
   return{url:this.url(r.url),title:first(r.props,DAV,'displayname')?.textContent?.trim()||'Календарь',components:[...first(r.props,CAL,'supported-calendar-component-set')?.getElementsByTagNameNS(CAL,'comp')??[]].map(c=>c.getAttribute('name')??''),writable:names.includes('all')||names.includes('write')||names.includes('write-content')&&names.includes('bind')&&names.includes('unbind')};
  });
 }
 async list(calendar:string):Promise<DavResource[]>{
  const r=await this.request(calendar,'REPORT',`<c:calendar-query xmlns:d="DAV:" xmlns:c="${CAL}"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="${this.component}"/></c:comp-filter></c:filter></c:calendar-query>`,{Depth:'1','Content-Type':'application/xml; charset=utf-8'});
  if(r.status!==207)throw new Error('Не удалось прочитать события (HTTP '+r.status+').');
  const prefix=this.url(calendar).replace(/\/?$/,'/');return readDav(r.text).map(row=>{const etag=first(row.props,DAV,'getetag')?.textContent,data=first(row.props,CAL,'calendar-data')?.textContent,url=this.url(row.url);if(row.status!==200||!etag||!data||!url.startsWith(prefix))throw new Error('Неполный список событий. Обмен остановлен.');return{url,etag,data};});
 }
 async get(url:string):Promise<DavResource|null>{const r=await this.request(url,'GET');if(r.status===404)return null;if(r.status!==200)throw new Error('Не удалось прочитать событие (HTTP '+r.status+').');const etag=Object.entries(r.headers).find(([k])=>k.toLowerCase()==='etag')?.[1];if(!etag)throw new Error('Сервер не сообщил версию события.');return{url:this.url(url),etag,data:r.text};}
 async put(url:string,data:string,etag?:string){const r=await this.request(url,'PUT',data,{'Content-Type':'text/calendar; charset=utf-8',...(etag?{'If-Match':etag}:{'If-None-Match':'*'})});if(![200,201,204].includes(r.status))throw new Error('Не удалось отправить событие (HTTP '+r.status+').');const saved=await this.get(url);if(!saved)throw new Error('Отправка не подтверждена. Повторите синхронизацию.');return saved;}
 async remove(url:string,etag:string){const r=await this.request(url,'DELETE',undefined,{'If-Match':etag});if(![200,204,404].includes(r.status))throw new Error('Не удалось удалить событие (HTTP '+r.status+').');}
}
