import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {deriveTurnContract,bindPlanBudgetSchema,bindMaterialDeliverySchema,taskOutcomeReadback,requestsSingleQuestionMaterial} from '../../server/turn-contract.ts'
import {requiresImmediateMaterial,deliverableIntent} from '../../server/action-coach-events.ts'
import {mentionedDirectionScopes} from '../../server/growth-controls.ts'
import {buildClauseCatalogue} from '../../server/clause-catalogue.ts'
import {selectStructuralCandidate,clauseReportsCompleted} from '../../server/experience-content.ts'
import {parseActionCoachTurn} from '../../server/action-coach-contracts.ts'
import {boundedRecallReply} from '../../server/bounded-reply.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {readGuideUsage,readPriorGuideEvents} from '../../server/guide-usage.ts'
import {safeEarlySentence} from '../../server/reply-draft.ts'
import {buildTurnPrompt,providerTurnMessages,turnSystemPrompt} from '../../server/turn-prompt.ts'
import {configureProviderPayload} from '../../server/model-payload.ts'
import {normalizeWeeklyPlanTasks,validateWeeklyPlanShape,renderProposedWeeklyPlan} from '../../server/weekly-plans.ts'

test('real mixed report keeps editing commands out of the experience and reads later progress',()=>{
  const text='我通过校内邮箱发了消息，他还没回复，把消息改短，别猜他没回复的原因。'
  const result=selectStructuralCandidate(text,buildClauseCatalogue(text),'2026-10-14T03:00:00Z')
  assert.equal(result?.quote,'我通过校内邮箱发了消息，他还没回复')
  const recall=boundedRecallReply('上次请教学长那件事，你目前知道实际做过什么？',[
    {text:'想向学长请教实习方向',createdAt:'2026-10-14T01:00:00Z'},
    {text:'还没联系过',createdAt:'2026-10-14T01:00:00Z'},
    {text:'我通过校内邮箱发了消息',createdAt:'2026-10-14T02:00:00Z'},
    {text:'他还没回复',createdAt:'2026-10-14T02:00:00Z'},
  ]).choices[0]!
  assert.ok(recall.includes('我通过校内邮箱发了消息'))
  assert.ok(!recall.includes('「还没联系过」'))
  const outcome=taskOutcomeReadback('我问了一个同学，也没人采用或付款。')
  assert.equal(outcome.adoption.status,'reported_not_used')
  assert.equal(outcome.payment.status,'reported_unpaid')
  assert.equal(outcome.effect.status,'unknown')
  assert.equal(clauseReportsCompleted('我问了一个同学'),true)
  assert.equal(clauseReportsCompleted('同学问了我'),false)
  assert.equal(clauseReportsCompleted('我打算问了再决定'),false)
  const contribution='我整理了资料，代码是队友做的。帮我写一段作品描述，不要扩写成收集全部资料或交付终版。'
  const experience=selectStructuralCandidate(contribution,buildClauseCatalogue(contribution),'2026-10-14T03:00:00Z')
  assert.equal(experience?.quote,'我整理了资料，代码是队友做的')
  assert.equal(experience?.content.action,'我整理了资料')
  const instruction='我在课程小组里负责整理资料和排版，代码是队友做的。帮我写一段只包含本人贡献的作品描述，不要扩写成收集全部资料或交付终版。'
  assert.equal(selectStructuralCandidate(instruction,buildClauseCatalogue(instruction),'2026-10-14T03:00:00Z'),null)
})

