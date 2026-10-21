import {readFileSync} from 'node:fs'
import {parseActionCoachTurn} from '../server/action-coach-contracts.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {crisisSupportIntent,grillingInteractionMode} from '../server/grilling-policy.ts'
import {deriveTurnContract,bindRequestedSummarySchema,reportedSourceContextClauses,currentParticipantStatusReadback,reportedEvidenceFromText} from '../server/turn-contract.ts'
import {buildTurnPrompt,providerTurnMessages,turnSystemPrompt,promptResponseScopeRules} from '../server/turn-prompt.ts'
import {unchangedProposedAction,type CoachEvent} from '../server/action-coach-events.ts'
import {repairReviewedDefects} from '../server/review-repairs.ts'
import {openUnreportedChoiceQuestion} from '../server/reply-draft.ts'

test('stable evidence instructions are cacheable without losing user context or conditional rules',()=>{
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',text='我希望弄清哪些课程需要先修。请给一个能开始的动作，不联系别人。'
 const serialized=buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content:text}]})
 const profile={provider:'bailian',id:'qwen3.8-max'},contract=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
 const system=turnSystemPrompt('default',profile.id,contract,false)
 const original=providerTurnMessages(serialized,profile),cached=providerTurnMessages(serialized,profile,system)
 const before=JSON.parse(original[0]!.content as string),after=JSON.parse(cached[0]!.content as string)
 const removed=before.currentTask.responseScope.rules.filter((rule:string)=>!after.currentTask.responseScope.rules.includes(rule))
 assert.equal(removed.length,15)
 for(const rule of removed)assert.ok(system.includes(rule),'removed instruction remains in actual system prompt')
 assert.ok((original[0]!.content as string).length-(cached[0]!.content as string).length>1400)
 assert.deepEqual(cached.slice(1),original.slice(1),'all actual dialogue roles and text are unchanged')
 before.currentTask.responseScope.rules=after.currentTask.responseScope.rules
 assert.deepEqual(after,before,'only proven duplicate instructions are omitted from metadata')
 assert.deepEqual(providerTurnMessages(serialized,profile,'an unrelated system prompt'),original,'legacy and nonmatching callers keep every rule')
 assert.ok(after.currentTask.responseScope.rules.some((rule:string)=>rule.includes('一次新的观察或尝试')),'this-turn action limit stays in context')
 const rules=JSON.parse(serialized).currentTask.responseScope.rules as string[]
 assert.deepEqual(promptResponseScopeRules(rules,system),after.currentTask.responseScope.rules,'system suffix and metadata use the same exact duplicate boundary')
 assert.deepEqual(promptResponseScopeRules(rules,'unrelated'),rules,'missing stable prefix never authorizes removing any rule')
 assert.deepEqual(promptResponseScopeRules([...rules,'保留这条当轮自定义规则'],system),[...after.currentTask.responseScope.rules,'保留这条当轮自定义规则'])
 assert.equal(rules.length,JSON.parse(serialized).currentTask.responseScope.rules.length,'the logical context is not mutated')
})

test('only a fully covered status-only request projects current participant reports without identity guesses',()=>{
 const facts='回来反馈：老师后来回复说这周忙，下周再看；同学表格仍是明确不适合他。'
 const readback=currentParticipantStatusReadback(facts+'请只更新各自相关状态。')!
 assert.match(readback,/老师：已回复/)
 assert.match(readback,/同学：本次报告：同学表格仍是明确不适合他/)
 assert.match(readback,/下周再看/)
 assert.doesNotMatch(readback,/已读|已采用/)
 for(const text of [facts+'请解释我是否适合产品工作。',facts+'请只更新各自相关状态，并给一个动作。',facts+'我自己今天很累。请只更新相关状态。','“请只更新各自相关状态”。','如果老师回复了，请只更新相关状态。','朋友说：老师已经读过。请只更新相关状态。'])assert.equal(currentParticipantStatusReadback(text),null,text)
})

