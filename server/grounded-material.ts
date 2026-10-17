import {createHash} from 'node:crypto'
import type { GrowthItem } from '../src/features/growth/types.ts'
import {scanUserClauses} from './user-command-spans.ts'

// Match explicit personal contribution reports in either common word order.
// Preserve the original wording; this is not a claim of skill or adoption.
export function reportsOwnContribution(text:string):boolean{
 return /^我(?:在[^，。！？\n]{1,24})?(?:只)?负责.{1,80}$/.test(text)&&!/(?:如果|假如|并非|不是|没有负责)/.test(text)
  ||/^[^，。！？\n]{1,40}(?:由我负责|是我(?:做|完成|负责)的)$/.test(text)&&!/(?:不|并非|不是|如果|假如)/.test(text)
}

/** Renderer accepts server-verified catalogue entries, never free model factual prose. */
export type MaterialField = 'identity' | 'target' | 'project' | 'skill' | 'contact'
export type MaterialSourceRef =
  | {type:'growth'; id:string; revision:number}
  | {type:'experience'; id:string; revision:number}
  | {type:'message'; id:string; conversationId:string; quote:string}
export type VerifiedMaterialFact = {
  catalogueId: string; field: MaterialField; text: string;
  // Created by server catalogue validation; do not deserialize this type from an LLM.
  sourceKind: 'user_reported' | 'user_edit';
  completeForField: boolean; // True only for explicitly provided complete field data.
  sourceRef: MaterialSourceRef; // N2.5: every fact carries a real, checkable origin.
  label?: string
  contextKey?: string
}

// A generic contribution request first belongs to the current conversation's
// project. Unrelated projects stay out of that deterministic lane. Repeated
// sources are one content decision only when the relevant wording is exact.
export function singleUniqueContributionFact(catalogue:readonly VerifiedMaterialFact[],conversationId?:string):VerifiedMaterialFact|null{
  const contributions=catalogue.filter(fact=>fact.field==='project'&&reportsOwnContribution(fact.text))
  const contextual=conversationId?contributions.filter(fact=>fact.contextKey===conversationId||(fact.sourceRef.type==='message'&&fact.sourceRef.conversationId===conversationId)):[]
  // A durable, still-authorized record for this matter outranks raw dialogue
  // history. History is the fallback when promotion was missed; it must not
  // make an already resolved project ambiguous again.
  const durableContextual=contextual.filter(fact=>fact.sourceRef.type!=='message')
  const eligible=durableContextual.length?durableContextual:contextual.length?contextual:contributions
  if(!eligible.length||new Set(eligible.map(fact=>fact.text)).size!==1)return null
  return eligible[0]!
}
export type MaterialResult = {
  content: string; readiness: 'template' | 'draft_for_user_review';
  missingRequired: MaterialField[]; usedCatalogueIds: string[];
}
const labels: Record<MaterialField, string> = {
  identity: '个人基本信息', target: '求职意向', project: '作品与本人贡献',
  skill: '本人明确提供的技能', contact: '联系方式',
}
const required: MaterialField[] = ['identity', 'target', 'project', 'contact']
export function renderGroundedResume(
  selectedIds: readonly string[], catalogue: readonly VerifiedMaterialFact[],
): MaterialResult {
  if (selectedIds.length > 32 || new Set(selectedIds).size !== selectedIds.length) throw new Error('MATERIAL_REFERENCE_INVALID')
  const byId = new Map(catalogue.map(fact => [fact.catalogueId, fact]))
  if (byId.size !== catalogue.length) throw new Error('MATERIAL_CATALOGUE_INVALID')
  const selected = selectedIds.map(id => {
    const fact = byId.get(id)
    if (!fact || !['user_reported', 'user_edit'].includes(fact.sourceKind) || !fact.text.trim() ||
        !Object.hasOwn(labels, fact.field) || fact.text.length > 4000) throw new Error('MATERIAL_REFERENCE_INVALID')
    return fact
  })
  const present = new Set(selected.filter(fact => fact.completeForField === true).map(fact => fact.field))
  const missingRequired = required.filter(field => !present.has(field))
  const readiness = missingRequired.length ? 'template' : 'draft_for_user_review'
  const lines = [readiness === 'template' ? '简历与作品清单（待补信息模板）' : '简历与作品清单（发送前请核对）']
  for (const field of Object.keys(labels) as MaterialField[]) {
    lines.push('', labels[field])
    const facts = selected.filter(fact => fact.field === field)
    if (facts.length) for (const fact of facts) lines.push(fact.text)
    else lines.push(field === 'skill' ? '【尚未提供工具和熟练程度，可先删除本栏】' : `【待补：${labels[field]}】`)
  }
  lines.push('', '请核对个人信息、项目贡献和联系方式；不要将待补字段当作已确认事实。')
  const content = lines.join('\n')
  if (content.length > 12000) throw new Error('MATERIAL_OUTPUT_LIMIT')
  return { content, readiness, missingRequired, usedCatalogueIds: [...selectedIds] }
}

