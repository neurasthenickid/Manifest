import type {LifeArea} from '../src/model';
import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultAreas,normalizeAreas,areaOptions,renameArea,areaStatisticsView,areaNoteFile,assertAreaSelection} from '../src/areas';
import {defaultSettings,normalizeSettings} from '../src/settings';
import {RecordStore,type FileIO} from '../src/storage';
import {newTask,base,dailyAreaRatingId} from '../src/domain';
import {dailyAreaSummary} from '../src/analytics';
import {period} from '../src/periods';
import {NotesService} from '../src/notes';
import {plainStyle,styleMedia,randomStyle,availablePresets} from '../src/appearance';
const custom=():LifeArea=>({id:'area-8a271fa4',title:'Здоровье и развитие',color:'#448877',icon:'leaf',enabled:true,titleHistory:[]});
function memory(){const files=new Map<string,string>();const io:FileIO={read:async p=>files.get(p)??null,write:async(p,t)=>{files.set(p,t);},mkdir:async()=>{},list:async p=>[...files.keys()].filter(k=>k.startsWith(p+'/')),create:async(p,t)=>{if(files.has(p))return false;files.set(p,t);return true;},replace:async(p,old,t)=>{assert.equal(files.get(p),old);files.set(p,t);}};return{files,io};}
test('old vault defaults retain IDs and intentionally empty/all-disabled lists survive reload',()=>{
 assert.deepEqual(normalizeSettings({}).areas.map(a=>a.id),['family','home','work','study','self']);
 for(const areas of [[],defaultAreas().map(a=>({...a,enabled:false}))]){const loaded=normalizeSettings(JSON.parse(JSON.stringify({...defaultSettings(),areas})));assert.deepEqual(loaded.areas,areas);assert.equal(areaOptions(loaded.areas).length,0);}
});
test('rename/order/disable/re-enable preserve source records and rating observations',async()=>{
 const {files,io}=memory(),store=new RecordStore(io);await store.load();const area=custom();
 const task=await store.save(newTask({title:'Историческая задача',areaId:area.id},'2026-10-01T12:00:00Z'),0);
 await store.save({...base('custom-event'),kind:'event',title:'Историческое событие',areaId:area.id,start:'2026-10-01T10:00',end:'2026-10-01T11:00',allDay:false,timezone:'Europe/Moscow'},0);
 await store.save({...base(dailyAreaRatingId('2026-10-01',area.id)),kind:'daily-area-rating',date:'2026-10-01',areaId:area.id,areaTitle:area.title,value:7,policyVersion:2},0);
 const before=[...files];const renamed=renameArea(area,'Самочувствие'),areas=[renamed,...defaultAreas()].reverse();renamed.enabled=false;
 const settings=normalizeSettings(JSON.parse(JSON.stringify({...defaultSettings(),areas})));assert.equal(settings.areas.find(a=>a.id===area.id)?.title,'Самочувствие');assert.equal(renameArea(renamed,'Самочувствие'),renamed);
 assert(!areaOptions(settings.areas).some(a=>a.id===area.id));assert.equal(areaOptions(settings.areas,task.areaId).at(-1)?.id,area.id);
 const summary=dailyAreaSummary(period('month','2026-10-01'),store.all('daily-area-rating'),'2026-10-12',settings.areas).find(a=>a.areaId===area.id)!;
 assert.equal(summary.mean,7);assert.equal(summary.count,1);assert.equal(summary.areaTitle,'Самочувствие');assert.deepEqual([...files],before);
 settings.areas.find(a=>a.id===area.id)!.enabled=true;assert(areaOptions(settings.areas).some(a=>a.id===area.id));await store.reload();assert.equal(store.get(task.id)?.id,task.id);assert.deepEqual([...files],before);
});
test('new areas have no fabricated old ratings and disabled unknown IDs stay editable',()=>{
 const area=custom();assert.deepEqual(dailyAreaSummary(period('year','2026-01-01'),[],'2026-10-12',[area]),[{areaId:area.id,areaTitle:area.title,mean:null,count:0}]);
 assert.equal(dailyAreaSummary(period('year','2026-01-01'),[],'2026-10-12',[]).length,0);assert.equal(areaOptions([],area.id)[0].id,area.id);assert.equal(normalizeAreas([area,{...area,title:'Duplicate'},{...area,id:'all'}]).length,1);
 assert.equal(normalizeSettings({calendarConnection:{areaId:area.id}}).calendarConnection.areaId,area.id);
});
test('wheel boundary policy covers zero, one, two, eight, nine and twenty enabled areas',()=>{for(const n of [0,1,2,3,8,9,20])assert.equal(areaStatisticsView(n),n>=3&&n<=8?'wheel':'bars');});
test('a sphere disabled while a new form is open cannot receive its save; existing scope stays unchanged',()=>{const areas=[{...custom(),enabled:false}];assert.throws(()=>assertAreaSelection(areas,areas[0].id));assert.doesNotThrow(()=>assertAreaSelection(areas,areas[0].id,areas[0].id));assert.throws(()=>assertAreaSelection(areas,'another',areas[0].id));areas[0].enabled=true;assert.doesNotThrow(()=>assertAreaSelection(areas,areas[0].id));const other=defaultSettings();areas[0].title='Local';assert(!other.areas.some(a=>a.id===areas[0].id));});
test('area notes use stable files and preserve user Markdown across rename/disable',async()=>{
 const {io,files}=memory();let settings={...defaultSettings(),areas:[custom()]};const notes=new NotesService(io,'Planner',()=>settings);
 files.set('Planner/Manifest.md','# Мой манифест\nСвой текст');await notes.ensureFoundation();const path=await notes.areaNote(settings.areas[0].id);files.set(path,'# Моя заметка\nНе менять!');const before=[...files];
 settings={...settings,areas:[{...renameArea(settings.areas[0],'Новое название'),enabled:false}]};await notes.ensureFoundation();assert.equal(await notes.areaNote(settings.areas[0].id),path);assert.deepEqual([...files],before);assert.equal(areaNoteFile(renameArea(defaultAreas()[0],'Родные')),'Семья.md');
});
test('built-in headers always resolve to static sources even with saved motion enabled',()=>{for(const preset of ['scene-petersburg','scene-novgorod','scene-moscow','scene-baikal','scene-altai'] as const){const style={...plainStyle(),preset,motion:true};assert.match(styleMedia(style,true)!.file,/^collection\/.+\.webp$/);assert.deepEqual(styleMedia(style,true),styleMedia(style,false));}});
test('strict random theme actually changes style/font and only uses the strict collection',()=>{const current=plainStyle(),next=randomStyle(current,'strict',()=>.8);assert.notDeepEqual(next,current);assert(availablePresets('strict').some(p=>p.id===next.preset));assert(!styleMedia(next,true)?.file.endsWith('.gif'));});
