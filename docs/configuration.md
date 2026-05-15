# Configuration

`@ekai/a2a` is configured under `plugins.entries.a2a` in your OpenClaw config. Every field is optional; defaults match the [PoC v1 spec](specs/2026-05-14-server-poc.md). The runtime schema lives in [`src/config.ts`](../src/config.ts) (Zod) and the loader-time JSON Schema in [`openclaw.plugin.json`](../openclaw.plugin.json); both are kept in sync.

If validation fails at startup, the plugin logs `[a2a] invalid config: <reason>` at `error` level and registers no routes. The gateway still starts.

## Fields

### `enabled`

- **Type:** boolean
- **Default:** `true`
- **Effect:** When `false`, the plugin logs `[a2a] disabled` and exits without registering any routes. Use to keep the package installed but turn the endpoint off without restarting the package install.

```yaml
plugins:
  entries:
    a2a:
      enabled: false
```

### `path`

- **Type:** string
- **Default:** `"/a2a"`
- **Validation:** must start with `/`.
- **Effect:** Mount path for the JSON-RPC route (`POST <path>`). The agent-card route is always `GET /.well-known/agent-card.json` (fixed by RFC 8615 + A2A discovery) and is not affected by this field.

```yaml
a2a:
  path: "/agents/main"   # → POST /agents/main
```

### `agent`

- **Type:** string
- **Default:** auto-detect when exactly one agent is registered
- **Validation:** must match `/^[a-z0-9][a-z0-9_-]{0,63}$/` (lowercase alphanumerics, dash, underscore; 1–64 chars; must start with `[a-z0-9]`).
- **Effect:** Chooses which OpenClaw agent this plugin instance fronts. Required when `agents.list` in the host config has more than one entry; without it the plugin logs `[a2a] Multiple agents registered. …` and installs no routes. If the configured id is not in the list, the plugin logs `[a2a] Agent <name> not found. Available: […]` and installs no routes.

```yaml
a2a:
  agent: my-agent
```

### `cardName`

- **Type:** string
- **Default:** the OpenClaw agent's `name` (falling back to `id`)
- **Effect:** Overrides the `name` field in the served agent card. Useful when you want the public A2A identity to differ from the internal OpenClaw agent name.

### `cardDescription`

- **Type:** string
- **Default:** `"A2A interface to OpenClaw agent '<name>'."`
- **Effect:** Overrides the `description` field in the served agent card.

### `cardVersion`

- **Type:** string
- **Default:** the plugin's package version (currently `0.1.0`)
- **Effect:** Overrides the `version` field in the served agent card. Set this if you want client caches to invalidate when your agent's behaviour changes meaningfully.

### `cardUrl`

- **Type:** string
- **Default:** derived from the inbound request as `<scheme>://<host><path>`
- **Effect:** Overrides the `supportedInterfaces[0].url` field in the served agent card. **Set this in any environment that sits behind a reverse proxy** — without it, the URL is built from `x-forwarded-proto` and the request's `Host` header, which a misconfigured proxy can poison. With it set, the served URL is constant regardless of what the client sent.

```yaml
a2a:
  cardUrl: "https://a2a.example.com/a2a"
```

### `advertiseBearerAuth`

- **Type:** boolean
- **Default:** `true`
- **Effect:** When `true`, the agent card carries:
  ```json
  {
    "securitySchemes": { "bearerAuth": { "type": "http", "scheme": "bearer", "description": "…" } },
    "security": [{ "bearerAuth": [] }]
  }
  ```
  Spec-compliant A2A clients will then attach `Authorization: Bearer <token>` automatically. Set to `false` only when your deployment fronts the plugin with an auth-stripping proxy that handles auth itself and you don't want the card to advertise bearer.

### `allowedHosts`

- **Type:** string array
- **Default:** unset (any well-formed `Host` is accepted)
- **Effect:** Defensive Host-header allowlist used when **building the card URL**. When non-empty, a request `Host` outside this list (compared both with and without port) is rewritten to the first entry before becoming the card URL. Setting `cardUrl` makes this redundant; use `allowedHosts` when you want the URL to track the inbound Host but only within a known set.

```yaml
a2a:
  allowedHosts: ["a2a.example.com", "a2a.example.com:443"]
```

### `subagentTimeoutMs`

- **Type:** integer (milliseconds)
- **Default:** `180000` (3 minutes)
- **Validation:** must be ≥ `6000`.
- **Effect:** Passed through to `api.runtime.subagent.waitForRun({ timeoutMs })`. If the subagent run doesn't complete in this window, the plugin stores the task as `TASK_STATE_FAILED` and returns `-32000 Subagent timed out after <ms>ms`. Raise this for heavy tool-using agents.

### `maxTasks`

- **Type:** integer
- **Default:** `10000`
- **Validation:** must be ≥ `1`.
- **Effect:** FIFO cap on the in-memory task store. Once the cap is exceeded, the oldest task (by insertion order) is evicted; subsequent `GetTask` on an evicted id returns `-32001 TaskNotFoundError`. Tune up if you have clients that retrieve tasks long after `SendMessage`, or down to bound memory.

## Ready-to-paste snippets

### Minimal

```yaml
plugins:
  entries:
    a2a:
      enabled: true
```

This works whenever exactly one OpenClaw agent is registered. The card URL is derived from the inbound request, bearer auth is advertised, defaults apply for everything else.

### Production-tilted

```yaml
plugins:
  entries:
    a2a:
      enabled: true
      agent: my-agent
      path: "/a2a"
      cardName: "Acme Support Agent"
      cardDescription: "Customer support agent for Acme Corp."
      cardVersion: "2026.05.15"
      cardUrl: "https://a2a.acme.example/a2a"
      advertiseBearerAuth: true
      subagentTimeoutMs: 600000   # 10 minutes
      maxTasks: 50000
```

Pinning `agent`, `cardUrl`, and `cardVersion` produces a stable public surface regardless of which proxy fronts the gateway or which OpenClaw agent list shape ships next.
