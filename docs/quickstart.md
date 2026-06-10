# Quickstart

This guide gets `@ekai/a2a` installed in OpenClaw, verifies discovery, and sends one A2A `SendMessage` request.

## Install

```sh
npm install @ekai/a2a
```

Minimum OpenClaw config:

```yaml
plugins:
  entries:
    a2a:
      enabled: true
```

Restart the gateway. On success, the plugin logs:

```text
warn  [a2a] POST /a2a uses gateway authentication; agent card remains public.
info  [a2a] registered POST /a2a and GET /.well-known/agent-card.json; agent: <agent-name>
```

If multiple OpenClaw agents are registered, set the target agent explicitly:

```yaml
plugins:
  entries:
    a2a:
      enabled: true
      agent: my-agent
```

## Discover the agent card

The discovery route is public:

```sh
curl http://<gateway>/.well-known/agent-card.json
```

Use the returned `supportedInterfaces[0].url` as the JSON-RPC endpoint. By default it is `http://<gateway>/a2a`.

## Send a message

The JSON-RPC route uses OpenClaw gateway auth:

```sh
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
        "parts": [{ "text": "hello", "mediaType": "text/plain" }]
      }
    }
  }'
```

Expected response: a JSON-RPC envelope with `result.task.status.state === "TASK_STATE_COMPLETED"`. The reply text appears in both `result.task.status.message.parts[0].text` and `result.task.artifacts[0].parts[0].text`.

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

Start OpenClaw with `OPENROUTER_API_KEY` set.

## First troubleshooting checks

- `401 Unauthorized` on `POST /a2a`: send `Authorization: Bearer <gateway-token>`.
- `Requested agent harness "codex" is not registered`: configure a model/runtime; the OpenRouter snippet above is a working local setup.
- `TaskNotFoundError`: tasks are in-memory and may be evicted by `maxTasks` or lost on restart.
- Wrong URL in the agent card: set `cardUrl` explicitly.

For deeper operations guidance, see [dev/03-proxy-spec.md](dev/03-proxy-spec.md).

