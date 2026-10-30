import { AREAS, type AreaRating, type DailyAreaRating, type Checkin, type Definition, type DefinitionItem, type LocalDate, type Period, type PlannerRecord, type Task, type TaskSnapshot } from './model';
import {completionDate,effectiveTaskHistory} from './task-completion';
import { definitionAt } from './domain';
import {planDeadline} from './plan-policy';
import { addDays, assertLocalDate, dates, today, weekday } from './periods';

export interface RatingSummary { mean: number | null; count: number; missing: number; expected: number }
export interface AreaRatingSummary { areaId: string; areaTitle: string; mean: number | null; count: number }
export interface RoutineItemSummary { itemId: string; title: string; done: number; missed: number; missedDays: number; percent: number | null }
export interface RoutineSummary {
  definitionId: string; title: string; type: 'morning' | 'evening'; done: number; missed: number; percent: number | null;
  filledDays: number; plannedDays: number; noDataDays: number; fullness: number | null; items: RoutineItemSummary[];
}
export interface HabitSummary { definitionId: string; title: string; done: number; missed: number; unrecorded: number; planned: number; percent: number | null; fullness: number | null }
export interface TaskTotals { completed: number; late: number; overdue: number; past: number }
export interface TaskSummary extends TaskTotals { byArea: Array<TaskTotals & { areaId: string }> }
export interface WorkoutJournalEntry { id: string; date: LocalDate; title: string; items: DefinitionItem[]; states: Record<string, boolean>; comment: string }
export interface DayRatingPoint { date: LocalDate; value: number | null }
export interface AreaRatingPoint { date: LocalDate; areaId: string; areaTitle: string; value: number }
export interface Summary {
  dayRatings: RatingSummary; areaRatings: AreaRatingSummary[]; legacyAreaRatings: AreaRatingSummary[]; routines: RoutineSummary[]; habits: HabitSummary[];
  workouts: { count: number }; tasks: TaskSummary;
}
const percent = (n: number, d: number): number | null => d ? 100 * n / d : null;
const average = (values: number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const emptyTaskTotals = (): TaskTotals => ({ completed: 0, late: 0, overdue: 0, past: 0 });
export function observationWindow(selected:Period,todayDate=today()){
  const end=selected.end<addDays(todayDate,1)?selected.end:addDays(todayDate,1);
  return{elapsed:end<=selected.start?0:dates(selected.start,end).length,total:dates(selected.start,selected.end).length};
}

/** Dedupe source revisions; an absent/null observation is never a zero rating. */
export function dailyAreaRatingSeries(selected:Period,source:readonly PlannerRecord[],todayDate=today()):AreaRatingPoint[] {
  assertLocalDate(todayDate);const end=selected.end<addDays(todayDate,1)?selected.end:addDays(todayDate,1);
  const unique=new Map<string,DailyAreaRating>();
  for(const record of source)if(record.kind==='daily-area-rating'&&(!unique.has(record.id)||unique.get(record.id)!.version<record.version))unique.set(record.id,record);
  return [...unique.values()].filter(record=>record.value!==null&&record.date>=selected.start&&record.date<end).map(record=>({date:record.date,areaId:record.areaId,areaTitle:record.areaTitle,value:record.value!})).sort((a,b)=>a.date.localeCompare(b.date)||a.areaId.localeCompare(b.areaId));
}

export function dailyAreaSummary(selected:Period,source:readonly PlannerRecord[],todayDate=today(),catalog:readonly {id:string;title:string}[]=AREAS):AreaRatingSummary[] {
  const points=dailyAreaRatingSeries(selected,source,todayDate),groups=new Map<string,{title:string;values:number[]}>();
  for(const area of catalog)groups.set(area.id,{title:area.title,values:[]});
  for(const point of points){const group=groups.get(point.areaId)??{title:point.areaTitle,values:[]};if(!catalog.some(a=>a.id===point.areaId))group.title=point.areaTitle;group.values.push(point.value);groups.set(point.areaId,group);}
  return [...groups].map(([areaId,g])=>({areaId,areaTitle:g.title,mean:average(g.values),count:g.values.length}));
}

/** Read-only journal from confirmed session snapshots; opening a summary never creates a workout. */
export function workoutJournal(selected: Period, source: readonly PlannerRecord[], todayDate = today()): WorkoutJournalEntry[] {
  assertLocalDate(todayDate);
  const end = selected.end < addDays(todayDate, 1) ? selected.end : addDays(todayDate, 1);
  const unique = new Map<string, PlannerRecord>();
  for (const record of source) if (!unique.has(record.id) || unique.get(record.id)!.version < record.version) unique.set(record.id, record);
  return [...unique.values()]
    .filter((record): record is Checkin => record.kind === 'checkin' && record.definitionType === 'workout' && record.finalized && record.date >= selected.start && record.date < end)
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id))
    .map(record => ({ id: record.id, date: record.date, title: record.title, items: record.items.map(item => ({ ...item })), states: { ...record.states }, comment: record.comment }));
}

