// Structured experience fields stay server-owned: the model only names clause
// handles, and every stored string is verbatim user text or a date derived
// from it. A handle outside the selected experience span would store text the
// user said about something else, so it drops that field — never the candidate.
import { buildClauseCatalogue, resolveClause, unprotectedClauseText, type ClauseHandle } from './clause-catalogue.ts'
import { resolveOccurredDate } from './growth-time.ts'
import { classifyWithLexicon,SKILL_ACTION_LEXICON } from './category-lexicon.ts'
import {conversationPreferenceClause,assistantRequestClause,refusalPreferenceClause,profileWritesDisallowed,otherActorClause,personalReportBody,jointPersonalActorClause,firstPersonalActor,assistedSelfPerformanceClause,futureSiblingConjunctionAt,futureSiblingSequenceAt,futureSiblingSequenceBefore,futureSiblingContrastAt,cancelledPlanSiblingConjunctionAt,completedSiblingAfterCancelledPlanAt,consideredFutureSiblingAfterCompletionAt,methodOwnedInstructionClause,completedMethodOwnedInstructionClause,explicitObservedOtherPerformanceClause,nominalizedFuturePlan,completedOwnedAspectBefore,ownedOuterRecordAction,governedConsiderationIndexes,leadingActionTimeLength,openHumanOtherActor,passiveRelativeObjectStart,trailingOtherPerformer} from './user-command-spans.ts'

export type ResolvedCandidateContent = { action: string; result: string; occurredAt: string }

// Structure-only trigger for requiring the candidate lane: a first-person,
// non-question, non-hypothetical clause that reports a COMPLETED action. The
// same clause flags the anchor guards use; no semantics are inferred here.
// Flash-tier models otherwise treat the optional lane as omittable, and the
// lane is the only path from a conversation to the star map.
const COMPLETED_ACTION = /(?:做成了|做完|完成|交付|交了|交完|交上去|交过去|交到|交给|补交|补齐|补完|提交了|通过了|发了|发过|送到|写完了|写了|写过|赶完|弄完|搞定了|拿到了|参加过|参加了|办了|签了|录了|考了|考过|剪了|排了|整理了|整理过|整理好|准备完(?:了)?(?!成)|准备好(?:了)?(?!好)|办好|写好|做好|改好|弄好|搞定|送到|寄到|买好|订好|排好|上线了|发布了|发布过|上线|发布|上线|投了|投过|帮过|当过|带过|做过|做了|访谈了|调研了|采访了|拒绝了|拒绝了?|回绝了|申报了|答辩完|办完)/
const NOT_YET = /打算|希望|想要|将要|下次|明天|后天|以后|考虑|如果|假设|还没|尚未|没来得及|没写完|没做完|没完成|没交/
const DEFINED_ARTIFACT=/(?<!决)定了(?:[^。！？，,；;]{1,12}的)?[一二两三四五六七八九十百\d]+(?:条|项|个|套|份)[^。！？，,；;]{0,6}(?:规则|标准|流程|结构|格式|清单|问题)$/
const OWNED_CONTACT_FORM=/^(?:我|本人)(?:已经|实际|今天|昨天|刚刚|之前|只)?(?:问了|问过|聊过|填过|填了|打印了|打印过)/
const OWNED_CHANNEL_CONTACT=/^(?:我|本人)(?:已经|实际|今天|昨天|刚刚|之前|只)?通过(?:(?:校内|学校))?(?:邮箱|邮件|微信|电话|短信|系统|平台|网站|表单|渠道)(?:(?:已经|已|实际|直接|主动|再次|成功)|(?:给|向)[^，。；！？]{1,10}){0,2}(?:发(?!现)|发送|提交|联系|请教|询问)/
const COMPLETED_CHANNEL_CONTACT=/^(?:我|本人)(?:已经|实际|今天|昨天|刚刚|之前|只)?通过(?:(?:校内|学校))?(?:邮箱|邮件|微信|电话|短信|系统|平台|网站|表单|渠道)(?:(?:已经|已|实际|直接|主动|再次|成功)|(?:给|向)[^，。；！？]{1,10}){0,2}(?:发(?:了|过|(?:出去|过去|到|给)了)|发送(?:了|过)|提交(?:了|过)|联系(?:了|过)|请教(?:了|过)|询问(?:了|过))/
const PAST_CHANNEL_CONTACT=/^(?:我|本人)(?:已经|实际|昨天|前天|上周|刚刚|之前)通过(?:(?:校内|学校))?(?:邮箱|邮件|微信|电话|短信|系统|平台|网站|表单|渠道)([^，。；！？]{0,24}?)(发(?!现|展|生|挥|育)(?:出去|过去|到|给)?|发送|提交|联系|请教|询问)(?![^，。；！？]{0,24}的(?:计划|打算|安排|方案|想法|设想|提议))/
const OBJECT_FINAL_CHANNEL_CONTACT=/^(?:我|本人)(?:已经|实际|今天|昨天|前天|上周|刚刚|之前|只)?通过(?:(?:校内|学校))?(?:邮箱|邮件|微信|电话|短信|系统|平台|网站|表单|渠道)([^，。；！？]{0,24}?)(发送|发(?!现|展|生|挥|育)|提交|联系|请教|询问)([^，。；！？]{1,24}?)(了|过)(.*)$/
// An object-final aspect marker is ambiguous without a positive nominal
// object boundary: `发送报告了` is an action, while `发送请求超时了` has an
// unexecuted nominal subject plus a second predicate.  Keep the positive
// grammar deliberately conservative instead of trying to enumerate every
// possible state predicate.
const CHANNEL_CONTACT_OBJECT_HEAD=/(?:报告|材料|消息|邮件|请求|申请|任务|作业|表单|简历|附件|文件|文档|问卷|问题|资料|证明|作品|代码|链接|照片|视频|名单|通知|回复|稿件|论文|方案|项目|报名|订单|工单|账户|账号|导师|老师|学长|学姐|负责人|客服|学校|学院|部门|平台|系统)$/
const OBJECT_FINAL_ASPECT_TAIL=/^[^，。；！？]{1,24}?(?:了|过)(?:$|[，。；！？]|但|并|而|却|然后|后来|随后|接着)/
const NON_PERFORMED_CHANNEL_BRIDGE=/(?:差(?:一)?点|险些|几乎|看到|看见|发现|得知|听说|记录到|了解到|收到|接到|读到|没(?:有)?成功|未能|没能|无法|不能|无需|无须|不必|不用|不需要|没有必要|被(?:要求|通知|提醒|建议|劝|命令)|需要|应该|应当|必须|可以|能够|能|计划|准备|打算|想(?:要)?|拒绝|不愿|不想|不打算|讨论|商量|研究|咨询|了解|提到|提及|说明|(?:不|未)(?:曾|再|予以|继续|主动|直接)?\s*$)/
const NON_PERFORMED_CHANNEL_TAIL=/^[^，。；！？]{0,32}(?:可能|也许|或许|恐怕|预计|容易|会(?:导致|造成|让|使|被|有|出现|发生|泄露|暴露|丢失|失败|出错))/
const EVALUATED_CHANNEL_TAIL=/^[^，。；！？]{0,32}(?:应该|应当|可以|能够|最好|更(?:合适|妥当|可行|稳妥))[^，。；！？]{0,16}$/
const FAILED_CHANNEL_TAIL=/^[^，。；！？]{0,32}(?:[，,]\s*)?(?:又|后来|随后|然后|接着|当场|最终|实际)?(?:我|本人)?(?:又|后来|随后|然后|接着|当场|最终|实际)?(?:(?:因为|因|由于)[^，。；！？]{1,24}?)?(?:(?:发送|发出|提交|联系|请教|询问))?(?:失败(?:了)?|未成功|没(?:有)?成功|未发出|没(?:有)?发出)(?:$|[，。；！？])/
const channelActionKind=(verb:string)=>/^(?:发|发送)/.test(verb)?'send':verb
const finalChannelAction=(text:string)=>[...text.matchAll(/发送|发出|提交|联系|请教|询问|发(?!现|展|生|挥|育)/g)].at(-1)?.[0]
const negatedChannelFailure=(text:string)=>/(?:并)?(?:没(?:有)?|未|不曾|从未|不是|并非)(?:(?:发送|发出|提交|联系|请教|询问|发(?!现|展|生|挥|育))\s*)?失败(?:了)?(?:$|[，。；！？])/.test(text)
const negatedChannelActionKind=(text:string):string|null=>{
 if(negatedChannelFailure(text))return null
 const match=/(?:(?:所以|因此|因而|于是|故而|后来|随后|然后|接着|最终|实际)\s*)?(?:我|本人)?(?:(?:还是|就|也|最终|实际)\s*)?(?:没(?:有)?|并未|未曾|未|不曾|从未)(?:(?:把|将)[^，。；！？]{1,24}?)?(发送|发出|提交|联系|请教|询问|发(?!送|出|现|展|生|挥|育|错))(?!错)(?:出去|出|给|到|过)?(?:[^，。；！？]{0,24})?(?:$|[，。；！？])/.exec(text)
 return match?channelActionKind(match[1]!):null
}
const channelFailureMatches=(tail:string,sourceVerb:string)=>{
 if(!FAILED_CHANNEL_TAIL.test(tail))return false
 if(negatedChannelFailure(tail))return false
 const failedAction=finalChannelAction(tail)
 return !failedAction||channelActionKind(failedAction)===channelActionKind(sourceVerb)
}
const PRE_CHANNEL_ACTION_TAIL=/^[^，。；！？]{0,24}(?:之前|前(?!端|提|景|沿|排|台|门|置|半|线|往|期|辈|任|人|者|天|年|月|周))/
const INTERRUPTED_CHANNEL_TAIL=/^[^，。；！？]{0,24}(?:时|过程中|过程里|期间)(?:[，,]\s*)?(?:又|后来|随后|然后|接着|当场|最终|实际)?(?:我|本人)?(?:又|后来|随后|然后|接着|当场|最终|实际)?(?:取消|撤销|停止|中止|终止|放弃|打断|中断)(?:了)?(?:这次|本次)?(?:发送|发出|发(?!现|展|生|挥|育)|提交|联系|请教|询问|操作|动作)(?:$|[，。；！？])/
const CONNECTED_CANCELLED_CHANNEL_TAIL=/^[^，。；！？]{0,24}[，,]\s*(?:又|后来|随后|然后|接着|当场|最终|实际)?(?:我|本人)?(?:又|后来|随后|然后|接着|当场|最终|实际)?(?:取消|撤销|停止|中止|终止|放弃|打断|中断)(?:了)?(?:这次|本次)?(?:发送|发出|发(?!现|展|生|挥|育)|提交|联系|请教|询问|操作|动作)(?:[^，。；！？]{1,24})?(?:$|[，。；！？])/
const NOMINAL_CHANNEL_STATE_TAIL=/^[^，。；！？]{1,24}(?:(?:卡|堵|停|挂)住|坏|故障|堵塞|停滞|挂起|崩溃|失效|异常|不可用|不能用|无法使用|打不开|没有反应|消失|变[^，。；！？]{1,8}|被[^，。；！？]{1,10}|(?:存在|有)[^，。；！？]{1,24})(?:了)?(?:$|[，。；！？])/
const reportsPastChannelContact=(text:string)=>{
 const match=PAST_CHANNEL_CONTACT.exec(text)
 if(!match||NON_PERFORMED_CHANNEL_BRIDGE.test(match[1]??'')||otherActorClause((match[1]??'')+(match[2]??'')))return false
 const tail=text.slice(match[0].length)
 return !/的\s*$/.test(match[1]??'')&&!/的\s*$/.test(tail)&&!/^[^，。；！？]{0,32}的(?=[^，。；！？])/.test(tail)&&!OBJECT_FINAL_ASPECT_TAIL.test(tail)&&!NOMINAL_CHANNEL_STATE_TAIL.test(tail)&&!NON_PERFORMED_CHANNEL_TAIL.test(tail)&&!EVALUATED_CHANNEL_TAIL.test(tail)&&!trailingOtherPerformer(tail)&&negatedChannelActionKind(tail)!==channelActionKind(match[2]??'')&&!channelFailureMatches(tail,match[2]??'')&&!PRE_CHANNEL_ACTION_TAIL.test(tail)&&!INTERRUPTED_CHANNEL_TAIL.test(tail)&&!CONNECTED_CANCELLED_CHANNEL_TAIL.test(tail)
}
const CHANNEL_CONTACT_NOT_COMPLETED=/(?:失败|未成功|没(?:有)?成功|未发出|没(?:有)?发出|的(?:计划|打算|安排|方案|想法|设想|提议))/
const reportsVerbPerfectiveChannelContact=(text:string)=>{
 const match=COMPLETED_CHANNEL_CONTACT.exec(text)
 if(!match)return false
 const tail=text.slice(match[0].length)
 const sourceVerb=finalChannelAction(match[0])??''
 return !channelFailureMatches(tail,sourceVerb)&&!/^[^，。；！？]{0,32}的(?:计划|打算|安排|方案|想法|设想|提议)/.test(tail)
}
const reportsObjectFinalChannelContact=(text:string)=>{
 const match=OBJECT_FINAL_CHANNEL_CONTACT.exec(text)
 if(!match||NON_PERFORMED_CHANNEL_BRIDGE.test(match[1]??'')||otherActorClause((match[1]??'')+(match[2]??''))||!CHANNEL_CONTACT_OBJECT_HEAD.test(match[3]!.trim())||!/^(?:$|[，。；！？]|但|并|而|却|然后|后来|随后|接着)/.test(match[5]!))return false
 const prefix=text.slice(0,match.index+match[0].length-match[5]!.length)
 return !CHANNEL_CONTACT_NOT_COMPLETED.test(prefix)
}
const reportsExplicitCompletedChannelContact=(text:string)=>reportsVerbPerfectiveChannelContact(text)||reportsObjectFinalChannelContact(text)
// Direction complements need an explicit perfective marker, but they do not
// require a named channel. Keep this separate from the broad action lexicon so
// `我把报告发给导师` remains unperformed while both natural 了 positions work.
const OWNED_SEND_METHOD_PREFIX='(?:(?:按照|根据|依照|按(?!照))[^，。；！？]{1,24}?(?:的)?(?:要求|建议|安排|指导|方法|模板|方案|步骤|规则|材料|流程|标准)(?:，|,)?\\s*)?'
const COMPLETED_OBJECT_SEND=new RegExp(`^(?:我|本人)(?:(?:已经|实际|今天|昨天|刚刚|之前|只)\\s*)*${OWNED_SEND_METHOD_PREFIX}(?:把|将)[^，。；！？]{1,40}(?:发(?:出去|过去|到)(?:了|过)|(?:发|发送)给(?:了[^，。；！？]{1,16}|[^，。；！？]{1,16}(?:了|过)))[。！!？?]?$`)
const EXPLICIT_PAST_OBJECT_SEND=new RegExp(`^(?:我|本人)(?:已经|已|实际|昨天|前天|上周|刚刚|刚才|之前|此前)\\s*${OWNED_SEND_METHOD_PREFIX}(?:把|将)[^，。；！？]{1,40}(?:发(?:出去|过去|到)|(?:发|发送)给[^，。；！？]{1,16})[。！!？?]?$`)
const OBJECT_SEND_PRECONDITION=/(?:发|发送)[^，。；！？]{0,24}(?:之前|前(?!端|提|景|沿|排|台|门|置|半|线|往|期|辈|任|人|者|天|年|月|周))(?:$|[^，。；！？]{0,12}(?:需要|还需|要|得|必须|应该|应当|先))/
const reportsExplicitPastObjectSend=(text:string)=>EXPLICIT_PAST_OBJECT_SEND.test(text)
  &&!CHANNEL_CONTACT_NOT_COMPLETED.test(text)
  &&!/(?:失败|未成功|没(?:有)?成功|取消|撤销|停止|中止|终止|应该|应当|可以|能够|可能|也许|或许)/.test(text)
  &&!OBJECT_SEND_PRECONDITION.test(text)
  &&!trailingOtherPerformer(text)
