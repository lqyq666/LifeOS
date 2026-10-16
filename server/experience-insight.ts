// 经历洞察生成器：点开一个节点时，基于已有数据（零模型调用）生成
// "这件事说明了什么"、"相关经历"、"下一步可以做什么"。

export type ExperienceInsight = {
  headline: string       // 一句话核心洞察
  evidence: string       // 支撑证据的通俗解释
  relatedTitles: string[] // 相关经历标题
  nextStep: string       // 具体的下一步建议
  skillNote: string      // 能力证据说明
}

export type ExperienceSummary = {
  action: string
  result: string
  reflection: string
  unknowns: string
}

// 阅读态摘要只整理已存的本人原话字段。空字段明确显示未知，不用一次经历
// 推断稳定能力、成功、采用或效果；summary 只在行动字段为空时兜底。
export function summarizeExperience(data: { summary?: string; action?: string; result?: string; reflection?: string; outcomes?: Record<string, { status?: string } | undefined> }): ExperienceSummary {
  const outcomeLabels: Record<string,string> = { read:'是否读过', response:'是否回应', adoption:'是否采用', payment:'是否付款', effect:'实际效果' }
  const unknown = [
    ...(!data.result?.trim() ? ['结果'] : []),
    ...Object.entries(outcomeLabels).filter(([key]) => !data.outcomes?.[key]?.status || data.outcomes[key]?.status === 'unknown').map(([,label]) => label),
  ]
  return {
    action: data.action?.trim() || data.summary?.trim() || '尚未记录本人行动',
    result: data.result?.trim() || '尚未记录结果',
    reflection: data.reflection?.trim() || '尚未记录本人复盘',
    unknowns: unknown.length ? `${unknown.join('、')}仍未知` : '未报告的其他影响仍未知',
  }
}

export function generateInsight(data: {
  title: string
  summary: string
  action: string
  result: string
  occurredAt: string
  skillTags: string[]
  blocked: boolean
  externalFeedback: boolean
  connectedThemes: { title: string; relation: string }[]
  relatedExperiences: { title: string; score: number }[]
  identityLevel: number
  identityName: string
  nextIdentity: string
  identityNextHint: string
}): ExperienceInsight {
  const { skillTags, blocked, externalFeedback, connectedThemes, relatedExperiences } = data

  // 1. 核心洞察——用不同维度的一句话让学生看到"这件事的价值"
  let headline: string
  if (blocked) {
    headline = '这次记录包含一个卡点；具体原因仍需核对。'
  } else if (externalFeedback && skillTags.length > 0) {
    headline = '这次任务有外部反馈，含义以具体原话为准。'
  } else if (skillTags.length > 0) {
    headline = `这次记录涉及${skillTags.slice(0, 2).join('和')}；它说明本次任务中的尝试。`
  } else if (data.result) {
    headline = '这次经历记录了一个结果；它能说明的范围以实际经过为准。'
  } else {
    headline = '这是一条经历记录，可以继续核对当时的经过。'
  }

  // 2. 证据解释——把标签翻译成人话
  const evidenceParts: string[] = []
  if (connectedThemes.length > 0) {
    const theme = connectedThemes[0]!
    if (theme.relation === 'acting_toward') evidenceParts.push(`这段经历记录了向「${theme.title}」方向的一次行动`)
    else if (theme.relation === 'exploring') evidenceParts.push(`这是你探索「${theme.title}」方向的一次尝试`)
    else evidenceParts.push(`这段经历和你的「${theme.title}」方向相关`)
  }
  if (skillTags.length > 0) evidenceParts.push(`任务标签为${skillTags.join('、')}，稳定能力仍需更多证据`)
  if (externalFeedback) evidenceParts.push('使用、认可和实际效果分别记录；已知项按本人报告保留')
  if (data.occurredAt) evidenceParts.push(`发生在${data.occurredAt}`)

  // 3. 相关经历
  const relatedTitles = relatedExperiences.map(rel => rel.title)

  // 4. 下一步只基于具体任务，不以身份等级奖励更多行为。
  // A recorded experience does not authorize another action. Concrete next
  // steps belong to the current accepted plan, not an automatic node CTA.
  const nextStep = ''

  return {
    headline,
    evidence: evidenceParts.join('；'),
    relatedTitles,
    nextStep,
    skillNote: skillTags.length > 0 ? `${skillTags.join(' · ')} · 本次任务标签，稳定能力仍待核对` : '',
  }
}
