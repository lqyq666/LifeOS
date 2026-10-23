import test from 'node:test'
import assert from 'node:assert/strict'
import {unrelatedExternalCorrection,sameReportedResponseSubject} from '../server/turn-contract.ts'
import {repairReviewedDefects} from '../server/review-repairs.ts'

test('an external expectation cannot overwrite an unrelated personal preference',()=>{
 assert.equal(unrelatedExternalCorrection('我并不享受考试本身','更正：家里没有要求我必须本校读研'),true)
 assert.equal(unrelatedExternalCorrection('我并不享受考试本身','家里没有要求我参加考试'),true)
 assert.equal(unrelatedExternalCorrection('我喜欢考试，也不喜欢早起','家里希望稳定。我现在喜欢考试'),true)
 assert.equal(unrelatedExternalCorrection('我并不享受考试本身','更正：我现在享受考试本身'),false)
 assert.equal(unrelatedExternalCorrection('家里要求我必须本校读研','更正：家里没有要求我必须本校读研'),false)
 assert.equal(unrelatedExternalCorrection('我并不享受考试本身','家里希望我参加考试。我现在喜欢考试本身'),false)
})

test('later response can retire a generic earlier report only within its bound event',()=>{
 const current='回来反馈：老师后来回复说这周忙，下周再看；同学表格仍是明确不适合他。'
 for(const old of ['老师没回复只是结果未知','老师没有回复只是结果未知','更正并区分两件事：老师那封邮件是未回复']){
  assert.equal(sameReportedResponseSubject(old,current),false,'bare role is not a global identity')
  assert.equal(sameReportedResponseSubject(old,current,{sameEvent:true}),true)
 }
 for(const [old,next] of [
  ['老师没回复只是结果未知','老师后来回复说PDF已读'],
  ['老师没回复只是结果未知','老师后来回复说另一件事'],
  ['老师没回复课程作业邮件','老师后来回复说这周忙'],
  ['同学未回复','老师后来回复说这周忙'],
  ['老师没回复','如果老师后来回复说这周忙怎么办？'],
 ])assert.equal(sameReportedResponseSubject(old,next,{sameEvent:true}),false,old+' / '+next)
})

test('a peer example does not become the students meeting refusal',()=>{
 const user='依据这条反馈更新“自由”的理解。创业仍然拒绝，不要自动重开。'
 const reply='依据校友个例，自由目前指向地点灵活但排斥固定会议。创业保持拒绝不重开。仍未知的是固定会议对本人专注安排的具体影响及无客户时的行动边界。'
 const prior=['我主要在意能自己安排一天中专注工作的时间，不在意当老板，也不想承担找客户和收款。','回来反馈：我只查看了一位校友公开分享的远程岗位经历。他说地点自由，但每天固定开两次会。这是一条个例。']
 const fixed=repairReviewedDefects(reply,user,prior)?.reply??reply
 assert.doesNotMatch(fixed,/排斥固定会议/)
 assert.match(fixed,/能自己安排一天中专注工作的时间/)
 assert.match(fixed,/创业保持拒绝不重开/)
 assert.match(fixed,/仍未知的是固定会议/)
 assert.equal(repairReviewedDefects(reply,user,[])?.reply??reply,reply,'missing owned history must not invent a preference')
 const oldVariant='依据校友个例，你对“自由”的理解暂定为：地点灵活但需容忍固定会议对专注时间的打断。'
 assert.equal(repairReviewedDefects(oldVariant,user,[])?.reply??oldVariant,oldVariant)
})
