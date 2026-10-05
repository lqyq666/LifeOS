import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {readFileSync,writeFileSync,unlinkSync,rmdirSync,existsSync} from 'node:fs'
import {dirname} from 'node:path'
import {CoachProviderBudget,readCoachAuthorization} from '../../scripts/coach-provider-budget.ts'

test('SIMULATED continuation keeps old receipts, removes call-count ceilings and caps exact new spend including unknowns',()=>{
  const budget=new CoachProviderBudget({simulation:true,testDirectory:'simulation-'+randomUUID()}),directory=dirname(budget.path)
  const grantPath=directory+'/development-test-grant-20261005.json',notePath=directory+'/campus-acceptance-continuation-20261005.json'
  const input={runId:'synthetic',purpose:'turn' as const,tier:'default',provider:'synthetic',model:'synthetic',signature:'synthetic',reservedCostCny:0.1}
  try{
    budget.snapshot()
    writeFileSync(grantPath,JSON.stringify({kind:'SIMULATED_DEVELOPMENT_TEST_GRANT',amountCny:30,startingCall:0,priorReceiptsSha256:createHash('sha256').update('[]').digest('hex')}))
    const grant=budget.activateCurrentGrant(),old=budget.reserve(input)
    budget.finish(old.callId,{outcome:'completed',usage:{},estimatedCostCny:0.1,providerResponseId:null})
    const original=budget.snapshot()
    writeFileSync(notePath,JSON.stringify({kind:'SIMULATED_ACCEPTANCE_CONTINUATION',amountCny:27.62,noCallLimit:true,startingCall:original.calls.length,grantSha256:grant.authorizationSha256,priorReceiptsSha256:createHash('sha256').update(JSON.stringify(original.calls)).digest('hex'),previousComparisonSha256:null}))
    const activation=budget.activateContinuation()
    for(let index=0;index<9;index++){const receipt=budget.reserve(input);budget.finish(receipt.callId,{outcome:'completed',usage:{},estimatedCostCny:0.01,providerResponseId:null})}
    const unknown=budget.reserve({...input,reservedCostCny:10});budget.finish(unknown.callId,{outcome:'aborted',usage:'unknown',estimatedCostCny:'unknown',providerResponseId:null})
    const snapshot=budget.snapshot()
    assert.equal(snapshot.continuation.accountedCny,10.09);assert.equal(snapshot.continuation.remainingCny,17.53)
    assert.deepEqual(snapshot.calls.slice(0,original.calls.length),original.calls)
    assert.throws(()=>budget.reserve({...input,reservedCostCny:17.531}),/CONTINUATION_BUDGET/)
    assert.equal(budget.activateContinuation().activatedAt,activation.activatedAt,'reactivation cannot reset receipts or amount')
    const bytes=readFileSync(notePath);writeFileSync(notePath,bytes.toString().replace('27.62','27.63'))
    assert.throws(()=>budget.snapshot(),/CONTINUATION_AUTHORIZATION_CHANGED/)
    writeFileSync(notePath,bytes)
    assert.equal(budget.snapshot().continuation.remainingCny,17.53)
  }finally{
    for(const path of [notePath,grantPath,budget.path,budget.path+'.lock'])if(existsSync(path))unlinkSync(path)
    if(existsSync(directory))rmdirSync(directory)
  }
})

