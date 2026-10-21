import {findEpisode} from '../server/experience-episodes.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {reportedEvidenceFromText,reportedPursuitClauses,reportedTaskOutcomeClauses,unsupportedParticipantReadingClaims,unsupportedPreferenceConstraintClaims} from '../server/turn-contract.ts'

test('actual OH prerequisite inquiry does not make its location objective a hard personal requirement',()=>{
 const preferences=reportedEvidenceFromText('家里希望我走稳定路线，但这是外部期待；我自己更在意留在目前城市，而且每周最多四小时探索。').preferences
 const actual='用来判断考研是否为留城的必要条件。'
 assert.deepEqual(unsupportedPreferenceConstraintClaims(actual,preferences),[])
 assert.deepEqual(unsupportedPreferenceConstraintClaims('学历是留城工作的必要条件。',preferences),[],'the requirement is about the qualification, not the strength of the personal location preference')
 assert.deepEqual(unsupportedPreferenceConstraintClaims('留城的必要条件是否是研究生学历。',preferences),[])
 assert.deepEqual(unsupportedPreferenceConstraintClaims('先核对留城是否为你的硬要求。',preferences),[],'an adjacent question operator is not an affirmative promotion')
 assert.ok(unsupportedPreferenceConstraintClaims('留城是所有选择的必要条件。',preferences).length,'reversing the relation must still bind an actual hard location requirement')
 assert.ok(unsupportedPreferenceConstraintClaims('留城意愿是必要条件。',preferences).length)
 assert.ok(unsupportedPreferenceConstraintClaims('无论是否考研留城都是必要条件。',preferences).length,'whether elsewhere must not exempt an actual affirmative hardening claim')
})

test('current matter prefixes retain the direct participant report and its bounded continuation',()=>{
 const text='接着作品集的事：导师回复说手机打不开链接，但没有评价内容。不要重写作品集，先处理访问条件。'
 const reports=reportedTaskOutcomeClauses(text,false,true)
 assert.deepEqual(reports.map(c=>c.text),['接着作品集的事：导师回复说手机打不开链接，但没有评价内容'])
 assert.equal(reportedEvidenceFromText(text).participants[0]?.states.response.status,'reported_response')
 for(const t of ['如果'+text,'朋友说：'+text,'“'+text+'”','`'+text+'`'])assert.deepEqual(reportedTaskOutcomeClauses(t,false,true),[],t)
})

test('a directly stated provisional direction is a sourced pursuit, never inferred from another speaker',()=>{
 const quote='方向暂定找产品实习'
 assert.deepEqual(reportedPursuitClauses('我是成年大学生，'+quote+'。').map(c=>c.text),[quote])
 for(const t of ['朋友说，'+quote+'。','如果'+quote+'，再考虑。','“'+quote+'”',quote+'吗？','方向是不确定。'])assert.deepEqual(reportedPursuitClauses(t),[],t)
})

