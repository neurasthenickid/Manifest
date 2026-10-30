import type {Definition} from './model';
/** Presentation only. Unknown IDs retain relative storage order and history is untouched. */
export function orderedDefinitions(definitions:readonly Definition[],order:readonly string[]=[]){const ranks=new Map(order.map((id,index)=>[id,index]));return definitions.map((definition,index)=>({definition,index})).sort((a,b)=>(ranks.get(a.definition.id)??order.length)-(ranks.get(b.definition.id)??order.length)||a.index-b.index).map(v=>v.definition);}
