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

// The final transaction guard and provisional display share the same success
// vocabulary. Model text is never a receipt for one of these operations.
export function memoryControlSuccessClaims(text:string):{forget:boolean;pause:boolean}{
  return {
    forget:/已(?:经)?(?:为你|帮你|替你)?(?:清掉|清除|删掉|删除|忘掉|忘记|移除|撤下|撤除)/.test(text),
    pause:/不再作为.{0,14}依据|不再.{0,6}(?:判断|建议|使用|推荐|主动提)|不会再?(?:推荐|主动提)|已(?:经)?(?:为你|帮你|替你)?(?:停止推荐|停止使用|停用)/.test(text),
  }
}

export type ForgetIntentClause = {
  kind: ForgetIntentKind
  clauseText: string
  // True when the clause carries an explicit keep/preserve instruction that
  // forbids deletion (记录保留 / 先不删 / 保留记录).
  preserveRequested: boolean
}

export type UnconfirmedLabelRejection = {
  label: string
  boundaryQuotes: string[]
}

// Label controls name a proposition, not an opposite preference. Matching
// its literal predicate never turns an unconfirmed label into a personal fact.
function personalLabelKey(text:string){
  return text.trim().replace(/[。！？.!?]+$/,'').replace(/^(?:我|你|本人)(?:现在|目前|其实|确实|真的|的确|明确|确认自己|确认我|确认|自己)*/,'')
}
export function samePersonalLabel(left:string,right:string){return personalLabelKey(left)===personalLabelKey(right)}
export function explicitlyConfirmsLabel(text:string,label:string){
  return scanUserClauses(text).some(c=>!c.quoted&&!c.code&&!c.conditional&&!c.interrogative&&!c.attributedToOther&&!c.quoteSpans.length&&!c.codeSpans.length&&/^(?:我|本人)/.test(c.text.trim())&&samePersonalLabel(c.text,label))
}
const labelNonAssertion=/(?:不能|无法|没有证据|不代表|不等于|并非|不是|不要|不会|不再|是否|能否|不确定|未知|未确认|未经确认|否认|拒绝|撤回|不认同|不承认)/
export function violatesLabelInferenceBoundary(text:string,boundaries:readonly {label:string;active:boolean}[],currentUserText=''){
  const blocked=boundaries.filter(boundary=>boundary.active&&!explicitlyConfirmsLabel(currentUserText,boundary.label)).map(boundary=>personalLabelKey(boundary.label)).filter(Boolean)
  const clauses=scanUserClauses(text)
  return clauses.some(c=>!c.quoted&&!c.code&&!c.conditional&&!c.interrogative&&!c.attributedToOther&&!c.quoteSpans.length&&!c.codeSpans.length
    &&!labelNonAssertion.test(c.text)
    &&blocked.some(label=>{
      const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
      const predicate=new RegExp('(?:你(?!们)|我(?!们)|本人)(?:其实|确实|似乎|可能|已经|现在|目前|很|比较|显然|大概|也|还|仍然|非常|真的|原来|应该|是个|是|挺)*'+escaped)
      // A named proposition can be the topic before its personal owner:
      // “喜欢销售，是你从这些经历里表现出的倾向”. Comma splitting
      // must not hide that ownership; keep it inside the same sentence.
      const topicOwned=c.text.trim().startsWith(label)&&clauses.some(other=>other.sentenceStart===c.sentenceStart&&other.start>=c.start
        &&!other.quoted&&!other.code&&!other.conditional&&!other.interrogative&&!other.attributedToOther&&!other.quoteSpans.length&&!other.codeSpans.length
        &&!labelNonAssertion.test(other.text)
        &&/(?:你(?!们)|本人)/.test(other.text))
      const standalone=c.text.trim()===label&&!clauses.some(other=>other.sentenceStart===c.sentenceStart&&other.start!==c.start)
      return standalone||predicate.test(c.text)||topicOwned
    }))
}

