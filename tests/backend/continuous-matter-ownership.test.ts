import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'
import {stageCoachEvent,coachEventView} from '../../server/action-coach-events.ts'
import {stageGrowthUpdates,growthContext,growthView,actOnGrowthItem} from '../../server/growth.ts'
import {pool} from '../../server/db.ts'
import {setMemorySettings} from '../../server/memory.ts'

test('closing the prior matter never closes a newly declared direction',async()=>{
 const h=await residualHarness()
 try{
  const {user,chat}=await h.account(),initial='我接受这个考研资料核对步骤。',first=(await store.startRun(user,chat,randomUUID(),initial)).run
  let old=(await store.finishRun(first,{candidates:[],audit:[],coach:await stageCoachEvent(first,{target:{operation:'create',title:'考研资料核对',source:{messageId:first.source_message_id,quote:initial}},nodes:[{kind:'fact',source:{messageId:first.source_message_id,quote:initial}}]},'你接受了这一步，是否执行仍未知。')},'你接受了这一步，是否执行仍未知。',null,new AbortController().signal)).event!
  const text='我决定结束这件事。我现在决定转向就业探索，先了解数据运营岗位。',run=(await store.startRun(user,chat,randomUUID(),text)).run
  // Exact prior-candidate failure: one supplied prior event, a model create
  // titled for the new direction but anchored to the prior ending sentence.
  const audit=[{phase:'coach_context_bound',eventRefs:[{eventId:old.id,revision:old.revision,generation:old.generation}],scope:'supplied_context_only_not_proof_of_effective_help',providerCalls:0}]
  const delta={target:{operation:'create' as const,title:'就业探索',source:{messageId:run.source_message_id,quote:'我决定结束这件事'}},nodes:[{kind:'fact' as const,source:{messageId:run.source_message_id,quote:'我现在决定转向就业探索'}}]}
  const growth=await stageGrowthUpdates(run,[{target:{operation:'create'},kind:'feedback',assertion:'user_reported',text:'我决定结束这件事',source:{messageId:run.source_message_id,quote:'我决定结束这件事'},progressState:'unknown'},{target:{operation:'create'},kind:'goal',assertion:'user_reported',text:'我现在决定转向就业探索',source:{messageId:run.source_message_id,quote:'我现在决定转向就业探索'}}],await growthContext(user,chat))
  const saved=await store.finishRun(run,{candidates:[],audit,growth,coach:await stageCoachEvent(run,delta,'原考研事项结束，新就业方向尚未执行。')},'原考研事项结束，新就业方向尚未执行。',null,new AbortController().signal)
  const current=(await coachEventView(user,chat,saved.event!.id))!;old=(await coachEventView(user,chat,old.id))!
  assert.equal(old.matterProgress!.state,'ended','the explicit prior-matter report belongs to the actual context owner')
  assert.equal(old.matterProgress!.recommendationStopped,true)
  assert.notEqual(current.matterProgress!.state,'ended','the new direction is not the object of the prior ending')
  assert.equal(current.matterProgress!.recommendationStopped,false)
  assert.deepEqual(saved.event!.matterProgress,current.matterProgress,'first committed receipt and refreshed read have the same source ownership')
  assert.ok(old.matterProgress!.reports.some(report=>report.sourceMessageId===run.source_message_id))
  const originalAudit=JSON.stringify(audit)
  for(const badRef of [{eventId:old.id,revision:999,generation:old.generation},{eventId:old.id,revision:old.revision,generation:999}]){
   await pool.query('UPDATE runs SET tool_audit=$3 WHERE user_id=$1 AND request_id=$2',[user,run.request_id,JSON.stringify([{phase:'coach_context_bound',eventRefs:[badRef]}])])
   assert.ok(!(await coachEventView(user,chat,old.id))!.matterProgress!.reports.some(report=>report.sourceMessageId===run.source_message_id),'nonexistent snapshot revision or generation is not ownership evidence')
  }
  await pool.query('UPDATE runs SET tool_audit=$3 WHERE user_id=$1 AND request_id=$2',[user,run.request_id,originalAudit])
  const forget=(await growthView(user,chat)).items.find(item=>item.kind==='feedback'&&item.text==='我决定结束这件事')!
  await actOnGrowthItem(user,forget.id,{requestId:randomUUID(),expectedRevision:forget.revision,action:'forget'})
  assert.ok(!(await coachEventView(user,chat,old.id))!.matterProgress!.reports.some(report=>report.sourceMessageId===run.source_message_id),'withdrawn transition words cannot reappear in the prior event')
  assert.ok((await growthView(user,chat)).items.some(item=>item.text==='我现在决定转向就业探索'&&item.status==='active'),'independent new pursuit survives exact transition forgetting')
  for(const sample of [
   {text:'我先暂停这件事。',root:'我先暂停这件事',node:'我先暂停这件事',refs:1,prior:'paused',next:'paused'},
   {text:'我现在决定转向就业探索。我决定结束这件事。',root:'我现在决定转向就业探索',node:'我现在决定转向就业探索',refs:1,prior:'accepted',next:'ended'},
   {text:'室友说“我决定结束这件事”。我现在决定转向就业探索。',root:'我现在决定转向就业探索',node:'我现在决定转向就业探索',refs:1,prior:'accepted',next:'unknown'},
   {text:'我决定结束这件事。我现在决定转向就业探索。',root:'我决定结束这件事',node:'我现在决定转向就业探索',refs:2,prior:'accepted',next:'unknown'},
   {text:'换一件事。我决定结束这件事。我现在决定转向就业探索。',root:'我决定结束这件事',node:'我现在决定转向就业探索',refs:1,prior:'accepted',next:'unknown'},
   {text:'我今天很累。我决定结束这件事。我现在决定转向就业探索。',root:'我决定结束这件事',node:'我现在决定转向就业探索',refs:2,primary:true,prior:'ended',next:'unknown'},
   {text:'我决定结束这件事。我现在决定转向就业探索。',root:'我决定结束这件事',node:'我现在决定转向就业探索',refs:1,cross:true,prior:'ended',next:'unknown'},
  ]){
   const a=await h.account(),start=(await store.startRun(a.user,a.chat,randomUUID(),initial)).run
   const prior=(await store.finishRun(start,{candidates:[],audit:[],coach:await stageCoachEvent(start,{target:{operation:'create',title:'旧事项',source:{messageId:start.source_message_id,quote:initial}},nodes:[{kind:'fact',source:{messageId:start.source_message_id,quote:initial}}]},'接受不等于执行。')},'接受不等于执行。',null,new AbortController().signal)).event!
   const inputChat='cross'in sample&&sample.cross?randomUUID():a.chat
   if(inputChat!==a.chat)await store.createConversation(a.user,{id:inputChat,title:'SYNTHETIC later conversation'})
   const input=(await store.startRun(a.user,inputChat,randomUUID(),sample.text)).run,refs=[{eventId:prior.id,revision:prior.revision,generation:prior.generation}]
   if(sample.refs===2){
    const anotherChat=randomUUID();await store.createConversation(a.user,{id:anotherChat,title:'SYNTHETIC second owned matter'})
    const anotherRun=(await store.startRun(a.user,anotherChat,randomUUID(),'我想核对课程要求。')).run
    const another=(await store.finishRun(anotherRun,{candidates:[],audit:[],coach:await stageCoachEvent(anotherRun,{target:{operation:'create',title:'课程要求',source:{messageId:anotherRun.source_message_id,quote:'我想核对课程要求'}}},'课程要求仍待核对。')},'课程要求仍待核对。',null,new AbortController().signal)).event!
    refs.push({eventId:another.id,revision:another.revision,generation:another.generation})
   }
   const next=await store.finishRun(input,{candidates:[],audit:[{phase:'coach_context_bound',eventRefs:refs,...('primary'in sample&&sample.primary?{currentEventId:prior.id}:{})}],coach:await stageCoachEvent(input,{target:{operation:'create',title:'本轮记录',source:{messageId:input.source_message_id,quote:sample.root}},nodes:[{kind:'fact',source:{messageId:input.source_message_id,quote:sample.node}}]},'未报告的状态保留未知。')},'未报告的状态保留未知。',null,new AbortController().signal)
   assert.equal((await coachEventView(a.user,a.chat,prior.id))!.matterProgress!.state,sample.prior,sample.text)
   assert.equal(next.event!.matterProgress!.state,sample.next,sample.text)
   if(inputChat!==a.chat){
    await setMemorySettings(a.user,{requestId:randomUUID(),enabled:false,expectedRevision:1})
    assert.equal((await coachEventView(a.user,a.chat,prior.id))!.matterProgress!.state,'accepted','disabled cross-conversation memory cannot import a later conversation report')
   }
  }
 }finally{await h.close()}
})
