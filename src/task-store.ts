import { randomUUID } from "node:crypto";
import type { Artifact, Message, Task, TaskState } from "./types.js";

export type TaskStoreOptions = {
  /** Cap on retained tasks. Oldest by insertion order are evicted past this. */
  maxTasks?: number;
};

const DEFAULT_MAX_TASKS = 10000;

export class InMemoryTaskStore {
  private readonly tasks = new Map<string, Task>();
  private readonly maxTasks: number;

  constructor(options: TaskStoreOptions = {}) {
    const m = options.maxTasks ?? DEFAULT_MAX_TASKS;
    this.maxTasks = Math.max(1, Math.floor(m));
  }

  create(params: { contextId?: string }): Task {
    const id = randomUUID();
    const task: Task = {
      id,
      ...(params.contextId !== undefined ? { contextId: params.contextId } : {}),
      status: {
        state: "TASK_STATE_WORKING",
        message: makeAgentMessage(""),
        timestamp: new Date().toISOString(),
      },
      artifacts: [],
      history: [],
    };
    this.tasks.set(id, task);
    this.evictIfOversized();
    return task;
  }

  size(): number {
    return this.tasks.size;
  }

  private evictIfOversized(): void {
    while (this.tasks.size > this.maxTasks) {
      const oldest = this.tasks.keys().next();
      if (oldest.done) return;
      this.tasks.delete(oldest.value);
    }
  }

  complete(id: string, replyText: string): Task {
    const task = this.requireTask(id);
    task.status = {
      state: "TASK_STATE_COMPLETED",
      message: makeAgentMessage(replyText),
      timestamp: new Date().toISOString(),
    };
    const artifact: Artifact = {
      name: "reply",
      parts: [{ text: replyText, mediaType: "text/plain" }],
    };
    task.artifacts = [artifact];
    return task;
  }

  fail(id: string, errorText: string): Task {
    const task = this.requireTask(id);
    task.status = {
      state: "TASK_STATE_FAILED",
      message: makeAgentMessage(errorText),
      timestamp: new Date().toISOString(),
    };
    task.artifacts = [];
    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  state(id: string): TaskState | undefined {
    return this.tasks.get(id)?.status.state;
  }

  private requireTask(id: string): Task {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`task ${id} not found`);
    return task;
  }
}

function makeAgentMessage(text: string): Message {
  return {
    role: "ROLE_AGENT",
    parts: [{ text, mediaType: "text/plain" }],
  };
}
