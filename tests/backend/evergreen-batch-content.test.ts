import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {readApprovedGuide} from '../../server/coach-knowledge.ts'
import {kbHash,guideContentHash} from '../../server/evergreen-guide.ts'
const dir='.planning/research/evergreen/',json=(n:string)=>JSON.parse(readFileSync(dir+n,'utf8')),lines=(n:string)=>readFileSync(dir+n,'utf8').trim().split('\n').map(x=>JSON.parse(x))
test.after(()=>pool.end())
test('32 substantive revisions, 59 actual research outcomes and unchanged 112 tasks remain distinct from approval',()=>{
 const pack=json('KB_CONTENT_REVISIONS.json'),research=json('KB_GAP_RESEARCH.json'),original=lines('KB_GUIDES.jsonl'),coverage=json('KB_COVERAGE.json')
 assert.equal(pack.baselineHash,kbHash(readFileSync(dir+'KB_GUIDES.jsonl','utf8')));assert.equal(pack.drafts.length,32);assert.equal(pack.decisions.length,32);assert.equal(coverage.length,112);assert.equal(research.rows.length,59)
 for(const card of pack.drafts){const old=original.find(x=>x.id===card.id);assert.ok(old);assert.ok(card.revision>old.revision);assert.equal(card.revision,pack.decisions.find((d:any)=>d.guideId===card.id).revision);assert.notEqual(card.guide.contentHash,old.guide.contentHash);assert.equal(card.guide.contentHash,guideContentHash(card.guide));assert.equal(card.status,'unverified');assert.equal(card.guide.reviewStatus,'needs_review');assert.equal(card.guide.review,null);assert.ok(card.guide.branches.every((b:any)=>b.steps.length>=3));assert.ok(card.guide.referenceBody.includes('什么时候不用'));for(const key of ['not_started','blocked','waiting_result','result','declined'])assert.ok(card.guide.feedbackBranches[key].length>15)}
 for(const row of research.rows){assert.ok(row.attempts.length||row.readSource);assert.ok(row.methodExtracted.length>=3);assert.ok(row.stillMissingClaim);assert.equal(row.approval,'WAITING_INDEPENDENT_REVIEW_AND_HUMAN_APPROVAL')}
 for(const e of pack.evidence)assert.equal(kbHash(e.quote),e.content_hash)
 assert.equal(pack.independentReviews,0);assert.equal(pack.humanApprovals,0)
 assert.equal(pack.reviewPreparation.length,32)
 for(const prep of pack.reviewPreparation){const card=pack.drafts.find((c:any)=>c.id===prep.guideId);assert.equal(prep.contentHash,card.guide.contentHash);assert.deepEqual(prep.claimChecks.map((c:any)=>c.claimId).sort(),card.guide.claims.map((c:any)=>c.id).sort());assert.equal(prep.executionRecord,null);assert.equal(prep.humanApproval,null);assert.ok(prep.claimChecks.every((c:any)=>c.basis==='editorial_adaptation'||c.originals.length))}
 const contact=pack.drafts.find((c:any)=>c.guide.canonicalKey==='first-contact');assert.ok(contact.limitations.includes('推荐信'));assert.ok(contact.guide.referenceBody.includes('导师联系'))
 const delivery=pack.drafts.find((c:any)=>c.guide.canonicalKey==='delivery-review');assert.ok(delivery.guide.referenceBody.includes('付款'));assert.ok(delivery.guide.referenceBody.includes('效果'))
 const team=pack.drafts.find((c:any)=>c.guide.canonicalKey==='team-contract');assert.ok(team.limitations.includes('MBTI'));assert.equal(team.guide.branches.find((b:any)=>b.id==='C24-4').stage,'adjust')
})
test('first-contact branches cannot borrow mentor evidence for social, career or startup steps',()=>{
 const pack=json('KB_CONTENT_REVISIONS.json'),card=pack.drafts.find((c:any)=>c.guide.canonicalKey==='first-contact'),prep=pack.reviewPreparation.find((p:any)=>p.guideId===card.id)
 const branch=(id:string)=>card.guide.branches.find((b:any)=>b.candidateId===id)
 for(const id of ['C01-3','C25-1']){assert.ok(branch(id).steps.every((s:any)=>!s.text.includes('导师')&&s.evidenceIds.length===0));assert.equal(prep.branchChecks.find((b:any)=>b.candidateId===id).sourceStatus,'UNCHANGED_TASK_SPECIFIC_SOURCE_GAP')}
 for(const [id,source] of [['C07-3','career-author'],['C13-4','pku-recommendation'],['C20-3','pg-first-users']])assert.ok(branch(id).steps.every((s:any)=>s.evidenceIds.length>0&&s.evidenceIds.every((e:string)=>e.startsWith(source))))
 assert.ok(branch('C09-1').steps.some((s:any)=>s.evidenceIds.some((id:string)=>id.startsWith('ustc-mentor-choice'))))
 assert.equal(new Set(prep.branchChecks.map((b:any)=>b.candidateId)).size,6)
 for(const b of prep.branchChecks){assert.equal(b.independentExecution,null);assert.equal(b.humanApproval,null);for(const k of ['not_started','blocked','waiting_result','result','declined'])assert.ok(b.feedback[k])}
 for(const e of pack.evidence.filter((e:any)=>/branch-20261011/.test(e.evidence_id))){assert.equal(e.locator.end-e.locator.start,e.quote.length);assert.equal(kbHash(e.quote),e.content_hash);assert.match(e.locator.normalizedBodySha256,/^[a-f0-9]{64}$/)}
})
test('research obstacles cannot inherit exam evidence or a made-up solved exercise',()=>{
 const pack=json('KB_CONTENT_REVISIONS.json'),card=pack.drafts.find((c:any)=>c.guide.canonicalKey==='exam-diagnosis'),prep=pack.reviewPreparation.find((p:any)=>p.guideId===card.id)
 const research=card.guide.branches.find((b:any)=>b.candidateId==='C09-4')
 assert.ok(research.steps.every((s:any)=>s.evidenceIds.length===0&&!s.text.includes('已做题')))
 assert.equal(prep.branchChecks.find((b:any)=>b.candidateId==='C09-4').sourceStatus,'UNCHANGED_TASK_SPECIFIC_SOURCE_GAP')
 for(const id of ['C03-4','C11-4','C12-3'])assert.ok(prep.branchChecks.find((b:any)=>b.candidateId===id).evidenceIds.includes('tsinghua-exam-reflection-20261011-e1'))
 const previous=pack.draftHistory.find((c:any)=>c.id===card.id&&c.revision===card.revision-1)
 assert.equal(previous.guide.contentHash,guideContentHash(previous.guide));assert.equal(prep.previousDraftHash,previous.guide.contentHash)
 const located=pack.evidence.find((e:any)=>e.evidence_id==='tsinghua-exam-reflection-20261011-e1')
 assert.equal(located.locator.end-located.locator.start,located.quote.length);assert.equal(kbHash(located.quote),located.content_hash)
 for(const b of prep.branchChecks){assert.equal(b.independentExecution,null);assert.equal(b.humanApproval,null);assert.ok(b.feedback.waiting_result.includes('不判有效'));assert.ok(b.feedback.declined.includes('停止'))}
})
test('delivery review uses the actual agreement source and preserves unknown payment, outcome and refusal',()=>{
 const pack=json('KB_CONTENT_REVISIONS.json'),card=pack.drafts.find((c:any)=>c.guide.canonicalKey==='delivery-review'),g=card.guide
 assert.equal(card.revision,3);assert.equal(g.stage,'adjust')
 assert.ok(!g.evidenceIds.includes('upwork-delivery-e1'),'the old purpose fragment must not support the repaired procedure')
 const source=pack.sources.find((s:any)=>s.source_id==='upwork-close-review-20261011')
 assert.equal(source.fingerprint_scope,'LOCATED_SHORT_QUOTE_SNAPSHOT_NOT_FULL_HTML')
 const evidence=pack.evidence.find((e:any)=>e.evidence_id==='upwork-close-review-20261011-e1')
 assert.equal(evidence.locator.fullBodyCaptured,false);assert.equal(kbHash(evidence.quote),evidence.content_hash)
 assert.ok(g.claims.some((c:any)=>c.basis==='source_supported'&&c.evidenceIds.includes(evidence.evidence_id)))
 assert.ok(g.claims.some((c:any)=>c.basis==='editorial_adaptation'&&c.evidenceIds.length===0),'do not fabricate citations for editorial recording fields')
 assert.ok(g.feedbackBranches.waiting_result.includes('不代表采用'));assert.ok(g.feedbackBranches.result.includes('付款不能代替效果'));assert.ok(g.feedbackBranches.declined.includes('停止'))
 assert.ok(g.feedbackBranches.blocked.includes('打不开'));assert.ok(g.feedbackBranches.blocked.includes('不重送'))
 const previous=pack.draftHistory.find((c:any)=>c.id===card.id&&c.revision===2)
 assert.equal(previous.guide.contentHash,guideContentHash(previous.guide))
 assert.equal(pack.reviewPreparation.find((p:any)=>p.guideId===card.id).previousDraftHash,previous.guide.contentHash)
})

