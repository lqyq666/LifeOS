import test from 'node:test'
import assert from 'node:assert/strict'
import { RequestScheduler } from '../../server/request-scheduler.ts'

const signal = () => new AbortController().signal

test('different accounts run concurrently; one account waits without blocking other accounts', async () => {
  const scheduler = new RequestScheduler(2, 8)
  const releaseA = await scheduler.acquire('a', signal())
  let secondAStarted = false, queued = 0
  const secondA = scheduler.acquire('a', signal(), () => queued++).then(release => { secondAStarted = true; return release })
  const releaseB = await scheduler.acquire('b', signal())
  assert.equal(secondAStarted, false)
  assert.equal(queued, 1)
  releaseB()
  await Promise.resolve()
  assert.equal(secondAStarted, false, 'another account freeing a slot cannot bypass same-account exclusion')
  releaseA()
  const releaseSecondA = await secondA
  assert.equal(secondAStarted, true)
  releaseSecondA()
})

test('cancelling queued work removes it and preserves the active capacity bound', async () => {
  const scheduler = new RequestScheduler(1, 2)
  const release = await scheduler.acquire('a', signal())
  const controller = new AbortController()
  const cancelled = scheduler.acquire('b', controller.signal)
  const rejection = assert.rejects(cancelled, error => error === 'cancelled')
  controller.abort('cancelled')
  await rejection
  let started = false
  const next = scheduler.acquire('c', signal()).then(releaseNext => { started = true; return releaseNext })
  await Promise.resolve()
  assert.equal(started, false)
  release()
  const releaseNext = await next
  releaseNext()
})

test('overload is bounded, releases are idempotent, and aborted requests never start', async () => {
  const scheduler = new RequestScheduler(1, 1)
  const releaseA = await scheduler.acquire('a', signal())
  const waitingB = scheduler.acquire('b', signal())
  await assert.rejects(scheduler.acquire('c', signal()), (error: any) => error.code === 'MODEL_QUEUE_FULL')
  releaseA()
  const releaseB = await waitingB
  releaseA()
  let startedC = false
  const waitingC = scheduler.acquire('c', signal()).then(release => { startedC = true; return release })
  await Promise.resolve()
  assert.equal(startedC, false, 'duplicate release cannot free an occupied slot')
  releaseB()
  ;(await waitingC)()
  const controller = new AbortController()
  controller.abort('cancelled')
  assert.throws(() => scheduler.acquire('d', controller.signal), error => error === 'cancelled')
})
