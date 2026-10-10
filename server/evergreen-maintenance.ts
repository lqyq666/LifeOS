import {pool,transaction,HttpError} from './db.ts'
import {importKnowledgeWithin,validateKnowledge,type KnowledgeCard} from './campus-knowledge.ts'
import {kbHash,stableJson,validateEvergreenGuide} from './evergreen-guide.ts'

// No chat/HTTP route invokes this controlled maintenance entry point.
export async function importEvergreenCorpus(cards:KnowledgeCard[],sources:any[],evidence:any[]){
 for(const card of cards){
  validateKnowledge(card)
  if(!card.guide)throw new HttpError(400,'EVERGREEN_GUIDE_REQUIRED')
  const g=card.guide
  for(const id of g.evidenceIds){const e=evidence.find(row=>row.evidence_id===id),s=e&&sources.find(row=>row.source_id===e.source_id&&row.source_revision===e.source_revision)
   if(!e||!s||s.access_status!=='body_accessible'||kbHash(e.quote)!==e.content_hash||!e.locator||g.reviewStatus==='approved'&&g.review?.sourceRevisions[e.source_id]!==e.source_revision)throw new HttpError(400,'KB_EVIDENCE_UNAVAILABLE')
  }
  for(const claim of g.claims)if(claim.basis==='bounded_synthesis'){
   const groups=new Set(claim.evidenceIds.map(id=>{const e=evidence.find(row=>row.evidence_id===id);return sources.find(s=>s.source_id===e?.source_id)?.source_group}))
   if(groups.size<2||groups.has(undefined))throw new HttpError(400,'KB_INDEPENDENCE_REQUIRED')
  }
 }
 // Metadata, immutable revisions and aliases commit together or not at all.
 return transaction(async c=>{
  for(const s of sources){const old=(await c.query('SELECT payload,status FROM kb_sources WHERE source_id=$1 AND revision=$2 FOR SHARE',[s.source_id,s.source_revision])).rows[0]
   if(old){if(stableJson(old.payload)!==stableJson(s))throw new HttpError(409,'KB_SOURCE_REVISION_CONFLICT');if(old.status!==s.access_status)throw new HttpError(409,'KB_SOURCE_WITHDRAWN');continue}
   await c.query('INSERT INTO kb_sources(source_id,revision,source_group,canonical_url,status,content_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[s.source_id,s.source_revision,s.source_group,s.canonical_url,s.access_status,s.original_fingerprint,s])
  }
  for(const e of evidence){const old=(await c.query('SELECT payload FROM kb_evidence WHERE evidence_id=$1 FOR SHARE',[e.evidence_id])).rows[0]
   if(old){if(stableJson(old.payload)!==stableJson(e))throw new HttpError(409,'KB_EVIDENCE_REVISION_CONFLICT');continue}
   await c.query('INSERT INTO kb_evidence(evidence_id,source_id,source_revision,content_hash,payload) VALUES($1,$2,$3,$4,$5)',[e.evidence_id,e.source_id,e.source_revision,e.content_hash,e])
  }
 const result=await importKnowledgeWithin(c,cards)
  for(const card of cards)for(const alias of card.guide!.legacyIds){
   const old=(await c.query('SELECT guide_id FROM kb_aliases WHERE alias=$1 FOR UPDATE',[alias])).rows[0]
   if(old&&old.guide_id!==card.id)throw new HttpError(409,'KB_ALIAS_CONFLICT')
   await c.query('INSERT INTO kb_aliases(alias,guide_id,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[alias,card.id,'旧自拟攻略按机制归并；保留原行和历史引用，不删除。'])
  }
 return result
 })
}
export async function resolveKnowledgeAlias(alias:string){
 const row=(await pool.query('SELECT guide_id FROM kb_aliases WHERE alias=$1',[alias])).rows[0]
 return row?.guide_id??alias
}
