import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordStore, type FileIO } from '../src/storage';
import type { CalendarEvent, DayRating, DailyAreaRating } from '../src/model';
import { base, dailyAreaRatingId } from '../src/domain';
import { changeEventOccurrence, changeEventSeries, occurrences } from '../src/recurrence';

class MemoryIO implements FileIO {
  files = new Map<string, string>();
  writes: string[] = [];
  failWrite: (path: string) => boolean = () => false;
  truncateWrite: (path: string) => boolean = () => false;
  failList = false;
  beforeReplace?: () => void;
  async read(path: string): Promise<string | null> { return this.files.get(path) ?? null; }
  async write(path: string, text: string): Promise<void> {
    if (this.failWrite(path)) throw new Error('injected write failure');
    this.writes.push(path);
    this.files.set(path, this.truncateWrite(path) ? text.slice(0, 12) : text);
  }
  async create(path: string, text: string): Promise<boolean> { if (this.files.has(path)) return false; await this.write(path, text); return true; }
  async replace(path: string, expected: string, text: string): Promise<void> {
    this.beforeReplace?.();
    if (this.files.get(path) !== expected) throw new Error('injected CAS conflict');
    await this.write(path, text);
  }
  async list(prefix: string): Promise<string[]> {
    if (this.failList) throw new Error('injected directory failure');
    return [...this.files.keys()].filter(path => !prefix || path.startsWith(`${prefix}/`));
  }
  async mkdir(_path: string): Promise<void> {}
}
function rating(date = '2026-10-01'): DayRating {
  return { kind: 'day-rating', schemaVersion: 1, id: `day-rating-${date}`, date, value: 70, version: 0, updatedAt: '2026-10-01T12:00:00.000Z' };
}
const source = 'Planner/Data/records/day-rating-2026-10-01.json';
test('Daily area records save/reload by date and area and retain a verified previous value',async()=>{
  const io=new MemoryIO(),store=new RecordStore(io);await store.load();
  const record:DailyAreaRating={...base(dailyAreaRatingId('2026-10-01','family')),kind:'daily-area-rating',date:'2026-10-01',areaId:'family',areaTitle:'Семья',value:6,policyVersion:2};
  const first=await store.save(record,0),second=await store.save({...first,value:8},first.version);
  const copies=await store.backups(record.id);assert.equal(copies.length,1);assert.equal(JSON.parse(io.files.get(copies[0])!).value,6);
  const reopened=new RecordStore(io);await reopened.load();assert.equal(reopened.issues.length,0);assert.deepEqual(reopened.get(record.id),second);assert.equal(reopened.all('daily-area-rating').length,1);assert.equal(reopened.all('area-rating').length,0);
});
async function setup(): Promise<{io: MemoryIO; store: RecordStore; saved: DayRating}> {
  const io = new MemoryIO(); const store = new RecordStore(io); await store.load();
  const saved = await store.save(rating(), 0);
  return { io, store, saved };
}

test('records survive reload with stable ID/version and verified previous-version backups', async () => {
  const { io, store, saved } = await setup();
  const second = await store.save({ ...saved, value: 90 }, saved.version);
  assert.equal(second.version, 2);
  const backups = await store.backups(saved.id);
  assert.equal(backups.length, 1);
  assert.equal(JSON.parse(io.files.get(backups[0]!)!).value, 70);
  const reopened = new RecordStore(io); await reopened.load();
  assert.deepEqual(reopened.get(saved.id), second);
  assert.equal(reopened.all('day-rating').length, 1);
  const detached = reopened.get(saved.id) as DayRating; detached.value = 1;
  assert.equal((reopened.get(saved.id) as DayRating).value, 90);
});

test('serialized simultaneous saves reject a stale expected version', async () => {
  const { store, saved } = await setup();
  const results = await Promise.allSettled([store.save({ ...saved, value: 80 }, 1), store.save({ ...saved, value: 90 }, 1)]);
  assert.equal(results[0]!.status, 'fulfilled'); assert.equal(results[1]!.status, 'rejected');
  assert.equal((store.get(saved.id) as DayRating).value, 80);
  await assert.rejects(store.save({ ...saved, value: 90 }, 1), /Конфликт версий/);
});

