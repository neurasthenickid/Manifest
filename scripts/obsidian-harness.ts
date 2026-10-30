/** Development-only adapter for exercising ItemView lifecycle. This is not Obsidian acceptance. */
export class TFile{path='';}
export class ItemView{
 contentEl:HTMLElement;app:any;
 constructor(leaf:any){this.contentEl=leaf.contentEl;this.app=leaf.app;}
 registerEvent(_ref:unknown){}
}
/** Browser-only icon adapter; actual releases use Obsidian's built-in Lucide renderer. */
export function setIcon(parent:HTMLElement,name:string){
 const shapes:Record<string,string[]>={
  'star':['m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2L12 17.3l-5.7 3 1.1-6.2L3 9.6l6.2-.9Z'],
  'leaf':['M20 4C6 2 2 10 6 17s16 2 14-13Z','M5 20 15 10'],
  'circle':['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],
  'sun':['M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z','M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5'],
  'chevron-left':['m15 18-6-6 6-6'],'chevron-right':['m9 18 6-6-6-6'],
  'arrow-up':['m5 12 7-7 7 7','M12 5v14'],'arrow-down':['m5 12 7 7 7-7','M12 5v14'],'plus':['M12 5v14','M5 12h14'],
  'grip-vertical':['M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01'],
  'settings':['m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z','M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
  'layers':['m12 3 10 6-10 6L2 9Z','m2 15 10 6 10-6','m2 12 10 6 10-6'],
  'heart':['M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.9-8.6a5.5 5.5 0 0 0-.1-7.8Z'],
  'house':['m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z','M9 21V12h6v9'],
  'briefcase-business':['M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z','M8 7V4h8v3','M2 12h20','M12 10v4'],
  'book-open':['M12 7v14','M12 7c-3-3-6-3-10-3v15c4 0 7 0 10 2 3-2 6-2 10-2V4c-4 0-7 0-10 3Z'],
  'user-round':['M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z','M4 21v-2a8 8 0 0 1 16 0v2'],
  'calendar-check':['M4 4h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z','M16 2v4M8 2v4M2 10h20','m9 16 2 2 4-4']
 };
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','2');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.classList.add('svg-icon');
 for(const d of shapes[name]??[]){const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',d);svg.append(p);}parent.replaceChildren(svg);
}
