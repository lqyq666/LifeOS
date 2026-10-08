import test from 'node:test'
import assert from 'node:assert/strict'
import { buildClauseCatalogue } from '../server/clause-catalogue.ts'
import { clauseReportsCompleted, deriveStructuralLinks, requiresExperienceCandidate, resolveCandidateContent, selectStructuralCandidate } from '../server/experience-content.ts'

const ANCHOR='2026-10-08T12:00:00.000Z' // Thursday 20:00 Shanghai

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
