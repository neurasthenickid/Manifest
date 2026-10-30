import test from 'node:test';
import assert from 'node:assert/strict';
import {newTask,changeTask} from '../src/domain';
import {dailyTasks,planFor,ownPlanTasks} from '../src/task-planning';
import {taskCompletions} from '../src/task-history';
import {period} from '../src/periods';
import {defaultAreas} from '../src/areas';
import {sortTasksByArea,taskDisplay} from '../src/ui/task-display';
import {RecordStore,type FileIO} from '../src/storage';
const at='2026-10-13T12:00:00+03:00';
const planned=(date='2026-10-13',dueDate?:string)=>newTask({title:'Fixture',areaId:'work',plannedDate:date,dueDate,planPeriod:planFor('day',date)},at,undefined,'2026-10-12');
test('due and no-due tasks carry only into days that have really arrived, without rewriting dates or IDs',()=>{
 for(const due of [undefined,'2026-10-13']){const task=planned('2026-10-13',due),raw=JSON.stringify(task);
  for(const today of ['2026-10-13','2026-10-14','2026-10-15'])for(const date of ['2026-10-13','2026-10-14','2026-10-15']){const expected=date<=today?1:0;assert.equal(dailyTasks([task],date,today).length,expected);assert.equal(ownPlanTasks([task],period('day',date),today).length,expected);}
  assert.equal(JSON.stringify(task),raw);
 }
 const future=planned('2026-10-14');assert.equal(dailyTasks([future],'2026-10-14','2026-10-13')[0].id,future.id);
 const done=changeTask(planned(),{status:'done'},at,'2026-10-13','2026-10-13');assert.equal(dailyTasks([done],'2026-10-14','2026-10-14').length,0);
});
test('dated cancellation fixes a past completion even after repeated same-status attempts on the next physical day',()=>{
 const task=planned('2026-10-12'),done=changeTask(task,{status:'done'},at,'2026-10-12');let current=changeTask(done,{status:'todo'},at);
 current=changeTask(current,{status:'todo'},at);assert.equal(dailyTasks([current],'2026-10-12','2026-10-13')[0].status,'done');
 const fixed=changeTask(current,{status:'todo'},at,undefined,'2026-10-12');assert.equal(dailyTasks([fixed],'2026-10-12','2026-10-13')[0].status,'todo');assert.equal(taskCompletions(fixed,'2026-10-12','2026-10-14').length,0);assert.equal(fixed.history.length,current.history.length+1);assert.equal(fixed.id,task.id);
});
test('canceling a past day preserves a later completion, and that later day can also be canceled explicitly',()=>{
 const task=planned('2026-10-12'),done12=changeTask(task,{status:'done'},at,'2026-10-12'),reopened=changeTask(done12,{status:'todo'},at),done13=changeTask(reopened,{status:'done'},at,'2026-10-13');
 const undo12=changeTask(done13,{status:'todo'},at,undefined,'2026-10-12');assert.equal(dailyTasks([undo12],'2026-10-12','2026-10-13')[0].status,'todo');assert.equal(dailyTasks([undo12],'2026-10-13','2026-10-13')[0].status,'done');assert.deepEqual(taskCompletions(undo12,'2026-10-12','2026-10-14').map(t=>t.completedDate),['2026-10-13']);
 const undo13=changeTask(undo12,{status:'todo'},at,undefined,'2026-10-13');assert.equal(dailyTasks([undo13],'2026-10-13','2026-10-13')[0].status,'todo');assert.equal(taskCompletions(undo13,'2026-10-12','2026-10-14').length,0);
});
test('dated cancel survives reload with one canonical identity and original bytes backed up',async()=>{
 const files=new Map<string,string>(),io:FileIO={read:async p=>files.get(p)??null,write:async(p,t)=>{files.set(p,t);},mkdir:async()=>{},list:async p=>[...files.keys()].filter(k=>k.startsWith(p+'/'))};const store=new RecordStore(io);await store.load();const done=await store.save(changeTask(planned('2026-10-12'),{status:'done'},at,'2026-10-12'),0),raw=files.get('Planner/Data/records/'+done.id+'.json');await store.save(changeTask(done,{status:'todo'},at,undefined,'2026-10-12'),done.version);await store.reload();assert.equal(store.all('task').length,1);assert.equal(dailyTasks(store.all('task'),'2026-10-12','2026-10-13')[0].status,'todo');assert([...files].some(([p,t])=>p.includes('/backups/')&&t===raw));
});
test('task order follows stable sphere IDs including custom/disabled, preserving within-sphere order and source arrays',()=>{
 const areas=[{...defaultAreas()[2],enabled:false},{id:'area-custom',title:'Custom',color:'#336699',icon:'leaf',enabled:true},defaultAreas()[1]],tasks=['home','work','area-custom','work','missing'].map(areaId=>({...planned(),areaId})),raw=JSON.stringify(tasks);
 assert.deepEqual(sortTasksByArea(tasks,areas).map(t=>t.areaId),['work','work','area-custom','home','missing']);assert.equal(sortTasksByArea(tasks,areas)[0],tasks[1]);assert.equal(sortTasksByArea(tasks,areas)[1],tasks[3]);assert.equal(JSON.stringify(tasks),raw);
 for(const area of defaultAreas()){const display=taskDisplay({...planned(),areaId:area.id});assert.match(display.emoji,/\p{Extended_Pictographic}/u);assert(!['♡','⌂','▤','◇'].includes(display.emoji));}
 assert.equal(taskDisplay({...planned(),areaId:'area-custom'},areas).emoji,'🌿');
});
