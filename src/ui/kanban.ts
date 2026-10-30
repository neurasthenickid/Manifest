import {defaultAreas,areaById} from '../areas';
import {taskDisplay,renderTaskTitle} from './task-display';
import { type LifeArea,type Task, type TaskStatus } from '../model';

import { button, el } from './elements';
import {setIcon} from 'obsidian';
import {bindKanbanGestures} from './kanban-gestures';
import {compactLayout} from './compact';

export const TASK_COLUMNS: readonly {id:TaskStatus;title:string}[]=[
  {id:'todo',title:'К выполнению'},{id:'doing',title:'В работе'},{id:'done',title:'Выполнено'}
];
export function renderKanban(parent:HTMLElement,tasks:Task[],change:(task:Task,status:TaskStatus)=>void,edit:(task:Task)=>void,date?:string,archive?:(task:Task)=>void,areas:readonly LifeArea[]=defaultAreas(),options?:{selected?:TaskStatus;select?:(status:TaskStatus)=>void;menu?:(task:Task)=>void;root?:HTMLElement}){
  const board=el('div',parent,undefined,'lp-kanban');board.setAttribute('aria-label','Канбан задач');
  let selected=options?.selected??'todo';const tabs=el('div',board,undefined,'lp-kanban-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Статус задач');
  const selectStatus=(status:TaskStatus)=>{selected=status;options?.select?.(status);for(const tab of tabs.querySelectorAll<HTMLElement>('[data-drop-status]')){tab.setAttribute('aria-selected',String(tab.dataset.dropStatus===status));tab.tabIndex=tab.dataset.dropStatus===status?0:-1;}for(const panel of board.querySelectorAll<HTMLElement>('.lp-kanban-column'))panel.classList.toggle('is-selected',panel.dataset.status===status);};
  const id='lp-kanban-'+crypto.randomUUID();for(const c of TASK_COLUMNS){const tab=button(tabs,'',()=>selectStatus(c.id));el('span',tab,c.title);el('small',tab,String(tasks.filter(t=>t.status===c.id).length),'lp-tab-count');tab.id=id+'-'+c.id;tab.dataset.dropStatus=c.id;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',id+'-panel-'+c.id);tab.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const index=TASK_COLUMNS.findIndex(c=>c.id===selected),next=e.key==='Home'?0:e.key==='End'?2:(index+(e.key==='ArrowRight'?1:2))%3;selectStatus(TASK_COLUMNS[next].id);(tabs.children[next] as HTMLElement).focus({preventScroll:true});}});}
  for(const column of TASK_COLUMNS){
    const section=el('section',board,undefined,'lp-kanban-column');section.dataset.status=column.id;
    section.id=id+'-panel-'+column.id;section.setAttribute('aria-labelledby',id+'-'+column.id);
    const items=tasks.filter(task=>task.status===column.id);el('h4',section,`${column.title} · ${items.length}`);
    section.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('application/x-life-planner-task')){event.preventDefault();event.dataTransfer.dropEffect='move';}});
    section.addEventListener('drop',event=>{
      const raw=event.dataTransfer?.getData('application/x-life-planner-task');if(!raw)return;event.preventDefault();
      try{const payload=JSON.parse(raw) as {id?:string;version?:number};const task=tasks.find(t=>t.id===payload.id&&t.version===payload.version);if(task&&task.status!==column.id)change(task,column.id);}catch{/* Ignore unrelated drag content. */}
    });
    if(!items.length)el('p',section,'Пока пусто','lp-muted');
    for(const task of items){
      const card=el('article',section,undefined,`lp-kanban-card${task.status==='done'?' is-complete':date&&(task.plannedDate??task.planPeriod?.date??task.dueDate??date)<date?' is-carried':''}`);card.draggable=true;card.dataset.taskId=task.id;
      card.addEventListener('dragstart',event=>{if(compactLayout(board)){event.preventDefault();return;}event.dataTransfer?.setData('application/x-life-planner-task',JSON.stringify({id:task.id,version:task.version}));if(event.dataTransfer)event.dataTransfer.effectAllowed='move';});
      const handle=button(card,'',()=>{},'lp-task-drag-handle');handle.setAttribute('aria-label','Удерживать для переноса: '+task.title);handle.title='Удерживайте и перенесите на вкладку статуса';setIcon(handle,'grip-vertical');
      const label=el('label',card,undefined,'lp-check');const checkbox=el('input',label);checkbox.type='checkbox';checkbox.checked=task.status==='done';renderTaskTitle(el('span',label),taskDisplay(task,areas));checkbox.addEventListener('change',()=>change(task,checkbox.checked?'done':'todo'));
      const area=areaById(areas,task.areaId);el('small',card,taskDisplay(task,areas).detail,'lp-muted');card.style.setProperty('--lp-area',area?.color??'var(--lp-accent)');
      if(options?.menu){const trigger=button(card,'⋯',()=>options.menu!(task),'lp-mobile-task-menu');trigger.setAttribute('aria-label','Действия задачи: '+task.title);}

      const more=el('details',card,undefined,'lp-card-menu');el('summary',more,'⋯');more.firstElementChild?.setAttribute('aria-label',`Действия задачи: ${task.title}`);
      for(const target of TASK_COLUMNS.filter(c=>c.id!==task.status))button(more,`Переместить: ${target.title}`,()=>change(task,target.id));
      if(task.status!=='done')button(more,'Изменить',()=>edit(task));
      if(archive)button(more,'Удалить задачу…',()=>archive(task));
    }
  }
  selectStatus(selected);const root=options?.root??board.closest<HTMLElement>('.life-planner')??undefined,layout=()=>{const mobile=compactLayout(root??board);board.querySelectorAll<HTMLElement>('.lp-kanban-card').forEach(card=>card.draggable=!mobile);board.querySelectorAll<HTMLElement>('.lp-kanban-column').forEach(panel=>{if(mobile)panel.setAttribute('role','tabpanel');else panel.removeAttribute('role');});};root?.addEventListener('lp-layout-change',layout);layout();
  const gestures=bindKanbanGestures(board,tabs,()=>selected,selectStatus,(id,status)=>{const task=tasks.find(t=>t.id===id);if(task)change(task,status);},root);return()=>{gestures();root?.removeEventListener('lp-layout-change',layout);};
}
