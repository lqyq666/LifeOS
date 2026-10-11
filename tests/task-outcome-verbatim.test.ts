import {findEpisode} from '../server/experience-episodes.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {reportedTaskOutcomeClauses,reportedPerformedTaskClauses,taskOutcomeReadback} from '../server/turn-contract.ts'
import {conversationPreferenceClause,deferredPursuitClause} from '../server/user-command-spans.ts'
import {pursuitLevel} from '../server/user-themes.ts'
import {isBlockedExperience} from '../server/starmap-enrichment.ts'
import {clauseReportsCompleted} from '../server/experience-content.ts'
test('actual task observations retain separate read, response and adoption statements without importing a public case',()=>{
 const text='我通过学校邮箱请教学长甲，原请求是了解项目课。对方已经读了，但没有回复，也没有采用。'
 assert.deepEqual(reportedTaskOutcomeClauses(text).map(c=>c.text),['对方已经读了','但没有回复','也没有采用'])
 for(const other of ['案例里学生联系学长，对方已经读了。','如果我联系学长，对方已经读了也可能不回复。','我联系学长了吗？对方已经读了？','学长说：“我交付了，对方已经采用。”'])assert.deepEqual(reportedTaskOutcomeClauses(other),[],other)
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