// ---- N2.5 server catalogue -------------------------------------------------
// Candidates come only from the user's own verified words, real user edits,
// confirmed experiences and EXPLICIT labeled fields of the current message —
// never AI observations, unknowns, assistant replies or plan inferences.

const fieldLabels:readonly {label:string;field:MaterialField}[]=[
  {label:'姓名',field:'identity'},
  {label:'求职意向',field:'target'},
  {label:'岗位意向',field:'target'},
  {label:'意向岗位',field:'target'},
  {label:'作品名称',field:'project'},
  {label:'项目名称',field:'project'},
  {label:'本人贡献',field:'project'},
  {label:'我的贡献',field:'project'},
  {label:'负责部分',field:'project'},
  {label:'作品链接',field:'project'},
  {label:'项目链接',field:'project'},
  {label:'结果',field:'project'},
  {label:'技能',field:'skill'},
  {label:'工具',field:'skill'},
  {label:'熟练程度',field:'skill'},
  {label:'邮箱',field:'contact'},
  {label:'邮件',field:'contact'},
  {label:'电话',field:'contact'},
  {label:'手机',field:'contact'},
  {label:'联系方式',field:'contact'},
]

export type ExplicitMaterialField={field:MaterialField;label:string;text:string;quote:string}

// Reads only PAIRED explicit labels (标签：值) and keeps each value's
// contiguous original span verbatim. No free rewriting, no noun-hit promotion.
export function extractExplicitMaterialFields(text:string):ExplicitMaterialField[]{
  const found:ExplicitMaterialField[]=[]
  for(const {label,field} of fieldLabels){
    const pattern=new RegExp(label+'[：:]([^；;。\\n，,]{1,200})','g')
    for(const match of text.matchAll(pattern)){
      const value=(match[1]??'').trim()
      if(!value)continue
      found.push({field,label,text:value,quote:value})
    }
  }
  return found
}

// A project group is complete when ONE source carries BOTH a 作品名称 label and
// a 本人贡献 label; links/results stay honestly unknown when absent.
const projectGroupComplete=(fields:readonly ExplicitMaterialField[]):boolean=>{
  const names=fields.map(field=>field.label)
  return names.some(name=>name==='作品名称'||name==='项目名称')&&names.some(name=>name==='本人贡献'||name==='我的贡献'||name==='负责部分')
}

export type ConfirmedExperienceLike={id:string;revision:number;content:{summary?:string}|null;source_quote?:string}
const catalogueId=(value:string)=>`mf-${createHash('sha256').update(value).digest('hex').slice(0,24)}`
const kindField:Partial<Record<GrowthItem['kind'],MaterialField>>={
  goal:'target',direction:'target',ability:'project',
}

type VerifiedConversationMessage={id:string;conversationId:string;text:string}

