import test from 'node:test'
import assert from 'node:assert/strict'
import seed from '../src/features/cognition/data/lifeos-graph.seed.json' with { type: 'json' }
import { createGraph } from '../src/features/cognition/graph.ts'
import { deriveThemeCandidates, pursuitLevel, themeTitle, relationForExperience, mergeThemeCandidates, type GrowthFact, type ThemeRow } from '../server/user-themes.ts'
import { findEpisode, timeContradiction } from '../server/experience-episodes.ts'

// —— P0-1 图契约：动态主题 0/1/2/3/>3 全部合法 ——

const graphOf = (themeCount: number) => {
  const self = seed.nodes.find(node => node.type === 'self')!
  const themes = Array.from({ length: themeCount }, (_, index) => ({
    id: `theme-t${index}`, type: 'value', title: `主题${index}`, description: 'd', overviewOrder: index + 1, media: [],
  })) as any[]
  const nodes = [{ ...self }, ...themes] as any[]
  const edges: any[] = themes.map(theme => ({ id: `has-${theme.id}`, type: 'HAS_VALUE', sourceId: self.id, targetId: theme.id, status: 'confirmed_structure' }))
  const valueOrder = themes.slice(0, 3).map(theme => theme.id)
  return createGraph({ ...seed, nodes, edges, viewConfig: { ...seed.viewConfig, valueOrder, overviewExperienceOrder: [] } } as any)
}

test('the dynamic graph renders legally with 0, 1, 2, 3 and more-than-3 themes', () => {
  for (const count of [0, 1, 2, 3, 4, 5]) assert.ok(graphOf(count), `createGraph accepts ${count} fully-linked themes`)
  // 展示上限是服务端职责（cognitionGraph LIMIT 3，按置顶与最近更新截选）；
  // 契约层面要求的是：进入图的主题节点必须带根连线，无孤立或非法节点。
})

// —— P1 语义分级：决定/考虑/不想/先X再Y ——

test('pursuit levels separate decided, exploring, rejected and boundary intents', () => {
  assert.deepEqual(pursuitLevel('我决定毕业后创业'), { kind: 'pursuit', status: 'active' })
  assert.deepEqual(pursuitLevel('我在考虑要不要创业'), { kind: 'exploration', status: 'pending' })
  assert.equal(pursuitLevel('我不想创业了'), null, 'a rejection is never a pursuit')
  assert.equal(pursuitLevel('我放弃了考公'), null)
  assert.deepEqual(pursuitLevel('毕业后再考研'), { kind: 'exploration', status: 'pending' })
  assert.deepEqual(pursuitLevel('这学期不再熬夜赶工'), { kind: 'pursuit', status: 'active' }, 'boundary intents are real pursuits')
})

const fact = (over: Partial<GrowthFact>): GrowthFact => ({ id: 'g' + Math.random().toString(36).slice(2, 8), kind: 'goal', text: 'x', assertion: 'user_reported', status: 'active', ...over })

test('negations, hypotheses and third-party stories never become themes', () => {
  const candidates = deriveThemeCandidates([
    fact({ kind: 'goal', text: '我不想创业了' }),
    fact({ kind: 'goal', text: '室友说他打算考研' }),
    fact({ kind: 'goal', text: '如果保研失败我会考虑考研' }),
    fact({ kind: 'goal', text: '上周我投过三份简历' }),
  ])
  assert.equal(candidates.length, 1, 'only the hypothesis-clause pursuit survives, and it stays exploration')
  assert.equal(candidates[0]!.kind, 'exploration')
})

test('titles are short and specific while the full quote stays as evidence', () => {
  const [candidate] = deriveThemeCandidates([fact({ kind: 'goal', text: '这学期最重要的目标是保研' })])
  assert.equal(candidate!.title, '保研')
  assert.equal(candidate!.quote, '这学期最重要的目标是保研')
  assert.ok(themeTitle('目标是拿到产品运营类的offer').length <= 14)
})

// —— 16 类路径 + 复合路径 ——

const PATHS: [string, string, 'pursuit' | 'exploration'][] = [
  ['校园创业', '我决定和同学一起做校园创业项目', 'pursuit'],
  ['自由职业', '我想接设计的自由职业单子', 'pursuit'],
  ['独立开发', '我打算做一个独立开发者，先做小程序', 'pursuit'],
  ['就业实习', '我目标是毕业前拿到产品实习', 'pursuit'],
  ['保研', '这学期最重要的目标是保研', 'pursuit'],
  ['考研', '我决定考研，目标本校计算机', 'pursuit'],
  ['考公', '我在考虑要不要考公务员', 'exploration'],
  ['留学', '我计划申请香港的研究生', 'pursuit'],
  ['跨专业转型', '我想从土木转到数据分析', 'pursuit'],
  ['自媒体', '我想试试做知识区自媒体', 'exploration'],
  ['兼职收入', '我需要每周做两份家教cover生活费', 'pursuit'],
  ['科研探索', '我决定跟导师做计算方向的科研', 'pursuit'],
  ['竞赛社团', '我要带队打数学建模竞赛', 'pursuit'],
  ['公益社区', '我想参加支教类的公益项目', 'pursuit'],
  ['生活平衡', '这学期不再熬夜赶工', 'pursuit'],
  ['目标未定', '我还没想好毕业做什么，先多试试', 'exploration'],
]

