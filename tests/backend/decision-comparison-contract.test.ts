import test from 'node:test'
import assert from 'node:assert/strict'
import {compileDecisionConditions,continuesDecisionContext,rebaseActualDecisionConditions,authorizedDecisionConditions,projectDecisionCases,validateDecisionProposal,decisionOrderRelation,bindDecisionProposalSchema,projectDecisionProposalWire,decisionProposalContract,type DecisionProposal} from '../../server/decision-comparison.ts'
import {Value} from 'typebox/value'
import {parseActionCoachTurn,actionCoachTurnSchema} from '../../server/action-coach-contracts.ts'
import {decisionComparisonActualClauses} from '../../server/user-command-spans.ts'
import {reportedActualComparisonClauses,reportedActionProgress,reportedDatedMatterChoice,projectMatterReport} from '../../server/workflows/action-review.ts'

test('model wire binds current indices without copying ids and preserves the entire reply',()=>{
 const events=[
  {id:'11111111-1111-4111-8111-111111111111',title:'权限',nodes:[{kind:'fact',status:'active',content:'必须联网修改权限，今天15点截止'}],matterProgress:{state:'unattempted'}},
  {id:'22222222-2222-4222-8222-222222222222',title:'报告',nodes:[{kind:'fact',status:'active',content:'本地报告明天18点截止'},{kind:'fact',status:'active',content:'我接受先整理两条证据'}],matterProgress:{state:'unattempted',choice:'accepted',recommendationStopped:false}},
  {id:'33333333-3333-4333-8333-333333333333',title:'竞赛',nodes:[{kind:'fact',status:'active',content:'我接受先看报名要求，但这次完全没执行'}],matterProgress:{state:'paused',choice:'accepted',recommendationStopped:true}},
 ] as any
 const conditions=compileDecisionConditions('我有60分钟，网络可用。','假设我只有2分钟，不能联网。'),cases=projectDecisionCases(events,conditions)
 const previous:DecisionProposal={items:[{eventId:events[0].id,mode:'do_now',minutesCeiling:5},{eventId:events[1].id,mode:'do_now',minutesCeiling:25},{eventId:events[2].id,mode:'leave_stopped',minutesCeiling:0}],orderRelation:'baseline'}
 const wire={items:[{allocationBasis:'relative_priority',caseIndex:1,kind:'advance',minutesCeiling:2},{allocationBasis:'known_constraint',caseIndex:0,kind:'prepare',minutesCeiling:0},{allocationBasis:'keep_paused',caseIndex:2,kind:'none',minutesCeiling:0}]}
 const reply='先做报告中一个图表的说明，最多投入2分钟；\n权限暂缓联网修改。保留“尚未完成”的事实。'
 const project=(value:unknown)=>projectDecisionProposalWire(value,cases,conditions,previous)
 const parsed=parseActionCoachTurn(JSON.stringify({reply,decisionProposal:wire}),{allowDecisionProposal:true,projectDecisionProposal:project})
 assert.equal(parsed.reply,reply)
 const aliasedCases=cases.map(item=>item.eventId===events[1].id?{...item,title:'准备课程报告'}:item)
 assert.doesNotThrow(()=>validateDecisionProposal(parsed.decisionProposal!,aliasedCases,conditions,previous,reply.replace('先做报告','先做课程报告')),'an unambiguous natural title does not discard a complete reply')
 assert.equal(parsed.decisionProposal!.items[0].eventId,events[1].id)
 assert.equal(parsed.decisionProposal!.orderRelation,'reordered')
 assert.equal(parsed.decisionProposal!.items[0].allocationBasis,'relative_priority')
 const withBasis:DecisionProposal['items']=previous.items.map(x=>({...x,allocationBasis:x.mode==='leave_stopped'?'keep_paused':'relative_priority'}))
 assert.equal(decisionOrderRelation(withBasis,previous),'same_order','legacy unknown basis must not be reported as a change')
 assert.equal(decisionOrderRelation(withBasis.map((x,i)=>i===0?{...x,allocationBasis:'current_budget'}:x),{items:withBasis}),'scope_changed')
 assert.doesNotThrow(()=>validateDecisionProposal(parsed.decisionProposal!,cases,conditions,previous,reply+'英文例句 The bus stopped；数学概念 basis 仍可正常讨论。'))
 assert.throws(()=>project({items:wire.items.map(x=>x.caseIndex===1?{...x,allocationBasis:'known_constraint'}:x)}),/DECISION_ALLOCATION_BASIS_INVALID/)
 assert.throws(()=>project({items:wire.items.map(x=>x.caseIndex===2?{...x,allocationBasis:'relative_priority'}:x)}),/DECISION_ALLOCATION_BASIS_INVALID/)
 const preparation=project({items:wire.items.map(x=>x.caseIndex===1?{...x,kind:'prepare'}:x)}) as DecisionProposal
 assert.equal(preparation.items[0].mode,'prepare_only');assert.doesNotThrow(()=>validateDecisionProposal(preparation,cases,conditions,previous,reply))
 assert.doesNotThrow(()=>validateDecisionProposal(parsed.decisionProposal!,cases,conditions,previous,reply))
 assert.throws(()=>validateDecisionProposal(parsed.decisionProposal!,cases,conditions,previous,reply+'暂停事项：allocationBasis 为 keep_paused。'),/DECISION_INTERNAL_FIELDS_VISIBLE/)
 for(const items of [wire.items.map((x,i)=>i===0?{...x,caseIndex:99}:x),[wire.items[0],wire.items[0],wire.items[2]],wire.items.map(x=>x.caseIndex===2?{...x,minutesCeiling:1}:x),wire.items.map(x=>x.caseIndex===1?{...x,minutesCeiling:3}:x),wire.items.map(x=>x.caseIndex===1?{...x,minutesCeiling:null}:x)]){
  assert.throws(()=>{const out=parseActionCoachTurn(JSON.stringify({reply,decisionProposal:{items}}),{allowDecisionProposal:true,projectDecisionProposal:project});validateDecisionProposal(out.decisionProposal!,cases,conditions,previous,reply)})
 }
 assert.throws(()=>project({items:[{caseIndex:0,eventId:events[1].id,minutesCeiling:2}]}),/DECISION_WIRE_INVALID/)
 const legacy={...previous,items:previous.items.map((x,i)=>i===0?{...x,eventId:'44444444-4444-4444-8444-444444444444'}:x)}
 assert.throws(()=>project(legacy),/DECISION_WIRE_INVALID/)
 assert.throws(()=>project(previous),/DECISION_WIRE_INVALID/,'current generation must bind indices even when legacy IDs happen to be valid')
 assert.deepEqual(parseActionCoachTurn(JSON.stringify({reply,decisionProposal:previous}),{allowDecisionProposal:true}).decisionProposal,previous,'history parser without current wire projection retains valid legacy records')
 assert.throws(()=>validateDecisionProposal(legacy,cases,conditions,previous,reply),/DECISION_ACTION_BLOCKED/)
 const contract=decisionProposalContract(cases,conditions,previous) as any
 assert.deepEqual(contract.cases[1].matterProgress,{state:'unattempted',choice:'accepted',recommendationStopped:false})
 assert.deepEqual(contract.cases[2].matterProgress,{state:'paused',choice:'accepted',recommendationStopped:true})
 assert.ok(contract.cases[1].sourceFacts.includes('我接受先整理两条证据'))
 assert.throws(()=>validateDecisionProposal(parsed.decisionProposal!,cases,conditions,previous,reply+'竞赛的 matterProgress 为 paused。'),/DECISION_INTERNAL_FIELDS_VISIBLE/)
 assert.throws(()=>validateDecisionProposal(parsed.decisionProposal!,cases,conditions,previous,reply+'报告 state is unattempted。'),/DECISION_INTERNAL_FIELDS_VISIBLE/)
 assert.throws(()=>validateDecisionProposal(parsed.decisionProposal!,cases,conditions,previous,reply+'竞赛 choice: accepted。'),/DECISION_INTERNAL_FIELDS_VISIBLE/)
 for(const rawStatus of ['choice is accepted','state is paused','state 是 completed']){
  assert.throws(()=>validateDecisionProposal(parsed.decisionProposal!,cases,conditions,previous,reply+'状态信息 '+rawStatus+'。'),/DECISION_INTERNAL_FIELDS_VISIBLE/)
 }
 assert.doesNotThrow(()=>validateDecisionProposal(parsed.decisionProposal!,cases,conditions,previous,'The step was accepted and has not started yet. '+reply))
 assert.equal(contract.previousProposal.items[0].title,'权限');assert.equal(contract.previousProposal.items[0].priorityRank,1)
 assert.deepEqual(contract.cases.map((c:{deadlineStatus:string})=>c.deadlineStatus),['reported_date','reported_date','no_known_date'])
 assert.ok((decisionProposalContract(cases,conditions,{...previous,firstChoiceUnavailable:true}) as any).previousProposal.items.every((x:any)=>x.priorityRank===null))
 const lowEnergy={...conditions,energy:'low' as const}
 const reduced=decisionProposalContract(projectDecisionCases(events,lowEnergy),lowEnergy,previous) as any
 assert.equal(reduced.cases[1].workScope,'smallest_substep')
 assert.equal(reduced.cases[2].workScope,undefined,'a paused matter receives no proposed work')
 assert.equal(contract.cases[1].workScope,undefined,'available time alone does not impose the low-energy workload')
 assert.match(reduced.rule,/只处理原动作的第一个对象/,'send the reduced scope in the actual generation instructions')
 assert.doesNotMatch(contract.rule,/只处理原动作的第一个对象/)
 const decisionReply=bindDecisionProposalSchema(actionCoachTurnSchema,cases,lowEnergy,previous).properties.reply.description
 assert.match(decisionReply,/原总量只作已接受的背景/)
 assert.match(decisionReply,/只处理原动作的第一个对象/)
 assert.doesNotMatch(decisionReply,/时间短只缩小本次投入/)
 assert.match(decisionReply,/是否或何时恢复/)
 assert.match(decisionReply,/本人未说明时才把是否或何时恢复保留为未知/)
 assert.match(decisionReply,/缩小时只减少同一操作的工作量/)
})

