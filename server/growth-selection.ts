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

// P6 closeout B2: group the SELECTED records by whether they concern the
// CURRENT message's own matter. The observed T9 failure: asking about a NEW
// 4-hour campus streamer job was answered with the OLD 10-hour newsletter
// record. The confusion axis is TIME/QUANTITY wording (每周/小时/数字) shared
// by almost every schedule-like record, so coverage is computed over SUBJECT
// characters only — informative characters minus the closed class of
// time-quantity morphemes (a function-word class, not a topic word list).
// Matching subject characters (the entity/name being discussed) distinguish
// "this record is about what we are discussing" from "this record merely
// shares schedule wording". Both groups stay in the prompt; the grouping only
// states which records describe the current matter, so the reply analyzes the
// CURRENT object with the old ones as comparison, never as a substitute.
const timeQuantityChars = new Set([...'每周周天时小分钟号次年期月一二两三四五六七八九十百千万几半大概左右约'])
// Standing-frame kinds describe the person's GLOBALLY binding frame (goals,
// direction, constraints, priorities, decisions) — they legitimately inform
// ANY question and are never an "old matter" that could substitute for the
// current one. FEEDBACK is deliberately NOT standing: a past action's feedback
// belongs to the matter it reports on, so it follows the same current-matter
// coverage rule as context records (an old club-poster delay must not ride
// into a research/course question just because its kind is feedback).
const standingFrameKind = (kind: GrowthItem['kind']): boolean =>
  kind === 'goal' || kind === 'direction' || kind === 'constraint' || kind === 'priority' || kind === 'decision'
export function splitGrowthByCurrentTopic(
  items: readonly GrowthItem[],
  currentMessage: string,
): { currentTopic: GrowthItem[]; background: GrowthItem[] } {
  const messageChars = clauseChars(currentMessage)
  const currentTopic: GrowthItem[] = [], background: GrowthItem[] = []
  for (const item of items) {
    if (standingFrameKind(item.kind)) { currentTopic.push(item); continue }
    const subject = [...clauseChars(item.text)].filter(char => !genericChars.has(char) && !timeQuantityChars.has(char))
    if (!subject.length) { background.push(item); continue }
    let covered = 0
    for (const char of subject) if (messageChars.has(char)) covered++
    if (covered >= 2 && covered / subject.length >= 0.3) currentTopic.push(item)
    else background.push(item)
  }
  return { currentTopic, background }
}
