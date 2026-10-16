import test from 'node:test'
import assert from 'node:assert/strict'
import {campusReviewRows,campusDualCostSummary} from '../scripts/campus-benchmark-summary.ts'
import {coachSpeedSummary} from '../scripts/coach-stream-evidence.ts'

test('review rows separate transport, state effects and semantic truth (MET-01/02/03)',()=>{
  const rows=campusReviewRows([
    {logicalStepId:'C10:5',attemptId:'a1',actorKey:'C10',status:'SAVED',done:{stateChange:{growth:{status:'applied'}}}},
    {logicalStepId:'C10:6',attemptId:'a2',actorKey:'C10',status:'SAVED',done:{stateChange:{growth:{status:'needs_confirmation'}}}},
    {logicalStepId:'C10:7',attemptId:'a3',actorKey:'C10',status:'FAILED',error:'MODEL_TIMEOUT'},
  ])
  assert.equal(rows.length,3)
  assert.equal(rows[0]!.committed,true)
  assert.equal(rows[0]!.stateEffectsPassed,true)
  assert.equal(rows[0]!.semanticVerdict,'PENDING_REVIEW','no implementer self-assessment may count as PASS')
  assert.equal(rows[1]!.stateEffectsPassed,false,'a needs_confirmation update is not an applied effect')
  assert.equal(rows[2]!.committed,false)
  assert.equal(rows[2]!.semanticVerdict,'NOT_TESTED')
  assert.deepEqual(rows[2]!.hardFailures,['MODEL_TIMEOUT'])
  assert.ok(rows.every(row=>row.reviewer===null))
})

test('dual cost keeps SAVED and semantic PASS denominators apart; no PASS is NOT_EVALUABLE (MET-02)',()=>{
  const turns=[{status:'SAVED',actorKey:'C10',logicalStepId:'s1',attemptId:'a'},{status:'SAVED',actorKey:'C10',logicalStepId:'s2',attemptId:'b'},{status:'FAILED',actorKey:'C09',logicalStepId:'s1',attemptId:'c'}]
  const calls=[
    {status:'finished',estimatedCostCny:0.1,purpose:'turn'},
    {status:'finished',estimatedCostCny:0.2,purpose:'repair'},
  ]
  const withoutReview=campusDualCostSummary(turns,calls,[])
  assert.equal(withoutReview.costCnyPer100Committed,15,'per-100 committed uses real committed steps')
  assert.equal(withoutReview.costCnyPer100SemanticPass,'NOT_EVALUABLE','no independently reviewed PASS → NOT_EVALUABLE, never a SAVED stand-in')
  // N4.3: unique actor+step keys and reviewer-bound PASS only.
  const withReview=campusDualCostSummary(turns,calls,[
    {logicalStepId:'1',attemptId:'a',actorKey:'C10',transportStatus:'SAVED',committed:true,stateEffectsPassed:true,semanticVerdict:'PASS',hardFailures:[],reviewer:{kind:'independent_review',evidencePath:'x'}},
    {logicalStepId:'1',attemptId:'a2',actorKey:'C10',transportStatus:'SAVED',committed:true,stateEffectsPassed:true,semanticVerdict:'PASS',hardFailures:[],reviewer:{kind:'independent_review',evidencePath:'x'}},
    {logicalStepId:'2',attemptId:'b',actorKey:'C10',transportStatus:'SAVED',committed:true,stateEffectsPassed:false,semanticVerdict:'PASS',hardFailures:[],reviewer:null},
    {logicalStepId:'2',attemptId:'b',actorKey:'C09',transportStatus:'SAVED',committed:true,stateEffectsPassed:false,semanticVerdict:'PENDING_REVIEW',hardFailures:[],reviewer:null},
  ])
  assert.equal(withReview.committedLogicalSteps,3,'C10:1的两个attempt只计一步；C10:2与C09:2分别计数')
  assert.equal(withReview.semanticPassLogicalSteps,1,'唯一PASS=C10:1（无reviewer的PASS不计）')
  assert.equal(withReview.costCnyPer100SemanticPass,30,'0.3全部成本÷1个唯一PASS步骤→30/100，分母与committed不同源')
  assert.equal(withReview.semanticPassEvaluation,'SUBSET_REVIEWED_ONLY','a reviewed subset is never presented as the whole result')
  const unknown=campusDualCostSummary(turns,[...calls,{status:'pending',purpose:'turn'}],[])
  assert.equal(unknown.costCnyPer100Committed,'unknown')
})

test('speed summary reports failure rate and excludes zero-model turns from model samples (MET-04)',()=>{
  const summary=coachSpeedSummary([
    {sampleClass:'ordinary_followup',status:'SAVED',providerCallCount:1,meaningfulFirstMs:1000,completionMs:9000},
    {sampleClass:'ordinary_followup',status:'SAVED',providerCallCount:1,meaningfulFirstMs:2000,completionMs:10000},
    {sampleClass:'ordinary_followup',status:'SAVED',providerCallCount:0,meaningfulFirstMs:500,completionMs:600},
    {sampleClass:'ordinary_followup',status:'FAILED',providerCallCount:1},
    {sampleClass:'long_material',status:'SAVED',providerCallCount:1,meaningfulFirstMs:4000,completionMs:20000},
  ])
  assert.equal(summary.predeclaredOrdinary,4)
  assert.equal(summary.savedOrdinary,2,'deterministic zero-model turns are not real model samples')
  assert.equal(summary.deterministicZeroModelTurns,1)
  assert.equal(summary.groups.realModelFailure,1)
  assert.equal(summary.groups.deterministicZeroModel,1,'零模型成功不是失败')
  assert.equal(summary.failedOrdinary,1,'仅HTTP失败计入；零模型成功不是失败')
  assert.equal(summary.sampleFailureRate,0.25,'失败率以普通样本为分母（HTTP失败1/4），零模型成功不在其中')
  assert.equal(summary.status,'NOT_READY')
})
