// N1.1 single-pass user-text scanner shared by the command and time detectors.
// It never mutates the original text and every clause keeps absolute offsets,
// so callers can always verify claims against the raw user words. This is a
// limited structural scan (quotes/code/conditions/attribution/questions), not
// a general semantic parser; anything it cannot decide stays with the caller
// as needs_confirmation instead of being guessed.

export type UserClause={
  start:number;end:number;text:string;delimiter:string
  sentenceStart:number;sentenceEnd:number
  quoted:boolean;code:boolean
  conditional:boolean;attributedToOther:boolean
  interrogative:boolean
  // Absolute protected spans inside this clause, so callers can check whether
  // a specific match position is quoted/code rather than the whole clause.
  quoteSpans:ReadonlyArray<{start:number;end:number}>
  codeSpans:ReadonlyArray<{start:number;end:number}>
}

type Protected={start:number;end:number;kind:'quote'|'code'}
// Shared change marker; each consumer still verifies ownership and scope.
export const goalChangeMarker=/(?:改主意|换(?:个)?(?:方向|目标)|不想(?:再)?(?:做|继续|准备)|不打算|决定不|改为|换成|转向|放弃)/

// One bounded identity canonicalizer is shared by guide feedback and interview
// continuation. It normalizes aliases only; it never creates a user fact.
export function canonicalExamMatterIdentity(value:string):string|null{
 const compact=value.replace(/[\s_-]/g,'').toUpperCase()
 if(/^(?:(?:大学)?英语)?四级$|^CET4$/.test(compact))return 'cet4'
 if(/^(?:(?:大学)?英语)?六级$|^CET6$/.test(compact))return 'cet6'
 if(/^(?:考研|研究生)$/.test(compact))return 'postgraduate'
 if(/^(?:考公|公务员)$/.test(compact))return 'civil-service'
 if(/^(?:高数|高等数学)$/.test(compact))return 'course:advanced-math'
 if(/^(?:线代|线性代数)$/.test(compact))return 'course:linear-algebra'
 if(/^(?:概率论|概率统计|概率论与数理统计)$/.test(compact))return 'course:probability'
 return null
}

