import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {coachEventView,stageCoachEvent} from '../../server/action-coach-events.ts'
import type {EventDelta} from '../../server/action-coach-contracts.ts'

test('a new job question preserves the portfolio and each material owns its request lineage',async()=>{
 const user='independent-material-'+randomUUID(),chat=randomUUID(),next=randomUUID()
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await store.createConversation(user,{id:chat,title:'Synthetic independent materials'})
 await store.createConversation(user,{id:next,title:'Synthetic continuation'})
 const submit=async(text:string,delta:(run:store.Run)=>EventDelta)=>{
  const run=(await store.startRun(user,chat,randomUUID(),text)).run
  const change=delta(run),reply=change.action&&'draft'in change.action&&'content'in change.action.draft?change.action.draft.content:'已停止使用岗位问题，保留作品描述。'
  const coach=await stageCoachEvent(run,change,reply)
  return (await store.finishRun(run,{candidates:[],audit:[],coach},reply,null,new AbortController().signal)).event!
 }
 try{
  let event=await submit('我负责整理资料和排版。帮我写一段本人贡献描述。',run=>({target:{operation:'create',title:'实习探索',source:{messageId:run.source_message_id,quote:'我负责整理资料和排版'}},action:{operation:'create',draft:{content:'在课程小组中，我负责整理资料和排版。'}}}))
  const portfolio=structuredClone(event.actions[0])
  event=await submit('另帮我拟一个向学长核对岗位要求的问题，不替我判断适合。',()=>({target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',draft:{content:'学长，这个岗位日常主要交付哪些工作成果？'}}}))
  assert.deepEqual(event.actions.find(a=>a.id===portfolio.id),portfolio,'unrelated material must not close, bump revision, or inherit another drafting request')
  assert.equal(event.actions.filter(a=>a.status==='proposed').length,2)
  const question=structuredClone(event.actions.find(a=>a.id!==portfolio.id)!)
  assert.ok(!question.requestSources?.some(s=>s.quote.includes('本人贡献描述')))
  event=await submit('把原来的本人贡献描述改短，不改岗位问题。',()=>({target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId:portfolio.id,expectedRevision:portfolio.revision,draft:{content:'我负责课程小组的资料整理与排版。'}}}))
  const rewritten=event.actions.find(a=>a.id===portfolio.id)!
  assert.equal(rewritten.revision,portfolio.revision+1)
  assert.equal(rewritten.status,'proposed')
  assert.ok(!rewritten.requestSources?.some(s=>s.quote.includes('核对岗位要求')),'modify lineage excludes requests for the other artifact')
  assert.deepEqual(event.actions.find(a=>a.id===question.id),question)
  const sourceIds=(await pool.query('SELECT source_message_ids FROM coach_actions WHERE id=$1',[portfolio.id])).rows[0].source_message_ids
  const questionSources=(await pool.query('SELECT source_message_ids FROM coach_actions WHERE id=$1',[question.id])).rows[0].source_message_ids
  assert.ok(!sourceIds.includes(questionSources.at(-1)),'unrelated command must not become a retained material dependency')
  event=await submit('岗位问题先不用了，保留作品描述。',()=>({target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'close',actionId:question.id,expectedRevision:question.revision,reason:'本人暂不使用岗位问题'}}))
  assert.deepEqual(event.actions.find(a=>a.id===portfolio.id),rewritten)
  assert.equal(event.actions.find(a=>a.id===question.id)?.status,'closed')
  assert.equal(event.actions.find(a=>a.id===question.id)?.closedReason,'本人暂不使用岗位问题')
  await assert.rejects(()=>coachEventView(user,next,event.id),/MEMORY_DISABLED/)
  await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1) ON CONFLICT(user_id) DO UPDATE SET enabled=true,revision=user_memory_settings.revision+1',[user])
  const restored=await coachEventView(user,next,event.id)
  assert.deepEqual(restored?.actions,event.actions,'normal new-session readback retains separate states')
  const run=(await store.startRun(user,chat,randomUUID(),'把岗位问题改短。')).run
  await assert.rejects(()=>stageCoachEvent(run,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId:question.id,expectedRevision:question.revision+1,draft:{content:'岗位主要做什么？'}}},'新稿'),/COACH_ACTION_CLOSED/)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user]);await pool.end()}
})
