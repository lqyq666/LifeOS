import {setProviderBudget,providerBudgetView,providerReservationCny} from '../../server/provider-spend.ts'
import {readFileSync} from 'node:fs'
import { indexCoachEventOnce } from '../../server/coach-retrieval.ts'
import { setMemorySettings } from '../../server/memory.ts'
import { stageCoachEvent } from '../../server/action-coach-events.ts'
import { localEmbedding } from '../../server/local-embedding.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createTurnEngine } from '../../server/agent.ts'
import { model,resolveModel } from '../../server/model.ts'
import { config } from '../../server/config.ts'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { coachEventView } from '../../server/action-coach-events.ts'
import { importKnowledge, type KnowledgeCard } from '../../server/campus-knowledge.ts'
import { createGrowthItem, actOnGrowthItem } from '../../server/growth.ts'

test('the only turn core uses natural replies and event deltas, with one bounded repair and no legacy fallback (simulated provider)',async t=>{
  await localEmbedding.start()
  const observed:{phase:string;call:any}[]=[],captured:{callId:string;text:string}[]=[],payloads:any[]=[],oldURL=model.baseUrl,oldKey=config.apiKey,user='coach-engine-'+randomUUID()
  let denyCall=false
  const engine=createTurnEngine({capabilityVerified:()=>true,providerCallObserver:{
    allowRepair:true, // Explicitly synthetic bounded-repair regression, never the normal paid policy.
    before(call){if(denyCall)throw new Error('SYNTHETIC_BUDGET_DENIED');observed.push({phase:'before',call})},
    after(call){observed.push({phase:'after',call})},
    output(call,text){captured.push({callId:call.callId,text})},
    payload(_call,payload){payloads.push(structuredClone(payload));(payload as any).model='observer-cannot-change-transmission'},
  }})
  const outputs:unknown[]=[],requests:any[]=[]
  const fake=createServer((req,res)=>{
    const chunks:Buffer[]=[];req.on('data',chunk=>chunks.push(Buffer.from(chunk)))
    req.on('end',async()=>{
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const output=outputs.shift()
      if(output===undefined){res.writeHead(500);res.end();return}
      const streamed=output as any
      const content=typeof output==='string'?output:JSON.stringify(output)
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      const base={id:'synthetic-coach-'+requests.length,object:'chat.completion.chunk',created:1,model:streamed?.responseModel??model.id}
      for(const thought of streamed?.thinkingChunks??[])res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{reasoning_content:thought},finish_reason:null}]})+'\n\n')
      if(streamed?.chunks){
        for(const chunk of streamed.chunks){
          res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:chunk},finish_reason:null}]})+'\n\n')
        }
        await streamed.wait
      }else res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})+'\n\n')
      res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:streamed?.usage??{prompt_tokens:200,completion_tokens:100,total_tokens:300,prompt_tokens_details:{cached_tokens:20}}})+'\n\ndata: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve))
  model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-action-coach-local-provider-key'
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC one core'})
  async function prepare(text:string){
    const run=(await store.startRun(user,conversation,randomUUID(),text)).run
    const staged:store.Staged={candidates:[],audit:[]}
    return {run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:(_event:Record<string,unknown>)=>{}}
  }
  let eventId=''
  const sourceIds:string[]=[]
  try{
    await t.test('corrected growth goals reach the real SDK payload and persist through the same turn transaction (simulated provider)',async()=>{
      const original=await createGrowthItem(user,{requestId:randomUUID(),conversationId:conversation,kind:'goal',text:'先探索就业'})
      await actOnGrowthItem(user,original.id,{requestId:randomUUID(),expectedRevision:original.revision,action:'correct',text:'现在先准备期末'})
      const input=await prepare('本周有一个竞赛机会，我该怎样取舍？')
      outputs.push({reply:'先守住当前期末重点，再核对竞赛是否会挤压复习时间。'})
      const before=requests.length,result=await engine(input)
      assert.equal(requests.length-before,1)
      const state=JSON.parse(requests.at(-1).messages[1].content)
      assert.ok(state.growth.some((row:any)=>row.id===original.id&&row.text==='现在先准备期末'))
      assert.ok(!JSON.stringify(state.growth).includes('先探索就业'))
      assert.deepEqual(input.staged.usedGrowthRefs,[{id:original.id,revision:2}])
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('bounded thinking reaches SDK transport, counts full completion tokens and never exposes internal reasoning',async()=>{
      const previous=config.qwenThinkingBudget,input=await prepare('时间有限，需要权衡课程和探索方向。')
      try{
        config.qwenThinkingBudget=2048
        const marker='SYNTHETIC_INTERNAL_REASONING_NOT_USER_CONTENT',reply='先保留课程底线，再缩小探索范围。'
        outputs.push({chunks:[JSON.stringify({reply})],thinkingChunks:[marker],usage:{prompt_tokens:200,completion_tokens:300,total_tokens:500,prompt_tokens_details:{cached_tokens:0}}})
        const result=await engine(input)
        assert.equal(requests.at(-1).enable_thinking,true);assert.equal(requests.at(-1).thinking_budget,2048)
        assert.equal((result.usage as any).outputTokens,300,'completion usage includes reasoning, not just answer tokens')
        assert.equal(result.text,reply);assert.ok(!captured.at(-1)!.text.includes(marker))
        await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      }finally{config.qwenThinkingBudget=previous}
    })
    await t.test('automatic growth changes pass through the SDK schema and durable turn completion',async()=>{
      const input=await prepare('我是成年大学生，最近在梳理方向。')
      outputs.push({reply:'先按你目前的时间，从一个小探索开始。',growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}]})
      const before=requests.length,result=await engine(input)
      assert.equal(requests.length-before,1)
      assert.ok(JSON.stringify(requests.at(-1).response_format).includes('growthUpdates'))
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal(saved.growthIds.length,1)
      const persisted=(await pool.query('SELECT text,assertion FROM growth_items WHERE user_id=$1 AND id=$2',[user,saved.growthIds[0]])).rows[0]
      assert.equal(persisted.assertion,'user_reported')
      assert.equal(persisted.text,'我是成年大学生','server saves the exact clause text')
    })
    await t.test('a contradictory legacy expiry gets one bounded repair; only the verified constraint persists',async()=>{
      const input=await prepare('本周我只有两小时能做项目。')
      outputs.push(
        {reply:'先按本周剩余时间来。',growthUpdates:[{target:{operation:'create'},kind:'constraint',assertion:'user_reported',source:{clauseId:'c0'},timeEvidence:{kind:'calendar_week',which:'this',clauseId:'c0'},validUntil:'2099-01-01T16:00:00.000Z'}]},
        {reply:'先按本周剩余时间来。',growthUpdates:[{target:{operation:'create'},kind:'constraint',assertion:'user_reported',source:{clauseId:'c0'},timeEvidence:{kind:'calendar_week',which:'this',clauseId:'c0'}}]},
      )
      const before=requests.length,result=await engine(input)
      assert.equal(requests.length-before,2)
      assert.equal((result.usage as any).repairReason,'GROWTH_TIME_UNVERIFIED')
      assert.ok(requests.at(-1).messages[0].content.includes('belongs in kind "context"'),'time-specific repair guidance reaches the repair call')
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal(saved.growthIds.length,1)
      const persisted=(await pool.query('SELECT text,valid_until FROM growth_items WHERE user_id=$1 AND id=$2',[user,saved.growthIds[0]])).rows[0]
      assert.equal(persisted.text,'本周我只有两小时能做项目')
      assert.ok(persisted.valid_until&&Date.parse(persisted.valid_until)<Date.parse('2099-01-01'),'expiry is the verified week window, never the fabricated 2099 date')
    })
    await t.test('a requested artifact delivered inline without action is repaired into the durable material',async()=>{
      const text='同学还需不需要我不知道，请直接帮我写一句确认消息。',input=await prepare(text)
      const material='之前那份资料，你现在还需要吗？不需要也没关系。'
      const source={messageId:input.run.source_message_id,quote:text}
      outputs.push({reply:'帮你拟好了，直接复制发给他就行：\n'+material,event:{target:{operation:'create',title:'确认资料需求',source}}},{reply:'可以先发这句：',event:{target:{operation:'create',title:'确认资料需求',source},action:{operation:'create',draft:{content:material}}}})
      const before=requests.length,result=await engine(input)
      assert.equal(requests.length-before,2)
      assert.equal((result.usage as any).repairReason,'COACH_MATERIAL_NOT_VISIBLE')
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal(saved.event!.actions[0]!.draft!.content,material)
      assert.ok(result.text.includes(material))
      const incomplete=await prepare('帮我写一封介绍邮件。'),next=requests.length
      outputs.push({reply:'邮件要发给谁，你希望介绍哪件事？'})
      const clarified=await engine(incomplete)
      assert.equal(requests.length-next,1,'a necessary clarification does not force placeholder material')
      assert.equal(incomplete.staged.coach,undefined)
      await store.finishRun(incomplete.run,incomplete.staged,clarified.text,clarified.usage,incomplete.signal)
    })
    await t.test('reported capacity permits coaching examples without forcing an artifact or repair',async()=>{
      const input=await prepare('我大三，做过三个课程作品，最近可以抽空做探索。'),before=requests.length
      outputs.push({reply:'先选择一个作品找真实使用者了解反馈。可以这样问：你能看清活动时间吗？'})
      const result=await engine(input)
      assert.equal(requests.length-before,1)
      assert.equal((result.usage as any).repairCalls,0)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('disabled automatic repair preserves the original validation code and billed first call',async()=>{
      const input=await prepare('请帮我写一句确认消息。'),before=requests.length
      let reservations=0
      const restricted=createTurnEngine({capabilityVerified:()=>true,providerCallObserver:{
        allowRepair:false,
        before(call){reservations++;observed.push({phase:'before',call})},
        after(call){observed.push({phase:'after',call})},
        output(call,text){captured.push({callId:call.callId,text})},
        payload(_call,payload){payloads.push(structuredClone(payload))},
      }})
      outputs.push({reply:'可以这样问：现在还需要那份资料吗？'})
      await assert.rejects(restricted(input),(error:any)=>error.code==='COACH_MATERIAL_NOT_VISIBLE')
      assert.equal(requests.length-before,1);assert.equal(reservations,1)
      assert.equal((input.staged.modelUsage as any).llmCallCount,1)
      assert.equal((input.staged.modelUsage as any).repairCalls,0)
      assert.ok(input.staged.audit.some((entry:any)=>entry.phase==='coach_repair_blocked'&&entry.code==='COACH_MATERIAL_NOT_VISIBLE'&&entry.providerRequestSent===false))
      await store.terminateRun(user,input.run.request_id,'failed','COACH_MATERIAL_NOT_VISIBLE')
    })
    await t.test('an unchanged fragment correction gets one specific repair and preserves the complete fact',async()=>{
      const other=randomUUID();await store.createConversation(user,{id:other,title:'SYNTHETIC fragment correction'})
      const original='我花了三小时整理四十页。同学说手机打不开，所以没看。'
      const seed=(await store.startRun(user,other,randomUUID(),original)).run
      const coach=await stageCoachEvent(seed,{target:{operation:'create',title:'资料整理',source:{messageId:seed.source_message_id,quote:original}},nodes:[{kind:'fact',source:{messageId:seed.source_message_id,quote:original}}]},'了解事情经过。')
      await store.finishRun(seed,{candidates:[],audit:[],coach},coach.reply,null,new AbortController().signal)
      const event=(await coachEventView(user,other))!
      const text='同学说手机打不开，所以没看。我想帮他整理资料。'
      const run=(await store.startRun(user,other,randomUUID(),text)).run
      const input={run,staged:{candidates:[],audit:[]} as store.Staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:(_event:Record<string,unknown>)=>{}}
      const target={operation:'continue',eventId:event.id,expectedRevision:event.revision},reply='当时他具体希望整理什么内容？'
      outputs.push({reply,event:{target,corrections:[{nodeId:event.nodes[0]!.id,source:{messageId:run.source_message_id,quote:'同学说手机打不开，所以没看。'}}]}},{reply,event:{target,nodes:[{kind:'user_interpretation',source:{messageId:run.source_message_id,quote:'我想帮他整理资料。'}}]}})
      const before=requests.length,result=await engine(input)
      assert.equal(requests.length-before,2)
      assert.equal((result.usage as any).repairReason,'COACH_CORRECTION_UNCHANGED')
      assert.match(JSON.parse(requests.at(-1).messages[1].content).validationGuidance,/Omit this correction/)
      await store.finishRun(run,input.staged,result.text,result.usage,input.signal)
      assert.ok((await coachEventView(user,other))!.nodes.some(node=>node.content===original))
    })
    await t.test('SDK payload observation records final configured parameters without changing the transmitted request',async()=>{
      const input=await prepare('这轮先听我说，不需要行动。'),before=payloads.length
      outputs.push({reply:'好，我在听。'})
      const result=await engine(input)
      assert.equal(payloads.length,before+1)
      assert.equal(payloads.at(-1).model,model.id)
      assert.equal(requests.at(-1).model,model.id)
      assert.equal(requests.at(-1).enable_thinking,false)
      assert.equal(requests.at(-1).temperature,0)
      assert.equal(requests.at(-1).response_format.type,'json_schema')
      assert.equal(requests.at(-1).max_completion_tokens,8192)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('SDK response model differences survive observer, usage, audit and persistence without changing the requested model',async()=>{
      for(const responseModel of ['synthetic-served-snapshot',model.id]){
        const input=await prepare('合成响应元数据验证：这轮只听我说。')
        outputs.push({chunks:[JSON.stringify({reply:'好，我在听。'})],wait:Promise.resolve(),responseModel})
        const result=await engine(input),expected=responseModel===model.id?null:responseModel
        assert.equal(requests.at(-1).model,model.id)
        assert.equal((result.usage as any).calls[0].providerResponseModel,expected)
        assert.equal(observed.filter(o=>o.phase==='after').at(-1)!.call.providerResponseModel,expected)
        assert.equal((input.staged.audit.find((a:any)=>a.phase==='model_call_completed') as any).providerResponseModel,expected)
        await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
        const saved=(await pool.query('SELECT usage FROM runs WHERE user_id=$1 AND request_id=$2',[user,input.run.request_id])).rows[0].usage
        assert.equal(saved.calls[0].providerResponseModel,expected)
      }
    })
    await t.test('service spend guard blocks SDK dispatch, settles real simulated usage and holds missing usage',async()=>{
      const previous=config.providerBudgetEnabled,oldId=config.providerBudgetId
      config.providerBudgetEnabled=true;config.providerBudgetId='synthetic-engine-'+randomUUID()
      const price=resolveModel('default').pricing
      const ceiling=providerReservationCny(model.contextWindow,8192,price)
      try{
        await setProviderBudget(config.providerBudgetId,0)
        let input=await prepare('Synthetic service budget blocked'),before=requests.length
        await assert.rejects(engine(input),(e:any)=>e.code==='PROVIDER_BUDGET_EXHAUSTED')
        assert.equal(requests.length,before)
        await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_BUDGET')
        await setProviderBudget(config.providerBudgetId,ceiling*3)
        input=await prepare('Synthetic valid billed response')
        outputs.push({reply:'好，我在听。'})
        const result=await engine(input)
        await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
        assert.equal(Number((await providerBudgetView())!.accounted_cny),(result.usage as any).estimatedCostCny)
        input=await prepare('Synthetic unavailable provider usage')
        outputs.push({chunks:['{"reply":"你想从哪里开始说？"}'],usage:{input:0,output:0,cacheRead:0,cacheWrite:0,prompt_tokens:0,completion_tokens:0,total_tokens:0}})
        const missing=await engine(input)
        await store.finishRun(input.run,input.staged,missing.text,missing.usage,input.signal)
        assert.equal((missing.usage as any).estimatedCostCny,'unknown')
        assert.equal((await providerBudgetView())!.unknown_or_active_calls,1)
        const accounted=Number((await providerBudgetView())!.accounted_cny)
        assert.ok(accounted>=ceiling)
        await setProviderBudget(config.providerBudgetId,accounted)
        input=await prepare('Synthetic unknown usage consumes reservation')
        before=requests.length
        await assert.rejects(engine(input),(e:any)=>e.code==='PROVIDER_BUDGET_EXHAUSTED')
        assert.equal(requests.length,before)
        await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_BUDGET')
        await setProviderBudget(config.providerBudgetId,accounted+ceiling)
        input=await prepare('Synthetic secondary observer refuses before dispatch')
        denyCall=true
        try{await assert.rejects(engine(input),/SYNTHETIC_BUDGET_DENIED/)}finally{denyCall=false}
        assert.equal(requests.length,before)
        assert.equal(Number((await providerBudgetView())!.accounted_cny),accounted)
        assert.equal((await pool.query("SELECT status FROM lifeos_provider_spend WHERE user_id=$1 AND request_id=$2",[user,input.run.request_id])).rows[0].status,'not_sent')
        await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_SECONDARY_OBSERVER')
      }finally{
        outputs.length=0
        await pool.query('DELETE FROM lifeos_provider_spend WHERE budget_id=$1',[config.providerBudgetId])
        await pool.query('DELETE FROM lifeos_provider_budgets WHERE id=$1',[config.providerBudgetId])
        config.providerBudgetEnabled=previous;config.providerBudgetId=oldId
      }
    })
    await t.test('saved real invented event target is repaired once without accepting an unauthorized identity',async()=>{
      const input=await prepare('我做了上次的行动，但对方没有使用。'),before=requests.length
      const invalid=JSON.parse(readFileSync(new URL('../fixtures/coach-invented-event.json',import.meta.url),'utf8'))
      outputs.push(invalid,{reply:'上次具体做了什么，对方怎样告诉你没有使用？'})
      try{
      const result=await engine(input)
      assert.equal(requests.length,before+2)
      assert.equal((result.usage as any).repairReason,'COACH_EVENT_TARGET_INVALID')
      assert.equal(input.staged.coach,undefined)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM coach_events WHERE id=$1',[invalid.event.target.eventId])).rows[0].n,0)
      }finally{outputs.length=0;await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_REGRESSION_CLEANUP')}
    })
    await t.test('a provider transport failure still finishes its reservation exactly once',async()=>{
      const input=await prepare('模拟服务端错误。'),before=requests.length
      outputs.push(undefined)
      await assert.rejects(engine(input))
      assert.equal(requests.length,before+1)
      assert.equal(observed.at(-1)!.phase,'after');assert.equal(observed.at(-1)!.call.outcome,'failed')
      assert.equal(observed.at(-1)!.call.usageCompleteness,'unavailable')
      await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_TRANSPORT_FAILURE')
    })
    await t.test('a refused reservation makes no provider request or derived write',async()=>{
      const input=await prepare('模拟额度保护拒绝。'),before=requests.length,observedBefore=observed.length
      denyCall=true
      try{await assert.rejects(engine(input),/SYNTHETIC_BUDGET_DENIED/)}finally{denyCall=false}
      assert.equal(requests.length,before);assert.equal(observed.length,observedBefore)
      assert.equal(input.staged.coach,undefined)
      await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_BUDGET_DENIED')
    })
    await t.test('a question draft reaches the client before the provider finishes and remains unsaved',async()=>{
      const input=await prepare('我发了网盘链接，对方没看。'),events:any[]=[]
      let release!:()=>void,resolveDraft!:()=>void
      const wait=new Promise<void>(resolve=>{release=resolve})
      const arrived=new Promise<void>(resolve=>{resolveDraft=resolve})
      input.emit=(event:any)=>{events.push(event);if(event.type==='draft')resolveDraft()}
      const question='那当时你是通过什么方式发给他的？',reply='你提到发了链接。'+question
      outputs.push({chunks:['{"reply":"你提到发了链接。那当时你是通过','什么方式发给他的？"}'],wait})
      const pending=engine(input)
      let timeout:ReturnType<typeof setTimeout>|undefined
      try{
        await Promise.race([arrived,new Promise((_,reject)=>timeout=setTimeout(()=>reject(new Error('No progressive draft')),3000))])
        assert.deepEqual(events[0],{type:'draft',text:question,saved:false,draftKind:'safe_question'})
        assert.equal(input.staged.coach,undefined)
        const saved=await pool.query('SELECT status FROM runs WHERE request_id=$1',[input.run.request_id])
        assert.equal(saved.rows[0].status,'running')
      }finally{clearTimeout(timeout);release()}
      const result=await pending;assert.equal(result.text,reply)
      const timing=(result.usage as any).calls[0]
      assert.equal(typeof timing.firstRawDeltaMs,'number')
      assert.equal(typeof timing.firstQuestionDraftMs,'number')
      assert.ok(timing.firstRawDeltaMs<=timing.firstQuestionDraftMs)
      assert.ok(timing.firstQuestionDraftMs<=timing.latencyMs)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('a rejected draft is withdrawn before one bounded repair produces the saved answer',async()=>{
      const input=await prepare('我今天卡住了，但还没有解释经过。'),events:any[]=[]
      input.emit=(event:any)=>events.push(event)
      outputs.push({reply:'你想先说哪一步卡住了？',event:{target:{operation:'create',title:'不可靠来源',source:{messageId:input.run.source_message_id,quote:'不是用户原话'}}}},{reply:'可以从你愿意讲的部分开始。'})
      const result=await engine(input)
      assert.deepEqual(events.map(event=>event.type),['draft','draft_discarded'])
      assert.equal((result.usage as any).repairCalls,1)
      assert.equal(result.text,'可以从你愿意讲的部分开始。')
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('successful text with empty SDK usage is unknown billing rather than a zero-cost claim',async()=>{
      const input=await prepare('这轮只谈谈近况。'),reply='你可以从愿意说的部分开始。'
      outputs.push({chunks:[JSON.stringify({reply})],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}})
      const result=await engine(input),usage=result.usage as any
      assert.equal(result.text,reply);assert.equal(usage.calls.length,1)
      assert.equal(usage.calls[0].usageCompleteness,'unavailable')
      assert.equal(usage.calls[0].estimatedCostCny,'unknown');assert.equal(usage.estimatedCostCny,'unknown')
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('a historical quote cannot become current evidence; one source repair preserves the actual new facts',async()=>{
      const earlier='我曾经给人发了资料但没看。',prior=await prepare(earlier)
      outputs.push({reply:'你想复盘哪一部分？'})
      const priorResult=await engine(prior)
      await store.finishRun(prior.run,prior.staged,priorResult.text,priorResult.usage,prior.signal)
      const current='我今天又整理了四十页。',input=await prepare(current),source={messageId:input.run.source_message_id,quote:current}
      const correct={reply:'你想先核对这次交付的哪一步？',event:{target:{operation:'create',title:'本次整理四十页',source},nodes:[{kind:'fact',source}]}}
      outputs.push({...correct,event:{...correct.event,target:{...correct.event.target,source:{...source,quote:earlier}}}},correct)
      const before=requests.length,result=await engine(input)
      assert.equal(requests.length-before,2)
      assert.equal((result.usage as any).repairReason,'COACH_SOURCE_INVALID')
      const repair=JSON.parse(requests.at(-1).messages[1].content)
      assert.match(repair.validationGuidance,/contiguous exact substring/)
      assert.match(repair.validationGuidance,/Older known facts/)
      assert.match(requests.at(-1).messages[0].content,/具体修复要求：[\s\S]*contiguous exact substring/)
      assert.deepEqual(input.staged.coach?.delta.nodes,[{kind:'fact',source}])
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      const saved=await coachEventView(user,conversation)
      assert.equal(saved?.nodes.filter(node=>node.kind==='fact').length,1)
      assert.equal(saved?.nodes[0].content,current)
      assert.equal(saved?.nodes[0].source?.messageId,input.run.source_message_id)
    })
    await t.test('saved paraphrased background gets concrete current-source repair and repeated failure cannot dispatch a third call',async()=>{
      const fixture=JSON.parse(readFileSync('tests/fixtures/coach-invalid-background.json','utf8'))
      const text='我想在明天下午打开微信时，先询问同学是否还需要资料。请把它写成一句如果……就……，给出核验过的实施意图定义与适用范围，不要声称能保证效果。'
      let input=await prepare(text),before=requests.length
      const invalid=(messageId:string)=>({reply:fixture.reply,background:fixture.background.map((fact:any)=>({...fact,source:{...fact.source,messageId}}))})
      try{
      outputs.push(invalid(input.run.source_message_id),{reply:fixture.reply})
      const result=await engine(input)
      assert.equal(requests.length-before,2);assert.equal((result.usage as any).repairReason,'COACH_BACKGROUND_INVALID')
      const repair=JSON.parse(requests.at(-1).messages[1].content)
      assert.match(repair.validationGuidance,/value must be an exact substring/)
      assert.match(requests.at(-1).messages[0].content,/Omit unsupported or transient background/)
      assert.equal(result.text,fixture.reply);assert.deepEqual(input.staged.memoryChanges,[])
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM memory_items WHERE user_id=$1 AND value=to_jsonb($2::text)",[user,'使用微信'])).rows[0].n,0)
      input=await prepare(text);before=requests.length
      outputs.push(invalid(input.run.source_message_id),invalid(input.run.source_message_id))
      await assert.rejects(engine(input),(e:any)=>e.code==='COACH_BACKGROUND_INVALID')
      assert.equal(requests.length-before,2);assert.deepEqual(input.staged.memoryChanges,[])
      await store.terminateRun(user,input.run.request_id,'failed','COACH_BACKGROUND_INVALID')
      }finally{await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_BACKGROUND_TEST_CLEANUP')}
    })
    await t.test('a schema array is rejected and receives one concrete instantiated-object repair',async()=>{
      const input=await prepare('这次只想说说心情。'),before=requests.length
      outputs.push([{type:'object',properties:{reply:{type:'string'}}}],{reply:'你想从哪一段心情说起？'})
      const result=await engine(input)
      assert.equal(requests.length-before,2)
      assert.equal((result.usage as any).repairReason,'COACH_OUTPUT_INVALID')
      assert.match(JSON.parse(requests.at(-1).messages[1].content).validationGuidance,/never a schema, schema array/)
      assert.equal(input.staged.coach,undefined)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('an independent planned candidate is rejected without another call while valid material commits',async()=>{
      const text='我想明天打开聊天时先问同学是否还需要资料。',input=await prepare(text),source={messageId:input.run.source_message_id,quote:text},before=requests.length
      const content='如果明天打开聊天，我就先询问同学是否还需要资料。'
      const correct={reply:'可以使用这句话：',event:{target:{operation:'create',title:'询问资料需要',source},action:{operation:'create',draft:{content}}}}
      outputs.push({...correct,experienceCandidate:{source:{clauseIds:['c0']}}})
      const result=await engine(input)
      assert.equal(requests.length-before,1)
      assert.equal((result.usage as any).repairCalls,0)
      assert.ok(input.staged.audit.some((entry:any)=>entry.phase==='coach_optional_candidate_rejected'&&entry.code==='PLANNED_ACTION_IS_NOT_EXPERIENCE'))
      assert.equal(input.staged.candidates.length,0)
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal(saved.event!.actions[0].draft!.content,content)
      assert.ok(result.text.includes(content))
      assert.equal((await pool.query('SELECT id FROM experiences WHERE request_id=$1',[input.run.request_id])).rowCount,0)
    })
    await t.test('a skill candidate cannot discard an otherwise usable action or create an experience',async()=>{
      const text='我会Python。请帮我写一句给同学的开场。',input=await prepare(text),source={messageId:input.run.source_message_id,quote:'我会Python。'},before=requests.length
      outputs.push({reply:'可以这样开口：',event:{target:{operation:'create',title:'联系同学',source},action:{operation:'create',draft:{content:'你现在有需要用Python处理的小任务吗？'}}},experienceCandidate:{source:{clauseIds:['c0']}}})
      const result=await engine(input)
      assert.equal(requests.length-before,1);assert.equal(input.staged.candidates.length,0)
      assert.ok(input.staged.audit.some((entry:any)=>entry.phase==='coach_optional_candidate_rejected'&&entry.code==='SKILL_IS_NOT_EXPERIENCE'))
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal((await pool.query('SELECT id FROM experiences WHERE request_id=$1',[input.run.request_id])).rowCount,0)
    })
    await t.test('saving intent and saving claims still require a concrete repair rather than silent candidate rejection',async()=>{
      for(const explicit of [true,false]){
        const text='我想明天询问同学是否还需要资料。'+(explicit?'请保存为经历。':''),input=await prepare(text),source={messageId:input.run.source_message_id,quote:text},before=requests.length
        const event={target:{operation:'create',title:'询问资料需要',source},action:{operation:'create',draft:{content:'你现在还需要资料吗？'}}}
        outputs.push({reply:explicit?'可以这样问：':'已保存这段经历。',event,experienceCandidate:{source:{clauseIds:['c0']}}},{reply:'这只是未来计划，不能保存为已发生经历。可使用下面的消息：',event})
        const result=await engine(input)
        assert.equal(requests.length-before,2);assert.equal((result.usage as any).repairReason,'PLANNED_ACTION_IS_NOT_EXPERIENCE')
        assert.match(requests.at(-1).messages[0].content,/具体修复要求：Omit experienceCandidate entirely/)
        assert.equal(input.staged.candidates.length,0)
        assert.ok(!input.staged.audit.some((entry:any)=>entry.phase==='coach_optional_candidate_rejected'))
        await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      }
    })
    await t.test('an unresolvable clause selection drops on an ordinary turn and repairs on a saving turn',async()=>{
      const text='我想明天询问同学。',input=await prepare(text),source={messageId:input.run.source_message_id,quote:text},before=requests.length
      const event={target:{operation:'create',title:'询问同学',source},action:{operation:'create',draft:{content:'你现在还需要资料吗？'}}}
      outputs.push({reply:'可以这样问：',event,experienceCandidate:{source:{clauseIds:['c9']}}})
      const result=await engine(input)
      assert.equal(requests.length-before,1,'an ordinary turn drops the junk selection without another call')
      assert.ok(input.staged.audit.some((entry:any)=>entry.phase==='coach_optional_candidate_rejected'&&entry.code==='CANDIDATE_CLAUSE_UNRESOLVED'))
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      const saving=await prepare('请保存这段经历：'+text),after=requests.length
      outputs.push({reply:'已保存。',experienceCandidate:{source:{clauseIds:['c9']}}},{reply:'找不到对应的原话分句，请重新选择。'})
      const repaired=await engine(saving)
      assert.equal(requests.length-after,2);assert.equal((repaired.usage as any).repairReason,'SOURCE_QUOTE_MISMATCH')
      assert.ok(!saving.staged.audit.some((entry:any)=>entry.phase==='coach_optional_candidate_rejected'))
      await store.finishRun(saving.run,saving.staged,repaired.text,repaired.usage,saving.signal)
    })
    await t.test('a saved optional future candidate cannot block a valid reply without an action; source errors and saving intent still require repair',async()=>{
      const fixture=JSON.parse(readFileSync('tests/fixtures/coach-invalid-background.json','utf8'))
      const text='我想在明天下午打开微信时，先询问同学是否还需要资料。请把它写成一句如果……就……，给出核验过的实施意图定义与适用范围，不要声称能保证效果。'
      let input=await prepare(text),before=requests.length
      const reply={reply:fixture.reply}
      const proposed=()=>({...reply,experienceCandidate:{source:{clauseIds:['c0','c1']}}})
      try{
        outputs.push(proposed(),reply)
        const result=await engine(input)
        if(requests.length-before===1)assert.deepEqual(outputs.shift(),reply)
        assert.equal(requests.length-before,1);assert.equal(result.text,fixture.reply)
        assert.equal(input.staged.candidates.length,0);assert.equal(input.staged.coach,undefined)
        assert.ok(input.staged.audit.some((e:any)=>e.phase==='coach_optional_candidate_rejected'&&e.code==='PLANNED_ACTION_IS_NOT_EXPERIENCE'))
        await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM experiences WHERE request_id=$1',[input.run.request_id])).rows[0].n,0)
        input=await prepare('请保存这项经历：'+text);before=requests.length
        outputs.push(proposed(),reply)
        const explicit=await engine(input)
        assert.equal(requests.length-before,2);assert.equal((explicit.usage as any).repairReason,'PLANNED_ACTION_IS_NOT_EXPERIENCE')
        assert.ok(!input.staged.audit.some((e:any)=>e.phase==='coach_optional_candidate_rejected'))
        await store.finishRun(input.run,input.staged,explicit.text,explicit.usage,input.signal)
        input=await prepare(text);before=requests.length
        outputs.push({...reply,experienceCandidate:{source:{clauseIds:['c9']}}})
        const dropped=await engine(input)
        assert.equal(requests.length-before,1,'an unresolvable selection on an ordinary turn drops without repair')
        assert.ok(input.staged.audit.some((e:any)=>e.phase==='coach_optional_candidate_rejected'&&e.code==='CANDIDATE_CLAUSE_UNRESOLVED'))
        await store.finishRun(input.run,input.staged,dropped.text,dropped.usage,input.signal)
      }finally{await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_OPTIONAL_CANDIDATE_TEST_CLEANUP')}
    })
    await t.test('a genuine completed experience still becomes a confirmation candidate',async()=>{
      const text='昨天我完成了资料整理，交付给同学，对方看完后说有帮助。',input=await prepare(text),before=requests.length
      outputs.push({reply:'这次交付有明确回应。',experienceCandidate:{source:{clauseIds:['c0','c1','c2']}}})
      const result=await engine(input)
      assert.equal(requests.length-before,1);assert.equal(input.staged.candidates.length,1)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      const candidate=(await pool.query('SELECT status, confirm_source FROM experiences WHERE request_id=$1',[input.run.request_id])).rows[0]
      assert.equal(candidate.status,'confirmed');assert.equal(candidate.confirm_source,'auto')
    })
    await t.test('ordinary listening makes exactly one call and writes no forced business object',async()=>{
      const before=requests.length,input=await prepare('我今天只想倾听，不想复盘或做计划。')
      const reply='好，今天先不用做计划。你想从哪里说起，我在听。'
      outputs.push({reply})
      const result=await engine(input)
      assert.equal(result.text,reply)
      assert.equal(requests.length,before+1)
      assert.equal(input.staged.upstreamCalls,1)
      assert.equal(Object.hasOwn(input.staged,'decision'),false);assert.equal(Object.hasOwn(input.staged,'campus'),false);assert.equal(input.staged.coach,undefined)
      assert.deepEqual(requests.at(-1).response_format.json_schema.schema.required,['reply'])
      assert.doesNotMatch(requests.at(-1).messages[0].content,/grounding_review|hypothesisContract|reply≤|requiredForAction/)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('a complete process and long usable material survive unchanged with one authoritative action',async()=>{
      const before=requests.length,text='我整理了一份资料，对方说手机打不开，所以没有看。请直接帮我写消息。',input=await prepare(text)
      const content='这是一段确实需要完整保留的说明。'.repeat(30)
      const reply='可以使用下面的完整材料：\n'+content
      outputs.push({reply,event:{target:{operation:'create',title:'资料交付后反馈',source:{messageId:input.run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:input.run.source_message_id,quote:'对方说手机打不开，所以没有看'}}],action:{operation:'create',draft:{content}}}})
      const result=await engine(input)
      assert.equal(requests.length,before+1,'the presence of an action does not trigger another model')
      assert.equal(result.text,reply)
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      eventId=saved.event!.id
      assert.equal(saved.event!.actions[0]!.draft?.content,content)
      assert.equal((await store.decisionVersions(user,conversation)).length,0)
      assert.equal((result.usage as any).groundingReviewCalls,0)
    })
    await t.test('an unchanged modify gets one concrete repair and cannot fake a material revision',async()=>{
      const existing=(await coachEventView(user,conversation))!,action=existing.actions[0]!
      const input=await prepare('这个细节我记不清了。'),before=requests.length
      const reply='没关系，先保留未知。你原本想帮他解决什么问题？'
      const target={operation:'continue' as const,eventId,expectedRevision:existing.revision}
      outputs.push({reply,event:{target,action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,draft:action.draft}}},{reply,event:{target}})
      const result=await engine(input)
      assert.equal(requests.length-before,2)
      assert.equal((result.usage as any).repairReason,'COACH_ACTION_UNCHANGED')
      assert.match(requests.at(-1).messages[0].content,/draft exactly matches/)
      assert.equal(result.text,reply)
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal(saved.event!.actions[0]!.revision,action.revision)
      assert.deepEqual(saved.event!.actions[0]!.draft,action.draft)
      const failed=await prepare('请把消息改短一点。'),failureBefore=requests.length
      const current=(await coachEventView(user,conversation))!,unchanged={reply:'改好了。',event:{target:{operation:'continue',eventId,expectedRevision:current.revision},action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,draft:action.draft}}}
      outputs.push(unchanged,unchanged)
      await assert.rejects(engine(failed),(error:any)=>error.code==='COACH_ACTION_UNCHANGED')
      assert.equal(requests.length-failureBefore,2,'no third call after failed specific repair')
      assert.equal((await coachEventView(user,conversation))!.revision,current.revision)
      await store.terminateRun(user,failed.run.request_id,'failed','TEST_CLEANUP')
    })
    await t.test('unrelated messages cannot erase the current event source or pending action',async()=>{
      for(let i=0;i<10;i++){
        const input=await prepare('这是一条普通知识问题 '+i+'。');outputs.push({reply:'这轮只回答知识问题。'})
        const result=await engine(input);await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      }
      const input=await prepare('继续之前对方打不开资料那件事。')
      outputs.push({reply:'我们已经确认手机打不开，内容是否有用还没有检验。'})
      const result=await engine(input)
      const prompt=JSON.parse(requests.at(-1).messages.find((message:any)=>message.role==='user').content)
      assert.equal(prompt.currentEvent.id,eventId)
      assert.equal(prompt.currentEvent.nodes[0].content,'对方说手机打不开，所以没有看')
      assert.equal(prompt.currentEvent.actions.length,1)
      assert.ok(!requests.at(-1).messages.slice(2).some((message:any)=>JSON.stringify(message.content).includes('我整理了一份资料')),'old role messages remain outside the bounded conversation window')
      const requestSources=prompt.currentEvent.actions[0].requestSources
      assert.ok(requestSources.some((source:any)=>source.quote.includes('请直接帮我写消息')),'authorized material request survives independently of old dialogue roles')
      for(const source of requestSources){
        const original=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND id=$2 AND role='user'",[user,source.messageId])).rows[0]
        assert.ok(original?.content.includes(source.quote),'each request fragment remains an exact quote from this user')
      }
      assert.equal(requests.at(-1).messages.at(-1).role,'user')
      assert.equal(requests.at(-1).messages.at(-1).content,'继续之前对方打不开资料那件事。')
      assert.equal(prompt.currentUserMessage.id,input.run.source_message_id)
      assert.equal(prompt.currentUserMessage.text,undefined)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('authorized history is retrieved into the single core and recorded for commit revalidation',async()=>{
      await setMemorySettings(user,{enabled:true,expectedRevision:0,requestId:randomUUID()})
      const otherChat=randomUUID();await store.createConversation(user,{id:otherChat,title:'新对话'})
      const unrelated='我在食堂排队买了午饭。'
      const initial=(await store.startRun(user,otherChat,randomUUID(),unrelated)).run
      const coach=await stageCoachEvent(initial,{target:{operation:'create',title:'午饭',source:{messageId:initial.source_message_id,quote:unrelated}},nodes:[{kind:'fact',source:{messageId:initial.source_message_id,quote:unrelated}}]},'记录这次午饭过程。')
      await store.finishRun(initial,{candidates:[],audit:[],coach},coach.reply,null,new AbortController().signal)
      for(let i=0;i<10;i++)if(!await indexCoachEventOnce())break
      const run=(await store.startRun(user,otherChat,randomUUID(),'之前给对方发的文件在移动端无法查看，还记得吗？')).run
      const staged:store.Staged={candidates:[],audit:[]}
      outputs.push({reply:'之前记录的是手机打不开，是否还需要材料仍未确认。'})
      const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:()=>{}})
      const prompt=JSON.parse(requests.at(-1).messages.find((message:any)=>message.role==='user').content)
      assert.ok(prompt.events.some((event:any)=>event.id===eventId))
      assert.ok(staged.usedEventRefs?.some(ref=>ref.eventId===eventId))
      assert.equal(staged.upstreamCalls,1)
      await store.finishRun(run,staged,result.text,result.usage,new AbortController().signal)
    })
    await t.test('a concrete schema failure receives exactly one repair; second failure has no fallback',async()=>{
      const before=requests.length,input=await prepare('这轮请简单回答。')
      outputs.push('not JSON',{reply:'这是修复后的自然回应。'})
      const result=await engine(input)
      assert.equal(requests.length,before+2)
      assert.equal((result.usage as any).repairCalls,1)
      assert.equal((result.usage as any).calls[1].purpose,'repair')
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      const failed=await prepare('再验证一次失败边界。'),failedBefore=requests.length
      outputs.push('not JSON','still not JSON')
      await assert.rejects(engine(failed),(error:any)=>error.code==='COACH_OUTPUT_INVALID')
      assert.equal(requests.length,failedBefore+2)
      assert.equal(failed.staged.coach,undefined)
      assert.equal((await coachEventView(user,conversation))?.id,eventId)
      await store.terminateRun(user,failed.run.request_id,'failed','SYNTHETIC_INVALID_OUTPUT')
    })
    await t.test('unverified links in authoritative material remain rejected after rendering and both failed calls are retained',async()=>{
      const input=await prepare('我花了三小时整理四十页。'),before=requests.length,capturedBefore=captured.length
      const first={reply:'下面是材料。',event:{target:{operation:'continue',eventId,expectedRevision:(await coachEventView(user,conversation))!.revision},action:{operation:'create',draft:{content:'请参考 https://unverified.invalid/new-claim'}}}}
      const second={...first,reply:'对方具体说了什么？'}
      outputs.push(first,second)
      await assert.rejects(engine(input),(error:any)=>error.code==='COACH_CITATION_INVALID')
      assert.equal(requests.length,before+2);assert.equal(captured.length,capturedBefore+2)
      assert.deepEqual(captured.slice(capturedBefore).map(item=>JSON.parse(item.text)),[first,second])
      assert.equal(input.staged.coach,undefined)
      await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_UNVERIFIED_MATERIAL_URL')
    })
    await t.test('a material generated once is rendered and saved byte-for-byte with one call',async()=>{
      const input=await prepare('帮我起草一段确认需求的消息。'),before=requests.length
      const content='你现在还需要这份资料里的哪一部分？已经不需要也没关系。'
      outputs.push({reply:'可以直接使用这段：',event:{target:{operation:'continue',eventId,expectedRevision:(await coachEventView(user,conversation))!.revision},action:{operation:'create',draft:{content}}}})
      const result=await engine(input)
      assert.equal(requests.length,before+1);assert.equal((result.usage as any).repairCalls,0)
      assert.equal(result.text,'可以直接使用这段：\n\n'+content)
      assert.equal(JSON.stringify(JSON.parse(captured.at(-1)!.text)).split(content).length,2,'model generated the material once')
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      const event=await coachEventView(user,conversation)
      assert.equal(event!.actions.find(action=>action.status==='proposed')!.draft!.content,content)
      assert.equal(event!.asked.includes(content),false,'questions inside the material are not coaching questions')
    })
    await t.test('saved real bold material persists once through simulated SDK and real PostgreSQL without rewriting its draft',async()=>{
      const fixture=JSON.parse(readFileSync('tests/fixtures/coach-markdown-material-duplicate.json','utf8'))
      const input=await prepare('请起草明天下午打开微信时询问同学是否还需要资料的消息。'),before=requests.length
      const content=fixture.event.action.draft.content
      outputs.push({reply:fixture.reply,event:{target:{operation:'continue',eventId,expectedRevision:(await coachEventView(user,conversation))!.revision},action:{operation:'create',draft:{content}}}})
      const result=await engine(input)
      assert.equal(requests.length,before+1);assert.equal((result.usage as any).repairCalls,0)
      assert.equal(result.text,'好的，这是为你准备的实施意图草稿：\n\n'+content)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      const persisted=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,input.run.request_id])).rows
      assert.equal(persisted.length,1);assert.equal(persisted[0].content,result.text)
      assert.equal(persisted[0].content.split(content).length,2)
      const event=await coachEventView(user,conversation)
      assert.equal(event!.actions.find(action=>action.status==='proposed')!.draft!.content,content)
    })
    await t.test('the single model can cite one verified proposition without legacy case pairs or a second review',async()=>{
      const card:KnowledgeCard={id:randomUUID(),revision:1,kind:'method',status:'verified',synthetic:true,title:'SYNTHETIC 文件核验',url:'https://example.invalid/coach-engine-source',publisher:'SYNTHETIC',publishedYear:'2026',verifiedAt:new Date().toISOString(),validUntil:null,claim:'先核验文件能否打开',excerpt:'先核验文件能否打开，不由此推断内容效果。',scope:'合成文件可用性',limitations:'不证明内容效果',mechanisms:['synthetic'],sourceHash:'b'.repeat(64)}
      await importKnowledge([card],true);sourceIds.push(card.id)
      const input=await prepare('有什么依据支持先核验手机能否打开文件？'),before=requests.length
      outputs.push({reply:card.claim,citations:[{sourceId:card.id,revision:1,claim:card.claim,quote:card.claim,scope:card.scope}]})
      const result=await engine(input)
      assert.equal(requests.length,before+1)
      assert.ok(result.text.includes(card.url));assert.ok(result.text.includes(card.limitations))
      assert.deepEqual(input.staged.usedKnowledgeRefs,[{sourceId:card.id,revision:1}])
      const prompt=JSON.parse(requests.at(-1).messages.find((message:any)=>message.role==='user').content)
      assert.equal(prompt.knowledge[0].id,card.id)
      assert.equal(Object.hasOwn(input.staged,'campus'),false);assert.equal(Object.hasOwn(input.staged,'decision'),false)
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal(saved.upstreamCalls,1)
      await importKnowledge([{...card,revision:2,status:'revoked'}],true)
      assert.ok(!(await store.contextForRun(input.run)).some(message=>message.content.includes(card.url)))
    })
    await t.test('saved nonexistent unknown resolution gets one concrete repair and never a third call',async()=>{
      const fixture=JSON.parse(readFileSync('tests/fixtures/coach-invalid-unknown-resolution.json','utf8'))
      const text='他原来问的是高数极限的例题。他明确说想看极限例题，不是概率统计。'
      let input=await prepare(text),before=requests.length
      const invalid=async()=>({...fixture,event:{...fixture.event,target:{operation:'continue',eventId,expectedRevision:(await coachEventView(user,conversation))!.revision},nodes:fixture.event.nodes.map((node:any)=>({...node,source:{...node.source,messageId:input.run.source_message_id}}))}})
      try{
        const first=await invalid(),fixed=structuredClone(first);delete fixed.event.resolveUnknowns
        outputs.push(first,fixed)
        const result=await engine(input)
        assert.equal(requests.length-before,2);assert.equal((result.usage as any).repairReason,'COACH_UNKNOWN_NOT_FOUND')
        assert.match(requests.at(-1).messages[0].content,/active unknown node IDs/)
        assert.equal(result.text,fixture.reply)
        await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM coach_nodes WHERE id=ANY($1::uuid[])',[fixture.event.resolveUnknowns])).rows[0].n,0)
        input=await prepare(text);before=requests.length
        const eventBefore=await coachEventView(user,conversation),again=await invalid()
        outputs.push(again,again)
        await assert.rejects(engine(input),(e:any)=>e.code==='COACH_UNKNOWN_NOT_FOUND')
        assert.equal(requests.length-before,2);assert.equal((await coachEventView(user,conversation))!.revision,eventBefore!.revision)
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE run_request_id=$1 AND role='assistant'",[input.run.request_id])).rows[0].n,0)
      }finally{outputs.length=0;await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_UNKNOWN_REPAIR_CLEANUP')}
    })
    await t.test('a read-only reply cannot commit against an event corrected while the model was generating',async()=>{
      const input=await prepare('沿着之前那件事说说。')
      outputs.push({reply:'这轮不改变事件，只谈当前已经知道的情况。'})
      const result=await engine(input)
      assert.equal(input.staged.coach,undefined)
      await pool.query('UPDATE coach_events SET revision=revision+1 WHERE user_id=$1 AND id=$2',[user,eventId])
      await assert.rejects(store.finishRun(input.run,input.staged,result.text,result.usage,input.signal),(error:any)=>error.code==='COACH_SNAPSHOT_INVALIDATED')
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,input.run.request_id])).rows[0].n,0)
      await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_EVENT_VERSION_CHANGED')
    })
    await t.test('captured explicit material request cannot silently finish with only abstract advice (minimized real Flash failure)',async()=>{
      const fresh=randomUUID();await store.createConversation(user,{id:fresh,title:'SYNTHETIC minimized missing delivery'})
      const text='我给同学发了资料，他明确说手机打不开，所以没有看。现在我只想问他还需要哪一部分，请直接起草一段可以发送的消息，先不重新制作资料。'
      const run=(await store.startRun(user,fresh,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]}
      const input={run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:(_event:Record<string,unknown>)=>{}}
      const failure={reply:'好的，直接问清楚他具体需要哪部分，避免盲目重做。'}
      outputs.push(failure,failure)
      const before=requests.length
      try{
        await assert.rejects(engine(input),{code:'COACH_MATERIAL_NOT_VISIBLE'})
        assert.equal(requests.length-before,2,'one targeted repair, then reject rather than claiming delivery')
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,run.request_id])).rows[0].n,0)
      }finally{
        outputs.length=0
        await store.terminateRun(user,run.request_id,'failed','SYNTHETIC_MISSING_DELIVERY')
      }
    })
    await t.test('declining direct drafting beside an ordinary question does not force delivery',async()=>{
      const input=await prepare('不要直接起草消息。我想问一下，沟通前应该确认什么？'),before=requests.length
      outputs.push({reply:'先确认对方现在是否还有需求。'})
      try{
        const result=await engine(input)
        assert.equal(requests.length-before,1);assert.equal(input.staged.coach,undefined)
        await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      }finally{outputs.length=0;await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_DECLINED_DRAFT_CLEANUP')}
    })
    await t.test('one missing-delivery repair preserves the requested purpose and saves usable material once',async()=>{
      const input=await prepare('请直接起草一句问对方现在是否还需要资料的消息。'),before=requests.length
      const content='你现在还需要这份资料吗？如果需要，告诉我具体哪一部分。'
      outputs.push({reply:'先确认需求。'},{reply:'可以先发这段：',event:{target:{operation:'continue',eventId,expectedRevision:(await coachEventView(user,conversation))!.revision},action:{operation:'create',draft:{content}}}})
      const result=await engine(input)
      assert.equal(requests.length-before,2);assert.equal((result.usage as any).repairReason,'COACH_MATERIAL_NOT_VISIBLE')
      assert.match(requests.at(-1).messages[0].content,/cannot be completed by abstract advice/)
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal(saved.upstreamCalls,2)
      assert.equal(result.text.split(content).length,2)
      assert.equal((await coachEventView(user,conversation))!.actions.find(action=>action.status==='proposed')!.draft!.content,content)
    })
    await t.test('every actual generation and repair has exactly one ordered reservation and completion',()=>{
      assert.equal(observed.length,requests.length*2)
      const ids=new Set<string>()
      for(let i=0;i<observed.length;i+=2){
        const before=observed[i]!,after=observed[i+1]!
        assert.equal(before.phase,'before');assert.equal(after.phase,'after')
        assert.equal(before.call.callId,after.call.callId);assert.equal(ids.has(before.call.callId),false);ids.add(before.call.callId)
        assert.equal(Object.isFrozen(before.call),true);assert.equal(Object.isFrozen(after.call),true)
        assert.equal(before.call.outcome,'pending');assert.notEqual(after.call.outcome,'pending')
        assert.ok(after.call.finishedAt)
      }
      assert.ok(observed.some(entry=>entry.phase==='after'&&entry.call.purpose==='repair'))
      assert.ok(observed.some(entry=>entry.phase==='after'&&entry.call.usageCompleteness==='unavailable'))
    })
    await t.test('actual SDK requests constrain source identity for both generation and repair',()=>{
      for(const request of requests){
        if(request.model!=='qwen3.8-flash')continue
        assert.equal(request.presence_penalty,0,'actual generation and repair override the provider repetition penalty')
        const state=JSON.parse(request.messages.find((message:any)=>message.role==='user').content)
        const targets=[state.currentEvent,...state.events??[]].filter(Boolean)
        const expected=new Map(targets.map((event:any)=>[event.id,event.revision]))
        const eventProperties=request.response_format.json_schema.schema.properties.event?.properties
        if(!eventProperties)continue
        const continuations=eventProperties.target.anyOf.filter((branch:any)=>branch.properties.operation.const==='continue')
        assert.equal(continuations.length,expected.size)
        for(const branch of continuations){assert.equal(branch.properties.eventId.enum.length,1);assert.deepEqual(branch.properties.expectedRevision.enum,[expected.get(branch.properties.eventId.enum[0])])}
        let bound=0,clauseBound=0
        function check(value:any){
          if(!value||typeof value!=='object')return
          if(value.properties?.messageId){bound++;assert.deepEqual(value.properties.messageId.enum,[state.currentUserMessage.id])}
          if(value.properties?.clauseId?.enum){clauseBound++;assert.ok(value.properties.clauseId.enum.length>0,'clause bindings enumerate the catalogue')}
          for(const item of Object.values(value))check(item)
        }
        // Corrections exist only when the authorized context has correctable
        // nodes; without events the remaining message-source bindings are the
        // event create target and node sources (growth and candidate anchors
        // bind clauseId handles instead of messageId under the P1 protocol).
        const correctable=targets.some((event:any)=>event.nodes?.length)
        const required=correctable?3:2
        check(request.response_format.json_schema.schema);assert.ok(bound>=required,'messageId identity bindings: '+bound+' < '+required)
        assert.ok(clauseBound>=1,'growth source clause handles are enum-bound')
        assert.equal('corrections' in eventProperties,correctable,'corrections schema presence follows authorized correctable nodes')
        if(correctable&&eventProperties.corrections)for(const nodeId of eventProperties.corrections.items.properties.nodeId.enum)assert.ok(targets.some((event:any)=>event.nodes.some((node:any)=>node.id===nodeId)),'corrections enum only contains authorized node IDs')
      }
    })
  }finally{
    await localEmbedding.close()
    model.baseUrl=oldURL;config.apiKey=oldKey
    await new Promise<void>(resolve=>fake.close(()=>resolve()))
    await pool.query('DELETE FROM experiences WHERE user_id=$1',[user])
    await pool.query('DELETE FROM "user" WHERE id=$1',[user])
    await pool.query('DELETE FROM campus_knowledge_revisions WHERE id=ANY($1::uuid[])',[sourceIds])
    await pool.query('DELETE FROM campus_knowledge WHERE id=ANY($1::uuid[])',[sourceIds])
    await pool.end()
  }
})
