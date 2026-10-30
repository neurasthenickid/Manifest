import type {Period,Task} from './model';
import {addDays,dates} from './periods';
import {dailyTasks,ownPlanTasks} from './task-planning';
import {uniqueTasks} from './task-history';
import {completionDate} from './task-completion';

/** Display projection only. One placement per ID; no changes to plans, due dates or history. */
export function weeklyCalendarTasks(source:Task[],week:Period,asOf:string){
 if(week.type!=='week')throw new Error('Нужен недельный период.');
 const days=dates(week.start,week.end),byDay=new Map(days.map(date=>[date,[] as Task[]])),placed=new Map<string,{date:string;task:Task}>();
 const assigned=(t:Task)=>t.plannedDate??(t.planPeriod?.type==='day'?t.planPeriod.date:undefined);
 const daily=uniqueTasks(source).filter(t=>assigned(t)!==undefined);
 for(const date of days)for(const task of dailyTasks(daily,date,asOf)){
  const plan=assigned(task);if(!plan)continue;
  if(task.status!=='done'&&(plan>date||date>asOf&&date!==plan))continue;
  // Last elapsed placement wins: an unfinished task is carried only to an arrived day.
  placed.set(task.id,{date,task});
 }
 const weekly=ownPlanTasks(source,week,asOf),undated=weekly.filter(t=>!t.plannedDate);
 for(const task of weekly.filter(t=>!!t.plannedDate)){
  const date=task.status==='done'?completionDate(task):task.plannedDate!<asOf?(asOf<week.end?asOf:addDays(week.end,-1)):task.plannedDate;
  if(date&&byDay.has(date))placed.set(task.id,{date,task});
 }
 for(const {date,task}of placed.values())byDay.get(date)!.push(task);
 return {byDay,undated};
}
