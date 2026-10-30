import test from 'node:test';import assert from 'node:assert/strict';
import {newTask,changeTask,validateRecord,base,definitionAt,archiveDefinition,setDefinitionVersion,newCheckin} from '../src/domain';
import {dailyTasks,planFor} from '../src/task-planning';import {selectedTaskStatistics} from '../src/task-statistics';import {taskActivitySummary,planSummary} from '../src/plan-summary';
import {observationWindow,summarize,workoutJournal} from '../src/analytics';import {period} from '../src/periods';import type {Definition} from '../src/model';
const stamp='2026-10-02T22:00:00+03:00';
const yesterday=()=>newTask({title:'Вчерашняя задача',areaId:'work',plannedDate:'2026-10-01',planPeriod:planFor('day','2026-10-01')},stamp,undefined,'2026-10-01');
const program=():Definition=>({...base(),kind:'definition',type:'workout',versions:[{effectiveDate:'2026-10-01',title:'Программа',weekdays:[5],items:[{id:'exercise',title:'Упражнение'}]}]});
test('backdated creation stays in its note and carries forward with unchanged physical timestamp',()=>{
 const t=yesterday();assert.equal(t.createdAt,stamp);assert.equal(t.history[0].at,stamp);assert.equal(dailyTasks([t],'2026-09-30').length,0);
 for(const date of ['2026-10-01','2026-10-02'])assert.equal(dailyTasks([t],date)[0].id,t.id);
 const done=changeTask(t,{status:'done'},stamp,'2026-10-02');assert.equal(dailyTasks([done],'2026-10-01')[0].status,'todo');assert.equal(dailyTasks([done],'2026-10-02')[0].status,'done');assert.equal(dailyTasks([done],'2026-10-03').length,0);
 assert.equal(dailyTasks([changeTask(t,{status:'done'},stamp,'2026-10-01')],'2026-10-01')[0].status,'done');
 const p=period('week','2026-10-02');assert.equal(selectedTaskStatistics([done],p,'2026-10-02',['day']).late,1);assert.equal(taskActivitySummary([done],p,'2026-10-02').late,1);assert.equal(planSummary([done],p,'2026-10-02').late,1);assert.equal(summarize(p,[done],'2026-10-02').tasks.late,1);validateRecord(JSON.parse(JSON.stringify(done)));
});
test('explicit deadline overrides daily plan; legacy unscheduled backlog retains no-deadline meaning',()=>{
 const current=changeTask(yesterday(),{dueDate:'2026-10-05'},stamp),finished=changeTask(current,{status:'done'},stamp,'2026-10-02');const p=period('week','2026-10-02');
 assert.equal(selectedTaskStatistics([finished],p,'2026-10-02',['day']).onTime,1);
 const legacy=changeTask(newTask({title:'Прежняя без срока',areaId:'work',plannedDate:'2026-10-01'},'2026-10-01T10:00:00+03:00'),{status:'done'},stamp);
 assert.equal(taskActivitySummary([legacy],p,'2026-10-02').noDeadline,1);
});
test('task archive hides active projection from selected date, restores and keeps previous note and completion statistics',()=>{
 const t=yesterday(),archived=changeTask(t,{archived:true},stamp,undefined,'2026-10-02');assert.equal(dailyTasks([archived],'2026-10-01').length,1);assert.equal(dailyTasks([archived],'2026-10-02').length,0);
 const restored=changeTask(archived,{archived:false},'2026-10-03T10:00:00+03:00',undefined,'2026-10-03');assert.equal(dailyTasks([restored],'2026-10-03').length,1);assert.equal(dailyTasks([restored],'2026-10-02').length,0);
 const done=changeTask(t,{status:'done'},stamp,'2026-10-02'),removed=changeTask(done,{archived:true},'2026-10-03T10:00:00+03:00',undefined,'2026-10-03');assert.equal(selectedTaskStatistics([removed],period('week','2026-10-02'),'2026-10-03',['day']).done,1);assert.equal(dailyTasks([removed],'2026-10-02')[0].status,'done');validateRecord(JSON.parse(JSON.stringify(restored)));
});
test('definition archive overrides later schedule versions until explicit restore and preserves confirmed journal',()=>{
 const d=program(),entry={...newCheckin(d,'2026-10-02'),finalized:true,states:{exercise:true}},future=setDefinitionVersion(d,{...d.versions[0],effectiveDate:'2026-10-04',title:'Будущая',weekdays:[1,2,3,4,5,6,7]}),removed=archiveDefinition(future,'2026-10-02',true);
 assert.equal(definitionAt(removed,'2026-10-01')?.weekdays.length,1);assert.equal(definitionAt(removed,'2026-10-04')?.weekdays.length,0);const restored=archiveDefinition(removed,'2026-10-05',false);assert.equal(definitionAt(restored,'2026-10-05')?.weekdays.length,7);
 assert.equal(workoutJournal(period('week','2026-10-02'),[removed,entry],'2026-10-02')[0].title,'Программа');assert.deepEqual(entry.items,[{id:'exercise',title:'Упражнение'}]);validateRecord(JSON.parse(JSON.stringify(restored)));
});
test('independent programs share a start date; same-day and earlier edits retain later schedule and saved snapshots',()=>{
 const a=program(),b=program();assert.notEqual(a.id,b.id);validateRecord(a);validateRecord(b);const entry=newCheckin(a,'2026-10-02');
 const later=setDefinitionVersion(a,{...a.versions[0],effectiveDate:'2026-10-04',title:'Будущая'}),edited=setDefinitionVersion(later,{...a.versions[0],title:'Исправлена'}),earlier=setDefinitionVersion(edited,{...a.versions[0],effectiveDate:'2026-09-30'});
 assert.equal(edited.versions.length,2);assert.equal(earlier.versions.length,3);assert.equal(definitionAt(earlier,'2026-10-01')?.title,'Исправлена');assert.equal(definitionAt(earlier,'2026-10-04')?.title,'Будущая');assert.equal(entry.title,'Программа');assert.equal(edited.versions[0].items[0].id,entry.items[0].id);
});
test('rating denominator reports elapsed and complete calendar days, including leap and future years',()=>{
 assert.deepEqual(observationWindow(period('year','2026-10-02'),'2026-10-02'),{elapsed:275,total:365});assert.deepEqual(observationWindow(period('year','2024-01-01'),'2024-12-31'),{elapsed:366,total:366});assert.deepEqual(observationWindow(period('year','2027-01-01'),'2026-10-02'),{elapsed:0,total:365});
});
