import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSettings,defaultSettings} from '../src/settings';
import {availablePresets,randomStyle,styleMedia,STYLE_PRESETS} from '../src/appearance';

test('TimeGarden defaults and note overrides migrate once without changing appearance fields or input',()=>{
 for(const [old,replacement] of Object.entries({city:'scene-petersburg',rooftops:'scene-novgorod',sunset:'scene-moscow',moon:'scene-baikal',mountain:'scene-altai'})){
  const saved={preset:old,font:'literata',customFont:'Мой шрифт',bannerPath:'Медиа/Своя.webp',motion:false,preview:{season:'winter',daypart:'night'}};
  const input={...defaultSettings(),decoration:{...defaultSettings().decoration,defaults:{day:saved},notes:{'day:2026-10-18':saved}}},before=JSON.stringify(input);
  const settings=normalizeSettings(input);
  for(const style of [settings.decoration.defaults.day,settings.decoration.notes['day:2026-10-18']]){
   const {preview:ignored,...expected}=saved;assert.deepEqual(style,{...expected,preset:replacement});
   assert.match(styleMedia({...style,bannerPath:''},true)!.file,/^collection\/.+\.webp$/);
  }
  assert.equal(JSON.stringify(input),before);assert.deepEqual(normalizeSettings(settings),settings);
 }
});

test('TimeGarden is absent from all selectors and fresh defaults',()=>{
 const retired=new Set(['city','rooftops','sunset','moon','mountain']);
 for(const presets of [STYLE_PRESETS,availablePresets('all'),availablePresets('strict')])assert(!presets.some(p=>retired.has(p.id)||/^(river|garden|season|forest|year)(-still)?\.(gif|jpg|webp)$/.test(p.file)));
 for(const style of Object.values(defaultSettings().decoration.defaults))assert(!retired.has(style.preset));
});

test('withdrawn covers migrate both defaults and note overrides without losing unrelated appearance',()=>{
 const input=defaultSettings();
 for(const [old,replacement] of [['openForest','scene-novgorod'],['openNeon','scene-baikal'],['openJapan','scene-altai']]){
  const saved={preset:old,font:'literata',customFont:'Мой шрифт',bannerPath:'Медиа/Своя.webp',motion:false};
  const settings=normalizeSettings({...input,decoration:{...input.decoration,defaults:{...input.decoration.defaults,week:saved},notes:{'day:2026-10-09':saved}}});
  for(const skin of [settings.decoration.defaults.week,settings.decoration.notes['day:2026-10-09']]){
   assert.deepEqual(skin,{...saved,preset:replacement});
   assert.equal(styleMedia({...skin,bannerPath:''},false)?.builtin,true);
  }
 }
 for(const collection of ['all','strict'] as const){
  const presets=availablePresets(collection);
  assert(!presets.some(p=>/^open(Forest|Neon|Japan)$/.test(p.id)));
  // Walk every random bucket to ensure a removed asset cannot reappear.
  for(let i=0;i<presets.length*3;i++)assert(!randomStyle(input.decoration.defaults.day,collection,()=>i/(presets.length*3)).preset.startsWith('open'));
 }
});
