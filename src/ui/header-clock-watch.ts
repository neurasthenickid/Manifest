/** One clock for all mounted headers. No per-card polling or assignments. */
const listeners=new Set<()=>void>();
let stop:(()=>void)|undefined;
export function watchHeaderClock(listener:()=>void,host:HTMLElement):()=>void {
 listeners.add(listener);
 if(!stop){
  const refresh=()=>{if(!document.hidden)for(const fn of listeners)fn();};
  const timer=window.setInterval(refresh,60_000);
  window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);document.addEventListener('visibilitychange',refresh);
  stop=()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',refresh);};
 }
 const observer=typeof IntersectionObserver==='undefined'?undefined:new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))listener();});observer?.observe(host);
 return()=>{observer?.disconnect();listeners.delete(listener);if(!listeners.size){stop?.();stop=undefined;}};
}
