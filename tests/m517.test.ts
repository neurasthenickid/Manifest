import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDate, parseDate, period, periodFromKey} from '../src/periods';
import {NotesService, defaultTemplate, dailyNotesTemplate, resolveNoteContext} from '../src/notes';
import {configureDailyNotes} from '../src/daily-notes';
import {defaultSettings} from '../src/settings';
import type {FileIO} from '../src/storage';

class MemoryIO implements FileIO {
  files = new Map<string,string>();
  async read(path:string){return this.files.get(path) ?? null;}
  async write(path:string,text:string){this.files.set(path,text);}
  async mkdir(_path:string){}
  async list(prefix:string){return [...this.files.keys()].filter(path=>!prefix||path.startsWith(prefix+'/'));}
  async create(path:string,text:string){if(this.files.has(path))return false;this.files.set(path,text);return true;}
}

test('dotted display and legacy input resolve the same ISO date, with strict leap and separator validation',()=>{
  for(const input of ['29.02.2028','29-02-2028'])assert.equal(parseDate(input),'2028-02-29');
  for(const input of ['29.02.2027','03.10-2026','03-10.2026','03.10.26'])assert.throws(()=>parseDate(input));
  assert.equal(formatDate('2026-10-03'),'03.10.2026');
  assert.deepEqual(periodFromKey('day','03-10-2026'),periodFromKey('day','03.10.2026'));
  assert.equal(period('month','2026-10-03').key,'10-2026');
  assert.equal(period('month','2026-10-03').label,'10.2026');
});

test('legacy daily note identity is reused without replacing personal Markdown or creating a dotted twin',async()=>{
  const io=new MemoryIO(),notes=new NotesService(io),path='Planner/Journal/Daily/03-10-2026.md';
  const original='# Мои записи\n\n[[Книга]]\n- [x] Личная отметка\n';io.files.set(path,original);
  assert.equal(await notes.ensurePeriod('day','2026-10-03'),path);
  assert.equal(io.files.get(path),original);
  assert.equal(io.files.has('Planner/Journal/Daily/03.10.2026.md'),false);
  const next=await notes.ensurePeriod('day','2026-10-04');
  assert.equal(next,'Planner/Journal/Daily/04-10-2026.md');
  assert.equal(resolveNoteContext(next,io.files.get(next)!).start,'2026-10-04');
});

test('native Daily Notes follows legacy or fresh folder names and rejects mixed naming before any config write',async()=>{
  const settings=defaultSettings(),folder='Planner/Journal/'+settings.folders.day;
  for(const separator of ['.','-']){
    const io=new MemoryIO(),notes=new NotesService(io,'Planner',()=>settings);
    io.files.set(`${folder}/03${separator}10${separator}2026.md`,'# Мои записи');
    await configureDailyNotes(io,settings,'.obsidian');
    const config=JSON.parse(io.files.get('.obsidian/daily-notes.json')!);
    assert.equal(config.format,separator==='.'?'DD.MM.YYYY':'DD-MM-YYYY');
    assert.equal(await notes.ensurePeriod('day','2026-10-04'),`${folder}/04${separator}10${separator}2026.md`);
  }
  const io=new MemoryIO();io.files.set(folder+'/03-10-2026.md','# Первый день');io.files.set(folder+'/04.10.2026.md','# Второй день');
  const before=[...io.files];await assert.rejects(configureDailyNotes(io,settings,'.obsidian'),/смешаны/);assert.deepEqual([...io.files],before);
});

test('occupied daily aliases and preexisting duplicate identities block creation without altering either file',async()=>{
  for(const separator of ['.','-']){
    const io=new MemoryIO(),notes=new NotesService(io),path=`Planner/Journal/Daily/03${separator}10${separator}2026.md`;
    const original='---\nlife-planner-type: day\nlife-planner-date: 2026-10-04\n---\nЧужой день\n';io.files.set(path,original);
    await assert.rejects(notes.ensurePeriod('day','2026-10-03'),/Путь занят/);
    assert.equal(io.files.get(path),original);
    assert.equal([...io.files.keys()].filter(p=>p.includes('/Journal/')).length,1);
  }
  const io=new MemoryIO(),notes=new NotesService(io);
  io.files.set('Planner/Journal/Daily/03-10-2026.md','# Прежняя заметка');
  io.files.set('Planner/Journal/Daily/03.10.2026.md','# Вторая заметка');
  await assert.rejects(notes.ensurePeriod('day','2026-10-03'),/несколько заметок/);
});

test('fresh daily and native Daily Notes templates contain one themed Markdown writing area without old prompts',()=>{
  for(const template of [defaultTemplate('day'),dailyNotesTemplate()]){
    assert.equal((template.match(/^## Свободные записи$/gm)??[]).length,1);assert(!template.includes('[!lp-notes]'));
    assert(template.includes('Свободные записи'));
    assert(!/Главное на день|Вечерний отчёт|related_links|Периоды:/.test(template));
    assert(template.includes('life-planner-template-version: 7'));
  }
  assert(dailyNotesTemplate().includes('life-planner-date: {{date:YYYY-MM-DD}}'));
  assert(!defaultTemplate('week').includes('## Итоги недели'));
});
