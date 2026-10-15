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

test('verified material and streamed failures respect real HTTP/SDK/PG delivery boundaries',async()=>{
 await localEmbedding.start()
 const previous={url:model.baseUrl,key:config.apiKey,origin:config.origin,access:config.entitlementsEnabled},requests:any[]=[]
 const fake=createServer((req,res)=>{
  const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
   const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body)
   const schema=body.response_format.json_schema.schema,selection=schema.properties.event?.properties.action?.anyOf[0]?.properties.draft?.anyOf[0]?.properties.selectedFactIds
   let output:any={reply:'先围绕你想了解的岗位，核对一项实际要求。'}
   if(selection){
    const messageId=schema.properties.event.properties.target.anyOf[0].properties.source.properties.messageId.enum[0]
    output={reply:'已根据你提供的信息撰写了作品描述。\n\n【作品描述】\n我精通软件开发。',event:{target:{operation:'create',title:'本人贡献作品描述',source:{messageId,quote:'帮我写一段只包含本人贡献的作品描述'}},nodes:[{kind:'fact',source:{messageId,quote:'不要替我发送'}}],action:{operation:'create',draft:{kind:'resume_portfolio',selectedFactIds:[selection.items.enum[0]]}}}}
   }
   res.writeHead(200,{'Content-Type':'text/event-stream'})
   const base={id:'synthetic-verified-material',object:'chat.completion.chunk',created:1,model:model.id}
   res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
   if(requests.length===3){res.end('data: '+JSON.stringify({error:{code:'invalid_json_schema',message:'400 schema generation failed; synthetic-private-payload'}})+'\n\n');return}
   res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
  })
 })
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r))
 model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-isolated-only';config.entitlementsEnabled=false
 const app=createApp(createTurnEngine({capabilityVerified:()=>true}));await new Promise<void>(r=>app.listen(0,'127.0.0.1',r))
 const origin='http://127.0.0.1:'+(app.address() as {port:number}).port;config.origin=origin
 let user='',cookie='';const chat=randomUUID()
 const request=(path:string,body?:unknown)=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
 async function run(text:string){
  const id=randomUUID(),response=await request('/api/conversations/'+chat+'/messages',{requestId:id,text});assert.equal(response.status,200)
  const frames=(await response.text()).split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)))
  const saved=await(await request('/api/runs/'+id)).json();return {frames,saved}
 }
 try{
  const signup=await request('/api/auth/sign-up/email',{name:'Synthetic material delivery',email:'delivery-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID()});assert.equal(signup.status,200)
  user=(await signup.json()).user.id;cookie=signup.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
  assert.equal((await request('/api/conversations',{id:chat,title:'Synthetic verified material'})).status,201)
  const material=await run('我在课程小组里负责整理资料和排版，代码是队友做的。帮我写一段只包含本人贡献的作品描述，不要替我发送。')
  assert.equal(requests.length,1)
  assert.deepEqual(material.frames.filter(f=>f.type==='draft'),[])
  const deltas=material.frames.filter(f=>f.type==='delta');assert.equal(deltas.length,1);assert.equal(deltas[0].saved,true);assert.equal(deltas[0].replace,true)
  assert.equal(deltas[0].text.split('我在课程小组里负责整理资料和排版').length-1,1)
  assert.ok(!deltas[0].text.includes('精通软件开发'))
  assert.equal(material.saved.status,'completed');assert.ok(material.saved.response.event)
  assert.ok(!material.saved.response.event.nodes.some((n:any)=>n.content==='不要替我发送'))
  assert.equal(material.saved.response.event.actions[0].draft.content,'我在课程小组里负责整理资料和排版。')
  const ordinary=await run('想了解实习岗位，先看哪一项？')
  assert.equal(requests.length,2);assert.ok(ordinary.frames.some(f=>f.type==='draft'&&f.text.includes('核对一项实际要求')));assert.equal(ordinary.saved.status,'completed')
  const failure=await run('现在先聊聊实习方向，可以先看什么？')
  assert.equal(requests.length,3,'stream failure never triggers a second call')
  assert.ok(failure.frames.some(f=>f.type==='draft_discarded'))
  assert.equal(failure.frames.find(f=>f.type==='error')?.code,'MODEL_REQUEST_FAILED')
  assert.ok(!failure.frames.some(f=>f.type==='done'||f.type==='delta'))
  assert.equal(failure.saved.status,'failed');assert.equal(failure.saved.response,null)
  assert.ok(!JSON.stringify(failure.frames).includes('synthetic-private-payload'))
 }finally{
  app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()))
  if(user)await pool.query('DELETE FROM "user" WHERE id=$1',[user]);model.baseUrl=previous.url;config.apiKey=previous.key;config.origin=previous.origin;config.entitlementsEnabled=previous.access;await localEmbedding.close();await pool.end()
 }
})
