// One ordinary contract with composable optional outputs. User controls,
// requested time arrangements and authorized sources narrow capabilities;
// legacy mode names are retained only for callers reading old contracts.

import { actionCoachTurnSchema,ordinaryAnswerWireSchema } from './action-coach-contracts.ts'
import {bindProcessSourceHandles,unprotectedClauseText} from './clause-catalogue.ts'
import {crisisSupportIntent} from './grilling-policy.ts'
import { scanUserClauses,currentConversationOnly,refusalPreferenceClause,scopedTaskPauseClause,assistantRequestClause,responseRequestScope,conversationPreferenceClause,profileWritesDisallowed,comparisonRequestClause,firstPersonalActor,jointPersonalActorClause,personalReportBody,otherActorClause,assistedSelfPerformanceClause,canonicalExamMatterIdentity,boundedOtherActorPhrase,openNestedOtherActor,openDirectOtherActor,openHumanOtherActor,openNonHumanOtherActor,leadingActionTimeLength } from './user-command-spans.ts'
import {independentTrialNouns,unresolvedTwoFactors} from './user-command-spans.ts'
import {requiresImmediateMaterial,deliverableIntent} from './action-coach-events.ts'
import {requiresPlanSlack} from './weekly-plans.ts'
import {actionEvidenceUnavailable,clauseExpressesFuturePlan} from './experience-content.ts'
import {applicableTimeBudget} from './turn-obligations.ts'
import {explicitMaterialForms,explicitMaterialFormConflict} from './experience-episodes.ts'

export type TurnContractMode='ordinary'|'reply_only'|'reply_growth'|'event'|'knowledge'|'planning'|'material'
export type TurnContractCapabilities={
  growth:boolean
  candidate:boolean
  plan:boolean
  citations:boolean
  event:boolean
  material:boolean
}
export type TurnContract={
  mode:TurnContractMode
  capabilities:TurnContractCapabilities
  // Private generation schema: closed lanes are unrepresentable; source
  // handles/fact references resolve to the unchanged public contract.
  schema:Record<string,unknown>
  schemaChars:number
  requiredReplyKind?:'comparison'|'summary'
}

const comparisonOrdinals=['一','二','三','四','五','六','七','八','九','十']
const comparisonStems=['甲','乙','丙','丁','戊','己','庚','辛','壬','癸']
const comparisonLabelTokens=comparisonOrdinals.map((word,index)=>{const n=index+1,upper=String.fromCharCode(65+index),lower=upper.toLowerCase();return `(?:(?:选项|方式|方案|路径|对象|方向)(?:${word}|${n}|${upper}|${comparisonStems[index]})[:：]|(?:${n}|${upper}|${lower})[.)、:：]|${word}[、.])`})
// Count only the user's comparison-list head and its adjacent enumeration,
// using the same clause offsets as command ownership. Criteria lists are not
// extra options, and unmentioned roads need not be enumerated.
export function requestedComparisonCount(text:string):number{
 const clauses=scanUserClauses(text);let count=2
 for(const [index,clause] of clauses.entries()){
  if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||!comparisonRequestClause(clause.text))continue
  const explicit=/(?:比较|对比|权衡)(?:一下)?(?:以下|这|那|上述)?([2-9二两三四五六七八九十])(?:个|条|种)(?:不同)?(?:路径|方向|选项|方式|方案|选择|办法|方法)/.exec(clause.text)
  if(explicit){const value=Number(explicit[1])||comparisonOrdinals.indexOf(explicit[1]!)+1;count=Math.max(count,explicit[1]==='两'?2:value)}
  const parts=[clause.text];let length=1,last=clause
  for(const next of clauses.slice(index+1)){
   if(!/^[、\s]*$/.test(text.slice(last.end,next.start))||!text.slice(last.end,next.start).includes('、')||next.quoted||next.code||next.conditional||next.attributedToOther)break
   length++;parts.push(next.text);last=next
  }
  const dimensions=/的(?:时间|投入|代价|条件|差异|风险|成本|异同|优劣|优缺点)/.test(clause.text)&&parts.slice(1).every(part=>/^(?:所需|实际|当前)?(?:时间|投入|代价|条件|差异|风险|成本|异同|优劣|优缺点|收益|未知)$/.test(part.trim()))
  if(!dimensions)count=Math.max(count,length)
 }
 return Math.min(comparisonOrdinals.length,count)
}
const comparisonLabels=comparisonLabelTokens.map(label=>'(?:^|\\n|[。；;：:])[ \\t]*'+label)
const comparisonOpeningPattern='^[ \\t\\r\\n]*'+comparisonLabelTokens[0]
export function comparisonOptionBody(text:string):string|null{
 const label=new RegExp(comparisonOpeningPattern).exec(text)
 return label?text.slice(label[0].length):null
}
// This checks only the requested presentation exists. It does not certify the
// options' factual support, utility, resource feasibility or causal reasoning.
export const comparisonReplyAccepts=(reply:string,sourceText='')=>{
 const normalized=reply.replace(/\*\*/g,''),required=requestedComparisonCount(sourceText),starts:{label:number;body:number}[]=[]
 let cursor=0
 for(const pattern of comparisonLabels.slice(0,required)){
  const match=new RegExp(pattern).exec(normalized.slice(cursor));if(!match)return false
  starts.push({label:cursor+match.index,body:cursor+match.index+match[0].length});cursor=starts.at(-1)!.body
 }
 return starts.every((start,index)=>{const body=normalized.slice(start.body,starts[index+1]?.label??normalized.length).trim();return body.length>0&&scanUserClauses(body).some(clause=>!clause.interrogative&&/[\p{L}\p{N}]/u.test(clause.text))})
}
// A finite set of suggestions is not evidence of an exhaustive universe.
export function comparisonUniverseAccepts(reply:string,sourceText:string){
 const source=scanUserClauses(sourceText).filter(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.interrogative&&!clause.attributedToOther)
 // Negating the assertion verb negates the closed-universe proposition too.
 // A resource absence (e.g. 没有客户) does not negate a following claim.
 const negatedAssertion=/(?:不(?:要|会|能|应|必)?|未曾?|没(?:有)?)(?:再|继续)?(?:声称|宣称|断言|主张|认为|认定|说|表示)(?:(?!但|而|却|可是|只是|反而|反倒|相反|反过来|所以|因此|因为|由于|既然|鉴于|于是|从而|故而|原因是|原因在于|源于|缘于|归因于|实际上|然而|不过|只有|仅有|仅限)[^，。；！？]){0,40}$/
 const affirmative=(text:string,pattern:RegExp)=>[...text.matchAll(pattern)].some(match=>{
  const prefix=text.slice(0,match.index!+match[0].search(/只有|仅有|仅限/))
  return !negatedAssertion.test(prefix)&&!/(?:(?:不是|并非|绝非|不代表|不等于|没(?:有)?说|未确认|没有确认)[^，。；！？]{0,8}|不)$/.test(prefix)
 })
 const closed=source.some(clause=>affirmative(clause.text,/(?:只有|仅有|仅限)(?:这)?(?:两|二|2)(?:种|类|个|条)(?:探索)?(?:选项|方案|路径|方式|选择|方法|办法)|(?:选项|方案|路径|方式|选择|方法|办法).{0,8}(?:只有|仅有|仅限)(?:这)?(?:两|二|2)(?:种|类|个|条)/g))
 if(closed)return true
 return !scanUserClauses(reply).some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.interrogative&&!/^(?:当前|本轮|这次)(?:给出|列出|选取|选择|所选|选定)/.test(clause.text)&&affirmative(clause.text,/(?:只有|仅有)(?:这)?(?:两|二|2)(?:(?:种|类)(?:探索|选择|选项|方案|路径|方式|办法)?|(?:个|条)(?:选项|方案|路径|方式|选择))/g))
}
export function requestedActionLimitAccepts(reply:string,text:string){
 if(responseRequestScope(text).actionLimit!==1)return true
 const pattern=new RegExp('(?:做完|完成|安排|进行|做)(?:这|上述|以上|下列)?\\s*[两二三四五六七八九十2-9]\\s*(?:次|轮)'+independentTrialNouns,'g')
 const clauses=scanUserClauses(reply)
 for(const match of reply.matchAll(pattern)){
  const clause=clauses.find(item=>item.start<=match.index!&&item.end>=match.index!),prefix=reply.slice(clause?.start??0,match.index)
  const historical=[...prefix.matchAll(/曾经|已经|此前|先前|之前|上次|过去/g)].at(-1)?.index??-1
  const proposed=[...prefix.matchAll(/现在|本轮|这次|接下来|之后|下次|再|先/g)].at(-1)?.index??-1
  if(/(?:不|不要|不必|无需).{0,4}$/.test(prefix)||historical>=0&&historical>=proposed)continue
  return false
 }
 return true
}
export function bindRequestedComparisonSchema(contract:TurnContract,text:string):TurnContract{
 const scope=responseRequestScope(text)
 if(!scope.comparisonRequested||scope.summaryRequested||scope.sentenceLimit||contract.capabilities.plan||requiresImmediateMaterial(text))return contract
 // Preserve an explicitly requested format rather than imposing headings on
 // a table, a one-paragraph answer or an instruction not to enumerate.
 if(scanUserClauses(text).some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&/表格|不分点|不要分点|不要编号|不要标题|只用一段|只(?:给|留|选|要)[^。！？\n]{0,12}(?:一个|一条|一句|1个|1条)|(?:只|仅)(?:回答|说)[^。！？\n]{0,10}(?:哪个|哪一)/.test(clause.text)))return contract
 const schema=structuredClone(contract.schema) as any
 delete schema.properties.lead
 schema.properties.reply={...schema.properties.reply,pattern:comparisonOpeningPattern,allOf:comparisonLabels.slice(0,requestedComparisonCount(text)).map(pattern=>({type:'string',pattern})),description:'reply从第一个选项标签及其具体内容开始，依次完整交付本轮点名的'+requestedComparisonCount(text)+'个比较对象，不固定为两项。每项说明与本人已知条件相关的依据和投入/局限；用户已经点名的对象不可遗漏，未点名的其他道路无需枚举。比较不代表已经选择或安排任务。缺少某项必需条件就如实标明该选项不能开始，不虚构资源或个人偏好。'}
 return {...contract,schema,schemaChars:JSON.stringify(schema).length,requiredReplyKind:'comparison'}
}

const singleSentencePattern='^[^。！？!?\\r\\n]+[。！？!?]?$'
export function isSingleSentenceReply(text:string):boolean{
 return new RegExp(singleSentencePattern).test(text.trim())
}
// Presentation quantity constrains the existing reply, not the factual lanes.
// Materials and plans keep their own contracts; no prose is truncated here.
export function summaryReplyAccepts(reply:string):boolean{
 const clauses=scanUserClauses(reply)
 return !/[？?]/.test(reply)&&clauses.some(clause=>/[\p{L}\p{N}]/u.test(clause.text)&&!/[吗么][。！!]?\s*$/.test(clause.text)&&!/^(?:(?:目前|现在|本轮|当前|已经|按要求|两条|两件事)[：:\s]*)*(?:已(?:经)?(?:更新|记录|保存|处理|更正|确认)(?:了)?(?:当前|各自|相关|两条|两件事|的)?(?:状态|信息|记录|理解)?|(?:明白|知道|了解|收到)(?:并(?:记住|记录|保存))?|不(?:再|继续)(?:行动|安排任务)|先?(?:暂停|不继续|不行动))(?:了)?[。！!]?\s*$/.test(clause.text))
}
export function bindRequestedSummarySchema(contract:TurnContract,text:string,questionRequested=false):TurnContract{
 const scope=responseRequestScope(text)
 if(!scope.summaryRequested||questionRequested||requiresImmediateMaterial(text)||contract.capabilities.plan)return contract
 const schema=structuredClone(contract.schema) as any
 if(scope.sentenceLimit===1)delete schema.properties.lead
 else if(schema.properties.lead)schema.properties.lead={...schema.properties.lead,pattern:'^[^？?]*$',description:'本轮交付当前理解的第一句预览；给基于本人报告的实际判断，不追问、不以状态确认替代理解，须在reply逐字保留。'}
 schema.properties.reply=scope.sentenceLimit===1
  ?{...schema.properties.reply,maxLength:240,pattern:'^[^。！？!?\\r\\n]+[。！!]?$' ,description:'只给一句当前阶段理解，以已报告的具体线索及局限为内容；'+(scope.actionRequested?'同一句中还须交付用户明确要求的小行动，遵守数量、时间与资源限制；':'')+'不复制上一轮整段，不加标题、状态确认、分段、第二句或追问。'}
  :{...schema.properties.reply,pattern:'^[^？?]*$',description:'本轮要求更新或说明当前理解：按内容需要用小标题、分段和分点说明本人具体报告、暂定理解及真正仍未知的地方，不强行压成一小段。未知用尚未确认的陈述表达，不变成要求用户逐项回答的问题；不以重问上一问或只确认状态替代交付。'+(scope.actionRequested?'同时交付本轮明确要求的小行动，遵守其数量、时间与资源限制。':'没有要求提问，不加入问句，不新增行动。')}
 return {...contract,schema,schemaChars:JSON.stringify(schema).length,requiredReplyKind:'summary'}
}

const carriesClauseText=(text:string)=>/[\p{L}\p{N}]/u.test(text)

// Compatibility evidence helper; ordinary capabilities do not depend on it.
const personalEventReportLexicon=/(?:做了|做完|做过|交了|交过|发过|发了|投过|写过|整理过|帮过|参加(?:了|过)|弄了|搞了|写了|投了|联系了|问了|试了|试过|没用上?|没效果|没结果|没坚持|卡住了?|导师说|学长说|学姐说|同学说|室友说|对方说|他们没用)/
export function reportsPersonalEvent(text:string):boolean{
  for(const clause of scanUserClauses(text)){
    if(!carriesClauseText(clause.text))continue
    // Temporal anchors alone (上次/昨天/上周…) carry no verb: they open the
    // lane only inside a clause that also reports an action by the speaker.
    if(clause.interrogative||clause.attributedToOther||clause.conditional||clause.quoted||clause.code)continue
    // A clause that merely MENTIONS a quoted statement (…这句话是什么意思)
    // discusses language, not experience; quoted spans inside it disqualify.
    if(clause.quoteSpans.length)continue
    if(/^(?:我|本人)(?:愿意|打算|准备|计划|想|希望)(?:先)?(?:试|尝试|整理|开始|问|做|复习)/.test(clause.text))continue
    if(personalEventReportLexicon.test(clause.text)&&(clause.text.includes('我')||clause.text.includes('本人')))return true
    if(/(?:上次|昨天|前天|上周|上个月|上学期|去年)/.test(clause.text)){
      const rest=scanUserClauses(text).slice().find(other=>other.sentenceStart===clause.sentenceStart&&personalEventReportLexicon.test(other.text)&&(other.text.includes('我')||other.text.includes('本人'))&&!other.interrogative&&!other.attributedToOther&&!other.conditional)
      if(rest)return true
    }
  }
  return false
}

const negativePersonalFact=/^(?:但|不过)?(?:这次|这周|本周|最近)?我(?:目前|现在|暂时|还|仍|一直|并|从来)?(?:没(?:有)?|尚未|还未|未|不)(?:开始|做|学|复习|准备|完成|交付|发送|收到|拿到|有|想|愿意|打算|决定|能|按时(?:交付|提交|完成))/
const anchorablePersonalClauses=(text:string)=>scanUserClauses(text).filter(clause=>!clause.interrogative&&!clause.conditional&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&!clause.quoteSpans.length)
const explicitPersonalUncertainty=/^(?:我|本人)(?:(?:目前|现在|还|仍|依然|暂时|也)){0,4}(?:不知道|不确定|不清楚|说不清|尚不清楚|尚未确定|无法确定|无法确认|不能确定|不能确认|还没弄清)(?=这|那|它|上述|前面|刚才)/

const evidenceInferenceLimit=/^(?:不要|别)(?:把|将|用|从|根据|依据|以)[^。！？\n]{1,80}(?:当成|视为|推成|推为|推断|推出|推导|推翻|判断为)[^。！？\n]{0,40}(?:适合|能力|兴趣|偏好|性格|动机|原因|因果|效果|稳定|趋势|结论|判断|感受|证明)/
const ownedFeelingWords='(?:轻松|放松|疲惫|开心|难过|烦躁|自在)'
const ownedFeelingStatement=new RegExp('^(?:(?:我|本人|我们)(?:(?:当时|那时|现在|真正|其实|确实|自己|也|更|很|有点|非常|特别|一直|已经|仍然|还是|并不|不|没|才|就|会|感到|觉得|感觉)){0,6}|(?:这|那|它|这件事)?让我(?:感到|觉得|感觉)?(?:很|更|有点|非常|特别)?)'+ownedFeelingWords)

