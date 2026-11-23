/**
 * Poll a kanban board's inbox endpoint and report how many items wait on a
 * person. The board's own notifier shells out to the lamp app, whose explicit
 * `WAIT_CONFIRM` holds the lamp against every later state; folding the count
 * into this plugin keeps one writer for the device instead.
 * @module dsh-agentcore-light/inbox
 */

/** Default poll interval for the kanban inbox, in milliseconds. */
export const DEFAULT_INBOX_POLL_MS = 5000

/** Per-request timeout for one inbox poll, in milliseconds. */
export const INBOX_TIMEOUT_MS = 3000

/**
 * Count the inbox items that need a person: open questions and reviews
 * awaiting a decision. Takeovers and stale sessions are board bookkeeping and
 * do not need an answer.
 * @param payload - the decoded `/api/inbox` response.
 * @returns the number of items waiting on a person.
 */
export function pendingCount(payload) {
  const questions = Array.isArray(payload?.questions) ? payload.questions.length : 0
  const reviews = Array.isArray(payload?.reviews) ? payload.reviews.length : 0
  return questions + reviews
}

/**
 * Poll an inbox endpoint until stopped. Transport, status, and parse failures
 * keep the last reported count, because a board that is down or restarting
 * does not mean its open items were answered.
 * @param options - `url`, `onCount`, optional `intervalMs` and `fetchImpl`.
 * @returns `start` and `stop`; `start` is idempotent.
 */
export function createInboxWatch({ url, onCount, intervalMs = DEFAULT_INBOX_POLL_MS, fetchImpl = fetch }) {
  let timer
  let stopped = false

  async function poll() {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(INBOX_TIMEOUT_MS) })
      if (!response.ok) return
      const payload = await response.json()
      if (!stopped) onCount(pendingCount(payload))
    } catch (error) {
      // An unreachable board keeps the last count: silence is not "answered".
      void error
    }
  }

  return {
    start() {
      if (timer !== undefined) return
      stopped = false
      void poll()
      timer = setInterval(() => { void poll() }, intervalMs)
      timer.unref?.()
    },
    stop() {
      stopped = true
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    },
  }
}
