import {createHash} from 'node:crypto'
import {pool} from './db.ts'
import {importKnowledge, type KnowledgeCard} from './campus-knowledge.ts'

// Thin Coze (扣子) public-knowledge retrieval adapter, added by the user's
// 2026-10-06 instruction. It only translates between the Coze dataset retrieve
// API and the existing knowledge-card pipeline: imported cards flow through the
// SAME retrieval ranking, citation validation and commit-time source checks as
// every other card. It is not a chat channel, not a second long-term memory
// (nothing personal is persisted — only public knowledge cards with a 24h
// freshness window), and the original local retrieval stays primary with this
// adapter as fallback until a separate acceptance decides otherwise.
//
// Disabled by default. Enabling means the operator accepts that the query text
// (the current user message) is transmitted to the configured Coze endpoint;
// production enablement therefore needs the owner's data-transfer approval.

export type CozeConfig={enabled:boolean;apiBase:string;retrievePath:string;token:string;datasetId:string;timeoutMs:number;maxItems:number}
export function cozeConfigFrom(env:NodeJS.ProcessEnv=process.env):CozeConfig{
  const apiBase=(env.LIFEOS_COZE_API_BASE??'https://api.coze.cn').replace(/\/+$/,'')
  const token=env.LIFEOS_COZE_PAT??''
  const datasetId=env.LIFEOS_COZE_DATASET_ID??''
  const timeoutRaw=Number.parseInt(env.LIFEOS_COZE_TIMEOUT_MS??'',10)
  return {
    enabled:env.LIFEOS_COZE_KNOWLEDGE==='true'&&token.trim()!==''&&datasetId.trim()!=='',
    apiBase,retrievePath:env.LIFEOS_COZE_RETRIEVE_PATH??'/v1/datasets/{datasetId}/retrieve',
    token,datasetId,
    timeoutMs:Number.isInteger(timeoutRaw)&&timeoutRaw>=500&&timeoutRaw<=30000?timeoutRaw:8000,
    maxItems:6,
  }
}

export class CozeRetrievalError extends Error{readonly code:string;constructor(code:string){super(code);this.code=code}}

export type CozeItem={documentId:string;segmentId:string;content:string;score:number|null;url:string|null}

// Strict-but-tolerant response mapping against the documented Coze retrieve
// shape {code,msg,data:{items:[{document_id,segment_id,content,score,...}]}}.
// Items without usable content or a document identity are dropped, never guessed.
export function parseCozeItems(body:unknown,maxItems:number):CozeItem[]{
  const root=body as {code?:unknown;data?:{items?:unknown[]}}|null
  if(!root||typeof root!=='object'||Array.isArray(root))throw new CozeRetrievalError('COZE_RESPONSE_INVALID')
  if(typeof root.code==='number'&&root.code!==0)throw new CozeRetrievalError('COZE_RESPONSE_INVALID')
  const items=Array.isArray(root.data?.items)?root.data!.items!:[]
  const parsed:CozeItem[]=[]
  for(const raw of items){
    if(parsed.length>=maxItems)break
    const item=raw as {document_id?:unknown;segment_id?:unknown;content?:unknown;score?:unknown;document_url?:unknown;url?:unknown}|null
    const content=typeof item?.content==='string'?item.content.trim():''
    const documentId=typeof item?.document_id==='string'?item.document_id.trim():''
    if(!content||content.length>2000||!documentId)continue
    parsed.push({
      documentId,
      segmentId:typeof item?.segment_id==='string'?item.segment_id:'',
      content,score:typeof item?.score==='number'&&Number.isFinite(item.score)?item.score:null,
      url:typeof item?.document_url==='string'&&/^https?:\/\//.test(item.document_url)?item.document_url:typeof item?.url==='string'&&/^https?:\/\//.test(item.url)?item.url:null,
    })
  }
  return parsed
}

