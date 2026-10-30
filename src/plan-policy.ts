import type {Task} from './model';
import {period,addDays} from './periods';
/** A daily plan ends on its assigned day; an explicit deadline overrides it. */
export function planDeadline(task:Pick<Task,'planPeriod'|'dueDate'|'plannedDate'>):string|undefined{
 return task.planPeriod&&task.planPeriod.type!=='day'?addDays(period(task.planPeriod.type,task.planPeriod.date).end,-1):task.dueDate??(task.planPeriod?.type==='day'?task.plannedDate??task.planPeriod.date:undefined);
}
