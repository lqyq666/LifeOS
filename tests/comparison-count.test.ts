import test from 'node:test'
import assert from 'node:assert/strict'
import {Value} from 'typebox/value'
import {deriveTurnContract,bindRequestedComparisonSchema,comparisonReplyAccepts,requestedComparisonCount} from '../server/turn-contract.ts'
import {responseRequestScope} from '../server/user-command-spans.ts'
const actual='请结合我现在有效的时间和背景，比较独立做AI应用、那个本周要求投入十小时的产品运营实习、电气结合AI的科研探索。说明各自有哪些个人依据、当前投入冲突、关键未知，以及我可以选择的一个起步动作。'
const two='方式一：独立做AI应用\n本人有创造意愿，实际效果未知。\n方式二：产品运营实习\n十小时要求与本周30分钟冲突。'
const three=two+'\n方式三：电气结合AI的科研探索\n学术兴趣与项目资格尚未核实，可先了解一个具体问题。'
test('the public three-path omission is rejected by the actual reply schema and final presentation check',()=>{
 assert.equal(requestedComparisonCount(actual),3)
 const original=deriveTurnContract({text:actual,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
 const contract=bindRequestedComparisonSchema(original,actual)
 assert.equal(Value.Check(contract.schema as any,{reply:two}),false)
 assert.equal(Value.Check(contract.schema as any,{reply:three}),true)
 assert.equal(comparisonReplyAccepts(two,actual),false);assert.equal(comparisonReplyAccepts(three,actual),true)
 assert.equal((contract.schema.properties as any).reply.maxLength,16000)
 assert.match((contract.schema.properties as any).reply.description,/用户已经点名的对象不可遗漏/)
})
test('comparison quantity comes from the shared user clause list, not criteria or quoted instructions',()=>{
 for(const text of ['请完整比较就业、考研、留学。','比较以下三个方向。','比较实习的时间要求、独立开发、科研。'])assert.equal(requestedComparisonCount(text),3,text)
 assert.equal(responseRequestScope('请完整比较就业、考研、留学。').comparisonRequested,true)
 for(const text of ['比较就业和考研的时间、代价、未知。','老师说“比较就业、考研、留学”。','如果比较就业、考研、留学呢？','```比较就业、考研、留学```'])assert.equal(requestedComparisonCount(text),2,text)
 const pair='比较就业和考研。';assert.equal(comparisonReplyAccepts(two,pair),true)
})
