import test from 'node:test'
import assert from 'node:assert/strict'
import {Value} from 'typebox/value'
import {deriveTurnContract,bindRequestedSummarySchema,isSingleSentenceReply} from '../server/turn-contract.ts'
import {repairReviewedDefects} from '../server/review-repairs.ts'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {parseActionCoachTurn} from '../server/action-coach-contracts.ts'
import {responseRequestScope} from '../server/user-command-spans.ts'

test('actual DE correction plus a small action request stays a mixed delivery',()=>{
 const text='更正：同学少问一次只是结果，不代表我因此有成就感；我当时真正轻松的是自己不用反复找。只更新受影响的判断，给一个本周能开始的小动作。'
 const scope=responseRequestScope(text)
 assert.equal(scope.actionRequested,true)
 assert.equal(scope.actionLimit,1)
 const base=deriveTurnContract({text,knowledgeCount:0,currentEventExists:true,planIntent:false,material:false})
 const bound=bindRequestedSummarySchema(base,text)
 assert.deepEqual(bound.capabilities,base.capabilities)
 assert.equal(bound.requiredReplyKind,'summary')
 assert.ok(Value.Check((bound.schema.properties as any).reply,'轻松来自自己不用反复找，是否普遍适用仍未知。'.repeat(6)+'本周只记录一次自己检索所需的时间。'))
 assert.equal(Value.Check((bound.schema.properties as any).reply,'你当时为何轻松？\n未知项：你是否有成就感？'),false)
})

test('assessment plus a small action binds declarative unknowns before question pruning',()=>{
 const text='请基于这些信息更新暂定判断，说清还不知道什么，并给一个本周能开始的小验证，不要替我选定方向。'
 const base=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
 const bound=bindRequestedSummarySchema(base,text),reply=(bound.schema.properties as any).reply
 assert.equal(bound.requiredReplyKind,'summary')
 assert.equal(Value.Check(reply,'你更想先验证哪条路径？\n2. **未知项**：\n- 你对稳定的个人定义是什么？'),false)
 assert.ok(Value.Check(reply,'应用型方向值得探索；稳定的具体含义、课程成果的可展示程度和本地岗位要求仍未知。本周先看一个本地岗位，记录课程项目可对应的要求。'))
})

test('one sentence mixed assessment still requests the action within that sentence',()=>{
 const text='请用一句话总结判断，并给一个本周能开始的小行动。'
 const base=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
 const reply=(bindRequestedSummarySchema(base,text).schema.properties as any).reply
 assert.match(reply.description,/同一句中还须交付/)
 assert.ok(Value.Check(reply,'课程项目只能提供初步线索，本周先对照一个本地岗位标出已有和缺少的证据。'))
 assert.equal(Value.Check(reply,'课程项目只提供初步线索。先看一个岗位。'),false)
})

test('the real malformed summary remains rejected, never prefix-parsed or stripped into acceptance',()=>{
 const raw=readFileSync(new URL('./fixtures/rejected-native-summary-cp.txt',import.meta.url),'utf8').trim()
 assert.equal(createHash('sha256').update(raw).digest('hex'),'930eb3d8fda724d2763c179b6318593763ecdf59dbcf28e37f02e4f4efa6ced4')
 assert.throws(()=>parseActionCoachTurn(raw),SyntaxError)
})

test('one-sentence summary is bound before generation without changing factual capabilities',()=>{
 const text='我今天没有精力。只给一句阶段理解。'
 const base=deriveTurnContract({text,knowledgeCount:0,currentEventExists:true,planIntent:false,material:false})
 const original=JSON.stringify(base)
 const bound=bindRequestedSummarySchema(base,text)
 assert.equal(JSON.stringify(base),original)
 assert.deepEqual(bound.capabilities,base.capabilities)
 const reply=(bound.schema.properties as any).reply
 assert.ok(Value.Check(reply,'这次检索只有一次报告，稳定效果仍未知。'))
 for(const value of ['这次只有一次。暂不能推职业适配。','先暂停。\n接下来再看。','x'.repeat(241)])assert.equal(Value.Check(reply,value),false)
})

test('summary binding excludes materials, plans, quotes and other speakers while non-quantity summaries keep multiple sentences',()=>{
 for(const text of ['“只给一句阶段理解”。','朋友说：只给一句阶段理解。']){
  const base=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
  assert.equal(bindRequestedSummarySchema(base,text),base)
 }
 const text='请说明当前理解。',base=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
 const bound=bindRequestedSummarySchema(base,text)
 assert.equal(bound.requiredReplyKind,'summary')
 assert.ok(Value.Check((bound.schema.properties as any).reply,'这次只提供一条线索。长期适配仍未知。'))
 assert.equal(Value.Check((bound.schema.properties as any).reply,'你想说明什么理解？'),false)
 assert.equal(bindRequestedSummarySchema(base,text,true),base,'an explicit separate question keeps its own requested delivery')
 for(const [kind,text] of [['material','只给一句阶段理解。帮我写一句请教消息。'],['plan','只给一句阶段理解。安排本周计划。']]){
  const base=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:kind==='plan',material:kind==='material'})
  assert.equal(bindRequestedSummarySchema(base,text),base)
 }
})

test('a complete original one-sentence understanding is not expanded by legacy phase-summary repair',()=>{
 const user='先暂停这个方向，只给一句阶段理解。'
 const reply='这次按三条规则找到通知只是个例，是否稳定有用仍未知。'
 const out=repairReviewedDefects(reply,user)?.reply??reply
 assert.equal(out,reply)
 assert.equal(isSingleSentenceReply(out),true)
 assert.equal(isSingleSentenceReply('这次是个例。以后未知。'),false)
})
