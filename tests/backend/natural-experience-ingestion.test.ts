import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {pool,transaction} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {applyMemoryAction,setMemorySettings} from '../../server/memory.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {buildClauseCatalogue} from '../../server/clause-catalogue.ts'
import {readStarMapContext} from '../../server/user-themes.ts'
import {createGrowthItem} from '../../server/growth.ts'

test('natural three-theme reports commit full sourced episodes and reach a fresh conversation (simulated provider)',async()=>{
 const outputs:any[]=[],requests:any[]=[],old={url:model.baseUrl,key:config.apiKey}
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',x=>chunks.push(Buffer.from(x)));req.on('end',()=>{requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));const out=outputs.shift();res.writeHead(200,{'Content-Type':'text/event-stream'});const base={id:'natural-report-'+requests.length,object:'chat.completion.chunk',created:1,model:model.id};res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:JSON.stringify(out)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')})})
 await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve));model.baseUrl='http://127.0.0.1:'+(fake.address() as any).port;config.apiKey='synthetic-natural-reports'
 try{
  const user='natural-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal;await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid']);await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0});await store.createConversation(user,{id:chat,title:'自然经历提交回归'})
  const engine=createTurnEngine({capabilityVerified:()=>true})
  const archived=await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'preference',text:'我看重创造'})
  const execute=async(text:string,out:any,conversationId=chat)=>{outputs.push(out);const count=requests.length,run=(await store.startRun(user,conversationId,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]};const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit(){}});await store.finishRun(run,staged,result.text,result.usage,signal);assert.equal(requests.length,count+1);assert.equal(result.text,out.answer?.deliver??out.reply);return staged}
  const stories=[
   '我看重创造。昨天我把一页课程笔记做成了可检索的原型。我用现成模板搭好页面，再按两位同学给的三个关键词加了检索入口。因为这次我想先验证同学能不能找到资料。结果其中一个关键词还搜不到，另外两个能返回笔记段落；同学还没有实际使用过。',
   '我也看重自主。上周我给课程任务整理了一个执行清单。我用纸笔写下两步，再把必须等同学确认的那一步单独标出来。因为这次我想自己决定先后顺序，同时不漏掉协作依赖。结果先做完了其中一步，另一项还在等回复。',
   '我看重成长。前天我核对了学习笔记里的两道例题。我照着老师的解题过程逐行重算，发现一处单位换算错误，改完后又用原题条件验了一遍。因为这次我想弄清自己错在哪里，而不是只记答案。结果这两道例题的重算做完了，老师还没评价，也不能据此说明我已经掌握整个章节。',
  ]
  const stages:store.Staged[]=[]
  for(const [index,text] of stories.entries()){
   const clauses=buildClauseCatalogue(text),action=clauses.find(c=>/^(?:昨天|上周|前天)/.test(c.text))!
   stages.push(await execute(text,{reply:['这次原型已经做出，但有一个关键词仍无法检索；同学尚未使用。','你已经做完清单中的一步，另一项仍有协作依赖。','这次核对有老师的解题过程作为支持，不能推广为整章掌握。'][index],experienceCandidate:{source:{clauseIds:[action.clauseId]},action:{clauseId:action.clauseId},links:[]}}))
  }
  const episodes=await store.listExperiences(user,chat);assert.equal(episodes.length,3,JSON.stringify({episodes:episodes.map(e=>e.source_quote),audit:stages.map(s=>s.audit.filter((a:any)=>String(a.phase).includes('candidate')))}))
  assert.ok(episodes.some(e=>e.content.action.includes('三个关键词')&&e.content.result.includes('同学还没有实际使用过')))
  assert.ok(episodes.some(e=>e.content.action.includes('必须等同学确认')))
  assert.ok(episodes.some(e=>e.content.action.includes('原题条件验了一遍')&&e.content.result.includes('老师还没评价')))
  const graph=await store.cognitionGraph(user),themes=graph.nodes.filter(n=>n.type==='value');assert.equal(themes.length,3)
  assert.ok(!themes.some(theme=>/因为|为了/.test(theme.title)),'episode reasons are not new global goals')
  for(const theme of themes)assert.ok(graph.edges.some(e=>e.type==='RELATES_TO_VALUE'&&e.targetId===theme.id),'theme needs a tentative sourced link: '+JSON.stringify({title:theme.title,edges:graph.edges}))
  const creation=themes.find(theme=>theme.title.includes('创造'))!
  const creationEdge=graph.edges.find(e=>e.type==='RELATES_TO_VALUE'&&e.targetId===creation.id)!
  assert.equal(creationEdge.status,'partial_evidence')
  assert.equal(creationEdge.confirmed,false)
  assert.deepEqual((await pool.query("SELECT id FROM growth_items WHERE user_id=$1 AND kind='preference' AND text LIKE '我看重创造%'",[user])).rows,[{id:archived.id}])
  const later=randomUUID();await store.createConversation(user,{id:later,title:'新会话验证'});await execute('根据已保存的经历给建议，只分析，不修改档案、不创建任务或经历。',{answer:{deliver:'已有原型里一个关键词仍搜不到，可以先核对这一处；它还不能证明同学会采用。'}},later)
  assert.ok(JSON.stringify(requests.at(-1).messages).includes('现成模板'));assert.ok(JSON.stringify(requests.at(-1).messages).includes('等同学确认'))
  assert.ok(requests.at(-1).messages.find((m:any)=>m.role==='system').content.includes('不能把几个测试点成功换算为整个项目的完成百分比'))
  assert.ok(requests.at(-1).response_format.json_schema.schema.properties.answer)
  assert.deepEqual(await store.listExperiences(user,chat),episodes)
  const memoryId=randomUUID(),source=episodes.find(e=>e.source_quote.includes('三个关键词'))!.source_message_id
  const quote='我看重创造'
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,status) VALUES($1,$2,'fact','priorAttempts',$3,'user_reported','user',$4,now(),'active')",[memoryId,user,JSON.stringify(quote),JSON.stringify([{type:'message',conversationId:chat,messageId:source,quote,range:{start:0,end:quote.length}}])])
  const beforeForget=await readStarMapContext(pool,user)
  const linkBefore=beforeForget?.usedLinks.find(link=>'theme-'+link.themeId===creation.id)
  assert.ok(linkBefore)
  await applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const storedLink=(await pool.query('SELECT status,revision,reason FROM experience_theme_links WHERE user_id=$1 AND experience_id=$2 AND theme_id=$3',[user,linkBefore.experienceId,linkBefore.themeId])).rows[0]
  assert.deepEqual(storedLink,{status:'retired',revision:linkBefore.revision+1,reason:''})
  await assert.rejects(transaction(c=>store.assertStarMapSnapshot(c,user,{themes:[],links:[linkBefore]})),/STARMAP_SNAPSHOT_INVALIDATED/)
  const afterForget=await store.cognitionGraph(user)
  assert.ok(afterForget.nodes.some(n=>n.id===creation.id),'the independent archive still supports the theme')
  assert.ok(afterForget.nodes.some(n=>n.id===creationEdge.sourceId),'the independent episode remains')
  assert.ok(!afterForget.edges.some(e=>e.id===creationEdge.id),'the link loses its adjacent evidence')
  const stale=await pool.query(`INSERT INTO experience_theme_links(user_id,experience_id,theme_id,relation,reason,created_at)
    SELECT e.user_id,e.id,t.id,'partial_evidence',$2,now() FROM experiences e JOIN user_themes t ON t.user_id=e.user_id
    WHERE e.user_id=$1 ON CONFLICT DO NOTHING`,[user,creationEdge.reason])
  assert.equal(stale.rowCount,6,'six newer invalid links precede the two valid ones')
  const context=await readStarMapContext(pool,user)
  assert.ok(context&&!context.usedLinks.some(link=>'theme-'+link.themeId===creation.id))
  assert.ok(context.usedLinks.length>=2,'unrelated links remain available')
  const futureText='昨天我把笔记做成了原型。明天我打算联系同学。',future=(await store.startRun(user,chat,randomUUID(),futureText)).run
  await assert.rejects(store.stageCandidate(future,{candidates:[],audit:[]},{sourceMessageId:future.source_message_id,quote:futureText,links:[],content:{action:futureText,result:'',occurredAt:''}}),(error:any)=>error.code==='PLANNED_ACTION_IS_NOT_EXPERIENCE')
  await store.terminateRun(user,future.request_id,'cancelled','SYNTHETIC_FUTURE_BOUNDARY')
  await setMemorySettings(user,{requestId:randomUUID(),enabled:false,expectedRevision:1});assert.equal(await readStarMapContext(pool,user),null)
  const off=randomUUID();await store.createConversation(user,{id:off,title:'关闭记忆后的新会话'})
  await execute('只根据本轮对话你知道我的经历吗？没有依据就说明，不要猜，不修改档案。',{answer:{deliver:'当前新对话没有可核对的个人经历依据。'}},off)
  assert.ok(!JSON.stringify(requests.at(-1).messages).includes('现成模板'))
  assert.ok(!JSON.stringify(requests.at(-1).messages).includes('必须等同学确认'))
  assert.deepEqual(await store.listExperiences(user,chat),episodes)
 }finally{model.baseUrl=old.url;config.apiKey=old.key;fake.closeAllConnections();await new Promise<void>(resolve=>fake.close(()=>resolve()));await localEmbedding.close();await pool.end()}
})
