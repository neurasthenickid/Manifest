import {LEGACY_WIDGET_START,LEGACY_WIDGET_END,WIDGET_START,WIDGET_END} from '../notes';
/** Hide only exact reserved marker paragraphs in reading view. Never changes Markdown. */
export function hidePlannerMarkers(container:HTMLElement){
 const markers=[LEGACY_WIDGET_START,LEGACY_WIDGET_END,WIDGET_START,WIDGET_END];
 for(const p of [container,...container.querySelectorAll<HTMLElement>('p')])if(markers.includes(p.textContent?.trim()??''))p.hidden=true;
}

/** Native editor action on a user-owned callout. Handlers live only on its DOM. */
export function bindFreeNotes(container:HTMLElement,edit:()=>void){
 const boxes=[...container.querySelectorAll<HTMLElement>('.callout[data-callout="lp-notes"],.lp-free-notes[data-callout="lp-notes"]')];
 if(container.matches('.callout[data-callout="lp-notes"],.lp-free-notes[data-callout="lp-notes"]'))boxes.unshift(container);
 for(const box of boxes){
  if(box.dataset.lpNotesBound)continue;
  const title=box.querySelector<HTMLElement>('.callout-title');if(!title)continue;
  box.dataset.lpNotesBound='true';box.classList.remove('callout','is-collapsed','is-collapsible');box.classList.add('lp-free-notes');const heading=box.ownerDocument.createElement('div');heading.className='lp-notes-heading';const text=box.ownerDocument.createElement('h2');text.textContent='Свободные записи';heading.append(text);title.replaceWith(heading);
  const action=box.ownerDocument.createElement('button');action.type='button';action.className='lp-free-notes-edit';action.textContent=box.querySelector('.callout-content')?.textContent?.trim()?'Редактировать':'Написать';action.setAttribute('aria-label','Редактировать свободные записи');heading.append(action);
  action.addEventListener('click',event=>{event.stopPropagation();edit();});
  box.addEventListener('click',event=>{
   const target=event.target;if(!(target instanceof Element)||target.closest('a,button,input,textarea,select,.callout-fold'))return;
   if(box.ownerDocument.getSelection()?.toString())return;edit();
  });
 }
 const headings=[...container.querySelectorAll<HTMLElement>('h2,h3,h4')];if(container.matches('h2,h3,h4'))headings.unshift(container);
 for(const heading of headings){
  if(heading.textContent?.trim()!=='Свободные записи'||heading.closest('.life-planner,.lp-free-notes')||heading.dataset.lpNotesBound)continue;
  heading.dataset.lpNotesBound='true';const action=heading.ownerDocument.createElement('button');action.type='button';action.className='lp-free-notes-edit';action.textContent='Редактировать';action.setAttribute('aria-label','Редактировать свободные записи');action.addEventListener('click',e=>{e.stopPropagation();edit();});if(heading.parentElement){const row=heading.ownerDocument.createElement('div');row.className='lp-notes-heading';heading.before(row);row.append(heading,action);}else heading.append(action);
 }
}
