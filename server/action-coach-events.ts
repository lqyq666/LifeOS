import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { Value } from 'typebox/value'
import { Type } from 'typebox'
import { pool, transaction, HttpError, requireRow } from './db.ts'
import { eventDeltaSchema, type EventDelta } from './action-coach-contracts.ts'
import type { Run } from './store.ts'
import type { CoachKnowledgeRef } from './coach-knowledge.ts'
import { growthQuoteSuppressed,messageQuoteCorrected,scopedMessageCorrections,coachSourceBoundaryRefs,sourceBoundaryKey } from './growth-privacy.ts'
import {reconcileActionStages,reportedActionProgress,projectMatterReport,reportedPriorMatterTransition,reportedSwitchedMatterChoice,type ActionCase,type MatterState,type MatterChoice} from './workflows/action-review.ts'
import {scanUserClauses,assistantInstructionClause,assistantRequestClause,profileWritesDisallowed,openHumanOtherActor,jointPersonalActorClause} from './user-command-spans.ts'
import {reportedEvidenceFromText,reportedOutcomeSourceClauses,sameReportedResponseSubject,unrelatedExternalCorrection} from './turn-contract.ts'
import {explicitMaterialForms} from './experience-episodes.ts'
import {sourceControlRanges,sourceQuotesOverlap,selectedSourceRange,inheritSourceRange,uniqueSourceControlRange,buildClauseCatalogue,unprotectedClauseText} from './clause-catalogue.ts'
import {fullMemorySuppressionSql} from './memory-suppression.ts'
import type {SourceControlRef} from './clause-catalogue.ts'

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
export type BoundCoachSource=CoachSource&{range?:{start:number;end:number};redacted?:boolean}
type ActionFieldSourceBinding={field:string;value:string;sources:BoundCoachSource[]}
const readableSource=(source:BoundCoachSource|null):CoachSource|null=>{
 if(!source)return null
 const {range,...visible}=source
 return visible
}
export type CoachNode={id:string;revision:number;kind:'fact'|'feeling'|'user_interpretation'|'unknown';status:'active'|'resolved'|'declined';content:string;source:CoachSource|null;inquiryContext?:{affects:string;reason:string;dependsOn:string[]};supersededByActionCorrection?:boolean}
export type CoachAction={id:string;revision:number;status:'proposed'|'closed'|'stale';draft:Record<string,unknown>|null;closedReason:string|null;knowledgeRefs?:CoachKnowledgeRef[];requestSources?:CoachSource[];unavailableReasons?:('knowledge_sources_changed_or_unavailable'|'user_sources_unavailable'|'material_withdrawn')[]}
export type CoachProcessTurn={revision:number;sourceMessageId:string;nodeIds:string[];questionsAskedAfterInput:string[];inputSources?:CoachSource[];introducedUnknownNodeIds?:string[]}
export type CoachActionReport={sourceMessageId:string;eventRevision:number;reportedAt:string;sourceQuotes:string[];stages:ActionCase['known'];evidence:Partial<Record<keyof ActionCase['known'],{sourceMessageId:string;eventRevision:number;evidenceQuotes:string[]}>>;scopeAmbiguities?:('multiple_actors'|'multiple_material_forms')[]}
export type MatterProgress={state:MatterState;choice:MatterChoice;recommendationStopped:boolean;reports:{sourceMessageId:string;eventRevision:number;reportedAt:string;state:MatterState|null;choice:MatterChoice|null;quotes:string[];resumed:boolean;scopeEvidence?:{basis:'explicit_deictic_stop_with_unambiguous_prior_event';ownerRole:'current_context'|'sole_supplied_event';transitionEventId:string;requestId:string;boundRevision:number;newPursuitDeclared:boolean}}[]}
export type CoachEvent={id:string;conversationId:string;title:string;revision:number;generation:number;nodes:CoachNode[];actions:CoachAction[];asked:string[];processTurns?:CoachProcessTurn[];actionStages?:ActionCase['known'];actionStageEvidence?:CoachActionReport['evidence'];actionStageScope?:{basis:'latest_source_report_only';sourceMessageId:string;eventRevision:number};actionProgressReports?:CoachActionReport[];matterProgress?:MatterProgress;createdAt:string;updatedAt:string}
export type CoachEventSourceBindings={titleSource:BoundCoachSource;nodeSources:{nodeId:string;source:BoundCoachSource}[];processTurns:CoachProcessTurn[];processSources:BoundCoachSource[];pendingActionRequestSources:BoundCoachSource[];consumedActionRequestSources:BoundCoachSource[];actionRequestSources:{actionId:string;source:BoundCoachSource}[]}
type MutableCoachEventSourceBindings=Partial<Pick<CoachEventSourceBindings,'titleSource'>>&Pick<CoachEventSourceBindings,'nodeSources'|'processTurns'|'processSources'|'pendingActionRequestSources'|'consumedActionRequestSources'|'actionRequestSources'>
type StagedActionValidation={binding?:ActionRequestBinding;inheritedActionRequest:boolean}
export type CoachFactProjectionInput={content:string;source:{messageId:string;quote:string}}
type CoachFactProjection={content:string;source:BoundCoachSource}
export type CoachStaged={delta:EventDelta;reply:string;eventId:string;actionId?:string;knowledgeRefs?:CoachKnowledgeRef[];actionValidation?:StagedActionValidation;factProjections?:CoachFactProjection[];keepCurrentEventId?:string}

const revisionProposedActionCountSql=`(SELECT count(*) FROM jsonb_array_elements(COALESCE(h.snapshot#>'{event,actions}','[]'::jsonb)) item WHERE item->>'status'='proposed')`
const revisionContainsActionSql=`EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(h.snapshot#>'{event,actions}','[]'::jsonb)) item WHERE item->>'id'=a.id::text AND item->>'status'='proposed')`
const revisionHasActionIdSql=`(NULLIF(h.snapshot->>'actionId','') IS NOT NULL)`
const revisionPreviousActionsSql=`COALESCE(h.previous_snapshot#>'{event,actions}','[]'::jsonb)`
const revisionActionItemChangedSql=`COALESCE(item->>'revision','') IS DISTINCT FROM COALESCE((SELECT prior_item->>'revision' FROM jsonb_array_elements(${revisionPreviousActionsSql}) prior_item WHERE prior_item->>'id'=item->>'id' LIMIT 1),'')`
const revisionChangedActionCountSql=`(SELECT count(*) FROM jsonb_array_elements(COALESCE(h.snapshot#>'{event,actions}','[]'::jsonb)) item WHERE item->>'status'='proposed' AND ${revisionActionItemChangedSql})`
const revisionContainsChangedActionSql=`EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(h.snapshot#>'{event,actions}','[]'::jsonb)) item WHERE item->>'id'=a.id::text AND item->>'status'='proposed' AND ${revisionActionItemChangedSql})`
const revisionSuppliedActionChangedSql=`EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(h.snapshot#>'{event,actions}','[]'::jsonb)) item WHERE item->>'id'=h.snapshot->>'actionId' AND item->>'status'='proposed' AND ${revisionActionItemChangedSql})`
const invalidModernActionIdSql=`(${revisionHasActionIdSql} AND h.snapshot->>'actionChange' IN ('create','modify') AND (${revisionChangedActionCountSql}<>1 OR NOT ${revisionSuppliedActionChangedSql}))`
const ambiguousModernActionRevisionSql=`(NOT ${revisionHasActionIdSql} AND h.snapshot->>'actionChange' IN ('create','modify') AND ${revisionProposedActionCountSql}>1)`
const malformedModernActionRevisionSql=`(${ambiguousModernActionRevisionSql} OR ${invalidModernActionIdSql})`
// Select every provenance shape from one revision. Older snapshots sometimes
// stored only actionSource; newer snapshots additionally store actionSources
// and field-level ownership for material that survives later edits.
// Independent latest-value subqueries can combine two different revisions.
const latestActionProvenanceJoin=`LEFT JOIN LATERAL (
  SELECT CASE
      WHEN ${malformedModernActionRevisionSql} THEN NULL
      WHEN jsonb_typeof(h.snapshot->'actionSource')='object' THEN h.snapshot->'actionSource'
      WHEN jsonb_typeof(h.snapshot->'actionSources')='array' AND jsonb_array_length(h.snapshot->'actionSources')>0 THEN (h.snapshot->'actionSources')->-1
    END AS exact_source,
    CASE
      WHEN ${malformedModernActionRevisionSql} THEN NULL
      WHEN jsonb_typeof(h.snapshot->'actionSources')='array' AND jsonb_array_length(h.snapshot->'actionSources')>0 THEN h.snapshot->'actionSources'
      WHEN jsonb_typeof(h.snapshot->'actionSource')='object' THEN jsonb_build_array(h.snapshot->'actionSource')
    END AS exact_sources,
    CASE WHEN NOT ${malformedModernActionRevisionSql} AND jsonb_typeof(h.snapshot->'actionFieldSources')='array' THEN h.snapshot->'actionFieldSources' END AS exact_field_sources,
    h.snapshot ? 'actionFieldSources' AS field_sources_present,
    h.snapshot ? 'actionChange' AS material_revision_modern,
    ${malformedModernActionRevisionSql} AS material_identity_ambiguous
  FROM (SELECT r.*,lag(r.snapshot) OVER (ORDER BY r.revision) AS previous_snapshot
    FROM coach_event_revisions r WHERE r.user_id=a.user_id AND r.event_id=a.event_id) h
  WHERE ((h.snapshot->>'actionId'=a.id::text AND NOT ${invalidModernActionIdSql}) OR (NOT ${revisionHasActionIdSql}
      AND ${revisionContainsActionSql} AND (${revisionProposedActionCountSql}=1 OR h.snapshot->>'actionChange' IN ('create','modify')))
      OR (${invalidModernActionIdSql} AND (${revisionContainsChangedActionSql} OR (${revisionChangedActionCountSql}<>1 AND ${revisionContainsActionSql}))))
    AND (h.snapshot->>'actionChange' IN ('create','modify') OR (NOT (h.snapshot ? 'actionChange')
      AND (h.snapshot ? 'actionSource' OR h.snapshot ? 'actionSources' OR h.snapshot ? 'actionFieldSources')))
  ORDER BY h.revision DESC LIMIT 1
) action_provenance ON true`

function questionBasisSources(nodes:unknown,actionSource:unknown,titleSource:unknown):any[]{
 const nodeSources=(Array.isArray(nodes)?nodes:[]).filter((node:any)=>node?.status==='active'&&!node?.supersededByActionCorrection).map((node:any)=>node?.source).filter((source:any)=>source&&typeof source.messageId==='string')
 const distinctNodeSources=[...new Map(nodeSources.map((source:any)=>[JSON.stringify([source.messageId,source.conversationId??null,source.quote??null,source.range?.start??null,source.range?.end??null]),source])).values()]
 if(distinctNodeSources.length)return distinctNodeSources
 const actionSources=(Array.isArray(actionSource)?actionSource:[actionSource]).filter((source:any)=>source&&typeof source.messageId==='string')
 if(actionSources.length)return actionSources
 return titleSource&&typeof (titleSource as any).messageId==='string'?[titleSource]:[]
}

type ActionQuestionGroup={source:any;sources:any[]}
type RevisionQuestionBasis={defaultSources:any[];actionSources:any[];actionGroups:ActionQuestionGroup[];defaultRequiresAll?:boolean}
function revisionMaterialProjection(value:unknown,previousValue?:unknown){
 const snapshot=value&&typeof value==='object'?value as any:{}
 const snapshotActions=Array.isArray(snapshot.event?.actions)?snapshot.event.actions:[],activeSnapshotActions=snapshotActions.filter((action:any)=>action?.status==='proposed'&&action?.draft&&typeof action.id==='string')
 const previous=previousValue&&typeof previousValue==='object'?previousValue as any:{},previousActions=Array.isArray(previous.event?.actions)?previous.event.actions:[]
 const previousRevisions=new Map(previousActions.filter((action:any)=>typeof action?.id==='string').map((action:any)=>[action.id,String(action.revision??'')]))
 const changedActiveSnapshotActions=activeSnapshotActions.filter((action:any)=>String(action.revision??'')!==(previousRevisions.get(action.id)??''))
 const modernMaterialRevision=snapshot.actionChange==='create'||snapshot.actionChange==='modify'
 const suppliedActionId=typeof snapshot.actionId==='string'&&snapshot.actionId.trim()?snapshot.actionId:null
 const invalidSuppliedActionId=Boolean(modernMaterialRevision&&suppliedActionId&&(changedActiveSnapshotActions.length!==1||changedActiveSnapshotActions[0]!.id!==suppliedActionId))
 const actionId=invalidSuppliedActionId?null:suppliedActionId??(modernMaterialRevision&&activeSnapshotActions.length===1?activeSnapshotActions[0]!.id:null)
 const actionSource=snapshot.actionSource&&typeof snapshot.actionSource.messageId==='string'?snapshot.actionSource:null
 const actionSources=(Array.isArray(snapshot.actionSources)?snapshot.actionSources:actionSource?[actionSource]:[]).filter((source:any)=>source&&typeof source.messageId==='string')
 const actionDraft=actionId?snapshotActions.find((action:any)=>action?.id===actionId)?.draft:undefined
 const fieldProjectionPresent=Object.prototype.hasOwnProperty.call(snapshot,'actionFieldSources')
 const fieldSources=fieldProjectionPresent?actionFieldAuthoritySources(snapshot.actionFieldSources,actionDraft):[]
 const combinedSources=fieldProjectionPresent
  ?fieldSources?.length?distinctBoundSources([...actionSources,...fieldSources]):[]
  :actionSources
 return {snapshot,snapshotActions,activeSnapshotActions,changedActiveSnapshotActions,modernMaterialRevision,actionId,actionSource,actionSources,combinedSources,malformedModernMaterial:modernMaterialRevision&&(invalidSuppliedActionId||!actionId||!combinedSources.length)}
}
function revisionQuestionBases(history:readonly any[],titleSource:unknown):Map<number,RevisionQuestionBasis>{
 const latestActionSources=new Map<string,ActionQuestionGroup>(),result=new Map<number,RevisionQuestionBasis>()
 let previousSnapshot:unknown
 for(const turn of history){
  const {snapshot,activeSnapshotActions,changedActiveSnapshotActions,modernMaterialRevision,actionId,actionSource,actionSources,combinedSources,malformedModernMaterial}=revisionMaterialProjection(turn?.snapshot,turn?.previous_snapshot??previousSnapshot)
  previousSnapshot=snapshot
  const materialAuthorityRevision=modernMaterialRevision||!Object.prototype.hasOwnProperty.call(snapshot,'actionChange')
  if(materialAuthorityRevision){
   if(actionId&&combinedSources.length)latestActionSources.set(actionId,{source:actionSource??combinedSources.at(-1),sources:combinedSources})
   else if(modernMaterialRevision){
    if(actionId)latestActionSources.delete(actionId)
    else for(const action of changedActiveSnapshotActions.length===1?changedActiveSnapshotActions:activeSnapshotActions)latestActionSources.delete(action.id)
   }
  }
  const persisted=Array.isArray(snapshot.questionSources)?snapshot.questionSources.filter((source:any)=>source&&typeof source.messageId==='string'):[]
  if(persisted.length&&!malformedModernMaterial){result.set(Number(turn.revision),{defaultSources:persisted,actionSources:[],actionGroups:[],...(persisted.length>1?{defaultRequiresAll:true}:{})});continue}
  const event=snapshot.event&&typeof snapshot.event==='object'?snapshot.event:{}
  const activeActions=activeSnapshotActions
  const activeActionGroups:ActionQuestionGroup[]=activeActions.flatMap((action:any)=>{const group=latestActionSources.get(action.id);return group?[group]:[]})
  const activeActionSources=activeActionGroups.flatMap(group=>group.sources)
  const nodeSources=questionBasisSources(event.nodes??turn.nodes,undefined,undefined)
  const missingLegacyActionSource=activeActions.length===1&&!activeActionSources.length&&!actionSources.length&&!nodeSources.length
  const availableActionSources=activeActionSources.length?activeActionSources:actionSources
  result.set(Number(turn.revision),{
   defaultSources:malformedModernMaterial||missingLegacyActionSource||activeActionGroups.length>1&&!nodeSources.length?[{messageId:String(turn.source_message_id??''),quote:''}]:questionBasisSources(event.nodes??turn.nodes,availableActionSources,titleSource),
   actionSources:availableActionSources,
   actionGroups:activeActionGroups,
  })
 }
 return result
}

function revisionQuestionSourceCandidates(basis:RevisionQuestionBasis|undefined):any[]{
 if(!basis)return []
 return [...new Map([...basis.defaultSources,...basis.actionSources].map(source=>[JSON.stringify([source?.messageId??null,source?.conversationId??null,source?.quote??null,source?.range?.start??null,source?.range?.end??null]),source])).values()]
}
function boundQuestionSources(turn:any,question:string,fallback:Map<number,RevisionQuestionBasis>):any[]{
 const bindings=Array.isArray(turn?.snapshot?.questionBindings)?turn.snapshot.questionBindings:[]
 const exact=bindings.find((binding:any)=>binding?.question===question&&Array.isArray(binding.sources))?.sources
 const valid=Array.isArray(exact)?exact.filter((source:any)=>source&&typeof source.messageId==='string'):[]
 if(valid.length)return valid
 const basis=fallback.get(Number(turn.revision))
 if(!basis)return []
 const matching=basis.actionGroups.filter(group=>questionConfiguresActionIdentity(question,group.source))
 return matching.length===1?matching[0]!.sources:matching.length>1?[]:basis.defaultSources
}
function boundQuestionRequiresAll(turn:any,question:string,fallback?:Map<number,RevisionQuestionBasis>):boolean{
 const bindings=Array.isArray(turn?.snapshot?.questionBindings)?turn.snapshot.questionBindings:[]
 const exact=bindings.find((binding:any)=>binding?.question===question&&Array.isArray(binding.sources))
 return exact?exact.sourceRequirement==='all':fallback?.get(Number(turn.revision))?.defaultRequiresAll===true
}
function questionHistorySourceUnavailable(turn:any,question:string,bases:Map<number,RevisionQuestionBasis>,originUnavailable:boolean,unavailable:(source:BoundCoachSource)=>boolean){
 const sources=boundQuestionSources(turn,question,bases) as BoundCoachSource[]
 const explicit=Array.isArray(turn.snapshot?.questionBindings)&&turn.snapshot.questionBindings.some((binding:any)=>binding?.question===question&&Array.isArray(binding.sources)&&binding.sources.length)
 if(originUnavailable&&(!explicit||!sources.length))return true
 return boundQuestionRequiresAll(turn,question,bases)?sources.some(unavailable):sources.length>0&&sources.every(unavailable)
}

const questionBindingSourceKey=(source:any)=>JSON.stringify([source?.messageId??null,source?.conversationId??null,source?.quote??null,source?.range?.start??null,source?.range?.end??null])
const distinctQuestionBindings=(bindings:readonly any[])=>[...new Map(bindings.filter(binding=>binding&&typeof binding.question==='string'&&Array.isArray(binding.sources)).map(binding=>[
 JSON.stringify([binding.question,binding.sourceRequirement==='all'?'all':'any',binding.sources.map(questionBindingSourceKey).sort()]),binding,
])).values()]
type ActiveQuestionTurn={turn:any;question:string}
function advanceActiveQuestionTurns(active:Map<string,ActiveQuestionTurn[]>,turn:any){
 const exposed=new Set<string>((Array.isArray(turn?.snapshot?.event?.asked)?turn.snapshot.event.asked:[]).filter((question:unknown):question is string=>typeof question==='string'))
 for(const question of active.keys())if(!exposed.has(question))active.delete(question)
 for(const question of exposed)if(!active.has(question))active.set(question,[])
 for(const question of (Array.isArray(turn?.snapshot?.askedThisTurn)?turn.snapshot.askedThisTurn:[]).filter((value:unknown):value is string=>typeof value==='string'))if(exposed.has(question))active.get(question)!.push({turn,question})
}

async function legacyCurrentQuestionBindings(c:PoolClient,user:string,eventId:string,questions:readonly string[]):Promise<any[]>{
 const current=[...new Set(questions.filter(question=>typeof question==='string'&&question.trim()))]
 if(!current.length)return []
 // Compatibility only: snapshots written before currentQuestionBindings may
 // keep an active question whose exact binding is older than the bounded read
 // window. PostgreSQL returns only bindings for still-current questions and
 // the host deduplicates exact alternatives; ordinary projected snapshots
 // skip this historical scan entirely.
 const history=(await c.query(`SELECT h.revision,h.snapshot,r.source_message_id,e.title_source
   FROM coach_event_revisions h
   JOIN runs r ON r.user_id=h.user_id AND r.request_id=h.request_id
   JOIN coach_events e ON e.user_id=h.user_id AND e.id=h.event_id
   WHERE h.user_id=$1 AND h.event_id=$2 ORDER BY h.revision`,[user,eventId])).rows
 const questionBases=revisionQuestionBases(history,history[0]?.title_source)
 const active=new Map<string,ActiveQuestionTurn[]>()
 for(const turn of history)advanceActiveQuestionTurns(active,turn)
 return distinctQuestionBindings(current.flatMap(question=>active.get(question)??[]).flatMap(({turn,question})=>{
   const sources=boundQuestionSources(turn,question,questionBases)
   return sources.length?[{question,sources,...(boundQuestionRequiresAll(turn,question,questionBases)?{sourceRequirement:'all'}:{})}]:[]
 }))
}

export function unchangedProposedAction(event:CoachEvent|null|undefined,delta:EventDelta):boolean{
  if(!event||delta.target.operation!=='continue'||delta.target.eventId!==event.id||delta.action?.operation!=='modify')return false
  const change=delta.action,current=event.actions.find(action=>action.id===change.actionId)
  return Boolean(current&&current.status==='proposed'&&current.revision===change.expectedRevision&&current.draft!==null&&JSON.stringify(current.draft)===JSON.stringify(change.draft))
}

