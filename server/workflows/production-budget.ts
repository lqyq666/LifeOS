import {randomUUID} from 'node:crypto'
import {config} from '../config.ts'
import {reserveProviderSpend,settleProviderSpend} from '../provider-spend.ts'
import type {CoachProviderBudget,CoachCallReceipt} from '../../scripts/coach-provider-budget.ts'

export type WorkflowProviderBudget={
 readonly path:string
 reserveGraph(inputs:Parameters<CoachProviderBudget['reserveGraph']>[0],actor?:string):CoachCallReceipt[]|Promise<CoachCallReceipt[]>
 finish(callId:string,details:Parameters<CoachProviderBudget['finish']>[1]):CoachCallReceipt|Promise<CoachCallReceipt>
 snapshot():{calls:CoachCallReceipt[]}
}

// Production uses its existing PostgreSQL spend cap, never the private developer
// authorization files. Receipts below only mirror successful DB writes for this
// process; the PG reservations remain authoritative after failure or restart.
export function createProductionWorkflowBudget():WorkflowProviderBudget{
 const calls=new Map<string,{receipt:CoachCallReceipt;spendId:string}>()
 return {
  path:'postgresql:lifeos_provider_spend',
  async reserveGraph(inputs,actor){
   if(!config.providerBudgetEnabled||!actor||!inputs.length||inputs.length>5||new Set(inputs.map(x=>x.runId)).size!==1||new Set(inputs.map(x=>x.logicalCallId)).size!==inputs.length||inputs.some(x=>!x.logicalCallId||x.sourceDigest!==inputs[0].sourceDigest||x.signature!==inputs[0].signature))throw new Error('WORKFLOW_PRODUCTION_BUDGET_REQUIRED')
   const reserved:{receipt:CoachCallReceipt;spendId:string}[]=[]
   try{
    for(const [index,input] of inputs.entries()){
     const spendId=await reserveProviderSpend({user:actor,requestId:input.runId,callIndex:index+1,provider:input.provider,model:input.model,ceilingCny:input.reservedCostCny??0,workflow:true})
     if(!spendId)throw new Error('WORKFLOW_PRODUCTION_BUDGET_REQUIRED')
     const receipt:CoachCallReceipt={...input,callId:randomUUID(),startedAt:new Date().toISOString(),status:'reserved'}
     reserved.push({receipt,spendId})
    }
   }catch(error){
    // No SDK node starts until prepareGraph returns. These partial reservations
    // are provably not dispatched; existing unknown/started calls are untouched.
    for(const row of reserved)await settleProviderSpend(row.spendId,0,true)
    throw error
   }
   for(const row of reserved)calls.set(row.receipt.callId,row)
   return reserved.map(row=>structuredClone(row.receipt))
  },
  async finish(callId,details){
   const row=calls.get(callId)
   if(!row)throw new Error('PROVIDER_SPEND_MISSING')
   if(row.receipt.status==='finished')throw new Error('PROVIDER_SPEND_ALREADY_SETTLED')
   const settled=await settleProviderSpend(row.spendId,details.estimatedCostCny,details.outcome==='not_sent')
   Object.assign(row.receipt,details,{status:'finished',finishedAt:new Date().toISOString()})
   if(settled?.overrun)throw new Error('PROVIDER_PRICE_CHANGED')
   return structuredClone(row.receipt)
  },
  snapshot(){return {calls:[...calls.values()].map(row=>structuredClone(row.receipt))}},
 }
}
