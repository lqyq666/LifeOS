import test from 'node:test'
import assert from 'node:assert/strict'
import {buildClauseCatalogue} from '../server/clause-catalogue.ts'
import {clauseReportsCompleted,requiresExperienceCandidate,selectStructuralCandidate} from '../server/experience-content.ts'
import {assistantRequestClause} from '../server/user-command-spans.ts'

const action='今天我在课程小组里负责整理传感器采样数据，用老师提供的脚本绘图，发现两处异常并标注出来'
const instructions='这些是我这次亲自做过的事情，请记住背景和经过，帮我区分已有证据与仍不知道的部分，不把这次经历说成我已经有稳定科研能力'
test('recording and inference-boundary instructions never replace a concrete experience',()=>{
 const text=action+'。组员说标注帮助他检查了接线，但数据还没有重新测量。'+instructions+'。'
 const catalogue=buildClauseCatalogue(text),chosen=selectStructuralCandidate(text,catalogue,'2026-10-25T10:00:00Z')
 assert.ok(requiresExperienceCandidate(catalogue));assert.ok(chosen)
 assert.ok(chosen.quote.includes('传感器采样数据'));assert.ok(chosen.content.action.includes('标注出来'))
 assert.ok(!chosen.quote.includes('请记住'));assert.ok(!chosen.content.result.includes('说成'))
})
test('deictic source acknowledgment and requested inference boundaries are not independent achievements',()=>{
 assert.equal(clauseReportsCompleted('这些是我这次亲自做过的事情'),false)
 for(const text of ['请记住背景和经过','帮我区分已有证据与仍不知道的部分','不把这次经历说成我已经有稳定科研能力','不要把完成一次比赛说成我排斥合作'])assert.equal(assistantRequestClause(text),true,text)
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue(instructions)),false)
 for(const text of ['今天我整理了实验数据','我之前做过课程实验','我不把休息当作浪费时间','他把这次经历说成我的成绩']){
  assert.equal(assistantRequestClause(text),false,text)
 }
})
