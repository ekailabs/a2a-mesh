# A2A client guide

For someone integrating an A2A client — Google ADK, CrewAI, an internal SDK, or hand-rolled HTTP — against an OpenClaw instance running `@ekai/a2a`. Walks through discovery, auth, the two supported RPC methods, the error code table, and what's not yet implemented.

For operator-facing context (security posture, log lines, troubleshooting) see [`operations.md`](operations.md). For config field semantics see [`configuration.md`](configuration.md). The authoritative protocol contract is [`specs/2026-05-14-server-poc.md`](specs/2026-05-14-server-poc.md).

## Discovery

```sh
curl http://<gateway>/.well-known/agent-card.json
```

The route is public — no auth required. Response shape (defaults shown; values may be customised via `cardName`, `cardDescription`, `cardVersion`, `cardUrl`):

```json
{
  "name": "<agent name>",
  "description": "A2A interface to OpenClaw agent '<id>'.",
  "version": "0.1.0",
  "supportedInterfaces": [
    {
      "url": "http://<host>/a2a",
      "protocolBinding": "JSONRPC",
      "protocolVersion": "1.0"
    }
  ],
  "capabilities": {
    "streaming": false,
    "pushNotifications": false
  },
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [],
  "securitySchemes": {
    "bearerAuth": {
      "type": "http",
      "scheme": "bearer",
      "description": "OpenClaw gateway operator token. Pass as 'Authorization: Bearer <token>' on POST."
    }
  },
  "security": [{ "bearerAuth": [] }]
}
```

The canonical place to POST is whatever `supportedInterfaces[0].url` says. Don't hard-code `/a2a` in client code — read it from the card so operators can remount it without breaking you.

## Authentication

Required on `POST <path>`:

```
Authorization: Bearer <gateway-operator-token>
```

The token is OpenClaw's operator-gateway token (the same one used by other gateway-auth endpoints in your deployment). The plugin advertises `bearerAuth` via the card's `securitySchemes` so a spec-compliant client picks this up automatically. Without a valid token the gateway rejects the request before the plugin handler runs.

## `SendMessage`

Synchronous one-shot. Spawns an OpenClaw subagent run, waits up to `subagentTimeoutMs`, returns the completed task.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": "<arbitrary-correlation-id>",
  "method": "SendMessage",
  "params": {
    "message": {
      "role": "ROLE_USER",
      "messageId": "<your-id>",
      "parts": [
        {"text": "hello", "mediaType": "text/plain"}
      ]
    }
  }
}
```

Required-field rules:

| Field | Rule |
| --- | --- |
| `params.message` | object, required. |
| `message.role` | must be the literal string `"ROLE_USER"`. |
| `message.messageId` | non-empty string, required. |
| `message.parts` | array, required, must contain at least one element whose `text` is a non-empty string. Non-text parts are accepted but ignored. |
| `message.contextId` | optional string; v1 stores it on the returned task but does **not** resume any prior session from it. |
| `message.taskId` | **must be absent** in v1 — task continuation is out of scope. Any non-null value yields `-32602`. |
| `params.configuration`, `params.metadata` | optional, ignored. |

Multiple text parts are concatenated (in order) into the prompt sent to the agent.

**Response — success:**

```json
{
  "jsonrpc": "2.0",
  "id": "<echoed>",
  "result": {
    "task": {
      "id": "<uuid v4>",
      "contextId": "<echoed if provided>",
      "status": {
        "state": "TASK_STATE_COMPLETED",
        "message": {
          "role": "ROLE_AGENT",
          "parts": [{"text": "<reply>", "mediaType": "text/plain"}]
        },
        "timestamp": "<iso8601>"
      },
      "artifacts": [
        {
          "name": "reply",
          "parts": [{"text": "<reply>", "mediaType": "text/plain"}]
        }
      ],
      "history": []
    }
  }
}
```

The reply text appears in two places: `status.message.parts[0].text` (the in-band conversational reply) and `artifacts[0].parts[0].text` (the durable artifact). They are the same string.

**Response — failure (subagent error or timeout):**

```json
{
  "jsonrpc": "2.0",
  "id": "<echoed>",
  "error": {
    "code": -32000,
    "message": "Subagent timed out after 180000ms"
  }
}
```

The plugin also stores the failed task server-side, but the JSON-RPC error envelope does not echo its id. `GetTask` after a `-32000` is therefore only useful if you obtained the id another way (e.g., correlation in your client).

## `GetTask`

Look up a task by id. The store is in-process and FIFO-bounded; see `maxTasks` in [`configuration.md`](configuration.md).

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "GetTask",
  "params": {
    "id": "<task-uuid>"
  }
}
```

