import test from 'node:test';
import assert from 'node:assert/strict';
import { adjacent, addDays, dates, formatDate, isLocalDate, parseDate, period, periodFromKey, today, weekday } from '../src/periods';
import { appendDefinitionVersion, areaRatingId, base, changeTask, checkinId, dayRatingId, definitionAt, localTimestamp, newCheckin, newTask, taskCategory, validateRecord, visibilityId, visibleTasks } from '../src/domain';
import { areaRatingSeries, dayRatingSeries, summarize, workoutJournal } from '../src/analytics';
import type { AreaRating, CalendarEvent, Checkin, DayRating, Definition, PlannerRecord, Visibility } from '../src/model';

function definition(type: Definition['type'] = 'morning', weekdays = [1, 2, 3, 4, 5, 6, 7]): Definition {
  return { ...base(`def-${type}`), kind: 'definition', type, versions: [{ effectiveDate: '2026-01-01', title: `Демо ${type}`, weekdays, items: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }] };
}
function filled(def: Definition, date: string, states: Record<string, boolean> = { a: true, b: true }): Checkin {
  return { ...newCheckin(def, date), states, finalized: true };
}
function rating(date: string, value: number | null): DayRating {
  return { ...base(dayRatingId(date)), kind: 'day-rating', date, value };
}

test('AC04/06: strict dates, leap days, ISO week-year and all period boundaries', () => {
  assert.equal(parseDate('29-02-2028'), '2028-02-29');
  assert.throws(() => parseDate('29-02-2027'));
  assert.throws(() => parseDate('31-04-2027'));
  assert.throws(() => parseDate('2026-10-01'));
  assert.equal(formatDate('2026-12-31'), '31.12.2026');
  assert.equal(isLocalDate('2027-02-29'), false);
  assert.equal(weekday('2026-12-28'), 1);
  assert.equal(weekday('2027-01-03'), 7);
  for (const date of dates('2026-12-28', '2027-01-04')) assert.equal(period('week', date).key, '2026-W53');
  assert.equal(period('quarter', '2027-03-31').key, '2027-Q1');
  assert.equal(period('quarter', '2027-04-01').key, '2027-Q2');
  assert.equal(adjacent(period('quarter', '2026-12-31'), 1).key, '2027-Q1');
  assert.equal(adjacent(period('month', '2026-12-31'), 1).key, '01-2027');
  assert.equal(adjacent(period('day', '2026-12-31'), 1).key, '01.01.2027');
  assert.equal(adjacent(period('year', '2026-10-01'), -1).key, '2025');
  assert.deepEqual(dates('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29']);
});

test('AC03/06: all canonical file keys roundtrip without consulting the clock', () => {
  for (const type of ['day', 'week', 'month', 'quarter', 'year'] as const) {
    const value = period(type, '2026-12-31');
    assert.deepEqual(periodFromKey(type, value.key), value);
  }
  assert.throws(() => periodFromKey('week', '2027-W53'));
  assert.throws(() => periodFromKey('week', '2026-W00'));
  assert.throws(() => periodFromKey('month', '13-2026'));
  assert.throws(() => periodFromKey('quarter', '2026-Q5'));
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
});

test('task timestamps preserve local date and explicit offset', () => {
  const instant = new Date('2026-10-01T01:23:45.123Z');
  const stamp = localTimestamp(instant);
  assert.equal(Date.parse(stamp), instant.getTime());
  assert.equal(stamp.slice(0, 10), today(instant));
  assert.match(stamp, /[+-]\d{2}:\d{2}$/);
});

