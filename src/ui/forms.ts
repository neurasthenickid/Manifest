import {areaOptions,defaultAreas,assertAreaSelection} from '../areas';
import {preserveViewport} from './stability';
import { type LifeArea, type CalendarEvent, type Definition, type DefinitionItem, type DefinitionType, type EventFields, type PlannerStore, type Recurrence, type Task } from '../model';
import { setDefinitionVersion, archiveDefinition, definitionAt, checkinId, base, newTask, changeTask } from '../domain';
import {changeEventOccurrence,changeEventSeries,occurrenceFor,resetEventOccurrence} from '../recurrence';
import { addDays, formatDate, parseDate, weekday } from '../periods';
import {planFor,nextPlan} from '../task-planning';
import {PERIOD_TITLES} from '../settings';
import type {TaskPlan} from '../model';
import { button, el, field, select } from './elements';
import { wallStamp } from './calendar-gestures';
import {fitDialogViewport} from './dialog-viewport';
import {orderedDefinitions} from '../definition-order';

export class Forms {
  private returnFocus?:HTMLElement;
  private busy=false;
  private restoreViewport?:()=>void;
  private viewportCleanup?:()=>void;
  private dialogCleanups:(()=>void)[]=[];
  onClose(cleanup:()=>void){this.dialogCleanups.push(cleanup);}
  private cleanupDialog(){for(const cleanup of this.dialogCleanups.splice(0))cleanup();}
  constructor(private host: HTMLElement, private store: PlannerStore, private deleted?: (before: CalendarEvent, after: CalendarEvent) => void,private areas:()=>LifeArea[]=defaultAreas,private definitionOrder:()=>Partial<Record<DefinitionType,string[]>>=()=>({}),private saveOrder?:(type:DefinitionType,ids:string[])=>Promise<void>) {
    this.host=el('dialog',host,undefined,'lp-dialog');this.host.setAttribute('aria-label','Редактор Manifest');
    this.host.addEventListener('cancel',e=>{e.preventDefault();if(!this.busy)this.close();});
    this.host.addEventListener('keydown',e=>{if(e.key==='Escape')e.stopPropagation();});
  }
  private begin(){this.cleanupDialog();if(!(this.host as HTMLDialogElement).open){this.returnFocus=this.host.ownerDocument.activeElement as HTMLElement;this.restoreViewport=preserveViewport(this.host.closest<HTMLElement>('.life-planner')??this.host.parentElement!);}this.host.classList.remove('lp-action-sheet','lp-full-frame');this.host.replaceChildren();}
  private present(){const dialog=this.host as HTMLDialogElement;if(!dialog.open){dialog.showModal();this.viewportCleanup=fitDialogViewport(dialog);}this.host.setAttribute('aria-label',this.host.querySelector('h3')?.textContent??'Редактор Manifest');this.host.querySelector<HTMLElement>('input,button,select,textarea')?.focus({preventScroll:true});}
  private close(){this.cleanupDialog();(this.host as HTMLDialogElement).close();this.viewportCleanup?.();this.viewportCleanup=undefined;this.host.replaceChildren();if(this.returnFocus?.isConnected)this.returnFocus.focus({preventScroll:true});this.returnFocus=undefined;this.restoreViewport?.();this.restoreViewport=undefined;}
  destroy(){this.cleanupDialog();this.viewportCleanup?.();this.viewportCleanup=undefined;(this.host as HTMLDialogElement).close();}
  custom(title:string,fill:(parent:HTMLElement,close:()=>void)=>void,kind?:'sheet'|'frame'){this.begin();if(kind)this.host.classList.add(kind==='sheet'?'lp-action-sheet':'lp-full-frame');this.host.setAttribute('aria-label',title);fill(this.host,()=>this.close());this.present();}
  private open(title: string, fields: (form: HTMLFormElement, perform: (action: () => Promise<void>) => void) => () => Promise<void>,submitTitle='Сохранить') {
    this.begin();
    const form = el('form', this.host, undefined, 'lp-form'); el('h3', form, title);
    const error = el('p', form, '', 'lp-error'); error.setAttribute('role','alert');
    let pending = false;
    const perform = async (action: () => Promise<void>) => {
      if (pending) return; pending = true;this.busy=true; error.textContent = '';
      const controls = [...form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('input,button,select,textarea')].map(node => ({ node, disabled: node.disabled }));
      for (const {node} of controls) node.disabled = true;
      try { await action(); this.close(); }
      catch (e) { error.textContent = e instanceof Error ? e.message : String(e); }
      finally { pending = false;this.busy=false; for (const {node, disabled} of controls) node.disabled = disabled; }
    };
    const save = fields(form, action => { void perform(action); });
    const actions = el('div', form, undefined, 'lp-actions');
    const submit = el('button', actions, submitTitle, 'lp-primary'); submit.type = 'submit';
    button(actions, 'Отмена', () => this.close());
    form.addEventListener('submit', e => {
      e.preventDefault(); void perform(save);
    });
    this.present();
  }
  task(date: string, task?: Task, presetArea?:string,presetPlannedDate?:string,presetPlan?:TaskPlan,parent?:Task) {
    const source=task??base(),target=task?.planPeriod??presetPlan??planFor('day',date),type=parent?nextPlan(parent.planPeriod!.type):target.type;
    this.open(parent?'Новый шаг: '+parent.title:(task?'Изменить задачу':'Новая задача')+' · '+PERIOD_TITLES[type],form=>{
      const title=field(form,'Название',task?.title);title.required=true;
      const descriptionLabel=el('label',form,undefined,'lp-field');el('span',descriptionLabel,'Описание (необязательно)');const description=el('textarea',descriptionLabel);description.setAttribute('aria-label','Описание (необязательно)');description.rows=3;description.maxLength=100000;description.value=task?.description??'';
      const choices=areaOptions(this.areas(),task?.areaId),preferred=task?.areaId??parent?.areaId??presetArea??'self';const area=select(form,'Сфера',choices,choices.some(a=>a.id===preferred)?preferred:choices[0]?.id??'');area.required=true;if(!choices.length)el('p',form,'Нет включённых сфер. Добавьте или включите сферу в настройках плагина.','lp-muted');
      el('p',form,'План: '+PERIOD_TITLES[type]+' · '+formatDate(target.date),'lp-muted');
      const anchor=parent?field(form,'Дата внутри планового периода (ДД.ММ.ГГГГ)',formatDate(target.date)):undefined;
      if(parent)el('p',form,'Родитель: '+parent.title,'lp-muted');
      const featured=type==='day'?field(form,'Избранное — показывать в месячном календаре','','checkbox'):undefined;if(featured)featured.checked=task?.featured??false;
      const status=select(form,'Статус',[{id:'todo',title:'К выполнению'},{id:'doing',title:'В работе'},{id:'done',title:'Выполнено'}],task?.status??'todo');
      const planned=type==='day'?field(form,'Плановый день (необязательно, ДД.ММ.ГГГГ)',task?.plannedDate?formatDate(task.plannedDate):presetPlannedDate?formatDate(presetPlannedDate):''):undefined;
      if(planned)button(form,'Выбрать день заметки: '+formatDate(date),()=>{planned.value=formatDate(date);});
      const due=type==='day'?field(form,'Крайний срок (необязательно, ДД.ММ.ГГГГ)',task?.dueDate?formatDate(task.dueDate):''):undefined;
      if(type==='day')el('p',form,'Незавершённая задача переносится в следующий день только после его наступления. Крайний срок можно указать отдельно.','lp-muted');
      if(task)button(form,'Удалить задачу…',()=>this.archive(date,task));
      if(type!=='day')el('p',form,'На выполнение — весь выбранный период. Дневные шаги и их сроки учитываются отдельно.','lp-muted');
      return async()=>{
        assertAreaSelection(this.areas(),area.value,task?.areaId);
        const values={title:title.value.trim(),description:description.value,areaId:area.value,featured:featured?.checked??task?.featured,status:status.value as Task['status'],plannedDate:planned?(planned.value.trim()?parseDate(planned.value.trim()):undefined):task?.plannedDate,dueDate:due?(due.value.trim()?parseDate(due.value.trim()):undefined):task?.dueDate,planPeriod:planFor(type,anchor?parseDate(anchor.value.trim()):target.date),parentId:parent?.id??task?.parentId};
        if(parent){const latest=this.store.get(parent.id);if(latest?.version!==parent.version)throw new Error('Родительский план изменился. Откройте его заново.');}
        await this.store.save(task?changeTask(task,values,undefined,type==='day'?date:undefined,type==='day'&&values.status!==task.status?date:undefined):{...newTask(values,undefined,type==='day'?(anchor?parseDate(anchor.value.trim()):target.date):undefined,type==='day'?(anchor?parseDate(anchor.value.trim()):target.date):undefined),id:source.id},task?.version??0);
      };
    });
  }
  event(date: string, event?: CalendarEvent, hour = '10:00', originalDate?: string, preset?: Partial<EventFields>) {
    if (!event?.recurrence) { this.editEvent(date, event, hour, undefined, preset); return; }
    const original = originalDate ?? event.start.slice(0, 10);
    this.begin(); const panel = el('div', this.host, undefined, 'lp-scope');
    el('h3', panel, 'Что изменить?');
    button(panel, `Этот случай — ${formatDate(original)}`, () => this.editEvent(date, event, hour, original, preset));
    button(panel, 'Вся серия', () => {
      try {
        let seriesPreset = preset;
        if (preset?.start && preset.end) { const instance = occurrenceFor(event, original)!; seriesPreset = { start: wallStamp(Date.parse(`${event.start}Z`) + Date.parse(`${preset.start}Z`) - Date.parse(`${instance.start}Z`)), end: wallStamp(Date.parse(`${event.end}Z`) + Date.parse(`${preset.end}Z`) - Date.parse(`${instance.end}Z`)) }; }
        this.editEvent(date, event, hour, undefined, seriesPreset);
      } catch (error) { el('p',panel,error instanceof Error?error.message:String(error),'lp-error'); }
    });
    button(panel, 'Отмена', () => this.close());
    this.present();
  }
  private editEvent(date: string, event?: CalendarEvent, hour = '10:00', originalDate?: string, preset?: Partial<EventFields>) {
    // A retry after uncertain persistence must target the same ID, never create a duplicate.
    const source = event ?? base();
    const current = event && originalDate ? occurrenceFor(event, originalDate) : event;
    if (originalDate && !current) throw new Error('Случай больше не доступен. Откройте серию заново.');
    const instance = { ...current, ...preset };
    this.open(originalDate ? `Изменить случай — ${formatDate(originalDate)}` : event?.recurrence ? 'Изменить всю серию' : event ? 'Изменить событие' : 'Новое событие', (form, perform) => {
      const title = field(form, 'Название', instance?.title); title.required = true;
      const choices=areaOptions(this.areas(),event?instance.areaId:undefined);if(event&&instance.areaId==='')choices.unshift({id:'',title:'Без сферы',color:'#8a929d',icon:'circle',enabled:false});const preferred=instance.areaId??'self';const area=select(form,'Сфера',choices,choices.some(a=>a.id===preferred)?preferred:choices[0]?.id??'');area.required=!(event&&instance.areaId==='');if(!choices.length)el('p',form,'Нет включённых сфер. Добавьте или включите сферу в настройках плагина.','lp-muted');
      const allDay = field(form, 'Весь день', '', 'checkbox'); allDay.checked = instance?.allDay ?? false;
      const featured=field(form,'Избранное — показывать в месячном календаре','','checkbox');featured.checked=instance?.featured??false;
      const day = field(form, 'Начало: дата (ДД.ММ.ГГГГ)', formatDate(instance.start?.slice(0,10) ?? date));
      const start = field(form, 'Начало: время', instance.start?.slice(11,16) || hour, 'time');
      const endDay = field(form, 'Конец: дата (для «Весь день» — следующий день)', formatDate(instance.end?.slice(0,10) ?? date));
      const nextHour = `${String((Number(hour.slice(0,2))+1)%24).padStart(2,'0')}:00`;
      const end = field(form, 'Конец: время', instance.end?.slice(11,16) || nextHour, 'time');
      if(!event && !preset?.end && hour.startsWith('23'))endDay.value=formatDate(addDays(date,1));
      const zone = current?.timezone ?? 'Europe/Moscow';
      el('p', form, zone==='Europe/Moscow'?'Московское время · МСК':'Сохранённая зона записи: '+zone, 'lp-muted');
      const update = () => {start.disabled=allDay.checked;end.disabled=allDay.checked;}; allDay.addEventListener('change',()=>{update();try{if(allDay.checked&&endDay.value===day.value)endDay.value=formatDate(addDays(parseDate(day.value),1));}catch{const error=form.querySelector('.lp-error');if(error)error.textContent='Введите корректную дату начала.';}});update();
      let frequency: HTMLSelectElement | undefined, until: HTMLInputElement | undefined, reset: HTMLInputElement | undefined;
      if (!originalDate) {
        frequency = select(form, 'Повторение', [{id:'none',title:'Не повторять'},{id:'daily',title:'Каждый день'},{id:'weekly',title:'Каждую неделю'},{id:'weekdays',title:'По будням'}], event?.recurrence?.frequency ?? 'none');
        until = field(form, 'Повторять до (включительно, ДД.ММ.ГГГГ)', event?.recurrence?.until ? formatDate(event.recurrence.until) : '');
        const updateRepeat = () => { until!.disabled = frequency!.value === 'none'; }; frequency.addEventListener('change', updateRepeat); updateRepeat();
        const exceptions = Object.entries(event?.exceptions ?? {});
        if (exceptions.length && event) {
          el('p', form, `Отдельных изменений: ${exceptions.length}. Правки всей серии применятся к случаям без индивидуальных изменений.`, 'lp-muted');
          reset = field(form, `Сбросить изменения отдельных случаев (${exceptions.length})`, '', 'checkbox');
          const list = el('details', form); el('summary', list, 'Изменённые и удалённые случаи');
          for (const [original, exception] of exceptions.sort(([a],[b])=>a.localeCompare(b))) button(list, `Вернуть к серии: ${formatDate(original)}${exception.deleted ? ' · удалён' : ''}`, () => perform(async () => { await this.store.save(resetEventOccurrence(event, original), event.version); }));
        }
      } else el('p', form, `Исходная дата случая: ${formatDate(originalDate)}. Его перенос не меняет другие повторения.`, 'lp-muted');
      if(event) button(form, originalDate ? 'Удалить этот случай' : event.recurrence ? 'Удалить всю серию' : 'Удалить событие', () => perform(async () => {
        const saved=await this.store.save(originalDate ? changeEventOccurrence(event, originalDate, null) : {...event,deleted:true},event.version);this.deleted?.(event,saved);
      }), 'lp-danger');
      return async () => {
        if(!(event&&instance.areaId===''&&area.value===''))assertAreaSelection(this.areas(),area.value,event?instance.areaId:undefined);
        const values: EventFields = {title:title.value.trim(),areaId:area.value,
          start:parseDate(day.value.trim())+(allDay.checked?'':`T${start.value}`),end:parseDate(endDay.value.trim())+(allDay.checked?'':`T${end.value}`),allDay:allDay.checked,timezone:zone,featured:featured.checked};
        const rule: Recurrence | undefined = frequency && frequency.value !== 'none' ? { frequency: frequency.value as Recurrence['frequency'], until: until!.value.trim() ? parseDate(until!.value.trim()) : undefined } : undefined;
        const record = event && originalDate ? changeEventOccurrence(event, originalDate, values) : changeEventSeries(event ?? {...source,kind:'event',...values}, values, rule, reset?.checked);
        await this.store.save(record,event?.version??0);
      };
    });
  }
  definition(date: string, type: DefinitionType) {
    const names = {habit:'привычка',morning:'утренняя рутина',evening:'вечерняя рутина',workout:'программа тренировки'};
    const source=base();
    this.open(`Новая ${names[type]}`, form => {
      const title = field(form,'Название');title.required=true;
      const effective = field(form,'Действует с (ДД.ММ.ГГГГ)',formatDate(date));
      const label=el('label',form,undefined,'lp-field');el('span',label,type==='habit'?'Название действия (одна строка)':'Пункты — по одному на строку');const items=el('textarea',label);items.rows=4;items.required=true;
      const days=this.weekdays(form,[1,2,3,4,5,6,7]);
      return async()=>{
        const record: Definition={...source,kind:'definition',type,versions:[{effectiveDate:parseDate(effective.value.trim()),title:title.value.trim(),
          items:items.value.split('\n').map(v=>v.trim()).filter(Boolean).map((title,i)=>({id:source.id+'-item-'+i,title})),weekdays:days()}]};
        if(type==='habit' && record.versions[0].items.length!==1)throw new Error('У привычки должно быть одно действие.');
        await this.store.save(record,0);
      };
    });
  }
  habit(date:string){
    const source=base();
    this.open('Новая привычка',form=>{
      const title=field(form,'Название');title.required=true;
      return async()=>{const name=title.value.trim();await this.store.save({...source,kind:'definition',type:'habit',versions:[{effectiveDate:date,title:name,weekdays:[1,2,3,4,5,6,7],items:[{id:`${source.id}-item`,title:name}]}]},0);};
    });
  }
  routineItems(date:string,type:'morning'|'evening',definition?:Definition){
    const source=definition??{...base(),kind:'definition' as const,type,versions:[]};
    this.open(type==='morning'?'Пункты утренней рутины':'Пункты вечерней рутины',form=>{
      const label=el('label',form,undefined,'lp-field');el('span',label,'Пункты — по одному на строку');const input=el('textarea',label);input.required=true;input.rows=4;
      const current=definition?definitionAt(definition,date):undefined;
      el('p',form,`Новые пункты действуют с ${formatDate(date)}. Сохранённые отметки других дней не меняются.`,'lp-muted');
      const ids:string[]=[];
      return async()=>{
        const titles=input.value.split('\n').map(t=>t.trim()).filter(Boolean);
        if(!titles.length)throw new Error('Введите хотя бы один пункт.');
        const added=titles.map((title,index)=>({id:ids[index]??(ids[index]=base().id),title}));
        const next={effectiveDate:date,title:type==='morning'?'Утренняя рутина':'Вечерняя рутина',weekdays:[1,2,3,4,5,6,7],items:[...(current?.items??[]),...added]};
        const record:Definition=definition?setDefinitionVersion(definition,next):{...source,versions:[next]};
        await this.store.save(record,definition?.version??0);
        const entry=this.store.get(checkinId(source.id,date));
        if(entry?.kind==='checkin')await this.store.save({...entry,items:[...entry.items,...added],finalized:false},entry.version);
      };
    });
  }
  definitionVersion(date: string, definition: Definition) {
    const previous = definition.versions[definition.versions.length - 1];
    let current = previous;
    for (let index = definition.versions.length - 1; index >= 0; index--) {
      if (definition.versions[index].effectiveDate <= date) { current = definition.versions[index]; break; }
    }
    const firstAvailable = date;
    this.open(`Изменить список: ${current.title}`, (form, perform) => {
      const title = field(form, 'Название', current.title); title.required = true;
      const effective = field(form, 'Действует с (ДД.ММ.ГГГГ)', formatDate(firstAvailable));
      const days = definition.type==='habit'?undefined:this.weekdays(form,current.weekdays);
      const list = el('div', form, undefined, 'lp-definition-items');
      el('p', list, definition.type === 'habit' ? 'Одно действие привычки. Его ID сохранится после переименования.' : 'Пункты можно переименовать, удалить или добавить. ID сохранится у оставшихся пунктов.', 'lp-muted');
      const rows: { item: DefinitionItem; row: HTMLElement; input: HTMLInputElement }[] = [];
      const refreshOrder=()=>{for(const [i,entry]of rows.entries())for(const b of entry.row.querySelectorAll<HTMLButtonElement>('[data-item-move]'))b.disabled=i+Number(b.dataset.itemMove)<0||i+Number(b.dataset.itemMove)>=rows.length;};
      const addItem = (item: DefinitionItem = { id: base().id, title: '' }) => {
        const row = el('div', list, undefined, 'lp-actions');
        const input = field(row, 'Пункт', item.title); input.required = true;
        const entry = { item, row, input }; rows.push(entry);
        if(definition.type!=='habit')for(const delta of [-1,1]){const move=button(row,delta<0?'↑':'↓',()=>{const i=rows.indexOf(entry),j=i+delta;if(j<0||j>=rows.length)return;[rows[i],rows[j]]=[rows[j],rows[i]];for(const r of rows)list.append(r.row);refreshOrder();});move.dataset.itemMove=String(delta);move.setAttribute('aria-label',(delta<0?'Выше пункт: ':'Ниже пункт: ')+item.title);}
        if (definition.type !== 'habit') button(row, 'Удалить пункт', () => { entry.row.remove(); rows.splice(rows.indexOf(entry), 1);refreshOrder(); });refreshOrder();
      };
      for (const item of current.items) addItem({ ...item });
      if (definition.type !== 'habit') button(form, 'Добавить пункт', () => addItem());
      const save = async (archive: boolean) => {
        const items = rows.map(({ item, input }) => ({ id: item.id, title: input.value.trim() }));
        const weekdays = archive ? [] : definition.type==='habit'?[1,2,3,4,5,6,7]:days!();
        const record = setDefinitionVersion(definition, { effectiveDate: parseDate(effective.value.trim()), title: title.value.trim(), items, weekdays });
        await this.store.save(record, definition.version);
      };
      button(form, 'Удалить из расписания…', () => this.archive(parseDate(effective.value.trim()),definition));
      el('p', form, 'Удаление требует подтверждения. История и отметки сохраняются; вернуть список можно через управление.', 'lp-muted');
      return () => save(false);
    });
  }
  private weekdays(parent:HTMLElement,chosen:number[]){
    const box=el('fieldset',parent,undefined,'lp-weekday-picker');el('legend',box,'Дни недели');const controls=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((name,i)=>{const input=field(box,name,'','checkbox');input.checked=chosen.includes(i+1);return input;});
    return()=>controls.flatMap((input,i)=>input.checked?[i+1]:[]);
  }
  definitions(date:string,type:DefinitionType){
    this.begin();const panel=el('div',this.host,undefined,'lp-manager');el('h3',panel,{habit:'Управление привычками',morning:'Утренняя рутина',evening:'Вечерняя рутина',workout:'Программы тренировок'}[type]);
    button(panel,type==='habit'?'+ Привычка':type==='workout'?'+ Программа':'+ Пункт',()=>{if(type==='habit')this.habit(date);else if(type==='workout')this.definition(date,type);else this.routineItems(date,type,this.store.all('definition').find(d=>d.type===type&&!d.lifecycle?.at(-1)?.archived));});
    const error=el('p',panel,'','lp-error');error.setAttribute('role','alert');const definitions=orderedDefinitions(this.store.all('definition').filter(d=>d.type===type),this.definitionOrder()[type]);let moving=false;
    for(const [index,definition]of definitions.entries()){
      const current=definitionAt(definition,date),v=current??definition.versions.at(-1)!,archived=definition.lifecycle?.at(-1)?.archived===true;
      const row=el('div',panel,undefined,'lp-manager-row');el('strong',row,v.title);el('small',row,archived?'В архиве':!current?'Начнёт действовать с '+formatDate(v.effectiveDate):current.weekdays.includes(weekday(date))?'Запланировано на этот день':'Не запланировано на этот день','lp-muted');
      button(row,'Настроить',()=>this.definitionVersion(date,definition));button(row,archived?'Вернуть из архива':'Удалить из расписания…',()=>this.archive(date,definition,archived));
      if(this.saveOrder)for(const delta of [-1,1]){const move=button(row,delta<0?'↑':'↓',()=>{if(moving)return;const ids=definitions.map(d=>d.id),j=index+delta;if(j<0||j>=ids.length)return;[ids[index],ids[j]]=[ids[j],ids[index]];moving=true;const controls=[...panel.querySelectorAll<HTMLButtonElement>('button')],prior=controls.map(b=>b.disabled);controls.forEach(b=>b.disabled=true);void this.saveOrder!(type,ids).then(()=>this.definitions(date,type)).catch(e=>{error.textContent=e instanceof Error?e.message:String(e);}).finally(()=>{moving=false;controls.forEach((b,i)=>b.disabled=prior[i]);});});move.disabled=index+delta<0||index+delta>=definitions.length;move.setAttribute('aria-label',(delta<0?'Выше: ':'Ниже: ')+v.title);}
    }
    button(panel,'Закрыть',()=>this.close());this.present();
  }
  archivedTasks(date:string){
    this.begin();const panel=el('div',this.host,undefined,'lp-manager');el('h3',panel,'Архив задач');
    for(const task of this.store.all('task').filter(t=>t.archived)){const row=el('div',panel,undefined,'lp-manager-row');el('strong',row,task.title);button(row,'Вернуть из архива',()=>this.archive(date,task,true));}
    button(panel,'Закрыть',()=>this.close());this.present();
  }
  archive(date:string,record:Task|Definition,restore=false){
    const name=record.kind==='task'?record.title:(definitionAt(record,date)??record.versions.at(-1)!).title;
    const latest=record.kind==='task'?record.history.filter(h=>h.archived).at(-1)?.effectiveDate:record.lifecycle?.at(-1)?.date;
    const effective=restore&&latest&&latest>date?latest:date;
    this.open((restore?'Вернуть: ':'Удалить: ')+name,form=>{
      el('p',form,(restore?'Вернётся':'Исчезнет из активного списка')+' с '+formatDate(effective)+'. История и статистика прошлых дней сохраняются.','lp-muted');
      if(record.kind==='task'&&this.store.all('task').some(t=>t.parentId===record.id))el('p',form,'Связанные шаги сохранятся; здесь убирается только выбранная задача.','lp-muted');
      const confirmation=restore?undefined:field(form,'Подтверждаю удаление в архив','','checkbox');if(confirmation)confirmation.required=true;
      return async()=>{if(confirmation&&!confirmation.checked)throw new Error('Подтвердите удаление в архив.');await this.store.save(record.kind==='task'?changeTask(record,{archived:!restore},undefined,undefined,effective):archiveDefinition(record,effective,!restore),record.version);};
    },restore?'Вернуть из архива':'Убрать в архив');
  }
}
