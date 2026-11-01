/** Development-only Obsidian DOM helpers, installed in each browser test realm. */
export function installDomHelpers(win:any){
 const doc=win.document;
 const make=(tag:string,options:any={},callback?:any,namespace?:string)=>{
  if(typeof options==='string')options={cls:options};
  const node=namespace?doc.createElementNS(namespace,tag):doc.createElement(tag);
  if(options.cls)node.setAttribute('class',Array.isArray(options.cls)?options.cls.join(' '):options.cls);
  if(options.text!==undefined)node.textContent=options.text;
  for(const [key,value]of Object.entries(options.attr??{}))if(value!==null&&value!==false)node.setAttribute(key,String(value));
  options.parent?.append(node);callback?.(node);return node;
 };
 for(const [method,tag]of [['createDiv','div'],['createSpan','span']]){
  win[method]=(o?:any,cb?:any)=>make(tag,o,cb);
  win.Node.prototype[method]=function(o?:any,cb?:any){const n=make(tag,o,cb);this.appendChild(n);return n;};
 }
 win.createFragment=()=>doc.createDocumentFragment();
 win.Node.prototype.createSvg=function(tag:string,o?:any,cb?:any){const n=make(tag,o,cb,'http://www.w3.org/2000/svg');this.appendChild(n);return n;};
 win.createEl=(tag:string,o?:any,cb?:any)=>make(tag,o,cb);
 win.Node.prototype.createEl=function(tag:string,o?:any,cb?:any){const n=make(tag,o,cb);this.appendChild(n);return n;};
 Object.defineProperty(win.Node.prototype,'win',{configurable:true,get(){return this.nodeType===9?this.defaultView:this.ownerDocument.defaultView;}});
 Object.defineProperty(win.Node.prototype,'doc',{configurable:true,get(){return this.nodeType===9?this:this.ownerDocument;}});
}
installDomHelpers(window);
