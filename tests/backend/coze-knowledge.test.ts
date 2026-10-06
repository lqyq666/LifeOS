import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer,type Server} from 'node:http'
import {randomUUID,createHash} from 'node:crypto'
import {writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {pool} from '../../server/db.ts'
import {cozeConfigFrom,cozeMissingConfig,parseCozeWorkflowBody,searchCozePublicKnowledge,mapCozeCandidates,loadCozePublicRegistry,CozeRetrievalError,type PublicKnowledgeHit} from '../../server/coze-knowledge.ts'
import {buildPublicKnowledgeQueryFromText,renderPublicKnowledgeQuery} from '../../server/coze-public-query.ts'
import {importKnowledge,type KnowledgeCard} from '../../server/campus-knowledge.ts'
import {retrieveCoachKnowledge} from '../../server/coach-knowledge.ts'

test.after(async()=>{await pool.end()})

const WORKFLOW_ID='wf-test-1'
const card=(revision=1,excerpt='浙江2026年专升本报名条件：考生须为全日制高职高专应届毕业生，具体以当年省教育考试院文件为准。'):KnowledgeCard=>({
  id:randomUUID(),revision,kind:'policy',status:'verified',synthetic:false,
  title:'SYNTHETIC 浙江2026专升本规定',url:'https://example.invalid/zj-2026-zsb',publisher:'SYNTHETIC TEST',
  publishedYear:'2026',verifiedAt:new Date().toISOString(),validUntil:new Date(Date.now()+86400000).toISOString(),
  excerpt,claim:'浙江2026年专升本报名需应届高职高专学历',scope:'浙江 2026 全日制高职高专应届毕业生',
  limitations:'合成测试条目',mechanisms:['official_document'],sourceHash:createHash('sha256').update(excerpt).digest('hex'),
  scopeRules:{institution:{status:'all',quote:'全省'},department:{status:'all',quote:'全部'},project:{status:'all',quote:'专升本'},year:{status:'specific',value:'2026',quote:'2026'},population:{status:'specific',value:'应届毕业生',quote:'应届'}},
  scopeEvidence:['全省适用于各类院校','全部院系','专升本','2026年','应届毕业生']
})

test('workflow contract: outer envelope, one-shot data parse, strict items',()=>{
  const good=parseCozeWorkflowBody({code:0,msg:'',data:JSON.stringify({schemaVersion:1,items:[{documentId:'d1',content:'片段甲',score:0.9}]})})
  assert.equal(good.items.length,1)
  assert.throws(()=>parseCozeWorkflowBody({code:4001,msg:'quota'}),(error:unknown)=>error instanceof CozeRetrievalError&&error.code==='COZE_CONTRACT_INVALID')
  assert.throws(()=>parseCozeWorkflowBody({code:0,data:'not-json'}),/COZE_CONTRACT_INVALID/)
  assert.throws(()=>parseCozeWorkflowBody({code:0,data:JSON.stringify({items:[]})}),/COZE_CONTRACT_INVALID/,'缺schemaVersion是契约失败不是空结果')
  assert.equal(parseCozeWorkflowBody({code:0,data:JSON.stringify({schemaVersion:1,items:[]})}).items.length,0,'明确空items是无结果')
  assert.equal(parseCozeWorkflowBody({code:0,data:JSON.stringify({schemaVersion:1,items:[{documentId:'',content:'x'}]})}).items.length,0,'畸形条目被丢弃而非伪装结果')
})

test('config states: disabled vs CONFIG_MISSING are distinct and loud',()=>{
  assert.deepEqual(cozeMissingConfig(cozeConfigFrom({})),['DISABLED'])
  const enabled=cozeMissingConfig(cozeConfigFrom({LIFEOS_COZE_KNOWLEDGE:'true'}))
  assert.ok(enabled!.includes('LIFEOS_COZE_PAT')&&enabled!.includes('LIFEOS_COZE_WORKFLOW_ID'),'启用但缺配置必须明确列出，不装作disabled成功')
  const complete=cozeConfigFrom({LIFEOS_COZE_KNOWLEDGE:'true',LIFEOS_COZE_PAT:'pat',LIFEOS_COZE_WORKFLOW_ID:WORKFLOW_ID})
  assert.equal(cozeMissingConfig(complete),null)
  assert.equal(complete.workflowVersion,null,'未固定版本记WORKFLOW_VERSION_UNPINNED')
  assert.equal(complete.timeoutMs,2000)
})

test('public query whitelist: structured fields only, unsafe text yields null',()=>{
  const query=buildPublicKnowledgeQueryFromText('2026年浙江专升本的报名条件是什么？')!
  assert.ok(query)
  assert.deepEqual({...query},{topic:'undergraduate_upgrade',year:2026,region:'浙江',questionKind:'requirements'})
  assert.equal(renderPublicKnowledgeQuery(query),'undergraduate_upgrade 2026 浙江 requirements','输出仅由白名单字段构成，不含原文其余内容')
  // No public topic → no query → Coze skipped, raw chat never leaves.
  assert.equal(buildPublicKnowledgeQueryFromText('我今天心情不太好'),null)
  assert.equal(buildPublicKnowledgeQueryFromText('我叫小林，帮我写简历'),null,'姓名与私人请求不产生公共检索')
})

test('search: fixed origin, pinned version, timeout, byte cap, cancellation',async()=>{
  const requests:{url:string;authorization:string|undefined;body:any}[]=[]
  let respond:{status:number;body:string;delayMs?:number;huge?:boolean}={status:200,body:JSON.stringify({code:0,data:JSON.stringify({schemaVersion:1,items:[]})})}
  const server:Server=createServer((req,res)=>{
    let payload=''
    req.on('data',(chunk:Buffer)=>{payload+=chunk.toString()})
    req.on('end',()=>{
      let parsed:any=null
      try{parsed=JSON.parse(payload)}catch{}
      requests.push({url:req.url??'',authorization:req.headers.authorization,body:parsed})
      if(respond.delayMs){setTimeout(()=>{res.writeHead(respond.status);res.end(respond.body)},respond.delayMs);return}
      if(respond.huge){res.writeHead(200);res.write(Buffer.alloc(300*1024).fill('a'));res.end();return}
      res.writeHead(respond.status);res.end(respond.body)
    })
  })
  await new Promise<void>(ready=>server.listen(0,'127.0.0.1',ready))
  const config={enabled:true,workflowId:WORKFLOW_ID,workflowVersion:'v3',pat:'pat-token',timeoutMs:800,maxItems:6}
  const query=buildPublicKnowledgeQueryFromText('2026年浙江专升本的报名条件是什么？')!
  try{
    // Origin is FIXED: the client never consults env for the host, so we can
    // only verify request shape via the fetch impl injection.
    let abortingController=new AbortController()
    const fetchImpl=(async(_url:string,init?:RequestInit)=>{
      assert.equal(init?.redirect,'error','生产origin固定且不允许重定向带走PAT')
      return fetchImplReal(_url,init)
    }) as typeof fetch
    const fetchImplReal:typeof fetch=async()=>{throw new Error('unused')}
    // Use real fetch against the local mock by pointing the test at it via a
    // direct call with a patched global — simpler: pass mock fetch directly.
    const mockFetch=(async(url:string,init?:RequestInit)=>{
      requests.push({url,authorization:(init?.headers as Record<string,string>)?.Authorization,body:JSON.parse(String(init?.body))})
      const delayMs=respond.delayMs??0
      if(delayMs)await new Promise(done=>setTimeout(done,delayMs+400))
      if(respond.huge)return new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.alloc(300*1024));controller.close()}}),{status:200})
      return new Response(respond.body,{status:respond.status})
    }) as typeof fetch
    const result=await searchCozePublicKnowledge(query,renderPublicKnowledgeQuery(query),undefined,config,()=>performance.now(),mockFetch)
    assert.equal(result.version,'v3')
    assert.equal(requests[0]!.url,'https://api.coze.cn/v1/workflow/run')
    assert.equal(requests[0]!.authorization,'Bearer pat-token')
    assert.equal(requests[0]!.body.workflow_version,'v3','显式传入已发布版本')
    assert.equal(requests[0]!.body.parameters.query,renderPublicKnowledgeQuery(query),'只发送白名单构造的查询')
    respond={status:503,body:'x'}
    await assert.rejects(searchCozePublicKnowledge(query,'q',undefined,config,()=>performance.now(),mockFetch),(error:unknown)=>error instanceof CozeRetrievalError&&error.code==='COZE_HTTP_503')
    respond={status:200,body:'x',delayMs:1200}
    await assert.rejects(searchCozePublicKnowledge(query,'q',undefined,config,()=>performance.now(),mockFetch),(error:unknown)=>error instanceof CozeRetrievalError&&error.code==='COZE_TIMEOUT','2000ms级超时上界')
    respond={status:200,body:'x',huge:true}
    await assert.rejects(searchCozePublicKnowledge(query,'q',undefined,{...config,timeoutMs:5000},()=>performance.now(),mockFetch),(error:unknown)=>error instanceof CozeRetrievalError&&error.code==='COZE_RESPONSE_TOO_LARGE','累计字节超限立即中止')
    const cancelled=new AbortController();cancelled.abort()
    await assert.rejects(searchCozePublicKnowledge(query,'q',cancelled.signal,config,()=>performance.now(),mockFetch),(error:unknown)=>error instanceof CozeRetrievalError&&error.code==='CANCELLED','已取消的signal不得发请求')
  }finally{
    await new Promise<void>(done=>server.close(()=>done()))
  }
})

