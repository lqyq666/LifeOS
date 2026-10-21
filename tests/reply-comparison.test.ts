import test from 'node:test'
import assert from 'node:assert/strict'
import {Value} from 'typebox/value'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {deriveTurnContract,bindRequestedComparisonSchema,comparisonReplyAccepts,bindRequestedSummarySchema,summaryReplyAccepts} from '../server/turn-contract.ts'
import {comparisonUniverseAccepts,requestedActionLimitAccepts} from '../server/turn-contract.ts'

test('finite comparisons cannot claim an unreported closed universe and one small action cannot schedule two new trials',()=>{
 const text='每周最多两小时。请比较一个更低成本的探索方式。'
 assert.equal(comparisonUniverseAccepts('在这些条件下，能比较的方式只有两类。',text),false)
 assert.equal(comparisonUniverseAccepts('能比较的方式只有两类。','我只有两个小时，请比较。'),false,'a time quantity is not a closed option universe')
 assert.equal(comparisonUniverseAccepts('当前选取两种方式作比较，不代表全部可能。',text),true)
 assert.equal(comparisonUniverseAccepts('目前只有两个选项。','我只有两个选项，请比较。'),true)
 assert.equal(comparisonUniverseAccepts('方式只有两类。','我不是只有两个选项，请比较。'),false)
 assert.equal(comparisonUniverseAccepts('方式只有两类。','我的选项并非只有两类，请比较。'),false)
 assert.equal(comparisonUniverseAccepts('并非只有两类，以下只是例子。',text),true)
 assert.equal(comparisonUniverseAccepts('本轮选取的方式只有两类，其他可能仍可存在。',text),true)
 assert.equal(comparisonUniverseAccepts('只有两个选项。','绝非只有两个选项，请比较。'),false)
 assert.equal(comparisonUniverseAccepts('绝非只有两个选项。',text),true)
 const action='请给暂定理解和一个很小的区分办法。'
 assert.equal(requestedActionLimitAccepts('先观察一次；如果不同，再试一次。做完这两次对照就停。',action),false)
 assert.equal(requestedActionLimitAccepts('只作一次新观察，记下本次感受就停，仍不能分配原因。',action),true)
 assert.equal(requestedActionLimitAccepts('不要安排两次对照，只做一次新观察就停。',action),true)
 assert.equal(requestedActionLimitAccepts('你之前已经完成两次观察，本轮只新增一次就停。',action),true)
 assert.equal(requestedActionLimitAccepts('你过去记录里的两次结果来自做两次尝试；现在只做一个新验证。',action),true)
})

test('a requested understanding must not be replaced by the previous question plus status acknowledgements',()=>{
 const text='依据这条反馈更新自由的理解；现在不继续行动。'
 const base=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
 const before=JSON.stringify(base),bound=bindRequestedSummarySchema(base,text)
 assert.equal(JSON.stringify(base),before)
 assert.deepEqual(bound.capabilities,base.capabilities)
 const reply=(bound.schema.properties as any).reply
 assert.equal(Value.Check(reply,'地点自由但每天两次会，这和你在意的自主安排专注时间冲突吗？目前没有对照，创业不重开，现在不继续行动。'),false)
 assert.equal(Value.Check(reply,'地点自由并不等于专注时段自主；固定会议的时长和可调整性仍未知。'),true)
 for(const text of ['现在不继续行动。','已更新当前状态。','已记录。','先暂停。','明白了。','收到并记住了。'])assert.equal(summaryReplyAccepts(text),false,text)
 assert.equal(summaryReplyAccepts('地点自由不等于专注时段自主；固定会议是否可调整仍未知。'),true)
})
import {parseActionCoachTurn} from '../server/action-coach-contracts.ts'

test('an interrupted real repeated-node stream is never accepted from its completed reply prefix',()=>{
 const partial=readFileSync(new URL('./fixtures/real-cz-interrupted.txt',import.meta.url),'utf8').trim()
 assert.ok(partial.includes('"reply":'))
 assert.ok((partial.match(/不提供私人资料/g)??[]).length>=10)
 assert.throws(()=>parseActionCoachTurn(partial))
})

