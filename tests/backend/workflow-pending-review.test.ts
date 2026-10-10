import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {pool} from '../../server/db.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {readApprovedGuide} from '../../server/coach-knowledge.ts'
import {guideContentHash,guideIsUsable} from '../../server/evergreen-guide.ts'
import type {KnowledgeCard} from '../../server/campus-knowledge.ts'
const corpus='.planning/research/evergreen/',directory='.planning/research/workflow-integration/evidence/acceptance-20261010/pending-review/'
const read=(name:string)=>JSON.parse(readFileSync(directory+name,'utf8'))
const lines=(name:string):any[]=>readFileSync(corpus+name,'utf8').trim().split('\n').map(row=>JSON.parse(row))
test('pending review package binds all 16 decisions and 112 destinations without changing approved content',()=>{
 const review=read('PENDING_16_REVIEW.json'),map=read('CANDIDATE_112_DISPOSITIONS.json'),pack=read('MAINLINE_REVISION_CANDIDATES.json'),cards=lines('KB_GUIDES.jsonl') as KnowledgeCard[]
 assert.equal(review.cards.length,16);assert.equal(map.rows.length,112);assert.equal(new Set(map.rows.map((r:any)=>r.candidateId)).size,112)
 assert.deepEqual(new Set(review.cards.map((r:any)=>r.guideId)),new Set(cards.filter(c=>c.guide!.reviewStatus==='needs_review').map(c=>c.id)))
 for(const [name,digest] of Object.entries(review.baselineHashes))assert.equal(createHash('sha256').update(readFileSync(corpus+name)).digest('hex'),digest)
 for(const row of map.rows){const card=cards.find(c=>c.id===row.guideId)!;assert.ok(card.guide!.branches.some(b=>b.id===row.branchId&&b.task===row.task));assert.equal(row.revision,card.revision)}
 assert.equal(map.covered,53);assert.equal(map.awaitingSource,59);assert.equal(pack.revisions.length,4)
 for(const row of review.cards){assert.equal(row.decision,'needs_review');assert.equal(row.independentReviewReceipt,null);assert.equal(row.authenticatedReleaseReceipt,null);assert.ok(row.sourceSupport&&row.remainingGap&&row.nextRevisionWork)}
 for(const r of pack.revisions){assert.equal(r.card.guide.contentHash,guideContentHash(r.card.guide));assert.equal(r.card.revision,r.baseRevision+1);assert.equal(guideIsUsable(r.card),false);assert.equal(r.releaseReceipt,null);assert.equal(r.independentReviewReceipt,null)}
 const exam=pack.revisions.find((r:any)=>r.card.guide.canonicalKey==='exam-diagnosis');assert.equal(exam.card.guide.branches.find((b:any)=>b.id==='C11-4').stage,'adjust')
 const freelance=pack.revisions.find((r:any)=>r.card.guide.canonicalKey==='delivery-review');assert.ok(freelance.card.guide.feedbackBranches.result.includes('付款'));assert.ok(freelance.card.guide.feedbackBranches.result.includes('效果'))
})
test('four pending revisions persist only in isolated PG and stay denied to student reads; old snapshots remain intact',async()=>{
 const cards=lines('KB_GUIDES.jsonl') as KnowledgeCard[],sources=lines('KB_SOURCE_REGISTRY.jsonl'),evidence=lines('KB_EVIDENCE.jsonl'),pack=read('MAINLINE_REVISION_CANDIDATES.json')
 const revisions=pack.revisions.map((r:any)=>r.card) as KnowledgeCard[],rows:any[]=[]
 try{
  assert.equal((await importEvergreenCorpus(cards,sources,evidence)).changed,32)
  assert.equal((await importEvergreenCorpus(revisions,[...sources,...pack.candidateSources],[...evidence,...pack.candidateEvidence])).changed,4)
  assert.equal((await importEvergreenCorpus(revisions,[...sources,...pack.candidateSources],[...evidence,...pack.candidateEvidence])).changed,0)
  for(const card of revisions){
   const current=(await pool.query('SELECT revision,status,payload FROM campus_knowledge WHERE id=$1',[card.id])).rows[0]
   assert.equal(current.revision,card.revision);assert.equal(current.status,'unverified');assert.deepEqual(current.payload,card)
   const original=cards.find(c=>c.id===card.id)!,old=(await pool.query('SELECT snapshot FROM campus_knowledge_revisions WHERE id=$1 AND revision=$2',[card.id,original.revision])).rows[0]
   assert.deepEqual(old.snapshot,original)
   await assert.rejects(readApprovedGuide(card.id,card.revision),(e:any)=>e.code==='COACH_KNOWLEDGE_INVALIDATED')
   await assert.rejects(readApprovedGuide(card.id,original.revision),(e:any)=>e.code==='COACH_KNOWLEDGE_INVALIDATED')
   rows.push({guideId:card.id,revision:card.revision,canonicalKey:card.guide!.canonicalKey,contentHash:current.payload.guide.contentHash,actualStatus:current.status,persistedPayloadMatched:true,oldSnapshotMatched:true,studentReadDenied:true})
  }
  assert.equal((await pool.query("SELECT count(*)::int n FROM campus_knowledge WHERE status='verified'")).rows[0].n,16)
  writeFileSync(directory+'PENDING_IMPORT_READBACK.json',JSON.stringify({status:'PASS_ISOLATED_POSTGRESQL_READBACK',realProviderCalls:0,cloudCalls:0,primaryDatabaseModified:false,importedToProduct:false,independentReviewObtained:false,releaseObtained:false,rows},null,2)+'\n')
 }finally{await pool.end()}
})
