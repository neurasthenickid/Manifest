import type {TaskStatus} from '../model';
import {compactLayout} from './compact';
export const HOLD_MS=350;
interface DragState{pointer:number;id:string;x:number;y:number;handle:HTMLElement;active:boolean;timer:number;target?:HTMLElement;ghost?:HTMLElement}
export function swipeStatus(current:TaskStatus,dx:number,dy:number):TaskStatus{const states:TaskStatus[]=['todo','doing','done'];if(Math.abs(dx)<40||Math.abs(dx)<Math.abs(dy)*1.5)return current;return states[Math.max(0,Math.min(2,states.indexOf(current)+(dx<0?1:-1)))];}
/** Touch dragging starts only on a held handle. Native card scroll is not captured. */
export function bindKanbanGestures(board:HTMLElement,tabs:HTMLElement,current:()=>TaskStatus,select:(status:TaskStatus)=>void,drop:(id:string,status:TaskStatus)=>void,root?:HTMLElement){
 const doc=board.ownerDocument,win=doc.defaultView!;let drag:DragState|undefined,swipe:{pointer:number;x:number;y:number;dx:number;dy:number}|undefined,suppressClick=false;
 let barRestore:(()=>void)|undefined,portal:HTMLElement|undefined;
 const pinTabs=()=>{
  const rect=tabs.getBoundingClientRect();const placeholder=doc.createElement('div');placeholder.className='lp-kanban-tab-placeholder';placeholder.style.height=rect.height+'px';tabs.before(placeholder);
  // Scroll containers clip ordinary sticky headers. Pin only during a drag to the
  // top of the visible note area, below Obsidian's actual header/drawer chrome.
  let scroll=board.parentElement;while(scroll&&!(scroll.scrollHeight>scroll.clientHeight&&/(auto|scroll)/.test(win.getComputedStyle(scroll).overflowY)))scroll=scroll.parentElement;
  const top=Math.max(win.visualViewport?.offsetTop??0,scroll?.getBoundingClientRect().top??0);const style=tabs.getAttribute('style');
  portal=doc.createElement('div');portal.className=(board.closest('.life-planner')?.className??'life-planner lp-mobile')+' lp-kanban-tab-portal';const computed=win.getComputedStyle(board);portal.style.font=computed.font;portal.style.color=computed.color;for(const key of ['--lp-accent','--background-primary','--background-secondary','--background-modifier-border','--text-normal','--text-muted'])portal.style.setProperty(key,computed.getPropertyValue(key));doc.body.append(portal);portal.append(tabs);
  tabs.classList.add('is-drag-pinned');tabs.style.left=rect.left+'px';tabs.style.width=rect.width+'px';tabs.style.top=Math.max(top+6,6)+'px';
  return()=>{tabs.classList.remove('is-drag-pinned');if(style===null)tabs.removeAttribute('style');else tabs.setAttribute('style',style);placeholder.replaceWith(tabs);portal?.remove();portal=undefined;};
 };
 const cleanupDrag=()=>{const active=drag;drag=undefined;if(!active)return;win.clearTimeout(active.timer);active.ghost?.remove();board.classList.remove('is-transferring');tabs.classList.remove('has-drop-targets');for(const b of tabs.children)b.classList.remove('is-drop-target');barRestore?.();barRestore=undefined;if(active.handle.hasPointerCapture(active.pointer))active.handle.releasePointerCapture(active.pointer);};
 const abort=()=>{if(drag?.active)suppressClick=true;cleanupDrag();swipe=undefined;};
 const targetAt=(event:PointerEvent)=>{const hit=doc.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-drop-status]');return hit&&tabs.contains(hit)?hit:undefined;};
 const down=(event:PointerEvent)=>{
  if(!compactLayout(board)||event.button!==0)return;
  if(drag||swipe){abort();return;}suppressClick=false;const node=event.target as Element,handle=node.closest<HTMLElement>('.lp-task-drag-handle');
  if(handle){const id=handle.closest<HTMLElement>('[data-task-id]')?.dataset.taskId;if(!id)return;event.stopPropagation();event.preventDefault();const state:DragState={pointer:event.pointerId,id,x:event.clientX,y:event.clientY,handle,active:false,timer:0};drag=state;try{handle.setPointerCapture(event.pointerId);}catch{/* Window handlers provide a fallback for synthetic events. */}
   state.timer=win.setTimeout(()=>{if(drag!==state||!handle.isConnected||doc.hidden)return;state.active=true;board.classList.add('is-transferring');tabs.classList.add('has-drop-targets');barRestore=pinTabs();const card=handle.closest<HTMLElement>('.lp-kanban-card')!,ghost=card.cloneNode(true) as HTMLElement;ghost.classList.remove('lp-kanban-card');ghost.classList.add('lp-task-drag-ghost');ghost.removeAttribute('data-task-id');ghost.draggable=false;ghost.setAttribute('aria-hidden','true');ghost.querySelectorAll('.lp-task-drag-handle,.lp-mobile-task-menu,.lp-card-menu').forEach(e=>e.remove());ghost.querySelectorAll<HTMLInputElement>('input').forEach(e=>{e.disabled=true;e.tabIndex=-1;});ghost.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));ghost.style.width=Math.min(card.getBoundingClientRect().width,280)+'px';ghost.style.left=(state.x-30)+'px';ghost.style.top=(state.y+10)+'px';portal!.append(ghost);state.ghost=ghost;},HOLD_MS);return;
  }
  if(node.closest('button,input,select,textarea,a,summary'))return;swipe={pointer:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0};
 };
 const move=(event:PointerEvent)=>{
  if(drag?.pointer===event.pointerId){if(!drag.active){if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>8)cleanupDrag();return;}event.preventDefault();event.stopPropagation();for(const b of tabs.children)b.classList.remove('is-drop-target');drag.target=targetAt(event);drag.target?.classList.add('is-drop-target');if(drag.ghost){drag.ghost.style.left=event.clientX-30+'px';drag.ghost.style.top=event.clientY+10+'px';}return;}
  if(swipe?.pointer===event.pointerId){swipe.dx=event.clientX-swipe.x;swipe.dy=event.clientY-swipe.y;if(Math.abs(swipe.dy)>Math.abs(swipe.dx)&&Math.abs(swipe.dy)>10){swipe=undefined;return;}if(Math.abs(swipe.dx)>20&&Math.abs(swipe.dx)>Math.abs(swipe.dy)*1.5){event.preventDefault();event.stopPropagation();}}
 };
 const up=(event:PointerEvent)=>{
  if(drag?.pointer===event.pointerId){const state=drag,target=state.active?targetAt(event):undefined;const status=target?.dataset.dropStatus as TaskStatus|undefined;if(state.active){event.preventDefault();event.stopPropagation();suppressClick=true;}cleanupDrag();if(status&&['todo','doing','done'].includes(status)){select(status);drop(state.id,status);}return;}
  if(swipe?.pointer===event.pointerId){const next=swipeStatus(current(),event.clientX-swipe.x,event.clientY-swipe.y);swipe=undefined;if(next!==current()){event.preventDefault();event.stopPropagation();suppressClick=true;select(next);}}
 };
 const cancel=(event:PointerEvent)=>{if(drag?.pointer===event.pointerId||swipe?.pointer===event.pointerId)abort();},hidden=()=>{if(doc.hidden)abort();},click=(event:MouseEvent)=>{if(suppressClick){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}};
 root??=board.closest<HTMLElement>('.life-planner')??undefined;const viewport=win.visualViewport,touch=(event:TouchEvent)=>{if(compactLayout(root??board))event.stopPropagation();};
 board.addEventListener('pointerdown',down);board.addEventListener('click',click,true);board.addEventListener('touchstart',touch,{passive:true});board.addEventListener('touchmove',touch,{passive:true});board.addEventListener('touchend',touch,{passive:true});win.addEventListener('pointermove',move,{capture:true,passive:false});win.addEventListener('pointerup',up,true);win.addEventListener('pointercancel',cancel,true);win.addEventListener('blur',abort);win.addEventListener('resize',abort);win.addEventListener('orientationchange',abort);viewport?.addEventListener('resize',abort);doc.addEventListener('visibilitychange',hidden);root?.addEventListener('lp-layout-change',abort);
 return()=>{abort();board.removeEventListener('pointerdown',down);board.removeEventListener('click',click,true);board.removeEventListener('touchstart',touch);board.removeEventListener('touchmove',touch);board.removeEventListener('touchend',touch);win.removeEventListener('pointermove',move,true);win.removeEventListener('pointerup',up,true);win.removeEventListener('pointercancel',cancel,true);win.removeEventListener('blur',abort);win.removeEventListener('resize',abort);win.removeEventListener('orientationchange',abort);viewport?.removeEventListener('resize',abort);doc.removeEventListener('visibilitychange',hidden);root?.removeEventListener('lp-layout-change',abort);};
}