// Shared guard for concrete performer changes inside an otherwise personal
// story. Attribution of speech is a separate scanner flag.
export const personalReportBody=(text:string)=>text.trim().replace(/^(?:(?:回来反馈[:：])|实际反馈：)?(?:(?:上周[一二三四五六日天]?|(?:上|本|这)(?:周|星期|月|学期|季度|年度|年)|去年|上个月|昨天|前天|昨晚|今天|今日|刚刚|刚才|方才|之前|此前|先前|当时|这次|最近一次|一周后|但|不过|后来|随后)\s*)*/,'')
const passiveRelativeObject=/(?:由)[^，。；！？]{1,48}(?:提交|完成|负责|执行|处理|撰写|制作|整理|发送|提供|设计|修改)的(?!是)[^，。；！？]{1,24}?(?:[了过])?$/
export const passiveRelativeObjectStart=(text:string)=>passiveRelativeObject.exec(text.trim())?.index??-1
const trailingPerformer=/(的是|是由|由)([^，。；！？]+?)(?:完成的|负责的|执行的|处理的|完成|负责|执行|处理)?$/
export function trailingOtherPerformer(text:string):boolean{
 const body=text.trim(),match=trailingPerformer.exec(body)
 // In a first-person `我完成的是 X` cleft, X is the completed object, not a
 // postposed performer. Keep the older actor boundary while sharing genuine
 // `由 X 负责/完成` attribution across consumers.
 if(match?.[1]==='的是'&&/^(?:我|本人)/.test(body))return false
 // In `我核对了由小王提交的报告`, the completed owned predicate ends before
 // a passive relative object. Keep that outer review, but never excuse a
 // copular/final attribution such as `我完成了报告是由小王负责的`.
 const passiveRelative=match?.[1]==='由'&&passiveRelativeObjectStart(body)===match.index
 if(passiveRelative&&completedOwnedAspectBefore(body,match!.index!))return false
 if(match?.[1]==='由'&&!passiveRelative&&!/^由[^，。；！？]{1,32}(?:完成|负责|执行|处理)(?:的)?$/.test(body.slice(match.index!)))return false
 const performer=match?.[2]?.trim()
 return Boolean(performer&&!/^(?:我|本人|我们)(?=$|和|与|跟)|(?:和|与|跟)(?:我|本人)$/.test(performer))
}
const completedAspectSegmenter=new Intl.Segmenter('zh',{granularity:'word'})
// Structural perfective authority shared by question-object scanning and
// experience tense. A standalone 了/过 after an owned predicate is evidence;
// a lexical syllable inside 了解 is not.
export function completedOwnedAspectBefore(text:string,index:number):boolean{
 const body=personalReportBody(text.slice(0,index)).replace(/^(?:在|于)[^，。；！？]{1,32}(?=(?:我|我们|本人))/,'')
 const actor=/^(?:我们|本人|我)/.exec(body)
 if(!actor)return false
 const predicateBody=body.slice(actor[0].length)
 let predicateSeen=false
 for(const word of completedAspectSegmenter.segment(predicateBody)){
  if((word.segment==='了'||word.segment==='过')&&predicateSeen)return true
  if(word.segment==='完'&&predicateSeen)return true
  if(word.segment==='好'&&predicateSeen&&/(?:做|写|改|整理|核对|检查|分析|统计|标注|绘制|制作|设计|处理|审核|审阅|准备|打印|填写|收集|完成|执行|解决|剪|排|办|订|买|寄|送)$/.test(predicateBody.slice(0,word.index)))return true
  if(word.isWordLike&&/[\p{L}\p{N}]/u.test(word.segment))predicateSeen=true
 }
 return false
}
const knownPersonalLocation='(?:图书馆|宿舍|寝室|教室|实验室|办公室|会议室|学校|校园|家里|家|食堂|操场|咖啡馆|会场|公司|单位|工作室|线上会议)'
const knownPersonalActivityContext='(?:实习|比赛|活动|会议|项目|课程|工作|实践|考试|答辩)(?:期间|现场|中)'
const leadingPersonalContext=new RegExp(`^(?:在|于)(?:${knownPersonalLocation}|${knownPersonalActivityContext})`)
const relationalOtherRole='(?:室友|同学|朋友|同事|同伴|队友|伙伴|男朋友|女朋友|男友|女友|对象|伴侣|恋人|爱人|配偶|丈夫|妻子|未婚夫|未婚妻|老师|导师|辅导员|学长|学姐|师兄|师姐|师弟|师妹|客户|组员|负责人|项目负责人|评委|经理|老板|领导|专家|教练|医生|主席|面试官|招聘方|父母|父亲|母亲|爸爸|妈妈|爷爷|奶奶|外公|外婆|哥哥|姐姐|弟弟|妹妹|(?:堂|表)(?:哥|姐|弟|妹)|叔叔|伯伯|舅舅|姑姑|姨妈|阿姨|婶婶|嫂子|姐夫|妹夫|侄子|侄女|外甥|外甥女|岳父|岳母|公公|婆婆|兄弟|姐妹|亲戚|邻居|孩子|儿子|女儿|家人)'
const qualifiedRelationalOtherRole=`(?:(?:另(?:一(?:个|位|名)|外一?(?:个|位|名))|某(?:个|位|名)|其他|有(?:一)?(?:个|位|名)|[一二两三四五六七八九十百\d]+(?:个|位|名)))?${relationalOtherRole}`
const explicitOtherRole=`(?:${qualifiedRelationalOtherRole}|对方|他|她|他们|她们|别人|AI)`
// A Chinese name is accepted only after an explicit delegation verb. Generic
// possessive text remains a condition unless it names a known role or nickname;
// guessing a name from any two Han characters turns ordinary clauses into
// false attribution (for example, “完成初稿的话”).
const commonChineseFamilyNames='赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳唐罗薛雷贺倪汤滕殷毕郝邬安常乐于时傅皮卞齐康伍余元顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明臧计伏成戴宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅林钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫房裘缪解应宗丁宣邓郁单杭洪包诸左石崔吉龚程嵇邢滑裴陆荣翁荀羊甄家封芮储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶黎乔苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎连茹习艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公'
const chinesePersonalName=`[${commonChineseFamilyNames}][\\p{Script=Han}]{1,2}`
const compoundChineseFamilyName='(?:欧阳|司马|上官|诸葛|夏侯|东方|皇甫|尉迟|公孙|慕容|长孙|司徒|司空|宇文|令狐|轩辕|南宫)'
const boundedChineseNickname=`(?:小|阿|老)[\\p{Script=Han}]{1,2}`
// In action-subject position, do not absorb a sequencing/location suffix as
// the third character of a guessed name (周报后完成 must stay first-person).
const actionChinesePersonalName=`(?:${compoundChineseFamilyName}[\\p{Script=Han}]{1,2}|[${commonChineseFamilyNames}][\\p{Script=Han}](?:(?![前后中上下内外时并又再且的了过])[\\p{Script=Han}])?|${boundedChineseNickname})`
// Nicknames use the same bounded name+bridge parser as ordinary Chinese
// names. Keeping them out of this broad role path prevents project titles
// such as `小王者荣耀项目` from being swallowed as a delegated performer.
// An explicit delegation verb licenses an open organizational modifier before
// a known human role (产品负责人、技术经理、课程导师). The role head, not a finite
// catalogue of full job titles, establishes the performer boundary.
const compoundDelegatedOtherRole=`(?:[\\p{Script=Han}A-Za-z0-9]{1,12}${relationalOtherRole})`
const explicitDelegatedOtherActor=`(?:${explicitOtherRole}|${compoundDelegatedOtherRole}|[A-Z][A-Za-z'-]{1,30})`
// Longest verbs come first: `发` must not consume the prefix of 发布/发送 and
// make their following completion marker invisible to the completed parser.
const otherPerformanceVerb='(?:发布|发送|发|做|完成|整理|提交|联系|处理|负责|分析|统计|撰写|编写|制作|设计|核对|检查|交付|访谈|采访|存储|检测|识别|建模|追踪|管理)'
const completedPerformanceAspect='(?:了|过|完(?:了)?|好(?:了)?)'
// A relationship word is an actor only when its following tokens form a
// grammatical predicate. Prefix matching the raw catalogue made domain nouns
// such as `对象存储` look like a partner and erased the user's own action.
const relationalActorModifier='(?:(?:(?:昨天|今天|刚才|刚刚|之前|后来|随后|已经|已|也|还|先|再|重新|继续|主动|亲自|独立|负责|当场|这边|那边|这头|那头)\\s*|(?:在|于)[^，。；！？]{1,24}?|(?!(?:[^，。；！？\\n]*)(?:在|于)[^，。；！？\\n地]{1,24}地)[^，。；！？\\n]+?地\\s*)){0,3}'
const relationalActorPredicate=`(?:(?:把|将)[^，。；！？]{1,18})?(?:${otherPerformanceVerb}|写|改|查|看|拿|收|回复|告知|告诉|表示|认为|决定|选择|接受|拒绝|暂停|取消|撤销|让|叫|要求|安排|请|指导|帮助|协助|辅导)`
const relationalRoleDomainCompound=`(?:对象(?=${otherPerformanceVerb}(?!了|过|完|好)[^，。；！？\n]+?(?:${otherPerformanceVerb}|写|改|查|看|拿|收)(?:了|过|完(?:了)?|好(?:了)?))|客户(?=管理(?!了|过|完|好)[^，。；！？\n]+?(?:${otherPerformanceVerb}|写|改|查|看|拿|收)(?:了|过|完(?:了)?|好(?:了)?)))`
// Role-derived manner words (孩子气地、专家式地、朋友般地) describe the
// user's manner; their role prefix is not a separate performer.
const relationalMannerSuffix='(?:(?:气(?:十足)?|般|式|似|一样|一般)地)'
const relationalOtherActorSource=`(?!${relationalRoleDomainCompound})${qualifiedRelationalOtherRole}(?!${relationalMannerSuffix})(?=的|${relationalActorModifier}${relationalActorPredicate})`
const leadingRelationalOtherActor=new RegExp(`^(?:但|不过|后来|随后)?(?:我的?|本人的?)?(?:${relationalOtherActorSource}|他|她|别人|AI)`)
const selfReportsRelationalOtherActor=new RegExp(`我(?:让|请(?!教)|看到|看见|听说).{0,10}(?:${relationalOtherActorSource}|他|她|别人|AI)`)
const completedOtherPerformanceVerb=`(?:${otherPerformanceVerb})${completedPerformanceAspect}`
const completedProductionVerb=`(?:做|完成|整理|处理|负责|分析|统计|撰写|编写|制作|设计|核对|检查)${completedPerformanceAspect}`
const completedInterviewPerformanceVerb=`(?:访谈|采访)${completedPerformanceAspect}`
const bareSelfPerformanceManner='(?:认真|仔细|耐心|谨慎|专心|快速|高效|顺利|完整|独立|亲自|主动|实际|单独|共同|一起)'
const delegationPrefix='(?:我|本人|我们)(?:先|已经|已|负责|主动|亲自)?(?:安排|让|叫|委托|要求|指示|拜托|交代|嘱咐|通知|请(?!假|教))(?:了|给)?'
const delegatedOtherPerformance=new RegExp(`^${delegationPrefix}${explicitDelegatedOtherActor}([^，。；！？]{0,20}?)(?:把|将|去|来)?${otherPerformanceVerb}`,'u')
const delegatedStandaloneSelf=new RegExp(`(?:让|叫|要求|安排|请|指导|帮助|协助|辅导|由)(?:了)?(?:我|本人|我们)(?!的)(?=$|(?:${bareSelfPerformanceManner}|已经|已|先|再|重新|继续|当场|随后|然后|在|于|按|按照|用|通过|借助|把|将)|[\\p{Script=Han}]{1,4}地|负责$)`,'u')
const delegatedJointSelf=/(?:和|与|跟)(?:我|本人|我们)(?!的)(?=$|一起|共同)/
const delegatedBridgeReturnsToSelf=(bridge:string)=>delegatedStandaloneSelf.test(bridge)||delegatedJointSelf.test(bridge)
const delegatedOtherPerformanceClause=(text:string)=>{
 const match=delegatedOtherPerformance.exec(text)
 return Boolean(match&&!delegatedBridgeReturnsToSelf(match[1]??''))
}
// Bare Chinese names are ambiguous with noun phrases. Accept them only before
// an immediate performance verb and conservatively exclude common objects.
const delegatedObjectPrefix='(?:方案|计划|安排|要求|标准|规则|步骤|方法|模板|说明|规范|项目|任务|工作|流程|课程|活动|会议|日程|时间|报告|材料|问卷|数据|初稿|内容|功能|系统|产品|测试|架构|代码|文档|模型|接口)'
// An explicit delegation verb establishes a performer slot even when the
// human role is new to the vocabulary. Reject bounded time/object slots and a
// coordination boundary; explicit standalone self/joint-self still restores
// ownership through delegatedBridgeReturnsToSelf.
const openDelegatedPerformance=new RegExp(`^${delegationPrefix}([^，。；！？]{1,24}?)(?:把|将|去|来)?${otherPerformanceVerb}`,'u')
const openDelegatedTemporalObject=`(?:(?:好|完|妥善)?${delegatedObjectPrefix})(?:后|之后|以后)`
const openDelegatedModifiedTime=`[^，。；！？]{1,16}的(?:时间|时段|日程)`
const openDelegatedCalendarDay='(?:今天|明天|后天|昨天|本周|这周|下周|(?:上|本|这|下)?(?:周|星期|礼拜)[一二三四五六日天]|(?:(?:[零〇一二两三四五六七八九十百0-9]{2,4}年)?[零〇一二两三四五六七八九十百0-9]{1,3}月[零〇一二两三四五六七八九十百0-9]{1,3}(?:日|号)))'
const actionClockPeriod='(?:上午|中午|下午|晚上|夜里|凌晨|早上|清晨|傍晚)'
const actionClockValue='[零〇一二两三四五六七八九十百0-9]{1,4}(?:(?:点|时)(?:半|[零〇一二两三四五六七八九十百0-9]{1,3}(?:分)?)?|:[0-5]?[0-9])'
const openDelegatedClockTime=`(?:(?:${openDelegatedCalendarDay})(?:的)?\\s*)?(?:${actionClockPeriod}\\s*)?${actionClockValue}`
const relativeActionTime='(?:(?:大约|约|近|将近|差不多|大概)\\s*)?[零〇一二两三四五六七八九十百千万0-9.半]+(?:个半|个)?(?:分钟|小时|天|周|月|年)(?:半)?(?:后|之后|以后)'
const eventRelativeActionTime='(?:(?:早饭|早餐|午饭|午餐|晚饭|晚餐|上课|下课|放学|下班|起床|睡醒|开会|答辩|考试)|(?:[^，。；！？\\s]{1,12}(?:开始|结束|完成|交付)))(?:后|之后|以后)'
const prospectiveCalendarDay=`(?:${openDelegatedCalendarDay}|${relativeActionTime}|下月|下个月|明年|下学期|以后|接下来)`
const leadingActionTimePattern=new RegExp(`^(?:在|于)?(?:(?:${prospectiveCalendarDay})(?:的)?(?:\\s*(?:${actionClockPeriod})(?:\\s*${actionClockValue})?|\\s*${actionClockValue})?|${eventRelativeActionTime}|(?:${actionClockPeriod})(?:\\s*${actionClockValue})?)\\s*`,'u')
export const leadingActionTimeLength=(text:string)=>leadingActionTimePattern.exec(text)?.[0].length??0
const consideredActionPredicate=new RegExp(`^(?:(?:按(?:照)?|依照|用)[^，。；！？]{1,16}?(?:方法|步骤|方案)\\s*)?(?:(?:先|再|去|重新|继续|认真|仔细)\\s*){0,3}(?:${otherPerformanceVerb}|请教|询问|写|验证|尝试|开始|参加|投递)`,`u`)
// One authority decides whether 考虑 actually governs an action. Experience
// tense and clause splitting both call this helper, so a later action cannot be
// future in one projection but completed in another.
export const considerationGovernsAction=(tail:string):boolean=>consideredActionPredicate.test(tail.slice(leadingActionTimeLength(tail)))
const unperfectedConsideration=/考虑(?!了|过|完|好)/g
export function governedConsiderationIndexes(text:string):number[]{
 const indexes:number[]=[]
 for(const marker of text.matchAll(unperfectedConsideration))if(considerationGovernsAction(text.slice(marker.index!+marker[0].length)))indexes.push(marker.index!)
 return indexes
}
const openDelegatedNonActor=new RegExp(`^(?:${delegatedObjectPrefix}|${openDelegatedTemporalObject}|${openDelegatedModifiedTime}|${openDelegatedClockTime}|(?:(?:大约|约|近|将近|差不多|大概|不到|不超过|至多|最多)\\s*)?[零〇一二两三四五六七八九十百千万0-9.半]+(?:个半|个)?(?:分钟|小时|天|周|月|年)(?:半)?(?:(?:以内|之内|左右|上下))?(?:(?:的)?(?:时间|时长))?|(?:今天|明天|后天|本周|这周|下周)(?:的)?时间)$`,'u')
const openDelegatedOtherPerformanceClause=(text:string)=>{
 const performer=openDelegatedPerformance.exec(text)?.[1]?.trim()
 return Boolean(performer&&!openDelegatedNonActor.test(performer)&&!/(?:并(?:且)?|且|同时|随后|然后|接着)$/.test(performer)&&!/^(?:我|本人|我们|自己)(?!的)/.test(performer)&&!delegatedBridgeReturnsToSelf(performer))
}
const namedActorActionBridge=`(?:(?:已经|已|主动|独立|亲自|随后|然后|今天|昨天|昨晚|刚才|立即|马上|负责|在(?:${knownPersonalLocation}|今天|昨天|昨晚))\\s*){0,2}`
const delegatedChinesePersonalName=`(?:${compoundChineseFamilyName}[\\p{Script=Han}]{1,2}|${chinesePersonalName}|${boundedChineseNickname})`
const delegatedNamedActorBridge=`(?:${namedActorActionBridge}|(?:替|为)(?:我|本人|我们)|(?:按(?:照)?|用|借助)[^，。；！？]{1,12})`
const boundedDelegatedNamedOtherPerformance=new RegExp(`^${delegationPrefix}(?!${delegatedObjectPrefix})${delegatedChinesePersonalName}${delegatedNamedActorBridge}(?:把|将|去|来)?${otherPerformanceVerb}`,'u')
const delegatedNamedOtherPerformanceClause=(text:string)=>boundedDelegatedNamedOtherPerformance.test(text)
const contextualDelegationPrefix=`^(?:我|本人|我们)[^，。；！？]{0,24}(?:安排|让|叫|委托|要求|指示|拜托|交代|嘱咐|通知|请(?!假|教))(?:了|给)?`
const contextualDelegatedOtherPerformance=new RegExp(`${contextualDelegationPrefix}${explicitDelegatedOtherActor}([^，。；！？]{0,20}?)(?:把|将|去|来)?${otherPerformanceVerb}`,'u')
const contextualDelegatedNamedOtherPerformance=new RegExp(`${contextualDelegationPrefix}(?!${delegatedObjectPrefix})${delegatedChinesePersonalName}${delegatedNamedActorBridge}(?:把|将|去|来)?${otherPerformanceVerb}`,'u')
const contextualDelegatedOtherPerformanceClause=(text:string)=>{
 const match=contextualDelegatedOtherPerformance.exec(text)
 return Boolean(match&&!delegatedBridgeReturnsToSelf(match[1]??''))||contextualDelegatedNamedOtherPerformance.test(text)
}
const subjectlessDelegationPrefix=`^(?:再|又|就|便)?(?:安排|让|叫|委托|要求|指示|拜托|交代|嘱咐|通知|请(?!假|教))(?:了|给)?`
const subjectlessDelegatedOtherPerformance=new RegExp(`${subjectlessDelegationPrefix}${explicitDelegatedOtherActor}([^，。；！？]{0,20}?)(?:把|将|去|来)?${otherPerformanceVerb}`,'u')
const subjectlessDelegatedNamedOtherPerformance=new RegExp(`${subjectlessDelegationPrefix}(?!${delegatedObjectPrefix})${delegatedChinesePersonalName}${delegatedNamedActorBridge}(?:把|将|去|来)?${otherPerformanceVerb}`,'u')
const subjectlessDelegatedOtherPerformanceClause=(text:string)=>{const match=subjectlessDelegatedOtherPerformance.exec(text);return Boolean(match&&!delegatedBridgeReturnsToSelf(match[1]??''))||subjectlessDelegatedNamedOtherPerformance.test(text)}
const methodPrefixedPerformer='^(?:按照|按(?!照)|用|借助)([^，。；！？]{1,16}?)'
const methodPrefixedExplicitOtherPerformance=new RegExp(`${methodPrefixedPerformer}${explicitDelegatedOtherActor}([^，。；！？]{0,20}?)${otherPerformanceVerb}`,'u')
const methodPrefixedNamedOtherPerformance=new RegExp(`${methodPrefixedPerformer}(?!${delegatedObjectPrefix})(${actionChinesePersonalName})${namedActorActionBridge}${otherPerformanceVerb}`,'u')
const methodPrefixedBroadNamedOtherPerformance=new RegExp(`${methodPrefixedPerformer}(?!${delegatedObjectPrefix})(${delegatedChinesePersonalName})${namedActorActionBridge}${otherPerformanceVerb}`,'u')
const methodPrefixedRelativeAuthorship=new RegExp(`^(?:按照|按(?!照)|用|借助)[^，。；！？]{0,20}(?:${explicitDelegatedOtherActor}|${delegatedChinesePersonalName})[^，。；！？]{0,8}${otherPerformanceVerb}(?:了|过)?的[^，。；！？]{1,20}${completedOtherPerformanceVerb}`,'u')
const methodPrefixedOuterPassiveOtherPerformance=new RegExp(`^(?:按照|按(?!照)|用|借助)[^，。；！？]{1,48}?(?:由|被)(?:${explicitDelegatedOtherActor}|${actionChinesePersonalName})[^，。；！？]{0,12}${otherPerformanceVerb}(?:了|过|完|好)?`,'u')
const methodOwnershipTail=/^(?:(?:的|[^，。；！？]{0,8}(?:提供|制定|给|推荐|建议)的)(?:方法|模板|方案|计划|建议|步骤|规则|要求|材料|流程|标准)|要求|建议|安排|指导)$/
const methodOwnedInstructionBody=`^(?:按照|按(?!照)|用|借助)[^，。；！？]{0,12}?(?:${explicitOtherRole}|(?:小|阿|老)[\\p{Script=Han}]{1,3}|${actionChinesePersonalName})(?:的(?:方法|模板|方案|计划|建议|步骤|规则|要求|材料|流程|标准)|要求|建议|安排|指导|(?:课堂|课上|课程|现场)?(?:讲解|演示|示范|教学)(?:的(?:方法|步骤|过程|内容))?)(?:再|先|去)?`
const methodOwnedInstruction=new RegExp(`${methodOwnedInstructionBody}${otherPerformanceVerb}`,'u')
const completedMethodOwnedInstruction=new RegExp(`${methodOwnedInstructionBody}${otherPerformanceVerb}(?:了|过|完(?:了)?|好(?:了)?)`,'u')
export const methodOwnedInstructionClause=(text:string)=>methodOwnedInstruction.test(personalReportBody(text))
export const completedMethodOwnedInstructionClause=(text:string)=>completedMethodOwnedInstruction.test(personalReportBody(text))
const methodPrefixedOtherPerformanceClause=(text:string)=>{
 if(methodPrefixedOuterPassiveOtherPerformance.test(text))return true
 if(methodOwnedInstructionClause(text)||methodPrefixedRelativeAuthorship.test(text))return false
 const explicit=methodPrefixedExplicitOtherPerformance.exec(text),named=methodPrefixedNamedOtherPerformance.exec(text),broad=methodPrefixedBroadNamedOtherPerformance.exec(text)
 return Boolean(explicit&&!/(?:我|本人|我们)/.test(explicit[2]??'')&&!methodOwnershipTail.test(explicit[2]??''))||Boolean(named&&!/的$/.test(named[1]??'')&&!nonActorHanSubject.test(named[2]??''))||Boolean(broad&&!/的$/.test(broad[1]??'')&&!nonActorHanSubject.test(broad[2]??''))
}
const transferredOtherPerformanceBody=`(?:只)?(?:把|将)[^，。；！？]{0,30}(?:交给|交由|委托(?:给)?)[^，。；！？]{1,20}(?:去|来)?${otherPerformanceVerb}`
const transferredOtherPerformance=new RegExp(`(?:我|本人|我们)${transferredOtherPerformanceBody}`,'u')
const subjectlessTransferredOtherPerformance=new RegExp(`^${transferredOtherPerformanceBody}`,'u')
const explicitSpeakerPossessive=new RegExp(`(?:小[\\p{Script=Han}]{1,3}|[A-Z][A-Za-z'-]{1,30}|${explicitOtherRole}|父母|家人|校友|大家|你|原文|上文|这|那)的话\\s*$`,'u')
// Split the alternatives so a failed `我们室友` match cannot backtrack to the
// shorter `我` alternative and turn a colloquial possessive into the user.
const boundedOpenIndividualHumanRoleHead=`(?:${relationalOtherRole}|负责人|经理|老板|领导|专家|教练|医生|主席|评委|客户|用户|商家|家长|顾问|助理|者|员|生|师|友|手|官|教|长)`
const openIndividualHumanRoleHead=`(?:${boundedOpenIndividualHumanRoleHead}|人)`
const nonHumanRoleModifier=`(?:AI|人工智能|虚拟|数字(?:人)?|智能(?:化)?|机器(?:人)?|自动化?|算法|模型|系统)`
const spacedRoleText='[\\p{Script=Han}A-Za-z0-9\\s]'
const virtualActorMarker=`(?:虚拟|数字人|机器人)`
const genericHumanRole=`(?!${spacedRoleText}{0,18}${virtualActorMarker})(?!${spacedRoleText}{0,18}${nonHumanRoleModifier}\\s*(?:助教|助理|顾问|教师))${spacedRoleText}{0,18}?${boundedOpenIndividualHumanRoleHead}`
const nonHumanAgentRole=`${nonHumanRoleModifier}\\s*(?:体|代理|助手|助教|助理|顾问|教师|程序员)`
const nonHumanActorNoun=`${spacedRoleText}{0,18}?(?:${nonHumanAgentRole}|机器人|模型|系统|程序|平台|工具|应用|软件|设备|电脑|手机|服务器|数据库|算法)`
const nonHumanCollectiveSubject=`(?:${nonHumanActorNoun})`
const quantifiedHumanRole=genericHumanRole
const possessiveCollectiveContainer=`(?:班(?:级)?|学校|校|学院|院|专业|公司|部门|团队|小组|项目组|社团|宿舍|家庭|家(?:里)?|单位|机构|实验室|导师组|课程|社区|协会)`
const firstPersonBareRelationalSource=`${relationalOtherRole}(?=(?:(?:按(?:照)?|用|通过|借助)[^，。；！？]{1,16})?${relationalActorModifier}${relationalActorPredicate})`
const firstPersonCollectiveOccupation=`(?!的|${possessiveCollectiveContainer}|${firstPersonBareRelationalSource})${genericHumanRole}`
const firstPersonQuantifiedCollective=`(?:[一二两三四五六七八九十百\\d]+)(?:(?:个?\\s*人|位)|(?:个|位|名)\\s*${quantifiedHumanRole})`
const firstPersonPossessiveOpenHumanSource=`(?!${firstPersonQuantifiedCollective}(?=(?:(?:按(?:照)?|用|通过|借助)[^，。；！？]{1,16})?${relationalActorModifier}${relationalActorPredicate}))(?!${firstPersonCollectiveOccupation}(?=(?:(?:按(?:照)?|用|通过|借助)[^，。；！？]{1,16})?${relationalActorModifier}${relationalActorPredicate}))${spacedRoleText}{0,18}?${openIndividualHumanRoleHead}(?=(?:(?:按(?:照)?|用|通过|借助)[^，。；！？]{1,16})?${relationalActorModifier}${relationalActorPredicate})`
const firstPersonPossessiveNonHumanSource=`(?!${genericHumanRole})${nonHumanCollectiveSubject}(?=(?:(?:按(?:照)?|用|通过|借助)[^，。；！？]{1,16})?${relationalActorModifier}${relationalActorPredicate})`
const firstPersonPossessiveOpenHumanActorPattern=new RegExp(`^我们${firstPersonPossessiveOpenHumanSource}`,'u')
const firstPersonPossessiveNonHumanActorPattern=new RegExp(`^我们${firstPersonPossessiveNonHumanSource}`,'u')
const leadingOpenNonHumanActorPattern=new RegExp(`^(?!(?:我|本人|我们))${nonHumanActorNoun}(?=(?:(?:按(?:照)?|用|通过|借助)[^，。；！？]{1,16})?${relationalActorModifier}${relationalActorPredicate})`,'u')
const firstPersonPossessiveNamedHumanActorPattern=new RegExp(`^我们${possessiveCollectiveContainer}(?:的)?(?:${delegatedChinesePersonalName}|[A-Z][A-Za-z'-]{1,30})(?=(?:(?:按(?:照)?|用|通过|借助)[^，。；！？]{1,16})?${relationalActorModifier}${relationalActorPredicate})`,'u')
const firstPersonPossessiveRoleNamedHumanActorPattern=new RegExp(`^我们${spacedRoleText}{0,18}?${openIndividualHumanRoleHead}(?:的)?(?:${delegatedChinesePersonalName}|[A-Z][A-Za-z'-]{1,30})(?=(?:(?:按(?:照)?|用|通过|借助)[^，。；！？]{1,16})?${relationalActorModifier}${relationalActorPredicate})`,'u')
const singularPossessiveContainerHumanSource=`${possessiveCollectiveContainer}(?:的)?(?:${spacedRoleText}{0,18}?${openIndividualHumanRoleHead}|${delegatedChinesePersonalName}|[A-Z][A-Za-z'-]{1,30})(?=(?:(?:按(?:照)?|用|通过|借助)[^，。；！？]{1,16})?${relationalActorModifier}${relationalActorPredicate})`
const singularPossessiveContainerHumanActorPattern=new RegExp(`^(?:我|本人)${singularPossessiveContainerHumanSource}`,'u')
const unboundedFirstPersonOpenHumanActor=new RegExp(`^我们([^，。；！？]*?${openIndividualHumanRoleHead})(?=(?:(?:按(?:照)?|用|通过|借助)[^，。；！？]{1,16})?${relationalActorModifier}${relationalActorPredicate})`,'u')
const virtualActorInRole=new RegExp(virtualActorMarker,'u')
const nonHumanAssistantRole=new RegExp(`${nonHumanRoleModifier}\\s*(?:助教|助理|顾问|教师)\\s*$`,'u')
const quantifiedRolePrefix=/^[一二两三四五六七八九十百\d]+(?:(?:个?\s*人|位)(?:$|\s)|(?:个|位|名)\s*)/
const collectiveContainerPrefix=new RegExp(`^${possessiveCollectiveContainer}`,'u')
const exactRelationalRole=new RegExp(`^${relationalOtherRole}$`,'u')
const firstPersonPossessiveOpenHumanActor=(text:string)=>{
 if(firstPersonPossessiveOpenHumanActorPattern.test(text)||firstPersonPossessiveNamedHumanActorPattern.test(text)||firstPersonPossessiveRoleNamedHumanActorPattern.test(text)||singularPossessiveContainerHumanActorPattern.test(text))return true
 const match=unboundedFirstPersonOpenHumanActor.exec(text),actor=match?.[1]?.trim()
 if(!actor)return false
 if(virtualActorInRole.test(actor)||nonHumanAssistantRole.test(actor))return true
 if(quantifiedRolePrefix.test(actor))return false
 return actor.includes('的')||collectiveContainerPrefix.test(actor)||exactRelationalRole.test(actor)
}
const firstPersonPossessiveOtherActor=(text:string)=>firstPersonPossessiveNonHumanActorPattern.test(text)||firstPersonPossessiveOpenHumanActor(text)
const firstPersonalActorSource=`(?:我们(?!的|${relationalOtherActorSource}|${firstPersonPossessiveOpenHumanSource}|${firstPersonPossessiveNonHumanSource})|本人(?!的|${relationalOtherActorSource}|${singularPossessiveContainerHumanSource})|我(?!们|的|${relationalOtherActorSource}|${singularPossessiveContainerHumanSource}))`
const firstPersonalActorPattern=new RegExp(`^${firstPersonalActorSource}`,'u')
const quantifiedRelationalOtherRole=`(?:(?:[一二两三四五六七八九十百\\d]+)(?:个|位|名)?)?${relationalOtherRole}`
const jointPartner=`(?:${quantifiedRelationalOtherRole}|对方|小[\\p{Script=Han}]{1,3}|[A-Z][A-Za-z'-]{1,30}|${chinesePersonalName})`
const jointActorTail='(?:(?:一起|共同)(?!的)|(?!一起|共同|的))'
const leadingJointActor=new RegExp(`^(?:我的?|本人的?)?${jointPartner}(?:和|与|跟)(?:我|本人)${jointActorTail}`,'u')
const trailingJointActor=new RegExp(`^(?:我|本人)(?:和|与|跟)${jointPartner}${jointActorTail}`,'u')
const attributedInEnglish=/\bby\s+(?:him|her|them|my\s+(?:teammate|colleague|coworker|roommate|friend|teacher|supervisor|advisor|partner)|another\s+person|someone\s+else|[A-Z][\p{L}\p{N}_'-]*(?:\s+[A-Z][\p{L}\p{N}_'-]*)?|[\p{Script=Han}]{2,4})(?:\s+(?:yesterday|today|tonight|earlier|later|last\s+(?:night|week|month|semester)|this\s+(?:week|month|semester)))?\s*$/u
const fictionalPersonalRole=/^(?:我|本人)(?:在[^，。；！？]{0,12}(?:中|里))?(?:扮演|饰演|假装(?:成|是)?|模拟(?:成|为)?)(?:的)?(?:角色|人物|身份)?/
const possessivePassiveOtherPerformance=new RegExp(`^(?:我|本人)(?:(?:和|与|跟)${jointPartner})?的[^，。；！？]{1,24}被(?:${explicitOtherRole}|小[\\p{Script=Han}]{1,3}|${chinesePersonalName})[^，。；！？]{0,12}${otherPerformanceVerb}`,'u')
const observedOtherActor=`(?:${explicitDelegatedOtherActor}|${boundedChineseNickname}|(?!(?:${delegatedObjectPrefix}))${chinesePersonalName})`
const exactObservedOtherActor=new RegExp(`^${observedOtherActor}$`,'u')
export const boundedOtherActorPhrase=(text:string)=>Boolean(text.trim()&&!/^(?:我|本人|我们|自己)$/.test(text.trim())&&exactObservedOtherActor.test(text.trim()))
const passiveOtherPerformance=new RegExp(`^(?:由|被)${observedOtherActor}[^，。；！？]{0,12}(?:${otherPerformanceVerb}|访谈|采访)(?:了|过|完|好)?`,'u')
const passiveOtherPerformanceClause=(text:string)=>passiveOtherPerformance.test(text)&&!/(?:指导|辅导)(?:我|本人|我们)/.test(text)
const nestedObservedOtherPerformance=new RegExp(`^(?:我|本人|我们)(?:陪(?:着|同)?|跟着|跟随|和|与)[^，。；！？]{0,8}?${observedOtherActor}(?:一起)?(?:看|看到|看见|观察|见证)(?:了)?(?:他|她|对方|其|自己)(?:亲自|独立|已经|已)?${completedOtherPerformanceVerb}`,'u')
const outerNestedRecordVerb='(?:整理|记录|汇总|核对|检查|分析|查看|阅读|复盘)'
const outerNestedRecordWrapper=`(?:(?:正(?:在)?|在)${outerNestedRecordVerb}|${outerNestedRecordVerb}(?:了|过|完(?:了)?|好(?:了)?))`
const outerNestedRecordObject='[^，。；！？]{1,24}'
const ongoingOuterNestedOtherPerformance=new RegExp(`^(?:我|本人|我们)${outerNestedRecordWrapper}[^，。；！？]{0,24}${observedOtherActor}[^，。；！？]{0,8}${completedOtherPerformanceVerb}[^，。；！？]{0,24}的${outerNestedRecordObject}(?:$|[，。；！？])`,'u')
const nestedObservedOpenOtherPerformance=new RegExp(`^(?:我|本人|我们)(?:陪(?:着|同)?|跟着|跟随|和|与)(?!(?:我|本人|我们|自己)(?:$|一起|看|看到|看见|观察|见证))([^，。；！？]{1,20}?)(?:一起)?(?:看|看到|看见|观察|见证)(?:了)?(?:他|她|对方|其|自己)(?:亲自|独立|已经|已)?${completedOtherPerformanceVerb}`,'u')
const ongoingOuterNestedOpenOtherPerformance=new RegExp(`^(?:我|本人|我们)${outerNestedRecordWrapper}(?!(?:我|本人|我们|自己)(?:$|${otherPerformanceVerb}))([^，。；！？]{1,32}?)${completedOtherPerformanceVerb}[^，。；！？]{0,24}的${outerNestedRecordObject}(?:$|[，。；！？])`,'u')
const observedPerformancePrefix='^(?:发现|看到|看见|得知|听说|记录到)(?:了)?[^，。；！？]{0,12}?'
const observedOtherPerformance=new RegExp(`${observedPerformancePrefix}${explicitDelegatedOtherActor}([^，。；！？]{0,20}?)${otherPerformanceVerb}`,'u')
const observedNamedOtherPerformance=new RegExp(`${observedPerformancePrefix}(?!${delegatedObjectPrefix})${actionChinesePersonalName}${namedActorActionBridge}${otherPerformanceVerb}`,'u')
const observedBroadNamedOtherPerformance=new RegExp(`${observedPerformancePrefix}(?!${delegatedObjectPrefix})(${delegatedChinesePersonalName})${namedActorActionBridge}${otherPerformanceVerb}`,'u')
// Observation changes the performer boundary even when a nickname is not in
// the finite role/surname catalogue. In doubt, do not inherit that observed
// predicate as the user's work; explicit 我/本人/我们/自己 remains self-owned.
const observedUnmarkedOtherPerformance=new RegExp(`${observedPerformancePrefix}(?!(?:我|本人|我们|自己))((?:阿|老|小)[\\p{Script=Han}]{1,3})${namedActorActionBridge}${otherPerformanceVerb}`,'u')
const explicitObservedPerformancePrefix='^(?:我|本人|我们)(?:只|还|也|已经|已)?(?:(?:通过(?:(?:校内|学校))?(?:邮箱|邮件|微信|电话|短信|系统|平台|网站|表单|渠道))[^，。；！？]{0,8})?(?:记录|发现|看到|看见|得知|听说|了解(?:到)?)(?:了|到)?[^，。；！？]{0,12}?'
const explicitObservedOtherPerformance=new RegExp(`${explicitObservedPerformancePrefix}${explicitDelegatedOtherActor}([^，。；！？]{0,32}?)${otherPerformanceVerb}`,'u')
const explicitObservedNamedOtherPerformance=new RegExp(`${explicitObservedPerformancePrefix}(?!${delegatedObjectPrefix})${actionChinesePersonalName}${namedActorActionBridge}${otherPerformanceVerb}`,'u')
const boundedNamedActorBridge=`(?:${namedActorActionBridge}|(?:按(?:照)?|用|拿|通过|借助)[^，。；！？]{1,12})`
const unmarkedHanActorPerformance=new RegExp(`^(${compoundChineseFamilyName}[\\p{Script=Han}]{1,2}|[${commonChineseFamilyNames}][\\p{Script=Han}]{1,2}|${boundedChineseNickname})(${boundedNamedActorBridge})${otherPerformanceVerb}`,'u')
const nonActorHanSubject=new RegExp(`^(?:(?:${delegatedObjectPrefix}|周报|日报|月报|年报)(?:前|后|中|上|下|内|外|时)?|${openDelegatedCalendarDay})$`,'u')
const explicitObservedActorMarker=new RegExp('^(?:我|本人|我们)(?:只|还|也|已经|已)?(?:(?:通过(?:(?:校内|学校))?(?:邮箱|邮件|微信|电话|短信|系统|平台|网站|表单|渠道))[^，。；！？]{0,8})?(?:记录|发现|看到|看见|得知|听说|了解(?:到)?)(?:了|到)?','u')
const explicitObservedOpenOtherPerformance=new RegExp(`${explicitObservedActorMarker.source}(?!(?:我|本人|我们|自己))([^，。；！？]{1,32}?)${completedOtherPerformanceVerb}`,'u')
const unmarkedHanActorPerformanceClause=(text:string)=>{
 const match=unmarkedHanActorPerformance.exec(text)
 return Boolean(match&&!nonActorHanSubject.test(match[1]!))
}
const explicitObservedUnmarkedHanPerformanceClause=(text:string)=>{
 const marker=explicitObservedActorMarker.exec(text)
 return Boolean(marker&&unmarkedHanActorPerformanceClause(text.slice(marker[0].length)))
}
const observedActorSegmenter=new Intl.Segmenter('zh-CN',{granularity:'word'})
const observedSelfContinuationBridge=(value:string)=>{
 const words=[...observedActorSegmenter.segment(value)].map(segment=>segment.segment.trim()).filter(Boolean)
 const boundary=words.findIndex((word,index)=>index>0&&['后','之后','以后','并','然后','接着'].includes(word))
 if(boundary<0)return false
 const tail=words.slice(boundary+1).join('')
 return /^(?:(?:又|再|随后|然后|接着|已经|已|认真|亲自|独立|负责|主动|当场)|[\p{Script=Han}]{1,6}地)*$/u.test(tail)
}
const openActorPureSelfModifier=new RegExp(`^(?:(?:${bareSelfPerformanceManner}|已经|已|又|再|也|还|先|重新|继续|当场|随后|然后|接着)\\s*|[\\p{Script=Han}]{1,6}地\\s*)+$`,'u')
const openActorModifierSuffix=(value:string)=>{
 const remainder=value.replace(/(?:反复|再次|多次|连续|持续)\s*/gu,'').trim()
 return !remainder||openActorPureSelfModifier.test(remainder)
}
const openActorMethodOrLocation=/^(?:(?:在|于|按(?:照)?|用(?!户)|通过|借助)[^，。；！？]{1,16})$/
const openActorExplicitSelf=new RegExp(`^(?:我|本人|我们|自己)(?:(?:${bareSelfPerformanceManner}|已经|已|又|再|也|还|先|重新|继续|当场|随后|然后|接着)\\s*)*$`,'u')
const openDirectActorModifierOnly=(value:string)=>{
 let rest=value.trim(),timeLength=leadingActionTimeLength(rest)
 if(timeLength)rest=rest.slice(timeLength).trim()
 return openActorModifierSuffix(rest)
}
export const openNestedOtherActor=(value:string|undefined)=>{
 const actor=value?.trim()
 if(!actor)return false
 const words=[...observedActorSegmenter.segment(actor)].map(segment=>segment.segment.trim()).filter(Boolean)
 const last=words.at(-1),prior=words.at(-2)
 const explicitInnerSelf=['我','本人','我们','自己'].includes(last??'')||['亲自','独立'].includes(last??'')&&['我','本人','我们','自己'].includes(prior??'')
 return !explicitInnerSelf&&!openActorExplicitSelf.test(actor)&&!openActorPureSelfModifier.test(actor)&&!openActorMethodOrLocation.test(actor)&&!observedSelfContinuationBridge(actor)
}
const explicitHumanActor=new RegExp(`^(?:${explicitDelegatedOtherActor}|${actionChinesePersonalName})$`,'u')
const openHumanRoleHead=/(?:者|员|生|师|友|人|手|官|教|长|经理|老板|领导|专家|教练|医生|主席|评委|客户|用户|商家|家长|负责人|顾问|助理|团队|组|部门|机构|组织|公司|学校|学院|实验室|工作室|委员会|协会|社团|学生会)$/u
// Direct subject position is itself actor evidence. Keep ordinary time/manner
// prefixes out, but fail closed for any other explicit noun before the action;
// this covers open roles without maintaining another occupation catalogue.
export const openDirectOtherActor=(value:string|undefined)=>{
 const actor=value?.trim()
 return Boolean(actor&&!firstPersonalActorPattern.test(actor)&&!/^自己(?!的)/.test(actor)&&openNestedOtherActor(actor)&&!openDirectActorModifierOnly(actor))
}
// A direct subject without an introducing observation/delegation needs
// positive performer evidence. This keeps open human roles such as 助教 while
// preventing artifacts such as 邮件/报告 from becoming invented people.
export const openHumanOtherActor=(value:string|undefined)=>{
 const actor=value?.trim()
 if(!actor||firstPersonalActorPattern.test(actor)||/^自己(?!的)/.test(actor)||!openNestedOtherActor(actor))return false
 const timeLength=leadingActionTimeLength(actor)
 if(timeLength&&openDirectActorModifierOnly(actor.slice(timeLength)))return false
 // A direct-subject capture ends at the action verb, so a natural manner or
 // time modifier may follow the performer (助教反复/再次/昨天...). Resolve the
 // longest positively human prefix and require the whole remainder to be an
 // action modifier; arbitrary nouns are never stripped.
 for(let end=actor.length;end>0;end--){
  const head=actor.slice(0,end).replace(/(?:这边|那边|这头|那头)$/,''),suffix=actor.slice(end)
  if(head&&openDirectActorModifierOnly(suffix)&&(explicitHumanActor.test(head)||openHumanRoleHead.test(head)))return true
 }
 return false
}
const openNonHumanActorHead=new RegExp(`(?:${delegatedObjectPrefix})$`,'u')
export const openNonHumanOtherActor=(value:string|undefined)=>{
 const actor=value?.trim()
 return Boolean(actor&&!openActorMethodOrLocation.test(actor)&&!openActorModifierSuffix(actor)&&openNonHumanActorHead.test(actor))
}
const priorMethodReferencePrefix=/^(?:按(?:照)?|用|借助)(?:上次|这个|该|之前)?(?:的)?(?:方法|办法|步骤|方案)(?:，|,)?\s*/
const directOpenHumanPerformance=new RegExp(`^([^，。；！？]{1,20}?)(?:${otherPerformanceVerb}|写|改|查|看|试)(?:了|过|完|好)?`,'u')
const genericMethodPrefixedOpenHumanPerformance=new RegExp(`^(?:按照|按(?!照))([^，。；！？]{2,36})${otherPerformanceVerb}`,'u')
const methodPrefixedOpenHumanOtherPerformanceClause=(text:string)=>{
 const method=priorMethodReferencePrefix.exec(text)
 if(method&&openHumanOtherActor(directOpenHumanPerformance.exec(text.slice(method[0].length))?.[1]))return true
 const prefix=genericMethodPrefixedOpenHumanPerformance.exec(text)?.[1]?.trim()
 if(!prefix)return false
 for(const segment of observedActorSegmenter.segment(prefix))if(segment.index>0&&openHumanRoleHead.test(segment.segment)&&openHumanOtherActor(prefix.slice(segment.index)))return true
 return false
}
const nestedObservedOpenOtherPerformanceClause=(text:string)=>openNestedOtherActor(nestedObservedOpenOtherPerformance.exec(personalReportBody(text))?.[1])
const ongoingOuterNestedOpenOtherPerformanceClause=(text:string)=>openNestedOtherActor(ongoingOuterNestedOpenOtherPerformance.exec(personalReportBody(text))?.[1])
const explicitObservedOpenOtherPerformanceClause=(text:string)=>{
 const actor=explicitObservedOpenOtherPerformance.exec(text)?.[1]?.trim()
 // A temporal/coordinating bridge returns the later predicate to the user
 // (`看到周报后完成...`). Otherwise the observed subject owns the action even
 // when its role word is absent from every catalogue (`看到助教完成...`).
 return Boolean(actor&&!/(?:我|本人|我们|自己)/.test(actor)&&!observedSelfContinuationBridge(actor))
}
const observedReflexiveSelfPerformance=new RegExp(`^(?:我|本人|我们)(?:看到|看见|发现|得知|听说|记录到)(?:了)?[^，。；！？]{1,50}后(?:我|本人|我们|自己)(?!的)[^，。；！？]{0,24}${otherPerformanceVerb}(?:了|过|完|好)`,'u')
export const explicitObservedOtherPerformanceClause=(text:string)=>{
 const match=explicitObservedOtherPerformance.exec(text)
 return Boolean(match&&!/(?:我|本人|我们)/.test(match[1]??''))||explicitObservedNamedOtherPerformance.test(text)||explicitObservedUnmarkedHanPerformanceClause(text)||explicitObservedOpenOtherPerformanceClause(text)
}
const receivedOtherPerformance=new RegExp(`^(?:我|本人|我们)[^，。；！？]{0,24}(?:收到|收到了|拿到|拿到了|看到了?)[^，。；！？]{0,12}${observedOtherActor}[^，。；！？]{0,8}(?:发送|发出|提交|完成|整理|制作|撰写|编写|设计|处理|核对)(?:了|过)?(?:的|过来的)`,'u')
const relativeOtherPerformerAfterSelfHelp=new RegExp(`${observedOtherActor}[^，。；！？]{0,12}(?:指导|帮助|协助|辅导)(?:我|本人|我们)[^，。；！？]{0,8}的${observedOtherActor}[^，。；！？]{0,8}${completedOtherPerformanceVerb}`,'u')
const helperMediatedTransfer=new RegExp(`${observedOtherActor}[^，。；！？]{0,12}(?:指导|帮助|协助|辅导)(?:我|本人|我们)(?:(?:亲自|独立|一起|共同)\s*)?(?:发了|发送了|提交了|联系了|交付了)`,'u')
const jointlyAssistedSelfPerformance=new RegExp(`${observedOtherActor}[^，。；！？]{0,12}(?:指导|帮助|协助|辅导)${firstPersonalActorSource}(?:一起|共同)\s*${completedOtherPerformanceVerb}`,'u')
const completedSelfPerformanceVerb=completedOtherPerformanceVerb
const assistedSelfPerformance=new RegExp(`${observedOtherActor}[^，。；！？]{0,12}(?:指导|帮助|协助|辅导)${firstPersonalActorSource}(?:(?:亲自|独立)\s*${completedSelfPerformanceVerb}|${completedProductionVerb}|${completedInterviewPerformanceVerb})`,'u')
const guidedSelfPerformance=new RegExp(`${observedOtherActor}[^，。；！？]{0,12}(?:指导|辅导)${firstPersonalActorSource}(?:(?:亲自|独立|一起|共同)\s*)?${completedSelfPerformanceVerb}`,'u')
// After a directed self pronoun, allow only grammatical action modifiers. An
// arbitrary noun cannot be swallowed as a bridge: `让我组长完成` means the
// user's group lead performed it, not that the user did.
const directedSelfPerformanceBridge=`(?:(?:${bareSelfPerformanceManner}|已经|已|先|再|重新|继续|负责|当场|随后|然后)\s*|[\\p{Script=Han}]{1,2}地\s*|(?:按(?:照)?|用|通过|借助)[^，。；！？]{1,12}?|(?:在|于)[^，。；！？]{1,12}?|(?:把|将)[^，。；！？]{1,18}?){0,2}`
const assistedSelfOwnerPrefix=new RegExp(`^${observedOtherActor}[^，。；！？]{0,12}(?:让|叫|要求|安排|请|指导|帮助|协助|辅导)(?:了)?${firstPersonalActorSource}`,'u')
const selfRequestedAssistanceOwnerPrefix=new RegExp(`^${firstPersonalActorSource}(?:请|让|叫|要求|安排)(?:了)?${observedOtherActor}[^，。；！？]{0,8}(?:指导|帮助|协助|辅导)${firstPersonalActorSource}`,'u')
const directedSelfPerformance=new RegExp(`^${observedOtherActor}[^，。；！？]{0,8}(?:让|叫|要求|安排|请)(?:了)?${firstPersonalActorSource}${directedSelfPerformanceBridge}${completedSelfPerformanceVerb}`,'u')
const directedRelativeOtherPerformer=new RegExp(`^${observedOtherActor}[^，。；！？]{0,8}(?:让|叫|要求|安排|请)(?:了)?${firstPersonalActorSource}[^，。；！？]{1,16}的${observedOtherActor}[^，。；！？]{0,8}${completedOtherPerformanceVerb}`,'u')
const selfRequestedAssistancePerformance=new RegExp(`${selfRequestedAssistanceOwnerPrefix.source}${directedSelfPerformanceBridge}${completedSelfPerformanceVerb}`,'u')
export const assistedSelfPerformanceClause=(text:string)=>{
 const body=personalReportBody(text)
 if(directedRelativeOtherPerformer.test(body))return false
 return directedSelfPerformance.test(body)||selfRequestedAssistancePerformance.test(body)||guidedSelfPerformance.test(body)||jointlyAssistedSelfPerformance.test(body)||assistedSelfPerformance.test(body)
}
export function selfPerformanceView(text:string):string{
 const body=personalReportBody(text),owner=assistedSelfOwnerPrefix.exec(body)??selfRequestedAssistanceOwnerPrefix.exec(body)
 return owner&&assistedSelfPerformanceClause(body)?'我'+body.slice(owner[0].length):body
}
const omittedObservedOtherPerformance=(text:string)=>{
 const match=observedOtherPerformance.exec(text)
 // A first-person reference between the named person and verb can reverse the
 // performer (「同学让我完成」). In doubt, do not claim either performer here;
 // the downstream ownership gate will keep it unconfirmed.
 const broad=observedBroadNamedOtherPerformance.exec(text)
 return Boolean(match&&!/(?:我|本人|我们)/.test(match[1]??''))||observedNamedOtherPerformance.test(text)||Boolean(broad&&!nonActorHanSubject.test(broad[1]??''))
}
const personalActorView=(text:string)=>{
 const body=personalReportBody(text),context=leadingPersonalContext.exec(body)
 return {body,view:context?body.slice(context[0].length):body}
}
export const firstPersonalActor=(text:string)=>{
 const {body,view}=personalActorView(text),match=firstPersonalActorPattern.exec(view)
  if(!match||fictionalPersonalRole.test(view)||firstPersonPossessiveOtherActor(view))return null
 match[0]=body.slice(0,body.length-view.length)+match[0]
 match.index=0;match.input=body
 return match
}
export function jointPersonalActorClause(text:string):boolean{
 const {view}=personalActorView(text)
  return !fictionalPersonalRole.test(view)&&(leadingJointActor.test(view)||trailingJointActor.test(view)||/^我们(?!的)/.test(view)&&!firstPersonPossessiveOtherActor(view)||jointlyAssistedSelfPerformance.test(view))
}
const delegatedOtherActorPerformanceClause=(text:string)=>delegatedOtherPerformanceClause(text)||delegatedNamedOtherPerformanceClause(text)||contextualDelegatedOtherPerformanceClause(text)||subjectlessDelegatedOtherPerformanceClause(text)||openDelegatedOtherPerformanceClause(text)
export const ongoingOuterNestedOtherPerformanceClause=(text:string)=>ongoingOuterNestedOtherPerformance.test(personalReportBody(text))||ongoingOuterNestedOpenOtherPerformanceClause(text)
const outerNestedRecordPrefix=new RegExp(`^((?:我|本人|我们)${outerNestedRecordWrapper})`,'u')
export const ownedOuterRecordAction=(text:string):string|null=>{
 const body=personalReportBody(text)
 if(!ongoingOuterNestedOtherPerformanceClause(body))return null
 return outerNestedRecordPrefix.exec(body)?.[1]??null
}
export function otherActorClause(text:string,options:{allowOmittedSubject?:boolean}={}):boolean{
 text=personalReportBody(text)
  if(firstPersonPossessiveOtherActor(text))return true
 if(observedReflexiveSelfPerformance.test(text)){
  const boundary=text.search(/后(?:我|本人|我们|自己)(?!的)/)
  if(boundary>=0&&!explicitObservedOtherPerformanceClause(text.slice(0,boundary)))return false
 }
 if(relativeOtherPerformerAfterSelfHelp.test(text)||directedRelativeOtherPerformer.test(text))return true
 if(assistedSelfPerformanceClause(text))return false
 if(helperMediatedTransfer.test(text))return true
 if(delegatedOtherActorPerformanceClause(text)||methodPrefixedOtherPerformanceClause(text)||methodPrefixedOpenHumanOtherPerformanceClause(text)||transferredOtherPerformance.test(text)||explicitObservedOtherPerformanceClause(text)||observedUnmarkedOtherPerformance.test(text)||passiveOtherPerformanceClause(text)||nestedObservedOtherPerformance.test(text)||nestedObservedOpenOtherPerformanceClause(text)||ongoingOuterNestedOtherPerformanceClause(text)||receivedOtherPerformance.test(text)||leadingOpenNonHumanActorPattern.test(text)||options.allowOmittedSubject&&(subjectlessTransferredOtherPerformance.test(text)||omittedObservedOtherPerformance(text)||unmarkedHanActorPerformanceClause(text))||attributedInEnglish.test(text)||possessivePassiveOtherPerformance.test(text))return true
 if(jointPersonalActorClause(text))return false
 return leadingRelationalOtherActor.test(text)||selfReportsRelationalOtherActor.test(text)
}