/** Fixed-width observation series for charts; null means a real elapsed day without a rating. */
export function dayRatingSeries(selected: Period, source: readonly PlannerRecord[], todayDate = today()): DayRatingPoint[] {
  assertLocalDate(todayDate);
  const end = selected.end < addDays(todayDate, 1) ? selected.end : addDays(todayDate, 1);
  const byDate = new Map<string, Extract<PlannerRecord, { kind: 'day-rating' }>>();
  for (const record of source) if (record.kind === 'day-rating' && record.date >= selected.start && record.date < end && (!byDate.has(record.date) || byDate.get(record.date)!.version < record.version)) byDate.set(record.date, record);
  return dates(selected.start, end).map(date => ({ date, value: byDate.get(date)?.value ?? null }));
}

/** Weekly ratings are observed on Sunday and retain the title stored with that observation. */
export function areaRatingSeries(selected: Period, source: readonly PlannerRecord[], todayDate = today()): AreaRatingPoint[] {
  assertLocalDate(todayDate);
  const end = selected.end < addDays(todayDate, 1) ? selected.end : addDays(todayDate, 1);
  const unique = new Map<string, AreaRating>();
  for (const record of source) if (record.kind === 'area-rating' && (!unique.has(record.id) || unique.get(record.id)!.version < record.version)) unique.set(record.id, record);
  return [...unique.values()]
    .map(record => ({ date: addDays(record.weekStart, 6), areaId: record.areaId, areaTitle: record.areaTitle, value: record.value }))
    .filter((record): record is AreaRatingPoint => record.value !== null && record.date >= selected.start && record.date < end)
    .sort((left, right) => left.date.localeCompare(right.date) || left.areaId.localeCompare(right.areaId));
}

/** Per-task completion count is distinct ID; repeated completions in a period count once. */
function taskSummary(tasks: Task[], start: LocalDate, end: LocalDate,areaId?:string): TaskSummary {
  const result: TaskSummary = { ...emptyTaskTotals(), byArea: [] };
  if (end <= start) return result;
  const cutoff = addDays(end, -1);
  const areas = new Map<string, TaskTotals>();
  const add = (area: string, metric: keyof TaskTotals) => {
    result[metric]++;
    const totals = areas.get(area) ?? emptyTaskTotals(); totals[metric]++; areas.set(area, totals);
  };
  for (const task of tasks) {
    const history = effectiveTaskHistory(task).filter(s => s.date < end).map(s=>s.snapshot);
    let last: TaskSnapshot | undefined;
    const completions: TaskSnapshot[] = [];
    for (const entry of history) {
      if (entry.status === 'done' && last?.status !== 'done' && entry.completedAt && completionDate(entry)! >= start && completionDate(entry)! < end&&(!areaId||entry.areaId===areaId)&&(!entry.planPeriod||entry.planPeriod.type==='day')) completions.push(entry);
      last = entry;
    }
    if (completions.length) {
      add(completions[0].areaId, 'completed');
      const late = completions.find(entry => planDeadline(entry) && completionDate(entry)! > planDeadline(entry)!);
      if (late) add(late.areaId, 'late');
    }
    if (last && !last.archived && last.status !== 'done'&&(!areaId||last.areaId===areaId)&&(!last.planPeriod||last.planPeriod.type==='day'&&last.planPeriod.date<end)) {
      if (planDeadline(last) && planDeadline(last)! < cutoff) add(last.areaId, 'overdue');
      else if (!last.dueDate && last.plannedDate && last.plannedDate < cutoff) add(last.areaId, 'past');
    }
  }
  result.byArea = [...areas].map(([areaId, totals]) => ({ areaId, ...totals }));
  return result;
}

