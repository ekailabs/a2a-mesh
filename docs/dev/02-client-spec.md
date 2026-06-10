# Client spec

For A2A clients integrating with an OpenClaw instance running `@ekai/a2a`. This covers discovery, authentication, supported RPC methods, error codes, and a worked `SendMessage` then `GetTask` example.

For implementation-level protocol details, see [01-protocol.md](01-protocol.md). For deployment and proxy behavior, see [03-proxy-spec.md](03-proxy-spec.md).

## Discovery

```sh
curl http://<gateway>/.well-known/agent-card.json
```

The discovery route is public. The card returns the canonical JSON-RPC URL in `supportedInterfaces[0].url`; clients should read that value instead of hard-coding `/a2a`.

Default card shape:

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

## Authentication

`POST <path>` requires OpenClaw gateway authentication:

```text
Authorization: Bearer <gateway-operator-token>
```

Without a valid token, the gateway rejects the request before the plugin handler runs. The agent card advertises `bearerAuth` by default so spec-compliant clients can attach the token automatically.

## SendMessage

`SendMessage` is synchronous and one-shot. It spawns an OpenClaw subagent run, waits up to `subagentTimeoutMs`, and returns a completed A2A task when the agent replies.

Request:

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "SendMessage",
  "params": {
    "message": {
      "role": "ROLE_USER",
      "messageId": "msg-1",
      "parts": [
        { "text": "hello", "mediaType": "text/plain" }
      ]
    }
  }
}
```

Validation rules:

| Field | Rule |
| --- | --- |
| `params.message` | Required object. |
| `message.role` | Must be `"ROLE_USER"`. |
| `message.messageId` | Required non-empty string. |
| `message.parts` | Required array with at least one non-empty text part. |
| `message.contextId` | Optional string; echoed on the returned task only. |
| `message.taskId` | Must be absent in v1. |
| `params.configuration`, `params.metadata` | Optional and ignored. |

Success response:

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "task": {
      "id": "<uuid v4>",
      "contextId": "<echoed if provided>",
      "status": {
        "state": "TASK_STATE_COMPLETED",
        "message": {
          "role": "ROLE_AGENT",
          "parts": [{ "text": "<reply>", "mediaType": "text/plain" }]
        },
        "timestamp": "<iso8601>"
      },
      "artifacts": [
        {
          "name": "reply",
          "parts": [{ "text": "<reply>", "mediaType": "text/plain" }]
        }
      ],
      "history": []
    }
  }
}
```

The reply text appears in both `status.message.parts[0].text` and `artifacts[0].parts[0].text`.

Subagent errors and timeouts return JSON-RPC `-32000`. Timeout messages are exactly `Subagent timed out after <ms>ms`.

## GetTask

Look up a task by id. The store is in-process and FIFO-bounded by `maxTasks`.

Request:

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

Success response uses the same `task` shape as `SendMessage`. Unknown, evicted, or post-restart task ids return:

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

## Error codes

| Code | Name | When |
| --- | --- | --- |
| `-32700` | Parse error | Request body is not valid JSON. |
| `-32600` | Invalid Request | JSON-RPC envelope is invalid, body exceeds 1 MiB, or method is not `POST`. |
| `-32601` | Method not found | Unsupported or unrecognized method. |
| `-32602` | Invalid params | `SendMessage` or `GetTask` validation failed. |
| `-32000` | Server error | Subagent run rejected, errored, returned no usable reply, or timed out. |
| `-32001` | TaskNotFoundError | Task id is unknown, evicted, or lost on restart. |

## Unsupported in v1

The following methods return `-32601 Method not found: <method>`:

- `CancelTask`
- `SendStreamingMessage`
- `SubscribeToTask`
- `ListTasks`
- `CreateTaskPushNotificationConfig`
- `GetTaskPushNotificationConfig`
- `ListTaskPushNotificationConfigs`
- `DeleteTaskPushNotificationConfig`
- `GetExtendedAgentCard`

## Worked example

```sh
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
        "parts": [{ "text": "summarise A2A", "mediaType": "text/plain" }]
      }
    }
  }')

TASK_ID=$(echo "$RESPONSE" | jq -r '.result.task.id')

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
