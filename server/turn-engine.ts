import {collectReplyMemoryReferences} from './reply-memory-references.ts'
import {explicitTimeEvidenceCandidates} from './growth-time.ts'
import {taskPauseNeedsClarification,profileWritesDisallowed,reportedPurposeClause,actionWriteRestrictions} from './user-command-spans.ts'
import {streamingReplyText} from './reply-stream.ts'
import {ownedOpenDefinitionQuestion,boundedTimedObservationPreview} from './reply-draft.ts'
import {surfaceDirectionScopes} from './growth-controls.ts'
import {randomUUID,createHash} from 'node:crypto'
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {directOrdinaryPolicy,mainCompanionPolicy,readOnlyDecisionPolicy} from './companion-policy.ts'
import {grillingInteractionMode} from './grilling-policy.ts'
import {providerReservationCny,reserveProviderSpend,settleProviderSpend} from './provider-spend.ts'
import {config} from './config.ts'
import { searchCoachEvents, readMatterWorkingSet,readPriorDecision } from './coach-retrieval.ts'
import {rebaseActualDecisionConditions,actualDecisionConditionText as actualConditionsText,reportedComparisonFactClauses,comparisonFactText,continuesDecisionContext,compileDecisionConditions,authorizedDecisionConditions,ownsDecisionCondition,projectDecisionCases,decisionProposalContract,bindDecisionProposalSchema,projectDecisionProposalWire,validateDecisionProposal,decisionReplyInternalFieldsVisible,type DecisionProposal,type DecisionConditions} from './decision-comparison.ts'
import {reportedActualComparisonClauses,reportedActionProgress,reportedDatedMatterChoice,reportedDatedMatterTitle,reportedNamedMatterAcceptance,reportedSwitchedMatterChoice,acceptedStepFromQuote,matchesAcceptedPartialAction,reportedPartialActionOutcomes,projectMatterReport} from './workflows/action-review.ts'
import { retrieveCoachKnowledgeCandidates, validateCoachCitations, readApprovedGuide } from './coach-knowledge.ts'
import { openingQuestionDraft, observationEffectHypothesis, softenSingleObservationCausality, openUnreportedChoiceQuestion, removeQuestionOnZeroTime, enforceReportedQuantity, safeEarlySentence, groundedStateReadback, requestsOnlyStateReadback, retainsDraftText, groundedFeedbackPreview, provisionalStatePreview, provisionalQuestionPreview, provisionalCorrectionPreview, weeklyPlanDraft, weeklyPlanExplanation, requestsOneQuestionReply, type WeeklyPlanDraftExpectation } from './reply-draft.ts'
import { boundedDistinctionReply,unresolvedTwoFactors,distinctionActionAccepts,repairStatusUpdate } from './review-repairs.ts'
import { renderCoachReply } from './coach-reply.ts'
import { stream, parseStreamingJson, type AssistantMessage } from '@mariozechner/pi-ai'
import { HttpError, pool } from './db.ts'
import {classifyProviderFailure,providerError,type ProviderFailureCategory} from './provider-errors.ts'
import { parseActionCoachTurn, finalCoachJsonText, completeCoachJsonFrame, replyBeforeMalformedOptionalFields, actionCoachTurnSchema, type ActionCoachTurn, type CoachOutputRejection } from './action-coach-contracts.ts'
import { coachEventView, coachEventViewWithSources, stageCoachEvent, deliverableIntent, requiresImmediateMaterial, requestsMaterialRewrite, coachMaterialPresentation,requestedBlankJobWorksheet,effectiveMaterialRequest,unchangedProposedAction,unknownQuestionTopicMatches,validateReadOnlyCoachDraft,coachMaterialVisibility,viewOnlyDraftComplete, type CoachEvent, type CoachEventSourceBindings } from './action-coach-events.ts'
import { estimateTokens } from './context.ts'
import { loadSnapshot, stageCoachBackground } from './memory.ts'
import { readKnownMajor } from './model-router.ts'
import { modelCapabilityVerified, modelSignatureFor, resolveModel, type ModelPricing, type ModelRuntime, type ModelTier } from './model.ts'
import { checkModelCooldown } from './operations.ts'
import { acquireProviderDispatchFence,stageCandidate,readInterviewChronologySnapshot, type ProviderDispatchFence,type Run, type Staged } from './store.ts'
import type {GrowthItem} from '../src/features/growth/types.ts'
import { SINGLE_QUESTION_GENERATION_RULES, SINGLE_ACTION_GENERATION_RULES, PERSONAL_ACTION_EVIDENCE_RULES, PARTIAL_FEEDBACK_EVIDENCE_RULE, REPLY_FIRST_STREAMING_RULE, GROUNDED_FEEDBACK_STREAMING_RULE, GROUNDED_ORDINARY_STREAMING_RULE, DIRECT_ORDINARY_REPLY_RULES, ORDINARY_REPLY_FIELD, MATTER_REPORT_RULE, MATTER_FEEDBACK_RULE, PERSISTENCE_RECEIPT_RULE, SEMANTIC_DELIVERY_RULES, EXPLICIT_LATEST_TIME, TENTATIVE_PROGRESS_CLAUSE, NEUTRAL_OTHER_REWRITE, understandingOpeningGenerationRules, buildTurnPrompt, ordinaryHistoryAnswerSources, providerTurnMessages, turnSystemPrompt, promptResponseScopeRules } from './turn-prompt.ts'
import { configureProviderPayload, outputTokenLimit, supportsNativeStrictSchema, type OutputPath } from './model-payload.ts'
import { estimateProviderCallCostCny } from './cost-workload.ts'
import { growthContext, growthSemanticContext, growthBoundaryContext, growthSnapshotKey, growthMessageSourceLocations, stageGrowthUpdates, preciseIsoFromEpochMicros } from './growth.ts'
import { normalizeModelFeedbackDelta,reportedFeedbackProgress } from './growth-model-normalize.ts'
import {resolveOccurredDate} from './growth-time.ts'
import { selectRelevantGrowth, splitGrowthByCurrentTopic } from './growth-selection.ts'
import { readDirectionControls, deriveExplicitDirectionControls, stageDirectionControls, overlayDirectionChanges, directionControlsSnapshotKey, directionScopeLabel, allScopes,mentionedDirectionScopes } from './growth-controls.ts'
import { redactGrowthHistory,currentExperienceEvidence } from './growth-privacy.ts'
import { cozeConfigFrom, cozeMissingConfig, searchCozePublicKnowledge, mapCozeCandidates, CozeRetrievalError } from './coze-knowledge.ts'
import { codeWorkflowConfigFrom, codeWorkflowMissingConfig, searchCodeWorkflowKnowledge, CodeWorkflowError, type CodeWorkflowConfig } from './coze-code-workflow.ts'
import { buildPublicKnowledgeQueryFromText, renderPublicKnowledgeQuery } from './coze-public-query.ts'
import { reportsOwnContribution, buildMaterialFactCatalogue, resolveSelectedMaterialFacts, singleUniqueContributionFact } from './grounded-material.ts'
import { stageWeeklyPlan, renderProposedWeeklyPlan, requiresPlanSlack, normalizeWeeklyPlanTasks, normalizeWeeklyPlanReply } from './weekly-plans.ts'
import { ignorableConnectives } from './turn-obligations.ts'
import { applicableTimeBudget, deriveTurnObligations, isPureZeroPlanRequest, verifyTurnObligations, verifyReplyAgainstObligations, repairReplyBudget, supplementMissingBudgetDeltas, planExplicitCorrection, explicitCorrectionIntent, hoursIn, isPureControlCommand, controlReplyText, isObligationError, requestsTimeArrangement, type TurnObligations } from './turn-obligations.ts'
import { scanUserClauses,assistantRequestClause,conversationPreferenceClause,currentConversationOnly,readbackRequestClause,deferredPursuitClause,refusalPreferenceClause,scopedTaskPauseClause,methodReferenceClause,responseRequestScope,comparisonRequestClause,closingOnlyInstruction,requestsMatterOverview,decisionComparisonRequest,requestsMatterDecision,requestsFeedbackStepRevision } from './user-command-spans.ts'
import {resolveProcessSourceHandles,processSourceClauseId,processFactInputIndices,reportedContribution,clauseMessageSource,buildClauseCatalogue,constrainClauseCatalogueHandles,resolveContiguousClauseRange,sourceQuotesOverlap,sourceQuoteRanges,selectedSourceRange,inheritSourceRange,type ClauseHandle} from './clause-catalogue.ts'
import { clauseExpressesWishToAct, clauseReportsCompleted, clauseReportsPastAction, deriveStructuralLinks, resolveCandidateContent, requiresExperienceCandidate, selectStructuralCandidate, selectStructuralCandidates, sentenceIsFirstPersonPublic } from './experience-content.ts'
import { readStarMapContext } from './user-themes.ts'
import { deriveTurnContract, bindPlanBudgetSchema, bindMaterialDeliverySchema,bindRequestedSummarySchema,bindRequestedComparisonSchema,replyStreamingSchema,comparisonReplyAccepts, requestedComparisonCount,summaryReplyAccepts,isSingleSentenceReply, requestsSingleQuestionMaterial,reportedPursuitClauses,reportedPreferenceClauses,negativePersonalFactClauses, resourceBlockedPersonalFactClauses, reportedTaskOutcomeClauses, reportedPerformedTaskClauses,reportedTaskBoundaryClauses,requestedQuestionEditClauses,resolveRequestedQuestionEdit,selectedRequestedQuestionEditMemory,selectedRequestedQuestionEditMatter,selectedRequestedQuestionEditSource,questionEditMatchesMatter,interveningInterviewTexts,reportedAdoptionClauses } from './turn-contract.ts'
import {unsupportedParticipantReadingClaims,unsupportedPreferenceConstraintClaims} from './turn-contract.ts'
import {reportedSourceContextClauses,reportedCompletedContactClauses,completeUserReply,reportedExternalExpectationClauses,currentParticipantStatusReadback,reportedEvidenceFromText,exactFeedbackReadback,unrelatedExternalCorrection,sameReportedResponseSubject,reportedResponseContinuationTargets} from './turn-contract.ts'
import {comparisonUniverseAccepts,requestedActionLimitAccepts} from './turn-contract.ts'
import { actionReviewHints, continuedActionUsage, canContinueGuideFeedback, authorizedGuideApplication } from './workflows/host.ts'
import { selectHistoryForMode } from './history-selection.ts'
import { goalChangeMarker } from './growth-authority.ts'
import { resolveGrowthDeltas } from './growth-authority.ts'
import { findEpisode,planExplicitExperienceSupplement } from './experience-episodes.ts'
import { detectForgetIntentClauses, detectUnconfirmedLabelRejection, scoreForgetTargets, memoryControlSuccessClaims,violatesLabelInferenceBoundary,samePersonalLabel } from './forget-intent.ts'
import { readRecommendationControls,listControlRequests } from './memory-controls.ts'
import {knowledgeIntent,deduplicateGuides,methodPromptContext} from './evergreen-guide.ts'
import {readGuideUsage,readPriorGuideEvents,classifyGuideFeedback,feedbackMatchesCurrent,guideFeedbackSource} from './guide-usage.ts'
import {boundedOrdinaryReply,boundedRecallReply,bindBoundedReplySchema,boundedReplyAccepts,boundedDraftAccepts,boundedSentenceAccepts,type BoundedReply} from './bounded-reply.ts'
import {jevMethodFitContext,selectJevMethodCandidates} from './jev-method-fit.ts'

export type FocusContext={type:'theme'|'experience';id:string;label:string}
export type EngineInput={run:Run;staged:Staged;context:any[];decision:unknown;signal:AbortSignal;emit:(event:Record<string,unknown>)=>void;focusContext?:FocusContext|null}
export type Engine=((input:EngineInput)=>Promise<{text:string;usage:unknown}>)&{modelManaged?:boolean;modelReadiness?:()=>boolean}
type CallRecord={callId:string;requestId:string;purpose:'turn'|'repair';tier:ModelTier;provider:string;model:string;configSignature:string;providerResponseId:string|null;providerResponseModel:string|null;pricing:ModelPricing|null;outputTokenLimit:number;uncachedInputTokens:number|null;cacheWriteInputTokens:number|null;outputTokens:number|null;cachedInputTokens:number|null;usageCompleteness:'complete'|'partial'|'unavailable';startedAt:string;finishedAt:string|null;latencyMs:number|null;firstRawDeltaMs:number|null;firstQuestionDraftMs:number|null;firstSafeSentenceMs?:number|null;omitQuestionMatterReports:boolean;startedMonotonicMs:number;contextTokenEstimate:number;outcome:'pending'|'completed'|'failed';stopReason?:AssistantMessage['stopReason'];errorCode:string|null;failureCategory:ProviderFailureCategory|null}
type TurnCallRecord=CallRecord&{ordinaryAnswerSourceIds?:readonly string[]}
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

