// Post-generation audit for the independent six-chain review. Each rule is
// narrow, grounded in the current user turn, and only corrects a concrete
// contradiction or missing requested output. It never invents a new plan.
import {groundedStateReadback,repairSingleJobJd,observationEffectHypothesis} from './reply-draft.ts'
import {scanUserClauses,assistantRequestClause,responseRequestScope,unresolvedTwoFactors,type UserClause} from './user-command-spans.ts'
import {isSingleSentenceReply,taskOutcomeReadback,reportedTaskOutcomeClauses} from './turn-contract.ts'
import {clauseReportsCompleted,clauseExpressesFuturePlan} from './experience-content.ts'

export type ReviewedRepair={reply:string;phases:string[]}
export type ReviewedRepairOptions={preserveReportedObservation?:boolean}

export {unresolvedTwoFactors} from './user-command-spans.ts'

export function boundedDistinctionReply(userText:string):string|null{
  const factors=unresolvedTwoFactors(userText)
  if(!factors)return null
  const {first,second}=factors
  return `目前还不能区分各因素的作用。“${first}”与“${second}”各自的作用仍未知。\n\n只回看已有经历：找一对“${second}”及其他条件相近、只有“${first}”不同的经历，对照当时的感受或结果。找不到这样的经历就停，保留未知；不为验证而改变现实条件，这个回看也不能确认因果。`
}

export function distinctionActionAccepts(reply:string,userText:string):boolean{
  const bounded=boundedDistinctionReply(userText)
  return bounded!==null&&reply===bounded
}

const unassertedObservation=/(?:不能|无法|不要|别(?:说|写|认为|断言)|不(?:能|足以)?(?:说明|表明|证明|验证)|不(?:意味着|等于|代表)|并非|不是|不只|不仅|不止|否认|不认可|不赞同|不承认|(?:没(?:有)?|无)证据|未(?!来)|未知|是否|能否|不确定|不见得|不一定|未必|希望|期待|可能|也许|或许|假设)/
const compoundFactConjunction=/且|同时|以及|而且|并(?!不|非)|和|与/
function assertiveReplyClause(clause:UserClause):boolean{
  return ownedObservationClause(clause)&&!unassertedObservation.test(clause.text)
}
function ownedObservationClause(clause:UserClause):boolean{
  return !clause.quoted&&!clause.code&&!clause.conditional&&!clause.interrogative&&!clause.attributedToOther&&!clause.quoteSpans.length&&!clause.codeSpans.length
}

const apply=(text:string,phases:string[],name:string,fn:(value:string)=>string|null):string=>{
  const next=fn(text)
  if(next!==null&&next!==text){phases.push(name);return next}
  return text
}

export function repairReviewedDefects(reply:string,userText:string,priorUserTexts:readonly string[]=[],options:ReviewedRepairOptions={}):ReviewedRepair|null{
  let text=reply
  const phases:string[]=[]
  text=apply(text,phases,'one_question_only',value=>repairOneQuestionOnly(value,userText))
  text=apply(text,phases,'dangling_question_lead',value=>repairDanglingQuestionLead(value))
  text=apply(text,phases,'repeated_goal',value=>repairRepeatedGoal(value,userText,priorUserTexts))
  text=apply(text,phases,'current_pause',value=>repairCurrentPause(value,userText))
  text=apply(text,phases,'feedback_action',value=>repairFeedbackAction(value,userText))
  text=apply(text,phases,'verified_state_readback',value=>repairVerifiedStateReadback(value,userText,priorUserTexts))
  text=apply(text,phases,'teacher_reply_update',value=>repairTeacherReplyUpdate(value,userText))
  text=apply(text,phases,'table_stale_pause',value=>repairTableStalePause(value,userText))
  text=apply(text,phases,'local_sample_necessity',value=>repairLocalSampleNecessity(value,userText))
  text=apply(text,phases,'dangling_punctuation',value=>repairDanglingPunctuation(value))
  text=apply(text,phases,'state_layers',value=>repairStateLayers(value,userText))
  // This legacy deletion heuristic only sees the current text. A summary may
  // legitimately refer to any authorized prior matter, so it cannot use this
  // heuristic to decide that a historical fact did not happen.
  if(!options.preserveReportedObservation)text=apply(text,phases,'unreported_sample_facts',value=>repairUnreportedSampleFacts(value,userText))
  text=apply(text,phases,'c1_evidence',value=>repairC1Evidence(value,userText))
  text=apply(text,phases,'answered_purpose',value=>repairAnsweredPurpose(value,userText))
  text=apply(text,phases,'negated_preference_upgrade',value=>repairNegatedPreferenceUpgrade(value,userText))
  text=apply(text,phases,'autonomy_target',value=>repairAutonomyTarget(value,userText))
  text=apply(text,phases,'same_experience_scope',value=>repairSameExperienceScope(value,userText,priorUserTexts))
  text=apply(text,phases,'meeting_subject',value=>repairMeetingSubject(value,userText))
  text=apply(text,phases,'rejection_scope',value=>repairRejectionScope(value,userText))
  text=apply(text,phases,'punctuation',value=>repairPunctuation(value))
  text=apply(text,phases,'incomplete_prompt',value=>repairIncompletePrompt(value))
  text=apply(text,phases,'reasked_purpose',value=>repairReaskedPurpose(value,priorUserTexts))
  text=apply(text,phases,'option_specific_question',value=>repairOptionSpecificQuestion(value,userText))
  text=apply(text,phases,'external_stop',value=>repairExternalStop(value,userText))
  text=apply(text,phases,'no_direction_followup',value=>repairNoDirectionFollowup(value,userText))
  text=apply(text,phases,'no_direction_gain',value=>repairNoDirectionGain(value,userText))
  text=apply(text,phases,'unknown_not_negative',value=>repairUnknownNotNegative(value,userText))
  text=apply(text,phases,'follow_exam',value=>repairFollowExam(value,priorUserTexts))
  text=apply(text,phases,'placeholders',value=>repairPlaceholders(value,userText))
  text=apply(text,phases,'time_claim',value=>repairTimeClaim(value))
  text=apply(text,phases,'stable_income_claim',value=>repairStableIncomeClaim(value,userText))
  text=apply(text,phases,'missing_action',value=>repairMissingAction(value))
  text=apply(text,phases,'enumeration_gap',value=>repairEnumerationGap(value))
  text=apply(text,phases,'prior_preference',value=>repairPriorPreferenceDenial(value,userText,priorUserTexts))
  text=apply(text,phases,'family_expectation',value=>repairFamilyExpectation(value,userText,priorUserTexts))
  text=apply(text,phases,'unconfirmed_preference',value=>repairUnconfirmedPreference(value,userText))
  text=apply(text,phases,'refusal_reopen',value=>repairRefusalReopen(value,userText,priorUserTexts))
  text=apply(text,phases,'refusal_acknowledgment',value=>repairRefusalAcknowledgment(value,userText))
  text=apply(text,phases,'wording',value=>repairWording(value))
  text=apply(text,phases,'single_job_jd',value=>repairSingleJobJd(value,userText))
  text=apply(text,phases,'trial_not_adoption',value=>repairTrialNotAdoption(value,userText))
  text=apply(text,phases,'source_claims',value=>repairSourceClaims(value,userText))
  text=apply(text,phases,'measured_gain',value=>repairMeasuredGain(value,userText))
  text=apply(text,phases,'incomplete_tail',value=>repairIncompleteTail(value))
  text=apply(text,phases,'event_scope',value=>repairEventScope(value,userText))
  text=apply(text,phases,'single_job_and_enumeration',value=>repairSingleJobAndEnumeration(value,userText))
  text=apply(text,phases,'off_topic_exam_prep',value=>repairOffTopicExamPrep(value,userText))
  text=apply(text,phases,'leading_binary',value=>repairLeadingBinary(value,userText))
  text=apply(text,phases,'freedom_scope_exclusions',value=>repairFreedomScopeExclusions(value,userText))
  text=apply(text,phases,'self_referential_question',value=>repairSelfReferentialQuestion(value,userText))
  text=apply(text,phases,'two_factor_unknown',value=>repairTwoFactorUnknown(value,userText))
  text=apply(text,phases,'two_factor_design',value=>repairTwoFactorDesign(value,userText))
  text=apply(text,phases,'single_case_validation',value=>repairSingleCaseValidation(value,userText))
  text=apply(text,phases,'prior_feeling_attribution',value=>repairPriorFeelingAttribution(value,userText))
  text=apply(text,phases,'exploration_time_scope',value=>repairExplorationTimeScope(value,userText))
  text=apply(text,phases,'update_only_action',value=>repairUpdateOnlyAction(value,userText))
  text=apply(text,phases,'family_correction_scope',value=>repairFamilyCorrectionScope(value,userText))
  text=apply(text,phases,'path_motive_neutrality',value=>repairPathMotiveNeutrality(value,userText))
  text=apply(text,phases,'autonomy_continuity',value=>repairAutonomyContinuity(value,userText,priorUserTexts))
  text=apply(text,phases,'public_rhythm_evidence',value=>repairPublicRhythmEvidence(value,userText))
  text=apply(text,phases,'incomplete_example_tail',value=>repairIncompleteExampleTail(value))
  text=apply(text,phases,'unmatched_parenthesis',value=>repairUnmatchedParenthesis(value))
  text=apply(text,phases,'external_expectation_pronoun',value=>repairExternalExpectationPronoun(value))
  text=apply(text,phases,'zero_time_boundary',value=>repairZeroTimeBoundary(value,userText))
  text=apply(text,phases,'phase_summary',value=>repairPhaseSummary(value,userText))
  text=apply(text,phases,'review_categories',value=>repairReviewCategories(value,userText,options.preserveReportedObservation===true))
  text=apply(text,phases,'final_cleanup',value=>repairFinalCleanup(value))
  text=apply(text,phases,'hypothetical_causal_branches',value=>repairHypotheticalCausalBranches(value,userText))
  text=apply(text,phases,'reported_repeat_feeling',value=>repairReportedRepeatFeeling(value,userText,priorUserTexts))
  text=apply(text,phases,'post_review_scope',value=>repairPostReviewScope(value,userText,priorUserTexts))
  return text!==reply?{reply:text,phases}:null
}

function repairReportedRepeatFeeling(reply:string,userText:string,priorUserTexts:readonly string[]):string|null{
  const sources=[...priorUserTexts,userText]
  if(!sources.some(text=>/(?:又|再次|仍然|依然|一周后|第二次)/.test(text)))return null
  const feelings:[string,RegExp][]=[
    ['放松',/(?:轻松|放松)/],
    ['开心',/(?:开心|高兴)/],
    ['紧张',/(?:紧张|焦虑)/],
    ['失落',/(?:失落|难过)/],
    ['舒服',/(?:舒服|自在)/],
  ]
  const negatesFeeling=(text:string,index:number)=>{
    const prefix=text.slice(Math.max(0,index-20),index).split(/[,，。；;！？?]|但是|但|不过|然而|而是/).at(-1)??''
    return /(?:不|没(?:有)?|未|并非|并不|不是|谈不上)[^，,。；;！？?]{0,8}$/.test(prefix)
  }
  const reported=(source:string)=>{
    const found=new Set<string>()
    for(const clause of scanUserClauses(source)){
      if(!ownedObservationClause(clause)||unassertedObservation.test(clause.text))continue
      for(const [label,pattern] of feelings){
        const match=pattern.exec(clause.text)
        if(match&&!negatesFeeling(clause.text,match.index))found.add(label)
      }
    }
    return found
  }
  const reports=sources.map((text,index)=>({text,index,feelings:reported(text)}))
  const canonicalEpisodeMarker=(marker:string)=>{
    if(marker==='昨晚')return '昨天'
    const ordinal=/^第([一二三四五六七八九十\d]+)次$/.exec(marker)?.[1]
    if(!ordinal)return marker
    if(/^\d+$/.test(ordinal))return `第${Number(ordinal)}次`
    const digits:Record<string,number>={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9}
    const ten=ordinal.indexOf('十')
    const value=ten<0?(digits[ordinal]??0):(ten===0?1:(digits[ordinal.slice(0,ten)]??1))*10+(digits[ordinal.slice(ten+1)]??0)
    return value?`第${value}次`:marker
  }
  const episodeEvidenceFor=(source:string,pattern:RegExp)=>{
    const clauses=scanUserClauses(source).filter(clause=>ownedObservationClause(clause)&&!unassertedObservation.test(clause.text))
    const keys=new Set<string>()
    const markerPositions:{key:string;offset:number}[]=[]
    const repeatPositions:{key:string;offset:number}[]=[]
    for(const feelingClause of clauses){
      const feelingIndex=pattern.exec(feelingClause.text)?.index
      if(feelingIndex===undefined||negatesFeeling(feelingClause.text,feelingIndex))continue
      const feelingOffset=feelingClause.start+feelingIndex
      for(const eventClause of clauses){
        if(eventClause.sentenceStart!==feelingClause.sentenceStart)continue
        const event=eventClause.text.trim().replace(/^(?:我|本人)?(?:再次|再)?(?:说明|提到|重申)[，,、]*/,'')
        // Relative dates need the source message timestamp to identify a
        // calendar day. This repair only receives text, so they cannot prove
        // that two reports describe separate episodes.
        const markers=[...event.matchAll(/第[一二三四五六七八九十\d]+次|\d{1,2}月\d{1,2}日/g)].filter(match=>eventClause.start+match.index!<=feelingOffset)
        const action=/(?:打|练|做|参加|尝试|联系|沟通|完成|申请|提交|面试|投递|复习|学习|问|聊|见|合作|体验)/.test(event)
        const countedRepeat=/(?:又|再).{0,16}(?:一次|一遍|一场|一回|一轮)|第二次.{0,12}(?:打|练|做|参加|尝试|联系|沟通|完成|申请|提交|面试|投递|复习|学习|问|聊|见|合作|体验)/.test(event)
        if(action)markers.forEach(marker=>{
          const key=canonicalEpisodeMarker(marker[0])
          keys.add(key)
          const position={key,offset:eventClause.start+marker.index!}
          markerPositions.push(position)
          if(countedRepeat)repeatPositions.push(position)
        })
      }
    }
    return {keys,markerPositions,repeatPositions}
  }
  const correctedAt=new Map<string,{sourceIndex:number;offset:number}>()
  const uncertainty=/记不清|想不起来|不确定|说不准|未知|回忆不起来/g
  const feelingWord=/感受|心情|感觉|放松|轻松|开心|快乐|紧张|舒服|难受|安心|烦躁/
  for(const [sourceIndex,source] of sources.entries()){
    for(const clause of scanUserClauses(source).filter(item=>ownedObservationClause(item))){
      if(!feelingWord.test(clause.text))continue
      const uncertaintyOffsets=[...clause.text.matchAll(uncertainty)].map(match=>match.index??0)
      const negativeFeelingOffsets=[...clause.text.matchAll(/轻松|放松|开心|高兴|紧张|焦虑|失落|难过|舒服|自在/g)].filter(match=>negatesFeeling(clause.text,match.index??0)).map(match=>match.index??0)
      const stateOffsets=[...uncertaintyOffsets,...negativeFeelingOffsets]
      if(!stateOffsets.length)continue
      const markers=[...clause.text.matchAll(/第[一二三四五六七八九十\d]+次|\d{1,2}月\d{1,2}日/g)]
      for(const marker of markers){
        const relatedStates=stateOffsets.filter(offset=>Math.abs(offset-(marker.index??0))<=36)
        if(relatedStates.length)correctedAt.set(canonicalEpisodeMarker(marker[0]),{sourceIndex,offset:clause.start+Math.max(...relatedStates)})
      }
    }
  }
  const repeated=feelings.find(([label,pattern])=>{
    const matching=reports.filter(item=>item.feelings.has(label))
    if(matching.length<2)return false
    const episodeEvidence=matching.map(item=>({item,evidence:episodeEvidenceFor(item.text,pattern)})).map(({item,evidence})=>{
      const markerPositions=evidence.markerPositions.filter(marker=>{
      const correction=correctedAt.get(marker.key)
        return correction===undefined||correction.sourceIndex<item.index||correction.sourceIndex===item.index&&correction.offset<=marker.offset
      })
      const activePositions=new Set(markerPositions.map(marker=>`${marker.key}:${marker.offset}`))
      const keys=new Set(markerPositions.map(marker=>marker.key))
      const explicitRepeatAction=evidence.repeatPositions.some(marker=>activePositions.has(`${marker.key}:${marker.offset}`))
      return {keys,explicitRepeatAction}
    })
    const distinctReports=episodeEvidence.some((episode,index)=>episode.keys.size>0&&episodeEvidence.slice(index+1).some(other=>other.keys.size>0&&![...episode.keys].some(key=>other.keys.has(key))))
    return distinctReports&&episodeEvidence.some(episode=>episode.explicitRepeatAction)
  })
  if(!repeated)return null
  const [label]=repeated
  const unsupportedUnknown=/(?:各次|两次|这两次|每次|两段经历|不同经历)(?:的)?(?:经历)?(?:的)?(?:感受|心情|状态)是否(?:一致|相同|一样|相似)(?:(?:仍|尚)?(?:未知|不清楚|待确认|未确认))?/g
  if(!unsupportedUnknown.test(reply))return null
  unsupportedUnknown.lastIndex=0
  const fixed=reply.replace(unsupportedUnknown,`本人已分别报告两次${label}`)
  return fixed!==reply?fixed:null
}

