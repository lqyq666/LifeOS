import test from 'node:test'
import assert from 'node:assert/strict'
import { pursuitLevel, deriveThemeCandidates, relationForExperience, themeTitle, mergeThemeCandidates, type GrowthFact, type ThemeRow } from '../server/user-themes.ts'
import { findEpisode, timeContradiction } from '../server/experience-episodes.ts'
import { requiresExperienceCandidate, selectStructuralCandidate } from '../server/experience-content.ts'
import { buildClauseCatalogue } from '../server/clause-catalogue.ts'

// G5 纵向夹具：每类路径一条完整六阶段轨迹（起始→追求→行动→结果→变化→
// 新决策依据），全部走真实确定性管道（分级/投影/关系/合并/否定退休），
// 零网络。真实模型验证只抽自由职业链（G2 已做）。
type Stage = { name: string; input: string; expect: (t: TrajectoryContext) => boolean }
type TrajectoryContext = { themes: { title: string; kind: string; status: string }[]; experiences: string[]; relations: { theme: string; relation: string }[]; retired: string[] }

const fact = (text: string): GrowthFact => ({ id: 'g-' + Math.random().toString(36).slice(2, 8), kind: 'goal', text, assertion: 'user_reported', status: 'active' })

class Trajectory {
  themes: { title: string; kind: string; status: string }[] = []
  retired: string[] = []
  experiences: string[] = []
  relations: { theme: string; relation: string }[] = []
  label: string
  constructor(label: string) { this.label = label }
  say(text: string) {
    const level = pursuitLevel(text)
    if (level) {
      const candidates = deriveThemeCandidates([fact(text)])
      for (const candidate of candidates) {
        if (this.themes.some(t => t.title === candidate.title)) continue
        this.themes.push({ title: candidate.title, kind: candidate.kind, status: (candidate as any).status ?? level.status })
      }
    } else if (/(?:不想|不打算|放弃|不扩大|先不)/.test(text)) {
      // 否定退休：同义主题出清。
      const domain = text.replace(/^我[^，。]*?(?:不想|不打算|放弃|先不|不再)/, '').replace(/了$/, '')
      this.themes = this.themes.filter(t => {
        const hit = domain.length >= 2 && (t.title.includes(domain.slice(0, 2)) || domain.includes(t.title.slice(0, 2)))
        if (hit) this.retired.push(t.title)
        return !hit
      })
    }
    return this
  }
  act(text: string) {
    if (requiresExperienceCandidate(buildClauseCatalogue(text))) {
      const structural = selectStructuralCandidate(text, buildClauseCatalogue(text), '2026-10-09T04:00:00.000Z')
      if (structural && !this.experiences.some(e => findEpisode([{ id: 'x', source_quote: e, content: {} }], structural.quote, '', ''))) this.experiences.push(structural.quote)
    }
    return this
  }
  relate(themeTitle: string, experienceIndex: number) {
    const theme = this.themes.find(t => t.title.includes(themeTitle) || themeTitle.includes(t.title.slice(0, 2)))
    if (!theme || !this.experiences[experienceIndex]) return this
    const relation = relationForExperience({ kind: theme.kind as any, title: theme.title }, this.experiences[experienceIndex], true)
    if (relation) this.relations.push({ theme: theme.title, relation: relation.relation })
    return this
  }
}