// Preferences for this conversation are not goals or autobiographical facts.
export function refusalPreferenceClause(text:string):boolean{
 return /^(?:我|这事|这件事|这次|上次那件事)(?:现在|暂时|先|这次)?(?:不想|不打算|不愿意)继续(?:了)?[。！!\s]*$/.test(text.trim())
  ||/^(?:上次|之前|刚才)(?:那|这)(?:件|个)[^。！？,，;；]{1,16}(?:的事)?我(?:现在|暂时|先)?(?:不想|不打算|不愿意)(?:接着做|继续做|再做)(?:了)?$/.test(text.trim())
}
export function scopedTaskPauseTarget(text:string):string|null{
 const body=text.trim()
 const clauses=scanUserClauses(body)
 if(clauses.length!==1||clauses.some(clause=>clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.interrogative||clause.quoteSpans.length||clause.codeSpans.length))return null
 const exam=/^(?:我(?:现在|暂时)?)?(?:先|暂时)不(备考|复习)(?:了)?$/.exec(body)
 if(exam)return exam[1]!
 const trailing=/^(?:我(?:的)?)?([^。！？,，;；]{1,32}?)(?:这周|本周|下周)?(?:先|暂时)(?:停一下|暂停|停一停)(?:了)?$/.exec(body)
 const leading=/^(?:我(?:现在|暂时)?)?(?:先|暂时)暂停([^。！？,，;；]{1,32})$/.exec(body)
 const target=(trailing?.[1]??leading?.[1])?.trim()
 if(!target||/(?:如果|假如|别人|同学说|不是|不要|别|是否|吗|呢|没|未|非|不(?:曾|要求|让|说|同意|决定))/.test(target))return null
 return target==='考试复习'?'复习':target
}
// An unresolved pronoun is not a license to reactivate the previous matter.
// Explicit new-matter / read-only requests are excluded by the caller.
export function taskPauseNeedsClarification(targetText:string,currentText:string):boolean{
 return /^(?:这|那)(?:个|件)(?:方向|事|事情|任务|探索)$/.test(targetText)||currentText.includes(targetText)
}
export function scopedTaskPauseClause(text:string):boolean{
 return scopedTaskPauseTarget(text)!==null
}
export function closingOnlyInstruction(text:string):boolean{
 return /^(?:请|麻烦)?(?:(?:现在|今天|这次|本轮|先|就)?(?:到这里|结束(?:对话|聊天|本轮)?|不(?:再)?安排(?:任何)?(?:下一步|动作|任务)))[。！!\s]*$/.test(text.trim())
}
function conversationPreferenceText(text:string):string{
 return text.trim().replace(/^(?:也|并且|而且|但|不过|可是)/,'').replace(/^(今天|现在|这次)(我|本人)/,'$2$1')
}
export function conversationPreferenceClause(text:string):boolean{
 if(/^(?:今天|现在)?(?:请|麻烦)?(?:先)?听我(?:说|聊聊)/.test(text.trim()))return true
 text=conversationPreferenceText(text)
 // Passive listening wishes address this exchange, not a life direction.
 if(/^(?:我(?:今天|现在|目前|这次|先|暂时)?(?:只想|只是想|就想|想|只希望|希望)|(?:今天|现在|这次|目前)(?:只想|就想|希望))(?:先)?被(?:听见|倾听|理解)/.test(text))return true
 if(refusalPreferenceClause(text))return true
 if(/^(?:先|暂时)?(?:别|不要|不用)(?:再)?(?:给我|帮我)?安排(?:了)?$/.test(text)
  ||/^(?:先|暂时)?(?:别|不要|不用)(?:再)?给(?:它|这件事|那件事)(?:安排|排)(?:任务)?(?:了)?$/.test(text))return true
 if(/^(?:今天|现在|这次|目前)?(?:只想|就想)(?:听|聊|说说|倾诉)|^(?:今天|现在)?(?:先)?听我(?:讲|说)/.test(text))return true
 return /^(?:我(?:今天|现在|目前|这次|最近|先|暂时)?(?:只想|只是想|就想|想|只希望|希望)(?:你)?(?:先)?(?:听(?:我|你|说)|聊|说(?:说|一下|点)|倾诉|吐(?:个)?槽|陪我)|(?:请|麻烦)?(?:先|暂时)?(?:不要|不用|不想|不需要|别)(?:再)?(?:给(?:我)?|帮我(?:想)?)?(?:别的|其他)?(?:建议|推荐|方法|办法|做法|练法|学法|写法|攻略|行动|复盘)|(?:先)?听我说)/.test(text.trim())
}
// A request to the assistant is not autobiographical evidence. Keep this
// separate from listening preferences: positive requests still need delivery.
const savedRecordBasisPrefix=/^(?:从|根据|依据|基于)(?:你)?(?:(?:已经|之前|目前|现在|当前|有效|已|所|的)){0,8}(?:(?:保存|记住|了解|知道|记录)(?:的)?)?(?:资料|记录|信息|背景|长期记忆)(?:里|中)?/
export function readbackRequestClause(text:string):boolean{
 const body=text.trim()
 if(/^(?:请|帮我|麻烦)?(?:只|先)?(?:读回|回读|复述)(?:一下)?/.test(body))return true
 // Saved-background questions can ask to "state" facts rather than use the
 // product's readback vocabulary. Keep requests for future choices separate.
 const request=body.replace(/^(?:请|帮我|麻烦)?(?:只|先)?/,'')
  .replace(savedRecordBasisPrefix,'')
 return /^(?:简短|简单|简要)?(?:说出|列出|告诉我|说明)(?:一下)?[:：]?(?:我(?:的|现在|目前|上周|本周|这周|昨天|今天|刚才|之前|曾经|上次|当时|最近|已经|过去)|你(?:已经|之前|目前|现在)?(?:保存|记住|知道|了解|记录))/.test(request)
  && !/(?:我(?:现在|接下来)?(?:适合|应该|该不该)|(?:怎么|如何)(?:选|做)|推荐(?:什么|哪)|值得)/.test(request)
}
export function methodReferenceClause(text:string):boolean{
 return /^(?:请|麻烦|那就|那|就|先)?(?:用|按|参考)(?:刚才|上次|那个|这个)[^。！？\n]{0,20}(?:方法|办法|攻略|指南)|^接着上次[^。！？\n]{0,20}(?:方法|办法|攻略|指南)/.test(text.trim())
}
const summaryReplyRequest=/^(?:请|麻烦|我(?:只)?(?:想|希望)(?:要)?)?(?:只|先)?(?:(?:(?:给|说|写)(?:我)?)?一(?:句|段)(?:阶段|当前|暂定)?(?:理解|判断|总结)(?:就好|即可|就行)?|(?:用|以)一(?:句|段)(?:话)?(?:说明|概括|总结|表述|给出)[^。！？\n]{0,40}(?:理解|判断|总结|未知)[^。！？\n]{0,20})$/
const summaryReplyQuestion=/^你(?:目前|现在|这次|本轮)?(?:能不能|可不可以|能|可以)(?:形成|给出|说说)(?:什么|怎样的|一个|一段)?(?:当前|暂定|阶段)?(?:理解|判断|总结)[？?]?$/
export function comparisonRequestClause(text:string,targetScope:'any'|'matter_set'='any',requestText=''):boolean{
 const body=text.trim().replace(/^(?:现在|今天|这次)/,'').replace(/^(?:我)?(?:想|希望)(?:让你|请你|你)/,'')
 if(/^(?:比较|对比|权衡)(?:了|过|完|后|时|中|这个词|一词|是指|是什么意思)/.test(body))return false
 const requested=/^(?:请|麻烦)?(?:再|先|只)?(?:帮我)?(?:(?:完整|详细|全面|逐项)(?:地)?)?(?:比较|对比|权衡)/.test(body)
   ||/^(?:请|麻烦)?(?:再|先|只)?(?:帮我)?(?:用|以)(?:表格|一段|文字|简短语言|两句话)(?:来)?(?:比较|对比|权衡)/.test(body)
   ||/^(?:你)?(?:能不能|可不可以|能|可以)(?:先)?(?:帮我)?(?:比较|对比|权衡)/.test(body)
 if(!requested||targetScope!=='matter_set')return requested
 const target=body.slice(body.search(/比较|对比|权衡/)+2).trim().replace(/^(?:一下子?|下)\s*/,'')
 // Only a complete current-set reference can replace generic presentation.
 // Incidental/excluded matters and explicit other objects keep their contract.
 const matter='(?:事项|任务|待办|事情|事)'
 const quantifier='(?:(?:这些|所有|全部|各个|每个|各项|每项|每件|各件|这几(?:件|项)?)(?:的)?)?'
 const reference='(?:(?:手头|当前|之前|上次|刚才|原来)(?:的)?'+quantifier+matter+'|(?:这些|这几(?:件|项)?)(?:的)?'+matter+')'
 const isMatterReference=(value:string)=>new RegExp('^(?:我(?:的)?|本人(?:的)?)?'+reference+'(?:的?(?:取舍|优先级|先后(?:顺序)?|安排))?[。！？?！\\s]*$').test(value)
 if(isMatterReference(target))return true
 if(!requestText||!/^(?:取舍|优先级|先后(?:顺序)?|安排)?[。！？?！\s]*$/.test(target))return false
 return scanUserClauses(requestText).some(clause=>{
  if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.quoteSpans.length||clause.codeSpans.length)return false
  const declared=/^(?:(?:本轮|这次)(?:比较(?:的)?)?)?(?:范围|对象)(?:是|为|[:：])\s*(.+)$/.exec(clause.text.trim())
  return Boolean(declared&&isMatterReference(declared[1].trim()))
 })
}
function comparisonStopClause(text:string):boolean{
 return /^(?:现在|今天|这次)?(?:请|麻烦)?(?:先|暂时)?(?:不要|不用|别|不)(?:再|自动)?(?:给我|帮我)?(?:比较|对比|权衡)/.test(text.trim())
}
// A list item's instruction ownership comes from its actual list head.
const nextActionQuestion=/^(?:(?:我|本人)(?:现在|今天|接下来|下一次|下次)?(?:具体)?(?:(?:先|下一步)?(?:该|应该)?(?:先)?(?:做|处理)(?:什么|哪一步)|(?:下一步)?(?:该|应该)?(?:怎么|如何|怎样)(?:开始|做|处理))|下一步(?:怎么|如何|怎样)(?:开始|做|处理))[？?\s]*$/
export function assistantInstructionClause(sourceText:string,clause:Pick<UserClause,'start'|'end'|'text'>,clauses:readonly Pick<UserClause,'start'|'end'|'text'>[]):boolean{
 let index=clauses.findIndex(row=>row.start===clause.start&&row.end===clause.end)
 if(index<0)return assistantRequestClause(clause.text)
 while(index>0&&/^[、\s]*$/.test(sourceText.slice(clauses[index-1]!.end,clauses[index]!.start)))index--
 return assistantRequestClause(clause.text)||assistantRequestClause(clauses[index]!.text)
}
// One bounded format request shared by source authority and reply scope.
export const requestsFeedbackStepRevision=(text:string)=>/^(?:这次|本轮)?(?:请|麻烦)?(?:按|根据|基于)(?:上次|之前)的?(?:实际)?反馈(?:帮我|替我)(?:改|调整|换)(?:一|1)(?:个|步|项|条)[^，。；！？\n]{0,24}(?:步骤|动作|起点)$/.test(text.trim())
const priorSuggestion='(?:你(?:刚才|上次|之前)?(?:建议|说|提出|给)(?:的)?|(?:上次|刚才|之前)(?:的)?(?:试算|比较|取舍)(?:中)?(?:给出|提出|建议)(?:的)?)?'
// A modifier may name the step, but cannot substitute a person or proposition.
const actionChoiceTarget='(?:(?:(?:这|那|该)(?:个)?)?(?:(?:(?!的)[一-龥A-Za-z0-9]){0,12}(?:步骤|建议|方案|做法|办法|方法|计划|安排|行动)|一步)|先[^。！？；]{0,40}这一步)\\s*(?=$|[。！？；，,]|但|不过|因为|所以|并且|并会|并愿意|作为(?:本次)?(?:真实|实际)(?:的)?(?:安排|选择|决定))'
const acceptedActionChoice=new RegExp('^(?:我|本人)(?:现在|已经|已|决定)?(?:接受|同意|愿意试)'+priorSuggestion+actionChoiceTarget)
const declinedActionChoice=new RegExp('^(?:我|本人)(?:现在|目前)?(?:拒绝|不接受)'+priorSuggestion+actionChoiceTarget)
export function actionReportText(text:string){
 const body=text.trim().replace(/^(?:但是|不过|另外|同时|还有|并且|而且|但|而)/,'')
 const choiceBody=body.replace(/^(我|本人)(?:现在|目前|已经|已|决定|先|暂时|明确|也)+/,'$1')
 return {body,choiceBody}
}
export function actionStepChoice(text:string,scope:'prefix'|'whole'='prefix'):'accepted'|'declined'|null{
 const accepted=acceptedActionChoice.exec(text)
 if(accepted&&(scope==='prefix'||accepted[0]===text))return 'accepted'
 const declined=declinedActionChoice.exec(text)
 return declined&&(scope==='prefix'||declined[0]===text)?'declined':null
}
const nextStepChoiceRequest=(text:string)=>/^(?:(?:可不可以|能不能|可以|能)(?=请|麻烦))?(?:请问|请|麻烦)(?:你|您|可不可以|能不能|可以|能|再|先|只|直接|现在|[:：]\s*)*(?:帮我|替我)(选一(?:个|步|项|条)[^，。；！？\n]{0,60}(?:步骤|动作|起点))$/.test(text.trim())
 ||requestsFeedbackStepRevision(text)
