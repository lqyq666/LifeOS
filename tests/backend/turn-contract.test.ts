import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { createTurnEngine } from '../../server/agent.ts'
import { model } from '../../server/model.ts'
import { config } from '../../server/config.ts'
import { deriveTurnContract, slimActionCoachSchema } from '../../server/turn-contract.ts'
import { actionCoachTurnSchema, parseActionCoachTurn } from '../../server/action-coach-contracts.ts'
import { turnSystemPrompt } from '../../server/turn-prompt.ts'
import { configureProviderPayload } from '../../server/model-payload.ts'
import { importKnowledge, type KnowledgeCard } from '../../server/campus-knowledge.ts'
import { localEmbedding } from '../../server/local-embedding.ts'
import { Value } from 'typebox/value'
import {readFileSync} from 'node:fs'
import {boundedOrdinaryReply,boundedPlanningReply} from '../../server/bounded-reply.ts'
import {knowledgeIntent} from '../../server/evergreen-guide.ts'

test('retained actual knowledge probe candidate is unrepresentable in the ordinary runtime contract',()=>{
  const retained=JSON.parse(readFileSync('evidence/coze-core-launch-20261011/MODEL_CAPABILITY_FIRST_FAIL.json','utf8'))
  assert.equal(retained.checks.freeOutput.passed,false)
  const output=retained.checks.freeOutput.output
  assert.ok(output.experienceCandidate,'actual first failure retained')
  const contract=deriveTurnContract({text:'请简短解释递归是什么，只回答知识，不需要个人记录或计划。',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
  assert.equal(contract.mode,'reply_only')
  assert.equal(Value.Check(contract.schema as any,output),false,'public explanation must not create a personal experience')
  assert.equal(Value.Check(contract.schema as any,{reply:output.reply}),true)
})

test('material subset retains event identity and current-source rules from the event lane',()=>{
  const contract=deriveTurnContract({text:'现在我只想问他还需要哪一部分，请直接起草一段可以发送的消息。',knowledgeCount:0,currentEventExists:true,planIntent:false,material:true})
  const prompt=turnSystemPrompt('default','qwen3.8-flash',contract)
  assert.equal(contract.mode,'material')
  assert.match(prompt,/event\.target用continue/)
  assert.match(prompt,/授权eventId\/revision/)
  assert.match(prompt,/source\.messageId和quote取当轮原话/)
  assert.match(prompt,/首次报告的新事情才create/)
})

test('turn contract modes derive deterministically from turn facts',()=>{
  const derive=(text:string,extra:Partial<Parameters<typeof deriveTurnContract>[0]>={})=>deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false,...extra})
  // A. reply_only shapes
  assert.equal(derive('你记得我之前说过什么吗？').mode,'reply_only','memory meta query')
  assert.equal(derive('好的，先这样。').mode,'reply_only','acknowledgement')
  assert.equal(derive('那我保研的把握，你现在怎么看？').mode,'reply_only','all-interrogative follow-up')
  assert.equal(derive('我今天只想说说心情。').mode,'reply_only','listening-only opener')
  // Plan intent wins over an interrogative shape.
  assert.equal(derive('这周只剩两小时，帮我安排一下。',{planIntent:true}).mode,'planning')
  // B. default growth lane
  const growth=derive('我是大三学生，专业是市场营销。')
  assert.equal(growth.mode,'reply_growth');assert.equal(growth.capabilities.growth,true);assert.equal(growth.capabilities.candidate,true)
  assert.equal(growth.capabilities.plan,false);assert.equal(growth.capabilities.event,false)
  // C. planning
  const plan=derive('我每周只有三小时，帮我安排一下这周。',{planIntent:true})
  assert.equal(plan.mode,'planning');assert.equal(plan.capabilities.plan,true);assert.equal(plan.capabilities.candidate,false)
  // D. knowledge
  const knowledge=derive('我想试试校园二手书项目，帮我看看怎么开始。',{knowledgeCount:2})
  assert.equal(knowledge.mode,'knowledge');assert.equal(knowledge.capabilities.citations,true)
  assert.equal(derive('帮我看看怎么开始。',{knowledgeCount:0}).capabilities.citations,false,'no knowledge → no citations lane')
  // E. material
  const material=derive('请直接帮我写一句给同学的确认消息。',{material:true})
  assert.equal(material.mode,'material');assert.equal(material.capabilities.material,true);assert.equal(material.capabilities.event,true)
  // event/review lane
  const event=derive('上周我给社团交了海报，他们没用上。')
  assert.equal(event.capabilities.event,true);assert.equal(event.capabilities.material,false)
  const continued=derive('当时他具体希望整理什么内容？',{currentEventExists:true})
  assert.equal(continued.capabilities.event,true,'a continued event keeps the lane open')
})

