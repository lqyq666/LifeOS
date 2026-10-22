import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import * as store from '../../server/store.ts'
import {validate,experienceActionSchema} from '../../server/contracts.ts'
import {recordEditingDraft,recordCorrectionContent} from '../../src/features/cognition/recordDraft.ts'

test.after(async()=>{await localEmbedding.close();await pool.end()})

test('record editor patches retain actual source metadata and absent facts with revision and replay protection',async()=>{
  const user='record-correction-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'Synthetic record corrections'})
  for(const legacy of [false,true]){
    const text='我整理了一份课程资料',started=await store.startRun(user,chat,randomUUID(),text)
    await store.terminateRun(user,started.run.request_id,'cancelled','RECORD_CORRECTION_FIXTURE')
    const id=randomUUID(),content={title:'资料记录',summary:text,source:' original ',tags:[' 标记 ',' 标记 '],...(!legacy?{action:'我发送了PDF',result:'是否阅读未知',reflection:'先保留未知'}:{})}
    await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',2)",[id,user,chat,started.run.source_message_id,text,started.run.request_id,content])
    const initial=recordEditingDraft(content,{}),next=legacy?{...initial,summary:'本人更正了这段经历'}:{...initial,result:'已收到回复，采用未知'}
    const input=validate(experienceActionSchema,{requestId:randomUUID(),expectedRevision:2,action:'correct',content:recordCorrectionContent(initial,next)})
    const saved=await store.experienceAction(user,id,input)
    assert.equal(saved.revision,3)
    assert.equal(saved.content.source,content.source)
    assert.deepEqual(saved.content.tags,content.tags)
    if(legacy)assert.equal(Object.hasOwn(saved.content,'action'),false,'display defaults never become new facts')
    else {assert.equal(saved.content.title,'资料记录','changing result must not rename the experience');assert.equal(saved.content.action,'我发送了PDF');assert.equal(saved.content.result,'已收到回复，采用未知');assert.equal(saved.content.reflection,'先保留未知')}
    assert.equal((await store.experienceAction(user,id,input)).revision,3,'same operation replay does not apply twice')
    await assert.rejects(()=>store.experienceAction(user,id,{...input,requestId:randomUUID()}),/EXPERIENCE_REVISION_CONFLICT/)
  }
})

test('explicit result corrections update only that record outcome labels without promoting ambiguous text',async()=>{
  const user='record-outcomes-'+randomUUID(),chat=randomUUID(),text='我把课程资料发给学长了，学长还没回复。'
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'Synthetic corrected result labels'})
  const run=await store.startRun(user,chat,randomUUID(),text)
  await store.terminateRun(user,run.run.request_id,'cancelled','CORRECTED_LABELS_FIXTURE')
  const id=randomUUID(),otherId=randomUUID(),content={title:'资料协作',summary:text,action:'我把课程资料发给学长了',result:'学长还没回复',reflection:'是否读过仍未知'}
  for(const experience of [id,otherId])await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',2)",[experience,user,chat,run.run.source_message_id,experience===id?text:'另一段独立资料记录',run.run.request_id,content])
  await store.experienceAction(user,id,{requestId:randomUUID(),expectedRevision:2,action:'correct',content:{summary:text,result:'学长已回复，是否采用未知'}})
  const graph=await store.cognitionGraph(user),node=graph.nodes.find((item:any)=>item.serverId===id) as any
  assert.equal(node.taskOutcomes.response.status,'reported_response')
  assert.equal(node.taskOutcomes.response.quote,'学长已回复')
  assert.equal(node.taskOutcomes.response.sourceExperienceRevision,3)
  assert.equal(node.taskOutcomes.response.sourceField,'result')
  assert.equal(node.asReported.basis,'record_correction')
  assert.equal(node.asReported.result,'学长已回复，是否采用未知')
  assert.equal(node.asReported.sourceExperienceRevision,3)
  assert.ok(Number.isFinite(Date.parse(node.asReported.reportedAt)))
  assert.equal(node.taskOutcomes.read.status,'unknown')
  assert.equal(node.taskOutcomes.adoption.status,'unknown')
  assert.ok(!node.experienceSummary.unknowns.includes('是否回应'))
  const other=graph.nodes.find((item:any)=>item.serverId===otherId) as any
  assert.equal(other.taskOutcomes.response.status,'unknown','one record edit cannot promote another record')
  assert.equal(other.resultBasis,'unverified_record')
  assert.equal(other.asReported,undefined,'an unsupported legacy string is not testimony')
  let revision=3
  for(const result of ['如果学长已回复就好了','老师说：“学长已回复。”','学长已回复，导师还没回复','不知道学长是否回复','']){
    await store.experienceAction(user,id,{requestId:randomUUID(),expectedRevision:revision++,action:'correct',content:{summary:text,result}})
    const current=(await store.cognitionGraph(user)).nodes.find((item:any)=>item.serverId===id) as any
    assert.equal(current.taskOutcomes.response.status,'unknown',result||'cleared result')
  }
  await store.experienceAction(user,id,{requestId:randomUUID(),expectedRevision:revision++,action:'correct',content:{summary:text,result:'学长未回复'}})
  const negative=(await store.cognitionGraph(user)).nodes.find((item:any)=>item.serverId===id) as any
  assert.equal(negative.taskOutcomes.response.status,'reported_no_response')
})