export function buildMaterialFactCatalogue(
  growth:readonly GrowthItem[],
  confirmedExperiences:readonly ConfirmedExperienceLike[]=[],
  currentMessage?:VerifiedConversationMessage,
  priorUserMessages:readonly VerifiedConversationMessage[]=[],
):VerifiedMaterialFact[]{
  const catalogue:VerifiedMaterialFact[]=[]
  const push=(field:MaterialField,text:string,sourceKind:'user_reported'|'user_edit',completeForField:boolean,sourceRef:MaterialSourceRef)=>{
    if(!text.trim()||text.length>4000)return
    const id=catalogueId(JSON.stringify([sourceRef,field,text]))
    if(catalogue.some(fact=>fact.catalogueId===id))return
    catalogue.push({catalogueId:id,field,text,sourceKind,completeForField,sourceRef})
  }
  const labeledBySource:ExplicitMaterialField[][]=[]
  for(const item of growth){
    if(item.unavailableReason||!['active','proposed'].includes(item.status))continue
    if(item.assertion!=='user_reported'&&item.assertion!=='user_edit')continue
    const sourceRef:MaterialSourceRef={type:'growth',id:item.id,revision:item.revision}
    const sourceKind=item.assertion==='user_edit'?'user_edit':'user_reported'
    const labeled=extractExplicitMaterialFields(item.text)
    if(labeled.length)labeledBySource.push(labeled)
    for(const field of labeled)push(field.field,field.text,sourceKind,true,sourceRef)
    const bucket=kindField[item.kind]
    if(item.kind==='feedback'&&/^(?:后来)?我把海报.{0,30}交给.{0,20}了$/.test(item.text)){
      push('project',item.text,sourceKind,false,sourceRef)
      const fact=catalogue.find(entry=>entry.text===item.text&&entry.sourceRef.type==='growth'&&entry.sourceRef.id===item.id)
      if(fact){fact.label='work_context';fact.contextKey=item.conversationId}
    }
    if(reportsOwnContribution(item.text)&&!labeled.length)push('project',item.text,sourceKind,false,sourceRef)
    else if(bucket&&!labeled.length)push(bucket,item.text,sourceKind,false,sourceRef)
    for(const fact of catalogue.filter(entry=>entry.sourceRef.type==='growth'&&entry.sourceRef.id===item.id))fact.contextKey=item.conversationId
  }
  for(const experience of confirmedExperiences){
    const text=(experience.content?.summary??experience.source_quote??'').trim()
    push('project',text,'user_reported',false,{type:'experience',id:experience.id,revision:experience.revision})
  }
  // The normal chat can refer back to an exact contribution reported earlier
  // in the same conversation even when the model did not promote that sentence
  // to long-term growth. Callers supply only server-read user messages after
  // suppression/redaction; assistant prose never enters this catalogue.
  for(const message of [...priorUserMessages,currentMessage].filter((entry):entry is VerifiedConversationMessage=>Boolean(entry))){
    const labeled=extractExplicitMaterialFields(message.text)
    if(labeled.length)labeledBySource.push(labeled)
    for(const field of labeled)push(field.field,field.text,'user_reported',true,{type:'message',id:message.id,conversationId:message.conversationId,quote:field.quote})
    for(const clause of scanUserClauses(message.text)){
      if(clause.interrogative||clause.conditional||clause.quoted||clause.code||clause.attributedToOther||clause.quoteSpans.length||!reportsOwnContribution(clause.text))continue
      push('project',clause.text,'user_reported',false,{type:'message',id:message.id,conversationId:message.conversationId,quote:clause.text})
    }
  }
  // Project completeness is a GROUP property: a source whose labeled fields
  // carry name+contribution completes its project entries.
  if(labeledBySource.some(projectGroupComplete)){
    const completed=new Set<string>()
    for(const group of labeledBySource)if(projectGroupComplete(group))for(const field of group)completed.add(field.text)
    for(const fact of catalogue)if(fact.field==='project'&&completed.has(fact.text))fact.completeForField=true
  }
  return catalogue
}

// Current-message catalogue: complete labeled fields enter the SAME turn
// without pre-committing growth (staged facts stay the durable record).
export function buildMaterialFactCatalogueForMessage(message:{id:string;conversationId:string;text:string}):VerifiedMaterialFact[]{
  return buildMaterialFactCatalogue([],[],message)
}

// Resolve a model's selection against THIS turn's server catalogue; any
// invented, stale or cross-account id is MATERIAL_REFERENCE_INVALID.
export type SelectedMaterialResult=MaterialResult&{facts:VerifiedMaterialFact[]}
export function resolveSelectedMaterialFacts(suppliedIds:readonly string[],catalogue:readonly VerifiedMaterialFact[],ownerId:string,expectedOwnerId:string,format:'resume'|'contribution_sentence'|'contribution_paragraph'='resume'):SelectedMaterialResult{
  if(ownerId!==expectedOwnerId)throw new Error('MATERIAL_REFERENCE_INVALID')
  // Repeated references to the same authorized fact add no information. The
  // renderer still rejects every unknown identity and checks every source.
  const selectedIds=[...new Set(suppliedIds)]
  const selected=selectedIds.map(id=>catalogue.find(fact=>fact.catalogueId===id)).filter((fact):fact is VerifiedMaterialFact=>Boolean(fact))
  const rendered=renderGroundedResume(selectedIds,catalogue)
  if(format==='contribution_paragraph'){
    const facts=selected.filter(fact=>fact.field==='project'&&reportsOwnContribution(fact.text))
    if(!facts.length)throw new Error('MATERIAL_REFERENCE_INVALID')
    const quotes=[...new Set(facts.map(fact=>fact.text.replace(/[。！!]+$/,'')))]
    return {content:quotes.join('；')+'。',readiness:'draft_for_user_review',missingRequired:[],usedCatalogueIds:facts.map(fact=>fact.catalogueId),facts}
  }
  if(format==='contribution_sentence'){
    const contributions=selected.filter(fact=>fact.field==='project'&&reportsOwnContribution(fact.text))
    if(contributions.length!==1)throw new Error('MATERIAL_REFERENCE_INVALID')
    const fact=contributions[0]!
    const work=selected.filter(entry=>entry.label==='work_context'&&entry.contextKey&&entry.contextKey===fact.contextKey)
    const contextual=work.length===1&&/^(?:后来)?我把海报/.test(work[0]!.text)
    const used=contextual?[work[0]!,fact]:[fact]
    return {content:(contextual?'在这份海报作品中，':'')+fact.text.replace(/[。！!]+$/,'')+'。',readiness:'draft_for_user_review',missingRequired:[],usedCatalogueIds:used.map(entry=>entry.catalogueId),facts:used}
  }
  return {...rendered,facts:selected}
}
