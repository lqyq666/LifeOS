import test from 'node:test'
import assert from 'node:assert/strict'
import {safeEarlySentence} from '../server/reply-draft.ts'

test('observed greetings and chat-only acknowledgements wait for substantive content',()=>{
 for(const prefix of ['“学长你好，我是[你的名字]。','明白，今天不安排任务，就陪你聊聊。']){
  assert.equal(safeEarlySentence(JSON.stringify({reply:prefix})),null)
  assert.equal(safeEarlySentence(JSON.stringify({reply:prefix+'担心打扰别人时，可以先说说让你最在意的那一刻。'})),'担心打扰别人时，可以先说说让你最在意的那一刻')
 }
 assert.equal(safeEarlySentence(JSON.stringify({reply:'明白，今天不安排任务，就陪你聊聊。已替你发送。先聊聊。'})),null)
 assert.equal(safeEarlySentence(JSON.stringify({reply:'学长你好，我想请教你当时是怎么选择实习方向的？'})),'学长你好，我想请教你当时是怎么选择实习方向的')
})
