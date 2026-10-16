import test from 'node:test'
import assert from 'node:assert/strict'
import { selectHistoryForMode, type HistoryMessage } from '../../server/history-selection.ts'

const mk = (n: number): HistoryMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    id: 'm' + i,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: (i % 2 === 0 ? '用户消息' : '助手回复') + i + '。'.padEnd(2 + (i % 5) * 3, '内容'),
  }))

test('G4: reply_only keeps the last exchange; planning/knowledge keep a small window; nothing grows unbounded',()=>{
  const messages=mk(20)
  for(const mode of ['reply_only','planning','knowledge','material','event','reply_growth'] as const){
    const sel=selectHistoryForMode(messages,mode,'现在的情况怎么样？')
    assert.ok(sel.selected.length<=7,mode+' selection bounded: '+sel.selected.length)
    assert.ok(sel.selected.length<messages.length,mode+' trims the 20-message history')
    assert.equal(sel.totalMessages,20)
    assert.ok(sel.selectedChars<=sel.totalChars)
    // never opens with an orphaned assistant reply
    if(sel.selected.length)assert.notEqual(sel.selected[0]!.role,'assistant',mode+' first picked is not an orphan assistant turn')
  }
  const ro=selectHistoryForMode(messages,'reply_only','嗯')
  assert.ok(ro.selected.length<=2,'reply_only: current + last exchange only')
})

test('G4: event lane keeps older USER turns matching the current matter keywords',()=>{
  const messages:HistoryMessage[]=[
    ...mk(6),
    { id:'old1', role:'user', content:'我给社团做了一套招新海报。' },
    { id:'old2', role:'assistant', content: '记下了海报这件事。' },
    ...mk(6),
  ]
  const sel=selectHistoryForMode(messages,'event','社团海报最后没用上，我想复盘。')
  assert.ok(sel.selected.some(m=>m.id==='old1'),'the poster user turn is retrieved by topic')
  const unrelated=selectHistoryForMode(messages,'event','我上周投了一个实习。')
  assert.ok(!unrelated.selected.some(m=>m.id==='old1'),'an unrelated matter does not drag the poster turn in')
})

test('G4: short histories pass through unchanged in size',()=>{
  const messages=mk(3)
  const sel=selectHistoryForMode(messages,'reply_growth','继续。')
  assert.equal(sel.selected.length,3)
})