const PERFORMED_ACTIVITY=/(?:打|练|跑|游|骑|踢|逛|聊)(?:了|过)/
const COMPLETED_PROCESS=/(?:标注|标记|整理|核对|检查|分析|统计|清洗|可视化)(?:了|过|完|好|出来|完成)/
const INDEPENDENT_COORDINATED_SELF_ACTION=new RegExp(`^(?:否认|澄清|反驳)(?:了)?[^，。；！？]{1,24}并(?:且)?(?:独立|亲自)?(?:${COMPLETED_ACTION.source}|${COMPLETED_PROCESS.source})`)
// A bounded artifact-subject construction, not arbitrary text before 是我.
// Uncertainty/adverb predicates are outside this structural fallback grammar.
const OWNED_PAST_ARTIFACT=/^(?:(?:上周|上月|上个月|昨天|前天|今天)(?:的)?)?(?:(?:这|那)(?:个|份|张|套)|我的)?(?:课程表|报名表|问卷|材料|报告|文章|方案|作业|代码|设计稿)是(?:我|本人)(?:亲自|独自)?(?:整理|制作|设计|撰写|填写|修改)的$/
const FELT_RESULT=/(?:觉得|感到|仍然|依然|还是|仍是)(?:很|更|比较|有点|不再|并不|不)?(?:轻松|放松|开心|舒服|自在|紧张|难过|失落|疲惫|累)/
// “交付范围” names an action but “想先确认” has not performed it.
// Shared by the structural fallback and the actual candidate persistence gate.
export const clauseExpressesWishToAct=(text:string):boolean=>/(?:想|要)(?:先|去|尝试|试试|交付|提交|上线|发布|确认|核对|了解)|^(?:先|请|帮我)(?:确认|核对|交付|提交|上线|发布|了解)|(?:只想|就想)(?:聊|说|倾诉|吐槽)/.test(text)
// Keep future-action words scoped to an actual plan statement. Bare keyword
// matching made nouns such as `培养计划` and `采用其中建议` look like an
// unperformed action, which could reject an otherwise completed experience.
const personalFutureView=(text:string)=>personalReportBody(text).replace(/^(?:在|于)[^，。；！？]{1,32}(?=(?:我|我们|本人))/,'')
const contextualFutureAction=(text:string):boolean=>{
  const body=personalFutureView(text).replace(/^(?:(?:现在|目前|之后|接下来|下一步|这周|本周|下周)\s*)+(?=(?:我|我们|本人))/,'')
  const match=/^(我|我们|本人)([^，。；！？]*?)(将|会)(?!不|没|未)(?:再|先|去)?(?:联系|请教|询问|发|发送|提交|交付|完成|做|写|整理|核对|验证|尝试|开始|参加|投递)/.exec(body)
  if(!match)return false
  if(match[2]&&clauseReportsCompleted(match[1]!+match[2]!))return false
  if(match[3]==='会'&&/^(?:了|过)(?!再|才|后)/.test(body.slice(match[0].length)))return false
  return match[3]!=='会'||!/(?:学会|开会|教会|体会|协会|工会|班会|学生会|委员会|团委会|领会|展会|峰会|年会|招聘会|发布会|运动会|研讨会)$/.test(match[2]+'会')
}
const explicitNextStepPlan=(text:string):boolean=>{
  const body=personalReportBody(text)
  const marker=/(?:是|作为)下一步(?:$|[。！？])/.exec(body)
  if(marker&&completedOwnedAspectBefore(body,marker.index))return false
  return Boolean(marker)
    ||/^(?:我|我们|本人)?(?:(?:现在|目前|接下来|之后|先|再)\s*){0,3}下一步(?:(?:是|要|会|将|打算|计划|准备|先|再|去)\s*){0,3}(?:联系|请教|询问|发|发送|提交|交付|完成|做|写|整理|核对|尝试|开始|参加|投递|暂停|停止)/.test(body)
}
const trailingPlanDeclaration=(text:string):boolean=>{
 const body=text.trim(),match=/(?:是|属于)(?:我(?:的)?|本人(?:的)?)?[^，。；！？]*?(?:计划|准备|打算)(?:之一)?[。！？]?$/.exec(body)
 if(!match)return false
 const rawPrefix=body.slice(0,match.index),completedPrefix=rawPrefix.replace(/的$/,'')
 // In a trailing plan declaration, an uninflected completion predicate names
 // the planned outcome; it is not proof that the outcome already happened.
 // Keep the explicit cleft `我完成的是...` and perfective forms completed.
 const uninflectedPlannedPredicate=!rawPrefix.endsWith('的')&&/(?:完成|交付|上线|发布|搞定)(?!了|过|完|好)/.test(completedPrefix)
 return !completedPrefix||uninflectedPlannedPredicate||!clauseReportsCompleted(completedPrefix)
}
const nominalPlannedOutcome=(text:string):boolean=>{
 const body=personalFutureView(text)
 const action='(?:完成|提交|交付|上线|发布|做|写|整理|核对)(?!了|过|完|好)'
 const actor='(?:我|我们|本人)(?:(?:现在|目前|还|已经|只是|只有)\\s*)*'
 const barePossessivePlan=new RegExp(`^${actor}${action}(?!的是|的属于)[^，。；！？]*?的(?:计划|打算|安排)(?:之一)?(?:$|[，。；！？])`).test(body)
 return barePossessivePlan||new RegExp(`^${actor}(?:(?:有|还有)(?:(?:一|这|那)(?:个|项|份|套))?[^，。；！？]{0,16}${action}[^，。；！？]{0,20}(?:的)?(?:计划|打算|安排)(?:之一)?(?:$|[，。；！？])|(?:的)?(?:计划|打算|安排)(?:是|包括)(?:先|再|去)?${action})`).test(body)
}
const cancelledPlanDeclaration=(text:string):boolean=>{
 const matches=[
  /(?:计划|打算|安排|想法|设想|提议)(?:(?:已经|已|后来|最终)?被?)?(?:取消|撤销|暂停|搁置|放弃|否决|拒绝)(?:了|过)?/.exec(text),
  /(?:取消|撤销|暂停|搁置|放弃|否决|拒绝)(?:了|过)?[^，。；！？]{0,24}(?:计划|打算|安排|想法|设想|提议)/.exec(text),
 ].filter((match):match is RegExpExecArray=>match!==null)
 return matches.some(match=>!clauseReportsPastAction(text.slice(0,match.index)))
}
const activePlanDeclaration=(text:string):boolean=>{
  const body=text.trim(),match=/(?:计划|打算|安排)(?:(?:仍然|依然|目前|现在|还|继续|一直)\s*)*(?:有效|保留|不变|未变|存在|进行中|待执行|尚未执行|未执行)[。！？]?$/.exec(body)
 if(!match)return false
  // Preserve any real completed outer audit; the plan declaration itself lacks
  // evidence only when it is the sentence predicate, not an audited object.
  return !completedOwnedAspectBefore(body,match.index)
}
function completedOuterPlanAudit(text:string):boolean{
  const marker=/(?:是|作为)下一步(?:$|[。！？])|(?:计划|打算|安排)(?:(?:仍然|依然|目前|现在|还|继续|一直)\s*)*(?:有效|保留|不变|未变|存在|进行中|待执行|尚未执行|未执行)[。！？]?$/.exec(text.trim())
  return Boolean(marker&&completedOwnedAspectBefore(text,marker.index))
}
const bareFutureModal=(text:string):boolean=>{
  const body=personalFutureView(text).replace(/^(?:(?:现在|目前|之后|接下来|下一步|这周|本周|下周)\s*)+(?=(?:我|我们|本人))/,'')
  if(/^(?:我|我们)(?:(?:现在|目前|还|仍|仍然|也|之后|接下来|一定|可能|也许|大概|应该|就|再|先)\s*){0,3}会(?:前|后|中)/.test(body))return false
  if(/^(?:我|我们)(?:(?:现在|目前|还|仍|仍然|也|之后|接下来|一定|可能|也许|大概|应该|就|再|先)\s*){0,3}会(?:签|见|审|诊|商|谈)(?:了|过|完|好)/.test(body))return false
  return /^(?:我|我们)(?:(?:现在|目前|还|仍|仍然|也|之后|接下来|一定|可能|也许|大概|应该|就|再|先)\s*){0,3}(?:将|会)(?!不|没|未)(?:再|先|去)?(?:联系|请教|询问|发|发送|提交|交付|完成|做|写|整理|核对|验证|尝试|开始|参加|投递|分析|统计|制作|设计|检查|签|见|跑|练)/.test(body)
}
const timedFutureModal=(text:string):boolean=>{
  const body=personalFutureView(text)
  if(!/^(?:我|我们|本人)/.test(body))return false
  const match=/(?:将|会)(?:于|在)[^，。；！？]{0,16}?(?:联系|请教|询问|发|发送|提交|交付|完成|做|写|整理|核对|验证|尝试|开始|参加|投递|分析|统计|制作|设计|检查|签|见|跑|练)/.exec(body)
  if(!match)return false
  const prefix=body.slice(0,match.index)
  return !clauseReportsCompleted(prefix)
}
const preparationDescribesState=(text:string):boolean=>/^(?:我|我们|本人)?[^，。；！？]{0,24}?准备(?:不(?:足|够|充分|周全|好)|不足|不够|充分|充足|周全|就绪|妥当)(?=$|但|并|且|而|、|，|。|；|！|？)/.test(personalReportBody(text))
const planWordSegmenter=new Intl.Segmenter('zh',{granularity:'word'})
const completedPlanAspectWords=new Set(['了','过','完'])
const coordinatedPlanWords=new Set(['并','并且','且','同时'])
const relativePlanWithPerfectiveOutcome=(body:string,actor:string):boolean=>{
  if(!/(?:后|之后|以后)(?:再|就|然后)?[^，。；！？]{1,32}的(?:计划|安排)$/.test(body))return false
  const words=[...planWordSegmenter.segment(body)]
  let temporalIndex=-1
  for(let index=words.length-1;index>=0;index--)if(['后','之后','以后'].includes(words[index]!.segment)){temporalIndex=index;break}
  if(temporalIndex<2)return false
  let aspectIndex=-1
  for(let index=temporalIndex-1;index>=0;index--)if(completedPlanAspectWords.has(words[index]!.segment)){aspectIndex=index;break}
  if(aspectIndex<1)return false
  const outcome=words[aspectIndex-1]
  if(!outcome||outcome.index<actor.length)return false
  const outerPrefix=body.slice(actor.length,outcome.index)
  return !clauseReportsPastAction(actor+outerPrefix)
}
const contextualPlanAction=(text:string):boolean=>{
  const body=personalFutureView(text)
  if(preparationDescribesState(body))return false
  const actor=/^(?:我们|本人|我)/.exec(body)
  if(!actor)return false
  // A standalone possession statement introduces the plan whose outcome may
  // follow after a comma; it is not a performed-action owner for that outcome.
  if(/^(?:我们|本人|我)(?:现在|目前)?有(?:一(?:个|份)|个)?[^，。；！？]{0,16}(?:计划|安排)$/.test(body))return true
  if(relativePlanWithPerfectiveOutcome(body,actor[0]))return true
  const relativePlan=/^(?:我们|本人|我)([^，。；！？]{0,32}?)(?:(?:在|于)\s*)?(?:完成|做完|写完|提交|交付|整理|核对|联系|参加|访谈|采访)(?:了|过|完(?:了)?|好(?:了)?)?[^，。；！？]{0,32}(?:后|之后|以后)(?:再|就|然后)?[^，。；！？]{1,32}的(?:计划|安排)$/.exec(body)
  if(relativePlan&&!clauseReportsPastAction(actor[0]+(relativePlan[1]??'')))return true
  for(const marker of body.matchAll(/计划|准备/g)){
    const index=marker.index
    if(index===undefined||index<actor[0].length)continue
    const before=body.slice(0,index),tail=body.slice(index+marker[0].length)
    if(/^(?:完(?:了)?(?!成)|好(?:了)?(?!好))(?:(?:在|于)\s*)?(?:明天|后天|下周|下月|下个月|明年|下学期|以后|接下来)[^，。；！？]{1,48}/.test(tail))return true
    const nominalTail=!tail||/^(?:了|过|完(?:了)?(?!成)|好(?:了)?(?!好)|完成了|的|表|书|方案|材料|工作|事项|阶段|过程|情况)/.test(tail)
      ||/^(?:(?:完成|执行|落实|实施|推进|调整|变更)?(?:情况|状态|进度|结果|风险|影响|记录|程度|问题|原因))(?=$|并|且|同时)/.test(tail)
    if(nominalTail||/^(?:并(?:且)?|且|同时)/.test(tail))continue
    const governedFuturePerfect=/^(?:(?:在|于)\s*)?(?:先|再|去)?(?:完成|做完|写完|提交|交付|整理|核对|联系|参加|访谈|采访)(?:了|过|完(?:了)?|好(?:了)?)?[^，。；！？]{0,32}(?:后|之后|以后)(?:再|就|然后)?[^，。；！？]{1,32}$/.test(tail)
    if(governedFuturePerfect&&!clauseReportsPastAction(before))return true
    const immediateTail=tail.split(/并(?:且)?|且|同时/,1)[0]??''
    if(immediateTail&&clauseReportsPastAction(immediateTail))continue
    const beforeWords=[...planWordSegmenter.segment(before.slice(actor[0].length))]
      .map(part=>part.segment.trim()).filter(Boolean)
    const completedOuter=beforeWords.some(word=>completedPlanAspectWords.has(word))
    const lastBefore=beforeWords.at(-1)??''
    const sequenceBefore=futureSiblingSequenceBefore(body,index)
      ||coordinatedPlanWords.has(lastBefore)&&!nominalizedFuturePlan(marker[0]+tail)
    if(completedOuter&&!sequenceBefore)continue
    return true
  }
  return false
}
const ongoingPreparationForAction=(text:string):boolean=>{
  const body=personalFutureView(text)
  return /^(?:我|我们|本人)(?:(?:现在|目前|还|仍然?|正(?:在)?|在)){1,4}(?:做|进行|开展)(?:完成|做完|写完|提交|交付|整理|核对|联系|参加|访谈|采访)[^，。；！？]{0,32}的准备(?:工作)?$/.test(body)
}
const proposedFutureAction=(text:string):boolean=>{
  const body=personalFutureView(text)
  if(!/^(?:我|我们|本人)/.test(body))return false
  // 拟/预计 are prospective only when they govern an action. Excluding lexical
  // compounds such as 模拟/草拟 keeps completed outer work available.
  const match=/(?<![模比草虚])(?:拟|预计)(?:于|在)?[^，。；！？]{0,16}?(?:联系|请教|询问|发布|上线|发|发送|提交|交付|完成|做|写|整理|核对|验证|尝试|开始|参加|投递)/.exec(body)
  if(!match)return false
  const prefix=body.slice(0,match.index)
  return !prefix||!clauseReportsCompleted(prefix)
}
const consideredFutureAction=(text:string):boolean=>{
  const body=personalFutureView(text)
  // 考虑 is prospective only when it directly governs an action, optionally
  // through a bounded time/method phrase.  Its prelude is structural rather
  // than an adverb list: any non-completed first-person prelude is allowed,
  // while a completed outer action before 考虑 remains independently usable.
  return governedConsiderationIndexes(body).some(index=>{
    const prefix=body.slice(0,index)
    return /^(?:我|我们|本人)/.test(prefix)&&!completedOwnedAspectBefore(body,index)&&!clauseReportsCompleted(prefix)
  })
}
const capabilityOnlyAction=(text:string):boolean=>{
  const body=personalFutureView(text)
  const action='(?:联系|请教|询问|发送|发|提交|交付|完成|做|写|整理|核对|验证|尝试|开始|参加|投递|分析|统计|制作|设计|检查)'
  const strong=new RegExp(`(?:能够|可以)(?:再|先|去)?${action}`).exec(body)
  const bare=new RegExp(`(?:^|我|本人|我们|现在|目前|之前|以后|还|仍|也|就|一定|可能|大概|邮箱|邮件|微信|电话|短信|系统|平台|网站|表单|渠道)(能(?:再|先|去)?${action})`).exec(body)
  if(!strong&&!bare)return false
  const index=strong?.index??bare!.index+bare![0].length-bare![1]!.length
  const prefix=body.slice(0,index)
  const modalLength=(strong?.[0]??bare![1]!).length,relativeEnd=body.indexOf('的',index+modalLength)
  // In a 把/将 construction, capability can describe the object while a
  // later perfective predicate reports the user's actual outer action.
  if(relativeEnd>=0&&/^(?:我|本人|我们)(?:(?:已经|实际|刚才|之前|昨天|今天)\s*)*(?:把|将)[^，。；！？]*$/.test(prefix)&&clauseReportsPastAction(body.slice(relativeEnd+1)))return false
  return !clauseReportsCompleted(prefix)
}
const ambiguousBarePlanSibling=(text:string):boolean=>{
  const match=/并(?:计划|准备)/.exec(text)
  return Boolean(match&&futureSiblingConjunctionAt(text,match.index))
}
const leadingPlanAction=(text:string):boolean=>{
  const body=personalFutureView(text)
  if(preparationDescribesState(body))return false
  if(/^(?:我|我们|本人)?准备(?:工作|事项|阶段|过程|情况)[^，。；！？]{0,16}(?:完成了|做完了|结束了)/.test(body))return false
  // A perfective marker inside the outcome of an ongoing plan is relative to
  // that future plan, not evidence that the user already performed it.
  if(/^(?:我|我们|本人)(?:(?:正(?:在)?|在))?(?:计划|准备)(?:先|再|去)?(?:完成|做完|写完|提交|交付|整理|核对|联系|参加|访谈|采访)(?:了|过|完(?:了)?|好(?:了)?)?[^，。；！？]{0,32}(?:后|之后|以后)[^，。；！？]{1,32}$/.test(body))return true
  return /^(?:(?:我|我们|本人)(?:(?:现在|目前|还|仍|仍然|也|之后|接下来|一定|可能|也许|大概|应该|就|再|先)\s*){0,3})?(?:(?:正(?:在)?|在)\s*)?(?:计划|准备)(?!了|过|完(?:了)?(?!成)|好(?:了)?(?!好)|的|表|书|方案|材料)/.test(body)
}
const deonticFutureAction=(text:string):boolean=>{
  const body=personalFutureView(text)
  const match=/^(?:我|我们|本人)([^，。；！？]*?)(?:应该|需要|必须|本来要|原本要|得)(?:再|先|去)?(?:联系|请教|询问|发|发送|提交|交付|完成|做|写|整理|核对|验证|尝试|开始|参加|投递)/.exec(body)
  if(!match)return false
  return ![COMPLETED_ACTION,COMPLETED_PROCESS,DEFINED_ARTIFACT,PERFORMED_ACTIVITY].some(pattern=>pattern.test(match[1]!))
}
const objectFrontedFutureCompletion=(text:string):boolean=>{
  const body=personalFutureView(text),actor=/^(?:我|我们|本人)/.exec(body)
  if(!actor)return false
  const marker=body.indexOf('将',actor[0].length)
  if(marker<0)return false
  const prefix=body.slice(actor[0].length,marker)
  // 已经/实际 supplies independent completion authority. Without that or a
  // final 了/过, `将 + object + 完成/做完` is still prospective: 将 can be a
  // future auxiliary even when an object intervenes before the action.
  const independentCompletion=/(?:已经|已|实际|确实|刚刚|刚才|昨天|前天|上周|之前)/
  if(new RegExp(`^${independentCompletion.source}(?!的)`).test(prefix)||new RegExp(`${independentCompletion.source}\\s*$`).test(prefix)||clauseReportsPastAction(actor[0]+prefix))return false
  const tail=body.slice(marker+1).trim().replace(/[。！？!?]+$/,'')
  if(!tail||/(?:了|过)$/.test(tail))return false
  const terminal=[COMPLETED_ACTION,COMPLETED_PROCESS,DEFINED_ARTIFACT,PERFORMED_ACTIVITY,...SKILL_ACTION_LEXICON.map(entry=>entry.action)]
    .map(pattern=>pattern.exec(tail)).filter((match):match is RegExpExecArray=>match!==null)
    .some(match=>match.index+match[0].length===tail.length)
  return terminal
}
export const clauseExpressesFuturePlan=(text:string):boolean=>
  /(?:打算|希望|将要|下次|明天|后天|以后)/.test(text)
  ||explicitNextStepPlan(text)
  ||trailingPlanDeclaration(text)
  ||nominalPlannedOutcome(text)
  ||cancelledPlanDeclaration(text)
  ||activePlanDeclaration(text)
  ||ongoingPreparationForAction(text)
  ||contextualPlanAction(text)
  ||proposedFutureAction(text)
  ||consideredFutureAction(text)
  ||capabilityOnlyAction(text)
  ||ambiguousBarePlanSibling(text)
  // Bare future modals are not proof of execution. This also deliberately
  // keeps an ambiguous ability claim (「我会整理」) out of completed evidence.
  ||bareFutureModal(text)
  ||timedFutureModal(text)
  ||contextualFutureAction(text)
  ||objectFrontedFutureCompletion(text)
  ||leadingPlanAction(text)
  ||deonticFutureAction(text)
  ||/(?:^|[，。；！？\n])(?:我|我们)?建议(?:先|去|做|把|联系|确认|核对|提交|交付|尝试|试试)/.test(text)
  ||clauseExpressesWishToAct(text)