test('provider material metadata cannot authorize source or readiness',()=>{
  const singleBody={reply:'你好，方便请教一下实习方向吗？',event:{target:{operation:'create',title:'请教消息',source:{messageId:randomUUID(),quote:'帮我写一句消息'}},action:{operation:'create',draft:{fromReply:true}}}}
  const decoded=parseActionCoachTurn(JSON.stringify(singleBody))
  assert.deepEqual((decoded.event!.action as any).draft,{content:singleBody.reply})
  assert.throws(()=>parseActionCoachTurn(JSON.stringify({...singleBody,reply:''})))
  assert.throws(()=>parseActionCoachTurn(JSON.stringify({...singleBody,event:{...singleBody.event,action:{operation:'create',draft:{fromReply:true,content:'另一份正文'}}}})))
  const c=deriveTurnContract({text:'帮我写一句消息',knowledgeCount:0,currentEventExists:false,planIntent:false,material:true})
  assert.ok(!JSON.stringify(c.schema).includes('materialEvidence'))
  const interview=bindMaterialDeliverySchema(c,'帮我写一句访谈问题',false)
  assert.ok(!JSON.stringify(interview.schema).includes('resume_portfolio'))
  const result=parseActionCoachTurn(JSON.stringify({reply:'这里是简短消息。',event:{target:{operation:'create',title:'请教消息',source:{messageId:randomUUID(),quote:'帮我写一句消息'}},action:{operation:'create',draft:{content:'你好，方便请教一下吗？',readiness:'ready',materialEvidence:[{type:'invented_authority'}],materialFactIds:['fake']}}}}))
  const action=result.event!.action!
  assert.ok('draft'in action)
  assert.equal('materialEvidence'in action.draft,false)
  assert.equal('readiness'in action.draft,false)
})

test('first useful content skips politeness without skipping unsafe assertions',()=>{
  assert.equal(safeEarlySentence(JSON.stringify({reply:'消息已写好，你可以直接复制使用。'})),null)
  assert.equal(safeEarlySentence(JSON.stringify({reply:'消息已写好，你可以直接复制使用。尚未联系过对方时，先询问是否方便交流。'})),'尚未联系过对方时，先询问是否方便交流')
  assert.equal(safeEarlySentence(JSON.stringify({reply:'基于期末优先，我为你规划了一个轻量级方案。'})),null)
  assert.equal(safeEarlySentence(JSON.stringify({reply:'基于期末优先，我为你规划了一个轻量级方案。先给课程作业留一块时间，其余保留余量。'})),'先给课程作业留一块时间，其余保留余量')
  assert.equal(safeEarlySentence(JSON.stringify({reply:'收到。先给课程作业留一个小时间块，剩余时间保留缓冲。'})),'先给课程作业留一个小时间块，剩余时间保留缓冲')
  assert.equal(safeEarlySentence(JSON.stringify({reply:'好的，这是一条简短、礼貌且尊重对方时间的请教消息，你可以直接复制使用：\n\n'})),null)
  assert.equal(safeEarlySentence(JSON.stringify({reply:'这是一份简短的请教消息草稿，你可以直接复制使用。尚未联系过对方时，先询问是否方便交流。'})),'尚未联系过对方时，先询问是否方便交流')
  assert.equal(safeEarlySentence(JSON.stringify({reply:'已经替你发送了消息。还想聊什么？'})),null)
})

test('real natural requests bind material delivery without taking over review',()=>{
  const pureText='我想先了解实习岗位，别把小组成果都算成我的能力。帮我写一段只包含本人贡献的作品描述。'
  const pure=bindMaterialDeliverySchema(deriveTurnContract({text:pureText,knowledgeCount:0,currentEventExists:true,planIntent:false,material:true}),pureText,true).schema as any
  assert.equal(pure.properties.event.properties.nodes,undefined,'a material intent already retained as source must not generate repeated process nodes')
  assert.equal(requestsSingleQuestionMaterial('先问一个同学就好，帮我写一句能问出最近一次选课经历的问题。'),true)
  assert.equal(requestsSingleQuestionMaterial('再帮我拟一个向学长核对岗位要求的问题。'),true)
  for(const text of ['我写了一个问题。','同学说帮我写一个问题。','“帮我写一个问题”是什么意思？'])assert.equal(requestsSingleQuestionMaterial(text),false,text)
  for(const text of ['帮我写一句简短的请教消息，不要替我发送。','帮我写一段只包含本人贡献的作品描述。','我通过校内邮箱发了消息，他还没回复，把消息改短，别猜他没回复的原因。']){
    assert.equal(deliverableIntent(text,'create'),true,text)
    assert.equal(requiresImmediateMaterial(text),true,text)
  }
  for(const text of ['填过表但卡住了，别重写。','同学说帮我写一句消息。','“帮我写一句消息”是什么意思？','帮我写一封邮件，但还不知道发给谁。'])assert.equal(requiresImmediateMaterial(text),false,text)
})