test('raw disk comparison catches changes even when the other writer keeps the version', async () => {
  const { io, store, saved } = await setup();
  const external = `${JSON.stringify({ ...saved, value: 10 })}\n`; io.files.set(source, external);
  await assert.rejects(store.save({ ...saved, value: 90 }, 1), /изменён вне/);
  assert.equal(io.files.get(source), external);
  await store.reload(); assert.equal((store.get(saved.id) as DayRating).value, 10);
});

test('corrupt records are visible as issues and never become saveable empty defaults', async () => {
  const io = new MemoryIO(); io.files.set(source, '{incomplete');
  const store = new RecordStore(io); await store.load();
  assert.equal(store.get(rating().id), undefined); assert.equal(store.issues.length, 1);
  await assert.rejects(store.save(rating(), 0), /повреждена/);
  assert.equal(io.files.get(source), '{incomplete'); assert.equal(io.writes.length, 0);
});

test('host compare-and-swap rejects an edit arriving after the final read and preserves that edit', async () => {
  const { io, store, saved } = await setup();
  const external = JSON.stringify({ ...saved, value: 10 });
  io.beforeReplace = () => { io.files.set(source, external); };
  await assert.rejects(store.save({ ...saved, value: 90 }, 1), /CAS conflict/);
  assert.equal(io.files.get(source), external);
  assert.equal((store.get(saved.id) as DayRating).value, 70);
  io.beforeReplace = undefined; await store.reload();
  assert.equal((store.get(saved.id) as DayRating).value, 10);
});

test('future formats and mismatched source IDs are reported without migration or writes', async () => {
  const io = new MemoryIO();
  io.files.set(source, JSON.stringify({ ...rating(), version: 1, schemaVersion: 99 }));
  io.files.set('Planner/Data/records/wrong-id.json', JSON.stringify({ ...rating(), version: 1 }));
  const store = new RecordStore(io); await store.load();
  assert.equal(store.issues.length, 2); assert.equal(store.all('day-rating').length, 0);
  await assert.rejects(store.save(rating(), 0), /повреждена/);
  assert.equal(io.writes.length, 0);
});

test('failed write stays a failure, keeps cached prior version and requires reload before retry', async () => {
  const { io, store, saved } = await setup(); io.failWrite = path => path === source;
  await assert.rejects(store.save({ ...saved, value: 90 }, 1), /Не удалось подтвердить/);
  assert.equal((store.get(saved.id) as DayRating).value, 70); assert.equal(store.issues.length, 1);
  io.failWrite = () => false;
  await assert.rejects(store.save({ ...saved, value: 90 }, 1), /повреждена/);
  await store.reload(); await store.save({ ...saved, value: 90 }, 1);
  assert.equal((store.get(saved.id) as DayRating).value, 90);
});

test('truncated write is detected and explicit restore preserves the damaged original', async () => {
  const { io, store, saved } = await setup(); io.truncateWrite = path => path === source;
  await assert.rejects(store.save({ ...saved, value: 90 }, 1), /Не удалось подтвердить/);
  const damaged = io.files.get(source); assert.notEqual(damaged, undefined);
  await store.reload(); assert.equal(store.get(saved.id), undefined);
  const backups = await store.backups(saved.id); assert.equal(backups.length, 1);
  io.truncateWrite = () => false; await store.recover(saved.id, backups[0]!);
  assert.equal((store.get(saved.id) as DayRating).value, 70); assert.equal(store.issues.length, 0);
  assert.equal(store.get(saved.id)!.version, 3);
  await assert.rejects(store.save({ ...saved, value: 80, version: 2 }, 2), /Конфликт версий/);
  const preserved = [...io.files.entries()].filter(([path]) => path.startsWith('Planner/Data/recovery-originals/'));
  assert.equal(preserved.length, 1); assert.equal(preserved[0]![1], damaged);
  const reloaded = new RecordStore(io); await reloaded.load();
  assert.equal((reloaded.get(saved.id) as DayRating).value, 70);
});

