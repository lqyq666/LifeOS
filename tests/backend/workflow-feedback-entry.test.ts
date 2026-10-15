import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import {createApp} from '../../server/http.ts'
import {createWorkflowHost,directionLabels} from '../../server/workflows/task-host.ts'
import {createGrowthItem,growthContext} from '../../server/growth.ts'
import * as store from '../../server/store.ts'

test('explicit workflow feedback entry: real growth persistence, manual retry, new session and account/memory/version boundaries',async()=>{
 const before={origin:config.origin,entitlements:config.entitlementsEnabled,flag:process.env.LIFEOS_ADVANCED_WORKFLOWS}
 config.entitlementsEnabled=false;process.env.LIFEOS_ADVANCED_WORKFLOWS='false'
 const host=createWorkflowHost(),checks:string[]=[],directory=resolve('.local/launch-recovery-20261015/workflow-feedback-entry')
 mkdirSync(directory,{recursive:true})
 let owner='',task:any,modelAttempts=0,listedConversation=''
 // This fixture isolates the feedback UI from cloud generation/adoption. The
 // adopted priority and every feedback write/read use the real isolated PG API.
 host.capabilities=()=>({enabled:true,reason:'LOCAL_UI_FIXTURE',syntheticEligible:true,directions:directionLabels,executionKind:'simulated_provider',version:'local-ui-fixture'})
 host.list=async(user:string,conversation:string)=>{listedConversation=conversation;return user===owner?[task]:[]}
 const app=createApp(async()=>{modelAttempts++;throw new Error('No model allowed in this acceptance')},180000,host)
 await new Promise<void>(done=>app.listen(0,'127.0.0.1',done))
 const origin='http://127.0.0.1:'+(app.address() as {port:number}).port;config.origin=origin
 const request=async(cookie:string,path:string,body?:unknown)=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
 const json=async(cookie:string,path:string,body?:unknown)=>{const response=await request(cookie,path,body),out=await response.json();assert.ok(response.ok,JSON.stringify({path,status:response.status,out}));return out}
 const account=async()=>{const response=await request('','/api/auth/sign-up/email',{email:'feedback-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID(),name:'Synthetic adult'});assert.equal(response.status,200);const cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');return {cookie,id:(await json(cookie,'/api/session')).id}}
 let browser:any
 try{
  const a=await account(),b=await account();owner=a.id
  const chat=randomUUID(),next=randomUUID(),other=randomUUID()
  for(const id of [chat,next])await json(a.cookie,'/api/conversations',{id,title:'SYNTHETIC feedback session'})
  await json(b.cookie,'/api/conversations',{id:other,title:'SYNTHETIC other account'})
  await json(a.cookie,'/api/memory/settings',{requestId:randomUUID(),enabled:true,expectedRevision:0})
  const seed=(await store.startRun(owner,chat,randomUUID(),'我想跟进这次小探索。')).run
  await store.finishRun(seed,{candidates:[],audit:[]},'请按实际进展填写反馈。',null,new AbortController().signal)
  const seedNext=(await store.startRun(owner,next,randomUUID(),'我在新会话跟进之前的小探索。')).run
  await store.finishRun(seedNext,{candidates:[],audit:[]},'已有计划保留。',null,new AbortController().signal)
  const plan=await createGrowthItem(owner,{requestId:randomUUID(),conversationId:chat,kind:'priority',text:'计划：查看两个岗位的实际要求（已采纳，尚未执行）'})
  const unrelated=await createGrowthItem(owner,{requestId:randomUUID(),conversationId:chat,kind:'priority',text:'计划：复习课程（已采纳，尚未执行）'})
  await createGrowthItem(owner,{requestId:randomUUID(),conversationId:chat,kind:'feedback',text:'无关计划的反馈不能串入',progressState:'completed',dependencies:[{id:unrelated.id,revision:unrelated.revision}]})
  task={id:randomUUID(),conversationId:chat,question:'比较就业和考研',status:'plan_saved',receipt:null,nodes:[],executionKind:'simulated_provider',commit:{stateChange:{workflow:{status:'plan_saved',executed:false,itemId:plan.id,revision:plan.revision}}}}
  const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
  browser=await chromium.launch({channel:'chrome',headless:true})
  const context=await browser.newContext({viewport:{width:1440,height:900}})
  await context.addCookies(a.cookie.split('; ').map(value=>{const at=value.indexOf('=');return {name:value.slice(0,at),value:value.slice(at+1),url:origin}}))
  await context.addInitScript((id:string)=>{if(!sessionStorage.getItem('workflow-feedback-seeded')){sessionStorage.setItem('lifeos:pending-conversation',id);sessionStorage.setItem('workflow-feedback-seeded','true')}},chat)
  const page=await context.newPage(),errors:string[]=[],bodies:any[]=[]
  page.on('pageerror',(error:Error)=>errors.push(error.message))
  let dropResponse=true
  await context.route('**/*',async(route:any)=>{
   if(!route.request().url().startsWith(origin))return route.abort()
   if(route.request().url()===origin+'/api/growth'&&route.request().method()==='POST'){
    bodies.push(route.request().postDataJSON())
    if(dropResponse){dropResponse=false;await route.fetch();return route.abort('failed')}
   }
   return route.continue()
  })
  await page.goto(origin+'/#conversation',{waitUntil:'networkidle'})
  const panel=page.locator('[data-workflow-id="'+task.id+'"]'),feedback=panel.locator('.qa-workflow-feedback')
  await feedback.locator('summary').click()
  await feedback.getByRole('radio',{name:'已尝试，尚未做完'}).check()
  await feedback.getByRole('textbox',{name:'实际发生了什么？'}).fill('我已查看一个岗位，还没看第二个；是否适合仍未知。')
  await feedback.getByRole('button',{name:'保存这一步的反馈'}).click()
  await feedback.getByRole('button',{name:'重试确认保存'}).waitFor()
  await feedback.getByRole('button',{name:'重试确认保存'}).click()
  await feedback.getByText('反馈已保存并关联这一步；完成动作不代表已被采用、已付款或已产生效果。',{exact:true}).waitFor()
  assert.equal(bodies.length,2);assert.deepEqual(bodies[0],bodies[1])
  let view=await json(a.cookie,'/api/growth?conversation='+chat)
  const linked=()=>view.items.filter((item:any)=>item.kind==='feedback'&&item.dependencies.some((ref:any)=>ref.id===plan.id))
  assert.equal(linked().length,1);assert.equal(linked()[0].progressState,'attempted');assert.equal(linked()[0].assertion,'user_edit')
  assert.equal(await feedback.getByText('无关计划的反馈不能串入',{exact:true}).count(),0)
  assert.equal(view.items.find((item:any)=>item.id===plan.id).text,plan.text)
  checks.push('normal UI explicit plan version + progress + verbatim report persisted; lost committed response retried with identical ID/body and only one feedback row; unrelated task excluded; original adoption retained')
  await feedback.getByRole('button',{name:'保存这一步的反馈'}).scrollIntoViewIfNeeded()
  await page.screenshot({path:resolve(directory,'feedback-desktop.png'),fullPage:true})
  await page.reload({waitUntil:'networkidle'});await feedback.locator('summary').click();await feedback.getByRole('list',{name:'这一步的反馈记录'}).waitFor()
  await page.evaluate((id:string)=>sessionStorage.setItem('lifeos:pending-conversation',id),next)
  await page.reload({waitUntil:'networkidle'});await feedback.locator('summary').click();await feedback.getByRole('list',{name:'这一步的反馈记录'}).waitFor()
  assert.equal(listedConversation,next,'browser must actually request the new conversation')
  const background=await growthContext(owner,next);assert.ok(background.some(item=>item.id===linked()[0].id&&item.progressState==='attempted'))
  checks.push('refresh and new session UI read same linked feedback; existing growthContext supplies it to subsequent help without generation')
  await page.setViewportSize({width:390,height:844})
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth))
  assert.ok(await feedback.evaluate((element:HTMLElement)=>element.scrollWidth<=element.clientWidth))
  await feedback.getByRole('radio',{name:'这一步已做完'}).check()
  await feedback.getByRole('textbox',{name:'实际发生了什么？'}).fill('我已核对完两个岗位；采用、付款和实际效果仍未知。')
  await feedback.getByRole('button',{name:'保存这一步的反馈'}).click();await feedback.getByText('反馈已保存并关联这一步；完成动作不代表已被采用、已付款或已产生效果。',{exact:true}).waitFor()
  await feedback.getByRole('button',{name:'保存这一步的反馈'}).scrollIntoViewIfNeeded()
  await page.screenshot({path:resolve(directory,'feedback-mobile.png'),fullPage:true})
  view=await json(a.cookie,'/api/growth?conversation='+next);assert.equal(linked().length,2);assert.ok(linked().some((item:any)=>item.progressState==='completed'));assert.equal(task.commit.stateChange.workflow.executed,false)
  checks.push('390px form saves next-session completed-action report; no automatic adoption/payment/effect or original plan mutation')
  const foreign={requestId:randomUUID(),conversationId:other,kind:'feedback',text:'跨账号引用不得保存',progressState:'completed',dependencies:[{id:plan.id,revision:plan.revision}]}
  assert.equal((await request(b.cookie,'/api/growth',foreign)).status,409)
  const ownBody={...foreign,requestId:randomUUID(),conversationId:next}
  await json(a.cookie,'/api/memory/settings',{requestId:randomUUID(),enabled:false,expectedRevision:1})
  assert.equal((await request(a.cookie,'/api/growth',ownBody)).status,409)
  assert.equal((await request(a.cookie,'/api/growth',bodies.at(-1))).status,409,'replay must recheck dependent cross-session sources after Memory OFF')
  assert.ok(!(await json(a.cookie,'/api/growth?conversation='+next)).items.some((item:any)=>item.id===plan.id))
  await page.reload({waitUntil:'networkidle'});await feedback.locator('summary').click();await feedback.getByText('这一步的记录已改变或不可用，请先在长期记忆里核对。',{exact:true}).waitFor();assert.equal(await feedback.getByRole('button',{name:'保存这一步的反馈'}).count(),0)
  await json(a.cookie,'/api/memory/settings',{requestId:randomUUID(),enabled:true,expectedRevision:2})
  await json(a.cookie,'/api/growth/'+plan.id+'/actions',{requestId:randomUUID(),expectedRevision:plan.revision,action:'correct',text:'计划：已更正为另一项探索'})
  assert.equal((await request(a.cookie,'/api/growth',{...ownBody,requestId:randomUUID()})).status,409)
  assert.equal((await request(a.cookie,'/api/growth',bodies[0])).status,409,'replay must not revive a feedback dependency after plan correction')
  const after=await json(a.cookie,'/api/growth?conversation='+next)
  assert.ok(after.items.filter((item:any)=>linked().some((old:any)=>old.id===item.id)).every((item:any)=>item.unavailableReason))
  const forgottenPlan=await json(a.cookie,'/api/growth',{requestId:randomUUID(),conversationId:chat,kind:'priority',text:'计划：即将遗忘的探索'})
  const forgottenBody={...ownBody,requestId:randomUUID(),dependencies:[{id:forgottenPlan.id,revision:forgottenPlan.revision}]}
  const forgottenFeedback=await json(a.cookie,'/api/growth',forgottenBody)
  await json(a.cookie,'/api/growth/'+forgottenPlan.id+'/actions',{requestId:randomUUID(),expectedRevision:forgottenPlan.revision,action:'forget'})
  assert.equal((await request(a.cookie,'/api/growth',forgottenBody)).status,409)
  const forgottenView=await json(a.cookie,'/api/growth?conversation='+next)
  assert.ok(!forgottenView.items.some((item:any)=>item.id===forgottenFeedback.id&&!item.unavailableReason))
  checks.push('cross-account, Memory OFF cross-session, corrected and forgotten plan dependencies reject writes/replays; dependent feedback is unavailable after source changes')
  assert.equal(modelAttempts,0);assert.deepEqual(errors,[])
  writeFileSync(resolve(directory,'result.json'),JSON.stringify({status:'PASS_LOCAL_UI_FIXTURE_REAL_ISOLATED_PG',checks,modelAttempts,cloudCalls:0,limitations:['direction generation and adoption are fixture context','real provider effect, public Gateway and production acceptance not verified']},null,2))
 }catch(error){
  writeFileSync(resolve(directory,'failure-'+Date.now()+'.txt'),error instanceof Error?error.stack??error.message:String(error));throw error
 }finally{
  await browser?.close();await new Promise<void>(done=>app.close(()=>done()));await pool.end()
  config.origin=before.origin;config.entitlementsEnabled=before.entitlements
  if(before.flag===undefined)delete process.env.LIFEOS_ADVANCED_WORKFLOWS;else process.env.LIFEOS_ADVANCED_WORKFLOWS=before.flag
 }
})
