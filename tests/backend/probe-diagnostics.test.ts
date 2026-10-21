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

test('probe diagnostics classify SDK connection failures without inventing a provider rejection',()=>{
  for(const message of ['Connection error.','APIConnectionError: Connection error.','getaddrinfo EAI_AGAIN','UND_ERR_SOCKET'])assert.equal(probeErrorCategory(message),'NETWORK',message)
  assert.equal(probeErrorCategory('Connection timeout'),'TIMEOUT')
  assert.equal(probeErrorCategory('401 invalid key'),'AUTHENTICATION')
  assert.equal(probeErrorCategory('unexpected response'),'UNCLASSIFIED_ERROR')
})

test('workspace-shaped synthetic keys are redacted even when the configured-key list is unavailable',()=>{
  const key='sk-ws-SYNTHETIC.PART_TWO_FOR_TESTS.signature_NOT_A_REAL_CREDENTIAL'
  assert.equal(redactProbeText(key,[]),'[REDACTED]')
  const value=redactProbeValue({error:'request failed: '+key,nested:['ordinary reply',key]},[]) as any
  assert.deepEqual(value,{error:'request failed: [REDACTED]',nested:['ordinary reply','[REDACTED]']})
})
