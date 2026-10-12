import {createHash} from 'node:crypto'
import {stream,type AssistantMessage} from '@mariozechner/pi-ai'
import {Type,type Static} from 'typebox'
import {Value} from 'typebox/value'
import {resolveModel,modelSignatureFor,type ModelRuntime} from '../model.ts'
import {configureProviderPayload} from '../model-payload.ts'
import {providerError} from '../provider-errors.ts'
import {maximumProviderCallCostCny,estimateProviderCallCostCny} from '../cost-workload.ts'
import {CoachProviderBudget,type CoachCallReceipt} from '../../scripts/coach-provider-budget.ts'
import {config} from '../config.ts'
import {createProductionWorkflowBudget,type WorkflowProviderBudget} from './production-budget.ts'
import {assertCoachSourceFreeze} from '../../scripts/coach-source-freeze.ts'
import {WorkflowError,emptyProposal,type EvidenceReader,type EvidenceRecord,type WorkflowRequest,type AgentResult,type ReviewIssue} from './contracts.ts'
import {validateEvidence,refKey} from './evidence-gate.ts'
import type {DecisionAdapter} from './direction-decision.ts'
import type {NodeContext,WorkflowNode} from './orchestrator.ts'

const object=<T extends Parameters<typeof Type.Object>[0]>(fields:T)=>Type.Object(fields,{additionalProperties:false})
const ids=Type.Array(Type.String({minLength:1,maxLength:80}),{maxItems:12,uniqueItems:true})
const analystSchema=object({evidenceIds:ids,tradeoffIds:ids,unknownIds:ids,actionIds:ids,evidenceRelations:Type.Array(object({evidenceId:Type.String(),relation:Type.Union([Type.Literal('support'),Type.Literal('limit'),Type.Literal('unknown')])}),{maxItems:12}),actionBasis:Type.Array(object({actionId:Type.String(),evidenceIds:ids,unknownIds:ids,stageReasonId:Type.String({minLength:1,maxLength:80})}),{maxItems:12})})
const criticSchema=object({issues:Type.Array(Type.Union([
 object({severity:Type.Union([Type.Literal('blocker'),Type.Literal('needs_clarification')]),issueId:Type.Union([Type.Literal('unsupported'),Type.Literal('contradiction')]),evidenceIds:Type.Array(Type.String(),{minItems:1,maxItems:12,uniqueItems:true}),claimIds:Type.Array(Type.String(),{minItems:1,maxItems:4,uniqueItems:true})}),
 object({severity:Type.Union([Type.Literal('needs_clarification'),Type.Literal('uncertainty')]),issueId:Type.Union(['motivation','fit','unknown','adoption','role_evidence','repeatability'].map(x=>Type.Literal(x))),evidenceIds:ids,claimIds:Type.Optional(ids)})
 ]),{maxItems:12}),rejectedDirections:ids})
