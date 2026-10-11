import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync,unlinkSync,renameSync,existsSync} from 'node:fs'
import {resolve,dirname,sep} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
const digest=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex')
// Preflight and reservation must use the same active grant. Historical funds
// remain auditable but never supplement or replace an activated current grant.
export const activeCoachFunding=(snapshot:any)=>snapshot.continuation??snapshot.currentGrant??snapshot.additional??null

export function readCoachAuthorization(root=process.cwd()){
  const directory=resolve(root,'evidence/v1.2.1-reliability/20261003-authorized300-11')
  const bytes=readFileSync(resolve(directory,'PROVIDER_AUTHORIZATION.json')),ledger=JSON.parse(bytes.toString())
  const ids=new Set<string>(),calls:any[]=[]
  for(const run of ledger.runs){
    const path=resolve(directory,run.report)
    if(!path.startsWith(directory+sep))throw new Error('HISTORICAL_REPORT_PATH_INVALID')
    const reportBytes=readFileSync(path)
    if(digest(reportBytes)!==run.reportSha256)throw new Error('HISTORICAL_REPORT_CHANGED')
    const entries=JSON.parse(reportBytes.toString()).scenarios.flatMap((scenario:any)=>scenario.turns.flatMap((turn:any)=>turn.usage?.calls??[]))
    if(entries.length!==run.observedCalls)throw new Error('HISTORICAL_CALL_COUNT_INVALID')
    for(const call of entries){if(!call.callId||ids.has(call.callId))throw new Error('HISTORICAL_CALL_ID_INVALID');ids.add(call.callId);calls.push(call)}
  }
  const remaining=ledger.batchMaximumCalls-calls.length-(ledger.unknownInterruptedCallMaximum??0)-(ledger.reservedMaximumActiveRun??0)
  if(ledger.activeRun||calls.length!==ledger.observedStarts||remaining!==ledger.unreservedRemaining||remaining<0)throw new Error('HISTORICAL_AUTHORIZATION_NOT_AVAILABLE')
  const unknown=calls.filter(call=>typeof call.estimatedCostCny!=='number').length
  const known=Number(calls.reduce((sum,call)=>sum+(typeof call.estimatedCostCny==='number'?call.estimatedCostCny:0),0).toFixed(7))
  if(unknown!==ledger.unknownUsageCalls||known!==ledger.knownEstimatedSubtotalCny)throw new Error('HISTORICAL_USAGE_SUBTOTAL_INVALID')
  return {sha256:digest(bytes),maximum:ledger.batchMaximumCalls,used:calls.length,remaining,unknownUsageCalls:ledger.unknownUsageCalls}
}
export type CoachCallReceipt={callId:string;runId:string;purpose:'capability'|'turn'|'repair'|'diagnostic';tier:string;provider:string;model:string;signature:string;sourceDigest?:string;logicalCallId?:string;startedAt:string;finishedAt?:string;status:'reserved'|'finished';outcome?:string;usage?:unknown;estimatedCostCny?:number|'unknown';providerResponseId?:string|null;funding?:'additional_cny'|'current_grant';reservedCostCny?:number}
export type ComparisonRestriction={startingCall:number;priorReceiptsSha256:string;grantSha256:string;limitCny:27.92;maximumCalls:8}
export function comparisonAllowance(ledger:any,restriction:ComparisonRestriction){
  if(restriction.limitCny!==27.92||restriction.maximumCalls!==8||!Number.isInteger(restriction.startingCall)||restriction.startingCall<0||restriction.startingCall>ledger.calls.length||restriction.grantSha256!==ledger.currentGrant?.authorizationSha256||digest(JSON.stringify(ledger.calls.slice(0,restriction.startingCall)))!==restriction.priorReceiptsSha256)throw new Error('COMPARISON_RESTRICTION_CHANGED')
  const end=ledger.comparisonRestriction?.completedCallCount
  const calls=ledger.calls.slice(restriction.startingCall,end) as CoachCallReceipt[]
  let accounted=0
  for(const call of calls){
    const cost=call.status==='finished'&&typeof call.estimatedCostCny==='number'?call.estimatedCostCny:call.reservedCostCny
    if(typeof cost!=='number'||!Number.isFinite(cost)||cost<0)throw new Error('COMPARISON_SPEND_UNBOUNDED')
    accounted+=cost
  }
  return {remainingCalls:Math.max(0,restriction.maximumCalls-calls.length),remainingCny:Math.max(0,Number((restriction.limitCny-accounted).toFixed(8))),accountedCny:Number(accounted.toFixed(8))}
}

