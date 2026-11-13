import test from 'node:test'
import assert from 'node:assert/strict'
import {weeklyPlanExplanation,requestsOneQuestionReply,openingQuestionDraft} from '../server/reply-draft.ts'

test('numeric plan explanation stays intact instead of deleting paragraphs',()=>{
 for(const reply of ['先保课程作业。\n\n- 复习（30分钟）：先核对要求，截止时间仍未知。','你上次报告每周两小时，当前具体截止日仍未知。','先看已有依据。\n\n【课程作业】50分钟：保留疑问和投入理由。'])assert.equal(weeklyPlanExplanation(reply),reply)
})

test('the observed one-question selection remains ordinary and does not expand into a timetable',()=>{
 assert.equal(requestsOneQuestionReply('我在课程小组里负责整理资料和排版。先帮我选一个值得了解的问题。'),true)
 assert.equal(openingQuestionDraft(JSON.stringify({reply:'先问自己：整理排版这件事，你愿意为它收多少钱？\n\n两小时可以这样安排：30分钟找需求。'})),'先问自己：整理排版这件事，你愿意为它收多少钱？')
 for(const text of ['老师说：“先帮我选一个值得了解的问题。”','如果我说先帮我选一个值得了解的问题，你会怎么办？','帮我写一段岗位比较材料。'])assert.equal(requestsOneQuestionReply(text),false)
})
