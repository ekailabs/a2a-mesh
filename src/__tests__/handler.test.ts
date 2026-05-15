import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createJsonRpcHandler } from "../handler.js";
import type { SubagentRunContract } from "../subagent-runtime.js";
import { InMemoryTaskStore } from "../task-store.js";

type CapturedResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  res: ServerResponse;
};

function makeRes(): CapturedResponse {
  const captured: CapturedResponse = {
    statusCode: 0,
    headers: {},
    body: "",
    res: undefined as unknown as ServerResponse,
  };
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
    },
    end(chunk: string) {
      captured.statusCode = (this as { statusCode: number }).statusCode;
      captured.body = typeof chunk === "string" ? chunk : "";
    },
  } as unknown as ServerResponse;
  captured.res = res;
  return captured;
}

type FakeReqOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  emitError?: Error;
};

class FakeReq extends EventEmitter {
  method: string;
  headers: Record<string, string>;
  socket = { encrypted: false };
  destroyed = false;
  constructor(opts: FakeReqOptions) {
    super();
    this.method = opts.method ?? "POST";
    this.headers = opts.headers ?? { host: "test.local" };
    setImmediate(() => {
      if (opts.emitError) {
        this.emit("error", opts.emitError);
        return;
      }
      if (opts.body !== undefined) {
        const buf = typeof opts.body === "string" ? Buffer.from(opts.body) : opts.body;
        this.emit("data", buf);
      }
      this.emit("end");
    });
  }
  destroy() {
    this.destroyed = true;
    this.emit("end");
  }
}

function makeReq(opts: FakeReqOptions = {}): IncomingMessage {
  return new FakeReq(opts) as unknown as IncomingMessage;
}

