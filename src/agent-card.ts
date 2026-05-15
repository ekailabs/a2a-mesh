import type { IncomingMessage } from "node:http";
import type { A2aConfig } from "./config.js";
import type { AgentCard } from "./types.js";

const DEFAULT_VERSION = "0.1.0";
const ALLOWED_SCHEMES = new Set(["http", "https"]);
const HOST_PATTERN = /^[A-Za-z0-9.\-:[\]]+$/;

export type AgentCardInputs = {
  cfg: A2aConfig;
  agentName: string;
  agentDescription?: string;
  packageVersion?: string;
};

export function buildAgentCard(inputs: AgentCardInputs, req: IncomingMessage): AgentCard {
  const { cfg, agentName, agentDescription, packageVersion } = inputs;
  const url = cfg.cardUrl ?? defaultCardUrl(req, cfg);
  const card: AgentCard = {
    name: cfg.cardName ?? agentName,
    description:
      cfg.cardDescription ??
      agentDescription ??
      `A2A interface to OpenClaw agent '${agentName}'.`,
    version: cfg.cardVersion ?? packageVersion ?? DEFAULT_VERSION,
    supportedInterfaces: [
      {
        url,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [],
  };
  if (cfg.advertiseBearerAuth) {
    card.securitySchemes = {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "OpenClaw gateway operator token. Pass as 'Authorization: Bearer <token>' on POST.",
      },
    };
    card.security = [{ bearerAuth: [] }];
  }
  return card;
}

function defaultCardUrl(req: IncomingMessage, cfg: A2aConfig): string {
  const scheme = resolveScheme(req);
  const host = resolveHost(req, cfg);
  return `${scheme}://${host}${cfg.path}`;
}

function resolveScheme(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-proto"];
  if (typeof fwd === "string" && fwd.length > 0) {
    const first = fwd.split(",")[0]!.trim().toLowerCase();
    if (ALLOWED_SCHEMES.has(first)) return first;
  }
  const socket = req.socket as { encrypted?: boolean } | undefined;
  return socket?.encrypted ? "https" : "http";
}

function resolveHost(req: IncomingMessage, cfg: A2aConfig): string {
  const raw = req.headers["host"];
  if (typeof raw !== "string" || raw.length === 0) return "localhost";
  if (!HOST_PATTERN.test(raw)) return "localhost";
  if (cfg.allowedHosts && cfg.allowedHosts.length > 0) {
    const bare = raw.split(":")[0]!;
    const ok = cfg.allowedHosts.some((h) => h === raw || h === bare);
    if (!ok) return cfg.allowedHosts[0]!;
  }
  return raw;
}
