import type { PublicKnowledgeHit, CozeWorkflowOutput } from './coze-knowledge.ts'

// S6: transport adapter for a deployed Coze AI-coding workflow's synchronous
// /run endpoint (code_workflow). This is a SEPARATE transport from the legacy
// resource_workflow PAT path in coze-knowledge.ts — one request never mixes or
// auto-falls-back between the two (no double billing on failure).

export type CodeWorkflowConfig={
  enabled:boolean
  endpoint:string
  projectId:string
  token:string
  release:string
  timeoutMs:number
}
export class CodeWorkflowError extends Error{readonly code:string;constructor(code:string){super(code);this.code=code}}

const timeoutMsCap=(value:number)=>value<=5000
export function codeWorkflowConfigFrom(env:NodeJS.ProcessEnv=process.env):CodeWorkflowConfig{
  const enabled=env.LIFEOS_COZE_KNOWLEDGE==='true'&&env.LIFEOS_COZE_TRANSPORT==='code_workflow'
  const endpoint=env.LIFEOS_COZE_CODE_ENDPOINT??''
  const token=env.LIFEOS_COZE_CODE_TOKEN??''
  const projectId=env.LIFEOS_COZE_CODE_PROJECT_ID??''
  const release=env.LIFEOS_COZE_CODE_RELEASE??''
  const timeoutRaw=Number.parseInt(env.LIFEOS_COZE_TIMEOUT_MS??'',10)
  return {enabled,endpoint,projectId,token,release,timeoutMs:Number.isInteger(timeoutRaw)&&timeoutRaw>=500&&timeoutMsCap(timeoutRaw)?timeoutRaw:2000}
}

export function codeWorkflowMissingConfig(config:CodeWorkflowConfig):string[]|null{
  if(!config.enabled)return ['DISABLED']
  const missing:string[]=[]
  if(!config.endpoint.trim())missing.push('LIFEOS_COZE_CODE_ENDPOINT')
  if(!config.token.trim())missing.push('LIFEOS_COZE_CODE_TOKEN')
  if(!config.projectId.trim())missing.push('LIFEOS_COZE_CODE_PROJECT_ID')
  return missing.length?missing:null
}

// Fixed, reviewed target: HTTPS, no userinfo/query/hash, host must end with an
// approved Coze deployment suffix and path must be exactly /run. Request
// parameters can never override the target origin.
const ALLOWED_HOST_SUFFIXES=['.coze.cn','.coze.run','.coze.site']
export function validateCodeEndpoint(endpoint:string):{origin:string;url:string}{
  let parsed:URL
  try{parsed=new URL(endpoint)}catch{throw new CodeWorkflowError('CODE_ENDPOINT_INVALID')}
  if(parsed.protocol!=='https:')throw new CodeWorkflowError('CODE_ENDPOINT_INVALID')
  if(parsed.username||parsed.password)throw new CodeWorkflowError('CODE_ENDPOINT_INVALID')
  if(parsed.search||parsed.hash)throw new CodeWorkflowError('CODE_ENDPOINT_INVALID')
  // Path is fixed to the two reviewed deployment forms: the bare /run or the
  // official deployed-workflow form /v1/fs/<projectId>/run. Nothing else.
  if(!/^\/(?:run|v1\/fs\/[A-Za-z0-9_-]{1,64}\/run)$/.test(parsed.pathname))
    throw new CodeWorkflowError('CODE_ENDPOINT_INVALID')
  const host=parsed.hostname.toLowerCase()
  // Local/private/metadata addresses are never allowed even inside a trusted
  // suffix; the host must be an approved Coze deployment domain.
  const suffix=ALLOWED_HOST_SUFFIXES.find(candidate=>host.endsWith(candidate))
  if(!suffix||host.length<=suffix.length+1)
    throw new CodeWorkflowError('CODE_ENDPOINT_INVALID')
  if(/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|metadata)/.test(host))
    throw new CodeWorkflowError('CODE_ENDPOINT_INVALID')
  return {origin:parsed.origin,url:parsed.href}
}

