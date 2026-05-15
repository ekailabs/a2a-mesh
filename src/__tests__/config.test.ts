import { describe, expect, it } from "vitest";
import { parseConfig, resolveTargetAgent } from "../config.js";

describe("parseConfig", () => {
  it("applies defaults", () => {
    const cfg = parseConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.path).toBe("/a2a");
    expect(cfg.subagentTimeoutMs).toBe(180000);
  });

  it("accepts undefined input", () => {
    const cfg = parseConfig(undefined);
    expect(cfg.path).toBe("/a2a");
  });

  it("rejects path that does not start with '/'", () => {
    expect(() => parseConfig({ path: "a2a" })).toThrow();
  });

  it("rejects subagentTimeoutMs below 6000", () => {
    expect(() => parseConfig({ subagentTimeoutMs: 5999 })).toThrow();
  });

  it("rejects agent id that does not match the regex", () => {
    expect(() => parseConfig({ agent: "Invalid_AGENT" })).toThrow();
    expect(() => parseConfig({ agent: "-bad" })).toThrow();
    expect(parseConfig({ agent: "ok" }).agent).toBe("ok");
    expect(parseConfig({ agent: "a-1_2" }).agent).toBe("a-1_2");
  });

  it("rejects unknown keys", () => {
    expect(() => parseConfig({ unknown: true })).toThrow();
  });
});

describe("resolveTargetAgent", () => {
  const cfg = parseConfig({});

  it("auto-detects the sole registered agent", () => {
    const res = resolveTargetAgent(cfg, {
      agents: { list: [{ id: "alpha", name: "Alpha" }] },
    });
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") expect(res.agent.id).toBe("alpha");
  });

  it("returns multi-agent when more than one agent and no config", () => {
    const res = resolveTargetAgent(cfg, {
      agents: { list: [{ id: "a" }, { id: "b" }] },
    });
    expect(res.kind).toBe("multi-agent");
    if (res.kind === "multi-agent") expect(res.available).toEqual(["a", "b"]);
  });

  it("picks the configured agent when present", () => {
    const c = parseConfig({ agent: "b" });
    const res = resolveTargetAgent(c, {
      agents: { list: [{ id: "a" }, { id: "b" }] },
    });
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") expect(res.agent.id).toBe("b");
  });

  it("returns not-found when configured agent is absent", () => {
    const c = parseConfig({ agent: "c" });
    const res = resolveTargetAgent(c, {
      agents: { list: [{ id: "a" }, { id: "b" }] },
    });
    expect(res.kind).toBe("not-found");
    if (res.kind === "not-found") {
      expect(res.requested).toBe("c");
      expect(res.available).toEqual(["a", "b"]);
    }
  });

  it("returns no-agents when host config has no agents", () => {
    expect(resolveTargetAgent(cfg, {}).kind).toBe("no-agents");
    expect(resolveTargetAgent(cfg, { agents: { list: [] } }).kind).toBe("no-agents");
  });
});