test('a dated matter keeps its noun in both preparation phrasings',()=>{
 for(const task of ['我准备课程报告','我在准备课程报告']){
  const report=reportedDatedMatterChoice(task+'，截止明晚。我接受先整理两条证据这个步骤，还没开始。')
  assert.equal(report?.title,'课程报告')
  assert.equal(report?.task.text,task)
 }
})

test('trial conditions separate available time from sustained focus and restore the real baseline',()=>{
 const baseline='我这次实际有60分钟，精力充足，电脑和网络都可用，也可以联系别人。'
 assert.equal(compileDecisionConditions(baseline,'我现在不到10分钟。').minutes,null)
 assert.equal(compileDecisionConditions(baseline,'我有10分钟通勤。').minutes,60)
 assert.equal(compileDecisionConditions(baseline,'我现在只有10分钟，专门用来看视频。请重新比较之前的取舍。').minutes,60)
 for(const text of ['我没有电脑维修经验。','我没有手机信号。','我没有预算管理经验。'])assert.deepEqual(compileDecisionConditions(baseline,text).unavailableResources,[])
 assert.equal(compileDecisionConditions(baseline,'我没有网络工程经验。').network,true)
 assert.equal(compileDecisionConditions(baseline,'我没有精力管理经验。').energy,'adequate')
 assert.deepEqual(compileDecisionConditions('我没有电脑。','我有电脑维修经验。').unavailableResources,['电脑'])
 assert.notEqual(compileDecisionConditions(baseline,'我不能联系导师，但可以联系同学。').contact,false)
 const unrestricted=compileDecisionConditions(baseline,'假设我没有电脑和网络方面的限制，请重新比较之前的取舍。')
 assert.equal(unrestricted.network,null);assert.deepEqual(unrestricted.unavailableResources,[])
 assert.equal(compileDecisionConditions('我精力很低。','我现在体力已经恢复正常，请按这个条件重新比较刚才的取舍。').energy,'unknown')
 assert.equal(compileDecisionConditions('我难以连续专注超过30分钟。','假设我连续专注的上限是10分钟，请重新比较之前的取舍。').continuousMinutes,null)
 assert.equal(compileDecisionConditions('我难以连续专注超过30分钟。','我想专注处理报告，请重新比较之前的取舍。').continuousMinutes,30)
 assert.equal(compileDecisionConditions('我难以连续专注超过30分钟。','我现在没有专注限制，请重新比较之前的取舍。').continuousMinutes,null)
 assert.equal(compileDecisionConditions('我难以连续专注超过30分钟。','我现在连续专注最多10分钟，请重新比较之前的取舍。').continuousMinutes,null)
 assert.equal(continuesDecisionContext('谢谢。明白了。补充一下：我现在实际只有30分钟。'),true)
 const original=compileDecisionConditions('',baseline,undefined,{messageId:'baseline',kind:'actual'})
 const trial=compileDecisionConditions(original,'假设我只有10分钟。',original,{messageId:'trial',kind:'trial'})
 const supplemented=compileDecisionConditions(original,'我现在实际有30分钟。',undefined,{messageId:'supplement',kind:'actual'})
 assert.equal(rebaseActualDecisionConditions(trial,supplemented).minutes,10,'actual supplements do not overwrite an independent trial assumption')
 assert.equal(rebaseActualDecisionConditions(original,supplemented).minutes,30,'inherited actual fields follow their latest real source')
 const low=compileDecisionConditions(baseline,'我仍有60分钟，但假设我精力很低，很难连续专注超过3分钟。')
 assert.equal(low.minutes,60);assert.equal(low.continuousMinutes,3);assert.equal(low.energy,'low')
 const blocked=compileDecisionConditions(baseline,'仍有60分钟且精力充足，但完全不能联网，也不能发消息或打电话。')
 assert.equal(blocked.network,false);assert.equal(blocked.contact,null)
 assert.equal(reportedActionProgress('我已经完成了报告的框架','报告').state,'partial')
 assert.equal(reportedActionProgress('我已经完成了报告的框架','报告框架').state,'completed')
 assert.equal(reportedActionProgress('我已经完成了老师布置的报告','报告').state,'completed')
 assert.equal(projectMatterReport({state:'paused',choice:'declined',recommendationStopped:true} as const,{state:'accepted',choice:'accepted',resumed:false}).recommendationStopped,true)
 assert.equal(compileDecisionConditions(baseline,'取消试算，恢复真实条件。').network,true)
 assert.equal(compileDecisionConditions(baseline,'如果我只有2分钟呢？').minutes,2)
 for(const text of ['那如果我只剩下10分钟呢？','那如果我仅剩10分钟呢？'])assert.equal(compileDecisionConditions(baseline,text).minutes,10,text)
 assert.equal(compileDecisionConditions(baseline,'那如果我只有半小时呢？').minutes,30)
 assert.equal(compileDecisionConditions(baseline,'我只有一个半小时。').minutes,90)
 assert.equal(compileDecisionConditions(baseline,'我只有1小时半。').minutes,90)
 assert.equal(compileDecisionConditions(baseline,'我只有大约2小时。').minutes,null,'inexact new time must not silently remain the old exact budget')
 for(const text of ['我大概只剩10分钟呢？','我只剩10分钟左右。'])assert.equal(compileDecisionConditions(baseline,text).minutes,null)
 assert.equal(reportedActualComparisonClauses('请试算：如果我只有10分钟，重新比较之前的取舍；另外我已经完成不了报告。').length,0,'inability to finish is not a completed matter')
 assert.equal(compileDecisionConditions(baseline,'那如果我现在只能用10分钟呢？').minutes,10)
 assert.equal(compileDecisionConditions(baseline,'请按只剩10分钟重比之前的取舍。').minutes,10)
 assert.equal(compileDecisionConditions(baseline,'我手头这些事总共可用10分钟，请重新比较。').minutes,10)
 assert.equal(compileDecisionConditions(baseline,'我现在只有10分钟。不确定报告要多久，请重新比较。').minutes,10)
 const mixedCertainty=compileDecisionConditions(baseline,'我在完全不能联网的情况下大约只有10分钟。')
 assert.equal(mixedCertainty.minutes,null);assert.equal(mixedCertainty.network,false,'approximate time does not weaken an independently explicit no-network restriction')
 assert.equal(compileDecisionConditions(baseline,'如果我这次时间很紧，只够处理一件事，请重新比较。').minutes,null)
 assert.equal(compileDecisionConditions(baseline,'请重新比较：我现在只有10分钟但这说的是通勤时长，不是可用时间。').minutes,60)
 assert.equal(compileDecisionConditions(baseline,'假设导师不能联系别人，请重新比较。').contact,true)
 assert.equal(compileDecisionConditions(baseline,'请按导师不能联网的情况重新比较之前的取舍。').network,true)
 const indispensable=compileDecisionConditions(baseline,'假设我不能没有网络和电脑，请重新比较。')
 assert.notEqual(indispensable.network,false);assert.deepEqual(indispensable.unavailableResources,[])
 assert.equal(reportedActualComparisonClauses('我决定继续比较之前的报告取舍；假设我只有10分钟，请按这个条件重比。').length,0,'continuing a comparison is not resuming a paused matter')
 assert.equal(reportedActualComparisonClauses('请按10分钟继续重比；另外我现在决定接受上次试算中给出的报告步骤，作为真实安排。').length,1)
 assert.equal(compileDecisionConditions('我不能联网。','更正一下，我没说会断网，请继续重比。').network,null)
 assert.deepEqual(compileDecisionConditions(baseline,'假设导师没有电脑，请重新比较。').unavailableResources,[])
 const removed=compileDecisionConditions(baseline,'请不要沿用上次不能联网的条件，重新比较之前的取舍。')
 assert.equal(removed.network,true)
 assert.equal(compileDecisionConditions(baseline,'请不要沿用上次不能联网的条件并改成只有5分钟重比。').network,true)
 assert.equal(compileDecisionConditions(baseline,'请不要沿用上次假设，改用我只有5分钟的条件重新比较。').minutes,5)
 const actual=compileDecisionConditions('',baseline),prior=compileDecisionConditions(actual,'假设我只有2分钟，也不能联网。')
 const partlyRestored=compileDecisionConditions(prior,'请不要沿用上次不能联网的条件，重新比较之前的取舍。',actual)
 assert.equal(partlyRestored.network,true);assert.equal(partlyRestored.minutes,2,'cancelling one named trial condition preserves the other authorized assumptions')
 assert.equal(compileDecisionConditions(prior,'除网络已恢复外，其他条件不变，请重新比较。').network,true)
 for(const text of ['我可用的时间只有10分钟，请重新比较。','本次可用的时间为10分钟。'])assert.equal(compileDecisionConditions(baseline,text).minutes,10,text)
 assert.equal(compileDecisionConditions('不能联网。','我现在网络恢复了，请重新比较。').network,true)
 for(const purpose of ['玩游戏','打游戏','赶路','听音乐'])assert.equal(compileDecisionConditions(baseline,'我现在只有10分钟'+purpose+'。').minutes,60,'activity-only time is not the global budget: '+purpose)
 const delayed=compileDecisionConditions(baseline,'请重新比较：如果我只有10分钟后才能联网，优先级怎么变？')
 assert.equal(delayed.minutes,60);assert.equal(delayed.network,false)
 assert.equal(compileDecisionConditions(baseline,'请不沿用上次假设并改成只有5分钟重新比较之前的取舍。').minutes,5)
 assert.equal(compileDecisionConditions(baseline,'请重新比较之前的取舍：报告只有10分钟就能完成。').minutes,60,'item duration is not available time')
 assert.equal(compileDecisionConditions(baseline,'那如果报告只剩10分钟就截止，重新比较会怎样？').minutes,60)
 assert.equal(compileDecisionConditions(baseline,'我不是只有半小时，请重新比较之前的取舍。').minutes,60)
 assert.equal(compileDecisionConditions(baseline,'假设我现在没有时间，请重新比较之前的取舍。').minutes,0)
 assert.equal(compileDecisionConditions(baseline,'假设我没有时间限制，请重新比较之前的取舍。').minutes,null)
 for(const qualifier of ['方面的','上的']){
  const freed=compileDecisionConditions(baseline,'我现在没有时间'+qualifier+'限制，也没有网络'+qualifier+'限制，没有电脑'+qualifier+'限制。')
  assert.equal(freed.minutes,null);assert.equal(freed.network,null);assert.deepEqual(freed.unavailableResources,[])
 }
 assert.equal(compileDecisionConditions(compileDecisionConditions(baseline,'假设我不能联网。'),'之前不能联网的问题已经解决，现在可以联网，请重新比较。').network,true)
 assert.deepEqual(compileDecisionConditions('','假设我没有预算限制，请重新比较之前的取舍。').unavailableResources,[])
 assert.equal(compileDecisionConditions('','假设我没有精力限制，请重新比较。').energy,'unknown')
 assert.equal(compileDecisionConditions(baseline,'现在没网络限制，请重新比较。').network,null)
 assert.equal(compileDecisionConditions('不能联系别人。','现在没联系限制，请重新比较。').contact,null)
 const recovered=compileDecisionConditions('我精力很低，不能联网。','我现在不再疲惫，网络可以用了。')
 assert.equal(recovered.energy,'unknown');assert.equal(recovered.network,true)
 const denied=compileDecisionConditions('我不能联网，我精力很低。','我现在网络并非不可用。我的精力不是很低。')
 assert.equal(denied.network,true);assert.equal(denied.energy,'unknown')
 const noIssue=compileDecisionConditions(baseline,'我没有时间问题。我没有精力问题。我没有网络问题。我没有预算问题。')
 assert.equal(noIssue.minutes,null);assert.equal(noIssue.energy,'unknown');assert.equal(noIssue.network,null);assert.deepEqual(noIssue.unavailableResources,[])
 assert.equal(reportedActualComparisonClauses('请按10分钟试算；另外我决定不接受报告步骤。').length,1)
 const unavailable=compileDecisionConditions(baseline,'假设我现在上不了网，也没法联系任何人，请重新比较之前的取舍。')
 assert.equal(unavailable.network,false);assert.equal(unavailable.contact,false)
 for(const denial of ['不能使用网络','不能用网络','无法使用网络'])assert.equal(compileDecisionConditions(baseline,'假设我'+denial+'。').network,false)
 const uncertain=compileDecisionConditions(baseline,'我不一定能上网，也不一定可以联系导师，我不一定能用电脑。我现在不知道还有多少可用时间。')
 assert.equal(uncertain.minutes,null);assert.equal(uncertain.network,null);assert.equal(uncertain.contact,null);assert.deepEqual(uncertain.unavailableResources,[])
 const maybe=compileDecisionConditions(baseline,'我未必能上网，也未必可以联系导师。')
 assert.equal(maybe.network,null);assert.equal(maybe.contact,null)
 const unparsed=compileDecisionConditions('不能联网，我精力很低，我没有电脑。','我现在网络状态另说。我的精力情况另说。我这次电脑的情况另说。')
 assert.equal(unparsed.network,null);assert.equal(unparsed.energy,'unknown');assert.deepEqual(unparsed.unavailableResources,[],'unparsed new owned conditions do not silently retain old known constraints')
 assert.deepEqual(compileDecisionConditions('我有电脑。','现在没电脑限制，请重新比较。').unavailableResources,[])
 assert.deepEqual(compileDecisionConditions('','假设我没有电脑限制，请重新比较。').unavailableResources,[])
 const earlier=compileDecisionConditions(baseline,'那如果我只剩10分钟呢？'),continued=compileDecisionConditions(earlier,'我精力很低。')
 assert.equal(continued.minutes,10)
 assert.equal(authorizedDecisionConditions(continued,['我精力很低。']).minutes,null,'unavailable assumption source becomes unknown instead of resurrecting it from run audit')
 assert.equal(authorizedDecisionConditions(earlier,['同学说“那如果我只剩10分钟呢”，这不是我的情况。']).minutes,null,'quoted or attributed recurrence does not re-authorize a missing personal source')
 const device=authorizedDecisionConditions(compileDecisionConditions('','假设我没有电脑。'),[])
 assert.deepEqual(device.unavailableResources,[]);assert.equal(device.sources.电脑,undefined,'withheld source prose must not survive value sanitization')
})

