import type {Task,TaskPlan,Period,PeriodType} from './model';
import {completionDate} from './task-completion';
import {period,addDays} from './periods';
import {taskForDay,taskStateBefore,uniqueTasks} from './task-history';
export const PLAN_LEVELS:PeriodType[]=['year','quarter','month','week','day'];
export function nextPlan(type:PeriodType){return PLAN_LEVELS[PLAN_LEVELS.indexOf(type)+1];}
export function planFor(type:PeriodType,date:string):TaskPlan{return{type,date:period(type,date).start};}
export function validatePlan(plan:TaskPlan){if(!plan||!PLAN_LEVELS.includes(plan.type)||period(plan.type,plan.date).start!==plan.date)throw new Error('Некорректный плановый период.');}
export function validateTaskLinks(task:Task,tasks:Task[]):string[]{
 const map=new Map(tasks.map(t=>[t.id,t]));map.set(task.id,task);const deps=new Set<string>();
 for(const current of [task,...[...map.values()].filter(t=>t.parentId===task.id&&t.id!==task.id)]){
  const seen=new Set([current.id]);let child=current;
  while(child.parentId){const parent=map.get(child.parentId);if(!parent)throw new Error('Родительская задача не найдена.');if(seen.has(parent.id))throw new Error('Задача не может ссылаться на себя или образовывать цикл.');seen.add(parent.id);
   if(!child.planPeriod||!parent.planPeriod||nextPlan(parent.planPeriod.type)!==child.planPeriod.type)throw new Error('Шаг должен принадлежать следующему уровню плана родителя.');
   const a=period(child.planPeriod.type,child.planPeriod.date),b=period(parent.planPeriod.type,parent.planPeriod.date);if(a.start>=b.end||a.end<=b.start)throw new Error('Период шага должен пересекаться с периодом родителя.');if(current.id===task.id||parent.id===task.id){deps.add(parent.id);deps.add(child.id);}child=parent;
  }
 }deps.delete(task.id);return [...deps];
}
export function isDailyTask(t:Task){return !t.planPeriod||t.planPeriod.type==='day';}
/** asOf is the real current day; callers rendering a future note must pass it. */
export function dailyTasks(tasks:Task[],date:string,asOf=date):Task[]{return uniqueTasks(tasks).map(t=>taskForDay(t,date)).filter((t):t is Task=>{
 if(!t||!isDailyTask(t)||t.planPeriod&&t.planPeriod.date>date&&t.status!=='done')return false;
 if(t.status==='done')return completionDate(t)===date;
 const assigned=t.plannedDate??t.planPeriod?.date??t.dueDate??t.createdDate??t.createdAt.slice(0,10);
 return date<=asOf||assigned>=date;
});}
export function ownPlanTasks(tasks:Task[],p:Period,today:string):Task[]{
 if(p.type==='day')return dailyTasks(tasks,p.start,today);
 const end=p.end<addDays(today,1)?p.end:addDays(today,1);
 return uniqueTasks(tasks).flatMap(t=>{const s=taskStateBefore(t,end);if(!s||s.archived||s.planPeriod?.type!==p.type||s.planPeriod.date!==p.start)return[];const{at,...fields}=s;return[{...t,...fields,planPeriod:s.planPeriod,parentId:s.parentId,completedAt:s.completedAt,completedDate:s.completedDate}];});
}
export function parentPlanTasks(tasks:Task[],p:Period,today:string):Task[]{
 const type=PLAN_LEVELS[PLAN_LEVELS.indexOf(p.type)-1];if(!type)return[];const end=p.end<addDays(today,1)?p.end:addDays(today,1);
 return uniqueTasks(tasks).flatMap(t=>{const s=taskStateBefore(t,end);if(s?.archived||s?.planPeriod?.type!==type)return[];const q=period(type,s.planPeriod.date);if(q.end<=p.start||q.start>=p.end)return[];const{at,...fields}=s;return[{...t,...fields,planPeriod:s.planPeriod,parentId:s.parentId,completedAt:s.completedAt,completedDate:s.completedDate}];});
}
