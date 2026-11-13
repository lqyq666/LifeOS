import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'
import {pool} from '../../server/db.ts'
import {stageCoachEvent,coachEventView} from '../../server/action-coach-events.ts'

test('an explicit accepted but unattempted step survives a provider omitting the event lane',async()=>{
 const h=await residualHarness()
 try{
  const {user,chat}=await h.account(),text='我想核对一份已保存的岗位说明。'
  const {run}=await store.startRun(user,chat,randomUUID(),text),source={messageId:run.source_message_id,quote:text}
  const saved=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'岗位核对',source},nodes:[{kind:'fact',source}]},'先从这份岗位说明中找一条工作要求。')},'先从这份岗位说明中找一条工作要求。',null,new AbortController().signal)
  const event=saved.event!
  for(const text of ['如果我接受你刚才建议的这个步骤。','室友说我接受你刚才建议的这个步骤。','“我接受你刚才建议的这个步骤”。','换个新话题，我接受这个方案。','我接受这个步骤。我已经完成了英语作业。','我接受英语作业这个步骤。','我接受你刚才建议的这个步骤，但这段不要记住，不要更新已有资料。']){
   await h.execute(user,chat,text)
   assert.equal((await coachEventView(user,chat,event.id))!.matterProgress!.choice,'unknown',text)
  }
  const accepted=await h.execute(user,chat,'我接受你刚才建议的这个步骤。这只是我选择接受，尚未执行，先不加任务。')
  const next=(await coachEventView(user,chat,event.id))!
  assert.equal(next.matterProgress!.choice,'accepted')
  assert.equal(next.matterProgress!.state,'unattempted')
  assert.ok(next.matterProgress!.reports.some(report=>report.sourceMessageId===accepted.source_message_id))
  const second=randomUUID();await store.createConversation(user,{id:second,title:'SYNTHETIC same matter readback'})
  assert.equal((await coachEventView(user,second,event.id))!.matterProgress!.choice,'accepted')
  const another=await h.account(),opening='我想核对已保存的考研资料。'
  const {run:openingRun}=await store.startRun(another.user,another.chat,randomUUID(),opening),openingSource={messageId:openingRun.source_message_id,quote:opening}
  const anotherSaved=await store.finishRun(openingRun,{candidates:[],audit:[],coach:await stageCoachEvent(openingRun,{target:{operation:'create',title:'核对已保存的考研资料',source:openingSource},nodes:[{kind:'fact',source:openingSource}]},'先打开本地资料，核对一个栏目。')},'先打开本地资料，核对一个栏目。',null,new AbortController().signal)
  const anotherEvent=anotherSaved.event!,choiceText='我接受你刚才建议的这个步骤，但我还没有执行。不要把接受写成完成。',fallbackReply='明白，接受不等于执行。当前是已接受但尚未执行。'
  const callsBefore=h.requests.length,acceptedWithInvalidSidecar=await h.execute(another.user,another.chat,choiceText,{unexpectedProviderSidecar:'must be discarded',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'ability',source:{clauseId:'c0'}}],event:{target:{operation:'create',title:'未知字段路径的模型副作用事项',source:{clauseId:'c0'}},nodes:[{kind:'fact',source:{clauseId:'c0'}}]}},fallbackReply)
  assert.equal(h.requests.length,callsBefore+1)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[another.user,acceptedWithInvalidSidecar.request_id])).rows,[{content:fallbackReply}])
  const current=(await coachEventView(another.user,another.chat,anotherEvent.id))!
  assert.equal(current.matterProgress!.choice,'accepted')
  assert.equal(current.matterProgress!.state,'unattempted')
  const invalidSidecarReports=current.matterProgress!.reports.filter(report=>report.sourceMessageId===acceptedWithInvalidSidecar.source_message_id)
  assert.equal(invalidSidecarReports.length,1)
  assert.deepEqual(invalidSidecarReports[0]?.quotes,['我接受你刚才建议的这个步骤','但我还没有执行'])
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1 AND origin_request_id=$2 AND kind='ability'",[another.user,acceptedWithInvalidSidecar.request_id])).rows[0].n,0)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM coach_events WHERE user_id=$1',[another.user])).rows[0].n,1)
  const contribution=await h.account(),contributionOpening='我想核对已保存的考研资料。'
  const {run:contributionRun}=await store.startRun(contribution.user,contribution.chat,randomUUID(),contributionOpening),contributionSource={messageId:contributionRun.source_message_id,quote:contributionOpening}
  const contributionSaved=await store.finishRun(contributionRun,{candidates:[],audit:[],coach:await stageCoachEvent(contributionRun,{target:{operation:'create',title:'核对已保存的考研资料',source:contributionSource},nodes:[{kind:'fact',source:contributionSource}]},'先打开本地资料。')},'先打开本地资料。',null,new AbortController().signal)
  const contributionCallsBefore=h.requests.length,contributionChoice=await h.execute(contribution.user,contribution.chat,choiceText,{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',source:{clauseId:'c0'},progressState:'unattempted',contribution:{actor:'self',actionQuote:'接受',skillTags:[]}},{target:{operation:'create'},assertion:'user_reported',kind:'ability',source:{clauseId:'c0'}}],event:{target:{operation:'create',title:'模型副作用事项',source:{clauseId:'c0'}},nodes:[{kind:'fact',source:{clauseId:'c0'}}]}},fallbackReply)
  assert.equal(h.requests.length,contributionCallsBefore+1)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[contribution.user,contributionChoice.request_id])).rows,[{content:fallbackReply}])
  const contributionCurrent=(await coachEventView(contribution.user,contribution.chat,contributionSaved.event!.id))!
  assert.equal(contributionCurrent.matterProgress!.choice,'accepted')
  assert.equal(contributionCurrent.matterProgress!.state,'unattempted')
  const contributionReports=contributionCurrent.matterProgress!.reports.filter(report=>report.sourceMessageId===contributionChoice.source_message_id)
  assert.equal(contributionReports.length,1)
  assert.deepEqual(contributionReports[0]?.quotes,['我接受你刚才建议的这个步骤','但我还没有执行'])
  const providerSideEffects=(await pool.query('SELECT kind,text FROM growth_items WHERE user_id=$1 AND origin_request_id=$2',[contribution.user,contributionChoice.request_id])).rows
  assert.ok(!providerSideEffects.some(row=>row.kind==='ability'||row.kind==='feedback'),JSON.stringify(providerSideEffects))
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM coach_events WHERE user_id=$1',[contribution.user])).rows[0].n,1)
  const layered=await h.account(),layeredOpening='我想核对已保存的考研资料。'
  const {run:layeredRun}=await store.startRun(layered.user,layered.chat,randomUUID(),layeredOpening),layeredSource={messageId:layeredRun.source_message_id,quote:layeredOpening}
  const layeredSaved=await store.finishRun(layeredRun,{candidates:[],audit:[],coach:await stageCoachEvent(layeredRun,{target:{operation:'create',title:'核对已保存的考研资料',source:layeredSource},nodes:[{kind:'fact',source:layeredSource}]},'先打开本地资料。')},'先打开本地资料。',null,new AbortController().signal)
  const layeredCalls=h.requests.length,layeredChoice=await h.execute(layered.user,layered.chat,choiceText,{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',source:{clauseId:'c0'},progressState:'unattempted',contribution:{actor:'self',actionQuote:'接受',skillTags:[]}}],event:{target:{operation:'create',title:'第二个无效模型副作用',source:{clauseId:'c99'}},nodes:[{kind:'fact',source:{clauseId:'c99'}}]}},fallbackReply)
  assert.equal(h.requests.length,layeredCalls+1)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[layered.user,layeredChoice.request_id])).rows,[{content:fallbackReply}])
  const layeredCurrent=(await coachEventView(layered.user,layered.chat,layeredSaved.event!.id))!
  assert.equal(layeredCurrent.matterProgress!.choice,'accepted')
  assert.equal(layeredCurrent.matterProgress!.state,'unattempted')
  assert.equal(layeredCurrent.matterProgress!.reports.filter(report=>report.sourceMessageId===layeredChoice.source_message_id).length,1)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM coach_events WHERE user_id=$1',[layered.user])).rows[0].n,1)
  const layeredGrowth=(await pool.query('SELECT kind,text FROM growth_items WHERE user_id=$1 AND origin_request_id=$2',[layered.user,layeredChoice.request_id])).rows
  assert.ok(!layeredGrowth.some(row=>row.kind==='ability'||row.kind==='feedback'),JSON.stringify(layeredGrowth))
  for(const rejectedText of [
   '我接受你刚才建议的这个步骤。',
   '如果我接受你刚才建议的这个步骤。我还没有执行。',
   '室友说我接受你刚才建议的这个步骤。我还没有执行。',
   '“我接受你刚才建议的这个步骤”。我还没有执行。',
   '换个新话题，我接受这个方案。我还没有执行。',
   '我接受这个步骤。我还没有执行。我已经完成了英语作业。',
   '更正一下：我接受你刚才建议的这个步骤。我还没有执行。',
   '我接受你刚才建议的这个步骤，但我还没有执行。我现在是统计学专业。',
   '我接受你刚才建议的这个步骤，但我还没有执行。只在本次对话使用，不要写入长期记忆。',
   '我接受你刚才建议的这个步骤，但我还没有执行。忘记之前保存的考研资料。',
   '我接受你刚才建议的这个步骤，但我还没有执行。这段不要记住。',
  ]){
   for(const rejectedPayload of [
    {unexpectedProviderSidecar:'must not bypass mixed or private controls'},
    {growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',source:{clauseId:'c0'},progressState:'unattempted',contribution:{actor:'self',actionQuote:'接受',skillTags:[]}}],event:{target:{operation:'create',title:'第二个无效模型副作用',source:{clauseId:'c99'}},nodes:[{kind:'fact',source:{clauseId:'c99'}}]}},
   ]){
    const rejected=await h.account(),rejectedOpening='我想核对已保存的考研资料。'
    const {run:rejectedRun}=await store.startRun(rejected.user,rejected.chat,randomUUID(),rejectedOpening),rejectedSource={messageId:rejectedRun.source_message_id,quote:rejectedOpening}
    const rejectedSaved=await store.finishRun(rejectedRun,{candidates:[],audit:[],coach:await stageCoachEvent(rejectedRun,{target:{operation:'create',title:'核对已保存的考研资料',source:rejectedSource},nodes:[{kind:'fact',source:rejectedSource}]},'先打开本地资料。')},'先打开本地资料。',null,new AbortController().signal)
    const eventsBefore=(await pool.query('SELECT count(*)::int AS n FROM coach_events WHERE user_id=$1',[rejected.user])).rows[0].n
    const growthBefore=(await pool.query('SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1',[rejected.user])).rows[0].n
    await assert.rejects(h.execute(rejected.user,rejected.chat,rejectedText,rejectedPayload),(error:any)=>error?.code==='COACH_OUTPUT_INVALID')
    assert.equal((await coachEventView(rejected.user,rejected.chat,rejectedSaved.event!.id))!.matterProgress!.choice,'unknown')
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM coach_events WHERE user_id=$1',[rejected.user])).rows[0].n,eventsBefore)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1',[rejected.user])).rows[0].n,growthBefore)
   }
  }
  const declined=await h.account(),declinedOpening='我想核对已保存的考研资料。'
  const {run:declinedRun}=await store.startRun(declined.user,declined.chat,randomUUID(),declinedOpening),declinedSource={messageId:declinedRun.source_message_id,quote:declinedOpening}
  const declinedSaved=await store.finishRun(declinedRun,{candidates:[],audit:[],coach:await stageCoachEvent(declinedRun,{target:{operation:'create',title:'核对已保存的考研资料',source:declinedSource},nodes:[{kind:'fact',source:declinedSource}]},'先打开本地资料。')},'先打开本地资料。',null,new AbortController().signal)
  const declinedText='我拒绝你刚才建议的这个步骤。我还没有执行。',declinedReply='明白，你拒绝了这一步，而且没有执行。',declinedCalls=h.requests.length
  const declinedChoice=await h.execute(declined.user,declined.chat,declinedText,{unexpectedProviderSidecar:'must be discarded'},declinedReply)
  assert.equal(h.requests.length,declinedCalls+1)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[declined.user,declinedChoice.request_id])).rows,[{content:declinedReply}])
  const declinedCurrent=(await coachEventView(declined.user,declined.chat,declinedSaved.event!.id))!
  assert.equal(declinedCurrent.matterProgress!.choice,'declined')
  assert.equal(declinedCurrent.matterProgress!.state,'paused')
  assert.deepEqual(declinedCurrent.matterProgress!.reports.find(report=>report.sourceMessageId===declinedChoice.source_message_id)?.quotes,['我拒绝你刚才建议的这个步骤','我还没有执行'])
  const malformed=await h.account(),malformedOpening='我想核对已保存的考研资料。'
  const {run:malformedRun}=await store.startRun(malformed.user,malformed.chat,randomUUID(),malformedOpening),malformedSource={messageId:malformedRun.source_message_id,quote:malformedOpening}
  const malformedSaved=await store.finishRun(malformedRun,{candidates:[],audit:[],coach:await stageCoachEvent(malformedRun,{target:{operation:'create',title:'核对已保存的考研资料',source:malformedSource},nodes:[{kind:'fact',source:malformedSource}]},'先打开本地资料。')},'先打开本地资料。',null,new AbortController().signal)
  await assert.rejects(h.execute(malformed.user,malformed.chat,choiceText,{event:{target:'broken'}},'明白，接受不等于执行。当前是已接受但尚未执行。'),(error:any)=>error?.code==='COACH_OUTPUT_INVALID')
  assert.equal((await coachEventView(malformed.user,malformed.chat,malformedSaved.event!.id))!.matterProgress!.choice,'unknown')
 }finally{await h.close()}
})
