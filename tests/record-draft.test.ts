import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRecordDrafts, recordEditingDraft, recordCorrectionContent, recordLocalCorrection } from '../src/features/cognition/recordDraft.ts'

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

test('editing a record preserves untouched source and tags and an explicitly cleared field', () => {
  const record = { summary: '旧摘要', action: '本人发送了PDF', result: '是否阅读未知', source: '用户对话原话', tags: ['课程资料'] }
  const editing = recordEditingDraft(record, { summary: '', result: '已收到回复，采用未知' })
  assert.equal(editing.summary, '')
  assert.equal(editing.source, record.source)
  assert.deepEqual(editing.tags, record.tags)
  assert.equal(editing.action, record.action)
  assert.equal(editing.result, '已收到回复，采用未知')
  assert.equal(record.result, '是否阅读未知')
})

test('live record corrections omit untouched facts and hidden metadata, including derived-only fields', () => {
  const initial = recordEditingDraft({ summary: '旧摘要', source: ' original ', tags: [' 标记 ', ' 标记 '] }, {})
  const next = { ...initial, summary: '更正后的摘要' }
  assert.deepEqual(recordCorrectionContent(initial, next), { summary: '更正后的摘要' })
  const populated = recordEditingDraft({ summary: '已有经历', action: '发了PDF', result: '还未回复' }, {})
  assert.deepEqual(recordCorrectionContent(populated, { ...populated, result: '' }), { summary: '已有经历', result: '' })
})

test('local corrections keep prior hidden source verbatim and do not copy normalized seed metadata', () => {
  const seed = { summary: '原经历', action: '我发了PDF', source: ' seed source ', tags: ['种子标签'] }
  const prior = { source: ' original source ', tags: ['已有标签'], reflection: '本人原有反思' }
  const initial = recordEditingDraft(seed, prior)
  const normalized = { ...initial, source: 'original source', result: '已回复，是否采用未知' }
  assert.deepEqual(recordLocalCorrection(prior, initial, normalized), { ...prior, summary: '原经历', result: '已回复，是否采用未知' })
  assert.deepEqual(recordLocalCorrection({}, recordEditingDraft(seed, {}), { ...recordEditingDraft(seed, {}), result: '尚未回应' }), { summary: '原经历', result: '尚未回应' })
})

test('submission trims only edited fields and preserves an untouched whitespace-bearing summary',()=>{
  const initial=recordEditingDraft({summary:'  原经历  ',action:' 原行动 ',result:'还没回复',source:' 原来源 '},{})
  assert.deepEqual(recordCorrectionContent(initial,{...initial,result:'  学长已回复  '}),{summary:'  原经历  ',result:'学长已回复'})
  assert.deepEqual(recordCorrectionContent(initial,{...initial,summary:'  更正经历  ',result:''}),{summary:'更正经历',result:''})
  assert.deepEqual(recordLocalCorrection({source:' 原来源 '},initial,{...initial,result:'  学长已回复  '}),{source:' 原来源 ',summary:'  原经历  ',result:'学长已回复'})
})
