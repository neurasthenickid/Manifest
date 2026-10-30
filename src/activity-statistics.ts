import type {Checkin,Definition,Period,PlannerRecord} from './model';
import {definitionAt} from './domain';
import {addDays,assertLocalDate,dates,period,weekday} from './periods';

export type ActivityKind='workout'|'morning'|'evening';
export type ActivityDayState='full'|'partial'|'zero'|'missing'|'future';
export interface ActivityItemTotal {id:string;title:string;done:number;total:number}
export interface ActivityTotal {done:number;total:number;percent:number|null;sessions:number;filledDays:number;missingDays:number;applicableDays:number;items:ActivityItemTotal[];entries:Checkin[]}
export interface ActivityGroup {id:string;kind:ActivityKind;title:string;definition?:Definition;entries:Checkin[];drafts:Checkin[]}

/** Highest record version wins. IDs are never reconstructed from names or list positions. */
export function activityGroups(selected:Period,source:readonly PlannerRecord[],kinds:readonly ActivityKind[],asOf:string):ActivityGroup[]{
 assertLocalDate(asOf);const unique=new Map<string,PlannerRecord>();
 for(const record of source)if(!unique.has(record.id)||unique.get(record.id)!.version<record.version)unique.set(record.id,record);
 const records=[...unique.values()],definitions=records.filter((r):r is Definition=>r.kind==='definition'&&kinds.includes(r.type as ActivityKind));
 const checks=records.filter((r):r is Checkin=>r.kind==='checkin'&&kinds.includes(r.definitionType as ActivityKind));
 const keys=new Map<string,{id:string;kind:ActivityKind;definition?:Definition}>();
 for(const definition of definitions)if(definition.versions.some(v=>v.effectiveDate<selected.end))keys.set(definition.type+':'+definition.id,{id:definition.id,kind:definition.type as ActivityKind,definition});
 for(const entry of checks)if(entry.date>=selected.start&&entry.date<selected.end){const key=entry.definitionType+':'+entry.definitionId;if(!keys.has(key))keys.set(key,{id:entry.definitionId,kind:entry.definitionType as ActivityKind});}
 return [...keys.values()].map(key=>{
  const own=checks.filter(c=>c.definitionId===key.id&&c.definitionType===key.kind).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  const cutoff=selected.end<=asOf?addDays(selected.end,-1):asOf>=selected.start?asOf:selected.start;
  const version=key.definition&&definitionAt(key.definition,cutoff),last=own.filter(c=>c.date<=cutoff).at(-1);
  return{...key,title:version?.title??last?.title??key.definition?.versions[0].title??own[0]?.title??'Сохранённая программа',entries:own.filter(c=>c.finalized),drafts:own.filter(c=>!c.finalized)};
 });
}

/** All denominators come from confirmed snapshots, not the currently edited definition. */
export function activityTotal(group:ActivityGroup,range:Pick<Period,'start'|'end'>,asOf:string):ActivityTotal{
 assertLocalDate(asOf);const end=range.end<addDays(asOf,1)?range.end:addDays(asOf,1);
 const entries=group.entries.filter(c=>c.date>=range.start&&c.date<end),items=new Map<string,ActivityItemTotal>();let done=0,total=0;
 for(const entry of entries)for(const item of entry.items){const row=items.get(item.id)??{id:item.id,title:item.title,done:0,total:0};row.title=item.title;row.total++;total++;if(entry.states[item.id]===true){row.done++;done++;}items.set(item.id,row);}
 const recorded=new Set(entries.map(e=>e.date));let applicableDays=0,missingDays=0;
 if(group.kind!=='workout'&&end>range.start)for(const date of dates(range.start,end)){
  const version=group.definition&&definitionAt(group.definition,date),saved=recorded.has(date)||group.drafts.some(e=>e.date===date&&e.items.length>0);
  if(saved||version?.items.length&&version.weekdays.includes(weekday(date))){applicableDays++;if(!recorded.has(date))missingDays++;}
 }
 return{done,total,percent:total?100*done/total:null,sessions:entries.length,filledDays:recorded.size,missingDays,applicableDays,items:[...items.values()],entries};
}
export function activityDay(group:ActivityGroup,date:string,asOf:string):{state:ActivityDayState;total:ActivityTotal}{
 const total=activityTotal(group,{start:date,end:addDays(date,1)},asOf);
 return{state:date>asOf?'future':!total.sessions?'missing':!total.done?'zero':total.done===total.total?'full':'partial',total};
}
export interface ActivitySelection {day?:string;month?:string;itemsOpen:boolean;journalOpen:boolean;sessionOpen:Set<string>}
/** Local widget state only; statistics browsing never writes data or settings. */
export class ActivitySelections {
 private values=new Map<string,ActivitySelection>();
 get(group:Pick<ActivityGroup,'kind'|'id'>){const key=group.kind+':'+group.id;let state=this.values.get(key);if(!state){state={itemsOpen:false,journalOpen:false,sessionOpen:new Set()};this.values.set(key,state);}return state;}
 day(group:ActivityGroup,selected:Period,date:string){assertLocalDate(date);if(date<selected.start||date>=selected.end)return false;const s=this.get(group);s.day=date;if(selected.type==='year')s.month=period('month',date).start;return true;}
 month(group:ActivityGroup,selected:Period,date:string){assertLocalDate(date);const month=period('month',date);if(selected.type!=='year'||month.start<selected.start||month.end>selected.end)return false;const s=this.get(group);s.month=month.start;s.day=undefined;return true;}
 reset(group:ActivityGroup,monthOnly=false){const s=this.get(group);s.day=undefined;if(!monthOnly)s.month=undefined;}
 range(group:ActivityGroup,selected:Period){const s=this.get(group);return s.day?period('day',s.day):s.month?period('month',s.month):selected;}
}
