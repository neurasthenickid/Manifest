import { addDays, dates, period, weekday } from './periods';

export const monthNames = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const shortNames = ['янв.','фев.','мар.','апр.','май','июн.','июл.','авг.','сен.','окт.','ноя.','дек.'];
export interface MonthDateGroup { dates: string[]; outside: boolean; label: string }
/** Calendar-only projection: no records, settings or date assignments are written. */
export function monthCardWeeks(date: string) {
  const month = period('month', date);
  const start = addDays(month.start, 1 - weekday(month.start));
  const end = addDays(month.end, (8 - weekday(month.end)) % 7);
  const weeks = [];
  for (let day = start; day < end; day = addDays(day, 7)) {
    const groups: MonthDateGroup[] = [];
    for (const value of dates(day, addDays(day, 7))) {
      const outside = value < month.start || value >= month.end;
      const previous = groups.at(-1);
      if (outside && previous?.outside && previous.dates[0].slice(0, 7) === value.slice(0, 7)) previous.dates.push(value);
      else groups.push({dates: [value], outside, label: ''});
    }
    for (const group of groups) if (group.outside) {
      const index = Number(group.dates[0].slice(5, 7)) - 1;
      group.label = (group.dates.length === 1 ? shortNames : monthNames)[index];
    }
    weeks.push({start: day, key: period('week', day).key, groups});
  }
  return weeks;
}

/** Pixel geometry relative to the caption. Six-day groups preserve the approved
 * two-step retreat from the outer edges of the two middle number glyphs. */
export function monthCaptionLines(count: number, width: number, textLeft: number, textRight: number, middleLeft: number, middleRight: number) {
  const gap = Math.min(16, Math.max(4, width * .06));
  const left = count === 6 ? middleLeft - Math.max(0, textLeft - 4 - middleLeft) : textLeft - gap;
  const rightStart = count === 6 ? middleRight + Math.max(0, middleRight - textRight - 4) : textRight + gap;
  return {left: Math.max(0, Math.min(left, textLeft - 4)), right: Math.max(0, Math.min(width - rightStart, width - textRight - 4))};
}
