import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {parseActionCoachTurn} from '../../server/action-coach-contracts.ts'
import {configureProviderPayload} from '../../server/model-payload.ts'
import {Value} from 'typebox/value'
import {stageGrowthUpdates,growthView,actOnGrowthItem} from '../../server/growth.ts'

test('source-only reported facts use verified user spans while legacy paraphrases and forged sources still fail atomically',async()=>{
  const user='growth-span-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  try{
    await store.createConversation(user,{id:chat,title:'SYNTHETIC source selector'})
    const text='我是20岁的大二学生。团队项目拿了奖，但我只做了访谈整理，没有写代码。本周仅两小时。先不联系，可以吗？'
    const run=(await store.startRun(user,chat,randomUUID(),text)).run
    const delta=(quote:string)=>({target:{operation:'create' as const},kind:'context' as const,assertion:'user_reported' as const,source:{messageId:run.source_message_id,quote}})
    const selected=[delta('团队项目拿了奖，但我只做了访谈整理，没有写代码'),delta('先不联系，可以吗？'),{...delta('本周仅两小时'),kind:'constraint' as const,validUntil:new Date(Date.now()+7*86400000).toISOString()}]
    const parsed=parseActionCoachTurn(JSON.stringify({reply:'保持当前边界，先核对情况。',growthUpdates:selected}))
    const request=configureProviderPayload({},{provider:'bailian',id:'qwen3.8-flash'},'default',undefined,undefined,8192,run.source_message_id,[],[]) as any
    assert.equal(Value.Check(request.response_format.json_schema.schema,parsed),true,'native constrained schema accepts source-only reported facts without authorizing made-up IDs')
    assert.ok(parsed.growthUpdates?.every(row=>!('text'in row)))
    const staged=await stageGrowthUpdates(run,parsed.growthUpdates!,[])
    assert.deepEqual(staged.changes.map(row=>row.text),selected.map(row=>row.source.quote))
    await assert.rejects(stageGrowthUpdates(run,[{...selected[0],text:'我具备稳定技术能力'}],[]),{code:'GROWTH_SOURCE_INVALID'})
    await assert.rejects(stageGrowthUpdates(run,[delta('团队项目...没有写代码')],[]),{code:'GROWTH_SOURCE_INVALID'})
    await assert.rejects(stageGrowthUpdates(run,[{...selected[0],source:{...selected[0].source,messageId:randomUUID()}}],[]),{code:'GROWTH_SOURCE_INVALID'})
    await assert.rejects(stageGrowthUpdates(run,[{...delta('本周仅两小时'),kind:'constraint'}],[]),{code:'GROWTH_TIME_REQUIRED'})
    assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:'未知不猜。',growthUpdates:[{...delta('先不联系，可以吗？'),kind:'unknown',assertion:'unknown'}]})),/OUTPUT_INVALID/)
    assert.equal((await growthView(user,chat)).items.length,0,'all validation failures precede any writes')
    await store.finishRun(run,{candidates:[],audit:[],growth:staged},'保持当前边界，先核对情况。',null,new AbortController().signal)
    const view=await growthView(user,chat)
    assert.equal(view.items.length,3)
    for(const item of view.items){assert.equal(item.assertion,'user_reported');assert.equal(item.sources[0].quote,item.text);assert.ok(text.includes(item.text))}
    assert.ok(view.items.some(item=>item.text==='先不联系，可以吗？'))
    assert.ok(view.items.some(item=>item.text==='本周仅两小时'))
    assert.ok(!view.items.some(item=>item.text.includes('稳定技术能力')))
    const forgotten=view.items.find(item=>item.text===selected[0].source.quote)!
    await actOnGrowthItem(user,forgotten.id,{requestId:randomUUID(),expectedRevision:forgotten.revision,action:'forget'})
    await assert.rejects(stageGrowthUpdates(run,[selected[0]],[]),{code:'CAMPUS_SOURCE_FORGOTTEN'})
    assert.equal((await stageGrowthUpdates(run,[selected[1]],[])).changes[0].text,'先不联系，可以吗？','forgetting one selected span preserves independent question-form boundaries')
    const longText='我'.repeat(4001),oversize=(await store.startRun(user,chat,randomUUID(),longText)).run
    const longDelta={...delta(longText),source:{messageId:oversize.source_message_id,quote:longText}}
    await assert.rejects(stageGrowthUpdates(oversize,[longDelta],[]),{code:'GROWTH_SOURCE_INVALID'})
    await store.terminateRun(user,oversize.request_id,'cancelled','SYNTHETIC_OVERSIZE_NO_TRUNCATION')
  }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user]);await pool.end()}
})
