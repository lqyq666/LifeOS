import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeWeeklyPlanTasks,renderProposedWeeklyPlan,validateWeeklyPlanShape,type WeeklyPlanInput} from '../server/weekly-plans.ts'

test('the observed explicit unallocated buffer is not a scheduled task',()=>{
 const input:WeeklyPlanInput={target:{operation:'create'},availableMinutes:120,period:'this_week',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[{action:'完成当前最紧急的一门课作业',minutes:70,directionScopes:[]},{action:'复习该课核心章节或错题',minutes:30,directionScopes:[]},{action:'留白缓冲，不安排任务',minutes:20,directionScopes:[]}]}
 const plan=normalizeWeeklyPlanTasks(input)
 assert.equal(plan.items.length,2)
 assert.equal(plan.items.reduce((n,x)=>n+x.minutes,0),100)
 validateWeeklyPlanShape(plan)
 assert.match(renderProposedWeeklyPlan(plan),/未安排：20分钟/)
 for(const action of ['复习后休息','休息后完成作业','留白缓冲并检查作业','缓冲：整理资料'])assert.equal(normalizeWeeklyPlanTasks({...input,items:[{action,minutes:120,directionScopes:[]}]}).items.length,1,action)
 assert.throws(()=>validateWeeklyPlanShape(normalizeWeeklyPlanTasks({...input,items:[{action:'完成作业',minutes:121,directionScopes:[]}]})))
})
