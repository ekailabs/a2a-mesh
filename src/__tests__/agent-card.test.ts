import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { buildAgentCard } from "../agent-card.js";
import { parseConfig } from "../config.js";

function fakeReq(headers: Record<string, string>, encrypted = false): IncomingMessage {
  const req = {
    headers,
    socket: { encrypted },
  } as unknown as IncomingMessage;
  return req;
}

describe("buildAgentCard", () => {
  const cfg = parseConfig({});

  it("derives URL from request scheme + Host + path (http)", () => {
    const card = buildAgentCard(
      { cfg, agentName: "alpha" },
      fakeReq({ host: "gw.example:8080" }),
    );
    expect(card.supportedInterfaces[0]!.url).toBe("http://gw.example:8080/a2a");
  });

  it("uses https when socket is encrypted", () => {
    const card = buildAgentCard(
      { cfg, agentName: "alpha" },
      fakeReq({ host: "gw.example" }, true),
    );
    expect(card.supportedInterfaces[0]!.url).toBe("https://gw.example/a2a");
  });

  it("honors x-forwarded-proto", () => {
    const card = buildAgentCard(
      { cfg, agentName: "alpha" },
      fakeReq({ host: "gw.example", "x-forwarded-proto": "https" }),
    );
    expect(card.supportedInterfaces[0]!.url).toBe("https://gw.example/a2a");
  });

  it("cardUrl override wins over request-derived URL", () => {
    const c = parseConfig({ cardUrl: "https://override.example/x" });
    const card = buildAgentCard(
      { cfg: c, agentName: "alpha" },
      fakeReq({ host: "ignored" }),
    );
    expect(card.supportedInterfaces[0]!.url).toBe("https://override.example/x");
  });

  it("advertises streaming and pushNotifications as false", () => {
    const card = buildAgentCard(
      { cfg, agentName: "alpha" },
      fakeReq({ host: "h" }),
    );
    expect(card.capabilities.streaming).toBe(false);
    expect(card.capabilities.pushNotifications).toBe(false);
  });

  it("advertises HTTP Bearer auth by default", () => {
    const card = buildAgentCard(
      { cfg, agentName: "alpha" },
      fakeReq({ host: "h" }),
    );
    expect(card.securitySchemes?.["bearerAuth"]).toEqual(
      expect.objectContaining({ type: "http", scheme: "bearer" }),
    );
    expect(card.security).toEqual([{ bearerAuth: [] }]);
  });

  it("omits security blocks when advertiseBearerAuth is false", () => {
    const c = parseConfig({ advertiseBearerAuth: false });
    const card = buildAgentCard(
      { cfg: c, agentName: "alpha" },
      fakeReq({ host: "h" }),
    );
    const json = JSON.parse(JSON.stringify(card)) as Record<string, unknown>;
    expect("securitySchemes" in json).toBe(false);
    expect("security" in json).toBe(false);
    expect("signatures" in json).toBe(false);
  });

  it("falls back to localhost when Host header is missing", () => {
    const card = buildAgentCard(
      { cfg, agentName: "alpha" },
      fakeReq({}),
    );
    expect(card.supportedInterfaces[0]!.url).toBe("http://localhost/a2a");
  });

  it("falls back to localhost when Host header contains illegal characters", () => {
    const card = buildAgentCard(
      { cfg, agentName: "alpha" },
      fakeReq({ host: "evil host\r\nInjected: 1" }),
    );
    expect(card.supportedInterfaces[0]!.url).toBe("http://localhost/a2a");
  });

  it("ignores x-forwarded-proto values other than http/https", () => {
    const card = buildAgentCard(
      { cfg, agentName: "alpha" },
      fakeReq({ host: "h", "x-forwarded-proto": "javascript" }),
    );
    expect(card.supportedInterfaces[0]!.url).toBe("http://h/a2a");
  });

  it("rewrites Host to the first allowedHosts entry when the request Host is not allowed", () => {
    const c = parseConfig({ allowedHosts: ["a2a.example", "alt.example"] });
    const card = buildAgentCard(
      { cfg: c, agentName: "alpha" },
      fakeReq({ host: "evil.test" }),
    );
    expect(card.supportedInterfaces[0]!.url).toBe("http://a2a.example/a2a");
  });

  it("keeps Host as-is when it matches allowedHosts", () => {
    const c = parseConfig({ allowedHosts: ["a2a.example"] });
    const card = buildAgentCard(
      { cfg: c, agentName: "alpha" },
      fakeReq({ host: "a2a.example:8080" }),
    );
    expect(card.supportedInterfaces[0]!.url).toBe("http://a2a.example:8080/a2a");
  });

  it("uses cardName / cardDescription / cardVersion overrides", () => {
    const c = parseConfig({
      cardName: "Custom",
      cardDescription: "desc",
      cardVersion: "9.9.9",
    });
    const card = buildAgentCard(
      { cfg: c, agentName: "alpha" },
      fakeReq({ host: "h" }),
    );
    expect(card.name).toBe("Custom");
    expect(card.description).toBe("desc");
    expect(card.version).toBe("9.9.9");
  });

  it("defaults description from agentDescription if no cardDescription", () => {
    const card = buildAgentCard(
      { cfg, agentName: "alpha", agentDescription: "from agent" },
      fakeReq({ host: "h" }),
    );
    expect(card.description).toBe("from agent");
  });
});
