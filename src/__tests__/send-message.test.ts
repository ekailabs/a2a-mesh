import { describe, expect, it, vi } from "vitest";
import { JsonRpcError } from "../errors.js";
import { sendMessage } from "../send-message.js";
import { subagentTimeoutMessage } from "../strings.js";
import type { SubagentRunContract } from "../subagent-runtime.js";
import { InMemoryTaskStore } from "../task-store.js";

type FakeRuntimeOverrides = Partial<SubagentRunContract>;

function makeFakeRuntime(overrides: FakeRuntimeOverrides = {}): SubagentRunContract {
  return {
    run: overrides.run ?? vi.fn(async () => ({ runId: "run-1" })),
    waitForRun: overrides.waitForRun ?? vi.fn(async () => ({ status: "ok" as const })),
    getSessionMessages:
      overrides.getSessionMessages ??
      vi.fn(async () => ({
        messages: [{ role: "assistant", content: "hello" }],
      })),
    deleteSession: overrides.deleteSession ?? vi.fn(async () => {}),
  };
}

function makeDeps(overrides: FakeRuntimeOverrides = {}, timeoutMs = 60_000) {
  return {
    agentId: "alpha",
    subagentTimeoutMs: timeoutMs,
    subagent: makeFakeRuntime(overrides),
    store: new InMemoryTaskStore(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

const goodParams = {
  message: {
    role: "ROLE_USER",
    messageId: "m-1",
    parts: [{ text: "hello world" }],
  },
};

describe("sendMessage validation", () => {
  it("rejects when params is not an object", async () => {
    await expect(sendMessage("nope" as unknown, makeDeps())).rejects.toMatchObject({
      code: -32602,
    });
  });

  it("rejects when message is missing", async () => {
    await expect(sendMessage({}, makeDeps())).rejects.toMatchObject({ code: -32602 });
  });

  it("rejects when role is not ROLE_USER", async () => {
    await expect(
      sendMessage(
        { message: { role: "ROLE_AGENT", messageId: "x", parts: [{ text: "x" }] } },
        makeDeps(),
      ),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it("rejects when messageId is missing", async () => {
    await expect(
      sendMessage(
        { message: { role: "ROLE_USER", parts: [{ text: "x" }] } },
        makeDeps(),
      ),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it("rejects when taskId is supplied", async () => {
    await expect(
      sendMessage(
        {
          message: {
            role: "ROLE_USER",
            messageId: "m-1",
            taskId: "t-1",
            parts: [{ text: "x" }],
          },
        },
        makeDeps(),
      ),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it("rejects when no text parts are present", async () => {
    await expect(
      sendMessage(
        {
          message: {
            role: "ROLE_USER",
            messageId: "m-1",
            parts: [{ mediaType: "image/png" }],
          },
        },
        makeDeps(),
      ),
    ).rejects.toMatchObject({ code: -32602 });
  });
});

describe("sendMessage happy path", () => {
  it("completes a task and returns reply artifact", async () => {
    const deps = makeDeps();
    const result = await sendMessage(goodParams, deps);
    expect(result.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(result.task.artifacts).toHaveLength(1);
    expect(result.task.artifacts[0]!.name).toBe("reply");
    expect(result.task.artifacts[0]!.parts[0]!.text).toBe("hello");
    expect(result.task.status.message.role).toBe("ROLE_AGENT");
    expect(result.task.status.message.parts[0]!.text).toBe("hello");
  });

  it("constructs sessionKey with the agent id and task id", async () => {
    type RunFn = SubagentRunContract["run"];
    const runSpy: RunFn = vi.fn(async () => ({ runId: "r-1" }));
    const deps = makeDeps({ run: runSpy });
    const result = await sendMessage(goodParams, deps);
    const mocked = runSpy as unknown as { mock: { calls: Array<Parameters<RunFn>> } };
    expect(mocked.mock.calls).toHaveLength(1);
    const call = mocked.mock.calls[0]![0];
    expect(call.sessionKey).toBe(`agent:alpha:a2a-${result.taskId}`);
    expect(call.message).toBe("hello world");
    expect(call.deliver).toBe(false);
  });

  it("best-effort deletes the session after success", async () => {
    const deleteSpy = vi.fn(async () => {});
    const deps = makeDeps({ deleteSession: deleteSpy });
    await sendMessage(goodParams, deps);
    // settle the microtask queue so the void-deletion runs
    await new Promise((r) => setImmediate(r));
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it("does not change response when deleteSession rejects; logs a warn", async () => {
    const deps = makeDeps({
      deleteSession: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const result = await sendMessage(goodParams, deps);
    expect(result.task.status.state).toBe("TASK_STATE_COMPLETED");
    await new Promise((r) => setImmediate(r));
    expect(deps.logger.warn).toHaveBeenCalled();
  });
});

describe("sendMessage error mapping", () => {
  it("returns -32000 with the timeout text on wait timeout", async () => {
    const deps = makeDeps({
      waitForRun: vi.fn(async () => ({ status: "timeout" as const })),
    });
    const err = await sendMessage(goodParams, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JsonRpcError);
    if (err instanceof JsonRpcError) {
      expect(err.code).toBe(-32000);
      expect(err.message).toBe(subagentTimeoutMessage(60_000));
    }
  });

  it("returns -32000 when run() throws", async () => {
    const deps = makeDeps({
      run: vi.fn(async () => {
        throw new Error("spawn rejected");
      }),
    });
    const err = await sendMessage(goodParams, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JsonRpcError);
    if (err instanceof JsonRpcError) {
      expect(err.code).toBe(-32000);
      expect(err.message).toBe("spawn rejected");
    }
  });

  it("returns -32000 and stores FAILED when waitForRun() throws", async () => {
    const deleteSpy = vi.fn(async () => {});
    const deps = makeDeps({
      waitForRun: vi.fn(async () => {
        throw new Error("wait crashed");
      }),
      deleteSession: deleteSpy,
    });
    const failSpy = vi.spyOn(deps.store, "fail");
    const err = await sendMessage(goodParams, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JsonRpcError);
    if (err instanceof JsonRpcError) {
      expect(err.code).toBe(-32000);
      expect(err.message).toBe("wait crashed");
    }
    expect(failSpy).toHaveBeenCalledTimes(1);
    expect(failSpy.mock.calls[0]![1]).toBe("wait crashed");
    await new Promise((r) => setImmediate(r));
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it("returns -32000 when wait status is 'error'", async () => {
    const deps = makeDeps({
      waitForRun: vi.fn(async () => ({ status: "error" as const, error: "kaboom" })),
    });
    const err = await sendMessage(goodParams, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JsonRpcError);
    if (err instanceof JsonRpcError) {
      expect(err.code).toBe(-32000);
      expect(err.message).toBe("kaboom");
    }
  });

  it("returns -32000 when no assistant reply is found", async () => {
    const deps = makeDeps({
      getSessionMessages: vi.fn(async () => ({
        messages: [{ role: "user", content: "q" }],
      })),
    });
    const err = await sendMessage(goodParams, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JsonRpcError);
    if (err instanceof JsonRpcError) {
      expect(err.code).toBe(-32000);
      expect(err.message).toBe("No assistant reply found in session");
    }
  });

  it("stores TASK_STATE_FAILED on timeout", async () => {
    const deps = makeDeps({
      waitForRun: vi.fn(async () => ({ status: "timeout" as const })),
    });
    const failSpy = vi.spyOn(deps.store, "fail");
    await sendMessage(goodParams, deps).catch(() => undefined);
    expect(failSpy).toHaveBeenCalledTimes(1);
    const [taskId, text] = failSpy.mock.calls[0]!;
    expect(deps.store.state(taskId)).toBe("TASK_STATE_FAILED");
    expect(text).toBe(subagentTimeoutMessage(60_000));
  });
});