test('drafts and located source snapshots import idempotently only into the disposable database and deny student reads',async()=>{
 const pack=json('KB_CONTENT_REVISIONS.json'),cards=lines('KB_GUIDES.jsonl'),sources=lines('KB_SOURCE_REGISTRY.jsonl'),evidence=lines('KB_EVIDENCE.jsonl')
 // Each suite owns its card identities, even when the isolated runner shares its disposable DB.
 const ids=new Map(cards.map((c:any)=>[c.id,randomUUID()]));for(const c of [...cards,...pack.drafts]){c.id=ids.get(c.id);c.guide.guideId=c.id;c.guide.canonicalKey='batch-fixture-'+c.guide.canonicalKey;c.guide.aliases=c.guide.aliases.map((a:string)=>'batch-fixture-'+a);c.guide.legacyIds=c.guide.legacyIds.map((a:string)=>'batch-fixture-'+a);c.guide.contentHash=guideContentHash(c.guide)}
 assert.equal((await importEvergreenCorpus(cards,sources,evidence)).changed,32)
 assert.equal((await importEvergreenCorpus(pack.drafts,[...sources,...pack.sources],[...evidence,...pack.evidence])).changed,32)
 assert.equal((await importEvergreenCorpus(pack.drafts,[...sources,...pack.sources],[...evidence,...pack.evidence])).changed,0)
 for(const card of pack.drafts){await assert.rejects(readApprovedGuide(card.id,card.revision));assert.deepEqual((await pool.query('SELECT snapshot FROM campus_knowledge_revisions WHERE id=$1 AND revision=1',[card.id])).rows[0].snapshot,cards.find(x=>x.id===card.id))}
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM campus_knowledge WHERE id=ANY($1::uuid[]) AND status='verified'",[[...ids.values()]])).rows[0].n,0)
})
