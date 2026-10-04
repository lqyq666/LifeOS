import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceConversation, beginExploration, emptyConversation, createDemoConversation } from '../src/features/conversation/flow.ts'

test('both opening paths work, including a typed no-problem answer', () => {
  assert.equal(advanceConversation(emptyConversation(), '  ').messages.length, 0)
  assert.equal(advanceConversation(emptyConversation(), '我该参加比赛吗？').branch, 'problem')
  for (const answer of ['没有', '暂时没有', '没有具体问题', '目前没有具体的问题', '没什么问题']) {
    assert.equal(advanceConversation(emptyConversation(), answer).branch, 'explore', answer)
  }
  const exploratory = beginExploration()
  assert.equal(exploratory.notes.problem, '')
  assert.match(exploratory.messages[1].text, /顺利的、开心的/)
})

test('pattern corrections require explicit reconfirmation before advancing to advice', () => {
  let state = beginExploration()
  for (const text of ['经历甲', '结果甲', '经历乙', '我习惯先答应']) state = advanceConversation(state, text)
  assert.equal(state.stage, 'confirm')
  assert.equal(state.confirmed, false)
  state = advanceConversation(state, '我想改一下')
  state = advanceConversation(state, '只有熟人求助时才会这样')
  assert.equal(state.stage, 'confirm')
  assert.equal(state.confirmed, false)
  assert.equal(state.notes.pattern, '只有熟人求助时才会这样')
  state = advanceConversation(state, '贴近，继续')
  assert.equal(state.stage, 'avoid')
  assert.equal(state.confirmed, true)
  state = advanceConversation(state, '暂时没有')
  state = advanceConversation(state, '以后先问清任务量')
  assert.equal(state.notes.avoid, '')
  assert.equal(state.notes.problem, '')
  assert.match(state.messages.at(-1)!.text, /以后先问清任务量/)
})

test('turns preserve submitted evidence, do not mutate prior sessions, and bound input', () => {
  const first = advanceConversation(emptyConversation(), '当下的问题')
  const original = JSON.stringify(first)
  const second = advanceConversation(first, '<b>我的经历</b>')
  assert.equal(JSON.stringify(first), original)
  assert.equal(second.notes.experience, '<b>我的经历</b>')
  assert.equal(second.notes.pattern, '')
  assert.equal(advanceConversation(emptyConversation(), 'a'.repeat(5000)).notes.problem.length, 4000)
})

test('fictional sample is isolated from the real-input flow and is explicitly flagged', () => {
  const demo = createDemoConversation()
  assert.equal(demo.demo, true)
  assert.equal(demo.confirmed, true)
  assert.equal(emptyConversation().demo, false)
  assert.equal(emptyConversation().messages.length, 0)
  assert.equal(new Set(demo.messages.map(message => message.id)).size, demo.messages.length)
})
