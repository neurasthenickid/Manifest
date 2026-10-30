import test from 'node:test';
import assert from 'node:assert/strict';
import {weeklyCalendarTasks} from '../src/weekly-calendar-tasks';
import {newTask,changeTask} from '../src/domain';
import {planFor} from '../src/task-planning';
import {period} from '../src/periods';
const week=period('week','2026-10-22');
const make=(id:string,date?:string)=>({...newTask({title:id,areaId:'work',plannedDate:date,planPeriod:date?planFor('day',date):planFor('week',week.start)},'2026-10-19T09:00:00+03:00'),id});
const positions=(tasks:ReturnType<typeof make>[],today='2026-10-22')=>[...weeklyCalendarTasks(tasks,week,today).byDay].flatMap(([day,rows])=>rows.map(t=>[t.id,day,t.status]));
test('dated tasks have one existing ID placement; overdue open moves only to arrived date, explicit future stays on its date',()=>{
 const past=make('past','2026-10-20'),future=make('future','2026-10-24'),before=JSON.stringify([past,future]);assert.deepEqual(positions([past,future]),[['past','2026-10-22','todo'],['future','2026-10-24','todo']]);assert.deepEqual(positions([past], '2026-10-20'),[['past','2026-10-20','todo']]);assert.equal(JSON.stringify([past,future]),before);
});
test('whole week plans have no invented day; due date is never substituted for planned day',()=>{
 const weekly=make('week'),dueOnly={...newTask({title:'Due only',areaId:'home',dueDate:'2026-10-23'},'2026-10-19T09:00:00+03:00'),id:'due'};
 const result=weeklyCalendarTasks([weekly,dueOnly],week,'2026-10-22');assert.deepEqual(result.undated.map(t=>t.id),['week']);assert([...result.byDay.values()].every(a=>a.length===0));assert.equal(weekly.plannedDate,undefined);
});
test('completion, cancellation and replanning follow actual task history without duplicates or source mutation',()=>{
 const initial=make('task','2026-10-20'),done=changeTask(initial,{status:'done'},'2026-10-22T10:00:00+03:00','2026-10-22','2026-10-22');assert.deepEqual(positions([done]),[['task','2026-10-22','done']]);const cancelled=changeTask(done,{status:'todo'},'2026-10-22T11:00:00+03:00','2026-10-22','2026-10-22');assert.deepEqual(positions([cancelled]),[['task','2026-10-22','todo']]);const replanned=changeTask(cancelled,{plannedDate:'2026-10-24',planPeriod:planFor('day','2026-10-24')},'2026-10-22T12:00:00+03:00');assert.deepEqual(positions([replanned]),[['task','2026-10-24','todo']]);
});
test('archived tasks and other week plans stay out; stable ID dedup and missing seven columns preserved',()=>{
 const old=make('same','2026-10-20'),current={...old,version:2},archived=changeTask(make('archived','2026-10-20'),{archived:true},'2026-10-20T12:00:00+03:00'),other={...make('other'),planPeriod:planFor('week','2026-10-26')};other.history=other.history.map(h=>({...h,planPeriod:other.planPeriod}));
 const result=weeklyCalendarTasks([old,current,archived,other],week,'2026-10-22');assert.equal(result.byDay.size,7);assert.equal([...result.byDay.values()].flat().length,1);assert.equal([...result.byDay.values()].flat()[0].version,2);assert.equal(result.undated.length,0);
});
