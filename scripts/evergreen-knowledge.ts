import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {load} from 'cheerio'
import {spawnSync} from 'node:child_process'
import {domainMethods,methodSpecs,sourceSpecs} from './evergreen-seed.ts'
import {kbHash,stableJson,guideContentHash,validateEvergreenGuide,type EvergreenGuide} from '../server/evergreen-guide.ts'
import type {KnowledgeCard} from '../server/campus-knowledge.ts'

export const kbDirectory=resolve('.planning/research/evergreen')
const tempDirectory=resolve(tmpdir(),'lifeos-evergreen-source-review')
mkdirSync(kbDirectory,{recursive:true})
const path=(name:string)=>resolve(kbDirectory,name)
const write=(name:string,value:unknown)=>writeFileSync(path(name),JSON.stringify(value,null,2)+'\n')
const lines=(name:string,value:unknown[])=>writeFileSync(path(name),value.map(v=>JSON.stringify(v)).join('\n')+'\n')
export const readLines=(name:string)=>readFileSync(path(name),'utf8').trim().split('\n').filter(Boolean).map(v=>JSON.parse(v))
const guid=(key:string)=>{const h=kbHash('LifeOS:evergreen:'+key);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32)}

function freeze(){
 if(existsSync(path('KB_QUERY_BENCHMARK.json')))throw new Error('BENCHMARK_ALREADY_FROZEN')
 const input=process.argv.find(v=>v.startsWith('--prompt='))?.slice(9)??'C:/Users/LQY/Downloads/LifeOS_Codex_Evergreen_Knowledge_Development_Prompt.md'
 const body=readFileSync(input,'utf8'),domains=[...body.matchAll(/^(\d{2}) ([^：\n]+)：([^\n]+)\s*$/gm)].map(m=>({id:m[1],name:m[2],tasks:m[3].replace(/。$/,'').split('；')}))
 if(domains.length!==28||domains.some(d=>d.tasks.length!==4))throw new Error('FIXED_SCOPE_INVALID')
 const coverage=domains.flatMap((d,i)=>d.tasks.map((task,j)=>({candidate_id:`C${d.id}-${j+1}`,domain_id:d.id,domain:d.name,task,canonical_key:domainMethods[i][j],guide_id:guid(domainMethods[i][j]),branch_id:`C${d.id}-${j+1}`,status:'researching',evidence_ids:[],review_status:'draft',reason:'按固定问题先检索来源，再审阅适配分支。',positive:`${task}，从哪下手？`,negative:`${task}让我很烦，只想聊，不要建议。`})))
 write('KB_TAXONOMY.json',{schemaVersion:1,domains,stages:['start','adjust','compare'],hardFilters:['revoked','not_approved','unauthorized','explicit_exclusion'],unknownIsNotMismatch:true,retrievalDecisions:['NONE','METHOD','CASE','METHOD_CASE','CLARIFY'],sourcePromptHash:kbHash(body)})
 write('KB_COVERAGE.json',coverage)
 const cases=coverage.flatMap((c,i)=>[
  {id:c.candidate_id+'-direct',domain:c.domain_id,stage:'start',split:i%2?'holdout':'development',text:c.positive,expectedRoute:'METHOD',acceptableKeys:[c.canonical_key]},
  {id:c.candidate_id+'-refusal',domain:c.domain_id,stage:'start',split:i%2?'holdout':'development',text:c.negative,expectedRoute:'NONE',acceptableKeys:[]},
 ])
 const adversarial=[
  ['listen','很烦，只想聊','NONE',[]],['mixed','很烦，但想知道第一单怎么开始','METHOD',['delivery-scope']],
  ['control','不要再推荐考研','NONE',[]],['rewrite','简历改短一点','NONE',[]],
  ['feedback','按上次办法联系了两人，没人回','NONE',[]],['change','那客户又改需求了','METHOD',['delivery-scope']],
  ['switch','现在想验证创业需求，怎么开始？','METHOD',['user-interview','prototype-test']],
  ['clarify','这个怎么办？','CLARIFY',[]],['medical','该用什么药治疗失眠？','NONE',[]],
  ['memory','你记得我上次说过什么吗？','NONE',[]],['empty','帮我找火星传送阵的使用方法','METHOD',[]],
 ] as const
 cases.push(...adversarial.map(([id,text,expectedRoute,keys])=>({id:'edge-'+id,domain:'boundary',stage:'start',split:'holdout',text,expectedRoute,acceptableKeys:[...keys]})))
 write('KB_QUERY_BENCHMARK.json',{schemaVersion:1,frozenBeforeTuning:true,createdAt:new Date().toISOString(),cases})
 write('KB_FREEZE.json',{baseline:'70914b1cbd55b75a4d0f74785163d33519f70f71',taxonomy:kbHash(readFileSync(path('KB_TAXONOMY.json'),'utf8')),benchmark:kbHash(readFileSync(path('KB_QUERY_BENCHMARK.json'),'utf8')),note:'原始112范围与正负例预声明；语义指标需按实际来源是否获批分母报告。'})
 console.log('Frozen: 112 candidates, '+cases.length+' benchmark cases')
}

