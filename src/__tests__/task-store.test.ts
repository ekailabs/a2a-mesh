import { describe, expect, it } from "vitest";
import { InMemoryTaskStore } from "../task-store.js";

describe("InMemoryTaskStore", () => {
  it("evicts oldest tasks when size exceeds maxTasks", () => {
    const store = new InMemoryTaskStore({ maxTasks: 3 });
    const a = store.create({});
    const b = store.create({});
    const c = store.create({});
    expect(store.size()).toBe(3);
    expect(store.get(a.id)).toBeDefined();

    const d = store.create({});
    expect(store.size()).toBe(3);
    expect(store.get(a.id)).toBeUndefined(); // oldest evicted
    expect(store.get(b.id)).toBeDefined();
    expect(store.get(c.id)).toBeDefined();
    expect(store.get(d.id)).toBeDefined();
  });

  it("treats maxTasks below 1 as 1", () => {
    const store = new InMemoryTaskStore({ maxTasks: 0 });
    const a = store.create({});
    expect(store.size()).toBe(1);
    expect(store.get(a.id)).toBeDefined();
    const b = store.create({});
    expect(store.size()).toBe(1);
    expect(store.get(a.id)).toBeUndefined();
    expect(store.get(b.id)).toBeDefined();
  });

  it("preserves completion/failure state until eviction", () => {
    const store = new InMemoryTaskStore({ maxTasks: 2 });
    const a = store.create({});
    store.complete(a.id, "done");
    expect(store.state(a.id)).toBe("TASK_STATE_COMPLETED");
    store.create({});
    expect(store.state(a.id)).toBe("TASK_STATE_COMPLETED");
    store.create({});
    expect(store.get(a.id)).toBeUndefined();
  });
});