// Erase commands. Matched positively; a negation directly in front of one of
// these (不要删除 / 先别删掉) is a REFUSAL handled separately below.
const removalVerbs = /删除|删掉|清除|清掉|移除|去掉|抹掉/
const forgetVerb = new RegExp(`(?:忘掉|忘记(?!了)|忘了吧|删了|(?:${removalVerbs.source})(?!了))`)
const retentionVerb = /(?:不要|不想|不用|无需|不必|不再)(?:再)?保留(?!的)/
const forgetCommands = new RegExp(`${forgetVerb.source}|${retentionVerb.source}`)
const completedRemoval = new RegExp(`(?:${removalVerbs.source})[了过]|删了`)
const forgetLead = /^(?:(?:顺便|然后)\s*)?(请(?:帮我|你)?|麻烦(?:你)?|帮我(?:来)?|我(?:想|要|希望|需要))?\s*/
const leadingForget = new RegExp(`^${forgetVerb.source}`)
const objectFirstForget = new RegExp(`^(?:把|将)(.+)${forgetVerb.source}吧?$`)
const terminalRetention = new RegExp(`${retentionVerb.source}(?:了?吧|了)?$`)
const memoryNouns = /经历|记录|记忆|条目|档案|内容|信息|事实|对话|目标|计划|材料|标签|偏好/g
const interfaceNouns = /面板|按钮|界面|功能|入口|组件|卡片|控件/g
const namedMemoryObject = new RegExp(`(?:的|(?:这|那|该)(?:条|段|件|份|个|项))(?:${memoryNouns.source})`,'g')
const laterReport = /后(?:我|本人)(?:又|还|就|才|已经)/
const completedSentenceTail = /了[啊呀嘛啦哦喔呐咯诶欸哟]*$/
const independentInterfaceAction = /^(?:并且?|同时|然后|另外)(?:还|也|再)?(?:保留|继续|保持|关闭|打开|显示)/
const controlWords = new Intl.Segmenter('zh',{granularity:'word'})
function followsCompletedVerb(text:string):boolean{
  if(text.startsWith('了'))return true
  if(!text.startsWith('过'))return false
  const word=controlWords.segment(text).containing(0)?.segment
  return word==='过'||word==='过的'
}
function namesInterfaceObject(text:string):boolean{
  const ui=[...text.matchAll(interfaceNouns)].at(-1)
  if(!ui)return false
  const memory=[...text.matchAll(memoryNouns)].at(-1)
  return !memory||ui.index>memory.index
}
function afterNamedMemoryObject(text:string):string|null{
  const named=[...text.matchAll(namedMemoryObject)].at(-1)
  if(!named)return null
  const tail=text.slice(named.index+named[0].length)
  return completedRemoval.test(tail)||laterReport.test(tail)?null:tail
}
// Return words outside the object. False closes the destructive path for a
// completed report, a refused command, or removal of a UI control.
function governingForget(body:string):string|false|null{
  const [lead,address]=forgetLead.exec(body)!
  const command=body.slice(lead.length)
  const leading=leadingForget.exec(command)?.[0]
  // An old removal inside a named object does not supply its own authority.
  // Bare commands with old removal words need that object boundary.
  if(leading&&(leading!=='删了'||address||command.startsWith('删了吧'))){
    const object=command.slice(leading.length)
    const tail=afterNamedMemoryObject(object)
    const target=tail&&independentInterfaceAction.test(tail)?object.slice(0,-tail.length):object
    if(namesInterfaceObject(target)||followsCompletedVerb(object)||!address&&completedSentenceTail.test(target))return false
    if(address||!completedRemoval.test(object)||tail!==null&&!laterReport.test(object))return tail??body
  }
  const object=objectFirstForget.exec(command)?.[1]
  if(object){
    if(namesInterfaceObject(object)||refusesGoverningVerb.test(object))return false
    const tail=afterNamedMemoryObject(object)
    if(!address&&tail===null&&completedRemoval.test(object)&&object.includes('后'))return false
    return tail??''
  }
  const retention=terminalRetention.exec(command)
  const tail=retention?afterNamedMemoryObject(command.slice(0,retention.index)):null
  return tail!==null&&!refusesGoverningVerb.test(tail)?tail:null
}
// Stop-using commands: the negative wording IS the command.
const pauseUseCommands = /(?:不(?:要再?|再)?(?:用来?)?作为[^。！？]{0,10}(?:依据|参考)|不再作为[^。！？]{0,10}(?:依据|参考)|不再?用来?作为[^。！？]{0,10}(?:依据|参考)|别再?作为[^。！？]{0,10}(?:依据|参考)|别再用|别再拿|不要再拿|不要拿|不想再用|不必再用|不再用|先不用|暂时不用|别拿|停止使用|停止作为[^。！？]{0,10}(?:依据|参考))/
// Stop-recommending commands (narrower than stop-using: mentions 推/推荐/提).
const stopRecommendCommands = /(?:别再推荐|不要再推荐|不再推荐|不要再推|先别推|别推|停止推荐|别再提|不要再提|先别提|别提|不再主动提)/
// A negation directly preceding an erase verb turns the clause into refusal.
const refusalVerb = new RegExp(`(?:${removalVerbs.source}|删了|忘掉|忘记)`)
const refusalLead = /(?:不(?:要|想|用|必|该|是)?|别|莫|勿|没(?:有)?|并非)(?:再)?(?:(?:给|替|帮)我)?/
const refusesGoverningVerb = new RegExp(`${refusalLead.source}$`)
const refusedForget = new RegExp(`${refusalLead.source}(?:${refusalVerb.source}|(?:把|将).+${refusalVerb.source}吧?$)`)
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
    // Product UI removal is not authority to erase a lexically similar memory.
    if(/(?:删除|删掉|移除|去掉)[^。！？]{0,24}(?:面板|按钮|界面|功能|入口|组件)/.test(body)
      &&!/(?:记录|记忆|档案|经历|目标)/.test(body))continue
    // Quotes, code, third-party speech and conditionals never state the
    // user's own control intent.
    if (clause.quoted || clause.code || clause.attributedToOther || clause.conditional) continue
    // The scanner flags conditionality for clauses AFTER the opener; the
    // opener clause itself still carries 如果/要是 and is equally hypothetical.
    if (/(?:如果|要是|假如|假设|万一|一旦|以后想|以后再)/.test(body)) continue
    // A question about how to do it is not the operation itself.
    if (questionLike.test(body) || clause.interrogative) continue
    const governing=governingForget(body)
    if(governing===false)continue
    if(governing===null&&cognitiveLapse.test(body))continue
    const preserveRequested = preserveMarkers.test(governing??body)
    let kind: ForgetIntentKind = null
    if(governing!==null)kind='forget'
    else if (stopRecommendCommands.test(body)) kind = 'stop_recommend'
    else if (pauseUseCommands.test(body)) kind = 'pause_use'
    else if(!refusedForget.test(body)&&!completedRemoval.test(body)&&forgetCommands.test(body))kind='forget'
    if (!kind) continue
    // A delete request softened by an explicit same-clause preserve note
    // ("先不删，别再用") is a pause, not a forget.
    if (preserveRequested && kind === 'forget') kind = 'pause_use'
    found.push({ kind, clauseText: body, preserveRequested })
  }
  return found
}

