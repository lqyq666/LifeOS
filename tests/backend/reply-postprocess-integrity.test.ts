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

test('material and plan postprocessors preserve content through the real engine and transaction (simulated provider)',async t=>{
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
    await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_FIXTURE_CLEANUP',finished_at=now() WHERE user_id=$1 AND status='running'",[user])
    const run=(await store.startRun(user,conversationId,randomUUID(),text)).run
    const staged:store.Staged={candidates:[],audit:[]}
    return {run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:(_event:Record<string,unknown>)=>{}}
  }
  try{
    await t.test('single-question material can exceed an arbitrary 160-character schema cap and persist intact',async()=>{
      const question='Could you describe the specific responsibilities, typical collaboration process, actual feedback channels (including the quoted prompt "what changed?"), preparation costs, and practical constraints in this opportunity, including what remains uncertain and how a student could first verify those details without assuming any guaranteed outcome?'
      const input=await prepare('帮我写一个英文问题，了解实习机会的具体任务和需要核对的条件，不要替我发送。')
      outputs.push((request:any)=>{return {reply:question,event:{target:{operation:'create',title:'实习问题',source:{messageId:input.run.source_message_id,quote:'帮我写一个英文问题'}},action:{operation:'create',draft:{fromReply:true}}}}})
      const result=await engine(input);assert.ok(requests.at(-1).response_format.json_schema.schema.properties.reply.maxLength>=question.length);assert.equal(result.text,question)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal((await store.listConversations(user)).find(c=>c.id===conversation)!.messages.at(-1)!.content,question)
    })
    await t.test('native plan keeps numeric explanatory bullets, uncertainty and bold text through final storage',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC full plan explanation'})
      const input=await prepare('这周还剩两小时，帮我安排课程作业，留一些余量。',chat)
      const reply='**先核对任务**\n\n- 先用30分钟看课程要求：这是了解任务范围，不代表已完成作业；能否兼顾仍未知。\n\n**再调整**\n具体截止日尚未核实，不把建议当作已采纳。\n\n原始文档有代码标记`- 0–30min：review`，这里只是引用，不代表已安排。'
      outputs.push({reply,growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'constraint',source:{clauseId:'c0'},timeEvidence:{kind:'calendar_week',which:'this',clauseId:'c0'}}],weeklyPlan:{target:{operation:'create'},availableMinutes:120,period:'this_week',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[{action:'看课程要求',minutes:30,directionScopes:[]}]}})
      const result=await engine(input);assert.ok(result.text.startsWith(reply+'\n\n'));assert.ok(result.text.includes('未安排：90分钟'))
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal((await store.listConversations(user)).find(c=>c.id===chat)!.messages.at(-1)!.content,result.text)
    })
    await t.test('an extra unverified resume body fails source validation instead of being silently removed',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC source-bound material explanation'})
      const input=await prepare('我在课程小组里负责整理资料和排版，代码是队友做的。我负责封面排版。帮我写一段只包含本人贡献的作品描述，不要替我发送。',chat)
      outputs.push((request:any)=>{const supplied=JSON.parse(request.messages.find((m:any)=>m.role==='user').content);return {reply:'只依据已核对的本人贡献。\n\n我独立完成了全部代码并获得稳定收入。',event:{target:{operation:'create',title:'作品描述',source:{messageId:input.run.source_message_id,quote:'帮我写一段只包含本人贡献的作品描述'}},action:{operation:'create',draft:{kind:'resume_portfolio',selectedFactIds:supplied.growthCatalogue.filter((x:any)=>x.text==='我在课程小组里负责整理资料和排版'||x.text==='我负责封面排版').map((x:any)=>x.catalogueId)}}}}})
      await assert.rejects(engine(input),{code:'MATERIAL_NARRATIVE_UNVERIFIED'})
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,input.run.request_id])).rows[0].n,0)
      await store.terminateRun(user,input.run.request_id,'failed','MATERIAL_NARRATIVE_UNVERIFIED')
    })
  }finally{
    model.baseUrl=previous.url;config.apiKey=previous.key
    fake.closeAllConnections();await new Promise<void>(resolve=>fake.close(()=>resolve()))
    // The isolated runner drops this entire synthetic database after the test.
    await localEmbedding.close()
    await pool.end()
  }
})