test('SIMULATED comparison reservation enforces exact budget and eight starts under the existing ledger lock',()=>{
  const budget=new CoachProviderBudget({simulation:true,testDirectory:'simulation-'+randomUUID()}),notePath=dirname(budget.path)+'/development-test-grant-20261005.json'
  try{
    const initial=budget.snapshot(),prefix=createHash('sha256').update(JSON.stringify(initial.calls)).digest('hex')
    writeFileSync(notePath,JSON.stringify({kind:'SIMULATED_DEVELOPMENT_TEST_GRANT',amountCny:30,startingCall:0,priorReceiptsSha256:prefix}))
    const grant=budget.activateCurrentGrant()
    const restriction={startingCall:0,priorReceiptsSha256:prefix,grantSha256:grant.authorizationSha256,limitCny:27.92 as const,maximumCalls:8 as const}
    const input={runId:'synthetic',purpose:'diagnostic' as const,tier:'default',provider:'synthetic',model:'qwen3.8-flash',signature:'synthetic',reservedCostCny:0.1}
    assert.throws(()=>budget.reserve({...input,reservedCostCny:27.9212822},restriction),/COMPARISON_BUDGET/)
    assert.throws(()=>budget.reserve({...input,purpose:'turn'},restriction),/COMPARISON_BUDGET/)
    for(let index=0;index<8;index++){const receipt=budget.reserve(input,restriction);budget.finish(receipt.callId,{outcome:'unknown',usage:'unknown',estimatedCostCny:'unknown',providerResponseId:null})}
    assert.throws(()=>budget.reserve(input,restriction),/COMPARISON_BUDGET/)
    assert.equal(budget.snapshot().calls.length,8)
  }finally{
    for(const path of [notePath,budget.path,budget.path+'.lock'])if(existsSync(path))unlinkSync(path)
    if(existsSync(dirname(budget.path)))rmdirSync(dirname(budget.path))
  }
})

test('SIMULATED new monetary grant preserves old receipts, caps only new spend, and cannot refund unknown usage',()=>{
  const budget=new CoachProviderBudget({simulation:true,testDirectory:'simulation-'+randomUUID()})
  const notePath=dirname(budget.path)+'/development-test-grant-20261005.json'
  const input={runId:'synthetic',purpose:'turn' as const,tier:'default',provider:'synthetic',model:'synthetic',signature:'synthetic',reservedCostCny:10}
  try{
    const old=budget.reserve(input);budget.finish(old.callId,{outcome:'completed',usage:{},estimatedCostCny:0.1,providerResponseId:null})
    const original=budget.snapshot(),prefix=createHash('sha256').update(JSON.stringify(original.calls)).digest('hex')
    writeFileSync(notePath,JSON.stringify({kind:'SIMULATED_DEVELOPMENT_TEST_GRANT',amountCny:30,startingCall:original.calls.length,priorReceiptsSha256:prefix,scope:'synthetic test'}))
    budget.activateCurrentGrant()
    const one=budget.reserve(input)
    budget.finish(one.callId,{outcome:'aborted',usage:'unknown',estimatedCostCny:'unknown',providerResponseId:null})
    const two=budget.reserve(input);budget.finish(two.callId,{outcome:'completed',usage:{},estimatedCostCny:1,providerResponseId:null})
    const snapshot=budget.snapshot()
    assert.equal(snapshot.currentGrant.accountedCny,11)
    assert.equal(snapshot.currentGrant.remainingCny,19)
    assert.deepEqual(snapshot.calls.slice(0,original.calls.length),original.calls)
    assert.equal(snapshot.remaining,original.remaining,'new funding does not consume old call authorization')
    assert.throws(()=>budget.reserve({...input,reservedCostCny:20}),/BUDGET_EXHAUSTED_OR_PRICE_REQUIRED/)
    const bytes=readFileSync(notePath)
    writeFileSync(notePath,JSON.stringify({kind:'SIMULATED_DEVELOPMENT_TEST_GRANT',amountCny:31}))
    assert.throws(()=>budget.snapshot(),/CURRENT_GRANT_CHANGED/)
    writeFileSync(notePath,bytes)
    const three=budget.reserve({...input,reservedCostCny:19});budget.finish(three.callId,{outcome:'completed',usage:{},estimatedCostCny:20,providerResponseId:null})
    assert.equal(budget.snapshot().currentGrant.paused,true)
    assert.throws(()=>budget.reserve({...input,reservedCostCny:0.01}),/BUDGET_EXHAUSTED_OR_PRICE_REQUIRED/)
  }finally{
    for(const path of [notePath,budget.path,budget.path+'.lock'])if(existsSync(path))unlinkSync(path)
    if(existsSync(dirname(budget.path)))rmdirSync(dirname(budget.path))
  }
})

