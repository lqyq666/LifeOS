// 行为模式推导：从已确认经历的原话字段里，按确定性规则找跨经历的重现形态。
// 只在同类至少两段经历都支撑同一条规则时成案，产出是"待核对的观察"
// （pattern_candidate, pending），由用户在长期记忆里接受或拒绝；拒绝过的
// 不再重提。所有措辞都锚定原文片段，不做人格结论。
import { scanUserClauses, assistantRequestClause, otherActorClause as otherActor, type UserClause } from './user-command-spans.ts'
import { clauseExpressesFuturePlan } from './experience-content.ts'
export type PatternExperience = {
  id: string
  revision: number
  conversationId: string
  sourceMessageId: string
  quote: string
  action: string
  result: string
  valueIds: string[]
}

export type PatternProposal = {
  behaviorKey: string
  context: string
  behavior: string
  outcome: string
  limitations: string[]
  supporting: PatternExperience[]
  matched: string[]
}

function eligibleClause(clause: UserClause): boolean {
  return !clause.quoted && !clause.code && !clause.conditional && !clause.interrogative
    && !clause.attributedToOther && !clause.quoteSpans.length && !clause.codeSpans.length
}

function ownActor(text: string): boolean {
  return /^(?:(?:但|不过|后来|随后|接着|然后|这次|昨天|今天|之前|当时|上周[一二三四五六日天]?|上学期|上个月|第[一二三四五六七八九十0-9]+版)\s*)*(?:我(?!的|们)|本人)/.test(text)
    || /(?:是|由)我(?:主动|亲自)?(?:发起|组织|制作|提交|交付)/.test(text)
}

const actionContinuation = /^(?:但|不过|后来|随后|接着|然后|并|再|第二版)?(?:按时|提前|如期|赶在|收到|修改|改了|调整|主动|制作|写完|设计|剪辑|开发|整理出|迟了|晚了|比约定|比约好|比说好)/

// Conservative statement polarity after the shared scanner has separated
// propositions. A trailing denial is as binding as a preceding negation.
function deniedStatement(text: string): boolean {
  return /没(?:有)?|尚未|还未|并未|不曾|从未|未能|未曾|否认|不存在|不属实|并非|不是|不确定|不(?:会|能|想|愿|打算|再)/.test(text)
}

type MatchScope = (body: string, previous: string) => boolean
const anchorOf = (experience: PatternExperience, pattern: RegExp, scope?: MatchScope): string | null => {
  // The authorized original quote governs any older extracted label. Do not
  // revive an affirmative action from action/result after the quote denies it.
  for (const text of experience.quote.trim() ? [experience.quote] : [experience.action, experience.result]) {
    const clauses = scanUserClauses(text)
    // Narrative corrections can change the actor or retract an earlier fact
    // without repeating its predicate. Do not guess which clause wins here:
    // the fact record remains available, but this source produces no automatic
    // cross-experience observation until its current version is unambiguous.
    const testimony = clauses.filter(eligibleClause).map(clause => clause.text).join('；')
    if (/(?:后来|事后|复核后|核对后|重新).{0,4}(?:发现|确认|核对|纠正)|其实|实际上|实则|更正|纠正|不是我(?:做|改|交|制作)|(?:那|这)是(?:室友|同学|朋友|老师|导师|他|她|别人)[^。；！？]{0,8}(?:做|改|交|制作)/.test(testimony)) return null
    if (/(?:按时|如期|提前)/.test(testimony) && /(?:晚了|迟了|推迟了|拖了)/.test(testimony)) return null
    let owned = false, ownerSentence = -1
    let matched: string | null = null
    let previous = ''
    for (const [index, clause] of clauses.entries()) {
      const body = clause.text.trim()
      if (!eligibleClause(clause) || otherActor(body)) {
        owned = false
        previous = ''
        continue
      }
      if (owned && deniedStatement(body) && pattern.test(body)) matched = null
      const next = clauses[index + 1]
      const introductoryFeedback = /^收到(?:了|过)?(?:反馈|意见|评价|建议)后$/.test(body)
        && next?.sentenceStart === clause.sentenceStart && eligibleClause(next) && ownActor(next.text) && !otherActor(next.text)
      const retraction = /(?:前面|上面|刚才|之前|那条|这条|那件|这件|那不是我|这不是我)/.test(body) && deniedStatement(body)
      // Subject omission may continue a preceding actor, but a noun-headed
      // passive report cannot acquire ownership from a later "I" clause.
      if ((owned || ownActor(body)) && retraction) matched = null
      const continuation: boolean = owned && (actionContinuation.test(body) || /^(?:后来|随后|接着|然后)(?:核对|确认)/.test(body))
      owned = ownActor(body) || Boolean(introductoryFeedback) || continuation && (ownerSentence === clause.sentenceStart || /^(?:后来|随后|接着|然后|第二版)/.test(body))
      ownerSentence = clause.sentenceStart
      const prior = previous
      previous = owned ? body : ''
      if (!owned || !pattern.test(body)) continue
      if (deniedStatement(body)) {
        matched = null
        continue
      }
      if (assistantRequestClause(body) || clauseExpressesFuturePlan(body) || /是否|想|希望|打算|计划|准备/.test(body)) continue
      if (scope && !scope(body, prior)) continue
      matched = body
    }
    if (matched) return matched
  }
  return null
}

