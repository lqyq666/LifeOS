import {randomUUID} from 'node:crypto'
import type {PoolClient} from 'pg'
import {transaction,HttpError,requireRow} from './db.ts'
import type {Run} from './store.ts'
import {readCoachEvent,type CoachEvent} from './action-coach-events.ts'
import type {KnowledgeCard} from './campus-knowledge.ts'
import {scanUserClauses,methodReferenceClause,canonicalExamMatterIdentity,otherActorClause,selfPerformanceView,firstPersonalActor,personalReportBody} from './user-command-spans.ts'
import {growthQuoteSuppressed,messageQuoteCorrected} from './growth-privacy.ts'
import {assertCoachKnowledge} from './coach-knowledge.ts'
import {kbTerms} from './evergreen-guide.ts'
import {fullMemorySuppressionSql} from './memory-suppression.ts'
import {clauseExpressesFuturePlan} from './experience-content.ts'
export type GuideUsageStatus='suggested'|'accepted'|'attempted'|'waiting_result'|'completed'|'declined'|'blocked'
export type GuideUsage={guideId:string;revision:number;branch:string;stepId:string;status:GuideUsageStatus;eventId:string;sourceMessageId:string|null;sourceQuote:string|null;sourceRange?:{start:number;end:number}|null}
type GuideFeedbackIdentity={title:string;task:string}
const contextlessGuideFeedback=/^(?:还是不行|仍然不行|还是卡住了|还没结果)[。！？?]*$/
const ownershipNeutralFiller=/^(?:(?:顺便|另外|此外|再|还)(?:说|补充|说明)(?:一?下|一句|一点)?|补充(?:一?下|一句|一点)|(?:过了|隔了|等了)?(?:一|两|几|半|\d+)(?:天|周|个?月|小时|分钟)(?:后|之后|以后)?|第二天|当天|后来|之后|随后)[。！？?]*$/
function exactSourceRange(sourceText:string,quote:string,proposed?:{start:number;end:number}|null){
 if(!quote.trim())return null
 if(proposed){
  const {start,end}=proposed
  return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>start&&end<=sourceText.length&&end-start===quote.length&&sourceText.slice(start,end)===quote?{start,end}:null
 }
 const start=sourceText.indexOf(quote)
 if(start<0||sourceText.indexOf(quote,start+1)>=0)return null
 return {start,end:start+quote.length}
}
const genericJobQualifier=/^(?:一个|一项|这个|那个|当前|目标|相关|公开|就业|求职|招聘|职位)$/
const compactJobPlaceModifier=/^(?:(?:北京|上海|天津|重庆|香港|澳门|成都|广州|深圳|杭州|南京|武汉|西安|苏州|长沙|郑州|青岛|厦门|福州|济南|合肥|昆明|贵阳|南宁|海口|兰州|西宁|银川|乌鲁木齐|拉萨|哈尔滨|长春|沈阳|石家庄|太原|呼和浩特|南昌)|[\p{Script=Han}]{1,8}(?:省|市|区|县|州|盟))$/u
const compactJobOrganizationModifier=/^[\p{Script=Han}A-Za-z0-9]{1,24}(?:公司|集团|大学|学校|学院|实验室|团队|部门|机构|研究院|中心)$/u
function sameJobQualifier(left:string,right:string):boolean{
 if(left===right||left.endsWith('的'+right)||right.endsWith('的'+left))return true
 const hasContextPrefix=(whole:string,core:string)=>{
  if(!whole.endsWith(core))return false
  const modifier=whole.slice(0,-core.length).replace(/的$/,'')
  return compactJobPlaceModifier.test(modifier)||compactJobOrganizationModifier.test(modifier)
 }
 return hasContextPrefix(left,right)||hasContextPrefix(right,left)
}
function explicitJobQualifiers(text:string):string[]{
 const found:string[]=[]
 for(const match of text.matchAll(/([\p{Script=Han}A-Za-z0-9]{2,48})岗位/gu)){
  const qualifier=match[1]!
   .replace(/^(?:(?:之前|此前|昨天|前天|上周|本周|这周|最近|刚才|今天)\s*)*(?:我|本人)?(?:(?:之前|此前|昨天|前天|上周|本周|这周|最近|刚才|今天)\s*)*(?:(?:按|按照)(?:上次|这个|该)?(?:方法|步骤|做法|方案)\s*)?(?:(?:刚刚|今天|实际|已经|已)\s*)*(?:(?:看|查看|核对|了解|查|投递|面试|关注|比较|尝试|试|完成|做完|做)(?:了)?|投了)/,'')
   .replace(/^(?:(?:薪资|待遇|福利|地点|工作地点|通勤|要求|技能|职责|公司|行业|工作内容|发展空间)(?:和|与|及|以及|、))+/,'')
   .replace(/^(?:(?:我|本人)(?:(?:现在|目前|还是|也)\s*)?(?:对|在)|关于|针对|围绕)/,'')
   .replace(/^(?:一个|一项|这个|那个|当前|目标|相关|公开|新的?)/,'')
  if(qualifier&&!genericJobQualifier.test(qualifier))found.push(qualifier)
 }
 return [...new Set(found)]
}
const genericExamQualifier=/^(?:期末|课程|科目|考试|复习|备考|错题|题目|第一道|一套)$/
const examIdentityAlias='(?:大学英语(?:四|六)级|英语(?:四|六)级|(?:四|六)级|CET[-_\\s]?[46]|高等数学|高数|线性代数|线代|概率论与数理统计|概率统计|概率论|考研|研究生|考公|公务员)'
function explicitExamQualifiers(text:string):string[]{
 const found:string[]=[]
 for(const match of text.matchAll(new RegExp(`(?:正在|正|在)?(?:复习|备考|核对|查看|检查|准备)(?:了|过)?(?:(?:一|这|那|第一)(?:套|道|份|个|项))?\\s*(${examIdentityAlias})`,'giu'))){
  const qualifier=match[1]!
  found.push(canonicalExamMatterIdentity(qualifier)??qualifier.replace(/[\s_-]/g,'').toLocaleLowerCase())
 }
 for(const match of text.matchAll(/([\p{Script=Han}A-Za-z0-9+-]{2,20}?)(?:期末|考试|复习|备考|错题)/gu)){
  const qualifier=match[1]!
   .replace(/^(?:(?:昨天|前天|今天|上周|本周|这周|最近|刚才)\s*)*(?:我|本人)?(?:(?:昨天|前天|今天|上周|本周|这周|最近|刚才)\s*)*(?:(?:已经|已|刚刚|今天|这次|本次|实际)\s*)*/,'')
   .replace(/^(?:(?:我|本人)(?:正在|正|在)|(?:正在|正|在))/,'')
   .replace(/^(?:完成了?|做完了?|开始了?|尝试了?|复习了?|备考了?|核对了?|查看了?|看了?|检查了?|准备了?)(?:(?:一|这|那|第一)(?:套|道|份|个|项))?/,'')
   .replace(/^(?:(?:一|这|那|第一)(?:套|道|份|个|项))/,'')
   .replace(/(?:(?:一|这|那|第[一二两三四五六七八九十百\d]+)(?:套|道|份|个|项))$/,'')
  if(qualifier.length>=2&&!genericExamQualifier.test(qualifier))found.push(canonicalExamMatterIdentity(qualifier)??qualifier.replace(/[\s_-]/g,'').toLocaleLowerCase())
 }
 return [...new Set(found)]
}
function explicitMatterQualifierConflict(text:string,basis:string):boolean{
 // One matching identity cannot authorize a second, different identity in the
 // same report. Mixed named matters stay unbound until the user disambiguates.
  const conflicts=(reported:string[],expected:string[],same:(left:string,right:string)=>boolean)=>Boolean(reported.length&&expected.length&&reported.some(left=>!expected.some(right=>same(left,right))))
 const exactOrPossessive=(left:string,right:string)=>left===right||left.endsWith('的'+right)||right.endsWith('的'+left)
 return conflicts(explicitJobQualifiers(text),explicitJobQualifiers(basis),sameJobQualifier)||conflicts(explicitExamQualifiers(text),explicitExamQualifiers(basis),exactOrPossessive)
}
const guideMatterPatterns=[/考试|期末|复习|备考|考研|考公/,/产品|创业|用户|客户|需求|接单|交付|改稿/,/导师|科研|论文/,/竞赛|比赛|队友|社团/,/岗位|求职|投递|面试/,/宿舍|舍友|人际/,/休息|过载|恢复/]
const guideActionAspect='(?:了|过|完(?:了)?|好(?:了)?)'
const guideActionVerb='(?:交付|完成|尝试|处理|推进|核对|查看|检查|复习|投递|联系|整理|修改|阅读|开始|发|交|做|试|看|查|改)'
const guidePerformedAction=`(?:${guideActionVerb}${guideActionAspect}|尝试)`
const prospectiveHowAction=new RegExp(`(?:怎么|如何|怎样)[^；]{0,24}${guidePerformedAction}[^；]{0,12}(?:才|才能|才会|就能|不会|不再)`)
const prospectiveWhichAction=new RegExp(`${guidePerformedAction}[^；]{0,8}(?:哪一步|什么|哪些)[^；]{0,12}(?:才|才能|才会|就能|不会|不再)`)
const prospectiveModalAction=new RegExp(`${guidePerformedAction}[^；]{0,8}(?:会|会不会|是否|能否)[^；]{0,16}(?:吗|么)$`)
const ownedGuideAction=new RegExp(`(?:我|按上次)[^；]{0,35}(?:已经|已)?${guidePerformedAction}`)
const explicitMatterSwitch=/现在想|换个话题|另外一件|新的任务|新任务/
const genericFramedMatter=/^(?:这|那|当前|上次|之前|刚才)?(?:个|件|项|一件)?(?:事|事情|问题|任务|行动|方法|做法|步骤|方向)?$/
function framedMatterLabels(text:string):string[]{
 const labels:string[]=[]
 for(const clause of scanUserClauses(text)){
  if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther)continue
  const match=/(?:关于|针对|围绕)\s*([^，。；！？]{1,48})/.exec(clause.text)
  const label=match?.[1]?.trim().replace(/(?:我)?(?:还是|仍然|依然)(?:不行|卡住了?|没结果).*$/,'').trim()
  if(label&&!genericFramedMatter.test(label))labels.push(label)
 }
 return labels
}
function framedMatterMatches(label:string,basis:string):boolean{
 if(otherActorClause(label,{allowOmittedSubject:true}))return false
 const domains=guideMatterPatterns.filter(pattern=>pattern.test(label))
 if(domains.some(pattern=>!pattern.test(basis)))return false
 const jobs=explicitJobQualifiers(label),basisJobs=explicitJobQualifiers(basis)
 if(jobs.length&&basisJobs.length&&jobs.every(left=>basisJobs.some(right=>sameJobQualifier(left,right))))return true
 const exams=explicitExamQualifiers(label),basisExams=explicitExamQualifiers(basis)
 if(exams.length&&basisExams.length&&exams.every(left=>basisExams.includes(left)))return true
 const compact=(value:string)=>value.replace(/[\s，。；！？、的这那当前上次之前刚才]/g,'')
 const framed=compact(label),target=compact(basis)
 if(framed&&target&&(target.includes(framed)||framed.includes(target)))return true
 const terms=new Set(kbTerms(basis))
 return kbTerms(label).filter(term=>terms.has(term)).length>=2
}
const genericActionMatter=/^(?:第?[一二两三四五六七八九十百\d]+(?:步|项|次)|[一二两三四五六七八九十百\d几]+(?:个|项|列|行|页|条|份|组|道|次|步|人|位|名)(?:标题|内容|字段|数据|要求|材料|问题|记录)?(?:核对|检查|整理|填写|修改|分析)?|(?:半|[一二两三四五六七八九十百\d几]+)(?:分钟|小时|天|周|月)|(?:一个|一项|这个|那个)?岗位(?:[一二两三四五六七八九十百\d]+(?:分钟|小时|天))?|这(?:个|件|项|一步)|那(?:个|件|项|一步)|当前任务|上次任务|准备|尝试|标题|内容|字段|步骤|要求|问题|消息|邮件)$/
const actionTrailingMatter=new RegExp(`${guidePerformedAction}\\s*([^，。；！？]{1,48})$`)
const baActionMatter=new RegExp(`^(?:我|本人|我们)(?:(?:已经|已|刚刚|刚才|实际)\\s*)?(?:把|将)\\s*([^，。；！？]{1,48}?)\\s*${guidePerformedAction}$`)
const topicFrontedActionMatter=new RegExp(`^([^，。；！？]{1,48}?)(?:我|本人|我们)(?:(?:已经|已|刚刚|刚才|实际)\\s*)?${guidePerformedAction}$`)
const actorTransferTail=/(?:让|叫|要求|安排|请|指导|帮助|协助|辅导|由)$/
const actionOutcomeTail=/^(?:(?:但|但是|不过|然而|可是|却)\s*)?(?:我\s*)?(?:(?:还是|仍然|依然|还)\s*)?(?:不行|卡住了?|没(?:有)?(?:结果|效果|回复|进展|成功|完成|用)|没人回|失败了?|有效果了?|有帮助了?|有用了?|(?:结果|效果)(?:不好|不符|不理想))$/
const actionOutcomeSuffix=/(?:(?:但|但是|不过|然而|可是|却)\s*)?(?:我\s*)?(?:(?:还是|仍然|依然|还)\s*)?(?:不行|卡住了?|没(?:有)?(?:结果|效果|回复|进展|成功|完成|用)|没人回|失败了?|有效果了?|有帮助了?|有用了?|(?:结果|效果)(?:不好|不符|不理想))$/
function completedActionMatterLabels(text:string):string[]{
 const labels:string[]=[]
 for(const clause of scanUserClauses(text)){
  if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.interrogative)continue
  const body=personalReportBody(clause.text.trim())
  const candidates=[actionTrailingMatter.exec(body)?.[1],baActionMatter.exec(body)?.[1],topicFrontedActionMatter.exec(body)?.[1]]
  for(const candidate of candidates){
   const label=candidate?.trim().replace(actionOutcomeSuffix,'').trim().replace(/^(?:这|那)(?:个|件|项)?/,'')
   // A completed concrete object is an explicit matter even when its domain
   // is new. Bounded substeps and a causative phrase before the real user
   // actor are not topic objects; every other object must bind or fail closed.
   if(label&&!genericActionMatter.test(label)&&!actorTransferTail.test(label)&&!actionOutcomeTail.test(label))labels.push(label)
  }
 }
 return [...new Set(labels)]
}
function feedbackExplicitlyConflicts(text:string,title:string,task:string):boolean{
 if(explicitMatterSwitch.test(text))return true
 const basis=title+' '+task
 if(framedMatterLabels(text).some(label=>!framedMatterMatches(label,basis)))return true
 const actionMatters=completedActionMatterLabels(text)
 if(actionMatters.some(label=>!framedMatterMatches(label,basis)))return true
 const named=guideMatterPatterns.filter(pattern=>pattern.test(selfPerformanceView(text)))
 return Boolean(named.length&&(named.some(pattern=>!pattern.test(basis))||explicitMatterQualifierConflict(text,basis)))
}
export function feedbackMatchesCurrent(text:string,title:string,task:string){
 if(feedbackExplicitlyConflicts(text,title,task))return false
 const sourceClauses=scanUserClauses(text).filter(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther)
 if(sourceClauses.length>0&&sourceClauses.every(clause=>clause.interrogative)&&classifyGuideFeedback(text)===null)return false
 if(contextlessGuideFeedback.test(text.trim()))return true
 // Sharing a broad domain (for example, two different exams) is not event
 // identity. Specific object terms are checked by the common overlap rule
 // below; an explicit method reference can still bind without repeating them.
 const basis=title+' '+task
 const reportedExams=explicitExamQualifiers(text),expectedExams=explicitExamQualifiers(basis)
 if(reportedExams.some(left=>expectedExams.includes(left)))return true
 if(/(?:我|这次)[^，。；]{0,20}(?:不想继续|暂时不继续|先不继续|不再试|拒绝继续)|先停在这里/.test(text))return true
 if(/按上次|这个方法|这次行动|我愿意试|我不想继续|我不做了/.test(text))return true
 if(methodReferenceClause(text))return true
 const taskTerms=new Set(kbTerms(title+' '+task))
 return kbTerms(text).filter(t=>taskTerms.has(t)).length>=2
}
export function classifyGuideFeedback(text:string):Exclude<GuideUsageStatus,'suggested'>|null{
 const clauses=scanUserClauses(text).filter(c=>!c.conditional&&!c.attributedToOther&&!c.quoted&&!c.code&&!c.quoteSpans.length&&!c.codeSpans.length)
  // Feedback may start directly with a named performer. Use the shared
  // omitted-subject actor boundary so another person's result cannot update
  // this user's guide state merely because the sentence is interrogative.
  let delegatedSentence=-1,reflexiveSelfSentence=-1,delegatedOutcomePending=false
  const ownedClauses=clauses.flatMap(c=>{
   const body=c.text.trim()
   // Punctuation may split an observation from its explicit reflexive action:
   // 「我看到…后，自己做了…」. Preserve that same-sentence antecedent, but
   // do not let an ambiguous 自己 reverse an actual delegation such as
   // 「我让小王做了，自己…」.
   const observationAntecedent=Boolean(firstPersonalActor(body)&&/(?:看到|看见|发现|得知|听说|记录到)(?:了)?[^，。；！？]{0,50}后$/.test(body))
   if(observationAntecedent)reflexiveSelfSentence=c.sentenceStart
   const reflexiveSelf=reflexiveSelfSentence===c.sentenceStart&&/^(?:但|不过|可是|然而)?自己(?!的)/.test(body)
   if(reflexiveSelf){
    delegatedSentence=-1
    delegatedOutcomePending=false
    return [{...c,text:body.replace(/^(?:但|不过|可是|然而)?自己(?!的)/,'我')}]
   }
   const other=otherActorClause(c.text,{allowOmittedSubject:true})
   if(other){
    delegatedSentence=c.sentenceStart
    delegatedOutcomePending=true
    // The observation itself may introduce the explicit reflexive antecedent;
    // any later real delegation in that sentence supersedes it.
    if(!observationAntecedent)reflexiveSelfSentence=-1
    return []
   }
   if(delegatedOutcomePending){
    const explicitSelf=/^(?:但|不过|可是|然而)?(?:我|本人|我们)(?!的)/.test(body)
    const explicitContextReset=explicitMatterSwitch.test(body)||framedMatterLabels(body).length>0
    if(!explicitSelf&&!explicitContextReset)return []
    delegatedOutcomePending=false
   }
   if(c.sentenceStart===delegatedSentence&&!/^(?:但|不过|可是|然而)?(?:我|本人|我们)/.test(body))return []
   delegatedSentence=-1
   return [c]
  })
  const allReport=ownedClauses.map(c=>c.text).join('；')
 const performedClauses=ownedClauses.filter(c=>!clauseExpressesFuturePlan(c.text))
 const performedReport=performedClauses.map(c=>c.text).join('；')
 const allInterrogative=clauses.length>0&&clauses.every(clause=>clause.interrogative)
 const prospectiveQuestion=allInterrogative&&(prospectiveHowAction.test(allReport)
  ||prospectiveWhichAction.test(allReport)
  ||!/(?:已经|刚才|刚刚|昨天|前天|上周|实际|确实)/.test(allReport)&&prospectiveModalAction.test(allReport))
 const acted=!prospectiveQuestion&&ownedGuideAction.test(performedReport)&&!/(?:我|按上次)[^；]{0,16}(?:没|没有|未)(?:开始|尝试|完成|交付|发)/.test(performedReport)
  const report=ownedClauses.filter(c=>!c.interrogative||acted&&/(?:卡住|失败|没效果|没用|没人回|没回复|没有回复|还是不行|仍然不行)/.test(c.text)).map(c=>c.text).join('；')
 const resultReport=performedClauses.filter(c=>!c.interrogative||acted&&/(?:卡住|失败|没效果|没用|没人回|没回复|没有回复|还是不行|仍然不行)/.test(c.text)).map(c=>c.text).join('；')
 if(/(?:我|这(?:个|次))[^；]{0,20}(?:不想继续|暂时不继续|先不继续|不做了|放弃这个|不再试|拒绝继续)/.test(report))return 'declined'
 if(acted&&/等(?:待)?(?:结果|回复)|(?:还)?没(?:有)?(?:回复|收到结果)|没收到结果/.test(resultReport))return 'waiting_result'
 if(/(?:我|按上次)[^；]{0,35}(?:没|没有|未)(?:开始|做|尝试)/.test(resultReport)&&/打不开|找不到|缺少|卡住|没材料/.test(resultReport))return 'blocked'
 if(/(?:我[^；]{0,24}(?:打不开|找不到|卡住)|(?:还是|仍然)(?:不行|卡住|打不开))/.test(resultReport))return 'blocked'
 if(acted&&/(?:没|没有|未)(?:能)?(?:帮|帮助)[^；]{0,16}(?:判断|核对|推进|解决)/.test(resultReport))return 'blocked'
 if(acted&&/没效果|没人回|没回复|卡住|失败|没用/.test(resultReport))return 'blocked'
 if(acted&&/结果|收到|回复|付款|用上|通过/.test(resultReport))return 'completed'
 if(acted)return 'attempted'
 if(/我[^；]{0,15}(?:愿意试|接受这个|同意这样做|可以试试)/.test(report))return 'accepted'
 return null
}
export function guideFeedbackSource(text:string,status:Exclude<GuideUsageStatus,'suggested'>,identity?:GuideFeedbackIdentity):{quote:string;range:{start:number;end:number}}|null{
 const allClauses=scanUserClauses(text),clauses=allClauses.slice(-64)
 // Conflict detection sees the complete turn. Exact-source search stays
 // bounded to the most recent clauses where current feedback normally lands;
 // a long unmatched turn fails closed instead of persisting the whole message.
 const safeIdentityText=allClauses.filter(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&!contextlessGuideFeedback.test(clause.text.trim())).map(clause=>clause.text).join('；')
 if(identity&&safeIdentityText&&feedbackExplicitlyConflicts(safeIdentityText,identity.title,identity.task))return null
 const safeIdentityFrame=Boolean(identity&&framedMatterLabels(safeIdentityText).length)
 const explicitIdentityRequired=Boolean(identity&&safeIdentityText&&(safeIdentityFrame||feedbackMatchesCurrent(safeIdentityText,identity.title,identity.task)))
 // Shortest source first; within the same width, the latest occurrence wins.
 // Most feedback binds in one or two iterations instead of enumerating every
 // possible span on the latency-sensitive turn path.
 for(let width=1;width<=clauses.length;width++)for(let start=clauses.length-width;start>=0;start--){
  const selected=clauses.slice(start,start+width)
  if(selected.some(clause=>clause.quoted||clause.code||clause.conditional||clause.attributedToOther))continue
  const range={start:selected[0]!.start,end:selected.at(-1)!.end},quote=text.slice(range.start,range.end)
  const selectedIdentityText=selected.filter(clause=>!contextlessGuideFeedback.test(clause.text.trim())).map(clause=>clause.text).join('；')
  const selectedIdentityBound=Boolean(identity&&selectedIdentityText&&(framedMatterLabels(selectedIdentityText).length||feedbackMatchesCurrent(selectedIdentityText,identity.title,identity.task)))
  const quoteIdentityBound=!identity||feedbackMatchesCurrent(quote,identity.title,identity.task)||selectedIdentityBound
  if(classifyGuideFeedback(quote)===status&&quoteIdentityBound&&(!explicitIdentityRequired||selectedIdentityBound))return {quote,range}
 }
 if(allClauses.length>clauses.length)return null
 const wholeIdentityBound=!identity||feedbackMatchesCurrent(text,identity.title,identity.task)||safeIdentityFrame
 return classifyGuideFeedback(text)===status&&wholeIdentityBound?{quote:text,range:{start:0,end:text.length}}:null
}
export async function readGuideUsageWithin(c:PoolClient,user:string,conversation:string,eventId:string){
 requireRow((await c.query('SELECT c.id FROM conversations c WHERE c.user_id=$1 AND c.id=$2 AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=c.user_id AND d.conversation_id=c.id)',[user,conversation])).rows[0])
 await readCoachEvent(c,user,conversation,eventId)
 const allowed=[]
 const pageSize=24
 let beforeCreatedAt:string|null=null,beforeId:string|null=null
 while(allowed.length<12){
  const rows:any[]=(await c.query(`SELECT u.id,u.user_id,u.event_id,u.guide_id,u.revision,u.branch,u.step_id,u.status,u.source_message_id,u.source_quote,u.request_id,u.created_at,u.created_at::text AS cursor_created_at_internal,
   m.id AS effective_source_message_id_internal,m.content AS source_text_internal,u.source_start AS source_start_internal,u.source_end AS source_end_internal,
   (SELECT b->>'task' FROM campus_knowledge k CROSS JOIN LATERAL jsonb_array_elements(k.payload#>'{guide,branches}') b WHERE k.id=u.guide_id AND b->>'id'=u.branch) AS branch_task FROM kb_guide_usage u JOIN messages m ON m.user_id=u.user_id AND m.id=COALESCE(u.source_message_id,(SELECT source_message_id FROM runs r WHERE r.user_id=u.user_id AND r.request_id=u.request_id))
   WHERE u.user_id=$1 AND u.event_id=$2 AND (m.conversation_id=$3 OR (SELECT enabled FROM user_memory_settings WHERE user_id=$1))
   AND ($4::timestamptz IS NULL OR u.created_at<$4::timestamptz OR (u.created_at=$4::timestamptz AND u.id<$5::uuid))
   AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=m.user_id AND d.conversation_id=m.conversation_id)
   AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE ${fullMemorySuppressionSql('s')} AND s.user_id=m.user_id AND s.source_message_id=m.id)
   AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id)
   AND coach_knowledge_refs_valid(jsonb_build_array(jsonb_build_object('sourceId',u.guide_id,'revision',u.revision)))
   ORDER BY u.created_at DESC,u.id DESC LIMIT $6`,[user,eventId,conversation,beforeCreatedAt,beforeId,pageSize])).rows
  if(!rows.length)break
  for(const row of rows){
   const {effective_source_message_id_internal,source_text_internal,source_start_internal,source_end_internal,cursor_created_at_internal,...publicRow}=row
   if(!row.source_quote){if(row.status==='suggested')allowed.push(publicRow)}
   else{
    const proposed=Number.isSafeInteger(source_start_internal)&&Number.isSafeInteger(source_end_internal)?{start:source_start_internal,end:source_end_internal}:undefined
    const range=exactSourceRange(String(source_text_internal??''),String(row.source_quote),proposed)
    if(range&&!await growthQuoteSuppressed(c,user,effective_source_message_id_internal,row.source_quote,source_text_internal,range)&&!await messageQuoteCorrected(c,user,effective_source_message_id_internal,row.source_quote,source_text_internal,range))allowed.push(publicRow)
   }
   if(allowed.length===12)break
  }
  const last:any=rows.at(-1)!
  beforeCreatedAt=last.cursor_created_at_internal;beforeId=last.id
  if(rows.length<pageSize)break
 }
 return allowed
}
export async function readGuideUsage(user:string,conversation:string,eventId:string){
 return transaction(c=>readGuideUsageWithin(c,user,conversation,eventId))
}
// Explicit continuation follows persisted owned identities while indexing is
// pending, using the same memory and source checks as semantic retrieval.
export async function readPriorGuideEvents(user:string,conversation:string):Promise<CoachEvent[]>{
 return transaction(async c=>{
  requireRow((await c.query('SELECT c.id FROM conversations c WHERE c.user_id=$1 AND c.id=$2 AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=c.user_id AND d.conversation_id=c.id)',[user,conversation])).rows[0])
  const rows=(await c.query(`SELECT u.event_id FROM kb_guide_usage u JOIN coach_events e ON e.user_id=u.user_id AND e.id=u.event_id
   WHERE u.user_id=$1 AND e.status='active' AND (e.conversation_id=$2 OR (SELECT enabled FROM user_memory_settings WHERE user_id=$1))
   GROUP BY u.event_id ORDER BY max(u.created_at) DESC LIMIT 12`,[user,conversation])).rows
  const events:CoachEvent[]=[]
  for(const row of rows)try{events.push(await readCoachEvent(c,user,conversation,row.event_id))}catch(error){
   if(!(error instanceof HttpError)||!['NOT_FOUND','COACH_SOURCE_REVOKED','MEMORY_DISABLED'].includes(error.code))throw error
  }
  return events
 })
}
export function suggestedGuideUsage(card:KnowledgeCard,eventId:string,branchId?:string):GuideUsage|null{
 const g=card.guide,branch=g?.branches.find(b=>b.id===branchId)??g?.branches[0]
 return g&&branch?{guideId:card.id,revision:card.revision,branch:branch.id,stepId:branch.steps[0].id,status:'suggested',eventId,sourceMessageId:null,sourceQuote:null}:null
}
export async function persistGuideUsage(c:PoolClient,run:Run,usage:GuideUsage[]){
 await assertCoachKnowledge(c,usage.map(u=>({sourceId:u.guideId,revision:u.revision})))
 for(const u of usage){
  let sourceRange:{start:number;end:number}|null=null
  const event=await readCoachEvent(c,run.user_id,run.conversation_id,u.eventId)
  const knowledge=(await c.query("SELECT payload FROM campus_knowledge WHERE id=$1 AND revision=$2 AND status='verified' AND kb_knowledge_current(payload) FOR SHARE",[u.guideId,u.revision])).rows[0]?.payload as KnowledgeCard|undefined
  const branch=knowledge?.guide?.branches.find(b=>b.id===u.branch)
  if(!branch||!branch.steps.some(step=>step.id===u.stepId))throw new HttpError(409,'KB_USAGE_GUIDE_INVALIDATED')
  if(u.status!=='suggested'){
   const source=(await c.query("SELECT content FROM messages WHERE user_id=$1 AND id=$2 AND role='user'",[run.user_id,u.sourceMessageId])).rows[0]
   const serverSource=source?guideFeedbackSource(source.content,u.status,{title:event.title,task:branch.task}):null
   const callerRangeMatches=!u.sourceRange||Boolean(serverSource&&u.sourceRange.start===serverSource.range.start&&u.sourceRange.end===serverSource.range.end)
   const range=source&&serverSource?exactSourceRange(source.content,serverSource.quote,serverSource.range):null
   if(u.sourceMessageId!==run.source_message_id||!u.sourceQuote||!serverSource||u.sourceQuote!==serverSource.quote||!callerRangeMatches||!range||classifyGuideFeedback(u.sourceQuote)!==u.status||await growthQuoteSuppressed(c,run.user_id,u.sourceMessageId!,u.sourceQuote,source.content,range)||await messageQuoteCorrected(c,run.user_id,u.sourceMessageId!,u.sourceQuote,source.content,range))throw new HttpError(400,'KB_USER_REPORT_REQUIRED')
   sourceRange=range
  }
  await c.query('INSERT INTO kb_guide_usage(id,user_id,event_id,guide_id,revision,branch,step_id,status,source_message_id,source_quote,request_id,source_start,source_end) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(user_id,request_id,guide_id) DO NOTHING',[randomUUID(),run.user_id,u.eventId,u.guideId,u.revision,u.branch,u.stepId,u.status,u.sourceMessageId,u.sourceQuote,run.request_id,sourceRange?.start??null,sourceRange?.end??null])
 }
}
