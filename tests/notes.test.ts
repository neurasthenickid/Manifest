import test from 'node:test';
import assert from 'node:assert/strict';
import { NotesService, resolveNoteContext } from '../src/notes';
import type { FileIO } from '../src/storage';
import type { PeriodType } from '../src/model';

class MemoryIO implements FileIO {
  files = new Map<string, string>(); writes: string[] = [];
  async read(path: string): Promise<string | null> { return this.files.get(path) ?? null; }
  async write(path: string, text: string): Promise<void> { this.writes.push(path); this.files.set(path, text); }
  async create(path: string, text: string): Promise<boolean> { if (this.files.has(path)) return false; await this.write(path, text); return true; }
  async list(prefix: string): Promise<string[]> { return [...this.files.keys()].filter(path => !prefix || path.startsWith(`${prefix}/`)); }
  async mkdir(_path: string): Promise<void> {}
}

test('foundation is ordinary Markdown with five distinct editable templates and is idempotent', async () => {
  const io = new MemoryIO(); const notes = new NotesService(io);
  await notes.ensureFoundation(); assert.equal(io.files.size, 12);
  const templates = [...io.files.entries()].filter(([path]) => path.includes('/Templates/'));
  assert.equal(templates.length, 6); assert.equal(new Set(templates.map(([, content]) => content)).size, 6);
  for (const [path, template] of templates) {
    assert.equal(template.includes('```life-planner\nall\n```'),true);assert.equal(template.includes('### Семья'),false);
    assert.ok(template.includes('```life-planner')); assert.ok(template.includes(path.endsWith('Obsidian Daily Notes.md')?'{{date:YYYY-MM-DD}}':'{{date}}'));
  }
  assert.ok(io.files.get('Planner/Templates/Daily.md')!.includes('## Свободные записи'));
  io.files.set('Planner/Manifest.md', '# Мой текст\n\n- [x] Свой принцип');
  const writes = io.writes.length; await notes.ensureFoundation();
  assert.equal(io.writes.length, writes); assert.equal(io.files.get('Planner/Manifest.md'), '# Мой текст\n\n- [x] Свой принцип');
});

test('all five periods use their historical context and repeated creation preserves Markdown', async () => {
  const io = new MemoryIO(); const notes = new NotesService(io);
  const cases: [PeriodType, string, string][] = [
    ['day', '31.12.2026', '2026-12-31'], ['week', '2026-W53', '2026-12-28'], ['month', '12-2026', '2026-12-01'],
    ['quarter', '2026-Q4', '2026-10-01'], ['year', '2026', '2026-01-01'],
  ];
  for (const [type, filename, start] of cases) {
    const path = await notes.ensurePeriod(type, '2026-12-31');
    assert.ok(path.endsWith(`/${filename}.md`)); assert.equal((await notes.context(path)).start, start);
    const personal = `${io.files.get(path)}\nОбычный абзац [[Ссылка]]\n- [x] Личный checkbox\n`;
    io.files.set(path, personal);
    assert.equal(await notes.ensurePeriod(type, '2026-12-31'), path); assert.equal(io.files.get(path), personal);
  }
});

test('simultaneous repeated navigation creates one note and does not overwrite after reload', async () => {
  const io = new MemoryIO(); const notes = new NotesService(io);
  const paths = await Promise.all(Array.from({ length: 8 }, () => notes.ensurePeriod('day', '2026-10-01')));
  assert.equal(new Set(paths).size, 1); assert.equal(io.writes.filter(path => path.includes('/Journal/')).length, 1);
  const reopened = new NotesService(io); assert.equal(await reopened.ensurePeriod('day', '2026-10-01'), paths[0]);
  assert.equal(io.writes.filter(path => path.includes('/Journal/')).length, 1);
});

test('metadata survives renaming and moving outside Planner; no duplicate is created', async () => {
  const io = new MemoryIO(); const notes = new NotesService(io); const path = await notes.ensurePeriod('week', '2027-01-01');
  const personal = `${io.files.get(path)}\nМоя историческая неделя\n`;
  io.files.delete(path); io.files.set('Личный архив/Зимние каникулы.md', personal);
  assert.equal(await notes.ensurePeriod('week', '2026-12-30'), 'Личный архив/Зимние каникулы.md');
  assert.equal((await notes.context('Личный архив/Зимние каникулы.md')).start, '2026-12-28');
  assert.equal(io.files.has(path), false);
});

