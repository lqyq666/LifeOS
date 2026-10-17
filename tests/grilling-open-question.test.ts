import test from 'node:test'
import assert from 'node:assert/strict'
import {openUnreportedChoiceQuestion} from '../server/reply-draft.ts'

test('unreported alternatives become one grounded open question without another model call',()=>{
  assert.equal(openUnreportedChoiceQuestion('你整理资料时，最让你有成就感的是“混乱变有序”，还是“别人能看懂”？','我喜欢把混乱内容按规则归类。'),'你整理资料时，最让你有成就感的具体情况是什么？')
  assert.equal(openUnreportedChoiceQuestion('你自己想读研，是为了逃避就业，还是为了获得认可？','身边同学都在考研，我还没想清楚。'),'你自己想读研，你希望它具体改变什么？')
  assert.equal(openUnreportedChoiceQuestion('整理资料时，你更享受把混乱变有序的过程，还是更在意整理完能派上用场？','我喜欢把混乱内容按规则归类。'),'整理资料时，具体哪一部分最影响你的感受？')
  assert.equal(openUnreportedChoiceQuestion('你更想考研，还是就业？','我在比较考研还是就业。'),null)
})
