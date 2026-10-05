import {createHash} from 'node:crypto'
import {pool,transaction,HttpError} from './db.ts'
export type PolicyScopeRule=
  |{status:'specific';value:string;quote:string}
  |{status:'all';quote:string}
  |{status:'not_applicable';reason:string;quote:string}
  |{status:'unknown';reason:string}
export type PolicyScopeRules=Record<'institution'|'department'|'project'|'year'|'population',PolicyScopeRule>
export type KnowledgeCard={
  id:string;revision:number;kind:'method'|'case'|'policy';status:'verified'|'unverified'|'revoked';synthetic:boolean;
  title:string;url:string;publisher:string;publishedYear:string;verifiedAt:string;validUntil:string|null;
  excerpt:string;claim:string;scope:string;limitations:string;mechanisms:string[];comparisonGroup?:string;outcome?:'support'|'boundary';
  sourceHash:string;application?:'learning'|'venture'|'study_support';scopeKeys?:{institution:string;department:string;project:string;year:string;population:string};
  scopeRules?:PolicyScopeRules;
  scopeEvidence?:string[];
}
export type KnowledgeRecord={id:string;revision:number;kind:KnowledgeCard['kind'];status:KnowledgeCard['status'];synthetic:boolean;valid_until:string|null;payload:KnowledgeCard}
const policyScopeKeys=['institution','department','project','year','population'] as const
export function validPolicyScope(value:unknown):value is NonNullable<KnowledgeCard['scopeKeys']>{
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const fields=value as Record<string,unknown>
  return Object.keys(fields).length===policyScopeKeys.length&&policyScopeKeys.every(key=>Object.hasOwn(fields,key)&&typeof fields[key]==='string'&&fields[key].trim().length>0)
}
export function validPolicyScopeRules(value:unknown,excerpt:string):value is PolicyScopeRules{
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const fields=value as Record<string,unknown>,nonblank=(text:unknown):text is string=>typeof text==='string'&&text.trim().length>0
  return Object.keys(fields).length===policyScopeKeys.length&&policyScopeKeys.every(key=>{
    if(!Object.hasOwn(fields,key))return false
    const rule=fields[key]
    if(!rule||typeof rule!=='object'||Array.isArray(rule))return false
    const row=rule as Record<string,unknown>
    const expected=row.status==='specific'?['status','value','quote']:row.status==='all'?['status','quote']:row.status==='not_applicable'?['status','reason','quote']:['status','reason']
    if(Object.keys(row).length!==expected.length||expected.some(name=>!Object.hasOwn(row,name)))return false
    if(row.status==='unknown')return nonblank(row.reason)
    if(!nonblank(row.quote)||!excerpt.includes(row.quote))return false
    if(row.status==='specific')return nonblank(row.value)
    if(row.status==='all')return true
    return row.status==='not_applicable'&&nonblank(row.reason)
  })
}
export function policyScopeEvidence(card:KnowledgeCard){return card.scopeEvidence?.join('\n')??card.excerpt}
export function validateKnowledge(card:KnowledgeCard,allowSynthetic=false){
  if(!/^[0-9a-f-]{36}$/i.test(card.id)||!Number.isInteger(card.revision)||card.revision<1)throw new HttpError(400,'KNOWLEDGE_ID_INVALID')
  if(!['method','case','policy'].includes(card.kind)||!['verified','unverified','revoked'].includes(card.status))throw new HttpError(400,'KNOWLEDGE_STATUS_INVALID')
  if(card.synthetic&&!allowSynthetic)throw new HttpError(400,'SYNTHETIC_KNOWLEDGE_FORBIDDEN')
  const url=new URL(card.url)
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new HttpError(400,'KNOWLEDGE_URL_INVALID')
  for(const key of ['title','publisher','publishedYear','verifiedAt','excerpt','claim','scope','limitations','sourceHash'] as const)if(typeof card[key]!=='string'||!card[key].trim())throw new HttpError(400,'KNOWLEDGE_METADATA_REQUIRED')
  if(!Number.isFinite(Date.parse(card.verifiedAt))||!/^[0-9a-f]{64}$/.test(card.sourceHash)||!Array.isArray(card.mechanisms)||!card.mechanisms.length)throw new HttpError(400,'KNOWLEDGE_AUDIT_REQUIRED')
  if(card.validUntil!==null&&!Number.isFinite(Date.parse(card.validUntil)))throw new HttpError(400,'KNOWLEDGE_EXPIRY_INVALID')
  if(card.scopeEvidence&&(!Array.isArray(card.scopeEvidence)||!card.scopeEvidence.length||card.scopeEvidence.length>12||card.scopeEvidence.some(span=>typeof span!=='string'||!span.trim()||span.length>2000)))throw new HttpError(400,'POLICY_SCOPE_REQUIRED')
  if(card.kind==='policy'&&!(card.scopeRules
    ?!card.scopeKeys&&validPolicyScopeRules(card.scopeRules,policyScopeEvidence(card))
    :validPolicyScope(card.scopeKeys)))throw new HttpError(400,'POLICY_SCOPE_REQUIRED')
}
// Only called by local maintenance CLI or isolated fixtures. No HTTP route grants verification.
export async function importKnowledge(cards:KnowledgeCard[],allowSynthetic=false){
  if(allowSynthetic&&!/^lifeos_dialogue_(?:test|live)_/.test(new URL((await import('./config.ts')).config.databaseUrl).pathname.slice(1)))throw new HttpError(400,'SYNTHETIC_IMPORT_REQUIRES_ISOLATION')
  for(const card of cards)validateKnowledge(card,allowSynthetic)
  return transaction(async c=>{
    let changed=0
    for(const card of cards){
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['knowledge:'+card.id])
      const old=(await c.query('SELECT * FROM campus_knowledge WHERE id=$1 FOR UPDATE',[card.id])).rows[0]
      const stable=(value:any):any=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value
      const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
      if(old&&old.revision===card.revision&&digest(old.payload)===digest(card))continue
      if(old&&card.revision<=old.revision)throw new HttpError(409,'KNOWLEDGE_REVISION_CONFLICT')
      await c.query('INSERT INTO campus_knowledge(id,revision,kind,status,synthetic,valid_until,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,kind=EXCLUDED.kind,status=EXCLUDED.status,synthetic=EXCLUDED.synthetic,valid_until=EXCLUDED.valid_until,payload=EXCLUDED.payload,updated_at=now()',[card.id,card.revision,card.kind,card.status,card.synthetic,card.validUntil,card])
      await c.query('INSERT INTO campus_knowledge_revisions(id,revision,snapshot) VALUES($1,$2,$3)',[card.id,card.revision,card])
      changed++
    }
    return {changed,total:cards.length}
  })
}