export function assistantRequestClause(text:string):boolean{
 if(nextStepChoiceRequest(text))return true
 if(/^(?:岗位)?(?:资料|信息|内容)(?:不全|不足|缺少|不够)(?:的话)?(?:就)?(?:先)?(?:问|询问)我$/.test(text.trim()))return true
 if(/^(?:请|麻烦)?(?:按|按照|依据|根据)我(?:最近|刚才|上次|之前)(?:反馈|报告|提供|说)(?:的)?(?:条件|情况|信息|背景)$/.test(text.trim()))return true
 if(/^(?:这次|本轮)(?:先)?(?:别|不要|不用)(?:再)?(?:增加|添加|加|安排)(?:其他|别的|新的|新)?任务$/.test(text.trim()))return true
 if(nextActionQuestion.test(text.trim()))return true
 if(matterOverviewRequestClause(text.trim()))return true
 const basis=text.trim().replace(/^(?:请|帮我|麻烦)?(?:只|先)?/,'')
  if(/^(?:上一轮|上轮)(?:页面|系统|你)?(?:提示|显示|报错|回复)(?:本轮消息|回复|对话|聊天记录|个人记录)?(?:保存失败|没有保存成功|未保存|没保存|回复失败|生成失败)[。！!]?$/.test(text.trim()))return true
 if(savedRecordBasisPrefix.test(basis)&&basis.replace(savedRecordBasisPrefix,'').trim()==='')return true
 // Source acknowledgments and directions about recording/interpreting a story
 // are conversational metadata, not a second autobiographical achievement.
 if(/^(?:这些|以上|上述)(?:都)?是我(?:本人|这次|亲自)*(?:做过|经历过|说过)的(?:事情|事|经历|内容)$/.test(text.trim()))return true
 if(/^(?:请|麻烦)(?:帮我)?记住[^。！？\n]{0,80}$/.test(text.trim())
  ||/^(?:请|麻烦)?帮我区分[^。！？\n]{0,80}$/.test(text.trim())
  ||/^(?:请|麻烦)?(?:不(?:要)?|别)把[^。！？\n]{1,60}(?:说成|写成|推断为|当作|记为)[^。！？\n]{1,80}$/.test(text.trim()))return true
 if(/^(?:只(?:给(?:我)?建议|分析|做(?:分析|比较|讨论))|(?:请|也)?(?:不要|别|不)(?:修改|创建|记录|保存|采纳|假设))/.test(text.trim()))return true
 // A disclaimer of accepting this advice is conversational scope. An actual
 // interpretation such as "不等于拒绝我" remains source-backed user context.
 if(/^不(?:代表|等于)(?:我|本人)?(?:已|已经)?(?:选择|选定|接受|采纳|执行|完成|承诺|同意)/.test(text.trim()))return true
 if(/^(?:请|麻烦)(?:现在|马上|直接|继续|先|再)?(?:完成|补完|补全|写完|展开)[^。！？\n]{0,60}(?:建议|回答|回复|正文|内容|清单|路径|分析|讨论)/.test(text.trim())
  ||/^(?:请|麻烦)?(?:先|再|并)?(?:逐项|分别|逐一)(?:区分|回读|说明|解释)/.test(text.trim())
  ||/^(?:请|麻烦)?(?:先|再|并)?(?:解释|说明)(?:为什么|为何|如何|一次|单次)/.test(text.trim())
  ||/^每(?:条|项|点|段)(?:用|写)?(?:[一两二三四五六七八九十]+|\d+)(?:句|段|行|字)/.test(text.trim())
  ||/^说明(?:结合|基于|依据|根据)我(?:本人)?背景/.test(text.trim()))return true
 if(/^(?:请|麻烦)?(?:先|暂时|现在)?(?:按|依据|根据)(?:这个|那个|上述|刚才的|我说的)(?:意思|定义|解释|表述|原话)(?:来)?(?:理解|看待|回答|分析)(?:就好|即可)?$/.test(text.trim()))return true
 if(/^(?:请|麻烦)?(?:先|暂时|本轮|这次)?(?:不要|别|不想|不用)(?:再)?分析[^。！？\n]{0,40}$/.test(text.trim()))return true
 if(readbackRequestClause(text))return true
 if(/^是否(?:已经|已|还|尚未)?(?:回复|回应|采用|使用|付款|读过|看过)[？?]?$/.test(text.trim()))return true
 if(closingOnlyInstruction(text))return true
 if(/^(?:请|麻烦)(?:帮我)?(?:记录|记下|保存|写入|更新)[^。！？\n]{0,80}$/.test(text.trim()))return true
 if(/^(?:请|麻烦|我(?:想|希望)(?:让)?你)?(?:按|依据|根据)[^。！？\n]{0,40}(?:状态|已发|已读|已回复|是否采用|实际效果)(?:[，,]\s*)?$/.test(text.trim()))return true
 if(/^(?:请|麻烦|我(?:想|希望)(?:让)?你)?(?:按|依据|根据)[^。！？\n]{0,40}(?:状态|已发|已读|已回复|是否采用|实际效果)[^。！？\n]{0,16}(?:说明|列出|展示|呈现|回读)$/.test(text.trim()))return true
 // Explicitly addressed help requests are conversation instructions, even
 // when phrased as a wish. They are not reports of an already felt outcome.
 if(/^(?:我|本人)(?:现在|今天|这次)?(?:想|希望)(?:让|请|麻烦)?你(?:能|可以)?(?:先|再|继续)?(?:帮(?:助)?|给|替|为)我/.test(text.trim()))return true
 // Imperative discourse framing and output-format instructions are not life goals.
 if(/^(?:请|麻烦)(?:从|围绕)[^。！？]{1,40}(?:聊起|聊|谈起|说起)$/.test(text.trim())
  ||/^(?:请|麻烦)?(?:先|只|再)?问(?:我)?(?:一|一个|一条)/.test(text.trim())
  ||/^(?:请|麻烦)?(?:先|只)?(?:不要|别|不用)(?:再)?(?:加|添加|加入|评价|贴标签)/.test(text.trim()))return true
 if(comparisonRequestClause(text)||comparisonStopClause(text))return true
 const clause=text.trim().replace(/^(?:也|并且|而且|但|不过|可是)/,'').replace(/^我(?:现在)?请你/,'请')
 return conversationPreferenceClause(clause)||summaryReplyRequest.test(clause)||summaryReplyQuestion.test(clause)
  ||/^(?:先)?只(?:说|给)(?:我)?一(?:个|步|条)|^(?:别|不要)重新给(?:我)?完整计划/.test(clause)
  ||/^(?:请|麻烦|那就|那|就|先)(?:先)?(?:用|使用|按|参考|依据)[^。！？\n]{0,80}(?:攻略|指南|方法)/.test(clause)
  ||/^(?:请|麻烦)?(?:再|先|只|继续|直接|马上|现在)?(?:帮我|给我|替我)(?:先|继续|只)?(?:想|处理|解释|看看|分析|安排|核对|写|修改|听|聊|整理|起草|拟|一(?:个|步|句|段|份|条))/.test(clause)
  ||/^(?:请|麻烦)(?:先|继续)?(?:处理|解释|看看|分析|安排|写|修改|听|聊|沿用|给|提供|设计)/.test(clause)
  ||/^(?:请|麻烦)(?:先|只|重新|继续)?(?:更新|调整|重开|核对|说明|总结|比较|区分)/.test(clause)
  ||/^(?:请|麻烦)?(?:并|再|先|只)?给(?:我)?(?:[一两二三四五六七八九十]+|\d+(?:[-–—~至]\d+)?)(?:个|条|步|项)[^。！？\n]{0,24}(?:验证|行动|动作|步骤|办法|问题|下一步建议)/.test(clause)
  ||/^(?:请|麻烦)?(?:这周|本周|今天|现在)?(?:先|暂时)?(?:不要|别|不用|不)(?:再|自动)?(?:给我|帮我|让我)?(?:生成|安排|新增|删除|催促|追问|继续行动|用|替我|重开)/.test(clause)
  ||/^(?:只|先|暂时)?(?:说明|总结|更新|调整|核对)(?:当前|相关|本轮|这段|受影响|已报告|暂定|仍未知|各自|上述|此前|新信息|判断|理解|状态)/.test(clause)
  ||/^(?:请|麻烦)?(?:依据|根据|基于|结合)(?:新信息|这条|这次|当前|已报告|上述|这些)[^。！？\n]{0,40}(?:更新|说明|总结|调整)[^。！？\n]{0,16}(?:判断|理解)/.test(clause)
  ||/^(?:请|先|只)?保留(?:未知|此前|已报告|原有|已有)/.test(clause)
  ||/^(?:请|麻烦)?(?:并|重新|再|先|只)?(?:按|根据|结合|基于|依据)[^。！？\n]{0,80}(?:给出|说明|回答|分析|整理|列出)/.test(clause)
  ||/^(?:这个|该)(?:动作|步骤|建议|回复)(?:要|需|需要)(?:说明|包含|写明)/.test(clause)
  ||/^(?:验证什么|看到什么算有进展|何时停止|为什么现在值得验证|回来反馈什么)$/.test(clause)
  ||/^(?:请)?(?:先|暂时)?(?:不要|别|不用)(?:再)?(?:帮我|给我|替我|让我)?(?:写|添加|编造|夸大|扩写|列入|猜|推断|重写|改短|缩短|发送|代发|复述)/.test(clause)
  ||/^(?:我想|现在想|请)?把[^。！？\n]{0,24}(?:消息|邮件|短信|文案|草稿|问题|简历|描述)[^。！？\n]{0,12}(?:改短|缩短|润色|重写)/.test(clause)
  ||/^(?:先|继续)(?:处理|解决|看|聊|整理|核对)(?:这个|这件|原来|刚才|上述|一下)/.test(clause)
  ||/^(?:请|麻烦)(?:按|根据|结合|基于|依据)[^。！？\n]{0,24}(?:帮我|给我|替我)(?:选|找|确定|想|分析|安排|写)/.test(clause)
  ||/^(?:请)?(?:不要|别)(?:把|将).+/.test(clause)
}

