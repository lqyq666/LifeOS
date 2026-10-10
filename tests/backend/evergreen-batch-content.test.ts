import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {pool} from '../../server/db.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {readApprovedGuide} from '../../server/coach-knowledge.ts'
import {kbHash,guideContentHash} from '../../server/evergreen-guide.ts'
const dir='.planning/research/evergreen/',json=(n:string)=>JSON.parse(readFileSync(dir+n,'utf8')),lines=(n:string)=>readFileSync(dir+n,'utf8').trim().split('\n').map(x=>JSON.parse(x))
test.after(()=>pool.end())
test('32 substantive revisions, 59 actual research outcomes and unchanged 112 tasks remain distinct from approval',()=>{
 const pack=json('KB_CONTENT_REVISIONS.json'),research=json('KB_GAP_RESEARCH.json'),original=lines('KB_GUIDES.jsonl'),coverage=json('KB_COVERAGE.json')
 assert.equal(pack.baselineHash,kbHash(readFileSync(dir+'KB_GUIDES.jsonl','utf8')));assert.equal(pack.drafts.length,32);assert.equal(pack.decisions.length,32);assert.equal(coverage.length,112);assert.equal(research.rows.length,59)
 for(const card of pack.drafts){const old=original.find(x=>x.id===card.id);assert.ok(old);assert.equal(card.revision,old.revision+1);assert.notEqual(card.guide.contentHash,old.guide.contentHash);assert.equal(card.guide.contentHash,guideContentHash(card.guide));assert.equal(card.status,'unverified');assert.equal(card.guide.reviewStatus,'needs_review');assert.equal(card.guide.review,null);assert.ok(card.guide.branches.every((b:any)=>b.steps.length>=3));assert.ok(card.guide.referenceBody.includes('什么时候不用'));for(const key of ['not_started','blocked','waiting_result','result','declined'])assert.ok(card.guide.feedbackBranches[key].length>15)}
 for(const row of research.rows){assert.ok(row.attempts.length||row.readSource);assert.ok(row.methodExtracted.length>=3);assert.ok(row.stillMissingClaim);assert.equal(row.approval,'WAITING_INDEPENDENT_REVIEW_AND_HUMAN_APPROVAL')}
 for(const e of pack.evidence)assert.equal(kbHash(e.quote),e.content_hash)
 assert.equal(pack.independentReviews,0);assert.equal(pack.humanApprovals,0)
 const contact=pack.drafts.find((c:any)=>c.guide.canonicalKey==='first-contact');assert.ok(contact.limitations.includes('推荐信'));assert.ok(contact.guide.referenceBody.includes('导师联系'))
 const delivery=pack.drafts.find((c:any)=>c.guide.canonicalKey==='delivery-review');assert.ok(delivery.guide.referenceBody.includes('付款'));assert.ok(delivery.guide.referenceBody.includes('效果'))
 const team=pack.drafts.find((c:any)=>c.guide.canonicalKey==='team-contract');assert.ok(team.limitations.includes('MBTI'));assert.equal(team.guide.branches.find((b:any)=>b.id==='C24-4').stage,'adjust')
})
test('drafts and located source snapshots import idempotently only into the disposable database and deny student reads',async()=>{
 const pack=json('KB_CONTENT_REVISIONS.json'),cards=lines('KB_GUIDES.jsonl'),sources=lines('KB_SOURCE_REGISTRY.jsonl'),evidence=lines('KB_EVIDENCE.jsonl')
 assert.equal((await importEvergreenCorpus(cards,sources,evidence)).changed,32)
 assert.equal((await importEvergreenCorpus(pack.drafts,[...sources,...pack.sources],[...evidence,...pack.evidence])).changed,32)
 assert.equal((await importEvergreenCorpus(pack.drafts,[...sources,...pack.sources],[...evidence,...pack.evidence])).changed,0)
 for(const card of pack.drafts){await assert.rejects(readApprovedGuide(card.id,card.revision));assert.deepEqual((await pool.query('SELECT snapshot FROM campus_knowledge_revisions WHERE id=$1 AND revision=1',[card.id])).rows[0].snapshot,cards.find(x=>x.id===card.id))}
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM campus_knowledge WHERE status='verified'")).rows[0].n,0)
})
