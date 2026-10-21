// Structured experience fields stay server-owned: the model only names clause
// handles, and every stored string is verbatim user text or a date derived
// from it. A handle outside the selected experience span would store text the
// user said about something else, so it drops that field — never the candidate.
import { resolveClause, unprotectedClauseText, type ClauseHandle } from './clause-catalogue.ts'
import { resolveOccurredDate } from './growth-time.ts'
import { classifyWithLexicon } from './category-lexicon.ts'
import {conversationPreferenceClause,assistantRequestClause,refusalPreferenceClause} from './user-command-spans.ts'

export type ResolvedCandidateContent = { action: string; result: string; occurredAt: string }

// Structure-only trigger for requiring the candidate lane: a first-person,
// non-question, non-hypothetical clause that reports a COMPLETED action. The
// same clause flags the anchor guards use; no semantics are inferred here.
// Flash-tier models otherwise treat the optional lane as omittable, and the
// lane is the only path from a conversation to the star map.
const COMPLETED_ACTION = /(?:做完|完成|交付|交了|交完|交上去|交过去|交到|交给|补交|补齐|补完|提交了|通过了|发了|发过|发出去|发过去|发到|发给|送到|写完了|写了|写过|赶完|弄完|搞定了|拿到了|参加过|参加了|办了|签了|录了|考了|考过|剪了|排了|整理了|整理过|整理好|准备好|办好|写好|做好|改好|弄好|搞定|送到|寄到|买好|订好|排好|上线了|发布了|发布过|上线|发布|上线|投了|投过|帮过|当过|带过|做过|做了|访谈了|调研了|采访了|拒绝了|拒绝了?|回绝了|申报了|答辩完|办完)/
const NOT_YET = /打算|准备|计划|希望|想要|将要|下次|明天|后天|以后|考虑|如果|假设|还没|尚未|没来得及|没写完|没做完|没完成|没交/
const DEFINED_ARTIFACT=/(?<!决)定了(?:[^。！？，,；;]{1,12}的)?[一二两三四五六七八九十百\d]+(?:条|项|个|套|份)[^。！？，,；;]{0,6}(?:规则|标准|流程|结构|格式|清单|问题)$/
const OWNED_CONTACT_FORM=/^(?:我|本人)(?:已经|实际|今天|昨天|刚刚|之前)?(?:问了|问过|聊过|填过|填了)/
// “交付范围” names an action but “想先确认” has not performed it.
// Shared by the structural fallback and the actual candidate persistence gate.
export const clauseExpressesWishToAct=(text:string):boolean=>/(?:想|要)(?:先|去|尝试|试试|交付|提交|上线|发布|确认|核对|了解)|^(?:先|请|帮我)(?:确认|核对|交付|提交|上线|发布|了解)|(?:只想|就想)(?:聊|说|倾诉|吐槽)/.test(text)
// Keep future-action words scoped to an actual plan statement. Bare keyword
// matching made nouns such as `培养计划` and `采用其中建议` look like an
// unperformed action, which could reject an otherwise completed experience.
export const clauseExpressesFuturePlan=(text:string):boolean=>
  /(?:打算|希望|将要|下次|明天|后天|以后)/.test(text)
  ||/(?:^|[，。；！？\n])(?:我|我们)?(?:计划|准备)(?:先|去|在|于|把|做|联系|确认|核对|提交|交付|尝试|试试|开始)/.test(text)
  ||/(?:^|[，。；！？\n])(?:我|我们)?建议(?:先|去|做|把|联系|确认|核对|提交|交付|尝试|试试)/.test(text)
  ||clauseExpressesWishToAct(text)
// First person scopes the whole sentence: the action clause itself often
// drops the pronoun (「迟了一天补交上去」) while a sibling clause carries it.
export const sentenceIsFirstPersonPublic = (catalogue: readonly ClauseHandle[], handle: ClauseHandle): boolean =>
  catalogue.some(other => other.sentenceStart === handle.sentenceStart && !other.interrogative&&!other.conditional&&!other.attributedToOther&&/我/.test(unprotectedClauseText(other)))
const sentenceIsFirstPerson = sentenceIsFirstPersonPublic

// 对既往经历的追述（上次那套海报后来…）：本身没有新的完成动词，但带着
// 结果/反馈分句时，应作为候选走相似度合并进原经历。
const BACK_REFERENCE = /上次那|上次说|上次提到|之前那次|之前说的|那件事|刚才说的|后来/
export function requiresExperienceCandidate(catalogue: readonly ClauseHandle[]): boolean {
  const completed = catalogue.some(handle =>
    !handle.interrogative && !handle.conditional && !handle.quoted && !handle.code && !handle.attributedToOther
    && sentenceIsFirstPerson(catalogue, handle) && clauseReportsCompleted(unprotectedClauseText(handle)))
  if (completed) return true
  const bySentence = new Map<number, ClauseHandle[]>()
  for (const handle of catalogue) {
    const group = bySentence.get(handle.sentenceStart) ?? []
    group.push(handle)
    bySentence.set(handle.sentenceStart, group)
  }
  for (const handles of bySentence.values()) {
    const text = handles.filter(handle=>!conversationPreferenceClause(handle.text)).map(unprotectedClauseText).join()
    if (BACK_REFERENCE.test(text) && handles.some(handle => !conversationPreferenceClause(handle.text)&&RESULT_SHAPE.test(unprotectedClauseText(handle))) && handles.every(handle => !handle.interrogative && !handle.conditional)) return true
  }
  return false
}

