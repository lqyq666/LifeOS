import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {deriveTurnContract,bindPlanBudgetSchema,taskOutcomeReadback} from '../../server/turn-contract.ts'
import {requiresImmediateMaterial,deliverableIntent} from '../../server/action-coach-events.ts'
import {buildClauseCatalogue} from '../../server/clause-catalogue.ts'
import {selectStructuralCandidate} from '../../server/experience-content.ts'
import {boundedRecallReply} from '../../server/bounded-reply.ts'

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
})

test('real natural requests bind material delivery without taking over review',()=>{
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
    assert.equal(c.capabilities.candidate,true)
    assert.equal(c.capabilities.citations,false)
    assert.equal((c.schema.properties as any).reply.enum,undefined)
  }
  const c=deriveTurnContract({text:'我每周两小时，安排课程和备考',knowledgeCount:0,currentEventExists:false,planIntent:true,material:false})
  const s=bindPlanBudgetSchema(c,{minutes:120,period:'this_week'},'课程和备考').schema as any
  assert.equal(s.properties.weeklyPlan.properties.items.enum,undefined,'model chooses the actual tasks')
  assert.deepEqual(s.properties.weeklyPlan.properties.availableMinutes.enum,[120],'time binding remains authoritative')
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
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      event=saved.event
      assert.equal(event.actions[0].draft.content,material)
      const rows=(await pool.query('SELECT text FROM growth_items WHERE user_id=$1',[user])).rows
      assert.ok(rows.some(row=>row.text==='我给学长发了请教消息'))
      assert.ok(rows.some(row=>row.text==='他还没回复'))
      const experiences=(await pool.query('SELECT source_quote FROM experiences WHERE user_id=$1 AND source_message_id=$2',[user,input.run.source_message_id])).rows
      assert.equal(experiences[0]?.source_quote,'我给学长发了请教消息，他还没回复')
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
      outputs.push({reply})
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
        return {reply:'只保留你明确负责的两部分，其他成果不补写。',event:{target:{operation:'create',title:'课程小组本人贡献',source:{messageId:input.run.source_message_id,quote:'我在课程小组里负责整理资料，我负责排版'}},action:{operation:'create',draft:{kind:'resume_portfolio',selectedFactIds:selected.map((fact:any)=>fact.catalogueId)}}}}
      })
      const result=await engine(input)
      assert.ok(result.text.includes('我在课程小组里负责整理资料'))
      assert.ok(result.text.includes('我负责排版'))
      assert.ok(!result.text.includes('交付终版'))
      assert.equal(requests.at(-1).response_format.json_schema.schema.properties.reply.enum,undefined)
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.ok(String(saved.event!.actions[0]!.draft!.content).includes('我负责排版'))
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
