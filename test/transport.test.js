import test from 'node:test'
import assert from 'node:assert/strict'
import { createTransport, createHttpRequest, SOURCE } from '../transport.js'

const manual = () => {
  const calls = []; const done = []
  return { calls, done, request: (state, finish) => { calls.push(state); done.push(finish) } }
}

test('identical consecutive states are suppressed', () => {
  const m = manual(); const transport = createTransport({ request: m.request })
  transport.send('BUSY'); transport.send('BUSY')
  assert.deepEqual(m.calls, ['BUSY'])
})

test('a state arriving mid-flight replaces the pending one', () => {
  const m = manual(); const transport = createTransport({ request: m.request })
  transport.send('BUSY'); transport.send('WAIT_CONFIRM'); transport.send('SUCCESS')
  assert.deepEqual(m.calls, ['BUSY'])
  m.done[0]()
  assert.deepEqual(m.calls, ['BUSY', 'SUCCESS'])
})

test('a throwing request never escapes send', () => {
  const transport = createTransport({ request: () => { throw new Error('boom') } })
  assert.doesNotThrow(() => transport.send('BUSY'))
})

test('a finished request keeps later states flowing', () => {
  const calls = []; let finishFirst
  const request = (state, finish) => {
    calls.push(state)
    if (finishFirst === undefined) finishFirst = finish
    else finish()
  }
  const transport = createTransport({ request })
  transport.send('BUSY')
  finishFirst()
  transport.send('SUCCESS')
  assert.deepEqual(calls, ['BUSY', 'SUCCESS'])
})

test('the source label is deepseek_harness', () => {
  assert.equal(SOURCE, 'deepseek_harness')
})

test('a closed port finishes instead of throwing', async () => {
  const request = createHttpRequest({ port: 1, timeoutMs: 200 })
  const finished = await Promise.race([
    new Promise((resolve) => request('BUSY', () => resolve('done'))),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 1000)),
  ])
  assert.equal(finished, 'done')
})
