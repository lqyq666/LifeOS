import test from 'node:test'
import assert from 'node:assert/strict'
import { safeEarlySentence, openingQuestionDraft } from '../../server/reply-draft.ts'

const reply = (text: string) => JSON.stringify({ reply: text }).slice(0, -1) // trailing } kept off to emulate a stream

test('G3: safeEarlySentence surfaces the first complete safe sentence with real substance',()=>{
  // no terminator yet → nothing complete to show
  assert.equal(safeEarlySentence(reply('我这边没有跨会话记忆，这段对话才刚开始')),null,'incomplete sentence stays hidden')
  // completed first sentence surfaces
  assert.equal(safeEarlySentence(reply('我这边没有跨会话记忆，这段对话也才刚开始。')),'我这边没有跨会话记忆，这段对话也才刚开始','first complete sentence surfaces')
  // politeness-only filler never surfaces
  assert.equal(safeEarlySentence(reply('好的。你觉得呢？')),null,'filler first sentence rejected')
  // status claims / URLs / diagnoses / personality verdicts gated
  for(const bad of ['我已经帮你保存了这段经历。','详情看 https://example.com 页面。','这属于焦虑症的表现。','你就是内向的人。','报名截止明天。'])
    assert.equal(safeEarlySentence(reply(bad+'')),null,'gated: '+bad)
  // long sentences stay gated
  assert.equal(safeEarlySentence(reply('这是一句'.repeat(40)+'很长的话。')),null,'over-length gated')
})

test('G3: question draft still preferred when a question completes first',()=>{
  const stream=reply('这个兼职每周4小时之外，还有固定值班或通勤时间吗？')
  assert.equal(openingQuestionDraft(stream),'这个兼职每周4小时之外，还有固定值班或通勤时间吗？')
})
