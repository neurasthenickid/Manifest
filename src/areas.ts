import {object} from './json';
import {AREAS,type LifeArea} from './model';
export const AREA_ICONS=[{id:'heart',title:'Сердце'},{id:'house',title:'Дом'},{id:'briefcase-business',title:'Работа'},{id:'book-open',title:'Книга'},{id:'user-round',title:'Человек'},{id:'star',title:'Звезда'},{id:'leaf',title:'Лист'},{id:'sun',title:'Солнце'},{id:'globe',title:'Мир'},{id:'music',title:'Музыка'},{id:'bike',title:'Спорт'},{id:'wallet',title:'Финансы'},{id:'coffee',title:'Отдых'},{id:'palette',title:'Творчество'},{id:'circle',title:'Круг'}] as const;
export const validAreaId=(value:unknown):value is string=>typeof value==='string'&&value!=='all'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/.test(value);
export const defaultAreas=():LifeArea[]=>AREAS.map(a=>({...a,enabled:true,titleHistory:[]}));
/** The list lives in vault-local plugin settings. An empty array is intentional. */
export function normalizeAreas(value:unknown):LifeArea[]{
 if(!Array.isArray(value))return defaultAreas();
 const result:LifeArea[]=[];
 for(const raw of value){const a=object(raw);if(!a||!validAreaId(a.id)||result.some(r=>r.id===a.id)||typeof a.title!=='string'||!a.title.trim()||a.title.trim().length>120)continue;
  result.push({id:a.id,title:a.title.trim(),color:typeof a.color==='string'&&/^#[0-9a-f]{6}$/i.test(a.color)?a.color:'#8873bf',icon:AREA_ICONS.find(i=>i.id===a.icon)?.id??'circle',enabled:a.enabled!==false,titleHistory:Array.isArray(a.titleHistory)?a.titleHistory.map(object).flatMap(h=>typeof h.title==='string'&&h.title.length<=120&&typeof h.at==='string'?[{title:h.title,at:h.at}]:[]):[]});
 }return result;
}
export const enabledAreas=(areas:readonly LifeArea[])=>areas.filter(a=>a.enabled);
export function areaById(areas:readonly LifeArea[],id:string):LifeArea{return areas.find(a=>a.id===id)??{id,title:id===''?'Без сферы':AREAS.find(a=>a.id===id)?.title??id,color:id===''?'#8a929d':'#8873bf',icon:'circle',enabled:false,titleHistory:[]};}
/** Include a disabled/unknown selection only when editing that existing record. */
export function areaOptions(areas:readonly LifeArea[],existing?:string){const options=enabledAreas(areas).map(a=>({...a}));if(existing&&!options.some(a=>a.id===existing)){const a=areaById(areas,existing);options.push({...a,title:a.title+' · выключена'});}return options;}
export function assertAreaSelection(areas:readonly LifeArea[],chosen:string,existing?:string){if(chosen&&chosen===existing)return;if(!areas.some(a=>a.id===chosen&&a.enabled))throw new Error('Выберите включённую сферу. Выключенную сферу можно сохранить у существующей записи.');}
export function renameArea(area:LifeArea,title:string):LifeArea{const value=title.trim();if(!value||value.length>120)throw new Error('Название сферы: от1до120символов.');return value===area.title?area:{...area,title:value,titleHistory:[...(area.titleHistory??[]),{title:area.title,at:new Date().toISOString()}]};}
export const areaNoteFile=(area:LifeArea)=>(AREAS.find(a=>a.id===area.id)?.title??area.id)+'.md';
export const areaStatisticsView=(count:number)=>count>=3&&count<=8?'wheel':'bars';
