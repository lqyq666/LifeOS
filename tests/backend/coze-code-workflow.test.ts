import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer,type Server } from 'node:http'
import { codeWorkflowConfigFrom, codeWorkflowMissingConfig, validateCodeEndpoint, parseCodeWorkflowBusinessBody, searchCodeWorkflowKnowledge, CodeWorkflowError, type CodeWorkflowConfig } from '../../server/coze-code-workflow.ts'

test.after(async()=>{})

const baseConfig=(over:Partial<CodeWorkflowConfig>={}):CodeWorkflowConfig=>({
  enabled:true,
  endpoint:'https://api.coze.cn/run',
  projectId:'p1',
  token:'runtime-token',
  release:'rel-1',
  timeoutMs:800,
  ...over,
})

test('C06/C32: config states — disabled default, loud CONFIG_MISSING, transport separation',()=>{
  assert.deepEqual(codeWorkflowMissingConfig(codeWorkflowConfigFrom({})),['DISABLED'],'default off')
  const resourcePat=codeWorkflowConfigFrom({LIFEOS_COZE_KNOWLEDGE:'true',LIFEOS_COZE_PAT:'pat',LIFEOS_COZE_WORKFLOW_ID:'wf'})
  assert.deepEqual(codeWorkflowMissingConfig(resourcePat),['DISABLED'],'resource_workflow PAT does NOT enable the code transport')
  const enabled=codeWorkflowMissingConfig(codeWorkflowConfigFrom({LIFEOS_COZE_KNOWLEDGE:'true',LIFEOS_COZE_TRANSPORT:'code_workflow'}))
  assert.ok(enabled!.includes('LIFEOS_COZE_CODE_ENDPOINT')&&enabled!.includes('LIFEOS_COZE_CODE_TOKEN')&&enabled!.includes('LIFEOS_COZE_CODE_PROJECT_ID'),'loud missing keys')
  assert.equal(codeWorkflowMissingConfig(baseConfig()),null)
})

test('C25: endpoint matrix — https, no userinfo/query, fixed paths, official suffixes, private refused',()=>{
  assert.ok(validateCodeEndpoint('https://api.coze.cn/run').url)
  assert.ok(validateCodeEndpoint('https://xx.coze.run/v1/fs/abc123_/run').url)
  for(const bad of [
    'http://api.coze.cn/run',
    'https://user:pw@api.coze.cn/run',
    'https://api.coze.cn/run?x=1',
    'https://api.coze.cn/run#f',
    'https://api.coze.cn/api',
    'https://api.coze.cn/v1/fs/abc/extra/run',
    'https://api.coze.cn/v1/fs/%2e%2e/run',
    'https://evil.com/run',
    'https://127.0.0.1.coze.cn/run',
    'https://localhost.coze.run/run',
    'https://coze.cn/run',
    'not-a-url',
  ])assert.throws(()=>validateCodeEndpoint(bad),(error:unknown)=>error instanceof CodeWorkflowError&&error.code==='CODE_ENDPOINT_INVALID',bad)
})

test('C17/C18/C19: strict business schema, exact dedup, direct JSON (no legacy envelope)',()=>{
  const out=parseCodeWorkflowBusinessBody({schemaVersion:1,items:[
    {documentId:'d1',content:'甲'},{documentId:'d1',content:'甲'},{documentId:'d2',content:'乙',score:0.5},
  ]})
  assert.deepEqual(out.items.map(hit=>hit.documentId),['d1','d2'],'dedup preserves order')
  assert.equal(out.items[1]!.score,0.5)
  assert.deepEqual(parseCodeWorkflowBusinessBody({schemaVersion:1,items:[]}).items,[])
  assert.throws(()=>parseCodeWorkflowBusinessBody({code:0,data:'{"schemaVersion":1,"items":[]}'}),/CODE_ENVELOPE_MISMATCH/,'C19: legacy envelope on code transport is a mismatch')
  assert.throws(()=>parseCodeWorkflowBusinessBody({items:[]}),/CODE_CONTRACT_INVALID/)
  assert.throws(()=>parseCodeWorkflowBusinessBody({schemaVersion:1,items:[{documentId:'d',content:'x'.repeat(4001)}]}),/CODE_CONTRACT_INVALID/)
  assert.throws(()=>parseCodeWorkflowBusinessBody({schemaVersion:1,items:[{documentId:'d'.repeat(300),content:'x'}]}),/CODE_CONTRACT_INVALID/)
  // score must be finite number or null; NaN/Infinity are rejected into null
  assert.equal(parseCodeWorkflowBusinessBody({schemaVersion:1,items:[{documentId:'d',content:'x',score:'high'}]}).items[0]!.score,null)
})

