import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {campusCostSummary} from '../../scripts/campus-benchmark-summary.ts'
import {activeCoachFunding} from '../../scripts/coach-provider-budget.ts'

test('preflight chooses current grant even when historical funds are paused, depleted or larger',()=>{
  const current={remainingCny:29.95,paused:false},historical={remainingCny:0,paused:true}
  assert.equal(activeCoachFunding({currentGrant:current,additional:historical}),current)
  assert.equal(activeCoachFunding({currentGrant:{remainingCny:0,paused:true},additional:{remainingCny:15,paused:false}}).paused,true)
  assert.equal(activeCoachFunding({additional:historical}),historical)
  assert.equal(activeCoachFunding({}),null)
})

test('campus cost counts failed generations and repairs, keeps unknown costs unknown and separates quality',()=>{
  const turns=[{status:'SAVED'},{status:'FAILED'}],calls=[{status:'finished',purpose:'turn',estimatedCostCny:0.002},{status:'finished',purpose:'turn',estimatedCostCny:0.003},{status:'finished',purpose:'repair',estimatedCostCny:0.004}]
  const result=campusCostSummary(turns,calls)
  assert.equal(result.costCnyPer100Successful,0.9);assert.equal(result.providerCalls,3);assert.equal(result.successfulInteractions,1);assert.equal(result.repairCalls,1)
  assert.equal(result.qualityAcceptance,'PENDING_SEPARATE_SEMANTIC_REVIEW')
  assert.equal(campusCostSummary(turns,[...calls,{status:'finished',purpose:'repair',estimatedCostCny:'unknown'}]).costCnyPer100Successful,'unknown')
  assert.equal(campusCostSummary(turns,[...calls,{status:'reserved',purpose:'turn',estimatedCostCny:0.1}]).costCnyPer100Successful,'unknown')
  assert.equal(campusCostSummary([{status:'FAILED'}],calls).costCnyPer100Successful,'unknown')
})

test('campus benchmark fixture covers continuous adult growth and independent counterfactual branches without auto answers',()=>{
  const fixture=JSON.parse(readFileSync('tests/fixtures/campus-growth-trajectories.json','utf8'))
  assert.equal(fixture.hiddenFactsNeverInjected,true)
  // P1: 13 continuous-experience trajectories + 13 PC matrix additions
  // (PC03 four-branch, PC05/07/08/09/11/12/15/06 singles, D01 demo arc).
  assert.equal(fixture.trajectories.length,30)
  assert.equal(new Set(fixture.trajectories.map((row:any)=>row.id)).size,30)
  assert.ok(fixture.trajectories.every((row:any)=>typeof row.opening==='string'&&row.privateFacts&&row.hardFailures.length))
  assert.ok(fixture.trajectories.every((row:any)=>typeof row.privateFacts.age==='number'&&row.privateFacts.age>=18),'every synthetic student is an adult')
})