// Keep referents next to an already authorized personal report. This saves a
// contiguous current-source context, never an inferred goal or old raw history.
export function reportedSourceContextClauses(text:string,anchorQuotes:readonly string[],controlClauses:readonly string[]=[]){
 const scanned=scanUserClauses(text),groups:typeof scanned[]=[]
 const sourceSubject=(body:string)=>body.replace(/^(?:回来反馈|反馈|状态更新)[:：]\s*/,'').replace(/^(?:另外|此外|还有|而|不过|但是|同时|其实|但)/,'')
 const sensitive=(body:string)=>/\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(body)
  ||/^(?:我|本人)?(?:现在|目前|这次)?(?:不想|不要|别)(?:再)?(?:让你)?(?:记录|保存|记住)/.test(sourceSubject(body))
  ||/(?:手机号(?:码)?|电话(?:号码)?)\s*(?:是|为|[：:])?\s*\+?[0-9][0-9\s-]{5,}|(?:微信号|联系方式)\s*(?:是|为|[：:])?\s*[A-Za-z0-9_.-]{5,}/i.test(body)
  ||/^(?:我(?:的)?|本人(?:的)?)?(?:住址|身份证|银行卡|密码|口令|api.?key)\s*(?:是|为|[：:])\s*\S/i.test(sourceSubject(body))
  ||/^(?:我们|我|本人)(?:现在|目前|此刻|暂时|此时|刚才|今天)?正?在(?:某|这|那|一)?(?:家|所|个)?(?:医院|诊所|病房|图书馆|宿舍|学校|家)$/.test(sourceSubject(body))
 const explicitFeedback=/^(?:回来反馈|反馈|状态更新)[:：]/.test(text.trim())
 // A feedback episode includes the observation and its adjacent qualification,
 // not just the first-person action. Keep the exact contiguous source: a
 // attributed statement remains a report, not a new fact about the speaker.
 const feedback:typeof scanned=[]
 if(explicitFeedback){
  for(const clause of scanned){
   const limit=evidenceInferenceLimit.test(clause.text)
   if(clause.interrogative||clause.conditional||clause.quoted||clause.code||clause.quoteSpans.length||clause.codeSpans.length||sensitive(clause.text)||controlClauses.includes(clause.text)||conversationPreferenceClause(sourceSubject(clause.text))||refusalPreferenceClause(sourceSubject(clause.text))||applicableTimeBudget(clause.text,undefined,undefined,{retainReportedBudget:true})||assistantRequestClause(sourceSubject(clause.text))&&!limit)break
   if(!feedback.length&&(!/(?:我|本人)/.test(clause.text)||clause.attributedToOther||embeddedOtherActorAction(clause.text)))break
   feedback.push(clause)
  }
 }
 const feedbackContext=feedback.length>1?[{...feedback[0]!,end:feedback.at(-1)!.end,text:text.slice(feedback[0]!.start,feedback.at(-1)!.end)}]:[]

 for(const clause of scanned){
  if(clause.interrogative||clause.conditional||clause.quoted||clause.code||clause.quoteSpans.length||clause.codeSpans.length||sensitive(clause.text)||assistantRequestClause(sourceSubject(clause.text))||conversationPreferenceClause(sourceSubject(clause.text))||refusalPreferenceClause(sourceSubject(clause.text))||controlClauses.includes(clause.text))continue
  const prior=groups.at(-1),last=prior?.at(-1)
  if(last&&last.sentenceStart===clause.sentenceStart&&/^[，,、\s]*$/.test(text.slice(last.end,clause.start)))prior!.push(clause)
  else groups.push([clause])
 }
 const contextual=groups.flatMap(group=>{
  // A directly owned explanation can be the sole positive clause after a
  // semicolon correction. It needs no performed-action verb or neighbouring
  // model-selected anchor; retain the explanation verbatim, not as a trait.
  const felt=group.some(clause=>!clause.attributedToOther&&ownedFeelingStatement.test(clause.text))
    ||(group.length>1&&group.some(clause=>!clause.attributedToOther&&new RegExp('(?:感到|觉得|感觉|让我).{0,12}'+ownedFeelingWords).test(clause.text)))
  if((group.length<2&&!explicitFeedback&&!felt)||!group.some(clause=>!clause.attributedToOther&&/(?:我|本人|我们)/.test(clause.text)))return []
  if(group.every(clause=>anchorQuotes.includes(clause.text)))return []
  const anchored=group.some(clause=>anchorQuotes.some(quote=>quote===clause.text))
  if(!anchored&&!felt&&!explicitFeedback)return []
  // A raw contextual sentence must not turn a scoped budget into permanent
  // background or retain an adjacent memory-control instruction.
  const first=group[0]!,last=group.at(-1)!,quote=text.slice(first.start,last.end)
  if(applicableTimeBudget(quote,undefined,undefined,{retainReportedBudget:true}))return []
  return [{...first,end:last.end,text:quote}]
 })
 // Optional model writes cannot be the only path for a directly reported
 // personal background. Retain verbatim, contiguous first-person clauses via
 // the same scanner and normal growth transaction; no inferred skills/traits.
 // Comma continuations inherit ownership only within that sentence. Time
 // budgets retain their existing typed lane and never join these snapshots.
 const personal:typeof groups=[]
 const uncertainties:typeof scanned=[]
 const ownedReports=new Set(reportedPerformedTaskClauses(text).map(clause=>clause.text))
 const linkedReportSentences=new Set(scanned.filter(clause=>ownedReports.has(clause.text)||(!clause.attributedToOther&&!clause.quoted&&!clause.code&&!clause.conditional&&!clause.interrogative&&/^(?:我|本人)(?:会|愿意|打算|计划)?(?:主动|仍然|还|仍|也)?继续/.test(clause.text))).map(clause=>clause.sentenceStart))
 const anchoredReports=scanned.filter(clause=>anchorQuotes.includes(clause.text)&&linkedReportSentences.has(clause.sentenceStart))
 let sentence=-1,owned=false,carrying=false
 for(const clause of scanned){
  if(clause.sentenceStart!==sentence){sentence=clause.sentenceStart;owned=false;carrying=false}
  const body=clause.text
  if(clause.interrogative||clause.conditional||clause.quoted||clause.code||clause.attributedToOther||clause.quoteSpans.length||clause.codeSpans.length||sensitive(body)||assistantRequestClause(sourceSubject(body))||conversationPreferenceClause(sourceSubject(body))||refusalPreferenceClause(sourceSubject(body))||controlClauses.includes(body)){
   owned=false;carrying=false;continue
  }
  const subject=sourceSubject(body)
  // An unknown attached to this turn's owned report is itself reported
  // context, not a positive/negative conclusion about the unknown claim.
  // A referent and a current anchor keep ordinary knowledge questions out.
  const uncertainty=explicitPersonalUncertainty.exec(subject)
  const previousSentence=[...scanned].reverse().find(other=>other.sentenceStart<clause.sentenceStart)?.sentenceStart
  if(uncertainty&&anchoredReports.some(anchor=>anchor.start<clause.start&&(anchor.sentenceStart===clause.sentenceStart||anchor.sentenceStart===previousSentence)))uncertainties.push(clause)
  if(/^(?:我|本人)/.test(subject)){
   owned=/^(?:我|本人)(?:(?:目前|现在|今年|已经|还是|正)?(?:是|就读|会|学过|做过|想|每(?:周|星期)|这周|本周|下周|一周|大[一二三四五]|研[一二三]))/.test(subject)
   if(!owned)carrying=false
  }
  else if(/^(?:我的|你|您|他|她|他们|她们|朋友|同学|室友|老师|队友)/.test(subject)){owned=false;carrying=false}
  if(applicableTimeBudget(body,undefined,undefined,{retainReportedBudget:true})){carrying=false;continue}
  const statement=subject.replace(/^(?:我|本人)(?:目前|现在|今年|已经|还是|正)?(?:是)?/,'')
  const education=/^(?:(?:成年)?(?:大学生|本科生|专科生|研究生|硕士生|博士生)|(?:目前|现在)?(?:大[一二三四五]|研[一二三])(?:学生|在读)?|就读.{1,40})$/u.test(statement)
   ||(!/我|你|他|她|的|是|说|另外|此外|还有/.test(statement)&&/^[\p{L}\p{N}\s]{1,40}专业(?:学生)?$/u.test(statement))
  const learning=/^(?:会(?:一点|一些|点|些)?[A-Za-z][A-Za-z0-9+#.\s-]{0,50}|学过.{1,40}|做过.{1,40}(?:练习|课程|项目|作品))$/.test(statement)
  const decision=/^(?:想(?:比较|了解|探索|选择).{1,80}|还没选定|尚未决定)$/.test(statement)
  // Every continuation must itself be relevant background/learning/choice
  // context. A location or contact clause cannot ride along on “我是大三”.
  if(!owned||(!education&&!learning&&!decision)){carrying=false;continue}
  const previous=personal.at(-1),last=previous?.at(-1)
  if(carrying&&last?.sentenceStart===clause.sentenceStart&&/^[，,、\s]*$/.test(text.slice(last.end,clause.start)))previous!.push(clause)
  else personal.push([clause])
  carrying=true
 }
 const reported=personal.map(group=>{const first=group[0]!,last=group.at(-1)!;return {...first,end:last.end,text:text.slice(first.start,last.end)}})
 return [...new Map([...contextual,...reported,...uncertainties,...feedbackContext].map(clause=>[clause.text,clause])).values()]
}

// Surface integrity only. Balanced prose is not proof of semantic completeness
// or usefulness; the independent real-dialogue review remains a separate gate.
export function completeUserReply(reply:string,userText:string,onFailure?:(code:'placeholder'|'internal_token'|'unfinished_predicate'|'unbalanced_punctuation')=>void){
 const fail=(code:Parameters<NonNullable<typeof onFailure>>[0])=>{onFailure?.(code);return false}
 const templateRequested=scanUserClauses(userText).some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&assistantRequestClause(clause.text)&&/模板|填空|占位|待补/.test(clause.text))||/【待补|\[待补|（待补/.test(userText)
 const placeholder=/(?:【待补[^】]*】|\[待补[^\]]*\]|（待补[^）]*）)/
 if(!templateRequested&&placeholder.test(reply)){
  for(const line of reply.split(/\r?\n/)){
   if(!placeholder.test(line))continue
   // Only a full deferral note may use this marker outside a requested
   // template. Validate the whole line, including any follow-up boundary.
    const note=/^[ \t]*(?:[-+*][ \t]+)?(?<bold>\*\*)?(?:【待补】|\[待补\]|（待补）)(?:\k<bold>)[ \t]*(?<prose>.+)$/u.exec(line)?.groups?.prose?.trim()
   if(!note)return fail('placeholder')
   const quotePairs:Record<string,string>={'“':'”','‘':'’','「':'」','『':'』','"':'"'}
   const closer=quotePairs[note.charAt(0)]
   const prose=closer&&note.endsWith(closer)?note.slice(1,-1):note
   const sentenceEnd=/[。！？．.!?…]+$/u
   if(!sentenceEnd.test(prose))return fail('placeholder')
    if(/^[^【】\[\]，,。！？；;：:\n]{2,40}(?:[:：][ \t]*)?(?:仍未知|仍未确认|尚未核实|尚未明确|还没确认)(?:[，,](?:先|可以|可)(?:向[^，,。！？；;：:\n]{1,20})?(?:问|核对|确认|查明)[^【】\[\]，,。！？；;：:\n]{2,60})?[。！？．.!?…]+$/u.test(prose))continue
   if(!placeholder.test(prose)&&/^(?:若|如果)(?:你|您)?(?:能|可以|愿意|方便)提供[^。！？；;：:\n]{2,140}[，,]\s*(?:我(?:就)?(?:能|可以)|可|可以)(?:再)?(?:给出|提供|说明|核对|调整|细化)[^。！？；;：:\n]{2,60}[。！？．.!?…]+$/u.test(prose))continue
   const [missing,feasible,permission,offer,...extra]=prose.replace(sentenceEnd,'').split(/[，,；;]\s*/)
   const reportsMissing=/^(?:你|您)(?:尚未|还没|还未|未)(?:说明|提供|提到)(?:自己的|你的|您的)?(?:专业(?:和感兴趣的(?:具体)?方向)?|感兴趣的(?:具体)?方向)$/.test(missing??'')
   const feasibleWithoutIt=/^(?:(?:以上|上述|本次)(?:步骤|建议|做法)|这一步)不(?:依赖|需要)(?:这些|上述)信息也能(?:执行|开始)$/.test(feasible??'')
   const optionalOffer=permission===undefined||!extra.length&&/^(?:若|如果)(?:你|您)?(?:愿意|方便)(?:再)?补充(?:这些信息)?$/.test(permission)
    &&/^(?:下次|之后|后续)(?:我)?(?:可|可以)(?:再)?(?:帮(?:你|您)把(?:搜索词|检索词)(?:收得|改得|调得)更(?:准|准确|精确|具体)|(?:调整|细化)(?:搜索词|检索词))$/.test(offer??'')
   if(reportsMissing&&feasibleWithoutIt&&optionalOffer&&!placeholder.test(prose))continue
   const [deferral='',boundary,...rest]=prose.replace(sentenceEnd,'').split(/[，,]\s*/)
   const defersDiscussion=/^(?:(?:下次|以后|后续)(?:有(?:空|(?:整块)?时间)(?:时)?)?|等(?:你)?有(?:空|(?:整块)?时间|反馈|结果)(?:时)?)再(?:说明|说|谈|聊|问|补充|核实|确认|处理)$/.test(deferral)
   const skipsFollowUp=boundary===undefined||/^(?:现在|今天|本轮|这次|暂时)?(?:先)?不(?:再)?追问(?:原因(?:或感受)?|感受)?$/.test(boundary)
   if(rest.length||!defersDiscussion||!skipsFollowUp)return fail('placeholder')
  }
 }
 const internal=reply.match(/\b(?:reported_(?:no_response|response|not_read|read|received|used|not_used|paid|unpaid|tried|not_tried)|growthUpdates|user_reported)\b/g)??[]
 if(internal.some(token=>!userText.includes(token)))return fail('internal_token')
  // A complete JSON frame can still end mid-proposition. Reject high-confidence
  // continuative predicates when their required complement has not arrived.
  const surfaceEnd=reply.trim().replace(/[。！？!?…]+$/,'').trim()
  if(/(?:都|均)(?:支持|证明|说明|表明|意味着|包括|包含|依赖|取决于|导致|造成|改善|增加|减少|避免|确认|展示|显示)$/.test(surfaceEnd))return fail('unfinished_predicate')
 const protectedSpans=scanUserClauses(reply).flatMap(clause=>[...clause.codeSpans,...clause.quoteSpans])
 const pairs:Record<string,string>={'（':'）','(':')','【':'】','[':']'},stack:string[]=[]
 for(let index=0;index<reply.length;index++){
  if(protectedSpans.some(span=>index>=span.start&&index<span.end))continue
  const char=reply[index]!
  if(pairs[char])stack.push(pairs[char]!)
  else if(stack.length&&Object.values(pairs).includes(char)&&stack.pop()!==char)return fail('unbalanced_punctuation')
 }
 return stack.length===0||fail('unbalanced_punctuation')
}
const embeddedOtherActorAction=(text:string)=>/(?:我|本人).{0,15}(?:让|看到|看见|听说|知道|发现|听到|要求|请(?!教)|确认|得知|获悉|收到).{0,15}(?:同学|学长|学姐|导师|老师|客户|朋友|对方|他|她)/.test(text)
// Explicit preferences remain exact reports, never inferred traits. Reuse the
// shared ownership/quote/condition guards and exclude conversational requests.
const personalPreference=/^(?:但|不过)?(?:我(?:自己|个人|本人)?)?(?:现在|目前)?(?:确实|其实|真的|的确)?(?:更|主要|最|也|仍然|仍|并)?(?:看重|重视|在意|不在意|喜欢|偏好|不喜欢|享受不了|不享受|享受|不想承担|不愿承担|愿意(?=在.{1,16}(?:表达|交流|发言)))(.+)$/
const hardClaimNegated=(text:string,at:number)=>{
 const local=text.slice(Math.max(0,at-18),at).split(/但是|不过|而是|但/).at(-1)??''
 return /不$/.test(local)||/(?:不(?:是|等于|应|宜|能|认为)|并非|未被|没有(?:被|把|将)?|不把|不得(?!不)|无需|不需(?:要)?|没(?:有)?必要).{0,12}$/.test(local)
}
const escaped=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
function ownedRequirementState(text:string,subject:string){
 if(!subject)return {hardRequirementQuote:null as string|null,hardRequirementRevocationQuote:null as string|null}
 const literal=escaped(subject),claims:{kind:'hard'|'revoked';quote:string;at:number}[]=[]
 for(const item of anchorablePersonalClauses(text)){
  if(!item.text.includes(subject)||assistantRequestClause(item.text))continue
  const value=item.text.trim()
  const revoked=new RegExp(`^(?:(?:我|本人)(?:不再|不)(?:把|将)?${literal}(?:作为|视为|定为|列为|当作)|${literal}(?:不再|并?不是|并非|不应|不宜|不能|不算)(?:作为|视为|定为|列为|当作|是)?)(?:我(?:的)?|本人(?:的)?)?(?:硬性?要求|硬约束|刚性要求|不可协商的条件)`).test(value)
   ||new RegExp(`^${literal}(?:不再|并?不是|并非)(?:我(?:的)?|本人(?:的)?)(?:硬性?要求|硬约束|刚性要求|不可协商的条件)`).test(value)
  if(revoked){claims.push({kind:'revoked',quote:item.text,at:item.start});continue}
  const direct=/^(?:我|本人)(?:自己|目前|现在|这次|仍然|也)?(?:必须|只能|只接受|一定要)(.+)$/.exec(value)
  if(direct?.[1]?.startsWith(subject)){claims.push({kind:'hard',quote:item.text,at:item.start});continue}
  const adoption=/(?:是|作为|视为|当作|定为|列为)(?:我(?:的)?|本人)(?:的)?(?:硬性?要求|硬约束|不可协商的条件)/.exec(item.text)
  const adoptedSubject=adoption?item.text.slice(0,adoption.index).replace(/^(?:我|本人)(?:把|将)?/,'').trim():null
  if(adoption&&adoptedSubject===subject&&!hardClaimNegated(item.text,adoption.index))claims.push({kind:'hard',quote:item.text,at:item.start})
 }
 const latest=claims.sort((a,b)=>a.at-b.at).at(-1)
 return {hardRequirementQuote:latest?.kind==='hard'?latest.quote:null,hardRequirementRevocationQuote:latest?.kind==='revoked'?latest.quote:null}
}
export function reportedPreferenceClauses(text:string,ownedPreferenceContext=false){
 const own=anchorablePersonalClauses(text)
 const reported:typeof own=[]
 for(const clause of own){
  // Ellipsis inherits only the adjacent owned preference in the same sentence,
  // never a nearby first-person event, quote, request or another speaker.
  const prior=reported.at(-1)
  const owns=/^我/.test(clause.text)||(ownedPreferenceContext&&clause===own[0])||Boolean(prior&&prior.sentenceStart===clause.sentenceStart&&/^[，,、\s]*$/.test(text.slice(prior.end,clause.start)))
  const match=owns?personalPreference.exec(clause.text):null
  if(match&&!/^(?:怎么|什么|哪|谁)/.test(match[1]!.trim())&&!assistantRequestClause(clause.text)&&!currentConversationOnly(clause.text))reported.push(clause)
 }
 return reported
}
export function negativePersonalFactClauses(text:string){
  const own=anchorablePersonalClauses(text)
  return own.filter(clause=>negativePersonalFact.test(clause.text)||
    (/^(?:目前|现在|暂时|也)?(?:没(?:有)?|尚未|未)(?:客户|接过单|接单)/.test(clause.text)&&own.some(c=>c.sentenceStart===clause.sentenceStart&&/我|本人/.test(c.text)))||
    (/^(?:但|也|目前|现在)?(?:还|仍)?(?:没(?:有)?|尚未|还未|未)(?:开始|动手|问|访谈|联系|回答|复习|准备|完成)/.test(clause.text)&&own.some(c=>c.sentenceStart===clause.sentenceStart&&/我|本人/.test(c.text)))||
    (/^(?:但|也)?(?:还)?(?:没(?:有)?|尚未|未)人(?:承诺|答应)(?:使用|采用|用)/.test(clause.text)&&own.some(c=>c.sentenceStart===clause.sentenceStart&&/我|本人/.test(c.text))))
}
const declaredGoalText=(text:string)=>/^(?:(?:我|本人)(?:现在|目前|当前)?的?)?(?:现在|目前|当前)?(?:方向|目标)(?:暂定|定为|目前是|当前是|是).{2,80}$/.test(text)&&!/(?:未知|不确定|没决定|未选定|是否|待定|不是|并非)/.test(text)&&!assistantRequestClause(text)&&!currentConversationOnly(text)
export function reportedPursuitClauses(text:string){
 const own=anchorablePersonalClauses(text)
 const reported:typeof own=[]
 for(const clause of own){
  const prior=own[own.indexOf(clause)-1]
  const previous=reported.at(-1)
  const owns=/^(?:我|本人)/.test(clause.text)||Boolean(prior&&prior.sentenceStart===clause.sentenceStart&&/^(?:我|本人)/.test(prior.text)&&!assistantRequestClause(prior.text)&&/^[，,、\s]*$/.test(text.slice(prior.end,clause.start)))
  const intention=owns&&/^(?:我|本人)?(?:主要)?(?:想|希望|计划|打算)(?:先)?(?:要|用|了解|知道|核对|确认|弄清|找出|看出|分清|识别|更快(?:找出|看出|分清|识别))/.test(clause.text)
  const outcome=previous&&previous.sentenceStart===clause.sentenceStart&&/^[，,、\s]*$/.test(text.slice(previous.end,clause.start))&&/^(?:减少|避免)自己(?!了)/.test(clause.text)
  const declaredDirection=declaredGoalText(clause.text)
  if((intention||outcome||declaredDirection)&&!assistantRequestClause(clause.text)&&!currentConversationOnly(clause.text))reported.push(clause)
 }
 return reported
}
export function resourceBlockedPersonalFactClauses(text:string){
  // BS_RESOURCE_01: only an explicit resource of the speaker's current course.
  // This records their report, never a website diagnosis or a completed action.
  return anchorablePersonalClauses(text).filter(clause=>/^(?:我的|我这门课的|这门课的|这次课程的).{0,16}(?:材料|教材|课件|资料|链接|网页).{0,6}(?:无法打开|打不开)/.test(clause.text))
}

export function reportedTaskBoundaryClauses(text:string){
 const clauses=anchorablePersonalClauses(text)
 return clauses.filter(clause=>refusalPreferenceClause(clause.text)
  ||scopedTaskPauseClause(clause.text)
  ||(/^(?:但)?(?:我的(?:课程|作业)?)?第[一二三四五六七八九十\d]+(?:道|个)?题(?:还是|还)?(?:不会做|不会|不懂|没思路|没有思路|不知道从哪里下手)$/.test(clause.text)
   &&clauses.some(other=>other.sentenceStart===clause.sentenceStart&&/(?:我|本人)/.test(other.text))))
}

// A later response only retires the same participant/material report.
// A role or delivery form alone cannot identify a different named matter.
export function sameReportedResponseSubject(previous:string,current:string,scope?:{sameEvent?:boolean;sourceBoundMatter?:boolean}){
 if(explicitMaterialFormConflict(previous,current))return false
 const oldReports=reportedEvidenceFromText(previous).participants
 const oldActors=new Set(oldReports.map(report=>report.actor))
 const boundMatter=scope?.sameEvent||scope?.sourceBoundMatter
 const newReports=reportedEvidenceFromText(current).participants.filter(report=>report.states.response.status==='reported_response'&&(!boundMatter||oldActors.has(report.actor)))
 const newActors=new Set(newReports.map(report=>report.actor))
 if(oldActors.size!==1||newActors.size!==1)return false
 const oldActor=[...oldActors][0]!,newActor=[...newActors][0]!
 if(oldActor!==newActor||oldActor==='对方')return false
 // Reuse the participant report parser. Preserve any explicitly named object
 // after removing only its old no-response state; a later report must name
 // that same object before we may retire it. PDF/link compatibility is a veto,
 // never positive evidence that two deliveries were the same matter.
 return oldReports.every(report=>{
  const parsed=participantReport(report.quote)
  if(!parsed)return false
  const matter=parsed.rest.replace(/(?:还没(?:有)?|没(?:有)?|尚未|还未|未)(?:回复|回应|回)/g,'').replace(/[，,。；;\s]/g,'')
  // A same-event source link licenses an explicit "later replied" update
  // to its generic earlier no-response report. It grants no identity across
  // events, named materials, or a newly named artifact in the reply body.
  const generic=matter.replace(/(?:只是|仅是|是)?结果未知/g,'')
  if(boundMatter&&/(?:还没(?:有)?|没(?:有)?|尚未|还未|未)(?:回复|回应|回)/.test(parsed.rest)&&/^(?:(?:这|那|该)(?:封|份|个)?|之前|上次|本次|这次|我的)*(?:邮件|消息)?是?$/.test(generic)&&newReports.some(next=>{
    const later=participantReport(next.quote)
    return later&&later.body.startsWith(next.actor+'后来回复')&&!/(?:另一|其他|新的|邮件|消息|表格|作业|报告|材料|文件|链接|PDF|项目)/i.test(later.rest)
  }))return true
  // A bare role/form is ambiguous even when it occurs verbatim in the new
  // report. Keep that historical report rather than guessing its identity.
  if(!matter||/^(?:(?:这|那|该)(?:封|份|个)?|之前|上次|本次|这次|我的)*(?:邮件|消息|PDF|作品集|材料|文档|文件|链接|表格|附件|作业|报告)?$/i.test(matter))return false
  return newReports.some(next=>next.actor===oldActor&&next.quote.replace(/[，,。；;\s]/g,'').includes(matter))
 })
}
// Event-free conversations still have source-backed facts. A single explicitly
// referenced generic mail/message can bind a later reply, provided every older
// report about that actor is compatible and the anchor has one original source.
// Return exact-clause amends; the shared fragment transaction preserves other
// actors and interpretations in composite records.
export function reportedResponseContinuationTargets(current:string,records:readonly {id:string;revision:number;text:string;sourceMessageIds:readonly string[];blocked?:boolean}[]){
 const targets:{itemId:string;expectedRevision:number;beforeQuote:string;quote:string;actor:string}[]=[]
 const currentReports=reportedEvidenceFromText(current).participants
 for(const next of currentReports.filter(report=>report.states.response.status==='reported_response')){
  if(currentReports.filter(report=>report.actor===next.actor).length!==1)continue
  const nextQuote=scanUserClauses(next.quote).find(clause=>reportedEvidenceFromText(clause.text).participants.some(report=>report.actor===next.actor&&report.states.response.status==='reported_response'))?.text
  if(!nextQuote)continue
  const group=records.map(record=>({record,reports:reportedEvidenceFromText(record.text).participants.filter(report=>report.actor===next.actor)})).filter(entry=>entry.reports.length)
  if(!group.length||group.some(({record,reports})=>record.blocked||!record.sourceMessageIds.length||reports.length!==1||scanUserClauses(reports[0]!.quote).length!==1||record.text.split(reports[0]!.quote).length!==2))continue
  const anchors=group.filter(({reports})=>/^(?:这|那|该)封(?:邮件|消息)(?:是)?(?:还没(?:有)?|没(?:有)?|尚未|还未|未)(?:回复|回应|回)/.test(participantReport(reports[0]!.quote)?.rest??''))
  const anchorSources=new Set(anchors.flatMap(({record})=>record.sourceMessageIds))
  const anchorReferences=new Set(anchors.map(({reports})=>/^(?:这|那|该)封(?:邮件|消息)/.exec(participantReport(reports[0]!.quote)?.rest??'')?.[0]))
  if(anchorSources.size!==1||anchorReferences.size!==1)continue
  if(group.some(({reports})=>!sameReportedResponseSubject(reports[0]!.quote,nextQuote,{sourceBoundMatter:true})))continue
  for(const {record,reports} of group)targets.push({itemId:record.id,expectedRevision:record.revision,beforeQuote:reports[0]!.quote,quote:nextQuote,actor:next.actor})
 }
 // Two different current replies cannot both rewrite the same parent version.
 return targets.filter(target=>targets.filter(other=>other.itemId===target.itemId).length===1)
}
const participantActor='(?:对方|客户|学长|学姐|(?:课程)?助教|辅导员老师|辅导员|部长|社长|评委|负责人|经理|HR|面试官|(?:[\u4e00-\u9fa5]{1,3})?(?:导师|老师)|同学|室友|朋友|他们|她们|他|她)'
const participantUncertainty=/(?:可能|也许|好像|似乎|大概|不确定|不清楚|不知道|说不准|不一定|未必|猜测|是否|有没有|未知|未报告|未确认|不是|并非|绝非|不代表|不等于|不能证明|不能说明)/
// Scope uncertainty to its explicit process dimension, without altering the
// source quote or ownership/condition scanner. Bare "but not sure" still
// qualifies the original statement; a different dimension does not erase it.
const participantDimensionBoundary=/(?=(?:但是|但|不过|然而|可是)(?=(?:这|已|已经|还|仍|尚|未|没有|可能|也许|是否|有没有|不确定|不清楚|不知道|不代表|不等于|未确认|未报告|他|她|对方|之后|后来|会不会|能否){0,8}(?:读|阅读|看|回复|回应|采用|使用|付款|付费|效果|试过|试用))|(?:不代表|不等于|不能证明|不能说明)(?=(?:已|已经)?(?:读|阅读|看|回复|回应|采用|使用|付款|付费|效果|试过|试用)))/
const participantStateFields={read:/读|阅读|看/,response:/回复|回应|没回|答复|回绝|拒绝|否决/,adoption:/采用|使用|用过|用了/,payment:/付款|付费|付钱|付了/,effect:/效果|反馈/} as const
const participantRejectionMetricNoun='(?:率|比例|占比|数量|人数|次数|总数|总量|汇总|合计|统计|数据|趋势|分布|明细|报表|指标|名单|列表|表格)'
const participantRejectionReportNoun='(?:分析|情况|结果|状态|记录|报告|清单|详情|概况|总结|小结)'
const aggregateParticipantRejection=new RegExp(`(?:回绝|拒绝|否决)(?!了)\\s*(?:${participantRejectionMetricNoun}|${participantRejectionReportNoun})|(?:回绝|拒绝|否决)(?!了)[^。！？]{0,40}(?:的)?(?:${participantRejectionMetricNoun}|${participantRejectionReportNoun})`)
const perfectiveRejectedReportObject=new RegExp(`^(?:明确)?(?:回绝|拒绝|否决)\\s*[^。！？]{0,40}${participantRejectionReportNoun}了$`)
const aggregateBeforePerfectiveRejectedReport=new RegExp(`^(?:明确)?(?:回绝|拒绝|否决)\\s*[^。！？]{0,40}(?:${participantRejectionMetricNoun}|情况|结果|状态|记录|清单|详情|概况|总结|小结)[^。！？]{0,20}报告了$`)
const concreteParticipantRejection=(rest:string)=>{
 const lead=rest.split(/(?:，|,|；|;|但(?:是)?|不过|然而|可是)/,1)[0]?.trim()??''
 const match=/^(明确)?(?:回绝|拒绝|否决)(?:了)?(.*)$/.exec(lead)
 const perfectiveObject=perfectiveRejectedReportObject.test(lead)&&!aggregateBeforePerfectiveRejectedReport.test(lead)
 return Boolean(match&&(match[1]||match[2]?.trim())&&(!aggregateParticipantRejection.test(lead)||perfectiveObject))
}
const aggregateParticipantRejectionOnly=(context:string,rest:string)=>aggregateParticipantRejection.test(context)&&!concreteParticipantRejection(rest)
function participantDimensionText(text:string,words:RegExp){
 const parts=text.split(participantDimensionBoundary),selected=parts.filter(part=>words.test(part))
 return (selected.length?selected:parts).join('；')
}
function participantReport(text:string){
 const body=text.replace(/^(?:回来反馈|状态更新|反馈|更正(?:并区分[^：:]{0,12})?|接着[^：:。！？]{1,40}(?:的事|事项))[:：]\s*/,'')
 const match=new RegExp('^((?:另一位|这位|那位|一位)?'+participantActor+'(?:[甲乙丙丁A-Z])?)(.*)$').exec(body)
 if(!match)return null
 const rest=match[2]!.replace(/^(?:后来|已经|刚才|实际|这次|本次|刚刚|又|仍然)+/,'')
 const indirect=new RegExp('(?:说|听说|提到)[^。！？]*'+participantActor+'[^。！？]*(?:回复|回应|读|看过|采用|付款|试过|试用)').test(rest)
 return {body,actor:match[1]!,rest,indirect}
}
// Feedback metadata uses the same protected clauses and participant parser as
// response readback. These labels annotate testimony; they never add facts.
export function reportedExternalFeedback(text:string){
 type Status='positive'|'negative'|'reported'|'none'|'unknown'
 const byActor=new Map<string,{actor:string|null;status:Status;quote:string}>()
 for(const clause of scanUserClauses(text)){
  if(clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.codeSpans.length)continue
  const body=clause.text.trim().replace(/^(?:但|不过|更正[:：]?|本人更正[:：]?)/,'')
  const report=participantReport(body)
  const received=/^(?:我|本人)?(?:还|仍|也|已经|已|刚)?(?:没(?:有)?|尚未|还未|未)?(?:收到|得到|获得|被)/.test(body)&&/反馈|评价|表扬|夸|批评|认可|拒绝/.test(body)
  const unknown=/^(?:我|本人)?(?:还|仍)?(?:不知道|不确定|不清楚)|^(?:可能|也许|好像|似乎)/.test(body)||/(?:有没有|是否).{0,12}(?:评价|反馈|表扬|夸|批评)/.test(body)
  const absent=/(?:没(?:有)?|尚未|还未|未)(?:能)?(?:收到|得到|获得|被).{0,16}(?:反馈|评价|回复|回应|表扬|夸|批评|认可)|(?:没(?:有)?|尚未|还未|未)(?:给我|作出|提供)?(?:反馈|评价|回复|回应)/.test(body)
  const direct=report&&!report.indirect&&/^(?:说|表示|评价|反馈|夸|批评|认为|觉得|回复|回答|回应|确认|采用|使用|用了)/.test(report.rest)
  if(report&&new RegExp(participantActor+'(?:说|评价|反馈|夸|批评)').test(report.rest))continue
  if(!received&&!direct&&!absent&&!unknown)continue
  if((unknown||absent)&&!/反馈|评价|回复|回应|表扬|夸|批评|认可/.test(body))continue
  const actor=report?.actor??new RegExp(participantActor).exec(body)?.[0]??null
  const negative=/不好|不满意|不清楚|不充分|不合格|未通过|批评|拒绝|有问题/.test(body)
  const positive=/不错|很好|挺好|满意|清楚|有用|认可|表扬|夸|肯定|采用|使用|用了/.test(body)
  const status:Status=unknown?'unknown':absent?'none':negative?'negative':positive?'positive':'reported'
  byActor.set(actor??'unspecified',{actor,status,quote:clause.text})
 }
 const reports=[...byActor.values()],present=reports.filter(report=>['positive','negative','reported'].includes(report.status))
 const statuses=new Set(present.map(report=>report.status))
 const status:Status=present.length?(statuses.size===1?present[0]!.status:'reported'):reports.length&&reports.every(report=>report.status==='none')?'none':'unknown'
 return {status,reports}
}
export function reportedOutcomeSourceClauses(text:string,scanned=scanUserClauses(text)){
  // A comma-separated status list belongs to the request from “把/将” through
  // its enumeration terminator. Actor-prefixed labels are not new reports.
  const requestRanges=scanned.filter(c=>!c.quoted&&!c.code&&!c.conditional&&!c.attributedToOther&&(/^(?:请|麻烦)?(?:把|将).{0,12}(?:已发|已读|已回复|是否采用|实际效果)/.test(c.text)||/^(?:请|麻烦)?(?:按|依据|根据)[^。！？\n]{0,40}(?:状态|已发|已读|已回复|是否采用|实际效果)/.test(c.text))).map(start=>({start:start.start,end:scanned.find(c=>c.start>=start.start&&c.sentenceStart===start.sentenceStart&&/(?:分开|分别|逐项)(?:说|说明|列出|展示|呈现)/.test(c.text))?.end??start.sentenceEnd}))
  return scanned.filter(c=>!requestRanges.some(range=>c.start>=range.start&&c.start<range.end)
    &&!c.interrogative&&!c.conditional&&!c.quoted&&!c.code&&!c.quoteSpans.length
    &&!assistantRequestClause(c.text)&&!/^(?:已发|已读|已回复|是否采用|实际效果)$/.test(c.text.trim()))
}
export function reportedTaskOutcomeClauses(text:string,continuingOwnedTask=false,allowReportedContext=false){
  const scanned=scanUserClauses(text),clauses=reportedOutcomeSourceClauses(text,scanned)
  // Context-only retention preserves an explicitly reported participant state;
  // it does not assert the student sent anything or completed an action.
  const taskKnown=continuingOwnedTask||reportedCompletedContactClauses(text).length>0||clauses.some(c=>!c.attributedToOther&&/(?:我|本人).{0,30}(?:请教|联系|发送|发了|交付|交给|提交|访谈|聊过|问了|问过)/.test(c.text))
  if(!taskKnown&&!allowReportedContext)return []
  return clauses.flatMap(c=>{
   const report=participantReport(c.text)
   const rejectionContext=text.slice(c.start,Math.min(text.length,c.end+24))
   const direct=report&&!report.indirect&&!aggregateParticipantRejectionOnly(rejectionContext,report.rest)&&/(?:回复|回应|没回|答复|回绝|拒绝|否决|已读|读到|读过|看过|采用|使用|用了|试过|试用|不适合|打不开|收到|付款|付费|评价|反馈|夸|批评)/.test(report.rest)
   if(!taskKnown&&!direct)return []
   if(report?.indirect)return []
   const legacy=/^(?:实际)?效果(?:是|为|[:：]|很|不|没|有|尚|未知)/.test(c.text)
    ||/^(?:对方|客户|学长(?:[\u4e00-\u9fa5A-Z]{1,3})?|学姐(?:[\u4e00-\u9fa5A-Z]{1,3})?|导师(?:[\u4e00-\u9fa5A-Z]{1,3})?|他们|她们|他|她)(?:说|回答|回复|确认)[^，。！？]{1,200}$/.test(c.text)||(/^(?:对方|客户|学长(?:[\u4e00-\u9fa5A-Z]{1,3})?|学姐(?:[\u4e00-\u9fa5A-Z]{1,3})?|导师(?:[\u4e00-\u9fa5A-Z]{1,3})?|他们|她们|他|她|费用)?(?:说|觉得)?(?:[一二三四五六七八九十两\d]+(?:天|周|小时|分钟))?(?:已经|还|仍|也|但|并|是否|没有|尚未|未|没|觉得|听起来|看过|读过|读到|已读|有兴趣)/.test(c.text)&&/(?:读了|读过|读到|看过|已读|回复|回应|没回|采用|使用|用了|用过|会不会用|没用|付款|付费|付钱|没付|感兴趣|有兴趣|有意思|效果|反馈)/.test(c.text))
   if(!direct&&!legacy)return []
   // Keep the participant's adjacent future commitment with its speaker.
   let end=c.end
   if(allowReportedContext&&report&&/^(?:回复|回答|说|确认)/.test(report.rest)){
    const index=scanned.findIndex(clause=>clause.start===c.start)
    for(const next of scanned.slice(index+1)){
     if(next.sentenceStart!==c.sentenceStart||!/^[，,\s]*$/.test(text.slice(end,next.start))||next.conditional||next.interrogative||next.quoted||next.code||next.quoteSpans.length||next.codeSpans.length||new RegExp('我|本人|'+participantActor).test(next.text)||!(/^(?:(?:这|本|下)(?:周|月)|明天|后天|之后|稍后|届时)/.test(next.text)||/^(?:但|并|还|仍)?(?:没(?:有)?|尚未|未)(?:评价|评估|评论)(?:内容|材料|作品|方案)?$/.test(next.text)))break
     end=next.end
    }
   }
   return [{...c,end,text:text.slice(c.start,end)}]
  })
}
export function reportedPerformedTaskClauses(text:string){
 return anchorablePersonalClauses(text).filter(c=>!embeddedOtherActorAction(c.text)&&/(?:我|本人)/.test(c.text)&&/(?:发出去了|发出了|发出(?:那个|这个)?(?:问题|消息|邮件|资料|材料)了|发了|交给.{0,10}了|交付了|提交了|问了|问过|聊过|访谈了|已经尝试|尝试了|试做了|开始尝试)/.test(c.text)&&!/(?:想|打算|准备|计划|希望|考虑|愿意|决定|如果|还没|没有|尚未|未曾|没)(?:.{0,40})(?:发出|发了|交给|交付|提交|问|聊|访谈|尝试|试做)/.test(c.text))
}
// Reuse the ownership/intent guards; an attempt or a channel noun is not a send.
const inlineContactFailure=/^(.+?)(?:但|不过|然而|可是)(?:其实)?((?:(?:发送|发出|提交|交付)(?:失败|没(?:有)?成功)|没(?:有)?发(?:成功)?))$/
function directCompletedContactClauses(text:string){
 return anchorablePersonalClauses(text).filter(c=>{
  const source=inlineContactFailure.exec(c.text)?.[1]??c.text
  const body=source.replace(/^(?:(?:回来反馈|状态更新)[：:]\s*)?(?:(?:昨天|今天|刚才|后来|之后)\s*)?/,'')
  return !embeddedOtherActorAction(source)&&/^(?:(?:回来反馈|状态更新)[：:]\s*)?(?:(?:昨天|今天|刚才|后来|之后)\s*)?(?:我|本人|按上次)/.test(source)&&(/(?:发出去了|发出了|发出(?:那个|这个)?(?:问题|消息|邮件|资料|材料)了|发了(?:.{0,20})(?:邮件|消息|短信|问题|PDF|链接|作品集|资料|材料|报告|报名表|表格|文档|申请|作业)|(?:PDF|链接|作品集|资料|材料|报告|报名表|表格|文档|申请|作业).{0,12}发给.{0,12}了|交给.{0,20}了|交付了|提交了|联系了|发送了)/.test(source)||/^(?:我|本人)(?:现在|刚才|已经|已|只|仅){0,3}(?:补齐|整理|完成|核对|修改)了[^。；！？，,]{1,40}(?:并且?|随后)(?:发给|发送给|交给)(?:了)?(?:同学|室友|导师|老师|助教|朋友|客户|对方)(?:了)?$/.test(participantDimensionText(body,/发出|发送|发给|发了|联系|交给|交付|提交/)))&&!participantUncertainty.test(participantDimensionText(source,/发出|发送|发给|发了|联系|交给|交付|提交/))&&!/(?:想|打算|准备|计划|希望|考虑|愿意|决定|还没|没有|尚未|未曾|没|尝试|试做).{0,40}(?:发出|发了|发给|联系|发送|交给|交付|提交)/.test(source)
 })
}
export function reportedFailedContactClauses(text:string){
 const scanned=scanUserClauses(text)
 return reportedOutcomeSourceClauses(text,scanned).flatMap(c=>{
  if(c.attributedToOther||c.codeSpans.length||embeddedOtherActorAction(c.text))return []
  const correction=inlineContactFailure.exec(c.text)
  const body=correction?correction[2]!:c.text
  const failure=/^(?:我|本人)?(?:但|不过|然而|可是)?(?:其实|确实|还|随后|后来|结果)?(?:邮件)?(?:(发送|发出|提交|交付)(?:失败|没(?:有)?成功)|没(?:有)?发(?:成功)?)$/.exec(body)
  if(!failure)return []
  const own=!correction&&/^(?:我|本人)/.test(c.text)
  const previous=correction?{...c,text:correction[1]!}:scanned[scanned.findIndex(part=>part.start===c.start)-1]
  const verb=failure[1],compatible=verb==='提交'?/提交/:verb==='交付'?/交付|交给/:/发给|发了|发送|发出/
  if(own&&previous&&directCompletedContactClauses(previous.text).length&&!compatible.test(previous.text))return []
  if(!own&&(!previous||previous.quoted||previous.code||previous.conditional||previous.attributedToOther||previous.quoteSpans.length||previous.codeSpans.length||!compatible.test(previous.text)||!directCompletedContactClauses(previous.text).length))return []
  return [{...c,contactSourceStart:own?c.start:previous!.start}]
 })
}
export function reportedCompletedContactClauses(text:string){
 const failed=new Set(reportedFailedContactClauses(text).map(clause=>clause.contactSourceStart))
 return directCompletedContactClauses(text).filter(clause=>!failed.has(clause.start))
}
export function requestedQuestionEditClauses(text:string){
 const editStart=/^(?:我想把(?:验证问题|访谈问题|提问|这个问题)|把(?:上次的|这个)?问题)改成/
 const clauses=scanUserClauses(text).flatMap(clause=>{
   const colon=clause.text.search(/[：:][\t \u3000]*(?=(?:我想把(?:验证问题|访谈问题|提问|这个问题)|把(?:上次的|这个)?问题)改成)/)
   if(colon<0||!/访谈(?!问题)/.test(clause.text.slice(0,colon)))return [clause]
   const right=clause.text.slice(colon+1),leadingSpace=/^[\t \u3000]*/.exec(right)?.[0].length??0
   const rightStart=clause.start+colon+1+leadingSpace
   return [
    {...clause,text:clause.text.slice(0,colon),end:clause.start+colon},
    {...clause,text:right.slice(leadingSpace),start:rightStart},
   ]
 })
 const firstPersonQuestionContinuation=/^(?:我|我们|本人)(?:(?:还)?(?:可以|能)(?:为(?:你|对方|客户|用户))?(?:提供)?什么(?:帮助|支持)|(?:(?:还)?(?:可以|能|应该|该))?(?:怎么|如何)(?:帮助|支持)(?:你|对方|客户|用户)?)/
 return clauses.flatMap((first,index)=>{
   if(first.conditional||first.quoted||first.code||first.attributedToOther||!editStart.test(first.text))return []
   let last=first
   for(const following of clauses.slice(index+1)){
    const rawBody=following.text.trim()
    const commandBody=following.text.trim().replace(/^(?:并且?|同时|另外|顺便)(?:也|还|再)?/,'')
    const linkedIntervieweeQuestion=/^(?:你|您|对方|客户|用户)(?:上次|当时|后来|之后|那时|具体|最终|实际|还|又|再|为什么|怎么|如何|是否|有没有|能否|会不会|愿不愿意|对(?:此|这件事|这个)|(?:觉得|认为)(?:这个|这样|这次|当时))/.test(commandBody)
    const nounQuestion=/^([^，。；！？]{1,16})(?:是(?:什么|哪些)|有(?:什么|哪些|多少)|包括(?:什么|哪些))$/.exec(commandBody)
    const nounHead=nounQuestion?.[1]?.trim()??''
    const linkedNounQuestion=Boolean(nounQuestion&&(first.text.includes(nounHead)||/^(?:(?:(?:这|那)(?:件事|次|个)?|其)的?)?(?:(?:主要|具体|真正|最大|最关键)的?)?(?:原因|理由|结果|影响|困难|问题|障碍|顾虑|需求|感受|想法|变化|收获|教训|目标|期望|做法|步骤|方法|选择|下一步)$/.test(nounHead)))
    const linkedSubjectlessQuestion=/^(?:(?:以及|并(?:且)?|同时|另外|然后|接着|当时|后来|之后|那时)|(?:为什么|怎么|如何)(?:会)?(?:这样|这么|那么|选择|处理|解决|应对|决定|做|想))/.test(rawBody)
      ||linkedNounQuestion
    const questionContinuation=firstPersonQuestionContinuation.test(commandBody)||following.interrogative&&(linkedIntervieweeQuestion||linkedSubjectlessQuestion)
    if(following.sentenceStart!==first.sentenceStart||following.attributedToOther||!questionContinuation||otherActorClause(commandBody,{allowOmittedSubject:true})&&!linkedIntervieweeQuestion||editStart.test(following.text)||/访谈(?!问题)/.test(following.text)||assistantRequestClause(commandBody)||deliverableIntent(commandBody,'create')||deliverableIntent(commandBody,'modify')||!questionContinuation&&Boolean(firstPersonalActor(commandBody)||jointPersonalActorClause(commandBody)))break
    last=following
   }
   const matter=clauses.slice(0,index).filter(clause=>clause.sentenceStart===first.sentenceStart&&/访谈(?!问题)/.test(clause.text)).at(-1)
   return [{...first,end:last.end,text:text.slice(first.start,last.end),matterStart:matter?.start??first.sentenceStart}]
 })
}
 export type RequestedQuestionEditMemory={text:string;sourceId:string;conversationId?:string;sourceOrder?:number;createdAt?:string;contextText?:string}
export type RequestedQuestionEditResolution=
 |{status:'none';candidateCount:0;sourceCount:0}
 |{status:'ambiguous';candidateCount:number;sourceCount:number}
 |{status:'selected';candidateCount:number;sourceCount:1;question:string;sourceId:string}
function preciseInstant(value:string):{second:number;fraction:string}|null{
 const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
 if(match){
  const second=Date.parse(match[1]!+match[3]!)
  return Number.isFinite(second)?{second,fraction:(match[2]??'').padEnd(9,'0').slice(0,9)}:null
 }
 const parsed=Date.parse(value)
 return Number.isFinite(parsed)?{second:parsed,fraction:''}:null
}
function comparePreciseInstants(left:string,right:string):number|null{
 const a=preciseInstant(left),b=preciseInstant(right)
 if(!a||!b)return null
 if(a.second!==b.second)return a.second-b.second
 return a.fraction===b.fraction?0:a.fraction>b.fraction?1:-1
}
export function interveningInterviewTexts<T extends {text:string;sourceId:string;createdAt:string;sourceOrder?:number}>(items:readonly T[],selected:T):string[]{
 return items.filter(item=>{
  const duplicateSelectedRow=item.sourceId===selected.sourceId&&item.text===selected.text&&item.createdAt===selected.createdAt&&item.sourceOrder===selected.sourceOrder
  const order=comparePreciseInstants(item.createdAt,selected.createdAt)
  const laterInSameSource=order===0&&item.sourceId===selected.sourceId&&Number.isFinite(item.sourceOrder)&&Number.isFinite(selected.sourceOrder)&&item.sourceOrder!>selected.sourceOrder!
  const unorderedDifferentSource=order===0&&item.sourceId!==selected.sourceId
  return !duplicateSelectedRow&&order!==null&&(order>0||laterInSameSource||unorderedDifferentSource)
 }).map(item=>item.text)
}
const interviewMatterPatterns:[string,RegExp][]=[
 ['employment',/(?:就业|求职|找工作|岗位|投递|面试|实习)/],
 ['entrepreneurship',/(?:创业|产品|用户|客户|需求)/],
 ['course',/(?:课程|课设|课堂|作业|小组项目|课程项目)/],
 ['research',/(?:科研|导师|论文|实验室|研究项目)/],
 ['exam',/(?:考试|备考|考研|考公|四级|六级|CET[-_ ]?[46])/i],
 ['campus',/(?:社团|竞赛|比赛|校园活动)/],
]
const interviewMatterIdentities=(text:string)=>interviewMatterPatterns.filter(([,pattern])=>pattern.test(text)).map(([identity])=>identity)
const genericInterviewLabel=/^(?:上次|这次|本次|之前|先前|继续|接下来|用户|一次|一轮|这个|那个)$/
function explicitInterviewMatterLabels(text:string):string[]{
 const labels:string[]=[]
 for(const match of text.matchAll(/([\p{Script=Han}A-Za-z0-9_-]{2,24}?)(?:的)?访谈(?!问题)/gu)){
  const label=match[1]!.replace(/^(?:请帮我|麻烦帮我|请|麻烦|帮我|后来|随后|然后|我想|我(?:要|在|做了|进行了)?|还是|继续|接下来|回到|关于|针对|做|进行|上次|这次|本次|之前|先前)+/,'').replace(/^的/,'').replace(/(?:这边|方面)$/,'')
  if(label.length>=2&&!genericInterviewLabel.test(label))labels.push(label)
 }
 return [...new Set(labels)]
}
function specificInterviewLabelIdentity(text:string):string|null{
 const compact=text.replace(/[\s_-]/g,'')
 // In an interview label these are human participant roles, not exam aliases.
 // Exam intent must be named as 考研/考公; otherwise a graduate-student or
 // civil-servant interview can steal an unrelated exam-preparation edit.
 if(/^(?:研究生|公务员)$/.test(compact))return null
 const identity=canonicalExamMatterIdentity(text)
 return identity&&(identity.startsWith('course:')?identity:'exam:'+identity)
}
function sameExplicitInterviewIdentity(left:string,right:string):boolean{
 const leftLabels=explicitInterviewMatterLabels(left),rightLabels=explicitInterviewMatterLabels(right)
 if(!leftLabels.length||!rightLabels.length)return false
 return leftLabels.some(a=>rightLabels.some(b=>a===b||Boolean(specificInterviewLabelIdentity(a)&&specificInterviewLabelIdentity(a)===specificInterviewLabelIdentity(b))))
}
// A noun after 访谈 is an artifact or preparation object unless the user also
// supplies an actual interview verb (访谈了/过). This positive boundary keeps
// open-ended artifacts such as 对象名单 and 招募表 out of chronology without
// maintaining another noun catalogue.
const completedInterviewTail='(?=$|(?:但|可是|不过|然而|而且|并且|后来|随后|然后|接着))'
const interviewParticipantQuantity='(?:[一二两三四五六七八九十百\\d]+(?:个|位|名)?|几(?:个|位|名)|多(?:个|位|名)|一些)'
const interviewCompletionAspect='(?:了|过|完(?:了)?|好(?:了)?)'
const completedInterviewVerb=`(?:访谈|采访)${interviewCompletionAspect}`
const completedInterviewAction=`(?:做|进行)?${completedInterviewVerb}`
const objectFrontedCompletedInterview='(?:把|将)[^，。；！？]{0,24}?(?:访谈|采访)[^，。；！？]{0,12}?(?:做|进行)?(?:完(?:了)?|好(?:了)?|完成了)'
// Quantity-before-aspect is an occurrence only when the bounded object ends in
// a human participant head. This positive grammar rejects any open artifact
// predicate (名单打印了、招募表更新了) without maintaining a verb blacklist.
const interviewParticipantPhrase='(?:[^，。！？；的了过]{0,12}(?:者|员|生|师|友|人)|(?:访谈|采访)?对象|客户|用户|同学|老师|导师|校友|商家|居民|家长)'
const quantifiedCompletedInterview=`(?:访谈|采访)${interviewParticipantQuantity}${interviewParticipantPhrase}(?:了|过)${completedInterviewTail}`
const openHumanInterviewQuantity='(?:[一二两三四五六七八九十百0-9]+(?:位|名)|几(?:位|名)|多(?:位|名))'
const openQuantifiedCompletedInterviewPattern=new RegExp(`(?:访谈|采访)${openHumanInterviewQuantity}([^，。！？；的了过]{1,16}?)(?:了|过)${completedInterviewTail}`)
const openQuantifiedCompletedInterview=(text:string)=>openHumanOtherActor(openQuantifiedCompletedInterviewPattern.exec(text)?.[1])
const directCompletedInterviewSubject=new RegExp(`^([^，。；！？]{1,20}?)(?:访谈|采访)${interviewCompletionAspect}`)
const directOpenOtherInterviewSubject=(text:string)=>{const view=text.slice(leadingActionTimeLength(text)),actor=directCompletedInterviewSubject.exec(view)?.[1];return openHumanOtherActor(actor)||openNonHumanOtherActor(actor)||openDirectOtherActor(actor)}
const interviewOccurrence=new RegExp(`做完[^。！？；]{0,24}(?:访谈|采访)${completedInterviewTail}|${objectFrontedCompletedInterview}|(?:做(?:完)?|进行|完成|开始|参加|主持|开展|组织)(?:了|过)[^。！？；]{0,24}(?:访谈|采访)${completedInterviewTail}|${completedInterviewVerb}[^。！？；]{0,24}|${quantifiedCompletedInterview}|(?:访谈|采访)(?:已经|已)?(?:开始|完成|结束)了`)
const observedOtherInterviewPattern=new RegExp(`^(?:我|本人|我们)(?:看到|看见|发现|得知|听说|记录到)(?:了)?([^，。；！？]{1,24}?)${completedInterviewVerb}`)
const laterSelfInterviewPattern=new RegExp(`(?:后|随后|然后|接着)[^，。；！？]{0,16}(?:我|本人|我们|自己)(?!的)(?:(?:又|再|亲自|独立|共同|一起)\\s*)*${completedInterviewAction}`)
const nestedCompletedInterviewPattern=new RegExp(completedInterviewVerb)
const guidedSelfInterviewPattern=new RegExp(`(?:指导|辅导)(?:我|本人|我们)(?:(?:亲自|独立|一起|共同)\\s*)?${completedInterviewAction}`)
const inlineReflexiveSelfInterviewPattern=new RegExp(`^(?:我|本人|我们)(?:看到|看见|发现|得知|听说|记录到)(?:了)?[^，。；！？]{1,24}?${completedInterviewVerb}[^，。；！？]{0,24}?后[，,]?\\s*(?:我|本人|我们|自己)(?!的)(?:(?:又|再|随后|然后|接着)\\s*)?(?:(?:亲自|独立|共同|一起)\\s*)?${completedInterviewAction}`)
const reflexiveSelfInterviewPattern=new RegExp(`^自己(?:(?:又|再|随后|然后|接着)\\s*)?(?:亲自|独立|共同|一起)?\\s*${completedInterviewAction}`)
const observedOtherInterview=(text:string)=>{
 const match=observedOtherInterviewPattern.exec(text)
 if(!match||/(?:我|本人|我们|自己)(?:(?:亲自|独立|共同|一起)\s*)?$/.test(match[1]!.trim()))return false
 return !laterSelfInterviewPattern.test(text.slice(match.index+match[0].length))
}
const embeddedOtherInterview=(text:string)=>{
 const outer=/^(?:我|本人|我们)(?:(?!(?:访谈|采访))[^，。；！？]){1,48}?(?:了|过|完(?:了)?|好(?:了)?)/.exec(text)
 if(!outer)return false
 const tail=text.slice(outer[0].length)
 const openActor=/^([^，。；！？]{1,20}?)(?:访谈|采访)(?:了|过|完(?:了)?|好(?:了)?)/.exec(tail)?.[1]??''
 if(!nestedCompletedInterviewPattern.test(tail)||!(otherActorClause(tail,{allowOmittedSubject:true})||boundedOtherActorPhrase(openActor)||openNestedOtherActor(openActor)))return false
 return !laterSelfInterviewPattern.test(tail)
}
export const reportsInterviewOccurrence=(text:string)=>{
 let ownerSentence=-1
 let previousOwned:boolean=false,previousSentence:number=-1,observedOtherSentence=-1
 for(const clause of scanUserClauses(text)){
  if(clause.conditional||clause.quoted||clause.code||clause.interrogative||clause.attributedToOther){ownerSentence=-1;previousOwned=false;observedOtherSentence=-1;previousSentence=clause.sentenceStart;continue}
  const raw=unprotectedClauseText({...clause,clauseId:'chronology'}).trim(),body=personalReportBody(raw)
  const guidedSelfInterview=guidedSelfInterviewPattern.test(body)
  const inlineReflexiveSelfInterview=inlineReflexiveSelfInterviewPattern.test(body)
  if(observedOtherInterview(body)){ownerSentence=-1;previousOwned=false;observedOtherSentence=clause.sentenceStart;previousSentence=clause.sentenceStart;continue}
  const reflexiveSelfAfterObservation=observedOtherSentence===clause.sentenceStart&&reflexiveSelfInterviewPattern.test(body)
  const explicitSelf=Boolean(firstPersonalActor(body)||jointPersonalActorClause(body)||assistedSelfPerformanceClause(body)||reflexiveSelfAfterObservation||inlineReflexiveSelfInterview)
  const actorView=body.slice(leadingActionTimeLength(body))
  if((otherActorClause(actorView,{allowOmittedSubject:true})||directOpenOtherInterviewSubject(actorView))&&!guidedSelfInterview&&!inlineReflexiveSelfInterview){ownerSentence=-1;previousOwned=false;observedOtherSentence=-1;previousSentence=clause.sentenceStart;continue}
  const temporalContinuation=/^(?:后来|随后|然后|接着|再|又)/.test(raw)||leadingActionTimeLength(raw)>0
  const crossSentenceInherited:boolean=previousOwned&&previousSentence!==clause.sentenceStart&&temporalContinuation
  if(explicitSelf||crossSentenceInherited)ownerSentence=clause.sentenceStart
  const inherited:boolean=temporalContinuation&&(ownerSentence===clause.sentenceStart||crossSentenceInherited)
   if((interviewOccurrence.test(body)||openQuantifiedCompletedInterview(body))&&!embeddedOtherInterview(body)&&!actionEvidenceUnavailable(body)&&!clauseExpressesFuturePlan(body)&&(explicitSelf||inherited))return true
  if(!explicitSelf&&!inherited)ownerSentence=-1
  previousOwned=explicitSelf||inherited
  observedOtherSentence=-1
  previousSentence=clause.sentenceStart
 }
 return false
}
export function interviewOccurrenceConflictsWithContinuation(currentText:string,occurrenceText:string):boolean{
 if(!reportsInterviewOccurrence(occurrenceText))return false
 const currentLabels=explicitInterviewMatterLabels(currentText),occurrenceLabels=explicitInterviewMatterLabels(occurrenceText)
 // A named continuation can safely ignore only a positively different named
 // matter. An unlabeled occurrence remains ambiguous and therefore blocks.
 return !currentLabels.length||!occurrenceLabels.length||sameExplicitInterviewIdentity(currentText,occurrenceText)
}
export function interviewContinuationRequest(text:string):boolean{
 const clauses=scanUserClauses(text).filter(clause=>!clause.conditional&&!clause.quoted&&!clause.code&&!clause.attributedToOther)
 const own=clauses.map(clause=>clause.text).join('；')
 if(!/访谈/.test(own)||!/(?:上次|还是|继续|接下来)/.test(own))return false
 const questions=clauses.filter(clause=>clause.interrogative)
 const continuationQuestion=/^(?:(?:那|然后|接下来|下一步|继续)\s*)?(?:该|应该)?(?:(?:怎么|如何|怎样)(?:继续)?(?:问|聊|访谈|追问)|问(?:什么(?:问题|内容|话题|追问)?|哪(?:个|些)?(?:问题|内容|话题|句|段)?)|是(?:什么|哪一步))(?:(?:比较|更)?(?:好|合适)|呢)?[？?]?$/
 const continuationStatement=/^(?:(?:那|然后|接下来|下一步|继续)\s*)?(?:(?:按|沿用)[^，。；！？]{0,20})?(?:继续)?(?:问|聊|访谈|采访|追问|看(?:哪段|哪个)?回答|核对(?:回答|反馈))/
 const explicitNewTopicStatement=/^(?:(?:那|然后|接下来|下一步|继续)\s*)?(?:继续)?(?:问|聊|追问)(?!\s*(?:下去|这个|那个|该|上次|之前|刚才|什么|哪(?:个|些)?))\s*[^，。；！？]{1,40}[。！]?$/
 if(clauses.some(clause=>!clause.interrogative&&explicitNewTopicStatement.test(clause.text.trim())))return false
 if(questions.length)return questions.every(clause=>continuationQuestion.test(clause.text.trim()))&&clauses.filter(clause=>!clause.interrogative).every(clause=>/访谈/.test(clause.text)||continuationStatement.test(clause.text.trim()))
 return clauses.every(clause=>/访谈/.test(clause.text)||continuationStatement.test(clause.text.trim()))
}
// A globally unique edit is still not a globally applicable edit. An
// explicitly named continuation needs at least the same matter identity in
// the source edit; an unscoped "continue the last interview" may use the sole
// authorized source. This is transient routing only, never a second memory.
export function questionEditMatchesMatter(currentText:string,sourceText:string,interveningTexts:readonly string[]=[]):boolean{
 const currentLabels=explicitInterviewMatterLabels(currentText),sourceLabels=new Set(explicitInterviewMatterLabels(sourceText))
 const laterRelevantOccurrence=interveningTexts.some(text=>interviewOccurrenceConflictsWithContinuation(currentText,text))
 if(reportsInterviewOccurrence(currentText)||laterRelevantOccurrence)return false
 if(/访谈/.test(currentText)&&/(?:上次|还是|继续|接下来)/.test(currentText)&&!requestedQuestionEditClauses(currentText).length&&!interviewContinuationRequest(currentText))return false
 if(!currentLabels.length&&!interviewMatterIdentities(currentText).length&&(sourceLabels.size>0||interviewMatterIdentities(sourceText).length>0)&&!interviewContinuationRequest(currentText))return false
 if(currentLabels.length){
  const broadLabel=/^(?:就业|求职|找工作|创业|用户|客户|科研|考研|考公|备考)$/
  // Explicit labels are the highest-confidence matter identity. Domains that
  // merely occur inside the proposed question must not override them.
  const sourceIdentityText=sourceLabels.size?[...sourceLabels].join(' '):sourceText
  const sourceIdentities=new Set(interviewMatterIdentities(sourceIdentityText))
  return currentLabels.every(label=>{
   if(sourceLabels.has(label))return true
   const specific=specificInterviewLabelIdentity(label)
   if(specific){
    const candidates=sourceLabels.size?[...sourceLabels]:[sourceText]
    return candidates.some(source=>specificInterviewLabelIdentity(source)===specific)
   }
   if(sourceLabels.size)return false
   return broadLabel.test(label)&&interviewMatterIdentities(label).every(identity=>sourceIdentities.has(identity))
  })
 }
 const current=interviewMatterIdentities(currentText)
 if(!current.length)return true
 const source=new Set(interviewMatterIdentities(sourceText))
 return source.size>0&&current.every(identity=>source.has(identity))
}
type RequestedQuestionEditCandidate={
  sourceId:string;conversationId?:string;itemIndex:number;sourceOffset:number;sourceOrder?:number;createdAt?:string
 sourceText:string;matterText:string;effectiveMatterText:string;question:string;referenceRevision:boolean
}
function compareRequestedQuestionEditOrder(left:RequestedQuestionEditCandidate,right:RequestedQuestionEditCandidate):number|null{
 if(left.sourceId===right.sourceId){
  if(Number.isFinite(left.sourceOrder)&&Number.isFinite(right.sourceOrder)&&left.sourceOrder!==right.sourceOrder)return left.sourceOrder!>right.sourceOrder!?1:-1
  if(left.itemIndex===right.itemIndex&&left.sourceOffset!==right.sourceOffset)return left.sourceOffset>right.sourceOffset?1:-1
 }
 if(left.createdAt&&right.createdAt){
  const order=comparePreciseInstants(left.createdAt,right.createdAt)
  if(order!==null&&order!==0)return order>0?1:-1
 }
 return null
}
function uniqueLatestQuestionEdit<T extends RequestedQuestionEditCandidate>(edits:readonly T[]):T|undefined{
 const equivalent=(left:T,right:T)=>left.sourceId===right.sourceId&&left.question===right.question&&left.effectiveMatterText===right.effectiveMatterText
   &&(Number.isFinite(left.sourceOrder)||Number.isFinite(right.sourceOrder)?left.sourceOrder===right.sourceOrder:left.sourceOffset===right.sourceOffset)
 return edits.find(candidate=>edits.every(other=>other===candidate||equivalent(candidate,other)||compareRequestedQuestionEditOrder(candidate,other)===1))
}
const normalizedRequestedQuestion=(text:string)=>text.replace(/^(?:我想把(?:验证问题|访谈问题|提问|这个问题)|把(?:上次的|这个)?问题)改成[:：]?/,'').replace(/^[“「『]|[”」』]$/g,'')
function requestedQuestionEditCandidates(items:readonly RequestedQuestionEditMemory[]):RequestedQuestionEditCandidate[]{
 const raw=items.flatMap((item,itemIndex)=>{
  const contextual=item.contextText&&item.sourceOrder!==undefined?requestedQuestionEditClauses(item.contextText):[]
  return requestedQuestionEditClauses(item.text).map(clause=>{
   const absoluteStart=item.sourceOrder===undefined?undefined:item.sourceOrder+clause.start
   const contextClause=absoluteStart===undefined?undefined:contextual.find(candidate=>candidate.start===absoluteStart)
   const matterText=contextClause&&item.contextText?item.contextText.slice(contextClause.matterStart,contextClause.end):item.text.slice(clause.matterStart,clause.end)
   return {
     sourceId:item.sourceId,conversationId:item.conversationId,itemIndex,sourceOffset:clause.start,
     sourceOrder:absoluteStart,createdAt:item.createdAt,sourceText:clause.text,matterText,effectiveMatterText:matterText,
    question:normalizedRequestedQuestion(clause.text),
    referenceRevision:/^把(?:上次的|这个)问题改成/.test(clause.text),
   }
  })
 })
 const effectiveMatter=(edit:RequestedQuestionEditCandidate,seen=new Set<RequestedQuestionEditCandidate>()):string=>{
  if(seen.has(edit)||!edit.referenceRevision||explicitInterviewMatterLabels(edit.matterText).length||interviewMatterIdentities(edit.matterText).length)return edit.matterText
   const prior=raw.filter(candidate=>(candidate.sourceId===edit.sourceId||Boolean(edit.conversationId&&candidate.conversationId===edit.conversationId))&&compareRequestedQuestionEditOrder(candidate,edit)===-1)
  const predecessor=uniqueLatestQuestionEdit(prior)
  if(!predecessor)return edit.matterText
  seen.add(edit)
  return effectiveMatter(predecessor,seen)
 }
 return raw.map(edit=>({...edit,effectiveMatterText:effectiveMatter(edit)}))
}
export function resolveRequestedQuestionEdit(items:readonly RequestedQuestionEditMemory[],currentText?:string):RequestedQuestionEditResolution{
 const edits=requestedQuestionEditCandidates(items).filter(edit=>edit.question.length>0&&edit.question.length<=300&&(!currentText||questionEditMatchesMatter(currentText,edit.effectiveMatterText)))
 const bySource=new Map<string,(typeof edits)>()
 for(const edit of edits)bySource.set(edit.sourceId,[...(bySource.get(edit.sourceId)??[]),edit])
 if(bySource.size===0)return {status:'none',candidateCount:0,sourceCount:0}
 const distinctMatters=edits.some((left,index)=>edits.slice(index+1).some(right=>
  !questionEditMatchesMatter(left.effectiveMatterText,right.effectiveMatterText)||!questionEditMatchesMatter(right.effectiveMatterText,left.effectiveMatterText)
 ))
 if(distinctMatters)return {status:'ambiguous',candidateCount:edits.length,sourceCount:bySource.size}
 if(bySource.size>1){
  const latest=uniqueLatestQuestionEdit(edits)
  const explicitlySameMatter=edits.every(edit=>explicitInterviewMatterLabels(edit.effectiveMatterText).length>0)
  if(!latest||!latest.referenceRevision&&!explicitlySameMatter)return {status:'ambiguous',candidateCount:edits.length,sourceCount:bySource.size}
  return {status:'selected',candidateCount:edits.length,sourceCount:1,question:latest.question,sourceId:latest.sourceId}
 }
 const sourceEdits=[...bySource.values()][0]!,latestByItem=new Map<number,(typeof edits)[number]>()
 for(const edit of sourceEdits){const existing=latestByItem.get(edit.itemIndex);if(!existing||edit.sourceOffset>existing.sourceOffset)latestByItem.set(edit.itemIndex,edit)}
 let effective=[...latestByItem.values()]
 if(effective.length>1&&effective.every(edit=>Number.isFinite(edit.sourceOrder))){
  const last=Math.max(...effective.map(edit=>edit.sourceOrder!))
  effective=effective.filter(edit=>edit.sourceOrder===last)
 }
 let selected=effective[0]!
 if(effective.length>1){
  selected=[...effective].sort((a,b)=>b.question.length-a.question.length)[0]!
  if(!effective.every(edit=>selected.question.includes(edit.question)))return {status:'ambiguous',candidateCount:edits.length,sourceCount:1}
 }
 return {status:'selected',candidateCount:edits.length,sourceCount:1,question:selected.question,sourceId:selected.sourceId}
}
function selectedRequestedQuestionEditCandidate(items:readonly RequestedQuestionEditMemory[],resolution:RequestedQuestionEditResolution,currentText?:string):RequestedQuestionEditCandidate|undefined{
 if(resolution.status!=='selected')return undefined
 const matching=requestedQuestionEditCandidates(items).filter(edit=>edit.sourceId===resolution.sourceId&&edit.question===resolution.question&&(!currentText||questionEditMatchesMatter(currentText,edit.effectiveMatterText)))
 return uniqueLatestQuestionEdit(matching)??matching[0]
}
export function selectedRequestedQuestionEditMemory<T extends RequestedQuestionEditMemory>(items:readonly T[],resolution:RequestedQuestionEditResolution,currentText?:string):T|undefined{
 const selected=selectedRequestedQuestionEditCandidate(items,resolution,currentText)
 if(selected===undefined)return undefined
 const item=items[selected.itemIndex]
 if(!item||selected.sourceOrder===undefined||selected.sourceOrder===item.sourceOrder)return item
 // The containing evidence range and the selected edit clause are not always
 // coextensive. Chronology compares against the clause that actually won;
 // otherwise an earlier interview in the same source can look later than an
 // edit whose enclosing range starts at zero.
 return {...item,sourceOrder:selected.sourceOrder} as T
}
// Keep the matter used by resolution available to the final continuation
// guard instead of rechecking an unscoped revision's raw source fragment.
export function selectedRequestedQuestionEditMatter<T extends RequestedQuestionEditMemory>(items:readonly T[],resolution:RequestedQuestionEditResolution,currentText?:string):string|undefined{
 return selectedRequestedQuestionEditCandidate(items,resolution,currentText)?.effectiveMatterText
}
export function selectedRequestedQuestionEditSource(items:readonly RequestedQuestionEditMemory[],resolution:RequestedQuestionEditResolution,currentText?:string):{sourceId:string;sourceQuote:string;sourceRange?:{start:number;end:number}}|undefined{
 const selected=selectedRequestedQuestionEditCandidate(items,resolution,currentText)
 if(!selected)return undefined
 return {sourceId:selected.sourceId,sourceQuote:selected.sourceText,...(selected.sourceOrder===undefined?{}:{sourceRange:{start:selected.sourceOrder,end:selected.sourceOrder+selected.sourceText.length}})}
}
export function reportedAdoptionClauses(text:string){
 return anchorablePersonalClauses(text).filter(c=>/^我(?:愿意|(?:先)?准备|打算|决定)(?:先)?(?:试|尝试|问|整理)|^(?:先从|那先).{1,30}(?:开始|整理)/.test(c.text))
}
// Readback of guarded participant reports. Missing dimensions stay unknown;
// these defaults are not newly asserted personal facts or questions to ask.
export function taskOutcomeReadback(text:string,authorizedQuotes?:ReadonlySet<string>,continuingOwnedTask=false,allowReportedContext=false){
 const clauses=reportedTaskOutcomeClauses(text,continuingOwnedTask,allowReportedContext).filter(c=>!authorizedQuotes||[...authorizedQuotes].some(quote=>quote.includes(c.text))),dimensions=['read','response','adoption','payment','effect'] as const
 const result=Object.fromEntries(dimensions.map(k=>[k,{status:'unknown',quote:null as string|null}])) as Record<typeof dimensions[number],{status:string;quote:string|null;conflicting?:boolean;unreported?:boolean}>
 for(const c of clauses){
  const q=c.text
  const readScope=participantDimensionText(q,participantStateFields.read)
  const readCertain=!participantUncertainty.test(readScope)&&!/(?:不是|并非|不代表|不等于|不能(?:证明|说明|确认))|(?:已读|读过|读到|看过)(?:状态)?(?:仍然|仍|还|是)?未知|(?:没(?:有)?|尚未|还未|未)(?:能)?(?:确认|说|说明|告知|报告|反馈|提到).{0,12}(?:读|看)/.test(readScope)
  const responseCertain=!participantUncertainty.test(participantDimensionText(q,participantStateFields.response)),paymentCertain=!participantUncertainty.test(participantDimensionText(q,participantStateFields.payment)),effectCertain=!participantUncertainty.test(participantDimensionText(q,participantStateFields.effect))
  const negativeRead=/(?:没(?:有)?|尚未|还未|未).{0,6}(?:读|看)(?:了|过)?/g,negativeResponse=/(?:没(?:有)?|尚未|还未|未)(?:回复|回应)|没回/g
  const readNo=readCertain&&q.match(negativeRead)!==null,readYes=readCertain&&/读了|读过|读到|看过|已读/.test(q.replace(negativeRead,''))
  const participant=participantReport(q)
  const responseNo=responseCertain&&q.match(negativeResponse)!==null,responseYes=Boolean(participant&&!participant.indirect&&!aggregateParticipantRejectionOnly(participant.rest,participant.rest)&&/^(?:说|觉得|回复|回答|回应|答复|确认|评价|反馈|夸|批评|(?:明确)?(?:回绝|拒绝|否决))/.test(participant.rest))
    ||responseCertain&&/(?:已经|已)(?:明确)?(?:回复|回应)|回复了|回应了/.test(q.replace(negativeResponse,''))
  if(readNo&&readYes)result.read={status:'unknown',quote:null,conflicting:true}
  else if(readNo)result.read={status:'reported_not_read',quote:q}
  else if(readYes)result.read={status:'reported_read',quote:q}
  if(responseNo&&responseYes)result.response={status:'unknown',quote:null,conflicting:true}
  else if(responseNo)result.response={status:'reported_no_response',quote:q}
  else if(responseYes)result.response={status:'reported_response',quote:q}
  const adoptionScope=participantDimensionText(q,participantStateFields.adoption),adoptionCertain=!participantUncertainty.test(adoptionScope)&&!/承诺|打算|计划|会不会/.test(adoptionScope)
  if(adoptionCertain&&/(?:没(?:有)?|尚未|还未|未).{0,6}(?:采用|使用|用过|用了)|还没用|明确(?:说|表示|反馈)?不(?:采用|使用)/.test(q))result.adoption={status:'reported_not_used',quote:q}
  else if(adoptionCertain&&!/试用|试过|试了|尝试|试着/.test(q)&&/(?:已经|已)(?:正式|实际)?(?:采用|使用|用了)|(?:说|表示|确认)(?:已经|已)?(?:采用|使用|用了)/.test(q))result.adoption={status:'reported_used',quote:q}
  else if(/(?:没(?:有)?|尚未|还未|未).{0,8}(?:说|说明|确认).{0,10}采用/.test(q))result.adoption={status:'unknown',quote:q,unreported:true}
  if(paymentCertain&&/(?:没(?:有)?|尚未|还未|未)(?:付款|付费|付)|还没付|没人(?:采用|使用)(?:或|和|也|、)(?:付款|付费)/.test(q))result.payment={status:'reported_unpaid',quote:q}
  else if(paymentCertain&&/(?:已经|已).{0,3}(?:付款|付费)|付了/.test(q))result.payment={status:'reported_paid',quote:q}
  if(/(?:没(?:有)?|尚未|还未|未).{0,8}(?:给|提供|作出)?(?:任何)?(?:效果反馈|反馈效果|反馈)|(?:没(?:有)?|尚未|还未|未).{0,8}(?:说|说明|确认).{0,8}效果/.test(q))result.effect={status:'unknown',quote:q,unreported:true}
  else if(effectCertain&&!/未知|不明|未明|尚不能|未报告/.test(participantDimensionText(q,/效果|反馈/))&&/(?:实际)?效果(?:是|为|[:：]|很|不|没|有|尚)|(?:没有|无|没)效果/.test(q))result.effect={status:'reported_effect',quote:q}
 }
 return result
}

// Interpret only the already-authorized source, without merging actors or
// matters. These derived labels are evidence metadata, never saved new facts.
type ReportedSourceBound={kind:string;quote:string;scope:string;explanationKind?:'explicit_self_explanation';measure?:'elapsed_time'|'questions_count';comparisonBaseline?:'not_implied_by_this_value';alternatives?:{first:string;second:string}}

// A report about another person's expectations cannot erase a different
// personal preference merely because the provider selected that node ID.
// A genuine preference correction needs another owned preference report;
// a shared topic word in someone else's expectation is not that evidence.
export function unrelatedExternalCorrection(previous:string,current:string):boolean{
 const before=reportedEvidenceFromText(previous),after=reportedEvidenceFromText(current)
 return before.preferences.length>0&&after.externalExpectations.length>0&&before.preferences.some(preference=>{
  const subject=preference.subject.replace(/本身$/,'').trim()
  return subject.length>0&&!after.preferences.some(report=>report.subject.replace(/本身$/,'').trim()===subject)
 })
}

export function reportedEvidenceFromText(text:string,ownedPreferenceContext=false){
 const participants=reportedTaskOutcomeClauses(text,false,true).flatMap(clause=>{
  const report=participantReport(clause.text)
  if(!report||report.indirect)return []
  const states=taskOutcomeReadback(clause.text,undefined,true)
  for(const [dimension,matcher] of Object.entries(participantStateFields) as [keyof typeof states,RegExp][]){
    const state=states[dimension]
    // Keep an explicit uncertainty qualification, but never manufacture one
    // merely because this particular source did not mention the dimension.
    if(state.status==='unknown'&&!state.quote&&matcher.test(report.rest)&&participantUncertainty.test(participantDimensionText(report.rest,matcher)))state.quote=clause.text
  }
  const receiptScope=participantDimensionText(report.rest,/收到|送达/),receiptCertain=!participantUncertainty.test(receiptScope)&&!/(?:没(?:有)?|尚未|还未|未).{0,6}(?:确认)?(?:收到|送达)/.test(receiptScope)
  const receipt=receiptCertain&&/(?:确认)?(?:已经|已)?收到|已送达/.test(report.rest)
   ?{status:'reported_received',quote:clause.text}:{status:'unknown',quote:/收到|送达/.test(receiptScope)&&participantUncertainty.test(receiptScope)?clause.text:null}
  const trialScope=participantDimensionText(report.rest,/试过|试用|试了/)
  const trialCertain=!participantUncertainty.test(trialScope)
  const noTrial=/(?:没(?:有)?|尚未|还未|未)(?:试过|试用过|试用了?|试了)/g
  const trialNo=trialCertain&&noTrial.test(report.rest),trialYes=trialCertain&&/(?:试过|试用过|试用了|试了|已(?:经)?试用)/.test(report.body.replace(noTrial,''))
  const trial=trialNo!==trialYes?{status:trialYes?'reported_tried':'reported_not_tried',quote:clause.text}:{status:'unknown',quote:!trialCertain&&/试过|试用|试了/.test(trialScope)||trialNo&&trialYes?clause.text:null,...(trialNo&&trialYes?{conflicting:true}:{})}
  return [{actor:report.actor,quote:clause.text,states:{receipt,trial,...states}}]
 })
 const preferences=reportedPreferenceClauses(text,ownedPreferenceContext).map(clause=>{
  const modality=/不在意/.test(clause.text)?'not_priority':/不想承担|不愿承担/.test(clause.text)?'unwilling':/不喜欢|不享受|享受不了/.test(clause.text)?'dislike':/喜欢|偏好|享受/.test(clause.text)?'like':/愿意/.test(clause.text)?'willing':'priority'
  const subject=personalPreference.exec(clause.text)?.[1]?.trim()??''
  // Only an explicit owned requirement about the SAME literal subject licenses
  // hardening. Other requirements, quotes and hypothetical/third-party wishes
  // do not upgrade a preference. These labels never become stored new facts.
  const requirement=ownedRequirementState(text,subject)
  return {quote:clause.text,subject,modality,...requirement,isRefusal:modality==='unwilling'||modality==='dislike'}
 })
 const externalExpectations=reportedExternalExpectationClauses(text).map(clause=>({quote:clause.text,personalAdoption:'not_inferred_from_external_report',hardConstraint:'not_inferred_from_external_report'}))
 // Keep the measurement and sampling unit beside its original source. An
 // elapsed value is not a change from baseline; a reported count difference
 // remains a report rather than being downgraded to unknown or borrowed by a
 // different source. These are prompt annotations, never new stored facts.
 const clauses=scanUserClauses(text).map(clause=>{
  let visibleText=clause.text
  for(const span of [...clause.quoteSpans,...clause.codeSpans]){
   const start=span.start-clause.start,end=span.end-clause.start
   visibleText=visibleText.slice(0,start)+' '.repeat(end-start)+visibleText.slice(end)
  }
  return {...clause,visibleText}
 })
 const intendedOutcome=(value:string)=>/^(?:(?:我|本人)(?:主要|更|最)?|主要|更|最)?(?:想(?:要|用|了解|更|少|快|省)|希望|期望|期待|打算)/.test(value)
  ||clauseExpressesFuturePlan(value)&&/^(?:(?:我|本人)(?:主要|更|最)?|主要|更|最)?(?:计划|准备)/.test(value)
 const eligibleBound=(c:typeof clauses[number])=>!c.quoted&&!c.code&&!c.conditional&&!c.interrogative&&!c.attributedToOther&&!assistantRequestClause(c.visibleText)
 const prospective=(value:string)=>clauseExpressesFuturePlan(value)||intendedOutcome(value)||/目标|争取|(?:将(?:会|要)?|会)(?:先|在|于|用|把|做|联系|完成|找到|查到|少|多)|预计|预期|未来|明年|下(?:一)?(?:周|月|年)/.test(value)
 const prospectiveClauses=clauses.filter(c=>eligibleBound(c)&&prospective(c.visibleText))
 const owned=anchorablePersonalClauses(text)
 const feedbackScope=/^(?:回来反馈|反馈|状态更新)[:：]/.test(text.trim())?reportedSourceContextClauses(text,[]):[]
 const sourceBounds=clauses.flatMap(clause=>{
  const boundLimit=evidenceInferenceLimit.test(clause.visibleText)&&feedbackScope.some(span=>span.start<=clause.start&&span.end>=clause.end)
  const bounds:ReportedSourceBound[]=[]
  if(!clause.quoted&&!clause.code&&!clause.conditional&&!clause.interrogative&&!clause.quoteSpans.length&&!clause.codeSpans.length&&clause.attributedToOther)bounds.push({kind:'attributed_observation',quote:clause.text,scope:'another_persons_report_not_the_students_own_preference_or_requirement'})
  if(eligibleBound(clause)&&/(?:结果|效果)(?:仍然|仍|还|尚|依然)?(?:是|为)?未知$/.test(clause.visibleText))bounds.push({kind:'unresolved_outcome',quote:clause.text,scope:'explicit_unknown_outcome_not_resolved_by_a_delivery_or_response_state'})
  if(!eligibleBound(clause)&&!(!clause.quoted&&!clause.code&&!clause.conditional&&!clause.interrogative&&!clause.attributedToOther&&boundLimit))return bounds
  // This must precede the measurement-only uncertainty/negation early return.
  // Otherwise the purpose survives the projection while its limit vanishes.
  if(explicitPersonalUncertainty.test(clause.visibleText))bounds.push({kind:'explicit_uncertainty',quote:clause.text,scope:'source_explicitly_leaves_this_dimension_unresolved_not_cancelled_by_adjacent_intent_or_action'})
  if(boundLimit)bounds.push({kind:'inference_limit',quote:clause.text,scope:'user_limit_on_what_this_report_can_support_not_a_global_opposite_conclusion'})
  const previous=clauses[clauses.indexOf(clause)-1]
  const ownedFeelingContinuation=previous&&previous.sentenceStart===clause.sentenceStart&&feedbackScope.some(span=>span.start<=previous.start&&span.end>=clause.end)&&owned.some(other=>other.start===previous.start&&/(?:我|本人)/.test(other.text)&&!embeddedOtherActorAction(other.text))&&/^[，,、\s]*$/.test(text.slice(previous.end,clause.start))&&new RegExp('^(?:仍然|依然|还是|仍|也)(?:很|更|有点|非常|特别)?'+ownedFeelingWords).test(clause.visibleText)
  if(ownedFeelingContinuation)bounds.push({kind:'reported_feeling_only',quote:clause.text,scope:'current_episode_subjective_report_not_inherited_cause_or_stable_trait'})

  // These roles already come from authorized user sources. They preserve
  // subjective explanation/criterion scope even when an extracted memory
  // fragment lacks the original wish verb. They never create stored facts.
  if(ownedFeelingStatement.test(clause.visibleText))bounds.push({kind:'personal_subjective_report',quote:clause.text,...(/(?:主要是|来自|因为|原因(?:是|在于)|的是|在于)/.test(clause.visibleText)&&!/(?:不(?:知道|确定|清楚)|未知|尚未|是否|能否|可能|也许|或许|假设)/.test(clause.visibleText)?{explanationKind:'explicit_self_explanation' as const}:{}),scope:'own_subjective_report_and_its_explicit_explanation_not_causally_joined_to_independent_reports'})
  if(ownedPreferenceContext&&!externalExpectations.some(item=>item.quote===clause.text))bounds.push({kind:'personal_criterion',quote:clause.text,scope:'known_personal_attitude_alone_not_proof_of_task_effect'})
  // A purpose is evidence of what the person wants, never of an achieved
  // effect. Keep its own source even when an observed action follows it.
  if(owned.some(c=>c.start===clause.start)&&intendedOutcome(clause.visibleText))bounds.push({kind:'desired_outcome',quote:clause.text,scope:'reported_intention_not_observed_effect_baseline_or_stable_preference'})
  if(/不|未|没|并非|是否|能否|假设|可能|也许|或许|以为|猜|推测|听说|据说/.test(clause.visibleText))return bounds
  if(/(?:这(?:是|只是)|仅(?:是|为))一(?:条|个)个例|只发生过一次|(?:只|仅)(?:查看|看|了解)(?:了|过)?一(?:位|人|个|条)|(?:这|该)(?:个)?小样本只(?:代表|支持|适用于|说明)/.test(clause.visibleText))bounds.push({kind:'limited_sample',quote:clause.text,scope:'reported_example_only_not_the_category'})
  // A future frame can span a comma, but an explicit later past report opens
  // a different time slice. Do not let an earlier wish erase that outcome.
  const priorFuture=prospectiveClauses.some(c=>c.sentenceStart===clause.sentenceStart&&c.start<clause.start)
  const reportedPastReset=/^(?:后来|当时|实际上|结果|昨天|前天|上周|此前|已经|我已经|我曾经)/.test(clause.visibleText)
  if(prospective(clause.visibleText)||priorFuture&&!reportedPastReset)return bounds
  if(/[零一二两三四五六七八九十百\d]+(?:\.\d+)?\s*(?:秒|分钟|小时)(?:左右|上下)?(?:内|后|就|才|便)?(?:我|本人)?(?:直接|顺利)?(?:找到|查到|取到|打开|完成)/.test(clause.visibleText))bounds.push({kind:'absolute_duration',quote:clause.text,measure:'elapsed_time',comparisonBaseline:'not_implied_by_this_value',scope:'duration_value_alone_does_not_establish_change_or_cause'})
  if(/(?:少|多)(?:问|询问|提问)(?:了我|了)?[一二两三四五六七八九十\d]+(?:次|回)/.test(clause.visibleText))bounds.push({kind:'reported_count_change',quote:clause.text,measure:'questions_count',scope:'preserve_reported_difference_for_this_source_count_alone_does_not_establish_cause'})
  return bounds
 })
 let factorQuote=''
 const factors=unresolvedTwoFactors(text,quote=>{factorQuote=quote})
 if(factors&&factorQuote)sourceBounds.unshift({kind:'unresolved_causal_factors',quote:factorQuote,alternatives:factors,scope:'these_exact_factors_were_unresolved_in_this_source_not_a_retraction_of_other_reported_subjective_explanations'})
 // Guarded participant reports can span adjacent state qualifications.
 // Keep that complete source span instead of re-matching individual clauses.
 sourceBounds.unshift(...participants.filter(report=>Object.values(report.states).some(state=>state.status.startsWith('reported_'))).map(report=>({kind:'reported_observation',quote:report.quote,scope:'reported_event_or_result_not_automatically_its_cause_mechanism_or_stability'})))
 // Priority and exclusion are different axes even in a short summary.
 sourceBounds.unshift(...preferences.filter(item=>item.modality==='not_priority').map(item=>({kind:'nonpriority_not_refusal',quote:item.quote,scope:'reported_priority_level_only_not_a_choice_rejection_or_exclusion'})))
 return {participants,preferences,externalExpectations,sourceBounds}
}

// A request to update only already-stated participant statuses needs no new
// interpretation of identity, causality or sample counts. Project the same
// guarded reports used by the normal evidence pipeline. Mixed requests and
// any source not covered by those reports stay on the ordinary path.
export function currentParticipantStatusReadback(text:string):string|null{
 const scope=responseRequestScope(text)
 const onlyStatus=/^(?:请|麻烦)?(?:只|仅)更新[^，。；！？\n]{0,12}状态(?:就好|即可|就行)?$/
 if(scope.actionRequested||scope.comparisonRequested||scope.summaryRequested||!scope.instructions.length||!scope.instructions.every(c=>onlyStatus.test(c.commandText)))return null
 const reports=reportedEvidenceFromText(text).participants
 if(!reports.length||reports.some(report=>Object.values(report.states).some(state=>'conflicting'in state&&state.conflicting)))return null
 const quotes=[...new Set(reports.map(report=>report.quote))]
 const facts=scanUserClauses(text).filter(c=>!assistantRequestClause(c.text)&&/[\p{L}\p{N}]/u.test(c.text))
 if(!facts.length||facts.some(c=>c.quoted||c.code||c.conditional||c.interrogative||!quotes.some(quote=>quote.includes(c.text))))return null
 const statusLabels:Record<string,string>={reported_response:'已回复',reported_no_response:'未回复',reported_read:'已读',reported_not_read:'未读',reported_used:'已采用',reported_not_used:'未采用',reported_paid:'已付款',reported_unpaid:'未付款',reported_tried:'已试用',reported_not_tried:'未试用'}
 const reply=reports.map(report=>{
  const labels=[...new Set(Object.values(report.states).map(state=>statusLabels[state.status]).filter(Boolean))]
  return `- ${report.actor}：${labels.length?labels.join('、')+'。':''}本次报告：${report.quote}。`
 }).join('\n')
 return completeUserReply(reply,text)?reply:null
}

// A feedback report with new details is not a pure status catalogue. The
// engine can mirror the exact current source clauses while the status-only
// projector remains available for genuine recall requests.
export function exactFeedbackReadback(text:string):string|null{
 if(!/(?:回来反馈|状态更新|反馈[:：])/.test(text))return null
 const reports=reportedEvidenceFromText(text).participants
 if(!reports.length)return null
 const facts=scanUserClauses(text).filter(c=>!assistantRequestClause(c.text)&&/[\p{L}\p{N}]/u.test(c.text))
 if(!facts.length)return null
 const end=facts.at(-1)!.end,terminator=text[end]&&/[。！？!?；;]/.test(text[end]!)?text[end]:''
 const exact=(text.slice(facts[0]!.start,end)+terminator).trim()
 return exact&&completeUserReply(exact,text)?exact:null
}

// A rejection guard for explicit modality promotions, not a semantic oracle.
// Use the same source labels for final prose and provisional model previews.
export function unsupportedPreferenceConstraintClaims(reply:string,evidence:(ReturnType<typeof reportedEvidenceFromText>['preferences'][number]&{source?:{id:string}})[],currentMessageId?:string,currentText?:string){
 const positive=evidence.filter(item=>['priority','like'].includes(item.modality))
 const aliases=(subject:string)=>{
  const values=new Set([subject,subject.replace(/(?:目前|当前|现在|当地|所在)/g,'')])
  for(const value of [...values]){
   const locative=/^(.{1,2})(?:在|到)(.{1,3})$/.exec(value)
   if(locative){values.add(locative[1]!+locative[2]!);if(locative[2]!.length>1)values.add(locative[1]!+locative[2]![0]!)}
  }
  return [...values].filter(value=>value.length>=2)
 }
 const authorized=(subject:string,items:typeof positive)=>{
  const current=currentText?ownedRequirementState(currentText,subject):null
  if(current?.hardRequirementRevocationQuote)return false
  if(current?.hardRequirementQuote)return true
  const currentItems=currentMessageId?items.filter(item=>item.source?.id===currentMessageId):[]
  if(currentItems.some(item=>item.hardRequirementRevocationQuote))return false
  if(currentItems.some(item=>item.hardRequirementQuote))return true
  if(!currentMessageId&&items.some(item=>item.hardRequirementRevocationQuote))return false
  return items.some(item=>Boolean(item.hardRequirementQuote))
 }
 const groups=[...new Set(positive.map(item=>item.subject).filter(Boolean))].map(subject=>({subject,items:positive.filter(item=>item.subject===subject),aliases:aliases(subject)}))
 const failures:string[]=[]
 const currentClauses=currentText?scanUserClauses(currentText).filter(c=>!c.quoted&&!c.code&&!c.conditional&&!c.attributedToOther):[]
 for(const preference of evidence.filter(item=>item.modality==='not_priority')){
  const subjects=aliases(preference.subject)
  const explicitCurrent=currentClauses.some(c=>subjects.some(subject=>c.text.includes(subject))&&/^(?:更正[:：]\s*)?(?:我|本人)(?:现在|目前|明确|已经|决定|确实)*(?:拒绝|排除|不想|不愿|不接受|不考虑)/.test(c.text))
  const currentNonpriority=currentClauses.some(c=>c.text.includes('不在意')&&subjects.some(subject=>c.text.includes(subject)))
  if(explicitCurrent||!currentNonpriority&&evidence.some(item=>item.modality==='unwilling'&&subjects.includes(item.subject)))continue
  for(const clause of scanUserClauses(reply)){
   if(clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.attributedToOther)continue
   const claim=/(?:排除|拒绝)(?:了)?|不接受|不考虑|不愿|不想|不喜欢|不适合|没有兴趣/g
   for(const match of clause.text.matchAll(claim)){
    const prefix=clause.text.slice(0,match.index)
    if(hardClaimNegated(clause.text,match.index!)||/(?:不代表|不意味着|并未|尚未|从未|未曾|未必|不一定|不再|是否).{0,10}$/.test(prefix))continue
    const tail=clause.text.slice(match.index!+match[0].length)
    if(/仍未知|尚未确认|待核实|还不知道/.test(tail))continue
    if(subjects.some(subject=>tail.replace(/^[“「『\"'\* \t]+/,'').startsWith(subject)||tail.startsWith('了'+subject))){failures.push(clause.text);break}
   }
  }
 }
 for(const clause of scanUserClauses(reply)){
  if(clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.attributedToOther)continue
  const hard=/(?:必须|必需|需要|需|务必)(?:同时)?满足|(?:必须|只能|只可|一定要)|必要条件|硬(?:性)?(?:约束|要求|条件|边界)|刚性(?:约束|要求|条件)|不可(?:协商|妥协)的条件/g
  for(const match of clause.text.matchAll(hard)){
   const at=clause.start+match.index!
   if([...clause.quoteSpans,...clause.codeSpans].some(span=>at>=span.start&&at<span.end))continue
   if(hardClaimNegated(clause.text,match.index!))continue
   if(/是否(?:(?:是|为|属于|构成|作为)(?:我|你|本人)?的?)?$/.test(clause.text.slice(0,match.index!)))continue
   const before=clause.text.slice(0,match.index!),after=clause.text.slice(match.index!+match[0].length)
   if(/^(?:先)?(?:了解|确认|核实|评估|研究|调查|弄清|问清|测试|验证|检验|观察|测量)/.test(after.trim())&&!/(?:并且?|且|同时|随后|之后|后)(?:要|须|必须|需要)?满足(?!感|度|率)/.test(after))continue
   const boundary=[...before.matchAll(/但是|不过|然而|但/g)].at(-1)
   const segmentStart=boundary?boundary.index!+boundary[0].length:0
   const claimSegment=clause.text.slice(segmentStart)
   const requirementVerb=/^(?:必须|必需|需要|需|务必)/.test(match[0])
   // In "X is a necessary condition for Y", the requirement is about X.
   // Mentioning a preferred objective as Y does not make that preference
   // itself mandatory. Keep the canonical clause and its existing polarity.
   let requirementSubject=claimSegment
   if(!requirementVerb&&before.endsWith('的')){
    const localBefore=before.slice(segmentStart)
    const copula=[...localBefore.matchAll(/作为|成为|构成|是(?!否)|为/g)].at(-1)
    if(copula&&localBefore.slice(copula.index!+copula[0].length,-1).trim())requirementSubject=localBefore.slice(0,copula.index!)
    else if(!copula)requirementSubject='' // "Y's necessary condition" names Y as the objective, not the condition.
   }
   const mentioned=groups.filter(group=>group.aliases.some(alias=>{
    if(!requirementVerb)return requirementSubject.includes(alias)
    if(after.includes(alias))return true
    return /^(?:的)?(?:条件|要求|边界|约束)(?:之一)?(?:$|[，,；;。])/u.test(after.trim())&&before.includes(alias)
   }))
   const generic=/(?:偏好|意愿|喜好)/.test(requirementSubject)?groups:[]
   const bound=mentioned.length?mentioned:generic
   if(bound.some(group=>!authorized(group.subject,group.items))){failures.push(clause.text);break}
  }
 }
 return failures
}

export function reportedExternalExpectationClauses(text:string){
 const clauses=scanUserClauses(text).filter(clause=>!clause.conditional&&!clause.interrogative&&!clause.quoted&&!clause.code&&!clause.quoteSpans.length&&!assistantRequestClause(clause.text))
 return clauses.flatMap((clause,index)=>{
  const body=clause.text.replace(/^更正[:：]\s*/,'')
  if(!/^(?:我的?)?(?:家里|家人|父母|爸妈|爸爸|妈妈)/.test(body))return []
  const next=clauses[index+1]
  if(next&&next.sentenceStart===clause.sentenceStart&&/^[，,\s]*$/.test(text.slice(clause.end,next.start))&&/^(?:只是|仅仅|仍然|还是)?(?:希望|期待|期望)/.test(next.text))return [{...clause,end:next.end,text:text.slice(clause.start,next.end)}]
  if(/(?:希望|期待|期望|建议|要求)/.test(body))return [clause]
  return []
 })
}

// This is a rejection guard, not proof of overall semantic correctness. Keep
// dimensions and actors separate; no automatic retry or inferred reading.
export function unsupportedParticipantReadingClaims(reply:string,evidence:(ReturnType<typeof reportedEvidenceFromText>['participants'][number]&{source?:{id:string;eventId?:string}})[],scope?:{currentMessageId:string;eventId?:string|null}){
 const failures:{actor:string;dimension:'read'|'receipt';quote:string}[]=[]
 for(const clause of scanUserClauses(reply)){
  if(clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.quoteSpans.length)continue
  const text=clause.text.replace(/^(?:暂定理解(?:是)?|当前理解(?:是)?|当前状态(?:是)?|状态更新)[:：]\s*/,'')
  for(const claim of reportedEvidenceFromText(text).participants){
   const actorSources=evidence.filter(item=>item.actor===claim.actor)
   if(!actorSources.length)continue
   const historical=/^(?:上次|此前|那次)/.test(participantReport(text)?.rest??'')
   // Historical qualifiers cannot manufacture facts: an unbound old report
   // can only support its exact source quote, not a new inferred old state.
   const sources=historical?actorSources.filter(item=>reply.includes(item.quote)):scope?actorSources.filter(item=>item.source?.id===scope.currentMessageId||Boolean(scope.eventId&&item.source?.eventId===scope.eventId)):actorSources
   for(const dimension of ['read','receipt'] as const){
    const positive=dimension==='read'?'reported_read':'reported_received'
    const hasPositive=sources.some(item=>item.states[dimension].status===positive)
    const distinctReports=new Set(sources.map(item=>item.quote)).size
    const ambiguous=distinctReports>1&&sources.some(item=>item.states[dimension].status!==positive)
    if(claim.states[dimension].status===positive&&(!hasPositive||ambiguous))failures.push({actor:claim.actor,dimension,quote:clause.text})
   }
  }
 }
 return failures
}

export function deriveTurnContract(input:{
  text:string
  knowledgeCount:number
  knowledgeIds?:readonly string[]
  requiredKnowledgeCitation?:boolean
  currentEventExists:boolean
  planIntent:boolean
  material:boolean
  readOnly?:boolean
  eventReadOnly?:boolean
}):TurnContract{
  // Ordinary generation offers composable outputs. Only explicit user controls,
  // requested planning and available sources narrow the contract; legacy modes
  // never classify a sentence and close another legitimate output lane.
  const crisis=crisisSupportIntent(input.text),supportOnly=currentConversationOnly(input.text)||crisis
  // The same authority check already discards these writes after generation.
  // Close only unused discussion write lanes upfront; keep requested material,
  // planning and citation delivery on their existing contracts.
  const discussionOnly=!input.material&&!input.planIntent&&profileWritesDisallowed(input.text)
  const capabilities:TurnContractCapabilities={
    growth:!input.readOnly&&!crisis&&!discussionOnly,
    // Experience extraction and star-map updates are program-owned. The main
    // model need not generate a second copy of the same autobiographical span.
    candidate:false,
    plan:!input.readOnly&&!supportOnly&&input.planIntent,
    citations:!input.readOnly&&!supportOnly&&input.knowledgeCount>0,
    event:!input.readOnly&&!input.eventReadOnly&&!supportOnly&&!discussionOnly,
    material:!input.readOnly&&!input.eventReadOnly&&!supportOnly&&!discussionOnly,
  }
  const schema=slimActionCoachSchema(capabilities)
  // These evidence limits belong to the generated answer on every turn,
  // including unmarked follow-ups. Preserve the existing length and lanes.
  const reply=(schema.properties as Record<string,any>).reply
  reply.description=(reply.description??'')+'以本人原话和已核验的具体任务为依据，未提供的保持未知。只报告数量或步骤时，保留其粒度，不把过去建议检查的字段当作本人核对过的项目，也不补感受。没帮助判断只说明本次证据不足，未说明的原因保持未知，不用一次结果断定真正卡点。比较路径不按名称排自主高低、助人远近或反馈快慢，不生成无依据的匹配度排名；任务未知就说明需要核对的具体条件。实际或建议中的单次小验证只提供对该对象的一条线索，不承诺回答整条方向是否适合或值得选。最小尝试限定本次可控起点、投入上限与停点，不保证完成，不替本人接受或安排。保持完整内容、分段和必要加粗。'
  if(capabilities.citations&&input.knowledgeIds){
    // Generation selects from this turn's approved cards. The shared citation
    // validator still owns revision, scope and withdrawal checks at commit.
    const citations=(schema.properties as Record<string,any>).citations
    citations.items={type:'object',properties:{claimId:{type:'string',enum:[...new Set(input.knowledgeIds)]}},required:['claimId'],additionalProperties:false}
    if(input.requiredKnowledgeCitation){citations.minItems=1;(schema.required as string[]).push('citations')}
  }
  return {mode:'ordinary',capabilities,schema,schemaChars:JSON.stringify(schema).length}
}

export function slimActionCoachSchema(capabilities:TurnContractCapabilities):Record<string,unknown>{
  const schema=structuredClone(actionCoachTurnSchema) as unknown as {
    properties:Record<string,unknown>
    required?:string[]
  }
  const properties=schema.properties
  delete properties.decisionProposal
  const action=(properties.event as any)?.properties?.action
  for(const branch of action?.anyOf??[]){
    for(const draft of branch.properties?.draft?.anyOf??[]){
      for(const key of ['readiness','missingRequired','materialFactIds','materialEvidence'])if(draft.properties)delete draft.properties[key]
    }
  }
  // The legacy background lane is never offered under the native growth
  // protocol regardless of mode.
  delete properties.background
  if(!capabilities.growth)delete properties.growthUpdates
  if(!capabilities.candidate||capabilities.growth)delete properties.experienceCandidate
  if(!capabilities.plan)delete properties.weeklyPlan
  if(!capabilities.citations)delete properties.citations
  if(capabilities.material){
    // The full event lane including action.draft stays byte-identical.
  }else if(capabilities.event){
    // Process/nodes/corrections without the material branch.
    const event=properties.event as {properties:Record<string,unknown>}|undefined
    if(event)delete event.properties.action
  }else{
    delete properties.event
  }
  schema.required=['reply']
  bindProcessSourceHandles(schema)
  const event=properties.event as {required?:string[];properties:Record<string,unknown>}|undefined
  if(event){
    if(capabilities.growth)event.required=[...new Set([...event.required??[],'matterReports'])]
    else delete event.properties.matterReports
  }
  // Generate the small factual interpretation before the answer that uses it.
  // A safe lead can still stream first; no extra model call is introduced.
  const order=['lead','growthUpdates','weeklyPlan','event','reply']
  schema.properties=Object.fromEntries([...order.filter(key=>key in properties),...Object.keys(properties).filter(key=>!order.includes(key))].map(key=>[key,properties[key]]))
  return schema as unknown as Record<string,unknown>
}

// Stream the reply before serializing facts and events in the same frame.
export function replyStreamingSchema(schema:Record<string,any>,first:'reply'|'event'='reply',ordinaryAnswerSourceIds?:readonly string[]):Record<string,any>{
  const properties=schema.properties as Record<string,unknown>|undefined
  if(!properties?.reply)return schema
  if(ordinaryAnswerSourceIds){
    const {reply,...metadata}=properties
    return {...schema,required:['answer',...schema.required.filter((key:string)=>key!=='reply')],properties:{answer:ordinaryAnswerWireSchema(reply as Record<string,unknown>,ordinaryAnswerSourceIds),...metadata}}
  }
  if(first==='reply'||!properties[first]){
    const {reply,...metadata}=properties
    return {...schema,properties:{reply,...metadata}}
  }
  const {[first]:grounding,reply,...metadata}=properties
  return {...schema,properties:{[first]:grounding,reply,...metadata}}
}

// Explicit delivery requests must instantiate an artifact, never a bare
// presentation prefix. Clarifications remain legal for incomplete requests.
export function bindMaterialDeliverySchema(contract:TurnContract,text:string,groundedSelection=false,replyBody:boolean|'question_first'=false):TurnContract{
  const quotes=[...new Set(scanUserClauses(text).map(clause=>clause.text).filter(Boolean))]
  const bindQuotes=(node:any)=>{
    if(!node||typeof node!=='object')return
    if(node.properties?.messageId&&node.properties?.quote)node.properties.quote={...node.properties.quote,enum:quotes}
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(bindQuotes);else if(value&&typeof value==='object')bindQuotes(value)
  }
  if(quotes.length)bindQuotes((contract.schema.properties as any)?.event)
  if(groundedSelection){
    // Do not spend material generation on command nodes that validation would
    // discard. The event target may still cite the request; real feedback stays.
    const pursuitQuotes=new Set(reportedPursuitClauses(text).map(clause=>clause.text))
    const reportedQuotes=quotes.filter(quote=>!assistantRequestClause(quote)&&!pursuitQuotes.has(quote))
    const nodes=(contract.schema.properties as any)?.event?.properties?.nodes
    // Intent-only drafting has no new process report. The original intent
    // remains in target/process input sources and the personal growth lane.
    if(nodes&&!reportedQuotes.length)delete (contract.schema.properties as any).event.properties.nodes
    // A saved real response repeated the same report ten times before reaching
    // its artifact and was aborted by the provider. This material lane needs
    // at most one process node per report and one critical unknown; complete
    // source text and the authoritative event history remain available.
    if(nodes)nodes.maxItems=Math.min(nodes.maxItems??24,reportedQuotes.length+1)
    if(nodes?.items?.anyOf)nodes.items.anyOf=nodes.items.anyOf.filter((node:any)=>{
      if(!node.properties?.source)return true
      if(!reportedQuotes.length)return false
      node.properties.source.properties.quote={...node.properties.source.properties.quote,enum:reportedQuotes}
      return true
    })
  }
  const action=(contract.schema.properties as any)?.event?.properties?.action
  if(!groundedSelection)for(const branch of action?.anyOf??[]){
    const draft=branch.properties?.draft
    if(draft?.anyOf)draft.anyOf=draft.anyOf.filter((format:any)=>format.properties?.kind?.const!=='resume_portfolio')
  }
 const singleQuestion=requestsSingleQuestionMaterial(text)
 if(!contract.capabilities.material||(!requiresImmediateMaterial(text)&&!singleQuestion))return {...contract,schemaChars:JSON.stringify(contract.schema).length}
 const schema=structuredClone(contract.schema) as any,event=schema.properties.event
 // The material body has its own validated field and is rendered once by the
 // host. A mandatory nonempty reply makes the model generate it a second time.
 schema.properties.reply={type:'string',minLength:0,maxLength:16000,description:'完整材料只写在event.action.draft；没有额外必要的反馈、提醒或未知时reply用空字符串，不重复材料正文，也不宣布已写好。混合复盘可保留必要回应。'}
 schema.required=[...new Set([...(schema.required??[]),'event'])]
 event.required=[...new Set([...(event.required??[]),'action'])]
 event.properties.action.anyOf=event.properties.action.anyOf.filter((branch:any)=>branch.properties?.draft)
 if(replyBody==='question_first'){
  // Use the original canonical material field; put it before explanatory text
  // so a safe question can stream without waiting for readback/state metadata.
  for(const branch of event.properties.action.anyOf)branch.properties={draft:branch.properties.draft,...Object.fromEntries(Object.entries(branch.properties).filter(([key])=>key!=='draft'))}
  event.properties={action:event.properties.action,...Object.fromEntries(Object.entries(event.properties).filter(([key])=>key!=='action'))}
  schema.properties={event,...Object.fromEntries(Object.entries(schema.properties).filter(([key])=>key!=='event'))}
  schema.properties.reply={type:'string',minLength:1,maxLength:16000,description:'回应本轮读回事实、时间和未知，不重复draft.content中的材料问题。'}
 }else if(replyBody&&!groundedSelection){
  schema.properties.reply={type:'string',minLength:1,maxLength:12000,description:'本轮reply就是完整可使用的材料正文，不另写介绍、已完成声明或第二份正文。draft仅返回fromReply:true，服务器将同一正文保存为材料。'}
  for(const branch of event.properties.action.anyOf)branch.properties.draft={type:'object',properties:{fromReply:{type:'boolean',const:true}},required:['fromReply'],additionalProperties:false}
 }

 if(singleQuestion&&!groundedSelection){
  // Bind the generation rule to the field that actually owns the body. A
  // fromReply draft has no content field; instructions there never reach it.
  let questionDescription='全文恰好一个完整问句，不是一个问句加解释句；除原样保留的引文外不另起第二句，主问的问号后立即结束正文字符串。单个完整问句：围绕一个核心信息缺口，将任务、协作、反馈、投入等所需细节合入同一主问；保留用户指定语言、词数和原文引用，不另起第二个主问，不输出标题、导语、Notes、注释、翻译或补充说明。'
  const wordRanges=new Map<string,{low:number;high:number}>()
  for(const clause of scanUserClauses(text)){
   if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||/^(?:请)?(?:不要|不必|无需|不用|别)/.test(clause.text.trim()))continue
   if(!assistantRequestClause(clause.text)&&!requestsSingleQuestionMaterial(clause.text)&&! /^(?:约|大约)?\d{1,4}\s*[-—–~至到]\s*\d{1,4}\s*(?:词|words?)(?:左右)?$/i.test(clause.text.trim()))continue
   for(const match of clause.text.matchAll(/(\d{1,4})\s*[-—–~至到]\s*(\d{1,4})\s*(?:词|words?)/gi)){
    const at=clause.start+match.index!,low=Number(match[1]),high=Number(match[2])
    if([...clause.quoteSpans,...clause.codeSpans].some(span=>span.start<=at&&at<span.end)||low<1||high<low||high>4000)continue
    wordRanges.set(low+'-'+high,{low,high})
   }
  }
  const quotedQuestions:string[]=[],rawQuotedQuestions:string[]=[]
  for(const clause of scanUserClauses(text)){
   if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||!/保留|逐字|原样/.test(clause.text)||/^(?:请)?(?:不要|不必|无需|不用|别)/.test(clause.text.trim()))continue
   for(const span of clause.quoteSpans){
    const literal=text.slice(span.start,span.end).replace(/^[“\"「『‘]|[”\"」』’]$/g,'')
    if(/[?？]/.test(literal)&&!quotedQuestions.includes(literal)){quotedQuestions.push(literal);rawQuotedQuestions.push(text.slice(span.start,span.end))}
   }
  }
  let questionPattern=quotedQuestions.length===1?'^[^?？\\r\\n]*'+quotedQuestions[0]!.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'[^?？\\r\\n]*[?？]$':quotedQuestions.length===0?'^[^?？\\r\\n]*[?？]$':null
  if(wordRanges.size===1){
   const {low,high}=[...wordRanges.values()][0]!
   questionDescription+='本轮要求'+low+'—'+high+'词，请在同一次生成内按约'+Math.round((low+high)/2)+'词组织完整主问，词数不是字符数；不因只有一个问句而压缩所需内容，不输出词数说明，不靠虚构信息凑词。'
   if(/英文|英语|\bEnglish\b/i.test(text)){
    questionDescription+='Use one governing interrogative clause; keep all requested topics as noun phrases or dependent clauses governed by that same verb. After linking words, continue the dependent structure instead of opening another stand-alone subject-auxiliary inversion. Do not repeat instructions about invention, sending, saving, or formatting in the drafted question; use the word budget for substantive role details and unknown conditions.'
    // One regex expresses the user's whole generation shape. Separate string
    // patterns in allOf were not jointly respected in the real-provider run.
    // This only guides native generation; no validator edits/retries the reply.
    const word='[^?？.!！。\\s]+',space='[ \\t]+'
    if(quotedQuestions.length===0)questionPattern='^(?:'+word+space+'){'+(low-1)+','+(high-1)+'}'+word+'[?？]$'
    else if(quotedQuestions.length===1&&high<=200){
     const literal=rawQuotedQuestions[0]!.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),n=rawQuotedQuestions[0]!.trim().split(/\s+/).length,alternatives:string[]=[],englishWord="[A-Za-z0-9À-ɏ][A-Za-z0-9À-ɏ'’/—–-]*[,;:]?"
     // The literal occupies n words; enumerate only its possible position,
     // leaving all other wording to the same model generation.
     questionDescription+='除逐字保留的引文外，正文全部使用自然、完整的英文，不夹杂中文，不把多个英文词粘在一起。较早引入引用例子，再展开实际任务、协作、反馈、投入与未知，给后半句留足空间。'
     for(let prefix=1;prefix<=Math.min(high-n-1,Math.round((low+high)/4));prefix++){
      const minSuffix=Math.max(1,low-n-prefix),maxSuffix=high-n-prefix
      if(maxSuffix>=minSuffix)alternatives.push('(?:'+englishWord+space+'){'+prefix+'}'+literal+'(?:'+space+englishWord+'){'+minSuffix+','+maxSuffix+'}')
     }
     if(alternatives.length)questionPattern='^(?:'+alternatives.join('|')+')[?？]$'
    }
   }
  }
  delete schema.properties.lead
  schema.required=(schema.required??[]).filter((key:string)=>key!=='lead')
  if(replyBody&&replyBody!=='question_first'){
   schema.properties.reply.description=questionDescription+'完整问题仅在reply生成一次，draft仅为fromReply:true。'
   if(questionPattern)schema.properties.reply.pattern=questionPattern
  }
  else{
   for(const branch of event.properties.action.anyOf){
    const draft=branch.properties?.draft
    for(const body of draft?.anyOf??[draft])if(body?.properties?.content){body.properties.content.description=questionDescription;if(questionPattern)body.properties.content.pattern=questionPattern}
   }
   schema.properties.reply.description=replyBody==='question_first'?'仅回应用户明确请求的读回事实与未知；可分段，不复制材料问题，不加附注或另问。没有依据如实说明当前读取范围未知。':'没有额外明确请求时为空字符串；不介绍材料、不附Notes、不重复问题。'
  }
 }
 return {...contract,schema,schemaChars:JSON.stringify(schema).length}
}

export function requestsSingleQuestionMaterial(text:string){
 return scanUserClauses(text).some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&!clause.quoteSpans.length&&!clause.codeSpans.length&&deliverableIntent(clause.text,'create')&&/(?:一句|一个)[^。！？\n]{0,32}(?:问题|提问)/.test(clause.text))
}

// The authoritative obligation has already resolved the student's current
// event and week. Constrain generation before dispatch; never discard illegal
// model tasks after the fact or ask the student to confirm an explicit zero.
export function bindPlanBudgetSchema(contract:TurnContract,budget:{minutes:number;period:string}|undefined,currentText='',allowedPlanScopes?:readonly string[]):TurnContract{
 if(!budget||!contract.capabilities.plan)return contract
 const schema=structuredClone(contract.schema) as any
 const plan=schema.properties.weeklyPlan
 // Keep the required-field order aligned with the property order below.
 // Structured providers may choose either list when deciding output order;
 // weeklyPlan must close before reply so the existing validator can stream a
 // complete bounded allocation without exposing unvalidated prose.
 schema.required=['weeklyPlan',...(schema.required??[]).filter((key:string)=>key!=='weeklyPlan')]
 plan.properties.availableMinutes={type:'integer',enum:[budget.minutes]}
 plan.properties.period={type:'string',enum:[budget.period]}
 if(budget.minutes>0){
  plan.properties.items.minItems=1
  plan.properties.items.items.properties.action.description='用中文写用户实际请求的课程、复习或探索任务，不写字段名或英文代号。休息和缓冲是未安排时间，不列为任务。'
  // Reuse the existing finite plan lane for this explicit pair of requested
  // tasks. No other task or direction is inferred from generic "备考".
  const requestedPair=scanUserClauses(currentText).find(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&/^(?:请)?(?:帮我)?安排(?:本周|这周)?(?:课程(?:作业)?)(?:和|及|、|与)(?:复习|备考)$/.test(clause.text))
  if(requestedPair){
   const course=requestedPair.text.includes('课程作业')?'课程作业':'课程'
   const exam=requestedPair.text.includes('备考')?'备考':'复习'
   plan.properties.items.items.properties.action.enum=[course,exam]
   plan.properties.items.minItems=2
   plan.properties.items.maxItems=2
  }
  plan.properties.items.items.properties.directionScopes.description='只有实际属于该方向的任务才标注；普通课程作业用空数组，不把课程或一般备考自动标为专升本或考研。'
  if(allowedPlanScopes){
   const scopes=plan.properties.items.items.properties.directionScopes
   const choices=(scopes.items.enum??scopes.items.anyOf?.map((item:{const:string})=>item.const)??[]) as string[]
   const permitted=choices.filter(scope=>allowedPlanScopes.includes(scope))
   scopes.items=permitted.length?{type:'string',enum:permitted}:{type:'string'}
   scopes.maxItems=permitted.length
  }
  if(requiresPlanSlack(currentText)){
   plan.description=`本人明确不要排满：可用${budget.minutes}分钟，items中的任务分钟合计至多${budget.minutes-1}分钟。休息/缓冲保留在任务列表外，由服务器显示未安排量。`
   plan.properties.items.items.properties.minutes.maximum=budget.minutes-1
  }
 }
 if(budget.minutes>0)schema.properties.reply={type:'string',minLength:1,maxLength:16000,description:'说明取舍、实际反馈或未知；具体时间只在weeklyPlan展示，不另写数字日程。'}
 if(budget.minutes>0){
  // Structured providers emit properties in schema order. Put the bounded
  // allocation first so the following reply key is an unambiguous streaming
  // boundary: every weeklyPlan item has arrived before any draft is shown.
  const {weeklyPlan,...remaining}=schema.properties
  schema.properties={weeklyPlan,...remaining}
 }
 if(budget.minutes===0){
  plan.properties.items.maxItems=0
  schema.properties.reply={type:'string',enum:[budget.period==='next_week'?'下周没有可用时间，先不安排课程或备考任务；等可用时间改变后再调整。':'当前安排的时段没有可用时间，先不安排课程或备考任务；等可用时间改变后再调整。']}
 }
 return {...contract,schema,schemaChars:JSON.stringify(schema).length}
}
