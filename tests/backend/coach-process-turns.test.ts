import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {pool,transaction} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {stageCoachEvent,coachEventView,invalidateCoachSources,type CoachProcessTurn} from '../../server/action-coach-events.ts'
import {buildTurnPrompt,providerTurnMessages} from '../../server/turn-prompt.ts'

test('event process turns preserve exact input/question chronology across old dialogue without inferring answers and exclude suppressed sources',async()=>{
  const user='process-turns-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC process chronology'})
  let event:any
  const sources:string[]=[]
  async function turn(input:string,reply:string,unknownOnly=false){const run=(await store.startRun(user,chat,randomUUID(),input)).run;sources.push(run.source_message_id);const target=event?{operation:'continue' as const,eventId:event.id,expectedRevision:event.revision}:{operation:'create' as const,title:'交付资料',source:{messageId:run.source_message_id,quote:input}};const saved=JSON.parse(readFileSync('tests/fixtures/coach-unknown-only-repeat.json','utf8'));const coach=await stageCoachEvent(run,{target,nodes:unknownOnly?saved.event.nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:input}}]},reply);event=(await store.finishRun(run,{candidates:[],audit:[],coach},reply,null,signal)).event;return run}
  try{
    await turn('我把资料发给同学，他说打不开。','你当时怎样联系他的？')
    await turn('这个细节我记不清了。','好，先保留未知。你当时想帮他解决什么问题？')
    assert.deepEqual(event.processTurns.map((t:CoachProcessTurn)=>[event.nodes.find((n:{id:string})=>n.id===t.nodeIds[0]).source.quote,t.questionsAskedAfterInput]),[['我把资料发给同学，他说打不开。',['你当时怎样联系他的？']],['这个细节我记不清了。',['你当时想帮他解决什么问题？']]])
    assert.deepEqual((await coachEventView(user,chat))!.processTurns,event.processTurns,'saved response and fresh view agree')
    const unknown=await turn('这个细节我记不清了。','好，先保留未知。你最初为什么想整理资料？',true)
    assert.ok(!event.nodes.some((node:any)=>node.source?.messageId===unknown.source_message_id),'saved real unknown-only delta does not invent a fact source')
    const unknownTurn=event.processTurns.find((turn:any)=>turn.sourceMessageId===unknown.source_message_id)
    assert.ok(unknownTurn,'unknown-only input must remain in event chronology')
    assert.deepEqual(unknownTurn.inputSources,[{messageId:unknown.source_message_id,conversationId:chat,quote:'这个细节我记不清了。'}])
    const introducedUnknownId=event.nodes.find((node:any)=>node.kind==='unknown').id
    assert.deepEqual(unknownTurn.introducedUnknownNodeIds,[introducedUnknownId],'unknown question has its actual introduction turn even without a user-fact source')
    const recentPrompt=JSON.parse(buildTurnPrompt({currentMessageId:unknown.source_message_id,messages:await store.contextForRun(unknown),currentEvent:await coachEventView(user,chat)}))
    assert.equal(recentPrompt.currentEvent.processTurns.find((turn:any)=>turn.sourceMessageId===unknown.source_message_id).inputSources,undefined,'recent input already has its original role, without duplicate text')
    const refusal=await turn('原因我不想讲。','好，先不问原因。',true)
    assert.deepEqual(event.processTurns.find((turn:any)=>turn.sourceMessageId===refusal.source_message_id).inputSources,[{messageId:refusal.source_message_id,conversationId:chat,quote:'原因我不想讲。'}],'literal input retention also handles refusal without labeling it')
    assert.equal(event.processTurns.find((turn:any)=>turn.sourceMessageId===refusal.source_message_id).introducedUnknownNodeIds,undefined,'reusing an existing unknown does not pretend it was introduced again')
    for(let i=0;i<45;i++){const run=(await store.startRun(user,chat,randomUUID(),'无关完整历史'+i+'：'+'其他事情。'.repeat(120))).run;await store.finishRun(run,{candidates:[],audit:[]},'这是无关合成回复。',null,signal)}
    const current=(await store.startRun(user,chat,randomUUID(),'回来继续上次交付资料这件事。')).run
    const context=await store.contextForRun(current),prompt=buildTurnPrompt({currentMessageId:current.source_message_id,messages:context,currentEvent:await coachEventView(user,chat)})
    const metadata=JSON.parse(providerTurnMessages(prompt,{provider:'openai',id:'qwen3.8-flash'})[0].content as string)
    assert.ok(!metadata.messages.some((m:{id:string})=>m.id===sources[1]),'ordinary old message is outside bounded dialogue history')
    const oldTurn=metadata.currentEvent.processTurns[1],oldQuote=metadata.currentEvent.nodes.find((n:{id:string})=>n.id===oldTurn.nodeIds[0]).source
    assert.equal(oldTurn.sourceMessageId,sources[1]);assert.equal(oldQuote.messageId,sources[1]);assert.equal(oldQuote.quote,'这个细节我记不清了。')
    assert.equal(Object.hasOwn(metadata.currentEvent.processTurns[1],'answered'),false)
    assert.deepEqual(metadata.currentEvent.processTurns.find((turn:any)=>turn.sourceMessageId===unknown.source_message_id).inputSources,unknownTurn.inputSources,'old non-node original survives outside bounded role history')
    assert.deepEqual(metadata.currentEvent.processTurns.find((turn:any)=>turn.sourceMessageId===unknown.source_message_id).introducedUnknownNodeIds,[introducedUnknownId],'question introduction remains explicit outside the bounded role history')
    assert.equal(metadata.currentEvent.processTurns.find((turn:any)=>turn.sourceMessageId===refusal.source_message_id).inputSources[0].quote,'原因我不想讲。')
    await store.terminateRun(user,current.request_id,'cancelled','SYNTHETIC_DONE')
    await transaction(async c=>{await c.query('INSERT INTO memory_suppressions(user_id,source_message_id,source_conversation_id,key) VALUES($1,$2,$3,$4)',[user,sources[1],chat,'*'])})
    assert.ok(!(await coachEventView(user,chat))!.processTurns!.some(t=>t.sourceMessageId===sources[1]))
    await transaction(async c=>{await c.query('INSERT INTO memory_suppressions(user_id,source_message_id,source_conversation_id,key) VALUES($1,$2,$3,$4)',[user,unknown.source_message_id,chat,'*'])})
    assert.ok(!(await coachEventView(user,chat))!.processTurns!.some(t=>t.sourceMessageId===unknown.source_message_id),'suppressed unknown original cannot return as historical input')
    await transaction(async c=>{await c.query('INSERT INTO memory_suppressions(user_id,source_message_id,source_conversation_id,key) VALUES($1,$2,$3,$4)',[user,refusal.source_message_id,chat,'*'])})
    assert.ok(!(await coachEventView(user,chat))!.processTurns!.some(t=>t.sourceMessageId===refusal.source_message_id))
    const originalNode=event.nodes.find((node:any)=>node.source?.messageId===sources[0])
    const corrected=(await store.startRun(user,chat,randomUUID(),'更正一下，他说电脑能打开，只是手机打不开。')).run
    const delta=await stageCoachEvent(corrected,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},corrections:[{nodeId:originalNode.id,source:{messageId:corrected.source_message_id,quote:'更正一下，他说电脑能打开，只是手机打不开。'}}]},'已保留这次更正。')
    event=(await store.finishRun(corrected,{candidates:[],audit:[],coach:delta},'已保留这次更正。',null,signal)).event
    assert.ok(!event.processTurns.some((turn:any)=>turn.sourceMessageId===sources[0]),'corrected old full-node quote cannot return as a non-node input')
    const withdrawn=await turn('这个后续细节我不想再讲。','好，先保留这个未知。',true)
    const beforeWithdrawal=event
    const concurrent=(await store.startRun(user,chat,randomUUID(),'继续核对尚未明确的部分。')).run
    await transaction(async c=>{await invalidateCoachSources(c,user,[withdrawn.source_message_id],true)})
    event=await coachEventView(user,chat)
    assert.ok(event.generation>beforeWithdrawal.generation,'withdrawing a non-node historical input invalidates the event evidence generation')
    assert.ok(!event.processTurns.some((turn:any)=>turn.inputSources?.some((source:any)=>source.messageId===withdrawn.source_message_id)))
    await assert.rejects(store.finishRun(concurrent,{candidates:[],audit:[],usedEventRefs:[{eventId:beforeWithdrawal.id,revision:beforeWithdrawal.revision,generation:beforeWithdrawal.generation}]},'尚未保存的模拟回复。',null,signal),(error:any)=>error.code==='COACH_SNAPSHOT_INVALIDATED')
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE run_request_id=$1 AND role='assistant'",[concurrent.request_id])).rows[0].n,0)
    await store.terminateRun(user,concurrent.request_id,'cancelled','SYNTHETIC_WITHDRAWAL_RACE_DONE')
    for(let i=0;i<10;i++)await turn('继续记录第'+i+'个已知步骤。','这一步之后对方说了什么？')
    assert.equal(event.processTurns.length,8);assert.equal(event.processTurns[0].revision,10)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM coach_event_revisions WHERE user_id=$1 AND snapshot->'event' ? 'processTurns'",[user])).rows[0].n,0,'chronology is not recursively copied into snapshots')
    const other=randomUUID();await store.createConversation(user,{id:other,title:'SYNTHETIC memory disabled'})
    await assert.rejects(coachEventView(user,other,event.id),(e:any)=>e.code==='MEMORY_DISABLED')
  }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('unknown introduction is historical question metadata, not an unanswered label, and disappears after correction to fact',async()=>{
  const user='unknown-origin-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  try{
    await store.createConversation(user,{id:chat,title:'SYNTHETIC unknown origin'})
    const first=(await store.startRun(user,chat,randomUUID(),'我邀请同学一起排练。')).run
    const delta=await stageCoachEvent(first,{target:{operation:'create',title:'排练邀请',source:{messageId:first.source_message_id,quote:'我邀请同学一起排练。'}},nodes:[{kind:'fact',source:{messageId:first.source_message_id,quote:'我邀请同学一起排练。'}},{kind:'unknown',question:'排练时间是怎样商定的？'}]},'排练时间是怎样商定的？')
    let event=(await store.finishRun(first,{candidates:[],audit:[],coach:delta},'排练时间是怎样商定的？',null,signal)).event!
    const unknown=event.nodes.find(n=>n.kind==='unknown')!
    assert.deepEqual(event.processTurns![0].introducedUnknownNodeIds,[unknown.id])
    const answer=(await store.startRun(user,chat,randomUUID(),'我们商量定在周五。')).run
    const resolved=await stageCoachEvent(answer,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:answer.source_message_id,quote:'我们商量定在周五。'}}],resolveUnknowns:[unknown.id]},'已保留你补充的约定。')
    event=(await store.finishRun(answer,{candidates:[],audit:[],coach:resolved},'已保留你补充的约定。',null,signal)).event!
    assert.equal(event.nodes.find(n=>n.id===unknown.id)!.status,'resolved')
    assert.deepEqual(event.processTurns![0].introducedUnknownNodeIds,[unknown.id],'resolved question still has an introduction; metadata does not call it unanswered')
    const correction=(await store.startRun(user,chat,randomUUID(),'更正一下，时间是同学提议的周四。')).run
    const changed=await stageCoachEvent(correction,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},corrections:[{nodeId:unknown.id,source:{messageId:correction.source_message_id,quote:'更正一下，时间是同学提议的周四。'}}]},'保留更正后的原话。')
    event=(await store.finishRun(correction,{candidates:[],audit:[],coach:changed},'保留更正后的原话。',null,signal)).event!
    assert.equal(event.nodes.find(n=>n.id===unknown.id)!.kind,'fact')
    assert.ok(event.processTurns!.every(turn=>!turn.introducedUnknownNodeIds?.includes(unknown.id)),'corrected fact cannot be returned as an old unknown question')
  }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('an explicit refusal remains an unknown with its own disposition and is not presented as answered',async()=>{
  const user='declined-unknown-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC declined unknown'})
  try{
    const opening=(await store.startRun(user,chat,randomUUID(),'我联系小林问资料需求。')).run
    const created=await stageCoachEvent(opening,{target:{operation:'create',title:'询问资料需求',source:{messageId:opening.source_message_id,quote:'我联系小林问资料需求。'}},nodes:[{kind:'unknown',question:'当时你为什么决定联系小林？'}]},'你当时为什么决定联系小林？')
    const first=(await store.finishRun(opening,{candidates:[],audit:[],coach:created},created.reply,null,signal)).event!
    const question=first.nodes.find(node=>node.kind==='unknown')!
    const refusal=(await store.startRun(user,chat,randomUUID(),'这个原因我不想讲，我们先继续别的。')).run
    const continued=await stageCoachEvent(refusal,{target:{operation:'continue',eventId:first.id,expectedRevision:first.revision},declineUnknowns:[question.id]},'好，我不再追问这个原因。我们可以接着聊你愿意说的部分。')
    const saved=(await store.finishRun(refusal,{candidates:[],audit:[],coach:continued},continued.reply,null,signal)).event!
    const declined=saved.nodes.find(node=>node.id===question.id)!
    assert.equal(declined.kind,'unknown')
    assert.equal(declined.status,'declined')
    assert.equal(declined.content,'当时你为什么决定联系小林？')
    assert.equal((await coachEventView(user,chat))!.nodes.find(node=>node.id===question.id)!.status,'declined')
    const prompt=JSON.parse(buildTurnPrompt({currentMessageId:refusal.source_message_id,messages:await store.contextForRun(refusal),currentEvent:saved}))
    assert.equal(prompt.currentEvent.nodes.find((node:any)=>node.id===question.id).status,'declined')
    const followup=(await store.startRun(user,chat,randomUUID(),'我们继续聊愿意说的部分。')).run
    const target={operation:'continue' as const,eventId:saved.id,expectedRevision:saved.revision}
    await assert.rejects(stageCoachEvent(followup,{target,resolveUnknowns:[question.id]},'已回答。'),(error:any)=>error.code==='COACH_UNKNOWN_NOT_FOUND')
    await assert.rejects(stageCoachEvent(followup,{target,resolveUnknowns:[question.id],declineUnknowns:[question.id]},'继续。'),(error:any)=>error.code==='COACH_UNKNOWN_DISPOSITION_CONFLICT')
    await store.terminateRun(user,followup.request_id,'cancelled','SYNTHETIC_DONE')
    const correction=(await store.startRun(user,chat,randomUUID(),'更正一下，当时我想尽快帮小林复习。')).run
    const corrected=await stageCoachEvent(correction,{target:{operation:'continue',eventId:saved.id,expectedRevision:saved.revision},corrections:[{nodeId:question.id,source:{messageId:correction.source_message_id,quote:'当时我想尽快帮小林复习'}}]},'已把你愿意补充的原因接回这件事。')
    const resumed=(await store.finishRun(correction,{candidates:[],audit:[],coach:corrected},corrected.reply,null,signal)).event!
    const answered=resumed.nodes.find(node=>node.id===question.id)!
    assert.equal(answered.kind,'fact')
    assert.equal(answered.status,'active')
    assert.equal(answered.content,'当时我想尽快帮小林复习')
  }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})
