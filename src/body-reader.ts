import type { IncomingMessage } from "node:http";

export const MAX_BODY_BYTES = 1024 * 1024;
export const DEFAULT_READ_TIMEOUT_MS = 30_000;

export type BodyReadResult =
  | { ok: true; body: string }
  | {
      ok: false;
      reason: "too-large" | "read-error" | "client-disconnect" | "timeout";
      message: string;
    };

export type BodyReadOptions = {
  maxBytes?: number;
  /** If >0, abort the read after this many milliseconds without `end`. */
  timeoutMs?: number;
};

export function readRequestBody(
  req: IncomingMessage,
  options: BodyReadOptions = {},
): Promise<BodyReadResult> {
  const maxBytes = options.maxBytes ?? MAX_BODY_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const onData = (chunk: Buffer | string): void => {
      if (settled) return;
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      received += buf.length;
      if (received > maxBytes) {
        chunks.length = 0;
        settle({
          ok: false,
          reason: "too-large",
          message: `Request body exceeds ${maxBytes} bytes`,
        });
        req.destroy();
        return;
      }
      chunks.push(buf);
    };

    const onEnd = (): void => {
      if (settled) return;
      settle({ ok: true, body: Buffer.concat(chunks).toString("utf8") });
    };

    const onError = (err: Error): void => {
      settle({ ok: false, reason: "read-error", message: err.message });
    };

    const onClose = (): void => {
      if (settled) return;
      // 'close' without prior 'end' means the client disconnected mid-body.
      settle({
        ok: false,
        reason: "client-disconnect",
        message: "Client disconnected before completing the request",
      });
    };

    const onAborted = (): void => {
      if (settled) return;
      settle({
        ok: false,
        reason: "client-disconnect",
        message: "Client aborted the request",
      });
    };

    const settle = (result: BodyReadResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("close", onClose);
      req.off("aborted", onAborted);
      resolve(result);
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("close", onClose);
    req.on("aborted", onAborted);

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settle({
          ok: false,
          reason: "timeout",
          message: `Body read timed out after ${timeoutMs}ms`,
        });
        req.destroy();
      }, timeoutMs);
    }
  });
}
