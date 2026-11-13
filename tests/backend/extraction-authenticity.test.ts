import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {setMemorySettings,loadSnapshot} from '../../server/memory.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {growthContext} from '../../server/growth.ts'
import {readStarMapContext} from '../../server/user-themes.ts'

test('production turn path preserves independent episodes, negative reply, cross-chat context and versioned correction/forget (simulated provider)',async()=>{
 const outputs:unknown[]=[],requests:any[]=[],old={url:model.baseUrl,key:config.apiKey}
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',x=>chunks.push(Buffer.from(x)));req.on('end',()=>{requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));const out=outputs.shift() as {reply:string};const allowed=requests.at(-1)?.response_format?.json_schema?.schema?.properties?.reply?.enum;if(allowed?.length)out.reply=allowed[0];res.writeHead(200,{'Content-Type':'text/event-stream'});const base={id:'synthetic-authenticity-'+requests.length,object:'chat.completion.chunk',created:1,model:model.id};res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:JSON.stringify(out)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')})})
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-authenticity'
 const user='authenticity-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0});await store.createConversation(user,{id:chat,title:'SYNTHETIC source fidelity'})
  const engine=createTurnEngine({capabilityVerified:()=>true})
  const execute=async(text:string,reply:string,conversation=chat,extra:Record<string,unknown>={})=>{
   const before=requests.length;outputs.push({reply,...extra});const {run}=await store.startRun(user,conversation,randomUUID(),text),staged:store.Staged={candidates:[],audit:[]}
   const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit(){}})
   await store.finishRun(run,staged,result.text,result.usage,signal)
   assert.equal(requests.length,before+1,'one existing main call, no extraction call or retry');return run
  }
  await execute('我考虑过考研，但最后决定先就业。','你最后决定先就业；过去考虑考研的经历保留为背景。',chat,{growthUpdates:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c0'}}]})
  assert.equal((await growthContext(user,chat)).find(row=>row.text==='我考虑过考研')?.kind,'context')
  assert.ok(!(await readStarMapContext(pool,user))?.themes.some(theme=>theme.title==='考研'))
  const text='我昨天交了社团海报。上周我还参加过英语角，感觉更敢开口了。'
  const run=await execute(text,'这两件事的具体经过分别保留；一次海报制作和英语角经历不足以推断稳定能力。')
  let records=await store.listExperiences(user,chat);assert.equal(records.length,2)
  assert.ok(records.some(r=>r.content.summary.includes('英语角')&&r.source_quote.includes('更敢开口')))
  assert.equal((await pool.query('SELECT content FROM messages WHERE user_id=$1 AND id=$2',[user,run.source_message_id])).rows[0].content,text)
  const third=(await store.startRun(user,chat,randomUUID(),'同学说他交了课程作业。')).run
  await assert.rejects(store.stageCandidate(third,{candidates:[],audit:[]},{sourceMessageId:third.source_message_id,quote:'同学说他交了课程作业',links:[],content:{action:'同学说他交了课程作业',result:'',occurredAt:''}}),(error:any)=>error.code==='EXPERIENCE_SOURCE_NOT_OWNED')
  await store.terminateRun(user,third.request_id,'cancelled','SYNTHETIC_SOURCE_REJECTION')
  const attempt=await execute('我尝试联系了学长，但对方没有回复。','联系的尝试已经发生，对方目前没有回复；不能写成沟通成功。')
  records=await store.listExperiences(user,chat);const contact=records.find(r=>r.source_message_id===attempt.source_message_id)!
  assert.ok(contact);assert.equal(contact.content.result,'但对方没有回复')
  const fresh=randomUUID();await store.createConversation(user,{id:fresh,title:'SYNTHETIC cross-chat'})
  await execute('只根据已有记录分析，不修改档案。','已保存的原话记载了一次联系尝试，对方没有回复，结果仍不能推断。',fresh)
  assert.ok(JSON.stringify(requests.at(-1).messages).includes('但对方没有回复'))
  await store.experienceAction(user,contact.id,{requestId:randomUUID(),expectedRevision:contact.revision,action:'correct',content:{action:'本人更正：联系的是课程助教。',result:'助教还未回复。',summary:'本人更正：联系的是课程助教，助教还未回复。'}})
  const noResponse=(await store.cognitionGraph(user)).nodes.find((n:any)=>n.id==='exp-'+contact.id) as any
  assert.equal(noResponse.taskOutcomes.response.status,'reported_no_response')
  assert.ok(!noResponse.experienceSummary.unknowns.includes('是否回应'))
  const recall='只依据现在有效的已保存记录，说明我上周联系的是谁、对方是否回复，并结合我本人明确的实习目标和表达意愿分析下一步可以核对什么。不要创建或修改档案、经历、计划或任务。'
  const reply='你上周联系的是课程助教，助教还未回复；是否读过及未回复原因仍未知。'
  const beforeRecall=(await growthContext(user,fresh)).map(row=>({id:row.id,revision:row.revision}))
  const recalled=await execute(recall,reply,fresh)
  assert.ok(!requests.at(-1)?.response_format?.json_schema?.schema?.properties?.reply?.enum,'factual recall must not use a fixed pre-contact response: '+JSON.stringify(requests.at(-1)?.response_format?.json_schema?.schema?.properties?.reply?.enum))
  assert.equal((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,recalled.request_id])).rows[0].content,reply)
  assert.deepEqual((await growthContext(user,fresh)).map(row=>({id:row.id,revision:row.revision})),beforeRecall,'the recall instruction is not a new personal fact')
  const experiencesBefore=(await store.listExperiences(user)).map(row=>({id:row.id,revision:row.revision}))
  await execute('我昨天完成了另一份练习。不要新增或修改档案、经历、长期记忆。','你报告昨天完成了另一份练习；本轮不保存个人记录。',fresh,{growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}]})
  assert.deepEqual((await growthContext(user,fresh)).map(row=>({id:row.id,revision:row.revision})),beforeRecall,'compound refusal suppresses model and deterministic profile writes')
  assert.deepEqual((await store.listExperiences(user)).map(row=>({id:row.id,revision:row.revision})),experiencesBefore)
  const correctedContact=(await store.listExperiences(user,chat)).find(r=>r.id===contact.id)!
  await store.experienceAction(user,contact.id,{requestId:randomUUID(),expectedRevision:correctedContact.revision,action:'correct',content:{action:'本人更正：联系的是助教。',result:'更正：联系的是助教，助教已明确回复。',summary:'本人更正：联系的是助教，助教已明确回复。'}})
  const corrected=await loadSnapshot(user,fresh,'联系助教')
  assert.ok(corrected.confirmedExperiences.some(r=>r.id===contact.id&&JSON.stringify(r.content).includes('助教已明确回复')))
  assert.ok(!JSON.stringify(corrected.confirmedExperiences.find(r=>r.id===contact.id)?.content).includes('但对方没有回复'))
  const replied=(await store.cognitionGraph(user)).nodes.find((n:any)=>n.id==='exp-'+contact.id) as any
  assert.equal(replied.taskOutcomes.response.status,'reported_response')
  assert.ok(!replied.experienceSummary.unknowns.includes('是否回应'))
  const current=(await store.listExperiences(user,chat)).find(r=>r.id===contact.id)!
  await store.experienceAction(user,contact.id,{requestId:randomUUID(),expectedRevision:current.revision,action:'delete'})
  assert.ok(!(await loadSnapshot(user,fresh,'联系')).confirmedExperiences.some(r=>r.id===contact.id))
 }finally{model.baseUrl=old.url;config.apiKey=old.key;fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()));await localEmbedding.close();await pool.end()}
})
