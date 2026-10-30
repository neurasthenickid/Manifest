interface Entry {host:HTMLElement;active:()=>boolean;changed:()=>void;owner:boolean}
const notes=new WeakMap<object,Map<string,Set<Entry>>>();
/** Old separate `plans`/`task-stats` embeds remain readable without editing Markdown.
 * One live renderer owns the shared statistic; disposal transfers ownership. */
export function claimStatistics(host:HTMLElement,key:string,active:()=>boolean,changed:()=>void,scope?:object){
 const root=scope??host.closest<HTMLElement>('.markdown-preview-view,.markdown-source-view')??host.parentElement??host;
 let groups=notes.get(root);if(!groups){groups=new Map();notes.set(root,groups);}let entries=groups.get(key);if(!entries){entries=new Set();groups.set(key,entries);}
 const group=entries,entry:Entry={host,active,changed,owner:false};group.add(entry);
 const first=()=>{const active=[...group].filter(e=>e.active()),connected=active.filter(e=>e.host.isConnected);return(connected.length?connected:active).sort((a,b)=>{const position=a.host.compareDocumentPosition(b.host);return a===b||position&1?0:position&2?1:-1;})[0];};
 const notify=()=>{const winner=first();for(const e of group){const owner=e===winner;if(e.owner!==owner){e.owner=owner;e.changed();}}};
 queueMicrotask(notify);
 return {owns:()=>first()===entry,release:()=>{group.delete(entry);if(!group.size)groups.delete(key);queueMicrotask(notify);}};
}
