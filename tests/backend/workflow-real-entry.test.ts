import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {realBatchPreflight,executeRealBatch,realMetrics,startRealAcceptanceHttp,selectRealPilotCases} from '../../scripts/workflow-real-batch.ts'
import {createServer} from 'node:http'
import {feedbackMatchesCurrent,classifyGuideFeedback} from '../../server/guide-usage.ts'
import {pool} from '../../server/db.ts'
test.after(()=>pool.end())
test('complex pilot selects one two-direction and one three-direction case without reissuing ordinary calls',()=>{
 const pairs=[{caseId:'two',directions:['employment','freelance']},{caseId:'three',directions:['employment','freelance','postgraduate_exam']}],ordinary=[{caseId:'ordinary1'},{caseId:'ordinary2'},{caseId:'ordinary3'}]
 const pilot=selectRealPilotCases({smallComplexOnly:true},pairs,ordinary)
 assert.deepEqual(pilot.complex.map(c=>c.caseId),['two','three']);assert.deepEqual(pilot.ordinary,[])
 assert.deepEqual(selectRealPilotCases({smallOrdinaryOnly:true},pairs,ordinary).complex,[])
 assert.throws(()=>selectRealPilotCases({smallOrdinaryOnly:true,smallComplexOnly:true},pairs,ordinary),/SCOPE_CONFLICT_ZERO_DISPATCH/)
 assert.throws(()=>selectRealPilotCases({smallComplexOnly:true},pairs.slice(0,1),ordinary),/CASES_MISSING/)
})
test('real acceptance serves only after retrieval startup; failed startup dispatches nothing',async()=>{
 let ready!:()=>void,closed=0
 const app=createServer(),embedding={start:()=>new Promise<void>(resolve=>{ready=resolve}),close:async()=>{closed++}}
 const starting=startRealAcceptanceHttp(app,embedding,0)
 assert.equal(app.listening,false)
 ready();const receipt=await starting
 assert.equal(app.listening,true);assert.equal(receipt.localEmbeddingReady,true)
 assert.equal(receipt.startupSeparateFromInteraction,true);assert.equal(receipt.productDispatches,0);assert.ok(receipt.startupMs>=0)
 await new Promise<void>(resolve=>app.close(()=>resolve()))
 const failed=createServer()
 await assert.rejects(startRealAcceptanceHttp(failed,{start:async()=>{throw new Error('ENCODER_UNAVAILABLE')},close:embedding.close},0),/ENCODER_UNAVAILABLE/)
 assert.equal(failed.listening,false);assert.equal(closed,1)
})
test('real reporting retains first failure, missing useful content, unknown cost and separates deep duration',()=>{
 const report=realMetrics([{stage:'ordinary20',firstUsefulMs:2100,replyCompleteMs:5000,wholeTurnMs:5200,costCny:0.01},{stage:'ordinary20',firstUsefulMs:null,replyCompleteMs:null,wholeTurnMs:9000,failure:'CANCELLED',costCny:'unknown'},{stage:'complex20_pairs',deepInput:true,firstUsefulMs:null,wholeTurnMs:14000,costCny:'unknown'},{stage:'complex20_pairs',firstUsefulMs:1,replyCompleteMs:2,wholeTurnMs:3,costCny:0.01}])
 assert.equal(report.ordinaryFirstAttempts,2);assert.equal(report.noFirstContent,1);assert.equal(report.failedOrCancelled,1);assert.equal(report.firstContentP50Ms,2100);assert.equal(report.wholeReplyP95Ms,null);assert.equal(report.observedCompleteReplyP95Ms,5000);assert.equal(report.noCompleteReply,1);assert.equal(report.unknownCostSamples,2);assert.equal(report.performanceStatus,'NOT_ACCEPTED_INCOMPLETE_OR_FAILED')
})
test('restored scope without a frozen batch remains read-only and preserves unique ledger',()=>{
 const path='.local/v1.3-action-coach/paid/provider-calls.json',hash=()=>existsSync(path)?createHash('sha256').update(readFileSync(path)).digest('hex'):'MISSING_NOT_COPIED',before=hash(),report=realBatchPreflight()
 assert.equal(report.status,'BLOCKED_CONFIG_NOT_RUN');assert.equal(report.scopeRestored,true);assert.ok(report.blocks.includes('TARGET_BATCH_AUTHORIZATION_BINDING_MISSING'));assert.equal(report.productDispatches,0);assert.equal(report.cloudDispatches,0);assert.equal(hash(),before)
 const dir=process.env.LIFEOS_WORKFLOW_EVIDENCE;if(dir){mkdirSync(dir,{recursive:true});writeFileSync(dir+'/REAL_PREFLIGHT.json',JSON.stringify({...report,authorization:undefined},null,2)+'\n')}
})

test('small ordinary first attempts remain visible and never fill the separate twenty-sample cohort',()=>{
 const report=realMetrics([{stage:'small',caseId:'ORD01',firstUsefulMs:8161,replyCompleteMs:9838,costCny:0.001},{stage:'small',caseId:'ORD02',firstUsefulMs:null,replyCompleteMs:null,failure:'CANCELLED',costCny:'unknown'},{stage:'small',caseId:'PAIR',deepInput:true,wholeTurnMs:14000,costCny:'unknown'}])
 assert.equal(report.smallOrdinary.firstAttempts,2);assert.equal(report.smallOrdinary.firstContentP95Ms,8161);assert.equal(report.smallOrdinary.noFirstContent,1);assert.equal(report.smallOrdinary.noCompleteReply,1);assert.equal(report.smallOrdinary.countedTowardOrdinary20,false)
 assert.equal(report.ordinaryFirstAttempts,0);assert.equal(report.firstContentP50Ms,null);assert.equal(report.unknownCostSamples,2);assert.equal(report.performanceStatus,'NOT_ACCEPTED_INCOMPLETE_OR_FAILED')
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
