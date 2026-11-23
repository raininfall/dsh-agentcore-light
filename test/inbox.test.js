import test from 'node:test'
import assert from 'node:assert/strict'
import { createInboxWatch, pendingCount } from '../inbox.js'

const until = async (predicate, budgetMs = 2000) => {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return predicate()
}

test('only open questions and reviews count as waiting on a person', () => {
  assert.equal(pendingCount({ questions: [{}, {}], reviews: [{}], takeovers: [{}], stale_sessions: [{}] }), 3)
  assert.equal(pendingCount({ questions: [], reviews: [] }), 0)
  assert.equal(pendingCount({}), 0)
  assert.equal(pendingCount(undefined), 0)
})

test('polling reports the inbox count and stops on request', async () => {
  const counts = []
  const payloads = [{ questions: [{}], reviews: [] }, { questions: [{}], reviews: [{}] }]
  let calls = 0
  const fetchImpl = async () => ({ ok: true, json: async () => payloads[Math.min(calls++, payloads.length - 1)] })
  const watch = createInboxWatch({ url: 'http://board.test/api/inbox', intervalMs: 500, fetchImpl, onCount: (count) => counts.push(count) })
  watch.start()
  await until(() => counts.length === 2)
  watch.stop()
  assert.deepEqual(counts, [1, 2])
})

test('an unreachable board keeps the last count instead of reporting zero', async () => {
  const counts = []
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    if (calls === 1) return { ok: true, json: async () => ({ questions: [{}] }) }
    throw new Error('connect ECONNREFUSED')
  }
  const watch = createInboxWatch({ url: 'http://board.test/api/inbox', intervalMs: 500, fetchImpl, onCount: (count) => counts.push(count) })
  watch.start()
  await until(() => counts.length === 1)
  await new Promise((resolve) => setTimeout(resolve, 30))
  watch.stop()
  assert.deepEqual(counts, [1])
})

test('a non-200 response reports nothing', async () => {
  const counts = []
  const fetchImpl = async () => ({ ok: false, status: 503 })
  const watch = createInboxWatch({ url: 'http://board.test/api/inbox', intervalMs: 500, fetchImpl, onCount: (count) => counts.push(count) })
  watch.start()
  await new Promise((resolve) => setTimeout(resolve, 50))
  watch.stop()
  assert.deepEqual(counts, [])
})
