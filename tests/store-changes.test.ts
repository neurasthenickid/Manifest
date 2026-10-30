import test from 'node:test';
import assert from 'node:assert/strict';
import {RecordStore,type FileIO} from '../src/storage';
import {base,dayRatingId} from '../src/domain';
import type {DayRating,StoreChange} from '../src/model';
function fixture(){const files=new Map<string,string>();const io:FileIO={read:async p=>files.get(p)??null,write:async(p,t)=>{files.set(p,t);},mkdir:async()=>{},list:async prefix=>[...files.keys()].filter(p=>p.startsWith(prefix+'/'))};return{files,store:new RecordStore(io)};}
const rating=():DayRating=>({...base(dayRatingId('2026-10-02')),kind:'day-rating',date:'2026-10-02',value:61});
test('verified rating save notifies its ID once; watcher reload and backup changes are silent',async()=>{
 const{files,store}=fixture();await store.load();const events:(StoreChange|undefined)[]=[];store.subscribe(e=>events.push(e));const saved=await store.save(rating(),0);
 assert.deepEqual(events,[{records:[{id:saved.id,kind:'day-rating'}],issuesChanged:false}]);await store.reload();assert.equal(events.length,1);
 files.set('Planner/Data/backups/unrelated/v1.json','not an authoritative record');await store.reload();assert.equal(events.length,1);assert.equal(store.get(saved.id)?.version,1);
});
test('external rating edits, deletions and kind replacements describe all affected consumers',async()=>{
 const{files,store}=fixture();await store.load();const saved=await store.save(rating(),0),path='Planner/Data/records/'+saved.id+'.json';const events:(StoreChange|undefined)[]=[];store.subscribe(e=>events.push(e));
 files.set(path,JSON.stringify({...saved,value:88}));await store.reload();assert.equal((store.get(saved.id) as DayRating).value,88);assert.deepEqual(events.pop()?.records,[{id:saved.id,kind:'day-rating'}]);
 files.set(path,JSON.stringify({...base(saved.id),version:1,kind:'event',title:'External event',start:'2026-10-02',end:'2026-10-03',allDay:true,timezone:'Europe/Moscow',areaId:'work'}));await store.reload();assert.deepEqual(events.pop()?.records,[{id:saved.id,kind:'event'},{id:saved.id,kind:'day-rating'}]);
 files.delete(path);await store.reload();assert.deepEqual(events.pop()?.records,[{id:saved.id,kind:'event'}]);assert.equal(store.get(saved.id),undefined);
});
test('new and cleared storage issues notify even with no valid record changes',async()=>{
 const{files,store}=fixture();await store.load();const events:(StoreChange|undefined)[]=[];store.subscribe(e=>events.push(e));files.set('Planner/Data/records/broken.json','broken');await store.reload();assert.equal(events.length,1);assert.equal(events[0]?.issuesChanged,true);assert.equal(store.issues.length,1);await store.reload();assert.equal(events.length,1);files.delete('Planner/Data/records/broken.json');await store.reload();assert.equal(events.length,2);assert.equal(events[1]?.issuesChanged,true);assert.equal(store.issues.length,0);
});