test('SIMULATED budget reserves before usage, survives restart and refuses excess/locked/tampered writes',()=>{
  const authorization=readCoachAuthorization(),directory='simulation-'+randomUUID()
  const budget=new CoachProviderBudget({simulation:true,testDirectory:directory})
  const input={runId:'synthetic',purpose:'turn' as const,tier:'default',provider:'synthetic',model:'synthetic',signature:'synthetic'}
  try{
    assert.equal(budget.snapshot().remaining,Math.min(128,authorization.remaining))
    assert.equal(existsSync(budget.path),false,'a read snapshot must not create or replace a ledger')
    const first=budget.reserve(input)
    assert.equal(JSON.parse(readFileSync(budget.path,'utf8')).calls[0].status,'reserved')
    const originalBytes=readFileSync(budget.path)
    budget.snapshot()
    assert.deepEqual(readFileSync(budget.path),originalBytes,'reading must preserve the exact durable receipt bytes')
    const restarted=new CoachProviderBudget({simulation:true,testDirectory:directory})
    assert.equal(restarted.snapshot().remaining,Math.min(128,authorization.remaining)-1)
    restarted.finish(first.callId,{outcome:'aborted',usage:'unknown',estimatedCostCny:'unknown',providerResponseId:null})
    assert.throws(()=>restarted.finish(first.callId,{outcome:'stop',usage:0,estimatedCostCny:0,providerResponseId:null}),/ALREADY_FINISHED/)
    writeFileSync(budget.path+'.lock',JSON.stringify({pid:process.pid}))
    assert.throws(()=>budget.reserve(input),/BUDGET_LOCKED/)
    unlinkSync(budget.path+'.lock')
    const ledger=restarted.snapshot()
    // Saturate only this synthetic fixture, without making any provider request.
    while(ledger.calls.length<Math.min(128,authorization.remaining))ledger.calls.push({...first,callId:randomUUID()})
    writeFileSync(budget.path,JSON.stringify(ledger))
    assert.throws(()=>budget.reserve(input),/BUDGET_EXHAUSTED/)
    ledger.authorization.sha256='changed';writeFileSync(budget.path,JSON.stringify(ledger))
    assert.throws(()=>budget.snapshot(),/LEDGER_INVALIDATED/)
    assert.deepEqual(readCoachAuthorization(),authorization)
  }finally{
    for(const path of [budget.path,budget.path+'.lock'])if(existsSync(path))unlinkSync(path)
    if(existsSync(dirname(budget.path)))rmdirSync(dirname(budget.path))
  }
  assert.throws(()=>new CoachProviderBudget({simulation:true,testDirectory:'paid'}),/PATH_INVALID/)
  assert.throws(()=>new CoachProviderBudget({simulation:true,testDirectory:'../escape'}),/PATH_INVALID/)
})
test('SIMULATED remaining allocation caps overhead at 64, users at 70 and their distinct repair calls separately',()=>{
  const budget=new CoachProviderBudget({simulation:true,testDirectory:'simulation-'+randomUUID()})
  const input={runId:'synthetic',tier:'default',provider:'synthetic',model:'synthetic',signature:'synthetic'}
  try{
    budget.reallocateRemainingPlan(readCoachAuthorization().remaining)
    for(let i=0;i<64;i++)budget.reserve({...input,purpose:i%2?'diagnostic':'capability'})
    assert.throws(()=>budget.reserve({...input,purpose:'capability'}),/CAPABILITY_DIAGNOSTIC_RESERVATION_EXHAUSTED/)
    const ids=Array.from({length:70},()=>randomUUID())
    for(const id of ids)budget.reserve({...input,purpose:'turn',logicalCallId:id+':1'})
    assert.throws(()=>budget.reserve({...input,purpose:'turn',logicalCallId:randomUUID()+':1'}),/USER_TURN_RESERVATION_EXHAUSTED/)
    assert.throws(()=>budget.reserve({...input,purpose:'turn',logicalCallId:ids[0]+':1'}),/DUPLICATE_PROVIDER_LOGICAL_CALL/)
    budget.reserve({...input,purpose:'repair',logicalCallId:ids[44]+':2'})
    assert.throws(()=>budget.reserve({...input,purpose:'repair',logicalCallId:ids[44]+':2'}),/DUPLICATE_PROVIDER_LOGICAL_CALL/)
    assert.equal(budget.snapshot().calls.length,135)
  }finally{
    for(const path of [budget.path,budget.path+'.lock'])if(existsSync(path))unlinkSync(path)
    if(existsSync(dirname(budget.path)))rmdirSync(dirname(budget.path))
  }
})

