import { afterEach, describe, expect, it } from "vitest";
import { resolveEnv } from "./env.js";

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

  it("defaults rpProviderId to mock in development", () => {
    delete process.env.NODE_ENV;
    delete process.env.RP_PROVIDER;
    delete process.env.LLM_DEFAULT_PROVIDER;
    const env = resolveEnv();
    expect(env.rpProviderId).toBe("mock");
  });

  it("defaults rpProviderId to deepseek in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.RP_PROVIDER;
    delete process.env.LLM_DEFAULT_PROVIDER;
    const env = resolveEnv();
    expect(env.rpProviderId).toBe("deepseek");
  });

  it("reads rpProviderId from RP_PROVIDER env", () => {
    process.env.RP_PROVIDER = "custom-provider";
    const env = resolveEnv();
    expect(env.rpProviderId).toBe("custom-provider");
  });

  it("falls back rpProviderId from LLM_DEFAULT_PROVIDER when RP_PROVIDER is unset", () => {
    delete process.env.RP_PROVIDER;
    process.env.LLM_DEFAULT_PROVIDER = "fallback-provider";
    const env = resolveEnv();
    expect(env.rpProviderId).toBe("fallback-provider");
  });

  it("defaults rpModel to mock-model when rpProviderId is mock", () => {
    process.env.RP_PROVIDER = "mock";
    delete process.env.RP_MODEL;
    const env = resolveEnv();
    expect(env.rpModel).toBe("mock-model");
  });

  it("defaults rpModel to deepseekModel when rpProviderId is not mock", () => {
    process.env.RP_PROVIDER = "deepseek";
    delete process.env.RP_MODEL;
    process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";
    const env = resolveEnv();
    expect(env.rpModel).toBe("deepseek-v4-flash");
  });

  it("reads rpModel from RP_MODEL env", () => {
    process.env.RP_MODEL = "custom-model";
    const env = resolveEnv();
    expect(env.rpModel).toBe("custom-model");
  });
});
