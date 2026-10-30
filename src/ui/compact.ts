/** Layout and input capabilities, never brand or user-agent. */
export function compactLayout(host:HTMLElement){
 const win=host.ownerDocument.defaultView!,width=host.closest<HTMLElement>('.life-planner')?.clientWidth||host.clientWidth||win.innerWidth;
 return width<=620||(win.matchMedia('(pointer: coarse)').matches&&win.innerWidth<=1024);
}
export function observeCompact(host:HTMLElement){
 const win=host.ownerDocument.defaultView!,update=()=>{const compact=compactLayout(host);if(compact!==host.classList.contains('lp-mobile')){host.classList.toggle('lp-mobile',compact);host.dispatchEvent(new Event('lp-layout-change'));}};
 const observer=new ResizeObserver(update),media=win.matchMedia('(pointer: coarse)'),viewport=win.visualViewport;observer.observe(host);media.addEventListener('change',update);win.addEventListener('resize',update);viewport?.addEventListener('resize',update);update();
 return()=>{observer.disconnect();media.removeEventListener('change',update);win.removeEventListener('resize',update);viewport?.removeEventListener('resize',update);};
}