test('recovery rejects a different ID, path traversal and an invalid backup before touching source', async () => {
  const { io, store, saved } = await setup(); const original = io.files.get(source);
  await assert.rejects(store.recover(saved.id, 'Planner/Data/backups/other/valid.json'), /не принадлежит/);
  await assert.rejects(store.recover(saved.id, `Planner/Data/backups/${saved.id}/../invalid.json`), /не принадлежит/);
  const invalid = `Planner/Data/backups/${saved.id}/invalid.json`; io.files.set(invalid, '{}');
  await assert.rejects(store.recover(saved.id, invalid));
  assert.equal(io.files.get(source), original);
  assert.equal([...io.files.keys()].filter(path => path.includes('recovery-originals')).length, 0);
});

test('backup failure prevents the source update', async () => {
  const { io, store, saved } = await setup(); const original = io.files.get(source);
  io.failWrite = path => path.includes('/backups/');
  await assert.rejects(store.save({ ...saved, value: 90 }, 1), /injected write failure/);
  assert.equal(io.files.get(source), original); assert.equal((store.get(saved.id) as DayRating).value, 70);
});

test('unconfirmed backup contents prevent the source update', async () => {
  const { io, store, saved } = await setup(); const original = io.files.get(source);
  io.truncateWrite = path => path.includes('/backups/');
  await assert.rejects(store.save({ ...saved, value: 90 }, 1), /Резервная копия/);
  assert.equal(io.files.get(source), original);
});

test('persistent exclusive-create collisions stop without changing the source', async () => {
  const { io, store, saved } = await setup(); const original = io.files.get(source);
  let attempts = 0;
  io.create = async () => { attempts++; return false; };
  await assert.rejects(store.save({ ...saved, value: 90 }, 1), /уникальную резервную копию/);
  assert.equal(attempts, 32); assert.equal(io.files.get(source), original);
});

test('failed directory scan disables writes until a successful complete reload', async () => {
  const { io, store, saved } = await setup(); assert.equal(store.ready, true); io.failList = true;
  await assert.rejects(store.reload(), /directory failure/);
  assert.equal(store.ready, false);
  await assert.rejects(store.save({ ...saved, value: 90 }, 1), /не загружено/);
  io.failList = false; await store.reload(); assert.equal(store.ready, true); await store.save({ ...saved, value: 90 }, 1);
  assert.equal((store.get(saved.id) as DayRating).value, 90);
});

test('a newly constructed store is not ready before its first successful load', async () => {
  const store = new RecordStore(new MemoryIO());
  assert.equal(store.ready, false); await store.load(); assert.equal(store.ready, true);
});

test('invalid payloads and unsafe IDs never write files', async () => {
  const io = new MemoryIO(); const store = new RecordStore(io); await store.load();
  await assert.rejects(store.save({ ...rating(), value: 101 }, 0));
  await assert.rejects(store.save({ ...rating(), id: '../outside' }, 0));
  assert.equal(io.writes.length, 0);
});

test('subscriber errors do not misreport a verified save and unsubscribe removes callbacks', async () => {
  const io = new MemoryIO(); const store = new RecordStore(io); await store.load(); let calls = 0;
  const remove = store.subscribe(() => { calls++; throw new Error('view failed'); });
  const saved = await store.save(rating(), 0); remove(); await store.save({ ...saved, value: 80 }, 1);
  assert.equal(calls, 1); assert.equal(store.issues.length, 0);
});

