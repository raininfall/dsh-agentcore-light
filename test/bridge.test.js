import test from 'node:test'
import assert from 'node:assert/strict'
import { createBridge } from '../bridge.js'

const root = (id) => ({ session: { id, header: {} } })
const child = (id) => ({ session: { id, header: { origin: 'subagent' } } })
const sink = () => { const sent = []; return { sent, send: (state) => sent.push(state) } }
const started = (session) => ({ type: 'turn/start', data: { turn: 1 } })
const ended = (reason) => ({ type: 'turn/end', data: { turn: 1, reason } })

test('root turn start shows BUSY and completion shows SUCCESS', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: root('s1') })
  bridge.onSessionEvent(root('s1').session, started())
  bridge.onSessionEvent(root('s1').session, ended({ kind: 'completed' }))
  assert.deepEqual(sent, ['BUSY', 'SUCCESS'])
})

test('subagent activity drives nothing but its approval does', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  bridge.onSessionEvent(child('c1').session, started())
  assert.deepEqual(sent, [])
  bridge.onSessionEvent(child('c1').session, { type: 'approval/asked', data: { id: 'a1' } })
  assert.deepEqual(sent, ['WAIT_CONFIRM'])
})

test('a settled success does not mask a running session', () => {
  const { send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: root('s1') }); bridge.onAgentCreated({ agent: root('s2') })
  bridge.onSessionEvent(root('s1').session, started())
  bridge.onSessionEvent(root('s2').session, started())
  bridge.onSessionEvent(root('s2').session, ended({ kind: 'completed' }))
  assert.equal(bridge.desired(), 'BUSY')
  bridge.onSessionEvent(root('s1').session, ended({ kind: 'completed' }))
  assert.equal(bridge.desired(), 'SUCCESS')
})

test('approval outranks running and clears on decision', () => {
  const { send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: root('s1') }); bridge.onAgentCreated({ agent: root('s2') })
  bridge.onSessionEvent(root('s1').session, started())
  bridge.onSessionEvent(root('s2').session, { type: 'approval/asked', data: { id: 'a2' } })
  assert.equal(bridge.desired(), 'WAIT_CONFIRM')
  bridge.onSessionEvent(root('s2').session, { type: 'approval/decided', data: { id: 'a2', outcome: 'approved' } })
  assert.equal(bridge.desired(), 'BUSY')
})

test('an undecided approval does not survive its turn ending', () => {
  const { send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: root('s1') })
  bridge.onSessionEvent(root('s1').session, started())
  bridge.onSessionEvent(root('s1').session, { type: 'approval/asked', data: { id: 'a1' } })
  bridge.onSessionEvent(root('s1').session, ended({ kind: 'aborted', reason: { kind: 'user' } }))
  assert.equal(bridge.desired(), 'IDLE')
})

test('disposal resets the lamp instead of leaving a stale state', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  const agent = root('s1')
  bridge.onAgentCreated({ agent })
  bridge.onSessionEvent(agent.session, started())
  bridge.onAgentDisposed({ agent })
  assert.equal(bridge.desired(), undefined)
  assert.deepEqual(sent, ['BUSY', 'IDLE'])
})

test('a session that emits after disposal is treated as live again', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  const agent = root('s1')
  bridge.onAgentCreated({ agent })
  bridge.onSessionEvent(agent.session, started())
  bridge.onAgentDisposed({ agent })
  bridge.onSessionEvent(agent.session, ended({ kind: 'completed' }))
  assert.deepEqual(sent, ['BUSY', 'IDLE', 'SUCCESS'])
})

test('a root session first seen through events is tracked', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  bridge.onSessionEvent(root('late').session, started())
  assert.deepEqual(sent, ['BUSY'])
})

test('unknown event types are ignored', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: root('s1') })
  bridge.onSessionEvent(root('s1').session, { type: 'tool/call', data: {} })
  bridge.onSessionEvent(root('s1').session, { type: 'step/start', data: { turn: 1, step: 1 } })
  assert.deepEqual(sent, [])
})
