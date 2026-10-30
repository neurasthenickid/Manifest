import test from 'node:test';
import assert from 'node:assert/strict';
import {activityGroups,activityTotal,activityDay,ActivitySelections} from '../src/activity-statistics';
import {base,newCheckin,setDefinitionVersion,validateRecord,workoutSessionId} from '../src/domain';
import {period} from '../src/periods';
import {RecordStore,type FileIO} from '../src/storage';
import type {Definition,Checkin,PlannerRecord} from '../src/model';
const all=[1,2,3,4,5,6,7];
const def=(id:string,type:Definition['type']='workout',date='2026-01-01'):Definition=>({...base(id),kind:'definition',type,versions:[{title:'Одинаковое название',effectiveDate:date,weekdays:all,items:[{id:'a',title:'Одинаковый пункт'},{id:'b',title:'Одинаковый пункт'}]}]});
const entry=(d:Definition,date:string,done:string[]=[],session?:string):Checkin=>{const c={...newCheckin(d,date),finalized:true,states:Object.fromEntries(done.map(id=>[id,true]))};return session?{...c,schemaVersion:2,sessionId:session,id:workoutSessionId(d.id,date,session)}:c;};
const groups=(source:PlannerRecord[],type='year',date='2026-10-26')=>activityGroups(period(type as 'year',date),source,['workout','morning','evening'],date);

