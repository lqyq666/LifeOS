import {randomUUID} from 'node:crypto'
import {mainCompanionPolicy} from './companion-policy.ts'
import {providerReservationCny,reserveProviderSpend,settleProviderSpend} from './provider-spend.ts'
import {config} from './config.ts'
import { searchCoachEvents } from './coach-retrieval.ts'
import { retrieveCoachKnowledge, validateCoachCitations, readApprovedGuide } from './coach-knowledge.ts'
import { openingQuestionDraft, safeEarlySentence } from './reply-draft.ts'
import { renderCoachReply } from './coach-reply.ts'
import { stream, type AssistantMessage } from '@mariozechner/pi-ai'
import { HttpError, pool } from './db.ts'
import { providerError } from './provider-errors.ts'
import { parseActionCoachTurn, actionCoachTurnSchema, type ActionCoachTurn } from './action-coach-contracts.ts'
import { coachEventView, stageCoachEvent, deliverableIntent, requiresImmediateMaterial, coachMaterialPresentation,requestedBlankJobWorksheet, type CoachEvent } from './action-coach-events.ts'
import { estimateTokens } from './context.ts'
import { loadSnapshot, stageCoachBackground } from './memory.ts'
import { readKnownMajor } from './model-router.ts'
import { modelCapabilityVerified, modelSignatureFor, resolveModel, type ModelPricing, type ModelRuntime, type ModelTier } from './model.ts'
import { checkModelCooldown } from './operations.ts'
import { stageCandidate, type Run, type Staged } from './store.ts'
import { buildTurnPrompt, providerTurnMessages, turnSystemPrompt } from './turn-prompt.ts'
import { configureProviderPayload, outputTokenLimit, type OutputPath } from './model-payload.ts'
import { estimateProviderCallCostCny } from './cost-workload.ts'
import { growthContext, growthBoundaryContext, growthSnapshotKey, stageGrowthUpdates } from './growth.ts'
import { selectRelevantGrowth, splitGrowthByCurrentTopic } from './growth-selection.ts'
import { readDirectionControls, deriveExplicitDirectionControls, stageDirectionControls, overlayDirectionChanges, directionControlsSnapshotKey, allScopes } from './growth-controls.ts'
import { redactGrowthHistory } from './growth-privacy.ts'
import { cozeConfigFrom, cozeMissingConfig, searchCozePublicKnowledge, mapCozeCandidates, CozeRetrievalError } from './coze-knowledge.ts'
import { codeWorkflowConfigFrom, codeWorkflowMissingConfig, searchCodeWorkflowKnowledge, CodeWorkflowError, type CodeWorkflowConfig } from './coze-code-workflow.ts'
import { buildPublicKnowledgeQueryFromText, renderPublicKnowledgeQuery } from './coze-public-query.ts'
import { reportsOwnContribution, buildMaterialFactCatalogue, resolveSelectedMaterialFacts } from './grounded-material.ts'
import { stageWeeklyPlan, renderProposedWeeklyPlan } from './weekly-plans.ts'
import { ignorableConnectives } from './turn-obligations.ts'
import { applicableTimeBudget, deriveTurnObligations, isPureZeroPlanRequest, verifyTurnObligations, verifyReplyAgainstObligations, supplementMissingBudgetDeltas, planExplicitCorrection, hoursIn, isPureControlCommand, controlReplyText, isObligationError, requestsTimeArrangement, type TurnObligations } from './turn-obligations.ts'
import { scanUserClauses,assistantRequestClause,conversationPreferenceClause,currentConversationOnly,deferredPursuitClause,refusalPreferenceClause } from './user-command-spans.ts'
import { buildClauseCatalogue, resolveContiguousClauseRange, type ClauseHandle } from './clause-catalogue.ts'
import { clauseExpressesWishToAct, clauseReportsCompleted, deriveStructuralLinks, resolveCandidateContent, requiresExperienceCandidate, selectStructuralCandidate, sentenceIsFirstPersonPublic } from './experience-content.ts'
import { readStarMapContext } from './user-themes.ts'
import { deriveTurnContract, bindPlanBudgetSchema, bindMaterialDeliverySchema, negativePersonalFactClauses, resourceBlockedPersonalFactClauses, reportedTaskOutcomeClauses,reportedPerformedTaskClauses,reportedTaskBoundaryClauses,requestedQuestionEditClauses,reportedAdoptionClauses } from './turn-contract.ts'
import { actionReviewHints, continuedActionUsage, canContinueGuideFeedback, authorizedGuideApplication } from './workflows/host.ts'
import { selectHistoryForMode } from './history-selection.ts'
import { goalChangeMarker } from './growth-authority.ts'
import { resolveGrowthDeltas } from './growth-authority.ts'
import { findEpisode } from './experience-episodes.ts'
import { detectForgetIntentClauses, scoreForgetTargets } from './forget-intent.ts'
import { readRecommendationControls,listControlRequests } from './memory-controls.ts'
import {knowledgeIntent,deduplicateGuides,methodPromptContext} from './evergreen-guide.ts'
import {readGuideUsage,classifyGuideFeedback,feedbackMatchesCurrent} from './guide-usage.ts'
import {boundedRecallReply,bindBoundedReplySchema,boundedReplyAccepts,boundedDraftAccepts,boundedSentenceAccepts,type BoundedReply} from './bounded-reply.ts'
export type FocusContext={type:'theme'|'experience';id:string;label:string}
export type EngineInput={run:Run;staged:Staged;context:any[];decision:unknown;signal:AbortSignal;emit:(event:Record<string,unknown>)=>void;focusContext?:FocusContext|null}
export type Engine=((input:EngineInput)=>Promise<{text:string;usage:unknown}>)&{modelManaged?:boolean;modelReadiness?:()=>boolean}
type CallRecord={callId:string;requestId:string;purpose:'turn'|'repair';tier:ModelTier;provider:string;model:string;configSignature:string;providerResponseId:string|null;providerResponseModel:string|null;pricing:ModelPricing|null;outputTokenLimit:number;uncachedInputTokens:number|null;cacheWriteInputTokens:number|null;outputTokens:number|null;cachedInputTokens:number|null;usageCompleteness:'complete'|'partial'|'unavailable';startedAt:string;finishedAt:string|null;latencyMs:number|null;firstRawDeltaMs:number|null;firstQuestionDraftMs:number|null;firstSafeSentenceMs?:number|null;startedMonotonicMs:number;contextTokenEstimate:number;outcome:'pending'|'completed'|'failed';errorCode:string|null}
export type ProviderCallObserver={allowRepair?:boolean;before:(call:Readonly<CallRecord>)=>void|Promise<void>;after:(call:Readonly<CallRecord>)=>void|Promise<void>;output?:(call:Readonly<CallRecord>,text:string)=>void|Promise<void>;payload?:(call:Readonly<CallRecord>,payload:unknown)=>void}
const assistantText=(message:AssistantMessage)=>message.content.filter((part):part is Extract<AssistantMessage['content'][number],{type:'text'}>=>part.type==='text').map(part=>part.text).join('').trim()
const tokenValue=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null
const callCost=(uncached:number,cached:number,output:number,pricing:ModelPricing|null):number|'unknown'=>{if(!pricing)return 'unknown';const cost=estimateProviderCallCostCny(uncached,cached,output,pricing);return typeof cost==='number'?Number(cost.toFixed(8)):'unknown'}

function usageSummary(calls:CallRecord[],contextTokenEstimate:number,retrievedMemoryCount:number,escalated:boolean,escalationReason:string|null,zeroLlm=false,repairReason:string|null=null){
  const sum=(key:'uncachedInputTokens'|'cacheWriteInputTokens'|'outputTokens'|'cachedInputTokens')=>calls.length&&calls.every(call=>call[key]!==null)?calls.reduce((total,call)=>total+call[key]!,0):calls.length?'unknown':0
  const input=sum('uncachedInputTokens'),cacheWrite=sum('cacheWriteInputTokens'),cachedInput=sum('cachedInputTokens')
  const totalInputTokens=typeof input==='number'&&typeof cacheWrite==='number'&&typeof cachedInput==='number'?input+cacheWrite+cachedInput:calls.length?'unknown':0
  let estimatedCostCny:number|'unknown'=calls.length?'unknown':zeroLlm?0:'unknown'
  if(calls.length){
    estimatedCostCny='unknown'
    if(calls.every(call=>call.pricing&&call.uncachedInputTokens!==null&&call.cacheWriteInputTokens!==null&&call.outputTokens!==null&&call.cachedInputTokens!==null)){
      estimatedCostCny=Number(calls.reduce((total,call)=>total+Number(estimateProviderCallCostCny(call.uncachedInputTokens!+call.cacheWriteInputTokens!,call.cachedInputTokens!,call.outputTokens!,call.pricing)),0).toFixed(8))
    }
  }
  const tiers=[...new Set(calls.map(call=>call.tier))]
  const last=calls.at(-1)
  const callLedger=calls.map(call=>{
    const complete=call.uncachedInputTokens!==null&&call.cacheWriteInputTokens!==null&&call.outputTokens!==null&&call.cachedInputTokens!==null
    const cost=complete?callCost(call.uncachedInputTokens!+call.cacheWriteInputTokens!,call.cachedInputTokens!,call.outputTokens!,call.pricing):'unknown'
    return {callId:call.callId,requestId:call.requestId,providerResponseId:call.providerResponseId,providerResponseModel:call.providerResponseModel,purpose:call.purpose,tier:call.tier,provider:call.provider,model:call.model,configSignature:call.configSignature,outcome:call.outcome,errorCode:call.errorCode,startedAt:call.startedAt,finishedAt:call.finishedAt,latencyMs:call.latencyMs,firstRawDeltaMs:call.firstRawDeltaMs,firstQuestionDraftMs:call.firstQuestionDraftMs,outputTokenLimit:call.outputTokenLimit,usageCompleteness:call.usageCompleteness,uncachedInputTokens:call.uncachedInputTokens??'unknown',cacheWriteInputTokens:call.cacheWriteInputTokens??'unknown',cachedInputTokens:call.cachedInputTokens??'unknown',totalInputTokens:call.uncachedInputTokens!==null&&call.cacheWriteInputTokens!==null&&call.cachedInputTokens!==null?call.uncachedInputTokens+call.cacheWriteInputTokens+call.cachedInputTokens:'unknown',outputTokens:call.outputTokens??'unknown',estimatedCostCny:cost}
  })
  return {source:calls.length?'provider':zeroLlm?'deterministic':'unknown',provider:last?.provider??null,model:last?.model??null,modelTier:tiers.length?tiers.join('+'):'none',inputTokens:totalInputTokens,totalInputTokens,uncachedInputTokens:input,cacheWriteInputTokens:cacheWrite,outputTokens:sum('outputTokens'),cachedInputTokens:cachedInput,retrievedMemoryCount,contextTokenEstimate,contextTokenEstimateKind:'heuristic',escalated,escalationReason,repairReason,repairCalls:calls.filter(call=>call.purpose==='repair').length,groundingReviewCalls:0,zeroLlm,llmCallCount:calls.length,estimatedCostCny,calls:callLedger}
}