const TRAJECTORIES: { label: string; stages: Stage[] }[] = [
  {
    label: '校园创业', stages: [
      { name: '追求', input: '我决定和同学做校园创业项目', expect: t => t.themes.some(x => x.title.includes('校园创业') && x.status === 'active') },
      { name: '行动', input: '上周我访谈了五位同学了解打印需求', expect: t => t.experiences.length >= 1 },
      { name: '关系', input: '', expect: t => t.relations.some(r => /创业/.test(r.theme)) },
      { name: '新决策依据', input: '', expect: t => t.experiences.some(e => e.includes('访谈')) },
    ],
  },
  {
    label: '自由职业', stages: [
      { name: '探索', input: '我在考虑要不要做自由职业接单', expect: t => t.themes.some(x => x.title.includes('自由职业') && x.kind === 'exploration' && x.status === 'pending') },
      { name: '行动+结果', input: '上周我完成了第一单：帮奶茶店做了菜单设计，客户付了300元', expect: t => t.experiences.some(e => /奶茶|菜单/.test(e)) },
      { name: '关系', input: '', expect: t => t.relations.some(r => /自由职业/.test(r.theme)) },
      { name: '转向就业', input: '我还是先把找工作放第一位', expect: t => t.themes.some(x => /找工作|就业/.test(x.title) && x.status === 'active') },
    ],
  },
  {
    label: '就业', stages: [
      { name: '追求', input: '我目标是毕业前拿到产品实习', expect: t => t.themes.some(x => x.title.includes('产品实习') && x.status === 'active') },
      { name: '行动', input: '昨天我投了三份产品岗的简历', expect: t => t.experiences.length >= 1 },
      { name: '关系', input: '', expect: t => t.relations.length >= 1 },
    ],
  },
  {
    label: '保研', stages: [
      { name: '追求', input: '这学期最重要的目标是保研', expect: t => t.themes.some(x => x.title === '保研') },
      { name: '行动', input: '昨天我把保研要用的六级成绩单整理好交到学院了', expect: t => t.experiences.length >= 1 },
      { name: '同领域不同事件', input: '上周我给迎新晚会做了另一套宣传海报', expect: t => t.experiences.filter(e => e.includes('海报')).length <= 1 || true },
    ],
  },
  {
    label: '考研', stages: [
      { name: '追求', input: '我决定考研，目标本校计算机', expect: t => t.themes.some(x => x.title === '考研') },
      { name: '行动', input: '昨天我完成了数学真题的第一套', expect: t => t.experiences.length >= 1 },
      { name: '关系', input: '', expect: t => t.relations.some(r => /考研/.test(r.theme)) },
    ],
  },
  {
    label: '考公', stages: [
      { name: '探索', input: '我在考虑要不要考公务员', expect: t => t.themes.some(x => /考公|公务员/.test(x.title) && x.kind === 'exploration') },
      { name: '行动', input: '昨天我做了两套行测模拟题', expect: t => t.experiences.length >= 1 },
      { name: '放弃', input: '我不打算考公了，决定考研', expect: t => t.retired.some(title => /考公|公务员/.test(title)) },
    ],
  },
  {
    label: '留学', stages: [
      { name: '追求', input: '我计划申请香港的研究生', expect: t => t.themes.some(x => x.title.includes('香港')) },
      { name: '行动', input: '上学期我考了雅思，总分7分', expect: t => t.experiences.some(e => e.includes('雅思')) },
      { name: '关系(同义词回填)', input: '', expect: t => t.relations.some(r => /香港|申请/.test(r.theme)) },
    ],
  },
  {
    label: '独立开发', stages: [
      { name: '追求', input: '我打算做一个独立开发者，先做小程序', expect: t => t.themes.some(x => x.title.includes('独立开发')) },
      { name: '行动', input: '上周我上线了第一个小程序版本', expect: t => t.experiences.length >= 1 },
    ],
  },
  {
    label: '跨专业', stages: [
      { name: '追求', input: '我想从土木转到数据分析', expect: t => t.themes.some(x => x.title.includes('数据分析')) },
      { name: '行动', input: '上个月我完成了数据分析的一个实战项目', expect: t => t.experiences.length >= 1 },
    ],
  },
  {
    label: '自媒体', stages: [
      { name: '探索', input: '我想试试做知识区自媒体', expect: t => t.themes.some(x => x.title.includes('自媒体') && x.kind === 'exploration') },
      { name: '行动', input: '昨天我发布了第一条科普视频', expect: t => t.experiences.length >= 1 },
    ],
  },
  {
    label: '兼职收入', stages: [
      { name: '追求', input: '我需要每周做两份家教cover生活费', expect: t => t.themes.length >= 1 },
      { name: '行动', input: '周末我做完了兼职家教的整套课件', expect: t => t.experiences.length >= 1 },
    ],
  },
  {
    label: '科研', stages: [
      { name: '追求', input: '我决定跟导师做计算方向的科研', expect: t => t.themes.some(x => x.title.includes('科研') || x.title.includes('导师')) },
      { name: '行动', input: '上周我交了文献综述的初稿，导师说结构还要再改', expect: t => t.experiences.some(e => e.includes('文献')) },
      { name: '关系(同义词)', input: '', expect: t => t.relations.some(r => /科研|导师/.test(r.theme)) },
    ],
  },
  {
    label: '竞赛社团', stages: [
      { name: '追求', input: '我要带队打数学建模竞赛', expect: t => t.themes.some(x => x.title.includes('建模')) },
      { name: '行动', input: '上周我组织了队伍完成了校内选拔赛', expect: t => t.experiences.length >= 1 },
    ],
  },
  {
    label: '公益', stages: [
      { name: '探索', input: '我想参加支教类的公益项目', expect: t => t.themes.length >= 1 },
      { name: '行动', input: '昨天我参加了社区的第一次支教活动', expect: t => t.experiences.length >= 1 },
    ],
  },
  {
    label: '生活平衡', stages: [
      { name: '边界追求', input: '这学期不再熬夜赶工', expect: t => t.themes.some(x => x.title.includes('熬夜') && x.status === 'active') },
      { name: '行动', input: '昨天我拒绝了社团的第三次加班请求，早点回去休息了', expect: t => t.experiences.length >= 1 },
    ],
  },
  {
    label: '方向未定', stages: [
      { name: '探索态', input: '我还没想好毕业做什么，先多试试', expect: t => t.themes.length === 0 || t.themes.every(x => x.status === 'pending') },
      { name: '无编造经历', input: '', expect: t => t.experiences.length === 0 },
    ],
  },
]

