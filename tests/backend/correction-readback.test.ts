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
import {setMemorySettings} from '../../server/memory.ts'

test('a persisted manual correction can be read back verbatim without being treated as a new write (isolated PG, simulated provider)',async()=>{
 await localEmbedding.start()
 const previous={url:model.baseUrl,key:config.apiKey},requests:any[]=[],outputs:string[]=[]
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  const reply=outputs.shift();if(!reply){res.writeHead(500);res.end();return}
  res.writeHead(200,{'Content-Type':'text/event-stream'});const base={id:'correction-readback-'+requests.length,object:'chat.completion.chunk',created:1,model:model.id}
  res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:JSON.stringify({reply})},finish_reason:null}]})+'\n\n')
  res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-correction-readback'
 const user='correction-recall-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal
 const engine=createTurnEngine({capabilityVerified:()=>true}),prepare=async(text:string)=>{const run=(await store.startRun(user,chat,randomUUID(),text)).run;return {run,staged:{candidates:[],audit:[]} as store.Staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}}}
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid']);await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0});await store.createConversation(user,{id:chat,title:'更正读回回归'})
  const action='我核对了三份课程报告的引用出处',seed=await prepare(action+'，用课程检查表标出两处遗漏，老师还没有评价。')
  await store.stageCandidate(seed.run,seed.staged,{sourceMessageId:seed.run.source_message_id,quote:action,links:[],content:{action,result:'老师还没有评价',occurredAt:''}});await store.finishRun(seed.run,seed.staged,'已报告引用核对经历。',null,signal)
  const original=(await store.listExperiences(user,chat))[0]
  await store.experienceAction(user,original.id,{requestId:randomUUID(),expectedRevision:original.revision,action:'correct',content:{summary:original.content.summary,action:'我核对了两份课程报告的引用出处，用课程检查表标出了两处遗漏'}})
  const before=await store.listExperiences(user,chat)
  for(const text of ['请核对我最近报告并已更正过的课程引用经历：当前记录到底核对了几份，使用了什么工具？哪些可以确认，哪些还不能推断？只分析，不修改档案、不创建任务或经历，也不用额外追问。','请读回我更正后的记录。']){
   const input=await prepare(text),reply=text.startsWith('请核对')?'**当前记录**\n\n数量已更正为两份，使用课程检查表标出两处遗漏。\n\n**未知**\n\n老师尚未评价；不能据此认定稳定科研能力。':'已有更正记录：核对的是两份课程报告，借助课程检查表发现两处遗漏。老师是否认可仍未知。'
   outputs.push(reply);const count=requests.length,result=await engine(input)
   assert.equal(requests.length,count+1);assert.equal(result.text,reply,'no reply clipping or rewriting')
   assert.ok(JSON.stringify(requests.at(-1).messages).includes('两份课程报告'));assert.ok(!JSON.stringify(requests.at(-1).messages).includes('三份课程报告'))
   assert.ok(!input.staged.growth?.prepared.length);assert.equal(input.staged.candidates.length,0)
   await store.finishRun(input.run,input.staged,result.text,result.usage,signal)
   assert.deepEqual(await store.listExperiences(user,chat),before,'readback leaves the versioned corrected records intact')
  }
  const input=await prepare('更正一下：我现在更喜欢做产品运营了。');outputs.push('已经把你的方向更正为产品运营了。')
  await assert.rejects(engine(input),(e:any)=>e.code==='REPLY_CLAIMS_UNCOMMITTED_CORRECTION','a new uncommitted claim is still rejected')
 }finally{model.baseUrl=previous.url;config.apiKey=previous.key;fake.closeAllConnections();await new Promise<void>(resolve=>fake.close(()=>resolve()));await localEmbedding.close();await pool.end()}
})
