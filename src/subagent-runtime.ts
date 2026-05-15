/**
 * The minimum subagent surface we need from PluginRuntime.subagent.
 *
 * Declared structurally so the package can be tested without the real
 * `@openclaw/plugin-sdk` resolved at runtime. The real type
 * (`PluginRuntime["subagent"]`) is structurally compatible.
 */
export type SubagentRunContract = {
  run: (params: {
    sessionKey: string;
    message: string;
    deliver?: boolean;
  }) => Promise<{ runId: string }>;
  waitForRun: (params: {
    runId: string;
    timeoutMs?: number;
  }) => Promise<{ status: "ok" | "timeout" | "error"; error?: string }>;
  getSessionMessages: (params: {
    sessionKey: string;
    limit?: number;
  }) => Promise<{ messages: unknown[] }>;
  deleteSession: (params: { sessionKey: string }) => Promise<void>;
};
