// 经历洞察生成器：点开一个节点时，基于已有数据（零模型调用）生成
// "这件事说明了什么"、"相关经历"、"下一步可以做什么"。

export type ExperienceInsight = {
  headline: string       // 一句话核心洞察
  evidence: string       // 支撑证据的通俗解释
  relatedTitles: string[] // 相关经历标题
  nextStep: string       // 具体的下一步建议
  skillNote: string      // 能力证据说明
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
  if (externalFeedback) evidenceParts.push('已有反馈记录；是否使用、是否认可和实际效果分别核对')
  if (data.occurredAt) evidenceParts.push(`发生在${data.occurredAt}`)

  // 3. 相关经历
  const relatedTitles = relatedExperiences.map(rel => rel.title)

  // 4. 下一步只基于具体任务，不以身份等级奖励更多行为。
  let nextStep: string
  if (blocked) {
    nextStep = '这件事卡在哪了？跟 AI 聊聊卡点，拆成最小的一步。'
  } else if (connectedThemes.length > 0) {
    nextStep = `如果你愿意，可以核对这次经历与「${connectedThemes[0]!.title}」的关系。`
  } else {
    nextStep = '如果你愿意，可以聊聊这次经过增加了哪些信息、还缺哪些信息。'
  }

  return {
    headline,
    evidence: evidenceParts.join('；'),
    relatedTitles,
    nextStep,
    skillNote: skillTags.length > 0 ? `${skillTags.join(' · ')} · 本次任务标签，稳定能力仍待核对` : '',
  }
}
