import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import {createApp} from '../../server/http.ts'
import {readApprovedGuide} from '../../server/coach-knowledge.ts'
test('normal authenticated maintenance API binds actual account receipts, denies forgery and stale state; all approvals here synthetic',async()=>{
 const app=createApp(),oldOrigin=config.origin,oldRoles=Object.fromEntries(['LIFEOS_KB_MAINTAINER_IDS','LIFEOS_KB_REVIEWER_IDS','LIFEOS_KB_PUBLISHER_IDS'].map(k=>[k,process.env[k]]))
 await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(app.address() as any).port;config.origin=origin
 const call=async(cookie:string,path:string,body?:unknown)=>{const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()}}
 const signup=async()=>{const r=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'synthetic-maintenance-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID(),name:'Synthetic adult reviewer'})});assert.equal(r.status,200);const cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');return {cookie,id:(await call(cookie,'/api/session')).body.id}}
 try{
  const editor=await signup(),reviewer=await signup(),publisher=await signup()
  assert.equal((await call(editor.cookie,'/api/maintenance/guides')).status,403)
  process.env.LIFEOS_KB_MAINTAINER_IDS=editor.id;process.env.LIFEOS_KB_REVIEWER_IDS=[editor.id,reviewer.id].join(',');process.env.LIFEOS_KB_PUBLISHER_IDS=publisher.id
  assert.equal((await call(publisher.cookie,'/api/maintenance/guides/queue',{})).status,403)
  assert.equal((await call(editor.cookie,'/api/maintenance/guides/queue',{})).body.queued,32)
  assert.equal((await call(editor.cookie,'/api/maintenance/guides/queue',{})).body.queued,0)
  const list=(await call(editor.cookie,'/api/maintenance/guides')).body.items;assert.equal(list.length,32)
  const pack=JSON.parse(readFileSync('.planning/research/evergreen/KB_CONTENT_REVISIONS.json','utf8')),card=pack.drafts.find((c:any)=>c.guide.canonicalKey==='first-contact'),path='/api/maintenance/guides/'+card.id+'/'+card.revision
  const originalBundle=(await pool.query('SELECT bundle FROM kb_maintenance_drafts WHERE guide_id=$1 AND revision=$2',[card.id,card.revision])).rows[0].bundle
  assert.equal(originalBundle.coverage.length,card.guide.branches.length)
  // A legacy full-library bundle remains usable after unrelated research. Its
  // own task's scope change still conflicts and cannot reuse a review receipt.
  const legacyCoverage=JSON.parse(readFileSync('.planning/research/evergreen/KB_COVERAGE.json','utf8'))
  legacyCoverage.find((x:any)=>!card.guide.branches.some((b:any)=>b.candidateId===x.candidate_id)).remaining_claim='Synthetic unrelated card revision only'
  await pool.query('UPDATE kb_maintenance_drafts SET bundle=$3 WHERE guide_id=$1 AND revision=$2',[card.id,card.revision,{...originalBundle,coverage:legacyCoverage}])
  assert.equal((await call(editor.cookie,'/api/maintenance/guides/queue',{})).body.queued,0)
  legacyCoverage.find((x:any)=>x.candidate_id===card.guide.branches[0].candidateId).remaining_claim='Synthetic incompatible scope for THIS revision'
  await pool.query('UPDATE kb_maintenance_drafts SET bundle=$3 WHERE guide_id=$1 AND revision=$2',[card.id,card.revision,{...originalBundle,coverage:legacyCoverage}])
  assert.equal((await call(editor.cookie,'/api/maintenance/guides/queue',{})).body.error,'KB_DRAFT_REVISION_CONFLICT')
  await pool.query('UPDATE kb_maintenance_drafts SET bundle=$3 WHERE guide_id=$1 AND revision=$2',[card.id,card.revision,originalBundle])
  const detail=(await call(reviewer.cookie,path)).body,sourceHashes=[...new Set(detail.bundle.sources.map((s:any)=>s.original_fingerprint))].sort(),action={contentHash:detail.contentHash,sourceHashes,notes:'SYNTHETIC fixture only, explicitly checked every bounded claim and original source locator',claimChecks:card.guide.claims.map((c:any)=>c.id)}
  assert.equal(detail.bundle.reviewPreparation.contentHash,detail.contentHash)
  assert.equal(detail.bundle.reviewPreparation.status,'PREPARED_NOT_INDEPENDENTLY_EXECUTED')
  assert.equal(detail.bundle.reviewPreparation.claimChecks.length,card.guide.claims.length)
  assert.equal(detail.bundle.base.revision,card.revision-1)
  assert.equal(detail.bundle.base.guide.contentHash,pack.draftHistory.find((c:any)=>c.id===card.id).guide.contentHash)
  assert.equal(detail.bundle.reviewPreparation.branchChecks.length,6)
  await assert.rejects(readApprovedGuide(card.id,card.revision))
  assert.equal((await call(editor.cookie,path+'/actions',{...action,action:'review'})).body.error,'KB_INDEPENDENT_EXECUTION_REQUIRED')
  assert.equal((await call(publisher.cookie,path+'/actions',{...action,action:'approve',reviewerId:reviewer.id,receiptId:randomUUID()})).body.error,'KB_ACTION_INVALID')
  assert.equal((await call(publisher.cookie,path+'/actions',{...action,action:'approve'})).body.error,'KB_INDEPENDENT_REVIEW_REQUIRED')
  assert.equal((await call(reviewer.cookie,path+'/actions',{...action,action:'review',contentHash:'0'.repeat(64)})).body.error,'KB_DRAFT_CHANGED')
  assert.equal((await call(reviewer.cookie,path+'/actions',{...action,action:'review',sourceHashes:['f'.repeat(64)]})).body.error,'KB_DRAFT_CHANGED')
  assert.equal((await call(reviewer.cookie,path+'/actions',{...action,action:'review',claimChecks:[]})).body.error,'KB_CLAIM_CHECKS_REQUIRED')
  assert.equal((await call(reviewer.cookie,path+'/actions',{...action,action:'review'})).body.status,'waiting_approval')
  const pending=(await call(publisher.cookie,path)).body;assert.equal(pending.status,'waiting_approval');assert.equal(pending.receipts[0].actor_id,reviewer.id)
  const approved=await call(publisher.cookie,path+'/actions',{...action,action:'approve'});assert.equal(approved.status,200,JSON.stringify(approved.body));assert.equal(approved.body.status,'published')
  const served=await readApprovedGuide(card.id,card.revision);assert.equal(served.guide!.contentHash,card.guide.contentHash)
  assert.equal((await call(publisher.cookie,path+'/actions',{...action,action:'approve'})).body.error,'KB_DRAFT_CLOSED')
  const second=list.find((x:any)=>x.guide_id!==card.id),p2='/api/maintenance/guides/'+second.guide_id+'/'+second.revision,d2=(await call(editor.cookie,p2)).body,a2={action:'cancel',contentHash:d2.contentHash,sourceHashes:d2.bundle.sources.map((s:any)=>s.original_fingerprint),notes:'Synthetic fixture cancellation keeps pending content unavailable',claimChecks:[]}
  assert.equal((await call(editor.cookie,p2+'/actions',a2)).body.status,'cancelled');assert.equal((await call(reviewer.cookie,p2+'/actions',{...a2,action:'review'})).body.error,'KB_DRAFT_CLOSED')
  const third=pack.drafts.find((x:any)=>x.guide.canonicalKey==='course-frame'),p3='/api/maintenance/guides/'+third.id+'/'+third.revision,d3=(await call(reviewer.cookie,p3)).body,s3=d3.bundle.sources[0]
  const withdrawn=await pool.query("UPDATE kb_sources SET status='unavailable' WHERE source_id=$1 AND revision=$2",[s3.source_id,s3.source_revision])
  if(!withdrawn.rowCount)await pool.query('INSERT INTO kb_sources(source_id,revision,source_group,canonical_url,status,content_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[s3.source_id,s3.source_revision,s3.source_group,s3.canonical_url,'unavailable',s3.original_fingerprint,s3])
  const a3={...action,action:'review',contentHash:d3.contentHash,sourceHashes:d3.bundle.sources.map((s:any)=>s.original_fingerprint),claimChecks:third.guide.claims.map((c:any)=>c.id)}
  assert.equal((await call(reviewer.cookie,p3+'/actions',a3)).body.error,'KB_SOURCE_CHANGED')
  await pool.query("UPDATE kb_sources SET status='body_accessible',content_hash=$2 WHERE source_id=$1",[s3.source_id,'f'.repeat(64)])
  assert.equal((await call(reviewer.cookie,p3+'/actions',a3)).body.error,'KB_SOURCE_CHANGED')
  await pool.query('UPDATE kb_sources SET content_hash=$2 WHERE source_id=$1',[s3.source_id,s3.original_fingerprint])
  const latest=(await call(publisher.cookie,path)).body;assert.equal(latest.receipts.length,2);assert.notEqual(latest.receipts[0].actor_id,latest.receipts[1].actor_id)
  const ev=process.env.LIFEOS_WORKFLOW_EVIDENCE;if(ev){mkdirSync(ev,{recursive:true});writeFileSync(ev+'/MAINTENANCE_HTTP.json',JSON.stringify({status:'PASS_LOCAL_AUTHENTICATED_HTTP_PG_SYNTHETIC_USERS',realIndependentReviews:0,realHumanApprovals:0,realPublication:false,queued:32,waitingApprovalCheckpoint:{guideId:card.id,revision:card.revision,status:pending.status},syntheticPublishedReadback:{guideId:served.id,revision:served.revision,contentHash:served.guide!.contentHash},guards:['same_actor','fake_receipt','no_review','wrong_hash','source_hash_changed','stored_source_withdrawn','stored_source_hash_changed','missing_claim_check','cancel','duplicate_release']},null,2)+'\n')}
 }finally{
  const ids=JSON.parse(readFileSync('.planning/research/evergreen/KB_CONTENT_REVISIONS.json','utf8')).drafts.map((c:any)=>c.id)
  await pool.query('DELETE FROM kb_maintenance_receipts WHERE guide_id=ANY($1::uuid[])',[ids]);await pool.query('DELETE FROM kb_maintenance_drafts WHERE guide_id=ANY($1::uuid[])',[ids])
  await pool.query('DELETE FROM kb_aliases WHERE guide_id=ANY($1::uuid[])',[ids]);await pool.query('DELETE FROM campus_knowledge_revisions WHERE id=ANY($1::uuid[])',[ids]);await pool.query('DELETE FROM campus_knowledge WHERE id=ANY($1::uuid[])',[ids])
  for(const [key,value] of Object.entries(oldRoles))value===undefined?delete process.env[key]:process.env[key]=value;config.origin=oldOrigin;await new Promise<void>(r=>app.close(()=>r()));app.closeAllConnections();await pool.end()
 }
})
