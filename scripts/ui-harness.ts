import './compat-harness';
import './dom-harness';
import {activityFixtureRecords} from './activity-fixture';
import {calendarDockingHarness} from './calendar-docking-harness';
import {widgetModule} from '../src/ui/modules';
import {HeaderCollection,HEADER_CATALOG} from '../src/headers/collection';
import {resolveNoteAppearance} from '../src/appearance';
import {createCloudHarness} from './cloud-harness';
import {CloudSettingsFile} from '../src/integrations/cloud-settings';
/** Development-only browser harness. Reuses production widget, storage and domain modules. */
import { RecordStore, type FileIO } from '../src/storage';
import { PlannerWidget } from '../src/ui/widget';
import { period } from '../src/periods';
import { areaRatingId, base, changeTask, newTask, dayRatingId, dailyAreaRatingId } from '../src/domain';
import {periodModules} from '../src/ui/modules';
import {acquirePlannerWidth} from '../src/ui/layout';
import type { PeriodType } from '../src/model';
import {defaultSettings,normalizeSettings,type PlannerSettings} from '../src/settings';
import {PlannerViewState} from '../src/view-state';
import {NotesService} from '../src/notes';
import {readEvent} from '../src/integrations/ical';
import {renderSettingsPanel,disposeSettingsPanel} from '../src/ui/settings-panel';
import {PlannerCalendarView} from '../src/ui/sidebar';
import {TFile} from 'obsidian';
import {hidePlannerMarkers,bindFreeNotes} from '../src/ui/note-chrome';
import {editorHarness} from './ui-editor-harness';
import {createOneTaskHarness} from './onetask-harness';
import {TaskSettingsFile} from '../src/integrations/task-settings';
import {mobileNotesHarness} from './mobile-notes-harness';
const prefix='lp-test:';
let headerAvailability:string[]|undefined;
Object.assign(window,{plannerHeaders:{available:(files?:string[])=>{headerAvailability=files;for(const entry of widgets)entry.widget.render();}}});
Object.assign(window,{plannerEditor:{create:()=>{Object.assign(window,{editorFixture:editorHarness()});}}});
Object.assign(window,{plannerReview:{seed:async()=>{for(let i=0;i<12;i++)await store.save({...base('month-event-'+i),kind:'event',title:(i<6?'Избранное событие ':'Обычное событие ')+i,start:'2026-10-02',end:'2026-10-03',allDay:true,timezone:'Europe/Moscow',areaId:'work',featured:i<6},0);}}});
let failRecordWrite = false;
let recordGate:Promise<void>|undefined,releaseRecordGate:(()=>void)|undefined;
let failReadback = false, badReadPath: string | undefined;
const io:FileIO={
  read:async p=>{if(p===badReadPath){badReadPath=undefined;return '{injected bad readback';}return localStorage.getItem(prefix+p);},write:async(p,t)=>{if(p.startsWith('Planner/Data/records/')&&recordGate)await recordGate;if(failRecordWrite&&p.startsWith('Planner/Data/records/')){failRecordWrite=false;throw new Error('Injected record write failure');}localStorage.setItem(prefix+p,t);if(failReadback&&p.startsWith('Planner/Data/records/')){failReadback=false;badReadPath=p;}},mkdir:async()=>{},
  list:async p=>Object.keys(localStorage).filter(k=>k.startsWith(prefix+p)).map(k=>k.slice(prefix.length)),
  create:async(p,t)=>{if(localStorage.getItem(prefix+p)!==null)return false;await io.write(p,t);return true;},
  replace:async(p,expected,t)=>{if(localStorage.getItem(prefix+p)!==expected)throw new Error('Conflict');await io.write(p,t);}
};
const store=new RecordStore(io);await store.load();
Object.assign(window,{plannerMobile:{saveDayRating:async(value:number)=>{const date='2026-10-01',id=dayRatingId(date),old=store.get(id),r=old?.kind==='day-rating'?old:undefined;await store.save({...base(id),...r,kind:'day-rating',date,value},r?.version??0);},seedTasks:async(n=8)=>{const ids:string[]=[];for(let i=0;i<n;i++){const id='mobile-task-'+i;ids.push(id);if(!store.get(id))await store.save({...newTask({title:i===0?'Мобильнаязадачабездлинныхпробелов'.repeat(4):'Мобильная задача '+i,areaId:i%2?'home':'work',plannedDate:'2026-10-01'},'2026-10-01T09:00:00+03:00'),id},0);}return ids;},notes:mobileNotesHarness(io)}});
Object.assign(window,{plannerExternal:{import:async(raw:string,areaId:string)=>{const parsed=readEvent(raw,areaId),id='external-ui-'+parsed.uid,old=store.get(id);await store.save({...parsed.event,id,version:old?.version??0},old?.version??0);return id;},get:(id:string)=>store.get(id)}});
Object.assign(window,{plannerM514:{holdWrites:()=>{recordGate=new Promise<void>(resolve=>{releaseRecordGate=resolve;});},releaseWrites:()=>{recordGate=undefined;releaseRecordGate?.();releaseRecordGate=undefined;}}});
Object.assign(window,{plannerM511:{seed:async()=>{for(const k of Object.keys(localStorage))if(k.startsWith(prefix))localStorage.removeItem(k);await store.reload();for(const type of ['day','week','month','quarter','year'] as const){let t=newTask({title:'Статистика '+type,areaId:'work',planPeriod:{type,date:period(type,'2026-10-02').start}},'2026-10-01T09:00:00+03:00');t={...t,id:'statistics-'+type};await store.save(changeTask(t,{status:'done'},'2026-10-02T09:00:00+03:00',type==='day'?'2026-10-02':undefined),0);}
await store.save({...newTask({title:'Завершить в будущей заметке',areaId:'work',plannedDate:'2026-10-03',planPeriod:{type:'day',date:'2026-10-03'}},'2026-10-01T09:00:00+03:00'),id:'future-date-task'},0);
await store.save({...newTask({title:'Перенос из прошлого',areaId:'home',plannedDate:'2026-10-01',planPeriod:{type:'day',date:'2026-10-01'}},'2026-09-30T09:00:00+03:00'),id:'carried-task'},0);}}});
let settings=normalizeSettings(JSON.parse(localStorage.getItem('lp-harness-settings')??'null')??{...defaultSettings(),calendar:{startHour:0,endHour:24,hourHeight:40}});const taskSettingsFile=new TaskSettingsFile(io);settings.taskConnection=await taskSettingsFile.load();const cloudSettingsFile=new CloudSettingsFile(io);settings.cloudConnection=await cloudSettingsFile.load(settings.cloudConnection);
const view=new PlannerViewState(),notes=new NotesService(io,'Planner',()=>settings);let currentType:PeriodType='day',currentDate='2026-10-01';
Object.assign(window,{plannerTaskFeedback:{seed:async()=>{
 for(const [i,areaId]of ['study','home','work','self','work','self'].entries()){const date='2026-10-13',t={...newTask({title:'Сфера fixture '+i,areaId,plannedDate:date,...(i===2?{dueDate:date}:{}),planPeriod:{type:'day' as const,date}},'2026-10-13T09:00:00+03:00'),id:'feedback-'+i};if(!store.get(t.id))await store.save(t,0);}
 const future={...newTask({title:'Явный будущий план',areaId:'study',plannedDate:'2026-10-14',planPeriod:{type:'day' as const,date:'2026-10-14'}},'2026-10-13T09:00:00+03:00'),id:'feedback-future'};if(!store.get(future.id))await store.save(future,0);
 const original={...newTask({title:'Отмена вчерашней отметки',areaId:'work',plannedDate:'2026-10-12'},'2026-10-12T09:00:00+03:00'),id:'feedback-past'},done=changeTask(original,{status:'done'},'2026-10-13T09:00:00+03:00','2026-10-12'),legacy=changeTask(done,{status:'todo'},'2026-10-13T09:10:00+03:00');if(!store.get(legacy.id))await store.save(legacy,0);
}}});
Object.assign(window,{plannerRevision:{seedTasks:async(ids:string[])=>{for(const areaId of ids)for(const [index,done,dueDate]of [[0,true,'2026-10-12'],[1,true,'2026-10-12'],[2,true,'2026-10-05'],[3,false,'2026-10-05']] as const){const task={...newTask({title:'Graph fixture '+index,areaId,dueDate,plannedDate:'2026-10-01',planPeriod:{type:'day',date:'2026-10-01'}},'2026-10-01T09:00:00+03:00'),id:'graph-'+areaId+'-'+index};if(!store.get(task.id))await store.save(done?changeTask(task,{status:'done'},'2026-10-10T09:00:00+03:00'):task,0);}}}});
if(!store.all('event').length)await store.save({...base('harness-event'),kind:'event',title:'Демо: встреча',start:'2026-10-01T10:00',end:'2026-10-01T11:00',allDay:false,timezone:'Europe/Moscow',areaId:'work'},0);
if(!store.all('task').length){const task=newTask({title:'Демо: вернуть книгу',areaId:'home',dueDate:'2026-09-30'},'2026-09-28T09:00:00+03:00');await store.save(task,0);}
if(!store.get(dayRatingId('2026-09-28')))await store.save({...base(dayRatingId('2026-09-28')),kind:'day-rating',date:'2026-09-28',value:70},0);
const host=document.querySelector<HTMLElement>('#app')!,frame=document.createElement('div');frame.className='markdown-preview-view is-readable-line-width';host.classList.add('markdown-preview-sizer');host.parentElement!.insertBefore(frame,host);frame.append(host);
const ordinary=document.createElement('div');ordinary.className='markdown-preview-view is-readable-line-width ordinary-fixture';const ordinarySizer=document.createElement('div');ordinarySizer.className='markdown-preview-sizer';ordinarySizer.textContent='Обычная заметка';ordinary.append(ordinarySizer);document.body.append(ordinary);
let headerResourceEpoch=0;
let liveHeaders:HeaderCollection|undefined,releaseHeaders:(()=>void)|undefined,headerLoading:Promise<void>|undefined,loadIssue=false;
let legacyStatistics=false;
let widgets:{widget:PlannerWidget;release:()=>void;host:HTMLElement}[]=[];let modular=false;
const mount=async(type:PeriodType,date:string)=>{
  currentType=type;currentDate=date;view.setDate(date);await notes.ensurePeriod(type,date);
  for(const entry of widgets){entry.widget.destroy();entry.release();}widgets=[];host.replaceChildren();
  const actions={headerCollection:liveHeaders,view,settings:()=>settings,saveSettings:(next:PlannerSettings)=>saveSettings(next),resolveMedia:(file:string,builtin:boolean)=>builtin&&(!liveHeaders||liveHeaders.resolve(file))&&(!headerAvailability||headerAvailability.includes(file))?'/media/'+file+(headerResourceEpoch?'#revision-'+headerResourceEpoch:''):undefined,openPeriod:mount,openNote:async()=>{},openArea:async(id:string)=>{host.dataset.openedArea=id;host.dataset.openedNote=await notes.areaNote(id);},exportData:async()=>{},recover:async()=>{},issues:()=>[...store.issues.map(i=>i.message),...(loadIssue?['Синтетическая ошибка чтения']:[])]};
  for(const module of legacyStatistics?['navigation','calendar','tasks',...((await io.read(await notes.ensurePeriod(type,date)))!.matchAll(/```life-planner\r?\n([a-z-]+)\r?\n```/g))].map(m=>typeof m==='string'?widgetModule(m):widgetModule(m[1])):modular?settings.layouts[type]:['all'] as const){const container=document.createElement('div');host.append(container);const release=acquirePlannerWidth(container),widget=new PlannerWidget(container,store,period(type,date),actions,module);widgets.push({widget,release,host:container});if(modular&&module==='tasks'){const p=document.createElement('p');p.className='free-markdown';p.textContent='Свободный текст между виджетами';host.append(p);}}
};
await mount('day','2026-10-01');
const saveSettings=async(next:PlannerSettings)=>{const previous=settings,normalized=normalizeSettings(next);if(JSON.stringify(previous.taskConnection)!==JSON.stringify(normalized.taskConnection))await taskSettingsFile.save(normalized.taskConnection);if(JSON.stringify(previous.cloudConnection)!==JSON.stringify(normalized.cloudConnection))await cloudSettingsFile.save(normalized.cloudConnection);settings=normalized;oneTask?.connection.settingsChanged();if(JSON.stringify(previous.cloudConnection)!==JSON.stringify(normalized.cloudConnection)){cloud?.connection.settingsChanged();cloud?.auto.trigger();}localStorage.setItem('lp-harness-settings',JSON.stringify(settings));await docking.changed(previous.sidebar,settings.sidebar);if(JSON.stringify(previous.layouts)!==JSON.stringify(settings.layouts)){await notes.syncLayouts();await mount(currentType,currentDate);}else for(const entry of widgets)entry.widget.render();};
let sidebar:PlannerCalendarView|undefined;const calendarHost=document.createElement('aside');calendarHost.id='sidebar-fixture';calendarHost.style.width='280px';calendarHost.style.maxWidth='100%';document.body.append(calendarHost);
const events=new Map<string,(()=>void)[]>();const on=(name:string,fn:()=>void)=>{events.set(name,[...(events.get(name)??[]),fn]);return{};};
const sidebarPlugin={get settings(){return settings;},notes,stateForActive:()=>view,openPeriod:mount};
const sidebarApp={workspace:{on,getActiveFile:()=>({path:'Planner/Data/sidebar-fixture.md'})},vault:{on,getAbstractFileByPath:(path:string)=>localStorage.getItem(prefix+path)?Object.assign(new TFile(),{path}):null}};
const openSidebar=async()=>{if(sidebar)await sidebar.onClose();await io.write('Planner/Data/sidebar-fixture.md','---\nlife-planner-type: '+currentType+'\nlife-planner-date: '+period(currentType,currentDate).start+'\n---');sidebar=new PlannerCalendarView({app:sidebarApp,contentEl:calendarHost} as any,sidebarPlugin as any);await sidebar.onOpen();};
const docking=calendarDockingHarness(calendarHost,openSidebar,()=>settings.sidebar);Object.assign(window,{plannerDocking:docking,plannerDockingSeed:async()=>{for(const e of store.all('event'))if(e.allDay&&['2026-10-19','2026-10-21','2026-10-22','2026-10-24'].includes(e.start))await store.save({...e,deleted:true},e.version);}});
const settingsHost=document.createElement('div');settingsHost.id='settings-fixture';document.body.append(settingsHost);
const oneTask=createOneTaskHarness(io,store,()=>settings,saveSettings,()=>settings.areas);Object.assign(window,{plannerOneTask:oneTask.controls});void oneTask.connection.restoreResult();
const cloud=createCloudHarness(io,store,()=>settings,saveSettings,()=>settings.areas,()=>cloudSettingsFile.assertCurrent());Object.assign(window,{plannerCloud:cloud.controls});
const showSettings=()=>renderSettingsPanel(settingsHost,{get:()=>settings,save:saveSettings,template:async type=>{settingsHost.dataset.template=await notes.template(type);},preview:type=>{settingsHost.dataset.preview=type;},openCalendar:openSidebar,openArea:async id=>{settingsHost.dataset.openedArea=id;settingsHost.dataset.openedNote=await notes.areaNote(id);},sync:()=>notes.syncLayouts(),export:async()=>{},recover:async()=>{},store,cloudConnection:cloud.connection,cloudAuto:cloud.auto});
Object.assign(window,{plannerNew:{settings:()=>settings,configure:saveSettings,showSettings,hideSettings:()=>{disposeSettingsPanel(settingsHost);settingsHost.replaceChildren();},openSidebar,followSidebar:async()=>{await io.write('Planner/Data/sidebar-fixture.md','---\nlife-planner-type: '+currentType+'\nlife-planner-date: '+period(currentType,currentDate).start+'\n---');for(const fn of events.get('active-leaf-change')??[])fn();},notes:()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith(prefix)&&k.endsWith('.md')).map(k=>[k.slice(prefix.length),localStorage.getItem(k)])),legacyNote:async(path:string)=>io.write(path,(await io.read(path))!.replace('\nall\n','\ncalendar\n')),appendNote:async(path:string,text:string)=>io.write(path,(await io.read(path))!+text),scope:(area:string)=>view.setArea(area)}});
// Only the isolated harness exposes test controls; none are included in the plugin.
Object.assign(window,{plannerRuntime:{seed:async()=>{const t=newTask({title:'Проверка жизни',areaId:'work',plannedDate:'2026-07-02'},'2026-10-02T09:00:00+03:00');await store.save(changeTask(t,{status:'done'},'2026-10-02T10:00:00+03:00'),0);return t.id;},hideMarkers:()=>{const box=document.createElement('div');box.innerHTML='<p>&lt;!-- life-planner-widgets:end --&gt;</p><p>Мой текст</p>';host.append(box);hidePlannerMarkers(box);return Array.from(box.children).map(e=>({text:e.textContent,hidden:(e as HTMLElement).hidden}));}}});
Object.assign(window,{plannerTest:{open:mount,modular:async(enabled:boolean=true)=>{modular=enabled;await mount('day','2026-10-01');},unmountFirst:()=>{const entry=widgets.shift();if(entry){entry.widget.destroy();entry.release();entry.host.remove();}},unmountAll:()=>{for(const e of widgets){e.widget.destroy();e.release();}widgets=[];},sourceRecords:()=>['task','event','visibility','day-rating','area-rating','daily-area-rating','definition','checkin'].flatMap(k=>store.all(k as any)),clearDayRating:async(date:string)=>{const id=dayRatingId(date),r=store.get(id);if(r?.kind==='day-rating')await store.save({...r,value:null},r.version);},saveDailyAreaRating:async(date:string,areaId:string,areaTitle:string,value:number)=>{const id=dailyAreaRatingId(date,areaId),old=store.get(id),r=old?.kind==='daily-area-rating'?old:undefined;await store.save({...base(id),...r,kind:'daily-area-rating',date,areaId,areaTitle,value,policyVersion:2},r?.version??0);},events:()=>store.all('event'),definitions:()=>store.all('definition'),reload:()=>store.reload(),saveAreaRating:async(weekStart:string,areaId:string,areaTitle:string,value:number)=>{const id=areaRatingId(weekStart,areaId),record=store.get(id),existing=record?.kind==='area-rating'?record:undefined;await store.save({...base(id),...existing,kind:'area-rating',weekStart,areaId,areaTitle,value,policyVersion:1},existing?.version??0);},saveLateTask:async()=>{const created=newTask({title:'Поздняя задача для графика',areaId:'family',dueDate:'2026-09-30'},'2026-09-29T09:00:00+03:00');await store.save(changeTask(created,{status:'done'},'2026-10-01T12:00:00+03:00'),0);},failNextWrite:()=>{failRecordWrite=true;},failNextReadback:()=>{failReadback=true;},rename:async(id:string,title:string)=>{const event=store.get(id);if(event?.kind!=='event')throw new Error('Event missing');await store.save({...event,title},event.version);}}});

