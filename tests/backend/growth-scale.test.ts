import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { growthContext, growthSnapshotKey } from '../../server/growth.ts'
import { buildTurnPrompt, turnSystemPrompt } from '../../server/turn-prompt.ts'
import { estimateTokens } from '../../server/context.ts'

// P3 B2 growth-scale probe (isolated PG, no provider): with 200 active growth
// records plus stale/old ones, the serialized prompt stays bounded by SELECTION
// (a relevance window), old key constraints remain findable, and latency of the
// growth read stays in the tens-of-ms range. This measures real serialization
// of real rows — not a claim about model behavior at that context size.

test('growth scale: 200 active records stay selectable and the key old constraint survives serialization',async t=>{
  const user='growth-scale-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC scale'})
  try{
    // 200 active facts + 30 stale + a key old constraint created FIRST.
    await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,valid_until) VALUES($1,$2,$3,'constraint','我每周只有三小时，这学期都要保持','user_reported','active',$4::jsonb,'[]'::jsonb,NULL)",
      [randomUUID(),user,chat,JSON.stringify([{type:'user_edit',quote:'我每周只有三小时'}])])
    const inserted:any[]=[]
    for(let i=0;i<200;i++){
      const id=randomUUID()
      inserted.push(id)
      await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies) VALUES($1,$2,$3,'context',$4,'user_reported','active','[]'::jsonb,'[]'::jsonb)",
        [id,user,chat,`日常记录${i}：完成了第${i}次练习并记录了过程细节`])
    }
    for(let i=0;i<30;i++)await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies) VALUES($1,$2,$3,'context',$4,'user_reported','stale','[]'::jsonb,'[]'::jsonb)",
      [randomUUID(),user,chat,`旧记录${i}：已过期的事实`])
    const readStart=performance.now()
    const growth=await growthContext(user,chat)
    const readMs=performance.now()-readStart
    assert.equal(growth.length,201,'200 active facts + the key constraint are all read')
    assert.ok(growth.some(item=>item.text.includes('我每周只有三小时')),'the oldest key constraint survives')
    await t.test('serialized prompt size and token estimate stay measured, not unbounded',async()=>{
      const prompt=buildTurnPrompt({currentMessageId:'m',messages:[{id:'m',role:'user',content:'这周怎么安排？',created_at:new Date().toISOString()} as never],growth})
      const chars=prompt.length
      const tokens=estimateTokens(turnSystemPrompt('default')+prompt)
      console.log(JSON.stringify({phase:'growth_scale_full_serialization',chars,tokens}))
      // Measured facts for the report; the assertion only pins that the number
      // is finite and derivable, not a hard cap (selection work is follow-up).
      assert.ok(Number.isFinite(chars)&&chars>0)
      console.log(JSON.stringify({phase:'growth_scale_probe',activeItems:growth.length,promptChars:chars,estimatedTokens:tokens,readMs:Math.round(readMs)}))
    })
    await t.test('P4 B1: relevance selection bounds the prompt while the key old constraint survives',async()=>{
      const {selectRelevantGrowth,DEFAULT_GROWTH_SELECTION}=await import('../../server/growth-selection.ts')
      const question='这周时间紧，怎么安排备考和课程？'
      const sel=selectRelevantGrowth(growth,question,{maxItems:20,maxChars:60000})
      assert.equal(sel.totalActive,201)
      assert.equal(sel.selected.length,20,'selection is bounded by the pre-declared budget')
      assert.ok(sel.selected.some(item=>item.text.includes('我每周只有三小时')),'the key old constraint survives selection even with zero lexical overlap (essentials net)')
      const promptSel=buildTurnPrompt({currentMessageId:'m',messages:[{id:'m',role:'user',content:question,created_at:new Date().toISOString()} as never],growth:sel.selected})
      const promptAll=buildTurnPrompt({currentMessageId:'m',messages:[{id:'m',role:'user',content:question,created_at:new Date().toISOString()} as never],growth})
      console.log(JSON.stringify({phase:'growth_selection_probe',fullChars:promptAll.length,selectedChars:promptSel.length,fullTokens:estimateTokens(promptAll),selectedTokens:estimateTokens(promptSel),dropped:sel.dropped}))
      assert.ok(promptSel.length<promptAll.length/3,'selected prompt is a small fraction of full serialization')
    })
    await t.test('the snapshot key is stable across reads of the same state',async()=>{
      const a=growthSnapshotKey(growth),b=growthSnapshotKey(await growthContext(user,chat))
      assert.equal(a,b)
    })
  }finally{
    await pool.query('DELETE FROM growth_source_suppressions WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_item_lineage WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_items WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_revisions WHERE user_id=$1',[user])
    await pool.query('DELETE FROM runs WHERE user_id=$1',[user])
    await pool.query('DELETE FROM messages WHERE user_id=$1',[user])
    await pool.query('DELETE FROM conversations WHERE user_id=$1',[user])
    await pool.query('DELETE FROM "user" WHERE id=$1',[user])
  }
})

