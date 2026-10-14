import {createHash} from 'node:crypto'
import {estimateTokens} from './context.ts'
import type {KnowledgeCard} from './campus-knowledge.ts'
import {scanUserClauses,currentConversationOnly,assistantRequestClause} from './user-command-spans.ts'

export type GuideReviewStatus='draft'|'needs_review'|'approved'|'rejected'|'retired'
export type GuideClaim={id:string;text:string;basis:'source_supported'|'bounded_synthesis'|'editorial_adaptation'|'unsupported';evidenceIds:string[];scope:string;limitations:string}
export type GuideBranch={id:string;candidateId:string;task:string;stage:string;steps:{id:string;text:string;basis:'editorial_adaptation';evidenceIds:string[]}[]}
export type EvergreenGuide={
 schemaVersion:1;guideId:string;canonicalKey:string;aliases:string[];domains:string[];task:string;stage:string;mechanism:string;
 prerequisites:string[];exclusions:string[];evidenceIds:string[];claims:GuideClaim[];sourceGroups:string[];
 principle:string;branches:GuideBranch[];oneKeyQuestion:string;smallestAction:string;exampleBudgetOnly:boolean;
 lowEnergyAlternative:string;stopConditions:string[];feedbackBranches:Record<'not_started'|'blocked'|'waiting_result'|'result'|'declined',string>;
 expectedObservation:string;retrievalSummary:string;referenceBody:string;reviewStatus:GuideReviewStatus;reviewReason:string;
 review:{reviewer:string;reviewedAt:string;sourceRevisions:Record<string,number>;supports:string[];cannotInfer:string[]}|null;
 contentHash:string;indexSignature:string;legacyIds:string[];replaces:string[];
}
export function stableJson(value:unknown):string{
 const sort=(v:any):any=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v
 return JSON.stringify(sort(value))
}
export const kbHash=(value:string)=>createHash('sha256').update(value).digest('hex')
export function guideContentHash(guide:EvergreenGuide){const {contentHash,reviewStatus,reviewReason,review,indexSignature,...body}=guide;return kbHash(stableJson(body))}
export function validateEvergreenGuide(card:KnowledgeCard){
 const g=card.guide
 if(!g)return
 const fail=()=>{throw new Error('EVERGREEN_GUIDE_INVALID')}
 if(g.schemaVersion!==1||g.guideId!==card.id||card.kind==='policy'||!['draft','needs_review','approved','rejected','retired'].includes(g.reviewStatus))fail()
 for(const key of ['canonicalKey','task','stage','mechanism','principle','oneKeyQuestion','smallestAction','lowEnergyAlternative','expectedObservation','retrievalSummary','referenceBody','reviewReason'] as const)if(typeof g[key]!=='string'||!g[key].trim())fail()
 for(const key of ['domains','prerequisites','exclusions','evidenceIds','claims','branches','sourceGroups','stopConditions'] as const)if(!Array.isArray(g[key])||!g[key].length)fail()
 if(g.contentHash!==guideContentHash(g)||!g.exampleBudgetOnly)fail()
 if(!g.feedbackBranches||['not_started','blocked','waiting_result','result','declined'].some(k=>!(g.feedbackBranches as Record<string,string>)[k]?.trim()))fail()
 const evidence=new Set(g.evidenceIds),claimIds=new Set<string>(),branchIds=new Set<string>()
 for(const claim of g.claims){
  if(claimIds.has(claim.id)||!claim.text?.trim()||!claim.scope?.trim()||!claim.limitations?.trim()||!Array.isArray(claim.evidenceIds)||claim.evidenceIds.some(id=>!evidence.has(id)))fail()
  claimIds.add(claim.id)
  if(!['source_supported','bounded_synthesis','editorial_adaptation','unsupported'].includes(claim.basis))fail()
  if(claim.basis!=='editorial_adaptation'&&(!claim.evidenceIds.length||claim.basis==='unsupported')&&g.reviewStatus==='approved')fail()
 }
 for(const branch of g.branches){
  if(branchIds.has(branch.id)||!branch.task?.trim()||!branch.stage?.trim()||!branch.steps?.length||branch.steps.some(step=>!step.id||!step.text?.trim()||step.basis!=='editorial_adaptation'||step.evidenceIds.some(id=>!evidence.has(id))))fail()
  branchIds.add(branch.id)
 }
 if(g.reviewStatus==='approved'&&(!g.review?.reviewer||!Number.isFinite(Date.parse(g.review.reviewedAt))||!g.review.supports.length||!g.review.cannotInfer.length||!Object.keys(g.review.sourceRevisions).length||card.status!=='verified'))fail()
 if(g.reviewStatus!=='approved'&&card.status==='verified')fail()
}
export function guideIsUsable(card:KnowledgeCard){return card.status==='verified'&&(!card.guide||(card.guide.reviewStatus==='approved'&&card.guide.contentHash===guideContentHash(card.guide)))}
export function canonicalGuideId(card:KnowledgeCard){return card.guide?.guideId??card.id}
export function deduplicateGuides(cards:KnowledgeCard[],limit=2){
 const ids=new Set<string>(),families=new Set<string>(),selected:KnowledgeCard[]=[]
 for(const card of cards){const id=canonicalGuideId(card),family=card.guide?.canonicalKey??card.id;if(ids.has(id)||families.has(family))continue;ids.add(id);families.add(family);selected.push(card);if(selected.length>=limit)break}
 return selected
}

