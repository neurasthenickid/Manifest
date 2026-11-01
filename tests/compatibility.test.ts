import test from 'node:test';
import assert from 'node:assert/strict';
import {configureDailyNotes} from '../src/daily-notes';
import {defaultSettings} from '../src/settings';
import type {FileIO} from '../src/storage';
import {configureTimerHost,startTimeout,stopTimeout,disposeTimeouts,type TimerHost} from '../src/timers';
import {listVaultFiles} from '../src/vault-files';

test('custom config directory owns every Daily Notes read/write, preserves foreign settings and survives a second call',async()=>{
 const original='{ "folder":"Other", "format":"YYYY-MM-DD", "template":"Mine", "autorun":true, "custom":{"keep":7} }';
 const files=new Map([['.planner-config/daily-notes.json',original],['.planner-config/core-plugins.json','{"graph":true,"daily-notes":false,"file-explorer":true}'],['.obsidian/daily-notes.json','foreign invalid JSON must never be read'],['.obsidian/core-plugins.json','foreign core sentinel'],['Planner/Journal/user.md','# User Markdown\n![[attachment.png]]\n']]);
 const before=new Map(files),reads:string[]=[],writes:string[]=[],dirs:string[]=[];
 const io:FileIO={read:async p=>{reads.push(p);return files.get(p)??null;},write:async(p,t)=>{writes.push(p);files.set(p,t);},list:async p=>[...files.keys()].filter(k=>k.startsWith(p+'/')),mkdir:async p=>{dirs.push(p);}};
 assert.equal(await configureDailyNotes(io,defaultSettings(),'.planner-config'),true);
 const daily=JSON.parse(files.get('.planner-config/daily-notes.json')!);assert.equal(daily.autorun,true);assert.deepEqual(daily.custom,{keep:7});assert.equal(daily.folder,'Planner/Journal/01 День');
 assert.deepEqual(JSON.parse(files.get('.planner-config/core-plugins.json')!),{graph:true,'daily-notes':true,'file-explorer':true});
 for(const p of ['.obsidian/daily-notes.json','.obsidian/core-plugins.json','Planner/Journal/user.md'])assert.equal(files.get(p),before.get(p));
 assert(![...reads,...writes,...dirs].some(p=>p.startsWith('.obsidian')));
 const backup=[...files].find(([p])=>p.includes('/integration-backups/'))!;assert(JSON.parse(backup[1]).some((entry:{content:string})=>entry.content===original));
 const count=writes.length;assert.equal(await configureDailyNotes(io,defaultSettings(),'.planner-config'),false);assert.equal(writes.length,count);
 await assert.rejects(configureDailyNotes(io,defaultSettings(),''),/папка конфигурации/);
});

function host(){
 let next=0;const jobs=new Map<number,()=>void>(),cleared:number[]=[],events=new EventTarget();
 const source:TimerHost&Pick<Window,'addEventListener'|'removeEventListener'>={setTimeout:(fn)=>{const id=++next;jobs.set(id,()=>{if(typeof fn==='function')fn();});return id;},clearTimeout:id=>{if(id!==undefined){cleared.push(id);jobs.delete(id);}},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)};
 return {source,jobs,cleared,fire:()=>{for(const [id,fn]of [...jobs]){jobs.delete(id);fn();}},close:()=>events.dispatchEvent(new Event('pagehide'))};
}
test('timer handle cancels its original host even when the injected host changes',()=>{
 const a=host(),b=host();let called=0;const restoreA=configureTimerHost(a.source),first=startTimeout(()=>called++,100);const restoreB=configureTimerHost(b.source),second=startTimeout(()=>called++,100);
 stopTimeout(first);assert.deepEqual(a.cleared,[1]);assert.equal(b.jobs.size,1);a.fire();b.fire();assert.equal(called,1);stopTimeout(second);assert.deepEqual(b.cleared,[]);restoreB();restoreA();
});
test('window close and plugin unload cancel outstanding guards without callbacks or orphan handles',()=>{
 const a=host(),b=host();let calls=0;startTimeout(()=>calls++,100,a.source);const cancelled=startTimeout(()=>calls++,100,b.source);a.close();assert.equal(a.jobs.size,0);assert.equal(b.jobs.size,1);disposeTimeouts();stopTimeout(cancelled);disposeTimeouts();assert.equal(b.jobs.size,0);a.fire();b.fire();assert.equal(calls,0);assert.deepEqual(a.cleared,[1]);assert.deepEqual(b.cleared,[1]);
});
test('vault enumeration stays inside the requested subtree and observes renames without a full-vault pass',()=>{
 const entries={path:'Planner/Data',children:[{path:'Planner/Data/records',children:[{path:'Planner/Data/records/a.json'}]},{path:'Planner/Data/backups',children:[{path:'Planner/Data/backups/previous.json'}]}]};let otherVisits=0;
 const other={path:'Other',get children():never{otherVisits++;throw Error('Unrelated tree must not be traversed');}};
 const vault={getRoot:()=>({path:'',children:[entries,other]}),getAbstractFileByPath:(p:string)=>p==='Planner/Data'?entries:null};
 assert.deepEqual(listVaultFiles(vault,'Planner/Data'),['Planner/Data/records/a.json','Planner/Data/backups/previous.json']);assert.equal(otherVisits,0);
 entries.children[0].children[0].path='Planner/Data/records/renamed.json';assert.equal(listVaultFiles(vault,'Planner/Data')[0],'Planner/Data/records/renamed.json');assert.deepEqual(listVaultFiles(vault,'Missing'),[]);
});
