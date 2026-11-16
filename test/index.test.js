import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { apply, name } from '../index.js'

test('apply drives a real endpoint from session events', async () => {
  const received = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => { received.push(JSON.parse(body)); res.end('{"ok":true}') })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const listeners = new Map()
  const ctx = { on: (event, fn) => { listeners.set(event, fn); return () => listeners.delete(event) } }
  try {
    apply(ctx, { port: server.address().port })
    assert.equal(name, 'agentcore-light-status')
    const agent = { session: { id: 's1', header: {} } }
    listeners.get('agent/created')({ agent })
    listeners.get('session/event')(agent.session, { type: 'turn/start', data: { turn: 1 } })
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.deepEqual(received, [{ state: 'BUSY', source: 'deepseek_harness' }])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
