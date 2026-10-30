import type {HeaderCollection} from '../headers/collection';
import {renderHeaderCollection} from './header-collection';
import {renderAreaSettings} from './area-settings';
import {preserveViewport} from './stability';
import { button,el,field,select } from './elements';
import {defaultSettings,PERIOD_TYPES,PERIOD_TITLES,type PlannerSettings} from '../settings';
import {periodModules} from './modules';
import {today} from '../periods';
import {Forms} from './forms';
import type {PlannerStore,PeriodType} from '../model';


import {availablePresets,FONT_OPTIONS,localImagePath,type NoteStyle,type UserCover} from '../appearance';
import type {CalendarConnection} from '../integrations/connection';

import type {TaskConnection} from '../integrations/task-connection';
import {disposeTaskConnection} from './task-connection';
import type {CloudConnection,CloudAutoSync} from '../integrations/cloud-connection';
import {renderCloudPanel,disposeCloudPanel} from './cloud-connection';
export const MODULE_TITLES:Record<string,string>={navigation:'Навигация',calendar:'Календарь',tasks:'Задачи',plans:'Задачи по сферам','day-rating':'Оценка дня','area-ratings':'Оценки сфер',habits:'Привычки',morning:'Утро',evening:'Вечер',workout:'Тренировка',overview:'Обзор','day-stats':'Оценки дня · статистика','area-stats':'Сферы · статистика','task-stats':'Задачи · статистика','habit-stats':'Привычки · статистика','routine-stats':'Рутины · статистика','workout-stats':'Тренировки · статистика',tools:'Инструменты'};
export interface SettingsActions {headers?:HeaderCollection;get:()=>PlannerSettings;save:(settings:PlannerSettings)=>Promise<void>;connectDailyNotes?:()=>Promise<void>;template:(type:PeriodType)=>Promise<void>;preview:(type:PeriodType)=>void;openCalendar:()=>Promise<void>;sync:()=>Promise<unknown>;export:()=>Promise<void>;recover:()=>Promise<void>;store:PlannerStore;calendarConnection?:CalendarConnection;taskConnection?:TaskConnection;cloudConnection?:CloudConnection;cloudAuto?:CloudAutoSync;openArea?:(id:string)=>Promise<void>}
const subscriptions=new WeakMap<HTMLElement,()=>void>();
export function disposeSettingsPanel(host:HTMLElement){subscriptions.get(host)?.();subscriptions.delete(host);for(const panel of host.querySelectorAll<HTMLElement>('.lp-task-connection'))disposeTaskConnection(panel);for(const panel of host.querySelectorAll<HTMLElement>('.lp-cloud-connection'))disposeCloudPanel(panel);}
/** Shared production renderer; the browser harness can exercise the exact settings UI. */
export function renderSettingsPanel(host:HTMLElement,actions:SettingsActions,section='Периоды и шаблоны',selectedType:PeriodType='day'){
 disposeSettingsPanel(host);host.replaceChildren();host.classList.add('life-planner','lp-settings');const error=el('p',host,'','lp-error');error.setAttribute('role','status');
 const run=(f:()=>Promise<unknown>)=>{void f().catch(e=>{error.textContent=String(e instanceof Error?e.message:e);});};
 const update=(edit:(s:PlannerSettings)=>void)=>run(async()=>{const restore=preserveViewport(host),next=structuredClone(actions.get());edit(next);await actions.save(next);renderSettingsPanel(host,actions,section,selectedType);restore();});
 el('h2',host,'Manifest');const nav=el('nav',host,undefined,'lp-settings-tabs');
 for(const title of ['Периоды и шаблоны','Календарь','Связь с облаком','Сферы жизни','Ежедневный цикл','Оформление','Данные и диагностика']){const b=button(nav,title,()=>renderSettingsPanel(host,actions,title,selectedType));b.setAttribute('aria-pressed',String(title===section));}
 const s=actions.get(),body=el('div',host,undefined,'lp-settings-body');el('h3',body,section);
 const toggle=(name:string,value:boolean,edit:(s:PlannerSettings,v:boolean)=>void)=>{const row=el('label',body,undefined,'lp-setting-row');el('span',row,name);const input=el('input',row);input.type='checkbox';input.checked=value;input.addEventListener('change',()=>update(s=>edit(s,input.checked)));return input;};
 const number=(name:string,value:number,min:number,max:number,edit:(s:PlannerSettings,v:number)=>void)=>{const input=field(body,name,String(value),'number');input.min=String(min);input.max=String(max);input.addEventListener('change',()=>{if(!input.checkValidity()){input.reportValidity();return;}update(s=>edit(s,Number(input.value)));});};
 if(section==='Связь с облаком'){if(actions.cloudConnection)renderCloudPanel(el('div',body),actions.cloudConnection,c=>actions.save({...actions.get(),cloudConnection:c}),actions.cloudAuto,actions.recover);else el('p',body,'Подключение недоступно в этом предпросмотре.');} else if(section==='Периоды и шаблоны'){
  const type=select(body,'Тип заметки',PERIOD_TYPES.map(id=>({id,title:PERIOD_TITLES[id]})),selectedType);
  type.addEventListener('change',()=>renderSettingsPanel(host,actions,section,type.value as PeriodType));
  const folder=field(body,'Папка новых заметок',s.folders[selectedType]);el('small',body,'В Planner/Journal. Существующие заметки остаются на своих местах и открываются по metadata.');
  folder.addEventListener('change',()=>{if(!folder.value.trim()||/[\\/:*?"<>|]/.test(folder.value)||/[. ]$/.test(folder.value)||['.','..'].includes(folder.value)||new Set(Object.entries(s.folders).filter(([t])=>t!==selectedType).map(([,f])=>f.toLocaleLowerCase())).has(folder.value.toLocaleLowerCase())){error.textContent='Нужна отдельная корректная папка для каждого типа.';return;}update(s=>{s.folders[selectedType]=folder.value;});});
  el('h4',body,'Виджеты — состав и порядок');
  const layout=s.layouts[selectedType],available=[...layout,...periodModules(selectedType).filter(m=>!layout.includes(m))];for(const module of available){
   const enabled=layout.includes(module),index=layout.indexOf(module),row=el('div',body,undefined,'lp-setting-row');el('strong',row,MODULE_TITLES[module]??module);
   for(const [direction,title] of [[-1,'↑'],[1,'↓']] as const){const b=button(row,title,()=>update(s=>{const list=s.layouts[selectedType];[list[index],list[index+direction]]=[list[index+direction],list[index]];}));b.disabled=!enabled||index+direction<0||index+direction>=layout.length;b.setAttribute('aria-label',(direction===-1?'Выше: ':'Ниже: ')+MODULE_TITLES[module]);}
   const label=el('label',row,undefined,'lp-switch-hit'),input=el('input',label);input.type='checkbox';input.className='lp-toggle';input.setAttribute('role','switch');input.setAttribute('aria-label','Показывать: '+MODULE_TITLES[module]);input.checked=enabled;
   input.addEventListener('change',()=>update(s=>{s.layouts[selectedType]=input.checked?[...s.layouts[selectedType],module]:s.layouts[selectedType].filter(m=>m!==module);}));
  }
  el('p',body,'Изменения применяются к виджетам и служебному участку заметок. Обычный текст за его пределами сохраняется. Заметки прежнего формата без отметок не переписываются.','lp-muted');
  button(body,'Редактировать текст шаблона',()=>run(()=>actions.template(selectedType)));
  button(body,'Предпросмотр',()=>actions.preview(selectedType));
  button(body,'Применить компоновку к заметкам',()=>run(actions.sync));
  button(body,'Восстановить состав по умолчанию',()=>update(s=>{s.layouts[selectedType]=defaultSettings().layouts[selectedType];}));
 }else if(section==='Календарь'){
  el('h4',body,'Daily Notes');
  el('p',body,s.dailyNotes==='enabled'?'Подключено к Manifest.':s.dailyNotes==='disabled'?'Интеграция отключена. Настройки Daily Notes не меняются.':'Подключение необязательно. Без вашего действия настройки Daily Notes не меняются.');
  el('small',body,'Подключение заменит папку, формат и шаблон Daily Notes на настройки планировщика и включит основной модуль. Исходные настройки будут сохранены в резервной копии.');
  if(actions.connectDailyNotes)button(body,'Подключить Daily Notes',()=>run(async()=>{await actions.connectDailyNotes!();renderSettingsPanel(host,actions,section,selectedType);}));
  button(body,'Не подключать Daily Notes',()=>update(s=>{s.dailyNotes='disabled';}));
  number('Первый видимый час',s.calendar.startHour,0,23,(s,v)=>{s.calendar.startHour=v;s.calendar.endHour=Math.max(s.calendar.endHour,v+1);});
  number('Конец видимого диапазона',s.calendar.endHour,s.calendar.startHour+1,24,(s,v)=>{s.calendar.endHour=v;});
  number('Высота часа, px',s.calendar.hourHeight,24,72,(s,v)=>{s.calendar.hourHeight=v;});
  el('p',body,'Весь выбранный диапазон развернут без внутреннего скролла. События вне него доступны отдельно. Даты событий не меняются.','lp-muted');
  button(body,'Показать полные сутки',()=>update(s=>{s.calendar.startHour=0;s.calendar.endHour=24;}));
  toggle('Открывать боковой календарь при запуске',s.sidebar.enabled,(s,v)=>{s.sidebar.enabled=v;});
  toggle('Календарь следует за открытой заметкой',s.sidebar.follow,(s,v)=>{s.sidebar.follow=v;});
  const side=select(body,'Сторона календаря',[{id:'left',title:'Слева'},{id:'right',title:'Справа'}],s.sidebar.side);side.addEventListener('change',()=>update(s=>{s.sidebar.side=side.value as 'left'|'right';}));
  button(body,'Открыть боковой календарь',()=>run(actions.openCalendar));
  button(body,'Сбросить настройки календаря',()=>update(s=>{s.calendar=defaultSettings().calendar;s.sidebar=defaultSettings().sidebar;}));
 }else if(section==='Сферы жизни'){
  renderAreaSettings(body,s.areas,edit=>update(next=>edit(next.areas)),error,actions.openArea,run);
 }else if(section==='Ежедневный цикл'){
  const panel=el('div',body),forms=new Forms(panel,actions.store,undefined,()=>actions.get().areas);
  button(body,'+ Привычка',()=>forms.habit(today()));
  for(const kind of ['morning','evening'] as const)button(body,kind==='morning'?'+ Пункты утра':'+ Пункты вечера',()=>forms.routineItems(today(),kind,actions.store.all('definition').find(d=>d.type===kind)));
  button(body,'+ Программа тренировки',()=>forms.definition(today(),'workout'));
  const definitions=el('div',body);const refresh=()=>{definitions.replaceChildren();for(const def of actions.store.all('definition'))button(definitions,'Редактировать: '+def.versions.at(-1)!.title,()=>forms.definitionVersion(today(),def));};refresh();subscriptions.set(host,actions.store.subscribe(refresh));
  el('p',body,'Подтверждённые результаты сохраняют свой состав. После правки форма показывает дату начала новой версии.','lp-muted');
 }else if(section==='Оформление'){
  if(actions.headers)subscriptions.set(host,renderHeaderCollection(el('div',body),actions.headers));
  toggle('Обложки и стили заметок',s.decoration.enabled,(s,v)=>{s.decoration.enabled=v;});
  el('p',body,'Все встроенные шапки статичные. Выбор отдельных заметок сохраняется.','lp-muted');
  const kind=select(body,'Оформление периода',PERIOD_TYPES.map(id=>({id,title:PERIOD_TITLES[id]})),selectedType);kind.addEventListener('change',()=>renderSettingsPanel(host,actions,section,kind.value as PeriodType));
  const mode=select(body,'Выбор шапки',[{id:'auto',title:'Автоматически по дате'},{id:'fixed',title:'Одна шапка для периода'}],s.decoration.modes?.[selectedType]??'auto');mode.addEventListener('change',()=>update(s=>{s.decoration.modes={...s.decoration.modes,[selectedType]:mode.value as 'auto'|'fixed'};}));
  const cover=select(body,'Стиль заметок этого периода',availablePresets(s.decoration.collection,s.decoration.covers),s.decoration.defaults[selectedType].preset);cover.addEventListener('change',()=>update(s=>{s.decoration.defaults[selectedType].preset=cover.value as NoteStyle['preset'];s.decoration.defaults[selectedType].bannerPath='';}));
  const font=select(body,'Шрифт этого периода',FONT_OPTIONS,s.decoration.defaults[selectedType].font);font.addEventListener('change',()=>update(s=>{s.decoration.defaults[selectedType].font=font.value as NoteStyle['font'];}));
  const custom=field(body,'Свой шрифт на устройстве для этого периода',s.decoration.defaults[selectedType].customFont);custom.addEventListener('change',()=>{if(custom.value.length>80||!/^[\p{L}\p{N} _-]*$/u.test(custom.value)){error.textContent='Укажите название шрифта.';return;}update(s=>{s.decoration.defaults[selectedType].customFont=custom.value.trim();});});
  el('small',body,'«Сменить тему» выбирает локацию и шрифт случайно. Автоматическая локация зависит от даты и типа открытого периода. Сезон — от начала периода, время суток — от местных часов устройства. Фиксированная шапка сохраняется отдельно; ручной выбор заметки имеет приоритет. Свой шрифт должен быть установлен на каждом устройстве.');
  el('h4',body,'Свои обложки');el('small',body,'Добавьте изображение в хранилище и укажите его путь. Оно появится в общей коллекции «Все темы».');
  for(const c of s.decoration.covers??[]){const row=el('div',body,undefined,'lp-setting-row');el('span',row,c.title+' · '+c.path);button(row,'Удалить из списка',()=>update(s=>{s.decoration.covers=s.decoration.covers?.filter(v=>v.id!==c.id);}));}
  const name=field(body,'Название обложки',''),path=field(body,'Путь к изображению в хранилище','');
  const season=select(body,'Сезон своей обложки',[{id:'any',title:'Любой сезон'},{id:'spring',title:'Весна'},{id:'summer',title:'Лето'},{id:'autumn',title:'Осень'},{id:'winter',title:'Зима'}],'any');
  const daypart=select(body,'Время суток своей обложки',[{id:'any',title:'Любое время'},{id:'morning',title:'Утро'},{id:'day',title:'День'},{id:'evening',title:'Вечер'},{id:'night',title:'Ночь'}],'any');
  button(body,'Добавить обложку',()=>{if(!name.value.trim()||name.value.length>120||!localImagePath(path.value.trim())){error.textContent='Укажите название и путь к PNG, JPG или статичный WebP внутри хранилища.';return;}update(s=>{s.decoration.covers=[...(s.decoration.covers??[]),{id:crypto.randomUUID(),title:name.value.trim(),path:path.value.trim(),season:season.value as UserCover['season'],daypart:daypart.value as UserCover['daypart']}];});});
   const theme=select(body,'Стиль интерфейса',[{id:'concept',title:'Как в концепте'},{id:'obsidian',title:'Тема Obsidian'}],s.theme);theme.addEventListener('change',()=>update(s=>{s.theme=theme.value as PlannerSettings['theme'];}));
  number('Максимальная ширина заметки, px',s.width,720,2000,(s,v)=>{s.width=v;});
  const accent=field(body,'Акцент плагина',s.accent,'color');accent.addEventListener('change',()=>update(s=>{s.accent=accent.value;}));
  const bg=field(body,'Фон виджетов',s.background||'#ffffff','color');bg.addEventListener('change',()=>update(s=>{s.background=bg.value;}));
  button(body,'Использовать фон темы',()=>update(s=>{s.background='';}));
  button(body,'Сбросить оформление',()=>update(s=>{s.theme=defaultSettings().theme;s.accent=defaultSettings().accent;s.background='';s.width=1400;s.density='compact';s.decoration=defaultSettings().decoration;}));
 }else{
  el('p',body,'Сохраняет копию данных плагина в Planner/Exports внутри этого хранилища. Не отправляет данные в интернет','lp-muted');
  el('p',body,'Это копия данных плагина, а не полная резервная копия хранилища.','lp-muted');
  button(body,'Экспортировать данные',()=>run(actions.export));button(body,'Восстановить запись',()=>run(actions.recover));
  el('p',body,'Здесь можно экспортировать данные или восстановить предыдущую версию записи. Копии заметок перед сменой компоновки доступны в Planner/Data/note-backups. Подключение событий и задач находится в разделе «Связь с облаком».','lp-muted');
 }
}