Object.assign(window,{plannerNotes:{fixture:()=>{document.querySelector('#free-notes-fixture')?.remove();const box=document.createElement('div');box.id='free-notes-fixture';box.className='lp-wide-note';box.innerHTML='<div class="callout" data-callout="lp-notes"><div class="callout-title">Свободные записи</div><div class="callout-content"><p>Моя запись <a href="#free-notes-fixture">Ссылка</a></p></div></div>';document.body.append(box);const edit=()=>{box.dataset.edits=String(Number(box.dataset.edits??0)+1);};bindFreeNotes(box,edit);bindFreeNotes(box,edit);}}});

Object.assign(window,{plannerMobileFeedback:{seed:async()=>{
 for(let i=0;i<7;i++){const date='2026-10-'+String(19+i),next='2026-10-'+String(20+i);for(let j=0;j<(i===1?3:1);j++){const id=`feedback-all-${i}-${j}`;if(!store.get(id))await store.save({...base(id),kind:'event',title:j?'Оченьдлинноеназвание'.repeat(8):'Без времени '+date,start:date,end:next,allDay:true,timezone:'Europe/Moscow',areaId:'work'},0);}}
 for(const [id,start,end]of [['feedback-timed','22:20','23:20'],['feedback-ordinary','10:00','11:00']])if(!store.get(id))await store.save({...base(id),kind:'event',title:id==='feedback-timed'?'Позднее событие':'Обычное событие',start:'2026-10-20T'+start+':00',end:'2026-10-20T'+end+':00',allDay:false,timezone:'Europe/Moscow',areaId:'home'},0);
 for(let i=0;i<3;i++){const id='feedback-task-'+i;if(!store.get(id))await store.save({...newTask({title:i?'Длиннаязадачабезпробелов'.repeat(6):'Задача на 20 октября',areaId:'work',plannedDate:'2026-10-20',featured:i===0},'2026-10-19T09:00:00+03:00'),id},0);}
 },update:async()=>{const e=store.get('feedback-timed');if(e?.kind==='event')await store.save({...e,title:e.title+'!'},e.version);}}});

