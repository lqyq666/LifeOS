import type { PoolClient } from 'pg'
import { pool, transaction, HttpError } from './db.ts'
import { config } from './config.ts'
import { validPolicyScope, validPolicyScopeRules, policyScopeEvidence, type KnowledgeCard, type KnowledgeRecord } from './campus-knowledge.ts'
import type { CoachCitation } from './action-coach-contracts.ts'
import { localEmbedding, embeddingSignature } from './local-embedding.ts'

export type CoachKnowledgeRef={sourceId:string;revision:number}
const isolated=/^lifeos_dialogue_(?:test|live)_/.test(new URL(config.databaseUrl).pathname.slice(1))
const valid=(row:KnowledgeRecord&{official_current?:boolean})=>row.status==='verified'&&row.official_current!==false&&(!row.synthetic||isolated)&&(!row.valid_until||Date.parse(row.valid_until)>Date.now())
const cache=new Map<string,number[]>()
// Calibrated against the pinned local encoder and frozen relevance cases.
// Ranking alone always returns something, even for an unrelated conversation.
// This is a retrieval cutoff, not proof that a proposition applies to the user.
const minimumKnowledgeScore=0.5
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

export async function retrieveCoachKnowledge(query:string,signal?:AbortSignal):Promise<KnowledgeCard[]>{
  const rows=((await pool.query("SELECT *,official_knowledge_current(payload) AS official_current FROM campus_knowledge WHERE status='verified' AND (valid_until IS NULL OR valid_until>now()) AND official_knowledge_current(payload) ORDER BY id")).rows as KnowledgeRecord[]).filter(row=>valid(row)&&policyApplies(row.payload,query))
  if(!rows.length)return []
  const queryVector=(await localEmbedding.encode([query],true,signal))[0]
  const ranked:{card:KnowledgeCard;score:number}[]=[]
  for(let i=0;i<rows.length;i+=32){
    signal?.throwIfAborted()
    const batch=rows.slice(i,i+32),key=(row:KnowledgeRecord)=>`${embeddingSignature}:${row.id}:${row.revision}:${row.payload.sourceHash}`
    const missing=batch.filter(row=>!cache.has(key(row)))
    if(missing.length){
      const vectors=await localEmbedding.encode(missing.map(row=>[row.payload.claim,row.payload.excerpt,row.payload.scope].join('\n')),false,signal)
      missing.forEach((row,index)=>{cache.set(key(row),vectors[index])})
    }
    for(const row of batch){const vector=cache.get(key(row))!;ranked.push({card:row.payload,score:vector.reduce((sum,value,index)=>sum+value*queryVector[index],0)})}
    while(cache.size>128)cache.delete(cache.keys().next().value!)
  }
  return ranked.filter(item=>item.score>=minimumKnowledgeScore).sort((a,b)=>b.score-a.score||a.card.id.localeCompare(b.card.id)).slice(0,4).map(item=>item.card)
}

export async function assertCoachKnowledge(c:PoolClient,refs:CoachKnowledgeRef[]){
  const versions=new Map<string,number>()
  for(const ref of refs){if(versions.has(ref.sourceId)&&versions.get(ref.sourceId)!==ref.revision)throw new HttpError(409,'COACH_KNOWLEDGE_INVALIDATED');versions.set(ref.sourceId,ref.revision)}
  // Sorted shared row locks serialize with local maintenance updates through commit.
  for(const ref of [...new Map(refs.map(ref=>[ref.sourceId,ref])).values()].sort((a,b)=>a.sourceId.localeCompare(b.sourceId))){
    const row=(await c.query('SELECT *,official_knowledge_current(payload) AS official_current FROM campus_knowledge WHERE id=$1 FOR SHARE',[ref.sourceId])).rows[0] as KnowledgeRecord|undefined
    if(!row||!valid(row)||row.revision!==ref.revision)throw new HttpError(409,'COACH_KNOWLEDGE_INVALIDATED')
  }
}

const label=(text:string)=>text.replace(/[\[\]\\\r\n]/g,' ')
export async function validateCoachCitations(reply:string,citations:CoachCitation[],available:KnowledgeCard[],currentText:string,userSourceTexts:string[]= [currentText]){
  const refs:CoachKnowledgeRef[]=[],notes:string[]=[]
  const resolvedCitations=[...citations]
  // A supplied verified proposition cannot be rendered without its versioned
  // reference: otherwise the saved material would survive source withdrawal.
  for(const card of available){
    if(!card.claim.trim()||!reply.includes(card.claim)||resolvedCitations.some(citation=>citation.sourceId===card.id&&citation.revision===card.revision&&citation.claim===card.claim))continue
    // Exact, unique maintenance-verified text identifies its own source. Bind
    // that source server-side; do not infer entailment from a paraphrase.
    if(available.filter(other=>other.claim===card.claim).length!==1)throw new HttpError(400,'COACH_CITATION_INVALID')
    resolvedCitations.push({sourceId:card.id,revision:card.revision,claim:card.claim,quote:card.excerpt,scope:card.scope})
  }
  await transaction(async c=>{
    for(const citation of resolvedCitations){
      const card=available.find(card=>card.id===citation.sourceId&&card.revision===citation.revision)
      // The maintenance-verified proposition is the allowlist. An arbitrary paraphrase
      // passing a quote-substring check is not proof of entailment.
      if(!card||citation.claim!==card.claim||!reply.includes(citation.claim)||!citation.quote.trim()||!card.excerpt.includes(citation.quote)||citation.scope!==card.scope||!policyApplies(card,currentText))throw new HttpError(400,'COACH_CITATION_INVALID')
      if(!refs.some(ref=>ref.sourceId===card.id)){
        refs.push({sourceId:card.id,revision:card.revision})
        notes.push(`“${card.claim}”：[${label(card.title)}](${card.url})。发布：${card.publishedYear}；核验：${card.verifiedAt.slice(0,10)}${card.validUntil?'；有效至：'+card.validUntil.slice(0,10):''}。适用范围：${card.scope}。限制：${card.limitations}。`)
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
