import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {CoachProviderBudget} from '../scripts/coach-provider-budget.ts'

test('clean simulation needs no private paid history; real budget still fails closed',()=>{
 const root=mkdtempSync(join(tmpdir(),'lifeos-synthetic-budget-'))
 const budget=new CoachProviderBudget({root,simulation:true,testDirectory:'simulation-reproduction'})
 assert.equal(budget.snapshot().evidence,'SIMULATED_BUDGET_GUARD')
 const receipt=budget.reserve({runId:'synthetic',purpose:'turn',tier:'default',provider:'loopback',model:'synthetic',signature:'synthetic',logicalCallId:'synthetic:1',reservedCostCny:0.1})
 budget.finish(receipt.callId,{outcome:'cancelled',usage:null,estimatedCostCny:'unknown',providerResponseId:null})
 const snapshot=budget.snapshot()
 assert.equal(snapshot.calls.length,1)
 assert.equal(snapshot.calls[0].estimatedCostCny,'unknown')
 assert.equal(snapshot.calls[0].reservedCostCny,0.1)
 assert.equal(snapshot.remaining,127)
 assert.equal(JSON.parse(readFileSync(budget.path,'utf8')).evidence,'SIMULATED_BUDGET_GUARD')
 const paid=new CoachProviderBudget({root})
 assert.throws(()=>paid.snapshot(),/ENOENT/)
 assert.equal(existsSync(paid.path),false)
})
