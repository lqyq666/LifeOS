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
import {buildClauseCatalogue} from '../../server/clause-catalogue.ts'
import {growthContext} from '../../server/growth.ts'
import {readStarMapContext} from '../../server/user-themes.ts'

test('three sourced themes and detailed experiences grow in normal commits and enter later memory without extra model calls (simulated provider)',async()=>{
 const jobs:any[]=[],requests:any[]=[],old={url:model.baseUrl,key:config.apiKey}
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',x=>chunks.push(Buffer.from(x)));req.on('end',()=>{requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));const output=jobs.shift();if(!output){res.writeHead(500);res.end();return}res.writeHead(200,{'Content-Type':'text/event-stream'});const base={id:'quiet-detail-'+requests.length,object:'chat.completion.chunk',created:1,model:model.id};res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:JSON.stringify(output)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')})})
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r));model.baseUrl='http://127.0.0.1:'+(fake.address() as any).port;config.apiKey='synthetic-quiet-detail-key'
 try{
  const user='quiet-detail-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal;await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid']);await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0});await store.createConversation(user,{id:chat,title:'无感整理合成验证'})
  const engine=createTurnEngine({capabilityVerified:()=>true})
  const execute=async(text:string,output:any,conversation=chat)=>{jobs.push(output);const before=requests.length,run=(await store.startRun(user,conversation,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]};const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit(){}});await store.finishRun(run,staged,result.text,result.usage,signal);assert.equal(requests.length,before+1,'one main call; no separate profiling/extraction call');assert.equal(result.text,output.reply);return run}
  const stories=[
   '昨天我完成了一个小工具的原型。我用现成组件搭建了两个按钮。因为这次我想用创造解决一个小问题。结果一个按钮还不能使用。',
   '上周我整理了课程任务的执行清单。我用纸笔列出了两个步骤。因为这次我想自主安排自己的次序。结果清单只完成了一项。',
   '前天我整理了学习笔记。我用老师给的例题标注了两个错误。因为这次我想检查成长过程中还没理解的知识。老师还没有评价。',
  ]
  for(const [index,story] of stories.entries()){
   const text=(index===0?'我看重创造。我重视自主。我看重成长。':'')+story+'请记住经过，不要推断稳定能力。',clauses=buildClauseCatalogue(text),action=clauses.find(x=>x.text===story.split('。')[0])!
   await execute(text,{reply:['这次做出了原型，但按钮尚未全部可用。','清单记录了你的做法，未完成部分仍保留。','记录有例题支持，评价仍未知。'][index],...(index===0?{growthUpdates:clauses.slice(0,3).map(c=>({target:{operation:'create'},kind:'preference',assertion:'user_reported',source:{clauseId:c.clauseId}}))}:{}),experienceCandidate:{source:{clauseIds:[action.clauseId]},action:{clauseId:action.clauseId},links:[]}})
  }
  const records=await store.listExperiences(user,chat);assert.equal(records.length,3)
  for(const story of stories){const row=records.find(x=>x.content.summary===story.slice(0,-1));assert.ok(row,'the same-episode full source is kept');assert.ok(row.content.action.includes('用'));assert.ok(row.content.result);assert.ok(!row.content.summary.includes('请记住'))}
  const graph=await store.cognitionGraph(user),themes=graph.nodes.filter((n:any)=>n.type==='value');assert.equal(themes.length,3)
  for(const theme of themes)assert.ok(graph.edges.some((e:any)=>e.targetId===theme.id),'each theme has a source-backed experience link')
  const later=randomUUID();await store.createConversation(user,{id:later,title:'跨会话承接'})
  assert.ok((await growthContext(user,later)).some(x=>x.text==='我看重创造'))
  const star=await readStarMapContext(pool,user);assert.ok(star&&star.themes.length===3&&star.linkedExperiences.length>=3)
  await execute('只分析已保存的经历，不修改档案、不创建任务或经历。',{reply:'当前记录里，三次具体尝试各有做法和未确认结果。'},later)
  assert.ok(JSON.stringify(requests.at(-1).messages).includes('现成组件'))
  await setMemorySettings(user,{requestId:randomUUID(),enabled:false,expectedRevision:1});const closed=randomUUID();await store.createConversation(user,{id:closed,title:'关闭记忆的新对话'})
  assert.equal(await readStarMapContext(pool,user),null)
  await execute('这个新对话你了解我什么？不要猜测，不修改档案。',{reply:'当前对话没有可据以描述你个人经历的信息。'},closed)
  assert.ok(!JSON.stringify(requests.at(-1).messages).includes('现成组件'));assert.deepEqual(await store.listExperiences(user,chat),records)
 }finally{model.baseUrl=old.url;config.apiKey=old.key;fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()));await localEmbedding.close();await pool.end()}
})
