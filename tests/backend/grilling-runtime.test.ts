import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {mainCompanionPolicy} from '../../server/companion-policy.ts'

test('normal LifeOS transaction sends and commits the current grilling policy and mode',async()=>{
  const originalEncode=localEmbedding.encode.bind(localEmbedding)
  localEmbedding.encode=async(texts:string[])=>texts.map(()=>Array(512).fill(0))
  const requests:any[]=[]
  const fake=createServer((req,res)=>{
    const chunks:Buffer[]=[]
    req.on('data',chunk=>chunks.push(Buffer.from(chunk)))
    req.on('end',()=>{
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const base={id:'grilling-runtime',object:'chat.completion.chunk',created:1,model:model.id}
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify({reply:'你自己想读研，最想得到的结果是什么？'})},finish_reason:null}]})+'\n\n')
      res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:20,total_tokens:140,prompt_tokens_details:{cached_tokens:0}}})+'\n\ndata: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve))
  const previousURL=model.baseUrl,previousKey=config.apiKey
  model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port
  config.apiKey='synthetic-grilling-runtime-key'
  const user='grilling-runtime-'+randomUUID(),conversation=randomUUID()
  try{
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
    await store.createConversation(user,{id:conversation,title:'SYNTHETIC grilling runtime'})
    const run=(await store.startRun(user,conversation,randomUUID(),'我不确定考研是不是只是因为大家都在考，想清楚。')).run
    const staged:store.Staged={candidates:[],audit:[]}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error(`runtime timeout after ${requests.length} provider requests`)),15_000)
    const result=await createTurnEngine({capabilityVerified:()=>true})({run,staged,context:await store.contextForRun(run),decision:null,signal:controller.signal,emit:()=>{}}).finally(()=>clearTimeout(timer))
    assert.equal(result.text,'你自己想读研，最想得到的结果是什么？')
    const system=String(requests[0].messages[0].content)
    assert.ok(system.includes(mainCompanionPolicy.grilling.instructions),'actual provider payload includes the current grilling policy text')
    const context=JSON.parse(requests[0].messages.find((message:any)=>message.role==='user').content)
    assert.deepEqual(context.grilling,{policyVersion:mainCompanionPolicy.grilling.version,policyDigest:mainCompanionPolicy.grilling.policyDigest,interactionMode:'explore'})
    const payload=staged.audit.find((row:any)=>row.phase==='grilling_policy_payload') as any
    assert.equal(payload.policyDigest,mainCompanionPolicy.grilling.policyDigest)
    assert.ok(staged.audit.some((row:any)=>row.phase==='model_call_completed'&&row.callId===payload.callId))
    await store.finishRun(run,staged,result.text,result.usage,new AbortController().signal)
    const committed=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,run.request_id])).rows[0].tool_audit as any[]
    assert.ok(committed.some(row=>row.phase==='grilling_policy_payload'&&row.policyDigest===mainCompanionPolicy.grilling.policyDigest&&row.callId===payload.callId))
    assert.ok(committed.some(row=>row.phase==='grilling_interaction_mode'&&row.mode==='explore'&&row.policyDigest===mainCompanionPolicy.grilling.policyDigest))
  }finally{
    model.baseUrl=previousURL
    config.apiKey=previousKey
    localEmbedding.encode=originalEncode
    await new Promise<void>(resolve=>fake.close(()=>resolve()))
  }
})
