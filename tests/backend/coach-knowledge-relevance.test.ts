import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {pool} from '../../server/db.ts'
import {importKnowledge} from '../../server/campus-knowledge.ts'
import {retrieveCoachKnowledge} from '../../server/coach-knowledge.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test('real local source lookup can return no relevant source without losing definition paraphrases',async()=>{
  const fixture=JSON.parse(readFileSync('tests/fixtures/coach-knowledge-relevance.json','utf8'))
  const [card]=JSON.parse(readFileSync(fixture.source,'utf8'))
  const results:{id:string;expected:boolean;returned:boolean}[]=[]
  try{
    await importKnowledge([card])
    for(const item of fixture.cases){
      const found=await retrieveCoachKnowledge(item.text)
      results.push({id:item.id,expected:item.relevant,returned:found.some(source=>source.id===card.id)})
    }
    assert.deepEqual(results.filter(item=>item.expected!==item.returned),[],JSON.stringify(results))
  }finally{await localEmbedding.close();await pool.end()}
})
