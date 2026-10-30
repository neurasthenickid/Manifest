import type {Period} from './model';
import {period} from './periods';

/** FNV-1a over UTF-16 code units followed by the Murmur3 32-bit avalanche.
 * Only specified JS integer operations; no locale, time, platform or array order.
 * Versioned domain separator keeps the scene ranking reproducible indefinitely.
 */
export function headerHash(value:string):number {
 let h=0x811c9dc5;
 for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),0x01000193);
 h^=h>>>16;h=Math.imul(h,0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);return(h^(h>>>16))>>>0;
}
/** Rendezvous hashing: adding a scene can only move dates to that scene;
 * deleting one can only move dates which selected it. One vote per stable ID.
 */
export function rankedHeaderScenes(p:Pick<Period,'type'|'start'>,ids:readonly string[]):string[]{
 const key=`life-planner-header-v1|${p.type}|${period(p.type,p.start).start}|`;
 return [...new Set(ids)].map(id=>({id,score:headerHash(key+id)}))
  .sort((a,b)=>b.score-a.score||(a.id<b.id?-1:a.id>b.id?1:0)).map(v=>v.id);
}
