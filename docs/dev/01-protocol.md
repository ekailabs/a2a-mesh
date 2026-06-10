# Protocol

`@ekai/a2a` exposes the A2A JSON-RPC binding over HTTP. v1 supports public agent-card discovery, `SendMessage`, and `GetTask`.

## Routes

| Path | Method | Auth | Behavior |
| --- | --- | --- | --- |
| `<cfg.path>` | `POST` | OpenClaw gateway auth | JSON-RPC endpoint. Default path is `/a2a`. |
| `/.well-known/agent-card.json` | `GET` | Public plugin route | A2A discovery endpoint. |

## Agent card

The served card contains:

| Field | Value |
| --- | --- |
| `name` | `cfg.cardName ?? agent.name ?? agent.id` |
| `description` | `cfg.cardDescription ?? "A2A interface to OpenClaw agent '<name>'."` |
| `version` | `cfg.cardVersion ?? package version` |
| `supportedInterfaces[0].url` | `cfg.cardUrl`, or derived request URL plus `cfg.path` |
| `supportedInterfaces[0].protocolBinding` | `"JSONRPC"` |
| `supportedInterfaces[0].protocolVersion` | `"1.0"` |
| `capabilities.streaming` | `false` |
| `capabilities.pushNotifications` | `false` |
| `defaultInputModes` | `["text/plain"]` |
| `defaultOutputModes` | `["text/plain"]` |
| `skills` | `[]` |

When `advertiseBearerAuth` is `true`, the card also contains `securitySchemes.bearerAuth` and `security: [{ "bearerAuth": [] }]`.

## SendMessage

Inputs:

| Param | Required | Rule |
| --- | --- | --- |
| `message.role` | Yes | Must be `"ROLE_USER"`. |
| `message.messageId` | Yes | Non-empty string. |
| `message.parts` | Yes | Must include at least one text part. |
| `message.contextId` | No | Echoed on the returned task only. |
| `message.taskId` | No | Rejected in v1 when present. |
| `configuration`, `metadata` | No | Accepted and ignored. |

Behavior:

1. Validate the JSON-RPC envelope and params.
2. Concatenate text parts into the prompt.
3. Allocate a UUID task id and store the task as `TASK_STATE_WORKING`.
4. Run `api.runtime.subagent.run` with `deliver: false`.
5. Wait with `api.runtime.subagent.waitForRun({ timeoutMs: subagentTimeoutMs })`.
6. Read the latest assistant reply from `api.runtime.subagent.getSessionMessages`.
7. Store and return a `TASK_STATE_COMPLETED` task with the reply in both `status.message` and one `"reply"` artifact.
8. Best-effort delete the per-task subagent session.

On subagent failure, timeout, or missing assistant reply, the plugin stores a failed task and returns JSON-RPC `-32000`.

## GetTask

Inputs:

| Param | Required | Rule |
| --- | --- | --- |
| `id` | Yes | Task id string. |
| `historyLength` | No | Accepted and ignored. |

The method returns the stored task as-is. Unknown, evicted, or post-restart task ids return `-32001 TaskNotFoundError`.

## Task model

| Field | Notes |
| --- | --- |
| `id` | UUIDv4. |
| `contextId` | Echoed from the request if present. |
| `status.state` | `TASK_STATE_WORKING`, `TASK_STATE_COMPLETED`, or `TASK_STATE_FAILED`. |
| `status.message` | Reply text on completion, error text on failure. |
| `status.timestamp` | ISO 8601 timestamp for the state transition. |
| `artifacts` | One `"reply"` artifact on completion; empty on failure. |
| `history` | Always empty in v1. |

Tasks are stored in process memory and evicted FIFO after `maxTasks`.

## Error envelope

All errors use standard JSON-RPC error objects:

| Code | Message | Cause |
| --- | --- | --- |
| `-32700` | `Parse error` | Body is not valid JSON. |
| `-32600` | `Invalid Request` | JSON-RPC envelope is invalid, body exceeds 1 MiB, or HTTP method is invalid. |
| `-32601` | `Method not found: <method>` | Unsupported or unknown method. |
| `-32602` | Descriptive | Missing or invalid params. |
| `-32000` | Descriptive | Subagent rejected, errored, returned no reply, or timed out. |
| `-32001` | `TaskNotFoundError` | Task id not found. |

Timeout messages are exactly `Subagent timed out after <ms>ms`.

## Unsupported methods

These methods return `-32601` in v1:

- `CancelTask`
- `SendStreamingMessage`
- `SubscribeToTask`
- `ListTasks`
- `CreateTaskPushNotificationConfig`
- `GetTaskPushNotificationConfig`
- `ListTaskPushNotificationConfigs`
- `DeleteTaskPushNotificationConfig`
- `GetExtendedAgentCard`

## Conformance

| Surface | v1 status |
| --- | --- |
| HTTP + JSON-RPC 2.0 | Supported. |
| HTTP REST | Future. |
| gRPC | Future. |
| SSE streaming | Future. |
| Text parts | Supported inbound and outbound. |
| File/data parts | Future. |
| `TASK_STATE_COMPLETED` and `TASK_STATE_FAILED` | Supported. |
| `TASK_STATE_INPUT_REQUIRED`, `AUTH_REQUIRED`, `CANCELED`, `REJECTED` | Not used in v1. |
| OpenClaw gateway auth | Required for JSON-RPC route. |
| A2A-native OAuth2/OIDC/mTLS/Basic auth | Future. |
