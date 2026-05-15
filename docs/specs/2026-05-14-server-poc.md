# `@ekai/a2a` Server — PoC v1

| Field | Value |
| --- | --- |
| Version | PoC v1 (server only) |
| Package | `@ekai/a2a` |
| Protocol | A2A current JSON-RPC binding (subset — see §10) |

An OpenClaw plugin that exposes the host agent as an A2A protocol server. After install and minimal config, the agent is callable via JSON-RPC `SendMessage` at the gateway's HTTP endpoint and discoverable at `/.well-known/agent-card.json`. Any spec-compliant A2A client (Google ADK, CrewAI, `curl`) can invoke it.

The key words **MUST**, **MUST NOT**, **SHOULD**, **MAY** follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

> **Naming.** This implements the **A2A protocol** (a2a-protocol.org). OpenClaw's `.a2a` filename suffix (e.g. `sessions-send-tool.a2a.ts`) refers to an internal in-process inter-agent feature — unrelated.

## 1. Scope

**In.** Plugin entry; two HTTP routes (`POST <path>`, `GET /.well-known/agent-card.json`); blocking `SendMessage`; `GetTask`; in-memory task store; agent card auto-populated from the resolved OpenClaw agent; single configured agent per instance.

**Out.** Client side, streaming, push notifications, in-protocol A2A authentication, multi-turn continuity via `contextId`, multiple agents per instance, persistent task store, signed cards, mDNS/DNS-SD discovery, rich `skills` entries. See conformance matrix for the full not-supported list.

## 2. Architecture decision

v1 exposes A2A as an HTTP server boundary, not as an OpenClaw channel. The public contract is A2A discovery plus JSON-RPC over HTTP; OpenClaw channels remain internal runtime plumbing and are not exposed or mapped in v1.

Each `SendMessage` request **MUST** execute by spawning a fresh OpenClaw subagent run. The subagent is the execution backend for the configured host agent; it is not a long-lived A2A conversation. `contextId` is echoed on the returned task only, and v1 **MUST NOT** resume channels, sessions, or prior subagent state from it.

Future versions MAY map A2A `contextId` to an OpenClaw session or channel after streaming, cancellation, persistence, and multi-turn continuity are explicitly designed. That mapping is intentionally out of scope for this PoC.

## 3. Plugin lifecycle

On gateway startup, the plugin:

1. Reads `plugins.entries.a2a.*` config (§4).
2. Resolves the target OpenClaw agent: auto-detected if exactly one is registered, explicit `agent` config required otherwise.
3. Builds the agent card (§6.1).
4. Registers two HTTP routes via `api.registerHttpRoute`:

| Path | Method | `auth` | `replaceExisting` |
| --- | --- | --- | --- |
| `<cfg.path>` (default `/a2a`) | POST | `"gateway"` | `true` |
| `/.well-known/agent-card.json` | GET | `"plugin"` | `false` |

5. Emits two startup log lines:
   - `warn`: `[a2a] POST <path> uses gateway authentication; agent card remains public.`
   - `info`: `[a2a] registered POST <path> and GET /.well-known/agent-card.json; agent: <agent.name>`.

If `enabled: false`, the plugin **MUST** register no routes and log `[a2a] disabled`.

The plugin **MUST NOT** prevent the gateway from starting on configuration error. Failure cases:

| Condition | Behavior |
| --- | --- |
| Multiple agents registered, no `agent` configured | No routes. Log: `[a2a] Multiple agents registered. Set plugins.entries.a2a.agent to one of: [<list>]`. |
| Configured `agent` not found | No routes. Log: `[a2a] Agent <name> not found. Available: [<list>]`. |
| `<cfg.path>` route already owned | Replaces (`replaceExisting: true`). OpenClaw's plugin loader logs the conflict. |
| `/.well-known/agent-card.json` already owned | Skips (`replaceExisting: false`). JSON-RPC route still works. OpenClaw's plugin loader logs the skip. |

## 4. Configuration

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | |
| `path` | string | `"/a2a"` | **MUST** start with `/`. |
| `agent` | string | auto-detect | **MUST** match `/^[a-z0-9][a-z0-9_-]{0,63}$/`. |
| `cardName` | string | `agent.name` | |
| `cardDescription` | string | generic (`A2A interface to OpenClaw agent '<name>'.`) | |
| `cardVersion` | string | package version | |
| `cardUrl` | string | request scheme + `Host` + `path` | Override behind a `Host`-rewriting proxy. |
| `subagentTimeoutMs` | number | `180000` | **MUST** be ≥ `6000`. |
| `advertiseBearerAuth` | boolean | `true` | Adds `securitySchemes` + `security` to the agent card. |
| `allowedHosts` | string[] | unset | If set, request `Host` values outside the list are rewritten to the first entry when building the card URL. |
| `maxTasks` | number | `10000` | FIFO cap on retained tasks. **MUST** be ≥ `1`. |

