import type { IncomingMessage, ServerResponse } from "node:http";
import { definePluginEntry } from "@openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "@openclaw/plugin-sdk/plugin-entry";
import { buildAgentCard } from "./src/agent-card.js";
import { parseConfig, resolveTargetAgent } from "./src/config.js";
import {
  createAgentCardHandler,
  createJsonRpcHandler,
} from "./src/handler.js";
import { logInfo, logWarn } from "./src/logging.js";
import {
  DISABLED_LOG,
  agentNotFoundLog,
  multiAgentMissingConfigLog,
  startupInfoRegistered,
  startupWarnNoAuth,
} from "./src/strings.js";
import type { SubagentRunContract } from "./src/subagent-runtime.js";
import { InMemoryTaskStore } from "./src/task-store.js";

const PLUGIN_VERSION = "0.1.0";

export default definePluginEntry({
  id: "a2a",
  name: "A2A Server",
  description: "Exposes the host OpenClaw agent as an A2A protocol server over JSON-RPC.",
  register(api: OpenClawPluginApi) {
    registerA2a(api);
  },
});

export function registerA2a(api: OpenClawPluginApi): void {
  let cfg;
  try {
    cfg = parseConfig(api.pluginConfig);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    api.logger.error(`[a2a] invalid config: ${message}`);
    return;
  }

  if (!cfg.enabled) {
    api.logger.info(DISABLED_LOG);
    return;
  }

  const resolution = resolveTargetAgent(cfg, api.config as { agents?: { list?: Array<{ id: string; name?: string }> } });
  if (resolution.kind === "no-agents") {
    api.logger.warn(`[a2a] No agents registered; not installing routes.`);
    return;
  }
  if (resolution.kind === "multi-agent") {
    api.logger.warn(multiAgentMissingConfigLog(resolution.available));
    return;
  }
  if (resolution.kind === "not-found") {
    api.logger.warn(agentNotFoundLog(resolution.requested, resolution.available));
    return;
  }

  const agent = resolution.agent;
  const agentName = agent.name ?? agent.id;
  const store = new InMemoryTaskStore({ maxTasks: cfg.maxTasks });

  const subagent = api.runtime.subagent as unknown as SubagentRunContract;
  const jsonRpcRoute = createJsonRpcHandler({
    agentId: agent.id,
    subagentTimeoutMs: cfg.subagentTimeoutMs,
    subagent,
    store,
    logger: api.logger,
  });
  const cardRoute = createAgentCardHandler({
    buildCard: (req: IncomingMessage) =>
      buildAgentCard(
        {
          cfg,
          agentName,
          packageVersion: PLUGIN_VERSION,
        },
        req,
      ),
    logger: api.logger,
  });

  api.registerHttpRoute({
    path: cfg.path,
    auth: "gateway",
    match: "exact",
    replaceExisting: true,
    handler: jsonRpcRoute as (
      req: IncomingMessage,
      res: ServerResponse,
    ) => Promise<boolean | void>,
  });
  api.registerHttpRoute({
    path: "/.well-known/agent-card.json",
    auth: "plugin",
    match: "exact",
    replaceExisting: false,
    handler: cardRoute as (req: IncomingMessage, res: ServerResponse) => boolean | void,
  });

  api.logger.warn(startupWarnNoAuth(cfg.path));
  api.logger.info(startupInfoRegistered(cfg.path, agentName));

  // Touch logInfo/logWarn so the structured helpers are referenced in the
  // plugin entry; per-request emission happens inside the handler.
  void logInfo;
  void logWarn;
}
