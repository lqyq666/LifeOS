// Structured experience fields stay server-owned: the model only names clause
// handles, and every stored string is verbatim user text or a date derived
// from it. A handle outside the selected experience span would store text the
// user said about something else, so it drops that field — never the candidate.
import { resolveClause, type ClauseHandle } from './clause-catalogue.ts'
import { resolveOccurredDate } from './growth-time.ts'
import { classifyWithLexicon } from './category-lexicon.ts'

export type ResolvedCandidateContent = { action: string; result: string; occurredAt: string }

// Structure-only trigger for requiring the candidate lane: a first-person,
// non-question, non-hypothetical clause that reports a COMPLETED action. The
// same clause flags the anchor guards use; no semantics are inferred here.
// Flash-tier models otherwise treat the optional lane as omittable, and the
// lane is the only path from a conversation to the star map.
const COMPLETED_ACTION = /(?:做完|完成|交付|交了|交完|交上去|交过去|交到|交给|补交|补齐|补完|提交了|通过了|发了|发过|发出去|发过去|发到|发给|送到|写完了|写了|写过|赶完|弄完|搞定了|拿到了|参加过|参加了|办了|签了|录了|考了|考过|剪了|排了|整理了|整理过|整理好|准备好|办好|写好|做好|改好|弄好|搞定|送到|寄到|买好|订好|排好|上线了|发布了|发布过|上线|发布|上线|投了|投过|帮过|当过|带过|做过|做了|访谈了|调研了|采访了|拒绝了|拒绝了?|回绝了|申报了|答辩完|办完)/
const NOT_YET = /打算|准备|计划|希望|想要|将要|下次|明天|后天|以后|考虑|如果|假设|还没|尚未|没来得及|没写完|没做完|没完成|没交/
// “交付范围” names an action but “想先确认” has not performed it.
// Shared by the structural fallback and the actual candidate persistence gate.
export const clauseExpressesWishToAct=(text:string):boolean=>/(?:想|要)(?:先|去|尝试|试试|交付|提交|上线|发布|确认|核对|了解)/.test(text)
// First person scopes the whole sentence: the action clause itself often
// drops the pronoun (「迟了一天补交上去」) while a sibling clause carries it.
export const sentenceIsFirstPersonPublic = (catalogue: readonly ClauseHandle[], handle: ClauseHandle): boolean =>
  catalogue.some(other => other.sentenceStart === handle.sentenceStart && /我/.test(other.text))
const sentenceIsFirstPerson = sentenceIsFirstPersonPublic

// 对既往经历的追述（上次那套海报后来…）：本身没有新的完成动词，但带着
// 结果/反馈分句时，应作为候选走相似度合并进原经历。
const BACK_REFERENCE = /上次那|上次说|上次提到|之前那次|之前说的|那件事|刚才说的|后来/
export function requiresExperienceCandidate(catalogue: readonly ClauseHandle[]): boolean {
  const completed = catalogue.some(handle =>
    !handle.interrogative && !handle.conditional && !handle.quoted && !handle.code && !handle.attributedToOther
    && sentenceIsFirstPerson(catalogue, handle) && clauseReportsCompleted(handle.text))
  if (completed) return true
  const bySentence = new Map<number, ClauseHandle[]>()
  for (const handle of catalogue) {
    const group = bySentence.get(handle.sentenceStart) ?? []
    group.push(handle)
    bySentence.set(handle.sentenceStart, group)
  }
  for (const handles of bySentence.values()) {
    const text = handles.map(handle => handle.text).join()
    if (BACK_REFERENCE.test(text) && handles.some(handle => RESULT_SHAPE.test(handle.text)) && handles.every(handle => !handle.interrogative && !handle.conditional)) return true
  }
  return false
}

export function clauseReportsCompleted(text: string): boolean {
  return COMPLETED_ACTION.test(text) && !NOT_YET.test(text) && !clauseExpressesWishToAct(text)
}

// Category fallback for the star map: the model lane may omit links, but a
// seamless record still needs a browsing category. Matching goes through the
// category lexicon (strong direct evidence vs weak context clues) and quotes
// the matched fragment in the reason; the disposition stays 'proposed'
// (adjustable, never presented as user-confirmed).
export function deriveStructuralLinks(quote: string): { valueId: string; reason: string }[] {
  return classifyWithLexicon(quote).slice(0, 3).map(match => ({
    valueId: match.valueId,
    reason: `自动按原话「${match.word}」先归入「${match.label}」，可调整`,
  }))
}

// Deterministic fallback when the model omits the lane: the candidate is the
// full sentence containing a detected completed-action clause. The quote stays
// a server-owned verbatim span; action/result split conservatively by clause
// shape and may legitimately stay empty.
const RESULT_SHAPE = /说|反馈|评价|效果|结果|还不错|很好|不错|挺好|通过了|被采纳|被表扬|被批评|有问题|有欠缺|按时|晚了|迟了|提前|没回|没用|用上了|采纳|认可|不满意|效果一般|扣分|没扣分|来问|追问|上线|催了|续了|回应了/
export function selectStructuralCandidate(sourceText: string, catalogue: readonly ClauseHandle[], anchorIso: string): { quote: string; start: number; end: number; content: ResolvedCandidateContent } | null {
  const matched = catalogue.find(handle =>
    !handle.interrogative && !handle.conditional && !handle.quoted && !handle.code && !handle.attributedToOther
    && sentenceIsFirstPerson(catalogue, handle) && clauseReportsCompleted(handle.text))
    ?? catalogue.find(handle => !handle.interrogative && !handle.conditional && BACK_REFERENCE.test(handle.text) && RESULT_SHAPE.test(handle.text))
  if (!matched) return null
  // Commas chain clauses inside one sentence (sentenceStart resets only at
  // terminators), so the candidate is the whole comma chain the action sits in.
  const inSentence = catalogue.filter(handle => handle.sentenceStart === matched.sentenceStart)
  const end = Math.max(...inSentence.map(handle => handle.end))
  const quote = sourceText.slice(matched.sentenceStart, end)
  const action = inSentence.find(handle => clauseReportsCompleted(handle.text))
  const resultCandidates = inSentence.filter(handle => RESULT_SHAPE.test(handle.text) && handle !== action)
  const result = resultCandidates.at(-1)
  return {
    quote, start: matched.sentenceStart, end,
    content: {
      action: action?.text ?? '',
      result: result?.text ?? '',
      occurredAt: resolveOccurredDate(quote, anchorIso, 'Asia/Shanghai') ?? '',
    },
  }
}

export function resolveCandidateContent(
  catalogue: readonly ClauseHandle[],
  selection: { quote: string; start: number; end: number },
  picked: { action?: { clauseId?: unknown }; result?: { clauseId?: unknown } },
  anchorIso: string,
): { content: ResolvedCandidateContent; dropped: ('action' | 'result')[] } {
  const dropped: ('action' | 'result')[] = []
  const verbatim = (field: 'action' | 'result'): string => {
    const supplied = picked[field]
    const handle = supplied ? resolveClause(catalogue, supplied.clauseId) : null
    if (!handle || handle.start < selection.start || handle.end > selection.end) {
      if (supplied) dropped.push(field)
      return ''
    }
    return handle.text
  }
  return {
    content: { action: verbatim('action'), result: verbatim('result'), occurredAt: resolveOccurredDate(selection.quote, anchorIso, 'Asia/Shanghai') ?? '' },
    dropped,
  }
}
