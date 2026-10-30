import {rankedHeaderScenes} from './header-selection';
import type {PeriodType,Period} from './model';
import {GENERATED_PRESETS} from './generated-styles';
import {HEADER_PREVIEW} from './header-preview';
import {HEADER_SCENES} from './header-catalog';
import {headerClock,seasonForMonth,type Season,type Daypart} from './header-clock';
export const STRICT_STYLE_PRESETS=[{id:'plain',title:'Спокойный',accent:'',file:''}] as const;
export const STYLE_PRESETS=[...STRICT_STYLE_PRESETS,...GENERATED_PRESETS,HEADER_PREVIEW,...HEADER_SCENES] as const;
export type StylePreset=typeof STYLE_PRESETS[number]['id']|`user:${string}`;
export interface UserCover {id:string;title:string;path:string;season:Season|'any';daypart:Daypart|'any'}
export const FONT_OPTIONS=[{id:'manrope',title:'Manrope · современный'},{id:'literata',title:'Literata · книжный'},{id:'jetbrains',title:'JetBrains Mono · моноширинный'},{id:'system',title:'Системный'},{id:'serif',title:'Системный с засечками'},{id:'mono',title:'Системный моноширинный'},{id:'obsidian',title:'Из темы Obsidian'}] as const;
export interface NoteStyle {headerMode?:'auto';preset:StylePreset;font:typeof FONT_OPTIONS[number]['id'];customFont:string;bannerPath:string;motion:boolean;preview?:{season:Season;daypart:Daypart}}
export const HEADER_SEASONS=[{id:'winter',title:'Зима'},{id:'spring',title:'Весна'},{id:'summer',title:'Лето'},{id:'autumn',title:'Осень'}] as const;
export const HEADER_DAYPARTS=[{id:'morning',title:'Утро'},{id:'day',title:'День'},{id:'evening',title:'Вечер'},{id:'night',title:'Ночь'}] as const;
/** Legacy preview payloads are ignored: season follows period, time stays local. */
export const styleClock=(_style:NoteStyle,date=new Date(),p?:Pick<Period,'start'>)=>headerClock(date,p?seasonForMonth(Number(p.start.slice(5,7))):undefined);
export type HeaderMode='auto'|'fixed';
export interface DecorationSettings {modes?:Partial<Record<PeriodType,HeaderMode>>;enabled:boolean;motion:boolean;collection:'all'|'strict';covers?:UserCover[];defaults:Record<PeriodType,NoteStyle>;notes:Record<string,NoteStyle>}
export const plainStyle=():NoteStyle=>({preset:'plain',font:'system',customFont:'',bannerPath:'',motion:true});
export const periodStyle=(type:PeriodType):NoteStyle=>({...plainStyle(),preset:({day:'scene-petersburg',week:'scene-novgorod',month:'scene-moscow',quarter:'scene-baikal',year:'scene-altai'} as const)[type],font:type==='week'||type==='year'?'literata':'manrope'});
export const periodAccent=(type:PeriodType)=>({day:'#9eceff',week:'#9effce',month:'#ffad9e',quarter:'#c4b0ef',year:'#b3c6e6'} as const)[type];
export const styleKey=(p:Period)=>p.type+':'+p.start;
const PLACE_PREFIXES:readonly [string,string][]=[['petersburg','Санкт-Петербург'],['moscow','Москва'],['novgorod','Великий Новгород'],['yaroslavl','Ярославль'],['nizhny','Нижний Новгород'],['khabarovsk','Хабаровск'],['kazan','Казань'],['ufa','Уфа'],['vladivostok','Владивосток'],['kaliningrad','Калининград'],['taiga','Сибирская тайга'],['altai','Алтай'],['baikal','Байкал'],['arctic','Северный полюс'],['antarctic','Южный полюс'],['ruskeala','Рускеала, Карелия'],['rgup','Северо-Западный филиал РГУП, Санкт-Петербург'],['msal','МГЮА, Москва']];
export function styleCaption(preset:StylePreset){const scene=HEADER_SCENES.find(p=>p.id===preset);if(scene)return scene.title;if(preset==='headerPreview')return HEADER_PREVIEW.caption;if(preset.startsWith('novgorodMillennium'))return 'Великий Новгород · памятник «Тысячелетие России»';if(preset==='novgorodSquareWinter')return 'Великий Новгород · Софийская площадь';if(preset.startsWith('novgorodVolkhov'))return 'Великий Новгород · Кремль с Волхова';if(preset.startsWith('novgorodNevsky'))return 'Великий Новгород · памятник Александру Невскому';return PLACE_PREFIXES.find(([prefix])=>preset.startsWith(prefix))?.[1]??'Вымышленные миры';}
export function availablePresets(collection:DecorationSettings['collection'],covers:UserCover[]=[]){return [...HEADER_SCENES,...(collection==='all'?[...GENERATED_PRESETS.filter(p=>!PLACE_PREFIXES.some(([prefix])=>p.id.startsWith(prefix))),...covers.map(c=>({id:`user:${c.id}` as StylePreset,title:c.title,accent:'',file:c.path}))]:[])];}
export function styleAccent(preset:StylePreset){return STYLE_PRESETS.find(p=>p.id===preset)?.accent??'';}
export interface HeaderMedia {file:string;builtin:boolean}
export type MediaAvailable=(file:string,builtin:boolean)=>boolean;
const alwaysAvailable:MediaAvailable=()=>true;
export function randomStyle(current:NoteStyle,collection:DecorationSettings['collection'],random=Math.random,covers:UserCover[]=[],date=new Date(),p?:Period,available:MediaAvailable=alwaysAvailable):NoteStyle {
 const clock=styleClock(current,date,p);
 const presets=availablePresets(collection,covers).filter(preset=>HEADER_SCENES.some(s=>s.id===preset.id)||covers.some(c=>preset.id===`user:${c.id}`)).filter(preset=>{const c=covers.find(c=>preset.id===`user:${c.id}`);return !c||((c.season==='any'||c.season===clock.season)&&(c.daypart==='any'||c.daypart===clock.daypart));}).filter(preset=>!!styleMedia({...current,preset:preset.id,bannerPath:''},false,date,covers,p,available));
 // A different image takes priority over a different font for the same image.
 const currentFile=styleMedia(current,false,date,covers,p)?.file;
 const different=presets.filter(preset=>styleMedia({...current,preset:preset.id,bannerPath:''},false,date,covers,p)?.file!==currentFile);
 const pool=different.length?different:presets;
 const choice=pool[Math.max(0,Math.min(pool.length-1,Math.floor(random()*pool.length)))];if(!choice)return current;
 const fonts=FONT_OPTIONS.filter(f=>['manrope','literata','jetbrains'].includes(f.id));
 const font=fonts[Math.max(0,Math.min(fonts.length-1,Math.floor(random()*fonts.length)))].id;
 const next={...current,preset:choice.id,font,customFont:'',bannerPath:''};delete next.headerMode;return next;
}
// eslint-disable-next-line no-control-regex -- Reject control characters in untrusted vault media paths.
export function localImagePath(value:string):boolean{return !!value&&value.length<=500&&!/[:\\\u0000-\u001f]/.test(value)&&!value.startsWith('/')&&!value.split('/').some(part=>part==='..'||part==='.'||!part)&&/\.(png|jpe?g|webp|gif)$/i.test(value);}
// Replace withdrawn built-ins without losing the rest of a saved note's appearance.
const WITHDRAWN_PRESETS:Record<string,StylePreset>={city:'scene-petersburg',rooftops:'scene-novgorod',sunset:'scene-moscow',moon:'scene-baikal',mountain:'scene-altai',openForest:'scene-novgorod',openNeon:'scene-baikal',openJapan:'scene-altai'};
function migrateReal(preset:string):string{if(preset.startsWith('scene-')||!GENERATED_PRESETS.some(p=>p.id===preset))return preset;const specific=[['novgorodMillennium','novgorod-millennium'],['novgorodSquare','novgorod-square'],['novgorodNevsky','novgorod-nevsky'],['novgorodVolkhov','novgorod-volkhov']].find(([prefix])=>preset.startsWith(prefix));const id=specific?.[1]??PLACE_PREFIXES.find(([prefix])=>preset.startsWith(prefix))?.[0];return HEADER_SCENES.find(s=>s.sceneId===id)?.id??preset;}
export function normalizeStyle(input:unknown):NoteStyle {const s=(input&&typeof input==='object'?input:{}) as Partial<NoteStyle>,d=plainStyle();const preset=typeof s.preset==='string'?(Object.hasOwn(WITHDRAWN_PRESETS,s.preset)?WITHDRAWN_PRESETS[s.preset]:migrateReal(s.preset)):undefined;if(STYLE_PRESETS.some(p=>p.id===preset)||/^user:[a-z0-9-]{1,80}$/.test(preset??''))d.preset=preset as StylePreset;if(FONT_OPTIONS.some(p=>p.id===s.font))d.font=s.font!;if(typeof s.customFont==='string'&&s.customFont.length<=80&&/^[\p{L}\p{N} _-]*$/u.test(s.customFont))d.customFont=s.customFont.trim();if(typeof s.bannerPath==='string'&&localImagePath(s.bannerPath.trim()))d.bannerPath=s.bannerPath.trim();if(typeof s.motion==='boolean')d.motion=s.motion;if(s.headerMode==='auto'||d.preset==='plain'&&!d.bannerPath)d.headerMode='auto';return d;}
/** Legacy note entries are explicit image choices. Only the new flag releases
 * their header while retaining the independently chosen font and preview. */