test('AC12–16: flexible dates and hiding affect one task/date only, never source or totals', () => {
  const task = newTask({ title: 'A', areaId: 'home', dueDate: '2026-12-30' }, '2026-12-01T10:00:00+03:00');
  const other = newTask({ title: 'B', areaId: 'work' }, '2026-12-01T10:00:00+03:00');
  const soft = newTask({ title: 'C', areaId: 'work', plannedDate: '2026-12-30' }, '2026-12-01T10:00:00+03:00');
  const visibility: Visibility = { ...base(visibilityId(task.id, '2026-12-31')), kind: 'visibility', taskId: task.id, noteDate: '2026-12-31', hidden: true };
  assert.equal(taskCategory(task, '2026-12-31'), 'overdue');
  assert.equal(taskCategory(soft, '2026-12-31'), 'past');
  assert.equal(taskCategory(other, '2026-12-31'), 'backlog');
  assert.deepEqual(visibleTasks([task, other], [visibility], '2026-12-31').map(t => t.id), [other.id]);
  assert.equal(visibleTasks([task, other], [visibility], '2027-01-01').length, 2);
  const before = summarize(period('month', '2026-12-31'), [task, other], '2026-12-31').tasks;
  const after = summarize(period('month', '2026-12-31'), [task, other, visibility], '2026-12-31').tasks;
  assert.deepEqual(before, after);
  assert.equal(task.status, 'todo'); assert.equal(task.dueDate, '2026-12-30');
});

test('AC17: cutoff uses historical due/status/area; same-date completion is timely', () => {
  let task = newTask({ title: 'A', areaId: 'home', dueDate: '2026-12-30' }, '2026-12-01T10:00:00+03:00');
  task = changeTask(task, { dueDate: '2027-02-01', areaId: 'work' }, '2027-01-04T10:00:00+03:00');
  assert.equal(summarize(period('month', '2026-12-31'), [task], '2027-02-05').tasks.overdue, 1);
  assert.equal(summarize(period('month', '2026-12-31'), [task], '2027-02-05').tasks.byArea[0].areaId, 'home');
  let timely = newTask({ title: 'До полуночи', areaId: 'self', dueDate: '2026-12-31' }, '2026-12-30T10:00:00+03:00');
  timely = changeTask(timely, { status: 'done' }, '2026-12-31T23:00:00+03:00');
  const timelyTotals = summarize(period('month', '2026-12-31'), [timely], '2027-01-02').tasks;
  assert.equal(timelyTotals.completed, 1); assert.equal(timelyTotals.late, 0);
  let late = newTask({ title: 'После полуночи', areaId: 'self', dueDate: '2026-12-31' }, '2026-12-30T10:00:00+03:00');
  late = changeTask(late, { status: 'done' }, '2027-01-01T00:01:00+03:00');
  assert.equal(summarize(period('month', '2027-01-01'), [late], '2027-01-02').tasks.late, 1);
});

test('reopening/recompleting and repeated projections count a task once per period', () => {
  let task = newTask({ title: 'Одна задача', areaId: 'work' }, '2026-12-01T10:00:00+03:00');
  task = changeTask(task, { status: 'done' }, '2026-12-02T10:00:00+03:00');
  task = changeTask(task, { status: 'todo' }, '2026-12-03T10:00:00+03:00');
  task = changeTask(task, { status: 'done' }, '2026-12-04T10:00:00+03:00');
  assert.equal(task.history.length, 4);
  assert.equal(summarize(period('month', '2026-12-31'), [task, task], '2026-12-31').tasks.completed, 1);
  assert.throws(() => changeTask(task, { title: 'назад' }, '2026-12-01T11:00:00+03:00'));
});

test('partial/corrupt task histories cannot invent a completion date', () => {
  const original = newTask({ title: 'A', areaId: 'work' }, '2026-12-01T10:00:00+03:00');
  const done = changeTask(original, { status: 'done' }, '2026-12-02T10:00:00+03:00');
  const earlierCompletion = '2026-11-30T10:00:00+03:00';
  const altered = { ...done, completedAt: earlierCompletion, history: [done.history[0], { ...done.history[1], completedAt: earlierCompletion }] };
  assert.throws(() => validateRecord(altered));
  const edited = changeTask(done, { title: 'Переименовано' }, '2026-12-03T10:00:00+03:00');
  const fakeCompletion = '2026-12-03T10:00:00+03:00';
  const changedDate = { ...edited, completedAt: fakeCompletion, history: [...edited.history.slice(0, -1), { ...edited.history[2], completedAt: fakeCompletion }] };
  assert.throws(() => validateRecord(changedDate));
  for (const field of ['createdAt', 'history', 'title', 'areaId', 'status'] as const) {
    const partial: Record<string, unknown> = { ...original }; delete partial[field];
    assert.throws(() => validateRecord(partial));
  }
  assert.doesNotThrow(() => validateRecord(edited));
});