test('slimmed schemas make closed lanes unrepresentable while kept lanes stay byte-identical',()=>{
  const lanes=(schema:Record<string,unknown>)=>Object.keys((schema as {properties:Record<string,unknown>}).properties).sort()
  // reply_only: only reply exists.
  const replyOnly=slimActionCoachSchema({growth:false,candidate:false,plan:false,citations:false,event:false,material:false})
  assert.deepEqual(lanes(replyOnly),['reply'])
  assert.deepEqual((replyOnly as {required:string[]}).required,['reply'])
  // reply_growth default: reply + growth + candidate + event-without-action.
  const growth=slimActionCoachSchema({growth:true,candidate:true,plan:false,citations:false,event:false,material:false})
  assert.deepEqual(lanes(growth),['experienceCandidate','growthUpdates','reply'],'no event lane without an event signal')
  const eventNoMaterial=slimActionCoachSchema({growth:true,candidate:true,plan:false,citations:false,event:true,material:false})
  assert.deepEqual(lanes(eventNoMaterial),['event','experienceCandidate','growthUpdates','reply'])
  assert.equal((eventNoMaterial.properties as Record<string,{properties:Record<string,unknown>}>).event.properties.action,undefined,'material branch removed')
  // planning adds weeklyPlan; knowledge adds citations; material restores action.
  const plan=slimActionCoachSchema({growth:true,candidate:false,plan:true,citations:false,event:false,material:false})
  assert.ok(lanes(plan).includes('weeklyPlan'))
  const knowledge=slimActionCoachSchema({growth:true,candidate:true,plan:false,citations:true,event:false,material:false})
  assert.ok(lanes(knowledge).includes('citations'))
  const material=slimActionCoachSchema({growth:true,candidate:true,plan:false,citations:false,event:true,material:true})
  assert.ok((material.properties as Record<string,{properties:Record<string,unknown>}>).event.properties.action,'material keeps the action branch')
  // background is never offered under the native protocol.
  for(const caps of [{growth:true,candidate:true,plan:true,citations:true,event:true,material:true},{growth:false,candidate:false,plan:false,citations:false,event:false,material:false}])
    assert.equal(lanes(slimActionCoachSchema(caps)).includes('background'),false)
  // Every kept lane is byte-identical to the full contract's lane.
  const full=(actionCoachTurnSchema as unknown as {properties:Record<string,unknown>}).properties
  for(const lane of lanes(material))assert.deepEqual((material.properties as Record<string,unknown>)[lane],full[lane],lane+' differs from the full contract')
  // Slimming shrinks materially vs the full schema.
  assert.ok(JSON.stringify(replyOnly).length<JSON.stringify(actionCoachTurnSchema).length/10,'reply_only schema is an order smaller')
})

test('slimmed payloads keep identity bindings and skip absent lanes',()=>{
  const current='00000000-0000-4000-8000-000000000011'
  const item={id:'00000000-0000-4000-8000-000000000021',revision:2}
  const growth=slimActionCoachSchema({growth:true,candidate:true,plan:false,citations:false,event:true,material:false})
  const payload=configureProviderPayload({},{provider:'bailian',id:'qwen3.8-flash'},'default',growth,undefined,8192,current,[],[item],0,false,undefined,false,['c0','c1']) as any
  const schema=payload.response_format.json_schema.schema
  assert.equal(schema.properties.event.properties.action,undefined)
  const updates=schema.properties.growthUpdates
  assert.ok(updates.items.anyOf.some((branch:any)=>branch.properties?.target?.anyOf?.some((entry:any)=>entry.properties?.operation?.const==='correct'&&entry.properties?.itemId?.enum?.[0]===item.id)),'correct branch still enum-bound to authorized items')
  assert.ok(updates.items.anyOf.every((branch:any)=>branch.properties?.source?.properties?.clauseId?.enum?.length===2),'clause handles stay enum-bound')
  assert.equal(schema.properties.experienceCandidate.properties.source.properties.clauseIds.items.enum.length,2)
  // Event lane absent: passing event targets must not throw and must not create an event lane.
  const noEvent=slimActionCoachSchema({growth:true,candidate:false,plan:false,citations:false,event:false,material:false})
  const payload2=configureProviderPayload({},{provider:'bailian',id:'qwen3.8-flash'},'default',noEvent,undefined,8192,current,[{id:'00000000-0000-4000-8000-000000000031',revision:1}],[],0,false,undefined,false,['c0']) as any
  assert.equal(payload2.response_format.json_schema.schema.properties.event,undefined)
  // Model outputs from a slimmed turn still parse against the full contract.
  const parsed=parseActionCoachTurn(JSON.stringify({reply:'先说说你的情况。'}))
  assert.equal(parsed.reply,'先说说你的情况。')
})