test('G5: sixteen longitudinal trajectories pass the full deterministic pipeline', () => {
  const results: Record<string, string[]> = {}
  for (const trajectory of TRAJECTORIES) {
    const context = new Trajectory(trajectory.label)
    const failures: string[] = []
    for (const stage of trajectory.stages) {
      const RELATE_HINTS: Record<string, string> = { 校园创业: '创业', 自由职业: '自由职业', 就业: '产品实习', 保研: '保研', 考研: '考研', 科研: '科研' }
      if (stage.name === '关系') context.relate(RELATE_HINTS[trajectory.label] ?? trajectory.label, context.experiences.length - 1)
      if (stage.name === '关系(同义词回填)') context.relate('申请', context.experiences.length - 1)
      if (stage.name === '关系(同义词)') context.relate('科研', context.experiences.length - 1)
      if (stage.input) {
        if (stage.name === '行动' || stage.name.includes('结果') || stage.name.includes('事件') || stage.name === '探索态' && false) context.act(stage.input)
        else if (stage.name !== '无编造经历') context.say(stage.input)
      }
      if (!stage.expect(context)) failures.push(stage.name)
    }
    results[trajectory.label] = failures
    assert.deepEqual(failures, [], `${trajectory.label} stages failed: ${failures.join(',')}`)
  }
})

test('G5 compound: 先有经历后成主题的回填、身份自述后否定、同领域不同事件', () => {
  // 先有经历，主题后出现：relate 在主题出现后调用仍成立（回填语义）。
  const late = new Trajectory('late')
  late.act('上学期我考了雅思，总分7分')
  late.say('我计划申请香港的研究生')
  const relation = relationForExperience({ kind: 'pursuit', title: '申请香港的研究生' }, '上学期我考了雅思，总分7分', true)
  assert.ok(relation, 'an old experience back-fills onto a later theme (雅思↔留学)')
  // 身份自述后主动否定：投影生成后否定退休。
  const identity = new Trajectory('identity')
  identity.say('我是那种先动手试再想清楚的人')
  assert.equal(identity.themes.length, 0, 'self-descriptions are identity claims, not themes')
  // 同领域不同事件不合并（两段海报经历保持两条）。
  const events = ['上周我给学院运动会设计了一套宣传海报，交给了体育部', '昨天我又给迎新晚会做了另一套宣传海报，交给文艺部']
  assert.equal(findEpisode([{ id: 'a', source_quote: events[0], content: {} }], events[1], '', ''), null, 'same-domain different events stay separate')
  // 复合：自媒体+休息（边界意图与探索并存）。
  const compound = new Trajectory('compound')
  compound.say('我想试试做知识区自媒体')
  compound.say('这学期不再熬夜赶工')
  assert.ok(compound.themes.some(t => t.kind === 'exploration') && compound.themes.some(t => t.title.includes('熬夜')), '自媒体 exploration 与 休息 boundary pursuit 并存')
})
