import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash,randomUUID} from 'node:crypto'
import {load} from 'cheerio'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import {createApp} from '../../server/http.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {checkMaintenance} from '../../server/workflows/knowledge-maintenance.ts'
import {authorizedGuideApplication} from '../../server/workflows/host.ts'
import {stageCoachEvent} from '../../server/action-coach-events.ts'
import {readGuideUsage} from '../../server/guide-usage.ts'
import * as store from '../../server/store.ts'
test('WF-D one actual original body → extraction → separate source validator → controlled needs_review import → HTTP denial; guide Skill host tool and native usage readback',async()=>{
 const root='.planning/research/evergreen/',read=(name:string)=>readFileSync(root+name,'utf8').trim().split('\n').map(x=>JSON.parse(x)),captured=JSON.parse(readFileSync('.planning/research/workflow-integration/evidence/public-card/candidate.json','utf8')),bytes=readFileSync('.planning/research/workflow-integration/evidence/public-card/original.html'),$=load(bytes.toString())
 $('script,style,nav,footer').remove();const body=$('body').text().replace(/\s+/g,' ').trim(),digest=createHash('sha256').update(bytes).digest('hex'),verified=(reading:any)=>reading.sourceHash===digest&&body.includes(reading.quote)
 assert.equal(digest,captured.reading.bodySha256);assert.equal(captured.card.id,captured.candidate.guideId);assert.equal(captured.card.guide.contentHash,captured.candidate.contentHash)
 const gate=checkMaintenance(captured.candidate,['C04-1'],()=>false,verified);assert.equal(gate.publishEligible,false);assert.deepEqual(gate.issues,['independent_human_release_required','authenticated_host_release_required'])
 const falseReading=structuredClone(captured.candidate);falseReading.readings[0].sourceHash='f'.repeat(64);assert.ok(checkMaintenance(falseReading,['C04-1'],()=>true,verified).issues.includes('captured_original_required'))
 const app=createApp(),oldFlag=process.env.LIFEOS_ADVANCED_WORKFLOWS;process.env.LIFEOS_ADVANCED_WORKFLOWS='true';await new Promise<void>(done=>app.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+(app.address() as {port:number}).port
 try{
  const cards=read('KB_GUIDES.jsonl');await importEvergreenCorpus(cards,read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
  const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json'},body:JSON.stringify({email:'public-card-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID(),name:'Synthetic adult'})});assert.equal(signup.status,200);const cookie=signup.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '),get=(path:string)=>fetch(origin+path,{headers:{Cookie:cookie}}),user=(await (await get('/api/session')).json()).id
  const full=await get('/api/knowledge/'+captured.card.id+'?revision=1');assert.equal(full.status,200);const card=cards.find(c=>c.id===captured.card.id)!,chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC guide Skill'})
  const text='我想用主动回忆检查已经学过的一章。',run=(await store.startRun(user,chat,randomUUID(),text)).run,coach=await stageCoachEvent(run,{target:{operation:'create',title:'主动回忆检查',source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]},'先回答一个已学问题。'),staged:store.Staged={candidates:[],audit:[],coach}
  const suggestion=authorizedGuideApplication(run,staged,card,coach.eventId)!;staged.guideUsage=[suggestion];await store.finishRun(run,staged,coach.reply,null,new AbortController().signal);assert.equal((await readGuideUsage(user,chat,coach.eventId))[0].status,'suggested');assert.ok(staged.audit.some((x:any)=>x.skill==='lifeos-guide-application'&&x.skillDigest.length===64))
  const usage=await get('/api/conversations/'+chat+'/guide-usage?event='+coach.eventId);assert.equal(usage.status,200);assert.equal((await usage.json()).items[0].status,'suggested')
  await importEvergreenCorpus([captured.card],[captured.source],[captured.evidence]);const row=(await pool.query('SELECT revision,payload FROM campus_knowledge WHERE id=$1',[captured.card.id])).rows[0];assert.equal(row.revision,2);assert.equal(row.payload.guide.reviewStatus,'needs_review')
  assert.equal((await get('/api/knowledge/'+captured.card.id+'?revision=2')).status,409,'unapproved card cannot be used by students');assert.deepEqual(await readGuideUsage(user,chat,coach.eventId),[],'old revision suggestion is invalidated rather than silently upgraded')
  assert.throws(()=>authorizedGuideApplication(run,{candidates:[],audit:[]},captured.card,coach.eventId),/source_invalid/)
  const needsReview=JSON.parse(readFileSync('.planning/research/workflow-integration/evidence/public-card/needs-review-candidate.json','utf8'));assert.equal(cards.find(c=>c.id===needsReview.card.id).guide.reviewStatus,'needs_review');assert.equal(needsReview.card.id,'d259a5aa-ec96-43f7-89ab-5f5c87031f1c');assert.equal(needsReview.reading.bodySha256,digest)
  const reviewed=checkMaintenance(needsReview.candidate,needsReview.candidate.coverage.map((x:any)=>x.candidateId),()=>false,verified);assert.ok(reviewed.issues.includes('skeptic_unresolved'));assert.equal(reviewed.publishEligible,false);assert.ok(needsReview.unresolvedSourceGap.includes('四类错误诊断'));assert.ok(needsReview.candidate.coverage.every((x:any)=>x.status==='awaiting_source'))
  await importEvergreenCorpus([needsReview.card],[needsReview.source],[needsReview.evidence]);assert.equal((await get('/api/knowledge/'+needsReview.card.id+'?revision=2')).status,409);assert.equal((await pool.query('SELECT revision FROM campus_knowledge WHERE id=$1',[needsReview.card.id])).rows[0].revision,2)
  writeFileSync('.planning/research/workflow-integration/evidence/PUBLIC_CARD_CHAIN.json',JSON.stringify({status:'PASS',evidence:'REAL_CAPTURED_PUBLIC_HTML_REAL_ISOLATED_PG_REAL_AUTH_HTTP_LOCAL_SKILL',sourceHash:digest,canonicalId:card.id,candidateRevision:2,existingNeedsReviewCard:{canonicalId:needsReview.card.id,originalStatus:'needs_review',candidateRevision:2,scopeIssue:needsReview.unresolvedSourceGap,publishEligible:false,coverage:'awaiting_source',gate:reviewed},reviewStatus:'needs_review',publication:'NOT_PUBLISHED',independentAgentReview:'NOT_TESTED',independentHumanApproval:'NOT_OBTAINED',originalCorpusModified:false,mainDatabaseModified:false,hostSkillTrace:staged.audit,checks:['captured original hash and literal quote','source fake boolean insufficient','separate source validator','native authorized Skill candidate and guide usage commit','HTTP refreshed usage','controlled unapproved import','student API denies revision 2','old usage disappears on revision change','existing needs_review exam card: actual source cannot support four-category diagnosis; source gap retained, controlled revision imported, student API denies']},null,2)+'\n')
 }finally{app.closeAllConnections();await new Promise<void>(done=>app.close(()=>done()));if(oldFlag===undefined)delete process.env.LIFEOS_ADVANCED_WORKFLOWS;else process.env.LIFEOS_ADVANCED_WORKFLOWS=oldFlag;await pool.end()}
})