function once(): CalendarEvent {
  return { ...base('calendar'), kind: 'event', title: 'Врач', areaId: 'self', allDay: false, timezone: 'Europe/Moscow', start: '2026-12-31T10:00', end: '2026-12-31T11:00' };
}
async function calendarSetup() {
  const io = new MemoryIO(), store = new RecordStore(io); await store.load();
  const saved = await store.save(once(), 0), path = 'Planner/Data/records/calendar.json';
  return { io, store, saved, path };
}
test('schema1 event upgrades one ID with a verified backup; schema2 cases survive reload without files per instance', async () => {
  const { io, store, saved } = await calendarSetup();
  const series = await store.save(changeEventSeries(saved, saved, { frequency: 'weekly', until: '2027-01-14' }), saved.version);
  assert.equal(series.schemaVersion, 2); assert.equal(series.id, saved.id);
  const backups = await store.backups(series.id); assert.equal(JSON.parse(io.files.get(backups[0])!).schemaVersion, 1);
  const moved = await store.save(changeEventOccurrence(series, '2027-01-07', { ...series, start: '2027-01-09T10:00', end: '2027-01-09T11:00' }), series.version);
  const reopened = new RecordStore(io); await reopened.load();
  assert.equal(reopened.issues.length, 0); assert.deepEqual(reopened.get(series.id), moved);
  assert.equal(reopened.all('event').length, 1);
  assert.equal([...io.files.keys()].filter(p => p.startsWith('Planner/Data/records/')).length, 1);
  assert.deepEqual(occurrences(reopened.all('event'), '2026-12-28', '2027-01-22').map(c => c.originalDate), ['2026-12-31', '2027-01-07', '2027-01-14']);
});
test('simultaneous case/series forms conflict without erasing the already saved exception', async () => {
  const { store, saved } = await calendarSetup();
  const series = await store.save(changeEventSeries(saved, saved, { frequency: 'weekly' }), saved.version);
  const results = await Promise.allSettled([
    store.save(changeEventOccurrence(series, '2027-01-07', null), series.version),
    store.save(changeEventSeries(series, { ...series, title: 'Другая форма' }, series.recurrence), series.version),
  ]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  const current = store.get(series.id) as CalendarEvent;
  assert.equal(current.title, series.title); assert.deepEqual(current.exceptions?.['2027-01-07'], { deleted: true });
});
test('ordinary downgrade is rejected; explicit recovery preserves schema2 source and invalidates stale forms', async () => {
  const { io, store, saved, path } = await calendarSetup();
  const series = await store.save(changeEventSeries(saved, saved, { frequency: 'weekly' }), saved.version);
  const original = io.files.get(path);
  await assert.rejects(store.save({ ...series, schemaVersion: 1, recurrence: undefined, exceptions: undefined }, series.version), /Понижение схемы/);
  assert.equal(io.files.get(path), original);
  await store.recover(series.id, (await store.backups(series.id))[0]);
  assert.equal(store.get(series.id)!.schemaVersion, 1); assert.equal(store.get(series.id)!.version, 3);
  assert([...io.files.entries()].some(([p, raw]) => p.includes('/recovery-originals/') && raw === original));
  await assert.rejects(store.save({ ...series, title: 'Старая форма' }, series.version), /Конфликт версий/);
});
test('invalid recurrence or unsupported schema cannot modify a canonical event or produce a backup', async () => {
  const { io, store, saved, path } = await calendarSetup(); const original = io.files.get(path), writes = io.writes.length;
  for (const patch of [{ schemaVersion: 99 }, { schemaVersion: 1, recurrence: { frequency: 'daily' } }, { schemaVersion: 2, recurrence: { frequency: 'monthly' } }]) {
    await assert.rejects(store.save({ ...saved, ...patch } as CalendarEvent, saved.version));
  }
  assert.equal(io.files.get(path), original); assert.equal(io.writes.length, writes); assert.equal((await store.backups(saved.id)).length, 0);
});
test('failed upgrade backup leaves schema1 and its original bytes unchanged', async () => {
  const { io, store, saved, path } = await calendarSetup(); const original = io.files.get(path);
  io.failWrite = p => p.includes('/backups/');
  await assert.rejects(store.save(changeEventSeries(saved, saved, { frequency: 'weekly' }), saved.version), /injected write/);
  assert.equal(io.files.get(path), original); assert.equal(store.get(saved.id)!.schemaVersion, 1);
});
test('interrupted schema2 upgrade is detected and can recover schema1 before retry without duplicate IDs', async () => {
  const { io, store, saved, path } = await calendarSetup(); io.truncateWrite = p => p === path;
  await assert.rejects(store.save(changeEventSeries(saved, saved, { frequency: 'weekly' }), saved.version), /Не удалось подтвердить/);
  const damaged = io.files.get(path); await store.reload(); assert.equal(store.issues.length, 1);
  io.truncateWrite = () => false; await store.recover(saved.id, (await store.backups(saved.id))[0]);
  const recovered = store.get(saved.id) as CalendarEvent;
  await store.save(changeEventSeries(recovered, recovered, { frequency: 'weekly' }), recovered.version);
  await store.reload(); assert.equal(store.all('event').length, 1); assert.equal(store.get(saved.id)!.schemaVersion, 2);
  assert([...io.files.entries()].some(([p, raw]) => p.includes('/recovery-originals/') && raw === damaged));
});
