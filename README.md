# dsh-agentcore-light

Put your DeepSeek Harness (DSH) turns on an [AgentCore-Light](https://light.buildfpga.com/) desk lamp: yellow while an agent works, steady yellow while it waits for your approval, green when a turn succeeds, red when it fails.

A DSH profile bundle. Plain ESM JavaScript, no build step, no runtime dependencies. The lamp is reached through the AgentCore-Light desktop app on the same machine (`127.0.0.1:18792`).

## What the lamp shows

| DSH reports | Lamp |
| --- | --- |
| a root session starts a turn | `BUSY` — working |
| a tool authorization prompt opens | `WAIT_CONFIRM` — waiting for you |
| that prompt is answered | `BUSY` |
| the turn completes | `SUCCESS` — the app returns to `IDLE` after 5 seconds |
| the turn ends in an error or hits the output-token limit | `ERROR` |
| the turn is stopped or blocked before any step | `IDLE` |

Subagent sessions never drive the lamp — their work already shows as the parent's `BUSY`. An approval request from a subagent still shows `WAIT_CONFIRM`, because you are the one who has to answer it.

With several root sessions at once, approval outranks running, and running outranks a finished turn. The lamp is reset to `IDLE` when the plugin activates, so a state left over from a previous run cannot outlive it.

## Install

Requirements:

- DeepSeek Harness with a profile (tested on `0.2.2-rc.4`).
- The AgentCore-Light desktop app running, with the lamp connected.

```sh
dsh plugin --profile web add github:raininfall/dsh-agentcore-light
```

The command adds the dependency and appends the bundle to the profile's `dsh.profile.bundles`, because the package declares `dsh.bundle`. Restart DSH to activate it; the bundle then inserts the `agentcore-light-status` row.

Pin a commit if you want the install to be reproducible:

```sh
dsh plugin --profile web add github:raininfall/dsh-agentcore-light#<commit-sha>
```

The same install works from **Settings → Plugins → Add plugin** in the Web UI (or any DSH surface with a plugin manager), which also enables the bundle immediately.

For local development, install the checkout directly:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-agentcore-light
```

Check the composed configuration without booting:

```sh
dsh --profile web --dump-config | grep agentcore-light-status
```

## Configuration

Optional row configuration, in the profile's `cordis.patch.yml`:

```yaml
- id: agentcore-light-status
  name: dsh-agentcore-light
  config:
    port: 18792    # AgentCore-Light control port
    timeoutMs: 800 # per-request timeout
```

Keep the default port. Port `18793` rewrites the reported source to `control_panel`, which hides these events from the app's AI activity log. The source label shown for this plugin is `deepseek_harness`.

Invalid values fail activation with a diagnostic instead of leaving a silently dead lamp.

## How it works

- Subscribes to `agent/created`, `agent/disposed`, and `session/event` (`turn/start`, `approval/asked`, `approval/decided`, `turn/end`).
- Folds them into one device state: `IDLE`, `BUSY`, `WAIT_CONFIRM`, `SUCCESS`, or `ERROR`.
- Posts `{"state": ..., "source": "deepseek_harness"}` to `POST http://127.0.0.1:18792/status`.
- Delivery is best effort: one request in flight, the newest state queued behind it, duplicate states dropped, an 800 ms timeout. A missing app, closed port, or slow request never delays or fails a turn.

## Verify

1. Start AgentCore-Light and confirm it shows the lamp as connected.
2. Run a DSH turn: the lamp turns yellow while the agent works and green when the turn ends.
3. Open a tool authorization prompt: the lamp holds steady yellow until you answer.
4. Stop a turn: the lamp returns to idle.

## Requirements and limits

- The lamp has no separate "thinking" state. Model generation and tool execution both show as `BUSY`.
- No token percentage, brightness, buzzer, or sound control; those need protocol support the v2 app does not expose.
- Do not also install AgentCore-Light's own DeepSeek Harness hook from its control panel. Both write to the same lamp, so keep exactly one of them.

## Uninstall

```sh
dsh plugin --profile web remove dsh-agentcore-light
```

or remove the bundle from **Settings → Plugins**. Nothing else on disk changes.

## Layout

| File | Role |
| --- | --- |
| `index.js` | plugin entry; subscribes to Cordis events and resets the lamp on activation |
| `bridge.js` | pure state machine from agent/session events to one device state |
| `transport.js` | deduplicated, single-flight HTTP delivery to the desktop app |
| `cordis.patch.yml` | inserts the `agentcore-light-status` row |
| `locale/` | plugin card title and description (English, Chinese) |
| `docs/DETAIL.md` | full behavior specification |
| `test/` | `node --test` suites for the bridge, transport, and entry point |

Run the tests with `node --test`.
