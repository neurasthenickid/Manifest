import type {Period,PlannerRecord} from '../model';
import {activityGroups,activityTotal,activityDay,ActivitySelections,type ActivityGroup,type ActivityKind} from '../activity-statistics';
import {dates,formatDate,period,weekday} from '../periods';
import {button,el} from './elements';
import {preserveViewport} from './stability';
const monthName=(date:string)=>new Date(date+'T12:00:00Z').toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'});
const percentText=(value:number)=>value<100&&Math.round(value)===100?'<100%':Math.round(value)+'%';
const periodTitle:Record<string,string>={week:'За неделю',month:'За месяц',quarter:'За квартал',year:'За год'};
const returnTitle:Record<string,string>={day:'К итогу дня',week:'К итогу недели',month:'К итогу месяца',quarter:'К итогу квартала',year:'К итогу года'};
const marks={full:'✓',partial:'◐',zero:'0',missing:'—',future:'·'};
const descriptions={full:'Всё выполнено',partial:'Выполнена часть',zero:'Подтверждено, выполнено 0',missing:'Нет подтверждённой записи',future:'Будущая дата'};

/** One read-only renderer for all periods, programs and both routines. */
export function renderActivityStatistics(parent:HTMLElement,selected:Period,records:readonly PlannerRecord[],asOf:string,kinds:readonly ActivityKind[],selections:ActivitySelections){
 const groups=activityGroups(selected,records,kinds,asOf),list=el('div',parent,undefined,'lp-activity-stats');list.classList.toggle('lp-activity-long-period',selected.type==='quarter'||selected.type==='year');
 if(!groups.length){el('p',list,kinds.includes('workout')?'Нет программ или подтверждённых занятий для этого периода.':'Нет рутин для этого периода.','lp-empty');return;}
 for(const group of groups){const card=el('article',list,undefined,'lp-activity-card');card.dataset.definitionId=group.id;card.dataset.activityType=group.kind;renderCard(card,group);}
 function renderCard(card:HTMLElement,group:ActivityGroup,nextFocus?:string){
  const state=selections.get(group),restore=preserveViewport(card),active=card.ownerDocument.activeElement,focusKey=active&&card.contains(active)&&'dataset' in active?(active as HTMLElement).dataset.activityFocus:undefined;
  card.replaceChildren();el('h4',card,group.title,'lp-activity-title');
  if(state.day||state.month){
   const actions=el('div',card,undefined,'lp-activity-scope');
   if(selected.type==='year'&&state.month&&state.day){const back=button(actions,'К итогу месяца',()=>{const focus='day-'+state.day;selections.reset(group,true);renderCard(card,group,focus);});back.dataset.activityFocus='month-total';}
   const reset=button(actions,returnTitle[selected.type]??'К итогу периода',()=>{const focus=selected.type==='year'&&state.month?'month-'+state.month:state.day?'day-'+state.day:undefined;selections.reset(group);renderCard(card,group,focus);});reset.dataset.activityFocus='period';
  }
  const legend=el('div',card,undefined,'lp-activity-legend');for(const [key,title]of Object.entries(descriptions)){const item=el('span',legend,undefined,'lp-activity-legend-'+key);el('span',item,marks[key as keyof typeof marks]+' ','lp-activity-mark');item.append(card.ownerDocument.createTextNode(title));}
  const calendars=el('div',card,undefined,'lp-activity-calendars');
  if(selected.type==='week')calendar(calendars,group,selected.start,selected.end,false);
  else if(selected.type==='year'){
   const tiles=el('div',calendars,undefined,'lp-activity-year');
   for(let month=selected.start;month<selected.end;month=period('month',month).end){const p=period('month',month),total=activityTotal(group,p,asOf),b=button(tiles,'',()=>{selections.month(group,selected,p.start);renderCard(card,group);});b.dataset.statMonth=month;b.dataset.activityFocus='month-'+month;b.setAttribute('aria-pressed',String(state.month===month));el('strong',b,monthName(month));el('span',b,group.kind==='workout'?`${total.sessions} занятий`:`${total.filledDays} дней с записью`);el('small',b,total.total?`${total.done} из ${total.total} · ${percentText(total.percent!)}`:month>asOf?'Будущий месяц · Нет данных':'Нет данных');}
   if(state.month){const p=period('month',state.month);calendar(calendars,group,p.start,p.end,true);}
  }else for(let month=selected.start;month<selected.end;month=period('month',month).end){const p=period('month',month);calendar(calendars,group,p.start,p.end,true);}
  const range=selections.range(group,selected),total=activityTotal(group,range,asOf),summary=el('div',card,undefined,'lp-activity-total');summary.setAttribute('aria-live','polite');
  const interval=state.day?formatDate(state.day):state.month?monthName(state.month):periodTitle[selected.type]??'За период';el('strong',summary,interval,'lp-activity-interval');
  if(state.day&&state.day>asOf)el('p',summary,'Будущая дата. Результаты ещё не учитываются.','lp-muted');
  if(group.kind==='workout')el('p',summary,'Подтверждённых занятий: '+total.sessions,'lp-activity-count');
  else el('p',summary,`Дней с записью: ${total.filledDays} · Дней без записи: ${total.missingDays}`,'lp-activity-coverage');
  el('p',summary,group.kind==='workout'?'Выполнено пунктов программы':'Выполнено пунктов рутины','lp-activity-metric-label');
  el('strong',summary,total.total?`${total.done} из ${total.total} · ${percentText(total.percent!)}`:'Нет данных','lp-activity-value');
  el('small',summary,group.kind==='workout'?'В подтверждённых занятиях':'В подтверждённых записях','lp-muted');
  if(total.total){const progress=el('progress',summary);progress.max=total.total;progress.value=total.done;progress.setAttribute('aria-label',`${total.done} из ${total.total} выполнено`);}
  if(state.day&&total.sessions>1)el('p',summary,`Итог объединяет ${total.sessions} занятия этой программы за день.`,'lp-muted');
  if(group.kind!=='workout'&&!group.definition)el('p',summary,'Расписание не сохранено. Полнота рассчитана только для дат с сохранёнными записями.','lp-muted');
  const detail=el('details',card,undefined,'lp-activity-items');detail.open=state.itemsOpen;el('summary',detail,group.kind==='workout'?'По упражнениям':'По пунктам рутины');detail.addEventListener('toggle',()=>{state.itemsOpen=detail.open;});
  if(!total.items.length)el('p',detail,'Нет подтверждённых данных для этого интервала.','lp-muted');
  for(const item of total.items){const row=el('div',detail,undefined,'lp-activity-item');row.dataset.itemId=item.id;const label=el('div',row,undefined,'lp-activity-item-label');el('span',label,item.title);el('span',label,`${item.done} / ${item.total}`);const progress=el('progress',row);progress.max=item.total;progress.value=item.done;progress.setAttribute('aria-label',`${item.title}: ${item.done} из ${item.total}`);}
  restore();const focus=nextFocus??focusKey;if(focus)card.querySelector<HTMLElement>(`[data-activity-focus="${focus}"]`)?.focus({preventScroll:true});
 }
 function calendar(parent:HTMLElement,group:ActivityGroup,start:string,end:string,monthHeading:boolean){
  const state=selections.get(group),box=el('section',parent,undefined,'lp-activity-month');box.setAttribute('aria-label',monthHeading?monthName(start):'Неделя '+formatDate(start));
  if(monthHeading)el('h5',box,monthName(start));
  const headers=el('div',box,undefined,'lp-activity-weekheads');for(const day of ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'])el('span',headers,day);
  const grid=el('div',box,undefined,'lp-activity-days');for(let i=1;i<weekday(start);i++)el('span',grid,undefined,'lp-activity-blank');
  for(const date of dates(start,end)){if(date<selected.start||date>=selected.end){el('span',grid);continue;}const result=activityDay(group,date,asOf),b=button(grid,'',()=>{selections.day(group,selected,date);renderCard(parent.closest<HTMLElement>('.lp-activity-card')!,group);},'lp-activity-day is-'+result.state);b.dataset.statDate=date;b.dataset.activityFocus='day-'+date;b.setAttribute('aria-label',`${formatDate(date)} · ${descriptions[result.state]}${result.total.total?' · '+result.total.done+' из '+result.total.total:''}`);b.setAttribute('aria-pressed',String(state.day===date));if(date===asOf)b.setAttribute('aria-current','date');el('span',b,String(Number(date.slice(8))));const mark=el('span',b,marks[result.state],'lp-activity-mark');mark.setAttribute('aria-hidden','true');}
 }
}
