import {grantEntitlement,entitlementView} from '../../server/entitlements.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from '../../server/config.ts'
import { pool } from '../../server/db.ts'
import { createApp } from '../../server/http.ts'
import type { Engine } from '../../server/agent.ts'
import * as store from '../../server/store.ts'
import { coachEventView, stageCoachEvent } from '../../server/action-coach-events.ts'
import { loadSnapshot, stageCoachBackground } from '../../server/memory.ts'
import {indexCoachEventOnce} from '../../server/coach-retrieval.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
async function bounded<T>(promise:Promise<T>,label:string){
  let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),5000)})])}
  finally{clearTimeout(timer)}
}
test('real browser event/material UI, clipboard, responsive layout and source withdrawal (simulated model)',async()=>{
  let release!:()=>void
  const gate=new Promise<void>(resolve=>{release=resolve})
  let disconnectRelease!:()=>void,disconnectObserved!:()=>void,disconnectRun=''
  const disconnectGate=new Promise<void>(resolve=>{disconnectRelease=resolve})
  const disconnected=new Promise<void>(resolve=>{disconnectObserved=resolve})
  const material='你好，上次的资料在手机上打不开。我可以先把你需要的部分直接发成文字；你现在还需要哪一部分？\n'+'这是一份完整保留的可用材料。'.repeat(40)
  let calls=0
  const engine:Engine=async input=>{
    calls++
    const text=input.context.find(row=>row.id===input.run.source_message_id)!.content
    const snapshot=await loadSnapshot(input.run.user_id,input.run.conversation_id,text);input.staged.snapshot=snapshot
    if(text.startsWith('断线验证')){
      disconnectRun=input.run.request_id
      input.signal.addEventListener('abort',disconnectObserved,{once:true})
      input.emit({type:'draft',text:'你想先核对哪一步？',saved:false})
      await disconnectGate
      const reply='这段晚到材料不应保存。'
      input.staged.coach=await stageCoachEvent(input.run,{target:{operation:'create',title:'晚到事件不应保存',source:{messageId:input.run.source_message_id,quote:text}},action:{operation:'create',draft:{content:reply}}},reply)
      return {text:reply,usage:null}
    }
    if(calls===1){
      input.emit({type:'draft',text:'你想先核对哪一步？',saved:false});await gate
      const reply='先核对需要，再用这份材料：\n'+material
      input.staged.coach=await stageCoachEvent(input.run,{target:{operation:'create',title:'资料交付后的反馈',source:{messageId:input.run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:input.run.source_message_id,quote:'对方说手机打不开，所以没有看'}},{kind:'unknown',question:'对方现在还需要哪一部分？'}],action:{operation:'create',draft:{content:material,observable:'收到对方是否需要的明确回应',stopWhen:'明确不需要就结束，不继续催促'}}},reply)
      input.staged.memoryChanges=await stageCoachBackground(input.run.user_id,input.run.conversation_id,input.run.source_message_id,[{key:'education.major',value:'计算机专业',source:{messageId:input.run.source_message_id,quote:'计算机专业'}}],snapshot)
      await store.stageCandidate(input.run,input.staged,{sourceMessageId:input.run.source_message_id,quote:'我把资料发给同学，对方说手机打不开，所以没有看',links:[]},input.signal)
      return {text:reply,usage:null}
    }
    if(calls===2){
      const reply='请确认你在文档里看到的两处问题，我再逐项修改。'
      input.staged.coach=await stageCoachEvent(input.run,{target:{operation:'create',title:'课程项目组员反馈',source:{messageId:input.run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:input.run.source_message_id,quote:text}}],action:{operation:'create',draft:{content:reply}}},reply)
      await store.stageCandidate(input.run,input.staged,{sourceMessageId:input.run.source_message_id,quote:'我把课程项目发给组员，他已经打开并完成了检查。',links:[]},input.signal)
      return {text:reply,usage:null}
    }
    return {text:'递归是一个过程调用自身，并由结束条件停止。',usage:null}
  }
  const oldOrigin=config.origin,oldRate=config.messagesPerMinute,oldAccess=config.entitlementsEnabled
  const app=createApp(engine)
  await new Promise<void>(resolveListen=>app.listen(0,'127.0.0.1',resolveListen))
  const origin='http://127.0.0.1:'+(app.address() as {port:number}).port
  config.origin=origin;config.messagesPerMinute=1000;config.entitlementsEnabled=true
  const directory=resolve('evidence/v1.3-action-coach','browser-local-'+Date.now());mkdirSync(directory,{recursive:true})
  const report:any={evidence:'REAL_CHROME_REAL_POSTGRESQL_REAL_AUTH_SIMULATED_MODEL_SYNTHETIC_USER',checks:[],screenshots:[],errors:[]}
  let browser:any,user=''
  try{
    const email='coach-browser-'+randomUUID()+'@example.invalid',password='Synthetic-'+randomUUID()
    const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,password,name:'Synthetic browser'})})
    assert.equal(signup.status,200)
    const cookie=signup.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
    user=(await (await fetch(origin+'/api/session',{headers:{Cookie:cookie}})).json() as any).id
    await grantEntitlement(user,20,new Date(Date.now()+86400000).toISOString())
    browser=await chromium.launch({channel:'chrome',headless:true})
    const context=await browser.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']})
    const page=await context.newPage();page.on('pageerror',(error:any)=>report.errors.push(error.message))
    await page.goto(origin+'/',{waitUntil:'networkidle'})
    await page.getByRole('button',{name:'登录',exact:true}).click()
    await page.locator('dialog.lifeos-auth').getByRole('button',{name:'登录',exact:true}).click()
    await page.getByLabel('邮箱',{exact:true}).fill(email);await page.getByLabel('密码',{exact:true}).fill(password)
    await page.getByRole('form',{name:'邮箱登录'}).getByRole('button',{name:'登录',exact:true}).click()
    await page.locator('dialog.qa-page[open]').waitFor()
    await page.locator('.qa-preview-note').filter({hasText:'剩余 20 次'}).waitFor()
    await page.waitForFunction(()=>!!document.querySelector('canvas'))
    await page.evaluate(()=>{(window as any).__coachCanvas=document.querySelector('canvas')})
    await page.getByRole('button',{name:'记忆',exact:true}).click()
    await page.getByRole('checkbox',{name:'启用长期记忆'}).waitFor()
    assert.equal(await page.locator('#qa-memory-state-title,.qa-memory-slots,.qa-memory-question').count(),0)
    assert.equal(await page.getByRole('heading',{name:'长期记忆',exact:true}).count(),2)
    report.checks.push('memory panel exposes current memory controls without retired task slots or questionnaire')
    await page.getByRole('checkbox',{name:'启用长期记忆'}).click()
    await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('.qa-memory-switch input')?.checked===true)
    await page.getByRole('button',{name:'关闭记忆面板'}).click()
    await page.getByRole('button',{name:'我的成长',exact:true}).click()
    await page.getByRole('heading',{name:'现在的我，接下来的一步'}).waitFor()
    const growthRequestIds:string[]=[]
    await page.route('**/api/growth',async(route:any)=>{
      if(route.request().method()!=='POST'){await route.continue();return}
      growthRequestIds.push(route.request().postDataJSON().requestId)
      if(growthRequestIds.length===1){await route.fetch();await route.abort('failed')}
      else await route.continue()
    })
    await page.getByLabel('你的原话',{exact:true}).fill('先探索就业，暂不强选岗位。')
    await page.getByRole('button',{name:'保存这项',exact:true}).click()
    const growthCard=page.locator('.growth-card').filter({hasText:'先探索就业，暂不强选岗位。'})
    await growthCard.waitFor()
    assert.equal(await page.getByLabel('你的原话',{exact:true}).inputValue(),'先探索就业，暂不强选岗位。','transport failure retains authored input')
    await page.getByRole('button',{name:'保存这项',exact:true}).click()
    await page.getByLabel('你的原话',{exact:true}).waitFor()
    await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('#growth-text')?.value==='')
    assert.equal(growthRequestIds.length,2);assert.equal(growthRequestIds[0],growthRequestIds[1]);assert.equal(await growthCard.count(),1)
    await page.unroute('**/api/growth')
    await growthCard.getByRole('button',{name:'更正',exact:true}).click()
    await page.getByLabel('你的原话',{exact:true}).fill('这阶段优先期末，之后探索实习。')
    await page.getByRole('button',{name:'保存这项',exact:true}).click()
    await page.locator('.growth-card').filter({hasText:'这阶段优先期末，之后探索实习。'}).waitFor()
    for(const width of [1440,390,320]){
      await page.setViewportSize({width,height:900})
      await page.locator('.growth-workspace').evaluate((element:any)=>{element.scrollTop=0})
      assert.equal(await page.locator('.growth-workspace').evaluate((element:any)=>element.scrollWidth<=element.clientWidth+1),true,'growth workspace no overflow at '+width)
      const file=resolve(directory,'growth-'+width+'.png');await page.screenshot({path:file});report.screenshots.push(file)
    }
    const secondContext=await browser.newContext({viewport:{width:390,height:844}})
    await secondContext.addCookies(await context.cookies())
    const secondPage=await secondContext.newPage()
    await secondPage.goto(origin+'/#conversation',{waitUntil:'networkidle'})
    await secondPage.getByRole('button',{name:'我的成长',exact:true}).click()
    const syncedCard=secondPage.locator('.growth-card').filter({hasText:'这阶段优先期末，之后探索实习。'})
    await syncedCard.waitFor();assert.equal(await secondPage.locator('.growth-card').filter({hasText:'先探索就业，暂不强选岗位。'}).count(),0)
    await syncedCard.getByRole('button',{name:'遗忘这条',exact:true}).click()
    await syncedCard.waitFor({state:'detached'})
    await secondContext.close()
    await page.getByRole('button',{name:'继续聊天',exact:true}).click()
    await page.setViewportSize({width:1440,height:900})
    assert.equal(calls,0,'growth editing and cross-device control never invokes provider')
    report.checks.push('growth workspace actual create/correct/forget, lost create response preserves text and same request ID without duplicate, desktop1440/mobile390/narrow320, second authenticated browser context sees corrected state; zero model calls')
    const input=page.getByRole('textbox',{name:'想聊的事'})
    const long='完整长输入。'.repeat(900)
    await input.fill(long);assert.equal(await input.inputValue(),long)
    const oversized='字'.repeat(16001);await input.fill(oversized);await page.getByRole('button',{name:'发送消息'}).click()
    await page.getByText(/超过单次 16000/).waitFor();assert.equal(await input.inputValue(),oversized);assert.equal(calls,0)
    const text='我读计算机专业。我把资料发给同学，对方说手机打不开，所以没有看。请帮我写确认需求的消息。'
    await input.fill(text)
    await input.evaluate((element:any)=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,isComposing:true})))
    assert.equal(calls,0);assert.equal(await input.inputValue(),text)
    await page.getByRole('button',{name:'发送消息'}).click()
    await page.getByText('生成草稿 · 未校验、未保存').waitFor()
    assert.equal((await pool.query("SELECT 1 FROM messages WHERE user_id=$1 AND role='assistant'",[user])).rowCount,0)
    release();await page.locator('.qa-thinking').waitFor({state:'detached'})
    assert.equal(await page.locator('.qa-message-body').last().textContent(),'先核对需要，再用这份材料：\n'+material)
    await page.locator('.qa-preview-note').filter({hasText:'剩余 19 次'}).waitFor()
    assert.equal((await entitlementView(user) as any).used,1)
    report.checks.push('database-authoritative invitation remaining amount updates after commit without truncating the conversation')
    report.checks.push('long paste/explicit overflow/IME; draft before commit; final reply replaces draft')
    const conversation=(await store.listConversations(user))[0].id
    await page.getByRole('button',{name:'事件与材料',exact:true}).click()
    await page.getByRole('heading',{name:'这件事与下一步'}).waitFor()
    await page.getByRole('button',{name:'复制材料',exact:true}).waitFor()
    assert.equal(await page.locator('.qa-event-text').first().textContent(),material)
    await page.getByRole('button',{name:'复制材料',exact:true}).click()
    await page.getByText('已复制完整材料。复制不代表已经发送或执行。',{exact:true}).waitFor()
    assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n'),material)
    await page.evaluate(()=>{(window as any).__coachWrite=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=async()=>{throw new DOMException('Synthetic denied permission','NotAllowedError')}})
    await page.getByRole('button',{name:'复制材料',exact:true}).click()
    await page.getByText('浏览器没有允许复制，请选中材料文字手动复制。',{exact:true}).waitFor()
    assert.equal(await page.locator('.qa-event-text').first().textContent(),material)
    await page.evaluate(()=>{navigator.clipboard.writeText=(window as any).__coachWrite})
    report.checks.push('simulated clipboard denial retains validated full text for manual selection')
    await page.getByText('查看事情经过（2条）',{exact:true}).click()
    await page.getByRole('button',{name:'补充或更正',exact:true}).click()
    assert.match(await input.inputValue(),/更正.*手机打不开/)
    assert.equal(await input.evaluate((element:any)=>document.activeElement===element),true)
    assert.equal(calls,1,'continuing only fills a draft')
    report.checks.push('exact clipboard material; process disclosure; correction draft and focus; no automatic send')
    await page.getByRole('button',{name:'事件与材料',exact:true}).click()
    await page.getByText('经历候选与确认（1条）',{exact:true}).click()
    const firstExperience=(await store.listExperiences(user,conversation))[0]
    assert.equal(firstExperience.status,'candidate')
    assert.ok(!(await store.cognitionGraph(user)).nodes.some((node:any)=>node.serverId===firstExperience.id),'unconfirmed candidate must not enter the graph')
    await page.getByRole('button',{name:'确认经历',exact:true}).click()
    await page.getByRole('heading',{name:'你已确认'}).waitFor()
    assert.ok((await store.cognitionGraph(user)).nodes.some((node:any)=>node.serverId===firstExperience.id),'actual UI confirmation makes the experience available to the graph')
    for(const width of [1440,390,320]){
      await page.setViewportSize({width,height:900})
      assert.equal(await page.evaluate(()=>Array.from(document.querySelectorAll('.qa-shell,.qa-review,.qa-review-content')).every(element=>element.scrollWidth<=element.clientWidth+1)),true,'no horizontal overflow at '+width)
      assert.equal(await page.evaluate(()=>document.querySelector('canvas')===(window as any).__coachCanvas),true)
      const file=resolve(directory,'event-'+width+'.png');await page.screenshot({path:file});report.screenshots.push(file)
    }
    report.checks.push('experience enters actual graph only after UI confirmation; desktop1440/narrow390/320 layout; persistent Canvas identity')
    await page.locator('.qa-review-footer').getByRole('button',{name:'返回对话',exact:true}).click()
    await page.getByRole('button',{name:'记忆',exact:true}).click()
    const item=page.locator('.qa-memory-items > li').filter({hasText:'计算机专业'})
    await item.getByRole('button',{name:'忘记',exact:true}).click()
    await item.waitFor({state:'hidden'})
    await page.getByRole('button',{name:'关闭记忆面板'}).click()
    await page.getByRole('button',{name:'事件与材料',exact:true}).click()
    await page.getByText(/还没有需要单独保存的事件/).waitFor()
    assert.equal(await page.getByRole('button',{name:'复制材料',exact:true}).count(),0)
    assert.equal(await coachEventView(user,conversation),null)
    report.checks.push('forgetting withdraws event and usable material from the actual UI')
    await page.locator('.qa-review-footer').getByRole('button',{name:'返回对话',exact:true}).click()
    await page.setViewportSize({width:1440,height:900})
    await page.getByRole('button',{name:'新对话',exact:true}).click()
    const secondRaw='我把课程项目发给组员，他已经打开并完成了检查。请帮我写一句确认消息。'
    await input.fill(secondRaw);await page.getByRole('button',{name:'发送消息'}).click()
    await page.locator('.qa-thinking').waitFor({state:'detached'})
    const secondChat=(await store.listConversations(user)).find(row=>row.id!==conversation)!.id
    const secondEvent=(await coachEventView(user,secondChat))!
    const secondExperience=(await store.listExperiences(user,secondChat))[0]
    while(await indexCoachEventOnce()){}
    await page.getByRole('button',{name:'新对话',exact:true}).click()
    await input.fill('解释一下递归。');await page.getByRole('button',{name:'发送消息'}).click()
    await page.locator('.qa-thinking').waitFor({state:'detached'})
    const thirdChat=(await store.listConversations(user)).find(row=>row.id!==conversation&&row.id!==secondChat)!.id
    await page.getByRole('button',{name:'事件与材料',exact:true}).click()
    await page.getByText('找之前的事',{exact:true}).click()
    await page.getByRole('textbox',{name:'描述之前的事件'}).fill('课程项目发给组员，他打开文档并检查了')
    await page.getByRole('button',{name:'查找',exact:true}).click()
    await page.locator('.qa-event-match').filter({hasText:'课程项目组员反馈'}).click()
    await page.getByRole('heading',{name:'课程项目组员反馈',exact:true}).waitFor()
    assert.equal(await page.locator('.qa-event-text').textContent(),'请确认你在文档里看到的两处问题，我再逐项修改。')
    assert.equal(await coachEventView(user,thirdChat),null,'navigation does not change the current event pointer')
    assert.equal(calls,3,'history navigation does not generate another response')
    const clipboardBefore=await page.evaluate(()=>navigator.clipboard.readText())
    const replacement='请只核对文档是否打开，内容检查还需要另行确认。'
    const changedRun=(await store.startRun(user,secondChat,randomUUID(),'我想把消息改成只确认文件能否打开。')).run
    const changedCoach=await stageCoachEvent(changedRun,{target:{operation:'continue',eventId:secondEvent.id,expectedRevision:secondEvent.revision},action:{operation:'modify',actionId:secondEvent.actions[0].id,expectedRevision:secondEvent.actions[0].revision,draft:{content:replacement}}},replacement)
    await store.finishRun(changedRun,{candidates:[],audit:[],coach:changedCoach},replacement,null,new AbortController().signal)
    await page.getByRole('button',{name:'复制材料',exact:true}).click()
    await page.getByText('这份材料已更新或需要重新核对，请查看当前内容。',{exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),clipboardBefore,'stale UI cannot silently copy a changed action revision')
    assert.equal(await page.locator('.qa-event-text').textContent(),replacement)
    await page.getByRole('button',{name:'复制材料',exact:true}).click()
    await page.getByText('已复制完整材料。复制不代表已经发送或执行。',{exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),replacement)
    report.checks.push('another writer updates the same action; stale copy leaves clipboard unchanged, refreshes material and copies only after a new click')
    await page.getByRole('button',{name:'记忆',exact:true}).click()
    await page.getByRole('checkbox',{name:'启用长期记忆'}).focus()
    await page.getByRole('checkbox',{name:'启用长期记忆'}).press('Space')
    await page.getByRole('button',{name:'关闭记忆面板'}).click()
    await page.getByText(/还没有需要单独保存的事件/).waitFor()
    assert.equal(await page.getByRole('button',{name:'复制材料',exact:true}).count(),0)
    await page.getByRole('button',{name:'查找',exact:true}).click()
    await page.getByText(/本次没有找到可读取的候选/).waitFor()
    assert.equal(await page.locator('.qa-event-match').count(),0)
    report.checks.push('cross-conversation navigation retains exact material and leaves pointer unchanged; memory off removes selection and search results')
    await page.locator('.qa-review-footer').getByRole('button',{name:'返回对话',exact:true}).click()
    await page.getByRole('button',{name:'展开侧边栏'}).click()
    await page.locator('.qa-history-link').filter({hasText:'我把课程项目发给组员'}).click()
    await page.getByRole('button',{name:'事件与材料',exact:true}).click()
    await page.getByText('经历候选与确认（1条）',{exact:true}).click()
    await page.getByRole('button',{name:'确认经历',exact:true}).click()
    await page.getByRole('heading',{name:'你已确认'}).waitFor()
    await page.getByRole('button',{name:'修正',exact:true}).click()
    const corrected='我重新核对了反馈：组员只打开了文件，还没有检查内容。'
    await page.getByRole('textbox',{name:'修正经历'}).fill('字'.repeat(4001))
    await page.getByRole('button',{name:'保存修正',exact:true}).click()
    await page.getByText(/修正内容超过4000字/).waitFor()
    assert.equal((await store.listExperiences(user,secondChat))[0].revision,2)
    assert.equal((await page.getByRole('textbox',{name:'修正经历'}).inputValue()).length,4001)
    await page.getByRole('textbox',{name:'修正经历'}).fill(corrected)
    await page.getByRole('button',{name:'保存修正',exact:true}).click()
    await page.getByRole('textbox',{name:'修正经历'}).waitFor({state:'detached'})
    await page.locator('.qa-event-experiences article > p').filter({hasText:corrected}).waitFor()
    assert.equal((await store.listExperiences(user,secondChat))[0].revision,3)
    assert.equal(await page.getByRole('button',{name:'复制材料',exact:true}).count(),0)
    await assert.rejects(()=>coachEventView(user,secondChat,secondEvent.id),(error:any)=>error.code==='NOT_FOUND')
    await page.getByRole('button',{name:'删除',exact:true}).click()
    await page.locator('.qa-event-experiences').waitFor({state:'detached'})
    assert.equal((await store.listExperiences(user,secondChat)).length,0)
    const deletedGraph=await store.cognitionGraph(user)
    assert.ok(!deletedGraph.nodes.some((node:any)=>node.serverId===secondExperience.id))
    assert.ok(!deletedGraph.edges.some((edge:any)=>edge.sourceId==='exp-'+secondExperience.id))
    report.checks.push('actual UI confirms, preserves oversize correction, saves revision3, withdraws obsolete material and deletes experience')
    await page.locator('.qa-review-footer').getByRole('button',{name:'返回对话',exact:true}).click()
    const beforeEvents=(await pool.query('SELECT count(*)::int AS n FROM coach_events WHERE user_id=$1',[user])).rows[0].n
    await input.fill('断线验证：我正在核对新的过程，请先问一个问题。')
    await page.getByRole('button',{name:'发送消息'}).click()
    await page.getByText('生成草稿 · 未校验、未保存').waitFor()
    await page.close();await bounded(disconnected,'Closing the browser did not disconnect its stream');disconnectRelease()
    for(let i=0;i<40;i++){
      if((await store.runStatus(user,disconnectRun)).status==='cancelled')break
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    assert.equal((await store.runStatus(user,disconnectRun)).status,'cancelled')
    assert.equal((await pool.query("SELECT 1 FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,disconnectRun])).rowCount,0)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM coach_events WHERE user_id=$1',[user])).rows[0].n,beforeEvents)
    const reopened=await context.newPage();reopened.on('pageerror',(error:any)=>report.errors.push(error.message))
    await reopened.goto(origin+'/#conversation',{waitUntil:'networkidle'})
    await reopened.locator('dialog.qa-page[open]').waitFor()
    assert.equal(await reopened.getByText('生成草稿 · 未校验、未保存').count(),0)
    assert.equal(await reopened.getByText('这段晚到材料不应保存。',{exact:true}).count(),0)
    await reopened.getByRole('button',{name:'事件与材料',exact:true}).click()
    assert.equal(await reopened.getByRole('button',{name:'复制材料',exact:true}).count(),0)
    report.checks.push('closing an actual in-flight browser stream cancels the server; late output has no derived commit and reopening has no phantom draft/material')
    await reopened.locator('.qa-review-footer').getByRole('button',{name:'返回对话',exact:true}).click()
    await reopened.getByRole('button',{name:'记忆',exact:true}).click()
    const memorySwitch=reopened.getByRole('checkbox',{name:'启用长期记忆'})
    await memorySwitch.waitFor();await memorySwitch.focus()
    await Promise.all([reopened.waitForResponse((response:any)=>response.url().endsWith('/api/memory/settings')&&response.status()===200),memorySwitch.press('Space')])
    const raceRaw='我在测试大学学习。',raceRun=(await store.startRun(user,secondChat,randomUUID(),raceRaw)).run
    const raceSnapshot=await loadSnapshot(user,secondChat,raceRaw)
    const raceChanges=await stageCoachBackground(user,secondChat,raceRun.source_message_id,[{key:'education.school',value:'测试大学',source:{messageId:raceRun.source_message_id,quote:'测试大学'}}],raceSnapshot)
    const raceSaved=await store.finishRun(raceRun,{candidates:[],audit:[],snapshot:raceSnapshot,memoryChanges:raceChanges},'合成背景夹具已保存。',null,new AbortController().signal)
    assert.equal(raceSaved.memorySavedCount,1)
    await reopened.evaluate(()=>window.dispatchEvent(new Event('lifeos-data-changed')))
    const schoolItem=reopened.locator('.qa-memory-items > li').filter({hasText:'测试大学'})
    await schoolItem.waitFor()
    let heldSnapshot=false,releaseSnapshot!:()=>void,snapshotEntered!:()=>void
    const oldSnapshotGate=new Promise<void>(resolve=>{releaseSnapshot=resolve})
    const snapshotCaptured=new Promise<void>(resolve=>{snapshotEntered=resolve})
    const memoryPattern='**/api/memory?conversation=*'
    await reopened.route(memoryPattern,async(route:any)=>{
      if(heldSnapshot){await route.continue();return}
      heldSnapshot=true
      const response=await route.fetch(),body=await response.body()
      snapshotEntered();await oldSnapshotGate
      await route.fulfill({response,body,headers:{...response.headers(),'x-coach-stale-snapshot':'yes'}})
    })
    try{
      await reopened.evaluate(()=>window.dispatchEvent(new Event('lifeos-data-changed')))
      await bounded(snapshotCaptured,'Mounted memory panel did not refresh on data change')
      const forgotten=await context.request.post(origin+'/api/memory/'+raceSaved.memoryIds[0]+'/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),expectedRevision:1,action:'forget'}})
      assert.equal(forgotten.status(),200)
      await Promise.all([reopened.waitForResponse((response:any)=>response.url().includes('/api/memory?conversation=')&&response.status()===200),reopened.evaluate(()=>window.dispatchEvent(new Event('lifeos-data-changed')))])
      await memorySwitch.waitFor();await schoolItem.waitFor({state:'hidden'})
      const oldResponse=reopened.waitForResponse((response:any)=>response.headers()['x-coach-stale-snapshot']==='yes')
      releaseSnapshot();await (await oldResponse).finished()
      await reopened.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
      assert.equal(await schoolItem.count(),0,'delayed pre-forget response cannot restore revoked memory in the panel')
      report.checks.push('actual memory response delayed by simulated transport cannot overwrite newer forgotten state; global changes refresh the mounted panel')
      await reopened.setViewportSize({width:320,height:900})
      assert.equal(await reopened.locator('.qa-memory-panel').evaluate((element:any)=>element.scrollWidth<=element.clientWidth+1),true)
      const screenshot=resolve(directory,'memory-after-forget-320.png');await reopened.screenshot({path:screenshot});report.screenshots.push(screenshot)
    }finally{releaseSnapshot();await reopened.unroute(memoryPattern)}
    assert.deepEqual(report.errors,[])
    report.status='PASSED'
  }catch(error){report.failure=error instanceof Error?error.message:String(error);throw error}
  finally{
    release();disconnectRelease();writeFileSync(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n')
    await localEmbedding.close()
    await browser?.close();app.closeAllConnections();await new Promise<void>(resolveClose=>app.close(()=>resolveClose()))
    config.origin=oldOrigin;config.messagesPerMinute=oldRate;config.entitlementsEnabled=oldAccess
    if(user){await pool.query('DELETE FROM experiences WHERE user_id=$1',[user]);await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
    await pool.end()
  }
})
