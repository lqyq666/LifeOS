import type { PoolClient } from 'pg'
import { pool, transaction, HttpError } from './db.ts'
import { config } from './config.ts'
import { validPolicyScope, validPolicyScopeRules, policyScopeEvidence, type KnowledgeCard, type KnowledgeRecord } from './campus-knowledge.ts'
import type { CoachCitation } from './action-coach-contracts.ts'
import {retrieveIndexedKnowledge} from './knowledge-index.ts'
import {guideIsUsable,type KnowledgeIntent} from './evergreen-guide.ts'
import {unsupportedMethodAssertion} from './evergreen-scope-guard.ts'

export type CoachKnowledgeRef={sourceId:string;revision:number}
const isolated=/^lifeos_dialogue_(?:test|live)_/.test(new URL(config.databaseUrl).pathname.slice(1))
const valid=(row:KnowledgeRecord&{official_current?:boolean;kb_current?:boolean})=>row.status==='verified'&&row.official_current!==false&&row.kb_current!==false&&guideIsUsable(row.payload)&&(!row.synthetic||isolated)&&(!row.valid_until||Date.parse(row.valid_until)>Date.now())
  // N3.1: legacy cards auto-imported from the old Coze path (retrieval-year
  // pseudo-verification) are excluded from valid knowledge — data kept for
  // audit, never citable again.
  &&!(row.payload.mechanisms??[]).includes('coze_public_knowledge_retrieval')
// Policy scope is a lookup prerequisite, never inferred from a school/major or a similar event.
export function coachPolicyScope(text:string){
  const labels:Record<string,string>={institution:'institution|机构',department:'department|学院',project:'project|项目',year:'year|年份',population:'population|对象'}
  const result:Record<string,string>={}
  for(const [key,label] of Object.entries(labels)){
    const values=[...text.matchAll(new RegExp('(?:^|[，,。；;\\s])(?:'+label+')[=：:]\\s*([^，,。；;\\s]+)','g'))].map(match=>match[1])
    if(new Set(values).size===1)result[key]=values[0]
  }
  return result
}
export function policyApplies(card:KnowledgeCard,text:string){
  if(card.kind!=='policy')return true
  const current=coachPolicyScope(text)
  if(card.scopeRules){
    if(card.scopeKeys||!validPolicyScopeRules(card.scopeRules,policyScopeEvidence(card)))return false
    // Broad/not-applicable ranges are maintenance-reviewed source statements,
    // never inferred from missing fields. Unknown always abstains, not a wildcard.
    return Object.entries(card.scopeRules).every(([key,rule])=>rule.status==='specific'?rule.value===current[key]:rule.status==='all'||rule.status==='not_applicable')
  }
  return validPolicyScope(card.scopeKeys)&&Object.entries(card.scopeKeys).every(([key,value])=>value===current[key])
}

export async function retrieveCoachKnowledge(query:string,signal?:AbortSignal,intent?:KnowledgeIntent):Promise<KnowledgeCard[]>{
  const result=await retrieveCoachKnowledgeCandidates(query,signal,intent)
  return result.cards
}
export async function retrieveCoachKnowledgeCandidates(query:string,signal?:AbortSignal,intent?:KnowledgeIntent){
  return retrieveIndexedKnowledge(query,signal,intent,card=>policyApplies(card,query)&&!(card.mechanisms??[]).includes('coze_public_knowledge_retrieval'))
}

export async function assertCoachKnowledge(c:PoolClient,refs:CoachKnowledgeRef[]){
  const versions=new Map<string,number>()
  for(const ref of refs){if(versions.has(ref.sourceId)&&versions.get(ref.sourceId)!==ref.revision)throw new HttpError(409,'COACH_KNOWLEDGE_INVALIDATED');versions.set(ref.sourceId,ref.revision)}
  // Sorted shared row locks serialize with local maintenance updates through commit.
  for(const ref of [...new Map(refs.map(ref=>[ref.sourceId,ref])).values()].sort((a,b)=>a.sourceId.localeCompare(b.sourceId))){
    const row=(await c.query('SELECT *,official_knowledge_current(payload) AS official_current,kb_knowledge_current(payload) AS kb_current FROM campus_knowledge WHERE id=$1 FOR SHARE',[ref.sourceId])).rows[0] as KnowledgeRecord|undefined
    if(!row||!valid(row)||row.revision!==ref.revision)throw new HttpError(409,'COACH_KNOWLEDGE_INVALIDATED')
    for(const [id,revision] of Object.entries(row.payload.guide?.review?.sourceRevisions??{}).sort(([a],[b])=>a.localeCompare(b))){
      const source=(await c.query('SELECT status FROM kb_sources WHERE source_id=$1 AND revision=$2 FOR SHARE',[id,revision])).rows[0]
      if(source?.status!=='body_accessible')throw new HttpError(409,'COACH_KNOWLEDGE_INVALIDATED')
    }
  }
}

