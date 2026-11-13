import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {reportedCompletedContactClauses} from '../../server/turn-contract.ts'
import {reconcileActionStages} from '../../server/workflows/action-review.ts'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'
import {stageCoachEvent,coachEventView} from '../../server/action-coach-events.ts'

const empty={sent:null,read:null,replied:null,used:null,effect:null}
const delivered='我只补齐了姓名和时间两列并发给同学'
test('completed personal work coordinated with sending is delivery, while plans and another actor are not',()=>{
 for(const text of [delivered,'我整理了报名表并发给同学。','我整理了报名表并发给了同学。','本人核对了报告并交给老师。','今天我补齐了姓名和时间两列并发给同学。','回来反馈：我补齐了姓名和时间两列并发给同学。']){
  assert.equal(reconcileActionStages(empty,text).sent,true,text)
  assert.equal(reportedCompletedContactClauses(text).length,1)
 }
 for(const text of ['我打算补齐姓名和时间两列并发给同学。','如果我补齐了姓名和时间两列并发给同学。','我补齐了两列并准备发给同学。','我没有补齐两列并发给同学。','室友补齐了两列并发给同学。','我让室友补齐了两列并发给同学。','“我补齐了两列并发给同学”。','我不确定是否补齐了两列并发给同学。'])assert.equal(reconcileActionStages(empty,text).sent,null,text)
 assert.equal(reconcileActionStages(empty,'我补齐了两列，但还没发给同学。').sent,false)
 assert.equal(reconcileActionStages(empty,'我补齐了两列并发给同学的计划。').sent,null)
 assert.equal(reconcileActionStages(empty,'我完成了补齐姓名和时间两列并发给同学的安排。').sent,null)
 assert.equal(reconcileActionStages(empty,'我确认报名表已经补齐了姓名和时间两列并发给同学').sent,null)
 assert.equal(reconcileActionStages(empty,'我补齐了姓名和时间两列并发给同学但其实没发').sent,false)
 assert.equal(reconcileActionStages(empty,'我补齐了姓名和时间两列并发给同学但不知道他之后会不会使用').sent,true)
 assert.equal(reconcileActionStages(empty,'我补齐了两列并发给同学但不知道是否成功发出').sent,null)
 assert.equal(reconcileActionStages(empty,'我补齐了姓名和时间两列并发给同学但发送失败').sent,false)
 for(const text of ['我补齐了姓名和时间两列并发给同学但没发成功','我补齐了姓名和时间两列并发给同学但没有发成功','我发了报名表但其实没有发']){assert.equal(reportedCompletedContactClauses(text).length,0);assert.equal(reconcileActionStages(empty,text).sent,false)}
 for(const text of ['我补齐了表格并发给同学，随后发送失败','我补齐了表格并发给同学。发送失败。','我补齐了表格并发给同学。没发成功。','我补齐了表格并发给同学。没有发成功。']){assert.equal(reportedCompletedContactClauses(text).length,0);assert.equal(reconcileActionStages(empty,text).sent,false)}
 for(const text of ['我让室友发送报名表。发送失败。','我请同学提交材料。提交失败。','我发了报名表。随后提交失败。'])assert.equal(reconcileActionStages({...empty,sent:true},text).sent,true,text)
 for(const text of ['我不是没发','我并不是没发','我可没说我没发'])assert.equal(reconcileActionStages({...empty,sent:true},text).sent,true,text)
 assert.equal(reconcileActionStages(empty,'我发了报名表。邮件发送失败。').sent,false)
 assert.equal(reconcileActionStages(empty,'我发了报名表。我后来提交失败。').sent,true)
 for(const text of ['我提交了报名表但其实没发','我提交了报告但发送失败','我发了报名表但提交失败'])assert.equal(reconcileActionStages(empty,text).sent,true,text)
 for(const text of ['我发了报名表，但其实没发。','我发了报名表；不过其实没发成功。','我发了报名表。可是其实没有发。']){
  assert.equal(reportedCompletedContactClauses(text).length,0,text)
  assert.equal(reconcileActionStages(empty,text).sent,false,text)
 }
})
test('persisted feedback keeps sent, no reading and uncertain use separate from an unattempted rule',async()=>{
 const h=await residualHarness()
 try{
  const {user,chat}=await h.account()
  const quotes=[delivered,'还没开始设置数据验证规则','同学说打开时权限不足','所以没看到内容','我不知道修好权限后他会不会使用']
  const run=(await store.startRun(user,chat,randomUUID(),quotes.join('；')+'。')).run
  const coach=await stageCoachEvent(run,{target:{operation:'create',title:'报名表',source:{messageId:run.source_message_id,quote:delivered}},nodes:quotes.map(quote=>({kind:'fact',source:{messageId:run.source_message_id,quote}}))},'原规则仍未执行，查看失败和将来是否使用分别保留。')
  await store.finishRun(run,{candidates:[],audit:[],coach},'原规则仍未执行，查看失败和将来是否使用分别保留。',null,new AbortController().signal)
  const event=await coachEventView(user,chat)
  assert.equal(event?.actionStages?.sent,true)
  assert.equal(event?.actionStages?.read,false)
  assert.equal(event?.actionStages?.used,null)
  assert.equal(event?.matterProgress?.state,'unattempted')
  assert.ok(event?.actionStageEvidence?.sent?.evidenceQuotes.includes(delivered))
  assert.ok(event?.actionStageEvidence?.used?.evidenceQuotes.includes(quotes[4]!),'explicit unknown stays a sourced unknown, not positive use')
 }finally{await h.close()}
})
