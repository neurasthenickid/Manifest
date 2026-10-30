import {StateField,type EditorState,type Extension} from '@codemirror/state';
import {Decoration,EditorView,type DecorationSet} from '@codemirror/view';
import {WIDGET_START,WIDGET_END,LEGACY_WIDGET_START,LEGACY_WIDGET_END} from '../notes';
import {isLocalDate} from '../periods';
/** Decorations only: the original Markdown, cursor history and undo remain intact. */
export function markerRanges(text:string):{from:number;to:number}[]{
 const meta=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
 if(!meta||!/^life-planner-type:\s*(day|week|month|quarter|year)\s*$/m.test(meta)||!isLocalDate(/^life-planner-date:\s*(\S+)\s*$/m.exec(meta)?.[1]))return [];
 const out:{from:number;to:number}[]=[];let offset=0,fence:string|undefined,managed=false,starts=0,ends=0;
 for(const line of text.split('\n')){const trim=line.trim(),match=/^(`{3,}|~{3,})/.exec(trim);if(match){if(!fence)fence=match[1];else if(match[1][0]===fence[0]&&match[1].length>=fence.length&&trim===match[1])fence=undefined;offset+=line.length+1;continue;}
  if(!fence){const start=trim===WIDGET_START||trim===LEGACY_WIDGET_START,end=trim===WIDGET_END||trim===LEGACY_WIDGET_END;if(start&&managed||end&&!managed)return[];if(start)starts++;if(end)ends++;if(start||end||managed&&!trim){const to=Math.min(text.length,offset+line.length+1);if(to>offset)out.push({from:offset,to});}if(start)managed=true;if(end)managed=false;}offset+=line.length+1;
 }return starts===1&&ends===1&&!managed?out:[];
}
export function plannerEditorMarkers(isLive:(state:EditorState)=>boolean):Extension{
 const build=(state:EditorState)=>isLive(state)?Decoration.set(markerRanges(state.doc.toString()).map(r=>Decoration.replace({block:true,inclusive:false}).range(r.from,r.to))):Decoration.none;
 return StateField.define<DecorationSet>({create:build,update(_old,tr){return build(tr.state);},provide:field=>EditorView.decorations.from(field)});
}
