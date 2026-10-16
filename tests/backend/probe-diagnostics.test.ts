import test from 'node:test'
import assert from 'node:assert/strict'
import {redactProbeText,redactProbeValue,probeErrorCategory} from '../../scripts/probe-diagnostics.ts'

test('probe diagnostics remove configured credentials, bearer values, and secret assignments',()=>{
  const secret='private-fixture-value-not-a-real-key'
  const output=redactProbeText(`429 rate limit; ${secret}; Authorization: Bearer unrelated-value\napi_key=another-private-value\nerror=retry later`,[secret])
  for(const value of [secret,'unrelated-value','another-private-value'])assert.equal(output.includes(value),false)
  assert.equal(probeErrorCategory(output),'RATE_LIMIT')
  assert.equal(probeErrorCategory('400 response_format schema invalid'),'SCHEMA_OR_FORMAT')
  assert.equal(probeErrorCategory('Connection timeout'),'TIMEOUT')
  assert.equal(probeErrorCategory('unexpected response'),'UNCLASSIFIED_ERROR')
})
test('structured probe redaction preserves authorization metadata and valid JSON while scrubbing credential values',()=>{
  const secret='synthetic-only-credential'
  const value={authorization:{sha256:'a'.repeat(64),remaining:156},nested:[{apiKey:secret,authorization:'Bearer another-private-value',reply:'ordinary Chinese 回复'}],diagnostic:'api_key=hidden-value'}
  const serialized=JSON.stringify(redactProbeValue(value,[secret])),parsed=JSON.parse(serialized)
  assert.deepEqual(parsed.authorization,value.authorization)
  assert.equal(parsed.nested[0].apiKey,'[REDACTED]');assert.equal(parsed.nested[0].authorization,'[REDACTED]')
  assert.equal(parsed.nested[0].reply,value.nested[0]!.reply)
  assert.doesNotMatch(serialized,/synthetic-only-credential|another-private-value|hidden-value/)
})
