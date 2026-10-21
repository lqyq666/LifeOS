import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { loadSnapshot, stageCoachBackground, setMemorySettings, applyMemoryAction } from '../../server/memory.ts'
import { coachEventView, stageCoachEvent } from '../../server/action-coach-events.ts'
import type { EventDelta } from '../../server/action-coach-contracts.ts'

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
      const text='我花了三小时整理四十页，对方说手机打不开。我有点失望。'
      const run=(await store.startRun(user,conversation,randomUUID(),text)).run
      const material='上次的网盘手机打不开。你现在还需要哪一个知识点？不需要也没关系。'
      const reply='目前确认的是打开障碍，内容是否有帮助还没有检验。可以先发这段：\n'+material
      const delta:EventDelta={target:{operation:'create',title:'整理资料后的反馈',source:source(run,text)},nodes:[{kind:'fact',source:source(run,'对方说手机打不开')},{kind:'feeling',source:source(run,'我有点失望')},{kind:'unknown',question:'对方现在是否仍然需要资料？'}],action:{operation:'create',draft:{content:material,observable:'对方明确需要哪一部分，或已经不需要。',stopWhen:'不需要就结束；未回复只记未回复。'}}}
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
      const run=(await store.startRun(user,conversation,randomUUID(),'我暂时没收到新回复。')).run
      const target:EventDelta['target']={operation:'continue',eventId,expectedRevision:eventRevision}
      await assert.rejects(stageCoachEvent(run,{target,nodes:[{kind:'fact',source:source(run,'他说不需要了')} ]},'这是等待。'),(error:any)=>error.code==='COACH_SOURCE_INVALID')
      await assert.rejects(stageCoachEvent(run,{target,action:{operation:'modify',actionId,expectedRevision:actionRevision,draft:{content:'另一份没有显示的计划'}}},'只显示一句。'),(error:any)=>error.code==='COACH_MATERIAL_NOT_VISIBLE')
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
      await stageCoachEvent(run,{target,action:{operation:'modify',actionId,expectedRevision:actionRevision,draft:oldDraft}},oldDraft.content)
      const material='你现在还需要哪一部分资料？不需要也没关系。'
      const reply='可以这样发：\n'+material
      const staged={candidates:[],audit:[],coach:await stageCoachEvent(run,{target,action:{operation:'modify',actionId,expectedRevision:actionRevision,draft:{content:material}}},reply)}
      await assert.rejects(store.finishRun(run,staged,'与刚才不同的回复',null,signal()),(error:any)=>error.code==='COACH_REPLY_MISMATCH')
      const saved=await store.finishRun(run,staged,reply,null,signal())
      eventRevision=saved.event!.revision;actionRevision=saved.event!.actions[0]!.revision
      assert.equal(saved.event!.actions.length,1)
      assert.equal(saved.event!.actions[0]!.id,actionId)
      assert.equal(saved.event!.actions[0]!.draft?.content,material)
      assert.equal(saved.event!.actions[0]!.status,'proposed')
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
    await t.test('memory correction/forgetting withdraws event, material, snapshots and original source availability',async()=>{
      await settings(true)
      const text='我的专业是软件工程。',run=(await store.startRun(user,second,randomUUID(),text)).run
      const snapshot=await loadSnapshot(user,second,text)
      const background=[{key:'education.major' as const,value:'软件工程',source:{messageId:run.source_message_id,quote:'软件工程'}}]
      const reply='整理这次项目。'
      const staged:store.Staged={candidates:[],audit:[],snapshot,memoryChanges:await stageCoachBackground(user,second,run.source_message_id,background,snapshot),coach:await stageCoachEvent(run,{target:{operation:'create',title:'课程项目',source:source(run,text)},nodes:[{kind:'fact',source:source(run,'软件工程')}],action:{operation:'create',draft:{content:reply}}},reply)}
      const saved=await store.finishRun(run,staged,reply,null,signal())
      const memory=(await pool.query("SELECT id,revision FROM memory_items WHERE user_id=$1 AND key='education.major' AND status='active'",[user])).rows[0]
      await applyMemoryAction(user,memory.id,{requestId:randomUUID(),expectedRevision:memory.revision,action:'correct',value:'计算机科学'})
      assert.equal(await coachEventView(user,second),null)
      await assert.rejects(coachEventView(user,second,saved.event!.id),(error:any)=>error.code==='NOT_FOUND')
      assert.equal((await pool.query('SELECT draft FROM coach_actions WHERE user_id=$1 AND event_id=$2',[user,saved.event!.id])).rows[0].draft,null)
      assert.deepEqual((await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2',[user,saved.event!.id])).rows[0].snapshot,{withdrawn:true})
      assert.ok((await loadSnapshot(user,second,'专业')).suppressedMessageIds?.includes(run.source_message_id))
      await applyMemoryAction(user,memory.id,{requestId:randomUUID(),expectedRevision:memory.revision+1,action:'forget'})
      assert.equal((await pool.query('SELECT generation FROM coach_events WHERE user_id=$1 AND id=$2',[user,saved.event!.id])).rows[0].generation,3)
    })
  }finally{
    await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[[user,other]])
    await pool.end()
  }
})