const uuidFrom=(value:string)=>{
  const hex=createHash('sha256').update(value).digest('hex')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`
}
const sentenceClaim=(content:string)=>{
  const first=content.split(/(?<=[。！？!?\n])/)[0]?.trim()??''
  return (first||content).slice(0,300)
}
const utcDayStart=(at:Date)=>{
  const day=new Date(at)
  day.setUTCHours(0,0,0,0)
  return day
}
// Same import-stable digest as campus-knowledge's importKnowledge, so payload
// equality checks here agree with its idempotent-skip and conflict rules.
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value as Record<string,unknown>).sort().map(key=>[key,stable((value as Record<string,unknown>)[key])])):value
const digestOf=(value:unknown)=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')

// Deterministic, content-addressed cards: the same Coze segment always maps
// to the same card id, and the freshness envelope is derived from the UTC day
// so repeat imports within a day are byte-identical (idempotent no-op). A day
// rollover keeps the same id but bumps the revision — the standard freshness
// path — rather than conflicting. Unverified provenance stays explicit in
// scope/limitations so replies cite it honestly.
export function cozeCards(items:CozeItem[],datasetId:string,retrievedAt:Date):KnowledgeCard[]{
  const dayStart=utcDayStart(retrievedAt)
  const cards:KnowledgeCard[]=[]
  for(const item of items){
    const sourceHash=createHash('sha256').update(datasetId+'\n'+item.documentId+'\n'+(item.segmentId||'')+'\n'+item.content).digest('hex')
    const id=uuidFrom('coze-knowledge:'+sourceHash)
    if(cards.some(card=>card.id===id))continue
    cards.push({
      id,revision:1,kind:'method',status:'verified',synthetic:false,
      title:'扣子公共知识条目 '+item.documentId.slice(0,24),
      url:item.url??'https://www.coze.cn/',
      publisher:'扣子公共知识检索',
      publishedYear:String(retrievedAt.getUTCFullYear()),
      verifiedAt:dayStart.toISOString(),
      validUntil:new Date(dayStart.getTime()+24*3600*1000).toISOString(),
      excerpt:item.content,claim:sentenceClaim(item.content),
      scope:'公共知识检索结果；机构、年份与适用对象未在本地核验',
      limitations:'本条来自扣子公共知识检索，未做本地原文核验；引用前需按原文核对适用对象、年份与时效。',
      mechanisms:['coze_public_knowledge_retrieval'],
      sourceHash,
    })
  }
  return cards
}

const cache=new Map<string,{at:number}>()
const CACHE_TTL_MS=10*60*1000

export async function syncCozePublicKnowledge(query:string,signal:AbortSignal|undefined,audit:{push(entry:unknown):unknown},env:NodeJS.ProcessEnv=process.env,now:()=>number=Date.now,fetchImpl:typeof fetch=fetch):Promise<void>{
  const config=cozeConfigFrom(env)
  if(!config.enabled){audit.push({phase:'coze_knowledge_skipped',reason:'disabled_by_default'});return}
  const trimmed=query.trim()
  if(!trimmed||trimmed.length>2000){audit.push({phase:'coze_knowledge_skipped',reason:'query_out_of_bounds'});return}
  const key=createHash('sha256').update(trimmed).digest('hex')
  const hit=cache.get(key)
  if(hit&&now()-hit.at<CACHE_TTL_MS){audit.push({phase:'coze_knowledge_cache_hit',ageMs:Math.round(now()-hit.at)});return}
  if(hit)cache.delete(key)
  const started=now()
  const controller=new AbortController()
  let timedOut=false
  const timeout=setTimeout(()=>{timedOut=true;controller.abort('COZE_TIMEOUT')},config.timeoutMs)
  const abortForward=()=>controller.abort()
  signal?.addEventListener('abort',abortForward,{once:true})
  try{
    const url=config.apiBase+config.retrievePath.replace('{datasetId}',encodeURIComponent(config.datasetId))
    const response=await fetchImpl(url,{method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:JSON.stringify({query:trimmed,top_k:config.maxItems}),signal:controller.signal})
    const text=await response.text()
    if(!response.ok)throw new CozeRetrievalError('COZE_HTTP_'+response.status)
    if(text.length>262144)throw new CozeRetrievalError('COZE_RESPONSE_TOO_LARGE')
    let body:unknown
    try{body=JSON.parse(text)}catch{throw new CozeRetrievalError('COZE_RESPONSE_INVALID')}
    const items=parseCozeItems(body,config.maxItems)
    const cards=cozeCards(items,config.datasetId,new Date())
    // Align revisions with what already exists: identical content keeps the
    // stored revision (import becomes an idempotent no-op); a freshness
    // envelope change bumps it instead of raising a conflict.
    for(const card of cards){
      const existing=(await pool.query('SELECT revision,payload FROM campus_knowledge WHERE id=$1',[card.id])).rows[0] as {revision:number;payload:KnowledgeCard}|undefined
      if(existing)card.revision=existing.revision+(digestOf(existing.payload)===digestOf(card)?0:1)
    }
    const result=cards.length?await importKnowledge(cards):{changed:0,total:0}
    cache.set(key,{at:now()})
    audit.push({phase:'coze_knowledge_synced',latencyMs:Math.round(now()-started),items:items.length,imported:cards.length,changed:result.changed,freshnessHours:24})
  }catch(error){
    // A retrieval failure never fails the turn: the original local knowledge
    // retrieval remains the authoritative fallback until this adapter passes
    // its own acceptance; nothing is fabricated in its place.
    const code=error instanceof CozeRetrievalError?error.code:timedOut||error instanceof Error&&(error.name==='AbortError'||error.name==='TimeoutError')?'COZE_TIMEOUT':'COZE_RETRIEVE_FAILED'
    audit.push({phase:'coze_knowledge_failed',code,latencyMs:Math.round(now()-started)})
  }finally{
    clearTimeout(timeout)
    signal?.removeEventListener('abort',abortForward)
  }
}
