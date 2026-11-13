import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {planExplicitCorrection} from '../../server/turn-obligations.ts'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'
import {stageGrowthUpdates,growthView} from '../../server/growth.ts'
import {buildClauseCatalogue} from '../../server/clause-catalogue.ts'
import {resolveGrowthDeltas} from '../../server/growth-authority.ts'

const correction='更正我之前的背景：不是统计学，我学的是信息管理。只有专业这一项说错，Excel经历、两次没有按时提交和岗位核对没执行等事实不变。请更新相关理解，别从专业改口推出能力变化。'
test('a major correction targets the named profile field, not a recent unchanged action',()=>{
 const profile=randomUUID(),feedback=randomUUID()
 const plan=planExplicitCorrection(correction,[
  {id:feedback,revision:1,kind:'feedback',assertion:'user_reported',text:'岗位核对这一步我还没有开始'},
  {id:profile,revision:1,kind:'context',assertion:'user_reported',text:'我是20岁的统计学大二学生'},
 ])
 assert.equal(plan?.target?.itemId,profile)
 assert.equal(plan?.newQuote,'我学的是信息管理')
 assert.equal(plan?.target?.beforeQuote,'统计学')
 const originals=[{id:profile,revision:1,kind:'context' as const,assertion:'user_reported',text:'我是20岁的统计学大二学生'}]
 assert.equal(planExplicitCorrection('更正室友的背景：不是统计学，我学的是信息管理。',originals)?.target,undefined,'another person is not permission to amend this profile')
 assert.equal(planExplicitCorrection(correction,[...originals,{...originals[0]!,id:randomUUID()}])?.target,undefined,'ambiguous old records are not silently selected')
 for(const text of ['更正我之前的背景：不是统计学，我学的是信息管理并删除年龄。','更正我之前的背景：不是统计学，我确切学的是信息管理。'])assert.equal(planExplicitCorrection(text,originals)?.target,undefined,text)
 assert.equal(planExplicitCorrection('更正我之前的背景：不是四川人，我学的是信息管理。',[{...originals[0]!,text:'我是20岁的四川人大二学生'}])?.target,undefined,'an identity substring is not itself evidence of a major')
 assert.equal(planExplicitCorrection('更正我的专业：不是统计学，我其实学的是信息管理。',originals)?.target?.beforeQuote,'统计学')
 assert.equal(planExplicitCorrection('更正一下我的室友的背景：不是统计学，我学的是信息管理。',originals)?.target,undefined)
 assert.equal(planExplicitCorrection('更正一下：我不是统计学，我学的是信息管理。',originals)?.target?.itemId,profile)
 assert.equal(planExplicitCorrection('更正我之前的背景：不是休学，我学的是信息管理。只有专业这一项说错。',[{...originals[0]!,text:'我是20岁的休学大二学生'}])?.target,undefined)
 for(const value of ['今天不想上课','信息管理专业的大二学生'])assert.equal(planExplicitCorrection('更正我的专业：不是统计学，我学的是'+value+'。',originals)?.target,undefined)
 assert.equal(planExplicitCorrection('更正我的专业：不是四川人，我学的是信息管理。只有专业这一项说错。',[{...originals[0]!,text:'我是20岁的四川人大二学生'}])?.target,undefined)
 assert.equal(planExplicitCorrection('更正一下：我不是党员。',[{...originals[0]!,text:'我是党员'}])?.newQuote,'我不是党员','an intentionally negative replacement is still a fact')
 assert.equal(planExplicitCorrection('更正我之前提到的张三的专业：不是统计学。',[{...originals[0]!,text:'我学的是统计学'}]),null)
 for(const text of ['更正一下我弟弟的背景，不是统计学，我学的是信息管理。','更正我的专业，原来不是统计学，我学的是信息管理。'])assert.equal(planExplicitCorrection(text,[{...originals[0]!,text:'我学的是统计学'}]),null)
 for(const text of ['如果我更正背景：不是统计学，我学的是信息管理。','室友说更正背景：不是统计学，我学的是信息管理。','请回读已经更正后的背景，不修改资料。'])assert.equal(planExplicitCorrection(text,[]),null,text)
 const catalogue=buildClauseCatalogue(correction),marker=catalogue.find(x=>x.text.includes('更正'))!,affirmative=catalogue.find(x=>x.text==='我学的是信息管理')!
 const pair=[{target:{operation:'correct' as const,itemId:profile},kind:'context' as const,assertion:'user_reported' as const,source:{clauseId:marker.clauseId}},{target:{operation:'create' as const},kind:'ability' as const,assertion:'user_reported' as const,text:'信息管理',source:{clauseId:affirmative.clauseId}}]
 for(const deltas of [pair,[...pair].reverse()]){
  const result=resolveGrowthDeltas({deltas,currentMessageId:randomUUID(),currentText:correction,catalogue,authorized:originals.map(x=>({...x,unavailableReason:null,status:'active'})),correctionPlan:planExplicitCorrection(correction,originals),controlClauseTexts:[]})
  assert.equal(result.deltas.length,1,'marker and affirmative are one correction, regardless of model order')
  assert.equal(result.deltas[0]!.target.operation,'amend');assert.equal(result.deltas[0]!.kind,'context')
  assert.equal(result.deltas[0]!.source.quote,'我学的是信息管理')
 }
 const withPreference=correction+'我喜欢跑步。',fullCatalogue=buildClauseCatalogue(withPreference),preference=fullCatalogue.find(x=>x.text==='我喜欢跑步')!
 const wronglyTargeted=[{target:{operation:'correct' as const,itemId:profile},kind:'preference' as const,assertion:'user_reported' as const,source:{clauseId:preference.clauseId}},pair[1]!]
 for(const deltas of [wronglyTargeted,[...wronglyTargeted].reverse()]){
  const result=resolveGrowthDeltas({deltas,currentMessageId:randomUUID(),currentText:withPreference,catalogue:fullCatalogue,authorized:originals.map(x=>({...x,unavailableReason:null,status:'active'})),correctionPlan:planExplicitCorrection(withPreference,originals),controlClauseTexts:[]})
  assert.equal(result.deltas.length,2)
  assert.ok(result.deltas.some(x=>x.target.operation==='create'&&x.kind==='preference'&&x.source.quote==='我喜欢跑步'))
  assert.equal(result.deltas.filter(x=>x.target.operation==='amend'&&x.source.quote==='我学的是信息管理').length,1)
 }
})

