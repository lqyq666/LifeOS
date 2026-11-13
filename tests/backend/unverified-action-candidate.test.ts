import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {actOnGrowthItem,growthContext,growthSemanticContext,growthView} from '../../server/growth.ts'
import {buildClauseCatalogue} from '../../server/clause-catalogue.ts'
import {experienceFactBindings} from '../../server/growth-privacy.ts'
import {coachEventView} from '../../server/action-coach-events.ts'

const action='只把已保存资料的三列标题核对完了'
const feedback='实际反馈：我只做了四分钟，'+action+'，没有分析。'

function authorizedContext(request:any){
 const message=request.messages.find((row:any)=>row.role==='user'&&typeof row.content==='string'&&row.content.startsWith('{'))
 assert.ok(message,'model request must carry the authorized context')
 const parsed=JSON.parse(message.content)
 return parsed.authorizedContext??parsed
}

const pendingOutput={growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c1'},contribution:{actor:'self',actionQuote:action,skillTags:['数据分析']}}]}

test('unverified actions stay tentative, correctable, removable and unable to overwrite confirmed records',async()=>{
 const h=await residualHarness()
 try{
  const {user,chat}=await h.account()
  await h.execute(user,chat,'我会用Excel。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'ability',source:{clauseId:'c0'}}]})
  const feedbackRun=await h.execute(user,chat,feedback,pendingOutput,'已保存原文反馈；执行者尚待核验，因此不把它当作你的能力或结果。')

  let records=await store.listExperiences(user)
  assert.equal(records.length,1)
  let candidate=records[0]!
  assert.equal(candidate.status,'candidate')
  assert.equal(candidate.confirm_source,'auto')
  assert.equal(candidate.confirmed_at,null)
  assert.equal(candidate.content.action,'')
  assert.equal(candidate.content.result,'')
  assert.deepEqual(candidate.content.tags,[])
  assert.equal(candidate.source_quote,'')
  assert.equal(candidate.content.title,'待核验的行动报告')
  assert.ok(!candidate.content.title.includes(action))
  assert.match(candidate.content.summary,/执行者尚待核验/)
  assert.match(candidate.content.summary,new RegExp(action))
  assert.equal((await pool.query('SELECT content->>\'action\' AS action FROM experiences WHERE user_id=$1 AND id=$2',[user,candidate.id])).rows[0].action,'','the database candidate does not use the performed-action field')
  assert.equal((await store.retrieveExperiences(user,{query:'',limit:10})).records.length,0,'tentative reports are not confirmed-memory retrieval')

  const graph=await store.cognitionGraph(user)
  const node=graph.nodes.find((row:any)=>row.serverId===candidate.id)
  assert.ok(node)
  assert.equal(node.contentStatus,'candidate')
  assert.equal(node.evidenceStatus,'unverified_record')
  assert.equal(node.title,'待核验的行动报告')
  assert.ok(!node.title.includes(action))
  assert.equal(node.action,'')
  assert.equal(node.result,'')
  assert.equal(node.insight,undefined)
  assert.equal(node.experienceSummary,undefined)
  assert.deepEqual(node.skillTags,[])
  assert.match(node.summary,/执行者尚待核验/)
  assert.match(node.summary,new RegExp(action))
  assert.ok(graph.changeEvents.some((row:any)=>row.subjectType==='experience'&&row.now.includes('待核验')&&row.reason.includes('待核对')),'the current tentative record is not shown as withdrawn')
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM experience_theme_links WHERE user_id=$1 AND experience_id=$2',[user,candidate.id])).rows[0].n,0)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM experience_relations WHERE user_id=$1 AND (from_experience=$2 OR to_experience=$2)',[user,candidate.id])).rows[0].n,0)
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,feedbackRun.request_id])).rows[0].n,1)

  const derivedObservation=await h.account(),observationText='用户可能不擅长分析'
  const observationRun=await h.execute(derivedObservation.user,derivedObservation.chat,feedback+'我还不知道后续效果。',{growthUpdates:[
   pendingOutput.growthUpdates[0],
   {target:{operation:'create'},assertion:'ai_observation',kind:'observation',text:observationText,source:{clauseId:'c3'},dependencies:[{updateIndex:0}],limitation:'行动执行者尚未核验'},
  ]})
  assert.ok((await store.listExperiences(derivedObservation.user)).some(row=>row.status==='candidate'),'the source report remains controllable')
  assert.ok(!(await growthView(derivedObservation.user)).items.some(row=>row.text===observationText),'a tentative action cannot produce an ordinary inferred fact')
  const observationAudit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[derivedObservation.user,observationRun.request_id])).rows[0].tool_audit
  assert.ok(observationAudit.some((row:any)=>row.phase==='growth_observation_unverified_dependency_dropped'))

  const revokedStrong=await h.account()
  const strongRun=await h.execute(revokedStrong.user,revokedStrong.chat,'我'+action+'。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:action}}]})
  await pool.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4)',[revokedStrong.user,revokedStrong.chat,strongRun.source_message_id,action])
  assert.ok(!(await store.listExperiences(revokedStrong.user)).some(row=>row.status==='confirmed'))
  const afterRevocation=await h.execute(revokedStrong.user,revokedStrong.chat,feedback,pendingOutput)
  const revivedNewCandidate=(await store.listExperiences(revokedStrong.user)).find(row=>row.status==='candidate')!
  assert.ok(revivedNewCandidate)
  const afterRevocationResponse=(await pool.query('SELECT response FROM runs WHERE user_id=$1 AND request_id=$2',[revokedStrong.user,afterRevocation.request_id])).rows[0].response
  assert.ok(afterRevocationResponse.candidateIds.includes(revivedNewCandidate.id),'a source-revoked confirmed row cannot suppress the visible candidate receipt')

  const persistedRun=(await pool.query('SELECT response,tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,feedbackRun.request_id])).rows[0],audit=persistedRun.tool_audit
  assert.ok(persistedRun.response.candidateIds.includes(candidate.id))
  assert.ok(!persistedRun.response.stateChange.experiences.createdIds.includes(candidate.id),'the confirmed-experience receipt excludes tentative records')
  const binding=audit.find((row:any)=>row.phase==='canonical_contribution_staged')
  const interpretation=audit.find((row:any)=>row.phase==='canonical_fact_interpretation')
  assert.equal(binding.actor,'unknown')
  assert.deepEqual(binding.skillTags,[])
  assert.equal(interpretation.actor,'unknown')
  assert.equal(interpretation.proposedActor,'self')
  assert.ok(!(await growthView(user)).items.some(row=>row.id===binding.factId),'unknown ownership is not exposed as an ordinary growth fact')
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM user_themes WHERE user_id=$1 AND source_refs @> $2::jsonb',[user,JSON.stringify([{growthItemId:binding.factId}])])).rows[0].n,0)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM identity_claims WHERE user_id=$1 AND source_refs @> $2::jsonb',[user,JSON.stringify([{growthItemId:binding.factId}])])).rows[0].n,0)
  assert.ok(!persistedRun.response.growthIds.includes(binding.factId),'completion receipts do not present tentative evidence as committed personal growth')

  const readback=randomUUID()
  await store.createConversation(user,{id:readback,title:'SYNTHETIC tentative readback'})
  await h.execute(user,readback,'只回读上次核对标题的反馈，不安排新动作。')
  let context=authorizedContext(h.requests.at(-1))
  assert.ok(context.factInterpretations.some((row:any)=>row.actor==='unknown'&&row.proposedActor==='self'&&row.actionQuote===action&&row.reportedText.includes(action)))
  assert.ok(!JSON.stringify(context.confirmedExperiences).includes(action),'tentative report is not presented as confirmed experience')
  const unrelated=randomUUID();await store.createConversation(user,{id:unrelated,title:'SYNTHETIC unrelated tentative exclusion'})
  await h.execute(user,unrelated,'帮我安排今天的英语听力练习。')
  const unrelatedContext=authorizedContext(h.requests.at(-1))
  assert.ok(!unrelatedContext.factInterpretations.some((row:any)=>row.itemId===interpretation.itemId),'an unrelated turn does not receive tentative raw evidence')

  await h.execute(user,chat,feedback,pendingOutput,'同一条原文报告已经保留，归属仍待核验。')
  records=await store.listExperiences(user)
  assert.equal(records.length,1,'repeated weak evidence does not create another candidate')
  assert.equal(records[0].id,candidate.id)
  assert.equal(records[0].revision,candidate.revision)

  const summaryCorrection={requestId:randomUUID(),expectedRevision:candidate.revision,action:'correct' as const,content:{summary:'待核验的标题核对报告'}}
  candidate=await store.experienceAction(user,candidate.id,summaryCorrection)
  assert.equal(candidate.status,'candidate','summary-only editing does not confirm who acted')
  assert.equal(candidate.content.title,'待核验的行动报告')
  assert.equal((await store.listExperiences(user)).find(row=>row.id===candidate.id)?.status,'candidate','editing a derived candidate summary keeps its action source valid')
  assert.equal((await experienceFactBindings(pool,user,[candidate.id])).get(candidate.id)?.valid,true)
  await pool.query('UPDATE user_operations SET response=$3 WHERE user_id=$1 AND request_id=$2',[user,summaryCorrection.requestId,{...candidate,source_quote:feedback,source_text:feedback,content:{...candidate.content,action,result:'伪造结果',tags:['数据分析']}}])
  candidate=await store.experienceAction(user,candidate.id,summaryCorrection)
  assert.equal(candidate.source_quote,'')
  assert.equal(candidate.source_text??'','')
  assert.equal(candidate.content.action,'')
  assert.equal(candidate.content.result,'')
  assert.deepEqual(candidate.content.tags,[],'legacy idempotent responses are projected through the same candidate boundary')
  const summaryConfirm=await h.account()
  await h.execute(summaryConfirm.user,summaryConfirm.chat,feedback,pendingOutput)
  let summaryCandidate=(await store.listExperiences(summaryConfirm.user))[0]!
  summaryCandidate=await store.experienceAction(summaryConfirm.user,summaryCandidate.id,{requestId:randomUUID(),expectedRevision:summaryCandidate.revision,action:'correct',content:{summary:action}})
  summaryCandidate=await store.experienceAction(summaryConfirm.user,summaryCandidate.id,{requestId:randomUUID(),expectedRevision:summaryCandidate.revision,action:'correct',content:{summary:'只调整待核验报告的展示摘要'}})
  assert.equal((await store.listExperiences(summaryConfirm.user))[0]?.id,summaryCandidate.id)
  const summaryConfirmed=await store.experienceAction(summaryConfirm.user,summaryCandidate.id,{requestId:randomUUID(),expectedRevision:summaryCandidate.revision,action:'confirm'})
  assert.equal(summaryConfirmed.status,'confirmed')
  assert.equal(summaryConfirmed.content.action,action)
  const hiddenOutcome=await h.account()
  await h.execute(hiddenOutcome.user,hiddenOutcome.chat,feedback,pendingOutput)
  const hiddenCandidate=(await store.listExperiences(hiddenOutcome.user))[0]!
  await assert.rejects(store.experienceAction(hiddenOutcome.user,hiddenCandidate.id,{requestId:randomUUID(),expectedRevision:hiddenCandidate.revision,action:'correct',content:{summary:hiddenCandidate.content.summary,result:'不能在待核验状态暗存的结果'}}),(error:any)=>error.code==='EXPERIENCE_ACTION_INVALID')
  const hiddenConfirmed=await store.experienceAction(hiddenOutcome.user,hiddenCandidate.id,{requestId:randomUUID(),expectedRevision:hiddenCandidate.revision,action:'confirm'})
  assert.equal(hiddenConfirmed.content.result,'','confirming ownership cannot promote an unreviewable candidate outcome')
  for(const mutation of ['confirm','correct','delete'] as const){
   const concurrent=await h.account()
   await h.execute(concurrent.user,concurrent.chat,feedback,pendingOutput)
   const pending=(await store.listExperiences(concurrent.user))[0]!,semantic=await growthSemanticContext(concurrent.user,concurrent.chat),interpretation=semantic.interpretations.find(row=>row.actor==='unknown')!
   const stale=(await store.startRun(concurrent.user,concurrent.chat,randomUUID(),'继续讨论这条待核验报告。')).run
   const refs=[{itemId:interpretation.itemId,revision:interpretation.revision,actor:interpretation.actor,actionQuote:interpretation.actionQuote,...(interpretation.proposedActor?{proposedActor:interpretation.proposedActor}:{})}]
   if(mutation==='confirm')await store.experienceAction(concurrent.user,pending.id,{requestId:randomUUID(),expectedRevision:pending.revision,action:'confirm'})
   else if(mutation==='correct')await store.experienceAction(concurrent.user,pending.id,{requestId:randomUUID(),expectedRevision:pending.revision,action:'correct',content:{summary:'本人更正后的行动',action:'我亲自核对了三列标题'}})
   else await store.experienceAction(concurrent.user,pending.id,{requestId:randomUUID(),expectedRevision:pending.revision,action:'delete'})
   await assert.rejects(store.finishRun(stale,{candidates:[],audit:[],usedFactInterpretationRefs:refs} as any,'这是一条基于旧待核验状态的回复。',null,new AbortController().signal),(error:any)=>error.code==='GROWTH_SNAPSHOT_INVALIDATED',mutation+' must invalidate an in-flight tentative interpretation')
  }
  const correctedAction='我亲自核对了已保存资料的三列标题'
  candidate=await store.experienceAction(user,candidate.id,{requestId:randomUUID(),expectedRevision:candidate.revision,action:'correct',content:{summary:candidate.content.summary,action:correctedAction}})
  assert.equal(candidate.status,'confirmed')
  assert.equal(candidate.confirm_source,'user')
  assert.equal(candidate.content.action,correctedAction)
  assert.equal(candidate.content.summary,correctedAction)
  assert.equal(candidate.content.source,'本人更正')
  assert.equal((await store.retrieveExperiences(user,{query:'三列标题',limit:10})).records[0]?.content.action,correctedAction)
  const correctedGraph=await store.cognitionGraph(user)
  const correctedNode=correctedGraph.nodes.find((row:any)=>row.serverId===candidate.id)
  assert.equal(correctedNode?.contentStatus,'user_confirmed')
  assert.equal(correctedNode?.action,correctedAction)
  assert.deepEqual(correctedNode?.skillTags,[],'a manual ownership correction does not resurrect model-suggested skills')
  const correctedEvents=correctedGraph.changeEvents.filter((row:any)=>row.subjectType==='experience')
  assert.ok(correctedEvents.some((row:any)=>row.transition==='corrected'&&row.reason.includes('本人更正并确认')))
  assert.ok(!correctedEvents.some((row:any)=>String(row.unknowns).includes('行动归属尚待本人确认')),'confirmed timeline does not retain a pending-ownership claim')
  assert.ok((await growthView(user)).items.some(row=>row.text==='我会用Excel'&&!row.unavailableReason),'independent ability remains')
  const replayAfterCorrection=await store.experienceAction(user,candidate.id,summaryCorrection)
  assert.equal(replayAfterCorrection.status,'confirmed')
  assert.equal(replayAfterCorrection.content.action,correctedAction)
  assert.equal(replayAfterCorrection.content.summary,correctedAction,'an old idempotency key returns the current corrected record')

  const correctedReadback=randomUUID()
  await store.createConversation(user,{id:correctedReadback,title:'SYNTHETIC corrected readback'})
  await h.execute(user,correctedReadback,'只回读已确认的标题核对记录。')
  context=authorizedContext(h.requests.at(-1))
  assert.ok(JSON.stringify(context.confirmedExperiences).includes(correctedAction))
  assert.ok(!context.factInterpretations.some((row:any)=>row.actionQuote===action),'superseded tentative interpretation is not reused')

  const deleteRequest={requestId:randomUUID(),expectedRevision:candidate.revision,action:'delete' as const}
  await store.experienceAction(user,candidate.id,deleteRequest)
  const deleteReplay=await store.experienceAction(user,candidate.id,deleteRequest)
  assert.equal(deleteReplay.source_quote,'','a delete replay cannot expose the internal redaction sentinel')
  assert.ok(!(await store.listExperiences(user)).some(row=>row.id===candidate.id))
  assert.ok(!(await store.cognitionGraph(user)).nodes.some((row:any)=>row.serverId===candidate.id))
  assert.equal((await store.retrieveExperiences(user,{query:'',limit:10})).records.length,0)
  assert.ok((await growthView(user)).items.some(row=>row.text==='我会用Excel'&&!row.unavailableReason),'deleting the report preserves unrelated facts')
  const redactedAudit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,feedbackRun.request_id])).rows[0].tool_audit
  assert.ok(!JSON.stringify(redactedAudit).includes('proposedActor'),'forgetting removes the tentative actor interpretation')

  const deletedReadback=randomUUID()
  await store.createConversation(user,{id:deletedReadback,title:'SYNTHETIC deleted readback'})
  await h.execute(user,deletedReadback,'只回读当前仍可使用的事实。')
  context=authorizedContext(h.requests.at(-1))
  assert.ok(!JSON.stringify(context).includes(action))
  assert.ok(!JSON.stringify(context).includes(correctedAction))
  assert.ok(JSON.stringify(context).includes('我会用Excel'))

  const known=await h.account(),explicit='我'+action
  await h.execute(known.user,known.chat,explicit+'。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:action,skillTags:['信息整理']}}]})
  const before=(await store.listExperiences(known.user))[0]!
  assert.equal(before.status,'confirmed')
  assert.equal(before.content.action,action)
  const knownWeakRun=await h.execute(known.user,known.chat,feedback,{...pendingOutput,event:{target:{operation:'create',title:'标题核对反馈',source:{clauseId:'c1'}},factRefs:[0]}})
  const after=await store.listExperiences(known.user)
  assert.equal(after.length,1)
  assert.equal(after[0].id,before.id)
  assert.equal(after[0].revision,before.revision)
  assert.equal(after[0].status,'confirmed')
  assert.deepEqual(after[0].content,before.content)
  const hiddenCandidates=(await pool.query("SELECT id FROM experiences WHERE user_id=$1 AND status='candidate'",[known.user])).rows
  assert.equal(hiddenCandidates.length,1,'the weak report keeps a correctable source-backed candidate behind the stronger record')
  const hiddenCandidateId=String(hiddenCandidates[0].id)
  assert.ok(!(await store.listExperiences(known.user)).some(row=>row.id===hiddenCandidateId),'the shadowed candidate stays out of the current control surface while stronger evidence is valid')
  assert.ok(!(await store.cognitionGraph(known.user)).nodes.some((row:any)=>row.serverId===hiddenCandidateId),'the shadowed candidate stays out of the star map')
  const knownNext=randomUUID();await store.createConversation(known.user,{id:knownNext,title:'SYNTHETIC confirmed duplicate readback'})
  await h.execute(known.user,knownNext,'只回读已经确认的标题核对记录。')
  const knownContext=authorizedContext(h.requests.at(-1)),knownInterpretations=knownContext.factInterpretations.filter((row:any)=>row.actionQuote===action)
  assert.ok(knownInterpretations.some((row:any)=>row.actor==='self'))
  assert.ok(!knownInterpretations.some((row:any)=>row.actor==='unknown'),'weak duplicate does not leave a conflicting actor interpretation')
  assert.equal((await experienceFactBindings(pool,known.user,[before.id])).get(before.id)?.actor,'self','weak duplicate does not replace stronger owned-action evidence')
  const weakAudit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[known.user,knownWeakRun.request_id])).rows[0].tool_audit
  assert.ok(weakAudit.some((row:any)=>row.phase==='canonical_fact_interpretation'&&row.shadowedByExperienceId===before.id))
  assert.ok(!weakAudit.some((row:any)=>row.phase==='canonical_contribution_staged'&&row.experienceId===before.id),'weak duplicate is not a source binding for the confirmed record')
  assert.ok(weakAudit.some((row:any)=>row.phase==='canonical_contribution_staged'&&row.experienceId===hiddenCandidateId),'the weak source belongs only to its tentative candidate')
  const weakFactId=weakAudit.find((row:any)=>row.phase==='canonical_fact_interpretation'&&row.shadowedByExperienceId===before.id).itemId
  assert.ok(!(await growthContext(known.user,knownNext)).some(row=>row.id===weakFactId),'an actively shadowed weak fact is not exposed as an ordinary growth fact')
  assert.ok(!(await coachEventView(known.user,known.chat))!.nodes.some(node=>node.kind==='fact'&&node.source?.messageId===knownWeakRun.source_message_id),'an unknown-ownership contribution cannot become an ordinary event fact')
  const strongFactId=(await pool.query("SELECT a.value->>'factId' AS id FROM runs r CROSS JOIN LATERAL jsonb_array_elements(r.tool_audit) a(value) WHERE r.user_id=$1 AND a.value->>'phase'='canonical_contribution_staged' AND a.value->>'experienceId'=$2 AND a.value->>'actor'='self' LIMIT 1",[known.user,before.id])).rows[0].id
  const strongFact=(await growthView(known.user)).items.find(row=>row.id===strongFactId)!
  await actOnGrowthItem(known.user,strongFact.id,{requestId:randomUUID(),expectedRevision:strongFact.revision,action:'forget'})
  assert.ok(!(await store.listExperiences(known.user)).some(row=>row.id===before.id),'forgetting strong ownership cannot let the weak duplicate preserve the confirmed record')
  const revivedRecords=await store.listExperiences(known.user),revivedCandidate=revivedRecords.find(row=>row.id===hiddenCandidateId)!
  assert.equal(revivedCandidate.status,'candidate','the still-valid weak report returns as a correctable candidate after stronger evidence is withdrawn')
  assert.equal(revivedCandidate.content.action,'')
  const revivedGrowth=await growthContext(known.user,knownNext),revivedSemantic=await growthSemanticContext(known.user,knownNext),revivedInterpretations=revivedSemantic.interpretations
  assert.ok(!revivedGrowth.some(row=>row.id===weakFactId),'the returned weak report never becomes an ordinary personal growth fact')
  assert.ok(revivedInterpretations.some(row=>row.itemId===weakFactId&&row.actor==='unknown'&&row.proposedActor==='self'&&row.actionQuote===action),'the returned weak report retains its unknown-ownership boundary')
  await h.execute(known.user,knownNext,'只回读当前仍有效的标题核对反馈。')
  const revivedContext=authorizedContext(h.requests.at(-1))
  assert.ok(revivedContext.factInterpretations.some((row:any)=>row.itemId===weakFactId&&row.actor==='unknown'&&row.actionQuote===action&&row.reportedText.includes(action)))
  assert.ok(!JSON.stringify(revivedContext.confirmedExperiences).includes(action))
  await store.experienceAction(known.user,revivedCandidate.id,{requestId:randomUUID(),expectedRevision:revivedCandidate.revision,action:'delete'})
  assert.ok(!(await store.listExperiences(known.user)).some(row=>row.id===hiddenCandidateId),'the revived candidate remains removable through the normal control path')

  const changedStrong=await h.account(),changedStrongAction='我亲自重新核对了四列标题'
  await h.execute(changedStrong.user,changedStrong.chat,'我'+action+'。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:action}}]})
  let changedStrongRecord=(await store.listExperiences(changedStrong.user))[0]!
  await h.execute(changedStrong.user,changedStrong.chat,feedback,pendingOutput)
  const changedHiddenId=String((await pool.query("SELECT id FROM experiences WHERE user_id=$1 AND status='candidate'",[changedStrong.user])).rows[0].id)
  changedStrongRecord=await store.experienceAction(changedStrong.user,changedStrongRecord.id,{requestId:randomUUID(),expectedRevision:changedStrongRecord.revision,action:'correct',content:{summary:changedStrongAction,action:changedStrongAction}})
  assert.equal(changedStrongRecord.content.action,changedStrongAction)
  const afterStrongCorrection=await store.listExperiences(changedStrong.user)
  assert.ok(afterStrongCorrection.some(row=>row.id===changedStrongRecord.id&&row.content.action===changedStrongAction))
  assert.ok(afterStrongCorrection.some(row=>row.id===changedHiddenId&&row.status==='candidate'),'changing strong action A to B releases the independent tentative report for A')
  assert.ok((await growthSemanticContext(changedStrong.user,changedStrong.chat)).interpretations.some(row=>row.actor==='unknown'&&row.actionQuote===action))

  const legacyAccount=await h.account(),legacyExperienceId=randomUUID(),legacyFactId=randomUUID()
  const legacySourceRun=await h.execute(legacyAccount.user,legacyAccount.chat,action),legacyMessageId=legacySourceRun.source_message_id
  const legacySource={type:'message',id:legacyMessageId,quote:action},legacyContent={title:action,summary:action,action,result:'',reflection:'',occurredAt:'',source:'用户对话原话',tags:[]}
  await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',2)",[legacyExperienceId,legacyAccount.user,legacyAccount.chat,legacyMessageId,action,legacySourceRun.request_id,legacyContent])
  await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,revision,progress_state) VALUES($1,$2,$3,'feedback',$4,'user_reported','active',$5,'[]',1,'completed')",[legacyFactId,legacyAccount.user,legacyAccount.chat,action,JSON.stringify([legacySource])])
  await pool.query("INSERT INTO growth_revisions(user_id,item_id,revision,action,snapshot) VALUES($1,$2,1,'extract',$3)",[legacyAccount.user,legacyFactId,{id:legacyFactId,conversationId:legacyAccount.chat,kind:'feedback',text:action,assertion:'user_reported',status:'active',sources:[legacySource],dependencies:[],revision:1,progressState:'completed'}])
  const legacySummaryEdit=await store.experienceAction(legacyAccount.user,legacyExperienceId,{requestId:randomUUID(),expectedRevision:2,action:'correct',content:{summary:'仅调整展示摘要'}})
  assert.equal(legacySummaryEdit.content.action,action)
  const legacyWeakRun=await h.execute(legacyAccount.user,legacyAccount.chat,feedback,pendingOutput)
  const legacyAudit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[legacyAccount.user,legacyWeakRun.request_id])).rows[0].tool_audit
  const legacyWeakFactId=legacyAudit.find((row:any)=>row.phase==='canonical_fact_interpretation'&&row.shadowedByExperienceId===legacyExperienceId).itemId
  const legacyCandidateId=legacyAudit.find((row:any)=>row.phase==='canonical_contribution_staged'&&row.actor==='unknown').experienceId
  assert.ok(!(await store.listExperiences(legacyAccount.user)).some(row=>row.id===legacyCandidateId),'a weak candidate is initially shadowed by a legacy confirmed source')
  await actOnGrowthItem(legacyAccount.user,legacyFactId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const legacyRevived=(await store.listExperiences(legacyAccount.user)).find(row=>row.id===legacyCandidateId)!
  assert.equal(legacyRevived.status,'candidate','quote-scoped withdrawal of an unbound legacy source releases the weak candidate')
  assert.ok(!(await store.listExperiences(legacyAccount.user)).some(row=>row.id===legacyExperienceId))
  const legacySemantic=await growthSemanticContext(legacyAccount.user,legacyAccount.chat)
  assert.ok(legacySemantic.interpretations.some(row=>row.itemId===legacyWeakFactId&&row.actor==='unknown'&&row.reportedText?.includes(action)))

  const crossRunStrong=await h.account()
  await h.execute(crossRunStrong.user,crossRunStrong.chat,feedback,pendingOutput)
  const crossCandidate=(await store.listExperiences(crossRunStrong.user))[0]!
  await h.execute(crossRunStrong.user,crossRunStrong.chat,'我'+action+'。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:action}}]})
  const crossVisible=await store.listExperiences(crossRunStrong.user)
  assert.equal(crossVisible.length,1)
  assert.equal(crossVisible[0].status,'confirmed')
  assert.notEqual(crossVisible[0].id,crossCandidate.id,'a later strong report does not merge into the tentative record')
  assert.ok(!(await growthSemanticContext(crossRunStrong.user,crossRunStrong.chat)).interpretations.some(row=>row.actor==='unknown'&&row.actionQuote===action),'dynamic shadowing handles a stronger report from a later run')

  const sharedClause='我核对了三列标题并保留了原文件。',sharedActions=['核对了三列标题','保留了原文件']
  for(const order of [sharedActions,[...sharedActions].reverse()]){
    const account=await h.account(),clause=buildClauseCatalogue(sharedClause)[0]!
    const run=await h.execute(account.user,account.chat,sharedClause,{growthUpdates:order.map(actionQuote=>({target:{operation:'create' as const},assertion:'user_reported' as const,kind:'feedback' as const,progressState:'completed' as const,source:{clauseId:clause.clauseId},contribution:{actor:'self' as const,actionQuote}}))})
    const records=await store.listExperiences(account.user)
    const trace=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[account.user,run.request_id])).rows[0]
    assert.deepEqual(records.map(row=>row.content.action).sort(),[...sharedActions].sort(),'distinct actions sharing one clause survive in either model order: '+JSON.stringify(trace.tool_audit))
    assert.deepEqual(records.map(row=>row.source_quote).sort(),[...sharedActions].sort(),'each action keeps its own exact source key')
    const bindings=(await pool.query("SELECT a.value FROM runs r CROSS JOIN LATERAL jsonb_array_elements(r.tool_audit) a(value) WHERE r.user_id=$1 AND r.request_id=$2 AND a.value->>'phase'='canonical_contribution_staged'",[account.user,run.request_id])).rows.map(row=>row.value)
    assert.equal(bindings.length,2)
    assert.equal(new Set(bindings.map(row=>row.experienceId)).size,2)
    assert.equal(new Set(bindings.map(row=>row.factId)).size,2,'distinct action interpretations must not share one ownership/control fact')
    const boundFacts=(await pool.query('SELECT id,text,status FROM growth_items WHERE user_id=$1 AND id=ANY($2::uuid[])',[account.user,bindings.map(row=>row.factId)])).rows
    assert.deepEqual(boundFacts.map(row=>row.text).sort(),[...sharedActions].sort(),'each canonical contribution persists as its exact atomic action')
    const removed=records.find(row=>row.content.action===sharedActions[0])!
    await store.experienceAction(account.user,removed.id,{requestId:randomUUID(),expectedRevision:removed.revision,action:'delete'})
    assert.deepEqual((await store.listExperiences(account.user)).map(row=>row.content.action),[sharedActions[1]],'deleting one same-clause action preserves the other experience')
    const retained=(await growthView(account.user)).items.find(row=>row.text===sharedActions[1])!
    assert.equal(retained.status,'active','deleting one same-clause action preserves the other canonical fact')
    assert.equal(retained.unavailableReason,null)
  }

  const confirmedTentative=await h.account()
  await h.execute(confirmedTentative.user,confirmedTentative.chat,feedback,pendingOutput)
  const tentative=(await store.listExperiences(confirmedTentative.user))[0]!
  const confirmed=await store.experienceAction(confirmedTentative.user,tentative.id,{requestId:randomUUID(),expectedRevision:tentative.revision,action:'confirm'})
  assert.equal(confirmed.status,'confirmed')
  assert.equal(confirmed.confirm_source,'user')
  assert.equal(confirmed.content.action,action)
  assert.equal(confirmed.content.summary,action)
  assert.equal(confirmed.content.source,'本人确认')
  assert.doesNotMatch(confirmed.content.title,/^待核验：/)
  const confirmedNode=(await store.cognitionGraph(confirmedTentative.user)).nodes.find((row:any)=>row.serverId===confirmed.id)
  assert.equal(confirmedNode?.contentStatus,'user_confirmed')
  assert.deepEqual(confirmedNode?.skillTags,[])
  const confirmedReadback=randomUUID();await store.createConversation(confirmedTentative.user,{id:confirmedReadback,title:'SYNTHETIC confirmed tentative readback'})
  await h.execute(confirmedTentative.user,confirmedReadback,'只回读我刚确认的标题核对记录。')
  const confirmedContext=authorizedContext(h.requests.at(-1))
  assert.ok(JSON.stringify(confirmedContext.confirmedExperiences).includes(action))
  assert.ok(!confirmedContext.factInterpretations.some((row:any)=>row.actionQuote===action),'confirmation supersedes the tentative actor interpretation')

  const sameTurn=await h.account(),sameTurnText=feedback+'我又做了两分钟，'+action+'。',sameTurnClauses=buildClauseCatalogue(sameTurnText).filter(clause=>clause.text.includes(action))
  assert.equal(sameTurnClauses.length,2)
  const sameTurnRun=await h.execute(sameTurn.user,sameTurn.chat,sameTurnText,{growthUpdates:sameTurnClauses.map(clause=>({target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:clause.clauseId},contribution:{actor:'self',actionQuote:action}}))})
  const sameTurnRecords=await store.listExperiences(sameTurn.user)
  assert.equal(sameTurnRecords.length,1,'same-turn weak duplicates share one candidate')
  const sameTurnAudit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[sameTurn.user,sameTurnRun.request_id])).rows[0].tool_audit
  const sameTurnBindings=sameTurnAudit.filter((row:any)=>row.phase==='canonical_contribution_staged')
  assert.equal(sameTurnBindings.length,2)
  assert.equal(new Set(sameTurnBindings.map((row:any)=>row.experienceId)).size,1)

  const scopedDelete=await h.account(),combinedAction=action+'并保留了原文件',independentFragment='保留了原文件'
  const scopedText='实际反馈：我只做了四分钟，'+combinedAction+'。',scopedRun=await h.execute(scopedDelete.user,scopedDelete.chat,scopedText,{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c1'},contribution:{actor:'self',actionQuote:action}}]})
  const scopedBinding=(await pool.query("SELECT a.value FROM runs r CROSS JOIN LATERAL jsonb_array_elements(r.tool_audit) a(value) WHERE r.user_id=$1 AND r.request_id=$2 AND a.value->>'phase'='canonical_contribution_staged'",[scopedDelete.user,scopedRun.request_id])).rows[0].value
  const scopedFact=(await pool.query('SELECT text,sources FROM growth_items WHERE user_id=$1 AND id=$2',[scopedDelete.user,scopedBinding.factId])).rows[0]
  assert.equal(scopedFact.text,action,'a single selected contribution cannot own unrelated text from its source clause')
  assert.equal(scopedFact.sources[0].quote,action)
  const scopedCandidate=(await store.listExperiences(scopedDelete.user))[0]!
  await store.experienceAction(scopedDelete.user,scopedCandidate.id,{requestId:randomUUID(),expectedRevision:scopedCandidate.revision,action:'delete'})
  assert.equal((await pool.query('SELECT content FROM messages WHERE user_id=$1 AND id=$2',[scopedDelete.user,scopedRun.source_message_id])).rows[0].content,scopedText,'record control never rewrites the original chat')
  const independentRange={start:scopedText.indexOf(independentFragment),end:scopedText.indexOf(independentFragment)+independentFragment.length}
  const controls=(await pool.query("SELECT snapshot->'sourceControls' AS controls FROM experience_revisions WHERE user_id=$1 AND experience_id=$2 AND action='delete' ORDER BY revision DESC LIMIT 1",[scopedDelete.user,scopedCandidate.id])).rows[0].controls
  assert.ok(controls.some((row:any)=>row.range?.start===scopedText.indexOf(action)&&row.range?.end===scopedText.indexOf(action)+action.length),'the delete control targets the exact atomic action')
  assert.ok(controls.every((row:any)=>!row.range||row.range.end<=independentRange.start||row.range.start>=independentRange.end),'the delete control does not cover the unselected sibling text')

  const misplaced=await h.account(),misplacedText='实际反馈：我只做了四分钟，'+action+'，没有分析；结果并没有帮我决定考研还是就业。'
  const misplacedClauses=buildClauseCatalogue(misplacedText),misplacedSource=misplacedClauses.find(clause=>clause.text.includes('只做了四分钟'))!
  const misplacedRun=await h.execute(misplaced.user,misplaced.chat,misplacedText,{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:misplacedSource.clauseId},contribution:{actor:'self',actionQuote:action,skillTags:['数据分析']}}]})
  const misplacedRecords=await store.listExperiences(misplaced.user)
  assert.equal(misplacedRecords.length,1,'a uniquely recoverable same-sentence source mismatch keeps the feedback turn')
  assert.equal(misplacedRecords[0].status,'candidate')
  assert.equal(misplacedRecords[0].content.action,'')
  assert.deepEqual(misplacedRecords[0].content.tags,[])
  assert.match(misplacedRecords[0].content.summary,new RegExp(action))
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[misplaced.user,misplacedRun.request_id])).rows[0].n,1,'the recovered turn saves one complete assistant response')

  const rebound=await h.account(),reboundNext=randomUUID()
  const firstWeak=await h.execute(rebound.user,rebound.chat,feedback,pendingOutput)
  let reboundCandidate=(await store.listExperiences(rebound.user))[0]!
  await store.createConversation(rebound.user,{id:reboundNext,title:'SYNTHETIC surviving candidate source'})
  const secondWeak=await h.execute(rebound.user,reboundNext,feedback,pendingOutput)
  const firstWeakFactId=(await pool.query("SELECT a.value->>'factId' AS id FROM runs r CROSS JOIN LATERAL jsonb_array_elements(r.tool_audit) a(value) WHERE r.user_id=$1 AND r.request_id=$2 AND a.value->>'phase'='canonical_contribution_staged' AND a.value->>'experienceId'=$3",[rebound.user,firstWeak.request_id,reboundCandidate.id])).rows[0].id
  const firstWeakFact=(await pool.query('SELECT id,revision FROM growth_items WHERE user_id=$1 AND id=$2',[rebound.user,firstWeakFactId])).rows[0]
  await actOnGrowthItem(rebound.user,firstWeakFact.id,{requestId:randomUUID(),expectedRevision:firstWeakFact.revision,action:'forget'})
  reboundCandidate=(await store.listExperiences(rebound.user))[0]!
  assert.ok(reboundCandidate,'a candidate survives when a later valid duplicate source remains')
  assert.equal(reboundCandidate.content.title,'待核验的行动报告')
  assert.match(reboundCandidate.content.summary,/执行者尚待核验/)
  assert.match(reboundCandidate.content.summary,new RegExp(action))
  const reboundNode=(await store.cognitionGraph(rebound.user)).nodes.find((row:any)=>row.serverId===reboundCandidate.id)
  assert.equal(reboundNode?.contentStatus,'candidate')
  assert.match(String(reboundNode?.summary??''),/执行者尚待核验/)
  const reboundConfirmed=await store.experienceAction(rebound.user,reboundCandidate.id,{requestId:randomUUID(),expectedRevision:reboundCandidate.revision,action:'confirm'})
  assert.equal(reboundConfirmed.status,'confirmed')
  const reboundSource=(await pool.query('SELECT conversation_id,source_message_id,source_quote FROM experiences WHERE user_id=$1 AND id=$2',[rebound.user,reboundCandidate.id])).rows[0]
  assert.equal(reboundSource.conversation_id,reboundNext)
  assert.equal(reboundSource.source_message_id,secondWeak.source_message_id)
  assert.equal(reboundSource.source_quote,action)
  assert.ok((await store.retrieveExperiences(rebound.user,{query:'三列标题',limit:10})).records.some(row=>row.id===reboundCandidate.id),'the confirmed record remains retrievable from the surviving source')

  const confirmedRebind=await h.account(),confirmedRebindNext=randomUUID()
  const confirmedFirst=await h.execute(confirmedRebind.user,confirmedRebind.chat,feedback,pendingOutput)
  await store.createConversation(confirmedRebind.user,{id:confirmedRebindNext,title:'SYNTHETIC confirmed surviving source'})
  const confirmedSecond=await h.execute(confirmedRebind.user,confirmedRebindNext,feedback,pendingOutput)
  let confirmedCandidate=(await store.listExperiences(confirmedRebind.user))[0]!
  confirmedCandidate=await store.experienceAction(confirmedRebind.user,confirmedCandidate.id,{requestId:randomUUID(),expectedRevision:confirmedCandidate.revision,action:'confirm'})
  assert.equal(confirmedCandidate.status,'confirmed')
  const secondFactId=(await pool.query("SELECT a.value->>'factId' AS id FROM runs r CROSS JOIN LATERAL jsonb_array_elements(r.tool_audit) a(value) WHERE r.user_id=$1 AND r.request_id=$2 AND a.value->>'phase'='canonical_contribution_staged' AND a.value->>'experienceId'=$3",[confirmedRebind.user,confirmedSecond.request_id,confirmedCandidate.id])).rows[0].id
  const secondFact=(await pool.query('SELECT id,revision FROM growth_items WHERE user_id=$1 AND id=$2',[confirmedRebind.user,secondFactId])).rows[0]
  await actOnGrowthItem(confirmedRebind.user,secondFact.id,{requestId:randomUUID(),expectedRevision:secondFact.revision,action:'forget'})
  const reboundConfirmedList=await store.listExperiences(confirmedRebind.user)
  assert.equal(reboundConfirmedList[0]?.id,confirmedCandidate.id,'user confirmation remains valid while an independently bound duplicate source survives')
  assert.equal(reboundConfirmedList[0]?.source_message_id,confirmedFirst.source_message_id)
  assert.equal(reboundConfirmedList[0]?.source_quote,action)
  assert.ok((await store.retrieveExperiences(confirmedRebind.user,{query:'三列标题',limit:10})).records.some(row=>row.id===confirmedCandidate.id))

  const gate=await pool.connect();let gateTransaction=false
  try{
   const concurrentAccount=await h.account()
   await h.execute(concurrentAccount.user,concurrentAccount.chat,feedback,pendingOutput)
   const concurrentCandidate=(await store.listExperiences(concurrentAccount.user))[0]!
   await gate.query('BEGIN');gateTransaction=true
   await gate.query('SELECT id FROM experiences WHERE user_id=$1 AND id=$2 FOR UPDATE',[concurrentAccount.user,concurrentCandidate.id])
   let runSettled=false
   const concurrentRun=h.execute(concurrentAccount.user,concurrentAccount.chat,feedback,pendingOutput).then(result=>{runSettled=true;return result})
   let waitedForCandidateLock=false
   for(let attempt=0;attempt<100&&!waitedForCandidateLock&&!runSettled;attempt++){
    await new Promise(resolve=>setTimeout(resolve,20))
    waitedForCandidateLock=Number((await gate.query("SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND pid<>pg_backend_pid()")).rows[0].n)>0
   }
   await gate.query("UPDATE experiences SET status='confirmed',confirm_source='user',confirmed_at=now(),content=content || $3::jsonb,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2",[concurrentAccount.user,concurrentCandidate.id,JSON.stringify({title:action,summary:action,action,source:'本人确认'})])
   await gate.query('COMMIT');gateTransaction=false
   const completed=await concurrentRun
   assert.ok(waitedForCandidateLock,'run commit must lock and recheck candidate status before duplicate binding')
   const concurrentBinding=(await pool.query("SELECT a.value FROM runs r CROSS JOIN LATERAL jsonb_array_elements(r.tool_audit) a(value) WHERE r.user_id=$1 AND r.request_id=$2 AND a.value->>'phase'='canonical_contribution_staged'",[concurrentAccount.user,completed.request_id])).rows[0].value
   assert.notEqual(concurrentBinding.experienceId,concurrentCandidate.id,'a run released after confirmation cannot attach unknown evidence to the confirmed record')

   const second=await h.account(),secondAction='只把已保存资料的两列表头复核完了',secondFeedback='实际反馈：我只做了三分钟，'+secondAction+'，没有分析。',secondOutput={growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c1'},contribution:{actor:'self',actionQuote:secondAction}}]}
   await h.execute(second.user,second.chat,secondFeedback,secondOutput)
   const secondCandidate=(await store.listExperiences(second.user))[0]!
   await gate.query('BEGIN');gateTransaction=true
   await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['growth:'+second.user])
   let confirmationSettled=false
   const confirmation=store.experienceAction(second.user,secondCandidate.id,{requestId:randomUUID(),expectedRevision:secondCandidate.revision,action:'confirm'}).then(result=>{confirmationSettled=true;return result})
   await new Promise(resolve=>setTimeout(resolve,150))
   const confirmationWaited=!confirmationSettled
   await gate.query('ROLLBACK');gateTransaction=false
   const serializedConfirmation=await confirmation
   assert.ok(confirmationWaited,'user confirmation must acquire the same growth serialization lock')
   assert.equal(serializedConfirmation.status,'confirmed')
  }finally{
   if(gateTransaction)await gate.query('ROLLBACK').catch(()=>{})
   gate.release()
  }

  const affirmed=await h.account();await h.execute(affirmed.user,affirmed.chat,feedback,pendingOutput)
  const legacy=(await pool.query("UPDATE experiences SET content=jsonb_set(content,'{action}',to_jsonb($2::text)) WHERE user_id=$1 AND status='candidate' RETURNING *",[affirmed.user,action])).rows[0]
  const affirmedRecord=await store.experienceAction(affirmed.user,legacy.id,{requestId:randomUUID(),expectedRevision:legacy.revision,action:'correct',content:{summary:legacy.content.summary,action}})
  assert.equal(affirmedRecord.status,'confirmed','submitting the existing non-empty action explicitly confirms ownership')
  assert.equal(affirmedRecord.confirm_source,'user')
 }finally{await h.close()}
})
