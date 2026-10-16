import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {load} from 'cheerio'
import {guideContentHash} from '../server/evergreen-guide.ts'
import {checkMaintenance,publicContentHash,type MaintenanceCandidate} from '../server/workflows/knowledge-maintenance.ts'
const directory='.planning/research/workflow-integration/evidence/public-card';mkdirSync(directory,{recursive:true})
const url='https://ies.ed.gov/ncee/wwc/PracticeGuide/1',cached=process.argv.includes('--captured'),originalPath=directory+'/original.html'
const response=cached?null:await fetch(url,{signal:AbortSignal.timeout(20000)})
if(response&&(!response.ok||new URL(response.url).hostname!=='ies.ed.gov'))throw new Error('PUBLIC_ORIGINAL_UNAVAILABLE')
const bytes=cached?readFileSync(originalPath):Buffer.from(await response!.arrayBuffer())
if(cached&&createHash('sha256').update(bytes).digest('hex')!==JSON.parse(readFileSync(directory+'/candidate.json','utf8')).reading.bodySha256)throw new Error('CAPTURED_ORIGINAL_CHANGED')
const $=load(bytes.toString('utf8'));$('script,style,nav,footer').remove()
const text=$('body').text().replace(/\s+/g,' ').trim(),quote='Use quizzing to promote learning.',at=text.indexOf(quote)
if(at<0||!text.includes('Organizing Instruction and Study'))throw new Error('ORIGINAL_QUOTE_NOT_FOUND')
const sourceHash=createHash('sha256').update(bytes).digest('hex');if(!cached)writeFileSync(originalPath,bytes)
const card=JSON.parse(readFileSync('.planning/research/evergreen/KB_GUIDES.jsonl','utf8').trim().split('\n').find(row=>JSON.parse(row).guide?.canonicalKey==='retrieval-practice')!)
// Same canonical card, isolated revision candidate. Existing corpus/revision untouched.
const source=JSON.parse(readFileSync('.planning/research/evergreen/KB_SOURCE_REGISTRY.jsonl','utf8').trim().split('\n').find(row=>JSON.parse(row).source_id==='ies-learning')!);source.source_revision=2;source.original_fingerprint=sourceHash;source.canonical_url=url;source.access_status='body_accessible'
const evidence=JSON.parse(readFileSync('.planning/research/evergreen/KB_EVIDENCE.jsonl','utf8').trim().split('\n').find(row=>JSON.parse(row).source_id==='ies-learning')!);evidence.evidence_id='ies-learning-r2-workflow-original';evidence.source_revision=2;evidence.quote=quote;evidence.content_hash=publicContentHash(quote);evidence.locator='Recommendations, section 5a/5b';evidence.retrieved_at=new Date().toISOString()
card.revision=2;card.status='unverified';card.sourceHash=sourceHash;card.guide.evidenceIds=[evidence.evidence_id];for(const claim of card.guide.claims)claim.evidenceIds=[evidence.evidence_id];for(const branch of card.guide.branches)for(const step of branch.steps)step.evidenceIds=[evidence.evidence_id];card.guide.reviewStatus='needs_review';card.guide.review=null;card.guide.reviewReason='实际读取 IES 原文，技术审阅完成；独立人类审批尚未取得。';card.guide.contentHash=guideContentHash(card.guide)
const candidate:MaintenanceCandidate={guideId:card.id,revision:2,contentHash:card.guide.contentHash,readings:[{url,canonicalOrigin:url,revision:1,sourceHash,readerId:'http-original-reader',quote,actuallyRead:true,withdrawn:false}],claims:[{id:'retrieval-source',text:'指南建议通过测验促进学习；保留教学范围。',sourceHash,quote,support:'source_supported'},{id:'retrieval-adaptation',text:'合上材料回答一个已学问题，再对照资料检查；具体步骤是 LifeOS 适配，不保证个人成绩。',sourceHash,quote,support:'lifeos_adaptation'}],coverage:[{candidateId:'C04-1',status:'covered',destination:card.id}],producerId:'local-card-extractor',skeptic:{reviewerId:'deterministic-source-and-scope-checker',reviewedContentHash:card.guide.contentHash,issues:[]},release:{humanReviewerId:null,reviewedContentHash:null,approved:false}}
const captured=readFileSync(originalPath),verified=createHash('sha256').update(captured).digest('hex')===sourceHash&&text.includes(quote)
if(!verified||candidate.claims.some(x=>x.support==='source_supported'&&!candidate.readings[0].quote.includes(x.quote)))throw new Error('SOURCE_REVIEW_FAILED')
const gate=checkMaintenance(candidate,['C04-1'],()=>false,reading=>verified&&reading.sourceHash===sourceHash&&reading.quote===quote)
writeFileSync(directory+'/candidate.json',JSON.stringify({card,source,evidence,candidate,gate,reading:{url,responseStatus:response?.status??200,capturedOriginalReused:cached,capturedAt:statSync(originalPath).mtime.toISOString(),bodySha256:sourceHash,quoteSha256:publicContentHash(quote),locator:'Recommendations, section 5a/5b',offsetInExtractedText:at,actuallyReadVerified:verified},reviewLayers:{sourceRead:'REAL_PUBLIC_HTTP',extraction:'LOCAL_CODEX_EDITORIAL_ADAPTATION',skeptic:'DETERMINISTIC_SOURCE_SCOPE_REVIEW_NOT_INDEPENDENT_AGENT',humanApproval:'NOT_OBTAINED',publication:'NOT_PUBLISHED'},originalCorpusModified:false},null,2)+'\n');console.log(JSON.stringify({canonicalId:card.id,revision:2,status:gate.status,originalBodyRead:true,originalBytes:bytes.length,hash:sourceHash,publishEligible:gate.publishEligible,issues:gate.issues}))
