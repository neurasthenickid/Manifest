import type {Task,TaskSnapshot,Period} from './model';
import {addDays,assertLocalDate} from './periods';
import {completionDate,effectiveTaskHistory} from './task-completion';
export function taskStateBefore(task:Task,end:string){return effectiveTaskHistory(task).filter(h=>h.date<end).at(-1)?.snapshot;}
/** Display projection only: mutations must use the canonical record, never this snapshot. */
export function taskForDay(task:Task,date:string):Task|undefined {
 assertLocalDate(date);const state=taskStateBefore(task,addDays(date,1));
 if(!state||state.archived||state.status==='done'&&completionDate(state)!==date)return;
 const {at,...fields}=state;return{...task,...fields,completedAt:state.completedAt,completedDate:state.completedDate,planPeriod:state.planPeriod,parentId:state.parentId,featured:state.featured};
}
export function taskActiveDuring(task:Task,start:string,end:string,areaId?:string,dailyOnly=false):boolean {
 if(end<=start)return false;
 const history=effectiveTaskHistory(task);return history.some(({snapshot:h,date:created},i)=>{
  if(h.archived)return false;
  if(areaId&&h.areaId!==areaId)return false;
  if(dailyOnly&&h.planPeriod&&h.planPeriod.type!=='day')return false;
  const from=dailyOnly&&h.status!=='done'&&h.planPeriod?.type==='day'&&h.planPeriod.date>created?h.planPeriod.date:created,next=history[i+1],until=next?addDays(next.date,1):end;
  const stop=h.status==='done'&&h.completedAt?addDays(completionDate(h)!,1):until;
  const to=stop<until?stop:until;return from<end&&to>start&&to>from;
 });
}
export function taskForPeriod(task:Task,p:Period,today:string,dailyOnly=false):Task|undefined {
 const end=p.end<addDays(today,1)?p.end:addDays(today,1),state=taskStateBefore(task,end);
 if(!state||!taskActiveDuring(task,p.start,end,undefined,dailyOnly))return;
 const {at,...fields}=state;return{...task,...fields,completedAt:state.completedAt,completedDate:state.completedDate,planPeriod:state.planPeriod,parentId:state.parentId,featured:state.featured};
}
export function taskCompletions(task:Task,start:string,end:string,areaId?:string):TaskSnapshot[] {
 return effectiveTaskHistory(task).filter(({snapshot:h,index})=>task.history[index].status==='done'&&task.history[index-1]?.status!=='done'&&completionDate(h)!>=start&&completionDate(h)!<end&&(!areaId||h.areaId===areaId)).map(e=>e.snapshot);
}
export function uniqueTasks(tasks:Task[]):Task[]{const map=new Map<string,Task>();for(const t of tasks)if(!map.has(t.id)||map.get(t.id)!.version<t.version)map.set(t.id,t);return [...map.values()];}