/** Pure summary of source observations. No implicit records are created for missing days. */
export function summarize(selected: Period, source: readonly PlannerRecord[], todayDate = today(),taskAreaId?:string,areaCatalog:readonly {id:string;title:string}[]=AREAS): Summary {
  assertLocalDate(todayDate);
  const end = selected.end < addDays(todayDate, 1) ? selected.end : addDays(todayDate, 1);
  const elapsed = dates(selected.start, end);
  const inside = (date: string) => date >= selected.start && date < end;
  // Views may supply the same record more than once; never count projections as observations.
  const unique = new Map<string, PlannerRecord>();
  for (const record of source) if (!unique.has(record.id) || unique.get(record.id)!.version < record.version) unique.set(record.id, record);
  const records = [...unique.values()];
  const ratings = records.filter(r => r.kind === 'day-rating' && inside(r.date) && r.value !== null).map(r => (r as Extract<PlannerRecord, {kind:'day-rating'}>).value as number);
  const areas = new Map<string, {title: string; values: number[]}>();
  for (const record of records) if (record.kind === 'area-rating' && inside(addDays(record.weekStart, 6))) {
    const area = areas.get(record.areaId) ?? { title: record.areaTitle, values: [] };
    if (record.value !== null) area.values.push(record.value);
    area.title = record.areaTitle; areas.set(record.areaId, area);
  }
  const result: Summary = {
    dayRatings: { mean: average(ratings), count: ratings.length, missing: elapsed.length - ratings.length, expected: elapsed.length },
    areaRatings: dailyAreaSummary(selected,records,todayDate,areaCatalog),
    legacyAreaRatings: [...areas].map(([areaId, a]) => ({ areaId, areaTitle: a.title, mean: average(a.values), count: a.values.length })),
    routines: [], habits: [], workouts: { count: 0 },
    tasks: taskSummary(records.filter((r): r is Task => r.kind === 'task'), selected.start, end,taskAreaId),
  };
  const definitions = new Map(records.filter((r): r is Definition => r.kind === 'definition').map(r => [r.id, r]));
  const checkins = records.filter((r): r is Checkin => r.kind === 'checkin');
  const definitionIds = new Set([...definitions.keys(), ...checkins.filter(c => inside(c.date)).map(c => c.definitionId)]);
  for (const definitionId of definitionIds) {
    const definition = definitions.get(definitionId);
    const own = checkins.filter(c => c.definitionId === definitionId);
    const byDate = new Map(own.map(c => [c.date, c]));
    const type = definition?.type ?? own[0]?.definitionType;
    const current = definition && definitionAt(definition, end > selected.start ? addDays(end, -1) : selected.start);
    const title = current?.title ?? own[own.length - 1]?.title ?? definition?.versions[0].title ?? definitionId;
    if (type === 'workout') { result.workouts.count += own.filter(c => inside(c.date) && c.finalized).length; continue; }
    const routine: RoutineSummary = { definitionId, title, type: type === 'evening' ? 'evening' : 'morning', done: 0, missed: 0, percent: null, filledDays: 0, plannedDays: 0, noDataDays: 0, fullness: null, items: [] };
    const habit: HabitSummary = { definitionId, title, done: 0, missed: 0, unrecorded: 0, planned: 0, percent: null, fullness: null };
    const itemTotals = new Map<string, RoutineItemSummary>();
    for (const day of elapsed) {
      const checkin = byDate.get(day);
      const version = definition && definitionAt(definition, day);
      // Saved snapshots keep removed/renamed items and their schedule evidence intact.
      const scheduledItems: DefinitionItem[] | undefined = checkin?.items ?? (version?.weekdays.includes(weekday(day)) ? version.items : undefined);
      if (!scheduledItems?.length) continue;
      if (type === 'habit') {
        habit.planned++;
        if (!checkin?.finalized) habit.unrecorded++;
        else if (scheduledItems.every(item => checkin.states[item.id] === true)) habit.done++;
        else habit.missed++;
        continue;
      }
      routine.plannedDays++;
      if (!checkin?.finalized) { routine.noDataDays++; continue; }
      routine.filledDays++;
      for (const item of scheduledItems) {
        const row = itemTotals.get(item.id) ?? { itemId: item.id, title: item.title, done: 0, missed: 0, missedDays: 0, percent: null };
        row.title = item.title;
        if (checkin.states[item.id] === true) { row.done++; routine.done++; }
        else { row.missed++; row.missedDays++; routine.missed++; }
        itemTotals.set(item.id, row);
      }
    }
    if (type === 'habit') {
      habit.percent = percent(habit.done, habit.planned);
      habit.fullness = percent(habit.done + habit.missed, habit.planned);
      result.habits.push(habit);
    } else if (type === 'morning' || type === 'evening') {
      routine.percent = percent(routine.done, routine.done + routine.missed);
      routine.fullness = percent(routine.filledDays, routine.plannedDays);
      // Filter exact counts before presentation rounding: 249/250 remains visible.
      routine.items = [...itemTotals.values()].filter(item => item.missed > 0).map(item => ({ ...item, percent: percent(item.done, item.done + item.missed) }));
      result.routines.push(routine);
    }
  }
  return result;
}
