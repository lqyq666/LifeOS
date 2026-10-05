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