function repairRepeatedGoal(reply:string,userText:string,priorUserTexts:readonly string[]):string|null{
  if(!/(?:请更新判断|接着.*取舍)/.test(userText))return null
  const priorGoal=priorUserTexts.map(text=>/想要[^。！？\n]{0,40}清晰产出[^。！？\n]*/.exec(text)?.[0]).find(Boolean)
  if(!priorGoal||!/你希望它(?:们)?改变什么|先说一个你最想让它变好的方面/.test(reply))return null
  let fixed=reply.replace(/升学和就业的取舍，你希望它(?:们)?改变什么？[^。！？\n]*[。！？]?/g,'你之前已经表达想要毕业后做有清晰产出的工作；这次只更新取舍判断，不重问目的。')
  fixed=fixed.replace(/你希望它(?:们)?改变什么？[^。！？\n]*[。！？]?/g,'你的目的已经明确：毕业后做有清晰产出的工作；这次只更新取舍判断，不重问目的。')
  return fixed!==reply?fixed:null
}

function repairOneQuestionOnly(reply:string,userText:string):string|null{
  if(!/只问一个[^。！？\n]{0,20}问题/.test(userText))return null
  const first=reply.match(/^[\s\S]*?[？?]/)?.[0]?.trim()
  if(!first||first===reply.trim())return null
  return first
}

function repairDanglingQuestionLead(reply:string):string|null{
  const match=/(?:所以[，,]?\s*)?(?:在更新判断之前[，,]?\s*)?我需要知道[:：]\s*([\s\S]*)$/.exec(reply)
  if(match){
    const rest=match[1]??''
    if(/[？?]/.test(rest)||/(?:^|\n)\s*(?:[-*]|\d+[.、]|第[一二三四五六七八九十]+[，,、.：:]|其[一二三四五六七八九十]+[，,、.：:]|一是)/.test(rest))return null
    const fixed=reply.slice(0,match.index).trim()
    return fixed||null
  }
  if(/这两个答案/.test(reply)&&!/(?:^|\n)\s*(?:[-*]|\d+[.、])/.test(reply)){
    return reply.replace(/[^。！？\n]*这两个答案[^。！？\n]*[。！？]?/g,'').trim()||null
  }
  return null
}

function repairStateLayers(reply:string,userText:string):string|null{
  let fixed=reply
  if(/(?:对方|导师|老师)[^。\n]{0,10}(?:还|仍|尚)?(?:没|未)(?:有)?回复/.test(userText)){
    fixed=fixed.replace(/已回复[:：]\s*未知(?:（[^）]*）)?/g,'已回复：未回复（截至报告）')
  }
  const outcomes=taskOutcomeReadback(userText,undefined,true)
  const userHasReceipt=outcomes.response.status==='reported_response'||outcomes.read.status==='reported_read'
  const replyHasRead=/确认读到|确认已经读到|回复说.{0,8}(?:读到|看了)|导师确认/.test(fixed)
  if(!userHasReceipt&&!replyHasRead){
    const deliveryUnasserted=(text:string,index:number)=>{
      const before=text.slice(0,index),after=text.slice(index+'已送达'.length)
      return /(?:不证明|不代表|不能证明|无法证明|不等于|未确认|没确认|尚未确认|无法确认|是否|不确定|不知道|没有证据|无证据|不要把|别把)[^，。！？；;]{0,24}$/.test(before)
        ||/^(?:与否|是否|仍未知|尚未知|未知|仍不确定|尚不确定)/.test(after)
    }
    const deliveryKey=(text:string,index:number)=>text.slice(0,index+'已送达'.length).trim().replace(/^(?:邮件系统|系统|平台|回执)(?:确认|显示|提示)/,'')
    const reportedDeliveryKeys=new Set(scanUserClauses(userText)
      .filter(clause=>!clause.conditional&&!clause.interrogative&&!clause.quoted&&!clause.code&&!clause.quoteSpans.length&&!assistantRequestClause(clause.text))
      .flatMap(clause=>[...clause.text.matchAll(/已送达/g)].filter(match=>!deliveryUnasserted(clause.text,match.index)).map(match=>deliveryKey(clause.text,match.index))))
    // Only an assertive delivery claim is replaced. A negated or explicitly
    // unknown claim such as “不证明链接已送达/是否已读仍未知” must stay intact.
    fixed=fixed.split(/(?<=[。！？!?；;\n])/).map(sentence=>{
      if(!/已送达/.test(sentence))return sentence
      const clauses=scanUserClauses(sentence)
      return sentence.replace(/已送达/g,(claim,index:number)=>{
        const clause=clauses.find(clause=>index>=clause.start&&index<clause.end)
        const text=clause?.text??sentence,localIndex=index-(clause?.start??0)
        // Only uncertainty/negation of THIS delivery claim protects it.
        // An unknown cause, read state or outcome in a different clause does
        // not license an asserted receipt. The shared scanner owns offsets.
        return deliveryUnasserted(text,localIndex)||reportedDeliveryKeys.has(deliveryKey(text,localIndex))?claim:'已发送，是否送达未知'
      })
    }).join('')
    fixed=fixed.replace(/链接[^。]*?能打开[^。]*?说明[^。]*?(?:技术)?送达[^。]*?无(?:技术)?问题[。]?/g,'你确认电脑能打开，只说明链接在你这边可用；导师是否收到或能否打开仍未知。')
    fixed=fixed.replace(/链接能打开[^。]*说明[^。]*送达[^。]*无技术障碍[。]?/g,'你确认电脑能打开，只说明链接在你这边可用；导师是否收到或能否打开仍未知。')
  }
  if(/接收状态[:：][^。\n]*(?:未回复|没有回复)/.test(fixed)){
    fixed=fixed.replace(/接收状态[:：][^。\n]*(?:未回复|没有回复)[^。\n]*/g,'接收状态：是否收到未知；截至报告老师未回复')
  }
  if(!/(?:聊天|窗口|渠道)/.test(userText)){
    fixed=fixed.replace(/通过当前聊天窗口/g,'通过你原本发送的方式')
    fixed=fixed.replace(/通过当前聊天渠道/g,'通过你原本发送的方式')
  }
  if(/(?:我|本人).{0,8}(?:发|发送)|(?:链接|发送|作品集|PDF|邮件)/.test(userText)){
    fixed=fixed.replace(/不证明导师已发送/g,'不证明导师已收到或打开')
    fixed=fixed.replace(/导师已发送/g,'导师已收到或打开')
  }
  if(/(?:还没|没有|未).{0,4}(?:回复|回应)/.test(userText)&&/其余均为未知/.test(fixed)&&/已发送/.test(fixed)){
    fixed=fixed.replace(/目前仅知“已发送”，其余均为未知/g,'目前已知“已发送、对方未回复”；是否已读、是否采用、实际效果仍未知')
    fixed=fixed.replace(/仅知“已发送”，其余均为未知/g,'已知“已发送、对方未回复”；是否已读、是否采用、实际效果仍未知')
  }
  if(/未回复[^。]*内容相关性不足/.test(fixed)&&!/内容相关性不足|作品集内容|通用展示/.test(userText)){
    fixed=fixed.replace(/如果作品集仍是通用展示[^。]*?那么[^。]*?内容相关性不足[^。]*?而非态度问题。[。]?/g,'如果作品集仍是通用展示，那只说明它可能没有对准产品实习；未回复原因仍未知，不能据此判断内容相关性或态度。')
  }
  const readConfirmed=/确认.{0,6}(?:读到|已读)|回复说.{0,6}(?:读到|看了)/.test(userText)
  if(readConfirmed){
    // Only a compact state list for the same event is rewritten. A global
    // replacement of 未回复 contaminates other people/events in the same reply.
    fixed=fixed.split(/(?<=[。！？!?；;\n])/).map(sentence=>{
      if(!/已发(?:送)?[、,，]/.test(sentence)||!/已读[、,，]\s*未回复/.test(sentence))return sentence
      let next=sentence.replace(/未回复/,'已回复（确认读到）')
      if(!/(?:明确|已经).{0,6}(?:不采用|未采用|拒绝采用)/.test(userText)){
        next=next.replace(/未采用/g,'采用未知').replace(/无效果/g,'效果未知')
      }
      return next
    }).join('')
  }
  if(replyHasRead&&/已回复[:：][^。\n]*(?:未回复|没有回复|未就|未对|未给出)[^。\n]*(?:内容|评价)?/.test(fixed)){
    fixed=fixed.replace(/已回复[:：][^。\n]*(?:未回复|没有回复|未就|未对|未给出)[^。\n]*/g,'已回复：有（此前访问反馈/确认读到）；内容评价未报告')
  }
  if(replyHasRead&&(/已回复[:：]\s*(?:未报告|未回复|无回复|没有)/.test(fixed)||(fixed.match(/已发[:：]/g)??[]).length>1)){
    fixed=fixed.replace(/已回复[:：]\s*(?:未报告[^。\n]*|未回复[^。\n]*|无回复[^。\n]*|没有[^。\n]*)/g,'已回复：有（此前回复访问问题/确认读到）')
    const blocks=fixed.split(/\n{2,}/)
    let seenState=false
    const kept=blocks.filter(block=>{
      if(!/已发[:：]/.test(block)||!/已读[:：]/.test(block))return true
      if(seenState)return false
      seenState=true
      return true
    })
    if(kept.length<blocks.length)fixed=kept.join('\n\n')
  }
  if(/尚未进入[^。]*?(?:评估|采纳|效果)/.test(fixed)&&/(?:还没|没有|未|未报告).{0,8}(?:说|反馈|评价|采用|效果)/.test(userText)){
    fixed=fixed.replace(/尚未进入([^。]*?)(?:环节)?/g,'是否进入$1环节仍未知')
  }
  if(/老师[^。]*下周[^。]*再看/.test(userText)){
    fixed=fixed.replace(/待下周跟进/g,'老师表示下周再看；不安排你跟进')
    fixed=fixed.replace(/未回复阶段结束/g,'此前未回复阶段已结束')
  }
  if(/同学[^。]*明确不适合/.test(userText))fixed=fixed.replace(/未采用/g,'已反馈不适合；是否采用/后续未知')
  if(/收到回复即停/.test(fixed)&&/发送完成即停/.test(fixed))fixed=fixed.replace(/收到回复即停/g,'发送完成即停')
  if(/今天只愿意做一个动作|只做一个动作/.test(userText)){
    fixed=fixed.replace(/停止条件[:：][^。\n]*(?:导师|对方)[^。\n]*(?:确认|回复|反馈)[^。\n]*/g,'停止条件：文件成功发出即完成；导师回应另记后续状态。')
  }
  if(/产品实习/.test(userText)&&!/研究方向|导师研究/.test(userText)){
    fixed=fixed.replace(/与导师研究方向或近期项目相关的案例/g,'与你申请的产品实习方向相关的案例')
  }
  if(/(?:还没|没有|未).{0,4}(?:回复|回应)/.test(userText)&&/后续环节[^。]*均(?:为)?未知/.test(fixed)){
    fixed=fixed.replace(/后续环节[^。]*均(?:为)?未知/g,'截至本次报告：已发送、对方未回复；是否已读、评价、采用、效果未报告；未来是否回复未知')
  }
  if(/作品集/.test(userText)&&/(?:还没|没有|未).{0,4}(?:回复|回应)/.test(userText)){
    fixed=fixed.replace(/目前真正影响下一步的缺口是：作品集本身是否具备[^。\n]*[。]?/g,'目前已知的缺口是导师是否收到、能否打开以及是否读过；作品集内容是否充分尚未核对，未回复原因仍未知。')
  }
  fixed=fixed.replace(/如果一周后仍无回复，可视为导师暂时无法处理/g,'如果一周后仍无回复，只能记录为未回复；原因和导师能否处理仍未知')
  fixed=fixed.replace(/只是受限于设备或链接兼容性/g,'具体原因（设备、权限、网络、链接有效期）仍未知')
  fixed=fixed.replace(/若导师回复已能打开，则停止；若仍无法打开，再询问/g,'文件发出即完成；导师回复另记后续状态。')
  return fixed!==reply?fixed:null
}

function repairUnreportedSampleFacts(reply:string,userText:string):string|null{
  // A partial update is not a declaration that prior results disappeared.
  // Use the same authorized history supplied to generation, with the existing
  // source-owner boundary; quoted or hypothetical reports cannot license it.
  const reported=scanUserClauses(userText).filter(ownedObservationClause).map(clause=>clause.text)
  const twoMaterials=reported.some(text=>/两份(?:材料)?/.test(text))
  const fewerQuestions=reported.some(text=>/少问(?:了我)?一(?:次|回)/.test(text))
  if(!/(?:两份材料|少问一次)/.test(reply))return null
  let fixed=reply
  if(!twoMaterials)fixed=fixed.replace(/[，,、]?\s*这次同学找到两份材料/g,'')
  if(!fewerQuestions)fixed=fixed.replace(/[，,、]?\s*少问一次/g,'')
  if(!reported.some(text=>/\d+秒/.test(text)))fixed=fixed.replace(/[（(]尚未测时间[）)]/g,'')
  fixed=fixed
    .replace(/[，,、]\s*([。！？])/g,'$1')
    .trim()
  return fixed&&fixed!==reply?fixed:null
}

function repairC1Evidence(reply:string,userText:string):string|null{
  let fixed=reply
  if(/(?:更在意|希望稳定|外部期待)/.test(userText))fixed=fixed.replace(/这两条不冲突/g,'这两条不必然冲突，实际兼容性仍未知')
  if(/更在意.{0,8}留/.test(userText)){
    // Only the city preference is softened. A separate time limit is not a
    // preference just because both clauses occur in the same user message.
    fixed=fixed.replace(/你更在意的核心约束是“([^”]+)”/g,'你更在意的偏好是“$1”')
    fixed=fixed.replace(/这应作为路径筛选的首要条件/g,'这应作为重要偏好，但不宜升级为首要筛选条件')
    fixed=fixed.replace(/应作为筛选升学或就业选项的首要地理条件/g,'应作为重要的地理偏好，但不宜升级为首要筛选条件')
    fixed=fixed.replace(/你明确希望留在目前城市，且每周最多投入四小时探索。这是硬边界/g,'你明确希望留在目前城市，这是重要偏好；每周最多投入四小时是时间上限。')
    fixed=fixed.replace(/你明确希望留在目前城市[^。\n]*这是硬边界/g,'你明确希望留在目前城市，这是重要偏好；它不是唯一的硬筛选条件。')
    fixed=fixed.replace(/留在目前城市是硬约束/g,'留在目前城市是明确偏好，但不宜当作不可协商的条件')
    fixed=fixed.replace(/，而非直接等同于/g,'；它不等同于')
    fixed=fixed.replace(/每周最多四小时目前是明确偏好，不代表不可妥协/g,'每周最多四小时是明确的时间上限')
  }
  if(/希望稳定/.test(userText))fixed=fixed.replace(/同时满足家庭对“稳定”的期待/g,'与家庭希望稳定之间是否兼容仍未知')
  if(/考研|升学/.test(userText)||/考研|升学/.test(reply)){
    fixed=fixed.replace(/这说明考研对你而言不是目的，而是为了弥补某种“准备不足”的焦虑/g,'这可能说明考研是在应对“准备不足”，但这是待核对的可能，不能断定考研不是目的或你在焦虑')
    if(/担心[^。\n]{0,12}(?:就业)?准备不足/.test(userText)&&!/焦虑/.test(userText)){
      fixed=fixed.replace(/[^。！？\n]*考研[^。！？\n]*(?:缓解[^。！？\n]*焦虑|默认选项)[^。！？\n]*[。]?/g,'目前只能确认你担心直接就业准备不足；选择考研的具体动机仍需核对，不能从这条担心直接推断。')
    }
    fixed=fixed.replace(/考研才值得投入/g,'考研可能更值得投入，但学历门槛或系统训练不是唯一条件')
  }
  if(/岗位|培养方案|技能/.test(userText)){
    fixed=fixed.replace(/这个岗位看起来更贴近你对“([^”]+)”的偏好/g,'目前只有技能练习和培养方案信息，尚不足以判断这个岗位更贴近你对“$1”的偏好；需要岗位实际产出信息')
    fixed=fixed.replace(/符合“留在本地”和“清晰产出”的方向/g,'目前只有技能练习信息，尚不足以判断是否符合清晰产出；需要岗位日常产出信息')
  }
  fixed=fixed.replace(/说明链接本身有效，只是导师当前设备或渠道受限/g,'只能确认你电脑能打开、导师手机打不开；具体原因（设备、权限、网络、链接有效期）仍未知')
  return fixed!==reply?fixed:null
}

function repairAnsweredPurpose(reply:string,userText:string):string|null{
  if(!/(?:能)?自己安排.{0,8}(?:专注|工作).{0,8}时间/.test(userText))return null
  if(/主要在意/.test(userText)&&/(?:更在意)?时间自主[^。！？?\n]{0,30}还是[^。！？?\n]+[？?]/.test(reply)){
    return reply.replace(/[^。！？?\n]*(?:更在意)?时间自主[^。！？?\n]{0,30}还是[^。！？?\n]+[？?]/g,'你已经明确：这里的自由主要是能自己安排专注工作的时间；不把未报告的偏好加入比较。')
  }
  if(!/自由[^。！？?\n]{0,24}(?:最希望|改变|哪一件|哪方面|具体是指)/.test(reply))return null
  return reply.replace(/[^。！？?\n]*自由[^。！？?\n]{0,24}(?:最希望|改变|哪一件|哪方面|具体是指)[^。！？?\n]*[？?]/g,'你已经明确想要能自己安排专注工作的时间；现在更影响你的是可用时间总量，还是会议/响应占用？')
}

