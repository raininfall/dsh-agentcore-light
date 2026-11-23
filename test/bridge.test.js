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

test('an agent attached while running reads as BUSY', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: { ...root('s1'), status: 'running' } })
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

const asked = (callId) => ({ type: 'tool/call', data: { turn: 1, step: 1, callId, name: 'ask_user_question', arguments: '{}' } })
const result = (callId, text) => ({
  type: 'tool/result',
  data: { turn: 1, step: 1, message: { toolCallId: callId, isError: false, content: [{ type: 'text', text }] } },
})
const replied = (callId) => ({ type: 'user/message', data: { source: { kind: 'user-question-reply', callId } } })

test('an open question waits for the person and clears on the reply', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: root('s1') })
  bridge.onSessionEvent(root('s1').session, asked('q1'))
  assert.equal(bridge.desired(), 'WAIT_CONFIRM')
  bridge.onSessionEvent(root('s1').session, replied('q1'))
  assert.equal(bridge.desired(), undefined)
  // The lamp ignores IDLE while it shows a confirmation, so the release is SUCCESS.
  assert.equal(sent.at(-1), 'SUCCESS')
})

test('a pending timed result keeps the question open until it is answered', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: root('s1') })
  bridge.onSessionEvent(root('s1').session, started())
  bridge.onSessionEvent(root('s1').session, asked('q1'))
  bridge.onSessionEvent(root('s1').session, result('q1', '{"pending":true,"callId":"q1"}'))
  assert.equal(bridge.desired(), 'WAIT_CONFIRM')
  bridge.onSessionEvent(root('s1').session, replied('q1'))
  assert.equal(bridge.desired(), 'BUSY')
  assert.deepEqual(sent, ['BUSY', 'WAIT_CONFIRM', 'BUSY'])
})

test('a finished question result clears the wait without a reply event', () => {
  const { send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: root('s1') })
  bridge.onSessionEvent(root('s1').session, asked('q1'))
  bridge.onSessionEvent(root('s1').session, result('q1', '{"answers":[]}'))
  assert.equal(bridge.desired(), undefined)
})

test('an answered question survives its turn ending only while unanswered', () => {
  const { send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: root('s1') })
  bridge.onSessionEvent(root('s1').session, started())
  bridge.onSessionEvent(root('s1').session, asked('q1'))
  bridge.onSessionEvent(root('s1').session, ended({ kind: 'completed' }))
  assert.equal(bridge.desired(), 'WAIT_CONFIRM')
  bridge.onSessionEvent(root('s1').session, replied('q1'))
  assert.equal(bridge.desired(), 'SUCCESS')
})

test('the kanban inbox holds the lamp and releases it when it empties', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  bridge.onInbox(2)
  assert.equal(bridge.desired(), 'WAIT_CONFIRM')
  bridge.onInbox(0)
  assert.equal(bridge.desired(), undefined)
  // The lamp ignores IDLE while it shows a confirmation, so the release is SUCCESS.
  assert.deepEqual(sent, ['WAIT_CONFIRM', 'SUCCESS'])
})

test('the kanban inbox does not mask the turn that is still running', () => {
  const { send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: root('s1') })
  bridge.onSessionEvent(root('s1').session, started())
  bridge.onInbox(1)
  assert.equal(bridge.desired(), 'WAIT_CONFIRM')
  bridge.onInbox(0)
  assert.equal(bridge.desired(), 'BUSY')
})
