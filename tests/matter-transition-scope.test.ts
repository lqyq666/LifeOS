import test from 'node:test'
import assert from 'node:assert/strict'
import {assistantRequestClause,scanUserClauses} from '../server/user-command-spans.ts'
import {reportedPriorMatterTransition,reportedActionProgress,reportedDatedMatterChoice,reportedSwitchedMatterChoice} from '../server/workflows/action-review.ts'

test('a named matter followed by the own still-not-started report remains traceable feedback',()=>{
 for(const text of ['岗位核对这件事我还是没有开始。','这件事我仍然没有开始。','我还是没有开始执行。'])assert.equal(reportedActionProgress(text).state,'unattempted',text)
 for(const text of ['室友说“岗位核对这件事我还是没有开始”。','如果岗位核对这件事我还是没有开始呢？','这件事室友还是没有开始。'])assert.equal(reportedActionProgress(text).state,null,text)
})

test('a partial step can inherit the immediately preceding authorized owner',()=>{
 const text='我看了一个岗位四分钟，只核对了三列标题，没有完成。今天没时间了。'
 assert.deepEqual(reportedActionProgress(text),{state:'partial',choice:null,quotes:['我看了一个岗位四分钟','只核对了三列标题'],resumed:false})
 const clauses=scanUserClauses(text)
 assert.notEqual(reportedActionProgress(clauses.slice(1)).state,'partial','a withdrawn source cannot establish ownership')
 for(const source of ['我看了一个岗位。只核对了三列标题。','我看了一个岗位，室友说只核对了三列标题。','我看了一个岗位，我的同学核对过，只核对了三列标题。','如果我看了一个岗位，只核对了三列标题。','我打算看一个岗位，只核对了三列标题。','我看了另一件事，只核对了三列标题。'])assert.notEqual(reportedActionProgress(source).state,'partial',source)
 const interrupted=scanUserClauses('我看了一个岗位，我的同学核对过，只核对了三列标题。')
 assert.notEqual(reportedActionProgress([interrupted[0]!,interrupted[2]!]).state,'partial','an omitted intervening clause does not join sources')
})

test('a first reported choice binds only its own named task and known deadline',()=>{
 const due='我准备课程报告，截止明晚。我接受先整理两条证据这个步骤，还没开始。'
 const report=reportedDatedMatterChoice(due)
 assert.equal(report?.title,'课程报告')
 assert.deepEqual(report?.clauses.map(clause=>clause.text),['我准备课程报告','截止明晚','我接受先整理两条证据这个步骤','还没开始'])
 for(const text of ['如果'+due,'室友说“'+due+'”',due.replace('截止明晚','截止时间可能是明晚'),due.replace('截止明晚','截止时间'),due.replace('我接受','我拒绝'),due.replace('我接受','我考虑另一件事。我接受')])assert.equal(reportedDatedMatterChoice(text),null,text)
})

test('a switched matter keeps its accepted step and pause separate from the new focus',()=>{
 const text='换一件事，我还考虑参加校内创新赛。我接受先看报名要求，但这次完全没执行。竞赛先暂停，当前重点改成课程报告。'
 const matter=reportedSwitchedMatterChoice(text)!
 assert.equal(matter.title,'校内创新赛')
 assert.equal(matter.focus,'课程报告')
 assert.ok(!matter.clauses.some(clause=>clause.text.includes('课程报告')))
 assert.deepEqual(reportedActionProgress(matter.clauses,matter.title,matter.scope),{state:'paused',choice:'accepted',resumed:false,quotes:['我接受先看报名要求','但这次完全没执行','竞赛先暂停']})
 for(const altered of ['如果'+text,text.replace('竞赛先暂停','课程报告先暂停'),text.replace('我还考虑参加','室友考虑参加'),text.replace('我接受','我拒绝')])assert.equal(reportedSwitchedMatterChoice(altered),null,altered)
})

test('conversation save errors are metadata; real external task failures remain reports',()=>{
 assert.equal(assistantRequestClause('上一轮页面提示保存失败'),true)
 for(const text of ['上次系统显示报名失败','上轮系统显示报名保存失败','上轮系统显示文件保存失败'])assert.equal(assistantRequestClause(text),false,text)
})
test('ownership separates actual new pursuits, third-party words, scope introductions and current-context needs',()=>{
 const clean=reportedPriorMatterTransition('我决定结束这件事。我现在决定转向就业探索。')!;assert.equal(clean.newPursuitDeclared,true);assert.equal(clean.requiresCurrentContext,false);assert.equal(clean.priorScopeReintroduced,false)
 const intro=reportedPriorMatterTransition('换一件事。我决定结束这件事。我现在决定转向就业探索。')!;assert.equal(intro.priorScopeReintroduced,true)
 const tired=reportedPriorMatterTransition('我今天很累。我决定结束这件事。我现在决定转向就业探索。')!;assert.equal(tired.requiresCurrentContext,true)
 assert.equal(reportedPriorMatterTransition('室友说“我决定结束这件事”。我现在决定转向就业探索。'),null)
 assert.equal(reportedPriorMatterTransition('如果我决定结束这件事，我就换个方向。'),null)
})
