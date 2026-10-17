import {scanUserClauses} from './user-command-spans.ts'

// Selecting one question is an ordinary reply request, not a request to save
// a material. Use the existing clause boundaries for quoted/conditional text.
export function requestsOneQuestionReply(text:string):boolean{
  return scanUserClauses(text).some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&/^(?:请|麻烦|那就|先)?(?:先)?(?:帮我|给我)(?:选|找|想|确定)(?:出)?一(?:个|条)[^。！？\n]{0,14}(?:问题|提问)[。！？\s]*$/.test(clause.text.trim()))
}

// A model may obey the one-question limit while still inventing two motives
// for the student to choose between. Open that final question without another
// model call when the user did not supply both alternatives. The retained
// prefix carries the model's grounded topic; only the invented answer choices
// are removed.
export function openUnreportedChoiceQuestion(reply:string,userText:string):string|null{
  const match=/(^|[。！!；;\n]\s*)([^。！!；;\n？?]{2,100}?的)(?:是|在于)[“「『"']?([^。！？?\n]{1,80}?)[”」』"']?[，,]?\s*还是[“「『"']?([^。！？?\n]{1,80}?)[”」』"']?[？?]\s*$/.exec(reply)
  const clean=(value:string)=>value.trim().replace(/^[“「『"']|[”」』"']$/g,'')
  if(match){
    const left=clean(match[3]!),right=clean(match[4]!)
    if(userText.includes(left)&&userText.includes(right))return null
    const opened=`${match[2]}具体情况是什么？`
    return reply.slice(0,match.index)+match[1]+opened
  }
  const motive=/(^|[。！!；;\n]\s*)([^。！!；;\n？?]{2,100}?)[，,]?(?:是)?为了([^。！？?\n]{1,80}?)[，,]?\s*还是为了([^。！？?\n]{1,80}?)[？?]\s*$/.exec(reply)
  if(motive){
    const left=clean(motive[3]!),right=clean(motive[4]!)
    if(userText.includes(left)&&userText.includes(right))return null
    const subject=motive[2]!.replace(/[，,]\s*$/,'')
    return reply.slice(0,motive.index)+motive[1]+`${subject}，你希望它具体改变什么？`
  }
  const broad=/(^|[。！!；;\n]\s*)([^。！!；;\n？?]{2,160}?)[，,]\s*还是[^。！？?\n]{1,100}[？?]\s*$/.exec(reply)
  if(!broad||userText.includes('还是'))return null
  const scope=/^(.{2,50}?(?:时|中|后))[，,]/.exec(broad[2]!)?.[1]
  const opened=scope?`${scope}，具体哪一部分最影响你的感受？`:'这件事里，什么具体情况最影响你的判断？'
  return reply.slice(0,broad.index)+broad[1]+opened
}

// Grilling defaults to one decision-relevant question. This post-validation
// bound is deliberately narrow: it does not author substantive advice, and it
// runs only on ordinary/exploration turns after the provider response parses.
// It also prevents an invented contact channel from becoming the chosen next
// step when that channel is absent from the authorized text.
export function limitGrillingQuestions(reply:string,userText:string,authorizedText=userText):string|null{
  if(/(?:一起|同时|分别|批量|一组|多个|几个|三到五个|列出).{0,10}(?:问题|提问)|(?:问题|提问).{0,8}(?:一起|分别|多个|几个)/.test(userText))return null
  const questionPattern=/[^。！？?!；;\n]*[？?]/g
  const questions=[...reply.matchAll(questionPattern)]
  if(questions.length<=1)return null
  const preferred=questions.find(match=>/(?:复盘问题|下一次访谈问题|关键问题|先问这一点)[:：]?/.test(match[0]))??questions[0]!
  let selected=preferred[0].trim()
  const channels=['私人微信','微信群','QQ群','班群','群里','公开渠道','朋友圈','邮件','短信','微信']
  if(channels.some(channel=>selected.includes(channel)&&!authorizedText.includes(channel))){
    selected=authorizedText.includes('学长')?'你上次向学长具体问了什么内容？':'你上次具体向对方问了什么内容？'
  }
  let kept=false
  const bounded=reply.replace(questionPattern,question=>{
    if(!kept&&question===preferred[0]){kept=true;return selected}
    return ''
  }).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').replace(/([。！!；;])\1+/g,'$1').trim()
  return bounded&&bounded!==reply.trim()?bounded:null
}

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
    if(question.length>140||(question.match(/[？?]/g)?.length??0)!==1||/[<>`]|因为|所以|说明|表明|导致/.test(question))continue
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
    if(!/(?:谁|什么|哪|多少|多久|何时|如何|怎么|怎样|是否|有没有|是不是|还是|要不要|吗[？?]$|(?:能|可以)(?:具体|简单)?(?:说说|说一下))/.test(question))continue
    return question
  }
  return null
}

export type WeeklyPlanDraftExpectation={
  period:string
  availableMinutes:number
  allowedActions?:readonly string[]
  mustLeaveSlack:boolean
}

// The server already owns these plan boundaries before provider dispatch.
// Surface them as useful provisional content without guessing the allocation;
// the complete validated weeklyPlan still owns every task minute.
export function weeklyPlanBoundaryDraft(expected:WeeklyPlanDraftExpectation):string|null{
  if(!Number.isInteger(expected.availableMinutes)||expected.availableMinutes<=0||!expected.allowedActions?.length)return null
  const actions=[...new Set(expected.allowedActions.map(action=>action.trim()).filter(Boolean))]
  if(!actions.length||actions.length>4||actions.some(action=>action.length>40))return null
  const period=expected.period==='this_week'?'本周':expected.period==='next_week'?'下周':'当前时段'
  const draft=`${period}${expected.availableMinutes}分钟只安排${actions.join('和')}${expected.mustLeaveSlack?'，并保留未安排时间':''}`
  return draft.length<=160?draft:null
}

// A streamed plan can become visible only after its whole allocation has
// closed in the structured payload. The caller proves that boundary by
// waiting for the following top-level reply field; this helper validates the
// allocation itself against the same server-owned budget and finite task lane.
export function weeklyPlanDraft(raw:unknown,expected:WeeklyPlanDraftExpectation):string|null{
  if(!raw||typeof raw!=='object'||!Number.isInteger(expected.availableMinutes)||expected.availableMinutes<=0)return null
  const plan=raw as {period?:unknown;availableMinutes?:unknown;items?:unknown}
  if(plan.period!==expected.period||plan.availableMinutes!==expected.availableMinutes||!Array.isArray(plan.items)||plan.items.length<1||plan.items.length>12)return null
  const allowed=expected.allowedActions?.length?new Set(expected.allowedActions):null
  const parts:string[]=[]
  const seen=new Set<string>()
  let assigned=0
  for(const rawItem of plan.items){
    if(!rawItem||typeof rawItem!=='object')return null
    const item=rawItem as {action?:unknown;minutes?:unknown}
    if(typeof item.action!=='string'||typeof item.minutes!=='number'||!Number.isInteger(item.minutes)||item.minutes<=0)return null
    const action=item.action.trim()
    if(!action||action.length>80||seen.has(action)||(allowed&&!allowed.has(action)))return null
    assigned+=item.minutes
    if(assigned>expected.availableMinutes)return null
    seen.add(action);parts.push(`${action}${item.minutes}分钟`)
  }
  const remaining=expected.availableMinutes-assigned
  if(expected.mustLeaveSlack&&remaining<=0)return null
  const draft=`先安排${parts.join('、')}${remaining>0?`，保留${remaining}分钟未安排`:''}`
  return draft.length<=160?draft:null
}

// A validated structured plan owns the timetable. Preserve explanatory prose,
// but do not append a second model-authored schedule with different totals.
export function weeklyPlanExplanation(reply:string):string{
  return reply.split(/\n\s*\n/).filter(paragraph=>
    !/(?:^|\n)\s*(?:[-*•]|\d+[.)、]|【[^】\n]+】)\s*[^\n]*(?:\d|[一二两三四五六七八九十])\s*(?:min|分钟|小时)|\d+\s*[–—~～-]\s*\d+\s*(?:min|分钟|小时)/i.test(paragraph)
    &&!/(?:总计|共计|合计|未安排|含)[^。\n]{0,16}\d+\s*(?:min|分钟|小时)/i.test(paragraph)
  ).join('\n\n').trim()
}


// G3 mode-aware early draft: in reply_only turns the schema guarantees the
// payload is exactly {reply}, so the FIRST complete safe sentence of the
// streaming reply can reach the user before the whole reply validates. The
// sentence must carry real substance — politeness-only fillers, status
// claims, URLs, diagnoses, personality verdicts and policy facts stay gated.
const unsafeEarly=/(?:https?:\/\/|诊断|症状|抑郁症|焦虑症|你总是|你就是|你其实|你就是.{0,6}人|你一定|已(?:经)?(?:为你|帮你|替你)?(?:保存|记录|完成|发送|报名|起草|发出|发好|更正|更新)|保证|一定可以|肯定能|录取|报名截止|资格)/
const fillerOnly=/^(?:好的?|嗯+|哦+|行|可以|明白|了解|收到(?:更正|补充|反馈)?|谢谢|感谢|不客气|没问题|我在听|继续|加油)[。！!，,~\s]*$|^(?:好的?，)?这是一(?:条|份|段)[^。！？]{0,80}(?:消息|材料|文稿|草稿)[^。！？]{0,40}(?:复制|使用)[:：]?$/
export function safeEarlySentence(raw:string,maxChars=120):string|null{
  const opening=/^\s*(?:```(?:json)?\s*)?\{\s*"reply"\s*:\s*"/.exec(raw)
  if(!opening)return null
  let encoded=''
  for(let i=opening[0].length;i<raw.length;i++){
    const char=raw[i]
    if(char==='"')break
    encoded+=char
    let atBoundary=/[。！!？?\r\n]/.test(char)
    if(char===String.fromCharCode(92)){
      const next=raw[++i]
      if(next===undefined)break
      encoded+=next
      if(next==='u'){
        const hex=raw.slice(i+1,i+5)
        if(!/^[0-9a-f]{4}$/i.test(hex))break
        encoded+=hex;i+=4
        atBoundary=/^(?:3002|ff01|ff1f|0021|003f|000a|000d)$/i.test(hex)
      }
      else atBoundary=next==='n'||next==='r'
    }
    // No draft can surface until a sentence/paragraph boundary is complete.
    // Decode at those boundaries rather than reparsing every growing prefix.
    if(!atBoundary)continue
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
      if(unsafeEarly.test(sentence))return null
      // Salutation/name placeholders and a chat-only acknowledgement are
      // framing. Keep looking for the actual request or supportive content.
      if(/^[“「『"']?[^。！？]{0,16}(?:你好|您好)[，,\s]*(?:我是[^。！？]{1,32})?$/.test(sentence))continue
      if(/^(?:好的?[，,]?|明白[，,]?)?(?:那就)?(?:今天)?(?:不安排(?:任何)?任务|不给你安排(?:任何)?任务)(?:[，,](?:(?:就)?(?:陪你聊聊|聊聊天|聊聊)|也不催你做任何事))?$/.test(sentence))continue
      // A paragraph ending in a colon usually announces content that has not
      // arrived. A self-contained bounded allocation is already useful even
      // when the model appends a colon before elaborating it.
      const concreteAllocation=/\d+\s*(?:分钟|小时).*(?:作业|复习|任务|安排|分配).*\d+.*\d+/.test(sentence)
      if(/[:：]\s*$/.test(sentence)&&!concreteAllocation)continue
      if(/^(?:作品描述|简历|个人介绍|消息|材料|文稿|草稿|计划|清单|方案|安排)(?:已经|已)(?:按[^。！？]{0,80})?(?:撰写|起草|编写|生成|整理|准备|写好|完成)/.test(sentence))continue
      if(!sentence||fillerOnly.test(sentence)||/^这是一(?:条|份|段|句)(?:可直接复制的)?简短(?:消息|材料|文稿|草稿)(?:，发送前请自行核对老师姓名和课程名称)?[:：]$/.test(sentence)||/^(?:围绕|关于)最近一次实际选课经历，可以这样问[:：]$/.test(sentence)||/(?:消息|材料|文稿|草稿|计划|清单|方案|安排)(?:已经|已)(?:写好|整理好|准备好|规划好|完成)[^。！？]*$/.test(sentence)||/(?:我(?:已|为你|给你)|已为你).{0,8}(?:规划|整理|准备|制定|写)(?:了|好)?(?:一(?:份|个|段))?.{0,12}(?:方案|计划|安排|草稿|清单)$/.test(sentence))continue
      if(sentence.length>maxChars)return null
      if(!/[\p{L}]{2,}/u.test(sentence))continue
      return sentence
    }
  }
  return null
}
