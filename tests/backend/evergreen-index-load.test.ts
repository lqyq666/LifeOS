import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import {pool} from '../../server/db.ts'
import {importKnowledge,type KnowledgeCard} from '../../server/campus-knowledge.ts'
import {buildKnowledgeIndex,retrieveIndexedKnowledge,clearKnowledgeIndexMemory} from '../../server/knowledge-index.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
test('32/112/500/1000 synthetic entries use the real offline encoder and persistent index',async()=>{
 const cards:KnowledgeCard[]=Array.from({length:1000},(_,i)=>({id:randomUUID(),revision:1,kind:'method',status:'verified',synthetic:true,title:`SYNTHETIC 文件核验 ${i}`,url:'https://example.invalid/index-load',publisher:'SYNTHETIC isolated load corpus',publishedYear:'unknown',verifiedAt:'2026-10-10T00:00:00Z',validUntil:null,excerpt:`合成测试条目${i}：核验文件能否打开，不证明用户有需求。`,claim:`测试条目${i}：先核验文件能否打开`,scope:'只在隔离负载测试中使用',limitations:'不是真实知识、语义质量或Provider速度证据',mechanisms:['synthetic_load_fixture'],sourceHash:i.toString(16).padStart(64,'0')}))
 const report:any={evidence:'REAL_OFFLINE_ENCODER_AND_ISOLATED_POSTGRESQL_SYNTHETIC_CORPUS',realProviderCalls:0,rows:[]}
 let previous=0
 try{
  for(const size of [32,112,500,1000]){
   await importKnowledge(cards.slice(previous,size),true)
   const start=performance.now(),built=await buildKnowledgeIndex()
   assert.equal(built.cards,size);assert.equal(built.encodedSegments,size-previous)
   const coldBuildMs=Math.round(performance.now()-start)
   let encoded=0;const warm=await buildKnowledgeIndex(undefined,async texts=>{encoded+=texts.length;throw new Error('WARM_INDEX_REENCODED_CORPUS')})
   assert.equal(encoded,0);assert.equal(warm.cacheHits,size)
   clearKnowledgeIndexMemory()
   const latencies=[]
   for(let q=0;q<20;q++){const before=performance.now(),result=await retrieveIndexedKnowledge('如何核验文件能否打开？');assert.ok(result.cards.length<=2);latencies.push(Math.round((performance.now()-before)*100)/100)}
   latencies.sort((a,b)=>a-b)
   report.rows.push({size,coldBuildMs,newEncodedSegments:built.encodedSegments,warmEncodedSegments:warm.encodedSegments,cacheHits:warm.cacheHits,queries:20,queryP50Ms:latencies[9],queryP95Ms:latencies[18],queryTimingScope:'SQL validation plus real local query encoding and ranking; excludes provider and browser'})
   previous=size
  }
  // Revise one entry: every other persisted vector remains reusable.
  const revised={...cards[0],revision:2,claim:'测试条目更新：核验文件是否能够正常显示'}
  await importKnowledge([revised],true)
  const incremental=await buildKnowledgeIndex();assert.equal(incremental.encodedSegments,1);assert.equal(incremental.cacheHits,999)
  report.incremental=incremental;report.status='PASS'
 }finally{mkdirSync('.local/evergreen',{recursive:true});writeFileSync('.local/evergreen/index-load-report.json',JSON.stringify(report,null,2)+'\n');await localEmbedding.close();await pool.end()}
})
