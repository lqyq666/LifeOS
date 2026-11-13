import test from 'node:test'
import assert from 'node:assert/strict'
import {applicableTimeBudget,deriveTurnObligations} from '../server/turn-obligations.ts'

test('remaining time that can now be used is availability, not already spent time',()=>{
 const text='这周课程赶，只剩两小时能用了，剩下的怎么安排？'
 const budget=applicableTimeBudget(text,undefined,'this_week',{retainReportedBudget:true})
 assert.equal(budget?.amountMinutes,120)
 assert.equal(budget?.scope,'remaining')
 assert.deepEqual(deriveTurnObligations(text).requiredEffects.map(effect=>effect.type),['remaining_time','weekly_plan'])
 for(const spent of ['我这周已经用了两小时','我这周用了两小时','如果我这周只剩两小时能用了，该怎么安排？','同学这周只剩两小时能用了'])assert.equal(applicableTimeBudget(spent,undefined,'this_week',{retainReportedBudget:true}),undefined,spent)
})