// Retain only contiguous original input outside node-backed quotes. Union all
// matching ranges first, so overlapping/nested quotes cannot leak old text.
type SourceExclusion=string|{quote:string;range?:{start:number;end:number}}
function unquotedRequestPartSources(content:string,sources:readonly SourceExclusion[]):{quote:string;range:{start:number;end:number}}[]{
  const ranges:[number,number][]=[]
  for(const source of sources){
    const quote=typeof source==='string'?source:source.quote,range=typeof source==='string'?undefined:source.range
    if(typeof quote!=='string'||!quote.trim())continue
    if(range&&Number.isSafeInteger(range.start)&&Number.isSafeInteger(range.end)&&range.start>=0&&range.end>range.start&&range.end<=content.length&&content.slice(range.start,range.end)===quote){ranges.push([range.start,range.end]);continue}
    for(let at=content.indexOf(quote);at>=0;at=content.indexOf(quote,at+1))ranges.push([at,at+quote.length])
  }
  ranges.sort((a,b)=>a[0]-b[0])
  const parts:{quote:string;range:{start:number;end:number}}[]=[];let cursor=0
  const pushPart=(start:number,end:number)=>{
    const raw=content.slice(start,end),partStart=start+raw.length-raw.trimStart().length,partEnd=end-(raw.length-raw.trimEnd().length)
    if(partEnd>partStart&&/[\p{L}\p{N}]/u.test(content.slice(partStart,partEnd)))parts.push({quote:content.slice(partStart,partEnd),range:{start:partStart,end:partEnd}})
  }
  for(const [start,end] of ranges){if(start>cursor)pushPart(cursor,start);cursor=Math.max(cursor,end)}
  pushPart(cursor,content.length)
  return parts
}
function unquotedRequestParts(content:string,sources:readonly SourceExclusion[]):string[]{return unquotedRequestPartSources(content,sources).map(part=>part.quote)}
const coordinatedArtifactHead=/(?:跟进消息|预算表|核对表|作品集|消息|邮件|短信|文案|草稿|话术|计划|清单|简历|文档|表格|方案|提纲|报告|海报|问题|回复|说明|推导|模板)/
const responseNonActionNounSource='(?:率|比例|占比|数量|总数|总量|次数|时长|时间|速度|情况|状态|进度|结果|记录|统计|数据|内容|质量|频率|分布|汇总|分析|趋势)'
const materialCreateVerbSource=`(?:写|起草|拟|列|制作|生成|设计|画|产出|(?:创建|新建|新增)(?=[^，。！？；\\n]{0,28}(?:行动|任务|步骤))|回复(?!\\s*(?:的\\s*)?${responseNonActionNounSource})|问(?!题|的\\s*问题|\\s*(?:我|本人)?\\s*(?:一(?:个|下)?|个)?\\s*(?:(?:完整|具体|开放式?|值得问的?)\\s*)?问题)|发(?!现|展|生|挥|育))`
const standaloneMaterialCreateVerbSource='(?:写|起草|拟|列|制作|生成|设计|画|产出)'
const coordinatedMaterialCreateVerbSource=`(?:做|${materialCreateVerbSource})`
const actionRemovalVerbSource='(?:去掉|删掉|删除|移除|去除|取消)'
const materialModifyVerbSource=`(?:改写|修改|重写|改短|缩短|精简|简短|润色|调整|${actionRemovalVerbSource}|补上|改|换)`
const actionPastMarkerSource='(?:已经|已|曾经|曾|昨天|前天|之前|刚才|刚刚)'
const responseStateLookupVerbSource='(?:了解|确认|查询|查看|查阅|检查|核对|看看|知道|弄清|查)'
const responseStateSuffixSource=`(?:(?:的\s*)?${responseNonActionNounSource}|了吗|了没|没有|没|是否|何时|什么时候|$)`
const responseStateLookup=new RegExp(`(?:想|希望|需要)?${responseStateLookupVerbSource}[^。！？\\n]{0,24}(?:回复|回应|反馈)${responseStateSuffixSource}`)
const responseJudgmentVerbSource='(?:确认|判断|分析|评估|考虑|比较|对比|列出|列|梳理|看看|了解|弄清|说明|解释|总结)'
const responseActionJudgment=new RegExp(`${responseJudgmentVerbSource}(?:一下)?(?:是否|要不要|该不该|应不应该|能否|可不可以)[^。！？\\n]{0,12}(?:回复|回应)|${responseJudgmentVerbSource}(?:一下)?[^。！？\\n]{0,12}(?:回复|回应)[^。！？\\n]{0,16}(?:是否)?(?:合不合适|合适|应该|必要|可行|值得|妥当|风险|利弊|影响|后果|代价|收益|优缺点)`)
const directResponseRequest=new RegExp(`(?:帮我|请(?!教)|给我|麻烦|能不?能|可不可以|直接)(?:(?!${responseStateLookupVerbSource})[^。！？\\n]){0,16}(?:回复|回应)`)
const responseOperationAfterLookup=new RegExp(`(?:并(?:且)?|再|然后|同时)\\s*((?:(?:帮我|请(?!教)|给我|麻烦|能不?能|可不可以|直接)\\s*)?(?:回复|回应)(?!${responseStateSuffixSource})[^，。；！？\\n]{0,24})`)
const responseCausalAnalysis=new RegExp(responseJudgmentVerbSource+'[^，。；！？\\n]{0,12}(?:回复|回应)[^，。；！？\\n]{0,12}(?:原因|缘由|怎么回事)')
const materialGuidance=/(?:请(?:你)?|麻烦(?:你)?|帮我)?(?:告诉我|教我|讲讲|解释|说明)(?:一下)?(?:我(?:该|应该)?)?(?:如何|怎样|怎么)(?:(?!(?:然后|再|同时|并且?)\s*(?:请|帮我|给我|麻烦|能不?能|可不可以|直接))[^，。；！？\r\n]){1,96}/
function directedResponseOperationAfterLookup(text:string):{quote:string;start:number;end:number}|null{
 if(!responseStateLookup.test(text)&&!responseActionJudgment.test(text)&&!responseCausalAnalysis.test(text))return null
 const match=responseOperationAfterLookup.exec(text),quote=match?.[1]
 if(!match||!quote||!/(?:帮我|请(?!教)|给我|麻烦|能不?能|可不可以|直接)/.test(text.slice(0,match.index)+quote))return null
 const start=match.index+match[0].indexOf(quote)
 return {quote,start,end:start+quote.length}
}
type ResponseSemanticRange={start:number;end:number}
function nonAuthorizingMaterialRanges(text:string):ResponseSemanticRange[]{
 const patterns=[responseActionJudgment,responseCausalAnalysis,materialGuidance,...(!directResponseRequest.test(text)?[responseStateLookup]:[])]
 const ranges=patterns.flatMap(pattern=>[...text.matchAll(new RegExp(pattern.source,'g'))].map(match=>({start:match.index!,end:match.index!+match[0].length}))).sort((a,b)=>a.start-b.start||a.end-b.end)
 const merged:ResponseSemanticRange[]=[]
 for(const range of ranges){
  const previous=merged.at(-1)
  if(previous&&range.start<=previous.end)previous.end=Math.max(previous.end,range.end)
  else merged.push({...range})
 }
 return merged
}
function materialAuthorizingFragments(text:string):{text:string;offset:number}[]{
 const ranges=nonAuthorizingMaterialRanges(text),fragments:{text:string;offset:number}[]=[]
 let cursor=0
 for(const range of ranges){
  if(range.start>cursor)fragments.push({text:text.slice(cursor,range.start),offset:cursor})
  cursor=Math.max(cursor,range.end)
 }
 if(cursor<text.length)fragments.push({text:text.slice(cursor),offset:cursor})
 return fragments.filter(fragment=>fragment.text.trim())
}
const materialAuthorizingView=(text:string)=>materialAuthorizingFragments(text).map(fragment=>fragment.text).join('')
const coordinatedRequestPrefix=new RegExp(`(?:帮我|请(?!教)|给我|麻烦|能不?能|可不可以|直接|想要?|想|打算|需要|可以|先|怎么)[^，。；！？]{0,16}?(?:${coordinatedMaterialCreateVerbSource}|${materialModifyVerbSource})|(?:给我|发)(?=一(?:句|条|段))`)
function coordinatedActionRequestParts(content:string,start:number,end:number){
 const body=content.slice(start,end),prefix=coordinatedRequestPrefix.exec(body)
 if(!prefix)return []
 const replyOperationStart=/回复\s*$/.test(prefix[0])?prefix[0].lastIndexOf('回复'):prefix[0].length
 const objectStart=prefix.index+replyOperationStart,tail=body.slice(objectStart),siblingStart=`(?:给我|把|将|${materialModifyVerbSource}|${coordinatedMaterialCreateVerbSource}|一|两|这|那)`,connector=new RegExp(`(?:以及|和|及|、|并(?:且)?(?=\\s*(?:(?:再|先|稍微)\\s*)?${siblingStart})|(?:[，,]\\s*)?同时(?=\\s*(?:(?:再|先|稍微)\\s*)?${siblingStart}))`,'g')
 const connectors=[...tail.matchAll(connector)].map(match=>({start:match.index!,end:match.index!+match[0].length}))
 const hasArtifact=(range:{start:number;end:number})=>coordinatedArtifactHead.test(tail.slice(range.start,range.end))
 const split=(range:{start:number;end:number}):{start:number;end:number}[]=>{
  for(let index=connectors.length-1;index>=0;index--){
   const boundary=connectors[index]!
   if(boundary.start<=range.start||boundary.end>=range.end)continue
   const left={start:range.start,end:boundary.start},right={start:boundary.end,end:range.end}
   const leftText=tail.slice(left.start,left.end).trim(),rightText=tail.slice(right.start,right.end).trim()
   const comparisonHead='(?:报告|方案|计划|材料|文档)'
   const compoundComparison=new RegExp(`${comparisonHead}$`).test(leftText)&&new RegExp(`^[^，。；！？]{0,16}${comparisonHead}的(?:对比|比较|汇总|综合)(?:表|报告|文档|方案)`).test(rightText)
   if(hasArtifact(left)&&hasArtifact(right)&&!compoundComparison)return [...split(left),...split(right)]
  }
  return [range]
 }
 const ranges=split({start:0,end:tail.length})
 const parts=ranges.map(range=>{
  const raw=tail.slice(range.start,range.end),trimStart=raw.length-raw.trimStart().length,trimEnd=raw.length-raw.trimEnd().length
  let relativeStart=range.start+trimStart
  const relativeEnd=range.end-trimEnd,localGoverning=range.start>0?/^(给我)\s*/.exec(tail.slice(relativeStart,relativeEnd)):null
  const partEnd=start+objectStart+relativeEnd
  const rawPrefix=body.slice(0,objectStart),prefixStart=start+rawPrefix.length-rawPrefix.trimStart().length,prefixEnd=start+objectStart-(rawPrefix.length-rawPrefix.trimEnd().length)
  let governing={quote:content.slice(prefixStart,prefixEnd),range:{start:prefixStart,end:prefixEnd}}
  if(localGoverning){const localStart=start+objectStart+relativeStart;governing={quote:localGoverning[1]!,range:{start:localStart,end:localStart+localGoverning[1]!.length}};relativeStart+=localGoverning[0].length}
  const partStart=start+objectStart+relativeStart
  const quote=content.slice(partStart,partEnd),localOperation=coordinatedLocalModify.test(quote.trim())||coordinatedLocalCreate.test(quote.trim())||coordinatedObjectFrontedModify.test(quote.trim())
  return {quote,range:{start:partStart,end:partEnd},...(!localOperation?{governing}:{})}
 })
 const coordinatedContinuation=prefix.index>0&&/^(?:同时|并(?:且)?|另外|此外)\s*$/.test(body.slice(0,prefix.index))
 return (parts.length>1||coordinatedContinuation)&&parts.every(part=>part.quote&&coordinatedArtifactHead.test(part.quote))?parts:[]
}
const coordinatedLocalModify=new RegExp(`^(?:(?:再|稍微)\\s*)?(?:${materialModifyVerbSource}|加上|加一)`)
const coordinatedLocalCreate=new RegExp(`^(?:(?:再|先)\\s*)?${coordinatedMaterialCreateVerbSource}`)
const coordinatedPartOperations=(part:{quote:string;governing?:{quote:string}},fallback:readonly ('create'|'modify')[])=>{
 const local=part.quote.trim(),authority=coordinatedLocalModify.test(local)||coordinatedLocalCreate.test(local)?local:part.governing?.quote??''
 if(coordinatedObjectFrontedModify.test(local))return ['modify'] as const
 if(coordinatedLocalModify.test(authority))return ['modify'] as const
 if(coordinatedLocalCreate.test(authority)||new RegExp(`(?:${coordinatedMaterialCreateVerbSource}|给我)\\s*$`).test(authority))return ['create'] as const
 return fallback
}
const coordinatedObjectFrontedModify=new RegExp(`^(?:并(?:且)?|同时)?\\s*((?:把|将)[^，。；！？]{1,48}?(?:${materialModifyVerbSource}|加上|加一)[^，。；！？]*)$`)
const completedObjectFrontedNarration=new RegExp(`(?:是|属于)(?:我|本人)?[^，。；！？]{0,32}${actionPastMarkerSource}[^，。；！？]{0,24}(?:做完|完成|改完|改好|处理完|做过|改过|修改过|处理过)(?:了)?(?:(?:[^，。；！？]{0,16})?的(?:事|事情|工作|动作)|)$`)
const completedObjectFrontedModifyNarration=new RegExp(`^(?:把|将)[^，。；！？]{1,48}?(?:${materialModifyVerbSource}|加上|加一)(?:(?:好|完|掉)了|了|过)$`)
const objectFrontedModifyEvaluation=/(?:是|属于|算作|只是|仅是|作为)[^，。；！？]{0,24}(?:方案|选项|想法|建议|计划|工作|动作|事情|事)$|(?:可能|也许|或许|似乎|看起来)[^，。；！？]{0,16}(?:合适|可行|更好|稳妥|必要|值得)$|(?:列入|纳入)[^，。；！？]{0,8}(?:计划|方案)$/
const objectFrontedModifyRequest=(content:string,start:number,end:number):ActionRequestCandidate|null=>{
 const body=content.slice(start,end),match=coordinatedObjectFrontedModify.exec(body),quote=match?.[1]?.trim()
 if(!quote||!coordinatedArtifactHead.test(quote)||completedObjectFrontedNarration.test(quote)||completedObjectFrontedModifyNarration.test(quote)||objectFrontedModifyEvaluation.test(quote))return null
 const relativeStart=body.indexOf(quote),range={start:start+relativeStart,end:start+relativeStart+quote.length}
 // A rewrite is semantically a modification, but when no prior workspace
 // action exists the persisted replacement is necessarily the first/create
 // action. Keep both storage paths bound to the same exact user request.
 return {quote,range,operations:['create','modify']}
}
function unquotedActionRequestSources(content:string,sources:readonly SourceExclusion[]):ActionRequestCandidate[]{
 const available=unquotedRequestPartSources(content,sources),clauses=scanUserClauses(content)
 return clauses.flatMap<ActionRequestCandidate>(clause=>{
  if(clause.conditional||clause.attributedToOther||clause.quoted||clause.code||!available.some(part=>clause.start>=part.range.start&&clause.end<=part.range.end))return []
  const clauseText=clause.text.trim()
  // Event headings describe the workspace (for example “延期修改消息事项”)
  // rather than asking for another modification. Keep the shared intent
  // parser for actual instructions, but do not mint authority from a nominal
  // heading that merely contains an operation word.
  if(/(?:事项|主题|场景|案例)$/.test(clauseText)&&!assistantRequestClause(clauseText))return []
  const sentence=content.slice(clause.sentenceStart,clause.sentenceEnd),instruction=assistantInstructionClause(content,clause,clauses)
  if(completedObjectFrontedNarration.test(clauseText))return []
  const directedResponse=directedResponseOperationAfterLookup(clause.text)
  if(directedResponse)return [{quote:directedResponse.quote,range:{start:clause.start+directedResponse.start,end:clause.start+directedResponse.end},operations:['create']}]
  const fragments=materialAuthorizingFragments(clause.text)
  if(fragments.length!==1||fragments[0]?.text!==clause.text){
   return fragments.flatMap(fragment=>unquotedActionRequestSources(fragment.text,[]).map(candidate=>({
    ...candidate,
    range:{start:clause.start+fragment.offset+candidate.range.start,end:clause.start+fragment.offset+candidate.range.end},
    ...(candidate.governing?{governing:{quote:candidate.governing.quote,range:{start:clause.start+fragment.offset+candidate.governing.range.start,end:clause.start+fragment.offset+candidate.governing.range.end}}}:{}),
   })))
  }
  const objectFronted=objectFrontedModifyRequest(content,clause.start,clause.end)
  if(objectFronted)return [objectFronted]
  const operations=(['create','modify'] as const).filter(operation=>materialRequest(clause.text,operation)==='requested'||instruction&&materialRequest(sentence,operation)==='requested')
  if(!operations.length)return []
  const coordinated=coordinatedActionRequestParts(content,clause.start,clause.end)
  if(coordinated.length)return coordinated.map(part=>({...part,operations:coordinatedPartOperations(part,operations)}))
  return [{quote:content.slice(clause.start,clause.end),range:{start:clause.start,end:clause.end},operations}]
 })
}

async function historicalActionMaterialState(c:PoolClient,user:string,eventId:string,actionId:string):Promise<{draft:unknown;sources:BoundCoachSource[];fieldSources:ActionFieldSourceBinding[];fieldSourcesKnown:boolean;legacy:boolean}|null>{
 const row=(await c.query(`SELECT a.draft,action_provenance.exact_source,action_provenance.exact_sources,action_provenance.exact_field_sources,action_provenance.field_sources_present
   FROM coach_actions a ${latestActionProvenanceJoin}
   WHERE a.user_id=$1 AND a.event_id=$2 AND a.id=$3`,[user,eventId,actionId])).rows[0]
 if(!row?.draft)return null
 const sources=(Array.isArray(row.exact_sources)?row.exact_sources:row.exact_source&&typeof row.exact_source==='object'?[row.exact_source]:[])
   .filter((source:any)=>source&&typeof source.messageId==='string'&&typeof source.quote==='string') as BoundCoachSource[]
 const exactSources=distinctBoundSources(sources)
 return {draft:row.draft,sources:exactSources,fieldSources:validActionFieldSources(row.exact_field_sources,row.draft),fieldSourcesKnown:row.field_sources_present===true,legacy:!exactSources.length}
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
async function sourceContent(c:PoolClient,user:string,source:BoundCoachSource):Promise<string|null>{
  if(source.redacted)return null
  if(await messageQuoteCorrected(c,user,source.messageId,source.quote,undefined,source.range))return null
  if(await growthQuoteSuppressed(c,user,source.messageId,source.quote,undefined,source.range))return null
  const row=(await c.query(`SELECT m.content FROM messages m
    WHERE m.user_id=$1 AND m.conversation_id=$2 AND m.id=$3 AND m.role='user'
    AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=m.user_id AND d.conversation_id=m.conversation_id)
    AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE ${fullMemorySuppressionSql('s')} AND s.user_id=m.user_id AND s.source_message_id=m.id)
    AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id)`,[user,source.conversationId,source.messageId])).rows[0]
  return row?.content??null
}
function sourceTextMatches(content:string,source:BoundCoachSource){
  return Boolean(source.quote.trim()&&uniqueSourceControlRange(content,source))
}
async function sourceAvailable(c:PoolClient,user:string,source:BoundCoachSource){
  const content=await sourceContent(c,user,source)
  return Boolean(content&&sourceTextMatches(content,source))
}
async function sourceCurrent(c:PoolClient,user:string,source:BoundCoachSource){
  // sourceContent already applies correction, suppression, deletion and
  // message visibility. Repeating those privacy queries here added latency
  // without making the read atomic; commit performs its own required pass.
  return sourceAvailable(c,user,source)
}
async function legacyActionRequestCandidates(c:PoolClient,user:string,eventId:string,sourceMessageIds:readonly string[],titleSource?:BoundCoachSource):Promise<BoundCoachSource[]>{
 if(!sourceMessageIds.length)return []
 const rows=(await c.query(`SELECT m.id,m.conversation_id,m.content,COALESCE((SELECT jsonb_agg(COALESCE(n.source,n.inquiry_context->'_withdrawnSource')) FROM coach_nodes n WHERE n.user_id=m.user_id AND n.event_id=$2 AND COALESCE(n.source->>'messageId',n.inquiry_context#>>'{_withdrawnSource,messageId}')=m.id::text),'[]'::jsonb) AS node_sources
   FROM messages m WHERE m.user_id=$1 AND m.id=ANY($3::uuid[]) AND m.role='user'
   AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=m.user_id AND d.conversation_id=m.conversation_id)
   AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE ${fullMemorySuppressionSql('s')} AND s.user_id=m.user_id AND s.source_message_id=m.id)
   AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id) ORDER BY m.created_at,m.id`,[user,eventId,sourceMessageIds])).rows
 return distinctBoundSources(rows.flatMap(message=>{
  const nodeExclusions=(Array.isArray(message.node_sources)?message.node_sources:[]).flatMap((source:any)=>{
   if(typeof source?.quote==='string'&&source.quote.trim())return [source]
   const range=source?.range
   if(range&&Number.isSafeInteger(range.start)&&Number.isSafeInteger(range.end)&&range.start>=0&&range.end>range.start&&range.end<=message.content.length)return [{quote:message.content.slice(range.start,range.end),range}]
   // A legacy node without an unambiguous coordinate cannot safely release
   // some other clause from the same message as action authority after the
   // node text is erased. Exclude the complete message in that rare case.
   return source?.redacted?[{quote:message.content,range:{start:0,end:message.content.length}}]:[]
  })
  const exclusions=[...nodeExclusions,...(titleSource&&message.id===titleSource.messageId?[titleSource]:[])]
  return unquotedActionRequestSources(message.content,exclusions).map(part=>({messageId:String(message.id),conversationId:String(message.conversation_id),quote:part.quote,range:part.range}))
 }))
}
// A title citation is not authority to discard independently sourced matter
// history. Only a scoped withdrawal can use this neutral title projection;
// full-message withdrawals and explicitly forgotten events stay unavailable.
async function currentCoachTitle(c:PoolClient,user:string,row:{id:string;title:string;title_source:BoundCoachSource}){
 const source=row.title_source
 if(!source||!source.redacted&&(typeof source.quote!=='string'||!source.quote.trim()))return null
 if(!source.redacted&&await sourceCurrent(c,user,source))return {title:row.title,source}
 if(!source.redacted&&!await growthQuoteSuppressed(c,user,source.messageId,source.quote)&&!await messageQuoteCorrected(c,user,source.messageId,source.quote))return null
 const original=(await c.query(`SELECT 1 FROM messages m WHERE m.user_id=$1 AND m.id=$2 AND m.conversation_id=$3 AND m.role='user' AND ($5 OR strpos(m.content,$4)>0)
   AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE ${fullMemorySuppressionSql('s')} AND s.user_id=m.user_id AND s.source_message_id=m.id)
   AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id)`,[user,source.messageId,source.conversationId,source.quote??'',source.redacted===true])).rowCount
 if(!original)return null
 const candidates=(await c.query(`SELECT n.source FROM coach_nodes n WHERE n.user_id=$1 AND n.event_id=$2 AND n.status='active' AND n.kind<>'unknown' AND n.source IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM (SELECT snapshot FROM coach_event_revisions WHERE user_id=n.user_id AND event_id=n.event_id ORDER BY revision DESC LIMIT 1) h,
     jsonb_array_elements(COALESCE(h.snapshot#>'{event,nodes}','[]'::jsonb)) item WHERE item->>'id'=n.id::text AND item->>'supersededByActionCorrection'='true')
   ORDER BY n.created_at,n.id`,[user,row.id])).rows
 for(const candidate of candidates)if(await sourceCurrent(c,user,candidate.source))return {title:'部分来源已更新的事项',source:candidate.source as BoundCoachSource}
  const actions=(await c.query(`SELECT a.id,a.draft,a.source_message_ids,a.consumed_request_sources,action_provenance.exact_source,action_provenance.exact_sources,action_provenance.exact_field_sources,action_provenance.field_sources_present,action_provenance.material_revision_modern
   FROM coach_actions a ${latestActionProvenanceJoin}
   WHERE a.user_id=$1 AND a.event_id=$2 AND a.status<>'stale' AND a.draft IS NOT NULL ORDER BY a.created_at,a.id`,[user,row.id])).rows
 for(const action of actions){
  const exact=actionAuthoritySources(action)
  let current=exact.length>0
  for(const candidate of exact)if(!await sourceCurrent(c,user,candidate)){current=false;break}
  if(current)return {title:'部分来源已更新的事项',source:exact.at(-1) as BoundCoachSource}
  if(exact.length)continue
   if(action.material_revision_modern===true)continue
   const inferred=await legacyActionRequestCandidates(c,user,row.id,action.source_message_ids,source)
  if(inferred.length===1&&await sourceCurrent(c,user,inferred[0]!))return {title:'部分来源已更新的事项',source:inferred[0]!}
 }
 return null
}

export async function invalidateCoachSourceQuotes(c:PoolClient,user:string,refs:{messageId:string;quote:string;range?:{start:number;end:number}}[],forget=false){
 // Deliberately acquires no account advisory lock: callers already own the
 // canonical memory-settings -> growth -> chronology order when they mutate a
 // source boundary. This helper only projects exact quote invalidation.
 if(!refs.length)return
 const ids=[...new Set(refs.map(ref=>ref.messageId))]
 const {retireAdjacentThemeLinks}=await import('./user-themes.ts')
 await retireAdjacentThemeLinks(c,user,ids,refs)
 const messages=new Map((await c.query('SELECT id,content FROM messages WHERE user_id=$1 AND id=ANY($2::uuid[])',[user,ids])).rows.map(row=>[row.id,row.content as string]))
  const controls=[...await coachSourceBoundaryRefs(c,user),...refs]
 const candidates=(await c.query(`SELECT e.id,e.title,e.title_source,COALESCE((SELECT jsonb_agg(n.source) FROM coach_nodes n WHERE n.user_id=e.user_id AND n.event_id=e.id AND n.status<>'withdrawn'),'[]'::jsonb) AS node_sources,
   ARRAY(SELECT a.id FROM coach_actions a WHERE a.user_id=e.user_id AND a.event_id=e.id AND a.source_message_ids && $2::uuid[]) AS affected_actions FROM coach_events e
   WHERE e.user_id=$1 AND (e.status='active' OR $3) AND (e.title_source->>'messageId'=ANY($2::text[]) OR EXISTS(SELECT 1 FROM coach_nodes n WHERE n.user_id=e.user_id AND n.event_id=e.id AND n.status<>'withdrawn' AND n.source->>'messageId'=ANY($2::text[]))
    OR EXISTS(SELECT 1 FROM coach_actions a WHERE a.user_id=e.user_id AND a.event_id=e.id AND a.source_message_ids && $2::uuid[])
    OR EXISTS(SELECT 1 FROM coach_event_revisions h WHERE h.user_id=e.user_id AND h.event_id=e.id AND (
      EXISTS(SELECT 1 FROM jsonb_path_query(h.snapshot,'$.questionSources[*].messageId') q(value) WHERE q.value #>> '{}' = ANY($2::text[]))
      OR EXISTS(SELECT 1 FROM jsonb_path_query(h.snapshot,'$.questionBindings[*].sources[*].messageId') q(value) WHERE q.value #>> '{}' = ANY($2::text[]))
      OR EXISTS(SELECT 1 FROM jsonb_path_query(h.snapshot,'$.currentQuestionBindings[*].sources[*].messageId') q(value) WHERE q.value #>> '{}' = ANY($2::text[]))))
     OR EXISTS(SELECT 1 FROM coach_event_revisions h JOIN runs r ON r.user_id=h.user_id AND r.request_id=h.request_id WHERE h.user_id=e.user_id AND h.event_id=e.id AND (r.source_message_id=ANY($2::uuid[]) OR $3 AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(h.snapshot#>'{event,nodes}','[]'::jsonb)) n WHERE n#>>'{source,messageId}'=ANY($2::text[])))) )`,[user,ids,forget])).rows
 const matches=(source:any)=>source&&typeof source.quote==='string'&&refs.some(ref=>ref.messageId===source.messageId&&sourceQuotesOverlap(messages.get(ref.messageId)??'',source,ref))
 const persistedQuestionSources=(snapshot:any)=>[
  ...(Array.isArray(snapshot?.questionSources)?snapshot.questionSources:[]),
  ...[snapshot?.questionBindings,snapshot?.currentQuestionBindings].flatMap(bindings=>Array.isArray(bindings)?bindings.flatMap(binding=>Array.isArray(binding?.sources)?binding.sources:[]):[]),
 ]
 for(const event of candidates){
   const history=(await c.query(`SELECT h.revision,h.snapshot,r.source_message_id,m.content AS source_content,
     NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=m.user_id AND d.conversation_id=m.conversation_id)
     AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE ${fullMemorySuppressionSql('s')} AND s.user_id=m.user_id AND s.source_message_id=m.id)
     AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id) AS source_available
    FROM coach_event_revisions h JOIN runs r ON r.user_id=h.user_id AND r.request_id=h.request_id
    JOIN messages m ON m.user_id=r.user_id AND m.id=r.source_message_id
    WHERE h.user_id=$1 AND h.event_id=$2 ORDER BY h.revision`,[user,event.id])).rows
   const actionRows=event.affected_actions.length?(await c.query(`SELECT a.id,a.draft,a.source_message_ids,a.consumed_request_sources,action_provenance.exact_source,action_provenance.exact_sources,action_provenance.exact_field_sources,action_provenance.field_sources_present,action_provenance.material_revision_modern
    FROM coach_actions a ${latestActionProvenanceJoin}
    WHERE a.user_id=$1 AND a.event_id=$2 AND a.id=ANY($3::uuid[])`,[user,event.id,event.affected_actions])).rows:[]
   const affectedActions:string[]=[]
   for(const action of actionRows){
   const exact=actionAuthoritySources(action)
    if(exact.length){if(exact.some(matches))affectedActions.push(action.id as string);continue}
    if(action.material_revision_modern===true){affectedActions.push(action.id as string);continue}
    // Pre-provenance actions are reconstructed only from the durable message
    // ids owned by that action. Unrelated later event turns cannot introduce a
    // second candidate, while zero/multiple candidates remain fail-closed.
    const inferred=await legacyActionRequestCandidates(c,user,event.id,action.source_message_ids,event.title_source)
    if(inferred.length!==1||matches(inferred[0]))affectedActions.push(action.id as string)
   }
   const changedOrigins=history.filter(turn=>ids.includes(turn.source_message_id))
   const changedToolSources=withdrawnQuestionTools(refs.filter(ref=>ref.messageId===event.title_source?.messageId||changedOrigins.some(turn=>turn.source_message_id===ref.messageId)))
   const questionAffected=history.some(row=>persistedQuestionSources(row.snapshot).some(matches))||changedToolSources.names.size>0||changedToolSources.useObjects.size>0
     ||changedOrigins.some(turn=>sourceFullyControlled(turn.source_message_id,turn.source_content,controls))
  if(!questionAffected&&![event.title_source,...event.node_sources].some(matches)&&!affectedActions.length&&!(forget&&history.some(row=>ids.includes(row.source_message_id)||(row.snapshot.event?.nodes??[]).some((node:any)=>matches(node.source)))))continue
  await c.query('UPDATE coach_events SET revision=revision+1,generation=generation+1,updated_at=now() WHERE user_id=$1 AND id=$2',[user,event.id])
  if(affectedActions.length)await c.query("UPDATE coach_actions SET status='stale',draft=NULL,closed_reason=NULL,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=ANY($3::uuid[])",[user,event.id,affectedActions])
  const title=await currentCoachTitle(c,user,event)
  // The birth citation stays immutable. Full withdrawal must continue to close
  // the original matter, including when an older instance handles that write.
  if(title&&matches(event.title_source))await c.query('UPDATE coach_events SET title=$3 WHERE user_id=$1 AND id=$2',[user,event.id,'部分来源已更新的事项'])
  if(!title){
   // A scoped source control makes an ungrounded event unreadable but is not
   // the same authority as a full event/source withdrawal. Keep the tombstone
   // active for audit and return COACH_SOURCE_REVOKED; the full-message path
   // below alone changes the event status to forgotten.
   await c.query("UPDATE coach_events SET title='' WHERE user_id=$1 AND id=$2",[user,event.id])
   await c.query("UPDATE coach_actions SET status='stale',draft=NULL,closed_reason=NULL,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2",[user,event.id])
   await c.query('DELETE FROM coach_current WHERE user_id=$1 AND event_id=$2',[user,event.id])
   await c.query('DELETE FROM coach_index_jobs WHERE user_id=$1 AND event_id=$2',[user,event.id])
  }
  if(forget||questionAffected){
   const nodes=(await c.query('SELECT id,kind,content,source FROM coach_nodes WHERE user_id=$1 AND event_id=$2',[user,event.id])).rows
   const removed=forget?nodes.filter(node=>matches(node.source)).map(node=>node.id):[]
    const questionBases=revisionQuestionBases(history,event.title_source)
    const boundSources=history.flatMap(turn=>[
      ...revisionQuestionSourceCandidates(questionBases.get(Number(turn.revision))),
      ...persistedQuestionSources(turn.snapshot),
    ]).filter((source:any)=>source&&typeof source.messageId==='string'&&typeof source.quote==='string')
    const sourceKey=(source:any)=>JSON.stringify([source.messageId,source.conversationId??null,source.quote,source.range??null])
    const unavailableQuestionSources=new Set<string>()
    for(const source of new Map(boundSources.map((candidate:any)=>[sourceKey(candidate),candidate])).values())if(matches(source)||!await sourceCurrent(c,user,source as BoundCoachSource))unavailableQuestionSources.add(sourceKey(source))
    const questionSourceUnavailable=(source:any)=>!source||typeof source.messageId!=='string'||typeof source.quote!=='string'||!source.quote.trim()||unavailableQuestionSources.has(sourceKey(source))
     const eventSources=[event.title_source,...event.node_sources,...boundSources]
     const historyText=new Map<string,string>(history.map(turn=>[turn.source_message_id,turn.source_content]))
     const availableHistoryText=new Map<string,string>(history.filter(turn=>turn.source_available).map(turn=>[turn.source_message_id,turn.source_content]))
     const activeQuestionTurns=new Map<string,ActiveQuestionTurn[]>()
     for(const turn of history)advanceActiveQuestionTurns(activeQuestionTurns,turn)
     const toolsFor=questionToolScopes(event.title_source,eventSources,controls,id=>messages.get(id)??historyText.get(id)??'',id=>availableHistoryText.get(id)??'')
     const fullyControlledOrigins=new Set(history.filter(row=>!row.source_available||sourceFullyControlled(row.source_message_id,row.source_content,controls)).map(row=>row.source_message_id))
    const currentBindings=history.at(-1)?.snapshot?.currentQuestionBindings
    const currentQuestionBindings=Array.isArray(currentBindings)?currentBindings:[]
    const liveBindings=(bindings:readonly any[])=>bindings.flatMap(binding=>{
     if(!Array.isArray(binding?.sources))return []
     const sources=binding.sources.filter((source:any)=>!questionSourceUnavailable(source))
     return sources.length&&(binding.sourceRequirement!=='all'||sources.length===binding.sources.length)?[{...binding,sources}]:[]
    })
    const questionSourceInvalidated=(turn:any,question:string)=>{
     const ownBindings=Array.isArray(turn.snapshot?.questionBindings)?turn.snapshot.questionBindings:[]
     const current=liveBindings(currentQuestionBindings.filter(binding=>binding?.question===question))
      const withdrawn=toolsFor(question,turn.source_message_id)
      if(current.length&&!questionUsesWithdrawnTerm(question,withdrawn,current,questionSourceUnavailable))return false
      if(questionUsesWithdrawnTerm(question,withdrawn,ownBindings,questionSourceUnavailable))return true
      return questionHistorySourceUnavailable(turn,question,questionBases,fullyControlledOrigins.has(turn.source_message_id),questionSourceUnavailable)
    }
     const derivedQuestionWithdrawn=(question:string|null)=>{
      if(typeof question!=='string')return false
      const occurrences=activeQuestionTurns.get(question)??[]
      return occurrences.length?occurrences.every(({turn})=>toolsFor(question,turn.source_message_id).terms.length>0&&questionSourceInvalidated(turn,question))
       :questionUsesWithdrawnTerm(question,toolsFor(question),currentQuestionBindings,questionSourceUnavailable)
     }
    const questionTurns=[...activeQuestionTurns.values()].flat()
    const retainedQuestionTurns=questionTurns.filter(({turn,question})=>!questionSourceInvalidated(turn,question))
    const retainedQuestions=new Set(retainedQuestionTurns.map(({question})=>question))
    const affectedQuestions=new Set(questionTurns.filter(({turn,question})=>questionSourceInvalidated(turn,question)).map(({question})=>question))
    const retiredQuestions=new Set([...affectedQuestions].filter(question=>!retainedQuestions.has(question)))
    const currentBindingsFor=(turns:readonly ActiveQuestionTurn[],asked:readonly unknown[])=>distinctQuestionBindings(turns.filter(({question})=>asked.includes(question)).flatMap(({turn,question})=>{
      const sources=boundQuestionSources(turn,question,questionBases).filter(source=>!questionSourceUnavailable(source))
      return sources.length?[{question,sources,...(boundQuestionRequiresAll(turn,question,questionBases)?{sourceRequirement:'all'}:{})}]:[]
    }))
    const withdrawnNodes=nodes.filter(node=>removed.includes(node.id)||node.kind==='unknown'&&(retiredQuestions.has(node.content)||derivedQuestionWithdrawn(node.content)))
    const withdrawnIds=new Set(withdrawnNodes.map(node=>node.id))
    const withdrawnMarkers=withdrawnNodes.map(node=>{
      if(!node.source)return {id:node.id,marker:null}
      const content=messages.get(node.source.messageId)??''
      const range=content?uniqueSourceControlRange(content,node.source):null
      const {messageId,conversationId}=node.source
      return {id:node.id,marker:{messageId,conversationId,...(range?{range}:{}),redacted:true}}
    })
    if(withdrawnMarkers.length)await c.query(`UPDATE coach_nodes n SET status='withdrawn',content=NULL,
      inquiry_context=CASE WHEN v.marker IS NULL THEN n.inquiry_context ELSE COALESCE(n.inquiry_context,'{}'::jsonb)||jsonb_build_object('_withdrawnSource',v.marker) END,
      source=NULL,revision=n.revision+1,updated_at=now()
      FROM jsonb_to_recordset($3::jsonb) AS v(id uuid,marker jsonb)
      WHERE n.user_id=$1 AND n.event_id=$2 AND n.id=v.id`,[user,event.id,JSON.stringify(withdrawnMarkers)])
   if(forget&&matches(event.title_source)){const {messageId,conversationId,range}=event.title_source;await c.query('UPDATE coach_events SET title_source=$3 WHERE user_id=$1 AND id=$2',[user,event.id,{messageId,conversationId,...(range?{range}:{}),redacted:true}])}
   const rewriteActiveQuestionTurns=new Map<string,ActiveQuestionTurn[]>()
   for(const row of history){
    advanceActiveQuestionTurns(rewriteActiveQuestionTurns,row)
    const snapshot=structuredClone(row.snapshot)
    if(Array.isArray(snapshot.matterReports))snapshot.matterReports=snapshot.matterReports.filter((report:any)=>!questionSourceUnavailable(report.source)&&!(forget&&matches(report.source)))
    if(snapshot.event){
      if(forget&&matches(event.title_source))snapshot.event.title=''
      snapshot.event.asked=(Array.isArray(snapshot.event.asked)?snapshot.event.asked:[]).filter((question:unknown)=>typeof question==='string'&&!derivedQuestionWithdrawn(question)&&(!affectedQuestions.has(question)||retainedQuestions.has(question)))
      delete snapshot.event.actionStages;delete snapshot.event.actionStageEvidence;delete snapshot.event.actionStageScope
     snapshot.event.nodes=(snapshot.event.nodes??[]).map((node:any)=>withdrawnIds.has(node.id)||(forget&&matches(node.source))||(node.kind==='unknown'&&(retiredQuestions.has(node.content)||derivedQuestionWithdrawn(node.content)))?{id:node.id,kind:node.kind,status:'withdrawn',content:null,source:null}:node)
     if(forget)snapshot.event.actions=(snapshot.event.actions??[]).map((action:any)=>affectedActions.includes(action.id)?{id:action.id,status:'stale',draft:null,closedReason:null}:action)
    }
     if(forget&&snapshot.actionSource&&(matches(snapshot.actionSource)||questionSourceUnavailable(snapshot.actionSource)))delete snapshot.actionSource
     if(forget&&Array.isArray(snapshot.actionSources)){
      snapshot.actionSources=snapshot.actionSources.filter((source:any)=>!matches(source)&&!questionSourceUnavailable(source))
      if(!snapshot.actionSources.length)delete snapshot.actionSources
     }
     if(forget&&Array.isArray(snapshot.actionFieldSources)){
      snapshot.actionFieldSources=snapshot.actionFieldSources.map((binding:any)=>({...binding,sources:(Array.isArray(binding?.sources)?binding.sources:[]).filter((source:any)=>!matches(source)&&!questionSourceUnavailable(source))})).filter((binding:any)=>binding.sources.length)
      if(!snapshot.actionFieldSources.length)delete snapshot.actionFieldSources
     }
     if(Array.isArray(snapshot.questionSources)){
      snapshot.questionSources=snapshot.questionSources.filter((source:any)=>!questionSourceUnavailable(source))
      if(!snapshot.questionSources.length)delete snapshot.questionSources
     }
     snapshot.askedThisTurn=(Array.isArray(snapshot.askedThisTurn)?snapshot.askedThisTurn:[]).filter((question:unknown)=>typeof question==='string'&&!questionSourceInvalidated(row,question))
     if(Array.isArray(snapshot.questionBindings)){
      snapshot.questionBindings=snapshot.questionBindings.map((binding:any)=>({...binding,sources:(Array.isArray(binding?.sources)?binding.sources:[]).filter((source:any)=>!questionSourceUnavailable(source))})).filter((binding:any)=>binding.sources.length&&(Array.isArray(snapshot.askedThisTurn)?snapshot.askedThisTurn:[]).includes(binding.question))
      if(!snapshot.questionBindings.length)delete snapshot.questionBindings
     }
      // Redaction cannot promote a legacy fallback to a durable exact binding.
      if(Array.isArray(snapshot.currentQuestionBindings)){
       const retainedThrough=[...rewriteActiveQuestionTurns.values()].flat().filter(({turn,question})=>!questionSourceInvalidated(turn,question))
       snapshot.currentQuestionBindings=currentBindingsFor(retainedThrough,Array.isArray(snapshot.event?.asked)?snapshot.event.asked:[])
       if(row===history.at(-1))snapshot.currentQuestionBindings=distinctQuestionBindings([...snapshot.currentQuestionBindings,...liveBindings(currentQuestionBindings).filter(binding=>snapshot.event?.asked?.includes(binding.question))])
      }
    await c.query('UPDATE coach_event_revisions SET snapshot=$4 WHERE user_id=$1 AND event_id=$2 AND revision=$3',[user,event.id,row.revision,snapshot])
   }
   await c.query('DELETE FROM coach_semantic_index WHERE user_id=$1 AND event_id=$2',[user,event.id])
   if(forget)await c.query("UPDATE runs SET response=jsonb_set(response,'{event}','null'::jsonb) WHERE user_id=$1 AND response#>>'{event,id}'=$2",[user,event.id])
  }
 }
}
function bindCurrentSource(run:Run,source:{messageId:string;quote:string}):BoundCoachSource{
  if(source.messageId!==run.source_message_id)throw new HttpError(400,'COACH_CURRENT_SOURCE_REQUIRED')
  const range=selectedSourceRange(source)
  return {...source,conversationId:run.conversation_id,...(range?{range}:{})}
}
async function currentSource(c:PoolClient,run:Run,source:{messageId:string;quote:string}):Promise<BoundCoachSource>{
  const ref=bindCurrentSource(run,source)
  const content=await sourceContent(c,run.user_id,ref)
  // Repair guidance carries the exact mismatch so a bounded repair can fix the
  // quoted span deterministically instead of guessing which reference failed.
  if(content===null||!sourceTextMatches(content,ref))throw new HttpError(400,'COACH_SOURCE_INVALID',undefined,{quote:source.quote.slice(0,400),currentText:content?.slice(0,2000)??null,currentMessageId:run.source_message_id})
  return ref
}
type ActionRequestCandidate={quote:string;range:{start:number;end:number};operations:readonly ('create'|'modify')[];governing?:{quote:string;range:{start:number;end:number}}}
type ActionEditInstruction={request:string;preserved:string[];recipient?:string}
type ActionEditControls={instruction:ActionEditInstruction;preservationSources:BoundCoachSource[]}
type ActionRequestBinding={source:BoundCoachSource;sources:BoundCoachSource[];instruction:ActionEditInstruction;preservationSources:BoundCoachSource[];contentClarifications?:BoundCoachSource[]}
type ActionMaterialField={field:string;value:string}
const actionDraftMaterialFields=(value:unknown):ActionMaterialField[]=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return []
 const draft=value as Record<string,unknown>,fields:ActionMaterialField[]=[]
 for(const field of ['content','goal','start','observable','effort','stopWhen'])if(typeof draft[field]==='string'&&(draft[field] as string).trim())fields.push({field,value:draft[field] as string})
 if(Array.isArray(draft.materials))for(const material of draft.materials)if(typeof material==='string'&&material.trim())fields.push({field:'materials',value:material})
 return fields
}
const compactMaterialText=(value:string)=>Array.from(value.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'')).join('')
const sameMaterialValue=(left:string,right:string)=>left.normalize('NFKC').trim()===right.normalize('NFKC').trim()
const orderedMaterialSubsequence=(candidate:string,target:string)=>{
 const expected=Array.from(candidate),available=Array.from(target);let index=0
 for(const character of available)if(character===expected[index])index++
 return index===expected.length
}
const materialValueRetained=(before:string,after:string):boolean=>{
 const previous=compactMaterialText(before),next=compactMaterialText(after)
 if(!previous||!next)return false
 if(previous===next)return true
 if(Array.from(previous).length>=3&&Array.from(next).length>=3&&(orderedMaterialSubsequence(previous,next)||orderedMaterialSubsequence(next,previous)))return true
 // Stable literal identifiers remain attributable only when they existed in
 // the prior draft itself. Request wording is authority, not proof that an
 // identifier was actually delivered in the old material.
 const literals=before.normalize('NFKC').match(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?\d[\d\s()-]{4,}\d)|[A-Za-z0-9_-]{8,}/g)??[]
 return literals.some(literal=>compactMaterialText(literal).length>=6&&next.includes(compactMaterialText(literal)))
}
const canonicalDerivedMaterial=(value:string)=>value.normalize('NFKC')
 .replace(/星期([一二三四五六日天])/g,'周$1')
 .replace(/(?:之前|以前)/g,'前')
 .replace(/(?:递交|提交|交付)/g,'交')
 .replace(/(?:报告|文档|文件)/g,'文档')
