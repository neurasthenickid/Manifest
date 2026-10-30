/** Test-only HTTPS/XML server and native-secret stand-in. Never imported by plugin main. */
import {CloudConnection,CloudAutoSync} from '../src/integrations/cloud-connection';
import type {FileIO} from '../src/storage';
import type {PlannerStore,LifeArea,CalendarEvent} from '../src/model';
import type {PlannerSettings} from '../src/settings';
import type {DavHttp,DavResource} from '../src/integrations/caldav';
import {taskURL} from '../src/integrations/task-sync';
const server='https://cloud.example.test/',eventList=server+'events/',taskList=server+'tasks/';
const esc=(v:string)=>v.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
const prop=(url:string,content:string)=>`<d:response><d:href>${esc(url)}</d:href><d:propstat><d:prop>${content}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const multi=(rows:string)=>({status:207,headers:{},text:`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${rows}</d:multistatus>`});
export function createCloudHarness(io:FileIO,store:PlannerStore,get:()=>PlannerSettings,save:(s:PlannerSettings)=>Promise<void>,areas:()=>LifeArea[],assertCurrent:()=>Promise<void>){
 const key='lp-fixture-cloud-resources',resources=new Map<string,DavResource>(JSON.parse(localStorage.getItem(key)??'[]')),calls:{method:string;url:string}[]=[];let mode='normal',revision=0,release:(()=>void)|undefined;
 const persist=()=>localStorage.setItem(key,JSON.stringify([...resources]));
 const http:DavHttp=async q=>{calls.push({method:q.method,url:q.url});if(mode==='paused')await new Promise<void>(r=>release=r);if(mode==='timeout')return new Promise(()=>{});
  if(q.method==='PROPFIND'){if(q.body?.includes('current-user-principal'))return multi(prop(q.url,'<d:current-user-principal><d:href>/principal/</d:href></d:current-user-principal>'));if(q.body?.includes('calendar-home-set'))return multi(prop(q.url,'<c:calendar-home-set><d:href>/</d:href></c:calendar-home-set>'));
   const calendar=(url:string,kind:string)=>prop(url,`<d:resourcetype><c:calendar/></d:resourcetype><d:displayname>${kind==='VEVENT'?'Мой календарь':'Мои задачи'}</d:displayname><c:supported-calendar-component-set><c:comp name="${kind}"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:all/></d:privilege></d:current-user-privilege-set>`);
   return multi(calendar(eventList,'VEVENT')+(mode==='unsupported'?'':calendar(taskList,'VTODO'))+(mode==='multiple'?calendar(server+'other-events/','VEVENT'):''));}
  if(q.method==='REPORT'){const kind=q.body?.includes('name="VTODO"')?'VTODO':'VEVENT';return multi([...resources.values()].filter(r=>r.url.startsWith(q.url)&&r.data.includes('BEGIN:'+kind)).map(r=>prop(r.url,`<d:getetag>${esc(r.etag)}</d:getetag><c:calendar-data>${esc(r.data)}</c:calendar-data>`)).join(''));}
  if(q.method==='GET'){const r=resources.get(q.url);return r?{status:200,headers:{etag:r.etag},text:r.data}:{status:404,headers:{},text:''};}
  if(q.method==='PUT'){const old=resources.get(q.url);if(q.headers['If-Match']?q.headers['If-Match']!==old?.etag:!!old)return{status:412,headers:{},text:''};resources.set(q.url,{url:q.url,data:q.body!,etag:'"fixture-'+Date.now()+'-'+(++revision)+'"'});persist();return{status:201,headers:{},text:''};}
  if(q.method==='DELETE'){resources.delete(q.url);persist();return{status:204,headers:{},text:''};}throw Error('Unexpected fixture request');
 };
 // A fixture native adapter remembers IDs, never credential bytes. Actual secrets use app.secretStorage.
 const secrets={getSecret:(id:string)=>JSON.parse(localStorage.getItem('lp-fixture-secret-ids')??'[]').includes(id)?'UI_PRIVATE':null,setSecret:(id:string,value:string)=>{if(value!=='UI_PRIVATE')throw Error('Only fixture password permitted');const ids=JSON.parse(localStorage.getItem('lp-fixture-secret-ids')??'[]');localStorage.setItem('lp-fixture-secret-ids',JSON.stringify([...new Set([...ids,id])]));}};
 const connection=new CloudConnection(()=>get().cloudConnection,c=>save({...get(),cloudConnection:c}),io,store,http,secrets,areas,assertCurrent),auto=new CloudAutoSync(connection,100);
 const unsub=store.subscribe(change=>{if(change?.records.some(r=>r.kind==='event'||r.kind==='task'))auto.trigger();});void connection.restore().then(()=>auto.trigger());
 return{connection,auto,dispose:()=>{unsub();auto.dispose();connection.dispose();},controls:{seedEvent:(record:CalendarEvent)=>store.save(record,0),setMode:(next:string)=>{mode=next;if(next==='normal'){release?.();release=undefined;}},calls:()=>calls,size:()=>resources.size,trigger:()=>auto.trigger(),idle:()=>!connection.busy,complete:(id:string,done:boolean)=>{const r=resources.get(taskURL(taskList,id));if(!r)throw Error('Fixture task missing');r.data=r.data.replace(/STATUS:[^\r\n]+/,'STATUS:'+(done?'COMPLETED':'NEEDS-ACTION')).replace(/PERCENT-COMPLETE:\d+/,'PERCENT-COMPLETE:'+(done?100:0)).replace(/^COMPLETED[^\r\n]*\r?\n/gm,'');if(done)r.data=r.data.replace('END:VTODO','COMPLETED:20261013T083000Z\r\nEND:VTODO');r.etag='"external-'+(++revision)+'"';persist();}}};
}

