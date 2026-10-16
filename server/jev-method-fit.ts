import type {KnowledgeCard} from './campus-knowledge.ts'
import {deduplicateGuides,type KnowledgeIntent} from './evergreen-guide.ts'

const endpoint='https://api.typesafe.ai/v1/systemone',model='jev-1.14.0'
const states=['applicable','missing_prerequisite','needs_clarification','unsuitable'] as const
type FitState=typeof states[number]
type TransportResponse={ok:boolean;status:number;json():Promise<unknown>}
export type JevTransport=(url:string,init:RequestInit)=>Promise<TransportResponse>
export type JevMethodFitTrace={
 status:'skipped'|'selected'|'fallback';reason:string;model:string;latencyMs:number;candidateCount:number
 candidates:{id:string;revision:number}[];selected:{id:string;revision:number}[]
 decisions?:{id:string;revision:number;state:FitState}[];usage?:{inputTokens:number;outputTokens:number};cost?:{currency:'USD';amount:number;basis:'published_input_rate';inputUsdPerMillion:number}
}
export type JevMethodFitResult={cards:KnowledgeCard[];trace:JevMethodFitTrace}
export type JevMethodFitOptions={enabled?:boolean;apiKey?:string;timeoutMs?:number;transport?:JevTransport;signal?:AbortSignal}

const configured=(options:JevMethodFitOptions)=>({
 enabled:options.enabled??process.env.LIFEOS_JEV_METHOD_FIT==='true',
 apiKey:options.apiKey??process.env.TYPESAFE_API_KEY?.trim()??'',
 timeoutMs:Math.max(100,Math.min(3000,options.timeoutMs??Number(process.env.LIFEOS_JEV_TIMEOUT_MS??1200))),
 transport:options.transport??fetch,
 signal:options.signal,
})
const ref=(card:KnowledgeCard)=>({id:card.id,revision:card.revision})
const safeOriginal=(cards:KnowledgeCard[])=>deduplicateGuides(cards,2)
const directMatch=(cards:KnowledgeCard[],text:string)=>{
 const matches=cards.filter(card=>[card.title,...(card.guide?.aliases??[])].some(label=>label.trim().length>=2&&text.includes(label.trim())))
 return matches.length===1?matches[0]:null
}
const candidateState=(card:KnowledgeCard)=>({
 id:card.id,revision:card.revision,title:card.title,scope:card.scope,limitations:card.limitations,
 prerequisites:card.guide?.prerequisites??[],exclusions:card.guide?.exclusions??[],
 branches:(card.guide?.branches??[]).map(branch=>({id:branch.id,task:branch.task,stage:branch.stage,steps:branch.steps.map(step=>({id:step.id,text:step.text}))})),
})
const validAnswer=(value:unknown):value is {type:'choice';choice:FitState;confidence:number;probabilities:Record<FitState,number>}=>{
 if(!value||typeof value!=='object')return false
 const row=value as Record<string,unknown>,probabilities=row.probabilities
 return row.type==='choice'&&states.includes(row.choice as FitState)&&typeof row.confidence==='number'&&Number.isFinite(row.confidence)&&row.confidence>=0&&row.confidence<=1&&!!probabilities&&typeof probabilities==='object'&&states.every(state=>typeof (probabilities as Record<string,unknown>)[state]==='number'&&Number.isFinite((probabilities as Record<string,number>)[state]))
}

