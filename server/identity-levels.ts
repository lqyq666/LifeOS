// 身份认同系统：基于证据的成长身份，随经历自动进化。
// 不是人格测试——每级身份都有可验证的证据条件，用户能看懂怎么升到下一级。
// 设计原则：每个阶段都正面（没有"落后"）、进步可见（显示下一级条件）、
// 名字让人愿意认领（"我是行动者"比"我处于阶段3"有代入感）。

export type IdentityLevel = {
  level: number
  name: string          // 身份名（学生愿意自称的）
  description: string   // 一句话描述
  nextHint: string      // 升到下一级需要什么
  icon: string          // 展示用 emoji
}

export const IDENTITY_LEVELS: IdentityLevel[] = [
  {
    level: 0, name: '出发者', icon: '🌱',
    description: '你正在出发，每一段经历都算数。',
    nextHint: '再积累 1 段经历，就是「探索者」',
  },
  {
    level: 1, name: '探索者', icon: '🧭',
    description: '你在尝试不同方向，这是找到自己热爱的必经之路。',
    nextHint: '再有 1 段经历中的行动和结果，就是「行动者」',
  },
  {
    level: 2, name: '行动者', icon: '⚡',
    description: '你不只是想，你在做——每段经历都是证据。',
    nextHint: '经历中的技能标签累计 3 个，就是「深耕者」',
  },
  {
    level: 3, name: '深耕者', icon: '🔥',
    description: '你在某个方向持续深入，能力证据在积累。',
    nextHint: '获得 1 次外部正面反馈（导师/客户/部长评价），就是「突破者」',
  },
  {
    level: 4, name: '突破者', icon: '🚀',
    description: '你突破了原来的自己——外部世界开始认可你做的事。',
    nextHint: '持续行动，你就是自己成长故事的主角。',
  },
]

// 身份判定条件——全部基于已有数据，零模型调用
export type IdentityEvidence = {
  experienceCount: number
  experiencesWithResult: number
  totalSkillTags: number
  externalFeedbackCount: number
  hasCorrection: boolean
  themeCount: number
}

export function determineIdentity(evidence: IdentityEvidence): { current: IdentityLevel; progress: string } {
  const { experienceCount, experiencesWithResult, totalSkillTags, externalFeedbackCount } = evidence

  if (externalFeedbackCount >= 1 && totalSkillTags >= 3) {
    return { current: IDENTITY_LEVELS[4]!, progress: `外部反馈 ${externalFeedbackCount} 次 · 技能 ${totalSkillTags} 个` }
  }
  if (totalSkillTags >= 3 && experienceCount >= 4) {
    return { current: IDENTITY_LEVELS[3]!, progress: `技能 ${totalSkillTags} 个 · 经历 ${experienceCount} 段` }
  }
  if (experiencesWithResult >= 2) {
    return { current: IDENTITY_LEVELS[2]!, progress: `有结果的经历 ${experiencesWithResult} 段 · 技能 ${totalSkillTags} 个` }
  }
  if (experienceCount >= 2) {
    return { current: IDENTITY_LEVELS[1]!, progress: `经历 ${experienceCount} 段 · 还差 ${Math.max(0, 2 - experiencesWithResult)} 段有结果的` }
  }
  return { current: IDENTITY_LEVELS[0]!, progress: `经历 ${experienceCount} 段` }
}