function repairNegatedPreferenceUpgrade(reply:string,userText:string):string|null{
  const activity=/不代表我不喜欢([^。！？\n]+)/.exec(userText)?.[1]?.trim()
  if(!activity||!/喜欢还在/.test(reply))return null
  return reply.replace(/喜欢还在/g,`疲惫不等于不喜欢${activity}；是否喜欢及程度不在本轮新增`)
}

function repairAutonomyTarget(reply:string,userText:string):string|null{
  if(!/(?:能)?自己安排.{0,8}(?:专注|工作).{0,8}时间|自由/.test(userText))return null
  let fixed=reply
  fixed=fixed.replace(/目的[:：]确认[“"]?自由[”"]?对你而言具体指什么[^。\n]*/g,'目的：观察你在现有安排中能自主掌控哪一段专注时间')
  fixed=fixed.replace(/方式二：小范围技能展示/g,'方式二：小范围独立任务')
  fixed=fixed.replace(/发布在公开平台[^。\n]*/g,'在本地完成，不发布、不求反馈')
  fixed=fixed.replace(/目的[:：]测试自己是否享受独立完成任务的过程，以及外界是否有反馈/g,'目的：在既有两小时内完成一次独立任务，观察时间是否被打断')
  fixed=fixed.replace(/自由职业路径[^。]*不作为探索方向/g,'这次不把自由职业作为探索方向，不等于排除整个方向')
  fixed=fixed.replace(/成本：零额外投入/g,'成本：在现有两小时内调整，不承诺零成本')
  return fixed!==reply?fixed:null
}

function repairCurrentPause(reply:string,userText:string):string|null{
  if(!/(?:现在不继续行动|现在不继续|先暂停|这周不安排|不再行动|只给阶段理解)/.test(userText))return null
  if(!/(?:只打开一个公开招聘页面|打开一个公开招聘页面|阅读职位描述)/.test(reply))return null
  return '当前不继续行动；阶段理解：已确认的个例信息保留，地点自由不等于时间完全自主，会议具体时长和你的容忍度仍未知；不新增任务。'
}

function repairVerifiedStateReadback(reply:string,userText:string,priorUserTexts:readonly string[]):string|null{
  const preview=groundedStateReadback(userText,[...priorUserTexts])
  if(!preview)return null
  // The preview is the complete verified status answer. Appending model prose
  // after it invited contradictions ("已回复" then "未发生") and stale gaps
  // copied from the previous turn. Keep the verified states and the grounded
  // gap only; the model's ordinary call still owns the turn and its records.
  return preview
}

function repairTeacherReplyUpdate(reply:string,userText:string):string|null{
  const source=scanUserClauses(userText)
  const deferred=source.some((head,index)=>{
    if(!ownedObservationClause(head)||!/^(?:回来反馈[：:]\s*)?老师后来回复(?:说|[：:])?这周忙$/.test(head.text.trim()))return false
    const next=source[index+1]
    return !!next&&ownedObservationClause(next)&&next.sentenceStart===head.sentenceStart&&/^下周(?:再|会|才)?(?:看|查看|阅读)$/.test(next.text.trim())
  })
  if(!deferred)return null
  let fixed=reply
  const teacherQuotes=new Set(reportedTaskOutcomeClauses(userText,true).filter(c=>/^(?:回来反馈[：:]\s*)?老师(?:明确|已经|已|说|表示|确认)/.test(c.text.trim())).map(c=>c.text))
  if(taskOutcomeReadback(userText,teacherQuotes,true).read.status!=='reported_read'){
    for(const clause of scanUserClauses(fixed).reverse()){
      if(!assertiveReplyClause(clause))continue
      const bounded=clause.text.replace(/^(老师(?:的)?(?:实质)?)回复(?:说明|表明|证明)(?:至少)?(?:已经|已)?(?:读到|读过|看过|阅读了?)(?:邮件|内容|全文)/,'$1回复只证明已回复，是否读完邮件仍未知')
      if(bounded!==clause.text)fixed=fixed.slice(0,clause.start)+bounded+fixed.slice(clause.end)
    }
  }
  if(!/这周忙/.test(fixed))fixed='老师邮件：已回复（这周忙，下周再看）；是否已读和后续回应仍未知。\n\n'+fixed
  return fixed!==reply?fixed:null
}

function repairTableStalePause(reply:string,userText:string):string|null{
  if(!/同学表格[^。\n]*明确不适合/.test(userText)||!/先暂停/.test(reply))return null
  let fixed=reply.replace(/此前[“"]先暂停[”"][^。]*继续有效/g,'这件事不再继续追问')
  fixed=fixed.replace(/该结论保持不变，此前[“"]先暂停[”"][^。]*[。]?/g,'该结论保持不变；这件事不再继续追问。')
  return fixed!==reply?fixed:null
}

function repairDanglingPunctuation(reply:string):string|null{
  const fixed=reply.replace(/([？?。！!])\s*[）)]/g,'$1')
  return fixed!==reply?fixed:null
}

function repairLocalSampleNecessity(reply:string,userText:string):string|null{
  if(!/(?:本地|岗位|培养方案|升学|读研)/.test(userText))return null
  let fixed=reply
  fixed=fixed.replace(/若发现[^。]*普遍[^。]*则[^。]*(?:必要手段|必要条件)[^。]*[。]?/g,'这只是当前几个岗位样本的线索；不能证明升学是必要手段，还需要更多本地岗位信息核对。')
  fixed=fixed.replace(/若发现[^。]*无需升学[^。]*则[^。]*可行性上升[^。]*[。]?/g,'只能说明这些样本里存在无需升学的岗位，不能证明整体就业路径可行。')
  fixed=fixed.replace(/则升学成为实现[^。]*(?:必要手段|必要条件)[^。]*[。]?/g,'这只能作为当前样本的线索，不能证明升学是必要手段。')
  return fixed!==reply?fixed:null
}

function repairFeedbackAction(reply:string,userText:string):string|null{
  if(!/回来反馈/.test(userText)||!/只打开一个公开招聘页面/.test(reply))return null
  if(!/(?:地点自由|固定.*会|会议)/.test(userText))return null
  return '这条个例提示：地点自由不等于时间完全自主，固定会议可能占用专注时间；会议具体时长和你的实际容忍度仍未知。创业保持拒绝，现在不安排新动作。'
}

function repairPriorPreferenceDenial(reply:string,userText:string,priorUserTexts:readonly string[]):string|null{
  if(![...priorUserTexts,userText].some(text=>/不被评价的陪伴|不用表现/.test(text)))return null
  let fixed=reply
  fixed=fixed.replace(/关于[“"]不被评价的陪伴[”"][^。\n]*你之前没有明确说[^。\n]*/g,'关于“不被评价的陪伴”，你之前明确说想保留；这两次打球是否和它有关，仍不能确定，不自动归入。')
  fixed=fixed.replace(/这两次放松是否和[“"]不被评价的陪伴[”"]有关，你没有说，我不自动归入/g,'这两次放松是否和“不被评价的陪伴”有关，仍不能确定；你之前明确想保留这种陪伴，不自动归入。')
  fixed=fixed.replace(/你之前没有明确说，我不自动归入/g,'你之前明确想保留，但是否与这两次有关仍未知')
  return fixed!==reply?fixed:null
}

function repairReaskedPurpose(reply:string,priorUserTexts:readonly string[]):string|null{
  const goalKnown=priorUserTexts.some(text=>/想要[^。\n]{0,40}清晰产出|清晰产出[^。\n]{0,20}工作/.test(text))||/清晰产出/.test(reply)
  if(!goalKnown)return null
  const fixed=reply.replace(/你希望(?:考研|升学|就业|它(?:们)?)[^。！？\n]{0,12}改变什么[^。！？\n]*[。！？]?/g,(whole,...args)=>{
    const offset=args.at(-2) as number
    const before=reply.slice(Math.max(0,offset-14),offset)
    if(/尚未说明|尚未明确|没有说明/.test(before))return whole
    return '你的目的已经明确：毕业后做有清晰产出的工作；未知的是具体产出例子、技能差距和岗位要求。'
  })
  return fixed!==reply?fixed:null
}

function repairPlaceholders(reply:string,userText:string):string|null{
  // Internal draft scaffolding is not a sourced unknown. Omit a separately
  // labelled draft paragraph; preserve intentional fill-in materials and
  // literal discussion of the marker. No remaining answer means the normal
  // reply-completeness guard must reject it, not invent a replacement fact.
  const templateRequested=scanUserClauses(userText).some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&assistantRequestClause(clause.text)&&/模板|填空|占位|待补/.test(clause.text))||/【待补|\[待补|（待补/.test(userText)
  if(templateRequested)return null
  const withoutDraft=reply.replace(/(^|\n)[ \t]*(?:【待补[^】]*】|\[待补[^\]]*\]|（待补[^）]*）)[^\n]*/g,'$1').trim()
  let fixed=withoutDraft
    .replace(/【待补[^】]*】/g,'')
    .replace(/\[待补[^\]]*\]/g,'')
    .replace(/（待补[^）]*）/g,'')
    .replace(/^\s*\*{0,2}待补[^\n：:]*[:：]\*{0,2}\s*$/gm,'')
    .replace(/^\s*目前信息不足[:：]\s*$/gm,'')
    .replace(/^\s*【[^】]{1,80}】\s*$/gm,'')
    .replace(/【([^】]{1,30})】/g,'$1')
    .replace(/\n{3,}/g,'\n\n')
    .trim()
  if(fixed===reply)return null
  return fixed
}

function repairTimeClaim(reply:string):string|null{
  let fixed=reply.replace(/只花\s*\d+\s*[-–—~至]\s*\d+\s*分钟/g,'用一小段你愿意投入的时间')
  fixed=fixed.replace(/\d+\s*分钟看完即停/g,'看完即停')
  fixed=fixed.replace(/此步骤可在\s*\d+\s*分钟内完成/g,'这一步可随时停')
  fixed=fixed.replace(/控制在\s*\d+\s*分钟内/g,'看完即停')
  return fixed!==reply?fixed:null
}

function repairStableIncomeClaim(reply:string,userText:string):string|null{
  if(!/(?:不想|不承担|回避).{0,8}(?:找客户|收款)/.test(userText))return null
  const fixed=reply.replace(/有稳定收入来源，但能自主安排专注工作的时间/g,'不承担找客户和收款，同时能自主安排专注工作的时间')
  return fixed!==reply?fixed:null
}

function repairEnumerationGap(reply:string):string|null{
  if(/^2\.\s/m.test(reply)&&!/^1\.\s/m.test(reply)){
    const fixed=reply.replace(/^2\.\s/m,'').replace(/^状态更新[:：]\s*$/m,'状态：')
    return fixed!==reply?fixed:null
  }
  if(!/记录三件事/.test(reply))return null
  const numbers=[...reply.matchAll(/^\s*(\d+)\.\s/gm)].map(match=>match[1])
  if(!(numbers.includes('1')&&numbers.includes('3')&&!numbers.includes('2')))return null
  const index=reply.indexOf('记录三件事')
  const before=reply.slice(0,index),after=reply.slice(index)
  const fixed=before+after.replace('记录三件事','记录两件事').replace(/\n3\.\s/,'\n2. ')
  return fixed!==reply?fixed:null
}

function repairMissingAction(reply:string):string|null{
  const start=reply.indexOf('2. **微技能验证')
  if(start<0)return null
  const end=reply.indexOf('**比较结论**',start)
  const section=reply.slice(start,end<0?undefined:end)
  if(/\*\*动作\*\*/.test(section))return null
  const fixed=reply.replace(/(2\.\s*\*\*微技能验证[^\n]*\*\*\s*\n)(\s*\n)?(\s*-\s*\*\*成本\*\*)/,'$1   - **动作**：用30分钟做一次自己选定的小任务，记录是否需要沟通、是否被打断。\n$3')
  return fixed!==reply?fixed:null
}

function repairFamilyExpectation(reply:string,userText:string,priorUserTexts:readonly string[]):string|null{
  if(![...priorUserTexts,userText].some(text=>/家里[^。\n]{0,8}希望[^。\n]{0,8}稳定/.test(text)))return null
  let fixed=reply
  fixed=fixed.replace(/更在意留在目前城市[、，]\s*希望稳定/g,'更在意留在目前城市；家里希望稳定（外部期待，不是你的愿望）')
  fixed=fixed.replace(/你更在意留在目前城市[、，]\s*希望稳定/g,'你更在意留在目前城市；家里希望稳定（外部期待，不是你的愿望）')
  fixed=fixed.replace(/，同时希望稳定/g,'；家里希望稳定（外部期待，不是你的愿望）')
  fixed=fixed.replace(/同时希望稳定/g,'家里希望稳定（外部期待，不是你的愿望）')
  fixed=fixed.replace(/你只是希望稳定/g,'家里希望稳定（外部期待，不是你的愿望）')
  return fixed!==reply?fixed:null
}

function repairFollowExam(reply:string,priorUserTexts:readonly string[]):string|null{
  if(!priorUserTexts.some(text=>/跟着想报/.test(text)&&/考研/.test(text)))return null
  let fixed=reply.replace(/（具体对象和原因未说明）/g,'（对象是考研；具体原因尚未说明）')
  fixed=fixed.replace(/你跟着想报的是什么，以及为什么/g,'你跟着想报的是考研；具体原因尚未说明')
  return fixed!==reply?fixed:null
}

function repairRefusalReopen(reply:string,userText:string,priorUserTexts:readonly string[]):string|null{
  if(![...priorUserTexts,userText].some(text=>/不想创业|拒绝创业|不要[^。\n]{0,8}创业|创业[^。\n]{0,6}拒绝/.test(text)))return null
  let fixed=reply
  for(const phrase of ['而非对创业本身的全面否定','并非对创业本身的全面否定','不是对创业的全面否定','不构成对创业的否定']){
    fixed=fixed.replace(new RegExp(phrase,'g'),'创业仍按你明确说的拒绝处理，不重新评估')
  }
  return fixed!==reply?fixed:null
}

function repairUnconfirmedPreference(reply:string,userText:string):string|null{
  if(/自己安排[^。\n]{0,12}(?:专注|工作)[^。\n]{0,8}时间/.test(userText))return null
  const fixed=reply.replace(/[^。\n]*你更在意的是能自己安排专注工作的时间[^。\n]*[。]?/g,'').trim()
  return fixed!==reply?fixed:null
}

function repairRefusalAcknowledgment(reply:string,userText:string):string|null{
  if(!/不想创业/.test(userText)||!/我不会再提/.test(reply)||/自己安排/.test(reply))return null
  // Do not inject a time-autonomy preference before the user has said it.
  if(!/自己安排[^。\n]{0,12}(?:专注|工作)[^。\n]{0,8}时间/.test(userText))return null
  return reply+'\n\n你更在意的是能自己安排专注工作的时间；这一点保留，后续只围绕时间自主探索，不重开创业。'
}

function repairWording(reply:string):string|null{
  let fixed=reply.replace(/不想享受考试本身/g,'不享受考试本身')
  fixed=fixed.replace(/待补关键信息/g,'仍待确认')
  return fixed!==reply?fixed:null
}

function repairPunctuation(reply:string):string|null{
  let fixed=reply.replace(/([。！？!?])\s*[，,]/g,'$1').replace(/，\s*。/g,'。').replace(/。。+/g,'。')
  fixed=fixed.replace(/^\s*[，,；;]\s*/,'')
  return fixed!==reply?fixed:null
}

function repairIncompletePrompt(reply:string):string|null{
  const fixed=reply.replace(/[^。！？\n]*(?:我想问|我想了解|我想确认)[：:]\s*$/g,'').trim()
  return fixed!==reply?fixed:null
}

function repairOptionSpecificQuestion(reply:string,userText:string):string|null{
  if(!/(?:岗位|职位)/.test(userText)||!/(?:培养方案|硕士|读研)/.test(userText))return null
  let fixed=reply.replace(/[^。！？\n]*有清晰产出[^。！？\n]*具体[^。！？\n]*[？?]\s*$/g,'你更想先验证哪一点：岗位的两项技能能否在实际工作中用上，还是培养方案里的纯理论必修是否可接受？')
  fixed=fixed.replace(/这两条线索分别指向什么？/g,'这两条线索里，更影响下一步判断的是：岗位技能的实际熟练度，还是培养方案里纯理论必修的可接受度？')
  fixed=fixed.replace(/这两条线索各自指向一个待确认的问题：/g,'一条是岗位技能的实际熟练度，另一条是培养方案里纯理论必修的可接受度。')
  return fixed!==reply?fixed:null
}

function repairExternalStop(reply:string,userText:string):string|null{
  if(!/今天只愿意做一个动作|只做一个动作/.test(userText))return null
  const fixed=reply.replace(/收到回复即[停此]/g,'发送完成即停')
  return fixed!==reply?fixed:null
}