Schema lives in `openclaw.plugin.json` `configSchema` (JSON Schema, validated by OpenClaw at load time).

## 5. Operations

### 5.1. `SendMessage`

#### Inputs

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `message.role` | string | Yes | **MUST** be `"ROLE_USER"`. |
| `message.messageId` | string | Yes | |
| `message.parts` | `Part[]` | Yes | **MUST** contain ≥1 part with a `text` field. Non-`text` parts ignored. |
| `message.contextId` | string | No | Echoed on the returned task only (no state resume). |
| `message.taskId` | string | No | Rejected in v1; task continuation is out of scope. |
| `configuration`, `metadata` | object | No | Ignored. |

#### Behavior

1. Validate envelope (§5.1 Errors). Reject malformed input.
2. Concatenate `text` parts into a prompt string.
3. Allocate `taskId` (UUIDv4); store the task as `TASK_STATE_WORKING`.
4. Call the public plugin runtime subagent API:
   - `api.runtime.subagent.run({ sessionKey, message: prompt, deliver: false })`
   - `sessionKey` = `agent:<agentId>:a2a-<taskId>`
5. If `run` throws: store task as `TASK_STATE_FAILED`; return `-32000`.
6. `wait = await api.runtime.subagent.waitForRun({ runId, timeoutMs: subagentTimeoutMs })`. If `wait.status !== "ok"`: store as `TASK_STATE_FAILED`, best-effort delete the session, and return `-32000`.
7. `reply = latest assistant reply from api.runtime.subagent.getSessionMessages({ sessionKey })`. If `undefined`: store as `TASK_STATE_FAILED`, best-effort delete the session, and return `-32000`.
8. Store task as `TASK_STATE_COMPLETED` with a `ROLE_AGENT` status message and as a single artifact named `"reply"` whose first part has `{ "text": reply, "mediaType": "text/plain" }`. Best-effort delete the session. Return `{ "task": task }`.

In both `TASK_STATE_COMPLETED` and `TASK_STATE_FAILED` outcomes, `status.message` is a `Message` with `role: "ROLE_AGENT"` and a single part `{ "text": <text>, "mediaType": "text/plain" }` — the reply text for completion, the error text for failure (steps 5–7).

Tasks **MUST NOT** pass through `TASK_STATE_SUBMITTED`. The implementation **MAY** skip emitting an intermediate `TASK_STATE_WORKING` event since no streaming subscriber exists.

Concurrent inbound requests **MUST** be served concurrently with independent `taskId`s and subagent sessions. v1 **MUST NOT** rate-limit.

#### Output

On success, `SendMessageResponse` with `task.status.state === "TASK_STATE_COMPLETED"` (see §6.2). On subagent failure/timeout, v1 returns a JSON-RPC error and stores the task as `TASK_STATE_FAILED`. v1 never returns a direct `message` response.

#### Errors

| Code | When |
| --- | --- |
| `-32602 Invalid params` | `message` missing, `messageId` missing, `role !== "ROLE_USER"`, unsupported `taskId`, or no `text` parts. |
| `-32000 Server error` | Spawn rejected, wait failed, no reply. Message **MUST** include `spawn.error` / `spawn.note` / wait error where available. |
| `-32000 Server error` | Subagent exceeded `subagentTimeoutMs`. Message **MUST** be exactly `Subagent timed out after <ms>ms`. Task **MUST** be stored as `TASK_STATE_FAILED`. |

### 5.2. `GetTask`

#### Inputs

| Param | Type | Required |
| --- | --- | --- |
| `id` | string | Yes |
| `historyLength` | number | No (ignored) |

#### Behavior

Look up `id` in the in-memory store; return the stored task as-is.

#### Errors

| Code | When |
| --- | --- |
| `-32602 Invalid params` | `id` missing. |
| `-32001 TaskNotFoundError` | `id` not found. |

### 5.3. Unsupported methods

Return `-32601 Method not found: <method>` for: `CancelTask`, `SendStreamingMessage`, `SubscribeToTask`, `ListTasks`, `CreateTaskPushNotificationConfig`, `GetTaskPushNotificationConfig`, `ListTaskPushNotificationConfigs`, `DeleteTaskPushNotificationConfig`, `GetExtendedAgentCard`, and any other method.

The agent card's `capabilities.streaming: false` and `capabilities.pushNotifications: false` advertise this honestly so spec-compliant clients can negotiate before calling optional methods.

