// Only a complete plain question can appear before provenance validation.
// Facts, recommendations, materials and status claims wait for atomic commit.
export function openingQuestionDraft(raw:string):string|null{
  const opening=/^\s*(?:```(?:json)?\s*)?\{\s*"reply"\s*:\s*"/.exec(raw)
  if(!opening)return null
  let encoded=''
  for(let i=opening[0].length;i<raw.length;i++){
    const char=raw[i]
    if(char==='"')break
    encoded+=char
    let atQuestion=/[？?]/.test(char)
    if(char==='\\'){
      const next=raw[++i]
      if(next===undefined)break
      encoded+=next
      if(next==='u'){
        const hex=raw.slice(i+1,i+5)
        if(!/^[0-9a-f]{4}$/i.test(hex))break
        encoded+=hex;i+=4
        atQuestion=/^(?:ff1f|003f)$/i.test(hex)
      }
    }
    // Decode only at completed question marks, avoiding quadratic work on
    // long plain replies while still handling split JSON escapes safely.
    if(!atQuestion)continue
    let decoded:string
    try{decoded=JSON.parse('"'+encoded+'"')}catch{return null}
    if(decoded.length>16000)return null
    // Sensitive assertions anywhere in the prefix keep the whole draft gated.
    if(/https?:|\[|\]|性格|诊断|症状|焦虑症|抑郁症|已(?:经)?(?:为你|帮你|替你)?(?:保存|记录|完成|发送|报名|起草|发出|发好)|你总是|你就是|你其实/.test(decoded))return null
    const question=decoded.split(/[。！!；;\n\r]/).at(-1)!.trim()
    if(question.length>140||/[<>`]|因为|所以|说明|表明|导致/.test(question))continue
    // A question mark inside quoted speech is not a question to the user.
    // Balanced quoted noun phrases can occur in an actual neutral question.
    const pairs:Record<string,string>={'“':'”','「':'」','『':'』','‘':'’','"':'"',"'":"'"}
    let closingQuote:string|null=null,invalidQuote=false
    for(const char of question){
      if(closingQuote){if(char===closingQuote)closingQuote=null;continue}
      if(pairs[char])closingQuote=pairs[char]
      else if(/[”」』’]/.test(char)){invalidQuote=true;break}
    }
    if(closingQuote||invalidQuote)continue
    // Check interrogative form rather than enumerating names or sentence starts.
    // Recommendations and confident conclusions remain gated even as questions.
    if(/应该|必须|建议|最好|不如|肯定|显然|一定|证明|意味着|因此|于是/.test(question))continue
    if(!/(?:谁|什么|哪|何时|如何|怎么|怎样|是否|有没有|是不是|还是|要不要|吗[？?]$|(?:能|可以)(?:具体|简单)?(?:说说|说一下))/.test(question))continue
    return question
  }
  return null
}


// G3 mode-aware early draft: in reply_only turns the schema guarantees the
// payload is exactly {reply}, so the FIRST complete safe sentence of the
// streaming reply can reach the user before the whole reply validates. The
// sentence must carry real substance — politeness-only fillers, status
// claims, URLs, diagnoses, personality verdicts and policy facts stay gated.
const unsafeEarly=/(?:https?:\/\/|诊断|症状|抑郁症|焦虑症|你总是|你就是|你其实|你就是.{0,6}人|你一定|已(?:经)?(?:为你|帮你|替你)?(?:保存|记录|完成|发送|报名|起草|发出|发好|更正|更新)|保证|一定可以|肯定能|录取|报名截止|资格)/
const fillerOnly=/^(?:好的?|嗯+|哦+|行|可以|明白|了解|收到|谢谢|感谢|不客气|没问题|我在听|继续|加油)[。！!，,~\s]*$|^(?:好的?，)?这是一(?:条|份|段)[^。！？]{0,80}(?:消息|材料|文稿|草稿)[^。！？]{0,40}(?:复制|使用)[:：]?$/
export function safeEarlySentence(raw:string,maxChars=120):string|null{
  const opening=/^\s*(?:```(?:json)?\s*)?\{\s*"reply"\s*:\s*"/.exec(raw)
  if(!opening)return null
  let encoded=''
  for(let i=opening[0].length;i<raw.length;i++){
    const char=raw[i]
    if(char==='"')break
    encoded+=char
    if(char===String.fromCharCode(92)){
      const next=raw[++i]
      if(next===undefined)break
      encoded+=next
      if(next==='u'){
        const hex=raw.slice(i+1,i+5)
        if(!/^[0-9a-f]{4}$/i.test(hex))break
        encoded+=hex;i+=4
      }
    }
    let decoded:string
    try{decoded=JSON.parse('"'+encoded+'"')}catch{continue}
    if(decoded.length>16000)return null
    // Only a TERMINATED sentence can surface: the first segment is complete
    // exactly when a terminator exists; the trailing partial never shows. A
    // completed first PARAGRAPH (double newline) counts as a terminator too.
    const terminator=/([。！!？?]|\n\n|\r\n\r\n)/
    const parts=decoded.split(terminator)
    const firstTerminator=parts.findIndex((part,index)=>index%2===1)
    if(firstTerminator<1)continue
    for(let index=0;index+1<parts.length;index+=2){
      const sentence=parts[index]!.trim()
      if(!sentence||fillerOnly.test(sentence))continue
      if(sentence.length>maxChars||unsafeEarly.test(sentence))return null
      if(!/[\p{L}]{2,}/u.test(sentence))continue
      return sentence
    }
  }
  return null
}