test('a result-only correction never invents an absent legacy title',async()=>{
  const user='record-no-title-'+randomUUID(),chat=randomUUID(),text='我整理了课程资料'
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'Synthetic legacy record'})
  const run=await store.startRun(user,chat,randomUUID(),text)
  await store.terminateRun(user,run.run.request_id,'cancelled','LEGACY_TITLE_FIXTURE')
  const id=randomUUID()
  await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',2)",[id,user,chat,run.run.source_message_id,text,run.run.request_id,{summary:text}])
  const saved=await store.experienceAction(user,id,{requestId:randomUUID(),expectedRevision:2,action:'correct',content:{summary:text,result:'学长已回复'}})
  assert.equal(Object.hasOwn(saved.content,'title'),false)
})

test('later PDF evidence cannot become the original link status even without a separate PDF experience row',async()=>{
 const {setMemorySettings}=await import('../../server/memory.ts'),{stageGrowthUpdates}=await import('../../server/growth.ts')
 const user='artifact-projection-'+randomUUID(),chat=randomUUID(),id=randomUUID()
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await setMemorySettings(user,{enabled:true,expectedRevision:0,requestId:randomUUID()})
 await store.createConversation(user,{id:chat,title:'SYNTHETIC link versus PDF provenance'})
 let firstSource=''
 for(const [index,text] of ['我把作品集链接发给导师了，导师还没回复。','接着作品集的事：导师后来回复说手机打不开作品集链接。','我把作品集PDF发给导师了，导师确认已经读到。'].entries()){
  const run=(await store.startRun(user,chat,randomUUID(),text)).run
  const growth=await stageGrowthUpdates(run,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:run.source_message_id,quote:text}}],[])
  await store.finishRun(run,{candidates:[],audit:[],growth},'各条报告分别保留。',null,new AbortController().signal)
  if(index===0){
   firstSource=run.source_message_id
   const content={title:'原作品集链接',summary:text,action:'我把作品集链接发给导师了',result:'导师还没回复'}
   await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',2)",[id,user,chat,run.source_message_id,text,run.request_id,content])
  }
 }
 const node=(await store.cognitionGraph(user)).nodes.find((n:any)=>n.serverId===id) as any
 assert.equal(node.taskOutcomes.read.status,'unknown')
 assert.equal(node.taskOutcomes.response.status,'reported_response')
 assert.match(node.taskOutcomes.response.quote,/打不开作品集链接/)
 assert.equal(node.experienceSummary.result,'导师还没回复','the dated historical result is not rewritten')
 assert.equal(node.asReported.sourceMessageId,firstSource)
 assert.ok(Date.parse(node.taskOutcomes.response.reportedAt)>=Date.parse(node.asReported.reportedAt))
})

