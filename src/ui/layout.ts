/** Ref-counted across independently mounted blocks; ordinary notes retain their width. */
const owners=new WeakMap<HTMLElement,{count:number;alreadyWide:boolean;previousWidth:string;previousFont:string;previousAccent:string}>();
export function acquirePlannerWidth(host:HTMLElement):()=>void {
  const view=host.closest<HTMLElement>('.markdown-preview-view, .markdown-source-view');
  if(!view)return ()=>{};
  const state=owners.get(view)??{count:0,alreadyWide:view.classList.contains('lp-wide-note'),previousWidth:view.style.getPropertyValue('--lp-note-width'),previousFont:view.style.getPropertyValue('--lp-note-font'),previousAccent:view.style.getPropertyValue('--lp-note-accent')};
  state.count++;owners.set(view,state);view.classList.add('lp-wide-note');let released=false;
  return ()=>{if(released)return;released=true;if(--state.count===0){if(!state.alreadyWide)view.classList.remove('lp-wide-note');if(state.previousWidth)view.style.setProperty('--lp-note-width',state.previousWidth);else view.style.removeProperty('--lp-note-width');if(state.previousFont)view.style.setProperty('--lp-note-font',state.previousFont);else view.style.removeProperty('--lp-note-font');if(state.previousAccent)view.style.setProperty('--lp-note-accent',state.previousAccent);else view.style.removeProperty('--lp-note-accent');owners.delete(view);}};
}
