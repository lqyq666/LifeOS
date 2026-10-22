import {explicitTimeEvidenceCandidates} from './growth-time.ts'
import {taskPauseNeedsClarification} from './user-command-spans.ts'
import {ownedOpenDefinitionQuestion} from './reply-draft.ts'
import {surfaceDirectionScopes} from './growth-controls.ts'
import {randomUUID,createHash} from 'node:crypto'
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {mainCompanionPolicy} from './companion-policy.ts'
import {grillingInteractionMode} from './grilling-policy.ts'
import {providerReservationCny,reserveProviderSpend,settleProviderSpend} from './provider-spend.ts'
import {config} from './config.ts'
import { searchCoachEvents } from './coach-retrieval.ts'
import { retrieveCoachKnowledgeCandidates, validateCoachCitations, readApprovedGuide } from './coach-knowledge.ts'
import { openingQuestionDraft, openUnreportedChoiceQuestion, openPresupposedProblemQuestion, removePrematureDemoStep, removePrematureProductization, groundSingleLeadWithoutProduct, removeQuestionOnZeroTime, limitGrillingQuestions, removeUnsupportedContactChannels, groundUnsupportedOperationalResources, prioritizeReportedAccessFailure, groundReportedAccessAlternative, fixReportedReceiptState, acknowledgeRefusalBoundary, repairUnsupportedPreferenceClaim, repairUnsupportedZeroTimeClaim, enforceReportedQuantity, ensureZeroTimeFocus, removeZeroTimeTasks, ensureLowCostSelfStart, ensureTwoFactorPresenceChange, guardHealthTwoFactor, groundClickablePrototype, ensureClickableValidation, fixClickableCountConsistency, softenSingleObservationCausality, ensureRequestedQuestion, safeEarlySentence, groundedStateReadback, requestsOnlyStateReadback, retainsDraftText, groundedFeedbackPreview, provisionalStatePreview, provisionalQuestionPreview, provisionalCorrectionPreview, weeklyPlanDraft, weeklyPlanExplanation, requestsOneQuestionReply, type WeeklyPlanDraftExpectation } from './reply-draft.ts'
import { boundedDistinctionReply,unresolvedTwoFactors,distinctionActionAccepts,repairReviewedDefects } from './review-repairs.ts'
import { renderCoachReply } from './coach-reply.ts'
import { stream, parseStreamingJson, type AssistantMessage } from '@mariozechner/pi-ai'
import { HttpError, pool } from './db.ts'
import {classifyProviderFailure,providerError,type ProviderFailureCategory} from './provider-errors.ts'
import { parseActionCoachTurn, finalCoachJsonText, completeCoachJsonFrame, actionCoachTurnSchema, type ActionCoachTurn } from './action-coach-contracts.ts'
import { coachEventView, stageCoachEvent, deliverableIntent, requiresImmediateMaterial, coachMaterialPresentation,requestedBlankJobWorksheet,effectiveMaterialRequest,unchangedProposedAction,unknownQuestionTopicMatches, type CoachEvent } from './action-coach-events.ts'
import { estimateTokens } from './context.ts'
import { loadSnapshot, stageCoachBackground } from './memory.ts'
import { readKnownMajor } from './model-router.ts'
import { modelCapabilityVerified, modelSignatureFor, resolveModel, type ModelPricing, type ModelRuntime, type ModelTier } from './model.ts'
import { checkModelCooldown } from './operations.ts'
import { stageCandidate, type Run, type Staged } from './store.ts'
import type {GrowthItem} from '../src/features/growth/types.ts'
import { buildTurnPrompt, providerTurnMessages, turnSystemPrompt, promptResponseScopeRules } from './turn-prompt.ts'
import { configureProviderPayload, outputTokenLimit, type OutputPath } from './model-payload.ts'
import { estimateProviderCallCostCny } from './cost-workload.ts'
import { growthContext, growthBoundaryContext, growthSnapshotKey, stageGrowthUpdates } from './growth.ts'
import { normalizeModelFeedbackDelta } from './growth-model-normalize.ts'
import { selectRelevantGrowth, splitGrowthByCurrentTopic } from './growth-selection.ts'
import { readDirectionControls, deriveExplicitDirectionControls, stageDirectionControls, overlayDirectionChanges, directionControlsSnapshotKey, directionScopeLabel, allScopes,mentionedDirectionScopes } from './growth-controls.ts'
import { redactGrowthHistory } from './growth-privacy.ts'
import { cozeConfigFrom, cozeMissingConfig, searchCozePublicKnowledge, mapCozeCandidates, CozeRetrievalError } from './coze-knowledge.ts'
import { codeWorkflowConfigFrom, codeWorkflowMissingConfig, searchCodeWorkflowKnowledge, CodeWorkflowError, type CodeWorkflowConfig } from './coze-code-workflow.ts'
import { buildPublicKnowledgeQueryFromText, renderPublicKnowledgeQuery } from './coze-public-query.ts'
import { reportsOwnContribution, buildMaterialFactCatalogue, resolveSelectedMaterialFacts, singleUniqueContributionFact } from './grounded-material.ts'
import { stageWeeklyPlan, renderProposedWeeklyPlan, requiresPlanSlack, normalizeWeeklyPlanTasks, normalizeWeeklyPlanReply } from './weekly-plans.ts'
import { ignorableConnectives } from './turn-obligations.ts'
import { applicableTimeBudget, deriveTurnObligations, isPureZeroPlanRequest, verifyTurnObligations, verifyReplyAgainstObligations, repairReplyBudget, supplementMissingBudgetDeltas, planExplicitCorrection, hoursIn, isPureControlCommand, controlReplyText, isObligationError, requestsTimeArrangement, type TurnObligations } from './turn-obligations.ts'
import { scanUserClauses,assistantRequestClause,conversationPreferenceClause,currentConversationOnly,deferredPursuitClause,refusalPreferenceClause,scopedTaskPauseClause,methodReferenceClause,responseRequestScope,closingOnlyInstruction } from './user-command-spans.ts'
import { buildClauseCatalogue, resolveContiguousClauseRange, type ClauseHandle } from './clause-catalogue.ts'
import { clauseExpressesWishToAct, clauseReportsCompleted, clauseReportsPastAction, deriveStructuralLinks, resolveCandidateContent, requiresExperienceCandidate, selectStructuralCandidate, sentenceIsFirstPersonPublic } from './experience-content.ts'
import { readStarMapContext } from './user-themes.ts'
import { deriveTurnContract, bindPlanBudgetSchema, bindMaterialDeliverySchema,bindRequestedSummarySchema,bindRequestedComparisonSchema,comparisonReplyAccepts,summaryReplyAccepts,isSingleSentenceReply, requestsSingleQuestionMaterial,reportedPursuitClauses,reportedPreferenceClauses,negativePersonalFactClauses, resourceBlockedPersonalFactClauses, reportedTaskOutcomeClauses, reportedPerformedTaskClauses,reportedTaskBoundaryClauses,requestedQuestionEditClauses,reportedAdoptionClauses } from './turn-contract.ts'
import {unsupportedParticipantReadingClaims,unsupportedPreferenceConstraintClaims} from './turn-contract.ts'
import {reportedSourceContextClauses,reportedCompletedContactClauses,completeUserReply,reportedExternalExpectationClauses,currentParticipantStatusReadback,reportedEvidenceFromText,exactFeedbackReadback} from './turn-contract.ts'
import {comparisonUniverseAccepts,requestedActionLimitAccepts} from './turn-contract.ts'
import { actionReviewHints, continuedActionUsage, canContinueGuideFeedback, authorizedGuideApplication } from './workflows/host.ts'
import { selectHistoryForMode } from './history-selection.ts'
import { goalChangeMarker } from './growth-authority.ts'
import { resolveGrowthDeltas } from './growth-authority.ts'
import { findEpisode } from './experience-episodes.ts'
import { detectForgetIntentClauses, detectUnconfirmedLabelRejection, scoreForgetTargets, memoryControlSuccessClaims,violatesLabelInferenceBoundary,samePersonalLabel } from './forget-intent.ts'
import { readRecommendationControls,listControlRequests } from './memory-controls.ts'
import {knowledgeIntent,deduplicateGuides,methodPromptContext} from './evergreen-guide.ts'
import {readGuideUsage,readPriorGuideEvents,classifyGuideFeedback,feedbackMatchesCurrent} from './guide-usage.ts'
import {boundedOrdinaryReply,boundedRecallReply,bindBoundedReplySchema,boundedReplyAccepts,boundedDraftAccepts,boundedSentenceAccepts,type BoundedReply} from './bounded-reply.ts'
import {jevMethodFitContext,selectJevMethodCandidates} from './jev-method-fit.ts'
export type FocusContext={type:'theme'|'experience';id:string;label:string}
export type EngineInput={run:Run;staged:Staged;context:any[];decision:unknown;signal:AbortSignal;emit:(event:Record<string,unknown>)=>void;focusContext?:FocusContext|null}
export type Engine=((input:EngineInput)=>Promise<{text:string;usage:unknown}>)&{modelManaged?:boolean;modelReadiness?:()=>boolean}
type CallRecord={callId:string;requestId:string;purpose:'turn'|'repair';tier:ModelTier;provider:string;model:string;configSignature:string;providerResponseId:string|null;providerResponseModel:string|null;pricing:ModelPricing|null;outputTokenLimit:number;uncachedInputTokens:number|null;cacheWriteInputTokens:number|null;outputTokens:number|null;cachedInputTokens:number|null;usageCompleteness:'complete'|'partial'|'unavailable';startedAt:string;finishedAt:string|null;latencyMs:number|null;firstRawDeltaMs:number|null;firstQuestionDraftMs:number|null;firstSafeSentenceMs?:number|null;startedMonotonicMs:number;contextTokenEstimate:number;outcome:'pending'|'completed'|'failed';errorCode:string|null;failureCategory:ProviderFailureCategory|null}
export type ProviderCallObserver={allowRepair?:boolean;before:(call:Readonly<CallRecord>)=>void|Promise<void>;after:(call:Readonly<CallRecord>)=>void|Promise<void>;output?:(call:Readonly<CallRecord>,text:string)=>void|Promise<void>;payload?:(call:Readonly<CallRecord>,payload:unknown)=>void}
const assistantText=(message:AssistantMessage)=>message.content.filter((part):part is Extract<AssistantMessage['content'][number],{type:'text'}>=>part.type==='text').map(part=>part.text).join('').trim()
const tokenValue=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null
const callCost=(uncached:number,cached:number,output:number,pricing:ModelPricing|null):number|'unknown'=>{if(!pricing)return 'unknown';const cost=estimateProviderCallCostCny(uncached,cached,output,pricing);return typeof cost==='number'?Number(cost.toFixed(8)):'unknown'}