test('a correction retains the owned positive explanation beside its negated interpretation',()=>{
 const quote='我当时真正轻松的是自己不用反复找'
 const text='更正：同学少问一次只是结果，不代表我因此有成就感；'+quote+'。只更新受影响的判断。'
 assert.ok(reportedSourceContextClauses(text,[]).some(c=>c.text===quote))
 assert.ok(reportedSourceContextClauses('我感到轻松是因为自己找到了通知。',[]).some(c=>c.text==='我感到轻松是因为自己找到了通知'))
 for(const value of ['我发现同学轻松是因为不用反复找。','我认为老师轻松是因为不用反复找。','我觉得他感到轻松是因为不用反复找。','我希望你能帮我分析我为什么感到轻松。','我希望你可以帮我分析我为什么感到轻松。','我想麻烦你帮我分析我为什么感到轻松。','如果'+quote+'就好了。','“'+quote+'”。','朋友说：'+quote+'。','请帮我写“'+quote+'”。'])assert.deepEqual(reportedSourceContextClauses(value,[]),[],value)
})

test('owned memory roles keep subjective reports and criteria separate from observed metric changes',()=>{
 const feeling='我当时真正轻松的是自己不用反复找'
 assert.ok(reportedEvidenceFromText(feeling).sourceBounds.some(x=>x.kind==='personal_subjective_report'&&x.quote===feeling))
 assert.ok(reportedEvidenceFromText('减少自己反复找东西的时间',true).sourceBounds.some(x=>x.kind==='personal_criterion'))
 for(const text of ['朋友说：'+feeling,'“'+feeling+'”','我希望你能帮我分析我为什么感到轻松'])assert.ok(!reportedEvidenceFromText(text).sourceBounds.some(x=>x.kind==='personal_subjective_report'),text)
 assert.ok(!reportedEvidenceFromText('家里希望我稳定',true).sourceBounds.some(x=>x.kind==='personal_criterion'))
 assert.ok(!reportedEvidenceFromText('减少自己反复找东西的时间').sourceBounds.some(x=>x.kind==='personal_criterion'),'a bare fragment without an owned memory role does not gain a personal preference')
})

test('provider context separates stored workspace state from writable event deltas without losing source history',()=>{
 const fixture=JSON.parse(readFileSync('tests/fixtures/rejected-host-event-snapshot-nj.json','utf8'))
 assert.throws(()=>parseActionCoachTurn(fixture.rawOutput),'the rejected full host state must remain invalid; no repair into an authorized delta')
 const id='00000000-0000-4000-8000-000000000001'
 const internal=buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content:fixture.currentUserText}],currentEvent:fixture.storedEventReadback})
 const stored=JSON.parse(internal).currentEvent
 const wire=JSON.parse(providerTurnMessages(internal,{provider:'bailian',id:'qwen3.8-max'})[0]!.content as string)
 assert.equal(wire.currentEvent,undefined)
 assert.equal(wire.events,undefined)
 const projected=wire.readOnlyEventWorkspace
 assert.deepEqual(projected.eventRef,{id:stored.id,revision:stored.revision})
 assert.deepEqual(projected.reportedNodes,stored.nodes)
 assert.deepEqual(projected.actionRecords,stored.actions)
 assert.deepEqual(projected.sourceHistory.flatMap((turn:any)=>turn.sourceReports),stored.processTurns.flatMap((turn:any)=>turn.inputSources??[]))
 assert.ok(stored.asked.every((q:string)=>projected.previouslyAskedQuestions.includes(q)))
 assert.equal(projected.processTurns,undefined)
 assert.deepEqual(JSON.parse(internal).currentEvent,stored,'the internal source and target validator representation is unchanged')
})