type Rule = {
  behaviorKey: string
  behavior: string
  // Every supporting experience must carry ALL listed anchors somewhere in
  // its verbatim fields. 两项都见于原话才能支撑这条观察——"收到反馈"不足以
  // 推断"已经改进"，改进动词必须在同一段经历里。
  anchors: RegExp[]
  scope?: MatchScope
  // Optional category gate: the rule only counts experiences linked to it.
  requireValueId?: string
}
const delivery = /交付了|提交了|交了|交上去|交过去|交到|交给|补交|交完/
const delay = '(?:晚了|迟了|推迟了|拖了)(?:[一二两三四五六七八九十百0-9]+(?:天|小时|分钟|周))?'
const delayedDelivery = new RegExp(delay + '(?:才)?(?:补交|交付|提交|交了|交上去|交过去|交到|交给|交完)')
const timingContinuation = new RegExp('^(?:比(?:约定|说好|约好)(?:的)?(?:时间)?|交付时间|提交时间)?' + delay + '$')
const RULES: Rule[] = [
  { behaviorKey: 'feedback-iterate', behavior: '这几段经历都提到了反馈与本人调整，二者的关系仍需核对', anchors: [/反馈|意见|评价|建议/, /调整(?:了|过)|修改(?:了|过)|改了|重新做(?:了|过)|返工(?:了|过)/] },
  { behaviorKey: 'deliver-late', behavior: '这几段交付经历都提到了延迟，具体约定仍以各段记录为准', anchors: [/晚了|迟了|推迟了|拖了/], scope: (body, previous) => delayedDelivery.test(body) || timingContinuation.test(body) && delivery.test(previous) && !deniedStatement(previous) && !clauseExpressesFuturePlan(previous) },
  { behaviorKey: 'deliver-ontime', behavior: '这几段经历都报告了按时或提前交付', anchors: [/(?:按时|如期|提前(?:[一二两三四五六七八九十百0-9]+(?:天|小时|分钟))?)(?:完成了?)?(?:交付|提交|交了|交上去|交过去|交到|交给|交稿|交完)/] },
  { behaviorKey: 'initiate', behavior: '这几段经历都报告了本人主动采取行动', anchors: [/主动(?:发起|联系|组织|提出|报名|申请|参与|承担)(?:了|过|的)|(?:是|由)我(?:主动)?(?:发起|组织|提出)的|牵头(?:了|组织了)/] },
  { behaviorKey: 'create-output', behavior: '这几段经历都报告了作品制作行为，完成程度以原记录为准', anchors: [/做出了|制作了|写完了?|设计了|剪辑了|开发了|整理出了/], requireValueId: 'value-creation' },
]

export function derivePatternProposals(experiences: readonly PatternExperience[], includeExperienceId?: string): PatternProposal[] {
  const proposals: PatternProposal[] = []
  for (const rule of RULES) {
    const matching = experiences.filter(experience => {
      if (rule.requireValueId && !experience.valueIds.includes(rule.requireValueId)) return false
      return rule.anchors.every(anchor => anchorOf(experience, anchor, rule.scope) !== null)
    })
    if (matching.length < 2) continue
    // Only propose when the freshly ingested experience is part of the set:
    // old data never churns out proposals on its own.
    if (includeExperienceId && !matching.some(experience => experience.id === includeExperienceId)) continue
    const fresh = matching.find(experience => experience.id === includeExperienceId)
    const supporting = [...(fresh ? [fresh] : []), ...matching.filter(experience => experience !== fresh)].slice(0, 8)
    const matched = supporting.map(experience => anchorOf(experience, rule.anchors[0]!, rule.scope)!)
    proposals.push({
      behaviorKey: rule.behaviorKey,
      context: `本次核对同类经历${supporting.length}段`,
      behavior: rule.behavior,
      outcome: `这些经历的原话都提到：「${[...new Set(matched)].slice(0, 4).join('」「')}」`,
      limitations: ['只核对近期最多64段中的至多8段支持记录，不代表全部经历，也未排除相反例子', '样本还少，是待核对的观察，不是人格结论', '由对话原话自动归纳，可在长期记忆里接受或拒绝'],
      supporting,
      matched,
    })
  }
  return proposals
}