test('source modality rejects hardening a preference without softening a real limit or owned requirement',()=>{
 const preferences=reportedEvidenceFromText('我更在意留在目前城市，而且每周最多四小时探索。').preferences
 assert.equal(preferences[0]?.subject,'留在目前城市')
 assert.equal(preferences[0]?.hardRequirementQuote,null)
 assert.ok(unsupportedPreferenceConstraintClaims('选项需同时满足留城意愿与时间上限。',preferences).length)
 assert.ok(unsupportedPreferenceConstraintClaims('你的城市偏好是硬约束。',preferences).length)
 assert.ok(unsupportedPreferenceConstraintClaims('你非常重视的城市偏好必须满足。',preferences).length)
 for(const reply of ['城市偏好不等于硬约束；每周四小时仍是时间上限。','城市偏好不应被当作必须满足的条件。','如果把偏好作为硬约束，会有什么影响？','“城市偏好是硬约束”是待核对的引文。','```城市偏好是硬约束```','每周四小时的上限必须满足。'])assert.deepEqual(unsupportedPreferenceConstraintClaims(reply,preferences),[],reply)
 const owned=reportedEvidenceFromText('我更在意留在目前城市。我必须留在目前城市。').preferences
 assert.equal(owned[0]?.hardRequirementQuote,'我必须留在目前城市')
 assert.deepEqual(unsupportedPreferenceConstraintClaims('留在目前城市是你明确的硬要求，而不只是一般偏好。',owned),[])
 for(const verb of ['视为','当作']){
  const adopted=reportedEvidenceFromText(`我更在意留在目前城市。我把留在目前城市${verb}我的硬要求。`).preferences
  assert.equal(adopted[0]?.hardRequirementQuote,`我把留在目前城市${verb}我的硬要求`)
  assert.deepEqual(unsupportedPreferenceConstraintClaims('留在目前城市是你明确的硬要求。',adopted),[])
 }
 const oldSoft=preferences.map(item=>({...item,source:{id:'old'}})),newHard=owned.map(item=>({...item,source:{id:'now'}}))
 assert.deepEqual(unsupportedPreferenceConstraintClaims('留在目前城市的偏好是本人硬要求。',[...oldSoft,...newHard],'now'),[])
 const oldHard=newHard.map(item=>({...item,source:{id:'old'}})),currentSoft=preferences.map(item=>({...item,source:{id:'now'}}))
 assert.deepEqual(unsupportedPreferenceConstraintClaims('留在目前城市的偏好是本人硬要求。',[...oldHard,...currentSoft],'now'),[],'a current soft reiteration is not a revocation of an owned hard requirement')
 const revoked=reportedEvidenceFromText('我更在意留在目前城市。留在目前城市不再是我的硬要求。').preferences.map(item=>({...item,source:{id:'now'}}))
 assert.equal(revoked[0]?.hardRequirementRevocationQuote,'留在目前城市不再是我的硬要求')
 assert.ok(unsupportedPreferenceConstraintClaims('留在目前城市是本人硬要求。',[...oldHard,...revoked],'now').length,'an explicit current revocation cancels the older hard requirement')
 const explicitlyNot=reportedEvidenceFromText('我更在意留在目前城市。留在目前城市并不是我的硬要求。').preferences.map(item=>({...item,source:{id:'now'}}))
 assert.equal(explicitlyNot[0]?.hardRequirementRevocationQuote,'留在目前城市并不是我的硬要求')
 assert.ok(unsupportedPreferenceConstraintClaims('留在目前城市是本人硬要求。',[...oldHard,...explicitlyNot],'now').length)
 assert.ok(unsupportedPreferenceConstraintClaims('留在目前城市是必须满足的条件。',preferences).length)
 assert.ok(unsupportedPreferenceConstraintClaims('所有选项都必须满足留城条件。',preferences).length)
 assert.ok(unsupportedPreferenceConstraintClaims('你必须选择能留在目前城市的方案。',preferences).length)
 assert.ok(unsupportedPreferenceConstraintClaims('留城意愿是必要条件。',preferences).length)
 assert.deepEqual(unsupportedPreferenceConstraintClaims('留城工作必须满足学历要求。',preferences),[],'a qualification for local work does not harden the location preference')
 assert.deepEqual(unsupportedPreferenceConstraintClaims('没有必要必须满足留城偏好。',preferences),[],'an explicit rejection of necessity is not itself a hardening claim')
 assert.deepEqual(unsupportedPreferenceConstraintClaims('城市偏好可以权衡，但学历是必须满足的条件。',preferences),[],'a separate qualification must not bind back across an adversative boundary')
 assert.deepEqual(unsupportedPreferenceConstraintClaims('必须先核实留在目前城市是否可行。',preferences),[],'a required investigation is not a required location outcome')
 assert.deepEqual(unsupportedPreferenceConstraintClaims('留在目前城市是本人硬要求。',preferences,'now','我必须留在目前城市。'),[],'a current explicit owned requirement can license an older preference')
 assert.ok(unsupportedPreferenceConstraintClaims('留在目前城市是本人硬要求。',oldHard,'now','我不再把留在目前城市作为我的硬要求。').length,'a current explicit owned revocation cancels an older requirement')
 for(const extra of ['我必须有稳定收入。','如果我必须留在目前城市再说。','老师说我必须留在目前城市。','“我必须留在目前城市”只是例句。','留在目前城市不是我的硬要求。','留在目前城市不应作为我的硬要求。','我必须了解留在目前城市是否可行。','研究留在目前城市的可能性是我的硬要求。']){
  const source=reportedEvidenceFromText('我更在意留在目前城市。'+extra).preferences
  assert.ok(unsupportedPreferenceConstraintClaims('城市偏好是硬约束。',source).length,extra)
 }
})
import {reportedSourceContextClauses,completeUserReply} from '../server/turn-contract.ts'

