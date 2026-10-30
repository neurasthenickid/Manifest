import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStyle,plainStyle,styleClock,styleMedia,availablePresets} from '../src/appearance';
import {normalizeSettings,defaultSettings,PERIOD_TYPES} from '../src/settings';
import {period} from '../src/periods';

test('legacy header previews are removed without losing scene/font/crop or changing source settings',()=>{
 const s=defaultSettings();s.mobileHeaderFocus={'scene-moscow':18};
 const old={...plainStyle(),preset:'scene-moscow' as const,font:'mono' as const,customFont:'Мой шрифт',preview:{season:'summer' as const,daypart:'day' as const}};
 s.decoration.notes['day:2026-02-12']=old;s.decoration.defaults.day=old;const original=JSON.stringify(s);
 const normalized=normalizeSettings(s);for(const value of [normalized.decoration.notes['day:2026-02-12'],normalized.decoration.defaults.day]){assert.equal(value.preview,undefined);assert.equal(value.preset,'scene-moscow');assert.equal(value.font,'mono');assert.equal(value.customFont,'Мой шрифт');}
 assert.equal(normalized.mobileHeaderFocus!['scene-moscow'],18);assert.equal(JSON.stringify(s),original);assert.deepEqual(normalizeSettings(normalized),normalized);
});
test('even an unnormalized legacy preview cannot override period season or actual local time',()=>{
 const now=new Date(2026,9,20,17,30),p=period('day','2026-02-12'),skin={...plainStyle(),preset:'scene-moscow' as const,preview:{season:'summer' as const,daypart:'night' as const}};
 assert.deepEqual(styleClock(skin,now,p),{season:'winter',daypart:'evening'});assert.match(styleMedia(skin,false,now,[],p)!.file,/winter-evening/);assert.equal(normalizeStyle(skin).preview,undefined);
});
test('calm theme is absent from user choices; old fixed calm defaults migrate to automatic with independent fields retained',()=>{
 for(const collection of ['all','strict'] as const)assert(!availablePresets(collection).some(v=>v.id==='plain'));
 const s=defaultSettings();for(const type of PERIOD_TYPES){s.decoration.modes![type]='fixed';s.decoration.defaults[type]={...plainStyle(),font:'mono',customFont:'Мой шрифт'};}
 s.decoration.notes['day:2000-01-01']={...plainStyle(),font:'serif'};s.decoration.enabled=false;
 const next=normalizeSettings(s);assert.equal(next.decoration.enabled,false);for(const type of PERIOD_TYPES){assert.equal(next.decoration.modes![type],'auto');assert.notEqual(next.decoration.defaults[type].preset,'plain');assert.equal(next.decoration.defaults[type].font,'mono');assert.equal(next.decoration.defaults[type].customFont,'Мой шрифт');}
 assert.equal(next.decoration.notes['day:2000-01-01'].headerMode,'auto');assert.equal(next.decoration.notes['day:2000-01-01'].font,'serif');
});

test('legacy calm style with an explicit vault image retains its independent manual path and framing key',()=>{
 const s=defaultSettings();s.mobileHeaderFocus={plain:16};s.decoration.notes['day:2026-02-14']={...plainStyle(),bannerPath:'Медиа/Своя.webp',font:'mono'};const next=normalizeSettings(s);
 assert.equal(next.decoration.notes['day:2026-02-14'].bannerPath,'Медиа/Своя.webp');assert.equal(next.decoration.notes['day:2026-02-14'].font,'mono');assert.equal(next.mobileHeaderFocus!.plain,16);
});
