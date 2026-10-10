import {createHash} from 'node:crypto'
import {WorkflowError} from './contracts.ts'
// Public maintenance only. Existing evergreen importer/reviewer owns publication.
export type SourceReading={url:string;canonicalOrigin:string;revision:number;sourceHash:string;readerId:string;quote:string;actuallyRead:boolean;withdrawn:boolean}
export type PublicClaim={id:string;text:string;sourceHash:string;quote:string;support:'source_supported'|'lifeos_adaptation'}
export type MaintenanceCandidate={guideId:string;revision:number;contentHash:string;readings:SourceReading[];claims:PublicClaim[];coverage:{candidateId:string;status:'covered'|'merged'|'awaiting_source'|'excluded';destination:string|null}[];producerId:string;skeptic:{reviewerId:string;issues:string[];reviewedContentHash:string;receiptId?:string};release:{humanReviewerId:string|null;reviewedContentHash:string|null;approved:boolean;receiptId?:string}}
// Resolved by a trusted host journal, never from candidate/model-provided receipt bodies.
export type MaintenanceReviewReceipt={id:string;kind:'independent_review'|'human_release';reviewerId:string;producerId:string;guideId:string;revision:number;contentHash:string;sourceHashes:string[];status:'completed'|'cancelled'|'failed';decision:'approve'|'needs_review'|'reject'}
export function checkMaintenance(candidate:MaintenanceCandidate,frozenCandidateIds:string[],verifyHostHumanRelease:(release:MaintenanceCandidate['release'],contentHash:string)=>boolean=()=>false,verifyCapturedSource:(reading:SourceReading)=>boolean=()=>false,readHostReviewReceipt:(id:string)=>MaintenanceReviewReceipt|null=()=>null):{publishEligible:boolean;status:'needs_review'|'eligible_for_host_release';issues:string[];independentSourceCount:number}{
 if(!candidate.guideId||!Number.isInteger(candidate.revision)||candidate.revision<1||!/^[a-f0-9]{64}$/.test(candidate.contentHash))throw new WorkflowError('invalid_contract')
 const issues:string[]=[]
 const sourceHashes=[...new Set(candidate.readings.filter(s=>s.actuallyRead&&!s.withdrawn).map(s=>s.sourceHash))].sort()
 function matchesReceipt(id:string|undefined,kind:MaintenanceReviewReceipt['kind'],reviewerId:string|null){
  if(!id?.trim()||!reviewerId?.trim())return false
  const receipt=readHostReviewReceipt(id)
  return !!receipt&&receipt.id===id&&receipt.kind===kind&&receipt.reviewerId===reviewerId&&receipt.producerId===candidate.producerId&&receipt.guideId===candidate.guideId&&receipt.revision===candidate.revision&&receipt.contentHash===candidate.contentHash&&receipt.status==='completed'&&receipt.decision==='approve'&&JSON.stringify([...new Set(receipt.sourceHashes)].sort())===JSON.stringify(sourceHashes)
 }
 if(candidate.skeptic.reviewerId===candidate.producerId||candidate.skeptic.reviewedContentHash!==candidate.contentHash)issues.push('independent_skeptic_required')
 if(!matchesReceipt(candidate.skeptic.receiptId,'independent_review',candidate.skeptic.reviewerId))issues.push('authenticated_skeptic_receipt_required')
 issues.push(...candidate.skeptic.issues.map(()=> 'skeptic_unresolved'))
 for(const claim of candidate.claims){
  const readings=candidate.readings.filter(s=>s.sourceHash===claim.sourceHash&&s.actuallyRead&&!s.withdrawn)
  if(!readings.length||claim.support==='source_supported'&&!readings.some(s=>s.quote.includes(claim.quote)&&claim.quote.trim()))issues.push('claim_without_read_source')
 }
 if(!candidate.claims.length)issues.push('no_claims')
 for(const s of candidate.readings){
  if(s.actuallyRead&&!s.withdrawn&&!verifyCapturedSource(s))issues.push('captured_original_required')
  let url:URL,canonical:URL
  try{url=new URL(s.url);canonical=new URL(s.canonicalOrigin)}catch{issues.push('invalid_public_url');continue}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!['https:','http:'].includes(canonical.protocol)||canonical.username||canonical.password||s.revision<1||!/^[a-f0-9]{64}$/.test(s.sourceHash))issues.push('invalid_source_metadata')
 }
 const known=new Set(frozenCandidateIds),ids=new Set(candidate.coverage.map(x=>x.candidateId))
 if(ids.size!==candidate.coverage.length||ids.size!==known.size||[...known].some(x=>!ids.has(x))||[...ids].some(x=>!known.has(x)))issues.push('coverage_incomplete_or_changed')
 if(candidate.coverage.some(x=>['covered','merged'].includes(x.status)&&!x.destination))issues.push('coverage_destination_required')
 if(!candidate.release.approved||!candidate.release.humanReviewerId||candidate.release.humanReviewerId===candidate.producerId||candidate.release.humanReviewerId===candidate.skeptic.reviewerId||candidate.release.reviewedContentHash!==candidate.contentHash)issues.push('independent_human_release_required')
 if(!verifyHostHumanRelease(candidate.release,candidate.contentHash))issues.push('authenticated_host_release_required')
 if(!matchesReceipt(candidate.release.receiptId,'human_release',candidate.release.humanReviewerId))issues.push('authenticated_release_receipt_required')
 const independentSourceCount=new Set(candidate.readings.filter(x=>x.actuallyRead&&!x.withdrawn).map(x=>x.canonicalOrigin)).size
 return {publishEligible:!issues.length,status:issues.length?'needs_review':'eligible_for_host_release',issues:[...new Set(issues)],independentSourceCount}
}
export const publicContentHash=(text:string)=>createHash('sha256').update(text).digest('hex')