export type KnowledgeDecision='NONE'|'METHOD'|'CASE'|'METHOD_CASE'|'CLARIFY'
export type KnowledgeIntent={decision:KnowledgeDecision;reason:string;query:string;stage:'start'|'adjust'|'compare';continuation:boolean}
// Only authorized event text may supply an omitted object. Never consult a
// long-term topic when the current message supplies a new object.
export function knowledgeIntent(text:string,context:{eventTitle?:string;hasPriorGuide?:boolean;lastUserTexts?:string[]}={}):KnowledgeIntent{
 const make=(decision:KnowledgeDecision,reason:string,query=text,stage:KnowledgeIntent['stage']='start',continuation=false):KnowledgeIntent=>({decision,reason,query,stage,continuation})
 if(currentConversationOnly(text))return make('NONE','listening_or_refusal')
 if(scanUserClauses(text).some(c=>!c.quoted&&!c.code&&!c.conditional&&!c.attributedToOther&&!c.interrogative&&/^(?:我)?(?:愿意|决定|打算|准备|会)(?:尝试|试试|试|使用|用|采纳|做).{0,20}(?:方法|行动|建议|刚才那一步)[。！!\s]*$/.test(c.text.trim()))&&!/不想继续|不做了|拒绝继续|不要建议/.test(text))return make('NONE','adoption_not_method_request')
 const explicitMethodUse=scanUserClauses(text).some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&/^(?:请|帮我|给我|想请你|我想请你)(?:先)?(?:用|使用|按|参考|依据)[^。！？]{0,80}(?:攻略|指南|方法)/.test(clause.text.trim()))
 const positive=explicitMethodUse||/(?:怎么|如何|怎么办|从哪|去哪|怎样|方法|办法|做法|练法|学法|写法|步骤|技巧|思路|调整|比较|对比|取舍|区别|案例|一直改稿|又改需求|有什么依据|依据支持|原理是什么|为什么有效|(?:先|该|应该|能用).{0,12}(?:什么|哪些)|有什么小尝试)/.test(text)
 const actionQuestion=/(?:能(?:不能)?|帮我|先).{0,12}(?:找|理解|整理|核对|练|开始|记录).{0,16}(?:吗|哪|[？?])/.test(text)
 const listening=/(?:只想|就想)(?:聊|倾诉|说说|吐槽)|(?:不要|不用|不想|不需要|别)(?:再)?(?:给我|帮我)?(?:建议|推荐|方法|办法|做法|练法|学法|写法|攻略|行动|复盘)|(?:我|本人).{0,6}(?:不想继续|不做了|拒绝继续)/.test(text)
 // Refusals win unless a later clause explicitly asks for a new method.
 const clauses=text.split(/[，,。；;！!\n]/),last=clauses.map(c=>({c,ask:/(?:但|不过|还是|想知道|帮我|请|想问).*(?:怎么|如何|从哪|怎样|方法|办法)/.test(c)})).filter(c=>c.c.trim()).at(-1)
 const declined=/(?:不要|别).{0,12}(?:推我|催我|给攻略|给行动)|我不做.{0,12}了/.test(text)
 if((listening||declined)&&!last?.ask)return make('NONE','listening_or_refusal')
 if(/(?:不要|别|停止|暂停).{0,8}(?:推荐|考研|使用|记忆)|(?:遗忘(?:这|那|记录|我)|忘掉|删除记录|更正|我说的是|不是我)/.test(text)&&!last?.ask)return make('NONE','control')
 if(/^(?:你好|嗨|早安|晚安|谢谢|好的|嗯|收到|继续)[!！。\s]*$/.test(text.trim()))return make('NONE','greeting')
 if(/你(?:还)?记得|我(?:之前|上次)说过什么|记忆里|记录里/.test(text)&&!positive)return make('NONE','memory_query')
 if(/(?:改短|缩短|短一点|润色|换个语气|改成一段)/.test(text)&&!/(?:方法|技巧|怎么改)/.test(text))return make('NONE','reuse_material')
 if(/治疗|用什么药|买什么股票|推荐股票|选.{0,8}股票|必涨|投资组合|法律结论|胜诉|录取概率|成功率|(?:医疗|疾病|失眠|精神).{0,8}诊断|诊断.{0,8}(?:疾病|失眠|精神)/.test(text))return make('NONE','professional_or_prediction_boundary')
 if(/^(?:这|那|这个|那件|这样|那个)(?:怎么办|怎么弄|怎么做|如何)[？?]?$/.test(text.trim())&&!context.eventTitle)return make('CLARIFY','object_missing')
 const feedback=/没(?:有)?开始|还没做|联系了|按上次|尝试|试了|试过|完成了|等待结果|没人回|没(?:有)?回复|没效果|打不开|卡住|又改需求|一直改稿|还是不行/.test(text)
 const feedbackAsks=explicitMethodUse||/(?:怎么|如何|从哪|怎样|怎么办|调整|又改需求|一直改稿)|(?:有什么|找个|推荐|给我).{0,8}(?:方法|办法|做法|练法|学法|写法|案例)/.test(text)
 if(feedback&&!feedbackAsks&&!/[？?]|取舍|比较|区分|有什么区别/.test(text))return make('NONE','inspect_feedback_first',text,'adjust',Boolean(context.hasPriorGuide))
 if(!positive&&!actionQuestion)return make('NONE','no_method_request')
 const compare=/比较|对比|案例|失败路径|区别|取舍/.test(text)
 const stage=feedback?'adjust':compare?'compare':'start'
 const omitted=/^(?:那|这|又|还是|他们|客户)/.test(text.trim())||/^(?:怎么办|怎么调整|从哪下手)[？?]?$/.test(text.trim())
 let query=omitted&&context.eventTitle?text+'\n当前事情：'+context.eventTitle:text
 // Resolve a short reference only from caller-authorized user history. Never
 // use assistant suggestions or bypass history suppression to recover a name.
 if(/^(?:那就|那|就|先)?(?:用|按|参考)(?:刚才|上次|那个|这个).{0,20}(?:攻略|指南|方法)/.test(text.trim())){
  const prior=[...(context.lastUserTexts??[])].reverse().flatMap(previous=>scanUserClauses(previous).filter(c=>!c.quoted&&!c.code&&!c.conditional&&!c.attributedToOther&&assistantRequestClause(c.text)&&/用|使用|按|参考|依据/.test(c.text)&&/攻略|指南|方法/.test(c.text)).map(c=>c.text)).find(clause=>/[“「][^”」]+[”」]/.test(clause))
  if(prior)query+='\n此前本人指定的方法：'+prior
 }
 const wantsCase=/案例|失败路径/.test(text)
 return make(wantsCase&&/方法|怎么|如何|从哪/.test(text)?'METHOD_CASE':wantsCase?'CASE':'METHOD','explicit_task',query,stage,feedback&&Boolean(context.hasPriorGuide))
}

