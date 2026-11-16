# AgentCore-Light DSH Status Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A DeepSeek Harness bundle that drives the AgentCore-Light lamp from DSH's real turn lifecycle — BUSY, WAIT_CONFIRM, SUCCESS, ERROR, IDLE — for root agents only.

**Architecture:** A Host-only bundle with zero dependencies and no build step. `bridge.js` is a pure state machine mapping Cordis agent/session events to one device state. `transport.js` delivers that state to `127.0.0.1:18792` with dedupe, single-flight coalescing, and a hard timeout. `index.js` wires the two to Cordis events. Tests run on `node --test`.

**Tech Stack:** Node ≥ 24 ESM, `node:test`, `node:assert/strict`, `node:http`. No runtime dependencies.

**Spec:** `docs/DETAIL.md` — the approved design (behavior, mapping table, limitations). Task 1 creates it from the approved design text.

**Execution workdir:** build and test in `/Users/rain/lab/deepseek-harness/.agentcore-work/` (inside the session workspace, so file writes need no approval). Task 5 copies the finished tree to its permanent home `/Users/rain/Documents/deepseek-harness/default-workspace/dsh-agentcore-light/` and installs it from there, because `install_bundle` links the directory: the permanent path must be the final one.

## Global Constraints

- Device states are exactly `IDLE`, `BUSY`, `WAIT_CONFIRM`, `SUCCESS`, `ERROR`. Never send `THINKING` — the v2 app/firmware collapses it to `BUSY`.
- Endpoint: `POST http://127.0.0.1:18792/status`, body `{"state": "<STATE>", "source": "deepseek_harness"}`. Never 18793: it rewrites `source` to `control_panel`.
- Transport hard timeout 800 ms, no retries, never throws, never rejects, never awaits inside a listener.
- Only root agents drive activity: an agent whose `session.header.origin === 'subagent'` is excluded.
- Zero runtime dependencies, plain `.js` ESM, no TypeScript, no build step.
- Package name `dsh-agentcore-light`; plugin row id `agentcore-light-status`; source label `deepseek_harness`.
- English UI copy is sentence case: `meta.title` is "AgentCore Light status".

## Review Focus

1. **A subagent's approval request** — the light must show WAIT_CONFIRM although the child session drives nothing else.
2. **Two concurrent root sessions** — approval outranks running, running outranks settled; a settled SUCCESS must not mask a running session.
3. **AgentCore-Light not running (connection refused)** — no unhandled rejection, no stalled turn, and the next turn still drives the lamp once it is reachable.
4. **A turn that ends `blocked` or `aborted`** (rejected pre-step, user pressed stop) — the lamp goes IDLE, not SUCCESS or ERROR.
5. **`approval/asked` with no matching `approval/decided`** (crash, cancel) — a pending approval must not stick across the turn that ends it.

---

### Task 1: Package skeleton, spec document, and pure predicates

**Files:**
- Create: `package.json`, `git` repo, `docs/DETAIL.md`
- Create: `bridge.js`
- Test: `test/bridge-predicates.test.js`

**Interfaces:**
- Produces: `STATE` (frozen object `IDLE|BUSY|WAIT_CONFIRM|SUCCESS|ERROR`), `isRootAgent(agent): boolean`, `turnEndState(reason): 'SUCCESS'|'ERROR'|'IDLE'|undefined` from `./bridge.js`.

- [ ] **Step 1: Initialize the package directory and its git repo**

```sh
mkdir -p .agentcore-work/test .agentcore-work/docs .agentcore-work/locale
cd .agentcore-work && git init
```

- [ ] **Step 2: Write `package.json` with the test script**

```json
{
  "name": "dsh-agentcore-light",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Drives an AgentCore-Light lamp from DeepSeek Harness turn state.",
  "exports": {
    ".": "./index.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "bridge.js", "transport.js", "cordis.patch.yml", "locale/*.json", "docs", "icon.svg"],
  "scripts": { "test": "node --test test/" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

- [ ] **Step 3: Write the failing predicate test**

```js
// test/bridge-predicates.test.js
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
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd .agentcore-work && node --test test/`
Expected: FAIL — `Cannot find module '../bridge.js'`.

- [ ] **Step 5: Implement the predicates in `bridge.js`**

```js
export const STATE = Object.freeze({
  IDLE: 'IDLE', BUSY: 'BUSY', WAIT_CONFIRM: 'WAIT_CONFIRM', SUCCESS: 'SUCCESS', ERROR: 'ERROR',
})

