import test from 'node:test'
import assert from 'node:assert/strict'
import {compileDecisionConditions,projectDecisionCases,decisionProposalContract,bindDecisionProposalSchema,projectDecisionProposalWire,validateDecisionProposal,type DecisionProposal} from '../../server/decision-comparison.ts'
import {mainCompanionPolicy,readOnlyDecisionPolicy} from '../../server/companion-policy.ts'
import {turnSystemPrompt} from '../../server/turn-prompt.ts'
import {comparisonRequestClause,requestsMatterDecision} from '../../server/user-command-spans.ts'

test('zero allocation means not scheduled regardless of candidate approach, while source stops and caps remain binding',()=>{
 const conditions=compileDecisionConditions('我有2分钟，不能联网。',''),cases=projectDecisionCases([
  {id:'11111111-1111-4111-8111-111111111111',title:'报告',nodes:[],matterProgress:{state:'unattempted'}},
  {id:'22222222-2222-4222-8222-222222222222',title:'权限',nodes:[{kind:'fact',status:'active',content:'必须联网修改权限。'}],matterProgress:{state:'unattempted'}},
  {id:'33333333-3333-4333-8333-333333333333',title:'竞赛',nodes:[],matterProgress:{state:'paused'}},
 ] as any,conditions)
 const wire={items:[{caseIndex:0,kind:'advance',minutesCeiling:2},{caseIndex:1,kind:'prepare',minutesCeiling:0},{caseIndex:2,kind:'none',minutesCeiling:0}]}
 const project=(v:unknown)=>projectDecisionProposalWire(v,cases,conditions) as DecisionProposal
 const result=project(wire)
 assert.deepEqual(result.items.map(x=>x.mode),['do_now','wait','leave_stopped'])
 validateDecisionProposal(result,cases,conditions,null,'报告先补一条说明，最多两分钟。权限本轮未安排。竞赛保持暂停。')
 assert.throws(()=>validateDecisionProposal(result,cases,conditions,null,'报告：kind=advance，最多两分钟。'),/INTERNAL_FIELDS_VISIBLE/)
 assert.doesNotThrow(()=>validateDecisionProposal(result,cases,conditions,null,'报告最多两分钟；英文例句 Please prepare in advance. 中的常用词可正常讨论。'))
 assert.throws(()=>project({items:wire.items.map(x=>x.caseIndex===1?{...x,kind:'advance'}:x)}),/ACTION_BLOCKED/)
 for(const [index,minutes] of [[0,3],[0,-1],[1,null],[2,1]] as const){
  assert.throws(()=>validateDecisionProposal(project({items:wire.items.map(x=>x.caseIndex===index?{...x,minutesCeiling:minutes}:x)}),cases,conditions,null,'报告先做。'),/BUDGET_EXCEEDED/)
 }
})

test('a decision binds owner, mode and ceiling without requiring a redundant cause label',()=>{
 const conditions=compileDecisionConditions('我有2分钟。',''),cases=projectDecisionCases([{id:'11111111-1111-4111-8111-111111111111',title:'课程报告',nodes:[],matterProgress:{state:'unattempted'}}] as any,conditions)
 const wire={items:[{caseIndex:0,kind:'advance',minutesCeiling:2}]}
 const projected=projectDecisionProposalWire(wire,cases,conditions) as DecisionProposal
 assert.deepEqual(projected.items,[{eventId:cases[0].eventId,mode:'do_now',minutesCeiling:2}])
 validateDecisionProposal(projected,cases,conditions,null,'课程报告本次最多投入两分钟，先补一条有依据的说明，到点核对进展。')
 const schema=bindDecisionProposalSchema({type:'object',properties:{reply:{type:'string'}}},cases,conditions)
 const rebound=bindDecisionProposalSchema({...schema,properties:{...schema.properties,decisionProposal:{type:'string'}}},cases,conditions)
 assert.equal(rebound.properties.decisionProposal.type,'object','rebinding must replace a stale proposal while preserving first-property order')
 assert.equal(Object.keys(rebound.properties)[0],'decisionProposal')
 for(const branch of schema.properties.decisionProposal.properties.items.items.anyOf){assert.deepEqual(branch.required,['caseIndex','kind','minutesCeiling']);assert.equal(branch.properties.allocationBasis,undefined)}
 assert.throws(()=>projectDecisionProposalWire({items:[{caseIndex:99,kind:'advance',minutesCeiling:2}]},cases,conditions),/CASE_COVERAGE/)
 assert.throws(()=>projectDecisionProposalWire({items:[{caseIndex:0,kind:'advance',minutesCeiling:2,allocationBasis:'invented'}]},cases,conditions),/ALLOCATION_BASIS/)
})

