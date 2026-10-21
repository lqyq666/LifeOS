import {taskOutcomeReadback} from './turn-contract.ts'
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

export type ExperienceOutcomeKey='read'|'response'|'adoption'|'payment'|'effect'

// Outcome stages belong only to experiences that actually involve another
// party, a deliverable or a commercial exchange. Everyday life, sport,
// friendship, interests and private study feelings must not inherit a sales
// funnel merely because the storage shape can represent one.
export function applicableExperienceOutcomes(data:{summary?:string;action?:string;result?:string;sourceQuote?:string}):ExperienceOutcomeKey[]{
  const text=[data.summary,data.action,data.result,data.sourceQuote].filter(Boolean).join(' ')
  const reported=taskOutcomeReadback(data.sourceQuote??'',undefined,false,true)
  const interaction=reported.read.status!=='unknown'||reported.response.status!=='unknown'||/(?:发给|发送|联系|私信|邮件|消息|询问|请教|提交|交付|分享给|给.{0,12}(?:老师|同学|学长|学姐|客户|负责人|部长|室友)|(?:向|给).{0,16}(?:老师|同学|学长|学姐|客户|负责人|部长|室友).{0,12}(?:发|发送|交付|提交|请教|询问|联系|说)|(?:老师|同学|学长|学姐|客户|负责人|部长|室友).{0,6}(?:说|回复|回应|反馈))/.test(text)
  const deliverable=/(?:材料|文档|简历|作品|海报|推文|方案|产品|原型|链接|文件|报告|代码|视频|问卷)/.test(text)
  const commercial=/(?:客户|订单|报价|收费|付费|付款|收入|薪酬|报酬|成交|接单|¥|元)/.test(text)
  const effectRelevant=deliverable||/(?:试用|测试|实验|干预|训练|采用|使用|效果)/.test(text)
  return [
    ...(interaction?['read','response'] as const:[]),
    ...(deliverable||/(?:采用|使用|用了|没用)/.test(text)?['adoption'] as const:[]),
    ...(commercial?['payment'] as const:[]),
    ...(effectRelevant?['effect'] as const:[]),
  ]
}

// 阅读态摘要只整理已存的本人原话字段。空字段明确显示未知，不用一次经历
// 推断稳定能力、成功、采用或效果；summary 只在行动字段为空时兜底。
export function summarizeExperience(data: { summary?: string; action?: string; result?: string; reflection?: string; outcomes?: Record<string, { status?: string } | undefined>; applicableOutcomes?: readonly ExperienceOutcomeKey[] }): ExperienceSummary {
  const outcomeLabels: Record<string,string> = { read:'是否读过', response:'是否回应', adoption:'是否采用', payment:'是否付款', effect:'实际效果' }
  const applicable=new Set(data.applicableOutcomes??applicableExperienceOutcomes(data))
  const unknown = [
    ...(!data.result?.trim() ? ['结果'] : []),
    ...Object.entries(outcomeLabels).filter(([key]) => applicable.has(key as ExperienceOutcomeKey)&&(!data.outcomes?.[key]?.status || data.outcomes[key]?.status === 'unknown')).map(([,label]) => label),
  ]
  return {
    action: data.action?.trim() || data.summary?.trim() || '尚未记录本人行动',
    result: data.result?.trim() || '尚未记录结果',
    reflection: data.reflection?.trim() || '尚未记录本人复盘',
    unknowns: unknown.length ? `${unknown.join('、')}仍未知` : '',
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
