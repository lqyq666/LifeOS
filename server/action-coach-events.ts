import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { Value } from 'typebox/value'
import { Type } from 'typebox'
import { pool, transaction, HttpError, requireRow } from './db.ts'
import { eventDeltaSchema, type EventDelta } from './action-coach-contracts.ts'
import type { Run } from './store.ts'
import type { CoachKnowledgeRef } from './coach-knowledge.ts'
import { growthQuoteSuppressed } from './growth-privacy.ts'
import {reconcileActionStages,type ActionCase} from './workflows/action-review.ts'
import {scanUserClauses,assistantRequestClause} from './user-command-spans.ts'
import {reportedEvidenceFromText,reportedOutcomeSourceClauses,sameReportedResponseSubject,unrelatedExternalCorrection} from './turn-contract.ts'
import {explicitMaterialForms} from './experience-episodes.ts'

// Provider selections are rendered before staging. Keep the provider contract
// unchanged while checking the complete server-created provenance here.
const stagedEventSchema=structuredClone(eventDeltaSchema)
const materialSourceRefSchema=Type.Union([
  Type.Object({type:Type.Union([Type.Literal('growth'),Type.Literal('experience')]),id:Type.String({format:'uuid'}),revision:Type.Integer({minimum:1})},{additionalProperties:false}),
  Type.Object({type:Type.Literal('message'),id:Type.String({format:'uuid'}),conversationId:Type.String({format:'uuid'}),quote:Type.String({minLength:1,maxLength:8000})},{additionalProperties:false}),
])
function bindStagedMaterialSources(schema:unknown){
  if(!schema||typeof schema!=='object')return
  const node=schema as Record<string,any>
  if(node.properties?.materialEvidence)node.properties.materialEvidence.items.properties.sourceRef=materialSourceRefSchema
  for(const value of Object.values(node))if(Array.isArray(value))value.forEach(bindStagedMaterialSources);else if(value&&typeof value==='object')bindStagedMaterialSources(value)
}
bindStagedMaterialSources(stagedEventSchema)

export type CoachSource={messageId:string;quote:string;conversationId:string}
export type CoachNode={id:string;revision:number;kind:'fact'|'feeling'|'user_interpretation'|'unknown';status:'active'|'resolved'|'declined';content:string;source:CoachSource|null;inquiryContext?:{affects:string;reason:string;dependsOn:string[]};supersededByActionCorrection?:boolean}
export type CoachAction={id:string;revision:number;status:'proposed'|'closed'|'stale';draft:Record<string,unknown>|null;closedReason:string|null;knowledgeRefs?:CoachKnowledgeRef[];requestSources?:CoachSource[];unavailableReasons?:('knowledge_sources_changed_or_unavailable'|'user_sources_unavailable'|'material_withdrawn')[]}
export type CoachProcessTurn={revision:number;sourceMessageId:string;nodeIds:string[];questionsAskedAfterInput:string[];inputSources?:CoachSource[];introducedUnknownNodeIds?:string[]}
export type CoachActionReport={sourceMessageId:string;eventRevision:number;reportedAt:string;sourceQuotes:string[];stages:ActionCase['known'];evidence:Partial<Record<keyof ActionCase['known'],{sourceMessageId:string;eventRevision:number;evidenceQuotes:string[]}>>;scopeAmbiguities?:('multiple_actors'|'multiple_material_forms')[]}
export type CoachEvent={id:string;conversationId:string;title:string;revision:number;generation:number;nodes:CoachNode[];actions:CoachAction[];asked:string[];processTurns?:CoachProcessTurn[];actionStages?:ActionCase['known'];actionStageEvidence?:CoachActionReport['evidence'];actionStageScope?:{basis:'latest_source_report_only';sourceMessageId:string;eventRevision:number};actionProgressReports?:CoachActionReport[];createdAt:string;updatedAt:string}
export type CoachStaged={delta:EventDelta;reply:string;eventId:string;actionId?:string;knowledgeRefs?:CoachKnowledgeRef[]}

export function unchangedProposedAction(event:CoachEvent|null|undefined,delta:EventDelta):boolean{
  if(!event||delta.target.operation!=='continue'||delta.target.eventId!==event.id||delta.action?.operation!=='modify')return false
  const change=delta.action,current=event.actions.find(action=>action.id===change.actionId)
  return Boolean(current&&current.status==='proposed'&&current.revision===change.expectedRevision&&current.draft!==null&&JSON.stringify(current.draft)===JSON.stringify(change.draft))
}

// Retain only contiguous original input outside node-backed quotes. Union all
// matching ranges first, so overlapping/nested quotes cannot leak old text.
function unquotedRequestParts(content:string,quotes:readonly string[]):string[]{
  const ranges:[number,number][]=[]
  for(const quote of new Set(quotes)){
    if(typeof quote!=='string'||!quote.trim())continue
    for(let at=content.indexOf(quote);at>=0;at=content.indexOf(quote,at+1))ranges.push([at,at+quote.length])
  }
  ranges.sort((a,b)=>a[0]-b[0])
  const parts:string[]=[];let cursor=0
  for(const [start,end] of ranges){if(start>cursor)parts.push(content.slice(cursor,start).trim());cursor=Math.max(cursor,end)}
  parts.push(content.slice(cursor).trim())
  return parts.filter(Boolean)
}

export function coachInputCovered(text:string,recorded:readonly string[],newQuotes:readonly string[]=[]){
  return unquotedRequestParts(text,[...recorded,...newQuotes]).length===0
}

