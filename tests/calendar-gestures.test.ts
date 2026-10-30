import test from 'node:test';
import assert from 'node:assert/strict';
import type { EventOccurrence } from '../src/model';
import { gestureFields, rangeFields, snapMinute, wallStamp } from '../src/ui/calendar-gestures';

const event: EventOccurrence = { title: 'Врач', areaId: 'self', timezone: 'Europe/Moscow', allDay: false, start: '2026-12-31T10:00', end: '2026-12-31T11:30', eventId: 'event', originalDate: '2026-12-31', sourceVersion: 1, key: 'event@2026-12-31' };
test('selected interval reaches midnight without losing the year boundary or device time zone', () => {
  assert.deepEqual(rangeFields('2026-12-31', 1425, 1440), { start: '2026-12-31T23:45:00.000', end: '2027-01-01T00:00:00.000' });
  assert.equal(snapMinute(608), 615);
});
test('cross-day movement preserves duration and the grabbed position, including clipped overnight segments', () => {
  const moved = gestureFields(event, 'move', '2027-01-01', 14*60+15, 15);
  assert.equal(moved.start, '2027-01-01T14:00:00.000'); assert.equal(moved.end, '2027-01-01T15:30:00.000');
  const night = { ...event, start: '2026-12-31T23:00', end: '2027-01-01T02:00' };
  assert.equal(gestureFields(night, 'move', '2027-01-02', 60, 120).start, '2027-01-01T23:00:00.000');
});
test('resize changes only the end and cannot make a nonpositive interval', () => {
  const resized = gestureFields(event, 'resize', '2026-12-31', 12*60, 0);
  assert.equal(resized.start, '2026-12-31T10:00:00.000'); assert.equal(resized.end, '2026-12-31T12:00:00.000');
  assert.equal(gestureFields(event, 'resize', '2026-12-31', 9*60, 0).end, '2026-12-31T10:15:00.000');
});
test('gesture results refuse unsupported years rather than wrapping to a different date', () => {
  assert.throws(() => rangeFields('9999-12-31', 1425, 1440), /дат/);
  assert.throws(() => wallStamp(Date.parse('0999-12-31T23:00Z')), /дат/);
  assert.throws(() => rangeFields('2027-02-29', 600, 660), /дат/);
});
