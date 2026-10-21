import test from 'node:test'
import assert from 'node:assert/strict'
import {classifyProviderFailure,providerError} from '../../server/provider-errors.ts'

test('provider failures become bounded, public error codes without provider text',()=>{
  assert.equal(providerError('429 {"code":"1302","message":"secret"}').code,'MODEL_RATE_LIMITED')
  assert.equal(providerError('429 {"code":"1305"}').code,'MODEL_OVERLOADED')
  assert.equal(providerError('Request timed out.').code,'MODEL_TIMEOUT')
  assert.equal(providerError('401 invalid token').code,'MODEL_CONFIGURATION_ERROR')
  assert.equal(providerError('400 schema uniqueItems unsupported secret=never-export').code,'MODEL_SCHEMA_UNSUPPORTED')
  assert.equal(providerError('400 schema uniqueItems unsupported secret=never-export').message,'MODEL_SCHEMA_UNSUPPORTED')
  assert.equal(providerError('unexpected secret text').message,'MODEL_REQUEST_FAILED')
  assert.equal(classifyProviderFailure('1305 访问量过大'),'OVERLOADED')
  assert.equal(classifyProviderFailure('400 content_filter rejected'),'CONTENT_FILTER')
  assert.equal(classifyProviderFailure('Provider finish_reason aborted'),'PROVIDER_STOP_REASON')
})
