import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync} from 'node:fs'
import {pool} from '../../server/db.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {clearKnowledgeIndexMemory} from '../../server/knowledge-index.ts'
import {evaluateEvergreen} from '../../scripts/evergreen-evaluation.ts'

test('legacy 235 exposed cases retain first evidence and pass scoped regression gates',async()=>{
 const root='.planning/research/evergreen/',read=(name:string)=>readFileSync(root+name,'utf8').trim().split(/\r?\n/).map(x=>JSON.parse(x))
 const cards=read('KB_GUIDES.jsonl'),out=process.env.LIFEOS_WORKFLOW_EVIDENCE??'.local/evergreen-legacy-regression'
 mkdirSync(out,{recursive:true})
 try{
  await importEvergreenCorpus(cards,read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
  const x=await evaluateEvergreen(cards,{jsonPath:out+'/LEGACY235_REGRESSION.json',markdownPath:out+'/LEGACY235_REGRESSION.md'})
  console.log(JSON.stringify({route:x.routing,recall5:x.recall5,top1:x.top1,scope:'EXPOSED_REGRESSION_ONLY'}))
  assert.equal(x.cases.length,235)
  assert.ok(x.routing.numerator/x.routing.denominator>=.95)
  assert.ok(x.recall5.numerator/x.recall5.denominator>=.9)
  assert.ok(x.top1.numerator/x.top1.denominator>=.9)
 }finally{await localEmbedding.close();clearKnowledgeIndexMemory();await pool.end()}
})
