import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {realBatchPreflight,executeRealBatch,realMetrics} from '../../scripts/workflow-real-batch.ts'
import {feedbackMatchesCurrent,classifyGuideFeedback} from '../../server/guide-usage.ts'
import {pool} from '../../server/db.ts'
test.after(()=>pool.end())
test('real reporting retains first failure, missing useful content, unknown cost and separates deep duration',()=>{
 const report=realMetrics([{stage:'ordinary20',firstUsefulMs:2100,replyCompleteMs:5000,wholeTurnMs:5200,costCny:0.01},{stage:'ordinary20',firstUsefulMs:null,replyCompleteMs:null,wholeTurnMs:9000,failure:'CANCELLED',costCny:'unknown'},{stage:'complex20_pairs',deepInput:true,firstUsefulMs:null,wholeTurnMs:14000,costCny:'unknown'},{stage:'complex20_pairs',firstUsefulMs:1,replyCompleteMs:2,wholeTurnMs:3,costCny:0.01}])
 assert.equal(report.ordinaryFirstAttempts,2);assert.equal(report.noFirstContent,1);assert.equal(report.failedOrCancelled,1);assert.equal(report.firstContentP50Ms,2100);assert.equal(report.wholeReplyP95Ms,null);assert.equal(report.observedCompleteReplyP95Ms,5000);assert.equal(report.noCompleteReply,1);assert.equal(report.unknownCostSamples,2);assert.equal(report.performanceStatus,'NOT_ACCEPTED_INCOMPLETE_OR_FAILED')
})
test('paused real batch preflight is read-only, preserves unique ledger, and dispatches zero without owner authorization',()=>{
 const path='.local/v1.3-action-coach/paid/provider-calls.json',hash=()=>existsSync(path)?createHash('sha256').update(readFileSync(path)).digest('hex'):'MISSING_NOT_COPIED',before=hash(),report=realBatchPreflight()
 assert.equal(report.status,'PAUSED_NOT_RUN');assert.ok(report.blocks.includes('EXPLICIT_MODEL_PAUSE_NOT_LIFTED'));assert.equal(report.productDispatches,0);assert.equal(report.cloudDispatches,0);assert.equal(hash(),before)
 const dir=process.env.LIFEOS_WORKFLOW_EVIDENCE;if(dir){mkdirSync(dir,{recursive:true});writeFileSync(dir+'/REAL_PREFLIGHT.json',JSON.stringify({...report,authorization:undefined},null,2)+'\n')}
})
test('saved natural refusal rejects continuation for another named matter, closes the same event; no ownership guessing',()=>{
 const raw='我现在不想继续扩大功能，先停在这里。'
 assert.equal(classifyGuideFeedback(raw),'declined');assert.equal(feedbackMatchesCurrent(raw,'校园工具开发','最小实验'),true)
 assert.equal(feedbackMatchesCurrent('我现在不想继续考研','校园工具开发','最小实验'),false)
 assert.equal(feedbackMatchesCurrent('现在想聊新的创业问题','课程复习','课程复习'),false)
})
test('explicit execution entry remains zero-dispatch until the existing pause is lifted',async()=>{
 if(process.env.LIFEOS_REAL_BATCH_EXECUTE!=='owner_authorized'){assert.equal(realBatchPreflight().productDispatches,0);return}
 const authorization=process.env.LIFEOS_REAL_BATCH_AUTHORIZATION,output=process.env.LIFEOS_REAL_BATCH_OUTPUT
 assert.ok(authorization&&output,'Owner authorization and unique output directory required')
 mkdirSync(output,{recursive:true});const result=await executeRealBatch(authorization,output);writeFileSync(output+'/execution-status.json',JSON.stringify(result,null,2)+'\n')
})
