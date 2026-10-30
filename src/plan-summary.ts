import type { Period,Task,TaskSnapshot } from './model';
import {completionDate,effectiveTaskHistory} from './task-completion';
import {planDeadline} from './plan-policy';
import { addDays } from './periods';
import {taskActiveDuring,taskStateBefore,taskCompletions,uniqueTasks} from './task-history';
export interface PlanSummary{total:number;done:number;onTime:number;late:number;noDeadline:number;open:number;backlog:number}
/** One task cohort, observed at historical cutoff. Completion-period throughput is separate. */
export function planSummary(tasks:Task[],selected:Period,today:string,areaId?:string):PlanSummary {
 const result:PlanSummary={total:0,done:0,onTime:0,late:0,noDeadline:0,open:0,backlog:0},end=selected.end<addDays(today,1)?selected.end:addDays(today,1);
 const unique=new Map<string,Task>();for(const task of tasks)if(!unique.has(task.id)||unique.get(task.id)!.version<task.version)unique.set(task.id,task);
 for(const task of unique.values()){
  const history=effectiveTaskHistory(task).filter(h=>h.date<end).map(h=>h.snapshot);
  const state=history.at(-1);if(!state||(areaId&&state.areaId!==areaId))continue;
  const anchor=state.plannedDate??state.dueDate;
  if(!anchor){if(state.status!=='done'&&!state.archived)result.backlog++;continue;}
  if(anchor<selected.start||anchor>=selected.end)continue;
  result.total++;
  if(state.status!=='done'){if(!state.archived)result.open++;continue;}
  result.done++;
  const completion=state.completedAt;
  // Later edits while done must not retroactively change the completion deadline.
  const snap:TaskSnapshot=history.find(h=>h.status==='done'&&h.completedAt===completion)??state;
  const deadline=planDeadline(snap);if(!deadline)result.noDeadline++;else if(completion&&completionDate(snap)!>deadline)result.late++;else result.onTime++;
 }return result;
}
/** Activity of actual tasks in the period, including tasks with no plan/deadline. */
export function taskActivitySummary(tasks:Task[],selected:Period,today:string,areaId?:string,dailyOnly=false):PlanSummary{
 const result:PlanSummary={total:0,done:0,onTime:0,late:0,noDeadline:0,open:0,backlog:0},end=selected.end<addDays(today,1)?selected.end:addDays(today,1);
 for(const task of uniqueTasks(tasks)){
  if(!taskActiveDuring(task,selected.start,end,areaId,dailyOnly))continue;result.total++;
  const state=taskStateBefore(task,end);if(state&&!state.archived&&state.status!=='done'&&(!areaId||state.areaId===areaId)&&(!dailyOnly||!state.planPeriod||state.planPeriod.type==='day'&&state.planPeriod.date<end)){result.open++;if(!state.plannedDate&&!state.dueDate)result.backlog++;}
  const completions=taskCompletions(task,selected.start,end,areaId).filter(h=>!dailyOnly||!h.planPeriod||h.planPeriod.type==='day');if(!completions.length)continue;result.done++;
  if(completions.some(h=>planDeadline(h)&&completionDate(h)!>planDeadline(h)!))result.late++;
  else if(completions.some(h=>planDeadline(h)))result.onTime++;else result.noDeadline++;
 }return result;
}