// Literal display metadata, not a semantic classifier or a generation gate.
// Materials, code, quoted speech and URLs are not questions to the user.
export function visibleCoachQuestions(reply:string,material?:string):string[]{
  const visible=(material?reply.split(material).join('\n'):reply)
    .replace(/```[\s\S]*?```|`[^`]*`/g,'\n')
    .replace(/[“「『][\s\S]*?[”」』]/g,quote=>/[？?]/.test(quote)?'\n':quote)
    .replace(/!?\[[^\]\n]*\]\((?:\/|https?:\/\/)[^)\n]*(?:\)|$)/g,'\n')
    .replace(/https?:\/\/\S+/g,'\n')
  return [...new Set((visible.match(/[^。！？!?;；\n]*[？?]/g)??[]).map(question=>question.trim().replace(/^[\d.、\-#*\s]+/,'')))]
}

async function enabled(c:PoolClient,user:string){
  return (await c.query('SELECT enabled FROM user_memory_settings WHERE user_id=$1',[user])).rows[0]?.enabled===true
}
async function eventFor(c:PoolClient,user:string,conversation:string,id:string,lock=false){
  const row=requireRow((await c.query(`SELECT * FROM coach_events WHERE user_id=$1 AND id=$2 AND status='active'${lock?' FOR UPDATE':''}`,[user,id])).rows[0])
  if(row.conversation_id!==conversation&&!await enabled(c,user))throw new HttpError(403,'MEMORY_DISABLED')
  return row
}
async function sourceContent(c:PoolClient,user:string,source:CoachSource):Promise<string|null>{
  if(await growthQuoteSuppressed(c,user,source.messageId,source.quote))return null
  const row=(await c.query(`SELECT m.content FROM messages m
    WHERE m.user_id=$1 AND m.conversation_id=$2 AND m.id=$3 AND m.role='user'
    AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE s.user_id=m.user_id AND s.source_message_id=m.id)
    AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id)
    AND NOT EXISTS(SELECT 1 FROM experiences e WHERE e.user_id=m.user_id AND e.source_message_id=m.id AND e.status='deleted')`,[user,source.conversationId,source.messageId])).rows[0]
  return row?.content??null
}
async function sourceAvailable(c:PoolClient,user:string,source:CoachSource){
  const content=await sourceContent(c,user,source)
  return Boolean(content&&source.quote.trim()&&content.includes(source.quote))
}
async function currentSource(c:PoolClient,run:Run,source:{messageId:string;quote:string}):Promise<CoachSource>{
  if(source.messageId!==run.source_message_id)throw new HttpError(400,'COACH_CURRENT_SOURCE_REQUIRED')
  const ref={...source,conversationId:run.conversation_id}
  const content=await sourceContent(c,run.user_id,ref)
  // Repair guidance carries the exact mismatch so a bounded repair can fix the
  // quoted span deterministically instead of guessing which reference failed.
  if(content===null||!source.quote.trim()||!content.includes(source.quote))throw new HttpError(400,'COACH_SOURCE_INVALID',undefined,{quote:source.quote.slice(0,400),currentText:content?.slice(0,2000)??null,currentMessageId:run.source_message_id})
  return ref
}
// Intent classes, not content keywords: the current user message itself asks
// for a deliverable (request) or refines an existing one (rewrite). Narrative
// forms like 他说可以/我写了四十页/发给了他 deliberately do not match.
// Modal words also describe the person's capacity or intentions. Without a
// directed request, require a concrete artifact rather than any subsequent 做.
// A directed 做 also needs an artifact: "帮我选一个能做的行动" asks
// for advice, and must not force the material-only presentation reply.
// Stop at the first request verb: a later 问 in 问题 must not pull a
// qualifier such as 暂不催促 into the request's negation scope.
const requestIntent=/(?:帮我|请(?!教)|给我|能不?能|可不可以|直接|麻烦)[^。！？\n]{0,16}?(?:写|起草|拟|列|问(?!题)|发(?!现|展|生|挥|育))|(?:帮我|请(?!教)|给我|能不?能|可不可以|直接|麻烦)[^。！？\n]{0,16}?做[^。！？\n]{0,8}(?:消息|邮件|短信|文案|草稿|话术|计划|清单|简历|作品集|文档|表格|方案|提纲|报告|海报)|(?:想要?|打算|需要|可以|先)[^。！？\n]{0,16}?(?:写|起草|拟|列|发(?!现|展|生|挥|育))|(?:想要?|打算|需要|可以|先)[^。！？\n]{0,16}?做[^。！？\n]{0,8}(?:消息|邮件|短信|文案|草稿|话术|计划|清单|一(?:句|段|份|条))|(?:写|拟)一(?:句|段|份|条|个)|给我一(?:句|条|段)|发一(?:句|条|段)|怎么(?:说|回|开口|问|写|表述|措辞)/
const rewriteIntent=/(?:再|稍微)?(?:改|换|缩短|改短|润色|重写|调整|去掉|删掉|加上|加一|短一点|语气|措辞)/
// Delivery framing marks the reply's non-material remainder as presentation of
// a sendable artifact ("可以先发这段：/可以这样问："); conversational
// preambles like "我们先了解一下：" do not.
const framingIntent=/^(?:可使用(?:下面|这段|这条)|(?:可以|直接|就能|先|拿去)[^。！？\n“”「」『』"']{0,8}(?:发|用|拿|问|说|回|给|发送|复制)|(?:发|用)这(?:段|句|条)|给你写|写一(?:段|句|份)|这(?:段|句|条)(?:话|消息)?[^。！？\n“”「」『』"']{0,8}(?:发|用|给)|直接使用|复制)/
function coachMaterialFraming(text:string){
  return text.split(/[。！？!?；;\n，,:：]/).some(part=>framingIntent.test(part.trim()))
}
// A presentation clause followed by actual text is a delivered artifact, not
// merely a request for missing details. This finite contract check is shared
// with staging; it does not infer material from arbitrary conversational prose.
export function coachMaterialPresentation(reply:string){
  for(const match of reply.matchAll(/[:：]/g)){
    if(reply.slice(match.index!+1).trim()&&coachMaterialFraming(reply.slice(0,match.index)))return true
  }
  return false
}
const materialVerb=/(?:写|起草|拟|做|改|换|压成|缩短|润色|重写|调整|联系|联络|发|沟通)/
// A bare 别 is a command only when it introduces a material/contact verb.
// Narrative nouns such as 别的发送方式 must not become a lasting stop request.
const negativeRequest=new RegExp('(?:不要|不用|不必|不想|不需要|无需|别(?=(?:再|先|帮我|替我|给我)*'+materialVerb.source+')|暂不|先不|^不)')
export function materialRequest(text:string,operation:'create'|'modify'):'requested'|'declined'|'unspecified'{
  // A declined request contains the same verbs as an affirmative one. Evaluate
  // clauses separately so "不用写长邮件，帮我写一句" keeps its positive
  // request without treating "不要帮我写，只想聊聊" as permission.
  let requested=false,declined=false
  for(const clause of text.split(/[，,。！？!?；;\n]/)){
    if(/^\s*(?:我)?(?:想|打算|希望)(?:先)?做(?:一个|个)(?:校园产品|校园项目|产品|项目)\s*$/.test(clause))continue
    const request=requestIntent.exec(clause)
    const narratedRequest=request&&/^(?:了|过)/.test(clause.slice(request.index+request[0].length))&&!/帮我|请|给我|麻烦|能不?能|可不可以/.test(request[0])
    const directTransform=/(?:^|现在想|我想)(?:把)[^。！？\n]{1,36}(?:压成一(?:句|段)|写成一(?:句|段)|问题改成[:：])|(?:^|现在想|我想)把[^。！？\n]{0,24}(?:消息|邮件|短信|文案|草稿|问题|简历|描述)[^。！？\n]{0,12}(?:改短|缩短|润色|重写)/.exec(clause.trim())
    const rewrite=operation==='modify'?rewriteIntent.exec(clause):null
    if([narratedRequest?null:request,rewrite,directTransform].some(match=>match&&!negativeRequest.test(clause.slice(0,match.index+match[0].length))))requested=true
    const negative=negativeRequest.exec(clause)
    if(negative&&materialVerb.test(clause.slice(negative.index+negative[0].length)))declined=true
  }
  return requested?'requested':declined?'declined':'unspecified'
}
export function deliverableIntent(text:string,operation:'create'|'modify'){
  return materialRequest(text,operation)==='requested'
}
export function effectiveMaterialRequest(text:string,operation:'create'|'modify',event:CoachEvent|null){
  let disposition=materialRequest(text,operation)
  if(disposition==='unspecified'&&event){
    for(const turn of [...event.processTurns??[]].reverse()){
      const fragments=[...turn.inputSources??[],...event.nodes.filter(node=>turn.nodeIds.includes(node.id)&&node.source).map(node=>node.source!)]
      const previous=materialRequest(fragments.map(source=>source.quote).join('\n'),operation)
      if(previous!=='unspecified'){disposition=previous;break}
    }
  }
  return {disposition,inheritedCreateRequest:operation==='create'&&disposition==='requested'&&materialRequest(text,operation)==='unspecified'&&Boolean(event)&&!event!.actions.some(action=>action.status==='proposed')}
}
// Explicit blank forms contain no inferred personal or job facts. They use the
// existing material transaction and the same user-clause/request authority.
export function requestedBlankJobWorksheet(text:string){
 const clauses=scanUserClauses(text).filter(clause=>!clause.quoted&&!clause.code&&!clause.attributedToOther&&!clause.conditional&&!clause.interrogative)
 if(!clauses.some(clause=>deliverableIntent(clause.text,'create')&&/岗位/.test(clause.text)&&/核对表|空白表|填写表/.test(clause.text))||!clauses.some(clause=>/未知处留空|未知.*留空|空白.*模板/.test(clause.text)))return null
 return {readiness:'template' as const,content:'岗位职责与要求核对表（待填写）\n\n岗位名称：________\n公开说明链接：________\n发布单位：________\n截止时间：________\n\n一项职责（摘录公开说明原文）：________\n一项要求（摘录公开说明原文）：________\n我的对应证据（没有则留空）：________\n目前仍不知道的事：________\n\n未查到的字段留空，不补造要求。填写或复制此表不表示已投递、已被采用或具备岗位能力。'}
}
export function requiresImmediateMaterial(text:string){
  if(!deliverableIntent(text,'create'))return false
  // A genuinely missing addressee can still require clarification. Otherwise
  // natural "帮我写一句" and "把消息改短" request delivery just as directly
  // as "请直接起草"; reuse the same guarded clause/request authority.
  if(/(?:不知道|不清楚|还没确定)(?:发给谁|给谁|收件人|对象)/.test(text))return false
  return scanUserClauses(text).filter(part=>!part.quoted&&!part.code&&!part.conditional&&!part.attributedToOther).some(part=>{
    const clause=part.text.trim()
    // Turn-contract mode E opens the material lane when the user explicitly
    // demands the deliverable NOW (请直接/马上/现在+写/起草/拟…). A plain
    // 帮我写一封介绍邮件 may legitimately need a clarification first and
    // stays non-immediate.
    return /^(?:请)?(?:直接|马上|现在)(?:帮我|给我|替我)?(?:写|起草|拟|做|生成|整理|改写|润色)/.test(clause)
      ||/^(?:请)?(?:直接|马上|现在)给我一(?:句|段|份|条)/.test(clause)
      ||clause.startsWith('直接起草')||clause.startsWith('请直接起草')
      ||/^(?:请)?(?:先)?(?:帮我|给我|替我)(?:写|起草|拟|做|整理)[^。！？]{0,60}(?:模板|空白表|核对表|填写表)/.test(clause)
      ||/^(?:请)?(?:先|只|再)?(?:帮我|给我|替我)(?:写|起草|拟|改写|润色)[^。！？]{0,60}(?:消息|邮件|短信|文案|草稿|问题|简历|作品描述|(?:本人|个人|我的)?贡献描述|介绍)/.test(clause)
      ||/^(?:现在想|我想)?把[^。！？\n]{0,24}(?:消息|邮件|短信|文案|草稿|问题|简历|描述)[^。！？\n]{0,12}(?:改短|缩短|润色|重写)/.test(clause)
      ||/^(?:现在想|我想)?把[^。！？\n]{1,36}(?:压成一(?:句|段)|写成一(?:句|段)|问题改成[:：])/.test(clause)
  })
}

// The same source/duplicate decision is used at staging and at commit. A
// swallowed stale quote is allowed only when the current input is fully covered;
// chatter and short constraints may instead be retained by process inputSources.
async function coachNodeSource(c:PoolClient,run:Run,eventId:string|undefined,node:NonNullable<EventDelta['nodes']>[number],newQuotes:string[]):Promise<CoachSource|null>{
  if(node.kind==='unknown')return null
  // The exact quote must be a reported fact, not a request, question or
  // hypothetical clause. Existing turn-contract extraction applies the same
  // boundary; enforce it here before an event node can persist.
  const clauses=scanUserClauses(node.source.quote)
  if(clauses.length&&clauses.some(clause=>clause.conditional||assistantRequestClause(clause.text))){
    // Optional interpretations cannot make a request/conditional clause into
    // a stored fact. Drop that node and keep the valid reply and other nodes;
    // a factual node still fails closed.
    // A request/conditional clause cannot become a stored fact. On an existing
    // event, drop only this optional/misclassified node; a new event still
    // fails closed because its title/source may itself be request text.
    if(node.kind==='user_interpretation'||eventId)return null
    throw new HttpError(400,'COACH_SOURCE_INVALID',undefined,{quote:node.source.quote.slice(0,400)})
  }
  try{return await currentSource(c,run,node.source)}
  catch(error){
    if(error instanceof HttpError&&error.code==='COACH_SOURCE_INVALID'&&eventId){
      const recorded=(await c.query("SELECT content FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND status<>'withdrawn' AND source IS NOT NULL",[run.user_id,eventId])).rows.map(row=>row.content as string)
      if(recorded.includes(node.source.quote)){
        const text=await sourceContent(c,run.user_id,{messageId:run.source_message_id,conversationId:run.conversation_id,quote:node.source.quote})
        if(text!==null&&coachInputCovered(text,recorded,newQuotes.filter(quote=>quote!==node.source.quote)))return null
      }
    }
    throw error
  }
}

// A provider may put the same unknown in both dispositions when the current
// message neither answers nor declines it. Do not fail the whole turn and do
// not invent a resolution: keep the unknown active unless the user explicitly
// declined it. A concrete decline keeps the decline and drops the resolution.
const ignoredUnknownTopicTerms=new Set(['当时','现在','什么','为什么','是否','有没有','能否','具体','细节','问题','事情','选择','这个','这件','那件','告诉','回答','说明','解释','本人','用户','对方','需要','仍然','如何','多少'])
const unknownSegmenter=new Intl.Segmenter('zh',{granularity:'word'})
const unknownTopicTerms=(text:string)=>new Set([...unknownSegmenter.segment(text)].filter(item=>item.isWordLike).map(item=>item.segment).filter(term=>term.length>=2&&!ignoredUnknownTopicTerms.has(term)))
export function unknownQuestionTopicMatches(question:string,statement:string,engagement=false):boolean{
  const userTerms=unknownTopicTerms(statement),questionTerms=unknownTopicTerms(question)
  if(engagement)for(const term of ['愿意','投入','时间','内容','环节','步骤','部分','感到','喜欢','哪一类','哪个','哪类','一类','继续'])questionTerms.delete(term)
  // A generic field label alone has no subject identity. Keep it unresolved
  // rather than use an unrelated preference as its answer.
  return questionTerms.size>0&&[...questionTerms].every(term=>userTerms.has(term))
}
export function normalizeUnknownDispositionConflict<T extends {resolveUnknowns?:string[];declineUnknowns?:string[]}>(delta:T,userText:string,questions:Readonly<Record<string,string>>={}):{delta:T;conflictIds:string[]}{
 const resolved=new Set(delta.resolveUnknowns??[]),declined=new Set(delta.declineUnknowns??[])
 const conflictIds=[...resolved].filter(id=>declined.has(id))
 if(!conflictIds.length)return {delta,conflictIds}
 // "不知道/记不清" is unknown, not refusal. Only an explicit refusal keeps
 // the decline disposition; otherwise the unknown stays active.
  const refusal=/(?:不想说|不愿意说|跳过|拒绝回答|先不说|不方便说)/g
  const clauses=scanUserClauses(userText)
  const refusalClauses=clauses.filter(clause=>{
    if(clause.code||clause.conditional||clause.attributedToOther||clause.interrogative)return false
    refusal.lastIndex=0
    for(const match of clause.text.matchAll(refusal)){
      const start=clause.start+match.index!,end=start+match[0].length
      if(clause.quoteSpans.some(span=>start<span.end&&end>span.start)||clause.codeSpans.some(span=>start<span.end&&end>span.start))continue
      const before=clause.text.slice(0,match.index)
      if(/(?:不是|并非|并不是|并没有|没有|不是真的)\s*$/.test(before))continue
      return true
    }
    return false
  })
  const courtesy=/^(?:谢谢|请理解|先这样|就这样|麻烦了|嗯|好|好的)[。！!\s]*$/
  const bareRefusal=/^(?:(?:我|本人)(?:现在|暂时|先)?|(?:这个|这件事|这部分|这方面|这个问题|这项|这点)(?:我|本人)?)?(?:不想说|不愿意说|跳过|拒绝回答|先不说|不方便说)(?:了)?[。！？!！\s]*$/
  const wholeTurnRefusal=refusalClauses.length>0&&clauses.every(clause=>bareRefusal.test(clause.text.trim())||courtesy.test(clause.text.trim()))
  const questionMatches=(clause:string,question:string)=>unknownQuestionTopicMatches(question,clause)
  const refused=new Set(conflictIds.filter(id=>refusalClauses.some(clause=>{
    const question=questions[id]??''
    if(questionMatches(clause.text,question))return true
    const prior=clauses.find(item=>item.end<=clause.start&&item.sentenceStart===clause.sentenceStart&&item.text.trim())
    return Boolean(prior&&/(?:这件事|这个问题|这部分|这方面|这项|这个细节|这点)$/.test(prior.text.trim())&&questionMatches(prior.text,question))
  })
    ||(conflictIds.length===1&&wholeTurnRefusal)))
  const drop=new Set(conflictIds),next={...delta}
  if(delta.resolveUnknowns)next.resolveUnknowns=delta.resolveUnknowns.filter(id=>!drop.has(id))
  if(delta.declineUnknowns)next.declineUnknowns=delta.declineUnknowns.filter(id=>!drop.has(id)||refused.has(id))
 return {delta:next,conflictIds}
}

async function checkDelta(c:PoolClient,run:Run,delta:EventDelta,reply:string){
  if(!Value.Check(stagedEventSchema,delta))throw new HttpError(400,'COACH_DELTA_INVALID')
  if(delta.target.operation==='create'){
    await currentSource(c,run,delta.target.source)
    if(delta.corrections?.length||delta.resolveUnknowns?.length||delta.declineUnknowns?.length||delta.action&&delta.action.operation!=='create')throw new HttpError(400,'COACH_NEW_EVENT_TARGET_INVALID')
    if((delta.nodes??[]).some(node=>node.kind==='unknown'&&node.dependsOn?.length))throw new HttpError(400,'COACH_UNKNOWN_DEPENDENCY_INVALID')
  }else{
    const event=await eventFor(c,run.user_id,run.conversation_id,delta.target.eventId)
    if(event.revision!==delta.target.expectedRevision)throw new HttpError(409,'COACH_EVENT_REVISION_CONFLICT')
    if(!await sourceAvailable(c,run.user_id,event.title_source))throw new HttpError(409,'COACH_SOURCE_REVOKED')
    for(const correction of delta.corrections??[]){
      const node=(await c.query("SELECT kind,status,content FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,event.id,correction.nodeId])).rows[0]
      if(!node||node.status==='withdrawn')throw new HttpError(404,'COACH_NODE_NOT_FOUND')
      // A repeated exact fragment supplies no changed fact. Replacing a larger
      // source-backed node with it would erase the other reported details.
      // Unknown answers and genuinely changed quotes keep their existing path.
      if(node.kind!=='unknown'&&node.content.includes(correction.source.quote))throw new HttpError(400,'COACH_CORRECTION_UNCHANGED')
      if(node.kind!=='unknown'&&unrelatedExternalCorrection(node.content,correction.source.quote))throw new HttpError(400,'COACH_CORRECTION_SUBJECT_MISMATCH')
    }
    if((delta.declineUnknowns??[]).some(id=>(delta.resolveUnknowns??[]).includes(id))){
      const userText=String((await c.query("SELECT content FROM messages WHERE user_id=$1 AND id=$2 AND role='user'",[run.user_id,run.source_message_id])).rows[0]?.content??'')
      const conflictIds=(delta.resolveUnknowns??[]).filter(id=>(delta.declineUnknowns??[]).includes(id))
      const questions=(await c.query("SELECT id,content FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND kind='unknown' AND status='active' AND id=ANY($3::uuid[])",[run.user_id,event.id,conflictIds])).rows
      const questionById=Object.fromEntries(questions.map(row=>[String(row.id),String(row.content)]))
      Object.assign(delta,normalizeUnknownDispositionConflict(delta,userText,questionById).delta)
    }
    const resolved=new Set(delta.resolveUnknowns??[])
    const activeUnknownIds=new Set((await c.query("SELECT id FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND kind='unknown' AND status='active'",[run.user_id,event.id])).rows.map(row=>String(row.id)))
    for(const node of delta.nodes??[])if(node.kind==='unknown'&&(node.dependsOn??[]).some(id=>!activeUnknownIds.has(id)))throw new HttpError(400,'COACH_UNKNOWN_DEPENDENCY_INVALID')
    const asked=new Set(visibleCoachQuestions(reply))
    for(const node of delta.nodes??[])if(node.kind==='unknown'&&asked.has(node.question)&&(node.dependsOn??[]).some(id=>activeUnknownIds.has(id)&&!resolved.has(id)))throw new HttpError(400,'COACH_UNKNOWN_PREREQUISITE_OPEN')
    for(const id of delta.resolveUnknowns??[]){
      if(!(await c.query("SELECT 1 FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND id=$3 AND kind='unknown' AND status='active'",[run.user_id,event.id,id])).rowCount)throw new HttpError(400,'COACH_UNKNOWN_NOT_FOUND')
    }
    for(const id of delta.declineUnknowns??[]){
      if(!(await c.query("SELECT 1 FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND id=$3 AND kind='unknown' AND status='active'",[run.user_id,event.id,id])).rowCount)throw new HttpError(400,'COACH_UNKNOWN_NOT_FOUND')
    }
    if(delta.action&&delta.action.operation!=='create'){
      const action=(await c.query('SELECT revision,status,coach_knowledge_refs_valid(knowledge_refs) AS knowledge_valid,draft=$4::jsonb AS draft_unchanged FROM coach_actions WHERE user_id=$1 AND event_id=$2 AND id=$3',[run.user_id,event.id,delta.action.actionId,delta.action.operation==='modify'?JSON.stringify(delta.action.draft):null])).rows[0]
      if(!action)throw new HttpError(404,'COACH_ACTION_NOT_FOUND')
      if(action.revision!==delta.action.expectedRevision)throw new HttpError(409,'COACH_ACTION_REVISION_CONFLICT')
      if(delta.action.operation==='reuse'&&(action.status!=='proposed'||!action.knowledge_valid||delta.corrections?.length))throw new HttpError(409,'COACH_ACTION_REVIEW_REQUIRED')
      if(delta.action.operation==='modify'&&action.status==='closed')throw new HttpError(409,'COACH_ACTION_CLOSED')
      if(delta.action.operation==='modify'&&action.status==='proposed'&&action.knowledge_valid&&action.draft_unchanged&&!delta.corrections?.length)throw new HttpError(400,'COACH_ACTION_UNCHANGED')
    }
  }
  const newQuotes=(delta.nodes??[]).filter(node=>node.kind!=='unknown').map(node=>node.source.quote)
  for(const node of delta.nodes??[])await coachNodeSource(c,run,delta.target.operation==='continue'?delta.target.eventId:undefined,node,newQuotes)
  for(const correction of delta.corrections??[])await currentSource(c,run,correction.source)
  let inheritedCreateRequest=false
  if(delta.action&&delta.action.operation!=='close'){
    const operation=delta.action.operation==='modify'?'modify':'create'
    const current=await sourceContent(c,run.user_id,{messageId:run.source_message_id,conversationId:run.conversation_id,quote:''})
    const event=materialRequest(current??'',operation)==='unspecified'&&delta.target.operation==='continue'?await readCoachEvent(c,run.user_id,run.conversation_id,delta.target.eventId):null
    const effective=effectiveMaterialRequest(current??'',operation,event)
    inheritedCreateRequest=delta.action.operation==='create'&&effective.inheritedCreateRequest
    const disposition=effective.disposition
    if(disposition==='declined')throw new HttpError(400,'COACH_ACTION_DECLINED')
  }
  if(delta.action&&'draft' in delta.action){
    // Staged drafts are always the stored legacy shape: resume_portfolio
    // selections were rendered server-side before staging (P4).
    if(!('content' in delta.action.draft)||!delta.action.draft.content.trim())throw new HttpError(400,'MATERIAL_REFERENCE_INVALID')
    if(!reply.includes(delta.action.draft.content))throw new HttpError(400,'COACH_MATERIAL_NOT_VISIBLE')
    // A question-bearing material is conversation, not a deliverable, when the
    // turn gives no contrary evidence: no drafting/rewrite intent in the user
    // message, no user-directed framing around the material, and the material
    // standing as the entire reply. Shape, pronouns or question marks alone
    // never decide purpose; the paired regressions pin the known legal and
    // illegal forms and the boundary stays open to real-run review.
    if(visibleCoachQuestions((delta.action.draft as {content:string}).content).length>0){
      const current=(await c.query('SELECT content FROM messages WHERE user_id=$1 AND id=$2 AND role=\'user\'',[run.user_id,run.source_message_id])).rows[0]?.content as string|undefined
      const intent=inheritedCreateRequest||current&&deliverableIntent(current,delta.action.operation==='modify'?'modify':'create')
      const framed=delta.action.draft.content.trim()!==reply.trim()&&coachMaterialFraming(reply.replace(delta.action.draft.content,''))
      if(!intent&&!framed)throw new HttpError(400,'COACH_MATERIAL_IS_CONVERSATION')
    }
  }
}

export async function stageCoachEvent(run:Run,delta:EventDelta,reply:string):Promise<CoachStaged>{
  const staged={delta:structuredClone(delta),reply,eventId:delta.target.operation==='create'?randomUUID():delta.target.eventId,...(delta.action?.operation==='create'?{actionId:randomUUID()}: {})}
  await transaction(c=>checkDelta(c,run,staged.delta,reply))
  return staged
}

export async function persistCoachEvent(c:PoolClient,run:Run,staged:CoachStaged):Promise<CoachEvent>{
  // Called inside finishRun's transaction. Re-check everything at commit time;
  // staged validation is not authority for a later revision or memory grant.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[run.user_id+':memory-settings'])
  const delta=staged.delta
  if(delta.target.operation==='continue')await eventFor(c,run.user_id,run.conversation_id,staged.eventId,true)
  await checkDelta(c,run,delta,staged.reply)
  if(delta.target.operation==='create'){
    await c.query('INSERT INTO coach_events(id,user_id,conversation_id,title,title_source) VALUES($1,$2,$3,$4,$5)',[staged.eventId,run.user_id,run.conversation_id,delta.target.title,await currentSource(c,run,delta.target.source)])
  }else{
    await c.query('UPDATE coach_events SET revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2',[run.user_id,staged.eventId])
  }
  const newQuotes=(delta.nodes??[]).filter(node=>node.kind!=='unknown').map(node=>node.source.quote)
  for(const node of delta.nodes??[]){
    const source=await coachNodeSource(c,run,staged.eventId,node,newQuotes)
    if(node.kind!=='unknown'&&source===null)continue
    const content=node.kind==='unknown'?node.question:node.source.quote
    const duplicate=(await c.query("SELECT 1 FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND status='active' AND kind=$3 AND content=$4 AND source IS NOT DISTINCT FROM $5::jsonb",[run.user_id,staged.eventId,node.kind,content,source?JSON.stringify(source):null])).rowCount
    if(!duplicate){
      const inquiryContext=node.kind==='unknown'?{affects:node.affects?.trim()||'当前事项的理解或下一步',reason:node.reason?.trim()||'这个答案会改变当前判断或行动',dependsOn:node.dependsOn??[]}:{ }
      await c.query('INSERT INTO coach_nodes(id,user_id,event_id,kind,content,source,inquiry_context) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),run.user_id,staged.eventId,node.kind,content,source,inquiryContext])
    }
  }
  for(const correction of delta.corrections??[]){
    await c.query("UPDATE coach_nodes SET source=$4,content=$5,kind=CASE WHEN kind='unknown' THEN 'fact' ELSE kind END,inquiry_context=CASE WHEN kind='unknown' THEN '{}'::jsonb ELSE inquiry_context END,status='active',revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,staged.eventId,correction.nodeId,await currentSource(c,run,correction.source),correction.source.quote])
  }
  for(const id of delta.resolveUnknowns??[])await c.query("UPDATE coach_nodes SET status='resolved',revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,staged.eventId,id])
  for(const id of delta.declineUnknowns??[])await c.query("UPDATE coach_nodes SET status='declined',revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,staged.eventId,id])
  if(delta.corrections?.length)await c.query("UPDATE coach_actions SET status='stale',revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND status='proposed'",[run.user_id,staged.eventId])
  const change=delta.action
  if(change){
    if(change.operation==='create'||change.operation==='modify'){
      const sources=(await c.query("SELECT DISTINCT source->>'messageId' AS id FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND status='active' AND source IS NOT NULL",[run.user_id,staged.eventId])).rows.map(row=>row.id as string)
      if(change.operation==='modify'){
        // A drafting request can carry effort/contact limits without becoming a
        // fact node. Recover its owned lineage from actual material changes,
        // including older revisions that previously lost the request pointer.
        // Keep unquoted request portions in mixed inputs, while node-backed
        // facts remain governed by current node sources rather than old text.
        const requests=(await c.query(`SELECT DISTINCT m.id,m.content,
          ARRAY(SELECT n#>>'{source,quote}' FROM coach_event_revisions h,jsonb_array_elements(COALESCE(h.snapshot#>'{event,nodes}','[]'::jsonb)) n WHERE h.user_id=r.user_id AND h.event_id=r.event_id AND n#>>'{source,messageId}'=m.id::text) AS node_quotes
          FROM coach_event_revisions r
          JOIN runs t ON t.user_id=r.user_id AND t.request_id=r.request_id
          JOIN messages m ON m.user_id=t.user_id AND m.id=t.source_message_id
          WHERE r.user_id=$1 AND r.event_id=$2 AND m.role='user'
          AND r.snapshot->>'actionChange' IN ('create','modify')
          AND (r.snapshot->>'actionId'=$3 OR (NOT (r.snapshot ? 'actionId') AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(r.snapshot#>'{event,actions}','[]'::jsonb)) a WHERE a->>'id'=$3 AND a->>'status'='proposed')))
          AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE s.user_id=m.user_id AND s.source_message_id=m.id)
          AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id)
          AND NOT EXISTS(SELECT 1 FROM experiences e WHERE e.user_id=m.user_id AND e.source_message_id=m.id AND e.status='deleted')`,[run.user_id,staged.eventId,change.actionId])).rows
        sources.push(...requests.filter(row=>unquotedRequestParts(row.content,row.node_quotes).length).map(row=>row.id as string))
      }
      sources.push(run.source_message_id)
      if(change.operation==='create'){
        await c.query('INSERT INTO coach_actions(id,user_id,event_id,draft,source_message_ids,knowledge_refs) VALUES($1,$2,$3,$4,$5,$6)',[staged.actionId,run.user_id,staged.eventId,change.draft,[...new Set(sources)],JSON.stringify(staged.knowledgeRefs??[])])
      }else{
        await c.query("UPDATE coach_actions SET draft=$4,status='proposed',source_message_ids=$5,knowledge_refs=$6,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,staged.eventId,change.actionId,change.draft,[...new Set(sources)],JSON.stringify(staged.knowledgeRefs??[])])
      }
    }else if(change.operation==='close'){
      await c.query("UPDATE coach_actions SET status='closed',closed_reason=$4,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,staged.eventId,change.actionId,change.reason])
    }
  }
  await c.query('INSERT INTO coach_current(user_id,conversation_id,event_id) VALUES($1,$2,$3) ON CONFLICT(user_id,conversation_id) DO UPDATE SET event_id=EXCLUDED.event_id',[run.user_id,run.conversation_id,staged.eventId])
  const event=await readCoachEvent(c,run.user_id,run.conversation_id,staged.eventId)
  const askedThisTurn=visibleCoachQuestions(staged.reply,change&&'draft'in change&&'content'in change.draft?change.draft.content:undefined)
  event.asked=[...new Set([...event.asked,...askedThisTurn])]
  // Process chronology is reconstructed from owned runs/messages, not copied
  // recursively into each revision snapshot or classified as answered/refused.
  const {processTurns,actionProgressReports,...snapshotEvent}=event
  snapshotEvent.actions=event.actions.map(({requestSources,...action})=>action)
  await c.query('INSERT INTO coach_event_revisions(user_id,event_id,revision,generation,request_id,snapshot) VALUES($1,$2,$3,$4,$5,$6)',[run.user_id,event.id,event.revision,event.generation,run.request_id,{event:snapshotEvent,askedThisTurn,actionChange:change?.operation??null,actionId:staged.actionId??(change&&'actionId'in change?change.actionId:null)}])
  return readCoachEvent(c,run.user_id,run.conversation_id,event.id)
}

export async function readCoachEvent(c:PoolClient,user:string,conversation:string,id:string):Promise<CoachEvent>{
  const row=await eventFor(c,user,conversation,id)
  const rows=(await c.query("SELECT * FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND status<>'withdrawn' ORDER BY created_at,id",[user,id])).rows
  const actionRows=(await c.query('SELECT *,coach_knowledge_refs_valid(knowledge_refs) AS knowledge_valid FROM coach_actions WHERE user_id=$1 AND event_id=$2 ORDER BY created_at,id',[user,id])).rows
  const history=(await c.query("SELECT r.revision,r.snapshot->'askedThisTurn' AS asked,r.snapshot#>'{event,nodes}' AS nodes,r.snapshot->>'actionChange' AS action_change,CASE WHEN r.snapshot ? 'actionId' THEN ARRAY[r.snapshot->>'actionId'] ELSE ARRAY(SELECT a->>'id' FROM jsonb_array_elements(COALESCE(r.snapshot#>'{event,actions}','[]'::jsonb)) a WHERE a->>'status'='proposed') END AS action_ids,t.source_message_id FROM coach_event_revisions r JOIN runs t ON t.user_id=r.user_id AND t.request_id=r.request_id WHERE r.user_id=$1 AND r.event_id=$2 AND jsonb_typeof(r.snapshot#>'{event,nodes}')='array' ORDER BY r.revision",[user,id])).rows
  const recent=history.slice(-8)
  // Older snapshots may contain a citation truncated at its query marker.
  // Reuse the display extractor on read; retain the original audit snapshots.
  for(const turn of history)turn.asked=(turn.asked??[]).flatMap((question:string)=>visibleCoachQuestions(question))
  const ids=[...new Set([row.title_source.messageId,...rows.flatMap(node=>node.source?[node.source.messageId]:[]),...actionRows.flatMap(action=>action.source_message_ids),...history.map(turn=>turn.source_message_id)])]
  const available=(await c.query(`SELECT m.id,m.content,m.conversation_id,m.created_at FROM messages m
    WHERE m.user_id=$1 AND m.id=ANY($2::uuid[]) AND m.role='user'
    AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE s.user_id=m.user_id AND s.source_message_id=m.id)
    AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id)
    AND NOT EXISTS(SELECT 1 FROM experiences e WHERE e.user_id=m.user_id AND e.source_message_id=m.id AND e.status='deleted') ORDER BY m.created_at,m.id`,[user,ids])).rows
  const sources=new Map(available.map(message=>[message.id,message]))
  const valid=(source:CoachSource)=>{const message=sources.get(source.messageId);return Boolean(message&&message.conversation_id===source.conversationId&&source.quote.trim()&&message.content.includes(source.quote))}
  if(!valid(row.title_source))throw new HttpError(409,'COACH_SOURCE_REVOKED')
  const nodes:CoachNode[]=rows.filter(node=>!node.source||valid(node.source)).map(node=>({id:node.id,revision:node.revision,kind:node.kind,status:node.status,content:node.content,source:node.source,...(node.kind==='unknown'?{inquiryContext:{affects:String(node.inquiry_context?.affects??'当前事项的理解或下一步'),reason:String(node.inquiry_context?.reason??'这个答案会改变当前判断或行动'),dependsOn:Array.isArray(node.inquiry_context?.dependsOn)?node.inquiry_context.dependsOn.map(String):[]}}:{})}))
  const nodeQuotes=new Map<string,string[]>()
  for(const node of [...nodes,...history.flatMap(turn=>Array.isArray(turn.nodes)?turn.nodes:[])]){
    if(node.source)nodeQuotes.set(node.source.messageId,[...nodeQuotes.get(node.source.messageId)??[],node.source.quote])
  }
  const actions:CoachAction[]=actionRows.map(action=>{
    const unavailableReasons:NonNullable<CoachAction['unavailableReasons']>=[]
    if(!action.knowledge_valid)unavailableReasons.push('knowledge_sources_changed_or_unavailable')
    if(action.source_message_ids.some((sourceId:string)=>!sources.has(sourceId)))unavailableReasons.push('user_sources_unavailable')
    if(action.status==='stale'&&!unavailableReasons.length)unavailableReasons.push('material_withdrawn')
    const stale=unavailableReasons.length>0
    const requestIds=new Set(history.filter(turn=>['create','modify'].includes(turn.action_change)&&turn.action_ids.includes(action.id)).map(turn=>turn.source_message_id))
    const requests=stale?[]:available.filter(message=>action.source_message_ids.includes(message.id)&&requestIds.has(message.id)).map(message=>unquotedRequestParts(message.content,nodeQuotes.get(message.id)??[]).map(quote=>({messageId:message.id,conversationId:message.conversation_id,quote}))).filter(parts=>parts.length)
    // Keep the original request plus recent changes, without interpreting them
    // as facts, accepted commitments or stable personal background.
    const requestSources=(requests.length>8?[requests[0],...requests.slice(-7)]:requests).flat()
    return {id:action.id,revision:action.revision,status:stale?'stale':action.status,draft:stale?null:action.draft,closedReason:stale?null:action.closed_reason,...(requestSources.length?{requestSources}:{}),...(stale?{unavailableReasons}:action.knowledge_refs.length?{knowledgeRefs:action.knowledge_refs}:{})}
  })
  // Reusing whole historical inputs could resurrect a corrected statement.
  // Keep valid node references and exact non-node input fragments. Historical
  // node-backed text stays excluded so corrections cannot resurrect old facts;
  // no fragment is classified as answered/refused or promoted to a profile.
  const unknownIntroductions=new Map<string,number>()
  for(const turn of history)for(const node of Array.isArray(turn.nodes)?turn.nodes:[]){
    if(node.kind==='unknown'&&!unknownIntroductions.has(node.id))unknownIntroductions.set(node.id,turn.revision)
  }
  const processTurns:CoachProcessTurn[]=recent.flatMap(turn=>{
    const nodeIds=nodes.filter(node=>node.source?.messageId===turn.source_message_id).map(node=>node.id)
    const introducedUnknownNodeIds=nodes.filter(node=>node.kind==='unknown'&&unknownIntroductions.get(node.id)===turn.revision).map(node=>node.id)
    const message=sources.get(turn.source_message_id)
    const inputSources=message?unquotedRequestParts(message.content,nodeQuotes.get(message.id)??[]).map(quote=>({messageId:message.id,conversationId:message.conversation_id,quote})):[]
    return (nodeIds.length||inputSources.length)&&Array.isArray(turn.asked)?[{revision:turn.revision,sourceMessageId:turn.source_message_id,nodeIds,questionsAskedAfterInput:turn.asked,...(inputSources.length?{inputSources}:{}),...(introducedUnknownNodeIds.length?{introducedUnknownNodeIds}:{})}]:[]
  })
  // Project only authorized committed source fragments, in native event revision
  // order. No second fact database: GET, refresh and another session read the
  // same event commits. Explicit negative/unknown reports replace stale stages.
  let actionStages:ActionCase['known']={sent:null,read:null,replied:null,used:null,effect:null}
  let actionStageEvidence:NonNullable<CoachEvent['actionStageEvidence']>={}
  let actionStageScope:CoachEvent['actionStageScope']
  const actionProgressReports:CoachActionReport[]=[]
  for(const turn of history){
    const source=sources.get(turn.source_message_id)
    if(!source)continue
    const fragments=[...nodes.filter(n=>n.kind==='fact'&&n.source?.messageId===source.id).map(n=>n.source!.quote),...unquotedRequestParts(source.content,nodeQuotes.get(source.id)??[])]
    const allowed:string[]=[]
    for(const quote of [...new Set(fragments)].sort((a,b)=>source.content.indexOf(a)-source.content.indexOf(b)))if(!await growthQuoteSuppressed(c,user,source.id,quote))allowed.push(quote)
    const previousStages=actionStages,previousEvidence=actionStageEvidence
    // A continuation is not proof that two deliveries are the same artifact.
    // Keep each report independent; never carry a PDF's read flag into a link.
    actionStages={sent:null,read:null,replied:null,used:null,effect:null}
    actionStageEvidence={}
    actionStages=reconcileActionStages(actionStages,allowed.join('；'),(field,quotes)=>{actionStageEvidence[field]={sourceMessageId:source.id,eventRevision:turn.revision,evidenceQuotes:quotes.filter(quote=>source.content.includes(quote))}})
    // Use the same guarded participant reports as the dialogue contract. A
    // direct reply need not contain “我”; it never establishes reading/use.
    // A flat event-stage vector cannot merge reports about different actors.
    const reports=allowed.flatMap(quote=>reportedEvidenceFromText(quote).participants)
    const reportActors=new Set(reports.map(report=>report.actor))
    const materialAmbiguous=explicitMaterialForms(reportedOutcomeSourceClauses(allowed.join('；')).map(clause=>clause.text).join('；')).length>1
    if(reportActors.size>1||materialAmbiguous){
      actionStages={sent:null,read:null,replied:null,used:null,effect:null}
      for(const field of Object.keys(actionStageEvidence))delete actionStageEvidence[field as keyof typeof actionStageEvidence]
      actionStageScope={basis:'latest_source_report_only',sourceMessageId:source.id,eventRevision:turn.revision}
      actionProgressReports.push({sourceMessageId:source.id,eventRevision:turn.revision,reportedAt:new Date(source.created_at).toISOString(),sourceQuotes:allowed,stages:actionStages,evidence:actionStageEvidence,scopeAmbiguities:[...(reportActors.size>1?['multiple_actors' as const]:[]),...(materialAmbiguous?['multiple_material_forms' as const]:[])]})
      continue
    }
    if(reportActors.size===1){
      for(const report of reports)for(const [dimension,field,yes,no] of [['read','read','reported_read','reported_not_read'],['response','replied','reported_response','reported_no_response'],['adoption','used','reported_used','reported_not_used']] as const){
        const state=report.states[dimension]
        if(!state.quote||!source.content.includes(state.quote)||![yes,no,'unknown'].includes(state.status))continue
        actionStages[field]=state.status===yes?true:state.status===no?false:null
        actionStageEvidence[field]={sourceMessageId:source.id,eventRevision:turn.revision,evidenceQuotes:[state.quote].filter(quote=>source.content.includes(quote))}
      }
      if(actionStages.used!==true||actionStages.sent===false)actionStages.effect=null
    }
    if(actionStages.effect===null)delete actionStageEvidence.effect
    if(Object.keys(actionStageEvidence).length){
      actionStageScope={basis:'latest_source_report_only',sourceMessageId:source.id,eventRevision:turn.revision}
      actionProgressReports.push({sourceMessageId:source.id,eventRevision:turn.revision,reportedAt:new Date(source.created_at).toISOString(),sourceQuotes:allowed,stages:actionStages,evidence:actionStageEvidence})
    }else{actionStages=previousStages;actionStageEvidence=previousEvidence}
  }
  const latestReport=actionProgressReports.at(-1)?.sourceQuotes.join('；')??''
  const projectedNodes=nodes.map(node=>{if(node.kind!=='fact'||!node.source||node.source.messageId!==actionStageScope?.sourceMessageId)return node;const stated=reconcileActionStages({sent:null,read:null,replied:null,used:null,effect:null},node.source.quote);return (['sent','read','replied','used'] as const).some(key=>stated[key]!==null&&actionStageEvidence[key]&&stated[key]!==actionStages[key])?{...node,supersededByActionCorrection:true}:node}).map(node=>actionStages.replied===true&&node.kind==='fact'&&/(?:对方|导师|老师).{0,8}(?:还没|还没有|未|没有).{0,3}(?:回复|回)/.test(node.content)&&sameReportedResponseSubject(node.content,latestReport)?{...node,supersededByActionCorrection:true}:node)
  return {id:row.id,conversationId:row.conversation_id,title:row.title,revision:row.revision,generation:row.generation,nodes:projectedNodes,actions,asked:[...new Set(history.flatMap(entry=>entry.asked??[]))],processTurns,actionStages,actionStageEvidence,actionStageScope,actionProgressReports,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()}
}

export async function coachEventView(user:string,conversation:string,id?:string){
  return transaction(async c=>{
    requireRow((await c.query('SELECT id FROM conversations WHERE user_id=$1 AND id=$2',[user,conversation])).rows[0])
    const selected=id??(await c.query('SELECT event_id FROM coach_current WHERE user_id=$1 AND conversation_id=$2',[user,conversation])).rows[0]?.event_id
    return selected?await readCoachEvent(c,user,conversation,selected):null
  })
}

export async function assertCoachEvidence(c:PoolClient,user:string,conversation:string,refs:{eventId:string;revision:number;generation:number}[]){
  for(const ref of refs){
    let event
    try{event=await eventFor(c,user,conversation,ref.eventId,true)}catch(error){
      if(error instanceof HttpError&&error.code==='NOT_FOUND')throw new HttpError(409,'COACH_SNAPSHOT_INVALIDATED')
      throw error
    }
    if(event.revision!==ref.revision||event.generation!==ref.generation||!await sourceAvailable(c,user,event.title_source))throw new HttpError(409,'COACH_SNAPSHOT_INVALIDATED')
  }
}

// Existing memory/experience corrections invoke this inside their transaction.
// Tombstones and source withdrawal survive subsequent retrieval and rebuilds.
export async function invalidateCoachSources(c:PoolClient,user:string,messageIds:string[],forget:boolean){
  if(!messageIds.length)return
  const changed=(await c.query(`INSERT INTO coach_source_withdrawals(user_id,message_id,conversation_id,reason)
    SELECT user_id,id,conversation_id,$3 FROM messages WHERE user_id=$1 AND id=ANY($2::uuid[])
    ON CONFLICT(user_id,message_id) DO UPDATE SET reason=EXCLUDED.reason
      WHERE coach_source_withdrawals.reason='corrected' AND EXCLUDED.reason='forgotten'
    RETURNING message_id`,[user,messageIds,forget?'forgotten':'corrected'])).rows
  messageIds=changed.map(row=>row.message_id as string)
  if(!messageIds.length)return
  const affected=(await c.query(`SELECT DISTINCT event_id FROM coach_nodes WHERE user_id=$1 AND source->>'messageId'=ANY($2::text[]) AND status<>'withdrawn'
    UNION SELECT id FROM coach_events WHERE user_id=$1 AND title_source->>'messageId'=ANY($2::text[]) AND status='active'
    UNION SELECT event_id FROM coach_actions WHERE user_id=$1 AND source_message_ids && $2::uuid[]
    UNION SELECT r.event_id FROM coach_event_revisions r JOIN runs t ON t.user_id=r.user_id AND t.request_id=r.request_id
      WHERE r.user_id=$1 AND t.source_message_id=ANY($2::uuid[]) AND r.snapshot ? 'event'`,[user,messageIds])).rows.map(row=>row.event_id as string)
  for(const id of affected){
    await c.query('SELECT id FROM coach_events WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,id])
    await c.query("UPDATE coach_nodes SET status='withdrawn',content=NULL,source=NULL,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND source->>'messageId'=ANY($3::text[])",[user,id,messageIds])
    await c.query("UPDATE coach_nodes SET status='withdrawn',content=NULL,source=NULL,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND kind='unknown' AND status<>'withdrawn'",[user,id])
    await c.query("UPDATE coach_actions SET status='stale',draft=NULL,closed_reason=NULL,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND source_message_ids && $3::uuid[]",[user,id,messageIds])
    await c.query("UPDATE coach_events SET revision=revision+1,generation=generation+1,status=CASE WHEN title_source->>'messageId'=ANY($3::text[]) THEN 'forgotten' ELSE status END,title=CASE WHEN title_source->>'messageId'=ANY($3::text[]) THEN '' ELSE title END,title_source=CASE WHEN title_source->>'messageId'=ANY($3::text[]) THEN '{}'::jsonb ELSE title_source END,updated_at=now() WHERE user_id=$1 AND id=$2",[user,id,messageIds])
    const withdrawn=(await c.query("SELECT 1 FROM coach_events WHERE user_id=$1 AND id=$2 AND status='forgotten'",[user,id])).rowCount
    if(withdrawn){
      await c.query("UPDATE coach_nodes SET status='withdrawn',content=NULL,source=NULL,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND status<>'withdrawn'",[user,id])
      await c.query("UPDATE coach_actions SET status='stale',draft=NULL,closed_reason=NULL,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2",[user,id])
    }
    // Erase derived prose and materials, but retain independently authorized
    // citation/action lineage. Dropping all node ranges would turn corrected
    // facts back into unquoted requests on the next read or modification.
    if(withdrawn)await c.query("UPDATE coach_event_revisions SET snapshot=jsonb_build_object('withdrawn',true) WHERE user_id=$1 AND event_id=$2",[user,id])
    else await c.query(`UPDATE coach_event_revisions r SET snapshot=
      jsonb_build_object('event',jsonb_build_object(
        'nodes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',n->'id','kind',n->'kind','source',n->'source'))
          FROM jsonb_array_elements(COALESCE(r.snapshot#>'{event,nodes}','[]'::jsonb)) n
          WHERE n->>'source' IS NULL OR NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w
            WHERE w.user_id=r.user_id AND w.message_id::text=n#>>'{source,messageId}')),'[]'::jsonb),
        'actions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a->'id','status',a->'status'))
          FROM jsonb_array_elements(COALESCE(r.snapshot#>'{event,actions}','[]'::jsonb)) a),'[]'::jsonb)),
        'askedThisTurn','[]'::jsonb,'actionChange',r.snapshot->'actionChange')
      || CASE WHEN r.snapshot ? 'actionId' THEN jsonb_build_object('actionId',r.snapshot->'actionId') ELSE '{}'::jsonb END
      WHERE r.user_id=$1 AND r.event_id=$2 AND r.snapshot ? 'event'`,[user,id])
    await c.query("DELETE FROM coach_current p USING coach_events e WHERE p.user_id=$1 AND p.event_id=e.id AND e.user_id=p.user_id AND e.status='forgotten'",[user])
  }
}
