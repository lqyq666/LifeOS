// Offline review preparation. Never fetches, imports, approves or publishes cards.
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {load} from 'cheerio'
import {guideContentHash,validateEvergreenGuide,stableJson} from '../server/evergreen-guide.ts'
import {validateKnowledge,type KnowledgeCard} from '../server/campus-knowledge.ts'

const directory='.planning/research/workflow-integration/evidence/acceptance-20261010/pending-review'
const corpus='.planning/research/evergreen/',hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex')
const lines=(name:string):any[]=>readFileSync(corpus+name,'utf8').trim().split('\n').map(row=>JSON.parse(row))
const originals=['KB_GUIDES.jsonl','KB_COVERAGE.json','KB_EVIDENCE.jsonl','KB_SOURCE_REGISTRY.jsonl','KB_SEMANTIC_REVIEW.json']
const before=Object.fromEntries(originals.map(name=>[name,hash(readFileSync(corpus+name))]))
const cards=lines('KB_GUIDES.jsonl') as KnowledgeCard[],evidence=lines('KB_EVIDENCE.jsonl'),sources=lines('KB_SOURCE_REGISTRY.jsonl')
const coverage=JSON.parse(readFileSync(corpus+'KB_COVERAGE.json','utf8')) as any[]
const pending=cards.filter(c=>c.guide!.reviewStatus==='needs_review')
if(cards.length!==32||pending.length!==16||coverage.length!==112||new Set(coverage.map(c=>c.candidate_id)).size!==112)throw new Error('BASELINE_SCOPE_CHANGED')
mkdirSync(directory,{recursive:true})
const bodies=new Map<string,string>(),sourceReadings:any[]=[]
for(const s of sources){
 const fragment=s.fingerprint_scope==='reviewed_fragment_not_whole_document'
 if(fragment){
  const ev=evidence.find(e=>e.source_id===s.source_id)
  if(!ev||hash(ev.quote)!==s.original_fingerprint)throw new Error('ARCHIVED_FRAGMENT_CHANGED:'+s.source_id)
  sourceReadings.push({sourceId:s.source_id,url:s.canonical_url,scope:'ARCHIVED_SHORT_FRAGMENT_ONLY',sha256:hash(ev.quote),locator:ev.locator,fullBodyReopened:false,claimSupportNotInferredFromHash:true})
  continue
 }
 const path=resolve(tmpdir(),'lifeos-evergreen-source-review',s.source_id+'.txt'),bytes=readFileSync(path)
 if(hash(bytes)!==s.original_fingerprint)throw new Error('ARCHIVED_BODY_CHANGED:'+s.source_id)
 const text=bytes.toString('utf8');bodies.set(s.source_id,text)
 const spans=evidence.filter(e=>e.source_id===s.source_id).flatMap(e=>e.quote.split('\n')).map((quote:string)=>{
  const offset=text.indexOf(quote);if(offset<0)throw new Error('QUOTE_MISSING:'+s.source_id)
  return {quoteSha256:hash(quote),offset,line:text.slice(0,offset).split('\n').length}
 })
 sourceReadings.push({sourceId:s.source_id,url:s.canonical_url,scope:'EXISTING_EXTRACTED_ORIGINAL_BODY',localPath:path,sha256:hash(bytes),chars:text.length,spans,fullBodyReopened:true,claimSupportNotInferredFromHash:true})
}
// Reopen the two previously captured MIT bodies; no fresh website/model calls.
const mit=JSON.parse(readFileSync('.planning/research/workflow-integration/evidence/continuation/sources/SOURCE_EVIDENCE.json','utf8'))
for(const s of mit.sources){
 const bytes=readFileSync(s.originalFullBodyPrivatePath);if(hash(bytes)!==s.htmlSha256)throw new Error('MIT_ORIGINAL_CHANGED')
 const $=load(bytes.toString('utf8'));$('script,style,nav,header,footer').remove()
 const text=$('.entry-content').first().text().replace(/\s+/g,' ').trim()
 if(hash(text)!==s.normalizedBodySha256||text.indexOf(s.quote)!==s.quoteLocator.normalizedTextOffset)throw new Error('MIT_QUOTE_CHANGED')
 bodies.set(s.sourceId,text);sourceReadings.push({sourceId:s.sourceId,url:s.url,scope:'EXISTING_ORIGINAL_HTML',localPath:s.originalFullBodyPrivatePath,sha256:hash(bytes),normalizedBodySha256:hash(text),quoteLocator:s.quoteLocator,fullBodyReopened:true,claimSupportNotInferredFromHash:true})
}
// These are explicit editorial judgments after reading the bodies, not hash-based approval.
const decisions:Record<string,{supported:string;gap:string;next:string;overclaim?:string}>={
 'first-contact':{supported:'职业访谈可按本人需求选择对象并提前策划；药科与华师报道均支持访谈准备。',gap:'无导师邮件、推荐信、社交破冰或未回复跟进的直接来源，不能外推回复率或沉默原因。',next:'按访谈、导师、推荐、用户联系分开范围；仅访谈准备可送独立审阅，其他分支继续待原文。'},
 'fit-exploration':{supported:'访谈报道支持获取实际职业信息；MIT补充支持以研究、实习了解读研目的。',gap:'专业、海外学习与学术意愿不能由单次接触判定适配；缺低成本体验的适用边界。',next:'把了解信息与验证兴趣分开；具体经历、本人反应、未确认要求分别记录。'},
 'skill-gap':{supported:'长江正文除STAR外还明确对照岗位职责与应聘条件；MIT支持实际经历对应岗位关键词。',gap:'已有片段不足以支持能力迁移效果或小作品补足能力；没有本人结果不能编造。',next:'补实际要求对照段，保留个人贡献和未知；小作品作为LifeOS待审建议，不能称效果已证实。'},
 'exam-diagnosis':{supported:'PDCA只支持过程检查；既有清华考试正文还支持读题、检查答案和时间分配。',gap:'这些来源没有证明四类失败归因，更不支持科研归因；诊断模拟练习分支错误标为start。',next:'修订为一次练习的过程核对；分类仅作待核对观察，C11-4改adjust；科研分支另取来源。'},
 'restart-task':{supported:'时间手册仅支持一般计划、执行、检查与调整。',gap:'记录中断位置和恢复上下文缺直接依据；被打断后恢复误标start。',next:'保留原创适配标识，C05-3改adjust；需任务恢复相关原文和独立审阅。'},
 'start-small':{supported:'时间手册支持任务取舍与反馈记录。',gap:'缩小动作改善启动效果没有所读原文支持；不能把不启动归因为懒惰或能力。',next:'记录未开始的本人障碍；动作候选须可拒绝，另补启动机制来源。'},
 'research-task':{supported:'Upwork现有片段仅支持项目目的与目标。',gap:'角色、依赖、验收人与科研/社团迁移均未在片段中得到支持。',overclaim:'现有source_supported文字将角色、约束、范围扩展到8词片段之外。',next:'收窄外部主张；角色与验收步骤标LifeOS适配，补科研/团队原文。'},
 'direction-comparison':{supported:'职业访谈支持信息加工；MIT支持核对目标路径是否需要研究生学位与读研目的。',gap:'稳定自主、比赛或社团取舍的全面机制未获支持；同机构两份材料不算独立来源；暂停方向不得当主线。',next:'限定就业/升学比较候选，个人目的、已有实践和未知分别连接；不强选方向或改目标。'},
 'application-match':{supported:'长江正文支持简历前核对岗位职责与应聘条件，MIT支持经历与岗位信息对应。',gap:'留学资格、付费服务价值和法律资格不能从求职来源迁移。',next:'C14-3收窄为岗位要求与已有证据对照；C13-2、C27-2继续待领域直接来源。'},
 'job-feedback':{supported:'PDCA只支持过程检查与修订。',gap:'招聘投递、筛选、面试的分阶段方法未有直接原文；无回复原因未知。',next:'保存岗位及材料版本与实际回应，只调整同一阶段；补招聘反馈原文，不重发全套求职教程。'},
 'interview-unknown':{supported:'STAR只支持已有经历的陈述。',gap:'澄清问题和说明不知道的招聘面试机制未被本段支持；不得用口试建议冒充招聘规则。',next:'澄清与诚实说明未知标原创适配，补招聘场景直接来源。'},
 'delivery-review':{supported:'Upwork现有片段仅支持项目目的与目标。',gap:'实际使用、满意、付款、再次委托和效果的分列步骤缺直接内容；付款不代表采用或有效。',overclaim:'外部主张的角色、约束、范围未被已存8词片段支持。',next:'外部主张收窄；五类结果状态分别记录且缺失为未知；反馈适配送独立审阅。'},
 'income-ledger':{supported:'时间手册支持记录实际任务投入与过程。',gap:'到账、成本、必要支出与净收益没有财务记录来源；不提出收益保证。',next:'记录仅为本人报告，不推投资/法律结论；待一般预算与收支记录原文。'},
 'content-experiment':{supported:'清华作者正文支持客户真实行为验证，并讨论客户表达能否被复述。',gap:'商业表达不能直接证明校园内容创作机制或平台传播效果；作者经验不是实验因果证据。',next:'商业受众表达与内容创作分开；只核对理解/提问等实际反馈，平台表现与效果保持未知。'},
 'team-contract':{supported:'Upwork现有片段仅支持项目目的与目标。',gap:'负责人与依赖、延期、分歧处理未读取直接正文；分歧/分工受阻误标start。',overclaim:'外部主张扩大到片段未出现的角色、约束和范围。',next:'收窄来源；C24-2、C24-4改adjust，分工与贡献不等同团队成绩，另补协作原文。'},
 'information-check':{supported:'华师正文支持原始文献、权威性和时效性及查找、整理、评论。',gap:'AI核验、合作风险、隐私和作品保护的全套边界没有直接来源；不能将文献讲座当合规指南。',next:'文献核验与隐私保护分开，敏感资料不上传；待AI与资料保护的官方原文。'},
}
const stageCorrections:Record<string,'adjust'|'compare'>={'C05-3':'adjust','C07-4':'adjust','C11-4':'adjust','C24-2':'adjust','C24-4':'adjust'}
const reviews=pending.map(c=>{
 const g=c.guide!,d=decisions[g.canonicalKey];if(!d)throw new Error('MISSING_CARD_DECISION')
 return {guideId:c.id,revision:c.revision,canonicalKey:g.canonicalKey,title:c.title,contentHash:g.contentHash,decision:'needs_review',sourceSupport:d.supported,remainingGap:d.gap,sourceClaimCorrection:d.overclaim??null,nextRevisionWork:d.next,branches:g.branches.map(b=>({id:b.id,task:b.task,currentStage:b.stage,proposedStage:stageCorrections[b.id]??b.stage})),evidenceIds:g.evidenceIds,editorialSteps:g.claims.filter(x=>x.basis==='editorial_adaptation'),independentReviewReceipt:null,authenticatedReleaseReceipt:null,publication:'NOT_RUN'}
})
const write=(name:string,data:unknown)=>writeFileSync(directory+'/'+name,JSON.stringify(data,null,2)+'\n')
write('SOURCE_REOPEN.json',{kind:'OFFLINE_ARCHIVED_ORIGINAL_READ_NO_NETWORK',at:new Date().toISOString(),sources:sourceReadings})
write('PENDING_16_REVIEW.json',{kind:'CODEX_EDITORIAL_REVIEW_PREPARATION_NOT_INDEPENDENT_REVIEW',at:new Date().toISOString(),baselineCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),baselineHashes:before,cards:reviews,independentReviewStatus:'NOT_TESTED_NO_INDEPENDENT_EXECUTION_RECEIPT',releaseStatus:'NOT_TESTED_NO_AUTHENTICATED_RELEASE_RECEIPT',published:false})
const dispositions=coverage.map(c=>{
 const card=cards.find(k=>k.id===c.guide_id),branch=card?.guide?.branches.find(b=>b.id===c.branch_id)
 if(!branch||branch.task!==c.task||card!.guide!.canonicalKey!==c.canonical_key)throw new Error('INVALID_CANDIDATE_DESTINATION:'+c.candidate_id)
 return {candidateId:c.candidate_id,task:c.task,canonicalKey:c.canonical_key,guideId:c.guide_id,branchId:branch.id,revision:card!.revision,disposition:c.status,stage:branch.stage,proposedStage:stageCorrections[c.candidate_id]??branch.stage,reviewStatus:card!.guide!.reviewStatus,decisionReason:decisions[c.canonical_key]?.gap??c.reason,nextStep:decisions[c.canonical_key]?.next??'沿用原有范围与同一行动反馈分支；本轮未重新批准或发布。'}
})
// Shared aliases are inspectable ambiguity, not permission to merge unlike tasks.
const aliasOwners=new Map<string,Set<string>>()
for(const card of cards)for(const alias of card.guide!.aliases){const key=alias.trim().replace(/\s+/g,'');if(!key)continue;const owners=aliasOwners.get(key)??new Set<string>();owners.add(card.guide!.canonicalKey);aliasOwners.set(key,owners)}
write('CANDIDATE_112_DISPOSITIONS.json',{baselineHashes:before,total:dispositions.length,covered:dispositions.filter(x=>x.disposition==='covered').length,awaitingSource:dispositions.filter(x=>x.disposition==='awaiting_source').length,rows:dispositions,aliasAmbiguities:[...aliasOwners].filter(([,owners])=>owners.size>1).map(([alias,owners])=>({alias,canonicalKeys:[...owners],decision:'KEEP_SEPARATE_SELECT_BY_CURRENT_OBJECT_AND_STAGE_NOT_ALIAS_ALONE'})),stageCorrections:Object.entries(stageCorrections).map(([id,stage])=>({candidateId:id,from:dispositions.find(x=>x.candidateId===id)!.stage,to:stage,status:'CANDIDATE_ONLY_NOT_IMPORTED'}))})

