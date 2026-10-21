import test from 'node:test'
import assert from 'node:assert/strict'
import {selectBackendTests} from '../scripts/backend-test-selection.ts'
const available=['growth-model.test.ts','growth-source-span.test.ts','model-payload.test.ts','live-reliability.test.ts','official-source-public.test.ts','campus-comparison-real-review.test.ts','action-coach-browser.test.ts','campus-repair.test.ts']
test('one targeted batch retains all independent checks in requested order and removes duplicate execution',()=>{
  assert.deepEqual(selectBackendTests(available,['--file=growth-source-span.test.ts','--file=growth-model.test.ts','--file=model-payload.test.ts','--file=growth-model.test.ts']),['growth-source-span.test.ts','growth-model.test.ts','model-payload.test.ts'])
})
test('a later invalid or preserved target fails the entire batch instead of silently checking only its first file',()=>{
  for(const target of ['../private.test.ts','missing.test.ts','campus-repair.test.ts',''])assert.throws(()=>selectBackendTests(available,['--file=growth-model.test.ts','--file='+target]))
})
test('default checks still exclude live/provider/private evidence and browser-only keeps its previous scope',()=>{
  assert.deepEqual(selectBackendTests(available,[]),['growth-model.test.ts','growth-source-span.test.ts','model-payload.test.ts'])
  assert.deepEqual(selectBackendTests(available,['--browser-only']),['action-coach-browser.test.ts'])
  assert.throws(()=>selectBackendTests(available,['--engine-workload']))
})
test('malformed target syntax never falls back to a broad batch and protected historical engine never runs',()=>{
  const files=[...available,'action-coach-engine.test.ts']
  for(const args of [['--file','growth-model.test.ts'],['growth-model.test.ts'],['--file=action-coach-engine.test.ts']])assert.throws(()=>selectBackendTests(files,args))
  assert.ok(!selectBackendTests(files,[]).includes('action-coach-engine.test.ts'))
})