export function clauseReportsCompleted(text: string): boolean {
  if(assistantRequestClause(text)||conversationPreferenceClause(text)||refusalPreferenceClause(text))return false
  if(/(?:没(?:有)?|尚未|还未|未曾).{0,6}(?:开始|完成|做|复习|尝试|交付|发|提交)/.test(text))return false
  // Instructions about classification are not autobiographical completion
  // reports (for example, "不要把这个模板记为已经完成的行动").
  if(/(?:不(?:要)?(?:把)?|不代表).{0,24}(?:记为|当作|视为|算作|表示).{0,16}(?:已(?:经)?完成|完成的行动|经历)/.test(text))return false
  if(/(?:记录|经历).{0,6}(?:保留|留着|不(?:用|要)?删)|(?:保留|留着).{0,6}(?:记录|经历)/.test(text))return false
  // “定了方向/明年去读研” commits to a pursuit. Only a concrete authored
  // artifact makes the bare 定了 form an already performed action.
  return (COMPLETED_ACTION.test(text)||DEFINED_ARTIFACT.test(text)||OWNED_CONTACT_FORM.test(text)||clauseReportsAttempted(text)) && !NOT_YET.test(text) && !clauseExpressesWishToAct(text)
}

// Past aspect is required here: a goal may name “完成” without reporting it
// happened. Both model persistence and deterministic goal capture use this gate.
export function clauseReportsPastAction(text:string):boolean{
  if(!clauseReportsCompleted(text)||clauseExpressesFuturePlan(text)||/(?:^(?:我(?:的)?|本人(?:的)?)?目标(?:是|为)|争取|想要)/.test(text))return false
  if(clauseReportsAttempted(text))return true
  const primary=[COMPLETED_ACTION.exec(text),DEFINED_ARTIFACT.exec(text),OWNED_CONTACT_FORM.exec(text)].filter((match):match is RegExpExecArray=>match!==null).sort((a,b)=>a.index-b.index)[0]
  if(!primary)return false
  const following=text.slice(primary.index+primary[0].length,primary.index+primary[0].length+1)
  if(following==='的')return false
  return /(?:了|过|完|好)$/.test(primary[0])||/^[了过]$/.test(following)||DEFINED_ARTIFACT.test(primary[0])
}

// An attempt is an actual contribution, not successful completion of its task.
export function clauseReportsAttempted(text:string):boolean{
  return /(?:已经尝试|尝试了|试做了|开始尝试)/.test(text)&&!/(?:没(?:有)?|尚未|还未|未曾|想|打算|准备).{0,6}(?:尝试|试做)/.test(text)
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
const RESULT_SHAPE = /说|反馈|评价|效果|结果|还不错|很好|不错|挺好|通过了|被采纳|被表扬|被批评|有问题|有欠缺|按时|晚了|迟了|提前|没回|没用|用了|用上了|采纳|认可|不满意|效果一般|扣分|没扣分|来问|追问|上线|催了|续了|回应了|看过|读过|没有回复|没有回应|找到|查到|取到|打开|少.{0,8}(?:问|询问|提问)/
export function selectStructuralCandidate(sourceText: string, catalogue: readonly ClauseHandle[], anchorIso: string): { quote: string; start: number; end: number; content: ResolvedCandidateContent } | null {
  const matched = catalogue.find(handle =>
    !handle.interrogative && !handle.conditional && !handle.quoted && !handle.code && !handle.attributedToOther
    && sentenceIsFirstPerson(catalogue, handle) && clauseReportsCompleted(unprotectedClauseText(handle)))
    ?? catalogue.find(handle => !handle.interrogative && !handle.conditional && BACK_REFERENCE.test(unprotectedClauseText(handle)) && RESULT_SHAPE.test(unprotectedClauseText(handle)))
  if (!matched) return null
  // Commas chain clauses inside one sentence (sentenceStart resets only at
  // terminators), so the candidate is the whole comma chain the action sits in.
  const sentence = catalogue.filter(handle => handle.sentenceStart === matched.sentenceStart)
  const isCommand=(handle:ClauseHandle)=>!handle.quoted&&!handle.code&&(assistantRequestClause(handle.text)||conversationPreferenceClause(handle.text)||refusalPreferenceClause(handle.text))
  const anchor=sentence.indexOf(matched)
  let first=anchor,last=anchor
  while(first>0&&!isCommand(sentence[first-1]!))first--
  while(last+1<sentence.length&&!isCommand(sentence[last+1]!))last++
  const inSentence=sentence.slice(first,last+1)
  const following=catalogue.find(handle=>handle.start>Math.max(...inSentence.map(c=>c.end)))
  if(following&&!following.conditional&&!following.interrogative&&!following.quoted&&!following.code&&/^(?:对方|客户|导师|老师).{0,12}(?:看过|读过|已读|回复|回应|采用|用了)/.test(following.text))inSentence.push(following)
  const end = Math.max(...inSentence.map(handle => handle.end))
  const start=inSentence[0]!.start
  const quote = sourceText.slice(start, end)
  const action = inSentence.find(handle => !handle.interrogative&&!handle.conditional&&!handle.attributedToOther&&clauseReportsCompleted(unprotectedClauseText(handle)))
  const resultCandidates = inSentence.filter(handle => RESULT_SHAPE.test(unprotectedClauseText(handle)) && handle !== action)
  const laterOutcome=resultCandidates.find(candidate=>/^(?:后来|结果|第二天|随后|最终)/.test(unprotectedClauseText(candidate)))
  const resultStart=laterOutcome??resultCandidates.at(-1)
  const result = resultStart?sourceText.slice(resultStart.start,resultCandidates.at(-1)!.end):''
  return {
    quote, start, end,
    content: {
      action: action?.text ?? '',
      result,
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
