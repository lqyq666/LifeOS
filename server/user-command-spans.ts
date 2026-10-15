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
export function scopedTaskPauseClause(text:string):boolean{
 return /^(?:我(?:现在|暂时)?)?(?:先|暂时)不(?:备考|复习)(?:了)?$/.test(text.trim())
  ||/^(?:我(?:的)?)?(?:考试复习|备考|复习)(?:这周|本周|下周)?(?:先|暂时)(?:停一下|暂停|停一停)(?:了)?$/.test(text.trim())
}
export function conversationPreferenceClause(text:string):boolean{
 if(/^(?:今天|现在)?(?:请|麻烦)?(?:先)?听我(?:说|聊聊)/.test(text.trim()))return true
 text=text.trim().replace(/^(?:也|并且|而且)/,'')
 if(refusalPreferenceClause(text))return true
 if(/^(?:先|暂时)?(?:别|不要|不用)(?:再)?(?:给我|帮我)?安排(?:了)?$/.test(text)
  ||/^(?:先|暂时)?(?:别|不要|不用)(?:再)?给(?:它|这件事|那件事)(?:安排|排)(?:任务)?(?:了)?$/.test(text))return true
 if(/^(?:只想|就想)(?:听|聊|说说|倾诉)|^(?:今天|现在)?(?:先)?听我(?:讲|说)/.test(text))return true
 return /^(?:我(?:今天|现在|目前|这次|最近|先|暂时)?(?:只想|只是想|就想|想|只希望|希望)(?:你)?(?:先)?(?:听(?:我|你|说)|聊|说(?:说|一下|点)|倾诉|吐(?:个)?槽|陪我)|(?:请|麻烦)?(?:先|暂时)?(?:不要|不用|不想|不需要|别)(?:再)?(?:给(?:我)?|帮我(?:想)?)?(?:别的|其他)?(?:建议|推荐|方法|办法|做法|练法|学法|写法|攻略|行动|复盘)|(?:先)?听我说)/.test(text.trim())
}
// A request to the assistant is not autobiographical evidence. Keep this
// separate from listening preferences: positive requests still need delivery.
export function methodReferenceClause(text:string):boolean{
 return /^(?:请|麻烦|那就|那|就|先)?(?:用|按|参考)(?:刚才|上次|那个|这个)[^。！？\n]{0,20}(?:方法|攻略|指南)|^接着上次[^。！？\n]{0,20}(?:方法|攻略|指南)/.test(text.trim())
}
export function assistantRequestClause(text:string):boolean{
 const clause=text.trim().replace(/^(?:也|并且|而且)/,'')
 return conversationPreferenceClause(clause)
  ||/^(?:先)?只(?:说|给)(?:我)?一(?:个|步|条)|^(?:别|不要)重新给(?:我)?完整计划/.test(clause)
  ||/^(?:请|麻烦|那就|那|就|先)(?:先)?(?:用|使用|按|参考|依据)[^。！？\n]{0,80}(?:攻略|指南|方法)/.test(clause)
  ||/^(?:请|麻烦)?(?:再|先|继续|直接|马上|现在)?(?:帮我|给我|替我)(?:先|继续)?(?:想|处理|解释|看看|分析|安排|写|修改|听|聊|整理|起草|拟|一(?:句|段|份|条))/.test(clause)
  ||/^(?:请|麻烦)(?:先|继续)?(?:处理|解释|看看|分析|安排|写|修改|听|聊|沿用)/.test(clause)
  ||/^(?:请)?(?:先|暂时)?(?:不要|别|不用)(?:再)?(?:帮我|给我|替我)?(?:写|添加|编造|夸大|扩写|列入|猜|推断|重写|改短|缩短|发送|代发)/.test(clause)
  ||/^(?:我想|现在想|请)?把[^。！？\n]{0,24}(?:消息|邮件|短信|文案|草稿|问题|简历|描述)[^。！？\n]{0,12}(?:改短|缩短|润色|重写)/.test(clause)
  ||/^(?:先|继续)(?:处理|解决|看|聊|整理|核对)(?:这个|这件|原来|刚才|上述|一下)/.test(clause)
  ||/^(?:请|麻烦)(?:按|根据|结合|基于|依据)[^。！？\n]{0,24}(?:帮我|给我|替我)(?:选|找|确定|想|分析|安排|写)/.test(clause)
  ||/^(?:请)?(?:不要|别)(?:把|将)[^。！？\n]{0,36}(?:当作|当成|看作|视为|算作|算成|推断|判断|认定|说成)/.test(clause)
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
 return lastPreference>=0&&!own.slice(lastPreference+1).some(c=>/(?:但|不过|还是|现在|想知道|帮我|请|想问).*(?:怎么|如何|从哪|怎样|方法|办法|起草|写一|安排)/.test(c.text))
}

const quotePairs:[string,string][]=[['“','”'],['「','」'],['『','』']]
const sentenceTerminators=new Set(['。','！','？','!','?',';','；','\n'])
const clauseDelimiters=new Set(['，',',','、'])
// A clause-internal question never becomes a command even without ？.
const interrogativeMarkers=/(?:吗|呢|么)\s*$|(?:要不要|是不是|能不能|该不该|怎么办|怎么弄|如何处理)|^你(?:还)?记得/
const conditionalOpeners=/(?:如果|(?<![主重只必还需总概])要是|假如|假设|万一|一旦)/
// 明确转折或本人现实陈述：条件/转述状态在同一句内到此为止。
const resets={'conditional':/(?:^|\s)(?:但|但是|不过|然而|可是|现在|我已经|我决定|我还是|这次我)/,'attribution':/(?:^|\s)(?:但|但是|不过|然而|可是|我|还是我)/}
const attributionMarkers=/(?:朋友|室友|同学|父母|我妈|我爸|家人|老师|辅导员|学长|学姐|别人|大家|他|她|他们|她们)(?:说|劝|让|建议|提醒|要求)|(?:说|劝)\s*[：:]/

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
    clause.interrogative=/[?？]/.test(delimiter)||interrogativeMarkers.test(body.trim())||/^(?:那|现在|接下来)?(?:怎么|如何|怎样|从哪)(?:开始|做|聊|准备|安排|处理|选)/.test(body.trim())
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
