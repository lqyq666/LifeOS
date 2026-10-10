import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {cozePreflight,verifyCozeReceipt} from '../../scripts/workflow-coze-real.ts'
import {pool} from '../../server/db.ts'
test.after(()=>pool.end())
test('cloud pause stays zero-dispatch and read-only; current copies and actual funding must be provided separately',()=>{
 const path='.local/v1.3-action-coach/paid/provider-calls.json',hash=()=>existsSync(path)?createHash('sha256').update(readFileSync(path)).digest('hex'):'MISSING_NOT_COPIED',before=hash(),pre=cozePreflight()
 assert.equal(pre.status,'PAUSED_NOT_RUN');assert.equal(pre.cloudDispatches,0);assert.equal(pre.uploads,0);assert.equal(pre.newProjects,0);assert.ok(pre.blocks.includes('EXPLICIT_COZE_PAUSE_NOT_LIFTED'));assert.equal(hash(),before)
})
test('local current-copy contract refuses cancelled, source conflicts, wrong releases, malformed and missing usage receipts',()=>{
 const expected={projectId:'7693465311558795327',release:'synthetic-only',sourceDigest:'a'.repeat(64),contentHash:'b'.repeat(64)},valid={schemaVersion:2,status:'proposed',runtime:expected,suggestedStateChanges:[],receipt:{id:'synthetic-local',usageCompleteness:'unknown',providerCalls:4,skills:[]}}
 assert.equal(verifyCozeReceipt(valid,expected).receipt.usageCompleteness,'unknown')
 for(const body of [{...valid,runtime:{...expected,projectId:'another'}},{...valid,runtime:{...expected,sourceDigest:'c'.repeat(64)}},{...valid,runtime:{...expected,release:'old'}},{...valid,suggestedStateChanges:[{kind:'goal'}]},{...valid,receipt:null},{...valid,receipt:{...valid.receipt,providerCalls:6}}])assert.throws(()=>verifyCozeReceipt(body,expected))
 assert.throws(()=>verifyCozeReceipt(valid,expected,true),/CANCELLED/)
})
