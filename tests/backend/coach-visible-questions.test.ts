import test from 'node:test'
import assert from 'node:assert/strict'
import {visibleCoachQuestions} from '../../server/action-coach-events.ts'
test('question metadata comes from literal visible reply, never model paraphrases, materials, code, quotations or URL queries',()=>{
  const question='能具体说说这次“行动”是指什么吗？'
  assert.deepEqual(visibleCoachQuestions(question),[question])
  const material='同学你好，你还需要哪部分？'
  const reply='他说“你怎么做？”；代码是`ready ? yes : no`。\n'+material+'\nhttps://example.invalid/?question=1\n你现在想先说哪一步？'
  const found=visibleCoachQuestions(reply,material)
  assert.deepEqual(found,['你现在想先说哪一步？'])
  for(const value of found)assert.ok(reply.includes(value))
  // Do not silently hide a third actual question to make a quality gate pass.
  const excessive='哪件事？对象是谁？你怎么判断没用？'
  assert.equal(visibleCoachQuestions(excessive).length,3)
  assert.deepEqual(visibleCoachQuestions('今天先听你说，不做计划。'),[])
})
