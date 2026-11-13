import { PATH_THEMES } from '../../../server/path-lexicon.ts'

export type ProductMode = 'understand' | 'directions' | 'choice'
export const PRODUCT_MODES = [
  { id: 'understand' as const, title: '认识我', description: '从真实经历，看见当前的自己', icon: 'memory' as const },
  { id: 'directions' as const, title: '选方向', description: '比较路径，找到值得验证的一条', icon: 'orbit' as const },
  { id: 'choice' as const, title: '做选择', description: '把眼前机会放进自己的生活里', icon: 'compose' as const },
]
export const DIRECTION_OPTIONS = ['保研', '考研', '考公', '考编', '就业', '创业', '留学', '科研', '独立开发'].map(title => ({ title, description: PATH_THEMES.find(path => path.title === title)?.description ?? '事业单位与教师等招录探索' }))
export const CAMPUS_OPTIONS = ['竞赛', '社团', '科研', '论文', '实习'] as const
const boundary = '请只分析和建议，不修改档案、目标或长期记忆，不创建任务或经历；本次比较、提问和建议不代表我已选择、接受、执行或完成。不能把未提供写成不存在，不能把做过或在学写成已熟练掌握；已拒答的信息保留未知，不重复追问。新事实以本人后续实际陈述和确认为准。'
export function productModeOpeningPrompt(mode: ProductMode) {
  const opening = {
    understand: '【认识我】\n我想通过聊天更了解自己。请结合当前允许使用的已有资料，简要说说你理解的我，再围绕当前最影响帮助的缺口问一个问题。不重复询问已知或拒答内容。区分依据和未知，不推断稳定人格或能力。不要展开整份画像；资料为空就从我最近的一件事聊起。',
    directions: '【选方向】\n我想探索未来方向，还没有选定路径。请结合当前允许使用的已有资料，先自然地问我这次最想了解哪方面，比如科研还是实习。这些只是例子，不要求我先选两三条路，不列全套选项。开场先等我回答，再通过聊天逐步分析个人依据、取舍与未知；现在不展开方法步骤或路径比较。',
    choice: '【做选择】\n我想通过聊天理清眼前的一件事。请结合当前允许使用的已有资料，先自然地问我眼前正在犹豫什么机会或具体决定，比如科研还是实习。这些只是例子，不先列一组选项，不虚构机会或替我决定。开场先等我回答，再结合真实依据分析价值与取舍；现在不展开方法步骤。',
  }
  return opening[mode] + '\n请只分析和建议，不修改档案、目标或长期记忆，不创建任务或经历。'
}
export function productModePrompt(mode: ProductMode, paths: readonly string[] = [], matter = '', detail = '') {
  if (mode === 'understand') return `【认识我】\n请只回读已有记录，按背景、经历能力、兴趣价值、行为方式、现实约束、成长方向六个维度梳理你目前怎样理解我。每维列本人明确陈述的短引文和仍未知的部分。已有AI候选观察要与事实分开，只回读本轮授权提供的候选原文并说明尚待本人核对；没有候选来源就省略观察栏目，不现场猜测人格、动机或潜在需求。不能由单次经历断言稳定人格或职业能力。没有资料就坦诚保留未知，先问最关键的一两个问题，通过现有对话逐步了解。用小标题、短段落和必要的加粗。${boundary}`
  if (mode === 'directions') {
    if (paths.length < 2 || paths.length > 3 || new Set(paths).size !== paths.length || paths.some(path => !DIRECTION_OPTIONS.some(option => option.title === path))) throw new Error('请选择两到三条不同路径')
    return `【选方向】\n请比较${paths.join('、')}这${paths.length === 2 ? '两' : '三'}条路径，它们只是比较对象。请基于当前允许使用的本人经历、目标和实际约束，分别说明个人依据、条件缺口、时间投入、独有投入与取舍，再归纳共同准备和一个获得新证据的最小验证行动。未核实的官方资格、成绩、资金、研究能力或职业熟练度保持未知；不因重视自主就认定必须创业。时间与目标以本人最新有效陈述为准，事项时间不扩展为长期可用时间。资料不足先说明限制，不强行排名。用小标题、分段和加粗，充分回答，不用大表格。${detail.trim() ? '\n本轮补充：\n' + detail.trim() + '\n' : '\n'}${boundary}`
  }
  if (!CAMPUS_OPTIONS.some(option => option === matter)) throw new Error('请选择校园事项')
  return `【做选择】\n我想讨论是否参与${matter}。请结合当前允许使用的本人方向、实际能力证据和约束，分析参加价值、投入冲突、可选择的行动方式、最低成本尝试及停止条件。没有提供具体机会、截止时间、团队要求或投入条件时，先问关键缺口，不虚构机会细节，不把参加当作已经决定。区分有依据的判断与待验证假设，用小标题、分段和必要的加粗，充分回答。${detail.trim() ? '\n本轮补充：\n' + detail.trim() + '\n' : '\n目前尚未补充这次机会的具体情况。\n'}${boundary}`
}
export function productModeRequest(text: string) {
  const title = /^【(认识我|选方向|做选择)】\r?\n/.exec(text)?.[1]
  return title ? { title, role: '本轮服务请求的组织方式，不是个人事实；沿用同一来源、记忆开关与暂停边界' } : null
}
export type UnderstandingItem = {
  id: string; family: 'growth' | 'memory' | 'experience' | 'identity'; revision: number;
  text: string; state: 'fact' | 'observation' | 'unknown'; confirmed: boolean;
  sources: { quote?: string; label?: string; conversationId?: string; messageId?: string }[];
  actions: ('accept' | 'correct' | 'reject' | 'forget')[]; note?: string
}
export const UNDERSTANDING_DIMENSIONS = [
  { id: 'background', title: '背景', unknown: '学习阶段、专业等背景还没有可用记录。' },
  { id: 'experience', title: '经历能力', unknown: '还缺本人做过什么、承担了什么及实际反馈。' },
  { id: 'values', title: '兴趣价值', unknown: '兴趣和真正重视的事仍待本人表达。' },
  { id: 'behavior', title: '行为方式', unknown: '需要不同情境与反例，不能从单次经历推断稳定人格。' },
  { id: 'constraints', title: '现实约束', unknown: '当前时间、精力与资源尚不明确。' },
  { id: 'direction', title: '成长方向', unknown: '方向可以保持开放，不必现在选定。' },
] as const
export type UnderstandingDimension = typeof UNDERSTANDING_DIMENSIONS[number]['id']
export type UnderstandingView = { memoryEnabled: boolean; memoryRevision: number; dimensions: { id: UnderstandingDimension; title: string; unknown: string; items: UnderstandingItem[] }[]; themes: { id: string; title: string; status: string }[]; skills: { tag: string; count: number }[] }
