import type { ModelPricing } from './model.ts'

export const MONTHLY_COST_TARGET_CNY=0.5

export function estimateProviderCallCostCny(uncachedInputTokens:number,cachedInputTokens:number,outputTokens:number,pricing:ModelPricing|null|undefined):number|'unknown'{
  if(!pricing)return 'unknown'
  const values=[uncachedInputTokens,cachedInputTokens,outputTokens,pricing.inputCnyPerMillion,pricing.outputCnyPerMillion,pricing.cachedInputCnyPerMillion??pricing.inputCnyPerMillion]
  if(values.some(value=>!Number.isFinite(value)||value<0))return 'unknown'
  const total=uncachedInputTokens*pricing.inputCnyPerMillion+cachedInputTokens*(pricing.cachedInputCnyPerMillion??pricing.inputCnyPerMillion)+outputTokens*pricing.outputCnyPerMillion
  return Number(Math.max(0,total/1_000_000).toFixed(8))
}

export function classifyMonthlyCostCny(cost:number|'unknown'){
  if(typeof cost!=='number'||!Number.isFinite(cost)||cost<0)return 'NOT_EVALUABLE' as const
  if(cost<MONTHLY_COST_TARGET_CNY)return 'COST_ACCEPTED' as const
  if(cost<=0.8)return 'COST_OPTIMIZATION_REQUIRED' as const
  return 'COST_NOT_ACCEPTED' as const
}

export function buildSyntheticCostTarget(generatedAt=new Date().toISOString()){
  return {status:'TARGET_ONLY',generatedAt,workload:{turnsPerDay:10,days:30,monthlyTurns:300},monthlyCostTargetCny:MONTHLY_COST_TARGET_CNY,acceptance:'actual real-provider benchmark must be below the target; this record is not a workload or cost estimate'}
}

export function maximumProviderCallCostCny(contextWindow:number,outputLimit:number,pricing:ModelPricing|null):number|'unknown'{
 if(!pricing||![contextWindow,outputLimit].every(n=>Number.isSafeInteger(n)&&n>0)||![pricing.inputCnyPerMillion,pricing.outputCnyPerMillion,pricing.cachedInputCnyPerMillion??pricing.inputCnyPerMillion].every(n=>Number.isFinite(n)&&n>=0))return 'unknown'
 const cost=(contextWindow*Math.max(pricing.inputCnyPerMillion,pricing.cachedInputCnyPerMillion??pricing.inputCnyPerMillion)+outputLimit*pricing.outputCnyPerMillion)/1000000
 return Number.isFinite(cost)&&cost>0&&cost<=1000000?Math.ceil(cost*100000000)/100000000:'unknown'
}