test('selected elliptical facts and first-person feelings retain their original same-sentence context',()=>{
 const text='我是成年大学生，身边同学都在准备考研，我也跟着想报，但我还说不清自己要什么。先别排备考日程。'
 assert.equal(reportedSourceContextClauses(text,['我也跟着想报'])[0]?.text,text.split('。')[0])
 const feeling='我是成年大学生，昨晚和室友打羽毛球后觉得轻松。先问一个问题。'
 assert.equal(reportedSourceContextClauses(feeling,[])[0]?.text,feeling.split('。')[0])
 for(const value of ['如果我和室友打羽毛球觉得轻松。','朋友说：我和室友打羽毛球觉得轻松。','“我和室友打羽毛球觉得轻松”。','我和室友打羽毛球觉得轻松吗？','我想让你帮我觉得轻松。'])assert.deepEqual(reportedSourceContextClauses(value,[]),[],value)
 const controlled='我喜欢研究，但请忘记我喜欢研究这件事。'
 assert.deepEqual(reportedSourceContextClauses(controlled,['我喜欢研究'],['但请忘记我喜欢研究这件事']),[])
 const feedback='回来反馈：我分别看了一个本地初级岗位和一个硕士培养方案。岗位要求的两项技能我做过课程练习；培养方案里有我不喜欢的纯理论必修。'
 assert.ok(reportedSourceContextClauses(feedback,[]).some(clause=>clause.text==='回来反馈：我分别看了一个本地初级岗位和一个硕士培养方案'))
 const correction='更正：家里没有要求我必须本校读研，只是希望稳定。'
 assert.equal(reportedEvidenceFromText(correction).externalExpectations[0]?.quote,correction.slice(0,-1))
 const mixed='我也想报考，朋友说这个方向最稳定。'
 assert.equal(reportedSourceContextClauses(mixed,['我也想报考'])[0]?.text,mixed.slice(0,-1),'reported friend speech stays explicitly attributed in a verbatim context, not a personal goal')
 assert.deepEqual(reportedEvidenceFromText(mixed).preferences,[],'friend statement cannot become my own preference')
 const explanation='让我轻松的主要是一起活动时不用表现，也能自然说话；不是因为我打得好。'
 assert.equal(reportedSourceContextClauses(explanation,[])[0]?.text,explanation.split('；')[0])
})

test('valid JSON does not make a dangling or internal-protocol reply complete',()=>{
 assert.equal(completeUserReply('老师：response 由 reported_no_response 更新为 reported_response（原话','只更新各自状态。'),false)
 assert.equal(completeUserReply('老师本周忙（原话','只更新状态。'),false)
 assert.equal(completeUserReply('老师已回复（这周忙，下周再看），阅读状态未知。','只更新状态。'),true)
 assert.equal(completeUserReply('reported_response 表示已回复。','解释 reported_response。'),true)
})

