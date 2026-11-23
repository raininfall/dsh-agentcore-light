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

/** Tool name of the interactive question tool; an open question waits on a person. */
export const ASK_USER_QUESTION_TOOL = 'ask_user_question'

/**
 * Whether a question tool result leaves the question open. The timed tool
 * returns `{ pending: true, callId }` when its wait window elapses, and the
 * person may still answer afterwards, so only a final answer or a failure
 * closes the wait.
 * @param message - the `tool/result` message.
 * @returns true while the result is the timed tool's pending payload.
 */
export function questionLeftOpen(message) {
  if (message?.isError === true) return false
  const content = Array.isArray(message?.content) ? message.content : []
  const text = content.find((block) => block?.type === 'text')
  if (text === undefined || typeof text.text !== 'string') return false
  try {
    const parsed = JSON.parse(text.text)
    return typeof parsed === 'object' && parsed !== null && parsed.pending === true
  } catch (error) {
    // A non-JSON result text is a failure message, never the pending payload.
    void error
    return false
  }
}

/**
 * Fold Cordis agent and session events into one device state.
 *
 * Root sessions report work; subagent sessions report nothing except their
 * approval and question requests, because a person answering either is waiting
 * no matter which agent asked. Sessions are learned from `agent/created` and
 * also from their first event, so installing the plugin into a running session
 * still picks that session up.
 *
 * A kanban inbox with open questions or reviews is folded in as an external
 * wait, so the board and the Harness compose into one lamp state instead of
 * two writers racing for the device.
 * @param send - sink for each device state worth sending.
 * @returns handlers for `agent/created`, `agent/disposed`, `session/event`, and `inbox`, plus `desired`.
 */
export function createBridge(send) {
  const sessions = new Map()
  const approvals = new Map()
  const questions = new Map()
  let settled
  let inbox = 0

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

  function waiting(map) {
    for (const pending of map.values()) if (pending.size > 0) return true
    return false
  }

  function desired() {
    if (waiting(approvals) || waiting(questions) || inbox > 0) return STATE.WAIT_CONFIRM
    for (const entry of sessions.values()) if (entry.running) return STATE.BUSY
    return settled
  }

  let lastPublished = null

  function publish() {
    // An external wait can clear while nothing else reports; the lamp must not
    // stay on WAIT_CONFIRM after the board item is gone. The lamp ignores IDLE
    // while it shows a confirmation, so a finished wait reports SUCCESS.
    const next = desired() ?? STATE.IDLE
    const state = next === STATE.IDLE && lastPublished === STATE.WAIT_CONFIRM ? STATE.SUCCESS : next
    lastPublished = state
    send(state)
  }

  return {
    desired,

    onAgentCreated({ agent }) {
      if (!isRootAgent(agent)) return
      // Seed from the live phase so a plugin reload or a late attach mid-turn
      // still reads as BUSY instead of a stale finished state.
      const running = agent.status === 'running'
      sessions.set(agent.session.id, { running })
      if (running) publish()
    },

    onAgentDisposed({ agent }) {
      sessions.delete(agent.session.id)
      approvals.delete(agent.session.id)
      questions.delete(agent.session.id)
      // Nothing this session reported can still be true, so a lamp left on
      // WAIT_CONFIRM or BUSY is reset rather than kept.
      publish()
    },

    /** Fold in the number of kanban inbox items waiting on a person. */
    onInbox(count) {
      const next = Number.isFinite(count) && count > 0 ? count : 0
      if (next === inbox) return
      inbox = next
      publish()
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
        case 'tool/call': {
          if (event.data?.name !== ASK_USER_QUESTION_TOOL) return
          const pending = questions.get(id) ?? new Set()
          pending.add(event.data.callId)
          questions.set(id, pending)
          break
        }
        case 'tool/result': {
          const message = event.data?.message
          const trackedQuestion = questions.get(id)?.has(message?.toolCallId) === true
          if (!trackedQuestion || questionLeftOpen(message)) return
          dropWait(questions, id, message.toolCallId)
          break
        }
        case 'user/message': {
          const source = event.data?.source
          if (source?.kind !== 'user-question-reply') return
          if (questions.get(id)?.has(source.callId) !== true) return
          dropWait(questions, id, source.callId)
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

/**
 * Drop one waiting id from a per-session set, removing the session entry when
 * nothing is left.
 * @param map - per-session pending sets.
 * @param sessionId - session whose set to edit.
 * @param waitId - the id to remove.
 */
function dropWait(map, sessionId, waitId) {
  const pending = map.get(sessionId)
  if (pending === undefined) return
  pending.delete(waitId)
  if (pending.size === 0) map.delete(sessionId)
}
