// Structured experience fields stay server-owned: the model only names clause
// handles, and every stored string is verbatim user text or a date derived
// from it. A handle outside the selected experience span would store text the
// user said about something else, so it drops that field — never the candidate.
import { resolveClause, type ClauseHandle } from './clause-catalogue.ts'
import { resolveOccurredDate } from './growth-time.ts'

export type ResolvedCandidateContent = { action: string; result: string; occurredAt: string }

// Structure-only trigger for requiring the candidate lane: a first-person,
// non-question, non-hypothetical clause that reports a COMPLETED action. The
// same clause flags the anchor guards use; no semantics are inferred here.
// Flash-tier models otherwise treat the optional lane as omittable, and the
// lane is the only path from a conversation to the star map.
const COMPLETED_ACTION = /(?:做完|完成|交付|交了|交完|提交了|通过了|发了|发过|写完了|写了|做出了|做好了|搞定了|拿到了|参加了|办了|签了|录了|剪了|排了|整理了|投了|申报了|答辩完|办完)/
const NOT_YET = /打算|准备|计划|希望|想要|将要|下次|明天|后天|以后|考虑|如果|假设|还没|尚未|没来得及/
export function requiresExperienceCandidate(catalogue: readonly ClauseHandle[]): boolean {
  return catalogue.some(handle =>
    !handle.interrogative && !handle.conditional && !handle.quoted && !handle.code && !handle.attributedToOther
    && /我/.test(handle.text) && COMPLETED_ACTION.test(handle.text) && !NOT_YET.test(handle.text))
}

export function clauseReportsCompleted(text: string): boolean {
  return COMPLETED_ACTION.test(text) && !NOT_YET.test(text)
}

// Deterministic fallback when the model omits the lane: the candidate is the
// full sentence containing a detected completed-action clause. The quote stays
// a server-owned verbatim span; action/result split conservatively by clause
// shape and may legitimately stay empty.
const RESULT_SHAPE = /说|反馈|评价|效果|结果|还不错|很好|不错|挺好|通过了|被采纳|被表扬|被批评|有问题|有欠缺|按时|晚了|迟了|提前|没回|没用|用上了|采纳|认可|不满意|效果一般/
export function selectStructuralCandidate(sourceText: string, catalogue: readonly ClauseHandle[], anchorIso: string): { quote: string; start: number; end: number; content: ResolvedCandidateContent } | null {
  const matched = catalogue.find(handle =>
    !handle.interrogative && !handle.conditional && !handle.quoted && !handle.code && !handle.attributedToOther
    && /我/.test(handle.text) && COMPLETED_ACTION.test(handle.text) && !NOT_YET.test(handle.text))
  if (!matched) return null
  // Commas chain clauses inside one sentence (sentenceStart resets only at
  // terminators), so the candidate is the whole comma chain the action sits in.
  const inSentence = catalogue.filter(handle => handle.sentenceStart === matched.sentenceStart)
  const end = Math.max(...inSentence.map(handle => handle.end))
  const quote = sourceText.slice(matched.sentenceStart, end)
  const action = inSentence.find(handle => COMPLETED_ACTION.test(handle.text) && !NOT_YET.test(handle.text))
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