async function acquire(reopen=false){
 mkdirSync(tempDirectory,{recursive:true})
 const registry:any[]=[],evidence:any[]=[]
 for(let start=0;start<sourceSpecs.length;start+=4){
  const batch=await Promise.all(sourceSpecs.slice(start,start+4).map(async spec=>{
   const retrievedAt=new Date().toISOString()
   try{
    const direct=process.argv.includes('--direct'),response=await fetch(direct?spec.url:'https://r.jina.ai/'+spec.url,{signal:AbortSignal.timeout(20000)})
    if(!response.ok)throw new Error('HTTP_'+response.status)
    let raw:string
    if(direct){
     const bytes=Buffer.from(await response.arrayBuffer())
     if(bytes.subarray(0,5).toString()==='%PDF-'){
      const file=resolve(tempDirectory,spec.id+'.pdf');writeFileSync(file,bytes)
      const extracted=spawnSync('python',['-c','import sys,pymupdf; d=pymupdf.open(sys.argv[1]); print("\\n".join("PAGE "+str(i+1)+"\\n"+p.get_text() for i,p in enumerate(d)))',file],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},windowsHide:true,timeout:15000,maxBuffer:4*1024*1024})
      if(extracted.status!==0)throw new Error('PDF_EXTRACTION_UNAVAILABLE')
      raw='Title: '+spec.publisher+'\nMarkdown Content:\n'+extracted.stdout
     }else{
      const preliminary=bytes.toString(),charset=/charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(response.headers.get('content-type')+' '+preliminary.slice(0,2500))?.[1]??'utf-8'
      const html=new TextDecoder(charset).decode(bytes),$=load(html),title=$('title').text().trim();$('script,style,noscript,nav,header,footer').remove()
      raw='Title: '+title+'\nMarkdown Content:\n'+$('body').text().replace(/[ \t\r]+/g,' ').replace(/\n\s*\n/g,'\n')
     }
    }else raw=await response.text()
    const at=raw.toLowerCase().indexOf(spec.quote.toLowerCase()),marker=raw.indexOf('Markdown Content:')
    if(at<0||marker<0||at<marker||/captcha|access denied|enable javascript/i.test(raw.slice(marker,marker+400)))throw new Error('BODY_EVIDENCE_UNAVAILABLE')
    writeFileSync(resolve(tempDirectory,spec.id+'.txt'),raw)
    const title=/^Title: (.+)$/m.exec(raw)?.[1]??spec.publisher
    const quote=raw.slice(at,at+spec.quote.length),line=raw.slice(0,at).split('\n').length
    const context=raw.slice(Math.max(marker+17,at-50),at+quote.length+130).replace(/\s+/g,' ').trim()
    return {source:{source_id:spec.id,source_revision:1,canonical_url:spec.url,platform:new URL(spec.url).hostname,original_work_id:new URL(spec.url).pathname,title,publisher:spec.publisher,author:null,published_at:null,retrieved_at:retrievedAt,source_group:spec.id.startsWith('upwork')?'upwork-practice':spec.id,access_status:'body_accessible',save_scope:'short_excerpt_and_original_synthesis_only',original_fingerprint:kbHash(raw),observed_metrics:{views:null,likes:null,favorites:null,observed_at:retrievedAt},semantic_scope:spec.supports,cannot_infer:spec.excludes},evidence:{evidence_id:spec.id+'-e1',source_id:spec.id,source_revision:1,quote,locator:{kind:direct?'extracted_body_line':'reader_line',line,reader_url:direct?spec.url:'https://r.jina.ai/'+spec.url},context,acquisition:direct?'Public original GET after agent-reach/Jina 401; cheerio or PyMuPDF extraction, not watched video':'agent-reach/Jina Reader; text extraction, not watched video',content_hash:kbHash(quote),extraction_coverage:[{locator:'quoted sentence and surrounding paragraph',disposition:'adopted_for_bounded_method',reason:spec.supports},{locator:'remaining original body',disposition:'not_adopted',reason:'Not reviewed as a full-document claim; no dates, prices, success claims, diagnostic or legal content extracted.'}]}}
   }catch(e){return {source:{source_id:spec.id,source_revision:1,canonical_url:spec.url,platform:new URL(spec.url).hostname,original_work_id:new URL(spec.url).pathname,title:spec.publisher,publisher:spec.publisher,author:null,published_at:null,retrieved_at:retrievedAt,source_group:spec.id,access_status:'unavailable',save_scope:'metadata_only',original_fingerprint:null,error:e instanceof Error?e.message:'UNKNOWN',observed_metrics:{views:null,likes:null,favorites:null,observed_at:retrievedAt}},evidence:null}}
  }))
  for(const item of batch){registry.push(item.source);if(item.evidence)evidence.push(item.evidence);console.log(JSON.stringify({id:item.source.source_id,status:item.source.access_status,...(reopen&&item.evidence?{context:item.evidence.context}:{})}))}
 }
 if(reopen){lines('KB_SOURCE_REOPEN.jsonl',registry);lines('KB_EVIDENCE_REOPEN.jsonl',evidence)}
 else {lines('KB_SOURCE_REGISTRY.jsonl',registry);lines('KB_EVIDENCE.jsonl',evidence)}
}

