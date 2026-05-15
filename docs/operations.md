# Operations

For operators running `@ekai/a2a` in a real OpenClaw gateway. Covers security posture, the log lines you'll see, deployment notes inherited from the public plugin API, capacity, and a troubleshooting table.

For configuration fields referenced below, see [`configuration.md`](configuration.md). The authoritative protocol contract is [`specs/2026-05-14-server-poc.md`](specs/2026-05-14-server-poc.md).

## Security posture

Two routes, two auth modes:

| Route | Method | Auth | Why |
| --- | --- | --- | --- |
| `<path>` (default `/a2a`) | POST | `auth: "gateway"` | OpenClaw's gateway enforces the operator token before the handler runs. Spec §9 / index.ts:86. |
| `/.well-known/agent-card.json` | GET | `auth: "plugin"` | Public discovery per A2A spec — clients must be able to fetch the card to learn how to call. |

This means **A2A clients calling `SendMessage` must send `Authorization: Bearer <operator-token>`**. Without it, the request is rejected by the gateway and never reaches the plugin handler. The agent card advertises `securitySchemes.bearerAuth` by default so spec-compliant clients pick this up automatically.

Operators binding the gateway to non-loopback hosts **must** configure gateway auth. Don't run with an empty/missing operator token on a public interface.

## Startup log lines

Read these to confirm the plugin came up correctly. All are tagged `[a2a]`. Exact strings live in [`src/strings.ts`](../src/strings.ts).

**Success (routes installed):**

```
warn  [a2a] POST /a2a uses gateway authentication; agent card remains public.
info  [a2a] registered POST /a2a and GET /.well-known/agent-card.json; agent: <agent-name>
```

The `warn` is informational — it surfaces the chosen auth posture at a level that's hard to miss in scrolling logs. The `info` is your confirmation the routes are live.

**No routes installed (each is conclusive — no other startup line follows):**

| Log line | Cause | Fix |
| --- | --- | --- |
| `info  [a2a] disabled` | `enabled: false` in config. | Set `enabled: true`. |
| `warn  [a2a] No agents registered; not installing routes.` | The host config has no `agents.list` entries. | Configure at least one OpenClaw agent. |
| `warn  [a2a] Multiple agents registered. Set plugins.entries.a2a.agent to one of: [<list>]` | More than one agent registered, `agent` not set. | Add `agent: <id>` to the plugin config. |
| `warn  [a2a] Agent <name> not found. Available: [<list>]` | `agent: <name>` doesn't match any registered agent. | Set `agent` to one of the listed ids. |
| `error [a2a] invalid config: <reason>` | Zod rejected the plugin config (e.g. `path` missing leading `/`, `subagentTimeoutMs < 6000`). | Fix the field called out in `<reason>`. |

## Per-request log lines

Each request through `POST /a2a` emits 2–3 structured log lines via `api.logger`. Field payloads are JSON-encoded after a leading space; the helper is in [`src/logging.ts`](../src/logging.ts), the emission sites in [`src/handler.ts`](../src/handler.ts).

| Event | Level | When | Fields |
| --- | --- | --- | --- |
| `request_received` | `info` | First line of the handler — fires for every inbound request, including ones that fail before parse. | `caller_host` |
| `request_in` | `info` | After the JSON-RPC envelope parses successfully. Won't fire on malformed JSON, body-size overflow, non-POST, or client disconnect. | `method`, `caller_host` |
| `request_done` | `info` | Successful response (any `result.*` envelope). | `method`, `taskId`, `status`, `latency_ms` |
| `request_error` | `error` | Any error response. Replaces `request_done`; `request_received` (and `request_in`, if parse succeeded) still precedes it. | `method?`, `taskId?`, `error_class`, `error_message`, `jsonrpc_code` |

Format example:

```
info [a2a] request_received {"caller_host":"gw.example:8080"}
info [a2a] request_in {"method":"SendMessage","caller_host":"gw.example:8080"}
info [a2a] request_done {"method":"SendMessage","taskId":"...","status":"ok","latency_ms":1432}
```

