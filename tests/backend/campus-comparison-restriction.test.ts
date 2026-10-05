import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {comparisonAllowance} from '../../scripts/coach-provider-budget.ts'
import {campusComparisonArtifacts} from '../../scripts/campus-benchmark-summary.ts'
const prefix=[{callId:'historical',status:'finished',estimatedCostCny:1}]
const restriction={startingCall:1,priorReceiptsSha256:createHash('sha256').update(JSON.stringify(prefix)).digest('hex'),grantSha256:'grant',limitCny:27.92 as const,maximumCalls:8 as const}
const ledger=(calls:any[])=>({currentGrant:{authorizationSha256:'grant'},calls:[...prefix,...calls]})
test('actual reply-only high-thinking shape cannot pass a required growth stage through an empty operation',()=>{
  const output={reply:'你的情况我按三层来拆：已有证据、未知、以及各选项与你约束的匹配度。\n\n**已有能力证据**\n- 两次独立完成课程数据分析，老师评价'}
  assert.equal(campusComparisonArtifacts(output).growthStageEligible,false)
  assert.equal(campusComparisonArtifacts({...output,growthUpdates:[]}).growthStageEligible,false)
  const present=campusComparisonArtifacts({...output,growthUpdates:[{source:{quote:'实际原话'}}]})
  assert.equal(present.growthStageEligible,true)
  assert.equal(present.semanticQuality,'PENDING_MANUAL_REVIEW');assert.equal(present.fullBusinessAcceptance,'NOT_TESTED')
})
test('comparison cap preserves prefix and permanently counts pending/unknown starts within exact 27.92',()=>{
  const calls=[{status:'reserved',reservedCostCny:10},{status:'finished',estimatedCostCny:'unknown',reservedCostCny:5},{status:'finished',estimatedCostCny:2}]
  assert.deepEqual(comparisonAllowance(ledger(calls),restriction),{remainingCalls:5,remainingCny:10.92,accountedCny:17})
  assert.equal(comparisonAllowance(ledger(Array.from({length:8},()=>({status:'finished',estimatedCostCny:0.01}))),restriction).remainingCalls,0)
  assert.equal(comparisonAllowance(ledger([{status:'reserved',reservedCostCny:27.9212822}]),restriction).remainingCny,0)
  assert.throws(()=>comparisonAllowance({...ledger([]),calls:[]},restriction),/CHANGED/)
  assert.throws(()=>comparisonAllowance(ledger([{status:'reserved'}]),restriction),/UNBOUNDED/)
  assert.throws(()=>comparisonAllowance({...ledger([]),currentGrant:{authorizationSha256:'other'}},restriction),/CHANGED/)
})