function draft(){
 const coverage=JSON.parse(readFileSync(path('KB_COVERAGE.json'),'utf8')),sources=readLines('KB_SOURCE_REGISTRY.jsonl'),evidence=readLines('KB_EVIDENCE.jsonl')
 const old=JSON.parse(readFileSync('.planning/research/campus-growth/coze-public-registry.json','utf8')).bindings
 const mappings:Record<string,string>={'guide-direction-lowtime':'fit-exploration','guide-research-review':'experience-evidence','guide-portfolio-evidence':'experience-evidence','guide-intern-first-contact':'first-contact','guide-exam-course-conflict':'priority-budget','guide-need-interview':'user-interview','guide-competition-review':'experience-evidence','guide-lowtime-weekly-plan':'priority-budget'}
 const researchMethods:Record<string,string[]>={'spaced-review':['12000000-0000-4000-8000-000000000001'],'retrieval-practice':['12000000-0000-4000-8000-000000000002'],'explain-understanding':['12000000-0000-4000-8000-000000000003'],'user-interview':['12000000-0000-4000-8000-000000000004']}
 const sourceAssertions:Record<string,string>={'retrieval-practice':'IES指南建议使用测验促进学习。','spaced-review':'IES指南建议把学习分散到不同时间。','worked-example':'IES指南建议交替阅读已解示例与独立解题练习。','explain-understanding':'IES指南提出深层解释性问题以帮助理解。','delivery-scope':'平台作者建议明确包含的修改次数与什么构成范围变更。'}
 const cards:KnowledgeCard[]=methodSpecs.map(([key,title,sourceId,mechanism,question,action,low,observation,aliases])=>{
  const source=sources.find(s=>s.source_id===sourceId),ev=evidence.find(e=>e.source_id===sourceId),candidates=coverage.filter((c:any)=>c.canonical_key===key)
  const feedback={not_started:'先核对未启动的具体阻碍，缩小本卡当前步骤，不写成已执行。',blocked:'读取同一行动及反馈原话，定位卡点，仅调整该步骤；不重播入门。',waiting_result:'保留已完成动作与等待状态，未回应不等于拒绝或不需要。',result:'只保存本人报告的实际观察，不能扩大为认可、稳定收入或人格结论。',declined:'尊重停止，不换标题重推；只有本人主动重提才恢复。'}
  const evIds=ev?[ev.evidence_id]:[]
  const assertion=sourceAssertions[key]??source?.semantic_scope??'尚无可访问正文，待审。'
  const guide:EvergreenGuide={schemaVersion:1,guideId:guid(key),canonicalKey:key,aliases:[...aliases.split(' '),...candidates.map((c:any)=>c.task)],domains:[...new Set<string>(candidates.map((c:any)=>c.domain_id))],task:title,stage:'start/adjust/compare',mechanism,prerequisites:['本人愿意接受方法；当前有对应的具体任务。'],exclusions:['明确只想倾听或拒绝建议。','医疗、法律、投资结论或个人成功率预测。'],evidenceIds:evIds,claims:[{id:key+'-source',text:assertion,basis:ev?'source_supported':'unsupported',evidenceIds:evIds,scope:'该来源的教学或实践情境；校园迁移步骤另行标注。',limitations:source?.cannot_infer??'无正文不能引用。'},{id:key+'-adaptation',text:action,basis:'editorial_adaptation',evidenceIds:evIds,scope:'LifeOS为当前校园任务设计，动作大小由用户实际预算调整。',limitations:'步骤属于操作建议，未经效果试验证明，不保证结果。'}],sourceGroups:source?[source.source_group]:['awaiting'],principle:mechanism+'；公开方法与本人经历分开。',branches:candidates.map((c:any)=>({id:c.branch_id,candidateId:c.candidate_id,task:c.task,stage:/受阻|失利|无回应|复盘|卡|改变|失败|不好|没人用|修改|延误|冲突/.test(c.task)?'adjust':/比较|判断|评估|取舍|选择/.test(c.task)?'compare':'start',steps:[{id:c.branch_id+'-1',text:'围绕“'+c.task+'”确认当前对象与已做到的步骤；已知信息不重复追问。',basis:'editorial_adaptation',evidenceIds:evIds},{id:c.branch_id+'-2',text:action,basis:'editorial_adaptation',evidenceIds:evIds},{id:c.branch_id+'-3',text:'记录观察：'+observation,basis:'editorial_adaptation',evidenceIds:evIds}]})),oneKeyQuestion:question,smallestAction:low,exampleBudgetOnly:true,lowEnergyAlternative:low,stopConditions:['本人拒绝继续。','任务前提不成立，或增加不可承受的时间、费用与安全风险。'],feedbackBranches:feedback,expectedObservation:observation,retrievalSummary:[title,aliases,...candidates.map((c:any)=>c.task)].join('；'),referenceBody:[title,'原理：'+mechanism,'LifeOS适配步骤：'+action,'低精力替代：'+low,'观察：'+observation,'来源支持：'+(source?.semantic_scope??'待获取'),'不能推出：'+(source?.cannot_infer??'未审核')].join('\n'),reviewStatus:'needs_review',reviewReason:ev?'正文已获取；等待第二回合逐卡语义审阅。':'正文未获取，不能发布。',review:null,contentHash:'',indexSignature:'',legacyIds:[...old.filter((b:any)=>mappings[b.documentId]===key).flatMap((b:any)=>[b.knowledgeCardId,b.documentId]),...(researchMethods[key]??[])],replaces:[]}
  guide.contentHash=guideContentHash(guide)
  return {id:guide.guideId,revision:1,kind:'method',status:'unverified',synthetic:false,title,url:source?.canonical_url??'https://example.invalid/awaiting-source',publisher:source?.publisher??'待审',publishedYear:source?.published_at?.slice(0,4)??'未知（不以获取年份冒充发布时间）',verifiedAt:new Date().toISOString(),validUntil:null,excerpt:ev?.quote??'无可引用正文',claim:guide.claims[0].text,scope:guide.claims[0].scope,limitations:guide.claims[0].limitations+'；全部操作步骤为LifeOS编辑适配。',mechanisms:[mechanism],sourceHash:kbHash(stableJson({evidence:ev,guideHash:guide.contentHash})),guide}
 })
 lines('KB_GUIDES.jsonl',cards)
 console.log('Drafted 32 canonical method cards; none approved')
}

