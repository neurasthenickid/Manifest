import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {sourceHashes} from './fingerprint.mjs';
const {chromium}=await import(process.argv[2]?pathToFileURL(process.argv[2]).href:'playwright');
const browser=await chromium.launch({channel:process.env.MANIFEST_BROWSER_CHANNEL||undefined,headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},timezoneId:'Europe/Moscow',hasTouch:true});
const errors=[],checks=[];page.on('pageerror',e=>errors.push(String(e)));
const check=async(name,fn)=>{await fn();checks.push({name,status:'PASS'});console.log('PASS '+name);};
const open=(type,date='2026-10-28')=>page.evaluate(({type,date})=>window.plannerTest.open(type,date),{type,date});
const settle=()=>page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
await mkdir('test-results/month-cards',{recursive:true});
try{
 await page.addInitScript(()=>{const Native=window.ResizeObserver;window.__activeMonthObservers=new Map();window.ResizeObserver=class extends Native{
  observe(target,options){super.observe(target,options);let targets=window.__activeMonthObservers.get(this);if(!targets){targets=new Set();window.__activeMonthObservers.set(this,targets);}targets.add(target);}
  unobserve(target){super.unobserve(target);const targets=window.__activeMonthObservers.get(this);targets?.delete(target);if(!targets?.size)window.__activeMonthObservers.delete(this);}
  disconnect(){super.disconnect();window.__activeMonthObservers.delete(this);}
 };});
 await page.route('http://127.0.0.1:4173/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const files={'/':'index.html','/ui.js':'ui.js','/styles.css':'styles.css'};
  if(files[path])await route.fulfill({body:await readFile('dist/preview/'+files[path]),contentType:path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':'text/html'});
  else await route.fulfill({status:404,body:''});
 });
 await page.clock.install({time:new Date('2026-10-28T12:00:00+03:00')});await page.goto('http://127.0.0.1:4173');await page.waitForFunction(()=>window.plannerTest);
 await page.evaluate(async()=>{const s=window.plannerNew.settings();for(const type of ['day','week','month','quarter','year'])s.layouts[type]=['calendar'];s.decoration.enabled=false;await window.plannerNew.configure(s);await window.plannerTest.modular();document.querySelector('#app').style.maxWidth='none';});
 await check('Production quarter/year: three columns, correct card count, full date today, classic week column',async()=>{
  await open('quarter');await settle();assert.equal(await page.locator('.lp-overview-month').count(),3);
  const tops=await page.locator('.lp-overview-month').evaluateAll(a=>a.map(n=>n.getBoundingClientRect().top));assert(tops.every(t=>Math.abs(t-tops[0])<1));
  assert.equal(await page.locator('.lp-overview-date.is-today').count(),2);assert(await page.locator('.lp-overview-date.is-today').evaluateAll(a=>a.every(n=>n.dataset.date==='2026-10-28')));
  assert.equal(await page.locator('.lp-overview-head').first().innerText(),'№\nПн\nВт\nСр\nЧт\nПт\nСб\nВс');
  await page.locator('#app').screenshot({path:'test-results/month-cards/quarter-desktop.png'});
  await open('year');await settle();assert.equal(await page.locator('.lp-overview-month').count(),12);
  const rows=await page.locator('.lp-overview-month').evaluateAll(a=>new Set(a.map(n=>Math.round(n.getBoundingClientRect().top))).size);assert.equal(rows,4);
  await page.locator('#app').screenshot({path:'test-results/month-cards/year-desktop.png'});
 });
 await check('All 1–6 neighboring groups, full Russian labels, outer centers and safe inner gaps in real years',async()=>{
  const counts=new Set();
  for(const year of [2020,2021,2026]){
   await open('year',year+'-10-28');await settle();
   const groups=await page.locator('.lp-overview-neighbors').evaluateAll(a=>a.map(g=>{
    const ds=[...g.querySelectorAll('[data-date]')],caption=g.querySelector('.lp-overview-caption'),label=caption.firstElementChild,r=caption.getBoundingClientRect(),t=label.getBoundingClientRect(),first=ds[0].getBoundingClientRect(),last=ds.at(-1).getBoundingClientRect(),style=getComputedStyle(caption);
    return {count:ds.length,dates:ds.map(d=>d.dataset.date),label:label.textContent,outerLeft:r.left,outerRight:r.right,first:(first.left+first.right)/2,last:(last.left+last.right)/2,left:parseFloat(style.getPropertyValue('--left-line')),right:parseFloat(style.getPropertyValue('--right-line')),textLeft:t.left,textRight:t.right};
   }));
   for(const g of groups){counts.add(g.count);assert(g.dates.every(d=>d.slice(0,7)===g.dates[0].slice(0,7)));assert(Math.abs(g.outerLeft-g.first)<1);assert(Math.abs(g.outerRight-g.last)<1);assert(g.left>=0&&g.right>=0);if(g.left)assert(g.outerLeft+g.left<=g.textLeft-3);if(g.right)assert(g.outerRight-g.right>=g.textRight+3);if(g.count>1)assert.equal(g.label,new Date(g.dates[0]+'T12:00:00Z').toLocaleDateString('ru-RU',{month:'long',timeZone:'UTC'}));}
  }
  assert.deepEqual([...counts].sort(),[1,2,3,4,5,6]);
 });
 await check('Actual day, neighboring day, ISO week and month actions preserve routing; keyboard works',async()=>{
  await open('quarter');await page.locator('[data-month="2026-10-01"] [data-date="2026-09-30"]').click();assert.equal(await page.locator('.lp-overview-month').count(),0);assert.match(await page.locator('#app').innerText(),/30.09.2026/);
  await open('year','2021-01-01');await page.locator('[data-month="2021-01-01"] .lp-overview-week').first().click();assert.match(await page.locator('#app').innerText(),/28.12.2020/);
  await open('quarter');await page.locator('[data-month="2026-11-01"] .lp-overview-title').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.lp-overview-month').count(),0);
  await open('quarter');await page.locator('[data-month="2026-10-01"] [data-date="2026-10-20"]').click();assert.match(await page.locator('#app').innerText(),/20.10.2026/);
 });
 await check('Two through six neighboring dates with long labels on 320px touch viewport',async()=>{
  await page.setViewportSize({width:320,height:1000});
  for(const year of [2020,2021,2022,2023,2024,2025,2026]){
   await open('year',year+'-10-01');await settle();
   assert(await page.locator('.lp-overview-caption>span').evaluateAll(a=>a.every(n=>{const r=n.getBoundingClientRect(),card=n.closest('.lp-overview-month').getBoundingClientRect();return r.left>=card.left&&r.right<=card.right;})));
  }
  await open('quarter','2025-10-01');const group=page.locator('[data-month="2025-10-01"] .lp-overview-neighbors').first();assert.equal(await group.getAttribute('data-count'),'2');assert.equal(await group.locator('.lp-overview-caption').innerText(),'сентябрь');await group.locator('[data-date="2025-09-30"]').tap();assert.match(await page.locator('#app').innerText(),/30.09.2025/);
 });
 const before=await page.evaluate(()=>window.plannerTest.sourceRecords());
 for(const width of [320,360,390,430,736,1000,1440])for(const font of [16,24])for(const dark of [false,true])for(const type of ['quarter','year']){
  await check(`Production ${type} width${width} font${font} ${dark?'dark':'light'}`,async()=>{
   await page.setViewportSize({width,height:width===736?430:1100});await page.evaluate(({font,dark})=>{document.body.classList.toggle('dark',dark);let style=document.querySelector('#month-font');if(!style){style=document.createElement('style');style.id='month-font';document.head.append(style);}style.textContent='.life-planner{font-size:'+font+'px!important}';},{font,dark});await open(type);await settle();
   const metrics=await page.locator('.lp-overview-month').evaluateAll(cards=>cards.map(card=>{
    const r=card.getBoundingClientRect();return {width:r.width,overflow:card.scrollWidth-card.clientWidth,labels:[...card.querySelectorAll('.lp-overview-caption>span')].map(n=>{const t=n.getBoundingClientRect();return {left:t.left-r.left,right:t.right-r.right,height:t.height};}),dates:[...card.querySelectorAll('[data-date]')].map(n=>{const t=n.getBoundingClientRect(),s=n.firstElementChild.getBoundingClientRect();return {height:t.height,over:s.width-t.width};})};
   }));
   // Linux/Windows font metrics can differ by a few Chromium layout units
   // (1/64 CSS px). Keep the one-pixel allowance plus a subpixel rounding budget.
   const dateOverflowTolerance=1+3/64;
   for(const m of metrics){assert(m.overflow<=1,JSON.stringify(m));assert(m.labels.every(l=>l.left>=-1&&l.right<=1),JSON.stringify(m));if(!m.dates.every(d=>d.height>=44&&d.over<=dateOverflowTolerance))await page.screenshot({path:'test-results/month-cards/failure.png'});assert(m.dates.every(d=>d.height>=44&&d.over<=dateOverflowTolerance),JSON.stringify(m));}
   if(width<=430){const tops=await page.locator('.lp-overview-month').evaluateAll(a=>a.map(n=>n.getBoundingClientRect().top));assert(tops[1]>tops[0]);}
   if(width===390&&font===16&&dark&&type==='quarter')await page.locator('#app').screenshot({path:'test-results/month-cards/quarter-mobile.png'});
  });
 }
 await check('Narrow desktop pane responds to container, no source record mutations; sidebar/month unaffected',async()=>{
  await page.setViewportSize({width:1440,height:1100});await page.evaluate(()=>document.querySelector('#app').style.maxWidth='420px');await open('quarter');await settle();const tops=await page.locator('.lp-overview-month').evaluateAll(a=>a.map(n=>n.getBoundingClientRect().top));assert(tops[1]>tops[0]);assert.deepEqual(await page.evaluate(()=>window.plannerTest.sourceRecords()),before);
  await open('month');assert.equal(await page.locator('.lp-overview-month').count(),0);await page.evaluate(()=>window.plannerNew.openSidebar());assert(await page.locator('#sidebar-fixture .lp-mini-grid').count());assert.equal(await page.locator('#sidebar-fixture .lp-overview-month').count(),0);
  await page.evaluate(()=>window.plannerTest.unmountAll());await settle();assert.equal(errors.length,0,errors.join('\n'));
 });
 await check('Repeated quarter/year replacement releases observers and detached date targets',async()=>{
  await open('quarter');await settle();const before=await page.evaluate(()=>window.__activeMonthObservers.size);
  for(let i=0;i<12;i++){await open(i%2?'quarter':'year');await settle();}
  assert.equal(await page.evaluate(()=>window.__activeMonthObservers.size),before);
  await page.evaluate(()=>window.plannerTest.unmountAll());await settle();
  assert.equal(await page.evaluate(()=>[...window.__activeMonthObservers.values()].flatMap(s=>[...s]).filter(n=>!n.isConnected).length),0);assert.deepEqual(errors,[]);
 });
 const report={status:'PASS',checks,errors,realObsidian:'NOT RUN',Samsung:'NOT RUN',iPhone:'NOT RUN',sources:await sourceHashes()};await writeFile('test-results/month-cards/ui-report.json',JSON.stringify(report,null,2));
 console.log('TOTAL '+checks.length);
}finally{await browser.close();}
