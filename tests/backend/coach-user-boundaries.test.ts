import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {coachEventView,stageCoachEvent,coachInputCovered,invalidateCoachSources} from '../../server/action-coach-events.ts'
import {transaction} from '../../server/db.ts'
import {buildTurnPrompt} from '../../server/turn-prompt.ts'
import type {EventDelta} from '../../server/action-coach-contracts.ts'

const signal=new AbortController().signal
async function prepare(withAction=true){
  const user='user-boundary-'+randomUUID(),conversation=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:conversation,title:'SYNTHETIC boundary'})
  const text='帮我写一句确认需求的消息。',run=(await store.startRun(user,conversation,randomUUID(),text)).run
  const content='你现在还需要这份资料吗？不需要也没关系。'
  const staged=await stageCoachEvent(run,{target:{operation:'create',title:'确认需求',source:{messageId:run.source_message_id,quote:text}},...(withAction?{action:{operation:'create' as const,draft:{content}}}:{})},withAction?content:'先保留这个请求。')
  await store.finishRun(run,{candidates:[],audit:[],coach:staged},staged.reply,null,signal)
  return {user,conversation}
}

test('an existing authorized request can complete after a context answer without a new drafting password',async()=>{
  const base=await prepare(false)
  try{
    const event=(await coachEventView(base.user,base.conversation))!,run=(await store.startRun(base.user,base.conversation,randomUUID(),'这些就是事情经过。')).run
    const content='你现在还需要那份资料吗？不需要也没关系。'
    const staged=await stageCoachEvent(run,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',draft:{content}}},content)
    await store.finishRun(run,{candidates:[],audit:[],coach:staged},content,null,signal)
    assert.equal((await coachEventView(base.user,base.conversation))!.actions[0]!.draft!.content,content)
  }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[base.user])}
})

test('other sending methods are narrative context, not a command to stop sending',async()=>{
  const base=await prepare(false)
  try{
    const event=(await coachEventView(base.user,base.conversation))!
    const text='用途说明和有没有再试别的发送方式，这两个细节我记不清了。'
    const run=(await store.startRun(base.user,base.conversation,randomUUID(),text)).run
    const content='你现在还需要那份资料吗？不需要也没关系。'
    const staged=await stageCoachEvent(run,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',draft:{content}}},content)
    await store.finishRun(run,{candidates:[],audit:[],coach:staged},content,null,signal)
    assert.equal((await coachEventView(base.user,base.conversation))!.actions[0]!.draft!.content,content)
  }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[base.user])}
})

test('explicit decline blocks framed or bare create/modify with or without a question, and close respects stopping',async()=>{
  for(const text of ['不要帮我写消息，只想聊聊。','不写消息了，只想聊聊。','不要改这份消息，先聊聊。','先别联系他，只想聊聊。']){
    const base=await prepare()
    try{
      for(const operation of ['create','modify'] as const)for(const content of ['你现在还需要哪一部分？','我把资料发给你。'])for(const framed of [true,false]){
        const event=(await coachEventView(base.user,base.conversation))!,action=event.actions[0]!
        const run=(await store.startRun(base.user,base.conversation,randomUUID(),text)).run
        const change:NonNullable<EventDelta['action']>=operation==='create'?{operation,draft:{content}}:{operation,actionId:action.id,expectedRevision:action.revision,draft:{content}}
        await assert.rejects(stageCoachEvent(run,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:change},(framed?'可以直接发这句：\n':'')+content),(error:any)=>error.code==='COACH_ACTION_DECLINED',`${text}/${operation}/${framed}/${content}`)
        await store.terminateRun(base.user,run.request_id,'cancelled','SYNTHETIC_DONE')
        assert.deepEqual((await coachEventView(base.user,base.conversation))!.actions,event.actions)
      }
      const event=(await coachEventView(base.user,base.conversation))!,run=(await store.startRun(base.user,base.conversation,randomUUID(),text)).run
      const closed=await stageCoachEvent(run,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'close',actionId:event.actions[0]!.id,expectedRevision:event.actions[0]!.revision,reason:'用户暂停联系'}},'好，先不联系。')
      await store.finishRun(run,{candidates:[],audit:[],coach:closed},closed.reply,null,signal)
      assert.equal((await coachEventView(base.user,base.conversation))!.actions[0]!.status,'closed')
      const stopped=(await coachEventView(base.user,base.conversation))!,ack=(await store.startRun(base.user,base.conversation,randomUUID(),'好的。')).run
      const content='你好，我把资料发给你。'
      await assert.rejects(stageCoachEvent(ack,{target:{operation:'continue',eventId:stopped.id,expectedRevision:stopped.revision},action:{operation:'create',draft:{content}}},'可以直接发这句：'+content),(error:any)=>error.code==='COACH_ACTION_DECLINED','an acknowledgement does not override the authorized stop request')
      await store.terminateRun(base.user,ack.request_id,'cancelled','SYNTHETIC_DONE')
      const renewed=(await store.startRun(base.user,base.conversation,randomUUID(),'现在帮我写一句确认消息。')).run
      const resumed=await stageCoachEvent(renewed,{target:{operation:'continue',eventId:stopped.id,expectedRevision:stopped.revision},action:{operation:'create',draft:{content}}},content)
      await store.finishRun(renewed,{candidates:[],audit:[],coach:resumed},content,null,signal)
    }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[base.user])}
  }
})

