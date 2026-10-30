import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import type {Editor,WorkspaceLeaf,TFile} from 'obsidian';
import {openFreeNotesEditor} from '../src/ui/native-notes';
import {bindFreeNotes} from '../src/ui/note-chrome';
import type {FileIO} from '../src/storage';
/** Development only: real CodeMirror + public Editor adapter, not a claim about Obsidian host. */
export function mobileNotesHarness(io:FileIO){
 const path='Planner/Journal/mobile-native-notes-fixture.md',source='---\nlife-planner-type: day\n---\nМой верхний текст\n> [!lp-notes] Свободные записи\n> Моя запись [[Книга]]\n> - [x] Старая отметка\n\n## Другая секция\nНижний текст';let view:EditorView|undefined,host:HTMLElement|undefined;
 let saved=Promise.resolve();
 const reading=async()=>{view?.destroy();view=undefined;host?.remove();host=document.createElement('div');host.id='mobile-notes-fixture';host.className='lp-wide-note';document.body.append(host);const text=(await io.read(path))!;const box=document.createElement('div');box.className='callout';box.dataset.callout='lp-notes';box.innerHTML='<div class="callout-title">Свободные записи</div><div class="callout-content"><p></p></div>';box.querySelector('p')!.textContent=text.includes('[!lp-notes]')?'Моя запись [[Книга]]\n- [x] Старая отметка':text.split('## Свободные записи\n')[1]?.split('\n## Другая секция')[0]??'';host.append(box);bindFreeNotes(host,()=>{void edit();});};
 const edit=async()=>{const text=(await io.read(path))!;host!.replaceChildren();const editorHost=document.createElement('div');editorHost.id='mobile-native-editor';host!.append(editorHost);view=new EditorView({parent:editorHost,state:EditorState.create({doc:text,extensions:[EditorView.updateListener.of(update=>{if(update.docChanged){const value=update.state.doc.toString();saved=saved.then(()=>io.write(path,value));}})]})});
  const position=(p:{line:number;ch:number})=>view!.state.doc.line(p.line+1).from+p.ch,editor={getValue:()=>view!.state.doc.toString(),offsetToPos:(offset:number)=>{const l=view!.state.doc.lineAt(offset);return{line:l.number-1,ch:offset-l.from};},replaceRange:(insert:string,from:{line:number;ch:number},to:{line:number;ch:number})=>view!.dispatch({changes:{from:position(from),to:position(to),insert}}),setCursor:(p:{line:number;ch:number})=>view!.dispatch({selection:{anchor:position(p)}}),scrollIntoView:(r:{from:{line:number;ch:number}})=>view!.dispatch({effects:EditorView.scrollIntoView(position(r.from),{y:'center'})}),focus:()=>view!.focus()} as unknown as Editor;
  const file={path} as TFile,leaf={view:{file,editor},openFile:async()=>{},getViewState:()=>({type:'markdown',state:{file:path}}),setViewState:async()=>{}} as unknown as WorkspaceLeaf;await openFreeNotesEditor(leaf,file,async()=>{});const back=document.createElement('button');back.textContent='Показать запись';back.onclick=()=>{void saved.then(reading);};host!.prepend(back);
 };
 return{create:async()=>{if(await io.read(path)===null)await io.write(path,source);await reading();},source:async()=>{await saved;return io.read(path);},original:source,destroy:()=>{view?.destroy();host?.remove();},selection:()=>view?.state.selection.main.from};
}