export function guideSegments(card:KnowledgeCard){
 const g=card.guide
 if(!g)return [{part:'legacy',text:[card.claim,card.excerpt,card.scope].join('\n'),evidenceIds:[] as string[]}]
 return [
  {part:'mechanism',text:[card.title,g.mechanism,g.oneKeyQuestion,g.smallestAction,...g.branches.map(b=>b.task)].join('\n'),evidenceIds:g.evidenceIds},
  ...g.branches.map(b=>({part:'action:'+b.id,text:[card.title,...b.steps.filter(s=>!s.text.startsWith('围绕“')&&!s.text.startsWith('记录观察：')).map(s=>s.text)].join('\n'),evidenceIds:g.evidenceIds})),
  {part:'conditions',text:[card.title,...g.aliases,g.retrievalSummary,...g.prerequisites,...g.exclusions].join('\n'),evidenceIds:g.evidenceIds},
  ...g.branches.map(b=>({part:b.id,text:[b.task,b.stage,...b.steps.map(s=>s.text)].join('\n'),evidenceIds:g.evidenceIds})),
  {part:'feedback',text:JSON.stringify(g.feedbackBranches)+'\n'+g.lowEnergyAlternative,evidenceIds:g.evidenceIds},
  {part:'boundaries',text:[card.scope,card.limitations,...g.stopConditions].join('\n'),evidenceIds:g.evidenceIds},
 ]
}