### 5.4. `GET /.well-known/agent-card.json`

Returns the agent card (§6.1) as `application/json; charset=utf-8`. The preferred interface URL is built from request scheme, request `Host`, and `cfg.path` at response time unless `cardUrl` is set — subject to the §6.1 sanitisation rules (scheme allowlist, malformed-`Host` fallback, `allowedHosts` rewrite).

## 6. Data model

### 6.1. Agent card (served)

| Field | Value |
| --- | --- |
| `name` | `cfg.cardName ?? agent.name ?? agent.id` |
| `description` | `cfg.cardDescription ?? generic` |
| `version` | `cfg.cardVersion ?? package version` |
| `supportedInterfaces[0].url` | `cfg.cardUrl`, or request scheme + `Host` + `cfg.path` |
| `supportedInterfaces[0].protocolBinding` | `"JSONRPC"` |
| `supportedInterfaces[0].protocolVersion` | `"1.0"` |
| `capabilities.streaming` | `false` |
| `capabilities.pushNotifications` | `false` |
| `defaultInputModes` | `["text/plain"]` |
| `defaultOutputModes` | `["text/plain"]` |
| `skills` | `[]` |

When `cfg.advertiseBearerAuth` is `true` (default), the card additionally carries:

```json
{
  "securitySchemes": {
    "bearerAuth": { "type": "http", "scheme": "bearer", "description": "..." }
  },
  "security": [{ "bearerAuth": [] }]
}
```

This advertises the gateway-auth requirement on the JSON-RPC route to spec-compliant A2A clients. Operators behind an auth-stripping proxy can set `advertiseBearerAuth: false` to suppress the blocks. `signatures` is unused in v1.

The `supportedInterfaces[0].url` is sanitised before serving: `x-forwarded-proto` is only honoured when its value is `http` or `https`; an absent or malformed `Host` falls back to `localhost`; when `cfg.allowedHosts` is non-empty, a request `Host` outside the list is rewritten to the first allowed entry.

### 6.2. Task (in-memory, per process)

| Field | Notes |
| --- | --- |
| `id` | UUIDv4, allocated in §5.1. |
| `contextId` | Echoed from request if present; absent otherwise. |
| `status.state` | `"TASK_STATE_WORKING" \| "TASK_STATE_COMPLETED" \| "TASK_STATE_FAILED"`. No other states produced. |
| `status.message` | Reply (on `TASK_STATE_COMPLETED`) or error text (on `TASK_STATE_FAILED`). |
| `status.timestamp` | ISO 8601, set on each state transition. |
| `artifacts` | One named `"reply"` on `TASK_STATE_COMPLETED`; `[]` on `TASK_STATE_FAILED`. |
| `history` | `[]`. |

Store is per-process and bounded. Restart loses state. Insertion-order FIFO eviction caps retained tasks at `cfg.maxTasks` (default `10000`); evicted task ids return `-32001 TaskNotFoundError` on subsequent `GetTask`.

### 6.3. A2A → OpenClaw subagent mapping

| A2A field | OpenClaw `api.runtime.subagent` field | Mapping |
| --- | --- | --- |
| `message.parts[].text` | `run.message` | Concatenated. |
| `cfg.agent` | `run.sessionKey` | Embedded in `agent:<agentId>:a2a-<taskId>`. |
| — | `run.deliver` | `false`. |
| `cfg.subagentTimeoutMs` | `waitForRun.timeoutMs` | Direct. |
| `message.contextId` | task `contextId` | Stored in the A2A task only; no OpenClaw session resume. |

The JSON-RPC route **MUST** use OpenClaw gateway auth so plugin runtime subagent methods run with an operator request scope. Session cleanup uses `api.runtime.subagent.deleteSession({ sessionKey })` best-effort; deletion failures are logged at `warn` and do not affect a completed response.

## 7. JSON-RPC error envelope

| Code | Message | Cause |
| --- | --- | --- |
| `-32700` | `Parse error` | Body is not valid JSON. |
| `-32600` | `Invalid Request` | JSON-RPC envelope missing required fields. |
| `-32601` | `Method not found: <method>` | See §5.3. |
| `-32602` | (descriptive) | Missing or invalid params. |
| `-32001` | `TaskNotFoundError` | Task id not found. |
| `-32000` | (descriptive) | Subagent rejected, errored, or timed out (§5.1). |

v1 uses A2A's standard `TaskNotFoundError` code for unknown task ids and standard JSON-RPC codes for all other validation failures.

## 8. Observability

Per request, the JSON-RPC handler **MUST** emit 2–3 structured log events via `api.logger`, depending on how far the request progresses:

