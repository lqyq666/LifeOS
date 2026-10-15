import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test('verified-fact material waits for rendered content, ordinary prose still streams (isolated SDK/PG)',async()=>{
 await localEmbedding.start()
 const previous={url:model.baseUrl,key:config.apiKey},requests:any[]=[],frames:Record<string,unknown>[]=[]
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
   res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
  })
 })
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r))
 model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-isolated-only'
 const engine=createTurnEngine({capabilityVerified:()=>true}),user='observed-material-'+randomUUID(),chat=randomUUID()
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await store.createConversation(user,{id:chat,title:'Synthetic verified material'})
 async function run(text:string){
  frames.length=0;const run=(await store.startRun(user,chat,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]}
  const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:e=>frames.push(e)})
  return {run,staged,result}
 }
 try{
  const material=await run('我在课程小组里负责整理资料和排版，代码是队友做的。帮我写一段只包含本人贡献的作品描述，不要替我发送。')
  assert.equal(requests.length,1)
  assert.deepEqual(frames.filter(f=>f.type==='draft'),[],'no rendered material exists at model draft time')
  assert.ok(material.result.text.includes('我在课程小组里负责整理资料和排版'))
  assert.ok(!material.result.text.includes('精通软件开发'),'the model cannot replace evidence-selected material with free prose')
  const saved=await store.finishRun(material.run,material.staged,material.result.text,material.result.usage,new AbortController().signal)
  assert.ok(!(saved as any).event?.nodes?.some((n:any)=>n.content==='不要替我发送'))
  const ordinary=await run('想了解实习岗位，先看哪一项？')
  assert.equal(requests.length,2)
  assert.ok(frames.some(f=>f.type==='draft'&&String(f.text).includes('核对一项实际要求')),'ordinary useful content remains eligible')
  await store.finishRun(ordinary.run,ordinary.staged,ordinary.result.text,ordinary.result.usage,new AbortController().signal)
 }finally{
  fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()));model.baseUrl=previous.url;config.apiKey=previous.key
  await pool.query('DELETE FROM "user" WHERE id=$1',[user]);await localEmbedding.close();await pool.end()
 }
})
