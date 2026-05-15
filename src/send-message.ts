import {
  invalidParams,
  serverError,
} from "./errors.js";
import { logWarn, type LoggerLike } from "./logging.js";
import { extractLatestAssistantReply } from "./reply-extract.js";
import { subagentTimeoutMessage } from "./strings.js";
import type { SubagentRunContract } from "./subagent-runtime.js";
import type { InMemoryTaskStore } from "./task-store.js";
import type { SendMessageParams, Task } from "./types.js";

export type SendMessageDeps = {
  agentId: string;
  subagentTimeoutMs: number;
  subagent: SubagentRunContract;
  store: InMemoryTaskStore;
  logger: LoggerLike;
};

export async function sendMessage(
  params: unknown,
  deps: SendMessageDeps,
): Promise<{ task: Task; taskId: string }> {
  const validated = validateSendMessage(params);
  const { promptText, contextId } = validated;
  const task = deps.store.create(contextId !== undefined ? { contextId } : {});
  const taskId = task.id;
  const sessionKey = `agent:${deps.agentId}:a2a-${taskId}`;

  let runId: string;
  try {
    const result = await deps.subagent.run({
      sessionKey,
      message: promptText,
      deliver: false,
    });
    runId = result.runId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.store.fail(taskId, message);
    throw serverError(message);
  }

  let wait: Awaited<ReturnType<SubagentRunContract["waitForRun"]>>;
  try {
    wait = await deps.subagent.waitForRun({
      runId,
      timeoutMs: deps.subagentTimeoutMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.store.fail(taskId, message);
    bestEffortDelete(deps, sessionKey);
    throw serverError(message);
  }

  if (wait.status === "timeout") {
    const message = subagentTimeoutMessage(deps.subagentTimeoutMs);
    deps.store.fail(taskId, message);
    bestEffortDelete(deps, sessionKey);
    throw serverError(message);
  }

  if (wait.status !== "ok") {
    const message = wait.error ?? `Subagent run failed with status ${wait.status}`;
    deps.store.fail(taskId, message);
    bestEffortDelete(deps, sessionKey);
    throw serverError(message);
  }

  let messages: unknown[];
  try {
    const result = await deps.subagent.getSessionMessages({ sessionKey });
    messages = result.messages;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.store.fail(taskId, message);
    bestEffortDelete(deps, sessionKey);
    throw serverError(message);
  }

  const reply = extractLatestAssistantReply(messages);
  if (reply === undefined) {
    const message = "No assistant reply found in session";
    deps.store.fail(taskId, message);
    bestEffortDelete(deps, sessionKey);
    throw serverError(message);
  }

  const completed = deps.store.complete(taskId, reply);
  bestEffortDelete(deps, sessionKey);
  return { task: completed, taskId };
}

function bestEffortDelete(deps: SendMessageDeps, sessionKey: string): void {
  void deps.subagent.deleteSession({ sessionKey }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logWarn(deps.logger, "deleteSession_failed", { sessionKey, error: message });
  });
}

type ValidatedSendMessage = {
  promptText: string;
  contextId: string | undefined;
};

function validateSendMessage(params: unknown): ValidatedSendMessage {
  if (params === null || typeof params !== "object") {
    throw invalidParams("params must be an object");
  }
  const sm = params as SendMessageParams;
  const message = sm.message;
  if (message === undefined || message === null || typeof message !== "object") {
    throw invalidParams("message is required");
  }
  if (message.role !== "ROLE_USER") {
    throw invalidParams("message.role must be 'ROLE_USER'");
  }
  if (typeof message.messageId !== "string" || message.messageId.length === 0) {
    throw invalidParams("message.messageId is required");
  }
  if (message.taskId !== undefined && message.taskId !== null) {
    throw invalidParams("message.taskId is not supported in v1");
  }
  const parts = message.parts;
  if (!Array.isArray(parts)) {
    throw invalidParams("message.parts must be an array");
  }
  const texts: string[] = [];
  for (const part of parts) {
    if (part === null || typeof part !== "object") continue;
    const p = part as { text?: unknown };
    if (typeof p.text === "string" && p.text.length > 0) {
      texts.push(p.text);
    }
  }
  if (texts.length === 0) {
    throw invalidParams("message.parts must include at least one text part");
  }
  const contextId =
    typeof message.contextId === "string" && message.contextId.length > 0
      ? message.contextId
      : undefined;
  return { promptText: texts.join(""), contextId };
}
