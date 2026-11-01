import {installDomHelpers} from './dom-harness';
import {el,detachedEl} from '../src/ui/elements';
import {bindFreeNotes} from '../src/ui/note-chrome';
import {bindSelection} from '../src/ui/calendar-gestures';
import {bindKanbanGestures,HOLD_MS} from '../src/ui/kanban-gestures';
import {PlannerWidget} from '../src/ui/widget';
import {RecordStore,type FileIO} from '../src/storage';
import {defaultSettings} from '../src/settings';
import {period} from '../src/periods';
import {startTimeout} from '../src/timers';
import type {TaskStatus} from '../src/model';

const expect=(value:unknown,message:string)=>{if(!value)throw Error(message);};
export async function runCompatibility(){
 const checks:string[]=[],frame=document.createElement('iframe');frame.style.cssText='width:390px;height:900px;display:block';document.body.prepend(frame);
 const win=frame.contentWindow!,doc=win.document;installDomHelpers(win);doc.body.style.margin='0';
 const css=doc.createElement('link');css.rel='stylesheet';css.href=location.origin+'/styles.css';await new Promise<void>((resolve,reject)=>{css.onload=()=>resolve();css.onerror=()=>reject(Error('Frame stylesheet failed'));doc.head.append(css);});
 const counters={intervals:new Set<number>(),timeouts:new Set<number>(),listeners:new Map<EventListenerOrEventListenerObject,Set<string>>()};
 const interval=win.setInterval.bind(win),clearInterval=win.clearInterval.bind(win),timeout=win.setTimeout.bind(win),clearTimeout=win.clearTimeout.bind(win),add=win.addEventListener.bind(win),remove=win.removeEventListener.bind(win);
 win.setInterval=((fn:TimerHandler,ms?:number)=>{const id=interval(fn,ms);counters.intervals.add(id);return id;}) as typeof win.setInterval;
 win.clearInterval=id=>{if(id!==undefined)counters.intervals.delete(id);clearInterval(id);};
 win.setTimeout=((fn:TimerHandler,ms?:number)=>{const id=timeout(()=>{counters.timeouts.delete(id);if(typeof fn==='function')fn();},ms);counters.timeouts.add(id);return id;}) as typeof win.setTimeout;
 win.clearTimeout=id=>{if(id!==undefined)counters.timeouts.delete(id);clearTimeout(id);};
 win.addEventListener=((type:string,fn:EventListenerOrEventListenerObject,options?:any)=>{const types=counters.listeners.get(fn)??new Set<string>();types.add(type);counters.listeners.set(fn,types);add(type,fn,options);}) as typeof win.addEventListener;
 win.removeEventListener=((type:string,fn:EventListenerOrEventListenerObject,options?:any)=>{const types=counters.listeners.get(fn);types?.delete(type);if(!types?.size)counters.listeners.delete(fn);remove(type,fn,options);}) as typeof win.removeEventListener;
 const realm=win as Window&{PointerEvent:typeof PointerEvent;MouseEvent:typeof MouseEvent;Event:typeof Event};
 const pointer=(node:EventTarget,type:string,x:number,y:number,kind='touch')=>node.dispatchEvent(new realm.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:7,pointerType:kind,button:0,clientX:x,clientY:y}));
 const pause=(ms=0)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
 try{
  const node=el('div',doc.body),temp=detachedEl(node,'button');expect(node.ownerDocument===doc&&temp.ownerDocument===doc&&!temp.isConnected,'Wrong owner document or attached temporary node');
  const notes=el('div',doc.body);notes.innerHTML='<div class="callout" data-callout="lp-notes"><div class="callout-title">Old</div><div class="callout-content"><span>My text</span></div></div>';let edits=0;bindFreeNotes(notes,()=>edits++);notes.querySelector('span')!.dispatchEvent(new realm.MouseEvent('click',{bubbles:true}));expect(edits===1&&notes.textContent!.includes('My text'),'Cross-realm notes click failed');checks.push('Owner-document public DOM helpers, detached nodes and cross-realm free-notes actions');
  const files=new Map<string,string>(),io:FileIO={read:async p=>files.get(p)??null,write:async(p,t)=>{files.set(p,t);},mkdir:async()=>{},list:async p=>[...files.keys()].filter(k=>k.startsWith(p+'/'))};const store=new RecordStore(io);await store.load();
  const settings=defaultSettings();settings.theme='concept';settings.layouts.day=['navigation','day-rating'];
  const view=el('article',doc.body,undefined,'markdown-preview-view lp-wide-note'),wrapper=el('div',view,undefined,'markdown-rendered'),a=el('div',wrapper),b=el('div',wrapper);
  const actions={settings:()=>settings,openPeriod:async()=>{},openNote:async()=>{},openArea:async()=>{},exportData:async()=>{},recover:async()=>{},issues:()=>[]};
  const first=new PlannerWidget(a,store,period('day','2026-11-01'),actions),second=new PlannerWidget(b,store,period('day','2026-11-01'),actions);
  expect(view.classList.contains('lp-concept-note')&&wrapper.classList.contains('lp-planner-embed'),'Managed classes missing');expect(counters.intervals.size>=2,'Widget clocks not attached to owner window');
  const input=a.querySelector<HTMLInputElement>('input[type=range]')!;expect(!!input,'Rating input missing');let wrongRealm=false;input.addEventListener('input',event=>{if(!(event instanceof realm.Event))wrongRealm=true;});
  const rect=input.getBoundingClientRect();pointer(input,'pointerdown',rect.left+20,rect.top+8);pointer(window,'pointermove',rect.right-15,rect.top+8);const before=input.value;pointer(win,'pointermove',rect.right-15,rect.top+8);expect(input.value!==before,'Owner-window range movement failed');pointer(win,'pointerup',rect.right-15,rect.top+8);await pause(30);
  const rating=store.all('day-rating')[0];expect(!!rating&&rating.version===1&&!wrongRealm,'Range event realm, save count or persistence failed');expect(a.querySelector('input[type=range]')===input,'Input replaced during drag');
  pointer(input,'pointerdown',rect.left+10,rect.top+8);pointer(win,'pointercancel',rect.left+10,rect.top+8);await pause();expect(store.all('day-rating')[0].version===1,'Cancelled range wrote data');checks.push('Production rating drag in second document: continuous, one save, stable node, cancel and foreign-window isolation');
  first.destroy();expect(wrapper.classList.contains('lp-planner-embed')&&view.classList.contains('lp-concept-note'),'First widget removed shared classes');startTimeout(()=>{throw Error('Closed window timer executed');},10000,win);win.dispatchEvent(new realm.Event('pagehide'));second.destroy();expect(!wrapper.classList.contains('lp-planner-embed')&&!view.classList.contains('lp-concept-note'),'Classes leaked after last owner');expect(counters.intervals.size===0&&counters.timeouts.size===0,'Window close leaked widget timers');checks.push('Ref-counted chrome classes, pagehide and widget unload restore DOM and cancel owner clocks');
  doc.body.replaceChildren();const timeline=el('div',doc.body);timeline.style.cssText='height:960px;width:300px;position:relative';let captures=new Set<number>();timeline.setPointerCapture=id=>{captures.add(id);};timeline.hasPointerCapture=id=>captures.has(id);timeline.releasePointerCapture=id=>{captures.delete(id);};let creations=0;const unselect=bindSelection(timeline,'2026-11-01',()=>creations++);pointer(timeline,'pointerdown',20,20,'mouse');pointer(timeline,'pointermove',40,90,'mouse');expect(timeline.querySelector('.lp-selection')?.ownerDocument===doc,'Selection ghost document');win.dispatchEvent(new realm.Event('blur'));pointer(timeline,'pointerup',40,90,'mouse');unselect();expect(!timeline.querySelector('.lp-selection')&&!captures.size&&creations===0,'Cancelled calendar gesture leaked or saved');checks.push('Calendar selection ghost and capture cancelled on owning-window blur');
  doc.body.replaceChildren();const root=el('div',doc.body,undefined,'life-planner lp-mobile'),board=el('div',root,undefined,'lp-kanban'),tabs=el('div',board,undefined,'lp-kanban-tabs');
  for(const status of ['todo','doing','done']){const tab=el('button',tabs,status);tab.dataset.dropStatus=status;tab.style.cssText='width:100px;min-height:44px';}
  const card=el('div',board,undefined,'lp-kanban-card');card.dataset.taskId='same-stable-id';const handle=el('button',card,'Move','lp-task-drag-handle');handle.style.cssText='width:44px;height:44px';el('span',card,'Fixture task');let status:TaskStatus='todo',drops=0;
  const unkanban=bindKanbanGestures(board,tabs,()=>status,next=>{status=next;},(id,next)=>{expect(id==='same-stable-id','Lost task ID');status=next;drops++;},root);
  win.scrollTo(0,0);const hold=async()=>{const r=handle.getBoundingClientRect();pointer(handle,'pointerdown',r.left+10,r.top+10);await pause(HOLD_MS+40);expect(!!doc.querySelector('.lp-task-drag-ghost'),'Held handle did not start drag');};
  await hold();const target=tabs.querySelector<HTMLElement>('[data-drop-status=doing]')!,targetRect=target.getBoundingClientRect();pointer(win,'pointermove',targetRect.left+10,targetRect.top+10);expect(target.classList.contains('is-drop-target'),'Drop target not highlighted');pointer(win,'pointerup',targetRect.left+10,targetRect.top+10);expect(drops===1&&String(status)==='doing','Held drop did not update once');
  await hold();pointer(win,'pointercancel',0,0);pointer(win,'pointerup',targetRect.left+10,targetRect.top+10);expect(drops===1&&!doc.querySelector('.lp-task-drag-ghost'),'Cancelled hold changed status');
  await hold();pointer(win,'pointerup',-20,-20);expect(drops===1,'Outside drop changed status');
  pointer(board,'pointerdown',200,100);pointer(win,'pointermove',120,105);pointer(win,'pointerup',120,105);expect(String(status)==='done'&&drops===1,'Swipe must only select tab');
  pointer(board,'pointerdown',200,100);pointer(win,'pointermove',205,200);pointer(win,'pointerup',205,200);expect(String(status)==='done'&&drops===1,'Vertical scroll changed status');
  await hold();win.dispatchEvent(new realm.Event('pagehide'));pointer(win,'pointerup',targetRect.left+10,targetRect.top+10);expect(drops===1,'Window close committed a drop');unkanban();expect(!doc.querySelector('.lp-kanban-tab-portal,.lp-kanban-tab-placeholder,.lp-task-drag-ghost')&&counters.timeouts.size===0,'Kanban resources leaked');checks.push('Second-document kanban: held drop once, target, cancel/outside/pagehide, swipe-only view and vertical scrolling');
  expect(counters.listeners.size===0,'Owner-window event listeners leaked: '+[...counters.listeners.values()].flatMap(types=>[...types]).join(','));checks.push('No remaining owner-window event listeners or timers after cleanup');return checks;
 }finally{frame.remove();}
}
Object.assign(window,{compatibilityTest:{run:runCompatibility}});
