# @ekai/a2a

OpenClaw plugin that exposes the host OpenClaw agent as an [A2A protocol](https://a2a-protocol.org/latest/) server. After install and minimal config, the agent is callable via JSON-RPC `SendMessage` at the gateway's HTTP endpoint and discoverable at `/.well-known/agent-card.json`. Any spec-compliant A2A client (Google ADK, CrewAI, `curl`) can invoke it.

> **Naming.** This package implements the **A2A protocol** (a2a-protocol.org). The `.a2a` filename suffix elsewhere in OpenClaw (e.g. `sessions-send-tool.a2a.ts`) refers to OpenClaw's internal in-process inter-agent feature — unrelated.

## What it does

On gateway startup, the plugin registers two HTTP routes:

- `GET /.well-known/agent-card.json` — public discovery endpoint that returns the [A2A agent card](https://a2a-protocol.org/latest/topics/agent-discovery/). The card carries the canonical JSON-RPC URL and (by default) advertises HTTP Bearer auth.
- `POST /a2a` — JSON-RPC 2.0 endpoint accepting `SendMessage` and `GetTask`. Auth is delegated to OpenClaw's gateway, so callers send `Authorization: Bearer <operator-token>`.

Each `SendMessage` spawns a one-shot OpenClaw subagent run against the configured agent, waits for its reply, returns a `TASK_STATE_COMPLETED` task with the reply text, and best-effort cleans up the per-task subagent session.

## Status

**PoC v1.** One configured target agent per plugin instance · gateway auth on `POST /a2a` · public agent card · in-memory task store (FIFO-bounded by `maxTasks`, default 10000) · no streaming, push notifications, cancellation, or multi-turn continuity. The authoritative contract is [`docs/specs/2026-05-14-server-poc.md`](docs/specs/2026-05-14-server-poc.md).

## Install

```sh
npm install @ekai/a2a
```

Minimum config in OpenClaw:

```yaml
plugins:
  entries:
    a2a:
      enabled: true
```

Restart the gateway. The plugin emits two startup log lines confirming the registered routes; see [`docs/operations.md`](docs/operations.md) for the full set of startup and per-request log lines.

For all available config fields, see [`docs/configuration.md`](docs/configuration.md).

## Smoke test

```sh
# Discover (public, no auth)
curl http://<gateway>/.well-known/agent-card.json

# Send a message (requires the gateway operator token)
curl -X POST http://<gateway>/a2a \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer <gateway-token>' \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "SendMessage",
    "params": {
      "message": {
        "role": "ROLE_USER",
        "messageId": "abc-123",
        "parts": [{"text": "hello", "mediaType": "text/plain"}]
      }
    }
  }'
```

Expected response: a JSON-RPC envelope with `result.task.status.state === "TASK_STATE_COMPLETED"`. The reply text is in both `result.task.status.message.parts[0].text` and `result.task.artifacts[0].parts[0].text`.

## OpenRouter smoke config

For a quick local OpenClaw test, configure OpenRouter with the embedded `pi` runtime and pass the key via the environment:

```yaml
models:
  providers:
    openrouter:
      baseUrl: "https://openrouter.ai/api/v1"
      apiKey: { source: env, provider: default, id: OPENROUTER_API_KEY }
      agentRuntime: { id: "pi" }
      models:
        - id: "openai/gpt-4.1-mini"
          name: "GPT-4.1 Mini"
          api: "openai-completions"
          input: ["text"]
          agentRuntime: { id: "pi" }
agents:
  defaults:
    model: "openrouter/openai/gpt-4.1-mini"
```

Then start OpenClaw with `OPENROUTER_API_KEY` set.

## Troubleshooting

First-look gotchas; the full table is in [`docs/operations.md`](docs/operations.md#troubleshooting).

- `401 Unauthorized` on `POST /a2a`: send `Authorization: Bearer <gateway-token>`.
- `Requested agent harness "codex" is not registered`: configure a model/runtime — see the OpenRouter snippet above for a working local setup.
- `TaskNotFoundError`: tasks are in-memory and may be evicted by `maxTasks` or lost on restart.
- Wrong URL in the agent card: set `cardUrl` explicitly.

## Docs

- [`docs/configuration.md`](docs/configuration.md) — config fields and YAML snippets.
- [`docs/operations.md`](docs/operations.md) — security, logs, capacity, troubleshooting.
- [`docs/client-guide.md`](docs/client-guide.md) — discovery, auth, `SendMessage`, `GetTask`, errors.
- [`docs/specs/2026-05-14-server-poc.md`](docs/specs/2026-05-14-server-poc.md) — authoritative PoC v1 contract.

## License

Apache-2.0.