// First person scopes the whole sentence: the action clause itself often
// drops the pronoun (「迟了一天补交上去」) while a sibling clause carries it.
export const sentenceIsFirstPersonPublic = (catalogue: readonly ClauseHandle[], handle: ClauseHandle): boolean =>
  catalogue.some(other => other.sentenceStart === handle.sentenceStart && !other.interrogative&&!other.conditional&&!other.attributedToOther&&/我/.test(unprotectedClauseText(other)))
const directOpenOtherChannelFailure=(text:string):boolean=>{
 let view=text.trim().replace(/^(?:(?:又|后来|随后|然后|接着|当场|最终|实际)\s*)+/,'')
 view=view.slice(leadingActionTimeLength(view)).trim()
 view=view.replace(/^(?:这次|本次|此次)\s*/,'')
 const match=/^([^，。；！？]{1,20}?)(?:发送|发出|提交|联系|请教|询问|发(?!现|展|生|挥|育))[^，。；！？]{0,24}(?:失败(?:了)?|未成功|没(?:有)?成功|未发出|没(?:有)?发出)(?:$|[，。；！？])/.exec(view)
 const actor=match?.[1]?.trim()
 return Boolean(actor&&!/^(?:因为|因|由于)|(?:导致|造成|使)$/.test(actor)&&openHumanOtherActor(actor))
}
function channelActionRevokedBySibling(catalogue:readonly ClauseHandle[],handle:ClauseHandle):boolean{
 const body=unprotectedClauseText(handle),source=PAST_CHANNEL_CONTACT.exec(body),pastObjectSend=reportsExplicitPastObjectSend(body)
 if(!source&&!pastObjectSend||reportsExplicitCompletedChannelContact(body)||COMPLETED_OBJECT_SEND.test(body))return false
 const sourceKind=channelActionKind(source?.[2]??finalChannelAction(body)??'')
 const temporal=/(?:时|过程中|过程里|期间)$/.test(body)
 const nextSentenceStart=catalogue.find(next=>next.sentenceStart>handle.sentenceStart)?.sentenceStart
 return catalogue.some(next=>next.start>handle.end&&(next.sentenceStart===handle.sentenceStart||next.sentenceStart===nextSentenceStart)&&!next.quoted&&!next.code&&!next.conditional&&!next.interrogative&&(()=>{
   const nextBody=unprotectedClauseText(next),crossesSentence=next.sentenceStart!==handle.sentenceStart
   if(otherActorClause(nextBody,{allowOmittedSubject:true})||directOpenOtherChannelFailure(nextBody))return false
   const cancellation=/^(?:我|本人)?(?:又|后来|随后|然后|接着|当场|最终|实际)?(?:取消|撤销|停止|中止|终止|放弃|打断|中断)(?:了)?(?:这次|本次)?(发送|发出|发(?!现|展|生|挥|育)|提交|联系|请教|询问|操作|动作)(?:[^，。；！？]{1,24})?(?:$|[，。；！？])/.exec(nextBody)
   const temporalConnector=/^(?:我|本人)?(?:又|后来|随后|然后|接着|当场|最终|实际)/
   const sentenceTemporalBridge=crossesSentence&&catalogue.some(prior=>prior.start>handle.end&&prior.start<next.start&&prior.sentenceStart===next.sentenceStart&&!prior.quoted&&!prior.code&&!prior.conditional&&!prior.interrogative&&temporalConnector.test(unprotectedClauseText(prior)))
   const timeMarker=(value:string)=>/(?:^|我|本人)(今天|昨天|前天|上周|本周|这周|刚才|刚刚)/.exec(value)?.[1]?.replace('本周','这周')
   const sourceTime=timeMarker(body),nextTime=timeMarker(nextBody)
   const repeatedAttempt=/^(?:(?:后来|随后|然后|接着)\s*)?(?:(?:今天|昨天|前天|上周|本周|这周|刚才|刚刚)\s*)?(?:我|本人)?(?:(?:今天|昨天|前天|上周|本周|这周|刚才|刚刚)\s*)?(?:又|再次|重新)/.test(nextBody)
   const distinctOccurrence=repeatedAttempt||Boolean(sourceTime&&nextTime&&sourceTime!==nextTime)
   const linkedOccurrence=(temporal||!crossesSentence||temporalConnector.test(nextBody)||sentenceTemporalBridge)&&!distinctOccurrence
   const attributionHead=/^(?:(?:后来|随后|然后|接着|最终|实际)\s*)?(?:(?:这|该|本)(?:件事|项工作|次操作|项任务))?由/.test(nextBody)
   const deicticAttribution=/^(?:(?:后来|随后|然后|接着|最终|实际)\s*)?(?:这|该|本)(?:件事|项工作|次操作|项任务)由/.test(nextBody)
   const attributionMatches=trailingOtherPerformer(nextBody)&&attributionHead&&(linkedOccurrence||crossesSentence&&!distinctOccurrence&&deicticAttribution)
   const linkedCancellation=linkedOccurrence
   const cancellationMatches=Boolean(cancellation&&linkedCancellation&&(['操作','动作'].includes(cancellation[1]!)?!crossesSentence&&temporal:channelActionKind(cancellation[1]!)===sourceKind))
   const failed=!negatedChannelFailure(nextBody)&&/(?:失败(?:了)?|未成功|没(?:有)?成功|未发出|没(?:有)?发出)(?:$|[，。；！？])/.test(nextBody)
   const failureActions=[...nextBody.matchAll(/发送|发出|提交|联系|请教|询问/g)].map(match=>match[0])
   const bareFailure=/^(?:我|本人)?(?:又|后来|随后|然后|接着|当场|最终|实际)?(?:(?:因为|因|由于)[^，。；！？]{1,24}?)?(?:这次|本次|此次)?(发)(?!现|展|生|挥|育)[^，。；！？]{0,24}(?:失败(?:了)?|未成功|没(?:有)?成功|未发出|没(?:有)?发出)(?:$|[，。；！？])/.exec(nextBody)?.[1]
   if(bareFailure)failureActions.push(bareFailure)
   const failureMatches=Boolean(failed&&linkedOccurrence&&failureActions.length&&channelActionKind(failureActions.at(-1)!)===sourceKind)
   const deniedKind=negatedChannelActionKind(nextBody)
   const linkedDenial=(!crossesSentence||temporalConnector.test(nextBody)||/^(?:我|本人)?(?:所以|因此|因而|于是|故而)/.test(nextBody)||sentenceTemporalBridge)&&!distinctOccurrence
   const denialMatches=Boolean(deniedKind&&linkedDenial&&deniedKind===sourceKind)
   return attributionMatches||cancellationMatches||failureMatches||denialMatches
  })())
}
function completedInContext(catalogue:readonly ClauseHandle[],handle:ClauseHandle):boolean{
 if(otherActorClause(unprotectedClauseText(handle)))return false
  if(channelActionRevokedBySibling(catalogue,handle))return false
 const prefix=catalogue.filter(c=>c.sentenceStart===handle.sentenceStart&&c.end<=handle.start).map(unprotectedClauseText).join('、')
 // List punctuation does not end a negation. An explicit contrast/new report does.
 const tail=prefix.split(/但是|但|不过|然而|实际上/).at(-1)??''
 return !/(?:(?:不代表|不等于|不要假设)|(?:没有|并未|尚未)(?:接受|执行|完成|开始|做|尝试))[^。！？]{0,60}$/.test(tail)&&clauseReportsCompleted(unprotectedClauseText(handle))
}

