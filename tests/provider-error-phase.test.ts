import test from 'node:test'
import assert from 'node:assert/strict'
import {providerError} from '../server/provider-errors.ts'

test('a schema-labelled error after generated text is not static schema rejection',()=>{
 const message='400 schema generation failed; synthetic-private-payload'
 assert.equal(providerError(message).code,'MODEL_SCHEMA_UNSUPPORTED')
 assert.equal(providerError(message,true).code,'MODEL_REQUEST_FAILED')
 assert.equal(providerError(message,true).message,'MODEL_REQUEST_FAILED')
 assert.equal(providerError('429 rate limit',true).code,'MODEL_RATE_LIMITED')
 assert.equal(providerError('Request timed out',true).code,'MODEL_TIMEOUT')
})
