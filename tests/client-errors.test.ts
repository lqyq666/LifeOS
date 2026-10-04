import test from 'node:test'
import assert from 'node:assert/strict'
import { api, ApiError, explainError, streamChat } from '../src/backend/client.ts'

test('HTML gateway failures become API errors; cooldown is shown without leaking upstream details',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('<html>gateway</html>',{status:502}))
  await assert.rejects(()=>api('/api/session'),e=>e instanceof ApiError&&e.status===502)
  assert.match(explainError(new ApiError('MODEL_RATE_LIMITED',429,60)),/60/)
})
test('memory read failure is explained without pretending saved background is empty',()=>{
  const notice=explainError(new ApiError('MEMORY_LOAD_FAILED',503))
  assert.equal(notice,'暂时无法安全读取已保存背景，本轮没有继续个性化规划。')
  assert.doesNotMatch(notice,/没有记忆|未保存信息/)
})
test('SSE rate-limit failure carries retry delay and cancels the reader',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('data: {"type":"error","code":"MODEL_OVERLOADED","retryAfter":30}\n\n',{headers:{'Content-Type':'text/event-stream'}}))
  await assert.rejects(()=>streamChat('chat','request','test',new AbortController().signal,()=>{}),e=>e instanceof ApiError&&e.retryAfter===30)
})
