import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildAgentCard } from "../src/agent-card.js";
import { parseConfig } from "../src/config.js";
import { createAgentCardHandler, createJsonRpcHandler } from "../src/handler.js";
import type { SubagentRunContract } from "../src/subagent-runtime.js";
import { InMemoryTaskStore } from "../src/task-store.js";

type SubagentScript = {
  reply: string;
};

function makeScriptedRuntime(script: SubagentScript): SubagentRunContract {
  return {
    run: vi.fn(async () => ({ runId: "run-e2e" })),
    waitForRun: vi.fn(async () => ({ status: "ok" as const })),
    getSessionMessages: vi.fn(async () => ({
      messages: [
        { role: "user", content: "previous prompt" },
        { role: "assistant", content: script.reply },
      ],
    })),
    deleteSession: vi.fn(async () => {}),
  };
}

const cfg = parseConfig({});
const agentId = "alpha";

function listenServer(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(addr.port);
    });
  });
}

describe("e2e smoke", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const store = new InMemoryTaskStore();
    const subagent = makeScriptedRuntime({ reply: "world!" });
    const jsonRpcHandler = createJsonRpcHandler({
      agentId,
      subagentTimeoutMs: 60_000,
      subagent,
      store,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const cardHandler = createAgentCardHandler({
      buildCard: (req: IncomingMessage) =>
        buildAgentCard({ cfg, agentName: "Alpha" }, req),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "/";
      if (url === "/.well-known/agent-card.json") {
        cardHandler(req, res);
        return;
      }
      if (url === cfg.path) {
        await jsonRpcHandler(req, res);
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });
    port = await listenServer(server);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /.well-known/agent-card.json returns a card with the served URL", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/.well-known/agent-card.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body = (await response.json()) as {
      name: string;
      supportedInterfaces: Array<{ url: string }>;
      capabilities: { streaming: boolean; pushNotifications: boolean };
    };
    expect(body.name).toBe("Alpha");
    expect(body.supportedInterfaces[0]!.url).toBe(`http://127.0.0.1:${port}/a2a`);
    expect(body.capabilities.streaming).toBe(false);
    expect(body.capabilities.pushNotifications).toBe(false);
  });

  it("POST /a2a SendMessage completes a task with the reply text", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/a2a`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "SendMessage",
        params: {
          message: {
            role: "ROLE_USER",
            messageId: "abc",
            parts: [{ text: "hello", mediaType: "text/plain" }],
          },
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      jsonrpc: string;
      id: unknown;
      result: {
        task: {
          status: { state: string; message: { parts: Array<{ text: string }> } };
          artifacts: Array<{ name: string; parts: Array<{ text: string }> }>;
        };
      };
    };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe("1");
    expect(body.result.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(body.result.task.status.message.parts[0]!.text).toBe("world!");
    expect(body.result.task.artifacts[0]!.name).toBe("reply");
    expect(body.result.task.artifacts[0]!.parts[0]!.text).toBe("world!");
  });

  it("POST /a2a with unknown method returns -32601", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/a2a`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "DoesNotExist" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toBe("Method not found: DoesNotExist");
  });
});