test('contract prompts are smaller per mode and the probe prompt stays byte-identical',()=>{
  const full=turnSystemPrompt('default','qwen3.8-flash')
  const contract=deriveTurnContract({text:'你记得我之前说过什么吗？',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
  const slim=turnSystemPrompt('default','qwen3.8-flash',contract)
  assert.ok(slim.length<full.length*0.6,'reply_only prompt is materially smaller')
  for(const section of ['GROWTH','时间预算分类'] as const){
    assert.equal(slim.includes('时间预算分类'),false,'growth rules absent in reply_only')
  }
  const planning=turnSystemPrompt('default','qwen3.8-flash',deriveTurnContract({text:'帮我安排一下这周。',knowledgeCount:0,currentEventExists:false,planIntent:true,material:false}))
  assert.ok(planning.includes('weeklyPlan'),'planning rules present in planning mode')
  assert.ok(!planning.includes('复盘时先定位'),'review rules absent in planning mode')
})

test('engine applies the contract end-to-end: reply_only and planning turns validate and persist',async t=>{
  await localEmbedding.start()
  const outputs:unknown[]=[],requests:any[]=[]
  const engine=createTurnEngine({capabilityVerified:()=>true})
  const fake=createServer((req,res)=>{
    const chunks:Buffer[]=[];req.on('data',chunk=>chunks.push(Buffer.from(chunk)))
    req.on('end',()=>{
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const output=outputs.shift()
      if(output===undefined){res.writeHead(500);res.end();return}
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      const base={id:'contract-'+requests.length,object:'chat.completion.chunk',created:1,model:model.id}
      res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
      res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:80,total_tokens:280,prompt_tokens_details:{cached_tokens:20}}})+'\n\ndata: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve))
  const previousURL=model.baseUrl,previousKey=config.apiKey
  model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port
  config.apiKey='synthetic-turn-contract-key'
  const user='turn-contract-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC turn contract'})
  const prepare=async(text:string,conversationId=chat)=>{
    await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_TEST_CLEANUP',finished_at=now() WHERE user_id=$1 AND status='running'",[user])
    const run=(await store.startRun(user,conversationId,randomUUID(),text)).run
    const staged:store.Staged={candidates:[],audit:[]}
    return {run,staged,input:{run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:(_event:any)=>{}}}
  }
  try{
    // reply_only: schema offers ONLY reply; the turn saves with zero growth writes.
    const meta=await prepare('你记得我之前说过什么吗？')
    outputs.push({reply:'我这边没有开启跨会话记忆，这次对话里你还没告诉我具体内容。你想先说说哪件事？'})
    const metaResult=await engine(meta.input)
    const metaContract=(meta.staged.audit.find((a:any)=>a.phase==='turn_contract')) as any
    assert.equal(metaContract.mode,'reply_only')
    assert.deepEqual(Object.keys((requests.at(-1)!.response_format.json_schema.schema.properties)),['reply'],'native schema offers only reply')
    const metaContext=JSON.parse(requests.at(-1)!.messages.find((m:any)=>m.role==='user').content)
    assert.equal(metaContext.methodSourceAvailability.status,'NOT_REQUESTED')
    assert.ok(metaContract.schemaChars<JSON.stringify(actionCoachTurnSchema).length/10)
    const metaSaved=await store.finishRun(meta.run,meta.staged,metaResult.text,metaResult.usage,new AbortController().signal)
    assert.deepEqual(metaSaved.growthIds,[])
    assert.equal((await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1',[user])).rows[0].n,0)
    await t.test('planning turn keeps weeklyPlan and persists the plan',async()=>{
      await pool.query('SELECT 1')
      const plan=await prepare('我每周有三小时，帮我安排一下下周。')
      const drafts:any[]=[];plan.input.emit=event=>drafts.push(event)
      outputs.push({reply:boundedPlanningReply({minutes:180,period:'next_week'}).choices[0],growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}],weeklyPlan:{target:{operation:'create'},availableMinutes:180,period:'next_week',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[{action:'整理作品',minutes:180,directionScopes:['employment']}]}})
      const planResult=await engine(plan.input)
      const planContract=(plan.staged.audit.find((a:any)=>a.phase==='turn_contract')) as any
      assert.equal(planContract.mode,'planning')
      const lanes=Object.keys((requests.at(-1)!.response_format.json_schema.schema.properties)).sort()
      assert.deepEqual(lanes,['growthUpdates','reply','weeklyPlan'])
      assert.ok(drafts.some(d=>d.type==='draft'&&d.draftKind==='safe_sentence'&&d.text.includes('下周')))
      assert.match(planResult.text,/下周建议安排.*180分钟/)
      assert.match(planResult.text,/整理作品（180分钟）/,'final content includes actual validated tasks, not just a budget acknowledgement')
      const saved=await store.finishRun(plan.run,plan.staged,planResult.text,planResult.usage,new AbortController().signal)
      assert.equal(saved.growthIds.length,1)
      assert.ok(saved.stateChange.plan,'plan persisted')
    })
    await t.test('explicit zero-time plan saves the verified fact and empty plan with no provider call, including repeated reports',async()=>{
      for(const text of ['这周我可用零小时，请安排这周课程与备考。','这周我没有可用时间，是零小时。请排这周的课程和备考安排。','这周没有可用时间，只保存一个空安排。','这周我可用零小时，请安排这周课程与备考。']){
      const turn=await prepare(text)
      const before=requests.length,result=await engine(turn.input)
      assert.equal(requests.length,before,'no model request is needed to invent an empty plan')
      assert.match(result.text,/本周没有可用时间，先不安排任务/)
      const saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      const fact=(await pool.query('SELECT structured_plan FROM growth_items WHERE id=$1',[saved.stateChange.plan!.itemId])).rows[0]
      assert.equal(fact.structured_plan.availableMinutes,0);assert.deepEqual(fact.structured_plan.items,[])
      assert.equal((result.usage as any).llmCallCount,0)
      }
    })
    await t.test('unverified two-hour amount stays a verbatim fact and the actual outgoing schema excludes an expiring constraint',async()=>{
      const text='我还有两小时准备明天的课堂汇报，先做哪一步？',turn=await prepare(text)
      const choice=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]!
      outputs.push({reply:choice,growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}]})
      const result=await engine(turn.input),schema=requests.at(-1)!.response_format.json_schema.schema
      assert.ok(schema.properties.reply.enum.includes(choice),'actual SDK carries the bounded reply enum')
      assert.equal(result.text,choice,'selected authorized editorial action is read back unchanged')
      assert.equal(schema.properties.growthUpdates.items.anyOf.some((branch:any)=>branch.properties?.kind?.const==='constraint'),false)
      const saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.equal(saved.growthIds.length,1)
      const fact=(await pool.query('SELECT kind,text,valid_until,time_basis FROM growth_items WHERE id=$1',[saved.growthIds[0]])).rows[0]
      assert.equal(fact.kind,'context');assert.equal(fact.text,'我还有两小时准备明天的课堂汇报')
      assert.equal(fact.valid_until,null);assert.equal(fact.time_basis,null)
      assert.deepEqual(saved.mergedExperienceIds,[],'an effort budget is not a completed experience')
      assert.equal((saved.stateChange.growth as any).status,'applied')
      assert.equal((result.usage as any).llmCallCount,1)
    })
    await t.test('missing matching methods are explicit in the actual SDK request without opening citations',async()=>{
      const newChat=randomUUID()
      await store.createConversation(user,{id:newChat,title:'SYNTHETIC separate contact matter'})
      await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1) ON CONFLICT (user_id) DO UPDATE SET enabled=true',[user])
      const text='前天联系了学长，他没回，我下一步怎么办？',turn=await prepare(text,newChat)
      const choice=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]!
      outputs.push({reply:choice})
      const result=await engine(turn.input),request=requests.at(-1)!
      const context=JSON.parse(request.messages.find((m:any)=>m.role==='user').content)
      assert.equal(context.methodSourceAvailability.status,'NO_MATCHING_PUBLIC_METHOD')
      assert.equal(context.methodSourceAvailability.suppliedMethodCount,0)
      assert.deepEqual(context.knowledge,[])
      assert.ok(context.deferredGrowthRefs.some((ref:any)=>ref.reason==='UNSCOPED_TEMPORARY_TIME_FOR_OTHER_MATTER'))
      assert.ok(!JSON.stringify(context.growthBackground).includes('我还有两小时准备明天的课堂汇报'),'actual SDK context cannot use the other task budget')
      assert.equal((await pool.query("SELECT count(*)::int n FROM growth_items WHERE user_id=$1 AND text=$2",[user,'我还有两小时准备明天的课堂汇报'])).rows[0].n,1,'original saved fact remains available in storage')
      assert.equal(request.response_format.json_schema.schema.properties.citations,undefined)
      assert.equal(context.boundedReply.sourceStatus,'NO_PUBLIC_METHOD')
      assert.ok(request.response_format.json_schema.schema.properties.reply.enum.includes(choice))
      assert.equal((result.usage as any).llmCallCount,1)
    })
    await t.test('contact goal and mailbox narration use the bounded native lane and show only an authorized provisional sentence',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC contact goal'})
      const text='准备通过学校邮箱请教学长丙，想问他的项目如何放进实习作品集。应该先怎么联系？',turn=await prepare(text,conversation),drafts:any[]=[]
      turn.input.emit=event=>drafts.push(event)
      const choice=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]!
      outputs.push({reply:choice})
      const result=await engine(turn.input),request=requests.at(-1)!,schema=request.response_format.json_schema.schema
      assert.ok(schema.properties.reply.enum.includes(choice));assert.equal(schema.properties.event?.properties.action,undefined)
      assert.equal(result.text,choice);assert.equal(drafts.filter(e=>e.type==='draft').length,1,JSON.stringify({drafts,audit:turn.staged.audit.filter((a:any)=>a.phase==='model_call_completed')}))
      const draft=drafts.find(e=>e.type==='draft');assert.ok(choice.startsWith(draft.text)||choice.endsWith(draft.text));assert.equal(draft.saved,false)
      assert.equal((await pool.query('SELECT count(*)::int n FROM coach_events WHERE user_id=$1 AND conversation_id=$2',[user,conversation])).rows[0].n,0,'provisional editorial content does not commit an event')
    })
    await t.test('out-of-catalogue model prose is rejected without retry or losing a saved fact',async()=>{
      const newChat=randomUUID();await store.createConversation(user,{id:newChat,title:'SYNTHETIC bounded rejection'})
      const before=(await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1',[user])).rows[0].n
      const turn=await prepare('我发给学长的问题还没有回复，今天还要催吗？',newChat),requestCount=requests.length
      outputs.push({reply:'明天再发，语气轻一点反而更容易得到回应。'})
      await assert.rejects(engine(turn.input),(error:any)=>error.code==='BOUNDED_REPLY_INVALID')
      assert.equal(requests.length-requestCount,1,'invalid prose is not a paid automatic repair')
      assert.equal((await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1',[user])).rows[0].n,before)
    })
  }finally{
    model.baseUrl=previousURL;config.apiKey=previousKey
    await new Promise<void>(resolve=>fake.close(()=>resolve()))
    try{await localEmbedding.close()}catch{}
    await pool.query('DELETE FROM growth_items WHERE user_id=$1',[user]).catch(()=>{})
    await pool.query('DELETE FROM runs WHERE user_id=$1',[user]).catch(()=>{})
    await pool.query('DELETE FROM messages WHERE user_id=$1',[user]).catch(()=>{})
    await pool.query('DELETE FROM conversations WHERE user_id=$1',[user]).catch(()=>{})
    await pool.query('DELETE FROM "user" WHERE id=$1',[user]).catch(()=>{})
    await pool.end()
  }
})
