import test from 'node:test';
import assert from 'node:assert/strict';
import {newTask,changeTask} from '../src/domain';
import {period} from '../src/periods';
import {taskForDay,taskForPeriod,taskActiveDuring} from '../src/task-history';
import {taskActivitySummary} from '../src/plan-summary';
import {summarize} from '../src/analytics';
import {defaultSettings} from '../src/settings';
import {replaceManagedWidgets,WIDGET_START,WIDGET_END} from '../src/notes';
const created=()=>newTask({title:'Тест истории',areaId:'work',plannedDate:'2026-07-02'},'2026-10-02T09:00:00+03:00');
const finished=()=>changeTask(created(),{status:'done'},'2026-10-04T10:00:00+03:00');
test('daily lifetime includes creation and completion days only',()=>{
 const t=finished();assert.equal(taskForDay(t,'2026-10-01'),undefined);assert.equal(taskForDay(t,'2026-10-02')?.status,'todo');assert.equal(taskForDay(t,'2026-10-03')?.status,'todo');assert.equal(taskForDay(t,'2026-10-04')?.status,'done');assert.equal(taskForDay(t,'2026-10-05'),undefined);
});
test('past display preserves original title, sphere and deadline without mutating canonical history',()=>{
 const a=created(),b=changeTask(a,{title:'Изменено',areaId:'home',dueDate:'2026-10-09'},'2026-10-03T10:00:00+03:00');const old=taskForDay(b,'2026-10-02')!;assert.equal(old.title,a.title);assert.equal(old.areaId,'work');assert.equal(old.dueDate,undefined);assert.equal(b.areaId,'home');assert.equal(b.history.length,2);
});
test('reopening restores lifetime after a closed gap',()=>{
 const t=changeTask(finished(),{status:'todo'},'2026-10-07T09:00:00+03:00');assert.equal(taskForDay(t,'2026-10-06'),undefined);assert.equal(taskForDay(t,'2026-10-07')?.status,'todo');assert(!taskActiveDuring(t,'2026-10-05','2026-10-07'));assert(taskActiveDuring(t,'2026-10-07','2026-10-08'));
});
test('activity cards include completion with plan outside period and agree with completion chart',()=>{
 const t=finished(),p=period('week','2026-10-04'),s=taskActivitySummary([t],p,'2026-10-04','work');assert.equal(s.total,1);assert.equal(s.done,1);assert.equal(s.noDeadline,1);assert.equal(summarize(p,[t],'2026-10-04','work').tasks.completed,s.done);
});
test('undated open tasks count once and duplicates use latest version',()=>{
 const t=newTask({title:'Без дат',areaId:'home'},'2026-10-02T09:00:00+03:00');t.version=1;const done=changeTask(t,{status:'done'},'2026-10-03T10:00:00+03:00');done.version=2;const s=taskActivitySummary([t,done],period('week','2026-10-03'),'2026-10-03');assert.equal(s.total,1);assert.equal(s.done,1);assert.equal(s.open,0);
});
test('later reopen cannot leak into a closed historical period',()=>{
 const t=changeTask(finished(),{status:'todo'},'2026-11-02T09:00:00+03:00');assert.equal(taskForPeriod(t,period('week','2026-10-12'),'2026-10-13'),undefined);assert.equal(taskForPeriod(t,period('week','2026-10-04'),'2026-10-04')?.status,'done');
});
test('future completion excluded and completion sphere is frozen',()=>{
 const done=finished(),moved=changeTask(done,{areaId:'home'},'2026-10-05T09:00:00+03:00'),p=period('week','2026-10-04');assert.equal(taskActivitySummary([moved],p,'2026-10-03','work').done,0);assert.equal(taskActivitySummary([moved],p,'2026-10-05','work').done,1);assert.equal(summarize(p,[moved],'2026-10-05','work').tasks.completed,1);assert.equal(summarize(p,[moved],'2026-10-05','home').tasks.completed,0);
});
test('late and on time completions use deadline at completion',()=>{
 const a=changeTask(newTask({title:'Срок',areaId:'work',dueDate:'2026-10-03'},'2026-10-02T09:00:00+03:00'),{status:'done'},'2026-10-04T09:00:00+03:00'),b=changeTask(a,{dueDate:'2026-10-09'},'2026-10-05T09:00:00+03:00');assert.equal(taskActivitySummary([b],period('week','2026-10-04'),'2026-10-05').late,1);
});
test('legacy widget comments upgrade to native hidden markers while preserving surrounding Markdown',()=>{
 const old='Мой текст\n<!-- life-planner-widgets:start -->\n```life-planner\ntasks\n```\n<!-- life-planner-widgets:end -->\n[[Моя ссылка]]';const out=replaceManagedWidgets(old,'day',defaultSettings().layouts.day);assert(out.startsWith('Мой текст\n'+WIDGET_START));assert(out.endsWith(WIDGET_END+'\n[[Моя ссылка]]'));assert(!out.includes('<!--'));
});
test('mixed managed markers reject ambiguous replacement; sidebar defaults left',()=>{
 assert.throws(()=>replaceManagedWidgets(WIDGET_START+'\n<!-- life-planner-widgets:start -->\n'+WIDGET_END,'day',defaultSettings().layouts.day));assert.equal(defaultSettings().sidebar.side,'left');
});
