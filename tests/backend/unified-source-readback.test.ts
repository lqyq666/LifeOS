import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import {coachEventView} from '../../server/action-coach-events.ts'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {actOnGrowthItem,growthView} from '../../server/growth.ts'

test('one source catalogue survives transactional event, experience and cross-session memory readback',async()=>{
 const h=await residualHarness()
 try{
  const {user,chat}=await h.account(),text='我整理了问卷数据的三列，但没有做分析。'
  const run=await h.execute(user,chat,text,{event:{target:{operation:'create',title:'问卷整理',source:{clauseId:'c0'}},factRefs:[0]},growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'}}]})
  const eventId=(await pool.query('SELECT id FROM coach_events WHERE user_id=$1',[user])).rows[0].id
  const event=(await coachEventView(user,chat,eventId))!
  const fact=event.nodes.find(node=>node.kind==='fact')!
  const experience=(await store.listExperiences(user))[0]!
  assert.equal(fact.source?.quote,'我整理了问卷数据的三列')
  assert.ok(experience.source_quote.includes(fact.source!.quote))
  const growth=(await pool.query("SELECT text FROM growth_items WHERE user_id=$1 AND assertion='user_reported' AND status='active'",[user])).rows
  assert.ok(growth.some(row=>row.text===fact.source!.quote))
  const graph=await store.cognitionGraph(user)
  assert.ok(!graph.nodes.some(node=>node.label==='数据分析'))
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role=$3',[user,run.request_id,'assistant'])).rows[0].n,1)
  const second=randomUUID();await store.createConversation(user,{id:second,title:'SYNTHETIC unified fact readback'})
  await h.execute(user,second,'接着之前的问卷整理，只回读已做和未做的部分。')
  assert.ok(h.requests.at(-1).messages.some((message:any)=>message.role==='user'&&message.content.includes(fact.source!.quote)))
  const schema=h.requests[0].response_format.json_schema.schema
  const target=schema.properties.event.properties.target
  assert.deepEqual(Object.keys((target.anyOf?.[0]??target).properties.source.properties),['clauseId'])
  const blocked=await h.account()
  await h.execute(blocked.user,blocked.chat,'我打印了材料。请只按上述条件回答。',{event:{target:{operation:'create',title:'打印材料',source:{clauseId:'c0'}},factRefs:[0]},growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c1'}}]})
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM coach_nodes WHERE user_id=$1 AND content LIKE '%请只按%'",[blocked.user])).rows[0].n,0,'a rejected canonical fact must not survive through its event reference')
  const complete=await h.account(),realIssue='我是21岁的大三数学专业学生。我会用Excel。现在我想核对已保存的考研资料，今天我只有十分钟，没法联网。请先帮我选一个今天能开始的小步骤。'
  await h.execute(complete.user,complete.chat,realIssue,{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c0'}},{target:{operation:'create'},assertion:'user_reported',kind:'ability',source:{clauseId:'c1'}},{target:{operation:'create'},assertion:'user_reported',kind:'goal',source:{clauseId:'c2'}}],event:{target:{operation:'create',title:'核对考研资料',source:{clauseId:'c2'}},factRefs:[0,1,2]}},'在Excel写下一份本地资料的名称，到这里停；先确认能找到它，效果仍未知。')
  const supplied=JSON.parse(h.requests.at(-1).messages.find((message:any)=>message.role==='user').content),context=supplied.authorizedContext??supplied
  assert.equal(context.currentTask.responseScope.actionLimit,1,'the actual mixed-message request uses the same single-step scope')
  const completeFacts=(await growthView(complete.user)).items
  for(const text of ['我是21岁的大三数学专业学生','我会用Excel','现在我想核对已保存的考研资料'])assert.ok(completeFacts.some(fact=>fact.text===text&&!fact.unavailableReason),text)
  assert.ok(await coachEventView(complete.user,complete.chat))
  const initialMatter=(await coachEventView(complete.user,complete.chat))!,feedback='实际反馈：我只做了四分钟，只把已保存资料的三列标题核对完了，没有分析；结果并没有帮我决定考研还是就业。我今天剩余时间为零，下一步先暂停。请据此调整理解，不要推断我没能力。',actualAction='只把已保存资料的三列标题核对完了'
  await h.execute(complete.user,complete.chat,feedback,{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c0'}},{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c1'},contribution:{actor:'self',actionQuote:actualAction,resultRef:2}},{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c3'}}],event:{target:{operation:'continue',eventId:initialMatter.id,expectedRevision:initialMatter.revision},factRefs:[0,1,2]}},'新增事实是只核对了三列标题，尚未做分析；这次结果未帮助选择方向，不支持能力不足的判断。哪些信息能改变方向判断仍未知，今天剩余时间为零，先暂停。')
  assert.ok((await store.listExperiences(complete.user)).some(item=>item.status==='candidate'&&item.content.action===''&&item.content.summary.includes(actualAction)),'the real feedback header and omitted subject reach a labelled unconfirmed record')
  assert.ok(!(await store.cognitionGraph(complete.user)).nodes.some(node=>node.label==='数据分析'))
  assert.ok((await growthView(complete.user)).items.some(fact=>fact.text==='我会用Excel'&&!fact.unavailableReason))
  const feedbackChat=randomUUID();await store.createConversation(complete.user,{id:feedbackChat,title:'SYNTHETIC prefixed feedback readback'})
  await h.execute(complete.user,feedbackChat,'只回读上次核对标题的实际反馈，先不安排动作。')
  assert.ok(h.requests.at(-1).messages.some((message:any)=>message.role==='user'&&message.content.includes(actualAction)))
  for(const request of ['请先帮我选一个今天能开始的小步骤','请你先帮我选一个今天能开始的小步骤','请问你能帮我选一个今天能开始的小步骤','可以请你先帮我选一个今天能开始的小步骤','请问：你能帮我选一个今天能开始的小步骤']){  const addressed=await h.account()
  await h.execute(addressed.user,addressed.chat,'我想核对已保存的考研资料。我会用Excel。'+request+'。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'goal',source:{clauseId:'c0'}},{target:{operation:'create'},assertion:'user_reported',kind:'ability',source:{clauseId:'c1'}},{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'unknown',source:{clauseId:'c2'},contribution:{actor:'unknown',actionQuote:''}}],event:{target:{operation:'create',title:'资料核对',source:{clauseId:'c0'}},factRefs:[0,1,2]}},'先列出一份已保存资料的名称，到这一步停。')
  const addressedFacts=(await growthView(addressed.user)).items
  assert.ok(!addressedFacts.some(fact=>fact.text===request),'the actual addressed-request failure cannot persist as a feedback fact')
  assert.ok(addressedFacts.some(fact=>fact.text==='我会用Excel'&&!fact.unavailableReason))
  assert.ok(addressedFacts.some(fact=>fact.kind==='goal'&&fact.text==='我想核对已保存的考研资料'&&!fact.unavailableReason),'request filtering preserves the independent goal')
  assert.ok(!(await coachEventView(addressed.user,addressed.chat))!.nodes.some(node=>node.content===request),'a rejected request cannot survive as an event projection')
  }
  for(const reportedRequest of ['请你先帮我这句话是我昨天对学长说的','能帮我做实验的同学已经找到了','可以帮我审稿的老师已经回复了','你帮我联系的老师已经回复了','你帮我联系的老师回复了','帮我做实验的同学已经找到了','你给我的建议很有用','你给我的步骤我已经做完了','请问你给我的步骤我已经做完了','麻烦你帮我联系的老师回复了','麻烦你帮我联系的老师已回复','麻烦你帮我联系的老师回复过','麻烦你帮我联系的老师已回信','帮我的同学已经到了']){
  const reported=await h.account()
  await h.execute(reported.user,reported.chat,reportedRequest+'。我会用Excel。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c0'}},{target:{operation:'create'},assertion:'user_reported',kind:'ability',source:{clauseId:'c1'}}],event:{target:{operation:'create',title:'与学长沟通',source:{clauseId:'c0'}},factRefs:[0,1]}})
  assert.ok((await growthView(reported.user)).items.some(fact=>fact.text===reportedRequest&&!fact.unavailableReason),'a past report of a request retains its own evidence')
  assert.ok((await coachEventView(reported.user,reported.chat))!.nodes.some(node=>node.content===reportedRequest))
  }
  const corrected=await h.account()
  await h.execute(corrected.user,corrected.chat,'我决定考研。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'goal',source:{clauseId:'c0'}}],event:{target:{operation:'create',title:'方向选择',source:{clauseId:'c0'}},factRefs:[0]}})
  const goal=(await pool.query("SELECT id FROM growth_items WHERE user_id=$1 AND kind='goal' AND status='active'",[corrected.user])).rows[0],before=(await coachEventView(corrected.user,corrected.chat))!
  await h.execute(corrected.user,corrected.chat,'我改主意了。现在想先就业。',{growthUpdates:[{target:{operation:'correct',itemId:goal.id},assertion:'user_reported',kind:'goal',source:{clauseId:'c0'}}],event:{target:{operation:'continue',eventId:before.id,expectedRevision:before.revision},factRefs:[0]}},'目前以你新选择的就业方向为依据，具体条件仍待补齐。')
  const rebound=(await coachEventView(corrected.user,corrected.chat,before.id))!
  assert.ok(rebound.nodes.some(node=>node.kind==='fact'&&node.content==='现在想先就业'),'fact projections follow the authoritative retargeted source')
  assert.ok(!rebound.nodes.some(node=>node.kind==='fact'&&node.content==='我改主意了'),'the original marker is not the accepted corrected fact')
  const rangeTitle=await h.account()
  await h.execute(rangeTitle.user,rangeTitle.chat,'结果未知。结果未知。',{growthUpdates:['c0','c1'].map(clauseId=>({target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId}})),event:{target:{operation:'create',title:'第二次结果核对',source:{clauseId:'c1'}},factRefs:[1]}})
  const rangeEvent=(await coachEventView(rangeTitle.user,rangeTitle.chat))!
  const first=(await pool.query("SELECT id,revision FROM growth_items WHERE user_id=$1 ORDER BY (sources#>>'{0,range,start}')::int",[rangeTitle.user])).rows[0]
  await actOnGrowthItem(rangeTitle.user,first.id,{requestId:randomUUID(),expectedRevision:first.revision,action:'forget'})
  const independent=(await coachEventView(rangeTitle.user,rangeTitle.chat,rangeEvent.id))!
  assert.equal(independent.title,'第二次结果核对','a scoped withdrawal outside the title citation cannot neutralize the independent title')
  assert.ok(independent.nodes.some(node=>node.content==='结果未知'))
  const beforeChoice=h.requests.length
  await h.execute(rangeTitle.user,rangeTitle.chat,'我接受这个步骤。我接受这个步骤。')
  assert.equal(h.requests.length-beforeChoice,1,'repeated explicit choice uses server clause identity without a repair call')
  assert.equal((await coachEventView(rangeTitle.user,rangeTitle.chat,rangeEvent.id))!.matterProgress!.choice,'accepted')
 }finally{await h.close()}
})
