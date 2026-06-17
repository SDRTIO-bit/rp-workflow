import { afterEach, describe, expect, it } from "vitest";
import { resolveEnv, MOCK_MODEL } from "./env.js";

describe("resolveEnv", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses default DATA_DIR relative to module", () => {
    const env = resolveEnv();
    expect(env.dataDir).toContain("data");
  });

  it("overrides DATA_DIR from environment variable", () => {
    process.env.DATA_DIR = "/custom/data";
    const env = resolveEnv();
    expect(env.dataDir).toBe("/custom/data");
  });

  it("uses default port 5180", () => {
    const env = resolveEnv();
    expect(env.port).toBe(5180);
  });

  it("reads DEEPSEEK_API_KEY", () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    const env = resolveEnv();
    expect(env.deepseekApiKey).toBe("test-key");
  });

  // ── rpProviderId resolution ──────────────────────────────────────────────

  it("defaults rpProviderId to mock in development", () => {
    delete process.env.NODE_ENV;
    delete process.env.RP_PROVIDER;
    delete process.env.RP_MOCK;
    delete process.env.LLM_DEFAULT_PROVIDER;
    const env = resolveEnv();
    expect(env.rpProviderId).toBe("mock");
  });

  it("defaults rpProviderId to deepseek in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.RP_PROVIDER;
    delete process.env.RP_MOCK;
    delete process.env.LLM_DEFAULT_PROVIDER;
    const env = resolveEnv();
    expect(env.rpProviderId).toBe("deepseek");
  });

  it("reads rpProviderId from RP_PROVIDER env", () => {
    process.env.RP_PROVIDER = "custom-provider";
    const env = resolveEnv();
    expect(env.rpProviderId).toBe("custom-provider");
  });

  it("RP_MOCK=1 forces rpProviderId to mock", () => {
    delete process.env.RP_PROVIDER;
    process.env.RP_MOCK = "1";
    const env = resolveEnv();
    expect(env.rpProviderId).toBe("mock");
    expect(env.rpMockOptIn).toBe(true);
  });

  it("falls back rpProviderId from LLM_DEFAULT_PROVIDER when RP_PROVIDER and RP_MOCK are unset", () => {
    delete process.env.RP_PROVIDER;
    delete process.env.RP_MOCK;
    process.env.LLM_DEFAULT_PROVIDER = "fallback-provider";
    const env = resolveEnv();
    expect(env.rpProviderId).toBe("fallback-provider");
  });

  it("RP_PROVIDER wins over RP_MOCK=1", () => {
    process.env.RP_PROVIDER = "opencode";
    process.env.RP_MOCK = "1";
    const env = resolveEnv();
    expect(env.rpProviderId).toBe("opencode");
  });

  it("throws when RP_MOCK=1 is set with NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    process.env.RP_MOCK = "1";
    expect(() => resolveEnv()).toThrow(/RP_MOCK=1/);
  });

  // ── rpModel compatibility rules ──────────────────────────────────────────

  it("defaults rpModel to mock-model when rpProviderId is mock", () => {
    process.env.RP_PROVIDER = "mock";
    delete process.env.RP_MODEL;
    const env = resolveEnv();
    expect(env.rpModel).toBe(MOCK_MODEL);
  });

  it("defaults rpModel to deepseekModel when rpProviderId is deepseek", () => {
    process.env.RP_PROVIDER = "deepseek";
    delete process.env.RP_MODEL;
    process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";
    const env = resolveEnv();
    expect(env.rpModel).toBe("deepseek-v4-flash");
  });

  it("defaults rpModel to openCodeModel when rpProviderId is opencode", () => {
    process.env.RP_PROVIDER = "opencode";
    delete process.env.RP_MODEL;
    process.env.OPENCODE_MODEL = "opencode-pro";
    const env = resolveEnv();
    expect(env.rpModel).toBe("opencode-pro");
  });

  it("reads rpModel from RP_MODEL env for custom provider", () => {
    process.env.RP_PROVIDER = "custom-provider";
    process.env.RP_MODEL = "custom-model";
    const env = resolveEnv();
    expect(env.rpModel).toBe("custom-model");
  });

  it("accepts explicit RP_MODEL=mock-model for mock provider", () => {
    process.env.RP_PROVIDER = "mock";
    process.env.RP_MODEL = MOCK_MODEL;
    const env = resolveEnv();
    expect(env.rpModel).toBe(MOCK_MODEL);
  });

  it("rejects RP_MODEL=deepseek-v4-flash for mock provider", () => {
    process.env.RP_PROVIDER = "mock";
    process.env.RP_MODEL = "deepseek-v4-flash";
    expect(() => resolveEnv()).toThrow(/only accepts model "mock-model"/);
  });

  it("rejects RP_MODEL=mock-model for deepseek provider", () => {
    process.env.RP_PROVIDER = "deepseek";
    process.env.RP_MODEL = MOCK_MODEL;
    expect(() => resolveEnv()).toThrow(/cannot use model "mock-model"/);
  });

  it("rejects RP_MODEL=mock-model for opencode provider", () => {
    process.env.RP_PROVIDER = "opencode";
    process.env.RP_MODEL = MOCK_MODEL;
    expect(() => resolveEnv()).toThrow(/cannot use model "mock-model"/);
  });

  it("rejects RP_MODEL=mock-model when deepseek is the production default", () => {
    process.env.NODE_ENV = "production";
    delete process.env.RP_PROVIDER;
    delete process.env.RP_MOCK;
    delete process.env.LLM_DEFAULT_PROVIDER;
    process.env.RP_MODEL = MOCK_MODEL;
    expect(() => resolveEnv()).toThrow(/cannot use model "mock-model"/);
  });

  it("defaults agent session store to in-memory", () => {
    delete process.env.AGENT_SESSION_STORE;
    delete process.env.AGENT_SESSION_DIR;
    const env = resolveEnv();
    expect(env.agentSessionStore).toBe("in-memory");
    expect(env.agentSessionDir).toBe("");
  });

  it("reads file agent session store settings", () => {
    process.env.AGENT_SESSION_STORE = "file";
    process.env.AGENT_SESSION_DIR = "/tmp/awp-agent-sessions";
    const env = resolveEnv();
    expect(env.agentSessionStore).toBe("file");
    expect(env.agentSessionDir).toBe("/tmp/awp-agent-sessions");
  });
});
