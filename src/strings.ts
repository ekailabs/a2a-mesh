export const PLUGIN_TAG = "[a2a]";

export const DISABLED_LOG = `${PLUGIN_TAG} disabled`;

export function startupWarnNoAuth(path: string): string {
  return `${PLUGIN_TAG} POST ${path} uses gateway authentication; agent card remains public.`;
}

export function startupInfoRegistered(path: string, agentName: string): string {
  return `${PLUGIN_TAG} registered POST ${path} and GET /.well-known/agent-card.json; agent: ${agentName}`;
}

export function multiAgentMissingConfigLog(agentIds: readonly string[]): string {
  return `${PLUGIN_TAG} Multiple agents registered. Set plugins.entries.a2a.agent to one of: [${agentIds.join(", ")}]`;
}

export function agentNotFoundLog(name: string, available: readonly string[]): string {
  return `${PLUGIN_TAG} Agent ${name} not found. Available: [${available.join(", ")}]`;
}

// Note: spec §3 mentions log lines for "route already owned" (replaced) and
// "agent-card route already owned" (skipped). The public registerHttpRoute
// API returns void, so the plugin has no signal to emit those conditionally;
// OpenClaw's plugin loader logs the conflict internally. Intentionally
// omitted here.

export function subagentTimeoutMessage(ms: number): string {
  return `Subagent timed out after ${ms}ms`;
}