test('the captured real numbered comparison remains byte-bound and structurally accepted without rewriting',()=>{
 const raw=readFileSync(new URL('./fixtures/real-comparison-cy.txt',import.meta.url),'utf8').trim()
 assert.equal(createHash('sha256').update(raw).digest('hex'),'89940a2cd08896e70464554e8fa42c3167ea535fe85b709d97350873b64ef4b5')
 assert.equal(comparisonReplyAccepts(JSON.parse(raw).reply),true)
})

test('legacy lettered comparisons remain presentation-valid while native generation starts at its option label',()=>{
 const textRaw=readFileSync(new URL('./fixtures/real-comparison-cs.txt',import.meta.url),'utf8').trim()
 assert.equal(createHash('sha256').update(textRaw).digest('hex'),'3ade0e805fae518c2c43bba95dea71992a5924aa7d5b74b7cc8749c6a9b5a76b')
 const raw=JSON.parse(textRaw)
 assert.equal(comparisonReplyAccepts(raw.reply),true)
 const text='请比较两个选项。'
 const bound=bindRequestedComparisonSchema(deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),text)
 assert.equal(Value.Check((bound.schema.properties as any).reply,raw.reply),false,'legacy introductory prose is not the new generation prefix, but remains structurally recognizable above')
 assert.equal(Value.Check((bound.schema.properties as any).reply,'A. 回看已有任务的时间安排，结果只作线索。\nB. 若有公开资料再看一次工作节奏，没有资料就保留未知。'),true)
 assert.equal(comparisonReplyAccepts('A. 你想做什么？B. 你有多少时间？'),false)
 assert.equal(comparisonReplyAccepts('比较如下：A. 先回看已有记录。\nB. 先保留未知。'),true)
})

test('an explicit comparison binds finite options without creating a material or truncating facts',()=>{
 const text='请比较一个更低成本的探索方式，不要推出我适合自由职业。'
 const base=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
 const before=JSON.stringify(base)
 const bound=bindRequestedComparisonSchema(base,text)
 assert.equal(JSON.stringify(base),before)
 assert.equal(bound.requiredReplyKind,'comparison')
 assert.equal((bound.schema.properties as any).lead,undefined,'comparison starts with actual option content, not an independent judgment header')
 assert.deepEqual(bound.capabilities,base.capabilities)
 const reply=(bound.schema.properties as any).reply
 assert.equal(Value.Check(reply,'你想探索哪个具体方向？'),false)
 const actual='方式一：先回看已有的学习记录，只整理本人做过的事情。方式二：有现成公开岗位说明时只看工作节奏；没有资料就先保留未知。两者都不证明职业适合。'
 assert.equal(Value.Check(reply,actual),true)
 assert.equal(Value.Check(reply,'先概括可选方式。'+actual),false,'the native generation contract starts at the option label')
 assert.equal(comparisonReplyAccepts(actual),true)
 assert.equal(comparisonReplyAccepts('你想先做方式一还是方式二？'),false)
 assert.equal(comparisonReplyAccepts('方式一：方式二：'),false)
 assert.equal(comparisonReplyAccepts('方式二：后者。方式一：前者。'),false)
 assert.equal(comparisonReplyAccepts('1. 先回看已有经历，不猜能力。\n2. 条件允许再观察一次，不推职业适合。'),true)
 assert.equal(comparisonReplyAccepts('你想先做“方式一：回看记录；方式二：做新事”吗？'),false)
 assert.equal(comparisonReplyAccepts('方式一：你想做什么？方式二：你有多少时间？'),false)
})

test('comparison presentation preserves listening, quantity, material and explicit-format boundaries',()=>{
 for(const text of ['只想聊聊，不用比较。','如果请比较两种方法会怎样？','朋友说：请比较两种方法。','请用一句阶段理解比较两次感受。','请用表格比较两个选项。','请比较两个选项，不要分点。','请比较两条问法，只给我一句最合适的问题。','请比较两个选项，只说哪个好。']){
  const base=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
  assert.equal(bindRequestedComparisonSchema(base,text),base,text)
 }
})