test('ordinary contract composes review, material and facts without competing modes',()=>{
  for(const text of ['填过表但卡住了，别重写','他没回复，把消息改短','我每周三小时，帮我安排并写一句消息']){
    const c=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:text.includes('安排'),material:text.includes('消息')})
    assert.equal(c.mode,'ordinary')
    assert.equal(c.capabilities.growth,true)
    assert.equal(c.capabilities.event,true)
    assert.equal(c.capabilities.material,true)
    assert.equal(c.capabilities.candidate,false,'star-map experience extraction is program-owned')
    assert.equal(c.capabilities.citations,false)
    assert.equal((c.schema.properties as any).reply.enum,undefined)
  }
  const c=deriveTurnContract({text:'我每周两小时，安排课程和备考',knowledgeCount:0,currentEventExists:false,planIntent:true,material:false})
  assert.ok(turnSystemPrompt('default','qwen3.8-flash',c,false).length<turnSystemPrompt('default','qwen3.8-flash',c).length,'ordinary replies omit irrelevant material instructions without changing capabilities')
  const s=bindPlanBudgetSchema(c,{minutes:120,period:'this_week'},'课程和备考').schema as any
  assert.equal(s.properties.weeklyPlan.properties.items.enum,undefined,'model chooses the actual tasks')
  assert.deepEqual(s.properties.weeklyPlan.properties.availableMinutes.enum,[120],'time binding remains authoritative')
  assert.equal(s.properties.reply.enum,undefined,'plan explanation stays naturally generated')
  assert.equal(s.properties.reply.maxLength,160)
  const slack=bindPlanBudgetSchema(c,{minutes:120,period:'this_week'},'安排课程作业和复习，不要全排满').schema as any
  assert.ok(slack.properties.weeklyPlan.description.includes('合计至多119分钟'))
  assert.equal(slack.properties.weeklyPlan.properties.items.items.properties.minutes.maximum,119)
  assert.equal(slack.properties.weeklyPlan.properties.items.enum,undefined)
  const course=bindPlanBudgetSchema(c,{minutes:120,period:'this_week'},'安排课程作业和复习，不要全排满',[]).schema as any
  assert.equal(course.properties.weeklyPlan.properties.items.items.properties.directionScopes.maxItems,0,'generic coursework cannot invent a degree direction')
  assert.deepEqual(course.properties.weeklyPlan.properties.items.items.properties.action.enum,['课程作业','复习'])
  assert.equal(course.properties.weeklyPlan.properties.items.maxItems,2)
  assert.deepEqual(mentionedDirectionScopes('期末课程优先，备考只保留少量时间。'),[])
  assert.deepEqual(mentionedDirectionScopes('我想先了解就业。'),['employment'])
  assert.deepEqual(mentionedDirectionScopes('同学说他想考研。我读过“专升本”的文章。'),[])
  assert.throws(()=>validateWeeklyPlanShape({target:{operation:'create'},availableMinutes:120,period:'this_week',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[{action:'create',minutes:60,directionScopes:[]}]}),{code:'WEEKLY_PLAN_INVALID'})
})

