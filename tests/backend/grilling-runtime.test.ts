import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {mainCompanionPolicy} from '../../server/companion-policy.ts'
import {stageCoachEvent} from '../../server/action-coach-events.ts'

test('normal LifeOS transaction sends and commits the current grilling policy and mode',async()=>{
  const originalEncode=localEmbedding.encode.bind(localEmbedding)
  localEmbedding.encode=async(texts:string[])=>texts.map(()=>Array(512).fill(0))
  const requests:any[]=[],outputs:any[]=[{reply:'你考虑考研时，最想获得的是“更多准备时间”，还是“一个具体方向”？'}]
  const fake=createServer((req,res)=>{
    const chunks:Buffer[]=[]
    req.on('data',chunk=>chunks.push(Buffer.from(chunk)))
    req.on('end',()=>{
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const base={id:'grilling-runtime',object:'chat.completion.chunk',created:1,model:model.id}
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(outputs.shift())},finish_reason:null}]})+'\n\n')
      res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:20,total_tokens:140,prompt_tokens_details:{cached_tokens:0}}})+'\n\ndata: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve))
  const previousURL=model.baseUrl,previousKey=config.apiKey
  model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port
  config.apiKey='synthetic-grilling-runtime-key'
  const user='grilling-runtime-'+randomUUID(),conversation=randomUUID()
  try{
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
    await store.createConversation(user,{id:conversation,title:'SYNTHETIC grilling runtime'})
    const run=(await store.startRun(user,conversation,randomUUID(),'我不确定考研是不是只是因为大家都在考，想清楚。')).run
    const staged:store.Staged={candidates:[],audit:[]}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error(`runtime timeout after ${requests.length} provider requests`)),15_000)
    const result=await createTurnEngine({capabilityVerified:()=>true})({run,staged,context:await store.contextForRun(run),decision:null,signal:controller.signal,emit:()=>{}}).finally(()=>clearTimeout(timer))
    assert.equal(result.text,'你考虑考研时，最想获得的具体情况是什么？')
    assert.ok(staged.audit.some((row:any)=>row.phase==='grilling_loaded_choices_opened'))
    const system=String(requests[0].messages[0].content)
    assert.ok(system.includes(mainCompanionPolicy.grilling.instructions),'actual provider payload includes the current grilling policy text')
    const context=JSON.parse(requests[0].messages.find((message:any)=>message.role==='user').content)
    assert.deepEqual(context.grilling,{policyVersion:mainCompanionPolicy.grilling.version,policyDigest:mainCompanionPolicy.grilling.policyDigest,interactionMode:'explore'})
    const payload=staged.audit.find((row:any)=>row.phase==='grilling_policy_payload') as any
    assert.equal(payload.policyDigest,mainCompanionPolicy.grilling.policyDigest)
    assert.ok(staged.audit.some((row:any)=>row.phase==='model_call_completed'&&row.callId===payload.callId))
    await store.finishRun(run,staged,result.text,result.usage,new AbortController().signal)
    const committed=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,run.request_id])).rows[0].tool_audit as any[]
    assert.ok(committed.some(row=>row.phase==='grilling_policy_payload'&&row.policyDigest===mainCompanionPolicy.grilling.policyDigest&&row.callId===payload.callId))
    assert.ok(committed.some(row=>row.phase==='grilling_interaction_mode'&&row.mode==='explore'&&row.policyDigest===mainCompanionPolicy.grilling.policyDigest))

    const seedText='我之前想先写一份求职材料。',seed=(await store.startRun(user,conversation,randomUUID(),seedText)).run
    const source={messageId:seed.source_message_id,quote:seedText}
    const seeded=await stageCoachEvent(seed,{target:{operation:'create',title:'求职材料',source},nodes:[{kind:'fact',source}],action:{operation:'create',draft:{content:'原材料'}}},'原材料')
    const savedSeed=await store.finishRun(seed,{candidates:[],audit:[],coach:seeded},seeded.reply,null,new AbortController().signal)
    const event=savedSeed.event!,action=event.actions[0]!
    const follow=(await store.startRun(user,conversation,randomUUID(),'我还没想清楚这份材料对应什么方向，先理清选择。')).run,followStaged:store.Staged={candidates:[],audit:[]}
    outputs.push({reply:'你希望这份材料最终帮你获得什么机会？',event:{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,draft:action.draft}}})
    const followResult=await createTurnEngine({capabilityVerified:()=>true})({run:follow,staged:followStaged,context:await store.contextForRun(follow),decision:null,signal:new AbortController().signal,emit:()=>{}})
    assert.equal(followResult.text,'你希望这份材料最终帮你获得什么机会？')
    assert.equal(followStaged.coach,undefined,'an inherited byte-identical material action does not block an otherwise useful ordinary reply')
    assert.ok(followStaged.audit.some((row:any)=>row.phase==='unchanged_unrequested_material_dropped'))
    await store.finishRun(follow,followStaged,followResult.text,followResult.usage,new AbortController().signal)

    const inquirySeed=(await store.startRun(user,conversation,randomUUID(),'整理课程资料让我觉得有秩序。')).run
    const inquiryStaged=await stageCoachEvent(inquirySeed,{target:{operation:'create',title:'秩序感来源',source:{messageId:inquirySeed.source_message_id,quote:'整理课程资料让我觉得有秩序'}},nodes:[{kind:'unknown',question:'整理资料时具体是哪一步让你觉得有秩序？',affects:'判断值得继续观察的过程',reason:'答案会改变下一步'}]},'整理资料时，具体是哪一步让你觉得有秩序？')
    const inquiryEvent=(await store.finishRun(inquirySeed,{candidates:[],audit:[],coach:inquiryStaged},inquiryStaged.reply,null,new AbortController().signal)).event!
    const activeUnknown=inquiryEvent.nodes.find(node=>node.kind==='unknown')!
    const answerText='我喜欢先把混乱材料按规则归类。现在长期记忆已开启。请只给一个动作，这个动作要说明验证什么、看到什么算有进展、何时停止。不要再让我复述经历。'
    const answer=(await store.startRun(user,conversation,randomUUID(),answerText)).run,answerStaged:store.Staged={candidates:[],audit:[]}
    outputs.push({reply:'已更新：你更投入规则归类。',event:{target:{operation:'continue',eventId:inquiryEvent.id,expectedRevision:inquiryEvent.revision},nodes:[
      {kind:'fact',source:{messageId:answer.source_message_id,quote:'这个动作要说明验证什么'}},
      {kind:'fact',source:{messageId:answer.source_message_id,quote:'看到什么算有进展'}},
      {kind:'fact',source:{messageId:answer.source_message_id,quote:'何时停止'}},
      {kind:'fact',source:{messageId:answer.source_message_id,quote:'现在长期记忆已开启'}},
    ]}})
    const answerResult=await createTurnEngine({capabilityVerified:()=>true})({run:answer,staged:answerStaged,context:await store.contextForRun(answer),decision:null,signal:new AbortController().signal,emit:()=>{}})
    assert.deepEqual(answerStaged.coach?.delta.resolveUnknowns,[activeUnknown.id],'an immediate grounded answer closes the one active question even if the model omits the state transition')
    assert.deepEqual(answerStaged.coach?.delta.nodes,[],'action-format instructions and product state never become event facts')
    const answeredEvent=(await store.finishRun(answer,answerStaged,answerResult.text,answerResult.usage,new AbortController().signal)).event!
    assert.equal(answeredEvent.nodes.find(node=>node.id===activeUnknown.id)?.status,'resolved')
    for(const instruction of ['这个动作要说明验证什么','看到什么算有进展','何时停止'])assert.ok(!answeredEvent.nodes.some(node=>node.content===instruction))
    assert.ok(!answeredEvent.nodes.some(node=>node.content==='现在长期记忆已开启'))
  }finally{
    model.baseUrl=previousURL
    config.apiKey=previousKey
    localEmbedding.encode=originalEncode
    await new Promise<void>(resolve=>fake.close(()=>resolve()))
  }
})
