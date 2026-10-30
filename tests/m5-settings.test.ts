import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings,normalizeSettings} from '../src/settings';
import {PlannerViewState} from '../src/view-state';
import {period,dates} from '../src/periods';
import {miniCalendarRange} from '../src/ui/mini-calendar';
import {NotesService,replaceManagedWidgets} from '../src/notes';
import {newTask,changeTask} from '../src/domain';
import {planSummary} from '../src/plan-summary';
import type {FileIO} from '../src/storage';
class MemoryIO implements FileIO {
 files=new Map<string,string>();conflict=false;badBackup=false;
 async read(p:string){return this.files.get(p)??null;}
 async write(p:string,t:string){this.files.set(p,t);}
 async mkdir(_p:string){}
 async list(p:string){return [...this.files.keys()].filter(k=>!p||k.startsWith(p+'/'));}
 async create(p:string,t:string){if(this.files.has(p))return false;this.files.set(p,this.badBackup&&p.includes('note-backups/')?'bad copy':t);return true;}
 async replace(p:string,expected:string,t:string){if(this.conflict)this.files.set(p,expected+'\nКонкурентный текст\n');if(this.files.get(p)!==expected)throw new Error('Conflict');this.files.set(p,t);}
}
test('settings migrate old appearance, reject unsafe folders, normalize bounds and preserve empty layouts',()=>{
 const s=normalizeSettings({accent:'#abcdef',background:'#123456',width:9999,calendar:{startHour:23,endHour:5,hourHeight:1},layouts:{day:['tasks','tasks','nonsense'],week:[]},folders:{day:'../личное'}});
 assert.equal(s.accent,'#abcdef');assert.equal(s.width,2000);assert.deepEqual(s.calendar,{startHour:23,endHour:24,hourHeight:24});assert.deepEqual(s.layouts.day,['tasks']);assert.deepEqual(s.layouts.week,[]);assert.equal(s.folders.day,'01 День');assert.equal(s.sidebar.follow,true);
 const duplicate=defaultSettings();duplicate.folders.week=duplicate.folders.day.toUpperCase();assert.deepEqual(normalizeSettings(duplicate).folders,defaultSettings().folders);
});
test('period round trips preserve one chosen date across all five periods and isolate windows',()=>{
 const a=new PlannerViewState(),b=new PlannerViewState();a.setDate('2026-10-02');a.setArea('work');
 for(const type of ['day','week','month','quarter','year','month','week','day'] as const)assert.equal(a.dateFor(period(type,'2026-10-02'),'2026-12-01'),'2026-10-02');
 assert.equal(b.area,'all');assert.equal(b.dateFor(period('quarter','2026-10-02'),'2026-11-05'),'2026-11-05');assert.throws(()=>a.setDate('2027-02-29'));
});
test('adjacent periods clamp end of month, leap years and ISO week boundary',()=>{
 const v=new PlannerViewState();v.setDate('2028-01-31');assert.equal(v.adjacentDate(period('month','2028-01-31'),1,'2028-01-31'),'2028-02-29');
 v.setDate('2028-02-29');assert.equal(v.adjacentDate(period('year','2028-02-29'),1,'2028-02-29'),'2029-02-28');
 v.setDate('2026-12-31');assert.equal(v.adjacentDate(period('week','2026-12-31'),1,'2026-12-31'),'2027-01-07');
});
test('mini calendar contains only complete necessary weeks, including month ending Sunday',()=>{
 assert.deepEqual(miniCalendarRange('2026-02-12'),{start:'2026-01-26',end:'2026-03-02'});
 assert.deepEqual(miniCalendarRange('2026-05-31'),{start:'2026-04-27',end:'2026-06-01'});
 const r=miniCalendarRange('2028-02-29');assert(dates(r.start,r.end).includes('2028-02-29'));assert.equal(dates(r.start,r.end).length%7,0);
});
test('managed layout sync preserves Markdown, creates verified copy and never discovers backup as duplicate',async()=>{
 const io=new MemoryIO(),s=defaultSettings(),notes=new NotesService(io,'Planner',()=>s),p=await notes.ensurePeriod('day','2026-10-02');
 const original=io.files.get(p)!.replace('\nall\n','\ncalendar\n')+'\nМой абзац [[Книга]]\n- [x] Моя отметка\n';io.files.set(p,original);s.layouts.day=['navigation','tasks'];
 assert.equal((await notes.syncLayouts()).updated,1);assert(io.files.get(p)!.endsWith('\nМой абзац [[Книга]]\n- [x] Моя отметка\n'));assert.equal([...io.files].find(([key])=>key.includes('note-backups/'))![1],original);assert.equal(await notes.ensurePeriod('day','2026-10-02'),p);assert.equal((await notes.syncLayouts()).updated,0);
 assert(p.includes('/01 День/'));assert(io.files.get(p)!.includes('## Свободные записи'));
});
test('conflicting edits and unverified backup stop layout writes while preserving latest text',async()=>{
 for(const mode of ['conflict','backup'] as const){const io=new MemoryIO(),s=defaultSettings(),notes=new NotesService(io,'Planner',()=>s),p=await notes.ensurePeriod('day','2026-10-02'),original=io.files.get(p)!.replace('\nall\n','\ncalendar\n');io.files.set(p,original);s.layouts.day=['tasks'];io.conflict=mode==='conflict';io.badBackup=mode==='backup';await assert.rejects(notes.syncLayouts());assert.equal(io.files.get(p),original+(mode==='conflict'?'\nКонкурентный текст\n':''));}
});
test('custom text in managed block is rejected, unmarked legacy content stays untouched',()=>{
 const text='До\n<!-- life-planner-widgets:start -->\n```life-planner\ntasks\n```\nПользовательский текст\n<!-- life-planner-widgets:end -->\nПосле';assert.throws(()=>replaceManagedWidgets(text,'day',['navigation']),/пользовательский текст/);
 assert.equal(replaceManagedWidgets('Обычный Markdown','day',['tasks']),'Обычный Markdown');
});
test('creation template text applies to future notes while current live layout overrides stale widget order',async()=>{
 const io=new MemoryIO(),s=defaultSettings(),notes=new NotesService(io,'Planner',()=>s),old=await notes.ensurePeriod('day','2026-10-01'),template=await notes.template('day');io.files.set(template,io.files.get(template)!+'\nМой новый вопрос\n');s.layouts.day=['tasks'];const next=await notes.ensurePeriod('day','2026-10-02');assert(!io.files.get(old)!.includes('Мой новый вопрос'));assert(io.files.get(next)!.includes('Мой новый вопрос'));assert(!io.files.get(next)!.includes('```life-planner\ncalendar'));
 s.folders.day='Дни';assert.equal(await notes.ensurePeriod('day','2026-10-01'),old);assert((await notes.ensurePeriod('day','2026-10-03')).includes('/Дни/'));
});
const stamp=(day:string)=>day+'T12:00:00+03:00';
test('task plan cohort separates total, on-time, late, no-deadline, open and unplanned backlog',()=>{
 const fields={title:'Дело',areaId:'work',plannedDate:'2026-10-02'},p=period('month','2026-10-02');
 const on=changeTask(newTask({...fields,dueDate:'2026-10-02'},stamp('2026-10-01')),{status:'done'},stamp('2026-10-02'));
 const late=changeTask(newTask({...fields,dueDate:'2026-10-01'},stamp('2026-10-01')),{status:'done'},stamp('2026-10-02'));
 const no=changeTask(newTask(fields,stamp('2026-10-01')),{status:'done'},stamp('2026-10-02'));
 const open=newTask(fields,stamp('2026-10-01')),backlog=newTask({title:'Потом',areaId:'work'},stamp('2026-10-01'));
 assert.deepEqual(planSummary([on,late,no,open,backlog],p,'2026-10-02'),{total:4,done:3,onTime:1,late:1,noDeadline:1,open:1,backlog:1});
});
test('completion outcome uses original deadline; historical cutoff excludes later reopen and sphere move',()=>{
 let current=newTask({title:'Текущий',areaId:'work',plannedDate:'2026-10-02',dueDate:'2026-10-02'},stamp('2026-10-01'));current=changeTask(current,{status:'done'},stamp('2026-10-02'));current=changeTask(current,{dueDate:'2026-10-01'},stamp('2026-10-03'));assert.equal(planSummary([current],period('month','2026-10-02'),'2026-10-03').onTime,1);
 let t=newTask({title:'Дело',areaId:'work',plannedDate:'2026-09-30',dueDate:'2026-09-30'},stamp('2026-09-29'));
 t=changeTask(t,{status:'done'},stamp('2026-09-30'));t=changeTask(t,{dueDate:'2026-09-01'},stamp('2026-10-01'));assert.equal(planSummary([t],period('month','2026-09-30'),'2026-10-02').onTime,1);
 t=changeTask(t,{status:'todo',areaId:'home'},stamp('2026-10-02'));assert.equal(planSummary([t],period('month','2026-09-30'),'2026-10-02','work').done,1);assert.equal(planSummary([t],period('month','2026-09-30'),'2026-10-02','home').total,0);
});
test('future creation/completion is excluded and highest version of repeated ID wins',()=>{
 const old=newTask({title:'Дело',areaId:'work',plannedDate:'2026-10-03',dueDate:'2026-10-03'},stamp('2026-10-01'));
 const newer={...changeTask(old,{status:'done'},stamp('2026-10-03')),version:2},p=period('month','2026-10-02');
 assert.equal(planSummary([newer,old],p,'2026-10-02').open,1);assert.equal(planSummary([newer,old],p,'2026-10-03').done,1);
 assert.equal(planSummary([newTask({title:'Будущее',areaId:'work',plannedDate:'2026-10-03'},stamp('2026-10-03'))],p,'2026-10-02').total,0);
});
