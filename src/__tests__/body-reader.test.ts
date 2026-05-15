import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { readRequestBody } from "../body-reader.js";

class FakeReq extends EventEmitter {
  destroyed = false;
  destroy() {
    this.destroyed = true;
  }
}

function asReq(r: FakeReq): IncomingMessage {
  return r as unknown as IncomingMessage;
}

describe("readRequestBody", () => {
  it("resolves with body on normal end", async () => {
    const req = new FakeReq();
    const p = readRequestBody(asReq(req));
    setImmediate(() => {
      req.emit("data", Buffer.from("hello"));
      req.emit("end");
    });
    const r = await p;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toBe("hello");
  });

  it("returns client-disconnect on close before end", async () => {
    const req = new FakeReq();
    const p = readRequestBody(asReq(req));
    setImmediate(() => {
      req.emit("data", Buffer.from("part"));
      req.emit("close");
    });
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("client-disconnect");
  });

  it("returns client-disconnect on aborted", async () => {
    const req = new FakeReq();
    const p = readRequestBody(asReq(req));
    setImmediate(() => req.emit("aborted"));
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("client-disconnect");
  });

  it("returns read-error on error event", async () => {
    const req = new FakeReq();
    const p = readRequestBody(asReq(req));
    setImmediate(() => req.emit("error", new Error("socket reset")));
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("read-error");
      expect(r.message).toBe("socket reset");
    }
  });

  it("returns timeout when no end arrives before timeoutMs", async () => {
    const req = new FakeReq();
    const r = await readRequestBody(asReq(req), { timeoutMs: 20 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("timeout");
    expect(req.destroyed).toBe(true);
  });

  it("does not double-settle when close fires after end", async () => {
    const req = new FakeReq();
    const p = readRequestBody(asReq(req));
    setImmediate(() => {
      req.emit("data", Buffer.from("x"));
      req.emit("end");
      req.emit("close");
    });
    const r = await p;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toBe("x");
  });
});
