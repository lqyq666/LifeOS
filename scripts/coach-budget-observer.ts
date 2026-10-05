import {resolveModel} from '../server/model.ts'
import type {ProviderCallObserver} from '../server/turn-engine.ts'
import {estimateProviderCallCostCny,maximumProviderCallCostCny} from '../server/cost-workload.ts'
import {CoachProviderBudget} from './coach-provider-budget.ts'
import {assertCoachSourceFreeze} from './coach-source-freeze.ts'

export function coachBudgetObserver(input:{runId:string;freezePath:string;sourceRoot?:string;budget?:CoachProviderBudget;purpose?:'diagnostic'}):ProviderCallObserver{
  const budget=input.budget??new CoachProviderBudget(),receipts=new Map<string,string>()
  return {
    allowRepair:false,
    before(call){
      // Paid development runs stop for evidence and a fix instead of silently
      // issuing an automatic second semantic repair request.
      if(call.purpose==='repair')throw new Error('AUTOMATIC_PAID_REPAIR_DISABLED')
      const sourceDigest=assertCoachSourceFreeze(input.freezePath,input.sourceRoot)
      if(receipts.has(call.callId))throw new Error('DUPLICATE_PROVIDER_CALL_RESERVATION')
      const maximum=maximumProviderCallCostCny(resolveModel(call.tier).model.contextWindow,call.outputTokenLimit,call.pricing)
      const receipt=budget.reserve({...(typeof maximum==='number'?{reservedCostCny:maximum}:{}),runId:input.runId,purpose:input.purpose??call.purpose,tier:call.tier,provider:call.provider,model:call.model,signature:call.configSignature,sourceDigest,logicalCallId:call.callId})
      receipts.set(call.callId,receipt.callId)
    },
    after(call){
      const id=receipts.get(call.callId)
      if(!id)throw new Error('PROVIDER_CALL_RESERVATION_MISSING')
      const complete=call.usageCompleteness==='complete',usage=complete?{uncachedInputTokens:call.uncachedInputTokens,cacheWriteInputTokens:call.cacheWriteInputTokens,cachedInputTokens:call.cachedInputTokens,outputTokens:call.outputTokens}:'unknown'
      const estimated=complete&&call.pricing?estimateProviderCallCostCny(call.uncachedInputTokens!+call.cacheWriteInputTokens!,call.cachedInputTokens!,call.outputTokens!,call.pricing):'unknown'
      budget.finish(id,{outcome:call.outcome,usage,estimatedCostCny:typeof estimated==='number'?estimated:'unknown',providerResponseId:call.providerResponseId})
      // A changed source invalidates the cohort, but never discards billed usage.
      assertCoachSourceFreeze(input.freezePath,input.sourceRoot)
    },
  }
}