test('result provenance cannot certify uncertainty substrings and checks later complete occurrences',async()=>{
 const user='result-scope-'+randomUUID(),chat=randomUUID()
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await store.createConversation(user,{id:chat,title:'SYNTHETIC complete result scope'})
 for(const [text,result,expected] of [
  ['我不确定导师是否已回复。','已回复','unverified_record'],
  ['不是导师已回复。','导师已回复','unverified_record'],
  ['“导师已回复”。导师已回复。','导师已回复','source_report'],
  ['我不确定导师是否已回复。','我不确定导师是否已回复','source_report'],
 ] as const){
  const run=(await store.startRun(user,chat,randomUUID(),text)).run,id=randomUUID()
  await store.terminateRun(user,run.request_id,'cancelled','RESULT_PROVENANCE_FIXTURE')
  await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',2)",[id,user,chat,run.source_message_id,text,run.request_id,{title:'原结果范围',summary:text,result}])
  const node=(await store.cognitionGraph(user)).nodes.find((n:any)=>n.serverId===id) as any
  assert.equal(node.resultBasis,expected,text)
  if(expected==='unverified_record')assert.equal(node.asReported,undefined)
  else assert.equal(node.asReported.result,result,'a full uncertainty statement preserves uncertainty rather than assert a response')
 }
})

test('forgotten or source-suppressed experience results never reappear in list or cognition',async()=>{
  const user='record-suppress-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC suppression'})
  const text='我把作品集链接发给导师了，导师还没回复',started=await store.startRun(user,chat,randomUUID(),text)
  await store.terminateRun(user,started.run.request_id,'cancelled','SUPPRESSION_FIXTURE')
  const id=randomUUID()
  await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',2)",[id,user,chat,started.run.source_message_id,text,started.run.request_id,{title:'作品集跟进',summary:text,action:'我把作品集链接发给导师了',result:'导师已回复'}])
  assert.equal((await store.listExperiences(user)).length,1)
  await pool.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4)',[user,chat,started.run.source_message_id,'导师已回复'])
  assert.equal((await store.listExperiences(user)).length,0,'a suppressed result quote hides the whole experience from the graph')
  assert.equal((await store.cognitionGraph(user)).nodes.some((node:any)=>node.serverId===id),false)
  await pool.query('DELETE FROM growth_source_suppressions WHERE user_id=$1',[user])
  await pool.query('INSERT INTO memory_suppressions(user_id,source_conversation_id,source_message_id,key) VALUES($1,$2,$3,$4)',[user,chat,started.run.source_message_id,'suppressed-message'])
  assert.equal((await store.listExperiences(user)).length,0,'a memory-suppressed source message hides the experience')
  assert.equal((await store.cognitionGraph(user)).nodes.some((node:any)=>node.serverId===id),false)
})

test('a command sentence is never certified as a user source report',async()=>{
  const user='record-command-source-'+randomUUID(),chat=randomUUID(),command='按上次已读状态分别说明。'
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC command source'})
  const started=await store.startRun(user,chat,randomUUID(),command)
  await store.terminateRun(user,started.run.request_id,'cancelled','COMMAND_SOURCE_FIXTURE')
  const id=randomUUID()
  await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',2)",[id,user,chat,started.run.source_message_id,command,started.run.request_id,{title:'状态请求',summary:command,action:command,result:command}])
  const node=(await store.cognitionGraph(user)).nodes.find((item:any)=>item.serverId===id) as any
  assert.equal(node.resultBasis,'unverified_record')
  assert.equal(node.asReported,undefined)
})
