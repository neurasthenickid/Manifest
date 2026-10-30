/** Position the day in the visible part excluding the sticky time scale. */
export function centeredCalendarScroll(viewport:number,content:number,axis:number,left:number,width:number){
 return Math.max(0,Math.min(Math.max(0,content-viewport),left+width/2-axis-(viewport-axis)/2));
}
export interface CalendarViewportState {key:string;left?:number}
/** One initial placement; subsequent renders restore the user's position.
 * Hidden/deferred notes wait for actual layout rather than saving zero widths. */
export function bindCalendarViewport(scroller:HTMLElement,state:CalendarViewportState,date:string){
 const win=scroller.ownerDocument.defaultView!;let ready=false,disposed=false;
 const place=()=>{if(disposed||ready||!scroller.isConnected||scroller.clientWidth<=0)return;
  const target=scroller.querySelector<HTMLElement>(`.lp-timeline[data-date="${date}"]`),axis=scroller.querySelector<HTMLElement>('.lp-time-axis');
  if(!target||!axis)return;
  const rect=target.getBoundingClientRect(),view=scroller.getBoundingClientRect();
  scroller.scrollLeft=state.left??centeredCalendarScroll(scroller.clientWidth,scroller.scrollWidth,axis.getBoundingClientRect().width,rect.left-view.left+scroller.scrollLeft-scroller.clientLeft,rect.width);
  ready=true;state.left=scroller.scrollLeft;
 };
 const remember=()=>{if(ready)state.left=scroller.scrollLeft;};
 const observer=new ResizeObserver(place);observer.observe(scroller);scroller.addEventListener('scroll',remember,{passive:true});
 const frame=win.requestAnimationFrame(place);
 return()=>{disposed=true;if(ready)state.left=scroller.scrollLeft;win.cancelAnimationFrame(frame);observer.disconnect();scroller.removeEventListener('scroll',remember);};
}
