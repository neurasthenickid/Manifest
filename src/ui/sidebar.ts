import {ItemView,type WorkspaceLeaf,TFile} from 'obsidian';
import type LifePlannerPlugin from '../main';
import {period,today,addDays} from '../periods';
import {button,el} from './elements';
import {renderMiniCalendar} from './mini-calendar';
export const CALENDAR_VIEW='life-planner-calendar';
export class PlannerCalendarView extends ItemView {
 private date=today();private disposed=false;
 constructor(leaf:WorkspaceLeaf,private plugin:LifePlannerPlugin){super(leaf);}
 getViewType(){return CALENDAR_VIEW;}getDisplayText(){return 'Manifest · Календарь';}getIcon(){return 'calendar-days';}
 async onOpen(){this.contentEl.classList.add('life-planner','lp-sidebar');this.registerEvent(this.app.workspace.on('active-leaf-change',()=>{void this.follow();}));this.registerEvent(this.app.vault.on('create',()=>this.render()));this.registerEvent(this.app.vault.on('delete',()=>this.render()));this.render();await this.follow();}
 async onClose(){this.disposed=true;this.contentEl.replaceChildren();}
 private async follow(){if(!this.plugin.settings.sidebar.follow)return;const file=this.app.workspace.getActiveFile();if(!file||this.plugin.notes.isTemplate(file.path))return;try{const context=await this.plugin.notes.context(file.path);if(this.disposed)return;this.date=this.plugin.stateForActive().dateFor(context,today());this.render();}catch{/* Ordinary notes do not change calendar selection. */}}
 render(){
  if(this.disposed)return;this.contentEl.replaceChildren();
  this.contentEl.classList.toggle('lp-concept',this.plugin.settings.theme==='concept');this.contentEl.style.setProperty('--lp-accent',this.plugin.settings.accent);
  this.contentEl.style.setProperty('--lp-background',this.plugin.settings.background);
  const nav=el('div',this.contentEl,undefined,'lp-sidebar-nav');
  button(nav,'←',()=>{this.date=period('month',addDays(period('month',this.date).start,-1)).start;this.render();});
  button(nav,'→',()=>{this.date=period('month',this.date).end;this.render();});
  const month=period('month',this.date),folder='Planner/Journal/'+this.plugin.settings.folders.day+'/';
  const box=renderMiniCalendar(this.contentEl,month.start,(type,date)=>{this.date=date;this.render();void this.plugin.openPeriod(type,date).catch(e=>el('p',this.contentEl,String(e),'lp-error'));},this.date,date=>this.app.vault.getAbstractFileByPath(folder+date.slice(8)+'-'+date.slice(5,7)+'-'+date.slice(0,4)+'.md') instanceof TFile);
  const title=box.querySelector('.lp-mini-title')!;nav.insertBefore(title,nav.lastElementChild);const now=button(this.contentEl,'Сегодня',()=>{this.date=today();this.render();},'lp-sidebar-today');this.contentEl.insertBefore(now,box);
 }
}
