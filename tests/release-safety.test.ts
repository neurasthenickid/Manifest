import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudConnection} from '../src/integrations/cloud-connection';
import {CloudSettingsFile,cloudDefaults,normalizeCloud} from '../src/integrations/cloud-settings';
import {syncHash} from '../src/integrations/calendar-sync';
import {RecordStore,type FileIO} from '../src/storage';
import {defaultAreas} from '../src/areas';
import {defaultSettings,normalizeSettings} from '../src/settings';
import {configureDailyNotes,dailyNotesStartupChoice,ownsDailyNotes} from '../src/daily-notes';
import {NotesService} from '../src/notes';

function memory(){const files=new Map<string,string>(),writes:string[]=[];const io:FileIO={read:async p=>files.get(p)??null,write:async(p,t)=>{writes.push(p);files.set(p,t);},mkdir:async()=>{},list:async p=>[...files.keys()].filter(k=>k.startsWith(p+'/'))};return {files,writes,io};}

test('R1: shared secret references never authorize another server, user or secret, including legacy fallback',async()=>{
 const server='https://original.example/',username='artificial-user';
 const expected='life-planner-cloud-'+(await syncHash(JSON.stringify([server,username]))).slice(0,32);
 const legacy='life-planner-onetask-'+(await syncHash(JSON.stringify([server,username]))).slice(0,32);
 for(const changed of [{server:'https://different.example/'},{username:'other-user'},{secretId:'life-planner-cloud-'+'f'.repeat(32)},{secretId:'',server:'https://different.example/'},{secretId:'',username:'other-user'}]){
  const m=memory(),s=normalizeCloud({...cloudDefaults(),server,username,secretId:expected,legacySecrets:[legacy],enabled:true,checked:true,...changed});s.calendarUrl=s.server+'calendar/';
  const file=new CloudSettingsFile(m.io);m.files.set(file.path,JSON.stringify({schemaVersion:1,settings:s}));const settings=await file.load();let network=0,reads=0,copies=0;
  const store=new RecordStore(m.io);await store.load();
  const c=new CloudConnection(()=>settings,async()=>{throw Error('Unexpected settings migration');},m.io,store,async()=>{network++;throw Error('Unexpected request');},{getSecret:()=>{reads++;return 'synthetic-password';},setSecret:()=>{copies++;}},defaultAreas,()=>file.assertCurrent());
  await c.restore();assert.equal(c.connected,false);assert.match(c.status,/Нужен вход/);const result=await c.sync();assert.equal(result.errors.length,1);assert.equal(network,0);assert.equal(reads,0);assert.equal(copies,0);assert.deepEqual(store.all('task'),[]);c.dispose();
 }
});

test('R1: valid normalized account restores after restart and legitimate legacy migration remains bound',async()=>{
 const server='https://caldav.yandex.ru/',username='artificial-user';const id='life-planner-cloud-'+(await syncHash(JSON.stringify([server,username]))).slice(0,32);
 for(const legacy of [false,true]){const m=memory();let s=normalizeCloud({...cloudDefaults(),server:'https://CALDAV.YANDEX.RU',username:' '+username+' ',secretId:legacy?'':id,legacySecrets:legacy?['life-planner-yandex-'+(await syncHash(username.toLowerCase())).slice(0,32)]:[]});const secrets=new Map<string,string>([[legacy?s.legacySecrets[0]:id,'synthetic-password']]);const store=new RecordStore(m.io);await store.load();const c=new CloudConnection(()=>s,async next=>{s=normalizeCloud(next);},m.io,store,async()=>{throw Error('No network expected');},{getSecret:key=>secrets.get(key)??null,setSecret:(key,value)=>{secrets.set(key,value);}},defaultAreas);await c.restore();assert.equal(c.connected,true);assert.equal(s.secretId,id);assert.equal(secrets.get(id),'synthetic-password');s={...s,secretId:'life-planner-cloud-'+'e'.repeat(32)};c.settingsChanged();assert.equal(c.connected,false);c.dispose();}
});

test('R1: Yandex legacy secret cannot migrate to another origin even with the same username',async()=>{
 const m=memory(),username='artificial-user';let s=normalizeCloud({...cloudDefaults(),server:'https://different.example/',username,legacySecrets:['life-planner-yandex-'+(await syncHash(username.toLowerCase())).slice(0,32)]});let reads=0;const c=new CloudConnection(()=>s,async n=>{s=n;},m.io,new RecordStore(m.io),async()=>{throw Error('No network');},{getSecret:()=>{reads++;return 'synthetic-password';},setSecret:()=>{throw Error('No migration');}},defaultAreas);await c.restore();assert.equal(reads,0);assert.equal(c.connected,false);c.dispose();
});

test('R2: new, foreign or disabled Daily Notes are never rewritten on startup or after refusal',async()=>{
 for(const core of [null,'["graph"]','{"daily-notes":false,"graph":true}']){const m=memory(),s=defaultSettings();const original=JSON.stringify({folder:'My journal',format:'YYYY-MM-DD',template:'Templates/Mine'});if(core!==null){m.files.set('.custom/daily-notes.json',original);m.files.set('.custom/core-plugins.json',core);}const before=[...m.files];assert.equal(await dailyNotesStartupChoice(m.io,s,'.custom'),'pending');assert.deepEqual([...m.files],before);const saved=normalizeSettings({...s,dailyNotes:'disabled'});assert.equal(await dailyNotesStartupChoice(m.io,normalizeSettings(JSON.parse(JSON.stringify(saved))),'.custom'),'disabled');assert.deepEqual([...m.files],before);assert.equal(m.writes.length,0);}
});

test('R2: explicit connection backs up config; legacy requires exact owned settings, enabled module and template',async()=>{
 const m=memory(),s=defaultSettings();await new NotesService(m.io,'Planner',()=>s).ensureFoundation();m.files.set('.custom/daily-notes.json','{"folder":"Other","format":"YYYY-MM-DD","template":"Other","autorun":false}');m.files.set('.custom/core-plugins.json','["graph"]');assert.equal(await dailyNotesStartupChoice(m.io,s,'.custom'),'pending');await configureDailyNotes(m.io,s,'.custom');assert.equal(await ownsDailyNotes(m.io,s,'.custom'),true);assert.equal(await dailyNotesStartupChoice(m.io,s,'.custom'),'enabled');const count=m.writes.length;assert.equal(await dailyNotesStartupChoice(m.io,s,'.custom'),'enabled');assert.equal(m.writes.length,count);assert([...m.files.keys()].some(p=>p.includes('integration-backups/')));m.files.set('.custom/core-plugins.json','["graph"]');assert.equal(await dailyNotesStartupChoice(m.io,s,'.custom'),'pending');m.files.set('.custom/core-plugins.json','["daily-notes"]');m.files.set('Planner/Templates/Obsidian Daily Notes.md','# чужой шаблон');assert.equal(await dailyNotesStartupChoice(m.io,s,'.custom'),'pending');
});
