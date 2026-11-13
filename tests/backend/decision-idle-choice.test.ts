import test from 'node:test'
import assert from 'node:assert/strict'
import {Value} from 'typebox/value'
import {compileDecisionConditions,projectDecisionCases,bindDecisionProposalSchema,projectDecisionProposalWire,validateDecisionProposal,type DecisionProposal} from '../../server/decision-comparison.ts'

test('an open or waiting matter can explicitly receive no allocation without inventing preparation',()=>{
 const events=[
  {id:'11111111-1111-4111-8111-111111111111',title:'报告',nodes:[{kind:'fact',status:'active',content:'本地有报告文档'}],matterProgress:{state:'unattempted'}},
  {id:'22222222-2222-4222-8222-222222222222',title:'咨询回复',nodes:[{kind:'fact',status:'active',content:'邮件已经发出，对方还没有回复'}],matterProgress:{state:'waiting_result'}},
  {id:'33333333-3333-4333-8333-333333333333',title:'竞赛',nodes:[],matterProgress:{state:'paused'}},
 ] as any
 for(const source of ['我有60分钟。','我不知道可用时间。','我有0分钟。']){
  const conditions=compileDecisionConditions('',source),cases=projectDecisionCases(events,conditions)
  const schema=bindDecisionProposalSchema({type:'object',properties:{reply:{type:'string'}},required:['reply'],additionalProperties:false},cases,conditions)
  const proposal={items:cases.map((_,caseIndex)=>({caseIndex,kind:'none',minutesCeiling:0}))}
  const reply='这轮先不安排这些事项；咨询仍等回复，独立准备是否需要尚未核对，竞赛保持暂停。'
  assert.ok(Value.Check(schema,{decisionProposal:proposal,reply}),source)
  const projected=projectDecisionProposalWire(proposal,cases,conditions) as DecisionProposal
  assert.deepEqual(projected.items.map(x=>x.mode),['wait','wait','leave_stopped'])
  assert.doesNotThrow(()=>validateDecisionProposal(projected,cases,conditions,null,reply))
  for(const minutesCeiling of [1,null])assert.equal(Value.Check(schema,{reply,decisionProposal:{items:proposal.items.map((x,i)=>i===1?{...x,minutesCeiling}:x)}}),false,'none has zero allocation even when the budget is unknown')
  assert.equal(cases[1]!.externalResult?.independentPreparation,'not_assessed','no allocation is not evidence that preparation is impossible')
 }
})