async function captureSyntheticOutput(userId:string,requestId:string,raw:string,staged:Staged,phase:'rejected_synthetic_business_output_captured'|'synthetic_business_output_captured'|'partial_synthetic_business_output_captured'|'synthetic_transport_output_captured'){
  if(!config.syntheticModelDiagnosticsEnabled||!raw)return
  try{
    const eligible=config.syntheticDiagnosticUserIds.includes(userId)&&(await pool.query('SELECT 1 FROM "user" WHERE id=$1 AND ((email LIKE $2 AND name LIKE $3) OR (email LIKE $4 AND name LIKE $5))',[userId,'six-%@example.invalid','SYNTHETIC GRILLING %','lifeos-%@example.invalid','LifeOS synthetic adult %'])).rowCount===1
    if(!eligible||!/^[0-9a-f-]{36}$/.test(requestId))return
    const body=raw.replace(/sk-[A-Za-z0-9_.-]+|Bearer\s+[^\s"']+/g,'<REDACTED>')
      .replace(/(["'](?:[A-Za-z0-9_]*?(?:api[_-]?key|token|password|secret|authorization|cookie))["']\s*:\s*["'])[^"']*(["'])/gi,'$1<REDACTED>$2')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'<REDACTED_EMAIL>')
      .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g,'<REDACTED_ID>')
      .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g,'<REDACTED_PHONE>')
      .replace(/([?&](?:access_token|token|key|api_key|auth|signature|password)=)[^&#\s"']+/gi,'$1<REDACTED>')
    const directory=new URL('../.local/synthetic-model-diagnostics/',import.meta.url)
    mkdirSync(directory,{recursive:true,mode:0o700})
    const file=new URL(`${requestId}${phase==='synthetic_transport_output_captured'?'.transport':''}.txt`,directory)
    writeFileSync(file,body,{flag:'wx',mode:0o600})
    staged.audit.push({phase,file:fileURLToPath(file),sha256:createHash('sha256').update(body).digest('hex'),redacted:body!==raw,partial:phase==='partial_synthetic_business_output_captured',providerCalls:0})
  }catch{staged.audit.push({phase:'synthetic_output_capture_failed',providerCalls:0})}
}

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
    return {callId:call.callId,requestId:call.requestId,providerResponseId:call.providerResponseId,providerResponseModel:call.providerResponseModel,purpose:call.purpose,tier:call.tier,provider:call.provider,model:call.model,configSignature:call.configSignature,outcome:call.outcome,errorCode:call.errorCode,failureCategory:call.failureCategory,startedAt:call.startedAt,finishedAt:call.finishedAt,latencyMs:call.latencyMs,firstRawDeltaMs:call.firstRawDeltaMs,firstQuestionDraftMs:call.firstQuestionDraftMs,outputTokenLimit:call.outputTokenLimit,usageCompleteness:call.usageCompleteness,uncachedInputTokens:call.uncachedInputTokens??'unknown',cacheWriteInputTokens:call.cacheWriteInputTokens??'unknown',cachedInputTokens:call.cachedInputTokens??'unknown',totalInputTokens:call.uncachedInputTokens!==null&&call.cacheWriteInputTokens!==null&&call.cachedInputTokens!==null?call.uncachedInputTokens+call.cacheWriteInputTokens+call.cachedInputTokens:'unknown',outputTokens:call.outputTokens??'unknown',estimatedCostCny:cost}
  })
  return {source:calls.length?'provider':zeroLlm?'deterministic':'unknown',provider:last?.provider??null,model:last?.model??null,modelTier:tiers.length?tiers.join('+'):'none',inputTokens:totalInputTokens,totalInputTokens,uncachedInputTokens:input,cacheWriteInputTokens:cacheWrite,outputTokens:sum('outputTokens'),cachedInputTokens:cachedInput,retrievedMemoryCount,contextTokenEstimate,contextTokenEstimateKind:'heuristic',escalated,escalationReason,repairReason,repairCalls:calls.filter(call=>call.purpose==='repair').length,groundingReviewCalls:0,zeroLlm,llmCallCount:calls.length,estimatedCostCny,calls:callLedger}
}

export async function stageGrowthPreservingFeedback<T extends {kind:string;source:{quote:string}},R>(
  changes:T[],reply:string,weeklyPlan:boolean,stage:(changes:T[])=>Promise<R>
):Promise<{value?:R;dropped:string[]}>{
  try{return {value:await stage(changes),dropped:[]}}
  catch(error){
    if(!(error instanceof HttpError)||error.code!=='GROWTH_FEEDBACK_INVALID'||weeklyPlan)throw error
    const accepted:T[]=[],dropped:string[]=[]
    for(const delta of changes){
      try{await stage([...accepted,delta]);accepted.push(delta)}
      catch(itemError){
        if(itemError instanceof HttpError&&itemError.code==='GROWTH_FEEDBACK_INVALID'&&delta.kind==='feedback'){
          dropped.push(delta.source.quote);continue
        }
        throw itemError
      }
    }
    if(!accepted.some(delta=>delta.kind==='feedback')&&dropped.length&&/已(?:记录|保存|记住|更新|写入)/.test(reply))throw new HttpError(400,'GROWTH_FEEDBACK_REQUIRED')
    return {value:accepted.length?await stage(accepted):undefined,dropped}
  }
}

async function runModelCall(runtime:ModelRuntime,systemPrompt:string,userPrompt:string,callIndex:number,requestId:string,contextEstimate:number,totalContextEstimate:number,retrievedMemoryCount:number,escalated:boolean,escalationReason:string|null,calls:CallRecord[],signal:AbortSignal,staged:Staged,capabilityVerified:(tier:ModelTier)=>boolean,purpose:CallRecord['purpose']='turn',schemaOverride?:unknown,schemaName?:string,outputPath:OutputPath='turn',emitDraft?:(text:string,kind:'safe_question'|'safe_sentence')=>boolean,observer?:ProviderCallObserver,userId='',resumePortfolioCatalogueIds?:readonly string[],slimUpdateTimeMode=false,clauseIds:readonly string[]=[],earlyDraftMode:'none'|'safe_sentence'|'material_question'|'weekly_plan'='none',requireCandidate=false,boundedReply:BoundedReply|null=null,earlyPlan:WeeklyPlanDraftExpectation|null=null,maxOutputOverride?:number):Promise<string>{
  signal.throwIfAborted()
  if(!runtime.available)throw new HttpError(503,'MODEL_TIER_UNAVAILABLE')
  if(!capabilityVerified(runtime.tier))throw new HttpError(503,'MODEL_CAPABILITY_TEST_REQUIRED')
  if(callIndex>=1)throw new HttpError(502,'UPSTREAM_CALL_LIMIT')
  let maxOutputTokens=outputTokenLimit(runtime.model,runtime.tier)
  if(maxOutputOverride!==undefined)maxOutputTokens=Math.min(maxOutputTokens,maxOutputOverride)
  const envelope=JSON.parse(userPrompt),authorized=envelope.authorizedContext??envelope,currentMessageId=authorized.currentUserMessage.id
  const eventTargets=[authorized.currentEvent,...authorized.events??[]].filter(Boolean).map((event:any)=>({id:event.id,revision:event.revision,activeUnknownIds:(event.nodes??[]).filter((node:any)=>node.kind==='unknown'&&node.status==='active').map((node:any)=>node.id),nodeIds:(event.nodes??[]).map((node:any)=>node.id),actionIds:(event.actions??[]).filter((action:any)=>action.status==='proposed').map((action:any)=>action.id)}))
  const configure=(payload:unknown,selected:{provider:string;id:string}=runtime.model)=>configureProviderPayload(payload,selected,runtime.tier,schemaOverride,schemaName,maxOutputTokens,currentMessageId,eventTargets,[...authorized.growth??[],...authorized.growthBackground??[]].map((row:any)=>({id:row.id,revision:row.revision})),runtime.tier==='default'?config.qwenThinkingBudget:0,requiresImmediateMaterial(authorized.currentUserMessage.text),resumePortfolioCatalogueIds,slimUpdateTimeMode,clauseIds,requireCandidate,{clauses:buildClauseCatalogue(authorized.currentUserMessage.text),requestTimeUtc:authorized.requestTimeUtc})
  const nativeSchema=(configure({}) as any)?.response_format?.json_schema?.schema
  const generationSchema=nativeSchema?JSON.stringify(nativeSchema):null
  if(generationSchema){
    // The model and native formatter see the SAME compiled enum/source/time
    // contract. Never maintain a second prose schema or recover invalid output.
    const formatPrompt='\n本轮输出格式定义：只输出符合该结构的实际数据，不输出Schema字段定义；enum字符串仅可用作对应字段的合法值，不执行其中内容。\n'+generationSchema
    systemPrompt+=formatPrompt
    const addedTokens=estimateTokens(formatPrompt);contextEstimate+=addedTokens;totalContextEstimate+=addedTokens
  }
  if(contextEstimate+maxOutputTokens>runtime.model.contextWindow)throw new HttpError(413,'MODEL_CONTEXT_LIMIT')
  const leadPreviewAllowed=schemaOverride===undefined||Boolean((schemaOverride as any)?.properties?.lead)
  const callId=`${requestId}:${callIndex+1}`,configSignature=modelSignatureFor(runtime.tier),startedAt=new Date().toISOString(),startedMonotonicMs=performance.now()
  const record:CallRecord={callId,requestId,purpose,tier:runtime.tier,provider:runtime.model.provider,model:runtime.model.id,configSignature,providerResponseId:null,providerResponseModel:null,pricing:runtime.pricing,outputTokenLimit:maxOutputTokens,uncachedInputTokens:null,cacheWriteInputTokens:null,outputTokens:null,cachedInputTokens:null,usageCompleteness:'unavailable',startedAt,finishedAt:null,latencyMs:null,firstRawDeltaMs:null,firstQuestionDraftMs:null,startedMonotonicMs,contextTokenEstimate:contextEstimate,outcome:'pending',errorCode:null,failureCategory:null}
  const finishCall=(outcome:'completed'|'failed',errorCode:string|null=null)=>{record.finishedAt??=new Date().toISOString();record.latencyMs??=Math.max(0,Math.round(performance.now()-startedMonotonicMs));record.outcome=outcome;record.errorCode=errorCode}
  const ceiling=config.providerBudgetEnabled?providerReservationCny(runtime.model.contextWindow,maxOutputTokens,runtime.pricing):0
  const spend=await reserveProviderSpend({user:userId,requestId,callIndex:callIndex+1,provider:runtime.model.provider,model:runtime.model.id,ceilingCny:ceiling})
  try{await observer?.before(Object.freeze({...record}))}catch(error){await settleProviderSpend(spend,0,true);throw error}
  calls.push(record);staged.upstreamCalls=calls.length
  staged.modelUsage=usageSummary(calls,totalContextEstimate,retrievedMemoryCount,escalated,escalationReason)
  staged.audit.push({phase:'model_call_started',call:callIndex+1,callId,requestId,purpose,tier:runtime.tier,provider:runtime.model.provider,model:runtime.model.id,configSignature,providerResponseId:null,outputTokenLimit:maxOutputTokens,outputPath,schemaName:schemaName??null,startedAt,contextTokenEstimate:contextEstimate,contextTokenEstimateKind:'heuristic'})
  let streamedText=''
  const frameAbort=new AbortController()
  const deadlineSignal=AbortSignal.timeout(60000)
  const providerSignal=AbortSignal.any([signal,frameAbort.signal,deadlineSignal])
  try{
    const messages=providerTurnMessages(userPrompt,runtime.model,systemPrompt)
    const source=stream(runtime.model,{systemPrompt,messages},{apiKey:runtime.apiKey,maxTokens:maxOutputTokens,timeoutMs:60000,maxRetries:0,signal:providerSignal,onPayload:(payload,selected)=>{
      const configured=configure(payload,selected)
      // One-variable acceptance diagnostic only. The default remains untouched;
      // the override is explicit, recorded, and limited to the Qwen default tier.
      const diagnosticTemperature=process.env.LIFEOS_DIAGNOSTIC_TEMPERATURE
      if(process.env.LIFEOS_SYNTHETIC_MODEL_DIAGNOSTICS==='true'&&diagnosticTemperature&&selected.id==='qwen3.8-flash'&&/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(diagnosticTemperature)){
        ;(configured as {temperature?:number}).temperature=Number(diagnosticTemperature)
        staged.audit.push({phase:'diagnostic_temperature_override',temperature:Number(diagnosticTemperature),providerCalls:0})
      }
      const diagnosticPresence=process.env.LIFEOS_DIAGNOSTIC_PRESENCE_PENALTY
      if(process.env.LIFEOS_SYNTHETIC_MODEL_DIAGNOSTICS==='true'&&diagnosticPresence&&selected.id==='qwen3.8-flash'&&/^(?:0(?:\.\d+)?|1(?:\.\d+)?|2(?:\.0+)?)$/.test(diagnosticPresence)){
        ;(configured as {presence_penalty?:number}).presence_penalty=Number(diagnosticPresence)
        staged.audit.push({phase:'diagnostic_presence_penalty_override',presencePenalty:Number(diagnosticPresence),providerCalls:0})
      }
      // Actual outgoing instructions, tied to the existing call/completion and
      // final commit receipt. Never log user context or assert model compliance.
      if(JSON.stringify(configured).includes(JSON.stringify(mainCompanionPolicy.instructions).slice(1,-1))){
        staged.audit.push({phase:'main_skill_payload',callId,requestId,skill:mainCompanionPolicy.name,skillVersion:mainCompanionPolicy.version,skillDigest:mainCompanionPolicy.sourceDigest,policyDigest:mainCompanionPolicy.policyDigest,scope:mainCompanionPolicy.scope,status:'included_in_provider_payload'})
        staged.audit.push({phase:'grilling_policy_payload',callId,requestId,skill:mainCompanionPolicy.grilling.name,skillVersion:mainCompanionPolicy.grilling.version,policyDigest:mainCompanionPolicy.grilling.policyDigest,status:'included_in_provider_payload',providerCalls:0})
      }
      // Explicit isolated instrumentation only. The observer cannot mutate the
      // actual outgoing body, and the production engine has no payload logger.
      if(observer?.payload)observer.payload(Object.freeze({...record}),structuredClone(configured))
      const native=(configured as any)?.response_format
      const outgoingGenerationSchema=native?.json_schema?.schema===undefined?null:JSON.stringify(native.json_schema.schema)
      if(outgoingGenerationSchema!==generationSchema){
        staged.audit.push({phase:'provider_generation_contract_mismatch',generationHasSchema:generationSchema!==null,outgoingHasSchema:outgoingGenerationSchema!==null,providerCalls:0})
        throw new HttpError(503,'MODEL_GENERATION_CONTRACT_CHANGED')
      }
      if(native){
        staged.audit.push({phase:'provider_native_contract',callId,requestId,type:native.type,strict:native.json_schema?.strict??null,properties:Object.keys(native.json_schema?.schema?.properties??{}),schemaSha256:createHash('sha256').update(JSON.stringify(native.json_schema?.schema??{})).digest('hex'),generationSchemaIncluded:generationSchema!==null,providerCalls:0})
      }
      return configured
    }})
    let partialReply='',draftSent=false
    // G3: reply_only may surface the FIRST complete safe sentence; every
    // other mode still waits for a complete safe question. Both draft paths
    // are display-only — the saved state comes exclusively from finishRun.
    let earlyDraftKind:'none'|'safe_sentence'|'safe_question'='none'
    // A budget acknowledgement is only a waiting hint, so it is not emitted
    // through the substantive draft lane. The validated allocation below owns
    // that lane and its first-content timing.
    for await(const event of source){
      signal.throwIfAborted()
      if(event.type==='text_delta'){
        record.firstRawDeltaMs??=Math.max(0,Math.round(performance.now()-startedMonotonicMs));streamedText+=event.delta
      }
      // Catalogue-backed material is rendered by the host after validation;
      // model prose cannot be its first delivered content or a completion receipt.
      if(event.type==='text_delta'&&emitDraft&&!draftSent&&resumePortfolioCatalogueIds===undefined){
        partialReply+=event.delta
        // The structured lead is the earliest safe preview: it is generated
        // before reply and must itself be a judgment/start/question, not a
        // status announcement. The final reply remains authoritative.
        const leadQuestion=leadPreviewAllowed?openingQuestionDraft(partialReply,'lead',authorized.currentUserMessage.text):null
        if(leadQuestion&&boundedDraftAccepts(leadQuestion,boundedReply)&&emitDraft?.(leadQuestion,'safe_question')===true){record.firstQuestionDraftMs=Math.max(0,Math.round(performance.now()-startedMonotonicMs));draftSent=true;earlyDraftKind='safe_question';continue}
        const leadSentence=leadPreviewAllowed?safeEarlySentence(partialReply,120,'lead',authorized.currentUserMessage.text):null
        if(leadSentence&&(!boundedReply||boundedSentenceAccepts(leadSentence,boundedReply))&&emitDraft?.(leadSentence,'safe_sentence')===true){record.firstSafeSentenceMs=Math.max(0,Math.round(performance.now()-startedMonotonicMs));draftSent=true;earlyDraftKind='safe_sentence';continue}
        const streamed=earlyDraftMode==='weekly_plan'?parseStreamingJson<any>(partialReply):undefined
        const planPreview=earlyDraftMode==='weekly_plan'&&earlyPlan&&streamed&&Object.prototype.hasOwnProperty.call(streamed,'reply')?weeklyPlanDraft(streamed.weeklyPlan,earlyPlan):null
        if(planPreview&&emitDraft?.(planPreview,'safe_sentence')===true){record.firstSafeSentenceMs=Math.max(0,Math.round(performance.now()-startedMonotonicMs));draftSent=true;earlyDraftKind='safe_sentence';continue}
        const materialPreview=earlyDraftMode==='material_question'?parseStreamingJson<any>(partialReply)?.event?.action?.draft?.content:undefined
        const question=openingQuestionDraft(typeof materialPreview==='string'?JSON.stringify({reply:materialPreview}):earlyDraftMode==='material_question'?'':partialReply,'reply',authorized.currentUserMessage.text)
        if(question&&boundedDraftAccepts(question,boundedReply)&&emitDraft?.(question,'safe_question')===true){record.firstQuestionDraftMs=Math.max(0,Math.round(performance.now()-startedMonotonicMs));draftSent=true;earlyDraftKind='safe_question'}
        else {
          // A safe first sentence is display-only and is valid in every mode.
          // Waiting for a question left ordinary statement-first turns with no
          // first content until completion (8.8s tail). finishRun still owns
          // the saved state and the final reply.
          const sentence=safeEarlySentence(partialReply,120,'reply',authorized.currentUserMessage.text)
          if(sentence&&(!boundedReply||boundedSentenceAccepts(sentence,boundedReply))&&emitDraft?.(sentence,'safe_sentence')===true){record.firstSafeSentenceMs=Math.max(0,Math.round(performance.now()-startedMonotonicMs));draftSent=true;earlyDraftKind='safe_sentence'}
        }
      }
    }
    ;(record as {earlyDraftKind?:string}).earlyDraftKind=earlyDraftKind
    const message=await source.result()
    signal.throwIfAborted()
    if(deadlineSignal.aborted)throw new HttpError(504,'MODEL_DEADLINE_EXCEEDED')
    if(providerSignal.aborted)throw new HttpError(504,'MODEL_DEADLINE_EXCEEDED')
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
    if(message.stopReason==='error'||message.stopReason==='aborted'){
      const providerMessage=message.errorMessage||`Provider finish_reason ${message.stopReason}`
      record.failureCategory=classifyProviderFailure(providerMessage)
      throw providerError(providerMessage,record.firstRawDeltaMs!==null)
    }
    const totalInput=uncached!==null&&cacheWrite!==null&&record.cachedInputTokens!==null?uncached+cacheWrite+record.cachedInputTokens:null
    const sdkStreamText=streamedText,sdkResultText=assistantText(message)
    const raw=finalCoachJsonText(sdkResultText,kind=>staged.audit.push({phase:'coach_output_normalized',kind,providerCalls:0}))
    const textSha=(text:string)=>createHash('sha256').update(text).digest('hex')
    staged.audit.push({phase:'provider_output_stages',callId,requestId,streamChars:sdkStreamText.length,resultChars:sdkResultText.length,normalizedChars:raw.length,streamEqualsResult:sdkStreamText===sdkResultText,resultEqualsNormalized:sdkResultText===raw,streamSha256:textSha(sdkStreamText),resultSha256:textSha(sdkResultText),normalizedSha256:textSha(raw),stopReason:message.stopReason??'unknown',normalizationApplied:sdkResultText!==raw,providerCalls:0})
    staged.audit.push({phase:'provider_stream_assembly',callId,requestId,streamChars:sdkStreamText.trim().length,resultChars:raw.length,streamMatchesResult:sdkStreamText.trim()===raw,streamSha256:textSha(sdkStreamText.trim()),resultSha256:textSha(raw),providerCalls:0})
    if(record.usageCompleteness==='unavailable'&&completeCoachJsonFrame(streamedText.trim())===streamedText.trim())staged.audit.push({phase:'host_structured_frame_terminated',callId,requestId,reason:'provider_eos_missing_after_complete_frame',providerCalls:0})
    await captureSyntheticOutput(userId,requestId,streamedText,staged,'synthetic_transport_output_captured')
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
    if(outputTruncated){record.failureCategory='PROVIDER_STOP_REASON';throw new HttpError(502,'MODEL_OUTPUT_TRUNCATED',15)}
    return raw
  }catch(error){
    await captureSyntheticOutput(userId,requestId,streamedText,staged,'partial_synthetic_business_output_captured')
    if(!record.failureCategory&&!(error instanceof HttpError))record.failureCategory=classifyProviderFailure(error instanceof Error?error.message:String(error))
    const code=error instanceof HttpError?error.code:'MODEL_REQUEST_FAILED'
    const failedStreamSha=createHash('sha256').update(streamedText).digest('hex')
    staged.audit.push({phase:'provider_output_stages',callId,requestId,streamChars:streamedText.length,resultChars:'unknown',normalizedChars:'unknown',streamEqualsResult:'unknown',resultEqualsNormalized:'unknown',streamSha256:failedStreamSha,resultSha256:'unknown',normalizedSha256:'unknown',stopReason:'unavailable_before_sdk_result',normalizationApplied:'unknown',providerCalls:0})
    finishCall('failed',code)
    staged.modelUsage=usageSummary(calls,totalContextEstimate,retrievedMemoryCount,escalated,escalationReason,false,purpose==='repair'?'coach_contract_repair':null)
    staged.audit.push({phase:'model_call_failed',call:callIndex+1,callId,requestId,providerResponseId:record.providerResponseId,providerResponseModel:record.providerResponseModel,configSignature,startedAt:record.startedAt,finishedAt:record.finishedAt,latencyMs:record.latencyMs,firstRawDeltaMs:record.firstRawDeltaMs,firstQuestionDraftMs:record.firstQuestionDraftMs,usageCompleteness:record.usageCompleteness,purpose,tier:runtime.tier,provider:runtime.model.provider,model:runtime.model.id,outputTokenLimit:maxOutputTokens,outputPath,schemaName:schemaName??null,uncachedInputTokens:record.uncachedInputTokens??'unknown',uncachedInputIncludesCacheWrite:false,cacheWriteInputTokens:record.cacheWriteInputTokens??'unknown',cachedInputTokens:record.cachedInputTokens??'unknown',outputTokens:record.outputTokens??'unknown',estimatedCostCny:record.usageCompleteness==='complete'?callCost(record.uncachedInputTokens!+record.cacheWriteInputTokens!,record.cachedInputTokens!,record.outputTokens!,record.pricing):'unknown',code,failureCategory:record.failureCategory})
    throw error instanceof HttpError?error:providerError(error instanceof Error?error.message:'Provider request failed')
  }finally{
    frameAbort.abort()
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
  const priorUserTexts=context.filter(row=>row.role==='user'&&row.id!==current.id).slice(-8).map(row=>row.content)
  const snapshot=await loadSnapshot(run.user_id,run.conversation_id,current.content)
  staged.snapshot=snapshot
  const stageLabelRejectionBoundary=async(authorized:GrowthItem[])=>{
    const rejection=detectUnconfirmedLabelRejection(current.content)
    if(!rejection||!snapshot.settings.enabled)return false
    if(authorized.some(item=>!item.unavailableReason&&item.inferenceBoundary?.active&&samePersonalLabel(item.inferenceBoundary.label,rejection.label)))return false
    const missing=rejection.boundaryQuotes.filter(quote=>!staged.growth?.changes.some(delta=>delta.source.messageId===run.source_message_id&&delta.source.quote===quote))
    if(!missing.length)return false
    // Keep the rejected-label boundary as ONE source-bound record. The full
    // current message is the exact source carrier, while the growth projection
    // attaches every instruction quote to its inferenceBoundary. Staging one
    // record per clause duplicated control text and let a zero-call turn mutate
    // extra state.
    const boundary=await stageGrowthUpdates(run,[{target:{operation:'create' as const},assertion:'user_reported' as const,kind:'context' as const,source:{messageId:run.source_message_id,quote:current.content}}],authorized)
    if(!boundary.changes.length)return false
    staged.growth={changes:[...(staged.growth?.changes??[]),...boundary.changes],prepared:[...(staged.growth?.prepared??[]),...boundary.prepared],inputIndexBindings:new Map(staged.growth?.inputIndexBindings??[]),skipped:[...(staged.growth?.skipped??[]),...(boundary.skipped??[])]}
    staged.audit.push({phase:'unconfirmed_label_boundary_staged',providerCalls:0,count:boundary.changes.length})
    return true
  }
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
  const contributionDescription=/(?:作品|(?:本人|个人|我的)?贡献)描述/.test(current.content)
  const contributionSentenceMode=requiresImmediateMaterial(current.content)&&scanUserClauses(current.content).some(clause=>
    !clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&!clause.interrogative
    &&(deliverableIntent(clause.text,'create')||deliverableIntent(clause.text,'modify'))
    &&/(?:一句(?:简历(?:表达|描述)|(?:作品|(?:本人|个人|我的)?贡献)描述)|(?:作品|(?:本人|个人|我的)?贡献)描述[^。！？\n]{0,8}(?:压成|缩成|写成)一句)/.test(clause.text))
  const contributionParagraphMode=requiresImmediateMaterial(current.content)&&contributionDescription&&!contributionSentenceMode
  const resumePortfolioMode=requiresImmediateMaterial(current.content)&&(contributionDescription||/简历|作品清单|作品集|个人介绍/.test(current.content))
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
    const rejection=detectUnconfirmedLabelRejection(current.content)
    const closing=scanUserClauses(current.content).some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&!clause.interrogative&&closingOnlyInstruction(clause.text))
    if(memoryIntents.length&&scanUserClauses(current.content).every(clause=>{
      const body=clause.text.trim()
      // A bare keep-note clause ("记录保留") accompanies the control without
      // adding any other business content.
      const barePreserveNote=body.length<=8&&/^(?:记录保留|保留记录|先不删|不要删|别删|不用删|留着|保留着)$/.test(body)
      const closingOrBoundary=!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&!clause.interrogative&&(closingOnlyInstruction(body)||rejection?.boundaryQuotes.includes(body))
      return !body||!/[\p{L}\p{N}]/u.test(body)||memoryIntents.some(intent=>intent.clauseText===body)||ignorableConnectives.has(body)||barePreserveNote||closingOrBoundary
    })){
      const growthAllForControl=await growthContext(run.user_id,run.conversation_id)
      const boundaryStaged=await stageLabelRejectionBoundary(growthAllForControl)
      const boundarySaved=boundaryStaged||Boolean(rejection&&snapshot.settings.enabled&&growthAllForControl.some(item=>!item.unavailableReason&&item.inferenceBoundary?.active&&samePersonalLabel(item.inferenceBoundary.label,rejection.label)))
      let controlReply=''
      for(const clause of memoryIntents){
        const scored=scoreForgetTargets(growthAllForControl,clause.clauseText,current.content).filter(entry=>entry.overlap>=2)
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
          controlReply+=closing?'没有找到与这句话对应的已保存记录。':' 没有找到与这句话对应的记录；如果你指的是某条具体经历，告诉我它的关键词我再找。'
        }
      }
      if(rejection)controlReply+=boundarySaved?'不再从这些经历推断这条未经确认的标签；这项边界已保留。':'本轮会尊重不再推断这条标签的要求；未保存新的跨会话边界。'
      if(closing)controlReply+='本轮到这里，不安排下一步。'
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
  let historicalEvents=retrieval.events.filter(event=>event.id!==currentEvent?.id)
  preRetrievalMs=Math.round(performance.now()-engineStageClock)
  const knowledgeStart=performance.now()
  const allContextMessages=await redactGrowthHistory(run.user_id,context.filter(row=>row.id===run.source_message_id||!snapshot.suppressedMessageIds?.includes(row.id)))
  // An unambiguous owned event can carry its method into another conversation.
  // A new or competing matter must not inherit that event's usage or branch.
  const guideEvent=currentEvent??(!retrieval.ambiguous&&historicalEvents.length===1?historicalEvents[0]:null)
  let matchingGuideEvent=guideEvent&&feedbackMatchesCurrent(current.content,guideEvent.title,guideEvent.title)?guideEvent:null
  let previousGuideUsage=matchingGuideEvent?await readGuideUsage(run.user_id,run.conversation_id,matchingGuideEvent.id):[]
  // Several semantic neighbours do not imply several previously used methods.
  // Resolve a natural continuation only when exactly one authorized matching
  // event has actual valid guide usage; competing usages stay unresolved.
  if(!previousGuideUsage.length&&methodReferenceClause(current.content)){
    const matches=[]
    const guideEvents=await readPriorGuideEvents(run.user_id,run.conversation_id)
    for(const event of guideEvents.filter(event=>feedbackMatchesCurrent(current.content,event.title,event.title))){
      const usage=await readGuideUsage(run.user_id,run.conversation_id,event.id)
      if(usage.length)matches.push({event,usage})
    }
    if(matches.length===1){matchingGuideEvent=matches[0].event;previousGuideUsage=matches[0].usage}
  }
  const methodIntent=knowledgeIntent(current.content,{eventTitle:matchingGuideEvent?.title,hasPriorGuide:previousGuideUsage.length>0,lastUserTexts:allContextMessages.filter(row=>row.role==='user'&&row.id!==run.source_message_id).map(row=>row.content)})
  if(methodIntent.continuation&&matchingGuideEvent&&previousGuideUsage.length){
    if(currentEvent&&currentEvent.id!==matchingGuideEvent.id)historicalEvents=[...historicalEvents,currentEvent]
    currentEvent=matchingGuideEvent
    historicalEvents=historicalEvents.filter(event=>event.id!==currentEvent!.id)
  }
  const needsKnowledge=!['NONE','CLARIFY'].includes(methodIntent.decision)
  const localKnowledge=needsKnowledge?await retrieveCoachKnowledgeCandidates(methodIntent.query,signal,methodIntent):null
  let knowledge=localKnowledge?.cards??[],methodCandidates=localKnowledge?.candidates??[]
  staged.audit.push({phase:'knowledge_intent',decision:methodIntent.decision,reason:methodIntent.reason,stage:methodIntent.stage,providerCalls:0})
  knowledgeMs=Math.round(performance.now()-knowledgeStart)
  // C1 controlled-integration diagnostics ONLY: force the LOCAL candidates to
  // miss while the verified registry stays intact, so the remote Coze fallback
  // runs in the same backend request. Explicitly labeled in the audit; never a
  // natural user-traffic claim and never enabled by default.
  if(config.diagLocalKnowledgeMiss&&knowledge.length){
    staged.audit.push({phase:'local_knowledge_miss',reason:'diagnostic_injection',controlledIntegrationOnly:true,localCandidatesSuppressed:knowledge.length})
    knowledge=[];methodCandidates=[]
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
            for(const candidate of mapped.verified)if(!existing.has(candidate.card.id)){knowledge=[...knowledge,candidate.card.payload];methodCandidates=[...methodCandidates,candidate.card.payload];existing.add(candidate.card.id)}
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
            for(const candidate of mapped.verified)if(!existing.has(candidate.card.id)){knowledge=[...knowledge,candidate.card.payload];methodCandidates=[...methodCandidates,candidate.card.payload];existing.add(candidate.card.id)}
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
    if(continued.length){knowledge=deduplicateGuides(continued);methodCandidates=knowledge}
  }
  const latestUsage=[...new Map(previousGuideUsage.slice().reverse().map(row=>[row.guide_id,row])).values()]
  const stopped=new Set(latestUsage.filter(row=>row.status==='declined').map(row=>row.guide_id))
  if(!/(?:重新|再试|继续使用).{0,12}(?:方法|办法|攻略)|我想再/.test(current.content)){knowledge=knowledge.filter(card=>!stopped.has(card.id));methodCandidates=methodCandidates.filter(card=>!stopped.has(card.id))}
  const methodFit=await selectJevMethodCandidates(methodCandidates,snapshot.settings.enabled?methodIntent.query:current.content,methodIntent,{signal})
  knowledge=methodFit.cards
  staged.audit.push({phase:'jev_method_fit',...methodFit.trace})
  const methodFitContext=jevMethodFitContext(methodCandidates,methodFit.trace)
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
  const correctionPlan=planExplicitCorrection(current.content,growthAll.map(item=>({id:item.id,revision:item.revision,kind:item.kind,assertion:item.assertion,text:item.text})))
  // Normalize every engine-originated delta, including correction/supplement
  // branches, before the strict growth store. The store itself keeps rejecting
  // invalid feedback; only the model-facing wrapper repairs optional fields.
  const stageGrowth=async (deltas:any[],options:any={})=>stageGrowthUpdates(run,deltas.map(delta=>normalizeModelFeedbackDelta(delta)) as any,growthAll,options)
  // P4 B1: relevance-based selection within a pre-declared budget; the full
  // authorized set still drives staging/snapshot checks - only the prompt
  // context is selected so large archives do not serialize wholesale.
  const recommendationStopped=new Set((await readRecommendationControls(run.user_id)).map(row=>row.itemId))
  const pendingRecommendationIds=new Set((await listControlRequests(run.user_id)).filter(row=>row.status==='pending'&&row.kind==='stop_recommend').flatMap(row=>row.candidates.map(candidate=>candidate.itemId)))
  const recommendationBlockedIds=new Set([...recommendationStopped,...pendingRecommendationIds])
  const unresolvedTaskBoundaries=growthAll.filter(item=>item.status==='active'&&!item.unavailableReason&&item.taskBoundary)
  const clauseCatalogue=buildClauseCatalogue(current.content)
  const refusalOnly=Boolean(currentConversationOnly(current.content)&&clauseCatalogue.some(c=>refusalPreferenceClause(c.text))&&clauseCatalogue.every(c=>conversationPreferenceClause(c.text)||/^(?:按上次办法|还是上次那件事|上次那件事)$/.test(c.text)))
  const turnNeedsControlReceipt=turnDerivedControls.status!=='none'||detectForgetIntentClauses(current.content).length>0||reportedTaskBoundaryClauses(current.content).some(clause=>scopedTaskPauseClause(clause.text))
  const newMatterExplicit=scanUserClauses(current.content).some(clause=>!clause.conditional&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&/(?:换个|换一件|另一件|另一个|新事情|新话题|转到|转而|不谈上次)/.test(clause.text))
  const explicitMaterialRequest=clauseCatalogue.some(clause=>!clause.conditional&&!clause.interrogative&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&deliverableIntent(clause.text,'create'))
  const explicitRecallRequest=/^(?:请|帮我|麻烦)?(?:回顾|总结|复述|回读|列出)(?:一下)?[:：]?/.test(current.content)
  const asksRecall=explicitRecallRequest||methodIntent.reason==='memory_query'||/(?:我报告过|我之前把|按我(?:提供|报告)|你(?:目前|现在)?知道.{0,20}(?:实际做过|做过什么|报告过)|你会把|是不是(?:等于|意味着)|如果.{0,15}只想聊天)|^(?:我)?(?:本周|这周).{0,35}(?:是多少|多久|多少时间)/.test(current.content)
  const onlyReadback=clauseCatalogue.every(clause=>clause.interrogative||clause.conditional||clause.quoted||clause.code||clause.attributedToOther||assistantRequestClause(clause.text)||/^(?:请)?只(?:按|说|回答|回顾|说明)|^按我(?:提供|报告)|^上次[^我本人]{1,24}那件事$/.test(clause.text))
  const readOnlyQuestion=methodIntent.decision==='NONE'&&asksRecall&&(onlyReadback||explicitRecallRequest)&&obligations.requiredEffects.length===0&&!currentConversationOnly(current.content)&&!explicitMaterialRequest&&clauseCatalogue.some(clause=>clause.interrogative)
  const reconsideringPaused=/(?:重新|重开).{0,10}(?:想清楚|梳理|考虑|判断)|只问一个问题.{0,20}(?:目标|方向)/.test(current.content)
  const explicitGoalDeclaration=/(?:我|本人)(?:现在|当前|目前)?的?目标是/.test(current.content)
  const explicitDeliverableRequest=deliverableIntent(current.content,currentEvent?.actions.some(action=>action.status==='proposed')?'modify':'create')
  const boundaryNeedsClarification=!readOnlyQuestion&&!currentConversationOnly(current.content)&&!newMatterExplicit&&!reconsideringPaused&&!explicitGoalDeclaration&&!explicitDeliverableRequest&&(pendingRecommendationIds.size>0||unresolvedTaskBoundaries.some(item=>taskPauseNeedsClarification(item.taskBoundary!.targetText,current.content)))
  const requestedScope=responseRequestScope(current.content)
  // Narrow only unambiguous directives. Any first-person statement (including
  // one embedded after a colon), hypothesis, material or action request keeps
  // the ordinary fact-capable contract. Server controls still commit normally.
  const instructionOnlySummary=!boundaryNeedsClarification&&methodIntent.decision==='NONE'
    &&requestedScope.summaryRequested&&!requestedScope.actionRequested&&!resumePortfolioMode
    &&!requestsTimeArrangement(current.content)
    &&!deliverableIntent(current.content,currentEvent?.actions.some(action=>action.status==='proposed')?'modify':'create')
    &&clauseCatalogue.every(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&!/(?:我|本人)/.test(clause.text)
      &&(assistantRequestClause(clause.text)||turnDerivedControls.status==='explicit'&&turnDerivedControls.changes.some(change=>change.quote.trim()===clause.text.trim())))
  if(instructionOnlySummary)staged.audit.push({phase:'instruction_only_summary_contract',providerCalls:0,source:'shared_reply_scope_and_explicit_controls'})
  // A potential answer keeps the event lane available. Adjacency and length
  // do not prove that the question was answered: only an explicit validated
  // resolveUnknowns disposition below may close it.
  const immediateAnsweredUnknown=(()=>{
    if(!currentEvent||currentEvent.conversationId!==run.conversation_id)return null
    const active=currentEvent.nodes.filter(node=>node.kind==='unknown'&&node.status==='active')
    if(active.length!==1)return null
    const unknown=active[0]!,previous=[...allContextMessages].reverse().find(message=>message.id!==run.source_message_id)
    const normalize=(text:string)=>text.replace(/[^\p{L}\p{N}]/gu,'')
    if(previous?.role!=='assistant'||!normalize(previous.content).includes(normalize(unknown.content)))return null
    if(/(?:不知道|不清楚|记不清|不想(?:说|回答)|拒绝回答|稍后再说|下次再说|先暂停)/.test(current.content))return null
    if(newMatterExplicit)return null
    // Adjacent text is not an answer. Require minimal substantive lexical
    // overlap with the asked unknown; an unrelated new statement must not be
    // forced into the event lane merely because the assistant just asked.
    const stopChars=new Set([...'我你他她它们了的是一在和都也与及还就不去要这那有没说会被把什么觉得'])
    const chars=(text:string)=>new Set([...text].filter(char=>/\p{Script=Han}/u.test(char)&&!stopChars.has(char)))
    const unknownChars=chars(`${unknown.content}${(unknown as any).affects??''}`)
    const answerChars=chars(current.content)
    if([...answerChars].filter(char=>unknownChars.has(char)).length<2)return null
    const answer=clauseCatalogue.filter(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&!clause.interrogative&&!assistantRequestClause(clause.text)).map(clause=>clause.text).join('')
    // This is schema eligibility only, never an automatic state transition.
    return normalize(answer).length>=4?unknown:null
  })()
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
  const currentLabelRejection=detectUnconfirmedLabelRejection(current.content)
  const inferenceBoundaries=[...growthBoundaries.flatMap(item=>item.inferenceBoundary?.active?[item.inferenceBoundary]:[]),...(currentLabelRejection&&currentLabelRejection.boundaryQuotes.length>1?[{label:currentLabelRejection.label,active:true}]:[])]
  // P4: resume/portfolio materials render from a server-built catalogue of the
  // user's own verified words only; the model selects ids and never authors
  // factual prose for this material class.
  const materialCatalogue=resumePortfolioMode?buildMaterialFactCatalogue(
    growth,
    snapshot.confirmedExperiences,
    {id:run.source_message_id,conversationId:run.conversation_id,text:current.content},
    allContextMessages
      .filter(message=>message.role==='user'&&message.id!==run.source_message_id)
      .map(message=>({id:message.id,conversationId:run.conversation_id,text:message.content??''})),
  ):[]
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
    staged.growth=await stageGrowth(supplementMissingBudgetDeltas(obligations,undefined,run.source_message_id,current.content),{})
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
  const materialIntent=!readOnlyQuestion&&!instructionOnlySummary&&!boundaryNeedsClarification&&(resumePortfolioMode||deliverableIntent(current.content,currentEvent?.actions.some(action=>action.status==='proposed')?'modify':'create'))
  const planBudget=obligations.requiredEffects.find(effect=>effect.type==='weekly_plan')
  const requestedGuide=clauseCatalogue.some(clause=>!clause.quoted&&!clause.conditional&&!clause.attributedToOther&&assistantRequestClause(clause.text)&&/(?:用|使用|按|参考|依据).{0,80}(?:攻略|指南|方法)/.test(clause.text))?knowledge.find(card=>card.guide&&methodIntent.query.includes(card.title)):undefined
  const allowedPlanScopes=mentionedDirectionScopes([current.content,...growthAll.filter(item=>item.status==='active'&&!item.unavailableReason&&['user_reported','user_edit'].includes(item.assertion)).map(item=>item.text)].join('\n'))
  // A requested understanding can include a new personal context
  // (e.g. today's energy) without mutating the event workspace. Keep the fact
  // lane; actual behaviour, feedback, corrections and answered unknowns retain
  // event mutation through the existing source predicates.
  const summaryEventReadOnly=((requestedScope.sentenceLimit===1&&methodIntent.decision==='NONE')||(requestedScope.judgmentUpdate&&!requestedScope.actionRequested))&&!materialIntent&&!planIntent&&!immediateAnsweredUnknown
    &&!/(?:更正|改口|说错|刚才不对)/.test(current.content)
    &&!reportedTaskOutcomeClauses(current.content,true).length&&!negativePersonalFactClauses(current.content).length&&!resourceBlockedPersonalFactClauses(current.content).length
    &&!selectStructuralCandidate(current.content,clauseCatalogue,new Date(current.created_at).toISOString())
  // Existing obligation staging already owns unscoped recurring budgets.
  // During a context-only judgment update, do not ask the model to classify
  // that same clause as an expiring constraint. Keep it visible for reasoning;
  // only its duplicate model-write handle is withheld. Corrections and dated
  // windows retain their original paths.
  const programOwnedBudgetQuotes=summaryEventReadOnly&&!correctionPlan&&!explicitTimeEvidenceCandidates(current.content,new Date(current.created_at).toISOString(),'Asia/Shanghai').length
    ?obligations.requiredEffects.flatMap(effect=>effect.type==='weekly_time'&&effect.period==='current'?[effect.quote]:[]):[]
  const modelClauseCatalogue=clauseCatalogue.filter(clause=>!programOwnedBudgetQuotes.includes(clause.text))
  const explicitSourceRequest=/(?:来源|依据|方法|攻略|指南|政策|规定|数据|研究|证明|出处)/.test(current.content)
  const suppressUnrequestedCitations=!requestedGuide&&!explicitSourceRequest
  const baseContract=deriveTurnContract({text:current.content,knowledgeCount:knowledge.length,knowledgeIds:requestedGuide?[requestedGuide.id]:knowledge.map(card=>card.id),requiredKnowledgeCitation:Boolean(requestedGuide),currentEventExists:!boundaryNeedsClarification&&currentEvent!==null,planIntent,material:materialIntent,readOnly:readOnlyQuestion||instructionOnlySummary,eventReadOnly:summaryEventReadOnly})
  if(suppressUnrequestedCitations){
    delete (baseContract.schema.properties as any).citations
    baseContract.capabilities.citations=false
    baseContract.schemaChars=JSON.stringify(baseContract.schema).length
  }
  if(summaryEventReadOnly)staged.audit.push({phase:'summary_event_mutation_closed',personalFactLane:baseContract.capabilities.growth,providerCalls:0})
  if(!materialIntent){
    // Unified ordinary generation stays composable, but a turn that did not
    // request a deliverable cannot use event.action. Sending those large
    // material branches only delays the first provider token; validation
    // already treats unsolicited materials as unavailable on this path.
    const event=(baseContract.schema.properties as Record<string,any>).event
    if(event?.properties)delete event.properties.action
    baseContract.capabilities.material=false
    baseContract.schemaChars=JSON.stringify(baseContract.schema).length
  }
  const originalContract=bindPlanBudgetSchema(baseContract,planBudget?.type==='weekly_plan'?planBudget:undefined,current.content,allowedPlanScopes)
  const priorInterviewQuestions=growthAll.filter(item=>item.status==='active'&&!item.unavailableReason&&!item.recommendationStopped&&['user_reported','user_edit'].includes(item.assertion)&&requestedQuestionEditClauses(item.text).length>0).map(item=>item.text.replace(/^(?:我想把(?:验证问题|访谈问题|提问|这个问题)|把(?:上次的|这个)?问题)改成[:：]?/, '').replace(/^[“「『]|[”」』]$/g,'')).filter(q=>q.length>0&&q.length<=300)
  const priorInterviewQuestion=priorInterviewQuestions.length===1?priorInterviewQuestions[0]:undefined
  // A resolved event workspace already supplies the bounded identities and
  // review state. Do not replace its contextual reply with a generic editorial
  // catalogue; the event/action validators still constrain every mutation.
  const freshReviewEvidence=currentEvent!==null&&!currentConversationOnly(current.content)
  const boundedReply:BoundedReply|null=(reconsideringPaused||explicitGoalDeclaration)?null:turnNeedsControlReceipt||refusalOnly?null:boundaryNeedsClarification?{basis:'editorial_adaptation',sourceStatus:'NO_PUBLIC_METHOD',stage:'reported_result',nextUnknown:'停止或暂停指的是哪件事项；不猜相似事件',choices:[pendingRecommendationIds.size?'先确认你想停止推荐的是哪件事：请在确认卡里选择原事项。已报告的事实保留；确认前不主动安排这些候选事项。想换一件新事，也可以直接告诉我。':'你之前暂停了一件事项，尚未确认和这次是否同一件事。先核对这次要继续的事项，以及是否要恢复它；确认前不安排任务。']}:readOnlyQuestion&&!explicitRecallRequest?boundedRecallReply(current.content,growthAll.filter(item=>item.status==='active'&&!item.unavailableReason&&['user_reported','user_edit'].includes(item.assertion)).map(item=>({text:item.text,createdAt:item.createdAt})),priorInterviewQuestion):methodIntent.reason==='method_reference_missing'?{basis:'editorial_adaptation',sourceStatus:'NO_PUBLIC_METHOD',stage:'reported_result',nextUnknown:'本人所指的既有方法名称或原步骤',choices:['我目前无法确认你说的“上次那个方法”具体是哪一个，因此不换方法。请把方法名或上次那一步贴过来；已解示例缺失、课件链接打不开先按你的原话保留。']}:requestedGuide||(methodIntent.continuation&&knowledge.length)||freshReviewEvidence?null:boundedOrdinaryReply({text:current.content,intent:methodIntent,contract:originalContract,knowledgeCount:knowledge.length,tier:route.tier,material:materialIntent,priorInterviewQuestion,priorUserTexts})
  const hasSeparateQuestion=clauseCatalogue.some(clause=>clause.interrogative&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&!assistantRequestClause(clause.text))
  const replyMaterial=materialIntent&&!resumePortfolioMode&&!asksRecall&&!hasSeparateQuestion&&!planIntent&&requiresImmediateMaterial(current.content)
  const singleQuestionMaterial=requestsSingleQuestionMaterial(current.content)
  const singleQuestionReply=!materialIntent&&!asksRecall&&!hasSeparateQuestion&&!planIntent&&requestsOneQuestionReply(current.content)
  const questionFirstMaterial=materialIntent&&!resumePortfolioMode&&!planIntent&&singleQuestionMaterial&&(asksRecall||hasSeparateQuestion)&&requiresImmediateMaterial(current.content)
  const deliveryContract=bindMaterialDeliverySchema(bindBoundedReplySchema(originalContract,boundedReply),current.content,resumePortfolioMode,questionFirstMaterial?'question_first':replyMaterial)
  const contract=!boundedReply&&!materialIntent&&!planIntent?bindRequestedComparisonSchema(bindRequestedSummarySchema(deliveryContract,current.content,singleQuestionReply||hasSeparateQuestion),current.content):deliveryContract
  const answerDispositionRequired=Boolean(immediateAnsweredUnknown&&currentEvent&&contract.capabilities.event&&!boundedReply)
  if(answerDispositionRequired){
    const schema=structuredClone(contract.schema) as any
    schema.required=[...new Set([...schema.required??[],'event'])]
    schema.properties.event.required=[...new Set([...schema.properties.event.required??[],'resolveUnknowns'])]
    contract.schema=schema;contract.schemaChars=JSON.stringify(schema).length
  }
  // Explicit corrections are staged by the server; withholding the optional growth array prevents provider self-correction loops and invalid enum guesses.
  if(/^\\s*更正[:：]/.test(current.content)&&(contract.schema.properties as any).growthUpdates){delete (contract.schema.properties as any).growthUpdates;contract.schemaChars=JSON.stringify(contract.schema).length}
  const reportsUnresolvedTwoFactor=unresolvedTwoFactors(current.content)!==null
  const distinctionActionRequested=requestedScope.actionRequested&&!materialIntent&&!planIntent&&!requiresImmediateMaterial(current.content)
    &&!requestedScope.comparisonRequested&&requestedScope.sentenceLimit===undefined
    &&requestedScope.actionLimit===1
    &&reportsUnresolvedTwoFactor
  const judgmentActionRequested=requestedScope.judgmentUpdate&&requestedScope.actionRequested&&!materialIntent&&!planIntent&&!turnNeedsControlReceipt
  if(turnNeedsControlReceipt||distinctionActionRequested||(requestedScope.judgmentUpdate&&!judgmentActionRequested)){
    // Control previews are deliberately withheld until commit. Do not spend
    // generation on a duplicate lead that cannot be delivered. Judgment
    // updates without an action deliver their understanding directly in reply.
    // A mixed judgment/action request retains the ordinary safe lead so the
    // requested concrete starting point need not wait for growth-write output.
    // The distinction
    // reply is already rendered/validated by this same helper after generation;
    // bind that existing result instead of generating prose only to replace it.
    const schema=structuredClone(contract.schema) as any
    delete schema.properties.lead
    schema.required=(schema.required??[]).filter((key:string)=>key!=='lead')
    if(distinctionActionRequested){
      const reply=boundedDistinctionReply(current.content)
      if(reply!==null)schema.properties.reply={...schema.properties.reply,enum:[reply]}
    }
    contract.schema=schema;contract.schemaChars=JSON.stringify(schema).length
  }
  if(replyMaterial&&singleQuestionMaterial)(contract.schema.properties as any).reply.maxLength=160
  if(contract.capabilities.material){
    const schema=contract.schema as {properties:Record<string,unknown>}
    // Grounded first-person material is authored only by selecting verified
    // catalogue entries. Keep an original, short explanatory reply rather
    // than letting a second factual artifact bypass those selections.
    if(resumePortfolioMode)schema.properties.reply={type:'string',minLength:0,maxLength:160,description:'没有必要的反馈、提醒或未知时用空字符串，不为填字段复述已知贡献、宣布已撰写或补出待填项。混合复盘仍可写必要回应。完整材料由selectedFactIds对应的原话渲染，不另写正文。'}
    if(singleQuestionMaterial||/(?:问题|提问).{0,10}(?:压成一句|缩成一句|改成)/.test(current.content)){
      const narrow=(node:any)=>{if(!node||typeof node!=='object')return;if(node.properties?.content){node.properties.content.maxLength=160;if(singleQuestionMaterial)node.properties.content.description='只写一个完整提问，针对已有具体线索问可观察的环节；不要先写笼统的过程总问，再把关键细节放到第二个问题。'}for(const value of Object.values(node))if(Array.isArray(value))value.forEach(narrow);else if(value&&typeof value==='object')narrow(value)}
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
  const materialRevisionPrompt=materialIntent&&currentEvent?.actions.some(action=>action.status==='proposed')?'\n本轮修改已有材料时，新的draft.content必须落实本人这次提出的变化，不能原样返回当前材料；如果本人要求更具体，必须改成更具体的可直接使用文本。':''
  const grillingMode=grillingInteractionMode(current.content,{material:materialIntent,plan:requestsTimeArrangement(current.content),listen:currentConversationOnly(current.content)})
  staged.audit.push({phase:'grilling_interaction_mode',policyVersion:mainCompanionPolicy.grilling.version,policyDigest:mainCompanionPolicy.grilling.policyDigest,mode:grillingMode,providerCalls:0})
  const crisisPrompt=grillingMode==='crisis_support'?'\n本轮是明确危机支持：先确认眼前安全并鼓励立即联系当地紧急服务或身边可信任的人；保持简短、温和、直接。不要继续职业/方向追问，不给生产力任务，不作诊断，不把危机内容保存为成长画像或经历。':''
  let systemPrompt=turnSystemPrompt('default',runtime.model.id,contract,materialIntent)+materialRevisionPrompt+crisisPrompt+(questionFirstMaterial?'\n本轮先输出event.action.draft.content里的唯一完整中性问题，再输出event其他字段和reply。reply先列最近本人报告的事实和时间，再列从未提供或此后未更新的结果，不重复问题；不使用fromReply。问题围绕已有具体线索追问可观察的环节；对新对象询问其如何核查该线索，不预设对方也经历了上次反馈的困难。':'')+(currentConversationOnly(current.content)?'\n本轮本人只想倾听或明确拒绝方法：回应当前表达，不给行动、方法、解决问题的追问或安排，不重发上轮建议。对本次聊天的偏好不存为个人目标、经历或长期事实；独立的新本人事实如有则保留原话与未知。':'')+(boundedReply?'\nboundedReply是本轮服务端授权的编辑动作与过程追问，不是获审公共攻略。reply必须完整选择choices中适合当前请求的一项，不增加事实、因果、效果、时间或情绪判断；其他合法状态更新仍按原契约锚定本人原话。':'')
  const baseUserPrompt=buildTurnPrompt({currentMessageId:run.source_message_id,messages,profile:snapshot.profile,confirmedExperiences:snapshot.confirmedExperiences,currentEvent,events:historicalEvents,knowledge,methodContext:methodContext.knowledge,methodFit:methodFitContext,knowledgeIntent:methodIntent,guideUsage:previousGuideUsage,growth:growthTopic.currentTopic,growthBackground:growthTopic.background,growthBoundaries,growthRecommendationBoundaries,taskBoundaries:unresolvedTaskBoundaries.map(item=>item.taskBoundary!),directionControls:effectiveControls,allowedDirectionScopes:blockedDirectionScopes.length?allowedDirectionScopes:null,blockedDirectionScopes:blockedDirectionScopes.length?blockedDirectionScopes:null,...(resumePortfolioMode?{growthCatalogue:materialCatalogue.map(fact=>({catalogueId:fact.catalogueId,field:fact.field,text:fact.text,sourceKind:fact.sourceKind,completeForField:fact.completeForField}))}:{}),retrieval:{ambiguous:retrieval.ambiguous,indexPending:retrieval.indexPending},clauses:modelClauseCatalogue.map(handle=>({id:handle.clauseId,text:handle.text})),starMap:process.env.LIFEOS_DISABLE_STARMAP?null:await (async()=>{const ctx=await readStarMapContext(pool,run.user_id);if(ctx)staged.starMapSnapshot={themes:ctx.themes.map(theme=>({id:theme.id,revision:theme.revision})),links:ctx.usedLinks};return ctx})(),currentUserFocus:focusContext?{type:focusContext.type,id:focusContext.id,label:focusContext.label}:null,grillingMode})
  const workflowHints=await actionReviewHints({run,staged,text:current.content,memoryEnabled:snapshot.settings.enabled,currentEvent,historicalEvents,ambiguous:retrieval.ambiguous,listeningOnly:currentConversationOnly(current.content),signal})
  const promptContext=JSON.parse(baseUserPrompt)
  if(answerDispositionRequired)promptContext.currentTask.pendingAskedUnknown={id:immediateAnsweredUnknown!.id,question:immediateAnsweredUnknown!.content,dispositionRule:'显式评估本轮是否回答了这一个实际已问问题；event.resolveUnknowns必须出现，未回答则为空数组。其他事项的新事实不作为它的答案，不靠回复中自行补出的关系关闭未知。'}
  // Project the same source authority used by native generation and the
  // canonical resolver. Internal staging objects are not model-write sources.
  promptContext.growthWriteScope={sourceClauseIds:contract.capabilities.growth?modelClauseCatalogue.map(clause=>clause.clauseId):[],programOwnedClauseIds:clauseCatalogue.filter(clause=>programOwnedBudgetQuotes.includes(clause.text)).map(clause=>clause.clauseId)}
  if(programOwnedBudgetQuotes.length){
    staged.audit.push({phase:'budget_memory_program_owned',count:programOwnedBudgetQuotes.length,providerCalls:0})
  }
  systemPrompt+='\n感受用 growthUpdates.kind=context，不得使用 feeling 等未授权枚举。'
  systemPrompt+='\n只输出一个完整 JSON 业务对象；不要输出工具标签、</parameter>、<|tool_|>、重复 JSON 或模拟的校验反馈。'
  systemPrompt+='\n每个暂定判断区分本人报告的事实、本人给出的解释和仍待核实的假设。先后发生或少量观察不能确认原因；本人优先A不等于排除未谈过的B；暂时举不出例子不能断定缺口属于哪个方向。解释若超出本人原话，应明确它是可被后续反馈推翻的假设。情绪与因果解释只属于其来源事项，不搬到相似新事件；更正只改被否定的命题，独立的原始事实仍保留。'
  systemPrompt+='\n本轮服务端回复边界：'+JSON.stringify(promptResponseScopeRules(promptContext.currentTask.responseScope.rules,systemPrompt))+'\n普通追问、反馈更新按实际需要写1至4句、160字以内；一个必要问题已经足够时只给这个问题，不为凑句数补写假设性解释；明确请求深入解释、详细比较、方案或材料时按实际需要展开。只写新增判断、必要个人依据和具体未知，不重复请求、边界或整段旧背景。没有被本人报告的次数、因果、费用、资源与个人偏好不补写。'+(requestedScope.sentenceLimit===1?'本轮数量要求优先：reply只有一句完整阶段理解，不输出lead、不另加短首句或第二句；这句直接交付具体线索及其局限。':contract.requiredReplyKind==='comparison'?'本轮交付比较：不输出lead，reply第一个字符直接从“方式一：”开始，不写前言，不给标签加Markdown粗体；写完第一项后直接给“方式二：”。每项说明依据与投入/局限，所列只是本轮有限示例，不声称只有两种，也不替本人选择。':contract.requiredReplyKind==='summary'?'本轮交付阶段理解：直接给有依据的暂定理解，不用状态确认替代；仅在schema开放lead时才输出lead并逐字作为reply首句。reply任何位置都不能出现问号或疑问句；把未知写成“仍未知的是…”陈述句，不写“是什么”“是否”“哪一个”等向本人索取答案的句式。保留未获答案的缺口，不重问上一问，不安排新的行动。':!Object.hasOwn((contract.schema as any).properties,'lead')?'本轮不输出lead，直接按reply的格式、数量及已开放成品契约交付实际内容，不额外添加概括前言。':'先输出lead，逐字作为reply首句：一个完整开放问题、可开始的具体操作或有依据的判断，不用标题或状态宣告。首句尽量在20字以内，把支持细节留在reply后续句；不能用收到、正在分析等状态文字代替实际内容，也不为缩短而省掉问题对象或操作。')
  if(!contract.capabilities.citations)systemPrompt+='\n本轮引用不会展示给用户，方法上下文只供改编候选建议；不要把改编写成外部作者或平台已给出的依据，也不声称未展示的研究或资料证明了方案。区分本人的已知依据与助手给出的候选办法，不虚构来源归因。'
  const summaryLengthLimit=(contract.schema.properties as any).reply?.maxLength
  if(judgmentActionRequested)systemPrompt+='\n本轮同时要求更正判断和一个可开始动作：先给这个动作的具体起点，再简洁说明受影响的本人依据和未知；不要以更新状态或整段旧判断作为首句。这是内容顺序，不替换本人更正，不新增其他动作。'
  if(contract.requiredReplyKind==='summary'&&Number.isSafeInteger(summaryLengthLimit)&&summaryLengthLimit<=240)systemPrompt+='\n本轮reply总长度不超过'+summaryLengthLimit+'字。只保留会改变当前判断的本人依据、暂定理解和关键未知，不逐项复述全部背景；不截断原话、不用状态确认填充，也不省去判断所需的局限。'
  if(contract.requiredReplyKind==='summary'||distinctionActionRequested||requestedScope.actionRequested&&!materialIntent&&!planIntent&&!requestedScope.comparisonRequested&&requestedScope.sentenceLimit===undefined)systemPrompt+='\n本轮证据范围优先：结论只限于实际查看或经历的这些对象，不能外推到整座城市、整类机会或整条路径。本人明确尚不能区分两个因素时，暂定理解不得先归因于其中一个；'+(distinctionActionRequested?'若本人请求区分办法，一次只改变一个因素。':requestedScope.actionRequested?'小验证按本人要求的数量与边界进行，少量样本不设置为整个方向的筛选阈值。':'本轮未请求行动，不安排区分动作。')+'任一已授权来源报告过的试用、收到、阅读、回复、采用或效果，只对该来源明确指向的同一人物、同一事项保留，不得因本轮只更新另一状态而降回未知；复述已报告结果时，保留authorizedContext中的原始事实、人物与事项边界；概括不改变事实的肯定、否定、范围或不确定性，不强制重复无关历史；找不到某段引用不能推翻其他来源已报告的事实，不把检索或措辞的不确定写成事实本身未知；引用、假设或他人状态不能变成本人状态，只把该人物该事项真正未报告的独立状态标为未知。'
  const pursuitTexts=new Set(reportedPursuitClauses(current.content).map(clause=>clause.text))
  const materialOnly=resumePortfolioMode&&clauseCatalogue.every(clause=>assistantRequestClause(clause.text)||pursuitTexts.has(clause.text))
  if(materialOnly){
    // This lane creates a new fact-selected artifact, never edits an old body.
    // Keep event identities, revisions, facts, stages and controls; full source
    // history remains in the authorized server snapshot and persisted records.
    for(const event of [promptContext.currentEvent,...promptContext.events??[]].filter(Boolean)){
      delete event.processTurns
      event.actions=event.actions.map(({draft,requestSources,...identity}:Record<string,unknown>)=>identity)
    }
    staged.audit.push({phase:'catalogue_material_context',processHistoryOmitted:true,oldBodiesOmitted:true,providerCalls:0})
  }
  const userPrompt=JSON.stringify({...promptContext,...(workflowHints?{workflowHints}:{}),...(boundedReply?{boundedReply}:{})})
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
    try{result=parseActionCoachTurn(raw,{allowEmptyMaterialExplanation:resumePortfolioMode,allowEmptyReplyWithCompleteDraft:true,onNormalization:kind=>staged.audit.push({phase:'coach_output_normalized',kind,providerCalls:0}),onRejection:diagnostic=>staged.audit.push({phase:'coach_output_rejected',...diagnostic,providerCalls:0})})}catch{
      await captureSyntheticOutput(run.user_id,run.request_id,raw,staged,'rejected_synthetic_business_output_captured')
      throw new HttpError(502,'COACH_OUTPUT_INVALID')
    }
    if(answerDispositionRequired&&(!result.event||!Object.hasOwn(result.event,'resolveUnknowns'))){
      await captureSyntheticOutput(run.user_id,run.request_id,raw,staged,'rejected_synthetic_business_output_captured')
      staged.audit.push({phase:'coach_output_rejected',stage:'missing_unknown_disposition',providerCalls:0})
      throw new HttpError(502,'COACH_UNKNOWN_DISPOSITION_MISSING')
    }
    if(calls.length)await captureSyntheticOutput(run.user_id,run.request_id,raw,staged,'synthetic_business_output_captured')
    if(!completeUserReply(result.reply,current.content))throw new HttpError(502,'REPLY_INCOMPLETE_OR_INTERNAL')
    const preferenceSurfaces=[result.reply,...(result.lead?[result.lead]:[])]
    if(preferenceSurfaces.some(text=>unsupportedPreferenceConstraintClaims(text,promptContext.currentTask.responseScope.reportedEvidence.preferences,current.id,current.content).length))throw new HttpError(502,'REPLY_PREFERENCE_HARDENED')
    if(contract.requiredReplyKind==='comparison'&&!comparisonReplyAccepts(result.reply)){
      // The validated parser may have normalized a wrapper while the provider's
      // complete JSON reply still carries both explicitly labelled options.
      // Use that exact raw reply only when the comparison validator accepts it.
      try{const rawReply=(JSON.parse(raw) as any)?.reply;if(typeof rawReply==='string'&&comparisonReplyAccepts(rawReply)){result.reply=rawReply;staged.audit.push({phase:'comparison_reply_restored_from_raw',providerCalls:0})}}catch{}
      if(!comparisonReplyAccepts(result.reply)){if(process.env.LIFEOS_DEBUG_COMPARISON)appendFileSync('.local/comparison-debug.txt',JSON.stringify({reply:result.reply,raw,current:current.content})+'\n');throw new HttpError(502,'REPLY_COMPARISON_MISSING')}
    }
    if(contract.requiredReplyKind==='comparison'&&!comparisonUniverseAccepts(result.reply,current.content))throw new HttpError(502,'REPLY_COMPARISON_UNBOUNDED')
    if(!requestedActionLimitAccepts(result.reply,current.content))throw new HttpError(502,'REPLY_ACTION_LIMIT')
    if(contract.requiredReplyKind==='summary'&&!summaryReplyAccepts(result.reply))throw new HttpError(502,'REPLY_SUMMARY_MISSING')
    const generatedReply=result.reply
    const generatedAskedNodes=new Set(result.event?.nodes?.filter(node=>node.kind==='unknown'&&generatedReply.includes(node.question.trim()))??[])
    // Server-authored enum choices already encode their evidence boundary.
    // Validate selection before prose repair; model-only rewriting must not
    // invalidate the same authorized selection before commit.
    if(!boundedReplyAccepts(result.reply,boundedReply)){
      // A paused-target boundary can still answer an explicit one-question recall with its safe clarification choice; never accept the model's unsupported alternative.
      if(boundedReply?.choices.length&&/只问一个问题/.test(current.content)){result.reply=boundedReply.choices[0]!;staged.audit.push({phase:'bounded_boundary_choice_selected',providerCalls:0})}
      else throw new HttpError(502,'BOUNDED_REPLY_INVALID')
    }
    if(!boundedReply&&(grillingMode==='ordinary'||grillingMode==='explore')){
      const original=result.reply,opened=openUnreportedChoiceQuestion(original,current.content)
      if(opened){
        result.reply=opened
        const pendingQuestions=result.event?.nodes?.filter(node=>node.kind==='unknown')??[]
        const definedTopic=/^你(?:所)?说的[“「『"]([^”」』"]{1,30})[”」』"]具体指什么[？?]$/.exec(opened)?.[1]
        if(result.event?.nodes)for(const node of result.event.nodes)if(node.kind==='unknown'){
          const question=openUnreportedChoiceQuestion(node.question,current.content)
          const nodeTopic=/^你(?:所)?说的[“「『"]([^”」』"]{1,30})[”」』"]具体(?:是)?指/.exec(node.question)?.[1]
          if(question&&opened.includes(question.trim()))node.question=question
          else if(definedTopic&&pendingQuestions.length===1&&nodeTopic===definedTopic)node.question=opened
        }
        staged.audit.push({phase:'grilling_loaded_choices_opened',providerCalls:0})
      }
    }
    const authorizedQuestionText=[current.content,...messages.filter(message=>message.role==='user').map(message=>message.content),...growthAll.filter(item=>item.status==='active'&&!item.unavailableReason&&['user_reported','user_edit'].includes(item.assertion)).map(item=>item.text),JSON.stringify(snapshot.confirmedExperiences)].join('\n')
    if(!boundedReply&&(grillingMode==='ordinary'||grillingMode==='explore')&&!materialIntent&&!planIntent){
      const accessGrounded=prioritizeReportedAccessFailure(result.reply,current.content)
      if(accessGrounded){result.reply=accessGrounded;staged.audit.push({phase:'reported_access_failure_prioritized',providerCalls:0})}
      const accessAlternative=groundReportedAccessAlternative(result.reply,current.content)
      if(accessAlternative!==null){
        if(!accessAlternative)throw new HttpError(502,'REPLY_ACCESS_MEASUREMENT_UNBOUNDED')
        result.reply=accessAlternative;staged.audit.push({phase:'reported_access_alternative_grounded',providerCalls:0})
      }
      const receiptState=fixReportedReceiptState(result.reply,current.content)
      if(receiptState){result.reply=receiptState;staged.audit.push({phase:'reported_receipt_state_separated',providerCalls:0})}
      const clickablePrototype=groundClickablePrototype(result.reply,current.content)
      if(clickablePrototype){result.reply=clickablePrototype;staged.audit.push({phase:'clickable_prototype_grounded',providerCalls:0})}
      const causalitySoftened=softenSingleObservationCausality(result.reply,current.content,authorizedQuestionText)
      if(causalitySoftened){result.reply=causalitySoftened;staged.audit.push({phase:'single_observation_causality_softened',providerCalls:0})}
      // History is evidence for available resources, not authorization for a
      // new action. A current pause/understanding-only turn must not inherit an
      // older public-lookup request.
      const resourceGrounded=groundUnsupportedOperationalResources(result.reply,current.content)
      if(resourceGrounded){result.reply=resourceGrounded;staged.audit.push({phase:'unsupported_operational_resource_replaced',providerCalls:0})}
      const channelGrounded=removeUnsupportedContactChannels(result.reply,authorizedQuestionText,current.content)
      if(channelGrounded!==null){
        if(!channelGrounded)throw new HttpError(502,'REPLY_UNSUPPORTED_CONTACT_CHANNEL')
        result.reply=channelGrounded;staged.audit.push({phase:'unsupported_contact_channel_removed',providerCalls:0})
      }
      // The single-lead boundary is a whole-reply stage correction, so it runs
      // before sentence-level guards; a coherent clarification beats a reply
      // with its productisation sentences cut out.
      const singleLeadGrounded=groundSingleLeadWithoutProduct(result.reply,current.content)
      if(singleLeadGrounded){
        result.reply=singleLeadGrounded
        if(result.event?.nodes)result.event.nodes=result.event.nodes.filter(node=>node.kind!=='unknown'||singleLeadGrounded.includes(node.question.trim()))
        staged.audit.push({phase:'grilling_single_lead_without_product_grounded',providerCalls:0})
      }
      const beforePresupposition=result.reply
      const presuppositionOpened=openPresupposedProblemQuestion(result.reply)
      if(presuppositionOpened){
        result.reply=presuppositionOpened
        const originalQuestion=beforePresupposition.match(/[^。！!；;\n]*[？?]\s*$/)?.[0]?.trim()
        const openedQuestion=presuppositionOpened.match(/[^。！!；;\n]*[？?]\s*$/)?.[0]?.trim()
        if(originalQuestion&&openedQuestion&&result.event?.nodes)for(const node of result.event.nodes)if(node.kind==='unknown'&&node.question.trim()===originalQuestion)node.question=openedQuestion
        staged.audit.push({phase:'grilling_presupposed_problem_opened',providerCalls:0})
      }
      const demoRemoved=removePrematureDemoStep(result.reply,current.content)
      if(demoRemoved){result.reply=demoRemoved;staged.audit.push({phase:'grilling_premature_demo_removed',providerCalls:0})}
      const productizationRemoved=removePrematureProductization(result.reply,current.content)
      if(productizationRemoved){result.reply=productizationRemoved;staged.audit.push({phase:'grilling_premature_productization_removed',providerCalls:0})}
      const zeroTimeStopped=removeQuestionOnZeroTime(result.reply,current.content)
      if(zeroTimeStopped){result.reply=zeroTimeStopped;staged.audit.push({phase:'grilling_zero_time_question_removed',providerCalls:0})}
      const bounded=limitGrillingQuestions(result.reply,current.content,authorizedQuestionText)
      if(bounded){
        result.reply=bounded
        if(result.event?.nodes)result.event.nodes=result.event.nodes.filter(node=>node.kind!=='unknown'||bounded.includes(node.question.trim()))
        staged.audit.push({phase:'grilling_single_question_bounded',providerCalls:0})
      }
    }
    // A material-intent turn can still downgrade an explicitly requested
    // clickable prototype to a sketch. Apply the same boundary outside the
    // ordinary/explore block when no material draft owns the reply.
    if(!boundedReply&&!(result.event?.action&&'draft'in result.event.action)){
      // Refusal is a current-turn boundary, not a grilling-mode branch. A
      // listening/direct mode must still acknowledge the named boundary.
      const refusalAcknowledged=acknowledgeRefusalBoundary(result.reply,current.content)
      if(refusalAcknowledged){result.reply=refusalAcknowledged;staged.audit.push({phase:'refusal_boundary_acknowledged',providerCalls:0})}
      const unsupportedPreference=repairUnsupportedPreferenceClaim(result.reply,current.content,promptContext.currentTask.responseScope.reportedEvidence.preferences)
      if(unsupportedPreference!==null){result.reply=unsupportedPreference;if(!result.reply.trim())throw new HttpError(502,'REPLY_INCOMPLETE_OR_INTERNAL');staged.audit.push({phase:'unsupported_preference_claim_repaired',providerCalls:0})}
      const unsupportedZero=repairUnsupportedZeroTimeClaim(result.reply,current.content)
      if(unsupportedZero){result.reply=unsupportedZero;staged.audit.push({phase:'unsupported_zero_time_claim_removed',providerCalls:0})}
      const quantityEnforced=enforceReportedQuantity(result.reply,current.content)
      if(quantityEnforced){result.reply=quantityEnforced;staged.audit.push({phase:'reported_quantity_enforced',providerCalls:0})}
      const zeroTimeFocus=ensureZeroTimeFocus(result.reply,current.content)
      if(zeroTimeFocus){result.reply=zeroTimeFocus;staged.audit.push({phase:'zero_time_focus_preserved',providerCalls:0})}
      const zeroTimeTasks=removeZeroTimeTasks(result.reply,current.content)
      if(zeroTimeTasks){result.reply=zeroTimeTasks;staged.audit.push({phase:'zero_time_tasks_removed',providerCalls:0})}
      const lowCostSelfStart=ensureLowCostSelfStart(result.reply,current.content)
      if(lowCostSelfStart){result.reply=lowCostSelfStart;staged.audit.push({phase:'low_cost_self_start_added',providerCalls:0})}
      const twoFactorPresence=ensureTwoFactorPresenceChange(result.reply,current.content)
      if(twoFactorPresence){result.reply=twoFactorPresence;staged.audit.push({phase:'two_factor_presence_change_required',providerCalls:0})}
      const healthTwoFactor=guardHealthTwoFactor(result.reply,current.content)
      if(healthTwoFactor){result.reply=healthTwoFactor;staged.audit.push({phase:'health_two_factor_boundary_added',providerCalls:0})}
      const clickablePrototype=groundClickablePrototype(result.reply,current.content)
      if(clickablePrototype){result.reply=clickablePrototype;staged.audit.push({phase:'clickable_prototype_grounded',providerCalls:0})}
      const clickableValidation=ensureClickableValidation(result.reply,current.content)
      if(clickableValidation){result.reply=clickableValidation;staged.audit.push({phase:'clickable_validation_added',providerCalls:0})}
      const clickableCount=fixClickableCountConsistency(result.reply,current.content)
      if(clickableCount){result.reply=clickableCount;staged.audit.push({phase:'clickable_count_consistent',providerCalls:0})}
    }
    if(requestedGuide&&!result.citations?.length)throw new HttpError(400,'COACH_CITATION_INVALID')
    if(/"(?:readiness|missingRequired|materialFactIds|materialEvidence)"\s*:/.test(raw))staged.audit.push({phase:'provider_material_metadata_ignored',providerCalls:0})
    if(explicitMaterial?.event?.action&&'draft'in explicitMaterial.event.action&&result.event?.action&&'draft'in result.event.action)result.event.action.draft=explicitMaterial.event.action.draft
    if((readOnlyQuestion||instructionOnlySummary)&&(result.event||result.experienceCandidate||result.weeklyPlan||result.growthUpdates?.length)){
      staged.audit.push({phase:'coach_output_rejected',stage:'read_only_scope',providerCalls:0})
      throw new HttpError(502,'COACH_OUTPUT_INVALID')
    }
    if(summaryEventReadOnly&&result.event){
      staged.audit.push({phase:'coach_output_rejected',stage:'summary_event_scope',providerCalls:0})
      throw new HttpError(502,'COACH_OUTPUT_INVALID')
    }
    if((currentConversationOnly(current.content)||boundaryNeedsClarification)&&(result.experienceCandidate||result.event||result.weeklyPlan||result.citations?.length)){
      staged.audit.push({phase:'coach_output_rejected',stage:'conversation_scope',providerCalls:0})
      throw new HttpError(502,'COACH_OUTPUT_INVALID')
    }
    if(!boundedReplyAccepts(result.reply,boundedReply)){
      // A paused-target boundary can still answer an explicit one-question recall with its safe clarification choice; never accept the model's unsupported alternative.
      if(boundedReply?.choices.length&&/只问一个问题/.test(current.content)){result.reply=boundedReply.choices[0]!;staged.audit.push({phase:'bounded_boundary_choice_selected',providerCalls:0})}
      else throw new HttpError(502,'BOUNDED_REPLY_INVALID')
    }
    if(singleQuestionReply){
      const question=openingQuestionDraft(JSON.stringify({reply:result.reply}))
      if(question)result.reply=question
    }
    const requestedQuestion=ensureRequestedQuestion(result.reply,current.content)
    if(requestedQuestion){result.reply=requestedQuestion;staged.audit.push({phase:'requested_question_grounded',providerCalls:0})}
    // Do not downgrade a reported observation while applying the independent
    // source/safety repairs (run-mz C6-T3). Native guards still apply.
    const preserveSummary=contract.requiredReplyKind==='summary'
    const reviewed=boundedReply||sourceStatusReadback?null:repairReviewedDefects(result.reply,current.content,priorUserTexts,{preserveReportedObservation:preserveSummary})
    if(reviewed){
      result.reply=reviewed.reply
      // An originally empty explanation with a validated material remains on
      // the existing parser lane. Do not turn a nonempty internal draft into
      // an empty delivered answer during repair.
      if(!result.reply.trim())throw new HttpError(502,'REPLY_INCOMPLETE_OR_INTERNAL')
      staged.audit.push({phase:'reviewed_defects_repaired',rules:reviewed.phases,providerCalls:0})
    }
    if(distinctionActionRequested){
      const boundedDistinction=boundedDistinctionReply(current.content)
      if(boundedDistinction===null)throw new HttpError(502,'REPLY_DISTINCTION_ACTION_INVALID')
      if(result.reply!==boundedDistinction){result.reply=boundedDistinction;staged.audit.push({phase:'distinction_action_bounded',providerCalls:0})}
      if(Object.hasOwn((contract.schema as any).properties,'lead'))result.lead=boundedDistinction.slice(0,boundedDistinction.indexOf('。')+1)
      if(!distinctionActionAccepts(result.reply,current.content))throw new HttpError(502,'REPLY_DISTINCTION_ACTION_INVALID')
    }
    staged.coach=undefined;staged.candidates=[];staged.memoryChanges=[];staged.growth=undefined
    if(result.event?.action&&result.event.action.operation!=='close'&&!materialIntent){
      const target=result.event.target,event=target.operation==='continue'?[currentEvent,...historicalEvents].find(event=>event?.id===target.eventId)??null:null
      const unchanged=unchangedProposedAction(event,result.event)
      const effective=effectiveMaterialRequest(current.content,result.event.action.operation==='modify'?'modify':'create',event)
      if(unchanged||effective.disposition==='declined'||'draft'in result.event.action&&!effective.inheritedCreateRequest){
        delete result.event.action
        staged.audit.push({phase:unchanged?'unchanged_unrequested_material_dropped':'unsolicited_material_dropped',providerCalls:0})
        if(!result.event.nodes?.length&&!result.event.corrections?.length&&!result.event.resolveUnknowns?.length&&!result.event.declineUnknowns?.length)delete result.event
      }
    }
    if(result.event?.target.operation==='continue'&&result.event.resolveUnknowns?.length){
      const targetId=result.event.target.eventId
      const event=[currentEvent,...historicalEvents].find(event=>event?.id===targetId)
      const engagementSources=[...reportedEvidenceFromText(current.content).preferences.filter(preference=>preference.modality==='like').map(preference=>preference.quote),
        ...reportedPursuitClauses(current.content).filter(clause=>/^(?:我|本人)(?:最|更|确实|现在)?愿意/.test(clause.text)).map(clause=>clause.text)]
      result.event.resolveUnknowns=result.event.resolveUnknowns.filter(id=>{
        const question=event?.nodes.find(node=>node.id===id&&node.kind==='unknown')?.content??''
        // A reply that still presents the same item as unknown cannot close it
        // in the persisted event state.
        if(/(?:仍未知|尚未确认|不确定|是否偶然|不知道|未确认)/.test(result.reply)&&unknownQuestionTopicMatches(question,result.reply)){
          staged.audit.push({phase:'unknown_stays_open_when_reply_says_unknown',nodeId:id,sourceMessageId:run.source_message_id,providerCalls:0});return false
        }
        // A causal either/or unknown is not answered by repeating the same
        // situation. Only an explicit current-message cue for one alternative
        // can close it.
        const alternatives=question.split(/\s*(?:还是|或者|或)\s*/).map(part=>part.replace(/^.*?是/,'').replace(/[。！？?，,；;]$/,'').trim()).filter(part=>part.length>=2)
        const cues=alternatives.map(part=>part.slice(-6)).filter(cue=>cue.length>=2)
        if(cues.length>=2&&!cues.some(cue=>current.content.includes(cue))){
          staged.audit.push({phase:'unanswered_alternative_unknown_retained',nodeId:id,sourceMessageId:run.source_message_id,providerCalls:0});return false
        }
        if(/愿意/.test(question)&&/(?:投入|花.{0,6}时间|继续)/.test(question)&&!engagementSources.some(source=>unknownQuestionTopicMatches(question,source,true))){
          staged.audit.push({phase:'unanswered_preference_gap_retained',nodeId:id,sourceMessageId:run.source_message_id,providerCalls:0});return false
        }
        return true
      })
    }
    if(result.event){
      // Apply the same instruction boundary to corrections: a new request or
      // continuation cue cannot overwrite the history it refers to.
      const excludedEventSource=(quote:string)=>scanUserClauses(quote).every(clause=>!clause.quoted&&!clause.code&&(assistantRequestClause(clause.text)||/^(?:接着|继续|回到)(?:上次|之前|刚才)[^，。！？\n]*$/.test(clause.text)||/^只看[^，。！？\n]{1,40}(?:就好|即可)$/.test(clause.text)||/^(?:现在)?长期记忆(?:已经|已)?(?:开启|关闭)$/.test(clause.text.trim())))
      if(result.event.nodes)result.event.nodes=result.event.nodes.filter(node=>node.kind==='unknown'||!excludedEventSource(node.source.quote))
      if(result.event.corrections){
        const target=result.event.target,event=target.operation==='continue'?[currentEvent,...historicalEvents].find(event=>event?.id===target.eventId):null
        result.event.corrections=result.event.corrections.filter(correction=>{
          if(excludedEventSource(correction.source.quote))return false
          const node=event?.nodes.find(node=>node.id===correction.nodeId)
          // Repeating an existing grounded fragment is a no-op, not a rewrite
          // of the larger historical report. Changed facts still validate and
          // commit through the original strict correction transaction.
          const unchanged=node&&node.kind!=='unknown'&&node.content.includes(correction.source.quote)&&correction.source.messageId===run.source_message_id&&current.content.includes(correction.source.quote)
          if(unchanged)staged.audit.push({phase:'repeated_fact_correction_ignored',nodeId:node.id,providerCalls:0})
          return !unchanged
        })
        // One provider output may both revise an existing fact and add the
        // exact same kind/source as a new node. The correction owns that one
        // current fact; do not create a second copy of the same source span.
        if(result.event.nodes)result.event.nodes=result.event.nodes.filter(node=>node.kind==='unknown'||!result.event!.corrections!.some(correction=>event?.nodes.some(existing=>existing.id===correction.nodeId&&existing.kind===node.kind)&&correction.source.messageId===node.source.messageId&&correction.source.quote===node.source.quote))
      }
      if(!result.event.nodes?.length&&!result.event.action&&!result.event.corrections?.length&&!result.event.resolveUnknowns?.length&&!result.event.declineUnknowns?.length)delete result.event
    }

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
        &&!clauseReportsPastAction(handle.text)
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
        if(!resumePortfolioMode)throw new HttpError(400,'MATERIAL_MODE_MISMATCH')
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
    const deliveredDraft=materialDraftOf(result)
    if(singleQuestionMaterial&&deliveredDraft?.content&&(deliveredDraft.content.match(/[？?]/g)?.length??0)>1){
      const original=deliveredDraft.content
      let body=original.trim()
      for(const [open,close] of [['“','”'],['「','」'],['『','』']])if(body.startsWith(open!)&&body.endsWith(close!)){body=body.slice(1,-1);break}
      const question=openingQuestionDraft(JSON.stringify({reply:body}))
      if(!question)throw new HttpError(400,'COACH_MATERIAL_QUANTITY_INVALID')
      deliveredDraft.content=question
      result.reply=result.reply.replace(original,question)
      staged.audit.push({phase:'single_question_material_bounded',providerCalls:0})
    }
    const requestedMaterial=deliverableIntent(current.content,currentEvent?.actions.some(action=>action.status==='proposed')?'modify':'create')
    // A direct drafting instruction requests delivery now. Abstract advice is
    // not a completed delivery, even when it lacks the old framing markers.
    const directDraft=requiresImmediateMaterial(current.content)
    if(!boundaryNeedsClarification&&!hasMaterial&&requestedMaterial&&(directDraft||coachMaterialPresentation(result.reply)||result.reply.trim()==='按你提供的内容，整理如下：'))throw new HttpError(400,'COACH_MATERIAL_NOT_VISIBLE')
    staged.usedKnowledgeRefs=undefined
    const narrativeChars=result.reply.length
    try{result.reply=renderCoachReply(result)}catch{
      staged.audit.push({phase:'coach_output_rejected',stage:'material_render',providerCalls:0})
      throw new HttpError(502,'COACH_OUTPUT_INVALID')
    }
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
      if(result.weeklyPlan.items.some(item=>item.directionScopes.some(scope=>!allowedPlanScopes.includes(scope))))throw new HttpError(400,'WEEKLY_PLAN_SCOPE_UNGROUNDED')
      const planInput=normalizeWeeklyPlanTasks(result.weeklyPlan as unknown as import('./weekly-plans.ts').WeeklyPlanInput)
      result.reply=normalizeWeeklyPlanReply(result.reply,result.weeklyPlan as unknown as import('./weekly-plans.ts').WeeklyPlanInput)
      if(planInput.items.length!==result.weeklyPlan.items.length)staged.audit.push({phase:'weekly_plan_rest_as_unallocated',removedBufferItems:result.weeklyPlan.items.length-planInput.items.length,providerCalls:0})
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
      if(planInput.availableMinutes>0&&requiresPlanSlack(current.content)&&planInput.items.reduce((sum,item)=>sum+item.minutes,0)>=planInput.availableMinutes)throw new HttpError(400,'WEEKLY_PLAN_SLACK_REQUIRED')
      staged.weeklyPlan=await stageWeeklyPlan(run,planInput,{user:run.user_id,expectedControlSnapshotKey:expectedControlKey,effectiveBlockedScopes:blockedDirectionScopes})
      // A plan's visible period and totals come from the same validated
      // structure that is persisted, not free prose recalling an older week.
      result.reply=[weeklyPlanExplanation(result.reply),renderProposedWeeklyPlan(planInput)].filter(Boolean).join('\n\n')
    }
    // A method note is support for a requested method or a factual claim, not
    // decoration for every ordinary answer. Suppress unrequested citations so a
    // short focus answer does not end with an unrelated 依据与边界 block.
    const finalReviewed=boundedReply||sourceStatusReadback?null:repairReviewedDefects(result.reply,current.content,priorUserTexts,{preserveReportedObservation:preserveSummary})
    if(finalReviewed){
      result.reply=finalReviewed.reply
      if(!result.reply.trim())throw new HttpError(502,'REPLY_INCOMPLETE_OR_INTERNAL')
      staged.audit.push({phase:'reviewed_defects_repaired_final',rules:finalReviewed.phases,providerCalls:0})
    }
    if(!boundedReply&&!sourceStatusReadback&&(grillingMode==='ordinary'||grillingMode==='explore')&&!materialIntent&&!planIntent){
      const preference=repairUnsupportedPreferenceClaim(result.reply,current.content,promptContext.currentTask.responseScope.reportedEvidence.preferences)
      if(preference!==null){result.reply=preference;staged.audit.push({phase:'final_preference_scope_grounded',providerCalls:0})}
      const effect=softenSingleObservationCausality(result.reply,current.content,authorizedQuestionText)
      if(effect!==null){result.reply=effect;staged.audit.push({phase:'final_time_effect_scope_grounded',providerCalls:0})}
      if(!result.reply.trim())throw new HttpError(502,'REPLY_INCOMPLETE_OR_INTERNAL')
    }
    if(violatesLabelInferenceBoundary(result.reply,inferenceBoundaries,current.content))throw new HttpError(502,'REPLY_RECREATES_REJECTED_LABEL')
    if(distinctionActionRequested&&!distinctionActionAccepts(result.reply,current.content))throw new HttpError(502,'REPLY_DISTINCTION_ACTION_INVALID')
    // P5.3 step 8: the final reply must not contradict the verified effects.
    // A wrong week-hour restatement is repaired to the user's verified budget
    // instead of discarding an otherwise valid turn; the audit keeps the fact.
    const budgetRepaired=repairReplyBudget(obligations,result.reply)
    if(budgetRepaired!==result.reply){result.reply=budgetRepaired;staged.audit.push({phase:'budget_contradiction_repaired',providerCalls:0})}
    // Bind a displayed repaired question to the same pending unknown. Never
    // persist an old asked question after replacing it in the visible answer.
    if(result.event?.nodes&&generatedReply!==result.reply){
      const questions=result.reply.match(/[^。！!；;\n？?]*[？?]/g)?.map(question=>question.trim())??[]
      result.event.nodes=result.event.nodes.filter(node=>{
        if(node.kind!=='unknown'||!generatedAskedNodes.has(node)||result.reply.includes(node.question.trim()))return true
        if(generatedAskedNodes.size!==1)throw new HttpError(502,'COACH_UNKNOWN_QUESTION_DIVERGED')
        staged.audit.push({phase:'repaired_unknown_question_synchronized',disposition:questions.length===1?'reworded':'removed',providerCalls:0})
        if(questions.length!==1)return false
        node.question=questions[0]!
        return true
      })
    }
    // All prose mutations precede citation validation. The cited proposition
    // and the delivered proposition must be the same validated text.
    const checkedCitations=await validateCoachCitations(result.reply,suppressUnrequestedCitations?[]:(result.citations??[]),suppressUnrequestedCitations?[]:knowledge,current.content,messages.filter(row=>row.role==='user').map(row=>row.content))
    if(suppressUnrequestedCitations&&((result.citations?.length??0)>0||knowledge.length>0))staged.audit.push({phase:'unrequested_citations_suppressed',providerCalls:0})
    if(requestedGuide&&!checkedCitations.refs.some(ref=>ref.sourceId===requestedGuide.id))throw new HttpError(400,'COACH_CITATION_INVALID')
    result.reply=checkedCitations.text
    // Every deterministic post-processor runs after the provider enum check.
    // Re-assert the same bounded catalogue here so a later repair can never
    // turn an authorized editorial reply into uncatalogued free prose.
    if(sourceStatusReadback){
      result.reply=sourceStatusReadback
      staged.audit.push({phase:'participant_status_projected_from_current_source',sourceMessageId:run.source_message_id,providerCalls:0})
    }
    if(!boundedReplyAccepts(result.reply,boundedReply)){
      // A paused-target boundary can still answer an explicit one-question recall with its safe clarification choice; never accept the model's unsupported alternative.
      if(boundedReply?.choices.length&&/只问一个问题/.test(current.content)){result.reply=boundedReply.choices[0]!;staged.audit.push({phase:'bounded_boundary_choice_selected',providerCalls:0})}
      else throw new HttpError(502,'BOUNDED_REPLY_INVALID')
    }
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

    const controlClauseTexts=[...detectForgetIntentClauses(current.content).filter(clause=>clause.kind).map(clause=>clause.clauseText),...(currentLabelRejection?.boundaryQuotes??[]),...(turnDerivedControls.status==='explicit'?turnDerivedControls.changes.map(change=>change.quote):[])]
    // An omitted native delta must not erase an explicit preference or goal between
    // conversations. Feed exact clause handles through the SAME authority,
    // source validation and finishRun transaction; never infer preferences.
    if(snapshot.settings.enabled&&contract.capabilities.growth&&!readOnlyQuestion&&!correctionPlan){
      const preferences=new Set(reportedPreferenceClauses(current.content).map(clause=>clause.text))
      const pursuits=new Set(reportedPursuitClauses(current.content).map(clause=>clause.text))
      const missing=clauseCatalogue.filter(clause=>(preferences.has(clause.text)||pursuits.has(clause.text))&&!controlClauseTexts.includes(clause.text)&&!growthAll.some(item=>item.status==='active'&&!item.unavailableReason&&item.text===clause.text)&&!result.growthUpdates?.some(delta=>delta.assertion==='user_reported'&&delta.source.clauseId===clause.clauseId))
      if(missing.length){
        result.growthUpdates=[...(result.growthUpdates??[]),...missing.map(clause=>({target:{operation:'create' as const},assertion:'user_reported' as const,kind:preferences.has(clause.text)?'preference' as const:'goal' as const,source:{clauseId:clause.clauseId}}))]
        staged.audit.push({phase:'explicit_personal_intent_supplemented',count:missing.length,providerCalls:0})
      }
    }
    if(result.growthUpdates?.length){
      staged.audit.push({phase:'growth_plan_context',authorizedCount:growthAll.length,authorizedKinds:growthAll.map(item=>item.kind),planTargetItem:correctionPlan?.target?.itemId??null,newQuote:correctionPlan?.newQuote??null,providerCalls:0})
      const authoritative=resolveGrowthDeltas({deltas:result.growthUpdates,suppressObservations:obligations.requiredEffects.some(effect=>effect.type==='remaining_time'||effect.type==='weekly_time'),currentMessageId:run.source_message_id,currentText:current.content,catalogue:modelClauseCatalogue,authorized:growthAll.map(item=>({id:item.id,revision:item.revision,kind:item.kind,assertion:item.assertion,text:item.text,unavailableReason:item.unavailableReason,status:item.status,inferenceBoundary:item.inferenceBoundary})),correctionPlan,controlClauseTexts,inferenceBoundaries})
      for(const entry of authoritative.audit)staged.audit.push(entry)
      staged.audit.push({phase:'growth_model_input_shape',ops:result.growthUpdates.map((delta)=>({op:delta.target.operation,itemId:delta.target.operation==='correct'?delta.target.itemId.slice(0,8):null,clauseId:delta.source.clauseId,kind:delta.kind})),providerCalls:0})
      for(const delta of authoritative.deltas)if(delta.assertion==='ai_observation'&&delta.dependencies.some(ref=>'id'in ref&&(recommendationBlockedIds.has(ref.id)||unresolvedTaskBoundaries.some(item=>item.id===ref.id))))throw new HttpError(400,'RECOMMENDATION_CONTROL_NOT_APPLIED')
      const growthDeltas=authoritative.deltas.map(normalizeModelFeedbackDelta)
      const normalizedGrowthCount=growthDeltas.reduce((count,delta,index)=>count+(delta!==authoritative.deltas[index]?1:0),0)
      if(normalizedGrowthCount)staged.audit.push({phase:'model_growth_delta_normalized',count:normalizedGrowthCount,providerCalls:0})
      if(growthDeltas.length){
        const stageOptions={allowedDirectionScopes:allowedDirectionScopes}
        const isolated=await stageGrowthPreservingFeedback(growthDeltas,result.reply,Boolean(result.weeklyPlan),changes=>stageGrowth(changes,stageOptions))
        if(isolated.dropped.length)staged.audit.push({phase:'growth_optional_feedback_dropped',dropped:isolated.dropped.length,sourceSha256:createHash('sha256').update(isolated.dropped.join('\n')).digest('hex'),providerCalls:0})
        if(isolated.value!==undefined)staged.growth=isolated.value
      }
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
      const stagedSupplement=await stageGrowth(budgetSupplement,{})
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
        try{stagedCorrection=await stageGrowth([amendDelta],{})}catch{stagedCorrection=null}
      }
      if(!stagedCorrection?.changes.length){
        stagedCorrection=await stageGrowth([{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{messageId:run.source_message_id,quote:correctionPlan.newQuote}}],{})
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
    const explicitTaskFacts=[...contributionFacts,...reportedTaskBoundaryClauses(current.content),...negativePersonalFactClauses(current.content),...reportedAdoptionClauses(current.content),...requestedQuestionEditClauses(current.content),...resourceBlockedPersonalFactClauses(current.content),...reportedTaskOutcomeClauses(current.content,growthAll.some(item=>item.assertion==='user_reported'&&item.kind==='feedback'&&item.progressState==='completed'),true),...reportedPerformedTaskClauses(current.content),...reportedCompletedContactClauses(current.content),...scanUserClauses(current.content).filter(c=>!c.conditional&&!c.quoted&&!c.code&&!c.attributedToOther&&((!c.interrogative&&!c.quoteSpans.length&&(/^(?:但)?(?:遇到|卡在|停在).{0,30}(?:卡住|受阻|做不下去)/.test(c.text)||/^不再问(?:愿不愿意|是否愿意|想不想)/.test(c.text)))||(!c.interrogative&&!c.quoteSpans.length&&(/^(?:这次|刚才那次).{0,12}(?:访谈|行动|任务)我(?:暂时|先)不继续/.test(c.text)||/^(?:实际效果|使用结果|付款结果).{0,12}(?:我不知道|仍未知|不清楚)/.test(c.text))))) ]
    const referenceContext=contract.capabilities.growth?[...reportedSourceContextClauses(current.content,[...explicitTaskFacts.map(fact=>fact.text),...(staged.growth?.changes??[]).filter(delta=>delta.assertion==='user_reported').map(delta=>delta.source.quote),...(staged.serverGoals??[]).map(goal=>goal.quote)],controlClauseTexts),...reportedExternalExpectationClauses(current.content)]:[]
    const taskFactSupplement=snapshot.settings.enabled&&!readOnlyQuestion?[...new Map([...explicitTaskFacts,...referenceContext].map(clause=>[clause.text,clause])).values()].filter(clause=>
      !assistantRequestClause(clause.text)&&
      !controlClauseTexts.includes(clause.text)&&
      !staged.growth?.changes.some(delta=>delta.source.quote.includes(clause.text))&&
      !growthAll.some(item=>item.status==='active'&&!item.unavailableReason&&item.text===clause.text)
    ).map(clause=>({target:{operation:'create' as const},assertion:'user_reported' as const,kind:'context' as const,source:{messageId:run.source_message_id,quote:clause.text}})):[]
    if(taskFactSupplement.length){
      const supplement=await stageGrowth(taskFactSupplement,{allowedDirectionScopes})
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
              const stagedSupersede=await stageGrowth([supersedeDelta],{})
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
      const unconfirmedLabelRejection=detectUnconfirmedLabelRejection(current.content)
      const unconfirmedLabelBoundaryStaged=await stageLabelRejectionBoundary(growthAll)
      const intentClauses=detectForgetIntentClauses(current.content)
      for(const clause of intentClauses){
        if(!clause.kind)continue
        const scored=scoreForgetTargets(growthAll,clause.clauseText,current.content)
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
        }else if(clause.kind==='forget'&&unconfirmedLabelRejection){
          const continuity=snapshot.settings.enabled?'已记录这条边界':'当前对话会尊重这条边界；长期记忆关闭时不会跨会话保存'
          result.reply=`没有找到已保存的“${unconfirmedLabelRejection.label}”记录；它不会被当作本人确认的事实，${continuity}：${unconfirmedLabelRejection.boundaryQuotes.join('；')}。现在结束，不安排下一步。`
          staged.audit.push({phase:'memory_control_no_target_rejection_recorded',kind:clause.kind,label:unconfirmedLabelRejection.label,boundaryStaged:unconfirmedLabelBoundaryStaged,reason:'unconfirmed_label_was_not_stored'})
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
      // The old value lives in the correction sentence, not in the action
      // request that follows it ("给一个四小时内的小验证"). Using the whole
      // message made the time-budget item look related through 四/小/时.
      const claimSentence=String(claimSource).split(/[。！？!?\n]/)[0]??String(claimSource)
      const oldValueRemainder=claimPlan?claimSentence.split(claimPlan.newQuote).join(''):claimSentence
      // Generic pronouns/particles are not evidence that an active record
      // carries the corrected value; two shared characters such as 我/在 must
      // not make an unrelated item look related.
      const correctionGeneric=new Set([...'我你他她它们了的是一在和都也与及还就很不去要这那有没说会被把具体什么觉得'])
      const oldValueChars=new Set<string>([...String(oldValueRemainder).replace(/[^\p{L}\p{N}]/gu,'')].filter(char=>!correctionGeneric.has(char)))
      const correctedBudget=claimPlan?applicableTimeBudget(claimPlan.newQuote,undefined,undefined,{retainReportedBudget:true}):undefined
      let differentBudgetField:GrowthItem|undefined
      const relatedActiveItem=growthAll.some(item=>{
        if(!['active','proposed'].includes(item.status))return false
        const chars=new Set([...item.text.replace(/[^\p{L}\p{N}]/gu,'')].filter(char=>!correctionGeneric.has(char)))
        let shared=0
        for(const char of oldValueChars)if(chars.has(char))shared++
        if(shared<2)return false
        const priorBudget=applicableTimeBudget(item.text,undefined,undefined,{retainReportedBudget:true})
        if(correctedBudget&&priorBudget&&(correctedBudget.scope!==priorBudget.scope||correctedBudget.period!==priorBudget.period)){
          differentBudgetField??=item
          return false
        }
        return shared>=2
      })
      // Nothing-to-correct tolerance: the user NAMED an old value (说成/说错了…)
      // that no active record carries — clause-granularity items may legitimately
      // not contain it. A correction naming no old value at all stays strict.
      const namesOldValue=/(?:说成|说错|搞错|记错|写错|看错|不对|之前说|以前说|原本是|没有|不是|并非|只是|而是|而非)/.test(oldValueRemainder)||/(?:不代表我|并不代表|不是因为)/.test(claimSource)
      const claimDishonest=relatedActiveItem||!namesOldValue
      const groundedInferenceDenial=/(?:不代表我|并不代表|不是因为)/.test(claimSource)&&staged.audit.some(entry=>(entry as {phase?:string;mode?:string}).phase==='correction_server_staged'&&(entry as {mode?:string}).mode==='verbatim_create')
      const correctionClaim=/(?:已更正|更正为|更正已记录|已把.{0,24}(?:改|撤|移除|删除)|已经?改成|已经?.{0,12}撤掉|更新为|已更新|已修改)/.test(result.reply)
      const separateBudgetCorrection=Boolean(correctionPlan&&!correctionPlan.target&&!amendedNow&&differentBudgetField&&correctedBudget&&staged.audit.some(entry=>(entry as {phase?:string;mode?:string}).phase==='correction_server_staged'&&(entry as {mode?:string}).mode==='verbatim_create'))
      if(separateBudgetCorrection&&correctionClaim){
        const safeCurrent=result.reply.replace(/(?:已更正|更正为|更正已记录|已把.{0,24}(?:改|撤|移除|删除)|已经?改成|已经?.{0,12}撤掉|更新为|已更新|已修改)/g,'').split(/[，,；;。！？!?\n]+/).map(sentence=>sentence.trim()).filter(Boolean).join('；')
        const paused=turnDerivedControls.status==='explicit'?turnDerivedControls.changes.filter(change=>change.operation==='pause').flatMap(change=>change.scopes.map(scope=>`${directionScopeLabel(scope)}方向先暂停`)):[]
        const clarified=`每周上限仍是“${differentBudgetField!.text}”；本周剩余时间按“${correctionPlan!.newQuote}”理解${paused.length?`；${paused.join('、')}`:''}${safeCurrent?`；${safeCurrent}`:''}。`
        if(clarified.length<=240)result.reply=clarified
        else throw new HttpError(400,'REPLY_CLAIMS_UNCOMMITTED_CORRECTION')
      }else if(!amendedNow&&!groundedInferenceDenial&&claimDishonest&&correctionClaim&&!correctionPlan&&relatedActiveItem&&namesOldValue&&/更正为/.test(result.reply)&&!/(?:已更正|已更新|已修改|已把.{0,24}(?:改|撤|移除|删除))/.test(result.reply)){
        // The user corrected an interpretation that is already represented by
        // a related active source clause; no stored field changed. Keep the
        // semantic clarification but do not let "更正为" read as a committed
        // record rewrite.
        result.reply=result.reply.replace(/更正为/g,'现在理解为')
        staged.audit.push({phase:'semantic_correction_reworded_without_record_claim',providerCalls:0})
      }else if(!amendedNow&&!groundedInferenceDenial&&claimDishonest&&correctionClaim&&!staged.audit.some(entry=>(entry as {phase?:string}).phase==='correction_server_staged'))throw new HttpError(400,'REPLY_CLAIMS_UNCOMMITTED_CORRECTION')

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
      const {forget:forgetClaim,pause:pauseClaim}=memoryControlSuccessClaims(result.reply)
      const forgetRequested=detectForgetIntentClauses(current.content).length>0||outstandingForget
      if(!controlStaged&&(forgetClaim||pauseClaim)&&forgetRequested&&!alreadyEffective)throw new HttpError(400,'REPLY_CLAIMS_UNCOMMITTED_FORGET')
      if(controlStaged&&staged.memoryControl!.kind!=='forget'&&forgetClaim)throw new HttpError(400,'REPLY_CLAIMS_UNCOMMITTED_FORGET')
    }
    // P2-3 (PC08D T4): a verbatim repeat of the previous assistant reply
    // answers nothing. Legal repeats (explicit re-send/keep-the-original
    // requests) stay allowed.
    {
      const previousAssistant=[...messages].reverse().find(row=>row.role==='assistant')?.content?.trim()
      const previousUser=[...messages].reverse().find(row=>row.role==='user'&&row.id!==run.source_message_id)?.content?.trim()
      const squash=(text:string)=>text.replace(/\s+/g,'')
      const resentSameMessage=Boolean(previousUser&&squash(current.content)===squash(previousUser))
      // Substantive repeat only: a long verbatim repeat while the user asked something new. Short listening acknowledgments (好，我在听) repeating is normal companionship; explicit re-send requests stay legal.
      if(!boundedReply&&!deterministicStateReadback&&previousAssistant&&squash(result.reply)===squash(previousAssistant)&&squash(result.reply).length>=40&&/[？?]|怎么|什么|如何|为什么|哪|帮|请|给我/.test(current.content)&&!resentSameMessage&&!/(?:再发|重发|再说一遍|保留原话|原样|复用|不变|和上次的?一样)/.test(current.content))throw new HttpError(400,'REPLY_REPEATED_VERBATIM')
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
    if(result.event?.action&&!requiresImmediateMaterial(current.content)&&'draft'in result.event.action&&'content'in result.event.action.draft&&!result.reply.includes(result.event.action.draft.content)){
      // A hidden, unrequested material is not a deliverable. Drop the action
      // before staging; an explicit material request still takes the strict
      // visible check. Do not trust derived materialIntent here: a state
      // readback may be misclassified by the model-derived contract.
      delete result.event.action
      staged.audit.push({phase:'unsolicited_hidden_material_dropped',providerCalls:0})
      if(!result.event.nodes?.length&&!result.event.corrections?.length&&!result.event.resolveUnknowns?.length&&!result.event.declineUnknowns?.length)delete result.event
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
          if(!extracted.content.result||structural!.content.result.includes(extracted.content.result)||/上次那|上次说|那件事|刚才说/.test(extracted.content.result))extracted.content.result=structural!.content.result
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
    // Validate the same requested presentation boundary after every prose
    // repair and render. Never silently truncate or commit an overlong repeat.
    // A no-target memory-control acknowledgement can replace the prose after
    // staging controls. Revalidate that final text; old citations must not
    // survive a replacement that no longer contains their proposition.
    if(result.reply!==checkedCitations.text){
      const finalCitations=await validateCoachCitations(result.reply,checkedCitations.refs.map(ref=>({claimId:ref.sourceId})),suppressUnrequestedCitations?[]:knowledge,current.content,messages.filter(row=>row.role==='user').map(row=>row.content))
      if(requestedGuide&&!finalCitations.refs.some(ref=>ref.sourceId===requestedGuide.id))throw new HttpError(400,'COACH_CITATION_INVALID')
      result.reply=finalCitations.text
      staged.usedKnowledgeRefs=[...contextKnowledge,...finalCitations.refs]
      if(staged.coach)staged.coach.knowledgeRefs=staged.usedKnowledgeRefs
      staged.audit.push({phase:'late_control_reply_revalidated',providerCalls:0})
    }
    if(sourceStatusReadback&&result.reply!==sourceStatusReadback){
      result.reply=sourceStatusReadback
      staged.audit.push({phase:'source_status_readback_preserved_after_rendering',providerCalls:0})
    }
    if(!boundedReplyAccepts(result.reply,boundedReply)){
      // A paused-target boundary can still answer an explicit one-question recall with its safe clarification choice; never accept the model's unsupported alternative.
      if(boundedReply?.choices.length&&/只问一个问题/.test(current.content)){result.reply=boundedReply.choices[0]!;staged.audit.push({phase:'bounded_boundary_choice_selected',providerCalls:0})}
      else throw new HttpError(502,'BOUNDED_REPLY_INVALID')
    }
    try{verifyReplyAgainstObligations(obligations,result.reply)}catch(error){if(isObligationError(error))throw new HttpError(400,error.code);throw error}
    if(contract.requiredReplyKind==='comparison'&&!comparisonReplyAccepts(result.reply)){
      // The validated parser may have normalized a wrapper while the provider's
      // complete JSON reply still carries both explicitly labelled options.
      // Use that exact raw reply only when the comparison validator accepts it.
      try{const rawReply=(JSON.parse(raw) as any)?.reply;if(typeof rawReply==='string'&&comparisonReplyAccepts(rawReply)){result.reply=rawReply;staged.audit.push({phase:'comparison_reply_restored_from_raw',providerCalls:0})}}catch{}
      if(!comparisonReplyAccepts(result.reply)){if(process.env.LIFEOS_DEBUG_COMPARISON)appendFileSync('.local/comparison-debug.txt',JSON.stringify({reply:result.reply,raw,current:current.content})+'\n');throw new HttpError(502,'REPLY_COMPARISON_MISSING')}
    }
    if(contract.requiredReplyKind==='summary'&&!summaryReplyAccepts(result.reply))throw new HttpError(502,'REPLY_SUMMARY_MISSING')
    if(requestedScope.sentenceLimit===1&&!boundedReply&&!materialIntent&&!planIntent&&(!isSingleSentenceReply(result.reply)||result.reply.length>240))throw new HttpError(502,'REPLY_SENTENCE_LIMIT')
    if(contract.requiredReplyKind==='comparison'&&!comparisonUniverseAccepts(result.reply,current.content))throw new HttpError(502,'REPLY_COMPARISON_UNBOUNDED')
    if(!requestedActionLimitAccepts(result.reply,current.content))throw new HttpError(502,'REPLY_ACTION_LIMIT')
    if(!completeUserReply(result.reply,current.content))throw new HttpError(502,'REPLY_INCOMPLETE_OR_INTERNAL')
    const replyEventId=result.event?(result.event.target.operation==='continue'?result.event.target.eventId:null):newMatterExplicit?null:currentEvent?.id
    if(unsupportedParticipantReadingClaims(result.reply,promptContext.currentTask.responseScope.reportedEvidence.participants,{currentMessageId:current.id,eventId:replyEventId}).length)throw new HttpError(502,'REPLY_STATE_NOT_SUPPORTED')
    return result
  }
  const slimUpdateTimeMode=obligations.kind==='update_weekly_time'&&!/(?:已经|昨天|已投|已发|投了|发了|完成了|做了|交了)/.test(current.content)
  // An unambiguous refusal needs no generated interpretation. It still uses
  // the same validator and transaction for its durable stop preference.
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
  if(!explicitMaterial&&resumePortfolioMode&&(contributionSentenceMode||contributionParagraphMode)&&!hasSeparateQuestion&&!planIntent&&!boundaryNeedsClarification){
    const contribution=singleUniqueContributionFact(materialCatalogue,run.conversation_id)
    if(contribution){
      // This exact literal paragraph already has one authorized source and no
      // selection judgment. Duplicate identities with byte-identical wording
      // add no content choice. Reuse the existing deterministic material lane;
      // resolution, source validation and atomic persistence still run below.
      const selected=resolveSelectedMaterialFacts([contribution.catalogueId],materialCatalogue,run.user_id,run.user_id,contributionSentenceMode?'contribution_sentence':'contribution_paragraph')
      if(selected.facts.length===1){
        explicitMaterial={reply:'',event:{target:currentEvent?{operation:'continue',eventId:currentEvent.id,expectedRevision:currentEvent.revision}:{operation:'create',title:'本人贡献描述',source:{messageId:run.source_message_id,quote:current.content}},action:{operation:'create',draft:{kind:'resume_portfolio',selectedFactIds:[contribution.catalogueId]}}}}
        staged.audit.push({phase:'explicit_material_rendered_without_generation',basis:'single_verified_literal_contribution',providerCalls:0})
      }
    }
  }
  // A pure five-state recall needs no new generation. Feedback with new facts
  // still uses the ordinary turn; both lanes validate and commit normally.
  const exactFeedback=!currentEvent&&!materialIntent&&!planIntent&&!turnNeedsControlReceipt&&!boundedReply&&!explicitMaterial&&!refusalOnly?exactFeedbackReadback(current.content):null
  const sourceStatusCandidate=!currentEvent&&!materialIntent&&!planIntent&&!turnNeedsControlReceipt&&!boundedReply&&!explicitMaterial&&!refusalOnly?currentParticipantStatusReadback(current.content):null
  const sourceStatusReadback=exactFeedback??(sourceStatusCandidate&&sourceStatusCandidate.length<=((contract.schema.properties as any).reply?.maxLength??16000)?sourceStatusCandidate:null)
  const verifiedStatePreview=!sourceStatusReadback&&!explicitMaterial&&!refusalOnly?groundedStateReadback(current.content,priorUserTexts):null
  const deterministicStateReadback=sourceStatusReadback??(verifiedStatePreview&&requestsOnlyStateReadback(current.content)?verifiedStatePreview:null)
  if(verifiedStatePreview){
    emit({type:'draft',text:verifiedStatePreview,saved:false,draftKind:'safe_sentence',verifiedState:true})
    staged.audit.push({phase:'verified_state_preview',providerCalls:0,labels:['已发','已读','已回复','是否采用','实际效果']})
  }
  const provisionalState=!sourceStatusReadback&&!deterministicStateReadback&&!verifiedStatePreview&&!explicitMaterial&&!refusalOnly?provisionalStatePreview(current.content,priorUserTexts):null
  if(provisionalState){
    emit({type:'draft',text:provisionalState,saved:false,draftKind:'safe_sentence',verifiedState:true})
    staged.audit.push({phase:'verified_provisional_state_preview',providerCalls:0,basis:'explicit_current_source_readback'})
  }
  const provisionalCorrection=!sourceStatusReadback&&!deterministicStateReadback&&!verifiedStatePreview&&!provisionalState&&!explicitMaterial&&!refusalOnly?provisionalCorrectionPreview(current.content):null
  if(provisionalCorrection){
    emit({type:'draft',text:provisionalCorrection,saved:false,draftKind:'safe_sentence',verifiedState:true})
    staged.audit.push({phase:'verified_correction_preview',providerCalls:0})
  }
  const provisionalQuestion=!sourceStatusReadback&&!deterministicStateReadback&&!verifiedStatePreview&&!provisionalState&&!provisionalCorrection&&!explicitMaterial&&!refusalOnly?provisionalQuestionPreview(current.content):null
  if(provisionalQuestion){
    emit({type:'draft',text:provisionalQuestion,saved:false,draftKind:'safe_question'})
    staged.audit.push({phase:'verified_provisional_question_preview',providerCalls:0,basis:'explicit_requested_clarifying_question'})
  }
  const verifiedFeedbackPreview=!sourceStatusReadback&&!verifiedStatePreview&&!provisionalState&&!provisionalQuestion&&!explicitMaterial&&!refusalOnly?groundedFeedbackPreview(current.content):null
  if(verifiedFeedbackPreview){
    emit({type:'draft',text:verifiedFeedbackPreview,saved:false,draftKind:'safe_sentence',verifiedFeedback:true})
    staged.audit.push({phase:'verified_feedback_preview',providerCalls:0})
  }
  let provisionalModelText:string|null=null
  // Control turns wait for their atomic receipt. Do not try to enumerate all
  // natural-language ways a model could prematurely claim the write succeeded.
  const modelDraft=(text:string,draftKind:'safe_question'|'safe_sentence')=>{
    if(surfaceDirectionScopes(text).some(scope=>blockedDirectionScopes.includes(scope)))return false
    if(turnNeedsControlReceipt){
      // A positively sourced, open definition question makes no write receipt
      // or recommendation. All statements and other control drafts still wait.
      if(draftKind!=='safe_question'||!requestsOneQuestionReply(current.content)||!ownedOpenDefinitionQuestion(text,current.content))return false
    }
    if(violatesLabelInferenceBoundary(text,inferenceBoundaries,current.content))return false
    if(unsupportedPreferenceConstraintClaims(text,promptContext.currentTask.responseScope.reportedEvidence.preferences,current.id,current.content).length)return false
    provisionalModelText=text;emit({type:'draft',text,saved:false,draftKind});return true
  }
  try{
    if(!explicitMaterial&&!refusalOnly&&!deterministicStateReadback)await checkModelCooldown()
    if(refusalOnly)staged.audit.push({phase:'explicit_refusal_deterministic',providerCalls:0})
    if(deterministicStateReadback)staged.audit.push({phase:'explicit_state_readback_without_generation',providerCalls:0,basis:'authorized_user_reports_only'})
    const planSchema=(contract.schema as any).properties?.weeklyPlan
    const planDraftExpectation:WeeklyPlanDraftExpectation|null=planBudget?.type==='weekly_plan'&&planBudget.minutes>0?{period:planBudget.period,availableMinutes:planBudget.minutes,allowedActions:planSchema?.properties?.items?.items?.properties?.action?.enum,mustLeaveSlack:requiresPlanSlack(current.content)}:null
    firstText=explicitMaterial?JSON.stringify(explicitMaterial):refusalOnly?JSON.stringify({reply:'好的，先不继续建议或安排这件事。'}):deterministicStateReadback?JSON.stringify({reply:deterministicStateReadback}):await runModelCall(runtime,systemPrompt,userPrompt,0,run.request_id,contextTokenEstimate,contextTokenEstimate,retrieved,route.escalated,route.reason,calls,signal,staged,capabilityVerified,'turn',contract.schema as never,'lifeos_action_coach','turn',verifiedStatePreview||verifiedFeedbackPreview?undefined:modelDraft,observer,run.user_id,resumePortfolioMode?materialCatalogue.map(fact=>fact.catalogueId):undefined,slimUpdateTimeMode,modelClauseCatalogue.map(handle=>handle.clauseId),questionFirstMaterial?'material_question':singleQuestionReply?'none':planDraftExpectation?'weekly_plan':'safe_sentence',contract.capabilities.candidate&&requiresExperienceCandidate(clauseCatalogue) ,boundedReply,planDraftExpectation)
    result=await validateOutput(firstText)
    if(provisionalModelText&&!retainsDraftText(result.reply,provisionalModelText)){
      emit({type:'draft_discarded'})
      staged.audit.push({phase:'model_preview_not_retained',providerCalls:0})
    }
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
  const usage=usageSummary(calls,contextTokenEstimate,retrieved,route.escalated,route.reason,refusalOnly||Boolean(explicitMaterial)||Boolean(deterministicStateReadback))
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



