test('proposal validation checks actual before/after order, feasible actions, budgets and unsupported claims',()=>{
 const events=[
  {id:'11111111-1111-4111-8111-111111111111',title:'权限',nodes:[{kind:'fact',status:'active',content:'我能直接修改在线文档权限，小陈需要今晚23点50分前获得查看权限'}],matterProgress:{state:'unattempted'}},
  {id:'22222222-2222-4222-8222-222222222222',title:'报告',nodes:[{kind:'fact',status:'active',content:'报告明晚18点截止，本地已有文档，离线可打开'}],matterProgress:{state:'unattempted'}},
 ] as any
 const conditions=compileDecisionConditions('我有60分钟，网络可用。','如果我完全不能联网呢？'),projection=projectDecisionCases(events,conditions)
 const waiting=projectDecisionCases([{...events[1],matterProgress:{state:'waiting_result'}}],conditions)[0]
 assert.deepEqual(waiting.externalResult,{status:'pending',independentPreparation:'not_assessed'},'waiting preserves the separate unknown about autonomous preparation')
 assert.equal(waiting.completionGuarantee,'not_established','minute allocation never establishes the completion time')
 assert.ok(waiting.allowedModes.includes('prepare_only'))
 const previous:Pick<DecisionProposal,'items'>={items:[{eventId:events[0].id,mode:'do_now',minutesCeiling:5},{eventId:events[1].id,mode:'do_now',minutesCeiling:25}]}
 const current:DecisionProposal={items:[{eventId:events[1].id,mode:'do_now',minutesCeiling:25},{eventId:events[0].id,mode:'wait',minutesCeiling:0}],orderRelation:'reordered',changeExplanation:'本轮优先：报告。上次优先：权限。断网后先做离线报告。',stableExplanation:'权限的原截止仍在。'}
 const reply=current.changeExplanation!+current.stableExplanation!
 assert.doesNotThrow(()=>validateDecisionProposal(current,projection,conditions,previous,reply))
 assert.doesNotThrow(()=>validateDecisionProposal({items:current.items,orderRelation:current.orderRelation},projection,conditions,previous,'现在先做报告；权限暂缓，原因是目前不能联网。原来的截止和其他未知保持不变。'),'valid full natural prose does not need duplicated private text or a fixed heading')
 assert.doesNotThrow(()=>validateDecisionProposal({items:current.items,orderRelation:current.orderRelation},[projection[0],{...projection[1],title:'修复 eventId 校验'}],conditions,previous,'现在先做修复 eventId 校验；权限等待联网，其他未知保持。'),'owned technical matter titles are not forbidden internal fields')
 assert.throws(()=>validateDecisionProposal(current,projection,conditions,previous,reply+'你目前处于“waiting_result”状态。'),/DECISION_INTERNAL_FIELDS_VISIBLE/)
 assert.doesNotThrow(()=>validateDecisionProposal({items:current.items,orderRelation:current.orderRelation},[projection[0],{...projection[1],title:'修复 waiting_result 展示'}],conditions,previous,'先处理修复 waiting_result 展示；权限等待联网。'),'an explicitly owned technical title remains readable')
 const codeTitle=[projection[0],{...projection[1],title:'waiting_result'}]
 assert.throws(()=>validateDecisionProposal({items:current.items,orderRelation:current.orderRelation},codeTitle,conditions,previous,'先处理 waiting_result；权限等待联网，你目前处于 waiting_result 状态。'),/DECISION_INTERNAL_FIELDS_VISIBLE/)
 assert.doesNotThrow(()=>validateDecisionProposal({items:current.items,orderRelation:current.orderRelation},codeTitle,conditions,previous,'先处理《waiting_result》；权限等待联网。'),'a title identical to a machine token must be visibly identified as a title')
 assert.throws(()=>validateDecisionProposal({...current,orderRelation:'same_order'},projection,conditions,previous,reply),/DECISION_ORDER_MISMATCH/)
 assert.throws(()=>validateDecisionProposal({...current,items:[{...current.items[0],minutesCeiling:61},current.items[1]]},projection,conditions,previous,reply),/DECISION_BUDGET_EXCEEDED/)
 assert.throws(()=>validateDecisionProposal({...current,items:[current.items[0],{...current.items[1],mode:'do_now',minutesCeiling:1}]},projection,conditions,previous,reply),/DECISION_ACTION_BLOCKED/)
 assert.throws(()=>validateDecisionProposal(current,projection,conditions,previous,reply+'2分钟无法有效起步。'),/DECISION_UNSUPPORTED_TIME_IMPOSSIBILITY/)
 assert.throws(()=>validateDecisionProposal(current,projection,conditions,previous,reply+'2 分钟无法有效起步这段工作。'),/DECISION_UNSUPPORTED_TIME_IMPOSSIBILITY/)
 assert.throws(()=>validateDecisionProposal(current,projection,conditions,previous,reply+'2分钟不足以开始一段图表说明的实质写作。'),/DECISION_UNSUPPORTED_TIME_IMPOSSIBILITY/)
 assert.throws(()=>validateDecisionProposal(current,projection,conditions,previous,reply+'不是不能推进，而是2分钟不足以开始一段图表说明的实质写作。'),/DECISION_UNSUPPORTED_TIME_IMPOSSIBILITY/)
 assert.throws(()=>validateDecisionProposal(current,projection,conditions,previous,reply+'权限从'),/DECISION_REPLY_INCOMPLETE/)
 assert.throws(()=>validateDecisionProposal(current,projection,conditions,previous,reply+'权限从|'),/DECISION_REPLY_INCOMPLETE/)
 assert.doesNotThrow(()=>validateDecisionProposal(current,projection,conditions,previous,reply+'2分钟不够完成整个报告，但可以核对一个图表。'))
 assert.throws(()=>validateDecisionProposal(current,projection,conditions,previous,reply+'没有新的自主动作可推进。'),/DECISION_UNSUPPORTED_NO_ACTION/)
 assert.doesNotThrow(()=>validateDecisionProposal(current,projection,conditions,previous,reply+'不能断言2分钟无法有效起步。等待不等于没有新的自主动作。'))
 assert.ok(projectDecisionCases(events,compileDecisionConditions('','我只有0分钟。')).every(x=>x.allowedModes.every(m=>m==='wait')))
 const unknown=compileDecisionConditions('','时间还不确定。'),unknownCases=projectDecisionCases(events,unknown),unbounded={...current,items:[{...current.items[0],minutesCeiling:null},current.items[1]]}
 assert.doesNotThrow(()=>validateDecisionProposal(unbounded,unknownCases,unknown,previous,reply))
 assert.throws(()=>validateDecisionProposal({...unbounded,items:[{...current.items[0],minutesCeiling:600},current.items[1]]},unknownCases,unknown,previous,reply),/DECISION_BUDGET_EXCEEDED/)
 assert.equal(Object.hasOwn(actionCoachTurnSchema.properties,'decisionProposal'),false,'new turn business fields do not rewrite the established core capability contract')
 assert.throws(()=>parseActionCoachTurn({reply,decisionProposal:current} as any))
 assert.deepEqual(parseActionCoachTurn(JSON.stringify({reply,decisionProposal:current}),{allowDecisionProposal:true}).decisionProposal,current)
 assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply,decisionProposal:current})))
})