const synthesisSchema=object({directionOrder:ids,actionIds:ids})
export function bindWorkflowSelectionSchema(schema:ReturnType<typeof Type.Object>,context:Record<string,any>){
 // TypeBox reuses the same ids object in several properties. JSON schema is
 // declarative; detach those aliases so binding action IDs cannot replace facts.
 const bound=JSON.parse(JSON.stringify(schema)) as any
 const list=(target:any,values:string[])=>{if(!target)return;values.length?target.items={...target.items,enum:[...new Set(values)]}:target.maxItems=0}
 const item=(target:any,values:string[])=>{if(target&&values.length)target.enum=[...new Set(values)]}
 const facts=(context.facts??[]).map((x:any)=>x.id),actions=(context.actions??[]).map((x:any)=>x.id),unknowns=Object.keys(context.unknowns??{})
 const p=bound.properties
 list(p.evidenceIds,facts);list(p.tradeoffIds,Object.keys(context.tradeoffs??{}));list(p.unknownIds,unknowns);list(p.actionIds,actions)
 item(p.evidenceRelations?.items?.properties?.evidenceId,facts)
 const basis=p.actionBasis?.items?.properties
 if(basis){item(basis.actionId,actions);list(basis.evidenceIds,facts);list(basis.unknownIds,unknowns);item(basis.stageReasonId,Object.keys(context.stageReasons??{}))}
 const issues=p.issues?.items?.anyOf??[]
 for(const branch of issues){const issue=branch.properties;list(issue.evidenceIds,facts);list(issue.claimIds,(context.claims??[]).map((x:any)=>x.id))}
 list(p.rejectedDirections,(context.directions??[]).map((x:any)=>x.id))
 list(p.directionOrder,(context.alternatives??[]).map((x:any)=>x.directionId))
 return bound as typeof schema
}
const issueCatalogue={unsupported:'这条判断没有授权来源支持。',contradiction:'两条当前依据互相矛盾，需要本人核对。',motivation:'读研或工作的具体动机仍需核对。',fit:'单次经历不能证明稳定能力或长期适配。',unknown:'尚未提供的条件保持未知，不据此否定路径。',adoption:'实际交付是否被采用、反馈及效果分别缺哪项证据，仍需核对。',role_evidence:'是否有可展示作品、怎样对应目标岗位实际要求仍需核对；未提供作品时不假定存在，反馈不能替代岗位要求。',repeatability:'已有结果能否重复、是否愿意承担后续义务仍需核对；暂停时不要求扩大接单。'}
const commonTradeoffs={parallel:'多条路径同时投入会争用时间；本次仅选择一个可停止的小探索。',cost:'完整准备的时间、资金与退出代价尚未核实，先不承诺长期投入。',transfer:'若本人报告已有成果，先核对能否复用到这条路径；未报告成果就保留未知，作品存在不等于满足岗位或研究要求。',priority:'先核对本人是否有本周必须处理的课程、休息或其他义务；仅在本人明确报告时据此排序，先缩小探索，不要求同时全面投入。',motivation:'先核对这条路径想解决的实际问题；若动机尚未知，先了解具体工作或研究内容，再决定是否准备。',pause:'可以暂缓这条路径，保留重开条件；本次比较不要求立即选定长期方向。'}
// Bounded editorial reasons selected against personal evidence, then reviewed by
// the critic. The selection is not proof that a real model classified the stage correctly.
const stageReasons={explore:'方向仍不清楚时，先核实一项会影响取舍的信息；探索不要求立即承诺长期方向。',verify_result:'先核对已有尝试的实际反馈，再决定是否扩大投入；已做或交付不代表采用、付款或有效。',reuse_evidence:'先对照已有实践与目标要求，核对哪些证据能够复用，避免在未知要求上重复准备。',respect_priority:'先核对本次动作是否服务本人当前重点，尊重已改变的阶段选择与暂停边界。'}
const pathTradeoffs:Record<string,string>={employment:'就业与实习：先核对目标岗位和实际作品证据；在要求不清楚时，不承诺投递数量或就业结果。',postgraduate_exam:'考研：先区分读研想解决的问题与备考投入；报考条件、准备量和学校要求未核实时，不据此宣布适合读研。',postgraduate_recommendation:'保研：本校资格、排名与材料要求需查正式来源；有科研兴趣不等于已经具备推免资格。',entrepreneurship:'创业：想法、用户回应、采用、付款分别核对；没有反馈时先验证一个需求，保持退出选项。',independent_development:'独立开发：作品完成、有人使用与持续收益是不同阶段；先验证一个场景，避免直接承诺商业化。',freelance:'自由职业：交付、采用与付款分开；单次任务结果不自动推为稳定收入，先检查可复用证据。',overseas_study:'留学：先核对项目目标、申请条件和可承受资金；正式来源未查清前保留国内路径。',public_service:'考公考编：先了解实际工作内容并查询当期正式岗位条件；未核实资格时不承诺可报名。',undergraduate_upgrade:'专升本：先核对教育阶段和当地正式政策；通用方法不能替代当期招生要求。'}
// These are proposed exercises, not claims that a student owns resources or meets
// requirements. The analyst must choose from actual evidence; the critic reviews
// the resulting text and duration, and synthesis still cannot author new facts.
const pathActions:Record<string,{key:string;text:string;minutes:number}[]>={
 employment:[{key:'requirements',text:'选一个想了解的岗位，打开其公开说明，摘出一项职责和一项要求；没有目标岗位时先列一个待查岗位，不填造要求。',minutes:20},{key:'portfolio',text:'若已有作品，选其中一个，对照目标岗位的一项要求，写清本人做了什么、可展示的证据和仍缺什么；无作品或岗位说明就停在待补清单。',minutes:35},{key:'content',text:'读一段实际工作内容，写下一个愿意尝试的任务和一个不确定项；先了解工作，再决定是否投递。',minutes:15}],
 postgraduate_exam:[{key:'motivation',text:'写下读研想解决的一个问题，区分研究兴趣、学历需求与暂时避开就业；不能确定时记为未知，不直接开始全面备考。',minutes:15},{key:'preview',text:'选一个感兴趣的公开研究摘要，读问题与方法，写下想追问的一个问题；看不懂时标出卡点，不把一次阅读当作科研适配结论。',minutes:30},{key:'requirements',text:'选择一个待了解的院校项目，查其正式招生说明，记录适用年份、来源和一项尚待核对的要求；未找到当前正式说明就停止资格判断。',minutes:20}],
 postgraduate_recommendation:[{key:'requirements',text:'查本校当前正式推免说明，记录适用年份和一项待核对条件；不据兴趣或成绩片段宣称具备资格。',minutes:20},{key:'preview',text:'读一个感兴趣的研究摘要，记录问题、方法和一个卡点；只增加探索证据，不判定稳定科研能力。',minutes:30}],
 entrepreneurship:[{key:'hypothesis',text:'写下一个具体需求假设和现有反馈分别支持什么；没有反馈时列为未知，先选一个待验证问题。',minutes:15},{key:'feedback',text:'若有一次实际反馈，逐项核对需求、回应、采用和付款的原话；无证据项保留未知，再选一个最小验证点。',minutes:25}],
 independent_development:[{key:'scenario',text:'选一个具体使用场景，写出用户任务与一个可停止的原型范围；先验证问题，不承诺商业化。',minutes:20},{key:'evidence',text:'若已有原型，检查一条实际使用反馈与一个仍未验证的条件；没有使用反馈就停在待测清单。',minutes:30}],
 freelance:[{key:'delivery',text:'核对一项实际交付、采用与付款的来源；没发生或未知分别记录，不推断稳定收入。',minutes:15},{key:'scope',text:'起草一次任务的交付范围、验收问题与退出条件；金额、对象和约定尚未提供时留空，不自动对外联系。',minutes:25}],
 overseas_study:[{key:'requirements',text:'查一个待了解项目的正式申请说明，记录适用年份和待核对的条件；不自动判断资格。',minutes:20},{key:'cost',text:'列出学费、生活费和可用资金的待核对项，每项留来源位置；未核实金额留空，再决定是否继续了解。',minutes:15}],
 public_service:[{key:'content',text:'先读一个岗位的公开职责，记下一个愿意尝试的工作任务与一个不确定项。',minutes:15},{key:'requirements',text:'查当期正式岗位说明，记录来源、年份和待核对条件；未核实个人资格时不承诺可报名。',minutes:20}],
 undergraduate_upgrade:[{key:'requirements',text:'核对本人教育阶段与当地当期正式招生说明，列一项待核实条件；不以通用方法替代政策。',minutes:20},{key:'gap',text:'选一段已经做过的练习，标出一个具体卡点与缺少的依据；无练习记录时先列待诊断内容。',minutes:15}]
}
type Reserved={receipt:CoachCallReceipt;started:boolean}
export type ProviderNodeAudit={callId:string;nodeId:string;providerResponseId:string|null;usage:unknown;costCny:number|null;outcome:string;failureCode?:string|null;modelSignature:string;sourceDigest:string;decisionInputDigest:string|null}

