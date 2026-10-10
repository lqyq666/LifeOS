import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fixture} from '../workflows/fixtures.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {workflowMethodReader} from '../../server/workflows/method-context.ts'
import {pool} from '../../server/db.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
test('deep method reader uses canonical approved corpus, bounded fragments, controls and live withdrawal even from cache',async()=>{
 const read=(n:string)=>readFileSync('.planning/research/evergreen/'+n,'utf8').trim().split('\n').map(x=>JSON.parse(x))
 try{
  await importEvergreenCorpus(read('KB_GUIDES.jsonl'),read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
  const f=fixture(),request={...f.request,currentIntent:'我想验证校园创业项目的需求，怎么访谈用户？'},reader=workflowMethodReader()
  const fragments=await reader(request);assert.ok(fragments.length>0);assert.ok(fragments.length<=2)
  for(const fragment of fragments){assert.equal(fragment.untrustedPublicMethod,true);const card=(await pool.query('SELECT revision,status,payload FROM campus_knowledge WHERE id=$1',[fragment.id])).rows[0];assert.equal(card.status,'verified');assert.equal(card.revision,fragment.revision);assert.equal(card.payload.guide.reviewStatus,'approved');assert.ok(fragment.scope);assert.ok(fragment.limitations)}
  assert.deepEqual(await reader({...request,controls:{...request.controls,refuseAdvice:true}}),[])
  assert.deepEqual(await reader({...request,currentIntent:'我只想被听见，不需要办法。',controls:{...request.controls,listeningOnly:true}}),[])
  const first=fragments[0];assert.ok(Array.isArray(first.evidenceIds))
  const source=(await pool.query('SELECT source_id FROM kb_evidence WHERE evidence_id=$1',[first.evidenceIds[0]])).rows[0]
  assert.ok(source);await pool.query("UPDATE kb_sources SET status='retired' WHERE source_id=$1",[source.source_id])
  await assert.rejects(reader(request),(error:any)=>error.code==='source_invalid')
 }finally{await localEmbedding.close();await pool.end()}
})