// Four existing canonical cards receive inspectable revision candidates only.
const extraEvidence:any[]=[],extraSources:any[]=[]
function excerpt(id:string,sourceId:string,quote:string,claim:string,limitation:string){
 const text=bodies.get(sourceId);if(!text||!text.includes(quote))throw new Error('CANDIDATE_SOURCE_QUOTE_MISSING:'+sourceId)
 const reading=sourceReadings.find(s=>s.sourceId===sourceId),source=sources.find(s=>s.source_id===sourceId)
 if(!source){const old=mit.sources.find((s:any)=>s.sourceId===sourceId);extraSources.push({source_id:sourceId,source_revision:1,canonical_url:old.url,source_group:'mit-capd',title:old.title,publisher:old.publisher,access_status:'body_accessible',original_fingerprint:reading.sha256,fingerprint_scope:'captured_html',save_scope:'short_excerpt_only'})}
 const e={evidence_id:id,source_id:sourceId,source_revision:1,quote,content_hash:hash(quote),context:claim,contextKind:'LIFEOS_PARAPHRASE_NOT_ORIGINAL_CONTEXT',locator:{kind:'offline_reopened_body_offset',offset:text.indexOf(quote),line:text.slice(0,text.indexOf(quote)).split('\n').length,url:reading.url,bodySha256:reading.normalizedBodySha256??reading.sha256},limitations:limitation}
 extraEvidence.push(e);return id
}
const contactEvidence=excerpt('pending-first-contact-ccnu','ccnu-interview','精选访谈对象','访谈对象应结合本人实际需求，访谈环节应提前策划。','限职业访谈准备，不支持沉默归因、导师邮件或推荐信效果。')
const examEvidence=excerpt('pending-exam-process','tsinghua-exam','仔细检查一下问题和答案','考试材料建议回看并检查问题与答案；练习过程核对属于LifeOS适配。','不能推出四类诊断的正确性或科研受阻原因，不继承原文统一时长。')
const graduateEvidence=excerpt('pending-graduate-purpose','mit-capd-graduate-purpose',mit.sources[0].quote,'读研选择可先核对本人目标路径是否需要学位。','不含中国报考资格、录取概率或个人研究适配结论。')
const specs=[
 {key:'first-contact',ids:[contactEvidence],claim:'职业访谈准备可以结合本人实际需求选择对象并提前策划。',scope:'职业访谈准备；其他导师、推荐、社交和用户联系分支仍缺直接来源。',steps:['先核对本人请求、联系对象与渠道；已说过的信息不重复问。','未发送时可拟一句与对象相关的问题，是否发送由本人决定。','已发出时只核对发送时间和实际回复；未知原因保留未知，允许停止。'],feedback:{not_started:'保留未发送；只核对本人指出的障碍，允许暂不联系。',blocked:'只调整这条消息的当前卡点，不重送破冰或导师联系全套方法。',waiting_result:'已发送与未回复分开；不猜对方原因，不自动追发。',result:'保存实际回复原话和请求是否获回应；回复不等于请求获准或长期认可。',declined:'停止这次联系；不换渠道重推，本人主动重提才恢复。'}},
 {key:'delivery-review',ids:['upwork-delivery-e1'],claim:'所读Upwork片段提及项目目的与目标。',scope:'仅项目目的与目标；使用、付款、效果及复购区分均为LifeOS待审适配。',steps:['核对同一客户、交付物和约定目标，不把相似项目的反馈串入。','分别记录已交付、实际采用、满意表达、到账和效果；未报告的字段保持未知。','据实际反馈只修改一个可检查环节；没有反馈时不把付款或交付当有效。'],feedback:{not_started:'没有交付仍是计划；只核对当前交付物和本人障碍。',blocked:'定位同一交付物的卡点或范围变化，只改该环节，不重发接单入门。',waiting_result:'保留已交付但采用、付款或效果未知；每个未知分别等待，不自动催款。',result:'逐项保存实际采用、满意、付款、效果及再次委托的本人报告；任一项不代替其他项。',declined:'停止本次交付改进；不将拒绝解释为失败或要求再接单。'}},
 {key:'direction-comparison',ids:[graduateEvidence],claim:'MIT读研准备正文建议核对目标职业路径是否需要该学位。',scope:'就业与升学目的比较；不外推国内资格、稳定自主、竞赛或社团适配。',steps:['读取本人当前目的与已暂停方向；没有完整档案仍可讨论，已知条件不重问。','把已有实践、未知实践结果与改变优先方向分开，说明哪些依据支持、限制或未知。','只核实一项会改变选择的条件；尚无结果就保留探索，不强行确定主线。'],feedback:{not_started:'先确认本人想了解的问题；只取最关键未知，不要求补完整档案。',blocked:'沿同一方向及具体阻碍调整验证方式，不重发全部方向介绍。',waiting_result:'已做探索但结果未知；保留等待，不把探索或采用建议当适配通过。',result:'说明新增反馈改变哪项判断、哪项仍未知；就业优先或暂停接单按本人当前选择生效。',declined:'停止被拒绝方向的推动；历史经历可保留，但不得投影为当前主线。'}},
 {key:'exam-diagnosis',ids:[examEvidence],claim:'已读考试材料建议回看并检查问题与答案。',scope:'一次课程练习的过程核对；四类归因仅为LifeOS待核对观察，科研迁移仍缺来源。',steps:['确认同一次课程练习、本人作答与实际反馈；未做题不记成练习失败。','从一处实际错误核对题目要求、解题步骤、已用时间；缺记录时不猜原因。','只改一个可观察环节，再对照下一次实际作答；行动完成不代表分数或效果改善。'],feedback:{not_started:'保留尚未练习；只准备本人同意的一题或材料，不宣称复习有效。',blocked:'定位当前题或步骤的卡点；只给相应核对，不重送整套备考入门。',waiting_result:'作答已完成但评分或反馈未到；原因与效果保持未知。',result:'比较同一环节的实际作答与反馈；题型变化、总分和能力结论分别核对。',declined:'尊重暂停备考或拒绝建议；不借课程计划继续强推。'}},
]
const revisions=specs.map(s=>{
 const card=structuredClone(cards.find(c=>c.guide!.canonicalKey===s.key)!),g=card.guide!
 card.revision++;card.status='unverified';g.reviewStatus='needs_review';g.review=null;g.reviewReason='本地原文核查与编辑修订候选；无独立审阅及发布回执，不可服务学生。'
 g.evidenceIds=s.ids;g.sourceGroups=[...new Set(s.ids.map(id=>{const e=extraEvidence.find(e=>e.evidence_id===id)??evidence.find(e=>e.evidence_id===id);return (extraSources.find(r=>r.source_id===e.source_id)??sources.find(r=>r.source_id===e.source_id)).source_group}))];g.claims=[{id:s.key+'-bounded-source',text:s.claim,basis:'source_supported',evidenceIds:s.ids,scope:s.scope,limitations:decisions[s.key].gap},{id:s.key+'-pending-adaptation',text:s.steps.join('；'),basis:'editorial_adaptation',evidenceIds:s.ids,scope:'LifeOS为同一任务与当前阶段设计的待审适配。',limitations:'不证明实际效果；全部具体操作与反馈分支是LifeOS编辑适配。'}]
 g.branches=g.branches.map(b=>({...b,stage:stageCorrections[b.id]??b.stage,steps:s.steps.map((text,i)=>({id:b.id+'-'+(i+1),text,basis:'editorial_adaptation',evidenceIds:s.ids}))}))
 g.feedbackBranches=s.feedback;g.referenceBody=[card.title,'原文支持：'+s.claim,'范围：'+s.scope,'LifeOS待审适配：'+s.steps.join('；'),'局限：'+decisions[s.key].gap].join('\n')
 g.contentHash=guideContentHash(g);card.claim=s.claim;card.scope=s.scope;card.limitations=decisions[s.key].gap+'；具体操作是LifeOS待审适配。'
 const ev=s.ids.map(id=>extraEvidence.find(e=>e.evidence_id===id)??evidence.find(e=>e.evidence_id===id));card.excerpt=ev.map(e=>e.quote).join('\n');card.url=sourceReadings.find(r=>r.sourceId===ev[0].source_id).url;card.publisher=extraSources.find(r=>r.source_id===ev[0].source_id)?.publisher??sources.find(r=>r.source_id===ev[0].source_id).publisher
 card.sourceHash=hash(stableJson({evidence:ev,guideHash:g.contentHash}));validateEvergreenGuide(card);validateKnowledge(card)
 return {card,baseRevision:card.revision-1,evidence:ev,independentReviewReceipt:null,releaseReceipt:null,served:false,status:'needs_review'}
})
write('MAINLINE_REVISION_CANDIDATES.json',{kind:'FOUR_EXISTING_CANONICAL_REVISIONS_NOT_IMPORTED',candidateSources:extraSources,candidateEvidence:extraEvidence,original112ScopePreserved:true,revisions})
const after=Object.fromEntries(originals.map(name=>[name,hash(readFileSync(corpus+name))]));if(stableJson(before)!==stableJson(after))throw new Error('READ_ONLY_CORPUS_CHANGED')
write('VERIFICATION.json',{status:'PASS_LOCAL_PREPARATION',pendingCardsReviewed:reviews.length,candidateDispositions:dispositions.length,revisionCandidatesValidated:revisions.length,covered:53,awaitingSource:59,originalHashesUnchanged:after,independentReviewsAdded:0,releasesAdded:0,realModelCallsAdded:0,cloudCallsAdded:0,networkRequests:0,primaryDatabaseModified:false})
console.log(JSON.stringify({pendingCards:reviews.length,dispositions:dispositions.length,revisions:revisions.length,sourceBodiesReopened:sourceReadings.filter(x=>x.fullBodyReopened).length,fragmentsOnly:sourceReadings.filter(x=>!x.fullBodyReopened).length,stageCorrections:Object.keys(stageCorrections).length,corpusUnchanged:true,independentReview:'NOT_TESTED',publication:'NOT_RUN'}))
