type Turn={status:string}
type Receipt={status:string;estimatedCostCny?:number|'unknown';purpose:string}

// Presence is a prerequisite for the preregistered campus comparison, never
// evidence that its content, grounding, transaction or speed has passed.
export function campusComparisonArtifacts(output:{reply?:string;growthUpdates?:unknown[]}|null){
  const replyPresent=typeof output?.reply==='string'&&Boolean(output.reply.trim())
  const growthUpdateCount=Array.isArray(output?.growthUpdates)?output.growthUpdates.length:0
  return {replyPresent,growthUpdateCount,growthStageEligible:replyPresent&&growthUpdateCount>0,semanticQuality:'PENDING_MANUAL_REVIEW' as const,fullBusinessAcceptance:'NOT_TESTED' as const}
}

// Failed generations and repairs remain costs of the successful workload.
// Unknown receipts cannot be silently treated as free or excluded as outliers.
export function campusCostSummary(turns:Turn[],calls:Receipt[]){
  const successes=turns.filter(turn=>turn.status==='SAVED').length
  const known=calls.filter(call=>call.status==='finished'&&typeof call.estimatedCostCny==='number'&&Number.isFinite(call.estimatedCostCny)&&call.estimatedCostCny>=0)
  const knownSubtotalCny=Number(known.reduce((sum,call)=>sum+(call.estimatedCostCny as number),0).toFixed(8))
  const unknownOrPendingCalls=calls.length-known.length
  const per100=successes>0&&calls.length>0&&!unknownOrPendingCalls?Number((knownSubtotalCny/successes*100).toFixed(8)):'unknown'
  return {evidence:'ACTUAL_RECEIPTS_PER_100_SAVED_BUSINESS_INTERACTIONS',attemptedInteractions:turns.length,successfulInteractions:successes,failedInteractions:turns.length-successes,providerCalls:calls.length,repairCalls:calls.filter(call=>call.purpose==='repair').length,knownSubtotalCny,unknownOrPendingCalls,costCnyPer100Successful:per100,targetCnyPer100Successful:1,targetEvaluation:typeof per100==='number'?per100<=1?'MET':'NOT_MET':'NOT_EVALUABLE',qualityAcceptance:'PENDING_SEPARATE_SEMANTIC_REVIEW'}
}
