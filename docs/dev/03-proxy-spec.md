# Proxy and operations spec

For operators deploying `@ekai/a2a` behind OpenClaw gateway routing, reverse proxies, or public hostnames. This file covers configuration, route behavior, card URL generation, logs, capacity, and operational troubleshooting.

For client behavior, see [02-client-spec.md](02-client-spec.md). For privacy and security posture, see [04-privacy-model.md](04-privacy-model.md).

## Configuration

`@ekai/a2a` is configured under `plugins.entries.a2a`. Every field is optional.

| Field | Type | Default | Effect |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | When `false`, no routes are registered. |
| `path` | string | `"/a2a"` | JSON-RPC mount path. Must start with `/`. |
| `agent` | string | auto-detect | Target OpenClaw agent id. Required when multiple agents are registered. |
| `cardName` | string | agent name or id | Overrides agent card `name`. |
| `cardDescription` | string | generated description | Overrides agent card `description`. |
| `cardVersion` | string | package version | Overrides agent card `version`. |
| `cardUrl` | string | derived from request | Overrides `supportedInterfaces[0].url`; recommended behind reverse proxies. |
| `advertiseBearerAuth` | boolean | `true` | Adds bearer auth metadata to the agent card. |
| `allowedHosts` | string[] | unset | Host allowlist used when deriving the card URL. |
| `subagentTimeoutMs` | integer | `180000` | Subagent wait timeout in milliseconds; minimum `6000`. |
| `maxTasks` | integer | `10000` | FIFO cap for the in-memory task store; minimum `1`. |

The runtime schema lives in [`../../src/config.ts`](../../src/config.ts). The loader-time JSON Schema lives in [`../../openclaw.plugin.json`](../../openclaw.plugin.json). Keep both in sync when adding config fields.

Minimal config:

```yaml
plugins:
  entries:
    a2a:
      enabled: true
```

Production-tilted config:

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
      subagentTimeoutMs: 600000
      maxTasks: 50000
```

## Route auth

| Route | Method | Auth | Notes |
| --- | --- | --- | --- |
| `<path>` | `POST` | `gateway` | Requires OpenClaw operator token. |
| `/.well-known/agent-card.json` | `GET` | `plugin` | Public discovery route. |

The JSON-RPC route is replaceable so operators can intentionally remount it. The well-known agent card route is not replaceable; if another plugin owns it, OpenClaw skips this route while the JSON-RPC route can still work.

## Card URL generation

The served agent card's `supportedInterfaces[0].url` is:

1. `cardUrl`, when configured.
2. Otherwise, request scheme plus request `Host` plus configured `path`.

When deriving the URL from the request:

- `x-forwarded-proto` is honored only when it is `http` or `https`.
- Missing or malformed `Host` falls back to `localhost`.
- If `allowedHosts` is set and request `Host` is outside the allowlist, the first allowed host is used.

Set `cardUrl` explicitly in any environment behind a reverse proxy. Use `allowedHosts` only when the public URL should track inbound hostnames within a known set.

## Startup logs

Success:

```text
warn  [a2a] POST /a2a uses gateway authentication; agent card remains public.
info  [a2a] registered POST /a2a and GET /.well-known/agent-card.json; agent: <agent-name>
```

No routes installed:

| Log line | Cause | Fix |
| --- | --- | --- |
| `[a2a] disabled` | `enabled: false`. | Set `enabled: true`. |
| `[a2a] No agents registered; not installing routes.` | No OpenClaw agents are configured. | Configure an agent. |
| `[a2a] Multiple agents registered...` | More than one agent and no `agent` field. | Set `agent`. |
| `[a2a] Agent <name> not found...` | Configured agent id is unknown. | Use one of the logged ids. |
| `[a2a] invalid config: <reason>` | Config validation failed. | Fix the named field. |

Exact startup strings live in [`../../src/strings.ts`](../../src/strings.ts).

## Request logs

Each request through `POST <path>` emits structured log events.

| Event | Level | When | Fields |
| --- | --- | --- | --- |
| `request_received` | `info` | First handler line. | `caller_host` |
| `request_in` | `info` | After JSON-RPC envelope parse. | `method`, `caller_host` |
| `request_done` | `info` | Successful result envelope. | `method`, `taskId`, `status`, `latency_ms` |
| `request_error` | `error` | Error envelope. | `method?`, `taskId?`, `error_class`, `error_message`, `jsonrpc_code` |

Format example:

```text
info [a2a] request_received {"caller_host":"gw.example:8080"}
info [a2a] request_in {"method":"SendMessage","caller_host":"gw.example:8080"}
info [a2a] request_done {"method":"SendMessage","taskId":"...","status":"ok","latency_ms":1432}
```

## Capacity

The task store is in-process and bounded by `maxTasks`. Eviction is FIFO by insertion order. Evicted task ids return `-32001 TaskNotFoundError`.

Restarts drop all tasks. There is no persistence layer in v1. Memory grows roughly linearly with retained task count.

## Troubleshooting

| Symptom | Likely log signature | Fix |
| --- | --- | --- |
| Plugin not installed | No `[a2a]` startup lines. | Confirm package install and `plugins.entries.a2a`. |
| Routes not registered | Startup no-routes line. | Fix config or agent selection. |
| `404` or `405` on `POST /a2a` | No plugin request logs. | Compare client URL to configured `path`. |
| `401` or `403` on `POST /a2a` | No plugin request logs. | Send `Authorization: Bearer <operator-token>`. |
| `-32000 Subagent timed out after <ms>ms` | `request_error` with JSON-RPC `-32000`. | Raise `subagentTimeoutMs`. |
| `-32001 TaskNotFoundError` after delay | Earlier success, later `GetTask` error. | Raise `maxTasks` or fetch sooner. |
| Card URL points at wrong host | Card URL differs from public URL. | Set `cardUrl`, or configure `allowedHosts`. |
