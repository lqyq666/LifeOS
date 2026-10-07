import type { GrowthItem } from '../src/features/growth/types.ts'

// P4 B1 + P5 S2: relevance-based growth selection. All granted storage is
// preserved; each turn only SELECTS the evidence relevant to the current
// question within pre-declared budgets (item count AND serialized text chars).
//
// Selection order per item: (1) class-weighted lexical relevance to the current
// message, (2) recency as the tie-breaker (growthView yields newest-first, so
// a LOWER index is newer — equal scores keep the newer item), (3) an essentials
// swap pass that actually replaces zero-score non-essential picks with
// zero-overlap goals/constraints/feedback — the P4 version broke before the
// first swap because kept was already full.

export type GrowthSelectionBudget = {
  maxItems: number
  // Pre-declared serialized-text ceiling for the selected set (P5 S2 / M04).
  maxChars: number
}

export const DEFAULT_GROWTH_SELECTION: GrowthSelectionBudget = { maxItems: 40, maxChars: 60_000 }

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
  selectedChars: number
  reasons: { id: string; reason: string }[]
}

export function selectRelevantGrowth(
  items: readonly GrowthItem[],
  currentMessage: string,
  budget: GrowthSelectionBudget = DEFAULT_GROWTH_SELECTION,
): GrowthSelection {
  const reasons: { id: string; reason: string }[] = []
  // P5c R03: the budget accounts for the FULL serialized item (sources, deps,
  // metadata) — not just the visible text — so provenance cannot silently
  // blow the real prompt size past the declared ceiling.
  const itemCost = (item: GrowthItem): number => JSON.stringify(item).length
  if (items.length <= budget.maxItems) {
    const totalChars = items.reduce((sum, item) => sum + itemCost(item), 0)
    if (totalChars <= budget.maxChars) {
      return { selected: [...items], dropped: 0, totalActive: items.length, budget, selectedChars: totalChars, reasons }
    }
  }
  const messageChars = clauseChars(currentMessage)
  const scored = items.map((item, index) => {
    const chars = clauseChars(item.text)
    let overlap = 0
    for (const char of chars) if (messageChars.has(char) && !genericChars.has(char)) overlap++
    return { item, index, score: overlap * classWeight(item) }
  })
  // P5 S2 (M03): newest-first tie-break — growthView returns updated_at DESC so
  // a lower index is NEWER; ascending index keeps the newer item on equal score.
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index))
  const kept = scored.slice(0, budget.maxItems)
  // P5 S2 (M01): essentials swap is now reachable — no premature break. A
  // zero-overlap goal/constraint/feedback/direction replaces a zero-score
  // non-essential pick; when no swappable pick remains the pass stops.
  // P5c R02: essentials are chosen by PURPOSE, not bare kind. Globally binding
  // kinds (goal/constraint/direction) are always essential; feedback becomes
  // essential only when it is lexically relevant to the CURRENT question —
  // 45 unrelated canteen feedbacks must not evict the current research fact.
  const alwaysEssential = new Set(['goal', 'constraint', 'direction'])
  const isEssential = (kind: string, score: number): boolean =>
    alwaysEssential.has(kind) || (kind === 'feedback' && score > 0)
  const keptIds = new Set(kept.map(entry => entry.item.id))
  for (const entry of scored) {
    if (keptIds.has(entry.item.id)) continue
    if (!isEssential(entry.item.kind, entry.score)) continue
    // P5 S2 (M01): a zero-overlap essential is globally binding — it swaps out
    // the LOWEST-scoring non-essential pick even when that pick is lexically
    // relevant. kept is score-descending, so the last non-essential is weakest.
    let replaceAt = -1
    for (let i = kept.length - 1; i >= 0; i--) {
      if (!isEssential(kept[i]!.item.kind, kept[i]!.score)) { replaceAt = i; break }
    }
    if (replaceAt < 0) break
    keptIds.delete(kept[replaceAt]!.item.id)
    kept[replaceAt] = entry
    keptIds.add(entry.item.id)
    reasons.push({ id: entry.item.id, reason: 'essentials-swap' })
  }
  // P5 S2 (M04): pre-declared text budget — drop the lowest-scored items until
  // the serialized text fits; essentials are dropped last.
  let selectedChars = kept.reduce((sum, entry) => sum + itemCost(entry.item), 0)
  while (selectedChars > budget.maxChars && kept.length > 1) {
    let dropAt = -1
    for (let i = kept.length - 1; i >= 0; i--) {
      if (!isEssential(kept[i]!.item.kind, kept[i]!.score)) { dropAt = i; break }
    }
    if (dropAt < 0) {
      dropAt = kept.reduce((worst, entry, i) => itemCost(entry.item) > itemCost(kept[worst]!.item) ? i : worst, 0)
      reasons.push({ id: kept[dropAt]!.item.id, reason: 'char-budget-essential-trim' })
    } else {
      reasons.push({ id: kept[dropAt]!.item.id, reason: 'char-budget' })
    }
    selectedChars -= itemCost(kept[dropAt]!.item)
    kept.splice(dropAt, 1)
  }
  kept.sort((a, b) => a.index - b.index)
  return { selected: kept.map(entry => entry.item), dropped: items.length - kept.length, totalActive: items.length, budget, selectedChars, reasons }
}
