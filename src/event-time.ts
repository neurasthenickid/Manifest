/** Translate a wall clock value without altering the persisted event's timezone. */
export function zonedStamp(instant:number,zone:string){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(instant);
 const p=Object.fromEntries(parts.map(v=>[v.type,v.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
export function wallInstant(stamp:string,zone:string){
 const target=Date.parse((stamp.length===16?stamp+':00':stamp)+'Z');let instant=target;
 for(let i=0;i<4;i++){const offset=Date.parse(zonedStamp(instant,zone)+'Z')-instant,next=target-offset;if(next===instant)return instant;instant=next;}
 return instant;
}
export function projectEventTime<T extends {start:string;end:string;allDay:boolean;timezone:string}>(fields:T,zone='Europe/Moscow'):T{
 if(fields.allDay||fields.timezone===zone)return fields;
 return {...fields,start:zonedStamp(wallInstant(fields.start,fields.timezone),zone),end:zonedStamp(wallInstant(fields.end,fields.timezone),zone),timezone:zone};
}
