/** Browser-only workspace imitation. Exercises production SingleCalendar and settings renderer. */
import {SingleCalendar,type CalendarPreferences} from '../src/ui/calendar-opening';
import type {Workspace,WorkspaceLeaf} from 'obsidian';
export function calendarDockingHarness(host:HTMLElement,render:()=>Promise<void>,get:()=>CalendarPreferences){
 let controller:SingleCalendar,leaves:any[]=[],mobile=false,creates=0,sets=0,reveals=0,detaches=0,loads=0;
 const note={id:'current-note'},left={},right={};
 const workspace:any={on:()=>({}),offref:()=>{},leftSplit:left,rightSplit:right,containerEl:document.body,activeLeaf:note,getLeavesOfType:()=>leaves.filter(l=>l.type==='calendar'&&!l.deferred),iterateAllLeaves:(fn:any)=>leaves.forEach(fn),getLeftLeaf:()=>make('left'),getRightLeaf:()=>make('right'),setActiveLeaf:(leaf:any)=>{workspace.activeLeaf=leaf;},revealLeaf:async(leaf:any)=>{reveals++;host.hidden=false;host.dataset.side=leaf.side;workspace.activeLeaf=leaf;host.querySelector('button')?.focus();}};
 function make(side:'left'|'right',restored=false){if(!restored)creates++;const leaf:any={side,parent:side==='left'?left:right,type:restored?'calendar':'empty',deferred:restored,view:{containerEl:host},getViewState:()=>({type:leaf.type}),setViewState:async()=>{sets++;leaf.type='calendar';await render();},loadIfDeferred:async()=>{loads++;if(leaf.deferred){leaf.deferred=false;await render();}},detach:()=>{detaches++;leaves=leaves.filter(l=>l!==leaf);if(!leaves.length){host.hidden=true;host.replaceChildren();}}};leaves.push(leaf);return leaf;}
 const create=()=>new SingleCalendar(workspace as Workspace,'calendar',()=>get().side,()=>workspace.activeLeaf?{leaf:workspace.activeLeaf}:null);
 return {
  setup:(options:{mobile?:boolean;restored?:boolean}={})=>{leaves=[];mobile=!!options.mobile;creates=sets=reveals=detaches=loads=0;host.hidden=true;host.replaceChildren();workspace.activeLeaf=note;if(options.restored)make(get().side,true);controller=create();},
  startup:()=>controller.startup(get(),mobile),
  open:()=>controller.open(),
  changed:(old:CalendarPreferences,next:CalendarPreferences)=>controller?.settingsChanged(old,next,mobile),
  collapse:()=>{host.hidden=true;},
  noteChanged:()=>{workspace.activeLeaf=note;},
  restart:async()=>{controller=create();await controller.startup(get(),mobile);},
  snapshot:()=>({creates,sets,reveals,detaches,loads,leaves:leaves.length,visible:!host.hidden,side:leaves[0]?.side,noteActive:workspace.activeLeaf===note}),
 };
}

