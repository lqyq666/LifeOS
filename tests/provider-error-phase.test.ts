import test from 'node:test'
import assert from 'node:assert/strict'
import {providerError} from '../server/provider-errors.ts'
import {readFileSync} from 'node:fs'

test('a schema-labelled error after generated text is not static schema rejection',()=>{
 const message='400 schema generation failed; synthetic-private-payload'
 assert.equal(providerError(message).code,'MODEL_SCHEMA_UNSUPPORTED')
 assert.equal(providerError(message,true).code,'MODEL_REQUEST_FAILED')
 assert.equal(providerError(message,true).message,'MODEL_REQUEST_FAILED')
 assert.equal(providerError('429 rate limit',true).code,'MODEL_RATE_LIMITED')
 assert.equal(providerError('Request timed out',true).code,'MODEL_TIMEOUT')
})

test('saved provider generation abort is not static schema rejection even if no local delta arrived',()=>{
 const saved=JSON.parse(readFileSync(new URL('./fixtures/bailian-json-generation-abort.json',import.meta.url),'utf8'))
 for(const receivedText of [false,true]){
  const error=providerError(saved.errorMessage,receivedText)
  assert.equal(error.code,'MODEL_REQUEST_FAILED')
  assert.equal(error.message,'MODEL_REQUEST_FAILED')
  assert.equal(error.status,502)
 }
})
