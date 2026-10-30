import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {StatisticsDay} from '../src/statistics-day';
import {period,addDays} from '../src/periods';
import {normalizeSettings,defaultSettings} from '../src/settings';
import {canonicalLayout,periodModules,widgetModule} from '../src/ui/modules';

test('date model rejects every out-of-period value, including exclusive end and shifted boundaries',()=>{
 for(const [type,date] of [['day','2026-10-21'],['week','2026-12-31'],['week','2028-02-29'],['month','2028-02-10'],['quarter','2026-03-31'],['year','2026-12-31']] as const){
  const p=period(type,date),d=new StatisticsDay(p,'2026-10-21');assert.equal(d.min,p.start);assert.equal(d.max,addDays(p.end,-1));
  for(const invalid of ['',p.end,addDays(p.start,-1),'2027-02-29','2026-01-01T00:00:00Z']){const before=d.value;assert.equal(d.select(invalid),false);assert.equal(d.value,before);}
  d.select(d.min);assert.equal(d.previousAvailable,false);assert.equal(d.shift(-1),false);d.select(d.max);assert.equal(d.nextAvailable,false);assert.equal(d.shift(1),false);
  for(let day=d.min;day<p.end;day=addDays(day,1)){assert.equal(d.select(day),true);assert.equal(d.context.start,day);}
 }
});
test('leap day, week crossing years, timezone changes and rebasing do not leak beyond calendar bounds',()=>{
 const week=new StatisticsDay(period('week','2026-12-31'),'2026-12-31');week.shift(1);assert.equal(week.value,'2027-01-01');week.select('2027-01-03');assert.equal(week.shift(1),false);
 const leap=new StatisticsDay(period('month','2028-02-01'),'2028-02-28');leap.shift(1);assert.equal(leap.value,'2028-02-29');assert.equal(leap.shift(1),false);
 const previous=process.env.TZ;try{for(const tz of ['Pacific/Honolulu','Pacific/Kiritimati','Europe/Moscow']){process.env.TZ=tz;const d=new StatisticsDay(period('month','2026-03-01'),'2026-03-29');d.shift(1);assert.equal(d.value,'2026-03-30');}}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
 week.rebase(period('week','2026-12-31'),'2027-01-01');assert.equal(week.value,'2027-01-03');week.rebase(period('month','2027-02-01'),'2027-02-17');assert.equal(week.value,'2027-02-17');week.rebase(period('quarter','2026-01-01'),'2027-02-17');assert.equal(week.value,'2026-01-01');
});
test('old layouts consolidate in place without enabling disabled statistics or altering user data',()=>{
 const source=defaultSettings();source.layouts.week=['calendar','plans','tasks','task-stats','overview'];source.layouts.month=['plans'];source.layouts.quarter=[];source.layouts.year=['task-stats','navigation','plans'];const before=JSON.stringify(source);
 const next=normalizeSettings(source);assert.deepEqual(next.layouts.week,['calendar','task-stats','tasks','overview']);assert.deepEqual(next.layouts.month,['task-stats']);assert.deepEqual(next.layouts.quarter,[]);assert.deepEqual(next.layouts.year,['task-stats','navigation']);assert.deepEqual(normalizeSettings(next),next);assert.equal(JSON.stringify(source),before);assert.deepEqual(next.areas,source.areas);assert.deepEqual(next.cloudConnection,source.cloudConnection);
 for(const type of ['week','month','quarter','year'] as const){assert.equal(periodModules(type).filter(m=>m==='task-stats').length,1);assert(!periodModules(type).includes('plans'));}
 assert.equal(widgetModule('plans'),'plans');assert.deepEqual(canonicalLayout(['plans','task-stats','plans']),['task-stats']);
});
test('desktop presenter retains original verified 1.0.3 dimensions/geometry; axis uses one rule for all labels',()=>{
 const expected=JSON.parse(readFileSync('tests/fixtures/desktop-chart-geometry.json','utf8')).expectedSourceLines as string[],current=readFileSync('src/ui/widget.ts','utf8');
 assert(expected.length>0);for(const line of expected)assert(current.includes(line),line);
 const css=readFileSync('styles.css','utf8');assert(!/\.lp-axis-end\s*\{/.test(css));assert.equal((css.match(/\.lp-axis-hours span\s*\{/g)??[]).length,1);assert.match(css,/\.lp-axis-hours span\s*\{[^}]*padding:0;[^}]*transform:translateY\(-100%\)/);
});