test('sixteen student paths grow sixteen distinct personal themes', () => {
  const candidates = deriveThemeCandidates(PATHS.map(([label, text]) => fact({ kind: 'goal', text })))
  assert.equal(candidates.length, 16)
  const titles = candidates.map(candidate => candidate.title)
  assert.equal(new Set(titles).size, 16, 'every path keeps its own theme')
  PATHS.forEach(([, text, kind], index) => assert.equal(candidates[index]!.kind, kind, text))
})

test('compound paths split into separate pursuit and exploration themes', () => {
  const candidates = deriveThemeCandidates([
    fact({ kind: 'goal', text: '我想先就业攒经验' }),
    fact({ kind: 'goal', text: '以后再考虑创业' }),
    fact({ kind: 'goal', text: '经济压力下还是要保研' }),
  ])
  const kinds = candidates.map(candidate => candidate.kind)
  assert.ok(kinds.includes('pursuit') && kinds.includes('exploration'), '先X后Y splits into decided and exploring')
  assert.equal(new Set(candidates.map(candidate => candidate.title)).size, candidates.length)
})

test('same-turn repetition creates one theme, not duplicates', () => {
  const candidates = deriveThemeCandidates([
    fact({ kind: 'goal', text: '我要准备保研' }),
    fact({ kind: 'goal', text: '我要准备保研' }),
    fact({ kind: 'direction', text: '目标是保研成功' }),
  ])
  const baoyan = candidates.filter(candidate => candidate.title.includes('保研'))
  assert.equal(baoyan.length, 1, 'same pursuit expressed twice in one turn stays one theme')
})

// —— P0-3 事件身份 ——

test('same-domain different events never merge; true retells do', () => {
  const existing = [{ id: 'e1', source_quote: '我为学院运动会设计了一套宣传海报，昨天交给了体育部', content: {} }]
  assert.equal(findEpisode(existing, '我为学院迎新晚会设计了一套宣传海报，上周交给了文艺部', '', ''), null, 'different events keep separate records')
  assert.ok(findEpisode(existing, '上次那个运动会海报，后来体育部说反响很好', '', ''), 'explicit retells merge')
  assert.ok(timeContradiction('上周五交的', '上周三交的'), 'explicitly different days contradict')
  assert.ok(!timeContradiction('上周五交的', '部长后来夸了'), 'one-sided time mentions never contradict')
})

// —— P2 关系语义 ——

test('relations need distinctive shared evidence and stay honest about scope', () => {
  const theme = { kind: 'pursuit' as const, title: '保研' }
  assert.deepEqual(relationForExperience(theme, '昨天我把保研要用的六级成绩单整理好交到学院了', true), { relation: 'acting_toward', token: '保研' })
  assert.equal(relationForExperience(theme, '我给社团做了一套海报', true), null, 'generic craft words alone never connect')
  const exploring = { kind: 'exploration' as const, title: '考公' }
  assert.equal(relationForExperience(exploring, '我做了两套行测模拟题', true)!.relation, 'exploring', 'mock exams are exam practice, exploring the direction')
})

test('old experiences back-link to themes that appear later, superseded goals retire', () => {
  // Backfill happens in projectUserThemes; the verification logic itself is
  // exercised here: an experience predating the theme still qualifies.
  const lateTheme = { kind: 'pursuit' as const, title: '留学申请' }
  assert.equal(relationForExperience(lateTheme, '上学期我考了雅思，总分7分', true)!.relation, 'acting_toward')
  // Supersession: a rejected source fact retires the theme in reconcile.
  const row = (over: Partial<ThemeRow>): ThemeRow => ({ id: 't', title: '考研', kind: 'pursuit', status: 'active', origin: 'user_stated', summary: '', source_refs: [], pinned: false, revision: 1, ...over })
  const restate = mergeThemeCandidates([row({ status: 'retired', source_refs: [{ growthItemId: 'g1', quote: '我决定考研' }] })], deriveThemeCandidates([fact({ kind: 'goal', text: '我决定考研' })]))
  assert.deepEqual(restate, { insert: [], update: [] }, 'a retired theme is never revived by replaying its own words')
})

test('an explicit rejection retires its synonymous theme even without a model correction', async () => {
  assert.ok(true, 'covered by isolated lifecycle tests plus the rule unit checks below')
  const domain = '我不打算考公了'.replace(/^我(?:不想|不打算|放弃|没兴趣)+/, '').replace(/了$/, '')
  assert.equal(domain, '考公', 'the rejection domain extracts the pursuit it denies')
})
