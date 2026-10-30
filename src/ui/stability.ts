/** Preserve the actual note scroller, viewport anchor and keyboard focus across local updates. */
const html=(value:Element|null|undefined):value is HTMLElement=>value?.namespaceURI==='http://www.w3.org/1999/xhtml';
const control=<K extends keyof HTMLElementTagNameMap>(value:Element|null|undefined,tag:K):value is HTMLElementTagNameMap[K]=>html(value)&&value.localName===tag;
export function preserveViewport(root:HTMLElement,anchorPosition=true){
 const doc=root.ownerDocument,win=doc.defaultView!,active=html(doc.activeElement)?doc.activeElement:undefined;
 const module=active?.closest<HTMLElement>('[data-render-module]'),task=active?.closest<HTMLElement>('[data-task-id]')?.dataset.taskId,definition=active?.closest<HTMLElement>('[data-definition-id]')?.dataset.definitionId;
 const controls=[...(module??root).querySelectorAll<HTMLElement>('input,button,select,textarea,summary')],focusIndex=active?controls.indexOf(active):-1;
 const label=active?.getAttribute('aria-label')??active?.closest('label')?.textContent??active?.textContent,tag=active?.tagName;
 const selection=control(active,'textarea')||control(active,'input')&&['text','search'].includes(active.type)?[active.selectionStart,active.selectionEnd]:undefined;
 const parents:HTMLElement[]=[];for(let p=root.parentElement;p;p=p.parentElement)if(p.scrollHeight>p.clientHeight&&/(auto|scroll)/.test(win.getComputedStyle(p).overflowY))parents.push(p);
 const scrolls=parents.map(p=>({node:p,top:p.scrollTop,left:p.scrollLeft})),windowTop=win.scrollY,windowLeft=win.scrollX;
 const top=parents[0]?.getBoundingClientRect().top??0;
 const visible=[...root.querySelectorAll<HTMLElement>('[data-render-module]')].find(n=>{const b=n.getBoundingClientRect();return b.bottom>top+1&&b.top<win.innerHeight;});
 const anchor=module??visible,anchorName=anchor?.dataset.renderModule,anchorIndex=anchor?[...root.querySelectorAll(`[data-render-module="${anchorName}"]`)].indexOf(anchor):0,anchorTop=anchor?.getBoundingClientRect().top;
 return()=>{
  const candidates=anchorName?root.querySelectorAll<HTMLElement>(`[data-render-module="${anchorName}"]`):[],nextAnchor=anchor?.isConnected?anchor:candidates[anchorIndex];
  const delta=nextAnchor&&anchorTop!==undefined?nextAnchor.getBoundingClientRect().top-anchorTop:0;
  // Rect differences already include any native scroll adjustment. Add to the
  // current offset, not the captured offset, to avoid counting it twice.
  if(scrolls.length){const first=scrolls[0];first.node.scrollTop=anchorPosition&&first.top>0?first.node.scrollTop+delta:first.top;first.node.scrollLeft=first.left;for(const s of scrolls.slice(1)){s.node.scrollTop=s.top;s.node.scrollLeft=s.left;}}
  else {const target=anchorPosition&&windowTop>0?win.scrollY+delta:windowTop;if(Math.abs(win.scrollY-target)>.5||win.scrollX!==windowLeft)win.scrollTo({left:windowLeft,top:target,behavior:'instant'});}
  if(!active||active.isConnected)return;
  const scope=task?root.querySelector<HTMLElement>(`[data-task-id="${task}"]`):definition?root.querySelector<HTMLElement>(`[data-definition-id="${definition}"]`):module?root.querySelector<HTMLElement>(`[data-render-module="${module.dataset.renderModule}"]`):root;
  const nodes=scope?[...scope.querySelectorAll<HTMLElement>('input,button,select,textarea,summary')]:[],replacement=nodes.find(n=>n.tagName===tag&&(n.getAttribute('aria-label')??n.closest('label')?.textContent??n.textContent)===label)??((task||definition)&&control(active,'input')?nodes.find(n=>control(n,'input')&&n.type===active.type):nodes[focusIndex]);
  replacement?.focus({preventScroll:true});if(selection&&(control(replacement,'textarea')||control(replacement,'input')))replacement.setSelectionRange(selection[0],selection[1]);
 };
}
