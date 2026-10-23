import test from 'node:test'
import assert from 'node:assert/strict'
import {provisionalQuestionPreview,boundedTimedObservationPreview} from '../server/reply-draft.ts'
const question='我是成年大学生，我想要更自由的生活，但明确不想创业。不要换词劝我创业，先问一个问题厘清我说的自由。'
const observation='回来反馈：我把奖学金材料按三条规则整理了一次，第二天大约20秒找到通知，但目前只发生过一次。不要把一次成功当成职业适合。'
test('the observed slow definition has one owned question without unreported options',()=>{
 assert.equal(provisionalQuestionPreview(question),'你说的“自由”具体指什么？')
 for(const text of ['朋友说：'+question,'如果'+question,question+'现在不要追问了。',question.replace('我想要更自由的生活','朋友想要更自由的生活')])assert.equal(provisionalQuestionPreview(text),null,text)
})
test('the observed timed episode preview quotes one source and preserves the inference limit',()=>{
 const preview=boundedTimedObservationPreview(observation)
 assert.ok(preview?.includes('第二天大约20秒找到通知'))
 assert.match(preview!,/不能证明稳定效果或职业适合/)
 for(const text of ['朋友说：'+observation,'如果'+observation,'第二天大约20秒找到通知。',observation.replace('但目前只发生过一次','已验证长期稳定有效'),observation+'此前用了30分钟。'])assert.equal(boundedTimedObservationPreview(text),null,text)
})
