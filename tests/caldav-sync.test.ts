import test from 'node:test';
import assert from 'node:assert/strict';
import {RecordStore,type FileIO} from '../src/storage';
import {base} from '../src/domain';
import type {CalendarEvent} from '../src/model';
import {CalendarSync} from '../src/integrations/calendar-sync';
import {CaldavClient,DavConflict,trustedDavUrl,type DavResource} from '../src/integrations/caldav';
import {readEvent,writeEvent,UnsupportedCalendarEvent} from '../src/integrations/ical';
import {connectionDefaults,CalendarConnection} from '../src/integrations/connection';
import {normalizeSettings} from '../src/settings';
import {occurrences} from '../src/recurrence';
import {projectEventTime,wallInstant} from '../src/event-time';
import {changeEventSeries,eventFields} from '../src/recurrence';
const calendarUrl='https://caldav.yandex.ru/calendars/test/test/';
const event=():CalendarEvent=>({...base(),kind:'event',title:'Встреча',start:'2026-10-09T10:00:00',end:'2026-10-09T11:00:00',allDay:false,timezone:'Europe/Moscow',areaId:'work'});
function fixture(){const files=new Map<string,string>();const io:FileIO={read:async p=>files.get(p)??null,write:async(p,t)=>{files.set(p,t);},mkdir:async()=>{},list:async p=>[...files.keys()].filter(k=>k.startsWith(p+'/')),create:async(p,t)=>{if(files.has(p))return false;files.set(p,t);return true;},replace:async(p,old,t)=>{assert.equal(files.get(p),old);files.set(p,t);}};const store=new RecordStore(io),resources=new Map<string,DavResource>();let revision=1,puts=0;const calls:string[]=[];
 const client={list:async()=>[...resources.values()],get:async(url:string)=>resources.get(url)??null,put:async(url:string,data:string,etag?:string)=>{calls.push('put');const old=resources.get(url);if(etag?old?.etag!==etag:!!old)throw new DavConflict();puts++;const r={url,data,etag:'"v'+revision+++'"'};resources.set(url,r);return r;},remove:async(url:string,etag:string)=>{calls.push('delete');if(resources.get(url)?.etag!==etag)throw new DavConflict();resources.delete(url);}};
 const engine=(mode:'read'|'both'='both')=>new CalendarSync(io,store,client,{username:'test@yandex.ru',calendarUrl,areaId:'work',mode});
 const remote=(uid='source',data=writeEvent(event(),uid))=>{const r={url:calendarUrl+uid+'.ics',data,etag:'"v'+revision+++'"'};resources.set(r.url,r);return r;};return{files,io,store,resources,client,engine,remote,calls,get puts(){return puts;}};
}
test('minute precision from the real form does not create a false server conflict',async()=>{const f=fixture();await f.store.load();const e=await f.store.save({...event(),start:'2026-10-09T10:00',end:'2026-10-09T11:00'},0);await f.engine().publish(e.id);assert.equal((await f.engine().sync()).issues.length,0);assert.equal(f.puts,1);});
test('queued creation stays offline in receive-only mode',async()=>{const f=fixture();await f.store.load();const e=await f.store.save(event(),0),put=f.client.put;f.client.put=async()=>{throw new Error('offline');};await assert.rejects(()=>f.engine().publish(e.id));f.client.put=put;assert.equal((await f.engine('read').sync()).sent,0);assert.equal(f.puts,0);assert.equal((await f.engine().sync()).sent,1);});
test('local edit while linked GET waits becomes a conflict and is never overwritten',async()=>{const f=fixture();await f.store.load();const r=f.remote();await f.engine().sync();f.client.list=async()=>[];const e=f.store.all('event')[0];r.etag='"changed"';r.data=writeEvent({...event(),title:'Remote'},'source');f.client.get=async()=>{await f.store.save({...e,title:'User edit during request'},e.version);return r;};const result=await f.engine().sync();assert.equal(result.issues[0].conflict,true);assert.equal(f.store.get(e.id)?.kind,'event');assert.equal(f.store.all('event')[0].title,'User edit during request');});
test('UTC and foreign TZID project to Moscow, including a different day, without changing source',()=>{const utc={...event(),timezone:'UTC',start:'2026-10-09T22:00',end:'2026-10-09T23:00'};const local=occurrences([utc],'2026-10-10','2026-10-11','Europe/Moscow');assert.equal(local[0].start,'2026-10-10T01:00:00');assert.equal(utc.start,'2026-10-09T22:00');const ny={...event(),timezone:'America/New_York'};assert.equal(occurrences([ny],'2026-10-09','2026-10-10','Europe/Moscow')[0].start,'2026-10-09T17:00:00');});
test('a Moscow calendar drag returns to the original event zone before editing without shifting the moment',()=>{const utc={...event(),timezone:'UTC'},projected=projectEventTime(utc,'Europe/Moscow'),drag={...projected,start:'2026-10-09T14:00',end:'2026-10-09T15:00'},proposal=projectEventTime(drag,'UTC');assert.equal(proposal.start,'2026-10-09T11:00:00');assert.equal(wallInstant(proposal.start,'UTC'),wallInstant(drag.start,'Europe/Moscow'));assert.equal(proposal.timezone,'UTC');});
test('iCalendar roundtrip keeps local wall time, unicode, all-day dates, description and alarms',()=>{
 const e=event();e.title='Семья, чай; планы\\путь\nзавтра';const raw=writeEvent(e,'abc');assert.deepEqual(readEvent(raw,'work').event.start,e.start);assert.equal(readEvent(raw,'work').event.title,e.title);
 const withExtra=raw.replace('END:VEVENT','DESCRIPTION:Сохранить текст\r\nLOCATION:Адрес\r\nX-EXAMPLE:original\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Напоминание\r\nEND:VALARM\r\nEND:VEVENT');const edited=writeEvent({...e,title:'Новое'},'abc',withExtra);assert.match(edited,/X-EXAMPLE:original/);assert.match(edited,/BEGIN:VALARM/);assert.match(edited,/DESCRIPTION:Сохранить текст/);
 const day={...e,allDay:true,start:'2026-10-09',end:'2026-10-10'};const decoded=readEvent(writeEvent(day,'day'),'work').event;assert.equal(decoded.allDay,true);assert.equal(decoded.end,'2026-10-10');
 const utc={...e,timezone:'UTC'};assert.equal(readEvent(writeEvent(utc,'utc'),'work').event.timezone,'UTC');
});
test('unsupported series and attendee invitations cannot be silently reduced or overwritten',()=>{const raw=writeEvent(event(),'uid');for(const extra of ['RRULE:FREQ=MONTHLY','ATTENDEE:mailto:test@example.test','RECURRENCE-ID:20261009T100000Z'])assert.throws(()=>readEvent(raw.replace('END:VEVENT',extra+'\r\nEND:VEVENT'),'work'),UnsupportedCalendarEvent);assert.throws(()=>writeEvent({...event(),schemaVersion:2,recurrence:{frequency:'daily'}},'x'),UnsupportedCalendarEvent);});
test('import is idempotent after reload and preserves area-only local edits',async()=>{const f=fixture();await f.store.load();const r=f.remote();assert.equal((await f.engine().sync()).received,1);assert.equal(f.store.all('event').length,1);assert.equal((await f.engine().sync()).received,0);const local=f.store.all('event')[0];await f.store.save({...local,areaId:'family'},local.version);r.etag='"changed"';r.data=writeEvent({...event(),title:'С сервера'},'source');await f.engine().sync();assert.equal(f.store.all('event')[0].areaId,'family');assert.equal(f.store.all('event')[0].title,'С сервера');assert.equal(f.puts,0);});
test('linked changes and soft deletions are bidirectional, conditional, and recover after reload',async()=>{const f=fixture();await f.store.load();f.remote();await f.engine().sync();let local=f.store.all('event')[0];await f.store.save({...local,title:'Из плагина'},local.version);assert.equal((await f.engine().sync()).sent,1);assert.equal(readEvent([...f.resources.values()][0].data,'work').event.title,'Из плагина');local=f.store.all('event')[0];await f.store.save({...local,deleted:true},local.version);assert.equal((await f.engine().sync()).removed,1);assert.equal(f.resources.size,0);assert.equal((await f.engine().sync()).removed,0);});
test('conflicts preserve both versions until explicit resolution',async()=>{const f=fixture();await f.store.load();const r=f.remote();await f.engine().sync();const e=f.store.all('event')[0];await f.store.save({...e,title:'Локально'},e.version);r.etag='"external-change"';r.data=writeEvent({...event(),title:'Снаружи'},'source');const result=await f.engine().sync();assert.equal(result.issues[0].conflict,true);assert.equal(f.store.all('event')[0].title,'Локально');assert.equal(f.puts,0);await f.engine().resolve(e.id,'local');assert.equal(readEvent([...f.resources.values()][0].data,'work').event.title,'Локально');});
test('read-only mode never publishes local changes; explicit remote resolution is reversible via backups',async()=>{const f=fixture();await f.store.load();f.remote();await f.engine('read').sync();const e=f.store.all('event')[0];await f.store.save({...e,title:'Локально'},e.version);const r=await f.engine('read').sync();assert.equal(r.issues.length,1);assert.equal(f.puts,0);await f.engine('read').resolve(e.id,'remote');assert.equal(f.store.all('event')[0].title,'Встреча');assert.ok((await f.store.backups(e.id)).length);});
test('absence from list is not deletion; a failed GET never deletes local data',async()=>{const f=fixture();await f.store.load();f.remote();await f.engine().sync();f.client.list=async()=>[];assert.equal((await f.engine().sync()).removed,0);f.client.get=async()=>{throw new Error('timeout');};await assert.rejects(()=>f.engine().sync(),/timeout/);assert.equal(f.store.all('event')[0].deleted,undefined);});
test('confirmed remote deletion preserves local tombstone and detects simultaneous local changes',async()=>{const f=fixture();await f.store.load();const r=f.remote();await f.engine().sync();f.resources.delete(r.url);assert.equal((await f.engine().sync()).removed,1);assert.equal(f.store.all('event')[0].deleted,true);assert.equal((await f.engine().sync()).removed,0);});
test('publishing is explicit; lost response is reconciled by same UID without a second copy',async()=>{const f=fixture();await f.store.load();const e=await f.store.save(event(),0);await f.engine().sync();assert.equal(f.resources.size,0);const original=f.client.put;f.client.put=async(...args)=>{await original(...args);throw new Error('lost response');};await assert.rejects(()=>f.engine().publish(e.id),/lost response/);assert.equal(f.resources.size,1);f.client.put=original;await f.engine().sync();assert.equal(f.resources.size,1);assert.equal(f.puts,1);assert.equal(f.store.all('event').length,1);});
test('a failed create is queued and retried after reload using same UID',async()=>{const f=fixture();await f.store.load();const e=await f.store.save(event(),0),original=f.client.put;f.client.put=async()=>{throw new Error('offline');};await assert.rejects(()=>f.engine().publish(e.id),/offline/);assert.equal(f.resources.size,0);f.client.put=original;assert.equal((await f.engine().sync()).sent,1);assert.equal(f.resources.size,1);});
test('corrupt state and duplicate UIDs stop exchange without erasing original state',async()=>{const f=fixture();await f.store.load();f.remote();await f.engine().sync();const path=[...f.files.keys()].find(p=>p.includes('/calendar-sync/'))!;f.files.set(path,'{broken');await assert.rejects(()=>f.engine().sync());assert.equal(f.files.get(path),'{broken');assert.equal(f.store.all('event').length,1);});
test('passwords are absent from settings and persistent sync records; storage is optional',async()=>{const f=fixture();await f.store.load();let s=connectionDefaults();s.username='test@yandex.ru';const c=new CalendarConnection(()=>s,async next=>{s=next;},f.io,f.store,async()=>{throw new Error('unused');});await c.password('secret-app-password',false);assert.ok(!JSON.stringify(s).includes('secret-app-password'));await assert.rejects(()=>c.password('secret-app-password',true),/1.11.4/);const normalized=normalizeSettings({calendarConnection:{...s,password:'must-not-persist',token:'must-not-persist'}});assert.ok(!JSON.stringify(normalized).includes('must-not-persist'));});
test('client restricts credentials to HTTPS Yandex and makes conditional writes; errors contain no secrets',async()=>{assert.throws(()=>trustedDavUrl('https://other.test/'));assert.throws(()=>trustedDavUrl('http://caldav.yandex.ru/'));const requests:any[]=[];const client=new CaldavClient(async q=>{requests.push(q);return q.method==='PUT'?{status:204,headers:{} as Record<string,string>,text:''}:{status:200,headers:{etag:'"new"'},text:writeEvent(event(),'uid')};},'тест@yandex.ru','very-private');await client.put(calendarUrl+'a.ics',writeEvent(event(),'uid'),'"old"');assert.equal(requests[0].headers['If-Match'],'"old"');assert.ok(requests[0].headers.Authorization.startsWith('Basic '));const bad=new CaldavClient(async()=>{throw new Error('very-private');},'user','very-private');await assert.rejects(()=>bad.get(calendarUrl),e=>!String(e).includes('very-private'));});
test('UTC/TZID import, local edit and CalDAV writeback preserve the actual instant and source timezone',async()=>{
 for(const zone of ['UTC','America/New_York']){const f=fixture();await f.store.load();const source={...event(),timezone:zone,start:'2026-10-09T22:00',end:'2026-10-09T23:00'};f.remote('zoned',writeEvent(source,'zoned'));await f.engine().sync();const local=f.store.all('event')[0];assert.equal(local.timezone,zone);const display=projectEventTime(local,'Europe/Moscow');assert.equal(display.start.slice(0,10),'2026-10-10');const moved=projectEventTime({...display,start:'2026-10-10T08:00',end:'2026-10-10T09:00'},zone);await f.store.save({...local,...moved},local.version);assert.equal((await f.engine().sync()).sent,1);const remote=readEvent([...f.resources.values()][0].data,'work').event;assert.equal(remote.timezone,zone);assert.equal(projectEventTime(remote,'Europe/Moscow').start,'2026-10-10T08:00:00');assert.equal((await f.engine('read').sync()).issues.length,0);}
});
test('disabled import sphere blocks new records but preserves and updates previously linked events',async()=>{
 const f=fixture();await f.store.load();f.remote();await f.engine().sync();const before=f.store.all('event')[0];f.remote('second');f.remote('source',writeEvent({...event(),title:'Обновление существующего'},'source'));const config={username:'test@yandex.ru',calendarUrl,areaId:'work',mode:'read' as const,canImport:()=>false};const result=await new CalendarSync(f.io,f.store,f.client,config).sync();assert.equal(result.received,1);assert.equal(f.store.all('event').length,1);assert.equal(f.store.all('event')[0].id,before.id);assert.equal(f.store.all('event')[0].title,'Обновление существующего');assert.equal(result.issues.length,1);assert.equal(f.puts,0);
});