test('navigation ignores unrelated date-like filenames outside the canonical journal folder', async () => {
  const io = new MemoryIO(); const notes = new NotesService(io);
  io.files.set('Архив/2026.md', '# Заметки о книгах\n\nЛичный текст');
  io.files.set('31-12-2026.md', '# Чужая заметка по дате');
  const year = await notes.ensurePeriod('year', '2026-12-31');
  const day = await notes.ensurePeriod('day', '2026-12-31');
  assert.equal(year, 'Planner/Journal/Yearly/2026.md');
  assert.equal(day, 'Planner/Journal/Daily/31.12.2026.md');
  assert.equal(io.files.get('Архив/2026.md'), '# Заметки о книгах\n\nЛичный текст');
  assert.equal(io.files.get('31-12-2026.md'), '# Чужая заметка по дате');
  // Explicitly inserting a widget can still resolve the filename in that note.
  assert.equal(resolveNoteContext('31-12-2026.md', '# Чужая заметка по дате').start, '2026-12-31');
});

test('valid explicit metadata overrides filename, invalid or partial metadata never falls back', () => {
  const valid = '---\nlife-planner-type: day\nlife-planner-date: 2026-12-31\n---\n';
  assert.equal(resolveNoteContext('01-10-2026.md', valid).start, '2026-12-31');
  for (const metadata of [
    'life-planner-type: day\nlife-planner-date: 2027-02-29', 'life-planner-type: day',
    'life-planner-date: 2026-12-31', 'life-planner-type: nonsense\nlife-planner-date: 2026-12-31',
    'life-planner-type: day\nlife-planner-date: 2026-12-31\nlife-planner-date: 2026-10-01',
  ]) assert.throws(() => resolveNoteContext('01-10-2026.md', `---\n${metadata}\n---\n`));
  assert.throws(() => resolveNoteContext('01-10-2026.md', '---\nlife-planner-type: day\n'));
});

test('filename fallback is strict and ISO-week aware when metadata is absent', () => {
  assert.equal(resolveNoteContext('2026-W53.md', '# Любой текст').start, '2026-12-28');
  assert.equal(resolveNoteContext('29-02-2028.md', '---\ntags: [journal]\n---').start, '2028-02-29');
  assert.equal(resolveNoteContext('2027-Q1.md', '').end, '2027-04-01');
  for (const path of ['29-02-2027.md', '2025-W53.md', 'whatever.md']) assert.throws(() => resolveNoteContext(path, ''));
});

test('custom templates affect only newly created notes and context reads never write', async () => {
  const io = new MemoryIO(); const notes = new NotesService(io); const old = await notes.ensurePeriod('day', '2026-10-01');
  const original = io.files.get(old);
  io.files.set('Planner/Templates/Daily.md', '---\nlife-planner-type: day\nlife-planner-date: {{date}}\n---\n# Личный {{date_display}}\n\n```life-planner\n```\n\nМой вечер\n');
  const next = await notes.ensurePeriod('day', '2026-10-02');
  assert.ok(io.files.get(next)!.includes('# Личный 02.10.2026')); assert.equal(io.files.get(old), original);
  const writes = io.writes.length; await notes.context(old); await notes.context(next); assert.equal(io.writes.length, writes);
});

test('duplicate metadata and occupied paths give errors without rewriting either note', async () => {
  const io = new MemoryIO(); const notes = new NotesService(io); const path = await notes.ensurePeriod('day', '2026-10-01');
  io.files.set('Other.md', io.files.get(path)!);
  const writes = io.writes.length; await assert.rejects(notes.ensurePeriod('day', '2026-10-01'), /несколько заметок/);
  assert.equal(io.writes.length, writes);
  io.files.set('Planner/Journal/Daily/02-10-2026.md', '---\nlife-planner-type: day\nlife-planner-date: broken\n---\nмой текст');
  await assert.rejects(notes.ensurePeriod('day', '2026-10-02'), /Путь занят/);
  assert.ok(io.files.get('Planner/Journal/Daily/02-10-2026.md')!.endsWith('мой текст'));
});

test('a template with missing required metadata cannot create a contextless note', async () => {
  const io = new MemoryIO(); const notes = new NotesService(io); await notes.ensureFoundation();
  io.files.set('Planner/Templates/Daily.md', '# Only text');
  await assert.rejects(notes.ensurePeriod('day', '2026-10-01'), /Шаблон/);
  assert.equal([...io.files.keys()].filter(path => path.includes('/Journal/')).length, 0);
});

test('quoted metadata and CRLF work without using the current date', () => {
  const content = '\uFEFF---\r\nlife-planner-type: "day"\r\nlife-planner-date: \'2026-12-31\' # anchor\r\n---\r\n';
  assert.equal(resolveNoteContext('Renamed.md', content).start, '2026-12-31');
});
