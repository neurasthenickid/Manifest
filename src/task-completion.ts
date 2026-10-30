import type {Task,TaskSnapshot} from './model';
/** The note's accounting date is distinct from the physical write timestamp. */
export function completionDate(task:Pick<TaskSnapshot,'completedAt'|'completedDate'>){return task.completedDate??task.completedAt?.slice(0,10);}
/** A scheduled completion cancelled before its assigned day has no execution. */
export function effectiveTaskHistory(task:Task){const entries=task.history.flatMap((snapshot,index)=>{
 if(snapshot.status==='done'){const date=completionDate(snapshot);const cancelled=task.history.slice(index+1).some(h=>h.status!=='done'&&(h.effectiveDate? h.effectiveDate===date:h.at.slice(0,10)<date!));if(cancelled)return[];}
 const firstDone=snapshot.status==='done'&&task.history[index-1]?.status!=='done';
 const date=snapshot.effectiveDate??(snapshot.status==='done'&&snapshot.completedDate?(firstDone?snapshot.completedDate:snapshot.at.slice(0,10)>snapshot.completedDate?snapshot.at.slice(0,10):snapshot.completedDate):index===0?task.createdDate??snapshot.at.slice(0,10):snapshot.at.slice(0,10));
 return[{snapshot,index,date}];
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.index-b.index);
 let state:TaskSnapshot|undefined;
 return entries.map(entry=>{
  const original=task.history[entry.index],previous=task.history[entry.index-1];
  // A text/deadline edit is not a new status transition after a backdated check.
  const explicitStatus=original.effectiveDate!==undefined&&previous?.archived===original.archived;
  const snapshot=state&&previous&&previous.status===original.status&&!explicitStatus?{...entry.snapshot,status:state.status,completedAt:state.completedAt,completedDate:state.completedDate}:entry.snapshot;
  state=snapshot;return{...entry,snapshot};
 });}
