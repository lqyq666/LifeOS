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

test('verified material and streamed failures respect real HTTP/SDK/PG delivery boundaries',{timeout:30000},async()=>{
 await localEmbedding.start()
 const previous={url:model.baseUrl,key:config.apiKey,origin:config.origin,access:config.entitlementsEnabled},requests:any[]=[]
 let materialEvent:any
 const fake=createServer((req,res)=>{
  const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
   const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body)
   const schema=body.response_format.json_schema.schema,selection=schema.properties.event?.properties.action?.anyOf[0]?.properties.draft?.anyOf?.[0]?.properties.selectedFactIds
   let output:any={reply:'先围绕你想了解的岗位，核对一项实际要求。'}
   if(requests.length===7)output={reply:'先问一个具体对象：你整理排版的那份课程资料，有没有被小组外的人看过或用过？'}
   if(selection){
    assert.ok(selection.maxItems<=new Set(selection.items.enum).size,'one catalogue fact must not expand into repeated generated selections')
    const messageId=schema.properties.event.properties.target.anyOf[0].properties.source.properties.messageId.enum[0]
    output={reply:'已根据你提供的信息撰写了作品描述。\n\n【作品描述】\n我精通软件开发。',event:{target:{operation:'create',title:'本人贡献作品描述',source:{messageId,quote:requests.length===1?'只帮我写一段本人贡献描述':'帮我写一段只包含本人贡献的作品描述'}},nodes:[{kind:'fact',source:{messageId,quote:'不要替我发送'}}],action:{operation:'create',draft:{kind:'resume_portfolio',selectedFactIds:[selection.items.enum[0]]}}}}
   }
   if(requests.length===10&&selection){
    const context=JSON.parse(body.messages.find((m:any)=>m.role==='user').content)
    const events=[context.currentEvent,...context.events??[]].filter(Boolean)
    assert.ok(events.length)
    for(const event of events){assert.equal(event.processTurns,undefined);assert.ok(event.actions.every((action:any)=>!('draft'in action)))}
   }
   const messageId=JSON.parse(body.messages.find((m:any)=>m.role==='user').content).currentUserMessage.id
   if(requests.length===2)output={reply:'比较岗位时，先找出两个岗位日常工作上的一项实际差异。核对表里哪一项最难区分？',event:{target:{operation:'continue',eventId:materialEvent.id,expectedRevision:materialEvent.revision},nodes:[{kind:'fact',source:{messageId,quote:'我填过岗位核对表但卡住了'}}],action:{operation:'reuse',actionId:materialEvent.actions[0].id,expectedRevision:materialEvent.actions[0].revision}}}
   if(requests.length===4){assert.ok(schema.required.includes('event'));assert.ok(schema.properties.event.required.includes('action'));assert.equal(schema.properties.reply.minLength,0);assert.equal(schema.properties.event.properties.action.anyOf[0].properties.draft.properties?.fromReply,undefined)}
   if(requests.length===4)output={reply:'先保留已知经过，未报告的结果仍未知。',event:{target:{operation:'create',title:'未来沟通问题',source:{messageId,quote:'再帮我拟一个暂不催促的后续沟通问题'}},action:{operation:'create',draft:{content:'下次自然有机会交流时，想请教你当时是怎么选择实习方向的？'}}}}
   if(requests.length===8){
    assert.equal(schema.properties.reply.minLength,1,'the one generated body is the visible reply')
    assert.equal(schema.properties.event.properties.action.anyOf[0].properties.draft.properties.fromReply.const,true)
    output={reply:'学长你好，方便时想请教一下你是怎样选择实习方向的？',event:{target:{operation:'create',title:'请教消息',source:{messageId,quote:'帮我写一句给学长的请教消息'}},action:{operation:'create',draft:{fromReply:true}}}}
   }
   if(requests.length===9)output={reply:'已有信息保持原样。\n\n“你上次选课具体怎么操作的？中间哪一步卡住了？”',event:{target:{operation:'create',title:'一次选课提问',source:{messageId,quote:'帮我写一句能问出最近一次选课经历的问题'}},action:{operation:'create',draft:{content:'“你上次选课具体怎么操作的？中间哪一步卡住了？”'}}}}
   if([5,6,10].includes(requests.length)&&selection){
    assert.equal(schema.properties.reply.minLength,0)
    output.reply=''
    // Later turns have several catalogue fields. Select the actual contribution,
    // rather than relying on the first enum entry still being a project.
    const catalogue=JSON.parse(body.messages.find((m:any)=>m.role==='user').content).growthCatalogue
    output.event.action.draft.selectedFactIds=catalogue.filter((f:any)=>f.field==='project'&&['我在课程小组里负责整理资料和排版','我负责封面排版'].includes(f.text)).map((f:any)=>f.catalogueId)
    if(requests.length===6)output.event.action.draft.selectedFactIds=['mf-not-authorized']
   }
   res.writeHead(200,{'Content-Type':'text/event-stream'})
   const base={id:'synthetic-verified-material',object:'chat.completion.chunk',created:1,model:model.id}
   res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
   if(requests.length===11){res.end('data: '+JSON.stringify({error:{code:'invalid_json_schema',message:'400 schema generation failed; synthetic-private-payload'}})+'\n\n');return}
   res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
  })
 })
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r))
 model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-isolated-only';config.entitlementsEnabled=false
 const app=createApp(createTurnEngine({capabilityVerified:()=>true}));await new Promise<void>(r=>app.listen(0,'127.0.0.1',r))
 const origin='http://127.0.0.1:'+(app.address() as {port:number}).port;config.origin=origin
 let cookie='';const chat=randomUUID()
 const request=(path:string,body?:unknown)=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)})
 async function run(text:string){
  const id=randomUUID(),response=await request('/api/conversations/'+chat+'/messages',{requestId:id,text});assert.equal(response.status,200)
  const frames=(await response.text()).split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)))
  const saved=await(await request('/api/runs/'+id)).json();return {frames,saved}
 }
 try{
  const signup=await request('/api/auth/sign-up/email',{name:'Synthetic material delivery',email:'delivery-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID()});assert.equal(signup.status,200)
  assert.ok((await signup.json()).user.id);cookie=signup.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
  assert.equal((await request('/api/conversations',{id:chat,title:'Synthetic verified material'})).status,201)
  const material=await run('我在课程小组里负责整理资料和排版，代码是队友做的。只帮我写一段本人贡献描述，不要替我发送。')
  assert.equal(requests.length,1)
  const reported=requests[0].response_format.json_schema.schema.properties.event.properties.nodes.items.anyOf.find((node:any)=>node.properties?.source)
  assert.ok(reported.properties.source.properties.quote.enum.includes('我在课程小组里负责整理资料和排版'))
  assert.ok(!reported.properties.source.properties.quote.enum.includes('不要替我发送'),'writing commands must not be native fact choices')
  assert.ok(!reported.properties.source.properties.quote.enum.includes('只帮我写一段本人贡献描述'))
  const materialNodes=requests[0].response_format.json_schema.schema.properties.event.properties.nodes
  assert.ok(materialNodes.maxItems<=reported.properties.source.properties.quote.enum.length+1,'material schema bounds the observed repeated-source generation before the artifact')
  assert.deepEqual(material.frames.filter(f=>f.type==='draft'),[])
  const deltas=material.frames.filter(f=>f.type==='delta');assert.equal(deltas.length,1);assert.equal(deltas[0].saved,true);assert.equal(deltas[0].replace,true)
  assert.equal(deltas[0].text.split('我在课程小组里负责整理资料和排版').length-1,1)
  assert.ok(!deltas[0].text.includes('精通软件开发'))
  assert.equal(material.saved.status,'completed');assert.ok(material.saved.response.event)
  assert.ok(!material.saved.response.event.nodes.some((n:any)=>n.content==='不要替我发送'))
  assert.equal(material.saved.response.event.actions[0].draft.content,'我在课程小组里负责整理资料和排版。')
  materialEvent=material.saved.response.event
  const blocked=await run('接着上次实习探索，我填过岗位核对表但卡住了，别重写。我不知道怎么比较两个岗位。')
  assert.equal(blocked.saved.status,'completed','a declined material operation does not discard valid review')
  assert.equal(blocked.saved.response.event.actions[0].revision,materialEvent.actions[0].revision)
  assert.equal(blocked.saved.response.event.actions[0].draft.content,materialEvent.actions[0].draft.content)
  assert.ok(blocked.saved.response.event.nodes.some((n:any)=>n.content==='我填过岗位核对表但卡住了'))
  const ordinary=await run('想了解实习岗位，先看哪一项？')
  assert.equal(requests.length,3);assert.ok(ordinary.frames.some(f=>f.type==='draft'&&f.text.includes('核对一项实际要求')));assert.equal(ordinary.saved.status,'completed')
  const mixed=await run('上次我的本人贡献和这周时间分别是什么？未知要求不要替我补。再帮我拟一个暂不催促的后续沟通问题。')
  assert.equal(requests.length,4)
  assert.equal(mixed.saved.status,'completed','recall does not take over an explicit drafting request')
  assert.ok(mixed.frames.find(f=>f.type==='delta')?.text.includes('下次自然有机会交流时'))
  const sourceText='我在课程小组里负责整理资料和排版，代码是队友做的。队友补了一句作品描述。我负责封面排版。我把作品发给老师了，他还没有回复。帮我写一段只包含本人贡献的作品描述，不要替我发送。'
  const withoutExplanation=await run(sourceText)
  assert.equal(withoutExplanation.saved.status,'completed')
  const feedbackQuotes=requests[4].response_format.json_schema.schema.properties.event.properties.nodes.items.anyOf.find((node:any)=>node.properties?.source).properties.source.properties.quote.enum
  assert.ok(feedbackQuotes.includes('我把作品发给老师了'))
  assert.ok(feedbackQuotes.includes('他还没有回复'),'real mixed feedback remains a legal native source')
  assert.deepEqual(withoutExplanation.frames.filter(f=>f.type==='draft'),[])
  const body=withoutExplanation.frames.find(f=>f.type==='delta')
  assert.equal(body?.text,'我在课程小组里负责整理资料和排版；我负责封面排版。')
  assert.equal(body?.saved,true);assert.equal(body?.replace,true)
  assert.equal(withoutExplanation.saved.response.event.actions.find((a:any)=>a.status==='proposed').draft.content,body.text)
  const badSelection=await run(sourceText)
  assert.equal(badSelection.saved.status,'failed')
  assert.equal(badSelection.frames.find(f=>f.type==='error')?.code,'MATERIAL_REFERENCE_INVALID')
  assert.ok(!badSelection.frames.some(f=>['draft','delta','done'].includes(f.type)))
  const questionChoice=await run('我是成年大学生，想先了解就业和自由职业。我在课程小组里负责整理资料和排版，代码是队友做的。目前没有客户，每周能花两小时。先帮我选一个值得了解的问题。')
  assert.equal(questionChoice.saved.status,'completed','choosing a question does not require a saved material')
  const materialOnly=await run('帮我写一句给学长的请教消息，不要替我发送。')
  assert.equal(materialOnly.saved.status,'completed')
  assert.equal(materialOnly.frames.find(f=>f.type==='delta')?.text,'学长你好，方便时想请教一下你是怎样选择实习方向的？')
  const tooManyQuestions=await run('先问一个同学就好，帮我写一句能问出最近一次选课经历的问题。')
  assert.equal(tooManyQuestions.saved.status,'completed','the existing safe question extractor bounds the actual two-question artifact without another call')
  assert.equal(tooManyQuestions.frames.find(f=>f.type==='delta')?.text,'已有信息保持原样。\n\n你上次选课具体怎么操作的？')
  assert.equal(tooManyQuestions.saved.response.event.actions.find((a:any)=>a.status==='proposed'&&a.draft.content==='你上次选课具体怎么操作的？')?.draft.content,'你上次选课具体怎么操作的？')
  // This fake provider has not emitted a growth fact. Supply the synthetic
  // contribution through the ordinary user-edit API before a later readback.
  assert.equal((await request('/api/growth',{requestId:randomUUID(),conversationId:chat,kind:'context',text:'我在课程小组里负责整理资料和排版'})).status,201)
  const callsBeforeLiteral=requests.length
  const literal=await run('我想先了解实习岗位，别把小组成果都算成我的能力。帮我写一段只包含本人贡献的作品描述，不要替我发送。')
  assert.equal(literal.saved.status,'completed')
  assert.equal(requests.length,callsBeforeLiteral,'one verified literal contribution needs no generated selection')
  assert.equal(literal.frames.find(f=>f.type==='delta')?.text,'我在课程小组里负责整理资料和排版。')
  assert.equal((await request('/api/growth',{requestId:randomUUID(),conversationId:chat,kind:'context',text:'我负责封面排版'})).status,201)
  const pureCatalogue=await run('我想先了解实习岗位，别把小组成果都算成我的能力。帮我写一段只包含本人贡献的作品描述，不要替我发送。')
  assert.equal(pureCatalogue.saved.status,'completed')
  // Keep the failed provider last: its ordinary cooldown must remain effective.
  const failure=await run('现在先聊聊实习方向，可以先看什么？')
  assert.equal(requests.length,11,'stream failure never triggers a second call')
  assert.ok(failure.frames.some(f=>f.type==='draft_discarded'))
  assert.equal(failure.frames.find(f=>f.type==='error')?.code,'MODEL_REQUEST_FAILED')
  assert.ok(!failure.frames.some(f=>f.type==='done'||f.type==='delta'))
  assert.equal(failure.saved.status,'failed');assert.equal(failure.saved.response,null)
  assert.ok(!JSON.stringify(failure.frames).includes('synthetic-private-payload'))
 }finally{
  app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()))
  // The isolated runner drops this database; do not cascade-delete message
  // sources underneath the newly created experience evidence during cleanup.
  model.baseUrl=previous.url;config.apiKey=previous.key;config.origin=previous.origin;config.entitlementsEnabled=previous.access;await localEmbedding.close();await pool.end()
 }
})