test('explicit unavailable resources and ordinary indirect contact verbs constrain the proposal',()=>{
 const events=[{id:'11111111-1111-4111-8111-111111111111',title:'软件',nodes:[{kind:'fact',status:'active',content:'必须使用电脑运行本地软件'}],matterProgress:{state:'unattempted'}},{id:'22222222-2222-4222-8222-222222222222',title:'导师',nodes:[{kind:'fact',status:'active',content:'下一步给导师发邮件确认截止时间'}],matterProgress:{state:'unattempted'}}] as any
 const conditions=compileDecisionConditions('我有60分钟，也可以联系别人。','假设我没有电脑，也不能联系任何人。')
 assert.deepEqual(conditions.unavailableResources,['电脑']);assert.equal(conditions.contact,false)
 const cases=projectDecisionCases(events,conditions)
 for(const content of ['同学说“这个任务必须联网、必须使用电脑”，但那是他的任务；我的事项只需离线整理。','```必须联网，必须使用电脑```；我的事项只需离线整理。']){
  const own=projectDecisionCases([{...events[0],nodes:[{kind:'fact',status:'active',content}]}],{...conditions,network:false})[0]
  assert.equal(own.networkBlocked,false);assert.deepEqual(own.blockedResources,[])
 }
 assert.ok(cases.every(c=>!c.allowedModes.includes('do_now')));assert.deepEqual(cases[0].blockedResources,['电脑']);assert.equal(cases[1].contactBlocked,true)
 const independent=projectDecisionCases([{...events[1],nodes:[{kind:'fact',status:'active',content:'我可以不联系导师，直接提交本地报告'}]}],conditions)
 for(const device of ['打印机','服务器','本地设备'])assert.equal(projectDecisionCases([{...events[1],nodes:[{kind:'fact',status:'active',content:'下一步把文件发送给'+device}]}],conditions)[0].contactBlocked,false)
 assert.ok(independent[0].allowedModes.includes('do_now'))
 assert.equal(compileDecisionConditions('我可以联系别人。','禁止外部联系。').contact,false)
 assert.equal(compileDecisionConditions('我可以联系别人。','那如果我不能催促对方呢？').contact,null)
 assert.equal(compileDecisionConditions('','假设我不能和导师联系。').contact,null)
 assert.equal(compileDecisionConditions('我网络可用。','假设我没有网络，请重新比较之前的取舍。').network,false)
 const free=compileDecisionConditions(compileDecisionConditions('','我不能联网，也不能联系任何人。'),'现在没有网络限制，也没有联系限制，请重新比较。')
 assert.equal(free.network,null);assert.equal(free.contact,null)
 assert.ok(projectDecisionCases([{...events[1],nodes:[{kind:'fact',status:'active',content:'下一步把本地报告发送到自己的打印机。'}]}],conditions)[0].allowedModes.includes('do_now'))
 assert.ok(!projectDecisionCases([{...events[1],nodes:[{kind:'fact',status:'active',content:'下一步需要联网查资料'}]}],compileDecisionConditions('','假设我不能联网。'))[0].allowedModes.includes('do_now'))
 assert.equal(compileDecisionConditions(compileDecisionConditions('','假设我不能给老师发消息。'),'现在可以给老师发消息了，请重新比较。').contact,true)
 assert.equal(decisionComparisonActualClauses('我决定重新比较之前的取舍，假设我只剩10分钟。').length,0)
 assert.equal(reportedActualComparisonClauses('请试算：如果我只有10分钟。另外，我现在选择困难。').length,0)
 assert.equal(reportedActualComparisonClauses('另外我接受报告步骤。').length,1)
 assert.ok(!projectDecisionCases([{...events[1],nodes:[{kind:'fact',status:'active',content:'下一步回复导师邮件确认截止时间'}]}],conditions)[0].allowedModes.includes('do_now'))
 const outside=compileDecisionConditions('','假设我不能外出，请重新比较之前的取舍。')
 assert.ok(!projectDecisionCases([{...events[1],nodes:[{kind:'fact',status:'active',content:'必须外出到现场提交材料'}]}],outside)[0].allowedModes.includes('do_now'))
 const negatives=compileDecisionConditions('我有60分钟，网络可用，也可以联系老师，有电脑。','假设我不可以联网，也不可以联系老师，也不可以使用电脑，请重新比较。')
 assert.equal(negatives.network,false);assert.equal(negatives.contact,null);assert.deepEqual(negatives.unavailableResources,['电脑'])
 assert.deepEqual(compileDecisionConditions('','假设我电脑和手机都不能用。').unavailableResources,['电脑','手机'])
 assert.deepEqual(compileDecisionConditions('','我不能使用电脑和手机。').unavailableResources,['电脑','手机'])
 assert.deepEqual(compileDecisionConditions(compileDecisionConditions('','我不能使用电脑和手机。'),'现在电脑和手机都可用。').unavailableResources,[])
 assert.ok(!projectDecisionCases([{...events[1],nodes:[{kind:'fact',status:'active',content:'我必须访问在线系统填写并保存报告'}]}],compileDecisionConditions('','不能联网。'))[0].allowedModes.includes('do_now'))
 assert.equal(projectDecisionCases([{...events[1],nodes:[{kind:'fact',status:'active',content:'报告没有截止时间'}]}],conditions)[0].deadlineReported,false)
 assert.equal(projectDecisionCases([{...events[1],nodes:[{kind:'fact',status:'active',content:'报告不需要明天前提交，可以离线整理。'}]}],conditions)[0].deadlineReported,false)
 for(const content of ['我不需要等待，必须联网提交报名。','我不需要等待，必须给导师发邮件确认。','我不需要帮助，必须使用电脑处理。'])assert.ok(!projectDecisionCases([{...events[1],nodes:[{kind:'fact',status:'active',content}]}],compileDecisionConditions('','不能联网，不能联系任何人，我没有电脑。'))[0].allowedModes.includes('do_now'),'negation stays in its own scanned clause: '+content)
 for(const content of ['我不需要等待即可登录网站提交报告','我不需要等待即可给导师发邮件确认截止'])assert.ok(!projectDecisionCases([{...events[1],nodes:[{kind:'fact',status:'active',content}]}],compileDecisionConditions('','不能联网，不能联系任何人。'))[0].allowedModes.includes('do_now'),'negation attaches to its own predicate: '+content)
 for(const content of ['我没有必要联网，本地文档可以直接编辑','没有必要联系导师，直接提交即可'])assert.ok(projectDecisionCases([{...events[1],nodes:[{kind:'fact',status:'active',content}]}],compileDecisionConditions('','不能联网，不能联系任何人。'))[0].allowedModes.includes('do_now'))
 for(const content of ['我已经给导师发过邮件，接下来只需离线整理报告','我已经给导师发邮件，接下来只需离线整理报告','已经在线提交，下一步离线核对','以前需要电脑，现在用手机离线整理'])assert.ok(projectDecisionCases([{...events[1],nodes:[{kind:'fact',status:'active',content}]}],compileDecisionConditions('','不能联网，不能联系任何人，我没有电脑。'))[0].allowedModes.includes('do_now'),'past operations are not current hard requirements: '+content)
 assert.equal(decisionComparisonActualClauses('请试算：如果我只有10分钟，重新比较之前的取舍；另外我已经把报告提交了。').length,1)
 assert.equal(decisionComparisonActualClauses('请试算：如果我只有10分钟，重新比较；另外我接受十分钟作为本次试算条件。').length,0)
 const before={items:[{eventId:events[0].id,mode:'do_now' as const,minutesCeiling:30}]}
 assert.equal(decisionOrderRelation([{eventId:events[0].id,mode:'prepare_only',minutesCeiling:5}],before),'scope_changed')
 assert.equal(decisionOrderRelation(before.items,{...before,scopeChanged:true}),'scope_changed','withdrawn scope changes are not erased by filtering the old item list')
 const schema=bindDecisionProposalSchema({type:'object',properties:{reply:{type:'string'}},required:['reply'],additionalProperties:false},cases,conditions)
 const proposal={items:cases.map((c,caseIndex)=>({caseIndex,kind:'prepare',minutesCeiling:0}))}
 assert.ok(Value.Check(schema,{reply:'说明。',decisionProposal:proposal}))
 assert.equal(schema.properties.reply.pattern,undefined,'do not add generation regex after real provider grammar failure; host checks incomplete tail without rewriting prose')
 assert.equal(schema.properties.reply.allOf,undefined,'the removed native terminal grammar was nested in allOf')
 const existing={type:'string',pattern:'^说明',allOf:[{minLength:3}]}
 const preserved=bindDecisionProposalSchema({properties:{reply:existing}},cases,conditions).properties.reply
 assert.equal(preserved.pattern,existing.pattern);assert.deepEqual(preserved.allOf,existing.allOf,'pre-existing output restrictions remain byte-equivalent')
 assert.equal(Value.Check(schema,{reply:'说明。',decisionProposal:{...proposal,items:[{...proposal.items[0],minutesCeiling:61},proposal.items[1]]}}),false)
 assert.equal(Value.Check(schema,{reply:'说明。',decisionProposal:{...proposal,items:[proposal.items[0],proposal.items[0]]}}),false)
})
