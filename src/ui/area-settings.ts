import {setIcon} from 'obsidian';
import type {LifeArea} from '../model';
import {AREA_ICONS,renameArea} from '../areas';
import {button,el,field,select} from './elements';
/** Approved compact list. Changes retain stable area IDs and never edit records. */
export function renderAreaSettings(host:HTMLElement,areas:readonly LifeArea[],update:(edit:(areas:LifeArea[])=>void)=>void,error:HTMLElement,openArea?: (id:string)=>Promise<void>,run:(fn:()=>Promise<unknown>)=>void=fn=>{void fn();}){
 const header=el('div',host,undefined,'lp-area-settings-heading'),heading=host.querySelector(':scope >h3');if(heading)header.append(heading);
 const add=button(header,'Добавить сферу',()=>update(list=>{list.push({id:'area-'+crypto.randomUUID(),title:'Новая сфера '+(list.length+1),color:'#8873bf',icon:'circle',enabled:true,titleHistory:[]});}));const plus=el('span',add);plus.setAttribute('aria-hidden','true');setIcon(plus,'plus');add.prepend(plus);
 el('p',host,'Список принадлежит этому хранилищу. Выключение скрывает сферу из навигации и новых записей, сохраняя задачи, события, оценки и историю.','lp-muted');
 if(!areas.some(a=>a.enabled))el('p',host,'Нет включённых сфер. Добавьте сферу или включите существующую. История остаётся доступной.','lp-muted');
 const list=el('div',host,undefined,'lp-area-settings-list');
 for(const [index,area]of areas.entries()){
  const row=el('section',list,undefined,'lp-area-setting lp-area-setting-compact');row.dataset.area=area.id;row.style.setProperty('--lp-area',area.color);row.classList.toggle('is-disabled',!area.enabled);
  const identity=el('div',row,undefined,'lp-area-identity'),mark=el('span',identity,undefined,'lp-area-mark');mark.dataset.icon=area.icon;mark.setAttribute('aria-hidden','true');setIcon(mark,area.icon);el('span',identity,area.title,'lp-area-name');
  const label=el('label',row,undefined,'lp-area-setting-toggle lp-switch-hit'),toggle=el('input',label);toggle.type='checkbox';toggle.className='lp-toggle';toggle.setAttribute('role','switch');toggle.setAttribute('aria-label','Включена сфера: '+area.title);toggle.checked=area.enabled;el('span',label,area.enabled?'Включена':'Выключена');toggle.addEventListener('change',()=>update(list=>{list.find(a=>a.id===area.id)!.enabled=toggle.checked;}));
  const tools=el('div',row,undefined,'lp-area-order');for(const [delta,name,title]of [[-1,'arrow-up','Выше'],[1,'arrow-down','Ниже']] as const){const b=button(tools,'',()=>update(list=>{const i=list.findIndex(a=>a.id===area.id);[list[i],list[i+delta]]=[list[i+delta],list[i]];}));b.setAttribute('aria-label',title+': '+area.title);b.disabled=index+delta<0||index+delta>=areas.length;const icon=el('span',b);icon.setAttribute('aria-hidden','true');setIcon(icon,name);}
  const editor=el('div',undefined,undefined,'lp-area-editor');editor.id='lp-area-editor-'+crypto.randomUUID();editor.hidden=!area.title.startsWith('Новая сфера');
  const edit=button(row,'Редактировать',()=>{editor.hidden=!editor.hidden;edit.setAttribute('aria-expanded',String(!editor.hidden));if(!editor.hidden)editor.querySelector('input')?.focus({preventScroll:true});},'lp-area-edit');edit.setAttribute('aria-label','Редактировать: '+area.title);edit.setAttribute('aria-controls',editor.id);edit.setAttribute('aria-expanded',String(!editor.hidden));row.append(editor);
  const name=field(editor,'Название сферы',area.title),color=field(editor,'Цвет сферы',area.color,'color'),icon=select(editor,'Значок сферы',AREA_ICONS,area.icon);name.maxLength=120;
  button(editor,'Сохранить сферу',()=>{if(!name.value.trim()||name.value.trim().length>120){error.textContent='Название должно содержать от 1 до 120 символов.';return;}update(list=>{const i=list.findIndex(a=>a.id===area.id);list[i]={...renameArea(list[i],name.value),color:color.value,icon:icon.value};});});
  if(openArea)button(editor,'Открыть заметку сферы',()=>run(()=>openArea(area.id)),'lp-area-open-note');
 }
}
