import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test.after(async()=>{await pool.end()})
async function verifyDefinition(path:string,expected:string){
 const fixture=JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'))
 const actor='definition-replay-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal
 const previous={url:model.baseUrl,key:config.apiKey,budget:config.providerBudgetEnabled,encode:localEmbedding.encode}
 localEmbedding.encode=async texts=>texts.map(()=>Array(512).fill(0));config.providerBudgetEnabled=false
 let sourceId='',calls=0,completionSent=false,draftBeforeCompletion=false
 const frames:any[]=[]
 const fake=createServer((req,res)=>{req.on('data',()=>{});req.on('end',()=>{
  calls++
  const raw=fixture.raw.replaceAll(fixture.sourceMessageId,sourceId),split=raw.indexOf(',"event"')
  assert.ok(split>0)
  const envelope={id:'synthetic-definition-replay',object:'chat.completion.chunk',created:1,model:model.id}
  const frame=(text:string)=>'data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{content:text},finish_reason:null}]})+'\n\n'
  res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.write(frame(raw.slice(0,split)))
  setTimeout(()=>{
   completionSent=true;res.write(frame(raw.slice(split)))
   res.end('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n')
  },150)
 })})
 await new Promise<void>(done=>fake.listen(0,'127.0.0.1',done))
 model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-definition-only'
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
  await store.createConversation(actor,{id:chat,title:'SYNTHETIC definition source boundary'})
  const run=(await store.startRun(actor,chat,randomUUID(),fixture.user)).run;sourceId=run.source_message_id
  const staged:store.Staged={candidates:[],audit:[]}
  const result=await createTurnEngine({capabilityVerified:()=>true})({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:frame=>{frames.push(frame);if(frame.type==='draft'&&!completionSent)draftBeforeCompletion=true}})
  const committed=await store.finishRun(run,staged,result.text,result.usage,signal)
  assert.equal(calls,1)
  assert.equal(result.text,expected)
  const unknowns=committed.event!.nodes.filter(node=>node.kind==='unknown')
  assert.equal(unknowns.length,1)
  assert.equal(unknowns[0]!.content,expected)
  assert.ok(draftBeforeCompletion,JSON.stringify({frames,audit:staged.audit.filter((item:any)=>/preview|draft/.test(item.phase))}))
 }finally{
  fake.closeAllConnections();await new Promise<void>(done=>fake.close(()=>done()))
  model.baseUrl=previous.url;config.apiKey=previous.key;config.providerBudgetEnabled=previous.budget;localEmbedding.encode=previous.encode
  await localEmbedding.close()
 }
}
test('the captured quoted definition streams safely and stores the same authorized unknown',()=>verifyDefinition('../fixtures/final81-freedom-question.json','你说的“更自由的生活”具体指什么？'))
test('the captured unquoted definition preserves its owned concept before completion and at commit',()=>verifyDefinition('../fixtures/final82-freedom-question.json','你说的“自由”具体指什么？'))
