import {EditorState,StateField,StateEffect} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {plannerEditorMarkers} from '../src/ui/editor-markers';
import {acquirePlannerWidth} from '../src/ui/layout';
/** Real CodeMirror engine, isolated from Obsidian's host-specific Markdown parser. */
export function editorHarness(){
 const host=document.createElement('div');host.id='editor-fixture';host.className='markdown-source-view is-live-preview';host.innerHTML='<div class="inline-title">Название заметки</div><div class="metadata-container">Свойства</div><div class="cm-embed-block"></div>';document.body.append(host);
 const embed=host.querySelector<HTMLElement>('.cm-embed-block')!,module=document.createElement('div');module.className='life-planner lp-concept';embed.append(module);const release=acquirePlannerWidth(module);
 const mode=StateEffect.define<boolean>(),live=StateField.define({create:()=>true,update:(old:boolean,tr)=>{for(const effect of tr.effects)if(effect.is(mode))return effect.value;return old;}});
 const original='---\nlife-planner-type: day\nlife-planner-date: 2026-10-02\n---\n%% life-planner-widgets:start %%\n\n```life-planner\ntasks\n```\n\n%% life-planner-widgets:end %%\nМой текст [[Книга]]\n- [x] Моя отметка\n';
 const view=new EditorView({parent:host,state:EditorState.create({doc:original,extensions:[live,plannerEditorMarkers(s=>s.field(live))]})});
 return{original,doc:()=>view.state.doc.toString(),source:(value:boolean)=>{host.classList.toggle('is-live-preview',!value);view.dispatch({effects:mode.of(!value)});},append:(text:string)=>view.dispatch({changes:{from:view.state.doc.length,insert:text}}),destroy:()=>{view.destroy();release();return host.classList.contains('lp-wide-note');},remove:()=>host.remove()};
}

