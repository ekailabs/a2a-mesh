import {
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_PARSE_ERROR,
  JsonRpcError,
} from "./errors.js";

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  id: JsonRpcId;
  method: string;
  params: unknown;
};

export type JsonRpcParseSuccess = {
  ok: true;
  request: JsonRpcRequest;
};

export type JsonRpcParseFailure = {
  ok: false;
  id: JsonRpcId;
  error: JsonRpcError;
};

export type JsonRpcParseResult = JsonRpcParseSuccess | JsonRpcParseFailure;

export function parseJsonRpc(body: string): JsonRpcParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      ok: false,
      id: null,
      error: new JsonRpcError(JSON_RPC_PARSE_ERROR, "Parse error"),
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      id: null,
      error: new JsonRpcError(JSON_RPC_INVALID_REQUEST, "Invalid Request"),
    };
  }
  const obj = parsed as Record<string, unknown>;
  const id = normalizeId(obj["id"]);
  const jsonrpc = obj["jsonrpc"];
  const method = obj["method"];
  if (jsonrpc !== "2.0") {
    return {
      ok: false,
      id,
      error: new JsonRpcError(JSON_RPC_INVALID_REQUEST, "Invalid Request: jsonrpc must be '2.0'"),
    };
  }
  if (typeof method !== "string" || method.length === 0) {
    return {
      ok: false,
      id,
      error: new JsonRpcError(JSON_RPC_INVALID_REQUEST, "Invalid Request: method must be a non-empty string"),
    };
  }
  return {
    ok: true,
    request: { id, method, params: obj["params"] },
  };
}

function normalizeId(raw: unknown): JsonRpcId {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw === null) return null;
  return null;
}

export function successEnvelope(id: JsonRpcId, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

export function errorEnvelope(id: JsonRpcId, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}