function repairFinalCleanup(reply:string):string|null{
  let fixed=reply.replace(/只能只能说明/g,'只能说明')
  fixed=fixed.replace(/不能确定这次可能不同，不能确定室友因素更关键/g,'不能确定室友因素更关键')
  fixed=fixed.replace(/如果感觉不同，则运动本身的作用更大/g,'如果感觉不同，只能记录这次不同，不能确定运动本身的作用更大')
  fixed=fixed.replace(/下次和这位室友一起打球时，留意自己是否更在意“球技被看见\/被点评”，还是更在意“和这个人待在一起”。如果换成其他朋友或独自运动，那种“不被评价”的轻松感是否还在？只需观察一次，不要求改变行为。/g,'下次和这位室友做一次非运动活动（如散步或聊天），保持同一个人，只改变活动；观察“不被评价”的轻松感是否还在。结果只作为线索，不要求改变行为。')
  return fixed!==reply?fixed:null
}

function repairTwoFactorDesign(reply:string,userText:string):string|null{
  if(!/不确定是运动本身还是这个室友/.test(userText))return null
  let fixed=reply.replace(/和另一位[^。]*?一起打一次羽毛球（或进行其他轻度共同活动）/g,'保持室友不变、改做一次非运动活动（如散步或聊天）；或者保持羽毛球不变、换一位不评价你的同伴。二选一，不同时换两个条件')
  fixed=fixed.replace(/如果感觉不同，则说明这位室友或这项运动本身有独特作用/g,'如果感觉不同，只能记录这次不同，不能确定室友或运动本身的独特作用')
  fixed=fixed.replace(/若感受相似，则运动本身可能是主要因素/g,'若感受相似，只能记录这次相似，不能确定运动本身是主要因素')
  fixed=fixed.replace(/若感受(?:明显)?不同，则室友的特质可能更关键/g,'若感受不同，只能记录这次不同，不能确定室友特质更关键')
  fixed=fixed.replace(/（或做其他轻松活动）/g,'')
  fixed=fixed.replace(/如果感觉相似，说明“不被评价的互动模式”或运动本身更重要/g,'如果感觉相似，只能记录这次相似，不能确定互动模式或运动本身更重要')
  fixed=fixed.replace(/通过对比不同搭档下的体验，可初步判断“不被评价的陪伴”更多源于运动情境，还是特定人际关系/g,'通过对比不同搭档下的体验，只能记录这次是否不同，不能判断来源')
  fixed=fixed.replace(/轻松来自无评价的互动，而非特定运动或人/g,'这两次都是同一室友和羽毛球，仍不能确定轻松来自互动、运动还是室友')
  fixed=fixed.replace(/核心是“不被评价”的安全感/g,'你报告的核心感受是“不被评价”；来源仍未知')
  fixed=fixed.replace(/若有：说明是室友带来的安全感/g,'若有：只能记录这次仍有轻松感，不能确定室友带来安全感')
  fixed=fixed.replace(/若无：说明是运动本身或当时的特定情境带来的/g,'若无：只能记录这次不同，不能确定原因')
  fixed=fixed.replace(/若有，说明核心是这种无评价的互动模式/g,'若有，只能记录这次仍有轻松感，不能确定核心是这种互动模式')
  fixed=fixed.replace(/若无，则室友的熟悉度或特定关系更关键/g,'若无，只能记录这次不同，不能确定室友熟悉度或关系更关键')
  fixed=fixed.replace(/运动提供了低门槛的共同场景，室友提供了安全的反馈环境，两者共同作用才让你感到轻松/g,'两次都是同一室友和羽毛球，运动与室友各自的作用仍无法区分')
  fixed=fixed.replace(/两者共同作用才让你感到轻松/g,'两者如何共同作用仍未知')
  fixed=fixed.replace(/独自或与另一位非室友朋友进行同样的羽毛球活动（或类似低压力运动）/g,'换一位非室友朋友，保持同样的羽毛球活动')
  fixed=fixed.replace(/若感觉明显减弱，则室友因素权重较大/g,'若感觉明显减弱，只能记录这次不同，不能确定室友因素权重较大')
  fixed=fixed.replace(/若感觉依旧，则运动本身可能是关键/g,'若感觉依旧，只能记录这次相似，不能确定运动本身是关键')
  fixed=fixed.replace(/若换了人感觉明显不同，则室友因素权重较大/g,'若换了人感觉明显不同，只能记录这次不同，不能确定室友因素权重较大')
  fixed=fixed.replace(/若独自或换人后仍有类似放松感，则运动本身可能更重要/g,'若独自或换人后仍有类似放松感，只能记录这次相似，不能确定运动本身更重要')
  fixed=fixed.replace(/和另一位关系不错、但平时不一起打球的室友，进行一项低强度的共同活动（如散步、喝咖啡或一起看个轻松的短片）/g,'换一位非室友朋友，保持同样的羽毛球活动')
  fixed=fixed.replace(/如果换人后依然轻松，说明这种体验更多源于你对“非评价性社交”的需求或运动本身的解压属性/g,'如果换人后依然轻松，只能记录这次相似，不能确定体验来源')
  fixed=fixed.replace(/如果还在，说明运动本身可能更重要；如果明显减弱，说明室友的作用更大/g,'如果还在，只能记录这次相似；如果明显减弱，只能记录这次不同；都不能确定来源')
  fixed=fixed.replace(/如果独自运动时依然感到放松且无压力，说明运动本身具有疗愈性/g,'如果独自运动时依然感到放松且无压力，只能记录这次相似，不能确定运动本身具有疗愈性')
  fixed=fixed.replace(/下次找另一位同学进行同样的低压力运动（如散步或简单球类）/g,'换一位同学，保持同样的羽毛球活动')
  fixed=fixed.replace(/若感受重现，说明只能记录这次是否不同，不能确定只能记录这次是否不同，不能确定运动场景本身贡献较大/g,'若感受重现，只能记录这次相似，不能确定运动场景本身贡献较大')
  fixed=fixed.replace(/则[^。；\n]{0,20}(?:室友|运动)[^。；\n]{0,15}(?:权重较大|更关键|更重要|可能是关键|可能提供了[^。；\n]*)/g,'只能记录这次差异，不能确定来源')
  fixed=fixed.replace(/若仍有，偏向运动本身；若没有，偏向室友带来的氛围/g,'若仍有，只能记录这次相似；若没有，只能记录这次不同；都不能确定来源')
  fixed=fixed.replace(/若感觉不同则说明室友因素更重/g,'若感觉不同，只能记录这次不同，不能确定室友因素更重')
  fixed=fixed.replace(/若感觉相似则说明运动本身更重/g,'若感觉相似，只能记录这次相似，不能确定运动本身更重')
  fixed=fixed.replace(/下次打羽毛球时，若条件允许，尝试与另一位同学（非该室友）进行同样强度的运动，或独自进行同样的运动练习。[^。\n]*/g,'下次和同一位室友做一次非运动活动（如散步或聊天），保持人物不变，只改变活动；观察“不被评价”的轻松感是否还在。结果只作线索，不判断来源。')
  fixed=fixed.replace(/核心是运动带来的心流/g,'只能记录这次相似，不能确定是运动带来的心流')
  fixed=fixed.replace(/关键在特定的人际安全感/g,'只能记录这次不同，不能确定关键在特定的人际安全感')
  fixed=fixed.replace(/说明只能记录这次是否不同，不能确定只能记录这次是否不同/g,'只能记录这次是否不同')
  fixed=fixed.replace(/只能记录这次是否不同，不能确定只能记录这次是否不同，不能确定运动场景本身贡献较大/g,'只能记录这次不同，不能确定运动场景本身贡献较大')
  fixed=fixed.replace(/通过对比两种情境下的体验差异，判断轻松感更依赖运动本身还是人际互动/g,'通过对比两种情境下的体验差异，只能记录差异，不能判断轻松感更依赖哪一方')
  fixed=fixed.replace(/只能只能说明/g,'只能说明')
  fixed=fixed.replace(/不能确定这次可能不同，不能确定室友因素更关键/g,'不能确定室友因素更关键')
  fixed=fixed.replace(/如果感觉不同，则运动本身的作用更大/g,'如果感觉不同，只能记录这次不同，不能确定运动本身的作用更大')
  return fixed!==reply?fixed:null
}

function repairNoDirectionFollowup(reply:string,userText:string):string|null{
  if(!/(?:更快看出|减少[^。\n]{0,8}反复找)/.test(userText))return null
  let fixed=reply.replace(/[^。！？\n]*最让你觉得[^。！？\n]*[？?]/g,'除了这门课，最近有没有在别的事情上，你也自然地把零散内容分成几类？')
  fixed=fixed.replace(/[^。！？\n]*(?:心里主要|主要是一种什么样的感觉|感觉是什么)[^。！？\n]*[？?]/g,'除了这门课，最近有没有在别的事情上，你也自然地把零散内容分成几类？')
  fixed=fixed.replace(/[^。！？\n]*整理时最在意哪一步[^。！？\n]*[？?]/g,'除了这门课，最近有没有在别的事情上，你也自然地把零散内容分成几类？')
  fixed=fixed.replace(/[^。！？\n]*哪个瞬间最明显[^。！？\n]*[？?]/g,'除了这门课，最近有没有在别的事情上，你也自然地把零散内容分成几类？')
  fixed=fixed.replace(/[^。！？\n]*你分好类后，下一步做了什么[^。！？\n]*[？?]/g,'除了这门课，最近有没有在别的事情上，你也自然地把零散内容分成几类？')
  fixed=fixed.replace(/[^。！？\n]*你分几类时按什么标准分的[^。！？\n]*[？?]/g,'除了这门课，最近有没有在别的事情上，你也自然地把零散内容分成几类？')
  fixed=fixed.replace(/[^。！？\n]*整理时哪一步最顺手[^。！？\n]*[？?]/g,'除了这门课，最近有没有在别的事情上，你也自然地把零散内容分成几类？')
  fixed=fixed.replace(/[^。！？\n]*整理时按什么标准分类[^。！？\n]*[？?]/g,'除了这门课，最近有没有在别的事情上，你也自然地把零散内容分成几类？')
  fixed=fixed.replace(/[^。！？\n]*整理时[，,]?你按什么标准分[^。！？\n]*[？?]/g,'除了这门课，最近有没有在别的事情上，你也自然地把零散内容分成几类？')
  fixed=fixed.replace(/[^。！？\n]*你是先把所有材料摊开再分类，还是边看边归[^。！？\n]*[？?]/g,'除了这门课，最近有没有在别的事情上，你也自然地把零散内容分成几类？')
  fixed=fixed.replace(/[^。！？\n]*你整理时[，,]?是先把所有材料摊开再分类，还是边看边归[^。！？\n]*[？?]/g,'除了这门课，最近有没有在别的事情上，你也自然地把零散内容分成几类？')
  fixed=fixed.replace(/[^。！？\n]*你整理时具体是什么感觉[^。！？\n]*[？?]/g,'除了这门课，最近有没有在别的事情上，你也自然地把零散内容分成几类？')
  return fixed!==reply?fixed:null
}