export async function readApprovedGuide(id:string,revision:number){
  return transaction(async c=>{
    await assertCoachKnowledge(c,[{sourceId:id,revision}])
    const card=(await c.query('SELECT payload FROM campus_knowledge WHERE id=$1 AND revision=$2',[id,revision])).rows[0]?.payload as KnowledgeCard|undefined
    if(!card?.guide||!guideIsUsable(card))throw new HttpError(404,'METHOD_UNAVAILABLE')
    return card
  })
}
export async function readFullMethod(id:string,revision:number){
 const card=await readApprovedGuide(id,revision)
 return {title:card.title,revision,scope:card.scope,limitations:card.limitations,url:card.url,guide:card.guide}
}
const label=(text:string)=>text.replace(/[\[\]\\\r\n]/g,' ')
// A claim match tolerates ONLY a missing trailing full stop — nothing else
// about the proposition text may differ.
const claimAppears=(reply:string,claim:string)=>reply.includes(claim)||(claim.endsWith('。')&&reply.includes(claim.slice(0,-1)))
// P5 (D-gate replay C05A/T6): a self-authored METHOD guide is personalized
// when used — the generic opener and framing may be rewritten around the
// user's own matter, so a cited method card carries NO verbatim-claim
// requirement (the model only SELECTED the authorized id; the server renders
// the real claim, source and boundaries in the 依据与边界 note). Official
// policy claims stay strictly verbatim in full. Writing a FULL claim verbatim
// still triggers the auto-bind below, cited or not.
const claimSatisfied=(reply:string,card:KnowledgeCard)=>card.kind!=='policy'||claimAppears(reply,card.claim)
export async function validateCoachCitations(reply:string,citations:CoachCitation[],available:KnowledgeCard[],currentText:string,userSourceTexts:string[]= [currentText]){
  const refs:CoachKnowledgeRef[]=[],notes:string[]=[]
  // Fix 3: resolve model-selected claimIds (and any legacy sourceId form) to
  // the SERVER-owned card fields. Every citation that names an authorized card
  // is rebuilt from that card — the model cannot author or drift
  // revision/claim/excerpt/scope. Scope/revision/verbatim-claim checks below
  // are unchanged and still hard-fail on mismatch.
  const resolvedCitations=citations.map(citation=>{
    if('claimId'in citation){
      const card=available.find(entry=>entry.id===citation.claimId)
      if(!card)throw new HttpError(400,'COACH_CITATION_INVALID')
      return {sourceId:card.id,revision:card.revision,claim:card.claim,quote:card.excerpt,scope:card.scope}
    }
    const card=available.find(entry=>entry.id===citation.sourceId)
    return card?{sourceId:card.id,revision:card.revision,claim:card.claim,quote:card.excerpt,scope:card.scope}:citation
  })
  // A supplied verified proposition cannot be rendered without its versioned
  // reference: otherwise the saved material would survive source withdrawal.
  for(const card of available){
    if(!card.claim.trim()||!claimAppears(reply,card.claim)||resolvedCitations.some(citation=>citation.sourceId===card.id&&citation.revision===card.revision&&citation.claim===card.claim))continue
    // Exact, unique maintenance-verified text identifies its own source. Bind
    // that source server-side; do not infer entailment from a paraphrase.
    if(available.filter(other=>other.claim===card.claim).length!==1)throw new HttpError(400,'COACH_CITATION_INVALID')
    resolvedCitations.push({sourceId:card.id,revision:card.revision,claim:card.claim,quote:card.excerpt,scope:card.scope})
  }
  if(resolvedCitations.some(c=>available.some(card=>card.id===c.sourceId&&card.guide))&&unsupportedMethodAssertion(reply))throw new HttpError(400,'COACH_CITATION_SCOPE_UNSUPPORTED')
  await transaction(async c=>{
    for(const citation of resolvedCitations){
      const card=available.find(card=>card.id===citation.sourceId&&card.revision===citation.revision)
      // The maintenance-verified proposition is the allowlist. An arbitrary paraphrase
      // passing a quote-substring check is not proof of entailment.
      if(!card||citation.claim!==card.claim||!claimSatisfied(reply,card)||!citation.quote.trim()||!card.excerpt.includes(citation.quote)||citation.scope!==card.scope||!policyApplies(card,currentText))throw new HttpError(400,'COACH_CITATION_INVALID')
      if(!refs.some(ref=>ref.sourceId===card.id)){
        refs.push({sourceId:card.id,revision:card.revision})
        notes.push(`“${card.claim}”：[${label(card.title)}](${card.url})。发布：${card.publishedYear}；核验：${card.verifiedAt.slice(0,10)}${card.validUntil?'；有效至：'+card.validUntil.slice(0,10):''}。适用范围：${card.scope}。限制：${card.limitations}。`)
        if(card.guide)notes.push(`[查看完整方法](/api/knowledge/${card.id}?revision=${card.revision})`)
      }
    }
    await assertCoachKnowledge(c,refs)
  })
  for(const match of reply.matchAll(/https?:\/\/[^\s<>()\[\]]+/g)){
    const url=match[0].replace(/[。，；！？、]+$/u,'')
    if(!userSourceTexts.some(text=>text.includes(url))&&!available.some(card=>card.url===url&&refs.some(ref=>ref.sourceId===card.id&&ref.revision===card.revision)))throw new HttpError(400,'COACH_CITATION_INVALID')
  }
  const text=notes.length?reply+'\n\n依据与边界：\n'+notes.join('\n\n'):reply
  if(text.length>16000)throw new HttpError(400,'COACH_CITATION_OUTPUT_LIMIT')
  return {text,refs}
}