// One shared interpretation of reply-scope commands for the wire prompt and
// runtime capability boundary; this does not classify personal facts.
export const independentTrialNouns='(?:对照|尝试|验证|实验|试验|观察)'
// A broad personal overview needs coverage, not just semantic neighbours.
// Keep the shared ownership/quote scanner; this does not interpret new facts.
function matterOverviewRequestClause(body:string):boolean{
 if(/^(?:请|麻烦)?(?:先|暂时)?(?:不|不要|不用|别)|^(?:室友|同学|朋友|他|她|他们|她们|别人|老师|父母)/.test(body)||/(?:帮|给)(?:他|她|他们|她们|同学|朋友)|(?:室友|同学|朋友|他|她)(?:手头|的)|虚构|举例|示例/.test(body))return false
 const matters=/(?:这些|这几|几件|各个|所有|全部|哪些|什么)(?:件|项)?(?:(?:未完成|没做完|待处理)(?:的)?)?(?:事|任务|待办)/.test(body)
  ||/(?:盘点|统筹|优先级|优先顺序)/.test(body)&&/(?:事|任务|待办)/.test(body)
 const overview=/(?:盘点|统筹|(?:排|调整|重排)[^。！？]{0,12}(?:优先级|先后)|先(?:做|处理)哪|(?:怎么|如何)(?:排|安排|取舍))/.test(body)
  ||/^(?:我|本人)(?:现在|目前|还)?有(?:哪些|什么)(?:还|尚)?(?:没做完|未完成|待处理)/.test(body)
 const request=/^(?:(?:请|麻烦)(?:你)?|(?:我|本人)(?:想|希望)你)?(?:(?:帮我|给我|为我)(?:把|盘点|统筹|排|看看|看|列出)|盘点|统筹)/.test(body)
  ||/^(?:请|麻烦)(?:先|重新)?(?:盘点|统筹|排|看)/.test(body)
  ||/(?:这些事|这几件事|手头这些事)(?:情)?(?:应该|现在|今天|这周)?(?:先(?:做|处理)哪|怎么(?:排|安排|取舍)|如何(?:排|安排|取舍))/.test(body)
  ||/^(?:我|本人)(?:现在|目前|还)?有(?:哪些|什么)(?:还|尚)?(?:没做完|未完成|待处理)/.test(body)
  ||/^(?:请|麻烦)?把(?:我|本人)(?:手头|的)/.test(body)&&/(?:盘点|统筹|优先级|先后|取舍)/.test(body)
 return matters&&request&&overview
}
export function requestsMatterOverview(text:string):boolean{
 if(currentConversationOnly(text))return false
 let requested=false
 for(const clause of scanUserClauses(text)){
  if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.quoteSpans.length||clause.codeSpans.length)continue
  const body=clause.text.trim()
  if(/^(?:但|不过|但是)?(?:请|麻烦)?(?:先|暂时)?(?:不要|不用|不想|不需要|别)(?:再|继续)?(?:帮我|给我|为我)?(?:盘点|统筹|排(?:个|一下)?优先级|看(?:看)?|安排|取舍|处理|继续)(?:(?:我)?(?:手头|这些|这几)(?:件|项)?(?:事|任务))?(?:了|一下|下)?[。！!]?\s*$/.test(body)){requested=false;continue}
  if(matterOverviewRequestClause(body))requested=true
 }
 return requested
}

// Trial conditions are conversational inputs, never an acceptance or a fact
// update. Short follow-ups require an owned decision request in this chat.
export function decisionConditionSubject(body:string):string{
 return body.replace(/^除(?:了)?/,'').replace(/外$/,'').replace(/^请/,'').replace(/^(?:重新(?:试算|比较|权衡|取舍)|(?:另做|再做)一次(?:试算|比较)|试算|重比|重排)/,'').replace(/^(?:只)?(?:按(?:照)?|依照|以|用|采用|改成|改为|改用|缩为)/,'').replace(/^(?:而且|并且|另外|同时|也|还|但|而|不过|且)/,'').replace(/^[:：\s]+/,'').replace(/^(?:那)?(?:如果|假设|假如|要是|万一)/,'').replace(/^(?:完全|确实|真的)(?=不|没|无|可|能)/,'')
}
const ownConditionSubject=/^(?:我(?!的|导师|老师|同学|室友|朋友|队友|家人|同事|同桌|父母|爸爸|妈妈)|我的(?:时间|可用|可支配|精力|体力|网络|电脑|手机|材料|场地|预算|设备|资源)|本人|精力|体力|疲惫|很累|很难|难以|网络|电脑|手机|时间|可用|可支配|预算|设备|资源|场地|材料|外出|联系|暂时|现在|目前|这次|本次|本周|这周|下周|每天|每周|今天|实际|仍|只有|只剩|仅剩|还剩|最多|没|无|不能|不可以|不一定|未必|禁止|能|可以|本地|之前|沿|[0-9零一二两三四五六七八九十百]+(?:分钟|小时))/
export function ownsDecisionConditionSubject(text:string):boolean{return ownConditionSubject.test(decisionConditionSubject(text))}

