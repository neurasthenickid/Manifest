import test from 'node:test';
import assert from 'node:assert/strict';
import {StatisticsDay} from '../src/statistics-day';
import {period} from '../src/periods';
import {PlannerViewState} from '../src/view-state';
import {defaultTemplate,managedWidgets,NotesService,simplifyStockSections} from '../src/notes';
import {selectedTaskStatistics} from '../src/task-statistics';
import {newTask,changeTask} from '../src/domain';
import type {FileIO} from '../src/storage';
import type {PeriodType} from '../src/model';

test('statistics date defaults and view state remain local while every selection respects the period',()=>{
  assert.equal(new StatisticsDay(period('day','2026-10-01'),'2026-10-20').value,'2026-10-01');
  for(const type of ['week','month','quarter','year'] as const){const p=period(type,'2026-10-20');assert.equal(new StatisticsDay(p,'2026-10-20').value,'2026-10-20');assert.equal(new StatisticsDay(p,'2025-01-01').value,p.start);}
  const day=new StatisticsDay(period('year','2026-01-01'),'2026-12-31');assert.equal(day.shift(1),false);assert.equal(day.value,'2026-12-31');day.shift(-1);assert.equal(day.value,'2026-12-30');assert.equal(day.select('2027-01-01'),false);assert.equal(day.select(''),false);
  const view=new PlannerViewState(),before=JSON.stringify(view);day.select('2026-10-20');assert.equal(JSON.stringify(view),before);view.toggleStatistics('week',['day','week']);view.toggleStatistics('day',['day','week']);assert.equal(day.value,'2026-10-20');
});
test('selected day uses existing completion/deadline calculations without mutating task history or aggregate',()=>{
  const task=newTask({title:'A',areaId:'work',plannedDate:'2026-10-01',dueDate:'2026-10-01'},'2026-09-30T12:00:00Z'),done=changeTask(task,{status:'done'},'2026-10-02T12:00:00Z','2026-10-02');
  const source=JSON.stringify(done),month=period('month','2026-10-01'),total=selectedTaskStatistics([done],month,'2026-10-20',['day']);
  assert.equal(selectedTaskStatistics([done],period('day','2026-10-02'),'2026-10-20',['day']).late,1);assert.equal(total.done,1);assert.equal(JSON.stringify(done),source);
  assert.equal(selectedTaskStatistics([],month,'2026-10-20',['day']).total,0);assert.equal(selectedTaskStatistics([task],month,'2026-10-20',['day']).done,0);
});
const stock=(type:PeriodType,body:string)=>`---\nlife-planner-type: ${type}\nlife-planner-date: 2026-10-01\nlife-planner-template-version: 6\n---\n\n${managedWidgets(type)}\n\n${body}`;
test('all new standard templates contain one ordinary free-notes section without prompts or related links',()=>{
  for(const type of ['day','week','month','quarter','year'] as const){const text=defaultTemplate(type);assert.equal(text.match(/## Свободные записи/g)?.length,1);assert.doesNotMatch(text,/Фокус|Намерения|Направления|Образ года|Итоги|related_links|Периоды:/);assert.match(text,/template-version: 7/);}
});
test('stock cleanup preserves filled, ambiguous, nested/code and free-note text byte-for-byte including CRLF',()=>{
  const p=period('week','2026-10-01'),related='Периоды: [[Exact]]';
  for(const newline of ['\n','\r\n']){
    const tail='## Свободные записи\n\nМой текст [[Ссылка]] ![[Фото.png]]\n\n```md\n## Фокус недели\n```\n';
    const source=stock('week',related+'\n\n## Фокус недели\n\n## Итоги недели\n\n'+tail).replaceAll('\n',newline),next=simplifyStockSections(source,p,related);
    assert(next.endsWith(tail.replaceAll('\n',newline)));assert(!next.includes(related));assert.equal(next.match(/## Фокус недели/g)?.length,1);assert.equal(simplifyStockSections(next,p,related),next);
    for(const body of ['## Фокус недели\nМой план\n','## Фокус недели\n<!-- custom -->\n','## Фокус недели\n### Мой подраздел\n','## Итоги недели\n![[Вложение]]\n','Периоды: [[Другая ссылка]]\n']){const text=stock('week',body).replaceAll('\n',newline);assert.equal(simplifyStockSections(text,p,related),text);}
  }
});
test('migration backups, CAS, idempotence, custom templates and concurrent user edits are preserved',async()=>{
  const files=new Map<string,string>(),writes:string[]=[];let conflict=false;
  const io:FileIO={read:async p=>files.get(p)??null,write:async(p,s)=>{writes.push(p);files.set(p,s);},mkdir:async()=>{},list:async prefix=>[...files.keys()].filter(p=>!prefix||p.startsWith(prefix+'/')),replace:async(p,expected,next)=>{if(conflict)files.set(p,expected+'\nОдновременная правка');assert.equal(files.get(p),expected);files.set(p,next);}};
  const notes=new NotesService(io),path='Moved/old.md',source=stock('month','## Намерения месяца\n\n## Итоги месяца\n\n## Свободные записи\n\nЛичный текст\n');
  files.set(path,source);files.set('Planner/Templates/Monthly.md','Мой шаблон');assert.equal((await notes.simplifyStandardNotes()).updated,1);assert.equal(files.get('Planner/Templates/Monthly.md'),'Мой шаблон');assert([...files.values()].includes(source));assert(files.get(path)!.endsWith('Личный текст\n'));assert.equal((await notes.simplifyStandardNotes()).updated,0);
  files.set(path,source);conflict=true;await assert.rejects(notes.simplifyStandardNotes());assert(files.get(path)!.endsWith('Одновременная правка'));
});
test('only byte-exact old standard templates upgrade; any user customization survives',async()=>{
 const files=new Map<string,string>(),io:FileIO={read:async p=>files.get(p)??null,write:async(p,s)=>{files.set(p,s);},mkdir:async()=>{},list:async()=>[...files.keys()],replace:async(p,old,next)=>{assert.equal(files.get(p),old);files.set(p,next);}};
 const folders=['Daily','Weekly','Monthly','Quarterly','Yearly'],types=['day','week','month','quarter','year'] as const,prompts=['','Фокус недели','Намерения месяца','Направления квартала','Образ года'],ends=['','Итоги недели','Итоги месяца','Итоги квартала','Итоги года'];
 for(let i=0;i<types.length;i++){const type=types[i],body=i?`{{related_links}}\n\n## ${prompts[i]}\n\n\n## ${ends[i]}\n\n\n## Свободные записи\n\n`:'## Свободные записи\n\n';files.set(`Planner/Templates/${folders[i]}.md`,`---\nlife-planner-type: ${type}\nlife-planner-date: {{date}}\nlife-planner-template-version: 6\n---\n\n${managedWidgets(type)}\n\n${body}`);}
 const custom=files.get('Planner/Templates/Yearly.md')!+'Личный шаблон';files.set('Planner/Templates/Yearly.md',custom);
 const result=await new NotesService(io).simplifyStandardNotes();assert.equal(result.updated,4);for(let i=0;i<4;i++)assert.equal(files.get(`Planner/Templates/${folders[i]}.md`),defaultTemplate(types[i]));assert.equal(files.get('Planner/Templates/Yearly.md'),custom);
});
test('ambiguous stock markers, duplicate headings and copied links inside personal text are untouched',()=>{
 const p=period('week','2026-10-01'),link='Периоды: [[Exact]]';
 for(const text of [stock('week','## Фокус недели\n\n## Фокус недели\n\n'),stock('week','## Свободные записи\n'+link+'\n'),stock('week','## Фокус недели\n\n')+'\n'+managedWidgets('week'),stock('week','## Фокус недели\n\n').replace('life-planner-template-version: 6\n','')+'\nlife-planner-template-version: 6\n'])assert.equal(simplifyStockSections(text,p,link),text);
});
