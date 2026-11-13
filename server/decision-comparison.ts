import {Type,type Static} from 'typebox'
import {scanUserClauses,parseExactHours,decisionTimeTailIsGlobal as globalTimeTail,activityScopedDecisionTime,decisionConditionSubject as conditionSubject,ownsDecisionConditionSubject,assistantRequestClause,firstPersonalActor,otherActorClause,type UserClause} from './user-command-spans.ts'
import {chineseInteger} from './growth-time.ts'
import type {CoachEvent} from './action-coach-events.ts'
import {explicitCorrectionIntent} from './turn-obligations.ts'

export type DecisionConditionSource={messageId:string;kind:'actual'|'trial'}
export type DecisionConditions={minutes:number|null;continuousMinutes:number|null;energy:'low'|'adequate'|'unknown';network:boolean|null;contact:boolean|null;unavailableResources:string[];sources:Record<string,string>;sourceRefs?:Record<string,DecisionConditionSource>}
function anchorSources(value:DecisionConditions,quote:string,owner?:DecisionConditionSource){
 if(owner){value.sourceRefs??={};for(const [key,text] of Object.entries(value.sources))if(text===quote)value.sourceRefs[key]={...owner}}
 for(const key of Object.keys(value.sourceRefs??{}))if(!Object.hasOwn(value.sources,key))delete value.sourceRefs![key]
}
function inheritField(value:DecisionConditions,actual:DecisionConditions,key:string){
 if(['minutes','continuousMinutes','energy','network','contact'].includes(key))Object.assign(value,{[key]:(actual as unknown as Record<string,unknown>)[key]})
 else{value.unavailableResources=value.unavailableResources.filter(x=>x!==key);if(actual.unavailableResources.includes(key))value.unavailableResources.push(key)}
 if(actual.sources[key])value.sources[key]=actual.sources[key]!;else delete value.sources[key]
 if(actual.sourceRefs?.[key]){value.sourceRefs??={};value.sourceRefs[key]={...actual.sourceRefs[key]!}}else if(value.sourceRefs)delete value.sourceRefs[key]
}
export function rebaseActualDecisionConditions(value:DecisionConditions,actual:DecisionConditions):DecisionConditions{
 const next={...value,unavailableResources:[...value.unavailableResources],sources:{...value.sources},...(value.sourceRefs?{sourceRefs:{...value.sourceRefs}}:{})}
 for(const key of ['minutes','continuousMinutes','energy','network','contact','电脑','手机','材料','场地','预算','设备','资源','外出'])if(next.sourceRefs?.[key]?.kind!=='trial')inheritField(next,actual,key)
 return next
}
const emptyConditions=():DecisionConditions=>({minutes:null,continuousMinutes:null,energy:'unknown',network:null,contact:null,unavailableResources:[],sources:{}})
const uncertaintyWords='未必|不一定|不确定|不知道|不清楚|未确认|没把握|说不准|也许|可能|大概|大约|约莫|估计|差不多|大致|左右|上下'
const amount='([0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十百]+)'
const contactOperation='(?:联系(?!方式|人列表|信息)|发消息|发邮件|打电话|见面|找别人|催促|沟通(?!能力|技巧|经验)|发送(?:消息|邮件|短信|(?:给|至)[^。！？]{0,6}(?:老师|导师|同学|朋友|同事|客户|对方|别人|他|她))|回信|(?:回复|回应)[^。！？]{0,10}(?:邮件|消息|对方|导师|老师))'
const resourceName='(?:电脑|手机|材料|场地|预算|设备|资源|外出|网络)',resourceGroup=resourceName+'(?:[和与及、]\\s*'+resourceName+')*'
const limitSuffix='(?:(?:方面|上)的?|的)?(?:限制|问题|困难|障碍)'
const withoutLimit=(body:string,field:string)=>new RegExp('(?:没(?:有)?|无)'+field+limitSuffix+'|'+field+'(?:没(?:有)?|无)'+limitSuffix).test(body)||[...body.matchAll(new RegExp('(?:没(?:有)?|无)('+resourceGroup+')'+limitSuffix,'g'))].some(match=>(match[1]!.match(new RegExp(resourceName,'g'))??[]).some(resource=>resource===field))
const unqualifiedStatement=(c:UserClause)=>!c.conditional&&!c.interrogative&&!c.quoted&&!c.code&&!c.attributedToOther&&!c.quoteSpans.length&&!c.codeSpans.length
const comparisonOperation=/(?:试算|重新比较|重新权衡|重新取舍|重排|重比|(?:回到|恢复)(?:原来|原先|原本|真实|实际|现实)(?:的)?(?:条件|情况))/
const separateReport=/^(?:另外|补充(?:一下)?[：:]?|还有|同时|并且)\s*/
const actualReport=/^(?:(?:我|本人)(?:现在|目前|这周|本周|下周|每周|今天|每天){0,4}(?:实际(?:上)?|现实中)|(?:实际上|现实中)(?:我|本人)|(?:我|本人)的[\p{L}]{1,12}(?:实际上|实际(?:是|为|在|只有)|确实是))/u
const explicitCorrectionHead=/^更正(?:一下)?(?:[：:]?\s*(?:我|本人)|$)/

// A comparison may carry a separate factual statement. The scanner retains
// exact source ranges. A condition attached to the comparison's sentence
// stays in the trial unless the user explicitly reports it as actual.
export function reportedComparisonFactClauses(text:string):UserClause[]{
 const clauses=scanUserClauses(text)
 const trialClauses=clauses.filter(c=>!c.quoted&&!c.code&&!c.attributedToOther&&(c.conditional||comparisonOperation.test(c.text)))
 const trialStarts=new Map<number,number>()
 for(const clause of trialClauses)if(!trialStarts.has(clause.sentenceStart))trialStarts.set(clause.sentenceStart,clause.start)
 const firstTrial=trialClauses[0]?.sentenceStart
 const usesEarlierPremise=/(?:按|基于|照|用|沿用)(?:刚才|刚说|前面|我说的|这个|该|上述|前述)(?:的)?(?:条件|设定|假设|情况)/.test(trialClauses[0]?.text??'')
 const correctionSentences=new Set(clauses.filter(c=>unqualifiedStatement(c)&&(trialStarts.get(c.sentenceStart)??Infinity)>c.start&&(explicitCorrectionHead.test(c.text)||explicitCorrectionIntent(c.text))).map(c=>c.sentenceStart))
 return clauses.filter(c=>{
  if(!unqualifiedStatement(c)||comparisonOperation.test(c.text)||assistantRequestClause(c.text))return false
  const body=c.text.replace(separateReport,'')
  if(otherActorClause(body,{allowOmittedSubject:true}))return false
  const explicit=actualReport.test(body)
  const trialStart=trialStarts.get(c.sentenceStart)
  const correctionPrefix=correctionSentences.has(c.sentenceStart)&&(trialStart===undefined||c.start<trialStart)
  if(!explicit&&(trialStart!==undefined&&!correctionPrefix||firstTrial!==undefined&&c.sentenceStart>firstTrial&&!separateReport.test(c.text)&&!correctionPrefix))return false
  if(explicit)return true
  const owned=firstPersonalActor(body)!==null||/^(?:我|本人)的/.test(body)||correctionSentences.has(c.sentenceStart)&&(explicitCorrectionHead.test(body)||/^(?:而)?是/.test(body))
  const independentBaseline=firstTrial!==undefined&&c.sentenceStart<firstTrial&&!usesEarlierPremise
  return owned&&(independentBaseline||!Object.keys(compileDecisionConditions('',body).sources).length)
 })
}