test('response does not authorize positive reading or receipt claims in final prose',()=>{
 const evidence=reportedEvidenceFromText('回来反馈：老师后来回复说这周忙，下周再看；同学表格仍是明确不适合他。').participants
 for(const reply of ['老师回复已读，同学反馈明确不适合。','暂定理解是：老师邮件目前处于已收到、未回复状态。'])assert.ok(unsupportedParticipantReadingClaims(reply,evidence).length,reply)
 for(const reply of ['老师邮件：已回复，是否已读仍未知。','老师邮件：已回复，这周忙，下周再看。'])assert.deepEqual(unsupportedParticipantReadingClaims(reply,evidence),[],reply)
 const read=reportedEvidenceFromText('老师确认已经读到邮件').participants
 assert.deepEqual(unsupportedParticipantReadingClaims('老师已读。',read),[])
 assert.equal(reportedEvidenceFromText('老师没有确认收到邮件').participants[0]?.states.receipt.status,'unknown')
 for(const text of ['老师已读状态未知','老师回复不能证明已读','老师未报告已读'])assert.equal(taskOutcomeReadback(text,undefined,true).read.status,'unknown',text)
 assert.equal(reportedEvidenceFromText('另一位同学试过我做的表格后明确说不适合他').participants[0]?.states.trial.status,'reported_tried')
 assert.equal(reportedEvidenceFromText('同学说对方试用过表格').participants.length,0)
 for(const text of ['同学试过表格但是否采用未知','同学试过表格不代表已采用']){
  const states=reportedEvidenceFromText(text).participants[0]!.states
  assert.equal(states.trial.status,'reported_tried',text)
  assert.equal(states.adoption.status,'unknown',text)
 }
 assert.equal(reportedEvidenceFromText('同学试过但不确定').participants[0]?.states.trial.status,'unknown')
 assert.equal(taskOutcomeReadback('老师已读但不清楚是否采用',undefined,true).read.status,'reported_read')
 assert.equal(taskOutcomeReadback('老师已读但是不清楚是否采用',undefined,true).read.status,'reported_read')
 assert.equal(reportedEvidenceFromText('同学已经试用表格但是否采用未知').participants[0]?.states.trial.status,'reported_tried')
 assert.equal(reportedEvidenceFromText('同学不是已试用').participants[0]?.states.trial.status,'unknown')
 assert.deepEqual(reportedTaskOutcomeClauses('同学有没有试过表格',false,true),[])
 assert.equal(taskOutcomeReadback('老师已读但效果未知',undefined,true).read.status,'reported_read')
})

test('names and source-bound matters never authorize another participant or matter by role alone',()=>{
 const old=reportedEvidenceFromText('学长甲确认已读；学长乙未回复；另一位同学没有回复').participants
 assert.deepEqual(old.map(item=>item.actor),['学长甲','学长乙','另一位同学'])
 assert.ok(unsupportedParticipantReadingClaims('学长乙已读。',old).length)
 const first=reportedEvidenceFromText('老师确认已经读到邮件').participants.map(item=>({...item,source:{id:'old-node',eventId:'event-a'}}))
 const other=reportedEvidenceFromText('老师那封邮件未回复').participants.map(item=>({...item,source:{id:'current'}}))
 assert.ok(unsupportedParticipantReadingClaims('老师已读。',[...first,...other],{currentMessageId:'current',eventId:'event-b'}).length)
 assert.deepEqual(unsupportedParticipantReadingClaims('老师已读。',first,{currentMessageId:'current',eventId:'event-a'}),[])
 const ambiguous=reportedEvidenceFromText('老师第一封邮件已读；老师第二封邮件未回复').participants.map(item=>({...item,source:{id:'current'}}))
 assert.ok(unsupportedParticipantReadingClaims('老师第二封邮件已读。',ambiguous,{currentMessageId:'current'}).length)
 for(const actor of ['张老师','辅导员老师']){
  const reports=reportedEvidenceFromText(actor+'未回复').participants
  assert.equal(reports[0]?.actor,actor)
  assert.ok(unsupportedParticipantReadingClaims(actor+'已读。',reports).length)
 }
 assert.ok(unsupportedParticipantReadingClaims('老师上次确认已读。',other,{currentMessageId:'current'}).length)
})
import {reportedTaskOutcomeClauses,reportedPerformedTaskClauses,reportedTaskBoundaryClauses,taskOutcomeReadback} from '../server/turn-contract.ts'
import {conversationPreferenceClause,deferredPursuitClause,currentConversationOnly,scopedTaskPauseClause} from '../server/user-command-spans.ts'
import {pursuitLevel} from '../server/user-themes.ts'
import {isBlockedExperience} from '../server/starmap-enrichment.ts'

