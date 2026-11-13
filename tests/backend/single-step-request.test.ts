import test from 'node:test'
import assert from 'node:assert/strict'
import {requestsTimeArrangement,weeklyPlanIntent} from '../../server/turn-obligations.ts'
import {responseRequestScope} from '../../server/user-command-spans.ts'
import {requestedActionLimitAccepts} from '../../server/turn-contract.ts'
import {knowledgeIntent} from '../../server/evergreen-guide.ts'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import {pool} from '../../server/db.ts'

const input='我是20岁的统计学大二学生，会用Excel。上周课程表是我整理的，但我没有按时交付；上个月的数据练习也没有按时提交，不能说成两次按时完成。现在想了解数据运营实习，手头有一份已保存的岗位说明，今天原本能用30分钟，不想联系陌生人。先帮我安排一个能真正开始的步骤，不要从这些经历推断稳定能力或性格。'

test('a requested starting step is not a schedule, while an additional scheduling request stays open',()=>{
 assert.equal(knowledgeIntent(input).decision,'NONE','one starting step alone does not request a public guide')
 assert.equal(knowledgeIntent('请给我一个步骤。',{hasPriorGuide:true}).decision,'METHOD','an authorized existing guide stays available')
 for(const text of ['请参考经历梳理方法，给我一个能开始的步骤。','请给我一个步骤，并解释原理是什么。','请告诉我整理经历的具体步骤。'])assert.equal(knowledgeIntent(text).decision,'METHOD',text)
 for(const text of [input,'请帮我安排一个能开始的步骤。','这周还剩两小时，先帮我安排一个小验证。']){
  assert.equal(requestsTimeArrangement(text),false,text)
  assert.equal(weeklyPlanIntent(text),null,text)
  assert.equal(responseRequestScope(text).actionLimit,1,text)
 }
 for(const text of ['这周还剩两小时，帮我安排课程作业。','请帮我安排一个周计划。','帮我安排本周的一个行动。','请帮我安排明天下午的一个步骤。','请帮我安排一个明天下午的小验证。','请帮我安排一个能开始的步骤，安排在明天下午。','先帮我安排一个小验证。另外帮我安排这周的复习时间。']){
  assert.equal(requestsTimeArrangement(text),true,text)
  assert.ok(weeklyPlanIntent(text),text)
 }
 assert.equal(responseRequestScope('请给我一个包含三个步骤的详细操作方案。').actionLimit,1)
 assert.equal(responseRequestScope('请给我一个针对之前三个步骤的下一步行动。').actionLimit,1)
 assert.equal(responseRequestScope('请给我一个针对我之前安排三个步骤失败后的下一步行动。').actionLimit,1)
 assert.equal(responseRequestScope('请给我一个分成三个具体步骤的操作方案。').actionLimit,1)
 assert.equal(requestedActionLimitAccepts('这一次验证分三个步骤：先复制表格，再核对一行，最后记录结果。','请给我一个包含三个步骤的详细操作方案。'),true)
 assert.equal(responseRequestScope('请给我一个10分钟内到点停的步骤。').actionLimit,1)
 for(const text of ['时间安排在明天下午。请帮我安排一个能开始的步骤。','明天下午，帮我安排一个小验证。','我想在14:00做，帮我安排一个小验证。']){
  assert.equal(requestsTimeArrangement(text),true,text)
  assert.ok(weeklyPlanIntent(text),text)
 }
 assert.equal(requestsTimeArrangement('请帮我安排一个能开始的步骤，不要推断稳定能力并给我三个建议。'),true)
 for(const slot of ['今晚','今早','明早','明晚','后天早上','周末','下周','下星期','下个星期','下礼拜','月底','下个月']){
  const text=`我想${slot}做。请帮我安排一个小验证。`
  assert.equal(requestsTimeArrangement(text),true,text)
  assert.ok(weeklyPlanIntent(text),text)
 }
 for(const text of ['请帮我安排一个能开始的步骤，不要从经历推断稳定能力并给我三个建议再推断性格。','请帮我安排一个能开始的步骤，不要从经历安排明天的任务再推断性格。']){
  assert.equal(requestsTimeArrangement(text),true,text)
  assert.ok(weeklyPlanIntent(text),text)
 }
})

test('the observed real request excludes plan generation before dispatch and saves the complete response',async()=>{
 const h=await residualHarness()
 try{
  const {user,chat}=await h.account(),reply='打开本地岗位说明，选一条要求，写下你已经做过的相关操作；到30分钟就停，是否完成仍未知。'
  const run=await h.execute(user,chat,input,{},reply)
  const schema=h.requests.at(-1).response_format.json_schema.schema
  assert.equal(schema.properties.weeklyPlan,undefined)
  assert.ok(h.requests[0].messages.some((m:any)=>m.content.includes('"methodContext":[]')))
  assert.equal(h.requests.length,1)
  assert.ok(h.requests[0].messages.some((m:any)=>m.role==='system'&&m.content.includes('默认先用一个短段落')))
  assert.equal(h.requests[0].max_completion_tokens,8192)
  const saved=await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,run.request_id])
  assert.deepEqual(saved.rows.map(row=>row.content),[reply])
 }finally{await h.close()}
})