// A user may ask to remove a label that was never stored in the first place
// and explicitly forbid recreating the same inference.  This is not a target
// for the destructive forget transaction: there is no record to delete.  It
// is a durable user boundary, however, so the turn engine can save the exact
// instruction and answer truthfully instead of claiming a phantom deletion.
export function detectUnconfirmedLabelRejection(text: string): UnconfirmedLabelRejection | null {
  const labelMatch=text.match(/(?:忘掉|删除|删掉|清除|移除|去掉)[^“「『\"']{0,8}[“「『\"']([^”」』\"']{1,80})[”」』\"'](?:这个|这条)?(?:从未|未曾|没有)(?:由我|本人)?确认(?:过)?(?:的)?(?:错误|不准确|未经确认)?标签/)
  const label=labelMatch?.[1]?.trim()
  if(!label)return null
  const boundary=scanUserClauses(text).find(clause=>
    !clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&!clause.interrogative
    &&/(?:不要|别|不再).{0,18}(?:从|根据|依据).{0,40}(?:重新)?(?:推出来|推出|推导|推断)/.test(clause.text)
  )
  // Retain the original control and its quoted object together. Saving only
  // “不要重新推出来” loses the referent in the next conversation.
  const command=scanUserClauses(text).find(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&!clause.interrogative&&clause.text.includes(labelMatch![0]))
  return command?{label,boundaryQuotes:[...new Set((boundary?[command,boundary]:[command]).sort((a,b)=>a.start-b.start).map(clause=>clause.text.trim()))]}:null
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
  const rejection=detectUnconfirmedLabelRejection(currentMessage)
  if(rejection&&controlClauseText.includes(rejection.label)&&detectForgetIntentClauses(controlClauseText).some(clause=>clause.kind==='forget')){
    items=items.filter(item=>samePersonalLabel(item.text,rejection.label))
  }
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