test('teacher and classmate follow-up reports preserve their own states without requiring a completed self-action',()=>{
 const text='回来反馈：老师后来回复说这周忙，下周再看；同学表格仍是明确不适合他。请只更新各自相关状态。'
 const clauses=reportedTaskOutcomeClauses(text,false,true)
 assert.ok(clauses.some(clause=>clause.text==='回来反馈：老师后来回复说这周忙，下周再看'))
 assert.ok(clauses.some(clause=>clause.text==='同学表格仍是明确不适合他'))
 const response=taskOutcomeReadback('老师后来回复说这周忙，下周再看',undefined,true)
 assert.equal(response.response.status,'reported_response')
 assert.equal(response.read.status,'unknown','reply does not prove reading the original material')
 const pending=taskOutcomeReadback('老师那封邮件是未回复',undefined,true)
 assert.equal(pending.response.status,'reported_no_response')
 assert.equal(pending.read.status,'unknown')
 for(const other of ['如果老师后来回复说这周忙，下周再看。','我读到“老师后来回复说这周忙，下周再看”。','老师后来回复说这周忙吗？'])assert.deepEqual(reportedTaskOutcomeClauses(other,false,true),[],other)
 assert.equal(taskOutcomeReadback('同学说对方已经回复',undefined,true).response.status,'unknown')
})