// Production uses this factory and the existing native SDK, never an alternate
// HTTP/provider ledger. Synthetic transport tests exercise this exact factory.
export function createRuntimeDecisionAdapter(input:{readEvidence:EvidenceReader;readMethods?:(request:WorkflowRequest)=>Promise<Record<string,unknown>[]>;freezePath:string;budget?:WorkflowProviderBudget;runtime?:ModelRuntime;syntheticTransport?:boolean;observeSyntheticSelection?:(request:WorkflowRequest,nodeId:string,selection:unknown)=>Promise<void>;audit?:(request:WorkflowRequest,row:ProviderNodeAudit)=>Promise<void>}):DecisionAdapter{
 const runtime=input.runtime??resolveModel('default'),budget:WorkflowProviderBudget=input.budget??(config.production?createProductionWorkflowBudget():new CoachProviderBudget()),outputLimit=2048
 if(input.syntheticTransport&&!budget.path.includes('simulation'))throw new WorkflowError('scope_denied')
 if(input.syntheticTransport&&!['127.0.0.1','localhost','::1','[::1]'].includes(new URL(runtime.model.baseUrl!).hostname))throw new WorkflowError('scope_denied')
 const maximum=maximumProviderCallCostCny(runtime.model.contextWindow,outputLimit,runtime.pricing)
 if(typeof maximum!=='number'||!runtime.available)throw new WorkflowError('unavailable')
 const reservations=new Map<string,Map<string,Reserved>>()
 const key=(r:WorkflowRequest)=>r.internalActorKey+':'+r.requestId
 const sourceDigest=()=>assertCoachSourceFreeze(input.freezePath)
 const signature=()=>createHash('sha256').update(JSON.stringify({runtime:modelSignatureFor(runtime.tier),pricing:runtime.pricing,outputLimit,schemas:[analystSchema,criticSchema,synthesisSchema],pathActions,pathTradeoffs,issueCatalogue,commonTradeoffs,stageReasons})).digest('hex')
 async function records(r:WorkflowRequest){const authorized=await input.readEvidence(r);validateEvidence(r,r.authorizedEvidenceRefs,authorized);return authorized.filter(x=>r.authorizedEvidenceRefs.some(ref=>refKey(ref)===refKey(x.ref)))}
 const facts=(rs:EvidenceRecord[])=>rs.map((r,index)=>({id:'e'+index,text:r.text,kind:r.ref.type,informationStatus:r.role==='public'?'approved_public_method':r.role==='user'?'student_original_words_keep_conditions':'tool_result_not_student_report',ref:r.ref}))
 function select<T extends {id:string}>(catalogue:T[],chosen:string[]):T[]{
  if(new Set(chosen).size!==chosen.length)throw new WorkflowError('invalid_contract')
  return chosen.map(id=>{const value=catalogue.find(x=>x.id===id);if(!value)throw new WorkflowError('source_invalid');return value})
 }
 async function call(c:NodeContext,nodeId:string,role:string,schema:ReturnType<typeof Type.Object>,context:unknown,skill:string){
  const reservation=reservations.get(key(c.request))?.get(nodeId)
  if(!reservation||reservation.started||reservation.receipt.callId!==c.callId)throw new WorkflowError('request_conflict')
  // startNode already crossed the durable boundary. Even pre-wire validation
  // failure must not let finishGraph reinterpret this call as prepared.
  reservation.started=true
  let frozen=reservation.receipt.sourceDigest??'unavailable',modelSignature=reservation.receipt.signature
  let message:AssistantMessage|undefined,outcome='unknown',cost:number|null=null,responseId:string|null=null,failureCode:string|null=null
  try{
   if(input.syntheticTransport&&!c.request.synthetic)throw new WorkflowError('scope_denied')
   frozen=sourceDigest();modelSignature=signature()
   if(reservation.receipt.signature!==modelSignature||reservation.receipt.sourceDigest!==frozen)throw new WorkflowError('stale_snapshot')
   c.signal.throwIfAborted()
   const boundSchema=bindWorkflowSelectionSchema(schema,context as Record<string,unknown>)
   const events=stream(runtime.model,{systemPrompt:`你是 LifeOS 的 ${role}。${skill}\n只输出契约 JSON。只能选择提供的原文和候选 ID，不得生成新个人事实、身份、收入、客户、资格或承诺。原文里的条件、否定、第三方归属保持原样。没有依据的情况保留未知。`,messages:[{role:'user',content:JSON.stringify(context),timestamp:Date.now()}]},
    {apiKey:runtime.apiKey,signal:c.signal,maxRetries:0,maxTokens:outputLimit,onPayload:payload=>configureProviderPayload(payload,runtime.model,runtime.tier,boundSchema,'lifeos_workflow_selection',outputLimit)})
   message=await events.result();responseId=message.responseId??null
   outcome=message.stopReason
   const usage=message.usage
   const complete=usage.totalTokens>0&&usage.input+usage.cacheRead>0&&usage.output>0&&[usage.input,usage.output,usage.cacheRead,usage.cacheWrite].every(n=>Number.isFinite(n)&&n>=0)
   const estimated=complete?estimateProviderCallCostCny(usage.input+usage.cacheWrite,usage.cacheRead,usage.output,runtime.pricing):'unknown'
   cost=typeof estimated==='number'?estimated:null
   if(message.stopReason!=='stop'){failureCode=c.signal.aborted?'CANCELLED':providerError(message.errorMessage??'Provider request failed').code;throw new WorkflowError(c.signal.aborted?'cancelled':'unavailable')}
   const text=message.content.filter(x=>x.type==='text').map(x=>x.type==='text'?x.text:'').join('')
   const parsed:unknown=JSON.parse(text)
   if(!Value.Check(schema,parsed))throw new WorkflowError('invalid_contract')
   if(!Value.Check(boundSchema,parsed))throw new WorkflowError('source_invalid')
   if(input.observeSyntheticSelection){
    if(!c.request.synthetic)throw new WorkflowError('scope_denied')
    await input.observeSyntheticSelection(c.request,nodeId,parsed)
   }
   c.signal.throwIfAborted();await records(c.request)
   return {parsed,costCny:cost,providerCalls:1}
  }catch(error){
   failureCode??=error instanceof WorkflowError?'WORKFLOW_'+error.code:error instanceof SyntaxError?'MODEL_OUTPUT_INVALID_JSON':'SDK_REQUEST_FAILED'
   throw error
  }finally{
   // Missing usage remains unknown, including aborts and transport exceptions.
   try{await budget.finish(reservation.receipt.callId,{outcome,usage:message?.usage??'unknown',estimatedCostCny:cost??'unknown',providerResponseId:responseId})}
   finally{
    const ctx=context as any,analystContext=ctx.paths?.[0]??(ctx.path?ctx:null)
    const withoutStorageId=({id,...ref}:any)=>ref
    const comparableBudget=analystContext?.timeBudget?{...analystContext.timeBudget,source:withoutStorageId(analystContext.timeBudget.source)}:null
    const decisionInputDigest=analystContext?createHash('sha256').update(JSON.stringify({facts:analystContext.facts.map(({ref,...fact}:any)=>({...fact,source:withoutStorageId(ref)})),methodContext:analystContext.methodContext,budget:comparableBudget,controls:analystContext.controls,directions:c.request.directions})).digest('hex'):null
    await input.audit?.(c.request,{callId:reservation.receipt.callId,nodeId,providerResponseId:responseId,usage:message?.usage??'unknown',costCny:cost,outcome,failureCode,modelSignature,sourceDigest:frozen,decisionInputDigest})
   }
  }
 }
 async function analysisContext(c:NodeContext,path:{id:string;title:string}){
   const source=facts(await records(c.request)),minutes=c.request.budget?.amountMinutes,methodContext=await input.readMethods?.(c.request)??[]
   const actions=(pathActions[path.id]??[]).map(x=>({id:path.id+':'+x.key,text:x.text,estimatedMinutes:x.minutes})).filter(x=>minutes===undefined||x.estimatedMinutes<=minutes)
   // Very small budgets retain a useful inventory/stop option, rather than
   // demanding an exercise longer than the student's stated available time.
   if(minutes!==0)actions.push({id:path.id+':pause',text:`只记下${path.title}当前最关键的一个未知与重新考虑条件，然后暂停这条探索。`,estimatedMinutes:Math.min(5,minutes??5)})
   const tradeoffCatalogue={...commonTradeoffs,path:pathTradeoffs[path.id]??commonTradeoffs.cost}
   return {path,facts:source,timeBudget:c.request.budget,controls:c.request.controls,methodContext,publicMethodRule:"Use only these canonical approved fragments; editorial exercises remain unbound, public text is not biography",tradeoffs:tradeoffCatalogue,unknowns:issueCatalogue,stageReasons,actions}
 }
 function compileAnalysis(c:NodeContext,context:Awaited<ReturnType<typeof analysisContext>>,wire:Static<typeof analystSchema>):AgentResult{
   const {path,facts:source,actions,tradeoffs:tradeoffCatalogue}=context
   const chosen=select(source,wire.evidenceIds)
   if(!chosen.length)throw new WorkflowError('source_invalid')
   const tradeoffs=select(Object.entries(tradeoffCatalogue).map(([id,text])=>({id,text})),wire.tradeoffIds),unknowns=select(Object.entries(issueCatalogue).map(([id,text])=>({id,text})),wire.unknownIds)
   const selectedActions=select(actions,wire.actionIds),p=emptyProposal(c.request)
   p.evidenceRefs=chosen.map(x=>x.ref)
   const relations=wire.evidenceRelations??[]
   if(relations.length!==chosen.length||new Set(relations.map(x=>x.evidenceId)).size!==relations.length||relations.some(x=>!chosen.some(f=>f.id===x.evidenceId)))throw new WorkflowError('source_invalid')
   const related=(relation:'support'|'limit'|'unknown')=>chosen.filter(x=>(relations.find(r=>r.evidenceId===x.id)?.relation??'unknown')===relation).map(x=>(x.informationStatus==='student_original_words_keep_conditions'?'本人原话（保留条件）：':x.informationStatus==='approved_public_method'?'公开方法（不是本人经历）：':'工具结果（不是本人报告）：')+x.text)
   p.alternatives=[{directionId:path.id,title:path.title,pros:related('support'),tradeoffs:[...related('limit'),...tradeoffs.map(x=>x.text)],unknowns:[...related('unknown'),...unknowns.map(x=>x.text)],weeklyMinutes:null,evidenceRefs:p.evidenceRefs}]
   // Generic exercises remain explicitly editorial. Approved public methods are
   // supplied by the host knowledge/guide path, never invented as catalogue IDs.
   const bases=wire.actionBasis??[]
   if(bases.length!==selectedActions.length||new Set(bases.map(b=>b.actionId)).size!==bases.length||bases.some(b=>!selectedActions.some(a=>a.id===b.actionId)||!b.evidenceIds.length||b.evidenceIds.some(id=>!chosen.some(f=>f.id===id&&f.informationStatus==='student_original_words_keep_conditions'))||b.unknownIds.some(id=>!wire.unknownIds.includes(id))||b.stageReasonId&&!Object.hasOwn(stageReasons,b.stageReasonId)))throw new WorkflowError('source_invalid')
   p.nextActions=selectedActions.map(x=>{
    const basis=bases.find(b=>b.actionId===x.id),personal=basis?select(chosen,basis.evidenceIds):[],gaps=basis?select(Object.entries(issueCatalogue).map(([id,text])=>({id,text})),basis.unknownIds):[]
    const labels={support:'支持',limit:'限制',unknown:'未知'}
    const stage=basis?.stageReasonId?stageReasons[basis.stageReasonId as keyof typeof stageReasons]:'阶段适用性尚未说明，需核对后再采纳。'
    const connection=basis?`个人依据（原话片段；完整条件见依据）：${personal.map(f=>`[${labels[relations.find(r=>r.evidenceId===f.id)?.relation??'unknown']}] ${f.text.length>120?f.text.slice(0,120)+'…':f.text}`).join('；')}；仍需核对：${gaps.slice(0,2).map(g=>g.text).join('；')||'本行动是否产生新反馈尚未知'}；阶段适用性（分析候选，尚待核对）：${stage}；`:'个人依据与行动缺口的具体连接尚未说明；阶段适用性尚未说明，需核对后再采纳；'
    return {description:'LifeOS 编辑建议（未绑定公开攻略）：'+x.text,estimatedMinutes:x.estimatedMinutes,stopCondition:`${connection}到可调整的建议投入上限${x.estimatedMinutes}分钟或发现必需材料缺失时停止；不自动对外联系。`,evidenceRefs:basis?personal.map(f=>f.ref):p.evidenceRefs,directionId:path.id}
   })
   return {evidenceRefs:p.evidenceRefs,summary:'已选择该路径的授权依据与小探索',issues:[],proposal:p}
 }
 return {executionKind:input.syntheticTransport?'simulated_provider':'real_provider',maxCostPerCallCny:maximum,
  readNodeAccounting(r,nodeId){
   const entry=reservations.get(key(r))?.get(nodeId),receipt=entry?budget.snapshot().calls.find((call:CoachCallReceipt)=>call.callId===entry.receipt.callId):undefined
   return receipt?.status==='finished'&&typeof receipt.estimatedCostCny==='number'?{costCny:receipt.estimatedCostCny,providerCalls:receipt.outcome==='not_sent'?0:1}:null
  },
  async prepareGraph(r,nodes,signal){
   signal?.throwIfAborted()
   if(input.syntheticTransport&&!r.synthetic)throw new WorkflowError('scope_denied')
   const frozen=sourceDigest(),paid=nodes.filter(n=>n.executionKind!=='local_deterministic')
   const reading=records(r)
   if(signal){
    let abort:()=>void=()=>{}
    try{await Promise.race([reading,new Promise<never>((_,reject)=>{abort=()=>reject(new WorkflowError('cancelled'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()})])}
    finally{signal.removeEventListener('abort',abort)}
   }else await reading
   signal?.throwIfAborted()
   if(paid.length>5||paid.length>r.modelBudget.maxProviderCalls||paid.reduce((s,n)=>s+n.maxCostCny,0)>r.modelBudget.maxCostCny)throw new WorkflowError('budget_exceeded')
   const receipts=await budget.reserveGraph(paid.map(n=>({runId:r.requestId,purpose:'diagnostic',tier:runtime.tier,provider:runtime.model.provider,model:runtime.model.id,signature:signature(),sourceDigest:frozen,logicalCallId:createHash('sha256').update(key(r)+':'+n.id).digest('hex'),reservedCostCny:n.maxCostCny})),r.internalActorKey,signal)
   const map=new Map<string,Reserved>();paid.forEach((n,index)=>{n.callId=receipts[index].callId;map.set(n.id,{receipt:receipts[index],started:false})});reservations.set(key(r),map)
  },
  async finishGraph(r){
   const errors:unknown[]=[]
   for(const entry of reservations.get(key(r))?.values()??[])if(!entry.started){try{await budget.finish(entry.receipt.callId,{outcome:'not_sent',usage:{providerCalls:0},estimatedCostCny:0,providerResponseId:null})}catch(error){errors.push(error)}}
   try{await budget.releasePreparedGraph?.(r.requestId,r.internalActorKey)}catch(error){errors.push(error)}
   if(errors.length)throw new AggregateError(errors,'WORKFLOW_RESERVATION_CLEANUP_FAILED')
   reservations.delete(key(r))
  },
  async analyze(c,path,skill){
   const context=await analysisContext(c,path)
   const output=await call(c,'path:'+path.id,'路径分析者：按本人的当前目的、已有成果、关键缺口与本周义务，选择最能推进当前问题的取舍；用actionBasis把每项行动连接到已选择的个人evidenceIds与仍缺的unknownIds，并选择有本人依据支持的stageReasonId解释为什么适合当前阶段。公共方法与工具结果不能当作本人经历；evidenceRelations逐条说明个人依据是支持、限制还是未知。依据必须来自当前授权事实，未知只选择实际影响这次取舍的项。没有可用时间时行动为空，允许暂缓。相同条件允许同建议；姓名、语气不影响选择。不要把一次成果推为长期适配；缺作品、动机或资格时保留未知。动作时间只是建议投入上限，不是本人已有安排。',analystSchema,context,skill)
   return {result:compileAnalysis(c,context,output.parsed as Static<typeof analystSchema>),costCny:output.costCny,providerCalls:1}
  },
  async analyzeTogether(c,paths,skill){
   const contexts=await Promise.all(paths.map(path=>analysisContext(c,path)))
   const selections=object(Object.fromEntries(contexts.map(ctx=>[ctx.path.id,bindWorkflowSelectionSchema(analystSchema,ctx)])))
   const schema=object({selections,directionOrder:Type.Array(Type.Union(paths.map(p=>Type.Literal(p.id))),{minItems:paths.length,maxItems:paths.length,uniqueItems:true}),actionIds:Type.Array(Type.String(),{maxItems:12,uniqueItems:true})})
   const context={paths:contexts,alternatives:paths.map(p=>({directionId:p.id})),actions:contexts.flatMap(x=>x.actions),timeBudget:c.request.budget}
   const output=await call(c,'single_decision','单次决策：在同一份授权个人事实、规范方法、方向与预算内分析所有paths。每个selections使用该路径目录；事实关系区分支持、限制、未知，每个行动说明个人依据、待核对项和阶段原因。directionOrder覆盖所有方向，actionIds只从对应已选择行动中取，所有行动总投入不超过timeBudget。公共方法不是本人经历，未知不得填造，允许暂停或空行动。不新增事实。',schema,context,skill)
   const wire=output.parsed as {selections:Record<string,Static<typeof analystSchema>>;directionOrder:string[];actionIds:string[]}
   const analyses=contexts.map(ctx=>compileAnalysis(c,ctx,wire.selections[ctx.path.id])),p=emptyProposal(c.request)
   p.evidenceRefs=c.request.authorizedEvidenceRefs
   p.alternatives=select(analyses.flatMap(x=>x.proposal!.alternatives).map(a=>({...a,id:a.directionId})),wire.directionOrder).map(({id,...a})=>a)
   const actions=analyses.flatMap((a,index)=>a.proposal!.nextActions.map((action,j)=>({id:wire.selections[contexts[index].path.id].actionIds[j],action})))
   p.nextActions=select(actions,wire.actionIds).map(x=>x.action)
   return {result:{evidenceRefs:p.evidenceRefs,summary:'单次生成的同范围决策候选；没有独立批评回合',issues:[],proposal:p},costCny:output.costCny,providerCalls:1}
  },
  async critic(c,analyses,skill){
   await input.readMethods?.(c.request)
   const source=facts(await records(c.request)),claims=analyses.flatMap((analysis,index)=>{
    const p=analysis.proposal!,items=p.alternatives.flatMap(a=>(['pros','tradeoffs','unknowns'] as const).flatMap(field=>a[field].map((text,i)=>({id:'p'+index+':'+field+':'+i,text,kind:field,directionId:a.directionId}))))
    return [...items,...p.nextActions.map((a,i)=>({id:'p'+index+':action:'+i,text:a.description+' '+a.stopCondition,kind:'editorial_exercise',directionId:a.directionId}))]
   }),output=await call(c,'critic','独立审阅者：审查claims里的实际候选表述，不是判定学生应已具备完整档案。issues只是可选问题目录，不是已发现的问题；只选实际发生的项，没有问题就issues=[]。unknowns和条件式编辑探索明确保留未知，不构成unsupported或blocker。动机、采用、付款、效果、岗位要求未知只能uncertainty/needs_clarification，不否定路径。只有具体候选声称本人已做到未提供的事实、违反明确限制或与原话相反，才选unsupported/contradiction，并用claimIds定位实际错误的表述，evidenceIds定位对照原话。rejectedDirections只允许已用上述blocker定位的方向，不因没有实践/资格/动机而拒绝探索。编辑动作的可调整分钟上限不是学生已有安排；不把带若/未核对/未知的表述当肯定事实。公共方法不是本人经历，仍严格审查。',criticSchema,{facts:source,claims,analyses,directions:c.request.directions,timeBudget:c.request.budget,issues:issueCatalogue},skill)
   const wire=output.parsed as Static<typeof criticSchema>,issues:ReviewIssue[]=wire.issues.map(issue=>({severity:issue.severity,category:issue.issueId==='unsupported'?'evidence':issue.issueId==='contradiction'?'constraint':'unknown',affectedClaims:issue.claimIds??issue.evidenceIds,resolution:issue.severity==='blocker'?'blocked':issue.severity==='needs_clarification'?'ask_user':'keep_unknown',text:select(Object.entries(issueCatalogue).map(([id,text])=>({id,text})),[issue.issueId])[0].text,evidenceRefs:select(source,issue.evidenceIds).map(x=>x.ref)}))
   select(c.request.directions,wire.rejectedDirections)
   if(wire.rejectedDirections.some(direction=>!wire.issues.some(issue=>issue.severity==='blocker'&&issue.claimIds?.some(id=>claims.find(claim=>claim.id===id)?.directionId===direction))))throw new WorkflowError('invalid_contract')
   for(const issue of wire.issues)if(issue.claimIds)select(claims,issue.claimIds)
   // Unknowns remain visible; an actual cited blocker still stops the graph.
   issues.forEach((issue,index)=>{const selected=wire.issues[index].claimIds??[];if(selected.length)issue.text+=' 实际候选：'+select(claims,selected).map(claim=>claim.text).join('；')})
   return {result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'独立审阅已完成，未定条件保持未知',issues},costCny:output.costCny,providerCalls:1}
  },
  async synthesize(c,analyses,critic,skill){
   await input.readMethods?.(c.request)
   const alternatives=analyses.flatMap(x=>x.proposal?.alternatives??[]),actions=analyses.flatMap(x=>x.proposal?.nextActions??[]).map((action,index)=>({id:'a'+index,action}))
   const output=await call(c,'synthesis','最终综合者：排序已审候选，选择可开始的动作；零时间时保留空行动，允许暂缓，不新增事实或自动改目标',synthesisSchema,{alternatives,actions,critic,timeBudget:c.request.budget},skill)
   const wire=output.parsed as Static<typeof synthesisSchema>,p=emptyProposal(c.request)
   p.evidenceRefs=c.request.authorizedEvidenceRefs
   p.alternatives=select(alternatives.map(a=>({...a,id:a.directionId})),wire.directionOrder).map(({id,...a})=>a)
   p.nextActions=select(actions,wire.actionIds).map(x=>x.action)
   return {result:{evidenceRefs:p.evidenceRefs,summary:'已整理通过审阅的候选，等待本人选择',issues:[],proposal:p},costCny:output.costCny,providerCalls:1}
  }
 }
}
