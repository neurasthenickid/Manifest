import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings,normalizeSettings,PERIOD_TYPES} from '../src/settings';
import {noteStyle,plainStyle,resolveNoteAppearance,styleClock,styleKey,resetAutomaticHeader,randomStyle,styleMedia,availablePresets} from '../src/appearance';
import {rankedHeaderScenes,headerHash} from '../src/header-selection';
import {HEADER_SCENES} from '../src/header-catalog';
import {period,addDays} from '../src/periods';
const now=new Date(2026,9,20,17,30);
const ids=HEADER_SCENES.map(s=>s.id);
const select=(date:string,type:typeof PERIOD_TYPES[number]='day')=>rankedHeaderScenes(period(type,date),ids)[0];

test('rendezvous is deterministic, canonical, order independent, deduplicated and diverse for all five periods',()=>{
 for(const type of PERIOD_TYPES){const seen=new Set<string>();for(let i=0;i<120;i++){
  const date=addDays('2024-01-01',i*37),p=period(type,date),rank=rankedHeaderScenes(p,ids);
  assert.deepEqual(rank,rankedHeaderScenes(p,[...ids].reverse().concat(ids)));
  assert.equal(select(date,type),rank[0]);seen.add(rank[0]);
  assert.deepEqual(rank,rankedHeaderScenes({...p,start:addDays(p.start,type==='day'?0:1)},ids));
 }assert(seen.size>=8,`${type}: ${seen.size}`);}
 assert.equal(headerHash('abc'),headerHash('abc'));assert.notEqual(headerHash('abc'),headerHash('abd'));
});
test('rendezvous only moves assignments to a newly added scene or off a removed winner',()=>{
 for(let i=0;i<600;i++){
  const p=period('day',addDays('2025-01-01',i)),old=rankedHeaderScenes(p,ids)[0],added=rankedHeaderScenes(p,[...ids,'scene-new'])[0];
  assert(added===old||added==='scene-new');const removed=ids[0],next=rankedHeaderScenes(p,ids.filter(id=>id!==removed))[0];
  if(old!==removed)assert.equal(next,old);
 }
});
test('hundreds of views do not mutate settings or write date assignments; reload reproduces all choices',()=>{
 const s=defaultSettings(),before=JSON.stringify(s),copy=normalizeSettings(JSON.parse(before));
 for(let i=0;i<730;i++){const p=period('day',addDays('2024-01-01',i));assert.deepEqual(resolveNoteAppearance(s.decoration,p,now),resolveNoteAppearance(copy.decoration,p,now));}
 assert.equal(JSON.stringify(s),before);assert.deepEqual(s.decoration.notes,{});
});
test('period calendar season and local time: leap day, Dec/Jan, season boundaries, cross-boundary week, month/quarter/year',()=>{
 for(const [type,date,season] of [
  ['day','2024-02-29','winter'],['day','2026-12-31','winter'],['day','2027-01-01','winter'],
  ['day','2026-03-01','spring'],['day','2026-06-01','summer'],['day','2026-09-01','autumn'],
  ['week','2026-03-01','winter'],['week','2026-06-01','summer'],['week','2026-09-01','summer'],
  ['month','2026-02-12','winter'],['quarter','2026-05-31','spring'],['year','2026-10-20','winter']
 ] as const){const p=period(type,date),clock=styleClock(plainStyle(),now,p);assert.equal(clock.season,season);assert.equal(clock.daypart,season==='summer'?'day':'evening');}
 const s=defaultSettings();s.decoration.collection='strict';const p=period('day','2026-02-12');
 assert.match(resolveNoteAppearance(s.decoration,p,now).media!.file,/winter-evening/);
});
test('morning/day/evening/night changes media but keeps scene in a complete catalogue',()=>{
 const s=defaultSettings();s.decoration.collection='strict';
 for(const date of ['2026-02-12','2026-04-12','2026-07-12','2026-10-12']){
  const p=period('day',date),choices=[7,13,date.slice(5,7)==='07'?20:17,0].map(hour=>resolveNoteAppearance(s.decoration,p,new Date(2030,9,1,hour)));
  assert.equal(new Set(choices.map(c=>c.style.preset)).size,1);assert.equal(new Set(choices.map(c=>c.media!.file)).size,4);
 }
});
test('season-specific time boundaries use the open period, not the current season',()=>{
 const winter=period('day','2026-01-01'),summer=period('day','2026-07-01');
 assert.equal(styleClock(plainStyle(),new Date(2026,9,20,18,31),winter).daypart,'night');
 assert.equal(styleClock(plainStyle(),new Date(2026,9,20,18,31),summer).daypart,'evening');
});
test('legacy modes migrate once, fixed values and all manual styles survive; explicit modes persist',()=>{
 const legacy=defaultSettings();delete legacy.decoration.modes;legacy.decoration.defaults.day.preset='scene-moscow';
 legacy.decoration.notes['day:2000-01-01']={...plainStyle(),preset:'scene-altai',font:'mono',customFont:'Мой шрифт'};
 const migrated=normalizeSettings(legacy);assert.equal(migrated.decoration.modes!.day,'auto');assert.equal(migrated.decoration.defaults.day.preset,'scene-moscow');
 assert.deepEqual(migrated.decoration.notes,legacy.decoration.notes);migrated.decoration.modes!.day='fixed';
 const restart=normalizeSettings(JSON.parse(JSON.stringify(migrated)));assert.equal(restart.decoration.modes!.day,'fixed');
 assert.equal(noteStyle(restart.decoration,period('day','2026-01-01')).preset,'scene-moscow');
 assert.equal(noteStyle(restart.decoration,period('day','2000-01-01')).preset,'scene-altai');
});
test('no arbitrary manual-note expiry or 5000 entry truncation',()=>{
 const s=defaultSettings();for(let i=0;i<5100;i++)s.decoration.notes['day:'+addDays('2000-01-01',i)]={...plainStyle(),font:'mono'};
 assert.equal(Object.keys(normalizeSettings(s).decoration.notes).length,5100);
});
test('reset releases only image; manual font, custom font, motion and preview survive reload',()=>{
 const s=defaultSettings(),p=period('day','2026-02-12'),key=styleKey(p);
 s.decoration.notes[key]={...plainStyle(),preset:'scene-moscow',bannerPath:'Media/manual.png',font:'mono',customFont:'Мой шрифт',motion:false,preview:{season:'summer',daypart:'night'}};
 assert.equal(resolveNoteAppearance(s.decoration,p,now).media!.file,'Media/manual.png');resetAutomaticHeader(s.decoration,p);
 const saved=normalizeSettings(JSON.parse(JSON.stringify(s))),choice=resolveNoteAppearance(saved.decoration,p,now);
 assert.equal(choice.style.font,'mono');assert.equal(choice.style.customFont,'Мой шрифт');assert.equal(choice.style.motion,false);
 assert.equal(choice.style.preview,undefined);assert.notEqual(choice.media?.file,'Media/manual.png');
 assert.equal(saved.decoration.notes[key].headerMode,'auto');
});
test('automatic only changes header: default/manual fonts and original settings remain intact',()=>{
 const s=defaultSettings();s.decoration.defaults.day.font='jetbrains';s.decoration.defaults.day.customFont='Custom';const before=JSON.stringify(s);
 for(let i=0;i<50;i++){const v=noteStyle(s.decoration,period('day',addDays('2026-01-01',i)),now);assert(HEADER_SCENES.some(scene=>scene.id===v.preset));assert.equal(v.font,'jetbrains');assert.equal(v.customFont,'Custom');}
 assert.equal(JSON.stringify(s),before);
});
test('disabled headers produce plain style, fixed mode respects defaults, manual plain overrides automatic',()=>{
 const s=defaultSettings(),p=period('day','2026-02-12');s.decoration.modes!.day='fixed';s.decoration.defaults.day.preset='scene-moscow';
 assert.equal(noteStyle(s.decoration,p).preset,'scene-moscow');s.decoration.notes[styleKey(p)]=plainStyle();s.decoration.modes!.day='auto';
 assert.ok(resolveNoteAppearance(s.decoration,p,now).media);s.decoration.enabled=false;assert.deepEqual(noteStyle(s.decoration,p),plainStyle());
});
test('partial/empty/updated collection: exact compatible same scene, next compatible scene, no cross-season fallback',()=>{
 const s=defaultSettings();s.decoration.collection='strict';const p=period('day','2026-02-12'),full=resolveNoteAppearance(s.decoration,p,now);
 assert.equal(resolveNoteAppearance(s.decoration,p,now,()=>false).media,undefined);
 const onlyWinter=(file:string)=>/winter-evening/.test(file);assert.deepEqual(resolveNoteAppearance(s.decoration,p,now,onlyWinter),full);
 const other=HEADER_SCENES.find(v=>v.id!==full.style.preset&&v.variants.some(v=>v.season==='winter'&&v.daypart==='evening'))!;
 const otherFile=other.variants.find(v=>v.season==='winter'&&v.daypart==='evening')!.file;
 assert.equal(resolveNoteAppearance(s.decoration,p,now,file=>file===otherFile).style.preset,other.id);
 assert.equal(resolveNoteAppearance(s.decoration,p,now,file=>file.includes('spring-day')).media,undefined);
 assert.deepEqual(resolveNoteAppearance(s.decoration,p,now),full);
});
test('neutral scenes and user cover metadata respect filters/availability without variant-count weighting',()=>{
 const s=defaultSettings(),p=period('day','2026-02-12');s.decoration.covers=[{id:'own',path:'Media/own.png',title:'Своя',season:'summer',daypart:'day'}];
 assert.equal(resolveNoteAppearance(s.decoration,p,now,(_,builtin)=>!builtin).media,undefined);
 s.decoration.covers[0].season='any';s.decoration.covers[0].daypart='any';assert.equal(resolveNoteAppearance(s.decoration,p,now,(_,builtin)=>!builtin).media?.file,'Media/own.png');
 s.decoration.collection='strict';assert.equal(resolveNoteAppearance(s.decoration,p,now,(_,builtin)=>!builtin).media,undefined);
 const neutral=HEADER_SCENES.find(s=>s.variants.some(v=>v.season===null))!;
 assert.ok(styleMedia({...plainStyle(),preset:neutral.id},false,now,[],p));
 assert.equal(rankedHeaderScenes(p,ids.flatMap(id=>[id,id,id])).length,ids.length);
});
test('legacy preview is ignored; random still chooses a different compatible image for the period',()=>{
 const s=defaultSettings(),p=period('day','2026-02-12');s.decoration.collection='strict';s.decoration.notes[styleKey(p)]={...plainStyle(),headerMode:'auto',preview:{season:'summer',daypart:'night'}};
 const current=resolveNoteAppearance(s.decoration,p,now).style;assert.match(styleMedia(current,false,now,[],p)!.file,/winter-evening/);
 for(let i=0;i<50;i++){const next=randomStyle(current,'strict',()=>i/50,[],now,p);assert.notEqual(next.preset,current.preset);assert.equal(next.headerMode,undefined);assert.deepEqual(next.preview,current.preview);}
 assert(availablePresets('strict').length>1);assert.equal(p.start,'2026-02-12');
});

test('missing fixed/manual builtin temporarily falls back compatibly without overwriting the requested scene',()=>{
 const s=defaultSettings(),p=period('day','2026-02-12');s.decoration.collection='strict';s.decoration.modes!.day='fixed';s.decoration.defaults.day.preset='scene-moscow';
 const other='collection/petersburg-winter-evening.webp',available=(file:string)=>file===other;
 assert.equal(resolveNoteAppearance(s.decoration,p,now,available).media?.file,other);assert.equal(s.decoration.defaults.day.preset,'scene-moscow');
 s.decoration.notes[styleKey(p)]={...plainStyle(),preset:'scene-moscow',font:'mono'};assert.equal(resolveNoteAppearance(s.decoration,p,now,available).media?.file,other);
 assert.equal(resolveNoteAppearance(s.decoration,p,now).style.preset,'scene-moscow');assert.equal(s.decoration.notes[styleKey(p)].preset,'scene-moscow');
});
