import test from 'node:test'
import assert from 'node:assert/strict'
import { isRootAgent, turnEndState } from '../bridge.js'

test('subagent sessions are not root agents', () => {
  assert.equal(isRootAgent({ session: { header: { origin: 'subagent' } } }), false)
  assert.equal(isRootAgent({ session: { header: {} } }), true)
})

test('turn end reasons map to device states', () => {
  assert.equal(turnEndState({ kind: 'completed' }), 'SUCCESS')
  assert.equal(turnEndState({ kind: 'error', error: {} }), 'ERROR')
  assert.equal(turnEndState({ kind: 'max-tokens' }), 'ERROR')
  assert.equal(turnEndState({ kind: 'aborted', reason: { kind: 'user' } }), 'IDLE')
  assert.equal(turnEndState({ kind: 'blocked' }), 'IDLE')
  assert.equal(turnEndState({ kind: 'interrupted' }), undefined)
  assert.equal(turnEndState({ kind: 'forked' }), undefined)
  assert.equal(turnEndState(undefined), undefined)
})
