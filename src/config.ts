import { z } from "zod";

const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const ConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    path: z
      .string()
      .startsWith("/", { message: "path must start with '/'" })
      .default("/a2a"),
    agent: z.string().regex(AGENT_ID_PATTERN).optional(),
    cardName: z.string().optional(),
    cardDescription: z.string().optional(),
    cardVersion: z.string().optional(),
    cardUrl: z.string().optional(),
    advertiseBearerAuth: z.boolean().default(true),
    allowedHosts: z.array(z.string().min(1)).optional(),
    subagentTimeoutMs: z.number().int().min(6000).default(180000),
    maxTasks: z.number().int().min(1).default(10000),
  })
  .strict();

export type A2aConfig = z.infer<typeof ConfigSchema>;

export function parseConfig(input: unknown): A2aConfig {
  return ConfigSchema.parse(input ?? {});
}

type HostConfigAgent = {
  id: string;
  name?: string;
};

type HostConfig = {
  agents?: { list?: HostConfigAgent[] };
};

export type AgentResolution =
  | { kind: "ok"; agent: HostConfigAgent }
  | { kind: "no-agents" }
  | { kind: "multi-agent"; available: string[] }
  | { kind: "not-found"; requested: string; available: string[] };

export function resolveTargetAgent(
  cfg: A2aConfig,
  hostConfig: HostConfig,
): AgentResolution {
  const list = hostConfig.agents?.list ?? [];
  if (list.length === 0) return { kind: "no-agents" };

  if (cfg.agent !== undefined) {
    const found = list.find((a) => a.id === cfg.agent);
    if (found) return { kind: "ok", agent: found };
    return {
      kind: "not-found",
      requested: cfg.agent,
      available: list.map((a) => a.id),
    };
  }

  if (list.length === 1) {
    const sole = list[0]!;
    return { kind: "ok", agent: sole };
  }

  return { kind: "multi-agent", available: list.map((a) => a.id) };
}
