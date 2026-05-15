import type { IncomingMessage, ServerResponse } from "node:http";
import { MAX_BODY_BYTES, readRequestBody } from "./body-reader.js";
import {
  JSON_RPC_INVALID_REQUEST,
  JsonRpcError,
  methodNotFound,
  serverError,
} from "./errors.js";
import { getTask } from "./get-task.js";
import { errorEnvelope, parseJsonRpc, successEnvelope, type JsonRpcId } from "./json-rpc.js";
import { logError, logInfo, type LoggerLike } from "./logging.js";
import { sendMessage } from "./send-message.js";
import type { SubagentRunContract } from "./subagent-runtime.js";
import type { InMemoryTaskStore } from "./task-store.js";

const UNSUPPORTED_METHODS = new Set<string>([
  "CancelTask",
  "SendStreamingMessage",
  "SubscribeToTask",
  "ListTasks",
  "CreateTaskPushNotificationConfig",
  "GetTaskPushNotificationConfig",
  "ListTaskPushNotificationConfigs",
  "DeleteTaskPushNotificationConfig",
  "GetExtendedAgentCard",
]);

export type A2aHandlerDeps = {
  agentId: string;
  subagentTimeoutMs: number;
  subagent: SubagentRunContract;
  store: InMemoryTaskStore;
  logger: LoggerLike;
  /** Override for tests; defaults to MAX_BODY_BYTES. */
  maxBodyBytes?: number;
};

export function createJsonRpcHandler(
  deps: A2aHandlerDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<true> {
  return async (req, res) => {
    const startedAt = Date.now();
    const callerHost = headerString(req.headers["host"]);
    logInfo(deps.logger, "request_received", { caller_host: callerHost });

    if (req.method !== "POST") {
      respond(res, 405, errorEnvelope(null, JSON_RPC_INVALID_REQUEST, "Method Not Allowed"));
      logError(deps.logger, "request_error", {
        error_class: "HttpMethodNotAllowed",
        error_message: `Method ${req.method ?? "?"} not allowed`,
        jsonrpc_code: JSON_RPC_INVALID_REQUEST,
      });
      return true;
    }

    const bodyResult = await readRequestBody(req, {
      maxBytes: deps.maxBodyBytes ?? MAX_BODY_BYTES,
    });
    if (!bodyResult.ok) {
      const message = bodyResult.message;
      if (bodyResult.reason !== "client-disconnect") {
        respond(res, 400, errorEnvelope(null, JSON_RPC_INVALID_REQUEST, message));
      }
      logError(deps.logger, "request_error", {
        error_class: bodyErrorClass(bodyResult.reason),
        error_message: message,
        jsonrpc_code: JSON_RPC_INVALID_REQUEST,
      });
      return true;
    }

    const parse = parseJsonRpc(bodyResult.body);
    if (!parse.ok) {
      respond(res, 200, errorEnvelope(parse.id, parse.error.code, parse.error.message));
      logError(deps.logger, "request_error", {
        caller_host: callerHost,
        error_class: "JsonRpcError",
        error_message: parse.error.message,
        jsonrpc_code: parse.error.code,
      });
      return true;
    }

    const { id, method, params } = parse.request;
    logInfo(deps.logger, "request_in", { method, caller_host: callerHost });

    try {
      const result = await dispatch(method, params, deps);
      respond(res, 200, successEnvelope(id, result.body));
      logInfo(deps.logger, "request_done", {
        method,
        taskId: result.taskId,
        status: "ok",
        latency_ms: Date.now() - startedAt,
      });
    } catch (err) {
      const jrErr = toJsonRpcError(err);
      respond(res, 200, errorEnvelope(id, jrErr.code, jrErr.message));
      logError(deps.logger, "request_error", {
        method,
        error_class: jrErr.name,
        error_message: jrErr.message,
        jsonrpc_code: jrErr.code,
      });
    }
    return true;
  };
}

type DispatchResult = { body: unknown; taskId?: string };

async function dispatch(
  method: string,
  params: unknown,
  deps: A2aHandlerDeps,
): Promise<DispatchResult> {
  switch (method) {
    case "SendMessage": {
      const out = await sendMessage(params, {
        agentId: deps.agentId,
        subagentTimeoutMs: deps.subagentTimeoutMs,
        subagent: deps.subagent,
        store: deps.store,
        logger: deps.logger,
      });
      return { body: { task: out.task }, taskId: out.taskId };
    }
    case "GetTask": {
      const out = getTask(params, deps.store);
      return { body: { task: out.task }, taskId: out.task.id };
    }
    default: {
      if (UNSUPPORTED_METHODS.has(method)) throw methodNotFound(method);
      throw methodNotFound(method);
    }
  }
}

function toJsonRpcError(err: unknown): JsonRpcError {
  if (err instanceof JsonRpcError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return serverError(message);
}

function respond(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(body);
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

function bodyErrorClass(
  reason: "too-large" | "read-error" | "client-disconnect" | "timeout",
): string {
  switch (reason) {
    case "too-large":
      return "BodyTooLarge";
    case "timeout":
      return "BodyReadTimeout";
    case "client-disconnect":
      return "ClientDisconnect";
    case "read-error":
    default:
      return "BodyReadError";
  }
}

export type AgentCardHandlerDeps = {
  buildCard: (req: IncomingMessage) => unknown;
  logger: LoggerLike;
};

export function createAgentCardHandler(
  deps: AgentCardHandlerDeps,
): (req: IncomingMessage, res: ServerResponse) => true {
  return (req, res) => {
    if (req.method !== "GET") {
      respond(res, 405, JSON.stringify({ error: "Method Not Allowed" }));
      return true;
    }
    try {
      const card = deps.buildCard(req);
      respond(res, 200, JSON.stringify(card));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      respond(res, 500, JSON.stringify({ error: message }));
      logError(deps.logger, "agent_card_error", { error_message: message });
    }
    return true;
  };
}

// Re-export for tests.
export type JsonRpcResponseId = JsonRpcId;
