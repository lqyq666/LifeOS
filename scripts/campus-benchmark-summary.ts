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

// ---- P6.1: per-logical-step review rows. Presence is the runner's own
// transport/accounting view; semantic truth stays with an independent review.
// No row is marked PASS by the implementer's self-assessment.
export type SemanticVerdict='PASS'|'FAIL'|'PENDING_REVIEW'|'NOT_TESTED'
export type ReviewRow={
  logicalStepId:string;attemptId:string;actorKey:string
  transportStatus:string;committed:boolean
  stateEffectsPassed:boolean|null
  semanticVerdict:SemanticVerdict
  hardFailures:string[]
  reviewer:{kind:'human'|'independent_review';evidencePath:string}|null
}
export function campusReviewRows(turns:readonly any[]):ReviewRow[]{
  return turns.map(turn=>{
    const receipt=turn?.done?.stateChange??turn?.stateChange??null
    const growthStatus=receipt?.growth?.status
    const stateEffectsPassed=turn?.status!=='SAVED'?null:growthStatus===undefined?null:growthStatus==='applied'||growthStatus==='not_requested'?true:growthStatus==='partial'?null:false
    return {
      logicalStepId:String(turn?.logicalStepId??(turn?.trajectory??'unknown')+':'+(turn?.turn??'unknown')),
      attemptId:String(turn?.attemptId??'unknown'),
      actorKey:String(turn?.actorKey??turn?.trajectory??'unknown'),
      transportStatus:String(turn?.status??'UNKNOWN'),
      committed:turn?.status==='SAVED',
      stateEffectsPassed,
      // A committed row without independent review is PENDING_REVIEW, never PASS.
      semanticVerdict:turn?.status==='SAVED'?'PENDING_REVIEW':'NOT_TESTED',
      hardFailures:turn?.status==='FAILED'&&turn?.error?[String(turn.error)]:[],
      reviewer:null,
    }
  })
}

// ---- P6.2: two denominators, named for what they actually measure.
// 每百提交轮 uses committed logical steps; 每百语义合格轮 needs independently
// reviewed PASS steps and becomes NOT_EVALUABLE without them — a SAVED count
// can never stand in for a semantic PASS count.
export function campusDualCostSummary(turns:readonly any[],calls:readonly Receipt[],reviewRows:readonly ReviewRow[]=[]){
  const committed=reviewRows.length?reviewRows.filter(row=>row.committed).length:turns.filter(turn=>turn.status==='SAVED').length
  const semanticPass=reviewRows.filter(row=>row.semanticVerdict==='PASS').length
  const known=calls.filter(call=>call.status==='finished'&&typeof call.estimatedCostCny==='number'&&Number.isFinite(call.estimatedCostCny)&&call.estimatedCostCny>=0)
  const knownSubtotalCny=Number(known.reduce((sum,call)=>sum+(call.estimatedCostCny as number),0).toFixed(8))
  const unknownOrPendingCalls=calls.length-known.length
  const per100Committed=committed>0&&calls.length>0&&!unknownOrPendingCalls?Number((knownSubtotalCny/committed*100).toFixed(8)):'unknown'
  const per100Semantic=semanticPass>0&&!unknownOrPendingCalls?Number((knownSubtotalCny/semanticPass*100).toFixed(8)):'NOT_EVALUABLE'
  return {
    evidence:'ACTUAL_RECEIPTS_TWO_DENOMINATORS',
    denominators:{per100CommittedLogicalSteps:'每100提交轮（工程比较口径）',per100SemanticPassLogicalSteps:'每100语义合格轮（需独立审阅PASS）'},
    committedLogicalSteps:committed,
    semanticPassLogicalSteps:semanticPass,
    pendingReviewLogicalSteps:reviewRows.filter(row=>row.semanticVerdict==='PENDING_REVIEW').length,
    providerCalls:calls.length,
    knownSubtotalCny,
    unknownOrPendingCalls,
    costCnyPer100Committed:per100Committed,
    costCnyPer100SemanticPass:per100Semantic,
    semanticPassEvaluation:semanticPass>0?'SUBSET_REVIEWED_ONLY':'NOT_EVALUABLE_NO_INDEPENDENT_PASS',
  }
}
