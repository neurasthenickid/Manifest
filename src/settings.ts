import {object} from './json';
import {cloudDefaults,normalizeCloud,type CloudSettings} from './integrations/cloud-settings';
import { canonicalLayout, periodModules, type WidgetModule } from './ui/modules';
import type { PeriodType,DefinitionType } from './model';
import {plainStyle,periodStyle,normalizeStyle,localImagePath,STYLE_PRESETS,type DecorationSettings} from './appearance';
import {connectionDefaults,type CalendarConnectionSettings} from './integrations/connection';
import {defaultAreas,normalizeAreas,validAreaId} from './areas';
import type {LifeArea} from './model';
import {taskConnectionDefaults,normalizeTaskConnection,type TaskConnectionSettings} from './integrations/task-connection';
export const PERIOD_TYPES:PeriodType[]=['day','week','month','quarter','year'];
export const PERIOD_TITLES:Record<PeriodType,string>={day:'День',week:'Неделя',month:'Месяц',quarter:'Квартал',year:'Год'};
export interface PlannerSettings {
 schemaVersion:1; accent:string;background:string;width:number;density:'compact'|'comfortable';theme:'concept'|'obsidian';
 decoration:DecorationSettings;
 areas:LifeArea[];
 mobileHeaderFocus?:Record<string,number>;
 definitionOrder?:Partial<Record<DefinitionType,string[]>>;
 calendarConnection:CalendarConnectionSettings;
  taskConnection:TaskConnectionSettings;
 cloudConnection:CloudSettings;calendarRangeVersion:2;
 dailyNotes?:'pending'|'enabled'|'disabled';
 calendar:{startHour:number;endHour:number;hourHeight:number};
 sidebar:{enabled:boolean;side:'left'|'right';follow:boolean};
 folders:Record<PeriodType,string>;layouts:Record<PeriodType,WidgetModule[]>;
}
export function defaultSettings():PlannerSettings{return{schemaVersion:1,dailyNotes:'pending',calendarRangeVersion:2,cloudConnection:cloudDefaults(),areas:defaultAreas(),theme:'concept',calendarConnection:connectionDefaults(),taskConnection:taskConnectionDefaults(),decoration:{modes:{day:'auto',week:'auto',month:'auto',quarter:'auto',year:'auto'},enabled:true,motion:true,collection:'all',defaults:Object.fromEntries(PERIOD_TYPES.map(type=>[type,periodStyle(type)])) as Record<PeriodType,ReturnType<typeof plainStyle>>,notes:{}},accent:'#ad98e6',background:'',width:1400,density:'compact',calendar:{startHour:6,endHour:24,hourHeight:40},sidebar:{enabled:true,side:'left',follow:true},folders:{day:'01 День',week:'02 Неделя',month:'03 Месяц',quarter:'04 Квартал',year:'05 Год'},layouts:Object.fromEntries(PERIOD_TYPES.map(type=>[type,periodModules(type)])) as Record<PeriodType,WidgetModule[]>};}
/** Repairs unknown/older plugin settings, never vault records. */
export function normalizeSettings(input:unknown):PlannerSettings {
 const d=defaultSettings(),s=object(input);
 d.dailyNotes=s.dailyNotes==='enabled'||s.dailyNotes==='disabled'?s.dailyNotes:'pending';
 d.areas=normalizeAreas(s.areas);d.taskConnection=normalizeTaskConnection(s.taskConnection);
 d.mobileHeaderFocus={};if(s.mobileHeaderFocus&&typeof s.mobileHeaderFocus==='object')for(const [id,value]of Object.entries(s.mobileHeaderFocus))if((STYLE_PRESETS.some(p=>p.id===id)||/^(scene-|user:)[a-z0-9-]{1,80}$/.test(id))&&typeof value==='number'&&Number.isFinite(value))d.mobileHeaderFocus[id]=Math.max(0,Math.min(100,value));
 const definitionOrder=object(s.definitionOrder);d.definitionOrder={};for(const type of ['habit','morning','evening','workout'] as const){const order=definitionOrder[type];if(Array.isArray(order))d.definitionOrder[type]=[...new Set(order.filter((id:unknown):id is string=>typeof id==='string'&&/^[\w.:-]{1,128}$/.test(id)).slice(0,2000))];}
 const c=object(s.calendarConnection);if(c&&typeof c==='object'){const v=d.calendarConnection;if(typeof c.username==='string'&&c.username.length<320)v.username=c.username.trim();if(typeof c.calendarUrl==='string'&&/^https:\/\/caldav\.yandex\.ru\//.test(c.calendarUrl)&&!/[?#]/.test(c.calendarUrl))v.calendarUrl=c.calendarUrl;if(validAreaId(c.areaId))v.areaId=c.areaId;if(c.mode==='both')v.mode='both';if(typeof c.auto==='boolean')v.auto=c.auto;if(typeof c.secretId==='string'&&/^life-planner-yandex-[a-f0-9]{32}$/.test(c.secretId))v.secretId=c.secretId;}
 if(s.decoration&&typeof s.decoration==='object'){const a=object(s.decoration);if(typeof a.enabled==='boolean')d.decoration.enabled=a.enabled;if(typeof a.motion==='boolean')d.decoration.motion=a.motion;if(a.collection==='strict')d.decoration.collection='strict';for(const type of PERIOD_TYPES){const mode=object(a.modes)[type];d.decoration.modes![type]=mode==='fixed'?'fixed':'auto';}for(const type of PERIOD_TYPES)d.decoration.defaults[type]=object(a.defaults)[type]===undefined?periodStyle(type):normalizeStyle(object(a.defaults)[type]);for(const type of PERIOD_TYPES)if(d.decoration.defaults[type].preset==='plain'&&!d.decoration.defaults[type].bannerPath){d.decoration.defaults[type].preset=periodStyle(type).preset;d.decoration.modes![type]='auto';}for(const [key,value] of Object.entries(object(a.notes)))if(/^(day|week|month|quarter|year):\d{4}-\d{2}-\d{2}$/.test(key))d.decoration.notes[key]=normalizeStyle(value);
 d.decoration.covers=[];if(Array.isArray(a.covers))for(const value of a.covers.slice(0,200)){const c=object(value);if(!c||typeof c.id!=='string'||!/^[-a-z0-9]{1,80}$/.test(c.id)||d.decoration.covers.some(v=>v.id===c.id)||typeof c.title!=='string'||!c.title.trim()||c.title.length>120||typeof c.path!=='string'||!localImagePath(c.path))continue;d.decoration.covers.push({id:c.id,title:c.title.trim(),path:c.path,season:c.season==='spring'||c.season==='summer'||c.season==='autumn'||c.season==='winter'?c.season:'any',daypart:c.daypart==='morning'||c.daypart==='day'||c.daypart==='evening'||c.daypart==='night'?c.daypart:'any'});}}
 d.theme=s.theme==='obsidian'?'obsidian':'concept';
 const number=(v:unknown,min:number,max:number,fallback:number)=>typeof v==='number'&&Number.isFinite(v)?Math.min(max,Math.max(min,Math.round(v))):fallback;
 if(typeof s.accent==='string'&&/^#[0-9a-f]{6}$/i.test(s.accent))d.accent=s.accent;
 if(typeof s.background==='string'&&(s.background===''||/^#[0-9a-f]{6}$/i.test(s.background)))d.background=s.background;
 d.width=number(s.width,720,2000,d.width);d.density=s.density==='comfortable'?'comfortable':'compact';
 d.cloudConnection=normalizeCloud(s.cloudConnection);
 d.calendar.startHour=number(object(s.calendar).startHour,0,23,d.calendar.startHour);
 d.calendar.endHour=number(object(s.calendar).endHour,d.calendar.startHour+1,24,Math.max(d.calendar.startHour+1,d.calendar.endHour));
 if(s.calendarRangeVersion!==2&&object(s.calendar).startHour===6&&object(s.calendar).endHour===23&&object(s.calendar).hourHeight===40)d.calendar.endHour=24;
 d.calendar.hourHeight=number(object(s.calendar).hourHeight,24,72,d.calendar.hourHeight);
 const sidebar=object(s.sidebar);if(typeof sidebar.enabled==='boolean')d.sidebar.enabled=sidebar.enabled;
 if(typeof sidebar.follow==='boolean')d.sidebar.follow=sidebar.follow;
 d.sidebar.side=object(s.sidebar).side==='right'?'right':'left';
 for(const type of PERIOD_TYPES){
  const f=object(s.folders)[type];if(typeof f==='string'&&f.trim()&&!/[\\/:*?"<>|]/.test(f)&&f!=='.'&&f!=='..'&&!/[. ]$/.test(f))d.folders[type]=f;
  const choices=periodModules(type),layout=object(s.layouts)[type];if(Array.isArray(layout)){d.layouts[type]=[...new Set(canonicalLayout(layout.filter((m:unknown)=>m==='plans'||choices.includes(m as WidgetModule)) as WidgetModule[]))] as WidgetModule[];}
 }
 if(new Set(Object.values(d.folders).map(f=>f.toLocaleLowerCase())).size!==5)d.folders=defaultSettings().folders;
 return d;
}
