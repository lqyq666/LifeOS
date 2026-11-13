import test from 'node:test'
import assert from 'node:assert/strict'
import {removeQuestionOnZeroTime,ensureZeroTimeFocus} from '../server/reply-draft.ts'

test('a refused topic removes follow-up questions without erasing requested help or inventing zero time',()=>{
 const user='请核对我愿意探索什么和没去实验室的原因，再给一个探索建议。我不愿再谈家庭情况，不要追问这个。'
 const reply='**当前意愿**\n你愿意继续了解科研问题。\n\n**原因**\n那两天主要是期末复习占用时间，科研兴趣仍待实际体验。\n\n**可选建议**\n本周可以用十分钟回看一份已有课程记录，记下一个想弄清的问题。\n\n方便说说家庭期待吗？'
 const fixed=removeQuestionOnZeroTime(reply,user)??reply
 for(const part of ['你愿意继续了解科研问题','期末复习占用时间','本周可以用十分钟回看一份已有课程记录'])assert.ok(fixed.includes(part),part)
 assert.ok(!fixed.includes('家庭期待吗'));assert.ok(!fixed.includes('这周先不安排动作'))
 assert.equal(ensureZeroTimeFocus('可以先整理当前的判断。','家庭情况我不想说，科研探索最该先看什么？'),null)
})

test('real zero time and explicit no-action requests keep the original stop boundary',()=>{
 for(const user of ['本周可用时间是零。','这周完全没空，不想安排任何事。']){
  assert.equal(removeQuestionOnZeroTime('你希望先做什么？',user),'这周先不安排动作，等你有时间再继续。')
 }
})

test('refusing one topic still permits an explicitly requested pivot question',()=>{
 assert.equal(removeQuestionOnZeroTime('你现在最想理清哪件事？','家庭我不想说，但现在愿意聊聊，问我一个问题。'),null)
})

test('quoted refusal and quoted questions are not owned requests',()=>{
 assert.equal(removeQuestionOnZeroTime('可以先读现有记录。','同学说“不要追问”。请分析我的选择。'),null)
 const reply='例句是“为什么不去实验室？”；目前原因仍待核实。\n你方便再说家庭情况吗？'
 const fixed=removeQuestionOnZeroTime(reply,'这个原因我不想说，不要追问。')??reply
 assert.ok(fixed.includes('“为什么不去实验室？”'));assert.ok(fixed.includes('目前原因仍待核实'));assert.ok(!fixed.includes('家庭情况吗'))
})