export function decisionComparisonRequest(text:string,hasPriorDecision=false):'compare'|'restore'|null{
 const own=scanUserClauses(text).filter(c=>!c.quoted&&!c.code&&!c.attributedToOther&&!c.quoteSpans.length&&!c.codeSpans.length)
 const body=own.map(c=>c.text).join('，')
 const stopIndex=Math.max(-1,...own.flatMap(c=>/^算了[。！!\s]*$/.test(c.text.trim())?[c.start]:[...c.text.matchAll(/重新试算|试算|重新比较|比较|对比|权衡|重排|重比/g)].filter(match=>/(?:不|不要|不用|别|不想|不愿|不愿意|不需要|不打算)(?:再|重新|继续|要|想)*$/.test(c.text.slice(0,match.index))).map(match=>c.start+match.index)))
 const restoreIndex=Math.max(-1,...own.flatMap(c=>[...c.text.matchAll(/(?:取消|退出|撤销)(?:这次|本次)?试算|(?:回到|恢复)(?:原来|原先|原本|真实|实际|现实)(?:的)?(?:条件|情况)/g)].filter(match=>!/(?:不|不要|不用|别|不想|不需要|不是要)\s*$/.test(c.text.slice(0,match.index))).map(match=>c.start+match.index)))
 if(restoreIndex>=0&&restoreIndex>=stopIndex)return 'restore'
 if(stopIndex>=0)return null
 if(/(?:重新比较|重比|重新权衡)[^。！？]{0,16}(?:之前|上次|刚才|原来)[^。！？]{0,8}(?:取舍|比较|方案)/.test(body))return 'compare'
 const hasCondition=(value:string)=>/(?:分钟|小时|时间|精力|体力|疲惫|很累|联系|发消息|发邮件|电话|见面|催促|回复|发送|沟通|联网|网络|上网|断网|没网|外出|预算|限制|条件|资源|设备|电脑|手机|材料|场地)/.test(value)
 const condition=hasCondition(body)
 const request=own.some(c=>/^(?:请|麻烦|帮我|给我|按|那|如果|假设|假如|要是|万一|我|本人|暂时|继续|仍按|接着|保留|重比|重排|试算|重新试算|重新比较|重新权衡|重新取舍|比较|对比|权衡)/.test(c.text.trim()))
 const compare=own.some(c=>/(?:试算|重新比较|重新权衡|重新取舍|重排|重比)/.test(c.text.replace(/(?:上次|刚才|之前)(?:的)?试算(?:中)?(?:给出|提出|建议)/g,'')))||/(?:这些事|这些事项|这些任务|手头|取舍|原方案|刚才的建议|上次的建议|优先级)/.test(body)&&/(?:比较|对比)/.test(body)
 const ownsReference=(value:string)=>/(?:我(?!的)|本人|这些事|这些事项|这件事|这次取舍|刚才的建议)/.test(value)
 const followup=hasPriorDecision&&own.some(c=>{
  if(!c.interrogative||!/(?:呢|会怎样|会怎么变|怎么调整|如何调整|怎么办|先做什么|先做哪个)[？?\s]*$/.test(c.text))return false
  const parts=own.filter(part=>part.sentenceStart===c.sentenceStart),question=parts.map(part=>part.text).join('，')
  const inheritedOwner=ownsDecisionConditionSubject(question)&&own.some(part=>part.sentenceStart<c.sentenceStart&&!part.conditional&&!part.interrogative&&ownsReference(part.text))
  return parts.some(part=>part.conditional)&&hasCondition(question)&&!activityScopedDecisionTime(question)&&(ownsReference(question)||inheritedOwner)
 })
 return condition&&request&&(compare||followup)?'compare':null
}
export function decisionTimeTailIsGlobal(tail:string):boolean{
 return /^\s*(?:$|[。！？?！；，,：:\n]|(?:呢|啊|吧|了)[。！？?！\s]*$|的(?:条件|情况)|(?:可以|可|能|用来|用于)?(?:处理|安排|做)(?:手头)?(?:这些|全部|所有)(?:事|事项|任务)|(?:且|并且|但|而|不过)(?:我|本人)?(?:现在|目前|这次)?(?:精力|网络|电脑|手机|联系|不能|无法|没有|可以|能)|(?:重新比较|重新权衡|重新取舍|重比|试算|请|帮我|优先级|怎么调整|如何调整|会怎样)|(?:可用|空闲|可支配|的?(?:可用|空闲)时间)[。！？?！\s]*$)/.test(tail)
}
export function activityScopedDecisionTime(text:string):boolean{
 const scoped=/(?:我|本人)(?:现在|目前|实际|这次|还|只|仅)*(?:只有|只剩(?:下)?|仅剩(?:下)?|还剩(?:下)?|有)\s*[0-9零一二两三四五六七八九十百]+\s*(?:分钟|小时)(.*)/.exec(text)
 const prefixed=/(?:我|本人)([^。！？；，,]{1,30}?)(?:只有|只剩(?:下)?|仅剩(?:下)?|还剩(?:下)?|有)\s*[0-9零一二两三四五六七八九十百]+\s*(?:分钟|小时)/.exec(text)
 // Only positive activity evidence narrows a prefix; an unrecognized modifier
 // is not proof that the user's total budget belongs to another activity.
 const pluralScope=prefixed&&/(?:这些|全部|所有|这几)(?:个|件|项)?(?:事|事项|任务|工作)/.test(prefixed[1]!)
 // A complete, explicit single-activity phrase is positive scope evidence.
 // Partial verbs or characters such as 前/后 cannot establish that scope.
 const activityPrefix=prefixed&&!pluralScope&&/^(?:(?:现在|目前|今天|这次|本次|这轮))?(?:看(?:电影|视频|[前后][0-9一二两三四五六七八九十]+(?:页|行|题|章|段))|写(?:报告|前言|前端代码|后端代码)|做(?:报告|前端开发|后端开发)|(?:当前|本次|这轮)(?:任务|事项)|通勤|编程|学习|复习)$/.test(prefixed[1]!)
 return Boolean(scoped&&!decisionTimeTailIsGlobal(scoped[1]!)||activityPrefix)
}
export function decisionComparisonActualClauses(text:string):UserClause[]{
 return scanUserClauses(text).filter(c=>!c.conditional&&!c.quoted&&!c.code&&!c.attributedToOther&&!c.interrogative&&!c.quoteSpans.length&&!c.codeSpans.length
   &&!/(?:假设|假如|如果|作为[^。]{0,12}条件|(?:接受|同意|选择)[^。]{0,20}条件)/.test(c.text)
   &&(!/试算/.test(c.text)||/(?:上次|刚才|之前)(?:的)?试算(?:中)?(?:给出|提出|建议)/.test(c.text))
   &&!assistantRequestClause(c.text)&&!/(?:决定|选择)(?:继续|恢复|重新|再次|再|先|只|仅)*(?:比较|对比|权衡|试算|重排|重比)/.test(c.text)
   &&/^(?:另外|同时|而且|还有|并且)?(?:我|本人)(?:也|已经|现在|目前|这次|确实|先|暂时|明确)*(?:把[^。！？]{1,40})?(?:决定|接受|同意|选择|愿意试|采纳|完成|提交|执行|发送|结束|暂停|拒绝|不接受)/.test(c.text.trim()))
}
export function requestsMatterDecision(text:string):boolean{
 const own=scanUserClauses(text).filter(c=>!c.conditional&&!c.quoted&&!c.code&&!c.attributedToOther&&!c.quoteSpans.length&&!c.codeSpans.length)
 // A named generic comparison cannot borrow its matter object from another
 // clause. Unscoped questions such as "报告和权限，我先做哪个" keep continuity.
 const bodies:string[]=[],pending:string[]=[]
 for(const clause of own){
  if(comparisonRequestClause(clause.text)&&!comparisonRequestClause(clause.text,'matter_set',text)){
   if(pending.length)bodies.push(pending.splice(0).join('，'))
   bodies.push(clause.text)
  }else pending.push(clause.text)
 }
 if(pending.length)bodies.push(pending.join('，'))
 return requestsMatterOverview(text)||own.some(c=>comparisonRequestClause(c.text,'matter_set',text))||bodies.some(body=>
  /(?:我|本人|手头)|(?:报告|权限|课程|任务|事项|待办)[^。！？]{0,20}(?:先做|先处理|优先|应该|该选)/.test(body)
  &&/(?:手头|哪件|哪些事|事项|任务|待办|行动|步骤|报告|权限|课程|复习|科研|实习|求职|竞赛|考研|就业|保研|考公|创业|留学)/.test(body)
  &&(comparisonRequestClause(body)||/(?:先做|先处理|优先|该选|选哪|二选一)[^。！？]{0,12}(?:哪|怎么|如何|办)/.test(body)))
}

export function responseRequestScope(text:string){
 // A direct question to the assistant still requests a reply format inside
 // a condition. This does not turn hypothetical facts or actions into reports.
 const own=scanUserClauses(text).filter(clause=>!clause.quoted&&!clause.code&&(!clause.conditional||summaryReplyQuestion.test(clause.text.trim()))&&!clause.attributedToOther).map(clause=>{
  const protectedSpans=[...clause.quoteSpans,...clause.codeSpans]
  const commandText=clause.text.split('').map((char,index)=>protectedSpans.some(span=>clause.start+index>=span.start&&clause.start+index<span.end)?' ':char).join('')
  return {...clause,commandText}
 })
 const instructions=own.filter(clause=>assistantRequestClause(clause.commandText))
 let comparisonIndex=-1,comparisonStop=-1
 own.forEach((clause,index)=>{if(comparisonRequestClause(clause.commandText))comparisonIndex=index;if(comparisonStopClause(clause.commandText))comparisonStop=index})
 const comparisonRequested=comparisonIndex>comparisonStop&&!currentConversationOnly(text)
 const judgmentUpdate=instructions.some(clause=>/(?:更新|调整|重开).{0,16}(?:判断|理解)/.test(clause.commandText))
 const actionInstructions=instructions.filter(clause=>!/^(?:请|麻烦)?(?:这周|本周|今天|现在)?(?:先|暂时)?(?:不要|不用|不|别)/.test(clause.commandText.trim())&&(nextStepChoiceRequest(clause.commandText)||/(?:给|安排|提供|设计).{0,24}(?:行动|验证|下一步|动作|步骤|任务|区分办法|实验|试验|(?:能|可)开始的一步)/.test(clause.commandText)))
 const nextActionQuestions=currentConversationOnly(text)?[]:instructions.filter(clause=>nextActionQuestion.test(clause.commandText.trim()))
 const actionRequested=actionInstructions.length>0||nextActionQuestions.length>0
 const multipleTrialRequest=new RegExp('^(?:请|麻烦)?(?:同时|并|再|先)?(?:安排|进行|做)[两二三四五六七八九十2-9](?:次|轮)'+independentTrialNouns)
 const explicitMultipleTrials=own.some(clause=>!clause.interrogative&&multipleTrialRequest.test(clause.commandText))
 const actionLimit=!explicitMultipleTrials&&(actionInstructions.some(clause=>nextStepChoiceRequest(clause.commandText)||/(?:^|[^\d一二两三四五六七八九十百千])(?:一|1)(?:个|次|步|条|项)[^。！？\n]{0,20}(?:行动|验证|动作|步骤|区分办法|实验|试验|下一步建议)|给.{0,8}(?:能|可)开始的一步/.test(clause.commandText))||nextActionQuestions.length>0)?1:undefined
 const summaryRequested=judgmentUpdate||instructions.some(clause=>summaryReplyRequest.test(clause.commandText)||summaryReplyQuestion.test(clause.commandText)||/(?:说明|总结|回读).{0,16}(?:判断|理解|未知)/.test(clause.commandText)||/^(?:请|麻烦)?(?:给|提供)(?:我)?(?:当前|暂定|阶段)?(?:理解|判断|总结)/.test(clause.commandText))
 const sentenceLimit=instructions.some(clause=>summaryReplyRequest.test(clause.commandText)&&clause.commandText.includes('一句'))?1:undefined
 const singleJobRequested=own.some(clause=>!clause.interrogative&&/^(?:我(?:愿意|想|目前|现在)?|请|麻烦)?(?:再|先)?(?:帮我)?(?:先)?只(?:愿意|想|要)?(?:了解|核对|看|查看|筛选)[^。！？\n]{0,10}一(?:个|份|条)[^。！？\n]{0,16}(?:岗位|职位|JD|招聘)/.test(clause.commandText.trim()))
 const explicitMultipleJobDescriptions=own.some(clause=>!clause.interrogative&&/^(?:但|并|还|同时)?(?:请|我想|我要)?(?:阅读|读|看|查看|对照|比较|对比)[^。！？\n]{0,16}(?:[2-9]\d*|1\d+|[两二三四五六七八九十]+)(?:\s*[-–—~至]\s*\d+)?\s*(?:个|份|条|篇)\s*(?:(?:该|这个)岗位的)?(?:JD|jd|岗位描述)/.test(clause.commandText.trim()))
 return {instructions,judgmentUpdate,actionRequested,actionLimit,comparisonRequested,summaryRequested,sentenceLimit,singleJobRequested,explicitMultipleJobDescriptions}
}
// A status report alone does not express an affirmative pursuit. A separate
// explicit wish remains valid even if the student has not started it yet.
export function unstartedActivityOnlyClause(text:string):boolean{
 return /(?:尚未|还未|还没(?:有)?|未|没有|没)(?:开始|启动|着手)/.test(text)
  && !/(?:想|打算|希望|计划|决定|目标|优先)|^(?:我|本人)(?:要|将|准备)/.test(text.trim())
}
// Deferring a named alternative records a boundary, not an active pursuit.
export function deferredPursuitClause(text:string):boolean{
 return /(?:稍后|以后|之后|改天|过阵子|过段时间|晚些时候)再(?:看|说)|(?:暂时|暂|先)不(?:推进|继续|安排|扩大|备考|复习)/.test(text)
}
// Explicit withdrawal names an object after a negative intention. A habit
// boundary such as 不再熬夜 is affirmative change, not a withdrawn path.
export function namedMatterEndTarget(text:string):string|null{
 for(const clause of scanUserClauses(text)){
  if(clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.attributedToOther||clause.quoteSpans.length||clause.codeSpans.length)continue
  const target=/^(?:我|本人)(?:现在|目前)?(?:决定|确定)?结束(.+?)(?:这件事|这一步)$/.exec(clause.text.trim())?.[1]?.trim()
  if(target)return target
 }
 return null
}
export function namedMatterTargetMatches(title:string,target:string):boolean{
 const name=title.replace(/[（(][^）)]*[）)]\s*$/,'').trim()
 return name===target||name.endsWith('的'+target)
}
export function withdrawnPursuitTarget(text:string):string|null{
 for(const clause of scanUserClauses(text)){
  if(clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.attributedToOther||clause.quoteSpans.length)continue
  const match=/^(?:但|但是|不过|现在|目前|最后|最终)?(?:我|本人)?(?:现在|目前|已经)?(?:想|决定|确定|打算)?(?:不再(?:准备|参加|走)?|不准备再(?:参加)?|不打算(?:再)?|不想(?:再)?|放弃|退出)(.+)$/.exec(clause.text.trim())
  const target=match?.[1]?.replace(/[。！？]+$/,'').trim()
  if(target&&/考研|研究生考试|保研|推免|考公|考编|公务员|就业|求职|实习|创业|留学|专升本|自由职业|接单|科研|竞赛/.test(target)&&!/(?:失败|落榜|失利|落选|后悔|受骗|吃亏|不成功)/.test(target)&&!/^(?:了解|知道|讨论|聊|分析|比较|听说)/.test(target))return target
 }
 return null
}
export function historicalIntentionClause(text:string):boolean{
 return /^(?:我|本人)?(?:以前|过去|从前|曾经|原来|之前|当时|早先|上(?:个?月|学期|周)).{0,12}(?:打算|想|计划|准备|考虑|决定|目标|希望)/.test(text.trim())
}
export function currentConversationOnly(text:string):boolean{
 const own=scanUserClauses(text).filter(c=>!c.quoted&&!c.code&&!c.conditional&&!c.attributedToOther&&!c.quoteSpans.length)
 let lastPreference=-1
 own.forEach((c,index)=>{if(conversationPreferenceClause(c.text))lastPreference=index})
 let lastReadback=-1
 own.forEach((c,index)=>{if(readbackRequestClause(c.text))lastReadback=index})
 // Refusing advice limits the answer; it does not cancel a factual readback.
 // A later explicit wish to only listen still takes precedence.
 if(lastReadback>=0&&!own.slice(lastReadback+1).some(c=>conversationPreferenceClause(c.text)
    &&!/^(?:请|麻烦)?(?:先|暂时)?(?:不要|不用|不想|不需要|别)(?:再)?(?:给(?:我)?|帮我(?:想)?)?(?:别的|其他)?(?:建议|推荐|方法|办法|做法|练法|学法|写法|攻略|行动|复盘)/.test(conversationPreferenceText(c.text))))return false
 return lastPreference>=0&&!own.slice(lastPreference+1).some(c=>summaryReplyRequest.test(c.text)
  ||comparisonRequestClause(c.text)
  ||/(?:但|不过|还是|现在|想知道|帮我|请|想问).*(?:怎么|如何|从哪|怎样|方法|办法|起草|写一|安排)/.test(c.text))
}

