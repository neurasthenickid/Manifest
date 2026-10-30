import test from 'node:test';
import assert from 'node:assert/strict';
import {centeredCalendarScroll} from '../src/ui/calendar-viewport';
test('week centers within visible days excluding sticky scale, clamped at Monday and Sunday',()=>{
 const axis=48,column=125,content=axis+column*7;
 for(const viewport of [240,320,360,390,412,900,1200])for(let day=0;day<7;day++){
  const left=axis+column*day,result=centeredCalendarScroll(viewport,content,axis,left,column);
  assert(result>=0&&result<=Math.max(0,content-viewport));
  if(result>0&&result<content-viewport)assert.equal(left+column/2-result,axis+(viewport-axis)/2);
  if(day===0)assert.equal(result,0);if(day===6)assert.equal(result,Math.max(0,content-viewport));
 }
});
