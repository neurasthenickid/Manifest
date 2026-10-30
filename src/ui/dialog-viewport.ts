/** Native dialog keeps focus trapping; only its available visual viewport is sized. */
export function fitDialogViewport(dialog:HTMLElement){
 const win=dialog.ownerDocument.defaultView!,viewport=win.visualViewport;
 const update=()=>{dialog.style.setProperty('--lp-viewport-height',(viewport?.height??win.innerHeight)+'px');dialog.style.setProperty('--lp-viewport-top',(viewport?.offsetTop??0)+'px');};
 update();viewport?.addEventListener('resize',update);viewport?.addEventListener('scroll',update);win.addEventListener('resize',update);
 return()=>{viewport?.removeEventListener('resize',update);viewport?.removeEventListener('scroll',update);win.removeEventListener('resize',update);};
}