test('a field correction retains age, grade and unrelated feedback through storage and the next session',async()=>{
 const h=await residualHarness()
 try{
  const {user,chat}=await h.account(),text='我是20岁的统计学大二学生。会用Excel。岗位核对这一步我还没有开始。'
  const run=(await store.startRun(user,chat,randomUUID(),text)).run
  const staged:store.Staged={candidates:[],audit:[]}
  staged.growth=await stageGrowthUpdates(run,[
   {target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:run.source_message_id,quote:'我是20岁的统计学大二学生'}},
   {target:{operation:'create'},kind:'ability',assertion:'user_reported',source:{messageId:run.source_message_id,quote:'会用Excel'}},
   {target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'unattempted',source:{messageId:run.source_message_id,quote:'岗位核对这一步我还没有开始'}},
  ],[])
  await store.finishRun(run,staged,'已记录本人报告。',null,new AbortController().signal)
  const before=(await growthView(user)).items,profile=before.find(x=>x.text==='我是20岁的统计学大二学生')!
  const badChat=randomUUID();await store.createConversation(user,{id:badChat,title:'未授权字段替换对照'})
  const bad=(await store.startRun(user,badChat,randomUUID(),'我学的是信息管理。')).run
  await assert.rejects(()=>stageGrowthUpdates(bad,[{target:{operation:'amend',itemId:profile.id,expectedRevision:profile.revision,beforeQuote:'统计学',field:'education.major'},kind:'context',assertion:'user_reported',source:{messageId:bad.source_message_id,quote:'信息管理'}}],before),/GROWTH_FIELD_CORRECTION_INVALID/)
  await store.terminateRun(user,bad.request_id,'cancelled','SYNTHETIC_FIELD_AUTHORITY_CONTROL')
  const next=randomUUID();await store.createConversation(user,{id:next,title:'局部背景更正'})
  await h.execute(user,next,correction,{growthUpdates:[{target:{operation:'correct',itemId:profile.id},kind:'context',assertion:'user_reported',text:'信息管理',source:{clauseId:'c1'}}]},'专业更正为信息管理；年龄、年级、Excel和未执行的事实保留。')
  const active=(await growthView(user)).items.filter(x=>x.status==='active'&&!x.unavailableReason)
  for(const value of ['20岁','大二学生','信息管理'])assert.ok(active.some(x=>x.text.includes(value)),value)
  assert.ok(active.some(x=>x.text==='20岁')&&active.some(x=>x.text==='大二学生'),'retained fields are coherent source spans')
  assert.ok(!active.some(x=>/我是20岁的|专业大二学生/.test(x.text)))
  assert.ok(!active.some(x=>x.text.includes('统计学')),JSON.stringify(active.map(x=>({text:x.text,kind:x.kind,status:x.status}))))
  for(const kept of before.filter(x=>x.id!==profile.id)){const now=active.find(x=>x.id===kept.id);assert.equal(now?.text,kept.text);assert.equal(now?.revision,kept.revision)}
  const later=randomUUID();await store.createConversation(user,{id:later,title:'更正后新会话'})
  await h.execute(user,later,'只根据当前资料回读我的年龄、专业和年级，不修改资料。',{},'目前资料：20岁，信息管理，大二。')
  const payload=JSON.stringify(h.requests.at(-1).messages)
  assert.ok(payload.includes('信息管理')&&payload.includes('20岁')&&payload.includes('大二'))
  assert.ok(!payload.includes('统计学'),'old major must not survive in model context')
  const major=active.find(x=>x.text.includes('信息管理'))!,again=randomUUID();await store.createConversation(user,{id:again,title:'再次局部更正'})
  await h.execute(user,again,'更正我的专业：不是信息管理，我学的是数据科学。只有专业这一项说错，年龄、年级和其他事实保留。',{growthUpdates:[{target:{operation:'correct',itemId:major.id},kind:'context',assertion:'user_reported',source:{clauseId:'c1'}}]},'专业更正为数据科学，其他事实保留。')
  const latest=(await growthView(user)).items.filter(x=>x.status==='active'&&!x.unavailableReason)
  for(const value of ['20岁','大二学生','数据科学','会用Excel','岗位核对这一步我还没有开始'])assert.ok(latest.some(x=>x.text.includes(value)),value)
  assert.ok(!latest.some(x=>x.text.includes('信息管理')||x.text.includes('统计学')),'repeated corrections do not leave a stale major active')
  const currentMajor=latest.find(x=>x.text==='我学的是数据科学')!,guardChat=randomUUID();await store.createConversation(user,{id:guardChat,title:'提交时字段重验'})
  const guarded=(await store.startRun(user,guardChat,randomUUID(),'更正我的专业：不是数据科学，我学的是信息管理。')).run
  const pending=await stageGrowthUpdates(guarded,[{target:{operation:'amend',itemId:currentMajor.id,expectedRevision:currentMajor.revision,beforeQuote:currentMajor.text,field:'education.major'},kind:'context',assertion:'user_reported',source:{messageId:guarded.source_message_id,quote:'我学的是信息管理'}}],latest)
  const prepared=pending.prepared[0]!;assert.equal(prepared.kind,'split_amend','field amendments must take the revalidated commit path even for one fragment')
  if(prepared.kind==='split_amend')prepared.field=undefined
  await assert.rejects(()=>store.finishRun(guarded,{candidates:[],audit:[],growth:pending},'不能省略字段授权。',null,new AbortController().signal),/GROWTH_FIELD_CORRECTION_INVALID/)
  if(prepared.kind==='split_amend')prepared.field='education.major'
  if(prepared.kind==='split_amend')prepared.beforeQuote='其他专业'
  await assert.rejects(()=>store.finishRun(guarded,{candidates:[],audit:[],growth:pending},'不能采纳被篡改的字段更正。',null,new AbortController().signal),/GROWTH_FIELD_CORRECTION_INVALID/)
  assert.equal((await growthView(user)).items.find(x=>x.id===currentMajor.id)?.text,currentMajor.text)
  await store.terminateRun(user,guarded.request_id,'cancelled','SYNTHETIC_COMMIT_AUTHORITY_CONTROL')
  for(const sample of [
   {prior:'我是20岁的统计学专业大二学生',message:'更正我的专业：不是统计学专业，我学的是信息管理。'},
   {prior:'我是20岁的统计学专业大二学生',message:'更正我的专业不是统计学专业，我学的是信息管理。'},
   {prior:'我是20岁的统计学大二学生',message:'更正一下：我不是统计学，我学的是信息管理。'},
  ]){
   const other=await h.account(),seed=(await store.startRun(other.user,other.chat,randomUUID(),sample.prior)).run
   const facts=await stageGrowthUpdates(seed,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:seed.source_message_id,quote:sample.prior}}],[])
   await store.finishRun(seed,{candidates:[],audit:[],growth:facts},'已记录本人原话。',null,new AbortController().signal)
   const second=randomUUID();await store.createConversation(other.user,{id:second,title:'无模型增量的字段更正'})
   await h.execute(other.user,second,sample.message,{},'专业更正为信息管理，年龄和年级保留。')
   const view=(await growthView(other.user)).items.filter(x=>x.status==='active'&&!x.unavailableReason)
   assert.deepEqual(view.map(x=>x.text).sort(),['20岁','大二学生','我学的是信息管理'].sort(),sample.message)
   for(const fact of view)assert.ok(fact.sources.some(source=>source.type==='message'&&source.quote===fact.text),'every fact retains its exact user source')
  }
  const race=await h.account(),seed=(await store.startRun(race.user,race.chat,randomUUID(),'我是20岁的统计学大二学生')).run
  await store.finishRun(seed,{candidates:[],audit:[],growth:await stageGrowthUpdates(seed,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:seed.source_message_id,quote:'我是20岁的统计学大二学生'}}],[])},'已记录。',null,new AbortController().signal)
  const snapshot=(await growthView(race.user)).items,original=snapshot[0]!,correcting=(await store.startRun(race.user,race.chat,randomUUID(),correction)).run
  const delta={target:{operation:'amend' as const,itemId:original.id,expectedRevision:original.revision,beforeQuote:'统计学',field:'education.major' as const},kind:'context' as const,assertion:'user_reported' as const,source:{messageId:correcting.source_message_id,quote:'我学的是信息管理'}}
  await assert.rejects(()=>stageGrowthUpdates(correcting,[delta],[...snapshot,{...original,id:randomUUID()}]),/GROWTH_FIELD_CORRECTION_INVALID/)
  const pendingRace=await stageGrowthUpdates(correcting,[delta],snapshot)
  const concurrentChat=randomUUID();await store.createConversation(race.user,{id:concurrentChat,title:'并发新增同值来源'})
  const concurrent=(await store.startRun(race.user,concurrentChat,randomUUID(),original.text)).run
  await store.finishRun(concurrent,{candidates:[],audit:[],growth:await stageGrowthUpdates(concurrent,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:concurrent.source_message_id,quote:original.text}}],[])},'另一次原话。',null,new AbortController().signal)
  await assert.rejects(()=>store.finishRun(correcting,{candidates:[],audit:[],growth:pendingRace},'不能无歧义更正。',null,new AbortController().signal),/GROWTH_FIELD_CORRECTION_INVALID/)
  assert.equal((await growthView(race.user)).items.filter(x=>x.status==='active'&&x.text===original.text).length,2)
  await store.terminateRun(race.user,correcting.request_id,'cancelled','SYNTHETIC_AMBIGUITY_CONTROL')
  const ambiguousChat=randomUUID();await store.createConversation(race.user,{id:ambiguousChat,title:'歧义旧资料和旧版模型字段'})
  await h.execute(race.user,ambiguousChat,'更正我的专业：不是统计学，我学的是信息管理。',{growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',text:'信息管理',source:{clauseId:'c1'}}]},'这次你明确说学的是信息管理；原有重复背景尚不能确定要替换哪条。')
  const ambiguousFacts=(await growthView(race.user)).items.filter(x=>x.status==='active'&&!x.unavailableReason)
  assert.ok(ambiguousFacts.some(x=>x.text==='我学的是信息管理'),'a legacy substring is not proof that the canonical new fact was saved')
  assert.ok(!ambiguousFacts.some(x=>x.text==='信息管理'),'no extra bare substring is persisted')
  assert.equal(ambiguousFacts.filter(x=>x.text===original.text).length,2,'ambiguous originals remain unchanged')
  const mixed=await h.account(),mixedSeed=(await store.startRun(mixed.user,mixed.chat,randomUUID(),'我是20岁的统计学大二学生。我准备考研。')).run
  await store.finishRun(mixedSeed,{candidates:[],audit:[],growth:await stageGrowthUpdates(mixedSeed,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:mixedSeed.source_message_id,quote:'我是20岁的统计学大二学生'}},{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{messageId:mixedSeed.source_message_id,quote:'我准备考研'}}],[])},'已记录。',null,new AbortController().signal)
  const mixedBefore=(await growthView(mixed.user)).items,goal=mixedBefore.find(x=>x.kind==='goal')!,mixedMessage='更正我的专业：不是统计学，我学的是信息管理。另外我决定转向就业。'
  const goalClause=buildClauseCatalogue(mixedMessage).find(x=>x.text.includes('转向就业'))!
  await h.execute(mixed.user,mixed.chat,mixedMessage,{growthUpdates:[{target:{operation:'correct',itemId:goal.id},kind:'goal',assertion:'user_reported',source:{clauseId:goalClause.clauseId}}]},'专业按信息管理理解，方向改为就业；20岁、大二仍保留。')
  const mixedAfter=(await growthView(mixed.user)).items.filter(x=>x.status==='active'&&!x.unavailableReason)
  assert.ok(mixedAfter.some(x=>x.id===goal.id&&x.text.includes('就业')),'independent goal change remains effective')
  assert.ok(mixedAfter.some(x=>x.text==='我学的是信息管理')&&!mixedAfter.some(x=>x.text.includes('统计学')),'another mutation cannot satisfy the major correction')
 }finally{await h.close()}
})
