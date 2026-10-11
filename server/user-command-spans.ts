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
 return /^(?:我|这事|这件事|这次|上次那件事)(?:现在|暂时|先|这次)?不想继续(?:了)?[。！!\s]*$/.test(text.trim())
}
export function scopedTaskPauseClause(text:string):boolean{
 return /^(?:我(?:现在|暂时)?)?(?:先|暂时)不(?:备考|复习)(?:了)?$/.test(text.trim())
}
export function conversationPreferenceClause(text:string):boolean{
 text=text.trim().replace(/^(?:也|并且|而且)/,'')
 if(refusalPreferenceClause(text))return true
 if(/^(?:先|暂时)?(?:别|不要|不用)(?:再)?(?:给我|帮我)?安排(?:了)?$/.test(text))return true
 if(/^(?:只想|就想)(?:听|聊|说说|倾诉)|^(?:先)?听我(?:讲|说)/.test(text))return true
 return /^(?:我(?:今天|现在|目前|这次|最近|先|暂时)?(?:只想|就想|想|只希望|希望)(?:你)?(?:先)?(?:听(?:我|你|说)|聊|说(?:说|一下|点)|倾诉|吐(?:个)?槽|陪我)|(?:请|麻烦)?(?:先|暂时)?(?:不要|不用|不想|不需要|别)(?:再)?(?:给(?:我)?|帮我(?:想)?)?(?:别的|其他)?(?:建议|推荐|方法|办法|做法|练法|学法|写法|攻略|行动|复盘)|(?:先)?听我说)/.test(text.trim())
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
const interrogativeMarkers=/(?:吗|呢|么)\s*$|(?:要不要|是不是|能不能|该不该|怎么办|怎么弄|如何处理)/
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
