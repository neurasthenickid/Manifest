import {startTimeout} from '../timers';
import type {Editor,TFile,WorkspaceLeaf} from 'obsidian';
import {freeNotesPatch,freeNotesPosition} from './free-notes-position';
/** Public APIs, exact source file and editor readiness; no platform-specific class identity. */
export async function openFreeNotesEditor(leaf:WorkspaceLeaf,file:TFile,reveal:(leaf:WorkspaceLeaf)=>Promise<unknown>,wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>startTimeout(resolve,ms,leaf.view.containerEl.ownerDocument.defaultView!))){
 await leaf.openFile(file,{active:true,state:{mode:'source'}});await leaf.loadIfDeferred?.();
 const state=leaf.getViewState();await leaf.setViewState({...state,type:'markdown',state:{...state.state,file:file.path,mode:'source'},active:true},{focus:true});await reveal(leaf);
 let editor:Editor|undefined;
 for(let i=0;i<30;i++){
  const view=leaf.view as unknown as {file?:TFile;editor?:Editor};const candidate=view.editor;
  if(view.file?.path===file.path&&candidate&&typeof candidate.getValue==='function'&&typeof candidate.setCursor==='function'&&typeof candidate.replaceRange==='function'){editor=candidate;break;}
  await wait(50);
 }
 if(!editor)throw new Error('Редактор заметки ещё не готов. Нажмите «Редактировать» ещё раз после загрузки.');
 const source=editor.getValue(),position=freeNotesPosition(source);if(!position)throw new Error('Раздел «Свободные записи» не найден в этой заметке.');
 const patch=freeNotesPatch(source);if(patch)editor.replaceRange(patch.replacement,editor.offsetToPos(patch.from),editor.offsetToPos(patch.to));
 const target=freeNotesPosition(editor.getValue())!;editor.setCursor(target);editor.scrollIntoView({from:target,to:target},true);editor.focus();return editor;
}