test('precheck and persistence have one duplicate decision with no residual character threshold',()=>{
  const source=readFileSync(new URL('../../server/action-coach-events.ts',import.meta.url),'utf8')
  assert.equal(/length\s*<\s*8/.test(source),false,'residual persistence policy must be removed, not described as observed data loss')
  assert.ok(source.includes('async function coachNodeSource'), 'both paths must share the source and duplicate decision')
  assert.ok((source.match(/await coachNodeSource\(/g)??[]).length>=2)
})

test('the same input collection survives precheck, commit and next-turn context; withdrawal and revision changes still block commit',async()=>{
  const old='他收到资料了。',original='我交付了资料。'
  const samples=[['只剩两小时',false],['改成周五',false],['不用联系了',false],['他拒绝了',false],['好的',false],[original,true]] as const
  const base=await prepare()
  try{
    let event=(await coachEventView(base.user,base.conversation))!
    const seedText=original+old,seed=(await store.startRun(base.user,base.conversation,randomUUID(),seedText)).run
    const seeded=await stageCoachEvent(seed,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:seed.source_message_id,quote:original}},{kind:'fact',source:{messageId:seed.source_message_id,quote:old}}]},'保留原话。')
    await store.finishRun(seed,{candidates:[],audit:[],coach:seeded},seeded.reply,null,signal)
    event=(await coachEventView(base.user,base.conversation))!
    for(const [text,covered] of samples){
      assert.equal(coachInputCovered(text,[old,original]),covered)
      const run=(await store.startRun(base.user,base.conversation,randomUUID(),text)).run
      const delta:EventDelta={target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:old}}]}
      if(covered){
        const staged=await stageCoachEvent(run,delta,'收到。')
        await store.finishRun(run,{candidates:[],audit:[],coach:staged},staged.reply,null,signal)
      }else{
        await assert.rejects(stageCoachEvent(run,delta,'收到。'),(error:any)=>error.code==='COACH_SOURCE_INVALID',text+' precheck')
        await assert.rejects(store.finishRun(run,{candidates:[],audit:[],coach:{delta,eventId:event.id,reply:'收到。'}},'收到。',null,signal),(error:any)=>error.code==='COACH_SOURCE_INVALID',text+' commit recheck')
        // Repair may omit nodes: a constraint or acknowledgement need not be
        // promoted to a stronger fact to stay traceable for the next turn.
        const staged=await stageCoachEvent(run,{target:delta.target},'收到。')
        await store.finishRun(run,{candidates:[],audit:[],coach:staged},staged.reply,null,signal)
      }
      event=(await coachEventView(base.user,base.conversation))!
      assert.equal(event.nodes.filter(node=>node.content===old).length,1)
      const sources=event.processTurns!.at(-1)!.inputSources!
      assert.ok(sources.some(source=>source.quote===text),text+' input source remains literal')
      const nextId=randomUUID(),prompt=JSON.parse(buildTurnPrompt({currentMessageId:nextId,messages:[{id:nextId,role:'user',content:'接着说。'} as any],currentEvent:event}))
      assert.ok(JSON.stringify(prompt.currentEvent.processTurns).includes(text),text+' next-turn authorized context')
    }
    const withdrawal=(await store.startRun(base.user,base.conversation,randomUUID(),'只剩两小时')).run
    const withdrawn=await stageCoachEvent(withdrawal,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:withdrawal.source_message_id,quote:'只剩两小时'}}]},'收到。')
    await transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[base.user+':memory-settings']);await invalidateCoachSources(c,base.user,[withdrawal.source_message_id],true)})
    await assert.rejects(store.finishRun(withdrawal,{candidates:[],audit:[],coach:withdrawn},'收到。',null,signal),(error:any)=>['COACH_SOURCE_INVALID','COACH_SOURCE_REVOKED','COACH_EVENT_REVISION_CONFLICT','COACH_SNAPSHOT_INVALIDATED'].includes(error.code))
    await store.terminateRun(base.user,withdrawal.request_id,'cancelled','SYNTHETIC_DONE')
    const view=(await coachEventView(base.user,base.conversation))!
    assert.ok(!JSON.stringify(view.processTurns).includes(withdrawal.source_message_id),'withdrawn input is unavailable')
    const conflict=(await store.startRun(base.user,base.conversation,randomUUID(),'改成周五')).run
    const staged=await stageCoachEvent(conflict,{target:{operation:'continue',eventId:view.id,expectedRevision:view.revision}},'收到。')
    await pool.query('UPDATE coach_events SET revision=revision+1 WHERE user_id=$1 AND id=$2',[base.user,view.id])
    await assert.rejects(store.finishRun(conflict,{candidates:[],audit:[],coach:staged},'收到。',null,signal),(error:any)=>['COACH_EVENT_REVISION_CONFLICT','COACH_SNAPSHOT_INVALIDATED'].includes(error.code))
  }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[base.user])}
})
