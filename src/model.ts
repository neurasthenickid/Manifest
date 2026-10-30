export type LocalDate = string;
export type PeriodType = 'day' | 'week' | 'month' | 'quarter' | 'year';
export interface Period { type: PeriodType; start: LocalDate; end: LocalDate; key: string; label: string }
export interface LifeArea {id:string;title:string;color:string;icon:string;enabled:boolean;titleHistory?:{title:string;at:string}[]}
export const AREAS = [
  { id: 'family', title: 'Семья', color: '#c86b91',icon:'heart' },
  { id: 'home', title: 'Быт', color: '#c98e46',icon:'house' },
  { id: 'work', title: 'Работа', color: '#5c8cce',icon:'briefcase-business' },
  { id: 'study', title: 'Учёба', color: '#9673c9',icon:'book-open' },
  { id: 'self', title: 'Я', color: '#4e9b83',icon:'user-round' },
] as const;
export interface Base<Schema extends 1 | 2 = 1> { schemaVersion: Schema; id: string; version: number; updatedAt: string }
export type TaskStatus = 'todo' | 'doing' | 'done';
export interface TaskPlan {type:PeriodType;date:LocalDate}
export interface ExternalTaskStatus {receipt:string;actionAt?:string;observedAt:string;unknownTime:boolean}
export interface TaskSnapshot { at: string; title: string; description?:string;areaId: string; plannedDate?: LocalDate; dueDate?: LocalDate; status: TaskStatus; completedAt?: string; completedDate?: LocalDate;planPeriod?:TaskPlan;parentId?:string;featured?:boolean;archived?:boolean;effectiveDate?:LocalDate;externalStatus?:ExternalTaskStatus }
export interface Task extends Base<1|2>, Omit<TaskSnapshot, 'at'|'effectiveDate'> { kind: 'task'; createdAt: string; createdDate?:LocalDate; history: TaskSnapshot[] }
export interface EventFields { title: string; start: string; end: string; allDay: boolean; timezone: string; areaId: string; featured?: boolean }
export interface Recurrence { frequency: 'daily' | 'weekly' | 'weekdays'; until?: LocalDate }
export type EventException = { deleted: true } | { deleted: false; fields: EventFields };
export interface CalendarEvent extends Base<1 | 2>, EventFields { kind: 'event'; deleted?: boolean; recurrence?: Recurrence; exceptions?: Record<LocalDate, EventException> }
/** A derived view, never an independently saveable record. */
export interface EventOccurrence extends EventFields { key: string; eventId: string; originalDate: LocalDate; sourceVersion: number }
export interface Visibility extends Base { kind: 'visibility'; taskId: string; noteDate: LocalDate; hidden: boolean }
export interface DayRating extends Base { kind: 'day-rating'; date: LocalDate; value: number | null }
export interface AreaRating extends Base { kind: 'area-rating'; weekStart: LocalDate; areaId: string; areaTitle: string; value: number | null; policyVersion: 1 }
/** New daily observations never reinterpret legacy weekly area-rating files. */
export interface DailyAreaRating extends Base { kind: 'daily-area-rating'; date: LocalDate; areaId: string; areaTitle: string; value: number | null; policyVersion: 2 }
export type DefinitionType = 'habit' | 'morning' | 'evening' | 'workout';
export interface DefinitionItem { id: string; title: string }
export interface DefinitionVersion { effectiveDate: LocalDate; items: DefinitionItem[]; weekdays: number[]; title: string }
export interface Definition extends Base { kind: 'definition'; type: DefinitionType; versions: DefinitionVersion[];lifecycle?:{date:LocalDate;archived:boolean}[] }
export interface Checkin extends Base<1|2> { kind: 'checkin'; definitionId: string; date: LocalDate; definitionType: DefinitionType; title: string; items: DefinitionItem[]; states: Record<string, boolean>; finalized: boolean; comment: string;sessionId?:string }
export type PlannerRecord = Task | CalendarEvent | Visibility | DayRating | AreaRating | DailyAreaRating | Definition | Checkin;
export type RecordKind = PlannerRecord['kind'];
export type RecordOf<K extends RecordKind> = Extract<PlannerRecord, {kind: K}>;
/** Verified changes only; absent payload is a legacy full refresh. */
export interface StoreChange {
  records: readonly {id:string;kind:RecordKind}[];
  issuesChanged: boolean;
}
export interface PlannerStore {
  all<K extends RecordKind>(kind: K): RecordOf<K>[];
  get(id: string): PlannerRecord | undefined;
  save<T extends PlannerRecord>(record: T, expectedVersion: number): Promise<T>;
  subscribe(listener: (change?:StoreChange) => void): () => void;
}
/** Remote integration is intentionally unconfigured in M1. No network at runtime. */
export interface CalendarAdapter {
  readonly provider: string;
  pull(cursor?: string): Promise<{events: CalendarEvent[]; cursor?: string}>;
  push(event: CalendarEvent, remoteRevision?: string): Promise<{uid: string; revision: string}>;
  delete(uid: string, remoteRevision: string): Promise<void>;
}
