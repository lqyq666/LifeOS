import test from 'node:test'
import assert from 'node:assert/strict'
import {applicableTimeBudget,deriveTurnObligations} from '../server/turn-obligations.ts'
import {selectWorkflowBudget} from '../server/workflows/task-sources.ts'
import type {EvidenceRecord,WorkflowRequest} from '../server/workflows/contracts.ts'

const report='本周剩余可投入时间更正为0分钟'
test('the observed zero-time correction replaces the historical 90-minute budget',()=>{
 const current=applicableTimeBudget(report)
 assert.equal(current?.amountMinutes,0)
 assert.equal(current?.period,'this_week')
 assert.equal(current?.scope,'remaining')
 assert.ok(deriveTurnObligations(report).requiredEffects.some(effect=>effect.type==='remaining_time'&&effect.minutes===0))
 const records:EvidenceRecord[]=[{ref:{type:'message',id:'00000000-0000-4000-8000-000000000001',revision:1},owner:'synthetic',conversationId:null,status:'active',role:'user',text:report,budget:current},{ref:{type:'growth',id:'00000000-0000-4000-8000-000000000002',revision:1},owner:'synthetic',conversationId:null,status:'active',role:'user',text:'这周剩余可投入90分钟',budget:applicableTimeBudget('这周剩余可投入90分钟')}]
 const request={hostSnapshot:{budgetQuestion:{period:'this_week'}}} as WorkflowRequest
 const selected=selectWorkflowBudget(request,records)
 assert.equal(selected?.amountMinutes,0)
 assert.equal(selected?.source.type,'message')
})

test('the added spelling does not turn quoted, conditional or another person time into own availability',()=>{
 for(const text of ['老师说“本周剩余可投入时间更正为0分钟”。','如果本周剩余可投入时间更正为0分钟怎么办？','同学本周剩余可投入时间更正为0分钟'])assert.equal(applicableTimeBudget(text),undefined,text)
 assert.equal(applicableTimeBudget('本周剩余可投入时间更正为30分钟')?.amountMinutes,30)
})
