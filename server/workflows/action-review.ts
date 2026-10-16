import {scanUserClauses} from '../user-command-spans.ts'
import {WorkflowError,emptyProposal,type EvidenceRef,type WorkflowRequest,type WorkflowProposal,type ActionUsageStatus} from './contracts.ts'

export type ActionCase={eventId:string;revision:number;object:string;request:string;known:{sent:boolean|null;read:boolean|null;replied:boolean|null;used:boolean|null;effect:string|null};usage:{status:ActionUsageStatus;source:EvidenceRef}[];answeredQuestions:string[]}
export type ActionReview={proposal:WorkflowProposal;feedback:ActionUsageStatus|null;stages:ActionCase['known'];reply:string;feedbackSource:EvidenceRef|null;needsClarification:boolean}
// Shared by stage reconciliation and feedback classification; plans are not delivery.
const reportedDelivery=/(?:我|按上次)[^；]{0,40}(?:发了|发出|发送了|联系了|提交了)|我(?:已经|已)(?:把[^；]{1,30})?(?:交给[^；]{1,20}了|交付了|提交了)/
// False is an explicit negative report; null means the student has not established it.
// Apply authorized messages chronologically. Corrections replace, rather than OR with, old facts.
export function reconcileActionStages(before:ActionCase['known'],quote:string,reported?:(field:keyof ActionCase['known'],evidenceQuotes:string[])=>void):ActionCase['known']{
 const clauses=scanUserClauses(quote).filter(x=>!x.interrogative&&!x.conditional&&!x.attributedToOther&&!x.quoted&&!x.code&&!x.quoteSpans.length)
 const text=clauses.map(x=>x.text).join('；'),stages={...before}
 if(!clauses.some(x=>/我|本人|按上次/.test(x.text)))return stages
 const facts:Record<'sent'|'read'|'replied'|'used',[RegExp,RegExp,RegExp]>={
  sent:[/还没发|没(?:有)?发(?:出|送)|没有联系|没联系|没提交/,reportedDelivery,/不(?:知道|确定)[^；]{0,12}(?:是否|有没有)?(?:发出|发送|提交)/],
  read:[/没(?:有)?(?:看|读)|未读/,/已读|已经(?:看|读)(?:了|过)/,/不(?:知道|确定)[^；]{0,12}(?:看|读)/],
  replied:[/没(?:有)?回复|未回复|还没回|没人回/,/回复了|收到了回复|已经回复/,/不(?:知道|确定)[^；]{0,12}(?:回|回复)/],
  used:[/没(?:有)?(?:用|使用|采用)|未(?:使用|采用)/,/(?:已经)?(?:用上了|使用了)|已经采用|采用了/,/不(?:知道|确定)[^；]{0,12}(?:用|使用|采用)|(?:是否|有没有)(?:使用|采用)[^；]{0,8}(?:我|本人)?(?:还|仍|尚)?不(?:知道|确定)/]
 }
 for(const key of ['sent','read','replied','used'] as const){
  const [no,yes,unknown]=facts[key]
  const matching=(pattern:RegExp)=>clauses.filter(x=>pattern.test(x.text)).map(x=>x.text)
  if(unknown.test(text)){stages[key]=null;reported?.(key,matching(unknown))}
  else if(no.test(text)){stages[key]=false;reported?.(key,matching(no))}
  else if(yes.test(text)){stages[key]=true;reported?.(key,matching(yes))}
 }
 // A reported effect cannot survive a correction of the use on which it depended.
 if(stages.used!==true||stages.sent===false)stages.effect=null
 else if(/实际(?:效果|结果)是|结果确实/.test(text)){stages.effect=text;reported?.('effect',clauses.filter(x=>/实际(?:效果|结果)是|结果确实/.test(x.text)).map(x=>x.text))}
 return stages
}
// The resolver uses authorized event IDs. Similar titles never serve as identity.
export function resolveActionCase(request:WorkflowRequest,cases:ActionCase[]):ActionCase{
 const allowed=new Set(request.authorizedEvidenceRefs.filter(x=>x.type==='event').map(x=>x.id))
 const choices=cases.filter(x=>allowed.has(x.eventId)&&(!request.eventId||x.eventId===request.eventId))
 if(choices.length!==1)throw new WorkflowError('ambiguous_event')
 const result=choices[0],ref=request.authorizedEvidenceRefs.find(x=>x.type==='event'&&x.id===result.eventId)!
 if(ref.revision!==result.revision)throw new WorkflowError('stale_snapshot')
 return structuredClone(result)
}
export function reviewAction(request:WorkflowRequest,actionCase:ActionCase,current:EvidenceRef):ActionReview{
 if(actionCase.eventId!==request.eventId)throw new WorkflowError('scope_denied')
 if(!current.quote||!request.authorizedEvidenceRefs.some(x=>x.type==='message'&&x.id===current.id&&x.revision===current.revision))throw new WorkflowError('source_invalid')
 const clauses=scanUserClauses(current.quote).filter(x=>!x.interrogative&&!x.conditional&&!x.attributedToOther&&!x.quoted&&!x.code&&!x.quoteSpans.length)
 const text=clauses.map(x=>x.text).join('；'),own=clauses.some(x=>/我|本人|按上次/.test(x.text))
 const negative=own&&/不想继续|不做了|不再试|拒绝继续/.test(text)
 const reopen=own&&/我[^；]{0,20}(?:重新|再次)(?:愿意|决定)|我现在愿意继续/.test(text)
 const lastStatus=(status:'declined'|'accepted')=>actionCase.usage.reduce((last,item,index)=>item.status===status?index:last,-1)
 const previouslyDeclined=lastStatus('declined')>lastStatus('accepted')
 const proposal=emptyProposal(request)
 proposal.evidenceRefs=[...request.authorizedEvidenceRefs.filter(x=>x.type==='event'&&x.id===actionCase.eventId),current]
 const stages=reconcileActionStages(actionCase.known,current.quote)
 const canAdvise=!negative&&(!previouslyDeclined||reopen)&&!request.controls.refuseAdvice&&!request.controls.listeningOnly&&!request.controls.recommendationsPaused
 let feedback:ActionUsageStatus|null=null,reply='这次反馈还不能确定实际执行到了哪一步。',needsClarification=false
 if(negative){feedback='declined';reply='好，我们先停下这件事。'}
 else if(previouslyDeclined&&!reopen){reply='上次你选择了暂停；先按这个选择继续。'}
 else if(own){
  const sent=reportedDelivery.test(text)
  const noReply=/没(?:有)?回复|未回复|还没回|等(?:待)?回复|没人回/.test(text)
  if(stages.sent&&noReply){feedback='waiting_result';reply=`你已经向${actionCase.object}发出了${actionCase.request}，目前只知道还没回复，原因仍未知。`}
  else if(/卡住|没效果|没用上|打不开/.test(text)){feedback='blocked';reply='这次有具体卡点，但暂时不能据此判断你的能力或对方的动机。'}
  else if(/我[^；]{0,20}(?:愿意试|接受这个|同意这样做)/.test(text)){feedback='accepted';reply='你愿意试这个方法；实际是否开始还未知。'}
  else if(/我[^；]{0,20}(?:做完了|完成了)/.test(text)){feedback='completed';reply='这一步已完成；对方是否使用和实际效果仍分别确认。'}
  else if(sent||/我[^；]{0,20}(?:尝试了|开始了|试了)/.test(text)){feedback='attempted';reply='你已开始尝试；对方的回应与结果仍未知。'}
 }
 if(canAdvise){
  if(feedback==='waiting_result'){
   const minutes=5
   if(!request.budget||request.budget.amountMinutes>=minutes)proposal.nextActions.push({description:`先把给${actionCase.object}的原问题保留，给自己设一个停止等待的时间；到时可改查公开资料或暂停，无需反复催问。`,estimatedMinutes:minutes,stopCondition:'到自己设定的时间仍未回复就停止等待；不继续联系也可以。',evidenceRefs:[current]})
  }else if(!feedback){
   const question='消息已经发出了吗？'
   if(!stages.sent&&!actionCase.answeredQuestions.includes(question)){reply=question;needsClarification=true}
  }
 }
 return {proposal,feedback,stages,reply,feedbackSource:feedback?current:null,needsClarification}
}