// One contribution view for extraction, categories and skill projections.
// A later first-person clause cannot retroactively own an earlier teammate's
// action; omitted subjects inherit only the preceding owned clause.
export function personalContributionClauses(catalogue:readonly ClauseHandle[]):ClauseHandle[]{
  const owned:ClauseHandle[]=[]
  let ownerSentence=-1
  for(const clause of catalogue){
    const sourceBody=unprotectedClauseText(clause)
    if(clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.attributedToOther&&!methodOwnedInstructionClause(sourceBody)){
      if(clause.attributedToOther)ownerSentence=-1
      continue
    }
    const body=personalActionText(sourceBody)
    if(body===null){ownerSentence=-1;continue}
    const selfMatch=firstPersonalActor(body)
    const rest=selfMatch?personalReportBody(body).slice(selfMatch[0].length):''
    const predicate=rest.replace(/^(?:(?:刚刚|刚才|方才|昨晚|昨天|前天|今天|今日|(?:上|本|这)(?:周|星期|月|学期|季度|年度|年)|上个月|当时|这次|最近一次|近期|还|已经|曾经|实际|亲自|独自|只|先)\s*)+/,'')
    const assistedSelf=assistedSelfPerformanceClause(body)
    const self=Boolean(selfMatch&&(clauseReportsCompleted(body)||clauseReportsAttempted(body)||SKILL_ACTION_LEXICON.some(entry=>entry.action.exec(predicate)?.index===0)||OWNED_CONTACT_FORM.test(body)||OWNED_CHANNEL_CONTACT.test(body)||[COMPLETED_ACTION,COMPLETED_PROCESS,DEFINED_ARTIFACT,PERFORMED_ACTIVITY].some(pattern=>pattern.exec(predicate)?.index===0)||INDEPENDENT_COORDINATED_SELF_ACTION.test(predicate)||/^(?:安排|规划|协调|组织)(?:了)?[^，。；！？]{1,32}并(?:且)?(?:又|再)?(?:完成|做完|写完|整理|核对|提交|交付)(?:了|完|好)/.test(predicate)||/^(?:是|有|没|不|想|希望|能|会|学会|打算|准备|负责|把|将|用|借助|按照|按|照着|参考|给|向|跟|和|与|在|自己|也|又|独立|参与|协助|约好|辅导|翻译)/.test(predicate)))
    const joint=jointPersonalActorClause(body)
    const cancelledOwnedPlan=Boolean(selfMatch&&cancelledPlanDeclaration(body))
    const explicitOwner=self||joint||assistedSelf||cancelledOwnedPlan||OWNED_PAST_ARTIFACT.test(body)
    if(explicitOwner){
      // An explicit first-person plan remains a useful reported fact, but it
      // cannot lend performed-action ownership to a later omitted subject.
      // Keep those two questions separate: inclusion here, inheritance below.
      ownerSentence=clauseExpressesFuturePlan(body)&&!cancelledPlanDeclaration(body)?-1:clause.sentenceStart
      if(!actionEvidenceUnavailable(body))owned.push(clause)
      continue
    }else{
      // Omitted subjects inherit only a predicate, not an arbitrary noun
      // followed by a past verb (which may introduce another performer).
      const sequencedObjectContinuation=/^(?:随后|然后|接着|再|又|也)(?:把|将)/.test(body)
      const predicate=body.replace(/^(?:(?:随后|然后|接着|但是|不过|然而|但|再|又|也|只|才|已经|实际|自己|当时))+/,'')
      const verbFirst=[COMPLETED_ACTION,COMPLETED_PROCESS,DEFINED_ARTIFACT,PERFORMED_ACTIVITY,...SKILL_ACTION_LEXICON.map(entry=>entry.action)].some(pattern=>pattern.exec(predicate)?.index===0)
      const ownedMethodInstruction=methodOwnedInstructionClause(predicate)
      const ownedContinuation=ownerSentence===clause.sentenceStart
        &&(sequencedObjectContinuation||/^(?:(?:改|做|写|整理|核对|检查|标注|处理)完后(?:又|再)?(?:用|把|将|按|照着|参考)|(?:用|借助|按照|按|照着|参考|发现|识别|找出|标注|绘制|绘图|分析|核对|整理|检查|统计))/.test(predicate))
        &&(ownedMethodInstruction||!otherActorClause(predicate,{allowOmittedSubject:true}))
      if(!verbFirst&&!ownedContinuation&&!/^约好/.test(predicate)&&!reportsPastFeeling(body)){ownerSentence=-1;continue}
    }
    if(ownerSentence===clause.sentenceStart&&!actionEvidenceUnavailable(body))owned.push(clause)
  }
  return owned
}
export function personalActionClauses(catalogue:readonly ClauseHandle[]):ClauseHandle[]{
  return personalContributionClauses(catalogue).filter(clause=>completedInContext(catalogue,{...clause,text:personalActionText(unprotectedClauseText(clause))!}))
}

