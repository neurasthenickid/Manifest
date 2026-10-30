import { monthCardWeeks, monthCaptionLines, monthNames } from '../month-cards';
import { formatDate, period, today } from '../periods';
import { button, el } from './elements';

/** Used exclusively by ordinary quarter/year calendars. Returns lifecycle cleanup. */
export function renderMonthCards(parent: HTMLElement, start: string, end: string, open: (type:'day'|'week'|'month', date:string)=>void, selected?:string) {
  parent.classList.add('lp-overview-months');
  const captions: {caption:HTMLElement; text:HTMLElement; numbers:HTMLElement[]}[] = [];
  const current = today();
  for (let date = start; date < end; date = period('month', date).end) {
    const month = period('month', date);
    const card = el('section', parent, undefined, 'lp-overview-month');
    card.dataset.month = month.start;
    button(card, `${monthNames[Number(date.slice(5,7))-1]} ${date.slice(0,4)} г.`, ()=>open('month', month.start), 'lp-overview-title');
    const heading = el('div', card, undefined, 'lp-overview-row lp-overview-head');
    for (const text of ['№','Пн','Вт','Ср','Чт','Пт','Сб','Вс']) el('span', heading, text);
    for (const week of monthCardWeeks(date)) {
      const row = el('div', card, undefined, 'lp-overview-row');
      const weekButton = button(row, week.key.split('-W')[1], ()=>open('week', week.start), 'lp-overview-week');
      weekButton.setAttribute('aria-label', 'Неделя '+week.key);
      for (const group of week.groups) {
        const host = group.outside ? el('div', row, undefined, 'lp-overview-neighbors') : row;
        if (group.outside) { host.style.setProperty('--neighbor-count', String(group.dates.length)); host.dataset.count = String(group.dates.length); }
        const days = group.outside ? el('div', host, undefined, 'lp-overview-neighbor-dates') : host;
        const numbers: HTMLElement[] = [];
        for (const value of group.dates) {
          const day = button(days, '', ()=>open('day', value), 'lp-overview-date');
          numbers.push(el('span', day, String(Number(value.slice(8))), 'lp-overview-number'));
          day.dataset.date = value;
          day.setAttribute('aria-label', formatDate(value));
          day.setAttribute('aria-pressed', String(value === selected));
          if (value === current) { day.classList.add('is-today'); day.setAttribute('aria-current','date'); }
          if (value === selected) day.classList.add('is-selected');
        }
        if (group.outside) {
          const caption = el('div', host, undefined, 'lp-overview-caption');
          caption.setAttribute('aria-hidden','true');
          const text = el('span', caption, group.label);
          if (group.dates.length > 1) captions.push({caption,text,numbers});
        }
      }
    }
  }
  let alive = true;
  const measure = () => {
    if (!alive || !parent.isConnected) return;
    for (const {caption,text,numbers} of captions) {
      const rect = caption.getBoundingClientRect(), label = text.getBoundingClientRect();
      const n = numbers.length;
      const middleLeft = numbers[Math.floor((n-1)/2)].getBoundingClientRect().left - rect.left;
      const middleRight = numbers[Math.floor(n/2)].getBoundingClientRect().right - rect.left;
      const lines = monthCaptionLines(n, rect.width, label.left-rect.left, label.right-rect.left, middleLeft, middleRight);
      caption.style.setProperty('--left-line', lines.left+'px');
      caption.style.setProperty('--right-line', lines.right+'px');
    }
  };
  const observer = new ResizeObserver(measure);
  observer.observe(parent);
  for (const {caption,text,numbers} of captions) { observer.observe(caption); observer.observe(text); for (const number of numbers) observer.observe(number); }
  void parent.ownerDocument.fonts.ready.then(measure);
  measure();
  return () => { alive = false; observer.disconnect(); };
}
