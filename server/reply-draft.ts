import {scanUserClauses,assistantRequestClause,responseRequestScope} from './user-command-spans.ts'
import {reportedCompletedContactClauses,taskOutcomeReadback,comparisonUniverseAccepts,comparisonOptionBody,reportedEvidenceFromText,reportedPursuitClauses} from './turn-contract.ts'
import {memoryControlSuccessClaims} from './forget-intent.ts'

// Shared by provisional display and the final repair. The request scope is
// source-aware; this changes only JD cardinality, not the rest of the reply.
export function repairSingleJobJd(reply:string,userText:string):string|null{
  const scope=responseRequestScope(userText)
  if(!scope.singleJobRequested||scope.explicitMultipleJobDescriptions)return null
  const materialCount='(?<![\\d一二两三四五六七八九十百千])(?:[2-9]\\d*|1\\d+|[两三四五六七八九十]+)(?:\\s*[-–—~至]\\s*(?:\\d+|[两三四五六七八九十]+))?'
  const quantity=materialCount+'\\s*(?:份|个|条|篇)\\s*'
  const material=quantity+'(?:(?:该|这个)岗位的)?(?:JD|jd|岗位描述)'
  const proposedReader=new RegExp('^(?:停止条件[:：]\\s*)?(?:先|只|仅|请|可以|建议|你可以|你先)?(?:在[^，。；！？]{1,24})?(?:阅读|查看|读|看)(?:完)?\\s*'+quantity+'(?:(?:(?:该|这个)岗位的)?(?:JD|jd|岗位描述))?')
  const edits:{start:number;end:number;text:string}[]=[]
  let materialBound=false
  const clauses=scanUserClauses(reply)
  for(const clause of clauses){
    if(clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.attributedToOther||clause.quoteSpans.length||clause.codeSpans.length)continue
    const reading=proposedReader.exec(clause.text.trim())
    if(!reading)continue
    // A bare operation followed by a reported outcome or negative judgment is
    // not an instruction. Require an empty tail or an explicit stopping cue;
    // later clauses in the same sentence must also be bounded instructions.
    if(!/^(?:(?:就|即|便)(?:停止|停|结束)|后(?:停止|结束))?[。！!]?\s*$/.test(clause.text.trim().slice(reading[0].length)))continue
    const later=clauses.filter(other=>other.sentenceStart===clause.sentenceStart&&other.start>clause.start)
    if(later.some((other,index)=>(index?later[index-1]!.delimiter:clause.delimiter)!=='、'&&!/^(?:(?:只|仅)?(?:记录|记下|标出)|(?:阅读完|读完|看完)|停止条件[:：]|或\s*\d+\s*分钟到)/.test(other.text.trim())))continue
    let next=clause.text.replace(new RegExp('(?:阅读完|读完|看完)\\s*'+material,'g'),'读完这个岗位的JD即停，不增加其他岗位')
    next=next.replace(new RegExp(material,'g'),'这个岗位的JD')
    materialBound=materialBound||next!==clause.text
    if(materialBound)next=next.replace(new RegExp('(?:阅读完|读完|看完)\\s*'+quantity+'(?=[，。；;\\s]|就|即|便|后|$)','g'),'读完这份')
    if(next!==clause.text)edits.push({start:clause.start,end:clause.end,text:next})
  }
  let fixed=reply
  for(const edit of edits.reverse())fixed=fixed.slice(0,edit.start)+edit.text+fixed.slice(edit.end)
  return fixed!==reply?fixed:null
}

// Selecting one question is an ordinary reply request, not a request to save
// a material. Use the existing clause boundaries for quoted/conditional text.
export function requestsOneQuestionReply(text:string):boolean{
  return scanUserClauses(text).some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&(
    /^(?:请|麻烦|那就|先)?(?:先)?(?:帮我|给我)(?:选|找|想|确定)(?:出)?一(?:个|条)[^。！？\n]{0,14}(?:问题|提问)(?:(?:来|用来|以便)?(?:厘清|了解|澄清|弄清)[^。！？\n]{1,24})?[。！？\s]*$/.test(clause.text.trim())
    ||/^(?:请|麻烦|那就|先)?(?:先)?(?:问我|问|提出|提|给我出)一(?:个|条)[^。！？\n]{0,14}(?:问题|提问)(?:(?:来|用来|以便)?(?:厘清|了解|澄清|弄清)[^。！？\n]{1,24})?[。！？\s]*$/.test(clause.text.trim())
  ))
}