test('candidate mapping: registry-bound cards verify, unknown docs stay unverified, no campus_knowledge writes',async()=>{
  const verifiedCard=card()
  await importKnowledge([verifiedCard])
  const excerpt='浙江2026年专升本报名条件：考生须为全日制高职高专应届毕业生，具体以当年省教育考试院文件为准。'
  // Temporary independent registry (work-order §7.4: no test IDs may remain
  // in the Git working tree), injected via registryRoot.
  const registryRoot=resolve('.local/coze-automation/test-registry-'+Date.now())
  mkdirSync(registryRoot,{recursive:true})
  mkdirSync(resolve(registryRoot,'.planning/research/campus-growth'),{recursive:true})
  writeFileSync(resolve(registryRoot,'.planning/research/campus-growth/coze-public-registry.json'),JSON.stringify({schemaVersion:1,bindings:[
    {workflowId:WORKFLOW_ID,datasetId:'ds-1',documentId:'doc-known',knowledgeCardId:verifiedCard.id,expectedRevision:1,expectedSourceHash:verifiedCard.sourceHash},
    {workflowId:WORKFLOW_ID,datasetId:'ds-1',documentId:'doc-stale-revision',knowledgeCardId:verifiedCard.id,expectedRevision:2,expectedSourceHash:verifiedCard.sourceHash},
  ]},null,2)+'\n')
  ;(loadCozePublicRegistry as unknown as {cache?:unknown}).cache=undefined
  const config={enabled:true,workflowId:WORKFLOW_ID,workflowVersion:null,pat:'p',timeoutMs:2000,maxItems:6}
  const hits:PublicKnowledgeHit[]=[
    {documentId:'doc-known',content:excerpt,score:0.9},
    {documentId:'doc-unknown',content:'完全未登记的片段',score:0.8},
    {documentId:'doc-stale-revision',content:excerpt,score:0.7},
    {documentId:'doc-known',content:'不在已核实excerpt中的编造内容',score:0.6},
  ]
  const mapper=(sql:string,params:unknown[])=>pool.query(sql,params)
  const mapped=await mapCozeCandidates(hits,config,{query:mapper,registryRoot})
  assert.equal(mapped.verified.length,1,'只有登记且全项核对的候选成为verified')
  assert.equal(mapped.verified[0]!.card.id,verifiedCard.id)
  assert.equal(mapped.unverifiedDocumentIds.length,3)
  // No new rows ever written for candidates.
  const count=(await pool.query('SELECT count(*)::int AS n FROM campus_knowledge')).rows[0].n
  const mappedAgain=await mapCozeCandidates(hits,config,{query:mapper,registryRoot})
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM campus_knowledge')).rows[0].n,count+0,'候选映射零写入：再次映射不新增行')
  assert.equal(mappedAgain.verified.length,1)
})

test('legacy auto-verified coze cards are excluded from valid knowledge',async()=>{
  const legacy=card(1,'旧扣子自动认证时代的片段内容。')
  legacy.mechanisms=['coze_public_knowledge_retrieval']
  await importKnowledge([legacy],true)
  // Stub the offline encoder for this one call: this case exercises the
  // mechanism-exclusion rule, not embedding ranking, and spawning the python
  // worker here wedged the full local suite on this machine (see NEXT report).
  const {localEmbedding}=await import('../../server/local-embedding.ts')
  const realEncode=localEmbedding.encode.bind(localEmbedding)
  localEmbedding.encode=(async(texts:string[])=>texts.map(()=>Array.from({length:32},()=>1/Math.sqrt(32)))) as typeof localEmbedding.encode
  try{
    const found=await retrieveCoachKnowledge('专升本报名条件是什么')
    assert.ok(!found.some(entry=>entry.id===legacy.id),'legacy coze机制卡不再可引用')
  }finally{
    localEmbedding.encode=realEncode
  }
})