test('P5 S1: >maxItems archive commits an ordinary turn without phantom snapshot conflicts (isolated PG, simulated provider)',async t=>{
  const {createServer}=await import('node:http')
  const {createTurnEngine}=await import('../../server/agent.ts')
  const {model}=await import('../../server/model.ts')
  const {config}=await import('../../server/config.ts')
  const outputs:unknown[]=[]
  const engine=createTurnEngine({capabilityVerified:()=>true})
  const fake=createServer((req,res)=>{
    const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)))
    req.on('end',()=>{
      const output=outputs.shift()
      if(output===undefined){res.writeHead(500);res.end();return}
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      const base={id:'p5-synth',object:'chat.completion.chunk',created:1,model:model.id}
      const chunk1='data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\n'
      const chunk2='data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:80,total_tokens:280,prompt_tokens_details:{cached_tokens:0}}})+'\n\ndata: [DONE]\n\n'
      res.write(chunk1)
      res.end(chunk2)
    })
  })
  await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r))
  const prevURL=model.baseUrl,prevKey=config.apiKey
  model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port
  config.apiKey='synthetic-p5-key-1234567890'
  const user='p5-s1-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC P5 S1'})
  try{
    // 60 normal user_edit-sourced records (over the 40-item budget)
    for(let i=0;i<60;i++)await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies) VALUES($1,$2,$3,'context',$4,'user_edit','active',$5::jsonb,'[]'::jsonb)",
      [randomUUID(),user,chat,'日常记录第'+i+'条：课程与笔记整理'+('细节'.repeat(3)),JSON.stringify([{type:'user_edit',quote:'记录'+i}])])
    await t.test('ordinary turn commits with 60 active items and no model growth updates',async()=>{
      const run=(await store.startRun(user,chat,randomUUID(),'课程报告写作如何开始？')).run
      const staged:store.Staged={candidates:[],audit:[]}
      const input={run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:()=>{}}
      outputs.push({reply:'先从一个具体段落开始写。'})
      const result=await engine(input)
      const saved=await store.finishRun(run,staged,result.text,result.usage,input.signal)
      assert.ok(saved,'commit succeeds with no phantom GROWTH_SNAPSHOT_INVALIDATED at 60 items')
      const sel=staged.audit.find((a:any)=>a.phase==='growth_selection')
      assert.ok(sel&&sel.selected<60,'selection audit recorded a real drop')
    })
    await t.test('a REAL concurrent revision change is still rejected',async()=>{
      const run=(await store.startRun(user,chat,randomUUID(),'再说说方向。')).run
      const staged:store.Staged={candidates:[],audit:[]}
      const input={run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:()=>{}}
      outputs.push({reply:'好的。',growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:run.source_message_id,quote:'再说说方向'}}]})
      const result=await engine(input)
      // simulate a REAL concurrent revision bump AFTER generation, before commit
      await pool.query("UPDATE growth_items SET revision=revision+1 WHERE user_id=$1 AND id=(SELECT id FROM growth_items WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1)",[user])
      await assert.rejects(store.finishRun(run,staged,result.text,result.usage,input.signal),(e:any)=>e.code==='GROWTH_SNAPSHOT_INVALIDATED')
    })
  }finally{
    model.baseUrl=prevURL;config.apiKey=prevKey
    await new Promise<void>(d=>fake.close(()=>d()))
    await pool.query('DELETE FROM growth_source_suppressions WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_item_lineage WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_items WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_revisions WHERE user_id=$1',[user])
    await pool.query('DELETE FROM runs WHERE user_id=$1',[user])
    await pool.query('DELETE FROM messages WHERE user_id=$1',[user])
    await pool.query('DELETE FROM conversations WHERE user_id=$1',[user])
    await pool.query('DELETE FROM "user" WHERE id=$1',[user])
  }
})

test.after(async()=>{try{const {localEmbedding}=await import('../../server/local-embedding.ts');await localEmbedding.close()}catch{}await pool.end()})