`historyLength` is accepted but ignored in v1.

**Response — success:** same `task` shape as `SendMessage`.

**Response — not found:**

```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "error": {
    "code": -32001,
    "message": "TaskNotFoundError"
  }
}
```

`-32001` is also what you'll get for tasks that were evicted by the FIFO cap or lost on restart.

## Error codes

All errors come back as standard JSON-RPC error objects (`{ code, message }`).

| Code | Name | When |
| --- | --- | --- |
| `-32700` | Parse error | Request body isn't valid JSON. Response `id` is `null`. |
| `-32600` | Invalid Request | Envelope missing `jsonrpc: "2.0"` or `method`, body exceeds 1 MiB, or non-`POST` method. |
| `-32601` | Method not found: `<method>` | Method is one of the unsupported v1 methods (see below) or anything else not recognised. |
| `-32602` | (descriptive) | `SendMessage` validation failed (missing `message`, wrong `role`, missing `messageId`, no text parts, `taskId` supplied), or `GetTask` missing `id`. |
| `-32000` | (descriptive) | Subagent run rejected, errored, or `getSessionMessages` produced no usable assistant reply. |
| `-32000` | `Subagent timed out after <ms>ms` | Subagent didn't complete within `subagentTimeoutMs`. The string is exact — clients can match on it if needed. |
| `-32001` | `TaskNotFoundError` | `GetTask` id is unknown (never existed, or evicted). |

Implementation: see [`src/errors.ts`](../src/errors.ts) for the canonical codes and [`src/send-message.ts`](../src/send-message.ts) / [`src/get-task.ts`](../src/get-task.ts) for the validation flows.

## Unsupported in v1

The following A2A methods return `-32601 Method not found: <method>`:

- `CancelTask`
- `SendStreamingMessage`
- `SubscribeToTask`
- `ListTasks`
- `CreateTaskPushNotificationConfig`
- `GetTaskPushNotificationConfig`
- `ListTaskPushNotificationConfigs`
- `DeleteTaskPushNotificationConfig`
- `GetExtendedAgentCard`

The agent card advertises `capabilities.streaming: false` and `capabilities.pushNotifications: false`, so spec-compliant clients should negotiate these away before calling. The full conformance matrix (transports, part types, lifecycle states, auth schemes) is in [`specs/2026-05-14-server-poc.md`](specs/2026-05-14-server-poc.md) §10.

## Worked example: `SendMessage` then `GetTask`

```sh
# 1. SendMessage
RESPONSE=$(curl -s -X POST http://<gateway>/a2a \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer <gateway-token>' \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "SendMessage",
    "params": {
      "message": {
        "role": "ROLE_USER",
        "messageId": "msg-1",
        "parts": [{"text": "summarise A2A", "mediaType": "text/plain"}]
      }
    }
  }')

# 2. Extract the task id
TASK_ID=$(echo "$RESPONSE" | jq -r '.result.task.id')

# 3. GetTask
curl -s -X POST http://<gateway>/a2a \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer <gateway-token>' \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": \"2\",
    \"method\": \"GetTask\",
    \"params\": { \"id\": \"$TASK_ID\" }
  }"
```

`GetTask` returns the same task envelope — useful for late retrieval, audit trails, or polling clients that want to confirm the stored result independently of the original `SendMessage` response.
