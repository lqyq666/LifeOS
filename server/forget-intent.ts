import { scanUserClauses } from './user-command-spans.ts'
import type { GrowthItem } from '../src/features/growth/types.ts'

// P6 W1: clause-level forget/control intent detection. Whole-message keyword
// matching fired on negation, hypotheticals, pause-not-forget and mixed
// feedback; lexical overlap on the WHOLE message picked the wrong target.
// Here intent is derived from CONTROL CLAUSES ONLY, and target scoring uses
// the control clause text — a mixed "new feedback + forget poster" message
// scores poster against the forget clause, never the newsletter feedback.

export type ForgetIntentKind = 'forget' | 'pause_use' | 'stop_recommend' | null

export type ForgetIntentClause = {
  kind: ForgetIntentKind
  clauseText: string
  // True when the clause carries an explicit keep/preserve instruction that
  // forbids deletion (记录保留 / 先不删 / 保留记录).
  preserveRequested: boolean
}

const forgetVerbs = /(?:忘掉|忘记|忘了吧|删除|删掉|删了|清除|清掉|移除|去掉|抹掉|不要保留|不再保留)/
const pauseUseVerbs = /(?:不再作为[^。！？]{0,10}(?:依据|参考)|别再用|不再用|先不用|暂时不用)/
const stopRecommendVerbs = /(?:别再推荐|不要再推|先别推|别再提|不要再提)/
const preserveMarkers = /(?:记录保留|保留记录|先不删|不要删|别删|不用删|不删|留着|保留着|以后再说删除)/
const negationPrefix = /^(?:不想|不要|不|没必要|无需|不用|别)/
const questionLike = /[？?]$|(?:怎么|如何|什么|吗|呢)/

export function detectForgetIntentClauses(text: string): ForgetIntentClause[] {
  const found: ForgetIntentClause[] = []
  for (const clause of scanUserClauses(text)) {
    const body = clause.text.trim()
    if (!body) continue
    // Quotes, code, third-party speech and conditionals never state the
    // user's own control intent.
    if (clause.quoted || clause.code || clause.attributedToOther || clause.conditional) continue
    // The scanner flags conditionality for clauses AFTER the opener; the
    // opener clause itself still carries 如果/要是 and is equally hypothetical.
    if (/(?:如果|要是|假如|假设|万一|一旦|以后想|以后再)/.test(body)) continue
    // A negated control verb is refusal ("不要删除…"), never a request and
    // never a pause — regardless of incidental preserve words.
    if (negationPrefix.test(body)) continue
    const preserveRequested = preserveMarkers.test(body)
    let kind: ForgetIntentKind = null
    if (forgetVerbs.test(body)) kind = 'forget'
    else if (pauseUseVerbs.test(body)) kind = 'pause_use'
    else if (stopRecommendVerbs.test(body)) kind = 'stop_recommend'
    if (!kind) continue
    // A question about how to do it is not the operation itself.
    if (questionLike.test(body)) continue
    // "保留" wins over an incidental delete word in the same clause.
    if (preserveRequested && kind === 'forget') kind = 'pause_use'
    found.push({ kind, clauseText: body, preserveRequested })
  }
  return found
}

const genericChars = new Set([...'我你他她它们了的是一在和都也与及还就很不去要这那有没说会被把'])

// Score candidate targets against the CONTROL CLAUSE ONLY — the rest of the
// message (new feedback, other topics) cannot pull the target away.
export function scoreForgetTargets(
  items: readonly GrowthItem[],
  controlClauseText: string,
  currentMessage: string,
): { item: GrowthItem; overlap: number }[] {
  const clauseChars = new Set(controlClauseText.replace(/[^\p{L}\p{N}]/gu, ''))
  // Pronoun/anaphora references (它/这件事/那些/该记录) resolve against the
  // whole message ONLY to break ties, never to add score to unrelated items.
  const anaphora = /(?:它|这个|那个|这件事|那件事|这些|那些|该记录|这条|上次说的)/.test(controlClauseText)
  const messageChars = anaphora ? new Set(currentMessage.replace(/[^\p{L}\p{N}]/gu, '')) : null
  return items
    .filter(item => item.status === 'active' && ['user_reported', 'user_edit'].includes(item.assertion))
    .map(item => {
      const chars = new Set(item.text.replace(/[^\p{L}\p{N}]/gu, ''))
      let overlap = 0
      for (const char of clauseChars) if (chars.has(char) && !genericChars.has(char)) overlap++
      if (messageChars) {
        for (const char of messageChars) if (chars.has(char) && !genericChars.has(char)) overlap += 0.5
      }
      return { item, overlap }
    })
    .sort((a, b) => b.overlap - a.overlap)
}
