import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { config } from '../server/config.ts'
import { pool, transaction } from '../server/db.ts'
import * as store from '../server/store.ts'
import { stageCoachEvent, coachEventView, invalidateCoachSources } from '../server/action-coach-events.ts'
import { indexCoachEventOnce, searchCoachEvents } from '../server/coach-retrieval.ts'
import { localEmbedding } from '../server/local-embedding.ts'
import { importKnowledge, type KnowledgeCard } from '../server/campus-knowledge.ts'
import { validateCoachCitations } from '../server/coach-knowledge.ts'

if(!/^lifeos_dialogue_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname.slice(1)))throw new Error('ISOLATED_RECOVERY_ONLY')
const signal=new AbortController().signal
const title='SYNTHETIC Coach recovery'
async function forget(user:string,message:string){await transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings']);await invalidateCoachSources(c,user,[message],true)})}
async function create(user:string,conversation:string,text:string,card?:KnowledgeCard){
  const run=(await store.startRun(user,conversation,randomUUID(),text)).run
  const material='你好，上次资料在手机上打不开。我可以先把需要的部分发成文字，你现在还需要哪一部分？'
  const reply='这份消息仍是草稿，可以先发这段：\n'+material
  const coach=await stageCoachEvent(run,{target:{operation:'create',title:'交付资料后核对',source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}},{kind:'unknown',question:'现在是否还需要资料？'}],action:{operation:'create',draft:{content:material,stopWhen:'明确不需要时结束'}}},reply+'\n现在是否还需要资料？')
  if(card){const citation=await validateCoachCitations(coach.reply+'\n'+card.claim,[{sourceId:card.id,revision:card.revision,claim:card.claim,quote:card.excerpt,scope:card.scope}],[card],text);coach.reply=citation.text;coach.knowledgeRefs=citation.refs}
  const response=await store.finishRun(run,{candidates:[],audit:[],coach},coach.reply,null,signal)
  return {event:response.event!,message:run.source_message_id}
}
try{
  await localEmbedding.start()
  if(process.argv.includes('--seed')){
    const user=(await pool.query("SELECT id FROM \"user\" WHERE id LIKE 'lifeos-recovery-%' LIMIT 1")).rows[0].id
    const conversation=randomUUID();await store.createConversation(user,{id:conversation,title})
    const card:KnowledgeCard={id:randomUUID(),revision:1,kind:'method',status:'verified',synthetic:true,title:'SYNTHETIC Coach recovery source',url:'https://example.invalid/coach-recovery-source',publisher:'SYNTHETIC',publishedYear:'2026',verifiedAt:new Date().toISOString(),validUntil:null,claim:'这是一条合成恢复引用',excerpt:'这是一条合成恢复引用，仅用于验证恢复。',scope:'隔离恢复',limitations:'不是真实研究',mechanisms:['synthetic'],sourceHash:'c'.repeat(64)}
    await importKnowledge([card],true)
    const primary=await create(user,conversation,'我把资料发给同学，对方说手机打不开，所以没有看。',card)
    const forgottenChat=randomUUID();await store.createConversation(user,{id:forgottenChat,title:'SYNTHETIC Coach forgotten'})
    const discarded=await create(user,forgottenChat,'这是一段准备遗忘的合成过程。')
    await forget(user,discarded.message)
    for(let i=0;i<20;i++)if(!await indexCoachEventOnce())break
    const pendingChat=randomUUID();await store.createConversation(user,{id:pendingChat,title:'SYNTHETIC Coach pending'})
    const pending=await create(user,pendingChat,'我交付过一份项目清单，还没有收到回应。')
    await pool.query("UPDATE coach_index_jobs SET status='processing',locked_at=now()-interval '10 minutes',attempts=1 WHERE user_id=$1 AND event_id=$2",[user,pending.event.id])
    console.log(JSON.stringify({seeded:true,currentEvent:primary.event.id,nonemptyNodes:true,nonemptyAction:true,nonemptyIndex:true,pendingLease:true,withdrawalTombstone:true}))
  }else{
    const row=(await pool.query('SELECT c.user_id,c.id AS conversation_id FROM conversations c WHERE c.title=$1',[title])).rows[0]
    assert.ok(row,'restored conversation exists')
    const {user_id:user,conversation_id:conversation}=row
    const before=(await coachEventView(user,conversation))!
    assert.ok(before);assert.equal(before.nodes.length,2);assert.equal(before.actions[0].status,'proposed')
    assert.ok(before.actions[0].draft?.content)
    assert.equal(before.actions[0].knowledgeRefs?.length,1,'citation dependencies survive restore')
    const pending=(await pool.query("SELECT e.id FROM coach_events e JOIN conversations c ON c.user_id=e.user_id AND c.id=e.conversation_id WHERE c.title='SYNTHETIC Coach pending'")).rows[0]
    assert.ok(await indexCoachEventOnce(),'expired lease is reclaimed after restore')
    assert.ok((await pool.query('SELECT 1 FROM coach_semantic_index WHERE user_id=$1 AND event_id=$2',[user,pending.id])).rowCount)
    assert.equal((await searchCoachEvents(user,conversation,{query:'',actionId:before.actions[0].id})).events[0].id,before.id)
    const request=randomUUID(),text='恢复之后，我确认对方在电脑上打开了资料。',material='你好，知道你已在电脑上打开资料了。若仍需要某个部分，可以告诉我；不需要就到这里。'
    const run=(await store.startRun(user,conversation,request,text)).run
    const coach=await stageCoachEvent(run,{target:{operation:'continue',eventId:before.id,expectedRevision:before.revision},corrections:[{nodeId:before.nodes.find(node=>node.kind==='fact')!.id,source:{messageId:run.source_message_id,quote:text}}],action:{operation:'modify',actionId:before.actions[0].id,expectedRevision:before.actions[0].revision,draft:{content:material,stopWhen:'不需要则结束'}}},material)
    const saved=await store.finishRun(run,{candidates:[],audit:[],coach},material,null,signal)
    assert.equal(saved.event!.actions[0].id,before.actions[0].id)
    assert.equal(saved.event!.actions[0].draft?.content,material)
    assert.equal(saved.event!.nodes.find(node=>node.kind==='fact')!.content,text)
    const replay=await store.startRun(user,conversation,request,text)
    assert.equal(replay.replay,true);assert.equal(replay.run.response.event.id,before.id)
    await indexCoachEventOnce()
    await forget(user,run.source_message_id)
    const withdrawn=(await coachEventView(user,conversation))!
    assert.equal(withdrawn.actions[0].status,'stale');assert.equal(withdrawn.actions[0].draft,null)
    assert.ok(!JSON.stringify(withdrawn).includes(material))
    // Even a surviving title cannot restore the withdrawn fact or material.
    await indexCoachEventOnce()
    const reread=await searchCoachEvents(user,conversation,{query:'',eventId:before.id})
    assert.ok(!JSON.stringify(reread).includes(text));assert.ok(!JSON.stringify(reread).includes(material))
    const sourceId=before.actions[0].knowledgeRefs![0].sourceId
    const card=(await pool.query('SELECT payload FROM campus_knowledge WHERE id=$1',[sourceId])).rows[0].payload as KnowledgeCard
    const citedRun=(await pool.query('SELECT request_id FROM coach_reply_sources WHERE user_id=$1 AND source_id=$2',[user,sourceId])).rows[0]
    await importKnowledge([{...card,revision:card.revision+1,status:'revoked'}],true)
    assert.equal((await store.runStatus(user,citedRun.request_id)).response.sourcesInvalidated,true)
    assert.ok(!(await store.listConversations(user)).flatMap(chat=>chat.messages).some((message:any)=>message.role==='assistant'&&message.content.includes(card.url)))
    console.log(JSON.stringify({continuedWrite:true,currentEventReadable:true,materialReadable:true,sameActionModified:true,exactSourceCorrection:true,idempotentReplay:true,expiredLeaseRecovered:true,withdrawalAfterRestore:true,noResurrection:true,citationDependencyRestored:true,citationRevocationAfterRestore:true}))
  }
}finally{await localEmbedding.close();await pool.end()}