// A perception/delegation prefix is not the performed contribution. Keep the
// source clause intact; this view is only used by contribution projections.
export function personalActionText(text:string):string|null{
  const body=text.trim()
  const passiveRelativeAt=passiveRelativeObjectStart(body)
  if(passiveRelativeAt>0){
    const outer=body.slice(0,passiveRelativeAt),relative=body.slice(passiveRelativeAt)
    const continuation=[...relative.matchAll(/并且|并|同时|然后|随后|接着|又|再/g)].find(match=>clauseReportsCompleted('我'+relative.slice(match.index!+match[0].length)))
    if(clauseReportsCompleted(outer))return outer+(continuation?relative.slice(continuation.index!):'')
    const objectFinalAspect=/([了过])$/.exec(body)?.[1]
    return objectFinalAspect&&clauseReportsCompleted(outer+objectFinalAspect)?outer+objectFinalAspect:null
  }
  if(trailingOtherPerformer(personalReportBody(body)))return null
  const observed=/^((?:我|本人)(?:看到|看见)[^，。；！？]{1,50})后([^，。；！？]+)$/.exec(body)
  if(observed){
    const explicitOther=explicitObservedOtherPerformanceClause(observed[1]!),selfSuffix=/^(?:我|本人|我们)(?!的)/.test(observed[2]!)
    return explicitOther?(selfSuffix?observed[2]!:null):selfSuffix?observed[2]!:"我"+observed[2]!
  }
  const outerRecord=ownedOuterRecordAction(body)
  return outerRecord??(otherActorClause(body)?null:body)
}

