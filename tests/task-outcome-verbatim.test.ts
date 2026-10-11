import test from 'node:test'
import assert from 'node:assert/strict'
import {reportedTaskOutcomeClauses} from '../server/turn-contract.ts'
test('actual task observations retain separate read, response and adoption statements without importing a public case',()=>{
 const text='我通过学校邮箱请教学长甲，原请求是了解项目课。对方已经读了，但没有回复，也没有采用。'
 assert.deepEqual(reportedTaskOutcomeClauses(text).map(c=>c.text),['对方已经读了','但没有回复','也没有采用'])
 for(const other of ['案例里学生联系学长，对方已经读了。','如果我联系学长，对方已经读了也可能不回复。','我联系学长了吗？对方已经读了？','学长说：“我交付了，对方已经采用。”'])assert.deepEqual(reportedTaskOutcomeClauses(other),[],other)
})
