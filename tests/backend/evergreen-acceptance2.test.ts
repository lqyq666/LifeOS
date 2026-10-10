import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {pool} from '../../server/db.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {retrieveIndexedKnowledge,clearKnowledgeIndexMemory} from '../../server/knowledge-index.ts'
import {knowledgeIntent,kbHash} from '../../server/evergreen-guide.ts'

test('first frozen acceptance uses untouched labels and reports all domains and unavailable targets',async()=>{
 const root='.planning/research/evergreen/',read=(n:string)=>readFileSync(root+n,'utf8').trim().split('\n').map(x=>JSON.parse(x)),cards=read('KB_GUIDES.jsonl'),bytes=readFileSync(root+'KB_RETRIEVAL_ACCEPTANCE2.json','utf8'),freeze=JSON.parse(readFileSync(root+'KB_RETRIEVAL_ACCEPTANCE2_FREEZE.json','utf8'))
 assert.equal(kbHash(bytes),freeze.sha256)
 const directory=process.env.LIFEOS_WORKFLOW_EVIDENCE??'.local/retrieval-acceptance2';mkdirSync(directory,{recursive:true})
 const out=directory+'/ACCEPTANCE2_FIRST.json';if(existsSync(out))throw new Error('FIRST_ACCEPTANCE_ALREADY_EXISTS')
 const rows:any[]=[],approved=new Set(cards.filter(c=>c.status==='verified').map(c=>c.guide.canonicalKey))
 try{
  await importEvergreenCorpus(cards,read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
  for(const c of JSON.parse(bytes).cases){
   const intent=knowledgeIntent(c.text,c.context),found=!['NONE','CLARIFY'].includes(intent.decision)?await retrieveIndexedKnowledge(intent.query,undefined,intent):null,keys=found?.cards.map(c=>c.guide?.canonicalKey)??[]
   const available=c.acceptableKeys.some((k:string)=>approved.has(k)),target=cards.filter(x=>c.acceptableKeys.includes(x.guide.canonicalKey)).map(x=>x.id)
   rows.push({...c,actualRoute:intent.decision,actualStage:intent.stage,routeCorrect:c.expectedRoute===intent.decision,keys,legalTargetAvailable:available,recall5:available&&Boolean(found?.trace.candidates.some(x=>x.reason==='eligible'&&target.includes(x.id))),top1:available&&c.acceptableKeys.includes(keys[0]),controlViolation:['NONE','CLARIFY'].includes(c.expectedRoute)&&keys.length>0,trace:found?.trace??null})
  }
  const metrics=(rs:any[])=>({route:{numerator:rs.filter(x=>x.routeCorrect).length,denominator:rs.length},recall5:{numerator:rs.filter(x=>x.recall5).length,denominator:rs.filter(x=>x.legalTargetAvailable).length},top1:{numerator:rs.filter(x=>x.top1).length,denominator:rs.filter(x=>x.legalTargetAvailable).length},missingTarget:{numerator:rs.filter(x=>x.acceptableKeys.length&&!x.legalTargetAvailable).length,denominator:rs.filter(x=>x.acceptableKeys.length).length},noMatchingMethod:rs.filter(x=>x.expectedRoute==='METHOD'&&!x.acceptableKeys.length).length,controls:rs.filter(x=>x.controlViolation).length})
  const group=(field:string)=>Object.fromEntries([...new Set(rows.map(x=>x[field]))].map(k=>[k,metrics(rows.filter(x=>x[field]===k))]))
  const m=metrics(rows),gates={route:m.route.numerator/m.route.denominator>=.95,recall5:m.recall5.numerator/m.recall5.denominator>=.9,top1:m.top1.numerator/m.top1.denominator>=.9,controls:m.controls===0}
  const result={evidence:'LOCAL_ENCODER_ISOLATED_PG_NO_PRODUCT_PROVIDER',paidCalls:0,benchmarkHash:freeze.sha256,freezeCommit:'597e17a',usedForTuningBeforeThisRun:false,independentBlindTest:false,role:'FIRST_FROZEN_ACCEPTANCE_NOW_EXPOSED_REGRESSION',status:Object.values(gates).every(Boolean)?'PASS_LOCAL_RETRIEVAL_GATES':'FAIL_LOCAL_RETRIEVAL_GATES',gates,metrics:m,byDomain:group('domain'),byStage:group('stage'),rows}
  writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({metrics:m,gates}));assert.equal(rows.length,freeze.count);assert.ok(Object.values(gates).every(Boolean))
 }finally{await localEmbedding.close();await pool.end();clearKnowledgeIndexMemory()}
})
