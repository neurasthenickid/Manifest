/** One clock per owning window, shared by its mounted headers. */
interface Clock {listeners:Set<()=>void>;stop:()=>void}
const clocks=new WeakMap<Window,Clock>();
export function watchHeaderClock(listener:()=>void,host:HTMLElement):()=>void {
 const doc=host.ownerDocument,win=doc.defaultView!;let clock=clocks.get(win);
 if(!clock){
  const listeners=new Set<()=>void>();
  const refresh=()=>{if(!doc.hidden)for(const fn of listeners)fn();};
  const close=()=>{clock?.stop();listeners.clear();clocks.delete(win);};
  const timer=win.setInterval(refresh,60_000);
  win.addEventListener('focus',refresh);win.addEventListener('pageshow',refresh);win.addEventListener('pagehide',close);doc.addEventListener('visibilitychange',refresh);
  clock={listeners,stop:()=>{win.clearInterval(timer);win.removeEventListener('focus',refresh);win.removeEventListener('pageshow',refresh);win.removeEventListener('pagehide',close);doc.removeEventListener('visibilitychange',refresh);}};clocks.set(win,clock);
 }
 clock.listeners.add(listener);
 const Observer=(win as Window&{IntersectionObserver?:typeof IntersectionObserver}).IntersectionObserver;
 const observer=Observer?new Observer(entries=>{if(entries.some(e=>e.isIntersecting))listener();}):undefined;observer?.observe(host);let released=false;
 return()=>{if(released)return;released=true;observer?.disconnect();clock.listeners.delete(listener);if(!clock.listeners.size){clock.stop();if(clocks.get(win)===clock)clocks.delete(win);}};
}
