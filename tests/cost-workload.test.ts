import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSyntheticCostTarget, classifyMonthlyCostCny, estimateProviderCallCostCny } from '../server/cost-workload.ts'

test('provider cost applies normal input, cache-read input, and output prices separately',()=>{
  const pricing={inputCnyPerMillion:0.8,outputCnyPerMillion:2.7,cachedInputCnyPerMillion:0.1}
  assert.equal(estimateProviderCallCostCny(213,2048,26,pricing),0.0004454)
  assert.equal(estimateProviderCallCostCny(213,2048,26,{inputCnyPerMillion:0.8,outputCnyPerMillion:2.7}),0.001879)
  assert.equal(estimateProviderCallCostCny(0,0,0,null),'unknown')
  assert.equal(estimateProviderCallCostCny(-1,0,0,pricing),'unknown')
})

test('cost status uses the requested monthly thresholds and target report contains no workload estimate',()=>{
  assert.equal(classifyMonthlyCostCny(0.499),'COST_ACCEPTED')
  assert.equal(classifyMonthlyCostCny(0.5),'COST_OPTIMIZATION_REQUIRED')
  assert.equal(classifyMonthlyCostCny(0.8),'COST_OPTIMIZATION_REQUIRED')
  assert.equal(classifyMonthlyCostCny(0.801),'COST_NOT_ACCEPTED')
  assert.equal(classifyMonthlyCostCny('unknown'),'NOT_EVALUABLE')
  const report=buildSyntheticCostTarget('2026-10-02T00:00:00.000Z')
  assert.equal(report.status,'TARGET_ONLY')
  assert.equal(report.workload.monthlyTurns,300)
  assert.equal('estimatedCostCny' in report,false)
})
