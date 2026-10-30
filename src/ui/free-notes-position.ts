/** Reserved section locator that ignores fenced examples, including nested shorter fences. */
function section(markdown:string):{heading:number;kind:'callout'|'heading';line:number;ch:number}|null{
 const lines=markdown.split(/\r?\n/);let fence='';
 for(let i=0;i<lines.length;i++){
  const marker=lines[i].match(/^\s*(`{3,}|~{3,})/);
  if(marker){if(!fence)fence=marker[1];else if(fence[0]===marker[1][0]&&marker[1].length>=fence.length&&/^\s*(`{3,}|~{3,})\s*$/.test(lines[i]))fence='';continue;}
  if(fence)continue;
  if(/^\s*>\s*\[!lp-notes\][+-]?(?:\s|$)/i.test(lines[i])){const next=lines[i+1]?.match(/^(\s*>\s?)/);return{heading:i,kind:'callout',...(next?{line:i+1,ch:next[1].length}:{line:i,ch:lines[i].length})};}
  if(/^#{1,6}\s+Свободные записи\s*$/.test(lines[i]))return{heading:i,kind:'heading',...(i+1<lines.length?{line:i+1,ch:0}:{line:i,ch:lines[i].length})};
 }
 return null;
}
/** Native Markdown cursor, no text stored outside the note. */
export function freeNotesPosition(markdown:string):{line:number;ch:number}|null{const found=section(markdown);return found?{line:found.line,ch:found.ch}:null;}
/** Narrow, undoable edit of the old reserved block. Outside bytes are identical. */
export function freeNotesPatch(markdown:string):{from:number;to:number;replacement:string}|null{
 const found=section(markdown);if(!found)return null;const lines=markdown.split('\n'),heading=found.heading;if(found.kind==='heading')return heading===lines.length-1?{from:markdown.length,to:markdown.length,replacement:markdown.includes('\r\n')?'\r\n\r\n':'\n\n'}:null;let end=heading+1;while(end<lines.length&&/^\s*>/.test(lines[end]))end++;
 const from=lines.slice(0,heading).reduce((n,line)=>n+line.length+1,0),to=from+lines.slice(heading,end).join('\n').length,ending=lines[heading].endsWith('\r')?'\r':'',body=lines.slice(heading+1,end).map(line=>line.replace(/^\s*> ?/,''));
 return{from,to,replacement:['## Свободные записи'+ending,...(body.length?body:['',''])].join('\n')};
}
