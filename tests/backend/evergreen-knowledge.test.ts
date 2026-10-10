import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import {importEvergreenCorpus,resolveKnowledgeAlias} from '../../server/evergreen-maintenance.ts'
import {buildKnowledgeIndex,retrieveIndexedKnowledge,clearKnowledgeIndexMemory,knowledgeIndexSignature} from '../../server/knowledge-index.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {classifyGuideFeedback,feedbackMatchesCurrent,suggestedGuideUsage,readGuideUsage} from '../../server/guide-usage.ts'
import {stageCoachEvent} from '../../server/action-coach-events.ts'
import * as store from '../../server/store.ts'
import type {KnowledgeCard} from '../../server/campus-knowledge.ts'
import {validateCoachCitations} from '../../server/coach-knowledge.ts'
import {setMemorySettings} from '../../server/memory.ts'
const root='.planning/research/evergreen/'
const read=(name:string)=>readFileSync(root+name,'utf8').trim().split('\n').map(s=>JSON.parse(s))
test('evergreen import, persistent real encoder index, withdrawal and owned action feedback',async t=>{
 const cards=read('KB_GUIDES.jsonl') as KnowledgeCard[],sources=read('KB_SOURCE_REGISTRY.jsonl'),evidence=read('KB_EVIDENCE.jsonl')
 const user='evergreen-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal,report:any={evidence:'REAL_ISOLATED_POSTGRESQL_AND_LOCAL_ENCODER',realProviderCalls:0}
 try{
  await t.test('corpus import is atomic and idempotent; unreviewed cards stay unusable',async()=>{
   assert.equal((await importEvergreenCorpus(cards,sources,evidence)).changed,32)
   assert.equal((await importEvergreenCorpus(cards,sources,evidence)).changed,0)
   const card=cards.find(c=>c.guide!.legacyIds.length)!
   assert.equal(await resolveKnowledgeAlias(card.guide!.legacyIds[0]),card.id)
   assert.equal((await pool.query("SELECT count(*)::int n FROM campus_knowledge WHERE status='verified'")).rows[0].n,cards.filter(c=>c.status==='verified').length)
   const conflict=structuredClone(card);conflict.revision=2;conflict.guide!.legacyIds=[cards.find(c=>c.id!==card.id&&c.guide!.legacyIds.length)!.guide!.legacyIds[0]]
   const {guideContentHash}=await import('../../server/evergreen-guide.ts');conflict.guide!.contentHash=guideContentHash(conflict.guide!)
   await assert.rejects(importEvergreenCorpus([conflict],sources,evidence),(e:any)=>e.code==='KB_ALIAS_CONFLICT')
   assert.equal((await pool.query('SELECT revision FROM campus_knowledge WHERE id=$1',[card.id])).rows[0].revision,1)
   const approved=cards.find(c=>c.status==='verified')!
   await assert.rejects(validateCoachCitations('这个方法保证录取。',[{claimId:approved.id}],[approved],''),(e:any)=>e.code==='COACH_CITATION_SCOPE_UNSUPPORTED')
  })
  await t.test('persistent index reuse does not encode all cards after warmup or process cache loss',async()=>{
   report.coldIndex=await buildKnowledgeIndex(signal)
   let calls=0
   report.warmIndex=await buildKnowledgeIndex(signal,async texts=>{calls+=texts.length;throw new Error('UNEXPECTED_REENCODE')})
   assert.equal(calls,0);assert.equal(report.warmIndex.encodedSegments,0)
   clearKnowledgeIndexMemory()
   const queried=await retrieveIndexedKnowledge('如何找到学校的图书馆和教务资源？',signal)
   assert.ok(queried.cards.length);assert.ok(queried.cards.every(c=>c.guide?.reviewStatus==='approved'))
   assert.equal(queried.trace.queryEncoded,true)
   report.sampleTrace=queried.trace
   const {evaluateEvergreen}=await import('../../scripts/evergreen-evaluation.ts')
   const evaluation=await evaluateEvergreen(cards)
   report.frozenEvaluation={routing:evaluation.routing,recall5:evaluation.recall5,top1:evaluation.top1,corpus:evaluation.corpus}
   const indexBefore=(await pool.query('SELECT indexed_epoch FROM kb_index_state')).rows[0].indexed_epoch
   const aborted=new AbortController();aborted.abort()
   await assert.rejects(buildKnowledgeIndex(aborted.signal))
   assert.equal((await pool.query('SELECT indexed_epoch FROM kb_index_state')).rows[0].indexed_epoch,indexBefore)
  })
  await t.test('recipe upgrades reuse old vectors and one revision does not encode the whole corpus',async()=>{
   const legacySignature=knowledgeIndexSignature.split(':evergreen-segments-')[0]+':evergreen-segments-v1'
   await pool.query("INSERT INTO kb_segments(guide_id,revision,signature,part,content_hash,body,evidence_ids,embedding) SELECT guide_id,revision,$1,part,content_hash,body,evidence_ids,embedding FROM kb_segments WHERE signature=$2 AND part NOT LIKE 'expression:%' AND part NOT LIKE 'action:%' AND part<>'mechanism' ON CONFLICT DO NOTHING",[legacySignature,knowledgeIndexSignature])
   await pool.query('DELETE FROM kb_segments WHERE signature=$1',[knowledgeIndexSignature])
   let encoded=0
   const upgrade=await buildKnowledgeIndex(signal,async texts=>{encoded+=texts.length;return localEmbedding.encode(texts,false,signal)})
   assert.equal(encoded,upgrade.encodedSegments);assert.ok(upgrade.cacheHits>0);assert.ok(encoded<upgrade.segments)
   const revised=structuredClone(cards.find(c=>c.guide!.canonicalKey==='course-frame')!)
   revised.revision=2;revised.guide!.oneKeyQuestion='SYNTHETIC revised question: 哪个概念断开？'
   const {guideContentHash}=await import('../../server/evergreen-guide.ts');revised.guide!.contentHash=guideContentHash(revised.guide!)
   await importEvergreenCorpus([revised],sources,evidence)
   const change=await buildKnowledgeIndex(signal)
   assert.ok(change.encodedSegments>0);assert.ok(change.encodedSegments<upgrade.segments/2)
   const found=await retrieveIndexedKnowledge('怎么整理困难课程的知识框架？',signal)
   assert.ok(found.cards.every(c=>c.id!==revised.id||c.revision===2))
   assert.equal((await pool.query("SELECT count(*)::int n FROM kb_segments WHERE guide_id=$1 AND revision=2 AND part LIKE 'expression:%'",[revised.id])).rows[0].n,0)
   report.recipeUpgrade=upgrade;report.singleRevision=change
  })
  await t.test('only user reports move the same event; question, third-party and negative-result boundaries hold',async()=>{
   assert.equal(classifyGuideFeedback('如果我发了，没人回复怎么办？'),null)
   assert.equal(classifyGuideFeedback('朋友已经发了，没人回。'),null)
   assert.equal(classifyGuideFeedback('我已经发了，还没收到结果。'),'waiting_result')
   assert.equal(classifyGuideFeedback('我已经试了，没人回。'),'blocked')
   assert.equal(classifyGuideFeedback('我愿意试这个方法。'),'accepted')
   assert.equal(classifyGuideFeedback('我不想继续了。'),'declined')
   assert.equal(feedbackMatchesCurrent('现在想验证创业需求，按上次我联系了导师','准备期末','间隔复习'),false)
   assert.equal(feedbackMatchesCurrent('按上次办法，我已经完成了比赛。','校园产品需求','找目标用户'),false)
   await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
   await store.createConversation(user,{id:chat,title:'SYNTHETIC owned action'})
   const card=cards.find(c=>c.guide!.canonicalKey==='user-interview')!,raw='我想先确认校园产品的用户需要。'
   const run=(await store.startRun(user,chat,randomUUID(),raw)).run
   const coach=await stageCoachEvent(run,{target:{operation:'create',title:'校园产品需求',source:{messageId:run.source_message_id,quote:raw}},action:{operation:'create',draft:{content:'先确认一个实际问题。'}}},'先确认一个实际问题。')
   const suggestion=suggestedGuideUsage(card,coach.eventId)!
   const suggestedReceipt=await store.finishRun(run,{candidates:[],audit:[],coach,guideUsage:[suggestion]},'先确认一个实际问题。',null,signal)
   assert.equal(suggestedReceipt.stateChange.guideUsage.status,'applied')
   assert.equal(suggestedReceipt.stateChange.guideUsage.items[0].status,'suggested')
   assert.equal((await readGuideUsage(user,chat,coach.eventId))[0].status,'suggested')
   const feedbackText='按上次办法，我已经联系了两人，没人回。',feedbackRun=(await store.startRun(user,chat,randomUUID(),feedbackText)).run
   const feedbackReceipt=await store.finishRun(feedbackRun,{candidates:[],audit:[],guideUsage:[{...suggestion,status:'blocked',sourceMessageId:feedbackRun.source_message_id,sourceQuote:feedbackText}]},'先核对原消息和等待情况。',null,signal)
   assert.equal(feedbackReceipt.stateChange.guideUsage.items[0].status,'blocked')
   assert.ok(!('sourceQuote' in feedbackReceipt.stateChange.guideUsage.items[0]))
   assert.equal((await readGuideUsage(user,chat,coach.eventId))[0].status,'blocked')
   assert.equal((await pool.query('SELECT count(*)::int n FROM experiences WHERE user_id=$1',[user])).rows[0].n,0)
   await assert.rejects(readGuideUsage('someone-else',chat,coach.eventId))
   await assert.rejects(readGuideUsage(user,randomUUID(),coach.eventId),{code:'NOT_FOUND'})
   const secondChat=randomUUID();await store.createConversation(user,{id:secondChat,title:'SYNTHETIC second session'})
   await assert.rejects(readGuideUsage(user,secondChat,coach.eventId),{code:'MEMORY_DISABLED'})
   await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
   assert.equal((await readGuideUsage(user,secondChat,coach.eventId))[0].status,'blocked')
   await setMemorySettings(user,{requestId:randomUUID(),enabled:false,expectedRevision:1})
   await assert.rejects(readGuideUsage(user,secondChat,coach.eventId),{code:'MEMORY_DISABLED'})
   report.ownedFeedback={suggested:true,blocked:true,privateExperienceNotInvented:true}
   const sourceId=card.guide!.evidenceIds[0].replace(/-e1$/,'')
   await pool.query("UPDATE kb_sources SET status='retired' WHERE source_id=$1",[sourceId])
   await assert.rejects(importEvergreenCorpus(cards,sources,evidence),(e:any)=>e.code==='KB_SOURCE_WITHDRAWN')
   assert.deepEqual(await readGuideUsage(user,chat,coach.eventId),[])
   assert.ok(!(await retrieveIndexedKnowledge('如何访谈创业用户？',signal)).cards.some(c=>c.id===card.id))
   report.withdrawal={usageHidden:true,retrievalHidden:true}
  })
  report.status='PASS'
 }finally{
  mkdirSync('.local/evergreen',{recursive:true});writeFileSync('.local/evergreen/backend-report.json',JSON.stringify(report,null,2)+'\n')
  await localEmbedding.close()
  await pool.query('DELETE FROM "user" WHERE id=$1',[user])
  const ids=cards.map(c=>c.id)
  await pool.query('DELETE FROM kb_aliases WHERE guide_id=ANY($1::uuid[])',[ids])
  await pool.query('DELETE FROM campus_knowledge_revisions WHERE id=ANY($1::uuid[])',[ids])
  await pool.query('DELETE FROM campus_knowledge WHERE id=ANY($1::uuid[])',[ids])
  await pool.query('DELETE FROM kb_evidence WHERE evidence_id=ANY($1::text[])',[evidence.map(e=>e.evidence_id)])
  await pool.query('DELETE FROM kb_sources WHERE source_id=ANY($1::text[])',[sources.map(s=>s.source_id)])
  clearKnowledgeIndexMemory();await pool.end()
 }
})
