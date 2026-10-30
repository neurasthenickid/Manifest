import type { Base, Checkin, Definition, DefinitionVersion, LocalDate, PlannerRecord, Task, TaskSnapshot, Visibility } from './model';
import { assertLocalDate, isLocalDate, weekday } from './periods';
import { validateEvent } from './recurrence';
import {validatePlan} from './task-planning';
import {planDeadline} from './plan-policy';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/;
function fail(message: string): never { throw new Error(`Некорректная запись: ${message}`); }
function obj(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)) fail('ожидался объект');
}
function str(value: unknown, field: string, empty = false): asserts value is string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > 100_000) fail(field);
}
function id(value: unknown): asserts value is string { if (typeof value !== 'string' || !ID.test(value)) fail('ID'); }
function bool(value: unknown, field: string): asserts value is boolean { if (typeof value !== 'boolean') fail(field); }
function date(value: unknown): asserts value is LocalDate { if (!isLocalDate(value)) fail('дата'); }
function optionalDate(value: unknown): void { if (value !== undefined) date(value); }
function timestamp(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)
    || !isLocalDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) fail('момент времени с часовым поясом');
}
function items(value: unknown): asserts value is DefinitionVersion['items'] {
  if (!Array.isArray(value) || !value.length) fail('пустой список пунктов');
  const seen = new Set<string>();
  for (const item of value) { obj(item); id(item.id); str(item.title, 'название пункта'); if (seen.has(item.id)) fail('повтор ID пункта'); seen.add(item.id); }
}
function snapshot(value: unknown): asserts value is TaskSnapshot {
  obj(value); timestamp(value.at); str(value.title, 'название задачи'); id(value.areaId);
  if(value.description!==undefined)str(value.description,'описание задачи',true);
  if(value.externalStatus!==undefined){obj(value.externalStatus);id(value.externalStatus.receipt);timestamp(value.externalStatus.observedAt);if(value.externalStatus.actionAt!==undefined)timestamp(value.externalStatus.actionAt);bool(value.externalStatus.unknownTime,'неизвестное время внешней отметки');}
  optionalDate(value.plannedDate); optionalDate(value.dueDate); optionalDate(value.completedDate); if(value.featured!==undefined&&typeof value.featured!=='boolean')fail('избранность задачи');
  optionalDate(value.effectiveDate);if(value.archived!==undefined)bool(value.archived,'архив задачи');
  if(value.planPeriod!==undefined){obj(value.planPeriod);validatePlan(value.planPeriod as unknown as import('./model').TaskPlan);}if(value.parentId!==undefined)id(value.parentId);
  if (typeof value.status !== 'string' || !['todo', 'doing', 'done'].includes(value.status)) fail('статус задачи');
  if (value.status === 'done') timestamp(value.completedAt);
  else if (value.completedAt !== undefined || value.completedDate !== undefined) fail('открытая задача с датой завершения');
}
function type(value: unknown): void { if (typeof value !== 'string' || !['habit', 'morning', 'evening', 'workout'].includes(value)) fail('тип списка'); }
function rating(value: unknown, max: number): void {
  if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max)) fail('оценка вне шкалы');
}

export function base(recordId: string = crypto.randomUUID()): Base {
  id(recordId);
  return { schemaVersion: 1, id: recordId, version: 0, updatedAt: new Date().toISOString() };
}
// Canonical compound IDs are persisted, not labels. Prefix + fixed-width date + stable ID is collision-free.
export const dayRatingId = (value: LocalDate): string => `day-rating-${value}`;
export const areaRatingId = (weekStart: LocalDate, areaId: string): string => `area-rating-${weekStart}-${areaId}`;
export const dailyAreaRatingId = (value:LocalDate,areaId:string):string => `daily-area-rating-${value}-${areaId}`;
export const visibilityId = (taskId: string, value: LocalDate): string => `visibility-${value}-${taskId}`;
export const checkinId = (definitionId: string, value: LocalDate): string => `checkin-${value}-${definitionId}`;
/** Additional workout sessions have explicit identity; legacy daily forms keep their existing ID. */
export const workoutSessionId=(definitionId:string,value:LocalDate,sessionId:string)=>`${checkinId(definitionId,value)}-session-${sessionId}`;

