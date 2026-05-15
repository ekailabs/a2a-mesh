export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_SERVER_ERROR = -32000;
export const A2A_TASK_NOT_FOUND = -32001;

export class JsonRpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = "JsonRpcError";
  }
}

export function parseError(message = "Parse error"): JsonRpcError {
  return new JsonRpcError(JSON_RPC_PARSE_ERROR, message);
}

export function invalidRequest(message = "Invalid Request"): JsonRpcError {
  return new JsonRpcError(JSON_RPC_INVALID_REQUEST, message);
}

export function methodNotFound(method: string): JsonRpcError {
  return new JsonRpcError(JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
}

export function invalidParams(message: string): JsonRpcError {
  return new JsonRpcError(JSON_RPC_INVALID_PARAMS, message);
}

export function serverError(message: string): JsonRpcError {
  return new JsonRpcError(JSON_RPC_SERVER_ERROR, message);
}

export function taskNotFound(): JsonRpcError {
  return new JsonRpcError(A2A_TASK_NOT_FOUND, "TaskNotFoundError");
}
