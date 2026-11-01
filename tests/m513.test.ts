import test from 'node:test';import assert from 'node:assert/strict';
import {newTask,changeTask,validateRecord} from '../src/domain';
import {taskStateBefore} from '../src/task-history';
import {selectedTaskStatistics} from '../src/task-statistics';
import {period} from '../src/periods';
import {NotesService,resolveNoteContext,replaceManagedWidgets} from '../src/notes';
import {defaultSettings} from '../src/settings';
import {configureDailyNotes} from '../src/daily-notes';
import {RecordStore,type FileIO} from '../src/storage';
class IO implements FileIO{files=new Map<string,string>();async read(p:string){return this.files.get(p)??null;}async write(p:string,t:string){this.files.set(p,t);}async mkdir(_p:string){}async list(p:string){return [...this.files.keys()].filter(k=>!p||k.startsWith(p+'/'));}async create(p:string,t:string){if(this.files.has(p))return false;this.files.set(p,t);return true;}}
const a='2026-10-01T09:00:00+03:00',b='2026-10-02T09:00:00+03:00';
test('task favorites preserve historical state, completion day and statistics through JSON/reload',async()=>{
 const io=new IO(),store=new RecordStore(io);await store.load();const original=newTask({title:'Школа',areaId:'work',plannedDate:'2026-10-03',planPeriod:{type:'day',date:'2026-10-03'}},a);
 const favorite=changeTask(original,{featured:true},b);assert.equal(taskStateBefore(favorite,'2026-10-02')!.featured,undefined);assert.equal(favorite.completedDate,undefined);
 const done=changeTask(favorite,{status:'done'},b,'2026-10-03');await store.save(done,0);await store.reload();const saved=store.get(done.id)!;assert.equal(saved.kind,'task');if(saved.kind!=='task')throw Error();assert(saved.featured);assert.equal(saved.completedDate,'2026-10-03');assert.equal(saved.completedAt,b);
 const plain=changeTask(done,{featured:false},'2026-10-03T09:00:00+03:00');validateRecord(JSON.parse(JSON.stringify(plain)));const p=period('week','2026-10-02');assert.equal(selectedTaskStatistics([done],p,'2026-10-02',['day']).done,selectedTaskStatistics([plain],p,'2026-10-02',['day']).done);
 assert.throws(()=>validateRecord({...done,featured:'yes'}));assert.throws(()=>validateRecord({...done,featured:false}));validateRecord(original);
});
test('Daily Notes configuration preserves unrelated options/plugins and backs up original files once',async()=>{
 const io=new IO();const old='{ "folder":"Journal", "format":"YYYY-MM-DD", "autorun":true }';io.files.set('.obsidian/daily-notes.json',old);io.files.set('.obsidian/core-plugins.json','["file-explorer","graph"]');const s=defaultSettings();assert(await configureDailyNotes(io,s,'.obsidian'));const options=JSON.parse((await io.read('.obsidian/daily-notes.json'))!);assert.equal(options.autorun,true);assert.equal(options.folder,'Planner/Journal/01 День');assert.equal(options.format,'DD.MM.YYYY');assert.equal(options.template,'Planner/Templates/Obsidian Daily Notes');assert.deepEqual(JSON.parse((await io.read('.obsidian/core-plugins.json'))!),['file-explorer','graph','daily-notes']);const backup=[...io.files].find(([p])=>p.includes('integration-backups'))![1];assert.equal(JSON.parse(backup)[0].content,old);assert.equal(await configureDailyNotes(io,s,'.obsidian'),false);assert.equal([...io.files].filter(([p])=>p.includes('integration-backups')).length,1);
});
test('native Daily Notes template resolves ISO context and plugin reuses same file instead of duplicating it',async()=>{
 const io=new IO(),notes=new NotesService(io,'Planner',defaultSettings);await notes.ensureFoundation();const template=io.files.get('Planner/Templates/Obsidian Daily Notes.md')!;const text=template.replace('{{date:YYYY-MM-DD}}','2026-10-03');const path='Planner/Journal/01 День/03-10-2026.md';io.files.set(path,text+'\nМоя запись\n');assert.equal(resolveNoteContext(path,text).start,'2026-10-03');assert.equal(await notes.ensurePeriod('day','2026-10-03'),path);assert(io.files.get(path)!.endsWith('Моя запись\n'));assert.equal([...io.files].filter(([p])=>p.includes('/01 День/')).length,1);
});
test('malformed native settings and concurrent changes stop without replacing source',async()=>{
 const io=new IO();io.files.set('.obsidian/core-plugins.json','bad');await assert.rejects(configureDailyNotes(io,defaultSettings(),'.obsidian'));assert.equal(io.files.size,1);io.files.set('.obsidian/core-plugins.json','[]');const write=io.write.bind(io);io.write=async(p,t)=>{await write(p,t);if(p.includes('integration-backups'))io.files.set('.obsidian/core-plugins.json','["graph"]');};await assert.rejects(configureDailyNotes(io,defaultSettings(),'.obsidian'),/изменились/);assert.equal(io.files.get('.obsidian/core-plugins.json'),'["graph"]');
});
test('missing core config preserves implicit host plugins and custom config dir works',async()=>{const io=new IO();await configureDailyNotes(io,defaultSettings(),'.custom');assert(io.files.has('.custom/daily-notes.json'));assert(!io.files.has('.custom/core-plugins.json'));io.files.set('.custom/core-plugins.json','{"graph":true,"daily-notes":false}');await configureDailyNotes(io,defaultSettings(),'.custom');assert.deepEqual(JSON.parse(io.files.get('.custom/core-plugins.json')!),{graph:true,'daily-notes':true});});
test('migration from independent legacy widgets to dashboard preserves free Markdown and rejects interleaved content',()=>{const text='Введение\n%% life-planner-widgets:start %%\n```life-planner\ncalendar\n```\n\n```life-planner\ntasks\n```\n%% life-planner-widgets:end %%\nМой текст\n';const next=replaceManagedWidgets(text,'day');assert(next.startsWith('Введение\n'));assert(next.endsWith('Мой текст\n'));assert.equal((next.match(/```life-planner/g)??[]).length,1);assert(next.includes('\nall\n'));assert.throws(()=>replaceManagedWidgets(text.replace('\n\n```','\nМой список\n```'),'day'));});