test('readable source-bound explanations retain the complete machine scope contract',()=>{
 const id='00000000-0000-4000-8000-000000000002'
 const input=buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content:'最近同学少问了我一次。我当时真正轻松的是自己不用反复找。'}]})
 const before=JSON.parse(input).currentTask.responseScope.reportedEvidence.sourceBounds
 const after=JSON.parse(providerTurnMessages(input,{provider:'bailian',id:'qwen3.8-max'})[0]!.content as string).currentTask.responseScope.reportedEvidence.sourceBounds
 assert.ok(before.length>0)
 assert.deepEqual(after.map(({explanation,...source}:any)=>source),before)
 assert.ok(after.every((item:any)=>typeof item.explanation==='string'))
})

test('purpose stays source-bound as desired effect rather than an observed measurement',()=>{
 const messages=[{id:'wish',role:'user' as const,content:'我主要想更快看出关键信息，减少自己反复找东西的时间。'},{id:'result',role:'user' as const,content:'后来我20秒找到了通知。'}]
 const evidence=JSON.parse(buildTurnPrompt({currentMessageId:'result',messages})).currentTask.responseScope.reportedEvidence.sourceBounds
 assert.ok(evidence.some((b:any)=>b.kind==='desired_outcome'&&b.source.id==='wish'&&b.quote==='我主要想更快看出关键信息'))
 assert.ok(!evidence.some((b:any)=>b.kind==='absolute_duration'&&b.source.id==='wish'))
 assert.ok(evidence.some((b:any)=>b.kind==='absolute_duration'&&b.source.id==='result'))
 for(const content of ['我想起昨天20秒找到通知。','我准备材料时20秒找到了通知。']){
  const bounds=JSON.parse(buildTurnPrompt({currentMessageId:'past',messages:[{id:'past',role:'user',content}]})).currentTask.responseScope.reportedEvidence.sourceBounds
  assert.ok(!bounds.some((b:any)=>b.kind==='desired_outcome'),content)
  assert.ok(bounds.some((b:any)=>b.kind==='absolute_duration'),content)
 }
 const mixed=JSON.parse(buildTurnPrompt({currentMessageId:'mixed',messages:[{id:'mixed',role:'user',content:'我希望更快找到通知，后来我20秒找到了通知。'}]})).currentTask.responseScope.reportedEvidence.sourceBounds
 assert.ok(mixed.some((b:any)=>b.kind==='desired_outcome'&&b.quote==='我希望更快找到通知'))
 assert.ok(mixed.some((b:any)=>b.kind==='absolute_duration'&&b.quote==='后来我20秒找到了通知'))
 for(const content of ['我参加班会时20秒找到了通知。']){
  const bounds=JSON.parse(buildTurnPrompt({currentMessageId:'owned',messages:[{id:'owned',role:'user',content}]})).currentTask.responseScope.reportedEvidence.sourceBounds
  assert.ok(bounds.some((b:any)=>b.kind==='absolute_duration'),content)
 }
 const attributed=JSON.parse(buildTurnPrompt({currentMessageId:'other',messages:[{id:'other',role:'user',content:'朋友说明天会找通知，我20秒找到了通知。'}]})).currentTask.responseScope.reportedEvidence.sourceBounds
 assert.ok(attributed.length>0&&attributed.every((b:any)=>b.kind==='attributed_observation'),'both clauses keep the shared scanner attribution, without becoming personal measurement or intent')
 for(const content of ['朋友希望20秒找到通知。','如果我希望更快找到通知就试试。','“我希望省时间。”','`我想省时间`','请帮我准备一个方案。']){
  const wire=JSON.parse(buildTurnPrompt({currentMessageId:'x',messages:[{id:'x',role:'user',content}]}))
  assert.ok(!wire.currentTask.responseScope.reportedEvidence.sourceBounds.some((b:any)=>b.kind==='desired_outcome'),content)
 }
})

