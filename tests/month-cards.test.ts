import test from 'node:test';
import assert from 'node:assert/strict';
import {monthCardWeeks,monthCaptionLines,monthNames} from '../src/month-cards';
import {addDays,dates,period,weekday} from '../src/periods';

test('Month cards cover real dates exactly once with complete Monday–Sunday rows over 28 years',()=>{
 const before=new Set<number>(),after=new Set<number>(),rowCounts=new Set<number>(),lengths=new Set<number>();
 for(let year=2000;year<2028;year++)for(let m=1;m<=12;m++){
  const start=`${year}-${String(m).padStart(2,'0')}-01`,month=period('month',start),rows=monthCardWeeks(start);
  rowCounts.add(rows.length);lengths.add(dates(month.start,month.end).length);
  const all=rows.flatMap(r=>r.groups.flatMap(g=>g.dates));
  assert.equal(new Set(all).size,all.length);assert.equal(weekday(all[0]),1);assert.equal(weekday(all.at(-1)!),7);
  assert.deepEqual(all.filter(d=>d>=month.start&&d<month.end),dates(month.start,month.end));
  for(const row of rows){assert.equal(row.key,period('week',row.start).key);assert.equal(row.groups.flatMap(g=>g.dates).length,7);
   for(const group of row.groups){if(!group.outside){assert.equal(group.dates.length,1);continue;}
    assert(group.dates.every(d=>d.slice(0,7)===group.dates[0].slice(0,7)));
    assert.deepEqual(group.dates,dates(group.dates[0],addDays(group.dates[0],group.dates.length)));
    (group.dates[0]<start?before:after).add(group.dates.length);
    if(group.dates.length>1)assert.equal(group.label,monthNames[Number(group.dates[0].slice(5,7))-1]);
    else assert(group.label.length<=4);
   }
  }
 }
 assert.deepEqual([...before].sort(),[1,2,3,4,5,6]);assert.deepEqual([...after].sort(),[1,2,3,4,5,6]);
 assert.deepEqual([...rowCounts].sort(),[4,5,6]);assert.deepEqual([...lengths].sort(),[28,29,30,31]);
});
test('December/January groups carry actual dates and ISO week-year',()=>{
 const january=monthCardWeeks('2021-01-01');assert.equal(january[0].key,'2020-W53');assert.equal(january[0].groups[0].label,'декабрь');
 assert.deepEqual(january[0].groups[0].dates,['2020-12-28','2020-12-29','2020-12-30','2020-12-31']);
 const december=monthCardWeeks('2026-12-01');assert.deepEqual(december.at(-1)!.groups.at(-1)!.dates,['2027-01-01','2027-01-02','2027-01-03']);
});
test('Approved six-day inner retreat applied twice; outer endpoints are not shifted',()=>{
 assert.deepEqual(monthCaptionLines(6,280,120,160,111,169),{left:106,right:106});
});
test('Short and narrow groups never produce negative lengths or cover the label',()=>{
 for(let count=2;count<=6;count++)for(const width of [20,40,80,150,280])for(const labelWidth of [30,65,110]){
  const left=(width-labelWidth)/2,right=left+labelWidth;
  const lines=monthCaptionLines(count,width,left,right,width*.4,width*.6);
  assert(Number.isFinite(lines.left)&&Number.isFinite(lines.right));assert(lines.left>=0&&lines.right>=0);
  if(lines.left>0)assert(lines.left<=left-4);if(lines.right>0)assert(lines.right<=width-right-4);
 }
});