`error_class` values you may see: `JsonRpcError`, `BodyTooLarge`, `BodyReadTimeout`, `BodyReadError`, `ClientDisconnect`, `HttpMethodNotAllowed`.

## Deployment notes

Because v1 talks to OpenClaw's public plugin runtime (`api.runtime.subagent.*`) rather than internal helpers, three behaviours are worth knowing:

1. **Agent binding is per-process, not per-request.** The plugin resolves a single agent at startup (`agent` config, or auto-detect when there's exactly one). All `SendMessage` calls route to that agent. To front a different agent, edit config and restart the gateway.
2. **Per-task session key.** Each `SendMessage` constructs `sessionKey = "agent:<agentId>:a2a-<taskId>"` so the runtime dispatches to the configured agent. This is an internal detail you'll see in subagent logs.
3. **Best-effort cleanup.** After a successful (or failed) run, the plugin calls `api.runtime.subagent.deleteSession({ sessionKey })`. If the call rejects, the plugin logs `[a2a] deleteSession_failed {…}` at `warn` and the original response is unaffected. Long-lived gateways won't accumulate per-task sessions in normal operation; if `deleteSession_failed` recurs, investigate the gateway subagent subsystem.

## Capacity

The task store is in-process and bounded by `maxTasks` (default `10000`). Eviction is FIFO by insertion order: when the (N+1)-th task is created, the oldest is dropped. Evicted task ids return `-32001 TaskNotFoundError` on subsequent `GetTask`.

Sizing rules of thumb:

- Pick `maxTasks` to cover your worst-case "retrieval-after-`SendMessage`" window. If clients retrieve immediately after success, the default comfortably covers low-QPS workloads.
- A restart drops all tasks. There is no persistence layer in v1.
- Memory grows roughly linearly with task count; each task holds a UUID, two short messages, one artifact, and a timestamp — kilobytes, not megabytes.

## Troubleshooting

| Symptom | Likely log signature | Fix |
| --- | --- | --- |
| Plugin not installed at all | No `[a2a]` lines on gateway startup. | Confirm `plugins.entries.a2a` exists and the package resolved (`npm ls @ekai/a2a` from the gateway dir). |
| Routes not registered | `[a2a] invalid config: …` or one of the no-routes lines above. | See the [Startup log lines](#startup-log-lines) table. |
| `404`/`405` on `POST /a2a` | No `request_received` line for the call. | Wrong `path`. Compare your `cfg.path` (default `/a2a`) to the URL the client is using. |
| `401`/`403` on `POST /a2a` | No plugin request logs at all (gateway auth rejects before the plugin handler runs). | Missing or invalid `Authorization: Bearer <operator-token>`. The card advertises this requirement; double-check the client is reading it. |
| `-32000 Subagent timed out after <ms>ms` | `request_error` with `error_class: "JsonRpcError"`, `jsonrpc_code: -32000`. | Raise `subagentTimeoutMs`. Heavy tool-using agents can need several minutes. |
| `-32001 TaskNotFoundError` after a delay | `request_done` for `SendMessage` earlier; `request_error` for `GetTask` later. | Task evicted by the FIFO cap. Raise `maxTasks` or fetch sooner. |
| `ClientDisconnect` / `BodyReadTimeout` in error logs | `request_error` with one of those `error_class` values; no response actually written for `ClientDisconnect`. | Upstream connectivity. Not a server-side bug — the client gave up or never finished sending the body. |
| Card URL points at the wrong host | Card's `supportedInterfaces[0].url` doesn't match your public URL. | Set `cardUrl` explicitly, or set `allowedHosts` if you want it to track the inbound `Host` but only within a known set. See [`configuration.md`](configuration.md). |

## What v1 does not have

For clarity:

- No streaming, push notifications, cancellation, multi-turn continuity, or `contextId`-based resume — see spec §10 conformance matrix.
- No persistent task store. Restarts lose state.
- No in-protocol A2A auth schemes beyond the bearer hint on the card; auth itself is OpenClaw gateway auth.
- No rate limiting in the plugin (consider the gateway or a reverse proxy if you need it).
