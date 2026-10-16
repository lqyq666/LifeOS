import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync,readFileSync,unlinkSync,rmdirSync,existsSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {captureCoachSource,assertCoachSourceFreeze} from '../../scripts/coach-source-freeze.ts'
import {coachBudgetObserver} from '../../scripts/coach-budget-observer.ts'
import {CoachProviderBudget} from '../../scripts/coach-provider-budget.ts'
import {config} from '../../server/config.ts'

test('SIMULATED source/config freeze stops changed cohorts while retaining already reserved usage',async()=>{
  const root=resolve('.local/v1.3-action-coach/simulation-freeze-'+randomUUID()),freeze=resolve(root,'freeze.json')
  const names=['package.json','server/turn-engine.ts','server/action-coach-contracts.ts','src/backend/client.ts','Dockerfile','compose.yaml','.dockerignore','deploy/nginx.conf.example']
  const extra=resolve(root,'server/added.ts')
  const authorization=resolve(root,'evidence/v1.2.1-reliability/20261003-authorized300-11/PROVIDER_AUTHORIZATION.json')
  // A free guard test must not depend on the owner's historical grant/receipts.
  mkdirSync(dirname(authorization),{recursive:true});writeFileSync(authorization,JSON.stringify({kind:'SYNTHETIC_TEST_ONLY',runs:[],batchMaximumCalls:300,observedStarts:0,unknownInterruptedCallMaximum:0,reservedMaximumActiveRun:0,unreservedRemaining:300,unknownUsageCalls:0,knownEstimatedSubtotalCny:0,activeRun:null}))
  const budget=new CoachProviderBudget({root,simulation:true,testDirectory:'simulation-'+randomUUID()})
  const oldConcurrency=config.generationConcurrency
  for(const name of names){mkdirSync(dirname(resolve(root,name)),{recursive:true});writeFileSync(resolve(root,name),'synthetic '+name)}
  try{
    const captured=captureCoachSource(root);writeFileSync(freeze,JSON.stringify(captured))
    assert.equal(assertCoachSourceFreeze(freeze,root),captured.digest)
    const modified=resolve(root,names[1]!);writeFileSync(modified,'changed')
    assert.throws(()=>assertCoachSourceFreeze(freeze,root),/SOURCE_OR_CONFIG_CHANGED/)
    writeFileSync(modified,'synthetic '+names[1]);writeFileSync(extra,'new source')
    assert.throws(()=>assertCoachSourceFreeze(freeze,root),/SOURCE_OR_CONFIG_CHANGED/);unlinkSync(extra)
    for(const name of ['Dockerfile','compose.yaml','deploy/nginx.conf.example']){
      const path=resolve(root,name);writeFileSync(path,'changed deployment')
      assert.throws(()=>assertCoachSourceFreeze(freeze,root),/SOURCE_OR_CONFIG_CHANGED/)
      writeFileSync(path,'synthetic '+name)
    }
    config.generationConcurrency=oldConcurrency+1
    assert.throws(()=>assertCoachSourceFreeze(freeze,root),/SOURCE_OR_CONFIG_CHANGED/);config.generationConcurrency=oldConcurrency
    const tampered={...captured,files:captured.files.map((file,i)=>i===0?{...file,sha256:'0'.repeat(64)}:file)}
    writeFileSync(freeze,JSON.stringify(tampered));assert.throws(()=>assertCoachSourceFreeze(freeze,root),/SOURCE_OR_CONFIG_CHANGED/)
    writeFileSync(freeze,JSON.stringify(captured))
    const observer=coachBudgetObserver({runId:'SIMULATED',sourceRoot:root,freezePath:freeze,budget})
    const call:any={callId:randomUUID(),purpose:'turn',tier:'default',provider:'synthetic',model:'synthetic',configSignature:'synthetic',outcome:'pending',usageCompleteness:'unavailable',pricing:null,providerResponseId:null}
    await observer.before(call)
    const receipt=budget.snapshot().calls[0]
    assert.equal(receipt.sourceDigest,captured.digest);assert.equal(receipt.logicalCallId,call.callId);assert.equal(receipt.status,'reserved')
    await assert.rejects(async()=>observer.before(call),/DUPLICATE_PROVIDER_CALL/)
    writeFileSync(extra,'changed while request is running')
    await assert.rejects(async()=>observer.after({...call,outcome:'failed'}),/SOURCE_OR_CONFIG_CHANGED/)
    const finished=budget.snapshot().calls[0]
    assert.equal(finished.status,'finished');assert.equal(finished.usage,'unknown');assert.equal(finished.estimatedCostCny,'unknown')
    await assert.rejects(async()=>observer.before({...call,callId:randomUUID()}),/SOURCE_OR_CONFIG_CHANGED/)
    assert.equal(budget.snapshot().calls.length,1)
    assert.doesNotMatch(readFileSync(freeze,'utf8'),/apiKey|authSecret|postgres:\/\//)
  }finally{
    config.generationConcurrency=oldConcurrency
    // Exact synthetic files and empty directories only; no recursive removal.
    for(const path of [...names.map(name=>resolve(root,name)),extra,freeze,authorization,budget.path,budget.path+'.lock'])if(existsSync(path))unlinkSync(path)
    for(const path of [resolve(root,'src/backend'),resolve(root,'src'),resolve(root,'server'),resolve(root,'deploy'),dirname(authorization),resolve(root,'evidence/v1.2.1-reliability'),resolve(root,'evidence'),dirname(budget.path),resolve(root,'.local/v1.3-action-coach'),resolve(root,'.local'),root])if(existsSync(path))rmdirSync(path)
  }
})
