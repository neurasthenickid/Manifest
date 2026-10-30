import test from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEvent, EventFields } from '../src/model';
import { base, validateRecord } from '../src/domain';
import { changeEventOccurrence, changeEventSeries, eventFields, occurrences, occurrenceFor, resetEventOccurrence } from '../src/recurrence';

function event(patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return { ...base('series'), schemaVersion: 2, kind: 'event', title: 'Занятие', areaId: 'self', timezone: 'Europe/Moscow',
    start: '2026-12-31T10:00', end: '2026-12-31T11:00', allDay: false, recurrence: { frequency: 'weekly', until: '2027-01-14' }, ...patch };
}
const fields = (e: CalendarEvent, patch: Partial<EventFields>): EventFields => ({ ...eventFields(e), ...patch });

test('AC11 weekly year boundary and inclusive until use stable derived identities', () => {
  const e = event(), before = structuredClone(e);
  const cases = occurrences([e], '2026-12-28', '2027-01-22');
  assert.deepEqual(cases.map(c => c.start), ['2026-12-31T10:00', '2027-01-07T10:00', '2027-01-14T10:00']);
  assert.deepEqual(cases.map(c => c.key), ['series@2026-12-31', 'series@2027-01-07', 'series@2027-01-14']);
  assert(cases.every(c => c.eventId === e.id && c.sourceVersion === e.version && !('kind' in c)));
  assert.deepEqual(e, before);
});
test('daily leap day and year boundaries preserve wall clock and overnight duration', () => {
  const e = event({ start: '2028-02-28T23:30', end: '2028-02-29T00:30', recurrence: { frequency: 'daily', until: '2028-03-01' } });
  assert.deepEqual(occurrences([e], '2028-02-28', '2028-03-02').map(c => [c.start, c.end]), [
    ['2028-02-28T23:30', '2028-02-29T00:30'], ['2028-02-29T23:30', '2028-03-01T00:30'], ['2028-03-01T23:30', '2028-03-02T00:30']]);
  const year = event({ start: '2026-12-31T23:00', end: '2027-01-01T01:00', recurrence: { frequency: 'daily', until: '2027-01-01' } });
  assert.equal(occurrenceFor(year, '2027-01-01')?.end, '2027-01-02T01:00');
});
test('weekdays skip weekend and reject a weekend anchor', () => {
  const e = event({ start: '2027-01-01T10:00', end: '2027-01-01T11:00', recurrence: { frequency: 'weekdays', until: '2027-01-05' } });
  assert.deepEqual(occurrences([e], '2027-01-01', '2027-01-06').map(c => c.originalDate), ['2027-01-01', '2027-01-04', '2027-01-05']);
  assert.throws(() => validateRecord({ ...e, start: '2027-01-02T10:00', end: '2027-01-02T11:00' }), /Пн–Пт/);
});
test('wall times across DST are identical in different device time zones', () => {
  const e = event({ start: '2027-03-27T10:00', end: '2027-03-27T11:30', timezone: 'Europe/Berlin', recurrence: { frequency: 'daily' } });
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles'; const a = occurrences([e], '2027-03-27', '2027-03-30');
    process.env.TZ = 'Asia/Tokyo'; const b = occurrences([e], '2027-03-27', '2027-03-30');
    assert.deepEqual(a, b); assert(a.every(c => c.start.endsWith('T10:00') && c.end.endsWith('T11:30')));
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test('moved occurrence suppresses its original and retains originalDate/key across periods', () => {
  const e = event(), moved = changeEventOccurrence(e, '2027-01-07', fields(e, { start: '2027-02-09T12:00', end: '2027-02-09T13:00', title: 'Перенесено' }));
  assert.deepEqual(occurrences([moved], '2027-01-01', '2027-02-01').map(c => c.originalDate), ['2027-01-14']);
  const feb = occurrences([moved], '2027-02-01', '2027-03-01');
  assert.equal(feb.length, 1); assert.equal(feb[0].key, 'series@2027-01-07'); assert.equal(feb[0].title, 'Перенесено');
  assert.equal(e.exceptions, undefined);
});
test('two originals moved to the same instant remain distinct while repeat edits replace one key', () => {
  let e = event(); const patch = fields(e, { start: '2027-02-09T12:00', end: '2027-02-09T13:00' });
  e = changeEventOccurrence(e, '2027-01-07', patch); e = changeEventOccurrence(e, '2027-01-14', patch);
  e = changeEventOccurrence(e, '2027-01-07', { ...patch, title: 'Правка' });
  const cases = occurrences([e], '2027-02-09', '2027-02-10');
  assert.equal(cases.length, 2); assert.equal(new Set(cases.map(c => c.key)).size, 2); assert.equal(Object.keys(e.exceptions!).length, 2);
});
test('case deletion and reset preserve the other cases; series deletion suppresses all overrides', () => {
  const original = event(), deleted = changeEventOccurrence(original, '2027-01-07', null);
  assert.equal(occurrenceFor(deleted, '2027-01-07'), undefined);
  assert.equal(occurrences([deleted], '2026-12-28', '2027-01-22').length, 2);
  assert.equal(occurrences([resetEventOccurrence(deleted, '2027-01-07')], '2026-12-28', '2027-01-22').length, 3);
  assert.deepEqual(occurrences([{ ...deleted, deleted: true }], '2026-12-28', '2027-01-22'), []);
});
test('series fields affect normal instances while full exception snapshots remain independent', () => {
  const original = event(), changed = changeEventOccurrence(original, '2027-01-07', fields(original, { start: '2027-01-09T09:00', end: '2027-01-09T10:00', title: 'Мой случай' }));
  const series = changeEventSeries(changed, fields(changed, { title: 'Серия', start: '2026-12-31T14:00', end: '2026-12-31T16:00' }), changed.recurrence);
  assert.equal(occurrenceFor(series, '2027-01-07')?.title, 'Мой случай'); assert.equal(occurrenceFor(series, '2027-01-14')?.start, '2027-01-14T14:00');
  assert.deepEqual(series.exceptions, changed.exceptions);
});
test('series anchor/rule/until/removal changes require explicit reset; schema2 never auto downgrades', () => {
  const e = changeEventOccurrence(event(), '2027-01-07', null);
  for (const rule of [{ frequency: 'daily' as const }, { frequency: 'weekly' as const, until: '2027-01-21' }, undefined]) assert.throws(() => changeEventSeries(e, e, rule), /Подтвердите сброс/);
  assert.throws(() => changeEventSeries(e, fields(e, { start: '2027-01-01T10:00', end: '2027-01-01T11:00' }), e.recurrence), /Подтвердите сброс/);
  const once = changeEventSeries(e, e, undefined, true); validateRecord(once); assert.equal(once.schemaVersion, 2); assert.equal(once.exceptions, undefined); assert.equal(once.recurrence, undefined);
});
test('ordinary schema1 event upgrades only when recurrence is enabled with unchanged ID/revision', () => {
  const once = event({ schemaVersion: 1, recurrence: undefined }); validateRecord(once);
  const repeat = changeEventSeries(once, once, { frequency: 'daily' }); validateRecord(repeat);
  assert.equal(repeat.id, once.id); assert.equal(repeat.version, once.version); assert.equal(repeat.schemaVersion, 2);
  assert.equal(changeEventSeries(once, once, undefined).schemaVersion, 1);
});
test('strict recurrence schema rejects unsupported kinds, malformed rules and invalid exception dates', () => {
  for (const patch of [
    { schemaVersion: 1 }, { schemaVersion: 99 }, { recurrence: { frequency: 'monthly' } },
    { recurrence: { frequency: 'daily', until: '2026-12-30' } }, { recurrence: { frequency: 'daily', until: '2027-02-29' } },
    { recurrence: { frequency: 'weekly', interval: 2 } }, { exceptions: { '2027-01-08': { deleted: true } } },
    { exceptions: { '2027-01-21': { deleted: true } } }, { exceptions: { 'bad': { deleted: true } } },
    { exceptions: { '2027-01-07': { deleted: 'true' } } }, { exceptions: { '2027-01-07': { deleted: true, fields: {} } } },
    { exceptions: { '2027-01-07': { deleted: false, fields: { ...eventFields(event()), id: 'injected' } } } },
    { recurrence: undefined, exceptions: {} },
  ]) assert.throws(() => validateRecord({ ...event(), ...patch }));
  assert.throws(() => validateRecord({ ...base('day-rating-2027-01-01'), schemaVersion: 2, kind: 'day-rating', date: '2027-01-01', value: 50 }), /схемы/);
});
test('exception interval, timezone and all-day formats are validated before mutation', () => {
  const e = event();
  for (const patch of [{ end: e.start }, { timezone: 'Invalid/Zone' }, { allDay: true }, { start: '2027-02-29T10:00' }, { start: '2027-01-07T25:00' }]) assert.throws(() => changeEventOccurrence(e, '2027-01-07', fields(e, patch)));
  assert.throws(() => changeEventOccurrence(e, '2027-01-08', e), /не входит/);
  assert.throws(() => resetEventOccurrence({ ...e, deleted: true }, '2027-01-07'), /не входит/);
});
test('multi-day all-day and overnight instances overlap half-open periods without agenda duplicates', () => {
  const e = event({ start: '2026-12-31', end: '2027-01-03', allDay: true });
  assert.equal(occurrences([e], '2027-01-02', '2027-01-03').length, 1);
  assert.equal(occurrences([e], '2027-01-03', '2027-01-04').length, 0);
  assert.equal(occurrences([e], '2026-12-28', '2027-01-04').length, 1);
  const night = event({ start: '2026-12-31T23:00', end: '2027-01-01T01:00' });
  assert.equal(occurrences([night], '2027-01-01', '2027-01-02').length, 1);
  assert.equal(occurrences([{ ...night, end: '2027-01-01T00:00' }], '2027-01-01', '2027-01-02').length, 0);
});
test('ordinary event ending at the boundary is absent; seconds are compared numerically', () => {
  const e = event({ schemaVersion: 1, recurrence: undefined, start: '2026-12-31T23:00', end: '2027-01-01T00:00:00.000' });
  assert.equal(occurrences([e], '2027-01-01', '2027-01-02').length, 0);
  assert.equal(occurrences([e], '2026-12-31', '2027-01-01').length, 1);
});
test('centuries-old unbounded series queries only the requested week and dedupes source revisions', () => {
  const e = event({ start: '1000-01-01T10:00', end: '1000-01-01T11:00', recurrence: { frequency: 'daily' } });
  const cases = occurrences([e, { ...e, version: 2, title: 'Новая версия' }], '2027-01-01', '2027-01-08');
  assert.equal(cases.length, 7); assert(cases.every(c => c.title === 'Новая версия' && c.sourceVersion === 2));
});
test('output cap reports failure without silent truncation; invalid intervals and overflowing years fail', () => {
  const e = event({ start: '1000-01-01', end: '1000-01-02', allDay: true, recurrence: { frequency: 'daily' } });
  assert.throws(() => occurrences([e], '1000-01-01', '1100-01-01'), /максимум 10 000/);
  assert.throws(() => occurrences([e], '2027-01-01', '2027-01-01'), /позже/);
  assert.throws(() => occurrences([e], '2027-02-29', '2027-03-02'), /дат/);
  const end = event({ start: '9999-12-29', end: '9999-12-31', allDay: true, recurrence: { frequency: 'daily' } });
  assert.throws(() => occurrenceFor(end, '9999-12-30'), /1000–9999/);
});
