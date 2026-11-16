/**
 * Cordis plugin entry: report DeepSeek Harness turn state to an AgentCore-Light
 * lamp through the AgentCore-Light desktop app.
 * @module dsh-agentcore-light
 */

import { createBridge } from './bridge.js'
import { createTransport } from './transport.js'

/** Plugin row name registered by `cordis.patch.yml`. */
export const name = 'agentcore-light-status'

/**
 * Subscribe to the lifecycle events the lamp reflects.
 *
 * Listeners are synchronous and delivery is fire-and-forget, so the lamp can
 * never delay or fail a turn.
 * @param ctx - profile context supplying the agent and session events.
 * @param config - optional `port` and `timeoutMs`; `request` exists only so tests can inject a sink.
 */
export function apply(ctx, config = {}) {
  const transport = config.request === undefined
    ? createTransport({ port: config.port, timeoutMs: config.timeoutMs })
    : createTransport({ request: config.request })
  const bridge = createBridge(transport.send)
  ctx.on('agent/created', (payload) => bridge.onAgentCreated(payload))
  ctx.on('agent/disposed', (payload) => bridge.onAgentDisposed(payload))
  ctx.on('session/event', (session, event) => bridge.onSessionEvent(session, event))
}
