import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {reportedEvidenceFromText,unsupportedPreferenceConstraintClaims} from '../server/turn-contract.ts'
const actual=JSON.parse(readFileSync(new URL('./fixtures/nw-preference-scope-failure.json',import.meta.url),'utf8'))
const preferences=[...actual.priorMessages.map((text:string)=>reportedEvidenceFromText(text)),...actual.priorMemory.filter((item:any)=>item.status==='active').map((item:any)=>reportedEvidenceFromText(item.text,item.kind==='preference'))].flatMap(item=>item.preferences)
test('actual NW comparison describes a test limit without turning a preference into a requirement',()=>{
 assert.deepEqual(unsupportedPreferenceConstraintClaims(actual.raw.reply,preferences,'current',actual.user),[])
})
test('epistemic-only verbs preserve the distinction from actually requiring the preference',()=>{
 for(const reply of ['这只能验证偏好，不能判断可行性。','这只能测试你的偏好强度。','需要先观察你的偏好是否持续。','这只能测试你对“自己安排专注时间”的偏好强度，之后满足感是否提升无法得知。','这只能测试偏好强度并且满足感变化仍未知。'])assert.deepEqual(unsupportedPreferenceConstraintClaims(reply,preferences),[],reply)
 for(const reply of ['能自己安排一天中专注工作的时间是硬约束。','你的偏好是必须满足的硬条件。','必须验证并满足你的偏好。'])assert.ok(unsupportedPreferenceConstraintClaims(reply,preferences).length,reply)
})