const actionWriteVerb='(?:生成|保存|新增|新建|创建|记录|安排|修改|更新|改动)'
const actionWriteRefusal=new RegExp(`^(?:但是|但|不过)?(?:这次|本次|今天|现在|请你?|麻烦你?|你|先|暂时){0,4}(?:不要|别|不用|不必|不需要|无需|不)(?:再|自动|帮我|给我|为我|替我)*(?<verbs>${actionWriteVerb}(?:(?:或|和)${actionWriteVerb})*)(?<scope>(?:任何|其他|新的?|额外的?|已有的?|现有的?)*)(?<objects>(?:步骤|行动|任务|计划)(?:(?:、|和|或)(?:步骤|行动|任务|计划))*)[了吧呢呀啊啦喽哦噢嘛呗哟咯嘞么罢哩诶欸]*(?![\\p{L}\\p{N}])`,'u')
export function actionWriteRestrictions(text:string){
 const refused={create:false,modify:false,plan:false}
 for(const clause of scanUserClauses(text)){
  if(clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.attributedToOther||clause.quoteSpans.length||clause.codeSpans.length)continue
  const directive=actionWriteRefusal.exec(text.slice(clause.start))?.groups
  if(!directive)continue
  const verbs=directive.verbs??'',scope=directive.scope??'',objects=directive.objects??''
  const save=/保存|记录/.test(verbs)
  const create=/(?:生成|新增|新建|创建|安排)/.test(verbs)||save&&!/已有|现有/.test(scope)
  const modify=/(?:修改|更新|改动)/.test(verbs)||save&&!/新|额外|其他/.test(scope)
  const action=/(?:步骤|行动|任务)/.test(objects)
  refused.create||=action&&create
  refused.modify||=action&&modify
  refused.plan||=objects.includes('计划')&&(create||modify)
 }
 return refused
}

// Explicit consent for this turn is independent of whether advice was requested.
// Inspect owned clauses only; quoted examples must not disable real saving.
const retentionDirective=(owned:string)=>/(?:不|不要|别|不用|不必|无需)(?:再|自动)?(?:新增|创建|修改|更新|写入|保存|记录)(?:(?:或|和|、)(?:新增|创建|修改|更新|写入|保存|记录)){0,3}(?:我(?:的)?)?(?:个人)?(?:档案|资料|目标|经历|身份|长期记忆|记忆)|(?:不|不要|别)(?:再|自动)?创建(?:任务或)?经历|不要把建议记录成/.test(owned)
 ||/(?:不要|别|不用|不必|无需)(?:再|自动|帮我)?(?:记住|存档)(?:这|那|本|上|下|我|$)|(?:不要|别|不用|不必|无需)(?:再|自动|帮我)?(?:把)?(?:这段(?:话|内容|经历)?|这件事|这(?:些|个)(?:内容|信息|经历|事实)|本轮(?:内容|经历)?|(?:下面|上面)(?:的)?(?:内容|经历|话))(?:(?:写|存|记)(?:入|进)|保存|记录|记住)|(?:不要|别|不用|不必|无需)(?:再|自动|帮我)?(?:保存|记录)(?:下面|上面|这段|这件|这些)|(?:不要|别|不用|不必|无需)(?:再|自动|帮我)?(?:存|记|写)(?:入|进)(?:个人)?(?:档案|资料|长期记忆|记忆)/.test(owned)
export function profileWritesDisallowed(text:string):boolean{
 const entire=text.trim().replace(/[。！？!?]+$/,'').trim()
 for(const [open,close] of [['“','”'],['‘','’'],['「','」'],['『','』'],['"','"'],["'","'"]] as const){
  const end=entire.lastIndexOf(close)
  if(entire.startsWith(open)&&end>=open.length&&/^[\p{P}\p{S}\s]*$/u.test(entire.slice(end+close.length))&&retentionDirective(entire.slice(open.length,end).trim()))return true
 }
 return scanUserClauses(text).some(c=>{
  if(c.quoted||c.code||c.conditional||c.attributedToOther)return false
  const owned=c.text.split('').map((char,index)=>[...c.quoteSpans,...c.codeSpans].some(span=>c.start+index>=span.start&&c.start+index<span.end)?' ':char).join('')
  // Retention directives have both verb-object (别记住这段话) and
  // 把-object-verb (不要把这件事记入长期记忆) order. They are permissions
  // for every personal-write lane, independent of the provider's output.
  return retentionDirective(owned)})
}

const quotePairs:[string,string][]=[['“','”'],['‘','’'],['「','」'],['『','』'],['"','"'],["'","'"]]
const sentenceTerminators=new Set(['。','！','？','!','?',';','；','．','\n'])
const clauseDelimiters=new Set(['，',',','、'])
const knownAsciiSuffixes=new Set(['com','cn','org','net','edu','gov','io','ai','co','uk','dev','app','me','md','txt','json','jsonl','yaml','yml','toml','xml','html','htm','css','js','jsx','ts','tsx','mjs','cjs','py','java','sql','csv','tsv','pdf','doc','docx','xls','xlsx','ppt','pptx','zip','tar','gz','png','jpg','jpeg','gif','svg','webp','mp3','mp4','mov','avi','log'])
const knownDotfiles=new Set(['env','gitignore','gitattributes','npmrc','dockerignore','editorconfig','prettierrc','eslintrc','stylelintrc'])
const asciiPeriodInsideToken=(text:string,index:number)=>{
  const previous=text[index-1]??'',next=text[index+1]??''
  if(/\d/.test(previous)&&/\d/.test(next))return true
  const leftRun=/[A-Za-z0-9_.-]+$/.exec(text.slice(0,index))?.[0]??''
  const rightRun=/^[A-Za-z0-9_.-]+/.exec(text.slice(index+1))?.[0]??''
  if(leftRun.startsWith('.')&&knownDotfiles.has(leftRun.slice(1).split('.')[0]!.toLowerCase())&&/^[A-Za-z0-9_-]/.test(rightRun))return true
  const finalSuffix=rightRun.split('.').at(-1)?.toLowerCase()??''
  if(/[A-Za-z0-9_-]/.test(previous)&&knownAsciiSuffixes.has(finalSuffix))return true
  // Every dot inside a conventional initialism is structural, including the
  // final dot before adjacent Chinese text.
  if(/[A-Za-z]/.test(previous)&&/[A-Za-z]/.test(next)&&text[index+2]==='.')return true
  const initialism=/(?:^|[^A-Za-z])((?:[A-Za-z]{1,4}\.)+[A-Za-z]{1,4})$/.exec(text.slice(0,index))
  // Final period in an initialism followed directly by Chinese text. Mixed-case
  // forms such as Ph.D. also stay intact before an English noun; all-caps U.S.
  // followed by a new English sentence remains a boundary.
  if(initialism&&/\p{Script=Han}/u.test(next))return true
  if(initialism&&/[a-z]/.test(initialism[1]!)&&/\s/.test(next)&&/^[A-Za-z]/.test(text.slice(index+1).trimStart()))return true
  // Only known dotfile names are protected; arbitrary `.word` remains a
  // sentence boundary so `draft.then ...` cannot join two statements.
  return !/[A-Za-z0-9]/.test(previous)&&knownDotfiles.has(rightRun.split('.')[0]!.toLowerCase())
}
// A clause-internal question never becomes a command even without ？.
// An explicitly owned reason may contain an indirect question as its object.
// Keep this shared with request routing; an actual question mark still wins.
export const reportedPurposeClause=(text:string):boolean=>/^(?:因为|为了)(?:这次|当时)(?:我|本人)/.test(text.trim())&&!/[?？]/.test(text)
const interrogativeMarkers=/(?:(完成|提交|发|做|写|整理|核对|联系|执行|开始)了?没(?:有)?\1(?:呀|啊|呢|吗|么)?)\s*$|(?:吗|呢|么|了(?:没有|没)(?:呀|啊|呢|吗|么)?)\s*$|(?:完成|提交|发|做|写|整理|核对|联系|执行|开始)了?[^，。；！？]{0,12}(?:没有|没)(?:呀|啊|呢|吗|么)?\s*$|(?:要不要|是不是|能不能|有没有|该不该|怎么办|怎么弄|如何处理|为什么|哪些|哪[个种项一件条])|^你(?:还)?记得/
const conditionalOpeners=/(?:如果|(?<![主重只必还需总概])要是|假如|假设|万一|一旦)/
const conditionalSuffix=(text:string)=>/的话\s*$/.test(text)&&!/(?:记住|记录|听到?|引用|转述|重复|想起|按照|照着|采纳|复述|回应|反驳|相信|读到?|写下|保留|翻译)[^，。；！？]{0,20}的话\s*$/.test(text)&&!explicitSpeakerPossessive.test(text)
// 明确转折或本人现实陈述：条件/转述状态在同一句内到此为止。
const resets={'conditional':/(?:^|\s)(?:但|但是|不过|然而|可是|现在|我已经|我决定|我还是|这次我)/,'attribution':/(?:^|\s)(?:但|但是|不过|然而|可是|还是我|现在我|我已经|我决定)/}
const attributionMarkers=/(?:(?:朋友|室友|同学|父母|我妈|我爸|家人|老师|导师|辅导员|学长|学姐|招聘方|招聘人员|用人单位|面试官|客户|对方|别人|大家|他|她|他们|她们)|^\s*(?:那位|这位|一位)?校友)(?:说|问|劝|让|建议|提醒|要求)|(?:说|劝)\s*[：:]|(?:说法|建议|要求|指令)(?:是)?(?:来自|源自)(?:朋友|室友|同学|父母|家人|老师|导师|客户|对方|别人|他|她|校友)/

function collectProtected(text:string):Protected[]{
  const ranges:Protected[]=[]
  const escaped=(index:number)=>{
    let slashes=0
    for(let cursor=index-1;cursor>=0&&text[cursor]==='\\';cursor--)slashes++
    return slashes%2===1
  }
  // Code fences first (they may contain quotes).
  for(let at=0;at<text.length;){
    const fence=text.indexOf('```',at)
    if(fence<0)break
    const close=text.indexOf('```',fence+3)
    if(close<0)break
    ranges.push({start:fence,end:close+3,kind:'code'})
    at=close+3
  }
  const insideCode=(index:number)=>ranges.some(range=>range.kind==='code'&&index>range.start&&index<range.end)
  // Inline backticks.
  for(let at=0;at<text.length;){
    const tick=text.indexOf('`',at)
    if(tick<0)break
    if(insideCode(tick)){at=tick+1;continue}
    const close=text.indexOf('`',tick+1)
    if(close<0)break
    ranges.push({start:tick,end:close+1,kind:'code'})
    at=close+1
  }
  const covered=(index:number)=>ranges.some(range=>index>range.start&&index<range.end)
  // Paired quotes (single pass, no cross pairing).
  for(const [open,close] of quotePairs){
    for(let at=0;at<text.length;){
      const start=text.indexOf(open,at)
      if(start<0)break
      if(covered(start)||escaped(start)){at=start+1;continue}
      // ASCII apostrophes inside English words are punctuation, not quote
      // delimiters. Chinese and boundary-delimited straight quotes still use
      // the same full-message protected-span authority as curly quotes.
      const asciiSingle=open==="'"&&close==="'"
      if(asciiSingle&&/[A-Za-z0-9]/.test(text[start-1]??'')){at=start+1;continue}
      // A straight double quote after a number is a measurement mark, not an
      // opener. An orphan closing mark after an ASCII word is likewise unable
      // to protect text through the next real quotation.
      if(open==='"'&&(/[\d零〇一二两三四五六七八九十百千万]/.test(text[start-1]??'')||/[A-Za-z]/.test(text[start-1]??'')&&/[\s,，.。;；!?！？]/.test(text[start+1]??''))){at=start+1;continue}
      let end=text.indexOf(close,start+open.length)
      const pluralPossessive=(index:number)=>{
        if(!asciiSingle||!/[sS]/.test(text[index-1]??'')||!/[\s]/.test(text[index+1]??''))return false
        // This is an interior possessive only when another delimiter can still
        // close the quote. With no later delimiter, this one must close.
        let later=text.indexOf(close,index+close.length)
        while(later>=0&&escaped(later))later=text.indexOf(close,later+close.length)
        return later>=0
      }
      while(end>=0&&(escaped(end)||asciiSingle&&(/[A-Za-z0-9]/.test(text[end+1]??'')||pluralPossessive(end))))end=text.indexOf(close,end+close.length)
      if(end<0){at=start+1;continue}
      ranges.push({start,end:end+close.length,kind:'quote'})
      at=end+close.length
    }
  }
  return ranges.sort((a,b)=>a.start-b.start)
}

