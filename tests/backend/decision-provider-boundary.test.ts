import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'
import {stageCoachEvent} from '../../server/action-coach-events.ts'
import {pool} from '../../server/db.ts'
import {mainCompanionPolicy} from '../../server/companion-policy.ts'

test('time-only follow-up receives the prior ceiling meanings and supported native schema at the final provider boundary',async()=>{
 const h=await residualHarness()
 try{
  const {user,chat}=await h.account()
  const facts=[
   {title:'合作文档权限',quotes:['我已经接受合作文档权限检查和修改，但还没有执行。','合作文档权限需要联网修改，只同意小陈账号查看，不同意公开链接。']},
   {title:'课程报告',quotes:['我已经接受课程报告图表说明补充，但还没有执行。','课程报告的本地文档可以离线打开。']},
  ]
  for(const item of facts){
   const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:item.title})
   const run=(await store.startRun(user,conversation,randomUUID(),item.quotes.join(''))).run
   const coach=await stageCoachEvent(run,{target:{operation:'create',title:item.title,source:{messageId:run.source_message_id,quote:item.quotes[0]}},nodes:item.quotes.map(quote=>({kind:'fact',source:{messageId:run.source_message_id,quote}}))},'本地合成来源。')
   await store.finishRun(run,{candidates:[],audit:[],coach},'本地合成来源。',null,new AbortController().signal)
  }
  await h.execute(user,chat,'我有60分钟，精力充足，电脑网络可用。请比较手头这些事的优先级，只讨论取舍，不修改资料、记忆或任务。',{},'先做合作文档权限，课程报告后排。')
  const follow=await h.execute(user,chat,'那如果我只剩2分钟呢？只改变可用时间，其余沿用刚才真实基线。',{},'课程报告本次最多投入两分钟，合作文档权限本轮暂不分配时间。')
  const p=h.requests.at(-1),schema=p.response_format.json_schema.schema
  assert.equal(Object.keys(schema.properties)[0],'decisionProposal','revert the failed reply-first experiment while keeping the smaller proposal')
  const unsupported:string[]=[]
  const walk=(node:any,path:string)=>{if(!node||typeof node!=='object')return;for(const [k,v] of Object.entries(node)){if(['contains','minContains','maxContains','uniqueItems','additionalItems'].includes(k))unsupported.push(path+'.'+k);walk(v,path+'.'+k)}}
  walk(schema,'schema')
  assert.deepEqual(unsupported,[])
  assert.equal(p.max_tokens??p.max_completion_tokens,8192)
  assert.equal(schema.properties.reply.maxLength,16000)
  for(const key of ['pattern','enum','allOf'])assert.equal(schema.properties.reply[key],undefined)
  const metadata=p.messages.flatMap((m:any)=>{if(m.role!=='user')return [];try{return [JSON.parse(m.content)]}catch{return []}}).find((m:any)=>m.decisionPlanContract)
  assert.ok(p.messages.find((m:any)=>m.role==='system').content.length<15000,'closed interview lanes should not dominate a read-only comparison')
  assert.ok(p.messages.some((m:any)=>m.role==='system'&&String(m.content).includes(JSON.stringify(schema))),'restore the exact native contract after the rejected omission experiment')
  const audit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,follow.request_id])).rows[0].tool_audit
  assert.equal(audit.find((row:any)=>row.phase==='main_skill_payload').scope,'read-only-matter-decision/1')
  assert.equal(audit.some((row:any)=>row.phase==='grilling_policy_payload'),false,'do not claim the full interview policy was sent')
  assert.equal(audit.find((row:any)=>row.phase==='provider_native_contract').generationSchemaIncluded,true)
  assert.deepEqual(metadata.decisionComparison.rules,[],'system rules should reach the model once')
  assert.deepEqual(metadata.matterOverview.rules,[],'system rules should reach the model once')
  assert.ok(metadata?.decisionPlanContract)
  assert.equal(metadata.decisionPlanContract.rule,undefined,'the complete decision rule already exists in system')
  const context=metadata.decisionPlanContract
  assert.equal(context.minuteCeiling,2)
  assert.equal(context.previousProposal.items.length,2)
  for(const item of context.previousProposal.items){
   assert.equal(item.completionPromise,false)
   assert.equal(item.modeMeaning,context.modeMeanings[item.mode])
   assert.equal(item.minutesCeilingMeaning,context.minutesCeilingMeaning)
  }
  await h.execute(user,chat,'请比较我手头的任务的优先级。',{},'合作文档权限与课程报告本次按已知来源比较，尚未执行的状态保留。')
  assert.equal(h.requests.at(-1).response_format.json_schema.schema.properties.reply.pattern,undefined)
  await h.execute(user,chat,'请比较我手头所有的任务的优先级。',{},'合作文档权限与课程报告按当前来源比较，任务的原状态保留。')
  assert.equal(h.requests.at(-1).response_format.json_schema.schema.properties.reply.pattern,undefined)
  await h.execute(user,chat,'请比较一下我手头所有的任务的优先级。',{},'先比较合作文档权限与课程报告的已知条件，当前建议仍不代表你已经执行。')
  assert.equal(h.requests.at(-1).response_format.json_schema.schema.properties.reply.pattern,undefined)
  await h.execute(user,chat,'请比较优先级，范围是我手头这些事。',{},'合作文档权限先排，课程报告随后；本轮仍只是结合当前来源的取舍建议。')
  assert.equal(h.requests.at(-1).response_format.json_schema.schema.properties.reply.pattern,undefined)
  await h.execute(user,chat,'请比较。对象是手头这些事。',{},'就合作文档权限和课程报告比较当前先后，时间条件仍按已知记录。')
  assert.equal(h.requests.at(-1).response_format.json_schema.schema.properties.reply.pattern,undefined)
  await assert.rejects(h.execute(user,chat,'请比较手头这些事的取舍。',{},'你的人生只有两种选择：合作文档权限、课程报告。'),/REPLY_COMPARISON_UNBOUNDED/)
  const unrelatedChat=randomUUID();await store.createConversation(user,{id:unrelatedChat,title:'普通学习方式比较'})
  await assert.rejects(h.execute(user,unrelatedChat,'请比较两种学习方式：读教材和看视频。',{},'可以读教材。'),/REPLY_COMPARISON_MISSING/)
  assert.ok(h.requests.at(-1).response_format.json_schema.schema.properties.reply.pattern)
  assert.equal(h.requests.at(-1).response_format.json_schema.schema.properties.decisionProposal,undefined)
  const mixedChat=randomUUID();await store.createConversation(user,{id:mixedChat,title:'事项与普通比较混合'})
  await assert.rejects(h.execute(user,mixedChat,'我手头还有课程报告。另外，请比较两种学习方式：读教材和看视频。',{},'课程报告本轮暂不推进；学习方式建议读教材。'),/REPLY_COMPARISON_MISSING/)
  assert.ok(h.requests.at(-1).response_format.json_schema.schema.properties.reply.pattern)
  assert.equal(h.requests.at(-1).response_format.json_schema.schema.properties.decisionProposal,undefined)
  const reverseChat=randomUUID();await store.createConversation(user,{id:reverseChat,title:'普通比较之后提及事项'})
  await assert.rejects(h.execute(user,reverseChat,'请比较两种学习方式：读教材和看视频。另外，我手头还有课程报告。',{},'学习方式可以读教材；课程报告是另一条本人陈述。'),/REPLY_COMPARISON_MISSING/)
  assert.equal(h.requests.at(-1).response_format.json_schema.schema.properties.decisionProposal,undefined)
  assert.ok(h.requests.at(-1).messages.some((m:any)=>m.role==='system'&&m.content.includes(mainCompanionPolicy.instructions)))
  const excludedChat=randomUUID();await store.createConversation(user,{id:excludedChat,title:'排除事项的普通比较'})
  await assert.rejects(h.execute(user,excludedChat,'请比较我手头课程报告之外的两种学习方式：读教材和看视频。',{},'合作文档权限和课程报告不在本次比较范围；学习方式建议读教材。'),/REPLY_COMPARISON_MISSING/)
  assert.ok(h.requests.at(-1).response_format.json_schema.schema.properties.reply.pattern)
  const ordinary=await h.account()
  const input='请比较两种学习方式：读教材和看视频。'
  await assert.rejects(h.execute(ordinary.user,ordinary.chat,input,{},'可以读教材。'),/REPLY_COMPARISON_MISSING/)
  const ordinarySchema=h.requests.at(-1).response_format.json_schema.schema
  assert.ok(ordinarySchema.properties.reply.pattern)
  assert.ok(ordinarySchema.properties.reply.allOf.length>=2)
  const emptyChat=randomUUID();await store.createConversation(ordinary.user,{id:emptyChat,title:'空事项取舍'})
  await h.execute(ordinary.user,emptyChat,'请比较手头这些事的取舍。',{},'当前没有可读的事项，尚不能据此排序。')
  assert.equal(h.requests.at(-1).response_format.json_schema.schema.properties.reply.pattern,undefined)
  assert.equal(h.requests.at(-1).response_format.json_schema.schema.properties.decisionProposal,undefined)
 }finally{await h.close()}
})