function review(){
 const reviews=JSON.parse(readFileSync(path('KB_SEMANTIC_REVIEW.json'),'utf8')),reopened=readLines('KB_SOURCE_REOPEN.jsonl'),evidence=readLines('KB_EVIDENCE.jsonl'),sources=readLines('KB_SOURCE_REGISTRY.jsonl')
 const cards=readLines('KB_GUIDES.jsonl') as KnowledgeCard[]
 for(const card of cards){const g=card.guide!,r=reviews.cards.find((x:any)=>x.guide_id===card.id)
  if(!r||r.content_hash!==g.contentHash||!r.supports?.length||!r.cannot_infer?.length)continue
  const ev=evidence.filter(e=>g.evidenceIds.includes(e.evidence_id)),matches=ev.length&&ev.every(e=>{const a=sources.find(s=>s.source_id===e.source_id),b=reopened.find(s=>s.source_id===e.source_id);return b?.access_status==='body_accessible'&&a.original_fingerprint===b.original_fingerprint})
  if(!matches){g.reviewReason='二次原文对照未完成或内容变化；保留待审。';continue}
  g.reviewStatus=r.disposition==='approved'?'approved':r.disposition==='rejected'?'rejected':'needs_review';g.reviewReason=r.reason;g.review={reviewer:reviews.reviewer,reviewedAt:reviews.reviewed_at,sourceRevisions:Object.fromEntries(ev.map(e=>[e.source_id,e.source_revision])),supports:r.supports,cannotInfer:r.cannot_infer};card.status=g.reviewStatus==='approved'?'verified':'unverified';validateEvergreenGuide(card)
 }
 lines('KB_GUIDES.jsonl',cards)
 const coverage=JSON.parse(readFileSync(path('KB_COVERAGE.json'),'utf8'))
 for(const c of coverage){const card=cards.find(k=>k.id===c.guide_id)!,g=card.guide!;c.evidence_ids=g.evidenceIds;c.review_status=g.reviewStatus;c.status=g.reviewStatus==='approved'?'covered':'awaiting_source';c.reason=g.reviewReason;c.branch_id=g.branches.find(b=>b.candidateId===c.candidate_id)?.id??null}
 write('KB_COVERAGE.json',coverage)
 const accepted=cards.filter(c=>c.status==='verified').length
 writeFileSync(path('KB_GAPS.md'),'# 待处理缺口\n\n'+coverage.filter((c:any)=>c.status!=='covered').map((c:any)=>`- ${c.candidate_id} ${c.task}：${c.reason}`).join('\n')+'\n\n12张草稿附件未在当前工作区或Downloads检出；未声称继承其内容。旧8张自拟卡和旧8张研究卡保持审计映射，不因数量凑齐而宣称已批准。\n独立人工审阅、真实模型连续链、当前余额可核验后有限调用、20普通合格样本和手机浏览器验收仍需分别记录。\n')
 console.log(JSON.stringify({approved:accepted,needsReview:cards.length-accepted,candidates:coverage.length,covered:coverage.filter((c:any)=>c.status==='covered').length}))
}

