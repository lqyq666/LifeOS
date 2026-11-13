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
import {stageCoachEvent} from '../../server/action-coach-events.ts'

test('complete generated prose survives streaming and persistence without editorial postprocessing (simulated provider)',async t=>{
  await localEmbedding.start()
  const previous={url:model.baseUrl,key:config.apiKey},requests:any[]=[],outputs:unknown[]=[]
  let afterSyntheticFrame:(()=>void)|undefined
  const fake=createServer((req,res)=>{
    const chunks:Buffer[]=[]
    req.on('data',chunk=>chunks.push(Buffer.from(chunk)))
    req.on('end',()=>{
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const queued=outputs.shift()
      const output=typeof queued==='function'?queued(requests.at(-1)):queued
      if(output===undefined){res.writeHead(500);res.end();return}
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      const base={id:'ordinary-synthetic-'+requests.length,object:'chat.completion.chunk',created:1,model:model.id}
      if(output&&typeof output==='object'&&('syntheticRepeatedFrame'in output||'syntheticHeldFrame'in output)){
        const repeated='syntheticRepeatedFrame'in output
        const frame=JSON.stringify((output as any)[repeated?'syntheticRepeatedFrame':'syntheticHeldFrame'])
        res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:frame+(repeated?'\n```\n'+frame.repeat(3):'')},finish_reason:null}]})+'\n\n')
        afterSyntheticFrame?.()
        const timer=setTimeout(()=>res.end((repeated?'data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\n':'')+'data: [DONE]\n\n'),repeated?250:5000)
        res.on('close',()=>clearTimeout(timer))
        return
      }
      res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
      res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve))
  model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port
  config.apiKey='synthetic-ordinary-key'
  // Even an old diagnostic caller cannot turn failure into a second paid call.
  const engine=createTurnEngine({capabilityVerified:()=>true,providerCallObserver:{allowRepair:true,before(){},after(){}}})
  const user='ordinary-'+randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  const conversation=randomUUID()
  await store.createConversation(user,{id:conversation,title:'SYNTHETIC ordinary composition'})
  async function prepare(text:string,conversationId=conversation){
    const run=(await store.startRun(user,conversationId,randomUUID(),text)).run
    const staged:store.Staged={candidates:[],audit:[]}
    return {run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:(_event:Record<string,unknown>)=>{}}
  }
  try{
    for(const [label,text,reply] of [
      ['implicit decision question','怎么决定保研还是工作','**保研**\n具体课题是什么？门槛仍需核实。\n\n**工作**\n实际岗位做什么？工作环境仍未知。\n\n为了判断投入，最值得先核对的是：\n**你目前更想了解哪类岗位或课题？**'],
      ['multiple analytical questions','保研和就业各有哪些未知？','**个人依据**\n先从具体活动了解，不凭一次经历定性。\n\n**待核对**\n你想做什么？哪些投入可以接受？什么反馈会改变判断？'],
      ['literal open ending','请帮我分析未来方向，不修改档案。','**当前理解**\n几条道路都值得探索，条件仍未知。\n\n下一步可以先核对：'],
      ['complete missing-information note','怎么决定保研还是工作','先看一个感兴趣岗位的职责和任职要求，到点就停。\n\n【待补】你尚未说明自己的专业和感兴趣的具体方向，以上步骤不依赖这些信息也能执行；若你愿意补充，下次可以帮你把搜索词收得更准。'],
    ])await t.test(label,async()=>{
      const id=randomUUID();await store.createConversation(user,{id,title:'SYNTHETIC completeness '+label})
      const seed=await prepare('我正在了解保研和就业。',id)
      seed.staged.coach=await stageCoachEvent(seed.run,{target:{operation:'create',title:'方向探索',source:{messageId:seed.run.source_message_id,quote:'我正在了解保研和就业。'}},nodes:[{kind:'fact',source:{messageId:seed.run.source_message_id,quote:'我正在了解保研和就业。'}}]},'先了解具体条件。')
      await store.finishRun(seed.run,seed.staged,'先了解具体条件。',null,seed.signal)
      const input=await prepare(text,id),frames:Record<string,unknown>[]=[];outputs.push({reply})
      const before=requests.length,result=await engine({...input,emit:frame=>{frames.push(frame)}})
      assert.equal(requests.length-before,1)
      assert.equal(result.text,reply,'no sentence, question or dangling-tail deletion')
      assert.ok(frames.some(frame=>frame.type==='draft'&&frame.draftKind==='stream_reply'&&frame.saved===false))
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      const saved=await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,input.run.request_id])
      assert.equal(saved.rows.length,1);assert.equal(saved.rows[0].content,reply)
      assert.ok(!input.staged.audit.some((row:any)=>/question_bounded|dangling_reply_closed|reviewed_defects_repaired/.test(row.phase)))
    })
  }finally{
    model.baseUrl=previous.url;config.apiKey=previous.key
    fake.closeAllConnections();await new Promise<void>(resolve=>fake.close(()=>resolve()))
    // The isolated runner drops this entire synthetic database after the test.
    await localEmbedding.close()
    await pool.end()
  }
})