// One synchronous exclusive lock covers read/reserve/atomic replace. A reserved
// entry counts permanently, even if its process dies before recording usage.
export class CoachProviderBudget {
  readonly path:string
  constructor(private options:{root?:string;simulation?:boolean;testDirectory?:string}={}){
    if(options.simulation&&options.testDirectory&&!/^simulation-[a-z0-9-]+$/.test(options.testDirectory))throw new Error('BUDGET_PATH_INVALID')
    const root=resolve(options.root??process.cwd()),base=resolve(root,'.local/v1.3-action-coach')
    this.path=resolve(base,options.simulation?options.testDirectory??'simulation':'paid','provider-calls.json')
    if(!this.path.startsWith(base+sep)||options.testDirectory&&!options.simulation)throw new Error('BUDGET_PATH_INVALID')
  }
  private refreshAdditional(ledger:any){
    if(!ledger.additional)return
    const notePath=resolve(dirname(this.path),'additional-test-spend-20261004.json'),bytes=readFileSync(notePath)
    const note=JSON.parse(bytes.toString())
    if(digest(bytes)!==ledger.additional.authorizationSha256||note.amountCny!==15||ledger.additional.limitCny!==note.amountCny||ledger.additional.startingCall!==note.priorLedgerCalls||!Number.isInteger(ledger.additional.startingCall)||ledger.additional.startingCall<0||ledger.additional.startingCall>ledger.calls.length)throw new Error('ADDITIONAL_AUTHORIZATION_CHANGED')
    if(digest(JSON.stringify(ledger.calls.slice(0,ledger.additional.activatedCallCount)))!==ledger.additional.priorReceiptsSha256)throw new Error('PREVIOUS_RECEIPTS_CHANGED')
    const calls=ledger.calls.slice(ledger.additional.startingCall).filter((call:CoachCallReceipt)=>call.funding!=='current_grant')
    let accounted=0
    for(const call of calls){
      const known=call.status==='finished'&&typeof call.estimatedCostCny==='number'&&Number.isFinite(call.estimatedCostCny)&&call.estimatedCostCny>=0
      if(known)accounted+=call.estimatedCostCny
      else if(typeof call.reservedCostCny==='number'&&Number.isFinite(call.reservedCostCny)&&call.reservedCostCny>0)accounted+=call.reservedCostCny
      else throw new Error('ADDITIONAL_SPEND_UNBOUNDED')
    }
    ledger.additional.accountedCny=Number(accounted.toFixed(8))
    ledger.additional.remainingCny=Math.max(0,Number((ledger.additional.limitCny-accounted).toFixed(8)))
  }
  private refreshCurrentGrant(ledger:any){
    const grant=ledger.currentGrant
    if(!grant)return
    const bytes=readFileSync(resolve(dirname(this.path),'development-test-grant-20261005.json')),note=JSON.parse(bytes.toString())
    if(digest(bytes)!==grant.authorizationSha256||note.amountCny!==30||grant.limitCny!==note.amountCny||grant.startingCall!==note.startingCall||!Number.isInteger(grant.startingCall)||grant.startingCall<0||grant.startingCall>ledger.calls.length||digest(JSON.stringify(ledger.calls.slice(0,grant.startingCall)))!==note.priorReceiptsSha256)throw new Error('CURRENT_GRANT_CHANGED')
    let accounted=0
    for(const call of ledger.calls.slice(grant.startingCall) as CoachCallReceipt[]){
      if(call.funding!=='current_grant')throw new Error('CURRENT_GRANT_FUNDING_INVALID')
      if(call.status==='finished'&&typeof call.estimatedCostCny==='number'&&Number.isFinite(call.estimatedCostCny)&&call.estimatedCostCny>=0)accounted+=call.estimatedCostCny
      else if(typeof call.reservedCostCny==='number'&&Number.isFinite(call.reservedCostCny)&&call.reservedCostCny>0)accounted+=call.reservedCostCny
      else throw new Error('CURRENT_GRANT_SPEND_UNBOUNDED')
    }
    grant.accountedCny=Number(accounted.toFixed(8))
    grant.remainingCny=Math.max(0,Number((grant.limitCny-accounted).toFixed(8)))
    if(accounted>grant.limitCny)grant.paused=true
  }
  private refreshContinuation(ledger:any){
    const funding=ledger.continuation
    if(!funding)return
    const bytes=readFileSync(resolve(dirname(this.path),'campus-acceptance-continuation-20261005.json')),note=JSON.parse(bytes.toString())
    if(digest(bytes)!==funding.authorizationSha256||note.amountCny!==27.62||funding.limitCny!==27.62||note.noCallLimit!==true||funding.startingCall!==note.startingCall||funding.grantSha256!==ledger.currentGrant?.authorizationSha256||note.grantSha256!==funding.grantSha256||!Number.isInteger(funding.startingCall)||funding.startingCall<0||funding.startingCall>ledger.calls.length||digest(JSON.stringify(ledger.calls.slice(0,funding.startingCall)))!==note.priorReceiptsSha256||note.previousComparisonSha256!==(ledger.comparisonRestriction?.authorizationSha256??null))throw new Error('CONTINUATION_AUTHORIZATION_CHANGED')
    let accounted=0
    for(const call of ledger.calls.slice(funding.startingCall) as CoachCallReceipt[]){
      const cost=call.status==='finished'&&typeof call.estimatedCostCny==='number'?call.estimatedCostCny:call.reservedCostCny
      if(typeof cost!=='number'||!Number.isFinite(cost)||cost<0)throw new Error('CONTINUATION_SPEND_UNBOUNDED')
      accounted+=cost
    }
    funding.accountedCny=Number(accounted.toFixed(8));funding.remainingCny=Math.max(0,Number((funding.limitCny-accounted).toFixed(8)))
    if(accounted>funding.limitCny)funding.paused=true
  }
  activateContinuation(){
    return this.change(ledger=>{
      if(ledger.continuation)return structuredClone(ledger.continuation)
      if(ledger.calls.some((call:CoachCallReceipt)=>call.status!=='finished'))throw new Error('TERMINAL_CALLS_REQUIRED_FOR_PLAN_CHANGE')
      const bytes=readFileSync(resolve(dirname(this.path),'campus-acceptance-continuation-20261005.json')),note=JSON.parse(bytes.toString())
      if(note.kind!==(this.options.simulation?'SIMULATED_ACCEPTANCE_CONTINUATION':'USER_AUTHORIZED_ACCEPTANCE_CONTINUATION')||note.amountCny!==27.62||note.noCallLimit!==true||note.startingCall!==ledger.calls.length||note.grantSha256!==ledger.currentGrant?.authorizationSha256||digest(JSON.stringify(ledger.calls))!==note.priorReceiptsSha256||note.previousComparisonSha256!==(ledger.comparisonRestriction?.authorizationSha256??null)||ledger.currentGrant.paused||ledger.currentGrant.remainingCny<27.62)throw new Error('CONTINUATION_AUTHORIZATION_INVALID')
      if(ledger.comparisonRestriction)Object.assign(ledger.comparisonRestriction,{completedCallCount:ledger.calls.length,completedAt:new Date().toISOString()})
      ledger.continuation={authorizationSha256:digest(bytes),grantSha256:note.grantSha256,limitCny:27.62,startingCall:note.startingCall,activatedAt:new Date().toISOString(),noCallLimit:true,paused:false}
      this.refreshContinuation(ledger)
      return structuredClone(ledger.continuation)
    })
  }
  activateCurrentGrant(){
    return this.change(ledger=>{
      if(ledger.currentGrant)return structuredClone(ledger.currentGrant)
      if(ledger.calls.some((call:CoachCallReceipt)=>call.status!=='finished'))throw new Error('TERMINAL_CALLS_REQUIRED_FOR_PLAN_CHANGE')
      const bytes=readFileSync(resolve(dirname(this.path),'development-test-grant-20261005.json')),note=JSON.parse(bytes.toString())
      if(note.kind!==(this.options.simulation?'SIMULATED_DEVELOPMENT_TEST_GRANT':'USER_AUTHORIZED_DEVELOPMENT_TEST_GRANT')||note.amountCny!==30||note.startingCall!==ledger.calls.length||note.priorReceiptsSha256!==digest(JSON.stringify(ledger.calls)))throw new Error('CURRENT_GRANT_AUTHORIZATION_INVALID')
      ledger.currentGrant={authorizationSha256:digest(bytes),limitCny:note.amountCny,startingCall:note.startingCall,activatedAt:new Date().toISOString(),paused:false}
      this.refreshCurrentGrant(ledger)
      this.refreshContinuation(ledger)
      return structuredClone(ledger.currentGrant)
    })
  }
  activateAdditionalAuthorization(){
    return this.change(ledger=>{
      if(ledger.calls.some((c:CoachCallReceipt)=>c.status!=='finished'))throw new Error('TERMINAL_CALLS_REQUIRED_FOR_PLAN_CHANGE')
      if(ledger.additional)return structuredClone(ledger.additional)
      const bytes=readFileSync(resolve(dirname(this.path),'additional-test-spend-20261004.json')),note=JSON.parse(bytes.toString())
      if(note.kind!==(this.options.simulation?'SIMULATED_ADDITIONAL_TEST_SPEND':'USER_AUTHORIZED_ADDITIONAL_TEST_SPEND')||note.amountCny!==15||!Number.isInteger(note.priorLedgerCalls)||note.priorLedgerCalls<0||note.priorLedgerCalls>ledger.calls.length)throw new Error('ADDITIONAL_AUTHORIZATION_INVALID')
      ledger.additional={authorizationSha256:digest(bytes),limitCny:note.amountCny,startingCall:note.priorLedgerCalls,activatedAt:new Date().toISOString(),activatedCallCount:ledger.calls.length,priorReceiptsSha256:digest(JSON.stringify(ledger.calls)),paused:false}
      this.refreshAdditional(ledger)
      if(ledger.additional.accountedCny>note.amountCny)throw new Error('ADDITIONAL_BUDGET_EXHAUSTED')
      return structuredClone(ledger.additional)
    })
  }
  private change<T>(fn:(ledger:any)=>T,persist=true):T{
    // A loopback simulation has no paid authorization or historical usage.
    // Keep it on its separate, explicitly marked ledger so a clean checkout
    // never needs private paid evidence to exercise the budget mechanism.
    const authorization=this.options.simulation
      ? {sha256:digest('LIFEOS_SYNTHETIC_BUDGET_AUTHORIZATION_V1'),maximum:156,used:0,remaining:156,unknownUsageCalls:0}
      : readCoachAuthorization(this.options.root)
    mkdirSync(dirname(this.path),{recursive:true})
    const lockPath=this.path+'.lock'
    if(existsSync(lockPath)){
      const owner=JSON.parse(readFileSync(lockPath,'utf8'))
      let live=true
      try{process.kill(owner.pid,0)}catch(error:any){if(error.code==='ESRCH')live=false;else throw new Error('BUDGET_LOCK_OWNER_UNVERIFIED')}
      if(live)throw new Error('BUDGET_LOCKED')
      unlinkSync(lockPath)
    }
    const handle=openSync(lockPath,'wx',0o600)
    let temp:string|undefined
    try{
      writeFileSync(handle,JSON.stringify({pid:process.pid,at:new Date().toISOString()}))
      const ledger=existsSync(this.path)?JSON.parse(readFileSync(this.path,'utf8')):{evidence:this.options.simulation?'SIMULATED_BUDGET_GUARD':'REAL_PROVIDER_CALL_RESERVATIONS',authorization,maxNewCalls:128,calls:[]}
      if(ledger.authorization.sha256!==authorization.sha256||ledger.evidence!==(this.options.simulation?'SIMULATED_BUDGET_GUARD':'REAL_PROVIDER_CALL_RESERVATIONS')||!Number.isInteger(ledger.maxNewCalls)||ledger.maxNewCalls<1||ledger.maxNewCalls>authorization.remaining||!Array.isArray(ledger.calls)||new Set(ledger.calls.map((call:any)=>call.callId)).size!==ledger.calls.length)throw new Error('BUDGET_LEDGER_INVALIDATED')
      if(ledger.purposeLimits&&(Object.keys(ledger.purposeLimits).length!==3||['overhead','generation','repair'].some(key=>!Number.isInteger(ledger.purposeLimits[key])||ledger.purposeLimits[key]<0)||Object.values(ledger.purposeLimits).reduce((sum:number,value:any)=>sum+value,0)>ledger.maxNewCalls))throw new Error('PURPOSE_PLAN_INVALIDATED')
      ledger.remaining=Math.min(authorization.remaining,ledger.maxNewCalls)-ledger.calls.filter((call:CoachCallReceipt)=>!call.funding).length
      this.refreshAdditional(ledger)
      this.refreshCurrentGrant(ledger)
      this.refreshContinuation(ledger)
      if(ledger.comparisonRestriction){
        const bytes=readFileSync(resolve(this.options.root??process.cwd(),'.local/campus-growth/comparison-restriction-20261005.json'))
        if(digest(bytes)!==ledger.comparisonRestriction.authorizationSha256)throw new Error('COMPARISON_RESTRICTION_CHANGED')
        comparisonAllowance(ledger,ledger.comparisonRestriction)
      }
      const result=fn(ledger)
      ledger.remaining=Math.min(authorization.remaining,ledger.maxNewCalls)-ledger.calls.filter((call:CoachCallReceipt)=>!call.funding).length
      this.refreshAdditional(ledger)
      this.refreshCurrentGrant(ledger)
      this.refreshContinuation(ledger)
      if(!persist)return result
      temp=this.path+'.'+randomUUID()+'.tmp'
      writeFileSync(temp,JSON.stringify(ledger,null,2)+'\n',{mode:0o600});renameSync(temp,this.path);temp=undefined
      return result
    }finally{closeSync(handle);unlinkSync(lockPath);if(temp&&existsSync(temp))unlinkSync(temp)}
  }
  // Explicitly allocate an unused part of the ORIGINAL authorization. This
  // never raises that authorization or resets receipts, including unknowns.
  reallocateRemainingPlan(maxNewCalls:number){
    return this.change(ledger=>{
      if(!Number.isInteger(maxNewCalls)||maxNewCalls<ledger.calls.length||maxNewCalls>ledger.authorization.remaining||(ledger.purposeLimits&&Object.values(ledger.purposeLimits).reduce((sum:number,value:any)=>sum+value,0)>maxNewCalls))throw new Error('PLAN_EXCEEDS_ORIGINAL_AUTHORIZATION')
      if(ledger.calls.some((call:CoachCallReceipt)=>call.status!=='finished'))throw new Error('TERMINAL_CALLS_REQUIRED_FOR_PLAN_CHANGE')
      const adjustment={at:new Date().toISOString(),previousMaximum:ledger.maxNewCalls,maximum:maxNewCalls,used:ledger.calls.length,authorizationSha256:ledger.authorization.sha256,newAuthorization:false}
      ledger.planAdjustments??=[];ledger.planAdjustments.push(adjustment);ledger.maxNewCalls=maxNewCalls
      return adjustment
    })
  }
  reallocatePurposes(limits:{overhead:number;generation:number;repair:number},reason:string){
    return this.change(ledger=>{
      if(ledger.calls.some((call:CoachCallReceipt)=>call.status!=='finished'))throw new Error('TERMINAL_CALLS_REQUIRED_FOR_PLAN_CHANGE')
      const used={overhead:ledger.calls.filter((c:CoachCallReceipt)=>['capability','diagnostic'].includes(c.purpose)).length,generation:ledger.calls.filter((c:CoachCallReceipt)=>c.purpose==='turn').length,repair:ledger.calls.filter((c:CoachCallReceipt)=>c.purpose==='repair').length}
      if(!reason.trim()||Object.keys(limits).length!==3||Object.entries(used).some(([key,count])=>!Number.isInteger(limits[key as keyof typeof limits])||limits[key as keyof typeof limits]<count)||limits.overhead+limits.generation+limits.repair>Math.min(ledger.maxNewCalls,ledger.authorization.remaining))throw new Error('PURPOSE_PLAN_EXCEEDS_ORIGINAL_AUTHORIZATION')
      const adjustment={at:new Date().toISOString(),previous:ledger.purposeLimits??{overhead:64,generation:70,repair:22},limits,used,reason,authorizationSha256:ledger.authorization.sha256,newAuthorization:false}
      ledger.purposePlanAdjustments??=[];ledger.purposePlanAdjustments.push(adjustment);ledger.purposeLimits=limits
      return adjustment
    })
  }
  activateComparisonRestriction(){
    return this.change(ledger=>{
      if(ledger.comparisonRestriction)return structuredClone(ledger.comparisonRestriction)
      if(ledger.calls.some((call:CoachCallReceipt)=>call.status!=='finished'))throw new Error('TERMINAL_CALLS_REQUIRED_FOR_PLAN_CHANGE')
      const bytes=readFileSync(resolve(this.options.root??process.cwd(),'.local/campus-growth/comparison-restriction-20261005.json'))
      const restriction=JSON.parse(bytes.toString()) as ComparisonRestriction
      comparisonAllowance(ledger,restriction)
      if(restriction.startingCall!==ledger.calls.length)throw new Error('COMPARISON_BASELINE_CHANGED')
      ledger.comparisonRestriction={...restriction,authorizationSha256:digest(bytes)}
      return structuredClone(ledger.comparisonRestriction)
    })
  }
  reserve(input:Omit<CoachCallReceipt,'callId'|'startedAt'|'status'>,restriction?:ComparisonRestriction){
    return this.change(ledger=>this.reserveWithin(ledger,input,restriction))
  }
  // One lock and one atomic replacement for the whole graph. If any node
  // fails authorization, the callback throws and none of the new rows persist.
  reserveGraph(inputs:Omit<CoachCallReceipt,'callId'|'startedAt'|'status'>[]){
    if(inputs.length<1||inputs.length>5||new Set(inputs.map(x=>x.logicalCallId)).size!==inputs.length||inputs.some(x=>!x.logicalCallId||x.runId!==inputs[0].runId||x.sourceDigest!==inputs[0].sourceDigest||x.signature!==inputs[0].signature))throw new Error('WORKFLOW_GRAPH_INVALID')
    return this.change(ledger=>inputs.map(input=>{
      const receipt=this.reserveWithin(ledger,input)
      this.refreshAdditional(ledger);this.refreshCurrentGrant(ledger);this.refreshContinuation(ledger)
      return receipt
    }))
  }
  private reserveWithin(ledger:any,input:Omit<CoachCallReceipt,'callId'|'startedAt'|'status'>,restriction?:ComparisonRestriction){
      restriction=ledger.continuation?undefined:ledger.comparisonRestriction??restriction
      if(restriction){
        const allowance=comparisonAllowance(ledger,restriction)
        if(input.purpose!=='diagnostic'||input.tier!=='default'||!['qwen3.8-flash','qwen3.8-max','qwen3.7-plus'].includes(input.model)||allowance.remainingCalls<1||typeof input.reservedCostCny!=='number'||input.reservedCostCny>allowance.remainingCny)throw new Error('COMPARISON_BUDGET_OR_SCOPE_EXHAUSTED')
      }
      const limits=ledger.purposeLimits??{overhead:64,generation:70,repair:22}
      const additional=ledger.currentGrant??ledger.additional
      if(ledger.continuation&&(ledger.continuation.paused||typeof input.reservedCostCny!=='number'||!Number.isFinite(input.reservedCostCny)||input.reservedCostCny<=0||input.reservedCostCny>ledger.continuation.remainingCny))throw new Error('CONTINUATION_BUDGET_EXHAUSTED_OR_PRICE_REQUIRED')
      if(additional){
        if(additional.paused||typeof input.reservedCostCny!=='number'||!Number.isFinite(input.reservedCostCny)||input.reservedCostCny<=0||input.reservedCostCny>additional.remainingCny)throw new Error('ADDITIONAL_BUDGET_EXHAUSTED_OR_PRICE_REQUIRED')
      }
      if(!additional&&ledger.calls.length>=Math.min(ledger.authorization.remaining,ledger.maxNewCalls))throw new Error('AUTHORIZED_PROVIDER_CALL_BUDGET_EXHAUSTED')
      if(input.logicalCallId&&ledger.calls.some((call:CoachCallReceipt)=>call.logicalCallId===input.logicalCallId))throw new Error('DUPLICATE_PROVIDER_LOGICAL_CALL')
      if(!additional&&['capability','diagnostic'].includes(input.purpose)&&ledger.calls.filter((call:CoachCallReceipt)=>['capability','diagnostic'].includes(call.purpose)).length>=limits.overhead)throw new Error('CAPABILITY_DIAGNOSTIC_RESERVATION_EXHAUSTED')
      const requestId=input.logicalCallId?.replace(/:[12]$/,'')
      if(input.purpose==='repair'){
        if(!requestId||!ledger.calls.some((call:CoachCallReceipt)=>call.purpose==='turn'&&call.logicalCallId===requestId+':1'))throw new Error('REPAIR_GENERATION_REQUIRED')
        if(!additional&&ledger.calls.filter((call:CoachCallReceipt)=>call.purpose==='repair').length>=limits.repair)throw new Error('REPAIR_RESERVATION_EXHAUSTED')
      }
      const userRequests=new Set(ledger.calls.filter((call:CoachCallReceipt)=>['turn','repair'].includes(call.purpose)&&call.logicalCallId).map((call:CoachCallReceipt)=>call.logicalCallId!.replace(/:[12]$/,'')))
      if(!additional&&requestId&&['turn','repair'].includes(input.purpose)&&!userRequests.has(requestId)&&userRequests.size>=limits.generation)throw new Error('USER_TURN_RESERVATION_EXHAUSTED')
      const receipt:CoachCallReceipt={...input,funding:ledger.currentGrant?'current_grant':additional?'additional_cny':undefined,callId:randomUUID(),startedAt:new Date().toISOString(),status:'reserved'}
      ledger.calls.push(receipt);return receipt
  }
  finish(callId:string,details:{outcome:string;usage:unknown;estimatedCostCny:number|'unknown';providerResponseId:string|null}){
    return this.change(ledger=>{
      const receipt=ledger.calls.find((call:CoachCallReceipt)=>call.callId===callId)
      if(!receipt||receipt.status!=='reserved')throw new Error('BUDGET_RECEIPT_ALREADY_FINISHED_OR_MISSING')
      Object.assign(receipt,details,{status:'finished',finishedAt:new Date().toISOString()})
      if(receipt.funding==='additional_cny'&&typeof details.estimatedCostCny==='number'&&details.estimatedCostCny>receipt.reservedCostCny!)ledger.additional.paused=true
      if(receipt.funding==='current_grant'&&typeof details.estimatedCostCny==='number'&&details.estimatedCostCny>receipt.reservedCostCny!)ledger.currentGrant.paused=true
      return receipt as CoachCallReceipt
    })
  }
  snapshot(){return this.change(ledger=>structuredClone(ledger),false)}
}


