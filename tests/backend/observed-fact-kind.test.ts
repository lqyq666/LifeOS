import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {stageGrowthUpdates,growthView,growthContext} from '../../server/growth.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {detectUnconfirmedLabelRejection} from '../../server/forget-intent.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test('saved real failures retain past facts and source-bound controls across conversations',async()=>{
  const user='observed-kind-'+randomUUID(),conversation=randomUUID()
  try{
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
    await store.createConversation(user,{id:conversation,title:'SYNTHETIC observed action kind'})
    await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
    for(const [quote,expected] of [
      ['最近一次我先定了三条分类规则','context'],
      ['我整理过一份课堂资料','context'],
      ['我的目标是在年底完成一个项目','goal'],
      ['我计划下周先定三条分类规则','goal'],
      ['我定了明年去北京读研','goal'],
      ['我定了保研方向','goal'],
      ['我已经定了下周访谈的三条问题','context'],
      ['我优先完成我做过的项目','goal'],
      ['我定了明年按学校流程申请保研','goal'],
    ]){
      const run=(await store.startRun(user,conversation,randomUUID(),quote)).run
      const staged:store.Staged={candidates:[],audit:[]}
      staged.growth=await stageGrowthUpdates(run,[{target:{operation:'create'},assertion:'user_reported',kind:'goal',text:quote,source:{messageId:run.source_message_id,quote}}] as any,[])
      assert.equal(staged.growth.changes[0].kind,expected,quote)
      await store.finishRun(run,staged,'保留这条本人原话。',null as any,new AbortController().signal)
      const saved=(await growthView(user,conversation)).items.find(item=>item.text===quote)
      assert.equal(saved?.kind,expected,quote)
    }
    const boundary=detectUnconfirmedLabelRejection('忘掉“我喜欢销售”这个从未由我确认的错误标签；不要从这些经历重新推出来。现在结束，不安排下一步。')!
    for(const quote of ['同学表格那件事先暂停','先暂停这个方向','老师让项目先暂停','导师建议这件事先暂停',...boundary.boundaryQuotes]){
      const run=(await store.startRun(user,conversation,randomUUID(),quote)).run
      const growth=await stageGrowthUpdates(run,[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{messageId:run.source_message_id,quote}}] as any,[])
      await store.finishRun(run,{candidates:[],audit:[],growth},'尊重这条边界。',null,new AbortController().signal)
    }
    const second=randomUUID();await store.createConversation(user,{id:second,title:'SYNTHETIC boundary readback'})
    const retained=await growthContext(user,second)
    assert.equal(retained.find(item=>item.text==='同学表格那件事先暂停')?.taskBoundary?.targetText,'同学表格那件事')
    assert.equal(retained.find(item=>item.text==='先暂停这个方向')?.taskBoundary?.targetText,'这个方向')
    for(const quote of ['老师让项目先暂停','导师建议这件事先暂停'])assert.equal(retained.find(item=>item.text===quote)?.taskBoundary,undefined,'third-party requests do not become user controls')
    assert.ok(boundary.boundaryQuotes.every(quote=>retained.some(item=>item.text===quote)),'the rejection keeps its quoted object and command across conversations')
  }finally{
    await pool.query('DELETE FROM "user" WHERE id=$1',[user])
    await localEmbedding.close();await pool.end()
  }
})
