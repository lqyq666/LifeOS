import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveThemeCandidates, mergeThemeCandidates, relationForExperience, themeTitle, type GrowthFact, type ThemeRow } from '../server/user-themes.ts'
import { findEpisode, episodeSimilarity, mergeContent } from '../server/experience-episodes.ts'
import { derivePatternProposals, type PatternExperience } from '../server/experience-patterns.ts'
import { requiresExperienceCandidate } from '../server/experience-content.ts'
import { buildClauseCatalogue } from '../server/clause-catalogue.ts'

const fact = (over: Partial<GrowthFact>): GrowthFact => ({ id: 'g-' + Math.random().toString(36).slice(2, 8), kind: 'goal', text: '我要准备保研', assertion: 'user_reported', status: 'active', ...over })

test('ending a main path stays a boundary rather than becoming the next pursuit',()=>{
 const rows=deriveThemeCandidates([fact({text:'我决定本阶段就业优先'}),fact({text:'不再把自由职业作为主线'}),fact({kind:'preference',text:'不再把自由职业作为主线'}),fact({kind:'preference',text:'我暂停扩大接单'})])
 assert.deepEqual(rows.map(x=>x.title),['就业'])
 assert.equal(deriveThemeCandidates([fact({text:'我不再熬夜'})]).length,1,'a positive habit boundary remains a pursuit')
})

test('only user-stated goals and pursuits project into themes', () => {
  const candidates = deriveThemeCandidates([
    fact({ kind: 'goal', text: '我要准备保研' }),
    fact({ kind: 'direction', text: '打算毕业后先就业' }),
    fact({ kind: 'preference', text: '更看重能动手做出东西' }),
    fact({ kind: 'goal', text: 'AI 猜我想考研', assertion: 'ai_observation' }),
    fact({ kind: 'constraint', text: '每周只有十小时' }),
    fact({ kind: 'goal', text: '已暂停的目标', status: 'paused' }),
  ])
  assert.deepEqual(candidates.map(candidate => candidate.kind), ['pursuit', 'pursuit', 'valued_point'])
  assert.equal(themeTitle('我想要准备保研'), '保研', 'wish prefixes strip down to the pursuit itself')
})

test('theme upsert is idempotent by source and title, and retired themes stay retired', () => {
  const row = (over: Partial<ThemeRow>): ThemeRow => ({ id: 't1', title: '准备保研', kind: 'pursuit', status: 'active', origin: 'user_stated', summary: '', source_refs: [{ growthItemId: 'g1', quote: '我要准备保研' }], pinned: false, revision: 1, ...over })
  const candidatesOf = (input: GrowthFact) => deriveThemeCandidates([input])
  const again = mergeThemeCandidates([row({})], candidatesOf(fact({ id: 'g1', text: '我要准备保研' })))
  assert.deepEqual(again, { insert: [], update: [] }, 'same growth source never duplicates')
  const reworded = mergeThemeCandidates([row({ source_refs: [] })], candidatesOf(fact({ id: 'g9', text: '我要准备保研' })))
  assert.equal(reworded.insert.length, 0)
  assert.equal(reworded.update.length, 1, 'same normalized title merges into the existing theme')
  const retired = mergeThemeCandidates([row({ status: 'retired', source_refs: [] })], candidatesOf(fact({ id: 'g9', text: '我要准备保研' })))
  assert.deepEqual(retired, { insert: [], update: [] }, 'a revoked theme is never revived by re-stating')
})

test('experiences link to themes only through shared content tokens', () => {
  const theme = { kind: 'pursuit' as const, title: '保研' }
  assert.deepEqual(relationForExperience(theme, '上周五交了保研材料的初稿', true), { relation: 'acting_toward', token: '保研' })
  assert.equal(relationForExperience(theme, '上周五交了社团海报', true), null, 'unrelated experiences never link')
  assert.equal(relationForExperience({ kind: 'pursuit' }, '上周五交了保研材料', true), null, 'a theme without a title links nowhere')
  assert.deepEqual(relationForExperience({ kind: 'valued_point', title: '看重能动手做出东西' }, '这次尝试动手做了个demo', true), { relation: 'exploring', token: '动手' })
})

test('the same episode retold merges instead of duplicating', () => {
  const existing = [{ id: 'e1', source_quote: '上周五我把社团招新的推文和海报整套都交了，比约好的时间晚了两天', content: { action: '上周五我把社团招新的推文和海报整套都交了', result: '部长说整体效果还不错' } }]
  assert.ok(findEpisode(existing, '上次说过的那套招新推文和海报，我上周五才交了', '', ''), 'a retelling matches the original episode')
  assert.equal(findEpisode(existing, '我参加了英语角的主持', '', ''), null, 'a different matter never merges')
  const merged = mergeContent(existing[0].content, { action: '', result: '后来部长又表扬了一次', occurredAt: '' })
  assert.equal(merged.result, '后来部长又表扬了一次', 'latest non-empty result wins')
  assert.equal(merged.action, existing[0].content.action, 'the original action is kept')
})

test('patterns demand both anchors in the same experience', () => {
  const experience = (id: string, over: Partial<PatternExperience>): PatternExperience => ({ id, revision: 1, conversationId: 'c', sourceMessageId: 'm', quote: 'q', action: '', result: '', valueIds: [], ...over })
  const feedbackOnly = [experience('a', { result: '部长给了反馈' }), experience('b', { result: '导师提了意见' })]
  assert.equal(derivePatternProposals(feedbackOnly).find(proposal => proposal.behaviorKey === 'feedback-iterate'), undefined, 'receiving feedback twice does not imply iterating')
  const both = [...feedbackOnly, experience('a', {})]
  both[0] = experience('a', { result: '部长给了反馈，我按建议调整了排版' })
  both[1] = experience('b', { result: '导师提了意见后我修改了结论部分' })
  const proposals = derivePatternProposals(both, 'b')
  const iterate = proposals.find(proposal => proposal.behaviorKey === 'feedback-iterate')!
  assert.ok(iterate, 'feedback plus an in-experience revision supports the observation')
  assert.ok(!iterate.behavior.includes('先做出成果'), 'the wording stays descriptive of what the quotes show')
  const late = derivePatternProposals([experience('c', { result: '比约定晚了两天交' }), experience('d', { result: '迟了一天补交' })], 'd').find(proposal => proposal.behaviorKey === 'deliver-late')!
  assert.ok(late.behavior.includes('晚于约定'), 'descriptive only')
  assert.ok(!late.behavior.includes('过关'), 'the unsupported quality claim is gone')
})

test('过-shaped completion reports now qualify as experiences', () => {
  for (const text of ['我参加过两次数学建模比赛。', '大二时我投过几份简历，都石沉大海。', '我帮过学长整理过一次活动素材。']) {
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(text)), true, text)
  }
  for (const text of ['我想参加下次的比赛。', '他参加过两次比赛。', '如果我投过简历会怎样？']) {
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(text)), false, text)
  }
  assert.ok(episodeSimilarity('我参加过两次数学建模比赛', '我参加过两次数学建模比赛') > 0.9)
  assert.ok(episodeSimilarity('上周五交了推文和海报', '那套招新推文和海报上周五才交') >= 0.4, 'retellings clear the overlap threshold')
})
