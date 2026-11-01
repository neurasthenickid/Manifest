import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
await mkdir('test-results/compatibility',{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.MANIFEST_BROWSER_CHANNEL||undefined});
const page=await browser.newPage({viewport:{width:390,height:950},timezoneId:'Europe/Moscow',hasTouch:true}),errors=[];
page.on('pageerror',error=>errors.push(String(error)));
try{
 await page.goto('http://127.0.0.1:4173');await page.waitForFunction(()=>window.compatibilityTest);
 const checks=await page.evaluate(()=>window.compatibilityTest.run());assert.equal(checks.length,6);assert.deepEqual(errors,[]);
 await writeFile('test-results/compatibility/multi-document.json',JSON.stringify({status:'PASS',checks,browser:await browser.version(),realObsidian:'NOT RUN',actualPopout:'NOT RUN',Samsung:'NOT RUN',iPhone:'NOT RUN'},null,2));
 console.log('PASS compatibility: '+checks.length+' multi-document/resource groups');
}catch(error){await page.screenshot({path:'test-results/compatibility/failure.png',fullPage:true});await writeFile('test-results/compatibility/multi-document.json',JSON.stringify({status:'FAIL',error:String(error),errors},null,2));throw error;}finally{await browser.close();}
