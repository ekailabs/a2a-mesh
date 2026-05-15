import { describe, expect, it } from "vitest";
import { parseJsonRpc, successEnvelope, errorEnvelope } from "../json-rpc.js";

describe("parseJsonRpc", () => {
  it("returns parse error with id:null on bad JSON", () => {
    const res = parseJsonRpc("{not json");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.id).toBeNull();
      expect(res.error.code).toBe(-32700);
      expect(res.error.message).toBe("Parse error");
    }
  });

  it("returns invalid request with id:null when body is not an object", () => {
    const res = parseJsonRpc("[]");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.id).toBeNull();
      expect(res.error.code).toBe(-32600);
    }
  });

  it("echoes parsed id when envelope is bad but id is present", () => {
    const res = parseJsonRpc(JSON.stringify({ id: "abc" }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.id).toBe("abc");
      expect(res.error.code).toBe(-32600);
    }
  });

  it("echoes numeric id from bad envelope", () => {
    const res = parseJsonRpc(JSON.stringify({ id: 42, foo: "bar" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.id).toBe(42);
  });

  it("normalizes non-id types to null", () => {
    const res = parseJsonRpc(JSON.stringify({ id: { obj: 1 }, foo: "bar" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.id).toBeNull();
  });

  it("accepts a valid request", () => {
    const res = parseJsonRpc(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "GetTask", params: { id: "x" } }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.request.id).toBe(1);
      expect(res.request.method).toBe("GetTask");
      expect(res.request.params).toEqual({ id: "x" });
    }
  });

  it("rejects when jsonrpc is not '2.0'", () => {
    const res = parseJsonRpc(JSON.stringify({ jsonrpc: "1.0", id: 1, method: "x" }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.id).toBe(1);
      expect(res.error.code).toBe(-32600);
    }
  });

  it("rejects when method is missing", () => {
    const res = parseJsonRpc(JSON.stringify({ jsonrpc: "2.0", id: "z" }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.id).toBe("z");
      expect(res.error.code).toBe(-32600);
    }
  });
});

describe("envelope encoders", () => {
  it("successEnvelope echoes id and includes result", () => {
    const out = JSON.parse(successEnvelope("xyz", { hello: "world" })) as {
      jsonrpc: string;
      id: unknown;
      result: unknown;
    };
    expect(out.jsonrpc).toBe("2.0");
    expect(out.id).toBe("xyz");
    expect(out.result).toEqual({ hello: "world" });
  });

  it("errorEnvelope shapes code/message", () => {
    const out = JSON.parse(errorEnvelope(null, -32700, "Parse error")) as {
      id: unknown;
      error: { code: number; message: string };
    };
    expect(out.id).toBeNull();
    expect(out.error.code).toBe(-32700);
    expect(out.error.message).toBe("Parse error");
  });

  it("preserves numeric id", () => {
    const out = JSON.parse(successEnvelope(7, { ok: true })) as { id: unknown };
    expect(out.id).toBe(7);
  });
});
