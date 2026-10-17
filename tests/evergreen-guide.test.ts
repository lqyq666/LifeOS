import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {knowledgeIntent,guideContentHash,validateEvergreenGuide,guideIsUsable,methodPromptContext,reciprocalRankFusion} from '../server/evergreen-guide.ts'
import type {KnowledgeCard} from '../server/campus-knowledge.ts'
import {unsupportedMethodAssertion} from '../server/evergreen-scope-guard.ts'
const root='.planning/research/evergreen/'
const cards=readFileSync(root+'KB_GUIDES.jsonl','utf8').trim().split('\n').map(s=>JSON.parse(s)) as KnowledgeCard[]
const benchmark=JSON.parse(readFileSync(root+'KB_QUERY_BENCHMARK.json','utf8'))

test('a natural method reference uses only available user history and keeps new matters separate',()=>{
 const previous='请用当前已审核的“从经历整理本人贡献”攻略。'
 const text='那就用那个贡献核对方法吧。'
 assert.match(knowledgeIntent(text,{eventTitle:'岗位核对表',lastUserTexts:[previous]}).query,/从经历整理本人贡献/)
 assert.match(knowledgeIntent('先用那个贡献核对方法，只核对表格页面这一项。',{lastUserTexts:[previous,...Array(5).fill('接着核对这一项。')]}).query,/从经历整理本人贡献/)
 assert.doesNotMatch(knowledgeIntent(text,{eventTitle:'岗位核对表',lastUserTexts:[]}).query,/从经历整理本人贡献/)
 assert.doesNotMatch(knowledgeIntent('我想换个学习方法',{lastUserTexts:[previous]}).query,/从经历整理本人贡献/)
 assert.doesNotMatch(knowledgeIntent(text,{lastUserTexts:['同学说请用“从经历整理本人贡献”攻略。']}).query,/从经历整理本人贡献/)
})
test('an unresolved method reference is clarified instead of silently switching guides',()=>{
 const missing=knowledgeIntent('接着上次第三题的那个方法，我找不到适用的已解示例，课件链接也打不开。先不重做计划，怎样继续？')
 assert.equal(missing.decision,'CLARIFY')
 assert.equal(missing.reason,'method_reference_missing')
 assert.equal(knowledgeIntent('接着上次第三题的那个方法，怎样继续？',{hasPriorGuide:true}).decision,'METHOD')
})
test('personal interview feedback stays in the event review lane',()=>{
 const intent=knowledgeIntent('我问了一个同学，他说课表冲突不好找。我没有交付产品，也没人采用或付款。下一步怎么判断这个线索？')
 assert.equal(intent.decision,'NONE')
 assert.equal(intent.reason,'personal_feedback_review')
 assert.equal(intent.stage,'adjust')
})
test('actual named approved guide request opens method retrieval without fabricating approval',()=>{
 const text='接着这份岗位核对表里的本人证据栏：上学期那个课程工具中，表格页面由我负责，其他部分是队友做的；采用、付款和效果仍未知。我现在想分清自己的贡献和队友的贡献。请用当前已审核的“从经历整理本人贡献”攻略，给出一项能开始、能停止的核对动作，并展示公开来源和适用边界。先不写简历成品，不把作品当稳定能力或商业成绩。'
 assert.equal(knowledgeIntent(text).decision,'METHOD')
 assert.equal(knowledgeIntent('我尝试过，但打不开。请用已审核的学习攻略核对。').decision,'METHOD')
 for(const input of ['不要用当前攻略，只想说说。','同学说请用当前攻略。','“请用当前已审核的攻略。”','如果请用当前攻略就会好吗？'])assert.notEqual(knowledgeIntent(input).reason,'explicit_task',input)
})
test('frozen intent benchmark keeps listening, feedback, privacy and mixed requests distinct',()=>{
 const failures=benchmark.cases.filter((c:any)=>knowledgeIntent(c.text).decision!==c.expectedRoute)
 assert.deepEqual(failures,[])
 assert.match(knowledgeIntent('那客户又改需求了',{eventTitle:'第一笔设计交付',hasPriorGuide:true}).query,/第一笔设计交付/)
 assert.equal(knowledgeIntent('现在想验证创业需求，怎么开始？',{eventTitle:'准备考试'}).query.includes('准备考试'),false)
 assert.equal(knowledgeIntent('有什么依据支持先核验手机能否打开文件？').decision,'METHOD')
 for(const text of ['只会跟着答案抄，有什么循序练法？','想把一章概念连起来，有什么学法？','做过一次仍没把握，找个练法'])assert.equal(knowledgeIntent(text).decision,'METHOD')
 assert.equal(knowledgeIntent('只是想说说，不要给我练法').decision,'NONE')
 assert.equal(knowledgeIntent('有什么新鲜事？').decision,'NONE')
})

test('retained RV2 refusal wins over an unchanged blocker; quoted refusals and renewed requests do not',()=>{
 for(const text of ['还是那份材料，打不开的情况没有变。我现在只想说一下烦躁，先别给方法。','材料打不开，暂时别帮我想办法。','先听我说一下，不用给建议。']){
  assert.equal(knowledgeIntent(text).reason,'listening_or_refusal',text)
 }
 for(const text of ['同学说：“先别给方法”。我想知道怎么准备？','如果我说“先别给方法”，怎么理解？','先别给方法。但现在请帮我想想怎么调整。'])assert.notEqual(knowledgeIntent(text).reason,'listening_or_refusal',text)
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