test('percent uses snapshot numerators, stable program ID and exercise IDs across rename/edit; equal names never merge',()=>{
 const d=def('one'),first={...entry(d,'2026-01-02',['a']),items:[{id:'a',title:'Old A'}]},changed=setDefinitionVersion(d,{title:'Новое имя',effectiveDate:'2026-02-01',weekdays:all,items:Array.from({length:9},(_,i)=>({id:'item'+i,title:'New '+i}))}),second=entry(changed,'2026-02-02'),other=def('two');
 const source=[changed,first,second,other,entry(other,'2026-02-02',['a','b'])],before=JSON.stringify(source),g=groups(source);assert.equal(g.length,2);assert.equal(g[0].id,'one');assert.equal(g[0].title,'Новое имя');const total=activityTotal(g[0],period('year','2026-01-01'),'2026-10-26');assert.deepEqual([total.done,total.total,total.percent],[1,10,10]);assert.equal(total.items.length,10);assert.equal(total.items[0].title,'Old A');assert.equal(JSON.stringify(source),before);assert.equal(activityTotal(g[1],period('year','2026-01-01'),'2026-10-26').items.length,2);
});
test('multiple sessions same day including legacy ID count once per ID, revisions dedup; zero/draft/missing/future distinct',()=>{
 const d=def('multi'),one=entry(d,'2026-10-20',['a','b']),two=entry(d,'2026-10-20',[],'second'),newer={...two,version:2},draft={...entry(d,'2026-10-21',['a']),finalized:false},future=entry(d,'2026-10-27',['a','b']);for(const r of [one,two,newer,draft,future])validateRecord(r);
 const g=groups([d,one,two,newer,draft,future])[0],total=activityDay(g,'2026-10-20','2026-10-26');assert.equal(total.state,'partial');assert.deepEqual([total.total.sessions,total.total.done,total.total.total],[2,2,4]);assert.equal(activityDay(g,'2026-10-21','2026-10-26').state,'missing');assert.equal(activityDay(g,'2026-10-27','2026-10-26').state,'future');const zero=activityGroups(period('week','2026-10-20'),[d,two],['workout'],'2026-10-26')[0];assert.equal(activityDay(zero,'2026-10-20','2026-10-26').state,'zero');assert.equal(activityDay(g,'2026-10-19','2026-10-26').total.percent,null);
});
test('routine coverage respects start, weekday versions, archive and saved snapshots; all successful items retained',()=>{
 const d=def('morning','morning','2026-10-15');d.versions[0].weekdays=[4,5];d.lifecycle=[{date:'2026-10-23',archived:true}];const old=entry(d,'2026-10-15',['a','b']),zero=entry(d,'2026-10-16',[]);d.versions.push({effectiveDate:'2026-10-20',title:'Renamed',weekdays:all,items:[{id:'new',title:'Added'}]});
 const g=groups([d,old,zero])[0],t=activityTotal(g,period('month','2026-10-01'),'2026-10-26');assert.deepEqual([t.filledDays,t.applicableDays,t.missingDays],[2,5,3]);assert.deepEqual([t.done,t.total],[2,4]);assert.equal(t.items.length,2);const day=activityTotal(g,period('day','2026-10-15'),'2026-10-26');assert.equal(day.items.length,2);assert(day.items.every(i=>i.done===i.total));assert.equal(activityTotal(g,period('day','2026-10-01'),'2026-10-26').applicableDays,0);
});
test('calendar bounds, cross-year week and leap February are local dates in all time zones',()=>{
 const d=def('leap','evening','2028-02-01'),e=entry(d,'2028-02-29',['a']),p=period('month','2028-02-01'),previous=process.env.TZ;
 try{for(const tz of ['Pacific/Honolulu','Pacific/Kiritimati','Europe/Moscow']){process.env.TZ=tz;const g=activityGroups(p,[d,e],['evening'],'2028-02-29')[0],t=activityTotal(g,p,'2028-02-29');assert.deepEqual([t.done,t.total,t.applicableDays],[1,2,29]);assert.equal(activityDay(g,'2028-03-01','2028-02-29').state,'future');}}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
 const w=period('week','2026-12-31'),work=def('year-boundary'),g=activityGroups(w,[work,entry(work,'2027-01-02',['a'])],['workout'],'2027-01-03')[0];assert.equal(activityTotal(g,w,'2027-01-03').sessions,1);
});
test('week/month/quarter/year totals sum records once and exclude draft/future; workouts never invent missing sessions',()=>{
 const d=def('periods'),source=[d,entry(d,'2026-10-01',['a']),entry(d,'2026-10-20',['a','b']),entry(d,'2026-12-01',['a'])];
 for(const [type,count]of [['week',1],['month',2],['quarter',2],['year',2]] as const){const p=period(type,'2026-10-20'),g=activityGroups(p,source,['workout'],'2026-10-26')[0],t=activityTotal(g,p,'2026-10-26');assert.equal(t.sessions,count);assert.equal(t.missingDays,0);assert.equal(t.applicableDays,0);}
});
test('selection and disclosure are independent per stable program and routine, bounded and read-only',()=>{
 const a=def('a'),b=def('b'),m=def('m','morning'),e=def('e','evening'),p=period('year','2026-10-01'),g=activityGroups(p,[a,b,m,e],['workout','morning','evening'],'2026-10-26'),s=new ActivitySelections();assert(g.every(x=>!s.get(x).itemsOpen&&!s.get(x).journalOpen));s.get(g[0]).itemsOpen=true;s.month(g[0],p,'2026-10-03');s.day(g[0],p,'2026-10-20');assert.equal(s.range(g[0],p).type,'day');assert.equal(s.range(g[1],p).type,'year');assert.equal(s.get(g[0]).itemsOpen,true);assert.equal(s.day(g[0],p,'2027-01-01'),false);s.reset(g[0],true);assert.equal(s.range(g[0],p).type,'month');s.reset(g[0]);assert.equal(s.range(g[0],p).type,'year');assert.equal(s.get(g[0]).itemsOpen,true);s.day(g[2],p,'2026-10-22');assert.equal(s.get(g[3]).day,undefined);
});
test('additional sessions round-trip in real RecordStore; schema1 stays byte-exact, invalid session IDs fail',async()=>{
 const files=new Map<string,string>(),io:FileIO={read:async p=>files.get(p)??null,write:async(p,t)=>{files.set(p,t);},mkdir:async()=>{},list:async prefix=>[...files.keys()].filter(k=>k.startsWith(prefix))},store=new RecordStore(io);await store.load();const d=def('persist'),old=entry(d,'2026-10-20',['a']);await store.save(d,0);await store.save(old,0);const original=files.get('Planner/Data/records/'+old.id+'.json');assert.equal(typeof original,'string');await store.save(entry(d,'2026-10-20',[],'two'),0);const restart=new RecordStore(io);await restart.load();assert.deepEqual(restart.issues,[]);assert.equal(restart.all('checkin').length,2);assert.equal(files.get('Planner/Data/records/'+old.id+'.json'),original);assert.throws(()=>validateRecord({...old,schemaVersion:2}),/ID/);assert.throws(()=>validateRecord({...entry(d,'2026-10-20',[],'bad'),definitionType:'morning'}));
});
test('ambiguous legacy snapshots without item identity remain quarantined and byte-exact instead of guessed by title',async()=>{
 const d=def('legacy'),c=entry(d,'2026-10-20'),raw=JSON.stringify({...c,items:[{title:'Same'},{title:'Same'}]}),path='Planner/Data/records/'+c.id+'.json',files=new Map([[path,raw]]);let writes=0;
 const io:FileIO={read:async p=>files.get(p)??null,write:async()=>{writes++;},mkdir:async()=>{},list:async()=>[path]},store=new RecordStore(io);await store.load();assert.equal(store.all('checkin').length,0);assert.equal(store.issues.length,1);assert.equal(files.get(path),raw);assert.equal(writes,0);
});