test('internal placeholder paragraphs do not become asserted gaps or overwrite real answers',()=>{
 const text='请比较这两种方式，先不安排任务。'
 const delivered='方式一：查看公开岗位的一天安排。方式二：查看培养方案的课时安排。'
 const reply=delivered+'\n\n【待补】你想要的自由具体是什么尚不明确，会影响下一步。'
 const fixed=repairReviewedDefects(reply,text,['我在意能自己安排一天中专注工作的时间。'])?.reply??reply
 assert.ok(fixed.includes(delivered))
 assert.ok(!fixed.includes('尚不明确'))
 assert.equal(repairReviewedDefects('【待补】你的目标尚不明确。',text)?.reply,'','empty scaffolding cannot become a false assertion')
 assert.equal(repairReviewedDefects('两个可比较对象\n【待补】你的目标尚不明确。',text)?.reply,'两个可比较对象')
 const genuine='你已说明想自主安排专注时间；公开岗位实际是否允许这样安排仍未知。'
 assert.equal(repairReviewedDefects(genuine,text)?.reply??genuine,genuine)
 const template='尊敬的【待补姓名】：您好。'
 assert.equal(repairReviewedDefects(template,'请给我一个填空模板。')?.reply??template,template)
})

test('ordinary summaries are concise while explicit detailed and material requests keep their format',()=>{
 const bind=(text:string)=>bindRequestedSummarySchema(deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),text)
 assert.equal((bind('请更新当前理解。').schema.properties as any).reply.maxLength,100)
 assert.ok((bind('请详细更新当前理解。').schema.properties as any).reply.maxLength>200)
 assert.ok((bind('请全面说明当前理解。').schema.properties as any).reply.maxLength>200)
 assert.equal((bind('请给一句阶段理解。').schema.properties as any).reply.maxLength,240)
})

test('reported question-count change survives ordinary interpretation without a summary exception',()=>{
 const text='接着整理资料的探索。最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。请根据新信息更新判断，不要重复问已经回答的内容。'
 const reply='你本人报告了这三条规则由你先定、同学找到了两份材料、询问次数减少一次；这些只说明这一次的具体经过，不能外推为稳定效果或通用方法。'
 const fixed=repairReviewedDefects(reply,text)?.reply??reply
 assert.ok(fixed.includes('询问次数减少一次'))
 assert.ok(!fixed.includes('询问次数是否减少一次仍不能确认'))
 const other=repairReviewedDefects('老师询问次数减少一次。',text)?.reply??'老师询问次数减少一次。'
 assert.ok(!other.includes('老师询问次数减少一次'),'a different actor cannot borrow the classmate report')
 const negative='最近一次我先定了三条分类规则，后来同学并非少问了我一次。请更新判断。'
 const unsupported='同学询问次数减少一次。'
 assert.ok(!(repairReviewedDefects(unsupported,negative)?.reply??unsupported).includes(unsupported),'negated count report cannot license a positive metric')
 const future='最近一次我先定了三条分类规则，后来同学将在资料整理全部完成以后少问一次。请更新判断。'
 assert.ok(!(repairReviewedDefects(unsupported,future)?.reply??unsupported).includes(unsupported),'future outcome cannot license a completed count change')
})

test('a new observed-moment question is not rewritten from recalled alternatives into a repeated feelings question',()=>{
 const reply='收到，这次仍然放松，提前结束只是因为身体累。两次和同一个室友打球都感到放松，但你之前说不确定是运动本身还是这个室友带来的——现在有没有哪个瞬间让你更偏向其中一边？'
 const text='回来反馈：一周后我又和同一个室友打了一次，仍然放松，但当天身体累所以提前结束。不要用一次疲惫推翻之前的感受。'
 const fixed=openUnreportedChoiceQuestion(reply,text)??reply
 assert.ok(fixed.includes('你之前说不确定是运动本身还是这个室友带来的'))
 assert.ok(!fixed.includes('具体是什么感觉'))
 assert.ok(!fixed.includes('更偏向其中一边'))
 assert.equal(openUnreportedChoiceQuestion('两次你都报告放松，但来源仍未知——这次哪个具体片段让你感到轻松？',text),null)
 assert.equal(openUnreportedChoiceQuestion('你之前说打球后很放松——这次哪个片段最轻松？',text),null,'without alternatives the binary-choice repair is not entered')
 const variant='你之前说不确定是运动本身还是室友带来的——这次哪个瞬间让你觉得更像运动本身的作用？'
 const safe=openUnreportedChoiceQuestion(variant,text)??variant
 assert.ok(!safe.includes('更像运动本身'))
 assert.ok(openUnreportedChoiceQuestion('你感到放松，是因为技能得到认可，还是因为有人关注——你更想选择哪边？',text),'an unsupported forced choice remains guarded')
})

