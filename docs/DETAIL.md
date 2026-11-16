# AgentCore Light status

Reflects what a DeepSeek Harness agent is doing on an [AgentCore-Light](https://light.buildfpga.com/) desk lamp: yellow while it works, steady yellow while it waits for your approval, green when a turn succeeds, red when a turn fails, and idle otherwise.

The lamp connects through the AgentCore-Light desktop app, which must be running on the same machine. This plugin talks to it over `127.0.0.1:18792`.

## Behavior

| What DeepSeek Harness reports | Lamp |
| --- | --- |
| a root agent starts a turn | `BUSY` — working |
| a tool authorization prompt opens | `WAIT_CONFIRM` — waiting for you |
| the prompt is answered | `BUSY` |
| the turn completes | `SUCCESS` — the app returns to `IDLE` after 5 seconds |
| the turn ends in an error or hits the output-token limit | `ERROR` |
| the turn is stopped or blocked before any step | `IDLE` |

Subagent sessions never drive the lamp: their work already shows as the parent's `BUSY`. An approval request from a subagent still shows `WAIT_CONFIRM`, because you are the one who has to answer it.

With several root sessions at once, approval outranks running, and running outranks a finished turn.

## Requirements and limits

- The AgentCore-Light desktop app must be running and connected to the lamp. When it is not reachable, states are dropped silently: no error is shown and no turn is delayed or failed.
- The lamp has no separate "thinking" state. The firmware and app collapse `THINKING` into `BUSY`, so model generation and tool execution look the same.
- No token percentage, brightness, buzzer, or sound control. Those need protocol support the v2 app does not expose.
- Do not also install AgentCore-Light's own DeepSeek Harness hook from its control panel. Both write to the same lamp, so keep exactly one of them.

## Configuration

Optional row configuration:

- `port` — the AgentCore-Light control port, default `18792`.
- `timeoutMs` — per-request timeout, default `800`.

Prefer the default port. Port `18793` rewrites the reported source to `control_panel`, which hides these events from the app's AI activity log.

## Verify

1. Start AgentCore-Light and confirm it shows the lamp as connected.
2. Run a DeepSeek Harness turn: the lamp turns yellow while the agent works and green when the turn ends.
3. Open a tool authorization prompt: the lamp holds steady yellow until you answer.

## Uninstall

Remove the bundle from **Plugins** in DeepSeek Harness. Nothing else on disk changes.
