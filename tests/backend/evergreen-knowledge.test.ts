import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {pool} from '../../server/db.ts'
import {importEvergreenCorpus,resolveKnowledgeAlias} from '../../server/evergreen-maintenance.ts'
import {buildKnowledgeIndex,retrieveIndexedKnowledge,clearKnowledgeIndexMemory,knowledgeIndexSignature} from '../../server/knowledge-index.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {classifyGuideFeedback,feedbackMatchesCurrent,guideFeedbackSource,suggestedGuideUsage,readGuideUsage} from '../../server/guide-usage.ts'
import {stageCoachEvent} from '../../server/action-coach-events.ts'
import * as store from '../../server/store.ts'
import type {KnowledgeCard} from '../../server/campus-knowledge.ts'
import {validateCoachCitations} from '../../server/coach-knowledge.ts'
import {setMemorySettings,applyMemoryAction} from '../../server/memory.ts'
test('guide feedback normalizes an ordinary prepositional matter phrase',()=>{
 assert.equal(feedbackMatchesCurrent('关于数据分析岗位，我还是卡住了。','数据分析岗位准备','核对数据分析岗位技能'),true)
 assert.equal(feedbackMatchesCurrent('我对数据分析岗位还是卡住了。','数据分析岗位准备','核对数据分析岗位技能'),true)
 assert.equal(feedbackMatchesCurrent('我在数据分析岗位上还是卡住了。','数据分析岗位准备','核对数据分析岗位技能'),true)
 assert.equal(feedbackMatchesCurrent('我已经尝试了平台级人工智能应用开发工程师岗位，但还是卡住了。','终端级人工智能应用开发工程师岗位','核对终端级人工智能应用开发工程师岗位技能'),false)
 assert.equal(feedbackMatchesCurrent('我已经尝试了终端级人工智能应用开发工程师岗位，但还是卡住了。','终端级人工智能应用开发工程师岗位','核对终端级人工智能应用开发工程师岗位技能'),true)
 assert.equal(feedbackMatchesCurrent('之前我尝试了数据分析岗位但还是卡住了。','数据分析岗位准备','核对数据分析岗位技能'),true)
 assert.equal(feedbackMatchesCurrent('我已核对数据分析岗位，但还是卡住了。','数据分析岗位准备','核对数据分析岗位技能'),true)
 assert.equal(feedbackMatchesCurrent('我核对了薪资和数据分析岗位，但还是卡住了。','数据分析岗位准备','核对数据分析岗位技能'),true)
 assert.equal(feedbackMatchesCurrent('我已经完成了研究生考试复习。','考研备考','核对考研错题'),true)
 assert.equal(feedbackMatchesCurrent('我已经完成了公务员考试复习。','考公备考','核对考公错题'),true)
 assert.equal(feedbackMatchesCurrent('我高数复习还是卡住了。','高等数学期末复习','核对第一道错题'),true)
 assert.equal(feedbackMatchesCurrent('我按上次方法做了，为什么还是卡住了？','数据分析岗位准备','核对数据分析岗位技能'),true)
 assert.equal(classifyGuideFeedback('我按上次方法做了，为什么还是卡住了？'),'blocked')
 assert.equal(feedbackMatchesCurrent('我按上次方法做了但为什么还是卡住了？','数据分析岗位准备','核对数据分析岗位技能'),true)
 assert.equal(classifyGuideFeedback('我按上次方法做了但为什么还是卡住了？'),'blocked')
 assert.equal(feedbackMatchesCurrent('我在数据分析岗位上怎么做了才不会卡住？','数据分析岗位准备','核对数据分析岗位技能'),false)
 assert.equal(classifyGuideFeedback('我在数据分析岗位上怎么做了才不会卡住？'),null)
 assert.equal(feedbackMatchesCurrent('我按上次方法做了会卡住吗？','数据分析岗位准备','核对数据分析岗位技能'),false)
 assert.equal(classifyGuideFeedback('我按上次方法做了会卡住吗？'),null)
})
const root='.planning/research/evergreen/'
const read=(name:string)=>readFileSync(root+name,'utf8').trim().split('\n').map(s=>JSON.parse(s))
test('evergreen import, persistent real encoder index, withdrawal and owned action feedback',async t=>{
 const cards=read('KB_GUIDES.jsonl') as KnowledgeCard[],sources=read('KB_SOURCE_REGISTRY.jsonl'),evidence=read('KB_EVIDENCE.jsonl')
 const reportDir=process.env.LIFEOS_WORKFLOW_EVIDENCE??'.local/evergreen'
 mkdirSync(reportDir,{recursive:true})
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
   const evaluation=await evaluateEvergreen(cards,{jsonPath:join(reportDir,'KNOWLEDGE_LEGACY235_REGRESSION.json'),markdownPath:join(reportDir,'KNOWLEDGE_LEGACY235_REGRESSION.md')})
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
   assert.equal(feedbackMatchesCurrent('我看了产品运营岗位四分钟，只核对了薪资，没有完成。','数据分析岗位技能核对','核对数据分析岗位技能'),false)
   assert.equal(feedbackMatchesCurrent('我已经尝试了测试开发岗位核对，但还是卡住了。','开发岗位准备','核对开发岗位技能'),false)
   assert.equal(feedbackMatchesCurrent('我已经尝试了数据分析岗位核对，但还是卡住了。','数据分析岗位准备','核对数据分析岗位技能'),true)
   assert.equal(feedbackMatchesCurrent('我已经完成了数据分析岗位核对，但还是卡住了。','数据分析岗位准备','核对数据分析岗位技能'),true)
   assert.equal(feedbackMatchesCurrent('我已经完成了英语六级复习。','高等数学期末复习','核对第一道错题'),false)
   assert.equal(feedbackMatchesCurrent('我已经完成了英语六级复习。','英语四级复习','核对一套英语四级错题'),false)
   assert.equal(feedbackMatchesCurrent('英语四级复习是旧记录；英语六级复习已经完成。','英语四级复习','核对英语四级错题'),false)
   assert.equal(feedbackMatchesCurrent('按上次办法，我已经完成了英语六级复习。','英语四级复习','核对一套英语四级错题'),false)
   assert.equal(feedbackMatchesCurrent('我已经尝试了英语四级复习，但还是卡住了。','CET4备考','核对CET4错题'),true)
   assert.equal(feedbackMatchesCurrent('我已经尝试了CET-4错题，但还是卡住了。','英语四级复习','核对一套大学英语四级错题'),true)
   assert.equal(feedbackMatchesCurrent('我已经尝试了四级复习，但还是卡住了。','CET4备考','核对CET4错题'),true)
   assert.equal(feedbackMatchesCurrent('昨天我完成了英语四级复习。','CET4备考','核对CET4错题'),true)
   assert.equal(feedbackMatchesCurrent('我已经尝试了六级复习，但还是卡住了。','CET4备考','核对CET4错题'),false)
   assert.equal(feedbackMatchesCurrent('英语四级复习资料在哪里？','CET4备考','核对CET4错题'),false)
   await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
   await store.createConversation(user,{id:chat,title:'SYNTHETIC owned action'})
   const card=cards.find(c=>c.guide!.canonicalKey==='user-interview')!,raw='我想先确认校园产品的用户需要。请帮我写一句需要确认的问题。'
   const run=(await store.startRun(user,chat,randomUUID(),raw)).run
   const coach=await stageCoachEvent(run,{target:{operation:'create',title:'校园产品需求',source:{messageId:run.source_message_id,quote:raw}},action:{operation:'create',source:{messageId:run.source_message_id,quote:'请帮我写一句需要确认的问题'},draft:{content:'先确认一个实际问题。'}}},'先确认一个实际问题。')
   const suggestion=suggestedGuideUsage(card,coach.eventId)!
   const suggestedReceipt=await store.finishRun(run,{candidates:[],audit:[],coach,guideUsage:[suggestion]},'先确认一个实际问题。',null,signal)
   assert.equal(suggestedReceipt.stateChange.guideUsage.status,'applied')
   assert.equal(suggestedReceipt.stateChange.guideUsage.items[0].status,'suggested')
   assert.equal((await readGuideUsage(user,chat,coach.eventId))[0].status,'suggested')
   await assert.rejects(pool.query('INSERT INTO kb_guide_usage(id,user_id,event_id,guide_id,revision,branch,step_id,status,source_message_id,source_quote,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10)',[randomUUID(),user,coach.eventId,suggestion.guideId,suggestion.revision,suggestion.branch,suggestion.stepId,'blocked',run.source_message_id,randomUUID()]),(error:any)=>error?.code==='23514','factual guide usage cannot exist without source provenance')
   await assert.rejects(pool.query("INSERT INTO kb_guide_usage(id,user_id,event_id,guide_id,revision,branch,step_id,status,source_message_id,source_quote,request_id,source_start,source_end) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,' ',$10,0,1)",[randomUUID(),user,coach.eventId,suggestion.guideId,suggestion.revision,suggestion.branch,suggestion.stepId,'blocked',run.source_message_id,randomUUID()]),(error:any)=>error?.code==='23514','whitespace cannot be factual provenance even with an exact range')
   const guideIdentity={title:'校园产品需求',task:card.guide!.branches.find(branch=>branch.id===suggestion.branch)!.task}
   const feedbackText='按上次办法，我已经联系了两人，没人回。',feedbackRun=(await store.startRun(user,chat,randomUUID(),feedbackText)).run,feedbackSource=guideFeedbackSource(feedbackText,'blocked',guideIdentity)!
   const feedbackReceipt=await store.finishRun(feedbackRun,{candidates:[],audit:[],guideUsage:[{...suggestion,status:'blocked',sourceMessageId:feedbackRun.source_message_id,sourceQuote:feedbackSource.quote}]},'先核对原消息和等待情况。',null,signal)
   assert.equal(feedbackReceipt.stateChange.guideUsage.items[0].status,'blocked')
   assert.ok(!('sourceQuote' in feedbackReceipt.stateChange.guideUsage.items[0]))
   assert.ok(!('sourceRange' in feedbackReceipt.stateChange.guideUsage.items[0]),'persistence-only source offsets never enter the public completion receipt')
   const feedbackUsage=(await pool.query('SELECT id,source_start,source_end FROM kb_guide_usage WHERE user_id=$1 AND request_id=$2',[user,feedbackRun.request_id])).rows[0]
   const publicFeedbackUsage=(await readGuideUsage(user,chat,coach.eventId)).find(row=>row.id===feedbackUsage.id)!
   assert.ok(!('source_start' in publicFeedbackUsage)&&!('source_end' in publicFeedbackUsage),'persistence-only source offsets never enter the guide-usage read contract')
   for(const [start,end] of [[feedbackUsage.source_start,null],[null,feedbackUsage.source_end]])await assert.rejects(pool.query('UPDATE kb_guide_usage SET source_start=$2,source_end=$3 WHERE id=$1',[feedbackUsage.id,start,end]),(error:any)=>error?.code==='23514','source coordinates are atomic')
   const secondaryCard=cards.find(candidate=>candidate.id!==card.id&&candidate.guide)!,secondarySuggestion=suggestedGuideUsage(secondaryCard,coach.eventId)!
   const mixedText='关于校园产品需求，我按上次方法做了但还是卡住了。',mixedRun=(await store.startRun(user,chat,randomUUID(),mixedText)).run,mixedSource=guideFeedbackSource(mixedText,'blocked',guideIdentity)!
   await store.finishRun(mixedRun,{candidates:[],audit:[],guideUsage:[{...suggestion,status:'blocked',sourceMessageId:mixedRun.source_message_id,sourceQuote:mixedSource.quote},secondarySuggestion]},'已记录反馈，并保留另一方法为建议。',null,signal)
   const mixedRows=(await pool.query('SELECT guide_id,status,source_message_id,source_quote,source_start,source_end FROM kb_guide_usage WHERE user_id=$1 AND request_id=$2 ORDER BY status',[user,mixedRun.request_id])).rows
   assert.equal(mixedRows.length,2,'one transaction persists factual feedback and an independent suggestion')
   const suggestedRow=mixedRows.find(row=>row.status==='suggested')!
   assert.equal(suggestedRow.source_message_id,null)
   assert.equal(suggestedRow.source_quote,null)
   assert.equal(suggestedRow.source_start,null,'a later suggestion cannot inherit the prior factual item range')
   assert.equal(suggestedRow.source_end,null,'guide-usage provenance resets for every item')
   await pool.query('DELETE FROM kb_guide_usage WHERE user_id=$1 AND request_id=$2 AND guide_id=$3',[user,mixedRun.request_id,secondarySuggestion.guideId])
   const legacyQuote='按上次办法，我已经联系了两人，没人回。',legacyText='补充说明；'+legacyQuote+'；后续说明',legacyRun=(await store.startRun(user,chat,randomUUID(),legacyText)).run
   await store.finishRun(legacyRun,{candidates:[],audit:[]},'已记录。',null,signal)
   const legacyUsageId=randomUUID(),legacyStart=legacyText.indexOf(legacyQuote)
   await pool.query("INSERT INTO kb_guide_usage(id,user_id,event_id,guide_id,revision,branch,step_id,status,source_message_id,source_quote,request_id,source_start,source_end) VALUES($1,$2,$3,$4,$5,$6,$7,'suggested',NULL,$8,$9,$10,$11)",[legacyUsageId,user,coach.eventId,suggestion.guideId,suggestion.revision,suggestion.branch,suggestion.stepId,legacyQuote,legacyRun.request_id,legacyStart,legacyStart+legacyQuote.length])
   assert.ok((await readGuideUsage(user,chat,coach.eventId)).some(row=>row.id===legacyUsageId),'a legacy request-bound source is readable before its exact range is forgotten')
   const legacyMemoryId=randomUUID()
   await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','priorAttempts',$3,'user_reported','user',$4,now(),now(),'active')",[legacyMemoryId,user,JSON.stringify(legacyQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:legacyRun.source_message_id,quote:legacyQuote,range:{start:legacyStart,end:legacyStart+legacyQuote.length}}])])
   await applyMemoryAction(user,legacyMemoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
   assert.ok(!(await readGuideUsage(user,chat,coach.eventId)).some(row=>row.id===legacyUsageId),'a scoped forget applies through the request-bound effective message id even when the legacy source_message_id is null')
   const microsecondBase='2040-01-01T00:00:00.123900Z'
   await pool.query('UPDATE kb_guide_usage SET created_at=$2::timestamptz WHERE id=$1',[feedbackUsage.id,'2040-01-01T00:00:00.123800Z'])
   for(let index=1;index<=24;index++)await pool.query("INSERT INTO kb_guide_usage(id,user_id,event_id,guide_id,revision,branch,step_id,status,source_message_id,source_quote,request_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'blocked',$8,$9,$10,$11::timestamptz+($12::int*interval '1 microsecond'))",[randomUUID(),user,coach.eventId,suggestion.guideId,suggestion.revision,suggestion.branch,suggestion.stepId,feedbackRun.source_message_id,`SYNTHETIC_INVALID_SOURCE_${index}`,randomUUID(),microsecondBase,25-index])
   const usageAfterInvalidNewerRows=await readGuideUsage(user,chat,coach.eventId)
   assert.ok(usageAfterInvalidNewerRows.some(row=>row.id===feedbackUsage.id),'same-millisecond invalid legacy rows cannot exhaust or round the keyset cursor past an older authoritative feedback')
   assert.equal(usageAfterInvalidNewerRows.find(row=>row.id===feedbackUsage.id)?.status,'blocked')
   assert.equal((await pool.query('SELECT count(*)::int n FROM experiences WHERE user_id=$1',[user])).rows[0].n,0)
   await assert.rejects(readGuideUsage('someone-else',chat,coach.eventId))
   await assert.rejects(readGuideUsage(user,randomUUID(),coach.eventId),{code:'NOT_FOUND'})
   const secondChat=randomUUID();await store.createConversation(user,{id:secondChat,title:'SYNTHETIC second session'})
   await assert.rejects(readGuideUsage(user,secondChat,coach.eventId),{code:'MEMORY_DISABLED'})
   await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
   assert.equal((await readGuideUsage(user,secondChat,coach.eventId))[0].status,'blocked')
   await setMemorySettings(user,{requestId:randomUUID(),enabled:false,expectedRevision:1})
   await assert.rejects(readGuideUsage(user,secondChat,coach.eventId),{code:'MEMORY_DISABLED'})
    const feedbackMemoryId=randomUUID()
    await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','priorAttempts',$3,'user_reported','user',$4,now(),now(),'active')",[feedbackMemoryId,user,JSON.stringify(feedbackText),JSON.stringify([{type:'message',conversationId:chat,messageId:feedbackRun.source_message_id,quote:feedbackText,range:{start:0,end:feedbackText.length}}])])
    await applyMemoryAction(user,feedbackMemoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
    assert.ok(!(await readGuideUsage(user,chat,coach.eventId)).some(row=>row.source_message_id===feedbackRun.source_message_id),'a ranged memory forget removes the overlapping guide-usage source')
    const duplicateText=feedbackText+'；'+feedbackText,duplicateRun=(await store.startRun(user,chat,randomUUID(),duplicateText)).run,duplicateSource=guideFeedbackSource(duplicateText,'blocked',guideIdentity)!
    await store.finishRun(duplicateRun,{candidates:[],audit:[],guideUsage:[{...suggestion,status:'blocked',sourceMessageId:duplicateRun.source_message_id,sourceQuote:duplicateSource.quote}]},'第二次独立反馈已记录。',null,signal)
    assert.equal((await pool.query('SELECT source_start FROM kb_guide_usage WHERE user_id=$1 AND request_id=$2',[user,duplicateRun.request_id])).rows[0].source_start,duplicateSource.range.start,'the server binds the latest exact duplicate occurrence without caller coordinates')
    const duplicateMemoryId=randomUUID()
    await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','priorAttempts',$3,'user_reported','user',$4,now(),now(),'active')",[duplicateMemoryId,user,JSON.stringify(feedbackText),JSON.stringify([{type:'message',conversationId:chat,messageId:duplicateRun.source_message_id,quote:feedbackText,range:{start:0,end:feedbackText.length}}])])
    await applyMemoryAction(user,duplicateMemoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
    assert.ok((await readGuideUsage(user,chat,coach.eventId)).some(row=>row.source_message_id===duplicateRun.source_message_id),'forgetting the first identical occurrence preserves guide usage backed by the second exact range')
    const forgedRun=(await store.startRun(user,chat,randomUUID(),duplicateText)).run,firstDuplicateStart=duplicateText.indexOf(duplicateSource.quote)
    await assert.rejects(store.finishRun(forgedRun,{candidates:[],audit:[],guideUsage:[{...suggestion,status:'blocked',sourceMessageId:forgedRun.source_message_id,sourceQuote:duplicateSource.quote,sourceRange:{start:firstDuplicateStart,end:firstDuplicateStart+duplicateSource.quote.length}}]},'不能接受伪造位置。',null,signal),{code:'KB_USER_REPORT_REQUIRED'})
    await store.terminateRun(user,forgedRun.request_id,'cancelled','SYNTHETIC_RANGE_MISMATCH')
    for(const conflictText of ['关于宿舍矛盾；还是卡住了。','关于室友关系；还是卡住了。']){
     const conflictRun=(await store.startRun(user,chat,randomUUID(),conflictText)).run
     await assert.rejects(store.finishRun(conflictRun,{candidates:[],audit:[],guideUsage:[{...suggestion,status:'blocked',sourceMessageId:conflictRun.source_message_id,sourceQuote:'还是卡住了'}]},'不能把其他事项绑定到校园产品。',null,signal),{code:'KB_USER_REPORT_REQUIRED'})
     await store.terminateRun(user,conflictRun.request_id,'cancelled','SYNTHETIC_CONFLICTING_GUIDE_IDENTITY')
    }
    const matterQuote='关于校园产品需求',identityText=matterQuote+'；还是卡住了。',identityRun=(await store.startRun(user,chat,randomUUID(),identityText)).run,identitySource=guideFeedbackSource(identityText,'blocked',guideIdentity)!
    assert.match(identitySource.quote,/校园产品需求/,'the persisted source includes the clause that selects this matter')
    await store.finishRun(identityRun,{candidates:[],audit:[],guideUsage:[{...suggestion,status:'blocked',sourceMessageId:identityRun.source_message_id,sourceQuote:identitySource.quote}]},'事项身份和状态一起记录。',null,signal)
    const identityMemoryId=randomUUID()
    await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','currentConcern',$3,'user_reported','user',$4,now(),now(),'active')",[identityMemoryId,user,JSON.stringify(matterQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:identityRun.source_message_id,quote:matterQuote,range:{start:0,end:matterQuote.length}}])])
    await applyMemoryAction(user,identityMemoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
    assert.ok(!(await readGuideUsage(user,chat,coach.eventId)).some(row=>row.source_message_id===identityRun.source_message_id),'forgetting the matter-binding clause hides a generic status that no longer has task identity')
   report.ownedFeedback={suggested:true,blocked:true,privateExperienceNotInvented:true}
   const sourceId=card.guide!.evidenceIds[0].replace(/-e1$/,'')
   await pool.query("UPDATE kb_sources SET status='retired' WHERE source_id=$1",[sourceId])
   await assert.rejects(importEvergreenCorpus(cards,sources,evidence),(e:any)=>e.code==='KB_SOURCE_WITHDRAWN')
   assert.deepEqual(await readGuideUsage(user,chat,coach.eventId),[])
   assert.ok(!(await retrieveIndexedKnowledge('如何访谈创业用户？',signal)).cards.some(c=>c.id===card.id))
   report.withdrawal={usageHidden:true,retrievalHidden:true}
   await store.deleteConversation(user,chat)
   await assert.rejects(readGuideUsage(user,chat,coach.eventId),{code:'NOT_FOUND'},'a deleted event conversation cannot remain an API authority for guide usage')
  })
  report.status='OBSERVATIONS_ONLY_TEST_RUNNER_IS_VERDICT'
 }finally{
  try{writeFileSync(join(reportDir,'backend-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'})}finally{
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
 }
})