async function runModelCall(runtime:ModelRuntime,systemPrompt:string,userPrompt:string,callIndex:number,requestId:string,contextEstimate:number,totalContextEstimate:number,retrievedMemoryCount:number,escalated:boolean,escalationReason:string|null,calls:CallRecord[],signal:AbortSignal,staged:Staged,capabilityVerified:(tier:ModelTier)=>boolean,purpose:CallRecord['purpose']='turn',schemaOverride?:unknown,schemaName?:string,outputPath:OutputPath='turn',emitDraft?:(text:string,kind:'safe_question'|'safe_sentence')=>void,observer?:ProviderCallObserver,userId='',resumePortfolioCatalogueIds?:readonly string[],slimUpdateTimeMode=false,clauseIds:readonly string[]=[],earlyDraftMode:'none'|'safe_sentence'='none',requireCandidate=false,boundedReply:BoundedReply|null=null):Promise<string>{
  signal.throwIfAborted()
  if(!runtime.available)throw new HttpError(503,'MODEL_TIER_UNAVAILABLE')
  if(!capabilityVerified(runtime.tier))throw new HttpError(503,'MODEL_CAPABILITY_TEST_REQUIRED')
  if(callIndex>=1)throw new HttpError(502,'UPSTREAM_CALL_LIMIT')
  const maxOutputTokens=outputTokenLimit(runtime.model,runtime.tier)
  const callId=`${requestId}:${callIndex+1}`,configSignature=modelSignatureFor(runtime.tier),startedAt=new Date().toISOString(),startedMonotonicMs=performance.now()
  const record:CallRecord={callId,requestId,purpose,tier:runtime.tier,provider:runtime.model.provider,model:runtime.model.id,configSignature,providerResponseId:null,providerResponseModel:null,pricing:runtime.pricing,outputTokenLimit:maxOutputTokens,uncachedInputTokens:null,cacheWriteInputTokens:null,outputTokens:null,cachedInputTokens:null,usageCompleteness:'unavailable',startedAt,finishedAt:null,latencyMs:null,firstRawDeltaMs:null,firstQuestionDraftMs:null,startedMonotonicMs,contextTokenEstimate:contextEstimate,outcome:'pending',errorCode:null}
  const finishCall=(outcome:'completed'|'failed',errorCode:string|null=null)=>{record.finishedAt??=new Date().toISOString();record.latencyMs??=Math.max(0,Math.round(performance.now()-startedMonotonicMs));record.outcome=outcome;record.errorCode=errorCode}
  const ceiling=config.providerBudgetEnabled?providerReservationCny(runtime.model.contextWindow,maxOutputTokens,runtime.pricing):0
  const spend=await reserveProviderSpend({user:userId,requestId,callIndex:callIndex+1,provider:runtime.model.provider,model:runtime.model.id,ceilingCny:ceiling})
  try{await observer?.before(Object.freeze({...record}))}catch(error){await settleProviderSpend(spend,0,true);throw error}
  calls.push(record);staged.upstreamCalls=calls.length
  staged.modelUsage=usageSummary(calls,totalContextEstimate,retrievedMemoryCount,escalated,escalationReason)
  staged.audit.push({phase:'model_call_started',call:callIndex+1,callId,requestId,purpose,tier:runtime.tier,provider:runtime.model.provider,model:runtime.model.id,configSignature,providerResponseId:null,outputTokenLimit:maxOutputTokens,outputPath,schemaName:schemaName??null,startedAt,contextTokenEstimate:contextEstimate,contextTokenEstimateKind:'heuristic'})
  try{
    const messages=providerTurnMessages(userPrompt,runtime.model)
    const envelope=JSON.parse(userPrompt),authorized=envelope.authorizedContext??envelope,currentMessageId=authorized.currentUserMessage.id
    const eventTargets=[authorized.currentEvent,...authorized.events??[]].filter(Boolean).map((event:any)=>({id:event.id,revision:event.revision,activeUnknownIds:(event.nodes??[]).filter((node:any)=>node.kind==='unknown'&&node.status==='active').map((node:any)=>node.id),nodeIds:(event.nodes??[]).map((node:any)=>node.id),actionIds:(event.actions??[]).map((action:any)=>action.id)}))
    const source=stream(runtime.model,{systemPrompt,messages},{apiKey:runtime.apiKey,maxTokens:maxOutputTokens,timeoutMs:60000,maxRetries:0,signal,onPayload:(payload,selected)=>{
      const configured=configureProviderPayload(payload,selected,runtime.tier,schemaOverride,schemaName,maxOutputTokens,currentMessageId,eventTargets,[...authorized.growth??[],...authorized.growthBackground??[]].map((row:any)=>({id:row.id,revision:row.revision})),runtime.tier==='default'?config.qwenThinkingBudget:0,requiresImmediateMaterial(authorized.currentUserMessage.text),resumePortfolioCatalogueIds,slimUpdateTimeMode,clauseIds,requireCandidate,{clauses:buildClauseCatalogue(authorized.currentUserMessage.text),requestTimeUtc:authorized.requestTimeUtc})
      // Actual outgoing instructions, tied to the existing call/completion and
      // final commit receipt. Never log user context or assert model compliance.
      if(JSON.stringify(configured).includes(JSON.stringify(mainCompanionPolicy.instructions).slice(1,-1)))staged.audit.push({phase:'main_skill_payload',callId,requestId,skill:mainCompanionPolicy.name,skillVersion:mainCompanionPolicy.version,skillDigest:mainCompanionPolicy.sourceDigest,policyDigest:mainCompanionPolicy.policyDigest,scope:mainCompanionPolicy.scope,status:'included_in_provider_payload'})
      // Explicit isolated instrumentation only. The observer cannot mutate the
      // actual outgoing body, and the production engine has no payload logger.
      if(observer?.payload)observer.payload(Object.freeze({...record}),structuredClone(configured))
      return configured
    }})
    let partialReply='',draftSent=false
    // G3: reply_only may surface the FIRST complete safe sentence; every
    // other mode still waits for a complete safe question. Both draft paths
    // are display-only — the saved state comes exclusively from finishRun.
    let earlyDraftKind:'none'|'safe_sentence'|'safe_question'='none'
    for await(const event of source){
      signal.throwIfAborted()
      if(event.type==='text_delta')record.firstRawDeltaMs??=Math.max(0,Math.round(performance.now()-startedMonotonicMs))
      if(event.type==='text_delta'&&emitDraft&&!draftSent){
        partialReply+=event.delta
        const question=openingQuestionDraft(partialReply)
        if(question&&boundedDraftAccepts(question,boundedReply)){record.firstQuestionDraftMs=Math.max(0,Math.round(performance.now()-startedMonotonicMs));emitDraft(question,'safe_question');draftSent=true;earlyDraftKind='safe_question'}
        else if(earlyDraftMode==='safe_sentence'||boundedReply){
          const sentence=safeEarlySentence(partialReply)
          if(sentence&&(!boundedReply||boundedSentenceAccepts(sentence,boundedReply))){record.firstSafeSentenceMs=Math.max(0,Math.round(performance.now()-startedMonotonicMs));emitDraft(sentence,'safe_sentence');draftSent=true;earlyDraftKind='safe_sentence'}
        }
      }
    }
    ;(record as {earlyDraftKind?:string}).earlyDraftKind=earlyDraftKind
    const message=await source.result()
    record.providerResponseId=typeof message.responseId==='string'&&message.responseId?message.responseId:null
    // pi-ai exposes a provider responseModel only when it differs from the requested
    // alias. Null is unknown, not proof that a concrete served model matched.
    record.providerResponseModel=typeof message.responseModel==='string'&&message.responseModel?message.responseModel:null
    const usage=message.usage as any
    const uncached=tokenValue(usage?.input),cacheWrite=tokenValue(usage?.cacheWrite)
    const emptyUsage=[usage?.input,usage?.cacheWrite,usage?.output,usage?.cacheRead].every(value=>!value)
    if(!emptyUsage){record.uncachedInputTokens=uncached;record.cacheWriteInputTokens=cacheWrite;record.outputTokens=tokenValue(usage?.output);record.cachedInputTokens=tokenValue(usage?.cacheRead)}
    const usageValues=[record.uncachedInputTokens,record.cacheWriteInputTokens,record.outputTokens,record.cachedInputTokens]
    record.usageCompleteness=usageValues.every(value=>value!==null)?'complete':usageValues.some(value=>value!==null)?'partial':'unavailable'
    finishCall('completed')
    staged.modelUsage=usageSummary(calls,totalContextEstimate,retrievedMemoryCount,escalated,escalationReason,false,purpose==='repair'?'coach_contract_repair':null)
    signal.throwIfAborted()
    if(message.stopReason==='error'||message.stopReason==='aborted')throw providerError(message.errorMessage??'Provider request failed')
    const totalInput=uncached!==null&&cacheWrite!==null&&record.cachedInputTokens!==null?uncached+cacheWrite+record.cachedInputTokens:null
    const raw=assistantText(message)
    // Explicit local acceptance instrumentation only. The default production
    // engine has no observer and never writes raw model output to its audit.
    await observer?.output?.(Object.freeze({...record}),raw)
    const outputTruncated=message.stopReason==='length'
    if(outputTruncated)staged.audit.push({phase:'model_output_truncated',call:callIndex+1,tier:runtime.tier,outputChars:raw.length,outputTokens:record.outputTokens??'unknown'})
    // Numeric-only profiling: never retain prompt text, model reasoning, or raw output in audit.
    let components:Record<string,unknown>|null=null
    try{const parsed=JSON.parse(raw.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1'));if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))components=parsed}catch{}
    const chars=(value:unknown)=>value===undefined||value===null?0:typeof value==='string'?value.length:JSON.stringify(value).length
    const material=(components?.event as any)?.action?.draft?.content
    const outputProfile={systemPromptChars:systemPrompt.length,userPromptChars:userPrompt.length,outputChars:raw.length,replyChars:components?chars(components.reply):null,eventChars:components?chars(components.event):null,materialChars:typeof material==='string'?material.length:null,materialRepeatedInModelReply:typeof material==='string'&&typeof components?.reply==='string'?components.reply.includes(material):null,candidateChars:components?chars(components.experienceCandidate):null}
    staged.audit.push({phase:'model_call_completed',call:callIndex+1,callId,requestId,providerResponseId:record.providerResponseId,providerResponseModel:record.providerResponseModel,configSignature,startedAt:record.startedAt,finishedAt:record.finishedAt,latencyMs:record.latencyMs,firstRawDeltaMs:record.firstRawDeltaMs,firstQuestionDraftMs:record.firstQuestionDraftMs,usageCompleteness:record.usageCompleteness,purpose,tier:runtime.tier,provider:runtime.model.provider,model:runtime.model.id,outputTokenLimit:maxOutputTokens,outputPath,schemaName:schemaName??null,totalInputTokens:totalInput??'unknown',uncachedInputTokens:record.uncachedInputTokens??'unknown',uncachedInputIncludesCacheWrite:false,cacheWriteInputTokens:record.cacheWriteInputTokens??'unknown',outputTokens:record.outputTokens??'unknown',cachedInputTokens:record.cachedInputTokens??'unknown',estimatedCostCny:record.usageCompleteness==='complete'?callCost(record.uncachedInputTokens!+record.cacheWriteInputTokens!,record.cachedInputTokens!,record.outputTokens!,record.pricing):'unknown',outputTruncated,outputProfile})
    if(outputTruncated)throw new HttpError(502,'MODEL_OUTPUT_TRUNCATED',15)
    return raw
  }catch(error){
    const code=error instanceof HttpError?error.code:'MODEL_REQUEST_FAILED'
    finishCall('failed',code)
    staged.modelUsage=usageSummary(calls,totalContextEstimate,retrievedMemoryCount,escalated,escalationReason,false,purpose==='repair'?'coach_contract_repair':null)
    staged.audit.push({phase:'model_call_failed',call:callIndex+1,callId,requestId,providerResponseId:record.providerResponseId,providerResponseModel:record.providerResponseModel,configSignature,startedAt:record.startedAt,finishedAt:record.finishedAt,latencyMs:record.latencyMs,firstRawDeltaMs:record.firstRawDeltaMs,firstQuestionDraftMs:record.firstQuestionDraftMs,usageCompleteness:record.usageCompleteness,purpose,tier:runtime.tier,provider:runtime.model.provider,model:runtime.model.id,outputTokenLimit:maxOutputTokens,outputPath,schemaName:schemaName??null,uncachedInputTokens:record.uncachedInputTokens??'unknown',uncachedInputIncludesCacheWrite:false,cacheWriteInputTokens:record.cacheWriteInputTokens??'unknown',cachedInputTokens:record.cachedInputTokens??'unknown',outputTokens:record.outputTokens??'unknown',estimatedCostCny:record.usageCompleteness==='complete'?callCost(record.uncachedInputTokens!+record.cacheWriteInputTokens!,record.cachedInputTokens!,record.outputTokens!,record.pricing):'unknown',code})
    throw error instanceof HttpError?error:providerError(error instanceof Error?error.message:'Provider request failed')
  }finally{
    const cost=record.usageCompleteness==='complete'?callCost(record.uncachedInputTokens!+record.cacheWriteInputTokens!,record.cachedInputTokens!,record.outputTokens!,record.pricing):'unknown'
    // Preserve both independent receipts even if either settlement fails.
    let expenseError:unknown
    try{const settled=await settleProviderSpend(spend,cost);if(settled?.overrun)expenseError=new HttpError(503,'PROVIDER_PRICE_CHANGED')}catch(error){expenseError=error}
    await observer?.after(Object.freeze({...record}))
    if(expenseError)throw expenseError
  }
}

async function runDialogueTurn({run,staged,context,signal,emit,focusContext}:EngineInput,capabilityVerified:(tier:ModelTier)=>boolean,observer?:ProviderCallObserver){
  signal.throwIfAborted()
  const current=context.find(row=>row.id===run.source_message_id)
  if(!current||current.role!=='user')throw new HttpError(409,'CURRENT_MESSAGE_MISSING')
  const snapshot=await loadSnapshot(run.user_id,run.conversation_id,current.content)
  staged.snapshot=snapshot
  const known=readKnownMajor(current.content,snapshot.profile)
  if(known){
    staged.dialoguePath='direct';staged.upstreamCalls=0
    staged.usedMemoryRefs=snapshot.profile.filter(item=>item.key==='education.major'&&item.status==='active').map(item=>({memoryId:item.id,revision:item.revision}))
    const usage=usageSummary([],0,1,false,null,true);staged.modelUsage=usage
    return {text:`你之前告诉我，你的专业是「${known}」。如果有变化，可以直接更正。`,usage}
  }
  // N1.4: direction controls are read, derived, overlaid and staged BEFORE
  // any retrieval, embedding, public knowledge or Coze work. The expected
  // snapshot key is the PRE-generation one and is set for every turn.
  const engineStageClock=performance.now()
  let preRetrievalMs:number|null=null,knowledgeMs:number|null=null,validationMs:number|null=null
  const controlsBefore=await readDirectionControls(run.user_id)
  const expectedControlKey=directionControlsSnapshotKey(controlsBefore)
  const turnDerivedControls=deriveExplicitDirectionControls(current.content)
  const effectiveControls=overlayDirectionChanges(controlsBefore,turnDerivedControls.status==='explicit'?turnDerivedControls.changes:[])
  staged.directionControlSnapshotKey=expectedControlKey
  if(turnDerivedControls.status==='explicit'){
    staged.directionControls=await stageDirectionControls(run,turnDerivedControls.changes,expectedControlKey)
  }
  const contributionSentenceMode=requiresImmediateMaterial(current.content)&&/(?:一句(?:简历(?:表达|描述)|作品描述)|作品描述.{0,8}(?:压成|缩成|写成)一句)/.test(current.content)
  const contributionParagraphMode=requiresImmediateMaterial(current.content)&&/作品描述/.test(current.content)&&!contributionSentenceMode
  const resumePortfolioMode=requiresImmediateMaterial(current.content)&&/简历|作品清单|作品集|个人介绍|作品描述/.test(current.content)
  const obligations=deriveTurnObligations(current.content,{resumePortfolioMode,...(turnDerivedControls.status==='explicit'?{directionControls:turnDerivedControls.changes}:{})})
  staged.turnObligations=obligations
  if(isPureControlCommand(current.content,obligations,turnDerivedControls.status==='explicit'?turnDerivedControls.changes.map(change=>change.quote):[])){
    // N1.4/P5.6: a pure control command commits through the real storage rules
    // with a deterministic reply — before event retrieval, embedding, public
    // knowledge and Coze; zero network, zero provider calls, real entitlements.
    staged.usedMemoryRefs=[]
    staged.usedExperienceRefs=[]
    staged.usedEventRefs=[]
    staged.dialoguePath='direct';staged.upstreamCalls=0
    staged.modelUsage=usageSummary([],0,0,false,null,true)
    return {text:controlReplyText(obligations.requiredEffects),usage:staged.modelUsage}
  }
  // P6 closeout fix: a PURE memory-control message (forget / pause_use /
  // stop_recommend, optionally with politeness words) takes the same
  // deterministic zero-model path — control turns are user tasks that must
  // not be hostage to model business-write variance on the control sentence
  // itself. Scoring/staging rules are identical to the in-turn path; the
  // commit still happens only in finishRun's transaction.
  {
    const memoryIntents=detectForgetIntentClauses(current.content).filter(clause=>clause.kind)
    if(memoryIntents.length&&scanUserClauses(current.content).every(clause=>{
      const body=clause.text.trim()
      // A bare keep-note clause ("记录保留") accompanies the control without
      // adding any other business content.
      const barePreserveNote=body.length<=8&&/^(?:记录保留|保留记录|先不删|不要删|别删|不用删|留着|保留着)$/.test(body)
      return !body||!/[\p{L}\p{N}]/u.test(body)||memoryIntents.some(intent=>intent.clauseText===body)||ignorableConnectives.has(body)||barePreserveNote
    })){
      const growthAllForControl=await growthContext(run.user_id,run.conversation_id)
      let controlReply='好的，已经处理你的请求。'
      for(const clause of memoryIntents){
        const scored=scoreForgetTargets(clause.kind==='stop_recommend'?growthAllForControl.filter(item=>['goal','direction','priority'].includes(item.kind)):growthAllForControl,clause.clauseText,current.content).filter(entry=>entry.overlap>=2)
        const best=scored[0],second=scored[1]
        if(best&&(!second||second.overlap<best.overlap)){
          if(staged.memoryControl&&(staged.memoryControl.itemId!==best.item.id||staged.memoryControl.kind!==clause.kind)){controlReply+=' 其中一个请求匹配到多条相似记录，稍后请在卡片里确认。';continue}
          staged.memoryControl={kind:clause.kind!,itemId:best.item.id,expectedRevision:best.item.revision,clauseText:clause.clauseText}
          staged.audit.push({phase:'memory_control_staged',kind:clause.kind,itemId:best.item.id,revisionBefore:best.item.revision,executed:null,note:'pure control command: commits in finishRun transaction'})
          controlReply+=clause.kind==='forget'?'已遗忘这条记录；同一消息里的其他独立情况不受影响。':clause.kind==='pause_use'?'这条记录会保留，但不再作为建议依据。':'这条记录会保留用于理解，但不再主动推荐相关方向或事项。'
        }else if(scored.length){
          if(!staged.pendingMemoryControl)staged.pendingMemoryControl={kind:clause.kind!,clauseText:clause.clauseText,candidates:scored.slice(0,3).map(entry=>({itemId:entry.item.id,revision:entry.item.revision,preview:entry.item.text.slice(0,80)}))}
          controlReply+=' 这条匹配到多条相似记录，请在上方的确认卡片里选择要操作的那条。'
        }else{
          staged.audit.push({phase:'memory_control_no_target',kind:clause.kind,reason:'pure control command: no matching record'})
          controlReply+=' 没有找到与这句话对应的记录；如果你指的是某条具体经历，告诉我它的关键词我再找。'
        }
      }
      staged.usedMemoryRefs=[]
      staged.usedExperienceRefs=[]
      staged.usedEventRefs=[]
      staged.dialoguePath='direct';staged.upstreamCalls=0
      staged.modelUsage=usageSummary([],0,0,false,null,true)
      return {text:controlReply,usage:staged.modelUsage}
    }
  }
  let currentEvent:CoachEvent|null=null
  try{currentEvent=await coachEventView(run.user_id,run.conversation_id)}catch(error){
    if(!(error instanceof HttpError)||!['NOT_FOUND','MEMORY_DISABLED','COACH_SOURCE_REVOKED'].includes(error.code))throw error
  }
  const retrievalStarted=performance.now()
  const retrieval=await searchCoachEvents(run.user_id,run.conversation_id,{query:current.content},signal)
  staged.audit.push({phase:'coach_retrieval_completed',latencyMs:Math.round(performance.now()-retrievalStarted),eventCount:retrieval.events.length,indexPending:retrieval.indexPending,ambiguous:retrieval.ambiguous,embedding:'local_offline'})
  const historicalEvents=retrieval.events.filter(event=>event.id!==currentEvent?.id)
  preRetrievalMs=Math.round(performance.now()-engineStageClock)
  const knowledgeStart=performance.now()
  const allContextMessages=await redactGrowthHistory(run.user_id,context.filter(row=>row.id===run.source_message_id||!snapshot.suppressedMessageIds?.includes(row.id)))
  // An unambiguous owned event can carry its method into another conversation.
  // A new or competing matter must not inherit that event's usage or branch.
  const guideEvent=currentEvent??(!retrieval.ambiguous&&historicalEvents.length===1?historicalEvents[0]:null)
  const matchingGuideEvent=guideEvent&&feedbackMatchesCurrent(current.content,guideEvent.title,guideEvent.title)?guideEvent:null
  const previousGuideUsage=matchingGuideEvent?await readGuideUsage(run.user_id,run.conversation_id,matchingGuideEvent.id):[]
  const methodIntent=knowledgeIntent(current.content,{eventTitle:matchingGuideEvent?.title,hasPriorGuide:previousGuideUsage.length>0,lastUserTexts:allContextMessages.filter(row=>row.role==='user'&&row.id!==run.source_message_id).map(row=>row.content)})
  const needsKnowledge=!['NONE','CLARIFY'].includes(methodIntent.decision)
  let knowledge=needsKnowledge?await retrieveCoachKnowledge(methodIntent.query,signal,methodIntent):[]
  staged.audit.push({phase:'knowledge_intent',decision:methodIntent.decision,reason:methodIntent.reason,stage:methodIntent.stage,providerCalls:0})
  knowledgeMs=Math.round(performance.now()-knowledgeStart)
  // C1 controlled-integration diagnostics ONLY: force the LOCAL candidates to
  // miss while the verified registry stays intact, so the remote Coze fallback
  // runs in the same backend request. Explicitly labeled in the audit; never a
  // natural user-traffic claim and never enabled by default.
  if(config.diagLocalKnowledgeMiss&&knowledge.length){
    staged.audit.push({phase:'local_knowledge_miss',reason:'diagnostic_injection',controlledIntegrationOnly:true,localCandidatesSuppressed:knowledge.length})
    knowledge=[]
  }
  if(needsKnowledge&&!knowledge.length){
    // N3: Coze fallback — only when local retrieval found nothing AND the
    // message safely yields a whitelist public query (never the raw chat).
    // Failures are audit-only; candidates map through the reviewed registry.
    const publicQuery=buildPublicKnowledgeQueryFromText(current.content)
    if(publicQuery){
      const rendered=renderPublicKnowledgeQuery(publicQuery)
      // S6: transport selection is exclusive — code_workflow (deployed
      // read-only API) when configured, else the legacy resource_workflow
      // PAT path. One request uses exactly one transport; a failure never
      // auto-switches to the other (no double billing).
      const codeConfig=codeWorkflowConfigFrom()
      const codeMissing=codeWorkflowMissingConfig(codeConfig)
      const resourceConfig=cozeConfigFrom()
      const resourceMissing=cozeMissingConfig(resourceConfig)
      const codeActive=!codeMissing
      if(codeMissing&&codeMissing.includes('DISABLED')&&(!resourceMissing||resourceMissing.includes('DISABLED'))){
        staged.audit.push({phase:'coze_knowledge_skipped',reason:'disabled_by_default'})
      }else if(codeActive){
        try{
          const result=await searchCodeWorkflowKnowledge(rendered,signal,codeConfig)
          const mapped=await mapCozeCandidates(result.hits,{enabled:true,workflowId:codeConfig.projectId,workflowVersion:codeConfig.release,pat:'',timeoutMs:codeConfig.timeoutMs,maxItems:6})
          // C1 same-request trace: the rendered whitelist query and the exact
          // document/card identities this request produced — the query contains
          // only whitelist topics, never the raw private chat text.
          staged.audit.push({phase:'coze_knowledge_candidates',transport:'code_workflow',latencyMs:result.latencyMs,workflowVersion:result.release,query:rendered,hitDocumentIds:result.hits.map(hit=>hit.documentId),verifiedCardIds:mapped.verified.map(entry=>entry.card.id),unverifiedDocumentIds:mapped.unverifiedDocumentIds,hits:result.hits.length,verified:mapped.verified.length,unverified:mapped.unverifiedDocumentIds.length,costState:'separate_ledger_unknown_until_real'})
          if(mapped.verified.length){
            const existing=new Set(knowledge.map(card=>card.id))
            for(const candidate of mapped.verified)if(!existing.has(candidate.card.id)){knowledge=[...knowledge,candidate.card.payload];existing.add(candidate.card.id)}
          }
        }catch(error){
          const code=error instanceof CodeWorkflowError?error.code:'CODE_REQUEST_FAILED'
          staged.audit.push({phase:'coze_knowledge_failed',transport:'code_workflow',code})
        }
      }else if(codeMissing&&codeMissing.length&&!codeMissing.includes('DISABLED')&&(!resourceMissing||resourceMissing.includes('DISABLED'))){
        staged.audit.push({phase:'coze_knowledge_skipped',transport:'code_workflow',reason:'CONFIG_MISSING',missing:codeMissing})
      }else if(!resourceMissing||resourceMissing.length===0){
        try{
          const result=await searchCozePublicKnowledge(publicQuery,rendered,signal,resourceConfig)
          const mapped=await mapCozeCandidates(result.hits,resourceConfig)
          staged.audit.push({phase:'coze_knowledge_candidates',transport:'resource_workflow',latencyMs:result.latencyMs,workflowVersion:result.version,query:rendered,hitDocumentIds:result.hits.map(hit=>hit.documentId),verifiedCardIds:mapped.verified.map(entry=>entry.card.id),unverifiedDocumentIds:mapped.unverifiedDocumentIds,hits:result.hits.length,verified:mapped.verified.length,unverified:mapped.unverifiedDocumentIds.length,costState:'separate_ledger_unknown_until_real'})
          if(mapped.verified.length){
            const existing=new Set(knowledge.map(card=>card.id))
            for(const candidate of mapped.verified)if(!existing.has(candidate.card.id)){knowledge=[...knowledge,candidate.card.payload];existing.add(candidate.card.id)}
          }
        }catch(error){
          const code=error instanceof CozeRetrievalError?error.code:'COZE_REQUEST_FAILED'
          staged.audit.push({phase:'coze_knowledge_failed',transport:'resource_workflow',code})
        }
      }else{
        staged.audit.push({phase:'coze_knowledge_skipped',reason:'CONFIG_MISSING',missing:[...(codeMissing??[]).filter(k=>k!=='DISABLED'),...(resourceMissing??[]).filter(k=>k!=='DISABLED')]})
      }
    }
  }
  knowledge=deduplicateGuides(knowledge)
  if(methodIntent.continuation&&methodIntent.stage==='adjust'){
    const latestByGuide=[...new Map(previousGuideUsage.slice().reverse().map(row=>[row.guide_id,row])).values()]
    const continued=[]
    for(const row of latestByGuide.slice(0,2)){
      try{continued.push(await readApprovedGuide(row.guide_id,row.revision))}
      catch(error){if(!(error instanceof HttpError)||!['COACH_KNOWLEDGE_INVALIDATED','METHOD_UNAVAILABLE'].includes(error.code))throw error;staged.audit.push({phase:'guide_continuation_unavailable',guideId:row.guide_id,revision:row.revision,providerCalls:0})}
    }
    // Reuse the actual method, rather than introduce an unrelated tutorial while reviewing it.
    if(continued.length)knowledge=deduplicateGuides(continued)
  }
  const latestUsage=[...new Map(previousGuideUsage.slice().reverse().map(row=>[row.guide_id,row])).values()]
  const stopped=new Set(latestUsage.filter(row=>row.status==='declined').map(row=>row.guide_id))
  if(!/(?:重新|再试|继续使用).{0,12}(?:方法|办法|攻略)|我想再/.test(current.content))knowledge=knowledge.filter(card=>!stopped.has(card.id))
  const report=classifyGuideFeedback(current.content)
  const methodUsage=previousGuideUsage.map(row=>({...row,status:report&&canContinueGuideFeedback(row.status,report)?report:row.status}))
  const methodContext=methodPromptContext(knowledge,current.content,methodIntent,Number(process.env.LIFEOS_METHOD_TOKEN_BUDGET)||1800,methodUsage)
  knowledge=knowledge.filter(card=>methodContext.knowledge.some(row=>row.id===card.id))
  staged.audit.push({phase:'method_context',budgetTokens:methodContext.budgetTokens,estimatedTokens:methodContext.estimatedTokens,estimateKind:methodContext.estimateKind,dropped:methodContext.dropped,cardIds:knowledge.map(card=>card.id)})
  const contextKnowledge=[...(currentEvent?[currentEvent]:[]),...historicalEvents].flatMap(event=>event.actions.flatMap(action=>action.knowledgeRefs??[]))
  // G4 placeholder: selection happens after the contract is derived (it needs
  // the mode); until then the full bounded context keeps today's behavior.
  let historySelection:{selected:typeof allContextMessages;totalMessages:number;totalChars:number;selectedChars:number}|null=null
  staged.usedMemoryRefs=snapshot.profile.filter(item=>item.scope==='user'&&item.status==='active').map(item=>({memoryId:item.id,revision:item.revision}))
  staged.usedExperienceRefs=snapshot.confirmedExperiences.map(item=>({id:item.id,revision:item.revision}))
  staged.usedEventRefs=[...(currentEvent?[currentEvent]:[]),...historicalEvents].map(event=>({eventId:event.id,revision:event.revision,generation:event.generation}))
  const route={tier:'default' as const,escalated:false,reason:null},runtime=resolveModel('default')
  const growthAll=await growthContext(run.user_id,run.conversation_id)
  // P4 B1: relevance-based selection within a pre-declared budget; the full
  // authorized set still drives staging/snapshot checks - only the prompt
  // context is selected so large archives do not serialize wholesale.
  const recommendationStopped=new Set((await readRecommendationControls(run.user_id)).map(row=>row.itemId))
  const pendingRecommendationIds=new Set((await listControlRequests(run.user_id)).filter(row=>row.status==='pending'&&row.kind==='stop_recommend').flatMap(row=>row.candidates.map(candidate=>candidate.itemId)))
  const recommendationBlockedIds=new Set([...recommendationStopped,...pendingRecommendationIds])
  const unresolvedTaskBoundaries=growthAll.filter(item=>item.status==='active'&&!item.unavailableReason&&item.taskBoundary)
  const clauseCatalogue=buildClauseCatalogue(current.content)
  const newMatterExplicit=scanUserClauses(current.content).some(clause=>!clause.conditional&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&/(?:换个|换一件|另一件|另一个|新事情|新话题|转到|转而|不谈上次)/.test(clause.text))
  const explicitMaterialRequest=clauseCatalogue.some(clause=>!clause.conditional&&!clause.interrogative&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&deliverableIntent(clause.text,'create'))
  const asksRecall=methodIntent.reason==='memory_query'||/(?:我报告过|我之前把|按我(?:提供|报告)|你(?:目前|现在)?知道.{0,20}(?:实际做过|做过什么|报告过)|你会把|是不是(?:等于|意味着)|如果.{0,15}只想聊天)|^(?:我)?(?:本周|这周).{0,35}(?:是多少|多久|多少时间)/.test(current.content)
  const onlyReadback=clauseCatalogue.every(clause=>clause.interrogative||clause.conditional||clause.quoted||clause.code||clause.attributedToOther||assistantRequestClause(clause.text)||/^(?:请)?只(?:按|说|回答|回顾|说明)|^按我(?:提供|报告)/.test(clause.text))
  const readOnlyQuestion=methodIntent.decision==='NONE'&&asksRecall&&onlyReadback&&obligations.requiredEffects.length===0&&!currentConversationOnly(current.content)&&!explicitMaterialRequest&&clauseCatalogue.some(clause=>clause.interrogative)
  const boundaryNeedsClarification=!readOnlyQuestion&&!currentConversationOnly(current.content)&&!newMatterExplicit&&(pendingRecommendationIds.size>0||unresolvedTaskBoundaries.some(item=>current.content.includes(item.taskBoundary!.targetText)))
  const growthSelection=selectRelevantGrowth(growthAll.filter(item=>!recommendationBlockedIds.has(item.id)&&!item.taskBoundary),current.content)
  const growth=growthSelection.selected
  if(growthSelection.dropped>0)staged.audit.push({phase:'growth_selection',totalActive:growthSelection.totalActive,selected:growthSelection.selected.length,dropped:growthSelection.dropped,budgetMax:growthSelection.budget.maxItems})
  // P6 closeout B2: current-matter grouping for the prompt. Snapshot keys and
  // used refs below still describe the FULL authorized set (growthAll) — only
  // how the model READS the records is organized.
  const growthTopic=splitGrowthByCurrentTopic(growth,current.content)
  // Fix 2: cross-session recommendation boundaries — stopped items stay in the
  // evidence set for understanding but are handed to the model as an explicit
  // no-proactive-recommendation boundary.
  const growthRecommendationBoundaries=growthAll.filter(row=>recommendationStopped.has(row.id)||pendingRecommendationIds.has(row.id)).map(row=>({...row,recommendationBoundary:recommendationStopped.has(row.id)?'stopped':'pending_target_confirmation'}))
  staged.audit.push({phase:'growth_topic_split',currentTopic:growthTopic.currentTopic.length,background:growthTopic.background.length})
  const growthBoundaries=await growthBoundaryContext(run.user_id,run.conversation_id)
  // P4: resume/portfolio materials render from a server-built catalogue of the
  // user's own verified words only; the model selects ids and never authors
  // factual prose for this material class.
  const materialCatalogue=resumePortfolioMode?buildMaterialFactCatalogue(growth,snapshot.confirmedExperiences,{id:run.source_message_id,conversationId:run.conversation_id,text:current.content}):[]
  // N1.4: allowed/blocked come from the EFFECTIVE overlay (including this
  // turn's pending pause/resume), not a re-read after generation.
  const blockedDirectionScopes=effectiveControls.filter(row=>row.state==='paused').map(row=>row.scope)
  const allowedDirectionScopes=allScopes.filter(scope=>!blockedDirectionScopes.includes(scope))
  staged.growthBoundaryKey=growthSnapshotKey(growthBoundaries)
  // P5 S1/P0: the consistency snapshot, used refs and staged-update
  // authorization describe the FULL effective authorized state (growthAll) -
  // the selected subset only narrows what the model READS this turn. Computing
  // these from the subset made >maxItems archives fail every commit with a
  // phantom GROWTH_SNAPSHOT_INVALIDATED even with no real change.
  staged.usedGrowthRefs=growthAll.map(item=>({id:item.id,revision:item.revision}))
  staged.growthSnapshotKey=growthSnapshotKey(growthAll)
  if(isPureZeroPlanRequest(current.content,obligations)){
    // An explicitly empty plan has no model choice to make. Reuse the same
    // verified fact, plan, control and atomic commit machinery; no paid call.
    staged.growth=await stageGrowthUpdates(run,supplementMissingBudgetDeltas(obligations,undefined,run.source_message_id,current.content),growthAll,{})
    const period=obligations.requiredEffects.find(e=>e.type==='weekly_plan')!
    if(period.type!=='weekly_plan')throw new HttpError(400,'WEEKLY_PLAN_INVALID')
    const input={target:{operation:'create' as const},availableMinutes:0,period:period.period,budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[]}
    staged.weeklyPlan=await stageWeeklyPlan(run,input,{user:run.user_id,expectedControlSnapshotKey:expectedControlKey,effectiveBlockedScopes:blockedDirectionScopes})
    const text=renderProposedWeeklyPlan(input)
    verifyTurnObligations(obligations,{growth:staged.growth,controls:staged.directionControls,currentText:current.content,reply:text,weeklyPlan:staged.weeklyPlan})
    staged.dialoguePath='direct';staged.upstreamCalls=0
    staged.modelUsage=usageSummary([],0,0,false,null,true)
    staged.audit.push({phase:'explicit_zero_plan_deterministic',providerCalls:0,period:period.period,availableMinutes:0,executionClaim:false})
    return {text,usage:staged.modelUsage}
  }
  // P1: the clause catalogue is built once per turn; the prompt renders the
  // handles and every personal-fact anchor resolves back to an exact span.
  // Turn contract slimming: the provider schema and the rule sections are
  // derived from what THIS turn can produce; a closed lane is unrepresentable
  // in the native schema instead of a prompt "don't use this".
  if(boundaryNeedsClarification){
    staged.audit.push({phase:'task_boundary_clarification_required',pendingTargets:pendingRecommendationIds.size,unresolvedScopes:unresolvedTaskBoundaries.length,deferredPlanRequest:requestsTimeArrangement(current.content),deferredMaterialRequest:resumePortfolioMode,deferredEffects:obligations.requiredEffects.filter(effect=>effect.type==='weekly_plan'||effect.type==='grounded_material'),providerCalls:0})
    obligations.requiredEffects=obligations.requiredEffects.filter(effect=>effect.type!=='weekly_plan'&&effect.type!=='grounded_material')
  }
  const planIntent=!boundaryNeedsClarification&&(requestsTimeArrangement(current.content)||obligations.requiredEffects.some(effect=>effect.type==='weekly_plan'))
  // The contract must offer the material lane exactly when validation can
  // DEMAND it: deliverableIntent is the same detector the material-visibility
  // check uses (怎么开口 counts as a deliverable request), so the schema and
  // the validator can never disagree about the lane.
  const materialIntent=!readOnlyQuestion&&!boundaryNeedsClarification&&(resumePortfolioMode||deliverableIntent(current.content,currentEvent?.actions.some(action=>action.status==='proposed')?'modify':'create'))
  const planBudget=obligations.requiredEffects.find(effect=>effect.type==='weekly_plan')
  const requestedGuide=clauseCatalogue.some(clause=>!clause.quoted&&!clause.conditional&&!clause.attributedToOther&&assistantRequestClause(clause.text)&&/(?:用|使用|按|参考|依据).{0,80}(?:攻略|指南|方法)/.test(clause.text))?knowledge.find(card=>card.guide&&methodIntent.query.includes(card.title)):undefined
  const originalContract=bindPlanBudgetSchema(deriveTurnContract({text:current.content,knowledgeCount:knowledge.length,knowledgeIds:requestedGuide?[requestedGuide.id]:knowledge.map(card=>card.id),requiredKnowledgeCitation:Boolean(requestedGuide&&matchingGuideEvent),currentEventExists:!boundaryNeedsClarification&&currentEvent!==null,planIntent,material:materialIntent,readOnly:readOnlyQuestion}),planBudget?.type==='weekly_plan'?planBudget:undefined,current.content)
  const priorInterviewQuestions=growthAll.filter(item=>item.status==='active'&&!item.unavailableReason&&!item.recommendationStopped&&['user_reported','user_edit'].includes(item.assertion)&&requestedQuestionEditClauses(item.text).length>0).map(item=>item.text.replace(/^(?:我想把(?:验证问题|访谈问题|提问|这个问题)|把(?:上次的|这个)?问题)改成[:：]?/, '').replace(/^[“「『]|[”」』]$/g,'')).filter(q=>q.length>0&&q.length<=300)
  const priorInterviewQuestion=priorInterviewQuestions.length===1?priorInterviewQuestions[0]:undefined
  const boundedReply:BoundedReply|null=boundaryNeedsClarification?{basis:'editorial_adaptation',sourceStatus:'NO_PUBLIC_METHOD',stage:'reported_result',nextUnknown:'停止或暂停指的是哪件事项；不猜相似事件',choices:[pendingRecommendationIds.size?'先确认你想停止推荐的是哪件事：请在确认卡里选择原事项。已报告的事实保留；确认前不主动安排这些候选事项。想换一件新事，也可以直接告诉我。':'你之前暂停的是当时的备考或复习，尚未确认和这次是否同一事项。先核对这次要继续的是哪件事；不把旧暂停套到另一个考试，也不先安排任务。']}:readOnlyQuestion?boundedRecallReply(current.content,growthAll.filter(item=>item.status==='active'&&!item.unavailableReason&&['user_reported','user_edit'].includes(item.assertion)).map(item=>({text:item.text,createdAt:item.createdAt})),priorInterviewQuestion):null
  const contract=bindMaterialDeliverySchema(bindBoundedReplySchema(originalContract,boundedReply),current.content)
  if(contract.capabilities.material){
    const schema=contract.schema as {properties:Record<string,unknown>}
    // Grounded first-person material is authored only by selecting verified
    // catalogue entries. Keep an original, short explanatory reply rather
    // than letting a second factual artifact bypass those selections.
    if(resumePortfolioMode)schema.properties.reply={type:'string',minLength:1,maxLength:160,description:'只简短说明选择和未知边界；不要在reply另写作品描述、简历正文或扩写个人事实。完整材料由selectedFactIds对应的原话渲染。'}
    if(/(?:问题|提问).{0,10}(?:压成一句|缩成一句|改成)/.test(current.content)){
      const narrow=(node:any)=>{if(!node||typeof node!=='object')return;if(node.properties?.content)node.properties.content.maxLength=160;for(const value of Object.values(node))if(Array.isArray(value))value.forEach(narrow);else if(value&&typeof value==='object')narrow(value)}
      narrow(schema)
    }
  }
  // G4 mode-aware history selection: bound the raw dialogue the model reads
  // (the DB and structured lanes keep everything). The current message is
  // always present in buildTurnPrompt regardless of this filter.
  const historyForSelection=allContextMessages.filter(row=>row.id!==run.source_message_id).map(row=>({id:row.id,role:row.role==='assistant'?'assistant' as const:'user' as const,content:row.content??''}))
  historySelection=selectHistoryForMode(historyForSelection,contract.mode,current.content)
  const selectedIds=new Set(historySelection.selected.map(row=>row.id))
  const messages=allContextMessages.filter(row=>row.id===run.source_message_id||selectedIds.has(row.id))
  staged.audit.push({phase:'history_selection',mode:contract.mode,historyTotalMessages:historySelection.totalMessages,historySelectedMessages:historySelection.selected.length,historyTotalChars:historySelection.totalChars,historySelectedChars:historySelection.selectedChars,providerCalls:0})
  const systemPrompt=turnSystemPrompt('default',runtime.model.id,contract)+(currentConversationOnly(current.content)?'\n本轮本人只想倾听或明确拒绝方法：回应当前表达，不给行动、方法、解决问题的追问或安排，不重发上轮建议。对本次聊天的偏好不存为个人目标、经历或长期事实；独立的新本人事实如有则保留原话与未知。':'')+(boundedReply?'\nboundedReply是本轮服务端授权的编辑动作与过程追问，不是获审公共攻略。reply必须完整选择choices中适合当前请求的一项，不增加事实、因果、效果、时间或情绪判断；其他合法状态更新仍按原契约锚定本人原话。':'')
  const baseUserPrompt=buildTurnPrompt({currentMessageId:run.source_message_id,messages,profile:snapshot.profile,confirmedExperiences:snapshot.confirmedExperiences,currentEvent,events:historicalEvents,knowledge,methodContext:methodContext.knowledge,knowledgeIntent:methodIntent,guideUsage:previousGuideUsage,growth:growthTopic.currentTopic,growthBackground:growthTopic.background,growthBoundaries,growthRecommendationBoundaries,taskBoundaries:unresolvedTaskBoundaries.map(item=>item.taskBoundary!),directionControls:effectiveControls,allowedDirectionScopes:blockedDirectionScopes.length?allowedDirectionScopes:null,blockedDirectionScopes:blockedDirectionScopes.length?blockedDirectionScopes:null,...(resumePortfolioMode?{growthCatalogue:materialCatalogue.map(fact=>({catalogueId:fact.catalogueId,field:fact.field,text:fact.text,sourceKind:fact.sourceKind,completeForField:fact.completeForField}))}:{}),retrieval:{ambiguous:retrieval.ambiguous,indexPending:retrieval.indexPending},clauses:clauseCatalogue.map(handle=>({id:handle.clauseId,text:handle.text})),starMap:process.env.LIFEOS_DISABLE_STARMAP?null:await (async()=>{const ctx=await readStarMapContext(pool,run.user_id);if(ctx)staged.starMapSnapshot={themes:ctx.themes.map(theme=>({id:theme.id,revision:theme.revision})),links:ctx.usedLinks};return ctx})(),currentUserFocus:focusContext?{type:focusContext.type,id:focusContext.id,label:focusContext.label}:null})
  const workflowHints=await actionReviewHints({run,staged,text:current.content,memoryEnabled:snapshot.settings.enabled,currentEvent,historicalEvents,ambiguous:retrieval.ambiguous,listeningOnly:currentConversationOnly(current.content),signal})
  const userPrompt=workflowHints||boundedReply?JSON.stringify({...JSON.parse(baseUserPrompt),...(workflowHints?{workflowHints}:{}),...(boundedReply?{boundedReply}:{})}):baseUserPrompt
  let contextTokenEstimate=estimateTokens(systemPrompt+'\n'+userPrompt)
  const retrieved=snapshot.profile.filter(item=>item.scope==='user'&&item.status==='active').length+snapshot.confirmedExperiences.length+(currentEvent?1:0)+historicalEvents.length
  const calls:CallRecord[]=[]
  staged.audit.push({phase:'model_route',tier:route.tier,reason:route.reason??'ordinary_turn',escalated:route.escalated,retrievedMemoryCount:retrieved,contextTokenEstimate,contextTokenEstimateKind:'heuristic'})
  staged.audit.push({phase:'turn_contract',mode:contract.mode,capabilities:contract.capabilities,schemaChars:contract.schemaChars,systemPromptChars:systemPrompt.length,providerCalls:0})
  if(boundedReply)staged.audit.push({phase:'bounded_ordinary_reply',basis:boundedReply.basis,sourceStatus:boundedReply.sourceStatus,stage:boundedReply.stage,choices:boundedReply.choices.length,providerCalls:0})
  function materialDraftOf(result:ActionCoachTurn):{readiness?:string;content?:string;materialFactIds?:string[]}|null{
    const action=result.event?.action
    if(!action||!('draft'in action))return null
    const draft=action.draft as {content?:string;readiness?:string;materialFactIds?:string[]}
    return draft??null
  }
  // P2-5: one numeric per observable engine stage into the audit. Validation
  // is wrapped so repair cycles also count.
  const genericSkip=new Set([...`我你他她它们了的是一在和都也与及还就很不去要这那有没说会被把`])
  async function validateOutput(raw:string):Promise<ActionCoachTurn>{
    const validationStart=performance.now()
    try{return await validateOutputInner(raw)}
    finally{validationMs=Math.round(performance.now()-validationStart)}
  }
  async function validateOutputInner(raw:string):Promise<ActionCoachTurn>{
    let result:ActionCoachTurn
    try{result=parseActionCoachTurn(raw)}catch{throw new HttpError(502,'COACH_OUTPUT_INVALID')}
    if(readOnlyQuestion&&(result.event||result.experienceCandidate||result.weeklyPlan||result.growthUpdates?.length))throw new HttpError(502,'COACH_OUTPUT_INVALID')
    if((currentConversationOnly(current.content)||boundaryNeedsClarification)&&(result.experienceCandidate||result.event||result.weeklyPlan||result.citations?.length))throw new HttpError(502,'COACH_OUTPUT_INVALID')
    if(!boundedReplyAccepts(result.reply,boundedReply))throw new HttpError(502,'BOUNDED_REPLY_INVALID')
    staged.coach=undefined;staged.candidates=[];staged.memoryChanges=[];staged.growth=undefined

    {
      // 确定性目标捕获：模型对复合句的首个决定子句有稳定的漏存倾向
      // （三轮实测均只存后半句）。显式决定/否定句若未被本轮 growth 引用
      // 覆盖，由服务器按分句原话补一条 user_reported 目标事实；身份、
      // 来源、修订与模型写入完全同构。
      const covered=(quote:string)=>(staged.growth?.changes??[]).some((change:any)=>'source'in change&&typeof change.source?.quote==='string'&&change.source.quote.includes(quote))
      // “要不要做X”是自我斟酌不是向AI提问：捕获允许弱疑问形态，只排除
      // 真提问（带问号/吗/呢）与假设/引用/第三方。
      const decisionClauses=clauseCatalogue.filter(handle=>!handle.interrogative&&!handle.conditional&&!handle.quoted&&!handle.code&&!handle.attributedToOther&&!/[?？]|吗$|呢$/.test(handle.text)
        &&(!currentConversationOnly(current.content)||/我.{0,20}优先/.test(handle.text))
        &&!(turnDerivedControls.status==='explicit'&&turnDerivedControls.changes.some(change=>change.quote===handle.text))
        &&!negativePersonalFactClauses(current.content).some(clause=>clause.text===handle.text)
        &&!deliverableIntent(handle.text,'create')
        &&!assistantRequestClause(handle.text)
        &&!deferredPursuitClause(handle.text)
        &&!/^我(?:今天|现在|目前|这次)?(?:只想|就想|想|只希望|希望)(?:你)?(?:先)?(?:听(?:我|你|说)|聊|说说|说点|倾诉|吐槽|陪我)/.test(handle.text)
        &&!/^我.{0,6}不想(?:再|继续)?(?:聊|说|讨论)/.test(handle.text)
        &&!/^我想把(?:验证问题|访谈问题|提问|这个问题)/.test(handle.text)
        &&sentenceIsFirstPersonPublic(clauseCatalogue,handle)
        &&(/我(?![^，。；！？]{0,8}(?:他|她|它|室友|同学|朋友|老师|父母|别人))(?:.{0,6})?(?:决定|确定|定了|的目标是|想要?|打算|不打算|不再|放弃|考虑|在想|想试试|试试|感兴趣|优先|放第一|第一要|先不|暂停|不扩大|以.{0,4}为主)/.test(handle.text)
          ||/^想(?:要|用|了解)/.test(handle.text)
          ||/^[\p{L}]{1,12}(?:优先|放第一|放在前面)$/u.test(handle.text)&&!/(?:别人|老师|同学|朋友|他|她|建议|希望|如果|是否|不要)/.test(handle.text)))
      staged.serverGoals=decisionClauses.filter(handle=>!covered(handle.text)).map(handle=>({text:handle.text,quote:handle.text,messageId:run.source_message_id}))
      if(staged.serverGoals.length)staged.audit.push({phase:'growth_server_goal_captured',count:staged.serverGoals.length,committed:false})
      // 每周N小时类预算同样有稳定漏存倾向：按原话补 kind=context（不带期限，
      // 与 growth 时间规则一致）。
      const budgetClauses=clauseCatalogue.filter(handle=>!handle.conditional&&!handle.quoted&&!/[?？]/.test(handle.text)&&/每周.{0,8}[0-9一二两三四五六七八九十]+\s*小时/.test(handle.text)&&!/^(?:更正(?:一下)?|改一下|修正|说错|刚才说错)/.test(handle.text)&&!(staged.growth?.changes??[]).some((change:any)=>'source'in change&&typeof change.source?.quote==='string'&&change.source.quote.includes(handle.text)))
      staged.serverBudgets=budgetClauses.map(handle=>({text:handle.text,quote:handle.text,messageId:run.source_message_id}))
      if(staged.serverBudgets.length)staged.audit.push({phase:'growth_server_budget_captured',count:staged.serverBudgets.length,committed:false})
    }
    // P4: a resume_portfolio selection renders server-side into the stored
    // draft shape before any material checks or staging; bad references are
    // hard failures, never silently repaired into facts.
    if(result.event?.action&&'draft'in result.event.action){
      const draft=result.event.action.draft as unknown
      // N2.6: runtime does not trust provider schema compliance — in resume
      // mode a legacy free-text draft is a hard mode mismatch.
      if(resumePortfolioMode&&draft&&typeof draft==='object'&&(!('kind'in draft)||(draft as {kind:string}).kind!=='resume_portfolio')){
        throw new HttpError(400,'MATERIAL_MODE_MISMATCH')
      }
      if(draft&&typeof draft==='object'&&'kind'in draft&&(draft as {kind:string}).kind==='resume_portfolio'){
        const selection=draft as unknown as {selectedFactIds:string[]}
        try{
          const material=resolveSelectedMaterialFacts(selection.selectedFactIds??[],materialCatalogue,run.user_id,run.user_id,contributionSentenceMode?'contribution_sentence':contributionParagraphMode?'contribution_paragraph':'resume')
          ;(result.event.action as {draft:unknown}).draft={content:material.content,readiness:material.readiness,missingRequired:material.missingRequired,materialFactIds:material.usedCatalogueIds,materialEvidence:material.facts.map(fact=>({field:fact.field,text:fact.text,sourceRef:fact.sourceRef}))}
          // This class has one authoritative factual artifact. Keep the
          // model's original introductory paragraph; an additional free-text
          // body must not bypass the verified fact selection and rendering.
          const explanation=result.reply.split(/\n\s*\n/,1)[0]!.trim()
          if(explanation!==result.reply){result.reply=explanation;staged.audit.push({phase:'grounded_material_duplicate_body_removed',providerCalls:0})}
        }catch(error){
          throw error instanceof Error&&(error.message==='MATERIAL_REFERENCE_INVALID'||error.message==='MATERIAL_CATALOGUE_INVALID'||error.message==='MATERIAL_OUTPUT_LIMIT')?new HttpError(400,'MATERIAL_REFERENCE_INVALID'):error
        }
      }
    }
    const hasMaterial=result.event?.action&&'draft'in result.event.action
    const requestedMaterial=deliverableIntent(current.content,currentEvent?.actions.some(action=>action.status==='proposed')?'modify':'create')
    // A direct drafting instruction requests delivery now. Abstract advice is
    // not a completed delivery, even when it lacks the old framing markers.
    const directDraft=requiresImmediateMaterial(current.content)
    if(!boundaryNeedsClarification&&!hasMaterial&&requestedMaterial&&(directDraft||coachMaterialPresentation(result.reply)||result.reply.trim()==='按你提供的内容，整理如下：'))throw new HttpError(400,'COACH_MATERIAL_NOT_VISIBLE')
    staged.usedKnowledgeRefs=undefined
    const narrativeChars=result.reply.length
    try{result.reply=renderCoachReply(result)}catch{throw new HttpError(502,'COACH_OUTPUT_INVALID')}
    if(result.weeklyPlan&&[result.weeklyPlan.budgetRef,...result.weeklyPlan.basis].some(ref=>'id'in ref&&recommendationBlockedIds.has(ref.id)))throw new HttpError(400,'RECOMMENDATION_CONTROL_NOT_APPLIED')
    if(result.weeklyPlan){
      // P6 closeout C2/D: a plan the user did NOT ask for is a spurious model
      // field — drop it with an audit note instead of failing the whole reply
      // through plan-basis validation. A real arrangement request (with or
      // without a stated amount) keeps the full plan contract unchanged.
      if(!requestsTimeArrangement(current.content)){
        delete result.weeklyPlan
        staged.audit.push({phase:'weekly_plan_unsolicited_dropped',providerCalls:0})
      }
    }
    if(result.weeklyPlan){
      // N2.2/N2.3: the structured plan is staged against the pre-generation
      // control snapshot and the EFFECTIVE blocked scopes; the budget is
      // checked against the verified weekly effect (never rendered from an
      // unverified number), and the durable text comes from persistWeeklyPlan.
      const planInput=result.weeklyPlan as unknown as import('./weekly-plans.ts').WeeklyPlanInput
      // P2 (B05/B10): the plan's budget is the OBLIGATION's binding amount —
      // the budget applying to the plan's own period, never just the tightest
      // number found in the message.
      // P2 (B05/B10) → P4 (D-gate replay): the plan's budget is the
      // OBLIGATION's binding amount — the budget applying to the plan's own
      // period, never just the tightest number found in the message. When the
      // obligation itself pins the minutes, the server OWNS the number and
      // overrides a divergent model value with an audit note; a wrong model
      // figure never poisons the whole turn (the structural guard stays
      // exact: the persisted plan always carries the verified amount).
      const planObligation=obligations.requiredEffects.find(effect=>effect.type==='weekly_plan')
      if(planObligation&&planObligation.type==='weekly_plan'&&planInput.availableMinutes!==planObligation.minutes){
        staged.audit.push({phase:'weekly_plan_budget_server_overridden',modelMinutes:planInput.availableMinutes,bindingMinutes:planObligation.minutes,providerCalls:0})
        planInput.availableMinutes=planObligation.minutes
      }
      staged.weeklyPlan=await stageWeeklyPlan(run,planInput,{user:run.user_id,expectedControlSnapshotKey:expectedControlKey,effectiveBlockedScopes:blockedDirectionScopes})
      // A plan's visible period and totals come from the same validated
      // structure that is persisted, not free prose recalling an older week.
      result.reply+='\n\n'+renderProposedWeeklyPlan(planInput)
    }
    const checkedCitations=await validateCoachCitations(result.reply,result.citations??[],knowledge,current.content,messages.filter(row=>row.role==='user').map(row=>row.content))
    if(requestedGuide&&checkedCitations.refs.length&&!checkedCitations.refs.some(ref=>ref.sourceId===requestedGuide.id))throw new HttpError(400,'COACH_CITATION_INVALID')
    result.reply=checkedCitations.text
    // P5.3 step 8: the final reply must not contradict the verified effects.
    try{
      verifyReplyAgainstObligations(obligations,result.reply)
    }catch(error){
      if(isObligationError(error))throw new HttpError(400,error.code)
      throw error
    }
    staged.audit.push({phase:'coach_reply_rendered',narrativeChars,finalChars:result.reply.length,materialChars:result.event?.action&&'draft'in result.event.action&&'content'in result.event.action.draft?result.event.action.draft.content.length:0})
    staged.usedKnowledgeRefs=[...contextKnowledge,...checkedCitations.refs]
    // P2-1 → P2 (D-gate replay): growth mutation authority. The model's
    // deltas are intent (create / correct + clauseId); the server resolves
    // every quote to the exact clause span and decides the concrete operation,
    // revision and target. Duplicate replaces of one item, cross-kind
    // overwrites, unrelated current facts aimed at old items and control
    // clauses inside the growth batch are normalized deterministically — the
    // C06/L1:8/L2:6/L3:4/D01:1 failure shapes — instead of failing the turn.
    const correctionPlan=planExplicitCorrection(current.content,growthAll.map(item=>({id:item.id,revision:item.revision,kind:item.kind,assertion:item.assertion,text:item.text})))
    const controlClauseTexts=[...detectForgetIntentClauses(current.content).filter(clause=>clause.kind).map(clause=>clause.clauseText),...(turnDerivedControls.status==='explicit'?turnDerivedControls.changes.map(change=>change.quote):[])]
    if(result.growthUpdates?.length){
      staged.audit.push({phase:'growth_plan_context',authorizedCount:growthAll.length,authorizedKinds:growthAll.map(item=>item.kind),planTargetItem:correctionPlan?.target?.itemId??null,newQuote:correctionPlan?.newQuote??null,providerCalls:0})
      const authoritative=resolveGrowthDeltas({deltas:result.growthUpdates,suppressObservations:obligations.requiredEffects.some(effect=>effect.type==='remaining_time'||effect.type==='weekly_time'),currentMessageId:run.source_message_id,currentText:current.content,catalogue:clauseCatalogue,authorized:growthAll.map(item=>({id:item.id,revision:item.revision,kind:item.kind,assertion:item.assertion,text:item.text,unavailableReason:item.unavailableReason,status:item.status})),correctionPlan,controlClauseTexts})
      for(const entry of authoritative.audit)staged.audit.push(entry)
      staged.audit.push({phase:'growth_model_input_shape',ops:result.growthUpdates.map((delta)=>({op:delta.target.operation,itemId:delta.target.operation==='correct'?delta.target.itemId.slice(0,8):null,clauseId:delta.source.clauseId,kind:delta.kind})),providerCalls:0})
      for(const delta of authoritative.deltas)if(delta.assertion==='ai_observation'&&delta.dependencies.some(ref=>'id'in ref&&(recommendationBlockedIds.has(ref.id)||unresolvedTaskBoundaries.some(item=>item.id===ref.id))))throw new HttpError(400,'RECOMMENDATION_CONTROL_NOT_APPLIED')
      if(authoritative.deltas.length)staged.growth=await stageGrowthUpdates(run,authoritative.deltas,growthAll,{allowedDirectionScopes:allowedDirectionScopes})
      // Plan refs speak the MODEL's array positions; the persisted bindings are
      // keyed by the resolved positions. Translate surviving refs forward so
      // the rebinder below only deals with genuinely missing ones.
      if(result.weeklyPlan){
        const translate=(ref:unknown):unknown=>{
          if(ref&&typeof ref==='object'&&'updateIndex'in ref){
            const mapped=authoritative.indexMap.get((ref as {updateIndex:number}).updateIndex)
            if(mapped!==undefined)return {updateIndex:mapped}
          }
          return ref
        }
        const planRefs=result.weeklyPlan as unknown as {budgetRef:unknown;basis:unknown[]}
        planRefs.budgetRef=translate(planRefs.budgetRef)
        planRefs.basis=planRefs.basis.map(translate)
      }
    }
    // P1: a server-verified budget the model failed to persist is staged from
    // the obligation itself (the user's verbatim clause) so an explicit budget
    // statement never fails its own turn. Same deterministic pattern as
    // explicit direction controls; audit records the supplement. P2: synthetic
    // provider positions let a plan reference the supplement fact when the
    // model's own budget delta was skipped.
    const budgetSupplement=supplementMissingBudgetDeltas(obligations,staged.growth,run.source_message_id,current.content)
    let supplementBase=-1
    if(budgetSupplement.length){
      const stagedSupplement=await stageGrowthUpdates(run,budgetSupplement,growthAll,{})
      if(stagedSupplement.changes.length){
        const mergedChanges=[...(staged.growth?.changes??[]),...stagedSupplement.changes]
        const mergedBindings=new Map(staged.growth?.inputIndexBindings??[])
        const syntheticBase=result.growthUpdates?.length??0
        stagedSupplement.changes.forEach((_,i)=>mergedBindings.set(syntheticBase+i,mergedChanges.length-stagedSupplement.changes.length+i))
        supplementBase=syntheticBase
        staged.growth={changes:mergedChanges,prepared:[...(staged.growth?.prepared??[]),...stagedSupplement.prepared],inputIndexBindings:mergedBindings,skipped:[...(staged.growth?.skipped??[]),...(stagedSupplement.skipped??[])]}
        staged.audit.push({phase:'budget_fact_server_staged',effects:stagedSupplement.changes.map(delta=>delta.kind),providerCalls:0})
      }
    }
    // P2-1 fallback: the model produced no verifiable correction. Stage the
    // deterministic amend (or, without a safe target, the verbatim new value)
    // so a correction turn never ends with the old fact still quietly active.
    if(correctionPlan&&!staged.growth?.prepared.some(entry=>entry.kind==='split_amend'||(entry.kind==='ordinary'&&(entry.delta.target.operation==='replace'||entry.delta.target.operation==='amend')))&&!staged.growth?.changes.some(delta=>delta.target.operation==='create'&&delta.source.quote===correctionPlan.newQuote)){
      const amendDelta=correctionPlan.target?{target:{operation:'amend' as const,itemId:correctionPlan.target.itemId,expectedRevision:correctionPlan.target.expectedRevision,beforeQuote:correctionPlan.target.beforeQuote},assertion:'user_reported' as const,kind:correctionPlan.target.kind as 'context',source:{messageId:run.source_message_id,quote:correctionPlan.newQuote}}:null
      let stagedCorrection=null
      if(amendDelta){
        try{stagedCorrection=await stageGrowthUpdates(run,[amendDelta],growthAll,{})}catch{stagedCorrection=null}
      }
      if(!stagedCorrection?.changes.length){
        stagedCorrection=await stageGrowthUpdates(run,[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{messageId:run.source_message_id,quote:correctionPlan.newQuote}}],growthAll,{})
      }
      if(stagedCorrection.changes.length){
        const mergedChanges=[...(staged.growth?.changes??[]),...stagedCorrection.changes]
        const mergedBindings=new Map(staged.growth?.inputIndexBindings??[])
        const syntheticBase=Math.max(supplementBase,result.growthUpdates?.length??0)
        stagedCorrection.changes.forEach((_,i)=>mergedBindings.set(syntheticBase+i,mergedChanges.length-stagedCorrection!.changes.length+i))
        staged.growth={changes:mergedChanges,prepared:[...(staged.growth?.prepared??[]),...stagedCorrection.prepared],inputIndexBindings:mergedBindings,skipped:[...(staged.growth?.skipped??[]),...(stagedCorrection.skipped??[])]}
        staged.audit.push({phase:'correction_server_staged',mode:amendDelta&&stagedCorrection.prepared.some(entry=>entry.kind==='split_amend')?'amend':'verbatim_create',providerCalls:0})
      }
    }
    // NP_NEG_01 / BS_RESOURCE_01: optional model deltas omitted explicit status.
    // Retain only the speaker's guarded verbatim status, never an experience,
    // inferred cause, goal or completion. Corrections and controls keep authority.
    const contributionFacts=scanUserClauses(current.content).filter(clause=>!clause.interrogative&&!clause.conditional&&!clause.quoted&&!clause.code&&(reportsOwnContribution(clause.text)||(/^(?:补充(?:作品|项目)分工[:：])?.{1,20}(?:由|是)(?:同伴|同学|队友).{0,12}(?:完成|负责|画的)$/.test(clause.text)&&clauseCatalogue.some(own=>!own.conditional&&!own.interrogative&&!own.attributedToOther&&reportsOwnContribution(own.text)))))
    const explicitTaskFacts=[...contributionFacts,...reportedTaskBoundaryClauses(current.content),...negativePersonalFactClauses(current.content),...reportedAdoptionClauses(current.content),...requestedQuestionEditClauses(current.content),...resourceBlockedPersonalFactClauses(current.content),...reportedTaskOutcomeClauses(current.content,growthAll.some(item=>item.assertion==='user_reported'&&item.kind==='feedback'&&item.progressState==='completed')),...reportedPerformedTaskClauses(current.content),...scanUserClauses(current.content).filter(c=>!c.conditional&&!c.quoted&&!c.code&&!c.attributedToOther&&((!c.interrogative&&!c.quoteSpans.length&&(/^(?:但)?(?:遇到|卡在|停在).{0,30}(?:卡住|受阻|做不下去)/.test(c.text)||/^不再问(?:愿不愿意|是否愿意|想不想)/.test(c.text)))||(!c.interrogative&&!c.quoteSpans.length&&(/^(?:这次|刚才那次).{0,12}(?:访谈|行动|任务)我(?:暂时|先)不继续/.test(c.text)||/^(?:实际效果|使用结果|付款结果).{0,12}(?:我不知道|仍未知|不清楚)/.test(c.text))))) ]
    const taskFactSupplement=snapshot.settings.enabled&&!readOnlyQuestion?[...new Map(explicitTaskFacts.map(clause=>[clause.text,clause])).values()].filter(clause=>
      !assistantRequestClause(clause.text)&&
      !controlClauseTexts.includes(clause.text)&&
      !staged.growth?.changes.some(delta=>delta.source.quote.includes(clause.text))&&
      !growthAll.some(item=>item.status==='active'&&!item.unavailableReason&&item.text===clause.text)
    ).map(clause=>({target:{operation:'create' as const},assertion:'user_reported' as const,kind:'context' as const,source:{messageId:run.source_message_id,quote:clause.text}})):[]
    if(taskFactSupplement.length){
      const supplement=await stageGrowthUpdates(run,taskFactSupplement,growthAll,{allowedDirectionScopes})
      if(supplement.changes.length){
        // These facts are not model array positions and cannot anchor its plan.
        staged.growth={changes:[...(staged.growth?.changes??[]),...supplement.changes],prepared:[...(staged.growth?.prepared??[]),...supplement.prepared],inputIndexBindings:new Map(staged.growth?.inputIndexBindings??[]),skipped:[...(staged.growth?.skipped??[]),...(supplement.skipped??[])]}
        staged.audit.push({phase:'verbatim_task_fact_server_staged',count:supplement.changes.length,providerCalls:0})
      }
    }
    // Goal-change fallback (G1): a change-marker sentence (我改主意了，现在想
    // 先就业) with NO correction plan may produce a reply-only model turn —
    // the reply then names the new direction while the old goal stays active.
    // The server stages the supersession itself: the next first-person clause
    // of the same sentence replaces the single active goal record.
    if(!correctionPlan&&goalChangeMarker.test(current.content)){
      const activeGoals=growthAll.filter(item=>['goal','direction'].includes(item.kind)&&item.assertion==='user_reported'&&item.status==='active'&&!item.unavailableReason)
      if(activeGoals.length===1){
        const goalMutated=staged.growth?.changes.some(delta=>(delta.target.operation==='replace'||delta.target.operation==='amend')&&'itemId'in delta.target&&delta.target.itemId===activeGoals[0]!.id)
        const goalCreated=staged.growth?.changes.some(delta=>delta.target.operation==='create'&&['goal','direction'].includes(delta.kind))
        if(!goalMutated&&!goalCreated){
          const clauses=scanUserClauses(current.content).filter(clause=>/[\p{L}\p{N}]/u.test(clause.text))
          const markerIndex=clauses.findIndex(clause=>goalChangeMarker.test(clause.text))
          const newGoalClause=markerIndex>=0?clauses.slice(markerIndex+1).find(clause=>staged.serverGoals?.some(goal=>goal.quote===clause.text)&&!clause.interrogative&&!goalChangeMarker.test(clause.text)):undefined
          if(newGoalClause){
            const supersedeDelta={target:{operation:'replace' as const,itemId:activeGoals[0]!.id,expectedRevision:activeGoals[0]!.revision},assertion:'user_reported' as const,kind:activeGoals[0]!.kind as 'goal',source:{messageId:run.source_message_id,quote:newGoalClause.text.trim()}}
            try{
              const stagedSupersede=await stageGrowthUpdates(run,[supersedeDelta],growthAll,{})
              if(stagedSupersede.changes.length){
                const mergedChanges=[...(staged.growth?.changes??[]),...stagedSupersede.changes]
                const mergedBindings=new Map(staged.growth?.inputIndexBindings??[])
                const syntheticBase=Math.max(supplementBase,result.growthUpdates?.length??0)+1
                stagedSupersede.changes.forEach((_,i)=>mergedBindings.set(syntheticBase+i,mergedChanges.length-stagedSupersede.changes.length+i))
                staged.growth={changes:mergedChanges,prepared:[...(staged.growth?.prepared??[]),...stagedSupersede.prepared],inputIndexBindings:mergedBindings,skipped:[...(staged.growth?.skipped??[]),...(stagedSupersede.skipped??[])]}
                staged.audit.push({phase:'goal_change_server_staged',itemId:activeGoals[0]!.id,newGoal:newGoalClause.text.trim(),providerCalls:0})
              }
            }catch{/* staging conflicts surface through the snapshot assertions */}
          }
        }
      }
    }
    // P2-2 (D-gate replay C03:3): rebind a plan whose updateIndex refs point at
    // model deltas that were dropped, never emitted, or renumbered by the
    // authority — they must anchor on facts that actually persisted, and when
    // nothing persisted this turn, on the authorized budget fact the plan's
    // own minutes name (the server owns the plan's basis, never the model).
    if(staged.weeklyPlan){
      const bindings=staged.growth?.inputIndexBindings??new Map<number,number>()
      const syntheticOriginals=[...bindings.keys()].filter(original=>original>=(result.growthUpdates?.length??0)).sort((a,b)=>a-b)
      const planMinutes=obligations.requiredEffects.find(effect=>effect.type==='weekly_plan')
      const minutes=planMinutes&&planMinutes.type==='weekly_plan'?planMinutes.minutes:null
      const planInput=staged.weeklyPlan.input as unknown as {availableMinutes:number;budgetRef:unknown;basis:unknown[]}
      const pickBudgetOriginal=():number|null=>{
        if(minutes!==null&&staged.growth)for(const original of [...new Set([...syntheticOriginals,...bindings.keys()])]){
          const delta=staged.growth.changes[bindings.get(original)!]
          const selected=delta?applicableTimeBudget(delta.text,undefined,staged.weeklyPlan!.input.period==='next_week'?'next_week':staged.weeklyPlan!.input.period==='this_week'?'this_week':undefined):null
          if(delta&&delta.assertion==='user_reported'&&['context','constraint'].includes(delta.kind)&&selected?.amountMinutes===minutes&&!(selected.period==='next_week'&&staged.weeklyPlan!.input.period!=='next_week')&&!(selected.period==='this_week'&&!['this_week','current'].includes(staged.weeklyPlan!.input.period)))return original
        }
        return minutes===null?syntheticOriginals.at(-1)??null:null
      }
      // Authorized fallback: the plan's own budget amount identifies the fact.
      // A fact already named by an id-ref elsewhere in the plan wins; else a
      // unique minutes match; else none (the basis then fails honestly).
      const authorizedBudget=():{id:string;revision:number}|null=>{
        const resolvedIds=new Set(planInput.basis.filter((ref):ref is {id:string;revision:number}=>Boolean(ref&&typeof ref==='object'&&'id'in ref)).map(ref=>ref.id))
        const matches=growthAll.filter(item=>item.assertion==='user_reported'&&['context','constraint'].includes(item.kind)&&['active','proposed'].includes(item.status)&&!item.unavailableReason&&hoursIn(item.text)===planInput.availableMinutes)
        const named=matches.find(item=>resolvedIds.has(item.id))
        if(named)return {id:named.id,revision:named.revision}
        return matches.length===1?{id:matches[0]!.id,revision:matches[0]!.revision}:null
      }
      const remap=(ref:unknown,preferBudget:boolean):unknown=>{
        if(ref&&typeof ref==='object'&&'id'in ref){
          const selected=growthAll.find(item=>item.id===(ref as {id:string}).id&&item.revision===(ref as {revision?:number}).revision&&!item.unavailableReason&&['active','proposed'].includes(item.status))
          if(selected&&(!preferBudget||applicableTimeBudget(selected.text,undefined,staged.weeklyPlan!.input.period==='next_week'?'next_week':staged.weeklyPlan!.input.period==='this_week'?'this_week':undefined)?.amountMinutes===planInput.availableMinutes))return ref
          const chosen=pickBudgetOriginal()
          if(chosen!==null){staged.audit.push({phase:'plan_unavailable_reference_rebound',budget:preferBudget,providerCalls:0});return {updateIndex:chosen}}
          const fallback=authorizedBudget()
          if(fallback)return fallback
        }
        if(ref&&typeof ref==='object'&&'updateIndex'in ref){
          const original=(ref as {updateIndex:number}).updateIndex,mapped=bindings.get(original)
          // A surviving index can still name recurring availability rather than
          // the current remainder. Repair only this turn's source selection;
          // persistWeeklyPlan keeps the final amount/window authority.
          if(mapped!==undefined){
            if(!preferBudget||hoursIn(staged.growth!.changes[mapped]!.text)===planInput.availableMinutes)return ref
            const chosen=pickBudgetOriginal()
            if(chosen!==null){staged.audit.push({phase:'plan_budget_source_rebound',fromUpdateIndex:original,toUpdateIndex:chosen,providerCalls:0});return {updateIndex:chosen}}
            return ref
          }
          // A correctly staged budget needs no server supplement. An invalid
          // auxiliary position still binds to that verified budget instead of
          // depending on whether the model happened to omit the time fact.
          const chosen=pickBudgetOriginal()??(!preferBudget?syntheticOriginals.at(-1)??null:null)
          if(chosen!==null){staged.audit.push({phase:'plan_missing_reference_bound_to_budget',fromUpdateIndex:original,toUpdateIndex:chosen,budget:preferBudget,providerCalls:0});return {updateIndex:chosen}}
          const fallback=authorizedBudget()
          if(fallback)return fallback
        }
        return ref
      }
      planInput.budgetRef=remap(planInput.budgetRef,true) as never
      planInput.basis=planInput.basis.map(ref=>remap(ref,false)) as never
    }
    // P5.3 step 4 (N1.4/N1.5): an explicitly commanded change must exist in
    // the PRE-STAGED batch (staged before generation, never re-read here);
    // answering an old topic instead is a failed turn. Domain obligation
    // errors convert to HttpError at this boundary only.
    try{
      verifyTurnObligations(obligations,{growth:staged.growth,controls:staged.directionControls,weeklyPlan:staged.weeklyPlan,coachActionDraft:materialDraftOf(result),currentText:current.content,reply:result.reply})
    }catch(error){
      if(isObligationError(error))throw new HttpError(400,error.code)
      throw error
    }
    // P3 (PC09T T3): a correction from a PREVIOUS turn that never landed stays
    // outstanding. The reply on later turns may not claim 已更正/已记录好 while
    // the old fact is still the active one.
    let outstandingCorrection:import('./turn-obligations.ts').CorrectionPlan|null=null
    let outstandingCorrectionSource:string|null=null
    if(!correctionPlan){
      const previousUser=[...messages].reverse().find(row=>row.role==='user'&&row.id!==run.source_message_id)
      if(previousUser?.content){
        const prev=planExplicitCorrection(previousUser.content,growthAll.map(item=>({id:item.id,revision:item.revision,kind:item.kind,assertion:item.assertion,text:item.text})))
        if(prev){
          if(prev.target){
            const item=growthAll.find(row=>row.id===prev.target!.itemId)
            if(item&&item.text.includes(prev.target.beforeQuote)&&!item.text.includes(prev.newQuote)){outstandingCorrection=prev;outstandingCorrectionSource=previousUser.content}
          }else if(!growthAll.some(row=>row.text.includes(prev.newQuote))){outstandingCorrection=prev;outstandingCorrectionSource=previousUser.content}
        }
      }
    }
    // P5 (F03/S3.4): cross-turn OUTSTANDING FORGET - a recent prior user message
    // requested forgetting and no forget action has committed since.
    let outstandingForget=false
    let outstandingForgetSource:string|null=null
    {
      const priorUsers=[...messages].reverse().filter(row=>row.role==='user'&&row.id!==run.source_message_id).slice(0,3)
      for(const row of priorUsers){
        if(/(?:忘|删|清|移除|别再用|不再用|不再作为)/.test(row.content)){outstandingForget=true;outstandingForgetSource=row.content;break}
      }
    }
    // P5c (A3) → P6 closeout A2: a CURRENT explicit control clause with a
    // UNIQUE best-matching target STAGES the operation; the actual commit
    // happens in finishRun's transaction and its receipt is derived from the
    // real write. Ambiguity persists a recoverable confirmation request the
    // normal UI reads in this conversation and in new sessions. Nothing
    // destructive executes during candidate validation.
    {
      const intentClauses=detectForgetIntentClauses(current.content)
      for(const clause of intentClauses){
        if(!clause.kind)continue
        const scored=scoreForgetTargets(clause.kind==='stop_recommend'?growthAll.filter(item=>['goal','direction','priority'].includes(item.kind)):growthAll,clause.clauseText,current.content)
        const best=scored[0],second=scored[1]
        if(best&&best.overlap>=2&&(!second||second.overlap<best.overlap)){
          if(staged.memoryControl){
            if(staged.memoryControl.itemId===best.item.id&&staged.memoryControl.kind===clause.kind)continue
            // One executed control per turn; a genuinely different second
            // request waits for the user instead of guessing.
            if(!staged.pendingMemoryControl)staged.pendingMemoryControl={kind:clause.kind,clauseText:clause.clauseText,candidates:scored.filter(entry=>entry.overlap>=2).slice(0,3).map(entry=>({itemId:entry.item.id,revision:entry.item.revision,preview:entry.item.text.slice(0,80)}))}
            staged.audit.push({phase:'memory_control_deferred',kind:clause.kind,itemId:best.item.id,reason:'additional_control_clause'})
            continue
          }
          staged.memoryControl={kind:clause.kind,itemId:best.item.id,expectedRevision:best.item.revision,clauseText:clause.clauseText}
          staged.audit.push({phase:'memory_control_staged',kind:clause.kind,itemId:best.item.id,revisionBefore:best.item.revision,executed:null,note:'commits in finishRun transaction'})
        }else if(scored.filter(entry=>entry.overlap>=2).length){
          if(!staged.pendingMemoryControl)staged.pendingMemoryControl={kind:clause.kind,clauseText:clause.clauseText,candidates:scored.filter(entry=>entry.overlap>=2).slice(0,3).map(entry=>({itemId:entry.item.id,revision:entry.item.revision,preview:entry.item.text.slice(0,80)}))}
          staged.audit.push({phase:'memory_control_pending',kind:clause.kind,candidates:scored.filter(entry=>entry.overlap>=2).slice(0,3).map(entry=>entry.item.id)})
        }else{
          // A control clause with NO matching record at all: nothing to bind.
          // No empty confirmation card; the claim guard below keeps the reply
          // honest about the absence.
          staged.audit.push({phase:'memory_control_no_target',kind:clause.kind,reason:'no_matching_record'})
        }
      }
      // P3 (D-gate replay L1:9): a prior turn's explicit control that never
      // committed — because its sibling model growth field failed and rolled
      // the whole run back — is recovered HERE from the still-recorded user
      // words, deterministic and zero-model. The control is no longer hostage
      // to an unrelated provider error on the same earlier turn.
      if(!staged.memoryControl&&!staged.pendingMemoryControl&&outstandingForgetSource){
        const recoveredClauses=detectForgetIntentClauses(outstandingForgetSource).filter(clause=>clause.kind)
        for(const clause of recoveredClauses){
          const scored=scoreForgetTargets(growthAll,clause.clauseText,outstandingForgetSource).filter(entry=>['active','proposed'].includes(entry.item.status))
          const best=scored[0],second=scored[1]
          if(best&&best.overlap>=2&&(!second||second.overlap<best.overlap)){
            staged.memoryControl={kind:clause.kind!,itemId:best.item.id,expectedRevision:best.item.revision,clauseText:clause.clauseText}
            staged.audit.push({phase:'memory_control_recovered',kind:clause.kind,itemId:best.item.id,revisionBefore:best.item.revision,reason:'prior_turn_control_rolled_back',executed:null})
            break
          }
          if(scored.filter(entry=>entry.overlap>=2).length){
            staged.pendingMemoryControl={kind:clause.kind!,clauseText:clause.clauseText,candidates:scored.filter(entry=>entry.overlap>=2).slice(0,3).map(entry=>({itemId:entry.item.id,revision:entry.item.revision,preview:entry.item.text.slice(0,80)}))}
            staged.audit.push({phase:'memory_control_recovered_pending',kind:clause.kind,candidates:scored.filter(entry=>entry.overlap>=2).slice(0,3).map(entry=>entry.item.id)})
            break
          }
        }
        // No active matching record anywhere: the prior control already took
        // effect (typically because the failed turn has since been replayed or
        // the workspace executed it). The reply respecting that boundary is
        // honest — record the state instead of failing the turn (L1:9 shape).
        if(!staged.memoryControl&&!staged.pendingMemoryControl&&recoveredClauses.length)
          staged.audit.push({phase:'memory_control_already_effective',kinds:recoveredClauses.map(clause=>clause.kind),reason:'no_active_matching_record'})
      }
    }
    if(correctionPlan||outstandingCorrection){
      // P2-1: with no actual replace/amend staged, the reply may acknowledge
      // the user's words ("已记录你的原话") but must NOT claim the record was
      // corrected/updated while the old fact stays active. Exception: when NO
      // active record shares the correction's old-value characters, nothing
      // uncorrected remains — the fallback's verbatim create makes the 更正
      // claim effectively true (clause-granularity items may not contain the
      // old value the user named).
      const amendedNow=Boolean(staged.growth?.prepared.some(entry=>entry.kind==='split_amend'||(entry.kind==='ordinary'&&(entry.delta.target.operation==='replace'||entry.delta.target.operation==='amend'))))
      const claimPlan=correctionPlan??outstandingCorrection
      const claimSource=correctionPlan?current.content:outstandingCorrectionSource??current.content
      const oldValueRemainder=claimPlan?claimSource.split(claimPlan.newQuote).join(''):claimSource
      const oldValueChars=new Set<string>(String(oldValueRemainder).replace(/[^\p{L}\p{N}]/gu,''))
      const relatedActiveItem=growthAll.some(item=>{
        if(!['active','proposed'].includes(item.status))return false
        const chars=new Set(item.text.replace(/[^\p{L}\p{N}]/gu,''))
        let shared=0
        for(const char of oldValueChars)if(chars.has(char))shared++
        return shared>=2
      })
      // Nothing-to-correct tolerance: the user NAMED an old value (说成/说错了…)
      // that no active record carries — clause-granularity items may legitimately
      // not contain it. A correction naming no old value at all stays strict.
      const namesOldValue=/(?:说成|说错|搞错|记错|写错|看错|不对|之前说|以前说|原本是)/.test(oldValueRemainder)
      const claimDishonest=relatedActiveItem||!namesOldValue
      if(!amendedNow&&claimDishonest&&/(?:已更正|更正为|更正已记录|已把.{0,24}(?:改|撤|移除|删除)|已经?改成|已经?.{0,12}撤掉|更新为|已更新|已修改)/.test(result.reply))throw new HttpError(400,'REPLY_CLAIMS_UNCOMMITTED_CORRECTION')

    }
    // P4 (F03): the forget-claim guard runs INDEPENDENTLY of any correction
    // plan - a plain 遗忘 request with no correction must be covered too.
    // P6 closeout A2: "committed" means a control is STAGED for the finishRun
    // transaction (its real execution and receipt land there); a reply may
    // claim deletion only when a forget is staged, and may claim a usage stop
    // when any control is staged.
    {
      const controlStaged=staged.memoryControl!==undefined
      const alreadyEffective=staged.audit.some(entry=>(entry as {phase?:string}).phase==='memory_control_already_effective')
      const forgetClaim=/(?:已(?:经)?(?:清掉|清除|删掉|删除|忘掉|忘记|移除|撤下))/.test(result.reply)
      const pauseClaim=/(?:不再作为.{0,14}依据|不再.{0,6}(?:判断|建议|使用|推荐|主动提)|不会再?(?:推荐|主动提))/.test(result.reply)
      const forgetRequested=/(?:忘|删|清|移除|别再用|不再用|不再作为)/.test(current.content)||outstandingForget
      if(!controlStaged&&(forgetClaim||pauseClaim)&&forgetRequested&&!alreadyEffective)throw new HttpError(400,'REPLY_CLAIMS_UNCOMMITTED_FORGET')
      if(controlStaged&&staged.memoryControl!.kind!=='forget'&&forgetClaim)throw new HttpError(400,'REPLY_CLAIMS_UNCOMMITTED_FORGET')
    }
    // P2-3 (PC08D T4): a verbatim repeat of the previous assistant reply
    // answers nothing. Legal repeats (explicit re-send/keep-the-original
    // requests) stay allowed.
    {
      const previousAssistant=[...messages].reverse().find(row=>row.role==='assistant')?.content?.trim()
      const previousUser=[...messages].reverse().find(row=>row.role==='user')?.content?.trim()
      const squash=(text:string)=>text.replace(/\s+/g,'')
      const resentSameMessage=Boolean(previousUser&&squash(current.content)===squash(previousUser))
      // Substantive repeat only: a long verbatim repeat while the user asked something new. Short listening acknowledgments (好，我在听) repeating is normal companionship; explicit re-send requests stay legal.
      if(previousAssistant&&squash(result.reply)===squash(previousAssistant)&&squash(result.reply).length>=40&&/[？?]|怎么|什么|如何|为什么|哪|帮|请|给我/.test(current.content)&&!resentSameMessage&&!/(?:再发|重发|再说一遍|保留原话|原样|复用|不变|和上次的?一样)/.test(current.content))throw new HttpError(400,'REPLY_REPEATED_VERBATIM')
    }
    if(result.background?.length){
      for(const fact of result.background)if(fact.source.messageId!==run.source_message_id||!fact.source.quote.trim()||!current.content.includes(fact.source.quote)||!fact.source.quote.includes(fact.value))throw new HttpError(400,'COACH_BACKGROUND_INVALID')
      staged.memoryChanges=await stageCoachBackground(run.user_id,run.conversation_id,run.source_message_id,result.background,snapshot)
    }
    // A cited, explicitly requested method must retain its task identity even
    // when the model only returns prose. Bind only a current owned task clause;
    // no biography, completed action or guessed historical identity is created.
    if(!result.event&&!currentEvent&&!matchingGuideEvent&&!readOnlyQuestion&&!currentConversationOnly(current.content)&&requestedGuide&&checkedCitations.refs.some(ref=>ref.sourceId===requestedGuide.id)&&(newMatterExplicit||!retrieval.ambiguous)){
      const task=reportedTaskBoundaryClauses(current.content).find(clause=>!refusalPreferenceClause(clause.text)&&!conversationPreferenceClause(clause.text))??resourceBlockedPersonalFactClauses(current.content)[0]??negativePersonalFactClauses(current.content)[0]
      if(task){
        const source={messageId:run.source_message_id,quote:task.text}
        result.event={target:{operation:'create',title:task.text.slice(0,120),source},nodes:[{kind:'fact',source}]}
        staged.audit.push({phase:'guide_task_source_bound',guideId:requestedGuide.id,providerCalls:0})
      }
    }
    if(result.event){
      // Only identities actually supplied in this user's authorized snapshot
      // may be continued. Database/permission failures remain non-repairable.
      const target=result.event.target
      if(target.operation==='continue'&&!staged.usedEventRefs?.some(ref=>ref.eventId===target.eventId))throw new HttpError(400,'COACH_EVENT_TARGET_INVALID')
      staged.coach=await stageCoachEvent(run,result.event,result.reply);staged.coach.knowledgeRefs=staged.usedKnowledgeRefs
    }
    const refusalEvent=refusalOnly&&!retrieval.ambiguous&&historicalEvents.length===1&&matchingGuideEvent?.id===historicalEvents[0].id?matchingGuideEvent:null
    const usageEventId=staged.coach?.eventId??currentEvent?.id??refusalEvent?.id??(needsKnowledge?matchingGuideEvent?.id:undefined)
    staged.guideUsage=[]
    if(usageEventId){
      const feedback=classifyGuideFeedback(current.content),previous=previousGuideUsage[0]
      // A different named current task never changes the old task's usage.
      if(feedback&&previous&&currentEvent&&canContinueGuideFeedback(previous.status,feedback)&&feedbackMatchesCurrent(current.content,currentEvent.title,previous.branch_task??'')&&usageEventId===currentEvent.id)staged.guideUsage.push({guideId:previous.guide_id,revision:previous.revision,branch:previous.branch,stepId:previous.step_id,status:feedback,eventId:usageEventId,sourceMessageId:run.source_message_id,sourceQuote:current.content})
      if(!staged.guideUsage.length&&!currentEvent&&historicalEvents.length===1&&historicalEvents[0].id===usageEventId&&(result.event?.target.operation==='continue'||refusalEvent!==null)){
        const continued=await continuedActionUsage({run,text:current.content,event:historicalEvents[0],ambiguous:retrieval.ambiguous})
        if(continued)staged.guideUsage.push(continued)
      }
      for(const card of knowledge.filter(card=>staged.usedKnowledgeRefs?.some(ref=>ref.sourceId===card.id))){
        if(staged.guideUsage.some(u=>u.guideId===card.id)||latestUsage.some(u=>u.guide_id===card.id&&u.status!=='declined'))continue
        if(!staged.coach&&currentEvent&&!feedbackMatchesCurrent(current.content,currentEvent.title,card.guide?.branches[0]?.task??''))continue
        const selected=methodContext.knowledge.find(k=>k.id===card.id),suggestion=authorizedGuideApplication(run,staged,card,usageEventId,typeof selected?.branch==='string'?selected.branch:undefined,currentConversationOnly(current.content))
        if(suggestion)staged.guideUsage.push(suggestion)
      }
    }
    // A pure direction declaration is not a completed experience.
    if(result.experienceCandidate&&!requiresExperienceCandidate(clauseCatalogue)){
      delete result.experienceCandidate
      staged.audit.push({phase:'coach_optional_candidate_rejected',code:'DIRECTION_DECLARATION_IS_NOT_EXPERIENCE',committed:false})
    }
    if(result.experienceCandidate){
      // P1: the candidate's source is a contiguous clauseId selection; the
      // quote is the exact server-owned span, so a drifted or cross-message
      // quote is unrepresentable (the C03:3/L2:7/L1OFF shapes). An
      // unresolvable selection is droppable only when the turn is not itself
      // about saving; otherwise it is a real source failure.
      const selection=resolveContiguousClauseRange(current.content,clauseCatalogue,result.experienceCandidate.source.clauseIds)
      if(!selection){
        // Under the required lane the flash tier sometimes names non-adjacent
        // handles. When the structural fallback can still stage the verbatim
        // sentence, the user's saving intent is not lost: drop the unusable
        // selection and let the structural path below carry it. Only a turn
        // about saving with NOTHING stageable server-side stays a hard source
        // failure.
        const covered=selectStructuralCandidate(current.content,clauseCatalogue,new Date(current.created_at).toISOString())
        if(covered){
          staged.audit.push({phase:'coach_optional_candidate_rejected',code:'CANDIDATE_CLAUSE_UNRESOLVED',coveredByStructural:true,committed:false})
          delete result.experienceCandidate
        }else{
          const savingRelated=/(?:保存|记录|记下|记住|存入|收录|入库|确认|经历|经验|图谱|长期记忆|experience|remember|record|save|memory)/i
          const independent=result.event?.action?.operation!=='close'&&!savingRelated.test(current.content)&&!savingRelated.test(result.reply)
          if(!independent)throw new HttpError(400,'SOURCE_QUOTE_MISMATCH')
          staged.audit.push({phase:'coach_optional_candidate_rejected',code:'CANDIDATE_CLAUSE_UNRESOLVED',committed:false})
          delete result.experienceCandidate
        }
      }else{
        // Structured fields resolve server-side from the same catalogue: the
        // model only named handles, the stored text stays verbatim user words.
        // A comma chain is one sentence: when the model's selection sits inside
        // a detected experience sentence, the record keeps the whole chain so
        // the leading clause's action and time words are not lost (the flash
        // tier routinely selects only the trailing result clauses).
        const anchorIso=new Date(current.created_at).toISOString()
        const structural=selectStructuralCandidate(current.content,clauseCatalogue,anchorIso)
        const coveredByStructural=structural&&structural.start<=selection.start&&selection.end<=structural.end
        // 退化短选段（如只选了「对了」两个字）不足以代表经历：结构句更长时
        // 采用整句，同一套服务器选段规则。
        const degenerate=selection.quote.trim().length<6
        const includesCommand=clauseCatalogue.some(handle=>handle.start>=selection.start&&handle.end<=selection.end&&!handle.quoted&&!handle.code&&(assistantRequestClause(handle.text)||conversationPreferenceClause(handle.text)||refusalPreferenceClause(handle.text)))
        const span=structural&&(includesCommand||coveredByStructural||(degenerate&&structural.quote.length>selection.quote.length))?structural:{quote:selection.quote,start:selection.start,end:selection.end}
        const extracted=resolveCandidateContent(clauseCatalogue,span,result.experienceCandidate,anchorIso)
        if(span===structural){
          if(!clauseReportsCompleted(extracted.content.action))extracted.content.action=structural!.content.action
          // 结果若是回指词本身（模型把“上次那个…访谈”当成了结果），换用
          // 结构句挑出的真实结果分句。
          if(!extracted.content.result||/上次那|上次说|那件事|刚才说/.test(extracted.content.result))extracted.content.result=structural!.content.result
        }
        for(const field of extracted.dropped)staged.audit.push({phase:'coach_candidate_field_dropped',code:'CANDIDATE_FIELD_CLAUSE_UNRESOLVED',field,committed:false})
        try{
          await stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote:span.quote,links:result.experienceCandidate.links??deriveStructuralLinks(span.quote),content:extracted.content},signal)
        }catch(error){
          // Only an independent semantic candidate error may be dropped. Source,
          // ownership and transaction failures still invalidate the whole turn.
          // Be conservative when saving is requested or mentioned in the output:
          // that response must be repaired rather than silently changing intent.
          const savingRelated=/(?:保存|记录|记下|记住|存入|收录|入库|确认|经历|经验|图谱|长期记忆|experience|remember|record|save|memory)/i
          const independent=result.event?.action?.operation!=='close'
            &&!savingRelated.test(current.content)&&!savingRelated.test(result.reply)
          if(!(error instanceof HttpError)||!['PLANNED_ACTION_IS_NOT_EXPERIENCE','SKILL_IS_NOT_EXPERIENCE'].includes(error.code)||!independent)throw error
          staged.audit.push({phase:'coach_optional_candidate_rejected',code:error.code,committed:false})
          delete result.experienceCandidate
        }
      }
    }
    if(!result.experienceCandidate&&!slimUpdateTimeMode&&requiresExperienceCandidate(clauseCatalogue)){
      // Constrained decoding only guides, it does not force: flash-tier models
      // keep omitting the optional lane even when the schema requires it. A
      // structurally unambiguous completed first-person action report still
      // becomes a candidate here — same server-owned verbatim quote, same
      // guards, same user-confirmation lifecycle as the model-selected path.
      const structural=selectStructuralCandidate(current.content,clauseCatalogue,new Date(current.created_at).toISOString())
      if(structural){
        try{
          await stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote:structural.quote,links:deriveStructuralLinks(structural.quote),content:structural.content},signal)
          staged.audit.push({phase:'coach_candidate_structural',code:'STRUCTURAL_CANDIDATE_STAGED',quoteChars:structural.quote.length,committed:false})
        }catch(error){
          const savingRelated=/(?:保存|记录|记下|记住|存入|收录|入库|确认|经历|经验|图谱|长期记忆|experience|remember|record|save|memory)/i
          const independent=result.event?.action?.operation!=='close'
            &&!savingRelated.test(current.content)&&!savingRelated.test(result.reply)
          if(!(error instanceof HttpError)||!['PLANNED_ACTION_IS_NOT_EXPERIENCE','SKILL_IS_NOT_EXPERIENCE'].includes(error.code)||!independent)throw error
          staged.audit.push({phase:'coach_optional_candidate_rejected',code:error.code,structural:true,committed:false})
        }
      }
    }
    if(!staged.candidates.length){
      // 反述直连：模型把追述写进 feedback 通道时，事件身份仍由服务器判定——
      // 原始消息里有明确指代且命中既有经历（同一套区别性词元+时间守卫），
      // 就 staged 一条合并指令，由 finishRun 在事务里落盘。
      const rawStructural=selectStructuralCandidate(current.content,clauseCatalogue,new Date(current.created_at).toISOString())
      if(rawStructural){
        const episodes=(await pool.query("SELECT id, source_quote FROM experiences WHERE user_id=$1 AND status='confirmed'",[run.user_id])).rows
        const episode=findEpisode(episodes,rawStructural.quote,'','')
        if(episode){
          staged.backReferenceMerge={experienceId:String(episode.id),quote:rawStructural.quote,result:rawStructural.content.result,occurredAt:rawStructural.content.occurredAt}
          staged.audit.push({phase:'coach_candidate_structural',code:'BACK_REFERENCE_STAGED',experienceId:episode.id,committed:false})
        }
      }
    }
    return result
  }
  const slimUpdateTimeMode=obligations.kind==='update_weekly_time'&&!/(?:已经|昨天|已投|已发|投了|发了|完成了|做了|交了)/.test(current.content)
  // An unambiguous refusal needs no generated interpretation. It still uses
  // the same validator and transaction for its durable stop preference.
  const refusalOnly=Boolean(currentConversationOnly(current.content)&&clauseCatalogue.some(c=>refusalPreferenceClause(c.text))&&clauseCatalogue.every(c=>conversationPreferenceClause(c.text)||/^(?:按上次办法|还是上次那件事|上次那件事)$/.test(c.text)))
  if(refusalOnly&&!staged.memoryControl&&!staged.pendingMemoryControl){
    const refusal=clauseCatalogue.find(c=>refusalPreferenceClause(c.text))!
    // A personal task can be stored as feedback or context. Bind the boundary
    // to its original record without changing its kind or inventing a goal.
    const primaryCandidates=growthAll.filter(item=>((['goal','direction'].includes(item.kind)&&['user_reported','user_edit'].includes(item.assertion))||(item.kind==='priority'&&Boolean(item.structuredPlan))||(['context','feedback'].includes(item.kind)&&['user_reported','user_edit'].includes(item.assertion)&&scanUserClauses(item.text).some(clause=>!clause.quoted&&!clause.code&&!clause.quoteSpans.length&&!clause.codeSpans.length&&!clause.conditional&&!clause.attributedToOther&&!clause.interrogative&&/^我/.test(clause.text.trim())&&clauseExpressesWishToAct(clause.text)&&!assistantRequestClause(clause.text)&&!deferredPursuitClause(clause.text))))&&['active','proposed'].includes(item.status)&&!item.unavailableReason&&!item.recommendationStopped)
    const candidates=primaryCandidates.length?primaryCandidates:scoreForgetTargets(growthAll.filter(item=>item.kind==='context'&&['user_reported','user_edit'].includes(item.assertion)&&item.status==='active'&&!item.unavailableReason&&!item.recommendationStopped&&!item.taskBoundary),refusal.text,current.content).filter(entry=>entry.overlap>=2).map(entry=>entry.item)
    const previousUser=(await pool.query("SELECT id FROM messages WHERE user_id=$1 AND conversation_id=$2 AND role='user' AND id<>$3 AND created_at<=(SELECT created_at FROM messages WHERE id=$3) ORDER BY created_at DESC,id DESC LIMIT 1",[run.user_id,run.conversation_id,current.id])).rows[0] as {id:string}|undefined
    const directlyNamed=previousUser?candidates.filter(item=>item.sources.some(source=>source.type==='message'&&source.id===previousUser.id)):[]
    if(directlyNamed.length===1){const item=directlyNamed[0]!;staged.memoryControl={kind:'stop_recommend',itemId:item.id,expectedRevision:item.revision,clauseText:refusal.text}}
    else if(candidates.length)staged.pendingMemoryControl={kind:'stop_recommend',clauseText:refusal.text,candidates:candidates.slice(0,3).map(item=>({itemId:item.id,revision:item.revision,preview:item.text.slice(0,80)}))}
    staged.audit.push({phase:'refusal_matter_control_staged',target:staged.memoryControl?.itemId??null,pending:Boolean(staged.pendingMemoryControl),providerCalls:0})
  }
  let result:ActionCoachTurn,firstText:string|undefined
  let explicitMaterial:ActionCoachTurn|undefined
  if(contract.capabilities.material&&!boundaryNeedsClarification){
    const worksheet=requestedBlankJobWorksheet(current.content)
    const draft=worksheet
    if(draft){
      const previous=currentEvent?.actions.find(action=>action.status==='proposed')
      explicitMaterial={reply:'按你提供的内容，整理如下：',event:{target:currentEvent?{operation:'continue',eventId:currentEvent.id,expectedRevision:currentEvent.revision}:{operation:'create',title:'岗位核对表',source:{messageId:run.source_message_id,quote:current.content}},action:previous?{operation:'modify',actionId:previous.id,expectedRevision:previous.revision,draft}:{operation:'create',draft}}}
      staged.audit.push({phase:'explicit_material_rendered_without_generation',basis:'explicit_blank_job_worksheet',providerCalls:0})
    }
  }
  try{
    if(!explicitMaterial&&!refusalOnly)await checkModelCooldown()
    if(refusalOnly)staged.audit.push({phase:'explicit_refusal_deterministic',providerCalls:0})
    firstText=explicitMaterial?JSON.stringify(explicitMaterial):refusalOnly?JSON.stringify({reply:'好的，先不继续建议或安排这件事。'}):await runModelCall(runtime,systemPrompt,userPrompt,0,run.request_id,contextTokenEstimate,contextTokenEstimate,retrieved,route.escalated,route.reason,calls,signal,staged,capabilityVerified,'turn',contract.schema as never,'lifeos_action_coach','turn',(text,draftKind)=>emit({type:'draft',text,saved:false,draftKind}),observer,run.user_id,resumePortfolioMode?materialCatalogue.map(fact=>fact.catalogueId):undefined,slimUpdateTimeMode,clauseCatalogue.map(handle=>handle.clauseId),'safe_sentence',contract.capabilities.candidate&&requiresExperienceCandidate(clauseCatalogue),boundedReply)
    result=await validateOutput(firstText)
  }catch(error){
    // Invalid output is a visible failure with its original receipt. No
    // observer or diagnostic option may start a hidden second generation.
    if(calls.length){
      staged.audit.push({phase:'coach_repair_blocked',code:error instanceof HttpError?error.code:'COACH_OUTPUT_INVALID',providerRequestSent:false})
    }
    throw error
  }
  staged.dialoguePath='direct';staged.upstreamCalls=calls.length
  staged.audit.push({phase:'engine_stage_timings',preRetrievalMs,knowledgeMs,validationMs,modelCallsMs:calls.map(call=>call.latencyMs),firstRawDeltaMs:calls.map(call=>call.firstRawDeltaMs),firstQuestionDraftMs:calls.map(call=>call.firstQuestionDraftMs),userPromptChars:userPrompt.length})
  const usage=usageSummary(calls,contextTokenEstimate,retrieved,route.escalated,route.reason,refusalOnly||Boolean(explicitMaterial))
  staged.modelUsage=usage
  return {text:result.reply,usage}
}

export function createTurnEngine(dependencies:{capabilityVerified?:(tier:ModelTier)=>boolean;providerCallObserver?:ProviderCallObserver}={}):Engine{
  const capabilityCheck=dependencies.capabilityVerified??modelCapabilityVerified
  const engine:Engine=input=>runDialogueTurn(input,capabilityCheck,dependencies.providerCallObserver)
  engine.modelManaged=true
  engine.modelReadiness=()=>{const runtime=resolveModel('default');return runtime.available&&capabilityCheck('default')}
  return engine
}
export const runTurn:Engine=createTurnEngine()
