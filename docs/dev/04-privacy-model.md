# Privacy model

`@ekai/a2a` has a small v1 privacy surface: public discovery, gateway-authenticated JSON-RPC execution, transient task state, and structured operational logs. It does not add its own identity provider, persistence layer, or A2A-native auth challenge flow.

## Public discovery

`GET /.well-known/agent-card.json` is public by design so A2A clients can discover how to call the agent.

The card may expose:

- Public agent name, description, and version.
- JSON-RPC endpoint URL.
- Capability flags.
- Advertised bearer-auth requirement.

Operators should treat `cardName`, `cardDescription`, `cardVersion`, and `cardUrl` as public metadata.

## Authenticated execution

`POST <path>` uses OpenClaw gateway auth. Clients send:

```text
Authorization: Bearer <gateway-operator-token>
```

The plugin does not inspect or store the token. Authentication and rejection happen at the gateway before the plugin handler runs.

The agent card advertises bearer auth by default via `securitySchemes` and `security`. Operators behind an auth-stripping proxy can set `advertiseBearerAuth: false` to suppress that metadata, but the JSON-RPC route still depends on the gateway or proxy for access control.

## Message handling

For `SendMessage`, the plugin:

- Accepts text parts from the A2A user message.
- Concatenates those text parts into a prompt.
- Sends the prompt to `api.runtime.subagent.run`.
- Reads the latest assistant reply from the subagent session.
- Stores the resulting task in memory until eviction or process restart.

Non-text parts are ignored in v1. `configuration` and `metadata` params are accepted but ignored.

## Task retention

Tasks are stored in process memory only.

- `maxTasks` bounds retained tasks with FIFO eviction.
- Restarting the gateway drops all tasks.
- Completed tasks contain the reply text in both `status.message` and `artifacts`.
- Failed tasks contain the error text in `status.message`.
- `history` is always empty in v1.

There is no database, disk persistence, or cross-process task replication.

## Session cleanup

Each `SendMessage` uses a per-task subagent session key:

```text
agent:<agentId>:a2a-<taskId>
```

After success or failure, the plugin calls `api.runtime.subagent.deleteSession` best-effort. If cleanup fails, the plugin logs a warning and preserves the original response behavior.

## Logs

The plugin logs request lifecycle events with operational fields such as method, task id, caller host, latency, error class, error message, and JSON-RPC code.

The plugin does not intentionally log full user prompts or agent replies in request lifecycle logs. Operators should still treat logs as sensitive because caller hosts, task ids, and error strings may reveal operational context.

## Out of scope in v1

v1 does not provide:

- A2A-native OAuth2, OpenID Connect, mTLS, or Basic auth.
- `TASK_STATE_AUTH_REQUIRED`.
- Signed agent cards.
- Persistent task storage.
- Multi-turn continuity via `contextId`.
- Per-client rate limiting.

Use the OpenClaw gateway or a reverse proxy for network exposure, token policy, rate limiting, request size policy beyond the plugin's body limit, and centralized audit controls.
