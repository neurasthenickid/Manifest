import {trackPlannerChrome} from './planner-chrome';
import {ActivitySelections} from '../activity-statistics';
import {renderActivityStatistics} from './activity-statistics';
import {canonicalModule,canonicalLayout} from './modules';
import {claimStatistics} from './statistics-owner';
import type {HeaderCollection} from '../headers/collection';
import {StatisticsDay} from '../statistics-day';
import {bindCalendarViewport,type CalendarViewportState} from './calendar-viewport';
import {watchHeaderClock} from './header-clock-watch';
import {enabledAreas,areaById,areaStatisticsView} from '../areas';
import {preserveViewport} from './stability';
import {setIcon} from 'obsidian';
import {resolveNoteAppearance,resetAutomaticHeader,noteStyle,styleKey,styleFont,styleCaption,styleAccent,periodAccent,randomStyle,availablePresets,STYLE_PRESETS,FONT_OPTIONS,type NoteStyle} from '../appearance';
import {defaultSettings,type PlannerSettings} from '../settings';
import {PlannerViewState} from '../view-state';
import {renderMiniCalendar} from './mini-calendar';
import {renderMonthCards} from './month-cards';
import {taskDisplay,renderTaskTitle,sortTasksByArea} from './task-display';

import {taskStateBefore} from '../task-history';
import {dailyTasks,ownPlanTasks,parentPlanTasks,planFor,nextPlan} from '../task-planning';
import {weeklyCalendarTasks} from '../weekly-calendar-tasks';
import {PERIOD_TITLES} from '../settings';
import {selectedTaskStatistics,statisticsLevels,type TaskStatistics} from '../task-statistics';
import {miniCalendarRange} from './mini-calendar';
import type {RecordKind,RecordOf,StoreChange,LifeArea} from '../model';
import {type CalendarEvent,type EventFields,type EventOccurrence,type Checkin,type Definition,type Period,type PeriodType,type PlannerRecord,type PlannerStore,type Task} from '../model';
import { adjacent, addDays, dates, formatDate, period, today, weekday } from '../periods';
import { dailyAreaRatingId, base, changeTask, checkinId, dayRatingId, definitionAt, newCheckin, taskCategory, visibilityId } from '../domain';
import { dailyAreaRatingSeries, dailyAreaSummary, dayRatingSeries, summarize,observationWindow } from '../analytics';
import {detachedEl, button, el, field, formatPercent, section, select } from './elements';
import { Forms } from './forms';
import { renderKanban } from './kanban';
import {TASK_COLUMNS} from './kanban';
import {observeCompact,compactLayout} from './compact';
import {headerFocus} from './header-framing';
import {bindTouchRange} from './touch-range';
import {orderedDefinitions} from '../definition-order';
import type {TaskStatus} from '../model';
import { occurrences, overlapsPeriod,occurrenceFor } from '../recurrence';
import {projectEventTime} from '../event-time';
import type { WidgetModule } from './modules';
import { bindSelection, bindEventGesture } from './calendar-gestures';

export interface WidgetActions {
  headerCollection?:Pick<HeaderCollection,'state'|'subscribe'>;
  view?:PlannerViewState;
  saveSettings?:(settings:PlannerSettings)=>Promise<void>;
  resolveMedia?:(file:string,builtin:boolean)=>string|undefined;
  settings?:()=>PlannerSettings;
  openPeriod(type: PeriodType, date: string): Promise<void>;
  openNote(path: string): Promise<void>;
  openArea(id: string): Promise<void>;
  exportData(): Promise<void>;
  recover(): Promise<void>;
  issues(): string[];
}
const PERIOD_NAMES: Record<PeriodType,string> = {day:'День',week:'Неделя',month:'Месяц',quarter:'Квартал',year:'Год'};
const TASK_GROUPS = {today:'На этот день',overdue:'Просрочено по сроку',past:'Из прошлых дней',backlog:'Без планового дня',future:'Запланировано позже',done:'Выполнено'};
const overlaps = (e: EventOccurrence, date: string) => overlapsPeriod(e,date,addDays(date,1));
const areaIcons:Record<string,string>={all:'layers',family:'heart',home:'house',work:'briefcase-business',study:'book-open',self:'user-round'};
function navigationIcon(parent:HTMLElement,name:string){const icon=el('span');icon.className='lp-navigation-icon';icon.dataset.icon=name;icon.setAttribute('aria-hidden','true');setIcon(icon,name);parent.prepend(icon);}

