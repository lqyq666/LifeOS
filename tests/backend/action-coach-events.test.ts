import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool, transaction } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { loadSnapshot, stageCoachBackground, setMemorySettings, applyMemoryAction } from '../../server/memory.ts'
import { coachEventView, coachEventViewWithSources, stageCoachEvent, invalidateCoachSourceQuotes, deliverableIntent } from '../../server/action-coach-events.ts'
import {parseActionCoachTurn,type EventDelta} from '../../server/action-coach-contracts.ts'
import {redactGrowthHistory} from '../../server/growth-privacy.ts'
import {buildClauseCatalogue,clauseMessageSource} from '../../server/clause-catalogue.ts'
import {growthContext,stageGrowthUpdates} from '../../server/growth.ts'

const signal=()=>new AbortController().signal

test('event workspace and one authoritative action commit with real PostgreSQL safety boundaries',async t=>{
  const user='coach-events-'+randomUUID(),other='coach-foreign-'+randomUUID(),conversation=randomUUID(),second=randomUUID(),foreignConversation=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now()),($3,$3,$4,false,now(),now())',[user,user+'@example.invalid',other,other+'@example.invalid'])
  await store.createConversation(user,{id:conversation,title:'SYNTHETIC event persistence'})
  await store.createConversation(user,{id:second,title:'SYNTHETIC second conversation'})
  await store.createConversation(other,{id:foreignConversation,title:'SYNTHETIC foreign owner'})
  const source=(run:store.Run,quote:string)=>({messageId:run.source_message_id,quote})
  const settings=async(enabled:boolean)=>{
    const revision=(await pool.query('SELECT revision FROM user_memory_settings WHERE user_id=$1',[user])).rows[0]?.revision??0
    return setMemorySettings(user,{requestId:randomUUID(),expectedRevision:revision,enabled})
  }
  let eventId='',nodeId='',unknownNodeId='',actionId='',eventRevision=0,actionRevision=0
  try{
    await t.test('current process is saved with memory off; plans remain proposals, not executed facts',async()=>{
      const text='我花了三小时整理四十页，对方说手机打不开。我有点失望。请帮我写一句跟进消息。'
      const run=(await store.startRun(user,conversation,randomUUID(),text)).run
      const material='上次的网盘手机打不开。你现在还需要哪一个知识点？不需要也没关系。'
      const reply='目前确认的是打开障碍，内容是否有帮助还没有检验。可以先发这段：\n'+material
      const delta:EventDelta={target:{operation:'create',title:'整理资料后的反馈',source:source(run,text)},nodes:[{kind:'fact',source:source(run,'对方说手机打不开')},{kind:'feeling',source:source(run,'我有点失望')},{kind:'unknown',question:'对方现在是否仍然需要资料？'}],action:{operation:'create',source:source(run,'请帮我写一句跟进消息'),draft:{content:material,observable:'对方明确需要哪一部分，或已经不需要。',stopWhen:'不需要就结束；未回复只记未回复。'}}}
      const staged:store.Staged={candidates:[],audit:[],coach:await stageCoachEvent(run,delta,reply)}
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM coach_events WHERE user_id=$1',[user])).rows[0].n,0,'staging itself writes no event')
      const saved=await store.finishRun(run,staged,reply,null,signal())
      const event=saved.event!
      eventId=event.id;eventRevision=event.revision
      nodeId=event.nodes.find(node=>node.kind==='fact')!.id
      unknownNodeId=event.nodes.find(node=>node.kind==='unknown')!.id
      actionId=event.actions[0]!.id;actionRevision=event.actions[0]!.revision
      assert.equal(event.nodes.length,3)
      assert.equal(event.nodes.find(node=>node.id===nodeId)?.content,'对方说手机打不开','the canonical fact is the exact quote, not a generated causal summary')
      assert.equal(event.actions[0]!.status,'proposed')
      assert.equal(event.actions[0]!.draft?.content,material)
      assert.equal((await store.decisionVersions(user,conversation)).length,0,'no duplicate Decision projection')
      assert.equal((await store.listExperiences(user,conversation)).length,0,'process saving does not bypass graph confirmation')
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM memory_items WHERE user_id=$1',[user])).rows[0].n,0,'session process does not enable long-term memory')
    })
    await t.test('a normalized unresolved unknown still blocks its dependent question',async()=>{
      const run=(await store.startRun(user,conversation,randomUUID(),'我只问了一个学长。')).run
      const target:EventDelta['target']={operation:'continue',eventId,expectedRevision:eventRevision}
      const delta:EventDelta={target,resolveUnknowns:[unknownNodeId],declineUnknowns:[unknownNodeId],nodes:[{kind:'unknown',question:'对方现在是否需要另一种资料？',dependsOn:[unknownNodeId]}]}
      try{
        await assert.rejects(stageCoachEvent(run,delta,'对方现在是否需要另一种资料？'),(error:any)=>error.code==='COACH_UNKNOWN_PREREQUISITE_OPEN')
      }finally{
        await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')
      }
    })
    await t.test('a refusal is matched to the unknown item rather than a different topic',async()=>{
      const run=(await store.startRun(user,conversation,randomUUID(),'家庭情况我不想说，实习收入记不清。')).run
      const target:EventDelta['target']={operation:'continue',eventId,expectedRevision:eventRevision}
      const delta:EventDelta={target,resolveUnknowns:[unknownNodeId],declineUnknowns:[unknownNodeId],nodes:[{kind:'unknown',question:'还需要哪部分资料？',dependsOn:[unknownNodeId]}]}
      try{
        await assert.rejects(stageCoachEvent(run,delta,'还需要哪部分资料？'),(error:any)=>error.code==='COACH_UNKNOWN_PREREQUISITE_OPEN')
      }finally{
        await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')
      }

      const refusal=(await store.startRun(user,conversation,randomUUID(),'对方现在需要资料这件事，我不想说。')).run
      try{
        const refused=await stageCoachEvent(refusal,{target,resolveUnknowns:[unknownNodeId],declineUnknowns:[unknownNodeId]},'明白，我不会继续追问这点。')
        assert.deepEqual(refused.delta.resolveUnknowns,[])
        assert.deepEqual(refused.delta.declineUnknowns,[unknownNodeId])
      }finally{
        await store.terminateRun(user,refusal.request_id,'cancelled','TEST_CLEANUP')
      }
    })
    await t.test('unchanged proposed material cannot be submitted as a new revision',async()=>{
      const run=(await store.startRun(user,conversation,randomUUID(),'这个细节我记不清了。')).run
      const event=(await coachEventView(user,conversation))!,draft=event.actions[0]!.draft!
      const reordered=Object.fromEntries(Object.entries(draft).reverse())
      const delta:EventDelta={target:{operation:'continue',eventId,expectedRevision:eventRevision},action:{operation:'modify',actionId,expectedRevision:actionRevision,draft:reordered as any}}
      await assert.rejects(stageCoachEvent(run,delta,String(draft.content)),(error:any)=>error.code==='COACH_ACTION_UNCHANGED')
      const unchanged=(await coachEventView(user,conversation))!
      assert.equal(unchanged.revision,eventRevision)
      assert.equal(unchanged.actions[0]!.revision,actionRevision)
      // The same material can still be deliberately reused without a fake edit.
      const reuse={...delta,action:{operation:'reuse' as const,actionId,expectedRevision:actionRevision}}
      await stageCoachEvent(run,reuse,'可以沿用已有材料。')
      await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')
    })
    await t.test('ownership and cross-conversation permission are enforced for both reads and writes',async()=>{
      await assert.rejects(coachEventView(other,foreignConversation,eventId),(error:any)=>error.code==='NOT_FOUND')
      await assert.rejects(coachEventView(user,second,eventId),(error:any)=>error.code==='MEMORY_DISABLED')
      const run=(await store.startRun(user,second,randomUUID(),'继续这件事。')).run
      await assert.rejects(stageCoachEvent(run,{target:{operation:'continue',eventId,expectedRevision:eventRevision}},'继续。'),(error:any)=>error.code==='MEMORY_DISABLED')
      await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')
      await settings(true)
      assert.equal((await coachEventView(user,second,eventId))?.id,eventId)
    })
    await t.test('source mismatches and invisible materials fail; generation cannot inject a duplicate question list',async()=>{
      const text='我暂时没收到新回复。请帮我改写跟进消息。',run=(await store.startRun(user,conversation,randomUUID(),text)).run
      const target:EventDelta['target']={operation:'continue',eventId,expectedRevision:eventRevision}
      await assert.rejects(stageCoachEvent(run,{target,nodes:[{kind:'fact',source:source(run,'他说不需要了')} ]},'这是等待。'),(error:any)=>error.code==='COACH_SOURCE_INVALID')
      await assert.rejects(stageCoachEvent(run,{target,action:{operation:'modify',actionId,expectedRevision:actionRevision,source:source(run,'请帮我改写跟进消息'),draft:{content:'另一份没有显示的计划'}}},'只显示一句。'),(error:any)=>error.code==='COACH_MATERIAL_NOT_VISIBLE')
      await assert.rejects(stageCoachEvent(run,{target,asked:['你用了多久？']} as any,'我在听。'),(error:any)=>error.code==='COACH_DELTA_INVALID')
      assert.equal((await coachEventView(user,conversation))?.revision,eventRevision)
      await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')
    })
    await t.test('a correction replaces the exact node and invalidates the old proposed action',async()=>{
      const text='更正一下，他说电脑能打开，是手机打不开。'
      const run=(await store.startRun(user,conversation,randomUUID(),text)).run
      const delta:EventDelta={target:{operation:'continue',eventId,expectedRevision:eventRevision},corrections:[{nodeId,source:source(run,'电脑能打开，是手机打不开')}]}
      const reply='已按你刚才的更正整理。\n他现在还需要哪一部分？'
      const saved=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,delta,reply)},reply,null,signal())
      const event=saved.event!
      eventRevision=event.revision;actionRevision=event.actions[0]!.revision
      assert.equal(event.nodes.find(node=>node.id===nodeId)?.revision,2)
      assert.equal(event.nodes.find(node=>node.id===nodeId)?.content,'电脑能打开，是手机打不开')
      assert.equal(event.actions[0]!.status,'stale')
      assert.equal(event.actions[0]!.draft,null,'invalidated material is not reintroduced as current advice')
      assert.deepEqual(event.actions[0]!.unavailableReasons,['material_withdrawn'])
      assert.deepEqual(event.asked,['他现在还需要哪一部分？'])
      assert.equal((await coachEventView(user,conversation))?.nodes.find(node=>node.id===nodeId)?.source?.messageId,run.source_message_id)
    })
    await t.test('one explicit modification becomes the displayed and saved material; stale reuse is rejected',async()=>{
      const run=(await store.startRun(user,conversation,randomUUID(),'请改写要发给对方的话：先问还需不需要，不要显得在催反馈。')).run
      const target:EventDelta['target']={operation:'continue',eventId,expectedRevision:eventRevision}
      await assert.rejects(stageCoachEvent(run,{target,action:{operation:'reuse',actionId,expectedRevision:actionRevision}},'沿用。'),(error:any)=>error.code==='COACH_ACTION_REVIEW_REQUIRED')
      const oldDraft=(await pool.query('SELECT draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0].draft
      const modifySource=source(run,'请改写要发给对方的话：先问还需不需要')
      await stageCoachEvent(run,{target,action:{operation:'modify',actionId,expectedRevision:actionRevision,source:modifySource,draft:oldDraft}},oldDraft.content)
      const material='你现在还需要哪一部分资料？不需要也没关系。'
      const modifiedDraft={...oldDraft,content:material}
      const reply='可以这样发：\n'+material
      const staged={candidates:[],audit:[],coach:await stageCoachEvent(run,{target,action:{operation:'modify',actionId,expectedRevision:actionRevision,source:modifySource,draft:modifiedDraft}},reply)}
      await assert.rejects(store.finishRun(run,staged,'与刚才不同的回复',null,signal()),(error:any)=>error.code==='COACH_REPLY_MISMATCH')
      const saved=await store.finishRun(run,staged,reply,null,signal())
      eventRevision=saved.event!.revision;actionRevision=saved.event!.actions[0]!.revision
      assert.equal(saved.event!.actions.length,1)
      assert.equal(saved.event!.actions[0]!.id,actionId)
      assert.deepEqual(saved.event!.actions[0]!.draft,modifiedDraft,'a content rewrite keeps sibling action fields unless the user removes them')
      assert.equal(saved.event!.actions[0]!.status,'proposed')
    })
    await t.test('legacy single-source snapshots cannot borrow an older source array',async()=>{
      await settings(true)
      const chat=randomUUID(),title='原子来源事项',createRequest='请写一条项目消息',modifyRequest='请把这条项目消息改短',initial='项目当前进展如下。',replacement='项目进展。'
      await store.createConversation(user,{id:chat,title:'SYNTHETIC atomic action provenance'})
      const firstRun=(await store.startRun(user,chat,randomUUID(),`${title}。${createRequest}。`)).run
      const created=await store.finishRun(firstRun,{candidates:[],audit:[],coach:await stageCoachEvent(firstRun,{target:{operation:'create',title,source:source(firstRun,title)},action:{operation:'create',source:source(firstRun,createRequest),draft:{content:initial}}},initial)},initial,null,signal())
      const secondRun=(await store.startRun(user,chat,randomUUID(),modifyRequest)).run,current=created.event!,action=current.actions[0]!
      const modified=await store.finishRun(secondRun,{candidates:[],audit:[],coach:await stageCoachEvent(secondRun,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision},action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,source:source(secondRun,modifyRequest),draft:{content:replacement}}},replacement)},replacement,null,signal())
      await pool.query("UPDATE coach_event_revisions SET snapshot=snapshot-'actionSources' WHERE user_id=$1 AND event_id=$2 AND revision=$3",[user,modified.event!.id,modified.event!.revision])

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:secondRun.source_message_id,quote:modifyRequest}],true))

      const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,action.id])).rows[0]
      assert.equal(persisted.status,'stale','the latest single actionSource is selected with its same-revision fallback array')
      assert.equal(persisted.draft,null)
    })
    await t.test('permission revocation after staging and acknowledged cancellation roll back all derived rows',async()=>{
      const run=(await store.startRun(user,second,randomUUID(),'还是继续之前的那件事。')).run
      const reply='先核对现在的需求。'
      const staged={candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'continue',eventId,expectedRevision:eventRevision},nodes:[{kind:'fact',source:source(run,'还是继续之前的那件事')} ]},reply)}
      await settings(false)
      await assert.rejects(store.finishRun(run,staged,reply,null,signal()),(error:any)=>error.code==='MEMORY_DISABLED')
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND conversation_id=$2 AND role='assistant'",[user,second])).rows[0].n,0)
      assert.equal((await coachEventView(user,conversation))?.revision,eventRevision)
      await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')
      const cancelled=(await store.startRun(user,conversation,randomUUID(),'先暂停一下。')).run
      const cancelledStaged={candidates:[],audit:[],coach:await stageCoachEvent(cancelled,{target:{operation:'continue',eventId,expectedRevision:eventRevision},action:{operation:'close',actionId,expectedRevision:actionRevision,reason:'用户暂时不继续'}},'先暂停。')}
      await store.terminateRun(user,cancelled.request_id,'cancelled','USER_CANCELLED')
      await assert.rejects(store.finishRun(cancelled,cancelledStaged,'先暂停。',null,signal()),(error:any)=>error.code==='RUN_NO_LONGER_ACTIVE')
      assert.equal((await coachEventView(user,conversation))?.actions[0]!.status,'proposed')
    })
    await t.test('optimistic event conflicts fail atomically and request replay never duplicates nodes/actions',async()=>{
      const run=(await store.startRun(user,conversation,randomUUID(),'这次先停止联系。')).run
      const reply='那就先停止联系，不再继续催促。'
      const delta:EventDelta={target:{operation:'continue',eventId,expectedRevision:eventRevision},action:{operation:'close',actionId,expectedRevision:actionRevision,reason:'用户明确停止联系'}}
      const staged={candidates:[],audit:[],coach:await stageCoachEvent(run,delta,reply)}
      await pool.query('UPDATE coach_events SET revision=revision+1 WHERE user_id=$1 AND id=$2',[user,eventId])
      await assert.rejects(store.finishRun(run,staged,reply,null,signal()),(error:any)=>error.code==='COACH_EVENT_REVISION_CONFLICT')
      assert.equal((await coachEventView(user,conversation))?.actions[0]!.status,'proposed')
      delta.target={operation:'continue',eventId,expectedRevision:++eventRevision}
      const saved=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,delta,reply)},reply,null,signal())
      eventRevision=saved.event!.revision
      assert.equal(saved.event!.actions[0]!.status,'closed')
      const replay=await store.startRun(user,conversation,run.request_id,'这次先停止联系。')
      assert.equal(replay.replay,true)
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM coach_actions WHERE user_id=$1 AND event_id=$2',[user,eventId])).rows[0].n,1)
    })
    await t.test('forgetting one exact node source preserves an independently sourced title and question history',async()=>{
      await settings(true)
      const titleText='我先整理了标题依据。',question='你当时怎样核对这个依据的？'
      const titleRun=(await store.startRun(user,second,randomUUID(),titleText)).run
      const created=await store.finishRun(titleRun,{candidates:[],audit:[],coach:await stageCoachEvent(titleRun,{target:{operation:'create',title:'独立标题事项',source:source(titleRun,titleText)},nodes:[{kind:'fact',source:source(titleRun,'标题依据')}]},question)},question,null,signal())
      assert.ok(created.event!.asked.includes(question))

      const nodeText='后来助教反馈手机打不开。',nodeRun=(await store.startRun(user,second,randomUUID(),nodeText)).run
      const continued=await store.finishRun(nodeRun,{candidates:[],audit:[],coach:await stageCoachEvent(nodeRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision},nodes:[{kind:'fact',source:source(nodeRun,'手机打不开')}]},'已记录这个变化。')},'已记录这个变化。',null,signal())
      assert.ok(continued.event!.nodes.some(node=>node.source?.messageId===nodeRun.source_message_id))

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:nodeRun.source_message_id,quote:'手机打不开'}],true))

      const after=(await coachEventView(user,second,created.event!.id))!
      assert.equal(after.title,'独立标题事项')
      assert.ok(after.asked.includes(question),'the unrelated earlier question remains in event history')
      assert.ok(after.processTurns?.some(turn=>turn.sourceMessageId===titleRun.source_message_id&&turn.questionsAskedAfterInput.includes(question)),'the originating process turn keeps its independently sourced question')
      const firstSnapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.equal(firstSnapshot.event.title,'独立标题事项')
      assert.deepEqual(firstSnapshot.askedThisTurn,[question])
    })
    await t.test('forgetting one exact range preserves a sibling-backed question from the same input',async()=>{
      await settings(true)
      const text='独立标题依据；我真正想核对的是预算。',question='本周预算上限是多少？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run,catalogue=buildClauseCatalogue(text)
      const titleSource=clauseMessageSource(run.source_message_id,catalogue[0]!),factSource=clauseMessageSource(run.source_message_id,catalogue[1]!)
      const saved=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'同消息独立标题',source:titleSource},nodes:[{kind:'fact',source:factSource}]},question)},question,null,signal())
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:titleSource.quote,range:{start:catalogue[0]!.start,end:catalogue[0]!.end}}],true))

      const after=(await coachEventView(user,second,saved.event!.id))!
      assert.ok(after.asked.includes(question),'the sibling fact range retains its derived question')
      assert.ok(after.processTurns?.some(turn=>turn.sourceMessageId===run.source_message_id&&turn.questionsAskedAfterInput.includes(question)))
    })
    await t.test('forgetting an older sole fact removes a later question grounded by that revision',async()=>{
      await settings(true)
      const text='跨轮标题依据；每周预算是一百元。',question='这笔预算还需要覆盖什么？',catalogue=buildClauseCatalogue(text)
      const factRun=(await store.startRun(user,second,randomUUID(),text)).run
      const titleSource=clauseMessageSource(factRun.source_message_id,catalogue[0]!),factSource=clauseMessageSource(factRun.source_message_id,catalogue[1]!)
      const created=await store.finishRun(factRun,{candidates:[],audit:[],coach:await stageCoachEvent(factRun,{target:{operation:'create',title:'跨轮问题事项',source:titleSource},nodes:[{kind:'fact',source:factSource}]},'已记录。')},'已记录。',null,signal())
      const questionRun=(await store.startRun(user,second,randomUUID(),'继续。')).run
      const questioned=await store.finishRun(questionRun,{candidates:[],audit:[],coach:await stageCoachEvent(questionRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision}},question)},question,null,signal())
      assert.ok(questioned.event!.asked.includes(question))

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:factRun.source_message_id,quote:factSource.quote,range:{start:catalogue[1]!.start,end:catalogue[1]!.end}}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'a later question cannot outlive its only exact fact basis')
      assert.ok(!after.processTurns?.some(turn=>turn.sourceMessageId===questionRun.source_message_id&&turn.questionsAskedAfterInput.includes(question)))
    })
    await t.test('forgetting a sole title basis removes an earlier question after unrelated recovery',async()=>{
      await settings(true)
      const titleText='只由标题支撑的事项。',question='这个事项接下来要核对什么？'
      const titleRun=(await store.startRun(user,second,randomUUID(),titleText)).run
      const created=await store.finishRun(titleRun,{candidates:[],audit:[],coach:await stageCoachEvent(titleRun,{target:{operation:'create',title:'标题唯一依据',source:source(titleRun,titleText)}},'已记录。')},'已记录。',null,signal())
      const questionRun=(await store.startRun(user,second,randomUUID(),'继续。')).run
      const questioned=await store.finishRun(questionRun,{candidates:[],audit:[],coach:await stageCoachEvent(questionRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision}},question)},question,null,signal())
      const recoveryText='我另外保存了一个无关事实。',recoveryRun=(await store.startRun(user,second,randomUUID(),recoveryText)).run
      await store.finishRun(recoveryRun,{candidates:[],audit:[],coach:await stageCoachEvent(recoveryRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:questioned.event!.revision},nodes:[{kind:'fact',source:source(recoveryRun,recoveryText)}]},'已保存无关事实。')},'已保存无关事实。',null,signal())

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:titleRun.source_message_id,quote:titleText}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.equal(after.title,'部分来源已更新的事项')
      assert.ok(!after.asked.includes(question),'an unrelated later fact cannot preserve a question whose sole title basis was forgotten')
      assert.ok(!after.processTurns?.some(turn=>turn.sourceMessageId===questionRun.source_message_id&&turn.questionsAskedAfterInput.includes(question)))
    })
    await t.test('forgetting an older action request removes a later question derived from that action',async()=>{
      await settings(true)
      const text='课程截止周五。请给我一条跟进消息。',factQuote='课程截止周五',requestQuote='请给我一条跟进消息',question='这条消息要发给谁？',material='我想继续确认这件事。'
      const actionRun=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(actionRun,{candidates:[],audit:[],coach:await stageCoachEvent(actionRun,{target:{operation:'create',title:'课程事项',source:source(actionRun,factQuote)},nodes:[{kind:'fact',source:source(actionRun,factQuote)}],action:{operation:'create',source:source(actionRun,requestQuote),draft:{content:material}}},material)},material,null,signal())
      const questionRun=(await store.startRun(user,second,randomUUID(),'继续。')).run
      const questioned=await store.finishRun(questionRun,{candidates:[],audit:[],coach:await stageCoachEvent(questionRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision}},question)},question,null,signal())
      assert.ok(questioned.event!.asked.includes(question))

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:actionRun.source_message_id,quote:requestQuote}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'later action help cannot outlive the exact request that authorized the action')
      assert.ok(!after.processTurns?.some(turn=>turn.sourceMessageId===questionRun.source_message_id&&turn.questionsAskedAfterInput.includes(question)))
    })
    await t.test('a later deictic factual question outranks an unrelated active action request',async()=>{
      await settings(true)
      const text='复诊事项。我的病情是X。请给我一条跟进消息。',health='我的病情是X',request='请给我一条跟进消息',question='这会影响下一步吗？',material='复诊时可以逐项询问。'
      const actionRun=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(actionRun,{candidates:[],audit:[],coach:await stageCoachEvent(actionRun,{target:{operation:'create',title:'复诊事项',source:source(actionRun,'复诊事项')},nodes:[{kind:'fact',source:source(actionRun,health)}],action:{operation:'create',source:source(actionRun,request),draft:{content:material}}},material)},material,null,signal())
      const questionRun=(await store.startRun(user,second,randomUUID(),'继续。')).run
      await store.finishRun(questionRun,{candidates:[],audit:[],coach:await stageCoachEvent(questionRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision}},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=2',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[health],'the topical fact outranks an unrelated proposed material')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:actionRun.source_message_id,quote:health}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'forgetting the topical fact removes its question')
      assert.equal(after.actions[0]?.status,'proposed','the separately sourced checklist request remains active')
    })
    await t.test('an action-material question outranks an unrelated fact that shares its noun',async()=>{
      await settings(true)
      const text='跟进事项。导师还没有回复消息。请给我一条跟进消息。',fact='导师还没有回复消息',request='请给我一条跟进消息',question='这条消息发给谁？',material='我想继续确认这件事。'
      const actionRun=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(actionRun,{candidates:[],audit:[],coach:await stageCoachEvent(actionRun,{target:{operation:'create',title:'跟进事项',source:source(actionRun,'跟进事项')},nodes:[{kind:'fact',source:source(actionRun,fact)}],action:{operation:'create',source:source(actionRun,request),draft:{content:material}}},material)},material,null,signal())
      const questionRun=(await store.startRun(user,second,randomUUID(),'继续。')).run
      await store.finishRun(questionRun,{candidates:[],audit:[],coach:await stageCoachEvent(questionRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision}},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=2',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[request],'the proposed material request is the exact basis even when a fact shares 消息')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:actionRun.source_message_id,quote:request}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'forgetting the material request removes its question')
      assert.ok(after.nodes.some(node=>node.content===fact),'the unrelated no-reply fact remains available')
    })
    await t.test('an explicit material field question binds the action request instead of a same-field fact',async()=>{
      await settings(true)
      const text='收件事项。收件人还没确认。请给我一条跟进消息。',fact='收件人还没确认',request='请给我一条跟进消息',question='收件人是谁？',material='我想继续确认这件事。'
      const actionRun=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(actionRun,{candidates:[],audit:[],coach:await stageCoachEvent(actionRun,{target:{operation:'create',title:'收件事项',source:source(actionRun,'收件事项')},nodes:[{kind:'fact',source:source(actionRun,fact)}],action:{operation:'create',source:source(actionRun,request),draft:{content:material}}},material)},material,null,signal())
      const questionRun=(await store.startRun(user,second,randomUUID(),'继续。')).run
      await store.finishRun(questionRun,{candidates:[],audit:[],coach:await stageCoachEvent(questionRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision}},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=2',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[request],'the explicit recipient field is authorized by the proposed message request')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:actionRun.source_message_id,quote:fact}],true))
      assert.ok((await coachEventView(user,second,created.event!.id))!.asked.includes(question),'forgetting the unrelated recipient fact keeps the action question')
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:actionRun.source_message_id,quote:request}],true))
      assert.ok(!(await coachEventView(user,second,created.event!.id))!.asked.includes(question),'forgetting the authorizing action request removes its question')
    })
    await t.test('a factual state question keeps its fact when a new action shares the artifact noun',async()=>{
      await settings(true)
      const title='现有与新预算表事项',fact='现有预算表已经有三列',request='请另写一份预算表',text=`${title}。${fact}。${request}。`,question='现有预算表有几列？',material='| 项目 | 金额 |\n|---|---|\n|打印|30元|'
      const actionRun=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(actionRun,{candidates:[],audit:[],coach:await stageCoachEvent(actionRun,{target:{operation:'create',title,source:source(actionRun,title)},nodes:[{kind:'fact',source:source(actionRun,fact)}],action:{operation:'create',source:source(actionRun,request),draft:{content:material}}},material)},material,null,signal())
      const questionRun=(await store.startRun(user,second,randomUUID(),'继续。')).run
      const questioned=await store.finishRun(questionRun,{candidates:[],audit:[],coach:await stageCoachEvent(questionRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision}},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,questioned.event!.id,questioned.event!.revision])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[fact],'a topical fact outranks a merely topical action match in the same artifact family')
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:actionRun.source_message_id,quote:fact}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'forgetting the fact removes its factual question')
      assert.equal(after.actions[0]?.status,'proposed','the separately authorized new budget table stays proposed')
    })
    await t.test('an explicitly named artifact field stays with its matching fact instead of an unrelated action',async()=>{
      await settings(true)
      const text='邮件与预算事项。我收到一封邮件，邮件标题是录取通知。请帮我写一份预算表。',fact='我收到一封邮件，邮件标题是录取通知',request='请帮我写一份预算表',question='邮件标题是什么？',material='我可以先整理预算结构。'
      const actionRun=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(actionRun,{candidates:[],audit:[],coach:await stageCoachEvent(actionRun,{target:{operation:'create',title:'邮件与预算事项',source:source(actionRun,'邮件与预算事项')},nodes:[{kind:'fact',source:source(actionRun,fact)}],action:{operation:'create',source:source(actionRun,request),draft:{content:material}}},material)},material,null,signal())
      const questionRun=(await store.startRun(user,second,randomUUID(),'继续。')).run
      await store.finishRun(questionRun,{candidates:[],audit:[],coach:await stageCoachEvent(questionRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision}},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=2',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[fact],'the named email field binds the email fact, not the budget action')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:actionRun.source_message_id,quote:fact}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'forgetting the matching email fact removes its question')
      assert.equal(after.actions[0]?.status,'proposed','the independently sourced budget action remains proposed')
    })
    await t.test('a received-email recipient question stays with the fact instead of a new follow-up email',async()=>{
      await settings(true)
      const title='录取邮件与跟进事项',fact='我收到的录取邮件收件人是王老师',request='请帮我写一封跟进邮件',text=`${title}。${fact}。${request}。`,question='我收到的录取邮件收件人是谁？',material='王老师您好，想跟进确认一下录取安排。'
      const actionRun=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(actionRun,{candidates:[],audit:[],coach:await stageCoachEvent(actionRun,{target:{operation:'create',title,source:source(actionRun,title)},nodes:[{kind:'fact',source:source(actionRun,fact)}],action:{operation:'create',source:source(actionRun,request),draft:{content:material}}},material)},material,null,signal())
      const questionRun=(await store.startRun(user,second,randomUUID(),'继续。')).run
      const questioned=await store.finishRun(questionRun,{candidates:[],audit:[],coach:await stageCoachEvent(questionRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision}},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,questioned.event!.id,questioned.event!.revision])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[fact],'received/acceptance identity keeps the factual email distinct from the requested follow-up email')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:actionRun.source_message_id,quote:fact}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'forgetting the received-email fact removes only its factual question')
      assert.equal(after.actions[0]?.status,'proposed','the separately authorized follow-up email stays proposed')
    })
    await t.test('named report fields do not bind an unrelated plan in the same broad document class',async()=>{
      await settings(true)
      const title='论文与预算方案事项',text=`${title}。论文报告标题是《证据链》。请写一份预算方案。`,fact='论文报告标题是《证据链》',request='请写一份预算方案',question='论文报告标题是什么？',material='预算控制在已确认范围内。'
      const actionRun=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(actionRun,{candidates:[],audit:[],coach:await stageCoachEvent(actionRun,{target:{operation:'create',title,source:source(actionRun,title)},nodes:[{kind:'fact',source:source(actionRun,fact)}],action:{operation:'create',source:source(actionRun,request),draft:{content:material}}},material)},material,null,signal())
      const questionRun=(await store.startRun(user,second,randomUUID(),'继续。')).run
      await store.finishRun(questionRun,{candidates:[],audit:[],coach:await stageCoachEvent(questionRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision}},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=2',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[fact],'the named report field stays with the report fact rather than a budget plan')
    })
    await t.test('a generic non-recipient field stays with a matching fact before an unrelated active action',async()=>{
      await settings(true)
      const text='论文与跟进事项。论文标题是证据链。请给我一条跟进消息。',fact='论文标题是证据链',request='请给我一条跟进消息',question='标题是什么？',material='我可以先写一条跟进消息。'
      const actionRun=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(actionRun,{candidates:[],audit:[],coach:await stageCoachEvent(actionRun,{target:{operation:'create',title:'论文与跟进事项',source:source(actionRun,'论文与跟进事项')},nodes:[{kind:'fact',source:source(actionRun,fact)}],action:{operation:'create',source:source(actionRun,request),draft:{content:material}}},material)},material,null,signal())
      const questionRun=(await store.startRun(user,second,randomUUID(),'继续。')).run
      await store.finishRun(questionRun,{candidates:[],audit:[],coach:await stageCoachEvent(questionRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision}},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=2',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[fact],'a generic title question retains its matching factual authority')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:actionRun.source_message_id,quote:fact}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'forgetting the matching title fact removes its question')
      assert.equal(after.actions[0]?.status,'proposed','the unrelated message action remains proposed')
    })
    await t.test('a growth-only fact owns its follow-up question without a duplicate event fact',async()=>{
      await settings(true)
      const title='课程安排事项',firstText=`${title}。`,firstRun=(await store.startRun(user,second,randomUUID(),firstText)).run
      const first=await store.finishRun(firstRun,{candidates:[],audit:[],coach:await stageCoachEvent(firstRun,{target:{operation:'create',title,source:source(firstRun,title)}},'先按当前安排继续。')},'先按当前安排继续。',null,signal())
      const fact='这周只剩两小时',text=`${fact}。`,question='这两小时先做哪一步？',run=(await store.startRun(user,second,randomUUID(),text)).run
      const clause=buildClauseCatalogue(text).find(item=>item.text===fact)!,factSource=clauseMessageSource(run.source_message_id,clause)
      const growth=await stageGrowthUpdates(run,[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:factSource}],[])
      const coach=await stageCoachEvent(run,{target:{operation:'continue',eventId:first.event!.id,expectedRevision:first.event!.revision},nodes:[{kind:'unknown',question}]},question,growth.changes.map(change=>({content:change.text,source:change.source})))
      const saved=await store.finishRun(run,{candidates:[],audit:[],growth,coach},question,null,signal())
      const unknownId=saved.event!.nodes.find(node=>node.kind==='unknown'&&node.content===question)!.id
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,saved.event!.id,saved.event!.revision])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[fact],'the question binds the canonical growth fact source')
      assert.equal(saved.event!.nodes.filter(node=>node.kind!=='unknown').length,0,'the event store does not duplicate the canonical growth fact')
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:fact,range:{start:clause.start,end:clause.end}}],true))
      assert.ok(!(await coachEventView(user,second,saved.event!.id))!.asked.includes(question),'forgetting the canonical growth source retires its follow-up question')
      assert.equal((await pool.query("SELECT status FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND id=$3",[user,saved.event!.id,unknownId])).rows[0]?.status,'withdrawn','the durable unknown follows the same source control')
    })
    await t.test('coordinated material requests require and retain one exact object source',async()=>{
      await settings(true)
      const text='并列材料事项。请帮我写一份预算表和一条跟进消息。',budgetRequest='一份预算表',messageRequest='一条跟进消息',material='想继续确认进度。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'并列材料事项',source:source(run,'并列材料事项')},action:{operation:'create',source:source(run,messageRequest),draft:{content:material}}},material)},material,null,signal())
      let snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.equal(snapshot.actionSource?.quote,messageRequest,'the action stores only the exact coordinated object that authorized it')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:budgetRequest}],true))
      assert.equal((await coachEventView(user,second,created.event!.id))!.actions[0]?.status,'proposed','controlling the sibling budget request cannot stale the message action')
      snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.equal(snapshot.actionSource?.quote,messageRequest)
    })
    await t.test('poster creation verbs retain each coordinated deliverable source',async()=>{
      await settings(true)
      const title='海报与预算并列事项',text=`${title}。请帮我设计一张海报和一份预算表。`,posterRequest='一张海报',budgetRequest='一份预算表',material='| 项目 | 金额 |\n|---|---|\n|打印|30元|'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const target={operation:'create' as const,title,source:source(run,title)}
      await assert.rejects(stageCoachEvent(run,{target,action:{operation:'create',draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_SOURCE_REQUIRED','multiple coordinated outputs require an exact selected source')
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target,action:{operation:'create',source:source(run,budgetRequest),draft:{content:material}}},material)},material,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.equal(snapshot.actionSource?.quote,budgetRequest)
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:posterRequest}],true))
      assert.equal((await coachEventView(user,second,created.event!.id))!.actions[0]?.status,'proposed','forgetting the poster sibling cannot stale the independently selected budget')
    })
    await t.test('verb-coordinated material requests retain one exact object source',async()=>{
      await settings(true)
      for(const [connector,messageRequest] of [['并写','写一条跟进消息'],['并且写','写一条跟进消息'],['同时写','写一条跟进消息'],['，同时给我','一条跟进消息']]){
        const title=`${connector}并列材料事项`,text=`${title}。请帮我写一份预算表${connector}一条跟进消息。`,budgetRequest='一份预算表',material='想继续确认进度。'
        const run=(await store.startRun(user,second,randomUUID(),text)).run
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,messageRequest),draft:{content:material}}},material)},material,null,signal())
        let snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
        assert.equal(snapshot.actionSource?.quote,messageRequest,`${connector} keeps the exact selected message object`)

        await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:budgetRequest}],true))
        assert.equal((await coachEventView(user,second,created.event!.id))!.actions[0]?.status,'proposed',`${connector} keeps the sibling budget source independent`)
        snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
        assert.equal(snapshot.actionSource?.quote,messageRequest)
      }
    })
    await t.test('mixed create and modify requests retain the exact modified sibling source',async()=>{
      await settings(true)
      const title='混合修改事项',initialText=`${title}。请给我一条跟进消息。`,initialRequest='请给我一条跟进消息',initialMaterial='想确认一下目前进度。'
      const initialRun=(await store.startRun(user,second,randomUUID(),initialText)).run
      const created=await store.finishRun(initialRun,{candidates:[],audit:[],coach:await stageCoachEvent(initialRun,{target:{operation:'create',title,source:source(initialRun,title)},action:{operation:'create',source:source(initialRun,initialRequest),draft:{content:initialMaterial}}},initialMaterial)},initialMaterial,null,signal())
      for(const verb of ['改写','修改','重写']){
        const text=`请帮我写一份预算表并${verb}一条跟进消息。`,sharedOperation='请帮我写',budgetRequest='一份预算表',messageRequest=`${verb}一条跟进消息`,material=`${verb}后的跟进内容。`
        const run=(await store.startRun(user,second,randomUUID(),text)).run,current=(await coachEventView(user,second,created.event!.id))!
        const action=current.actions[0]!
        await assert.rejects(
          stageCoachEvent(run,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision},action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,source:source(run,budgetRequest),draft:{content:material}}},material),
          (error:any)=>error.code==='COACH_ACTION_SOURCE_INVALID',
          `${verb} cannot borrow the create-only budget sibling to modify the message action`,
        )
        const saved=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision},action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,source:source(run,messageRequest),draft:{content:material}}},material)},material,null,signal())
        const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,saved.event!.id,saved.event!.revision])).rows[0].snapshot
        assert.equal(snapshot.actionSource?.quote,messageRequest,`${verb} keeps only the exact modified sibling`)
        assert.deepEqual(snapshot.actionSources?.map((item:any)=>item.quote),[messageRequest],`${verb} owns its local operation instead of depending on the shared create instruction`)
        await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:sharedOperation}],true))
        assert.equal((await coachEventView(user,second,created.event!.id))!.actions[0]?.status,'proposed',`${verb} remains current when the unrelated shared create instruction is forgotten`)
        await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:budgetRequest}],true))
        assert.equal((await coachEventView(user,second,created.event!.id))!.actions[0]?.status,'proposed',`${verb} is independent of the sibling budget request`)
      }
    })
    await t.test('one shared modify operation retains each exact coordinated object',async()=>{
      await settings(true)
      const title='共享修改事项',initialText=`${title}。请给我一条跟进消息。`,initialRequest='请给我一条跟进消息',initialMaterial='想确认一下目前进度。'
      const initialRun=(await store.startRun(user,second,randomUUID(),initialText)).run
      const created=await store.finishRun(initialRun,{candidates:[],audit:[],coach:await stageCoachEvent(initialRun,{target:{operation:'create',title,source:source(initialRun,title)},action:{operation:'create',source:source(initialRun,initialRequest),draft:{content:initialMaterial}}},initialMaterial)},initialMaterial,null,signal())
      const text='请帮我修改一份预算表和一条跟进消息。',sharedOperation='请帮我修改',budgetRequest='一份预算表',messageRequest='一条跟进消息',material='导师您好，想跟进一下目前进度。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run,current=(await coachEventView(user,second,created.event!.id))!,action=current.actions[0]!
      const saved=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision},action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,source:source(run,messageRequest),draft:{content:material}}},material)},material,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,saved.event!.id,saved.event!.revision])).rows[0].snapshot
      assert.equal(snapshot.actionSource?.quote,messageRequest,'the selected message object remains exact under one shared modify verb')
      assert.deepEqual(snapshot.actionSources?.map((item:any)=>item.quote),[sharedOperation,messageRequest],'the message depends on the shared modify operation and its own object only')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:budgetRequest}],true))
      const afterSiblingForget=(await coachEventView(user,second,created.event!.id))!
      assert.equal(afterSiblingForget.actions[0]?.status,'proposed','forgetting the sibling budget object preserves the message modification')
      assert.deepEqual(afterSiblingForget.actions[0]?.requestSources?.map(item=>item.quote),[sharedOperation,messageRequest],'a sibling control cannot switch public lineage back to reconstructed fragments')
    })
    await t.test('an object-fronted local modify retains its complete exact source',async()=>{
      await settings(true)
      const title='把字句修改事项',initialText=`${title}。请给我一条跟进消息。`,initialRequest='请给我一条跟进消息',initialMaterial='想确认一下目前进度。'
      const initialRun=(await store.startRun(user,second,randomUUID(),initialText)).run
      const created=await store.finishRun(initialRun,{candidates:[],audit:[],coach:await stageCoachEvent(initialRun,{target:{operation:'create',title,source:source(initialRun,title)},action:{operation:'create',source:source(initialRun,initialRequest),draft:{content:initialMaterial}}},initialMaterial)},initialMaterial,null,signal())
      const text='请帮我修改预算表，并把跟进消息改短。',budgetRequest='预算表',messageRequest='把跟进消息改短',material='确认目前进度。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run,current=(await coachEventView(user,second,created.event!.id))!,action=current.actions[0]!
      try{
        const saved=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision},action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,source:source(run,messageRequest),draft:{content:material}}},material)},material,null,signal())
        const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,saved.event!.id,saved.event!.revision])).rows[0].snapshot
        assert.equal(snapshot.actionSource?.quote,messageRequest,'把字句 keeps its local operation and exact object in one source')
        assert.deepEqual(snapshot.actionSources?.map((item:any)=>item.quote),[messageRequest],'the local object-fronted operation does not borrow the sibling budget instruction')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:budgetRequest}],true))
      assert.equal((await coachEventView(user,second,created.event!.id))!.actions[0]?.status,'proposed','forgetting the budget sibling preserves the object-fronted message modification')
    })
    await t.test('an object-fronted completed narration cannot authorize a new material action',async()=>{
      await settings(true)
      const title='既往修改叙述',material='导师您好，材料已经提交。'
      for(const narration of ['把跟进消息改短是我昨天已经做完的事','把跟进消息改短是我昨天已经做完并交付的工作','把跟进消息改短是我之前做过的工作']){
        const text=`${title}。${narration}。`,run=(await store.startRun(user,second,randomUUID(),text)).run
        try{
          await assert.rejects(
            stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',draft:{content:material}}},material),
            (error:any)=>error.code==='COACH_ACTION_SOURCE_INVALID',
            'a report of completed work is evidence, not an instruction to create it again',
          )
        }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
      }
    })
    await t.test('a declarative object-fronted option cannot authorize a material action',async()=>{
      await settings(true)
      const title='待评估修改方案',material='精简后的报告内容。'
      for(const option of ['把报告改短是一个待评估方案','把报告改短只是备选方案','把报告改短可能更合适']){
        const text=`${title}。${option}。`,run=(await store.startRun(user,second,randomUUID(),text)).run
        try{
          await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_SOURCE_INVALID','a described option or evaluation is not a directed create/modify request')
        }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
      }
    })
    await t.test('an unpunctuated object-fronted sibling keeps its local operation and source',async()=>{
      await settings(true)
      const title='无标点把字句事项',initialText=`${title}。请给我一条跟进消息。`,initialRequest='请给我一条跟进消息',initialMaterial='想确认一下目前进度。'
      const initialRun=(await store.startRun(user,second,randomUUID(),initialText)).run
      const created=await store.finishRun(initialRun,{candidates:[],audit:[],coach:await stageCoachEvent(initialRun,{target:{operation:'create',title,source:source(initialRun,title)},action:{operation:'create',source:source(initialRun,initialRequest),draft:{content:initialMaterial}}},initialMaterial)},initialMaterial,null,signal())
      const text='请帮我写一份预算表并把跟进消息改短。',budgetRequest='一份预算表',messageRequest='把跟进消息改短',material='确认目前进度。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run,current=(await coachEventView(user,second,created.event!.id))!,action=current.actions[0]!
      const saved=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision},action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,source:source(run,messageRequest),draft:{content:material}}},material)},material,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,saved.event!.id,saved.event!.revision])).rows[0].snapshot
      assert.deepEqual(snapshot.actionSources?.map((item:any)=>item.quote),[messageRequest],'the local 把 operation is independent of the create-only budget sibling')
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:budgetRequest}],true))
      assert.equal((await coachEventView(user,second,created.event!.id))!.actions[0]?.status,'proposed','forgetting the budget request preserves the message modification')
    })
    await t.test('a coordinated action depends on both its shared operation and exact object',async()=>{
      await settings(true)
      const title='共同授权事项',text=`${title}。请帮我写一份预算表和一条跟进消息。`,operation='请帮我写',messageRequest='一条跟进消息',material='想继续确认进度。',question='这条消息发给谁？',reply=material+'\n'+question
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},nodes:[{kind:'unknown',question}],action:{operation:'create',source:source(run,messageRequest),draft:{content:material}}},reply)},reply,null,signal())
      assert.deepEqual(created.event!.actions[0]?.requestSources?.map(item=>item.quote),[operation,messageRequest],'the public lineage excludes the budget sibling and unsplit whole request')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:operation}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.equal(after.actions[0]?.status,'stale','forgetting the shared create instruction invalidates the selected object action')
      assert.ok(!after.asked.includes(question),'a question derived from the invalid action cannot survive through its object alone')
    })
    await t.test('a coordinated request cannot source one artifact from its sibling object',async()=>{
      await settings(true)
      const title='并列产物错配事项',text=`${title}。请帮我写一份预算表和一条跟进消息。`,messageRequest='一条跟进消息'
      for(const material of ['| 项目 | 金额 |\n| --- | ---: |\n| 打印 | 30元 |\n| 合计 | 30元 |','预算表\n项目：打印\n金额：30元','项目报告\n结论：继续推进','导师您好，方便回复进度吗？\n\n| 项目 | 金额 |\n|---|---|\n|打印|30元|']){
        const run=(await store.startRun(user,second,randomUUID(),text)).run
        try{
          await assert.rejects(
            stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,messageRequest),draft:{content:material}}},material),
            (error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH',
          )
        }finally{
          await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')
        }
      }
    })
    await t.test('an explicitly requested communication template may be nested in a report',async()=>{
      await settings(true)
      const title='报告内嵌邮件模板事项',request='请写一份包含跟进邮件模板的报告',text=`${title}。${request}。`,material='报告\n背景：项目已提交\n跟进邮件模板\n老师您好，想跟进一下项目进展。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material)},material,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','an explicitly nested communication artifact remains bound to the report request')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('a negated nested communication template cannot authorize it in a report',async()=>{
      await settings(true)
      const material='报告\n背景：项目已提交\n跟进邮件模板\n老师您好，想跟进一下项目进展。'
      for(const [title,request] of [['排除邮件模板事项','请写一份不包含跟进邮件模板的报告'],['尚未包含邮件事项','请写一份未包含邮件的报告'],['没有包含短信事项','请写一份没有包含短信的报告'],['并非包含消息事项','请写一份并非包含跟进消息的报告'],['后置否定邮件事项','请写一份报告，包含的并非邮件内容']] as const){
        const text=`${title}。${request}。`,run=(await store.startRun(user,second,randomUUID(),text)).run
        try{
          await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',...(request.includes('包含的并非')?{}:{source:source(run,request)}),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','a negated inclusion marker grants no nested artifact authority: '+request)
        }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
      }
    })
    await t.test('a same-family contrast negates only the named artifact occurrence',async()=>{
      await settings(true)
      const title='短信替代邮件事项',request='请写一份报告，包含的并非邮件内容而是短信模板',text=`${title}。${request}。`,material='报告\n背景：项目已提交\n短信模板\n老师您好，想跟进一下项目进展。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',draft:{content:material}}},material)},material,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','the affirmative SMS occurrence remains authorized after the contrasted email occurrence is negated')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
      for(const wrongMaterial of ['报告\n背景：项目已提交\n邮件模板\n老师您好，想跟进一下项目进展。','报告\n背景：项目已提交\n以下是邮件模板：\n老师您好，想跟进一下项目进展。']){
        const wrongRun=(await store.startRun(user,second,randomUUID(),text)).run
        try{
          await assert.rejects(stageCoachEvent(wrongRun,{target:{operation:'create',title,source:source(wrongRun,title)},action:{operation:'create',draft:{content:wrongMaterial}}},wrongMaterial),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','SMS authority cannot authorize an email sibling under either a heading or prose label')
        }finally{await store.terminateRun(user,wrongRun.request_id,'cancelled','TEST_CLEANUP')}
      }
    })
    await t.test('a communication response metric cannot authorize a nested outbound message',async()=>{
      await settings(true)
      const title='邮件回复率报告事项',request='请写一份包含邮件回复率的报告',text=`${title}。${request}。`,material='报告\n邮件回复率：30%\n跟进邮件模板\n老师您好，想跟进一下项目进展。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','reporting a response metric is not permission to compose an outbound message')
      }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
    })
    await t.test('a message-shaped draft cannot use a budget-table request',async()=>{
      await settings(true)
      const title='反向产物错配事项',text=`${title}。请帮我写一份预算表。`,request='请帮我写一份预算表'
      for(const material of ['收件人：导师\n主题：项目进度\n正文：请问目前进展如何？','导师您好，想跟进一下项目进度，方便回复吗？','导师，项目材料已提交，请查收。','导师，材料已提交，望查收。']){
        const run=(await store.startRun(user,second,randomUUID(),text)).run
        try{
          await assert.rejects(
            stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),
            (error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH',
            'structured and natural-language messages both stay bound to a communication request',
          )
        }finally{
          await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')
        }
      }
    })
    await t.test('a budget table cannot use an explicitly requested poster',async()=>{
      await settings(true)
      const title='海报产物错配事项',request='请帮我做一张海报',text=`${title}。${request}。`,material='| 项目 | 金额 |\n|---|---|\n|打印|30元|'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','an unmapped poster request cannot authorize a strongly detected table family')
        const unclassified='打印预算30元，餐费20元，总计50元。'
        await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:unclassified}}},unclassified),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','plain budget prose cannot pass as the requested poster by leaving its artifact family unclassified')
      }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
    })
    await t.test('an explicit foreign artifact heading cannot hide behind an unclassified draft',async()=>{
      await settings(true)
      const title='报告产物反向错配事项',request='请写一份报告',text=`${title}。${request}。`
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        for(const material of ['一张海报','海报：校园开放日','校园开放日海报：欢迎参加','邮件：导师您好，想介绍一下校园开放日。'])await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','an explicitly named foreign artifact head cannot borrow report authority merely because it lacks a multiline body')
      }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
    })
    await t.test('looking up a response state cannot authorize writing a response',async()=>{
      await settings(true)
      const title='回复状态查询',material='导师您好，想确认一下目前进展。'
      for(const query of ['我想了解导师回复情况','请帮我确认导师回复情况','请帮我查看导师回复情况','请帮我查导师回复进度','请帮我查询客户回复情况，然后回复率是多少？','请分析导师回复率，并告诉我结论','请分析导师回复的总数，并告诉我结论','请帮我确认回复导师是否合适','请判断是否应该回复导师','请分析是否应该回复导师','请评估是否应该回复导师','请考虑是否应该回复导师','请分析回复导师的风险','请比较回复导师的利弊','请评估回复导师的影响','请列出回复导师的风险','请说明回复导师的风险','请解释回复导师的影响','请总结回复导师的利弊']){
        const text=title+'。'+query+'。',run=(await store.startRun(user,second,randomUUID(),text)).run
        try{
          await assert.rejects(
            stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',draft:{content:material}}},material),
            (error:any)=>error.code==='COACH_ACTION_SOURCE_INVALID',
            'a status lookup has no authority to create a reply artifact',
          )
        }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
      }
      const direct='请帮我检查回复内容并回复导师',text=title+'。'+direct+'。',run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',draft:{content:material}}},material)},material,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','a later explicit reply operation remains authoritative after a read-only lookup')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
      const mixedTitle='回复风险分析报告',mixedRequest='请分析回复导师的风险并写一份报告',mixedText=mixedTitle+'。'+mixedRequest+'。',mixedMaterial='报告\n主题：回复导师的风险\n内容：尚需核对时机、目的和对方此前要求。',mixedRun=(await store.startRun(user,second,randomUUID(),mixedText)).run
      try{
        const created=await store.finishRun(mixedRun,{candidates:[],audit:[],coach:await stageCoachEvent(mixedRun,{target:{operation:'create',title:mixedTitle,source:source(mixedRun,mixedTitle)},action:{operation:'create',draft:{content:mixedMaterial}}},mixedMaterial)},mixedMaterial,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','masking the reply judgment preserves a different explicit report request in the same clause')
      }catch(error){await store.terminateRun(user,mixedRun.request_id,'cancelled','TEST_CLEANUP');throw error}
      const lookupTitle='回复状态核对报告',lookupRequest='请查看导师回复情况并写一份报告',lookupText=lookupTitle+'。'+lookupRequest+'。',lookupMaterial='报告\n主题：导师回复情况\n内容：当前回复状态仍待核对。',lookupRun=(await store.startRun(user,second,randomUUID(),lookupText)).run
      try{
        const created=await store.finishRun(lookupRun,{candidates:[],audit:[],coach:await stageCoachEvent(lookupRun,{target:{operation:'create',title:lookupTitle,source:source(lookupRun,lookupTitle)},action:{operation:'create',draft:{content:lookupMaterial}}},lookupMaterial)},lookupMaterial,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','masking a response-state lookup preserves a different explicit report request in the same clause')
      }catch(error){await store.terminateRun(user,lookupRun.request_id,'cancelled','TEST_CLEANUP');throw error}
      const compactTitle='无标点回复状态查询',compactRequest='我想查看导师回复情况然后帮我回复导师',compactText=compactTitle+'。'+compactRequest+'。',compactRun=(await store.startRun(user,second,randomUUID(),compactText)).run
      try{
        const created=await store.finishRun(compactRun,{candidates:[],audit:[],coach:await stageCoachEvent(compactRun,{target:{operation:'create',title:compactTitle,source:source(compactRun,compactTitle)},action:{operation:'create',draft:{content:material}}},material)},material,null,signal())
        const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
        assert.equal(snapshot.actionSource?.quote,'帮我回复导师','the reply operation has its own exact source span')
        await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:compactRun.source_message_id,quote:'我想查看导师回复情况'}],true))
        assert.equal((await coachEventView(user,second,created.event!.id))!.actions[0]?.status,'proposed','forgetting the lookup preserves the separately requested reply')
      }catch(error){await store.terminateRun(user,compactRun.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('a clarified later turn can fulfill one exact earlier material request',async()=>{
      await settings(true)
      const title='介绍邮件事项',request='请帮我写一封介绍邮件',firstText=`${title}。${request}。`,question='这封邮件要发给谁？'
      const firstRun=(await store.startRun(user,second,randomUUID(),firstText)).run
      const first=await store.finishRun(firstRun,{candidates:[],audit:[],coach:await stageCoachEvent(firstRun,{target:{operation:'create',title,source:source(firstRun,title)}},question)},question,null,signal())
      const recipient='发给王老师',tone='语气用正式风格',unrelatedTitle='标题是论文《证据链》',unrelatedBoundary='与介绍邮件无关',completed='我已经完成了课程报告',profile='我的专业是软件工程',oldRequest='我记下的旧需求是请写一份预算表',unextracted='我今天感冒了',clarification=oldRequest+'。'+unrelatedTitle+'，'+unrelatedBoundary+'。'+tone+'，'+unrelatedBoundary+'。'+recipient+'。'+completed+'。'+profile+'。'+unextracted+'。',material='您好，想向您简要介绍这个项目，方便时请您指正。'
      const secondRun=(await store.startRun(user,second,randomUUID(),clarification)).run
      const clauses=buildClauseCatalogue(clarification),completedClause=clauses.find(clause=>clause.text===completed)!,profileClause=clauses.find(clause=>clause.text===profile)!
      const growth=await stageGrowthUpdates(secondRun,[
        {target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:clauseMessageSource(secondRun.source_message_id,completedClause)},
      ],[])
      const profileSource=clauseMessageSource(secondRun.source_message_id,profileClause),memorySnapshot=await loadSnapshot(user,second,clarification)
      const memoryChanges=await stageCoachBackground(user,second,secondRun.source_message_id,[{key:'education.major',value:'软件工程',source:profileSource}],memorySnapshot)
      const oldSource=clauseMessageSource(secondRun.source_message_id,clauses.find(clause=>clause.text===oldRequest)!)
      const factProjections=[...growth.changes.map(change=>({content:change.text,source:change.source})),{content:profile,source:profileSource},{content:oldRequest,source:oldSource}]
      let saved:Awaited<ReturnType<typeof store.finishRun>>
      try{saved=await store.finishRun(secondRun,{candidates:[],audit:[],snapshot:memorySnapshot,memoryChanges,growth,coach:await stageCoachEvent(secondRun,{target:{operation:'continue',eventId:first.event!.id,expectedRevision:first.event!.revision},action:{operation:'create',draft:{content:material}}},material,factProjections)},material,null,signal())}
      catch(error){await store.terminateRun(user,secondRun.request_id,'cancelled','TEST_CLEANUP');throw error}
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,saved.event!.id,saved.event!.revision])).rows[0].snapshot
      assert.equal(snapshot.actionSource?.messageId,firstRun.source_message_id,'the original request, not the clarification, authorizes creation')
      assert.equal(snapshot.actionSource?.quote,request)
      assert.ok(!snapshot.actionSources?.some((item:any)=>item.messageId===secondRun.source_message_id&&[recipient,tone].includes(item.quote)),'recipient and style are rendering context, not material authority for the inherited request')
      assert.ok(!snapshot.actionSources?.some((item:any)=>item.quote.includes(unrelatedTitle)||item.quote.includes(unrelatedBoundary)||item.quote.includes(completed)||item.quote.includes(profile)||item.quote.includes(unextracted)),'explicitly unrelated fields, growth, background-memory and omitted optional facts never become mandatory material lineage')
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:secondRun.source_message_id,quote:recipient},{messageId:secondRun.source_message_id,quote:tone}],true))
      assert.equal((await coachEventView(user,second,saved.event!.id))!.actions[0]?.status,'proposed','forgetting unused recipient and style context preserves the material')
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:secondRun.source_message_id,quote:unrelatedTitle}],true))
      assert.equal((await coachEventView(user,second,saved.event!.id))!.actions[0]?.status,'proposed','forgetting an explicitly unrelated title preserves the email')
      const major=(await pool.query("SELECT id,revision FROM memory_items WHERE user_id=$1 AND key='education.major' AND status='active'",[user])).rows[0]
      await applyMemoryAction(user,major.id,{requestId:randomUUID(),expectedRevision:major.revision,action:'correct',value:'信息管理'})
      assert.equal((await coachEventView(user,second,saved.event!.id))!.actions[0]?.status,'proposed','correcting the independent background fact preserves the material')
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:firstRun.source_message_id,quote:request}],true))
      assert.equal((await coachEventView(user,second,saved.event!.id))!.actions[0]?.status,'stale','forgetting the authorizing request invalidates the deferred material')
    })
    await t.test('coordinated sibling requests can be fulfilled independently across turns',async()=>{
      await settings(true)
      const title='并列延期材料事项',text=`${title}。请帮我写一份预算表和一条跟进消息。`,budgetRequest='一份预算表',messageRequest='一条跟进消息',table='| 项目 | 金额 |\n|---|---|\n|打印|30元|'
      const firstRun=(await store.startRun(user,second,randomUUID(),text)).run
      const first=await store.finishRun(firstRun,{candidates:[],audit:[],coach:await stageCoachEvent(firstRun,{target:{operation:'create',title,source:source(firstRun,title)},action:{operation:'create',source:source(firstRun,budgetRequest),draft:{content:table}}},table)},table,null,signal())
      const budgetAction=first.event!.actions[0]!
      const closeRun=(await store.startRun(user,second,randomUUID(),'预算表到这里结束。')).run
      const closed=await store.finishRun(closeRun,{candidates:[],audit:[],coach:await stageCoachEvent(closeRun,{target:{operation:'continue',eventId:first.event!.id,expectedRevision:first.event!.revision},action:{operation:'close',actionId:budgetAction.id,expectedRevision:budgetAction.revision,reason:'预算表已经结束'}},'预算表已结束。')},'预算表已结束。',null,signal())
      const recipient='发给王老师',message='王老师您好，想跟进一下目前进度。',messageRun=(await store.startRun(user,second,randomUUID(),recipient)).run
      let saved:Awaited<ReturnType<typeof store.finishRun>>
      try{saved=await store.finishRun(messageRun,{candidates:[],audit:[],coach:await stageCoachEvent(messageRun,{target:{operation:'continue',eventId:closed.event!.id,expectedRevision:closed.event!.revision},action:{operation:'create',draft:{content:message}}},message)},message,null,signal())}
      catch(error){await store.terminateRun(user,messageRun.request_id,'cancelled','TEST_CLEANUP');throw error}
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,saved.event!.id,saved.event!.revision])).rows[0].snapshot
      assert.equal(snapshot.actionSource?.messageId,firstRun.source_message_id,'the unused sibling keeps the original request authority')
      assert.equal(snapshot.actionSource?.quote,messageRequest,'the budget sibling does not consume the message request')
      assert.ok(!snapshot.actionSources?.some((item:any)=>item.messageId===messageRun.source_message_id&&item.quote===recipient),'the later recipient does not become material authority')
    })
    await t.test('a newer consumed request does not hide an older unconsumed sibling',async()=>{
      await settings(true)
      const title='跨请求延期材料事项',firstText=`${title}。请帮我写一份预算表和一条跟进消息。`,budgetRequest='一份预算表',messageRequest='一条跟进消息',table='| 项目 | 金额 |\n|---|---|\n|打印|30元|'
      const firstRun=(await store.startRun(user,second,randomUUID(),firstText)).run
      const first=await store.finishRun(firstRun,{candidates:[],audit:[],coach:await stageCoachEvent(firstRun,{target:{operation:'create',title,source:source(firstRun,title)},action:{operation:'create',source:source(firstRun,budgetRequest),draft:{content:table}}},table)},table,null,signal())
      const budget=first.event!.actions[0]!,closeBudgetRun=(await store.startRun(user,second,randomUUID(),'预算表已经结束。')).run
      const budgetClosed=await store.finishRun(closeBudgetRun,{candidates:[],audit:[],coach:await stageCoachEvent(closeBudgetRun,{target:{operation:'continue',eventId:first.event!.id,expectedRevision:first.event!.revision},action:{operation:'close',actionId:budget.id,expectedRevision:budget.revision,reason:'预算表已经结束'}},'预算表已结束。')},'预算表已结束。',null,signal())

      const reportRequest='请帮我写一份项目报告',report='项目报告\n\n当前进展：已完成资料整理。',reportRun=(await store.startRun(user,second,randomUUID(),reportRequest)).run
      const reportSaved=await store.finishRun(reportRun,{candidates:[],audit:[],coach:await stageCoachEvent(reportRun,{target:{operation:'continue',eventId:budgetClosed.event!.id,expectedRevision:budgetClosed.event!.revision},action:{operation:'create',source:source(reportRun,reportRequest),draft:{content:report}}},report)},report,null,signal())
      const reportAction=reportSaved.event!.actions.find(action=>action.status==='proposed')!,closeReportRun=(await store.startRun(user,second,randomUUID(),'项目报告也结束。')).run
      const reportClosed=await store.finishRun(closeReportRun,{candidates:[],audit:[],coach:await stageCoachEvent(closeReportRun,{target:{operation:'continue',eventId:reportSaved.event!.id,expectedRevision:reportSaved.event!.revision},action:{operation:'close',actionId:reportAction.id,expectedRevision:reportAction.revision,reason:'项目报告已经结束'}},'项目报告已结束。')},'项目报告已结束。',null,signal())

      const recipient='发给王老师',message='王老师您好，想跟进一下目前进度。',messageRun=(await store.startRun(user,second,randomUUID(),recipient)).run
      let saved:Awaited<ReturnType<typeof store.finishRun>>
      try{saved=await store.finishRun(messageRun,{candidates:[],audit:[],coach:await stageCoachEvent(messageRun,{target:{operation:'continue',eventId:reportClosed.event!.id,expectedRevision:reportClosed.event!.revision},action:{operation:'create',draft:{content:message}}},message)},message,null,signal())}
      catch(error){await store.terminateRun(user,messageRun.request_id,'cancelled','TEST_CLEANUP');throw error}
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,saved.event!.id,saved.event!.revision])).rows[0].snapshot
      assert.equal(snapshot.actionSource?.messageId,firstRun.source_message_id,'the search continues past the newer consumed report request')
      assert.equal(snapshot.actionSource?.quote,messageRequest,'the older unused coordinated sibling remains fulfillable')
      assert.ok(!snapshot.actionSources?.some((item:any)=>item.messageId===messageRun.source_message_id&&item.quote===recipient),'the current recipient does not become material authority')
    })
    await t.test('an unused request remains fulfillable after more than eight later revisions',async()=>{
      await settings(true)
      const title='长期延期材料事项',firstText=`${title}。请帮我写一份预算表和一条跟进消息。`,budgetRequest='一份预算表',messageRequest='一条跟进消息',table='| 项目 | 金额 |\n|---|---|\n|打印|30元|'
      const firstRun=(await store.startRun(user,second,randomUUID(),firstText)).run
      const first=await store.finishRun(firstRun,{candidates:[],audit:[],coach:await stageCoachEvent(firstRun,{target:{operation:'create',title,source:source(firstRun,title)},action:{operation:'create',source:source(firstRun,budgetRequest),draft:{content:table}}},table)},table,null,signal())
      const budget=first.event!.actions[0]!,closeRun=(await store.startRun(user,second,randomUUID(),'预算表已经结束。')).run
      let current=(await store.finishRun(closeRun,{candidates:[],audit:[],coach:await stageCoachEvent(closeRun,{target:{operation:'continue',eventId:first.event!.id,expectedRevision:first.event!.revision},action:{operation:'close',actionId:budget.id,expectedRevision:budget.revision,reason:'预算表已经结束'}},'预算表已结束。')},'预算表已结束。',null,signal())).event!
      for(let index=0;index<8;index++){
        const fact=`第${index+1}条无关进展已经记录`,run=(await store.startRun(user,second,randomUUID(),fact+'。')).run
        current=(await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision},nodes:[{kind:'fact',source:source(run,fact)}]},'已记录这条独立进展。')},'已记录这条独立进展。',null,signal())).event!
      }
      assert.ok(!(current.processTurns??[]).some(turn=>turn.sourceMessageId===firstRun.source_message_id),'the public process window remains bounded to the latest eight revisions')
      const authority=await coachEventViewWithSources(user,second,current.id)
      assert.ok(authority.bindings.processTurns.length<=8,'private process projection is bounded with the public window')
      assert.ok(!authority.bindings.processTurns.some(turn=>turn.sourceMessageId===firstRun.source_message_id),'old revisions are not reconstructed into private process history')
      assert.ok(authority.bindings.pendingActionRequestSources.some(source=>source.messageId===firstRun.source_message_id),'the current action request ledger retains the unconsumed sibling')

      const recipient='发给王老师',material='王老师您好，想跟进一下目前进度。',messageRun=(await store.startRun(user,second,randomUUID(),recipient)).run
      const saved=await store.finishRun(messageRun,{candidates:[],audit:[],coach:await stageCoachEvent(messageRun,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision},action:{operation:'create',draft:{content:material}}},material)},material,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,saved.event!.id,saved.event!.revision])).rows[0].snapshot
      assert.equal(snapshot.actionSource?.messageId,firstRun.source_message_id,'private request authority survives beyond the public eight-revision projection')
      assert.equal(snapshot.actionSource?.quote,messageRequest,'the old unused message sibling remains the exact authorizing request')
      assert.ok(!snapshot.actionSources?.some((item:any)=>item.messageId===messageRun.source_message_id&&item.quote===recipient),'the current recipient does not become material authority')
    })
    await t.test('same-turn recipient and tone remain content dependencies, not action request authority',async()=>{
      await settings(true)
      const title='跟进联络事项',request='请写一条跟进消息',recipient='收件人是李老师',tone='语气正式'
      const text=[title,request,recipient,tone].join('。')+'。',material='跟进消息模板：\n李老师：您好！\n想向您确认项目的最新进展。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      let saved:Awaited<ReturnType<typeof store.finishRun>>
      try{saved=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material)},material,null,signal())}
      catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,saved.event!.id,saved.event!.revision])).rows[0].snapshot
      const dependencies=snapshot.actionFieldSources?.find((field:any)=>field.field==='content')?.sources??[]
      for(const quote of [recipient,tone]){
        assert.ok(dependencies.some((part:any)=>part.messageId===run.source_message_id&&part.quote===quote))
        assert.ok(!snapshot.actionSources?.some((part:any)=>part.quote===quote))
      }
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:tone}],true))
      const withdrawn=await coachEventView(user,second,saved.event!.id)
      assert.equal(withdrawn?.actions[0]?.status,'stale')
      assert.ok(!JSON.stringify(withdrawn?.actions[0]?.draft??null).includes('李老师'))
    })
    await t.test('simultaneously proposed actions keep request history bound to the changed action',async()=>{
      await settings(true)
      const title='多行动来源隔离事项',budgetRequest='请帮我写一份预算表',firstText=`${title}。${budgetRequest}。`,initialTable='| 项目 | 金额 |\n|---|---|\n|打印|30元|'
      const firstRun=(await store.startRun(user,second,randomUUID(),firstText)).run
      const first=await store.finishRun(firstRun,{candidates:[],audit:[],coach:await stageCoachEvent(firstRun,{target:{operation:'create',title,source:source(firstRun,title)},action:{operation:'create',source:source(firstRun,budgetRequest),draft:{content:initialTable}}},initialTable)},initialTable,null,signal())
      const budgetAction=first.event!.actions[0]!

      const recipient='收件人是王老师',messageRequest='请帮我写一条跟进消息',secondText=`${recipient}。${messageRequest}。`,message='王老师您好，想跟进一下目前进度。'
      const secondRun=(await store.startRun(user,second,randomUUID(),secondText)).run
      const recipientClause=buildClauseCatalogue(secondText).find(clause=>clause.text===recipient)!
      const secondSaved=await store.finishRun(secondRun,{candidates:[],audit:[],coach:await stageCoachEvent(secondRun,{target:{operation:'continue',eventId:first.event!.id,expectedRevision:first.event!.revision},nodes:[{kind:'fact',source:clauseMessageSource(secondRun.source_message_id,recipientClause)}],action:{operation:'create',source:source(secondRun,messageRequest),draft:{content:message}}},message)},message,null,signal())
      const messageAction=secondSaved.event!.actions.find(action=>action.id!==budgetAction.id)!
      assert.ok(messageAction,'the second request creates a distinct proposed action')

      const modifyRequest='请把预算表改成两列',changedTable='| 项目 | 预算金额 |\n|---|---|\n|打印|30元|',thirdRun=(await store.startRun(user,second,randomUUID(),modifyRequest)).run
      const thirdSaved=await store.finishRun(thirdRun,{candidates:[],audit:[],coach:await stageCoachEvent(thirdRun,{target:{operation:'continue',eventId:secondSaved.event!.id,expectedRevision:secondSaved.event!.revision},action:{operation:'modify',actionId:budgetAction.id,expectedRevision:budgetAction.revision,source:source(thirdRun,modifyRequest),draft:{content:changedTable}}},changedTable)},changedTable,null,signal())
      const budget=thirdSaved.event!.actions.find(action=>action.id===budgetAction.id)!,followUp=thirdSaved.event!.actions.find(action=>action.id===messageAction.id)!
      assert.ok(!(budget.requestSources??[]).some(item=>item.messageId===secondRun.source_message_id),'a node-source message used by the event cannot donate the other action request to the budget action')
      assert.ok((budget.requestSources??[]).some(item=>item.messageId===firstRun.source_message_id),'the original budget request remains in its own lineage')
      assert.ok((budget.requestSources??[]).some(item=>item.messageId===thirdRun.source_message_id),'the exact budget modification remains in its own lineage')
      assert.ok((followUp.requestSources??[]).some(item=>item.messageId===secondRun.source_message_id),'the follow-up request remains bound to the action it created')

      const question='预算表要几列？',questionRun=(await store.startRun(user,second,randomUUID(),'继续。')).run
      const questioned=await store.finishRun(questionRun,{candidates:[],audit:[],coach:await stageCoachEvent(questionRun,{target:{operation:'continue',eventId:thirdSaved.event!.id,expectedRevision:thirdSaved.event!.revision}},question)},question,null,signal())
      const questionSnapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,questioned.event!.id,questioned.event!.revision])).rows[0].snapshot
      assert.ok(questioned.event!.asked.includes(question),'a question naming one of multiple active materials remains grounded')
      const questionSources=questionSnapshot.questionBindings?.find((binding:any)=>binding.question===question)?.sources??[]
      assert.ok(questionSources.some((item:any)=>item.messageId===thirdRun.source_message_id),'the budget question binds the current budget request lineage')
      assert.ok(!questionSources.some((item:any)=>item.messageId===secondRun.source_message_id),'the budget question does not borrow the simultaneously proposed follow-up action')

      await pool.query("UPDATE coach_event_revisions SET snapshot=(snapshot-'actionChange'-'actionId'-'actionSource'-'actionSources'-'actionFieldSources') WHERE user_id=$1 AND event_id=$2",[user,questioned.event!.id])
      const budgetSourceIds=(await pool.query('SELECT source_message_ids FROM coach_actions WHERE user_id=$1 AND id=$2',[user,budgetAction.id])).rows[0].source_message_ids as string[]
      assert.ok(budgetSourceIds.includes(secondRun.source_message_id),'the synthetic legacy action carries an unrelated node-source message and reproduces the ambiguous old state')
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:secondRun.source_message_id,quote:messageRequest}],true))
      const legacyBudget=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,budgetAction.id])).rows[0]
      assert.equal(legacyBudget.status,'proposed','ambiguous legacy request inference cannot stale the independent budget action')
      assert.ok(legacyBudget.draft,'the independent legacy budget draft is preserved')
    })
    await t.test('an exact node occurrence does not turn a duplicate recipient into action authority',async()=>{
      await settings(true)
      const title='重复收件人延期邮件事项',request='请帮我写一封介绍邮件',firstText=`${title}。${request}。`,question='这封邮件要发给谁？'
      const firstRun=(await store.startRun(user,second,randomUUID(),firstText)).run
      const first=await store.finishRun(firstRun,{candidates:[],audit:[],coach:await stageCoachEvent(firstRun,{target:{operation:'create',title,source:source(firstRun,title)}},question)},question,null,signal())
      const recipient='发给王老师',duplicateText=`${recipient}；${recipient}`,clauses=buildClauseCatalogue(duplicateText).filter(clause=>clause.text===recipient)
      assert.equal(clauses.length,2,'the synthetic input exposes two independently selectable occurrences')
      const secondRun=(await store.startRun(user,second,randomUUID(),duplicateText)).run,material='王老师您好，想向您简要介绍这个项目。'
      const saved=await store.finishRun(secondRun,{candidates:[],audit:[],coach:await stageCoachEvent(secondRun,{target:{operation:'continue',eventId:first.event!.id,expectedRevision:first.event!.revision},nodes:[{kind:'fact',source:clauseMessageSource(secondRun.source_message_id,clauses[0]!)}],action:{operation:'create',draft:{content:material}}},material)},material,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,saved.event!.id,saved.event!.revision])).rows[0].snapshot
      const currentSources=(snapshot.actionSources??[]).filter((item:any)=>item.messageId===secondRun.source_message_id)
      assert.deepEqual(currentSources,[],'neither duplicate recipient occurrence becomes material authority')
    })
    await t.test('a staged deferred action cannot commit after its exact request source is corrected',async()=>{
      await settings(true)
      const title='更正中的延期邮件事项',request='请帮我写一封介绍邮件',firstText=`${title}。${request}。`,question='这封邮件要发给谁？'
      const firstRun=(await store.startRun(user,second,randomUUID(),firstText)).run
      const first=await store.finishRun(firstRun,{candidates:[],audit:[],coach:await stageCoachEvent(firstRun,{target:{operation:'create',title,source:source(firstRun,title)}},question)},question,null,signal())
      const requestStart=firstText.indexOf(request),memoryId=randomUUID()
      await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','currentConcern',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,user,JSON.stringify(request),JSON.stringify([{type:'message',conversationId:second,messageId:firstRun.source_message_id,quote:request,range:{start:requestStart,end:requestStart+request.length}}])])
      const recipient='发给王老师',material='王老师您好，想向您简要介绍这个项目。',secondRun=(await store.startRun(user,second,randomUUID(),recipient)).run
      const coach=await stageCoachEvent(secondRun,{target:{operation:'continue',eventId:first.event!.id,expectedRevision:first.event!.revision},action:{operation:'create',draft:{content:material}}},material)
      await applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'correct',value:'不再需要这封介绍邮件'})
      try{
        await assert.rejects(store.finishRun(secondRun,{candidates:[],audit:[],coach},material,null,signal()),(error:any)=>error.code==='COACH_ACTION_SOURCE_INVALID','commit must revalidate the corrected process-only request even when the event revision itself did not change')
      }finally{await store.terminateRun(user,secondRun.request_id,'cancelled','TEST_CLEANUP')}
      assert.equal((await coachEventView(user,second,first.event!.id))!.actions.length,0,'the obsolete deferred action is never persisted')
    })
    await t.test('a deferred modify request remains authoritative when a later turn only supplies its recipient',async()=>{
      await settings(true)
      const title='延期修改消息事项',createRequest='请给我一条跟进消息',initialMaterial='跟进消息模板：\n导师您好，想确认一下目前进展。'
      const firstText=`${title}。${createRequest}。`,firstRun=(await store.startRun(user,second,randomUUID(),firstText)).run
      const created=await store.finishRun(firstRun,{candidates:[],audit:[],coach:await stageCoachEvent(firstRun,{target:{operation:'create',title,source:source(firstRun,title)},action:{operation:'create',source:source(firstRun,createRequest),draft:{content:initialMaterial}}},initialMaterial)},initialMaterial,null,signal())
      const modifyRequest='请把这条消息改得更正式',question='要发给谁？',secondRun=(await store.startRun(user,second,randomUUID(),modifyRequest)).run
      const requested=await store.finishRun(secondRun,{candidates:[],audit:[],coach:await stageCoachEvent(secondRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision}},question)},question,null,signal())
      const recipient='收件人是王老师',thirdRun=(await store.startRun(user,second,randomUUID(),recipient)).run,current=requested.event!,action=current.actions[0]!,material='跟进消息模板：\n王老师：您好！\n想正式确认一下目前进展。'
      let saved:Awaited<ReturnType<typeof store.finishRun>>
      try{saved=await store.finishRun(thirdRun,{candidates:[],audit:[],coach:await stageCoachEvent(thirdRun,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision},action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,draft:{content:material}}},material)},material,null,signal())}
      catch(error){await store.terminateRun(user,thirdRun.request_id,'cancelled','TEST_CLEANUP');throw error}
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,saved.event!.id,saved.event!.revision])).rows[0].snapshot
      assert.equal(snapshot.actionSource?.messageId,secondRun.source_message_id,'the deferred modify request, not the later recipient, authorizes the edit')
      assert.equal(snapshot.actionSource?.quote,modifyRequest)
      assert.ok(!snapshot.actionSources?.some((item:any)=>item.messageId===thirdRun.source_message_id&&item.quote===recipient),'the later recipient does not become modification authority')
      assert.ok(snapshot.actionFieldSources?.find((field:any)=>field.field==='content')?.sources.some((item:any)=>item.messageId===thirdRun.source_message_id&&item.quote===recipient),'the displayed greeting depends on the exact recipient clarification')
      const authority=await coachEventViewWithSources(user,second,saved.event!.id)
      assert.deepEqual(authority.bindings.pendingActionRequestSources,[],'the request ledger has no unconsumed material source after the deferred edit: '+JSON.stringify(authority.bindings))
      const unrelatedRun=(await store.startRun(user,second,randomUUID(),'今天有点累。')).run,latest=saved.event!,latestAction=latest.actions[0]!
      try{
        await assert.rejects(stageCoachEvent(unrelatedRun,{target:{operation:'continue',eventId:latest.id,expectedRevision:latest.revision},action:{operation:'modify',actionId:latestAction.id,expectedRevision:latestAction.revision,draft:{content:'不应借用已消费请求的再次修改。'}}},'不应借用已消费请求的再次修改。'),(error:any)=>error?.code==='COACH_ACTION_SOURCE_INVALID','a fulfilled deferred request is consumed and cannot authorize an unrelated later rewrite')
      }finally{await store.terminateRun(user,unrelatedRun.request_id,'cancelled','SYNTHETIC_CONSUMED_DEFERRED_REQUEST')}
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:thirdRun.source_message_id,quote:recipient}],true))
      const withdrawn=await coachEventView(user,second,saved.event!.id)
      assert.equal(withdrawn!.actions[0]?.status,'stale','forgetting the used recipient removes the draft with that greeting')
      assert.ok(!JSON.stringify(withdrawn!.actions[0]?.draft??null).includes('王老师'))
    })
    await t.test('deferred style and format stay in the draft’s exact content provenance',async()=>{
      await settings(true)
      const title='延期格式修改事项',createRequest='请给我一条跟进消息',original='想确认一下目前进展。'
      const first=(await store.startRun(user,second,randomUUID(),title+'。'+createRequest+'。')).run
      const created=await store.finishRun(first,{candidates:[],audit:[],coach:await stageCoachEvent(first,{target:{operation:'create',title,source:source(first,title)},action:{operation:'create',source:source(first,createRequest),draft:{content:original}}},original)},original,null,signal())
      const modify='请把这条消息改得更正式',question='想用什么格式？',request=(await store.startRun(user,second,randomUUID(),modify)).run
      const stagedRequest=await stageCoachEvent(request,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision}},question)
      const waiting=await store.finishRun(request,{candidates:[],audit:[],coach:stagedRequest},question,null,signal())
      const tone='风格自然',format='格式用两行',material='想正式确认一下\n目前进展。'
      const run=(await store.startRun(user,second,randomUUID(),tone+'。'+format+'。')).run
      const event=waiting.event!,action=event.actions[0]!
      let saved:Awaited<ReturnType<typeof store.finishRun>>
      try{
        const coach=await stageCoachEvent(run,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,draft:{content:material}}},material)
        saved=await store.finishRun(run,{candidates:[],audit:[],coach},material,null,signal())
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,event.id,saved.event!.revision])).rows[0].snapshot
      const dependencies=snapshot.actionFieldSources?.find((field:any)=>field.field==='content')?.sources??[]
      assert.equal(snapshot.actionSource?.messageId,request.source_message_id)
      for(const quote of [tone,format]){
        assert.ok(dependencies.some((part:any)=>part.messageId===run.source_message_id&&part.quote===quote),'the current draft depends on '+quote)
        assert.ok(!snapshot.actionSources?.some((part:any)=>part.quote===quote))
      }
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:format}],true))
      assert.equal((await coachEventView(user,second,event.id))?.actions.find(item=>item.id===action.id)?.status,'stale')
    })
    await t.test('shared deliverable interpretation accepts natural poster creation verbs',async()=>{
      await settings(true)
      for(const verb of ['生成','设计','画','产出']){
        const title=`${verb}海报事项`,request=`请帮我${verb}一张海报`,text=`${title}。${request}。`,material='海报\n主题：校园项目开放日\n文案：欢迎来现场了解项目。'
        const run=(await store.startRun(user,second,randomUUID(),text)).run
        try{
          const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material)},material,null,signal())
          assert.equal(created.event!.actions[0]?.status,'proposed',verb+' uses the same exact create-request source chain')
        }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
      }
      const title='复合海报标题事项',request='请设计一张海报',text=`${title}。${request}。`,material='海报文案\n主题：校园开放日\n内容：欢迎参加。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material)},material,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','poster copy nested under a visual heading is not a second unauthorized deliverable')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
      const singleLineTitle='单行海报标题事项',singleLineRequest='请设计一张海报',singleLineText=`${singleLineTitle}。${singleLineRequest}。`,singleLineMaterial='校园开放日海报：欢迎参加',singleLineRun=(await store.startRun(user,second,randomUUID(),singleLineText)).run
      try{
        const created=await store.finishRun(singleLineRun,{candidates:[],audit:[],coach:await stageCoachEvent(singleLineRun,{target:{operation:'create',title:singleLineTitle,source:source(singleLineRun,singleLineTitle)},action:{operation:'create',source:source(singleLineRun,singleLineRequest),draft:{content:singleLineMaterial}}},singleLineMaterial)},singleLineMaterial,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','a bounded titled single-line poster satisfies the same visual family used to reject a foreign poster')
      }catch(error){await store.terminateRun(user,singleLineRun.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('a transitive reply request cannot authorize an unrelated table',async()=>{
      await settings(true)
      const title='回复客户事项',request='请帮我回复客户',text=title+'。'+request+'。',material='| 项目 | 金额 |\n|---|---|\n|打印|30元|'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','replying to a named recipient is a communication artifact request')
        const reply='客户您好，方便确认一下目前的进展吗？'
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:reply}}},reply)},reply,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','the same transitive request accepts a genuine reply artifact')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('a reply request to a named recipient cannot authorize an unrelated table',async()=>{
      await settings(true)
      const title='回复具名老师事项',request='请帮我回复王老师',text=title+'。'+request+'。',material='| 项目 | 金额 |\n|---|---|\n|打印|30元|'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','a named recipient remains a communication artifact request')
        const reply='收到，我会在周五前提交。'
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:reply}}},reply)},reply,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','an acknowledgement with an explicit commitment is a genuine reply artifact')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('a direct reply request stays a communication artifact when its subject names a budget table',async()=>{
      await settings(true)
      const title='回复预算表问题事项',request='请回复导师关于预算表的问题',text=title+'。'+request+'。',reply='导师您好，关于预算表的问题，我的说明如下。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:reply}}},reply)},reply,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','the referenced table remains the subject of a genuine reply, not the requested output head')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('a reply request about a report cannot authorize the report itself',async()=>{
      await settings(true)
      const title='回复报告事项',request='请帮我回复这份报告',text=title+'。'+request+'。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        for(const material of ['项目报告\n结论：继续推进。','项目报告\n结论：通过。\n收到，我会处理。'])await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','a referenced report cannot become output even beside a valid reply')
      }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
    })
    await t.test('a report subject cannot authorize its referenced table as the whole deliverable',async()=>{
      await settings(true)
      const title='预算表分析报告事项',request='请帮我写一份分析预算表的报告',text=title+'。'+request+'。',table='| 项目 | 金额 |\n|---|---|\n|打印|30元|'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:table}}},table),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','a referenced budget table is not the requested report head')
        const report='预算表分析报告\n结论：预算需要调整。\n| 项目 | 金额 |\n|---|---|\n|打印|30元|'
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:report}}},report)},report,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','the requested report may still contain its nested source table')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('the final repeated artifact occurrence remains the requested output head',async()=>{
      await settings(true)
      const title='重复报告词事项',request='请根据项目报告写一份预算表分析报告',text=title+'。'+request+'。',table='| 项目 | 金额 |\n|---|---|\n|打印|30元|'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:table}}},table),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','an earlier report mention cannot hide the final report head')
        const report='项目分析报告\n结论：预算需要调整。'
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:report}}},report)},report,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','the final report head accepts a report without requiring a table')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('a trailing reference clause does not replace the requested report head',async()=>{
      await settings(true)
      const title='报告参考表格事项',request='请写一份报告并参考预算表',text=title+'。'+request+'。',table='| 项目 | 金额 |\n|---|---|\n|打印|30元|'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:table}}},table),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','reference material cannot replace the preceding deliverable head')
        const report='项目分析报告\n结论：预算需要调整。'
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:report}}},report)},report,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','the report remains the requested output')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('a comma-free attachment clause keeps the preceding report as the requested output head',async()=>{
      await settings(true)
      const title='报告附预算表事项',request='请写一份报告并附上预算表',text=title+'。'+request+'。',report='项目分析报告\n结论：预算需要调整。\n| 项目 | 金额 |\n|---|---|\n|打印|30元|'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:report}}},report)},report,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','并附上 introduces nested attachment content rather than a new primary output head')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('a verbal report predicate is not a later artifact head',async()=>{
      await settings(true)
      const title='预算表报告结果事项',request='请写预算表并报告结果',text=title+'。'+request+'。',table='| 项目 | 金额 |\n|---|---|\n|打印|30元|'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:table}}},table)},table,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','报告结果 is a predicate after the requested table, not a report deliverable')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('a standalone interview question is not a direct-message artifact',async()=>{
      await settings(true)
      const title='访谈问题事项',request='请帮我写一个访谈问题',text=title+'。'+request+'。',material='你上次遇到什么困难？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material)},material,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','a requested interview question remains a copy artifact')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('a named addressee plus thanks and commitment is a genuine reply artifact',async()=>{
      await settings(true)
      const title='感谢承诺回复事项',request='请帮我回复王老师',text=title+'。'+request+'。',reply='王老师，谢谢您的提醒，我会在周五前提交。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:reply}}},reply)},reply,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','a polite addressed commitment remains persistable communication')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('a bare named addressee plus commitment is a genuine reply artifact',async()=>{
      await settings(true)
      const title='普通姓名回复事项',request='请帮我回复小王',text=title+'。'+request+'。',reply='小王，谢谢你的提醒，我会在周五前提交。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:reply}}},reply)},reply,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','a bounded ordinary name does not require an artificial role title')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('a report can quote a second-person interview question without becoming a message',async()=>{
      await settings(true)
      for(const [index,material] of ['访谈报告\n结论：受访者问“你们什么时候上线？”','访谈报告\n结论：受访者问你为什么延期？','访谈报告\n受访者问你为什么延期？','访谈报告\n问题：你为什么延期？','访谈报告\n正文：受访者问你为什么延期？','访谈报告\n| 指标 | 结果 |\n|---|---|\n| 完成率 | 20% |'].entries()){
        const title=`访谈报告事项${index}`,text=`${title}。请写一份访谈报告。`,request='请写一份访谈报告',run=(await store.startRun(user,second,randomUUID(),text)).run
        try{
          const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material)},material,null,signal())
          assert.equal(created.event!.actions[0]?.status,'proposed','reported dialogue does not add an unauthorized communication family')
        }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
      }
    })
    await t.test('a headingless structured report can contain a nested table',async()=>{
      await settings(true)
      const title='无标题调研报告事项',request='请写一份用户调研报告',text=title+'。'+request+'。',material='结论：受访者更关注价格。\n| 指标 | 结果 |\n|---|---|\n|价格敏感|高|'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material)},material,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','a report section plus table remains one report artifact')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('an imperative recommendation remains inside a headingless report section',async()=>{
      await settings(true)
      const title='无标题报告建议事项',request='请写一份用户调研报告',text=title+'。'+request+'。',material='结论：用户更关注价格。\n建议：请导师确认预算。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material)},material,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','a report recommendation is not an independent direct message')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('a single report field scopes an addressed commitment as report content',async()=>{
      await settings(true)
      const title='单行报告结论事项',request='请写一份用户调研报告',text=title+'。'+request+'。',material='结论：王老师，谢谢您的提醒，我会在周五前提交。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material)},material,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','the field label prevents quoted report content from becoming a direct message')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('ordinary recommendation prose remains inside a headed report',async()=>{
      await settings(true)
      const title='报告普通建议事项',request='请写一份项目报告',text=title+'。'+request+'。',material='项目报告\n结论，建议请导师确认预算。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material)},material,null,signal())
        assert.equal(created.event!.actions[0]?.status,'proposed','a recommendation sentence is report prose without an independent message shape')
      }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
    })
    await t.test('ordinary report findings followed by a commitment remain report prose',async()=>{
      await settings(true)
      const request='请写一份项目报告'
      for(const [index,material] of ['项目报告\n研究发现，我们会在周五前完成测试。','项目报告\n研究发现，我会在周五前完成测试。'].entries()){
        const title=`报告发现事项${index}`,text=title+'。'+request+'。',run=(await store.startRun(user,second,randomUUID(),text)).run
        try{
          const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material)},material,null,signal())
          assert.equal(created.event!.actions[0]?.status,'proposed','a discourse lead is not fabricated into a message recipient')
        }catch(error){await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP');throw error}
      }
    })
    await t.test('a headingless report cannot conceal an appended greeting message',async()=>{
      await settings(true)
      const title='无标题报告追加消息事项',request='请写一份用户调研报告',text=title+'。'+request+'。',material='结论：受访者更关注价格。\n建议：先小范围试点。\n导师您好，材料已提交。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','an appended greeting remains an independent communication artifact')
      }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
    })
    await t.test('a long report cannot conceal an appended direct message past the first 500 characters',async()=>{
      await settings(true)
      const title='长报告追加消息事项',request='请写一份项目报告',text=title+'。'+request+'。',body='这是经过核验的正常项目分析。'.repeat(55),plainBody='这是经过核验的正常项目分析'.repeat(55)
      for(const material of [`项目报告\n${body}\n导师您好，请确认下一步？`,`项目报告\n${body}导师您好，请确认下一步？`,`项目报告\n${plainBody}导师您好，请确认下一步？`]){
        assert.ok(material.length>500,'the regression fixture must cross the old global scan limit')
        const run=(await store.startRun(user,second,randomUUID(),text)).run
        try{
          await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','message-shaped content remains unauthorized regardless of document length or line breaks')
        }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
      }
    })
    await t.test('a headingless report cannot conceal an appended declarative message',async()=>{
      await settings(true)
      const title='无标题报告追加称呼消息事项',request='请写一份用户调研报告',text=title+'。'+request+'。',material='结论：用户更关注价格。\n建议：先小范围试点。\n导师，材料已提交，望查收。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','an appended addressee line remains an independent communication artifact')
      }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
    })
    await t.test('a report body field cannot hide an unauthorized direct message',async()=>{
      await settings(true)
      const title='访谈报告正文事项',request='请写一份访谈报告',text=`${title}。${request}。`,material='访谈报告\n正文：导师您好，请确认下一步？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','a message-shaped body remains a communication artifact under a report heading')
      }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
    })
    await t.test('report vocabulary cannot authorize an appended direct message',async()=>{
      await settings(true)
      for(const [index,metric] of ['回复率','回复比例','客户回复分析','客户回复情况','客户回复分布','客户回复结果分析','客户回复总数','客户回复总量','客户回复汇总','客户回复的总数','客户回复 的总数'].entries()){
        const title=`回复统计报告事项${index}`,request=`请写一份分析${metric}的用户调研报告`,text=`${title}。${request}。`,material=`用户调研报告\n结论：${metric}20%\n导师您好，请确认下一步？`
        const run=(await store.startRun(user,second,randomUUID(),text)).run
        try{
          await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH',`${metric} is report vocabulary, not authority for a communication artifact`)
        }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
      }
    })
    await t.test('a response metric after a lookup cannot authorize reply material',async()=>{
      await settings(true)
      const title='回复率查询事项',request='回复率是多少',text=`${title}。请查询客户回复状态然后${request}？`,material='导师您好，请确认下一步？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_SOURCE_INVALID','a response metric remains information lookup, never authority to write a reply')
      }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
    })
    await t.test('causal analysis of someone’s reply cannot authorize a draft',async()=>{
      const title='回复原因事项',request='请帮我分析导师回复慢的原因',material='导师您好，请确认下一步？'
      const run=(await store.startRun(user,second,randomUUID(),`${title}。${request}。`)).run
      try{
        assert.equal(deliverableIntent(request,'create'),false)
        assert.equal(deliverableIntent(request+'，然后请帮我回复导师。','create'),true)
        await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_SOURCE_INVALID')
      }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
    })
    await t.test('guidance about making a poster is not an instruction to create it',async()=>{
      const title='海报学习事项',request='请告诉我如何设计一张海报',material='海报：校园开放日'
      assert.equal(deliverableIntent(request+'？','create'),false)
      assert.equal(deliverableIntent(request+'，然后请帮我设计一张海报。','create'),true)
      assert.equal(deliverableIntent(request+'然后给我设计一张海报。','create'),true)
      const run=(await store.startRun(user,second,randomUUID(),title+'。'+request+'？')).run
      try{
        await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_SOURCE_INVALID')
      }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
    })
    await t.test('reverse-order fact projections cannot authorize a current material request',async()=>{
      const title='旧需求与当前行动事项',old='我记下的旧需求是请写一份预算表',major='我的专业是软件工程',style='风格自然',request='现在请写一条跟进消息'
      const text=[title,old,major,style,request].join('；')+'。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const facts=[style,major,old].map(quote=>({content:quote,source:clauseMessageSource(run.source_message_id,buildClauseCatalogue(text).find(clause=>clause.text===quote)!)}))
      const target={operation:'create' as const,title,source:source(run,title)}
      const oldDraft='| 项目 | 金额 |\n|---|---|\n|打印|30元|',draft='您好，想跟进一下目前进展。'
      try{
        await assert.rejects(stageCoachEvent(run,{target,action:{operation:'create',source:source(run,old),draft:{content:oldDraft}}},oldDraft,facts),(error:any)=>error.code==='COACH_ACTION_SOURCE_INVALID')
        const staged=await stageCoachEvent(run,{target,action:{operation:'create',source:source(run,request),draft:{content:draft}}},draft,facts)
        assert.ok(staged.actionValidation,'the independent current instruction still authorizes its draft')
        const saved=await store.finishRun(run,{candidates:[],audit:[],coach:staged},draft,null,signal())
        const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,saved.event!.id,saved.event!.revision])).rows[0].snapshot
        assert.ok(!snapshot.actionFieldSources?.some((field:any)=>field.sources.some((part:any)=>part.quote===style)),'a projected style description is not a rendering directive')
      }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
    })
    await t.test('a referenced message subject cannot authorize appended communication output',async()=>{
      await settings(true)
      const title='跟进消息分析报告事项',request='请写一份分析跟进消息的报告',text=title+'。'+request+'。',material='项目报告\n结论：跟进消息需要更具体。\n导师您好，请确认下一步？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      try{
        await assert.rejects(stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,request),draft:{content:material}}},material),(error:any)=>error.code==='COACH_ACTION_ARTIFACT_MISMATCH','a referenced message is report subject matter, not a second deliverable')
      }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
    })
    await t.test('deleting a cross-conversation action source revokes its event authority',async()=>{
      await settings(true)
      const sourceConversation=randomUUID(),title='跨会话来源删除事项',request='请给我一条跟进消息',material='导师您好，请确认下一步？'
      await store.createConversation(user,{id:sourceConversation,title:'SYNTHETIC deletable action source'})
      const opening=(await store.startRun(user,conversation,randomUUID(),title)).run
      const created=await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:source(opening,title)}},'已记录。')},'已记录。',null,signal())
      const actionRun=(await store.startRun(user,sourceConversation,randomUUID(),request)).run
      const continued=await store.finishRun(actionRun,{candidates:[],audit:[],coach:await stageCoachEvent(actionRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision},action:{operation:'create',source:source(actionRun,request),draft:{content:material}}},material)},material,null,signal())
      assert.equal(continued.event!.actions[0]?.status,'proposed')
      await store.deleteConversation(user,sourceConversation)
      const after=(await coachEventView(user,conversation,created.event!.id))!
      assert.equal(after.actions[0]?.status,'stale','the deleted conversation cannot keep its action proposed')
      assert.equal(after.actions[0]?.draft,null,'material derived from the deleted conversation is no longer readable')
    })
    await t.test('nested coordination retains each complete artifact request without splitting its internal subject',async()=>{
      await settings(true)
      const text='嵌套并列材料事项。请帮我写一份就业和升学对比报告和一条跟进消息。',reportRequest='一份就业和升学对比报告',messageRequest='一条跟进消息',material='想继续确认进度。'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const catalogue=buildClauseCatalogue(text)
      const parsed=parseActionCoachTurn(JSON.stringify({reply:material,event:{target:{operation:'create',title:'嵌套并列材料事项',source:{clauseId:catalogue[0]!.clauseId}},action:{operation:'create',source:source(run,messageRequest),draft:{content:material}}}}),{sourceCatalogue:{messageId:run.source_message_id,catalogue,text,canonicalFacts:true}})
      assert.equal(parsed.event?.action&&'source' in parsed.event.action?parsed.event.action.source?.quote:null,messageRequest,'the provider contract retains an exact sub-clause action selector')
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,parsed.event!,material)},material,null,signal())
      let snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.equal(snapshot.actionSource?.quote,messageRequest,'the selected message request remains an exact source despite an internal conjunction in its sibling')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:reportRequest}],true))
      assert.equal((await coachEventView(user,second,created.event!.id))!.actions[0]?.status,'proposed','forgetting the complete report request cannot stale the message action')
      snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.equal(snapshot.actionSource?.quote,messageRequest)
    })
    await t.test('a transitive reply remains an exact sibling in either coordination order',async()=>{
      await settings(true)
      for(const [index,text] of ['回复并预算事项。请帮我回复客户并写一份预算表。','预算并回复事项。请帮我写一份预算表并回复客户。'].entries()){
        const title=index===0?'回复并预算事项':'预算并回复事项',replyRequest='回复客户',tableRequest='写一份预算表',material='客户您好，方便确认一下目前的进展吗？'
        const run=(await store.startRun(user,second,randomUUID(),text)).run
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,replyRequest),draft:{content:material}}},material)},material,null,signal())
        const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
        assert.equal(snapshot.actionSource?.quote,replyRequest,'the reply action retains only its exact coordinated object')

        await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:tableRequest}],true))
        assert.equal((await coachEventView(user,second,created.event!.id))!.actions[0]?.status,'proposed','forgetting the table sibling cannot stale the reply action')
      }
    })
    await t.test('one compound comparison artifact cannot be selected as a false coordinated sibling',async()=>{
      await settings(true)
      for(const [index,request,falseSibling] of [
        ['0','一份就业报告和升学报告的对比表','升学报告的对比表'],
        ['1','一份就业报告和升学方案的对比表','升学方案的对比表'],
      ]){
        const title=`单一对比表事项${index}`,text=`${title}。请帮我写${request}。`,material='就业与升学：待核对。'
        const run=(await store.startRun(user,second,randomUUID(),text)).run
        try{
          await assert.rejects(
            stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},action:{operation:'create',source:source(run,falseSibling),draft:{content:material}}},material),
            (error:any)=>error.code==='COACH_ACTION_SOURCE_INVALID',
          )
        }finally{
          await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')
        }
      }
    })
    await t.test('a same-turn action-only unknown binds the exact material request',async()=>{
      await settings(true)
      const text='同轮动作事项。请给我一条跟进消息。',request='请给我一条跟进消息',question='这条消息发给谁？',material='我想继续确认这件事。',reply=material+'\n'+question
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'同轮动作事项',source:source(run,'同轮动作事项')},nodes:[{kind:'unknown',question}],action:{operation:'create',source:source(run,request),draft:{content:material}}},reply)},reply,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[request],'an action-only unknown uses the exact request rather than the title')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:request}],true))
      assert.ok(!(await coachEventView(user,second,created.event!.id))!.asked.includes(question),'forgetting the request removes its same-turn question')
    })
    await t.test('a legacy action question with missing provenance fails closed instead of borrowing the title',async()=>{
      await settings(true)
      const text='旧版课程事项。请给我一条跟进消息。',request='请给我一条跟进消息',question='这条消息发给谁？',material='我想跟进这件事。'
      const actionRun=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(actionRun,{candidates:[],audit:[],coach:await stageCoachEvent(actionRun,{target:{operation:'create',title:'旧版课程事项',source:source(actionRun,'旧版课程事项')},action:{operation:'create',source:source(actionRun,request),draft:{content:material}}},material)},material,null,signal())
      const questionRun=(await store.startRun(user,second,randomUUID(),'继续。')).run
      await store.finishRun(questionRun,{candidates:[],audit:[],coach:await stageCoachEvent(questionRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision}},question)},question,null,signal())
      await pool.query("UPDATE coach_event_revisions SET snapshot=(snapshot-'actionSource'-'questionSources'-'questionBindings') WHERE user_id=$1 AND event_id=$2",[user,created.event!.id])

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:actionRun.source_message_id,quote:request}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'a provenance-free legacy action question cannot acquire unrelated title authority')
    })
    await t.test('a legacy action question cannot borrow an unrelated active fact',async()=>{
      await settings(true)
      const text='旧版跟进事项。课程截止周五。请给我一条跟进消息。',fact='课程截止周五',request='请给我一条跟进消息',question='这条消息发给谁？',material='我想跟进这件事。'
      const actionRun=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(actionRun,{candidates:[],audit:[],coach:await stageCoachEvent(actionRun,{target:{operation:'create',title:'旧版跟进事项',source:source(actionRun,'旧版跟进事项')},nodes:[{kind:'fact',source:source(actionRun,fact)}],action:{operation:'create',source:source(actionRun,request),draft:{content:material}}},material)},material,null,signal())
      const questionRun=(await store.startRun(user,second,randomUUID(),'继续。')).run
      await store.finishRun(questionRun,{candidates:[],audit:[],coach:await stageCoachEvent(questionRun,{target:{operation:'continue',eventId:created.event!.id,expectedRevision:created.event!.revision}},question)},question,null,signal())
      await pool.query("UPDATE coach_event_revisions SET snapshot=(snapshot-'questionSources'-'questionBindings') WHERE user_id=$1 AND event_id=$2",[user,created.event!.id])

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:actionRun.source_message_id,quote:request}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'the legacy material question retires with its action request')
      assert.ok(after.nodes.some(node=>node.content===fact),'the unrelated deadline fact remains available')
    })
    await t.test('an ambiguous legacy question binding fails exact-source validation',async()=>{
      await settings(true)
      const text='求职访谈，请继续；创业访谈，请继续。',question='接下来先处理哪一个？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'访谈选择',source:source(run,'求职访谈')},nodes:[{kind:'unknown',question}]},question)},question,null,signal())
      const forged=[{question,sources:[{messageId:run.source_message_id,conversationId:second,quote:'请继续'}]}]
      await pool.query("UPDATE coach_event_revisions SET snapshot=jsonb_set(snapshot,'{questionBindings}',$3::jsonb,true) WHERE user_id=$1 AND event_id=$2",[user,created.event!.id,JSON.stringify(forged)])
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'a range-free duplicate quote cannot authorize a persisted question')
    })
    await t.test('a superseded action-stage fact cannot keep a new question alive',async()=>{
      await settings(true)
      const text='课程事项。导师还没有回复作品集链接。导师后来回复作品集链接了。',oldQuote='导师还没有回复作品集链接',currentQuote='导师后来回复作品集链接了',question='这次回复后还需要确认什么？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'对方回复进展',source:source(run,'课程事项')},nodes:[{kind:'fact',source:source(run,oldQuote)},{kind:'fact',source:source(run,currentQuote)},{kind:'unknown',question}]},question)},question,null,signal())
      assert.ok(created.event!.nodes.some(node=>node.content===oldQuote&&node.supersededByActionCorrection),'the old no-reply fact is projected as superseded')
      assert.ok(created.event!.asked.includes(question),'the immediate committed response contains the question authorized by the projected current fact')
      assert.deepEqual(created.event!.asked,(await coachEventView(user,second,created.event!.id))!.asked,'the completion event and immediate refresh expose the same question state')
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((source:any)=>source.quote),[currentQuote],'the new question binds only the current non-superseded fact')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:currentQuote}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'obsolete evidence cannot preserve a question after its current source is forgotten')
    })
    await t.test('completion drops a question whose sole fact is superseded in the same commit',async()=>{
      await settings(true)
      const text='作品集事项。导师还没有回复作品集链接。导师后来明确拒绝了作品集链接。',oldQuote='导师还没有回复作品集链接',currentQuote='导师后来明确拒绝了作品集链接',question='为什么还没有回复？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'作品集反馈',source:source(run,'作品集事项')},nodes:[{kind:'fact',source:source(run,oldQuote)},{kind:'fact',source:source(run,currentQuote)},{kind:'unknown',question}]},question)},question,null,signal())
      const refreshed=(await coachEventView(user,second,created.event!.id))!
      assert.equal(created.event!.actionStages?.replied,true,'an explicit rejection is a received response, not continued waiting')
      assert.ok(created.event!.nodes.some(node=>node.content===oldQuote&&node.supersededByActionCorrection),'the old no-reply fact is superseded before the completion receipt is returned')
      assert.ok(!created.event!.asked.includes(question),`the completion payload cannot retain an old-only question: ${JSON.stringify({created:{asked:created.event!.asked,nodes:created.event!.nodes,stages:created.event!.actionStages},refreshed:{asked:refreshed.asked,nodes:refreshed.nodes,stages:refreshed.actionStages}})}`)
      assert.deepEqual(created.event!.asked,refreshed.asked,'completion and immediate read expose one committed question state')
    })
    await t.test('a later explicit response retires an earlier no-response question across revisions',async()=>{
      await settings(true)
      const oldQuote='导师还没有回复作品集链接',currentQuote='导师后来明确拒绝了作品集链接',question='为什么还没有回复？'
      const firstRun=(await store.startRun(user,second,randomUUID(),`作品集事项。${oldQuote}。`)).run
      const first=await store.finishRun(firstRun,{candidates:[],audit:[],coach:await stageCoachEvent(firstRun,{target:{operation:'create',title:'作品集反馈',source:source(firstRun,'作品集事项')},nodes:[{kind:'fact',source:source(firstRun,oldQuote)},{kind:'unknown',question}]},question)},question,null,signal())
      assert.ok(first.event!.asked.includes(question),'the unanswered question is initially active')

      let current=first.event!
      for(let index=0;index<8;index++){
        const filler=`补充无关记录${index}`,fillerRun=(await store.startRun(user,second,randomUUID(),filler)).run
        current=(await store.finishRun(fillerRun,{candidates:[],audit:[],coach:await stageCoachEvent(fillerRun,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision}},'已记录。')},'已记录。',null,signal())).event!
      }
      await pool.query("UPDATE coach_event_revisions SET snapshot=snapshot-'currentQuestionBindings' WHERE user_id=$1 AND event_id=$2",[user,current.id])
      assert.ok((await coachEventView(user,second,current.id))!.asked.includes(question),'a pre-projection event recovers the exact old binding without loading every revision into the API view')
      const responseRun=(await store.startRun(user,second,randomUUID(),currentQuote+'。')).run
      const response=await store.finishRun(responseRun,{candidates:[],audit:[],coach:await stageCoachEvent(responseRun,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision},nodes:[{kind:'fact',source:source(responseRun,currentQuote)}]},'已记录这个明确结果。')},'已记录这个明确结果。',null,signal())
      const refreshed=(await coachEventView(user,second,response.event!.id))!
      assert.equal(response.event!.actionStages?.replied,true,'the later explicit rejection is a received response')
      assert.ok(response.event!.nodes.some(node=>node.content===oldQuote&&node.supersededByActionCorrection),'the later response supersedes the prior no-response fact')
      assert.ok(!response.event!.asked.includes(question),'the completion payload retires the now-answered historical question')
      assert.ok(!response.event!.processTurns?.some(turn=>turn.questionsAskedAfterInput.includes(question)),'model chronology cannot keep prompting the retired question')
      assert.deepEqual(response.event!.asked,refreshed.asked,'completion and refresh expose the same retired-question state')
      assert.equal((await pool.query("SELECT status FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND kind='unknown' AND content=$3",[user,response.event!.id,question])).rows[0]?.status,'resolved','the canonical unknown row follows the retired API projection')
    })
    await t.test('forgetting a newer duplicate question source preserves an older valid occurrence beyond the read window',async()=>{
      await settings(true)
      const fact='作品集还缺一份导师反馈',question='作品集还缺什么？'
      const firstRun=(await store.startRun(user,second,randomUUID(),`作品集复盘。${fact}。`)).run
      let current=(await store.finishRun(firstRun,{candidates:[],audit:[],coach:await stageCoachEvent(firstRun,{target:{operation:'create',title:'作品集复盘',source:source(firstRun,'作品集复盘')},nodes:[{kind:'fact',source:source(firstRun,fact)},{kind:'unknown',question}]},question)},question,null,signal())).event!
      const alternate='补充依据B',alternateRun=(await store.startRun(user,second,randomUUID(),alternate)).run
      current=(await store.finishRun(alternateRun,{candidates:[],audit:[],coach:await stageCoachEvent(alternateRun,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision}},'已记录。')},'已记录。',null,signal())).event!
      const legacy=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,current.id,current.revision])).rows[0].snapshot
      legacy.askedThisTurn=[question]
      legacy.questionBindings=[{question,sources:[source(alternateRun,alternate)]}]
      legacy.event.asked=[question]
      delete legacy.currentQuestionBindings
      await pool.query('UPDATE coach_event_revisions SET snapshot=$4 WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,current.id,current.revision,legacy])

      const carryRun=(await store.startRun(user,second,randomUUID(),'继续记录')).run
      current=(await store.finishRun(carryRun,{candidates:[],audit:[],coach:await stageCoachEvent(carryRun,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision}},'已记录。')},'已记录。',null,signal())).event!
      const carried=(await pool.query("SELECT snapshot->'currentQuestionBindings' AS bindings FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 ORDER BY revision DESC LIMIT 1",[user,current.id])).rows[0].bindings
      assert.deepEqual(new Set(carried.filter((binding:any)=>binding.question===question).flatMap((binding:any)=>binding.sources.map((item:any)=>item.messageId))),new Set([firstRun.source_message_id,alternateRun.source_message_id]),'the bounded projection retains independent occurrences of identical question text')
      for(let index=0;index<8;index++){
        const filler=`重复问题后的无关记录${index}`,fillerRun=(await store.startRun(user,second,randomUUID(),filler)).run
        current=(await store.finishRun(fillerRun,{candidates:[],audit:[],coach:await stageCoachEvent(fillerRun,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision}},'已记录。')},'已记录。',null,signal())).event!
      }
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:alternateRun.source_message_id,quote:alternate}],true))
      const refreshed=(await coachEventView(user,second,current.id))!
      assert.ok(refreshed.asked.includes(question),'forgetting B keeps the independently grounded A occurrence')
      assert.equal((await pool.query("SELECT status FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND kind='unknown' AND content=$3",[user,current.id,question])).rows[0]?.status,'active','the canonical unknown remains aligned with the surviving question')
    })
    await t.test('legacy aggregate question sources fail closed instead of lending one fact to another question',async()=>{
      await settings(true)
      const firstFact='作品集缺少导师反馈',secondFact='预算表缺少交通费用',firstQuestion='作品集还缺什么？',secondQuestion='预算表还缺什么？'
      const run=(await store.startRun(user,second,randomUUID(),`双问题事项。${firstFact}。${secondFact}。`)).run
      const saved=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'双问题事项',source:source(run,'双问题事项')},nodes:[{kind:'fact',source:source(run,firstFact)},{kind:'fact',source:source(run,secondFact)},{kind:'unknown',question:firstQuestion},{kind:'unknown',question:secondQuestion}]},`${firstQuestion}\n${secondQuestion}`)},`${firstQuestion}\n${secondQuestion}`,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,saved.event!.id])).rows[0].snapshot
      delete snapshot.questionBindings;delete snapshot.currentQuestionBindings
      snapshot.questionSources=[source(run,firstFact),source(run,secondFact)]
      snapshot.askedThisTurn=[firstQuestion,secondQuestion]
      snapshot.event.asked=[firstQuestion,secondQuestion]
      await pool.query('UPDATE coach_event_revisions SET snapshot=$4 WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,saved.event!.id,1,snapshot])
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:firstFact}],true))
      const refreshed=(await coachEventView(user,second,saved.event!.id))!
      assert.ok(!refreshed.asked.includes(firstQuestion),'unmapped aggregate B cannot keep the question originally affected by A')
      assert.ok(!refreshed.asked.includes(secondQuestion),'legacy aggregate provenance is conservative when per-question ownership cannot be proven')
    })
    await t.test('legacy recovery does not revive an occurrence retired before identical text was reintroduced',async()=>{
      await settings(true)
      const firstFact='第一次作品集还缺导师反馈',question='作品集还缺什么？'
      const firstRun=(await store.startRun(user,second,randomUUID(),`重开问题事项。${firstFact}。`)).run
      let current=(await store.finishRun(firstRun,{candidates:[],audit:[],coach:await stageCoachEvent(firstRun,{target:{operation:'create',title:'重开问题事项',source:source(firstRun,'重开问题事项')},nodes:[{kind:'fact',source:source(firstRun,firstFact)},{kind:'unknown',question}]},question)},question,null,signal())).event!
      const gapRun=(await store.startRun(user,second,randomUUID(),'这个问题先结束')).run
      current=(await store.finishRun(gapRun,{candidates:[],audit:[],coach:await stageCoachEvent(gapRun,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision}},'已结束。')},'已结束。',null,signal())).event!
      const gap=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,current.id,current.revision])).rows[0].snapshot
      gap.askedThisTurn=[];gap.event.asked=[];delete gap.questionBindings;delete gap.currentQuestionBindings
      await pool.query('UPDATE coach_event_revisions SET snapshot=$4 WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,current.id,current.revision,gap])

      const alternate='第二次作品集又缺导师反馈',alternateRun=(await store.startRun(user,second,randomUUID(),alternate)).run
      current=(await store.finishRun(alternateRun,{candidates:[],audit:[],coach:await stageCoachEvent(alternateRun,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision}},'已重新记录。')},'已重新记录。',null,signal())).event!
      const reopened=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,current.id,current.revision])).rows[0].snapshot
      reopened.askedThisTurn=[question];reopened.questionBindings=[{question,sources:[source(alternateRun,alternate)]}];reopened.event.asked=[question];delete reopened.currentQuestionBindings
      await pool.query('UPDATE coach_event_revisions SET snapshot=$4 WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,current.id,current.revision,reopened])

      const carryRun=(await store.startRun(user,second,randomUUID(),'继续新一轮记录')).run
      current=(await store.finishRun(carryRun,{candidates:[],audit:[],coach:await stageCoachEvent(carryRun,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision}},'已记录。')},'已记录。',null,signal())).event!
      const carried=(await pool.query("SELECT snapshot->'currentQuestionBindings' AS bindings FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 ORDER BY revision DESC LIMIT 1",[user,current.id])).rows[0].bindings
      assert.deepEqual(new Set(carried.flatMap((binding:any)=>binding.sources.map((item:any)=>item.messageId))),new Set([alternateRun.source_message_id]),'only the latest continuous active epoch enters the bounded projection')
      for(let index=0;index<8;index++){
        const filler=`重开问题后的无关记录${index}`,fillerRun=(await store.startRun(user,second,randomUUID(),filler)).run
        current=(await store.finishRun(fillerRun,{candidates:[],audit:[],coach:await stageCoachEvent(fillerRun,{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision}},'已记录。')},'已记录。',null,signal())).event!
      }
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:alternateRun.source_message_id,quote:alternate}],true))
      const refreshed=(await coachEventView(user,second,current.id))!
      assert.ok(!refreshed.asked.includes(question),'forgetting the reintroduced B occurrence cannot revive retired A')
      assert.notEqual((await pool.query("SELECT status FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND kind='unknown' AND content=$3",[user,current.id,question])).rows[0]?.status,'active','the canonical unknown cannot become active through the retired A occurrence')
    })
    await t.test('a superseded fact cannot recover an event after its current authorities are forgotten',async()=>{
      await settings(true)
      const title='回复状态事项',text=`${title}。导师还没有回复作品集链接。导师后来回复作品集链接了。`,oldQuote='导师还没有回复作品集链接',currentQuote='导师后来回复作品集链接了'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},nodes:[{kind:'fact',source:source(run,oldQuote)},{kind:'fact',source:source(run,currentQuote)}]},'导师已经回复。')},'导师已经回复。',null,signal())
      assert.ok(created.event!.nodes.some(node=>node.content===oldQuote&&node.supersededByActionCorrection),'the old no-reply fact starts superseded')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:title},{messageId:run.source_message_id,quote:currentQuote}],true))
      await assert.rejects(coachEventView(user,second,created.event!.id),(error:any)=>error.code==='COACH_SOURCE_REVOKED','the obsolete no-reply fact cannot resurrect the event')
    })
    await t.test('a question about one fact does not borrow unrelated facts in the same event',async()=>{
      await settings(true)
      const text='健康与预算事项。我的病情是X。本周预算是一百元。',health='我的病情是X',budget='本周预算是一百元',question='病情是否影响下一步？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'健康与预算事项',source:source(run,'健康与预算事项')},nodes:[{kind:'fact',source:source(run,health)},{kind:'fact',source:source(run,budget)},{kind:'unknown',question}]},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[health],'the exact question binds only its topical fact')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:health}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'an unrelated budget fact cannot retain a forgotten medical question')
      assert.ok(after.nodes.some(node=>node.content===budget),'forgetting the medical fact preserves the unrelated budget fact')
    })
    await t.test('legacy question withdrawal matches complete tool names and preserves other topics',async()=>{
      await settings(true)
      const title='旧版课外项目'
      const withdrawn=['我使用 python 做分析','另外也用sql查数据','我使用剪映剪辑视频','我会用用友做财务管理','我会用Visual Studio Code写插件','我用SPSS 27做分析','我用Visual Studio 2022调试','我使用课程数据做分析','我用岗位说明核对职责']
      const removedQuestions=['使用 Python 分析了吗？','查询时用到 SQL 了吗？','Was SQL actually used to query the data?','剪映是否用于视频剪辑？','用友是否用于财务管理？','Visual Studio Code 插件写完了吗？','SPSS 27 的变量视图怎么设置？','Does SPSS 27 need plugins?','Visual Studio 2022 还需要什么插件？']
      const retainedQuestions=['Code review定在什么时候？','课程数据何时提交？','岗位说明的发布时间是哪天？','Visual Studio 2022 Preview 的预览功能正常吗？','Was SPSS 27 Student Edition used for the course project?','was spss 27 student edition used for the course project?','was spss 27-preview used for the course project?','岗位说明是否用于新生培训？']
      const run=(await store.startRun(user,second,randomUUID(),[title,...withdrawn,'我已安排Code review','我记下了岗位说明的发布时间是周一','我也使用 Visual Studio 2022 Preview 测试预览功能','我也在新生培训中用岗位说明做示例'].join('。'))).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)}},'已核对。')},'已核对。',null,signal())
      const id=created.event!.id, questions=[...removedQuestions,...retainedQuestions]
      await pool.query("INSERT INTO coach_nodes(id,user_id,event_id,kind,content) SELECT node_id,$1,$2,'unknown',question FROM unnest($3::uuid[],$4::text[]) AS q(node_id,question)",[user,id,questions.map(()=>randomUUID()),questions])
      const before=await coachEventView(user,second,id)
      assert.ok(questions.every(question=>before?.nodes.some(node=>node.content===question&&node.status==='active')))
      await transaction(c=>invalidateCoachSourceQuotes(c,user,withdrawn.map(quote=>({messageId:run.source_message_id,quote})),true))
      const after=await coachEventView(user,second,id)
      assert.deepEqual(after?.nodes.filter(node=>node.kind==='unknown'&&node.status==='active').map(node=>node.content).sort(),retainedQuestions.sort())
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND status='withdrawn' AND content IS NULL",[user,id])).rows[0]?.n,removedQuestions.length)
    })
    await t.test('a correction retires a legacy use question from a continuing turn at commit and replay',async()=>{
      await settings(true)
      const title='课外项目', quote='我会用用友做财务管理', deadline='我还要周五交报告', question='用友是否用于这次财务管理？'
      const first=(await store.startRun(user,second,randomUUID(),title)).run
      const event=(await store.finishRun(first,{candidates:[],audit:[],coach:await stageCoachEvent(first,{target:{operation:'create',title,source:source(first,title)}},'已核对。')},'已核对。',null,signal())).event!
      const follow=(await store.startRun(user,second,randomUUID(),`${quote}。${deadline}。`)).run
      const continued=(await store.finishRun(follow,{candidates:[],audit:[],coach:await stageCoachEvent(follow,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:source(follow,deadline)}]},'已核对。')},'已核对。',null,signal())).event!
      await pool.query(`UPDATE coach_event_revisions SET snapshot=jsonb_set(jsonb_set(snapshot-'questionSources'-'questionBindings'-'currentQuestionBindings','{askedThisTurn}',jsonb_build_array($4::text)),'{event,asked}',jsonb_build_array($4::text)) WHERE user_id=$1 AND event_id=$2 AND revision=$3`,[user,event.id,continued.revision,question])
      const nodeId=randomUUID()
      await pool.query("INSERT INTO coach_nodes(id,user_id,event_id,kind,content) VALUES($1,$2,$3,'unknown',$4)",[nodeId,user,event.id,question])
      assert.ok((await coachEventView(user,second,event.id))?.asked.includes(question))
      await transaction(async c=>{
        await c.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4)',[user,second,follow.source_message_id,quote])
        await invalidateCoachSourceQuotes(c,user,[{messageId:follow.source_message_id,quote}])
      })
      assert.deepEqual((await pool.query('SELECT status,content FROM coach_nodes WHERE user_id=$1 AND id=$2',[user,nodeId])).rows,[{status:'withdrawn',content:null}])
      const replay=(await store.runStatus(user,follow.request_id)).response.event
      const view=await coachEventView(user,second,event.id)
      assert.ok(view?.nodes.some(node=>node.content===deadline&&node.status==='active'))
      assert.ok(!view?.asked.includes(question)&&!replay?.asked.includes(question))
    })
    await t.test('two scoped controls retire a legacy question once its complete origin is withdrawn',async()=>{
      await settings(true)
      const title='独立项目事项', a='素材有两份', b='还缺一张图', question='这件事还缺什么？'
      const first=(await store.startRun(user,second,randomUUID(),title)).run
      const event=(await store.finishRun(first,{candidates:[],audit:[],coach:await stageCoachEvent(first,{target:{operation:'create',title,source:source(first,title)}},'已核对。')},'已核对。',null,signal())).event!
      const follow=(await store.startRun(user,second,randomUUID(),`${a}。${b}。`)).run
      const latest=(await store.finishRun(follow,{candidates:[],audit:[],coach:await stageCoachEvent(follow,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision}},'已核对。')},'已核对。',null,signal())).event!
      await pool.query(`UPDATE coach_event_revisions SET snapshot=jsonb_set(jsonb_set(snapshot-'questionSources'-'questionBindings'-'currentQuestionBindings','{askedThisTurn}',jsonb_build_array($4::text)),'{event,asked}',jsonb_build_array($4::text)) WHERE user_id=$1 AND event_id=$2 AND revision=$3`,[user,event.id,latest.revision,question])
      const suppress=(quote:string)=>transaction(async c=>{
        await c.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4)',[user,second,follow.source_message_id,quote])
        await invalidateCoachSourceQuotes(c,user,[{messageId:follow.source_message_id,quote}],true)
      })
      assert.ok((await coachEventView(user,second,event.id))?.asked.includes(question))
      await suppress(a)
      assert.ok((await coachEventView(user,second,event.id))?.asked.includes(question),'a partial control leaves the unbound question available')
      await suppress(b)
      assert.ok(!(await coachEventView(user,second,event.id))?.asked.includes(question))
      const stored=(await pool.query("SELECT snapshot->'askedThisTurn' AS asked FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3",[user,event.id,latest.revision])).rows[0]?.asked
      assert.deepEqual(stored,[],'the transaction retires the question in durable history before refresh')
    })
    await t.test('revoking one tool use preserves a separate use in the same or another origin',async()=>{
      await settings(true)
      const title='数据归档事项',course='我用 SQL 查询课程数据',finance='我还用 SQL 查询财务数据',ledger='我用 R 做账',originalReport='我用 SQL 做 finance report',auditReport='我用 SQL 写 audit report',oldOnly='SQL 是否用于课程数据？',other='SQL 是否用于财务数据？',sameObject='Was SQL used for the audit report?',repeated='SQL 是否用于这次数据查询？'
      const first=(await store.startRun(user,second,randomUUID(),`${title}。${course}。${finance}。${ledger}。${originalReport}。我用 SQL 做 different finance report。${auditReport}。我用 SQL 的 different query 核对 same audit report。我也用 R 查课程表。`)).run
      const event=(await store.finishRun(first,{candidates:[],audit:[],coach:await stageCoachEvent(first,{target:{operation:'create',title,source:source(first,title)}},'已核对。')},'已核对。',null,signal())).event!
      const follow=(await store.startRun(user,second,randomUUID(),'我也会用 SQL 查新库。')).run
      const continued=(await store.finishRun(follow,{candidates:[],audit:[],coach:await stageCoachEvent(follow,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision}},'已核对。')},'已核对。',null,signal())).event!
      for(const revision of [event.revision,continued.revision])await pool.query(`UPDATE coach_event_revisions SET snapshot=jsonb_set(jsonb_set(snapshot-'questionSources'-'questionBindings'-'currentQuestionBindings','{askedThisTurn}',jsonb_build_array($4::text)),'{event,asked}',jsonb_build_array($4::text)) WHERE user_id=$1 AND event_id=$2 AND revision=$3`,[user,event.id,revision,repeated])
      const questions=[oldOnly,other,repeated,sameObject,'Did you use SQL for course data?','Was SQL used for the finance report?','R 是否用于财务数据？']
      await pool.query("INSERT INTO coach_nodes(id,user_id,event_id,kind,content) SELECT node_id,$1,$2,'unknown',question FROM unnest($3::uuid[],$4::text[]) AS q(node_id,question)",[user,event.id,questions.map(()=>randomUUID()),questions])
      await transaction(async c=>{
        await c.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) SELECT $1,$2,$3,q FROM unnest($4::text[]) q',[user,second,first.source_message_id,[course,ledger,originalReport,auditReport]])
        await invalidateCoachSourceQuotes(c,user,[course,ledger,originalReport,auditReport].map(quote=>({messageId:first.source_message_id,quote})),true)
      })
      const after=await coachEventView(user,second,event.id)
      assert.ok(after?.asked.includes(repeated))
      assert.deepEqual(after?.nodes.filter(node=>node.kind==='unknown'&&node.status==='active').map(node=>node.content).sort(),[other,repeated,sameObject].sort())
    })
    await t.test('a structurally deictic time question keeps its one exact constraint source',async()=>{
      await settings(true)
      const title='本周空档事项',fact='我每周只有两小时可用',question='这段空档先安排哪一步？',text=`${title}。${fact}。`
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},nodes:[{kind:'fact',source:source(run,fact)},{kind:'unknown',question}]},question)},question,null,signal())
      assert.ok(created.event!.asked.includes(question),'one structural deictic referent remains attached to the only available fact')
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[fact])
    })
    await t.test('an unmatched explicit topic cannot borrow every unrelated fact',async()=>{
      await settings(true)
      const title='健康与预算事项',text=`${title}。我的病情是X。本周预算是一百元。`,health='我的病情是X',budget='本周预算是一百元',question='宿舍什么时候熄灯？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},nodes:[{kind:'fact',source:source(run,health)},{kind:'fact',source:source(run,budget)},{kind:'unknown',question},{kind:'unknown',question}]},question)},question,null,signal())
      assert.ok(!created.event!.asked.includes(question),'an unrelated explicit question is displayed once but not retained as grounded memory')
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[''],'the unmatched topic receives an unavailable private basis instead of all facts')
      const unsupported=(await pool.query("SELECT status,content FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND kind='unknown'",[user,created.event!.id])).rows
      assert.deepEqual(unsupported,[{status:'withdrawn',content:null}],'an unsupported generated question is withdrawn rather than falsely recorded as resolved')
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND kind='unknown' AND status='active'",[user,created.event!.id])).rows[0].n,0,'duplicate unsupported unknowns cannot leave an active copy')
    })
    await t.test('a singular topic question keeps only its uniquely strongest factual source',async()=>{
      await settings(true)
      const title='同名报告事项',text=`${title}。体检报告已经出来了。课程报告周五提交。`,medical='体检报告已经出来了',course='课程报告周五提交',question='报告什么时候提交？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},nodes:[{kind:'fact',source:source(run,medical)},{kind:'fact',source:source(run,course)},{kind:'unknown',question}]},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[course],'the predicate resolves the shared report noun to the course-report fact')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:course}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'the medical report cannot retain a forgotten course-report question')
      assert.ok(after.nodes.some(node=>node.content===medical),'the unrelated medical report remains')
    })
    await t.test('a distributive plural question binds every matching factual source',async()=>{
      await settings(true)
      const title='双预算影响事项',text=`${title}。课程预算是一百元。宿舍预算是二百元。`,course='课程预算是一百元',dorm='宿舍预算是二百元',question='这两个预算分别会怎样影响课程安排？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},nodes:[{kind:'fact',source:source(run,course)},{kind:'fact',source:source(run,dorm)},{kind:'unknown',question}]},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote).sort(),[course,dorm].sort(),'分别 requires every independently matching budget source, not only the highest lexical score')
      assert.equal(snapshot.questionBindings?.[0]?.sourceRequirement,'all','a distributive question becomes stale when any named basis changes')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:dorm}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'forgetting either distributive basis removes the two-budget question')
      assert.ok(after.nodes.some(node=>node.content===course),'the independently retained course budget remains available')
    })
    await t.test('an exact counted pair ignores a different fact named elsewhere in the question',async()=>{
      await settings(true)
      const title='双预算与课程安排事项',text=`${title}。课程预算是一百元。宿舍预算是二百元。课程安排改到周五。`,course='课程预算是一百元',dorm='宿舍预算是二百元',schedule='课程安排改到周五',question='这两个预算会怎样影响课程安排？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},nodes:[{kind:'fact',source:source(run,course)},{kind:'fact',source:source(run,dorm)},{kind:'fact',source:source(run,schedule)},{kind:'unknown',question}]},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote).sort(),[course,dorm].sort(),'the counted noun selects exactly the two budget facts rather than the separate schedule fact')
      assert.equal(snapshot.questionBindings?.[0]?.sourceRequirement,'all','an exact counted set becomes stale when any member changes')
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:dorm}],true))
      assert.ok(!(await coachEventView(user,second,created.event!.id))!.asked.includes(question),'forgetting one counted budget retires the two-budget question')
      const forgottenSnapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.ok(!(forgottenSnapshot.questionBindings??[]).some((binding:any)=>binding.question===question),'the persisted revision removes the invalid all-source binding instead of shrinking it to one source')
      assert.ok(!(forgottenSnapshot.askedThisTurn??[]).includes(question),'the persisted turn truth retires the invalid all-source question in the same rewrite')
    })
    await t.test('a distributive question excludes an unnamed lower-score distractor',async()=>{
      await settings(true)
      const title='命名预算影响事项',text=`${title}。课程预算是一百元。宿舍预算是二百元。医疗预算是三百元。`,course='课程预算是一百元',dorm='宿舍预算是二百元',medical='医疗预算是三百元',question='课程和宿舍预算分别会怎样影响安排？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},nodes:[{kind:'fact',source:source(run,course)},{kind:'fact',source:source(run,dorm)},{kind:'fact',source:source(run,medical)},{kind:'unknown',question}]},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote).sort(),[course,dorm].sort(),'分别 binds the independently named strongest facts without exposing a generic budget distractor')
      assert.equal(snapshot.questionBindings?.[0]?.sourceRequirement,'all')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:medical}],true))
      assert.ok((await coachEventView(user,second,created.event!.id))!.asked.includes(question),'forgetting an unrelated weaker budget cannot remove the course-and-dorm question')
    })
    await t.test('an explicit distributive count fails closed when more facts tie than named',async()=>{
      await settings(true)
      for(const [index,question] of ['这两个预算分别会怎样影响安排？','这两笔预算分别会怎样影响安排？','这两笔预算会怎样影响安排？','两者分别对预算会有什么影响？','这两者分别会怎样影响预算？','这两者会分别怎样影响预算？','请比较这两者分别会怎样影响预算？'].entries()){
        const title=`模糊双预算事项${index}`,text=`${title}。课程预算是一百元。宿舍预算是二百元。医疗预算是三百元。`,course='课程预算是一百元',dorm='宿舍预算是二百元',medical='医疗预算是三百元'
        const run=(await store.startRun(user,second,randomUUID(),text)).run
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},nodes:[{kind:'fact',source:source(run,course)},{kind:'fact',source:source(run,dorm)},{kind:'fact',source:source(run,medical)},{kind:'unknown',question}]},question)},question,null,signal())
        assert.ok(!created.event!.asked.includes(question),`${question} cannot silently expand to all three matching facts`)
        const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
        assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[''],'an over-complete counted question receives an unavailable private basis')
      }
    })
    await t.test('a count of adjustments cannot count unrelated factual budget sources',async()=>{
      await settings(true)
      for(const [index,question] of ['课程预算有两个调整，分别会怎样影响安排？','这两个预算调整分别会怎样影响安排？'].entries()){
        const title=`预算调整数量事项${index}`,text=`${title}。课程预算是一百元。宿舍预算是二百元。`,course='课程预算是一百元',dorm='宿舍预算是二百元'
        const run=(await store.startRun(user,second,randomUUID(),text)).run
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},nodes:[{kind:'fact',source:source(run,course)},{kind:'fact',source:source(run,dorm)},{kind:'unknown',question}]},question)},question,null,signal())
        assert.ok(!created.event!.asked.includes(question),'a count of adjustments cannot silently authorize two budget facts: '+question)
        const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
        assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[''],'the ambiguous distributive question receives an unavailable private basis: '+question)
      }
    })
    await t.test('a one-character medical subject binds only its factual source',async()=>{
      await settings(true)
      const text='用药与预算事项。我在吃药。本周预算一百元。',medicine='我在吃药',budget='本周预算一百元',question='药要停吗？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'用药与预算事项',source:source(run,'用药与预算事项')},nodes:[{kind:'fact',source:source(run,medicine)},{kind:'fact',source:source(run,budget)},{kind:'unknown',question}]},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[medicine],'a short medical subject cannot borrow the unrelated budget')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:medicine}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'forgetting the sole medical basis removes its question')
      assert.ok(after.nodes.some(node=>node.content===budget),'the unrelated budget remains')
    })
    await t.test('a valid two-character medicine compound keeps the short medical topic',async()=>{
      await settings(true)
      const question='药要停吗？'
      for(const [title,medicine] of [['中药事项','我在吃中药'],['处方药事项','医生给我开了三天的药'],['处方费用事项','医生给我开了三天的药，费用记在本周预算里'],['遵医嘱用药事项','我正在遵医嘱用药']]){
        const text=`${title}。${medicine}。`,run=(await store.startRun(user,second,randomUUID(),text)).run
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},nodes:[{kind:'fact',source:source(run,medicine)},{kind:'unknown',question}]},question)},question,null,signal())
        const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
        assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[medicine],`${medicine} remains medication evidence while procurement compounds stay excluded`)
      }
    })
    await t.test('a one-character subject does not borrow an unrelated compound suffix',async()=>{
      await settings(true)
      for(const [title,pesticide] of [['农药预算事项','农药采购预算是一百元'],['老鼠药预算事项','老鼠药采购预算是一百元'],['农药采购事项','我在开农药采购预算']]){
        const text=`${title}。${pesticide}。`,question='药要停吗？'
        const run=(await store.startRun(user,second,randomUUID(),text)).run
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},nodes:[{kind:'fact',source:source(run,pesticide)},{kind:'unknown',question}]},question)},question,null,signal())
        assert.ok(!created.event!.asked.includes(question),`${pesticide} cannot ground a medical question`)
        const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
        assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[''],'the unmatched short subject receives an unavailable private basis')
      }
    })
    await t.test('a discourse-prefixed one-character subject keeps its exact factual source',async()=>{
      await settings(true)
      const title='前缀用药与预算事项',text=`${title}。我在吃药。本周预算一百元。`,medicine='我在吃药',budget='本周预算一百元',question='请问药要停吗？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},nodes:[{kind:'fact',source:source(run,medicine)},{kind:'fact',source:source(run,budget)},{kind:'unknown',question}]},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[medicine],'a polite discourse prefix cannot make the medical question borrow budget')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:medicine}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'forgetting the exact medical source removes its prefixed question')
      assert.ok(after.nodes.some(node=>node.content===budget),'the unrelated budget remains after the medical source is forgotten')
    })
    await t.test('a one-character topic does not match an unrelated compound prefix',async()=>{
      await settings(true)
      const text='课程与预算事项。我选了物理课。本周课外预算是一百元。',course='我选了物理课',budget='本周课外预算是一百元',question='课要退吗？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'课程与预算事项',source:source(run,'课程与预算事项')},nodes:[{kind:'fact',source:source(run,course)},{kind:'fact',source:source(run,budget)},{kind:'unknown',question}]},question)},question,null,signal())
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[course],'课 is the head of 物理课, not the prefix of 课外预算')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:course}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question),'forgetting the course removes the course question')
      assert.ok(after.nodes.some(node=>node.content===budget),'the unrelated extracurricular budget remains')
    })
    await t.test('ambiguous deixis across multiple facts fails closed instead of borrowing all sources',async()=>{
      await settings(true)
      const text='模糊指代事项。我的病情是X。本周预算是一百元。',health='我的病情是X',budget='本周预算是一百元',question='这会影响下一步吗？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'模糊指代事项',source:source(run,'模糊指代事项')},nodes:[{kind:'fact',source:source(run,health)},{kind:'fact',source:source(run,budget)},{kind:'unknown',question}]},question)},question,null,signal())
      assert.ok(!created.event!.asked.includes(question),'an ambiguous deictic question is shown once but not retained as grounded memory')
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[''],'the private unavailable basis fails closed without borrowing either fact')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:health}],true))
      const after=(await coachEventView(user,second,created.event!.id))!
      assert.ok(!after.asked.includes(question))
      assert.ok(after.nodes.some(node=>node.content===budget),'the unrelated budget remains after the medical fact is forgotten')
    })
    await t.test('a later unsupported duplicate cannot erase an earlier independently grounded question',async()=>{
      await settings(true)
      const title='重复问题来源事项',health='我的病情是X',question='这会影响下一步吗？'
      const firstText=`${title}。${health}。`,firstRun=(await store.startRun(user,second,randomUUID(),firstText)).run
      const first=await store.finishRun(firstRun,{candidates:[],audit:[],coach:await stageCoachEvent(firstRun,{target:{operation:'create',title,source:source(firstRun,title)},nodes:[{kind:'fact',source:source(firstRun,health)},{kind:'unknown',question}]},question)},question,null,signal())
      assert.ok(first.event!.asked.includes(question),'the first occurrence has one exact factual basis')
      const firstSnapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,first.event!.id,first.event!.revision])).rows[0].snapshot
      assert.ok((firstSnapshot.currentQuestionBindings??[]).some((binding:any)=>binding.question===question&&binding.sources.some((item:any)=>item.quote===health)),'the first current projection retains its exact basis')

      const time='今天时间只有两小时',budget='本周预算一百元',secondText=`${time}。${budget}。`,secondRun=(await store.startRun(user,second,randomUUID(),secondText)).run
      const secondSaved=await store.finishRun(secondRun,{candidates:[],audit:[],coach:await stageCoachEvent(secondRun,{target:{operation:'continue',eventId:first.event!.id,expectedRevision:first.event!.revision},nodes:[{kind:'fact',source:source(secondRun,time)},{kind:'fact',source:source(secondRun,budget)},{kind:'unknown',question}]},question)},question,null,signal())
      assert.ok(secondSaved.event!.asked.includes(question),'an unsupported later occurrence cannot globally withdraw the earlier valid occurrence')
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,first.event!.id,secondSaved.event!.revision])).rows[0].snapshot
      const bindings=(snapshot.currentQuestionBindings??[]).filter((binding:any)=>binding.question===question)
      assert.ok(bindings.some((binding:any)=>binding.sources.some((item:any)=>item.quote===health)),'the earlier exact source remains in the bounded current projection: '+JSON.stringify(bindings))
      assert.ok(bindings.some((binding:any)=>binding.sources.some((item:any)=>item.quote==='')),'the unsupported duplicate remains auditable as unavailable without replacing the valid source')
    })
    await t.test('a natural compound deictic phrase also fails closed across multiple facts',async()=>{
      await settings(true)
      const text='复合指代事项。我的病情是X。本周预算是一百元。',health='我的病情是X',budget='本周预算是一百元',question='这件事情会影响下一步吗？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'复合指代事项',source:source(run,'复合指代事项')},nodes:[{kind:'fact',source:source(run,health)},{kind:'fact',source:source(run,budget)},{kind:'unknown',question}]},question)},question,null,signal())
      assert.ok(!created.event!.asked.includes(question),'ambiguous natural deixis is displayed once but never retained')
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[''],'the private unavailable basis does not borrow either fact')
    })
    await t.test('classifier variants of natural deixis also fail closed across multiple facts',async()=>{
      await settings(true)
      for(const [title,question] of [['个事情指代事项','这个事情会影响下一步吗？'],['个事指代事项','这个事会影响下一步吗？']] as const){
        const text=`${title}。我的病情是X。本周预算是一百元。`,health='我的病情是X',budget='本周预算是一百元'
        const run=(await store.startRun(user,second,randomUUID(),text)).run
        const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},nodes:[{kind:'fact',source:source(run,health)},{kind:'fact',source:source(run,budget)},{kind:'unknown',question}]},question)},question,null,signal())
        assert.ok(!created.event!.asked.includes(question),'ambiguous classifier deixis is displayed once but never retained: '+question)
        const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
        assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[''],'classifier deixis borrows neither fact: '+question)
      }
    })
    await t.test('a discourse-prefixed deictic phrase also fails closed across multiple facts',async()=>{
      await settings(true)
      const text='前缀指代事项。我的病情是X。本周预算是一百元。',health='我的病情是X',budget='本周预算是一百元',question='那么，这件事情会影响下一步吗？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'前缀指代事项',source:source(run,'前缀指代事项')},nodes:[{kind:'fact',source:source(run,health)},{kind:'fact',source:source(run,budget)},{kind:'unknown',question}]},question)},question,null,signal())
      assert.ok(!created.event!.asked.includes(question),'a prefixed ambiguous deictic question is shown once but never retained')
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[''],'the prefixed private unavailable basis borrows neither fact')
    })
    await t.test('a framed deictic phrase also fails closed across multiple facts',async()=>{
      await settings(true)
      const title='框架指代事项',text=`${title}。我的病情是X。本周预算是一百元。`,health='我的病情是X',budget='本周预算是一百元',question='关于这件事情，会影响下一步吗？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:source(run,title)},nodes:[{kind:'fact',source:source(run,health)},{kind:'fact',source:source(run,budget)},{kind:'unknown',question}]},question)},question,null,signal())
      assert.ok(!created.event!.asked.includes(question),'framed ambiguous deixis is displayed once but never retained')
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[''],'the framed private unavailable basis borrows neither fact')
    })
    await t.test('duplicate nodes sharing one exact source do not fabricate deictic ambiguity',async()=>{
      await settings(true)
      const text='单一来源事项。我今天很累。',fact='我今天很累',question='这会影响下一步吗？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'单一来源事项',source:source(run,'单一来源事项')},nodes:[{kind:'fact',source:source(run,fact)},{kind:'feeling',source:source(run,fact)},{kind:'unknown',question}]},question)},question,null,signal())
      assert.ok(created.event!.asked.includes(question),'one authoritative source remains enough to retain its deictic question')
      const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[fact],'duplicate node rows collapse to one exact source binding')
    })
    await t.test('separate forget operations cumulatively exhaust a non-distributive questions exact sources',async()=>{
      await settings(true)
      const text='累计来源事项。约束甲有效。约束乙有效。',quoteA='约束甲有效',quoteB='约束乙有效',question='这些约束里还有哪项会影响下一步？'
      const run=(await store.startRun(user,second,randomUUID(),text)).run
      const created=await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'累计来源事项',source:source(run,'累计来源事项')},nodes:[{kind:'fact',source:source(run,quoteA)},{kind:'fact',source:source(run,quoteB)},{kind:'unknown',question}]},question)},question,null,signal())
      const unknownId=created.event!.nodes.find(node=>node.kind==='unknown')!.id
      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:quoteA}],true))
      let snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      const afterFirst=(await coachEventView(user,second,created.event!.id))!
      assert.ok(afterFirst.asked.includes(question),`the independent second source keeps the question current: ${JSON.stringify({asked:afterFirst.asked,binding:snapshot.questionBindings?.[0]})}`)
      assert.ok(afterFirst.nodes.some(node=>node.id===unknownId&&node.status==='active'),'one retained exact source keeps the unknown node active and readable')
      assert.equal((await pool.query('SELECT status FROM coach_nodes WHERE user_id=$1 AND id=$2',[user,unknownId])).rows[0]?.status,'active','the first scoped forget cannot withdraw the canonical unknown row')
      assert.deepEqual(snapshot.questionBindings?.[0]?.sources.map((item:any)=>item.quote),[quoteB])
      assert.ok(!JSON.stringify({questionBindings:snapshot.questionBindings,questionSources:snapshot.questionSources}).includes(quoteA),'forgotten private provenance is redacted')

      await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:run.source_message_id,quote:quoteB}],true))
      assert.ok(!(await coachEventView(user,second,created.event!.id))!.asked.includes(question),'the question disappears when its last independent source is forgotten')
      assert.equal((await pool.query('SELECT status FROM coach_nodes WHERE user_id=$1 AND id=$2',[user,unknownId])).rows[0]?.status,'withdrawn','the last exact source withdrawal retires the canonical unknown row')
      snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,created.event!.id])).rows[0].snapshot
      assert.ok(!JSON.stringify({questionBindings:snapshot.questionBindings,questionSources:snapshot.questionSources,askedThisTurn:snapshot.askedThisTurn}).includes(quoteA))
      assert.ok(!JSON.stringify({questionBindings:snapshot.questionBindings,questionSources:snapshot.questionSources,askedThisTurn:snapshot.askedThisTurn}).includes(quoteB))
      assert.deepEqual(snapshot.askedThisTurn,[])
    })
    await t.test('a stable-memory correction revokes a growth projection backed by the same original source',async()=>{
      await settings(true)
      const text='我的专业是软件工程。',run=(await store.startRun(user,second,randomUUID(),text)).run,memorySnapshot=await loadSnapshot(user,second,text)
      const background=[{key:'education.major' as const,value:'软件工程',source:{messageId:run.source_message_id,quote:'软件工程'}}]
      const growth=await stageGrowthUpdates(run,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:run.source_message_id,quote:text.slice(0,-1)}}],await growthContext(user,second))
      const saved=await store.finishRun(run,{candidates:[],audit:[],snapshot:memorySnapshot,memoryChanges:await stageCoachBackground(user,second,run.source_message_id,background,memorySnapshot),growth},'已记录。',null,signal())
      const memory=(await pool.query("SELECT id,revision FROM memory_items WHERE user_id=$1 AND key='education.major' AND status='active' AND source_refs @> $2::jsonb",[user,JSON.stringify([{type:'message',messageId:run.source_message_id}])])).rows[0]
      assert.ok(memory,'the stable fact and growth projection share this exact message source')
      await applyMemoryAction(user,memory.id,{requestId:randomUUID(),expectedRevision:memory.revision,action:'correct',value:'计算机科学'})
      assert.ok(!(await growthContext(user,second)).some(item=>saved.growthCreatedIds.includes(item.id)),'the memory correction enters the shared durable source-control boundary used by growth and later model context')
    })
    await t.test('correcting an exact question-only source retires its canonical unknown and preserves the matter',async()=>{
      const actor='question-correction-'+randomUUID(),chat=randomUUID(),title='课程报告事项',unrelated='课程报告周五提交'
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:chat,title:'SYNTHETIC question correction'})
        const open=(await store.startRun(actor,chat,randomUUID(),`${title}。${unrelated}。`)).run
        const first=await store.finishRun(open,{candidates:[],audit:[],coach:await stageCoachEvent(open,{target:{operation:'create',title,source:source(open,title)},nodes:[{kind:'fact',source:source(open,unrelated)}]},'已记录。')},'已记录。',null,signal())
        const fact='我的专业是软件工程',question='软件工程会影响下一步吗？',run=(await store.startRun(actor,chat,randomUUID(),fact+'。')).run
        const snapshot=await loadSnapshot(actor,chat,fact)
        const memoryChanges=await stageCoachBackground(actor,chat,run.source_message_id,[{key:'education.major',value:'软件工程',source:source(run,'软件工程')}],snapshot)
        const event=first.event!
        const coach=await stageCoachEvent(run,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'unknown',question}]},question,[{content:fact,source:source(run,fact)}])
        const saved=await store.finishRun(run,{candidates:[],audit:[],snapshot,memoryChanges,coach},question,null,signal())
        const unknown=saved.event!.nodes.find(node=>node.kind==='unknown'&&node.content===question)!
        assert.ok(unknown&&saved.event!.asked.includes(question))
        assert.ok(!saved.event!.nodes.some(node=>node.kind==='fact'&&node.source?.messageId===run.source_message_id))
        const memory=(await pool.query("SELECT id,revision FROM memory_items WHERE user_id=$1 AND key='education.major' AND status='active'",[actor])).rows[0]
        await applyMemoryAction(actor,memory.id,{requestId:randomUUID(),expectedRevision:memory.revision,action:'correct',value:'计算机科学'})
        assert.equal((await pool.query('SELECT status FROM coach_nodes WHERE user_id=$1 AND id=$2',[actor,unknown.id])).rows[0]?.status,'withdrawn')
        const view=await coachEventView(actor,chat,event.id)
        assert.ok(!view?.asked.includes(question)&&view?.nodes.some(node=>node.content===unrelated))
        const revision=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[actor,event.id,saved.event!.revision])).rows[0].snapshot
        assert.ok(!revision.askedThisTurn.includes(question)&&!revision.currentQuestionBindings.some((entry:any)=>entry.question===question))
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('memory correction/forgetting withdraws event, material, snapshots and original source availability',async()=>{
      await settings(true)
      const text='我的专业是软件工程。请帮我写一份项目整理说明。',run=(await store.startRun(user,second,randomUUID(),text)).run
      const snapshot=await loadSnapshot(user,second,text)
      const background=[{key:'education.major' as const,value:'软件工程',source:{messageId:run.source_message_id,quote:'软件工程'}}]
      const reply='整理这次项目。'
      const staged:store.Staged={candidates:[],audit:[],snapshot,memoryChanges:await stageCoachBackground(user,second,run.source_message_id,background,snapshot),coach:await stageCoachEvent(run,{target:{operation:'create',title:'课程项目',source:source(run,text)},nodes:[{kind:'fact',source:source(run,'软件工程')}],action:{operation:'create',source:source(run,'请帮我写一份项目整理说明'),draft:{content:reply}}},reply)}
      const saved=await store.finishRun(run,staged,reply,null,signal())
      const memory=(await pool.query("SELECT id,revision FROM memory_items WHERE user_id=$1 AND key='education.major' AND status='active'",[user])).rows[0]
      await applyMemoryAction(user,memory.id,{requestId:randomUUID(),expectedRevision:memory.revision,action:'correct',value:'计算机科学'})
      const corrected=await coachEventView(user,second,saved.event!.id)
      assert.equal(corrected?.title,'部分来源已更新的事项')
      assert.equal(corrected?.nodes.length,0,'the corrected major is removed from the current event projection')
      assert.equal(corrected?.actions[0]?.status,'proposed','the independently requested material remains current')
      assert.equal(corrected?.actions[0]?.draft?.content,reply)
      const correctedHistory=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2',[user,saved.event!.id])).rows[0].snapshot
      assert.equal(correctedHistory.event.id,saved.event!.id,'a correction hides the current event without destroying its revision lineage')
      assert.ok(correctedHistory.event.nodes.some((node:any)=>node.source?.messageId===run.source_message_id),'the private historical source binding remains auditable until an explicit forget')
      const current=await loadSnapshot(user,second,'专业')
      assert.ok(current.profile.some(item=>item.key==='education.major'&&item.value==='计算机科学'))
      const readable=await redactGrowthHistory(user,[{id:run.source_message_id,role:'user',content:text}])
      assert.ok(!readable[0]!.content.includes('软件工程'),'the corrected fragment is unavailable without requiring blanket message suppression')
      assert.ok(readable[0]!.content.includes('我的专业是'),'unrelated source wording is retained')
      await applyMemoryAction(user,memory.id,{requestId:randomUUID(),expectedRevision:memory.revision+1,action:'forget'})
      assert.equal((await pool.query('SELECT generation FROM coach_events WHERE user_id=$1 AND id=$2',[user,saved.event!.id])).rows[0].generation,3)
      assert.equal((await coachEventView(user,second,saved.event!.id))?.actions[0]?.status,'proposed')
    })
  }finally{
    await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[[user,other]])
    await pool.end()
  }
})
