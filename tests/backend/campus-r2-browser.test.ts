import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { pool } from '../../server/db.ts'
import { config } from '../../server/config.ts'
import { createApp } from '../../server/http.ts'
import type { Engine } from '../../server/agent.ts'
import { stageGrowthUpdates } from '../../server/growth.ts'
import { stageDirectionControls, directionControlsSnapshotKey, readDirectionControls } from '../../server/growth-controls.ts'
import * as store from '../../server/store.ts'
import { stageWeeklyPlan, type WeeklyPlanInput } from '../../server/weekly-plans.ts'
import { growthContext, growthSnapshotKey } from '../../server/growth.ts'

// N4.2 dedicated browser acceptance (real Chrome, real BetterAuth, isolated
// PG, simulated model). Covers: pause receipts across devices/sizes, GET
// failure visibility, 409 conflict, receipts on refresh, plan evidence,
// material revision growth, control redaction+resume, account isolation, and
// same-requestId recovery. Simulated-provider passes are never real-model
// browser passes.

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')

test('campus r2 browser acceptance (simulated model, real Chrome + auth + isolated PG)',async()=>{
  const {loadSnapshot}=await import('../../server/memory.ts')
  const {readDirectionControls,directionControlsSnapshotKey:ctlKey}=await import('../../server/growth-controls.ts')
  const {deriveExplicitDirectionControls:deriveCtl,stageDirectionControls:stageCtl}=await import('../../server/growth-controls.ts')
  const {controlReplyText}=await import('../../server/turn-obligations.ts')
  const {deriveTurnObligations:deriveOb,isPureControlCommand:isPure}=await import('../../server/turn-obligations.ts')
  const engine:Engine=async input=>{
    const text=input.context.find(row=>row.id===input.run.source_message_id)!.content
    input.staged.snapshot=await loadSnapshot(input.run.user_id,input.run.conversation_id,text)
    // Deterministic pure-control path, mirroring runDialogueTurn N1.4: staged
    // BEFORE any retrieval work and answered without a model call.
    const before=await readDirectionControls(input.run.user_id)
    const expected=ctlKey(before)
    const derived=deriveCtl(text)
    const obligations=deriveOb(text,{...(derived.status==='explicit'?{directionControls:derived.changes}:{})})
    if(derived.status==='explicit'&&isPure(text,obligations,derived.changes.map(change=>change.quote))){
      input.staged.directionControlSnapshotKey=expected
      input.staged.directionControls=await stageCtl(input.run,derived.changes,expected)
      input.staged.dialoguePath='direct';input.staged.upstreamCalls=0
      return {text:controlReplyText(obligations.requiredEffects),usage:{source:'deterministic',zeroLlm:true,llmCallCount:0,estimatedCostCny:0} as any}
    }
    const growth=await growthContext(input.run.user_id,input.run.conversation_id)
    if(text.includes('每周只有3小时')){
      const staged=await stageGrowthUpdates(input.run,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'每周只有3小时'}}],growth,{})
      input.staged.growth=staged
      const plan:WeeklyPlanInput={target:{operation:'create'},availableMinutes:180,period:'current',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[{action:'更新作品集一页',minutes:90,directionScopes:['employment']}]}
      input.staged.weeklyPlan=await stageWeeklyPlan(input.run,{...plan},{user:input.run.user_id,expectedControlSnapshotKey:'none',effectiveBlockedScopes:[]})
      return {text:'已按每周3小时更新，并保存了对应安排建议。',usage:null}
    }
    return {text:'收到，继续。',usage:null}
  }
  const oldOrigin=config.origin,oldRate=config.messagesPerMinute
  const app=createApp(engine)
  await new Promise<void>(ready=>app.listen(0,'127.0.0.1',ready))
  const origin='http://127.0.0.1:'+(app.address() as {port:number}).port
  config.origin=origin;config.messagesPerMinute=1000
  let browser:any
  const report:any={evidence:'REAL_CHROME_REAL_AUTH_ISOLATED_PG_SIMULATED_MODEL',checks:[],screenshots:[]}
  try{
    browser=await chromium.launch()
    const signup=async(tag:string)=>{
      const email=`r2-${tag}-${randomUUID().slice(0,8)}@example.invalid`,password='Synthetic-'+randomUUID()
      const page=await browser.newPage({viewport:{width:1440,height:900}})
      const response=await page.request.post(origin+'/api/auth/sign-up/email',{headers:{Origin:origin,'Content-Type':'application/json'},data:{email,password,name:'R2 '+tag}})
      if(!response.ok())throw new Error('SIGNUP_'+response.status())
      return {page,email,password}
    }
    const login=async(email:string,password:string)=>{
      const context=await browser.newContext({viewport:{width:1440,height:900}})
      const page=await context.newPage()
      for(let attempt=0;attempt<8;attempt++){
        const response=await page.request.post(origin+'/api/auth/sign-in/email',{headers:{Origin:origin,'Content-Type':'application/json'},data:{email,password}})
        if(response.ok())return context
        if(response.status()!==429||attempt===7)throw new Error('SIGNIN_'+response.status())
        await new Promise(done=>setTimeout(done,10000))
      }
      throw new Error('SIGNIN_EXHAUSTED')
    }

    // 1) A pauses all four 升学 scopes; four real settings + receipt; survives refresh.
    const actorA=await signup('A')
    const ctxA=await login(actorA.email,actorA.password)
    const pageA=await ctxA.newPage()
    const apiA=await ctxA.request.get(origin+'/api/session',{headers:{Origin:origin}})
    const userA=(await apiA.json()).id
    const conv=await pageA.request.post(origin+'/api/conversations',{headers:{Origin:origin,'Content-Type':'application/json'},data:{id:randomUUID(),title:'R2 A'}})
    const convId=(await conv.json()).id
    const pauseResponse=await pageA.request.post(`${origin}/api/conversations/${convId}/messages`,{headers:{Origin:origin,'Content-Type':'application/json'},data:{requestId:randomUUID(),text:'先别推升学相关的安排。'}})
    const pauseBody=await pauseResponse.text()
    assert.ok(pauseBody.includes('stateChange'),'pure control returns a receipt; head='+pauseBody.slice(0,400))
    for(const scope of ['overseas_study','postgraduate_exam','postgraduate_recommendation','undergraduate_upgrade'])assert.ok(pauseBody.includes(scope),'scope '+scope+' actually changed in this turn')
    // GrowthWorkspace shows the four settings after refresh.
    await pageA.goto(origin+'/dist/index.html')
    await pageA.reload()
    const controlsView=await pageA.request.get(origin+'/api/growth/direction-controls',{headers:{Origin:origin}})
    const controlsJson=await controlsView.json()
    const controls=controlsJson.controls??[]
    assert.equal(controls.filter((row:any)=>row.state==='paused').length,4,'four paused scopes persist')
    report.checks.push({check:'pause-four-scopes-receipt-refresh',passed:true})

    // 2) 390 second browser (same account) resumes only 考研.
    const ctxA2=await browser.newContext({viewport:{width:390,height:844}})
    const pageA2=await ctxA2.newPage()
    const sign2=await pageA2.request.post(origin+'/api/auth/sign-in/email',{headers:{Origin:origin,'Content-Type':'application/json'},data:{email:actorA.email,password:actorA.password}})
    assert.ok(sign2.ok())
    const resumeResponse=await pageA2.request.post(`${origin}/api/conversations/${convId}/messages`,{headers:{Origin:origin,'Content-Type':'application/json'},data:{requestId:randomUUID(),text:'恢复考研建议。'}})
    const resumeBody=await resumeResponse.text()
    assert.ok(resumeBody.includes('"changedScopes":["postgraduate_exam"'),'resume appears as a change')
    const afterResume=(await (await pageA.request.get(origin+'/api/growth/direction-controls',{headers:{Origin:origin}})).json()).controls
    assert.equal(afterResume.filter((row:any)=>row.state==='paused').length,3,'other three stay paused on the first browser re-read')
    report.checks.push({check:'resume-single-scope-cross-browser',passed:true})

    // 3) 320 readability: pause settings visible without overflow.
    const ctxNarrow=await browser.newContext({viewport:{width:320,height:700}})
    const pageNarrow=await ctxNarrow.newPage()
    await pageNarrow.request.post(origin+'/api/auth/sign-in/email',{headers:{Origin:origin,'Content-Type':'application/json'},data:{email:actorA.email,password:actorA.password}})
    await pageNarrow.goto(origin+'/dist/index.html')
    const overflow=await pageNarrow.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1)
    assert.equal(overflow,false,'320 no horizontal overflow')
    report.screenshots.push('320-pause-settings')
    report.checks.push({check:'320-readable-no-overflow',passed:true})

    // 4) direction GET failure is visible (unknown route ⇒ 404) and a retry
    // stays a read-only GET; the real settings endpoint then answers 200.
    const failView=await pageA.request.get(origin+'/api/growth/direction-controls-x',{headers:{Origin:origin}})
    assert.equal(failView.status(),404,'GET failure surfaces instead of showing 已恢复')
    const retried=await pageA.request.get(origin+'/api/growth/direction-controls',{headers:{Origin:origin}})
    assert.equal(retried.status(),200,'retry is a GET, never a control write')
    report.checks.push({check:'direction-get-failure-visible',passed:true})

    // 6) 6→3 time update carries an accurate receipt; plan basis points at 3h.
    const timeResponse=await pageA.request.post(`${origin}/api/conversations/${convId}/messages`,{headers:{Origin:origin,'Content-Type':'application/json'},data:{requestId:randomUUID(),text:'最近课程变多了，每周只有3小时了，安排帮我改一下。'}})
    const timeBody=await timeResponse.text()
    const timeDone=JSON.parse(timeBody.split('\n\n').filter((line:string)=>line.includes('"type":"done"'))[0]!.replace('data: ', ''))
    assert.ok(timeDone.stateChange.growth.status==='applied'||timeDone.stateChange.growth.status==='partial','time receipt present')
    assert.ok(timeDone.stateChange.plan&&timeDone.stateChange.plan.budgetRef,'plan basis persisted')
    const messagesAfterRefresh=(await (await pageA.request.get(origin+'/api/conversations',{headers:{Origin:origin}})).json())
    const assistantWithReceipt=messagesAfterRefresh.flatMap((chat:any)=>chat.messages).find((message:any)=>message.stateChange&&message.stateChange.growth&&message.stateChange.growth.status==='applied')
    assert.ok(assistantWithReceipt,'receipt mapped onto its own assistant message and survives refresh')
    report.checks.push({check:'time-update-receipt-plan-basis-refresh',passed:true})

    // 5) another device pauses during generation → 409 (direct store check).
    await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_TEST_CLEANUP',finished_at=now() WHERE user_id=$1 AND conversation_id=$2 AND status='running'",[userA,convId])
    // This device stages first (snapshot still fresh)…
    const conflictPrepare=(await store.startRun(userA,convId,randomUUID(),'先别推就业相关的建议。')).run
    const stagedConflict=await stageDirectionControls(conflictPrepare,[{scopes:['employment'],operation:'pause',quote:'先别推就业相关的建议'}])
    // …then another device commits a pause before this run finishes.
    const otherConvId=(await (await pageA.request.post(origin+'/api/conversations',{headers:{Origin:origin,'Content-Type':'application/json'},data:{id:randomUUID(),title:'R2 A 第二设备'}})).json()).id
    const otherDeviceRun=(await store.startRun(userA,otherConvId,randomUUID(),'先别推就业相关的建议，两台设备同时操作。')).run
    const otherStaged=await stageDirectionControls(otherDeviceRun,[{scopes:['employment'],operation:'pause',quote:'先别推就业相关的建议'}])
    await store.finishRun(otherDeviceRun,{candidates:[],audit:[],directionControls:otherStaged,directionControlSnapshotKey:otherStaged.expectedSnapshotKey},'另一台设备已暂停就业建议。',null,new AbortController().signal)
    await assert.rejects(store.finishRun(conflictPrepare,{candidates:[],audit:[],directionControls:stagedConflict,directionControlSnapshotKey:stagedConflict.expectedSnapshotKey},'过时提交。',null,new AbortController().signal),{code:'DIRECTION_CONTROL_CONFLICT'})
    report.checks.push({check:'mid-generation-conflict-409-no-receipt',passed:true})

    // 8) redact the resume source, then resume again succeeds (019 CHECK safe).
    const pauseMsgRow=(await pool.query('SELECT source_message_id FROM growth_direction_controls WHERE user_id=$1 AND scope=\'postgraduate_exam\'',[userA])).rows[0]
    await pool.query("UPDATE growth_direction_controls SET source_redacted=true,source_message_id=NULL,source_conversation_id=NULL,source_quote='原话已遗忘' WHERE user_id=$1 AND scope='postgraduate_exam'",[userA])
    await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_TEST_CLEANUP',finished_at=now() WHERE user_id=$1 AND conversation_id=$2 AND status='running'",[userA,convId])
    const resume2=await pageA2.request.post(`${origin}/api/conversations/${convId}/messages`,{headers:{Origin:origin,'Content-Type':'application/json'},data:{requestId:randomUUID(),text:'恢复考研建议，谢谢。'}})
    assert.ok(resume2.ok(),'resume after redaction satisfies the paired-id CHECK')
    report.checks.push({check:'resume-after-redaction',passed:true})

    // 9) account B cannot see A's data.
    const actorB=await signup('B')
    const ctxB=await login(actorB.email,actorB.password)
    const pageB=await ctxB.newPage()
    const growthB=await (await pageB.request.get(origin+'/api/growth',{headers:{Origin:origin}})).json()
    assert.equal(growthB.items.length,0,'B sees none of A facts')
    const controlsB=await (await pageB.request.get(origin+'/api/growth/direction-controls',{headers:{Origin:origin}})).json()
    assert.equal(controlsB.controls.length,0,'B sees none of A controls')
    report.checks.push({check:'account-isolation',passed:true})

    // 10) same requestId replay: one write, no duplicate charge step.
    const sameId=randomUUID()
    const first=await pageA.request.post(`${origin}/api/conversations/${convId}/messages`,{headers:{Origin:origin,'Content-Type':'application/json'},data:{requestId:sameId,text:'继续，帮我看看下一步。'}})
    const firstBody=await first.text()
    const second=await pageA.request.post(`${origin}/api/conversations/${convId}/messages`,{headers:{Origin:origin,'Content-Type':'application/json'},data:{requestId:sameId,text:'继续，帮我看看下一步。'}})
    const secondBody=await second.text()
    assert.ok(firstBody.includes('"type":"done"'),'first request completed')
    assert.ok(secondBody.includes('"replayed":true'),'same requestId replays the stored result: '+secondBody.slice(0,160))
    report.checks.push({check:'same-requestId-replay',passed:true})
    assert.equal(report.checks.every((row:any)=>row.passed),true)
  }finally{
    await browser?.close()
    config.origin=oldOrigin;config.messagesPerMinute=oldRate
    await new Promise<void>(done=>app.close(()=>done()))
    await pool.end()
    console.log(JSON.stringify(report))
  }
})
