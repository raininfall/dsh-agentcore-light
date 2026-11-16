/**
 * Delivery of device states to the AgentCore-Light desktop app.
 *
 * Delivery is best effort: a missing app, a closed port, or a slow request
 * never surfaces to the caller, because a lamp must not delay or fail a turn.
 * @module dsh-agentcore-light/transport
 */

import http from 'node:http'

/** Control-center port that preserves the reported source. Port 18793 rewrites it to `control_panel`. */
export const AGENTCORE_PORT = 18792

/** Source label the AgentCore-Light activity log shows for these events. */
export const SOURCE = 'deepseek_harness'

/** Default per-request timeout in milliseconds. */
export const REQUEST_TIMEOUT_MS = 800

/**
 * Build a request function that posts one state to the AgentCore-Light app.
 * @param options - port and timeout overrides; defaults are the protocol constants.
 * @returns a function that starts one request and calls `done` exactly once.
 */
export function createHttpRequest({ port = AGENTCORE_PORT, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  return function request(state, done) {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      done()
    }
    try {
      const body = JSON.stringify({ state, source: SOURCE })
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/status',
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        res.resume()
        finish()
      })
      req.on('timeout', () => {
        req.destroy()
        finish()
      })
      req.on('error', finish)
      req.end(body)
    } catch {
      // AgentCore-Light may be absent or its port may be unusable; the lamp
      // simply misses this state.
      finish()
    }
  }
}

/**
 * Serialize state delivery: one request in flight, the newest state waiting
 * behind it, and repeated states dropped.
 * @param options - an injectable `request`, plus port and timeout for the default one.
 * @returns `{ send }`, where `send` never throws and never returns a promise.
 */
export function createTransport({ request, port, timeoutMs } = {}) {
  const sendRequest = request ?? createHttpRequest({ port, timeoutMs })
  let queued
  let inFlight = false
  let pending

  function fire(state) {
    inFlight = true
    const settle = () => {
      inFlight = false
      if (pending === undefined) return
      const next = pending
      pending = undefined
      fire(next)
    }
    try {
      sendRequest(state, settle)
    } catch {
      settle()
    }
  }

  return {
    send(state) {
      if (state === queued) return
      queued = state
      if (inFlight) {
        pending = state
        return
      }
      fire(state)
    },
  }
}
