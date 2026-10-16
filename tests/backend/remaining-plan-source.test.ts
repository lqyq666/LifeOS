import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {pool,transaction} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {growthContext} from '../../server/growth.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {readRecommendationControls,listControlRequests,resolveControlRequest,persistMemoryControl} from '../../server/memory-controls.ts'

test('real course failure regression: current plan rebinds wrong recurring-time index (isolated PG, one simulated response)',async()=>{
 await localEmbedding.start()
 const user='remaining-plan-'+randomUUID(),conversation=randomUUID(),previousURL=model.baseUrl,previousKey=config.apiKey
 let calls=0
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',x=>chunks.push(Buffer.from(x)));req.on('end',()=>{
  calls++;const payload=JSON.parse(Buffer.concat(chunks).toString()),ctx=JSON.parse(payload.messages[1].content)
  const minuteCase=JSON.stringify(ctx).includes('六十分钟'),minutes=minuteCase?60:120,ref=minuteCase?{id:'ffffffff-ffff-4fff-8fff-ffffffffffff',revision:1}:{updateIndex:0}
  const output={reply:ctx.boundedReply.choices[0],weeklyPlan:{target:{operation:'create'},availableMinutes:minutes,period:'this_week',budgetRef:ref,basis:[ref],items:[
   {action:'课程：核对当前必须完成的任务与截止，先处理其中最紧要的一项',minutes:minutes/2,directionScopes:[]},
   {action:'备考：沿用当前进度，尝试一个具体题目或步骤并记录受阻处',minutes:minutes/2,directionScopes:[]},
  ]}}
  if(calls===3){
   const clauses=ctx.currentUserMessage.clauses as {id:string;text:string}[]
   Object.assign(output,{growthUpdates:[clauses.find(c=>c.text.includes('每周通常'))!,clauses.find(c=>c.text.includes('六十分钟'))!].map(c=>({target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:c.id}}))})
   Object.assign(output.weeklyPlan,{budgetRef:{updateIndex:1},basis:[{updateIndex:2}]})
  }
  const base={id:'synthetic-remaining-source',object:'chat.completion.chunk',created:1,model:model.id}
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:JSON.stringify(output)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r))
 try{
  model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-local-only'
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:conversation,title:'SYNTHETIC current plan'})
  const run=(await store.startRun(user,conversation,randomUUID(),'我每周能拿出六小时，但这周只剩两小时，请帮我安排本周课程与备考。')).run
  const input={run,staged:{candidates:[],audit:[]} as store.Staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:()=>{}}
  const result=await createTurnEngine({capabilityVerified:()=>true})(input)
  const saved=await store.finishRun(run,input.staged,result.text,result.usage,input.signal)
  assert.equal(calls,1,'repair source binding without another generation')
  const items=await growthContext(user,conversation),plan=items.find(item=>item.id===saved.stateChange.plan?.itemId)!
  const structured=plan.structuredPlan as {availableMinutes:number;budgetRef:{id:string};items:{minutes:number}[]}
  assert.equal(structured.availableMinutes,120);assert.equal(structured.items.reduce((n,x)=>n+x.minutes,0),120)
  assert.ok(items.find(item=>item.id===structured.budgetRef.id)!.text.includes('这周只剩两小时'))
  assert.ok(items.some(item=>item.kind==='context'&&item.text.includes('每周能拿出六小时')))
  const secondChat=randomUUID();await store.createConversation(user,{id:secondChat,title:'SYNTHETIC invalid provider reference'})
  const run2=(await store.startRun(user,secondChat,randomUUID(),'每周通常能投入六小时，这周还剩六十分钟，帮我安排课程作业与考试复习。')).run
  const input2={run:run2,staged:{candidates:[],audit:[]} as store.Staged,context:await store.contextForRun(run2),decision:null,signal:new AbortController().signal,emit:()=>{}}
  const result2=await createTurnEngine({capabilityVerified:()=>true})(input2),saved2=await store.finishRun(run2,input2.staged,result2.text,result2.usage,input2.signal)
  const items2=await growthContext(user,secondChat),plan2=items2.find(item=>item.id===saved2.stateChange.plan?.itemId)!.structuredPlan! as {availableMinutes:number;budgetRef:{id:string}}
  assert.equal(plan2.availableMinutes,60);assert.ok(items2.find(i=>i.id===plan2.budgetRef.id)!.text.includes('六十分钟'));assert.equal(calls,2)
  const user3='saved-budget-'+randomUUID(),chat3=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user3,user3+'@example.invalid'])
  await setMemorySettings(user3,{requestId:randomUUID(),enabled:true,expectedRevision:0});await store.createConversation(user3,{id:chat3,title:'SYNTHETIC existing staged budget'})
  const run3=(await store.startRun(user3,chat3,randomUUID(),'我是成年人，目前在大学读书，每周通常能投入六小时，这周还剩六十分钟。帮我安排课程作业与考试复习。')).run
  const input3={run:run3,staged:{candidates:[],audit:[]} as store.Staged,context:await store.contextForRun(run3),decision:null,signal:new AbortController().signal,emit:()=>{}}
  const result3=await createTurnEngine({capabilityVerified:()=>true})(input3),saved3=await store.finishRun(run3,input3.staged,result3.text,result3.usage,input3.signal)
  const items3=await growthContext(user3,chat3),plan3=items3.find(i=>i.id===saved3.stateChange.plan?.itemId)!.structuredPlan! as {availableMinutes:number;budgetRef:{id:string};basis:{id:string}[]}
  assert.equal(plan3.availableMinutes,60);assert.ok(items3.find(i=>i.id===plan3.budgetRef.id)!.text.includes('六十分钟'))
  assert.deepEqual(plan3.basis,[plan3.budgetRef],'an unresolved auxiliary array position binds only the verified current budget, without inventing another fact')
  assert.equal(calls,3,'the binding repair needs no additional generation')
 }finally{
  model.baseUrl=previousURL;config.apiKey=previousKey;fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()))
 }
})
test('real V18 boundaries persist verbatim across sessions and refusal cannot replace the earlier goal',async()=>{
 const user='course-boundary-'+randomUUID(),previousURL=model.baseUrl,previousKey=config.apiKey
 let calls=0
 const observedContexts:Record<string,any>[]=[]
 let malicious=false
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',x=>chunks.push(Buffer.from(x)));req.on('end',()=>{
  calls++;const payload=JSON.parse(Buffer.concat(chunks).toString()),ctx=JSON.parse(payload.messages[1].content)
  observedContexts.push(ctx)
  const goalClause=ctx.clauses?.find((x:{text:string})=>x.text==='我想完成课程作业')
  const output={reply:ctx.boundedReply?.choices[0]??'先保留你刚说的目标。',...(goalClause?{growthUpdates:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:goalClause.id}}]}:{})}
  if(malicious)Object.assign(output,{weeklyPlan:{target:{operation:'create'},availableMinutes:20,period:'this_week',budgetRef:{id:ctx.growthRecommendationBoundaries[0]?.id,revision:1},basis:[],items:[{action:'继续已拒绝的作业',minutes:20,directionScopes:[]}]}})
  const base={id:'synthetic-course-boundary',object:'chat.completion.chunk',created:1,model:model.id}
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:JSON.stringify(output)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r))
 try{
  model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-local-only'
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  const chats=[randomUUID(),randomUUID(),randomUUID()];for(const id of chats)await store.createConversation(user,{id,title:'SYNTHETIC course boundary'})
  async function turn(chat:string,text:string){
   const run=(await store.startRun(user,chat,randomUUID(),text)).run
   const input={run,staged:{candidates:[],audit:[]} as store.Staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:()=>{}}
   const result=await createTurnEngine({capabilityVerified:()=>true})(input);const saved=await store.finishRun(run,input.staged,result.text,result.usage,input.signal);return {result,input,saved}
  }
  await turn(chats[0]!,'我想完成课程作业。')
  await turn(chats[0]!,'上次排的课程作业，我已经列好题目了，但第三题不会做。')
  await turn(chats[1]!,'这周剩半小时，先不备考。')
  await turn(chats[2]!,'这事先不想继续，别给我安排。')
  const rows=(await pool.query('SELECT id,kind,text,status,revision FROM growth_items WHERE user_id=$1',[user])).rows
  assert.ok(rows.some(x=>x.text==='但第三题不会做'&&x.kind==='context'))
  assert.ok(rows.some(x=>x.text==='先不备考'&&x.kind==='constraint'))
  const refusal=rows.find(x=>x.text==='这事先不想继续')!
  assert.equal(refusal,undefined,'pure refusal must not become a background fact or a new goal')
  assert.ok(rows.some(x=>x.kind==='goal'&&x.text==='我想完成课程作业'),JSON.stringify(rows))
  assert.equal(calls,3,'pure refusal performs zero generation without deleting facts')
  const goal=rows.find(x=>x.kind==='goal'&&x.text==='我想完成课程作业')!
  const pending=(await listControlRequests(user)).find(x=>x.kind==='stop_recommend')!
  assert.ok(pending.candidates.some(x=>x.itemId===goal.id),'ambiguity names the actual preserved goal, not merely the refusal row')
  await turn(chats[2]!,'先听我说吧。')
  assert.ok(observedContexts.at(-1)!.growthRecommendationBoundaries.some((x:any)=>x.id===goal.id&&x.recommendationBoundary==='pending_target_confirmation'))
  assert.ok(![...observedContexts.at(-1)!.growth,...observedContexts.at(-1)!.growthBackground].some((x:any)=>x.id===goal.id),'pending target is removed from recommendation inputs, with facts separately retained')
  assert.equal(observedContexts.at(-1)!.taskBoundaries[0].targetText,'备考','unresolved scope is explicit despite exclusion from recommendation growth')
  const guardedPlan=await turn(chats[2]!,'这周剩二十分钟，帮我安排课程作业。')
  assert.ok(guardedPlan.result.text.includes('确认卡'))
  assert.equal(guardedPlan.saved.stateChange.plan??null,null,'pending control cannot be bypassed by a plan request')
  assert.ok(guardedPlan.input.staged.audit.some((x:any)=>x.phase==='task_boundary_clarification_required'&&x.deferredPlanRequest))
  const guardedMaterial=await turn(chats[2]!,'帮我直接写一份简历。')
  assert.ok(guardedMaterial.result.text.includes('确认卡'))
  assert.equal(guardedMaterial.input.staged.weeklyPlan,undefined)
  const boundary=(await growthContext(user,chats[2]!)).find(x=>x.text==='先不备考')!.taskBoundary!
  assert.equal(boundary.scope,'current_matter');assert.equal(boundary.targetText,'备考');assert.ok(boundary.expiresAt);assert.equal(boundary.matterBinding,'needs_same_matter_confirmation')
  const controlSource=(await pool.query('SELECT source_message_id FROM growth_control_requests WHERE user_id=$1 AND id=$2',[user,pending.id])).rows[0]
  const sourceRun={user_id:user,conversation_id:chats[2]!,request_id:pending.requestId,source_message_id:controlSource.source_message_id} as store.Run
  await assert.rejects(()=>transaction(c=>persistMemoryControl(c,sourceRun,{kind:'stop_recommend',itemId:goal.id,expectedRevision:goal.revision+1,clauseText:pending.clauseText})),(e:any)=>e.code==='GROWTH_REVISION_CONFLICT')
  await assert.rejects(()=>transaction(c=>persistMemoryControl(c,sourceRun,{kind:'stop_recommend',itemId:goal.id,expectedRevision:goal.revision,clauseText:'invented instruction'})),(e:any)=>e.code==='GROWTH_SOURCE_INVALID')
  const confirmationId=randomUUID()
  const resolved=await resolveControlRequest(user,pending.id,{requestId:confirmationId,action:'confirm',itemId:goal.id})
  assert.equal(resolved.result?.itemId,goal.id)
  assert.equal((await resolveControlRequest(user,pending.id,{requestId:confirmationId,action:'confirm',itemId:goal.id})).result?.replayed,true)
  await assert.rejects(()=>resolveControlRequest(user,pending.id,{requestId:confirmationId,action:'cancel'}),(e:any)=>e.code==='CONTROL_CONFIRMATION_IDEMPOTENCY_CONFLICT')
  assert.ok((await readRecommendationControls(user)).some(x=>x.itemId===goal.id))
  assert.equal((await pool.query('SELECT source_quote FROM growth_recommendation_controls WHERE user_id=$1 AND item_id=$2',[user,goal.id])).rows[0].source_quote,'这事先不想继续')
  assert.ok((await growthContext(user,chats[2]!)).some(x=>x.id===goal.id&&x.text==='我想完成课程作业'&&x.recommendationStopped))
  const unknownExam=await turn(chats[2]!,'这周剩二十分钟，帮我安排备考。')
  assert.ok(unknownExam.result.text.includes('是否同一事项'))
  assert.equal(unknownExam.saved.stateChange.plan??null,null,'similar exam request does not silently bind the old scoped pause')
  malicious=true
  const rejected=(await store.startRun(user,chats[2]!,randomUUID(),'这周剩二十分钟，帮我安排备考。')).run
  try{
   const badInput={run:rejected,staged:{candidates:[],audit:[]} as store.Staged,context:await store.contextForRun(rejected),decision:null,signal:new AbortController().signal,emit:()=>{}}
   await assert.rejects(()=>createTurnEngine({capabilityVerified:()=>true})(badInput),(e:any)=>e.code==='COACH_OUTPUT_INVALID'||e.code==='RECOMMENDATION_CONTROL_NOT_APPLIED')
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1 AND kind='plan'",[user])).rows[0].n,0,'malicious model output never commits a forbidden plan')
  }finally{await store.terminateRun(user,rejected.request_id,'failed','SYNTHETIC_FORBIDDEN_PLAN_RETAINED')}
 }finally{model.baseUrl=previousURL;config.apiKey=previousKey;fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()))}
})

test.after(async()=>{await localEmbedding.close();await pool.end()})
