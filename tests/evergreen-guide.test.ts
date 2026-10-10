import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {knowledgeIntent,guideContentHash,validateEvergreenGuide,guideIsUsable,methodPromptContext,reciprocalRankFusion} from '../server/evergreen-guide.ts'
import type {KnowledgeCard} from '../server/campus-knowledge.ts'
import {unsupportedMethodAssertion} from '../server/evergreen-scope-guard.ts'
const root='.planning/research/evergreen/'
const cards=readFileSync(root+'KB_GUIDES.jsonl','utf8').trim().split('\n').map(s=>JSON.parse(s)) as KnowledgeCard[]
const benchmark=JSON.parse(readFileSync(root+'KB_QUERY_BENCHMARK.json','utf8'))
test('frozen intent benchmark keeps listening, feedback, privacy and mixed requests distinct',()=>{
 const failures=benchmark.cases.filter((c:any)=>knowledgeIntent(c.text).decision!==c.expectedRoute)
 assert.deepEqual(failures,[])
 assert.match(knowledgeIntent('那客户又改需求了',{eventTitle:'第一笔设计交付',hasPriorGuide:true}).query,/第一笔设计交付/)
 assert.equal(knowledgeIntent('现在想验证创业需求，怎么开始？',{eventTitle:'准备考试'}).query.includes('准备考试'),false)
 assert.equal(knowledgeIntent('有什么依据支持先核验手机能否打开文件？').decision,'METHOD')
})
test('content edits invalidate review and all 112 branches retain conditions and executable steps',()=>{
 assert.equal(cards.length,32)
 assert.equal(cards.flatMap(c=>c.guide!.branches).length,112)
 for(const card of cards){
  validateEvergreenGuide(card)
  const edited=structuredClone(card);edited.guide!.smallestAction='改动后的动作'
  assert.throws(()=>validateEvergreenGuide(edited));assert.equal(guideIsUsable(edited),false)
  const pending=structuredClone(card);pending.status='unverified';pending.guide!.reviewStatus='needs_review'
  assert.equal(guideIsUsable(pending),false)
 }
})
test('context budget drops whole cards without losing scope and exclusions; RRF deduplicates',()=>{
 for(const card of cards){
  const full=methodPromptContext([card],card.guide!.branches[0].task,undefined,6000)
  assert.equal(full.knowledge.length,1)
  assert.deepEqual(full.knowledge[0].exclusions,card.guide!.exclusions)
  assert.equal(full.knowledge[0].untrustedPublicMethod,true)
  const tiny=methodPromptContext([card],card.title,undefined,400)
  assert.equal(tiny.knowledge.length,0)
 }
 assert.deepEqual(reciprocalRankFusion([['a','a','b'],['b','a']]).map(([id])=>id),['a','b'])
 const copy=structuredClone(cards[0]);copy.guide!.reviewStatus='needs_review'
 assert.equal(guideContentHash(copy.guide!),cards[0].guide!.contentHash)
})
test('six declared regression classes per card retain listening and professional boundaries',()=>{
 const data=JSON.parse(readFileSync(root+'KB_CARD_REGRESSIONS.json','utf8'))
 assert.equal(data.cases.length,192)
 assert.deepEqual(data.cases.filter((c:any)=>knowledgeIntent(c.text).decision!==c.route),[])
})
test('a cited method cannot turn bounded practice into guaranteed income or admission',()=>{
 assert.ok(unsupportedMethodAssertion('这个方法一定带来稳定收入。'))
 assert.ok(unsupportedMethodAssertion('照做保证录取。'))
 assert.equal(unsupportedMethodAssertion('一次付款不能证明稳定收入，也不能保证录取。'),null)
 assert.equal(unsupportedMethodAssertion('你担心这能保证成功吗？'),null)
})

test('a continued blocked method retains its branch and exposes feedback instead of an introductory tutorial',()=>{
 const card=cards.find(c=>c.guide!.canonicalKey==='priority-budget')!,branch=card.guide!.branches.at(-1)!
 const intent=knowledgeIntent('按上次办法，我没有开始，材料打不开，怎么办？',{eventTitle:'课程复习',hasPriorGuide:true})
 const used=[{guide_id:card.id,revision:card.revision,branch:branch.id,step_id:branch.steps[0].id,status:'blocked'}]
 const row=methodPromptContext([card],'怎么办？',intent,6000,used).knowledge[0]
 assert.equal(row.branch,branch.id)
 assert.equal(row.steps,undefined)
 assert.equal(row.smallestAction,undefined)
 assert.deepEqual(row.continuation,{stepId:branch.steps[0].id,status:'blocked',feedbackBranch:'blocked'})
 assert.equal(row.feedback,card.guide!.feedbackBranches.blocked)
 const stale=methodPromptContext([card],'怎么办？',intent,6000,[{...used[0],revision:card.revision+1}]).knowledge[0]
 assert.equal(stale.continuation,undefined,'old revisions never impersonate current use')
})

test('short failure carries continuation only with prior authorized method; explicit refusal wins',()=>{
 const intent=knowledgeIntent('还是不行',{eventTitle:'课程复习',hasPriorGuide:true})
 assert.equal(intent.decision,'NONE');assert.equal(intent.continuation,true);assert.equal(intent.stage,'adjust')
 assert.equal(knowledgeIntent('还是不行').continuation,false)
 assert.equal(knowledgeIntent('我不做这个申请了，不要换个办法推我').decision,'NONE')
})
