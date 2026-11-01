import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const capture=process.argv[2]==='--capture',url=capture?process.argv[3]:'http://127.0.0.1:4173';
const fixture='tests/fixtures/compatibility-1.0.11.json',expected=capture?null:JSON.parse(await readFile(fixture,'utf8'));
await mkdir('test-results/compatibility',{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.MANIFEST_BROWSER_CHANNEL||undefined}),page=await browser.newPage({viewport:{width:390,height:1000},timezoneId:'Europe/Moscow',hasTouch:true}),results=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));
try{
 await page.clock.install({time:new Date('2026-11-01T12:00:00+03:00')});await page.goto(url);await page.waitForFunction(()=>window.plannerTest);
 for(const width of [320,360,390,412,1440])for(const font of [16,24])for(const dark of [false,true])for(const type of ['day','week']){
  await page.setViewportSize({width,height:1000});await page.evaluate(({font,dark})=>{document.body.classList.toggle('dark',dark);let style=document.querySelector('#compat-font');if(!style){style=document.createElement('style');style.id='compat-font';document.head.append(style);}style.textContent='.life-planner{font-size:'+font+'px!important}';},{font,dark});await page.evaluate(type=>plannerTest.open(type,'2026-10-18'),type);await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  const key=[width,font,dark,type].join('-'),metrics=await page.locator('#app .lp-nav').evaluate(nav=>{
   const r=nav.getBoundingClientRect(),style=getComputedStyle(nav),round=n=>Math.round(n*64)/64;
   return {width:round(r.width),height:round(r.height),display:style.display,gap:style.gap,buttons:[...nav.querySelectorAll('button')].map(button=>{const b=button.getBoundingClientRect(),s=getComputedStyle(button);return {text:button.textContent.trim(),x:round(b.left-r.left),y:round(b.top-r.top),width:round(b.width),height:round(b.height),color:s.color,background:s.backgroundColor,border:s.border,borderRadius:s.borderRadius,padding:s.padding,font:s.font};}),panelStyles:[...(nav.closest('#app')??document).querySelectorAll('.lp-space-title,.lp-day-heading,.lp-mini-week,.lp-month-event')].map(n=>{const s=getComputedStyle(n);return {cls:n.className,font:s.font,padding:s.padding,border:s.border,color:s.color};}),divider:[...nav.querySelectorAll('.lp-nav-divider')].map(n=>({display:getComputedStyle(n).display,border:getComputedStyle(n).borderLeft})),todayPseudo:['::before','::after'].map(p=>{const s=getComputedStyle(nav.querySelector('.lp-today-button'),p);return {content:s.content,width:s.width,height:s.height,background:s.backgroundColor};})};
  });
  assert.equal(await page.getByRole('group',{name:'Период заметки',exact:true}).count(),1,'Period group must remain accessible with display:contents');assert(metrics.buttons.every(b=>b.height>=44),key);assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),key);
  if(!capture)assert.deepEqual(metrics,expected.cases.find(c=>c.key===key)?.metrics,key);
  results.push({key,metrics});
  if(!capture&&width===390&&font===24&&type==='day')await page.locator('#app .lp-nav').screenshot({path:'test-results/compatibility/navigation-'+(dark?'dark':'light')+'.png'});
  if(!capture&&width===1440&&font===16&&type==='week'&&!dark)await page.screenshot({path:'test-results/compatibility/desktop-week.png',fullPage:false});
 }
 assert.deepEqual(errors,[]);
 if(capture)await writeFile(fixture,JSON.stringify({baseline:'Manifest 1.0.11',commit:'c8859e2c5c58678324172c6297bc578b3bf5869d',cases:results},null,2)+'\n',{flag:'wx'});
 else await writeFile('test-results/compatibility/layout.json',JSON.stringify({status:'PASS',comparisons:results.length,baseline:expected.commit,accessiblePeriodGroup:true,todayDesignUnchanged:true,realObsidian:'NOT RUN',Samsung:'NOT RUN',iPhone:'NOT RUN'},null,2));
 console.log((capture?'CAPTURE':'PASS')+' '+results.length+' navigation layouts, touch sizes, accessibility, themes and large text');
}catch(error){await page.screenshot({path:'test-results/compatibility/layout-failure.png',fullPage:true});throw error;}finally{await browser.close();}
