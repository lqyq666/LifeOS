import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRecordDrafts } from '../src/features/cognition/recordDraft.ts'

test('record drafts round trip with separate node data and no seed mutation', () => {
  const records = { 'exp-bodymate': { reflection: '用户自己的记录', tags: ['学习', '学习'] }, 'exp-entrepreneurship': { source: '用户补充的原始描述' } }
  assert.deepEqual(parseRecordDrafts(JSON.stringify(records)), { ...records, 'exp-bodymate': { reflection: '用户自己的记录', tags: ['学习'] } })
})
test('unknown and non-experience IDs cannot replace graph entities', () => {
  assert.deepEqual(parseRecordDrafts(JSON.stringify({ 'value-creation': { summary: '错误覆盖' }, 'unknown': {} })), {})
})
test('corrupt or oversized local records fail without silently discarding them', () => {
  for (const raw of ['broken', '[]', '{"exp-bodymate":null}', JSON.stringify({ 'exp-bodymate': { summary: 'a'.repeat(4001) } }), JSON.stringify({ 'exp-bodymate': { tags: ['a'.repeat(25)] } }), JSON.stringify({ 'exp-bodymate': { tags: Array.from({length:13},(_,i)=>String(i)) } })]) assert.throws(() => parseRecordDrafts(raw))
})
test('record text remains plain data; unrelated fields are not imported', () => {
  assert.deepEqual(parseRecordDrafts('{"exp-bodymate":{"source":"<script>alert(1)</script>","verified":true,"type":"value"}}'), { 'exp-bodymate': { source: '<script>alert(1)</script>' } })
})
