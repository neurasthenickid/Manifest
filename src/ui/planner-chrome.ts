/** Ref-counted classes on known ancestors replace relational selectors. No polling. */
const owners=new WeakMap<HTMLElement,Map<string,{count:number;original:boolean}>>();
function own(node:HTMLElement,name:string){
 const classes=owners.get(node)??new Map<string,{count:number;original:boolean}>();owners.set(node,classes);
 const state=classes.get(name)??{count:0,original:node.classList.contains(name)};state.count++;classes.set(name,state);node.classList.add(name);let released=false;
 return()=>{if(released)return;released=true;if(--state.count===0){if(!state.original)node.classList.remove(name);classes.delete(name);if(!classes.size)owners.delete(node);}};
}
export function trackPlannerChrome(host:HTMLElement){
 const view=host.closest<HTMLElement>('.markdown-preview-view,.markdown-source-view'),releases:Array<()=>void>=[];
 if(view)for(let parent=host.parentElement;parent&&parent!==view;parent=parent.parentElement)if(parent.matches('.markdown-rendered,.cm-embed-block,.cm-preview-code-block,.cm-html-embed'))releases.push(own(parent,'lp-planner-embed'));
 let releaseConcept:(()=>void)|undefined,disposed=false;
 return {concept(enabled:boolean){if(disposed||!view)return;if(enabled&&!releaseConcept)releaseConcept=own(view,'lp-concept-note');else if(!enabled&&releaseConcept){releaseConcept();releaseConcept=undefined;}},dispose(){if(disposed)return;disposed=true;releaseConcept?.();for(const release of releases)release();}};
}
