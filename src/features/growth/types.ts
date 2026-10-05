export const growthLabels = {
  context: '当前处境', ability: '能力依据', preference: '兴趣与重视因素', observation: '待核对观察',
  unknown: '尚待了解', goal: '当前目标', direction: '正在探索的方向', constraint: '现实约束',
  priority: '近期重点', decision: '眼前的选择', feedback: '行动反馈',
} as const
export type GrowthKind = keyof typeof growthLabels
export type GrowthStatus = 'active' | 'proposed' | 'paused' | 'completed' | 'rejected' | 'forgotten' | 'stale'
export type GrowthRef = { id: string; revision: number }
export type GrowthSource = { type: 'user_edit'; quote: string } | { type: 'message'; id: string; quote: string }
export type GrowthItem = {
  id: string; conversationId: string; kind: GrowthKind; text: string;
  assertion: 'user_reported' | 'user_edit' | 'ai_observation' | 'unknown'; status: GrowthStatus;
  sources: GrowthSource[]; dependencies: GrowthRef[]; validUntil: string | null;
  revision: number; createdAt: string; updatedAt: string; unavailableReason: string | null;
  limitation?: string; progressState?: 'unattempted' | 'attempted' | 'stuck' | 'completed' | 'unknown' | null;
}
export type GrowthView = { memoryEnabled: boolean; items: GrowthItem[] }
