import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {openingQuestionDraft,safeEarlySentence,openUnreportedChoiceQuestion,repairUnsupportedPreferenceClaim} from '../server/reply-draft.ts'
import {reportedEvidenceFromText} from '../server/turn-contract.ts'
import {repairReviewedDefects} from '../server/review-repairs.ts'
const saved=JSON.parse(readFileSync(new URL('./fixtures/od-semantic-preview-failures.json',import.meta.url),'utf8'))
const turn=(chain:string,index:number)=>saved.turns.find((t:any)=>t.chain===chain&&t.index===index)

test('actual OD locality-fit relation is grounded across framing and coordinated criteria',()=>{
 const x=turn('study-work-choice',3),basis=reportedEvidenceFromText(turn('study-work-choice',2).user).preferences
 const fixed=repairUnsupportedPreferenceClaim(x.raw.reply,x.user,basis)
 assert.ok(fixed)
 assert.doesNotMatch(fixed!,/其他城市或院校里.*不违背/)
 assert.ok(fixed!.includes('家里只希望稳定')&&fixed!.includes('位于目前城市')&&fixed!.includes('投入上限4小时'))
 for(const reply of ['其他城市的选项需要权衡你留城的偏好。','同城其他院校可能满足留城偏好。','其他城市的院校提供远程课程，仍可住在本城，是否符合留城偏好需另核实。','其他城市的选项未必符合留城偏好。'])assert.equal(repairUnsupportedPreferenceClaim(reply,x.user,basis),null,reply)
})

test('actual OD causal support is withheld in previews and calibrated as a whole inference',()=>{
 const x=turn('no-direction',2)
 assert.equal(safeEarlySentence(JSON.stringify(x.raw),120,'reply',x.user),null)
 const fixed=repairReviewedDefects(x.raw.reply,x.user)?.reply??x.raw.reply
 assert.ok(fixed.includes('这次先定三条规则后同学少问一次'))
 assert.match(fixed,/待验证的假设：提前分类能减少沟通/)
 assert.doesNotMatch(fixed,/能是否|支持提前分类能减少沟通/)
 for(const reply of ['同学少问了一次。','提前分类可能减少沟通，这仍是待验证的假设。','你有减少反复找东西的意愿。'])assert.equal(repairReviewedDefects(reply,x.user)?.reply??reply,reply,reply)
})

test('actual OD open taxonomy question removes only unknown examples before preview and final display',()=>{
 const x=turn('no-direction',1),expected='你实际分了哪几类？'
 assert.equal(openingQuestionDraft(JSON.stringify(x.raw),'lead',x.user),expected)
 assert.equal(openUnreportedChoiceQuestion(x.raw.reply,x.user),x.raw.reply.replace(x.raw.lead,expected))
 assert.equal(openingQuestionDraft(JSON.stringify({lead:'你实际分了哪几类，比如按主题、时间还是用途？'}),'lead','我按主题、时间和用途分了类。'),x.raw.lead,'source-reported alternatives stay available')
 assert.equal(openingQuestionDraft(JSON.stringify({lead:'你实际分了哪几类，比如按主题、时间还是用途？'}),'lead','“我按主题、时间和用途分了类。”'),expected,'quoted text does not authorize personal examples')
 assert.equal(openUnreportedChoiceQuestion('这次因为什么放松，是运动还是室友？',x.user)?.includes('运动还是室友'),false,'unsupported causal alternatives stay guarded')
})
