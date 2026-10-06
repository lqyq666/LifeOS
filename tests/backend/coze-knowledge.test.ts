import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer,type Server} from 'node:http'
import {pool} from '../../server/db.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {cozeConfigFrom,parseCozeItems,cozeCards,syncCozePublicKnowledge,CozeRetrievalError} from '../../server/coze-knowledge.ts'
import {importKnowledge,type KnowledgeCard} from '../../server/campus-knowledge.ts'
import {retrieveCoachKnowledge} from '../../server/coach-knowledge.ts'

test.after(async()=>{await localEmbedding.close();await pool.end()})

test('coze adapter config gating and strict response mapping (pure functions)',()=>{
  assert.equal(cozeConfigFrom({}).enabled,false,'adapter stays disabled by default with no credentials')
  assert.equal(cozeConfigFrom({LIFEOS_COZE_KNOWLEDGE:'true'}).enabled,false,'token and dataset are required')
  const enabled=cozeConfigFrom({LIFEOS_COZE_KNOWLEDGE:'true',LIFEOS_COZE_PAT:'pat-token',LIFEOS_COZE_DATASET_ID:'ds1',LIFEOS_COZE_TIMEOUT_MS:'700'})
  assert.equal(enabled.enabled,true)
  assert.equal(enabled.timeoutMs,700)
  assert.equal(cozeConfigFrom({LIFEOS_COZE_KNOWLEDGE:'true',LIFEOS_COZE_PAT:'p',LIFEOS_COZE_DATASET_ID:'d',LIFEOS_COZE_TIMEOUT_MS:'10'}).timeoutMs,8000,'timeout outside bounds falls back to the default')

  const body={code:0,msg:'',data:{items:[
    {document_id:'doc-1',segment_id:'seg-1',content:'浙江专升本报名条件：考生须为全日制高职高专应届毕业生。',score:0.9},
    {document_id:'doc-2',content:''},
    {document_id:'',content:'missing document id is dropped'},
    {document_id:'doc-3',content:'x'.repeat(2001)},
    'not-an-object',
  ]}}
  const items=parseCozeItems(body,6)
  assert.equal(items.length,1)
  assert.equal(items[0]!.documentId,'doc-1')
  assert.throws(()=>parseCozeItems({code:4001,msg:'quota'},6),(error:unknown)=>error instanceof CozeRetrievalError&&error.code==='COZE_RESPONSE_INVALID')
  assert.throws(()=>parseCozeItems('nope',6),/COZE_RESPONSE_INVALID/)
  assert.equal(parseCozeItems({data:{items:[]}},6).length,0)
  assert.equal(parseCozeItems(body,1).length,1,'maxItems caps parsing')

  const retrievedAt=new Date('2026-10-06T08:00:00.000Z')
  const cards=cozeCards(items,'ds-1',retrievedAt)
  assert.equal(cards.length,1)
  const card=cards[0]!
  assert.equal(card.id,cozeCards(items,'ds-1',retrievedAt)[0]!.id,'card ids are deterministic and re-import idempotent')
  assert.equal(card.validUntil,'2026-10-07T00:00:00.000Z','freshness envelope is the UTC retrieval day plus 24 hours and deterministic within that day')
  assert.ok(card.limitations.includes('未做本地原文核验'),'provenance caveat is explicit')
  assert.equal(card.claim,'浙江专升本报名条件：考生须为全日制高职高专应届毕业生。')
  assert.equal(card.synthetic,false)
  assert.match(card.id,/^[0-9a-f-]{36}$/i)
})

