/** Synthetic records for isolated tests only. Never imported by plugin runtime. */
import {base,newCheckin,setDefinitionVersion,workoutSessionId} from '../src/domain';
import type {Definition,Checkin,PlannerRecord} from '../src/model';
export function activityFixtureRecords():PlannerRecord[]{
 const week=[1,2,3,4,5,6,7];
 const definition=(id:string,type:Definition['type'],title:string,start:string,ids:string[]):Definition=>({...base(id),kind:'definition',type,versions:[{effectiveDate:start,title,weekdays:week,items:ids.map((id,i)=>({id,title:(type==='workout'?'Упражнение ':'Пункт рутины ')+(i+1)}))}]});
 const record=(def:Definition,date:string,done:string[],session?:string):Checkin=>{const c={...newCheckin(def,date),finalized:true,comment:'Синтетическая подтверждённая запись',states:Object.fromEntries(done.map(id=>[id,true]))};return session?{...c,schemaVersion:2,sessionId:session,id:workoutSessionId(def.id,date,session)}:c;};
 const original=definition('activity-workout-a','workout','Прежнее имя программы','2026-01-01',['a','b','c']),may=record(original,'2026-05-05',['a','b','c']);
 const a=setDefinitionVersion(original,{effectiveDate:'2026-07-01',title:'Сила · новая версия программы',weekdays:week,items:[{id:'a',title:'Приседания'},{id:'c',title:'Планка'},{id:'d',title:'Новое упражнение'}]}),b=definition('activity-workout-b','workout',a.versions[1].title,'2026-01-01',['same-title-1','same-title-2']);b.versions[0].items.forEach(i=>i.title='Одинаковое название упражнения');
 const empty=definition('activity-workout-empty','workout','Очень длинное название программы для проверки переноса текста и сохранения спокойного дизайна','2026-10-01',['empty-item']);
 let morning=definition('activity-morning','morning','Утренняя рутина','2026-10-15',['m1','m2','m3']);const m20=record(morning,'2026-10-20',['m1','m2','m3']),m21=record(morning,'2026-10-21',[]);morning=setDefinitionVersion(morning,{...morning.versions[0],effectiveDate:'2026-10-22',items:[...morning.versions[0].items,{id:'m4',title:'Добавлено позднее · не меняет прошлые итоги'}]});
 const evening=definition('activity-evening','evening','Вечерняя рутина','2026-10-18',['e1','e2']);
 return[a,b,empty,morning,evening,may,record(a,'2026-10-20',['a','c','d']),record(a,'2026-10-20',['a'],'second'),record(a,'2026-10-21',[]),{...record(a,'2026-10-22',['a']),finalized:false},record(a,'2026-10-27',['a','c','d']),record(b,'2026-10-20',['same-title-1','same-title-2']),m20,m21,record(morning,'2026-10-23',['m1']),record(evening,'2026-10-20',['e1']),record(evening,'2026-10-21',['e1','e2'])];
}