test('sampling and measurement bounds retain separate source identities and exact units on the provider wire',()=>{
 const source=(id:string,content:string)=>({id,role:'user' as const,content})
 const prompt=buildTurnPrompt({currentMessageId:'pause',messages:[source('course','最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'),source('scholarship','回来反馈：我把奖学金材料按三条规则整理了一次，第二天大约20秒找到通知，但目前只发生过一次。'),source('sample','回来反馈：我只查看了一位校友公开分享的远程岗位经历。他说地点自由，但每天固定开两次会。这是一条个例。'),source('pause','今天先暂停，给一句阶段理解。')]})
 const bounds=JSON.parse(providerTurnMessages(prompt,{provider:'synthetic',id:'synthetic'})[0]!.content as string).currentTask.responseScope.reportedEvidence.sourceBounds
 assert.ok(bounds.some((b:any)=>b.kind==='reported_count_change'&&b.source.id==='course'&&b.quote==='少问了我一次'))
 assert.ok(bounds.some((b:any)=>b.kind==='absolute_duration'&&b.source.id==='scholarship'&&b.quote==='第二天大约20秒找到通知'))
 assert.ok(!bounds.some((b:any)=>b.kind==='reported_count_change'&&b.source.id==='scholarship'))
 assert.ok(bounds.some((b:any)=>b.kind==='limited_sample'&&b.source.id==='sample'))
 for(const content of ['我希望整理后20秒找到通知。','如果20秒找到通知就好了。','朋友说：“我20秒找到通知。”','我并不是只查看了一位校友。','并非少问了我一次。','可能20秒找到通知。','我在20秒的视频里找到通知。','明天我会在20秒内找到通知。','同学将在资料整理全部完成以后少问一次。']){
  const p=buildTurnPrompt({currentMessageId:'x',messages:[source('x',content)]})
  assert.deepEqual(JSON.parse(p).currentTask.responseScope.reportedEvidence.sourceBounds.filter((b:any)=>b.kind!=='desired_outcome'),[],content)
 }
 const quotedLabel='我20秒找到了“通知”。'
 const qp=JSON.parse(buildTurnPrompt({currentMessageId:'q',messages:[source('q',quotedLabel)]}))
 assert.ok(qp.currentTask.responseScope.reportedEvidence.sourceBounds.some((b:any)=>b.kind==='absolute_duration'&&b.quote.includes('“通知”')))
})

test('grilling activates only for exploration and preserves direct or listening intent',()=>{
  assert.equal(grillingInteractionMode('我不知道毕业后想做什么，最近很迷茫。'),'explore')
  assert.equal(grillingInteractionMode('只想聊聊，今天不要追问。'),'listen')
  assert.equal(grillingInteractionMode('直接给我一段请教消息，不要分析。',{material:true}),'direct_delivery')
  assert.equal(grillingInteractionMode('解释一下递归。'),'ordinary')
})

test('explicit first-person crisis switches off growth, event and planning lanes',()=>{
  const text='我不想活了，想结束生命。'
  assert.equal(crisisSupportIntent(text),true)
  assert.equal(crisisSupportIntent('如果有人说“我不想活了”，该怎么帮助？'),false)
  const contract=deriveTurnContract({text,knowledgeCount:0,currentEventExists:true,planIntent:true,material:true})
  assert.deepEqual(contract.capabilities,{growth:false,candidate:false,plan:false,citations:false,event:false,material:false})
})