// 对既往经历的追述（上次那套海报后来…）：本身没有新的完成动词，但带着
// 结果/反馈分句时，应作为候选走相似度合并进原经历。
const BACK_REFERENCE = /上次那|上次说|上次提到|之前那次|之前说的|那件事|刚才说的|后来/
export function requiresExperienceCandidate(catalogue: readonly ClauseHandle[]): boolean {
  if(profileWritesDisallowed(catalogue.map(c=>c.text).join('。')))return false
  if (personalActionClauses(catalogue).length) return true
  const bySentence = new Map<number, ClauseHandle[]>()
  for (const handle of catalogue) {
    const group = bySentence.get(handle.sentenceStart) ?? []
    group.push(handle)
    bySentence.set(handle.sentenceStart, group)
  }
  for (const handles of bySentence.values()) {
    const text = handles.filter(handle=>!conversationPreferenceClause(handle.text)).map(unprotectedClauseText).join()
    if (BACK_REFERENCE.test(text) && handles.some(handle => !handle.attributedToOther&&!handle.quoted&&!handle.code&&/上次那|上次说|上次提到|之前那次|之前说的|那件事|刚才说的/.test(unprotectedClauseText(handle))) && handles.some(handle => !conversationPreferenceClause(handle.text)&&RESULT_SHAPE.test(unprotectedClauseText(handle))) && handles.every(handle => !handle.interrogative && !handle.conditional)) return true
  }
  return false
}

// A past first-person/shared activity followed by a felt result is also an
// experience. It needs neither a deliverable nor an external evaluator.
const reportsPastFeeling=(text:string):boolean=>/^(?:(?:我|本人)(?:昨晚|昨天|前天|上周|上次)|(?:昨晚|昨天|前天|上周|上次)(?:我|本人|和|跟))[^。！？]{1,60}(?:后|结束时)(?:我)?(?:觉得|感到)/.test(text)
  &&!clauseExpressesFuturePlan(text)&&!/(?:如果|假如|没|未|不)/.test(text.split(/后|结束时/)[0]!)

