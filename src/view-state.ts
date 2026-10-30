import type {StatisticsLevel} from './task-statistics';
import type { Period } from './model';
import { addDays, isLocalDate, period } from './periods';
export class PlannerViewState {
 area='all';statisticsLevel:StatisticsLevel='day';statisticsPeriod?:string;statisticsLevels?:Period['type'][];private date?:string;private listeners=new Set<()=>void>();
 dateFor(p:Period,today:string):string{return this.date&&this.date>=p.start&&this.date<p.end?this.date:today>=p.start&&today<p.end?today:p.start;}
 setDate(date:string){if(!isLocalDate(date))throw new Error('Некорректная выбранная дата');this.date=date;}
 setArea(area:string){if(this.area===area)return;this.area=area;for(const f of [...this.listeners])f();}
 setStatistics(level:StatisticsLevel,child?:string){this.statisticsLevel=level;this.statisticsLevels=undefined;this.statisticsPeriod=child;this.changed();}
 selectedStatistics(available:Period['type'][]){const chosen=this.statisticsLevels?this.statisticsLevels.filter(t=>available.includes(t)):this.statisticsLevel==='all'?[...available]:available.includes(this.statisticsLevel)?[this.statisticsLevel]:[available[0]];return chosen.length?chosen:[available[0]];}
 toggleStatistics(type:Period['type']|'all',available:Period['type'][]){const current=this.selectedStatistics(available);this.statisticsLevels=type==='all'?[...available]:current.includes(type)?current.length>1?current.filter(t=>t!==type):current:[...current,type];this.statisticsPeriod=undefined;this.changed();}
 private changed(){for(const f of [...this.listeners])f();}
 subscribe(fn:()=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn);};}
 adjacentDate(p:Period,direction:1|-1,today:string):string {
  const date=this.dateFor(p,today),target=period(p.type,direction===1?p.end:addDays(p.start,-1));
  if(p.type==='day'||p.type==='week')return addDays(date,direction*(p.type==='day'?1:7));
  const months=p.type==='month'?1:p.type==='quarter'?3:12;
  const stamp=new Date(date+'T12:00:00Z');stamp.setUTCDate(1);stamp.setUTCMonth(stamp.getUTCMonth()+direction*months);
  const first=stamp.toISOString().slice(0,10),last=addDays(period('month',first).end,-1),wanted=first.slice(0,8)+date.slice(8);
  const resolved=wanted<=last?wanted:last;return resolved>=target.start&&resolved<target.end?resolved:target.start;
 }
}
