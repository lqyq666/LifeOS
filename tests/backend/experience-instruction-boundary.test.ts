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
import {growthView} from '../../server/growth.ts'

test('actual engine commits the reported action, never source acknowledgments or inference instructions',async()=>{
 const text='今天我在课程小组里负责整理传感器采样数据，用老师提供的脚本绘图，发现两处异常并标注出来。这些是我这次亲自做过的事情，请记住背景和经过，帮我区分已有证据与仍不知道的部分，不把这次经历说成我已经有稳定科研能力。'
 const clauses=buildClauseCatalogue(text),wrong=clauses.filter(c=>c.start>=text.indexOf('这些'))
 const reply='本次整理数据和标注异常有你的报告支持，稳定科研能力仍不能由一次任务推出。'
 const output={reply,growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:clauses[0]!.clauseId}},{target:{operation:'create'},assertion:'ai_observation',kind:'observation',text:'本次有整理数据的行动报告，独立程度未知。',source:{clauseId:wrong[0]!.clauseId},dependencies:[{updateIndex:0}],limitation:'只有一次报告。'}],experienceCandidate:{source:{clauseIds:wrong.map(c=>c.clauseId)},action:{clauseId:wrong[0]!.clauseId},result:{clauseId:wrong.at(-1)!.clauseId},links:[]}}
 let calls=0;const old={url:model.baseUrl,key:config.apiKey}
 const fake=createServer((req,res)=>{req.resume();req.on('end',()=>{calls++;res.writeHead(200,{'Content-Type':'text/event-stream'});const base={id:'synthetic-experience-boundary',object:'chat.completion.chunk',created:1,model:model.id};res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:JSON.stringify(output)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')})})
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r));model.baseUrl='http://127.0.0.1:'+(fake.address() as any).port;config.apiKey='synthetic-experience-boundary-key'
 try{const user='boundary-'+randomUUID(),chat=randomUUID();await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid']);await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0});await store.createConversation(user,{id:chat,title:'Synthetic saved instruction regression'})
 const run=(await store.startRun(user,chat,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]},signal=new AbortController().signal;const engine=createTurnEngine({capabilityVerified:()=>true});const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit(){}});await store.finishRun(run,staged,result.text,result.usage,signal)
 assert.equal(calls,1);assert.equal(result.text,reply)
 const records=(await store.cognitionGraph(user)).nodes.filter((n:any)=>n.type==='experience');assert.equal(records.length,1);const saved=JSON.stringify(records[0]);assert.match(saved,/传感器采样数据/);assert.doesNotMatch(saved,/请记住|不把这次经历|这些是我这次/)
 const growth=await growthView(user);assert.ok(growth.items.some(x=>x.text.includes('传感器')));assert.ok(!growth.items.some(x=>x.assertion==='ai_observation'&&!x.unavailableReason))
 }finally{model.baseUrl=old.url;config.apiKey=old.key;fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()));await localEmbedding.close();await pool.end()}
})