/** Boundary validation runs on every load/write, including nested history and snapshots. */
export function validateRecord(value: unknown): asserts value is PlannerRecord {
  obj(value);
  if (value.schemaVersion !== 1 && !(value.schemaVersion === 2 && (value.kind === 'event'||value.kind==='task'||value.kind==='checkin'))) fail('неподдерживаемая версия схемы');
  id(value.id); timestamp(value.updatedAt);
  if (typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 0) fail('версия записи');
  switch (value.kind) {
    case 'task': {
      if(value.schemaVersion===1&&(value.planPeriod!==undefined||value.parentId!==undefined))fail('периодные планы требуют схемы2');
      timestamp(value.createdAt);
      optionalDate(value.createdDate);
      snapshot({ ...value, at: value.createdAt });
      if (!Array.isArray(value.history) || !value.history.length) fail('история задачи отсутствует');
      let previous = Date.parse(value.createdAt);
      let previousSnapshot: TaskSnapshot | undefined;
      for (const entry of value.history) {
        snapshot(entry);
        if(value.schemaVersion===1&&(entry.planPeriod!==undefined||entry.parentId!==undefined))fail('история периодного плана требует схемы2');
        if (Date.parse(entry.at) < previous) fail('порядок истории задачи');
        if (entry.completedAt !== undefined && Date.parse(entry.completedAt) > Date.parse(entry.at)) fail('завершение после снимка');
        if (entry.status === 'done') {
          if (previousSnapshot?.status === 'done') {
            if (entry.completedAt !== previousSnapshot.completedAt || entry.completedDate !== previousSnapshot.completedDate) fail('дата завершения изменена без нового завершения');
          } else if (Date.parse(entry.completedAt!) !== Date.parse(entry.at)) fail('дата завершения не совпадает с переходом статуса');
        }
        if(entry.completedDate && entry.completedDate < (value.createdDate??(value.createdAt).slice(0,10)))fail('день выполнения раньше создания задачи');
        previous = Date.parse(entry.at);
        previousSnapshot = entry;
      }
      if ((value.history[0] as TaskSnapshot).at !== value.createdAt) fail('первый снимок не совпадает с созданием');
      const last = value.history[value.history.length - 1] as TaskSnapshot;
      for (const key of ['title', 'areaId', 'plannedDate', 'dueDate', 'status', 'completedAt','completedDate','parentId','featured','archived'] as const) if (last[key] !== value[key]) fail('снимок истории не совпадает с задачей');
      const currentPlan=value.planPeriod as Task['planPeriod'];
      if(last.planPeriod?.type!==currentPlan?.type||last.planPeriod?.date!==currentPlan?.date)fail('плановый период не совпадает с историей');
      break;
    }
    case 'event':
      validateEvent(value);
      break;
    case 'visibility':
      id(value.taskId); date(value.noteDate); bool(value.hidden, 'скрытие');
      if (value.id !== visibilityId(value.taskId, value.noteDate)) fail('ID скрытия');
      break;
    case 'day-rating':
      date(value.date); rating(value.value, 100);
      if (value.id !== dayRatingId(value.date)) fail('ID оценки дня');
      break;
    case 'area-rating':
      date(value.weekStart); id(value.areaId); str(value.areaTitle, 'название сферы'); rating(value.value, 10);
      if (weekday(value.weekStart) !== 1 || value.policyVersion !== 1 || value.id !== areaRatingId(value.weekStart, value.areaId)) fail('правило недельной оценки');
      break;
    case 'daily-area-rating':
      date(value.date); id(value.areaId); str(value.areaTitle,'название сферы'); rating(value.value,10);
      if(value.policyVersion!==2 || value.id!==dailyAreaRatingId(value.date,value.areaId))fail('ID ежедневной оценки сферы');
      break;
    case 'definition': {
      type(value.type);
      if(value.lifecycle!==undefined){if(!Array.isArray(value.lifecycle))fail('история архива');let last='';for(const entry of value.lifecycle){obj(entry);date(entry.date);bool(entry.archived,'архив списка');if(entry.date<=last)fail('порядок истории архива');last=entry.date;}}
      if (!Array.isArray(value.versions) || !value.versions.length) fail('версии списка');
      let previous = '';
      for (const version of value.versions) {
        obj(version); date(version.effectiveDate); str(version.title, 'название списка'); items(version.items);
        if (version.effectiveDate <= previous) fail('даты версий списка не возрастают');
        previous = version.effectiveDate;
        if (!Array.isArray(version.weekdays) || !version.weekdays.every(d => Number.isInteger(d) && d >= 1 && d <= 7) || new Set(version.weekdays).size !== version.weekdays.length) fail('дни расписания');
      }
      break;
    }
    case 'checkin': {
      id(value.definitionId); date(value.date); type(value.definitionType); str(value.title, 'название отметки'); items(value.items);
      obj(value.states); bool(value.finalized, 'подтверждение'); str(value.comment, 'комментарий', true);
      const itemIds = new Set(value.items.map(item => item.id));
      for (const [key, state] of Object.entries(value.states)) { if (!itemIds.has(key)) fail('состояние неизвестного пункта'); bool(state, 'состояние пункта'); }
      if(value.schemaVersion===2){if(value.definitionType!=='workout')fail('схема занятия');id(value.sessionId);if(value.id!==workoutSessionId(value.definitionId,value.date,value.sessionId))fail('ID занятия');}
      else if(value.sessionId!==undefined||value.id !== checkinId(value.definitionId, value.date)) fail('ID отметки');
      break;
    }
    default: fail('неизвестный тип');
  }
}

