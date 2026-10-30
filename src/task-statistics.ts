import type {Task,TaskSnapshot,Period,PeriodType} from './model';
import {PLAN_LEVELS} from './task-planning';import {taskStateBefore,taskCompletions,taskActiveDuring,uniqueTasks} from './task-history';import {completionDate} from './task-completion';import {planDeadline} from './plan-policy';import {period,addDays} from './periods';
export type StatisticsLevel=PeriodType|'all';
export const lowerLevels=(type:PeriodType)=>PLAN_LEVELS.slice(PLAN_LEVELS.indexOf(type)+1).reverse();
export const statisticsLevels=(type:PeriodType)=>[...lowerLevels(type),type];
export function childPeriods(p:Period,type:PeriodType):Period[]{const result:Period[]=[];let q=period(type,p.start);while(q.start<p.end){result.push(q);q=period(type,q.end);}return result;}
export interface TaskStatistics {total:number;done:number;open:number;onTime:number;late:number;noDeadline:number;overdue:number;past:number;tasks:Task[]}
/** Distinct IDs, lower levels only. Explicitly checked future dates count; empty future plans do not. */
export function lowerTaskStatistics(source:Task[],selected:Period,today:string,level:StatisticsLevel='day',areaId?:string,childStart?:string):TaskStatistics {
 return selectedTaskStatistics(source,selected,today,lowerLevels(selected.type).filter(t=>level==='all'||t===level),areaId,childStart,level);
}
/** Current and lower levels chosen explicitly. Counts are distinct task IDs, not work volume. */
export function selectedTaskStatistics(source:Task[],selected:Period,today:string,levels:PeriodType[],areaId?:string,childStart?:string,level:StatisticsLevel='all'):TaskStatistics {
 const allowed=statisticsLevels(selected.type).filter(t=>levels.includes(t)),result:TaskStatistics={total:0,done:0,open:0,onTime:0,late:0,noDeadline:0,overdue:0,past:0,tasks:[]};
 const child=childStart&&level!=='all'?childPeriods(selected,level).find(p=>p.start===childStart):undefined;
 const start=child&&child.start>selected.start?child.start:selected.start,end=child&&child.end<selected.end?child.end:selected.end,observed=end<addDays(today,1)?end:addDays(today,1);
 const matches=(h:TaskSnapshot)=>allowed.includes(h.planPeriod?.type??'day')&&(!areaId||h.areaId===areaId);
 for(const t of uniqueTasks(source)){
  const state=taskStateBefore(t,observed),done=taskCompletions(t,start,end,areaId).filter(matches),s=done[0]??state;if(!s||!matches(s))continue;
  const q=s.planPeriod?period(s.planPeriod.type,s.planPeriod.date):undefined;
  if(q&&s.planPeriod!.type!=='day'&&(q.start>=end||q.end<=start))continue;
  const active=s.planPeriod?.type==='day'||!s.planPeriod?taskActiveDuring(t,start,observed,areaId,true):q!.start<observed&&q!.end>start;
  if(!done.length&&!active)continue;result.total++;const {at,...fields}=s;result.tasks.push({...t,...fields,completedAt:s.completedAt,completedDate:s.completedDate,planPeriod:s.planPeriod,parentId:s.parentId,featured:s.featured});
  if(done.length){result.done++;if(done.some(h=>planDeadline(h)&&completionDate(h)!>planDeadline(h)!))result.late++;else if(done.some(h=>planDeadline(h)))result.onTime++;else result.noDeadline++;}
  if(state&&!state.archived&&matches(state)&&state.status!=='done'&&active){result.open++;const due=planDeadline(state),cutoff=addDays(observed,-1);if(due&&due<cutoff)result.overdue++;else if(!due&&state.plannedDate&&state.plannedDate<cutoff)result.past++;}
 }
 return result;
}
