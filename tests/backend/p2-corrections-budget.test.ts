import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createTurnEngine } from '../../server/agent.ts'
import { model } from '../../server/model.ts'
import { config } from '../../server/config.ts'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { createGrowthItem, growthContext } from '../../server/growth.ts'
import { localEmbedding } from '../../server/local-embedding.ts'

// P2-1/P2-2 integration: corrections must actually persist through the real
// engine path (isolated PG + simulated provider), and budget/plan supplements
// must bind the facts that really committed. No provider network access.

test('P2: explicit corrections persist and plans bind supplement facts (isolated PG, simulated provider)',async t=>{
  await localEmbedding.start()
  const user='p2-corr-'+randomUUID()
  const outputs:unknown[]=[],requests:any[]=[]
  // These specific guard cases exercise an explicitly permitted simulated
  // repair. Production and real acceptance do not opt into paid retries.
  const engine=createTurnEngine({capabilityVerified:()=>true,providerCallObserver:{allowRepair:true,before:()=>{},after:()=>{}}})
  const fake=createServer((req,res)=>{
    const chunks:Buffer[]=[];req.on('data',chunk=>chunks.push(Buffer.from(chunk)))
    req.on('end',()=>{
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const output=outputs.shift()
      if(output===undefined){res.writeHead(500);res.end();return}
      if(output&&typeof output==='object'&&'reply'in output&&output.reply==='__BOUND_REPLY__'){
        const context=JSON.parse(requests.at(-1).messages[1].content)
        output.reply=context.boundedReply?.choices[0]??'可以先核对可用时间和当前任务。'
      }
      const content=typeof output==='string'?output:JSON.stringify(output)
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      const base={id:'p2-synth-'+requests.length,object:'chat.completion.chunk',created:1,model:model.id}
      res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})+'\n\n')
      res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300,prompt_tokens_details:{cached_tokens:20}}})+'\n\ndata: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve))
  const previousURL=model.baseUrl,previousKey=config.apiKey,previousReasoning={...config.modelTiers.reasoning}
  model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port
  config.apiKey='synthetic-p2-local-provider-key'
  config.modelTiers.reasoning.baseUrl=model.baseUrl!;config.modelTiers.reasoning.apiKey=config.apiKey
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  const conversation=randomUUID()
  await store.createConversation(user,{id:conversation,title:'SYNTHETIC P2 corrections'})
  const prepare=async(text:string)=>{
    const run=(await store.startRun(user,conversation,randomUUID(),text)).run
    const staged:store.Staged={candidates:[],audit:[]}
    return {run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:()=>{}}
  }
  try{
    await t.test('A01: a correct intent on the scored item amends it and keeps siblings',async()=>{
      const original=await createGrowthItem(user,{requestId:randomUUID(),conversationId:conversation,kind:'context',text:'我大三，最近在就业和考研之间犹豫。'})
      const input=await prepare('更正一下：我是大二，刚才说成大三了。')
      // The model only names the item; the server derives the operation, the
      // revision and the marker-stripped verbatim new value.
      outputs.push({reply:'收到，把“大三”更正为“大二”，其他不变。',growthUpdates:[{target:{operation:'correct',itemId:original.id},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}]})
      const result=await engine(input)
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.ok(saved.stateChange.growth.changedIds.length>=1,'the correction actually changed an item')
      const items=await growthContext(user,conversation)
      const amended=items.find(item=>item.id===saved.stateChange.growth.changedIds[0])
      assert.ok(amended&&amended.text.includes('我是大二'),'new value verbatim in the amended item')
      // split_amend keeps the untouched clause as an independent retained item.
      assert.ok(items.some(item=>item.text.includes('最近在就业和考研之间犹豫')),'sibling clause preserved as its own item')
      assert.ok(!items.some(item=>item.id===original.id&&item.revision===original.revision&&item.text.includes('大三')&&!item.text.includes('大二')),'old wrong value not still active verbatim')
    })
    await t.test('A02: composite contribution correction swaps only the scored clause',async()=>{
      const team=await createGrowthItem(user,{requestId:randomUUID(),conversationId:conversation,kind:'ability',text:'我们团队上学期拿了校园文创设计二等奖，我做的是整体策划。'})
      const input=await prepare('更正一下：整体策划主要是队长做的，我只负责了宣传物料里的排版部分。')
      outputs.push({reply:'明白，策划是队长的，你负责排版部分。',growthUpdates:[{target:{operation:'correct',itemId:team.id},kind:'ability',assertion:'user_reported',source:{clauseId:'c1'}}]})
      const result=await engine(input)
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      const items=await growthContext(user,conversation)
      const texts=items.map(item=>item.text).join('\n')
      assert.ok(texts.includes('我们团队上学期拿了校园文创设计二等奖'),'team award preserved')
      assert.ok(texts.includes('我只负责了宣传物料里的排版部分'),'personal role corrected')
      assert.ok(!texts.includes('我做的是整体策划'),'old personal-role claim no longer active')
    })
    await t.test('A02b: the server derives the amended clause — the model cannot name one',async()=>{
      const team2=await createGrowthItem(user,{requestId:randomUUID(),conversationId:conversation,kind:'ability',text:'我们小组拿了校赛一等奖，我负责整体统筹。'})
      const input=await prepare('更正一下：整体统筹主要是组长做的，我只负责了演示部分。')
      outputs.push({reply:'明白，统筹是组长的，你负责演示。',growthUpdates:[{target:{operation:'correct',itemId:team2.id},kind:'ability',assertion:'user_reported',source:{clauseId:'c1'}}]})
      const result=await engine(input)
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.ok(saved.stateChange.growth.changedIds.length>=1)
      const items=await growthContext(user,conversation)
      const texts=items.map(item=>item.text).join('|')
      assert.ok(texts.includes('我们小组拿了校赛一等奖'),'team fact preserved')
      assert.ok(texts.includes('我只负责了演示部分'),'role corrected')
      assert.ok(!texts.includes('我负责整体统筹'),'old role no longer active')
    })
    await t.test('claim guard: a correction turn with only a verbatim create may not claim the record was corrected',async()=>{
      await createGrowthItem(user,{requestId:randomUUID(),conversationId:conversation,kind:'context',text:'我每周三小时练琴。'})
      const input=await prepare('更正一下：我现在更喜欢做产品运营了。')
      // No deterministic target (unrelated old item), model output claims success.
      const beforeReq=requests.length
      outputs.push({reply:'已经把你的方向更正为产品运营了。'},{reply:'已记录你现在更喜欢做产品运营；原来的兴趣记录还没改，需要你再说一次原话我才能更新。'})
      const result=await engine(input)
      assert.ok(requests.length-beforeReq>=2,'one bounded repair fired')
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      const items=await growthContext(user,conversation)
      assert.ok(items.some(item=>item.text.includes('更喜欢做产品运营')),'verbatim new value recorded')
      assert.ok(items.some(item=>item.text.includes('我每周三小时练琴')),'unrelated old fact untouched')
    })
    await t.test('P3 cross-turn: a failed correction stays outstanding and a later 已更正 claim is refused',async()=>{
      const dorm=await createGrowthItem(user,{requestId:randomUUID(),conversationId:conversation,kind:'context',text:'我住在东区宿舍。'})
      // Turn 1: the correction turn FAILS entirely — the model outputs a
      // schema array twice (COACH_OUTPUT_INVALID is not fixed by one repair),
      // so nothing persists and the old fact stays active.
      const t1=await prepare('更正一下：我住在西区宿舍。')
      // No outputs queued: the simulated provider 500s and MODEL_REQUEST_FAILED
      // is not repairable — the correction turn fails whole, nothing persists.
      await assert.rejects(engine(t1),(e:any)=>e.code==='MODEL_REQUEST_FAILED')
      await store.terminateRun(user,t1.run.request_id,'failed','SYNTHETIC_P3')
      // Turn 2 (no new correction): the model claims the record was already
      // corrected while the old fact is still active — refused once, then the
      // repair states honestly that the correction is NOT yet applied.
      const t2=await prepare('那你现在怎么理解我的年级？')
      const beforeReq=requests.length
      outputs.push({reply:'你的宿舍已经更正为西区了。'})
      await assert.rejects(engine(t2),(e:any)=>e.code==='BOUNDED_REPLY_INVALID','the current selector cannot express a fabricated successful correction')
      assert.equal(requests.length-beforeReq,1,'an invalid bounded choice is refused without repair')
      await store.terminateRun(user,t2.run.request_id,'failed','SYNTHETIC_UNCOMMITTED_CORRECTION_CLAIM')
      const t3=await prepare('那你现在怎么理解我的年级？');outputs.push({reply:'__BOUND_REPLY__'})
      const result=await engine(t3)
      assert.ok(!/(?:已更正|更正为|已经把.{0,10}更正)/.test(result.text),'a legal answer never claims the failed correction was committed')
      const items=await growthContext(user,conversation)
      assert.ok(items.some(item=>item.text.includes('我住在东区宿舍')),'old fact still active (honest state)')

      await store.finishRun(t3.run,t3.staged,result.text,result.usage,t3.signal)
    })
    await t.test('B05: a next-week plan binds the supplement fact when the model budget delta was invalid',async()=>{
      const input=await prepare('我每周有六小时。这周还剩两小时，帮我安排下周。')
      // The model misses the budget fact entirely (a junk quote is
      // unrepresentable under the clause protocol) but plans correctly for
      // next week with 360 minutes; the supplement anchors the budget.
      outputs.push({reply:'__BOUND_REPLY__',weeklyPlan:{target:{operation:'create'},availableMinutes:360,period:'next_week',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[{action:'整理作品集',minutes:180,directionScopes:['employment']},{action:'投两个岗位',minutes:180,directionScopes:['employment']}]}})
      const result=await engine(input)
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.ok(saved.stateChange.plan,'plan persisted')
      const plan=await growthContext(user,conversation).then(items=>items.find(item=>item.id===saved.stateChange.plan!.itemId))
      assert.ok(plan,'plan item exists')
      const structured=(await pool.query('SELECT structured_plan FROM growth_items WHERE user_id=$1 AND id=$2',[user,saved.stateChange.plan!.itemId])).rows[0].structured_plan
      assert.equal(structured.availableMinutes,360)
      const budgetFact=await growthContext(user,conversation).then(items=>items.find(item=>item.id===structured.budgetRef.id))
      assert.ok(budgetFact&&budgetFact.assertion==='user_reported'&&['context','constraint'].includes(budgetFact.kind),'plan budget resolves to the persisted supplement fact')
      assert.ok(String(budgetFact!.text).includes('我每周有六小时'),'and that fact is the user\'s own verbatim weekly amount')
    })
    await t.test('P3 F06: persist layer rejects a plan whose budget fact minutes/window mismatch',async()=>{
      // A this-week remainder (120 min) can never anchor a "weekly" plan of
      // 180 minutes, and the rendered label names the budget's own window.
      const t9=await prepare('这周只剩两小时，帮我安排一下。')
      outputs.push({reply:'__BOUND_REPLY__',weeklyPlan:{target:{operation:'create'},availableMinutes:120,period:'this_week',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[{action:'整理作品',minutes:120,directionScopes:['employment']}]}})
      const result=await engine(t9)
      const saved=await store.finishRun(t9.run,t9.staged,result.text,result.usage,t9.signal)
      assert.ok(saved.stateChange.plan,'plan persisted with the week-scoped budget')
      const planText=(await growthContext(user,conversation).then(items=>items.find(item=>item.id===saved.stateChange.plan!.itemId)))!.text
      assert.ok(planText.includes('本周剩余'),'label names the budget window, not 每周')
      // A same-numbered fact from ANOTHER window never satisfies a next-week plan.
      const t10=await prepare('下周帮我安排。')
      const wrongWindowRef=(await pool.query('SELECT structured_plan FROM growth_items WHERE user_id=$1 AND id=$2',[user,saved.stateChange.plan!.itemId])).rows[0].structured_plan.budgetRef
      outputs.push({reply:'__BOUND_REPLY__',weeklyPlan:{target:{operation:'create'},availableMinutes:120,period:'next_week',budgetRef:wrongWindowRef,basis:[wrongWindowRef],items:[{action:'投递',minutes:120,directionScopes:['employment']}]}})
      const r10=await engine(t10)
      // Fault injection at the persist seam: the engine may legitimately
      // repair its source, but the transaction must still reject a bad window.
      Object.assign(t10.staged.weeklyPlan!.input,{availableMinutes:120,period:'next_week',budgetRef:wrongWindowRef,basis:[wrongWindowRef]})
      await assert.rejects(store.finishRun(t10.run,t10.staged,r10.text,r10.usage,t10.signal),(e:any)=>e.code==='WEEKLY_PLAN_BUDGET_MISMATCH')
      await store.terminateRun(user,t10.run.request_id,'failed','SYNTHETIC_P3_F06')
    })
  }finally{
    model.baseUrl=previousURL;config.apiKey=previousKey;Object.assign(config.modelTiers.reasoning,previousReasoning)
    await new Promise<void>(done=>fake.close(()=>done()))
    await pool.query('DELETE FROM growth_source_suppressions WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_item_lineage WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_items WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_revisions WHERE user_id=$1',[user])
    await pool.query('DELETE FROM runs WHERE user_id=$1',[user])
    await pool.query('DELETE FROM messages WHERE user_id=$1',[user])
    await pool.query('DELETE FROM conversations WHERE user_id=$1',[user])
    await pool.query('DELETE FROM "user" WHERE id=$1',[user])
  }
})

test.after(async()=>{try{await localEmbedding.close()}catch{}await pool.end()})