/** Optional pre-generation selector. It can only retain existing approved candidates. */
export async function selectJevMethodCandidates(cards:KnowledgeCard[],text:string,intent:KnowledgeIntent,options:JevMethodFitOptions={}):Promise<JevMethodFitResult>{
 const candidates=deduplicateGuides(cards.filter(card=>Boolean(card.guide)),5),cfg=configured(options),original=safeOriginal(cards)
 const skip=(reason:string):JevMethodFitResult=>({cards:original,trace:{status:'skipped',reason,model,candidateCount:candidates.length,latencyMs:0,candidates:candidates.map(ref),selected:original.map(ref)}})
 const merge=(methods:KnowledgeCard[])=>deduplicateGuides(cards.filter(card=>!card.guide||methods.some(method=>method.id===card.id&&method.revision===card.revision)),2)
 if(!cfg.enabled)return skip('disabled')
 if(!/^[\x21-\x7e]{20,200}$/.test(cfg.apiKey))return skip('credential_missing')
 const changedPrerequisite=intent.continuation&&intent.stage==='adjust'&&/(?:没有|没找到|缺少|缺了|用不了|打不开|条件变|资源不足|前提|示例).{0,18}(?:了|怎么办|怎么做)?/.test(text)
 if(intent.continuation&&!changedPrerequisite)return skip('continuation')
 if(['NONE','CLARIFY'].includes(intent.decision))return skip('intent_not_eligible')
 if(candidates.length<2&&!changedPrerequisite)return skip(candidates.length?'single_candidate':'no_candidates')
 const clear=directMatch(candidates,text)
 if(clear&&intent.stage==='start'){const selected=merge([clear]);return {cards:selected,trace:{status:'skipped',reason:'clear_candidate',model,candidateCount:candidates.length,latencyMs:0,candidates:candidates.map(ref),selected:selected.map(ref)}}}
 const questions=Object.fromEntries(candidates.map((_,i)=>['candidate_'+i,{type:'choice',instructions:'判断该候选方法对当前请求是否可直接使用。未知条件不能推断为满足；只判断方法条件，不评价回答质量或人生适配。',criteria:{applicable:'已知条件满足，可直接采用候选中的相关步骤',missing_prerequisite:'候选明确要求的前提已知不满足',needs_clarification:'关键前提未知，需要先核对一个条件',unsuitable:'目标、阶段或排除条件与当前请求不匹配'}}]))
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort('timeout'),cfg.timeoutMs)
 const onAbort=()=>controller.abort(cfg.signal?.reason);cfg.signal?.addEventListener('abort',onAbort,{once:true})
 const started=performance.now()
 try{
  const response=await cfg.transport(endpoint,{method:'POST',headers:{Authorization:'Bearer '+cfg.apiKey,'Content-Type':'application/json'},body:JSON.stringify({model,state:{request:text.slice(0,2400),candidates:candidates.map(candidateState)},questions}),signal:controller.signal})
  if(!response.ok)throw new Error('http_'+response.status)
  const body=await response.json() as any
  if(body?.model!==model||!body.answers||typeof body.answers!=='object'||!Number.isInteger(body.usage?.input_tokens)||body.usage.input_tokens<0||!Number.isInteger(body.usage?.output_tokens)||body.usage.output_tokens<0)throw new Error('invalid_response')
  const decisions=candidates.map((card,i)=>{const answer=body.answers['candidate_'+i];if(!validAnswer(answer))throw new Error('invalid_answer');return {...ref(card),state:answer.choice}})
  const applicable=candidates.filter((_,i)=>decisions[i].state==='applicable'),effectiveApplicable=clear?applicable.filter(card=>card.id===clear.id):applicable,selected=merge(effectiveApplicable)
  const inputUsdPerMillion=.042
  return {cards:selected,trace:{status:'selected',reason:effectiveApplicable.length?'applicable_candidates':'no_applicable_candidate',model,latencyMs:Math.round(performance.now()-started),candidateCount:candidates.length,candidates:candidates.map(ref),selected:selected.map(ref),decisions,usage:{inputTokens:body.usage.input_tokens,outputTokens:body.usage.output_tokens},cost:{currency:'USD',amount:Number((body.usage.input_tokens*inputUsdPerMillion/1_000_000).toFixed(10)),basis:'published_input_rate',inputUsdPerMillion}}}
 }catch(error){
  cfg.signal?.throwIfAborted()
  const kept=original
  return {cards:kept,trace:{status:'fallback',reason:'request_failed',model,latencyMs:Math.round(performance.now()-started),candidateCount:candidates.length,candidates:candidates.map(ref),selected:kept.map(ref)}}
 }finally{clearTimeout(timer);cfg.signal?.removeEventListener('abort',onAbort)}
}
