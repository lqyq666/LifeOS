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

test('the observed sent-message correction creates one current fact, not a duplicate',{timeout:30000},async()=>{
 await localEmbedding.start()
 const previous={url:model.baseUrl,key:config.apiKey,origin:config.origin,access:config.entitlementsEnabled}
 let calls=0,originalNodeId=''
 const fake=createServer((req,res)=>{
  const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
   const body=JSON.parse(Buffer.concat(chunks).toString()),context=JSON.parse(body.messages.find((m:any)=>m.role==='user').content)
   const messageId=context.currentUserMessage.id;calls++
   const quote=calls===1?'还没联系过':'我通过校内邮箱发了消息'
   const source={messageId,quote}
   let event:any={target:{operation:'create',title:'请教学长实习方向',source},nodes:[{kind:'fact',source}]}
   if(calls===2){
    const current=context.currentEvent
    assert.ok(current)
    const node=current.nodes.find((node:any)=>node.content==='还没联系过');assert.ok(node);originalNodeId=node.id
    event={target:{operation:'continue',eventId:current.id,expectedRevision:current.revision},nodes:[{kind:'fact',source}],corrections:[{nodeId:node.id,source}]}
   }
   const output={reply:calls===1?'具体想了解的实习方向尚未提供。':'截至这次报告，消息已发出，尚未回复。',event}
   res.writeHead(200,{'Content-Type':'text/event-stream'})
   const base={id:'synthetic-observed-correction',object:'chat.completion.chunk',created:1,model:model.id}
   res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
   res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
  })
 })
 await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve))
 model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-isolated-only';config.entitlementsEnabled=false
 const app=createApp(createTurnEngine({capabilityVerified:()=>true}));await new Promise<void>(resolve=>app.listen(0,'127.0.0.1',resolve))
 const origin='http://127.0.0.1:'+(app.address() as {port:number}).port;config.origin=origin
 let cookie='';const conversation=randomUUID()
 const request=(path:string,body?:unknown)=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)})
 try{
  const signup=await request('/api/auth/sign-up/email',{name:'Synthetic observed correction',email:'correction-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID()});assert.equal(signup.status,200)
  cookie=signup.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
  assert.equal((await request('/api/conversations',{id:conversation,title:'请教学长实习方向'})).status,201)
  for(const text of ['我想向学长请教实习方向，还没联系过。先看什么？','我通过校内邮箱发了消息，他还没回复。我想继续了解实习方向。']){
   const requestId=randomUUID(),response=await request('/api/conversations/'+conversation+'/messages',{requestId,text});assert.equal(response.status,200);await response.text()
   const run=await(await request('/api/runs/'+requestId)).json();assert.equal(run.status,'completed',JSON.stringify(run.error))
   if(calls===2){
    const facts=run.response.event.nodes.filter((node:any)=>node.content==='我通过校内邮箱发了消息')
    assert.equal(facts.length,1);assert.equal(facts[0].id,originalNodeId);assert.equal(facts[0].revision,2)
   }
  }
  assert.equal(calls,2,'no repair model or retry')
 }finally{
  app.closeAllConnections();await new Promise<void>(resolve=>app.close(()=>resolve()));fake.closeAllConnections();await new Promise<void>(resolve=>fake.close(()=>resolve()))
  model.baseUrl=previous.url;config.apiKey=previous.key;config.origin=previous.origin;config.entitlementsEnabled=previous.access;await localEmbedding.close();await pool.end()
 }
})
