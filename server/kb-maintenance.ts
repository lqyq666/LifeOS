import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {pool,transaction,HttpError} from './db.ts'
import {validateKnowledge,type KnowledgeCard} from './campus-knowledge.ts'
import {guideContentHash,kbHash,stableJson} from './evergreen-guide.ts'
import {importEvergreenWithin} from './evergreen-maintenance.ts'
import {checkMaintenance,type MaintenanceCandidate,type MaintenanceReviewReceipt} from './workflows/knowledge-maintenance.ts'
type Bundle={card:KnowledgeCard;base:KnowledgeCard;producerId:string;sources:any[];evidence:any[];coverage:any[];reviewPreparation?:{contentHash:string;status:string;questions:{target:string;text:string}[];claimChecks:{claimId:string}[]}}
const allowed=(name:string,actor:string)=>(process.env[name]??'').split(',').map(x=>x.trim()).filter(Boolean).includes(actor)
export const maintenancePermissions=(actor:string)=>({edit:allowed('LIFEOS_KB_MAINTAINER_IDS',actor),review:allowed('LIFEOS_KB_REVIEWER_IDS',actor),publish:allowed('LIFEOS_KB_PUBLISHER_IDS',actor)})
function requirePermission(actor:string,permission:'edit'|'review'|'publish'|'read'){
 const p=maintenancePermissions(actor);if(permission==='read'?!(p.edit||p.review||p.publish):!p[permission])throw new HttpError(403,'KB_MAINTENANCE_FORBIDDEN')
}
const sourceHashes=(bundle:Bundle)=>[...new Set(bundle.sources.map(s=>s.original_fingerprint as string))].sort()
function verifyBundle(b:Bundle){
 validateKnowledge(b.card);if(!b.card.guide||b.card.guide.reviewStatus==='approved'||b.card.status!=='unverified'||b.card.guide.contentHash!==guideContentHash(b.card.guide)||b.base.id!==b.card.id||b.card.revision!==b.base.revision+1)throw new HttpError(400,'KB_DRAFT_INVALID')
 for(const id of b.card.guide.evidenceIds){const e=b.evidence.find(x=>x.evidence_id===id),s=e&&b.sources.find(x=>x.source_id===e.source_id&&x.source_revision===e.source_revision);if(!e||!s||s.access_status!=='body_accessible'||kbHash(e.quote)!==e.content_hash||!e.locator)throw new HttpError(400,'KB_EVIDENCE_UNAVAILABLE')}
 if(b.reviewPreparation&&(b.reviewPreparation.contentHash!==b.card.guide.contentHash||stableJson(b.reviewPreparation.claimChecks.map(c=>c.claimId).sort())!==stableJson(b.card.guide.claims.map(c=>c.id).sort())))throw new HttpError(400,'KB_REVIEW_PREPARATION_STALE')
}
export async function queueMaintenancePack(actor:string){
 requirePermission(actor,'edit')
 const dir='.planning/research/evergreen/',pack=JSON.parse(readFileSync(dir+'KB_CONTENT_REVISIONS.json','utf8')),read=(n:string)=>readFileSync(dir+n,'utf8').trim().split('\n').map(x=>JSON.parse(x)),base=read('KB_GUIDES.jsonl'),sources=[...read('KB_SOURCE_REGISTRY.jsonl'),...pack.sources],evidence=[...read('KB_EVIDENCE.jsonl'),...pack.evidence],coverage=JSON.parse(readFileSync(dir+'KB_COVERAGE.json','utf8'))
 return transaction(async c=>{
  let queued=0
  for(const card of pack.drafts as KnowledgeCard[]){
   const prior=(pack.draftHistory as KnowledgeCard[]|undefined)?.find(x=>x.id===card.id&&x.revision===card.revision-1)
   if(prior){validateKnowledge(prior);if(!prior.guide||prior.guide.contentHash!==guideContentHash(prior.guide)||prior.status!=='unverified'||prior.guide.reviewStatus!=='needs_review')throw new HttpError(400,'KB_DRAFT_HISTORY_INVALID')}
   const refs=card.guide!.evidenceIds,ev=evidence.filter(e=>refs.includes(e.evidence_id)),ss=sources.filter(s=>ev.some(e=>e.source_id===s.source_id&&e.source_revision===s.source_revision)),bundle:Bundle={card,base:prior??base.find(x=>x.id===card.id),producerId:pack.producerId,sources:ss,evidence:ev,coverage,reviewPreparation:pack.reviewPreparation?.find((p:any)=>p.guideId===card.id&&p.revision===card.revision)}
   verifyBundle(bundle);const old=(await c.query('SELECT bundle FROM kb_maintenance_drafts WHERE guide_id=$1 AND revision=$2 FOR UPDATE',[card.id,card.revision])).rows[0]
   if(old){if(stableJson(old.bundle)!==stableJson(bundle))throw new HttpError(409,'KB_DRAFT_REVISION_CONFLICT');continue}
   await c.query("INSERT INTO kb_maintenance_drafts(guide_id,revision,content_hash,producer_id,queued_by,status,bundle) VALUES($1,$2,$3,$4,$5,'needs_review',$6)",[card.id,card.revision,card.guide!.contentHash,pack.producerId,actor,bundle]);queued++
  }
  return {queued,total:pack.drafts.length,publication:false}
 })
}
export async function listMaintenanceDrafts(actor:string){requirePermission(actor,'read');return {permissions:maintenancePermissions(actor),items:(await pool.query('SELECT guide_id,revision,content_hash,status,bundle->\'card\'->>\'title\' AS title FROM kb_maintenance_drafts ORDER BY created_at,guide_id')).rows}}
export async function readMaintenanceDraft(actor:string,id:string,revision:number){
 requirePermission(actor,'read');const row=(await pool.query('SELECT * FROM kb_maintenance_drafts WHERE guide_id=$1 AND revision=$2',[id,revision])).rows[0];if(!row)throw new HttpError(404,'KB_DRAFT_NOT_FOUND')
 const receipts=(await pool.query('SELECT * FROM kb_maintenance_receipts WHERE guide_id=$1 AND revision=$2 ORDER BY created_at,id',[id,revision])).rows
 return {guideId:id,revision,contentHash:row.content_hash,status:row.status,permissions:maintenancePermissions(actor),bundle:row.bundle,receipts,publicationGate:row.status==='waiting_approval'?'WAITING_AUTHORIZED_HUMAN_APPROVAL':['published','rejected','cancelled'].includes(row.status)?row.status.toUpperCase():'WAITING_INDEPENDENT_REVIEW',independentExecutionProof:'Authenticated distinct account execution only; synthetic tests never count as actual review.'}
}
export async function actOnMaintenanceDraft(actor:string,id:string,revision:number,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'KB_ACTION_INVALID')
 const a=input as Record<string,unknown>,keys=['action','contentHash','sourceHashes','notes','claimChecks']
 if(Object.keys(a).some(k=>!keys.includes(k))||typeof a.action!=='string'||!['review','approve','question','return','reject','cancel'].includes(a.action)||typeof a.notes!=='string'||a.notes.trim().length<8||!Array.isArray(a.sourceHashes)||!Array.isArray(a.claimChecks))throw new HttpError(400,'KB_ACTION_INVALID')
 const action=a.action,providedSourceHashes=a.sourceHashes as unknown[],claimChecks=a.claimChecks as unknown[];requirePermission(actor,action==='review'?'review':action==='approve'?'publish':action==='cancel'?'edit':'read')
 return transaction(async c=>{
  const row=(await c.query('SELECT * FROM kb_maintenance_drafts WHERE guide_id=$1 AND revision=$2 FOR UPDATE',[id,revision])).rows[0];if(!row)throw new HttpError(404,'KB_DRAFT_NOT_FOUND')
  const b=row.bundle as Bundle;verifyBundle(b)
  if(['rejected','cancelled','published'].includes(row.status))throw new HttpError(409,'KB_DRAFT_CLOSED')
  if(a.contentHash!==row.content_hash||stableJson([...new Set(providedSourceHashes)].sort())!==stableJson(sourceHashes(b)))throw new HttpError(409,'KB_DRAFT_CHANGED')
  if(['review','approve'].includes(action)){
   if(actor===row.producer_id||actor===row.queued_by)throw new HttpError(403,'KB_INDEPENDENT_EXECUTION_REQUIRED')
   const claims=b.card.guide!.claims.map(x=>x.id).sort();if(stableJson([...new Set(claimChecks)].sort())!==stableJson(claims))throw new HttpError(400,'KB_CLAIM_CHECKS_REQUIRED')
   for(const s of b.sources){const current=(await c.query('SELECT status,content_hash FROM kb_sources WHERE source_id=$1 AND revision=$2 FOR SHARE',[s.source_id,s.source_revision])).rows[0];if(current&&(current.status!=='body_accessible'||current.content_hash!==s.original_fingerprint))throw new HttpError(409,'KB_SOURCE_CHANGED')}
  }
  const old=(await c.query('SELECT * FROM kb_maintenance_receipts WHERE guide_id=$1 AND revision=$2 ORDER BY created_at DESC',[id,revision])).rows
  const review=old.find(x=>x.kind==='independent_review'&&x.decision==='approve')
  if(action==='approve'&&(row.status!=='waiting_approval'||!review||review.actor_id===actor))throw new HttpError(403,'KB_INDEPENDENT_REVIEW_REQUIRED')
  const receiptId=randomUUID(),kind=action==='review'?'independent_review':action==='approve'?'human_release':action,decision=['review','approve'].includes(action)?'approve':action==='reject'?'reject':action==='cancel'?'cancel':'needs_review'
  await c.query('INSERT INTO kb_maintenance_receipts(id,guide_id,revision,actor_id,kind,content_hash,source_hashes,decision,notes,claim_checks) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[receiptId,id,revision,actor,kind,row.content_hash,JSON.stringify(sourceHashes(b)),decision,a.notes,JSON.stringify(a.claimChecks)])
  let status=action==='review'?'waiting_approval':action==='reject'?'rejected':action==='cancel'?'cancelled':'needs_review'
  if(action==='approve'){
   const readings=b.evidence.map(e=>{const s=b.sources.find(s=>s.source_id===e.source_id)!;return {url:s.canonical_url,canonicalOrigin:new URL(s.canonical_url).origin,revision:s.source_revision,sourceHash:s.original_fingerprint,readerId:'public-original-reader',quote:e.quote,actuallyRead:true,withdrawn:false}})
   const candidate:MaintenanceCandidate={guideId:id,revision,contentHash:row.content_hash,producerId:row.producer_id,readings,claims:b.card.guide!.claims.map(cl=>{const ev=b.evidence.find(e=>cl.evidenceIds.includes(e.evidence_id))!;return {id:cl.id,text:cl.text,sourceHash:b.sources.find(s=>s.source_id===ev.source_id)!.original_fingerprint,quote:ev.quote,support:cl.basis==='editorial_adaptation'?'lifeos_adaptation':'source_supported'}}),coverage:b.coverage.map(x=>({candidateId:x.candidate_id,status:x.status,destination:x.guide_id})),skeptic:{reviewerId:review.actor_id,issues:[],reviewedContentHash:review.content_hash,receiptId:review.id},release:{humanReviewerId:actor,reviewedContentHash:row.content_hash,approved:true,receiptId}}
   const receipts=new Map<string,MaintenanceReviewReceipt>([review,{id:receiptId,actor_id:actor,kind,content_hash:row.content_hash,source_hashes:sourceHashes(b)}].map(r=>[r.id,{id:r.id,kind:r.kind,reviewerId:r.actor_id,producerId:row.producer_id,guideId:id,revision,contentHash:r.content_hash,sourceHashes:r.source_hashes,status:'completed',decision:'approve'}]))
   const gate=checkMaintenance(candidate,b.coverage.map(x=>x.candidate_id),()=>true,r=>readings.some(s=>stableJson(s)===stableJson(r)),id=>receipts.get(id)??null)
   if(!gate.publishEligible)throw new HttpError(409,'KB_RELEASE_GATE_REJECTED')
   const card=structuredClone(b.card);card.status='verified';card.guide!.reviewStatus='approved';card.guide!.reviewReason='独立认证账户审阅及有权账户明确批准，宿主回执绑定内容和来源。';card.guide!.review={reviewer:review.actor_id,reviewedAt:new Date().toISOString(),sourceRevisions:Object.fromEntries(b.sources.map(s=>[s.source_id,s.source_revision])),supports:b.card.guide!.claims.map(c=>c.id),cannotInfer:[b.card.limitations]}
   await importEvergreenWithin(c,[card],b.sources,b.evidence);status='published'
  }
  await c.query('UPDATE kb_maintenance_drafts SET status=$3,updated_at=now() WHERE guide_id=$1 AND revision=$2',[id,revision,status]);return {guideId:id,revision,status,receiptId,publication:status==='published',indexUpdate:'existing incremental index epoch; stale revisions excluded before serving'}
 })
}
