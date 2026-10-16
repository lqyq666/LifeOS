import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import {createApp} from '../../server/http.ts'
test('current maintenance UI in Chrome: real auth, empty queue, source locators, revision diff, narrow screen, keyboard and recovery; no human approval',async()=>{
 const directory=process.env.LIFEOS_WORKFLOW_EVIDENCE??'.local/maintenance-browser';mkdirSync(directory,{recursive:true})
 const oldOrigin=config.origin,oldRole=process.env.LIFEOS_KB_MAINTAINER_IDS,app=createApp();await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(app.address() as any).port;config.origin=origin
 const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'})
 const errors:string[]=[],checks:any[]=[]
 try{
  const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'browser-maintenance-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID(),name:'Synthetic adult editor'})});assert.equal(signup.status,200)
  const cookie=signup.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '),session=await fetch(origin+'/api/session',{headers:{Cookie:cookie}});process.env.LIFEOS_KB_MAINTAINER_IDS=(await session.json()).id
  await context.addCookies(cookie.split('; ').map(x=>{const i=x.indexOf('=');return {name:x.slice(0,i),value:x.slice(i+1),url:origin}}));const page=await context.newPage();page.on('pageerror',(e:any)=>errors.push(e.message))
  await context.route('**/*',(r:any)=>r.request().url().startsWith(origin)?r.continue():r.abort())
  await page.goto(origin+'/#maintenance',{waitUntil:'networkidle'});await page.getByText('暂无待审稿。',{exact:false}).waitFor();checks.push({emptyQueue:'PASS_REAL_GET'})
  await page.getByRole('button',{name:'载入本批修订稿'}).click();await page.locator('aside li').first().waitFor();assert.equal(await page.locator('aside li').count(),32)
  await page.getByRole('button',{name:/第一次联系与未回应跟进/}).click();await page.getByRole('heading',{name:'原文定位'}).waitFor()
  await page.getByRole('region',{name:'独立审阅准备'}).getByRole('heading',{name:'本稿待核对事项'}).waitFor()
  const originals=await page.locator('section a[target="_blank"]').evaluateAll((els:any[])=>els.map(x=>x.href));assert.ok(originals.length&&originals.every((x:string)=>/^https?:\/\//.test(x)))
  checks.push({reviewPreparation:'PASS_REAL_AUTHENTICATED_READBACK',actualIndependentExecution:false})
  assert.equal(await page.getByRole('button',{name:'本人确认批准并发布此版本'}).count(),0,'editor cannot approve')
  for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:resolve(directory,'maintenance-'+width+'.png'),fullPage:true});checks.push({width,overflow:false,sourceLinks:originals.length})}
  await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement?.tagName!=='BODY'));assert.ok(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));checks.push({keyboard:'PASS_FOCUS',reducedMotion:'PASS_MEDIA'})
  await page.route('**/api/maintenance/guides',async(r:any)=>{await r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'SYNTHETIC_DISCONNECTION'})})});await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('alert').waitFor();await page.unroute('**/api/maintenance/guides');await page.getByRole('button',{name:'刷新',exact:true}).click();await page.locator('aside li').first().waitFor();assert.equal(await page.locator('aside li').count(),32);checks.push({errorRecovery:'PASS_REAL_REFRESH_AFTER_INJECTED_503'})
  await context.setOffline(true);await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('alert').waitFor();await context.setOffline(false);await page.getByRole('button',{name:'刷新',exact:true}).click();await page.locator('aside li').first().waitFor();checks.push({offlineRecovery:'PASS'})
  assert.deepEqual(errors,[]);writeFileSync(directory+'/MAINTENANCE_BROWSER.json',JSON.stringify({status:'PASS_CURRENT_CHROME_LOCAL_UI',checks,errors,realHumanApprovals:0,realIndependentReviews:0,publication:false,physicalPhone:false,temporaryServerClosedAfterTest:true},null,2)+'\n')
 }finally{await browser.close();config.origin=oldOrigin;oldRole===undefined?delete process.env.LIFEOS_KB_MAINTAINER_IDS:process.env.LIFEOS_KB_MAINTAINER_IDS=oldRole;app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));await pool.end()}
})
