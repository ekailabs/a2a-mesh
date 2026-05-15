import { describe, expect, it } from "vitest";
import { JsonRpcError } from "../errors.js";
import { getTask } from "../get-task.js";
import { InMemoryTaskStore } from "../task-store.js";

describe("getTask", () => {
  it("returns the stored task by id", () => {
    const store = new InMemoryTaskStore();
    const task = store.create({});
    const result = getTask({ id: task.id }, store);
    expect(result.task.id).toBe(task.id);
  });

  it("returns the completed task after complete()", () => {
    const store = new InMemoryTaskStore();
    const task = store.create({});
    store.complete(task.id, "ok");
    const out = getTask({ id: task.id }, store);
    expect(out.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(out.task.artifacts[0]!.name).toBe("reply");
  });

  it("throws -32602 when id is missing", () => {
    const store = new InMemoryTaskStore();
    const err = catchErr(() => getTask({}, store));
    expect(err.code).toBe(-32602);
  });

  it("throws -32602 when params is not an object", () => {
    const store = new InMemoryTaskStore();
    const err = catchErr(() => getTask(null, store));
    expect(err.code).toBe(-32602);
  });

  it("throws -32001 with TaskNotFoundError message when missing", () => {
    const store = new InMemoryTaskStore();
    const err = catchErr(() => getTask({ id: "nope" }, store));
    expect(err.code).toBe(-32001);
    expect(err.message).toBe("TaskNotFoundError");
  });
});

function catchErr(fn: () => void): JsonRpcError {
  try {
    fn();
    throw new Error("expected to throw");
  } catch (err) {
    if (err instanceof JsonRpcError) return err;
    throw err;
  }
}
