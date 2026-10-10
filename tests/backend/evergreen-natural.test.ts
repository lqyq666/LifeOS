import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {pool} from '../../server/db.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {retrieveIndexedKnowledge,clearKnowledgeIndexMemory} from '../../server/knowledge-index.ts'
import {knowledgeIntent,kbHash} from '../../server/evergreen-guide.ts'
test('prelabelled new natural queries use real local encoder and expose every domain, stage and unavailable target',async()=>{
 const root='.planning/research/evergreen/',read=(n:string)=>readFileSync(root+n,'utf8').trim().split('\n').map(x=>JSON.parse(x)),cards=read('KB_GUIDES.jsonl'),bytes=readFileSync(root+'KB_NATURAL_QUERIES.json','utf8'),freeze=JSON.parse(readFileSync(root+'KB_NATURAL_FREEZE.json','utf8'))
 assert.equal(kbHash(bytes),freeze.sha256);assert.ok(freeze.count>=200)
 const split=process.env.LIFEOS_QUERY_SPLIT??'development';assert.ok(['development','sealed'].includes(split))
 const directory=process.env.LIFEOS_WORKFLOW_EVIDENCE??'.local/natural-queries';mkdirSync(directory,{recursive:true})
 const out=directory+'/NATURAL_'+split+'_'+(process.env.LIFEOS_QUERY_RUN??'first')+'.json';if(existsSync(out))throw new Error('EVIDENCE_ALREADY_EXISTS')
 const rows:any[]=[],approved=new Set(cards.filter(c=>c.status==='verified').map(c=>c.guide.canonicalKey))
 try{
  await importEvergreenCorpus(cards,read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
  for(const c of JSON.parse(bytes).cases.filter((c:any)=>c.split===split)){
   const intent=knowledgeIntent(c.text,c.context),found=!['NONE','CLARIFY'].includes(intent.decision)?await retrieveIndexedKnowledge(intent.query,undefined,intent):null,keys=found?.cards.map(c=>c.guide?.canonicalKey)??[]
   const available=c.acceptableKeys.some((k:string)=>approved.has(k)),target=cards.filter(x=>c.acceptableKeys.includes(x.guide.canonicalKey)).map(x=>x.id)
   rows.push({...c,actualRoute:intent.decision,actualStage:intent.stage,routeCorrect:c.expectedRoute===intent.decision,keys,legalTargetAvailable:available,recall5:available&&Boolean(found?.trace.candidates.some(x=>x.reason==='eligible'&&target.includes(x.id))),top1:available&&c.acceptableKeys.includes(keys[0]),trace:found?.trace??null})
  }
  const metrics=(rs:any[])=>({route:{numerator:rs.filter(x=>x.routeCorrect).length,denominator:rs.length},recall5:{numerator:rs.filter(x=>x.recall5).length,denominator:rs.filter(x=>x.legalTargetAvailable).length},top1:{numerator:rs.filter(x=>x.top1).length,denominator:rs.filter(x=>x.legalTargetAvailable).length},missingTarget:{numerator:rs.filter(x=>x.acceptableKeys.length&&!x.legalTargetAvailable).length,denominator:rs.filter(x=>x.acceptableKeys.length).length},noMatchingMethod:rs.filter(x=>x.expectedRoute==='METHOD'&&!x.acceptableKeys.length).length})
  const group=(field:string)=>Object.fromEntries([...new Set(rows.map(x=>x[field]))].map(k=>[k,metrics(rows.filter(x=>x[field]===k))]))
  const result={evidence:'LOCAL_ENCODER_ISOLATED_PG_NO_PRODUCT_PROVIDER',paidCalls:0,benchmarkHash:freeze.sha256,split,role:'EXPOSED_REGRESSION_ONLY',sealedUsedForTuning:false,independentBlindTest:false,metrics:metrics(rows),byDomain:group('domain'),byStage:group('stage'),rows}
  writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.metrics));assert.equal(rows.length,JSON.parse(bytes).cases.filter((c:any)=>c.split===split).length)
 }finally{await localEmbedding.close();await pool.end();clearKnowledgeIndexMemory()}
})