const ordinaryPrivateRecord=/(?:成长档案|个人档案|长期记忆|跨会话记忆|星图|用户画像)|\b(?:your|saved|stored|personal)\s+(?:memory|profile|archive)\b/iu
const ordinaryWriteReceipt=/(?:已(?:经)?|刚刚)[^。！？!?,，；;\n]{0,32}(?:记录|记住|记下|保存|写入|更正|更新|遗忘|删除|同步|归档|加入|添加|存入|调取)|(?:我|这边)[^。！？!?,，；;\n]{0,32}(?:记在|记到|保存|写入|同步|归档|存入)[^。！？!?,，；;\n]{0,24}(?:了|完毕)|(?:根据|依据|结合)你(?:上次|之前|此前|以前)(?:说|提)|\b(?:I(?:['’]ve| have)?\s+(?:saved|recorded|stored|added|updated|deleted|forgotten|remembered|synced|retrieved)|(?:has|have)\s+been\s+(?:saved|recorded|stored|added|updated|deleted|synced)|(?:based on|according to)\s+your\s+(?:saved|stored|previous)\s+(?:memory|records?|notes?))\b/iu
const peerUnderstandingStatement=/(?:^|[，,。；;])\s*(?:(?:这|该)(?:个|项|条)?(?:要求|规则|说明))?(?:大家|同学们?|对方|他们|别人|他人)(?:都|应该|可能|大概|已经|肯定|一定|也许|想必|基本){0,4}(?:(?:懂|理解|清楚|明白|了解)(?:(?:这|该)(?:个|项|条)?(?:要求|规则|说明))?了?|还?有(?:一些|些|一点)?不(?:太)?(?:懂|理解|清楚|明白|了解)(?:的(?:地方|部分|内容))?)(?:[，,。；;]|$)/

async function runModelCall(runtime:ModelRuntime,systemPrompt:string,userPrompt:string,callIndex:number,requestId:string,contextEstimate:number,totalContextEstimate:number,retrievedMemoryCount:number,escalated:boolean,escalationReason:string|null,calls:TurnCallRecord[],signal:AbortSignal,staged:Staged,acquireContextFence:(signal:AbortSignal)=>Promise<ProviderDispatchFence>,capabilityVerified:(tier:ModelTier)=>boolean,purpose:CallRecord['purpose']='turn',schemaOverride?:unknown,schemaName?:string,outputPath:OutputPath='turn',emitDraft?:(text:string,kind:'safe_question'|'safe_sentence'|'stream_reply')=>boolean,observer?:ProviderCallObserver,userId='',resumePortfolioCatalogueIds?:readonly string[],slimUpdateTimeMode=false,clauseIds:readonly string[]=[],earlyDraftMode:'none'|'safe_sentence'|'material_question'|'weekly_plan'='none',requireCandidate=false,boundedReply:BoundedReply|null=null,earlyPlan:WeeklyPlanDraftExpectation|null=null,maxOutputOverride?:number,replyFirstEligible=false,directOrdinary=false):Promise<string>{
  signal.throwIfAborted()
  if(!runtime.available)throw new HttpError(503,'MODEL_TIER_UNAVAILABLE')
  if(!capabilityVerified(runtime.tier))throw new HttpError(503,'MODEL_CAPABILITY_TEST_REQUIRED')
  // One user turn has exactly one paid generation slot. Keep this adjacent to
  // the transport entry so every future call site fails before any side effect.
  if(callIndex!==0||calls.length||purpose!=='turn'||outputPath!=='turn')throw new HttpError(502,'UPSTREAM_CALL_LIMIT')
  const schemaProperties=(schemaOverride as {properties?:Record<string,unknown>}|undefined)?.properties
  const envelope=JSON.parse(userPrompt),authorized=envelope.authorizedContext??envelope,currentMessageId=authorized.currentUserMessage.id
  const progressiveReply=Boolean(replyFirstEligible&&supportsNativeStrictSchema(runtime.model)&&emitDraft&&earlyDraftMode==='safe_sentence'&&!boundedReply&&resumePortfolioCatalogueIds===undefined&&schemaProperties&&!Object.hasOwn(schemaProperties,'decisionProposal'))
  const semanticFeedback=Boolean(authorized.currentTask?.feedbackReport?.reportedOutcome||authorized.currentTask?.priorFeedback?.reportedFacts?.length)
  const compactFeedbackFrame=progressiveReply&&semanticFeedback
  const ordinaryBlock='\n'+DIRECT_ORDINARY_REPLY_RULES
  const groundedOrdinary=directOrdinary&&Boolean(schemaProperties?.reply)&&!semanticFeedback
  const moveOrdinaryBlock=progressiveReply&&groundedOrdinary&&systemPrompt.includes(ordinaryBlock)
  const currentClauses=buildClauseCatalogue(authorized.currentUserMessage.text)
  // Keep references for reply evidence separate from current-turn write handles.
  // `authorized.messages` is the already redacted, selected provider history.
  const ordinaryAnswerSourceIds=groundedOrdinary?[
    ...(authorized.currentUserMessage.clauses??[]).map((source:{id:string})=>source.id),
    ...(authorized.messages as {id:string;role:string;text:string}[]).flatMap((message,index)=>ordinaryHistoryAnswerSources(message,currentMessageId,index).map(source=>source.id)),
  ]:undefined
  if(moveOrdinaryBlock)systemPrompt=systemPrompt.replace(ordinaryBlock,'')
  const frameReply=(schemaProperties?.reply as {description?:string}|undefined)
  if(frameReply?.description?.startsWith(DIRECT_ORDINARY_REPLY_RULES)&&(moveOrdinaryBlock||systemPrompt.includes(DIRECT_ORDINARY_REPLY_RULES))){
    const description=frameReply.description.slice(DIRECT_ORDINARY_REPLY_RULES.length).trimStart()
    schemaOverride={...(schemaOverride as Record<string,unknown>),properties:{...schemaProperties,reply:{...frameReply,description:[ORDINARY_REPLY_FIELD,description].filter(Boolean).join('\n')}}}
  }
  let ordinaryInstruction=''
  if(progressiveReply||ordinaryAnswerSourceIds){
    let frame=schemaOverride as Record<string,any>
    const event=frame.properties.event
    const reports=event?.properties?.matterReports
    // Ask for a state entry only when the host cannot bind the current report.
    const needsReport=compactFeedbackFrame&&Boolean(authorized.currentTask?.feedbackReport?.reportedOutcome&&!authorized.currentTask?.feedbackReport?.sourceBound&&reports)
    const first=needsReport?'event':'reply'
    if(needsReport){
      const feedbackEvent={
        ...event,
        required:[...new Set([...event.required??[],'matterReports'])],
        properties:{...event.properties,matterReports:{...reports,minItems:1}},
      }
      frame={
        ...frame,
        required:[...new Set([...frame.required??[],'event'])],
        properties:{...frame.properties,event:feedbackEvent},
      }
    }
    schemaOverride=replyStreamingSchema(frame,first,ordinaryAnswerSourceIds)
    const ordinaryRules=[GROUNDED_ORDINARY_STREAMING_RULE,reports?MATTER_REPORT_RULE:'',MATTER_FEEDBACK_RULE,PERSISTENCE_RECEIPT_RULE].filter(Boolean).join('\n')
    const instruction=(ordinaryAnswerSourceIds?ordinaryRules:first==='reply'?REPLY_FIRST_STREAMING_RULE:GROUNDED_FEEDBACK_STREAMING_RULE)+'\n'
    if(ordinaryAnswerSourceIds)ordinaryInstruction=instruction
    else systemPrompt=instruction+systemPrompt
    const addedTokens=estimateTokens(instruction);contextEstimate+=addedTokens;totalContextEstimate+=addedTokens
  }
  // Bind the per-turn source handles once before prompt and wire compilation.
  constrainClauseCatalogueHandles(schemaOverride,clauseIds)
  let maxOutputTokens=outputTokenLimit(runtime.model,runtime.tier)
  if(maxOutputOverride!==undefined)maxOutputTokens=Math.min(maxOutputTokens,maxOutputOverride)
  const deliveryFocus=(schemaProperties?.event||schemaProperties?.growthUpdates)&&!boundedReply&&(semanticFeedback||!groundedOrdinary&&!currentClauses.some(clause=>clause.quoteSpans?.length||clause.codeSpans?.length))
    ?'\n\n本轮语义与交付约定\n'+SEMANTIC_DELIVERY_RULES+(semanticFeedback&&!compactFeedbackFrame?'\n'+PARTIAL_FEEDBACK_EVIDENCE_RULE:'')
    :''
  if(deliveryFocus){
    systemPrompt+=deliveryFocus
    const addedTokens=estimateTokens(deliveryFocus)
    contextEstimate+=addedTokens;totalContextEstimate+=addedTokens
  }
  if(moveOrdinaryBlock)systemPrompt+=ordinaryBlock
  if(ordinaryInstruction)systemPrompt+='\n'+ordinaryInstruction
  const feedbackFocus=deliveryFocus&&compactFeedbackFrame
    ?authorized.currentTask?.feedbackReport?.reportedOutcome
      ?'先交付本人报告的动作、程度与有没有帮助，使用实际花费时长。先前的可用时间只属于原时段，不能减去已花时间来算现在还剩多少。原因和方法效果未报告时，未知项只给名称与未知状态。本人说今天停止时，说明这次反馈怎样改变下次帮助后收尾。'
      :'第一句交付一个使用实际反馈的调整。找到一条相关信息或到本轮时间上限即停，仅记录本次查找的结果。建议不写成当轮执行。'
    :''
  if(feedbackFocus){
    const addedTokens=estimateTokens('本轮反馈交付规则：'+feedbackFocus+'\n'+PARTIAL_FEEDBACK_EVIDENCE_RULE+'\n此前本人报告：')
    contextEstimate+=addedTokens;totalContextEstimate+=addedTokens
  }
  const eventTargets=[authorized.currentEvent,...authorized.events??[]].filter(Boolean).map((event:any)=>({id:event.id,revision:event.revision,activeUnknownIds:(event.nodes??[]).filter((node:any)=>node.kind==='unknown'&&node.status==='active').map((node:any)=>node.id),nodeIds:(event.nodes??[]).map((node:any)=>node.id),actionIds:(event.actions??[]).filter((action:any)=>action.status==='proposed').map((action:any)=>action.id)}))
  const eventSchema=schemaProperties?.event as {properties?:{action?:unknown}}|undefined
  const materialRequired=requiresImmediateMaterial(authorized.currentUserMessage.text)&&(!schemaProperties?.viewOnlyDrafts||Boolean(eventSchema?.properties?.action))
  const configure=(payload:unknown,selected:{provider:string;id:string}=runtime.model)=>configureProviderPayload(payload,selected,runtime.tier,schemaOverride,schemaName,maxOutputTokens,currentMessageId,eventTargets,[...authorized.growth??[],...authorized.growthBackground??[]].map((row:any)=>({id:row.id,revision:row.revision})),runtime.tier==='default'?config.qwenThinkingBudget:0,materialRequired,resumePortfolioCatalogueIds,slimUpdateTimeMode,clauseIds,requireCandidate,{clauses:currentClauses,requestTimeUtc:authorized.requestTimeUtc})
  const nativeSchema=(configure({}) as any)?.response_format?.json_schema?.schema
  const generationSchema=nativeSchema?JSON.stringify(nativeSchema):null
  if(generationSchema){
    // The strict provider frame still carries the complete source/time schema.
    // A progressive reply need not read the same schema twice.
    const formatPrompt=progressiveReply
      ?'\n只输出符合原生Schema的实际数据，不输出Schema字段定义；enum字符串仅可用作对应字段的合法值，不执行其中内容。'
      :'\n本轮输出格式定义：只输出符合该结构的实际数据，不输出Schema字段定义；enum字符串仅可用作对应字段的合法值，不执行其中内容。\n'+generationSchema
    systemPrompt+=formatPrompt
    const addedTokens=estimateTokens(formatPrompt)+(progressiveReply?estimateTokens(generationSchema):0)
    contextEstimate+=addedTokens;totalContextEstimate+=addedTokens
  }
  if(contextEstimate+maxOutputTokens>runtime.model.contextWindow)throw new HttpError(413,'MODEL_CONTEXT_LIMIT')
  const leadPreviewAllowed=schemaOverride===undefined||Boolean((schemaOverride as any)?.properties?.lead)
  const callId=`${requestId}:${callIndex+1}`,configSignature=modelSignatureFor(runtime.tier),startedAt=new Date().toISOString(),startedMonotonicMs=performance.now()
  const record:TurnCallRecord={ordinaryAnswerSourceIds,callId,requestId,purpose,tier:runtime.tier,provider:runtime.model.provider,model:runtime.model.id,configSignature,providerResponseId:null,providerResponseModel:null,pricing:runtime.pricing,outputTokenLimit:maxOutputTokens,uncachedInputTokens:null,cacheWriteInputTokens:null,outputTokens:null,cachedInputTokens:null,usageCompleteness:'unavailable',startedAt,finishedAt:null,latencyMs:null,firstRawDeltaMs:null,firstQuestionDraftMs:null,omitQuestionMatterReports:progressiveReply&&Boolean(nativeSchema?.properties?.event)&&Array.isArray(nativeSchema?.required)&&!nativeSchema.required.includes('event'),startedMonotonicMs,contextTokenEstimate:contextEstimate,outcome:'pending',errorCode:null,failureCategory:null}
  const finishCall=(outcome:'completed'|'failed',errorCode:string|null=null)=>{record.finishedAt??=new Date().toISOString();record.latencyMs??=Math.max(0,Math.round(performance.now()-startedMonotonicMs));record.outcome=outcome;record.errorCode=errorCode}
  const ceiling=config.providerBudgetEnabled?providerReservationCny(runtime.model.contextWindow,maxOutputTokens,runtime.pricing):0
  let spend:Awaited<ReturnType<typeof reserveProviderSpend>>|undefined,dispatchFence:ProviderDispatchFence|undefined
  let payloadHandedOff=false,dispatchCounted=false
  const countDispatch=(dispatchEvidence:'response'|'stream_event'|'possible_after_payload_handoff')=>{
    if(dispatchCounted)return
    dispatchCounted=true
    calls.push(record);staged.upstreamCalls=calls.length
    staged.modelUsage=usageSummary(calls,totalContextEstimate,retrievedMemoryCount,escalated,escalationReason)
    staged.audit.push({phase:'model_call_started',call:callIndex+1,callId,requestId,purpose,tier:runtime.tier,provider:runtime.model.provider,model:runtime.model.id,configSignature,providerResponseId:null,outputTokenLimit:maxOutputTokens,outputPath,schemaName:schemaName??null,startedAt,contextTokenEstimate:contextEstimate,contextTokenEstimateKind:'heuristic',dispatchEvidence})
  }
  await observer?.before(Object.freeze({...record}))
  let streamedText=''
  const frameAbort=new AbortController()
  const deadlineSignal=AbortSignal.timeout(60000)
  const providerSignal=AbortSignal.any([signal,frameAbort.signal,deadlineSignal])
  try{
    const nativeFactFrame=Boolean((schemaOverride as any)?.properties?.growthUpdates?.items?.anyOf?.some((branch:any)=>branch.properties?.contribution))
    const messages=providerTurnMessages(userPrompt,runtime.model,systemPrompt,nativeFactFrame,feedbackFocus?feedbackFocus+'\n'+PARTIAL_FEEDBACK_EVIDENCE_RULE:'',groundedOrdinary)
    // `pi-ai` does not promise to await `onPayload`. Commit the short spend
    // reservation before checking out the long-lived source-fence client.
    // Reversing that order lets same-user fence waiters consume the whole pool
    // while the lock owner still needs another client for its reservation.
    // No transport starts until both independent authorities are held.
    spend=await reserveProviderSpend({user:userId,requestId,callIndex:callIndex+1,provider:runtime.model.provider,model:runtime.model.id,ceilingCny:ceiling})
    dispatchFence=await acquireContextFence(providerSignal)
    signal.throwIfAborted()
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
      staged.audit.push({phase:'provider_transport_stop_applied',stops:(configured as {stop?:string[]}).stop??[],providerCalls:0})
      // Actual outgoing instructions, tied to the existing call/completion and
      // final commit receipt. Never log user context or assert model compliance.
      const configuredText=JSON.stringify(configured)
       const appliedPolicy=[mainCompanionPolicy,readOnlyDecisionPolicy,directOrdinaryPolicy].find(policy=>systemPrompt.includes(policy.instructions)&&configuredText.includes(JSON.stringify(policy.instructions).slice(1,-1)))
      if(appliedPolicy){
        staged.audit.push({phase:'main_skill_payload',callId,requestId,skill:appliedPolicy.name,skillVersion:appliedPolicy.version,skillDigest:appliedPolicy.sourceDigest,policyDigest:appliedPolicy.policyDigest,scope:appliedPolicy.scope,status:'included_in_provider_payload'})
      }
      if(appliedPolicy===mainCompanionPolicy){
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
      // The SDK invokes onPayload immediately before constructing the HTTP
      // request. Until this callback completes, a synchronous stream failure,
      // failed payload check or already-observed abort is provably not sent.
      providerSignal.throwIfAborted()
      payloadHandedOff=true
      return configured
    },onResponse:()=>{countDispatch('response')}})
    let partialReply='',draftSent=false,lastStreamText='',lastStreamAt=0
    const emitProgressiveReply=(now:number)=>{
      const preview=streamingReplyText(partialReply,ordinaryAnswerSourceIds)
      if(preview&&preview!==lastStreamText&&emitDraft?.(preview,'stream_reply')===true){lastStreamText=preview;draftSent=true;record.firstSafeSentenceMs??=Math.max(0,Math.round(now-startedMonotonicMs))}
    }
    // G3: reply_only may surface the FIRST complete safe sentence; every
    // other mode still waits for a complete safe question. Both draft paths
    // are display-only — the saved state comes exclusively from finishRun.
    let earlyDraftKind:'none'|'safe_sentence'|'safe_question'='none'
    // A budget acknowledgement is only a waiting hint, so it is not emitted
    // through the substantive draft lane. The validated allocation below owns
    // that lane and its first-content timing.
    for await(const event of source){
      if(payloadHandedOff&&event.type!=='start'&&event.type!=='error')countDispatch('stream_event')
      signal.throwIfAborted()
      if(event.type==='text_delta'){
        record.firstRawDeltaMs??=Math.max(0,Math.round(performance.now()-startedMonotonicMs));streamedText+=event.delta
        partialReply+=event.delta
      }
      // Catalogue-backed material is rendered by the host after validation;
      // model prose cannot be its first delivered content or a completion receipt.
      if(event.type==='text_delta'&&emitDraft&&!progressiveReply&&!ordinaryAnswerSourceIds&&!draftSent&&resumePortfolioCatalogueIds===undefined){
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
      if(event.type==='text_delta'&&emitDraft&&progressiveReply){
        const now=performance.now()
        if(now-lastStreamAt>=80){
          lastStreamAt=now
           emitProgressiveReply(now)
        }
      }
    }
    if(emitDraft&&progressiveReply)emitProgressiveReply(performance.now())
    ;(record as {earlyDraftKind?:string}).earlyDraftKind=earlyDraftKind
    const message=await source.result()
    record.stopReason=message.stopReason
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
    staged.modelUsage=usageSummary(calls,totalContextEstimate,retrievedMemoryCount,escalated,escalationReason)
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
    // After the SDK owns the payload, error wording does not prove that the
    // HTTP request stayed local. Keep uncertain spend in the existing ledger.
    if(payloadHandedOff)countDispatch('possible_after_payload_handoff')
    if(!dispatchCounted){
      const code=error instanceof HttpError?error.code:'MODEL_REQUEST_FAILED'
      finishCall('failed',code)
      staged.audit.push({phase:'provider_dispatch_blocked',callId,requestId,code,providerCalls:0})
      throw error instanceof HttpError?error:providerError(error instanceof Error?error.message:'Provider request failed')
    }
    if(!record.failureCategory&&!(error instanceof HttpError))record.failureCategory=classifyProviderFailure(error instanceof Error?error.message:String(error))
    const code=error instanceof HttpError?error.code:'MODEL_REQUEST_FAILED'
    const failedStreamSha=createHash('sha256').update(streamedText).digest('hex')
    staged.audit.push({phase:'provider_output_stages',callId,requestId,streamChars:streamedText.length,resultChars:'unknown',normalizedChars:'unknown',streamEqualsResult:'unknown',resultEqualsNormalized:'unknown',streamSha256:failedStreamSha,resultSha256:'unknown',normalizedSha256:'unknown',stopReason:'unavailable_before_sdk_result',normalizationApplied:'unknown',providerCalls:0})
    finishCall('failed',code)
    staged.modelUsage=usageSummary(calls,totalContextEstimate,retrievedMemoryCount,escalated,escalationReason)
    staged.audit.push({phase:'model_call_failed',call:callIndex+1,callId,requestId,providerResponseId:record.providerResponseId,providerResponseModel:record.providerResponseModel,configSignature,startedAt:record.startedAt,finishedAt:record.finishedAt,latencyMs:record.latencyMs,firstRawDeltaMs:record.firstRawDeltaMs,firstQuestionDraftMs:record.firstQuestionDraftMs,usageCompleteness:record.usageCompleteness,purpose,tier:runtime.tier,provider:runtime.model.provider,model:runtime.model.id,outputTokenLimit:maxOutputTokens,outputPath,schemaName:schemaName??null,uncachedInputTokens:record.uncachedInputTokens??'unknown',uncachedInputIncludesCacheWrite:false,cacheWriteInputTokens:record.cacheWriteInputTokens??'unknown',cachedInputTokens:record.cachedInputTokens??'unknown',outputTokens:record.outputTokens??'unknown',estimatedCostCny:record.usageCompleteness==='complete'?callCost(record.uncachedInputTokens!+record.cacheWriteInputTokens!,record.cachedInputTokens!,record.outputTokens!,record.pricing):'unknown',code,failureCategory:record.failureCategory})
    throw error instanceof HttpError?error:providerError(error instanceof Error?error.message:'Provider request failed')
  }finally{
    frameAbort.abort()
    // Keep source authority valid through every externally visible draft.
    // After stream assembly no more private prose is emitted; final text still
    // waits for finishRun's fresh snapshot validation.
    const fence=dispatchFence;dispatchFence=undefined
    let releaseError:unknown
    try{await fence?.release()}catch(error){releaseError=error}
    const cost=record.usageCompleteness==='complete'?callCost(record.uncachedInputTokens!+record.cacheWriteInputTokens!,record.cachedInputTokens!,record.outputTokens!,record.pricing):'unknown'
    // Preserve both independent receipts even if either settlement fails.
    let expenseError:unknown
    if(spend)try{const settled=await settleProviderSpend(spend,dispatchCounted?cost:0,!dispatchCounted);if(settled?.overrun)expenseError=new HttpError(503,'PROVIDER_PRICE_CHANGED')}catch(error){expenseError=error}
    await observer?.after(Object.freeze({...record}))
    if(releaseError)throw releaseError
    if(expenseError)throw expenseError
  }
}

async function runDialogueTurn({run,staged,context,signal,emit,focusContext}:EngineInput,capabilityVerified:(tier:ModelTier)=>boolean,observer?:ProviderCallObserver){
  signal.throwIfAborted()
  const current=context.find(row=>row.id===run.source_message_id)
  if(!current||current.role!=='user')throw new HttpError(409,'CURRENT_MESSAGE_MISSING')
  const trialHistoryIds=new Set<string>()
  let hasPriorDecision=false,lastTrial=false,lastComparison=false
  let previousComparisonUser:string|null=null,previousComparisonReply:string|null=null,realComparisonUser:string|null=null,realComparisonReply:string|null=null
  let previousComparisonRefs:string[]=[]
  let previousProposal:(DecisionProposal&{conditions?:DecisionConditions;realConditions?:DecisionConditions})|null=null,rememberedBaselineSource:string|null=null,priorDecisionMissing=false
  let rememberedConditionSources:string[]=[]
  let supplementFieldSources:Record<string,{messageId:string;valueDigest:string}>={}
  for(const row of context.filter(row=>row.id!==current.id)){
    if(row.decision_context_gap){hasPriorDecision=false;lastTrial=false;lastComparison=false;previousComparisonUser=null;previousComparisonReply=null;previousComparisonRefs=[];previousProposal=null;realComparisonUser=null;realComparisonReply=null;rememberedConditionSources=[];continue}
    if(row.role==='user'){
      const trial=decisionComparisonRequest(row.content,hasPriorDecision||row.decision_comparison===true)
      lastTrial=trial!==null;lastComparison=row.completed_decision===true&&(lastTrial||requestsMatterDecision(row.content))
      hasPriorDecision=lastComparison||hasPriorDecision&&continuesDecisionContext(row.content)
      if(lastComparison){hasPriorDecision=true;previousComparisonUser=row.id;previousComparisonReply=null;previousComparisonRefs=(row.comparison_event_refs??[]).map((ref:{eventId:string})=>ref.eventId);previousProposal=row.decision_proposal??null;rememberedConditionSources=row.comparison_condition_sources??[];if(!lastTrial){realComparisonUser=row.id;realComparisonReply=null}}
      if(/^(?:换个话题|今天到这里|不用比较了)|^(?:好[，,])?(?:先这样|就这样|先到这里)/.test(row.content))hasPriorDecision=false
      if(!hasPriorDecision){previousComparisonUser=null;previousComparisonReply=null;previousComparisonRefs=[];previousProposal=null;realComparisonUser=null;realComparisonReply=null;rememberedConditionSources=[]}
    }else if(lastComparison){previousComparisonReply=row.id;if(!lastTrial)realComparisonReply=row.id}
    else if(row.completed_decision===true&&(row.decision_comparison===true||row.decision_proposal)&&!previousComparisonUser){previousComparisonReply=row.id;previousComparisonRefs=(row.comparison_event_refs??[]).map((ref:{eventId:string})=>ref.eventId);previousProposal=row.decision_proposal??null;rememberedConditionSources=row.comparison_condition_sources??[];hasPriorDecision=true}
    if(lastTrial||row.decision_comparison===true)trialHistoryIds.add(row.id)
  }
  // Real privacy commands retain their normal transaction, even in a turn
  // which also mentions a comparison. A trial cannot override withdrawal.
  const decisionComparison=decisionComparisonRequest(current.content,hasPriorDecision)
  if(decisionComparison&&!hasPriorDecision&&!previousComparisonRefs.length&&!/(?:手头(?:的)?(?:这些)?事|这些(?:事|事项|任务)|当前事项|我的(?:事项|任务)|之前|上次|刚才|原来|恢复|回到)/.test(current.content))priorDecisionMissing=true
  if(decisionComparison&&(hasPriorDecision||decisionComparison==='restore'||/(?:之前|上次|刚才|原来|原先|上一轮)/.test(current.content))){
    const prior=await readPriorDecision(run.user_id,run.conversation_id)
    if(prior?.eventRefs?.length){previousComparisonUser=prior.sourceMessageId;previousComparisonRefs=prior.eventRefs.map((ref:{eventId:string})=>ref.eventId);previousProposal=prior.proposal??null;rememberedConditionSources=prior.conditionSources??[];supplementFieldSources=prior.supplementFieldSources??{};rememberedBaselineSource=prior.baselineSourceMessageId??(!prior.isTrial?prior.sourceMessageId:null)}
    else {priorDecisionMissing=true;previousComparisonUser=null;previousComparisonReply=null;previousComparisonRefs=[];previousProposal=null;rememberedConditionSources=[];rememberedBaselineSource=null;realComparisonUser=null;realComparisonReply=null}
  }
  const actionComparisonClauses=decisionComparison?reportedActualComparisonClauses(current.content):[]
  const comparisonLabelControl=decisionComparison?detectUnconfirmedLabelRejection(current.content):null
  const privacyComparisonClauses=comparisonLabelControl?scanUserClauses(current.content).filter(c=>!c.conditional&&!c.quoted&&!c.code&&!c.attributedToOther&&comparisonLabelControl.boundaryQuotes.includes(c.text.trim())):[]
  const comparisonFactClauses=decisionComparison?reportedComparisonFactClauses(current.content).filter(clause=>!actionComparisonClauses.some(action=>action.start===clause.start)&&!privacyComparisonClauses.some(privacy=>privacy.start===clause.start)):[]
  const comparisonFactQuotes=new Set(comparisonFactClauses.map(clause=>clause.text))
  const actualComparisonClauses=[...actionComparisonClauses,...privacyComparisonClauses,...comparisonFactClauses].sort((a,b)=>a.start-b.start)
  const personalWritesBlocked=Boolean(decisionComparison)&&!actualComparisonClauses.length||profileWritesDisallowed(current.content)
  const actualWriteText=decisionComparison?(personalWritesBlocked?'':comparisonFactText(current.content,actualComparisonClauses)):current.content
  const factualWriteText=decisionComparison?comparisonFactText(current.content,comparisonFactClauses):current.content
  if(decisionComparison)staged.comparisonActualQuotes=actualComparisonClauses.map(c=>c.text)
  const priorUserTexts=context.filter(row=>row.role==='user'&&row.id!==current.id&&!trialHistoryIds.has(row.id)).slice(-8).map(row=>row.content)
  const snapshot=await loadSnapshot(run.user_id,run.conversation_id,current.content)
  if(snapshot.settings.enabled&&snapshot.confirmedExperiences.length)emit({type:'progress',stage:'background'})
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
    const privacySpans=decisionComparison?scanUserClauses(current.content).filter(c=>rejection.boundaryQuotes.includes(c.text.trim())):[]
    const privacySpan=privacySpans.length?current.content.slice(privacySpans[0].start,privacySpans.at(-1)!.end):''
    const boundaryQuote=decisionComparison?(privacySpan&&scanUserClauses(privacySpan).every(c=>rejection.boundaryQuotes.includes(c.text.trim()))?privacySpan:rejection.boundaryQuotes.find(q=>q.includes(rejection.label))??rejection.boundaryQuotes[0]):current.content
    if(!boundaryQuote||staged.growth?.changes.some(delta=>delta.source.messageId===run.source_message_id&&delta.source.quote===boundaryQuote))return false
    const boundary=await stageGrowthUpdates(run,[{target:{operation:'create' as const},assertion:'user_reported' as const,kind:'context' as const,source:{messageId:run.source_message_id,quote:boundaryQuote}}],authorized)
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
  const turnDerivedControls=deriveExplicitDirectionControls(actualWriteText)
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
  const resumePortfolioMode=requiresImmediateMaterial(current.content)&&!requestsMaterialRewrite(current.content)&&(contributionDescription||/简历|作品清单|作品集|个人介绍/.test(current.content))
  const obligations=deriveTurnObligations(actualWriteText,{resumePortfolioMode,...(turnDerivedControls.status==='explicit'?{directionControls:turnDerivedControls.changes}:{})})
  if(decisionComparison){staged.audit.push({phase:'decision_comparison_read_only',mode:decisionComparison,persistence:'TURN_ONLY_NOT_USER_FACTS',separateActualClauses:actualComparisonClauses.length,providerCalls:0})}
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
  const conversationEventId=currentEvent?.id
  const retrievalStarted=performance.now()
  const retrieval=await searchCoachEvents(run.user_id,run.conversation_id,{query:current.content},signal)
  staged.audit.push({phase:'coach_retrieval_completed',latencyMs:Math.round(performance.now()-retrievalStarted),eventCount:retrieval.events.length,indexPending:retrieval.indexPending,ambiguous:retrieval.ambiguous,embedding:'local_offline'})
  let historicalEvents=retrieval.events.filter(event=>event.id!==currentEvent?.id)
  const comparisonBasis=decisionComparison?previousComparisonRefs:[]
  const matterWorkingSetStarted=performance.now()
  const matterWorkingSet=priorDecisionMissing?{events:[] as CoachEvent[],sourceControls:{} as Record<string,string>,coverage:{scope:'ORIGINAL_COMPARISON_UNAVAILABLE',candidateLimit:0,relatedCaseLimit:0,moreAvailable:false,selection:'original comparison unavailable; do not replace with unrelated recent matters'}}:requestsMatterDecision(current.content)||decisionComparison?await readMatterWorkingSet(run.user_id,run.conversation_id,signal,[...(currentEvent?[currentEvent.id]:[]),...historicalEvents.map(event=>event.id)],comparisonBasis):null
  if(matterWorkingSet){
    currentEvent=currentEvent?matterWorkingSet.events.find(event=>event.id===currentEvent!.id)??null:null
    historicalEvents=matterWorkingSet.events.filter(event=>event.id!==currentEvent?.id)
    staged.audit.push({phase:'matter_working_set_bound',eventCount:historicalEvents.length+(currentEvent?1:0),latencyMs:Math.round(performance.now()-matterWorkingSetStarted),coverage:matterWorkingSet.coverage,providerCalls:0})
  }
  preRetrievalMs=Math.round(performance.now()-engineStageClock)
  const knowledgeStart=performance.now()
  let authorizedHistory=await redactGrowthHistory(run.user_id,context.filter(row=>!row.decision_context_gap&&(row.id===run.source_message_id||!snapshot.suppressedMessageIds?.includes(row.id))))
  if(decisionComparison){
    const remembered=realComparisonUser??rememberedBaselineSource??(previousComparisonRefs.length?context.slice().reverse().find(row=>row.comparison_baseline_source)?.comparison_baseline_source:null)
    const missing=[...new Set([remembered,previousComparisonUser,...rememberedConditionSources.slice(0,64)].filter((id):id is string=>typeof id==='string'&&!snapshot.suppressedMessageIds?.includes(id)&&!authorizedHistory.some(row=>row.id===id)))]
    if(missing.length){
      const rows=(await pool.query("SELECT m.id,m.role,m.content,m.created_at,floor(extract(epoch FROM m.created_at)*1000000)::text AS decision_created_micros,(r.status='completed') AS completed_decision,r.tool_audit @> jsonb_build_array(jsonb_build_object('phase','decision_comparison_read_only')) AS decision_comparison FROM messages m JOIN runs r ON r.user_id=m.user_id AND r.request_id=m.run_request_id WHERE m.user_id=$1 AND m.conversation_id=$2 AND m.id::text=ANY($3::text[]) AND m.role='user' AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=m.user_id AND d.conversation_id=m.conversation_id)",[run.user_id,run.conversation_id,missing])).rows
      for(const row of rows)if(row.decision_comparison)trialHistoryIds.add(row.id)
      authorizedHistory=[...await redactGrowthHistory(run.user_id,rows),...authorizedHistory]
    }
    if(typeof remembered==='string'&&authorizedHistory.some(row=>row.id===remembered))realComparisonUser=remembered
  }
  if(decisionComparison)staged.audit.push({phase:'decision_comparison_baseline_bound',sourceMessageId:realComparisonUser,persistence:'REFERENCE_TO_USER_CONDITIONS_NOT_PROFILE_UPDATE',providerCalls:0})
  // Trial transcripts remain visible in chat, but do not become later factual
  // context. A new comparison gets only explicitly labelled authorized trials.
  const allContextMessages=authorizedHistory.flatMap(row=>{
    if(decisionComparison&&row.role==='assistant')return []
    if(row.id===current.id||!trialHistoryIds.has(row.id))return [row]
    const actual=row.role==='user'?reportedActualComparisonClauses(row.content).map(c=>c.text).join('。'):''
    return actual?[{...row,content:actual}]:[]
  })
  const comparisonTranscript=(userId:string|null,replyId:string|null)=>{
    const request=authorizedHistory.find(row=>row.id===userId),reply=authorizedHistory.find(row=>row.id===replyId)
    return request||reply?{sourceMessageId:request?.id??null,conditionsText:request?.content??null,reportedAt:request?.created_at??null,hasCompletedReply:Boolean(reply||request?.completed_decision),assistantProseExcluded:true}:null
  }
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
    for(const event of guideEvents.filter(event=>(!matterWorkingSet||matterWorkingSet.events.some(selected=>selected.id===event.id))&&feedbackMatchesCurrent(current.content,event.title,event.title))){
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
  staged.usedEventRefs=[...(currentEvent?[currentEvent]:[]),...historicalEvents].map(event=>({eventId:event.id,revision:event.revision,generation:event.generation,...(matterWorkingSet?{sourceControlKey:matterWorkingSet.sourceControls[event.id]}:{})}))
  staged.audit.push({phase:'coach_context_bound',eventRefs:staged.usedEventRefs,currentEventId:currentEvent?.id??null,scope:'supplied_context_only_not_proof_of_effective_help',providerCalls:0})
  const route={tier:'default' as const,escalated:false,reason:null},runtime=resolveModel('default')
  const growthSemantic=await growthSemanticContext(run.user_id,run.conversation_id)
  const growthAll=growthSemantic.items
  const correctionCandidates=growthAll.map(item=>({id:item.id,revision:item.revision,kind:item.kind,assertion:item.assertion,text:item.text,sourceIds:item.sources.filter(source=>source.type==='message').map(source=>source.id)}))
  const correctionPlan=planExplicitCorrection(factualWriteText,correctionCandidates)
  // Normalize every engine-originated delta, including correction/supplement
  // branches, before the strict growth store. The store itself keeps rejecting
  // invalid feedback; only the model-facing wrapper repairs optional fields.
  // Matter transitions and privacy use their own existing transactions.
  // A comparison's growth lane can use only the independent report or correction.
  const stageGrowth=async (deltas:any[],options:any={})=>{
    const authorized=personalWritesBlocked?[]:!decisionComparison?deltas:deltas.filter(delta=>{
      const source=delta.source,quote=source.quote
      if(source.messageId!==run.source_message_id||!comparisonFactQuotes.has(quote)&&correctionPlan?.newQuote!==quote)return false
      const selected=selectedSourceRange(source)
      const occurrences=sourceQuoteRanges(current.content,quote)
      if(!selected&&occurrences.length!==1)return false
      const ranges=occurrences.filter(range=>{
        if(selected&&(selected.start!==range.start||selected.end!==range.end))return false
        const spans=comparisonFactClauses.filter(clause=>clause.start>=range.start&&clause.end<=range.end)
        return spans[0]?.start===range.start&&spans.at(-1)?.end===range.end&&comparisonFactText(current.content,spans)===quote
      })
      if(ranges.length!==1)return false
      if(!selected)inheritSourceRange(clauseMessageSource(run.source_message_id,{start:ranges[0]!.start,text:quote}),source)
      return true
    })
    return stageGrowthUpdates(run,authorized.map(delta=>normalizeModelFeedbackDelta(delta)) as any,growthAll,options)
  }
  // P4 B1: relevance-based selection within a pre-declared budget; the full
  // authorized set still drives staging/snapshot checks - only the prompt
  // context is selected so large archives do not serialize wholesale.
  const recommendationStopped=new Set((await readRecommendationControls(run.user_id)).map(row=>row.itemId))
  const pendingRecommendationIds=new Set((await listControlRequests(run.user_id)).filter(row=>row.status==='pending'&&row.kind==='stop_recommend').flatMap(row=>row.candidates.map(candidate=>candidate.itemId)))
  const recommendationBlockedIds=new Set([...recommendationStopped,...pendingRecommendationIds])
  const unresolvedTaskBoundaries=growthAll.filter(item=>item.status==='active'&&!item.unavailableReason&&item.taskBoundary)
  const clauseCatalogue=buildClauseCatalogue(current.content).filter(c=>!decisionComparison||actualComparisonClauses.some(real=>real.start===c.start&&real.end===c.end))
  const experienceCandidateRequired=requiresExperienceCandidate(clauseCatalogue)
  const refusalOnly=Boolean(currentConversationOnly(current.content)&&clauseCatalogue.some(c=>refusalPreferenceClause(c.text))&&clauseCatalogue.every(c=>conversationPreferenceClause(c.text)||/^(?:按上次办法|还是上次那件事|上次那件事)$/.test(c.text)))
  const turnNeedsControlReceipt=turnDerivedControls.status!=='none'||detectForgetIntentClauses(current.content).length>0||reportedTaskBoundaryClauses(current.content).some(clause=>scopedTaskPauseClause(clause.text))
  const newMatterExplicit=scanUserClauses(current.content).some(clause=>!clause.conditional&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&/(?:换个|换一件|另一件|另一个|新事情|新话题|转到|转而|不谈上次)/.test(clause.text))
  const explicitMaterialRequest=clauseCatalogue.some(clause=>!clause.conditional&&!clause.interrogative&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&deliverableIntent(clause.text,'create'))
  const imperativeRecallRequest=clauseCatalogue.some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&readbackRequestClause(clause.text))
  const explicitRecallRequest=imperativeRecallRequest||/^(?:请|帮我|麻烦)?(?:回顾|总结|复述|回读|列出)(?:一下)?[:：]?/.test(current.content)
  const asksRecall=explicitRecallRequest||methodIntent.reason==='memory_query'||/(?:我报告过|我之前把|按我(?:提供|报告)|你(?:目前|现在)?知道.{0,20}(?:实际做过|做过什么|报告过)|你会把|是不是(?:等于|意味着)|如果.{0,15}只想聊天)|^(?:我)?(?:本周|这周).{0,35}(?:是多少|多久|多少时间)/.test(current.content)
  const onlyReadback=clauseCatalogue.every(clause=>clause.interrogative||clause.conditional||clause.quoted||clause.code||clause.attributedToOther||assistantRequestClause(clause.text)||/^(?:请)?只(?:按|说|回答|回顾|说明)|^按我(?:提供|报告)|^上次[^我本人]{1,24}那件事$/.test(clause.text))
  const [recallScope,...recallParts]=clauseCatalogue
  const savedReadbackOnly=Boolean(imperativeRecallRequest&&recallScope&&!recallScope.quoted&&!recallScope.code&&!recallScope.conditional&&!recallScope.attributedToOther&&/^(?:请)?只(?:根据|依据|按)(?:仍然|仍|当前|已经|已|还)?(?:保存|保留|记录)的(?:事实|信息|资料|档案)$/.test(recallScope.text)&&recallParts.every(clause=>
    assistantRequestClause(clause.text)||/^(?:以及|并且?|另外)?(?:下次|之后|以后)(?:该|应|要|可以)?(?:如何|怎么)(?:验证|核实|核对|检查|比较).+$/.test(clause.text)||/^(?:我的|本人的)?(?!我|本人)[\p{L}\p{N}]{1,24}(?:经历|背景|记录|能力|技能|专业|结果|资料)$/u.test(clause.text)))
  const historicalEvidenceOnly=Boolean(recallScope&&!recallScope.quoted&&!recallScope.code&&!recallScope.conditional&&!recallScope.attributedToOther&&/^(?:接着|继续|回到)(?:上次|之前|先前)的?[^。！？]{1,24}(?:经历|事项|尝试|反馈)$/.test(recallScope.text)&&recallParts.some(clause=>clause.interrogative&&/^(?:我|本人)(?:上次|之前|实际)?做过.{0,12}(?:是什么|有哪些|是什么样)$/.test(clause.text))&&recallParts.every(clause=>clause.interrogative&&!clause.conditional&&!clause.attributedToOther))
  const sourceReadbackOnly=savedReadbackOnly||historicalEvidenceOnly
  const readOnlyQuestion=obligations.requiredEffects.length===0&&!currentConversationOnly(current.content)&&!explicitMaterialRequest&&(sourceReadbackOnly&&!turnNeedsControlReceipt||methodIntent.decision==='NONE'&&asksRecall&&(onlyReadback||explicitRecallRequest)&&(imperativeRecallRequest||clauseCatalogue.some(clause=>clause.interrogative)))
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
    const priorQuestionRequest=[...allContextMessages].reverse().find(message=>message.id!==run.source_message_id&&message.role==='user')
    const answersDefinition=Boolean(priorQuestionRequest&&ownedOpenDefinitionQuestion(unknown.content,priorQuestionRequest.content)&&reportedEvidenceFromText(current.content).preferences.length)
    if(!answersDefinition&&[...answerChars].filter(char=>unknownChars.has(char)).length<2)return null
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
  const evidenceExperiences=await currentExperienceEvidence(pool,run.user_id,snapshot.confirmedExperiences)
  const materialCatalogue=resumePortfolioMode?buildMaterialFactCatalogue(
    growth,
    evidenceExperiences,
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
  const actionRestrictions=actionWriteRestrictions(current.content)
  const materialOperation=currentEvent?.actions.some(action=>action.status==='proposed')?'modify':'create'
  const materialVisibility=explicitMaterialRequest?coachMaterialVisibility(current.content):null
  const viewOnlyDrafts=materialVisibility?.viewOnly??[]
  const readOnlyMaterial=materialVisibility?.allReadOnly===true
  const mixedViewOnly=viewOnlyDrafts.length>0&&!readOnlyMaterial
  const materialPersistenceRefused=readOnlyMaterial||actionRestrictions[materialOperation]
  if(actionRestrictions.plan||materialPersistenceRefused)obligations.requiredEffects=obligations.requiredEffects.filter(effect=>!(actionRestrictions.plan&&effect.type==='weekly_plan')&&!(materialPersistenceRefused&&effect.type==='grounded_material'))
  const planIntent=!actionRestrictions.plan&&!decisionComparison&&!boundaryNeedsClarification&&(requestsTimeArrangement(current.content)||obligations.requiredEffects.some(effect=>effect.type==='weekly_plan'))
  // The contract must offer the material lane exactly when validation can
  // DEMAND it: deliverableIntent is the same detector the material-visibility
  // check uses (怎么开口 counts as a deliverable request), so the schema and
  // the validator can never disagree about the lane.
  const materialIntent=!materialPersistenceRefused&&!decisionComparison&&!readOnlyQuestion&&!instructionOnlySummary&&!boundaryNeedsClarification&&(resumePortfolioMode||deliverableIntent(current.content,materialOperation))
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
  const programOwnedBudgetQuotes=decisionComparison?obligations.requiredEffects.flatMap(effect=>effect.type==='weekly_time'||effect.type==='remaining_time'?[effect.quote]:[])
    :summaryEventReadOnly&&!correctionPlan&&!explicitTimeEvidenceCandidates(current.content,new Date(current.created_at).toISOString(),'Asia/Shanghai').length
    ?obligations.requiredEffects.flatMap(effect=>effect.type==='weekly_time'&&effect.period==='current'?[effect.quote]:[]):[]
  const modelClauseCatalogue=clauseCatalogue.filter(clause=>{
    if(programOwnedBudgetQuotes.includes(clause.text))return false
    if(!decisionComparison)return true
    const correctionSource=correctionPlan&&(correctionPlan.markerQuote===clause.text||correctionPlan.newQuote.includes(clause.text)||/^更正(?:一下)?$/.test(clause.text))
    return comparisonFactQuotes.has(clause.text)&&!correctionSource
  })
  const explicitSourceRequest=/(?:来源|依据|方法|攻略|指南|政策|规定|数据|研究|证明|出处)/.test(current.content)
  const suppressUnrequestedCitations=!requestedGuide&&!explicitSourceRequest
  const fieldCorrectionOnly=snapshot.settings.enabled&&!personalWritesBlocked&&correctionPlan?.target?.field==='education.major'&&clauseCatalogue.every(clause=>
    !clause.quoted&&!clause.code&&!clause.conditional&&!clause.interrogative&&!clause.attributedToOther&&!clause.quoteSpans?.length&&!clause.codeSpans?.length&&
    (correctionPlan.newQuote.includes(clause.text)||correctionPlan.markerQuote===clause.text||
      /^(?:请)?保留(?:[^，。；！？]{1,24}经历和)?(?:其他|其余)(?:已保存的)?(?:经历|事实|记录|资料)(?:不变)?$/u.test(clause.text)))
  const baseContract=deriveTurnContract({text:current.content,knowledgeCount:knowledge.length,knowledgeIds:requestedGuide?[requestedGuide.id]:knowledge.map(card=>card.id),requiredKnowledgeCitation:Boolean(requestedGuide),currentEventExists:!boundaryNeedsClarification&&currentEvent!==null,planIntent,material:materialIntent,readOnly:fieldCorrectionOnly||Boolean(decisionComparison)&&!modelClauseCatalogue.length||readOnlyQuestion||instructionOnlySummary,eventReadOnly:Boolean(decisionComparison)||summaryEventReadOnly})
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
  // Duplicate host/model writes from one source are one edit. Distinct source
  // groups may belong to different interviews, so an unscoped continuation
  // stays unresolved instead of silently taking the newest question.
  const sourceMessages=new Map(allContextMessages.filter(message=>message.role==='user').map(message=>[message.id,message]))
  const sourceMessageTexts=new Map([...sourceMessages].map(([id,message])=>[id,message.content]))
  const sourceMessageCreatedAt=new Map([...sourceMessages].map(([id,message])=>[id,preciseIsoFromEpochMicros(message.decision_created_micros,message.created_at)]))
  const interviewMemoryFor=(item:(typeof growthAll)[number])=>{
    const exact=growthSemantic.sourceLocations.get(item.id)??[]
    const fallback=growthMessageSourceLocations(item.sources,sourceMessageTexts,sourceMessageCreatedAt)
    const locations=exact.length?exact:fallback
    // Routing may only use exact user-message evidence. A growth row without
    // a resolvable message source is not allowed to become a second source of
    // truth merely because its text resembles an interview report.
    if(!locations.length)return []
    return locations.flatMap(location=>{
      if(location.ambiguous)return []
      const message=sourceMessages.get(location.sourceId)
      const createdAt=location.createdAt??sourceMessageCreatedAt.get(location.sourceId)??item.createdAt
      const sourceOrder=location.start!==undefined&&location.start>=0?location.start:undefined
      const contextText=location.contextText??message?.content
       const conversationId=location.conversationId??(message?run.conversation_id:undefined)
       return [{text:location.quote,sourceId:location.sourceId,createdAt,...(conversationId?{conversationId}:{}),...(sourceOrder===undefined?{}:{sourceOrder}),...(contextText?{contextText}:{})}]
    })
  }
  const authoritativeInterviewItems=growthAll.filter(item=>item.status==='active'&&!item.unavailableReason&&!item.recommendationStopped&&['user_reported','user_edit'].includes(item.assertion))
  const interviewEditMemories=authoritativeInterviewItems.flatMap(interviewMemoryFor)
  const interviewEditResolution=resolveRequestedQuestionEdit(interviewEditMemories,current.content)
  const selectedInterviewEdit=selectedRequestedQuestionEditMemory(interviewEditMemories,interviewEditResolution,current.content)
  const selectedInterviewMatter=selectedRequestedQuestionEditMatter(interviewEditMemories,interviewEditResolution,current.content)
  const selectedInterviewSource=selectedRequestedQuestionEditSource(interviewEditMemories,interviewEditResolution,current.content)
  // Active growth remains the only recall source. Raw persisted user messages
  // participate only as fail-closed chronology: a later real interview can
  // invalidate a stale edit even when optional extraction omitted that turn.
  // Their text is neither selected as a memory nor added to provider context.
  const selectedSourceId=selectedInterviewSource?.sourceId
  // Keep the selected historical source in this scan so a later clause in the
  // same message can invalidate its earlier edit. `$4` is the current,
  // in-progress message and is the only row excluded from chronology.
  const chronologyScope=selectedSourceId&&selectedInterviewSource&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(selectedSourceId)?{...selectedInterviewSource,currentMessageId:String(current.id),conversationId:run.conversation_id,memoryEnabled:snapshot.settings.enabled}:null
  const chronologySnapshot=chronologyScope?await readInterviewChronologySnapshot(run.user_id,chronologyScope):null
  const persistedChronologyMessages=chronologySnapshot?.messages??[]
  if(chronologySnapshot)staged.interviewChronologySnapshot={scope:chronologyScope!,key:chronologySnapshot.key}
  const chronologySourceBoundaries=chronologySnapshot?.boundaries??[]
  const databaseInterviewChronology=persistedChronologyMessages.flatMap(message=>{
    const content=String(message.content),sourceId=String(message.id)
    if(profileWritesDisallowed(content))return []
    const rows:{text:string;sourceId:string;sourceOrder:number;createdAt:string}[]=[],createdAt=preciseIsoFromEpochMicros(message.created_micros,message.created_at)
    let visiblePrefix='',previousEnd=-1
    for(const clause of scanUserClauses(content)){
      const suppressed=chronologySourceBoundaries.some(ref=>ref.messageId===sourceId&&sourceQuotesOverlap(content,{quote:clause.text,range:{start:clause.start,end:clause.end}},ref))
      // A hidden clause is also an ownership boundary. Otherwise keep the
      // visible message prefix so `我先整理…，后来做了访谈` reaches the same
      // actor-inheritance parser as an unsplit in-memory message.
      if(suppressed){visiblePrefix='';previousEnd=-1;continue}
      visiblePrefix=visiblePrefix+((previousEnd>=0?content.slice(previousEnd,clause.start):''))+clause.text
      rows.push({text:visiblePrefix,sourceId,sourceOrder:clause.start,createdAt})
      previousEnd=clause.end
    }
    return rows
  })
  const interviewChronology=[...authoritativeInterviewItems.flatMap(interviewMemoryFor),...databaseInterviewChronology]
  const laterInterviewTexts=selectedInterviewEdit?interveningInterviewTexts(interviewChronology,selectedInterviewEdit):[]
  const priorInterviewQuestion=interviewEditResolution.status==='selected'&&selectedInterviewEdit&&selectedInterviewMatter&&questionEditMatchesMatter(current.content,selectedInterviewMatter,laterInterviewTexts)?interviewEditResolution.question:undefined
  const editedInterviewContinuation=Boolean(priorInterviewQuestion&&/访谈/.test(current.content)&&/(?:上次|继续|接下来)/.test(current.content))
  // A resolved event workspace already supplies the bounded identities and
  // review state. Do not replace its contextual reply with a generic editorial
  // catalogue; the event/action validators still constrain every mutation.
  const freshReviewEvidence=currentEvent!==null&&!currentConversationOnly(current.content)
  staged.audit.push({phase:'edited_interview_route',candidateCount:interviewEditResolution.candidateCount,sourceCount:interviewEditResolution.sourceCount,resolution:interviewEditResolution.status,selectedSourceId:interviewEditResolution.status==='selected'?interviewEditResolution.sourceId:null,continuation:editedInterviewContinuation,decisionComparison,matterWorkingSet:Boolean(matterWorkingSet),reconsideringPaused,explicitGoalDeclaration,requestedGuide,methodContinuation:methodIntent.continuation&&knowledge.length>0,freshReviewEvidence,providerCalls:0})
  // Explicit factual recall uses the authorized personal context and normal reply;
  // it must not fall through to a generic pre-contact action catalogue.
  const oneQuestionReplyRequested=requestsOneQuestionReply(current.content)
  const canRecordNamedMatter=snapshot.settings.enabled&&originalContract.capabilities.event&&!personalWritesBlocked&&!decisionComparison
  const canStartNamedMatter=canRecordNamedMatter&&!currentEvent&&!historicalEvents.length&&!retrieval.ambiguous
  const namedAcceptance=canStartNamedMatter?reportedNamedMatterAcceptance(current.content):null
  const newNamedMatter=canStartNamedMatter?reportedDatedMatterChoice(current.content)??namedAcceptance:null
  const explicitSwitch=canRecordNamedMatter&&newMatterExplicit?reportedSwitchedMatterChoice(current.content):null
  const switchFocus=explicitSwitch?.focus
  // Earlier records may include 准备 in the title. Bind the shorter focus only
  // when this current matter still has an active first-person source for it.
  const retainsSwitchFocus=currentEvent&&switchFocus&&(
    currentEvent.title===switchFocus||
    currentEvent.title==='准备'+switchFocus&&currentEvent.nodes.some(node=>
      node.kind==='fact'&&node.status==='active'&&!node.supersededByActionCorrection&&
      reportedDatedMatterTitle(node.source?.quote??'')===switchFocus))
  const switchedMatter=explicitSwitch&&explicitSwitch.title!==currentEvent?.title&&(!switchFocus||retainsSwitchFocus)?explicitSwitch:null
  const namedMatter=switchedMatter??newNamedMatter
  const partialOutcomes=canRecordNamedMatter&&!newMatterExplicit?reportedPartialActionOutcomes(current.content):[]
  const feedbackTarget=(()=>{
    if(partialOutcomes.length!==1||retrieval.ambiguous)return null
    const proof=partialOutcomes[0]!
    const targets=[...(currentEvent?[currentEvent]:[]),...historicalEvents]
    const matches=targets.flatMap(event=>event.nodes.flatMap(node=>{
      if(node.kind!=='unknown'||node.status!=='active')return []
      const subject=/^(?:你(?:上次|这次)?)?(?:查看|核对|阅读|看|检查|尝试)([^，。！？]{2,32}?)(?:以后|之后|后)的?(?:具体|实际)?反馈(?:是)?什么[？?]?$/.exec(node.content)?.[1]
      return subject&&unknownQuestionTopicMatches(subject,proof.action.text)?[{event,nodeId:node.id,proof}]:[]
    }))
    if(matches.length===1)return matches[0]!
    if(matches.length>1)return null
    const acceptedTargets=targets.filter(event=>{
      const accepted=event.matterProgress?.reports.filter(report=>report.choice==='accepted').at(-1)
      return accepted&&matchesAcceptedPartialAction(proof.action.text,accepted.quotes)
    })
    return acceptedTargets.length===1?{event:acceptedTargets[0]!,nodeId:undefined,proof}:null
  })()
  const boundedReply:BoundedReply|null=(newNamedMatter||feedbackTarget||decisionComparison||matterWorkingSet||reconsideringPaused||explicitGoalDeclaration)?null:turnNeedsControlReceipt||refusalOnly?null:boundaryNeedsClarification?{basis:'editorial_adaptation',sourceStatus:'NO_PUBLIC_METHOD',stage:'reported_result',nextUnknown:'停止或暂停指的是哪件事项；不猜相似事件',choices:[pendingRecommendationIds.size?'先确认你想停止推荐的是哪件事：请在确认卡里选择原事项。已报告的事实保留；确认前不主动安排这些候选事项。想换一件新事，也可以直接告诉我。':'你之前暂停了一件事项，尚未确认和这次是否同一件事。先核对这次要继续的事项，以及是否要恢复它；确认前不安排任务。']}:readOnlyQuestion&&(explicitRecallRequest||sourceReadbackOnly)&&!editedInterviewContinuation?null:readOnlyQuestion&&!explicitRecallRequest&&!editedInterviewContinuation?boundedRecallReply(current.content,growthAll.filter(item=>item.status==='active'&&!item.unavailableReason&&['user_reported','user_edit'].includes(item.assertion)).map(item=>({text:item.text,createdAt:item.createdAt})),priorInterviewQuestion):methodIntent.reason==='method_reference_missing'?{basis:'editorial_adaptation',sourceStatus:'NO_PUBLIC_METHOD',stage:'reported_result',nextUnknown:'本人所指的既有方法名称或原步骤',choices:['我目前无法确认你说的“上次那个方法”具体是哪一个，因此不换方法。请把方法名或上次那一步贴过来；已解示例缺失、课件链接打不开先按你的原话保留。']}:(!editedInterviewContinuation&&(requestedGuide||(methodIntent.continuation&&knowledge.length)))||freshReviewEvidence||oneQuestionReplyRequested?null:boundedOrdinaryReply({text:current.content,intent:methodIntent,contract:originalContract,knowledgeCount:knowledge.length,tier:route.tier,material:materialIntent,priorInterviewQuestion,priorUserTexts})
  const hasSeparateQuestion=clauseCatalogue.some(clause=>clause.interrogative&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&!assistantRequestClause(clause.text))
  const singleQuestionMaterial=requestsSingleQuestionMaterial(current.content)
  const replyMaterial=materialIntent&&!mixedViewOnly&&!resumePortfolioMode&&!asksRecall&&!hasSeparateQuestion&&!planIntent&&(requiresImmediateMaterial(current.content)||singleQuestionMaterial)
  const singleQuestionReply=!materialIntent&&!asksRecall&&!hasSeparateQuestion&&!planIntent&&oneQuestionReplyRequested
  const requestedDefinition=singleQuestionReply&&!boundedReply&&!currentConversationOnly(current.content)&&!detectForgetIntentClauses(current.content).some(c=>c.kind==='forget'||c.kind==='pause_use')?provisionalQuestionPreview(current.content):null
  const sourceDefinition=requestedDefinition&&!removeQuestionOnZeroTime(requestedDefinition,current.content)?requestedDefinition:null
  const questionFirstMaterial=materialIntent&&!resumePortfolioMode&&!planIntent&&singleQuestionMaterial&&(asksRecall||hasSeparateQuestion)
  const deliveryContract=bindMaterialDeliverySchema(bindBoundedReplySchema(originalContract,boundedReply),current.content,resumePortfolioMode,questionFirstMaterial?'question_first':replyMaterial)
  if(viewOnlyDrafts.length){
    const schema=deliveryContract.schema as {properties:Record<string,any>;required?:string[]}
    schema.properties.viewOnlyDrafts={type:'array',minItems:viewOnlyDrafts.length,maxItems:viewOnlyDrafts.length,items:{type:'string',minLength:1,maxLength:12000},description:'按请求顺序写每份完整可用的只读成品。内容由服务器展示，不写成行动。'}
    schema.required=[...new Set([...(schema.required??[]),'viewOnlyDrafts'])]
    schema.properties.reply={...schema.properties.reply,minLength:0,description:'仅写有必要的其他回应；无须说明时为空字符串。只读材料正文只写viewOnlyDrafts。'}
    const writableIds=modelClauseCatalogue.filter(clause=>materialVisibility!.writable.some(request=>request.range.start===clause.start&&request.range.end===clause.end)).map(clause=>clause.clauseId)
    if(writableIds.length)for(const branch of schema.properties.event?.properties?.action?.anyOf??[]){
      if(!branch.properties?.source)continue
      branch.properties.source={anyOf:[branch.properties.source,{type:'object',properties:{clauseId:{type:'string',enum:writableIds}},required:['clauseId'],additionalProperties:false}]}
    }
    deliveryContract.schemaChars=JSON.stringify(deliveryContract.schema).length
  }
  const summaryContract=!boundedReply&&!materialIntent&&!planIntent?bindRequestedSummarySchema(deliveryContract,current.content,singleQuestionReply||hasSeparateQuestion):deliveryContract
  const comparisonContract=!boundedReply&&!materialIntent&&!planIntent?bindRequestedComparisonSchema(summaryContract,current.content):summaryContract
  const comparisonInstructions=responseRequestScope(current.content).instructions.filter(clause=>comparisonRequestClause(clause.commandText))
  const scopedComparison=matterWorkingSet!==null&&comparisonInstructions.every(clause=>comparisonRequestClause(clause.commandText,'matter_set',current.content))
  // Matter coverage uses its own contract; retain the existing universe check
  // while leaving its prose free of the generic numbered-options presentation.
  const contract=scopedComparison?summaryContract:comparisonContract
  if(sourceDefinition){
    const schema=structuredClone(contract.schema) as any
    schema.properties.reply={...schema.properties.reply,enum:[sourceDefinition]}
    contract.schema=schema;contract.schemaChars=JSON.stringify(schema).length
  }
  const answerDispositionRequired=Boolean(immediateAnsweredUnknown&&immediateAnsweredUnknown.id!==feedbackTarget?.nodeId&&currentEvent&&contract.capabilities.event&&!boundedReply)
  if(answerDispositionRequired){
    const schema=structuredClone(contract.schema) as any
    schema.required=[...new Set([...schema.required??[],'event'])]
    schema.properties.event.required=[...new Set([...schema.properties.event.required??[],'resolveUnknowns'])]
    contract.schema=schema;contract.schemaChars=JSON.stringify(schema).length
  }
  // An exact switch already carries every write source. Use the same
  // source-owned receipt and atomic finish path as an explicit state readback.
  const switchContract=switchedMatter&&!answerDispositionRequired&&!materialIntent&&!planIntent&&!requestedGuide&&!contract.requiredReplyKind
    ?deriveTurnContract({text:current.content,knowledgeCount:0,currentEventExists:currentEvent!==null,planIntent:false,material:false,readOnly:true})
    :null
  if(switchContract){
    contract.schema=switchContract.schema
    contract.schemaChars=switchContract.schemaChars
  }
  // Explicit corrections are staged by the server; withholding the optional growth array prevents provider self-correction loops and invalid enum guesses.
  if(/^\\s*更正[:：]/.test(current.content)&&(contract.schema.properties as any).growthUpdates){delete (contract.schema.properties as any).growthUpdates;contract.schemaChars=JSON.stringify(contract.schema).length}
  const reportsUnresolvedTwoFactor=unresolvedTwoFactors(current.content)!==null
  const distinctionActionRequested=requestedScope.actionRequested&&!materialIntent&&!planIntent&&!requiresImmediateMaterial(current.content)
    &&!requestedScope.comparisonRequested&&requestedScope.sentenceLimit===undefined
    &&requestedScope.actionLimit===1
    &&reportsUnresolvedTwoFactor
  const judgmentActionRequested=requestedScope.judgmentUpdate&&requestedScope.actionRequested&&!materialIntent&&!planIntent&&!turnNeedsControlReceipt
  const correctionReplyMustWait=correctionPlan!==null||explicitCorrectionIntent(factualWriteText,correctionCandidates)
  const transactionalReplyMustWait=turnNeedsControlReceipt||correctionReplyMustWait
  const ordinaryProgressiveReply=!decisionComparison&&!matterWorkingSet&&!materialIntent&&!planIntent&&!boundedReply&&!resumePortfolioMode&&!singleQuestionReply&&!distinctionActionRequested&&!turnNeedsControlReceipt
  if(transactionalReplyMustWait||decisionComparison||matterWorkingSet||distinctionActionRequested||(requestedScope.judgmentUpdate&&!judgmentActionRequested)||ordinaryProgressiveReply||singleQuestionMaterial||singleQuestionReply){
    // Control previews are deliberately withheld until commit. Do not spend
    // generation on a duplicate lead that cannot be delivered. Judgment
    // updates without an action deliver their understanding directly in reply.
    // Ordinary replies already stream directly from reply. A separate lead is
    // never displayed in that lane and delays the first visible reply token.
    // Material/plan/single-question lanes keep their existing preview rules.
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
  if(contract.capabilities.material){
    const schema=contract.schema as {properties:Record<string,unknown>}
    // Grounded first-person material is authored only by selecting verified
    // catalogue entries. Keep an original, short explanatory reply rather
    // than letting a second factual artifact bypass those selections.
    if(resumePortfolioMode)schema.properties.reply={type:'string',minLength:0,maxLength:16000,description:'没有必要的反馈、提醒或未知时用空字符串，不为填字段复述已知贡献、宣布已撰写或补出待填项。混合复盘仍可写必要回应。完整材料由selectedFactIds对应的原话渲染，不另写正文。'}

  }
  // Explicit single-question shape is part of generation, never a later edit.
  // Control receipts and quoted question literals retain their existing lane.
  if(singleQuestionReply&&contract.requiredReplyKind!=='comparison'&&contract.requiredReplyKind!=='summary'&&!turnNeedsControlReceipt&&!scanUserClauses(current.content).some(clause=>clause.quoteSpans.some(span=>/[?？]/.test(current.content.slice(span.start,span.end))))){
    (contract.schema as any).properties.reply.pattern='^[^?？\\r\\n]*[?？]$'
  }
  // G4 mode-aware history selection: bound the raw dialogue the model reads
  // (the DB and structured lanes keep everything). The current message is
  // always present in buildTurnPrompt regardless of this filter.
  // The server owns the field edit; there is no old dialogue to answer here.
  const historyForSelection=fieldCorrectionOnly?[]:allContextMessages.filter(row=>row.id!==run.source_message_id).map(row=>({id:row.id,role:row.role==='assistant'?'assistant' as const:'user' as const,content:row.content??''}))
  historySelection=selectHistoryForMode(historyForSelection,contract.mode,current.content)
  const selectedIds=new Set(historySelection.selected.map(row=>row.id))
  const messages=allContextMessages.filter(row=>row.id===run.source_message_id||selectedIds.has(row.id))
  staged.audit.push({phase:'history_selection',mode:contract.mode,historyTotalMessages:historySelection.totalMessages,historySelectedMessages:historySelection.selected.length,historyTotalChars:historySelection.totalChars,historySelectedChars:historySelection.selectedChars,providerCalls:0})
  const materialRevisionPrompt=materialIntent&&currentEvent?.actions.some(action=>action.status==='proposed')?'\n本轮修改已有材料时，新的'+(replyMaterial?'reply正文（draft只有fromReply:true，不生成draft.content）':'draft.content')+'必须落实本人这次提出的变化和本轮生成契约，不能原样返回当前材料；如果本人要求更具体，必须改成更具体的可直接使用文本。':''
  const grillingMode=grillingInteractionMode(current.content,{material:materialIntent,plan:requestsTimeArrangement(current.content),listen:currentConversationOnly(current.content)})
  const proposalEvents=[...(currentEvent?[currentEvent]:[]),...historicalEvents]
  const actualBindings=decisionComparison?actionComparisonClauses.flatMap(clause=>{
    const named=proposalEvents.filter(event=>event.title.trim().length>=2&&clause.text.includes(event.title.trim()))
    const matches=named.length?named:proposalEvents.filter(event=>feedbackMatchesCurrent(clause.text,event.title,event.title))
    if(matches.length!==1)throw new HttpError(409,'TRIAL_ACTUAL_MATTER_TARGET_UNRESOLVED',undefined,{message:'请先在原事项中说明这条实际变化，再比较条件；本轮尚未更新任何事项。'})
    const progress=reportedActionProgress(clause.text,matches[0].title)
    return [{event:matches[0],quote:clause.text,clause,state:progress.state,resumed:progress.resumed,choice:progress.choice}]
  }):[]
  const actualTransitions=actualBindings.filter(binding=>binding.resumed||binding.state!==null||binding.choice!==null)
  if(actualBindings.length>1)throw new HttpError(409,'MULTIPLE_MATTER_UPDATES_REQUIRE_SEPARATE_TURNS',undefined,{message:'请分别说明各事项的实际变化，再比较条件；本轮尚未更新任何事项。'})
  const resetTrial=decisionComparison==='restore'||scanUserClauses(current.content).some(c=>{
    if(c.quoted||c.code||c.attributedToOther||c.quoteSpans.length||c.codeSpans.length)return false
    const match=/(?:重新试算|另做一次(?:试算|比较)|再做一次(?:试算|比较)|(?:按|沿|回到|恢复)[^。！？]{0,8}(?:最初|原来|真实)[^。！？]{0,5}基线|(?:不|不要)(?:再)?沿用(?:上轮|上次|之前|前两次|旧)(?:的)?(?:假设|试算|条件))/.exec(c.text)
    return Boolean(match&&!/(?:不|不要|不用|别|不必|不需要)\s*$/.test(c.text.slice(0,match.index)))
  })
  const realBaseRow=authorizedHistory.find(row=>row.id===realComparisonUser),previousBaseRow=authorizedHistory.find(row=>row.id===previousComparisonUser)
  const userHistory=authorizedHistory.filter(row=>row.role==='user'&&row.id!==current.id),authorizedTexts=userHistory.map(row=>row.content)
  const referencedActualIds=new Set([
    ...Object.values(previousProposal?.conditions?.sourceRefs??{}).filter(ref=>ref.kind==='actual').map(ref=>ref.messageId),
    ...Object.values(previousProposal?.realConditions?.sourceRefs??{}).map(ref=>ref.messageId),
    ...Object.values(supplementFieldSources).map(ref=>ref.messageId),
  ])
  const conditionSourceRows=userHistory.flatMap<{id:string;content:string;kind:'actual'|'trial'}>(row=>{
    if(!trialHistoryIds.has(row.id))return [{id:row.id,content:row.content,kind:'actual'}]
    const actual=referencedActualIds.has(row.id)&&row.completed_decision&&!profileWritesDisallowed(row.content)?comparisonFactText(row.content,reportedComparisonFactClauses(row.content)):''
    return [{id:row.id,content:row.content,kind:'trial' as const},...(actual?[{id:row.id,content:actual,kind:'actual' as const}]:[])]
  })
  const realConditionSources=conditionSourceRows.filter(row=>row.kind==='actual'),realAuthorizedTexts=realConditionSources.map(row=>row.content)
  const authorizedPreviousConditions=previousProposal?.conditions?authorizedDecisionConditions(previousProposal.conditions,authorizedTexts,conditionSourceRows):null
  const previousPremiseAvailable=!previousProposal?.conditions||JSON.stringify(authorizedPreviousConditions)===JSON.stringify(previousProposal.conditions)
  const actualAfter=(row:{id?:string;created_at?:unknown;decision_created_micros?:string}|undefined)=>{
    if(!row)return []
    const clock=(item:typeof row)=>BigInt(item!.decision_created_micros??String(new Date(item!.created_at as string).getTime()*1000))
    const compare=(a:typeof row,b:typeof row)=>clock(a)<clock(b)?-1:clock(a)>clock(b)?1:(a!.id??'').localeCompare(b!.id??'')
    const later=userHistory.filter(item=>compare(item,row)>0&&!trialHistoryIds.has(item.id)).sort(compare)
    const boundary=later.findIndex(item=>item.completed_decision===false||!continuesDecisionContext(item.content)&&!(item.completed_decision===true&&requestsMatterDecision(item.content)))
    return boundary<0?later:later.slice(0,boundary)
  }
  let realConditions=previousProposal?.realConditions?authorizedDecisionConditions(previousProposal.realConditions,realAuthorizedTexts,realConditionSources):compileDecisionConditions('',realBaseRow?.content??'',undefined,realBaseRow?{messageId:realBaseRow.id,kind:'actual'}:undefined)
  for(const row of actualAfter(previousProposal?.realConditions?previousBaseRow:realBaseRow))realConditions=compileDecisionConditions(realConditions,actualConditionsText(row.content),undefined,{messageId:row.id,kind:'actual'})
  const unavailableRealFields=Object.keys(previousProposal?.realConditions?.sources??{}).filter(key=>!Object.hasOwn(realConditions.sources,key))
  const scalarFields=['minutes','continuousMinutes','energy','network','contact'],resourceFields=['电脑','手机','材料','场地','预算','设备','资源','外出']
  for(const [key,ref] of Object.entries(supplementFieldSources)){
    if(!scalarFields.includes(key)&&!resourceFields.includes(key))continue
    const source=realConditionSources.find(row=>row.id===ref.messageId),decoded=source?compileDecisionConditions('',actualConditionsText(source.content)):null
    const value=decoded?(Object.hasOwn(decoded,key)?(decoded as unknown as Record<string,unknown>)[key]:decoded.unavailableResources.includes(key)):null
    if(decoded&&Object.hasOwn(decoded.sources,key)&&createHash('sha256').update(JSON.stringify(value)).digest('hex')===ref.valueDigest)continue
    if(key==='energy')realConditions.energy='unknown'
    else if(scalarFields.includes(key))Object.assign(realConditions,{[key]:null})
    else realConditions.unavailableResources=realConditions.unavailableResources.filter(item=>item!==key)
    delete realConditions.sources[key];if(realConditions.sourceRefs)delete realConditions.sourceRefs[key];unavailableRealFields.push(key)
  }
  if(unavailableRealFields.length)staged.audit.push({phase:'decision_real_sources_unavailable',fields:[...new Set(unavailableRealFields)],providerCalls:0})
  const reportedConditions=decisionComparison?(personalWritesBlocked?'':factualWriteText):actualConditionsText(current.content)
  realConditions=compileDecisionConditions(realConditions,reportedConditions,undefined,{messageId:current.id,kind:'actual'})
  let proposalBase=decisionComparison&&!resetTrial&&authorizedPreviousConditions?rebaseActualDecisionConditions(authorizedPreviousConditions,realConditions):realConditions
  if(decisionComparison&&reportedConditions)proposalBase=compileDecisionConditions(proposalBase,reportedConditions,undefined,{messageId:current.id,kind:'actual'})
  const proposalConditions=matterWorkingSet?.events.length?compileDecisionConditions(proposalBase,scanUserClauses(current.content).filter(c=>personalWritesBlocked||!actualComparisonClauses.some(actual=>actual.start===c.start)).map(c=>c.text).join('。'),realConditions,{messageId:current.id,kind:decisionComparison?'trial':'actual'}):null
  if(proposalConditions)staged.audit.push({phase:'decision_condition_sources',messageIds:[...new Set([...Object.values(realConditions.sourceRefs??{}),...Object.values(proposalConditions.sourceRefs??{})].map(ref=>ref.messageId))].slice(0,32),providerCalls:0})
  const currentMatterTransition=actualTransitions[0]
  const projectedProposalEvents=proposalEvents.map(event=>currentMatterTransition?.event.id===event.id
    ?{...event,matterProgress:projectMatterReport(event.matterProgress!,currentMatterTransition)}
    :event)
  const currentMatterReport=currentMatterTransition?{eventId:currentMatterTransition.event.id,quote:currentMatterTransition.quote}:undefined
  const proposalCases=proposalConditions?projectDecisionCases(projectedProposalEvents,proposalConditions,currentMatterReport):[]
  const priorFirst=previousProposal?.items.find(item=>['do_now','prepare_only'].includes(item.mode)&&(item.minutesCeiling===null||item.minutesCeiling>0))
  const validPreviousProposal=previousProposal&&previousPremiseAvailable?{...previousProposal,items:previousProposal.items.filter(item=>proposalCases.some(c=>c.eventId===item.eventId)),scopeChanged:previousProposal.items.some(item=>!proposalCases.some(c=>c.eventId===item.eventId)),firstChoiceUnavailable:Boolean(priorFirst&&!proposalCases.some(c=>c.eventId===priorFirst.eventId))}:null
  if(validPreviousProposal&&(previousComparisonUser||previousComparisonReply)){
    const dependencies=(await pool.query("SELECT DISTINCT r.request_id,coach_reply_sources_valid(r.user_id,r.request_id) AS valid,(SELECT coalesce(jsonb_agg(jsonb_build_object('sourceId',s.source_id,'revision',s.revision)),'[]'::jsonb) FROM coach_reply_sources s WHERE s.user_id=r.user_id AND s.request_id=r.request_id) AS refs FROM runs r JOIN messages m ON m.user_id=r.user_id AND m.run_request_id=r.request_id WHERE r.user_id=$1 AND r.conversation_id=$2 AND m.id=ANY($3::uuid[]) AND r.status='completed'",[run.user_id,run.conversation_id,[previousComparisonUser,previousComparisonReply].filter(Boolean)])).rows
    if(!dependencies.length||dependencies.some(row=>!row.valid))throw new HttpError(409,'PRIOR_DECISION_SOURCE_INVALIDATED')
    const refs=dependencies.flatMap(row=>row.refs);contextKnowledge.push(...refs)
    staged.audit.push({phase:'decision_knowledge_dependencies',refs,providerCalls:0})
  }
  if(previousProposal&&!previousPremiseAvailable)staged.audit.push({phase:'decision_prior_premise_unavailable',previousProposalWithheld:true,providerCalls:0})
  if(proposalConditions&&proposalCases.length){contract.schema=bindDecisionProposalSchema(contract.schema,proposalCases,proposalConditions,validPreviousProposal);contract.schemaChars=JSON.stringify(contract.schema).length}
  staged.audit.push({phase:'grilling_interaction_mode',policyVersion:mainCompanionPolicy.grilling.version,policyDigest:mainCompanionPolicy.grilling.policyDigest,mode:grillingMode,providerCalls:0})
  const crisisPrompt=grillingMode==='crisis_support'?'\n本轮是明确危机支持：先确认眼前安全并鼓励立即联系当地紧急服务或身边可信任的人；保持简短、温和、直接。不要继续职业/方向追问，不给生产力任务，不作诊断，不把危机内容保存为成长画像或经历。':''
  const directOrdinary=ordinaryProgressiveReply&&grillingMode==='ordinary'&&!transactionalReplyMustWait&&!currentEvent&&!historicalEvents.length&&!feedbackTarget&&!namedMatter&&!asksRecall&&!requestedScope.judgmentUpdate&&!experienceCandidateRequired
    &&!reportedTaskOutcomeClauses(current.content,false,true).length
  const replyOnly=(fieldCorrectionOnly||sourceReadbackOnly&&readOnlyQuestion)&&!turnNeedsControlReceipt&&!contract.capabilities.growth&&!contract.capabilities.event&&!contract.capabilities.material&&!contract.capabilities.plan&&!proposalCases.length
  const schemaKeys=Object.keys(contract.schema.properties as object)
  const compactReadback=replyOnly&&grillingMode!=='crisis_support'&&!contract.requiredReplyKind&&schemaKeys.join(',')==='reply'
  const compactDecision=grillingMode!=='crisis_support'&&scopedComparison&&schemaKeys.length===2&&schemaKeys.includes('decisionProposal')&&schemaKeys.includes('reply')
  const feedbackOwner=feedbackTarget?.event??currentEvent??(!retrieval.ambiguous&&historicalEvents.length===1?historicalEvents[0]:null)
  const ownsPartialFeedback=feedbackOwner?.matterProgress?.state==='partial'
  const hasPartialFeedback=ownsPartialFeedback||partialOutcomes.length>0
  const feedbackRevision=hasPartialFeedback&&requestedScope.instructions.some(clause=>requestsFeedbackStepRevision(clause.commandText))
  const acceptanceSource=newNamedMatter?.clauses.map(clause=>clause.text)??((feedbackTarget||feedbackRevision)
    ?feedbackOwner?.matterProgress?.reports.filter(report=>report.choice==='accepted').at(-1)?.quotes:undefined)
  const acceptedSteps=(acceptanceSource??[]).flatMap(quote=>{const step=acceptedStepFromQuote(quote);return step?[{step,quote}]:[]})
  const acceptedStep=acceptedSteps.length===1?acceptedSteps[0]:undefined
  const acceptedStepMode=newNamedMatter?'initial':feedbackRevision?'revision':'feedback'
  const feedbackSources=feedbackTarget?[feedbackTarget.proof.action,...feedbackTarget.proof.clauses]:[]
  const feedbackClause=feedbackTarget?modelClauseCatalogue.find(clause=>clause.start===feedbackTarget.proof.action.start&&clause.end===feedbackTarget.proof.action.end):undefined
  const ownedFeedbackClauses=feedbackClause&&contract.capabilities.growth&&contract.capabilities.event&&!boundedReply
    ?new Set(modelClauseCatalogue.filter(clause=>feedbackSources.some(source=>source.start===clause.start&&source.end===clause.end)).map(clause=>clause.clauseId)):undefined
  const compactFeedback=grillingMode!=='crisis_support'&&!decisionComparison&&!materialIntent&&!planIntent&&!turnNeedsControlReceipt&&!contract.requiredReplyKind&&!contract.capabilities.citations&&!boundedReply&&!hasSeparateQuestion&&!asksRecall&&!requestedScope.summaryRequested&&!requestedScope.comparisonRequested
    &&Boolean(feedbackTarget||feedbackRevision)&&!requiresExperienceCandidate(clauseCatalogue.filter(clause=>!feedbackSources.some(source=>source.start===clause.start&&source.end===clause.end)))
  const bindOwnedFeedback=compactFeedback&&ordinaryProgressiveReply&&supportsNativeStrictSchema(runtime.model)&&Boolean(ownedFeedbackClauses?.size&&ownedFeedbackClauses.size===feedbackSources.length)
    &&!reportedActionProgress(scanUserClauses(current.content).filter(clause=>!feedbackSources.some(source=>source.start===clause.start&&source.end===clause.end))).quotes.length
  if(directOrdinary&&!contract.requiredReplyKind){
    const replySchema=(contract.schema.properties as Record<string,{description?:string}>).reply
    if(replySchema)replySchema.description=DIRECT_ORDINARY_REPLY_RULES
    contract.schemaChars=JSON.stringify(contract.schema).length
  }
  const providerContract=switchContract?{...contract,mode:'reply_only' as const,capabilities:switchContract.capabilities}:contract
  let systemPrompt=turnSystemPrompt('default',runtime.model.id,providerContract,materialIntent,compactDecision,directOrdinary,compactReadback||compactFeedback)+materialRevisionPrompt+crisisPrompt+(questionFirstMaterial?'\n本轮先输出event.action.draft.content里的唯一完整中性问题，再输出event其他字段和reply。reply先列最近本人报告的事实和时间，再列从未提供或此后未更新的结果，不重复问题；不使用fromReply。问题围绕已有具体线索追问可观察的环节；对新对象询问其如何核查该线索，不预设对方也经历了上次反馈的困难。':'')+(currentConversationOnly(current.content)?'\n本轮本人只想倾听或明确拒绝方法：回应当前表达，不给行动、方法、解决问题的追问或安排，不重发上轮建议。对本次聊天的偏好不存为个人目标、经历或长期事实；独立的新本人事实如有则保留原话与未知。':'')+(boundedReply?'\nboundedReply是本轮服务端授权的编辑动作与过程追问，不是获审公共攻略。reply必须完整选择choices中适合当前请求的一项，不增加事实、因果、效果、时间或情绪判断；其他合法状态更新仍按原契约锚定本人原话。':'')
  const omitHistoricalMaterialBodies=Boolean(replyMaterial&&singleQuestionMaterial&&!currentEvent&&!requestsMaterialRewrite(current.content)&&!clauseCatalogue.some(clause=>!clause.quoted&&!clause.code&&!clause.attributedToOther&&/(?:上次|之前|刚才|刚刚|原文|那份|这份|那段|这段|那个问题)/.test(clause.text)))
  const promptGrowthIds=new Set([...growthTopic.currentTopic,...growthTopic.background].map(item=>item.id))
  const relevantTentativeIds=new Set(splitGrowthByCurrentTopic(growthSemantic.tentativeItems,current.content).currentTopic.map(item=>item.id))
  const factInterpretations=fieldCorrectionOnly?[]:growthSemantic.interpretations.filter(item=>item.actor==='unknown'?relevantTentativeIds.has(item.itemId):promptGrowthIds.has(item.itemId))
  staged.usedFactInterpretationRefs=factInterpretations.filter(item=>item.actor==='unknown').map(({itemId,revision,actor,proposedActor,actionQuote})=>({itemId,revision,actor,actionQuote,...(proposedActor?{proposedActor}:{})}))
  // The same authorized fields can be a summary or a corrected projection.
  // Keep exact source labels on source spans, never on the display text.
  const promptExperiences=(fieldCorrectionOnly?[]:evidenceExperiences).map(experience=>{
    const {quote,source_quote:_,...record}=experience as typeof experience & {source_quote?:string}
    return {...record,readbackText:quote}
  })
  const baseUserPrompt=buildTurnPrompt({
    directOrdinary,compactEvidence:compactReadback||compactFeedback||compactDecision,omitHistoricalMaterialBodies,currentMessageId:run.source_message_id,messages,
    clauses:modelClauseCatalogue.map(handle=>({id:handle.clauseId,text:handle.text})),grillingMode,
    ...(fieldCorrectionOnly?{}:{
      profile:snapshot.profile,confirmedExperiences:promptExperiences,currentEvent,events:historicalEvents,knowledge,
      methodContext:methodContext.knowledge,methodFit:methodFitContext,knowledgeIntent:methodIntent,guideUsage:previousGuideUsage,
      growth:growthTopic.currentTopic,growthBackground:growthTopic.background,factInterpretations,growthBoundaries,growthRecommendationBoundaries,
      taskBoundaries:unresolvedTaskBoundaries.map(item=>item.taskBoundary!),directionControls:effectiveControls,
      allowedDirectionScopes:blockedDirectionScopes.length?allowedDirectionScopes:null,blockedDirectionScopes:blockedDirectionScopes.length?blockedDirectionScopes:null,
      ...(resumePortfolioMode?{growthCatalogue:materialCatalogue.map(fact=>({catalogueId:fact.catalogueId,field:fact.field,text:fact.text,sourceKind:fact.sourceKind,completeForField:fact.completeForField}))}:{}),
      retrieval:{ambiguous:retrieval.ambiguous,indexPending:retrieval.indexPending},
      starMap:process.env.LIFEOS_DISABLE_STARMAP?null:await (async()=>{const ctx=await readStarMapContext(pool,run.user_id);if(ctx)staged.starMapSnapshot={themes:ctx.themes.map(theme=>({id:theme.id,revision:theme.revision})),links:ctx.usedLinks};return ctx})(),
      currentUserFocus:focusContext?{type:focusContext.type,id:focusContext.id,label:focusContext.label}:null,
    }),
  })
  const workflowHints=fieldCorrectionOnly?null:await actionReviewHints({run,staged,text:current.content,memoryEnabled:snapshot.settings.enabled,currentEvent,historicalEvents,ambiguous:retrieval.ambiguous,listeningOnly:currentConversationOnly(current.content),signal})
  const promptContext=JSON.parse(baseUserPrompt)
  const quotedEdit=promptContext.currentTask.responseScope.quotedEdit
  const openWait=quotedEdit?.openWait
  const materialNames='材料|资料|文件夹|文件|稿件|文档|附件'
  const materialModifier='(?:这份|这些|相关)?'
  const deliveryVerb='发(?:出(?:去|来)?|送|过去|过来)?'
  const clauseStart='(?:^|[，,。；;：:！？!?\\r\\n])\\s*'
  const preparationNeeded='(?:还|仍|尚)?(?:需要|需|得|待)'
  const subjectPredicate='(?=(?:目前|现在|暂时)?(?:也)?(?:有点|有些|还在|仍在|正在|尚在|整理中|准备中|可能|预计|大概|也许|'+preparationNeeded+'|尚未|还未|还没|已经|已|刚|不是|并不|将|会|[\\s，,。；;：:]|$))'
  const objectEnd='[\\s，,。；;：:！？!?]|$'
  const later='(?:再|才(?:能|会)?)'
  // openWait is an allowlisted duration taken from the quoted source.
  const delay='(?:(?:等|过)(?:上)?'+openWait+later+'|(?:在)?'+openWait+'(?:的?时间)?(?:(?:以后|之后|后)'+later+'?|'+later+'))'
  const deliveryClause=TENTATIVE_PROGRESS_CLAUSE+delay
  const materialPattern=(name:string)=>{
    const noun=materialModifier+name
    const preparation=clauseStart+'(?:(?:目前|现在|暂时)|(?:我(?:们)?|这边)){0,2}(?:还在|仍在|正在|尚在|先|再|需要)?'
    return new RegExp([
      clauseStart+'(?:目前|现在|暂时)?'+noun+subjectPredicate,
      preparation+'(?:整理|处理|准备|把|将|'+deliveryVerb+')'+noun+'(?='+deliveryVerb+'|'+objectEnd+')',
      deliveryClause+'(?:把'+noun+deliveryVerb+'|'+deliveryVerb+noun+')(?='+objectEnd+')',
    ].join('|'),'u')
  }
  // Match full clauses to keep verbs inside compounds out of the object check.
  const progressObjects=openWait?materialNames.split('|').filter(name=>materialPattern(name).test(quotedEdit.sourceText)):[]
  const progressObject=progressObjects.length===1?progressObjects[0]:undefined
  const requiredProgressObject=progressObject?materialPattern(progressObject):null
  const otherProgressObject=progressObject?materialPattern('(?:'+materialNames.split('|').filter(name=>name!==progressObject).join('|')+')'):null
  const keepsProgressObject=(text:string)=>!requiredProgressObject||requiredProgressObject.test(text)&&!otherProgressObject?.test(text)
  const material='(?:'+materialModifier+'(?:'+materialNames+')|它们?)'
  const send='(?:把'+material+')?'+deliveryVerb+'(?:给(?:你|您|对方)|'+material+')?(?:[。！？!?，,；;]|$)'
  // Validate the finished sentence locally. Native regex decoding narrowed the
  // whole model reply to the delivery fragment and dropped the reported state.
  const progressTiming=openWait?new RegExp(deliveryClause+send,'u'):null
  const statusNoun=materialModifier+(progressObject??'(?:'+materialNames+')')
  const statusStart='^(?:(?:目前|现在|暂时)|(?:我(?:们)?|这边)){0,2}(?:'+statusNoun+')?(?:目前|现在|暂时)?(?:也)?'
  const statusEnd='(?:'+statusNoun+')?$'
  const ongoing='(?:还在|仍在|正在|尚在)'
  const statusClauses=(text:string)=>text.split(/[，,。；;：:！？!?\r\n]/u).map(clause=>clause.trim()).filter(Boolean)
  const reportedStatuses=statusClauses(quotedEdit?.currentProgress??'')
  const messyStatus=new RegExp(statusStart+'(?:有点|有些)(?:乱|杂乱|零散)'+statusEnd,'u')
  if(reportedStatuses.some(source=>messyStatus.test(source)))quotedEdit.clarifyPreparation=true
  const statusChecks=reportedStatuses.map(source=>{
    const work=new RegExp(statusStart+ongoing+'(整理|核对|合并|校对|准备|汇总|收集|处理)(?:中)?'+statusEnd,'u').exec(source)?.[1]
    const accepted=work?ongoing+work+'(?:中)?|'+work+'(?:工作)?(?:中|尚未完成|还未完成)|(?:尚未|还未|还没)'+work+'(?:完成|好|完)'
      :messyStatus.test(source)?preparationNeeded+'(?:再)?整理(?:一下)?|(?:还在|仍在|正在)整理|(?:尚未|还未|还没)整理(?:好|完|完成)':null
    if(!accepted)return (clause:string)=>clause.replace(/^请/u,'')===source.replace(/^请/u,'')
    const state=new RegExp(statusStart+'(?:'+accepted+')'+statusEnd,'u')
    const named=reportedStatuses.length>1?materialNames.split('|').filter(name=>materialPattern(name).test(source)):[]
    const namedObject=named.length===1?materialPattern(named[0]!):null
    return (clause:string)=>state.test(clause)&&(!namedObject||namedObject.test(clause))
  })
  if(progressObject)quotedEdit.deliveryObject=progressObject
  if(quotedEdit&&NEUTRAL_OTHER_REWRITE.test(quotedEdit.requestedChanges)&&peerUnderstandingStatement.test(quotedEdit.sourceText)){
    const replySchema=(contract.schema.properties as Record<string,{not?:{type:'string';pattern:string}}>).reply!
    replySchema.not={type:'string',pattern:peerUnderstandingStatement.source}
    contract.schemaChars=JSON.stringify(contract.schema).length
  }
  if(viewOnlyDrafts.length)systemPrompt+='\n按顺序将以下请求各自的完整成品写入viewOnlyDrafts：'+JSON.stringify(viewOnlyDrafts.map(request=>request.quote))+'。填写模板要给实际字段和值槽，不写交付承诺。只有另行授权写入的行动放event.action，优先用source.clauseId选择对应请求。'
  else if(materialPersistenceRefused)systemPrompt+='\n明确索要的只读材料直接放在reply；不把材料存为行动。'
  if(actionRestrictions.create&&!materialPersistenceRefused)systemPrompt+='\n本人拒绝新建行动；只修改本轮明确要求修改的已有材料。'
  if(actionRestrictions.plan)systemPrompt+='\n本人拒绝写入计划，省略 weeklyPlan。'
  if(promptExperiences.length)systemPrompt+='\n回读经历时，readbackText和经历字段是可转述的记录，不是逐字引文。未要求引文时用“你此前报告”直接说明，不标“本人原话”；需引文时只使用单条明确的原始来源，不拼接改写。直接结果和后续用途、反馈及效果分别说明，已记录的量化结果不与后续未知合并。正文使用自然的字段名称，不显示内部键名或状态码。'
  if(sourceReadbackOnly&&readOnlyQuestion){
    promptContext.currentTask.recordedVerificationPoints=[currentEvent,...historicalEvents.filter(event=>event.id!==currentEvent?.id)].flatMap(event=>
      event?.nodes.filter(node=>node.kind==='unknown'&&node.status==='active'&&!node.supersededByActionCorrection)
        .map(node=>({matter:event.title,question:node.content}))??[])
    const rule='只用当前可见的本人记录，按本轮范围回读具体动作、字段和结果，不把其中一个环节写成整件事完成。相关状态未报告时说明没有记录。仅在本人明确报告独立完成时保留这项事实，不因分工或工具未报告而重新质疑独立完成；否则独立程度未确认。本人专门询问分工或工具时再回答。已记录待核实项只能取recordedVerificationPoints里属于当前事项的内容，资料、技能自述和历史对话里的问题不在此列时不算。若问“哪一项”，只选一个与结果直接相关的核对点；没有已存的待核实项时，把新核验明确写成建议，先说明相关记录没有列出待核实项，再单独给一项新建议。用户问如何核验时，核验步骤直接给出，并明确这是下次的建议。影响核验的未知写成陈述，正文结束后不追加追问。用户明确索要核对问题时按要求提供。正文省略内部字段名和状态代码。'
    systemPrompt+='\n'+rule
    const replySchema=(contract.schema.properties as Record<string,{description?:string}>).reply!
    replySchema.description=[replySchema.description,rule].filter(Boolean).join('\n')
    contract.schemaChars=JSON.stringify(contract.schema).length
  }
  if(fieldCorrectionOnly){
    const rule='只确认本人本轮更正后的专业和明确保留的范围，不为说明保留而复述上一轮的事实或问题，不新增核验或建议。'
    systemPrompt+='\n'+rule
    const replySchema=(contract.schema.properties as Record<string,{description?:string}>).reply!
    replySchema.description=rule
    contract.schemaChars=JSON.stringify(contract.schema).length
  }else if(correctionPlan)systemPrompt+='\n更正时按本轮请求说明变更。保留其他事实表示这些记录不修改，不为说明保留而复述上一轮的事实或问题。本轮另有明确回读或建议请求时照常回应。'
  if(experienceCandidateRequired)systemPrompt+='\n本轮同时包含个人背景、技能或实际行动时，分别称为背景、技能和经历。只把本人实际做过的行动称为经历，避免在正文中承诺哪些内容已经保存。'
  const priorFeedbackReport=feedbackRevision&&!partialOutcomes.length?feedbackOwner?.matterProgress?.reports.filter(report=>report.state==='partial').at(-1):undefined
  if(priorFeedbackReport&&feedbackOwner){
    const facts=feedbackOwner.nodes.flatMap(({kind,status,source})=>kind==='fact'&&status==='active'&&source&&source.messageId===priorFeedbackReport.sourceMessageId?[source.quote]:[])
    promptContext.currentTask.priorFeedback={sourceMessageId:priorFeedbackReport.sourceMessageId,reportedFacts:[...new Set([...priorFeedbackReport.quotes,...facts])]}
  }
  if(feedbackTarget)promptContext.currentTask.feedbackReport={action:feedbackTarget.proof.action.text,reportedOutcome:feedbackTarget.proof.quote,status:'partial',reason:null,...(bindOwnedFeedback?{sourceBound:true}:{})}
  if(acceptedStep)promptContext.currentTask.acceptedStep={...acceptedStep,mode:acceptedStepMode}
  if(switchedMatter){
    promptContext.reportedMatterSwitch={newMatter:switchedMatter.title,focus:switchedMatter.focus??null,sourceFacts:switchedMatter.clauses.map(clause=>clause.text)}
    const rule='本轮只确认这次明确切换。reportedMatterSwitch 的接受、未执行与暂停只属于 newMatter。focus 表示当前优先事项，保持它已报告的截止与进度。简短确认这两件事，不补原因、行动或追问。'
    systemPrompt+='\n'+rule
    const replySchema=(contract.schema.properties as Record<string,{description?:string;pattern?:string}>).reply!
    replySchema.description=[replySchema.description,rule].filter(Boolean).join('\n')
    replySchema.pattern='^[^?？]+$'
    contract.schemaChars=JSON.stringify(contract.schema).length
  }
  if(proposalConditions&&proposalCases.length){promptContext.decisionPlanContract=decisionProposalContract(proposalCases,proposalConditions,validPreviousProposal);systemPrompt+='\n本轮先生成decisionProposal，再生成唯一完整reply。它是建议记录，不是用户选择或执行。正文与选定的提案一致，说明相对上次的变化和仍未知的事；不得复述内部字段或ID。'+promptContext.decisionPlanContract.rule}
  if(decisionComparison){
    const unknownActualFields=Object.entries({minutes:realConditions.minutes,continuousMinutes:realConditions.continuousMinutes,energy:realConditions.energy,network:realConditions.network,contact:realConditions.contact}).filter(([,value])=>value===null||value==='unknown').map(([field])=>field)
    const rules=[
      '试算只替换本人指定的条件。只把 actualWritableQuotes 中独立报告的真实事实、更正或动作交给各自原有流程；不记录试算条件，隐私指令照常生效。',
      '先直接给本次取舍，再说明相对previousComparison改变的步骤、先后或投入及其原因、保留项。短时选择有实际进展的小起步；低精力选择可停止的低负担进展和休息余地；不可联网或联系时只选不依赖受限资源的动作。条件对结论无影响时允许保持原排序。',
      '恢复现实条件只恢复实际有来源的字段，撤销假设不等于确认相反情况。actualUnknownFields中的连续时段、精力、网络或联系能力仍未知：总时长不写成完整连续时段，网络和联系未知不写成无约束。各事项只使用自身有来源的依赖；本次建议时间只是投入上限。',
      '正文只交付本次有用差异和必要依据，范围遵守本人要求；记录忠实对应正文。等待结果、本人是否接受、实际执行、暂停或结束分别保留；未报告的自主准备保持未知。',
    ]
    promptContext.decisionComparison={mode:decisionComparison,actualUnknownFields:unknownActualFields,unavailableRealConditionFields:[...new Set(unavailableRealFields)],persistence:'TURN_ONLY_NOT_USER_FACTS',conditionsText:current.content,actualWritableQuotes:actualComparisonClauses.map(c=>c.text),previousComparison:comparisonTranscript(previousComparisonUser,previousComparisonReply),realConditionComparison:comparisonTranscript(realComparisonUser,realComparisonReply),rules}
    systemPrompt+='\n条件改变后的取舍比较：'+rules.join('\n')
  }
  if(matterWorkingSet){
    promptContext.matterOverview={...matterWorkingSet.coverage,entries:projectedProposalEvents.map(event=>({eventId:event.id,revision:event.revision,generation:event.generation,reportedState:event.matterProgress?.state??'unknown',choice:event.matterProgress?.choice??'unknown',disposition:event.matterProgress?.recommendationStopped?'do_not_resume':event.matterProgress?.state==='completed'?'already_completed':event.matterProgress?.state==='waiting_result'?'waiting_external_result':event.matterProgress?.choice==='accepted'?'accepted_not_new_obligation':'unaccepted_or_unknown'})),rules:[
      '依据当前有界事项清单的本人原话、进度、选择和截止，给出暂定排序与理由。每个已报告截止的事项各自保留时间节点；比较它们的先后和当前可行性。未报告的截止、准备条件、下游效果、风险和收益保持未知；按有本人来源的相对条件比较。其他事项是否存在及未报告条件保持未知。',
      '建议、已接受、未执行、部分完成、等待结果、暂停和结束分别承接。已暂停或结束的事项维持不安排；等待外部结果时，自主准备仅按本人来源说明。新时间只用于本轮，旧时间保留原日期和范围。',
      '每个安排给可直接开始的有价值进展、建议投入上限与停点，记录和正文的投入一致；未分配时间留给本人决定，额外投入需要新选择。完整任务耗时估计保留为本人估计；独立事项各自评估，材料按明确请求使用原交付协议。',
      '先给本次取舍和影响判断的依据，按需说明改变判断所需的新信息。理由随建议说明一次。本人未要求详细时先交付可开始的一两项，等待与暂停项简述，不重列背景或复述规则。建议仍待本人选择；各项未知、暂停和权限忠实保留。用自然中文表达，记录字段仅供内部保存。',
    ]}
    systemPrompt+='\n本轮跨事项取舍：'+promptContext.matterOverview.rules.join('\n')
  }
  if(answerDispositionRequired)promptContext.currentTask.pendingAskedUnknown={id:immediateAnsweredUnknown!.id,question:immediateAnsweredUnknown!.content,dispositionRule:'显式评估本轮是否回答了这一个实际已问问题；event.resolveUnknowns必须出现，未回答则为空数组。其他事项的新事实不作为它的答案，不靠回复中自行补出的关系关闭未知。'}
  // Project the same source authority used by native generation and the
  // canonical resolver. Internal staging objects are not model-write sources.
  promptContext.growthWriteScope={sourceClauseIds:providerContract.capabilities.growth?modelClauseCatalogue.map(clause=>clause.clauseId):[],programOwnedClauseIds:clauseCatalogue.filter(clause=>programOwnedBudgetQuotes.includes(clause.text)).map(clause=>clause.clauseId)}
  if(programOwnedBudgetQuotes.length){
    staged.audit.push({phase:'budget_memory_program_owned',count:programOwnedBudgetQuotes.length,providerCalls:0})
  }
  if(!switchContract)systemPrompt+='\n感受用 growthUpdates.kind=context，不得使用 feeling 等未授权枚举。'
  systemPrompt+='\n只输出一个完整 JSON 业务对象；不要输出工具标签、</parameter>、<|tool_|>、重复 JSON 或模拟的校验反馈。'
  systemPrompt+='\n每个暂定判断区分本人报告的事实、本人给出的解释和仍待核实的假设。先后发生或少量观察不能确认原因；本人优先A不等于排除未谈过的B；暂时举不出例子不能断定缺口属于哪个方向。'+(hasPartialFeedback||directOrdinary?'':'解释若超出本人原话，应明确它是可被后续反馈推翻的假设。')+'情绪与因果解释只属于其来源事项，不搬到相似新事件；更正只改被否定的命题，独立的原始事实仍保留。'
  const replyPresentation=ordinaryProgressiveReply&&!contract.requiredReplyKind
    ?'\n未核实的信息用完整句说明，保持未知，不使用待补栏位。'
    :'\n篇幅由本轮问题决定，不固定句数或160字上限；多层内容用简短小标题、分段与分点，并列建议逐项换行，少量加粗关键判断；不要把完整回答挤在一段里，也不为凑格式增加空话。明确只要一句、简短或纯倾听时仍遵守；一个必要问题已经足够时只给这个问题。只写新增判断、必要个人依据和具体未知，不重复请求、边界或整段旧背景。没有被本人报告的次数、因果、费用、资源与个人偏好不补写。'
  systemPrompt+='\n本轮服务端回复边界：'+JSON.stringify(promptResponseScopeRules(promptContext.currentTask.responseScope.rules,systemPrompt))+((singleQuestionReply||singleQuestionMaterial&&!questionFirstMaterial&&!planIntent)?'\n'+SINGLE_QUESTION_GENERATION_RULES:requestedScope.actionLimit===1&&!planIntent&&!materialIntent?'\n'+SINGLE_ACTION_GENERATION_RULES:replyPresentation)+(requestedScope.sentenceLimit===1?'本轮数量要求优先：reply只有一句完整阶段理解，不输出lead、不另加短首句或第二句；这句直接交付具体线索及其局限。':contract.requiredReplyKind==='comparison'?'本轮交付比较：不输出lead，reply第一个字符直接从“方式一：”开始，不写前言，不给标签加Markdown粗体；按本轮对象数量依次给“方式二：”“方式三：”等，至少'+requestedComparisonCount(current.content)+'项，必须完整覆盖用户已经点名的对象，不能只给两项就结束。每项说明依据与投入/局限；未点名的其他道路无需枚举，不声称只有这些道路，也不替本人选择。':contract.requiredReplyKind==='summary'?'本轮交付阶段理解：直接给有依据的暂定理解，不用状态确认替代；仅在schema开放lead时才输出lead并逐字作为reply首句。reply任何位置都不能出现问号或疑问句；把未知写成“仍未知的是…”陈述句，不写“是什么”“是否”“哪一个”等向本人索取答案的句式。保留未获答案的缺口，不重问上一问，不安排新的行动。':!Object.hasOwn((contract.schema as any).properties,'lead')?'本轮不输出lead，直接按reply的格式、数量及已开放成品契约交付实际内容，不额外添加概括前言。':'先输出lead，逐字作为reply首句：一个完整开放问题、可开始的具体操作或有依据的判断，不用标题或状态宣告。首句尽量在20字以内，把支持细节留在reply后续句；不能用收到、正在分析等状态文字代替实际内容，也不为缩短而省掉问题对象或操作。')
  if(singleQuestionMaterial||singleQuestionReply){
    if(questionFirstMaterial||planIntent)systemPrompt+='\n'+SINGLE_QUESTION_GENERATION_RULES
    systemPrompt+='\n'+(questionFirstMaterial?'问题只在event.action.draft.content生成；reply仅回应用户明确请求的读回，不加第二个追问。':replyMaterial||singleQuestionReply?'reply直接且只包含最终问题正文；不输出lead，不在前后添加说明，不受短首句预览字数惯例影响。': '问题只在event.action.draft.content生成；其余字段仅承接用户明确要求的其他交付，不自动增加附注。')
  }
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
  const understandingOpeningRules=understandingOpeningGenerationRules(current.content)
  if(ordinaryProgressiveReply&&!boundedReply&&!materialIntent&&(requestedScope.actionRequested||scanUserClauses(current.content).some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&/(?:建议|起步)/.test(clause.text)))){
    systemPrompt+='\n'+PERSONAL_ACTION_EVIDENCE_RULES
  }
  if(understandingOpeningRules){
    systemPrompt+='\n'+understandingOpeningRules
    const replySchema=(contract.schema.properties as any).reply
    replySchema.description=[replySchema.description,understandingOpeningRules].filter(Boolean).join('\n')
    replySchema.pattern='^[^?？]*[?？][\\s*_]*$'
  }
  const userPrompt=JSON.stringify({...promptContext,...(workflowHints?{workflowHints}:{}),...(boundedReply?{boundedReply}:{})})
  let contextTokenEstimate=estimateTokens(systemPrompt+'\n'+userPrompt)
  const retrieved=snapshot.profile.filter(item=>item.scope==='user'&&item.status==='active').length+snapshot.confirmedExperiences.length+(currentEvent?1:0)+historicalEvents.length
  const calls:TurnCallRecord[]=[]
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
  const explicitlyUnattemptedMatterQuote=(quote:string)=>/^(?:但|不过)?(?:我|本人)?(?:现在|目前)?(?:还没有|还没|尚未|没有|未)(?:开始|执行|动手)$/.test(quote)
  const explicitMatterChoiceReport=()=>{
    if(decisionComparison||personalWritesBlocked||readOnlyQuestion||instructionOnlySummary||summaryEventReadOnly||boundaryNeedsClarification||newMatterExplicit||currentConversationOnly(current.content)||currentEvent?.conversationId!==run.conversation_id)return null
    const report=reportedActionProgress(current.content,currentEvent.title)
    const choiceOnly=report.quotes.every(quote=>reportedActionProgress(quote,currentEvent.title).choice!==null&&(/^(?:我|本人)(?:现在|已经|已|决定)?(?:接受|同意|愿意试|拒绝|不接受)(?:你(?:刚才|上次|之前)?(?:建议|说|提出|给)的?)?(?:这|那|该)(?:个)?(?:步骤|建议|方案|做法|办法|方法|计划|安排|行动)$/.test(quote)||/^这只是(?:我|本人)选择接受$/.test(quote))||explicitlyUnattemptedMatterQuote(quote))
    return report.choice!==null&&report.quotes.length&&choiceOnly?report:null
  }
  const invalidSidecarChoiceReport=()=>{
    const report=explicitMatterChoiceReport()
    if(!report||!report.quotes.some(explicitlyUnattemptedMatterQuote))return null
    const boundary=/^(?:(?:这次|本次|现在|目前)?先不(?:增加|新增|加|安排)(?:其他|新的?)?(?:任务|行动|步骤|计划)|(?:不要|别)把(?:这次|本次)?(?:接受|同意|选择接受)(?:写|记|算|当)成(?:已经)?(?:完成|执行|做完)|(?:接受|同意)(?:不等于|并不代表)(?:已经)?(?:完成|执行|做完))$/
    return clauseCatalogue.every(clause=>report.quotes.includes(clause.text)||boundary.test(clause.text))?report:null
  }
  const knownTurnFields=new Set([...Object.keys(actionCoachTurnSchema.properties),'decisionProposal'])
  const discardableChoiceSidecarRejection=(wire:unknown,rejections:readonly CoachOutputRejection[]):'unknown_top_level_sidecar'|'unattempted_contribution'|null=>{
    const rejection=rejections.length===1?rejections[0]:undefined
    if(!wire||typeof wire!=='object'||Array.isArray(wire)||rejection?.stage!=='schema')return null
    const unknownKeys=Object.keys(wire).filter(key=>!knownTurnFields.has(key))
    const unknownSidecarIssues=Boolean(rejection.issues?.length)&&rejection.issues!.every(issue=>(issue.keyword==='boolean'&&issue.schemaPath==='#/additionalProperties')||(issue.keyword==='additionalProperties'&&issue.schemaPath==='#'))
    const unknownSidecarOnly=!rejection.sourceCode&&unknownSidecarIssues&&unknownKeys.length>0
    const contributionSourceIssue=rejection.issues?.length===1&&rejection.issues[0]?.keyword==='source'&&rejection.issues[0]?.schemaPath==='/event/source'
    if(unknownSidecarOnly)return 'unknown_top_level_sidecar'
    if(contributionSourceIssue&&rejection.sourceCode==='CONTRIBUTION_UNATTEMPTED_ACTION_INVALID')return 'unattempted_contribution'
    return null
  }
  async function validateOutput(raw:string):Promise<ActionCoachTurn>{
    const validationStart=performance.now()
    try{return await validateOutputInner(raw)}
    finally{validationMs=Math.round(performance.now()-validationStart)}
  }
  async function validateOutputInner(raw:string):Promise<ActionCoachTurn>{
    if(viewOnlyDrafts.length){
      let presentation:Record<string,unknown>|null=null
      try{presentation=JSON.parse(finalCoachJsonText(raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1')))}catch{}
      const bodies=presentation?.viewOnlyDrafts
      if(typeof presentation?.reply!=='string'||!Array.isArray(bodies)||bodies.length!==viewOnlyDrafts.length
        ||bodies.some((body,index)=>typeof body!=='string'||body.length>12000||!viewOnlyDraftComplete(viewOnlyDrafts[index]!,body)))throw new HttpError(400,'COACH_MATERIAL_NOT_VISIBLE')
      presentation.reply=[presentation.reply,...bodies].filter(body=>body.trim()).join('\n\n')
      delete presentation.viewOnlyDrafts
      raw=JSON.stringify(presentation)
    }
    let result:ActionCoachTurn
    const completeReply=(reply:string)=>completeUserReply(reply,current.content,code=>staged.audit.push({phase:'coach_reply_integrity_rejected',code,providerCalls:0}))
    const outputRejections:CoachOutputRejection[]=[]
    const acceptedFactInputs=new Map<number,number>()
    const acceptedFactResolvedInputs=new Map<number,number>()
    const sourceOwnsNewChoice=Boolean(namedAcceptance)&&!planIntent
    const optionalContributions=contract.capabilities.growth&&!decisionComparison&&!feedbackTarget&&!materialIntent&&!experienceCandidateRequired
      &&(sourceOwnsNewChoice||!namedMatter&&!transactionalReplyMustWait)
    const requiredFields=contract.schema.required
    const omitQuestionMatterReports=!transactionalReplyMustWait&&calls.length===1&&calls[0]!.omitQuestionMatterReports
    const ordinaryAnswerSourceIds=calls[0]?.ordinaryAnswerSourceIds
    const parseOptions:NonNullable<Parameters<typeof parseActionCoachTurn>[1]>={replyOnly:replyOnly||Boolean(switchContract),ordinaryAnswerSourceIds,sourceCatalogue:{messageId:run.source_message_id,catalogue:decisionComparison?clauseCatalogue:modelClauseCatalogue,text:current.content,canonicalFacts:!decisionComparison&&contract.capabilities.growth,optionalContributions,omitQuestionMatterReports},allowDecisionProposal:proposalCases.length>0,projectDecisionProposal:proposalConditions?value=>projectDecisionProposalWire(value,proposalCases,proposalConditions,validPreviousProposal):undefined,allowEmptyMaterialExplanation:resumePortfolioMode,allowEmptyReplyWithCompleteDraft:true,feedbackProgress:clauseId=>{
      const clause=modelClauseCatalogue.find(clause=>clause.clauseId===clauseId)
      if(!clause||clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.attributedToOther||clause.quoteSpans?.length||clause.codeSpans?.length)return undefined
      return reportedFeedbackProgress(clause.text)
    }}
    try{result=parseActionCoachTurn(raw,{...parseOptions,sourceCatalogue:{...parseOptions.sourceCatalogue!,ownedFeedbackClauses,boundFeedbackActionClauseId:bindOwnedFeedback?feedbackClause?.clauseId:undefined},onNormalization:kind=>staged.audit.push({phase:'coach_output_normalized',kind,providerCalls:0}),onRejection:diagnostic=>{outputRejections.push(diagnostic);staged.audit.push({phase:'coach_output_rejected',...diagnostic,providerCalls:0})}})}catch(error){
      const code=error instanceof Error&&['DECISION_WIRE_INVALID','DECISION_CASE_COVERAGE_INVALID','DECISION_ALLOCATION_BASIS_INVALID'].includes(error.message)?error.message:'COACH_PARSE_INVALID'
      staged.audit.push({phase:'coach_output_parse_rejected',code,providerCalls:0})
      let wire:unknown
      try{wire=JSON.parse(raw)}catch{}
      const canRebuildMatter=Boolean(namedMatter??invalidSidecarChoiceReport())
      const reply=wire&&typeof wire==='object'&&!Array.isArray(wire)&&typeof (wire as {reply?:unknown}).reply==='string'?(wire as {reply:string}).reply:null
      const discardReason=discardableChoiceSidecarRejection(wire,outputRejections)
      let recovered:ActionCoachTurn|null=null
      if(canRebuildMatter&&reply!==null&&discardReason&&wire&&typeof wire==='object'&&!Array.isArray(wire))try{
        // For the contribution rejection, every model-owned sidecar is
        // untrusted: a second malformed event/growth lane must not suppress a
        // choice and non-execution state already proven by the host parser.
        // Re-validate only the exact reply, then rebuild the matter delta from
        // the current user source below. Unknown-field failures can retain the
        // stricter known-field validation because no known lane was rejected.
        const safeWire:Record<string,unknown>=discardReason==='unattempted_contribution'?{reply}:Object.fromEntries(Object.entries(wire as Record<string,unknown>).filter(([key])=>knownTurnFields.has(key)))
        const validated=parseActionCoachTurn(JSON.stringify(safeWire),parseOptions)
        if(validated.reply===reply)recovered={reply}
      }catch{}
      let ordinaryReplyRecovered=false
      const completedCall=calls.length===1?calls[0]:undefined
      if(!recovered&&directOrdinary&&!requestedGuide&&!answerDispositionRequired&&!contract.requiredReplyKind
        &&Array.isArray(requiredFields)&&requiredFields.length===1&&requiredFields[0]==='reply'
        &&completedCall?.outcome==='completed'&&completedCall.usageCompleteness==='complete'&&completedCall.stopReason==='stop'
        &&outputRejections.length===1&&outputRejections[0]?.stage==='json'){
        const frame=replyBeforeMalformedOptionalFields(raw,ordinaryAnswerSourceIds)
        if(frame&&Object.hasOwn(contract.schema.properties as object,frame.field)&&!ordinaryPrivateRecord.test(frame.reply)&&!ordinaryWriteReceipt.test(frame.reply))try{
          const validated=parseActionCoachTurn(JSON.stringify(frame.wire),parseOptions)
          if(validated.reply===frame.reply){recovered=validated;ordinaryReplyRecovered=true}
        }catch{}
      }
      if(recovered){
        result=recovered
        if(ordinaryReplyRecovered)staged.audit.push({phase:'ordinary_reply_preserved_after_optional_json_error',providerCalls:0})
        else staged.audit.push({phase:'invalid_provider_sidecar_discarded_for_explicit_matter_choice',reason:discardReason,discardedFields:Object.keys(wire as object).filter(key=>key!=='reply').length,providerCalls:0})
      }else{
        await captureSyntheticOutput(run.user_id,run.request_id,raw,staged,'rejected_synthetic_business_output_captured')
        throw new HttpError(502,'COACH_OUTPUT_INVALID')
      }
    }
    let readOnlyDraftDelivered=false
    const outputAction=result.event?.action
    if(outputAction?.operation==='create'||outputAction?.operation==='modify'){
      const source=outputAction.source?.messageId===run.source_message_id?outputAction.source:null
      const ranges=source&&viewOnlyDrafts.length?sourceQuoteRanges(current.content,source.quote):[]
      const range=source&&(selectedSourceRange(source)??(ranges.length===1?ranges[0]:undefined))
      const outputReadOnly=readOnlyMaterial||Boolean(range&&viewOnlyDrafts.some(request=>request.range.start===range.start&&request.range.end===range.end))
      if(outputReadOnly||actionRestrictions[outputAction.operation]){
        if(!outputReadOnly&&deliverableIntent(current.content,outputAction.operation)&&'content'in outputAction.draft){
          await validateReadOnlyCoachDraft(run,outputAction.operation,outputAction.draft.content,outputAction.source)
          result.reply=renderCoachReply(result)
          readOnlyDraftDelivered=materialPersistenceRefused||actionRestrictions[outputAction.operation]
        }
        delete result.event!.action
      }
    }
    if(actionRestrictions.plan)delete result.weeklyPlan
    const boundFeedbackEvent=bindOwnedFeedback&&result.event?.target.operation==='continue'&&result.event.target.eventId===feedbackTarget?.event.id?result.event:undefined
    if(feedbackTarget&&contract.capabilities.event&&!boundedReply&&(!result.event?.matterReports||bindOwnedFeedback)){
      const {event,nodeId,proof}=feedbackTarget
      if(feedbackClause&&contract.capabilities.growth){
        // The owned report is one partial attempt. Its negative outcome is
        // evidence of that attempt, never a second unattempted action.
        const updates=result.growthUpdates??=[]
        const existing=updates.findIndex(item=>item.assertion==='user_reported'&&item.target.operation==='create'&&item.source.clauseId===feedbackClause.clauseId)
        if(existing>=0&&reportedContribution(updates[existing]!)){
          const update=updates[existing]!
          if(update.kind==='feedback')update.progressState='attempted'
        }else{
          const projected=parseActionCoachTurn(JSON.stringify({reply:result.reply,growthUpdates:[{
            target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'attempted',source:{clauseId:feedbackClause.clauseId},contribution:{actor:'self',actionQuote:feedbackClause.text},
          }]}),parseOptions).growthUpdates?.[0]
          if(projected&&existing<0)updates.push(projected)
          else if(projected)updates[existing]=projected
        }
        if(result.experienceCandidate){
          const selection=resolveContiguousClauseRange(current.content,clauseCatalogue,result.experienceCandidate.source.clauseIds)
          if(selection&&selection.start<proof.range.end&&proof.action.start<selection.end)delete result.experienceCandidate
        }
      }
      const sources=feedbackSources.map(clause=>clauseMessageSource(run.source_message_id,clause))
      const sameSource=(left:{messageId:string;quote:string},right:{messageId:string;quote:string})=>{
        const range=selectedSourceRange(left),other=selectedSourceRange(right)
        return left.messageId===right.messageId&&left.quote===right.quote&&range!==undefined&&range.start===other?.start&&range.end===other.end
      }
      const nodes=boundFeedbackEvent?.nodes??[]
      const missingSources=sources.filter(source=>!nodes.some(node=>node.kind==='fact'&&sameSource(source,node.source)))
      const legacy={target:{operation:'continue' as const,eventId:event.id,expectedRevision:event.revision},resolveUnknowns:nodeId?[nodeId]:[]}
      result.event={...(boundFeedbackEvent??legacy),nodes:[...nodes,...missingSources.map(source=>({kind:'fact' as const,source}))]}
      if(bindOwnedFeedback){
        const firstOutcome=proof.clauses[0]!
        result.event.matterReports=[{state:'partial',choice:null,resumed:false,source:clauseMessageSource(run.source_message_id,firstOutcome)},
          ...(boundFeedbackEvent?.matterReports??[]).filter(report=>!sources.some(source=>sameSource(source,report.source)))]
      }
      staged.audit.push({phase:'feedback_event_bound_from_source',eventId:event.id,nodeId:nodeId??null,sourceMessageId:run.source_message_id,providerCalls:0})
    }
    if(answerDispositionRequired&&(!result.event||!Object.hasOwn(result.event,'resolveUnknowns'))){
      await captureSyntheticOutput(run.user_id,run.request_id,raw,staged,'rejected_synthetic_business_output_captured')
      staged.audit.push({phase:'coach_output_rejected',stage:'missing_unknown_disposition',providerCalls:0})
      throw new HttpError(502,'COACH_UNKNOWN_DISPOSITION_MISSING')
    }
    if(calls.length)await captureSyntheticOutput(run.user_id,run.request_id,raw,staged,'synthetic_business_output_captured')
    if(!completeReply(result.reply))throw new HttpError(502,'REPLY_INCOMPLETE_OR_INTERNAL')
    if(!keepsProgressObject(result.reply))throw new HttpError(502,'REPLY_PROGRESS_OBJECT_MISSING')
    if(progressTiming){
      const delivery=progressTiming.exec(result.reply)
      if(!delivery||EXPLICIT_LATEST_TIME.test(result.reply))throw new HttpError(502,'REPLY_PROGRESS_TIMING_CHANGED')
      const statuses=[result.reply.slice(0,delivery.index),result.reply.slice(delivery.index+delivery[0].length)].flatMap(statusClauses)
      const keepsStatuses=statuses.length===statusChecks.length&&statusChecks.every(check=>{
        const match=statuses.findIndex(check)
        if(match<0)return false
        statuses.splice(match,1)
        return true
      })
      if(!keepsStatuses)throw new HttpError(502,'REPLY_PROGRESS_STATE_MISSING')
    }
    if(proposalConditions&&proposalCases.length){
      if(!result.decisionProposal)throw new HttpError(400,'DECISION_PROPOSAL_MISSING')
      try{validateDecisionProposal(result.decisionProposal,proposalCases,proposalConditions,validPreviousProposal,result.reply)}catch(error){const code=error instanceof Error?error.message:'DECISION_PROPOSAL_INVALID';staged.audit.push({phase:'decision_proposal_rejected',code,items:result.decisionProposal.items.map(item=>({caseIndex:proposalCases.findIndex(c=>c.eventId===item.eventId),mode:item.mode,minutesCeiling:item.minutesCeiling})),orderRelation:result.decisionProposal.orderRelation,providerCalls:0});throw new HttpError(400,code)}
      staged.audit.push({phase:'decision_proposal',...result.decisionProposal,conditions:proposalConditions,realConditions,persistence:'PROPOSAL_NOT_USER_CHOICE',providerCalls:0})
    }
    const preferenceSurfaces=[result.reply,...(result.lead?[result.lead]:[])]
    if(preferenceSurfaces.some(text=>unsupportedPreferenceConstraintClaims(text,promptContext.currentTask.responseScope.reportedEvidence.preferences,current.id,current.content).length))throw new HttpError(502,'REPLY_PREFERENCE_HARDENED')
    if(contract.requiredReplyKind==='comparison'&&!comparisonReplyAccepts(result.reply,current.content)){
      // The validated parser may have normalized a wrapper while the provider's
      // complete JSON reply still carries both explicitly labelled options.
      // Use that exact raw reply only when the comparison validator accepts it.
      try{const rawReply=(JSON.parse(raw) as any)?.reply;if(typeof rawReply==='string'&&comparisonReplyAccepts(rawReply,current.content)){result.reply=rawReply;staged.audit.push({phase:'comparison_reply_restored_from_raw',providerCalls:0})}}catch{}
      if(!comparisonReplyAccepts(result.reply,current.content)){if(process.env.LIFEOS_DEBUG_COMPARISON)appendFileSync('.local/comparison-debug.txt',JSON.stringify({reply:result.reply,raw,current:current.content})+'\n');throw new HttpError(502,'REPLY_COMPARISON_MISSING')}
    }
    if(comparisonContract.requiredReplyKind==='comparison'&&!comparisonUniverseAccepts(result.reply,current.content))throw new HttpError(502,'REPLY_COMPARISON_UNBOUNDED')
    if(!requestedActionLimitAccepts(result.reply,current.content))throw new HttpError(502,'REPLY_ACTION_LIMIT')
    if(contract.requiredReplyKind==='summary'&&!summaryReplyAccepts(result.reply))throw new HttpError(502,'REPLY_SUMMARY_MISSING')
    // Validate unsupported causal claims without rewriting or shortening prose.
    const reportedCausalEvidence=[current.content,...messages.filter(message=>message.role==='user').map(message=>message.content),...snapshot.confirmedExperiences.map(item=>item.quote),...growthAll.filter(item=>item.status==='active'&&!item.unavailableReason&&['user_reported','user_edit'].includes(item.assertion)).flatMap(item=>item.assertion==='user_edit'?[item.text]:item.sources.flatMap(source=>source.quote?[source.quote]:[]))].join('\n')
    if(softenSingleObservationCausality(result.reply,current.content,reportedCausalEvidence)!==null||(!result.citations?.length&&observationEffectHypothesis(result.reply,true)!==null))throw new HttpError(502,'REPLY_CAUSALITY_UNGROUNDED')
    if(!boundedReply&&!materialIntent&&!planIntent&&(grillingMode==='ordinary'||grillingMode==='explore')&&openUnreportedChoiceQuestion(result.reply,current.content)!==null)throw new HttpError(502,'REPLY_QUESTION_PREMISE_UNGROUNDED')
    if(enforceReportedQuantity(result.reply,current.content)!==null)throw new HttpError(502,'REPLY_QUANTITY_INVALID')
    const generatedReply=result.reply
    const generatedAskedNodes=new Set(result.event?.nodes?.filter(node=>node.kind==='unknown'&&generatedReply.includes(node.question.trim()))??[])
    // Ordinary model prose is not edited after generation: no sentence,
    // question-count or wording repair may discard the visible answer.
    // Authorization, source, explicit quantity and state checks still fail closed.
    if(!boundedReplyAccepts(result.reply,boundedReply)){
      throw new HttpError(502,'BOUNDED_REPLY_INVALID')
    }
    if(requestedGuide&&!result.citations?.length)throw new HttpError(400,'COACH_CITATION_INVALID')
    if(/"(?:readiness|missingRequired|materialFactIds|materialEvidence)"\s*:/.test(raw))staged.audit.push({phase:'provider_material_metadata_ignored',providerCalls:0})
    if(explicitMaterial?.event?.action&&'draft'in explicitMaterial.event.action&&result.event?.action&&'draft'in result.event.action)result.event.action.draft=explicitMaterial.event.action.draft
    if(personalWritesBlocked){
      delete result.experienceCandidate;delete result.background;delete result.weeklyPlan;delete result.event;result.growthUpdates=[]
      staged.audit.push({phase:'explicit_analysis_only_writes_suppressed',providerCalls:0})
    }
    if(decisionComparison&&!personalWritesBlocked&&actualBindings.length===1&&!result.event){
      const actual=actualBindings[0]
      result.event={target:{operation:'continue',eventId:actual.event.id,expectedRevision:actual.event.revision},nodes:[{kind:'fact',source:clauseMessageSource(run.source_message_id,actual.clause)}]}
      staged.audit.push({phase:'decision_comparison_actual_transition_bound',eventId:actual.event.id,sourceMessageId:run.source_message_id,providerCalls:0})
    }
    if(decisionComparison){
      delete result.experienceCandidate;delete result.background;delete result.weeklyPlan
      if(!contract.capabilities.growth)delete result.growthUpdates
      if(result.event){
        if(result.event.target.operation!=='continue'||!result.event.nodes?.length||result.event.action||result.event.corrections?.length||result.event.resolveUnknowns?.length||result.event.declineUnknowns?.length)throw new HttpError(400,'TRIAL_EVENT_MUTATION_NOT_AUTHORIZED')
        const targetId=result.event.target.eventId
        for(const node of result.event.nodes){
          if(node.kind!=='fact')throw new HttpError(400,'TRIAL_EVENT_MUTATION_NOT_AUTHORIZED')
          const {source}=node
          const selected=selectedSourceRange(source)
          const ranges=selected?[selected]:sourceQuoteRanges(current.content,source.quote)
          if(source.messageId!==run.source_message_id||ranges.length!==1)throw new HttpError(400,'TRIAL_SOURCE_NOT_WRITABLE')
          const range=ranges[0]!,binding=actualBindings.find(candidate=>candidate.quote===source.quote&&candidate.clause.start===range.start&&candidate.clause.end===range.end)
          if(!binding||binding.event.id!==targetId)throw new HttpError(400,'TRIAL_ACTUAL_TARGET_MISMATCH')
          if(!selected)inheritSourceRange(clauseMessageSource(run.source_message_id,binding.clause),source)
        }
      }
    }
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
      throw new HttpError(502,'BOUNDED_REPLY_INVALID')
    }
    if(distinctionActionRequested){
      const boundedDistinction=boundedDistinctionReply(current.content)
      if(boundedDistinction===null)throw new HttpError(502,'REPLY_DISTINCTION_ACTION_INVALID')
      if(result.reply!==boundedDistinction)throw new HttpError(502,'REPLY_DISTINCTION_ACTION_INVALID')
      if(Object.hasOwn((contract.schema as any).properties,'lead'))result.lead=boundedDistinction.slice(0,boundedDistinction.indexOf('。')+1)
      if(!distinctionActionAccepts(result.reply,current.content))throw new HttpError(502,'REPLY_DISTINCTION_ACTION_INVALID')
    }
    staged.coach=undefined;staged.candidates=[];staged.memoryChanges=[];staged.growth=undefined;staged.factInterpretations=undefined
    if(result.event?.action&&result.event.action.operation!=='close'&&!materialIntent){
      const target=result.event.target
      let event=target.operation==='continue'?[currentEvent,...historicalEvents].find(event=>event?.id===target.eventId)??null:null
      let eventBindings:CoachEventSourceBindings|undefined
      if(event)try{const authoritative=await coachEventViewWithSources(run.user_id,run.conversation_id,event.id);event=authoritative.event;eventBindings=authoritative.bindings}catch(error){if(error instanceof HttpError&&[403,404,409].includes(error.status))event=null;else throw error}
      const unchanged=unchangedProposedAction(event,result.event)
      const effective=effectiveMaterialRequest(current.content,result.event.action.operation==='modify'?'modify':'create',event,eventBindings)
      if(unchanged||effective.disposition==='declined'||'draft'in result.event.action&&!effective.inheritedActionRequest){
        delete result.event.action
        staged.audit.push({phase:unchanged?'unchanged_unrequested_material_dropped':'unsolicited_material_dropped',providerCalls:0})
        if(!result.event.nodes?.length&&!result.event.corrections?.length&&!result.event.resolveUnknowns?.length&&!result.event.declineUnknowns?.length&&!result.event.matterReports?.length)delete result.event
      }
    }
    if(result.event?.target.operation==='continue'&&result.event.resolveUnknowns?.length){
      const targetId=result.event.target.eventId
      const event=[currentEvent,...historicalEvents].find(event=>event?.id===targetId)
      const priorFeedbackId=compactFeedback?priorFeedbackReport?.sourceMessageId:undefined
      const priorFeedbackGaps=priorFeedbackId?event?.processTurns?.find(turn=>turn.sourceMessageId===priorFeedbackId)?.introducedUnknownNodeIds:undefined
      const engagementSources=[...reportedEvidenceFromText(current.content).preferences.filter(preference=>preference.modality==='like').map(preference=>preference.quote),
        ...reportedPursuitClauses(current.content).filter(clause=>/^(?:我|本人)(?:最|更|确实|现在)?愿意/.test(clause.text)).map(clause=>clause.text)]
      result.event.resolveUnknowns=result.event.resolveUnknowns.filter(id=>{
        const question=event?.nodes.find(node=>node.id===id&&node.kind==='unknown')?.content??''
        if(priorFeedbackGaps?.includes(id)&&id!==immediateAnsweredUnknown?.id&&!clauseCatalogue.some(clause=>
          !clause.interrogative&&!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&!assistantRequestClause(clause.text)&&unknownQuestionTopicMatches(question,clause.text))){
          staged.audit.push({phase:'prior_feedback_unknown_retained',nodeId:id,providerCalls:0});return false
        }
        // A reply that still presents the same item as unknown cannot close it
        // in the persisted event state.
        if(scanUserClauses(result.reply).some(clause=>/(?:仍未知|尚未确认|不确定|是否偶然|不知道|未确认)/.test(clause.text)&&unknownQuestionTopicMatches(question,clause.text))){
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
      if(feedbackRevision&&result.event.matterReports)result.event.matterReports=result.event.matterReports.filter(report=>!excludedEventSource(report.source.quote))
      if(result.event.nodes)result.event.nodes=result.event.nodes.flatMap<NonNullable<NonNullable<ActionCoachTurn['event']>['nodes']>[number]>(node=>{
        if(node.kind==='unknown')return [node]
        const clauses=scanUserClauses(node.source.quote)
        if(!clauses.some(clause=>excludedEventSource(clause.text)))return [node]
        // Keep literal factual clauses when a provider selected a mixed span;
        // removing an instruction must not remove the adjacent real condition.
        return clauses.filter(clause=>!excludedEventSource(clause.text)).map(clause=>({...node,source:{...node.source,quote:clause.text}}))
      })
      if(result.event.corrections){
        const target=result.event.target,event=target.operation==='continue'?[currentEvent,...historicalEvents].find(event=>event?.id===target.eventId):null
        result.event.corrections=result.event.corrections.filter(correction=>{
          if(excludedEventSource(correction.source.quote))return false
          const node=event?.nodes.find(node=>node.id===correction.nodeId)
          if(node&&node.kind!=='unknown'&&unrelatedExternalCorrection(node.content,correction.source.quote)){
            // Preserve both facts without a second provider call. The new
            // source remains an additive fact, never a replacement identity.
            result.event!.nodes??=[]
            if(!result.event!.nodes.some(candidate=>candidate.kind==='fact'&&candidate.source.messageId===correction.source.messageId&&candidate.source.quote===correction.source.quote))result.event!.nodes.push({kind:'fact',source:correction.source})
            staged.audit.push({phase:'unrelated_external_correction_preserved',nodeId:node.id,providerCalls:0})
            return false
          }
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
      if(!result.event.nodes?.length&&!result.event.action&&!result.event.corrections?.length&&!result.event.resolveUnknowns?.length&&!result.event.declineUnknowns?.length&&!result.event.matterReports?.length)delete result.event
    }

    // A provider may acknowledge a choice in prose but omit its event lane.
    // Bind only an explicit choice to the current conversation's known matter;
    // reuse the native progress parser and normal revision/source transaction.
    const acceptedClause=acceptedStepMode==='initial'&&acceptedStep&&contract.capabilities.growth
      &&(supportsNativeStrictSchema(runtime.model)||result.event?.matterReports?.some(report=>report.choice==='accepted'))
      ?namedAcceptance?.clauses.find(clause=>clause.text===acceptedStep.quote):undefined
    if(acceptedClause&&namedAcceptance){
      const selectionClause=modelClauseCatalogue.find(clause=>clause.start===namedAcceptance.task.start&&clause.end===namedAcceptance.task.end)
      if(selectionClause)result.growthUpdates=result.growthUpdates?.map(update=>{
        if(update.target.operation!=='create'||update.assertion!=='user_reported'||update.kind!=='feedback'||update.source.clauseId!==selectionClause.clauseId)return update
        const {progressState:_,...selection}=update
        return {...selection,kind:'context'}
      })
    }
    if(namedMatter&&(!result.event?.matterReports||acceptedClause)&&(switchedMatter||!result.event||result.event.target.operation==='create')){
      const target=result.event?.target
      const ownsProviderTarget=target?.operation==='create'&&target.title===namedMatter.title&&target.source.quote===namedMatter.task.text
      const optionalEvent=switchedMatter?undefined:namedAcceptance
        ?materialIntent&&result.event?.action?.operation==='create'?{action:result.event.action}:undefined
        :result.event
      const initialNodes=namedMatter.clauses.map(clause=>({kind:'fact' as const,source:clauseMessageSource(run.source_message_id,clause)}))
      const reportedQuotes=new Set(namedMatter.clauses.map(clause=>clause.text))
      const otherNodes=switchedMatter?[]:(result.event?.nodes??[]).filter(node=>{
        if(namedAcceptance&&!ownsProviderTarget)return false
        if(node.kind==='unknown')return true
        if(!namedAcceptance)return !reportedQuotes.has(node.source.quote)
        const range=selectedSourceRange(node.source)
        return Boolean(acceptedClause&&range&&!namedMatter.clauses.some(clause=>clause.start===range.start&&clause.end===range.end))
      })
      const priorReports=ownsProviderTarget?result.event?.matterReports??[]:[]
      const matterReports=acceptedClause?[{state:null,choice:'accepted' as const,resumed:false,source:clauseMessageSource(run.source_message_id,acceptedClause)},
        ...priorReports.flatMap(report=>{
          const range=selectedSourceRange(report.source)
          if(range?.start===acceptedClause.start&&range.end===acceptedClause.end)return []
          if(report.choice!=='accepted')return [report]
          // A model may attach the choice to the time earmarked for a future
          // attempt. Keep independently reported progress on its own source.
          const state=reportedActionProgress(report.source.quote,namedMatter.title).state
          return report.state&&report.state!=='accepted'&&(report.state===state||report.state==='attempted'&&clauseReportsPastAction(report.source.quote))
            ?[{...report,choice:null}]:[]
        })]:undefined
      result.event={...optionalEvent,target:{operation:'create',title:namedMatter.title,source:clauseMessageSource(run.source_message_id,namedMatter.task)},nodes:[...initialNodes,...otherNodes],...(matterReports?{matterReports}:{})}
      staged.audit.push({phase:switchedMatter?'switched_matter_choice_source_bound':'named_matter_choice_source_bound',providerCalls:0})
    }else if(!result.event){
      const report=explicitMatterChoiceReport()
      if(report){
        result.event={target:{operation:'continue',eventId:currentEvent!.id,expectedRevision:currentEvent!.revision},nodes:clauseCatalogue.filter(clause=>report.quotes.includes(clause.text)).map(clause=>({kind:'fact',source:clauseMessageSource(run.source_message_id,clause)}))}
        staged.audit.push({phase:'explicit_matter_choice_source_bound',eventId:currentEvent!.id,providerCalls:0})
      }
    }
    if(!personalWritesBlocked&&!decisionComparison){
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
        &&!reportedPurposeClause(handle.text)
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
          // Source-selected resumes have one authoritative factual artifact.
          // Never discard a model-authored second body and pretend it passed:
          // exact duplicate material is safe; unverifiable extra prose fails.
          const paragraphs=result.reply.split(/\n\s*\n/)
          if(paragraphs.length>1&&result.reply.trim()!==material.content&&paragraphs.slice(1).join('\n\n').trim()!==material.content)throw new HttpError(400,'MATERIAL_NARRATIVE_UNVERIFIED')
        }catch(error){
          throw error instanceof Error&&(error.message==='MATERIAL_REFERENCE_INVALID'||error.message==='MATERIAL_CATALOGUE_INVALID'||error.message==='MATERIAL_OUTPUT_LIMIT')?new HttpError(400,'MATERIAL_REFERENCE_INVALID'):error
        }
      }
    }
    const hasMaterial=result.event?.action&&'draft'in result.event.action
    if(mixedViewOnly&&materialIntent&&!hasMaterial)throw new HttpError(400,'COACH_MATERIAL_NOT_VISIBLE')
    // Question marks inside quoted examples or a complete draft are not a
    // state/source violation. Keep explicit quantity guidance in the prompt;
    // never reject or cut a material solely by counting punctuation.
    const requestedMaterial=!materialPersistenceRefused&&!readOnlyDraftDelivered&&deliverableIntent(current.content,materialOperation)
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
      if(scanUserClauses(result.reply).some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.quoteSpans.length&&!clause.codeSpans.length&&/^\s*(?:[-*•]|\d+[.)、])\s*\d+\s*[–—~～-]\s*\d+\s*(?:min|分钟|小时)\s*[:：]/i.test(clause.text)))throw new HttpError(502,'REPLY_PLAN_SHADOW_SCHEDULE')
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
    // Definitions are schema-bound before generation, not substituted afterward.
    if(sourceDefinition){
      if(result.reply!==sourceDefinition)throw new HttpError(502,'BOUNDED_REPLY_INVALID')
      if(result.event?.nodes)result.event.nodes=result.event.nodes.filter(node=>{
        if(node.kind!=='unknown')return true
        const topic=/^你(?:所)?说的[“「『"]([^”」』"]{1,30})[”」』"]/.exec(node.question)?.[1]
        // Do not persist an unrelated model-authored question that was never
        // asked. Only the owned definition can share this displayed question.
        if(!topic||!ownedOpenDefinitionQuestion(`你说的“${topic}”具体指什么？`,current.content))return false
        node.question=sourceDefinition;return true
      })
    }
    if(violatesLabelInferenceBoundary(result.reply,inferenceBoundaries,current.content))throw new HttpError(502,'REPLY_RECREATES_REJECTED_LABEL')
    if(distinctionActionRequested&&!distinctionActionAccepts(result.reply,current.content))throw new HttpError(502,'REPLY_DISTINCTION_ACTION_INVALID')
    // P5.3 step 8: the final reply must not contradict the verified effects.
    // Reject a contradictory budget rather than silently rewriting model prose.
    const budgetRepaired=repairReplyBudget(obligations,result.reply)
    if(budgetRepaired!==result.reply)throw new HttpError(502,'REPLY_BUDGET_CONTRADICTION')
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
    const statusReadbackReply=sourceStatusReadback?repairStatusUpdate(sourceStatusReadback,current.content)?.reply??sourceStatusReadback:null
    if(statusReadbackReply){
      result.reply=statusReadbackReply
      const matches=!retrieval.ambiguous?historicalEvents.filter(event=>event.nodes.some(node=>node.kind==='fact'&&node.source&&sameReportedResponseSubject(node.content,current.content,{sameEvent:true}))):[]
      if(!result.event&&matches.length===1){
        const event=matches[0]!,reports=reportedEvidenceFromText(current.content).participants.filter(report=>report.states.response.status==='reported_response'&&event.nodes.some(node=>node.kind==='fact'&&node.source&&sameReportedResponseSubject(node.content,report.quote,{sameEvent:true})))
        // A truncated retrieval result is not uniqueness proof. Check the
        // eligible workspace set for these actors before binding a bare role.
        const known=(await pool.query("SELECT DISTINCT n.event_id FROM coach_nodes n JOIN coach_events e ON e.user_id=n.user_id AND e.id=n.event_id WHERE n.user_id=$1 AND (e.conversation_id=$2 OR $3::boolean) AND e.status<>'forgotten' AND n.kind='fact' AND n.status='active' AND n.content LIKE ANY($4::text[])",[run.user_id,run.conversation_id,snapshot.settings.enabled,reports.map(report=>'%'+report.actor+'%')])).rows
        const quotes=[...new Set(reports.map(report=>report.quote))]
        if(quotes.length&&known.length===1&&known[0].event_id===event.id){
          result.event={target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:quotes.map(quote=>({kind:'fact',source:{messageId:run.source_message_id,quote}}))}
          staged.audit.push({phase:'verified_response_bound_to_existing_event',eventId:event.id,providerCalls:0})
        }
      }
      staged.audit.push({phase:'participant_status_projected_from_current_source',sourceMessageId:run.source_message_id,synthesized:statusReadbackReply!==sourceStatusReadback,providerCalls:0})
    }
    if(!boundedReplyAccepts(result.reply,boundedReply)){
      throw new HttpError(502,'BOUNDED_REPLY_INVALID')
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
    if(result.event&&!decisionComparison&&contract.capabilities.growth)resolveProcessSourceHandles(result,{messageId:run.source_message_id,catalogue:clauseCatalogue,text:current.content,canonicalFacts:true,hostFactClauses:bindOwnedFeedback||!result.event.matterReports?ownedFeedbackClauses:undefined})
    if(result.growthUpdates?.length){
      staged.audit.push({phase:'growth_plan_context',authorizedCount:growthAll.length,authorizedKinds:growthAll.map(item=>item.kind),planTargetItem:correctionPlan?.target?.itemId??null,newQuote:correctionPlan?.newQuote??null,providerCalls:0})
      const authoritative=resolveGrowthDeltas({deltas:result.growthUpdates,requestTimeUtc:new Date(current.created_at).toISOString(),suppressObservations:obligations.requiredEffects.some(effect=>effect.type==='remaining_time'||effect.type==='weekly_time'),currentMessageId:run.source_message_id,currentText:current.content,catalogue:modelClauseCatalogue,authorized:growthAll.map(item=>({id:item.id,revision:item.revision,kind:item.kind,assertion:item.assertion,text:item.text,unavailableReason:item.unavailableReason,status:item.status,inferenceBoundary:item.inferenceBoundary})),correctionPlan,controlClauseTexts,inferenceBoundaries})
      for(const entry of authoritative.audit)staged.audit.push(entry)
      staged.audit.push({phase:'growth_model_input_shape',ops:result.growthUpdates.map((delta)=>({op:delta.target.operation,itemId:delta.target.operation==='correct'?delta.target.itemId.slice(0,8):null,clauseId:delta.source.clauseId,kind:delta.kind})),providerCalls:0})
      for(const delta of authoritative.deltas)if(delta.assertion==='ai_observation'&&delta.dependencies.some(ref=>'id'in ref&&(recommendationBlockedIds.has(ref.id)||unresolvedTaskBoundaries.some(item=>item.id===ref.id))))throw new HttpError(400,'RECOMMENDATION_CONTROL_NOT_APPLIED')
      const growthDeltas=authoritative.deltas.map(normalizeModelFeedbackDelta)
      const normalizedGrowthCount=growthDeltas.reduce((count,delta,index)=>count+(delta!==authoritative.deltas[index]?1:0),0)
      if(normalizedGrowthCount)staged.audit.push({phase:'model_growth_delta_normalized',count:normalizedGrowthCount,providerCalls:0})
      if(growthDeltas.length){
        const stageOptions={allowedDirectionScopes:allowedDirectionScopes}
        const isolated=await stageGrowthPreservingFeedback(growthDeltas,result.reply,Boolean(result.weeklyPlan),async changes=>{
          const value=await stageGrowth(changes,stageOptions)
          // Isolating one invalid feedback must not renumber surviving source
          // references. Preserve original resolved-input positions explicitly.
          return {...value,inputIndexBindings:new Map([...value.inputIndexBindings].map(([inputIndex,normalizedIndex])=>[growthDeltas.indexOf(changes[inputIndex]!),normalizedIndex]))}
        })
        if(isolated.dropped.length)staged.audit.push({phase:'growth_optional_feedback_dropped',dropped:isolated.dropped.length,sourceSha256:createHash('sha256').update(isolated.dropped.join('\n')).digest('hex'),providerCalls:0})
        if(isolated.value!==undefined)staged.growth=isolated.value
      }
      for(const [inputIndex,resolvedIndex] of authoritative.indexMap){
        const fact=authoritative.deltas[resolvedIndex]
        const savedIndex=staged.growth?.inputIndexBindings.get(resolvedIndex)
        if(fact?.assertion==='user_reported'&&savedIndex!==undefined&&staged.growth?.changes[savedIndex]?.assertion==='user_reported'){acceptedFactInputs.set(inputIndex,savedIndex);acceptedFactResolvedInputs.set(inputIndex,resolvedIndex)}
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
    let supplementBase=-1
    // P2-1 fallback: the model produced no verifiable correction. Stage the
    // deterministic amend (or, without a safe target, the verbatim new value)
    // so a correction turn never ends with the old fact still quietly active.
    const correctionAlreadyPrepared=correctionPlan?.target&&staged.growth?.prepared.some(entry=>entry.kind==='split_amend'
      ?entry.parent.id===correctionPlan.target!.itemId&&entry.parent.revision===correctionPlan.target!.expectedRevision&&entry.field===correctionPlan.target!.field&&entry.currentSource.quote===correctionPlan.newQuote
      :!correctionPlan.target!.field&&entry.delta.target.operation!=='create'&&entry.delta.target.itemId===correctionPlan.target!.itemId&&entry.delta.target.expectedRevision===correctionPlan.target!.expectedRevision&&entry.delta.source.quote===correctionPlan.newQuote)
    if(correctionPlan&&!correctionAlreadyPrepared&&!( !correctionPlan.target&&staged.growth?.changes.some(delta=>delta.target.operation==='create'&&delta.assertion==='user_reported'&&delta.kind==='context'&&delta.text===correctionPlan.newQuote&&delta.source.quote===correctionPlan.newQuote))){
      const timeSource=supplementMissingBudgetDeltas(obligations,staged.growth,run.source_message_id,current.content).find(delta=>delta.kind==='constraint'&&delta.source.quote.includes(correctionPlan.newQuote))
      const amendDelta=correctionPlan.target?{target:{operation:'amend' as const,itemId:correctionPlan.target.itemId,expectedRevision:correctionPlan.target.expectedRevision,beforeQuote:correctionPlan.target.beforeQuote,...(correctionPlan.target.field?{field:correctionPlan.target.field}:{})},assertion:'user_reported' as const,kind:correctionPlan.target.kind as 'context',...(timeSource&&'timeEvidence'in timeSource?{timeEvidence:timeSource.timeEvidence}:{}),source:{messageId:run.source_message_id,quote:correctionPlan.newQuote}}:null
      let stagedCorrection=null
      if(amendDelta){
        stagedCorrection=await stageGrowth([amendDelta],{})
        if(!stagedCorrection.changes.length)throw new HttpError(400,'CORRECTION_TARGET_NOT_APPLIED')
      }
      if(!stagedCorrection?.changes.length){
        stagedCorrection=await stageGrowth([{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{messageId:run.source_message_id,quote:correctionPlan.newQuote}}],{})
      }
      if(stagedCorrection.changes.length){
        const mergedChanges=[...(staged.growth?.changes??[]),...stagedCorrection.changes]
        const mergedBindings=new Map(staged.growth?.inputIndexBindings??[])
        const syntheticBase=Math.max(supplementBase,result.growthUpdates?.length??0)
        stagedCorrection.changes.forEach((_,i)=>mergedBindings.set(syntheticBase+i,mergedChanges.length-stagedCorrection!.changes.length+i))
        const offset=staged.growth?.changes.length??0
        staged.growth={changes:mergedChanges,prepared:[...(staged.growth?.prepared??[]),...stagedCorrection.prepared.map(entry=>entry.kind==='split_amend'?{...entry,normalizedIndex:entry.normalizedIndex+offset}:entry)],inputIndexBindings:mergedBindings,skipped:[...(staged.growth?.skipped??[]),...(stagedCorrection.skipped??[])]}
        staged.audit.push({phase:'correction_server_staged',mode:amendDelta&&stagedCorrection.prepared.some(entry=>entry.kind==='split_amend')?'amend':'verbatim_create',providerCalls:0})
      }
    }
    // P1: a server-verified budget the model failed to persist is staged from
    // the obligation itself (the user's verbatim clause) so an explicit budget
    // statement never fails its own turn. Same deterministic pattern as
    // explicit direction controls; audit records the supplement. P2: synthetic
    // provider positions let a plan reference the supplement fact when the
    // model's own budget delta was skipped.
    const budgetSupplement=supplementMissingBudgetDeltas(obligations,staged.growth,run.source_message_id,current.content)
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
    for(const target of correctionPlan?.relatedTargets??[]){
      const prepared=staged.growth?.prepared??[]
      if(prepared.some(entry=>entry.kind==='split_amend'?entry.parent.id===target.itemId:entry.delta.target.operation!=='create'&&entry.delta.target.itemId===target.itemId))continue
      const extra=await stageGrowth([{target:{operation:'amend',...target},kind:target.kind,assertion:'user_reported',source:{messageId:run.source_message_id,quote:correctionPlan!.newQuote}}],{})
      const offset=staged.growth?.changes.length??0
      staged.growth={changes:[...(staged.growth?.changes??[]),...extra.changes],prepared:[...prepared,...extra.prepared.map(entry=>entry.kind==='split_amend'?{...entry,normalizedIndex:entry.normalizedIndex+offset}:entry)],inputIndexBindings:new Map(staged.growth?.inputIndexBindings??[]),skipped:[...(staged.growth?.skipped??[]),...(extra.skipped??[])]}
      staged.audit.push({phase:'same_source_correction_staged',itemId:target.itemId,providerCalls:0})
    }
    const responseEvent=result.event?.target.operation==='continue'?[currentEvent,...historicalEvents].find(event=>event?.id===(result.event!.target as {eventId:string}).eventId):null
    const responseAlreadyBound=responseEvent?.nodes.some(node=>node.kind==='fact'&&node.source&&sameReportedResponseSubject(node.content,current.content,{sameEvent:true}))
    if(contract.capabilities.growth&&!currentConversationOnly(current.content)&&!responseAlreadyBound){
      const continuations=reportedResponseContinuationTargets(current.content,growthAll.filter(item=>item.status==='active'&&!item.unavailableReason&&['user_reported','user_edit'].includes(item.assertion)).map(item=>({id:item.id,revision:item.revision,text:item.text,sourceMessageIds:item.sources.filter(source=>source.type==='message').map(source=>source.id),blocked:Boolean(item.taskBoundary||item.recommendationStopped||item.inferenceBoundary?.active||item.kind!=='context')})))
      for(const target of continuations){
        const prepared=staged.growth?.prepared??[]
        if(prepared.some(entry=>entry.kind==='split_amend'?entry.parent.id===target.itemId:entry.delta.target.operation!=='create'&&entry.delta.target.itemId===target.itemId))continue
        const extra=await stageGrowth([{target:{operation:'amend',itemId:target.itemId,expectedRevision:target.expectedRevision,beforeQuote:target.beforeQuote},kind:'context',assertion:'user_reported',source:{messageId:run.source_message_id,quote:target.quote}}],{})
        const offset=staged.growth?.changes.length??0
        staged.growth={changes:[...(staged.growth?.changes??[]),...extra.changes],prepared:[...prepared,...extra.prepared.map(entry=>entry.kind==='split_amend'?{...entry,normalizedIndex:entry.normalizedIndex+offset}:entry)],inputIndexBindings:new Map(staged.growth?.inputIndexBindings??[]),skipped:[...(staged.growth?.skipped??[]),...(extra.skipped??[])]}
        staged.audit.push({phase:'source_bound_growth_response_continuation',itemId:target.itemId,actor:target.actor,providerCalls:0})
      }
    }
    // NP_NEG_01 / BS_RESOURCE_01: optional model deltas omitted explicit status.
    // Retain only the speaker's guarded verbatim status, never an experience,
    // inferred cause, goal or completion. Corrections and controls keep authority.
    const contributionFacts=scanUserClauses(current.content).filter(clause=>!clause.interrogative&&!clause.conditional&&!clause.quoted&&!clause.code&&(reportsOwnContribution(clause.text)||(/^(?:补充(?:作品|项目)分工[:：])?.{1,20}(?:由|是)(?:同伴|同学|队友).{0,12}(?:完成|负责|画的)$/.test(clause.text)&&clauseCatalogue.some(own=>!own.conditional&&!own.interrogative&&!own.attributedToOther&&reportsOwnContribution(own.text)))))
    const explicitTaskFacts=[...contributionFacts,...reportedTaskBoundaryClauses(current.content),...negativePersonalFactClauses(current.content),...reportedAdoptionClauses(current.content),...requestedQuestionEditClauses(current.content),...resourceBlockedPersonalFactClauses(current.content),...reportedTaskOutcomeClauses(current.content,growthAll.some(item=>item.assertion==='user_reported'&&item.kind==='feedback'&&item.progressState==='completed'),true),...reportedPerformedTaskClauses(current.content),...reportedCompletedContactClauses(current.content),...scanUserClauses(current.content).filter(c=>!c.conditional&&!c.quoted&&!c.code&&!c.attributedToOther&&((!c.interrogative&&!c.quoteSpans.length&&(/^(?:但)?(?:遇到|卡在|停在).{0,30}(?:卡住|受阻|做不下去)/.test(c.text)||/^不再问(?:愿不愿意|是否愿意|想不想)/.test(c.text)))||(!c.interrogative&&!c.quoteSpans.length&&(/^(?:这次|刚才那次).{0,12}(?:访谈|行动|任务)我(?:暂时|先)不继续/.test(c.text)||/^(?:实际效果|使用结果|付款结果).{0,12}(?:我不知道|仍未知|不清楚)/.test(c.text))))) ]
    const referenceContext=contract.capabilities.growth?[...reportedSourceContextClauses(current.content,[...explicitTaskFacts.map(fact=>fact.text),...(staged.growth?.changes??[]).filter(delta=>delta.assertion==='user_reported').map(delta=>delta.source.quote),...(staged.serverGoals??[]).map(goal=>goal.quote)],controlClauseTexts),...reportedExternalExpectationClauses(current.content)]:[]
    const taskFactSupplement=snapshot.settings.enabled&&!readOnlyQuestion&&!decisionComparison?[...new Map([...explicitTaskFacts,...referenceContext].map(clause=>[clause.text,clause])).values()].filter(clause=>
      !assistantRequestClause(clause.text)&&
      !(correctionPlan?.target?.field==='education.major'&&clause.text.includes(correctionPlan.newQuote)&&/更正|说错|搞错|记错|写错/.test(clause.text))&&
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
      }else if(!amendedNow&&!groundedInferenceDenial&&claimDishonest&&correctionClaim)throw new HttpError(400,'REPLY_CLAIMS_UNCOMMITTED_CORRECTION')

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
      if(!result.event.nodes?.length&&!result.event.corrections?.length&&!result.event.resolveUnknowns?.length&&!result.event.declineUnknowns?.length&&!result.event.matterReports?.length)delete result.event
    }
    if(result.event){
      // A fact rejected by the canonical memory authority cannot survive in
      // an event projection. Unknown ownership is likewise kept only in the
      // canonical interpretation, never flattened into an ordinary fact node.
      const eventFactAccepted=(index:number)=>acceptedFactInputs.has(index)&&reportedContribution(result.growthUpdates![index]!)?.actor!=='unknown'
      result.event.nodes=result.event.nodes?.filter(node=>decisionComparison||!contract.capabilities.growth||node.kind!=='fact'||!processSourceClauseId(node)||(processFactInputIndices(node)??[]).some(eventFactAccepted))
      result.event.nodes=result.event.nodes?.map(node=>{
        if(node.kind!=='fact')return node
        const input=(processFactInputIndices(node)??[]).find(eventFactAccepted),normalized=input===undefined?undefined:acceptedFactInputs.get(input)
        const fact=normalized===undefined?undefined:staged.growth?.changes[normalized]
        return fact?.assertion==='user_reported'?{...node,source:fact.source}:node
      })
      // Only identities actually supplied in this user's authorized snapshot
      // may be continued. Database/permission failures remain non-repairable.
      const target=result.event.target
      if(target.operation==='continue'&&!staged.usedEventRefs?.some(ref=>ref.eventId===target.eventId))throw new HttpError(400,'COACH_EVENT_TARGET_INVALID')
      if(result.event){
      try{
        const growthCoachFacts=(staged.growth?.changes??[]).flatMap(change=>change.assertion==='user_reported'?[{content:change.text,source:change.source}]:[])
        const memoryCoachFacts=(staged.memoryChanges??[]).flatMap(change=>{
          const evidence=change.evidence,range=evidence.range
          if(change.kind!=='fact'||change.status!=='active'||change.value===null||evidence.messageId!==run.source_message_id)return []
          const clause=range?clauseCatalogue.find(item=>item.start<=range.start&&item.end>=range.end):clauseCatalogue.find(item=>item.text.includes(evidence.quote))
          // Preserve the user's canonical field wording (for example 专业),
          // not only its value. Related questions can bind to this exact
          // source without a second key-label translation layer.
          return clause?[{content:clause.text,source:clauseMessageSource(run.source_message_id,clause,evidence.quote)}]:[]
        })
        const coachFacts=[...growthCoachFacts,...memoryCoachFacts]
        staged.coach=await stageCoachEvent(run,result.event,result.reply,coachFacts);staged.coach.knowledgeRefs=staged.usedKnowledgeRefs
        const unsupportedReports=(result.event.matterReports?.length??0)-(staged.coach.delta.matterReports?.length??0)
        if(unsupportedReports)staged.audit.push({phase:'unsupported_matter_reports_omitted',count:unsupportedReports,providerCalls:0})
        if(switchedMatter?.focus&&conversationEventId&&currentEvent?.id===conversationEventId&&staged.coach.delta.target.operation==='create'&&staged.coach.delta.target.title===switchedMatter.title){
          staged.coach.keepCurrentEventId=conversationEventId
        }
      }catch(error){
        // The event workspace is optional; a model-supplied request/conditional
        // source must never be persisted. If it carries no material/action,
        // drop the event instead of discarding an otherwise valid answer.
        if(error instanceof HttpError&&error.code==='COACH_SOURCE_INVALID'&&!result.event.action){
          staged.audit.push({phase:'coach_event_source_dropped',providerCalls:0})
          result.event=undefined
        }else throw error
      }
    }
    }
    const refusalEvent=refusalOnly&&!retrieval.ambiguous&&historicalEvents.length===1&&matchingGuideEvent?.id===historicalEvents[0].id?matchingGuideEvent:null
    const usageEventId=staged.coach?.eventId??currentEvent?.id??refusalEvent?.id??(needsKnowledge?matchingGuideEvent?.id:undefined)
    staged.guideUsage=[]
    if(usageEventId){
      const feedback=classifyGuideFeedback(current.content),previous=previousGuideUsage[0]
      const feedbackSource=feedback&&previous&&currentEvent?guideFeedbackSource(current.content,feedback,{title:currentEvent.title,task:previous.branch_task??''}):null
      // A different named current task never changes the old task's usage.
      if(feedback&&feedbackSource&&previous&&currentEvent&&canContinueGuideFeedback(previous.status,feedback)&&feedbackMatchesCurrent(current.content,currentEvent.title,previous.branch_task??'')&&usageEventId===currentEvent.id)staged.guideUsage.push({guideId:previous.guide_id,revision:previous.revision,branch:previous.branch,stepId:previous.step_id,status:feedback,eventId:usageEventId,sourceMessageId:run.source_message_id,sourceQuote:feedbackSource.quote,sourceRange:feedbackSource.range})
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
    // A contribution annotation alone is not an experience commit. Only a
    // contribution that survives canonical growth authority and is actually
    // staged may supersede the provider's source-bound candidate. Context-only
    // facts such as contact channel/recipient must not erase the experience.
    const semanticCandidateClauseIds=new Set<string>()
    const rejectedActionRanges:{start:number;end:number}[]=[]
    if(!readOnlyQuestion&&!instructionOnlySummary&&snapshot.settings.enabled&&!personalWritesBlocked){
      for(const [inputIndex,fact] of (result.growthUpdates??[]).entries()){
        const contribution=reportedContribution(fact)
        if(!contribution)continue
        if(contribution.rejectedActionRanges)rejectedActionRanges.push(...contribution.rejectedActionRanges)
        const resolvedIndex=acceptedFactResolvedInputs.get(inputIndex)
        if(resolvedIndex!==undefined){
          staged.factInterpretations??=[]
          const resultIndex=contribution.result?acceptedFactResolvedInputs.get(contribution.result.inputIndex):undefined
          staged.factInterpretations.push({inputIndex:resolvedIndex,actor:contribution.actor,...(contribution.proposedActor?{proposedActor:contribution.proposedActor}:{}),actionQuote:contribution.pendingActionQuote??contribution.actionQuote,...(resultIndex!==undefined?{resultInputIndex:resultIndex}:{})})
        }
        const candidateAction=contribution.pendingActionQuote??contribution.actionQuote
        if(!acceptedFactInputs.has(inputIndex)||!(['self','joint'].includes(contribution.actor)||contribution.actor==='unknown'&&contribution.pendingActionQuote)||!candidateAction)continue
        const normalizedIndex=acceptedFactInputs.get(inputIndex)??-1
        const accepted=staged.growth?.changes[normalizedIndex]
        if(normalizedIndex<0||accepted?.kind!=='feedback'||!['completed','attempted','stuck'].includes(accepted.progressState))continue
        const resultNormalizedIndex=contribution.result?acceptedFactInputs.get(contribution.result.inputIndex):undefined
        if(contribution.result&&resultNormalizedIndex===undefined)staged.audit.push({phase:'optional_contribution_result_not_accepted',inputIndex,providerCalls:0})
        const quote=contribution.sourceQuote,content={action:candidateAction,result:resultNormalizedIndex!==undefined?contribution.result?.quote??'':'',occurredAt:resolveOccurredDate(contribution.factQuote,new Date(current.created_at).toISOString(),'Asia/Shanghai')??''}
        await stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote,content,links:[]},signal,{fact,normalizedIndex,resultNormalizedIndex})
        semanticCandidateClauseIds.add(contribution.sourceClauseId)
      }
    }
    if(semanticCandidateClauseIds.size)delete result.experienceCandidate
    const actionSourceRejected=(span:{quote:string;start:number;end:number},action:string)=>rejectedActionRanges.length>0&&sourceQuoteRanges(current.content,action,{quote:span.quote,range:{start:span.start,end:span.end}}).some(range=>rejectedActionRanges.some(rejected=>range.start<rejected.end&&rejected.start<range.end))
    // Native semantic facts own the entire turn. Legacy model candidates and
    // lexical inference remain a compatibility path, never a second opinion.
    if(!semanticCandidateClauseIds.size){
    // A pure direction declaration is not a completed experience.
    if(result.experienceCandidate&&!experienceCandidateRequired){
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
        const structural=selectStructuralCandidates(current.content,clauseCatalogue,anchorIso).find(candidate=>candidate.start<=selection.start&&selection.start<candidate.end)??selectStructuralCandidate(current.content,clauseCatalogue,anchorIso)
        const coveredByStructural=structural&&structural.start<=selection.start&&selection.end<=structural.end
        // 退化短选段（如只选了「对了」两个字）不足以代表经历：结构句更长时
        // 采用整句，同一套服务器选段规则。
        const degenerate=selection.quote.trim().length<6
        const includesCommand=clauseCatalogue.some(handle=>handle.start>=selection.start&&handle.end<=selection.end&&!handle.quoted&&!handle.code&&(assistantRequestClause(handle.text)||conversationPreferenceClause(handle.text)||refusalPreferenceClause(handle.text)))
        const span=structural&&(includesCommand||coveredByStructural||(degenerate&&structural.quote.length>selection.quote.length))?structural:{quote:selection.quote,start:selection.start,end:selection.end}
        const extracted=resolveCandidateContent(clauseCatalogue,span,result.experienceCandidate,anchorIso)
        if(span===structural){
          if(!clauseReportsCompleted(extracted.content.action)||structural!.content.action.includes(extracted.content.action))extracted.content.action=structural!.content.action
          // 结果若是回指词本身（模型把“上次那个…访谈”当成了结果），换用
          // 结构句挑出的真实结果分句。
          if(!extracted.content.result||structural!.content.result.includes(extracted.content.result)||/上次那|上次说|那件事|刚才说/.test(extracted.content.result))extracted.content.result=structural!.content.result
        }
        for(const field of extracted.dropped)staged.audit.push({phase:'coach_candidate_field_dropped',code:'CANDIDATE_FIELD_CLAUSE_UNRESOLVED',field,committed:false})
        if(actionSourceRejected(span,extracted.content.action)){
          delete result.experienceCandidate
          staged.audit.push({phase:'coach_optional_candidate_rejected',code:'ACTION_SOURCE_ALREADY_REJECTED',committed:false})
        }else try{
          await stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote:span.quote,links:deriveStructuralLinks(extracted.content.action,extracted.content.result),content:extracted.content},signal)
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
    if(!readOnlyQuestion&&!instructionOnlySummary&&!slimUpdateTimeMode&&experienceCandidateRequired){
      // Constrained decoding only guides, it does not force: flash-tier models
      // keep omitting the optional lane even when the schema requires it. A
      // structurally unambiguous completed first-person action report still
      // becomes a candidate here — same server-owned verbatim quote, same
      // guards, same user-confirmation lifecycle as the model-selected path.
      for(const structural of selectStructuralCandidates(current.content,clauseCatalogue,new Date(current.created_at).toISOString())){
        if(actionSourceRejected(structural,structural.content.action))continue
        if(staged.candidates.some(candidate=>candidate.quote.includes(structural.quote)))continue
        try{
          await stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote:structural.quote,links:deriveStructuralLinks(structural.content.action,structural.content.result),content:structural.content},signal)
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
    }
    if(current.content.includes('更新到已有的')&&snapshot.settings.enabled&&!readOnlyQuestion&&!currentConversationOnly(current.content)&&!detectForgetIntentClauses(current.content).length&&!staged.memoryControl&&!staged.pendingMemoryControl){
      const episodes=(await pool.query("SELECT id,source_quote,content FROM experiences WHERE user_id=$1 AND status='confirmed'",[run.user_id])).rows
      const supplement=planExplicitExperienceSupplement(current.content,episodes)
      if(supplement){
        // The user's destination wins over optional candidate extraction. The
        // same transaction records the exact quote and advances this record;
        // it must not create a duplicate or credit delegated work to the user.
        staged.candidates=[]
        staged.backReferenceMerge=supplement
        staged.audit.push({phase:'coach_candidate_structural',code:'EXPLICIT_EXISTING_SUPPLEMENT_STAGED',experienceId:supplement.experienceId,providerCalls:0,committed:false})
      }
    }
    if(!readOnlyQuestion&&!instructionOnlySummary&&!semanticCandidateClauseIds.size&&!staged.candidates.length&&!staged.backReferenceMerge){
      // 反述直连：模型把追述写进 feedback 通道时，事件身份仍由服务器判定——
      // 原始消息里有明确指代且命中既有经历（同一套区别性词元+时间守卫），
      // 就 staged 一条合并指令，由 finishRun 在事务里落盘。
      const rawStructural=selectStructuralCandidate(current.content,clauseCatalogue,new Date(current.created_at).toISOString())
      if(rawStructural&&!actionSourceRejected(rawStructural,rawStructural.content.action)){
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
    if(statusReadbackReply&&result.reply!==statusReadbackReply){
      result.reply=statusReadbackReply
      staged.audit.push({phase:'source_status_readback_preserved_after_rendering',providerCalls:0})
    }
    if(!boundedReplyAccepts(result.reply,boundedReply)){
      throw new HttpError(502,'BOUNDED_REPLY_INVALID')
    }
    try{verifyReplyAgainstObligations(obligations,result.reply)}catch(error){if(isObligationError(error))throw new HttpError(400,error.code);throw error}
    if(contract.requiredReplyKind==='comparison'&&!comparisonReplyAccepts(result.reply,current.content)){
      // The validated parser may have normalized a wrapper while the provider's
      // complete JSON reply still carries both explicitly labelled options.
      // Use that exact raw reply only when the comparison validator accepts it.
      try{const rawReply=(JSON.parse(raw) as any)?.reply;if(typeof rawReply==='string'&&comparisonReplyAccepts(rawReply,current.content)){result.reply=rawReply;staged.audit.push({phase:'comparison_reply_restored_from_raw',providerCalls:0})}}catch{}
      if(!comparisonReplyAccepts(result.reply,current.content)){if(process.env.LIFEOS_DEBUG_COMPARISON)appendFileSync('.local/comparison-debug.txt',JSON.stringify({reply:result.reply,raw,current:current.content})+'\n');throw new HttpError(502,'REPLY_COMPARISON_MISSING')}
    }
    if(unsupportedPreferenceConstraintClaims(result.reply,promptContext.currentTask.responseScope.reportedEvidence.preferences,current.id,current.content).length)throw new HttpError(502,'REPLY_PREFERENCE_HARDENED')
    if(singleQuestionReply&&!requestedScope.comparisonRequested&&!contract.requiredReplyKind&&(grillingMode==='ordinary'||grillingMode==='explore')&&!/^[^？?]*[？?]\s*$/.test(result.reply))throw new HttpError(502,'REPLY_SINGLE_QUESTION_INVALID')
    if(contract.requiredReplyKind==='summary'&&!summaryReplyAccepts(result.reply))throw new HttpError(502,'REPLY_SUMMARY_MISSING')
    if(requestedScope.sentenceLimit===1&&!boundedReply&&!materialIntent&&!planIntent&&!isSingleSentenceReply(result.reply))throw new HttpError(502,'REPLY_SENTENCE_LIMIT')
    if(contract.requiredReplyKind==='comparison'&&!comparisonUniverseAccepts(result.reply,current.content))throw new HttpError(502,'REPLY_COMPARISON_UNBOUNDED')
    if(!requestedActionLimitAccepts(result.reply,current.content))throw new HttpError(502,'REPLY_ACTION_LIMIT')
    if(!completeReply(result.reply))throw new HttpError(502,'REPLY_INCOMPLETE_OR_INTERNAL')
    const replyEventId=result.event?(result.event.target.operation==='continue'?result.event.target.eventId:null):newMatterExplicit?null:currentEvent?.id
    if(unsupportedParticipantReadingClaims(result.reply,promptContext.currentTask.responseScope.reportedEvidence.participants,{currentMessageId:current.id,eventId:replyEventId}).length)throw new HttpError(502,'REPLY_STATE_NOT_SUPPORTED')
    if(personalWritesBlocked){
      delete staged.growth;delete staged.serverGoals;delete staged.serverBudgets;delete staged.memoryChanges
      delete staged.backReferenceMerge;delete staged.weeklyPlan;delete staged.coach;staged.candidates=[]
    }
    if(decisionComparison){staged.guideUsage=staged.guideUsage?.filter(usage=>actualComparisonClauses.some(c=>usage.sourceQuote===c.text));delete staged.workflowAdoption}
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
  if(contract.capabilities.material&&!boundaryNeedsClarification&&!viewOnlyDrafts.length){
    const worksheet=requestedBlankJobWorksheet(current.content)
    const draft=worksheet
    if(draft){
      const previous=currentEvent?.actions.find(action=>action.status==='proposed')
      explicitMaterial={reply:'按你提供的内容，整理如下：',event:{target:currentEvent?{operation:'continue',eventId:currentEvent.id,expectedRevision:currentEvent.revision}:{operation:'create',title:'岗位核对表',source:{messageId:run.source_message_id,quote:current.content}},action:previous?{operation:'modify',actionId:previous.id,expectedRevision:previous.revision,draft}:{operation:'create',draft}}}
      staged.audit.push({phase:'explicit_material_rendered_without_generation',basis:'explicit_blank_job_worksheet',providerCalls:0})
    }
  }
  if(!materialPersistenceRefused&&!explicitMaterial&&resumePortfolioMode&&(contributionSentenceMode||contributionParagraphMode)&&!hasSeparateQuestion&&!planIntent&&!boundaryNeedsClarification&&!viewOnlyDrafts.length){
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
  // A pure state readback or fully sourced switch needs no generation.
  // The switch receipt describes only facts staged by this same transaction.
  const switchStep=switchedMatter?.scope.choiceQuote?.replace(/^(?:我|本人)(?:接受|同意)/,'')
  const switchReceipt=switchContract&&switchedMatter
    ?'「'+switchedMatter.title+'」按你的决定暂停。'+(switchStep?'你已接受「'+switchStep+'」，这一步还没执行。':'你已接受的步骤还没执行。')+(switchedMatter.focus?'当前重点仍是「'+switchedMatter.focus+'」。':'')
    :null
  const exactFeedback=!currentEvent&&!materialIntent&&!planIntent&&!turnNeedsControlReceipt&&!boundedReply&&!explicitMaterial&&!refusalOnly&&!viewOnlyDrafts.length?exactFeedbackReadback(current.content):null
  const sourceStatusCandidate=!currentEvent&&!materialIntent&&!planIntent&&!turnNeedsControlReceipt&&!boundedReply&&!explicitMaterial&&!refusalOnly&&!viewOnlyDrafts.length?currentParticipantStatusReadback(current.content):null
  const sourceStatusReadback=switchReceipt??exactFeedback??(sourceStatusCandidate&&sourceStatusCandidate.length<=((contract.schema.properties as any).reply?.maxLength??16000)?sourceStatusCandidate:null)
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
  const provisionalCorrection=!sourceStatusReadback&&!deterministicStateReadback&&!verifiedStatePreview&&!provisionalState&&!requestedScope.actionRequested&&!explicitMaterial&&!refusalOnly?provisionalCorrectionPreview(current.content):null
  if(provisionalCorrection){
    emit({type:'draft',text:provisionalCorrection,saved:false,draftKind:'safe_sentence',verifiedState:true})
    staged.audit.push({phase:'verified_correction_preview',providerCalls:0})
  }
  const provisionalQuestion=!sourceStatusReadback&&!deterministicStateReadback&&!verifiedStatePreview&&!provisionalState&&!provisionalCorrection&&!explicitMaterial&&!refusalOnly?sourceDefinition:null
  if(provisionalQuestion){
    emit({type:'draft',text:provisionalQuestion,saved:false,draftKind:'safe_question'})
    staged.audit.push({phase:'verified_provisional_question_preview',providerCalls:0,basis:'explicit_requested_clarifying_question'})
  }
  // A requested one-sentence pause summary may quote a prior observation,
  // but must never acknowledge the new pause before the atomic commit.
  // Require every factual clause to remain in the authorized growth snapshot;
  // raw conversation history alone is not permission to reuse withdrawn facts.
  let priorObservationPreview:string|null=null
  if(turnNeedsControlReceipt&&requestedScope.summaryRequested&&requestedScope.sentenceLimit===1&&!requestedScope.actionRequested&&!materialIntent&&!planIntent&&!detectForgetIntentClauses(current.content).some(c=>c.kind==='forget'||c.kind==='pause_use')){
    const previous=[...allContextMessages].reverse().find(message=>message.role==='user'&&message.id!==current.id)
    if(previous){
      const quotes=growthAll.filter(item=>item.status==='active'&&!item.unavailableReason&&!item.taskBoundary&&!item.inferenceBoundary).flatMap(item=>item.sources.filter(source=>source.type==='message'&&source.id===previous.id).map(source=>source.quote))
      const factual=scanUserClauses(previous.content).filter(clause=>!assistantRequestClause(clause.text))
      if(factual.length&&factual.every(clause=>quotes.some(quote=>quote.includes(clause.text))))priorObservationPreview=boundedTimedObservationPreview(previous.content)
    }
  }
  const verifiedFeedbackPreview=!sourceStatusReadback&&!verifiedStatePreview&&!provisionalState&&!provisionalQuestion&&!explicitMaterial&&!refusalOnly?(groundedFeedbackPreview(current.content)??priorObservationPreview):null
  if(verifiedFeedbackPreview){
    emit({type:'draft',text:verifiedFeedbackPreview,saved:false,draftKind:'safe_sentence',verifiedFeedback:true})
    staged.audit.push({phase:'verified_feedback_preview',providerCalls:0,basis:priorObservationPreview?'authorized_prior_observation_without_control_receipt':'current_source'})
  }
  let provisionalModelText:string|null=null
  const modelDraft=(text:string,draftKind:'safe_question'|'safe_sentence'|'stream_reply')=>{
    // Semantic dependence cannot be proven from lexical overlap. If this turn
    // changes a stored fact, every model-authored draft waits for the same
    // atomic commit; otherwise advice derived from the new value could escape
    // over SSE even when a concurrent revision makes the write fail.
    if(correctionReplyMustWait||progressTiming||directOrdinary&&(ordinaryPrivateRecord.test(text)||ordinaryWriteReceipt.test(text)))return false
    if(proposalCases.length&&decisionReplyInternalFieldsVisible(text,proposalCases.map(c=>c.title)))return false
    if(surfaceDirectionScopes(text).some(scope=>blockedDirectionScopes.includes(scope)))return false
    if(turnNeedsControlReceipt){
      // A positively sourced, open definition question makes no write receipt
      // or recommendation. All statements and other control drafts still wait.
      if(draftKind!=='safe_question'||!requestsOneQuestionReply(current.content)||!ownedOpenDefinitionQuestion(text,current.content))return false
    }
    // A judgment-only update may not have a server correction plan, so retain
    // the conservative receipt guard for that separate path.
    if(requestedScope.judgmentUpdate&&/(?:^|[。！？；\n])[^。！？；\n]{0,12}(?:已|已经)(?:按[^。！？；\n]{0,20})?(?:更正|更新|修改|改为|改成)|(?:已|已经)把[^。！？；\n]{0,40}(?:改为|改成|更正为|更新为)/.test(text))return false
    if(violatesLabelInferenceBoundary(text,inferenceBoundaries,current.content))return false
    // Apply the same source-bound checks before exposing a provisional chunk.
    // A final repair cannot undo an unsupported choice or quantity already seen.
    if(openUnreportedChoiceQuestion(text,current.content)||enforceReportedQuantity(text,current.content))return false
    if(unsupportedPreferenceConstraintClaims(text,promptContext.currentTask.responseScope.reportedEvidence.preferences,current.id,current.content).length)return false
    if(provisionalModelText===text)return true
    provisionalModelText=text;emit({type:'draft',text,saved:false,draftKind});return true
  }
  try{
    if(!explicitMaterial&&!refusalOnly&&!deterministicStateReadback){await checkModelCooldown();emit({type:'progress',stage:'generating'})}
    if(refusalOnly)staged.audit.push({phase:'explicit_refusal_deterministic',providerCalls:0})
    if(deterministicStateReadback)staged.audit.push({phase:'explicit_state_readback_without_generation',providerCalls:0,basis:'authorized_user_reports_only'})
    const planSchema=(contract.schema as any).properties?.weeklyPlan
    const planDraftExpectation:WeeklyPlanDraftExpectation|null=planBudget?.type==='weekly_plan'&&planBudget.minutes>0?{period:planBudget.period,availableMinutes:planBudget.minutes,allowedActions:planSchema?.properties?.items?.items?.properties?.action?.enum,mustLeaveSlack:requiresPlanSlack(current.content)}:null
    const existingPreview=verifiedStatePreview||provisionalState||provisionalCorrection||verifiedFeedbackPreview||provisionalQuestion
    firstText=explicitMaterial?JSON.stringify(explicitMaterial):refusalOnly?JSON.stringify({reply:'好的，先不继续建议或安排这件事。'}):deterministicStateReadback?JSON.stringify({reply:deterministicStateReadback}):await runModelCall(runtime,systemPrompt,userPrompt,0,run.request_id,contextTokenEstimate,contextTokenEstimate,retrieved,route.escalated,route.reason,calls,signal,staged,providerSignal=>acquireProviderDispatchFence(run,staged,providerSignal),capabilityVerified,'turn',contract.schema as never,'lifeos_action_coach','turn',existingPreview?undefined:modelDraft,observer,run.user_id,resumePortfolioMode?materialCatalogue.map(fact=>fact.catalogueId):undefined,slimUpdateTimeMode,modelClauseCatalogue.map(handle=>handle.clauseId),questionFirstMaterial?'material_question':singleQuestionReply&&turnNeedsControlReceipt?'none':planDraftExpectation?'weekly_plan':'safe_sentence',contract.capabilities.candidate&&experienceCandidateRequired ,boundedReply,planDraftExpectation,undefined,ordinaryProgressiveReply&&!viewOnlyDrafts.length,directOrdinary&&!contract.requiredReplyKind)
    emit({type:'progress',stage:'validating'})
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
  if(!result.reply.trim())throw new HttpError(502,'REPLY_INCOMPLETE_OR_INTERNAL')
  // Final display boundaries must commit the same reply that the user sees.
  if(staged.coach)staged.coach.reply=result.reply
  const usage=usageSummary(calls,contextTokenEstimate,retrieved,route.escalated,route.reason,refusalOnly||Boolean(explicitMaterial)||Boolean(deterministicStateReadback))
  staged.modelUsage=usage
  staged.memoryReferences=calls.length?collectReplyMemoryReferences(userPrompt):[]
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



















