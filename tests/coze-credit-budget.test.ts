import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {CozeCreditBudget} from '../scripts/coze-credit-budget.ts'
const sha='a'.repeat(64),projectId='7693388932939300905'
const fixture=()=>{const path=join(mkdtempSync(join(tmpdir(),'lifeos-credit-test-')),'synthetic-ledger.jsonl');return {path,budget:CozeCreditBudget.initialize(path,100,sha)}}
test('unknown failures survive process recreation and cannot be reissued or funded from CNY',()=>{
 const {path,budget}=fixture(),input={requestId:'first',projectId,purpose:'business' as const,reservedCredits:100,payloadDigest:sha,sourceDigest:sha}
 budget.reserve(input);budget.finishUnknown('first','failed',null,null)
 const restored=new CozeCreditBudget(path)
 assert.equal(restored.balance().availableCredits,0);assert.equal(restored.balance().heldCredits,100)
 assert.throws(()=>restored.reserve(input),/ALREADY_RESERVED/)
 assert.throws(()=>restored.reserve({...input,payloadDigest:'b'.repeat(64)}),/REQUEST_CONFLICT/)
 assert.throws(()=>restored.reserve({...input,requestId:'another'}),/UNAVAILABLE/)
 assert.throws(()=>CozeCreditBudget.initialize(path,100,sha))
 assert.throws(()=>restored.reconcile('first',0,sha),/EVIDENCE_REQUIRED/)
 restored.reconcile('first',12.2,sha)
 assert.deepEqual(restored.balance(),{initialCredits:100,chargedCredits:13,heldCredits:0,availableCredits:87})
 assert.throws(()=>restored.reconcile('first',12.2,sha),/CONFLICT/)
 assert.match(readFileSync(path,'utf8'),/unknown_not_converted/)
})
test('existing development ledger is read without replacement and unknown task blocks further spend',()=>{
 const {path}=fixture()
 writeFileSync(path,[{type:'development_reserved',requestId:'R1',observedAccountBalance:100,reservedCredits:100,budgetUnit:'coze_credits',newBudget:0},{type:'development_finished',requestId:'R1',accountedCredits:13},{type:'development_reserved',requestId:'R2',reservedCredits:87,budgetUnit:'coze_credits',newBudget:0}].map(row=>JSON.stringify(row)).join('\n')+'\n')
 const budget=new CozeCreditBudget(path)
 assert.equal(budget.balance().availableCredits,0)
 assert.throws(()=>budget.reserve({requestId:'third',projectId,purpose:'business',reservedCredits:1,payloadDigest:sha,sourceDigest:sha}),/UNAVAILABLE/)
 budget.reconcile('R2',20.1,sha);assert.equal(budget.balance().availableCredits,66)
 assert.throws(()=>budget.reserve({requestId:'invalid',projectId:'other-project',purpose:'business',reservedCredits:1,payloadDigest:sha,sourceDigest:sha}),/INVALID/)
})
test('concurrent lock and malformed billing stop with no dispatch or ledger replacement',()=>{
 const {path,budget}=fixture(),before=readFileSync(path,'utf8')
 writeFileSync(path+'.lock','synthetic other process')
 assert.throws(()=>budget.reserve({requestId:'first',projectId,purpose:'business',reservedCredits:1,payloadDigest:sha,sourceDigest:sha}),/BUSY_NO_RETRY/)
 assert.equal(readFileSync(path,'utf8'),before)
 writeFileSync(path,before+JSON.stringify({type:'credits_reconciled',requestId:'missing',accountedCredits:1})+'\n')
 assert.throws(()=>budget.balance(),/RECONCILIATION_INVALID/)
})

test('fresh account balance freezes the twenty-percent allowance without erasing older unknown holds',()=>{
 const {path,budget}=fixture(),prior={requestId:'prior',projectId,purpose:'business' as const,reservedCredits:40,payloadDigest:sha,sourceDigest:sha}
 budget.reserve(prior);budget.finishUnknown('prior','failed',null,null)
 budget.bindAccountAllowance({observedRemainingCredits:50,observedAt:'2026-10-12T05:43:35Z',approvalDigest:sha,balanceEvidenceDigest:sha})
 const restored=new CozeCreditBudget(path)
 assert.equal(restored.balance().heldCredits,40);assert.equal(restored.balance().availableCredits,10)
 assert.equal(restored.balance().maximumAdditionalCredits,10)
 assert.throws(()=>restored.reserve({...prior,requestId:'too-much',reservedCredits:11}),/UNAVAILABLE/)
 restored.reserve({...prior,requestId:'new',reservedCredits:9})
 assert.equal(restored.balance().availableCredits,1)
 assert.throws(()=>restored.bindAccountAllowance({observedRemainingCredits:1000,observedAt:'2026-10-12T05:44:35Z',approvalDigest:sha,balanceEvidenceDigest:sha}),/ALREADY_BOUND/)
 restored.reconcile('new',4.2,sha);assert.equal(restored.balance().allowanceAccountedCredits,5);assert.equal(restored.balance().availableCredits,5)
 assert.equal(restored.balance().heldCredits,40,'older opaque charges are never silently freed')
 assert.match(readFileSync(path,'utf8'),/account_allowance_bound/)
})

test('older unresolved holds that exceed the fresh balance block dispatch even under an unused allowance',()=>{
 const {budget}=fixture(),input={requestId:'old',projectId,purpose:'development' as const,reservedCredits:80,payloadDigest:sha,sourceDigest:sha}
 budget.reserve(input)
 budget.bindAccountAllowance({observedRemainingCredits:50,observedAt:'2026-10-12T05:43:35Z',approvalDigest:sha,balanceEvidenceDigest:sha})
 assert.equal(budget.balance().availableCredits,0)
 assert.throws(()=>budget.reserve({...input,requestId:'new',reservedCredits:1}),/UNAVAILABLE/)
 budget.reconcile('old',10,sha)
 assert.equal(budget.balance().availableCredits,10,'an observed bill may resolve the old hold, while the new allowance still caps spending')
 assert.throws(()=>budget.reserve({...input,requestId:'outside-approval',projectId:'7693892523869290496',reservedCredits:1}),/INVALID/)
})