const futureSiblingPredicate='(?:联系|请教|询问|发送|发|提交|交付|完成|做|写|整理|核对|尝试|开始|参加|投递)'
const futureSiblingAfterConjunction=new RegExp(`^(?:且)?(?:我|我们|本人)?(?:(?:(?:打算|计划|准备|希望|将要|将|会)(?:明天|后天|下次)?(?:再|先|去)?|(?:能够|可以|能)(?:再|先|去)?|(?:明天|后天|下次)(?:(?:会|将|打算|计划|准备)(?:再|先|去)?)?)${futureSiblingPredicate})`)
const nominalizedFutureSibling=new RegExp(`^(?:计划|准备)(?:明天|后天|下次)?(?:再|先|去)?${futureSiblingPredicate}(?:(?:前|后|时)?的|(?:给|向|到|至|往|为|对|通过|用)[^，。；！？]{1,12}的[^，。；！？]{1,20}(?:[。！？!?]|$)|[^，。；！？]{1,24}所(?:带来|造成|产生|引发)的[^，。；！？]{1,24}(?:[。！？!?]|$))`)
export const nominalizedFuturePlan=(text:string):boolean=>nominalizedFutureSibling.test(text)
// A completed action followed by 后 and an explicit future marker is a new
// tense even when the planned verb is unseen (复习、复盘、排练…). Keep only a
// small negative boundary for lexical preparation nouns/states; do not make
// future truth depend on an ever-growing action-verb catalogue.
const openFutureSiblingAfterCompletion=/^(?:我|我们|本人)?(?:(?:打算|计划|希望|将要)(?:明天|后天|下次)?(?:再|先|去)?(?!的|表|书|方案|事项|阶段|过程|情况)|准备(?:明天|后天|下次)?(?:再|先|去)?(?!了|过|好|不|充分|充足|周全|就绪|妥当|的|表|书|方案|材料|工作|事项|阶段|过程|情况)|将(?!来)|会(?!前|后|中|签(?:了|过)|诊(?:了|过)))[^，。；！？]{1,80}/
const completedSiblingVerb=`(?:${otherPerformanceVerb}|写|参加|拒绝|回绝|调研|主持|开展|组织|投递|申报|答辩|办|签|录|考|剪|排|上线|帮|带|当)`
const completedSelfBeforeSibling=new RegExp(`${completedSiblingVerb}(?:了|过|完|好)([^，。；！？]{0,16})$`)
const completedSelfBeforeAfter=/(?:完成|做完|写完|整理完|核对完|检查完|分析完|统计完|撰写完|编写完|制作完|设计完|提交完|发送完|处理完|交付完)([^，。；！？]{0,16})$/
const afterConnectorCanSplit=(prefix:string)=>{
 const tail=completedSelfBeforeSibling.exec(prefix)?.[1]??''
 // A one-character tail is commonly the first half of a lexical compound
 // (幕后、售后、产后…). Split only when it is a bounded object noun.
 return tail.length!==1||/[题表书图稿文账货码信单卷]/.test(tail)
}
function completedOwnedPrefixAt(text:string,index:number):boolean{
 const prefix=(text.slice(0,index).split(/[，,。；;！？!?\n]/).at(-1)??'').trim()
 return Boolean(firstPersonalActor(prefix)&&!otherActorClause(prefix)&&completedSelfBeforeSibling.test(prefix))
}
function completedOwnedPrefixBeforeAfter(text:string,index:number):boolean{
 const prefix=(text.slice(0,index).split(/[，,。；;！？!?\n]/).at(-1)??'').trim()
 if(!firstPersonalActor(prefix)||otherActorClause(prefix))return false
 if(completedSelfBeforeSibling.test(prefix))return true
 const completion=completedSelfBeforeAfter.exec(prefix)
 if(!completion)return false
 const beforeCompletion=prefix.slice(0,completion.index)
 return !/(?:计划|准备|打算|希望|想要|将要|将|会|还没|尚未|未曾|没有|没)[^，。；！？]{0,24}$/.test(beforeCompletion)
}
// Bare `并计划/并准备` is lexically ambiguous (合并计划、撤并计划…). Do
// not split it without `且` or a repeated actor; the experience gate handles
// an actual unsplit future sibling conservatively while source spans stay whole.
export function futureSiblingConjunctionAt(text:string,index:number):number{
 const width=text.startsWith('并且',index)||text.startsWith('同时',index)?2:text[index]==='并'||text[index]==='且'?1:0
 if(!width)return 0
 const suffix=text.slice(index+width)
 const consideredIndex=governedConsiderationIndexes(suffix)[0]??-1
 const leadingConsidered=consideredIndex>=0&&/^(?:我|我们|本人)?(?:(?:正在|正|仍在|还在|目前|现在)\s*)*$/.test(suffix.slice(0,consideredIndex))
 if(leadingConsidered){
  const prefix=(text.slice(0,index).split(/[，,。；;！？!?\n]/).at(-1)??'').trim()
  if(/[合兼吞归收购撤裁火]$/.test(prefix)||!completedOwnedPrefixAt(text,index))return 0
 }
 if(/^(?:计划|准备)/.test(suffix)){
  if(nominalizedFutureSibling.test(suffix))return 0
  const prefix=(text.slice(0,index).split(/[，,。；;！？!?\n]/).at(-1)??'').trim()
  if(/[合兼吞归收购撤裁火]$/.test(prefix)||!completedOwnedPrefixAt(text,index))return 0
 }
 if(!futureSiblingAfterConjunction.test(suffix)&&!leadingConsidered)return 0
 return width
}
export function cancelledPlanSiblingConjunctionAt(text:string,index:number):number{
  const width=text.startsWith('并且',index)||text.startsWith('同时',index)?2:text[index]==='并'||text[index]==='且'?1:0
  if(!width||!completedOwnedPrefixAt(text,index))return 0
  const suffix=text.slice(index+width)
  return /^(?:我|我们|本人)?(?:(?:已经|已|后来|最终)\s*)?(?:取消|撤销|暂停|搁置|放弃)(?:了|过)?[^，。；！？]{0,32}(?:计划|打算|安排)/.test(suffix)?width:0
}
export function completedSiblingAfterCancelledPlanAt(text:string,index:number):number{
 const width=text.startsWith('并且',index)||text.startsWith('同时',index)?2:text[index]==='并'||text[index]==='且'?1:0
 if(!width)return 0
 const prefix=(text.slice(0,index).split(/[，,。；;！？!?\n]/).at(-1)??'').trim(),suffix=text.slice(index+width).trim().replace(/[。！？!?]+$/,'')
 if(!firstPersonalActor(prefix)||otherActorClause(prefix)||!/(?:取消|撤销|暂停|搁置|放弃|否决|拒绝)(?:了|过)?[^，。；！？]{0,32}(?:计划|打算|安排|想法|设想|提议)$/.test(prefix))return 0
 if(otherActorClause(suffix,{allowOmittedSubject:true})||trailingOtherPerformer(suffix)||!completedSelfBeforeSibling.test(suffix))return 0
 return width
}
const futureSiblingSequenceTokens=['接下来','随后','然后','接着','过后','后来','之后','现在','目前','再'] as const
const futureSequenceSegmenter=new Intl.Segmenter('zh',{granularity:'word'})
const sequenceTokenHasLexicalBoundaries=(text:string,index:number,width:number)=>{
 const boundaries=new Set<number>([0,text.length])
 for(const segment of futureSequenceSegmenter.segment(text)){boundaries.add(segment.index);boundaries.add(segment.index+segment.segment.length)}
 return boundaries.has(index)&&boundaries.has(index+width)
}
export function futureSiblingSequenceAt(text:string,index:number):number{
 const token=futureSiblingSequenceTokens.find(value=>text.startsWith(value,index))
 const suffix=token?text.slice(index+token.length):''
 const considered=/^考虑(?!了|过|完|好)/.exec(suffix)
 const consideredAction=Boolean(considered&&considerationGovernsAction(suffix.slice(considered[0].length)))
 if(!token||!sequenceTokenHasLexicalBoundaries(text,index,token.length)||!(futureSiblingAfterConjunction.test(suffix)||openFutureSiblingAfterCompletion.test(suffix)||consideredAction)||!completedOwnedPrefixAt(text,index))return 0
 return token.length
}
export const futureSiblingSequenceBefore=(text:string,index:number):boolean=>futureSiblingSequenceTokens.some(token=>index>=token.length&&futureSiblingSequenceAt(text,index-token.length)===token.length)
export function futureSiblingContrastAt(text:string,index:number):number{
 const token=['但是','不过','但','又'].find(value=>text.startsWith(value,index))
 if(!token||!futureSiblingAfterConjunction.test(text.slice(index+token.length))||!completedOwnedPrefixAt(text,index))return 0
 return token.length
}
function delegatedSiblingAfterCompletionAt(text:string,index:number,clauseStart:number):number{
 if(text[index]!=='后'||!subjectlessDelegatedOtherPerformanceClause(text.slice(index+1)))return 0
 const prefix=text.slice(clauseStart,index).trim()
 return firstPersonalActor(prefix)&&!otherActorClause(prefix)&&completedSelfBeforeSibling.test(prefix)&&afterConnectorCanSplit(prefix)?1:0
}
const explicitSelfCompletionAfterObservedOther=new RegExp(`^(?:我|本人|我们)(?!的)(?:(?:又|再|随后|然后|接着|亲自|独立|共同|一起)\\s*){0,2}${completedSelfPerformanceVerb}`,'u')
function observedOtherThenExplicitSelfAt(text:string,index:number,clauseStart:number):number{
 if(text[index]!=='后'||!explicitSelfCompletionAfterObservedOther.test(text.slice(index+1)))return 0
 return explicitObservedOtherPerformanceClause(text.slice(clauseStart,index).trim())?1:0
}
function delegatedSiblingAfterAssistedSelfAt(text:string,index:number,clauseStart:number):number{
 if(text[index]!=='并'||!subjectlessDelegatedOtherPerformanceClause(text.slice(index+1)))return 0
 return assistedSelfPerformanceClause(text.slice(clauseStart,index).trim())?1:0
}
function futureSiblingAfterCompletionAt(text:string,index:number):number{
 if(text[index]!=='后'||!(futureSiblingAfterConjunction.test(text.slice(index+1))||openFutureSiblingAfterCompletion.test(text.slice(index+1)))||!completedOwnedPrefixBeforeAfter(text,index))return 0
 const prefix=(text.slice(0,index).split(/[，,。；;！？!?\n]/).at(-1)??'').trim()
 return afterConnectorCanSplit(prefix)?1:0
}
export function consideredFutureSiblingAfterCompletionAt(text:string,index:number):number{
 if(text[index]!=='后')return 0
 const suffix=text.slice(index+1),considered=/^考虑(?!了|过|完|好)/.exec(suffix)
 if(!considered||!considerationGovernsAction(suffix.slice(considered[0].length))||!completedOwnedPrefixBeforeAfter(text,index))return 0
 const prefix=(text.slice(0,index).split(/[，,。；;！？!?\n]/).at(-1)??'').trim()
 return afterConnectorCanSplit(prefix)?1:0
}
function prerequisiteObservationAfterCompletionAt(text:string,index:number,clauseStart:number):number{
  if(!text.startsWith('后发现',index))return 0
  const suffix=(text.slice(index+1).split(/[，,。；;！？!?\n]/)[0]??'')
  if(!/(?:才可以|才能|方可)/.test(suffix))return 0
  const prefix=text.slice(clauseStart,index).trim()
  return firstPersonalActor(prefix)&&!otherActorClause(prefix)&&completedSelfBeforeSibling.test(prefix)&&afterConnectorCanSplit(prefix)?1:0
}
export function scanUserClauses(text:string):UserClause[]{
  const protectedRanges=collectProtected(text)
  const isProtected=(index:number)=>protectedRanges.some(range=>index>=range.start&&index<range.end)
  const kindAt=(start:number,end:number,kind:'quote'|'code')=>{
    let overlap=0,total=0
    for(let index=start;index<end;index++){
      if(/\s/.test(text[index]!))continue
      total++
      const range=protectedRanges.find(candidate=>index>=candidate.start&&index<candidate.end)
      if(range&&range.kind===kind)overlap++
    }
    return total>0&&overlap>=total
  }
  const clauses:UserClause[]=[]
  // Sentence state machines reset at sentence terminators only; commas carry
  // condition/attribution forward within the sentence.
  let sentenceStart=0,clauseStart=0,sentenceConditional=false,sentenceAttributed=false
  let pending:UserClause|null=null
  const boundary=(end:number,delimiter:string,sentenceEnd:number,nextStart=end+1)=>{
    const body=text.slice(clauseStart,end)
    if(!body.trim()){clauseStart=nextStart;return}
    const clause:UserClause={
      start:clauseStart,end,text:body,delimiter,
      sentenceStart,sentenceEnd,
      quoted:kindAt(clauseStart,end,'quote'),
      code:kindAt(clauseStart,end,'code'),
      conditional:sentenceConditional,
      attributedToOther:sentenceAttributed,
      interrogative:false,
      quoteSpans:protectedRanges.filter(range=>range.kind==='quote'&&range.start>=clauseStart&&range.end<=end).map(range=>({start:range.start,end:range.end})),
      codeSpans:protectedRanges.filter(range=>range.kind==='code'&&range.start>=clauseStart&&range.end<=end).map(range=>({start:range.start,end:range.end})),
    }
    const uncertaintyReport=(/^(?:但|也|不过)?(?:我|本人)(?:还|仍|也|现在|目前)?(?:说不清|不知道|不清楚|不确定|记不清)/.test(body.trim())||/(?:不(?:知道|清楚|确定)|没(?:有)?(?:说|说明|确认)|未(?:说明|确认|报告))[^，。]{0,8}(?:有没有|是否)/.test(body.trim()))&&!/(?:[吗呢]|[^什]么)\s*$/.test(body.trim())
    const prior=clauses.at(-1)
    const inheritedOwner=prior?.sentenceStart===sentenceStart&&!prior.quoted&&!prior.code&&!prior.conditional&&!prior.attributedToOther&&!prior.interrogative&&!prior.quoteSpans.length&&!prior.codeSpans.length&&/^(?:我|本人)/.test(prior.text.trim())&&!assistantRequestClause(prior.text)
    // “看出哪些信息关键” is the object of an owned intention, not a
    // question to the assistant. Ellipsis may inherit only the adjacent
    // unprotected first-person statement, within this sentence.
    const intentionBody=body.trim().replace(/^(?:我|本人)/,'')
    const questionObjectMarker=/(?:为什么|怎么|如何|哪些|哪[个种项一件条])/.exec(body.trim())
    const completedQuestionObject=Boolean(questionObjectMarker&&completedOwnedAspectBefore(body.trim(),questionObjectMarker.index))
    const indirectQuestion=reportedPurposeClause(body+delimiter)||completedQuestionObject||(/^(?:我|本人)/.test(body.trim())||inheritedOwner)&&/^(?:主要)?(?:想|希望|计划|打算|需要|正在|已经)(?:要)?(?:更快)?(?:了解|知道|核对|确认|弄清|找出|看出|分清|识别)/.test(intentionBody)
    clause.interrogative=/[?？]/.test(delimiter)||!uncertaintyReport&&!indirectQuestion&&(interrogativeMarkers.test(body.trim())||/^(?:那|现在|接下来)?(?:怎么|如何|怎样|从哪)(?:开始|做|聊|准备|安排|处理|选)/.test(body.trim()))
    // A clause that is ITSELF the realistic statement after the conditional /
    // attribution prefix resets the sentence state before being recorded, so
    // 如果压力太大再说，现在先暂停考研 treats the second clause as the user's own.
    const resetsConditionalHere=resets.conditional.test(body)
    const resetsAttributionHere=resets.attribution.test(body)&&/我/.test(body)
    // A clause carrying its own attribution marker (朋友说：…) speaks for
    // someone else; commas never wash that away within the sentence.
    const attributionMatch=attributionMarkers.exec(body)
    const reportedSpeechAttribution=Boolean(attributionMatch&&/(?:说|问|劝|建议|提醒)/.test(attributionMatch[0]))
    const opensAttributionHere=Boolean(attributionMatch)&&(!assistedSelfPerformanceClause(body)||reportedSpeechAttribution)
    if(opensAttributionHere)clause.attributedToOther=true
    if(resetsConditionalHere)clause.conditional=false
    if(resetsAttributionHere)clause.attributedToOther=false
    // The opening conditional clause is hypothetical too, not only the clauses
    // following it. A realistic reset cannot override its own new condition.
    const opensConditionalHere=conditionalOpeners.test(body)||conditionalSuffix(body.trim())
    if(opensConditionalHere)clause.conditional=true
    clauses.push(clause)
    // Sentence-level state transitions for the NEXT clause in this sentence.
    if(opensConditionalHere)sentenceConditional=true
    if(opensAttributionHere)sentenceAttributed=true
    if(resetsConditionalHere&&!opensConditionalHere)sentenceConditional=false
    if(resetsAttributionHere)sentenceAttributed=false
    clauseStart=nextStart
  }
  for(let index=0;index<text.length;index++){
    if(isProtected(index))continue
    const char=text[index]!
    if(sentenceTerminators.has(char)||char==='.'&&!asciiPeriodInsideToken(text,index)){
      boundary(index,char,index+1)
      sentenceStart=index+1
      sentenceConditional=false
      sentenceAttributed=false
    }else if(futureSiblingSequenceAt(text,index)){
      const width=futureSiblingSequenceAt(text,index),next=index+width
      boundary(index,text.slice(index,next),next,next)
      index+=width-1
    }else if(char==='后'&&(delegatedSiblingAfterCompletionAt(text,index,clauseStart)||observedOtherThenExplicitSelfAt(text,index,clauseStart)||futureSiblingAfterCompletionAt(text,index)||consideredFutureSiblingAfterCompletionAt(text,index)||prerequisiteObservationAfterCompletionAt(text,index,clauseStart))){
      // One sentence can change performer without punctuation. Preserve the
      // completed self action as its own verbatim source and keep the delegated
      // sibling out of personal experience evidence.
      const next=index+1
      boundary(index,char,next,next)
    }else if((char==='但'||char==='不'||char==='又')&&futureSiblingContrastAt(text,index)){
      const width=futureSiblingContrastAt(text,index),next=index+width
      boundary(index,text.slice(index,next),next,next)
      index+=width-1
    }else if(char==='并'&&delegatedSiblingAfterAssistedSelfAt(text,index,clauseStart)){
      // Guidance can establish a self-owned first action and then switch to a
      // delegated performer without punctuation. Preserve both exact spans.
      const next=index+1
      boundary(index,char,next,next)
    }else if((char==='并'||char==='且'||text.startsWith('同时',index))&&(futureSiblingConjunctionAt(text,index)||cancelledPlanSiblingConjunctionAt(text,index)||completedSiblingAfterCancelledPlanAt(text,index))){
      // Split a completed report from its explicitly future sibling while
      // retaining one sentence identity. This keeps the first action usable
      // without turning the planned second action into experience evidence.
      const width=futureSiblingConjunctionAt(text,index)||cancelledPlanSiblingConjunctionAt(text,index)||completedSiblingAfterCancelledPlanAt(text,index),next=index+width
      boundary(index,text.slice(index,next),next,next)
      index+=width-1
    }else if(clauseDelimiters.has(char)){
      boundary(index,char,index+1)
    }
  }
  if(clauseStart<text.length){pending=null;boundary(text.length,'',text.length)}
  return clauses
}

// N1.2 exact hour parsing. Returns precise integer minutes only; a value that
// cannot be expressed in whole minutes is refused rather than rounded.
export function parseExactHours(token:string):number|null{
  const trimmed=token.trim()
  if(!trimmed)return null
  // 一小时半/一个半小时 are 90 minutes; a bare 半小时 is exactly 30.
  if(/^(?:一个|一)?小时半$/.test(trimmed))return 90
  if(/^(?:一个|一)?半(?:小时|钟头)$/.test(trimmed))return trimmed.startsWith('一')?90:30
  if(/^\d+(?:\.\d{1,2})?$/.test(trimmed)){
    const [whole,frac]=trimmed.split('.')
    if(!frac)return Number(whole)*60
    // Decimal digits are tenths/hundredths of an hour; only values that are
    // exact whole minutes resolve (1.5->90, 1.75->105), never rounded.
    const minutes=(Number(whole)+Number('0.'+frac))*60
    return Number.isInteger(minutes)?minutes:null
  }
  if(!/^[零一二两三四五六七八九十百]+$/.test(trimmed))return null
  const digits:Record<string,number>={零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9}
  const units:Record<string,number>={十:10,百:100}
  let total=0,current=0
  for(const char of trimmed){
    if(char in digits)current=current*10+digits[char]!
    else if(char in units){total+=(current||1)*units[char]!;current=0}
  }
  const hours=total+current
  return Number.isSafeInteger(hours)&&hours>=0&&hours<=10080/60?hours*60:null
}

export function unresolvedTwoFactors(userText:string,onSource?:(quote:string)=>void):{first:string;second:string}|null{
  const ownedObservationClause=(clause:UserClause)=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.interrogative&&!clause.attributedToOther&&!clause.quoteSpans.length&&!clause.codeSpans.length
  const clauses=scanUserClauses(userText)
  for(let index=0;index<clauses.length;index++){
    const clause=clauses[index]!
    if(!ownedObservationClause(clause))continue
    // A comma may separate the alternatives. Join only consecutive clauses
    // in the same sentence with the same verified ownership, never quotations
    // or another speaker's report. Recognition and rendering share this parse.
    let end=clause.end
    for(let next=index+1;next<clauses.length;next++){
      const following=clauses[next]!
      if(following.sentenceStart!==clause.sentenceStart||!ownedObservationClause(following))break
      end=following.end
    }
    const text=userText.slice(clause.start,end)
    const match=/(?:(?:不(?:能)?|没(?:有)?|尚未|还没(?:有)?|尚不|还不|无法)(?:确定|清楚|明白|判断|分辨|区分|知道|确认)|(?:分|辨|看)不(?:清|出))(?:究竟|到底)?(?:是)?([^，,。！？\n]{1,30}?)[，,\s]*(?:还是|或是|和|与)[，,\s]*([^，,。！？\n]{1,30})/.exec(text)
    // Only a directly owned uncertainty assertion may trigger a deterministic
    // response. Embedded/negated beliefs remain on the ordinary generation path.
    if(match&&!/^(?:(?:但|不过|可是|我|本人|还|仍|仍然|也|现在|目前|已经)\s*)*$/.test(text.slice(0,match.index).trim()))continue
    const first=match?.[1]?.trim(),second=match?.[2]?.trim()
    // An unresolved choice (for example, study versus work) is not evidence
    // of two causal factors. Only explicit causal wording enters this lane.
    if(first&&second&&/带来|造成|导致|引起|来源|作用|原因/.test(match![0])){onSource?.(text);return {first,second}}
  }
  return null
}
