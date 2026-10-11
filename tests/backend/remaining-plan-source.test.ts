import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {growthContext} from '../../server/growth.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test('real course failure regression: current plan rebinds wrong recurring-time index (isolated PG, one simulated response)',async()=>{
 await localEmbedding.start()
 const user='remaining-plan-'+randomUUID(),conversation=randomUUID(),previousURL=model.baseUrl,previousKey=config.apiKey
 let calls=0
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',x=>chunks.push(Buffer.from(x)));req.on('end',()=>{
  calls++;const payload=JSON.parse(Buffer.concat(chunks).toString()),ctx=JSON.parse(payload.messages[1].content)
  const output={reply:ctx.boundedReply.choices[0],weeklyPlan:{target:{operation:'create'},availableMinutes:120,period:'this_week',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[
   {action:'课程：核对当前必须完成的任务与截止，先处理其中最紧要的一项',minutes:60,directionScopes:[]},
   {action:'备考：沿用当前进度，尝试一个具体题目或步骤并记录受阻处',minutes:60,directionScopes:[]},
  ]}}
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
 }finally{
  model.baseUrl=previousURL;config.apiKey=previousKey;fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()))
 }
})
test.after(async()=>{await localEmbedding.close();await pool.end()})
