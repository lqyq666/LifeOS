import type {CoachEvent} from '../action-coach-events.ts'
import {classifyGuideFeedback,feedbackMatchesCurrent,readGuideUsage,suggestedGuideUsage as importedSuggestion,type GuideUsage} from '../guide-usage.ts'
import type {Run,Staged} from '../store.ts'
import {readActionEnvelope} from './adapters.ts'
import {createActionWorkflow} from './action-workflow.ts'
import {advancedWorkflowsEnabled} from './router.ts'
import type {WorkflowRequest} from './contracts.ts'
import {applyGuide} from './guide-application.ts'
import type {KnowledgeCard} from '../campus-knowledge.ts'
import {postgresJournal} from './task-journal.ts'

// Used after the native citation selector has selected a host-read full card.
// Snapshot authorization is rechecked by finishRun before this candidate is saved.
export function authorizedGuideApplication(run:Run,staged:Staged,card:KnowledgeCard,eventId:string,branchId?:string,replyOnly=false){
 if(replyOnly&&advancedWorkflowsEnabled())return null
 const suggestion=importedSuggestion(card,eventId,branchId)
 if(!advancedWorkflowsEnabled()||!suggestion)return suggestion
 const guide=card.guide!,branch=guide.branches.find(x=>x.id===suggestion.branch)!,step=branch.steps.find(x=>x.id===suggestion.stepId)!,ref={type:'knowledge' as const,id:card.id,revision:card.revision}
 const r:WorkflowRequest={schemaVersion:2,traceId:run.request_id,requestId:run.request_id,mode:'action_review',internalActorKey:run.user_id,conversationId:run.conversation_id,eventId,currentIntent:'将已授权的公共方法用于当前任务',authorizedEvidenceRefs:[ref],consent:{continueReview:false,deepAnalysis:false},controls:{memoryEnabled:false,listeningOnly:false,refuseAdvice:false,memoryControl:false,recommendationsPaused:false,forbiddenDirections:[]},budget:null,modelBudget:{maxProviderCalls:0,maxCostCny:0,deadlineMs:1000},directions:[],synthetic:false}
 const applied=applyGuide(r,{guideId:card.id,revision:card.revision,sourceHash:card.sourceHash,reviewStatus:guide.reviewStatus==='approved'?'approved':'needs_review',current:card.status==='verified',branch:branch.id,stepId:step.id,description:step.text,minutes:5,stopCondition:guide.stopConditions.join('；'),support:'lifeos_adaptation'},[{ref,owner:null,conversationId:null,role:'public',status:'active',approved:guide.reviewStatus==='approved',text:guide.referenceBody}],row=>staged.audit.push({phase:'workflow_trace',...row}))
 return {...suggestion,...applied.guideUsageCandidate,eventId}
}

// Sole integration point. Off/default and ordinary turns return before any extra host reads.
export async function actionReviewHints(input:{run:Run;staged:Staged;text:string;memoryEnabled:boolean;currentEvent:CoachEvent|null;historicalEvents:CoachEvent[];ambiguous:boolean;listeningOnly:boolean;signal:AbortSignal}){
 if(!advancedWorkflowsEnabled()||input.listeningOnly||input.ambiguous)return null
 const feedback=classifyGuideFeedback(input.text)
 if(!feedback||feedback==='declined')return null // Refusal stays in the existing fast/control path.
 const events=input.currentEvent?[input.currentEvent]:input.historicalEvents
 if(events.length!==1)return null
 const event=events[0]
 if(!feedbackMatchesCurrent(input.text,event.title,event.title))return null
 const current={type:'message' as const,id:input.run.source_message_id,revision:1,quote:input.text}
 const request:WorkflowRequest={schemaVersion:2,traceId:input.run.request_id,requestId:input.run.request_id,mode:'action_review',internalActorKey:input.run.user_id,conversationId:input.run.conversation_id,eventId:event.id,authorizedEvidenceRefs:[{type:'event',id:event.id,revision:event.revision},current],currentIntent:input.text,consent:{continueReview:true,deepAnalysis:false},controls:{memoryEnabled:input.memoryEnabled,listeningOnly:false,refuseAdvice:false,memoryControl:false,recommendationsPaused:false,forbiddenDirections:[]},budget:null,modelBudget:{maxProviderCalls:0,maxCostCny:0,deadlineMs:250},directions:[],synthetic:false}
 try{
  const started=performance.now()
  const wf=createActionWorkflow(async r=>(await readActionEnvelope(r)).records,row=>input.staged.audit.push({phase:'workflow_trace',...row}),postgresJournal())
  // All reads, including initial envelope resolution, are under the bounded workflow deadline.
  const envelopePromise=readActionEnvelope(request)
  let timer:ReturnType<typeof setTimeout>|undefined
  const envelope=await Promise.race([envelopePromise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('unavailable')),request.modelBudget.deadlineMs)})]).finally(()=>{if(timer)clearTimeout(timer)})
  const remaining=Math.floor(request.modelBudget.deadlineMs-(performance.now()-started))
  if(remaining<=0)throw new Error('unavailable')
  const {receipt,review}=await wf.run(request,[envelope.actionCase],current,input.signal)
  if(receipt.status!=='proposed'||!review){input.staged.audit.push({phase:'workflow_fallback',mode:'action_review',status:'unavailable',providerCalls:0});return null}
  // Facts and state writes still use the model's native event clause handles and finishRun.
  return {schemaVersion:2,status:'proposed',eventId:event.id,eventRevision:event.revision,feedbackCandidate:review.feedback,stages:review.stages,knownResultBoundary:review.reply,nextActionCandidates:review.proposal.nextActions,rule:'Candidate guidance only. No state change has been persisted. Use exact authorized current clause handles; preserve refusal and unknown causes.'}
 }catch{input.staged.audit.push({phase:'workflow_fallback',mode:'action_review',status:'unavailable',providerCalls:0});return null}
}

// Called only AFTER the native event continue target has passed host authorization.
// A model-selected arbitrary historical ID is insufficient: there must be one
// unambiguous retrieved event and no competing current event.
export async function continuedActionUsage(input:{run:Run;text:string;event:CoachEvent;ambiguous:boolean}):Promise<GuideUsage|null>{
 if(!advancedWorkflowsEnabled()||input.ambiguous)return null
 const feedback=classifyGuideFeedback(input.text)
 if(!feedback)return null
 const previous=(await readGuideUsage(input.run.user_id,input.run.conversation_id,input.event.id))[0]
 if(!previous||!canContinueGuideFeedback(previous.status,feedback)||!feedbackMatchesCurrent(input.text,input.event.title,previous.branch_task??''))return null
 return {guideId:previous.guide_id,revision:previous.revision,branch:previous.branch,stepId:previous.step_id,status:feedback,eventId:input.event.id,sourceMessageId:input.run.source_message_id,sourceQuote:input.text}
}
export function canContinueGuideFeedback(previous:GuideUsage['status'],next:GuideUsage['status']){
 return !advancedWorkflowsEnabled()||previous!=='declined'||next==='accepted'
}
