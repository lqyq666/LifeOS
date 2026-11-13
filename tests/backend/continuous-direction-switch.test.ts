import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import {growthView,growthContext} from '../../server/growth.ts'
import {readDirectionControls} from '../../server/growth-controls.ts'
import * as store from '../../server/store.ts'

test('real C feedback shape changes direction without retyping the existing goal or erasing background',async()=>{
 const h=await residualHarness()
 try{
  const {user,chat}=await h.account()
  await h.execute(user,chat,'我想先花十分钟核对考研资料。我读信息管理。',{growthUpdates:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c0'}},{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c1'}}]},'先核对一份资料，其他方向仍未知。')
  const old=(await growthView(user,chat)).items.find(item=>item.kind==='goal'&&item.text.includes('考研资料'))!;assert.ok(old)
  const text='我决定结束这件事，不再继续准备考研资料。我现在决定转向就业探索，先了解数据运营岗位，这周最多半小时；还没有投简历，也没有明确目标公司。这是我本人做的方向选择，不是别人替我决定的。你怎么看这次变化，以后怎么帮我？'
  const run=await h.execute(user,chat,text,{growthUpdates:[{target:{operation:'create'},kind:'direction',assertion:'user_reported',source:{clauseId:'c2'}},{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c3'}}]},'新增事实是你结束考研资料核对并转向就业；理解变化仅在当前方向，未判断稳定能力。目标公司和岗位条件未知，后续按半小时帮助，不重排考研。')
  const current=await growthContext(user,chat),changed=current.find(item=>item.id===old.id)!
  assert.ok(changed);assert.equal(changed.kind,old.kind);assert.match(changed.text,/就业探索/);assert.ok(current.some(item=>item.text==='我读信息管理'))
  assert.ok((await readDirectionControls(user)).some(row=>row.scope==='postgraduate_exam'&&row.state==='paused'))
  const second=randomUUID();await store.createConversation(user,{id:second,title:'SYNTHETIC corrected direction next help'})
  await h.execute(user,second,'接着上次方向变化，先按当前有效资料说明，不要保存新档案。',{},'当前方向是就业探索，考研已停止推荐；具体岗位要求未知。')
  assert.match(JSON.stringify(h.requests.at(-1).messages),/就业探索/)
  const priorityChat=randomUUID();await store.createConversation(user,{id:priorityChat,title:'SYNTHETIC actual priority help question'})
  const priority=await h.execute(user,priorityChat,'接着上次方向变化，我今天该优先做什么？',{},'今天只在半小时内浏览一份数据运营岗位说明，不恢复已经结束的考研资料核对。')
  assert.equal(h.requests.at(-1).response_format.json_schema.schema.properties.reply.enum,undefined,'a real next-help question must not be bound to a fixed acknowledgement catalogue')
  assert.match((await store.listConversations(user)).find(c=>c.id===priorityChat)!.messages.at(-1)!.content,/浏览一份数据运营/)
  assert.ok(priority.request_id)
  assert.ok(run.request_id)
 }finally{await h.close()}
})
