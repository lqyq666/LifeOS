import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {limitGrillingQuestions,removeUnsupportedContactChannels,enforceReportedQuantity} from '../server/reply-draft.ts'
const f=JSON.parse(readFileSync(new URL('./fixtures/reply-completeness-p3.json',import.meta.url),'utf8'))
test('captured structured action keeps its self-check and validation questions with their referents',()=>{
 assert.equal(limitGrillingQuestions(f.rawReply,f.prompt)??f.rawReply,f.rawReply)
})
test('quoted and code questions are content, while separate conversational followups stay bounded',()=>{
 const reply='记录：“我愿意试吗？”与“哪里不清楚？”\n```js\nconst flag = ok ? 1 : 0;\n```\n你想先从哪里开始？你今天有多少时间？'
 assert.equal(limitGrillingQuestions(reply,'给我一个动作和一个必要的追问。'),reply.replace('你今天有多少时间？',''))
 assert.equal(limitGrillingQuestions('你说的“自主”具体指什么？你想从哪里开始？','先问一个问题。'),'你说的“自主”具体指什么？')
})
test('a requested observation section does not exempt unrelated followups or quoted user instructions',()=>{
 const user='给一个小动作，说明它能验证哪个问题。'
 const reply='**要验证的问题**\n- 我更享受构思还是调试？\n- 什么条件让我想继续？\n**还需要了解**\n你每周有多少时间？你愿意先选哪一条？'
 assert.equal(limitGrillingQuestions(reply,user),reply.replace('你愿意先选哪一条？',''))
 assert.equal(limitGrillingQuestions('**要验证的问题**\n你每周有多少时间？你愿意先选哪一条？','请解释“给一个动作，说明能验证哪个问题”这句话，只问我一个问题。'),'**要验证的问题**\n你每周有多少时间？')
 assert.equal(limitGrillingQuestions('**要验证的问题**\n你每周有多少时间？你愿意先选哪一条？','不要解释能验证哪个问题。先问我一个问题。'),'**要验证的问题**\n你每周有多少时间？')
})

test('public four-point self-review checklist retains every step and its questions',()=>{
 assert.equal(limitGrillingQuestions(f.publicCase.reply,f.publicCase.prompt)??f.publicCase.reply,f.publicCase.reply)
})

test('requested structured analysis keeps unknown conditions and proposed research questions',()=>{
 const reply='### 独立产品\n**未知条件**\n- 有真实用户试用吗？\n- 有留存反馈吗？\n### AI实习\n**未知条件**\n- 目前的能力差距是什么？\n### AI交叉科研\n**未知条件**\n- 有导师资源吗？\n### 如何获得选择依据\n3. **交叉科研**：了解课题组是否接收本科生？这一步只获取新证据。\n**补充追问**\n你想先试哪条？你每周有多少时间？'
 assert.equal(limitGrillingQuestions(reply,'请完整写三条道路的说明。只分析，不修改档案。'),reply.replace('你每周有多少时间？',''))
})

test('analysis outreach keeps its rationale with an explicit unconfirmed channel prerequisite',()=>{
 const reply='3. **交叉科研**：通过邮件联系老师，了解是否接收本科生？这一步验证实际准入条件。'
 assert.equal(removeUnsupportedContactChannels(reply,'只分析，不创建任务。'),reply.replace('邮件','可用渠道（需你先确认）'))
 assert.equal(removeUnsupportedContactChannels('你已经通过邮件联系过老师。','只分析，不创建任务。'),'')
 assert.equal(removeUnsupportedContactChannels('通过邮件联系老师。','只分析，不要联系任何人。'),'')
})

test('one analysis document does not collapse its three paths into one',()=>{
 assert.equal(enforceReportedQuantity('大学生三条AI路径比较：独立产品、实习与科研。','请完整写一份大学生比较独立AI产品、AI实习与AI交叉科研三条道路的说明。只分析，不修改档案。'),null)
 assert.equal(enforceReportedQuantity('先看两个岗位。','只了解一个岗位。只分析。'),'先看一个岗位。')
})

test('a context-led analysis request keeps the unknowns in each requested direction',()=>{
 const reply='### 独立产品\n**未知条件**\n- 有实际使用反馈吗？\n- 留存情况如何？\n### AI实习\n**未知条件**\n- 哪些岗位条件还需核实？\n### 交叉科研\n**未知条件**\n- 有导师或实验室资源吗？\n**补充追问**\n你想先试哪条？你每周有多少时间？'
 const user='请结合你已经保存的我的真实背景，分析未来一个学期怎样验证三条方向：独立AI产品、AI实习、电气与AI科研。只给分析和建议，不修改档案，不创建任务或经历。'
 assert.equal(limitGrillingQuestions(reply,user),reply.replace('你每周有多少时间？',''))
 assert.equal(limitGrillingQuestions('### 未知条件\n第一项未知是什么？第二项未知是什么？',user+'先只问我一个问题。'),'### 未知条件\n第一项未知是什么？')
})

test('quoted, conditional, attributed, negated, and separate-sentence context leads do not widen analysis',()=>{
 const reply='### 当前判断\n第一项未知是什么？第二项未知是什么？'
 for(const text of ['记录这句话：“请结合背景，分析三条方向。”','如果将来请结合背景，分析三条方向。','老师说：“请结合背景，分析三条方向。”','请结合背景，不要分析三条方向。','请结合背景。分析能力是我的优势。']){
  assert.equal(limitGrillingQuestions(reply,text),'### 当前判断\n第一项未知是什么？',text)
 }
})
