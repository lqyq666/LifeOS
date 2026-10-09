// 行为模式推导：从已确认经历的原话字段里，按确定性规则找跨经历的重现形态。
// 只在同类至少两段经历都支撑同一条规则时成案，产出是"待核对的观察"
// （pattern_candidate, pending），由用户在长期记忆里接受或拒绝；拒绝过的
// 不再重提。所有措辞都锚定原文片段，不做人格结论。
export type PatternExperience = {
  id: string
  revision: number
  conversationId: string
  sourceMessageId: string
  quote: string
  action: string
  result: string
  valueIds: string[]
}

export type PatternProposal = {
  behaviorKey: string
  context: string
  behavior: string
  outcome: string
  limitations: string[]
  supporting: PatternExperience[]
  matched: string[]
}

const anchorOf = (experience: PatternExperience, pattern: RegExp): string | null => {
  for (const text of [experience.result, experience.action, experience.quote]) {
    const match = pattern.exec(text)
    if (match) return match[0]
  }
  return null
}

type Rule = {
  behaviorKey: string
  behavior: string
  // Every supporting experience must carry the anchor somewhere in its
  // verbatim fields; no anchor, no support.
  anchor: RegExp
  // Optional category gate: the rule only counts experiences linked to it.
  requireValueId?: string
}
const RULES: Rule[] = [
  { behaviorKey: 'feedback-iterate', behavior: '先做出成果，再按反馈调整', anchor: /反馈|意见|评价|建议/ },
  { behaviorKey: 'deliver-late', behavior: '交付容易压着截止时间，但内容能过关', anchor: /晚了|迟了|推迟|拖了|压线/ },
  { behaviorKey: 'deliver-ontime', behavior: '能按时或提前交付答应的事', anchor: /按时|提前|如期|赶在/ },
  { behaviorKey: 'initiate', behavior: '倾向自己主动发起、拿主意', anchor: /主动|自己决定|自己联系|我决定|我选择|牵头/ },
  { behaviorKey: 'create-output', behavior: '持续把想法做成可交付的作品', anchor: /做了|做出|制作|写完|设计|剪辑|开发|整理出/, requireValueId: 'value-creation' },
]

export function derivePatternProposals(experiences: readonly PatternExperience[], includeExperienceId?: string): PatternProposal[] {
  const proposals: PatternProposal[] = []
  for (const rule of RULES) {
    const supporting = experiences.filter(experience => {
      if (rule.requireValueId && !experience.valueIds.includes(rule.requireValueId)) return false
      return anchorOf(experience, rule.anchor) !== null
    })
    if (supporting.length < 2) continue
    // Only propose when the freshly ingested experience is part of the set:
    // old data never churns out proposals on its own.
    if (includeExperienceId && !supporting.some(experience => experience.id === includeExperienceId)) continue
    const matched = supporting.map(experience => anchorOf(experience, rule.anchor)!)
    proposals.push({
      behaviorKey: rule.behaviorKey,
      context: `同类经历${supporting.length}段`,
      behavior: rule.behavior,
      outcome: `这些经历的原话都提到：「${[...new Set(matched)].slice(0, 4).join('」「')}」`,
      limitations: ['样本还少，是待核对的观察，不是人格结论', '由对话原话自动归纳，可在长期记忆里接受或拒绝'],
      supporting,
      matched,
    })
  }
  return proposals
}
