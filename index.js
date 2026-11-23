/**
 * Cordis plugin entry: report DeepSeek Harness turn state to an AgentCore-Light
 * lamp through the AgentCore-Light desktop app.
 * @module dsh-agentcore-light
 */

import { createBridge, STATE } from './bridge.js'
import { DEFAULT_INBOX_POLL_MS, createInboxWatch } from './inbox.js'
import { AGENTCORE_PORT, REQUEST_TIMEOUT_MS, SOURCE, createTransport } from './transport.js'

/** Plugin row name registered by `cordis.patch.yml`. */
export const name = 'agentcore-light-status'

/**
 * Validate the row configuration, failing activation on a value the transport
 * cannot use. A bad port would otherwise be swallowed by the request guard and
 * leave the lamp dead with no diagnostic.
 * @param config - the row's raw configuration.
 * @returns the validated port and timeout.
 */
function resolveOptions(config) {
  const port = config.port ?? AGENTCORE_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`dsh-agentcore-light: "port" must be an integer from 1 to 65535, got ${JSON.stringify(config.port)}`)
  }
  const timeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`dsh-agentcore-light: "timeoutMs" must be a positive number, got ${JSON.stringify(config.timeoutMs)}`)
  }
  return { port, timeoutMs }
}

/**
 * Release a confirmation left on the device by an earlier run. The app ignores
 * `IDLE` while it shows `WAIT_CONFIRM`, so a restart would otherwise keep the
 * lamp yellow until the next turn starts.
 * @param port - the lamp app's HTTP port.
 * @param timeoutMs - per-request timeout.
 * @returns nothing; every failure leaves the lamp untouched.
 */
async function releaseStaleWait(port, timeoutMs) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return
    const body = await response.json()
    if (body.desired_state !== STATE.WAIT_CONFIRM) return
    await fetch(`http://127.0.0.1:${port}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: STATE.SUCCESS, source: SOURCE }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    // The app may be closed, updating, or slow; the next turn reports again.
    void error
  }
}

/**
 * Validate the optional kanban inbox watch. An unset URL disables it.
 * @param config - the row's raw configuration.
 * @returns the inbox URL and poll interval, or undefined when disabled.
 */
function resolveInbox(config) {
  const url = config.kanbanInboxUrl
  if (url === undefined) return undefined
  if (typeof url !== 'string' || !/^https?:\/\//.test(url.trim())) {
    throw new Error(`dsh-agentcore-light: "kanbanInboxUrl" must be an http(s) URL, got ${JSON.stringify(url)}`)
  }
  const intervalMs = config.kanbanPollMs ?? DEFAULT_INBOX_POLL_MS
  if (!Number.isFinite(intervalMs) || intervalMs < 500) {
    throw new Error(`dsh-agentcore-light: "kanbanPollMs" must be a number of at least 500, got ${JSON.stringify(config.kanbanPollMs)}`)
  }
  return { url: url.trim(), intervalMs }
}

/**
 * Subscribe to the lifecycle events the lamp reflects, then reset the lamp to
 * `IDLE` so a state left over from a previous run cannot outlive it.
 *
 * Listeners are synchronous and delivery is fire-and-forget, so the lamp can
 * never delay or fail a turn.
 * @param ctx - profile context supplying the agent and session events.
 * @param config - optional `port`, `timeoutMs`, `kanbanInboxUrl`, and `kanbanPollMs`, validated at activation.
 */
export function apply(ctx, config = {}) {
  const { port, timeoutMs } = resolveOptions(config)
  const transport = createTransport({ port, timeoutMs })
  const bridge = createBridge(transport.send)
  const inbox = resolveInbox(config)
  ctx.on('agent/created', (payload) => bridge.onAgentCreated(payload))
  ctx.on('agent/disposed', (payload) => bridge.onAgentDisposed(payload))
  ctx.on('session/event', (session, event) => bridge.onSessionEvent(session, event))
  if (inbox !== undefined) {
    const watch = createInboxWatch({ ...inbox, onCount: (count) => bridge.onInbox(count) })
    ctx.effect(() => {
      watch.start()
      return () => watch.stop()
    }, 'agentcore-light: kanban inbox')
  }
  transport.send(STATE.IDLE)
  void releaseStaleWait(port, timeoutMs)
}
