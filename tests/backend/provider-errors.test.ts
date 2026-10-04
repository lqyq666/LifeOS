import test from 'node:test'
import assert from 'node:assert/strict'
import { providerError } from '../../server/provider-errors.ts'

test('provider failures become bounded, public error codes without provider text',()=>{
  assert.equal(providerError('429 {"code":"1302","message":"secret"}').code,'MODEL_RATE_LIMITED')
  assert.equal(providerError('429 {"code":"1305"}').code,'MODEL_OVERLOADED')
  assert.equal(providerError('Request timed out.').code,'MODEL_TIMEOUT')
  assert.equal(providerError('401 invalid token').code,'MODEL_CONFIGURATION_ERROR')
  assert.equal(providerError('unexpected secret text').message,'MODEL_REQUEST_FAILED')
})
