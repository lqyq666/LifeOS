import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {stageCoachEvent} from '../../server/action-coach-events.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {feedbackLoopStats,type LoopReview} from '../../server/feedback-loop-operations.ts'
import {createHash} from 'node:crypto'

test('loop operations count choices and verified outcomes, never messages as value',async()=>{
 const user='loop-ops-'+randomUUID(),peer='loop-ops-peer-'+randomUUID(),chat=randomUUID(),from=new Date(Date.now()-1000).toISOString(),budget='SYNTHETIC-'+randomUUID()
 const until=async()=>new Date((await pool.query('SELECT clock_timestamp() AS value')).rows[0].value.getTime()+1).toISOString()
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0});await store.createConversation(user,{id:chat,title:'SYNTHETIC operations'})
  const text='我想核对岗位要求，请帮我拟一个核对步骤。',run=(await store.startRun(user,chat,randomUUID(),text)).run,material='先核对一项岗位要求，不清楚的保持未知。'
  const delta={target:{operation:'create' as const,title:'核对岗位要求',source:{messageId:run.source_message_id,quote:text}},action:{operation:'create' as const,draft:{content:material}}}
  const initialReply=material+'\n你想先核对哪项要求？'
  let event=(await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,delta,initialReply)},initialReply,null,new AbortController().signal)).event!
  const result=await feedbackLoopStats({users:[user],from,to:await until()})
  assert.equal(result.acceptedMatters,0);assert.equal(result.feedbackMatters,0);assert.equal(result.feedbackRate.value,null);assert.equal(result.effectiveClosedLoops,0);assert.equal(result.costPerClosedLoopCny,null)
  assert.equal(result.observation.fromInclusive,from);assert.equal(result.trace.length,0)
  const requests=[run.request_id],second=randomUUID();await store.createConversation(user,{id:second,title:'SYNTHETIC next session'})
  const report=async(text:string,reply:string)=>{
   const r=(await store.startRun(user,second,randomUUID(),text)).run;requests.push(r.request_id)
   const d={target:{operation:'continue' as const,eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact' as const,source:{messageId:r.source_message_id,quote:text}}]}
   event=(await store.finishRun(r,{candidates:[],audit:[],coach:await stageCoachEvent(r,d,reply)},reply,null,new AbortController().signal)).event!;return r
  }
  await report('我接受这个核对步骤。','你接受了核对步骤，是否执行仍未知。')
  const understanding='你还没有开始；之前的步骤尚未验证，原因仍未知。后续可只核对一条要求，是否尝试由你选择。',feedback=await report('我还没有开始执行。',understanding)
  const nextReply='按上次尚未开始的情况，这次只看岗位说明中的一条要求，不重发整份清单。';let next=(await store.startRun(user,second,randomUUID(),'核对岗位这件事接下来怎么缩小？')).run;requests.push(next.request_id)
  await store.finishRun(next,{candidates:[],audit:[{phase:'coach_context_bound',eventRefs:[{eventId:event.id,revision:event.revision,generation:event.generation}]}]},nextReply,null,new AbortController().signal)
  const period={users:[user],from,to:await until()},pending=await feedbackLoopStats(period)
  assert.equal(pending.acceptedMatters,1);assert.equal(pending.feedbackMatters,1);assert.equal(pending.feedbackRate.value,1);assert.equal(pending.effectiveClosedLoops,null,'provided context is not a verified helpful loop')
  const hash=(text:string)=>createHash('sha256').update(text).digest('hex')
  let assessment:LoopReview={userId:user,eventId:event.id,sourceDigest:pending.trace[0]!.sourceDigest,understandingRequestId:feedback.request_id,understandingReplySha256:hash(understanding),nextHelpRequestId:next.request_id,nextHelpReplySha256:hash(nextReply),effective:true,reason:'合成夹具：未开始后范围实际缩到一条，不重复整份清单。',questionJudgments:[]}
  const sameSession=await feedbackLoopStats({...period,reviews:[assessment]});assert.equal(sameSession.effectiveClosedLoops,null,'an unrelated second conversation cannot certify the reviewed help as cross-session')
  next=(await store.startRun(user,chat,randomUUID(),'重新接着核对岗位这件事，怎么缩小？')).run;requests.push(next.request_id)
  const laterReply=nextReply+'\n你还想了解哪个岗位？'
  await store.finishRun(next,{candidates:[],audit:[{phase:'coach_context_bound',eventRefs:[{eventId:event.id,revision:event.revision,generation:event.generation}]}]},laterReply,null,new AbortController().signal)
  period.to=await until();assessment={...assessment,nextHelpRequestId:next.request_id,nextHelpReplySha256:hash(laterReply),questionJudgments:[{requestId:next.request_id,replySha256:hash(laterReply),unnecessary:true,repeated:false,reason:'这是首次提出的非必要问题，不属于重复追问。'}]}
  await pool.query('INSERT INTO lifeos_provider_budgets(id,limit_cny) VALUES($1,1)',[budget])
  for(const id of requests)await pool.query("INSERT INTO lifeos_provider_spend(id,budget_id,user_id,request_id,call_index,provider,model,reserved_cny,settled_cny,status,finished_at) VALUES($1,$2,$3,$4,1,'synthetic','synthetic-only',0.01,0.01,'known',now())",[randomUUID(),budget,user,id])
  period.to=await until()
  const reviewed=await feedbackLoopStats({...period,reviews:[assessment]} as any)
  assert.equal(reviewed.effectiveClosedLoops,1);assert.equal(reviewed.costPerClosedLoopCny,0.05);assert.equal(reviewed.unnecessaryRepeatedQuestions,0)
  assert.equal(reviewed.questionReview.total,1,'pre-acceptance preparation questions are excluded; a first new unnecessary question is not repeated')
  const futureReceipt=randomUUID();await pool.query("INSERT INTO lifeos_provider_spend(id,budget_id,user_id,request_id,call_index,provider,model,reserved_cny,settled_cny,status,created_at,finished_at) VALUES($1,$2,$3,$4,2,'synthetic','synthetic-only',0.02,0.02,'known',$5::timestamptz+interval '1 minute',now())",[futureReceipt,budget,user,next.request_id,period.to])
  const bounded=await feedbackLoopStats({...period,reviews:[assessment]});assert.equal(bounded.billing.knownCny,0.05,'calls created after the observation end are excluded')
  await pool.query('DELETE FROM lifeos_provider_spend WHERE id=$1',[futureReceipt])
  const wrongUser=await feedbackLoopStats({...period,reviews:[{...assessment,userId:peer}]} as any);assert.equal(wrongUser.effectiveClosedLoops,null,'an operator review must explicitly bind its user')
  const pendingRun=(await store.startRun(user,second,randomUUID(),'我接受这个排练步骤。')).run
  const pendingDelta={target:{operation:'create' as const,title:'排练',source:{messageId:pendingRun.source_message_id,quote:'我接受这个排练步骤'}},nodes:[{kind:'fact' as const,source:{messageId:pendingRun.source_message_id,quote:'我接受这个排练步骤'}}]}
  await store.finishRun(pendingRun,{candidates:[],audit:[],coach:await stageCoachEvent(pendingRun,pendingDelta,'你接受了排练步骤，等待实际反馈。')},'你接受了排练步骤，等待实际反馈。',null,new AbortController().signal)
  await pool.query("INSERT INTO lifeos_provider_spend(id,budget_id,user_id,request_id,call_index,provider,model,reserved_cny,settled_cny,status,finished_at) VALUES($1,$2,$3,$4,1,'synthetic','synthetic-only',0.01,0.01,'known',now())",[randomUUID(),budget,user,pendingRun.request_id])
  period.to=await until();const mixed=await feedbackLoopStats({...period,reviews:[assessment]})
  assert.equal(mixed.acceptedMatters,2);assert.equal(mixed.feedbackMatters,1);assert.equal(mixed.effectiveClosedLoops,1,'accepted without feedback is known not to be a closed loop, not an unreviewed loop');assert.equal(mixed.unreviewedMatters,0);assert.equal(mixed.costPerClosedLoopCny,0.06)
  const stale=await feedbackLoopStats({...period,reviews:[{...assessment,sourceDigest:'0'.repeat(64)}]} as any);assert.equal(stale.effectiveClosedLoops,null,'a stale semantic review cannot certify current sources')
  const workflow=randomUUID();await pool.query("INSERT INTO lifeos_provider_spend(id,budget_id,user_id,request_id,call_index,provider,model,reserved_cny,settled_cny,status,finished_at) VALUES($1,$2,$3,$4,1,'synthetic','synthetic-only',0.02,0.02,'known',now())",[randomUUID(),budget,user,workflow])
  const withWorkflow=await feedbackLoopStats({...period,to:await until(),reviews:[assessment]} as any);assert.equal(withWorkflow.costPerClosedLoopCny,0.08,'paid workflow or failed dispatch receipts are included even without a chat run')
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[peer,peer+'@example.invalid'])
  await pool.query("INSERT INTO lifeos_provider_spend(id,budget_id,user_id,request_id,call_index,provider,model,reserved_cny,settled_cny,status,finished_at) VALUES($1,$2,$3,$4,1,'synthetic','synthetic-only',0.03,0.03,'known',now())",[randomUUID(),budget,peer,next.request_id])
  const sharedRequest=await feedbackLoopStats({...period,users:[user,peer],to:await until(),reviews:[assessment]} as any)
  assert.equal(sharedRequest.billing.knownCny,0.11,'same request UUID from a different user remains a separate cost receipt')
  assert.equal(sharedRequest.billing.receipts.filter(row=>row.requestId===next.request_id).length,2)
  await pool.query("INSERT INTO lifeos_provider_spend(id,budget_id,user_id,request_id,call_index,provider,model,reserved_cny,status) VALUES($1,$2,$3,$4,2,'synthetic','synthetic-only',0.01,'unknown')",[randomUUID(),budget,user,next.request_id])
  period.to=await until()
  const unknown=await feedbackLoopStats({...period,reviews:[assessment]} as any);assert.equal(unknown.costPerClosedLoopCny,null,'unknown billing is not zero')
  await report('我暂停这个事项。','这件事暂停，不继续催促。')
  const resumedFrom=await until();await new Promise(resolve=>setTimeout(resolve,5))
  await report('我重新决定继续核对这件事，我接受这个核对步骤。','你重新接受了核对步骤。')
  await report('我还没有开始执行。','仍未执行，先保留未知。')
  const resumed=await feedbackLoopStats({users:[user],from:resumedFrom,to:await until()})
  assert.equal(resumed.acceptedMatters,1,'explicit renewed consent within this window enters its matter denominator')
  assert.equal(resumed.feedbackMatters,1)
  await assert.rejects(feedbackLoopStats({...period,from:'2026-10-27'}),/LOOP_OBSERVATION_INVALID/)
 }finally{await pool.query('DELETE FROM lifeos_provider_spend WHERE user_id=ANY($1::text[])',[[user,peer]]);await pool.query('DELETE FROM lifeos_provider_budgets WHERE id=$1',[budget]);await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[[user,peer]]);await pool.end()}
})