const derivedStyleMaterialSource='(?:请问|方便时|有空时|麻烦|能否|是否|您好|你好|谢谢|感谢|正式|请|您|于|在|前|一下|再|也|还|好)'
const materialGreeting=/^(?<heading>(?:邮件|短信|(?:跟进)?消息)(?:模板|正文|草稿)?[：:]?\r?\n)?(?<recipient>[\p{Script=Han}A-Za-z]{1,12})(?:[，,:：][^\S\r\n]*)?(?:您好|你好)[，,:：。.!！]\s*/u
const withoutDerivedStyleMaterial=(value:string)=>value.replace(new RegExp(derivedStyleMaterialSource,'g'),'')
const orderedMaterialInsertion=(previous:string,next:string):string|null=>{
 const expected=Array.from(previous);let index=0,inserted=''
 for(const character of Array.from(next))if(character===expected[index])index++;else inserted+=character
 return index===expected.length?inserted:null
}
const actionDerivedRequestAnchors=(instruction:ActionEditInstruction):string[]=>{
 const request=actionUnprotectedText(instruction.request).normalize('NFKC')
 const specific=request
  .replace(/^(?:请|麻烦|帮我|能不?能|可不可以|给我)+/,' ')
  .replace(/(?:把|将)(?:这封|这条|这份|这个|该|当前)?/g,' ')
  .replace(/(?:改短|缩短|精简|简短|修改|改写|重写|润色|调整|改得|改成|改为)/g,' ')
  .replace(/(?:并且|并|同时)?(?:保持|维持|仍然|依然)?(?:礼貌|客气|正式|友好|自然|简洁|精炼)/g,' ')
  .replace(/(?:一下|稍微|更|的)/g,' ')
 const generic=new Set(['正文','文案','内容','整段','全文','标题','语气','措辞','格式','排版','消息','邮件','短信','话术','模板','报告','文档','文件'])
 const anchors=new Set<string>()
 for(const chunk of specific.match(/[\p{L}\p{N}_]+/gu)??[]){
  const characters=Array.from(chunk)
  for(let size=Math.min(12,characters.length);size>=2;size--)for(let start=0;start+size<=characters.length;start++){
   const candidate=compactMaterialText(characters.slice(start,start+size).join(''))
   if(!generic.has(candidate))anchors.add(candidate)
  }
 }
 return [...anchors].sort((left,right)=>Array.from(right).length-Array.from(left).length)
}
const actionDerivedRequestAnchorRetained=(instruction:ActionEditInstruction,before:string,after:string):boolean=>{
 const previous=compactMaterialText(canonicalDerivedMaterial(before)),next=compactMaterialText(canonicalDerivedMaterial(after))
 if(!previous||!next||Array.from(next).length>=Array.from(previous).length)return false
 return actionDerivedRequestAnchors(instruction).some(anchor=>{
  const at=next.indexOf(anchor)
  if(at<0)return false
  const residual=withoutDerivedStyleMaterial(next.slice(0,at)+next.slice(at+anchor.length))
  return !residual||orderedMaterialSubsequence(residual,previous)
 })
}
const derivedMaterialValueAuthorized=(instruction:ActionEditInstruction,before:string,after:string)=>{
 const request=actionUnprotectedText(instruction.request).normalize('NFKC')
 const styleEdit=/(?:语气|措辞|礼貌|润色|客气|正式|友好|自然)/.test(request)
 const greeting=styleEdit&&instruction.recipient?materialGreeting.exec(after):null
 if(greeting&&greeting.groups?.recipient===instruction.recipient){
  before=before.replace(materialGreeting,'$<heading>')
  after=(greeting.groups?.heading??'')+after.slice(greeting[0].length)
 }
 const previous=compactMaterialText(canonicalDerivedMaterial(before)),next=compactMaterialText(canonicalDerivedMaterial(after))
 if(!previous||!next)return false
 if(new RegExp(actionRemovalVerbSource).test(request))return actionRemovalDeltaAuthorized(before,after,actionRemovalPayloadTerms(instruction))
 if(/(?:改短|缩短|精简|简短)/.test(request)){
  if(Array.from(next).length>=Array.from(previous).length)return false
  if(orderedMaterialSubsequence(next,previous))return true
  return actionDerivedRequestAnchorRetained(instruction,before,after)
 }
 if(styleEdit){
  const inserted=orderedMaterialInsertion(previous,next)
  return inserted!==null&&!withoutDerivedStyleMaterial(inserted)
 }
 return previous===next
}
const draftRetainsPriorMaterial=(before:unknown,after:unknown):boolean=>{
 const next=actionDraftMaterialFields(after)
 return actionDraftMaterialFields(before).some(previous=>next.some(current=>current.field===previous.field&&materialValueRetained(previous.value,current.value)))
}
const distinctBoundSources=(sources:readonly BoundCoachSource[])=>[...new Map(sources.map(source=>[JSON.stringify([source.messageId,source.conversationId,source.quote,source.range?.start??null,source.range?.end??null]),source])).values()]
function durableActionRequestSources(value:unknown):BoundCoachSource[]{
 if(!Array.isArray(value)||!value.length)return []
 const sources:BoundCoachSource[]=[]
 for(const source of value){
  if(!source||typeof source!=='object'||typeof source.messageId!=='string'||typeof source.conversationId!=='string'||typeof source.quote!=='string'||!source.quote.trim()||source.redacted===true)return []
  const range=source.range
  if(range!==undefined&&(!range||!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<0||range.end<=range.start))return []
  sources.push(source as BoundCoachSource)
 }
 return distinctBoundSources(sources)
}
function actionRequestAuthoritySources(action:any):BoundCoachSource[]{
 const revision=(Array.isArray(action.exact_sources)?action.exact_sources:action.exact_source&&typeof action.exact_source==='object'?[action.exact_source]:[])
   .filter((source:any)=>source&&typeof source.messageId==='string'&&typeof source.conversationId==='string'&&typeof source.quote==='string'&&source.quote.trim()) as BoundCoachSource[]
 if(revision.length||action.material_revision_modern===true)return distinctBoundSources(revision)
 // Migration 044 stores exact consumed request coordinates on the action row.
 // It is an authoritative fallback only for genuinely pre-modern snapshots;
 // a malformed modern create/modify revision must continue to fail closed.
 return durableActionRequestSources(action.consumed_request_sources)
}
function actionFieldAuthoritySources(value:unknown,draft:unknown):BoundCoachSource[]|null{
 if(!Array.isArray(value)||!value.length)return null
 const material=actionDraftMaterialFields(draft),bindings=validActionFieldSources(value,draft)
 if(!material.length||bindings.length!==material.length||bindings.length!==value.length)return null
 return distinctBoundSources(bindings.flatMap(binding=>binding.sources))
}
function actionAuthoritySources(action:any):BoundCoachSource[]{
 const requests=actionRequestAuthoritySources(action)
 if(action.material_revision_modern===true&&!requests.length)return []
 if(action.field_sources_present!==true)return requests
 const fields=actionFieldAuthoritySources(action.exact_field_sources,action.draft)
 return fields?.length?distinctBoundSources([...requests,...fields]):[]
}
function validActionFieldSources(value:unknown,draft:unknown):ActionFieldSourceBinding[]{
 if(!Array.isArray(value))return []
 const material=actionDraftMaterialFields(draft),used=new Set<number>(),bindings:ActionFieldSourceBinding[]=[]
 for(const candidate of value){
  if(!candidate||typeof candidate!=='object'||typeof candidate.field!=='string'||typeof candidate.value!=='string'||!Array.isArray(candidate.sources))continue
  const index=material.findIndex((field,fieldIndex)=>!used.has(fieldIndex)&&field.field===candidate.field&&field.value===candidate.value)
  if(index<0)continue
  const sources=distinctBoundSources(candidate.sources.filter((source:any)=>source&&typeof source.messageId==='string'&&typeof source.conversationId==='string'&&typeof source.quote==='string'))
  if(!sources.length)continue
  used.add(index);bindings.push({field:candidate.field,value:candidate.value,sources})
 }
 return bindings
}
const actionResponseMaterialTailSource=`(?:${responseNonActionNounSource}|[^，。；;\\n]{0,12}(?:消息|邮件|短信|文案|草稿|话术|模板|报告|说明|文档))`
const actionMaterialFieldTerms=[
 ['content',/正文|文案|内容|整段|全文|标题|语气|措辞|格式|排版/],
 ['goal',/目标(?!客户|用户|对象|群体|受众|人群|市场|院校|学校|岗位|公司)|目的(?!地)/],
 ['start',/开始(?:时间)?|起步|第一步|开头|起始/],
 ['observable',new RegExp(`判断标准|观察标准|验收标准|确认标准|可观察|回复(?!\\s*(?:的\\s*)?${actionResponseMaterialTailSource})|回应(?!\\s*(?:的\\s*)?${actionResponseMaterialTailSource})|回信(?!\\s*(?:的\\s*)?${actionResponseMaterialTailSource})|结果(?!报告|分析|说明|文档)|信号`)],
 ['effort',/投入|时长|精力|成本|工作量|用时|耗时/],
  ['stopWhen',/停止条件|结束条件|止损|何时停止|什么时候停|截止(?:时间|日期)/],
 ['materials',/材料|资料|清单/],
] as const
const actionMaterialFieldNames=actionMaterialFieldTerms.map(([field])=>field)
const actionUnprotectedText=(text:string)=>buildClauseCatalogue(text).map(unprotectedClauseText).join('；')||text
function actionMaterialFieldPreserved(text:string,terms:RegExp):boolean{
 const field=`(?:${terms.source})`,between='[^，。；;\\n]{0,6}'
 return [
  new RegExp(`(?:保持|维持|保留)${between}${field}${between}(?:不变|原样|别动|不动|不改)`),
  new RegExp(`${field}${between}(?:(?:保持|维持|保留)${between})?(?:不变|原样|别动|不动|不改)`),
  new RegExp(`(?:不要|别|无需|不用)${between}(?:把|将)${between}${field}${between}(?:改|修改|调整|替换|重写|动)`),
  new RegExp(`(?:不要|别|无需|不用)${between}(?:改|修改|调整|替换|重写|动)${between}${field}`),
  new RegExp(`${field}${between}(?:不要|别|无需|不用)${between}(?:改|修改|调整|替换|重写|动)`),
 ].some(pattern=>pattern.test(text))
}
const actionPreservationSubject=(text:string):string|null=>{
 const fields=actionMaterialFieldTerms.map(([,terms])=>terms.source).join('|')
 const explicit=new RegExp(`([^，。；;\\n]{1,32}?)的\\s*(?:${fields})`).exec(text),bare=explicit?null:new RegExp(`([^，。；;\\n]{1,32}?)(?:${fields})`).exec(text)
  const subject=(explicit?.[1]??bare?.[1]??'').replace(/^(?:(?:请|但|但是|不过|并且|同时|而且|另外|至于|对于|关于|务必|还要)\s*)*(?:(?:保持|维持|保留)\s*|(?:不要|别|无需|不用)(?:再)?(?:把|将|(?:修改|调整|替换|重写|改|动)(?:把|将)?))?/,'').trim()
 if(!subject)return null
 if(!explicit&&!/(?:行动|事项|任务|草案|方案|计划|消息|邮件|报告|文案|清单|表格|海报)(?:[A-Za-z0-9_甲乙丙丁一二三四五六七八九十]{0,12})$/.test(subject))return null
 return subject||null
}
const actionPreservationApplies=(request:string,control:string):boolean=>{
 const subject=actionPreservationSubject(control)
  if(!subject||/^(?:它|其|这|这个|这份|该|当前|本次|刚才|上述|上面)(?:个|份|条)?(?:行动|事项|任务|草案|方案|计划|消息|邮件|报告|文案|清单|表格|海报)?$/.test(subject))return true
  const existing=/^(?:现有|已有|原有)(?:的)?(行动|事项|任务|草案|方案|计划|消息|邮件|报告|文案|清单|表格|海报)$/.exec(subject)?.[1]
  if(existing&&request.includes(existing))return true
 const haystack=compactMaterialText(request),needle=compactMaterialText(subject),label=/[A-Za-z0-9_甲乙丙丁一二三四五六七八九十]/,leftBoundary=/(?:请|帮我|给我|麻烦|关于|针对|名为|(?:把|将)(?:这|这个|这份|该|当前)?|修改(?:一下)?|改写(?:一下)?|调整(?:一下)?|重写(?:一下)?|改|换)$/
 for(let index=haystack.indexOf(needle);index>=0;index=haystack.indexOf(needle,index+needle.length))if((index===0||leftBoundary.test(haystack.slice(0,index)))&&!label.test(haystack[index+needle.length]??''))return true
 return false
}
function actionEditInstruction(owner:{messageId:string;conversationId:string},content:string,candidate:ActionRequestCandidate):ActionEditControls{
 const catalogue=buildClauseCatalogue(content),requestIndex=catalogue.findIndex(clause=>candidate.range.start>=clause.start&&candidate.range.end<=clause.end),requestClause=catalogue[requestIndex],request=[candidate.governing?.quote,candidate.quote].filter(Boolean).join('；')
 const controls=catalogue.flatMap((clause,index)=>{
  if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther)return []
  const plain=unprotectedClauseText(clause).normalize('NFKC')
  const bounded=requestClause&&(clause.sentenceStart===requestClause.sentenceStart||Math.abs(index-requestIndex)===1)
  return bounded&&actionPreservationApplies(request,plain)&&actionMaterialFieldTerms.some(([,terms])=>actionMaterialFieldPreserved(plain,terms))
   ?[{plain,source:{messageId:owner.messageId,conversationId:owner.conversationId,quote:clause.text,range:{start:clause.start,end:clause.end}} as BoundCoachSource}]:[]
 })
 return {instruction:{request,preserved:[...new Set(controls.map(control=>control.plain))]},preservationSources:distinctBoundSources(controls.map(control=>control.source))}
}
function actionMaterialEditTargets(instruction:ActionEditInstruction):Set<string>{
 const text=actionUnprotectedText(instruction.request).normalize('NFKC'),controlText=[text,...instruction.preserved.map(value=>value.normalize('NFKC'))].join('；'),replacementAt=text.search(/(?:改短|缩短|精简|简短)(?:成|为)|改成|改为|换成|换为|替换(?:成|为)?|重写(?:成|为)?|加上|补上|添加|插入/)
 // Field names after the replacement verb belong to the requested output,
 // not to the set of fields the user authorized the model to mutate.
 const targetText=replacementAt<0?text:text.slice(0,replacementAt),targets=new Set<string>(),preserved=new Set<string>()
 for(const [field,terms] of actionMaterialFieldTerms){
  if(actionMaterialFieldPreserved(controlText,terms))preserved.add(field)
  if(terms.test(targetText)&&!preserved.has(field))targets.add(field)
 }
 const allowed=(fields:readonly string[])=>new Set(fields.filter(field=>!preserved.has(field)))
 const explicitWholeDraft=/(?:全部(?:字段|草案|行动)|整个(?:草案|行动)|整份(?:草案|行动))/.test(targetText)
 if(explicitWholeDraft||!targets.size&&/全部/.test(targetText))return allowed(actionMaterialFieldNames)
 const additive=/(?:加上|补上|添加|插入)([\s\S]*)/.exec(text)
 if(!targets.size&&additive){
  const direct=additive[1]!.trimStart()
  for(const [field,terms] of actionMaterialFieldTerms)if((terms.exec(direct)?.index??-1)===0&&!preserved.has(field))targets.add(field)
  if(targets.size)return targets
  return allowed(['content','materials'])
 }
 if(!targets.size&&new RegExp(actionRemovalVerbSource).test(text))return allowed(['content','materials'])
 // A field-less rewrite has historically meant the primary deliverable body.
 // It must not silently authorize model-generated metadata changes as well.
 if(!targets.size&&!preserved.has('content'))targets.add('content')
 return targets
}
function actionAdditivePayloadTerms(instruction:ActionEditInstruction):string[]{
 const tail=/(?:加上|补上|添加|插入)([\s\S]*)/.exec(instruction.request.normalize('NFKC'))?.[1]
 if(!tail)return []
 let bounded=tail.replace(/(?:这几个词|这些词|这几个字|几个字|这句话|这段话|即可|就行|就可以|进去|上去|吧|好吗)[。！!？?\s]*$/,'').replace(/^(?:一个|一条|一句|一段|一份|一些|一点|一下)/,'')
 for(const [,terms] of actionMaterialFieldTerms){
  const selector=new RegExp(`^\\s*(?:${terms.source})\\s*[：:]?`)
  if(selector.test(bounded)){bounded=bounded.replace(selector,'');break}
 }
 return actionCoordinatedPayloadTerms(bounded)
}
function actionCoordinatedPayloadTerms(bounded:string):string[]{
 const pieces:string[]=[],segmenter=new Intl.Segmenter('zh',{granularity:'word'});let piece=''
 for(const segment of segmenter.segment(bounded)){
  if(segment.segment==='、'||segment.isWordLike&&['以及','和','及'].includes(segment.segment)){
   if(piece.trim())pieces.push(piece)
   piece=''
  }else piece+=segment.segment
 }
 if(piece.trim())pieces.push(piece)
 return pieces.map(compactMaterialText).filter(value=>value.length>=2)
}
function actionRemovalPayloadTerms(instruction:ActionEditInstruction):string[]{
 // Quotation protects narrative text from becoming a request, but inside an
 // already-authorized removal instruction it is the exact payload boundary.
 // Keep request detection on the unprotected view and extract the payload
 // from the raw request so “delete \"X\"” cannot degrade into “clear field”.
 const text=instruction.request.normalize('NFKC'),verb=actionRemovalVerbSource
 const after=new RegExp(`${verb}([\\s\\S]*)`).exec(text)?.[1]?.trim(),before=new RegExp('(?:把|将)([\\s\\S]*?)'+verb).exec(text)?.[1]?.trim()
 const postVerbControl=/^(?:掉(?:一下)?|一下|下|了|掉了)?(?:即可|就行|就可以|吧|好吗)?[。！!？?\s]*$/
 let bounded=((before&&postVerbControl.test(after??'')?before:after)||before||'').split(/[，。；;\n]/,1)[0]!.replace(/(?:即可|就行|就可以|吧|好吗)[。！!？?\s]*$/,'').replace(/^(?:一个|一条|一句|一段|一份|一些)/,'')
 for(const [,terms] of actionMaterialFieldTerms){
  const selector=new RegExp(`^\\s*(?:${terms.source})(?:(?:中|里|内|里面)(?:的)?)?\\s*[：:]?`)
  if(selector.test(bounded)){bounded=bounded.replace(selector,'');break}
 }
 return actionCoordinatedPayloadTerms(bounded)
}
function actionAdditiveDirectField(instruction:ActionEditInstruction,field:string):boolean{
 const direct=/(?:加上|补上|添加|插入)([\s\S]*)/.exec(actionUnprotectedText(instruction.request).normalize('NFKC'))?.[1]?.trimStart()
 const terms=actionMaterialFieldTerms.find(([name])=>name===field)?.[1]
 return Boolean(direct&&terms&&(terms.exec(direct)?.index??-1)===0)
}
const actionRegexLiteral=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
function actionPayloadTermCounts(values:readonly string[],terms:readonly string[]):Map<string,number>{
 const payload=[...new Set(terms)].sort((left,right)=>right.length-left.length).map(actionRegexLiteral).join('|'),counts=new Map<string,number>()
 if(!payload)return counts
 for(const value of values)for(const term of value.match(new RegExp(payload,'g'))??[])counts.set(term,(counts.get(term)??0)+1)
 return counts
}
function actionAdditiveDeltaAuthorized(previous:string,next:string,terms:readonly string[]):boolean{
 const expected=Array.from(previous);let index=0,inserted=''
 for(const character of Array.from(next)){
  if(character===expected[index])index++
  else inserted+=character
 }
 if(index!==expected.length||!inserted||!terms.length)return false
 const payload=[...terms].sort((left,right)=>right.length-left.length).map(actionRegexLiteral).join('|'),bridge='(?:并且|并|同时|以及|和|及|与|再|也|还)*'
 if(!new RegExp(`^${bridge}(?:${payload})(?:${bridge}(?:${payload}))*${bridge}$`).test(inserted))return false
 const actual=inserted.match(new RegExp(payload,'g'))??[],expectedCounts=new Map<string,number>(),actualCounts=new Map<string,number>()
 for(const term of terms)expectedCounts.set(term,(expectedCounts.get(term)??0)+1)
 for(const term of actual)actualCounts.set(term,(actualCounts.get(term)??0)+1)
 return actual.length>0&&[...actualCounts].every(([term,count])=>count<=(expectedCounts.get(term)??0))
}
function actionRemovalDeltaAuthorized(previous:string,next:string,terms:readonly string[]):boolean{
 if(!terms.length)return false
 let once=compactMaterialText(previous),every=once
 for(const term of terms){
  const at=once.indexOf(term)
  if(at<0||!every.includes(term))return false
  once=once.slice(0,at)+once.slice(at+term.length)
  every=every.split(term).join('')
 }
 const result=compactMaterialText(next)
 return result===once||result===every
}
function actionAdditiveValueAuthorized(instruction:ActionEditInstruction,field:string,before:string|undefined,after:string):boolean{
 const next=compactMaterialText(after),terms=actionAdditivePayloadTerms(instruction)
 if(!next)return false
 if(before===undefined&&actionAdditiveDirectField(instruction,field)&&!terms.length)return true
 const previous=before===undefined?'':compactMaterialText(before)
 return (before===undefined||Boolean(previous))&&actionAdditiveDeltaAuthorized(previous,next,terms)
}
function actionAdditiveContextRetained(instruction:ActionEditInstruction,context:string,after:string):boolean{
 const next=compactMaterialText(after),terms=actionAdditivePayloadTerms(instruction)
 if(!next||!terms.length||actionAdditiveDeltaAuthorized('',next,terms))return false
 const payload=[...terms].sort((left,right)=>right.length-left.length).map(actionRegexLiteral).join('|')
 let matched=false
 const remainder=next.replace(new RegExp(payload,'g'),()=>{matched=true;return ''}).replace(/并且|同时|以及|和|及|与|再|也|还/g,'')
 return matched&&Array.from(remainder).length>=2&&compactMaterialText(context).includes(remainder)
}
function actionWholeDraftReplacementAuthorized(instruction:ActionEditInstruction):boolean{
 const text=actionUnprotectedText(instruction.request).normalize('NFKC'),replacementAt=text.search(/改成|改为|换成|换为|替换(?:成|为)?|重写(?:成|为)?|改写(?:成|为)?/)
 if(replacementAt<0)return false
 const targetText=text.slice(0,replacementAt)
 if(!/(?:完全|彻底|从头|全部|整个|整份)/.test(targetText))return false
 if(/(?:全部(?:字段|草案|行动)|整个(?:草案|行动)|整份(?:草案|行动))/.test(targetText))return true
 const wholeArtifact=/(?:这|该|当前|整个|整份)(?:段|份|个|条)?(?:文案|内容|草案|行动|事项|方案|计划)/
 const unscoped=targetText.replace(wholeArtifact,'')
 const fieldScoped=/正文|标题|语气|措辞|格式|排版|目标(?!客户|用户|对象|群体|受众|人群|市场|院校|学校|岗位|公司)|目的(?!地)|开始(?:时间)?|起步|第一步|开头|起始|判断标准|观察标准|验收标准|确认标准|可观察|回复|回应|回信|结果|信号|投入|时长|精力|成本|工作量|用时|耗时|停止条件|结束条件|止损|何时停止|什么时候停|材料|资料|清单|文案|内容/
 return !fieldScoped.test(unscoped)&&(wholeArtifact.test(targetText)||!fieldScoped.test(targetText))
}
function actionMaterialRemovalAuthorized(instruction:ActionEditInstruction,field:string,values:readonly string[],nextValues:readonly string[],targets:ReadonlySet<string>):boolean{
 const text=actionUnprotectedText(instruction.request).normalize('NFKC')
 const terms=actionMaterialFieldTerms.find(([name])=>name===field)?.[1],controlText=[text,...instruction.preserved.map(value=>value.normalize('NFKC'))].join('；')
 const removalRequested=targets.has(field)&&new RegExp(actionRemovalVerbSource).test(text)
 const remaining=[...nextValues],removedValues:string[]=[]
 for(const value of values){
  const index=remaining.findIndex(candidate=>sameMaterialValue(candidate,value))
  if(index>=0)remaining.splice(index,1);else removedValues.push(value)
 }
 const addedValues=remaining,removedCount=values.length-nextValues.length
 if(terms&&actionMaterialFieldPreserved(controlText,terms))return removedValues.length===0&&addedValues.length===0
 if(actionWholeDraftReplacementAuthorized(instruction))return true
 // Same-count rewrites are ordinary derived edits unless the request itself
 // is a removal. A removal may only subtract exact list occurrences; it may
 // not use the vacated slot to introduce model-generated material.
 if(!removalRequested)return removedCount<=0
 if(!removedValues.length&&!addedValues.length)return true
 const named=actionRemovalPayloadTerms(instruction)
 if(field!=='materials'&&values.length===1&&nextValues.length<=1&&named.length)return actionRemovalDeltaAuthorized(values[0]!,nextValues[0]??'',named)
 if(field==='materials'&&addedValues.length)return false
 if(named.length){
  const authorized=[...named]
  return removedValues.every(value=>{const index=authorized.findIndex(candidate=>sameMaterialValue(candidate,value));if(index<0)return false;authorized.splice(index,1);return true})&&authorized.length===0
 }
 // Naming only a field authorizes deleting that whole field, not an arbitrary
 // member of a multi-value list.
 return Boolean(terms?.test(text)&&removedValues.length===values.length&&!addedValues.length)
}
function compactTermOccurrences(value:string,term:string):number{
 if(!term)return 0
 let count=0,offset=0
 while((offset=value.indexOf(term,offset))>=0){count++;offset+=term.length}
 return count
}
function actionRemovalTermCount(fields:readonly ActionMaterialField[],field:string,term:string):number{
 const values=fields.filter(item=>item.field===field).map(item=>item.value)
 return field==='materials'?values.filter(value=>sameMaterialValue(value,term)).length:values.reduce((count,value)=>count+compactTermOccurrences(compactMaterialText(value),term),0)
}
function assertActionRemovalTermScope(previous:readonly ActionMaterialField[],next:readonly ActionMaterialField[],instruction:ActionEditInstruction,targets:ReadonlySet<string>){
 if(!new RegExp(actionRemovalVerbSource).test(actionUnprotectedText(instruction.request).normalize('NFKC')))return
 const terms=actionRemovalPayloadTerms(instruction),fields=[...new Set([...previous,...next].map(item=>item.field))]
 for(const term of terms){
  const matching=fields.filter(field=>targets.has(field)&&actionRemovalTermCount(previous,field,term)>0)
  const changed=fields.filter(field=>actionRemovalTermCount(previous,field,term)>actionRemovalTermCount(next,field,term))
  if(matching.length!==1||changed.length!==1||matching[0]!==changed[0])throw new HttpError(400,'COACH_ACTION_SOURCE_REQUIRED')
 }
}
function actionLiteralSubstitution(instruction:ActionEditInstruction):{from:string;to:string}|null{
 const match=/(?:正文|文案|内容)(?:里|中|内|里面)(?:的)?[^，。；;\n]{0,8}[“「『"]([^”」』"]+)[”」』"][^，。；;\n]{0,8}(?:改成|改为|换成|换为|替换(?:成|为)?)[^，。；;\n]{0,4}[“「『"]([^”」』"]+)[”」』"]/.exec(instruction.request.normalize('NFKC'))
 return match?.[1]&&match[2]?{from:match[1],to:match[2]}:null
}
function actionLiteralValueAuthorized(instruction:ActionEditInstruction,before:string,after:string):boolean{
 const replacement=actionLiteralSubstitution(instruction)
 if(!replacement||!before.includes(replacement.from))return false
 return sameMaterialValue(after,before.replace(replacement.from,replacement.to))||sameMaterialValue(after,before.split(replacement.from).join(replacement.to))
}
function actionTypoValueAuthorized(before:string,after:string):boolean{
 const previous=Array.from(before.normalize('NFC').trim()),next=Array.from(after.normalize('NFC').trim())
 if(previous.length!==next.length||previous.length<4)return false
 const changes=previous.flatMap((character,index)=>character===next[index]?[]:[index])
 if(changes.length!==1)return false
 const changed=changes[0]!
 return /^\p{L}$/u.test(previous[changed]!)&&/^\p{L}$/u.test(next[changed]!)
}
function actionMaterialEditScope(instruction:ActionEditInstruction,field:string,targets:ReadonlySet<string>):'additive'|'literal'|'typo'|'derived'|'replacement'|'untargeted'{
 const text=actionUnprotectedText(instruction.request).normalize('NFKC')
 if(!targets.has(field))return 'untargeted'
 const localBody=/(?:正文|文案|内容)(?:里面|里|中|内(?!容))/.test(text)
 if(localBody&&actionLiteralSubstitution(instruction))return 'literal'
 if(/错别字|错字|笔误|拼写/.test(text))return 'typo'
 if(/加上|补上|添加|插入/.test(text))return 'additive'
 // Only an explicit replacement operator or a whole-material edit can
 // release prior provenance. A local selector overrides wholesale verbs.
 const replacement=/(?:改短|缩短|精简|简短)(?:成|为)|改成|改为|改到|换成|换为|替换|重写|改写|调整(?:为|至|到)/.test(text)
 const wholeMaterial=/(?:整段|整篇|整个|整份|全部|从头|彻底|全新)/.test(text)
 const selectedArtifact=/(?:修改|调整)/.test(text)&&materialArtifactFamilies.some(([,pattern])=>new RegExp(pattern.source+'$').test(text.trimEnd()))
 if(!localBody&&(replacement||wholeMaterial||selectedArtifact))return 'replacement'
 return 'derived'
}
function projectActionFieldSources(before:unknown,after:unknown,stored:readonly ActionFieldSourceBinding[],fieldSourcesKnown:boolean,priorSources:readonly BoundCoachSource[],binding:ActionRequestBinding):ActionFieldSourceBinding[]{
 const {instruction,sources:currentSources,contentClarifications=[]}=binding
 const previous=actionDraftMaterialFields(before),nextFields=actionDraftMaterialFields(after),available=[...stored],usedStored=new Set<number>(),editTargets=actionMaterialEditTargets(instruction)
 assertActionRemovalTermScope(previous,nextFields,instruction,editTargets)
 const additiveTerms=actionAdditivePayloadTerms(instruction),previousMaterial=previous.map(field=>compactMaterialText(field.value)),nextMaterial=nextFields.map(field=>compactMaterialText(field.value))
 const expectedAdditions=actionPayloadTermCounts(additiveTerms,additiveTerms),beforeAdditions=actionPayloadTermCounts(previousMaterial,additiveTerms),afterAdditions=actionPayloadTermCounts(nextMaterial,additiveTerms)
 for(const term of new Set(additiveTerms))if((afterAdditions.get(term)??0)-(beforeAdditions.get(term)??0)!==(expectedAdditions.get(term)??0))throw new HttpError(400,'COACH_ACTION_SOURCE_REQUIRED')
 for(const field of new Set(previous.map(item=>item.field))){
  const prior=previous.filter(item=>item.field===field),next=nextFields.filter(item=>item.field===field)
  if(!actionMaterialRemovalAuthorized(instruction,field,prior.map(item=>item.value),next.map(item=>item.value),editTargets))throw new HttpError(400,'COACH_ACTION_SOURCE_REQUIRED')
 }
 const prior:(ActionFieldSourceBinding&{unowned?:true})[]=previous.flatMap(field=>{
  const index=fieldSourcesKnown?available.findIndex((binding,bindingIndex)=>!usedStored.has(bindingIndex)&&binding.field===field.field&&binding.value===field.value):-1
  if(index>=0){usedStored.add(index);return [{...available[index]!,sources:distinctBoundSources(available[index]!.sources)}]}
  if(fieldSourcesKnown)return [{...field,sources:[],unowned:true as const}]
  return priorSources.length?[{...field,sources:distinctBoundSources(priorSources)}]:[]
 })
 const usedPrior=new Set<number>()
 return nextFields.map(field=>{
  const editScope=actionMaterialEditScope(instruction,field.field,editTargets)
  const editSources=field.field==='content'?[...currentSources,...contentClarifications]:currentSources
  const candidates=prior.map((binding,index)=>({binding,index})).filter(({binding,index})=>!usedPrior.has(index)&&binding.field===field.field)
  const exact=candidates.filter(({binding})=>sameMaterialValue(binding.value,field.value))
  if(previous.length&&editScope==='untargeted'&&!exact.length)throw new HttpError(400,'COACH_ACTION_SOURCE_REQUIRED')
   const possible=exact.length?exact:editScope==='replacement'?[]:candidates.filter(({binding})=>editScope==='additive'
    ?actionAdditiveValueAuthorized(instruction,field.field,binding.value,field.value)
    :editScope==='literal'?actionLiteralValueAuthorized(instruction,binding.value,field.value)
    :editScope==='typo'?actionTypoValueAuthorized(binding.value,field.value)
    :derivedMaterialValueAuthorized(instruction,binding.value,field.value))
  if(possible.length>1)throw new HttpError(400,'COACH_ACTION_SOURCE_REQUIRED')
   let retained=possible[0]
   if(!retained&&candidates.length&&editScope!=='replacement')throw new HttpError(400,'COACH_ACTION_SOURCE_REQUIRED')
  if(!retained){
   let contextualSources:BoundCoachSource[]=[]
   if(previous.length&&editScope==='additive'&&!actionAdditiveValueAuthorized(instruction,field.field,undefined,field.value)){
    const contextual=prior.filter(binding=>binding.field===field.field&&!binding.unowned&&binding.sources.length&&actionAdditiveContextRetained(instruction,binding.value,field.value))
    if(contextual.length!==1)throw new HttpError(400,'COACH_ACTION_SOURCE_REQUIRED')
    contextualSources=contextual[0]!.sources
   }
   if(previous.length&&(editScope==='literal'||editScope==='typo'))throw new HttpError(400,'COACH_ACTION_SOURCE_REQUIRED')
   return {...field,sources:distinctBoundSources([...contextualSources,...editSources])}
  }
  if(retained.binding.unowned)throw new HttpError(400,'COACH_ACTION_SOURCE_REQUIRED')
  usedPrior.add(retained.index)
  const unchanged=sameMaterialValue(retained.binding.value,field.value)
  return {...field,sources:distinctBoundSources(unchanged?retained.binding.sources:[...retained.binding.sources,...editSources])}
 }).filter(binding=>binding.sources.length)
}
const boundSourceConsumesCandidate=(source:BoundCoachSource,candidate:{messageId:string;quote:string;start:number;end:number})=>{
 if(source.messageId!==candidate.messageId)return false
 const range=source.range
 if(range&&Number.isSafeInteger(range.start)&&Number.isSafeInteger(range.end))return range.start<candidate.end&&candidate.start<range.end
 return source.quote===candidate.quote
}
function bindActionRequest(run:Run,candidate:ActionRequestCandidate,selected?:BoundCoachSource,origin?:BoundCoachSource,controls:ActionEditControls={instruction:{request:candidate.quote,preserved:[]},preservationSources:[]}):ActionRequestBinding{
 const owner=origin??{messageId:run.source_message_id,conversationId:run.conversation_id,quote:'',range:{start:0,end:0}}
 const source=selected?{...selected,range:candidate.range}:{...owner,quote:candidate.quote,range:candidate.range}
 const governing=candidate.governing?{...owner,quote:candidate.governing.quote,range:candidate.governing.range}:null
 const sources=[...(governing?[governing]:[]),source]
 return {source,sources:[...new Map(sources.map(item=>[JSON.stringify([item.messageId,item.range?.start,item.range?.end]),item])).values()],...controls}
}
function actionCandidatesFromBoundSource(source:BoundCoachSource):ActionRequestCandidate[]{
 const offset=source.range?.start??0
 return unquotedActionRequestSources(source.quote,[]).map(candidate=>({
  ...candidate,
  range:{start:offset+candidate.range.start,end:offset+candidate.range.end},
  ...(candidate.governing?{governing:{quote:candidate.governing.quote,range:{start:offset+candidate.governing.range.start,end:offset+candidate.governing.range.end}}}:{}),
 }))
}
async function actionRequestSource(c:PoolClient,run:Run,operation:'create'|'modify',exclusions:readonly SourceExclusion[],selected?:{messageId:string;quote:string},draftContent?:string,allowViewOnly=false):Promise<ActionRequestBinding>{
  const content=await sourceContent(c,run.user_id,{messageId:run.source_message_id,conversationId:run.conversation_id,quote:''})
  if(content===null)throw new HttpError(400,'COACH_SOURCE_INVALID')
  const requests=unquotedActionRequestSources(content,exclusions)
  const material=requests.filter(candidate=>candidate.operations.includes(operation))
  const viewOnly=allowViewOnly?null:viewOnlyActionRequests(content,requests)
  const bind=(candidate:ActionRequestCandidate,bound?:BoundCoachSource)=>{
    if(viewOnly?.has(candidate))throw new HttpError(400,'COACH_ACTION_SOURCE_INVALID')
    const clarificationParts=materialClarificationSources(content,exclusions,candidate.quote,true)
    const clarification=clarificationParts.filter(part=>!part.projectedRecipient&&/(?:包括|包含|附上?|带有|内含)/.test(part.quote))
    const requestContext=[candidate.quote,...clarification.map(part=>part.quote)].join('，')
    if(draftContent&&artifactFamilyConflict(requestContext,draftContent))throw new HttpError(400,'COACH_ACTION_ARTIFACT_MISMATCH')
    const binding=bindActionRequest(run,candidate,bound,undefined,actionEditInstruction({messageId:run.source_message_id,conversationId:run.conversation_id},content,candidate))
    const clarificationSources=clarification.map(part=>({messageId:run.source_message_id,conversationId:run.conversation_id,quote:part.quote,range:part.range}))
    binding.sources=distinctBoundSources([...binding.sources,...clarificationSources])
    bindMaterialContentClarifications(binding,run,clarificationParts,draftContent)
    return binding
  }
  if(selected){
    const bound=await currentSource(c,run,selected)
    const exact=material.filter(candidate=>candidate.quote===bound.quote&&(!bound.range||candidate.range.start===bound.range.start&&candidate.range.end===bound.range.end))
    if(exact.length!==1)throw new HttpError(400,'COACH_ACTION_SOURCE_INVALID')
    return bind(exact[0]!,bound)
  }
  if(material.length!==1)throw new HttpError(400,material.length?'COACH_ACTION_SOURCE_REQUIRED':'COACH_ACTION_SOURCE_INVALID')
  return bind(material[0]!)
}
export async function validateReadOnlyCoachDraft(run:Run,operation:'create'|'modify',draft:string,source?:{messageId:string;quote:string}){
 await transaction(c=>actionRequestSource(c,run,operation,[],source,draft,true))
}
const viewOnlyDisplay='(?:只|仅)在(?:本轮|当前)?(?:回复|聊天)(?:中|里)(?:展示|显示|提供)(?:一下)?'
const viewOnlyPrefix=new RegExp(`^(?:(?:在此之后|接着|随后|然后|另外|再请|另请|请|帮我|给我|替我|直接|麻烦你?)\\s*)*(?:(?:展示|生成|写|起草|制作|附|提供)(?:一(?:份|个|段|版|套|张))?|一(?:份|个|段|版|套|张))?\\s*(?:只读|仅供(?:查看|阅读)|${viewOnlyDisplay})`)
const viewOnlyPresentation=new RegExp(`^(?:(?:在此之后|接着|随后|然后|另外|再请|另请|请|帮我|给我)\\s*)*${viewOnlyDisplay}\\s*(?<artifact>.+)$`)
const viewOnlySuffix=new RegExp(`(?:并(?:且)?|且|然后)\\s*(?:${viewOnlyDisplay}|仅供(?:查看|阅读))(?:就好|即可|就行)?$`)
const viewOnlyContinuation=new RegExp(`^(?:并(?:且)?|且|请)?\\s*(?:${viewOnlyDisplay}|仅供(?:查看|阅读))(?:就好|即可|就行)?$`)
function viewOnlyActionRequests(text:string,requests:readonly ActionRequestCandidate[]){
 const visible=new Map<ActionRequestCandidate,string[]>()
 if(!/只读|仅供|(?:只|仅)在/.test(text))return visible
 const catalogue=buildClauseCatalogue(text)
 const fieldList=/(?:字段|表头|列名)\s*(?:包括|包含|为|是|[:：])\s*(.+)$/
 for(const [index,request] of requests.entries()){
  const clauseIndex=catalogue.findIndex(clause=>request.range.start>=clause.start&&request.range.end<=clause.end)
  const clause=catalogue[clauseIndex]
  if(!clause)continue
  const plain=unprotectedClauseText(clause).slice(request.range.start-clause.start,request.range.end-clause.start).trim()
  const nextRequestStart=requests[index+1]?.range.start??Infinity
  const owned=(part:typeof clause)=>part.start<nextRequestStart&&!part.quoted&&!part.code&&!part.conditional&&!part.attributedToOther&&!part.interrogative
  let last=clauseIndex,fieldSpec=fieldList.exec(plain)?.[1]??''
  // A directly adjacent field list may be a separate sentence. Its list
  // items stay in that sentence and end before any independent request.
  const next=catalogue[last+1]
  if(request.range.end===clause.end&&next&&owned(next)&&fieldList.exec(unprotectedClauseText(next).trimStart())?.index===0){
   do{last++}while(catalogue[last+1]?.sentenceStart===next.sentenceStart&&owned(catalogue[last+1]!))
   fieldSpec=fieldList.exec(text.slice(next.start,Math.min(catalogue[last]!.end,nextRequestStart)))?.[1]??''
  }
  const following=catalogue[last+1]
  const onlyDisplay=following&&owned(following)&&request.range.end===clause.end&&viewOnlyContinuation.test(unprotectedClauseText(following).trim())
  if(!viewOnlyPrefix.test(plain)&&!viewOnlySuffix.test(plain)&&!viewOnlySuffix.test(fieldSpec)&&!onlyDisplay)continue
  const fields=fieldSpec.replace(viewOnlySuffix,'').replace(/的(?:模板|表格|记录表)$/,'').split(/[、，,]|和|及/)
   .map(field=>compactMaterialText(field)).filter(field=>/^[\p{L}\p{N}]{1,32}$/u.test(field))
  visible.set(request,fields)
 }
 return visible
}
export function coachMaterialVisibility(text:string){
 const requests=unquotedActionRequestSources(text,[]),viewOnly=viewOnlyActionRequests(text,requests)
 return {viewOnly:[...viewOnly].map(([request,requiredFields])=>({...request,requiredFields})),writable:requests.filter(request=>!viewOnly.has(request)),allReadOnly:viewOnly.size>0&&viewOnly.size===requests.length}
}
export function readOnlyCoachMaterial(text:string,selectedQuote?:string){
 const visibility=coachMaterialVisibility(text)
 return selectedQuote===undefined?visibility.allReadOnly:visibility.viewOnly.some(request=>request.quote===selectedQuote)&&!visibility.writable.some(request=>request.quote===selectedQuote)
}
export function viewOnlyDraftComplete(request:{quote:string;requiredFields:readonly string[]},body:string){
 if(!body.trim()||artifactFamilyConflict(request.quote,body))return false
 if(!request.requiredFields.length&&!/(?:记录|登记|填写)(?:模板|表)|空白表|核对表|填写表/.test(request.quote))return true
 const slots=body.matchAll(/(?:^|[\n；;])\s*(?:[-*]\s*)?(?:\*\*)?(?<label>[\p{L}\p{N}][^\n：:，,。！？]{0,36})[:：][ \t]*(?:\*\*[ \t]*)?(?:_{2,}|待填|\[|【|[（(](?:填|输入)|(?=\r?$))/gmu)
 const table=/^(?<header>\|[^\r\n]+)\r?\n\s*\|(?:\s*:?-+:?\s*\|)+/mu.exec(body)?.groups?.header
 const labels=new Set([...Array.from(slots,slot=>slot.groups!.label!),...(table?.split('|')??[])].map(field=>compactMaterialText(field).toLowerCase()).filter(Boolean))
 return labels.size>0&&request.requiredFields.every(field=>labels.has(compactMaterialText(field).toLowerCase()))
}
async function revalidateActionRequestBinding(c:PoolClient,run:Run,binding:ActionRequestBinding,selected?:{messageId:string;quote:string}):Promise<ActionRequestBinding>{
  if(selected&&(selected.messageId!==binding.source.messageId||selected.quote!==binding.source.quote))throw new HttpError(400,'COACH_ACTION_SOURCE_INVALID')
  const sources:BoundCoachSource[]=[]
  for(const source of binding.sources){
    if(!await sourceCurrent(c,run.user_id,source))throw new HttpError(400,'COACH_ACTION_SOURCE_INVALID')
    sources.push(source)
  }
  const exact=sources.find(source=>source.messageId===binding.source.messageId&&source.quote===binding.source.quote&&source.range?.start===binding.source.range?.start&&source.range?.end===binding.source.range?.end)
  if(!exact)throw new HttpError(400,'COACH_ACTION_SOURCE_INVALID')
  const preservationSources:BoundCoachSource[]=[]
  for(const source of Array.isArray(binding.preservationSources)?binding.preservationSources:[])if(await sourceCurrent(c,run.user_id,source))preservationSources.push(source)
  const preserved=preservationSources.flatMap(source=>buildClauseCatalogue(source.quote).map(unprotectedClauseText))
    .filter(value=>actionMaterialFieldTerms.some(([,terms])=>actionMaterialFieldPreserved(value.normalize('NFKC'),terms)))
  for(const source of binding.contentClarifications??[])if(!await sourceCurrent(c,run.user_id,source))throw new HttpError(400,'COACH_ACTION_SOURCE_INVALID')
  return {...binding,source:exact,sources,instruction:{...binding.instruction,preserved:[...new Set(preserved)]},preservationSources:distinctBoundSources(preservationSources)}
}
async function inheritedActionRequestSource(c:PoolClient,run:Run,sourceMessageId:string,bindings:CoachEventSourceBindings,operation:'create'|'modify',selected:undefined|{messageId:string;quote:string;range?:{start:number;end:number}},draftContent:string|undefined,currentExclusions:readonly SourceExclusion[]):Promise<ActionRequestBinding>{
 const origins=[...bindings.processSources,...bindings.pendingActionRequestSources].filter(source=>source.messageId===sourceMessageId)
 const candidates=[...new Map(origins.map(source=>[JSON.stringify([source.messageId,source.range?.start??null,source.range?.end??null,source.quote]),source])).values()].flatMap(origin=>actionCandidatesFromBoundSource(origin).map(candidate=>({candidate,origin})))
 const material=candidates.filter(({candidate})=>candidate.operations.includes(operation))
 let chosen:{candidate:ActionRequestCandidate;origin:BoundCoachSource}|undefined
 if(selected){
  const exact=material.filter(({candidate,origin})=>origin.messageId===selected.messageId&&candidate.quote===selected.quote&&(!selected.range||candidate.range.start===selected.range.start&&candidate.range.end===selected.range.end))
  if(exact.length!==1)throw new HttpError(400,'COACH_ACTION_SOURCE_INVALID')
  chosen=exact[0]
 }else{
  if(material.length!==1)throw new HttpError(400,material.length?'COACH_ACTION_SOURCE_REQUIRED':'COACH_ACTION_SOURCE_INVALID')
  chosen=material[0]
 }
 const originContent=await sourceContent(c,run.user_id,{messageId:chosen!.origin.messageId,conversationId:chosen!.origin.conversationId,quote:''})
 if(originContent===null)throw new HttpError(400,'COACH_ACTION_SOURCE_INVALID')
 const inheritedViewOnly=coachMaterialVisibility(originContent).viewOnly.some(request=>request.range.start===chosen!.candidate.range.start&&request.range.end===chosen!.candidate.range.end)
 if(inheritedViewOnly)throw new HttpError(400,'COACH_ACTION_SOURCE_INVALID')
 const controls=actionEditInstruction({messageId:chosen!.origin.messageId,conversationId:chosen!.origin.conversationId},originContent,chosen!.candidate)
 const current=await sourceContent(c,run.user_id,{messageId:run.source_message_id,conversationId:run.conversation_id,quote:''})
 if(current===null)throw new HttpError(400,'COACH_SOURCE_INVALID')
 const clarificationParts=materialClarificationSources(current,currentExclusions,chosen!.candidate.quote,true)
 const nestedClarificationParts=clarificationParts.filter(part=>!part.projectedRecipient&&/(?:包括|包含|附上?|带有|内含)/.test(part.quote))
 const requestContext=[chosen!.candidate.quote,...nestedClarificationParts.map(part=>part.quote)].join('，')
 if(draftContent&&artifactFamilyConflict(requestContext,draftContent))throw new HttpError(400,'COACH_ACTION_ARTIFACT_MISMATCH')
 const binding=bindActionRequest(run,chosen!.candidate,undefined,chosen!.origin,controls)
 const clarification=nestedClarificationParts.map(part=>({messageId:run.source_message_id,conversationId:run.conversation_id,quote:part.quote,range:part.range}))
 binding.sources=distinctBoundSources([...binding.sources,...clarification])
 bindMaterialContentClarifications(binding,run,clarificationParts,draftContent)
 return binding
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
const materialArtifactObjectSource='(?:消息|邮件|短信|文案|草稿|话术|计划|清单|简历|作品集|文档|表格|方案|提纲|报告|海报|模板|核对表)'
const requestIntent=new RegExp(`(?:帮我|请(?!教)|给我|能不?能|可不可以|直接|麻烦)[^。！？\\n]{0,16}?${materialCreateVerbSource}|(?:帮我|请(?!教)|给我|能不?能|可不可以|直接|麻烦)[^。！？\\n]{0,16}?做[^。！？\\n]{0,8}${materialArtifactObjectSource}|(?:想要?|打算|需要|可以|先)[^。！？\\n]{0,16}?${materialCreateVerbSource}|(?:想要?|打算|需要|可以|先)[^。！？\\n]{0,16}?做[^。！？\\n]{0,8}(?:${materialArtifactObjectSource}|一(?:句|段|份|条))|${standaloneMaterialCreateVerbSource}一(?:句|段|份|条|个|张|套)|给我一(?:句|条|段)|发一(?:句|条|段)|怎么(?:说|回|开口|问|写|表述|措辞)`)
const rewriteIntent=new RegExp(`(?:再|稍微)?(?:改|换|缩短|改短|精简|简短|润色|重写|调整|${actionRemovalVerbSource}|加上|补上|加一|短一点|语气|措辞)`)
function completedRewriteNarration(text:string,rewrite:RegExpExecArray|null){
 if(!rewrite)return false
 if(completedObjectFrontedModifyNarration.test(text.trim()))return true
 const before=text.slice(0,rewrite.index),after=text.slice(rewrite.index+rewrite[0].length)
 const selfBefore=/(?:^|[，,；;])\s*(?:我|本人)[^，,。！？!?；;\n]{0,48}$/.test(before)
 const confirmedSelfBefore=/(?:^|[，,；;])\s*(?:请|麻烦)?(?:确认|核实|核对|记录|说明|检查|看看)(?:一下)?(?:我|本人)[^，,。！？!?；;\n]{0,48}$/.test(before)
 const completedBefore=new RegExp(`${actionPastMarkerSource}(?:(?:又|也|就|都|先|直接|彻底)\\s*)*$`).test(before)
 const completedObjectFronted=new RegExp(`(?:我|本人)${actionPastMarkerSource}(?:把|将)[^，,。！？!?；;\\n]{1,48}$`).test(before)
 const completedAfter=/^\s*(?:了|过)/.test(after)||/(?:了|过)\s*$/.test(after)
 return completedBefore&&/(?:我|本人)/.test(before)||completedObjectFronted||(selfBefore||confirmedSelfBefore)&&completedAfter
}
const directTransformIntent=/(?:^|现在想|我想)把[^。！？\n]{1,36}(?:压成一(?:句|段)|写成一(?:句|段)|问题改成[:：])|(?:^|现在想|我想)把[^。！？\n]{0,24}(?:消息|邮件|短信|文案|草稿|问题|简历|描述)[^。！？\n]{0,12}(?:改短|缩短|润色|重写|改成一(?:句|段)(?!时间))/
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
const materialVerb=new RegExp(`(?:${coordinatedMaterialCreateVerbSource}|${materialModifyVerbSource}|加上|加一|压成|联系|联络|沟通)`)
// A bare 别 is a command only when it introduces a material/contact verb.
// Narrative nouns such as 别的发送方式 must not become a lasting stop request.
const negativeRequest=new RegExp('(?:不要|不用|不必|不想|不需要|无需|别(?=(?:再|先|帮我|替我|给我)*'+materialVerb.source+')|暂不|先不|^不)')
export function materialRequest(text:string,operation:'create'|'modify'):'requested'|'declined'|'unspecified'{
  // A declined request contains the same verbs as an affirmative one. Evaluate
  // clauses separately so "不用写长邮件，帮我写一句" keeps its positive
  // request without treating "不要帮我写，只想聊聊" as permission.
  let requested=false,declined=false
  const readOnlyProse=profileWritesDisallowed(text)
  for(const clause of text.split(/[，,。！？!?；;\n]/)){
    // A read-only explanation of a topic is the reply itself. Opening an
    // artifact workspace here generated long event metadata that the explicit
    // no-write boundary would discard. Named artifacts and rewrites retain
    // their original delivery contract (说明书/情况说明/分析报告 included).
    if(readOnlyProse&&(/^(?:请|麻烦)?(?:帮我|给我)?写(?:一[份段篇个])?(?:(?:完整|详细|清楚|可读|简短|深入|的|、)|\s)*(?:说明|解释|分析|比较)(?=[:：]|$)/.test(clause.trim())
      ||!framingIntent.test(text)&&/^(?:请|麻烦)?(?:帮我|给我)?(?:完整|详细|清楚|深入|系统地?)*写(?:一[份段篇个])?[^。！？\n]{0,140}(?:比较|对比|分析|解释)[^。！？\n]{0,140}的(?:说明|解释|分析|比较)$/.test(clause.trim())))continue
    if(/^\s*(?:我)?(?:想|打算|希望)(?:先)?做(?:一个|个)(?:校园产品|校园项目|产品|项目)\s*$/.test(clause))continue
    // The person's own work and requests for editorial advice are context.
    // Keep a separate explicit instruction to write or revise.
    const plain=clause.trim()
    const selfOwnedWork=jointPersonalActorClause(plain)
      ||/^(?:[^，。！？\n]{0,12}(?:前|时|后|今晚|晚上|今天))?(?:我|本人)(?:自己|也|还)*(?:能|可以|会)(?:改|写|补|做|发|整理)/.test(plain)
      ||/^(?:我|本人)(?:想|打算|准备|计划|决定)(?:先|自己|亲自)*(?:把|将)[^。！？\n]{1,60}(?:问清楚|问明白|写完|写好|改完|做完|发出去)$/.test(plain)
    const editorialAdvice=/^(?:你|您)(?:会|建议|觉得|认为)(?:优先|先)?(?:怎么|如何|怎样)(?:改|换|补|调整)/.test(plain)
    if((selfOwnedWork||editorialAdvice)&&!/(?:请(?:你|您|直接)|帮我|替我|给我|麻烦(?:你|您))/.test(plain))continue
    // Looking up a response state is not a request to author a response.
    // Keep this at the shared intent boundary used by every material path.
    const directedResponse=directedResponseOperationAfterLookup(clause)
    // A judgment about whether replying is appropriate is not itself a reply
    // instruction. Generic request wording (for example `请判断...回复`)
    // must not override that epistemic intent; only a later, separately
    // directed response operation can do so.
    if(directedResponse){requested=true;continue}
    // Remove only the epistemic operation. A clause may separately request a
    // different deliverable (分析回复风险并写一份报告); skipping the whole
    // clause would lose that explicit request, while keeping the judgment
    // text would misread its embedded 回复 as permission to communicate.
    const requestView=materialAuthorizingView(clause)
    if(operation==='create'&&coordinatedArtifactHead.test(viewOnlyPresentation.exec(requestView.trim())?.groups?.artifact??'')){requested=true;continue}
    const request=requestIntent.exec(requestView)
    const narratedRequest=request&&/^(?:了|过)/.test(requestView.slice(request.index+request[0].length))&&!/帮我|请|给我|麻烦|能不?能|可不可以/.test(request[0])
    const directTransform=directTransformIntent.exec(requestView.trim())
    const rewrite=operation==='modify'?rewriteIntent.exec(requestView):null
    const narratedRewrite=completedRewriteNarration(requestView,rewrite)
    if([narratedRequest?null:request,narratedRewrite?null:rewrite,directTransform].some(match=>match&&!negativeRequest.test(requestView.slice(0,match.index+match[0].length))))requested=true
    const negative=negativeRequest.exec(requestView)
    if(negative&&materialVerb.test(requestView.slice(negative.index+negative[0].length)))declined=true
  }
  return requested?'requested':declined?'declined':'unspecified'
}
export function deliverableIntent(text:string,operation:'create'|'modify'){
  return materialRequest(text,operation)==='requested'
}
function scopedMaterialRequest(text:string,operation:'create'|'modify',exclusions:readonly SourceExclusion[]){
  return materialRequest(exclusions.length?unquotedRequestParts(text,exclusions).join('。'):text,operation)
}
export function effectiveMaterialRequest(text:string,operation:'create'|'modify',event:CoachEvent|null,bindings?:CoachEventSourceBindings,exclusions:readonly SourceExclusion[]=[]){
  const currentDisposition=scopedMaterialRequest(text,operation,exclusions)
  let disposition=currentDisposition
  let inheritedSource:{messageId:string;conversationId:string;quote:string;range?:{start:number;end:number}}|undefined
  const existingActions=event?.actions.filter(action=>action.status!=='stale')??[]
  const inheritedFromFragments=(fragments:readonly BoundCoachSource[])=>{
    const previous=materialRequest(fragments.map(source=>source.quote).join('\n'),operation)
    if(previous!=='requested')return {previous}
    const candidates=fragments.flatMap((origin,originIndex)=>actionCandidatesFromBoundSource(origin)
      .filter(candidate=>candidate.operations.includes(operation))
      .map(candidate=>({messageId:origin.messageId,conversationId:origin.conversationId,quote:candidate.quote,originIndex,start:candidate.range.start,end:candidate.range.end})))
    const unique=[...new Map(candidates.map(candidate=>[JSON.stringify([candidate.messageId,candidate.originIndex,candidate.start,candidate.end]),candidate])).values()]
    const consumed=(candidate:typeof unique[number])=>bindings?.consumedActionRequestSources.some(source=>boundSourceConsumesCandidate(source,candidate))
      ||existingActions.some(action=>{
        const exact=bindings?.actionRequestSources.find(binding=>binding.actionId===action.id)?.source
        if(exact)return exact.messageId===candidate.messageId&&exact.quote===candidate.quote&&(!exact.range||exact.range.start===candidate.start&&exact.range.end===candidate.end)
        const sources=action.requestSources
        if(!sources?.length)return true
        const sameMessage=sources.filter(source=>source.messageId===candidate.messageId)
        if(!sameMessage.length)return false
        const exactSelections=sameMessage.filter(source=>unique.some(other=>other.messageId===source.messageId&&other.quote===source.quote))
        return exactSelections.length?exactSelections.some(source=>source.quote===candidate.quote):true
      })
    const available=unique.filter(candidate=>!consumed(candidate))
    const clarified=available.filter(candidate=>materialClarificationSources(text,exclusions,candidate.quote,true).length>0)
    return {previous,selected:clarified.length===1?clarified[0]:available.length===1?available[0]:undefined,allConsumed:unique.length>0&&!available.length}
  }
  if(disposition==='unspecified'&&event){
    for(const turn of [...bindings?.processTurns??event.processTurns??[]].reverse()){
      const fragments=bindings?[...bindings.processSources.filter(source=>source.messageId===turn.sourceMessageId),...bindings.nodeSources.filter(node=>turn.nodeIds.includes(node.nodeId)).map(node=>node.source)]:[...turn.inputSources??[],...event.nodes.filter(node=>turn.nodeIds.includes(node.id)&&node.source).map(node=>node.source!)]
      const {previous,selected,allConsumed}=inheritedFromFragments(fragments as BoundCoachSource[])
      if(previous==='unspecified')continue
      if(selected){
        disposition=previous
        inheritedSource={messageId:selected.messageId,conversationId:selected.conversationId,quote:selected.quote,range:{start:selected.start,end:selected.end}}
        break
      }
      if(allConsumed){disposition='unspecified';continue}
      disposition=previous
      break
    }
    if(disposition==='unspecified'&&bindings?.pendingActionRequestSources.length){
      const {previous,selected}=inheritedFromFragments(bindings.pendingActionRequestSources)
      if(previous==='requested'&&selected){
        disposition=previous
        inheritedSource={messageId:selected.messageId,conversationId:selected.conversationId,quote:selected.quote,range:{start:selected.start,end:selected.end}}
      }
    }
  }
  // A later clarification may fulfill one still-unused request. Once an
  // action already binds that exact source, the same old wording cannot grant
  // permission for another unsolicited rewrite on an unrelated feedback turn.
  const inheritedActionRequest=disposition==='requested'&&currentDisposition==='unspecified'&&Boolean(event)&&Boolean(inheritedSource)
    &&(operation==='modify'||!existingActions.some(action=>action.status==='proposed'))
  return {disposition,inheritedSourceMessageId:inheritedSource?.messageId,inheritedSource,inheritedActionRequest}
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
    return /^(?:请)?(?:直接|马上|现在)(?:帮我|给我|替我)?(?:写|起草|拟|做|制作|生成|设计|画|产出|整理|改写|润色)/.test(clause)
      ||/^(?:请)?(?:直接|马上|现在)给我一(?:句|段|份|条)/.test(clause)
      ||clause.startsWith('直接起草')||clause.startsWith('请直接起草')
      ||/^(?:请)?(?:先)?(?:帮我|给我|替我)(?:写|起草|拟|做|整理)[^。！？]{0,60}(?:模板|空白表|核对表|填写表)/.test(clause)
      ||/^(?:请)?(?:先|只|再)?(?:帮我|给我|替我)(?:写|起草|拟|改写|润色)[^。！？]{0,60}(?:消息|邮件|短信|文案|草稿|问题|简历|作品描述|(?:本人|个人|我的)?贡献描述|介绍)/.test(clause)
      ||directTransformIntent.test(clause)
  })
}

export function requestsMaterialRewrite(text:string){
 return scanUserClauses(text).some(part=>{
  if(part.quoted||part.code||part.conditional||part.interrogative||part.attributedToOther)return false
  const transform=directTransformIntent.exec(part.text)?.[0]
  const priorReference=/^(?:现在想|我想)?把(?:我)?(?:刚才|刚刚|上面|上述|上次|之前|原来|原文|[这那](?:段|句|封)|该)/.test(part.text)
  return Boolean(transform&&(/(?:改成一(?:句|段)|改短|缩短|润色|重写)$/.test(transform)||priorReference&&/(?:压成|写成)一(?:句|段)$/.test(transform))&&materialRequest(part.text,'modify')==='requested')
 })
}

// The same source/duplicate decision is used at staging and at commit. A
// swallowed stale quote is allowed only when the current input is fully covered;
// chatter and short constraints may instead be retained by process inputSources.
async function coachNodeSource(c:PoolClient,run:Run,eventId:string|undefined,node:NonNullable<EventDelta['nodes']>[number],newQuotes:string[]):Promise<BoundCoachSource|null>{
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
const ignoredUnknownTopicTerms=new Set(['当时','现在','什么','为什么','什么时候','何时','是否','有没有','能否','具体','细节','问题','事情','选择','这个','这件','那件','告诉','回答','说明','解释','本人','用户','对方','需要','仍然','如何','多少','哪一','部分','下一步','调整','影响','怎样'])
const unknownSegmenter=new Intl.Segmenter('zh',{granularity:'word'})
const unknownWordSegments=(text:string)=>[...unknownSegmenter.segment(text)].filter(item=>item.isWordLike).map(item=>item.segment)
const unknownTopicTerms=(text:string)=>new Set(unknownWordSegments(text).filter(term=>term.length>=2&&!ignoredUnknownTopicTerms.has(term)))
function withdrawnQuestionTools(refs:readonly SourceControlRef[]){
 const names=new Set<string>(),useObjects=new Set<string>()
 for(const ref of refs)for(const clause of scanUserClauses(ref.quote.normalize('NFKC'))){
  if(clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.attributedToOther||clause.quoteSpans.length||clause.codeSpans.length)continue
  const text=clause.text.toLowerCase().replace(/\s+/g,' ')
  for(const usage of text.matchAll(/(?:使用|操作|(?<![使采适利作应沿运])用)(?:了|过)?\s*/gu)){
   const object=text.slice(usage.index+usage[0].length)
   const latin=/^[a-z][a-z0-9_.+#-]*(?: [a-z0-9][a-z0-9_.+#-]*)*/u.exec(object)?.[0]
   const explicitHan=/^[\p{Script=Han}]{2,18}?(?:软件|工具|系统|平台)/u.exec(object)?.[0]
   if(latin)names.add(latin)
   if(explicitHan)names.add(explicitHan)
   if(/^\p{Script=Han}/u.test(object))useObjects.add(object)
  }
 }
 return {names,useObjects}
}
const hasToolName=(text:string,term:string)=>{
 const normalized=text.normalize('NFKC').replace(/\s+/g,' ')
 if(/\p{Script=Han}/u.test(term)){
  const words=unknownWordSegments(normalized.toLowerCase())
  return words.some((_,index)=>{
   let phrase=''
   for(let end=index;end<words.length&&phrase.length<term.length;end++)phrase+=words[end]
   return phrase===term
  })
 }
 const literal=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
 const matches=normalized.matchAll(new RegExp(`(?<![a-z0-9_])${literal}(?![a-z0-9_+#-])`,'giu'))
 const edition=/^ (?:\d|(?:preview|alpha|beta|insiders?|community|professional|enterprise|lts|[a-z][a-z-]* edition)\b)/i
 return Array.from(matches).some(match=>!edition.test(normalized.slice(match.index!+match[0].length)))
}
function questionToolTerms(question:string,withdrawn:ReturnType<typeof withdrawnQuestionTools>){
 const terms=[...withdrawn.names].filter(term=>hasToolName(question,term))
 // A bare Chinese object is relevant to legacy fallback only when the
 // question itself asks about its use. A publication-date question cannot
 // be withdrawn merely because a report once used the same document.
 const view=deicticQuestionView(question).normalize('NFKC')
 const useName=/^([\p{Script=Han}]{2,18}?)(?=(?:是否|能否)(?:用于|用来))/u.exec(view)?.[1]
   ??/^(?:本次|这次)?(?:是否|有没有|能否)(?:实际)?(?:使用|用|操作)(?:过|了)?([\p{Script=Han}]{2,18})(?=[?？]|$)/u.exec(view)?.[1]
 if(useName&&[...withdrawn.useObjects].some(object=>object.startsWith(useName)&&hasToolName(object,useName)))terms.push(useName)
 return terms
}
function questionUsesWithdrawnTerm(question:unknown,withdrawn:{terms:string[];hasSurvivingUse:(term:string)=>boolean},bindings:readonly any[],unavailable:(source:BoundCoachSource)=>boolean):boolean{
 if(typeof question!=='string')return false
 const {terms}=withdrawn
 if(!terms.length)return false
 // Keep a derived question only when its own surviving source supports the
 // withdrawn subject. A matching word elsewhere in the matter is no proof.
 const liveQuotes:string[]=[]
 for(const binding of bindings){
  if(binding?.question!==question||!Array.isArray(binding.sources))continue
  const sources=binding.sources.filter((source:BoundCoachSource)=>source&&typeof source.quote==='string'&&!unavailable(source))
  if(binding.sourceRequirement==='all'&&sources.length!==binding.sources.length)continue
  if(sources.some((source:BoundCoachSource)=>questionConfiguresActionIdentity(question,source)))return false
  for(const source of sources)liveQuotes.push(source.quote)
 }
 return terms.some(term=>!liveQuotes.some(quote=>hasToolName(quote,term))&&!withdrawn.hasSurvivingUse(term))
}
function sourceFullyControlled(messageId:string,content:string,refs:readonly SourceControlRef[]):boolean{
 const covered=refs.filter(ref=>ref.messageId===messageId).flatMap(ref=>sourceControlRanges(content,ref))
 return covered.length>0&&scanUserClauses(content).every(clause=>covered.some(range=>range.start<=clause.start&&range.end>=clause.end))
}
function questionSourceControls(titleSource:BoundCoachSource|undefined,sources:readonly (BoundCoachSource|null|undefined)[],controls:readonly SourceControlRef[],content:(messageId:string)=>string){
 return controls.filter(ref=>ref.messageId===titleSource?.messageId||sources.some(source=>source?.messageId===ref.messageId&&typeof source.quote==='string'&&sourceQuotesOverlap(content(ref.messageId),source,ref)))
}
function questionToolScopes(title:BoundCoachSource|undefined,sources:readonly (BoundCoachSource|null|undefined)[],controls:readonly SourceControlRef[],content:(messageId:string)=>string,available=content){
 const common=questionSourceControls(title,sources,controls,content)
 const origins=new Map<string,SourceControlRef[]>()
 for(const ref of controls)origins.set(ref.messageId,[...origins.get(ref.messageId)??[],ref])
 return (question:string,origin?:string)=>{
  const withdrawn=[...new Set([...common,...(origin?origins.get(origin)??[]:[])])]
   if(!withdrawn.length)return {terms:[],hasSurvivingUse:()=>false}
  const terms=questionToolTerms(question,withdrawnQuestionTools(withdrawn))
  const hasSurvivingUse=(term:string)=>{
   const supports=(ref:SourceControlRef)=>questionToolTerms(question,withdrawnQuestionTools([ref])).includes(term)
   const topics=unknownTopicTerms(question.toLowerCase())
   for(const word of unknownTopicTerms(term))topics.delete(word)
   const affinity=(quote:string)=>[...unknownTopicTerms(quote.toLowerCase())].filter(word=>topics.has(word)).length
   const withdrawnScore=Math.max(0,...withdrawn.filter(supports).map(ref=>affinity(ref.quote)))
   const distinctSubject=(text:string)=>[...text.matchAll(/(?:\b(?:different|another|separate)\s+|另(?:一)?(?:件|项|份|个)|不同的一(?:件|项|份|个))/gi)].some(match=>{
    const word=unknownWordSegments(text.slice(match.index!+match[0].length).toLowerCase())[0]
    return word!==undefined&&topics.has(word)
   })
   const ids=new Set([...(origin?[origin]:[]),...withdrawn.map(ref=>ref.messageId)])
   return [...ids].some(messageId=>{
    const text=available(messageId),refs=origins.get(messageId)??[]
    return scanUserClauses(text).some(clause=>{
     const source={messageId,quote:clause.text,range:{start:clause.start,end:clause.end}}
     if(refs.some(ref=>sourceQuotesOverlap(text,source,ref)))return false
     const candidateTerms=questionToolTerms(question,withdrawnQuestionTools([source]))
     const score=affinity(source.quote),independentOrigin=messageId===origin&&!withdrawn.some(ref=>ref.messageId===messageId)
     const differentObject=withdrawnScore>0&&distinctSubject(source.quote)&&!distinctSubject(question)
     return candidateTerms.includes(term)&&!differentObject&&(independentOrigin||score>0&&score>=withdrawnScore)
    })
   })
  }
  return {terms,hasSurvivingUse}
 }
}
const deicticQuestionView=(question:string)=>question.trim().replace(/^(?:(?:那么|所以|因此|因而|于是|然后|另外|此外|不过|但是|可是|请问|想问(?:一下)?|关于|至于|说到|谈到|针对)[，,：:\s]*)+/,'')
const deicticQuestion=(question:string)=>{
 const view=deicticQuestionView(question)
 return /^(?:它|其|上述|该(?:情况|事(?:情)?|事项)|(?:这|那)(?:(?:一)?(?:件|个)事(?:情)?|(?:个|种)情况|回事)?)[，,：:\s]*(?:会|还会|将|是否|能否|有没有|可能|怎么|如何|为什么)/.test(view)
  ||/^(?:这|那)(?:一)?(?:段|份|项|个|种|笔|条|件|次)[\p{Script=Han}]{1,6}[，,：:\s]*(?:先|接着|然后|还|会|将|是否|能否|有没有|可能|怎么|如何|为什么|该|要|安排|选择|选|做|用|留|分配)/u.test(view)
}
// Intl word segmentation can split a one-character Chinese subject from its
// predicate (药/钱/课…).  Keep only an explicit subject after bounded discourse
// filler and before a question/modal boundary; arbitrary tokens stay ignored.
const shortQuestionTopic=(question:string)=>{
 const topic=/^([\p{Script=Han}])(?=(?:要|会|还|能|该|是否|有没有|怎么|如何|为什么|可不可以|能不能))/u.exec(deicticQuestionView(question))?.[1]
 return topic&&!['这','那','它','其','该'].includes(topic)?topic:undefined
}
const distributiveQuestion=(question:string)=>/(?:各自|分别)/.test(deicticQuestionView(question))
const countedQuestionSource=(question:string)=>/(?:这|那)?(?:两个|两项|两份|两种|两笔|两条|两件)([\p{Script=Han}]{1,12}?)(?=(?:各自|分别|[，,]\s*(?:各自|分别)|(?:还|仍|也)?(?:会|将|怎么|如何|要|应该|能否|可否)|[，。；！？?\s]))/u.exec(deicticQuestionView(question))
function topicalQuestionSources(nodes:unknown,question:string):any[]|null{
 const questionTerms=unknownTopicTerms(question)
 const shortTopic=shortQuestionTopic(question)
 if(!questionTerms.size&&!shortTopic)return []
 const sourceKey=(source:any)=>JSON.stringify([source.messageId,source.conversationId??null,source.quote??null,source.range?.start??null,source.range?.end??null])
 const scores=new Map<string,{source:any;score:number}>()
 for(const node of Array.isArray(nodes)?nodes:[]){
  if(node?.status!=='active'||node?.supersededByActionCorrection||!node?.source||typeof node.content!=='string')continue
  const words=unknownWordSegments(node.content),terms=new Set(words.filter(term=>term.length>=2&&!ignoredUnknownTopicTerms.has(term)))
  const topical=[...questionTerms].filter(term=>terms.has(term)).length
  // A segmented one-character word is an actual lexical boundary. A longer
  // modifier compound (物理课/选修课) may also expose its final head, but drug
  // compounds require an actual treatment context instead of any suffix.
  const contextualShortMedicine=shortTopic==='药'&&node.content.split(/[，,。；！？]/).some((segment:string)=>{
   const nonTreatmentArtifact=/(?:采购|预算|报价|供应|库存|销售|生产|研发|配方|包装|仓储|运输|登记|管理|品牌|供应商|喷洒|施用|杀虫|灭鼠)/.test(segment)
   const directTreatment=/(?:吃|服用?|喝|停|换|煎|熬)[^，。；！？]{0,6}药|(?:遵(?:照|循)?医嘱)?用药/.test(segment)
   const prescribedTreatment=/(?:开(?:了|过)?(?:(?:[零〇一二两三四五六七八九十百0-9]+(?:天|周|月|副)|一些|一点|几副)(?:的)?)?(?:中药|西药|处方药|药)|(?:医生|大夫|医院|门诊|处方|医嘱)[^，。；！？]{0,12}开[^，。；！？]{0,8}药)/.test(segment)
   return !nonTreatmentArtifact&&(directTreatment||prescribedTreatment)
  })
  const short=Boolean(shortTopic&&(shortTopic==='药'
   ?contextualShortMedicine
   :words.some(term=>term===shortTopic||term.length>=3&&term.endsWith(shortTopic))))
  const score=topical+Number(short)
  if(!score)continue
  const key=sourceKey(node.source),prior=scores.get(key)
  if(!prior||score>prior.score)scores.set(key,{source:node.source,score})
 }
 if(!scores.size)return shortTopic||questionTerms.size&&!deicticQuestion(question)?null:[]
 const candidates=[...scores.values()]
 const best=Math.max(...candidates.map(candidate=>candidate.score))
 const winners=candidates.filter(candidate=>candidate.score===best)
 const questionView=deicticQuestionView(question)
 const countedSource=countedQuestionSource(question)
  const countedTerms=new Set(countedSource?unknownWordSegments(countedSource[1]??'').filter(term=>/[\p{L}\p{N}]/u.test(term)):[])
  // A numeric phrase authorizes multiple private sources only when it counts
  // the shared source noun itself ("这两个预算"), not a dependent object
  // mentioned nearby ("预算有两个调整").
  const countedCandidates=countedTerms.size>0?candidates.filter(candidate=>{
   const quote=typeof candidate.source?.quote==='string'?candidate.source.quote:''
   const sourceTerms=unknownTopicTerms(quote)
   return [...countedTerms].every(term=>sourceTerms.has(term))
  }):[]
  // Polite/request prefixes do not change an explicit pair into permission to
  // bind every tied private source later in the sentence.
  const explicitlyTwo=/(?:这|那)?两者/.test(questionView)
  if(countedSource)return countedCandidates.length===2?countedCandidates.map(candidate=>candidate.source):null
  if(explicitlyTwo)return candidates.length===2?candidates.map(candidate=>candidate.source):null
 if(distributiveQuestion(question)){
  return winners.length>1?winners.map(winner=>winner.source):null
 }
 // Multiple independent facts with the same best lexical evidence are
 // alternatives, not cumulative authority. Preserve none rather than let any
 // one of them keep the question alive after the intended fact is forgotten.
 const plural=/(?:两个|两项|两份|两种|两笔|两条|两件|两者|这些|它们|各自|分别)/.test(deicticQuestionView(question))
 return winners.length===1||plural?winners.map(winner=>winner.source):null
}
// A proposed artifact can share a generic noun with an event fact (for
// example, both contain “消息”).  Recipient/content/format questions configure
// that artifact, so their authority is the exact material request rather than
// whichever fact happens to share the noun.
const actionMaterialFieldQuestionShape=/(?:收件人|发送对象|接收对象|语气|措辞|长度|格式|标题|主题|附件)(?:是|用|要|应该|怎么|如何|填|写)/
const actionMaterialQuestionShape=/(?:发|发送|寄|抄送|给|写|改|用|包含|附上|放)(?:给|向|成|在)?[^，。；！？]{0,12}(?:谁|哪(?:个|一|些)?|什么|多少|几|怎么|如何|何时|什么时候)|(?:收件人|发送对象|接收对象|语气|措辞|长度|格式|标题|主题|附件)(?:是|用|要|应该|怎么|如何|填|写)/
const materialArtifactFamilies=[
 ['communication',/(?:跟进消息|消息|邮件|短信|话术)/],
 ['table',/(?:预算表|核对表|表格)/],
  ['report',/(?:报告)/],
  ['plan',/(?:计划|方案)/],
  ['document',/(?:文档|说明|提纲|简历|清单|模板)/],
 ['copy',/(?:文案|草稿|问题|作品集)/],
 ['visual',/(?:海报)/],
] as const
// "回复" is also a metric/result noun. Grant communication authority only
// when it is shaped as the requested artifact, not merely because a report
// discusses customer responses.
const replyReportObject='(?:率|比例|占比|数量|人数|次数|统计|数据|趋势|分析|情况|分布|结果|效果|状态|记录|总数|总量|汇总|报告|报表|指标)'
const replyArtifactRecipient='(?:(?:给|向)?\\s*(?!(?:的\\s*)?'+replyReportObject+')[^，。；！？?\\s]{1,24})'
const communicationReplyArtifact=new RegExp('(?:^回复(?:消息|邮件|短信|文案|草稿|模板)?$|^回复(?:一下)?'+replyArtifactRecipient+'$|(?:这|那|一|两|几|每)(?:条|段|封)?回复(?=$|[，。；！？?]|(?:发|发送|寄|抄送|给|写|改|润色|怎么|如何|要|应|该|能否|可否))|(?:写|改写|重写|修改|润色|拟|起草|生成|给我|帮我)[^，。；！？]{0,24}回复(?:一下)?(?:'+replyArtifactRecipient+')?(?:消息|邮件|短信|文案|草稿|模板)?(?:[。！？?]|$)|回复(?:消息|邮件|短信|文案|草稿|模板)(?:[。！？?]|$))')
const directedReplyArtifact=new RegExp('^(?:请(?:你)?|请帮我|帮我|麻烦(?:你)?|能不?能|可不可以|直接)\\s*回复(?:一下)?'+replyArtifactRecipient+'(?:[。！？?]|$)')
const communicationReplyRequest=(text:string)=>communicationReplyArtifact.test(text.trim())||directedReplyArtifact.test(text.trim())
const artifactFamilies=(text:string)=>{
 const families=new Set(materialArtifactFamilies.filter(([,pattern])=>pattern.test(text)).map(([family])=>family))
 if(communicationReplyRequest(text))families.add('communication')
 return families
}
const verbalArtifactMention=(family:typeof materialArtifactFamilies[number][0],text:string,start:number,end:number)=>{
 if(family!=='report')return false
 const before=text.slice(0,start),after=text.slice(end)
 return /(?:并(?:且)?|再|然后|随后|请|请你|请帮我)\s*$/.test(before)&&/^(?:一下)?(?:结果|情况|进展|状态|数据|结论|发现|问题|成果|工作|内容)(?:$|[，。；！？\s])/.test(after)
}
const requestedArtifactFamilies=(text:string)=>{
 if(communicationReplyRequest(text))return new Set(['communication'] as const)
 // Chinese deliverable compounds are head-final: in “分析预算表的报告”,
 // 报告 is the requested output while 预算表 is its subject.  Keep trailing
 // include/attachment clauses outside the head view, then select the last
 // concrete artifact mention as the output head.
 let headView=text.split(/[，,](?=\s*(?:并)?(?:包括|包含|附上?|带有|其中|内含))/,1)[0]??text
 const trailingAttachment=/(?:并(?:且)?|[，,]\s*(?:并(?:且)?)?)\s*(?:包括|包含|附上?|带有|其中|内含)/.exec(headView)
 if(trailingAttachment&&materialArtifactFamilies.some(([,pattern])=>pattern.test(headView.slice(0,trailingAttachment.index))))headView=headView.slice(0,trailingAttachment.index)
 const trailingReference=/(?:并(?:且)?|[，,]\s*(?:并(?:且)?)?)\s*(?:参考|参照|依据|结合|借鉴|对照|基于|使用)/.exec(headView)
 if(trailingReference&&materialArtifactFamilies.some(([,pattern])=>pattern.test(headView.slice(0,trailingReference.index))))headView=headView.slice(0,trailingReference.index)
 const mentions=materialArtifactFamilies.flatMap(([family,pattern])=>{
  const flags=pattern.flags.includes('g')?pattern.flags:pattern.flags+'g'
  return [...headView.matchAll(new RegExp(pattern.source,flags))]
   .map(match=>({family,start:match.index,end:match.index+match[0].length}))
   .filter(match=>!verbalArtifactMention(match.family,headView,match.start,match.end))
 })
 if(!mentions.length)return artifactFamilies(text)
 const headEnd=Math.max(...mentions.map(mention=>mention.end))
 return new Set(mentions.filter(mention=>mention.end===headEnd).map(mention=>mention.family))
}
const nestedArtifactNegation=/(?:并不是|并非|不是|没有|从未|尚未|还没|未曾|不要|不应|不该|不能|不可|不必|无需|无须|别|勿|禁止|避免|拒绝|暂不|先不|未|没|不)(?:(?!(?:但|而|却|仍|反而|应当|应该|需要|可以))[^，。；！？]){0,20}$/
const nestedArtifactConditional=/(?:如果|若|假如|倘若|除非|视情况|必要时|需要时|可以的话|可能的话)[^，。；！？]{0,24}$/
const nestedCommunicationMetric=new RegExp(`(?:跟进)?(?:消息|邮件|短信|话术)(?:的)?(?:回复|回应|反馈)?${responseNonActionNounSource}`,'g')
type CommunicationArtifactChannel='email'|'sms'
const explicitlyNestedArtifactAuthority=(text:string)=>{
 const families=new Set<typeof materialArtifactFamilies[number][0]>(),communicationChannels=new Set<CommunicationArtifactChannel>()
 for(const clause of buildClauseCatalogue(text)){
  if(clause.quoted||clause.code||clause.attributedToOther||clause.conditional)continue
  const plain=unprotectedClauseText(clause)
  for(const match of plain.matchAll(/(?:包括|包含|附上?|带有|内含)\s*([^，。；！？]{1,80})/g)){
   const prefix=plain.slice(0,match.index)
   if(nestedArtifactNegation.test(prefix)||nestedArtifactConditional.test(prefix))continue
   const nestedText=match[1]??'',communicationText=nestedText.replace(nestedCommunicationMetric,metric=>' '.repeat(metric.length))
   for(const [family,pattern] of materialArtifactFamilies){
    const subject=family==='communication'?communicationText:nestedText
    const flags=pattern.flags.includes('g')?pattern.flags:pattern.flags+'g'
    for(const occurrence of subject.matchAll(new RegExp(pattern.source,flags))){
     // Negation can follow the inclusion verb and scopes only the concrete
     // occurrence before a contrast: “并非邮件内容而是短信模板”.
     if(nestedArtifactNegation.test(nestedText.slice(0,occurrence.index)))continue
     families.add(family)
     if(family==='communication'){
      if(occurrence[0].includes('邮件'))communicationChannels.add('email')
      if(occurrence[0].includes('短信'))communicationChannels.add('sms')
     }
    }
   }
   if(!families.has('communication')&&communicationReplyRequest(communicationText)){
    const replyAt=communicationText.search(/回复/)
    if(replyAt<0||!nestedArtifactNegation.test(nestedText.slice(0,replyAt)))families.add('communication')
   }
  }
 }
 return {families,communicationChannels}
}
// A deferred delivery already has one exact authorizing request. Later turns
// may add recipient/style/format details, but an autobiographical clause is
// not material authority merely because optional fact extraction omitted it.
// This narrows sources with the same clause catalogue and artifact families;
// it does not create another fact classifier or persistence lane.
const genericMaterialClarification=/(?:^|\s)(?:语气|措辞|风格|长度|字数|格式|标题|主题|结构|章节|字段|表头|单位|重点|内容|开头|结尾|署名|落款)(?:是|用|要|按|改成|写成|填|写|放|包括|包含)?|^(?:(?:用|采用|保持)(?:正式|礼貌|客气|自然|口语|专业|严谨|温和|诚恳|直接|简短|精简|详细|活泼)(?:的)?(?:语气|措辞|风格)|(?:正式|礼貌|客气|自然|口语|专业|严谨|温和|诚恳|直接|简短|精简|详细|活泼|中文|英文|中英双语)(?:一点|一些|些|的)?)(?:一点)?$|^(?:重点|主要|内容|主题)?(?:写上|加上|包含|包括|介绍|说明|提到|放入|删掉|去掉|不要写|别写).{1,80}$/
const communicationRecipientClarification=/^(?:(?:发|发送|寄|抄送|回复|写)(?:给|向)|(?:收件人|发送对象|接收对象|称呼)(?:是|用|写|填)?)([^，。；！？]{1,40})$|^([\p{Script=Han}]{1,4}(?:老师|导师|教授|经理|客户|同学|学长|学姐|师兄|师姐|负责人|主管|先生|女士)|[A-Z][A-Za-z'-]{1,30})$/u
const tableClarification=/(?:列名|字段|表头|金额|单位|合计|总计|行|列)(?:是|用|要|按|填|写|放|包括|包含)?/
function bindMaterialContentClarifications(binding:ActionRequestBinding,run:Run,parts:ReturnType<typeof materialClarificationSources>,content?:string){
 if(!content)return
 const recipient=materialGreeting.exec(content)?.groups?.recipient
 const recipientPart=recipient?parts.find(part=>{
  const match=communicationRecipientClarification.exec(part.quote)
  return (match?.[1]??match?.[2])?.trim()===recipient
 }):undefined
 if(recipientPart)binding.instruction.recipient=recipient
 // Rendering requirements apply to the selected content even when the
 // request itself was made earlier. They do not authorize a new action.
 const rendering=parts.filter(part=>!part.projectedRecipient&&/^(?:语气|措辞|风格|格式|长度|字数).+|^(?:用|采用|保持).*(?:语气|措辞|风格|格式)$/.test(part.quote))
 binding.contentClarifications=distinctBoundSources([...rendering,...(recipientPart?[recipientPart]:[])].map(part=>({messageId:run.source_message_id,conversationId:run.conversation_id,quote:part.quote,range:part.range})))
}
function materialClarificationSources(content:string,exclusions:readonly SourceExclusion[],request:string,includeProjectedRecipient=false):{quote:string;range:{start:number;end:number};projectedRecipient?:true}[]{
 const available=unquotedRequestPartSources(content,exclusions),families=requestedArtifactFamilies(request),clauses=scanUserClauses(content)
 const namesRequestedArtifact=(text:string)=>materialArtifactFamilies.some(([family,pattern])=>families.has(family)&&pattern.test(text))
 const unrelatedRelation=(text:string)=>namesRequestedArtifact(text)&&/(?:与|和|跟|同|对)[^，。；！？]{0,32}(?:无关|不相关|没有关系|没关系)/.test(text)
 const explicitlyUnrelated=(clause:typeof clauses[number],index:number)=>{
  if(unrelatedRelation(clause.text))return true
  const next=clauses[index+1]
  // “标题是论文，与介绍邮件无关，语气正式” excludes the immediately
  // qualified title only. The relation cannot poison later sibling fields.
  return Boolean(next&&next.sentenceStart===clause.sentenceStart&&unrelatedRelation(next.text))
 }
 return clauses.flatMap((clause,index)=>{
  if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.interrogative||explicitlyUnrelated(clause,index))return []
  const text=clause.text.trim(),recipient=families.has('communication')&&communicationRecipientClarification.test(text)
  const part={quote:clause.text,range:{start:clause.start,end:clause.end}}
  if(!available.some(span=>clause.start>=span.range.start&&clause.end<=span.range.end)){
   // A known recipient may be data used in the visible greeting. A fact is
   // never a new formatting or nested-artifact directive.
   return includeProjectedRecipient&&recipient?[{...part,projectedRecipient:true}]:[]
  }
  return genericMaterialClarification.test(text)||recipient||families.has('table')&&tableClarification.test(text)?[part]:[]
 })
}
const acknowledgementReplyShape=/(?:^|[\r\n])(?:收到|好的?|明白|了解|可以|没问题)[，,:：]\s*(?:我|这边)(?:会|将|会在|将在|会于|将于|马上|尽快|按时|于|在)[^。！？\n]{1,80}(?:[。！？]|$)/
const addressedCommitmentReply=/^(?:[\r\n])?([^，。！？：:\n]{1,16})[，,]\s*[^。！？\n]{0,60}(?:我|这边)(?:会|将|会在|将在|会于|将于|马上|尽快|按时|于|在)[^。！？\n]{1,80}(?:[。！？]|$)/u
const addressedCommitmentReplyShape=(text:string)=>{
 const addressee=addressedCommitmentReply.exec(text)?.[1]?.trim()
 return Boolean(addressee&&(/^(?:您|你)$/.test(addressee)||/^[A-Z][A-Za-z'-]{1,30}$/.test(addressee)||openHumanOtherActor(addressee)))
}
const greetingCommunicationShape=/(?:^|[\r\n])(?:[\p{Script=Han}A-Za-z]{1,12})?(?:您好|你好)[，,:：]?/u
const openingRequestCommunicationShape=/(?:^|[。！？\n])(?:请问|麻烦|劳烦|方便|能否|可否|想(?:再|继续)?(?:跟进|确认|了解|问一下))/
const confirmationRequestCommunicationShape=/(?:方便|麻烦|请|能否|可否)[^。！？\n]{0,40}(?:回复|确认|告知|反馈)/
const addressedRequestCommunicationShape=/(?:^|[\r\n])[^，。！？：:\n]{1,16}[，,:：][^。！？\n]{0,80}(?:请|麻烦|烦请|劳烦|敬请|望)(?:查收|查看|回复|确认|告知|反馈)/
// A long punctuation-free report has no trustworthy synthetic sentence start.
// An explicit recipient greeting remains communication-shaped anywhere in the
// bounded window, so it cannot be hidden after the first scan window.
const embeddedRecipientGreetingShape=/(?:老师|导师|教授|经理|客户|同学|学长|学姐|师兄|师姐|负责人|主管|先生|女士|[\p{Script=Han}]{2,4}|[A-Z][A-Za-z'-]{1,30})(?:您好|你好)[，,:：]/u
const boundedCommunicationSegments=(text:string)=>text.split(/\r?\n/).flatMap(line=>{
 const value=line.trim(),sentences:string[]=[]
 let start=0
 for(let index=0;index<value.length;index++)if(/[。！？!?；;]/.test(value[index]!)){
  const sentence=value.slice(start,index+1).trim();if(sentence)sentences.push(sentence)
  start=index+1
 }
 const tail=value.slice(start).trim();if(tail)sentences.push(tail)
 return sentences.flatMap(sentence=>{
  const segments:string[]=[]
  // A real sentence boundary is an allowed communication start. Later
  // overlapping windows receive a non-matching prefix so bounded scanning
  // cannot fabricate a line start in the middle of report prose.
  for(let offset=0;offset<sentence.length;offset+=400)segments.push((offset?'…':'')+sentence.slice(offset,offset+500))
  return segments
 })
})
const communicationArtifactShape=(text:string,embeddedInDocument=false)=>boundedCommunicationSegments(text).some(segment=>greetingCommunicationShape.test(segment)||embeddedRecipientGreetingShape.test(segment)||addressedRequestCommunicationShape.test(segment)||acknowledgementReplyShape.test(segment)||addressedCommitmentReplyShape(segment)||!embeddedInDocument&&(openingRequestCommunicationShape.test(segment)||confirmationRequestCommunicationShape.test(segment)))
function draftArtifactShape(text:string){
 const families=artifactFamilies('')
 const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean)
 const prose=text.trim()
 const protectedSpans=scanUserClauses(prose).flatMap(clause=>[...clause.quoteSpans,...clause.codeSpans])
 const unprotectedProse=prose.split('').map((char,index)=>protectedSpans.some(span=>index>=span.start&&index<span.end)?' ':char).join('').trim()
 const markdownRows=lines.filter(line=>/^\|.*\|$/.test(line))
 const markdownDivider=lines.some(line=>/^\|?(?:\s*:?-{3,}:?\s*\|){1,}\s*:?-{3,}:?\s*\|?$/.test(line))
 const budgetColumns=lines.some(line=>/(?:项目|用途|科目).{0,12}(?:金额|费用|预算)|(?:金额|费用|预算).{0,12}(?:项目|用途|科目)/.test(line))
 const explicitTableHeading=lines.some(line=>/^(?:预算表|核对表|[^：:\s]{0,16}表格)(?:$|[（(：:])/.test(line))
 const splitTableFields=lines.some(line=>/^(?:项目|用途|科目)[：:]/.test(line))&&lines.some(line=>/^(?:金额|费用|预算)[：:]/.test(line))
 const structuredFieldLine=/^(?:标题|主题|摘要|背景|目的|问题|结论|建议|步骤|目标|正文|收件人|称呼)[：:]/
 const greeting=materialGreeting.exec(unprotectedProse)
 const structuredBody=lines.slice(1).some(line=>structuredFieldLine.test(line)),headingFamilies=lines[0]?artifactFamilies(lines[0]):artifactFamilies('')
 const structuredDocument=structuredBody&&headingFamilies.size>0
 const explicitDocumentHeading=lines.length>1&&!greeting?.groups?.heading&&/^(?:[\p{Script=Han}A-Za-z0-9_-]{0,24})?(?:报告|计划|方案|说明|提纲|简历|清单|模板|预算表|核对表|表格)$/u.test(lines[0]??'')
 const reportSectionLine=/^(?:摘要|背景|目的|方法|发现|结果|分析|结论|建议)[：:]/
 const headinglessStructuredReport=lines.length>1&&reportSectionLine.test(lines[0]??'')&&(markdownRows.length>=2||lines.slice(1).some(line=>reportSectionLine.test(line)))
 const singleLineStructuredReport=lines.length===1&&reportSectionLine.test(lines[0]??'')
 const reportedDialogueLine=/^(?:受访者|访谈对象|被访者|对方|参与者|同学|学生|老师|导师)(?:问|说|表示|提到|回答|反馈)(?:道|称)?[：:，,]?/
 const headedDocument=structuredDocument||explicitDocumentHeading
 const reportScopedDocument=headedDocument||headinglessStructuredReport||singleLineStructuredReport
 const communicationProse=reportScopedDocument?unprotectedProse.split(/\r?\n/).slice(headedDocument?1:0).filter(line=>!structuredFieldLine.test(line.trim())&&!((headingFamilies.has('report')||headinglessStructuredReport||singleLineStructuredReport)&&reportedDialogueLine.test(line.trim()))).join('\n').trim():unprotectedProse
 const communicationFieldValues=lines.flatMap(line=>{const match=/^(?:正文|称呼)[：:]\s*(.*)$/.exec(line),value=match?.[1]?.trim();return value&&!reportedDialogueLine.test(value)?[value]:[]})
 const communicationFields=new Set(lines.map(line=>/^(收件人|发送对象|接收对象|主题|正文|称呼)[：:]/.exec(line)?.[1]).filter(Boolean))
 if(headedDocument)for(const family of headingFamilies)families.add(family)
 if(headinglessStructuredReport||singleLineStructuredReport)families.add('report')
 if(communicationFields.size>=2&&(communicationFields.has('正文')||communicationFields.has('称呼')))families.add('communication')
 if(greeting||communicationArtifactShape(communicationProse,reportScopedDocument)||communicationFieldValues.some(value=>communicationArtifactShape(value)))families.add('communication')
 if(markdownRows.length>=2&&(markdownDivider||budgetColumns)||budgetColumns&&lines.length>=2||explicitTableHeading||splitTableFields)families.add('table')
 return {families,unprotectedProse}
}
const explicitDraftArtifactHeading=new RegExp(`^(?:(?:(?:这|那)?(?:一|两|三|四|五|六|七|八|九|十|\\d+)?(?:张|份|个|套|条|段|封)?\\s*)?${materialArtifactObjectSource}(?:正文|内容)?(?=$|\\s*(?:[：:]|[-—]|[（(]))|[^，。；！？：:\\r\\n]{1,24}?${materialArtifactObjectSource}(?:正文|内容)?(?=\\s*(?:[：:]|[-—]|[（(])))`)
const draftCommunicationArtifactChannels=(text:string)=>{
 const channels=new Set<CommunicationArtifactChannel>()
 // A section can introduce the artifact inside prose ("以下是邮件模板：").
 // A bare channel name is also a label when it starts a heading.
 const labels=/(?:^[^\S\r\n]*(?:#{1,6}[^\S\r\n]*)?(?:(?:附件|附录)[：:][^\S\r\n]*)?(?:跟进)?(邮件|短信)(?:模板|正文|内容|草稿|文案)?(?=$|[^\S\r\n]*(?:[：:]|[-—]|[（(]))|(邮件|短信)(?:模板|正文|内容|草稿|文案)(?:\*{1,2})?[^\S\r\n]*[：:])/gm
 for(const match of text.matchAll(labels)){
  channels.add((match[1]??match[2])==='邮件'?'email':'sms')
 }
 return channels
}
function artifactFamilyConflict(request:string,draft:string):boolean{
 const mentioned=artifactFamilies(request),requested=requestedArtifactFamilies(request),nestedAuthority=explicitlyNestedArtifactAuthority(request),nestedRequested=nestedAuthority.families
 const {families:produced,unprotectedProse}=draftArtifactShape(draft)
 const draftHead=draft.trim().split(/\r?\n/,1)[0]?.trim()??''
 const explicitHeading=explicitDraftArtifactHeading.exec(draftHead)
 const explicitHead=explicitHeading?requestedArtifactFamilies(explicitHeading[0]):new Set<typeof materialArtifactFamilies[number][0]>()
 const headingContent=explicitHeading?draftHead.slice(explicitHeading[0].length).replace(/^\s*(?:[：:]|[-—]|[（(])\s*/,'').replace(/[）)]\s*$/,'').trim():''
 if(headingContent)for(const family of explicitHead)produced.add(family)
 const replyRequest=communicationReplyRequest(request)
 const producedDocumentHead=[...requested].some(head=>['report','plan','document'].includes(head)&&produced.has(head))
 const nestedInRequested=(family:typeof materialArtifactFamilies[number][0])=>family==='table'&&producedDocumentHead
  ||(family==='report'||family==='plan')&&requested.has('document')&&produced.has('document')&&mentioned.has(family)
  ||family==='copy'&&requested.has('visual')&&produced.has('visual')
  ||producedDocumentHead&&nestedRequested.has(family)
 if(produced.has('communication')&&nestedAuthority.communicationChannels.size){
  const producedChannels=draftCommunicationArtifactChannels(unprotectedProse)
  if([...producedChannels].some(channel=>!nestedAuthority.communicationChannels.has(channel)))return true
 }
 if(replyRequest&&!produced.has('communication'))return true
 // A visual request has an observable structural contract. Plain prose with
 // no compatible family is not a poster merely because the model placed it in
 // the action field. Table requests retain the existing draft-first workflow.
 if(requested.has('visual')&&!produced.has('visual'))return true
 if(requested.size>0&&produced.size===0&&[...explicitHead].some(family=>!requested.has(family)))return true
 return requested.size>0&&produced.size>0&&[...produced].some(family=>!requested.has(family)&&!nestedInRequested(family))
}
function questionConfiguresActionMaterial(question:string,source:unknown):boolean{
 if(!source||typeof source!=='object'||typeof (source as any).quote!=='string'||!actionMaterialQuestionShape.test(question))return false
 const sourceQuote=(source as any).quote as string,questionFamilies=artifactFamilies(question),sourceFamilies=artifactFamilies(sourceQuote)
 if(questionFamilies.size&&![...questionFamilies].some(family=>sourceFamilies.has(family)))return false
 if(actionMaterialFieldQuestionShape.test(question)){
  if(/(?:收件人|发送对象|接收对象|附件)/.test(question))return sourceFamilies.has('communication')
  // A generic title/tone/format label may describe a persisted fact. It only
  // outranks that fact when the question itself names the compatible artifact;
  // with no topical fact, questionState still falls back to the active action.
  return questionFamilies.size>0&&sourceFamilies.size>0
 }
 const questionTerms=unknownTopicTerms(question),sourceTerms=unknownTopicTerms(sourceQuote)
 return [...questionTerms].some(term=>sourceTerms.has(term))
}
const genericActionFieldTerms=new Set(['收件人','发送对象','接收对象','语气','措辞','长度','格式','标题','主题','附件','这条','这封','这份','这个','那条','那封','那份','那个'])
function questionConfiguresActionIdentity(question:string,source:unknown):boolean{
 if(!questionConfiguresActionMaterial(question,source))return false
 const questionTerms=[...unknownTopicTerms(question)].filter(term=>!genericActionFieldTerms.has(term))
 if(!questionTerms.length)return true
 const sourceTerms=unknownTopicTerms(String((source as any).quote??''))
 return questionTerms.every(term=>sourceTerms.has(term))
}
function questionMatchesActionGroup(question:string,group:ActionQuestionGroup):boolean{
 if(questionConfiguresActionMaterial(question,group.source))return true
 // Revisions of one action are cumulative authority, not competing facts.
 // Match each exact source independently, then let questionState resolve
 // ambiguity between distinct actions rather than between one action's edits.
 return group.sources.some(source=>{
  const topical=topicalQuestionSources([{status:'active',content:String(source?.quote??''),source}],question)
  return Array.isArray(topical)&&topical.length>0
 })
}
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

async function checkDelta(c:PoolClient,run:Run,delta:EventDelta,reply:string,stagedAction?:StagedActionValidation,factProjections:readonly CoachFactProjection[]=[],pruneUnsupportedReports=false):Promise<StagedActionValidation|undefined>{
  if(!Value.Check(stagedEventSchema,delta))throw new HttpError(400,'COACH_DELTA_INVALID')
  if(delta.target.operation==='create'){
    await currentSource(c,run,delta.target.source)
    if(delta.corrections?.length||delta.resolveUnknowns?.length||delta.declineUnknowns?.length||delta.action&&delta.action.operation!=='create')throw new HttpError(400,'COACH_NEW_EVENT_TARGET_INVALID')
    if((delta.nodes??[]).some(node=>node.kind==='unknown'&&node.dependsOn?.length))throw new HttpError(400,'COACH_UNKNOWN_DEPENDENCY_INVALID')
  }else{
    const event=await eventFor(c,run.user_id,run.conversation_id,delta.target.eventId)
    if(event.revision!==delta.target.expectedRevision)throw new HttpError(409,'COACH_EVENT_REVISION_CONFLICT')
    if(!await currentCoachTitle(c,run.user_id,event))throw new HttpError(409,'COACH_SOURCE_REVOKED')
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
  for(const fact of factProjections)if(!fact.content.trim()||!await sourceCurrent(c,run.user_id,fact.source))throw new HttpError(400,'COACH_SOURCE_INVALID')
  const nodeQuotes=(delta.nodes??[]).filter(node=>node.kind!=='unknown').map(node=>node.source.quote)
  const currentNodeSources:BoundCoachSource[]=[]
  for(const node of delta.nodes??[]){
    const source=await coachNodeSource(c,run,delta.target.operation==='continue'?delta.target.eventId:undefined,node,nodeQuotes)
    if(source)currentNodeSources.push(source)
  }
  // Exclude only the selected occurrence of each validated node. A plain quote
  // would remove every identical occurrence and could erase a separate current
  // clarification which must remain in the action lineage.
  const currentExclusions:SourceExclusion[]=[...currentNodeSources,...factProjections.map(fact=>fact.source)].filter(source=>source.messageId===run.source_message_id)
  const correctionSources=await Promise.all((delta.corrections??[]).map(correction=>currentSource(c,run,correction.source)))
  const matterFactSources=[...currentNodeSources,...factProjections.map(fact=>fact.source),...correctionSources]
  const supportedReports:NonNullable<EventDelta['matterReports']>=[]
  for(const report of delta.matterReports??[]){
    if(report.state===null&&report.choice===null)throw new HttpError(400,'COACH_MATTER_REPORT_EMPTY')
    if(report.resumed&&(report.state===null||report.state==='proposed'||report.choice==='declined'||report.state==='paused'||report.state==='ended'))throw new HttpError(400,'COACH_MATTER_REPORT_TRANSITION_INVALID')
    const source=await currentSource(c,run,report.source)
    if(matterFactSources.some(fact=>fact.messageId===source.messageId&&fact.quote===source.quote&&fact.range?.start===source.range?.start&&fact.range?.end===source.range?.end))supportedReports.push(report)
    else if(!pruneUnsupportedReports)throw new HttpError(400,'COACH_MATTER_REPORT_FACT_REQUIRED')
  }
  // Only staging can omit an optional report with no controllable fact.
  // Preserve a modern empty array and recheck every retained source at commit.
  if(pruneUnsupportedReports&&delta.matterReports)delta.matterReports=supportedReports
  let inheritedActionRequest=stagedAction?.inheritedActionRequest??false
  let inheritedContext:Awaited<ReturnType<typeof readCoachEventWithSources>>|null=null
  let inheritedSourceMessageId:string|undefined
  let inheritedSource:{messageId:string;quote:string;range?:{start:number;end:number}}|undefined
  let actionBinding=stagedAction?.binding
  if(delta.action&&delta.action.operation!=='close'){
    if(!stagedAction){
      const operation=delta.action.operation==='modify'?'modify':'create'
      const current=await sourceContent(c,run.user_id,{messageId:run.source_message_id,conversationId:run.conversation_id,quote:''})
      inheritedContext=scopedMaterialRequest(current??'',operation,currentExclusions)==='unspecified'&&delta.target.operation==='continue'?await readCoachEventWithSources(c,run.user_id,run.conversation_id,delta.target.eventId):null
      const effective=effectiveMaterialRequest(current??'',operation,inheritedContext?.event??null,inheritedContext?.bindings,currentExclusions)
      inheritedActionRequest=effective.inheritedActionRequest
      inheritedSourceMessageId=effective.inheritedSourceMessageId
      inheritedSource=effective.inheritedSource
      if(effective.disposition==='declined')throw new HttpError(400,'COACH_ACTION_DECLINED')
    }
  }
  if(delta.action&&(delta.action.operation==='create'||delta.action.operation==='modify'))actionBinding=stagedAction?.binding
    ?await revalidateActionRequestBinding(c,run,stagedAction.binding,delta.action.source)
    :inheritedActionRequest&&inheritedContext&&inheritedSourceMessageId
      ?await inheritedActionRequestSource(c,run,inheritedSourceMessageId,inheritedContext.bindings,delta.action.operation,delta.action.source??inheritedSource,'content'in delta.action.draft?delta.action.draft.content:undefined,currentExclusions)
    :await actionRequestSource(c,run,delta.action.operation,currentExclusions,delta.action.source,'content'in delta.action.draft?delta.action.draft.content:undefined)
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
      const intent=inheritedActionRequest||current&&deliverableIntent(current,delta.action.operation==='modify'?'modify':'create')
      const framed=delta.action.draft.content.trim()!==reply.trim()&&coachMaterialFraming(reply.replace(delta.action.draft.content,''))
      if(!intent&&!framed)throw new HttpError(400,'COACH_MATERIAL_IS_CONVERSATION')
    }
  }
  return delta.action?{binding:actionBinding,inheritedActionRequest}:undefined
}

export async function stageCoachEvent(run:Run,delta:EventDelta,reply:string,factProjectionInputs:readonly CoachFactProjectionInput[]=[]):Promise<CoachStaged>{
  const staged:CoachStaged={delta:structuredClone(delta),reply,eventId:delta.target.operation==='create'?randomUUID():delta.target.eventId,...(delta.action?.operation==='create'?{actionId:randomUUID()}: {})}
  const sources=(value:EventDelta)=>[value.target.operation==='create'?value.target.source:null,...(value.nodes??[]).map(node=>node.kind==='unknown'?null:node.source),...(value.corrections??[]).map(node=>node.source),...(value.matterReports??[]).map(report=>report.source),value.action&&(value.action.operation==='create'||value.action.operation==='modify')?value.action.source??null:null]
  const cloned=sources(staged.delta)
  sources(delta).forEach((source,index)=>{if(source&&cloned[index])inheritSourceRange(source,cloned[index]!)})
  const validated=await transaction(async c=>{
    const factProjections:CoachFactProjection[]=[]
    for(const fact of factProjectionInputs){
      if(!fact.content.trim())throw new HttpError(400,'COACH_SOURCE_INVALID')
      // Bind the exact current-message range once; checkDelta is the single
      // availability judgment for this stage. Persist revalidates in its own
      // transaction because authority may change between stage and commit.
      factProjections.push({content:fact.content,source:bindCurrentSource(run,fact.source)})
    }
    return {factProjections,actionValidation:await checkDelta(c,run,staged.delta,reply,undefined,factProjections,true)}
  })
  if(validated.factProjections.length)staged.factProjections=validated.factProjections
  if(validated.actionValidation)staged.actionValidation=validated.actionValidation
  return staged
}

export async function persistCoachEvent(c:PoolClient,run:Run,staged:CoachStaged):Promise<CoachEvent>{
  // Called inside finishRun's transaction. Re-check everything at commit time;
  // staged validation is not authority for a later revision or memory grant.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[run.user_id+':memory-settings'])
  const delta=staged.delta
  if(delta.target.operation==='continue')await eventFor(c,run.user_id,run.conversation_id,staged.eventId,true)
  const actionValidation=await checkDelta(c,run,delta,staged.reply,staged.actionValidation,staged.factProjections)
  // Capture the pre-write visible question projection. A fact committed below
  // may retire an earlier question before the post-write read; the database
  // unknown row still needs the same resolved transition as the API view.
  const previouslyAsked=delta.target.operation==='continue'?(await readCoachEvent(c,run.user_id,run.conversation_id,staged.eventId)).asked:[]
  if(delta.target.operation==='create'){
    await c.query('INSERT INTO coach_events(id,user_id,conversation_id,title,title_source) VALUES($1,$2,$3,$4,$5)',[staged.eventId,run.user_id,run.conversation_id,delta.target.title,await currentSource(c,run,delta.target.source)])
  }else{
    await c.query('UPDATE coach_events SET revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2',[run.user_id,staged.eventId])
  }
  const newQuotes=(delta.nodes??[]).filter(node=>node.kind!=='unknown').map(node=>node.source.quote)
  const insertedUnknownIds=new Map<string,string[]>()
  for(const node of delta.nodes??[]){
    const source=await coachNodeSource(c,run,staged.eventId,node,newQuotes)
    if(node.kind!=='unknown'&&source===null)continue
    const content=node.kind==='unknown'?node.question:node.source.quote
    const duplicate=(await c.query("SELECT 1 FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND status='active' AND kind=$3 AND content=$4 AND source IS NOT DISTINCT FROM $5::jsonb",[run.user_id,staged.eventId,node.kind,content,source?JSON.stringify(source):null])).rowCount
    if(!duplicate){
      const inquiryContext=node.kind==='unknown'?{affects:node.affects?.trim()||'当前事项的理解或下一步',reason:node.reason?.trim()||'这个答案会改变当前判断或行动',dependsOn:node.dependsOn??[]}:{ }
      const nodeId=randomUUID()
      await c.query('INSERT INTO coach_nodes(id,user_id,event_id,kind,content,source,inquiry_context) VALUES($1,$2,$3,$4,$5,$6,$7)',[nodeId,run.user_id,staged.eventId,node.kind,content,source,inquiryContext])
      if(node.kind==='unknown')insertedUnknownIds.set(content,[...insertedUnknownIds.get(content)??[],nodeId])
    }
  }
  for(const correction of delta.corrections??[]){
    await c.query("UPDATE coach_nodes SET source=$4,content=$5,kind=CASE WHEN kind='unknown' THEN 'fact' ELSE kind END,inquiry_context=CASE WHEN kind='unknown' THEN '{}'::jsonb ELSE inquiry_context END,status='active',revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,staged.eventId,correction.nodeId,await currentSource(c,run,correction.source),correction.source.quote])
  }
  for(const id of delta.resolveUnknowns??[])await c.query("UPDATE coach_nodes SET status='resolved',revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,staged.eventId,id])
  for(const id of delta.declineUnknowns??[])await c.query("UPDATE coach_nodes SET status='declined',revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,staged.eventId,id])
  if(delta.corrections?.length)await c.query("UPDATE coach_actions SET status='stale',revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND status='proposed'",[run.user_id,staged.eventId])
  const change=delta.action
  let exactActionBinding=change&&(change.operation==='create'||change.operation==='modify')?actionValidation?.binding:undefined
  let actionFieldSources:ActionFieldSourceBinding[]|undefined
  if(change&&(change.operation==='create'||change.operation==='modify')&&!exactActionBinding)throw new HttpError(400,'COACH_ACTION_SOURCE_INVALID')
  if(change&&(change.operation==='create'||change.operation==='modify')&&exactActionBinding){
    const previous=change.operation==='modify'?await historicalActionMaterialState(c,run.user_id,staged.eventId,change.actionId):null
    if(previous?.legacy&&draftRetainsPriorMaterial(previous.draft,change.draft))throw new HttpError(400,'COACH_ACTION_SOURCE_REQUIRED')
    actionFieldSources=projectActionFieldSources(previous?.draft,change.draft,previous?.fieldSources??[],previous?.fieldSourcesKnown??false,previous?.sources??[],exactActionBinding)
    exactActionBinding={...exactActionBinding,sources:distinctBoundSources(exactActionBinding.sources)}
  }
  const exactActionSource=exactActionBinding?.source,exactActionSources=exactActionBinding?.sources
  let consumedRequestSources:BoundCoachSource[]|null=exactActionBinding?distinctBoundSources(exactActionBinding.sources):[]
  if(change?.operation==='modify'&&exactActionBinding){
    const existingLedger=(await c.query('SELECT consumed_request_sources FROM coach_actions WHERE user_id=$1 AND event_id=$2 AND id=$3',[run.user_id,staged.eventId,change.actionId])).rows[0]?.consumed_request_sources
    consumedRequestSources=existingLedger===null?null:distinctBoundSources([...(Array.isArray(existingLedger)?existingLedger:[]),...exactActionBinding.sources])
  }
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
          AND (r.snapshot->>'actionId'=$3 OR (NOT (r.snapshot ? 'actionId')
            AND (SELECT count(*) FROM jsonb_array_elements(COALESCE(r.snapshot#>'{event,actions}','[]'::jsonb)) a WHERE a->>'status'='proposed')=1
            AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(r.snapshot#>'{event,actions}','[]'::jsonb)) a WHERE a->>'id'=$3 AND a->>'status'='proposed')))
          AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE ${fullMemorySuppressionSql('s')} AND s.user_id=m.user_id AND s.source_message_id=m.id)
          AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id)
          AND NOT EXISTS(SELECT 1 FROM experiences e WHERE e.user_id=m.user_id AND e.source_message_id=m.id AND e.status='deleted')`,[run.user_id,staged.eventId,change.actionId])).rows
        sources.push(...requests.filter(row=>unquotedRequestParts(row.content,row.node_quotes).length).map(row=>row.id as string))
      }
      sources.push(...(exactActionSources??[]).map(source=>source.messageId))
      sources.push(run.source_message_id)
      if(change.operation==='create'){
        await c.query('INSERT INTO coach_actions(id,user_id,event_id,draft,source_message_ids,knowledge_refs,consumed_request_sources) VALUES($1,$2,$3,$4,$5,$6,$7)',[staged.actionId,run.user_id,staged.eventId,change.draft,[...new Set(sources)],JSON.stringify(staged.knowledgeRefs??[]),JSON.stringify(consumedRequestSources)])
      }else{
        await c.query("UPDATE coach_actions SET draft=$4,status='proposed',source_message_ids=$5,knowledge_refs=$6,consumed_request_sources=$7,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,staged.eventId,change.actionId,change.draft,[...new Set(sources)],JSON.stringify(staged.knowledgeRefs??[]),consumedRequestSources===null?null:JSON.stringify(consumedRequestSources)])
      }
    }else if(change.operation==='close'){
      await c.query("UPDATE coach_actions SET status='closed',closed_reason=$4,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,staged.eventId,change.actionId,change.reason])
    }
  }
  if(staged.keepCurrentEventId){
    // A separately named matter can be saved without taking over the workspace
    // the user explicitly kept. A stale pointer cannot become a new focus.
    const current=(await c.query('SELECT event_id FROM coach_current WHERE user_id=$1 AND conversation_id=$2 FOR UPDATE',[run.user_id,run.conversation_id])).rows[0]
    if(current?.event_id!==staged.keepCurrentEventId)throw new HttpError(409,'COACH_SNAPSHOT_INVALIDATED')
  }else{
    await c.query('INSERT INTO coach_current(user_id,conversation_id,event_id) VALUES($1,$2,$3) ON CONFLICT(user_id,conversation_id) DO UPDATE SET event_id=EXCLUDED.event_id',[run.user_id,run.conversation_id,staged.eventId])
  }
  const changedActionId=staged.actionId??(change&&'actionId'in change?change.actionId:undefined)
  const event=await readCoachEvent(c,run.user_id,run.conversation_id,staged.eventId,changedActionId&&exactActionBinding?{actionId:changedActionId,binding:exactActionBinding}:undefined)
  const askedThisTurn=visibleCoachQuestions(staged.reply,change&&'draft'in change&&'content'in change.draft?change.draft.content:undefined)
  event.asked=[...new Set([...event.asked,...askedThisTurn])]
  // Process chronology is reconstructed from owned runs/messages, not copied
  // recursively into each revision snapshot or classified as answered/refused.
  const {processTurns,actionProgressReports,matterProgress,...snapshotEvent}=event
  const sourceRows=(await c.query('SELECT id,source FROM coach_nodes WHERE user_id=$1 AND event_id=$2',[run.user_id,event.id])).rows
  snapshotEvent.nodes=snapshotEvent.nodes.map(node=>({...node,source:sourceRows.find(row=>row.id===node.id)?.source??node.source}))
  snapshotEvent.actions=event.actions.map(({requestSources,...action})=>action)
  const activeActionIds=snapshotEvent.actions.filter(action=>action.status==='proposed'&&action.draft).map(action=>action.id)
  const persistedActionBindings=activeActionIds.length?(await c.query(`SELECT a.id::text AS action_id,action_provenance.exact_source AS source,action_provenance.exact_sources AS sources,action_provenance.exact_field_sources AS field_sources,action_provenance.field_sources_present,action_provenance.material_revision_modern
    FROM coach_actions a ${latestActionProvenanceJoin}
    WHERE a.user_id=$1 AND a.event_id=$2 AND a.id=ANY($3::uuid[])`,[run.user_id,event.id,activeActionIds])).rows:[]
  const actionQuestionGroups:ActionQuestionGroup[]=activeActionIds.flatMap(actionId=>{
    const current=actionId===changedActionId&&exactActionSource,persisted=persistedActionBindings.find(row=>row.action_id===actionId)
    const action=snapshotEvent.actions.find(candidate=>candidate.id===actionId),source=current?exactActionSource:persisted?.source
    const requestCandidates=current?(exactActionSources??[exactActionSource]):Array.isArray(persisted?.sources)?persisted.sources:source?[source]:[]
    const persistedFieldSources=persisted?.field_sources_present===true?actionFieldAuthoritySources(persisted.field_sources,action?.draft):[]
    if(!current&&persisted?.field_sources_present===true&&!persistedFieldSources?.length)return [{source:{messageId:run.source_message_id,conversationId:run.conversation_id,quote:''},sources:[{messageId:run.source_message_id,conversationId:run.conversation_id,quote:''}]}]
    const fieldCandidates=current?(actionFieldSources??[]).flatMap(binding=>binding.sources):persistedFieldSources??[]
    const sources=distinctBoundSources([...requestCandidates,...fieldCandidates].filter((candidate:any)=>candidate&&typeof candidate.messageId==='string'&&typeof candidate.quote==='string'))
    if(source&&sources.length)return [{source,sources}]
    return !current&&persisted?.material_revision_modern===true?[{source:{messageId:run.source_message_id,conversationId:run.conversation_id,quote:''},sources:[{messageId:run.source_message_id,conversationId:run.conversation_id,quote:''}]}]:[]
  })
  const titleSource=(await c.query('SELECT title_source FROM coach_events WHERE user_id=$1 AND id=$2',[run.user_id,event.id])).rows[0]?.title_source
  const titleQuestionSources=questionBasisSources([],undefined,titleSource)
  const questionState=(nodes:unknown)=>{
    const questionNodes=[...Array.isArray(nodes)?nodes:[],...(staged.factProjections??[]).map(fact=>({status:'active',content:fact.content,source:fact.source}))]
    const nodeSources=questionBasisSources(questionNodes,undefined,undefined)
    const bindings=askedThisTurn.map(question=>{
      const topicalSources=topicalQuestionSources(questionNodes,question),topicalAmbiguous=topicalSources===null,matchedTopicalSources=topicalSources??[]
      const deictic=!topicalAmbiguous&&!matchedTopicalSources.length&&deicticQuestion(question)
      const deicticFactualSources=deictic?(nodeSources.length===1?nodeSources:nodeSources.length>1?[{messageId:run.source_message_id,conversationId:run.conversation_id,quote:''}]:[]):[]
      const factualSources=topicalAmbiguous?[{messageId:run.source_message_id,conversationId:run.conversation_id,quote:''}]:matchedTopicalSources.length?matchedTopicalSources:deicticFactualSources
      const configuredActions=actionQuestionGroups.filter(group=>questionConfiguresActionMaterial(question,group.source)&&(!matchedTopicalSources.length||questionConfiguresActionIdentity(question,group.source)))
      const matchingActions=configuredActions.length?configuredActions:actionQuestionGroups.filter(group=>questionMatchesActionGroup(question,group))
      const actionQuestionSources=matchingActions.length===1&&(configuredActions.length>0||!matchedTopicalSources.length)?matchingActions[0]!.sources:[]
      const fallbackActionSources=!actionQuestionSources.length&&!factualSources.length&&matchingActions.length===0&&actionQuestionGroups.length===1?actionQuestionGroups[0]!.sources:[]
      const ambiguousActionSources=!factualSources.length&&matchingActions.length>1?[{messageId:run.source_message_id,conversationId:run.conversation_id,quote:''}]:[]
      const boundActionSources=actionQuestionSources.length?actionQuestionSources:fallbackActionSources
      const usesAction=Boolean(boundActionSources.length)
      const requiresAll=usesAction&&boundActionSources.length>1
        ||matchedTopicalSources.length>1&&(distributiveQuestion(question)||Boolean(countedQuestionSource(question))||/(?:这|那)?两者/.test(deicticQuestionView(question)))
      return {question,sources:actionQuestionSources.length?actionQuestionSources:factualSources.length?factualSources:fallbackActionSources.length?fallbackActionSources:ambiguousActionSources.length?ambiguousActionSources:nodeSources.length?nodeSources:titleQuestionSources,...(requiresAll?{sourceRequirement:'all'}:{})}
    }).filter(binding=>binding.sources.length)
    const boundSources=bindings.flatMap(binding=>binding.sources)
    const defaultActionSources=actionQuestionGroups.length===1?actionQuestionGroups[0]!.sources:[]
    const sources=[...new Map((boundSources.length?boundSources:defaultActionSources.length?defaultActionSources:nodeSources.length?nodeSources:titleQuestionSources).map(source=>[JSON.stringify([source.messageId,source.conversationId??null,source.quote,source.range??null]),source])).values()]
    return {bindings,sources}
  }
  let questions=questionState(snapshotEvent.nodes)
  const priorQuestionSnapshot=(await c.query(`SELECT snapshot
    FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 ORDER BY revision DESC LIMIT 1`,[run.user_id,event.id])).rows[0]?.snapshot
  const priorAsked=(Array.isArray(priorQuestionSnapshot?.event?.asked)?priorQuestionSnapshot.event.asked:[]).filter((question:unknown):question is string=>typeof question==='string')
  const priorQuestionProjection=Array.isArray(priorQuestionSnapshot?.currentQuestionBindings)
    ?priorQuestionSnapshot.currentQuestionBindings
    :await legacyCurrentQuestionBindings(c,run.user_id,event.id,priorAsked)
  const carriedQuestionBindings=priorQuestionProjection.filter((binding:any)=>binding&&typeof binding.question==='string'&&Array.isArray(binding.sources))
  const currentQuestionBindings=distinctQuestionBindings([...carriedQuestionBindings,...questions.bindings])
    .filter((binding:any)=>snapshotEvent.asked.includes(binding.question))
  const revisionSnapshot:any={event:snapshotEvent,askedThisTurn,currentQuestionBindings,actionChange:change?.operation??null,actionId:staged.actionId??(change&&'actionId'in change?change.actionId:null),...(exactActionSource?{actionSource:exactActionSource,actionSources:exactActionSources,actionFieldSources:actionFieldSources??[]}:{}),...(questions.sources.length?{questionSources:questions.sources}:{}),...(questions.bindings.length?{questionBindings:questions.bindings}:{})}
  // Version 0 explicitly preserves the older internal/API delta contract.
  // Native model frames require matterReports and always persist version 1,
  // including [] when no state changed. Privacy removal keeps that version.
  revisionSnapshot.matterReportVersion=delta.matterReports===undefined?0:1
  revisionSnapshot.matterReports=await Promise.all((delta.matterReports??[]).map(async report=>({...report,source:await currentSource(c,run,report.source)})))
  await c.query('INSERT INTO coach_event_revisions(user_id,event_id,revision,generation,request_id,snapshot) VALUES($1,$2,$3,$4,$5,$6)',[run.user_id,event.id,event.revision,event.generation,run.request_id,revisionSnapshot])
  const committed=await readCoachEvent(c,run.user_id,run.conversation_id,event.id)
  const usableQuestionSource=(source:any)=>source&&typeof source.messageId==='string'&&typeof source.quote==='string'&&Boolean(source.quote.trim())
  const initialBindingByQuestion=new Map(questions.bindings.map(binding=>[binding.question,binding]))
  const unsupportedThisTurn=new Set(askedThisTurn.filter(question=>{
    const binding=initialBindingByQuestion.get(question)
    return !binding||(binding.sourceRequirement==='all'?!binding.sources.every(usableQuestionSource):!binding.sources.some(usableQuestionSource))
  }))
  const retiredQuestions=[...new Set([...previouslyAsked,...askedThisTurn])].filter(question=>!committed.asked.includes(question))
  const resolvedQuestions=retiredQuestions.filter(question=>!unsupportedThisTurn.has(question))
  const withdrawnUnknownIds=[...unsupportedThisTurn].flatMap(question=>insertedUnknownIds.get(question)??[])
  if(resolvedQuestions.length){
    const resolved=(await c.query("UPDATE coach_nodes SET status='resolved',revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND kind='unknown' AND status='active' AND content=ANY($3::text[]) RETURNING id,revision",[run.user_id,event.id,resolvedQuestions])).rows
    const revisions=new Map(resolved.map(row=>[String(row.id),Number(row.revision)]))
    committed.nodes=committed.nodes.map(node=>revisions.has(node.id)?{...node,status:'resolved',revision:revisions.get(node.id)!}:node)
  }
  if(withdrawnUnknownIds.length){
    await c.query("UPDATE coach_nodes SET status='withdrawn',content=NULL,source=NULL,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND kind='unknown' AND status='active' AND id=ANY($3::uuid[])",[run.user_id,event.id,withdrawnUnknownIds])
    const withdrawn=new Set(withdrawnUnknownIds)
    committed.nodes=committed.nodes.filter(node=>!withdrawn.has(node.id))
  }
  const projected=new Map(committed.nodes.map(node=>[node.id,node]))
  const withdrawnUnknownIdSet=new Set(withdrawnUnknownIds)
  revisionSnapshot.event.nodes=snapshotEvent.nodes.map(node=>{
    if(withdrawnUnknownIdSet.has(node.id))return {...node,status:'withdrawn',content:null,source:null}
    const current=projected.get(node.id)
    return current?{...node,status:current.status,revision:current.revision,...(current.supersededByActionCorrection?{supersededByActionCorrection:true}:{})}:node
  })
  questions=questionState(revisionSnapshot.event.nodes)
  revisionSnapshot.currentQuestionBindings=distinctQuestionBindings([...(revisionSnapshot.currentQuestionBindings??[]),...questions.bindings])
  if(questions.sources.length)revisionSnapshot.questionSources=questions.sources;else delete revisionSnapshot.questionSources
  if(questions.bindings.length)revisionSnapshot.questionBindings=questions.bindings;else delete revisionSnapshot.questionBindings
  await c.query('UPDATE coach_event_revisions SET snapshot=$4 WHERE user_id=$1 AND event_id=$2 AND revision=$3',[run.user_id,event.id,event.revision,revisionSnapshot])
  // The first committed projection can mark an older fact as superseded. Keep
  // the completion response aligned with the just-updated question bindings
  // without paying for a third full event read. Empty-source sentinels are the
  // same fail-closed bindings that a subsequent read removes; earlier valid
  // occurrences of the same question remain visible.
  const bindingByQuestion=new Map(questions.bindings.map(binding=>[binding.question,binding]))
  const retainedThisTurn=askedThisTurn.filter(question=>{
    const binding=bindingByQuestion.get(question)
    if(!binding)return false
    return binding.sourceRequirement==='all'?binding.sources.every(usableQuestionSource):binding.sources.some(usableQuestionSource)
  })
  const previouslySupportedQuestions=new Set(carriedQuestionBindings.filter((binding:any)=>
    binding.sourceRequirement==='all'?binding.sources.length>0&&binding.sources.every(usableQuestionSource):binding.sources.some(usableQuestionSource)
  ).map((binding:any)=>binding.question))
  // A new unsupported occurrence is withdrawn, but it cannot erase an older
  // independently sourced occurrence merely because the generated text is
  // identical. Resolution still removes every occurrence intentionally.
  const unsupportedWithoutPrior=[...unsupportedThisTurn].filter(question=>!previouslySupportedQuestions.has(question))
  const removedQuestions=new Set([...unsupportedWithoutPrior,...resolvedQuestions])
  const finalAsked=[...new Set([...committed.asked,...retainedThisTurn])].filter(question=>!removedQuestions.has(question))
  // Keep the latest snapshot as the bounded current-question projection. The
  // audit fields still retain askedThisTurn and exact bindings, while ordinary
  // reads no longer need to replay every earlier revision to discover which
  // generated questions survived validation.
  revisionSnapshot.event.asked=finalAsked
  revisionSnapshot.currentQuestionBindings=(revisionSnapshot.currentQuestionBindings??[]).filter((binding:any)=>finalAsked.includes(binding.question))
  await c.query('UPDATE coach_event_revisions SET snapshot=$4 WHERE user_id=$1 AND event_id=$2 AND revision=$3',[run.user_id,event.id,event.revision,revisionSnapshot])
  const returnedProcessTurns=committed.processTurns?.map(turn=>turn.revision===event.revision?{...turn,questionsAskedAfterInput:retainedThisTurn}:turn)
  return {...committed,asked:finalAsked,...(returnedProcessTurns?{processTurns:returnedProcessTurns}:{})}
}

async function readCoachEventInternal(c:PoolClient,user:string,conversation:string,id:string,bindings?:MutableCoachEventSourceBindings,pendingAction?:{actionId:string;binding:ActionRequestBinding}):Promise<CoachEvent>{
  const row=await eventFor(c,user,conversation,id)
  const title=await currentCoachTitle(c,user,row)
  if(!title)throw new HttpError(409,'COACH_SOURCE_REVOKED')
  if(bindings)bindings.titleSource=title.source
  const rows=(await c.query("SELECT * FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND status<>'withdrawn' ORDER BY created_at,id",[user,id])).rows
  const actionRows=(await c.query(`SELECT a.*,action_provenance.exact_source,action_provenance.exact_sources,action_provenance.exact_field_sources,action_provenance.field_sources_present,action_provenance.material_revision_modern,
    coach_knowledge_refs_valid(a.knowledge_refs) AS knowledge_valid
    FROM coach_actions a ${latestActionProvenanceJoin}
    WHERE a.user_id=$1 AND a.event_id=$2 ORDER BY a.created_at,a.id`,[user,id])).rows
  const history=(await c.query(`SELECT recent.revision,recent.snapshot,(SELECT p.snapshot FROM coach_event_revisions p WHERE p.user_id=$1 AND p.event_id=$2 AND p.revision<recent.revision ORDER BY p.revision DESC LIMIT 1) AS previous_snapshot,recent.snapshot->'askedThisTurn' AS asked,recent.snapshot#>'{event,nodes}' AS nodes,recent.snapshot->'actionSource' AS action_source,recent.snapshot->>'actionChange' AS action_change,recent.snapshot ? 'actionChange' AS action_change_present,
    CASE WHEN recent.snapshot ? 'actionId' THEN ARRAY[recent.snapshot->>'actionId']
      WHEN (SELECT count(*) FROM jsonb_array_elements(COALESCE(recent.snapshot#>'{event,actions}','[]'::jsonb)) a WHERE a->>'status'='proposed')=1
      THEN ARRAY(SELECT a->>'id' FROM jsonb_array_elements(COALESCE(recent.snapshot#>'{event,actions}','[]'::jsonb)) a WHERE a->>'status'='proposed')
      ELSE ARRAY[]::text[] END AS action_ids,t.source_message_id
    FROM (SELECT r.revision,r.snapshot,r.request_id FROM coach_event_revisions r
      WHERE r.user_id=$1 AND r.event_id=$2 AND jsonb_typeof(r.snapshot#>'{event,nodes}')='array'
      ORDER BY r.revision DESC LIMIT 8) recent
    JOIN runs t ON t.user_id=$1 AND t.request_id=recent.request_id
    ORDER BY recent.revision`,[user,id])).rows
  const recent=history
  const latestSnapshot=history.at(-1)?.snapshot
  const latestMaterialProjection=revisionMaterialProjection(latestSnapshot,history.at(-1)?.previous_snapshot??history.at(-2)?.snapshot)
  const persistedAsked=(Array.isArray(latestSnapshot?.event?.asked)?latestSnapshot.event.asked:[]).filter((question:unknown):question is string=>typeof question==='string')
  const currentQuestionProjectionPresent=Array.isArray(latestSnapshot?.currentQuestionBindings)
  const persistedQuestionBindings=(latestMaterialProjection.malformedModernMaterial?[]:currentQuestionProjectionPresent?latestSnapshot.currentQuestionBindings:await legacyCurrentQuestionBindings(c,user,id,persistedAsked))
    .filter((binding:any)=>binding&&typeof binding.question==='string'&&Array.isArray(binding.sources))
  const persistedBindingsByQuestion=new Map<string,any[]>()
  for(const binding of persistedQuestionBindings)persistedBindingsByQuestion.set(binding.question,[...persistedBindingsByQuestion.get(binding.question)??[],binding])
  // Recover the actual prior owner from the existing run provenance, including
  // earlier candidates which created a new direction using a prior stop quote.
  // No event is rewritten and a supplied reference by itself proves no state.
  const transitions=(await c.query(`SELECT child.id AS transition_event_id,prior.id AS prior_event_id,r.request_id,r.source_message_id,owner.ref->'revision' AS bound_revision,owner.explicit_current AS owner_current,m.content,m.conversation_id
    FROM coach_events child JOIN runs r ON r.user_id=child.user_id AND r.conversation_id=child.conversation_id AND r.source_message_id::text=child.title_source->>'messageId'
    JOIN messages m ON m.user_id=r.user_id AND m.id=r.source_message_id AND m.conversation_id=r.conversation_id AND m.role='user'
    CROSS JOIN LATERAL (SELECT jsonb_agg(DISTINCT ref.value)->0 AS ref,bool_or(NULLIF(audit.value->>'currentEventId','')=ref.value->>'eventId') AS explicit_current
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.tool_audit)='array' THEN r.tool_audit ELSE '[]'::jsonb END) audit(value)
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN audit.value->>'phase'='coach_context_bound' AND jsonb_typeof(audit.value->'eventRefs')='array' THEN audit.value->'eventRefs' ELSE '[]'::jsonb END) ref(value)
      WHERE NULLIF(audit.value->>'currentEventId','') IS NULL OR ref.value->>'eventId'=audit.value->>'currentEventId'
      HAVING count(DISTINCT ref.value)=1) owner
    JOIN coach_events prior ON prior.user_id=child.user_id AND prior.id::text=owner.ref->>'eventId' AND prior.created_at<child.created_at
    JOIN coach_event_revisions bound ON bound.user_id=prior.user_id AND bound.event_id=prior.id AND bound.revision::text=owner.ref->>'revision' AND bound.generation::text=owner.ref->>'generation'
      AND bound.snapshot#>>'{event,id}'=prior.id::text AND bound.created_at<=m.created_at
      AND NOT EXISTS(SELECT 1 FROM coach_event_revisions later WHERE later.user_id=bound.user_id AND later.event_id=bound.event_id AND later.revision>bound.revision AND later.created_at<=m.created_at)
    WHERE child.user_id=$1 AND child.status='active' AND child.title_source->>'conversationId'=child.conversation_id::text
      AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=m.user_id AND d.conversation_id=m.conversation_id)
      AND (child.conversation_id=$3 OR $4) AND r.status IN ('running','completed') AND (child.id=$2 OR prior.id=$2)`,[user,id,conversation,await enabled(c,user)])).rows.flatMap(transition=>{
      const report=reportedPriorMatterTransition(transition.content)
      return report&&!report.priorScopeReintroduced&&(!report.requiresCurrentContext||transition.owner_current===true)&&Number.isInteger(transition.bound_revision)&&transition.bound_revision>0?[{...transition,...report}]:[]
    })
  // Older snapshots may contain a citation truncated at its query marker.
  // Reuse the display extractor on read; retain the original audit snapshots.
  for(const turn of history)turn.asked=(turn.asked??[]).flatMap((question:string)=>visibleCoachQuestions(question))
  // `currentQuestionBindings` is the bounded durable projection for questions
  // whose originating revision has aged out of the eight-turn process window.
  // Load those exact messages directly; otherwise a valid carried question is
  // mistaken for a revoked one merely because its old run is no longer in
  // `history`. Malformed stored ids remain unavailable instead of reaching the
  // uuid[] query.
  const persistedQuestionSourceIds=persistedQuestionBindings.flatMap((binding:any)=>Array.isArray(binding.sources)?binding.sources.map((source:any)=>source?.messageId):[])
    .filter((messageId:unknown):messageId is string=>typeof messageId==='string'&&/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(messageId))
  const directSourceIds=[...new Set([row.title_source.messageId,...rows.flatMap(node=>node.source?[node.source.messageId]:[]),...actionRows.flatMap(action=>action.source_message_ids),...history.map(turn=>turn.source_message_id),...persistedQuestionSourceIds])]
  const ids=[...new Set([...directSourceIds,...transitions.map(transition=>transition.source_message_id)])]
  const available=(await c.query(`SELECT m.id,m.content,m.conversation_id,m.created_at FROM messages m
    WHERE m.user_id=$1 AND m.id=ANY($2::uuid[]) AND m.role='user'
    AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=m.user_id AND d.conversation_id=m.conversation_id)
    AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE ${fullMemorySuppressionSql('s')} AND s.user_id=m.user_id AND s.source_message_id=m.id)
    AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id) ORDER BY m.created_at,m.id`,[user,ids])).rows
  const sources=new Map(available.map(message=>[message.id,message]))
  const controls=await coachSourceBoundaryRefs(c,user)
  const controlled=(source:BoundCoachSource)=>{const message=sources.get(source.messageId);return Boolean(message&&controls.some(ref=>ref.messageId===source.messageId&&sourceQuotesOverlap(message.content,source,ref)))}
  const unavailable=(source:BoundCoachSource)=>{
   const message=sources.get(source.messageId)
   return typeof source.quote!=='string'||!source.quote.trim()||!message||message.conversation_id!==source.conversationId||!sourceTextMatches(message.content,source)||controlled(source)
  }
  const eventQuestionSources=[row.title_source,...rows.flatMap(node=>node.source?[node.source]:[]),...persistedQuestionBindings.flatMap((binding:any)=>binding.sources)]
  const activeQuestionTurns=new Map<string,ActiveQuestionTurn[]>()
  for(const turn of history)advanceActiveQuestionTurns(activeQuestionTurns,turn)
  const toolsFor=questionToolScopes(row.title_source,eventQuestionSources,controls,id=>sources.get(id)?.content??'')
  const unavailableDerivedSources=new Set<string>(ids.filter(sourceId=>!sources.has(sourceId)||sourceFullyControlled(sourceId,sources.get(sourceId)!.content,controls)))
  const unknownOrigins=new Map<string,string>()
  const questionBases=revisionQuestionBases(history,row.title_source)
  const questionUnavailableForTurn=(turn:any,question:string)=>{
   const current=persistedBindingsByQuestion.get(question)??[]
   const withdrawn=toolsFor(question,turn.source_message_id)
   if(current.some((binding:any)=>!bindingUnavailable(binding))&&!questionUsesWithdrawnTerm(question,withdrawn,current,unavailable))return false
   if(questionUsesWithdrawnTerm(question,withdrawn,Array.isArray(turn.snapshot?.questionBindings)?turn.snapshot.questionBindings:[],unavailable))return true
   return questionHistorySourceUnavailable(turn,question,questionBases,unavailableDerivedSources.has(turn.source_message_id),unavailable)
  }
  const derivedQuestionWithdrawn=(question:string|null,origin?:string)=>{
   if(typeof question!=='string')return false
   const occurrences=activeQuestionTurns.get(question)??[]
   return occurrences.length?occurrences.every(({turn})=>toolsFor(question,turn.source_message_id).terms.length>0&&questionUnavailableForTurn(turn,question))
    :questionUsesWithdrawnTerm(question,toolsFor(question,origin),persistedBindingsByQuestion.get(question)??[],unavailable)
  }
  for(const turn of history){
    for(const node of Array.isArray(turn.nodes)?turn.nodes:[])if(node.kind==='unknown'&&!unknownOrigins.has(node.id))unknownOrigins.set(node.id,turn.source_message_id)
    // Questions and undifferentiated drafts generated from a partly withdrawn
    // input need fresh grounding. Independently sourced facts remain readable.
    turn.asked=(Array.isArray(turn.asked)?turn.asked:[]).filter((question:string)=>!questionUnavailableForTurn(turn,question))
  }
  function bindingUnavailable(binding:any){
    const exact=(Array.isArray(binding?.sources)?binding.sources:[]) as BoundCoachSource[]
    return exact.length===0||(binding.sourceRequirement==='all'?exact.some(unavailable):exact.every(unavailable))
  }
  const unavailablePersistedQuestions=new Set<string>()
  for(const question of persistedAsked){
    const alternatives=persistedBindingsByQuestion.get(question)??[]
    if(derivedQuestionWithdrawn(question)||(currentQuestionProjectionPresent||latestMaterialProjection.malformedModernMaterial)&&(!alternatives.length||alternatives.every(bindingUnavailable)))unavailablePersistedQuestions.add(question)
    else if(alternatives.length&&alternatives.every(bindingUnavailable))unavailablePersistedQuestions.add(question)
  }
  const availablePersistedAsked=persistedAsked.filter((question:string)=>!unavailablePersistedQuestions.has(question))
  const currentQuestionProjectionAuthoritative=currentQuestionProjectionPresent||latestMaterialProjection.malformedModernMaterial
  const currentlyAsked=new Set(currentQuestionProjectionAuthoritative?availablePersistedAsked:[...availablePersistedAsked,...history.flatMap(turn=>Array.isArray(turn.asked)?turn.asked:[])])
  const valid=(source:BoundCoachSource)=>!unavailable(source)
  if(!valid(title.source))throw new HttpError(409,'COACH_SOURCE_REVOKED')
  const legacyActionRequests=new Map<string,BoundCoachSource[]>()
  for(const action of actionRows){
    const exact=actionAuthoritySources(action)
    if(!exact.length&&action.material_revision_modern!==true)legacyActionRequests.set(String(action.id),await legacyActionRequestCandidates(c,user,id,action.source_message_ids,row.title_source))
  }
  const sourceChecked=[]
  for(const node of rows){
    if(node.kind==='unknown'&&(derivedQuestionWithdrawn(node.content,unknownOrigins.get(node.id))||unavailableDerivedSources.has(unknownOrigins.get(node.id)??'')&&!currentlyAsked.has(node.content)))continue
    if(!node.source||valid(node.source))sourceChecked.push(node)
  }
  const nodes:CoachNode[]=sourceChecked.map(node=>({id:node.id,revision:node.revision,kind:node.kind,status:node.status,content:node.content,source:node.source,...(node.kind==='unknown'?{inquiryContext:{affects:String(node.inquiry_context?.affects??'当前事项的理解或下一步'),reason:String(node.inquiry_context?.reason??'这个答案会改变当前判断或行动'),dependsOn:Array.isArray(node.inquiry_context?.dependsOn)?node.inquiry_context.dependsOn.map(String):[]}}:{})}))
  const nodeQuotes=new Map<string,SourceExclusion[]>()
  for(const node of [...nodes,...history.flatMap(turn=>Array.isArray(turn.nodes)?turn.nodes:[])]){
    if(node.source)nodeQuotes.set(node.source.messageId,[...nodeQuotes.get(node.source.messageId)??[],node.source])
  }
  // A title citation need not have been a fact node. Withheld ranges cannot
  // reappear as loose historical input fragments after title recovery.
  for(const ref of controls)if(sources.has(ref.messageId))nodeQuotes.set(ref.messageId,[...nodeQuotes.get(ref.messageId)??[],ref])
  const consumedActionRequestSources=distinctBoundSources([
    ...actionRows.flatMap(action=>Array.isArray(action.consumed_request_sources)?action.consumed_request_sources:[]),
    ...(pendingAction?.binding.sources??[]),
  ] as BoundCoachSource[])
  const legacyConsumedMessageIds=new Set<string>(actionRows.filter(action=>action.consumed_request_sources===null).flatMap(action=>action.source_message_ids as string[]))
  const actionSourceMessageIds=new Set<string>(actionRows.flatMap(action=>action.source_message_ids as string[]))
  const consumedRequest=(candidate:ActionRequestCandidate,origin:BoundCoachSource)=>{
    const start=candidate.range.start,end=candidate.range.end
    return legacyConsumedMessageIds.has(origin.messageId)||consumedActionRequestSources.some(source=>boundSourceConsumesCandidate(source,{messageId:origin.messageId,quote:candidate.quote,start,end}))
  }
  const pendingActionRequestSources=distinctBoundSources(available.filter(message=>actionSourceMessageIds.has(message.id)).flatMap(message=>
    unquotedRequestPartSources(message.content,nodeQuotes.get(message.id)??[]).map(part=>({messageId:String(message.id),conversationId:String(message.conversation_id),quote:part.quote,range:part.range} as BoundCoachSource))
      .filter(origin=>actionCandidatesFromBoundSource(origin).some(candidate=>!consumedRequest(candidate,origin)))
  ))
  if(bindings){bindings.consumedActionRequestSources=consumedActionRequestSources;bindings.pendingActionRequestSources=pendingActionRequestSources}
  const actions:CoachAction[]=actionRows.map(action=>{
    const unavailableReasons:NonNullable<CoachAction['unavailableReasons']>=[]
    if(!action.knowledge_valid)unavailableReasons.push('knowledge_sources_changed_or_unavailable')
    const pending=pendingAction?.actionId===String(action.id)?pendingAction.binding:undefined
    const exact=pending?.sources??actionAuthoritySources(action),requestExact=pending?.sources??actionRequestAuthoritySources(action)
    const exactPrimary=pending?.source??(action.exact_source&&typeof action.exact_source==='object'?action.exact_source as BoundCoachSource:requestExact.at(-1))
    const legacyExact=legacyActionRequests.get(String(action.id))??[]
    const authoritativePrimary=exactPrimary??(legacyExact.length===1?legacyExact[0]:undefined)
    if(bindings&&authoritativePrimary)bindings.actionRequestSources.push({actionId:String(action.id),source:authoritativePrimary})
    const requestIds=new Set(history.filter(turn=>(['create','modify'].includes(turn.action_change)||turn.action_change_present===false)&&turn.action_ids.includes(action.id)).map(turn=>turn.source_message_id))
    for(const source of exact)requestIds.add(source.messageId)
    for(const source of legacyExact)requestIds.add(source.messageId)
    const legacyUnavailable=legacyExact.length!==1||legacyExact.some(unavailable)
    if(exact.length?exact.some(unavailable):action.material_revision_modern===true||legacyUnavailable)unavailableReasons.push('user_sources_unavailable')
    if(action.status==='stale'&&!unavailableReasons.length)unavailableReasons.push('material_withdrawn')
    const stale=unavailableReasons.length>0
    const requests=stale?[]:available.filter(message=>action.source_message_ids.includes(message.id)&&requestIds.has(message.id)).map(message=>unquotedRequestParts(message.content,nodeQuotes.get(message.id)??[]).map(quote=>({messageId:message.id,conversationId:message.conversation_id,quote}))).filter(parts=>parts.length)
    // Keep the original request plus recent changes, without interpreting them
    // as facts, accepted commitments or stable personal background.
    const historicalRequestSources=(requests.length>8?[requests[0],...requests.slice(-7)]:requests).flat()
    // Ordinary actions keep the established whole-fragment API. Exact request
    // selections are additionally exposed only when one source message carried
    // multiple independently fulfillable requests; the consumer then needs the
    // selected sibling to avoid treating all of them as already fulfilled.
    // Coordination is a property of the original request, not of whichever
    // siblings remain visible today. A scoped control may hide one sibling but
    // must not make this action abandon its persisted exact lineage and fall
    // back to newly reconstructed whole-message fragments.
    const coordinatedRequestIds=new Set(stale?[]:available.filter(message=>action.source_message_ids.includes(message.id)&&requestIds.has(message.id)
      &&unquotedActionRequestSources(message.content,[]).length>1).map(message=>message.id))
    const exactRequestSources=stale?[]:requestExact.map(source=>readableSource(source)).filter((source):source is CoachSource=>Boolean(source)).filter(source=>coordinatedRequestIds.has(source.messageId))
    // Once the current revision selects one sibling from a coordinated
    // request, its shared operation plus exact object are the complete public
    // lineage. Re-attaching older whole fragments can reintroduce authority
    // for a different artifact. Ordinary one-object actions still retain
    // their historical time/effort constraints below.
    const exactCoordinated=exactRequestSources.length>0
    const requestSources=[...new Map((exactCoordinated?exactRequestSources:[...exactRequestSources,...historicalRequestSources.filter(source=>!coordinatedRequestIds.has(source.messageId))]).map(source=>[JSON.stringify([source.messageId,source.conversationId,source.quote]),source])).values()]
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
  if(bindings)bindings.nodeSources=nodes.flatMap(node=>node.source?[{nodeId:node.id,source:node.source as BoundCoachSource}]:[])
  const processTurns:CoachProcessTurn[]=recent.flatMap(turn=>{
    const nodeIds=nodes.filter(node=>node.source?.messageId===turn.source_message_id).map(node=>node.id)
    const introducedUnknownNodeIds=nodes.filter(node=>node.kind==='unknown'&&unknownIntroductions.get(node.id)===turn.revision).map(node=>node.id)
    const message=sources.get(turn.source_message_id)
    const inputParts=message?unquotedRequestPartSources(message.content,nodeQuotes.get(message.id)??[]):[]
    const inputSources=inputParts.map(part=>({messageId:message.id,conversationId:message.conversation_id,quote:part.quote}))
    const included=(nodeIds.length||inputSources.length)&&Array.isArray(turn.asked)
    if(included&&bindings)bindings.processSources.push(...inputParts.map(part=>({messageId:message.id,conversationId:message.conversation_id,quote:part.quote,range:part.range})))
    return included?[{revision:turn.revision,sourceMessageId:turn.source_message_id,nodeIds,questionsAskedAfterInput:turn.asked,...(inputSources.length?{inputSources}:{}),...(introducedUnknownNodeIds.length?{introducedUnknownNodeIds}:{})}]:[]
  })
  if(bindings)bindings.processTurns=processTurns
  // Project only authorized committed source fragments, in native event revision
  // order. No second fact database: GET, refresh and another session read the
  // same event commits. Explicit negative/unknown reports replace stale stages.
  let actionStages:ActionCase['known']={sent:null,read:null,replied:null,used:null,effect:null}
  let actionStageEvidence:NonNullable<CoachEvent['actionStageEvidence']>={}
  let actionStageScope:CoachEvent['actionStageScope']
  const actionProgressReports:CoachActionReport[]=[]
  const matterProgress:MatterProgress={state:actions.some(action=>action.status==='proposed'&&action.draft)?'proposed':'unknown',choice:'unknown',recommendationStopped:false,reports:[]}
  for(const turn of history){
    const source=sources.get(turn.source_message_id)
    if(!source)continue
    const fragments=[...nodes.filter(n=>n.kind==='fact'&&n.source?.messageId===source.id).map(n=>n.source!.quote),...unquotedRequestParts(source.content,nodeQuotes.get(source.id)??[])]
    const allowed=[...new Set(fragments)].filter(quote=>!controlled({messageId:source.id,conversationId:source.conversation_id,quote})).sort((a,b)=>source.content.indexOf(a)-source.content.indexOf(b))
    let matterReports:ReturnType<typeof reportedActionProgress>[]
    if(turn.snapshot?.matterReportVersion===1){
      matterReports=turn.snapshot.matterReports.filter((report:any)=>report.source?.messageId===source.id&&!controlled(report.source)&&source.content.includes(report.source.quote))
        .map((report:any)=>({state:report.state,choice:report.choice,resumed:report.resumed,quotes:[report.source.quote]}))
    }else{
      // Historical and version-0 compatibility deltas retain their original
      // source and attribution rules; version 1 never reinterprets the text.
      const possibleTransition=turn.revision===1&&source.id===row.title_source.messageId?reportedPriorMatterTransition(source.content):null
      const creationTransition=possibleTransition?.newPursuitDeclared?possibleTransition:null
      const ownClauses=scanUserClauses(source.content).filter(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.interrogative&&!clause.attributedToOther&&!clause.quoteSpans.length&&!clause.codeSpans.length&&allowed.some(quote=>quote.includes(clause.text))&&!(creationTransition&&clause.end<=creationTransition.stopEnd)&&!transitions.some(transition=>transition.newPursuitDeclared&&transition.transition_event_id===id&&transition.source_message_id===source.id&&transition.quote===clause.text))
      const switched=turn.revision===1&&source.id===row.title_source.messageId?reportedSwitchedMatterChoice(source.content):null
      const switchScope=switched&&switched.title===title.title&&switched.task.text===row.title_source.quote&&ownClauses.some(clause=>clause.start===switched.task.start&&clause.end===switched.task.end)?switched.scope:undefined
      matterReports=[reportedActionProgress(ownClauses,title.title,switchScope)]
    }
    for(const progress of matterReports)if(progress.state||progress.choice){
      matterProgress.reports.push({...progress,sourceMessageId:source.id,eventRevision:turn.revision,reportedAt:new Date(source.created_at).toISOString()})
    }
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
  for(const transition of transitions){
    const source=sources.get(transition.source_message_id)
    if(transition.prior_event_id!==id||!source||!valid({messageId:source.id,conversationId:transition.conversation_id,quote:transition.quote})||await growthQuoteSuppressed(c,user,source.id,transition.quote)||await messageQuoteCorrected(c,user,source.id,transition.quote))continue
    if(matterProgress.reports.some(report=>report.sourceMessageId===source.id&&report.quotes.includes(transition.quote)))continue
    matterProgress.reports.push({...transition.progress,sourceMessageId:source.id,eventRevision:transition.bound_revision,reportedAt:new Date(source.created_at).toISOString(),scopeEvidence:{basis:'explicit_deictic_stop_with_unambiguous_prior_event',ownerRole:transition.owner_current?'current_context':'sole_supplied_event',transitionEventId:transition.transition_event_id,requestId:transition.request_id,boundRevision:transition.bound_revision,newPursuitDeclared:transition.newPursuitDeclared}})
  }
  matterProgress.reports.sort((a,b)=>Date.parse(a.reportedAt)-Date.parse(b.reportedAt)||a.eventRevision-b.eventRevision)
  for(const report of matterProgress.reports){
    Object.assign(matterProgress,projectMatterReport(matterProgress,report))
  }
  const latestReport=actionProgressReports.at(-1)?.sourceQuotes.join('；')??''
  const projectedNodes=nodes.map(node=>{if(node.kind!=='fact'||!node.source||node.source.messageId!==actionStageScope?.sourceMessageId)return node;const stated=reconcileActionStages({sent:null,read:null,replied:null,used:null,effect:null},node.source.quote);return (['sent','read','replied','used'] as const).some(key=>stated[key]!==null&&actionStageEvidence[key]&&stated[key]!==actionStages[key])?{...node,supersededByActionCorrection:true}:node}).map(node=>actionStages.replied===true&&node.kind==='fact'&&/(?:对方|导师|老师).{0,8}(?:还没|还没有|未|没有).{0,3}(?:回复|回)/.test(node.content)&&sameReportedResponseSubject(node.content,latestReport)?{...node,supersededByActionCorrection:true}:node)
  const questionSourceKey=(source:any)=>JSON.stringify([source?.messageId??null,source?.conversationId??null,source?.quote??null,source?.range?.start??null,source?.range?.end??null])
  const supersededQuestionSources=new Set(projectedNodes.filter(node=>node.supersededByActionCorrection&&node.source).map(node=>questionSourceKey(node.source)))
  const supersededQuestions=new Set<string>()
  if(supersededQuestionSources.size){
    for(const turn of history)turn.asked=(turn.asked??[]).filter((question:string)=>{
      const exact=boundQuestionSources(turn,question,questionBases),stale=exact.filter(source=>supersededQuestionSources.has(questionSourceKey(source)))
      if(!stale.length)return true
      const retained=boundQuestionRequiresAll(turn,question,questionBases)?false:stale.length<exact.length
      return retained
    })
    for(const question of persistedAsked){
      const alternatives=persistedBindingsByQuestion.get(question)??[]
      const superseded=(binding:any)=>{
        const exact=(Array.isArray(binding?.sources)?binding.sources:[]) as BoundCoachSource[],stale=exact.filter(source=>supersededQuestionSources.has(questionSourceKey(source)))
        return exact.length===0||Boolean(stale.length&&(binding.sourceRequirement==='all'||stale.length>=exact.length))
      }
      if(alternatives.length&&alternatives.every(binding=>bindingUnavailable(binding)||superseded(binding)))supersededQuestions.add(question)
    }
  }
  const visiblePersistedAsked=availablePersistedAsked.filter((question:string)=>!supersededQuestions.has(question))
  const questionsByRevision=new Map(history.map(turn=>[Number(turn.revision),turn.asked??[]]))
  const projectedProcessTurns=processTurns.map(turn=>({...turn,questionsAskedAfterInput:questionsByRevision.get(turn.revision)??turn.questionsAskedAfterInput}))
  // Legacy generated labels have no verified clause binding and can contain
  // personal text outside their root quote. Keep their conservative projection;
  // native titles have a server-owned range and use its exact availability.
  const visibleTitle=!row.title_source.range&&directSourceIds.some(id=>unavailableDerivedSources.has(id))?'部分来源已更新的事项':title.title
  return {id:row.id,conversationId:row.conversation_id,title:visibleTitle,revision:row.revision,generation:row.generation,nodes:projectedNodes.map(node=>({...node,source:readableSource(node.source)})),actions,asked:[...new Set([...visiblePersistedAsked,...history.flatMap(entry=>entry.asked??[])])],processTurns:projectedProcessTurns,actionStages,actionStageEvidence,actionStageScope,actionProgressReports,matterProgress,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()}
}

export async function readCoachEvent(c:PoolClient,user:string,conversation:string,id:string,pendingAction?:{actionId:string;binding:ActionRequestBinding}):Promise<CoachEvent>{
 return readCoachEventInternal(c,user,conversation,id,undefined,pendingAction)
}
export async function readCoachEventWithSources(c:PoolClient,user:string,conversation:string,id:string):Promise<{event:CoachEvent;bindings:CoachEventSourceBindings}>{
 const bindings:MutableCoachEventSourceBindings={nodeSources:[],processTurns:[],processSources:[],pendingActionRequestSources:[],consumedActionRequestSources:[],actionRequestSources:[]},event=await readCoachEventInternal(c,user,conversation,id,bindings)
 if(!bindings.titleSource)throw new HttpError(409,'COACH_SOURCE_REVOKED')
 return {event,bindings:bindings as CoachEventSourceBindings}
}

export async function coachEventViewWithSources(user:string,conversation:string,id:string){
 return transaction(c=>readCoachEventWithSources(c,user,conversation,id))
}

export async function coachEventView(user:string,conversation:string,id?:string){
  return transaction(async c=>{
    requireRow((await c.query('SELECT c.id FROM conversations c WHERE c.user_id=$1 AND c.id=$2 AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=c.user_id AND d.conversation_id=c.id)',[user,conversation])).rows[0])
    const selected=id??(await c.query('SELECT event_id FROM coach_current WHERE user_id=$1 AND conversation_id=$2',[user,conversation])).rows[0]?.event_id
    return selected?await readCoachEvent(c,user,conversation,selected):null
  })
}

// The alias e is fixed by callers; all identity values remain query parameters.
export const coachEventSourceIdsSql=`ARRAY[e.title_source->>'messageId']
 || ARRAY(SELECT n.source->>'messageId' FROM coach_nodes n WHERE n.user_id=e.user_id AND n.event_id=e.id)
 || ARRAY(SELECT x::text FROM coach_actions a CROSS JOIN LATERAL unnest(a.source_message_ids) x WHERE a.user_id=e.user_id AND a.event_id=e.id)
 || ARRAY(SELECT r.source_message_id::text FROM coach_event_revisions h JOIN runs r ON r.user_id=h.user_id AND r.request_id=h.request_id WHERE h.user_id=e.user_id AND h.event_id=e.id)`
export async function coachSourceControlKey(c:PoolClient,user:string,eventId:string){
 const row=(await c.query(`SELECT ${coachEventSourceIdsSql} AS source_ids FROM coach_events e WHERE e.user_id=$1 AND e.id=$2`,[user,eventId])).rows[0]
 return row?sourceBoundaryKey(row.source_ids,await coachSourceBoundaryRefs(c,user))??'':''
}

export async function assertCoachEvidence(c:PoolClient,user:string,conversation:string,refs:{eventId:string;revision:number;generation:number;sourceControlKey?:string}[]){
  for(const ref of refs){
    let event
    try{event=await eventFor(c,user,conversation,ref.eventId,true)}catch(error){
      if(error instanceof HttpError&&error.code==='NOT_FOUND')throw new HttpError(409,'COACH_SNAPSHOT_INVALIDATED')
      throw error
    }
    if(event.revision!==ref.revision||event.generation!==ref.generation||!await currentCoachTitle(c,user,event))throw new HttpError(409,'COACH_SNAPSHOT_INVALIDATED')
    if(ref.sourceControlKey!==undefined&&await coachSourceControlKey(c,user,ref.eventId)!==ref.sourceControlKey)throw new HttpError(409,'COACH_SNAPSHOT_INVALIDATED')
  }
}

// Existing memory/experience corrections invoke this inside their transaction.
// Tombstones and source withdrawal survive subsequent retrieval and rebuilds.
export async function invalidateCoachSources(c:PoolClient,user:string,messageIds:string[],forget:boolean,scopedCorrection=false,changedQuotes?:SourceControlRef[]){
  if(!messageIds.length)return
  // This function is also called directly by maintenance/control paths. Own
  // the complete canonical order here so a withdrawal cannot slip between a
  // chronology snapshot validation and commit.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings'])
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':interview-chronology'])
  if(scopedCorrection){
    // Snapshot generation and derived drafts must still be invalidated. Source
    // availability uses the exact quotes in the correction's revision instead
    // of withdrawing unrelated facts from the whole message.
    const corrections=changedQuotes?.length?changedQuotes:await scopedMessageCorrections(c,user)
    // A clause-scoped control remains clause-scoped even when that clause is
    // the source message's entire text. Promoting it to a full coach-source
    // withdrawal would erase an independently sourced later action merely
    // because the original title occupied its own short message.
    await invalidateCoachSourceQuotes(c,user,corrections.filter(ref=>messageIds.includes(ref.messageId)),forget)
    return
  }
  const changed=(await c.query(`INSERT INTO coach_source_withdrawals(user_id,message_id,conversation_id,reason)
    SELECT user_id,id,conversation_id,$3 FROM messages WHERE user_id=$1 AND id=ANY($2::uuid[])
    ON CONFLICT(user_id,message_id) DO UPDATE SET reason=EXCLUDED.reason
      WHERE coach_source_withdrawals.reason='corrected' AND EXCLUDED.reason='forgotten'
    RETURNING message_id`,[user,messageIds,forget?'forgotten':'corrected'])).rows
  messageIds=changed.map(row=>row.message_id as string)
  if(!messageIds.length)return
  const {retireAdjacentThemeLinks}=await import('./user-themes.ts')
  await retireAdjacentThemeLinks(c,user,messageIds)
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