export function actionEvidenceUnavailable(text:string,selectedAction?:string):boolean{
  const performed=[COMPLETED_ACTION,COMPLETED_PROCESS,DEFINED_ARTIFACT,PERFORMED_ACTIVITY,...SKILL_ACTION_LEXICON.map(entry=>entry.action)].map(pattern=>pattern.exec(text)).filter((match):match is RegExpExecArray=>match!==null).sort((a,b)=>a.index-b.index)[0]
  const selectedStart=selectedAction?text.indexOf(selectedAction):-1
  const index=selectedStart>0?Math.min(selectedStart,performed?.index??selectedStart):performed?.index
  const prefix=index!==undefined?text.slice(0,index).split(/但是|不过|然而|但|却/).at(-1)??'':''
  const body=personalReportBody(text),actor=firstPersonalActor(body)
  if(index!==undefined&&/(?:不得不|不能不|只得|只好|不得已(?:地)?)\s*$/.test(prefix)&&clauseReportsPastAction(text.slice(index)))return false
  if(/^(?:我|本人)?[^，。；！？]{0,24}(?:没(?:有)?|未曾|尚未|从未|不曾|未|不)(?:完成|提交|发|做|写|整理|核对|联系|执行|开始|进行|参加|访谈|采访)/.test(body))return true
  if(selectedAction&&actor&&/^(?:现在|目前|还|仍|从来)?(?:没(?:有)?|未曾|尚未|从未|不曾|不想|不打算)/.test(body.slice(actor[0].length)))return true
  // A denial only scopes the immediately following owned predicate. Do not
  // let a denied noun phrase swallow an independent coordinated completion:
  // 「我否认了抄袭指控并完成了报告」.
  const denial=/^(?:我|本人|我们)?(?:(?:明确|正式|再次)\s*)?否认(了)?(.*)$/.exec(prefix.trim())
  const independentAfterDeniedObject=Boolean(denial?.[1]&&denial[2]&&!/^(?:我|本人|我们|他|她|后来|之前|此前|曾经|已经|已|实际|确实)/.test(denial[2])&&!otherActorClause(denial[2],{allowOmittedSubject:true})&&/(?:并(?:且)?|同时)(?:独立|亲自)?$/.test(denial[2]))
  const deniedPredicate=Boolean(denial&&!independentAfterDeniedObject)
  return /(?:没(?:有)?|未曾|尚未|从未|不曾)[^，。；！？]*$/.test(prefix)||deniedPredicate||/(?:不确定|是否|可能|也许|大概|大约|好像|似乎|据说|听说)/.test(prefix)
}

const completedActionView=(text:string):string=>{
 for(let index=1;index<text.length;index++){
  const completedAfterCancellation=completedSiblingAfterCancelledPlanAt(text,index)
  if(completedAfterCancellation)return text.slice(index+completedAfterCancellation)
  if(futureSiblingConjunctionAt(text,index)||futureSiblingSequenceAt(text,index)||futureSiblingContrastAt(text,index)||cancelledPlanSiblingConjunctionAt(text,index)||consideredFutureSiblingAfterCompletionAt(text,index))return text.slice(0,index)
 }
 return text
}
const prerequisiteActionClause=(text:string)=>{
 const marker=/(?:才可以|才能|方可)/.exec(text)
 if(!marker)return false
 const nestedObject=/(?:才可以|才能|方可)[^，。；！？]{0,32}的[^，。；！？]{1,12}$/.test(text.slice(marker.index))
 return !(nestedObject&&clauseReportsPastAction(text.slice(0,marker.index)))
}
export function clauseReportsCompleted(text: string): boolean {
  text=completedActionView(text)
  const completedMethodInstruction=completedMethodOwnedInstructionClause(text)
  if(actionEvidenceUnavailable(text))return false
  if(prerequisiteActionClause(text))return false
  // A trailing denial of the event scopes the preceding action. Keep this
  // narrow so “发送了报告，没有发生错误” remains a completed send.
  if(/(?:这|此)件事(?:(?:最终|实际|后来|事实上))?(?:并)?(?:没(?:有)?|未曾|从未)发生(?:过)?$/.test(text))return false
  if(/(?:不代表|不等于|不要假设|别假设)|(?:没(?:有)?|未|不曾).{0,12}(?:执行|完成|接受)/.test(text))return false
  if((assistantRequestClause(text)||conversationPreferenceClause(text)||refusalPreferenceClause(text))&&!completedMethodInstruction)return false
  if(/(?:没(?:有)?|尚未|还未|未曾).{0,6}(?:开始|完成|做|复习|尝试|交付|发|提交)/.test(text))return false
  // Instructions about classification are not autobiographical completion
  // reports (for example, "不要把这个模板记为已经完成的行动").
  if(/(?:不(?:要)?(?:把)?|不代表).{0,24}(?:记为|当作|视为|算作|表示).{0,16}(?:已(?:经)?完成|完成的行动|经历)/.test(text))return false
  if(/(?:记录|经历).{0,6}(?:保留|留着|不(?:用|要)?删)|(?:保留|留着).{0,6}(?:记录|经历)/.test(text))return false
  if(methodOwnedInstructionClause(text)&&!completedMethodInstruction)return false
  // “定了方向/明年去读研” commits to a pursuit. Only a concrete authored
  // artifact makes the bare 定了 form an already performed action.
  const notYetGovernsClause=[...text.matchAll(new RegExp(NOT_YET.source,'g'))].some(marker=>!completedOwnedAspectBefore(text,marker.index!))
  return (reportsPastFeeling(text)||completedMethodInstruction||completedOuterPlanAudit(text)||COMPLETED_ACTION.test(text)||COMPLETED_PROCESS.test(text)||OWNED_PAST_ARTIFACT.test(text)||DEFINED_ARTIFACT.test(text)||OWNED_CONTACT_FORM.test(text)||reportsExplicitCompletedChannelContact(text)||reportsPastChannelContact(text)||COMPLETED_OBJECT_SEND.test(text)||reportsExplicitPastObjectSend(text)||PERFORMED_ACTIVITY.test(text)||SKILL_ACTION_LEXICON.some(entry=>entry.action.test(text))||clauseReportsAttempted(text)) && !notYetGovernsClause && !clauseExpressesFuturePlan(text)
}

// Past aspect is required here: a goal may name “完成” without reporting it
// happened. Both model persistence and deterministic goal capture use this gate.
export function clauseReportsPastAction(text:string):boolean{
  text=completedActionView(text)
  if(!clauseReportsCompleted(text)||clauseExpressesFuturePlan(text)||/(?:^(?:我(?:的)?|本人(?:的)?)?目标(?:是|为)|争取|想要)/.test(text))return false
  if(clauseReportsAttempted(text)||reportsPastFeeling(text)||COMPLETED_PROCESS.test(text)||OWNED_PAST_ARTIFACT.test(text)||reportsExplicitCompletedChannelContact(text)||reportsPastChannelContact(text)||COMPLETED_OBJECT_SEND.test(text)||reportsExplicitPastObjectSend(text))return true
  const primary=[COMPLETED_ACTION.exec(text),DEFINED_ARTIFACT.exec(text),OWNED_CONTACT_FORM.exec(text),PERFORMED_ACTIVITY.exec(text)].filter((match):match is RegExpExecArray=>match!==null).sort((a,b)=>a.index-b.index)[0]
  if(!primary)return false
  const following=text.slice(primary.index+primary[0].length,primary.index+primary[0].length+1)
  if(following==='的')return false
  return /(?:了|过|完|好)$/.test(primary[0])||/^[了过]$/.test(following)||DEFINED_ARTIFACT.test(primary[0])
}

// An attempt is an actual contribution, not successful completion of its task.
export function clauseReportsAttempted(text:string):boolean{
  return /(?:已经尝试|尝试了|试做了|开始尝试|尝试[^，。；！？]{1,12}[了过])/.test(text)&&!/(?:没(?:有)?|尚未|还未|未曾|想|打算|准备).{0,6}(?:尝试|试做)/.test(text)
}

// Category fallback for the star map: the model lane may omit links, but a
// seamless record still needs a browsing category. Matching goes through the
// category lexicon (strong direct evidence vs weak context clues) and quotes
// the matched fragment in the reason; the disposition stays 'proposed'
// (adjustable, never presented as user-confirmed). Callers supply the verified
// personal action, not the whole episode which may describe other contributors.
function personalGrowthText(text:string):string{
  return buildClauseCatalogue(text).map(unprotectedClauseText).filter(body=>!(otherActorClause(body)&&/(?:他|她)(?:从|在|通过)[^，。；！？]{0,24}(?:自己|他|她)的/.test(body))).join('；')
}
export function deriveStructuralLinks(action: string, result=''): { valueId: string; reason: string }[] {
  const matches=[...classifyWithLexicon(personalContributionClauses(buildClauseCatalogue(action)).map(handle=>personalActionText(unprotectedClauseText(handle))??'').join('；')),...[...classifyWithLexicon(personalGrowthText(result)),...classifyWithLexicon(personalGrowthText(action))].filter(match=>match.valueId==='value-growth')]
  return [...new Map(matches.map(match=>[match.valueId,match])).values()].slice(0, 3).map(match => ({
    valueId: match.valueId,
    reason: `自动按原话「${match.word}」先归入「${match.label}」，可调整`,
  }))
}

