import { invalidParams, taskNotFound } from "./errors.js";
import type { InMemoryTaskStore } from "./task-store.js";
import type { GetTaskParams, Task } from "./types.js";

export function getTask(
  params: unknown,
  store: InMemoryTaskStore,
): { task: Task } {
  if (params === null || typeof params !== "object") {
    throw invalidParams("params must be an object");
  }
  const gt = params as GetTaskParams;
  if (typeof gt.id !== "string" || gt.id.length === 0) {
    throw invalidParams("id is required");
  }
  const task = store.get(gt.id);
  if (!task) throw taskNotFound();
  return { task };
}
