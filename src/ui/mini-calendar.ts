import { addDays, dates, formatDate, period, weekday, today } from '../periods';
import { button,el } from './elements';
export function miniCalendarRange(date:string){const month=period('month',date);return{start:addDays(month.start,1-weekday(month.start)),end:addDays(month.end,(8-weekday(month.end))%7)};}
export function renderMiniCalendar(parent:HTMLElement,date:string,open:(type:'day'|'week'|'month',date:string)=>void,selected?:string,exists?:(date:string)=>boolean) {
 const month=period('month',date),box=el('section',parent,undefined,'lp-mini-month');
 const label=new Date(month.start+'T12:00:00Z').toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'});
 button(box,label,()=>open('month',month.start),'lp-mini-title');
 const grid=el('div',box,undefined,'lp-mini-grid');el('span',grid,'№','lp-mini-week-label');
 for(const name of ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'])el('span',grid,name,'lp-mini-week-label');
 const {start:first,end:last}=miniCalendarRange(date);
 for(let d=first;d<last;d=addDays(d,7)){
  const week=period('week',d),w=button(grid,week.key.split('-W')[1],()=>open('week',d),'lp-mini-week');w.setAttribute('aria-label','Неделя '+week.key);
  for(const day of dates(d,addDays(d,7))){
   const b=button(grid,String(Number(day.slice(8))),()=>open('day',day),'lp-mini-date');
   b.dataset.date=day;b.setAttribute('aria-label',formatDate(day));
   if(day<month.start||day>=month.end)b.classList.add('is-outside');
   if(day===today())b.classList.add('is-today');if(day===selected)b.classList.add('is-selected');
   if(exists?.(day))b.classList.add('has-note');
  }
 }
 return box;
}
