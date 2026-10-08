import { scanUserClauses } from './user-command-spans.ts'
import type { GrowthItem } from '../src/features/growth/types.ts'

// P6 W1: clause-level forget/control intent detection. Whole-message keyword
// matching fired on negation, hypotheticals, pause-not-forget and mixed
// feedback; lexical overlap on the WHOLE message picked the wrong target.
// Here intent is derived from CONTROL CLAUSES ONLY, and target scoring uses
// the control clause text — a mixed "new feedback + forget poster" message
// scores poster against the forget clause, never the newsletter feedback.
//
// P6 closeout A1: intent kinds are derived from the OPERATION the clause
// requests, not from keyword presence. Refusal ("不要删除…") keeps the
// current state and authorizes nothing; a cognitive lapse ("我忘记了…")
// is not an instruction to erase stored records; "别再用/不要再推荐" ARE
// affirmative stop commands even though they carry negative wording; and a
// control clause that already names its object ("这条海报经历记录") is
// scored on its own words only, never re-weighted by the rest of the message.

export type ForgetIntentKind = 'forget' | 'pause_use' | 'stop_recommend' | null

export type ForgetIntentClause = {
  kind: ForgetIntentKind
  clauseText: string
  // True when the clause carries an explicit keep/preserve instruction that
  // forbids deletion (记录保留 / 先不删 / 保留记录).
  preserveRequested: boolean
}

// Erase commands. Matched positively; a negation directly in front of one of
// these (不要删除 / 先别删掉) is a REFUSAL handled separately below.
const forgetCommands = /(?:帮我(?:来)?|请|麻烦)?(?:忘掉|忘记(?!了)|忘了吧|忘记吧|删除|删掉|删了|清除|清掉|移除|去掉|抹掉)|(?:不要|不想|不用|无需|不必|不再)(?:再)?保留/
// Stop-using commands: the negative wording IS the command.
const pauseUseCommands = /(?:不(?:要再?|再)?(?:用来?)?作为[^。！？]{0,10}(?:依据|参考)|不再作为[^。！？]{0,10}(?:依据|参考)|不再?用来?作为[^。！？]{0,10}(?:依据|参考)|别再?作为[^。！？]{0,10}(?:依据|参考)|别再用|别再拿|不要再拿|不要拿|不想再用|不必再用|不再用|先不用|暂时不用|别拿|停止使用|停止作为[^。！？]{0,10}(?:依据|参考))/
// Stop-recommending commands (narrower than stop-using: mentions 推/推荐/提).
const stopRecommendCommands = /(?:别再推荐|不要再推荐|不再推荐|不要再推|先别推|别推|停止推荐|别再提|不要再提|先别提|别提|不再主动提)/
// A negation directly preceding an erase verb turns the clause into refusal.
const refusedForget = /(?:请不要?|请别|请勿|请莫|不|别|莫|勿|没)(?:要|想|用|再)?(?:删除|删掉|删了|清除|清掉|移除|去掉|抹掉|忘掉|忘记)/
// First-person statements about one's own memory are cognitive lapses, not
// instructions: 我忘记了 / 我记不清 / 想不起来 / 不记得了. 帮我/让我/请我
// preceding the verb turns the same words back into a command.
const cognitiveLapse = /(?<![帮让请叫])(?:我|本人|自己)(?:已经|现在|都|是真)?(?:忘记|忘了|记不清|想不起|不记得)|^(?:记不清|想不起来|记不得|不记得)/
const preserveMarkers = /(?:记录保留|保留记录|先不删|不要删|别删|不用删|不删|留着|保留着|以后再说删除)/
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
    // A question about how to do it is not the operation itself.
    if (questionLike.test(body) || clause.interrogative) continue
    // A cognitive lapse reports the user's own memory, never commands the
    // system to erase saved information (N04).
    if (cognitiveLapse.test(body)) continue
    // A refusal of the erase verb keeps the current state; it authorizes
    // neither a delete nor a pause (N02/N03).
    const refused = refusedForget.test(body)
    const preserveRequested = preserveMarkers.test(body)
    let kind: ForgetIntentKind = null
    // Stop commands are affirmative regardless of their negative wording, so
    // they are checked before the refusal guard (N05/N06).
    if (stopRecommendCommands.test(body)) kind = 'stop_recommend'
    else if (pauseUseCommands.test(body)) kind = 'pause_use'
    else if (!refused && forgetCommands.test(body)) kind = 'forget'
    if (!kind) continue
    // A delete request softened by an explicit same-clause preserve note
    // ("先不删，别再用") is a pause, not a forget.
    if (preserveRequested && kind === 'forget') kind = 'pause_use'
    found.push({ kind, clauseText: body, preserveRequested })
  }
  return found
}

const genericChars = new Set([...'我你他她它们了的是一在和都也与及还就很不去要这那有没说会被把'])

const informativeChars = (text: string) => [...text.replace(/[^\p{L}\p{N}]/gu, '')].filter(char => !genericChars.has(char))

// Score candidate targets against the CONTROL CLAUSE ONLY — the rest of the
// message (new feedback, other topics) cannot pull the target away.
export function scoreForgetTargets(
  items: readonly GrowthItem[],
  controlClauseText: string,
  currentMessage: string,
): { item: GrowthItem; overlap: number }[] {
  const clauseChars = new Set(controlClauseText.replace(/[^\p{L}\p{N}]/gu, ''))
  // The clause names its own object ("忘掉这条海报经历记录"): the anaphora
  // boost would let an unrelated long feedback clause outscore it (N08), so
  // whole-message weighting applies ONLY when the control clause itself
  // carries no informative target words (pure "忘掉它" shapes).
  const anaphora = /(?:它|这个|那个|这件事|那件事|这些|那些|该记录|这条|上次说的)/.test(controlClauseText)
  const clauseInformative = informativeChars(controlClauseText).filter(char => char !== '条' && char !== '次').length
  let messageChars: Set<string> | null = null
  if (anaphora && clauseInformative < 2) {
    // Resolve a pure pronoun against the NEAREST preceding clause — the most
    // likely antecedent — never the whole message.
    const clauses = scanUserClauses(currentMessage).map(entry => entry.text.trim()).filter(Boolean)
    const at = clauses.findIndex(entry => entry === controlClauseText.trim())
    messageChars = at > 0 ? new Set(clauses[at - 1]!.replace(/[^\p{L}\p{N}]/gu, '')) : new Set()
  }
  return items
    .filter(item => item.status === 'active' && ['user_reported', 'user_edit'].includes(item.assertion))
    .map(item => {
      const chars = new Set(item.text.replace(/[^\p{L}\p{N}]/gu, ''))
      let overlap = 0
      for (const char of clauseChars) if (chars.has(char) && !genericChars.has(char)) overlap++
      if (messageChars) {
        for (const char of messageChars) if (chars.has(char) && !genericChars.has(char)) overlap += 1
      }
      return { item, overlap }
    })
    .sort((a, b) => b.overlap - a.overlap)
}
