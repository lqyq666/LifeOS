import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pool } from './db.ts'
import type { PublicKnowledgeQuery } from './coze-public-query.ts'
import type { KnowledgeRecord } from './campus-knowledge.ts'

// N3: Coze is a PUBLIC-knowledge retrieval candidate source only. Nothing here
// ever writes campus_knowledge, marks anything verified, or extends an
// official source's TTL. Candidates must map through the human-reviewed
// registry to an existing verified KnowledgeCard before they can enter the
// normal citation chain; everything else stays an unverified candidate.

export type CozeConfig={
  enabled:boolean
  workflowId:string
  workflowVersion:string|null // null ⇒ WORKFLOW_VERSION_UNPINNED
  pat:string
  timeoutMs:number
  maxItems:number
}
export function cozeConfigFrom(env:NodeJS.ProcessEnv=process.env):CozeConfig{
  const enabled=env.LIFEOS_COZE_KNOWLEDGE==='true'
  const workflowId=env.LIFEOS_COZE_WORKFLOW_ID??''
  const pat=env.LIFEOS_COZE_PAT??''
  const timeoutRaw=Number.parseInt(env.LIFEOS_COZE_TIMEOUT_MS??'',10)
  return {
    enabled,
    workflowId,
    // Pinned published versions keep runs reproducible; the default-latest
    // workflow is explicitly NOT claimed as frozen.
    workflowVersion:env.LIFEOS_COZE_WORKFLOW_VERSION&&env.LIFEOS_COZE_WORKFLOW_VERSION.trim()?env.LIFEOS_COZE_WORKFLOW_VERSION.trim():null,
    pat,
    timeoutMs:Number.isInteger(timeoutRaw)&&timeoutRaw>=500&&timeoutRaw<=5000?timeoutRaw:2000,
    maxItems:6,
  }
}
export function cozeMissingConfig(config:CozeConfig):string[]|null{
  if(!config.enabled)return ['DISABLED']
  const missing:string[]=[]
  if(!config.pat.trim())missing.push('LIFEOS_COZE_PAT')
  if(!config.workflowId.trim())missing.push('LIFEOS_COZE_WORKFLOW_ID')
  return missing.length?missing:null
}

export type PublicKnowledgeHit={documentId:string;content:string;score:number|null}
export type CozeWorkflowOutput={schemaVersion:1;items:PublicKnowledgeHit[]}
export class CozeRetrievalError extends Error{readonly code:string;constructor(code:string){super(code);this.code=code}}

// The outer platform envelope is HTTP success + code===0; `data` is a
// JSON-SERIALIZED string on this contract, parsed exactly once. schemaVersion/
// items are OUR workflow end-node contract (mapped in the workflow itself),
// not claimed Coze platform defaults.
export function parseCozeWorkflowBody(body:unknown):CozeWorkflowOutput{
  const root=body as {code?:unknown;msg?:unknown;data?:unknown}|null
  if(!root||typeof root!=='object'||Array.isArray(root))throw new CozeRetrievalError('COZE_CONTRACT_INVALID')
  if(root.code!==0)throw new CozeRetrievalError('COZE_CONTRACT_INVALID')
  if(typeof root.data!=='string')throw new CozeRetrievalError('COZE_CONTRACT_INVALID')
  let output:unknown
  try{output=JSON.parse(root.data)}catch{throw new CozeRetrievalError('COZE_CONTRACT_INVALID')}
  const parsed=output as {schemaVersion?:unknown;items?:unknown}|null
  if(!parsed||typeof parsed!=='object'||parsed.schemaVersion!==1||!Array.isArray(parsed.items))
    throw new CozeRetrievalError('COZE_CONTRACT_INVALID')
  const items:PublicKnowledgeHit[]=[]
  for(const raw of parsed.items){
    if(items.length>=8)break
    const hit=raw as {documentId?:unknown;content?:unknown;score?:unknown}|null
    const documentId=typeof hit?.documentId==='string'?hit.documentId.trim():''
    const content=typeof hit?.content==='string'?hit.content.trim():''
    if(!documentId||!content||content.length>4000)continue
    items.push({documentId,content,score:typeof hit?.score==='number'&&Number.isFinite(hit.score)?hit.score:null})
  }
  return {schemaVersion:1,items}
}

const MAX_RESPONSE_BYTES=256*1024
const COZE_ORIGIN='https://api.coze.cn'