/** Keep the calendar day and offset of completion even when the device changes time zone later. */
export function localTimestamp(now = new Date()): string {
  const offset = -now.getTimezoneOffset();
  const wall = new Date(now.getTime() + offset * 60_000).toISOString().slice(0, -1);
  return `${wall}${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
}
export type TaskFields = Pick<Task, 'title' | 'areaId'> & Partial<Pick<Task, 'description'|'externalStatus'|'plannedDate' | 'dueDate' | 'status'|'planPeriod'|'parentId'|'featured'|'archived'>>;
export type TaskPatch = Partial<TaskFields>;
function takeSnapshot(task: Omit<Task, 'history'> | Task, at: string,effectiveDate?:LocalDate): TaskSnapshot {
  return { at, title: task.title,...(task.description===undefined?{}:{description:task.description}),...(task.externalStatus===undefined?{}:{externalStatus:task.externalStatus}),areaId: task.areaId, plannedDate: task.plannedDate, dueDate: task.dueDate, status: task.status, completedAt: task.completedAt,completedDate:task.completedDate,planPeriod:task.planPeriod,parentId:task.parentId,featured:task.featured,archived:task.archived,effectiveDate };
}
export function newTask(fields: TaskFields, at = localTimestamp(), completedDate?:LocalDate,createdDate?:LocalDate): Task {
  const task: Task = { ...base(), ...fields, schemaVersion:fields.planPeriod||fields.parentId?2:1,kind: 'task', status: fields.status ?? 'todo', createdAt: at, history: [] };
  if (task.status === 'done') {task.completedAt = at;if(completedDate)task.completedDate=completedDate;}
  if(createdDate)task.createdDate=createdDate;
  task.history = [takeSnapshot(task, at)];
  validateRecord(task); return task;
}
export function changeTask(task: Task, patch: TaskPatch, at = localTimestamp(), completedDate?:LocalDate,effectiveDate?:LocalDate): Task {
  validateRecord(task); timestamp(at);
  const next:Task = { ...task, ...patch,schemaVersion:task.schemaVersion===2||patch.planPeriod||patch.parentId?2:1 };
  if(patch.status!==undefined&&patch.status!==task.status&&patch.externalStatus===undefined)delete next.externalStatus;
  if (next.status === 'done') {next.completedAt = task.status === 'done' ? task.completedAt : at;next.completedDate=task.status==='done'?task.completedDate:completedDate;}
  else {delete next.completedAt;delete next.completedDate;}
  next.history = [...task.history, takeSnapshot(next, at,effectiveDate)];
  validateRecord(next); return next;
}
export type TaskCategory = 'today' | 'overdue' | 'past' | 'backlog' | 'future' | 'done';
export function taskCategory(task: Task, value: LocalDate): TaskCategory {
  assertLocalDate(value);
  if (task.status === 'done') return 'done';
  const due=planDeadline(task);
  if (due && due < value) return 'overdue';
  if (task.plannedDate === value || task.planPeriod?.type==='day'&&task.planPeriod.date===value || due === value) return 'today';
  if (task.plannedDate && task.plannedDate < value) return 'past';
  if (!task.plannedDate && !task.dueDate) return 'backlog';
  return 'future';
}
export function visibleTasks(tasks: Task[], visibility: Visibility[], value: LocalDate): Task[] {
  const hidden = new Set(visibility.filter(v => v.noteDate === value && v.hidden).map(v => v.taskId));
  return tasks.filter(task => !hidden.has(task.id) && taskCategory(task, value) !== 'future');
}
export function definitionAt(definition: Definition, value: LocalDate): DefinitionVersion | undefined {
  assertLocalDate(value);
  for (let index = definition.versions.length - 1; index >= 0; index--) if (definition.versions[index].effectiveDate <= value) {const v=definition.versions[index];return definition.lifecycle?.filter(e=>e.date<=value).at(-1)?.archived?{...v,weekdays:[]}:v;}
  return undefined;
}
export function archiveDefinition(definition:Definition,value:LocalDate,archived:boolean):Definition {
 assertLocalDate(value);const result={...definition,lifecycle:[...(definition.lifecycle??[]).filter(e=>e.date!==value),{date:value,archived}].sort((a,b)=>a.date.localeCompare(b.date))};validateRecord(result);return result;
}
/**
 * Definitions are append-only histories: check-ins already made retain their own
 * item and title snapshots, while a changed list starts from a later local day.
 */
export function appendDefinitionVersion(definition: Definition, next: DefinitionVersion): Definition {
  validateRecord(definition);
  const previous = definition.versions[definition.versions.length - 1];
  if (next.effectiveDate <= previous.effectiveDate) throw new Error('Новое изменение должно начинаться позже предыдущей версии.');
  const version: DefinitionVersion = {
    effectiveDate: next.effectiveDate,
    title: next.title.trim(),
    weekdays: [...next.weekdays],
    items: next.items.map(item => ({ id: item.id, title: item.title.trim() })),
  };
  if (definition.type === 'habit' && version.items.length !== 1) throw new Error('У привычки должно быть одно действие.');
  const result: Definition = { ...definition, versions: [...definition.versions, version] };
  validateRecord(result);
  return result;
}
/** An explicit edit on an earlier note may insert a version; later versions and check-ins stay intact. */
export function setDefinitionVersion(definition:Definition,next:DefinitionVersion):Definition {
 const version={...next,title:next.title.trim(),weekdays:[...next.weekdays],items:next.items.map(item=>({...item,title:item.title.trim()}))};
 const result={...definition,versions:[...definition.versions.filter(v=>v.effectiveDate!==next.effectiveDate),version].sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate))};
 validateRecord(result);return result;
}
export function newCheckin(definition: Definition, value: LocalDate): Checkin {
  const version = definitionAt(definition, value);
  if (!version || !version.weekdays.includes(weekday(value))) throw new Error('Список не запланирован на эту дату');
  return { ...base(checkinId(definition.id, value)), kind: 'checkin', definitionId: definition.id, date: value, definitionType: definition.type,
    title: version.title, items: version.items.map(item => ({ ...item })), states: {}, finalized: false, comment: '' };
}
