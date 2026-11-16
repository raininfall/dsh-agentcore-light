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