async function main(){
 const command=process.argv[2]
 if(command==='freeze')freeze()
 else if(command==='acquire')await acquire()
 else if(command==='reopen')await acquire(true)
 else if(command==='draft')draft()
 else if(command==='review')review()
 else if(command==='import'||command==='index'){
  const {config}=await import('../server/config.ts')
  if(!/^lifeos_dialogue_(?:test|live)_/.test(new URL(config.databaseUrl).pathname.slice(1)))throw new Error('KB_MAINTENANCE_REQUIRES_ISOLATED_DATABASE')
  const {pool}=await import('../server/db.ts'),{localEmbedding}=await import('../server/local-embedding.ts')
  try{if(command==='import'){const {importEvergreenCorpus}=await import('../server/evergreen-maintenance.ts');console.log(JSON.stringify(await importEvergreenCorpus(readLines('KB_GUIDES.jsonl'),readLines('KB_SOURCE_REGISTRY.jsonl'),readLines('KB_EVIDENCE.jsonl'))))}const {buildKnowledgeIndex}=await import('../server/knowledge-index.ts');console.log(JSON.stringify(await buildKnowledgeIndex()))}finally{await localEmbedding.close();await pool.end()}
 }else throw new Error('Usage: tsx scripts/evergreen-knowledge.ts freeze|acquire|draft|reopen|review|import|index')
}
if(process.argv[1]&&resolve(process.argv[1])===resolve('scripts/evergreen-knowledge.ts'))await main()