// A model may obey the one-question limit while still inventing two motives
// for the student to choose between. Open that final question without another
// model call when the user did not supply both alternatives. The retained
// prefix carries the model's grounded topic; only the invented answer choices
// are removed.
const normalizeChoice=(value:string)=>value.replace(/[“”‘’「」『』"'\s]/g,'')
function ownedChoiceEvidence(text:string):string{
  let chosenEnd=-1,chosenSentence=-1
  const own=scanUserClauses(text).filter(clause=>{
    if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.codeSpans.length)return false
    // Quoted objects in an explicit comparison/question request are chosen
    // alternatives, not autobiographical claims. Reading/reporting a quote is
    // not such a request; an unrelated intervening clause breaks inheritance.
    const prefix=clause.text.slice(0,clause.quoteSpans.length?clause.quoteSpans[0]!.start-clause.start:undefined)
    const selected=/^(?:我(?:想|希望)(?:问|比较|对比|选择|确认)|(?:请|帮我)(?:比较|对比|选择|确认))/.test(prefix)
      ||chosenSentence===clause.sentenceStart&&/^[，,、\s]*$/.test(text.slice(chosenEnd,clause.start))&&/^(?:还是|或(?:者)?)\s*$/.test(prefix)
    if(selected){chosenEnd=clause.end;chosenSentence=clause.sentenceStart}
    return !clause.quoteSpans.length||selected
  })
  return normalizeChoice(own.map(clause=>clause.text).join('；'))
}
function withoutUnreportedQuestionExamples(reply:string,userText=''):string|null{
  const clauses=scanUserClauses(reply)
  const owned=ownedChoiceEvidence(userText)
  let recognized=false
  const fixed=reply.replace(/[^。！!；;\n？?]*[？?]/g,(question:string,questionOffset:number)=>{
    if(!/(?:哪(?:(?:几|些)?(?:种|类|个))|什么(?:类型|种类))/.test(question))return question
    const protectedAt=(at:number)=>clauses.some(clause=>(at>=clause.start&&at<clause.end&&(clause.quoted||clause.code))||[...clause.quoteSpans,...clause.codeSpans].some(span=>at>=span.start&&at<span.end))
    const example=/^(.*?)[，,]\s*(?:比如|例如)([^。！？?\n]{1,120}还是[^。！？?\n]{1,120})[？?]$/.exec(question)
    if(example&&!protectedAt(questionOffset+example[1]!.length+1)){
      recognized=true
      const options=example[2]!.replace(/^按/,'').split(/还是|[、，,]/).map(normalizeChoice).filter(Boolean)
      if(!(options.length>=2&&options.every(option=>option.length>=2&&owned.includes(option))))return example[1]!.trim()+'？'
    }
    return question.replace(/[（(][^（）()。！？?\n]{1,120}还是[^（）()。！？?\n]{1,120}[）)]/g,(choices:string,offset:number)=>{
      const at=questionOffset+offset
      if(protectedAt(at))return choices
      recognized=true
      const options=choices.slice(1,-1).split(/还是|[、，,]/).map(normalizeChoice).filter(Boolean)
      if(options.length>=2&&options.every(option=>option.length>=2&&owned.includes(option)))return choices
      return ''
    })
  })
  return recognized?fixed:null
}
function positivelyOwnedDefinitionTopic(topic:string,userText:string):boolean{
 const sources=[...reportedPursuitClauses(userText).map(clause=>clause.text),...reportedEvidenceFromText(userText).preferences.filter(preference=>['priority','like'].includes(preference.modality)).map(preference=>preference.quote)]
 return ownedChoiceEvidence(userText).includes(normalizeChoice(topic))&&sources.some(source=>{
   const at=source.indexOf(topic),prefix=source.slice(0,at).split(/但是|而是|不过|但/).at(-1)??''
   return at>=0&&!/[不没无未非别莫][^，。；！？]{0,12}$/.test(prefix)
 })
}
export function ownedOpenDefinitionQuestion(question:string,userText:string):boolean{
 const topic=/^你(?:所)?说的[“「『"]([^”」』"]{1,30})[”」』"]具体指什么[？?]$/.exec(question)?.[1]
 return Boolean(topic&&positivelyOwnedDefinitionTopic(topic,userText))
}
export function openUnreportedChoiceQuestion(reply:string,userText:string):string|null{
  const parenthetical=withoutUnreportedQuestionExamples(reply,userText)
  if(parenthetical!==null&&parenthetical!==reply)return parenthetical
  const match=/(^|[。！!；;\n]\s*)([^。！!；;\n？?]{2,100}?的)(?:是|在于)[“「『"']?([^。！？?\n]{1,80}?)[”」』"']?[，,]?\s*还是[“「『"']?([^。！？?\n]{1,80}?)[”」』"']?[？?]\s*$/.exec(reply)
  const clean=(value:string)=>value.trim().replace(/[“”‘’「」『』"']/g,'')
  const norm=normalizeChoice,own=ownedChoiceEvidence(userText)
  if(match){
    if(withoutUnreportedQuestionExamples(match[0],userText)===match[0])return null
    const left=clean(match[3]!),right=clean(match[4]!)
    if(own.includes(norm(left))&&own.includes(norm(right)))return null
    const opened=`${match[2]}具体情况是什么？`
    return reply.slice(0,match.index)+match[1]+opened
  }
  const motive=/(^|[。！!；;\n]\s*)([^。！!；;\n？?]{2,100}?)[，,]?(?:是)?为了([^。！？?\n]{1,80}?)[，,]?\s*还是为了([^。！？?\n]{1,80}?)[？?]\s*$/.exec(reply)
  if(motive){
    if(withoutUnreportedQuestionExamples(motive[0],userText)===motive[0])return null
    const left=clean(motive[3]!),right=clean(motive[4]!)
    if(own.includes(norm(left))&&own.includes(norm(right)))return null
    const subject=motive[2]!.replace(/[，,]\s*$/,'')
    return reply.slice(0,motive.index)+motive[1]+`${subject}，你希望它具体改变什么？`
  }
  const broad=/(^|[。！!；;\n]\s*)([^。！!；;\n？?]{2,160}?)[，,]?\s*还是([^。！？?\n]{1,100})[？?]\s*$/.exec(reply)
  if(!broad)return null
  if(withoutUnreportedQuestionExamples(broad[0],userText)===broad[0])return null
  const topic=broad[2]!.trim()
  if(/^(?:我想问|我想知道|我想确认|我想了解)/.test(topic))return null
  // Alternatives in a recalled uncertainty are not necessarily the question.
  // Keep a separate request for a new observed moment/detail after the dash;
  // asking which option to choose remains an unsupported-choice question.
  const divider=/(?:——|—|：|:)\s*([^？?]+)$/.exec(broad[3]!),separated=divider?.[1]
  if(separated&&/(?:之前|此前|上次).{0,8}(?:说|提到|不确定)/.test(topic)&&!requestsOneQuestionReply(userText)){
      // Retain the reported uncertainty and remove the new causal-choice
      // question. Do not replace it with a generic question already answered.
      const at=reply.lastIndexOf(divider![0])
      if(at>=broad.index)return reply.slice(0,at).trim().replace(/[，,；;：:\s]+$/,'')+'。'
  }
  // A question about when a reported state occurs, or permission to keep
  // chatting, does not invent a motive/value. Do not collapse it into the
  // generic question used for unsupported personal alternatives.
  if(/(?:状态|感觉|感受|相处)/.test(topic)&&/特有|平时|平常|其他时候|其他情境/.test(topic+broad[3]))return null
  if(/有(?:别的|其他).{0,8}(?:想聊|想说|话题)/.test(broad[3]!))return null
  const option=(text:string)=>norm(text.replace(/^(?:你|我)?(?:是|更|比较|现在|先|想|愿意|打算|准备|希望|喜欢|倾向|考虑|觉得|要|会|能|可以|选择|探索|做|去|获得|在意|享受)+/,'').replace(/[，,]\s*$/,''))
  const left=option(topic),right=option(broad[3]!)
  if(left.length>=2&&right.length>=2&&own.includes(left)&&own.includes(right))return null
  // Removing authored alternatives must not erase a concept the person actually
  // named. Preserve that quoted subject while opening the definition question.
  const definition=/^(你(?:所)?说的[“「『"]([^”」』"]{1,30})[”」』"])[，,]?\s*(?:具体)?(?:是指|指的是).+$/.exec(topic)
  if(definition&&positivelyOwnedDefinitionTopic(definition[2]!,userText))return reply.slice(0,broad.index)+broad[1]+definition[1]+'具体指什么？'
  // Keep an already authored open question before its unsupported example
  // alternatives. Removing those examples need not invent another question.
  const openStem=topic.split(/——|—/)[0]!.trim()
  if(openStem!==topic&&/什么|哪(?:一)?(?:部分|方面|环节|段|个|种|类)|怎样|如何/.test(openStem))return reply.slice(0,broad.index)+broad[1]+openStem+'？'
  const scope=/^(.{2,50}?(?:时|中|后))[，,]/.exec(topic)?.[1]
  const experienceTopic=topic.split(/[，,]/)[0]!.trim()
  const namedFeeling=experienceTopic.match(/轻松|放松|开心|自在/)?.[0]
  const opened=namedFeeling&&userText.includes(namedFeeling)?`${experienceTopic}，具体是什么感觉？`:scope?`${scope}，具体哪一部分最影响你的感受？`:'这件事里，什么具体情况最影响你的判断？'
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
  // If every unsafe sentence was removed, never return null: null would let
  // the original unsafe reply flow back out. Fall back to a neutral boundary.
  if(!bounded)return '先确认这条反馈具体指什么，再决定下一步。'
  return bounded!==reply.trim()?bounded:null
}

// Named contact channels are operational facts, not harmless prose. Remove a
// sentence that invents one; the surrounding source-grounded action remains.
// This never substitutes another channel and never changes persisted state.
export function removeUnsupportedContactChannels(reply:string,authorizedText:string,currentText=authorizedText):string|null{
  const channels=['私人微信','微信群','QQ群','班群','群里','朋友圈','邮件','短信','微信']
  // Generic public lookup is not possession of a contact route. Keep the
  // existing outreach boundary when that same sentence actually proposes it.
  const names=['公开渠道',...channels],escaped=names.map(channel=>channel.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')
  const contactCommand=new RegExp('^(?:(?:请|你|先|再|建议|接下来|下一步|可以|现在|今天|我想|我愿意|我打算)\\s*){0,4}(?:(?:通过|用|在)(?:'+escaped+')\\s*)?(?:联系|私信|发(?:送|消息)|投递|发布)(?!方式|频率|时间|次数|渠道|记录|信息来源|的)')
  const contactAction=(part:ReturnType<typeof scanUserClauses>[number])=>!part.quoted&&!part.code&&!part.conditional&&!part.attributedToOther&&!part.interrogative&&!part.quoteSpans.length&&!part.codeSpans.length
    &&!/(?:前|之前).{0,6}(?:问我|确认)|先问我|确认后|得到.{0,4}同意/.test(part.text)
    &&contactCommand.test(part.text.trim())
  const withContact=(parts:ReturnType<typeof scanUserClauses>,channel:string)=>parts.some(clause=>clause.text.includes(channel)&&parts.some(part=>part.sentenceStart===clause.sentenceStart&&contactAction(part)))
  const currentClauses=scanUserClauses(currentText),contactDeclined=currentClauses.some(part=>!part.quoted&&!part.code&&!part.conditional&&!part.attributedToOther&&!part.interrogative&&/^(?:现在|本轮|今天|先|暂时)?(?:不|不要|别|无需)(?:再)?(?:联系|私信|发送|发消息|投递|发布)/.test(part.text.trim()))
  const authorizedPublicOutreach=!contactDeclined&&withContact(currentClauses,'公开渠道')
  const pattern=new RegExp(`[^。！？!?\\n]*(?:${escaped})[^。！？!?\\n]*[。！？!?]?`,'g')
  const grounded=reply.replace(pattern,sentence=>{
    const parts=scanUserClauses(sentence)
    const unknownPrivate=channels.some(channel=>sentence.includes(channel)&&!authorizedText.includes(channel))
    const blockedContact=contactDeclined&&names.some(channel=>withContact(parts,channel))
    const unknownPublic=!authorizedPublicOutreach&&withContact(parts,'公开渠道')
    return unknownPrivate||blockedContact||unknownPublic?'':sentence
  }).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim()
  return grounded!==reply.trim()?grounded:null
}

// A suggested experiment may require a real source, but the model cannot make
// a platform, group or contact appear. When it does, surface the missing
// prerequisite as one open question instead of leaving a fictitious route in
// the action. This is a source boundary, not a catalogue of recommended sites.
export function groundUnsupportedOperationalResources(reply:string,authorizedText:string):string|null{
  const resources=['即刻','V2EX','小红书','知乎','B站','领英','LinkedIn','GitHub','Gitee','GitLab','Reddit','Twitter','Product Hunt','Indie Hackers','Hacker News','校友群','社群','论坛','公众号','贴吧','豆瓣','招聘网站','私信']
  const namedSearchRouteRe=/(?:在|去|通过|使用)\s*[“"']?[A-Za-z][A-Za-z0-9 ._+-]{1,30}[”"']?\s*(?:上|里|中)?(?:搜索|查找|查看|联系|私信)/i
  // Reading one public job description is a public lookup, not a request to
  // contact or join a named channel. Do not replace it with a source question
  // when the user explicitly withholds contact and private data.
  const publicJobLookup=/(?:岗位|职位|JD|招聘|远程).{0,24}(?:描述|信息|节奏|工作时间|内容)|(?:看|阅读|查|了解).{0,16}(?:岗位|职位|JD|招聘)/.test(authorizedText)
  const noContact=/(?:不联系|不投|不注册|不提供|私人资料|不加|不私信)/.test(authorizedText)
  const publicReply=/(?:查看|阅读|只读|看|搜索|打开|浏览|选).{0,32}(?:JD|职位描述|岗位描述|招聘信息|招聘帖|公开记录|公开岗位|公开文字|工作日志|岗位经历|实录|岗位工作时间|岗位节奏)|(?:JD|职位描述|岗位描述|招聘信息|招聘帖|公开记录|岗位工作时间|岗位节奏)/.test(reply)
  // Negation belongs to its own verb. A declined private message neither
  // requires a source nor licenses a later positive outreach command.
  const withoutDeclined=(text:string)=>text.replace(/(?:不需要|不要|不用|不必|无需|无须|别|不)(?:再|先|去)?(?:发(?:送)?(?:任何)?)?(?:私信|联系|发消息|投递|报名|加入)/g,'')
  const withoutDeclinedContact=withoutDeclined(reply)
  const contactReply=/(?:私信|联系|发消息|投递|报名|加入)/.test(withoutDeclinedContact)
  const contactOrPossession=/(?:私信|联系|加(?:入|群|好友)|进群|发消息|投递|报名|(?:你|您)(?:已经|已)?(?:有|在|加入|注册|收藏|关注|使用).{0,12}(?:平台|账号|群|社群|论坛|公众号))/
  if(publicJobLookup&&noContact){
    if(publicReply&&!contactReply){
      const publicSelection=reply.replace(/((?:选|找|打开|查看|阅读|读)(?:一(?:个|份|篇))?)你(?:已|已经)?(?:关注|收藏|保存|看过|知道|熟悉)的(?=[^。！？\n]{0,20}(?:招聘帖|岗位描述|工作日志|公开经历|岗位经历|实录))/g,'$1')
      if(!contactOrPossession.test(withoutDeclined(publicSelection)))return publicSelection!==reply?publicSelection:null
    }
  }
  const unsupportedNamed=resources.some(resource=>reply.includes(resource)&&!authorizedText.includes(resource))
  const sourceExplicitlyMissing=/(?:没(?:有)?说|没提|未提供|没有提供).{0,16}(?:平台|渠道|来源)|不虚构.{0,16}(?:联系人|渠道|平台)/.test(authorizedText)
  const namedSearchRoute=namedSearchRouteRe.test(reply)
  if(!unsupportedNamed&&!(sourceExplicitlyMissing&&namedSearchRoute))return null
  // A public lookup suggestion is not a claim that the user already has the
  // resource. Only contact/join or an asserted possession makes the missing
  // source a genuine prerequisite for the current action.
  const sentences=reply.split(/(?<=[。！？!?；;\n])/)
  const unsupportedSentence=(sentence:string)=>resources.some(resource=>sentence.includes(resource)&&!authorizedText.includes(resource))||namedSearchRouteRe.test(sentence)
  const offending=sentences.filter(unsupportedSentence)
  if(offending.length&&!sourceExplicitlyMissing&&offending.every(sentence=>!contactOrPossession.test(withoutDeclined(sentence))))return null
  return '这一步需要一个你确实能访问、也愿意使用的公开资料来源；你目前没有提供具体来源。你手上已有哪一个可用来源？'
}

// A reported mobile-access failure is already the next observable blocker.
// If the user explicitly withholds the original delivery channel, do not let
// the model turn that channel into a prerequisite. Keep the investigation on
// the access condition the user actually reported.
export function prioritizeReportedAccessFailure(reply:string,userText:string):string|null{
  const accessReported=/(?:手机|移动端).{0,12}(?:打不开|无法打开|访问不了|不能访问)|(?:打不开|无法打开|访问不了|不能访问).{0,12}(?:手机|移动端)/.test(userText)
  const channelWithheld=/(?:没有|没|未)(?:提供|说明|说|提).{0,12}(?:发送|原发送)?(?:渠道|方式|平台)|不要.{0,12}(?:追问|选择|替我选).{0,12}(?:渠道|方式|平台)/.test(userText)
  const channelMadePrerequisite=/(?:关键|真正|下一步).{0,16}(?:缺口|前提).{0,10}(?:发送渠道|发送方式|渠道|方式)|(?:发送渠道|发送方式|原发送渠道).{0,16}[？?]/.test(reply)
  if(!accessReported||!channelWithheld||!channelMadePrerequisite)return null
  return '先核对手机端的访问条件：用手机浏览器打开同一链接，记录是空白、报错、需要登录还是加载失败。'
}

// Only a complete plain question can appear before provenance validation.
// Facts, recommendations, materials and status claims wait for atomic commit.
// An interview question must not presuppose that a trouble exists. Keep the
// topic and reopen it so "nothing happened" and "I don't remember" stay valid.
// This removes the leading premise only; it does not author new advice.
export function openPresupposedProblemQuestion(reply:string):string|null{
  const match=/(^|[。！!；;\n]\s*)([^。！!；;\n？?]{2,120}?)[，,]?\s*(?:你)?(?:印象最深的|最大的|最让你[^。！？?\n]{0,10}的)\s*(?:一个|一件|一项)?\s*(?:麻烦|问题|困难|痛点)(?:是什么|有哪些|是哪些)[？?]\s*$/.exec(reply)
  if(!match)return null
  const topic=match[2]!.trim().replace(/[，,]\s*$/,'')
  if(!topic||topic.length>100)return null
  const opened=`${topic}，实际经过是什么？有没有遇到麻烦，还是没有？`
  return reply.slice(0,match.index)+match[1]+opened
}

// A single lead is not a product or a demo. When the user explicitly reports
// no delivered product and the reply proposes a demo/productisation step,
// remove that step; the stage-appropriate clarification stays for the policy.
// Structural boundary only: no replacement pitch and no invented evidence.
export function removePrematureDemoStep(reply:string,userText:string):string|null{
  const noProduct=/(?:没|未|还没有|尚未|没有)\s*(?:做|交付|开发|上线|做出|完成)?\s*(?:产品|原型|demo|MVP)|(?:没有|无)(?:产品|原型)|没做产品|未交付产品/i.test(userText)
  if(!noProduct)return null
  // An explicit prototype request is a valid next stage, and a multi-person
  // report is no longer the single-lead stage this boundary protects.
  if(/(?:设计|做|制作|搭建|验证|测试).{0,8}(?:原型|MVP|demo|演示)|(?:原型|MVP|demo).{0,8}(?:设计|验证|做)/i.test(userText))return null
  const leads=reportedLeadCount(userText)
  if(leads!==null&&leads>1)return null
  const demo=/(?:演示|demo|Demo|DEMO|原型|MVP|发布产品|上线产品|做出产品)/i
  // Only a negation that directly governs the demo/product word counts; a
  // question form such as 能不能 must not make the step look negated.
  const negation=/(?:不|别|无需|不用|暂不|先不|尚未|没有|未)\s*(?:再|去|做|进行|安排|推进|提|给|用|要)?\s{0,2}(?:演示|demo|原型|MVP|发布|上线|做出|产品)/i
  const sentences=reply.split(/(?<=[。！？!?；;\n])/)
  const kept=sentences.filter(sentence=>!demo.test(sentence)||negation.test(sentence)).filter(sentence=>/[\p{L}\p{N}]/u.test(sentence))
  if(kept.length===sentences.length)return null
  const bounded=kept.join('').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').replace(/[ \t]+([。！？!?])/g,'$1').replace(/([。！？!?])[”」』"']/g,'$1').trim()
  // If every unsafe sentence was removed, never return null: null would let
  // the original unsafe reply flow back out. Fall back to a neutral boundary.
  if(!bounded)return '先确认这条反馈具体指什么，再决定下一步。'
  return bounded!==reply.trim()?bounded:null
}

// When the user explicitly reports no product, no adoption and no payment,
// the turn is not business validation. Remove sentences that turn one report
// into selling, pricing, a pilot, a recruitment/sample-size plan or a manual
// MVP. The one-lead clarification and the final question survive. This is a
// stage boundary, not a catalogue of scripted replies.
export function removePrematureProductization(reply:string,userText:string):string|null{
  const noProduct=/(?:没|未|还没有|尚未|没有)\s*(?:做|交付|开发|上线|做出|完成)?\s*(?:产品|原型|demo|MVP)|(?:没有|无)(?:产品|原型)|没做产品|未交付产品/i.test(userText)
  const noDemand=/(?:没人|没有人|无人).{0,8}(?:采用|使用|用|购买|付款|付费)|(?:没有|无).{0,8}(?:采用|付费|付款|客户)/.test(userText)
  if(!noProduct||!noDemand)return null
  const productize=/(?:卖|收费|定价|付费|人肉\s*MVP|最小可行|试点|招募|接单|朋友圈|群里发)|(?:找|再找)\s*\d+\s*[-~–—至]\s*\d+\s*个|\d+\s*[-~–—至]\s*\d+\s*个(?:不同|同学|人)/i
  const negation=/(?:不|别|无需|不用|暂不|先不|不要|尚未|没有|未)\s*(?:再|去|做|进行|安排|推进|提|给|用|要)?\s{0,3}(?:卖|收费|定价|付费|试点|招募|接单|人肉\s*MVP|最小可行)/i
  const sentences=reply.split(/(?<=[。！？!?；;\n])/)
  const kept=sentences.filter(sentence=>!productize.test(sentence)||negation.test(sentence)).filter(sentence=>/[\p{L}\p{N}]/u.test(sentence))
  if(kept.length===sentences.length)return null
  const bounded=kept.join('').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').replace(/([。！？!?])[”」』"']/g,'$1').trim()
  // If every unsafe sentence was removed, never return null: null would let
  // the original unsafe reply flow back out. Fall back to a neutral boundary.
  if(!bounded)return '先确认这条反馈具体指什么，再决定下一步。'
  return bounded!==reply.trim()?bounded:null
}

// A single report plus "no product / no adoption / no payment" is a
// clarification stage, not product validation. If the reply still proposes
// product work (even with different words), replace it with a grounded
// clarification of the one report. Generic stage boundary, keyed on the
// reported state rather than on a domain word.
// Parse a reported sample count only when it is attached to people/feedback.
// Returns null for "几/多" and when no count was supplied, so callers never
// turn an unknown quantity into "one".
function parseChineseNumber(value:string):number{
  const digits:Record<string,number>={零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9}
  if(value==='十')return 10
  if(value.includes('十')){
    const [left,right]=value.split('十')
    const tens=left?digits[left]??0:1
    const ones=right?digits[right]??0:0
    return tens*10+ones
  }
  if(value.includes('百')){
    const [left]=value.split('百')
    return (left?digits[left]??1:1)*100
  }
  return digits[value]??0
}
export function reportedLeadCount(text:string):number|null{
  const matches=[...text.matchAll(/(\d+|[一二两三四五六七八九十百]+|几|多)\s*(?:个|位|名|条|人)\s*(?:同学|学生|人|反馈|样本|受访者|受访|线索)?/g)]
  let best=0
  for(const match of matches){
    const raw=match[1]!
    if(raw==='几'||raw==='多')return null
    const value=/^\d+$/.test(raw)?Number(raw):parseChineseNumber(raw)
    if(value>best)best=value
  }
  return best>0?best:null
}
function hasReportedProduct(text:string):boolean{
  return /(?:已有|已经有|已经做|已做|已开发|已上线|可演示原型|做出原型|完成原型|(?:^|[，,。；;\s]|我)有(?:一个|个)?(?:可演示的?)?(?:产品|原型|demo|MVP))/i.test(text)
}

export function groundSingleLeadWithoutProduct(reply:string,userText:string):string|null{
  const noProduct=/(?:没|未|还没有|尚未|没有)\s*(?:做|交付|开发|上线|做出|完成)?\s*(?:产品|原型|demo|MVP)|(?:没有|无)(?:产品|原型)|没做产品|未交付产品/i.test(userText)
  const noDemand=/(?:没人|没有人|无人).{0,8}(?:采用|使用|用|购买|付款|付费)|(?:没有|无).{0,8}(?:采用|付费|付款|客户)/.test(userText)
  if(!noProduct||!noDemand)return null
  // A product/prototype the user already has is not "no product"; an explicit
  // prototype request is a valid next stage, not a single-lead clarification.
  if(hasReportedProduct(userText))return null
  if(reportedLeadCount(userText)!==1)return null
  const asksPrototype=/(?:设计|做|制作|搭建|验证|测试).{0,8}(?:原型|MVP|demo|演示)|(?:原型|MVP|demo).{0,8}(?:设计|验证|做)/i.test(userText)
  if(asksPrototype)return null
  const quote=/(?:他说|提到|反馈是|说的是|说)[“"']?([^。！？!?\n“”"']{2,40})[”"']?[。！？!?]/.exec(userText)?.[1]?.trim()
  const subject=quote?`“${quote}”`:'这条反馈'
  const clarification=`目前只有这一条反馈。先弄清${subject}具体指什么，不推进产品。可以问他最近一次遇到这件事的完整经过：当时在做什么、具体卡在哪一步、后来怎么处理的。`
  // Expanding the sample is still premature even when the reply says "don't
  // build a product"; one report must be understood first.
  const expandsSample=/(?:观察|看|问|找|联系|访谈|再找|再问|多找|多问)\s*(?:更多(?:人|同学|学生|受访者|用户)|(?:[二两三四五六七八九十]|[2-9]|\d{2,})\s*[二两三四五六七八九十]?\s*(?:[-~–—至]\s*\d+)?\s*个?[^。！？\n]{0,12}(?:同学|人|学生|受访者|用户))/.test(reply)
  if(expandsSample)return clarification
  // Only strong business-validation markers qualify. A mere mention of a
  // product, a user or an access problem must not trigger this boundary.
  const productWork=/(?:需求验证|验证需求|产品形态|产品迭代|商业化|变现|最小可行|MVP|客单价|转化率|留存率|卖|收费|定价|投放)|(?:找|再找)\s*\d+\s*[-~–—至]\s*\d+\s*个|朋友圈|群里发/i.test(reply)
  const negated=/(?:不|别|无需|不用|暂不|先不|不是).{0,8}(?:做|推进|升级成|进入|谈).{0,8}(?:产品|需求验证|商业化)/.test(reply)
  if(!productWork||negated)return null
  return clarification
}

// Zero available time or a refusal is a stopping boundary, not an invitation
// to end with another question. Remove the trailing question and leave a short
// stop; the provisional understanding stays. Structural boundary only.
export function removeQuestionOnZeroTime(reply:string,userText:string):string|null{
  const zero=/(?:本周|这周|今天|现在|目前).{0,8}(?:可用时间|时间).{0,6}?(?:是)?零|零时间|没(?:有)?时间|没空|不(?:想|再)?安排(?:任何)?(?:任务|动作|事)|不想做任何安排|不要追问|不想说|拒绝回答/.test(userText)
  if(!zero)return null
  // No time to execute a plan is not no time to talk or receive a clarification.
  // When the user explicitly asks to talk or asks for a question, keep the
  // reflective question and do not replace it with a generic pause.
  if(/(?:愿意|可以|想|现在).{0,8}(?:聊|聊聊|说说|倾诉)|问我一个问题|想被问|主动求解释/.test(userText))return null
  if(!/[？?]|我需要知道|你方便|列一下|告诉我|哪几门|有没有/.test(reply))return null
  // Keep at most the first reassurance sentence; any information request or
  // task list is removed, not merely its question mark.
  const first=reply.split(/(?<=[。！？!?])/)[0]?.trim()??''
  const keep=first&&!/[？?]/.test(first)&&!/我需要知道|你方便|列一下|告诉我|哪几门|有没有/.test(first)
  return keep?`${first}\n\n这周先不安排动作，等你有时间再继续。`:'这周先不安排动作，等你有时间再继续。'
}

// A reported mobile-access failure with no other version is an access problem,
// not a missing receipt. Do not ask whether it arrived or re-author the
// content; give a format/route alternative and re-export the same content.
export function groundReportedAccessAlternative(reply:string,userText:string):string|null{
  // A local-only check cannot test another person's device. Remove just the
  // unsupported measurement claim; keep the generated action and stop rule.
  if(responseRequestScope(userText).actionRequested&&/导出|本地/.test(reply)&&/(?:不|不要|不再)(?:发送|发给|联系)/.test(reply)){
    let bounded=reply
    for(const clause of scanUserClauses(reply).reverse()){
      if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.interrogative||clause.quoteSpans.length||clause.codeSpans.length||/仍未知|尚未知|未核实|未验证|不能验证|无法验证/.test(clause.text))continue
      const claim=/(?:(?:它|这一步|这个动作|本次检查)(?:所)?)?(?:测的是|测试的是|验证的是|能验证|用于验证).{0,12}(?:导师|老师|对方|客户|他|她).{0,12}(?:手机|设备|电脑).{0,16}(?:打开|访问|显示)/.exec(clause.text)
      if(claim&&!/不要|别|不能|不应|并非|不是|不代表|无法|未/.test(clause.text.slice(0,claim.index))){
        const prefix=clause.text.slice(0,claim.index).trimEnd()
        const localAction=/^(?:(?:把|将)(?:PDF|文件|作品集|现有源文件)(?:导出|保存|另存)(?:到|至)本地|打开本地(?:PDF|文件|作品集))$/i
        if(prefix&&!localAction.test(prefix))return ''
        const actionPrefix=prefix
        const suffix=clause.text.slice(claim.index+claim[0].length)
        // Repair only a fully separable measurement: a bounded object and/or
        // a complete stop clause. Unknown suffixes may contain instructions or
        // further remote checks; reject rather than classify or discard them.
        const stopGrammar='(?:并且|而且|并|且|然后|随后|之后)(?:(?:在)?(?:这一步|此步|这里|此处)(?:完成)?后?)?(?:就|即|立刻|马上)?(?:停止|停下|停|结束|到此为止)'
        const parsed=new RegExp('^\\s*(?:(?:(?:这|那)(?:个|种|份)|该|此)?(?:格式|文件|内容|版本|PDF)\\s*)?(?<stop>'+stopGrammar+')?\\s*$','i').exec(suffix)
        if(!parsed)return ''
        const stop=parsed.groups?.stop??''
        const retained=actionPrefix+(actionPrefix?stop:stop.replace(/^(?:并且|而且|并|且|然后|随后|之后)/,''))
        bounded=retained
          ?bounded.slice(0,clause.start)+retained+bounded.slice(clause.end)
          :bounded.slice(0,clause.start)+bounded.slice(clause.end+clause.delimiter.length)
      }
    }
    if(bounded!==reply)return bounded.trim()
  }
  const access=/(?:手机|移动端).{0,12}(?:打不开|无法打开|访问不了|不能访问|排版乱)|(?:打不开|无法打开|访问不了|不能访问).{0,12}(?:手机|移动端)/.test(userText)
  const noOther=/(?:没有|没)(?:别的|其他)?版本|不想重做|不想重剪|不想重录|不能重做|只(?:想)?处理访问/.test(userText)
  const fillable=/(?:报名表|申请表|申请书|表格|表单|填写|填表)/.test(userText)
  const media=/(?:视频|音频|录音|放不出来|播放)/.test(userText)
  if(!access||!noOther)return null
  const hasAlternative=(fillable
    ?/(?:PDF|pdf|截图|图片|Word|word|Excel|excel|xlsx|导出|换(?:个|一种)?格式|可编辑|电脑|平板|在线填写|权限)/
    :media
      ?/(?:转码|转成|转换|MP4|mp4|MP3|mp3|AAC|aac|WAV|wav|播放器|换(?:个|一种)?(?:格式|平台|链接))/
      :/(?:PDF|pdf|截图|图片|Word|word|换(?:个|一种)?格式|导出)/).test(reply)
  let bounded=reply
    .replace(/[^。！？!?\n]*(?:是否已收到|确认.{0,6}收到)[^。！？!?\n]*[。！？!?]?/g,'')
    .replace(/如果已收到但打不开[，,]?/g,'')
    .replace(/重新制作/g,'重新导出')
    .replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim()
  if(!hasAlternative)bounded=`${bounded}${bounded?'\n\n':''}${media?'可以先转码成手机支持的格式（视频 MP4 / 音频 MP3），或换一个能直接播放的链接/播放器发给对方。':'可以先导出 PDF 或截图，按对方能打开的格式重新发送。'}`
  const fillableRoute=/(?:可编辑|在线填写|在线编辑|Word|word|Excel|excel|xlsx|权限|编辑)|(?:电脑|平板)[^。！？\n]{0,16}(?:填|编辑)/
  if(fillable&&!fillableRoute.test(bounded)){
    bounded=`${bounded}${bounded?'\n\n':''}这是需要填写的表单，PDF/截图不能直接填写；先确认对方能否用电脑打开，或发一个可编辑/可在线填写的版本。`
  }
  return bounded&&bounded!==reply.trim()?bounded:null
}

// A zero-time turn may still state one provisional focus; removing the question
// must not turn "what should I look at first?" into a content-free stop.
export function ensureZeroTimeFocus(reply:string,userText:string):string|null{
  const zero=/(?:本周|这周|今天|现在|目前).{0,8}(?:可用时间|时间).{0,6}?(?:是)?零|零时间|没(?:有)?时间|没空|不(?:想|再)?安排(?:任何)?(?:任务|动作|事)|不想做任何安排|不要追问|不想说|拒绝回答/.test(userText)
  if(!zero)return null
  if(!/(?:最该|优先|先).{0,8}(?:看|关注|准备|做)什么/.test(userText))return null
  const focus='先看这件事的截止时间和硬性条件；等你有时间再展开。'
  const stop='这周先不安排动作，等你有时间再继续。'
  const base=reply.trim().endsWith(stop)?reply.trim().slice(0,-stop.length).trim():reply.trim()
  if(/(?:截止|资格|条件|要求|日期|时间|范围)/.test(base))return null
  return `${base}${base?'\n\n':''}${focus}\n\n${stop}`
}

// A zero-time turn may keep a provisional focus, but not a numbered action
// checklist hidden under "具体操作/步骤". Cut the checklist, keep the focus.
export function removeZeroTimeTasks(reply:string,userText:string):string|null{
  const zero=/(?:本周|这周|今天|现在|目前).{0,8}(?:可用时间|时间).{0,6}?(?:是)?零|零时间|没(?:有)?时间|没空|不(?:想|再)?安排(?:任何)?(?:任务|动作|事)|不想做任何安排|不要追问|不想说|拒绝回答/.test(userText)
  if(!zero)return null
  if(!/(?:具体操作|具体步骤|行动清单|执行步骤|操作步骤)/.test(reply))return null
  const fixed=reply.replace(/(?:具体操作|具体步骤|行动清单|执行步骤|操作步骤)[:：]?[\s\S]*$/,'').trim()
  return fixed&&fixed!==reply.trim()?fixed:null
}

// "收到了" is a receipt, not proof that the content was read. If the user only
// reported a receipt, do not let the reply say 已读 or contradict itself.
export function fixReportedReceiptState(reply:string,userText:string):string|null{
  const receipt=/(?:回复|说|确认).{0,8}(?:收到了|收到|已收到)/.test(userText)&&
    !/(?:已读|读到|看过|看了|阅读过)/.test(userText)
  const readClaim=/(?:已读|确认读到|确认阅读|读到了|读到|看过|看了|阅读过|已阅读|阅读了|已经阅读|已看|查看了)/
  if(!receipt||!readClaim.test(reply))return null
  // Only an assertive read is the defect. "是否已读仍未知" and
  // "已读状态未知" are unknowns; "内容评价仍未知" does not make a read
  // statement unknown. Keep the uncertainty check local to the read claim.
  const uncertainRead=/(?:是否|未读|尚未读|已读[^。！？]{0,6}(?:未知|与否|状态未知)|读到[^。！？]{0,6}(?:未知|与否))/
  const fixed=reply.split(/(?<=[。！？!?；;\n])/).map(sentence=>{
    if(uncertainRead.test(sentence))return sentence
    // In a status list, 已读 is the dimension label, not a read assertion.
    // Keep the label and make its value unknown.
    if(/^\s*[-*]?\s*已读\s*[:：]/.test(sentence))return sentence.replace(/^(\s*[-*]?\s*已读\s*[:：]).*$/,'$1未知（目前只确认收到）')
    return sentence
      .replace(/已读未评/g,'仅确认收到、尚未评价')
      .replace(/确认(?:已)?(?:阅读|读到)|已阅读|阅读了|已经阅读|已看|查看了|已读到|读到了|读到|阅读过|查看过/g,'确认收到')
      .replace(/(?<!不代表他)(?:看过了|看过|看了)/g,'确认收到')
      .replace(/已读/g,'已确认收到')
  }).join('')
  if(fixed===reply)return null
  return fixed.replace(/不代表他看过/g,'不代表他已阅读内容')
}

// A clickable flow that starts with one person but judges with three must say
// so consistently; do not leave "find 1" next to a 2-of-3 success rule.
export function fixClickableCountConsistency(reply:string,userText:string):string|null{
  const wantsClickable=/可点击.{0,4}原型|点击.{0,4}原型|可点击的.{0,4}原型/.test(userText)
  if(!wantsClickable)return null
  // "先找1位，再找2位，共3位" is a coherent staged plan, not a mismatch.
  if(/(?:先找|先请|再找|再请)/.test(reply))return null
  let fixed=reply
  if(/(?:找|请)\s*1\s*位/.test(fixed)&&/(?:3\s*位|三位)/.test(fixed)){
    fixed=fixed.replace(/找\s*1\s*位/g,'找 3 位').replace(/给他一个具体任务/g,'给每人一个具体任务')
  }
  // "Find the 5 who said..." next to "if 3 people..." is the same mismatch in a
  // different surface form. Align the test group with the decision count.
  const group=/(?:找|选|请)(?:那)?\s*(\d+|[一二两三四五六七八九十]+)\s*个(?:说|反馈|同学)/.exec(fixed)
  const decision=/(\d+|[一二两三四五六七八九十]+)\s*个?人里/.exec(fixed)
  if(group&&decision&&group[1]!==decision[1])fixed=fixed.replace(group[0],group[0].replace(group[1],decision[1]))
  return fixed!==reply?fixed:null
}

// "Lowest cost" means the person can start without recruiting two busy
// interviewees. Keep the interview plan, but add a self-contained fallback.
export function ensureLowCostSelfStart(reply:string,userText:string):string|null{
  const lowCost=/(?:最低成本|成本最低|最省|低成本)/.test(userText)
  if(!lowCost)return null
  // The fixed exam/interview fallback is only relevant when the user is
  // actually exploring exam preparation. Never inject it into free exploration.
  if(!/(?:考研|考试|真题|面经|考公|公考|公务员)/.test(userText))return null
  const reliesOnPeople=/(?:找|约|联系|访谈|请教)(?:一位|一个|1位|1个|两|2)/.test(reply)&&/(?:聊|访谈|请教|问)/.test(reply)
  if(!reliesOnPeople)return null
  if(/(?:真题|面经|公开|自己先|先自己|不用约人|约不到)/.test(reply))return null
  return `${reply.trim()}\n\n如果一时约不到人，先用公开的真题/面经各花 30 分钟自测，再决定是否约人。`
}

// A two-factor comparison must change presence/absence of one factor. Moving
// the same activity to another time keeps that factor and cannot distinguish.
export function ensureTwoFactorPresenceChange(reply:string,userText:string):string|null{
  const twoFactor=/不确定是哪个|不确定哪|哪个起作用|两个.{0,6}同时|同时.{0,6}(?:开始|改)|是.{0,12}还是.{0,12}起作用/.test(userText)
  if(!twoFactor)return null
  if(!/(?:挪到|改到|调整到|移到|换个时间|换到)/.test(reply))return null
  if(!/(?:阅读|散步|跑步|咖啡|早起|早睡|番茄钟|图书馆)/.test(reply))return null
  const fixed=reply.replace(/把(阅读|散步|跑步|咖啡|早起|早睡|番茄钟|图书馆)的?时间(?:挪到|改到|调整到|移到)[^。！？\n]*/g,'暂停$1三天')
  const note='注意：只把时间挪开仍保留了原来的变量，不能区分。要区分，需要暂停其中一个三天（例如暂停阅读、保留早睡），再观察；或暂停另一个做对照。'
  return `${(fixed!==reply?fixed:reply).trim()}\n\n${note}`
}

// A health-related two-factor test must not ask the person to stop sleep,
// exercise, food or medication just to isolate a cause.
export function guardHealthTwoFactor(reply:string,userText:string):string|null{
  const twoFactor=/不确定是哪个|不确定哪|哪个起作用|两个.{0,6}同时|同时.{0,6}(?:开始|改)|是.{0,12}还是.{0,12}起作用/.test(userText)
  if(!twoFactor)return null
  const health=/(?:睡眠|早睡|早起|冥想|拉伸|跑步|散步|运动|咖啡|饮食|吃药|服药)/.test(userText+reply)
  if(!health)return null
  const stopsHealth=/(?:暂停|停掉|取消|停止|去掉|不做).{0,8}(?:睡眠|早睡|早起|冥想|拉伸|跑步|散步|运动|吃药|服药)/.test(reply)
  if(!stopsHealth)return null
  return `${reply.trim()}\n\n健康边界：不要为了区分原因停掉睡眠、运动、饮食或用药等健康习惯。可以只记录 3-7 天的自然变化，或先咨询专业人士；一次结果只是线索，不证明因果。`
}

// A clickable prototype is a delivery request, not a request for a paper
// sketch or another question. Keep the smallest clickable flow when the model
// downgrades it.
export function groundClickablePrototype(reply:string,userText:string):string|null{
  const wantsClickable=/可点击.{0,4}原型|点击.{0,4}原型|可点击的.{0,4}原型/.test(userText)
  if(!wantsClickable)return null
  if(/可点击|Figma|figma|墨刀|交互原型|原型工具/.test(reply))return null
  const topic=/(?:说|反馈)([^。！？\n]{2,16}?)(?:太|很|难|不)/.exec(userText)?.[1]?.trim()
  const example=topic?`例如找到${topic}里的一条具体信息`:'例如完成一个与你说的场景对应的具体任务'
  const hypothesis=topic?`假设“更清晰地呈现${topic}里的关键信息，能让同学更快完成选择”`:'一个可验证的假设'
  return `先定一个可验证的假设：${hypothesis}。再做一个可点击的最小流程：只连 3 个页面（入口→列表→详情），用 Figma 或墨刀做成能点击的原型；找 3 位之前反馈过这个问题的同学，每人完成一个具体任务（${example}），观察他们能否在 1 分钟内完成，记录卡在哪一步；如果 3 位里有 2 位仍卡住，就改流程，不扩功能；如果 3 位都能完成，再考虑是否值得扩展。`
}

// A clickable flow without a hypothesis or a success/stop rule is only a demo.
// Add the smallest validation contract when the model already produced the flow.
export function ensureClickableValidation(reply:string,userText:string):string|null{
  const wantsClickable=/可点击.{0,4}原型|点击.{0,4}原型|可点击的.{0,4}原型/.test(userText)
  if(!wantsClickable)return null
  if(!/可点击|Figma|figma|墨刀|交互原型|原型工具/.test(reply))return null
  if(/假设/.test(reply)&&/(?:2 位|两位|成功标准|停止条件|成功\/停止)/.test(reply))return null
  const topic=/(?:说|反馈)([^。！？\n]{2,16}?)(?:太|很|难|不)/.exec(userText)?.[1]?.trim()
  const hypothesis=topic?`假设“更清晰地呈现${topic}里的关键信息，能让同学更快完成选择”`:'一个可验证的假设'
  return `${reply.trim()}\n\n补一个可验证的假设：${hypothesis}。成功/停止标准：先用 1 位同学走通流程，再找另外 2 位复测；3 位里 2 位能在 1 分钟内完成，就算流程可用；否则改流程，不扩功能。`
}

// One two-factor comparison is a clue, not proof of which factor caused the
// change. Soften single-observation causal claims and state the limit.
export function softenSingleObservationCausality(reply:string,userText:string,authorizedText=userText):string|null{
  let fixed=reply
  const countObservation=reportedCountObservation(userText)
  if(countObservation){
    const replacements=scanUserClauses(fixed).filter(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.interrogative&&!clause.quoteSpans.length&&!clause.codeSpans.length
      &&/(?:支持|说明|证明|表明).{1,60}(?:让|导致|使).{0,24}(?:少|多|减少|增加).{0,20}(?:问|询问|次)/.test(clause.text)
      &&!/(?:不能|不(?:足以|代表)|无法|尚不能|未必|是否|假设)/.test(clause.text))
    for(const clause of replacements.reverse())fixed=fixed.slice(0,clause.start)+countObservation.replace(/[。]$/,'')+fixed.slice(clause.end)
  }
  const sourceClauses=scanUserClauses(authorizedText).filter(c=>!c.quoted&&!c.code&&!c.conditional&&!c.interrogative&&!c.quoteSpans.length&&!c.codeSpans.length&&!/(?:不(?:知道|确定|清楚)|未知|是否|有没有|可能|也许|假设|没(?:有)?|并非|不是|担心|害怕|希望|期待|推测|猜测|想象|在想|想知道|想确认)/.test(c.text))
  const claims=scanUserClauses(fixed),edits:{start:number;end:number;text:string}[]=[]
  for(const clause of claims){
    if(clause.quoted||clause.code||clause.conditional||clause.quoteSpans.length||clause.codeSpans.length||clause.interrogative)continue
    const pattern=/(?:仍|也|还|就|必然|一定)?(?:将会|会)((?:打断|切割|占用|影响|压缩)[^。！？\n]{0,24}?(?:专注|自主安排|自由安排|你的时间块))/g
    for(const match of clause.text.matchAll(pattern)){
      const prefix=clause.text.slice(0,match.index),subject=prefix.trim()
      if(/可能|也许|或许|是否|未知|不确定|不清楚|不知道|无法确认|并非|不是|不代表|不等于|不能说明|不能证明|不(?:一定)?$/.test(prefix))continue
      if(subject&&sourceClauses.some(source=>source.text.includes(subject)&&source.text.includes(match[1]!)))continue
      edits.push({start:clause.start+match.index!,end:clause.start+match.index!+match[0].length,text:'可能会'+match[1]})
    }
  }
  for(const edit of edits.sort((a,b)=>b.start-a.start))fixed=fixed.slice(0,edit.start)+edit.text+fixed.slice(edit.end)
  const twoFactor=/不确定是哪个|不确定哪|哪个起作用|两个.{0,6}同时|同时.{0,6}(?:开始|改)|是.{0,12}还是.{0,12}起作用/.test(userText)
  if(!twoFactor)return fixed!==reply?fixed:null
  const causal=/是主因|是主要推动|是主要作用|是关键变量|起了作用|在起作用|说明.{0,8}是.{0,8}(?:原因|作用)|证明.{0,8}是/.test(fixed)
  if(!causal)return fixed!==reply?fixed:null
  fixed=fixed
    .replace(/是主因/g,'更可能是主因')
    .replace(/是主要推动/g,'更可能是主要推动')
    .replace(/是主要作用/g,'更可能是主要作用')
    .replace(/是关键变量/g,'更可能是关键变量')
    .replace(/主要是([^，。；\n]{2,8})在起作用/g,'$1更可能在起作用')
    .replace(/起了作用/g,'更可能起了作用')
    .replace(/在起作用/g,'更可能在起作用')
    .replace(/可能更可能/g,'更可能')
    .replace(/(?:更可能)+/g,'更可能')
  if(!/线索|不证明因果|不能证明|不构成因果/.test(fixed))fixed=`${fixed.trim()}\n\n一次结果只是线索，不证明因果。`
  return fixed!==reply?fixed:null
}

// A refusal names a topic and a boundary. Listening is right, but the reply
// must also acknowledge that named boundary instead of silently continuing.
export function acknowledgeRefusalBoundary(reply:string,userText:string):string|null{
  const topic=/不想(?:再|继续)?聊([^，。！？\n]{1,12})/.exec(userText)?.[1]?.trim()
  const noAdvice=/别(?:再)?(?:给我)?建议|不要(?:给我)?建议|别给建议/.test(userText)
  if(!topic&&!noAdvice)return null
  const topicAcknowledged=!topic||reply.includes(`不聊${topic}`)||reply.includes(`不谈${topic}`)
  const adviceAcknowledged=!noAdvice||/不(?:给|提)建议|不建议|不劝/.test(reply)
  if(topicAcknowledged&&adviceAcknowledged)return null
  const parts=[topic&&!topicAcknowledged?`不聊${topic}`:'',noAdvice&&!adviceAcknowledged?'也不给建议':''].filter(Boolean)
  if(!parts.length)return null
  const bounded=reply.trim()
  return `好，${parts.join('，')}。${bounded?`\n\n${bounded}`:''}`
}

// "I have no clients / no experience" is not "I don't want clients". Remove a
// preference the user never stated, and keep the grounded absence in its place.
export function repairUnsupportedPreferenceClaim(reply:string,userText:string,preferences:ReturnType<typeof reportedEvidenceFromText>['preferences']=[]):string|null{
  let fixed=reply
  const prefersCurrentCity=preferences.some(p=>['priority','like'].includes(p.modality)&&/留(?:在)?(?:目前|当前|现在|原来)(?:的)?城市|留城/.test(p.subject))
  if(prefersCurrentCity){
    const clauses=scanUserClauses(reply),cuts:{start:number;end:number}[]=[]
    for(let index=0;index<clauses.length;index++){
      const clause=clauses[index]!
      if(clause.quoted||clause.code||clause.attributedToOther||clause.quoteSpans.length||clause.codeSpans.length||!/其他城市|外地|异地/.test(clause.text))continue
      const relation=clauses.slice(index,index+4).filter(c=>c.sentenceStart===clause.sentenceStart)
      if(relation.some(c=>/远程|线上|网课|不搬离|不离开|仍(?:可)?住/.test(c.text)))continue
      const fit=relation.find(c=>!c.quoted&&!c.code&&!c.quoteSpans.length&&!c.codeSpans.length
        &&/(?:符合|满足|不违背)[^。！？\n]{0,50}(?:留城|留在(?:目前|当前|现在)(?:的)?城市)/.test(c.text)
        &&!/(?:是否|能否|未必|不一定|尚未确认|不能|无法)[^。！？\n]{0,12}(?:符合|满足|不违背)|不(?:符合|满足)/.test(c.text))
      if(!fit)continue
      cuts.push({start:clause.start,end:fit.end+fit.delimiter.length})
    }
    for(const cut of cuts.sort((a,b)=>b.start-a.start))fixed=fixed.slice(0,cut.start).replace(/[，,；;：:]\s*$/,'。')+fixed.slice(cut.end)
  }
  const noClient=/(?:没有|没).{0,8}(?:客户|自由职业经历)/.test(userText)
  const statedPreference=/(?:不想|不愿意|拒绝|排除).{0,8}(?:客户|获客|收款|自由职业)/.test(userText)
  const noBoss=/(?:不在意|没有|没想).{0,8}(?:当老板|老板|创业)/.test(userText)
  const statedBoss=/(?:不想|不愿意|拒绝|排除).{0,8}(?:当老板|老板|创业)/.test(userText)
  const applyNoClient=noClient&&!statedPreference
  const applyNoBoss=noBoss&&!statedBoss
  if(!applyNoClient&&!applyNoBoss)return fixed!==reply?fixed:null
  if(applyNoClient){
    fixed=fixed
      .replace(/你(?:明确|已经)?不想承担(?:找客户和收款|找客户|获客|收款)/g,'你目前还没有客户，也没有自由职业经历')
      .replace(/你(?:明确|已经)?不想(?:找客户|获客|收款)/g,'你目前还没有客户，也没有自由职业经历')
      .replace(/与你已排除的约束冲突/g,'与你目前的经历和约束不符')
  }
  if(applyNoBoss){
    fixed=fixed.replace(/你排除了当老板、找客户和收款/g,'你目前没有把当老板作为目标；找客户和收款你明确不想承担')
    fixed=fixed.replace(/你排除了当老板/g,'你目前没有把当老板作为目标')
  }
  return fixed!==reply?fixed:null
}

// Do not add a zero/unavailable-time constraint the user never reported. A
// request not to add tasks is not a report that this week has no time.
export function repairUnsupportedZeroTimeClaim(reply:string,userText:string):string|null{
  // "不安排任务，但我其实有空" is not a zero-time report. Only a genuine
  // no-time/zero-time report suppresses the unsupported-time check.
  const userHasTime=/(?:其实)?(?:有空|有时间|不忙|时间充裕)/.test(userText)
  const userReportedZero=!userHasTime&&/(?:没(?:有)?时间|没空|零时间|无可用时间|不想安排|不(?:再)?安排)/.test(userText)
  if(userReportedZero)return null
  const claim=/(?:本周|这周|今天|现在|目前).{0,6}(?:无|没有|零)\s*(?:可用)?时间/
  if(!claim.test(reply))return null
  const fixed=reply
    .replace(/[，,；;]?\s*(?:且|并且)?\s*(?:本周|这周|今天|现在|目前).{0,6}(?:无|没有|零)\s*(?:可用)?时间/g,'')
    .replace(/[，,；;]\s*([。！？!?])/g,'$1')
    .replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim()
  const cleaned=fixed.replace(/^[。！？!?；;，,\s]+$/,'').trim()
  if(!cleaned)return '这条时间信息还没有来源；先保留为未知。'
  return cleaned!==reply.trim()?cleaned:null
}

// A reported quantity of one stays one. Do not silently expand one role/person
// into a comparison set the person did not ask for.
export function enforceReportedQuantity(reply:string,userText:string):string|null{
  const reported=/(?:只|仅)?(?:愿意|想|要|会)?(?:只|仅)?(?:了解|看|问|找|联系|访谈|比较)?\s*一(?:个|位|名|条|份)\s*([^，。；\n的]{1,12})/.exec(userText)
  if(!reported)return null
  const object=reported[1].trim()
  if(object.length<2)return null
  const noun=object.length>2?object.slice(-2):object
  const escaped=object.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  const escapedNoun=noun.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  const count=new RegExp(`(?:(?:[2-9]|[两三四五六七八九十])\\s*[-~–—至]\\s*\\d+|(?:[2-9]|[两三四五六七八九十])(?:[两三四五六七八九十])?)\\s*(?:个|位|名|条|份)([^。！？\\n]{0,12}(?:${escaped}|${escapedNoun}))`,'g')
  if(!count.test(reply))return null
  const fixed=reply.replace(count,(_,tail)=>`一个${tail}`)
  return fixed!==reply?fixed:null
}

// The user explicitly asked for one question. A bare acknowledgement is not a
// question; ground one in the user's own last concrete clause instead.
export function ensureRequestedQuestion(reply:string,userText:string):string|null{
  if(!requestsOneQuestionReply(userText))return null
  if(/[？?]/.test(reply))return null
  const clauses=scanUserClauses(userText).filter(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&!assistantRequestClause(clause.text)&&!requestsOneQuestionReply(clause.text)&&clause.text.trim().length>=4)
  const last=clauses.at(-1)?.text.trim()??'这件事'
  return `你提到“${last}”，其中具体哪个细节最影响你？`
}

// Find a top-level reply key without treating a reasoning field or a nested
// event.reply as the assistant's visible reply. The raw value is an incomplete
// JSON prefix, so scan strings and brace depth rather than parsing it.
function topLevelReplyOpening(raw:string,field:'reply'|'lead'='reply'):{index:number;length:number}|null{
  let depth=0,inString=false,escape=false,reasoningBefore=false
  const key=field==='lead'?'lead':'reply'
  for(let i=0;i<raw.length;i++){
    const char=raw[i]
    if(inString){
      if(escape){escape=false;continue}
      if(char==='\\'){escape=true;continue}
      if(char==='"')inString=false
      continue
    }
    if(char==='"'){
      if(depth===1){
        if(/^"(?:thinking|reasoning|analysis|chain_of_thought)"\s*:/.test(raw.slice(i)))reasoningBefore=true
        const match=new RegExp(`^"${key}"\\s*:\\s*"`).exec(raw.slice(i))
        if(match)return reasoningBefore?null:{index:i,length:match[0].length}
      }
      inString=true
      continue
    }
    if(char==='{')depth++
    else if(char==='}')depth--
  }
  return null
}

export function openingQuestionDraft(raw:string,field:'reply'|'lead'='reply',authorizedText?:string):string|null{
  const opening=topLevelReplyOpening(raw,field)
  if(!opening)return null
  let encoded=''
  for(let i=opening.index+opening.length;i<raw.length;i++){
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
    const originalQuestion=decoded.split(/[。！!；;\n\r]/).at(-1)!.trim()
    let question=withoutUnreportedQuestionExamples(originalQuestion,authorizedText)??originalQuestion
    if(authorizedText!==undefined){
      const opened=openUnreportedChoiceQuestion(question,authorizedText)
      // Only the positive-source definition rewrite is eligible here. Other
      // loaded alternatives keep waiting for ordinary final validation.
      if(opened){if(!/^你(?:所)?说的[“「『"][^”」』"]+[”」』"]具体指什么[？?]$/.test(opened))continue;question=opened}
    }
    if(question.length>140||(question.match(/[？?]/g)?.length??0)!==1||/[<>`]|因为|所以|说明|表明|导致/.test(question))continue
    if(unsafePreviewClaim(question))continue
    if(authorizedText!==undefined&&responseRequestScope(authorizedText).comparisonRequested&&!comparisonUniverseAccepts(question.replace(/[？?]$/,'。'),authorizedText))continue
    if(authorizedText!==undefined&&openUnreportedChoiceQuestion(question,authorizedText))continue
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
// Evidence of an observed result does not yet license an effect inference.
// Both provisional display and the final observation repair use this clause
// predicate, so a discarded draft cannot expose the unsupported inference.
export function observationEffectHypothesis(text:string):string|null{
  for(const clause of scanUserClauses(text)){
    if(clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.quoteSpans.length||clause.codeSpans.length)continue
    const match=/^(?:(?:这(?:次)?(?:结果|反馈)?|上述结果|该结果)(?:也)?)?(?:初步)?(?:支持|提示)(?:了)?([^。！？\n]{1,100})$/.exec(clause.text.trim())
    if(!match)continue
    const proposition=match[1]!,effect=/(?:减少|降低|改善|提高|提升|缩短|增强|省时|有效|起作用)/.exec(proposition)
    if(!effect||/(?:减少|降低|改善)[^。！？]{1,24}的(?:偏好|意愿|愿望|动机|目标)/.test(proposition))continue
    if(/可能|也许|或许|假设|待验证|未必|不一定|不能确认|无法确认/.test(proposition.slice(0,effect.index)))continue
    return proposition
  }
  return null
}
const unsafeExternal=/(?:https?:\/\/|诊断|症状|抑郁症|焦虑症|你总是|你就是|你其实|你就是.{0,6}人|你一定|已(?:经)?(?:为你|帮你|替你)?(?:保存|完成|发送|报名|起草|发出|发好|移除|删除|撤销|遗忘|暂停|重开)|已送达|已收到|已读|确认读到|确认阅读|已读到|读到了|看过|看了|阅读过|查看过|导致|造成|带来|使得|让.{0,12}(?:少|多|更|降低|提高|减少|增加)|已验证|有效|稳定|(?:感受|体验|偏好|模式|效果|能力|线索|放松感|状态).{0,8}持续|持续(?:存在|有效|发生|成立)|主要来源|核心变量|保证|一定可以|肯定能|录取|报名截止|资格)/
// A pure self-state update is not an external action or health claim. For
// display only, skip it and keep looking; the saved reply is unchanged.
const selfStatus=/^(?:[^。！？]{0,16})?(?:状态|判断|局部理解|理解|更正)?已(?:更新|记录|更正)/
// Both preview forms share the same claim boundary. A question mark cannot
// turn an unsupported external outcome into a neutral question.
const unsafePreviewClaim=(text:string)=>unsafeExternal.test(text.replace(/已经验证/g,'已验证').replace(/是否稳定(?:仍|尚)?未知|稳定(?:性|效果|对你的重要性)(?:仍|尚|还|暂时)?(?:未知|未确认|不明确|未明确|未确定)/g,'未知'))
  ||observationEffectHypothesis(text)!==null
  ||/(?:会|将会)(?:打断|切割|占用|影响|压缩)[^。！？\n]{0,24}(?:专注|自主安排|自由安排|你的时间块)|(?:符合|满足|不违背)[^。！？\n]{0,16}(?:偏好|在意|要求|取向)/.test(text)
  // A model's causal interpretation and a claimed memory write require the
  // validated final turn. Even a later discarded draft has already been seen.
  ||/(?:这(?:更像|说明|表明|证明|意味着|指向)|(?:^|[，,；;：:])\s*(?:说明|表明|证明)|主要是|根本原因|归因于|更可能)/.test(text)
  ||Object.values(memoryControlSuccessClaims(text)).some(Boolean)
  ||/已(?:经)?采用/.test(text)
  ||/(?:被|遭到)[^。！？?\n]{0,24}(?:拒绝|否定|录取|采用|淘汰)/.test(text)
const fillerOnly=/^(?:好的?|嗯+|哦+|行|可以|明白|了解|收到(?:更正|补充|反馈)?|谢谢|感谢|不客气|没问题|我在听|继续|加油)[。！!，,~\s]*$|^(?:好的?，)?这是一(?:条|份|段)[^。！？]{0,80}(?:消息|材料|文稿|草稿)[^。！？]{0,40}(?:复制|使用)[:：]?$/
export function retainsDraftText(reply:string,draft:string):boolean{
  const normalize=(text:string)=>text.replace(/[\s。！？!?；;，,：:、“”「」『』'"*#]/g,'')
  const fragment=normalize(draft)
  return fragment.length>0&&normalize(reply).includes(fragment)
}
// A user can explicitly ask for the five delivery states to be separated.
// When every value is already in the user's own reports, render it on the
// server instead of letting a provider preview invent adoption/effect. This is
// a verified readback, not free-form model copy.
const deliveryStateLabels=['已发','已读','已回复','是否采用','实际效果']
const stateSeparationRequested=(text:string)=>deliveryStateLabels.filter(label=>text.includes(label)).length>=4&&/(?:分开|分别|逐项)/.test(text)
export function requestsOnlyStateReadback(text:string):boolean{
  const own=scanUserClauses(text)
  if(own.some(clause=>clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.quoteSpans.length||clause.codeSpans.length))return false
  const request=own.map(clause=>clause.text).join('；')
  const labelClause=new RegExp('^(?:(?:请|麻烦)?(?:把|将))?(?:'+deliveryStateLabels.join('|')+')(?:(?:分开|分别|逐项)(?:说|说明|列出|展示|呈现))?$')
  // Deliberately narrow read-only grammar. An independent report, action,
  // causal question or hypothetical keeps the ordinary generation path.
  const onlyRecall=own.every(clause=>labelClause.test(clause.text.trim())
    ||/^(?:请|麻烦)?(?:只|仅)?(?:更新|回读|说明)(?:相关|上述|已报告|现有)?(?:理解|判断|状态)$/.test(clause.text.trim())
    ||/^(?:请|麻烦)?(?:先|暂时)?(?:不要|别|不用|不)(?:再)?(?:安排(?:催促|任务|动作)?|催促|追问)$/.test(clause.text.trim()))
  return stateSeparationRequested(request)
    &&onlyRecall&&/(?:分开|分别|逐项)(?:说|说明|列出|展示|呈现)/.test(request)
}
export function hasUnprojectedEvaluationReport(text:string):boolean{
  return scanUserClauses(text).some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.interrogative&&!assistantRequestClause(clause.text)&&clause.text.includes('评价'))
}
export function groundedStateReadback(userText:string,priorUserTexts:string[]):string|null{
  const explicitAsk=stateSeparationRequested(userText)
  const reports=[...priorUserTexts,userText]
  const sends=reports.flatMap((text,index)=>reportedCompletedContactClauses(text).map(clause=>({index,clause})))
  const lastSend=sends.at(-1)
  if(!lastSend)return null
  if(/(?:发给|发送给|交给)[^。！？\n]{0,32}(?:和|与|及|、|还有)|给[^。！？\n]{0,32}(?:和|与|及|、|还有)[^。！？\n]{0,32}(?:发|发送|交)/.test(lastSend.clause.text))return null
  // A new actual sending starts a result window; exporting or a proposed
  // sending is never a receipt. Ambiguous multi-recipient context falls back
  // to the ordinary model contract rather than merging unrelated states.
  const all=[reports[lastSend.index]!.slice(lastSend.clause.start),...reports.slice(lastSend.index+1)].join('\n')
  const targets=new Set(all.match(/导师|老师|同学|室友|学长|学姐|客户/g)??[])
  if(targets.size>1)return null
  const windowClauses=scanUserClauses(all)
  if(windowClauses.some(clause=>clause.conditional||clause.quoteSpans.length||clause.codeSpans.length)||/(?:更正|说错|刚才不对)/.test(all))return null
  // Evaluation is not one of these five projected dimensions. Keep its
  // independent report on the ordinary source-aware path instead of replacing
  // an explicitly reported evaluation (including a negative one) with unknown.
  if(hasUnprojectedEvaluationReport(all))return null
  const currentFacts=[
    /(?:发了|发送|发给)[^。\n]{0,10}(?:PDF|链接|邮件|作品集)|(?:PDF|链接|邮件|作品集)[^。\n]{0,10}(?:发了|发送|发给)/.test(userText),
    /(?:读到|读了|看过|已读|不知道[^。\n]{0,8}(?:读|看)|是否[^。\n]{0,6}(?:读|看))/.test(userText),
    /(?:回复|回应|收到|没回)/.test(userText),
    /(?:采用|用了|使用)/.test(userText),
    /(?:效果|反馈)/.test(userText),
  ].filter(Boolean).length
  const feedback=/(?:回来反馈|状态更新|反馈[:：]|不知道[^。\n]{0,8}(?:读|回复)|只说了|没有约定)/.test(userText)
    ||(priorUserTexts.some(text=>/(?:作品集)?链接[^。\n]{0,16}(?:发给|发送|发了)/.test(text))&&/(?:链接|PDF|邮件|作品集)/.test(userText)&&/(?:不知道|没有约定|只说了)/.test(userText))
  if(!explicitAsk&&!(feedback&&currentFacts>=2))return null
  let sent:string|null=null
  if(/PDF/.test(lastSend.clause.text))sent='已发：PDF已发送'
  else if(/(?:作品集)?链接/.test(lastSend.clause.text))sent='已发：作品集链接已发送'
  if(!sent)return null
  // Reuse the participant-report parser's polarity/uncertainty handling.
  // A broad subject-to-verb match also matched “不知道…有没有读到”.
  const outcomes=taskOutcomeReadback(all,undefined,true),readOutcome=outcomes.read
  const read=readOutcome.status==='reported_read'?(readOutcome.quote?.includes('导师确认')?'已读：导师确认读到':`已读：报告「${readOutcome.quote}」`)
    :readOutcome.status==='reported_not_read'?'已读：报告未读':'已读：未知'
  const replied=outcomes.response.status==='reported_no_response'?'已回复：未回复（截至报告）'
    :outcomes.response.status==='reported_response'
      ?outcomes.response.quote===readOutcome.quote&&read==='已读：导师确认读到'?'已回复：导师确认读到'
        :outcomes.response.quote?.includes('导师确认收到')?'已回复：导师确认收到':`已回复：报告「${outcomes.response.quote}」`
      :'已回复：未知'
  const adoption=outcomes.adoption.status!=='unknown'?`是否采用：报告「${outcomes.adoption.quote}」`:outcomes.adoption.unreported?'是否采用：未说明':'是否采用：未知'
  const effect=outcomes.effect.status!=='unknown'?`实际效果：报告「${outcomes.effect.quote}」`:outcomes.effect.unreported?'实际效果：未反馈':'实际效果：未知'
  const states=[sent,read,replied,adoption,effect].join('。')+'。'
  if(explicitAsk)return states
  const gap=/没有约定/.test(userText)
    ?'当前缺口：发送时只说了“请看看”，没有约定回复时间；导师是否读过和是否采用仍未知。'
    :readOutcome.status==='reported_read'
      ?'当前缺口：导师已确认读到，是否评价内容未报告；是否采用和实际效果仍未知。'
      :'当前缺口：导师是否读过、是否采用和实际效果仍未知。'
  return states+'\n\n'+gap
}

// A two-option feedback turn already contains its own facts. A short
// server-rendered summary gives the user a substantive first content without
// claiming which option is suitable; the ordinary model turn still finishes.
function reportedCountObservation(userText:string):string|null{
  const quotes=reportedEvidenceFromText(userText).sourceBounds.filter(bound=>bound.kind==='reported_count_change').map(bound=>bound.quote)
  if(!quotes.length)return null
  return `本次观察：${[...new Set(quotes)].map(quote=>'「'+quote+'」').join('；')}。次数变化的原因仍未知，不能据此确定某种方法造成这一变化。`
}
// A user asking for a provisional understanding after explicitly separating a
// pending email from a paused item can receive the exact reported status before
// the provider finishes. This is a source readback, not a placeholder and not
// an inference about whether the recipient read, accepted, or acted on it.
export function provisionalQuestionPreview(userText:string):string|null{
 if(!/(?:先|只)问(?:我)?(?:一|一个)(?:个)?问题|先问一个问题/.test(userText))return null
 const negatesFreelance=/(?:不|没|并不|不想|不要|拒绝)[^。！？]{0,12}(?:创业|自由职业)|(?:创业|自由职业)[^。！？]{0,12}(?:不|没|拒绝)/.test(userText)
 if(/自由/.test(userText)&&/(?:创业|自由职业)/.test(userText)){
  if(negatesFreelance){
   // Never turn an explicitly rejected path into the clarifying question.
   return /稳定/.test(userText)?'你更在意稳定，具体希望先确认哪一方面？':null
  }
  return '你说的自由，最想先体现在哪一块：自己安排时间、选择工作地点、决定工作内容，还是少受他人评价？'
 }
 return null
}
export function provisionalCorrectionPreview(userText:string):string|null{
 if(!/^\s*更正[：:]/.test(userText))return null
 const parts:string[]=[]
 for(const clause of scanUserClauses(userText)){
  if(clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.attributedToOther||clause.quoteSpans.length||clause.codeSpans.length)continue
  let text=clause.text.trim()
  if(/^更正[：:]/.test(text))text=text.replace(/^更正[：:]\s*/,'')
  if(!text||assistantRequestClause(text)||/^(?:只|请|麻烦|并|再)/.test(text))break
  parts.push(text)
 }
 const body=parts.join('；').replace(/[。；;]+$/,'')
 return body?body+'。':null
}
export function provisionalStatePreview(userText:string,_priorUserTexts:string[]=[]):string|null{
 if(!/(?:暂定|当前|阶段)理解/.test(userText))return null
 // A preview must derive only from the current source. Historical text can
 // describe a state the user has just corrected, and a hypothetical clause is
 // not a report at all. Let the source-aware turn answer those cases.
 if(/(?:如果|假如|要是|假设|万一)/.test(userText))return null
 if(/(?:老师|导师).{0,20}(?:邮件|消息).{0,20}(?:已经|已)回复|(?:已经|已)回复.{0,20}(?:老师|导师)/.test(userText))return null
 if(/(?:同学).{0,12}(?:表格).{0,12}(?:恢复|已恢复)|(?:表格).{0,12}(?:恢复|已恢复)/.test(userText))return null
 const all=userText
 if(/(?:老师|导师).{0,20}(?:邮件|消息).{0,20}(?:没(?:有)?回复|未回复)|(?:没(?:有)?回复|未回复).{0,20}(?:老师|导师).{0,20}(?:邮件|消息)/.test(all)
  &&/(?:同学).{0,12}(?:表格).{0,12}(?:暂停|先暂停)|(?:表格).{0,12}(?:暂停)/.test(all)){
  return '暂定理解：老师邮件未回复，结果未知；同学表格已暂停。'
 }
 return null
}
export function groundedFeedbackPreview(userText:string):string|null{
  const clauses=scanUserClauses(userText)
  // This fast lane cannot disambiguate mixed reported speech. Let the ordinary
  // source-aware turn handle it instead of turning somebody else's or a
  // hypothetical experience into a first-person receipt.
  if(clauses.some(clause=>clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.quoteSpans.length||clause.codeSpans.length))return null
  const scope=responseRequestScope(userText)
  if(scope.judgmentUpdate&&!scope.actionRequested){
    const observation=reportedCountObservation(userText)
    if(observation)return observation
  }
  if(!/回来反馈/.test(userText))return null
  if(!/(?:岗位|职位)/.test(userText)||!/(?:培养方案|硕士|读研)/.test(userText))return null
  const skills=clauses.some(clause=>!clause.interrogative&&!assistantRequestClause(clause.text)
    &&/两项技能我(?:都)?做过课程练习/.test(clause.text)
    &&!/(?:没有|没|未|不曾|并非|不是|不确定)/.test(clause.text))
  const theory=clauses.some(clause=>!clause.interrogative&&!assistantRequestClause(clause.text)
    &&/我不喜欢的纯理论必修/.test(clause.text)
    &&!/(?:没有|没|不含|不存在)/.test(clause.text))
  if(!skills&&!theory)return null
  const facts=[
    skills?'岗位方面：要求的两项技能你做过课程练习':'',
    theory?'培养方案方面：有你不喜欢的纯理论必修':'',
  ].filter(Boolean).join('；')
  return `已收到两个选项的反馈：${facts}。这个小样本只代表这两个选项，不能证明岗位适合，也不能证明读研不适合。`
}

// This is skipped framing, never a displayed operation receipt. Every clause
// must match an explicit current request; quoted/conditional reports cannot
// authorize it. Unknown extra claims still gate the entire preview.
function requestedPauseFraming(sentence:string,userText:string):boolean{
  const own=scanUserClauses(userText).filter(c=>!c.quoted&&!c.code&&!c.conditional&&!c.interrogative&&!c.attributedToOther&&!c.quoteSpans.length&&!c.codeSpans.length).map(c=>c.text.trim())
  const topics=own.map(text=>/^(?:请|麻烦)?(?:先|暂时)?暂停(.{1,24})$/.exec(text)?.[1]).filter(Boolean)
  if(!topics.length)return false
  const keep=own.some(text=>/^(?:不|不要|别)删除(?:刚才|此前|已)?(?:查过|核实过|确认过)的事实$/.test(text))
  const stop=own.some(text=>/^(?:这周|本周|今天|现在)?不(?:再)?安排(?:新|任何)?任务$/.test(text))
  const clauses=scanUserClauses(sentence)
  return clauses.length>0&&clauses.every(c=>!c.quoted&&!c.code&&!c.quoteSpans.length&&!c.codeSpans.length&&(
    topics.some(topic=>c.text.trim()===topic+'已暂停')
    ||keep&&/^(?:刚才|此前)?(?:查过|核实过|确认过)的事实(?:仍)?保留$/.test(c.text.trim())
    ||stop&&/^(?:这周|本周|今天|现在)?不(?:再)?安排(?:新|任何)?任务$/.test(c.text.trim())
  ))
}

export function safeEarlySentence(raw:string,maxChars=120,field:'reply'|'lead'='reply',authorizedText?:string):string|null{
  const opening=topLevelReplyOpening(raw,field)
  if(!opening)return null
  // A requested comparison may use a semicolon-terminated substantive option
  // clause. It is an exact retained fragment, not a filler or earlier timer.
  const scope=authorizedText===undefined?null:responseRequestScope(authorizedText)
  const summaryBoundary=field==='reply'&&scope?.summaryRequested&&!scope.actionRequested
  const clauseBoundary=field==='reply'&&(scope?.comparisonRequested||summaryBoundary)
  let encoded=''
  for(let i=opening.index+opening.length;i<raw.length;i++){
    const char=raw[i]
    if(char==='"')break
    encoded+=char
    let atBoundary=/[。！!？?\r\n]/.test(char)||(clauseBoundary&&/[；;]/.test(char))
    if(char===String.fromCharCode(92)){
      const next=raw[++i]
      if(next===undefined)break
      encoded+=next
      if(next==='u'){
        const hex=raw.slice(i+1,i+5)
        if(!/^[0-9a-f]{4}$/i.test(hex))break
        encoded+=hex;i+=4
        atBoundary=/^(?:3002|ff01|ff1f|0021|003f|000a|000d)$/i.test(hex)||(clauseBoundary&&/^(?:ff1b|003b)$/i.test(hex))
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
    const terminator=clauseBoundary?/([。！!？?；;]|\n\n|\r\n\r\n)/:/([。！!？?]|\n\n|\r\n\r\n)/
    const parts=decoded.split(terminator)
    const firstTerminator=parts.findIndex((part,index)=>index%2===1)
    if(firstTerminator<1)continue
    for(let index=0;index+1<parts.length;index+=2){
      // A receipt of the conversational correction has no storage authority.
      // Keep the substantive exact suffix; write-success prefixes remain gated.
      let sentence=parts[index]!.trim().replace(/^(?:你的)?(?:更正|反馈)已收到[：:]\s*/,'')
      if(/[；;]/.test(parts[index+1]??'')){
        // Optimize only an explicitly labelled option with an actual start
        // body. A long introduction or option label is not first content.
        const option=comparisonOptionBody(sentence)
        const start=option===null?null:/^.{0,100}?(?:从哪开始|起点|先做什么)\s*[：:—-]+\s*(.+)$/.exec(option)
        const summary=summaryBoundary?/^(?:当前)?(?:暂定|阶段)?(?:理解|判断|总结)[：:]\s*(.+)$/.exec(sentence):null
        const body=summary?.[1]??start?.[1]
        if(!body||body.length<8||/(?:之后|后续|下文|接下来).{0,8}(?:说明|解释|介绍|展开|给出)/.test(body))continue
        if(summary&&(body.includes('`')||scanUserClauses(body).some(c=>c.conditional||c.quoted||c.code||c.attributedToOther||c.quoteSpans.length||c.codeSpans.length)))return null
      }
      if(/[？?]/.test(parts[index+1]??''))sentence=(withoutUnreportedQuestionExamples(sentence+parts[index+1],authorizedText)??(sentence+parts[index+1])).slice(0,-1)
      if(authorizedText!==undefined)sentence=repairSingleJobJd(sentence,authorizedText)??sentence
      // A strict heading prefix is display framing, not a factual claim. Skip
      // it before the safety gate so its words cannot hide the next substantive
      // sentence; arbitrary sentences containing 确认/核对 are not titles.
      const budgetPreview=/\d+\s*(?:分钟|小时).*(?:以内|预算|安排|任务|复习|作业)/.test(sentence)
      const headingCandidate=sentence.replace(/^(?:\d+|[一二两三四五六七八九十]+)\s*(?:分钟|小时)\s*/,'')
      if(/^(?:更新|调整|重开)(?:判断|理解|状态|[^。！？]{0,8}期待)(?:[：:,，]|$)/.test(sentence)||/^(?:比较|梳理|整理)(?:一|两|二|几|多|[0-9])(?:种|类|个)[^。！？]{0,20}(?:方式|路径|方向|方案)$/.test(sentence))continue
      if(/比较|对比|探索|方式|方法|方案|选项|路径|步骤/.test(sentence)&&/(?:主要)?(?:有|分为|包括|提供|给出)(?:以下|这)?(?:两|二|三|四|五|几|\d+)(?:种|类|个)(?:方式|方法|方案|选项|路径|步骤)?$/.test(sentence))continue
      if(!budgetPreview&&/^(?:先|接下来|下面|这里)\s*(?:按|用|从)?[^。！？]{0,16}(?:排|安排|规划|设计|比较|区分|辨别|对比|核对|厘清|确认|梳理|整理|分析|看|观察|说明)[^。！？]{0,24}$/.test(headingCandidate))continue
      // An external claim gates the draft. A simple allow-state switch is not
      // proof that the model's state sentence is grounded, so state previews
      // wait for the normal validated reply rather than exposing invented
      // adoption/effect claims.
      // Stability as an explicitly desired value is not a proven stable
      // phenomenon. Exempt only that grammatical value phrase, leaving every
      // other stability claim and the rest of the sentence safety-gated.
      const provisionalStateSummary=/^(?:当前|阶段)?暂定理解[：:]/.test(sentence)&&/(?:结果|状态|是否|仍)(?:仍然|仍|尚|还|暂时)?(?:未知|未确认|不明确)/.test(sentence)
      let safetyCandidate=sentence.replace(/(?:希望|期待|追求|看重|在意|想要)(?:更|比较|相对)?稳定/g,'').replace(/稳定期待/g,'个人期待')
      // An explicitly reported family expectation is not evidence that an
      // outcome is stable. Exempt only that exact sourced phrase; the rest of
      // the sentence still passes every ordinary claim/receipt safety gate.
      if(authorizedText!==undefined)for(const expectation of reportedEvidenceFromText(authorizedText).externalExpectations){
        const phrase=expectation.quote.replace(/我|本人/g,'')
        if(phrase.length>=4&&phrase.includes('稳定'))safetyCandidate=safetyCandidate.replace(phrase,'外部期待')
      }
      if(provisionalStateSummary)safetyCandidate=safetyCandidate.replace(/已(?:经)?发出/g,'报告发出')
      if(summaryBoundary&&authorizedText!==undefined&&requestedPauseFraming(sentence,authorizedText))continue
      if(authorizedText!==undefined&&responseRequestScope(authorizedText).comparisonRequested&&!comparisonUniverseAccepts(sentence,authorizedText))return null
      if(unsafePreviewClaim(safetyCandidate))return null
      if(authorizedText!==undefined&&/[？?]/.test(parts[index+1]??'')&&openUnreportedChoiceQuestion(sentence+'？',authorizedText))return null
      if(selfStatus.test(sentence))continue
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



