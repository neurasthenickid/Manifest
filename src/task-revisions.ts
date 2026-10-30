import {object,parseJSON} from './json';
import type {Task} from './model';
import type {FileIO} from './storage';
import {validateRecord} from './domain';
export function canonicalJSON(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonicalJSON).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonicalJSON(v)).join(',')+'}';return JSON.stringify(value);}
export function sameTask(a:Task,b:Task){return canonicalJSON(a)===canonicalJSON(b);}
export function extendsTask(a:Task,b:Task){return a.id===b.id&&a.version>b.version&&a.history.length>=b.history.length&&b.history.every((s,i)=>canonicalJSON(a.history[i])===canonicalJSON(s));}
export async function rememberTask(io:FileIO,root:string,record:Task,recovered=false){
 const dir=`${root}/task-revisions/${record.id}`,raw=canonicalJSON({record,recovered});const key=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(b=>b.toString(16).padStart(2,'0')).join('');await io.mkdir(dir);const path=dir+'/'+key+'.json';const before=await io.read(path);if(before===raw)return;if(before!==null)throw new Error('Конфликт снимков истории.');
 if(io.create){if(!await io.create(path,raw)&&await io.read(path)!==raw)throw new Error('Не удалось сохранить снимок истории.');}else await io.write(path,raw);
 if(await io.read(path)!==raw)throw new Error('Снимок истории не подтверждён.');
}
export async function taskRevisions(io:FileIO,root:string){
 const result=new Map<string,{record:Task;recovered:boolean}[]>();
 for(const path of await io.list(root+'/task-revisions')){
  if(!path.startsWith(root+'/task-revisions/')||!path.endsWith('.json'))continue;
  const raw=await io.read(path);if(!raw)continue;
  try{const data=object(parseJSON(raw));validateRecord(data.record);if(data.record.kind!=='task'||path.split('/').at(-2)!==data.record.id)throw new Error();const values=result.get(data.record.id)??[];if(typeof data.recovered!=='boolean')throw Error();values.push({record:data.record,recovered:data.recovered});result.set(data.record.id,values);}catch{throw new Error('Повреждён журнал истории задач: '+path+'. Обмен остановлен, исходник сохранён.');}
 }
 return result;
}