export function isRootAgent(agent) {
  return agent?.session?.header?.origin !== 'subagent'
}

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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd .agentcore-work && node --test test/`
Expected: PASS, 2 tests.

- [ ] **Step 7: Write `docs/DETAIL.md`**

Copy the approved design from the conversation: intent, the state-mapping table, subagent exclusion, transport and endpoint choice (18792, with the reason), failure behavior, install/verify flow, non-goals (no token percentage, no brightness/buzzer, no USB protocol, no Web UI), and the limitation that AgentCore-Light's own bundled `deepseek_harness` hook must not be installed at the same time.

- [ ] **Step 8: Commit**

```sh
git add -A && git commit -m "feat: package skeleton and event predicates"
```

---

### Task 2: Bridge aggregation

**Files:**
- Modify: `bridge.js`
- Test: `test/bridge.test.js`

**Interfaces:**
- Consumes: `STATE`, `isRootAgent`, `turnEndState` from Task 1.
- Produces: `createBridge(send: (state: string) => void)` returning `{ onAgentCreated({agent}), onAgentDisposed({agent}), onSessionEvent(session, event), desired(): string|undefined }`.

- [ ] **Step 1: Write the failing aggregation test**

Cover all five Review Focus items:

```js
// test/bridge.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createBridge } from '../bridge.js'

const root = (id) => ({ session: { id, header: {} } })
const child = (id) => ({ session: { id, header: { origin: 'subagent' } } })
const sink = () => { const sent = []; return { sent, send: (s) => sent.push(s) } }

test('root turn start shows BUSY and completion shows SUCCESS', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: root('s1') })
  bridge.onSessionEvent(root('s1').session, { type: 'turn/start', data: { turn: 1 } })
  bridge.onSessionEvent(root('s1').session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  assert.deepEqual(sent, ['BUSY', 'SUCCESS'])
})

test('subagent activity drives nothing but its approval does', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: root('s1') })
  bridge.onAgentCreated({ agent: child('c1') })
  bridge.onSessionEvent(child('c1').session, { type: 'turn/start', data: { turn: 1 } })
  assert.deepEqual(sent, [])
  bridge.onSessionEvent(child('c1').session, { type: 'approval/asked', data: { id: 'a1' } })
  assert.deepEqual(sent, ['WAIT_CONFIRM'])
})

test('approval outranks running and running outranks settled', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: root('s1') }); bridge.onAgentCreated({ agent: root('s2') })
  bridge.onSessionEvent(root('s1').session, { type: 'turn/start', data: { turn: 1 } })
  bridge.onSessionEvent(root('s2').session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  assert.deepEqual(sent, ['BUSY', 'SUCCESS', 'BUSY'])
  bridge.onSessionEvent(root('s2').session, { type: 'approval/asked', data: { id: 'a2' } })
  assert.equal(sent.at(-1), 'WAIT_CONFIRM')
})

test('an undecided approval does not survive its turn ending', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: root('s1') })
  bridge.onSessionEvent(root('s1').session, { type: 'turn/start', data: { turn: 1 } })
  bridge.onSessionEvent(root('s1').session, { type: 'approval/asked', data: { id: 'a1' } })
  bridge.onSessionEvent(root('s1').session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } })
  assert.equal(bridge.desired(), 'IDLE')
})

test('disposed agents are forgotten', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  const agent = root('s1')
  bridge.onAgentCreated({ agent })
  bridge.onSessionEvent(agent.session, { type: 'turn/start', data: { turn: 1 } })
  bridge.onAgentDisposed({ agent })
  bridge.onSessionEvent(agent.session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  assert.deepEqual(sent, ['BUSY'])
})