test('SIMULATED shared repair reserve cannot pay for a repair without generation or exceed 22 repairs',()=>{
  const budget=new CoachProviderBudget({simulation:true,testDirectory:'simulation-'+randomUUID()}),input={runId:'synthetic',tier:'default',provider:'synthetic',model:'synthetic',signature:'synthetic'}
  try{
    assert.throws(()=>budget.reserve({...input,purpose:'repair',logicalCallId:randomUUID()+':2'}),/REPAIR_GENERATION_REQUIRED/)
    const ids=Array.from({length:23},()=>randomUUID())
    for(const id of ids)budget.reserve({...input,purpose:'turn',logicalCallId:id+':1'})
    for(const id of ids.slice(0,22))budget.reserve({...input,purpose:'repair',logicalCallId:id+':2'})
    assert.throws(()=>budget.reserve({...input,purpose:'repair',logicalCallId:ids[22]+':2'}),/REPAIR_RESERVATION_EXHAUSTED/)
    assert.equal(budget.snapshot().calls.length,45)
  }finally{
    for(const path of [budget.path,budget.path+'.lock'])if(existsSync(path))unlinkSync(path)
    if(existsSync(dirname(budget.path)))rmdirSync(dirname(budget.path))
  }
})

test('SIMULATED remaining-plan allocation preserves original authorization and every closed receipt',()=>{
  const budget=new CoachProviderBudget({simulation:true,testDirectory:'simulation-'+randomUUID()})
  try{
    const original=readCoachAuthorization(),receipt=budget.reserve({runId:'synthetic',purpose:'diagnostic',tier:'default',provider:'synthetic',model:'synthetic',signature:'synthetic'})
    assert.throws(()=>budget.reallocateRemainingPlan(original.remaining),/TERMINAL_CALLS_REQUIRED/)
    assert.throws(()=>budget.reallocatePurposes({overhead:68,generation:66,repair:22},'concrete observed failure'),/TERMINAL_CALLS_REQUIRED/)
    budget.finish(receipt.callId,{outcome:'aborted',usage:'unknown',estimatedCostCny:'unknown',providerResponseId:null})
    const before=budget.snapshot()
    assert.throws(()=>budget.reallocateRemainingPlan(original.remaining+1),/EXCEEDS_ORIGINAL/)
    assert.throws(()=>budget.reallocateRemainingPlan(0),/EXCEEDS_ORIGINAL/)
    const adjustment=budget.reallocateRemainingPlan(original.remaining),after=budget.snapshot()
    assert.equal(adjustment.newAuthorization,false)
    assert.deepEqual(after.calls,before.calls)
    assert.deepEqual(after.authorization,before.authorization)
    assert.equal(after.remaining,original.remaining-1)
    assert.throws(()=>budget.reallocatePurposes({overhead:69,generation:66,repair:22},'excess'),/EXCEEDS_ORIGINAL/)
    assert.throws(()=>budget.reallocatePurposes({overhead:0,generation:66,repair:22},'below used'),/EXCEEDS_ORIGINAL/)
    const purposes=budget.reallocatePurposes({overhead:68,generation:66,repair:22},'four generation slots reassigned to changed-contract checks')
    assert.equal(purposes.newAuthorization,false)
    assert.deepEqual(budget.snapshot().calls,before.calls)
    assert.deepEqual(budget.snapshot().purposeLimits,{overhead:68,generation:66,repair:22})
    assert.throws(()=>budget.reallocateRemainingPlan(128),/EXCEEDS_ORIGINAL/)
  }finally{
    for(const path of [budget.path,budget.path+'.lock'])if(existsSync(path))unlinkSync(path)
    if(existsSync(dirname(budget.path)))rmdirSync(dirname(budget.path))
  }
})