Object.assign(window,{plannerPolish:{
 seed:async()=>{
  const date='2026-10-20';
  for(const [area,count,done] of [['family',5,3],['home',2,0],['work',3,2]] as const)for(let i=0;i<count;i++){
   const id=`polish-${area}-${i}`;if(store.get(id))continue;const t={...newTask({title:'Статистика '+area+' '+i,areaId:area,plannedDate:date,dueDate:i%2?date:undefined},'2026-10-01T10:00:00+03:00'),id};await store.save(i<done?changeTask(t,{status:'done'},'2026-10-20T15:00:00+03:00',date):t,0);
  }
  const e={...base('polish-midnight'),kind:'event' as const,title:'До полуночи',start:date+'T23:00',end:'2026-10-21T00:00',allDay:false,timezone:'Europe/Moscow',areaId:'work'};if(!store.get(e.id))await store.save(e,0);
 },
 error:async(value:boolean)=>{loadIssue=value;for(const e of widgets)e.widget.render();},
 cold:async(mode:'slow'|'ready'|'update'|'missing')=>{
  const p=period('day','2026-10-20'),media=resolveNoteAppearance(settings.decoration,p,new Date(),()=>true).media!;
  const selected=HEADER_CATALOG.files.find(f=>f.path===media.file)!;const extra=HEADER_CATALOG.files.find(f=>f.path!==media.file)!;
  const manifest={...HEADER_CATALOG,files:mode==='update'?[selected,extra]:[selected]},bytes=mode==='missing'?undefined:await (await fetch('/media/'+selected.path)).arrayBuffer();
  const gate=new Promise<void>(r=>{releaseHeaders=r;});liveHeaders=new HeaderCollection({read:async path=>{if(mode!=='ready'&&path.endsWith('active.json'))await gate;return null;},write:async()=>{throw Error('Read only');},readBinary:async path=>path.endsWith('/media/'+selected.path)?bytes??null:null,writeBinary:async()=>{throw Error('Read only');},mkdir:async()=>{}},'.obsidian/plugins/life-planner',{manifest:async()=>{throw Error('No network');},image:async()=>{throw Error('No network');}},manifest);
  headerLoading=liveHeaders.initialize();if(mode==='ready')await headerLoading;await mount('day','2026-10-20');return {file:selected.path,phase:liveHeaders.state.phase};
 },
 ready:async()=>{releaseHeaders?.();await headerLoading;return liveHeaders?.state.phase;},
 resourceChanged:async()=>{headerResourceEpoch++;await liveHeaders?.check();return headerResourceEpoch;}
}});