test('AC21: ratings use observations, null missing and future excluded', () => {
  const records = [rating('2026-12-01', 70), rating('2026-12-02', 90), rating('2026-12-03', null), rating('2026-12-31', 1)];
  const result = summarize(period('month', '2026-12-01'), records, '2026-12-03').dayRatings;
  assert.deepEqual(result, { mean: 80, count: 2, expected: 3, missing: 1 });
  assert.equal(summarize(period('year', '2026-01-01'), [], '2026-12-31').dayRatings.mean, null);
  assert.deepEqual(summarize(period('month', '2027-02-01'), records, '2026-12-03').dayRatings, { mean: null, count: 0, expected: 0, missing: 0 });
});

test('M4.1: daily rating series keeps null observations and excludes future dates', () => {
  const points = dayRatingSeries(period('week', '2026-12-28'), [rating('2026-12-28', 70), rating('2026-12-29', null), rating('2026-12-30', 90), rating('2026-12-31', 40)], '2026-12-30');
  assert.deepEqual(points, [{ date: '2026-12-28', value: 70 }, { date: '2026-12-29', value: null }, { date: '2026-12-30', value: 90 }]);
  assert.deepEqual(dayRatingSeries(period('month', '2027-02-01'), [], '2026-12-30'), []);
});

test('AC22: boundary week belongs once, by Sunday, preserving original area label', () => {
  const area: AreaRating = { ...base(areaRatingId('2026-12-28', 'former-area')), kind: 'area-rating', weekStart: '2026-12-28', areaId: 'former-area', areaTitle: 'Старая сфера', value: 7, policyVersion: 1 };
  validateRecord(area);
  assert.equal(summarize(period('month', '2026-12-01'), [area], '2027-02-01').legacyAreaRatings.length, 0);
  assert.deepEqual(summarize(period('month', '2027-01-01'), [area], '2027-02-01').legacyAreaRatings, [{ areaId: 'former-area', areaTitle: 'Старая сфера', mean: 7, count: 1 }]);
});

test('M4.2: area-rating series uses Sunday, keeps the historical title and excludes future weeks', () => {
  const old: AreaRating = { ...base(areaRatingId('2026-12-21', 'former-area')), kind: 'area-rating', weekStart: '2026-12-21', areaId: 'former-area', areaTitle: 'Старая сфера', value: 7, policyVersion: 1 };
  const future: AreaRating = { ...base(areaRatingId('2026-12-28', 'former-area')), kind: 'area-rating', weekStart: '2026-12-28', areaId: 'former-area', areaTitle: 'Новая сфера', value: 9, policyVersion: 1 };
  assert.deepEqual(areaRatingSeries(period('month', '2026-12-01'), [old, future], '2026-12-27'), [{ date: '2026-12-27', areaId: 'former-area', areaTitle: 'Старая сфера', value: 7 }]);
  assert.deepEqual(areaRatingSeries(period('month', '2027-01-01'), [future], '2026-12-31'), []);
});

test('AC23: habits use elapsed scheduled days with missed and unrecorded distinct', () => {
  const def = definition('habit', [1, 3]);
  const monday = filled(def, '2026-12-28');
  const result = summarize(period('week', '2026-12-28'), [def, monday], '2026-12-30').habits[0];
  assert.equal(result.percent, 50); assert.equal(result.planned, 2); assert.equal(result.done, 1);
  assert.equal(result.missed, 0); assert.equal(result.unrecorded, 1); assert.equal(result.fullness, 50);
  const explicitMiss = filled(def, '2026-12-30', { a: false, b: false });
  assert.equal(summarize(period('week', '2026-12-28'), [def, monday, explicitMiss], '2026-12-30').habits[0].missed, 1);
  assert.throws(() => newCheckin(def, '2026-12-29'));
});

