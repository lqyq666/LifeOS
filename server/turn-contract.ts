// One ordinary contract with composable optional outputs. User controls,
// requested time arrangements and authorized sources narrow capabilities;
// legacy mode names are retained only for callers reading old contracts.

import { actionCoachTurnSchema } from './action-coach-contracts.ts'
import {crisisSupportIntent} from './grilling-policy.ts'
import { scanUserClauses,currentConversationOnly,refusalPreferenceClause,scopedTaskPauseClause,assistantRequestClause,responseRequestScope,conversationPreferenceClause } from './user-command-spans.ts'
import {independentTrialNouns,unresolvedTwoFactors} from './user-command-spans.ts'
import {requiresImmediateMaterial,deliverableIntent} from './action-coach-events.ts'
import {requiresPlanSlack} from './weekly-plans.ts'
import {clauseExpressesFuturePlan} from './experience-content.ts'
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
  // Slimmed clone of the full action-coach schema; a deleted lane is
  // unrepresentable, everything kept is byte-identical to the full contract.
  schema:Record<string,unknown>
  schemaChars:number
  requiredReplyKind?:'comparison'|'summary'
}

const comparisonLabelTokens=['(?:(?:选项|方式|方案|路径|对象|方向)(?:一|1|A|甲)[:：]|[1Aa][.)、:：]|一[、.])','(?:(?:选项|方式|方案|路径|对象|方向)(?:二|2|B|乙)[:：]|[2Bb][.)、:：]|二[、.])']
const comparisonLabels=comparisonLabelTokens.map(label=>'(?:^|\\n|[。；;：:])[ \\t]*'+label)
const comparisonOpeningPattern='^[ \\t\\r\\n]*'+comparisonLabelTokens[0]
export function comparisonOptionBody(text:string):string|null{
 const label=new RegExp(comparisonOpeningPattern).exec(text)
 return label?text.slice(label[0].length):null
}
// This checks only the requested presentation exists. It does not certify the
// options' factual support, utility, resource feasibility or causal reasoning.
export const comparisonReplyAccepts=(reply:string)=>{
 const normalized=reply.replace(/\*\*/g,'')
 const first=new RegExp(comparisonLabels[0]!).exec(normalized)
 if(!first)return false
 const tail=normalized.slice(first.index+first[0].length),second=new RegExp(comparisonLabels[1]!).exec(tail)
 if(!second)return false
 const bodies=[tail.slice(0,second.index).trim(),tail.slice(second.index+second[0].length).trim()]
 return bodies.every(body=>body.length>0&&scanUserClauses(body).some(clause=>!clause.interrogative&&/[\p{L}\p{N}]/u.test(clause.text)))
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
 schema.properties.reply={...schema.properties.reply,pattern:comparisonOpeningPattern,allOf:comparisonLabels.map(pattern=>({type:'string',pattern})),description:'reply从第一个选项标签及其具体内容开始，随后给第二个选项。每项是当前选取的有限示例，说明与本人已知条件相关的依据和投入/局限；其他可能方式仍可存在，本轮无需列全。比较不代表已经选择或安排任务。缺少某项必需条件就如实标明该选项不能开始，不虚构资源或个人偏好。'}
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
 const expanded=scope.instructions.some(clause=>/详细|详尽|展开|完整|逐项|逐条|长文|全面|深入|细说|细讲/.test(clause.commandText))
 if(scope.sentenceLimit===1)delete schema.properties.lead
 else if(schema.properties.lead)schema.properties.lead={...schema.properties.lead,pattern:'^[^？?]*$',description:'本轮交付当前理解的第一句预览；给基于本人报告的实际判断，不追问、不以状态确认替代理解，须在reply逐字保留。'}
 schema.properties.reply=scope.sentenceLimit===1
  ?{...schema.properties.reply,maxLength:240,pattern:'^[^。！？!?\\r\\n]+[。！!]?$' ,description:'只给一句当前阶段理解，以已报告的具体线索及局限为内容；'+(scope.actionRequested?'同一句中还须交付用户明确要求的小行动，遵守数量、时间与资源限制；':'')+'不复制上一轮整段，不加标题、状态确认、分段、第二句或追问。'}
  :{...schema.properties.reply,...(!expanded&&!scope.actionRequested?{maxLength:100}:{}),pattern:'^[^？?]*$',description:'本轮要求更新或说明当前理解：综合本人具体报告、暂定理解及真正仍未知的地方。未知用尚未确认的陈述表达，不变成要求用户逐项回答的问题；不以重问上一问或只确认状态替代交付。'+(scope.actionRequested?'同时交付本轮明确要求的小行动，遵守其数量、时间与资源限制。':'没有要求提问，不加入问句，不新增行动。')}
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

const negativePersonalFact=/^(?:这次|这周|本周|最近)?我(?:目前|现在|暂时|还|仍|一直|并|从来)?(?:没(?:有)?|尚未|还未|未|不)(?:开始|做|学|复习|准备|完成|交付|发送|收到|拿到|有|想|愿意|打算|决定|能)/
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
export function completeUserReply(reply:string,userText:string){
 const internal=reply.match(/\b(?:reported_(?:no_response|response|not_read|read|received|used|not_used|paid|unpaid|tried|not_tried)|growthUpdates|user_reported)\b/g)??[]
 if(internal.some(token=>!userText.includes(token)))return false
  // A complete JSON frame can still end mid-proposition. Reject high-confidence
  // continuative predicates when their required complement has not arrived.
  const surfaceEnd=reply.trim().replace(/[。！？!?…]+$/,'').trim()
  if(/(?:都|均)(?:支持|证明|说明|表明|意味着|包括|包含|依赖|取决于|导致|造成|改善|增加|减少|避免|确认|展示|显示)$/.test(surfaceEnd))return false
 const protectedSpans=scanUserClauses(reply).flatMap(clause=>[...clause.codeSpans,...clause.quoteSpans])
 const pairs:Record<string,string>={'（':'）','(':')','【':'】','[':']'},stack:string[]=[]
 for(let index=0;index<reply.length;index++){
  if(protectedSpans.some(span=>index>=span.start&&index<span.end))continue
  const char=reply[index]!
  if(pairs[char])stack.push(pairs[char]!)
  else if(stack.length&&Object.values(pairs).includes(char)&&stack.pop()!==char)return false
 }
 return stack.length===0
}
const embeddedOtherActorAction=(text:string)=>/(?:我|本人).{0,15}(?:让|看到|看见|听说|知道|发现|听到|要求|请(?!教)|确认|得知|获悉|收到).{0,15}(?:同学|学长|学姐|导师|老师|客户|朋友|对方|他|她)/.test(text)
// Explicit preferences remain exact reports, never inferred traits. Reuse the
// shared ownership/quote/condition guards and exclude conversational requests.
const personalPreference=/^(?:我(?:自己|个人|本人)?)?(?:现在|目前)?(?:确实|其实|真的|的确)?(?:更|主要|最|也|仍然|仍|并)?(?:在意|不在意|喜欢|偏好|不喜欢|享受不了|不享受|享受|不想承担|不愿承担)(.+)$/
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

// A later response only retires the same participant/material report. A
// generic “对方” is insufficient without an explicit shared delivery form.
export function sameReportedResponseSubject(previous:string,current:string){
 if(explicitMaterialFormConflict(previous,current))return false
 const oldActors=new Set(reportedEvidenceFromText(previous).participants.map(report=>report.actor))
 const newActors=new Set(reportedEvidenceFromText(current).participants.filter(report=>report.states.response.status==='reported_response'||report.states.read.status==='reported_read').map(report=>report.actor))
 if(oldActors.size!==1||newActors.size!==1)return false
 const oldActor=[...oldActors][0]!,newActor=[...newActors][0]!
 if(oldActor===newActor&&oldActor!=='对方')return true
 return (oldActor==='对方'||newActor==='对方')&&explicitMaterialForms(previous).length===1&&explicitMaterialForms(current).length===1
}
const participantActor='(?:对方|客户|学长|学姐|(?:[\u4e00-\u9fa5]{1,3})?(?:导师|老师)|同学|室友|朋友|他们|她们|他|她)'
const participantUncertainty=/(?:可能|也许|好像|似乎|大概|不确定|不清楚|不知道|说不准|不一定|未必|猜测|是否|有没有|未知|未报告|未确认|不是|并非|绝非|不代表|不等于|不能证明|不能说明)/
// Scope uncertainty to its explicit process dimension, without altering the
// source quote or ownership/condition scanner. Bare "but not sure" still
// qualifies the original statement; a different dimension does not erase it.
const participantDimensionBoundary=/(?=(?:但是|但|不过|然而|可是)(?=(?:这|已|已经|还|仍|尚|未|没有|可能|也许|是否|有没有|不确定|不清楚|不知道|不代表|不等于|未确认|未报告){0,6}(?:读|阅读|看|回复|回应|采用|使用|付款|付费|效果|试过|试用))|(?:不代表|不等于|不能证明|不能说明)(?=(?:已|已经)?(?:读|阅读|看|回复|回应|采用|使用|付款|付费|效果|试过|试用)))/
const participantStateFields={read:/读|阅读|看/,response:/回复|回应|没回/,adoption:/采用|使用|用过|用了/,payment:/付款|付费|付钱|付了/,effect:/效果|反馈/} as const
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
   const direct=report&&!report.indirect&&/(?:回复|回应|没回|已读|读到|读过|看过|采用|使用|用了|试过|试用|不适合|打不开|收到|付款|付费)/.test(report.rest)
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
export function reportedCompletedContactClauses(text:string){
 return anchorablePersonalClauses(text).filter(c=>!embeddedOtherActorAction(c.text)&&/^(?:(?:回来反馈|状态更新)[：:]\s*)?(?:(?:昨天|今天|刚才|后来|之后)\s*)?(?:我|本人|按上次)/.test(c.text)&&/(?:发出去了|发出了|发出(?:那个|这个)?(?:问题|消息|邮件|资料|材料)了|发了(?:.{0,20})(?:邮件|消息|短信|问题|PDF|链接|作品集|资料|材料|报告|表格|文档|申请|作业)|(?:PDF|链接|作品集|资料|材料|报告|表格|文档|申请|作业).{0,12}发给.{0,12}了|交给.{0,20}了|交付了|提交了|联系了|发送了)/.test(c.text)&&!participantUncertainty.test(participantDimensionText(c.text,/发出|发送|发给|发了|联系|交给|交付|提交/))&&!/(?:想|打算|准备|计划|希望|考虑|愿意|决定|还没|没有|尚未|未曾|没|尝试|试做).{0,40}(?:发出|发了|发给|联系|发送|交给|交付|提交)/.test(c.text))
}
export function requestedQuestionEditClauses(text:string){
 const clauses=scanUserClauses(text)
 return clauses.filter(c=>!c.conditional&&!c.quoted&&!c.code&&!c.attributedToOther&&/^(?:我想把(?:验证问题|访谈问题|提问|这个问题)|把(?:上次的|这个)?问题)改成/.test(c.text)).map(first=>{
   const same=clauses.filter(c=>c.start>=first.start&&c.sentenceStart===first.sentenceStart)
   const last=same.at(-1)??first
   return {...first,end:last.end,text:text.slice(first.start,last.end)}
 })
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
  const responseNo=responseCertain&&q.match(negativeResponse)!==null,responseYes=Boolean(participant&&!participant.indirect&&/^(?:说|觉得|回复|回答|回应|确认)/.test(participant.rest))
    ||responseCertain&&/(?:已经|已)(?:回复|回应)|回复了|回应了/.test(q.replace(negativeResponse,''))
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
  const modality=/不在意/.test(clause.text)?'not_priority':/不想承担|不愿承担/.test(clause.text)?'unwilling':/不喜欢|不享受|享受不了/.test(clause.text)?'dislike':/喜欢|偏好|享受/.test(clause.text)?'like':'priority'
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
  if(/(?:希望|期待|期望|建议)/.test(body))return [clause]
  const next=clauses[index+1]
  if(next&&next.sentenceStart===clause.sentenceStart&&/^[，,\s]*$/.test(text.slice(clause.end,next.start))&&/^(?:只是|仅仅|仍然|还是)?(?:希望|期待|期望)/.test(next.text))return [{...clause,end:next.end,text:text.slice(clause.start,next.end)}]
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
  const capabilities:TurnContractCapabilities={
    growth:!input.readOnly&&!crisis,
    // Experience extraction and star-map updates are program-owned. The main
    // model need not generate a second copy of the same autobiographical span.
    candidate:false,
    plan:!input.readOnly&&!supportOnly&&input.planIntent,
    citations:!input.readOnly&&!supportOnly&&input.knowledgeCount>0,
    event:!input.readOnly&&!input.eventReadOnly&&!supportOnly,
    material:!input.readOnly&&!input.eventReadOnly&&!supportOnly,
  }
  const schema=slimActionCoachSchema(capabilities)
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
  if(!capabilities.candidate)delete properties.experienceCandidate
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
  return schema as unknown as Record<string,unknown>
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
 if(!contract.capabilities.material||!requiresImmediateMaterial(text))return {...contract,schemaChars:JSON.stringify(contract.schema).length}
 const schema=structuredClone(contract.schema) as any,event=schema.properties.event
 // The material body has its own validated field and is rendered once by the
 // host. A mandatory nonempty reply makes the model generate it a second time.
 schema.properties.reply={type:'string',minLength:0,maxLength:160,description:'完整材料只写在event.action.draft；没有额外必要的反馈、提醒或未知时reply用空字符串，不重复材料正文，也不宣布已写好。混合复盘可保留必要回应。'}
 schema.required=[...new Set([...(schema.required??[]),'event'])]
 event.required=[...new Set([...(event.required??[]),'action'])]
 event.properties.action.anyOf=event.properties.action.anyOf.filter((branch:any)=>branch.properties?.draft)
 if(replyBody==='question_first'){
  // Use the original canonical material field; put it before explanatory text
  // so a safe question can stream without waiting for readback/state metadata.
  for(const branch of event.properties.action.anyOf)branch.properties={draft:branch.properties.draft,...Object.fromEntries(Object.entries(branch.properties).filter(([key])=>key!=='draft'))}
  event.properties={action:event.properties.action,...Object.fromEntries(Object.entries(event.properties).filter(([key])=>key!=='action'))}
  schema.properties={event,...Object.fromEntries(Object.entries(schema.properties).filter(([key])=>key!=='event'))}
  schema.properties.reply={type:'string',minLength:1,maxLength:1000,description:'回应本轮读回事实、时间和未知，不重复draft.content中的材料问题。'}
 }else if(replyBody&&!groundedSelection){
  schema.properties.reply={type:'string',minLength:1,maxLength:12000,description:'本轮reply就是完整可使用的材料正文，不另写介绍、已完成声明或第二份正文。draft仅返回fromReply:true，服务器将同一正文保存为材料。'}
  for(const branch of event.properties.action.anyOf)branch.properties.draft={type:'object',properties:{fromReply:{type:'boolean',const:true}},required:['fromReply'],additionalProperties:false}
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
 if(budget.minutes>0)schema.properties.reply={type:'string',minLength:1,maxLength:160,description:'简短说明取舍、实际反馈或未知；具体时间只在weeklyPlan展示，不另写数字日程。'}
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
