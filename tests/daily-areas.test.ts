import test from 'node:test';
import assert from 'node:assert/strict';
import {base,dailyAreaRatingId,areaRatingId,validateRecord} from '../src/domain';
import {dailyAreaRatingSeries,summarize} from '../src/analytics';
import {period} from '../src/periods';
import type {DailyAreaRating,AreaRating,PlannerRecord} from '../src/model';
const observation=(date:string,value:number|null,version=0):DailyAreaRating=>({...base(dailyAreaRatingId(date,'family')),kind:'daily-area-rating',date,areaId:'family',areaTitle:'Семья',policyVersion:2,value,version});
test('Daily areas: date/ID/policy/range validated separately from legacy weekly records',()=>{
  const r=observation('2026-10-01',8);assert.doesNotThrow(()=>validateRecord(r));
  for(const patch of [{date:'2026-02-30'},{id:'wrong'},{policyVersion:1},{value:11},{value:0},{value:1.5}])assert.throws(()=>validateRecord({...r,...patch}));
});
test('Daily area summaries dedupe revisions, skip null/future, and do not dilute with missing days',()=>{
  const source:PlannerRecord[]=[observation('2026-09-30',6),observation('2026-10-01',2),observation('2026-10-01',8,2),observation('2026-10-02',null),observation('2026-10-03',1)];
  const week=summarize(period('week','2026-10-01'),source,'2026-10-02');
  assert.deepEqual(week.areaRatings.find(r=>r.areaId==='family'),{areaId:'family',areaTitle:'Семья',mean:7,count:2});
  assert.deepEqual(week.areaRatings.find(r=>r.areaId==='home'),{areaId:'home',areaTitle:'Быт',mean:null,count:0});
  assert.equal(dailyAreaRatingSeries(period('week','2026-10-01'),source,'2026-10-02').length,2);
});
test('Month/quarter/year aggregate original daily observations, never averages of averages',()=>{
  const source=[observation('2026-09-30',6),observation('2026-10-01',10),observation('2026-10-02',8)];
  const mean=(type:'month'|'quarter'|'year',date:string)=>summarize(period(type,date),source,'2026-10-02').areaRatings.find(r=>r.areaId==='family')!;
  assert.equal(mean('month','2026-10-01').mean,9);assert.equal(mean('quarter','2026-10-01').mean,9);assert.equal(mean('year','2026-10-01').mean,8);assert.equal(mean('year','2026-10-01').count,3);
});
test('Legacy weekly values retain their Sunday rule and never become daily observations',()=>{
  const legacy:AreaRating={...base(areaRatingId('2026-09-28','family')),kind:'area-rating',weekStart:'2026-09-28',areaId:'family',areaTitle:'Семья',value:1,policyVersion:1};
  const source=[legacy,observation('2026-10-01',8)],before=JSON.stringify(source);
  const result=summarize(period('month','2026-10-01'),source,'2026-10-05');
  assert.equal(result.areaRatings.find(r=>r.areaId==='family')!.mean,8);assert.equal(result.legacyAreaRatings[0].mean,1);assert.equal(JSON.stringify(source),before);
});
