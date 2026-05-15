/**
 * Minimal ambient types for `@openclaw/plugin-sdk/plugin-entry`.
 *
 * The published `@openclaw/plugin-sdk` workspace package isn't directly
 * consumable outside the openclaw monorepo (its sources use monorepo-relative
 * re-exports), but OpenClaw injects the SDK at plugin load time. We declare
 * the bare surface we depend on so `tsc` is happy without resolving the SDK's
 * internal modules.
 */
declare module "@openclaw/plugin-sdk/plugin-entry" {
  import type { IncomingMessage, ServerResponse } from "node:http";

  export type OpenClawPluginHttpRouteAuth = "gateway" | "plugin";
  export type OpenClawPluginHttpRouteMatch = "exact" | "prefix";
  export type OpenClawPluginHttpRouteHandler = (
    req: IncomingMessage,
    res: ServerResponse,
  ) => Promise<boolean | void> | boolean | void;
  export type OpenClawPluginHttpRouteParams = {
    path: string;
    handler: OpenClawPluginHttpRouteHandler;
    auth: OpenClawPluginHttpRouteAuth;
    match?: OpenClawPluginHttpRouteMatch;
    replaceExisting?: boolean;
  };

  export type PluginLogger = {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
    debug?: (message: string) => void;
  };

  export type PluginRuntime = {
    subagent: {
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
  };

  export type OpenClawPluginApi = {
    id: string;
    name: string;
    description?: string;
    config: unknown;
    pluginConfig?: Record<string, unknown>;
    runtime: PluginRuntime;
    logger: PluginLogger;
    registerHttpRoute: (params: OpenClawPluginHttpRouteParams) => void;
  };

  export type OpenClawPluginConfigSchema = unknown;

  export function definePluginEntry(options: {
    id: string;
    name: string;
    description: string;
    configSchema?: OpenClawPluginConfigSchema | (() => OpenClawPluginConfigSchema);
    register: (api: OpenClawPluginApi) => void;
  }): {
    id: string;
    name: string;
    description: string;
    register: (api: OpenClawPluginApi) => void;
  };
}
