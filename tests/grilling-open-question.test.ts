import test from 'node:test'
import assert from 'node:assert/strict'
import {openUnreportedChoiceQuestion,limitGrillingQuestions} from '../server/reply-draft.ts'

test('unreported alternatives become one grounded open question without another model call',()=>{
  assert.equal(openUnreportedChoiceQuestion('你整理资料时，最让你有成就感的是“混乱变有序”，还是“别人能看懂”？','我喜欢把混乱内容按规则归类。'),'你整理资料时，最让你有成就感的具体情况是什么？')
  assert.equal(openUnreportedChoiceQuestion('你自己想读研，是为了逃避就业，还是为了获得认可？','身边同学都在考研，我还没想清楚。'),'你自己想读研，你希望它具体改变什么？')
  assert.equal(openUnreportedChoiceQuestion('整理资料时，你更享受把混乱变有序的过程，还是更在意整理完能派上用场？','我喜欢把混乱内容按规则归类。'),'整理资料时，具体哪一部分最影响你的感受？')
  assert.equal(openUnreportedChoiceQuestion('你更想考研，还是就业？','我在比较考研还是就业。'),null)
})

test('ordinary grilling keeps one grounded question and drops invented channels',()=>{
  assert.equal(limitGrillingQuestions('先保留等待状态。你上次向学长具体问了什么？要不要去群里或公开渠道再问一次？','仍然没收到回复，我不想换到私人微信催他。','仍然没收到回复，我不想换到私人微信催他。学长'), '先保留等待状态。你上次向学长具体问了什么？')
  assert.equal(limitGrillingQuestions('现在线索还不足。下一次访谈问题：他最近一次因为课表冲突放弃了什么安排？你愿意今天再问三个人吗？','我问了一个同学，下一步怎么判断这个线索？'), '现在线索还不足。下一次访谈问题：他最近一次因为课表冲突放弃了什么安排？')
  assert.equal(limitGrillingQuestions('先问动机是什么？再问时间有多少？','请分别给我两个问题。'),null)
})