test('SIMULATED additional 15 CNY preserves old receipts and reserves unknown charges across restart',()=>{
 const budget=new CoachProviderBudget({simulation:true,testDirectory:'simulation-'+randomUUID()})
 const input={runId:'synthetic',purpose:'turn' as const,tier:'default',provider:'synthetic',model:'synthetic',signature:'synthetic'}
 const notePath=dirname(budget.path)+'/additional-test-spend-20261004.json'
 try{
  const first=budget.reserve({...input,logicalCallId:randomUUID()+':1'})
  budget.finish(first.callId,{outcome:'completed',usage:{},estimatedCostCny:.02,providerResponseId:null})
  const before=budget.snapshot().calls
  writeFileSync(notePath,JSON.stringify({kind:'SIMULATED_ADDITIONAL_TEST_SPEND',amountCny:15,priorLedgerCalls:0}))
  assert.equal(budget.activateAdditionalAuthorization().remainingCny,14.98)
  assert.deepEqual(budget.snapshot().calls,before)
  assert.throws(()=>budget.reserve({...input,logicalCallId:randomUUID()+':1'}),/PRICE_REQUIRED/)
  const unknown=budget.reserve({...input,logicalCallId:randomUUID()+':1',reservedCostCny:14})
  const restarted=new CoachProviderBudget({simulation:true,testDirectory:dirname(budget.path).split(/[\\/]/).at(-1)!})
  assert.equal(restarted.snapshot().additional.remainingCny,.98)
  restarted.finish(unknown.callId,{outcome:'interrupted',usage:'unknown',estimatedCostCny:'unknown',providerResponseId:null})
  assert.equal(restarted.snapshot().additional.remainingCny,.98)
  assert.throws(()=>restarted.reserve({...input,logicalCallId:randomUUID()+':1',reservedCostCny:1}),/EXHAUSTED/)
  const known=restarted.reserve({...input,logicalCallId:randomUUID()+':1',reservedCostCny:.9})
  restarted.finish(known.callId,{outcome:'completed',usage:{},estimatedCostCny:.2,providerResponseId:null})
  assert.equal(restarted.snapshot().additional.remainingCny,.78)
  assert.equal(restarted.snapshot().remaining,Math.min(128,readCoachAuthorization().remaining)-1,'new monetary calls do not pretend to enlarge old authorization')
  const original=readFileSync(budget.path),tampered=JSON.parse(original.toString())
  tampered.additional.limitCny=100;writeFileSync(budget.path,JSON.stringify(tampered))
  assert.throws(()=>budget.snapshot(),/AUTHORIZATION_CHANGED/)
  writeFileSync(budget.path,original)
  const overrun=budget.reserve({...input,logicalCallId:randomUUID()+':1',reservedCostCny:.1})
  budget.finish(overrun.callId,{outcome:'completed',usage:{},estimatedCostCny:.2,providerResponseId:null})
  assert.equal(budget.snapshot().additional.paused,true)
  assert.throws(()=>budget.reserve({...input,logicalCallId:randomUUID()+':1',reservedCostCny:.01}),/EXHAUSTED/)
 }finally{
  for(const path of [budget.path,budget.path+'.lock',notePath])if(existsSync(path))unlinkSync(path)
  if(existsSync(dirname(budget.path)))rmdirSync(dirname(budget.path))
 }
})
