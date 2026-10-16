import {randomUUID} from 'node:crypto'
import type {WorkflowRequest,EvidenceRecord,AgentResult,WorkflowProposal} from '../../server/workflows/contracts.ts'
import {emptyProposal} from '../../server/workflows/contracts.ts'
import type {DecisionAdapter} from '../../server/workflows/direction-decision.ts'
export function fixture():{request:WorkflowRequest;records:EvidenceRecord[]}{
 const conversationId=randomUUID(),eventId=randomUUID(),actor='synthetic-adult-'+randomUUID()
 const event={type:'event' as const,id:eventId,revision:1},message={type:'message' as const,id:randomUUID(),revision:1,quote:'我大三，每周有6小时，想深入比较就业、考研和独立开发。'}
 const request:WorkflowRequest={schemaVersion:2,traceId:randomUUID(),requestId:randomUUID(),mode:'direction_decision',internalActorKey:actor,conversationId,eventId,authorizedEvidenceRefs:[event,message],currentIntent:message.quote,consent:{continueReview:false,deepAnalysis:true},controls:{memoryEnabled:true,listeningOnly:false,refuseAdvice:false,memoryControl:false,recommendationsPaused:false,forbiddenDirections:[]},budget:{period:'this_week',amountMinutes:360,source:message},modelBudget:{maxProviderCalls:5,maxCostCny:0.1,deadlineMs:5000},directions:[{id:'employment',title:'就业'},{id:'postgraduate_exam',title:'考研'},{id:'independent_development',title:'独立开发'}],synthetic:true}
 const records:EvidenceRecord[]=request.authorizedEvidenceRefs.map(ref=>({ref,owner:actor,conversationId,status:'active',role:'user',text:ref.quote??'联系学长',eventId,...(ref.type==='message'?{budget:{period:'this_week' as const,amountMinutes:360}}:{})}))
 return {request,records}
}
export function proposal(request:WorkflowRequest,directions=request.directions):WorkflowProposal{
 const p=emptyProposal(request);p.evidenceRefs=request.authorizedEvidenceRefs
 p.alternatives=directions.map(path=>({directionId:path.id,title:path.title,pros:['可利用已提供的本人基础'],tradeoffs:['需要放弃其他高强度投入'],unknowns:['真实需求或升学动机尚待核实'],weeklyMinutes:120,evidenceRefs:request.authorizedEvidenceRefs}))
 p.nextActions=[{description:'用30分钟核实一项最影响取舍的信息，然后再决定当前重点。',estimatedMinutes:30,stopCondition:'到30分钟就停下，未知继续保留',evidenceRefs:request.authorizedEvidenceRefs}]
 return p
}
export function simulatedDecision(overrides:Partial<DecisionAdapter>={}):DecisionAdapter{
 return {executionKind:'simulated_provider',maxCostPerCallCny:0.02,
  analyze:async(c,path)=>({result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'合成路径分析 '+path.title,issues:[],proposal:proposal(c.request,[path])},providerCalls:1,costCny:0.01}),
  critic:async c=>({result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'合成独立审查：目前无结构冲突，实际结果未知',issues:[]},providerCalls:1,costCny:0.01}),
  synthesize:async(c,analyses)=>({result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'合成候选：本阶段只投入一个小实验',issues:[],proposal:proposal(c.request,analyses.flatMap(a=>a.proposal!.alternatives.map(p=>({id:p.directionId,title:p.title}))))},providerCalls:1,costCny:0.01}),...overrides}
}
export const result=(refs:WorkflowRequest['authorizedEvidenceRefs']):AgentResult=>({evidenceRefs:refs,summary:'synthetic safe result',issues:[]})