test('unknown event types are ignored', () => {
  const { sent, send } = sink(); const bridge = createBridge(send)
  bridge.onAgentCreated({ agent: root('s1') })
  bridge.onSessionEvent(root('s1').session, { type: 'tool/call', data: {} })
  bridge.onSessionEvent(root('s1').session, { type: 'step/start', data: { turn: 1, step: 1 } })
  assert.deepEqual(sent, [])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd .agentcore-work && node --test test/bridge.test.js`
Expected: FAIL — `createBridge is not a function`.

- [ ] **Step 3: Implement `createBridge(send)` in `bridge.js`**

Hold three pieces of state: `sessions` (`Map<sessionId, { running: boolean }>`) for root agents only, `approvals` (`Map<sessionId, Set<approvalId>>`) for every session including subagents, and `settled` (last settled `STATE`).

- `onAgentCreated`: register the session when `isRootAgent(agent)`.
- `onAgentDisposed`: delete the session from both maps.
- `onSessionEvent(session, event)`:
  - `turn/start` → mark the session running and clear its approvals.
  - `approval/asked` → add `event.data.id` to the session's approval set (regardless of root/subagent).
  - `approval/decided` → delete `event.data.id` from the session's set.
  - `turn/end` → stop the session, clear its approvals, set `settled` to `turnEndState(event.data.reason)` when defined; then publish.
  - anything else → ignore.
- `desired()`: `WAIT_CONFIRM` if any approval set is non-empty; else `BUSY` if any session is running; else `settled`.
- Publish after each handled event: `const state = desired(); if (state !== undefined) send(state)`.
- Only events for a registered session are processed, except `approval/asked` / `approval/decided`, which also apply to subagent sessions.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd .agentcore-work && node --test test/`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```sh
git add -A && git commit -m "feat: aggregate root agents, approvals, and settle states"
```

---

### Task 3: Transport

**Files:**
- Create: `transport.js`
- Test: `test/transport.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `AGENTCORE_PORT = 18792`, `SOURCE = 'deepseek_harness'`, `createHttpRequest({port?, timeoutMs?}): (state, done) => void`, `createTransport({request?, port?, timeoutMs?}): { send(state): void }` — `port`/`timeoutMs` only parameterize the default `createHttpRequest`.

- [ ] **Step 1: Write the failing transport test**

```js
// test/transport.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTransport, createHttpRequest, SOURCE } from '../transport.js'

const manual = () => {
  const calls = []; const done = []
  return { calls, done, request: (state, finish) => { calls.push(state); done.push(finish) } }
}

test('identical consecutive states are suppressed', () => {
  const m = manual(); const t = createTransport({ request: m.request })
  t.send('BUSY'); t.send('BUSY')
  assert.deepEqual(m.calls, ['BUSY'])
})

test('a state arriving mid-flight replaces the pending one', () => {
  const m = manual(); const t = createTransport({ request: m.request })
  t.send('BUSY'); t.send('WAIT_CONFIRM'); t.send('SUCCESS')
  assert.deepEqual(m.calls, ['BUSY'])
  m.done[0]()
  assert.deepEqual(m.calls, ['BUSY', 'SUCCESS'])
})

test('a throwing request never escapes send', () => {
  const t = createTransport({ request: () => { throw new Error('boom') } })
  assert.doesNotThrow(() => t.send('BUSY'))
})

test('a failing request keeps later states flowing', () => {
  const calls = []; let finishFirst
  const request = (state, finish) => { calls.push(state); finishFirst ??= finish; if (calls.length > 1) finish() }
  const t = createTransport({ request })
  t.send('BUSY'); finishFirst(); t.send('SUCCESS')
  assert.deepEqual(calls, ['BUSY', 'SUCCESS'])
})

test('the source label is deepseek_harness', () => {
  assert.equal(SOURCE, 'deepseek_harness')
})

test('a closed port finishes instead of throwing', async () => {
  const request = createHttpRequest({ port: 1, timeoutMs: 200 })
  const finished = await Promise.race([
    new Promise((resolve) => request('BUSY', () => resolve('done'))),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 1000)),
  ])
  assert.equal(finished, 'done')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd .agentcore-work && node --test test/transport.test.js`
Expected: FAIL — `Cannot find module '../transport.js'`.

- [ ] **Step 3: Implement `transport.js`**

- `createHttpRequest({ port = AGENTCORE_PORT, timeoutMs = 800 })` returns `(state, done)` that POSTs `{ state, source: SOURCE }` to `path: '/status'`, `hostname: '127.0.0.1'`. Settle `done` exactly once: on response (`res.resume()` then finish), on `timeout` (`req.destroy()` then finish), on `error`, and from a `try/catch` around the whole call. `done` is idempotent via a `settled` flag.
- `createTransport({ request = createHttpRequest() })` keeps `queued` (last accepted state), `inFlight`, `pending`. `send(state)`: ignore when `state === queued`; otherwise set `queued`, and if idle call `request(state, finish)` guarded by `try/catch` (a throw must finish immediately), else store as `pending`. `finish()` clears `inFlight` and, when `pending` is set, takes it and fires again.
- `send` never throws and never returns a promise.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd .agentcore-work && node --test test/`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```sh
git add -A && git commit -m "feat: single-flight HTTP transport with dedupe"
```

---

### Task 4: Plugin entry, patch row, and display metadata

**Files:**
- Create: `index.js`, `cordis.patch.yml`, `locale/en.json`, `locale/zh.json`, `icon.svg`
- Test: `test/index.test.js`

**Interfaces:**
- Consumes: `createBridge` (Task 2), `createTransport` (Task 3).
- Produces: `apply(ctx, config?)` and `name = 'agentcore-light-status'` from `index.js`; `config` accepts optional `port` and `timeoutMs`.

- [ ] **Step 1: Write the failing wiring test against a real HTTP server**

```js
// test/index.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { apply, name } from '../index.js'

test('apply drives a real endpoint from session events', async () => {
  const received = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => { received.push(JSON.parse(body)); res.end('{"ok":true}') })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const listeners = new Map()
  const ctx = { on: (event, fn) => { listeners.set(event, fn); return () => listeners.delete(event) } }
  try {
    apply(ctx, { port: server.address().port })
    assert.equal(name, 'agentcore-light-status')
    const agent = { session: { id: 's1', header: {} } }
    listeners.get('agent/created')({ agent })
    listeners.get('session/event')(agent.session, { type: 'turn/start', data: { turn: 1 } })
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.deepEqual(received, [{ state: 'BUSY', source: 'deepseek_harness' }])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd .agentcore-work && node --test test/index.test.js`
Expected: FAIL — `Cannot find module '../index.js'`.

- [ ] **Step 3: Implement `index.js`**

```js
import { createBridge } from './bridge.js'
import { createTransport } from './transport.js'

export const name = 'agentcore-light-status'

export function apply(ctx, config = {}) {
  const transport = createTransport(config.request === undefined ? { port: config.port, timeoutMs: config.timeoutMs } : { request: config.request })
  const bridge = createBridge(transport.send)
  ctx.on('agent/created', (payload) => bridge.onAgentCreated(payload))
  ctx.on('agent/disposed', (payload) => bridge.onAgentDisposed(payload))
  ctx.on('session/event', (session, event) => bridge.onSessionEvent(session, event))
}
```

Pass through `undefined` rather than `{}` defaults inside `createTransport` so absent config keeps the protocol constants; `config.request` exists only so tests can inject a transport.

- [ ] **Step 4: Run the whole suite to verify it passes**

Run: `cd .agentcore-work && node --test test/`
Expected: PASS, 15 tests.

- [ ] **Step 5: Write `cordis.patch.yml`**

```yaml
- insert:
    - id: agentcore-light-status
      name: dsh-agentcore-light
```

- [ ] **Step 6: Write `locale/en.json` and `locale/zh.json`**

`en.json`: `{ "meta": { "title": "AgentCore Light status", "description": "Mirrors DeepSeek Harness turn state on an AgentCore-Light lamp: busy while working, yellow while awaiting your approval, green on success, red on failure.", "detail": "docs/DETAIL.md" } }`
`zh.json`: the same fields in Chinese, `title` "AgentCore Light 状态灯".

- [ ] **Step 7: Draw `icon.svg`**

An original 8-dot LED ring: eight circles on a 48×48 canvas, seven dim grey (`#5b6270`) and one lit green (`#3fbf6f`), with no external references and no text. Keep it under 2 KiB.

- [ ] **Step 8: Commit**

```sh
git add -A && git commit -m "feat: plugin entry, patch row, and display metadata"
```

---

### Task 5: Publish, install, and verify end to end

**Files:**
- Create: `/Users/rain/Documents/deepseek-harness/default-workspace/dsh-agentcore-light/` (copy of the finished tree, minus any build residue)
- Modify: nothing in the DSH checkout

**Interfaces:**
- Consumes: the complete package from Tasks 1–4.
- Produces: an installed profile bundle named `dsh-agentcore-light`.

- [ ] **Step 1: Copy the finished tree to its permanent home**

Run: `cp -R .agentcore-work /Users/rain/Documents/deepseek-harness/default-workspace/dsh-agentcore-light` (one escalated command; verify the destination did not already exist first). This needs `danger-full-access` approval because the destination is outside the session workspace.

- [ ] **Step 2: Prove the tests pass in the permanent location**

Run: `cd /Users/rain/Documents/deepseek-harness/default-workspace/dsh-agentcore-light && npm test`
Expected: PASS, 15 tests.

- [ ] **Step 3: Install the bundle**

`plugin_manager` `action: install_bundle`, `target: /Users/rain/Documents/deepseek-harness/default-workspace/dsh-agentcore-light`.
Expected: `application: applied` (HMR activation) and a plugin row with title "AgentCore Light status". A `pendingBuilds` list must be reported to the user, never approved unilaterally.

- [ ] **Step 4: Verify the registration**

`cordis_inspect_query` for the mounted `agentcore-light-status` row: confirm it is enabled and its `packageDir` is the permanent path.

- [ ] **Step 5: Verify the light**

With AgentCore-Light running, have the user watch the lamp while a DSH turn runs: BUSY during work, WAIT_CONFIRM when a tool authorization prompt appears, SUCCESS at turn end. Record their confirmation verbatim; never claim a physical change unconfirmed.

- [ ] **Step 6: Verify failure isolation**

Quit AgentCore-Light, run one DSH turn, confirm it completes normally with no error output, then restart AgentCore-Light and confirm the next turn still drives the lamp.

- [ ] **Step 7: Clean up the work tree**

Remove `.agentcore-work/` from the DSH checkout (the permanent copy is the source of truth), then run `git status` in the checkout to confirm no residue. Report the removed path.

- [ ] **Step 8: Report**

State the installed path, the plugin row title, test results, what the user confirmed physically, and the limitation about AgentCore-Light's own bundled DeepSeek Harness hook (do not install both).