test('an explicit owned matter scope can accompany a bare comparison while named generic objects stay generic',()=>{
 for(const text of ['请比较优先级，范围是我手头这些事。','请比较。对象是手头这些事。']){
  assert.equal(requestsMatterDecision(text),true)
  assert.equal(comparisonRequestClause(text.split(/[，。]/)[0],'matter_set',text),true)
 }
 assert.equal(comparisonRequestClause('请比较两种学习方式','matter_set','请比较两种学习方式，范围是我手头这些事。'),false)
 assert.equal(comparisonRequestClause('请比较','matter_set','请比较。室友说“范围是我手头这些事”。'),false)
 for(const text of ['请比较两种学习方式：读教材和看视频。另外，我手头还有课程报告。','我手头还有课程报告。另外，请比较两种学习方式：读教材和看视频。'])assert.equal(requestsMatterDecision(text),false,'a factual matter mention cannot supply the object of a separate generic comparison')
 assert.equal(requestsMatterDecision('我这次实际有60分钟，精力充足，电脑和网络都可用，也可以联系别人。帮我把手头这些事排个优先级：先做什么、哪些能等、哪些先别动？'),true)
 assert.equal(requestsMatterDecision('报告和表格权限，我现在应该先做哪个？'),true,'an unscoped priority question retains the preceding matter list')
 assert.equal(requestsMatterDecision('请比较两种学习方式：读教材和看视频。另外，我有报告和表格权限两件事。我应该先做哪个？'),true,'a separate genuine priority request keeps its own adjacent matter scope')
})

test('scoped decision policy retains original evidence and refusal paragraphs while other lanes keep the full policy',()=>{
 const capabilities={growth:false,candidate:false,plan:false,citations:false,event:false,material:false}
 const contract={mode:'reply_only' as const,capabilities,schema:{type:'object',properties:{reply:{type:'string'},decisionProposal:{type:'object'}}},schemaChars:0}
 const compact=turnSystemPrompt('default','qwen3.8-flash',contract,false,true)
 assert.ok(compact.includes(readOnlyDecisionPolicy.instructions))
 assert.ok(!compact.includes(mainCompanionPolicy.instructions))
 for(const paragraph of readOnlyDecisionPolicy.instructions.split(/\r?\n\r?\n/))assert.ok(mainCompanionPolicy.instructions.includes(paragraph),'scoped policy copies original paragraphs exactly')
 for(const quote of ['Stop asking','Never re-ask','更正只更新相关理解','记忆关闭、拒绝、暂停和遗忘'])assert.ok(compact.includes(quote))
 assert.ok(compact.includes('When the person reports zero available time,'))
 assert.ok(compact.includes('Use only contact channels, people and resources present in authorized state.'))
 assert.ok(readOnlyDecisionPolicy.instructions.length<mainCompanionPolicy.instructions.length/2)
 assert.ok(turnSystemPrompt('default','qwen3.8-flash',contract,false,false).includes(mainCompanionPolicy.instructions),'crisis/full scope remains intact')
 const writable={...contract,schema:{type:'object',properties:{reply:{type:'string'},decisionProposal:{type:'object'},growthUpdates:{type:'array'}}}}
 assert.ok(turnSystemPrompt('default','qwen3.8-flash',writable,false,true).includes(mainCompanionPolicy.instructions))
 assert.equal(turnSystemPrompt('default','qwen3.8-flash',undefined,false,true),turnSystemPrompt('default','qwen3.8-flash',undefined,false,false),'legacy capability probe ignores runtime projection')
})