test('participant outcomes distinguish missing confirmation, actual non-reading, trial and observed effect',()=>{
 for(const text of ['导师没有确认读到','导师没有说他读过','导师可能还没有读到'])assert.equal(taskOutcomeReadback(text,undefined,true).read.status,'unknown',text)
 assert.equal(taskOutcomeReadback('导师回复说还没读',undefined,true).response.status,'reported_response')
 assert.equal(taskOutcomeReadback('导师确认收到PDF',undefined,true).response.status,'reported_response')
 assert.equal(taskOutcomeReadback('导师已经试用了表格',undefined,true).adoption.status,'unknown')
 assert.equal(taskOutcomeReadback('导师可能已经采用',undefined,true).adoption.status,'unknown')
 assert.equal(taskOutcomeReadback('导师说用了但没有效果',undefined,true).adoption.status,'reported_used')
 assert.equal(taskOutcomeReadback('导师说已经有用了',undefined,true).adoption.status,'unknown')
 assert.equal(taskOutcomeReadback('客户可能已经付款',undefined,true).payment.status,'unknown')
 for(const text of ['客户说已经用了，效果很好','客户说没有效果']){
  const effect=taskOutcomeReadback(text,undefined,true).effect
  assert.equal(effect.status,'reported_effect',text)
  assert.ok(effect.quote&&text.includes(effect.quote))
 }
 assert.equal(taskOutcomeReadback('没有给效果反馈',undefined,true).effect.status,'unknown')
 for(const text of ['效果未知','效果是未知','效果尚不明确'])assert.equal(taskOutcomeReadback(text,undefined,true).effect.status,'unknown',text)
})
import {clauseExpressesFuturePlan,clauseReportsCompleted} from '../server/experience-content.ts'
import {buildClauseCatalogue} from '../server/clause-catalogue.ts'
test('persisted V19 natural refusal, listening and exam pause use the shared boundary grammar',()=>{
 const refusal='上次那件作业的事我现在不想接着做，先别再给它排任务了。'
 assert.equal(currentConversationOnly(refusal),true)
 assert.equal(reportedTaskBoundaryClauses(refusal)[0]?.text,'上次那件作业的事我现在不想接着做')
 assert.equal(conversationPreferenceClause('我只是想说说卡在那道题的烦躁'),true)
 assert.equal(reportedTaskBoundaryClauses('考试复习这周先停一下。')[0]?.text,'考试复习这周先停一下')
 for(const text of ['同学表格那件事先暂停','先暂停这个方向'])assert.equal(reportedTaskBoundaryClauses(text+'。')[0]?.text,text)
 for(const text of ['如果同学表格那件事先暂停。','朋友说先暂停这个方向。','“同学表格那件事先暂停”。','先暂停这个方向吗？'])assert.deepEqual(reportedTaskBoundaryClauses(text),[],text)
 for(const text of ['老师让项目先暂停','导师建议这件事先暂停'])assert.equal(scopedTaskPauseClause(text),false,text)
 for(const text of ['我没有说项目先暂停','我没要求项目先暂停','我未决定项目先暂停'])assert.equal(scopedTaskPauseClause(text),false,text)
 assert.ok(reportedTaskBoundaryClauses('我已经把没完成的题列出来了，第五题还是不知道从哪里下手。').some(clause=>clause.text==='第五题还是不知道从哪里下手'))
 for(const other of ['如果考试复习这周先停一下。','同学说考试复习这周先停一下。','“考试复习这周先停一下”。','考试复习这周先停一下吗？'])assert.deepEqual(reportedTaskBoundaryClauses(other),[],other)
})
test('actual task observations retain separate read, response and adoption statements without importing a public case',()=>{
 const text='我通过学校邮箱请教学长甲，原请求是了解项目课。对方已经读了，但没有回复，也没有采用。'
 assert.deepEqual(reportedTaskOutcomeClauses(text).map(c=>c.text),['对方已经读了','但没有回复','也没有采用'])
 for(const other of ['案例里学生联系学长，对方已经读了。','如果我联系学长，对方已经读了也可能不回复。','我联系学长了吗？对方已经读了？','学长说：“我交付了，对方已经采用。”'])assert.deepEqual(reportedTaskOutcomeClauses(other),[],other)
})

test('confirmed read-to wording keeps read separate from adoption and effect',()=>{
 const text='回来反馈：我发了PDF，导师确认已经读到，但还没有说是否采用其中建议，也没有给效果反馈。'
 assert.deepEqual(reportedTaskOutcomeClauses(text).map(c=>c.text),['导师确认已经读到','但还没有说是否采用其中建议','也没有给效果反馈'])
 const outcomes=taskOutcomeReadback(text)
 assert.deepEqual(outcomes.read,{status:'reported_read',quote:'导师确认已经读到'})
 assert.equal(outcomes.adoption.status,'unknown')
 assert.equal(outcomes.effect.status,'unknown')
})
test('listening retains completed actions and direct reading reports; deferred choices and refusal are not pursuits',()=>{
 const text='我请教导师的邮件已经发出去了，对方看过但没有回应。我现在只想聊聊感受，别建议我催。'
 assert.deepEqual(reportedPerformedTaskClauses(text).map(c=>c.text),['我请教导师的邮件已经发出去了'])
 assert.deepEqual(reportedTaskOutcomeClauses(text).map(c=>c.text),['对方看过但没有回应'])
 for(const bad of ['我想交给客户了。','如果我问了导师。','同学说我问了导师。','“我问了导师”'])assert.deepEqual(reportedPerformedTaskClauses(bad),[])
 assert.equal(conversationPreferenceClause('也不要给我别的方法'),true)
 assert.equal(conversationPreferenceClause('我不想继续创业'),false)
 assert.equal(deferredPursuitClause('实习稍后再看'),true)
 assert.equal(pursuitLevel('实习稍后再看'),null)
 assert.equal(pursuitLevel('也不要给我别的方法'),null)
 assert.equal(pursuitLevel('我不再熬夜')?.kind,'pursuit')
 assert.equal(isBlockedExperience('我问了两位同学','还没用','我问了两位同学，他们还没用'),false)
 assert.equal(isBlockedExperience('问到一半卡住','还没结果',''),true)
 assert.equal(clauseReportsCompleted('之前的海报交付记录保留'),false)
 assert.deepEqual(pursuitLevel('我现在主要探索接单'),{kind:'exploration',status:'active'})
})