Object.assign(window,{plannerRegressions:{
 legacy:async(enabled=true)=>{legacyStatistics=enabled;if(enabled){const p=period('week','2026-12-31'),path=await notes.ensurePeriod('week',p.start);await io.write(path,`---\nlife-planner-type: week\nlife-planner-date: ${p.start}\n---\nМой пользовательский текст [[Ссылка]] ![[Вложение.png]]\n\n\`\`\`life-planner\nplans\n\`\`\`\n\nТекст между блоками\n\n\`\`\`life-planner\ntask-stats\n\`\`\`\n`);await mount('week',p.start);return {path,text:await io.read(path)};}await mount('week','2026-10-20');},
 removeFirstStatistic:()=>{const index=widgets.findIndex(e=>e.host.querySelector('[data-statistic=task-stats]'));if(index>=0){const e=widgets.splice(index,1)[0];e.widget.destroy();e.release();e.host.remove();}},
 settingsRestart:async()=>{await saveSettings(settings);location.reload();}
}});

let calendarPeer:PlannerWidget|undefined,releaseCalendarPeer:(()=>void)|undefined;
Object.assign(window,{plannerCalendarTasks:{
 clear:async()=>{calendarPeer?.destroy();releaseCalendarPeer?.();document.querySelector('#calendar-day-peer')?.remove();for(const key of Object.keys(localStorage))if(key.startsWith(prefix))localStorage.removeItem(key);await store.reload();},
 peer:(date:string)=>{calendarPeer?.destroy();releaseCalendarPeer?.();document.querySelector('#calendar-day-peer')?.remove();const box=document.createElement('div');box.id='calendar-day-peer';document.body.append(box);releaseCalendarPeer=acquirePlannerWidth(box);calendarPeer=new PlannerWidget(box,store,period('day',date),{view:new PlannerViewState(),settings:()=>settings,saveSettings,openPeriod:mount,openNote:async()=>{},openArea:async()=>{},exportData:async()=>{},recover:async()=>{},issues:()=>store.issues.map(i=>i.message)});},
 removePeer:()=>{calendarPeer?.destroy();releaseCalendarPeer?.();document.querySelector('#calendar-day-peer')?.remove();calendarPeer=undefined;},
 events:async()=>{for(const [id,start,end]of [['calendar-late','2026-10-22T22:20:00','2026-10-22T23:20:00'],['calendar-midnight','2026-10-22T23:00:00','2026-10-23T00:00:00']])await store.save({...base(id),kind:'event',title:id,start,end,allDay:false,timezone:'Europe/Moscow',areaId:'work'},0);}
}});

Object.assign(window,{plannerActivity:{
 seed:async()=>{for(const record of activityFixtureRecords())if(!store.get(record.id))await store.save(record,0);},
 snapshot:()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith(prefix)||k==='lp-harness-settings').sort().map(k=>[k,localStorage.getItem(k)])),
 rename:async()=>{const d=store.get('activity-workout-a');if(d?.kind==='definition')await store.save({...d,versions:[...d.versions,{...d.versions.at(-1)!,effectiveDate:'2026-10-24',title:'Переименовано без разрыва истории'}]},d.version);}
}});