test('a smaller current budget preserves previous allocation ceilings and exposes mode meanings at generation',()=>{
 const conditions=compileDecisionConditions('我有60分钟，网络可用。','假设我只有2分钟。')
 const cases=projectDecisionCases([
  {id:'11111111-1111-4111-8111-111111111111',title:'合作文档权限',nodes:[],matterProgress:{state:'unattempted'}},
  {id:'22222222-2222-4222-8222-222222222222',title:'课程报告',nodes:[],matterProgress:{state:'unattempted'}},
  {id:'33333333-3333-4333-8333-333333333333',title:'竞赛',nodes:[],matterProgress:{state:'paused'}},
 ] as any,conditions)
 const previous:DecisionProposal={items:[
  {eventId:cases[0].eventId,mode:'do_now',minutesCeiling:10},
  {eventId:cases[1].eventId,mode:'do_now',minutesCeiling:30},
  {eventId:cases[2].eventId,mode:'leave_stopped',minutesCeiling:0},
 ],orderRelation:'baseline'}
 const snapshot=structuredClone(previous),context=decisionProposalContract(cases,conditions,previous) as any
 assert.equal(context.minuteCeiling,2)
 assert.deepEqual(context.previousProposal.items.map((v:any)=>v.minutesCeiling),[10,30,0])
 for(const item of context.previousProposal.items){
  assert.equal(item.completionPromise,false,'a previous recommendation never proves completion time')
  assert.equal(item.modeMeaning,context.modeMeanings[item.mode])
  assert.equal(item.minutesCeilingMeaning,context.minutesCeilingMeaning)
  assert.doesNotMatch(item.minutesCeilingMeaning,/本次|本轮/,'history wording must not reinterpret a previous cap as current')
  assert.doesNotMatch(item.modeMeaning,/本次|本轮/)
 }
 const bound=bindDecisionProposalSchema({type:'object',properties:{reply:{type:'string'}}},cases,conditions)
 for(const branch of bound.properties.decisionProposal.properties.items.items.anyOf){
  const kind=branch.properties.kind
  assert.equal(kind.description,context.candidateKindMeaning)
 }
 assert.deepEqual(previous,snapshot)
})

test('explicit absence of autonomous preparation stays usable while an unassessed absence is rejected',()=>{
 const conditions=compileDecisionConditions('','我有2分钟。')
 const event=(fact:string)=>({id:'11111111-1111-4111-8111-111111111111',title:'岗位咨询',nodes:[{kind:'fact',status:'active',content:fact}],matterProgress:{state:'waiting_result'}})
 const known=projectDecisionCases([event('岗位咨询邮件已发出，我确认没有自主动作可推进。')] as any,conditions)
 const unknown=projectDecisionCases([event('岗位咨询邮件已发出，等待回复，自主准备是否存在尚未评估。')] as any,conditions)
 const negated:DecisionProposal={items:[{eventId:unknown[0].eventId,mode:'wait',minutesCeiling:0}],orderRelation:'baseline'}
 assert.doesNotThrow(()=>validateDecisionProposal(negated,unknown,conditions,null,'岗位咨询本轮不分配时间，也不推断没有自主动作；自主准备是否存在仍未知。'),'a denied inference is not an asserted absence')
 const proposal:DecisionProposal={items:[{eventId:known[0].eventId,mode:'wait',minutesCeiling:0,allocationBasis:'waiting_external'}],orderRelation:'baseline'}
 const reply='岗位咨询仍在等待回复；本人已确认没有自主动作可推进。'
 assert.doesNotThrow(()=>validateDecisionProposal(proposal,known,conditions,null,reply))
 assert.throws(()=>validateDecisionProposal(proposal,unknown,conditions,null,reply),/DECISION_UNSUPPORTED_NO_ACTION/)
 for(const field of ['modeMeanings','modeMeaning','minutesCeilingMeaning','completionPromise']){
  assert.throws(()=>validateDecisionProposal(proposal,known,conditions,null,reply+'私有字段 '+field+' 不应展示。'),/DECISION_INTERNAL_FIELDS_VISIBLE/)
 }
})
