import test from 'node:test';
import assert from 'node:assert/strict';
import type {Workspace,WorkspaceLeaf} from 'obsidian';
import {SingleCalendar,type CalendarPreferences} from '../src/ui/calendar-opening';
function fixture(restored?:'left'|'right',deferred=false){
 const preferences:CalendarPreferences={enabled:true,side:'left'},leaves:any[]=[],counts={create:0,set:0,reveal:0,load:0,detach:0,activate:0};
 const left={},right={},body={},input={isConnected:true,focus(){doc.activeElement=input;}},doc:{activeElement:any;body:any}={activeElement:input,body};
 const note={id:'note'},other={id:'other'};let hold:Promise<void>|undefined,release=()=>{},revealHook:undefined|(()=>Promise<void>);
 const listeners=new Set<(leaf:any)=>void>();
 const workspace:any={on:(_name:string,fn:(leaf:any)=>void)=>{listeners.add(fn);return fn;},offref:(fn:(leaf:any)=>void)=>listeners.delete(fn),leftSplit:left,rightSplit:right,activeLeaf:note,containerEl:{ownerDocument:doc},getLeavesOfType:()=>leaves.filter(l=>l.state==='calendar'&&!l.deferred),iterateAllLeaves:(fn:any)=>leaves.forEach(fn),getLeftLeaf:()=>make('left'),getRightLeaf:()=>make('right'),setActiveLeaf:(leaf:any,options:any)=>{assert.equal(options.focus,false);workspace.activeLeaf=leaf;counts.activate++;},revealLeaf:async(leaf:any)=>{counts.reveal++;workspace.activeLeaf=leaf;doc.activeElement=leaf.focusTarget;if(revealHook)await revealHook();}};
 function make(side:'left'|'right',saved=false){if(!saved)counts.create++;const focusTarget={},leaf:any={side,parent:side==='left'?left:right,state:saved?'calendar':'empty',deferred:saved&&deferred,focusTarget,view:{containerEl:{contains:(n:any)=>n===focusTarget}},getViewState:()=>({type:leaf.state}),setViewState:async()=>{counts.set++;if(hold)await hold;leaf.state='calendar';},loadIfDeferred:async()=>{counts.load++;leaf.deferred=false;},detach:()=>{counts.detach++;const i=leaves.indexOf(leaf);if(i>=0)leaves.splice(i,1);}};leaves.push(leaf);return leaf;}
 if(restored)make(restored,true);
 const create=()=>new SingleCalendar(workspace as Workspace,'calendar',()=>preferences.side,()=>workspace.activeLeaf?{leaf:workspace.activeLeaf}:null),opener=create();
 return{opener,create,workspace,preferences,leaves,counts,note,other,doc,input,hold:()=>{hold=new Promise<void>(r=>release=r);},release:()=>{hold=undefined;release();},onReveal:(fn:()=>Promise<void>)=>{revealHook=fn;},emit:(leaf:any)=>listeners.forEach(fn=>fn(leaf)),listenerCount:()=>listeners.size,make};
}
test('desktop startup shows exactly one calendar without stealing note or editor focus',async()=>{
 const f=fixture();await f.opener.startup(f.preferences,false);assert.equal(f.leaves.length,1);assert.deepEqual(f.counts,{create:1,set:1,reveal:1,load:1,detach:0,activate:1});assert.equal(f.workspace.activeLeaf,f.note);assert.equal(f.doc.activeElement,f.input);
 await f.opener.startup(f.preferences,false);assert.equal(f.counts.reveal,1);
});
test('restored deferred view is reused, duplicates removed, note remains active',async()=>{
 const f=fixture('left',true),original=f.leaves[0];f.make('right',true);await f.opener.startup(f.preferences,false);assert.deepEqual(f.leaves,[original]);assert.equal(f.counts.create,0);assert.equal(f.counts.set,0);assert.equal(f.counts.load,1);assert.equal(f.workspace.activeLeaf,f.note);
});
test('parallel startup and commands share creation and reuse the original on later note changes',async()=>{
 const f=fixture();f.hold();const tasks=[f.opener.startup(f.preferences,false),f.opener.open(),f.opener.open()];assert.equal(f.counts.create,1);f.release();await Promise.all(tasks);const leaf=f.leaves[0];f.workspace.activeLeaf=f.other;await f.opener.settingsChanged({...f.preferences},f.preferences,false);await f.opener.open(false);assert.equal(f.leaves[0],leaf);assert.equal(f.counts.set,1);
});
test('enabling setting immediately reveals; unrelated saves and repeated layout-ready never reopen manually collapsed dock',async()=>{
 const f=fixture();await f.opener.startup({...f.preferences,enabled:false},false);await f.opener.settingsChanged({...f.preferences,enabled:false},f.preferences,false);assert.equal(f.counts.reveal,1);const leaf=f.leaves[0];
 for(let i=0;i<4;i++)await f.opener.settingsChanged({...f.preferences},f.preferences,false);await f.opener.startup(f.preferences,false);assert.equal(f.counts.reveal,1);assert.equal(f.leaves[0],leaf);
});
test('explicit disable closes only calendar and persists disabled semantics across new controller',async()=>{
 const f=fixture();await f.opener.startup(f.preferences,false);const previous={...f.preferences};f.preferences.enabled=false;await f.opener.settingsChanged(previous,f.preferences,false);assert.equal(f.leaves.length,0);await f.create().startup(f.preferences,false);assert.equal(f.counts.create,1);assert.equal(f.workspace.activeLeaf,f.note);
});
test('side change replaces calendar only for relocation and restart reuses correct saved side',async()=>{
 const f=fixture('left');await f.opener.startup(f.preferences,false);const previous={...f.preferences};f.preferences.side='right';await f.opener.settingsChanged(previous,f.preferences,false);assert.equal(f.leaves.length,1);assert.equal(f.leaves[0].side,'right');const leaf=f.leaves[0];await f.opener.settingsChanged({...f.preferences},f.preferences,false);await f.create().startup(f.preferences,false);assert.equal(f.leaves[0],leaf);assert.equal(f.counts.create,1);assert.equal(f.counts.detach,1);
});
test('restored leaf on wrong side is relocated once to configured side',async()=>{
 const f=fixture('right');await f.opener.startup(f.preferences,false);assert.equal(f.leaves.length,1);assert.equal(f.leaves[0].side,'left');assert.equal(f.counts.create,1);assert.equal(f.counts.detach,1);
});
test('mobile startup and setting enable never expand drawer',async()=>{
 const f=fixture();await f.opener.startup(f.preferences,true);assert.equal(f.leaves.length,0);await f.opener.settingsChanged({...f.preferences,enabled:false},f.preferences,true);assert.equal(f.counts.reveal,0);assert.equal(f.workspace.activeLeaf,f.note);
 const restored=fixture('left',true);await restored.opener.startup(restored.preferences,true);assert.equal(restored.counts.load,0);assert.equal(restored.counts.reveal,0);
});
test('disable during asynchronous creation cannot resurrect or reveal an orphan calendar',async()=>{
 const f=fixture();f.hold();const start=f.opener.startup(f.preferences,false);await f.opener.settingsChanged(f.preferences,{...f.preferences,enabled:false},false);f.release();await start;assert.equal(f.leaves.length,0);assert.equal(f.counts.reveal,0);await f.opener.open();assert.equal(f.leaves.length,1);assert.equal(f.counts.create,2);
});
test('background reveal does not restore stale note or focus over newer user interaction',async()=>{
 const f=fixture(),newInput={isConnected:true};f.onReveal(async()=>{f.workspace.activeLeaf=f.other;f.doc.activeElement=newInput;});await f.opener.startup(f.preferences,false);assert.equal(f.workspace.activeLeaf,f.other);assert.equal(f.doc.activeElement,newInput);assert.equal(f.counts.activate,0);
});


test('a newer note selected while creation waits becomes the background reveal return target',async()=>{
 const f=fixture();f.hold();const opening=f.opener.startup(f.preferences,false);f.workspace.activeLeaf=f.other;f.release();await opening;assert.equal(f.workspace.activeLeaf,f.other);assert.equal(f.listenerCount(),0);
});
test('intervening user navigation is remembered even if reveal finishes by activating the calendar',async()=>{
 const f=fixture();f.onReveal(async()=>{f.workspace.activeLeaf=f.other;f.emit(f.other);f.workspace.activeLeaf=f.leaves[0];});await f.opener.startup(f.preferences,false);assert.equal(f.counts.activate,0);assert.equal(f.listenerCount(),0);
});
test('reveal failure removes the temporary focus observer',async()=>{
 const f=fixture();f.onReveal(async()=>{throw Error('reveal failed');});await assert.rejects(f.opener.startup(f.preferences,false),/reveal failed/);assert.equal(f.listenerCount(),0);
});
