import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {createGrowthItem,growthContext} from '../../server/growth.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test('unconfirmed absent label gets a truthful receipt and durable no-reinference boundary',async()=>{
  await localEmbedding.start()
  const output={reply:'已移除“我喜欢销售”标签，不再从经历推导。',growthUpdates:[{target:{operation:'correct',itemId:randomUUID()},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}]}
  const fake=createServer((req,res)=>{req.on('data',()=>{});req.on('end',()=>{
    const base={id:'unconfirmed-label',object:'chat.completion.chunk',created:1,model:model.id}
    res.writeHead(200,{'Content-Type':'text/event-stream'})
    res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
    res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:80,total_tokens:280,prompt_tokens_details:{cached_tokens:0}}})+'\n\ndata: [DONE]\n\n')
    res.end()
  })})
  await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve))
  const previousUrl=model.baseUrl,previousKey=config.apiKey
  model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port
  config.apiKey='synthetic-unconfirmed-label-key-1234567890'
  const user='unconfirmed-label-'+randomUUID(),chat=randomUUID(),nextChat=randomUUID()
  try{
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
    await store.createConversation(user,{id:chat,title:'SYNTHETIC LABEL A'})
    await store.createConversation(user,{id:nextChat,title:'SYNTHETIC LABEL B'})
    await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1)',[user])
    const unrelated=await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'context',text:'另一位同学试过我做的表格后明确说不适合他'})
    output.growthUpdates[0]!.target.itemId=unrelated.id as ReturnType<typeof randomUUID>
    const started=await store.startRun(user,chat,randomUUID(),'忘掉“我喜欢销售”这个从未由我确认的错误标签；不要从这些经历重新推出来。现在结束，不安排下一步。')
    const staged:store.Staged={candidates:[],audit:[]}
    const signal=new AbortController().signal
    const result=await createTurnEngine({capabilityVerified:()=>true})({run:started.run,staged,context:await store.contextForRun(started.run),decision:null,signal,emit:()=>{}})
    assert.doesNotMatch(result.text,/已移除|已删除|已遗忘/)
    assert.match(result.text,/没有找到已保存的“我喜欢销售”记录/)
    const response=await store.finishRun(started.run,staged,result.text,result.usage,signal)
    assert.equal(response.stateChange.memoryControl,null)
    assert.ok((await growthContext(user,nextChat)).some(item=>item.text==='不要从这些经历重新推出来'))
    assert.ok((await growthContext(user,chat)).some(item=>item.id===unrelated.id))
  }finally{
    model.baseUrl=previousUrl;config.apiKey=previousKey
    await new Promise<void>(resolve=>fake.close(()=>resolve()))
    try{await localEmbedding.close()}catch{}
    for(const table of ['growth_control_requests','growth_recommendation_controls','growth_source_suppressions','growth_item_lineage','growth_items','growth_revisions','growth_operations','user_memory_settings'])await pool.query(`DELETE FROM ${table} WHERE user_id=$1`,[user]).catch(()=>{})
    await pool.query('DELETE FROM coach_reply_sources WHERE user_id=$1',[user]).catch(()=>{})
    await pool.query('DELETE FROM runs WHERE user_id=$1',[user]).catch(()=>{})
    await pool.query('DELETE FROM messages WHERE user_id=$1',[user]).catch(()=>{})
    await pool.query('DELETE FROM conversations WHERE user_id=$1',[user]).catch(()=>{})
    await pool.query('DELETE FROM "user" WHERE id=$1',[user]).catch(()=>{})
  }
})