test('normal prompt carries server-derived grilling mode and exact policy fingerprint',()=>{
  const id='00000000-0000-4000-8000-000000000001'
  const prompt=JSON.parse(buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content:'我在就业和考研之间犹豫。'}]}))
  assert.equal(prompt.grilling.policyVersion,'lifeos-grilling/1.0.19')
  assert.equal(prompt.grilling.interactionMode,'explore')
  assert.match(prompt.grilling.policyDigest,/^[a-f0-9]{64}$/)
})

test('authorized evidence keeps participant states, preference modality and external wishes distinct',()=>{
 const id='00000000-0000-4000-8000-000000000001'
 const content='我主要在意能自己安排专注时间，不在意当老板，也不想承担找客户和收款。家里希望我稳定。回来反馈：老师后来回复说这周忙，下周再看；同学表格仍是明确不适合他。'
 const evidence=JSON.parse(buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content}]})).currentTask.responseScope.reportedEvidence
 assert.equal(evidence.participants.length,2)
 const teacher=evidence.participants.find((item:any)=>item.actor==='老师')
 assert.equal(teacher.quote,'回来反馈：老师后来回复说这周忙，下周再看')
 assert.equal(teacher.states.response.status,'reported_response')
 assert.equal(teacher.states.read.status,'unknown')
 assert.equal(teacher.states.receipt.status,'unknown')
 assert.equal(teacher.source.id,id)
 assert.deepEqual(evidence.preferences.map((item:any)=>item.modality),['priority','not_priority','unwilling'])
 assert.equal(evidence.preferences[1].isRefusal,false)
 assert.equal(evidence.externalExpectations[0].personalAdoption,'not_inferred_from_external_report')
 assert.equal(evidence.externalExpectations[0].quote,'家里希望我稳定')
 const excluded=JSON.parse(buildTurnPrompt({currentMessageId:id+'x',messages:[{id:'old',role:'assistant',content},{id:id+'x',role:'user',content:'只说当前情况。'}]})).currentTask.responseScope.reportedEvidence
 assert.deepEqual(excluded.participants,[])
 assert.deepEqual(excluded.preferences,[])
 assert.deepEqual(excluded.externalExpectations,[])
 const currentEvent={id:'event-a',conversationId:'chat-a',title:'老师邮件',revision:1,generation:1,nodes:[{id:'node-a',revision:1,kind:'fact' as const,status:'active' as const,content:'老师确认已读',source:{messageId:'old-source',conversationId:'chat-a',quote:'老师确认已读'}}],actions:[],asked:[],createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString()}
 const nodeEvidence=JSON.parse(buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content:'这封邮件接着说。'}],currentEvent})).currentTask.responseScope.reportedEvidence.participants
 assert.equal(nodeEvidence[0].states.read.status,'reported_read')
 assert.equal(nodeEvidence[0].source.eventId,'event-a')
 assert.equal(nodeEvidence[0].source.id,'node-a')
 const serialized=buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content:'老师后来回复说这周忙，下周再看。'}]})
 const wire=providerTurnMessages(serialized,{provider:'synthetic',id:'synthetic'})
 const view=JSON.parse(wire[0]!.content as string).currentTask.responseScope.reportedEvidence.participantReports[0]
 assert.equal(view.states['回复'].status,'本人报告已回复')
 assert.equal(view.states['原材料阅读'],undefined,'an omitted field must not become a new unknown-state update')
 assert.ok(!JSON.stringify(wire).includes('reported_response'),'internal state enums are not product prose examples')
})

