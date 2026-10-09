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
  const { skillTags, blocked, externalFeedback, connectedThemes, relatedExperiences, identityLevel, nextIdentity, identityNextHint } = data

  // 1. 核心洞察——用不同维度的一句话让学生看到"这件事的价值"
  let headline: string
  if (blocked) {
    headline = '这件事还在进行中——卡住的地方往往就是下一步的突破口。'
  } else if (externalFeedback && skillTags.length > 0) {
    headline = `你的${skillTags[0]}能力得到了外部认可——这不是自我感觉，是别人说的。`
  } else if (skillTags.length > 0) {
    headline = `这是一段有实际产出的经历，证明你有${skillTags.slice(0, 2).join('和')}的动手能力。`
  } else if (data.result) {
    headline = '你完成了这件事，而且知道了结果——完成的经历比计划中的想法有价值得多。'
  } else {
    headline = '每一段做过的经历都在帮你缩小"适合什么"的范围。'
  }

  // 2. 证据解释——把标签翻译成人话
  const evidenceParts: string[] = []
  if (connectedThemes.length > 0) {
    const theme = connectedThemes[0]!
    if (theme.relation === 'acting_toward') evidenceParts.push(`这段经历直接支持了你的「${theme.title}」方向`)
    else if (theme.relation === 'exploring') evidenceParts.push(`这是你探索「${theme.title}」方向的一次尝试`)
    else evidenceParts.push(`这段经历和你的「${theme.title}」方向相关`)
  }
  if (skillTags.length > 0) evidenceParts.push(`积累了${skillTags.join('、')}方面的证据`)
  if (externalFeedback) evidenceParts.push('有人给了你反馈——外部的声音比自我评价更可靠')
  if (data.occurredAt) evidenceParts.push(`发生在${data.occurredAt}`)

  // 3. 相关经历
  const relatedTitles = relatedExperiences.map(rel => rel.title)

  // 4. 下一步——基于身份等级和当前缺口
  let nextStep: string
  if (identityLevel === 0) {
    nextStep = '再多做一件事，你就从「出发者」变成「探索者」了。跟 AI 聊聊下一步可以试什么。'
  } else if (blocked) {
    nextStep = '这件事卡在哪了？跟 AI 聊聊卡点，拆成最小的一步。'
  } else if (connectedThemes.length > 0) {
    nextStep = `这段经历支持了「${connectedThemes[0]!.title}」。要不要聊聊怎么继续推进？`
  } else {
    nextStep = identityNextHint || '跟 AI 聊聊这段经历带来的想法。'
  }

  return {
    headline,
    evidence: evidenceParts.join('；'),
    relatedTitles,
    nextStep,
    skillNote: skillTags.length > 0 ? `${skillTags.join(' · ')} — 有证据的能力` : '',
  }
}