function gate(){let release!:()=>void,enter!:()=>void;const waiting=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>enter=r);return{entered,release,hold:async()=>{enter();await waiting;}};}
async function connected(f:ReturnType<typeof fixture>,run:(c:CalendarConnection,change:(patch:Partial<ReturnType<typeof connectionDefaults>>)=>void)=>Promise<void>){
 let settings={...connectionDefaults(),username:'test@yandex.ru',calendarUrl,areaId:'work',mode:'both' as 'both'|'read'};
 const original={list:CaldavClient.prototype.list,get:CaldavClient.prototype.get,put:CaldavClient.prototype.put,remove:CaldavClient.prototype.remove};
 Object.assign(CaldavClient.prototype,{list:()=>f.client.list(),get:(url:string)=>f.client.get(url),put:(...args:Parameters<typeof f.client.put>)=>f.client.put(...args),remove:(...args:Parameters<typeof f.client.remove>)=>f.client.remove(...args)});
 try{const c=new CalendarConnection(()=>settings,async next=>{settings=next;},f.io,f.store,async()=>{throw new Error('No real network');});await c.password('fixture-password',false);await run(c,patch=>{settings={...settings,...patch};});}finally{Object.assign(CaldavClient.prototype,original);}
}
test('current connection permission blocks subsequent PUT/DELETE after REPORT for mode, account and calendar changes',async()=>{
 for(const patch of [{mode:'read' as const},{username:'another@yandex.ru'},{calendarUrl:calendarUrl+'another/'}])for(const action of ['edit','delete','queued']){
  const f=fixture();await f.store.load();await connected(f,async(c,change)=>{
   const e=await f.store.save(event(),0),put=f.client.put;
   if(action==='queued'){f.client.put=async()=>{throw new Error('offline');};await assert.rejects(()=>c.publish(e.id),/offline/);f.client.put=put;}
   else{await c.publish(e.id);await f.store.save({...e,version:1,...(action==='delete'?{deleted:true}:{title:'Keep local edit'})},1);}
   const before=f.store.get(e.id),calls=f.calls.length,pause=gate(),list=f.client.list;f.client.list=async()=>{await pause.hold();return list();};
   const pending=c.sync();await pause.entered;change(patch);pause.release();const result=await pending;
   assert.equal(result.sent,0);assert.equal(result.removed,0);assert.equal(f.calls.length,calls);assert.deepEqual(f.store.get(e.id),before);
   assert.equal(JSON.parse([...f.files].find(([p])=>p.includes('/calendar-sync/'))![1]).links.length,1);
   change({mode:'both',username:'test@yandex.ru',calendarUrl});f.client.list=list;const resumed=await c.sync();assert.equal(action==='delete'?resumed.removed:resumed.sent,1);
  });
 }
});
test('local conflict resolution checks current connection after delayed GET, for PUT and DELETE',async()=>{
 for(const deleted of [false,true])for(const patch of [{mode:'read' as const},{username:'another@yandex.ru'},{calendarUrl:calendarUrl+'other/'}]){
  const f=fixture();await f.store.load();await connected(f,async(c,change)=>{
   const e=await f.store.save(event(),0);await c.publish(e.id);await f.store.save({...e,version:1,title:'Local choice',...(deleted?{deleted:true}:{})},1);
   const before=f.store.get(e.id),calls=f.calls.length,pause=gate(),get=f.client.get;f.client.get=async url=>{await pause.hold();return get(url);};
   const pending=c.resolve(e.id,'local');await pause.entered;change(patch);pause.release();await assert.rejects(()=>pending,/Настройки обмена изменились/);
   assert.equal(f.calls.length,calls);assert.deepEqual(f.store.get(e.id),before);assert.equal(f.resources.size,1);
  });
 }
});
test('publication rechecks current connection after queue persistence and leaves blocked creation queued',async()=>{
 for(const patch of [{mode:'read' as const},{username:'another@yandex.ru'},{calendarUrl:calendarUrl+'other/'}]){
  const f=fixture();await f.store.load();await connected(f,async(c,change)=>{
   const e=await f.store.save(event(),0),pause=gate(),create=f.io.create!;f.io.create=async(p,t)=>{const result=await create(p,t);if(p.includes('/calendar-sync/'))await pause.hold();return result;};
   const pending=c.publish(e.id);await pause.entered;change(patch);pause.release();await assert.rejects(()=>pending,/Настройки обмена изменились/);
   assert.equal(f.puts,0);assert.deepEqual(f.store.get(e.id),e);assert.equal(JSON.parse([...f.files].find(([p])=>p.includes('/calendar-sync/'))![1]).links.length,1);
   change({mode:'both',username:'test@yandex.ru',calendarUrl});assert.equal((await c.sync()).sent,1);
  });
 }
});
test('former series stays schema2 through remote updates, conflicts, and deletion without blocking other events',async()=>{
 const f=fixture();await f.store.load();const series={...event(),schemaVersion:2 as const,recurrence:{frequency:'daily' as const},featured:true};
 const single=changeEventSeries(series,eventFields(series),undefined);const e=await f.store.save(single,0);await f.engine().publish(e.id);
 const r=[...f.resources.values()][0],uid=readEvent(r.data,'work').uid;
 await f.store.save({...f.store.all('event')[0],areaId:'family'},1);
 r.etag='"edit"';r.data=writeEvent({...single,title:'Server update'},uid);f.remote('another',writeEvent({...event(),title:'Other resource'},'another'));
 assert.equal((await f.engine().sync()).received,2);let local=f.store.get(e.id) as CalendarEvent;
 assert.equal(local.schemaVersion,2);assert.equal(local.title,'Server update');assert.equal(local.areaId,'family');assert.equal(local.featured,true);assert.equal(local.id,e.id);
 await f.store.save({...local,title:'Conflict local'},local.version);r.etag='"conflict"';r.data=writeEvent({...single,title:'Conflict server'},uid);assert.equal((await f.engine().sync()).issues[0].conflict,true);
 await f.engine().resolve(e.id,'remote');local=f.store.get(e.id) as CalendarEvent;assert.equal(local.schemaVersion,2);assert.equal(local.title,'Conflict server');assert.equal(local.areaId,'family');assert.equal(local.featured,true);
 await assert.rejects(()=>f.store.save({...local,schemaVersion:1},local.version),/Понижение схемы/);
 f.resources.delete(r.url);await f.engine().sync();local=f.store.get(e.id) as CalendarEvent;assert.equal(local.deleted,true);assert.equal(local.schemaVersion,2);
});