function makeDeps(subagentOverrides: Partial<SubagentRunContract> = {}) {
  const subagent: SubagentRunContract = {
    run: subagentOverrides.run ?? vi.fn(async () => ({ runId: "r-1" })),
    waitForRun:
      subagentOverrides.waitForRun ?? vi.fn(async () => ({ status: "ok" as const })),
    getSessionMessages:
      subagentOverrides.getSessionMessages ??
      vi.fn(async () => ({
        messages: [{ role: "assistant", content: "hi" }],
      })),
    deleteSession: subagentOverrides.deleteSession ?? vi.fn(async () => {}),
  };
  return {
    agentId: "alpha",
    subagentTimeoutMs: 60_000,
    subagent,
    store: new InMemoryTaskStore(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

const validSend = JSON.stringify({
  jsonrpc: "2.0",
  id: "req-1",
  method: "SendMessage",
  params: {
    message: { role: "ROLE_USER", messageId: "m-1", parts: [{ text: "hi" }] },
  },
});

describe("createJsonRpcHandler — happy path", () => {
  it("returns a SendMessage response with TASK_STATE_COMPLETED", async () => {
    const deps = makeDeps();
    const handler = createJsonRpcHandler(deps);
    const captured = makeRes();
    await handler(makeReq({ body: validSend }), captured.res);
    expect(captured.headers["content-type"]).toBe("application/json; charset=utf-8");
    const out = JSON.parse(captured.body) as {
      id: unknown;
      result?: { task: { status: { state: string } } };
    };
    expect(out.id).toBe("req-1");
    expect(out.result?.task.status.state).toBe("TASK_STATE_COMPLETED");
  });

  it("emits an entry log and a completion log per request", async () => {
    const deps = makeDeps();
    const handler = createJsonRpcHandler(deps);
    const captured = makeRes();
    await handler(makeReq({ body: validSend }), captured.res);
    const infoLines = (deps.logger.info as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    expect(infoLines.some((l) => l.includes("request_in"))).toBe(true);
    expect(infoLines.some((l) => l.includes("request_done"))).toBe(true);
  });
});

describe("createJsonRpcHandler — JSON-RPC errors", () => {
  it("malformed JSON => id:null, code -32700", async () => {
    const deps = makeDeps();
    const handler = createJsonRpcHandler(deps);
    const captured = makeRes();
    await handler(makeReq({ body: "not json" }), captured.res);
    const out = JSON.parse(captured.body) as { id: unknown; error: { code: number } };
    expect(out.id).toBeNull();
    expect(out.error.code).toBe(-32700);
  });

  it("bad envelope without id => id:null, code -32600", async () => {
    const deps = makeDeps();
    const handler = createJsonRpcHandler(deps);
    const captured = makeRes();
    await handler(makeReq({ body: JSON.stringify({}) }), captured.res);
    const out = JSON.parse(captured.body) as { id: unknown; error: { code: number } };
    expect(out.id).toBeNull();
    expect(out.error.code).toBe(-32600);
  });

  it("bad envelope with id => echoed id, code -32600", async () => {
    const deps = makeDeps();
    const handler = createJsonRpcHandler(deps);
    const captured = makeRes();
    await handler(
      makeReq({ body: JSON.stringify({ id: 9, jsonrpc: "1.0" }) }),
      captured.res,
    );
    const out = JSON.parse(captured.body) as { id: unknown; error: { code: number } };
    expect(out.id).toBe(9);
    expect(out.error.code).toBe(-32600);
  });

  it("unknown method => -32601 with echoed id and 'Method not found: <method>'", async () => {
    const deps = makeDeps();
    const handler = createJsonRpcHandler(deps);
    const captured = makeRes();
    await handler(
      makeReq({
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "Bogus" }),
      }),
      captured.res,
    );
    const out = JSON.parse(captured.body) as {
      id: unknown;
      error: { code: number; message: string };
    };
    expect(out.id).toBe(3);
    expect(out.error.code).toBe(-32601);
    expect(out.error.message).toBe("Method not found: Bogus");
  });

  for (const method of [
    "CancelTask",
    "SendStreamingMessage",
    "SubscribeToTask",
    "ListTasks",
    "CreateTaskPushNotificationConfig",
    "GetTaskPushNotificationConfig",
    "ListTaskPushNotificationConfigs",
    "DeleteTaskPushNotificationConfig",
    "GetExtendedAgentCard",
  ]) {
    it(`unsupported method ${method} => -32601`, async () => {
      const deps = makeDeps();
      const handler = createJsonRpcHandler(deps);
      const captured = makeRes();
      await handler(
        makeReq({
          body: JSON.stringify({ jsonrpc: "2.0", id: "z", method }),
        }),
        captured.res,
      );
      const out = JSON.parse(captured.body) as {
        id: unknown;
        error: { code: number; message: string };
      };
      expect(out.id).toBe("z");
      expect(out.error.code).toBe(-32601);
      expect(out.error.message).toBe(`Method not found: ${method}`);
    });
  }
});

describe("createJsonRpcHandler — body cap", () => {
  it("destroys the request and returns -32600 when body exceeds cap", async () => {
    const deps = makeDeps();
    const handler = createJsonRpcHandler(deps, );
    const captured = makeRes();
    const tinyCap = 64;
    const handlerWithCap = createJsonRpcHandler({ ...deps, maxBodyBytes: tinyCap });
    const req = makeReq({ body: "x".repeat(tinyCap + 100) });
    await handlerWithCap(req, captured.res);
    const out = JSON.parse(captured.body) as { id: unknown; error: { code: number } };
    expect(out.id).toBeNull();
    expect(out.error.code).toBe(-32600);
    expect((req as unknown as { destroyed: boolean }).destroyed).toBe(true);
    void handler; // silence unused
  });
});

describe("createJsonRpcHandler — entry log on early failures", () => {
  function infoLinesOf(deps: ReturnType<typeof makeDeps>): string[] {
    return (deps.logger.info as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
  }

  it("emits request_received on malformed JSON; request_in does not fire", async () => {
    const deps = makeDeps();
    const handler = createJsonRpcHandler(deps);
    await handler(makeReq({ body: "not json" }), makeRes().res);
    const lines = infoLinesOf(deps);
    expect(lines.some((l) => l.includes("request_received"))).toBe(true);
    expect(lines.some((l) => l.includes("request_in"))).toBe(false);
  });

  it("emits request_received on body overflow", async () => {
    const deps = makeDeps();
    const handler = createJsonRpcHandler({ ...deps, maxBodyBytes: 16 });
    await handler(makeReq({ body: "x".repeat(100) }), makeRes().res);
    expect(infoLinesOf(deps).some((l) => l.includes("request_received"))).toBe(true);
  });

  it("emits request_received on non-POST", async () => {
    const deps = makeDeps();
    const handler = createJsonRpcHandler(deps);
    await handler(makeReq({ method: "GET" }), makeRes().res);
    expect(infoLinesOf(deps).some((l) => l.includes("request_received"))).toBe(true);
  });

  it("emits request_received and request_in (with method) on unknown method, plus error", async () => {
    const deps = makeDeps();
    const handler = createJsonRpcHandler(deps);
    await handler(
      makeReq({
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "Nope" }),
      }),
      makeRes().res,
    );
    const lines = infoLinesOf(deps);
    expect(lines.some((l) => l.includes("request_received"))).toBe(true);
    const requestIn = lines.find((l) => l.includes("request_in"));
    expect(requestIn).toBeDefined();
    expect(requestIn!.includes("\"method\":\"Nope\"")).toBe(true);
    const errorLines = (deps.logger.error as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    expect(errorLines.some((l) => l.includes("request_error"))).toBe(true);
  });
});

describe("createJsonRpcHandler — method routing", () => {
  it("returns 405 envelope for non-POST", async () => {
    const deps = makeDeps();
    const handler = createJsonRpcHandler(deps);
    const captured = makeRes();
    await handler(makeReq({ method: "GET" }), captured.res);
    const out = JSON.parse(captured.body) as { error: { code: number } };
    expect(out.error.code).toBe(-32600);
  });
});

describe("createJsonRpcHandler — GetTask", () => {
  it("returns -32001 for unknown task id", async () => {
    const deps = makeDeps();
    const handler = createJsonRpcHandler(deps);
    const captured = makeRes();
    await handler(
      makeReq({
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "GetTask",
          params: { id: "missing" },
        }),
      }),
      captured.res,
    );
    const out = JSON.parse(captured.body) as { error: { code: number; message: string } };
    expect(out.error.code).toBe(-32001);
    expect(out.error.message).toBe("TaskNotFoundError");
  });
});
