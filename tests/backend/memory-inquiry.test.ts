import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {coachEventView} from '../../server/action-coach-events.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test('distinct event constraints stay with their original raw sources and never become stable background (simulated provider)',async()=>{
  const user='memory-inquiry-'+randomUUID(),conversation=randomUUID(),bodies:any[]=[]
  const responses:any[]=[]
  const server=createServer((request,response)=>{
    const chunks:Buffer[]=[]
    request.on('data',(chunk:Buffer|string)=>chunks.push(Buffer.from(chunk)))
    request.on('end',()=>{
      bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const result=responses.shift()
      if(!result){response.writeHead(500);response.end();return}
      const text=JSON.stringify(result),base={id:'inquiry-probe-'+bodies.length,object:'chat.completion.chunk',created:1,model:model.id}
      response.writeHead(200,{'Content-Type':'text/event-stream'})
      response.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})+'\n\n')
      response.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
    })
  })
  const oldURL=model.baseUrl,oldKey=config.apiKey
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  model.baseUrl='http://127.0.0.1:'+(server.address() as {port:number}).port
  config.apiKey='synthetic-inquiry-isolation-key'
  const engine=createTurnEngine({capabilityVerified:()=>true})
  const resultFor=(run:store.Run,text:string,goal:string)=>{
    return {reply:'记录本次事件，准备工作以这次的条件为准。',event:{target:{operation:'create',title:goal,source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]}}
  }
  try{
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',[user,'记忆隔离回归',user+'@example.invalid'])
    await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
    await store.createConversation(user,{id:conversation,title:'同一任务类型的新问题'})
    const firstText='我想准备志愿咨询，每周最多四小时，帮助同学整理资料。'
    const firstRun=(await store.startRun(user,conversation,randomUUID(),firstText)).run
    const firstContext=await store.contextForRun(firstRun)
    responses.push(resultFor(firstRun,firstText,'准备志愿咨询'))
    const firstStaged:store.Staged={candidates:[],audit:[]},firstSignal=new AbortController().signal
    const firstReply=await engine({run:firstRun,staged:firstStaged,context:firstContext,decision:null,signal:firstSignal,emit:()=>{}})
    await store.finishRun(firstRun,firstStaged,firstReply.text,firstReply.usage,firstSignal)
    const firstEvent=(await coachEventView(user,conversation))!
    assert.equal(firstEvent.nodes[0].content,firstText)

    const secondText='这是另一个问题：我想尝试社团宣传，每周最多一小时，请切换方向，不沿用之前的时间安排。'
    const secondRun=(await store.startRun(user,conversation,randomUUID(),secondText)).run
    const secondContext=await store.contextForRun(secondRun)
    responses.push(resultFor(secondRun,secondText,'尝试社团宣传'))
    const secondStaged:store.Staged={candidates:[],audit:[]},secondSignal=new AbortController().signal
    const secondReply=await engine({run:secondRun,staged:secondStaged,context:secondContext,decision:null,signal:secondSignal,emit:()=>{}})
    const secondPrompt=JSON.parse(bodies.at(-1).messages.find((message:any)=>message.role==='user').content)
    assert.equal(secondPrompt.currentEvent.id,firstEvent.id,'history is available with its event identity, not silently converted into new conditions')
    assert.equal(secondPrompt.knownProfile.length,0)
    await store.finishRun(secondRun,secondStaged,secondReply.text,secondReply.usage,secondSignal)

    const secondEvent=(await coachEventView(user,conversation))!
    assert.notEqual(secondEvent.id,firstEvent.id)
    assert.equal(secondEvent.nodes[0].content,secondText)
    assert.ok(!secondEvent.nodes.some(node=>node.content.includes('四小时')))
    assert.equal((await coachEventView(user,conversation,firstEvent.id))!.nodes[0].content,firstText)
    assert.equal((await pool.query('SELECT 1 FROM memory_items WHERE user_id=$1',[user])).rowCount,0)
    assert.equal((await pool.query('SELECT 1 FROM campus_inquiries WHERE user_id=$1',[user])).rowCount,0)
  }finally{
    await localEmbedding.close()
    model.baseUrl=oldURL
    config.apiKey=oldKey
    server.closeAllConnections()
    await new Promise<void>(resolve=>server.close(()=>resolve()))
    await pool.query('DELETE FROM "user" WHERE id=$1',[user]).catch(()=>{})
    await pool.end()
  }
})
