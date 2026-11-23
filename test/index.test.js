import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { apply, name } from '../index.js'

const harness = () => {
  const listeners = new Map()
  const disposers = []
  const ctx = {
    on: (event, fn) => { listeners.set(event, fn); return () => listeners.delete(event) },
    effect: (fn) => { disposers.push(fn()) },
  }
  return { ctx, listeners, disposers }
}

const listening = async (received, port = 0) => {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => { received.push(JSON.parse(body)); res.end('{"ok":true}') })
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  return server
}

const close = (server) => new Promise((resolve) => server.close(resolve))

const until = async (predicate, budgetMs = 2000) => {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return predicate()
}

test('activation clears a stale lamp state before any turn', async () => {
  const received = []
  const server = await listening(received)
  const { ctx, listeners } = harness()
  try {
    apply(ctx, { port: server.address().port })
    assert.equal(name, 'agentcore-light-status')
    await until(() => received.length === 1)
    assert.deepEqual(received, [{ state: 'IDLE', source: 'deepseek_harness' }])
  } finally {
    await close(server)
  }
})

test('apply drives a real endpoint from session events', async () => {
  const received = []
  const server = await listening(received)
  const { ctx, listeners } = harness()
  try {
    apply(ctx, { port: server.address().port })
    const agent = { session: { id: 's1', header: {} } }
    listeners.get('agent/created')({ agent })
    listeners.get('session/event')(agent.session, { type: 'turn/start', data: { turn: 1 } })
    await until(() => received.some((item) => item.state === 'BUSY'))
    assert.deepEqual(received.map((item) => item.state), ['IDLE', 'BUSY'])
  } finally {
    await close(server)
  }
})

test('an unusable port fails loudly at activation', () => {
  const { ctx } = harness()
  assert.throws(() => apply(ctx, { port: 'abc' }), /port/)
  assert.throws(() => apply(ctx, { port: 70000 }), /port/)
  assert.throws(() => apply(ctx, { timeoutMs: 0 }), /timeoutMs/)
})

test('delivery recovers once the lamp app becomes reachable', async () => {
  const received = []
  const probe = await listening([])
  const port = probe.address().port
  await close(probe)

  const { ctx, listeners } = harness()
  apply(ctx, { port })
  const agent = { session: { id: 's1', header: {} } }
  listeners.get('agent/created')({ agent })
  listeners.get('session/event')(agent.session, { type: 'turn/start', data: { turn: 1 } })
  listeners.get('session/event')(agent.session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.deepEqual(received, [])

  const server = await listening(received, port)
  try {
    listeners.get('session/event')(agent.session, { type: 'turn/start', data: { turn: 2 } })
    await until(() => received.some((item) => item.state === 'BUSY'))
    assert.equal(received.at(-1).state, 'BUSY')
  } finally {
    await close(server)
  }
})

test('the kanban inbox drives the lamp through one writer', async () => {
  const received = []
  const lamp = await listening(received)
  const board = { payload: { questions: [{}], reviews: [] } }
  const inbox = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(board.payload))
  })
  await new Promise((resolve) => inbox.listen(0, '127.0.0.1', resolve))
  const { ctx, disposers } = harness()
  try {
    apply(ctx, {
      port: lamp.address().port,
      kanbanInboxUrl: `http://127.0.0.1:${inbox.address().port}/api/inbox`,
      kanbanPollMs: 500,
    })
    await until(() => received.some((item) => item.state === 'WAIT_CONFIRM'))
    board.payload = { questions: [], reviews: [] }
    await until(() => received.at(-1)?.state === 'SUCCESS')
    assert.equal(received.at(-1).state, 'SUCCESS')
  } finally {
    for (const dispose of disposers) dispose()
    await close(inbox)
    await close(lamp)
  }
})

test('an invalid kanban inbox setting fails loudly at activation', () => {
  const { ctx } = harness()
  assert.throws(() => apply(ctx, { kanbanInboxUrl: 'board.test' }), /kanbanInboxUrl/)
  assert.throws(() => apply(ctx, { kanbanInboxUrl: 'http://board.test/api/inbox', kanbanPollMs: 10 }), /kanbanPollMs/)
})