test('coze sync: disabled default never calls out; enabled fallback imports through the existing card pipeline; failures are audit-only',async()=>{
  const requests:{url:string;authorization:string|undefined;body:any}[]=[]
  let respondWith:{status:number;body:string;delayMs?:number}={status:200,body:JSON.stringify({code:0,data:{items:[]}})}
  const server:Server=createServer((req,res)=>{
    let payload=''
    req.on('data',(chunk:Buffer)=>{payload+=chunk.toString()})
    req.on('end',()=>{
      let parsed:any=null
      try{parsed=JSON.parse(payload)}catch{}
      requests.push({url:req.url??'',authorization:req.headers.authorization,body:parsed})
      if(respondWith.delayMs){setTimeout(()=>{res.writeHead(respondWith.status,{'Content-Type':'application/json'});res.end(respondWith.body)},respondWith.delayMs);return}
      res.writeHead(respondWith.status,{'Content-Type':'application/json'});res.end(respondWith.body)
    })
  })
  await new Promise<void>(ready=>server.listen(0,'127.0.0.1',ready))
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port
  const signal=new AbortController().signal
  try{
    const audit:Record<string,unknown>[]=[]
    await syncCozePublicKnowledge('浙江专升本报名条件是什么',signal,audit)
    assert.deepEqual(audit.at(-1),{phase:'coze_knowledge_skipped',reason:'disabled_by_default'})
    assert.equal(requests.length,0,'no external request while disabled')

    const env={LIFEOS_COZE_KNOWLEDGE:'true',LIFEOS_COZE_PAT:'pat-token',LIFEOS_COZE_DATASET_ID:'ds-accept',LIFEOS_COZE_API_BASE:base}
    respondWith={status:200,body:JSON.stringify({code:0,data:{items:[{document_id:'doc-zj',segment_id:'s1',content:'浙江专升本报名条件：考生须为全日制高职高专应届毕业生，具体以当年省教育考试院文件为准。',score:0.91}]}})}
    const auditSync:Record<string,unknown>[]=[]
    await syncCozePublicKnowledge('浙江专升本报名条件是什么',signal,auditSync,env)
    assert.equal(requests.length,1)
    assert.equal(requests[0]!.url,'/v1/datasets/ds-accept/retrieve')
    assert.equal(requests[0]!.authorization,'Bearer pat-token')
    assert.equal(requests[0]!.body.query,'浙江专升本报名条件是什么')
    assert.equal((auditSync.at(-1) as {phase:string}).phase,'coze_knowledge_synced')
    const row=(await pool.query("SELECT payload FROM campus_knowledge WHERE payload->>'publisher'='扣子公共知识检索'")).rows[0]
    assert.ok(row,'the coze item became an ordinary knowledge card via the existing import')
    const knowledge=await retrieveCoachKnowledge('浙江专升本报名条件是什么')
    assert.ok(knowledge.some(card=>card.publisher==='扣子公共知识检索'),'imported coze card is retrieved through the unchanged local pipeline')

    // Cache: the same query does not hit the external endpoint again.
    await syncCozePublicKnowledge('浙江专升本报名条件是什么',signal,auditSync,env)
    assert.equal(requests.length,1)
    assert.equal((auditSync.at(-1) as {phase:string}).phase,'coze_knowledge_cache_hit')
    // Same content under a different query is a no-change re-import, not a revision bump.
    await syncCozePublicKnowledge('帮我查一下专升本的报名条件',signal,auditSync,env)
    assert.equal(requests.length,2)
    assert.equal((auditSync.at(-1) as {imported:number;changed:number}).imported,1)
    assert.equal((auditSync.at(-1) as {changed:number}).changed,0,'identical content re-imports idempotently')

    // Every failure mode stays audit-only and never throws into the turn.
    respondWith={status:503,body:'unavailable'}
    await syncCozePublicKnowledge('查询一',signal,auditSync,env)
    assert.equal((auditSync.at(-1) as {phase:string;code:string}).code,'COZE_HTTP_503')
    respondWith={status:200,body:'not-json'}
    await syncCozePublicKnowledge('查询二',signal,auditSync,env)
    assert.equal((auditSync.at(-1) as {code:string}).code,'COZE_RESPONSE_INVALID')
    respondWith={status:200,body:JSON.stringify({code:0,data:{items:[{document_id:'d',content:'慢响应条目'}]}}),delayMs:1200}
    const fastEnv={...env,LIFEOS_COZE_TIMEOUT_MS:'500'}
    await syncCozePublicKnowledge('查询三',signal,auditSync,fastEnv)
    assert.equal((auditSync.at(-1) as {code:string}).code,'COZE_TIMEOUT')

    // Expired coze cards stop being retrieved: freshness is enforced by the
    // same validUntil rule as every other knowledge card.
    const expired:KnowledgeCard={...cozeCards([{documentId:'doc-old',segmentId:'',content:'过期的扣子公共知识条目内容。',score:null,url:null}],'ds-accept',new Date(Date.now()-48*3600*1000))[0]!,validUntil:new Date(Date.now()-24*3600*1000).toISOString()}
    await importKnowledge([expired])
    const afterExpiry=await retrieveCoachKnowledge('过期的扣子公共知识条目内容')
    assert.ok(!afterExpiry.some(card=>card.id===expired.id),'an expired coze card is never served')
  }finally{
    server.closeIdleConnections?.()
    server.closeAllConnections?.()
    await new Promise<void>(done=>server.close(()=>done()))
  }
})