// Deterministic fallback when the model omits the lane: the candidate is the
// full sentence containing a detected completed-action clause. The quote stays
// a server-owned verbatim span; action/result split conservatively by clause
// shape and may legitimately stay empty.
const RESULT_SHAPE = /说|反馈|评价|效果|结果|还不错|很好|不错|挺好|通过了|被采纳|被表扬|被批评|有问题|有欠缺|按时|晚了|迟了|提前|没回|没用|用了|用上了|采纳|认可|不满意|效果一般|扣分|没扣分|来问|追问|上线|催了|续了|回应了|看过|读过|没有回复|没有回应|找到|查到|取到|打开|少.{0,8}(?:问|询问|提问)/
// Only explicit continuations of the same reported episode extend its source.
// Detail is copied verbatim: tool/help use and motivation are not new abilities.
const METHOD_DETAIL=/^(?:我|本人)?(?:当时|这次|随后|再|接着|然后)?(?:用|借助|按照|按|照着|参考|在.{1,12}帮助下)/
const EPISODE_DETAIL=/^(?:(?:因为|为了)(?:这次|当时)|这次(?:让我|使我)|我当时|结果|最终|(?:组员|对方|客户|导师|老师|同学)(?:说|反馈|表示|认为|还没|还没有|尚未|看过|读过|已读|回复|回应|采用|用了)|(?:报告|作业|材料|数据|结果)(?:还没|还没有|尚未|仍未))/
const PENDING_RESULT=/^(?:报告|作业|材料|数据|结果|组员|对方|客户|导师|老师|同学)(?:还没|还没有|尚未|仍未)/
const DUPLICATES_REMOVED=/^(?:我|本人)?(?:并且?|也)?(?:去掉|去除|剔除|删除)了\s*[0-9一二三四五六七八九十百零两]+\s*(?:条|份|个|行)重复(?:问卷|数据|样本|记录)$/
export function reportedAdjacentCleanupResult(action:ClauseHandle,next:ClauseHandle|undefined){
  if(!next||next.sentenceStart!==action.sentenceStart||next.start!==action.end+1||[action,next].some(clause=>clause.conditional||clause.interrogative||clause.quoted||clause.code||clause.attributedToOther))return null
  const body=unprotectedClauseText(action)
  if(!(firstPersonalActor(body)||jointPersonalActorClause(body))||otherActorClause(body,{allowOmittedSubject:true})||!clauseReportsCompleted(body))return null
  return /清洗(?:了|过|完|好|出来|完成)[^。；！？]*(?:数据|问卷|记录|样本)/.test(body)&&DUPLICATES_REMOVED.test(next.text.trim())?next:null
}
export function selectStructuralCandidate(sourceText: string, catalogue: readonly ClauseHandle[], anchorIso: string): { quote: string; start: number; end: number; content: ResolvedCandidateContent } | null {
  if(profileWritesDisallowed(sourceText))return null
  const matched = personalActionClauses(catalogue)[0]
    ?? catalogue.find(handle => !handle.interrogative && !handle.conditional && !handle.quoted && !handle.code && !handle.attributedToOther && BACK_REFERENCE.test(unprotectedClauseText(handle)) && RESULT_SHAPE.test(unprotectedClauseText(handle)))
  if (!matched) return null
  // Commas chain clauses inside one sentence (sentenceStart resets only at
  // terminators), so the candidate is the whole comma chain the action sits in.
  const sentence = catalogue.filter(handle => handle.sentenceStart === matched.sentenceStart)
  const isCommand=(handle:ClauseHandle)=>!handle.quoted&&!handle.code&&(prerequisiteActionClause(handle.text)||(assistantRequestClause(handle.text)||conversationPreferenceClause(handle.text)||refusalPreferenceClause(handle.text))&&!completedMethodOwnedInstructionClause(handle.text))
  const isIndependentForeignAction=(handle:ClauseHandle)=>personalActionText(unprotectedClauseText(handle))===null&&!RESULT_SHAPE.test(unprotectedClauseText(handle))&&!PENDING_RESULT.test(handle.text)
  const anchor=sentence.indexOf(matched)
  // A quantified, adjacent cleanup outcome has the same first-person source.
  // A plan or another performer's clause cannot supply this result.
  const cleanupResult=reportedAdjacentCleanupResult(matched,sentence[anchor+1])
  let first=anchor,last=anchor
  while(first>0&&!isCommand(sentence[first-1]!)&&!isIndependentForeignAction(sentence[first-1]!))first--
  while(last+1<sentence.length&&!isCommand(sentence[last+1]!)&&!isIndependentForeignAction(sentence[last+1]!))last++
  const inSentence=sentence.slice(first,last+1)
  const following=catalogue.filter(handle=>handle.start>Math.max(...inSentence.map(c=>c.end)))
  for(let at=0;at<following.length;){
    const head=following[at]!,group=following.slice(at).filter(handle=>handle.sentenceStart===head.sentenceStart)
    if(!group.length||!METHOD_DETAIL.test(head.text)&&!EPISODE_DETAIL.test(head.text))break
    if(group.some(handle=>handle.conditional||handle.interrogative||handle.quoted||handle.code||isCommand(handle)))break
    if(group.some(handle=>clauseExpressesFuturePlan(handle.text)&&! /^(?:因为|为了)(?:这次|当时)/.test(handle.text)))break
    inSentence.push(...group);at+=group.length
  }
  const end = Math.max(...inSentence.map(handle => handle.end))
  const start=inSentence[0]!.start
  const quote = sourceText.slice(start, end)
  const action = personalActionClauses(inSentence)[0]
  // A felt outcome may share the action clause. Keep subsequent observations
  // as well: later fatigue does not erase an independently reported relaxation.
  const felt=inSentence.filter(handle=>FELT_RESULT.test(unprotectedClauseText(handle)))
  const resultCandidates = inSentence.filter(handle => handle===cleanupResult||((RESULT_SHAPE.test(unprotectedClauseText(handle))||PENDING_RESULT.test(handle.text)) && handle !== action&&!METHOD_DETAIL.test(handle.text))||felt.includes(handle))
  const laterOutcome=resultCandidates.find(candidate=>/^(?:后来|结果|第二天|随后|最终)/.test(unprotectedClauseText(candidate)))
  const resultStart=felt.length?resultCandidates[0]:laterOutcome??resultCandidates.at(-1)
  const resultLast=resultCandidates.at(-1)
  let resultEnd=resultLast?.end
  const outcomeSentences=new Set(inSentence.filter(handle=>/^(?:结果|最终)/.test(handle.text)).map(handle=>handle.sentenceStart))
  if(resultLast)for(const handle of inSentence.filter(handle=>handle.sentenceStart===resultLast.sentenceStart&&handle.start>resultLast.end)){
    if((!outcomeSentences.has(handle.sentenceStart)&&!/^(?:但|不过|只是|仅|目前|当时|还|仍|尚|未|没有)/.test(handle.text))||clauseExpressesFuturePlan(handle.text)||handle.interrogative||handle.conditional||handle.quoted||handle.code||isCommand(handle))break
    resultEnd=handle.end
  }
  const result = resultStart?sourceText.slice(resultStart.start,resultEnd!):''
  let actionEnd=action?.end
  let actionSentence=action?.sentenceStart
  const actionBody=action?unprotectedClauseText(action):'',actionProjection=action?personalActionText(actionBody):null
  const methodSentences=new Set(inSentence.filter(handle=>METHOD_DETAIL.test(handle.text)).map(handle=>handle.sentenceStart))
  if(action)for(const handle of inSentence.filter(handle=>handle.start>action.end)){
    const completedOwnedMethod=completedMethodOwnedInstructionClause(handle.text)
    if(handle.attributedToOther&&!completedOwnedMethod||personalActionText(unprotectedClauseText(handle))===null||!personalContributionClauses(inSentence).includes(handle)&&!METHOD_DETAIL.test(handle.text))break
    const methodContinuation=handle.sentenceStart===actionSentence&&methodSentences.has(handle.sentenceStart)&&!RESULT_SHAPE.test(handle.text)&&!FELT_RESULT.test(handle.text)&&!PENDING_RESULT.test(handle.text)
    if(!METHOD_DETAIL.test(handle.text)&&!(handle.sentenceStart===actionSentence&&clauseReportsCompleted(handle.text))&&!methodContinuation)break
    actionEnd=handle.end;actionSentence=handle.sentenceStart
  }
  return {
    quote, start, end,
    content: {
      action: action&&actionEnd?(actionProjection&&actionProjection!==actionBody&&sourceText.includes(actionProjection)?actionProjection:sourceText.slice(action.start,actionEnd)):'',
      result,
      occurredAt: resolveOccurredDate(quote, anchorIso, 'Asia/Shanghai') ?? '',
    },
  }
}

// Reuse the same scanner and episode-boundary rules for every independent
// report. Do not limit a multi-event message to its first completed sentence.
export function selectStructuralCandidates(sourceText:string,catalogue:readonly ClauseHandle[],anchorIso:string){
  const candidates:NonNullable<ReturnType<typeof selectStructuralCandidate>>[]=[]
  let remaining=catalogue
  while(remaining.length){
    const candidate=selectStructuralCandidate(sourceText,remaining,anchorIso)
    if(!candidate)break
    candidates.push(candidate)
    remaining=remaining.filter(handle=>handle.start>=candidate.end)
  }
  return candidates
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
    if (!handle || handle.start < selection.start || handle.end > selection.end || handle.conditional || handle.quoted || handle.code || (field==='action'&&!personalContributionClauses(catalogue).includes(handle))) {
      if (supplied) dropped.push(field)
      return ''
    }
    if(field==='action'){
      const projected=personalActionText(unprotectedClauseText(handle))
      if(projected&&handle.text.includes(projected))return projected
    }
    return handle.text
  }
  return {
    content: { action: verbatim('action'), result: verbatim('result'), occurredAt: resolveOccurredDate(selection.quote, anchorIso, 'Asia/Shanghai') ?? '' },
    dropped,
  }
}
