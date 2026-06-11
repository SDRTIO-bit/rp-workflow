import { describe, expect, it } from "vitest";
import { resolveEnv } from "./env";

describe("resolveEnv", () => {
  it("uses default DATA_DIR relative to module", () => {
    const env = resolveEnv();
    expect(env.dataDir).toContain("data");
  });

  it("overrides DATA_DIR from environment variable", () => {
    const original = process.env.DATA_DIR;
    process.env.DATA_DIR = "/custom/data";
    const env = resolveEnv();
    expect(env.dataDir).toBe("/custom/data");
    if (original !== undefined) {
      process.env.DATA_DIR = original;
    } else {
      delete process.env.DATA_DIR;
    }
  });

  it("uses default port 5180", () => {
    const env = resolveEnv();
    expect(env.port).toBe(5180);
  });

  it("reads DEEPSEEK_API_KEY", () => {
    const original = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "test-key";
    const env = resolveEnv();
    expect(env.deepseekApiKey).toBe("test-key");
    if (original !== undefined) {
      process.env.DEEPSEEK_API_KEY = original;
    } else {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });
});