export class PlannerWidget {
  private content: HTMLElement;
  private panel: HTMLElement;
  private status: HTMLElement;
  private forms: Forms;
  private issuePanel:HTMLElement;
  private unsubscribe: () => void;
  private view:PlannerViewState;
  private unsubscribeView:()=>void;
  private calendarViewport?:CalendarViewportState;
  private monthSelected='';
  private statisticsDay:StatisticsDay;
  private activitySelections=new ActivitySelections();
  private taskStatsFilter='enabled';
  private statisticsOwner?:ReturnType<typeof claimStatistics>;
  private taskView: 'list'|'kanban' = 'list';
  private disposed = false;
  private areaStatsFilter='enabled';
  private ratingQueue:Promise<unknown>=Promise.resolve();
  private ratingBindings=new Map<string,()=>void>();
  private gestureCleanups: (()=>void)[] = [];
  private undoPanel: HTMLElement;
  private undo?: {record: CalendarEvent; version: number};
  private chrome:ReturnType<typeof trackPlannerChrome>;
  private observedToday=today();private clockCleanup:()=>void=()=>{};
  private compactCleanup:()=>void=()=>{};
  private kanbanStatus:TaskStatus='todo';
  private taskStatusQueue=new Map<string,Promise<unknown>>();
  constructor(private host: HTMLElement, private store: PlannerStore, private context: Period, private actions: WidgetActions, private module:WidgetModule='all') {
    this.module=canonicalModule(module);this.view=actions.view??new PlannerViewState();this.statisticsDay=new StatisticsDay(context,today());
    host.classList.add('life-planner');host.dataset.module=this.module;this.chrome=trackPlannerChrome(host);
    this.compactCleanup=observeCompact(host);this.status=el('div',host,undefined,'lp-status');this.status.setAttribute('role','status');
    this.issuePanel=el('div',host,undefined,'lp-issues');this.undoPanel=el('div',host,undefined,'lp-undo-panel');this.panel=el('div',host);this.content=el('div',host);this.forms=new Forms(this.panel,store,(record,saved)=>{this.undo={record,version:saved.version};this.renderUndo();},()=>this.catalogue(),()=>this.settings.definitionOrder??{},async(type,ids)=>{const next=structuredClone(this.settings);next.definitionOrder={...next.definitionOrder,[type]:ids};await this.actions.saveSettings?.(next);});
    this.unsubscribe=store.subscribe(change=>this.recordsChanged(change));this.unsubscribeView=this.view.subscribe(()=>{if(this.renderedArea===this.view.area)this.replaceModules(['plans','task-stats','overview']);else this.render(true);});
    const doc=host.ownerDocument,win=doc.defaultView!;const refreshDay=()=>{if(!this.disposed&&!doc.hidden&&this.observedToday!==today())this.render(true);},timer=win.setInterval(refreshDay,60000),close=()=>this.destroy();win.addEventListener('focus',refreshDay);doc.addEventListener('visibilitychange',refreshDay);win.addEventListener('pagehide',close);this.clockCleanup=()=>{win.clearInterval(timer);win.removeEventListener('focus',refreshDay);doc.removeEventListener('visibilitychange',refreshDay);win.removeEventListener('pagehide',close);};if(this.module==='all'||this.module==='task-stats')this.statisticsOwner=claimStatistics(host,styleKey(context),()=>!this.disposed&&context.type!=='day'&&this.layout().includes('task-stats'),()=>{if(!this.disposed)this.render(true);},this.view);this.render();
  }
  destroy(){if(this.disposed)return;this.disposed=true;this.chrome.dispose();this.statisticsOwner?.release();this.clockCleanup();this.compactCleanup();this.forms.destroy();this.unsubscribe();this.unsubscribeView();for(const cleanup of this.gestureCleanups)cleanup();this.gestureCleanups=[];this.host.replaceChildren();}
  private renderUndo(){if(this.disposed)return;this.undoPanel.replaceChildren();if(!this.undo)return;const undo=this.undo;button(this.undoPanel,'Отменить удаление',()=>this.run(async()=>{await this.store.save({...undo.record,version:undo.version},undo.version);this.undo=undefined;this.renderUndo();}));}
  private run(action:()=>Promise<unknown>,quiet=true){
    this.status.classList.remove('lp-error');this.status.textContent=quiet?'':'Выполняется…';
    void action().then(()=>{if(!this.disposed)this.status.textContent='';}).catch(e=>{if(!this.disposed){this.recordsChanged();this.status.textContent=e instanceof Error?e.message:String(e);this.status.classList.add('lp-error');}});
  }
  private go(type:PeriodType,date:string){this.view.setDate(date);this.run(()=>this.actions.openPeriod(type,date));}
  private get settings(){return this.actions.settings?.()??defaultSettings();}
  private layout(){return canonicalLayout(this.settings.layouts[this.context.type]);}
  private get selectedArea(){return this.view.area;}
  private catalogue(){return this.settings.areas;}
  private area(id:string){return areaById(this.catalogue(),id);}
  private areas(){return this.selectedArea==='all'?enabledAreas(this.catalogue()):[this.area(this.selectedArea)];}
  private historyAreas(){const list=[...this.catalogue()];for(const kind of ['task','event','area-rating','daily-area-rating'] as const)for(const r of this.store.all(kind))if(r.areaId&&!list.some(a=>a.id===r.areaId))list.push({...this.area(r.areaId),title:'areaTitle' in r?r.areaTitle:this.area(r.areaId).title});return list;}
  private all<K extends RecordKind>(kind:K):RecordOf<K>[] {const records=this.store.all(kind);if(this.selectedArea==='all')return records;return records.filter(r=>'areaId' in r?r.areaId===this.selectedArea:!(['day-rating','definition','checkin'] as string[]).includes(kind));}
  private renderIssues(){this.issuePanel.replaceChildren();for(const issue of this.actions.issues())el('p',this.issuePanel,issue,'lp-error');if(this.actions.issues().length)button(this.issuePanel,'Восстановление из копии',()=>this.run(()=>this.actions.recover()));}
  private moduleCleanups=new Map<WidgetModule,(()=>void)[]>();
  private renderedArea='all';
  private recordsChanged(change?:StoreChange){
    if(this.disposed)return;
    this.renderIssues();
    if(!change){for(const binding of this.ratingBindings.values())binding();this.replaceModules(['calendar','tasks','plans','task-stats','overview','habits','morning','evening','workout','habit-stats','routine-stats','workout-stats','day-stats','area-stats']);return;}
    const names=new Set<WidgetModule>();
    for(const record of change.records){
      if(['day-rating','daily-area-rating','area-rating'].includes(record.kind)){for(const binding of this.ratingBindings.values())binding();for(const n of ['day-stats','area-stats','overview'] as const)names.add(n);}
      else if(record.kind==='task'){for(const n of ['tasks','plans','task-stats','overview','calendar'] as const)names.add(n);}
      else if(record.kind==='event')names.add('calendar');
      else if(record.kind==='visibility'){names.add('tasks');names.add('calendar');}
      else if(record.kind==='definition'||record.kind==='checkin'){
        const saved=this.store.get(record.id),type=saved?.kind==='definition'?saved.type:saved?.kind==='checkin'?saved.definitionType:undefined;
        if(type){names.add(type==='habit'?'habits':type);names.add(type==='habit'?'habit-stats':type==='workout'?'workout-stats':'routine-stats');names.add('overview');}
        else for(const n of ['habits','morning','evening','workout','habit-stats','routine-stats','workout-stats','overview'] as const)names.add(n);
      }
    }
    this.replaceModules([...names]);
  }
  private renderModule(name:WidgetModule,parent:HTMLElement){
    const root=this.content,target=detachedEl(root,'div'),start=this.gestureCleanups.length;this.content=target;
    try{
      if(name==='navigation')this.navigation();else if(name==='calendar')this.calendar();else if(name==='tasks')this.tasks();
      else if(name==='day-rating')this.dailyRating();else if(name==='area-ratings')this.areaRatings();
      else if(['habits','morning','evening','workout'].includes(name))this.checklists(name==='habits'?'habit':name as 'morning'|'evening'|'workout');
      else if(name.endsWith('-stats')||name==='overview')this.statisticModule(name);
      for(const node of [...target.children]){(node as HTMLElement).dataset.renderModule=name;parent.append(node);}
      this.moduleCleanups.set(name,this.gestureCleanups.slice(start));
    }finally{this.content=root;}
  }
  private replaceModules(names:WidgetModule[]){
    if(this.disposed)return;const restore=preserveViewport(this.host);
    for(const name of canonicalLayout(names)){
      const old=[...this.content.querySelectorAll<HTMLElement>(`[data-render-module="${name}"]`)];if(!old.length)continue;
      const scrolls=old.flatMap(node=>[...node.querySelectorAll<HTMLElement>('.lp-calendar-scroll,.lp-chart-scroll,.lp-kanban')]).map(n=>({className:n.className,left:n.scrollLeft,top:n.scrollTop}));
      const details=old.flatMap(node=>[...node.querySelectorAll<HTMLDetailsElement>('details')]).map(d=>({key:d.className+'|'+(d.querySelector('summary')?.textContent??'').replace(/\d+/g,''),open:d.open}));
      const cleanups=this.moduleCleanups.get(name)??[];for(const cleanup of cleanups)cleanup();this.gestureCleanups=this.gestureCleanups.filter(c=>!cleanups.includes(c));
      const target=detachedEl(this.content,'div');this.renderModule(name,target);
      for(const node of [...target.children])old[0].before(node);for(const node of old)node.remove();
      const remaining=[...details];for(const d of this.content.querySelectorAll<HTMLDetailsElement>(`[data-render-module="${name}"] details`)){const key=d.className+'|'+(d.querySelector('summary')?.textContent??'').replace(/\d+/g,'');const index=remaining.findIndex(v=>v.key===key);if(index>=0){d.open=remaining[index].open;remaining.splice(index,1);}}
      const fresh=[...this.content.querySelectorAll<HTMLElement>(`[data-render-module="${name}"] .lp-calendar-scroll,[data-render-module="${name}"] .lp-chart-scroll,[data-render-module="${name}"] .lp-kanban`)];for(let i=0;i<scrolls.length;i++){const node=fresh[i],before=scrolls[i];if(node?.className===before.className){node.scrollLeft=before.left;node.scrollTop=before.top;}}
    }
    restore();
  }
  render(keepNavigation=false){
    const restore=preserveViewport(this.host,false);this.renderedArea=this.view.area;this.observedToday=today();
    if(this.disposed)return;
    // Area filtering changes content and capsule selection, not the header image.
    const retained=keepNavigation?[...this.content.children].filter(n=>(n as HTMLElement).dataset.renderModule==='navigation'):[];
    const retainedCleanups=retained.length?this.moduleCleanups.get('navigation')??[]:[];
    for(const cleanup of this.gestureCleanups)if(!retainedCleanups.includes(cleanup))cleanup();this.gestureCleanups=[...retainedCleanups];this.moduleCleanups.clear();if(retained.length)this.moduleCleanups.set('navigation',retainedCleanups);this.ratingBindings.clear();
    for(const child of [...this.content.children])if(!retained.includes(child))child.remove();
    const general=['day-rating','habits','morning','evening','workout','day-stats','habit-stats','routine-stats','workout-stats'];
    this.host.hidden=this.module!=='all'&&(this.context.type==='day'&&['task-stats','plans'].includes(this.module)||!this.layout().includes(this.module)||(this.selectedArea!=='all'&&general.includes(this.module)));
    this.host.classList.toggle('lp-comfortable',this.settings.density==='comfortable');
    this.host.classList.toggle('lp-concept',this.settings.theme==='concept');this.chrome.concept(this.settings.theme==='concept');
    this.host.style.setProperty('--lp-accent',this.settings.accent);this.host.style.setProperty('--lp-background',this.settings.background);
    this.host.style.setProperty('--lp-note-width',this.settings.width+'px');
    this.host.closest<HTMLElement>('.lp-wide-note')?.style.setProperty('--lp-note-width',this.settings.width+'px');
    const skin=noteStyle(this.settings.decoration,this.context);this.host.dataset.style=skin.preset;this.host.style.setProperty('--lp-font',styleFont(skin));this.host.closest<HTMLElement>('.lp-wide-note')?.style.setProperty('--lp-note-font',styleFont(skin));
    const accent=styleAccent((this.settings.decoration.notes[styleKey(this.context)]??this.settings.decoration.defaults[this.context.type]).preset);if(accent)this.host.style.setProperty('--lp-accent',accent);
    this.host.closest<HTMLElement>('.lp-wide-note')?.style.setProperty('--lp-note-accent',accent||this.settings.accent);
    if(this.host.hidden)return;
    const active=(name:WidgetModule)=>this.layout().includes(name)&&(this.module==='all'||this.module===name)&&(name!=='task-stats'||this.statisticsOwner?.owns()!==false)&&(this.selectedArea==='all'||!general.includes(name));
    const root=this.content;
    this.renderIssues();
    const groups=new Map<string,HTMLElement>();
    const groupFor=(name:WidgetModule)=>['calendar','tasks'].includes(name)?['agenda','Календарь и задачи']:['plans','task-stats','overview'].includes(name)?['results','Итоги задач']:['day-rating','area-ratings','day-stats','area-stats'].includes(name)?['ratings','Оценки и сферы жизни']:['habits','morning','evening','habit-stats','routine-stats'].includes(name)?['rhythm','Привычки и рутины']:['workout','workout-stats'].includes(name)?['workouts','Тренировки']:undefined;
    try{for(const name of this.layout()){
      if(!active(name)||this.context.type==='day'&&['task-stats','plans'].includes(name))continue;
      const group=groupFor(name);this.content=root;
      if(name==='navigation'&&retained.length){if(root.lastElementChild!==retained.at(-1))for(const node of retained)root.append(node);for(const b of root.querySelectorAll<HTMLElement>('.lp-sphere-tab'))b.setAttribute('aria-pressed',String(b.dataset.area===this.selectedArea));for(const b of root.querySelectorAll<HTMLElement>('.lp-week-strip [data-date]'))b.classList.toggle('is-today',b.dataset.date===today());if(this.context.type==='day'){root.querySelector('.lp-period h2')?.classList.toggle('is-today',this.context.start===today());const hint=root.querySelector('.lp-period-heading .lp-muted');if(hint)hint.textContent=new Date(this.context.start+'T12:00:00Z').toLocaleDateString('ru-RU',{weekday:'long',timeZone:'UTC'})+(this.context.start===today()?' · сегодня':'');}continue;}
      if(this.module==='all'&&group){let target=groups.get(group[0]);if(!target){target=el('section',root,undefined,'lp-space lp-space-'+group[0]);target.dataset.space=group[0];el('h2',target,group[1],'lp-space-title');groups.set(group[0],target);}this.content=target;}
      this.renderModule(name,this.content);
    }}finally{this.content=root;}
    restore();
  }
  private navigation(){
    const resolve=()=>resolveNoteAppearance(this.settings.decoration,this.context,new Date(),(file,builtin)=>!!this.actions.resolveMedia?.(file,builtin));
    const initial=resolve(),skin=initial.style;
    const header=el('div',this.content,undefined,'lp-header-layout');
    const saved=this.settings.decoration.notes[styleKey(this.context)],automatic=(!saved||saved.headerMode==='auto')&&(this.settings.decoration.modes?.[this.context.type]??'auto')==='auto';
    if(this.settings.decoration.enabled&&(initial.media||skin.preset!=='plain'||automatic)){
      const banner=el('div',header,undefined,'lp-note-banner'),img=el('img',banner),caption=el('small',header,'','lp-banner-caption');
      img.alt='';img.decoding='async';
      let active=true,generation=0,current='',currentUrl='',displayed=skin;
      const placeholder=el('span',banner,'Нет доступной шапки для этого сезона и времени. Проверьте коллекцию в настройках оформления.','lp-image-error');
      const message=()=>{const state=this.actions.headerCollection?.state;return state?.phase==='checking'?'Проверка коллекции шапок…':state?.phase==='downloading'?'Загрузка коллекции шапок…':state?.phase==='error'?state.message:'Нет доступной шапки для этого сезона и времени. Проверьте коллекцию в настройках оформления.';};
      const show=(next:ReturnType<typeof resolve>,url:string|undefined)=>{
        placeholder.textContent=message();placeholder.setAttribute('role','status');
        displayed=next.style;current=url?(next.media?.file??''):'';currentUrl=url??'';caption.dataset.file=current;
        banner.style.setProperty('--lp-mobile-focus',headerFocus(displayed.preset,this.settings.mobileHeaderFocus)+'%');
        caption.textContent=displayed.bannerPath?'Своя обложка':this.settings.decoration.covers?.find(c=>displayed.preset===`user:${c.id}`)?.title??(next.media?styleCaption(displayed.preset):'');
        img.hidden=!url;placeholder.hidden=!!url;banner.classList.toggle('lp-banner-error',!url);
        if(url){img.src=url;banner.setAttribute('role','button');banner.tabIndex=0;banner.setAttribute('aria-label','Открыть полный кадр шапки');}
        else{img.removeAttribute('src');banner.removeAttribute('role');banner.removeAttribute('tabindex');}
      };
      const urlFor=(next:ReturnType<typeof resolve>)=>next.media?this.actions.resolveMedia?.(next.media.file,next.media.builtin):undefined;
      show(initial,urlFor(initial));
      img.addEventListener('error',()=>{placeholder.textContent='Файл шапки недоступен. Проверьте установленную коллекцию в настройках оформления.';current='';img.hidden=true;placeholder.hidden=false;banner.classList.add('lp-banner-error');banner.removeAttribute('role');banner.removeAttribute('tabindex');});
      const full=()=>{if(!compactLayout(this.host)||img.hidden)return;this.forms.custom('Полный кадр шапки',(parent,close)=>{el('h3',parent,styleCaption(displayed.preset)||'Полный кадр шапки');button(parent,'Закрыть полный кадр',close,'lp-frame-close');const fullImage=el('img',parent);fullImage.src=img.src;fullImage.alt=styleCaption(displayed.preset);},'frame');};
      banner.addEventListener('click',full);banner.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();full();}});
      const refresh=()=>{
        const next=resolve(),file=next.media?.file??'',url=urlFor(next),token=++generation;if(!file)placeholder.textContent=message();if(file===current&&(url??'')===currentUrl)return;
        if(!url){show(next,undefined);return;}
        // Decode before swapping: old correct image remains until its successor
        // is ready. A late result cannot overwrite a newer clock/render.
        const pending=new Image();pending.src=url;
        void pending.decode().then(()=>{if(active&&token===generation)show(next,url);}).catch(()=>{if(active&&token===generation)show(next,undefined);});
      };
      const uncollection=this.actions.headerCollection?.subscribe(refresh);refresh();
      const unwatch=watchHeaderClock(refresh,banner);this.gestureCleanups.push(()=>{active=false;generation++;unwatch();uncollection?.();});
    }
    if(this.actions.saveSettings){const tools=el('div',header,undefined,'lp-style-tools');button(tools,'Сменить тему',()=>this.randomizeStyle(),'lp-style-button lp-style-random');button(tools,'Настроить тему',()=>this.changeStyle(),'lp-style-button');}
    const p=this.context,nav=el('nav',this.content,undefined,'lp-nav'),periods=el('div',nav,undefined,'lp-period-tabs');periods.setAttribute('role','group');periods.setAttribute('aria-label','Период заметки');
    for(const type of Object.keys(PERIOD_NAMES) as PeriodType[]){const date=this.view.dateFor(p,today()),color=periodAccent(type);const tab=button(periods,PERIOD_NAMES[type],()=>this.go(type,date),`lp-tab lp-${type}${type===p.type?' is-active':''}`);tab.style.setProperty('--lp-period-color',color);tab.dataset.period=type;tab.setAttribute('aria-pressed',String(type===p.type));}
    const todayGroup=el('div',nav,undefined,'lp-today-group'),divider=el('span',todayGroup,undefined,'lp-nav-divider');divider.setAttribute('aria-hidden','true');const todayButton=button(todayGroup,'Сегодня',()=>this.go('day',today()),'lp-today-button');navigationIcon(todayButton,'calendar-check');

    const row=el('div',this.content,undefined,'lp-period');row.style.setProperty('--lp-period-color',periodAccent(p.type));row.dataset.period=p.type;
    const previous=adjacent(p,-1), next=adjacent(p,1);
    const prev=button(row,'',()=>this.go(p.type,this.view.adjacentDate(p,-1,today())),'lp-period-arrow');prev.setAttribute('aria-label',`Предыдущий период: ${previous.label}`);navigationIcon(prev,'chevron-left');
    const monthName=new Date(p.start+'T12:00:00Z').toLocaleDateString('ru-RU',{month:'long',timeZone:'UTC'});
    const label=p.type==='week'?p.key.split('-')[1]:p.type==='month'?`${monthName[0].toUpperCase()+monthName.slice(1)} ${p.start.slice(0,4)}`:p.label;
    const heading=el('div',row,undefined,'lp-period-heading');el('span',heading,PERIOD_NAMES[p.type],'lp-eyebrow');const title=el('h2',heading,label);if(p.type==='day'){this.markDate(title,p.start);el('div',heading,new Date(p.start+'T12:00:00Z').toLocaleDateString('ru-RU',{weekday:'long',timeZone:'UTC'})+(p.start===today()?' · сегодня':''),'lp-muted');}else if(p.type!=='year')el('div',heading,`${formatDate(p.start)} — ${formatDate(addDays(p.end,-1))}`,'lp-muted');
    const forward=button(row,'',()=>this.go(p.type,this.view.adjacentDate(p,1,today())),'lp-period-arrow');forward.setAttribute('aria-label',`Следующий период: ${next.label}`);navigationIcon(forward,'chevron-right');
    const links=el('div',this.content,undefined,'lp-links');
    links.setAttribute('role','group');links.setAttribute('aria-label','Сферы жизни');
    const all=button(links,'',()=>this.view.setArea('all'),'lp-sphere-tab');navigationIcon(all,areaIcons.all);el('span',all,'Всё');all.dataset.area='all';all.setAttribute('aria-pressed',String(this.selectedArea==='all'));
    for(const area of enabledAreas(this.catalogue())){const b=button(links,'',()=>this.view.setArea(area.id),'lp-sphere-tab');navigationIcon(b,area.icon);el('span',b,area.title);b.style.setProperty('--lp-area',area.color);b.dataset.area=area.id;b.setAttribute('aria-pressed',String(this.selectedArea===area.id));}
    if(p.type==='day'||p.type==='week'){
      const week=period('week',p.start), strip=el('div',this.content,undefined,'lp-week-strip');
      for(const d of dates(week.start,week.end)){const b=button(strip,`${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'][weekday(d)-1]} ${formatDate(d).slice(0,5)}`,()=>this.go('day',d));b.dataset.date=d;this.markDate(b,d);}
    }
  }
  private randomizeStyle(){
    const next=structuredClone(this.settings);next.decoration.enabled=true;
    next.decoration.notes[styleKey(this.context)]=randomStyle(resolveNoteAppearance(this.settings.decoration,this.context,new Date(),(file,builtin)=>!!this.actions.resolveMedia?.(file,builtin)).style,next.decoration.collection,Math.random,next.decoration.covers,new Date(),this.context,(file,builtin)=>!!this.actions.resolveMedia?.(file,builtin));
    this.run(async()=>this.actions.saveSettings!(next));
  }
  private changeStyle(){
    this.forms.custom('Стиль этой заметки',(parent,close)=>{const form=el('div',parent,undefined,'lp-form lp-style-form');form.setAttribute('role','dialog');form.setAttribute('aria-label','Стиль этой заметки');el('h3',form,'Стиль этой заметки');
    const saved=this.settings.decoration.notes[styleKey(this.context)],s=saved&&saved.headerMode!=='auto'?saved:(this.settings.decoration.modes?.[this.context.type]==='fixed'?noteStyle(this.settings.decoration,this.context):resolveNoteAppearance(this.settings.decoration,this.context,new Date(),(file,builtin)=>!!this.actions.resolveMedia?.(file,builtin)).style),collectionGroup=el('div',form,undefined,'lp-theme-collection');collectionGroup.setAttribute('role','group');collectionGroup.setAttribute('aria-label','Коллекция тем');
    let collection=this.settings.decoration.collection;
    const all=button(collectionGroup,'Все темы',()=>setCollection('all'),'lp-theme-collection-button'),strict=button(collectionGroup,'Строгие темы',()=>setCollection('strict'),'lp-theme-collection-button');
    const covers=this.settings.decoration.covers??[],preset=select(form,'Оформление',availablePresets(collection,covers),s.preset),font=select(form,'Шрифт',FONT_OPTIONS,s.font);
    const selectedPreset=():NoteStyle['preset']=>preset.value==='saved-cover'?s.preset:preset.value as NoteStyle['preset'];
    const focus=field(form,'Положение кадра на телефоне',String(headerFocus(s.preset,this.settings.mobileHeaderFocus)),'range');focus.min='0';focus.max='100';focus.step='1';focus.classList.add('lp-header-focus-range');preset.addEventListener('change',()=>{focus.value=String(headerFocus(selectedPreset(),this.settings.mobileHeaderFocus));});el('small',form,'Левый и правый края — положение кадра для этой локации. Полный кадр открывается нажатием на шапку.');
    let focusStart=focus.value;this.forms.onClose(bindTouchRange(focus,()=>{focusStart=focus.value;},()=>{focus.value=focusStart;}));
    if(s.bannerPath){const option=el('option',preset,'Своя сохранённая обложка');option.value='saved-cover';preset.value='saved-cover';}else if(s.preset==='plain'){preset.value=this.settings.decoration.defaults[this.context.type].preset;if(!preset.value)preset.selectedIndex=0;}else if(![...preset.options].some(o=>o.value===s.preset)){const option=el('option',preset,STYLE_PRESETS.find(p=>p.id===s.preset)?.title??'Сохранённое оформление');option.value=s.preset;preset.value=s.preset;}
    function setCollection(value:typeof collection){collection=value;const chosen=preset.value,items=availablePresets(value,covers);preset.replaceChildren();for(const item of items){const option=el('option',preset,item.title);option.value=item.id;}if(chosen==='saved-cover'&&s.bannerPath){const option=el('option',preset,'Своя сохранённая обложка');option.value=chosen;}else if(!items.some(item=>item.id===chosen)&&chosen===s.preset){const option=el('option',preset,'Сохранённое оформление');option.value=chosen;}preset.value=[...preset.options].some(item=>item.value===chosen)?chosen:items[0].id;all.setAttribute('aria-pressed',String(value==='all'));strict.setAttribute('aria-pressed',String(value==='strict'));}
    setCollection(collection);
    el('small',form,'Свои обложки добавляются в общих настройках плагина → Оформление.');el('p',form,'','lp-error');
    let headerEdited=false;preset.addEventListener('change',()=>{headerEdited=true;});
    button(form,'Применить',()=>{const next=structuredClone(this.settings);next.decoration.enabled=true;next.decoration.collection=collection;next.mobileHeaderFocus={...next.mobileHeaderFocus,[selectedPreset()]:Number(focus.value)};next.decoration.notes[styleKey(this.context)]={preset:selectedPreset(),font:font.value as NoteStyle['font'],customFont:font.value===s.font?s.customFont:'',bannerPath:preset.value==='saved-cover'?s.bannerPath:'',motion:false,...(!headerEdited&&(!this.settings.decoration.notes[styleKey(this.context)]||this.settings.decoration.notes[styleKey(this.context)].headerMode==='auto')&&(this.settings.decoration.modes?.[this.context.type]??'auto')==='auto'?{headerMode:'auto' as const}:{})};this.run(async()=>{await this.actions.saveSettings!(next);close();});});
    button(form,'Вернуть автоматическую шапку',()=>this.run(async()=>{const next=structuredClone(this.settings);resetAutomaticHeader(next.decoration,this.context);next.decoration.modes={...next.decoration.modes,[this.context.type]:'auto'};await this.actions.saveSettings!(next);close();}));
    button(form,'По умолчанию для этого периода',()=>this.run(async()=>{const next=structuredClone(this.settings);delete next.decoration.notes[styleKey(this.context)];await this.actions.saveSettings!(next);close();}));button(form,'Отмена',()=>close());});
  }
  private markDate(node:HTMLElement,date:string,selected=this.context.start){if(date===today())node.classList.add('is-today');if(date===selected)node.classList.add('is-selected');}
  private calendar(){
    const p=this.context;
    if(p.type==='quarter'||p.type==='year'){
      const s=section(this.content,'Календарь'),cards=el('div',s,undefined,'lp-mini-months');
      this.gestureCleanups.push(renderMonthCards(cards,p.start,p.end,(type,date)=>this.go(type,date),this.view.dateFor(p,today())));
      return;
    }
    const s=section(this.content,'Календарь');button(s,'+ Событие',()=>this.forms.event(this.view.dateFor(p,today()),undefined,'10:00',undefined,this.selectedArea==='all'?undefined:{areaId:this.selectedArea}), 'lp-primary');
    let projected: EventOccurrence[];
    try { projected=occurrences(this.all('event'),p.start,p.end,'Europe/Moscow'); }
    catch(error){el('p',s,error instanceof Error?error.message:String(error),'lp-error');return;}
    if(p.type==='month'){this.monthCalendar(s,p,projected);return;}
    const hours=this.settings.calendar,startMinute=hours.startHour*60,endMinute=hours.endHour*60,height=hours.hourHeight;
    const range=dates(p.start,p.end);const scroller=el('div',s,undefined,'lp-calendar-scroll');scroller.setAttribute('tabindex','0');scroller.setAttribute('aria-label','Календарь на весь день. На узком экране прокрутите дни по горизонтали.');
    const grid=el('div',scroller,undefined,`lp-calendar-grid ${p.type==='week'?'lp-seven':''}`);
    const axis=el('div',grid,undefined,'lp-time-axis');el('div',axis,'Время','lp-axis-heading');const ticks=el('div',axis,undefined,'lp-axis-hours');ticks.style.height=((hours.endHour-hours.startHour)*height)+'px';for(let h=hours.startHour;h<=hours.endHour;h++){const tick=el('span',ticks,`${String(h).padStart(2,'0')}:00`);tick.style.top=`${(h-hours.startHour)*height}px`;if(h===hours.endHour)tick.className='lp-axis-end';}
    for(const date of range){
      const column=el('div',grid,undefined,'lp-day-column');column.dataset.date=date;const day=button(column,'',()=>this.go('day',date),'lp-day-heading'),caption=el('span',day);caption.append(day.ownerDocument.createTextNode(formatDate(date).slice(0,6)));el('wbr',caption);caption.append(day.ownerDocument.createTextNode(date.slice(0,4)));this.markDate(day,date,this.view.dateFor(p,today()));
      const timeline=el('div',column,undefined,'lp-timeline');timeline.dataset.date=date;timeline.dataset.startMinute=String(startMinute);timeline.dataset.endMinute=String(endMinute);timeline.dataset.hourHeight=String(height);timeline.style.height=((hours.endHour-hours.startHour)*height)+'px';this.gestureCleanups.push(bindSelection(timeline,date,fields=>this.forms.event(date,undefined,fields.start.slice(11,16),undefined,{...fields,...(this.selectedArea==='all'?{}:{areaId:this.selectedArea})})));
      for(let h=hours.startHour;h<hours.endHour;h++){const slot=button(timeline,'',()=>this.forms.event(date,undefined,`${String(h).padStart(2,'0')}:00`,undefined,this.selectedArea==='all'?undefined:{areaId:this.selectedArea}),'lp-hour');slot.style.top=`${(h-hours.startHour)*height}px`;slot.style.height=height+'px';slot.style.minHeight=height+'px';slot.setAttribute('aria-label',`Создать событие ${formatDate(date)} в ${h}:00`);}
      const events=projected.filter(e=>!e.allDay&&overlaps(e,date));
      const lanes: number[]=[];
      const placed=events.map(event=>{const minutes=(stamp:string)=>stamp.slice(0,10)<date?0:stamp.slice(0,10)>date?1440:Number(stamp.slice(11,13))*60+Number(stamp.slice(14,16));const start=minutes(event.start), end=minutes(event.end);let lane=lanes.findIndex(n=>n<=start);if(lane<0)lane=lanes.length;lanes[lane]=end;return{event,start,end,lane};});
      for(const{event,start,end,lane}of placed.filter(e=>e.end>startMinute&&e.start<endMinute)){const b=button(timeline,'',()=>this.editOccurrence(event),'lp-event');b.dataset.occurrenceKey=event.key;b.style.top=`${(Math.max(start,startMinute)-startMinute)*height/60}px`;b.style.height=`${Math.max(18,(Math.min(end,endMinute)-Math.max(start,startMinute))*height/60)}px`;b.classList.toggle('lp-event-short',(Math.min(end,endMinute)-Math.max(start,startMinute))*height/60<32);b.classList.toggle('lp-event-continues',end>endMinute||start<startMinute);b.style.setProperty('--lp-area',this.area(event.areaId)?.color??'var(--lp-accent)');b.style.left=`calc(100% * ${lane}/${lanes.length})`;b.style.width=`calc(100% / ${lanes.length})`;b.setAttribute('aria-label',`${event.title} · ${event.start.slice(11,16)}–${event.end.slice(11,16)}`);b.title=`${event.title} · ${this.area(event.areaId).title} · ${event.timezone}`;el('strong',b,event.title+(!this.area(event.areaId).enabled?' · '+this.area(event.areaId).title:''),'lp-event-title');el('span',b,`${event.start.slice(11,16)}–${event.end.slice(11,16)}`,'lp-event-time');const resize=el('span',b,undefined,'lp-resize-handle');resize.setAttribute('aria-hidden','true');resize.title='Потяните вниз, чтобы изменить длительность; точное время также доступно в форме.';this.gestureCleanups.push(bindEventGesture(b,event,grid,fields=>this.editOccurrence(event,fields),error=>{this.status.textContent=String(error);this.status.classList.add('lp-error');}));}
    }
    scroller.scrollTop=0;
    const scope=(tasks:Task[])=>sortTasksByArea(tasks.filter(t=>this.selectedArea==='all'||t.areaId===this.selectedArea),this.catalogue());
    const weekTasks=p.type==='week'?weeklyCalendarTasks(this.store.all('task'),p,today()):undefined;
    const hidden=this.all('visibility').filter(v=>v.hidden);
    const dayTasks=(date:string)=>scope(weekTasks?.byDay.get(date)??[]).filter(t=>!hidden.some(v=>v.taskId===t.id&&v.noteDate===date));
    const weekPlans=scope(weekTasks?.undated??[]),allDay=projected.filter(e=>e.allDay&&range.some(date=>overlaps(e,date)));
    if(allDay.length||range.some(date=>dayTasks(date).length)||weekPlans.length){
      grid.classList.add('has-untimed');el('span',axis,'Без времени','lp-untimed-axis');
      for(const date of range){const column=grid.querySelector<HTMLElement>(`.lp-day-column[data-date="${date}"]`)!,col=el('div',column,undefined,'lp-untimed-day');col.dataset.date=date;col.setAttribute('aria-label','Без времени · '+formatDate(date));
        for(const event of allDay.filter(e=>overlaps(e,date))){const b=button(col,event.title+(!this.area(event.areaId).enabled?' · '+this.area(event.areaId).title:''),()=>this.editOccurrence(event));b.dataset.occurrenceKey=event.key;b.title=event.title;b.style.setProperty('--lp-area',this.area(event.areaId).color);}
        for(const task of dayTasks(date))this.calendarTask(col,task,date);
      }
      if(weekPlans.length){const plans=el('div',grid,undefined,'lp-untimed-week'),body=el('div',plans,undefined,'lp-untimed-week-body');el('strong',body,'На неделю · день не выбран');for(const task of weekPlans)this.calendarTask(body,task);const fit=()=>plans.style.setProperty('--lp-calendar-visible-width',scroller.clientWidth+'px'),observer=new ResizeObserver(fit);observer.observe(scroller);fit();this.gestureCleanups.push(()=>observer.disconnect());}
    }
    if(p.type==='week'){
      const key=styleKey(p);if(this.calendarViewport?.key!==key)this.calendarViewport={key};
      const anchor=range.includes(today())?today():this.view.dateFor(p,today());
      this.gestureCleanups.push(bindCalendarViewport(scroller,this.calendarViewport,range.includes(anchor)?anchor:p.start));
    }
    const minutes=(stamp:string,date:string)=>stamp.slice(0,10)<date?0:stamp.slice(0,10)>date?1440:Number(stamp.slice(11,13))*60+Number(stamp.slice(14,16));
    const outside=projected.filter(e=>!e.allDay&&range.some(date=>overlaps(e,date)&&(minutes(e.start,date)<startMinute||minutes(e.end,date)>endMinute)));
    if(outside.length){const list=el('div',s,undefined,'lp-outside-hours');el('strong',list,'Вне видимых часов');for(const e of outside)button(list,e.start.slice(11,16)+'–'+e.end.slice(11,16)+' '+e.title+(!this.area(e.areaId).enabled?' · '+this.area(e.areaId).title:''),()=>this.editOccurrence(e));}
    if(p.type==='day')this.taskShortcut(s,p.start);
  }
  private calendarTask(parent:HTMLElement,task:Task,date?:string){
    const row=el('div',parent,undefined,'lp-calendar-task'+(task.status==='done'?' is-complete':''));row.dataset.taskId=task.id;row.style.setProperty('--lp-area',this.area(task.areaId).color);
    const hit=el('label',row,undefined,'lp-calendar-task-check'),checkbox=el('input',hit);checkbox.type='checkbox';checkbox.checked=task.status==='done';checkbox.setAttribute('aria-label','Выполнено: '+task.title);checkbox.disabled=this.context.end<=today();
    checkbox.addEventListener('change',()=>{checkbox.disabled=true;this.run(async()=>{await this.commitTaskStatus(task.id,checkbox.checked?'done':'todo',date);if(checkbox.isConnected)this.replaceModules(['calendar']);});});
    const edit=button(row,task.title+(!this.area(task.areaId).enabled?' · '+this.area(task.areaId).title:''),()=>{const current=this.store.get(task.id);if(current?.kind==='task'&&!current.archived)this.forms.task(date??this.view.dateFor(this.context,today()),current);});edit.title=task.title+' · '+this.area(task.areaId).title;edit.setAttribute('aria-label','Изменить задачу: '+task.title);
  }
  private taskShortcut(parent:HTMLElement,date:string){
    const summary=el('div',parent,undefined,'lp-task-shortcut');summary.hidden=true;
    const scope=this.host.closest<HTMLElement>('.lp-wide-note')??this.host;
    const target=()=>[...scope.querySelectorAll<HTMLElement>('.lp-section[data-task-note]')].find(s=>s.dataset.taskNote===date&&!s.closest<HTMLElement>('.life-planner')?.hidden);
    const jump=button(summary,'',()=>{const list=target();if(!list)return;list.focus({preventScroll:true});list.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});},'lp-task-jump');
    navigationIcon(jump,'list-checks');const caption=el('span',jump),arrow=el('span',jump,undefined,'lp-navigation-icon');setIcon(arrow,'arrow-down');arrow.setAttribute('aria-hidden','true');
    const sync=()=>{
      const list=target(),count=list?.querySelectorAll('.lp-task-row,.lp-kanban-card').length??0;summary.hidden=!list||count===0;
      if(!list||!count)return;
      const below=!!(summary.compareDocumentPosition(list)&Node.DOCUMENT_POSITION_FOLLOWING),board=!!list.querySelector('.lp-kanban');
      const noun=count%10===1&&count%100!==11?'задача':count%10>=2&&count%10<=4&&(count%100<12||count%100>14)?'задачи':'задач';
      const text=`${count} ${noun} ${board?'на доске':'в списке'} ${below?'ниже':'выше'}`;if(caption.textContent!==text)caption.textContent=text;arrow.style.transform=below?'':'rotate(180deg)';
    };
    // Sibling Markdown widgets may mount later. Observe their displayed rows, not records.
    const observer=new MutationObserver(sync);observer.observe(scope,{childList:true,subtree:true});this.gestureCleanups.push(()=>observer.disconnect());sync();
  }
  private editOccurrence(occurrence:EventOccurrence,preset?:Partial<EventFields>){const record=this.store.get(occurrence.eventId);if(record?.kind!=='event')return;try{if(preset&&record.version!==occurrence.sourceVersion)throw new Error('Событие изменено во время жеста. Повторите действие.');const proposed=preset?.start&&preset.end?projectEventTime({...occurrence,...preset},occurrenceFor(record,occurrence.originalDate)?.timezone??record.timezone):preset;this.forms.event(occurrence.start.slice(0,10),record,'10:00',occurrence.originalDate,proposed);}catch(error){this.status.textContent=error instanceof Error?error.message:String(error);this.status.classList.add('lp-error');}}
  private monthCalendar(parent:HTMLElement,p:Period,projected:EventOccurrence[]){
    this.compactMonth(parent,p,projected);
    const scroll=el('div',parent,undefined,'lp-month-scroll');scroll.setAttribute('tabindex','0');scroll.setAttribute('aria-label','Месячный календарь с номерами недель');
    const grid=el('div',scroll,undefined,'lp-month-grid');for(const d of ['№','Пн','Вт','Ср','Чт','Пт','Сб','Вс'])el('span',grid,d,'lp-muted');
    const range=miniCalendarRange(p.start);
    for(let start=range.start;start<range.end;start=addDays(start,7)){
      const week=period('week',start),w=button(grid,week.key.split('-W')[1],()=>this.go('week',start),'lp-month-week');w.setAttribute('aria-label','Неделя '+week.key);
      for(const date of dates(start,addDays(start,7))){
        if(date<p.start||date>=p.end){el('div',grid,undefined,'lp-month-outside');continue;}
        const cell=el('div',grid,undefined,'lp-month-cell');cell.dataset.date=date;const day=button(cell,String(Number(date.slice(8))),()=>this.go('day',date));this.markDate(day,date);
        const events=projected.filter(e=>e.featured===true&&overlaps(e,date));
        for(const event of events.slice(0,1)){const b=button(cell,'★ '+event.title+(!this.area(event.areaId).enabled?' · '+this.area(event.areaId).title:''),()=>this.editOccurrence(event),'lp-month-event');b.dataset.occurrenceKey=event.key;b.title=(event.allDay?'Весь день':event.start.slice(11,16))+' '+event.title+' · '+this.area(event.areaId).title;b.style.setProperty('--lp-area',this.area(event.areaId).color);b.setAttribute('aria-label',event.title);}
        const tasks=this.tasksOn(date).filter(t=>t.featured===true&&(t.status==='done'?(t.completedDate??t.completedAt?.slice(0,10))===date:(t.plannedDate??t.planPeriod?.date??t.dueDate)===date));
        if(!events.length)for(const task of tasks.slice(0,1)){const b=button(cell,'★ '+(task.status==='done'?'✓ ':'')+task.title,()=>this.go('day',date),'lp-month-task lp-month-event');b.dataset.taskId=task.id;b.setAttribute('aria-label',task.title);b.title=task.title;}
        const count=events.length+tasks.length;if(count>1)button(cell,'Ещё '+(count-1)+' избранных',()=>this.go('day',date),'lp-month-more');
      }
    }
  }
  private compactMonth(parent:HTMLElement,p:Period,projected:EventOccurrence[]){
    const box=el('div',parent,undefined,'lp-month-compact');
    if(this.monthSelected<p.start||this.monthSelected>=p.end)this.monthSelected=today()>=p.start&&today()<p.end?today():p.start;
    const monthTasks=(date:string)=>this.tasksOn(date).filter(t=>[t.plannedDate,t.dueDate,t.planPeriod?.type==='day'?t.planPeriod.date:undefined,t.status==='done'?t.completedDate??t.completedAt?.slice(0,10):undefined].includes(date));
    const choose=(date:string)=>{this.monthSelected=date;renderDetails();};
    const calendar=renderMiniCalendar(box,p.start,(type,date)=>{if(type==='day'&&date>=p.start&&date<p.end)choose(date);else this.go(type,date);},this.monthSelected);
    const details=el('section',box,undefined,'lp-month-details');details.setAttribute('aria-label','Записи выбранного дня');
    for(const day of calendar.querySelectorAll<HTMLButtonElement>('.lp-mini-date')){
      const date=day.dataset.date!,events=projected.filter(e=>overlaps(e,date)),tasks=monthTasks(date);
      if(events.length||tasks.length){el('span',day,undefined,'lp-month-indicator');day.setAttribute('aria-label',`${formatDate(date)} · событий: ${events.length}, задач: ${tasks.length}`);}
    }
    const renderDetails=()=>{
      const date=this.monthSelected;for(const b of calendar.querySelectorAll<HTMLElement>('.lp-mini-date')){const selected=b.dataset.date===date;b.classList.toggle('is-selected',selected);b.setAttribute('aria-pressed',String(selected));}
      details.replaceChildren();el('h4',details,formatDate(date));button(details,'Открыть день: все задачи и события',()=>this.go('day',date));
      const events=projected.filter(e=>overlaps(e,date)),tasks=monthTasks(date);
      if(!events.length&&!tasks.length)el('p',details,'На этот день нет событий и задач с датой.','lp-empty');
      for(const event of events){const b=button(details,'',()=>this.editOccurrence(event),'lp-month-detail');b.dataset.occurrenceKey=event.key;el('strong',b,event.title);el('small',b,(event.allDay?'Без времени':`${event.start.slice(11,16)}–${event.end.slice(11,16)}`)+' · '+this.area(event.areaId).title);b.style.setProperty('--lp-area',this.area(event.areaId).color);}
      for(const task of tasks){const b=button(details,'',()=>{const latest=this.store.get(task.id);if(latest?.kind==='task')this.forms.task(date,latest);},'lp-month-detail');b.dataset.taskId=task.id;el('strong',b,(task.status==='done'?'✓ ':'')+task.title);el('small',b,'Задача · '+this.area(task.areaId).title);b.style.setProperty('--lp-area',this.area(task.areaId).color);}
    };renderDetails();
  }
  private tasksOn(date:string):Task[]{return sortTasksByArea(dailyTasks(this.store.all('task'),date,today()).filter(t=>this.selectedArea==='all'||t.areaId===this.selectedArea),this.catalogue());}
  private tasks(){
    const s=section(this.content,'Задачи');s.dataset.taskNote=this.context.start;s.tabIndex=-1;const header=el('div',s,undefined,'lp-widget-header');header.append(s.querySelector('h3')!);const toolbar=el('div',header,undefined,'lp-actions lp-task-toolbar');button(toolbar,'+ Задача',()=>this.forms.task(this.view.dateFor(this.context,today()),undefined,this.selectedArea==='all'?undefined:this.selectedArea,undefined,planFor(this.context.type,this.context.start)),'lp-primary');
    for(const [mode,title]of [['list','Список'],['kanban','Канбан']] as const){const tab=button(toolbar,title,()=>{this.taskView=mode;this.replaceModules(['tasks']);});tab.setAttribute('aria-pressed',String(this.taskView===mode));}
    const filter=select(toolbar,'Сфера',[{id:'all',title:'Все сферы'},...this.historyAreas().map(a=>({...a,title:a.title+(a.enabled?'':' · выключена')}))],this.selectedArea);filter.addEventListener('change',()=>{this.view.setArea(filter.value);});
    const source=this.store.all('task'),date=this.context.start;
    if(source.some(t=>t.archived))button(toolbar,'Архив задач',()=>this.forms.archivedTasks(date));
    this.parentContext(s);
    const tasks=sortTasksByArea(ownPlanTasks(source,this.context,today()).filter(t=>this.selectedArea==='all'||t.areaId===this.selectedArea),this.catalogue());
    if(this.taskView==='kanban'){this.gestureCleanups.push(renderKanban(s,tasks,(task,status)=>this.run(()=>this.commitTaskStatus(task.id,status)),task=>{const canonical=this.store.get(task.id);if(canonical?.kind==='task')this.forms.task(date,canonical);},this.context.type==='day'?date:undefined,task=>{const canonical=this.store.get(task.id);if(canonical?.kind==='task')this.forms.archive(date,canonical);},this.catalogue(),{root:this.host,selected:this.kanbanStatus,select:status=>{this.kanbanStatus=status;},menu:task=>this.taskMenu(task,date)}));return;}
    const hidden=this.all('visibility').filter(v=>v.hidden&&v.noteDate===date).map(v=>v.taskId);
    if(this.context.type!=='day'){for(const done of [false,true]){const own=tasks.filter(t=>(t.status==='done')===done);if(!own.length)continue;const group=el('section',s,undefined,'lp-task-group'+(done?' lp-completed-group':''));el('h4',group,(done?'Выполнено':'Планы периода')+' · '+own.length);for(const task of own)this.taskRow(group,task,date,false);}return;}
    for(const [category,title]of Object.entries(TASK_GROUPS)){
      const matches=tasks.filter(t=>taskCategory(t,date)===category&&!hidden.includes(t.id));if(!matches.length)continue;
      const group=category==='done'?el('section',s,undefined,'lp-task-group lp-completed-group'):el('details',s,undefined,'lp-task-group');if(group.tagName==='DETAILS')(group as HTMLDetailsElement).open=category!=='future';el(category==='done'?'h4':'summary',group,`${title} · ${matches.length}`);
      for(const task of matches)this.taskRow(group,task,date,category==='overdue'||category==='past');
    }
    if(!tasks.length)el('p',s,'Добавьте первое дело. Плановый день и крайний срок можно оставить пустыми.','lp-empty');
    if(hidden.length){const details=el('details',s);el('summary',details,`Скрытые в этой заметке · ${hidden.length}`);for(const t of tasks.filter(t=>hidden.includes(t.id)))button(details,`Вернуть: ${t.title}`,()=>this.hide(t,date,false));}
  }
  private splitTask(task:Task,target=nextPlan(task.planPeriod?.type??'day'),anchor=task.planPeriod?.date??this.context.start){if(target)this.forms.task(anchor,undefined,task.areaId,undefined,planFor(target,anchor),task);}
  private parentContext(parent:HTMLElement){
    const tasks=parentPlanTasks(this.store.all('task'),this.context,today()).filter(t=>this.selectedArea==='all'||t.areaId===this.selectedArea);if(!tasks.length)return;const panel=el('details',parent,undefined,'lp-parent-context');el('summary',panel,'Из плана уровня выше · '+tasks.length);
    for(const t of tasks){const row=el('div',panel,undefined,'lp-parent-row');el('strong',row,t.title);const area=this.area(t.areaId);if(area){const badge=el('span',row,area.title,'lp-parent-area');badge.style.setProperty('--lp-area',area.color);}el('small',row,PERIOD_TITLES[t.planPeriod!.type]+' · '+formatDate(t.planPeriod!.date),'lp-muted');button(row,'Открыть план',()=>this.go(t.planPeriod!.type,t.planPeriod!.date));button(row,'Добавить шаг',()=>{const current=this.store.get(t.id);if(current?.kind==='task')this.splitTask(current,this.context.type,this.context.start);});}
  }
  private hide(task:Task,date:string,hidden:boolean){const id=visibilityId(task.id,date),record=this.store.get(id),existing=record?.kind==='visibility'?record:undefined;this.run(()=>this.store.save({...base(id),...existing,kind:'visibility',taskId:task.id,noteDate:date,hidden},existing?.version??0));}
  private commitTaskStatus(id:string,status:TaskStatus,date:string|undefined=this.context.type==='day'?this.context.start:undefined):Promise<unknown>{
    const operation=(this.taskStatusQueue.get(id)??Promise.resolve()).catch(()=>undefined).then(async()=>{
      const canonical=this.store.get(id);if(canonical?.kind!=='task'||canonical.archived)throw new Error('Задача больше не доступна. Обновите список.');
      const current=date?dailyTasks([canonical],date,today())[0]??canonical:canonical;
      if(current.status===status)return;
      return this.store.save(changeTask(canonical,{status},undefined,date,date),canonical.version);
    });this.taskStatusQueue.set(id,operation);void operation.then(()=>{if(this.taskStatusQueue.get(id)===operation)this.taskStatusQueue.delete(id);},()=>{if(this.taskStatusQueue.get(id)===operation)this.taskStatusQueue.delete(id);});return operation;
  }
  private taskMenu(task:Task,date:string,canHide=false,historical=false){
    const latest=this.store.get(task.id);if(latest?.kind!=='task')return;
    this.forms.custom('Действия задачи: '+latest.title,(parent,close)=>{
      el('h3',parent,latest.title);button(parent,'Закрыть действия задачи',close,'lp-sheet-close');
      const error=el('p',parent,'','lp-error');error.setAttribute('role','alert');let pending=false;
      for(const target of TASK_COLUMNS){const b=button(parent,target.title+(task.status===target.id?' · текущий':''),()=>{if(pending)return;pending=true;const buttons=[...parent.querySelectorAll<HTMLButtonElement>('button')];buttons.forEach(b=>b.disabled=true);void this.commitTaskStatus(task.id,target.id).then(close).catch(e=>{error.textContent=e instanceof Error?e.message:String(e);}).finally(()=>{pending=false;buttons.forEach(b=>b.disabled=false);});},'lp-sheet-status');b.setAttribute('aria-pressed',String(task.status===target.id));b.dataset.status=target.id;b.disabled=historical;}
      const canonical=()=>{const record=this.store.get(task.id);return record?.kind==='task'?record:undefined;};
      if(!historical){button(parent,'Изменить',()=>{const record=canonical();if(record){close();this.forms.task(date,record);}});if(latest.planPeriod&&nextPlan(latest.planPeriod.type))button(parent,'Разбить на шаги',()=>{const record=canonical();if(record){close();this.splitTask(record);}});button(parent,'Удалить задачу…',()=>{const record=canonical();if(record){close();this.forms.archive(date,record);}});}
      if(canHide)button(parent,'Скрыть на этот день',()=>{close();this.hide(latest,date,true);});
    },'sheet');
  }
  private taskRow(parent:HTMLElement,task:Task,date:string,canHide:boolean){
    const record=this.store.get(task.id);if(record?.kind!=='task')return;const historical=this.context.type==='day'?false:this.context.end<=today();
    const info=taskDisplay(task,this.catalogue()),row=el('div',parent,undefined,'lp-task-row'+(task.status==='done'?' is-complete':canHide||(task.plannedDate??(task.planPeriod?.type==='day'?task.planPeriod.date:undefined)??date)<date?' is-carried':''));row.style.setProperty('--lp-area',info.color);
    const label=el('label',row,undefined,'lp-check');const checkbox=el('input',label);checkbox.type='checkbox';checkbox.checked=task.status==='done';checkbox.disabled=historical;checkbox.title=historical?'Состояние в прошлом дне':'';
    const body=el('span',label,undefined,'lp-task-body');renderTaskTitle(el('strong',body),info);el('small',body,info.detail,'lp-muted');
    const cutoff=this.context.end<addDays(today(),1)?this.context.end:addDays(today(),1);
    row.dataset.taskId=task.id;if(task.parentId){const parentTask=this.store.get(task.parentId),state=parentTask?.kind==='task'?taskStateBefore(parentTask,cutoff):undefined;if(state)el('small',body,'Шаг: '+state.title,'lp-task-parent');}
    const children=this.store.all('task').map(t=>taskStateBefore(t,cutoff)).filter(t=>t?.parentId===task.id);if(children.length)el('small',body,'Шагов выполнено '+children.filter(t=>t!.status==='done').length+' из '+children.length,'lp-muted');
    if(record.planPeriod&&nextPlan(record.planPeriod.type)&&!historical)button(row,'Разбить на шаги',()=>this.splitTask(record));
    checkbox.addEventListener('change',()=>this.run(()=>this.commitTaskStatus(record.id,checkbox.checked?'done':'todo')));
    if(!historical||canHide){const mobile=button(row,'⋯',()=>this.taskMenu(task,date,canHide,historical),'lp-mobile-task-menu');mobile.setAttribute('aria-label','Действия задачи: '+task.title);const menu=el('details',row,undefined,'lp-row-menu'),trigger=el('summary',menu,'⋯');trigger.setAttribute('aria-label','Действия задачи: '+task.title);
      if(task.status!=='done'&&!historical)button(menu,'Изменить',()=>this.forms.task(date,record));if(canHide)button(menu,'Скрыть на этот день',()=>this.hide(record,date,true));
      if(!historical)button(menu,'Удалить задачу…',()=>this.forms.archive(date,record));
    }
  }
  private slider(parent:HTMLElement,title:string,value:number|null,max:number,save:(value:number|null)=>Promise<unknown>,recordId:string){
    parent.classList.add('lp-rating-card');const group=el('div',parent,undefined,'lp-slider');const label=el('label',group);el('span',label,title,'lp-sr-only');const output=el('output',label,value===null?'—':String(value));output.setAttribute('aria-label',value===null?'не оценено':String(value));
    const control=el('span',label,undefined,'lp-range-control'),track=el('span',control,undefined,'lp-range-track');track.setAttribute('aria-hidden','true');el('span',track,undefined,'lp-range-fill');el('span',track,undefined,'lp-range-thumb');
    const input=el('input',control);input.type='range';input.min='1';input.max=String(max);input.step='1';input.value=String(value??Math.ceil(max/2));input.setAttribute('aria-label',title);input.setAttribute('aria-valuetext',value===null?'не оценено':String(value));
    group.classList.toggle('is-unrated',value===null);const paint=()=>control.style.setProperty('--lp-slider-progress',`${(Number(input.value)-1)/(max-1)*100}%`);paint();
    let editing=false,pending=0;
    const sync=()=>{if(this.disposed||!input.isConnected||editing||pending)return;const record=this.store.get(recordId),value=record&&(record.kind==='day-rating'||record.kind==='daily-area-rating')?record.value:null;input.value=String(value??Math.ceil(max/2));output.value=value===null?'—':String(value);output.setAttribute('aria-label',value===null?'не оценено':String(value));input.setAttribute('aria-valuetext',value===null?'не оценено':String(value));group.classList.toggle('is-unrated',value===null);paint();};
    this.ratingBindings.set(recordId,sync);
    const win=input.ownerDocument.defaultView!;let settleTimer:number|undefined;
    const endEdit=()=>{if(!editing)return;editing=false;settleTimer=win.setTimeout(sync,0);};
    const cancelEdit=()=>{editing=false;sync();};
    this.gestureCleanups.push(bindTouchRange(input,()=>{editing=true;},cancelEdit,endEdit));input.addEventListener('pointerdown',e=>{if(!['touch','pen'].includes(e.pointerType))editing=true;});win.addEventListener('pointerup',endEdit);win.addEventListener('pointercancel',cancelEdit);
    this.gestureCleanups.push(()=>{win.removeEventListener('pointerup',endEdit);win.removeEventListener('pointercancel',cancelEdit);win.clearTimeout(settleTimer);});
    input.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))editing=true;});input.addEventListener('keyup',()=>{editing=false;sync();});input.addEventListener('blur',()=>{editing=false;sync();});
    input.addEventListener('input',()=>{group.classList.remove('is-unrated');output.value=input.value;output.setAttribute('aria-label',input.value);input.setAttribute('aria-valuetext',input.value);paint();});input.addEventListener('change',()=>{const value=Number(input.value);pending++;this.run(()=>{this.ratingQueue=this.ratingQueue.catch(()=>undefined).then(()=>{const current=this.store.get(recordId);if(current&&(current.kind==='day-rating'||current.kind==='daily-area-rating')&&current.value===value)return;return save(value);}).finally(()=>{pending--;if(!this.disposed&&input.isConnected)sync();});return this.ratingQueue;},true);});

  }
  private dailyRating(){const date=this.context.start,id=dayRatingId(date),record=this.store.get(id),r=record?.kind==='day-rating'?record:undefined;const s=section(this.content,'Оценка дня');this.slider(s,'Как прошёл день · 1–100',r?.value??null,100,async value=>{const old=this.store.get(id),latest=old?.kind==='day-rating'?old:undefined;return this.store.save({...base(id),...latest,kind:'day-rating',date,value},latest?.version??0);},id);}
  private areaRatings(){
    if(!this.areas().length)el('p',this.content,'Все сферы выключены. Добавьте или включите сферу в настройках.','lp-muted');
    for(const area of this.areas()){
      const date=this.context.start,key=dailyAreaRatingId(date,area.id);if(!area.enabled&&!this.store.get(key)){el('p',this.content,'Выключенная сфера: нет оценки за этот день.','lp-muted');continue;}const s=section(this.content,'Оценка · '+area.title);s.style.setProperty('--lp-area',area.color);s.classList.add('lp-area-rating');
      this.slider(s,area.title,(this.store.get(key) as import('../model').DailyAreaRating|undefined)?.value??null,10,async value=>{const old=this.store.get(key),r=old?.kind==='daily-area-rating'?old:undefined;return this.store.save({...base(key),...r,kind:'daily-area-rating',date,areaId:area.id,areaTitle:area.title,value,policyVersion:2},r?.version??0);},key);
    }
  }
  private checklists(only?:'habit'|'morning'|'evening'|'workout'){
    const date=this.context.start;
    for(const type of only?[only]:['habit','morning','evening','workout'] as const){
      const s=section(this.content,{habit:'Привычки',morning:'Утренняя рутина',evening:'Вечерняя рутина',workout:'Тренировка'}[type]);
      const defs=orderedDefinitions(this.all('definition').filter(d=>d.type===type),this.settings.definitionOrder?.[type]);const header=el('div',s,undefined,'lp-widget-header');header.append(s.querySelector('h3')!);const sectionGear=button(header,'',()=>this.forms.definitions(date,type),'lp-section-gear');sectionGear.setAttribute('aria-label',type==='workout'?'Управлять программами':type==='habit'?'Управлять привычками':'Управлять рутиной');sectionGear.title=sectionGear.getAttribute('aria-label')!;setIcon(sectionGear,'settings');
      if(type==='habit')button(s,'+ Привычка',()=>this.forms.habit(date));
      else if(type==='morning'||type==='evening')button(s,'+ Пункт',()=>this.forms.routineItems(date,type,defs.find(d=>!d.lifecycle?.filter(e=>e.date<=date).at(-1)?.archived&&(definitionAt(d,date)?.weekdays.length??1)>0)));
      else button(s,'+ Программа',()=>this.forms.definition(date,type));
      
      if(!defs.length)el('p',s,type==='habit'?'Добавьте привычку — отметка доступна каждый день.':'Добавьте собственные пункты.','lp-empty');
      for(const def of defs){
        if(def.lifecycle?.filter(e=>e.date<=date).at(-1)?.archived)continue;
        if(type==='workout'&&!definitionAt(def,date)?.weekdays.includes(weekday(date)))continue;
        const itemHost=type==='habit'?el('div',s,undefined,'lp-habit-row'):s;
        const version=definitionAt(def,date)??def.versions.at(-1)!;
        let definitionGear:HTMLButtonElement|undefined;if(type==='habit'||type==='workout'){const gear=button(itemHost,'',()=>this.forms.definitionVersion(date,def),'lp-definition-gear');definitionGear=gear;gear.setAttribute('aria-label',type==='habit'?`Настроить привычку: ${version.title}`:`Настроить программу: ${version.title}`);gear.title=gear.getAttribute('aria-label')!;setIcon(gear,'settings');}
        if(version.effectiveDate>date){el('p',s,`Начнёт действовать с ${formatDate(version.effectiveDate)}`,'lp-muted');continue;}
        if(!version.weekdays.length){el('p',s,`${version.title} · в архиве`,'lp-muted');continue;}
        if(!version.weekdays.includes(weekday(date))){el('p',s,`${version.title} · не запланировано (прежнее расписание)`,'lp-muted');continue;}
        const card=this.checklist(itemHost,def,date);if(type==='workout'&&definitionGear){const heading=card.querySelector('h4')!,header=el('div',undefined,undefined,'lp-program-header');header.append(heading,definitionGear);card.prepend(header);}
      }
      if(type==='workout'&&defs.length&&!defs.some(d=>definitionAt(d,date)?.weekdays.includes(weekday(date))))el('p',s,'На этот день тренировок нет.','lp-empty');
    }
  }
  private checklist(parent:HTMLElement,def:Definition,date:string){
    const id=checkinId(def.id,date),existing=this.store.get(id),entry=existing?.kind==='checkin'?existing:newCheckin(def,date);
    const card=el('div',parent,undefined,`lp-checklist lp-${def.type}-checklist`);card.dataset.definitionId=def.id;if(def.type==='workout')el('h4',card,entry.title);
    const save=(patch:Partial<Checkin>)=>this.run(()=>this.store.save({...entry,...patch},existing?.version??0));
    for(const item of entry.items){const label=el('label',card,undefined,'lp-check');const check=el('input',label);check.type='checkbox';check.checked=entry.states[item.id]??false;el('span',label,item.title);check.addEventListener('change',()=>save({states:{...entry.states,[item.id]:check.checked},finalized:def.type==='habit'?true:entry.finalized}));}
    if(def.type==='workout'){const label=el('label',card,undefined,'lp-field');el('span',label,'Комментарий к занятию');const comment=el('textarea',label);comment.value=entry.comment;comment.addEventListener('change',()=>save({comment:comment.value}));}
    if(def.type!=='habit')el('p',card,entry.finalized?'Отметки подтверждены':existing?'Черновик · вне процента':'Нет данных за этот день','lp-muted');else card.setAttribute('aria-label',entry.finalized?'Отметка подтверждена':'Нет отметки за этот день');
    if(def.type!=='habit')button(card,entry.finalized?'Вернуть в черновик':'Отметки за день заполнены',()=>save({finalized:!entry.finalized}));
    if(!entry.finalized&&def.type!=='habit')el('small',card,'Подтверждение учитывает неотмеченные пункты как пропуски.');
    return card;
  }
  private ratingChart(parent:HTMLElement,records:PlannerRecord[]){
    const points=dayRatingSeries(this.context,records,today());const observed=points.filter(point=>point.value!==null);
    el('h4',parent,'Динамика оценки дня');el('p',parent,observed.length?`Наблюдений: ${observed.length} из ${points.length}. Промежутки без точки не являются нулевой оценкой.`:'Пока нет оценок за прошедшую часть периода.','lp-muted');if(!points.length||!observed.length)return;
    const document=parent.ownerDocument,svg=parent.createSvg('svg');svg.setAttribute('viewBox','0 0 320 132');svg.setAttribute('role','img');svg.setAttribute('aria-label',`График оценки дня: наблюдений ${observed.length} из ${points.length}`);svg.classList.add('lp-rating-chart');parent.append(svg);
    const line=(x1:number,y1:number,x2:number,y2:number,stroke:string,width='1')=>{const node=document.createElementNS(svg.namespaceURI,'line');node.setAttribute('x1',String(x1));node.setAttribute('y1',String(y1));node.setAttribute('x2',String(x2));node.setAttribute('y2',String(y2));node.setAttribute('stroke',stroke);node.setAttribute('stroke-width',width);svg.append(node);};
    for(const value of [0,50,100]){const y=116-value;line(24,y,312,y,'var(--background-modifier-border, #c9c7d0)');const label=document.createElementNS(svg.namespaceURI,'text');label.setAttribute('x','0');label.setAttribute('y',String(y+4));label.setAttribute('fill','currentColor');label.setAttribute('font-size','10');label.textContent=String(value);svg.append(label);}
    const x=(index:number)=>points.length===1?168:24+288*index/(points.length-1),y=(value:number)=>116-value;
    let segment='';const flush=()=>{if(!segment)return;const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',segment);path.setAttribute('fill','none');path.setAttribute('stroke','var(--lp-accent, #8873bf)');path.setAttribute('stroke-width','2');svg.append(path);segment='';};
    points.forEach((point,index)=>{if(point.value===null){flush();return;}segment+=`${segment?' L':'M'}${x(index)} ${y(point.value)}`;});flush();
    points.forEach((point,index)=>{if(point.value===null)return;const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',String(x(index)));dot.setAttribute('cy',String(y(point.value)));dot.setAttribute('r','3');dot.setAttribute('fill','var(--lp-accent, #8873bf)');dot.setAttribute('aria-label',`${formatDate(point.date)}: ${point.value}`);const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=`${formatDate(point.date)}: ${point.value}`;dot.append(title);svg.append(dot);});
  }
  private areaStatisticAreas(){return this.areaStatsFilter==='history'?this.historyAreas():this.areaStatsFilter==='enabled'?this.areas():[this.area(this.areaStatsFilter)];}
  private areaObservations():PlannerRecord[]{return [...this.store.all('daily-area-rating'),...this.store.all('area-rating')];}
  private areaChart(parent:HTMLElement,records:PlannerRecord[]){
    const visible=this.areaStatisticAreas();const points=dailyAreaRatingSeries(this.context,this.areaObservations(),today()).filter(p=>visible.some(a=>a.id===p.areaId));el('h4',parent,'Динамика оценок сфер');el('p',parent,points.length?`Ежедневных наблюдений: ${points.length}. Будущие дни не показаны.`:'Пока нет оценок сфер за прошедшую часть периода.','lp-muted');if(!points.length)return;
    const document=parent.ownerDocument,svg=parent.createSvg('svg');svg.setAttribute('viewBox','0 0 320 132');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Динамика оценок сфер: наблюдений ${points.length}`);svg.classList.add('lp-rating-chart');parent.append(svg);
    const days=dates(this.context.start,this.context.end),indexByDate=new Map(days.map((date,index)=>[date,index]));const x=(date:string)=>days.length===1?168:24+288*(indexByDate.get(date)??0)/(days.length-1),y=(value:number)=>116-(value-1)*10;
    for(const value of [1,5,10]){const guide=document.createElementNS(svg.namespaceURI,'line');guide.setAttribute('x1','24');guide.setAttribute('x2','312');guide.setAttribute('y1',String(y(value)));guide.setAttribute('y2',String(y(value)));guide.setAttribute('stroke','var(--background-modifier-border, #c9c7d0)');svg.append(guide);const label=document.createElementNS(svg.namespaceURI,'text');label.setAttribute('x','0');label.setAttribute('y',String(y(value)+4));label.setAttribute('font-size','10');label.setAttribute('fill','currentColor');label.textContent=String(value);svg.append(label);}
    const groups=new Map<string,typeof points>();for(const point of points){const own=groups.get(point.areaId)??[];own.push(point);groups.set(point.areaId,own);}const color=(areaId:string)=>this.area(areaId)?.color??'var(--lp-accent, #8873bf)';for(const [areaId,own] of groups){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',own.map((point,index)=>`${index?'L':'M'}${x(point.date)} ${y(point.value)}`).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke',color(areaId));path.setAttribute('stroke-width','2');svg.append(path);for(const point of own){const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',String(x(point.date)));dot.setAttribute('cy',String(y(point.value)));dot.setAttribute('r','3');dot.setAttribute('fill',color(areaId));const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=`${formatDate(point.date)} · ${point.areaTitle}: ${point.value}`;dot.append(title);svg.append(dot);}}

  }
  private areaRadar(parent:HTMLElement,records:PlannerRecord[]){
    const scope=el('div',parent,undefined,'lp-actions'),filter=select(scope,'Сферы в статистике',[{id:'enabled',title:this.selectedArea==='all'?'Включённые сферы':'Выбранная сфера заметки'},{id:'history',title:'Все сферы, включая выключенные'},...this.historyAreas().map(a=>({id:a.id,title:a.title+(a.enabled?'':' · выключена')}))],this.areaStatsFilter);
    const output=el('div',parent);let manualWheel=false;
    const draw=()=>{output.replaceChildren();const areas=this.areaStatisticAreas();
      if(!areas.length){el('p',output,'Нет включённых сфер. История доступна через фильтр; включить или добавить сферу можно в настройках.','lp-muted');return;}
      const summaries=dailyAreaSummary(this.context,this.areaObservations(),today(),this.catalogue()),ratings=areas.map(a=>({...summaries.find(r=>r.areaId===a.id),areaId:a.id,areaTitle:a.title,mean:summaries.find(r=>r.areaId===a.id)?.mean??null,count:summaries.find(r=>r.areaId===a.id)?.count??0}));
      const wheel=(manualWheel||areaStatisticsView(areas.length)==='wheel')&&areas.length>=3;output.dataset.areaView=wheel?'wheel':'bars';
      const grid=el('div',output,undefined,'lp-area-metrics');for(const r of ratings){const c=el('article',grid,undefined,'lp-area-metric');c.dataset.area=r.areaId;c.style.setProperty('--lp-area',this.area(r.areaId).color);el('strong',c,r.areaTitle);el('output',c,r.mean===null?'нет данных':r.mean.toLocaleString('ru-RU',{maximumFractionDigits:1}));el('small',c,'Оценённых дней: '+r.count+' из '+observationWindow(this.context).elapsed+' прошедших · всего '+observationWindow(this.context).total);if(!wheel){const bar=el('progress',c);bar.max=10;bar.value=r.mean??0;bar.setAttribute('aria-label',r.areaTitle+': '+(r.mean===null?'нет данных':r.mean));if(r.mean===null)bar.hidden=true;}}
      if(areas.length>8)button(output,manualWheel?'Показать полосы':'Открыть колесо жизни',()=>{manualWheel=!manualWheel;draw();});
      if(!wheel)return;
      const doc=parent.ownerDocument,svg=parent.createSvg('svg');svg.setAttribute('viewBox','0 0 420 380');svg.setAttribute('role','img');svg.setAttribute('aria-label','Колесо жизни: оценено сфер '+ratings.filter(r=>r.mean!==null).length+' из '+areas.length);svg.classList.add('lp-rating-chart','lp-radar');output.append(svg);
      const point=(i:number,value:number)=>{const angle=-Math.PI/2+2*Math.PI*i/areas.length;return[210+112*value/10*Math.cos(angle),190+112*value/10*Math.sin(angle)];};
      for(const value of [2,4,6,8,10]){const ring=doc.createElementNS(svg.namespaceURI,'polygon');ring.setAttribute('points',areas.map((_,i)=>point(i,value).join(',')).join(' '));ring.setAttribute('fill','none');ring.setAttribute('stroke','var(--background-modifier-border)');svg.append(ring);}
      if(ratings.every(r=>r.mean!==null)){const polygon=doc.createElementNS(svg.namespaceURI,'polygon');polygon.setAttribute('points',ratings.map((r,i)=>point(i,r.mean!).join(',')).join(' '));polygon.setAttribute('fill','color-mix(in srgb,var(--lp-accent) 18%,transparent)');polygon.setAttribute('stroke','var(--lp-accent)');svg.append(polygon);}
      areas.forEach((area,i)=>{const r=ratings[i];if(r.mean!==null){const [x,y]=point(i,r.mean),dot=doc.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',String(x));dot.setAttribute('cy',String(y));dot.setAttribute('r','4');dot.setAttribute('fill',area.color);svg.append(dot);}const [x,y]=point(i,13.3),label=doc.createElementNS(svg.namespaceURI,'text');label.setAttribute('x',String(x));label.setAttribute('y',String(y));label.setAttribute('text-anchor','middle');label.setAttribute('font-size','12');label.setAttribute('fill',area.color);label.textContent=String(i+1);const detail=doc.createElementNS(svg.namespaceURI,'title');detail.textContent=area.title+' · '+(r.mean===null?'нет данных':r.mean+'/10');label.append(detail);svg.append(label);});
      const legend=el('ol',output,undefined,'lp-area-wheel-legend');for(const r of ratings)el('li',legend,r.areaTitle+': '+(r.mean===null?'нет данных':r.mean.toLocaleString('ru-RU',{maximumFractionDigits:1})+' /10'));
    };filter.addEventListener('change',()=>{this.areaStatsFilter=filter.value;manualWheel=false;this.replaceModules(['area-stats','overview']);});draw();
  }
  private taskChart(parent:HTMLElement){
    this.statisticsSelection(parent);
    const filter=select(parent,'Сферы в статистике задач',[{id:'enabled',title:'Включённые сферы'},{id:'history',title:'Все сферы, включая выключенные'},...this.historyAreas().map(a=>({id:a.id,title:a.title+(a.enabled?'':' · выключена')}))],this.taskStatsFilter);
    filter.addEventListener('change',()=>{this.taskStatsFilter=filter.value;this.replaceModules(['task-stats']);});
    if(this.actions.issues().length){el('p',parent,'Не удалось полностью загрузить данные. Статистика задач недоступна до устранения ошибок.','lp-error');return;}
    const areas=this.taskStatsFilter==='history'?this.historyAreas():this.taskStatsFilter==='enabled'?this.areas():[this.area(this.taskStatsFilter)];
    if(!areas.length){el('p',parent,'Нет включённых сфер. Выберите историческую сферу в фильтре или включите сферу в настройках.','lp-muted');return;}
    const values=areas.map(area=>({area,...this.taskStats(area.id)})),total=this.taskStats(this.taskStatsFilter==='enabled'||this.taskStatsFilter==='history'?(this.selectedArea==='all'?undefined:this.selectedArea):this.taskStatsFilter);
    this.desktopTaskChart(el('div',parent,undefined,'lp-task-stat-desktop'),values,total);
    const grid=el('div',parent,undefined,'lp-task-stat-cards');
    for(const stats of values){
      const area=stats.area,card=stats.total?el('details',grid,undefined,'lp-task-stat-card'):el('article',grid,undefined,'lp-task-stat-card lp-task-stat-empty');
      card.dataset.area=area.id;card.style.setProperty('--lp-area',area.color);
      const body=stats.total?el('summary',card):card;el('div',body,area.title,'lp-task-stat-name');
      if(!stats.total){el('div',body,'Нет задач','lp-task-stat-empty-message');el('div',body,'За выбранный период','lp-muted');continue;}
      el('div',body,`${stats.done} из ${stats.total}`,'lp-task-stat-value');el('div',body,'выполнено','lp-muted');
      const progress=el('progress',body);progress.max=stats.total;progress.value=stats.done;progress.setAttribute('aria-label',`${area.title}: выполнено ${stats.done} из ${stats.total}`);
      el('div',body,'Подробности ⌄','lp-task-stat-hint');const metrics=el('div',card,undefined,'lp-task-stat-metrics');
      for(const [title,value] of [['Вовремя',stats.onTime],['С опозданием',stats.late],['Без срока',stats.noDeadline]] as const){const row=el('div',metrics);el('span',row,title);el('b',row,String(value));}
    }
    this.taskStatisticActions(parent,values);
  }
  private desktopTaskChart(parent:HTMLElement,values:(TaskStatistics&{area:LifeArea})[],total:TaskStatistics){
    const max=Math.max(1,...values.flatMap(v=>[v.done,v.overdue,v.late]));
    const doc=parent.ownerDocument,font=parseFloat(doc.defaultView!.getComputedStyle(parent).fontSize)||16;
    const stride=Math.max(28,font*(String(max).length*.65+1)),width=Math.max(680,72+values.length*Math.max(136,stride*3+font*2)),step=(width-72)/values.length;
    const top=Math.max(34,font*2),bottom=top+201,height=bottom+12;
    const svg=parent.createSvg('svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.style.width=width+'px';svg.setAttribute('role','img');svg.setAttribute('aria-label','График задач: завершено '+total.done+', просрочено '+total.overdue+', завершено с опозданием '+total.late);svg.classList.add('lp-rating-chart','lp-task-chart');const scroll=el('div',parent,undefined,'lp-chart-scroll');scroll.tabIndex=0;scroll.setAttribute('aria-label','Столбчатый график задач по сферам');scroll.append(svg);
    const node=(tag:string,attrs:Record<string,string|number>,title?:string)=>{const n=doc.createElementNS(svg.namespaceURI,tag);for(const [key,value]of Object.entries(attrs))n.setAttribute(key,String(value));if(title!==undefined)n.textContent=title;svg.append(n);return n;};
    const tickStep=Math.max(1,Math.ceil(max/4)),axisMax=Math.ceil(max/tickStep)*tickStep;
    for(let value=0;value<=axisMax;value+=tickStep){const y=bottom-(bottom-top)*value/axisMax;node('line',{x1:48,x2:width-24,y1:y,y2:y,stroke:'currentColor','stroke-opacity':.12});node('text',{x:35,y:y+5,'font-size':'.8em','text-anchor':'end',fill:'currentColor','data-axis':'count'},String(value));}
    values.forEach((v,i)=>{const center=48+(i+.5)*step;if(!v.total){node('text',{x:center,y:bottom-12,'font-size':'.8em','text-anchor':'middle',fill:'currentColor'},'Нет задач');return;}
      for(const [j,value,color]of [[0,v.done,v.area.color],[1,v.overdue,'#e4747f'],[2,v.late,'#dfaa61']]as const){const x=center+(j-1)*stride,h=(bottom-top)*value/axisMax;node('rect',{x:x-9,y:bottom-h,width:18,height:h,rx:3,fill:color,'data-series':j,'data-area':v.area.id,'data-value':value});node('text',{x,y:bottom-h-9,'font-size':'.875em','text-anchor':'middle',fill:color},String(value));}
    });
    const labels=el('div',scroll,undefined,'lp-task-chart-labels');labels.style.width=width+'px';labels.style.gridTemplateColumns=`repeat(${values.length},minmax(0,1fr))`;
    for(const v of values){const label=el('span',labels,v.area.title);label.dataset.area=v.area.id;label.style.color=v.area.color;}
    const legend=el('div',parent,undefined,'lp-chart-legend');for(const [title,color]of [['Выполнено','var(--lp-accent)'],['Просрочено','#e4747f'],['Выполнено с опозданием','#dfaa61']]){const label=el('span',legend,title);label.style.setProperty('--lp-series',color);}el('p',parent,'Цифры над столбцами — количество задач. Цвет выполненных задач соответствует сфере.','lp-muted');
    const wrap=el('div',parent,undefined,'lp-table-scroll'),table=el('table',wrap,undefined,'lp-task-table'),head=el('tr',el('thead',table));for(const label of ['Сфера','Всего','Выполнено','Вовремя','С опозданием','Без срока','Открыто','Просрочено']){const th=el('th',head,label);th.setAttribute('scope','col');}const body=el('tbody',table);
    for(const v of values){const row=el('tr',body);row.dataset.area=v.area.id;const title=el('th',row,v.area.title);title.setAttribute('scope','row');title.style.color=v.area.color;if(!v.total){const cell=el('td',row);cell.colSpan=7;el('span',cell,'Нет задач');el('small',cell,'За выбранный период','lp-muted');continue;}for(const n of [v.total,v.done,v.onTime,v.late,v.noDeadline,v.open,v.overdue])el('td',row,String(n));}
  }
  private taskStatisticActions(parent:HTMLElement,values:(TaskStatistics&{area:LifeArea})[]){
    const actions=el('div',parent,undefined,'lp-task-stat-actions');el('h4',actions,'Задачи и долгосрочные планы');
    for(const stats of values){const area=stats.area,d=el('details',actions,undefined,'lp-area-plan');d.dataset.area=area.id;d.style.setProperty('--lp-area',area.color);const heading=el('summary',d,area.title);heading.dataset.activity=String(stats.done);
      button(d,'Долгосрочные планы',()=>this.run(()=>this.actions.openArea(area.id)));
      for(const task of stats.tasks){const type=task.planPeriod?.type??'day',anchor=task.status==='done'?(task.completedDate??task.completedAt!.slice(0,10)):task.planPeriod?.date??task.plannedDate??this.statisticsDay.value;button(d,(task.status==='done'?'✓ ':'')+task.title+' · '+PERIOD_TITLES[type],()=>this.go(type,anchor),task.status==='done'?'is-complete':'');}
    }
  }
  private habitChart(parent:HTMLElement,habits:ReturnType<typeof summarize>['habits']){
    el('h4',parent,'Привычки · выполнение');if(!habits.length){el('p',parent,'Нет привычек для этого периода.','lp-muted');return;}for(const habit of habits){const card=el('div',parent,undefined,'lp-checklist'),label=`Привычка ${habit.title}: ${habit.done} из ${habit.planned} выполнено`;el('strong',card,habit.title);const progress=el('progress',card);progress.max=Math.max(1,habit.planned);progress.value=habit.done;progress.setAttribute('aria-label',label);card.append(progress);el('p',card,`${habit.done} из ${habit.planned} выполнено · ${formatPercent(habit.percent)}. Пропусков: ${habit.missed}; нет данных: ${habit.unrecorded}.`,'lp-muted');}
  }
  private routineChart(parent:HTMLElement,_routines:ReturnType<typeof summarize>['routines']){renderActivityStatistics(parent,this.context,this.records(),today(),['morning','evening'],this.activitySelections);}
  private records():PlannerRecord[]{return (['task','event','visibility','day-rating','area-rating','daily-area-rating','definition','checkin'] as const).flatMap<PlannerRecord>(k=>k==='task'?this.store.all(k):this.all(k));}
  private legacyAreas(parent:HTMLElement,_ratings:ReturnType<typeof summarize>['legacyAreaRatings']){const visible=this.areaStatisticAreas(),ratings=summarize(this.context,this.areaObservations(),today(),undefined,this.catalogue()).legacyAreaRatings.filter(r=>visible.some(a=>a.id===r.areaId));if(!ratings.length)return;const d=el('details',parent);el('summary',d,'Прежние недельные оценки · отдельно от ежедневных');for(const r of ratings)el('p',d,`${r.areaTitle}: ${r.mean??'нет данных'} · наблюдений ${r.count}`);}
  private statisticModule(module:WidgetModule=this.module){
    const records=this.records(),data=summarize(this.context,records,today(),this.selectedArea==='all'?undefined:this.selectedArea,this.catalogue());
    const titles:Record<string,string>={'overview':'Сводка периода','day-stats':'Оценка дня · статистика','area-stats':'Сферы жизни · статистика','task-stats':'Задачи · статистика','habit-stats':'Привычки · статистика','routine-stats':'Рутины · статистика','workout-stats':'Тренировки · статистика'};
    const s=section(this.content,titles[module]);s.dataset.statistic=module;
    switch(module){
      case 'overview':el('p',s,this.selectedArea==='all'?`Завершено задач: ${this.taskStats(this.selectedArea==='all'?undefined:this.selectedArea).done} · тренировок: ${data.workouts.count} · оценённых дней: ${data.dayRatings.count} из ${data.dayRatings.expected}`:`Завершено задач: ${this.taskStats(this.selectedArea==='all'?undefined:this.selectedArea).done}`);break;
      case 'day-stats':el('p',s,`Средняя оценка: ${data.dayRatings.mean?.toLocaleString('ru-RU',{maximumFractionDigits:1})??'нет данных'} · оценено ${data.dayRatings.count} из ${data.dayRatings.expected} прошедших дней · всего ${observationWindow(this.context).total}`);this.ratingChart(s,records);break;
      case 'area-stats':this.areaRadar(s,records);this.areaChart(s,records);this.legacyAreas(s,data.legacyAreaRatings);break;
      case 'task-stats':this.taskChart(s);break;
      case 'habit-stats':this.habitChart(s,data.habits);break;
      case 'routine-stats':this.routineChart(s,data.routines);break;
      case 'workout-stats':renderActivityStatistics(s,this.context,records,today(),['workout'],this.activitySelections);break;
    }
  }
  private statisticsSelection(parent:HTMLElement){
    const levels=statisticsLevels(this.context.type),chosen=this.view.selectedStatistics(levels);
    const nav=el('nav',parent,undefined,'lp-stat-tabs');nav.setAttribute('aria-label','Уровень статистики задач');
    const titles:Record<PeriodType,string>={day:'Дневная статистика',week:'Недельная статистика',month:'Месячная статистика',quarter:'Квартальная статистика',year:'Годовая статистика'};
    const current:Record<PeriodType,string>={day:'Этот день',week:'Эта неделя',month:'Этот месяц',quarter:'Этот квартал',year:'Этот год'};
    for(const type of [...levels,...(levels.length>1?['all' as const]:[])]){const title=type==='all'?'Общая статистика':type===this.context.type?current[type]:titles[type],pressed=type==='all'?chosen.length===levels.length:chosen.includes(type);const b=button(nav,title,()=>this.view.toggleStatistics(type,levels),'lp-tab'+(pressed?' is-active':''));b.setAttribute('aria-pressed',String(pressed));}
    if(chosen.length>1){const list=el('div',parent,undefined,'lp-level-totals');for(const type of chosen){const stats=selectedTaskStatistics(this.store.all('task'),this.context,today(),[type],this.selectedArea==='all'?undefined:this.selectedArea);el('span',list,PERIOD_TITLES[type]+': '+stats.done+' / '+stats.total);}}
    if(chosen.length===1&&chosen[0]==='day')this.statisticsDayPicker(parent);
    return chosen;
  }
  private statisticsDayPicker(parent:HTMLElement){
    const picker=el('div',parent,undefined,'lp-stat-day-picker'),row=el('div',picker,undefined,'lp-stat-date-row');
    const update=(date:string)=>{if(this.statisticsDay.select(date))this.replaceModules(['plans','task-stats','overview']);};
    const previous=button(row,'‹',()=>{if(this.statisticsDay.shift(-1))update(this.statisticsDay.value);});previous.setAttribute('aria-label','Предыдущий день статистики');previous.disabled=!this.statisticsDay.previousAvailable;
    const input=field(row,'День статистики',this.statisticsDay.value,'date');input.min=this.statisticsDay.min;input.max=this.statisticsDay.max;input.addEventListener('change',()=>{if(!this.statisticsDay.select(input.value)){input.value=this.statisticsDay.value;return;}update(input.value);});
    const next=button(row,'›',()=>{if(this.statisticsDay.shift(1))update(this.statisticsDay.value);});next.setAttribute('aria-label','Следующий день статистики');next.disabled=!this.statisticsDay.nextAvailable;
    const footer=el('div',picker,undefined,'lp-stat-date-footer');el('span',footer,new Date(this.statisticsDay.value+'T12:00:00Z').toLocaleDateString('ru-RU',{weekday:'long',timeZone:'UTC'}),'lp-muted');
    const now=button(footer,'Сегодня',()=>update(today()),'lp-today-button lp-stat-today');now.setAttribute('aria-label','Сегодня в статистике');now.disabled=!this.statisticsDay.contains(today());if(now.disabled){now.title='Сегодня вне открытого периода';el('small',footer,'Сегодня вне открытого периода','lp-stat-today-explanation lp-muted');}now.setAttribute('aria-current',this.statisticsDay.value===today()?'date':'false');
  }
  private taskStats(areaId?:string){const chosen=this.view.selectedStatistics(statisticsLevels(this.context.type)),context=chosen.length===1&&chosen[0]==='day'?this.statisticsDay.context:this.context;return selectedTaskStatistics(this.store.all('task'),context,today(),chosen,areaId);}
  private summary(){
    const records=this.records();
    const data=summarize(this.context,records,today(),this.selectedArea==='all'?undefined:this.selectedArea,this.catalogue());const s=section(this.content,'Сводка периода');
    const metrics=el('div',s,undefined,'lp-metrics');
    const metric=(label:string,value:string)=>{const c=el('div',metrics,undefined,'lp-metric');el('strong',c,value);el('span',c,label);};
    metric('Средняя оценка дня',data.dayRatings.mean===null?'нет данных':data.dayRatings.mean.toLocaleString('ru-RU',{maximumFractionDigits:1}));metric('Оценённых дней',`${data.dayRatings.count} из ${data.dayRatings.expected}`);metric('Завершённых задач нижних уровней',String(this.taskStats(this.selectedArea==='all'?undefined:this.selectedArea).done));metric('Занятий',String(data.workouts.count));
    el('p',s,`Просрочено по сроку: ${this.taskStats().overdue}. Завершено с опозданием: ${this.taskStats().late}. Будущие дни не входят в полноту.`, 'lp-muted');
    this.ratingChart(s,records);
    this.areaChart(s,records);
    this.areaRadar(s,records);
    this.taskChart(s);
    this.habitChart(s,data.habits);
    this.routineChart(s,data.routines);
    el('h4',s,'Сферы · средние ежедневные оценки');for(const a of data.areaRatings)el('p',s,`${a.areaTitle}: ${a.mean===null?'нет данных':a.mean.toLocaleString('ru-RU',{maximumFractionDigits:1})} · наблюдений ${a.count}`);
    this.legacyAreas(s,data.legacyAreaRatings);
    el('h4',s,'Привычки · выполнено / запланировано');if(!data.habits.length)el('p',s,'Нет привычек для этого периода.','lp-muted');for(const h of data.habits)el('p',s,`${h.title}: ${formatPercent(h.percent)} · выполнено ${h.done} из ${h.planned}; пропусков ${h.missed}; нет данных ${h.unrecorded}`);
    renderActivityStatistics(s,this.context,records,today(),['workout'],this.activitySelections);
    el('p',s,'Графики и сводки используют сохранённые наблюдения. Вечерний отчёт редактируется ниже как обычный текст заметки.','lp-muted');
  }
}