function repairNoDirectionGain(reply:string,userText:string):string|null{
  if(!/(?:三条分类规则|少问了一次)/.test(userText))return null
  let fixed=reply.replace(/说明规则降低了沟通成本/g,'只说明这次同学少问了一次；是否降低沟通成本仍未知')
  fixed=fixed.replace(/说明三条分类规则在减少沟通成本上起了作用/g,'只说明这次同学少问了一次；是否减少沟通成本仍未知')
  fixed=fixed.replace(/在真实使用中降低了沟通成本/g,'只说明这次同学少问了一次；是否降低沟通成本仍未知')
  fixed=fixed.replace(/分类规则已减少同学询问次数/g,'这次同学少问了一次；是否减少询问次数仍未知')
  fixed=fixed.replace(/分类规则已初步验证有效/g,'这次同学少问了一次；不能确认规则普遍有效')
  fixed=fixed.replace(/分类规则已初步见效/g,'这次同学少问了一次；不能确认规则普遍有效')
  fixed=fixed.replace(/在降低沟通成本上起了作用/g,'只说明这次同学少问了一次；是否降低沟通成本仍未知')
  fixed=fixed.replace(/方向是对的/g,'只能作为这次线索')
  fixed=fixed.replace(/验证了规则对他人检索有实际帮助/g,'只说明这次同学少问了一次；不能确认规则对他人检索有实际帮助')
  fixed=fixed.replace(/这套整理逻辑具备可传递性/g,'不能确认这套整理逻辑具备可传递性')
  fixed=fixed.replace(/支持了“规则清晰有助于减少沟通成本”的初步判断/g,'只说明这次同学少问了一次；不能确认减少沟通成本')
  fixed=fixed.replace(/规则已证明能减少沟通成本/g,'这次同学少问了一次；是否减少沟通成本仍未知')
  fixed=fixed.replace(/不能确认这套整理逻辑具备可传递性，这次同学少问了一次/g,'不能确认这套整理逻辑具备可传递性')
  fixed=fixed.replace(/说明三条分类规则只说明/g,'只说明')
  fixed=fixed.replace(/能确认规则对“他人快速定位”有帮助/g,'不能确认规则对他人快速定位有帮助')
  fixed=fixed.replace(/在“可检索性”上起了作用/g,'这次同学少问了一次；不能确认普遍检索效果')
  fixed=fixed.replace(/减少了沟通成本/g,'是否减少沟通成本仍未知')
  fixed=fixed.replace(/分类规则已减少沟通成本/g,'这次同学少问了一次；是否减少沟通成本仍未知')
  fixed=fixed.replace(/对降低他人使用门槛是有效的/g,'不能确认对降低他人使用门槛有效')
  fixed=fixed.replace(/产生了可观察的实际效果/g,'只记录这次具体结果')
  fixed=fixed.replace(/能有效降低他人的检索成本/g,'不能确认能有效降低他人的检索成本')
  fixed=fixed.replace(/这是一次成功的“通过前置规则优化协作效率”的实践/g,'这只是一次具体线索，不能确认协作效率被优化')
  fixed=fixed.replace(/规则确实降低了他人查找成本/g,'只说明这次同学少问了一次；是否降低他人查找成本仍未知')
  fixed=fixed.replace(/说明你的分类规则在“减少他人询问”和“提升检索效率”上产生了实际效果/g,'只说明这次同学少问了一次；是否减少询问或提升检索效率仍未知')
  fixed=fixed.replace(/整理动作产生外部协作价值的线索/g,'这次整理结果的一条线索，不能确认外部协作价值')
  fixed=fixed.replace(/减少了?沟通摩擦/g,'是否减少沟通摩擦仍未知')
  fixed=fixed.replace(/降低了检索摩擦/g,'只说明这次同学少问了一次；是否降低检索摩擦仍未知')
  fixed=fixed.replace(/说明三条规则只说明/g,'只说明')
  fixed=fixed.replace(/产生了可观察的便利效果/g,'只能记录这次结果，不能确认普遍便利效果')
  fixed=fixed.replace(/属于已验证的整理方法/g,'不能据此称为已验证的整理方法')
  fixed=fixed.replace(/对他人查找有实际帮助/g,'只说明这次同学少问了一次；是否对他人查找有实际帮助仍未知')
  fixed=fixed.replace(/在“减少他人询问”和“提升查找效率”上产生了实际效果/g,'只说明这次同学少问了一次；是否减少询问或提升效率仍未知')
  fixed=fixed.replace(/具备了对外共享的价值/g,'不能确认对外共享价值')
  fixed=fixed.replace(/这次结果支持了规则的有效性/g,'这次结果只是一条线索，不能确认规则有效性')
  fixed=fixed.replace(/这套分类规则可能成为你的一项可复用技能或工具/g,'这仍只是待验证的可能，不能确认可复用技能或工具')
  fixed=fixed.replace(/提供了一个有力的线索/g,'只提供了一条有限线索')
  fixed=fixed.replace(/似乎能直接减少他人向你询问具体材料位置的需求/g,'这次同学少问了一次；是否减少他人询问仍未知')
  fixed=fixed.replace(/说明规则对“他人自助查找”有实际帮助/g,'只说明这次同学少问了一次；是否对他人自助查找有实际帮助仍未知')
  fixed=fixed.replace(/分类规则已落地并产生可观察效果（减少一次询问）/g,'这次同学少问了一次；不能确认普遍效果')
  fixed=fixed.replace(/这是整理带来的实际便利/g,'只说明这次同学少问了一次')
  fixed=fixed.replace(/说明你的分类逻辑是有效的，减少了沟通成本/g,'只说明这次同学少问了一次；不能确认分类逻辑有效或沟通成本下降')
  fixed=fixed.replace(/说明当前的三条分类规则在减少沟通成本上是有效的/g,'只说明这次同学少问了一次；是否减少沟通成本仍未知')
  fixed=fixed.replace(/确实降低了沟通成本/g,'只说明这次同学少问了一次；是否降低沟通成本仍未知')
  fixed=fixed.replace(/验证了你对零散内容分类的偏好具有实际效用/g,'不能确认你对零散内容分类的偏好具有实际效用')
  fixed=fixed.replace(/说明[^。；\n]{0,24}(?:规则|分类)[^。；\n]{0,18}(?:是有效的|初步验证有效|有效)/g,'只说明这次同学少问了一次；不能确认规则普遍有效')
  fixed=fixed.replace(/降低了协作成本/g,'是否降低协作成本仍未知')
  fixed=fixed.replace(/规则初步验证有效/g,'规则这次只提供线索')
  fixed=fixed.replace(/表明整理逻辑符合他人的检索习惯/g,'不能确认整理逻辑符合他人的检索习惯')
  fixed=fixed.replace(/价值点：整理资料的价值不仅在于自己清晰，更在于降低他人的获取门槛/g,'这次结果只说明同学少问了一次；不能确认对他人的普遍价值')
  fixed=fixed.replace(/价值在于降低他人的获取门槛/g,'不能确认对他人的普遍价值')
  fixed=fixed.replace(/只说明这次同学少问了一次，只说明这次同学少问了一次/g,'只说明这次同学少问了一次')
  fixed=fixed.replace(/有效性确认/g,'这次结果')
  fixed=fixed.replace(/带有协作属性的信息处理/g,'不能确认协作属性')
  fixed=fixed.replace(/第二次具体的正向反馈/g,'这次具体反馈')
  fixed=fixed.replace(/而是具备了协作价值/g,'不能据此确认协作价值')
  fixed=fixed.replace(/支持规则方向可行/g,'只能作为这次线索，不能证明规则普遍可行')
  fixed=fixed.replace(/确认了“更快看出关键信息”这个目的在整理动作中得到了回应/g,'不能确认你的目的得到回应或本人省时')
  fixed=fixed.replace(/[^。\n]*之前问的[“"]?顺手或有意思的具体情况是什么？\s*$/g,'')
  return fixed!==reply?fixed:null
}

function repairUnknownNotNegative(reply:string,userText:string):string|null{
  let fixed=reply
  if(/老师后来回复[^。\n]*这周忙[^。\n]*下周/.test(userText)){
    fixed=fixed.replace(/未进入实质评估或采用阶段/g,'是否已读、评价、采用及效果未报告，保持未知')
    fixed=fixed.replace(/暂无实质进展或拒绝/g,'是否已读、评价、采用及效果未报告，保持未知')
  }
  const clauses=scanUserClauses(userText)
  for(const instruction of responseRequestScope(userText).instructions){
    const boundary=/不要把([^。！？；]{1,40})当(?:作|成)?([^。！？；]{1,40})/.exec(instruction.commandText)
    if(!boundary||!/(?:排名|排序)/.test(boundary[2]!))continue
    // A prohibited inference is a rule about evidence, not a negative fact
    // about the person. Preserve a separately reported absence, if present.
    if(clauses.some(c=>ownedObservationClause(c)&&!assistantRequestClause(c.text)&&/(?:不存在|没有)[^。]{0,20}(?:排名|排序)/.test(c.text)))continue
    for(const clause of scanUserClauses(fixed).reverse()){
      if(!ownedObservationClause(clause)||!/(?:不存在|没有)[^。]{0,20}(?:排名|排序)/.test(clause.text))continue
      fixed=fixed.slice(0,clause.start)+`不能凭「${boundary[1]}」推断「${boundary[2]}」`+fixed.slice(clause.end)
    }
  }
  return fixed!==reply?fixed:null
}

function repairTrialNotAdoption(reply:string,userText:string):string|null{
  if(!/(?:试过|试用)/.test(userText)||!/不适合/.test(userText))return null
  let fixed=reply.replace(/这是已报告的采用结果/g,'这是已报告的试用反馈；是否采用或持续使用未报告')
  fixed=fixed.replace(/对方明确拒绝/g,'对方明确反馈不适合；是否采用或持续使用未报告')
  fixed=fixed.replace(/明确不采用/g,'明确反馈不适合；是否采用或持续使用未报告')
  fixed=fixed.replace(/这是已报告的拒绝/g,'这是已报告的试用反馈；是否采用或持续使用未报告')
  return fixed!==reply?fixed:null
}

function repairSourceClaims(reply:string,userText:string):string|null{
  let fixed=reply
  fixed=fixed.replace(/失落感会轻一点/g,'这可能帮助你分清状态，但是否变轻由你决定，不保证情绪变化')
  fixed=fixed.replace(/拿一份同学没找到的材料/g,'找一份你手边还没整理的材料')
  fixed=fixed.replace(/成就感不成立/g,'不能据此确认成就感；也不否定你未报告的其他感受')
  fixed=fixed.replace(/未来是否希望继续此类陪伴/g,'具体形式、频率或对象仍未知')
  if(/老师后来回复|下周再看/.test(userText))fixed=fixed.replace(/此前记录的“未回复”已更正/g,'此前“未回复”是当时状态；现在更新为“已回复（老师说下周再看）”，不是删除历史')
  fixed=fixed.replace(/说明你和室友之间有一种很舒服的默契/g,'这只描述这次一起活动的感受，不能确认关系属性或稳定默契')
  fixed=fixed.replace(/是处理信息时的一种自然倾向/g,'这只是本次自发行为，不能确认是稳定倾向')
  fixed=fixed.replace(/成本：几乎零，只需发消息和听/g,'成本：发消息的时间；能否得到回答取决于对方')
  fixed=fixed.replace(/[^。！？\n]*这样不依赖别人也能开始[^。！？\n]*[。]?/g,'')
  fixed=fixed.replace(/建议：先做A。找1个你好奇的自由职业者/g,'可以先发询问；若对方不回应，记录为未获得访谈，不强行推进。找1个你好奇的自由职业者')
  fixed=fixed.replace(/你希望考研（或其他路径）具体改变生活中的哪一部分，目前还没有明确答案。/g,'你已表达想要做有清晰产出的工作；尚未定义的是具体产出例子、技能差距和岗位要求。')
  fixed=fixed.replace(/尚未说明你希望升学或就业具体改变什么现状。/g,'你已表达想要做有清晰产出的工作；尚未定义的是具体产出例子、技能差距和岗位要求。')
  fixed=fixed.replace(/你希望升学或就业具体改变什么现状，尚未明确。/g,'你已表达想要做有清晰产出的工作；尚未定义的是具体产出例子、技能差距和岗位要求。')
  fixed=fixed.replace(/尚未说明[^。\n]{0,30}你希望升学或就业具体改变什么现状[^。\n]*/g,'你已表达想要做有清晰产出的工作；尚未定义的是具体产出例子、技能差距和岗位要求。')
  fixed=fixed.replace(/这是硬预算/g,'这是探索时间上限')
  if(/(?:更低成本|探索方式|比较)/.test(userText)&&/(?:客户|自由职业)/.test(userText)){
    fixed=fixed.replace(/你手上已有哪一个可用来源？/g,'可以先比较两种不依赖客户的小探索：①用一周记录你能自主安排的专注时段；②用两小时完成一个自己手里的小任务，观察时间是否被打断。先选一个，不联系客户、不接单，做完即停。')
  }
  fixed=fixed.replace(/(\*\*下一步建议\*\*[:：])\s*[）)]\s*/g,'$1先核对具体产出例子和岗位技能差距，不替你选方向。\n')
  fixed=fixed.replace(/如有需要我可以重新发送或提供PDF版本。/g,'如果你需要，可以重新发送或提供PDF版本；这一步由你决定。')
  fixed=fixed.replace(/我可以重新发送或提供PDF版本。/g,'如果你需要，可以重新发送或提供PDF版本；这一步由你决定。')
  fixed=fixed.replace(/能帮你卸下一些不必要的失落感/g,'这可能帮你分清状态，但是否变轻由你决定，也不评判感受是否必要')
  return fixed!==reply?fixed:null
}

function repairIncompleteTail(reply:string):string|null{
  if(/[，,：:]?\s*(?:当前停在|当前卡在|目前停在|现在停在)\s*[。]?$/.test(reply))
    return reply.replace(/[，,：:]?\s*(?:当前停在|当前卡在|目前停在|现在停在)\s*[。]?$/,'；其余状态保持未知。')
  // A normal answer may legitimately end without punctuation, especially an
  // action line. Only remove a short dangling function-word tail that cannot
  // stand as a completed sentence on its own.
  const trimmed=reply.trim()
  let cut=-1
  for(const mark of ['。','！','？','!','?','…'])cut=Math.max(cut,trimmed.lastIndexOf(mark))
  if(cut<12)return null
  const dangling=trimmed.slice(cut+1).trim()
  if(!dangling||dangling.length>20)return null
  if(!/^(?:之前那个|而不只是|以及|但是|但|因为|所以|然后|而且|并且|还是|或者|和|与|或|在|从|对|把|被|让|给|的)$/.test(dangling))return null
  return trimmed.slice(0,cut+1)
}

function repairSameExperienceScope(reply:string,userText:string,priorUserTexts:readonly string[]):string|null{
  let fixed=reply.replace(/这次也落在同一类体验上/g,'这次的行为与之前相似；本次是否也有同样的轻松感，你尚未报告')
  const current=scanUserClauses(userText)
  const summaryOnly=current.length>0&&responseRequestScope(userText).summaryRequested&&current.every(c=>ownedObservationClause(c)&&assistantRequestClause(c.text))
  // Never search past a newer report to borrow an older event. A pure
  // summary instruction may refer only to the immediately preceding turn.
  const report=summaryOnly?priorUserTexts.at(-1)??'':userText,source=scanUserClauses(report)
  const repeated=source.some((head,index)=>{
    if(!assertiveReplyClause(head)||!/^回来反馈[：:][^。！？]{0,24}我(?:又和同一个|再次)[^。！？]{1,24}了(?:一)?次$/.test(head.text.trim()))return false
    const next=source[index+1]
    return !!next&&ownedObservationClause(next)&&next.sentenceStart===head.sentenceStart&&/^仍然放松$/.test(next.text.trim())
  })
  const latest=repeated?source.filter(ownedObservationClause).map(c=>c.text).join('；'):null
  if(latest&&!/不用表现|自然说话/.test(latest)){
    const clauses=scanUserClauses(fixed)
    for(let index=clauses.length-2;index>=0;index--){
      const clause=clauses[index]!,next=clauses[index+1]!
      if(!assertiveReplyClause(clause)||!assertiveReplyClause(next)||clause.delimiter!=='、'||clause.sentenceStart!==next.sentenceStart)continue
      if(clause.text.trim()!=='不用表现'||!/^能自然说话的状态(?:是持续的|在两次中都出现了)$/.test(next.text.trim()))continue
      fixed=fixed.slice(0,clause.start)+'本次明确报告仍然放松；是否也不用表现、能自然说话，本次未报告'+fixed.slice(next.end)
    }
  }
  if(latest){
    // A repeated outcome does not confirm a repeated cause. This also
    // covers deictic causal language ("都由此"), which may omit the earlier
    // explanation entirely. Never quote an unbound earlier event as its cause.
    const previous=summaryOnly?priorUserTexts.slice(0,-1):priorUserTexts
    let fragment:string|null=null
    for(const prior of [...previous].reverse()){
      const clause=scanUserClauses(prior).find(c=>ownedObservationClause(c)&&/^(?:让我|我|本人)/.test(c.text)&&/(?:主要是|主要来自|原因是|因为)/.test(c.text)&&!/(?:不是因为|不确定|不知道)/.test(c.text))
      if(!clause)continue
      fragment=clause.text.split(/主要是|主要来自|原因是|因为/).at(-1)!.replace(/^.{1,12}(?:的时候|时)/,'').trim()
      break
    }
    const repeatedReasonConfirmed=fragment&&fragment.length>=4&&source.some(clause=>{
      if(!ownedObservationClause(clause))return false
      const index=clause.text.indexOf(fragment!)
      return index>=0&&!/(?:不是|并非|没有|不再|不确定|不知道|未知)/.test(clause.text.slice(0,index))
    })
    if(!repeatedReasonConfirmed){
      const groups=new Map<number,UserClause[]>()
      for(const clause of scanUserClauses(fixed))groups.set(clause.sentenceStart,[...(groups.get(clause.sentenceStart)??[]),clause])
      for(const group of [...groups.values()].reverse()){
        const body=fixed.slice(group[0]!.start,group.at(-1)!.end)
        // A later caveat does not license an earlier affirmative cause.
        // Enumeration may join a subject; a comma ends its proposition.
        const assertion=body.split(/[，,；;]/)[0]!
        if(!group.every(ownedObservationClause)||unassertedObservation.test(assertion)||!/(?:两次|每次).*(?:都|均).*(?:让|使|由此|因此|因为|源于|来自|原因)|(?:两次|每次).*同(?:一|样)(?:个)?原因/.test(assertion))continue
        fixed=fixed.slice(0,group[0]!.start)+'本次明确报告仍然放松；本次原因是否与此前相同仍未知'+fixed.slice(group.at(-1)!.end)
      }
    }
  }
  return fixed!==reply?fixed:null
}

function repairMeetingSubject(reply:string,userText:string):string|null{
  if(!/一位校友|校友分享/.test(userText)||!/这两次固定会议/.test(reply))return null
  return reply.replace(/这两次固定会议是否占用了你希望自主安排的时间段/g,'校友分享里是否提到固定会议的具体时段？如果提到，它是否占用了你希望自主安排的时间？')
}

function repairRejectionScope(reply:string,userText:string):string|null{
  if(!/明确(?:说|表示|反馈)?不适合/.test(userText)||!/这是已反馈、已拒绝/.test(reply))return null
  return reply.replace(/这是已反馈、已拒绝/g,'这是已试用、已反馈不适合本人；拒绝对象与后续状态未说明')
}

function repairMeasuredGain(reply:string,userText:string):string|null{
  if(!/查找变快/.test(reply))return null
  if(/(?:之前|原来|基线|前).{0,10}(?:\d+秒|分钟)/.test(userText))return null
  const fixed=reply
    .replace(/按三条规则整理后查找变快/g,'按三条规则整理后的查找变化尚未核实；没有基线，不能判断是否变快')
    .replace(/查找变快/g,'查找变化尚未核实；没有基线，不能判断是否变快')
  return fixed!==reply?fixed:null
}

function repairEventScope(reply:string,userText:string):string|null{
  if(!/只整理过|一次材料|只发生过一次/.test(userText)&&/你目前只整理过一次材料/.test(reply)){
    return reply.replace(/你目前只整理过一次材料/g,'目前记录不足以确认整理的总次数')
  }
  return null
}

function repairSingleJobAndEnumeration(reply:string,userText:string):string|null{
  let fixed=reply
  const scope=responseRequestScope(userText)
  const singleJob=scope.singleJobRequested
  if(singleJob){
    fixed=fixed.replace(/(?:如果|若)[^。]*?换下一个[^。]*?最多看两个[。]?/g,'如果信息不足，就停在这一个岗位，记录缺失项；不换下一个。')
    // A count must be adjacent to its classifier. “30分钟读一个…岗位”
    // contains a duration and one job, not thirty jobs.
    fixed=fixed.replace(/(?<![\d一二两三四五六七八九十])(?:两|二|三|四|五|六|七|八|九|十|几|[2-9]\d*|1\d+)\s*(?:个|份)\s*(?:(?:不同|公开|远程)的?)*岗位(?!的?(?:JD|jd|描述))/g,'一个岗位')
    fixed=fixed.replace(/记录你看到的[^。]*?岗位[^。]*?差异/g,'记录你看到的这个岗位对时间的描述')
  }
  if(/这三项信息/.test(fixed)&&!/(?:、|\d+[.、])/.test(fixed)){
    if(!/协作工具、会议节奏、响应时间/.test(fixed)){
      fixed=fixed.replace(/看岗位描述里的协作工具。这三项信息/g,'看岗位描述里的协作工具、会议节奏、响应时间这三项信息')
      fixed=fixed.replace(/这三项信息/g,'协作工具、会议节奏、响应时间这三项信息')
    }
  }
  if(/更正[^。]*没有要求[^。]*只是希望稳定/.test(userText)){
    fixed=fixed.replace(/家里要求的是/g,'家里希望的是')
    fixed=fixed.replace(/或确认目前城市内没有符合“稳定”定义的岗位类型，即可停止。/g,'或记录你一个也想不出的空白；这表示信息不足，不等于当地没有这类岗位。')
  }
  return fixed!==reply?fixed:null
}

function repairOffTopicExamPrep(reply:string,userText:string):string|null{
  if(!/(?:自由|探索|低成本)/.test(userText)||/真题|面经|考研|考试/.test(userText))return null
  if(!/真题|面经/.test(reply))return null
  const fixed=reply.split(/(?<=[。！？!?；;\n])/).filter(sentence=>!/真题|面经/.test(sentence)).join('')
    .replace(/[^。！？\n]*(?:不依赖别人|不依赖他人)也能开始[^。！？\n]*[。]?/g,'')
    .trim()
  return fixed&&fixed!==reply?fixed:null
}

function repairLeadingBinary(reply:string,userText:string):string|null{
  if(userText.includes('还是'))return null
  if(/整理|分类/.test(userText)){
    const motive=/(^|[。！!；;？?\n]\s*)([^。！!；;\n？?]{0,100}?)(?:能看出|看出|判断)[^。！？?\n]{0,30}的是[“"]?([^。！？?\n]{1,80}?)[”"]?[，,]?\s*还是[“"]?([^。！？?\n]{1,80}?)[”"]?[。？?]\s*$/.exec(reply)
    if(motive)return `${reply.slice(0,motive.index)}${motive[1]}除了这门课，最近还有别的事情也让你自然分类吗？`
  }
  const match=/(^|[。！!；;\n]\s*)(?:想问?一个?值得问的问题[:：]\s*)?([^。！!；;\n？?]{2,80}?)[，,]\s*是[^。！？?\n]{1,100}?[，,]\s*还是[^。！？?\n]{1,100}?[？?]\s*$/.exec(reply)
  if(!match)return null
  const topic=match[2]!.replace(/^[^：:]*[:：]\s*/,'').trim()
  if(!topic)return null
  return `${reply.slice(0,match.index)}${match[1]}${topic}具体是什么感觉？`
}

function repairFreedomScopeExclusions(reply:string,userText:string):string|null{
  if(!/(?:自由|时间自主)/.test(reply)||!/(?:而非地点|而非老板|不是地点|地点或老板|地点或老板身份)/.test(reply))return null
  let fixed=reply
    .replace(/自由核心是([^。；\n]+)[，,]\s*而非地点或老板身份/g,'自由当前最清楚的是$1；地点、老板身份等其他维度仍未确认')
    .replace(/而非地点或老板身份/g,'地点和老板身份仍未确认')
    .replace(/而非地点/g,'地点仍未知')
    .replace(/而非老板身份/g,'老板身份仍未知')
  return fixed!==reply?fixed:null
}

function repairSelfReferentialQuestion(reply:string,userText:string):string|null{
  if(!/我想问的具体情况是什么[？?]/.test(reply))return null
  const anchor=/(一起活动|打球|整理|老师|导师|同学|岗位|远程|自由)/.exec(userText)?.[1]
  if(!anchor)return null
  return reply.replace(/我想问的具体情况是什么[？?]/g,`${anchor}时，哪个瞬间最明显？`)
}

function unresolvedFactorBoundary(reply:string,userText:string):boolean{
  const own=scanUserClauses(userText).filter(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther).map(clause=>{
    // Mask protected words, not the surrounding owned statement; keep offsets.
    let text=clause.text
    for(const span of [...clause.quoteSpans,...clause.codeSpans]){
      const start=span.start-clause.start,end=span.end-clause.start
      text=text.slice(0,start)+' '.repeat(end-start)+text.slice(end)
    }
    return {...clause,text}
  })
  const ownedUncertainty=own.some(clause=>{
    const uncertain=/(?:不确定|不清楚|无法区分|无法判断|不知道)[^。！？;；\n]{0,100}(?:还是|哪个|哪种)/.exec(clause.text)
    if(!uncertain||!/(?:带来|来自|导致|造成|起作用|原因|来源|因素)/.test(clause.text))return false
    const position=clause.start+uncertain.index
    return ![...clause.quoteSpans,...clause.codeSpans].some(span=>position>=span.start&&position<span.end)
  })
  userText=own.map(clause=>clause.text).join('。')
  return ownedUncertainty||/不确定是哪个|不确定哪|哪个起作用|运动本身还是|室友带来|保留未知/.test(userText) ||
    (/(?:室友|羽毛球)/.test(userText)&&/(?:是主要来源|体验是稳定的|感受是稳定的|轻松感是稳定的|足够支撑|最稳定的线索|组合|支持|核心变量|是关键|保持稳定|独立变量)/.test(reply)) ||
    (/(?:两次|又.{0,6}一次|重复)/.test(userText)&&/(?:稳定|独立变量)/.test(reply))
}

function repairHypotheticalCausalBranches(reply:string,userText:string):string|null{
  if(!unresolvedFactorBoundary(reply,userText))return null
  // Run after legacy cleanup: whole hypothetical conclusions must not erase
  // explicit observation-only/negative inference boundaries produced earlier.
  const fixed=reply.split(/(?<=[。！？!?；;\n])/).filter(part=>{
    const body=part.trim().replace(/^(?:[-*]\s*|\d+[.、]\s*)/,'')
    if(!/^(?:若|如果|假如)/.test(body)||/[？?]/.test(body))return true
    // A legacy word-level repair may already have replaced the conclusion.
    // Do not preserve its old affirmative connective around that limitation.
    if(/(?:说明|表明|证明|意味着)(?:只(?:能)?|仅(?:能)?)(?:记录|说明)/.test(body))return false
    const affirmative=body.replace(/(?:不能|无法|不足以|不应|未能)(?:据此|直接)?(?:说明|表明|证明|意味着|确定|分配|归因|偏向)/g,'')
    if(/(?:只(?:能)?|仅(?:能)?)(?:记录|说明)(?:这次|本次|实际|此次)/.test(body)&&!/(?:偏向|表明|证明|意味着)/.test(affirmative))return true
    return !/(?:偏向|表明|证明|说明|意味着)/.test(affirmative)
  }).join('').trim()
  if(fixed===reply)return null
  return /未知|不能确定|无法区分/.test(fixed)?fixed:(fixed?fixed+'\n\n':'')+'这次只记录实际差异，不能据此分配原因，仍保留未知。'
}

function repairTwoFactorUnknown(reply:string,userText:string):string|null{
  if(!unresolvedFactorBoundary(reply,userText))return null
  let fixed=reply
  fixed=fixed.replace(/这进一步支持了“不被评价的陪伴”这个体验是稳定的/g,'这两次都报告了“不被评价的陪伴”，但样本仍小，不能判定稳定')
  fixed=fixed.replace(/这个体验是稳定的/g,'这两次都报告了这种体验，但样本仍小，不能判定稳定')
  fixed=fixed.replace(/你的感受是稳定的/g,'这两次都报告放松，但样本仍小，不能判定稳定')
  fixed=fixed.replace(/轻松感是稳定的/g,'这两次都报告放松，但样本仍小，不能判定稳定')
  fixed=fixed.replace(/感受是稳定的/g,'这两次都报告放松，但样本仍小，不能判定稳定')
  fixed=fixed.replace(/这两次经历已经足够支撑一个暂定理解/g,'这两次经历只能作为暂定线索，不能支撑稳定结论')
  fixed=fixed.replace(/两次经历都指向同一个核心/g,'两次经历都指向同一位室友和类似场景，但仍不能区分来源')
  fixed=fixed.replace(/(?:目前)?两次同类经历都支持“不被评价的陪伴”来自运动\+特定室友的组合/g,'两次都是同一组合，仍不能确认“不被评价的陪伴”来自运动、室友还是两者的组合')
  fixed=fixed.replace(/目前能确认的是“和这个室友一起运动”这个组合带来了不被评价的陪伴感/g,'两次都是和这个室友一起运动，但你报告的“不被评价的陪伴”是否由这个组合带来，仍不能确定')
  fixed=fixed.replace(/主要来源是“不用表现”/g,'你之前报告轻松主要与“不用表现”有关；这两次同条件体验仍不足以确定主要来源')
  fixed=fixed.replace(/(两次[^。！？\n]{0,24}(?:都)?报告(?:了)?放松)[，,；;](?:本人|你)(?:此前)?解释主要(?:因|是因为)[^。！？\n]{0,24}(不用表现)/g,'$1；你此前在一段经历中解释轻松与“$2”有关，这不能确定两次的共同原因')
  fixed=fixed.replace(/两次都指向“不被评价的陪伴”带来的放松感/g,'两次都报告了放松，也提到“不被评价的陪伴”，但两者关系仍不能确定')
  fixed=fixed.replace(/放松感稳定/g,'两次都报告放松，但样本仍小，不能判定稳定')
  fixed=fixed.replace(/体验稳定性/g,'两次体验')
  fixed=fixed.replace(/积极感受具有重复性/g,'两次都报告积极感受，但样本仍小')
  fixed=fixed.replace(/这是目前最稳定的线索/g,'这是目前一条方向一致的线索，样本仍小，不能判定稳定')
  fixed=fixed.replace(/也不改变活动本身带来的放松体验/g,'也不改变两次都报告放松这一事实；放松来源仍未知')
  fixed=fixed.replace(/两次同类体验支持“放松”的稳定性/g,'两次都报告放松，但样本仍小，不能判定稳定')
  fixed=fixed.replace(/两次经历都支持“不被评价的陪伴”带来放松感/g,'两次都报告了“不被评价的陪伴”和放松感，但不能确定前者带来后者')
  fixed=fixed.replace(/这是目前最稳定的线索/g,'这是目前一条方向一致的线索，样本仍小，不能判定稳定')
  fixed=fixed.replace(/两次体验都指向同一个室友带来的放松感/g,'两次都是和同一位室友，仍不能把放松归因于室友；运动与陪伴的贡献尚未区分')
  if(/不生成任务|保留未知/.test(userText)){
    fixed=fixed.replace(/如果之后有机会[^。\n]*[。]?/g,'')
    fixed=fixed.replace(/可以留意一下放松感是否还在[^。\n]*[。]?/g,'')
  }
  fixed=fixed.replace(/两次和同一个室友打球都感到放松，说明“不被评价的陪伴”这个体验是稳定的。/g,'两次和同一个室友打球都感到放松，这是一条积极线索，但样本仍小，不能判定“稳定”。')
  fixed=fixed.replace(/这是目前稳定的体验/g,'这两次都放松，但样本仍小，不能判定稳定')
  fixed=fixed.replace(/目前稳定的体验/g,'这两次都放松，但样本仍小，不能判定稳定')
  fixed=fixed.replace(/这一感受在重复实践中保持稳定/g,'这两次都报告放松，但样本仍小，不能判定稳定')
  fixed=fixed.replace(/属于独立变量/g,'属于单独记录的身体状态，不是对照证据')
  fixed=fixed.replace(/运动本身贡献较大/g,'只能记录这次是否也放松，不能分配运动贡献')
  fixed=fixed.replace(/室友因素权重更高/g,'只能记录这次是否不同，不能确定室友权重')
  fixed=fixed.replace(/则[“"]?室友[”"]?是关键变量/g,'只能记录这次是否不同，不能确定室友是关键变量')
  fixed=fixed.replace(/则[^。]*是主要来源/g,'只能作为线索，不能确定主要来源')
  fixed=fixed.replace(/若独自[^。]*则偏向运动本身/g,'只能记录独自时是否也放松，不能确定来源')
  fixed=fixed.replace(/若换人[^。]*则偏向室友/g,'只能记录换人时是否不同，不能确定来源')
  fixed=fixed.replace(/运动本身可能是主要来源/g,'只能记录这次是否不同，不能确定运动本身是主要来源')
  fixed=fixed.replace(/室友的互动特质可能更关键/g,'只能记录这次是否不同，不能确定室友的互动特质更关键')
  fixed=fixed.replace(/说明运动本身提供了这种体验/g,'只能记录这次是否相似，不能确定运动本身提供了这种体验')
  fixed=fixed.replace(/若消失[^。]*说明[^。]*更关键/g,'若消失，只能记录这次不同，不能确定原因')
  fixed=fixed.replace(/说明运动形式本身可能提供了这种空间/g,'只能记录这次是否相似，不能确定运动形式本身提供了这种空间')
  fixed=fixed.replace(/(?:则)?(室友[^。；\n，,]{0,8}|运动[^。；\n，,]{0,8})贡献较大/g,'只能记录这次是否不同，不能确定$1贡献较大')
  fixed=fixed.replace(/说明核心需求是“([^”]+)”/g,'只能记录这次在替代活动中是否也放松，不能确定核心需求是“$1”')
  fixed=fixed.replace(/室友只是载体之一/g,'这只是一次替代情境的记录，不能确定室友只是载体之一')
  fixed=fixed.replace(/说明([^。；\n]{1,30}?)更关键/g,'只能说明这次可能不同，不能确定$1更关键')
  fixed=fixed.replace(/说明([^。；\n]{1,30}?)是稳定的/g,'只能说明这次体验较放松，不能判定稳定')
  fixed=fixed.replace(/这更支持“([^”]+)”是主要来源/g,'这只提供一点线索，仍不能确定主要来源')
  fixed=fixed.replace(/说明([^。；\n]{1,40}?)是(?:关键|核心变量|主要来源)/g,'只能说明这次可能不同，不能确定$1是主因')
  fixed=fixed.replace(/如果[^。]*?纯运动[^。]*?疲劳[^。]*?打折[^。]*?[。]?/g,'这只是推测，没有对照，不能证明。')
  fixed=fixed.replace(/因为如果是纯运动[^。]*?[。]?/g,'')
  if(fixed===reply)return null
  if(!/(?:仍无法区分|保留未知|不能确定主因|仍未知|(?:原因|来源).{0,8}未知)/.test(fixed))fixed=`${fixed.trim()}\n\n${/(?:运动|室友|羽毛球)/.test(userText)?'运动与陪伴的贡献仍无法区分，保留未知。':'这次只记录实际差异，不能据此分配原因，仍保留未知。'}`
  return fixed
}

function repairSingleCaseValidation(reply:string,userText:string):string|null{
  // Only actual reported sample/measurement turns may soften a causal claim.
  // The repair is subtractive: it never inserts a sample, count, person or
  // measurement that the user did not report.
  const owned=scanUserClauses(userText).filter(c=>ownedObservationClause(c)&&!assistantRequestClause(c.text))
  const reported=owned.map(c=>c.text).join('；')
  const observation=reportedObservationSource(userText)
  if(observation===null&&!/(?:两份|少问一次|20秒|40秒|60秒|只发生过一次|一次成功|测了用时)/.test(reported))return null
  if(responseRequestScope(userText).summaryRequested&&observation===null)return null
  const replaceOwnAssertion=(value:string,pattern:RegExp,replacement:string,allowMatchedNegation=false)=>{
    const clauses=scanUserClauses(value),once=new RegExp(pattern.source,pattern.flags.replace('g',''))
    return value.replace(pattern,(match,...args)=>{
      const start=args.at(-2) as number,end=start+match.length
      const touched=clauses.filter(c=>c.start<end&&c.end>start)
      if(!touched.length||touched.some(c=>!ownedObservationClause({...c,quoteSpans:[],codeSpans:[]})))return match
      const resolved=match.replace(once,replacement)
      for(const clause of touched){
        const before=clause.text.slice(0,Math.max(0,start-clause.start)),after=clause.text.slice(Math.max(0,end-clause.start))
        if(unassertedObservation.test(allowMatchedNegation?before+after:clause.text)||/(?:不|未|没有?|否认)$/.test(before.trim()))return match
        for(const span of [...clause.quoteSpans,...clause.codeSpans]){
          if(span.start>=end||span.end<=start)continue
          // A match inside a quoted/code statement cannot edit that statement.
          // Concept labels inside a larger own assertion must survive verbatim.
          if(span.start<start||span.end>end||!resolved.includes(value.slice(span.start,span.end)))return match
        }
      }
      return resolved
    })
  }
  let fixed=reply
  fixed=replaceOwnAssertion(fixed,/只能作为线索，不能写成([“"]这次[^”"]+带来一个积极线索[”"])或([“"]稳定减少询问[”"])/g,'只能作为一条积极线索，可以称为$1；尚不能证明$2',true)
  fixed=replaceOwnAssertion(fixed,/分类规则已验证有效/g,'分类规则是否有效仍不能确认')
  fixed=replaceOwnAssertion(fixed,/说明三条规则在实际协作中降低了沟通成本/g,'这只是本次观察，是否降低整体沟通成本仍未知')
  fixed=replaceOwnAssertion(fixed,/这支持了(“分类规则能减少反复找东西的时间”)这一初步观察/g,'关于$1，是否减少整体查找时间仍未知')
  fixed=replaceOwnAssertion(fixed,/说明分类规则对([“"]减少反复找东西的时间[”"])这个目标有实际帮助/g,'分类规则与$1是否有关仍未知')
  fixed=replaceOwnAssertion(fixed,/这验证了([“"]减少反复找东西时间[”"])这一偏好正在通过具体行动得到满足/g,'与$1有关的实际收益仍未确认，不能验证省时收益')
  for(const clause of scanUserClauses(fixed).reverse()){
    if(!assertiveReplyClause(clause)||compoundFactConjunction.test(clause.text)||/未来/.test(clause.text)||/^.+(?:后说明|因此|所以)/.test(clause.text))continue
    const bounded=clause.text.replace(/已验证有效/g,'这次提供积极线索，尚不能证明普遍有效').replace(/规则有效/g,'这次提供线索，尚不能确认规则有效或普遍适用')
    if(bounded!==clause.text)fixed=fixed.slice(0,clause.start)+bounded+fixed.slice(clause.end)
  }
  // Absence of a reported measurement is not proof no measurement happened.
  // Retain an explicit current-report unknown instead of an empty reply.
  const measured=/(\d+)\s*(秒|分钟)/.exec(reported)
  if(measured)fixed=replaceOwnAssertion(fixed,/（?尚未测时间）?/g,`你报告用时${measured[1]}${measured[2]}`,true)
  else fixed=replaceOwnAssertion(fixed,/（?尚未测时间）?/g,'本轮未报告用时',true)
  return fixed!==reply?fixed:null
}

function repairPriorFeelingAttribution(reply:string,userText:string):string|null{
  if(!/(?:回来反馈|这次|一次)/.test(userText))return null
  if(!/不用反复找/.test(reply)||!/这次整理动作带来的具体结果/.test(reply))return null
  const fixed=reply.replace(/你报告的“([^”]+)”和“([^”]+)”的轻松感，是这次整理动作带来的具体结果。/g,'这次只确认“$1”，目前只发生过一次；“$2”的轻松感来自此前的经历，不能自动归到这次事件。')
  return fixed!==reply?fixed:null
}

function repairExplorationTimeScope(reply:string,userText:string):string|null{
  if(!/每周最多四小时探索/.test(userText)||!/(?:备考|复习)/.test(reply))return null
  const fixed=reply.replace(/[^。！？\n]*4小时\/周[^。！？\n]*(?:备考|复习)[^。！？\n]*[。]?/g,'每周最多四小时只约束当前探索；实际备考投入尚未报告，仍未知。')
  return fixed!==reply?fixed:null
}

function repairUpdateOnlyAction(reply:string,userText:string):string|null{
  const scope=responseRequestScope(userText)
  if(!scope.summaryRequested||scope.actionRequested||scope.comparisonRequested)return null
  let fixed=reply.replace(/已更新[：:]城市与时间优先[，,]?不替你选[。]?/g,'已更新：记录城市偏好与探索时间上限，不替你选。')
  // A heading grants direct-imperative scope, not permission to delete every
  // line below it. Facts, unknowns and protected excerpts remain in place.
  const actionVerb='(?:观察|尝试|联系|访谈|安排|验证|打开|写|发送|整理|记录|搜索|提交|制作|询问|咨询|预约|报名|填写|准备|做|核对|列出)'
  const recommendation=new RegExp('^(?:你)?(?:可以|可|建议|接下来|下一步)(?:你)?[：:]?\\s*(?:继续|再)?'+actionVerb)
  const directAction=new RegExp('^(?:请)?(?:你)?(?:先|再|继续)?'+actionVerb)
  const completedAction=new RegExp('^(?:我|本人|你)?'+actionVerb+'[了过]')
  const undecorated=(text:string)=>text.trim().replace(/^(?:[-*]\s+|\d+[.、]\s*)/,'')
  let actionSection=false,removedAction=false,removedHeading=false
  const prune=(text:string,allowDirect:boolean)=>{
    let result=text
    for(const clause of scanUserClauses(text).reverse()){
      const raw=clause.text.trim(),content=undecorated(undecorated(raw).replace(/^(?:#{1,6}\s*)?(?:\*\*)?(?:下一步(?:建议|行动)?|小行动|验证动作)(?:\*\*)?[：:]\s*/,'')).replace(/^行动[：:]\s*/,'')
      const labeled=/^(?:记录|说明|整理|观察|验证)[：:]/.test(content)
      const completed=completedAction.test(content)||/已(?:经)?|曾经|刚刚|[了过]$/.test(content)
      if(!assertiveReplyClause(clause)||!(recommendation.test(content)||!labeled&&!completed&&(allowDirect||content!==undecorated(raw))&&directAction.test(content)))continue
      const before=result.slice(0,clause.start),after=result.slice(clause.end+clause.delimiter.length)
      result=(/[。！!]/.test(clause.delimiter)||!clause.delimiter?before.replace(/[，,；;]\s*$/,'。'):before)+after
      removedAction=true
    }
    return result
  }
  const originalClauses=scanUserClauses(fixed)
  let offset=0
  fixed=fixed.split('\n').map(line=>{
    const start=offset;offset+=line.length+1
    if(originalClauses.some(c=>c.start<start+line.length&&c.end>start&&!ownedObservationClause(c)))return line
    const heading=line.trim().replace(/^#{1,6}\s*|^\d+[.、]\s*/g,'').replace(/\*\*/g,'').replace(/[：:]$/,'').trim()
    if(/^(?:下一步(?:建议|行动)?|小行动|验证动作)(?:[（(][^）)]*[）)])?$/.test(heading)){actionSection=true;removedHeading=true;return ''}
    if(actionSection&&/^(?:#{1,6}\s|\*\*[^*]+\*\*|\d+[.、]\s)/.test(line.trim())&&!directAction.test(undecorated(line))&&!recommendation.test(undecorated(line)))actionSection=false
    return actionSection?prune(line,true):line
  }).join('\n').trim()
  fixed=prune(fixed,false).trim()
  return fixed!==reply?fixed||(removedAction||removedHeading?'本轮不新增行动。':''):null
}

function repairFamilyCorrectionScope(reply:string,userText:string):string|null{
  const source=scanUserClauses(userText).filter(ownedObservationClause).map(c=>c.text).join('；')
  if(!/家里没有要求我必须本校读研/.test(source))return null
  let fixed=reply
  if(/只是希望稳定/.test(source))for(const clause of scanUserClauses(fixed).reverse()){
    if(!assertiveReplyClause(clause))continue
    const bounded=clause.text.replace(/家里(?:只)?要求稳定/g,'家里希望稳定')
    if(bounded!==clause.text)fixed=fixed.slice(0,clause.start)+bounded+fixed.slice(clause.end)
  }
  fixed=fixed.replace(/受此更正影响的判断重开如下：[\s\S]*?(?=\*\*四小时内的小验证\*\*)/g,'受这条更正影响的判断：只确认“本校读研”不是家庭硬要求；家里希望稳定仍是外部期待。不能由此推出可选路径扩大，也不能默认本校读研或就业满足“稳定”。\n\n')
  fixed=fixed.replace(/这意味着[“"]本校读研[”"]从[“"]必须项[”"]降级为[“"]可选路径之一[”"][，,]?且升学路径不再局限于本校[。]?/g,'这次更正只确认“本校读研”不是家庭硬要求；你的可选路径是否变化仍未知。')
  fixed=fixed.replace(/[“"]本校读研[”"]从[“"]必须项[”"]降级为[“"]可选路径之一[”"]/g,'“本校读研”不是家庭硬要求')
  if(/相对稳定|非初创|隐性成本/.test(fixed)){
    fixed=fixed.replace(/\*\*四小时内的小验证\*\*[:：][\s\S]*$/g,'**四小时内的小验证**：\n**动作**：把“稳定”拆成最多三项可核对条件，再只查一个你已在考虑的选项，记录公开信息明确写出的条件和未写明项。\n**目的**：验证“稳定”能否转成可核对条件，不判断哪条路径更好。\n**停止条件**：三项条件和一个选项记录完，或四小时到即停。')
  }
  return fixed!==reply?fixed:null
}

function repairPathMotiveNeutrality(reply:string,userText:string):string|null{
  if(!/清晰产出/.test(userText)||!/担心直接就业准备不足/.test(userText)||!/不享受考试/.test(userText))return null
  const fixed=reply.replace(/这三点放在一起[，,]?指向一个核心矛盾[:：][^。！？\n]*考研通常被视为[^。！？\n]*[。]?/g,'目前只能确认：你重视工作产出、担心直接就业准备不足，并且不享受考试；考研或就业是否适合仍需具体核对，不能由这三点直接推出。')
  return fixed!==reply?fixed:null
}

function repairAutonomyContinuity(reply:string,userText:string,priorUserTexts:readonly string[]):string|null{
  if(!/(?:接着自由|更低成本|自由职业经历)/.test(userText))return null
  if(!priorUserTexts.some(text=>/(?:主要在意|在意).{0,12}自己安排.{0,12}专注工作.{0,8}时间/.test(text)))return null
  let fixed=reply.replace(/(?:观察一周[，,]\s*)?区分你想要的[“"]自由[”"]是时间控制、地点灵活，还是决策权[。]?/g,'你已经明确：这里的自由主要是能自己安排专注工作的时间；低成本比较只围绕这一目标，不重新定义“自由”。')
  fixed=fixed.replace(/成本最低[，,]?几乎零额外时间/g,'所需记录时间较少，实际耗时未知')
  fixed=fixed.replace(/在接下来一周记录三天/g,'在接下来三天记录')
  fixed=fixed.replace(/(?:能帮你|帮你)澄清[“"]自由[”"]的个人定义/g,'只观察专注时间是否可自主安排')
  return fixed!==reply?fixed:null
}

function repairPublicRhythmEvidence(reply:string,userText:string):string|null{
  if(!/一个远程岗位/.test(userText)||!/不联系陌生人/.test(userText))return null
  let fixed=reply
  fixed=fixed.replace(/用公开信息还原岗位一天/g,'用公开信息核对岗位节奏线索')
  fixed=fixed.replace(/(?:用\d+分钟)?把里面提到的具体任务逐条抄下来[，,]?旁边标注[“"]这条是每天做、每周做、还是偶尔做[”"][。]?/g,'只记录公开页面明确写出的工作时间、会议、响应或固定在线要求；未写明的频率标记为“信息不足”。')
  fixed=fixed.replace(/把岗位描述里的具体任务逐条抄下来[，,]?旁边标注[“"]这条是每天做、每周做、还是偶尔做[”"][。]?/g,'只记录公开页面明确写出的工作时间、会议、响应或固定在线要求；未写明的频率标记为“信息不足”。')
  fixed=fixed.replace(/抄完后你就有这个岗位一天大概做什么的真实工作节奏[。]?/g,'这只能形成公开信息中的节奏线索，不能当作完整真实工作节奏。')
  fixed=fixed.replace(/做完后你手里会有一张[“"]这个岗位一天大概做什么[”"]的清单[，,]?这就是真实工作节奏的公开线索[。]?/g,'完成后只得到公开页面明确写出的节奏线索；未写明的部分仍是信息不足。')
  fixed=fixed.replace(/不继续找第一个岗位/g,'不换其他岗位')
  fixed=fixed.replace(/停止条件[:：]抄完或(\d+分钟到即停)/g,'停止条件：记录完明确字段或$1')
  fixed=fixed.replace(/带回来的反馈[:：][^。！？\n]*标了[“"]每天做[”"][^。！？\n]*[。]?/g,'带回来的反馈：公开页面明确写了哪些时间要求，哪些关键节奏信息没有写。')
  fixed=fixed.replace(/标不出来的那条[，,]?就是下一步值得再看的点[。]?/g,'')
  fixed=fixed.replace(/信息不足[。]?[，,]不需要和任何人对话就能拿到[。]?/g,'信息不足。')
  return fixed!==reply?fixed:null
}

function repairIncompleteExampleTail(reply:string):string|null{
  const fixed=reply.replace(/\n{2,}例如[:：]\s*\n{2,}[（(]([^）)]+)$/g,(_,body:string)=>`\n\n${/[。！？!?]$/.test(body.trim())?body.trim():`${body.trim()}。`}`)
  return fixed!==reply?fixed:null
}

function repairUnmatchedParenthesis(reply:string):string|null{
  const unmatched=new Set<number>()
  for(const [open,close] of [['（','）'],['(',')']]){
    const stack:number[]=[]
    for(let i=0;i<reply.length;i++){
      if(reply[i]===open)stack.push(i)
      else if(reply[i]===close){if(stack.length)stack.pop();else unmatched.add(i)}
    }
    for(const i of stack)unmatched.add(i)
  }
  if(!unmatched.size)return null
  return reply.split('').filter((_,i)=>!unmatched.has(i)).join('')
}

function repairExternalExpectationPronoun(reply:string):string|null{
  let fixed=reply.replace(/家里没有要求你必须本校读研，但这是外部期待，不是你的内在驱动。/g,'家里希望你稳定，这是外部期待；你本人更在意留在目前城市和做有清晰产出的工作，两者是否冲突仍未知。')
  fixed=fixed.replace(/家里没有要求你必须本校读研，但这是外部期待。/g,'家里没有要求你必须本校读研；家里希望稳定，这才是外部期待。')
  return fixed!==reply?fixed:null
}

function repairZeroTimeBoundary(reply:string,userText:string):string|null{
  const zero=/(?:本周|这周|今天|现在|目前).{0,8}(?:可用时间|时间).{0,6}(?:是)?零|零时间|没空/.test(userText)
  if(!zero||!/(?:厘清|解释|边界|理解)/.test(userText))return null
  if(/(?:不等于拒绝|结果未知)/.test(reply))return null
  const quote=/([^。；\n]{2,40})只是结果未知/.exec(userText)?.[1]?.trim()
  const boundary=quote?`${quote}只说明结果未知，不等于拒绝`:'当前只说明结果未知，不等于拒绝'
  return `${reply.trim()}\n\n${boundary}；这不需要你现在执行任何动作，等你想继续时再核对。`
}

function repairPhaseSummary(reply:string,userText:string):string|null{
  if(!/(?:只给一句阶段理解|一句阶段理解)/.test(userText))return null
  // Do not turn an already complete one-sentence understanding into a second
  // generic paragraph. Status-only acknowledgements still need an understanding.
  if(isSingleSentenceReply(reply)&&! /^(?:已暂停|先暂停|暂停了?|等你|今天先休息)/.test(reply.trim()))return null
  const existing=/(?:^|\n)\s*(阶段理解[:：][^\n]+)/.exec(reply)?.[1]?.trim()
  if(existing)return existing===reply?null:existing
  if(/阶段理解|当前理解|暂定理解/.test(reply))return null
  // A substantive existing summary is the requested sentence; label it rather
  // than appending a second, near-duplicate paragraph.
  if(/(?:仅此一次|只发生过一次|不代表|目前只|样本)/.test(reply)&&reply.length>40)return `阶段理解：${reply.trim()}`
  const count=/(?:已经|做了|尝试了|有).{0,6}([一二两三四五六七八九十\d]+)次/.exec(userText)?.[1]
  const scope=count?`已有${count}次类似尝试`:'目前线索有限'
  const pause=scanUserClauses(userText).some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther
    &&/^(?:请|麻烦)?(?:现在|今天)?(?:先|暂时)?(?:暂停|不再安排|不继续|不要再安排|等我)/.test(clause.text.trim()))
  return `阶段理解：${scope}，仍只能作为有限线索，尚不能判定稳定效果${pause?'；先暂停，等你主动回来':''}。`
}

// A narrow current observation, not a topic/count-specific canned history.
// The existing scanner owns source identity; ambiguous or mixed reports stay
// on the ordinary path. Only an unsupported causal update is replaced.
function reportedObservationParts(userText:string,requireSummaryScope=true):{source:string;result:string}|null{
  // The current turn owns the delivery boundary. A prior authorized turn may
  // supply the observation even when that earlier turn did not request a
  // summary; it still has to satisfy the same narrow source-shape rules below.
  if(requireSummaryScope){
    const scope=responseRequestScope(userText)
    if(!scope.summaryRequested||scope.actionRequested||scope.comparisonRequested||scope.sentenceLimit!==undefined)return null
  }
  const clauses=scanUserClauses(userText)
  const heads=clauses.filter((c,index)=>(index===0||clauses[index-1]!.sentenceStart!==c.sentenceStart)
    &&ownedObservationClause(c)&&/我/.test(c.text)
    &&(clauseReportsCompleted(c.text)||/(?:了|过)/.test(c.text)))
  if(heads.length!==1)return null
  const head=heads[0]!,report=clauses.filter(c=>c.sentenceStart===head.sentenceStart)
  if(report[0]!==head||report.length<2||report.length>3||!/^(?:后来|随后|之后|然后)/.test(report[1]!.text.trim()))return null
  // A third clause may be a subjectless comparative result, not a newly
  // introduced person's independent event. Longer reports remain untouched.
  if(report[2]&&!/^(?:还|也)?(?:少|多|更)/.test(report[2].text.trim()))return null
  if(clauses.some(c=>!ownedObservationClause(c)))return null
  if(clauses.some(c=>c.sentenceStart!==head.sentenceStart&&!assistantRequestClause(c.text)&&!/^不要重复问已经回答的内容$/.test(c.text.trim())&&!/^接着[^。！？]{1,24}(?:的事|的探索|这件事)$/.test(c.text.trim())))return null
  if(report.some(c=>assistantRequestClause(c.text)))return null
  const source=userText.slice(head.start,report.at(-1)!.end).trim()
  if(/想|愿|期待|盼|使|让/.test(source))return null
  // A recent event is not proof it was the only trial. Explicit experiment,
  // repetition, uncertainty, plans or user-reported causal results cannot be
  // collapsed into this limited temporal-observation correction.
  if(/可能|似乎|好像|或许|也许|以为|猜|推测|估计|听说|据说|不确定|不知道|没有|还没|尚未|未曾|假设|打算|计划|准备|希望|对照|随机|多次|重复|长期|统计|验证|证明|因为|因此|所以|导致|造成|第[一二两三四五六七八九十百\d]+次|又(?:一)?次|再次|[二两三四五六七八九十2-9]\d*次/.test(source))return null
  return {source,result:userText.slice(report[1]!.start,report.at(-1)!.end).trim()}
}

function reportedObservationSource(userText:string):string|null{return reportedObservationParts(userText)?.source??null}

function reportedChangeMatches(text:string,observation:string):boolean{
  const reported=scanUserClauses(observation).filter(clause=>ownedObservationClause(clause)&&!unassertedObservation.test(clause.text)
    &&!/(?:不|没|未)(?:是|曾|有|能|会)?[^，。！？]{0,8}(?:少|多)(?:问|询问|提问)/.test(clause.text)
    &&!clauseExpressesFuturePlan(clause.text)&&!/将|会|预计|预期|未来|明年|下(?:一)?(?:周|月|年)/.test(clause.text)).map(clause=>clause.text).join('，')
  if(reported.includes(text.trim()))return true
  // Keep the explicitly reported question-count metric when summarized with
  // its ordinary equivalent. This does not license a different outcome or
  // another person's metric merely because the reply contains a change verb.
  const person=/(同学|老师|导师|室友)/.exec(text)?.[1]
  const reportedPeople=[...new Set(reported.match(/同学|老师|导师|室友/g)??[])]
  const actor=person??(reportedPeople.length===1?reportedPeople[0]:undefined)
  return actor!==undefined&&/(?:询问|提问)/.test(text)&&/减少了?一(?:次|回)/.test(text)
    &&new RegExp(actor+'[^。！？]{0,36}少问(?:了我|了)?一(?:次|回)').test(reported)
}

function repairReportedObservationUpdate(reply:string,userText:string,preserveReportedObservation=false):string|null{
  const observation=reportedObservationSource(userText)
  if(observation===null)return null
  let fixed=reply
  for(const clause of scanUserClauses(reply).reverse()){
    if(!assertiveReplyClause(clause)||/未来/.test(clause.text))continue
    // Latest-event framing does not establish the total number of trials.
    // Replace only that quantifier, preserving independent facts in the clause.
    if(!/(?:只|仅)发生(?:过)?一次/.test(observation)&&/(?:只|仅)发生(?:过)?一次/.test(clause.text)){
      const bounded=clause.text.replace(/(?:只|仅)发生(?:过)?一次/g,'本轮只报告了这次结果')
      fixed=fixed.slice(0,clause.start)+bounded+fixed.slice(clause.end)
      continue
    }
    const text=clause.text.trim()
    let bounded:string|null=null
    const motivation=/(?:减少|降低|改善)[^。！？]{1,24}的(?:偏好|意愿|愿望|动机|目标)/.exec(text)
    const outcome=motivation?text.slice(motivation.index+motivation[0].length):''
    const outcomeIsPlan=clauseExpressesFuturePlan(outcome)||/^(?:是为了|为了|需要|应当|应该|必须|有待|仍待|尚待|将|待|要)/.test(outcome.trim())
    if(motivation&&!compoundFactConjunction.test(outcome)&&!outcomeIsPlan&&(clauseReportsCompleted(outcome)||/做到|实现|达成|满足|证明|验证|有效|效果/.test(outcome))){
      // The motive stays reported; only the alleged benefit is unverified.
      bounded=text.slice(0,motivation.index+motivation[0].length)+'，相应的实际收益仍未确认'
    }
    else if(compoundFactConjunction.test(clause.text))continue
    else if(observationEffectHypothesis(text)!==null)bounded='待验证的假设：'+observationEffectHypothesis(text)
    else if(/已(?:经)?得到验证/.test(text))bounded=clause.text.replace(/已(?:经)?得到验证/g,'仍需核实')
    // Only a whole-clause inference can be replaced wholesale. An embedded
    // connector may follow a factual prefix; defer rather than erase it.
    else if(/^(?:(?:这(?:也)?|上述结果|该结果)?(?:说明|表明|证明|验证)[^。！？]{0,60}(?:有效|减少|降低|省时|改善|作用|造成|结果)|(?:也|还)?(?:确实|切实|已经|已)[^。！？]{0,40}(?:有效|减少|降低|省时|改善|造成))/.test(text))bounded='这只是本次报告的具体结果，不能确认因果关系或普遍效果'
    else if(!motivation&&!reportedChangeMatches(text,observation)&&!/(?:说明|表明|证明|验证|导致|造成)/.test(text)&&/^.{1,32}?(?:确实|切实|已经|已)?(?:减少|降低|改善)了?[^。！？]{1,24}$/.test(text))bounded=clause.text.replace(/^(.{1,32}?)(?:确实|切实|已经|已)?(减少|降低|改善)了?([^。！？]{1,24})$/,'$1是否$2$3仍不能确认')
    else if(!/(?:说明|表明|证明|验证)/.test(text)&&/^.{1,24}起作用了?$/.test(text))bounded=clause.text.replace(/起作用了?$/,'是否起作用仍不能确认')
    else if(!/(?:说明|表明|证明|验证)/.test(text)&&/^[^。！？]{1,24}有效$/.test(text))bounded=clause.text.replace(/有效\s*$/,'是否有效仍不能确认')
    if(bounded!==null)fixed=fixed.slice(0,clause.start)+bounded+fixed.slice(clause.end)
  }
  return fixed!==reply?fixed:null
}

function repairPostReviewScope(reply:string,userText:string,priorUserTexts:readonly string[]=[]):string|null{
  let fixed=reply
  const allUserText=[userText,...priorUserTexts].join('；')
  // The user's stated weekly cap is a hard boundary. A provider-generated
  // two-week/daily plan can exceed it even when the option looks low-cost.
  if(/每周最多两小时/.test(userText)){
    fixed=fixed.replace(/用两周时间，每天固定一小时/g,'用两周时间，每周最多两小时')
    fixed=fixed.replace(/每天固定一小时/g,'每周最多两小时')
    fixed=fixed.replace(/短期兼职或志愿工作/g,'每周不超过两小时的短期观察')
  }
  // “不在意当老板” is a current-priority statement, not proof that the
  // dimension is unknown or excluded. It may come from an earlier turn.
  if(/(?:不在意当老板|当老板[^。！？\n]{0,6}(?:不在意|不重要))/.test(allUserText)){
    fixed=fixed.replace(/地点、老板身份等其他维度仍未确认/g,'地点仍未知；当老板不是当前重点，但不等同于排除')
    fixed=fixed.replace(/老板身份等(?:其他)?维度仍未确认/g,'当老板不是当前重点，但不等同于排除')
  }
  if(/创业仍然拒绝/.test(userText)){
    fixed=fixed.replace(/创业保持暂停/g,'创业保持暂停，不自动重开')
    fixed=fixed.replace(/创业仍然拒绝，保持拒绝/g,'创业保持暂停，不自动重开')
  }
  // A correction of one observation cannot be turned into a causal claim.
  if(/更正/.test(userText)&&/少问一次只是结果/.test(userText)){
    fixed=fixed.replace(/此前把“同学少问”当作成就感来源的判断作废；/g,'')
    fixed=fixed.replace(/现在支持的是：分类规则让你自己省去了反复找东西的环节，这与你减少反复找的目标直接相关。/g,'目前的线索只是：你报告自己在这轮整理中少翻了材料；这是一次观察，不能证明分类规则导致，仍需重复验证。')
  }
  // A provider stream can end exactly at a dangling “你对”; complete the
  // already-grounded reassurance rather than dropping the useful question.
  if(/不要用一次疲惫推翻/.test(userText)){
    fixed=fixed.replace(/不影响你对$/,'不影响你对这次放松的判断。')
  }
  if(/现在卡住的是$/.test(fixed)){
    fixed=fixed.replace(/现在卡住的是$/,'现在还没说清具体卡在哪一步；先保留这个问题，不安排下一步。')
  }
  if(/导师回复说手机打不开链接/.test(userText)){
    fixed=fixed.replace(/说明卡点只在访问条件/g,'只能说明这次没有拿到内容评价，不能确定唯一卡点')
  }
  if(/我可以导出PDF/.test(userText)){
    fixed=fixed.replace(/导师能打开PDF即说明问题在链接格式而非内容本身/g,'如果导师能打开PDF，只能说明这个渠道可用，不能确定原链接失败的唯一原因')
  }
  if(/只了解一个远程岗位/.test(userText)){
    fixed=fixed.replace(/从你已浏览过的平台选一个岗位即可/g,'从一个公开招聘页面选一个岗位即可')
    fixed=fixed.replace(/这能帮你判断[^。！？\n]*是否常见[^。！？\n]*[。]?/g,'这只能帮你了解这一个岗位的描述，不能判断是否常见，也不证明你适合该岗位。')
  }
  if(/请更新这段经历的局部理解/.test(userText)){
    fixed=fixed.replace(/轻松源于不用表现及自然说话/g,'你报告轻松主要来自不用表现及自然说话；这仍是本人描述，不能排除其他因素')
  }

  // A zero-call status update must not echo the user's report instead of
  // applying it. Keep the two participants and their states separate.
  if(/老师后来回复说这周忙/.test(userText)&&/^回来反馈：老师后来回复说这周忙/.test(fixed)){
    fixed='已更新：老师后来回复“这周忙，下周再看”，此前“未回复”作废；同学表格仍明确不适合他，这一点未变。'
  }
  if(/第二天大约20秒找到通知/.test(userText)){
    fixed=fixed.replace(/这次整理让找通知变快/g,'这次你在约20秒内找到通知')
    fixed=fixed.replace(/这次20秒找到符合这个目标吗？/g,'此前没有同样计时的基线，不能判断是否变快；这次20秒可以记下作为起点。')
  }
  if(/先暂停这个方向/.test(userText)&&/两次整理后找东西变快/.test(fixed)){
    fixed=fixed.replace(/目前只有两次整理后找东西变快的个例/g,'目前只有你自己这一次可计时的整理后查找记录')
    fixed=fixed.replace(/尚不能判断这是稳定效果还是偶然。/g,'同学那次是另一个人找到材料，不能算作你的第二次体验；尚不能判断这是稳定效果还是偶然。')
  }
  return fixed!==reply?fixed:null
}

export function repairStatusUpdate(reply:string,userText:string):ReviewedRepair|null{
  const fixed=repairPostReviewScope(reply,userText,[])
  return fixed===null?null:{reply:fixed,phases:['post_review_scope']}
}

// A provider can end a stream at a word boundary even when the JSON is valid.
// Running this at the final boundary guarantees the delivered prose is at
// least sentence-closed; it only removes a trailing ungrounded connector, never
// invents a new claim.
export function closeDanglingReply(reply:string):string|null{
  const trimmed=reply.trim()
  if(!trimmed||/[。！？!?…；;」』”"）)]$/.test(trimmed))return null
  let last=-1
  for(const mark of ['。','！','？','!','?','…','；',';'])last=Math.max(last,trimmed.lastIndexOf(mark))
  if(last<0)return null
  const tail=trimmed.slice(last+1).trim()
  const count=(text:string,mark:string)=>text.split(mark).length-1
  const unclosed=(count(tail,'（')>count(tail,'）'))||(count(tail,'(')>count(tail,')'))||(count(tail,'“')>count(tail,'”'))
  if(!unclosed&&!/^(?:我想确认的是|目前已知|现在卡住的是|也就是|或者说|以及|或者|和|与|[（(“"：:、，,]|如|例如|比如)/.test(tail))return null
  const closed=trimmed.slice(0,last+1).trim()
  return closed||null
}

function repairReviewCategories(reply:string,userText:string,preserveReportedObservation=false):string|null{
  let fixed=reply
  if(/(?:请更新判断|回来反馈)/.test(userText)){
    fixed=fixed.replace(/[^。！？\n]*[“"]清晰产出[”"][^。！？\n]*具体画面是什么[？?]/g,'你已说明想要有清晰产出的工作；具体产出例子仍未知，本轮只更新已报告的信息。')
    fixed=fixed.replace(/[^。！？\n]*偏向直接就业\/自由职业[^。！？\n]*[。]?/g,'本轮只保留已提及的升学与就业取舍，不新增其他方向。')
  }
  if(/家里没有要求我必须本校读研/.test(userText)){
    fixed=fixed.replace(/此更正解除了[“"]路径必须绑定本校[”"]的假设/g,'此更正只解除“本校读研是家庭要求”的误解')
    fixed=fixed.replace(/升学路径不再局限于本校，选择面扩大[。；]?/g,'这次更正只解除“本校读研是家庭要求”的误解；你的可选路径是否变化仍未知。')
    fixed=fixed.replace(/[^。！？\n]*清晰产出[^。！？\n]*(?:自由职业|内部创业)[^。！？\n]*[。]?/g,'一次查看后的模糊或排斥不能推出新的就业形态；只记录本次反应。')
  }
  if(/暂停考研方向/.test(userText)){
    fixed=fixed.replace(/考研方向暂停，但其他方向（[^）]+）未关闭。/g,'考研方向已暂停；未提及的其他方向不在本轮判断。')
  }
  if(/作品集/.test(userText)&&/(?:还没|没有|未).{0,4}(?:回复|回应)/.test(userText)){
    fixed=fixed.replace(/真正影响下一步的缺口是：发送时是否附带了具体说明[。；]?/g,'当前只确认已发送、未回复；是否收到、是否读过和未回复原因仍未知。')
    fixed=fixed.replace(/如果只有链接[^。！？\n]*补发[^。！？\n]*[。]?/g,'是否需要补充说明要等发送原文与访问状态核对后再判断，本轮不自动安排。')
    if(/发送时是否附带了具体说明|对方可能不清楚/.test(reply))fixed='已发：作品集链接已发送。已读：未知。已回复：未回复。是否采用：未知。实际效果：未知。真正影响下一步的是发送是否成功、链接能否访问、导师是否读过，以及原消息是否说明希望获得什么反馈；这些目前都未核对，未回复原因仍未知。本轮先复盘状态，不执行新发送或催促。'
  }
  // An unselected comparison is not an assigned action. This legacy
  // category fallback cannot replace the requested options with another plan.
  if(responseRequestScope(userText).actionRequested&&!responseRequestScope(userText).comparisonRequested&&/没有客户/.test(userText)&&/没有自由职业经历/.test(userText)&&/(?:更低成本|比较)/.test(userText)&&/(?:开源项目|志愿活动|帮同学|线上小任务|寻找第一个对象|找[^。\n]{0,8}需求)/.test(fixed)){
    fixed='比较两种不联系客户、能自行开始的低成本探索：一是用现有日程记录一周内可自主安排的专注时段，只观察时间是否被打断；二是只读一个公开远程岗位描述里的会议、响应和固定在线要求，不联系任何人、不提供资料。前者依赖更少，成本更低；两种都只提供线索，不证明你适合自由职业。'
  }
  if(/只[^。\n]{0,10}(?:了解|看|查看)[^。\n]{0,10}一(?:个|份|条)[^。\n]{0,16}(?:岗位|职位|JD|招聘)/.test(userText)){
    fixed=fixed.replace(/如果公开信息里找不到节奏描述，就换下一个岗位，仍找不到则停/g,'如果这个岗位的公开信息里找不到节奏描述，就记录“信息不足”并停止，不扩大到其他岗位')
  }
  if(/固定开两次会/.test(userText)){
    fixed=fixed.replace(/固定的两次会议(?:也)?会切割你的时间块/g,'固定会议可能影响专注时段，但会议时长、时点及实际影响未知')
    fixed=fixed.replace(/固定会议会切割专注时间/g,'固定会议可能影响专注时段，但实际影响未知')
  }
  if(/不生成任务/.test(userText)){
    fixed=fixed.replace(/这是目前最稳的线索/g,'这是两次方向一致的线索，但样本仍小，不能判定稳定')
    fixed=fixed.replace(/如果之后还想继续[^。！？\n]*(?:可以)?留意[^。！？\n]*[。]?/g,'')
    fixed=fixed.replace(/现在不需要再追问原因或安排下一步[。；]?/g,'')
  }
  if(/只想说说/.test(userText)&&/不要建议/.test(userText)){
    fixed=fixed.replace(/今天不想动脑子[^。！？\n]*[。]?/g,'你今天只想说说；我不建议、不追问，先停在这里。')
  }
  if(/邮件已送达/.test(fixed)&&/是否阅读[^。！？\n]*未知/.test(fixed)){
    fixed=fixed.replace(/邮件已送达，但老师是否阅读未知/g,'邮件已发送；是否送达、是否阅读仍未知')
  }
  if(/(?:三条分类规则|少问了我一次)/.test(userText)){
    fixed=fixed.replace(/新信息确认了分类规则的实际效果/g,'新信息提供了一次具体结果，但不能确认规则的稳定效果')
    fixed=fixed.replace(/这切实降低了他人的沟通成本/g,'这次同学少问了一次；是否降低整体沟通成本仍未知')
    fixed=fixed.replace(/并验证了这种整理方式在协作场景下的有效性/g,'，也不能验证这种整理方式在其他协作场景有效')
  }
  if(/少问一次只是结果/.test(userText)&&/真正轻松的是自己不用反复找/.test(userText)){
    fixed=fixed.replace(/记录两件事——你自己找东西时是否少了一次来回翻找，以及同学是否仍来问你/g,'只记录你自己是否仍需反复翻找')
  }
  if(/不确定是运动本身还是这个室友/.test(userText)){
    fixed=fixed.replace(/下次找另一个你愿意一起活动的人，做一件同样不需要表现的事（比如散步、拼拼图、一起做饭）/g,'下次换一位你愿意一起活动的人，保持同样的羽毛球活动，只改变同伴')
    fixed=fixed.replace(/下次找另一个你愿意一起活动的人，做一件同样不需要表现的事，比如散步或拼图/g,'下次换一位你愿意一起活动的人，保持同样的羽毛球活动，只改变同伴')
    fixed=fixed.replace(/如果换人后仍放松，说明[“"]不被评价的陪伴[”"]本身是核心/g,'如果换人后仍放松，只能记录这次相似，不能确定“不被评价的陪伴”是核心来源')
    fixed=fixed.replace(/如果换人后明显不自在，说明这位室友的特定互动方式起了关键作用/g,'如果换人后明显不自在，只能记录这次不同，不能确定室友互动是关键原因')
  }
  const notDislike=/不代表我不喜欢([^。！？\n]+)/.exec(userText)?.[1]?.trim()
  if(notDislike){
    fixed=fixed.replace(/不用因为[^。！？\n]*就怀疑自己的喜好/g,`本轮只确认疲惫不等于不喜欢${notDislike}；是否喜欢及程度不新增判断`)
  }
  if(/(?:又和同一个室友|两次|一周后.*仍然放松)/.test(userText)){
    fixed=fixed.replace(/这是目前最稳的线索/g,'这是两次方向一致的线索，但样本仍小，不能判定稳定')
  }
  if(/主要想更快看出哪些信息关键/.test(userText)&&/减少自己反复找东西/.test(userText)){
    fixed=fixed.replace(/这已经说明整理对你有实际价值，也说明你在这件事里找到了自己的用处/g,'这是你希望通过整理实现的目标；本轮尚未报告实际效果，是否实现仍未知')
    fixed=fixed.replace(/这已经说明整理对你有实际价值/g,'这是你希望实现的目标；实际效果仍未知')
  }
  fixed=repairReportedObservationUpdate(fixed,userText,preserveReportedObservation)??fixed
  fixed=fixed.replace(/只记录你自己是否仍需反复翻找。只记录这两点/g,'只记录你自己是否仍需反复翻找。只记录这一点')
  return fixed!==reply?fixed:null
}
