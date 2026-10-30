import ICAL from 'ical.js';
import type {CalendarEvent} from '../model';
import {validateEvent} from '../recurrence';
import {assertLocalDate,addDays} from '../periods';
import {wallInstant,zonedStamp} from '../event-time';
export class UnsupportedCalendarEvent extends Error {}
function parsed(raw:string){if(raw.length>1_000_000)throw new Error('Событие слишком велико.');const cal=new ICAL.Component(ICAL.parse(raw) as unknown[]);if(cal.name!=='vcalendar')throw new Error('Неверный формат события.');const events=cal.getAllSubcomponents('vevent');if(events.length!==1)throw new UnsupportedCalendarEvent('Серии с исключениями пока не подключаются.');const event=events[0];if(['rrule','rdate','exdate','recurrence-id','organizer','attendee'].some(p=>event.hasProperty(p)))throw new UnsupportedCalendarEvent('Повторы и встречи с участниками пока не подключаются.');return{cal,event};}
function time(prop:ICAL.Property|null,zone:string){if(!prop)throw new Error('Нет даты события.');const t=prop.getFirstValue() as ICAL.Time;const tz=prop.getParameter('tzid');const v=t.toString();if(t.isDate){assertLocalDate(v);return{value:v,allDay:true,zone};}if(tz&&typeof tz==='string'){try{new Intl.DateTimeFormat('en',{timeZone:tz});}catch{throw new UnsupportedCalendarEvent('Неподдерживаемый часовой пояс.');}return{value:v.replace(/Z$/,''),allDay:false,zone:tz};}if(v.endsWith('Z'))return{value:v.slice(0,-1),allDay:false,zone:'UTC'};return{value:v,allDay:false,zone};}
function durationInstant(stamp:string,zone:string){
 const instant=wallInstant(stamp,zone),target=Date.parse(stamp+'Z');
 if(zonedStamp(instant,zone)!==stamp)throw new UnsupportedCalendarEvent('Длительность попадает в отсутствующее местное время при смене часового пояса.');
 for(const delta of [-86400000,86400000]){const probe=instant+delta,offset=Date.parse(zonedStamp(probe,zone)+'Z')-probe,candidate=target-offset;
  if(candidate!==instant&&zonedStamp(candidate,zone)===stamp)throw new UnsupportedCalendarEvent('Длительность начинается или заканчивается в неоднозначном повторяющемся часе. Ресурс сохранён на сервере.');
 }
 return instant;
}
function durationEnd(start:ReturnType<typeof time>,duration:ICAL.Duration){
 const parts=[duration.weeks,duration.days,duration.hours,duration.minutes,duration.seconds];
 if(duration.isNegative||parts.some(n=>!Number.isSafeInteger(n)||n<0)||parts.every(n=>n===0))throw new UnsupportedCalendarEvent('Нулевая или отрицательная длительность не представима в текущей модели. Ресурс сохранён на сервере.');
 const days=duration.weeks*7+duration.days,seconds=duration.hours*3600+duration.minutes*60+duration.seconds;
 if(!Number.isSafeInteger(days)||!Number.isSafeInteger(seconds))throw new UnsupportedCalendarEvent('Длительность выходит за поддерживаемый диапазон.');
 // RFC 5545: nominal calendar days first, then exact hours/minutes/seconds.
 const date=addDays(start.value.slice(0,10),days);assertLocalDate(date);
 if(start.allDay){if(seconds)throw new UnsupportedCalendarEvent('Событие на весь день требует длительности в днях или неделях.');return{...start,value:date};}
 if(days)durationInstant(start.value,start.zone);
 const nominal=date+start.value.slice(10),instant=durationInstant(nominal,start.zone);
 const endInstant=instant+seconds*1000,value=zonedStamp(endInstant,start.zone);
 // The model has no UTC-offset/fold field. Do not invent an instant in a repeated hour.
 if(wallInstant(value,start.zone)!==endInstant||value<=start.value)throw new UnsupportedCalendarEvent('Длительность в повторяющемся часе не представима однозначно. Ресурс сохранён на сервере.');
 return{...start,value};
}
export function readEvent(raw:string,areaId:string,defaultZone='Europe/Moscow'){
 const{event}=parsed(raw),uid=String(event.getFirstPropertyValue('uid')??'');if(!uid||uid.length>1000)throw new Error('Нет корректного UID события.');
 const start=time(event.getFirstProperty('dtstart'),defaultZone),endProperty=event.getFirstProperty('dtend'),duration=event.getFirstPropertyValue('duration') as ICAL.Duration|null;
 if(endProperty&&duration)throw new UnsupportedCalendarEvent('Событие одновременно содержит DTEND и DURATION.');
 let end:ReturnType<typeof time>|null;
 try{end=endProperty?time(endProperty,defaultZone):duration?durationEnd(start,duration):start.allDay?{...start,value:addDays(start.value,1)}:null;}catch(e){if(e instanceof UnsupportedCalendarEvent)throw e;throw new UnsupportedCalendarEvent('Конец события выходит за поддерживаемый диапазон дат. Ресурс сохранён на сервере.');}
 if(!end)throw new UnsupportedCalendarEvent('Событие без конца имеет нулевую длительность и не представимо в текущей модели. Ресурс сохранён на сервере.');
 if(start.allDay!==end.allDay||start.zone!==end.zone)throw new UnsupportedCalendarEvent('Разные форматы начала и конца.');
 const result:CalendarEvent={schemaVersion:1,id:'temporary',version:0,updatedAt:new Date().toISOString(),kind:'event',title:String(event.getFirstPropertyValue('summary')||'Без названия'),start:start.value,end:end.value,allDay:start.allDay,timezone:start.zone,areaId};validateEvent(result);return{uid,event:result};
}
function setTime(event:ICAL.Component,name:string,value:string,allDay:boolean,zone:string){event.removeAllProperties(name);const p=new ICAL.Property(name,event);const t=ICAL.Time.fromString(value.length===16?value+':00':value,p);if(!allDay){if(zone==='UTC')t.zone=ICAL.Timezone.utcTimezone;else p.setParameter('tzid',zone);}p.setValue(t);event.addProperty(p);}
/** Edit only supported fields; retain description, location, alarms and unknown properties. */
export function writeEvent(local:CalendarEvent,uid:string,raw?:string){
 validateEvent(local);if(local.recurrence||local.exceptions)throw new UnsupportedCalendarEvent('Повторяющееся событие пока остаётся только в плагине.');
 const{cal,event}=raw?parsed(raw):(()=>{const cal=new ICAL.Component('vcalendar'),event=new ICAL.Component('vevent');cal.addSubcomponent(event);cal.updatePropertyWithValue('version','2.0');cal.updatePropertyWithValue('prodid','-//Life Planner//CalDAV//RU');return{cal,event};})();
 if(raw&&String(event.getFirstPropertyValue('uid'))!==uid)throw new Error('UID события изменился.');
 event.updatePropertyWithValue('uid',uid);event.updatePropertyWithValue('summary',local.title);setTime(event,'dtstart',local.start,local.allDay,local.timezone);event.removeAllProperties('duration');setTime(event,'dtend',local.end,local.allDay,local.timezone);event.updatePropertyWithValue('dtstamp',ICAL.Time.fromJSDate(new Date(),true));event.updatePropertyWithValue('sequence',Number(event.getFirstPropertyValue('sequence')??0)+1);return cal.toString();
}
export function eventFingerprint(e:CalendarEvent){const stamp=(v:string)=>e.allDay?v:new Date(v+'Z').toISOString();return JSON.stringify([e.title,stamp(e.start),stamp(e.end),e.allDay,e.timezone,!!e.deleted,e.recurrence??null,e.exceptions??null]);}