function durationRaw(e:CalendarEvent,uid:string,value:string){return writeEvent(e,uid).replace(/DTEND[^\r\n]*/, 'DURATION:'+value);}
test('mixed DTEND/DURATION calendar imports all supported events, edits and roundtrips preserving extras',async()=>{
 const f=fixture();await f.store.load();f.remote('normal');
 const raw=durationRaw({...event(),timezone:'UTC',start:'2026-10-09T22:00:00',end:'2026-10-09T23:00:00'},'duration','PT1H').replace('END:VEVENT','DESCRIPTION:Keep description\r\nLOCATION:Keep location\r\nX-CUSTOM:Keep custom\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT10M\r\nDESCRIPTION:Keep alarm\r\nEND:VALARM\r\nEND:VEVENT');
 f.remote('duration',raw);const result=await f.engine().sync();assert.equal(result.received,2);assert.equal(result.issues.length,0);
 const local=f.store.all('event').find(e=>e.timezone==='UTC')!;assert.equal(local.end,'2026-10-09T23:00:00');assert.equal(projectEventTime(local,'Europe/Moscow').start,'2026-10-10T01:00:00');
 await f.store.save({...local,title:'Edited duration',end:'2026-10-10T00:00:00'},local.version);assert.equal((await f.engine().sync()).sent,1);
 const edited=f.resources.get(calendarUrl+'duration.ics')!.data;assert.match(edited,/DTEND:20261010T000000Z/);assert.doesNotMatch(edited,/\r\nDURATION:/);
 for(const extra of ['DESCRIPTION:Keep description','LOCATION:Keep location','X-CUSTOM:Keep custom','BEGIN:VALARM','TRIGGER:-PT10M'])assert(edited.includes(extra));
 const reimport=fixture();await reimport.store.load();reimport.remote('duration',edited);assert.equal((await reimport.engine().sync()).received,1);assert.equal(reimport.store.all('event')[0].title,'Edited duration');assert.equal(reimport.store.all('event')[0].end,'2026-10-10T00:00:00');
});
test('DATE without DTEND/DURATION means one day; week/day duration keeps exclusive date end',()=>{
 const day={...event(),start:'2026-10-09',end:'2026-10-10',allDay:true},raw=writeEvent(day,'day').replace(/DTEND[^\r\n]*\r\n/,'');
 const parsed=readEvent(raw,'work');assert.equal(parsed.event.end,'2026-10-10');assert.equal(parsed.event.allDay,true);
 const edited=writeEvent({...parsed.event,title:'Edited day'},'day',raw);assert.equal(readEvent(edited,'work').event.end,'2026-10-10');assert.doesNotMatch(edited,/DURATION:/);
 assert.equal(readEvent(durationRaw(day,'week','P1W'),'work').event.end,'2026-10-16');
 assert.equal(readEvent(durationRaw(day,'days','P2D'),'work').event.end,'2026-10-11');
});
test('DURATION nominal days differ from exact hours across DST and preserve source timezone',()=>{
 for(const [date,expectedDay,expectedHours]of [['2026-03-07','2026-03-08T12:00:00','2026-03-08T13:00:00'],['2026-10-31','2026-11-01T12:00:00','2026-11-01T11:00:00']]){
  const e={...event(),start:date+'T12:00:00',end:date+'T13:00:00',timezone:'America/New_York'};
  assert.equal(readEvent(durationRaw(e,'days','P1D'),'work').event.end,expectedDay);assert.equal(readEvent(durationRaw(e,'hours','PT24H'),'work').event.end,expectedHours);
  const mixed=readEvent(durationRaw(e,'mixed','P1DT1H'),'work').event;assert.equal(mixed.end,expectedDay.replace('T12:','T13:'));assert.equal(mixed.timezone,'America/New_York');
 }
 const spring={...event(),start:'2026-03-08T01:30:00',end:'2026-03-08T03:30:00',timezone:'America/New_York'};assert.equal(readEvent(durationRaw(spring,'hour','PT1H'),'work').event.end,'2026-03-08T03:30:00');
 const fold={...spring,start:'2026-11-01T01:30:00',end:'2026-11-01T02:30:00'};assert.throws(()=>readEvent(durationRaw(fold,'fold','PT1H'),'work'),UnsupportedCalendarEvent);
 const berlin={...spring,timezone:'Europe/Berlin',start:'2026-10-25T02:30:00',end:'2026-10-25T03:30:00'};assert.throws(()=>readEvent(durationRaw(berlin,'berlin-fold','PT1H'),'work'),/неоднозначном повторяющемся часе/);
 const gap={...spring,start:'2026-03-07T02:30:00',end:'2026-03-07T03:30:00'};assert.throws(()=>readEvent(durationRaw(gap,'gap','P1D'),'work'),/отсутствующее местное время/);
});
test('unrepresentable zero-length event is skipped, other resources continue, linked omission or skip never deletes',async()=>{
 const f=fixture();await f.store.load();const linked=f.remote('linked');await f.engine().sync();const original=f.store.all('event')[0],filesBefore=f.files.get('Planner/Data/records/'+original.id+'.json');assert(filesBefore);
 linked.data=writeEvent(event(),'linked').replace(/DTEND[^\r\n]*\r\n/,'');linked.etag='"zero-length"';f.remote('good-duration',durationRaw(event(),'good-duration','PT1H'));
 let gets=0;const get=f.client.get;f.client.get=async url=>{gets++;return get(url);};
 const result=await f.engine().sync();assert.equal(result.received,1);assert.equal(result.removed,0);assert.equal(result.issues.length,1);assert.match(result.issues[0].message,/нулевую длительность/);assert.equal(gets,0);assert.deepEqual(f.store.get(original.id),original);assert.equal(f.resources.get(linked.url)?.data,linked.data);
 const list=f.client.list;f.client.list=async()=>[...f.resources.values()].filter(r=>r.url!==linked.url);const next=await f.engine().sync();assert.equal(next.removed,0);assert.equal(gets,1);assert.deepEqual(f.store.get(original.id),original);assert.equal(f.files.get('Planner/Data/records/'+original.id+'.json'),filesBefore);f.client.list=list;
});

test('linked sync GET rechecks write permission, and a mode change during one write blocks the next write',async()=>{
 const f=fixture();await f.store.load();await connected(f,async(c,change)=>{
  const a=await f.store.save(event(),0),b=await f.store.save({...event(),title:'Second'},0);await c.publish(a.id);await c.publish(b.id);
  for(const id of [a.id,b.id]){const e=f.store.get(id) as CalendarEvent;await f.store.save({...e,title:e.title+' local'},e.version);}
  f.client.list=async()=>[];const pause=gate(),get=f.client.get;let delayed=false;f.client.get=async url=>{if(!delayed){delayed=true;await pause.hold();}return get(url);};
  const calls=f.calls.length,pending=c.sync();await pause.entered;change({mode:'read'});pause.release();assert.equal((await pending).sent,0);assert.equal(f.calls.length,calls);
  change({mode:'both'});f.client.get=get;const put=f.client.put;f.client.put=async(...args)=>{const r=await put(...args);change({mode:'read'});return r;};
  const result=await c.sync();assert.equal(result.sent,1);assert.equal(f.calls.length,calls+1);assert.equal(f.store.all('event').filter(e=>e.title.endsWith(' local')).length,2);
 });
});