export function comparisonFactText(text:string,clauses:readonly UserClause[]):string{
 return clauses.map((clause,index)=>{
  const next=clauses[index+1]
  if(!next)return clause.text
  const separator=text.slice(clause.end,next.start)
  return clause.text+(clause.sentenceStart===next.sentenceStart&&/^[\s，,、：:]*$/.test(separator)?separator:'。')
 }).join('')
}

export function actualDecisionConditionText(text:string):string{
 return scanUserClauses(text).filter(unqualifiedStatement).map(c=>c.text).join('。')
}
export function continuesDecisionContext(text:string):boolean{
 const clauses=scanUserClauses(text),ack='(?:谢谢(?:你)?(?:的建议)?|感谢(?:你)?|多谢|好的|嗯|明白了|知道了|收到|好|这很有帮助|我明白(?:怎么做)?了)'
 if(clauses.some(c=>!c.quoted&&!c.code&&!c.attributedToOther&&c.interrogative))return false
 if(clauses.some(c=>!c.quoted&&!c.code&&!c.attributedToOther&&/^(?:(?:补充|更正|纠正)(?:一下)?[:：\s]*)?(?:换个话题|另一个问题|另外一件事|普通问题|今天到这里|不用比较了|先这样|就这样|先到这里)/.test(c.text.trim())))return false
 if(activityScopedDecisionTime(text))return false
 const leading=text.trim().replace(new RegExp('^(?:'+ack+'[。！!，,\\s]+)+'),'')
 return clauses.length>0&&clauses.every(c=>!c.quoted&&!c.code&&!c.attributedToOther&&new RegExp('^'+ack+'[。！!\\s]*$').test(c.text.trim()))||/^(?:另外|再)?(?:我)?(?:再)?(?:补充|更正|纠正)(?:一下|[:：，,]|(?=我|本人))/.test(leading)
}
// Bounded projection of explicit trial assumptions, never a complete language
// interpreter or personal-fact parser. The original text remains in the same
// provider call; unknown does not certify an action as feasible.
function conditionUpdate(text:string,base:DecisionConditions,restoreFrom?:DecisionConditions,owner?:DecisionConditionSource):DecisionConditions{
 const next={...base,unavailableResources:[...base.unavailableResources],sources:{...base.sources},...(base.sourceRefs?{sourceRefs:{...base.sourceRefs}}:{})}
 for(const c of scanUserClauses(text)){
  if(c.quoted||c.code||c.attributedToOther||c.quoteSpans.length||c.codeSpans.length)continue
  const sourceBody=c.text.trim()
  let body=sourceBody.replace(/(?:电脑|手机|网络|预算|精力)(?:维修|使用|工程|管理)?(?:经验|技能|知识|能力|技巧|水平)/g,'')
  const activityContinuation=/^[，,]\s*(?:专门|只|仅)?((?:用来|用于|拿来)[^。！？；]+)/.exec(text.slice(c.end))
  if(/分钟|小时/.test(body)&&activityContinuation&&!globalTimeTail(activityContinuation[1]!))continue
  const discarded=/(?:不|不要|不再|别|无需|不用)(?:再)?沿用/.exec(body)
  if(discarded){
   const start=discarded.index+discarded[0].length,replacement=/(?:改成|改为|改用|缩为)/.exec(body.slice(start))
   const scope=body.slice(start,replacement?start+replacement.index:body.length).replace(/^(?:上次|上轮|之前|原来|旧)(?:的)?/,'').replace(/(?:的)?(?:假设|试算|条件).*$/,'')
   if(restoreFrom&&ownsDecisionConditionSubject(scope)){
    const keys:Array<keyof Pick<DecisionConditions,'minutes'|'continuousMinutes'|'energy'|'network'|'contact'>>=[]
    if(/时间|分钟|小时/.test(scope))keys.push('minutes')
    if(/专注/.test(scope))keys.push('continuousMinutes')
    if(/精力|疲惫|很累/.test(scope))keys.push('energy')
    if(/网络|联网|上网|断网|没网|上不了网|联不了网/.test(scope))keys.push('network')
    if(new RegExp(contactOperation).test(scope))keys.push('contact')
    for(const key of keys)inheritField(next,restoreFrom,key)
    for(const resource of scope.match(new RegExp(resourceName,'g'))??[])if(resource!=='网络')inheritField(next,restoreFrom,resource)
   }
   if(!replacement)continue
   body=body.slice(start+replacement.index)
  }
  body=body.replace(/^(?:另外|再)?(?:我)?(?:再)?(?:补充|更正|纠正)(?:一下)?[:：，,\s]*/,'')
  const subject=conditionSubject(body)
  if(!ownsDecisionConditionSubject(body))continue
  if(/^(?:那)?(?:如果|假设|假如|要是)?(?:他|她|同学|室友|别人|我(?:的)?(?:同学|室友))|^(?:请)?(?:不要|别)(?:再)?(?:复述|解释|追问|描述)/.test(body)||/(?:不沿用|不要.*假设|不把.*假设)/.test(body)&&!/(?:改成|改为|改用|缩为)/.test(body))continue
  if(withoutLimit(body,'时间')){next.minutes=null;next.sources.minutes=sourceBody}
  else if(/^(?:那|如果|假设|假如|要是)?(?:我|本人)?(?:现在|目前|这次|今天)?(?:没(?:有)?(?:任何)?(?:可用)?时间|无可用时间)[。！？?！\s]*$/.test(body)){next.minutes=0;next.sources.minutes=sourceBody}
  const availability='(?:只有|只剩(?:下)?|仅剩(?:下)?|还剩(?:下)?|(?:只(?:能|可)|最多(?:能|可)?)(?:用|花)|最多可用|可用的?(?:时间)?(?:只有|仅有|为|是|有)?|(?:我|这次|实际|现在|仍)(?:这次|现在|实际|仍)*有|改成|改用|缩为|有)'
  const half=new RegExp(availability+'\\s*((?:一个|一)?小时半|(?:一个|一)?半(?:小时|钟头))').exec(body)
  const budget=new RegExp(availability+'\\s*'+amount+'\\s*(分钟|小时)(半)?').exec(body)
  const personalTime=(match:RegExpExecArray)=>{
   const prefix=body.slice(0,match.index).split(/[:：]/).at(-1)!.trim().replace(new RegExp('(?:'+uncertaintyWords+')$'),''),tail=body.slice(match.index+match[0].length).replace(/^(?:左右|上下)/,'')
   return globalTimeTail(tail)&&(/^(?:我|本人|改成|改为|改用|缩为)/.test(match[0])||/(?:我|本人)(?:现在|这次|实际|今天|目前|总共|仍|仍然|本次|这轮|还|就|只|最多|剩余)*$|(?:改成|改为|改用|缩为)$/.test(prefix)||/^(?:我|本人)在[^。]{0,40}的?情况下$/.test(prefix)||/^(?:我|本人)?(?:手头|当前|本次)?(?:这些|全部|所有|这几)(?:事|事项|任务)(?:一共|总共|合计)?$/.test(prefix)||/^(?:那|如果|假设|假如|要是|现在|实际|今天|这次|本次|目前|这周|本周|下周|每天|每周|仍|沿最初真实基线|请按|按)*$/.test(prefix))
  }
  const uncertain=new RegExp(availability+'[^。]{0,12}(?:分钟|小时|钟头)').exec(body)
  const uncertainFor=(pattern:string)=>new RegExp('(?:'+uncertaintyWords+')(?:(?!分钟|小时|时间|精力|网络|电脑|手机)[^。！？；，,但而且和或、]){0,8}(?:'+pattern+')').test(body)
  const personalUnknown=/(?:我|本人|本次|这次|现在|当前)[^。]{0,12}(?:可用的?时间|可支配的?时间|有多少时间|还有多少时间|有时间|没有时间|没时间|剩余时间|还剩多少时间|剩多少时间)|^(?:可用的?时间|可支配的?时间|时间预算)/.test(body)
  const budgetApprox=Boolean(budget&&personalTime(budget)&&(uncertainFor(availability)||new RegExp(uncertaintyWords).test(budget[0])||/^(?:左右|上下)/.test(body.slice(budget.index+budget[0].length))))
  const freeTextApprox=Boolean(!budget&&uncertain&&personalTime(uncertain)&&new RegExp(uncertaintyWords).test(uncertain[0]))
  const boundedTime=/(?:我|本人)(?:现在|目前|这次|实际|只有|仅有|还剩|的可用时间)*(?:不到|不足|至少|超过|多于|少于)\s*[0-9零一二两三四五六七八九十百]+\s*(?:分钟|小时)(.*)/.exec(body)
  const uncertainTime=new RegExp(uncertaintyWords).test(body)&&(personalUnknown||budgetApprox)||freeTextApprox||Boolean(boundedTime&&globalTimeTail(boundedTime[1]!))
  const necessaryResources=new Set([...body.matchAll(new RegExp('(?:不能|不可以|不可|无法|不应)(?:缺少|没有|没|无)('+resourceGroup+')','g'))].flatMap(match=>match[1]!.match(new RegExp(resourceName,'g'))??[]))
  const uncertainEnergy=uncertainFor('精力|体力|疲惫|很累'),uncertainFocus=uncertainFor('专注'),uncertainNetwork=necessaryResources.has('网络')||uncertainFor('网络|联网|上网|断网'),uncertainContact=uncertainFor(contactOperation)
  if(uncertainTime){next.minutes=null;next.sources.minutes=sourceBody}
  if(!uncertainTime){
  if(half&&personalTime(half)){next.minutes=/(?:每周|每天|本周|这周|下周)/.test(body)&&!/(?:本次|这次|现在|当前)/.test(body)?null:parseExactHours(half[1]!);next.sources.minutes=sourceBody}
  else if(!budget&&uncertain&&personalTime(uncertain)){next.minutes=null;next.sources.minutes=sourceBody}
  if(budget&&personalTime(budget)&&!/^\s*(?:后|以后|之后|才能|路程|等待)/.test(body.slice(budget.index+budget[0].length))&&(!/(?:不是|并非|没说|不要)/.test(body.slice(0,budget.index))||/(?:改成|改为|改用|缩为)/.test(body.slice(0,budget.index)))){
   let minutes=budget[2]==='小时'?parseExactHours(budget[1]!):chineseInteger(budget[1]!)
   if(budget[3])minutes=budget[2]==='小时'&&minutes!==null?minutes+30:null
   next.minutes=null;next.sources.minutes=sourceBody
   if(minutes!==null&&Number.isSafeInteger(minutes)&&minutes>=0&&minutes<=10080){next.minutes=/(?:每周|每天|本周|这周|下周)/.test(body)&&!/(?:本次|这次|现在|当前)/.test(body)?null:minutes;next.sources.minutes=sourceBody}
  }
  }
  if(/(?:不是|并非|没说|不代表|不等于)/.test(body)){
   if(/网络|联网|上网|断网|没网/.test(body)){next.network=!uncertainNetwork&&/网络(?:并非|不是)(?:不可用|不能用|用不了)/.test(body)?true:null;next.sources.network=sourceBody}
   if(/精力|体力|疲惫|很累/.test(body)){next.energy='unknown';next.sources.energy=sourceBody}
   if(new RegExp(contactOperation).test(body)){next.contact=null;next.sources.contact=sourceBody}
   for(const resource of body.match(new RegExp(resourceName,'g'))??[]){next.unavailableResources=next.unavailableResources.filter(x=>x!==resource);next.sources[resource]=sourceBody}
   anchorSources(next,sourceBody,owner)
   continue
  }
  if(uncertainEnergy){next.energy='unknown';next.sources.energy=sourceBody}
  else if(withoutLimit(body,'精力')){next.energy='unknown';next.continuousMinutes=null;next.sources.energy=sourceBody;delete next.sources.continuousMinutes}
  else if(/(?:不再|已经不|已不)(?:疲惫|很累|精力不足)/.test(body)){next.energy='unknown';next.continuousMinutes=null;next.sources.energy=sourceBody;delete next.sources.continuousMinutes}
  else if(/精力(?:很|非常|比较)?(?:低|不足|差|耗尽)|没有精力|疲惫|很累/.test(body)){next.energy='low';next.sources.energy=sourceBody}
  else if(/精力(?:很|非常)?(?:充足|充沛|足)/.test(body)){next.energy='adequate';next.continuousMinutes=null;next.sources.energy=sourceBody;delete next.sources.continuousMinutes}
  const focus=new RegExp('(?:难(?:以)?(?:连续)?专注超过|(?:每次)?(?:只能|最多)(?:连续)?专注)\\s*'+amount+'\\s*分钟').exec(body)
  if(uncertainFocus){next.continuousMinutes=null;next.sources.continuousMinutes=sourceBody}
  else if(focus){const minutes=chineseInteger(focus[1]!);if(minutes!==null&&minutes>=0){next.continuousMinutes=minutes;next.sources.continuousMinutes=sourceBody}}
  if(uncertainNetwork){next.network=null;next.sources.network=sourceBody}
  else if(withoutLimit(body,'网络')){next.network=null;next.sources.network=sourceBody}
  else if(/(?:不能|无法|没法|不可|不可以)(?:联网|上网)|网络(?:都)?(?:不|没)(?:可用|正常|能用)|网络不可用|(?:没有|无)网络(?!的?限制)|连不上网|上不了网|联不了网|没网|断网|(?:分钟|小时)(?:后|以后|之后)才(?:能|可以)(?:联网|上网)/.test(body)){next.network=false;next.sources.network=sourceBody}
  else if(/网络(?:都)?(?:可用|可以用|能用|正常|恢复了|已恢复)|(?:能|可以)(?:上网|联网)/.test(body)){next.network=true;next.sources.network=sourceBody}
  if(uncertainContact){next.contact=null;next.sources.contact=sourceBody}
  else if(new RegExp('(?:不能|无法|没法|禁止|不要|不可以)(?:(?:给|向|和|与)[\\p{L}\\p{N}]{1,12})?'+contactOperation+'|禁止外部联系|(?:联系|沟通|发消息|发邮件|打电话|见面)不了','u').test(body)){next.contact=/(?:不能|无法|没法|禁止|不要|不可以)(?:与|和)?(?:任何人|所有人)(?:联系|沟通)|(?:不能|无法|没法|禁止|不要|不可以)(?:联系|沟通)(?:任何人|别人|外界|外部)|禁止外部联系|(?:不能|无法|没法)(?:联系|沟通)[呢？?。！\s]*$/.test(body)?false:null;next.sources.contact=sourceBody}
  else if(new RegExp('(?:可以|可)(?:(?:给|向|和|与)[\\p{L}\\p{N}]{1,12})?'+contactOperation,'u').test(body)){next.contact=true;next.sources.contact=sourceBody}
  else if(withoutLimit(body,'联系')){next.contact=null;next.sources.contact=sourceBody}
  const physicalBody=body.replace(/(?:电脑|手机)(?:的)?(?:维修(?:经验|能力|技术)?|使用经验|信号|配件|型号|品牌|价格|配置|知识)/g,'')
  const resourceChanges=new Map<string,{available:boolean;index:number}>()
  for(const [available,pattern] of [[false,'(?:没有|没|无|缺少|不能使用|无法使用|不能用|不可以使用|不可以用|不能|无法|不可以)('+resourceGroup+')|('+resourceGroup+')(?:现在|已经|目前)?(?:都|均)?(?:不可用|不能用|用不了)'],[true,'(?:有|可以使用|能使用|可以用|能用|可以|能)('+resourceGroup+')|('+resourceGroup+')(?:现在|已经|目前)?(?:都|均)?(?:可用|能用)']] as const){
   for(const match of physicalBody.matchAll(new RegExp(pattern,'g'))){if(available&&/(?:不|没|无|不能|无法|不可以)\s*$/.test(physicalBody.slice(0,match.index)))continue;for(const resource of (match[1]??match[2]??'').match(new RegExp(resourceName,'g'))??[]){if((resourceChanges.get(resource)?.index??-1)<=match.index)resourceChanges.set(resource,{available,index:match.index})}}
  }
  const networkResource=resourceChanges.get('网络')
  if(networkResource&&!uncertainNetwork&&!withoutLimit(body,'网络')){next.network=networkResource.available;next.sources.network=sourceBody}
  for(const resource of ['电脑','手机','材料','场地','预算','设备','资源','外出']){
   if(necessaryResources.has(resource)||uncertainFor(resource)){next.unavailableResources=next.unavailableResources.filter(x=>x!==resource);next.sources[resource]=sourceBody;continue}
   if(withoutLimit(body,resource)||body.includes(resource+'不限')){next.unavailableResources=next.unavailableResources.filter(x=>x!==resource);next.sources[resource]=sourceBody;continue}
   const change=resourceChanges.get(resource)
   if(change){next.unavailableResources=next.unavailableResources.filter(x=>x!==resource);if(!change.available)next.unavailableResources.push(resource);next.sources[resource]=sourceBody}
  }
  // New owned condition prose may use predicates outside this bounded parser.
  // Never present the prior known value as current when that field was raised
  // again but not understood. The same provider call receives the original.
  const descriptive=c.conditional||/^(?:我|本人|(?:现在|目前|这次|实际)?(?:网络|联网|上网|精力|体力|疲惫|很累|时间|可用时间|外部联系|联系|电脑|手机|材料|场地|预算|设备|资源|外出))/.test(subject)
  if(descriptive){
   if(/网络|联网|上网|断网/.test(body)&&next.sources.network!==sourceBody){next.network=null;next.sources.network=sourceBody}
   if(new RegExp(contactOperation).test(body)&&next.sources.contact!==sourceBody){next.contact=null;next.sources.contact=sourceBody}
   if(/精力|体力|疲惫|很累/.test(body)&&next.sources.energy!==sourceBody){next.energy='unknown';next.continuousMinutes=null;next.sources.energy=sourceBody;delete next.sources.continuousMinutes}
   if(/专注(?:的)?(?:上限|时长|时间|能力|限制)|(?:难以|只能|最多|无法|不能|没法)(?:连续)?专注|连续专注(?:不|没|未|很|超过|不到|最多|最少|只能|仅|至多|至少|不足)/.test(body)&&next.sources.continuousMinutes!==sourceBody){next.continuousMinutes=null;next.sources.continuousMinutes=sourceBody}
   for(const resource of physicalBody.match(new RegExp(resourceName,'g'))??[])if(resource!=='网络'&&next.sources[resource]!==sourceBody){next.unavailableResources=next.unavailableResources.filter(x=>x!==resource);next.sources[resource]=sourceBody}
   const personalTimeField=/(?:我|本人)(?:现在|目前|这次|本次|实际|的)*(?:时间|可用的?时间|可支配的?时间)|^(?:那|如果|假设|假如|要是)?(?:这次|本次|当前|现在|实际)?(?:时间|可用的?时间|可支配的?时间)|(?:手头|当前|本次)?(?:这些|所有|全部)(?:事|事项|任务)(?:一共|总共|合计)?(?:时间|可用的?时间)/.test(body)
   if(personalTimeField&&next.sources.minutes!==sourceBody){next.minutes=null;next.sources.minutes=sourceBody}
  }
  anchorSources(next,sourceBody,owner)
 }
 return next
}
export function compileDecisionConditions(baselineText:string|DecisionConditions,currentText:string,restoreFrom?:DecisionConditions,owner?:DecisionConditionSource):DecisionConditions{
 return conditionUpdate(currentText,typeof baselineText==='string'?conditionUpdate(baselineText,emptyConditions()):baselineText,restoreFrom,owner)
}
export function ownsDecisionCondition(text:string,quote:string):boolean{
 return scanUserClauses(text).some(c=>!c.quoted&&!c.code&&!c.attributedToOther&&!c.quoteSpans.length&&!c.codeSpans.length&&c.text.trim()===quote)
}
export function authorizedDecisionConditions(value:DecisionConditions,texts:string[],rows?:Array<{id:string;content:string;kind:'actual'|'trial'}>):DecisionConditions{
 const next={...value,unavailableResources:[...(value.unavailableResources??[])],sources:{...value.sources},...(value.sourceRefs?{sourceRefs:{...value.sourceRefs}}:{})}
 const authorized=(key:string)=>Boolean(value.sources[key]&&(rows?value.sourceRefs?.[key]&&rows.some(row=>row.id===value.sourceRefs![key]!.messageId&&row.kind===value.sourceRefs![key]!.kind&&ownsDecisionCondition(row.content,value.sources[key]!)):texts.some(text=>ownsDecisionCondition(text,value.sources[key]!))))
 for(const key of ['minutes','continuousMinutes','energy','network','contact'] as const){if(!authorized(key)){if(key==='energy')next.energy='unknown';else next[key]=null}}
 next.unavailableResources=next.unavailableResources.filter(authorized)
 for(const key of Object.keys(next.sources))if(!authorized(key))delete next.sources[key]
 for(const key of Object.keys(next.sourceRefs??{}))if(!authorized(key))delete next.sourceRefs![key]
 return next
}
const allocationBasisSchema=Type.Union([Type.Literal('relative_priority'),Type.Literal('current_budget'),Type.Literal('known_constraint'),Type.Literal('waiting_external'),Type.Literal('keep_paused'),Type.Literal('unknown_conditions')])
const proposalItem=Type.Object({allocationBasis:Type.Optional(allocationBasisSchema),eventId:Type.String({pattern:'^[0-9a-fA-F-]{36}$'}),mode:Type.Union([Type.Literal('do_now'),Type.Literal('prepare_only'),Type.Literal('wait'),Type.Literal('leave_stopped')]),minutesCeiling:Type.Union([Type.Integer({minimum:0,maximum:10080}),Type.Null()])},{additionalProperties:false})
export const decisionProposalSchema=Type.Object({
 items:Type.Array(proposalItem,{maxItems:14,description:'原事项逐项一次，按本次建议先后排列；do_now/prepare_only是建议，不代表用户接受或执行。分钟是本次投入上限，不是完成保证；wait/leave_stopped填0。'}),
 orderRelation:Type.Union([Type.Literal('baseline'),Type.Literal('same_order'),Type.Literal('scope_changed'),Type.Literal('reordered')]),
 changeExplanation:Type.Optional(Type.String({minLength:4,maxLength:1500})),
 stableExplanation:Type.Optional(Type.String({minLength:4,maxLength:1500})),
},{additionalProperties:false})
export type DecisionProposal=Static<typeof decisionProposalSchema>
type PreviousDecision=Pick<DecisionProposal,'items'>&{scopeChanged?:boolean;firstChoiceUnavailable?:boolean}
export type DecisionCase={eventId:string;title:string;allowedModes:readonly string[];networkBlocked:boolean;contactBlocked:boolean;blockedResources:string[];sourceFacts:string[];unresolvedQuestions?:string[];matterProgress?:Pick<NonNullable<CoachEvent['matterProgress']>,'state'|'choice'|'recommendationStopped'>;currentReport?:string;deadlineReported:boolean;externalResult:null|{status:'pending';independentPreparation:'not_assessed'};completionGuarantee:'not_established'}
function requiresOperation(text:string,operation:string):boolean{
 return [...text.matchAll(new RegExp(operation,'gu'))].some(match=>{
  const prefix=text.slice(0,match.index)
  if(/(?:不|不用|无需|不要|不需要|不要求|不必|没必要|没有必要|不能|无法|禁止)(?:再|直接|先)?(?:外部)?(?:(?:给|向|和|与)[\p{L}\p{N}]{1,12})?$/u.test(prefix))return false
  const last=(words:string[])=>Math.max(-1,...words.map(word=>prefix.lastIndexOf(word)))
  if(last(['曾经','过去','以前','此前','上次','昨天','上周'])>last(['现在','目前','当前','接下来','下一步','还要','仍需']))return false
  if(/(?:已经|已)[^。！？]{0,12}$/.test(prefix)&&!/(?:需要|必须|还要|准备|打算|即将|接下来|下一步)/.test(prefix+match[0]))return false
  return true
 })
}
export function projectDecisionCases(events:CoachEvent[],conditions:DecisionConditions,currentReport?:{eventId:string;quote:string}):DecisionCase[]{
 return events.map(event=>{
  const sourceFacts=event.nodes.filter(n=>n.kind==='fact'&&n.status==='active').map(n=>n.content)
  const unresolvedQuestions=event.nodes.filter(node=>node.kind==='unknown'&&node.status==='active'&&!node.supersededByActionCorrection).map(node=>node.content)
  const ownedClauses=sourceFacts.flatMap(q=>scanUserClauses(q)).filter(c=>!c.quoted&&!c.code&&!c.attributedToOther&&!c.quoteSpans.length&&!c.codeSpans.length)
  const progress=event.matterProgress
  const matterProgress=progress?{state:progress.state,choice:progress.choice,recommendationStopped:progress.recommendationStopped}:undefined
  const currentQuote=currentReport?.eventId===event.id?currentReport.quote:undefined
  const stopped=progress?.recommendationStopped||['paused','ended','completed'].includes(progress?.state??'')
  const networkOperation=ownedClauses.some(c=>requiresOperation(c.text,'(?:修改[^。]{0,12}在线[^。]{0,12}权限|联网|上网|登录(?:网站|系统)|打开网页|云端表单|在线[^。]{0,12}(?:提交|报名|填|保存|修改|查|下载|上传|访问|登录))'))
  const networkBlocked=conditions.network===false&&networkOperation
  const contactBlocked=conditions.contact===false&&ownedClauses.some(c=>requiresOperation(c.text,contactOperation))
  const blockedResources=conditions.unavailableResources.filter(resource=>ownedClauses.some(c=>requiresOperation(c.text,'(?:必须|需要|要用|只能)(?:使用|用)?(?:一台|一部|一份|这些|这个)?'+resource)))
  const waiting=progress?.state==='waiting_result'
  const deadlineReported=ownedClauses.some(c=>/(?:截止|(?:需要|要求|需)[^。]{0,35}前)/.test(c.text)&&!/(?:(?:没有|无|不设|未设|不知|未确定|未确认|不清楚)[^。]{0,8}(?:截止|期限)|(?:截止|期限)[^。]{0,12}(?:未知|未定|未确定|未确认|不清楚|没定|没说)|(?:不需要|不要求|无需|不必|并非要求)[^。]{0,35}前)/.test(c.text))
  return {eventId:event.id,title:event.title,allowedModes:stopped?['leave_stopped']:conditions.minutes===0||conditions.continuousMinutes===0?['wait']:networkBlocked||contactBlocked||blockedResources.length||waiting?['prepare_only','wait']:['do_now','prepare_only','wait'],networkBlocked,contactBlocked,blockedResources,sourceFacts,...(unresolvedQuestions.length?{unresolvedQuestions}:{}),...(matterProgress?{matterProgress}:{}),...(currentQuote?{currentReport:currentQuote}:{}),deadlineReported,externalResult:waiting?{status:'pending',independentPreparation:'not_assessed'}:null,completionGuarantee:'not_established'}
 })
}
export function decisionOrderRelation(items:DecisionProposal['items'],previous?:PreviousDecision|null):DecisionProposal['orderRelation']{
 if(!previous)return 'baseline'
 const order=(rows:DecisionProposal['items'])=>rows.filter(activeDecisionItem).map(x=>x.eventId)
 const before=order(previous.items),after=order(items)
 if(JSON.stringify(before)===JSON.stringify(after))return previous.scopeChanged||items.some(item=>{const old=previous.items.find(x=>x.eventId===item.eventId);return !old||old.mode!==item.mode||old.minutesCeiling!==item.minutesCeiling||(old.allocationBasis!==undefined&&item.allocationBasis!==undefined&&old.allocationBasis!==item.allocationBasis)})?'scope_changed':'same_order'
 if(before[0]!==after[0])return 'reordered'
 const shared=before.filter(id=>after.includes(id))
 return JSON.stringify(shared)===JSON.stringify(after.filter(id=>before.includes(id)))?'scope_changed':'reordered'
}
const activeDecisionItem=(x:DecisionProposal['items'][number])=>['do_now','prepare_only'].includes(x.mode)&&(x.minutesCeiling===null||x.minutesCeiling>0)
const minuteCap=(conditions:DecisionConditions)=>conditions.minutes===null&&conditions.continuousMinutes===null?null:Math.min(conditions.minutes??Infinity,conditions.continuousMinutes??Infinity)
export function decisionAllocationBases(own:DecisionCase,conditions:DecisionConditions):string[]{
 if(own.allowedModes.includes('leave_stopped'))return ['keep_paused']
 return ['relative_priority','unknown_conditions',...(conditions.minutes!==null||conditions.continuousMinutes!==null?['current_budget']:[]),...(own.networkBlocked||own.contactBlocked||own.blockedResources.length?['known_constraint']:[]),...(own.externalResult?['waiting_external']:[])]
}
const decisionModeMeanings:Record<string,string>={
 do_now:'该次建议直接推进事项的实际内容，可以只完成一部分；正文必须说明有意义的实际起步，不能改称仅做准备，不保证整项完成。',
 prepare_only:'该次建议做准备或条件确认。有明确本人来源的前置条件才可称为阻塞；未评估时保留未知，不能仅因整项耗时大于该次额度就降为只能准备。',
 wait:'仅表示该次建议分配0分钟，不能据此推断没有自主动作；有本人明确来源时忠实保留，否则自主准备是否存在仍未知。',
 leave_stopped:'保持用户已暂停、结束或完成的状态，该次建议不安排，不催促恢复。',
}
const minutesCeilingMeaning='该次建议投入上限，既不是保证完成所需时间，也不是已验证的任务耗时；0只表示该次未分配。'
const candidateKinds=(own:DecisionCase)=>own.allowedModes.includes('do_now')?['advance','prepare','none']:own.allowedModes.includes('prepare_only')?['prepare','none']:['none']
const candidateKindMeaning='本轮选择：advance直接推进，prepare做有需要的准备，none本轮暂不安排并填0分钟。每件事都可选择none；候选方式不是必须做的清单。暂不安排不等于不能推进，暂停事项仍保持暂停。'
const decisionTimeScopeRule='把分钟写成这次可投入的上限。投入变少时缩小实际起步范围。最低起步耗时只按本人报告，未报告则保持未知。对零投入事项，只按相对优先级、本人明确暂停或已知资源限制说明本轮暂不安排。不要以分配的分钟不够为由断定某事项无法开始或推进。'
const decisionDeliveryRule='直接说明本轮优先事项。需要对照且上次优先事项已知时，也说清上次选的是哪件事。用紧凑段落交代有价值的起步、投入上限、停点与必要依据。不要逐项重复套“理由与依据／行动起步／仍待核实”栏目，不写开场流程说明，不复制整组来源或再作排序总结。同一事实、边界或未知只说一次；等待和停止项只说必要处置。默认不为等待项安排查漏、补附件等无已知需要的动作；可以暂不分配时间，保留独立准备是否需要的未知。所有用户可见状态用自然中文，如等待反馈、尚未执行、暂停、结束，不复制内部英文状态码。保留未分配时间，不为凑满预算放大任务时长；明显偏离本人同范围耗时估计须有具体依据。截止逐项比较，未说明期限来自谁时不推断唯一外部硬截止。用户要求深入时充分展开，正文仍完整自然收束。'
export const decisionMaterialAccessRule='材料是否可用按已知来源判断。尚未确认时，先说明材料可用时才起步。恢复真实条件也适用。已记录的未答问题只作为所属事项的待核对条件。筛选证据若依赖主题、目标或匹配标准，缺少该前提时只做初步整理或给出条件式起步，不把尚未核对的证据称为相关或最适合。'
export const lowEnergyStartScope='原步骤含多个对象时，只处理原动作的第一个对象。原步骤只有一个对象时，推进它的第一个有价值部分。'
const lowEnergyWorkRule='workScope为smallest_substep且确有投入时，先写本次实际要做的范围。'+lowEnergyStartScope+'例如原定整理三份资料，本次只整理第一份，另外两份留待以后。原总量只作已接受的背景，起步动作不写原总量。不并列不同的起步动作。整体目标和接受状态保留，未接受的只称建议。零投入项不补行动。'
export function decisionProposalContract(cases:DecisionCase[],conditions:DecisionConditions,previous?:DecisionProposal&PreviousDecision|null):Record<string,unknown>{
 const cap=minuteCap(conditions)
 conditions={...conditions};delete conditions.sourceRefs
 const activePrevious=previous?.items.filter(activeDecisionItem)??[]
 const resolvedPrevious=previous?.items.flatMap(item=>{const caseIndex=cases.findIndex(c=>c.eventId===item.eventId);return caseIndex<0?[]:[{...item,caseIndex,title:cases[caseIndex].title,modeMeaning:decisionModeMeanings[item.mode],minutesCeilingMeaning,completionPromise:false,priorityRank:previous.firstChoiceUnavailable||!activeDecisionItem(item)?null:activePrevious.findIndex(x=>x.eventId===item.eventId)+1}]})
 const suppliedCases=cases.map(({allowedModes,networkBlocked,contactBlocked,blockedResources,deadlineReported,...c},caseIndex)=>{
  const kinds=candidateKinds(cases[caseIndex])
  return {
   ...c,caseIndex,deadlineStatus:deadlineReported?'reported_date':'no_known_date',candidateKinds:kinds,
   ...(conditions.energy==='low'&&cap!==0&&kinds.length>1?{
    workScope:'smallest_substep',
    currentStart:{maximumUnits:1,unit:'first_item_substep',materialAccess:conditions.network===false?'local_if_available':'as_reported'},
   }:{}),
   ...(networkBlocked?{networkBlocked}:{}),...(contactBlocked?{contactBlocked}:{}),...(blockedResources.length?{blockedResources}:{}),
  }
 })
 return {
  modeMeanings:{...decisionModeMeanings},minutesCeilingMeaning,candidateKindMeaning,cases:suppliedCases,conditions,
  previousProposal:previous?{items:resolvedPrevious,scopeChanged:previous.scopeChanged??false,firstChoiceUnavailable:previous.firstChoiceUnavailable??false}:null,
  minuteCeiling:cap,
  feasibilityRules:['整项任务耗时估计与最低起步门槛分别判断。没有本人报告的最低起步门槛时，该门槛未知。短时也可做有实际进展的部分；本轮因优先级不分配，不等于不能推进。','advance包含在上限内直接推进一部分，不要求整项完成；prepare只做准备或条件确认。不要仅因完整任务预计更久就把直接推进降为只能准备。','建议小步要推进实际目的，不以打开文件、看一眼页面等无实质进展的点击替代有价值起步。到点核对或停止，完成与否未知。','等待回复本身不证明有无独立准备；本人来源未说明时保持未知。可以暂不分配本轮时间，不可无来源地写无需动作或没有自主动作。'],
  rule:decisionDeliveryRule+decisionTimeScopeRule+'先按conditions中本轮有效条件生成decisionProposal，再生成唯一完整reply。items按建议先后填写：每个caseIndex恰好一次，顺序和投入上限与正文一致；kind取自candidateKinds，仅表示候选起步方式；minutesCeiling为0即本轮未安排，不管候选方式是什么。已知时间时填非负整数，各项总和不超过minutes，单项不超过continuousMinutes；暂停或零时间填0。时间上限未知时安排项填null，未安排填0。正文分别给当前进展、投入上限和停点，未分配部分留给本人决定。各事项保留已报告的截止时间，只在有来源的时间点之间比较早晚。no_known_date只表示没有已核实的时间点。本人明确报告没有截止时保留该事实；紧迫性仍须有独立来源。已暂停事项只说明按本人意愿继续暂停，不另给截止或紧迫性理由。previousProposal的分钟是上次建议投入，不是完成耗时；只说明实际改变与未知。本人已有明确来源忠实保留；其他未知不推断为不存在。整项耗时只按本人已报告的估计。记录只是建议，用户选择与执行仍按原流程确认。正文用自然中文事项名称与步骤说明；程序字段和英文状态只留在提案中。截止只复述已给定的日期时间，早晚比较不新增未经核对的天或小时差。'+(suppliedCases.some(item=>item.workScope)?lowEnergyWorkRule:''),
 }
}
export function bindDecisionProposalSchema(schema:Record<string,any>,cases:DecisionCase[],conditions:DecisionConditions,previous?:DecisionProposal|null):Record<string,any>{
 const cap=minuteCap(conditions)
 const options=cases.flatMap((c,caseIndex)=>{
  const active=candidateKinds(c).filter(kind=>kind!=='none')
  return [...(active.length?[active]:[]),['none']].map(kinds=>({type:'object',additionalProperties:false,required:['caseIndex','kind','minutesCeiling'],properties:{caseIndex:{type:'integer',enum:[caseIndex]},kind:{type:'string',enum:kinds,description:candidateKindMeaning},minutesCeiling:kinds[0]==='none'?{type:'integer',enum:[0]}:cap===null?{anyOf:[{type:'null'},{type:'integer',enum:[0]}]}:{type:'integer',minimum:0,maximum:cap}}}))
 })
 const proposal={type:'object',additionalProperties:false,required:['items'],properties:{items:{type:'array',minItems:cases.length,maxItems:cases.length,allOf:cases.map((_,caseIndex)=>({contains:{type:'object',required:['caseIndex'],properties:{caseIndex:{const:caseIndex}}},minContains:1,maxContains:1})),items:{anyOf:options}}}}
 const offlineReply=conditions.network===false?'行动需要材料且本地材料能否打开未知时，先写“若材料已经可以离线打开”或同义条件，再给实际起步。若没有可打开的材料，说明缺哪项后停止，不把未经报告的记忆当作现有材料。已有明确可离线打开的本人来源时直接用。未列出阻塞仅表示未确认有阻塞，不宣称某候选是唯一可执行的动作。':''
 const canAllocate=cap!==0&&cases.some(item=>item.allowedModes.includes('do_now')||item.allowedModes.includes('prepare_only'))
 const lowEnergyReply=conditions.energy==='low'&&canAllocate?lowEnergyWorkRule:''
  const currentReportReply=cases.some(item=>item.currentReport)
    ?'同一事项有currentReport时，优先承接本轮实际报告和对应的matterProgress。旧来源继续作为历史事实，不能推翻本轮明确更新。'
    :''
  const acceptedStepReply=cases.some(item=>item.matterProgress?.choice==='accepted')
    ?'按同一事项的matterProgress和来源分别保留接受、实际执行与暂停。已接受的步骤即使暂停也仍是已接受，本人未说明时才把是否或何时恢复保留为未知。建议推进已有已接受步骤时沿用有效原话中的操作，本次范围以有效条件与workScope为准。缩小时只减少同一操作的工作量，不并列另一种起步动作。恢复现实条件后按实际限制决定本次范围，保留原步骤目标。原动作未说明就保留未知。主题未知时说明起步所需条件，不据此改换操作。本人明确要求替代或原动作确实受限时，才给有依据的备选。'
    :''
  const reply={...schema.properties.reply,description:(schema.properties.reply.description??'')+'正文与先前生成的提案一致：直接推进不能在正文改称仅做准备；不能仅因不分配时间就推断没有自主动作；有本人明确来源则忠实保留。上次和本次的分钟始终是投入上限，不能改述为完成承诺。完整回答并自然收束，不以未写完的比较、从句或项目结尾。时间变短时分别说明投入上限和本次实际可做的范围；'+decisionTimeScopeRule+'未报告的截止与紧迫性保持未知；已暂停事项按本人原话保留状态，不安排工作或另猜暂停原因。'+currentReportReply+acceptedStepReply+decisionMaterialAccessRule+offlineReply+lowEnergyReply}
 const properties={...schema.properties};delete properties.decisionProposal;delete properties.reply
 return {...schema,properties:{decisionProposal:proposal,...properties,reply},required:[...new Set([...(schema.required??[]),'decisionProposal'])]}
}
export function projectDecisionProposalWire(value:unknown,cases:DecisionCase[],conditions:DecisionConditions,previous?:PreviousDecision|null):unknown{
 if(!value||typeof value!=='object'||!Array.isArray((value as any).items))return value
 const rows=(value as any).items as unknown[]
 if(rows.some(row=>!row||typeof row!=='object'||!Object.hasOwn(row,'caseIndex')))throw new Error('DECISION_WIRE_INVALID')
 const items=rows.map(row=>{
  if(!row||typeof row!=='object'||Object.keys(row).some(key=>!['allocationBasis','caseIndex','kind','minutesCeiling'].includes(key)))throw new Error('DECISION_WIRE_INVALID')
  const {caseIndex,kind,minutesCeiling,allocationBasis}=row as {caseIndex:number;kind:string;minutesCeiling:unknown;allocationBasis?:string}
  if(!Number.isInteger(caseIndex)||caseIndex<0||caseIndex>=cases.length)throw new Error('DECISION_CASE_COVERAGE_INVALID')
  const own=cases[caseIndex]
  if(!candidateKinds(own).includes(kind))throw new Error('DECISION_ACTION_BLOCKED')
  // Zero is the declared wire representation of an unscheduled candidate, not
  // a repaired active action. Persist the established canonical state format.
  const mode=own.allowedModes.includes('leave_stopped')?'leave_stopped':kind==='none'||minutesCeiling===0?'wait':kind==='advance'?'do_now':'prepare_only'
  if(allocationBasis!==undefined&&!decisionAllocationBases(own,conditions).includes(allocationBasis))throw new Error('DECISION_ALLOCATION_BASIS_INVALID')
  return {eventId:own.eventId,mode,minutesCeiling,...(allocationBasis===undefined?{}:{allocationBasis})} as DecisionProposal['items'][number]
 })
 if(Object.keys(value).some(key=>key!=='items'))throw new Error('DECISION_WIRE_INVALID')
 return {items,orderRelation:decisionOrderRelation(items,previous)}
}
export function validateDecisionProposal(value:DecisionProposal,cases:DecisionCase[],conditions:DecisionConditions,previous:PreviousDecision|null|undefined,reply:string):void{
 const fail=(code:string):never=>{throw new Error(code)}
 if(value.items.length!==cases.length||new Set(value.items.map(x=>x.eventId)).size!==cases.length)fail('DECISION_CASE_COVERAGE_INVALID')
 let total=0
 for(const item of value.items){
  const own=cases.find(c=>c.eventId===item.eventId)
  if(!own||!own.allowedModes.includes(item.mode))fail('DECISION_ACTION_BLOCKED')
  if(item.allocationBasis&&!decisionAllocationBases(own!,conditions).includes(item.allocationBasis))fail('DECISION_ALLOCATION_BASIS_INVALID')
  const cap=minuteCap(conditions),inactive=['wait','leave_stopped'].includes(item.mode)
  if(inactive?item.minutesCeiling!==0:cap===null?item.minutesCeiling!==null:item.minutesCeiling===null||!Number.isSafeInteger(item.minutesCeiling)||item.minutesCeiling<=0||item.minutesCeiling>cap)fail('DECISION_BUDGET_EXCEEDED')
  total+=item.minutesCeiling??0
 }
 if(total>(conditions.minutes??10080))fail('DECISION_BUDGET_EXCEEDED')
 if(value.orderRelation!==decisionOrderRelation(value.items,previous))fail('DECISION_ORDER_MISMATCH')
 const asserts=(pattern:RegExp)=>scanUserClauses(reply).some(c=>{
  if(c.quoted||c.code||c.conditional||c.interrogative)return false
  const plain=c.text.split('').map((char,i)=>[...c.quoteSpans,...c.codeSpans].some(s=>c.start+i>=s.start&&c.start+i<s.end)?' ':char).join('').replace(/^[\s*#、.-]+/,'')
  const match=pattern.exec(plain)
  return Boolean(match&&!/(?:不能(?:说|断言|推出)|不可断言|不应(?:说|断言)|不会说|不认为|不推断|不等于|不意味着|不代表|并非|不是)/.test(plain.slice(0,match.index)))
 })
 if(!/[。！？!?；;）)\]】”’][\s*_]*$/.test(reply))fail('DECISION_REPLY_INCOMPLETE')
 if(asserts(/(?:[0-9一二两三四五六七八九十]+)\s*分钟(?:内)?\s*(?:完全)?(?:无法|不能|不可能|不足以|不够)(?:有效|有意义|开始|起步|推进|进展)/))fail('DECISION_UNSUPPORTED_TIME_IMPOSSIBILITY')
 if(asserts(/无(?:任何)?自主动作|没有(?:新的|任何|其他)?自主动作(?:可推进)?/)&&!cases.every(c=>c.sourceFacts.some(q=>/无(?:任何)?自主动作|没有(?:新的|任何|其他)?自主动作/.test(q))))fail('DECISION_UNSUPPORTED_NO_ACTION')
 if(value.orderRelation==='reordered'&&asserts(/^(?:(?:整体|总体|本轮|本次)的?)?(?:排序|先后顺序)(?:结论|本身)?(?:基本|仍然|仍)?(?:没有改变|不变|没变)/))fail('DECISION_REPLY_ORDER_CONTRADICTED')
 if(cases.filter(c=>c.deadlineReported&&c.allowedModes.includes('do_now')).length>1&&asserts(/唯一有(?:明确的?)?硬(?:性)?截止/))fail('DECISION_UNSUPPORTED_UNIQUE_DEADLINE')
 if(decisionReplyInternalFieldsVisible(reply,cases.map(c=>c.title)))fail('DECISION_INTERNAL_FIELDS_VISIBLE')
}