test('provider evidence is sparse: a later partial report cannot reset prior trial evidence',()=>{
 const old='另一位同学试过我做的表格后明确说不适合他',current='同学表格仍是明确不适合他'
 const serialized=buildTurnPrompt({currentMessageId:'now',messages:[{id:'old',role:'user',content:old},{id:'now',role:'user',content:current}]})
 const metadata=JSON.parse(providerTurnMessages(serialized,{provider:'synthetic',id:'synthetic'})[0]!.content as string)
 const participants=metadata.currentTask.responseScope.reportedEvidence.participantReports
 assert.equal(participants.find((item:any)=>item.quote===old).states['试用'].status,'本人报告已试用')
 assert.equal(participants.find((item:any)=>item.quote===current).states['试用'],undefined,'absence in this report leaves the prior report unchanged')
 const uncertain=buildTurnPrompt({currentMessageId:'uncertain',messages:[{id:'uncertain',role:'user',content:'同学是否试过这个表格仍未知'}]})
 const explicit=JSON.parse(providerTurnMessages(uncertain,{provider:'synthetic',id:'synthetic'})[0]!.content as string).currentTask.responseScope.reportedEvidence.participantReports[0]
 assert.equal(explicit.states['试用'].status,'本人尚未确认','explicit uncertainty remains distinct from omission')
 assert.equal(explicit.states['试用'].quote,'同学是否试过这个表格仍未知')
 const readUnknown=buildTurnPrompt({currentMessageId:'read-unknown',messages:[{id:'read-unknown',role:'user',content:'老师是否读过原材料仍未知'}]})
 const reading=JSON.parse(providerTurnMessages(readUnknown,{provider:'synthetic',id:'synthetic'})[0]!.content as string).currentTask.responseScope.reportedEvidence.participantReports[0]
 assert.equal(reading.states['原材料阅读'].status,'本人尚未确认')
 assert.equal(reading.states['原材料阅读'].quote,'老师是否读过原材料仍未知')
 const receiptUnknown=buildTurnPrompt({currentMessageId:'receipt-unknown',messages:[{id:'receipt-unknown',role:'user',content:'同学是否收到仍未知'}]})
 const receipt=JSON.parse(providerTurnMessages(receiptUnknown,{provider:'synthetic',id:'synthetic'})[0]!.content as string).currentTask.responseScope.reportedEvidence.participantReports[0]
 assert.equal(receipt.states['收件'].status,'本人尚未确认')
 assert.equal(receipt.states['收件'].quote,'同学是否收到仍未知')
})

test('response scope recognizes current judgment instructions without treating refusals as action requests',()=>{
 const id='00000000-0000-4000-8000-000000000001'
 const scope=(content:string)=>JSON.parse(buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content}]})).currentTask.responseScope
 assert.equal(scope('请更新判断，不要替我选。').judgmentUpdate,true)
 assert.equal(scope('请更新判断，不要给我安排任务。').actionRequested,false)
 assert.equal(scope('请更新判断，并给一个四小时内的小验证。').actionRequested,true)
 for(const content of ['如果下周有空，请更新判断。','朋友说，请更新判断。','“请更新判断”','`请更新判断`'])assert.equal(scope(content).judgmentUpdate,false,content)
})

test('unchanged proposed material is identifiable without weakening real modification validation',()=>{
  const event={id:'00000000-0000-4000-8000-000000000001',conversationId:'00000000-0000-4000-8000-000000000002',title:'求职材料',revision:2,generation:1,nodes:[],asked:[],actions:[{id:'00000000-0000-4000-8000-000000000003',revision:4,status:'proposed',draft:{content:'原材料'},closedReason:null}],createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString()} satisfies CoachEvent
  const unchanged={target:{operation:'continue' as const,eventId:event.id,expectedRevision:2},action:{operation:'modify' as const,actionId:event.actions[0]!.id,expectedRevision:4,draft:{content:'原材料'}}}
  assert.equal(unchangedProposedAction(event,unchanged),true)
  assert.equal(unchangedProposedAction(event,{...unchanged,action:{...unchanged.action,draft:{content:'确实修改后的材料'}}}),false)
  assert.equal(unchangedProposedAction(event,{...unchanged,action:{...unchanged.action,expectedRevision:3}}),false)
})