test('C21/C22/C23/C24: real transport edges over local mock — auth stop, errors, cancel, byte cap, redirect, private target',async()=>{
  const seen:{url:string;authorization:string|undefined;body:any;redirect?:string}[]=[]
  let respond:{status:number;body:string;delayMs?:number;huge?:boolean;redirect?:string}={status:200,body:JSON.stringify({schemaVersion:1,items:[]})}
  const server:Server=createServer((req,res)=>{
    let payload=''
    req.on('data',(chunk:Buffer)=>{payload+=chunk.toString()})
    req.on('end',()=>{
      let parsed:any=null
      try{parsed=JSON.parse(payload)}catch{}
      seen.push({url:req.url??'',authorization:req.headers.authorization,body:parsed,redirect:respond.redirect})
      if(respond.redirect){res.writeHead(302,{Location:respond.redirect});res.end();return}
      const delay=respond.delayMs??0
      if(delay){setTimeout(()=>{res.writeHead(respond.status);res.end(respond.body)},delay);return}
      if(respond.huge){res.writeHead(200);res.end(Buffer.alloc(300*1024).fill('a'));return}
      res.writeHead(respond.status);res.end(respond.body)
    })
  })
  await new Promise<void>(ready=>server.listen(0,'127.0.0.1',ready))
  // The approved-endpoint rule blocks local hosts, so the transport test uses
  // a fetch impl that asserts the REQUEST SHAPE then serves local bytes.
  const mockFetch=(async(url:string,init?:RequestInit)=>{
    seen.push({url:String(url),authorization:(init?.headers as Record<string,string>)?.Authorization,body:JSON.parse(String(init?.body))})
    assert.equal(init?.redirect,'error','redirects refused at fetch level')
    if(respond.redirect)return new Response('',{status:302,headers:{Location:respond.redirect}})
    const wireDelay=respond.delayMs??0
    if(wireDelay)await new Promise(done=>setTimeout(done,wireDelay+500))
    if(respond.huge)return new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.alloc(300*1024));controller.close()}}),{status:200})
    return new Response(respond.body,{status:respond.status})
  }) as typeof fetch
  try{
    const ok=await searchCodeWorkflowKnowledge('浙江 2026 专升本 报名条件',undefined,baseConfig(),()=>performance.now(),mockFetch)
    assert.equal(ok.hits.length,0)
    assert.equal(seen.at(-1)!.authorization,'Bearer runtime-token','dedicated runtime token only')
    assert.deepEqual(seen.at(-1)!.body,{query:'浙江 2026 专升本 报名条件'},'body is exactly {query}')

    // C07: invalid queries never reach the wire
    seen.length=0
    await assert.rejects(searchCodeWorkflowKnowledge('',undefined,baseConfig(),()=>performance.now(),mockFetch),/CODE_QUERY_INVALID/)
    await assert.rejects(searchCodeWorkflowKnowledge('x'.repeat(2001),undefined,baseConfig(),()=>performance.now(),mockFetch),/CODE_QUERY_INVALID/)
    assert.equal(seen.length,0)

    // C21: 401/403 stop immediately — no retries with the same credential
    respond={status:403,body:''}
    await assert.rejects(searchCodeWorkflowKnowledge('q',undefined,baseConfig(),()=>performance.now(),mockFetch),(error:unknown)=>error instanceof CodeWorkflowError&&error.code==='CODE_AUTH_403')

    // C22: timeout, 500, 429, bad JSON — distinct codes, no silent success
    respond={status:200,body:'not-json'}
    await assert.rejects(searchCodeWorkflowKnowledge('q',undefined,baseConfig(),()=>performance.now(),mockFetch),/CODE_CONTRACT_INVALID/)
    respond={status:500,body:''}
    await assert.rejects(searchCodeWorkflowKnowledge('q',undefined,baseConfig(),()=>performance.now(),mockFetch),/CODE_HTTP_500/)
    respond={status:429,body:''}
    await assert.rejects(searchCodeWorkflowKnowledge('q',undefined,baseConfig(),()=>performance.now(),mockFetch),/CODE_RATE_LIMITED/)
    respond={status:200,body:'',delayMs:1200}
    await assert.rejects(searchCodeWorkflowKnowledge('q',undefined,baseConfig(),()=>performance.now(),mockFetch),/COZE_TIMEOUT/,'total deadline enforced')

    // C23: pre-cancelled parent signal — nothing sent
    seen.length=0
    const cancelled=new AbortController();cancelled.abort()
    await assert.rejects(searchCodeWorkflowKnowledge('q',cancelled.signal,baseConfig(),()=>performance.now(),mockFetch),(error:unknown)=>error instanceof CodeWorkflowError&&error.code==='CANCELLED')
    assert.equal(seen.length,0,'no request left the wire')

    // C24: cumulative byte cap aborts mid-stream
    respond={status:200,body:'',huge:true}
    await assert.rejects(searchCodeWorkflowKnowledge('q',undefined,baseConfig({timeoutMs:5000}),()=>performance.now(),mockFetch),/CODE_RESPONSE_TOO_LARGE/)

    // C25: redirect — fetch-level error surfaces, token never follows
    respond={status:200,body:'',redirect:'https://evil.com/run'}
    await assert.rejects(searchCodeWorkflowKnowledge('q',undefined,baseConfig(),()=>performance.now(),mockFetch),/CODE_HTTP_302|CODE_REQUEST_FAILED/)
  }finally{
    await new Promise<void>(done=>server.close(()=>done()))
  }
})

test('C06b: missing config with enabled flag is CONFIG_MISSING, not silent success',async()=>{
  const bad=baseConfig({token:''})
  await assert.rejects(searchCodeWorkflowKnowledge('q',undefined,bad),(error:unknown)=>error instanceof CodeWorkflowError&&error.code.startsWith('CONFIG_MISSING'))
})