export async function searchCozePublicKnowledge(query:PublicKnowledgeQuery,rendered:string,signal:AbortSignal|undefined,config:CozeConfig,now=()=>performance.now(),fetchImpl:typeof fetch=fetch):Promise<{hits:PublicKnowledgeHit[];latencyMs:number;version:string}>{
  // Enabled-but-incomplete config is a loud CONFIG_MISSING, never a silent
  // "disabled" success; the feature flag itself stays default-off.
  const missing=cozeMissingConfig(config)
  if(missing&&missing.includes('DISABLED'))throw new CozeRetrievalError('COZE_DISABLED')
  if(missing&&missing.length)throw new CozeRetrievalError('CONFIG_MISSING')
  const started=now()
  // Response reading counts cumulative UTF-8 bytes and aborts past the cap —
  // a huge body is never fully downloaded first.
  const controller=new AbortController()
  let timedOut=false
  const timeout=setTimeout(()=>{timedOut=true;controller.abort('COZE_TIMEOUT')},config.timeoutMs)
  const abortForward=()=>controller.abort()
  signal?.addEventListener('abort',abortForward,{once:true})
  try{
    const response=await fetchImpl(COZE_ORIGIN+'/v1/workflow/run',{
      method:'POST',
      headers:{Authorization:'Bearer '+config.pat,'Content-Type':'application/json'},
      // The production origin is fixed; no env URL may carry the PAT elsewhere.
      redirect:'error',
      body:JSON.stringify({
        workflow_id:config.workflowId,
        ...(config.workflowVersion?{workflow_version:config.workflowVersion}:{}),
        parameters:{query:rendered},
        is_async:false,
      }),
      signal:controller.signal,
    })
    if(!response.ok)throw new CozeRetrievalError('COZE_HTTP_'+response.status)
    const reader=response.body?.getReader()
    if(!reader)throw new CozeRetrievalError('COZE_CONTRACT_INVALID')
    const decoder=new TextDecoder()
    let bytes=0,text=''
    while(true){
      const chunk=await reader.read()
      if(chunk.done)break
      bytes+=chunk.value.byteLength
      if(bytes>MAX_RESPONSE_BYTES){
        await reader.cancel().catch(()=>{})
        throw new CozeRetrievalError('COZE_RESPONSE_TOO_LARGE')
      }
      text+=decoder.decode(chunk.value,{stream:true})
    }
    let body:unknown
    try{body=JSON.parse(text)}catch{throw new CozeRetrievalError('COZE_CONTRACT_INVALID')}
    const output=parseCozeWorkflowBody(body)
    return {hits:output.items.slice(0,config.maxItems),latencyMs:Math.round(now()-started),version:config.workflowVersion??'WORKFLOW_VERSION_UNPINNED'}
  }catch(error){
    if(signal?.aborted)throw new CozeRetrievalError('CANCELLED')
    if(timedOut)throw new CozeRetrievalError('COZE_TIMEOUT')
    if(error instanceof CozeRetrievalError)throw error
    throw new CozeRetrievalError('COZE_REQUEST_FAILED')
  }finally{
    clearTimeout(timeout)
    signal?.removeEventListener('abort',abortForward)
  }
}

// ---- N3.5 candidate mapping through the human-reviewed registry ----------

export type PublicDocumentBinding={
  workflowId:string;datasetId:string;documentId:string
  knowledgeCardId:string;expectedRevision:number;expectedSourceHash:string
  // P5 S2/K01: audited metadata - enabled=false disables the binding; contentHash
  // (when present) must additionally match the remote hit content.
  enabled?:boolean
  contentHash?:string
  sourceType?:string
}
type RegistryFile={schemaVersion:1;bindings:PublicDocumentBinding[]}
let registryCache:{at:number;file:RegistryFile}|null=null
export function loadCozePublicRegistry(root=process.cwd()):RegistryFile{
  if(registryCache&&Date.now()-registryCache.at<60000&&!(loadCozePublicRegistry as unknown as {cache?:undefined}).cache)return registryCache.file
  const path=resolve(root,'.planning/research/campus-growth/coze-public-registry.json')
  const parsed=JSON.parse(readFileSync(path,'utf8')) as RegistryFile
  if(parsed.schemaVersion!==1||!Array.isArray(parsed.bindings))throw new CozeRetrievalError('COZE_REGISTRY_INVALID')
  registryCache={at:Date.now(),file:parsed}
  return parsed
}

export type VerifiedCandidate={card:KnowledgeRecord;excerpt:string}
export type MappedCandidates={verified:VerifiedCandidate[];unverifiedDocumentIds:string[]}

// A hit becomes verified knowledge ONLY through a registry binding whose
// KnowledgeCard passes the existing status/hash/revision/expiry checks and
// whose excerpt appears CONTIGUOUSLY in the card's verified excerpt (newline
// normalization fixed by convention). Unknown documents stay unverified.
export async function mapCozeCandidates(hits:readonly PublicKnowledgeHit[],config:CozeConfig,c:{query:(sql:string,params:unknown[])=>Promise<{rows:unknown[]}>;registryRoot?:string}=pool):Promise<MappedCandidates>{
  const registry=loadCozePublicRegistry(c.registryRoot)
  const verified:VerifiedCandidate[]=[]
  const unverified:string[]=[]
  for(const hit of hits){
    const binding=registry.bindings.find(entry=>entry.workflowId===config.workflowId&&entry.documentId===hit.documentId)
    if(!binding){unverified.push(hit.documentId);continue}
    // P5 S2 (K01): an audited binding can be disabled outright; a pinned
    // contentHash must match the remote content so appended text never passes.
    if(binding.enabled===false){unverified.push(hit.documentId);continue}
    if(binding.contentHash){
      const contentHash=createHash('sha256').update(hit.content).digest('hex')
      if(contentHash!==binding.contentHash){unverified.push(hit.documentId);continue}
    }
    const row=(await c.query('SELECT *,official_knowledge_current(payload) AS official_current FROM campus_knowledge WHERE id=$1',[binding.knowledgeCardId])).rows[0] as (KnowledgeRecord&{official_current?:boolean})|undefined
    if(!row||row.status!=='verified'||row.revision!==binding.expectedRevision||row.payload.sourceHash!==binding.expectedSourceHash||row.official_current===false||(row.valid_until&&Date.parse(String(row.valid_until))<=Date.now())){
      unverified.push(hit.documentId);continue
    }
    const normalized=(text:string)=>text.replace(/\r\n/g,'\n')
    if(!normalized(row.payload.excerpt).includes(normalized(hit.content))&&!normalized(hit.content).includes(normalized(row.payload.excerpt))){
      unverified.push(hit.documentId);continue
    }
    // P5 S2 (K01): the accepted excerpt is the VERIFIED LOCAL span - appended
    // remote text cannot inherit trust.
    verified.push({card:row,excerpt:row.payload.excerpt})
  }
  return {verified,unverifiedDocumentIds:unverified}
}