// code_workflow /run returns the business JSON DIRECTLY (schemaVersion/items)
// — never the legacy {code,data:"...json..."} envelope. If the legacy envelope
// appears here, that is a contract mismatch, not a no-result.
export function parseCodeWorkflowBusinessBody(body:unknown):CozeWorkflowOutput{
  const parsed=body as {schemaVersion?:unknown;items?:unknown}|null
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new CodeWorkflowError('CODE_CONTRACT_INVALID')
  if('code'in parsed&&'data'in parsed)throw new CodeWorkflowError('CODE_ENVELOPE_MISMATCH')
  if(parsed.schemaVersion!==1||!Array.isArray(parsed.items))throw new CodeWorkflowError('CODE_CONTRACT_INVALID')
  const hits:PublicKnowledgeHit[]=[]
  const seen=new Set<string>()
  for(const raw of parsed.items){
    if(hits.length>=6)break
    const hit=raw as {documentId?:unknown;content?:unknown;score?:unknown}|null
    const documentId=typeof hit?.documentId==='string'?hit.documentId.trim():''
    const content=typeof hit?.content==='string'?hit.content.trim():''
    if(!documentId||documentId.length>256||!content||content.length>4000)throw new CodeWorkflowError('CODE_CONTRACT_INVALID')
    // Exact dedup on documentId+full content, preserving original order.
    const key=documentId+'\u0000'+content
    if(seen.has(key))continue
    seen.add(key)
    hits.push({documentId,content,score:typeof hit?.score==='number'&&Number.isFinite(hit.score)?hit.score:null})
  }
  return {schemaVersion:1,items:hits}
}

const MAX_RESPONSE_BYTES=256*1024

export type CodeWorkflowSearchResult={hits:PublicKnowledgeHit[];latencyMs:number;release:string;endpointOrigin:string}

export async function searchCodeWorkflowKnowledge(query:string,signal:AbortSignal|undefined,config:CodeWorkflowConfig,now=()=>performance.now(),fetchImpl:typeof fetch=fetch):Promise<CodeWorkflowSearchResult>{
  const missing=codeWorkflowMissingConfig(config)
  if(missing&&missing.includes('DISABLED'))throw new CodeWorkflowError('COZE_DISABLED')
  if(missing&&missing.length)throw new CodeWorkflowError('CONFIG_MISSING:'+missing.join(','))
  if(typeof query!=='string'||!query.trim()||query.length>2000)throw new CodeWorkflowError('CODE_QUERY_INVALID')
  const target=validateCodeEndpoint(config.endpoint)
  // Aborted before the wire: no request, no token on the network. A parent
  // abort surfaces as this transport's CANCELLED, never a native AbortError.
  if(signal?.aborted)throw new CodeWorkflowError('CANCELLED')
  const started=now()
  const controller=new AbortController()
  let timedOut=false
  const timeout=setTimeout(()=>{timedOut=true;controller.abort('COZE_TIMEOUT')},config.timeoutMs)
  const abortForward=()=>controller.abort()
  signal?.addEventListener('abort',abortForward,{once:true})
  try{
    const response=await fetchImpl(target.url,{
      method:'POST',
      headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},
      // Redirects are refused: a redirect must never carry the token elsewhere.
      redirect:'error',
      body:JSON.stringify({query}),
      signal:controller.signal,
    })
    if(response.status===401||response.status===403)throw new CodeWorkflowError('CODE_AUTH_'+response.status)
    if(response.status===429)throw new CodeWorkflowError('CODE_RATE_LIMITED')
    if(!response.ok)throw new CodeWorkflowError('CODE_HTTP_'+response.status)
    const reader=response.body?.getReader()
    if(!reader)throw new CodeWorkflowError('CODE_CONTRACT_INVALID')
    const decoder=new TextDecoder()
    let bytes=0,text=''
    while(true){
      const chunk=await reader.read()
      if(chunk.done)break
      bytes+=chunk.value.byteLength
      if(bytes>MAX_RESPONSE_BYTES){
        await reader.cancel().catch(()=>{})
        throw new CodeWorkflowError('CODE_RESPONSE_TOO_LARGE')
      }
      text+=decoder.decode(chunk.value,{stream:true})
    }
    let body:unknown
    try{body=JSON.parse(text)}catch{throw new CodeWorkflowError('CODE_CONTRACT_INVALID')}
    const output=parseCodeWorkflowBusinessBody(body)
    return {hits:output.items,latencyMs:Math.round(now()-started),release:config.release||'UNKNOWN_RELEASE',endpointOrigin:target.origin}
  }catch(error){
    if(signal?.aborted)throw new CodeWorkflowError('CANCELLED')
    if(timedOut)throw new CodeWorkflowError('COZE_TIMEOUT')
    if(error instanceof CodeWorkflowError)throw error
    throw new CodeWorkflowError('CODE_REQUEST_FAILED')
  }finally{
    clearTimeout(timeout)
    signal?.removeEventListener('abort',abortForward)
  }
}
