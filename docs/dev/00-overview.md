# Developer overview

`@ekai/a2a` is an OpenClaw plugin that exposes one configured host agent as an A2A protocol server. It adds a public discovery route and an authenticated JSON-RPC route, then maps each A2A `SendMessage` request to a fresh OpenClaw subagent run.

The package implements the **A2A protocol** from a2a-protocol.org. OpenClaw's `.a2a` filename suffix, such as `sessions-send-tool.a2a.ts`, refers to OpenClaw's internal in-process inter-agent feature and is unrelated.

## Status

PoC v1, server only:

- One configured target agent per plugin instance.
- Public `GET /.well-known/agent-card.json`.
- Gateway-authenticated `POST /a2a` by default.
- Blocking `SendMessage`.
- `GetTask`.
- In-memory FIFO-bounded task store.
- No streaming, push notifications, cancellation, persistent task store, multi-turn continuity, or `contextId` resume.

## Architecture

v1 exposes A2A as an HTTP server boundary, not as an OpenClaw channel. The public contract is A2A discovery plus JSON-RPC over HTTP; OpenClaw channels remain internal runtime plumbing.

Each `SendMessage` request spawns a fresh OpenClaw subagent run. The subagent is the execution backend for the configured host agent; it is not a long-lived A2A conversation. If the request includes `contextId`, v1 echoes it on the returned task but does not use it to resume channels, sessions, or prior subagent state.

Future versions may map A2A `contextId` to an OpenClaw session or channel after streaming, cancellation, persistence, and multi-turn continuity are explicitly designed.

## Plugin lifecycle

On gateway startup, the plugin:

1. Reads `plugins.entries.a2a.*` config.
2. Resolves the target OpenClaw agent by explicit `agent` config, or auto-detects it when exactly one agent is registered.
3. Builds the agent card.
4. Registers:
   - `POST <cfg.path>` with `auth: "gateway"` and `replaceExisting: true`.
   - `GET /.well-known/agent-card.json` with `auth: "plugin"` and `replaceExisting: false`.
5. Emits startup log lines confirming the JSON-RPC route, discovery route, and selected agent.

If `enabled: false`, the plugin registers no routes and logs `[a2a] disabled`.

Configuration errors or missing agent selection do not prevent the gateway from starting. The plugin logs the reason and installs no routes.

## A2A to OpenClaw mapping

| A2A field | OpenClaw field | Mapping |
| --- | --- | --- |
| `message.parts[].text` | `run.message` | Text parts are concatenated in order. |
| `cfg.agent` | `run.sessionKey` | Embedded in `agent:<agentId>:a2a-<taskId>`. |
| - | `run.deliver` | Always `false`. |
| `cfg.subagentTimeoutMs` | `waitForRun.timeoutMs` | Direct pass-through. |
| `message.contextId` | task `contextId` | Stored only on the A2A task. |

After each run, the plugin best-effort deletes the per-task subagent session. Cleanup failure is logged at `warn` and does not change the response.

## References

- A2A latest spec: https://a2a-protocol.org/latest/specification/
- A2A discovery: https://a2a-protocol.org/latest/topics/agent-discovery/
- A2A task lifecycle: https://a2a-protocol.org/latest/topics/life-of-a-task/
- JSON-RPC 2.0: https://www.jsonrpc.org/specification
- RFC 8615 and RFC 2119
