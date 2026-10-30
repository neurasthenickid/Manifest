/** Development adapter only: production uses Obsidian's own icon renderer. */
export function setIcon(parent:HTMLElement,name:string){parent.textContent=name==='settings'?'⚙':'·';}