test('single ordinary generation preserves mixed delivery and real transaction boundaries (simulated provider)',async t=>{
  await localEmbedding.start()
  const previous={url:model.baseUrl,key:config.apiKey},requests:any[]=[],outputs:unknown[]=[]
  const fake=createServer((req,res)=>{
    const chunks:Buffer[]=[]
    req.on('data',chunk=>chunks.push(Buffer.from(chunk)))
    req.on('end',()=>{
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const queued=outputs.shift()
      const output=typeof queued==='function'?queued(requests.at(-1)):queued
      if(output===undefined){res.writeHead(500);res.end();return}
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      const base={id:'ordinary-synthetic-'+requests.length,object:'chat.completion.chunk',created:1,model:model.id}
      res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
      res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve))
  model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port
  config.apiKey='synthetic-ordinary-key'
  // Even an old diagnostic caller cannot turn failure into a second paid call.
  const engine=createTurnEngine({capabilityVerified:()=>true,providerCallObserver:{allowRepair:true,before(){},after(){}}})
  const user='ordinary-'+randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  const conversation=randomUUID()
  await store.createConversation(user,{id:conversation,title:'SYNTHETIC ordinary composition'})
  async function prepare(text:string,conversationId=conversation){
    const run=(await store.startRun(user,conversationId,randomUUID(),text)).run
    const staged:store.Staged={candidates:[],audit:[]}
    return {run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:(_event:Record<string,unknown>)=>{}}
  }
  let event:any
  try{
    await t.test('feedback and shorter material share one call and persist together',async()=>{
      const input=await prepare('我给学长发了请教消息，他还没回复，把消息改短。')
      const material='学长，方便说说你最初怎么选实习方向的吗？'
      outputs.push({reply:'没有回复还不能判断原因。可以先把问题缩到一个具体点：',event:{target:{operation:'create',title:'向学长请教实习方向',source:{messageId:input.run.source_message_id,quote:'我给学长发了请教消息'}},nodes:[{kind:'fact',source:{messageId:input.run.source_message_id,quote:'他还没回复'}}],action:{operation:'create',draft:{content:material}}},growthUpdates:[{target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'completed',source:{clauseId:'c0'}},{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c1'}}],experienceCandidate:{source:{clauseIds:['c0','c1','c2']},action:{clauseId:'c0'},result:{clauseId:'c1'}}})
      const before=requests.length,result=await engine(input)
      assert.equal(requests.length-before,1)
      assert.match(result.text,/不能判断原因/)
      assert.ok(result.text.includes(material))
      assert.equal((requests.at(-1).response_format.json_schema.schema.properties.reply as any).enum,undefined)
      assert.ok(requests.at(-1).response_format.json_schema.schema.properties.event.properties.target.anyOf[0].properties.source.properties.quote.enum.includes('我给学长发了请教消息'))
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      event=saved.event
      assert.equal(event.actions[0].draft.content,material)
      const rows=(await pool.query('SELECT text FROM growth_items WHERE user_id=$1',[user])).rows
      assert.ok(rows.some(row=>row.text==='我给学长发了请教消息'))
      assert.ok(rows.some(row=>row.text==='他还没回复'))
      const experiences=(await pool.query('SELECT source_quote FROM experiences WHERE user_id=$1 AND source_message_id=$2',[user,input.run.source_message_id])).rows
      assert.equal(experiences[0]?.source_quote,'我给学长发了请教消息，他还没回复')
    })
    await t.test('a later feedback question does not authorize modifying a previously requested material',async()=>{
      const input=await prepare('我又问了一个同学，他也没有给出原因。下一步怎么判断？')
      const reply='目前原因仍未知；先核对收到的具体反馈，不把猜测当结果。'
      outputs.push({reply,event:{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId:event.actions[0].id,expectedRevision:event.actions[0].revision,draft:{content:'未经当前请求擅自修改的消息'}}}})
      const result=await engine(input)
      assert.equal(result.text,reply)
      assert.ok(input.staged.audit.some((row:any)=>row.phase==='unsolicited_material_dropped'))
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('new conversation receives real feedback and Memory OFF removes it',async()=>{
      const next=randomUUID()
      await store.createConversation(user,{id:next,title:'SYNTHETIC follow-up'})
      const input=await prepare('上次给学长的消息还记得吗？',next)
      outputs.push({reply:'你报告过发了请教消息，还没有收到回复；原因仍未知。'})
      const result=await engine(input)
      const state=JSON.parse(requests.at(-1).messages[1].content)
      assert.ok((JSON.stringify(state.growth)+JSON.stringify(state.growthBackground)+JSON.stringify(state.events)).includes('他还没回复'),JSON.stringify(state))
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      await setMemorySettings(user,{requestId:randomUUID(),enabled:false,expectedRevision:Number((await pool.query('SELECT revision FROM user_memory_settings WHERE user_id=$1',[user])).rows[0]?.revision??0)})
      const off=randomUUID()
      await store.createConversation(user,{id:off,title:'SYNTHETIC memory off'})
      const offInput=await prepare('现在先聊一个新问题。',off)
      outputs.push({reply:'好，想聊什么？'})
      const offResult=await engine(offInput)
      const offState=JSON.parse(requests.at(-1).messages[1].content)
      assert.ok(!JSON.stringify(offState).includes('他还没回复'))
      await store.finishRun(offInput.run,offInput.staged,offResult.text,offResult.usage,offInput.signal)
      await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:2})
    })
    await t.test('review does not rewrite declined material or force a fixed response',async()=>{
      const input=await prepare('填过表但卡住了，别重写，我不知道选哪个岗位。')
      const reply='卡住的是岗位选择，先保留你已经填的表。里面哪两个岗位让你拿不准？'
      outputs.push({reply,event:{target:{operation:'create',title:'岗位比较受阻',source:{messageId:input.run.source_message_id,quote:'填过表但卡住了'}},nodes:[{kind:'fact',source:{messageId:input.run.source_message_id,quote:'填过表但卡住了'}}],action:{operation:'create',draft:{content:'不被用户要求的第二份表格'}}}})
      const before=requests.length,result=await engine(input)
      assert.equal(requests.length-before,1)
      assert.equal(result.text,reply)
      assert.equal(input.staged.coach?.actionId,undefined)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('a contribution paragraph can select multiple verified facts without becoming a one-sentence mode',async()=>{
      const input=await prepare('换一件事。我在课程小组里负责整理资料，我负责排版。帮我写一段只包含本人贡献的作品描述。')
      outputs.push((request:any)=>{
        const state=JSON.parse(request.messages[1].content)
        const selected=state.growthCatalogue.filter((fact:any)=>fact.text==='我在课程小组里负责整理资料'||fact.text==='我负责排版')
        assert.equal(selected.length,2)
        return {reply:'只保留你明确负责的两部分，其他成果不补写。\n\n我负责交付终版。',event:{target:{operation:'create',title:'课程小组本人贡献',source:{messageId:input.run.source_message_id,quote:'我在课程小组里负责整理资料，我负责排版'}},action:{operation:'create',draft:{kind:'resume_portfolio',selectedFactIds:[selected[0].catalogueId,...selected.map((fact:any)=>fact.catalogueId)]}}}}
      })
      const result=await engine(input)
      assert.ok(result.text.includes('我在课程小组里负责整理资料'))
      assert.ok(result.text.includes('我负责排版'))
      assert.ok(!result.text.includes('交付终版'))
      assert.equal(requests.at(-1).response_format.json_schema.schema.properties.reply.enum,undefined)
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.ok(String(saved.event!.actions[0]!.draft!.content).includes('我负责排版'))
    })
    await t.test('a recall question does not close an independent new goal in the same message',async()=>{
      const input=await prepare('你记得我之前说过什么吗？我现在决定先就业。')
      outputs.push({reply:'你报告过联系和课程分工；接下来先按就业这个新重点来。',growthUpdates:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c1'}}]})
      const result=await engine(input)
      assert.ok(requests.at(-1).response_format.json_schema.schema.properties.growthUpdates)
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.ok(saved.growthIds.length)
      const rows=(await pool.query('SELECT text FROM growth_items WHERE user_id=$1 AND id=ANY($2::uuid[])',[user,saved.growthIds])).rows
      assert.ok(rows.some(row=>row.text==='我现在决定先就业'))
    })
    await t.test('requested slack and native plan remain authoritative in one generation',async()=>{
      const plan=(minutes:number)=>({reply:'先处理课程作业，具体题量尚未知；保留余量再调整。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'constraint',source:{clauseId:'c0'},timeEvidence:{kind:'calendar_week',which:'this',clauseId:'c0'}}],weeklyPlan:{target:{operation:'create'},availableMinutes:120,period:'this_week',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[{action:'核对课程作业并尝试一道题',minutes,directionScopes:[]}]}})
      const valid=await prepare('这周还剩两小时，帮我安排课程作业，不要全排满。')
      const withRest=plan(90)
      withRest.weeklyPlan.items.push({action:'buffer_rest',minutes:30,directionScopes:[]})
      outputs.push(withRest)
      const result=await engine(valid)
      assert.ok(result.text.includes('未安排：30分钟。'))
      assert.equal(valid.staged.weeklyPlan?.input.items.length,1)
      assert.equal(valid.staged.weeklyPlan?.input.items[0]?.minutes,90)
      await store.finishRun(valid.run,valid.staged,result.text,result.usage,valid.signal)
      const invalid=await prepare('这周还剩两小时，帮我安排课程作业，不要全排满。')
      outputs.push(plan(120))
      const before=requests.length
      await assert.rejects(engine(invalid),error=>Boolean((error as any).code==='WEEKLY_PLAN_SLACK_REQUIRED'))
      assert.equal(requests.length-before,1)
      await store.terminateRun(user,invalid.run.request_id,'failed','WEEKLY_PLAN_SLACK_REQUIRED')
    })
    await t.test('the preserved course plan cannot invent a degree direction',async()=>{
      const input=await prepare('我是成年大学生，目前期末课程优先，备考只保留少量时间。这周还剩两小时，帮我安排课程作业和复习，不要全排满。')
      outputs.push({reply:'两小时排课程作业加少量复习，留缓冲不排满。具体题目和章节仍未知。',weeklyPlan:{target:{operation:'create'},availableMinutes:120,period:'this_week',budgetRef:{updateIndex:0},basis:[{updateIndex:1},{updateIndex:2},{updateIndex:3}],items:[{action:'课程作业',minutes:60,directionScopes:['undergraduate_upgrade']},{action:'期末复习',minutes:30,directionScopes:['undergraduate_upgrade']},{action:'缓冲/休息',minutes:30,directionScopes:['undergraduate_upgrade']}]}})
      await assert.rejects(engine(input),{code:'WEEKLY_PLAN_SCOPE_UNGROUNDED'})
      await store.terminateRun(user,input.run.request_id,'failed','WEEKLY_PLAN_SCOPE_UNGROUNDED')
    })
    await t.test('a named reviewed method keeps its owned task and failure continuation even when the model only returns prose',async()=>{
      const read=(name:string)=>readFileSync('.planning/research/evergreen/'+name,'utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line))
      const cards=read('KB_GUIDES.jsonl').filter(card=>card.guide?.reviewStatus==='approved')
      await importEvergreenCorpus(cards,read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
      const card=cards.find(card=>card.title==='从示例走向独立完成')!
      const actor='ordinary-method-'+randomUUID(),chat=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
      await store.createConversation(actor,{id:chat,title:'SYNTHETIC reviewed method'})
      async function methodInput(text:string,target=chat){
        const run=(await store.startRun(actor,target,randomUUID(),text)).run
        return {run,staged:{candidates:[],audit:[]} as store.Staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:(_event:Record<string,unknown>)=>{}}
      }
      const first=await methodInput('请用已审核的“从示例走向独立完成”方法。我的课程第三题不会做。')
      outputs.push({reply:'先确定题目对应的知识点，再对照一个已解示例；没有题干时不猜题型。',citations:[{claimId:card.id}]})
      const firstReply=await engine(first),saved=await store.finishRun(first.run,first.staged,firstReply.text,firstReply.usage,first.signal)
      assert.equal(saved.event?.title,'我的课程第三题不会做')
      assert.equal((await readGuideUsage(actor,chat,saved.event!.id))[0]?.guide_id,card.id)
      // The next conversation can begin before the asynchronous index job.
      // Persisted guide identity must remain available in that interval.
      const followup=randomUUID()
      await store.createConversation(actor,{id:followup,title:'SYNTHETIC cross-session method'})
      const next=await methodInput('接着上次第三题的那个方法，我找不到适用的已解示例，课件链接也打不开。先不重做计划，怎样继续？',followup)
      outputs.push({reply:'先保留示例缺失这个阻碍，核对题干或关键词后再找相同知识点的例子，不换到另一套方法。',citations:[{claimId:card.id}]})
      const nextReply=await engine(next)
      const context=JSON.parse(requests.at(-1).messages[1].content)
      assert.deepEqual(context.methodContext.map((row:any)=>row.id),[card.id])
      assert.equal(next.staged.guideUsage?.[0]?.guideId,card.id)
      assert.equal(next.staged.guideUsage?.[0]?.status,'blocked')
      await store.finishRun(next.run,next.staged,nextReply.text,nextReply.usage,next.signal)
      await setMemorySettings(actor,{requestId:randomUUID(),enabled:false,expectedRevision:1})
      assert.deepEqual(await readPriorGuideEvents(actor,followup),[],'index-independent lookup must respect Memory OFF')
    })
    await t.test('listening is naturally generated with no unsolicited material',async()=>{
      const input=await prepare('今天只想聊聊，不要给我安排任务。')
      const reply='可以，今天就聊聊。你想从哪件事说起都行。'
      outputs.push({reply})
      const before=requests.length,result=await engine(input)
      assert.equal(requests.length-before,1)
      assert.equal(result.text,reply)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('invalid source fails once even when legacy repair is requested',async()=>{
      const input=await prepare('我想聊聊另一个项目。')
      outputs.push({reply:'先看新项目。',event:{target:{operation:'create',title:'新项目',source:{messageId:input.run.source_message_id,quote:'用户根本没有说的内容'}},nodes:[{kind:'fact',source:{messageId:input.run.source_message_id,quote:'编造'}}]}})
      const before=requests.length
      await assert.rejects(engine(input))
      assert.equal(requests.length-before,1)
      assert.equal(input.staged.upstreamCalls,1)
      assert.ok(input.staged.audit.some((row:any)=>row.phase==='coach_repair_blocked'))
      await store.terminateRun(user,input.run.request_id,'failed','COACH_SOURCE_INVALID')
    })
  }finally{
    model.baseUrl=previous.url;config.apiKey=previous.key
    fake.closeAllConnections();await new Promise<void>(resolve=>fake.close(()=>resolve()))
    // The isolated runner drops this entire synthetic database after the test.
    await localEmbedding.close()
    await pool.end()
  }
})


test('wire context transmits each method and identical current event once without losing authorization',()=>{
  const id=randomUUID(),eventId=randomUUID(),otherId=randomUUID()
  const current={id,role:'user',content:'接着上次的方法，第三题仍不会做',created_at:'2026-10-14T03:00:00Z'} as any
  const event={id:eventId,revision:3,nodes:[{id:randomUUID(),kind:'unknown',status:'active',text:'第三题条件尚未核对'}],actions:[],processTurns:[]} as any
  const other={...event,id:otherId}
  const method={id:randomUUID(),version:2,branch:'C04-3',step:'C04-3-1',body:'先核对已解示例及其适用条件。',sourceStatus:'approved'}
  const context=JSON.parse(buildTurnPrompt({currentMessageId:id,messages:[current],currentEvent:event,events:[event,other],methodContext:[method],knowledge:[method] as any,growthBoundaries:[],blockedDirectionScopes:['postgraduate'],allowedDirectionScopes:['employment']}))
  assert.equal(context.knowledge,undefined)
  assert.deepEqual(context.methodContext,[method])
  assert.equal(context.currentEvent.id,eventId)
  assert.deepEqual(context.events.map((row:any)=>row.id),[otherId])
  assert.deepEqual(context.blockedDirectionScopes,['postgraduate'])
  assert.deepEqual(context.currentEvent.nodes,event.nodes)
  const wire=providerTurnMessages(JSON.stringify(context),{provider:'bailian',id:'qwen3.8-flash'})
  assert.equal(JSON.stringify(wire).split(method.body).length-1,1)
  assert.equal(wire.at(-1)!.content,current.content)
  const legacy=JSON.parse(buildTurnPrompt({currentMessageId:id,messages:[current],knowledge:[method] as any}))
  assert.deepEqual(legacy.knowledge,[method])
  const conflicting={...event,nodes:[{...event.nodes[0],status:'declined'}]}
  const distinct=JSON.parse(buildTurnPrompt({currentMessageId:id,messages:[current],currentEvent:event,events:[conflicting]}))
  assert.equal(distinct.events.length,1,'do not discard a nonidentical authorization snapshot')
})


test('compact provider growth targets keep the exact authorized ID and revision pairs',()=>{
  const refs=[{id:randomUUID(),revision:1},{id:randomUUID(),revision:2},{id:randomUUID(),revision:1}]
  const contract=deriveTurnContract({text:'更正之前的情况',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
  const payload=configureProviderPayload({}, {provider:'bailian',id:'qwen3.8-flash'},'default',contract.schema,'ordinary',8192,randomUUID(),[],refs,0,false,undefined,false,['c1']) as any
  const branches=payload.response_format.json_schema.schema.properties.growthUpdates.items.anyOf
  for(const branch of branches){
    const targets=branch.properties.target.anyOf
    assert.equal(targets.length,2)
    assert.deepEqual(targets[1].properties.itemId.enum,refs.map(ref=>ref.id))
    if(branch.properties.assertion.const==='ai_observation'){
      const bound=branch.properties.dependencies.items.anyOf.filter((row:any)=>row.properties?.id)
      assert.equal(bound.length,2)
      const accepted=bound.flatMap((row:any)=>row.properties.id.enum.map((id:string)=>({id,revision:row.properties.revision.enum[0]})))
      assert.deepEqual(accepted.sort((a:any,b:any)=>a.id.localeCompare(b.id)),[...refs].sort((a,b)=>a.id.localeCompare(b.id)))
    }
  }
  const empty=configureProviderPayload({}, {provider:'bailian',id:'qwen3.8-flash'},'default',contract.schema,'ordinary',8192,randomUUID(),[],[],0,false,undefined,false,['c1']) as any
  assert.ok(empty.response_format.json_schema.schema.properties.growthUpdates.items.anyOf.every((row:any)=>row.properties.target.anyOf.length===1))
})


test('real reported native plan keeps its actual tasks and leaves explicit buffer unallocated',()=>{
 const input={target:{operation:'create' as const},availableMinutes:120,period:'this_week' as const,budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[{action:'list_urgent_tasks',minutes:10,directionScopes:[]},{action:'complete_priority_homework',minutes:50,directionScopes:[]},{action:'review_weak_subjects',minutes:40,directionScopes:[]},{action:'buffer_rest',minutes:20,directionScopes:[]}]}
 const plan=normalizeWeeklyPlanTasks(input)
 assert.deepEqual(plan.items.map(item=>item.minutes),[10,50,40])
 assert.deepEqual(plan.items.map(item=>item.action),['列出紧急任务','完成优先课程作业','复习薄弱科目'])
 assert.equal(input.items.length,4,'do not mutate the preserved raw output')
 assert.deepEqual(normalizeWeeklyPlanTasks({...input,items:[{action:'list_tasks',minutes:10,directionScopes:[]},{action:'prioritize_and_schedule',minutes:20,directionScopes:[]}]}).items.map(item=>item.action),['列出任务','按优先级安排任务'])
 for(const label of ['缓冲/休息','休息/缓冲','休息与缓冲','rest_or_buffer','buffer_rest'])assert.equal(normalizeWeeklyPlanTasks({...input,items:[{action:label,minutes:30,directionScopes:[]},input.items[0]!]}).items.length,1,label)
 assert.deepEqual(normalizeWeeklyPlanTasks({...input,items:[{action:'course_homework',minutes:50,directionScopes:[]},{action:'review',minutes:40,directionScopes:[]}]}).items.map(item=>item.action),['课程作业','复习'])
 validateWeeklyPlanShape(plan)
 assert.ok(renderProposedWeeklyPlan(plan).includes('未安排：20分钟'))
 const mixed=normalizeWeeklyPlanTasks({...input,items:[{action:'复习后休息',minutes:120,directionScopes:[]}]})
 assert.equal(mixed.items.length,1,'a real mixed task cannot be silently discarded')
 const over=normalizeWeeklyPlanTasks({...input,items:[{action:'完成作业',minutes:121,directionScopes:[]}]})
 assert.throws(()=>validateWeeklyPlanShape(over),'actual overbudget tasks remain invalid')
})
