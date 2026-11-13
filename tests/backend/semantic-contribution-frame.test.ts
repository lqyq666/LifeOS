import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'
import {growthView,growthSemanticContext,actOnGrowthItem,currentFactInterpretations} from '../../server/growth.ts'
import {pool} from '../../server/db.ts'
import {coachEventView} from '../../server/action-coach-events.ts'
import {readStarMapContext} from '../../server/user-themes.ts'

test('one semantic fact feeds the experience, graph and next session without lexical performer inference',async()=>{
 const h=await residualHarness(),priorAdvanced=process.env.LIFEOS_ADVANCED_WORKFLOWS
 process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
 try{
  const {user,chat}=await h.account()
  const action='我花了二十分钟分析了问卷数据',result='但还不知道结果有没有用'
  await h.execute(user,chat,action+'，'+result+'。我会用Excel。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:action,skillTags:['数据分析'],resultRef:1}},{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c1'}},{target:{operation:'create'},assertion:'user_reported',kind:'ability',source:{clauseId:'c2'}}],event:{target:{operation:'create',title:'问卷分析反馈',source:{clauseId:'c0'}},factRefs:[0]}})
  const episodes=await store.listExperiences(user)
  assert.equal(episodes.length,1)
  assert.equal(episodes[0].content.action,action)
  assert.equal(episodes[0].content.result,result)
  assert.ok((await pool.query('SELECT response FROM runs WHERE user_id=$1',[user])).rows.some(row=>JSON.stringify(row.response.stateChange.growthDiff).includes(action)),'the production growth-diff feature actually generated copied completion metadata')
  assert.ok(!Object.hasOwn((await store.retrieveExperiences(user,{query:'',limit:10})).records[0],'source_text'),'retrieval does not acquire the private whole-message text field')
  await store.experienceAction(user,episodes[0].id,{requestId:randomUUID(),expectedRevision:episodes[0].revision,action:'confirm'})
  assert.ok((await store.cognitionGraph(user)).nodes.some(node=>node.skillTags?.some((tag:any)=>tag==='数据分析'||tag?.tag==='数据分析')))
  const next=randomUUID();await store.createConversation(user,{id:next,title:'SYNTHETIC semantic fact continuation'})
  await h.execute(user,next,'接着上次问卷分析，只回读做了什么和仍未知什么。')
  assert.ok(h.requests.at(-1).messages.some((message:any)=>message.role==='user'&&message.content.includes(action)&&message.content.includes(result)))
  let facts=(await growthView(user)).items
  const actionFact=facts.find(item=>item.text===action)!,resultFact=facts.find(item=>item.text===result)!
  let interpretations=await currentFactInterpretations(user,facts)
  assert.deepEqual(interpretations.find(item=>item.itemId===actionFact.id),{itemId:actionFact.id,revision:actionFact.revision,actor:'self',actionQuote:action,resultFact:{id:resultFact.id,revision:resultFact.revision}})
  assert.ok(h.requests.at(-1).messages.some((message:any)=>message.role==='user'&&message.content.includes('factInterpretations')&&message.content.includes('"actor":"self"')))
  const correctedResult=await actOnGrowthItem(user,resultFact.id,{requestId:randomUUID(),expectedRevision:resultFact.revision,action:'correct',text:'更正：这次没有取得可核对的结果'})
  assert.equal((await store.listExperiences(user))[0].content.result,'','canonical result correction cannot leave the superseded outcome exposed')
  await actOnGrowthItem(user,resultFact.id,{requestId:randomUUID(),expectedRevision:correctedResult.revision,action:'forget'})
  const remaining=(await store.listExperiences(user))[0]
  assert.equal(remaining.content.action,action)
  assert.equal(remaining.content.result,'','withdrawing the result does not preserve a stale outcome')
  const resultStorage=(await pool.query('SELECT content FROM experiences WHERE user_id=$1 AND id=$2',[user,remaining.id])).rows[0]
  assert.equal(resultStorage.content.result,'','forgotten result is removed from the stored projection')
  assert.ok(!(await pool.query('SELECT snapshot FROM experience_revisions WHERE user_id=$1 AND experience_id=$2',[user,remaining.id])).rows.some(row=>JSON.stringify(row.snapshot).includes(result)),'forgotten result is removed from derived revision history')
  interpretations=await currentFactInterpretations(user,(await growthView(user)).items)
  assert.equal(interpretations.find(item=>item.itemId===actionFact.id)?.resultFact,undefined)
  assert.ok((await store.cognitionGraph(user)).nodes.some(node=>node.skillTags?.some((tag:any)=>tag==='数据分析'||tag?.tag==='数据分析')),'withdrawing the outcome preserves the independently sourced action')
  assert.equal((await store.listExperiences(user)).length,1)
  const currentAction=(await growthView(user)).items.find(item=>item.id===actionFact.id)!
  await actOnGrowthItem(user,currentAction.id,{requestId:randomUUID(),expectedRevision:currentAction.revision,action:'forget'})
  assert.equal((await store.listExperiences(user)).length,0,'forgetting the action invalidates its experience projection')
  assert.ok(!(await pool.query('SELECT snapshot FROM growth_revisions WHERE user_id=$1 AND item_id=$2',[user,currentAction.id])).rows.some(row=>JSON.stringify(row.snapshot).includes(action)),'forgotten growth history retains offsets only, never plaintext facts or source quotes')
  assert.ok(!(await pool.query('SELECT content,source FROM coach_nodes WHERE user_id=$1',[user])).rows.some(row=>JSON.stringify(row).includes(action)),'the forgotten event fact is physically removed')
  assert.ok(!(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1',[user])).rows.some(row=>JSON.stringify(row.snapshot).includes(action)),'event revision copies are physically purged while chat remains')
  const forgottenProofs=(await pool.query("SELECT a.value FROM runs r CROSS JOIN LATERAL jsonb_array_elements(r.tool_audit) a(value) WHERE r.user_id=$1 AND ((a.value->>'phase'='canonical_contribution_staged' AND a.value->>'factId'=$2) OR (a.value->>'phase'='canonical_fact_interpretation' AND a.value->>'itemId'=$2))",[user,currentAction.id])).rows
  assert.ok(forgottenProofs.length>0&&forgottenProofs.every(row=>row.value.redacted===true&&!row.value.actor&&!row.value.skillTags&&!row.value.contentHash),'forget redacts the related semantic audit labels and dictionary-testable hash')
  const actionStorage=(await pool.query('SELECT content,source_quote FROM experiences WHERE user_id=$1 AND id=$2',[user,remaining.id])).rows[0]
  assert.ok(!JSON.stringify(actionStorage).includes(action))
  assert.ok(!(await pool.query('SELECT response FROM user_operations WHERE user_id=$1',[user])).rows.some(row=>JSON.stringify(row.response).includes(action)||JSON.stringify(row.response).includes(result)),'operation replay caches cannot restore forgotten plaintext')
  assert.ok(!(await pool.query('SELECT response FROM runs WHERE user_id=$1',[user])).rows.some(row=>JSON.stringify(row.response).includes(action)||JSON.stringify(row.response).includes(result)),'run completion metadata cannot replay forgotten personal text')
  assert.ok((await pool.query('SELECT content FROM messages WHERE user_id=$1',[user])).rows.some(row=>row.content.includes(action)),'the original chat transcript is preserved separately from derived completion metadata')
  assert.ok((await pool.query('SELECT response FROM runs WHERE user_id=$1',[user])).rows.some(row=>JSON.stringify(row.response).includes('我会用Excel')),'unrelated correct completion metadata remains intact')
  const retainedAction=(await pool.query('SELECT revision,snapshot FROM experience_revisions WHERE user_id=$1 AND experience_id=$2',[user,remaining.id])).rows.filter(row=>JSON.stringify(row.snapshot).includes(action))
  assert.equal(retainedAction.length,0,'forgotten action is removed from derived revision history: '+JSON.stringify(retainedAction))
  const redactedRevision=(await pool.query('SELECT revision FROM experiences WHERE user_id=$1 AND id=$2',[user,remaining.id])).rows[0].revision
  await store.experienceAction(user,remaining.id,{requestId:randomUUID(),expectedRevision:redactedRevision,action:'delete'})
  assert.equal((await store.listExperiences(user)).length,0)
  assert.ok(!(await store.cognitionGraph(user)).nodes.some(node=>node.skillTags?.some((tag:any)=>tag==='数据分析'||tag?.tag==='数据分析')),'audit proof cannot resurrect forgotten experiences or skills')
  const merged=await h.account(),initial='还不知道效果',updated='我确认结果不符合原先要求',latest='我重新核对后确认结果仍待验证'
  for(const result of [initial,updated,latest])await h.execute(merged.user,merged.chat,action+'，'+result+'。我会用Excel。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:action,skillTags:['数据分析'],resultRef:1}},{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c1'}},{target:{operation:'create'},assertion:'user_reported',kind:'ability',source:{clauseId:'c2'}}]})
  const middle=(await growthView(merged.user)).items.find(item=>item.text===updated)!
  await actOnGrowthItem(merged.user,middle.id,{requestId:randomUUID(),expectedRevision:middle.revision,action:'forget'})
  const combined=await store.listExperiences(merged.user)
  assert.equal(combined.length,1,'a repeated action with new outcome merges instead of creating another episode')
  assert.equal(combined[0].content.result,latest,'merges replace results, they do not accumulate earlier or forgotten results')
  await store.experienceAction(merged.user,combined[0].id,{requestId:randomUUID(),expectedRevision:combined[0].revision,action:'delete'})
  const deletedStorage=(await pool.query('SELECT content,source_quote FROM experiences WHERE user_id=$1 AND id=$2',[merged.user,combined[0].id])).rows[0]
  assert.ok(!JSON.stringify(deletedStorage).includes(action)&&!JSON.stringify(deletedStorage).includes(latest),'episode deletion uses the same physical source cleanup as fact forgetting')
  assert.ok(!(await pool.query('SELECT snapshot FROM experience_revisions WHERE user_id=$1 AND experience_id=$2',[merged.user,combined[0].id])).rows.some(row=>JSON.stringify(row.snapshot).includes(action)||JSON.stringify(row.snapshot).includes(latest)))
  const after=(await growthView(merged.user)).items.filter(item=>item.status==='active'&&!item.unavailableReason)
  assert.ok(!after.some(item=>item.text.includes(updated)||item.text.includes(action)),'deleting a merged episode suppresses BOTH action and independently sourced outcome')
  assert.ok(after.some(item=>item.text.includes('Excel')),'unrelated facts survive episode deletion')
  const corrected=await h.account()
  await h.execute(corrected.user,corrected.chat,action+'，'+updated+'。我会用Excel。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:action,skillTags:['数据分析'],resultRef:1}},{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c1'}},{target:{operation:'create'},assertion:'user_reported',kind:'ability',source:{clauseId:'c2'}}]})
  const prior=(await store.listExperiences(corrected.user))[0]
  await store.experienceAction(corrected.user,prior.id,{requestId:randomUUID(),expectedRevision:prior.revision,action:'correct',content:{summary:prior.content.summary,result:'其实只是结果尚待核对'}})
  const correctedFacts=(await growthView(corrected.user)).items.filter(item=>item.status==='active'&&!item.unavailableReason)
  assert.ok(!correctedFacts.some(item=>item.text===updated),'correcting an experience result also suppresses its old canonical fact')
  assert.ok(correctedFacts.some(item=>item.text===action)&&correctedFacts.some(item=>item.text.includes('Excel')))
  assert.equal((await store.listExperiences(corrected.user))[0].content.result,'其实只是结果尚待核对')
  const own=correctedFacts.find(item=>item.text===action)!
  await actOnGrowthItem(corrected.user,own.id,{requestId:randomUUID(),expectedRevision:own.revision,action:'correct',text:'我只整理了问卷的三列并没有分析'})
  assert.ok(!(await store.cognitionGraph(corrected.user)).nodes.some(node=>node.skillTags?.some((tag:any)=>tag==='数据分析'||tag?.tag==='数据分析')),'canonical action correction invalidates its derived skill')
  assert.ok(!(await store.listExperiences(corrected.user)).some(episode=>episode.content.action===action),'canonical correction cannot leave the stale derived action available')
  const correctedChat=randomUUID();await store.createConversation(corrected.user,{id:correctedChat,title:'SYNTHETIC canonical correction readback'})
  await h.execute(corrected.user,correctedChat,'只回读当前有效的事实。')
  assert.ok(!JSON.stringify(h.requests.at(-1).messages).includes(action),'the old action cannot survive in the next-session model context')
  const independent=await h.account()
  for(let i=0;i<2;i++)await h.execute(independent.user,independent.chat,action+'。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:action,skillTags:['数据分析']}}]})
  const reports=(await growthView(independent.user)).items.filter(item=>item.text===action).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))
  assert.equal(reports.length,2)
  await actOnGrowthItem(independent.user,reports[0].id,{requestId:randomUUID(),expectedRevision:reports[0].revision,action:'forget'})
  assert.equal((await store.listExperiences(independent.user)).length,1,'withdrawing a later report preserves an independent still-valid source')
  const reverse=await h.account()
  for(let i=0;i<2;i++)await h.execute(reverse.user,reverse.chat,action+'。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:action,skillTags:['数据分析']}}]})
  const reverseReports=(await growthView(reverse.user)).items.filter(item=>item.text===action).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt))
  await h.execute(reverse.user,reverse.chat,'我想提高数据分析能力。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'goal',source:{clauseId:'c0'}}]})
  assert.ok((await readStarMapContext(pool,reverse.user))?.linkedExperiences.length,'independent fact has a star-map context link before withdrawal')
  await actOnGrowthItem(reverse.user,reverseReports[0].id,{requestId:randomUUID(),expectedRevision:reverseReports[0].revision,action:'forget'})
  assert.equal((await store.listExperiences(reverse.user)).length,1,'withdrawing the original report preserves the later independently valid source')
  assert.ok((await store.cognitionGraph(reverse.user)).nodes.some(node=>node.skillTags?.some((tag:any)=>tag==='数据分析'||tag?.tag==='数据分析')))
  assert.ok((await readStarMapContext(pool,reverse.user))?.linkedExperiences.some(episode=>episode.summary.includes(action)),'the model star-map context preserves the same valid later binding')
  const repeated=await h.account(),same='我分析了问卷数据'
  await h.execute(repeated.user,repeated.chat,`${same}。${same}。`,{growthUpdates:['c0','c1'].map(clauseId=>({target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId},contribution:{actor:'self',actionQuote:same,skillTags:['数据分析']}}))})
  const repeatedFacts=(await growthView(repeated.user)).items.filter(item=>item.text===same&&!item.unavailableReason)
  assert.equal(repeatedFacts.length,2,'native clause identity disambiguates identical reported words before a correction')
  const repeatedEpisode=(await store.listExperiences(repeated.user))[0]
  assert.equal((await store.listExperiences(repeated.user)).length,1,'identical reports share one episode, not duplicate graph nodes')
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM runs r CROSS JOIN LATERAL jsonb_array_elements(r.tool_audit) a(value) WHERE r.user_id=$1 AND a.value->>'phase'='canonical_contribution_staged'",[repeated.user])).rows[0].n,2,'both accepted source identities are attached to that episode')
  const firstRepeated=(await pool.query("SELECT id,revision FROM growth_items WHERE user_id=$1 AND text=$2 ORDER BY (sources#>>'{0,range,start}')::int",[repeated.user,same])).rows[0]
  await actOnGrowthItem(repeated.user,firstRepeated.id,{requestId:randomUUID(),expectedRevision:firstRepeated.revision,action:'forget'})
  assert.equal((await store.listExperiences(repeated.user)).length,1,'forgetting one report preserves the second valid source of the same episode')
  assert.equal((await store.retrieveExperiences(repeated.user,{query:same,limit:3})).records.length,1,'retrieval uses the remaining occurrence too')
  assert.ok((await store.cognitionGraph(repeated.user)).nodes.some(node=>node.skillTags?.some((tag:any)=>tag==='数据分析'||tag?.tag==='数据分析')))
  const remainingRepeated=(await growthView(repeated.user)).items.find(item=>item.text===same&&!item.unavailableReason)!
  await actOnGrowthItem(repeated.user,remainingRepeated.id,{requestId:randomUUID(),expectedRevision:remainingRepeated.revision,action:'correct',text:'我只整理了三列'})
  assert.equal((await growthView(repeated.user)).items.filter(item=>item.text===same&&!item.unavailableReason).length,0)
  const oldRepeated=(await pool.query('SELECT revision FROM experiences WHERE user_id=$1 AND id=$2',[repeated.user,repeatedEpisode.id])).rows[0]
  await store.experienceAction(repeated.user,repeatedEpisode.id,{requestId:randomUUID(),expectedRevision:oldRepeated.revision,action:'delete'})
  assert.ok((await growthView(repeated.user)).items.some(item=>item.text==='我只整理了三列'&&!item.unavailableReason),'deleting the old episode preserves a new independently corrected fact')
  const allReports=await h.account()
  await h.execute(allReports.user,allReports.chat,`${same}。${same}。我会用Excel。`,{growthUpdates:[...['c0','c1'].map(clauseId=>({target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId},contribution:{actor:'self',actionQuote:same,skillTags:['数据分析']}})),{target:{operation:'create'},assertion:'user_reported',kind:'ability',source:{clauseId:'c2'}}]})
  const allEpisode=(await store.listExperiences(allReports.user))[0]
  await store.experienceAction(allReports.user,allEpisode.id,{requestId:randomUUID(),expectedRevision:allEpisode.revision,action:'correct',content:{summary:'更正',action:'我只整理了三列'}})
  const allFacts=(await growthView(allReports.user)).items.filter(item=>!item.unavailableReason)
  assert.ok(!allFacts.some(item=>item.text===same),'whole-episode correction updates ALL adopted report sources of that same action')
  assert.ok(allFacts.some(item=>item.text.includes('Excel')),'the unrelated control fact remains')
  assert.equal((await store.listExperiences(allReports.user))[0]?.content.action,'我只整理了三列')
  const edited=(await store.listExperiences(independent.user))[0]
  await store.experienceAction(independent.user,edited.id,{requestId:randomUUID(),expectedRevision:edited.revision,action:'correct',content:{summary:'更正后的本人经历',action:'我整理了三列数据'}})
  const editedAgain=(await store.listExperiences(independent.user))[0]
  await store.experienceAction(independent.user,editedAgain.id,{requestId:randomUUID(),expectedRevision:editedAgain.revision,action:'correct',content:{summary:'更正后的本人经历',result:'效果仍未知'}})
  assert.equal((await store.listExperiences(independent.user))[0]?.content.action,'我整理了三列数据','a later result edit cannot discard an earlier direct action correction')
  await actOnGrowthItem(independent.user,reports[1].id,{requestId:randomUUID(),expectedRevision:reports[1].revision,action:'forget'})
  assert.equal((await store.listExperiences(independent.user))[0]?.content.action,'我整理了三列数据','forgetting the refuted source preserves the independent direct manual correction')
  assert.equal((await store.retrieveExperiences(independent.user,{query:'',limit:10})).records[0]?.content.action,'我整理了三列数据')
  assert.ok(!(await pool.query('SELECT snapshot FROM experience_revisions WHERE user_id=$1',[independent.user])).rows.some(row=>JSON.stringify(row.snapshot).includes(action)),'manual revisions cannot retain refuted source plaintext after forgetting')
  const manualFinal=(await store.listExperiences(independent.user))[0]
  await store.experienceAction(independent.user,manualFinal.id,{requestId:randomUUID(),expectedRevision:manualFinal.revision,action:'delete'})
  const manualDeleted=(await pool.query('SELECT content FROM experiences WHERE user_id=$1',[independent.user])).rows
  assert.ok(!JSON.stringify(manualDeleted).includes('我整理了三列数据'))
  assert.ok(!(await pool.query('SELECT snapshot FROM experience_revisions WHERE user_id=$1',[independent.user])).rows.some(row=>JSON.stringify(row.snapshot).includes('我整理了三列数据')),'episode deletion also purges independent manual fields within that selected episode')
  assert.ok(!(await pool.query('SELECT response FROM user_operations WHERE user_id=$1',[independent.user])).rows.some(row=>JSON.stringify(row.response).includes('我整理了三列数据')))
  const joint=await h.account()
  await h.execute(joint.user,joint.chat,'王小明和我一起分析了问卷数据，但还没有拿到反馈。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'joint',actionQuote:'分析了问卷数据',skillTags:['数据分析'],resultRef:1}},{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c1'}}]})
  const jointEpisode=(await store.listExperiences(joint.user))[0]
  await store.experienceAction(joint.user,jointEpisode.id,{requestId:randomUUID(),expectedRevision:jointEpisode.revision,action:'correct',content:{summary:jointEpisode.content.summary,result:'结果仍未知'}})
  assert.ok((await store.cognitionGraph(joint.user)).nodes.some(node=>node.skillTags?.some((tag:any)=>tag==='数据分析'||tag?.tag==='数据分析')),'result correction preserves native joint-action interpretation even when the selected action omits its subject')
  const distinct=await h.account(),actions=['我完成了问卷数据的分析','我完成了问卷数据的整理']
  for(const action of actions)await h.execute(distinct.user,distinct.chat,action+'。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:action,skillTags:action===actions[0]?['数据分析']:[]}}]})
  const distinctEpisodes=await store.listExperiences(distinct.user)
  assert.equal(distinctEpisodes.length,2,'similar wording cannot merge a distinct interpreted action')
  const removed=distinctEpisodes.find(episode=>episode.content.action===actions[0])!
  await store.experienceAction(distinct.user,removed.id,{requestId:randomUUID(),expectedRevision:removed.revision,action:'delete'})
  assert.ok((await growthView(distinct.user)).items.some(item=>item.text===actions[1]&&item.status==='active'&&!item.unavailableReason),'deleting the analysis episode preserves the separate organizing fact')
  const overlap=await h.account(),overlapAction='我分析了问卷数据',overlapResult=overlapAction+'后确认结果无效'
  await h.execute(overlap.user,overlap.chat,overlapAction+'，'+overlapResult+'。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:overlapAction,skillTags:['数据分析'],resultRef:1}},{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c1'}}]})
  const overlapFact=(await growthView(overlap.user)).items.find(item=>item.text===overlapResult)!
  await actOnGrowthItem(overlap.user,overlapFact.id,{requestId:randomUUID(),expectedRevision:overlapFact.revision,action:'forget'})
  assert.equal((await store.listExperiences(overlap.user))[0]?.content.action,overlapAction,'substring overlap in distinct clauses does not revoke the independent action')
  assert.equal((await store.listExperiences(overlap.user))[0]?.content.result,'')
  assert.ok((await growthView(overlap.user)).items.some(item=>item.text===overlapAction&&!item.unavailableReason))
  const overlapCorrection=await h.account()
  await h.execute(overlapCorrection.user,overlapCorrection.chat,overlapAction+'，'+overlapResult+'。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:overlapAction,skillTags:['数据分析'],resultRef:1}},{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c1'}}]})
  const overlapEpisode=(await store.listExperiences(overlapCorrection.user))[0]
  await store.experienceAction(overlapCorrection.user,overlapEpisode.id,{requestId:randomUUID(),expectedRevision:overlapEpisode.revision,action:'correct',content:{summary:overlapEpisode.content.summary,result:'结果仍未知'}})
  assert.ok((await store.cognitionGraph(overlapCorrection.user)).nodes.some(node=>node.skillTags?.some((tag:any)=>tag==='数据分析'||tag?.tag==='数据分析')),'an overlapping result correction preserves the independent action projection and skill')
  for(const second of ['分析了问卷数据','分析了问卷数据后确认结果无效']){
   const scoped=await h.account(),hasResult=second.includes('结果'),own='王小明和我一起分析了问卷数据'
   await h.execute(scoped.user,scoped.chat,own+'，'+second+'。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'joint',actionQuote:'分析了问卷数据',skillTags:['数据分析'],...(hasResult?{resultRef:1}:{})}},{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c1'}}]})
   const prior=(await store.listExperiences(scoped.user))[0]
   await store.experienceAction(scoped.user,prior.id,{requestId:randomUUID(),expectedRevision:prior.revision,action:'correct',content:{summary:prior.content.summary,action:'我只整理了三列数据'}})
   const updated=(await store.listExperiences(scoped.user))[0]
   assert.equal(updated.content.action,'我只整理了三列数据')
   assert.ok(!(await store.cognitionGraph(scoped.user)).nodes.some(node=>node.skillTags?.some((tag:any)=>tag==='数据分析'||tag?.tag==='数据分析')),'a repeated old action fragment cannot survive a scoped action correction')
   if(hasResult){
    assert.equal(updated.content.result,second,'a correction to the original action fragment cannot revoke a different result range')
    assert.ok((await growthView(scoped.user)).items.some(item=>item.text===second&&!item.unavailableReason))
   }
  }
  const embedded=await h.account(),ownOnly='我整理了同学分析了数据的报告'
  await h.execute(embedded.user,embedded.chat,ownOnly+'。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:ownOnly}}]})
  assert.ok(!(await store.cognitionGraph(embedded.user)).nodes.some(node=>node.skillTags?.some((tag:any)=>tag==='数据分析'||tag?.tag==='数据分析')),'native facts cannot infer my skill from another actor embedded in the action object')
  const unrelatedResult=await h.account()
  await h.execute(unrelatedResult.user,unrelatedResult.chat,'我整理了三列数据。室友因此拿了奖。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:'我整理了三列数据',resultRef:1}},{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c1'}}]})
  assert.ok((await currentFactInterpretations(unrelatedResult.user,(await growthView(unrelatedResult.user)).items)).every(interpretation=>!interpretation.resultFact),'a rejected unrelated result cannot survive as a cross-session semantic association')
  assert.equal((await store.listExperiences(unrelatedResult.user))[0]?.content.result,'')
  for(const [text,actionQuote] of [['我没有分析过问卷数据','分析过问卷数据'],['我先分析了问卷数据再分析了问卷数据','分析了问卷数据']]){
   const account=await h.account(),before=h.requests.length
   const run=await h.execute(account.user,account.chat,text+'。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote,skillTags:['数据分析']}}]})
   assert.equal(h.requests.length-before,1,'an unverified optional action cannot trigger another provider call')
   assert.equal((await store.listExperiences(account.user)).length,0)
   const fact=(await growthView(account.user)).items.find(item=>item.text===text)!
   assert.ok(fact&&!fact.unavailableReason);assert.equal(fact.progressState,'unknown')
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[account.user,run.request_id])).rows[0].n,1)
  }
  const chatForget=await h.account()
  await h.execute(chatForget.user,chatForget.chat,same+'。我会用Excel。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:same,skillTags:['数据分析']}},{target:{operation:'create'},assertion:'user_reported',kind:'ability',source:{clauseId:'c1'}}]})
  await h.execute(chatForget.user,chatForget.chat,'请忘记'+same+'那段经历。')
  assert.equal((await store.listExperiences(chatForget.user)).length,0,'chat episode forgetting uses the same source cleanup as the detail action')
  assert.ok(!(await pool.query('SELECT content,source_quote FROM experiences WHERE user_id=$1',[chatForget.user])).rows.some(row=>JSON.stringify(row).includes(same)))
  assert.ok((await growthView(chatForget.user)).items.some(item=>item.text.includes('Excel')&&!item.unavailableReason),'chat forgetting preserves the independent correct control fact')
  const resultScope=await h.account(),sameResult='结果未知'
  const duplicateResult=await h.account(),beforeDuplicate=h.requests.length
  await h.execute(duplicateResult.user,duplicateResult.chat,`${same}。${sameResult}。`,{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:same,resultRef:2}},...['c1','c1'].map(clauseId=>({target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId}}))]})
  assert.equal(h.requests.length-beforeDuplicate,1,'an optional duplicate result association cannot trigger a repair call')
  assert.equal((await store.listExperiences(duplicateResult.user))[0]?.content.action,same,'the valid action survives a dropped optional result association')
  assert.equal((await store.listExperiences(duplicateResult.user))[0]?.content.result,'')
  assert.ok((await growthView(duplicateResult.user)).items.some(item=>item.text===sameResult&&!item.unavailableReason),'the canonical result fact remains independently available')
  await h.execute(resultScope.user,resultScope.chat,`${same}。${sameResult}。${sameResult}。`,{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:same,skillTags:['数据分析'],resultRef:2}},...['c1','c2'].map(clauseId=>({target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId}}))],event:{target:{operation:'create',title:'问卷结果核对',source:{clauseId:'c2'}},factRefs:[2]}})
  const resultEvent=await coachEventView(resultScope.user,resultScope.chat)
  const firstResult=(await pool.query("SELECT id,revision FROM growth_items WHERE user_id=$1 AND text=$2 ORDER BY (sources#>>'{0,range,start}')::int",[resultScope.user,sameResult])).rows[0]
  await actOnGrowthItem(resultScope.user,firstResult.id,{requestId:randomUUID(),expectedRevision:firstResult.revision,action:'forget'})
  assert.equal((await store.listExperiences(resultScope.user))[0]?.content.result,sameResult,'the selected second result survives withdrawal of the identical first clause')
  const keptEvent=await coachEventView(resultScope.user,resultScope.chat,resultEvent!.id)
  assert.ok(keptEvent?.nodes.some(node=>node.content===sameResult),'the independently selected event fact survives the identical first clause withdrawal')
  assert.ok(!JSON.stringify(keptEvent?.nodes.map(node=>node.source)).includes('range'),'private offsets do not change the public source shape')
  assert.ok(keptEvent?.nodes.every(node=>!node.source||!Object.hasOwn(node.source,'range')),'direct consumers also receive the unchanged public source shape')
  const summaryOnly=await h.account()
  await h.execute(summaryOnly.user,summaryOnly.chat,same+'。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:same,skillTags:['数据分析']}}]})
  const summaryEpisode=(await store.listExperiences(summaryOnly.user))[0]
  await store.experienceAction(summaryOnly.user,summaryEpisode.id,{requestId:randomUUID(),expectedRevision:summaryEpisode.revision,action:'correct',content:{summary:'问卷分析经历'}})
  assert.equal((await store.listExperiences(summaryOnly.user))[0]?.content.action,same,'editing a presentation summary does not revoke the unchanged action')
  assert.ok((await growthView(summaryOnly.user)).items.some(item=>item.text===same&&!item.unavailableReason))
  assert.ok((await store.cognitionGraph(summaryOnly.user)).nodes.some(node=>node.skillTags?.some((tag:any)=>tag==='数据分析'||tag?.tag==='数据分析')))
  const secondResult=(await pool.query("SELECT id,revision FROM growth_items WHERE user_id=$1 AND text=$2 AND status='active'",[resultScope.user,sameResult])).rows[0]
  await actOnGrowthItem(resultScope.user,secondResult.id,{requestId:randomUUID(),expectedRevision:secondResult.revision,action:'forget'})
  assert.ok((await pool.query('SELECT generation FROM coach_events WHERE user_id=$1 AND id=$2',[resultScope.user,resultEvent!.id])).rows[0].generation>keptEvent!.generation,'a second identical-text withdrawal still advances the affected event generation')
  for(const sample of [
   {text:'我把问卷交给王小明分析了数据。',actor:'other',progressState:'unknown'},
   {text:'可能同学和我一起分析过问卷数据。',actor:'unknown',progressState:'unknown'},
   {text:'我还没有完成数据分析。',actor:'unknown',progressState:'unknown'},
   {text:'我接受这个分析步骤，但还没有执行。',actor:'self',progressState:'unattempted'},
   {text:'我接受这个步骤但还没有执行。',actor:'unknown',progressState:'unattempted'},
   {text:'室友完成了问卷分析。',actor:'other',progressState:'completed'},
   {text:'我卡在第一步还没动手。',actor:'self',progressState:'stuck'},
  ]){
   const account=await h.account()
   await h.execute(account.user,account.chat,sample.text,{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:sample.progressState,source:{clauseId:'c0'},contribution:{actor:sample.actor,actionQuote:''}}]})
   assert.equal((await store.listExperiences(account.user)).length,0,sample.text)
    const publicItems=(await growthView(account.user)).items,semantic=await growthSemanticContext(account.user,account.chat),readback=semantic.interpretations
   assert.ok(readback.some(item=>item.actor===sample.actor),'non-action interpretations also persist for later help')
    const interpreted=readback.find(interpretation=>interpretation.actor===sample.actor)!
    if(sample.actor==='unknown'){
     assert.ok(!publicItems.some(fact=>fact.id===interpreted.itemId),'unknown ownership stays out of ordinary personal growth')
     assert.equal(interpreted.reportedText,sample.text.replace(/[。！？!?]$/,''),'the labelled semantic projection keeps the exact source clause usable')
     assert.equal(interpreted.reportedProgress,sample.progressState)
     if(sample.text==='我还没有完成数据分析。'){
      const next=randomUUID();await store.createConversation(account.user,{id:next,title:'SYNTHETIC unknown actor readback'})
      await h.execute(account.user,next,'只回读我上次报告的数据分析进度，不推断是谁执行的。')
      const prompt=h.requests.at(-1).messages.find((message:any)=>message.role==='user'&&typeof message.content==='string'&&message.content.startsWith('{'))
      const supplied=JSON.parse(prompt.content).factInterpretations.find((row:any)=>row.itemId===interpreted.itemId)
      assert.equal(supplied.reportedText,sample.text.replace(/[。！？!?]$/,''),'the next model turn receives the report only inside the unknown-actor boundary')
      assert.equal(supplied.actor,'unknown')
     }
    }
    const item=sample.actor==='unknown'?(await pool.query('SELECT id,revision,progress_state AS "progressState" FROM growth_items WHERE user_id=$1 AND id=$2',[account.user,interpreted.itemId])).rows[0]:publicItems.find(fact=>fact.id===interpreted.itemId)!
   assert.equal(item.progressState,sample.progressState,'legacy lexical guesses cannot overwrite an accepted native progress interpretation')
   await actOnGrowthItem(account.user,item.id,{requestId:randomUUID(),expectedRevision:item.revision,action:'correct',text:'这是更正后的独立事实'})
   assert.equal((await currentFactInterpretations(account.user,(await growthView(account.user)).items)).length,0,'a correction cannot reuse the old actor interpretation')
  }
  const blocked=await h.account()
  await h.execute(blocked.user,blocked.chat,'我分析了问卷数据，但这是合成练习，不要更新我的个人资料或星图。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:'我分析了问卷数据'}}]})
  assert.equal((await store.listExperiences(blocked.user)).length,0)
 }finally{if(priorAdvanced===undefined)delete process.env.LIFEOS_ADVANCED_WORKFLOWS;else process.env.LIFEOS_ADVANCED_WORKFLOWS=priorAdvanced;await h.close()}
})
