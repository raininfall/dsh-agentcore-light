/**
 * State machine behind the AgentCore-Light bridge: Cordis agent and session
 * events in, one AgentCore-Light device state out. Every function here is pure
 * or holds only in-memory bookkeeping, so it can be exercised without a device.
 * @module dsh-agentcore-light/bridge
 */

/** Device states the AgentCore-Light firmware accepts. */
export const STATE = Object.freeze({
  IDLE: 'IDLE',
  BUSY: 'BUSY',
  WAIT_CONFIRM: 'WAIT_CONFIRM',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
})

/**
 * Whether an agent drives the lamp. Subagent children only report activity
 * their parent already reports, so their turns would flash success mid-work.
 * @param agent - the agent from an `agent/created` or `agent/disposed` payload.
 * @returns true for top-level agents, false for subagent sessions.
 */
export function isRootAgent(agent) {
  return agent?.session?.header?.origin !== 'subagent'
}

/**
 * The device state a finished turn implies, or undefined when the reason says
 * nothing about work (crash repair and fork closers never happen live).
 * @param reason - the `turn/end` reason payload.
 * @returns a device state, or undefined to leave the lamp as it is.
 */
export function turnEndState(reason) {
  switch (reason?.kind) {
    case 'completed': return STATE.SUCCESS
    case 'error':
    case 'max-tokens': return STATE.ERROR
    case 'aborted':
    case 'blocked': return STATE.IDLE
    default: return undefined
  }
}

/**
 * Fold Cordis agent and session events into one device state.
 *
 * Root sessions report work; subagent sessions report nothing except their
 * approval requests, because a person answering a prompt is waiting no matter
 * which agent asked. Sessions are learned from `agent/created` and also from
 * their first event, so installing the plugin into a running session still
 * picks that session up.
 * @param send - sink for each device state worth sending.
 * @returns handlers for `agent/created`, `agent/disposed`, and `session/event`, plus `desired`.
 */
export function createBridge(send) {
  const sessions = new Map()
  const approvals = new Map()
  let settled

  function track(session) {
    const id = session?.id
    if (id === undefined) return undefined
    const known = sessions.get(id)
    if (known !== undefined) return known
    if (session.header?.origin === 'subagent') return undefined
    const created = { running: false }
    sessions.set(id, created)
    return created
  }

  function desired() {
    for (const pending of approvals.values()) if (pending.size > 0) return STATE.WAIT_CONFIRM
    for (const entry of sessions.values()) if (entry.running) return STATE.BUSY
    return settled
  }

  function publish() {
    const state = desired()
    if (state !== undefined) send(state)
  }

  return {
    desired,

    onAgentCreated({ agent }) {
      if (isRootAgent(agent)) sessions.set(agent.session.id, { running: false })
    },

    onAgentDisposed({ agent }) {
      sessions.delete(agent.session.id)
      approvals.delete(agent.session.id)
      // Nothing this session reported can still be true, so a lamp left on
      // WAIT_CONFIRM or BUSY is reset rather than kept.
      send(desired() ?? STATE.IDLE)
    },

    onSessionEvent(session, event) {
      const id = session?.id
      if (id === undefined) return
      const tracked = track(session)
      switch (event?.type) {
        case 'turn/start':
          if (tracked === undefined) return
          tracked.running = true
          approvals.delete(id)
          break
        case 'approval/asked': {
          const pending = approvals.get(id) ?? new Set()
          pending.add(event.data?.id)
          approvals.set(id, pending)
          break
        }
        case 'approval/decided': {
          const pending = approvals.get(id)
          if (pending === undefined) return
          pending.delete(event.data?.id)
          if (pending.size === 0) approvals.delete(id)
          break
        }
        case 'turn/end': {
          approvals.delete(id)
          if (tracked === undefined) break
          tracked.running = false
          const state = turnEndState(event.data?.reason)
          if (state !== undefined) settled = state
          break
        }
        default:
          return
      }
      publish()
    },
  }
}
