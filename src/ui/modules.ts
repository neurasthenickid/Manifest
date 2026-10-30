import type { PeriodType } from '../model';
export const WIDGET_MODULES = ['navigation','calendar','tasks','day-rating','area-ratings','habits','morning','evening','workout','plans','overview','day-stats','area-stats','task-stats','habit-stats','routine-stats','workout-stats','tools'] as const;
export type WidgetModule = typeof WIDGET_MODULES[number] | 'all';
export function canonicalModule(module:WidgetModule):WidgetModule{return module==='plans'?'task-stats':module;}
export function canonicalLayout(layout:WidgetModule[]):WidgetModule[]{return [...new Set(layout.map(canonicalModule))];}
export function widgetModule(source:string):WidgetModule {
  const value=source.trim();if(!value||value==='all')return 'all';
  if(!(WIDGET_MODULES as readonly string[]).includes(value))throw new Error(`Неизвестный виджет Manifest: ${value}`);
  return value as WidgetModule;
}
export function periodModules(type:PeriodType):WidgetModule[] {
  return type==='day'?['navigation','calendar','tasks','day-rating','area-ratings','habits','morning','evening','workout','tools']:['navigation','calendar','tasks','task-stats','overview','day-stats','area-stats','habit-stats','routine-stats','workout-stats','tools'];
}
export function widgetBlocks(type:PeriodType):string {return '```life-planner\nall\n```';}