export function resetAutomaticHeader(settings:DecorationSettings,p:Period):void {
 const saved=settings.notes[styleKey(p)];
 if(saved)settings.notes[styleKey(p)]={...saved,headerMode:'auto',bannerPath:''};
}
export function resolveNoteAppearance(settings:DecorationSettings,p:Period,date=new Date(),available:MediaAvailable=alwaysAvailable):{style:NoteStyle;media:HeaderMedia|undefined}{
 if(!settings.enabled)return{style:plainStyle(),media:undefined};
 const saved=settings.notes[styleKey(p)],base=saved??settings.defaults[p.type];
 const manual=!!saved&&saved.headerMode!=='auto'&&(saved.preset!=='plain'||!!saved.bannerPath);
 let requested:NoteStyle|undefined;
 if(manual||settings.modes?.[p.type]==='fixed'&&(settings.defaults[p.type].preset!=='plain'||!!settings.defaults[p.type].bannerPath)){
  const style=manual?base:{...base,preset:settings.defaults[p.type].preset,bannerPath:settings.defaults[p.type].bannerPath};
  const media=styleMedia(style,false,date,settings.covers,p,available);
  if(media||style.bannerPath||!HEADER_SCENES.some(s=>s.id===style.preset))return{style,media};
  // A missing built-in variant may use a compatible scene temporarily. The
  // user's requested preset remains saved and returns when media is available.
  requested=style;
 }
 // Older fictional presets lack semantic season metadata and remain available
 // for explicit selection only. Auto uses the approved scene catalogue/covers.
 const choices=availablePresets(settings.collection,settings.covers).filter(v=>HEADER_SCENES.some(s=>s.id===v.id)||settings.covers?.some(c=>v.id===`user:${c.id}`));
 // Ranking has no clock component. Only media compatibility/availability can
 // require the next ranked scene when a collection is incomplete.
 for(const id of rankedHeaderScenes(p,choices.map(v=>v.id))){
  const style={...(requested??base),preset:id as StylePreset,bannerPath:''};
  const cover=settings.covers?.find(c=>id===`user:${c.id}`),clock=styleClock(style,date,p);if(cover&&((cover.season!=='any'&&cover.season!==clock.season)||(cover.daypart!=='any'&&cover.daypart!==clock.daypart)))continue;
  const media=styleMedia(style,false,date,settings.covers,p,available);if(media)return{style,media};
 }
 return{style:requested??{...base,preset:'plain',bannerPath:''},media:undefined};
}
export function noteStyle(settings:DecorationSettings,p:Period,date=new Date()):NoteStyle{return resolveNoteAppearance(settings,p,date).style;}
export function styleFont(s:NoteStyle){const fallback={manrope:'"LP Manrope", system-ui, sans-serif',literata:'"LP Literata", Georgia, serif',jetbrains:'"LP JetBrains Mono", ui-monospace, monospace',system:'system-ui, sans-serif',serif:'Georgia, "Times New Roman", serif',mono:'ui-monospace, Consolas, monospace',obsidian:'var(--font-text, system-ui)'}[s.font];return s.customFont?`"${s.customFont}", ${fallback}`:fallback;}
/** Fallback within a scene: exact season/time, then neutral season/time.
 * Never borrow a different season or time of day. Auto selection then tries
 * the next ranked compatible scene. Missing media yields no broken image. */
export function styleMedia(s:NoteStyle,_motion:boolean,date=new Date(),covers:UserCover[]=[],p?:Period,available:MediaAvailable=alwaysAvailable):HeaderMedia|undefined {
 const preset=STYLE_PRESETS.find(v=>v.id===s.preset),scene=HEADER_SCENES.find(v=>v.id===s.preset),clock=styleClock(s,date,p);
 const cover=covers.find(c=>`user:${c.id}`===s.preset),custom=cover?.path??s.bannerPath;
 if(custom)return /\.gif$/i.test(custom)||!available(custom,false)?undefined:{file:custom,builtin:false};
 if(scene){
  const variants=scene.variants.filter(v=>(v.season===null||v.season===clock.season)&&v.daypart===clock.daypart)
   .sort((a,b)=>Number(a.season===null)-Number(b.season===null)||(a.file<b.file?-1:a.file>b.file?1:0));
  const variant=variants.find(v=>available(v.file,true));return variant?{file:variant.file,builtin:true}:undefined;
 }
 if(!preset?.file)return undefined;
 const file=preset.file.replace(/\.(gif|jpg)$/,'-still.webp');return available(file,true)?{file,builtin:true}:undefined;
}