export function methodPromptContext(cards:KnowledgeCard[],text:string,intent?:KnowledgeIntent,budget=1800,usage:readonly {guide_id:string;revision:number;branch:string;step_id:string;status:string}[]=[]){
 const selected:Record<string,unknown>[]=[],limit=Math.max(400,Math.min(6000,budget))
 let used=0
 for(const card of deduplicateGuides(cards)){
  if(!card.guide){const row={id:card.id,revision:card.revision,kind:card.kind,title:card.title,claim:card.claim,excerpt:card.excerpt,scope:card.scope,limitations:card.limitations};const tokens=estimateTokens(JSON.stringify(row));if(used+tokens<=limit){selected.push(row);used+=tokens}continue}
  const g=card.guide,terms=kbTerms(text),branches=g.branches.map(b=>({b,score:kbTerms(b.task).filter(t=>terms.includes(t)).length})).sort((a,b)=>b.score-a.score||a.b.id.localeCompare(b.b.id))
  const previous=intent?.continuation?usage.find(u=>u.guide_id===card.id&&u.revision===card.revision&&g.branches.some(b=>b.id===u.branch&&b.steps.some(s=>s.id===u.step_id))):undefined
  const branch=previous?g.branches.find(b=>b.id===previous.branch):branches[0]?.b
  const feedbackStages:Record<string,keyof typeof g.feedbackBranches>={blocked:'blocked',waiting_result:'waiting_result',completed:'result',attempted:'result',declined:'declined'}
  const feedbackBranch=previous?feedbackStages[previous.status]??'not_started':undefined
  const continuing=previous&&intent?.stage==='adjust'
  const row={id:card.id,revision:card.revision,kind:card.kind,title:card.title,guideId:g.guideId,branch:branch?.id,claim:card.claim,evidenceIds:g.evidenceIds,scope:card.scope,limitations:card.limitations,prerequisites:g.prerequisites,exclusions:g.exclusions,stopConditions:g.stopConditions,steps:continuing?undefined:branch?.steps,oneKeyQuestion:continuing?undefined:g.oneKeyQuestion,smallestAction:continuing?undefined:g.smallestAction,exampleBudgetOnly:true,lowEnergyAlternative:g.lowEnergyAlternative,expectedObservation:g.expectedObservation,continuation:continuing?{stepId:previous.step_id,status:previous.status,feedbackBranch}:undefined,feedback:continuing?g.feedbackBranches[feedbackBranch!]:intent?.stage==='adjust'?g.feedbackBranches:undefined,claims:g.claims.map(c=>({id:c.id,basis:c.basis,text:c.text,scope:c.scope,limitations:c.limitations,evidenceIds:c.evidenceIds})),untrustedPublicMethod:true}
  const tokens=estimateTokens(JSON.stringify(row))
  // Never slice off scope/exclusions. Omit a card whole if it cannot fit.
  if(used+tokens<=limit){selected.push(row);used+=tokens}
 }
 return {knowledge:selected,budgetTokens:limit,estimatedTokens:used,estimateKind:'existing_character_weighted_estimate_not_provider_token_count',dropped:cards.length-selected.length}
}
export function kbTerms(text:string){
 const out=new Set<string>(),normalized=text.toLowerCase().normalize('NFKC')
 for(const run of normalized.match(/[\p{Script=Han}]+|[a-z0-9_-]+/gu)??[]){if(/^[a-z0-9]/.test(run))out.add(run);else for(let i=0;i<run.length-1;i++)out.add(run.slice(i,i+2))}
 return [...out]
}
// Independently implemented RRF; inspected MIT rag-fusion for behavior, no
// framework or multi-query generation (and hence no extra model call).
export function reciprocalRankFusion(lists:string[][],k=60){
 const scores=new Map<string,number>()
 for(const list of lists)for(const [rank,id] of [...new Set(list)].entries())scores.set(id,(scores.get(id)??0)+1/(k+rank+1))
 return [...scores].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
}
