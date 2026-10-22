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
export function conversationPreferenceClause(text:string):boolean{
 if(/^(?:今天|现在)?(?:请|麻烦)?(?:先)?听我(?:说|聊聊)/.test(text.trim()))return true
 text=text.trim().replace(/^(?:也|并且|而且|但|不过|可是)/,'')
 text=text.replace(/^(今天|现在|这次)(我|本人)/,'$2$1')
 if(refusalPreferenceClause(text))return true
 if(/^(?:先|暂时)?(?:别|不要|不用)(?:再)?(?:给我|帮我)?安排(?:了)?$/.test(text)
  ||/^(?:先|暂时)?(?:别|不要|不用)(?:再)?给(?:它|这件事|那件事)(?:安排|排)(?:任务)?(?:了)?$/.test(text))return true
 if(/^(?:今天|现在|这次|目前)?(?:只想|就想)(?:听|聊|说说|倾诉)|^(?:今天|现在)?(?:先)?听我(?:讲|说)/.test(text))return true
 return /^(?:我(?:今天|现在|目前|这次|最近|先|暂时)?(?:只想|只是想|就想|想|只希望|希望)(?:你)?(?:先)?(?:听(?:我|你|说)|聊|说(?:说|一下|点)|倾诉|吐(?:个)?槽|陪我)|(?:请|麻烦)?(?:先|暂时)?(?:不要|不用|不想|不需要|别)(?:再)?(?:给(?:我)?|帮我(?:想)?)?(?:别的|其他)?(?:建议|推荐|方法|办法|做法|练法|学法|写法|攻略|行动|复盘)|(?:先)?听我说)/.test(text.trim())
}
// A request to the assistant is not autobiographical evidence. Keep this
// separate from listening preferences: positive requests still need delivery.
export function methodReferenceClause(text:string):boolean{
 return /^(?:请|麻烦|那就|那|就|先)?(?:用|按|参考)(?:刚才|上次|那个|这个)[^。！？\n]{0,20}(?:方法|攻略|指南)|^接着上次[^。！？\n]{0,20}(?:方法|攻略|指南)/.test(text.trim())
}
const summaryReplyRequest=/^(?:请|麻烦|我(?:只)?(?:想|希望)(?:要)?)?(?:只|先)?(?:(?:(?:给|说|写)(?:我)?)?一(?:句|段)(?:阶段|当前|暂定)?(?:理解|判断|总结)(?:就好|即可|就行)?|(?:用|以)一(?:句|段)(?:话)?(?:说明|概括|总结|表述|给出)[^。！？\n]{0,40}(?:理解|判断|总结|未知)[^。！？\n]{0,20})$/
const summaryReplyQuestion=/^你(?:目前|现在|这次|本轮)?(?:能不能|可不可以|能|可以)(?:形成|给出|说说)(?:什么|怎样的|一个|一段)?(?:当前|暂定|阶段)?(?:理解|判断|总结)[？?]?$/
function comparisonRequestClause(text:string):boolean{
 const body=text.trim().replace(/^(?:现在|今天|这次)/,'').replace(/^(?:我)?(?:想|希望)(?:让你|请你|你)/,'')
 if(/^(?:比较|对比|权衡)(?:了|过|完|后|时|中|这个词|一词|是指|是什么意思)/.test(body))return false
 return /^(?:请|麻烦)?(?:再|先|只)?(?:帮我)?(?:比较|对比|权衡)/.test(body)
   ||/^(?:请|麻烦)?(?:再|先|只)?(?:帮我)?(?:用|以)(?:表格|一段|文字|简短语言|两句话)(?:来)?(?:比较|对比|权衡)/.test(body)
   ||/^(?:你)?(?:能不能|可不可以|能|可以)(?:先)?(?:帮我)?(?:比较|对比|权衡)/.test(body)
}
function comparisonStopClause(text:string):boolean{
 return /^(?:现在|今天|这次)?(?:请|麻烦)?(?:先|暂时)?(?:不要|不用|别|不)(?:再|自动)?(?:给我|帮我)?(?:比较|对比|权衡)/.test(text.trim())
}
// A list item's instruction ownership comes from its actual list head.
export function assistantInstructionClause(sourceText:string,clause:Pick<UserClause,'start'|'end'|'text'>,clauses:readonly Pick<UserClause,'start'|'end'|'text'>[]):boolean{
 let index=clauses.findIndex(row=>row.start===clause.start&&row.end===clause.end)
 if(index<0)return assistantRequestClause(clause.text)
 while(index>0&&/^[、\s]*$/.test(sourceText.slice(clauses[index-1]!.end,clauses[index]!.start)))index--
 return assistantRequestClause(clause.text)||assistantRequestClause(clauses[index]!.text)
}
export function assistantRequestClause(text:string):boolean{
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
  ||/^(?:请|麻烦)?(?:再|先|只|继续|直接|马上|现在)?(?:帮我|给我|替我)(?:先|继续)?(?:想|处理|解释|看看|分析|安排|写|修改|听|聊|整理|起草|拟|一(?:个|步|句|段|份|条))/.test(clause)
  ||/^(?:请|麻烦)(?:先|继续)?(?:处理|解释|看看|分析|安排|写|修改|听|聊|沿用|给|提供|设计)/.test(clause)
  ||/^(?:请|麻烦)(?:先|只|重新|继续)?(?:更新|调整|重开|核对|说明|总结|比较|区分)/.test(clause)
  ||/^(?:请|麻烦)?(?:并|再|先|只)?给(?:我)?(?:[一两二三四五六七八九十]+|\d+(?:[-–—~至]\d+)?)(?:个|条|步|项)[^。！？\n]{0,24}(?:验证|行动|动作|步骤|办法|问题|下一步建议)/.test(clause)
  ||/^(?:请|麻烦)?(?:这周|本周|今天|现在)?(?:先|暂时)?(?:不要|别|不用|不)(?:再|自动)?(?:给我|帮我|让我)?(?:生成|安排|新增|删除|催促|追问|继续行动|用|替我|重开)/.test(clause)
  ||/^(?:只|先|暂时)?(?:说明|总结|更新|调整|核对)(?:当前|相关|本轮|这段|受影响|已报告|暂定|仍未知|各自|上述|此前|新信息|判断|理解|状态)/.test(clause)
  ||/^(?:请|麻烦)?(?:依据|根据|基于|结合)(?:新信息|这条|这次|当前|已报告|上述|这些)[^。！？\n]{0,40}(?:更新|说明|总结|调整)[^。！？\n]{0,16}(?:判断|理解)/.test(clause)
  ||/^(?:请|先|只)?保留(?:未知|此前|已报告|原有|已有)/.test(clause)
  ||/^(?:请|麻烦)(?:重新|再|先|只)?(?:按|根据|结合|基于|依据)[^。！？\n]{0,80}(?:给出|说明|分析|整理|列出)/.test(clause)
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
 const actionInstructions=instructions.filter(clause=>!/^(?:请|麻烦)?(?:这周|本周|今天|现在)?(?:先|暂时)?(?:不要|不用|不|别)/.test(clause.commandText.trim())&&/(?:给|安排|提供|设计).{0,24}(?:行动|验证|下一步|动作|任务|区分办法|实验|试验|(?:能|可)开始的一步)/.test(clause.commandText))
 const actionRequested=actionInstructions.length>0
 const multipleTrialRequest=new RegExp('^(?:请|麻烦)?(?:同时|并|再|先)?(?:安排|进行|做)[两二三四五六七八九十2-9](?:次|轮)'+independentTrialNouns)
 const explicitMultipleTrials=own.some(clause=>!clause.interrogative&&multipleTrialRequest.test(clause.commandText))
 const actionLimit=!explicitMultipleTrials&&actionInstructions.some(clause=>/(?:^|[^\d一二两三四五六七八九十百千])(?:一|1)(?:个|次|步|条|项)[^。！？\n]{0,20}(?:行动|验证|动作|区分办法|实验|试验|下一步建议)|给.{0,8}(?:能|可)开始的一步/.test(clause.commandText))?1:undefined
 const summaryRequested=judgmentUpdate||instructions.some(clause=>summaryReplyRequest.test(clause.commandText)||summaryReplyQuestion.test(clause.commandText)||/(?:说明|总结|回读).{0,16}(?:判断|理解|未知)/.test(clause.commandText)||/^(?:请|麻烦)?(?:给|提供)(?:我)?(?:当前|暂定|阶段)?(?:理解|判断|总结)/.test(clause.commandText))
 const sentenceLimit=instructions.some(clause=>summaryReplyRequest.test(clause.commandText)&&clause.commandText.includes('一句'))?1:undefined
 const singleJobRequested=own.some(clause=>!clause.interrogative&&/^(?:我(?:愿意|想|目前|现在)?|请|麻烦)?(?:先)?只(?:愿意|想|要)?(?:了解|看|查看|筛选)[^。！？\n]{0,10}一(?:个|份|条)[^。！？\n]{0,16}(?:岗位|职位|JD|招聘)/.test(clause.commandText.trim()))
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
export function currentConversationOnly(text:string):boolean{
 const own=scanUserClauses(text).filter(c=>!c.quoted&&!c.code&&!c.conditional&&!c.attributedToOther&&!c.quoteSpans.length)
 let lastPreference=-1
 own.forEach((c,index)=>{if(conversationPreferenceClause(c.text))lastPreference=index})
 return lastPreference>=0&&!own.slice(lastPreference+1).some(c=>summaryReplyRequest.test(c.text)
  ||comparisonRequestClause(c.text)
  ||/(?:但|不过|还是|现在|想知道|帮我|请|想问).*(?:怎么|如何|从哪|怎样|方法|办法|起草|写一|安排)/.test(c.text))
}

const quotePairs:[string,string][]=[['“','”'],['‘','’'],['「','」'],['『','』']]
const sentenceTerminators=new Set(['。','！','？','!','?',';','；','\n'])
const clauseDelimiters=new Set(['，',',','、'])
// A clause-internal question never becomes a command even without ？.
const interrogativeMarkers=/(?:吗|呢|么)\s*$|(?:要不要|是不是|能不能|有没有|该不该|怎么办|怎么弄|如何处理|哪些|哪[个种项一])|^你(?:还)?记得/
const conditionalOpeners=/(?:如果|(?<![主重只必还需总概])要是|假如|假设|万一|一旦)/
// 明确转折或本人现实陈述：条件/转述状态在同一句内到此为止。
const resets={'conditional':/(?:^|\s)(?:但|但是|不过|然而|可是|现在|我已经|我决定|我还是|这次我)/,'attribution':/(?:^|\s)(?:但|但是|不过|然而|可是|还是我|现在我|我已经|我决定)/}
const attributionMarkers=/(?:(?:朋友|室友|同学|父母|我妈|我爸|家人|老师|导师|辅导员|学长|学姐|招聘方|招聘人员|用人单位|面试官|客户|对方|别人|大家|他|她|他们|她们)|^\s*(?:那位|这位|一位)?校友)(?:说|问|劝|让|建议|提醒|要求)|(?:说|劝)\s*[：:]|(?:说法|建议|要求|指令)(?:是)?(?:来自|源自)(?:朋友|室友|同学|父母|家人|老师|导师|客户|对方|别人|他|她|校友)/

function collectProtected(text:string):Protected[]{
  const ranges:Protected[]=[]
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
      if(covered(start)){at=start+1;continue}
      const end=text.indexOf(close,start+open.length)
      if(end<0){at=start+1;continue}
      ranges.push({start,end:end+close.length,kind:'quote'})
      at=end+close.length
    }
  }
  return ranges.sort((a,b)=>a.start-b.start)
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
  const boundary=(end:number,delimiter:string,sentenceEnd:number)=>{
    const body=text.slice(clauseStart,end)
    if(!body.trim()){clauseStart=end+1;return}
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
    const indirectQuestion=(/^(?:我|本人)/.test(body.trim())||inheritedOwner)&&/^(?:主要)?(?:想|希望|计划|打算|需要|正在|已经)(?:要)?(?:更快)?(?:了解|知道|核对|确认|弄清|找出|看出|分清|识别)/.test(intentionBody)
    clause.interrogative=/[?？]/.test(delimiter)||!uncertaintyReport&&!indirectQuestion&&(interrogativeMarkers.test(body.trim())||/^(?:那|现在|接下来)?(?:怎么|如何|怎样|从哪)(?:开始|做|聊|准备|安排|处理|选)/.test(body.trim()))
    // A clause that is ITSELF the realistic statement after the conditional /
    // attribution prefix resets the sentence state before being recorded, so
    // 如果压力太大再说，现在先暂停考研 treats the second clause as the user's own.
    const resetsConditionalHere=resets.conditional.test(body)
    const resetsAttributionHere=resets.attribution.test(body)&&/我/.test(body)
    // A clause carrying its own attribution marker (朋友说：…) speaks for
    // someone else; commas never wash that away within the sentence.
    if(attributionMarkers.test(body))clause.attributedToOther=true
    if(resetsConditionalHere)clause.conditional=false
    if(resetsAttributionHere)clause.attributedToOther=false
    // The opening conditional clause is hypothetical too, not only the clauses
    // following it. A realistic reset cannot override its own new condition.
    const opensConditionalHere=conditionalOpeners.test(body)
    if(opensConditionalHere)clause.conditional=true
    clauses.push(clause)
    // Sentence-level state transitions for the NEXT clause in this sentence.
    if(opensConditionalHere)sentenceConditional=true
    if(attributionMarkers.test(body))sentenceAttributed=true
    if(resetsConditionalHere&&!opensConditionalHere)sentenceConditional=false
    if(resetsAttributionHere)sentenceAttributed=false
    clauseStart=end+1
  }
  for(let index=0;index<text.length;index++){
    if(isProtected(index))continue
    const char=text[index]!
    if(sentenceTerminators.has(char)){
      boundary(index,char,index+1)
      sentenceStart=index+1
      sentenceConditional=false
      sentenceAttributed=false
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
