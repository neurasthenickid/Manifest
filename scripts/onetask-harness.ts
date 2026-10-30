/** Isolated development transport. Never imported into the plugin entry point. */
import {TaskConnection} from '../src/integrations/task-connection';
import {readTodo} from '../src/integrations/vtodo';
import {taskURL} from '../src/integrations/task-sync';
import type {FileIO} from '../src/storage';
import type {PlannerStore,LifeArea} from '../src/model';
import type {PlannerSettings} from '../src/settings';
import type {DavResponse,DavResource,DavHttp} from '../src/integrations/caldav';
const server='https://tasks.example.test/',list=server+'lists/life/';
const xml=(v:string)=>v.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
const multistatus=(rows:string)=>({status:207,headers:{},text:`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${rows}</d:multistatus>`});
const prop=(url:string,properties:string)=>`<d:response><d:href>${xml(url)}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
export function createOneTaskHarness(io:FileIO,store:PlannerStore,get:()=>PlannerSettings,save:(s:PlannerSettings)=>Promise<void>,areas:()=>LifeArea[]){
 const resources=new Map<string,DavResource>(),calls:{method:string;url:string}[]=[];let mode='normal',revision=0,release:(()=>void)|undefined;
 const http:DavHttp=async q=>{calls.push({method:q.method,url:q.url});if(mode==='paused'){await new Promise<void>(r=>release=r);}if(mode==='timeout')return new Promise<DavResponse>(()=>{});
  if(q.method==='PROPFIND'){
   if(q.body?.includes('current-user-principal'))return multistatus(prop(q.url,'<d:current-user-principal><d:href>/principals/test/</d:href></d:current-user-principal>'));
   if(q.body?.includes('calendar-home-set'))return multistatus(prop(q.url,'<c:calendar-home-set><d:href>/lists/</d:href></c:calendar-home-set>'));
   return multistatus(prop(list,`<d:resourcetype><c:calendar/></d:resourcetype><d:displayname>Life Planner — тест</d:displayname><c:supported-calendar-component-set><c:comp name="${mode==='unsupported'?'VEVENT':'VTODO'}"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:all/></d:privilege></d:current-user-privilege-set>`));
  }
  if(q.method==='REPORT'){if(!q.body?.includes('name="VTODO"'))throw new Error('Not a VTODO query');return multistatus([...resources.values()].map(r=>prop(r.url,`<d:getetag>${xml(r.etag)}</d:getetag><c:calendar-data>${xml(r.data)}</c:calendar-data>`)).join(''));}
  if(q.method==='GET'){const r=resources.get(q.url);return r?{status:200,headers:{etag:r.etag},text:r.data}:{status:404,headers:{},text:''};}
  if(q.method==='PUT'){const old=resources.get(q.url);if(q.headers['If-Match']?q.headers['If-Match']!==old?.etag:!!old)return{status:412,headers:{},text:''};resources.set(q.url,{url:q.url,data:q.body!,etag:'"'+(++revision)+'"'});return{status:201,headers:{},text:''};}
  throw new Error('Unexpected fixture request');
 };
 const connection=new TaskConnection(()=>get().taskConnection,c=>save({...get(),taskConnection:c}),io,store,http,undefined,areas);
 return{connection,controls:{setMode:(next:string)=>{mode=next;if(next==='normal'){release?.();release=undefined;}},calls:()=>calls,size:()=>resources.size,complete:(id:string,done:boolean)=>{const r=resources.get(taskURL(list,id));if(!r)throw new Error('Fixture task missing');r.data=r.data.replace(/STATUS:[^\r\n]+/,'STATUS:'+(done?'COMPLETED':'NEEDS-ACTION')).replace(/PERCENT-COMPLETE:\d+/,'PERCENT-COMPLETE:'+(done?100:0)).replace(/^COMPLETED[^\r\n]*\r?\n/gm,'');if(done)r.data=r.data.replace('END:VTODO','COMPLETED:20261013T083000Z\r\nEND:VTODO');r.etag='"external-'+(++revision)+'"';return readTodo(r.data);}}};
}

