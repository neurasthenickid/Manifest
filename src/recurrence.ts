import type { CalendarEvent, EventFields, EventOccurrence, LocalDate, Recurrence } from './model';
import { addDays, assertLocalDate, isLocalDate, weekday } from './periods';
import {projectEventTime} from './event-time';

export const MAX_OCCURRENCES = 10_000;
const DAY = 86_400_000;
const FIELD_KEYS = ['title', 'start', 'end', 'allDay', 'timezone', 'areaId','featured'] as const;
const dayNumber = (date: string): number => Date.parse(`${date}T12:00:00Z`) / DAY;
const wallTime = (stamp: string): number => Date.parse(stamp.length === 10 ? `${stamp}T00:00:00Z` : `${stamp}Z`);
function invalid(message: string): never { throw new Error(`Некорректная запись: ${message}`); }
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)) invalid('ожидался объект события');
}
function text(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100_000) invalid(name);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) invalid('неизвестные поля повторения/исключения');
}
export function eventFields(event: EventFields): EventFields {
  return { title: event.title, start: event.start, end: event.end, allDay: event.allDay, timezone: event.timezone, areaId: event.areaId,...(event.featured===undefined?{}:{featured:event.featured}) };
}
export function validateEventFields(value: unknown): asserts value is EventFields {
  object(value); text(value.title, 'название события'); text(value.timezone, 'часовой пояс');
  if (typeof value.areaId !== 'string' || value.areaId!==''&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/.test(value.areaId)) invalid('сфера события');
  if (typeof value.allDay !== 'boolean') invalid('весь день');
  if(value.featured!==undefined&&typeof value.featured!=='boolean')invalid('избранное событие');
  try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }); } catch { invalid('часовой пояс'); }
  for (const stamp of [value.start, value.end]) {
    if (value.allDay) { if (!isLocalDate(stamp)) invalid('дата события'); }
    else if (typeof stamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(stamp) || !isLocalDate(stamp.slice(0, 10))) invalid('дата/время события');
  }
  if (wallTime(value.end as string) <= wallTime(value.start as string)) invalid('конец должен быть позже начала');
}
/** Original local date, independent of the actual date of an override. */
export function isOccurrenceDate(event: Pick<CalendarEvent, 'start' | 'recurrence'>, date: LocalDate): boolean {
  assertLocalDate(date);
  const anchor = event.start.slice(0, 10), rule = event.recurrence;
  if (!rule) return date === anchor;
  if (date < anchor || (rule.until && date > rule.until)) return false;
  switch (rule.frequency) {
    case 'daily': return true;
    case 'weekly': return (dayNumber(date) - dayNumber(anchor)) % 7 === 0;
    case 'weekdays': return weekday(date) <= 5;
    default: invalid('правило повторения');
  }
}
/** Event payload validation. Base ID/revision/timestamp are checked by validateRecord. */
export function validateEvent(value: unknown): void {
  object(value); validateEventFields(value);
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) invalid('версия схемы события');
  if (value.deleted !== undefined && typeof value.deleted !== 'boolean') invalid('удаление');
  if (value.schemaVersion === 1 && (value.recurrence !== undefined || value.exceptions !== undefined)) invalid('повторения требуют schema2');
  if (value.recurrence !== undefined) {
    object(value.recurrence); exactKeys(value.recurrence, ['frequency', 'until']);
    if (!['daily', 'weekly', 'weekdays'].includes(value.recurrence.frequency as string)) invalid('правило повторения');
    if (value.recurrence.until !== undefined && (!isLocalDate(value.recurrence.until) || value.recurrence.until < value.start.slice(0, 10))) invalid('дата окончания повторений');
    if (value.recurrence.frequency === 'weekdays' && weekday(value.start.slice(0, 10)) > 5) invalid('для повторения по будням выберите начало в Пн–Пт');
  }
  if (value.exceptions !== undefined) {
    object(value.exceptions);
    if (!value.recurrence) invalid('исключения без повторения');
    if (Object.keys(value.exceptions).length > MAX_OCCURRENCES) invalid('слишком много исключений (максимум 10 000)');
    for (const [date, exception] of Object.entries(value.exceptions)) {
      if (!isLocalDate(date) || !isOccurrenceDate(value, date)) invalid('исходная дата исключения не входит в серию');
      object(exception);
      if (exception.deleted === true) exactKeys(exception, ['deleted']);
      else {
        if (exception.deleted !== false) invalid('статус исключения');
        exactKeys(exception, ['deleted', 'fields']); object(exception.fields); exactKeys(exception.fields, FIELD_KEYS); validateEventFields(exception.fields);
      }
    }
  }
}
export const occurrenceKey = (eventId: string, originalDate: LocalDate): string => `${eventId}@${originalDate}`;
export function overlapsPeriod(fields: EventFields, start: LocalDate, end: LocalDate): boolean {
  return wallTime(fields.start) < wallTime(end) && wallTime(fields.end) > wallTime(start);
}
function shifted(event: CalendarEvent, originalDate: LocalDate): EventFields {
  const offset = dayNumber(originalDate) - dayNumber(event.start.slice(0, 10));
  return { ...eventFields(event), start: originalDate + event.start.slice(10), end: addDays(event.end.slice(0, 10), offset) + event.end.slice(10) };
}
export function occurrenceFor(event: CalendarEvent, originalDate: LocalDate): EventOccurrence | undefined {
  validateEvent(event);
  if (event.deleted || !isOccurrenceDate(event, originalDate)) return undefined;
  const exception = event.exceptions?.[originalDate];
  if (exception?.deleted) return undefined;
  const fields = exception ? eventFields(exception.fields) : shifted(event, originalDate);
  return { ...fields, eventId: event.id, originalDate, sourceVersion: event.version, key: occurrenceKey(event.id, originalDate) };
}
/** Finite, read-only projection. Moved overrides are considered even outside the seed window. */
export function occurrences(events: CalendarEvent[], start: LocalDate, end: LocalDate,displayZone?:string): EventOccurrence[] {
  assertLocalDate(start); assertLocalDate(end);
  if (end <= start) throw new Error('Конец периода должен быть позже начала.');
  const sources = new Map<string, CalendarEvent>();
  for (const event of events) if (!sources.has(event.id) || sources.get(event.id)!.version < event.version) sources.set(event.id, event);
  const result = new Map<string, EventOccurrence>();
  const put = (event: CalendarEvent, originalDate: string, fields: EventFields) => {
    if(displayZone)fields=projectEventTime(fields,displayZone);
    if (!overlapsPeriod(fields, start, end)) return;
    const key = occurrenceKey(event.id, originalDate);
    result.set(key, { ...eventFields(fields), eventId: event.id, originalDate, sourceVersion: event.version, key });
    if (result.size > MAX_OCCURRENCES) throw new Error('Слишком много случаев в периоде (максимум 10 000). Выберите меньший период.');
  };
  for (const event of sources.values()) {
    validateEvent(event);
    if (event.deleted) continue;
    if (!event.recurrence) { put(event, event.start.slice(0, 10), event); continue; }
    for (const [originalDate, exception] of Object.entries(event.exceptions ?? {})) if (!exception.deleted) put(event, originalDate, exception.fields);
    const anchor = dayNumber(event.start.slice(0, 10));
    const durationDays = dayNumber(event.end.slice(0, 10)) - anchor;
    let day = Math.max(anchor, dayNumber(start) - durationDays - 1);
    const limit = Math.min(dayNumber(end)+1, event.recurrence.until ? dayNumber(event.recurrence.until) + 1 : Infinity);
    if (event.recurrence.frequency === 'weekly') day = anchor + Math.ceil((day - anchor) / 7) * 7;
    for (; day < limit; day += event.recurrence.frequency === 'weekly' ? 7 : 1) {
      const originalDate = new Date(day * DAY).toISOString().slice(0, 10);
      if (event.recurrence.frequency === 'weekdays' && weekday(originalDate) > 5) continue;
      if (Object.hasOwn(event.exceptions ?? {}, originalDate)) continue;
      put(event, originalDate, shifted(event, originalDate));
    }
  }
  return [...result.values()].sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key));
}
/** Revision stays unchanged until the canonical store verifies the save. */
export function changeEventSeries(event: CalendarEvent, fields: EventFields, recurrence: Recurrence | undefined, resetExceptions = false): CalendarEvent {
  validateEvent(event); validateEventFields(fields);
  const scheduleChanged = event.start.slice(0, 10) !== fields.start.slice(0, 10) || event.recurrence?.frequency !== recurrence?.frequency || event.recurrence?.until !== recurrence?.until;
  if (scheduleChanged && Object.keys(event.exceptions ?? {}).length && !resetExceptions) throw new Error('Подтвердите сброс изменений отдельных случаев перед изменением дат или правила серии.');
  const next: CalendarEvent = { ...event, ...eventFields(fields), schemaVersion: recurrence || event.schemaVersion === 2 ? 2 : 1, recurrence: recurrence ? { ...recurrence } : undefined,
    exceptions: recurrence && !resetExceptions ? event.exceptions : undefined };
  validateEvent(next); return next;
}
export function changeEventOccurrence(event: CalendarEvent, originalDate: LocalDate, fields: EventFields | null): CalendarEvent {
  validateEvent(event);
  if (!event.recurrence || event.deleted || !isOccurrenceDate(event, originalDate)) throw new Error('Случай не входит в активную серию.');
  if (fields) validateEventFields(fields);
  const next: CalendarEvent = { ...event, exceptions: { ...event.exceptions, [originalDate]: fields ? { deleted: false, fields: eventFields(fields) } : { deleted: true } } };
  validateEvent(next); return next;
}
export function resetEventOccurrence(event: CalendarEvent, originalDate: LocalDate): CalendarEvent {
  validateEvent(event);
  if (!event.recurrence || event.deleted || !isOccurrenceDate(event, originalDate)) throw new Error('Случай не входит в активную серию.');
  const exceptions = { ...event.exceptions }; delete exceptions[originalDate];
  const next = { ...event, exceptions }; validateEvent(next); return next;
}
