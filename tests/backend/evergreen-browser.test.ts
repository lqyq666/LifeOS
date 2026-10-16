import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import {createApp} from '../../server/http.ts'
import {grantEntitlement} from '../../server/entitlements.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {validateCoachCitations} from '../../server/coach-knowledge.ts'
import type {Engine} from '../../server/agent.ts'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const root='.planning/research/evergreen/',read=(name:string)=>readFileSync(root+name,'utf8').trim().split('\n').map(s=>JSON.parse(s))
test('full method expands safely on desktop and emulated phone with real auth and source withdrawal',async()=>{
 const cards=read('KB_GUIDES.jsonl'),card=cards.find(c=>c.guide.canonicalKey==='retrieval-practice')
 const engine:Engine=async input=>{const checked=await validateCoachCitations('先合上材料，回答一个已学问题，再对照原资料修正。',[{claimId:card.id}],[card],input.context.find(m=>m.id===input.run.source_message_id).content);input.staged.usedKnowledgeRefs=checked.refs;return {text:checked.text,usage:null}}
 const app=createApp(engine),oldOrigin=config.origin,oldAccess=config.entitlementsEnabled
 await new Promise<void>(done=>app.listen(0,'127.0.0.1',done))
 const origin='http://127.0.0.1:'+(app.address() as {port:number}).port;config.origin=origin;config.entitlementsEnabled=true
 const directory=resolve('.local/evergreen/browser');mkdirSync(directory,{recursive:true})
 const report:any={evidence:'REAL_CHROME_REAL_AUTH_ISOLATED_POSTGRESQL_SIMULATED_ENGINE',realProviderCalls:0,physicalPhone:false,checks:[],errors:[]}
 let browser:any
 try{
  await importEvergreenCorpus(cards,read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
  const url='/api/knowledge/'+card.id+'?revision=1'
  assert.equal((await fetch(origin+url)).status,401)
  const email='evergreen-browser-'+randomUUID()+'@example.invalid',password='Synthetic-'+randomUUID()
  const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,password,name:'Synthetic browser'})});assert.equal(signup.status,200)
  const cookie=signup.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')
  const user=(await (await fetch(origin+'/api/session',{headers:{Cookie:cookie}})).json() as any).id
  await grantEntitlement(user,5,new Date(Date.now()+86400000).toISOString())
  assert.equal((await fetch(origin+url,{headers:{Cookie:cookie}})).status,200)
  browser=await chromium.launch({channel:'chrome',headless:true})
  const context=await browser.newContext({viewport:{width:1280,height:900}})
  await context.route('**/*',(route:any)=>route.request().url().startsWith(origin)?route.continue():route.abort())
  const page=await context.newPage();page.on('pageerror',(e:any)=>report.errors.push(e.message))
  await page.goto(origin+'/',{waitUntil:'networkidle'})
  await page.getByRole('button',{name:'登录',exact:true}).click()
  await page.locator('dialog.lifeos-auth').getByRole('button',{name:'登录',exact:true}).click()
  await page.getByLabel('邮箱',{exact:true}).fill(email);await page.getByLabel('密码',{exact:true}).fill(password)
  await page.getByRole('form',{name:'邮箱登录'}).getByRole('button',{name:'登录',exact:true}).click()
  await page.locator('dialog.qa-page[open]').waitFor()
  await page.getByRole('textbox',{name:'想聊的事'}).fill('主动回忆怎么开始？')
  await page.getByRole('button',{name:'发送消息'}).click()
  const method=page.locator('.qa-full-method')
  await method.locator('summary').first().waitFor()
  await method.locator('summary').first().click()
  await method.getByRole('heading',{name:card.title,exact:true}).waitFor()
  assert.ok((await method.innerText()).includes(card.limitations))
  assert.equal(await page.locator('.qa-message-body script').count(),0)
  await page.screenshot({path:resolve(directory,'desktop.png'),fullPage:true});report.checks.push('desktop native details: full guide, scope and source visible')
  await page.setViewportSize({width:390,height:844})
  await method.locator('.qa-full-method-body details summary').first().click()
  await method.getByRole('listitem').first().waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  await page.screenshot({path:resolve(directory,'mobile.png'),fullPage:true});report.checks.push('emulated 390px phone: executable branch visible without horizontal overflow')
  await pool.query("UPDATE kb_sources SET status='retired' WHERE source_id='ies-learning'")
  assert.equal((await fetch(origin+url,{headers:{Cookie:cookie}})).status,409)
  report.checks.push('read-only endpoint rejects withdrawn source and rejects unauthenticated access')
  assert.deepEqual(report.errors,[]);report.status='PASS'
 }finally{writeFileSync(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();app.closeAllConnections();await new Promise<void>(done=>app.close(()=>done()));config.origin=oldOrigin;config.entitlementsEnabled=oldAccess;await pool.end()}
})
