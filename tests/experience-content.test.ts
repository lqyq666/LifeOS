import test from 'node:test'
import assert from 'node:assert/strict'
import { buildClauseCatalogue } from '../server/clause-catalogue.ts'
import { clauseReportsCompleted, deriveStructuralLinks, requiresExperienceCandidate, resolveCandidateContent, selectStructuralCandidate } from '../server/experience-content.ts'

const ANCHOR='2026-10-08T12:00:00.000Z' // Thursday 20:00 Shanghai

test('mixed quoted/code words and protected first-person siblings cannot manufacture a performed experience',()=>{
  for(const text of ['我正在看“我写完了申请书”这段例句。','我正在看`我完成了作业`这个测试字符串。','📝我正在看“我写完了申请书”这段例句。','“我”，完成了社团推文。','上次那件事的例句是“后来对方用了”。']){
    const clauses=buildClauseCatalogue(text)
    assert.equal(requiresExperienceCandidate(clauses),false,text)
    assert.equal(selectStructuralCandidate(text,clauses,ANCHOR),null,text)
  }
  const real='我写了标题为“完成了作业”的推文，老师说写得不错。'
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(real)),true,'real work outside quotes remains usable')
})

test('the saved campus wish to clarify delivery scope is not a completed experience',()=>{
 assert.equal(clauseReportsCompleted('先确认需求与交付范围'),false,'instruction fragment is not performed delivery')
 assert.equal(clauseReportsCompleted('不要把这个模板记为已经完成的行动'),false,'classification instruction is not a completion report')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我仍未开始查岗位。不要把这个模板记为已经完成的行动。')),false,'negated template state cannot enter the star map')
 const listening='还是上次那件请教的事，我先只想说说近况。'
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue(listening)),false,'conversational preference does not become a back-reference result')
 assert.equal(clauseReportsCompleted('我先只想说说近况'),false)
 const wishes=['我是成年大学生，想探索自由职业接单。我想先确认需求与交付范围，怎么开始？','我想交付一张海报。','我想先上线作品。']
 for(const text of wishes){const clauses=buildClauseCatalogue(text);assert.equal(requiresExperienceCandidate(clauses),false,text);assert.equal(selectStructuralCandidate(text,clauses,ANCHOR),null,text)}
 const mixed='我已经交付了一张海报。我想先确认下一单的交付范围，怎么开始？'
 const actual=selectStructuralCandidate(mixed,buildClauseCatalogue(mixed),ANCHOR)
 assert.equal(actual?.quote,'我已经交付了一张海报');assert.equal(requiresExperienceCandidate(buildClauseCatalogue(mixed)),true)
})

test('a completed first-person action report structurally requires a candidate',()=>{
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('上周五我把社团招新的推文和海报整套都交了，比约好的时间晚了两天，部长说整体效果还不错。')),true)
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我打算下周交海报，还没做完。')),false,'plans are not experiences')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('如果我交了海报会怎样？')),false,'hypothetical question')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('今天天气不错。')),false)
  assert.equal(clauseReportsCompleted('比约好的时间晚了两天'),false,'lateness alone is not the action')
  assert.equal(clauseReportsCompleted('整套都交了'),true)
})

test('the structural candidate keeps the whole comma chain with verbatim fields',()=>{
  const text='上周五我把社团招新的推文和海报整套都交了，比约好的时间晚了两天，部长说整体效果还不错。'
  const candidate=selectStructuralCandidate(text,buildClauseCatalogue(text),ANCHOR)!
  assert.equal(candidate.quote,'上周五我把社团招新的推文和海报整套都交了，比约好的时间晚了两天，部长说整体效果还不错')
  assert.equal(candidate.content.action,'上周五我把社团招新的推文和海报整套都交了')
  assert.equal(candidate.content.result,'部长说整体效果还不错')
  assert.equal(candidate.content.occurredAt,'2026年10月2日（周五）')
})

test('reported lookup and reduced-question outcomes are retained as verbatim experience results',()=>{
  const examples=[
    {text:'最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。',result:'后来同学能直接找到两份材料，少问了我一次'},
    {text:'回来反馈：我把奖学金材料按三条规则整理了一次，第二天大约20秒找到通知，但目前只发生过一次。',result:'第二天大约20秒找到通知'},
  ]
  for(const example of examples){
    const candidate=selectStructuralCandidate(example.text,buildClauseCatalogue(example.text),ANCHOR)!
    assert.equal(candidate.content.result,example.result,example.text)
  }
})

test('model-named handles outside the selected span drop the field, never the candidate',()=>{
  const text='我负责做了一整套推文和海报，约好周五交、我周日才交过去'
  const catalogue=buildClauseCatalogue(text)
  const selection={quote:'约好周五交、我周日才交过去',start:text.indexOf('约好'),end:text.indexOf('过去')+2}
  const inside=resolveCandidateContent(catalogue,selection,{action:{clauseId:'c1'},result:{clauseId:'c2'}},ANCHOR)
  assert.deepEqual(inside,{content:{action:'约好周五交',result:'我周日才交过去',occurredAt:''},dropped:[]})
  const outside=resolveCandidateContent(catalogue,selection,{action:{clauseId:'c0'}},ANCHOR)
  assert.equal(outside.content.action,'')
  assert.deepEqual(outside.dropped,['action'])
})

test('structural category links quote verbatim fragments and stay adjustable',()=>{
  const links=deriveStructuralLinks('上周五我把社团招新的推文和海报整套都交了，比约好的时间晚了两天，部长说整体效果还不错')
  const ids=links.map(link=>link.valueId)
  assert.ok(ids.includes('value-creation'),'a delivered poster set is creative work')
  assert.ok(ids.includes('value-growth'),'explicit feedback and lateness feed growth')
  for(const link of links)assert.ok(link.reason.includes('「'),'the reason names the verbatim fragment it matched')
  assert.deepEqual(deriveStructuralLinks('今天天气不错'),[],'small talk categorizes nowhere')
})
