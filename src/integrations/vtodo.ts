import ICAL from 'ical.js';
import type {Task,LifeArea} from '../model';
import {wallInstant,zonedStamp} from '../event-time';
export class UnsupportedTodo extends Error {}
export interface RemoteTodo {uid:string;done:boolean;actionAt?:string;title:string;description:string;due:string;completion:string;fields:string}
function parse(raw:string){
 if(raw.length>2000000)throw new UnsupportedTodo('Слишком большая внешняя задача.');
 let cal:ICAL.Component;try{cal=new ICAL.Component(ICAL.parse(raw) as unknown[]);}catch{throw new UnsupportedTodo('Повреждённая внешняя задача; исходник сохранён.');}
 const todos=cal.getAllSubcomponents('vtodo');if(cal.name!=='vcalendar'||todos.length!==1||cal.getAllSubcomponents('vevent').length)throw new UnsupportedTodo('Нужна отдельная запись VTODO, без событий.');
 const todo=todos[0];for(const name of ['rrule','rdate','exdate','recurrence-id','attendee','organizer'])if(todo.hasProperty(name))throw new UnsupportedTodo('Повторяющиеся задачи и назначения участникам пока не поддерживаются.');
 if(todo.getAllProperties('uid').length!==1)throw new UnsupportedTodo('Нет единственного UID задачи.');
 return{cal,todo};
}
export function readTodo(raw:string):RemoteTodo {
 const{todo}=parse(raw),uid=String(todo.getFirstPropertyValue('uid')??'');if(!uid||uid.length>400)throw new UnsupportedTodo('Некорректный UID задачи.');
 for(const name of ['status','completed','percent-complete'])if(todo.getAllProperties(name).length>1)throw new UnsupportedTodo('Неоднозначный статус внешней задачи.');
 const completed=todo.getFirstProperty('completed'),percent=Number(todo.getFirstPropertyValue('percent-complete')??0),status=String(todo.getFirstPropertyValue('status')??(completed||percent===100?'COMPLETED':'NEEDS-ACTION'));if(!['NEEDS-ACTION','IN-PROCESS','COMPLETED'].includes(status)||!Number.isInteger(percent)||percent<0||percent>100)throw new UnsupportedTodo('Внешний статус задачи не поддерживается.');
 const done=status==='COMPLETED';if(!done&&(completed||percent===100))throw new UnsupportedTodo('Противоречащие признаки выполнения на сервере.');let actionAt:string|undefined;
 if(done&&completed){try{const time=completed.getFirstValue() as ICAL.Time;if(time.isDate)throw new Error();const stamp=time.toString(),zone=stamp.endsWith('Z')?'UTC':String(completed.getParameter('tzid')??'');if(zone){const wall=stamp.replace(/Z$/,''),instant=wallInstant(wall,zone);if(zonedStamp(instant,zone)!==wall||zone!=='UTC'&&[-7200000,-3600000,-1800000,1800000,3600000,7200000].some(delta=>zonedStamp(instant+delta,zone)===wall))throw new Error();actionAt=new Date(instant).toISOString();}}catch{throw new UnsupportedTodo('Некорректное или неоднозначное время COMPLETED.');}}
 const title=String(todo.getFirstPropertyValue('summary')??''),description=String(todo.getFirstPropertyValue('description')??''),due=String(todo.getFirstPropertyValue('due')??'');
 return{uid,done,actionAt,title,description,due,completion:JSON.stringify([done,actionAt??null]),fields:JSON.stringify([title,description,due])};
}
export function todoDescription(task:Task,area:Pick<LifeArea,'title'>){return[task.description??'',`Сфера: ${area.title}`,task.plannedDate?'Плановый день: '+task.plannedDate:'',task.planPeriod?'Плановый период: '+task.planPeriod.type+' '+task.planPeriod.date:''].filter(Boolean).join('\n');}
export function todoFields(task:Task,area:Pick<LifeArea,'title'>){return JSON.stringify([task.title,todoDescription(task,area),task.dueDate??'']);}
export function writeTodo(task:Task,uid:string,area:Pick<LifeArea,'title'>,raw?:string){
 const{cal,todo}=raw?parse(raw):(()=>{const cal=new ICAL.Component('vcalendar'),todo=new ICAL.Component('vtodo');cal.addSubcomponent(todo);cal.updatePropertyWithValue('version','2.0');cal.updatePropertyWithValue('prodid','-//Life Planner//Tasks//RU');return{cal,todo};})();
 if(raw&&readTodo(raw).uid!==uid)throw new Error('UID задачи изменился.');
 todo.updatePropertyWithValue('uid',uid);todo.updatePropertyWithValue('summary',task.title);todo.updatePropertyWithValue('description',todoDescription(task,area));
 todo.removeAllProperties('dtstart');todo.removeAllProperties('due');todo.removeAllProperties('duration');if(task.dueDate){const p=new ICAL.Property('due',todo);p.setValue(ICAL.Time.fromString(task.dueDate,p));todo.addProperty(p);}
 todo.updatePropertyWithValue('status',task.status==='done'?'COMPLETED':task.status==='doing'?'IN-PROCESS':'NEEDS-ACTION');todo.updatePropertyWithValue('percent-complete',task.status==='done'?100:0);todo.removeAllProperties('completed');
 if(task.status==='done'){const instant=task.externalStatus?.actionAt??(task.externalStatus?.unknownTime?undefined:task.completedAt);if(instant)todo.updatePropertyWithValue('completed',ICAL.Time.fromJSDate(new Date(instant),true));}
 todo.updatePropertyWithValue('dtstamp',ICAL.Time.fromJSDate(new Date(),true));todo.updatePropertyWithValue('last-modified',ICAL.Time.fromJSDate(new Date(),true));return cal.toString();
}