test('AC24: new items start on effective date; snapshots survive renaming/removal', () => {
  const def = definition();
  const old = filled(def, '2026-12-31');
  def.versions.push({ effectiveDate: '2027-01-01', title: 'Переименован', weekdays: [1, 2, 3, 4, 5, 6, 7], items: [{ id: 'c', title: 'C' }] });
  const fresh = filled(def, '2027-01-01', { c: true });
  assert.equal(definitionAt(def, '2025-12-31'), undefined);
  assert.deepEqual(old.items.map(i => i.id), ['a', 'b']);
  assert.deepEqual(fresh.items.map(i => i.id), ['c']);
  const result = summarize(period('week', '2026-12-31'), [def, old, fresh], '2027-01-01').routines[0];
  assert.equal(result.done, 3); assert.equal(result.missed, 0); assert.equal(result.percent, 100);
});

test('M3.1: editing appends a version, keeps retained IDs, and cannot alter a saved check-in', () => {
  const def = definition();
  const before = filled(def, '2026-12-31');
  const next = appendDefinitionVersion(def, { effectiveDate: '2027-01-01', title: 'Переименованная рутина', weekdays: [1, 2, 3, 4, 5, 6, 7], items: [{ id: 'a', title: 'Переименованный A' }, { id: 'new-item', title: 'Новый пункт' }] });
  assert.equal(def.versions.length, 1);
  assert.equal(next.versions.length, 2);
  assert.deepEqual(next.versions[1].items.map(item => item.id), ['a', 'new-item']);
  assert.deepEqual(before.items, [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
  assert.equal(newCheckin(next, '2027-01-01').items[0].title, 'Переименованный A');
  assert.throws(() => appendDefinitionVersion(next, { ...next.versions[1], effectiveDate: '2027-01-01' }));
});

test('M3.1: archive is an empty schedule version and a later version restores the list', () => {
  const def = definition();
  const archived = appendDefinitionVersion(def, { ...def.versions[0], effectiveDate: '2027-01-01', weekdays: [] });
  assert.equal(definitionAt(archived, '2027-01-01')?.weekdays.length, 0);
  assert.throws(() => newCheckin(archived, '2027-01-01'));
  const restored = appendDefinitionVersion(archived, { ...archived.versions[1], effectiveDate: '2027-01-02', weekdays: [1, 2, 3, 4, 5, 6, 7] });
  assert.equal(newCheckin(restored, '2027-01-02').items[0].id, 'a');
});

test('AC25: routine total includes perfect items while detail shows only misses', () => {
  const def = definition();
  const checkins = dates('2026-12-21', '2026-12-28').map((date, index) => filled(def, date, { a: true, b: index !== 6 }));
  const result = summarize(period('week', '2026-12-21'), [def, ...checkins], '2026-12-28').routines[0];
  assert.equal(result.done, 13); assert.equal(result.missed, 1); assert.equal(result.percent, 100 * 13 / 14);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].itemId, 'b');
  assert.equal(result.items[0].percent, 100 * 6 / 7); assert.equal(result.items[0].missedDays, 1);
});

test('AC26: draft/open/missing day is not a miss and fullness is separate', () => {
  const def = definition();
  const checkins = dates('2026-12-21', '2026-12-27').map(date => filled(def, date));
  const draft = newCheckin(def, '2026-12-27');
  assert.equal(draft.id, checkinId(def.id, '2026-12-27'));
  const result = summarize(period('week', '2026-12-21'), [def, ...checkins, draft], '2026-12-28').routines[0];
  assert.equal(result.percent, 100); assert.equal(result.filledDays, 6); assert.equal(result.noDataDays, 1);
  assert.equal(result.plannedDays, 7); assert.equal(result.missed, 0); assert.equal(result.fullness, 100 * 6 / 7);
  const empty = summarize(period('week', '2026-12-21'), [def], '2026-12-28').routines[0];
  assert.equal(empty.percent, null); assert.equal(empty.noDataDays, 7); assert.equal(empty.fullness, 0);
});

