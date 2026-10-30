import type { LocalDate, Period, PeriodType } from './model';

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
function utc(value: LocalDate): Date { return new Date(`${value}T12:00:00.000Z`); }
function local(d: Date): LocalDate {
  const year = d.getUTCFullYear();
  if (year < 1000 || year > 9999) throw new Error('Дата вне поддерживаемых лет 1000–9999');
  return `${year}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const d = utc(value);
  return Number.isFinite(d.getTime()) && local(d) === value;
}
export function assertLocalDate(value: unknown): asserts value is LocalDate {
  if (!isLocalDate(value)) throw new Error('Некорректная календарная дата');
}
export function parseDate(value: string): LocalDate {
  const parts = /^(\d{2})([.-])(\d{2})\2(\d{4})$/.exec(value.trim());
  if (!parts) throw new Error('Введите дату ДД.ММ.ГГГГ');
  const result = `${parts[4]}-${parts[3]}-${parts[1]}`;
  assertLocalDate(result);
  return result;
}
export function formatDate(value: LocalDate): string {
  assertLocalDate(value);
  return `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;
}
export function today(now = new Date()): LocalDate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
export function addDays(value: LocalDate, amount: number): LocalDate {
  assertLocalDate(value);
  if (!Number.isInteger(amount)) throw new Error('Количество дней должно быть целым');
  const d = utc(value);
  d.setUTCDate(d.getUTCDate() + amount);
  return local(d);
}
export function weekday(value: LocalDate): number {
  assertLocalDate(value);
  return utc(value).getUTCDay() || 7;
}
/** Half-open date interval; dates remain calendar values across DST and time zones. */
export function dates(start: LocalDate, end: LocalDate): LocalDate[] {
  assertLocalDate(start); assertLocalDate(end);
  const result: LocalDate[] = [];
  for (let date = start; date < end; date = addDays(date, 1)) result.push(date);
  return result;
}
function monthStart(year: number, month: number): LocalDate {
  const d = new Date(Date.UTC(year, month, 1, 12));
  return local(d);
}
export function period(type: PeriodType, anchor: LocalDate): Period {
  assertLocalDate(anchor);
  const y = Number(anchor.slice(0, 4)); const m = Number(anchor.slice(5, 7)) - 1;
  switch (type) {
    case 'day': return { type, start: anchor, end: addDays(anchor, 1), key: formatDate(anchor), label: formatDate(anchor) };
    case 'week': {
      const start = addDays(anchor, 1 - weekday(anchor));
      const weekYear = Number(addDays(start, 3).slice(0, 4));
      const jan4 = `${weekYear}-01-04`;
      const firstMonday = addDays(jan4, 1 - weekday(jan4));
      const week = Math.round((utc(start).getTime() - utc(firstMonday).getTime()) / DAY / 7) + 1;
      const key = `${weekYear}-W${pad(week)}`;
      return { type, start, end: addDays(start, 7), key, label: `${key} · ${formatDate(start)} — ${formatDate(addDays(start, 6))}` };
    }
    case 'month': return { type, start: monthStart(y, m), end: monthStart(y, m + 1), key: `${pad(m + 1)}-${y}`, label: `${pad(m + 1)}.${y}` };
    case 'quarter': {
      const q = Math.floor(m / 3);
      return { type, start: monthStart(y, q * 3), end: monthStart(y, q * 3 + 3), key: `${y}-Q${q + 1}`, label: `Q${q + 1} · ${y}` };
    }
    case 'year': return { type, start: `${y}-01-01`, end: monthStart(y + 1, 0), key: String(y), label: String(y) };
    default: throw new Error('Неизвестный тип периода');
  }
}
export const periodFor = period;
export function adjacent(value: Period, delta: number): Period {
  if (!Number.isInteger(delta)) throw new Error('Сдвиг периода должен быть целым');
  if (value.type === 'day' || value.type === 'week') return period(value.type, addDays(value.start, delta * (value.type === 'day' ? 1 : 7)));
  const y = Number(value.start.slice(0, 4)); const m = Number(value.start.slice(5, 7)) - 1;
  return period(value.type, monthStart(y, m + delta * (value.type === 'month' ? 1 : value.type === 'quarter' ? 3 : 12)));
}
/** Strict fallback for canonical file names; invalid metadata must never fall back to today. */
export function periodFromKey(type: PeriodType, key: string): Period {
  let anchor: string;
  switch (type) {
    case 'day': anchor = parseDate(key); break;
    case 'week': {
      const match = /^([1-9]\d{3})-W(\d{2})$/.exec(key);
      if (!match) throw new Error('Некорректное имя недели');
      const jan4 = `${match[1]}-01-04`;
      anchor = addDays(jan4, 1 - weekday(jan4) + (Number(match[2]) - 1) * 7);
      break;
    }
    case 'month': {
      const match = /^(\d{2})-([1-9]\d{3})$/.exec(key);
      if (!match) throw new Error('Некорректное имя месяца');
      anchor = `${match[2]}-${match[1]}-01`; break;
    }
    case 'quarter': {
      const match = /^([1-9]\d{3})-Q([1-4])$/.exec(key);
      if (!match) throw new Error('Некорректное имя квартала');
      anchor = `${match[1]}-${pad((Number(match[2]) - 1) * 3 + 1)}-01`; break;
    }
    case 'year': anchor = `${key}-01-01`; break;
    default: throw new Error('Неизвестный тип периода');
  }
  const result = period(type, anchor);
  if (result.key !== (type==='day'?key.replaceAll('-','.'):key)) throw new Error('Некорректное имя периода');
  return result;
}