test('natural delivery and interviews keep reported adoption, payment and interest separate',()=>{
 assert.deepEqual(reportedTaskOutcomeClauses('我这次接单做完海报交给客户了，他说已经用了，但还没有付款。').map(c=>c.text),['他说已经用了','但还没有付款'])
 assert.deepEqual(reportedTaskOutcomeClauses('创业这边我问了三个同学，他们觉得听起来有意思，但谁也还没用。').map(c=>c.text),['他们觉得听起来有意思','但谁也还没用'])
 assert.deepEqual(reportedTaskOutcomeClauses('案例中客户说已经用了，但还没有付款。'),[])
})

test('task outcome nouns do not become future plans',()=>{
 assert.equal(clauseExpressesFuturePlan('我发了PDF，导师确认已经读到，但还没有说是否采用其中建议，也没有给效果反馈'),false)
 assert.equal(clauseExpressesFuturePlan('培养计划里有我不喜欢的纯理论必修'),false)
 assert.equal(clauseExpressesFuturePlan('我计划先核对一个岗位要求'),true)
 assert.equal(clauseExpressesFuturePlan('我建议先确认导师是否读到'),true)
})

 test("negative non-action never becomes an experience and paid outcomes stay separate",()=>{
 assert.equal(clauseReportsCompleted("我没有开始上次课程复习"),false)
 assert.equal(clauseReportsCompleted("我尚未完成海报"),false)
 assert.equal(taskOutcomeReadback("我已经交付了一张海报，对方已经采用，已经付款300元。").payment.status,"reported_paid")
 assert.equal(taskOutcomeReadback("我交付了海报，对方已经采用。",new Set()).adoption.status,"unknown")
})

test("similar messages with an explicitly different participant cannot update the same event",()=>{
 const source="我通过学校邮箱向学长甲发了项目课能否提供实习作品的问题"
 const other="我通过学校邮箱请教学长乙，原请求是想知道项目课能否提供实习作品。对方已经读了。"
 assert.equal(findEpisode([{id:"own",source_quote:source,content:{}}],other,"我通过学校邮箱请教学长乙",""),null)
})

test('a question after an exploration statement is not a fact; interest is a reported response only',()=>{
 const clauses=buildClauseCatalogue('我想探索校园项目，先了解同学实际遇到的麻烦，怎么开始？')
 assert.equal(clauses[0]!.interrogative,false)
 assert.equal(clauses[2]!.interrogative,true)
 const outcomes=taskOutcomeReadback('我已经访谈了一名同学，他说有兴趣，但尚未采用，也没有付款。')
 assert.deepEqual(outcomes.response,{status:'reported_response',quote:'他说有兴趣'})
 assert.equal(outcomes.read.status,'unknown')
 assert.equal(outcomes.adoption.status,'reported_not_used')
 assert.equal(outcomes.payment.status,'reported_unpaid')
 assert.equal(outcomes.effect.status,'unknown')
 for(const text of ['案例里学生访谈同学，他说有兴趣。','如果我访谈同学，他说有兴趣。','我访谈了一名同学，他有没有回复？'])assert.equal(taskOutcomeReadback(text).response.status,'unknown',text)
})