test('AC27/28: below100 filter uses unrounded counts and yearly totals use source items', () => {
  const def = definition();
  def.versions[0].items = [{ id: 'a', title: 'A' }];
  const checkins = dates('2026-01-01', addDays('2026-01-01', 250)).map((date, i) => filled(def, date, { a: i > 0 }));
  const result = summarize(period('year', '2026-01-01'), [def, ...checkins], '2026-12-31').routines[0];
  assert.equal(result.percent, 99.6); assert.equal(result.items.length, 1); assert.equal(result.items[0].missedDays, 1);
  assert.equal(result.noDataDays, 115);
});

test('AC30: workout history retains snapshot/comment and only confirmed sessions counted', () => {
  const def = definition('workout');
  const session = { ...filled(def, '2026-12-01'), comment: 'Мой комментарий' };
  def.versions.push({ effectiveDate: '2026-12-02', title: 'Новая программа', weekdays: [1, 2, 3, 4, 5, 6, 7], items: [{ id: 'c', title: 'Другое' }] });
  const draft = newCheckin(def, '2026-12-02');
  validateRecord(session); assert.equal(session.items[0].title, 'A'); assert.equal(session.comment, 'Мой комментарий');
  assert.equal(summarize(period('month', '2026-12-01'), [def, session, draft], '2026-12-31').workouts.count, 1);
});

test('M3.2: workout journal is newest-first, uses session snapshots and excludes drafts', () => {
  const def = definition('workout');
  const old = { ...filled(def, '2026-12-30'), comment: 'Старый комментарий' };
  const changed = appendDefinitionVersion(def, { effectiveDate: '2026-12-31', title: 'Новая программа', weekdays: [1, 2, 3, 4, 5, 6, 7], items: [{ id: 'c', title: 'Новое упражнение' }] });
  const recent = { ...filled(changed, '2026-12-31', { c: false }), comment: '' };
  const draft = newCheckin(changed, '2027-01-01');
  const journal = workoutJournal(period('week', '2026-12-31'), [changed, old, recent, draft], '2027-01-02');
  assert.deepEqual(journal.map(entry => [entry.date, entry.title, entry.items[0].title, entry.comment]), [['2026-12-31', 'Новая программа', 'Новое упражнение', ''], ['2026-12-30', 'Демо workout', 'A', 'Старый комментарий']]);
  assert.equal(journal[0].states.c, false);
  assert.equal(journal.some(entry => entry.date === '2027-01-01'), false);
});

test('AC10/35: corrupt records, duplicate identity, invalid nested dates/state are rejected', () => {
  const event: CalendarEvent = { ...base('event-test'), kind: 'event', title: 'Врач', start: '2026-12-31T10:00', end: '2026-12-31T11:00', allDay: false, timezone: 'Europe/Moscow', areaId: 'self' };
  const def = definition();
  const task = newTask({ title: 'A', areaId: 'work' }, '2026-12-01T10:00:00+03:00');
  const valid: PlannerRecord[] = [task, event, def, filled(def, '2026-12-01'), rating('2026-12-01', 70)];
  for (const record of valid) assert.doesNotThrow(() => validateRecord(JSON.parse(JSON.stringify(record))));
  const corrupt: unknown[] = [null, [], {}, { ...task, schemaVersion: 99 }, { ...task, id: '../escape' }, { ...task, version: -1 }, { ...task, history: [] }, { ...task, title: 'different from history' }, { ...task, status: ['todo'] }, { ...event, start: '2027-02-29T10:00' }, { ...event, end: event.start }, { ...event, end: '2026-12-31T10:00:00' }, { ...event, timezone: 'Bad/Zone' }, { ...rating('2026-12-01', 70), id: 'duplicate-other' }, rating('2026-12-01', 0), rating('2026-12-01', 101), { ...filled(def, '2026-12-01'), states: { a: 'yes' } }, { ...filled(def, '2026-12-01'), states: { unknown: true } }, { ...def, versions: [...def.versions, ...def.versions] }];
  for (const record of corrupt) assert.throws(() => validateRecord(record));
});
