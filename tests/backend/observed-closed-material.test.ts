import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {createTurnEngine} from '../../server/agent.ts'
import {createApp} from '../../server/http.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test('a closed historical draft remains readable but cannot be selected for modification',{timeout:30000},async()=>{
 await localEmbedding.start()
 const previous={url:model.baseUrl,key:config.apiKey,origin:config.origin,access:config.entitlementsEnabled},requests:any[]=[]
 let current:any,closedId=''
 const fake=createServer((req,res)=>{
  const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
   const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body)
   const context=JSON.parse(body.messages.find((m:any)=>m.role==='user').content),messageId=context.currentUserMessage.id
   let event:any,reply='原因仍未知，保留原请教目的。'
  if(requests.length===1){reply='';event={target:{operation:'create',title:'向学长请教实习方向',source:{messageId,quote:'帮我写一句向学长请教实习方向的消息'}},action:{operation:'create',draft:{content:'学长你好，想请教你当时如何了解实习方向，方便聊几句吗？'}}}}
   else if(requests.length===2)event={target:{operation:'continue',eventId:current.id,expectedRevision:current.revision},action:{operation:'create',draft:{content:'学长好，想了解你当时怎样选择实习方向，方便时聊几句吗？'}}}
   else{
    const schema=body.response_format.json_schema.schema,modify=schema.properties.event.properties.action.anyOf.find((b:any)=>b.properties.operation.const==='modify')
    const available=modify.properties.actionId.enum
    // Reproduce the actual error whenever the native contract still offers
    // the closed original. The model makes one call, never a repair call.
    const selected=available.includes(closedId)?current.actions.find((a:any)=>a.id===closedId):current.actions.find((a:any)=>a.status==='proposed')
    event={target:{operation:'continue',eventId:current.id,expectedRevision:current.revision},nodes:[{kind:'fact',source:{messageId,quote:'我通过校内邮箱发了消息'}},{kind:'fact',source:{messageId,quote:'他还没有回复'}}],action:{operation:'modify',actionId:selected.id,expectedRevision:selected.revision,draft:{content:'学长好，想请教实习方向，方便时聊几句吗？'}}}
   }
   res.writeHead(200,{'Content-Type':'text/event-stream'})
   const chunk={id:'synthetic-action-boundary',object:'chat.completion.chunk',created:1,model:model.id}
   res.end('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{content:JSON.stringify({reply,event})},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
  })
 })
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-isolated-only';config.entitlementsEnabled=false
 const app=createApp(createTurnEngine({capabilityVerified:()=>true}));await new Promise<void>(r=>app.listen(0,'127.0.0.1',r))
 const origin='http://127.0.0.1:'+(app.address() as {port:number}).port;config.origin=origin;let cookie='';const chat=randomUUID()
 const request=(path:string,body?:unknown)=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)})
 async function run(text:string){const id=randomUUID(),response=await request('/api/conversations/'+chat+'/messages',{requestId:id,text});assert.equal(response.status,200);const frames=(await response.text()).split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));const saved=await(await request('/api/runs/'+id)).json();return {frames,saved}}
 try{
  const signup=await request('/api/auth/sign-up/email',{name:'Synthetic action boundary',email:'action-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID()});assert.equal(signup.status,200);cookie=signup.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
  assert.equal((await request('/api/conversations',{id:chat,title:'Synthetic closed action'})).status,201)
  const first=await run('帮我写一句向学长请教实习方向的消息，不要替我发送。');assert.equal(first.saved.status,'completed');current=first.saved.response.event;closedId=current.actions[0].id
  const second=await run('接着刚才请教学长的事，帮我另外起草一条更自然的消息，不替我发。');assert.equal(second.saved.status,'completed');current=second.saved.response.event
  assert.equal(current.actions.find((a:any)=>a.id===closedId).status,'closed')
  const original=structuredClone(current.actions.find((a:any)=>a.id===closedId))
  const third=await run('我通过校内邮箱发了消息，他还没有回复，把原请教消息改短，别猜原因，不替我发送。')
  assert.equal(third.saved.status,'completed','valid feedback and rewrite must not select a closed material')
  assert.equal(requests.length,3)
  const actions=third.saved.response.event.actions
  assert.deepEqual(actions.find((a:any)=>a.id===closedId),original,'closed history remains intact')
  assert.equal(actions.find((a:any)=>a.status==='proposed').draft.content,'学长好，想请教实习方向，方便时聊几句吗？')
  assert.ok(third.saved.response.event.nodes.some((n:any)=>n.content==='他还没有回复'))
 }finally{
  app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()));model.baseUrl=previous.url;config.apiKey=previous.key;config.origin=previous.origin;config.entitlementsEnabled=previous.access;await localEmbedding.close();await pool.end()
 }
})
