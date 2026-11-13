import {scanUserClauses,goalChangeMarker,assistantRequestClause,decisionComparisonActualClauses,namedMatterEndTarget,namedMatterTargetMatches,firstPersonalActor,otherActorClause,scopedTaskPauseTarget,actionReportText,actionStepChoice,type UserClause} from '../user-command-spans.ts'
import {actionEvidenceUnavailable,clauseExpressesFuturePlan} from '../experience-content.ts'
import {pursuitLevel} from '../user-themes.ts'
import {reportedCompletedContactClauses,reportedFailedContactClauses,reportedOutcomeSourceClauses,reportedPursuitClauses} from '../turn-contract.ts'
import {WorkflowError,emptyProposal,type EvidenceRef,type WorkflowRequest,type WorkflowProposal,type ActionUsageStatus} from './contracts.ts'

export type ActionCase={eventId:string;revision:number;object:string;request:string;known:{sent:boolean|null;read:boolean|null;replied:boolean|null;used:boolean|null;effect:string|null};usage:{status:ActionUsageStatus;source:EvidenceRef}[];answeredQuestions:string[]}
export type ActionReview={proposal:WorkflowProposal;feedback:ActionUsageStatus|null;stages:ActionCase['known'];reply:string;feedbackSource:EvidenceRef|null;needsClarification:boolean}
export type MatterState='proposed'|'accepted'|'unattempted'|'partial'|'attempted'|'waiting_result'|'adjusted'|'paused'|'ended'|'completed'|'blocked'|'unknown'
export type MatterChoice='accepted'|'declined'|'unknown'
const actionReportClauses=(input:string|readonly UserClause[])=>(typeof input==='string'?scanUserClauses(input):input).filter(x=>!x.interrogative&&!x.conditional&&!x.attributedToOther&&!x.quoted&&!x.code&&!x.quoteSpans.length&&!x.codeSpans.length)
const otherMatterMention=/(?:另一|另外|其他|其它|别的)(?:个|件|份|项|条|步)?/
const limitedStep=/^(?:(?:只|仅)?(?:完成|做)(?:了)?(?:一部分|部分|一半)|(?:只|仅)(?:做|核对|整理|完成)了)/
function namedMatterChoice(text:string,matterTitle?:string):MatterChoice|null{
 if(!matterTitle)return null
 const match=/^(?:我|本人)(接受|同意|拒绝|不接受)(.+)$/.exec(text)
 if(!match)return null
 // A bare prefix may be a different, longer task name. Only an exact named
 // action or an explicit possessive boundary binds this matter's operation.
 const exact=match[2]===matterTitle
 if(!exact&&!match[2]!.startsWith(matterTitle+'的'))return null
 // A matching event title is identity, not proof that its text is an action.
 if(/值得|有待|适合|可能|需要|应该|必须|可以|能够|无法|负责|认为|表示|要求|建议|应当|应由|会被|被|不能|不必|不宜|已经|尚未|没有/.test(match[2]!))return null
 if(exact)return /(?:检查|修改|补充|整理|准备|核对|撰写|报名|申请|联系|提交)$/.test(matterTitle)?(['接受','同意'].includes(match[1]!)?'accepted':'declined'):null
 const action=match[2]!.slice(matterTitle.length+1)
 // A bounded operation phrase may bind an abbreviated title. Arbitrary
 // predicates ending in an action verb can instead accept a proposition
 // (e.g. 内容值得补充), so leave unrecognized phrases unknown.
 const object='(?:(?:内容|事实|状态|评价|结果|结论|意见|图表|说明|权限|资料|材料|文档|老师|同学|邮件|消息|草稿|报告)){0,3}'
 const operation='(?:检查|修改|补充|整理|准备|核对|撰写|报名|申请|联系|提交)'
 if(!new RegExp('^'+object+operation+'(?:(?:和|与|及)'+operation+'){0,2}$').test(action))return null
 return ['接受','同意'].includes(match[1]!)?'accepted':'declined'
}
// Read only explicit reports from the same authorized matter. A proposal,
// copied material and another person's actions never establish execution.
export function reportedActionProgress(input:string|readonly UserClause[],matterTitle?:string,scope?:{choiceQuote?:string;pauseQuote:string}):{state:MatterState|null;choice:MatterChoice|null;quotes:string[];resumed:boolean}{
 let state:MatterState|null=null,choice:MatterChoice|null=null,resumed=false
 let terminalState:'paused'|'ended'|null=null
 const quotes:string[]=[]
 const clauses=actionReportClauses(input)
 for(const [index,clause] of clauses.entries()){
  const {body,choiceBody}=actionReportText(clause.text)
  const namedBody=choiceBody.replace(/(?:但|不过)(?:我|本人)?(?:还没|还没有|尚未)(?:开始|执行|动手)$/,'')
  const namedChoice=namedMatterChoice(namedBody,matterTitle)
  const stepChoice=actionStepChoice(choiceBody)
  const adjustment=/^(?:我|本人)(?:现在|目前|决定|已经|已)?(?:调整|改为|改用|换成|改成|缩小)|^(?:我|本人)把(?:这|那|该)[^。！？；]{0,20}(?:调整|改成|缩小)/.test(body)
  // Event routing does not license a report explicitly about another matter.
  // Keep the original fact, but never use it as this matter's progress.
  if(!adjustment&&otherMatterMention.test(body))continue
  if(/^(?:我|本人)(?:现在)?(?:重新|再次)?(?:愿意|决定)(?:继续|恢复|再试)|^(?:我|本人)(?:现在)?(?:重新|再次)愿意(?:尝试|执行)/.test(body)){resumed=true;terminalState=null;choice='accepted';state='accepted';quotes.push(clause.text)}
  if(scope?.choiceQuote===clause.text||namedChoice==='accepted'||stepChoice==='accepted'||/^这只是(?:我|本人)选择接受[。！]?\s*$/.test(body)){choice='accepted';state='accepted';quotes.push(clause.text)}
  const notStarted=body.replace(/^[\p{L}\p{N}]{0,16}(?:这件事|这一步)(?=我|本人)/u,'').replace(/^这不准确[:：]\s*(?=我|本人)/,'')
  if(namedChoice&&namedBody!==choiceBody||/^(?:我|本人)?(?:现在|目前|这次|本次)?(?:还是|仍然|依然|完全)?(?:还没有|还没|尚未|没有|没|未)(?:开始|执行|动手)/.test(notStarted)){state='unattempted';quotes.push(clause.text)}
  if(namedChoice==='declined'||stepChoice==='declined'){state='paused';terminalState='paused';resumed=false;choice='declined';quotes.push(clause.text)}
  const actor=/^(?:我|本人)(?:现在|目前|已经|已)?/.exec(body)
  if(limitedStep.test(actor?body.slice(actor[0].length):body)){
   const prior=clauses[index-1]
   // Original coordinates keep a filtered-out clause from becoming an
   // adjacent owner. An omitted subject only borrows the immediately prior
   // authorized first-person report in the same sentence.
   const inherited=!actor&&prior&&prior.sentenceStart===clause.sentenceStart&&/^[，,、]$/.test(prior.delimiter)&&prior.end+1===clause.start&&firstPersonalActor(prior.text)&&!otherActorClause(prior.text,{allowOmittedSubject:true})&&!assistantRequestClause(prior.text)&&!clauseExpressesFuturePlan(prior.text)&&!actionEvidenceUnavailable(prior.text)&&!otherMatterMention.test(prior.text)&&!otherActorClause(body,{allowOmittedSubject:true})
   if(actor||inherited){
    state='partial'
    if(inherited)quotes.push(prior.text)
    quotes.push(clause.text)
    continue
   }
  }
  if(/^(?:目前|现在)?(?:我|本人)(?:目前|现在|还|仍|仍然)?(?:在)?(?:等|等待)(?:待)?(?:对方(?:的)?)?(?:结果|回复|反馈)/.test(body)){state='waiting_result';quotes.push(clause.text)}
  if(adjustment){state='adjusted';quotes.push(clause.text)}
  const completion=/^(?:我|本人)(?:现在|目前|已经|已)?(?:完成了?|做完了)([^。！？；]+)/.exec(body),object=completion?.[1]
  if(object){
   const compact=(value:string)=>value.replace(/[的\s“”「」《》]/g,''),at=matterTitle?object.indexOf(matterTitle):-1,suffix=at>=0?object.slice(at+matterTitle!.length):''
   const whole=matterTitle&&compact(object).replace(/了$/,'').endsWith(compact(matterTitle))||/^的?(?:全部|所有)(?:内容|部分|要求|工作|任务|步骤)[了\s]*$/.test(suffix)
   const component=at>=0&&/^(?:的|中|里|框架|草稿|初稿|大纲|目录|封面|摘要|图表)/.test(suffix)||!matterTitle&&/的(?:框架|草稿|初稿|大纲|目录|封面|摘要|图表)/.test(object)
   if(!whole&&component){state='partial';quotes.push(clause.text);continue}
  }
  if(clause.text===scope?.pauseQuote){state='paused';terminalState='paused';resumed=false;quotes.push(clause.text)}
  else if(/^(?:我|本人)(?:现在|目前|决定)?(?:先|暂时)?(?:暂停|停下)|^(?:这件事|这一步)(?:我)?(?:先|暂时)(?:暂停|停下)/.test(body)){state='paused';terminalState='paused';resumed=false;choice='declined';quotes.push(clause.text)}
  const endedTarget=namedMatterEndTarget(clause.text)
  if(endedTarget&&matterTitle&&namedMatterTargetMatches(matterTitle,endedTarget)||/^(?:我|本人)(?:现在|目前)?(?:(?:重新|再次)?决定)?(?:结束(?:这件事|这一步)|不再继续(?:这件事|这一步)?|不想继续|不做了|不再试|拒绝继续)|^(?:这件事|这一步)(?:已经)?结束了/.test(body)){state='ended';terminalState='ended';resumed=false;choice='declined';quotes.push(clause.text)}
  if((/^(?:我|本人)(?:现在|目前|已经|已)?(?:做完了|完成了|完成核对|核对完)/.test(body)||/^(?:我|本人)(?:已经|已)完成(?!度|率|不|没)/.test(body))&&!/(?:还没|尚未|没有|未)(?:完成|做完)|一部分|部分|一半/.test(body)){state='completed';quotes.push(clause.text)}
  if(/^(?:我|本人).{0,20}(?:卡住|没效果|没用上|打不开)/.test(body)){state='blocked';quotes.push(clause.text)}
  if(/^(?:我|本人)(?:已经|已)?(?:开始(?:了|做|核对|整理)|试过|尝试了|试了|做了|核对了|整理了)/.test(body)){state='attempted';quotes.push(clause.text)}
  if(!quotes.includes(clause.text)&&reportedDelivery.test(body)){state='attempted';quotes.push(clause.text)}
 }
 return {state:terminalState??state,choice:terminalState&&(terminalState==='ended'||!scope||!quotes.includes(scope.pauseQuote))?'declined':choice,quotes:[...new Set(quotes)],resumed}
}
const unfinishedResult=/^(?:我|本人)?(?:这次|本次)?(?:但|不过|也|仍|还)?(?:没有|没能|没|尚未|未能|未)(?:完成|做完)$/
const unhelpfulResult=/^(?:但|不过|也|仍|还)?(?:没有|没能|没|未能)(?:帮(?:助)?(?:我|本人)|让(?:我|本人))(?:判断|确认|决定|弄清)[^。！？；]{1,48}$/
export function reportedPartialActionOutcomes(text:string){
 if(!/[只仅]|部分|一半/.test(text))return []
 const clauses=actionReportClauses(text)
 const outcomes:{action:UserClause;clauses:UserClause[];quote:string;range:{start:number;end:number}}[]=[]
 const adjacent=(left:UserClause,right:UserClause)=>right.sentenceStart===left.sentenceStart&&/^[，,、]$/.test(left.delimiter)&&right.start===left.end+1
 for(let index=0;index+1<clauses.length;index++){
  const action=clauses[index]!,partial=clauses[index+1]!
  if(!adjacent(action,partial))continue
  const report=reportedActionProgress([action,partial])
  if(report.state!=='partial'||!report.quotes.includes(action.text)||!report.quotes.includes(partial.text))continue
  // The same owned comma chain can report extent, non-completion, and a
  // failed purpose. Time limits and a separate action end the outcome.
  const outcome=[partial]
  for(const clause of clauses.slice(index+2)){
   if(!adjacent(outcome.at(-1)!,clause)||!unfinishedResult.test(clause.text)&&!unhelpfulResult.test(clause.text))break
   outcome.push(clause)
  }
  if(outcome.length===1)continue
  const range={start:partial.start,end:outcome.at(-1)!.end}
  outcomes.push({action,clauses:outcome,quote:text.slice(range.start,range.end),range})
 }
 return outcomes
}
export function acceptedStepFromQuote(quote:string):string|null{
 return /^(?:我|本人)(?:接受|同意)先(.{2,40}?)(?:这|那|该)(?:个)?(?:步骤|行动)$/.exec(actionReportText(quote).choiceBody)?.[1]??null
}
export function matchesAcceptedPartialAction(action:string,acceptedQuotes:readonly string[]):boolean{
 const performed=action.replace(/^(?:我|本人)(?:这次|今天|刚才|已经)?/,'').replace(/^(.{1,4}?)了/,'$1')
 return acceptedQuotes.some(quote=>{
  const step=acceptedStepFromQuote(quote)
  if(!step||!performed.startsWith(step))return false
  const rest=performed.slice(step.length)
  return !rest||/^(?:约|大概)?[0-9零一二三四五六七八九十两]{1,6}(?:秒|分钟|小时)(?:左右)?$/.test(rest)
 })
}
export function reportedDatedMatterTitle(text:string):string|null{
 const title=/^(?:我|本人)(?:(?:现在|目前|正在))?(?:在?准备|计划完成|打算完成|在做)([^。！？]{2,64})$/u.exec(text.trim())?.[1]?.trim()
 if(!title||/^(?:了|过|完|好|让|叫|请|帮|把|将|先|和|跟)/.test(title)||otherActorClause(text,{allowOmittedSubject:true})||assistantRequestClause(text))return null
 return title
}
// A new matter can arrive with its deadline and the user's accepted step in
// one report, even before any assistant has created an event.
export function reportedDatedMatterChoice(text:string){
 if(!text.includes('截止'))return null
 const clauses=scanUserClauses(text)
 const [task,deadline,...step]=clauses
 if(!task||!deadline||!step.length||actionReportClauses(clauses).length!==clauses.length||task.sentenceStart!==deadline.sentenceStart||task.end+1!==deadline.start)return null
 const title=reportedDatedMatterTitle(task.text)
 if(!title)return null
 const when=/^截止(?:时间)?(?:到|至|为|是|[:：])?\s*(.+)$/.exec(deadline.text.trim())?.[1]
 if(!when||/未知|未定|没定|不确定|不清楚|可能|待定/.test(when)||!/(?:今|明|后)(?:天|晚)|(?:周|星期)[一二三四五六日天]|\d{1,4}[年月日点时:/-]/.test(when))return null
 const progress=reportedActionProgress(step,title)
 return progress.choice==='accepted'&&progress.state==='unattempted'&&step.every(clause=>progress.quotes.includes(clause.text))?{title,task,clauses}:null
}
export function reportedNamedMatterAcceptance(text:string){
 const clauses=scanUserClauses(text),owned=new Set(actionReportClauses(clauses))
 const selections=clauses.flatMap((task,index)=>{
  const step=clauses[index+1]
  const title=/^(?:我|本人)(?:决定|先)?选(?:择)?([^，。；！？]{2,40})$/u.exec(task.text)?.[1]?.trim()
   if(!title||/^(?:这|那|另一个)|还是|或者|再考虑|不确定/.test(title)||!step||!owned.has(task)||!owned.has(step)||!['，',',','。','.'].includes(task.delimiter)||task.end+1!==step.start||actionStepChoice(actionReportText(step.text).choiceBody)!=='accepted')return []
  return [{title,task,clauses:[task,step]}]
 })
 return selections.length===1?selections[0]!:null
}
// Only a fully scoped switch can bind a generic category name in a pause to
// a newly named matter. A later focus declaration is a different statement.
export function reportedSwitchedMatterChoice(text:string){
 if(!/^\s*(?:换一件事|换个事)[，,]/.test(text))return null
 const clauses=scanUserClauses(text)
 const [marker,task,...reports]=clauses
 if(!marker||!task||marker.sentenceStart!==task.sentenceStart||marker.end+1!==task.start||actionReportClauses(clauses).length!==clauses.length)return null
 const title=/^(?:我|本人)(?:还|也|正在|现在)?(?:考虑|准备|想|打算)(?:参加|报名参加)([^。！？]{2,40})$/u.exec(task.text.trim())?.[1]?.trim()
 if(!title||otherActorClause(task.text,{allowOmittedSubject:true})||assistantRequestClause(task.text))return null
 const focus=/^(?:当前|现在)(?:的)?重点(?:改成|转到|回到)([^。！？]{2,40})$/u.exec(reports.at(-1)?.text.trim()??'')?.[1]?.trim()
 const pause=reports.at(focus?-2:-1)
 const target=pause?scopedTaskPauseTarget(pause.text):null
 if(!pause||!target||!namedMatterTargetMatches(title,target)&&!(target==='竞赛'&&/(?:竞赛|创新赛)$/.test(title)))return null
 const step=reports.slice(0,focus?-2:-1)
 const choiceQuote=step.find(clause=>/^(?:我|本人)(?:接受|同意)先(?:看|核对|整理|确认|收集|查阅|提交)[^。！？；，,]{1,32}$/.test(clause.text.trim()))?.text
 const scope={choiceQuote,pauseQuote:pause.text}
 const progress=reportedActionProgress(step,title,scope)
 return progress.choice==='accepted'&&progress.state==='unattempted'&&step.every(clause=>progress.quotes.includes(clause.text))?{title,task,clauses:[task,...step,pause],scope,focus}:null
}
export function projectMatterReport<T extends {state:MatterState;choice:MatterChoice;recommendationStopped:boolean}>(prior:T,report:Pick<ReturnType<typeof reportedActionProgress>,'state'|'choice'|'resumed'>):T{
 return {...prior,state:report.state??prior.state,choice:report.choice??prior.choice,recommendationStopped:report.state==='paused'||report.state==='ended'?true:report.resumed?false:prior.recommendationStopped}
}
// Lexical comparison candidates alone never grant write permission. Reuse the
// same native progress/pursuit meaning as ordinary turns, including negatives.
export function reportedActualComparisonClauses(text:string){
 return decisionComparisonActualClauses(text).filter(clause=>reportedActionProgress(clause.text).quotes.length>0||reportedPursuitClauses(clause.text).length>0)
}
// An explicit personal stop can belong to the supplied prior matter. A later
// new pursuit remains distinct; context alone never establishes this report.
export function reportedPriorMatterTransition(text:string){
 const clauses=actionReportClauses(text),reported=reportedPursuitClauses(text)
 const pursuits=clauses.filter(clause=>reported.some(item=>item.start===clause.start&&item.end===clause.end)||goalChangeMarker.test(clause.text)&&pursuitLevel(clause.text)!==null)
 for(const clause of clauses){
  if(!/(?:这件事|这一步|这个步骤)/.test(clause.text))continue
  const progress=reportedActionProgress(clause.text)
  if(progress.state!=='paused'&&progress.state!=='ended')continue
  const preceding=clauses.filter(item=>item.end<=clause.start)
  const priorScopeReintroduced=pursuits.some(item=>item.end<=clause.start)||preceding.some(item=>/(?:换个|换一件|另一件|另一个|新事情|新话题|转到|转而|不谈上次)/.test(item.text))
  const newPursuitDeclared=pursuits.some(item=>item.start>=clause.end&&item.text!==clause.text)
  if(priorScopeReintroduced&&!newPursuitDeclared)continue
  return {quote:clause.text,stopEnd:clause.end,newPursuitDeclared,priorScopeReintroduced,requiresCurrentContext:preceding.some(item=>!assistantRequestClause(item.text)),progress}
 }
 return null
}
// Shared by stage reconciliation and feedback classification; plans are not delivery.
const reportedDelivery={test:(quote:string)=>reportedCompletedContactClauses(quote).length>0}
// False is an explicit negative report; null means the student has not established it.
// Apply authorized messages chronologically. Corrections replace, rather than OR with, old facts.
export function reconcileActionStages(before:ActionCase['known'],quote:string,reported?:(field:keyof ActionCase['known'],evidenceQuotes:string[])=>void):ActionCase['known']{
 const clauses=reportedOutcomeSourceClauses(quote).filter(x=>!x.attributedToOther&&!x.codeSpans.length)
 const text=clauses.map(x=>x.text).join('；'),stages={...before}
 if(!clauses.some(x=>/我|本人/.test(x.text)))return stages
 const failedContactQuotes=new Set(reportedFailedContactClauses(quote).map(clause=>clause.text))
 const facts:Record<'sent'|'read'|'replied'|'used',[Pick<RegExp,'test'>,Pick<RegExp,'test'>,RegExp]>={
  sent:[{test:text=>text.split('；').some(part=>failedContactQuotes.has(part))||/还没发|没(?:有)?发(?:出|送|给)|未(?:发出|发送|发给|提交|联系)|没有联系|没联系|没提交/.test(text)},reportedDelivery,/(?:不(?:知道|确定|清楚)|无法确认|未确认)(?:自己|我|本人|(?:这|那)?(?:个|份|封|条)?(?:链接|PDF|作品集|材料|资料|邮件|消息))?(?:是否|有没有)?(?:已经|已|成功|实际)?(?:把(?:这|那)?(?:个|份|封|条)?(?:链接|PDF|作品集|材料|资料|邮件|消息))?(?:发出|发送|发给|发了|提交|交付|联系)/],
  read:[/没(?:有)?(?:看|读)|未读/,/已读|已经(?:看|读)(?:了|过|到)/,/不(?:知道|确定)[^；]{0,12}(?:看|读)/],
  replied:[/没(?:有)?回复|未回复|还没回|没人回/,/回复了|收到了回复|已经回复/,/不(?:知道|确定)[^；]{0,12}(?:回|回复)/],
  used:[/没(?:有)?(?:用|使用|采用)|未(?:使用|采用)/,/(?:已经)?(?:用上了|使用了)|已经采用|采用了/,/不(?:知道|确定)[^；]{0,12}(?:用|使用|采用)|(?:是否|有没有)(?:使用|采用)[^；]{0,8}(?:我|本人)?(?:还|仍|尚)?不(?:知道|确定)/]
 }
 for(const key of ['sent','read','replied','used'] as const){
  const [no,yes,unknown]=facts[key]
  const matching=(pattern:Pick<RegExp,'test'>)=>clauses.filter(x=>pattern.test(x.text)).map(x=>x.text)
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
 const clauses=actionReportClauses(current.quote)
 const text=clauses.map(x=>x.text).join('；'),own=clauses.some(x=>/我|本人|按上次/.test(x.text))
 const progress=reportedActionProgress(current.quote)
 const negative=own&&/不想继续|不做了|不再试|拒绝继续/.test(text)
 const reopen=progress.resumed
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
  else if(progress.state==='blocked'){feedback='blocked';reply='这次有具体卡点，但暂时不能据此判断你的能力或对方的动机。'}
  else if(progress.state==='unattempted'){reply='这一步还没有开始；是否继续和如何缩小投入可以按你当前的选择调整。'}
  else if(progress.state==='completed'){feedback='completed';reply='这一步已完成；对方是否使用和实际效果仍分别确认。'}
  else if(sent||progress.state==='partial'||progress.state==='attempted'||/我[^；]{0,20}(?:尝试了|开始了|试了)/.test(text)){feedback='attempted';reply='你已开始尝试；对方的回应与结果仍未知。'}
  else if(progress.choice==='accepted'){feedback='accepted';reply='你愿意试这个方法；实际是否开始还未知。'}
 }
 if(canAdvise){
  if(feedback==='waiting_result'){
   const minutes=5
   if(!request.budget||request.budget.amountMinutes>=minutes)proposal.nextActions.push({description:`先把给${actionCase.object}的原问题保留，给自己设一个停止等待的时间；到时可改查公开资料或暂停，无需反复催问。`,estimatedMinutes:minutes,stopCondition:'到自己设定的时间仍未回复就停止等待；不继续联系也可以。',evidenceRefs:[current]})
  }else if(!feedback){
   const question='消息已经发出了吗？'
   if(progress.state!=='unattempted'&&stages.sent===null&&!actionCase.answeredQuestions.includes(question)){reply=question;needsClarification=true}
  }
 }
 return {proposal,feedback,stages,reply,feedbackSource:feedback?current:null,needsClarification}
}
