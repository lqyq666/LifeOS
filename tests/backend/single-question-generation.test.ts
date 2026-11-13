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
import {productModeOpeningPrompt} from '../../src/features/conversation/product-modes.ts'

function propertySchemas(node:any,name:string):any[]{
 if(!node||typeof node!=='object')return []
 return [...(node.properties?.[name]?[node.properties[name]]:[]),...Object.values(node).flatMap(value=>value&&typeof value==='object'?(Array.isArray(value)?value.flatMap(x=>propertySchemas(x,name)):propertySchemas(value,name)):[])]
}

test('single-question rules reach the actual native generation payload without changing source or saved prose (simulated provider)',async t=>{
  await localEmbedding.start()
  const previous={url:model.baseUrl,key:config.apiKey},requests:any[]=[],outputs:unknown[]=[]
  let afterSyntheticFrame:(()=>void)|undefined
  const fake=createServer((req,res)=>{
    const chunks:Buffer[]=[]
    req.on('data',chunk=>chunks.push(Buffer.from(chunk)))
    req.on('end',()=>{
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const system=requests.at(-1).messages.find((m:any)=>m.role==='system').content
      assert.ok(system.includes('亲自参与不等于独立完成'))
      assert.ok(system.includes('可用时间、已花时间、剩余时间分别核对'))
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
    for(const text of [
      '帮我写一个英文问题，用于了解AI产品实习的工作、协作、反馈和投入，约70—100词，不替我发送。',
      '请为了解AI产品相关实习机会起草一个60—90词的英文问题，涵盖任务、协作、反馈与投入，并把“What evidence do you need?”作为引用例子保留，不补造个人事实。',
    ])await t.test('pure question owns its reply field and receives scoped generation instructions: '+text.slice(0,12),async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC single-question generation'})
      const input=await prepare(text,chat),reply='Could you outline the actual responsibilities of this internship, including collaboration, feedback, preparation costs and requirements that remain unconfirmed, so that I can understand what evidence would help assess the opportunity?'
      outputs.push((request:any)=>({reply,event:{target:{operation:'create',title:'实习问题',source:{messageId:input.run.source_message_id,quote:text.split('，')[0]}},action:{operation:'create',draft:{fromReply:true}}}}))
      const result=await engine(input),request=requests.at(-1),schema=request.response_format.json_schema.schema,system=request.messages.find((m:any)=>m.role==='system').content
      assert.equal(schema.properties.lead,undefined)
      assert.match(schema.properties.reply.description,/单个完整问句/)
      assert.match(schema.properties.reply.description,text.includes('70—100')?/本轮要求70—100词.*约85词/:/本轮要求60—90词.*约75词/)
      assert.equal(schema.properties.reply.allOf,undefined)
      if(text.includes('What evidence'))assert.ok(schema.properties.reply.pattern.includes('What evidence do you need\\?'))
      else assert.ok(schema.properties.reply.pattern.includes('{69,99}'))
      assert.match(system,/本轮单问题生成契约/)
      assert.ok(!JSON.stringify(request.messages).includes(reply),'a fresh draft must not be primed with the exact previous AI body')
      assert.ok(JSON.stringify(request.messages).includes('旧AI正文未选入本轮'),'the scope rule reaches the actual native request')
      assert.match(system,/不输出.*Notes/)
      assert.ok(!system.includes('多层内容用简短小标题、分段与分点'))
      const drafts=propertySchemas(schema.properties.event,'draft')
      assert.ok(drafts.length>0&&drafts.every((x:any)=>x.properties.fromReply?.const===true),'one authoritative body, never a second content field')
      assert.equal(result.text,reply,'the generated reply is not cut, rewritten or replaced')
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal((await store.listConversations(user)).find(c=>c.id===chat)!.messages.at(-1)!.content,reply)
    })
    await t.test('an explicit readback plus one drafted question keeps both requested deliverables',async()=>{
      const text='上次我的本人贡献和本周时间分别是什么？未知要求不要替我补。再帮我拟一个向学长核对岗位要求的问题，不替我判断适合。',input=await prepare(text)
      const question='你了解这个岗位实际需要完成的任务和相应要求吗？',reply='当前读取范围没有可核对的本人贡献与本周时间，先保留未知。'
      outputs.push({reply,event:{target:{operation:'create',title:'核对岗位要求',source:{messageId:input.run.source_message_id,quote:'再帮我拟一个向学长核对岗位要求的问题'}},action:{operation:'create',draft:{content:question}}}})
      const result=await engine(input),request=requests.at(-1),schema=request.response_format.json_schema.schema,system=request.messages.find((m:any)=>m.role==='system').content
      assert.match(system,/本轮单问题生成契约/)
      assert.match(system,/明确请求的读回/)
      assert.ok(propertySchemas(schema.properties.event,'draft').some((draft:any)=>propertySchemas(draft,'content').some((body:any)=>body.description.includes('单个完整问句'))))
      assert.equal(result.text,reply+'\n\n'+question)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('ordinary single-question dialogue gets the generation rule without an editorial lead',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC dialogue question'})
      const input=await prepare('请只问我一个问题，了解我在课程任务中如何安排开始专注的时间，不安排任务。',chat),reply='你在课程任务里通常如何安排开始专注的时间？'
      outputs.push({reply});const frames:any[]=[];const result=await engine({...input,emit:frame=>frames.push(frame)}),request=requests.at(-1)
      assert.match(request.messages.find((m:any)=>m.role==='system').content,/本轮单问题生成契约/)
      assert.equal(request.response_format.json_schema.schema.properties.lead,undefined)
      assert.equal(request.response_format.json_schema.schema.properties.reply.pattern,'^[^?？\\r\\n]*[?？]$')
      assert.equal(result.text,reply)
      assert.ok(frames.some(frame=>frame.type==='draft'&&frame.draftKind==='stream_reply'))
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('a comparison plus one question retains the separately requested structured comparison',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC comparison and one question'})
      const input=await prepare('请比较自学和组队两种准备方式，各说理由。请先问一个问题，了解我现在最缺什么。只分析，不修改档案。',chat)
      const reply='方式一：自学。可以自行安排，遇到困难时需要寻找反馈。\n\n方式二：组队。可以交换看法，但需要协调时间。\n\n你现在最缺少哪类支持？'
      outputs.push({reply});const result=await engine(input),request=requests.at(-1)
      assert.notEqual(request.response_format.json_schema.schema.properties.reply.pattern,'^[^?？\\r\\n]*[?？]$')
      assert.equal(result.text,reply)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('understanding opening keeps the sourced readback and limits only its follow-up during generation',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC understanding opening'})
      const input=await prepare(productModeOpeningPrompt('understand'),chat)
      const reply='**当前了解**\n\n当前读取范围还没有足够的个人经历依据。\n\n**先从一件事聊起**\n\n你最近做过哪件自己愿意聊聊的事？'
      outputs.push({reply});const count=requests.length,result=await engine(input),request=requests.at(-1)
      const last=request.messages.at(-1).content
      assert.ok(last.includes('不默认展开六维画像'))
      assert.ok(last.includes('事实和未知部分使用陈述句'))
      assert.ok(last.includes('不把回复压缩为仅一个问句'))
      assert.ok(!last.includes('本轮是已有记录的六维回读'))
      assert.ok(request.messages.find((m:any)=>m.role==='system').content.includes('未知部分全部写成陈述句'))
      assert.ok(request.response_format.json_schema.schema.properties.reply.description.includes('整段reply只在末尾出现一个开放问句和一个问号'))
      const openingPattern=new RegExp(request.response_format.json_schema.schema.properties.reply.pattern)
      assert.ok(openingPattern.test(reply))
      assert.ok(!openingPattern.test('任务是什么？\n\n独立做了哪些部分？'))
      assert.notEqual(request.response_format.json_schema.schema.properties.reply.pattern,'^[^?？\\r\\n]*[?？]$')
      assert.equal(requests.length,count+1)
      assert.equal(result.text,reply,'the whole structured reply survives unchanged')
      assert.equal(input.staged.candidates.length,0)
      assert.ok(!input.staged.growth?.prepared.length)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal((await store.listConversations(user)).find(c=>c.id===chat)!.messages.at(-1)!.content,reply)
    })
    await t.test('explicitly requested multiple questions are not forced into the single-question contract',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC multiple question material'})
      const text='帮我写三个用于了解AI实习实际工作的问题，不代替我发送。',input=await prepare(text,chat),reply='1. 实习生实际负责哪些任务？\n2. 团队通常怎样合作？\n3. 工作反馈如何提供？'
      outputs.push({reply,event:{target:{operation:'create',title:'实习问题',source:{messageId:input.run.source_message_id,quote:'帮我写三个用于了解AI实习实际工作的问题'}},action:{operation:'create',draft:{fromReply:true}}}})
      const result=await engine(input),request=requests.at(-1)
      assert.ok(!request.messages.find((m:any)=>m.role==='system').content.includes('本轮单问题生成契约'))
      assert.equal(result.text,reply)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('a model ignoring the generation instruction is never made to pass by editing its output',async()=>{
      const captured="Here is a draft question for you to review.\n\n**Draft Question (60-90 words):**\n\"I am interested in learning more about the day-to-day realities of this AI product internship. Could you share what specific tasks an intern would handle, how collaboration typically works within the team, and what kind of feedback interns receive? I also want to understand the expected time commitment and any conditions that are still being finalized. If you were evaluating candidates, what evidence do you need? This will help me assess if my background aligns with your expectations.\"\n\n**Notes:**\n*   The phrase \"What evidence do you need?\" is included as requested.\n*   This text is a template for you to use; it does not represent your personal experience or actions.\n*   You can adjust the tone or details before sending it yourself."
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC unchanged noncompliant output'})
      const input=await prepare('帮我写一个英文实习问题，不代替我发送。',chat)
      outputs.push({reply:captured,event:{target:{operation:'create',title:'实习问题',source:{messageId:input.run.source_message_id,quote:'帮我写一个英文实习问题'}},action:{operation:'create',draft:{fromReply:true}}}})
      const result=await engine(input)
      assert.equal(result.text,captured,'bad style remains visible for evaluation; no clipping, rewriting or extra model repair')
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal((await store.listConversations(user)).find(c=>c.id===chat)!.messages.at(-1)!.content,captured)
    })
  }finally{
    model.baseUrl=previous.url;config.apiKey=previous.key
    fake.closeAllConnections();await new Promise<void>(resolve=>fake.close(()=>resolve()))
    // The isolated runner drops this entire synthetic database after the test.
    await localEmbedding.close()
    await pool.end()
  }
})