export function decisionReplyInternalFieldsVisible(reply:string,titles:readonly string[]):boolean{
 const withoutOwnedTitles=titles.reduce((body,title)=>{
  if(!title)return body
  // A bare code-shaped title must be visibly named, otherwise masking every
  // occurrence also hides the same token used as a private state label.
  if(/^[A-Za-z_][A-Za-z0-9_]*$/.test(title))return body.split('《'+title+'》').join('')
  return body.split(title).join('')
 },reply)
 return /\b(?:do_now|prepare_only|leave_stopped|waiting_result|matterProgress|currentReport|recommendationStopped|eventId|caseIndex|candidateKinds|candidateKindMeaning|minutesCeiling|allocationBasis|modeMeanings|modeMeaning|minutesCeilingMeaning|completionPromise|keep_paused|relative_priority|current_budget|known_constraint|waiting_external|unknown_conditions)\b|paused\s*\/\s*declined/.test(withoutOwnedTitles)
  ||/\bkind\b\s*["'`]*\s*(?:[:=：]|为|是|取值)\s*["'`]*\s*(?:advance|prepare|none)\b/.test(withoutOwnedTitles)
  ||/\b(?:state|choice)\b\s*["'`]*\s*(?:[:=：]|is\b|是|为|取值)\s*["'`]*\s*(?:proposed|accepted|declined|unattempted|partial|attempted|waiting_result|adjusted|paused|ended|completed|blocked|unknown)\b/i.test(withoutOwnedTitles)
}
