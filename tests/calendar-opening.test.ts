import test from 'node:test';
import assert from 'node:assert/strict';
import type {Workspace,WorkspaceLeaf} from 'obsidian';
import {SingleCalendar} from '../src/ui/calendar-opening';
function fixture(restored=false,deferred=false){
 let creates=0,sets=0,reveals=0,loads=0,fail=false;let release=()=>{};
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const leaf={getViewState:()=>({type:restored?'calendar':'empty'}),loadIfDeferred:async()=>{loads++;},setViewState:async()=>{sets++;await gate;if(fail)throw Error('failed');restored=true;}} as unknown as WorkspaceLeaf;
 const workspace={getLeavesOfType:()=>restored&&!deferred?[leaf]:[],iterateAllLeaves:(fn:(leaf:WorkspaceLeaf)=>void)=>fn(leaf),getLeftLeaf:()=>{creates++;return leaf;},getRightLeaf:()=>{creates++;return leaf;},revealLeaf:async()=>{reveals++;}} as unknown as Workspace;
 return{opener:new SingleCalendar(workspace,'calendar',()=> 'right'),release,fail:()=>{fail=true;},counts:()=>({creates,sets,reveals,loads})};
}
test('startup reuses a restored calendar without resetting its view or revealing sidebar',async()=>{const f=fixture(true);await f.opener.open(false);assert.deepEqual(f.counts(),{creates:0,sets:0,reveals:0,loads:0});});
test('startup recognizes a restored deferred calendar by saved view state',async()=>{const f=fixture(true,true);await f.opener.open(false);await f.opener.open();assert.deepEqual(f.counts(),{creates:0,sets:0,reveals:1,loads:1});});
test('parallel startup and commands create exactly one calendar, future commands reuse it',async()=>{const f=fixture();const pending=[f.opener.open(false),f.opener.open(),f.opener.open()];assert.equal(f.counts().creates,1);f.release();await Promise.all(pending);await f.opener.open();assert.deepEqual(f.counts(),{creates:1,sets:1,reveals:3,loads:3});});
test('failed opening releases its lock and allows retry',async()=>{const f=fixture();f.fail();const opening=f.opener.open(false);f.release();await assert.rejects(opening,/failed/);await assert.rejects(f.opener.open(false),/failed/);assert.equal(f.counts().creates,2);});
test('existing calendar duplicates are removed, original and unrelated note leaves remain untouched',async()=>{
 const removed:string[]=[];const make=(id:string,type:string)=>({getViewState:()=>({type}),detach:()=>removed.push(id)}) as unknown as WorkspaceLeaf;
 const original=make('original','calendar'),extra=make('extra','calendar'),note=make('note','markdown');
 const workspace={getLeavesOfType:()=>[original],iterateAllLeaves:(fn:(leaf:WorkspaceLeaf)=>void)=>[original,extra,note].forEach(fn)} as unknown as Workspace;
 await new SingleCalendar(workspace,'calendar',()=> 'right').open(false);assert.deepEqual(removed,['extra']);
});
test('older Obsidian without deferred API still reveals its existing calendar',async()=>{
 let revealed=0;const leaf={getViewState:()=>({type:'calendar'})} as unknown as WorkspaceLeaf;
 const workspace={getLeavesOfType:()=>[leaf],iterateAllLeaves:()=>{},revealLeaf:async()=>{revealed++;}} as unknown as Workspace;
 await new SingleCalendar(workspace,'calendar',()=> 'right').open();assert.equal(revealed,1);
});
