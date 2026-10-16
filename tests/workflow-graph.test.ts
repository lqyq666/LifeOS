import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createGraph,type GraphData} from '../src/features/cognition/graph.ts'
test('saved HTTP graph with related experiences loads without invalidating the chat entry',()=>{
 const fixture=JSON.parse(readFileSync('tests/fixtures/workflow-graph-failure.json','utf8')) as GraphData
 assert.doesNotThrow(()=>createGraph(fixture))
 const relation=fixture.edges.find((e:any)=>e.sourceEvidenceType==='experience_relation')!
 relation.type='RELATES_TO_EXPERIENCE';assert.doesNotThrow(()=>createGraph(fixture))
 relation.targetId=fixture.rootId;assert.throws(()=>createGraph(fixture),/Invalid edge/)
})
