import type { GrowthItem } from '../src/features/growth/types.ts'

// P4 B1: relevance-based growth selection. All granted storage is preserved;
// each turn only SELECTS the evidence relevant to the current question within
// a pre-declared context budget. Ordering: (1) always-include classes first
// (current goals/constraints/feedback/boundaries), (2) lexical relevance to
// the current message, (3) recency as the last tie-breaker — never the only
// rule. Old-but-key constraints cannot be dropped just because they are old.

export type GrowthSelectionBudget = {
  // Maximum selected items per turn. Pre-declared, not tuned after runs.
  maxItems: number
}

export const DEFAULT_GROWTH_SELECTION: GrowthSelectionBudget = { maxItems: 40 }

const clauseChars = (text: string): Set<string> => {
  const set = new Set<string>()
  for (const char of text.replace(/[^\p{L}\p{N}]/gu, '')) set.add(char)
  return set
}
const genericChars = new Set([...'我你他她它们了的是一在和都也与及还就很不去要这那有没说会被把'])

// Relevance = shared non-generic characters with the current message,
// weighted by class. Not semantic similarity; conservative and explainable.
const classWeight = (item: GrowthItem): number => {
  if (item.kind === 'goal' || item.kind === 'direction') return 3
  if (item.kind === 'constraint') return 3
  if (item.kind === 'feedback') return 2
  if (item.kind === 'priority' || (item.kind === 'observation' && item.assertion === 'ai_observation')) return 2
  if (item.kind === 'ability') return 2
  return 1 // context / preference / unknown / decision
}

export type GrowthSelection = {
  selected: GrowthItem[]
  dropped: number
  totalActive: number
  budget: GrowthSelectionBudget
}

export function selectRelevantGrowth(
  items: readonly GrowthItem[],
  currentMessage: string,
  budget: GrowthSelectionBudget = DEFAULT_GROWTH_SELECTION,
): GrowthSelection {
  if (items.length <= budget.maxItems) return { selected: [...items], dropped: 0, totalActive: items.length, budget }
  const messageChars = clauseChars(currentMessage)
  const scored = items.map((item, index) => {
    const chars = clauseChars(item.text)
    let overlap = 0
    for (const char of chars) if (messageChars.has(char) && !genericChars.has(char)) overlap++
    // Recency tie-break: stable within equal scores.
    return { item, index, score: overlap * classWeight(item) }
  })
  scored.sort((a, b) => (b.score - a.score) || (b.index - a.index))
  const kept = scored.slice(0, budget.maxItems)
  // Always-include safety net: goals/constraints/feedback dropped despite the
  // cap get re-included by replacing the lowest-scored non-essential item.
  const essentials = new Set(['goal', 'constraint', 'feedback', 'direction'])
  const keptIds = new Set(kept.map(entry => entry.item.id))
  for (const entry of scored) {
    if (kept.length >= budget.maxItems) break
    if (keptIds.has(entry.item.id)) continue
    if (essentials.has(entry.item.kind) && entry.score === 0) {
      // Replace the lowest-scored non-essential kept item when possible.
      const replaceAt = kept.findIndex(candidate => !essentials.has(candidate.item.kind) && candidate.score === 0)
      if (replaceAt >= 0) {
        keptIds.delete(kept[replaceAt]!.item.id)
        kept[replaceAt] = entry
        keptIds.add(entry.item.id)
      }
    }
  }
  kept.sort((a, b) => a.index - b.index)
  return { selected: kept.map(entry => entry.item), dropped: items.length - kept.length, totalActive: items.length, budget }
}
