import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {defaultSettings,normalizeSettings} from '../src/settings';
import {RecordStore,type FileIO} from '../src/storage';
import {base,newTask,newCheckin} from '../src/domain';
import {NotesService} from '../src/notes';
import type {Definition} from '../src/model';
import {githubHeaderSource} from '../src/headers/source';

test('Manifest branding keeps the existing plugin ID, record bytes, history, settings, notes and workout comments',async()=>{
 const manifest=JSON.parse(await readFile('manifest.json','utf8'));assert.equal(manifest.name,'Manifest');assert.equal(manifest.author,'neurasthenick1d');assert.equal(manifest.id,'life-planner');assert.equal(manifest.isDesktopOnly,false);
 const settings=normalizeSettings(defaultSettings());settings.areas[0].title='Название пользователя';settings.areas[0].enabled=false;settings.decoration.notes['day:2026-10-20']={...settings.decoration.defaults.day,preset:'scene-novgorod'};assert.deepEqual(normalizeSettings(settings),settings);
 const definition:Definition={...base('retained-workout'),version:1,kind:'definition',type:'workout',versions:[{effectiveDate:'2026-10-20',title:'Программа пользователя',weekdays:[1,2,3,4,5,6,7],items:[{id:'constant-exercise',title:'Упражнение'}]}]},task={...newTask({title:'Сохранить задачу',areaId:'family',plannedDate:'2026-10-20'}),version:1},checkin={...newCheckin(definition,'2026-10-20'),version:1,finalized:true,comment:'Комментарий пользователя',states:{'constant-exercise':true}};
 const files=new Map<string,string>([definition,task,checkin].map(v=>['Planner/Data/records/'+v.id+'.json',JSON.stringify(v)]));const note='Planner/Journal/01 День/20.10.2026.md';files.set(note,'---\nlife-planner-type: day\nlife-planner-date: 2026-10-20\n---\n## Свободные записи\n\nЛичный текст [[Ссылка]].\n');const before=new Map(files);let writes=0;
 const io:FileIO={read:async p=>files.get(p)??null,write:async(p,t)=>{writes++;files.set(p,t);},mkdir:async()=>{writes++;},list:async p=>[...files.keys()].filter(k=>k.startsWith(p))};const store=new RecordStore(io);await store.load();assert.deepEqual(store.issues,[]);assert.deepEqual(store.get(task.id),JSON.parse(JSON.stringify(task)));assert.equal(store.all('checkin')[0].comment,checkin.comment);const notes=new NotesService(io,'Planner',()=>settings);assert.equal((await notes.context(note)).start,'2026-10-20');assert.deepEqual(files,before);assert.equal(writes,0);
});

test('Configured header requests use the confirmed Manifest repository and remain data-only',async()=>{
 const urls:string[]=[];const source=githubHeaderSource(async url=>{urls.push(url);return {status:200,arrayBuffer:new TextEncoder().encode(url.includes('matching-refs')?'[]':'{}').buffer};});await source.manifest();await source.image('a'.repeat(64));assert(urls.every(u=>u.includes('github.com/')&&u.includes('/neurasthenickid/Manifest/')));assert(urls.at(-1)!.endsWith('/h-'+ 'a'.repeat(64)+'.webp'));assert(urls.every(u=>!u.endsWith('.js')));
});