| Point | Level | Event | Fields |
| --- | --- | --- | --- |
| Received | `info` | `request_received` | `caller_host` (every request, even those that fail before parse) |
| Entry | `info` | `request_in` | `method`, `caller_host` (only after a JSON-RPC envelope parses) |
| Completion | `info` | `request_done` | `method`, `taskId`, `status`, `latency_ms` |
| Error | `error` | `request_error` | `method?`, `taskId?`, `error_class`, `error_message`, `jsonrpc_code` |

These are the only observability surfaces in v1. They **MUST** make "debug from logs alone" realistic.

## 9. Security

v1 has no in-protocol A2A authentication fields. The JSON-RPC route **MUST** use OpenClaw gateway authentication (`auth: "gateway"`), and the agent card route remains public (`auth: "plugin"`) for discovery. Operators binding the gateway to non-loopback hosts **MUST** configure OpenClaw gateway auth.

## 10. Conformance

A2A surface coverage for features beyond §5–6.

### 10.1. Transports

| Transport | Status | Notes |
| --- | --- | --- |
| HTTP + JSON-RPC 2.0 | ✅ | Single `POST` endpoint at the configured path (default `/a2a`). |
| HTTP + REST | ❌ Future | Spec defines an equivalent REST binding; would map cleanly. |
| gRPC | ❌ Future | Spec defines a gRPC binding via `spec/a2a.proto`. |
| SSE for streaming | ❌ Future | Requires streaming support first. |

### 10.2. Part types

| Part type | Inbound | Outbound | Notes |
| --- | --- | --- | --- |
| `text` | ✅ | ✅ | Multiple text parts are concatenated for the prompt and the reply. |
| `file` (URI) | ❌ | ❌ | Future. |
| `file` (base64) | ❌ | ❌ | Future. |
| `data` (structured JSON) | ❌ | ❌ | Future. |

### 10.3. Task lifecycle states

| State | Emitted | Notes |
| --- | --- | --- |
| `TASK_STATE_SUBMITTED` | ⚠️ Skipped | Tasks complete synchronously; the state goes straight to `TASK_STATE_WORKING`. |
| `TASK_STATE_WORKING` | ✅ | Emitted once, immediately on receipt. |
| `TASK_STATE_INPUT_REQUIRED` | ❌ | Multi-turn continuity is not implemented in v1. |
| `TASK_STATE_AUTH_REQUIRED` | ❌ | No in-protocol A2A auth challenge flow in v1. |
| `TASK_STATE_COMPLETED` | ✅ | On successful subagent reply. |
| `TASK_STATE_FAILED` | ✅ | On subagent throw or timeout. Carries the error message in `status.message`. |
| `TASK_STATE_CANCELED` | ❌ | Tasks aren't cancellable in v1. |
| `TASK_STATE_REJECTED` | ❌ | Reserved for future policy layer. |

### 10.4. Auth schemes

| Scheme | Status | Notes |
| --- | --- | --- |
| None (open) | ❌ | JSON-RPC uses OpenClaw gateway auth. |
| OpenClaw gateway auth | ✅ v1 default | The JSON-RPC route requires the gateway's configured auth; the agent card remains public. |
| A2A-advertised HTTP Bearer | ✅ v1 default | The card advertises `bearerAuth` by default (`advertiseBearerAuth: true`) so clients know to send the OpenClaw gateway token. |
| OAuth2 | ❌ Future | After bearer. |
| OpenID Connect | ❌ Future | |
| mTLS | ❌ Future | |
| HTTP Basic | ❌ Future | Lower priority; spec lists it but uncommon for agents. |
| `TASK_STATE_AUTH_REQUIRED` task state | ❌ Not used | Future, alongside auth. |

## 11. References

- A2A latest spec: https://a2a-protocol.org/latest/specification/
- A2A discovery: https://a2a-protocol.org/latest/topics/agent-discovery/
- A2A task lifecycle: https://a2a-protocol.org/latest/topics/life-of-a-task/
- JSON-RPC 2.0: https://www.jsonrpc.org/specification
- RFC 8615 (well-known URIs), RFC 2119.
- OpenClaw plugin SDK entry: `openclaw/plugin-sdk/core` — `definePluginEntry`, `OpenClawPluginApi`.
- OpenClaw `registerHttpRoute`: `src/plugins/types.ts:2080` (handler at `:1893`, params at `:1898`).
- OpenClaw public plugin runtime: `api.runtime.subagent.run`, `waitForRun`, `getSessionMessages`, `deleteSession`.
- Webhook plugin (HTTP-route reference): `extensions/webhooks/index.ts`.
