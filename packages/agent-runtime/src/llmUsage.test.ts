import { describe, expect, it } from "vitest";
import {
  createMockLlmAdapter,
  normalizeOpenAiCompatibleUsage,
  unavailableTokenUsage,
} from "./llmUsage.js";
import type { LlmTokenUsageV1 } from "@awp/workflow-core";

describe("P-13A LLM token usage", () => {
  it("normalizes provider usage and does not double-count cached input", () => {
    expect(
      normalizeOpenAiCompatibleUsage({
        prompt_tokens: 10,
        completion_tokens: 4,
        prompt_cache_hit_tokens: 6,
      }),
    ).toEqual({
      availability: "available",
      source: "provider",
      input: 10,
      output: 4,
      cachedInput: 6,
      total: 14,
    });
  });

  it("distinguishes unavailable usage from true zero token usage", () => {
    expect(normalizeOpenAiCompatibleUsage(undefined)).toEqual(unavailableTokenUsage());
    expect(normalizeOpenAiCompatibleUsage({ prompt_tokens: 0, completion_tokens: 0 })).toEqual({
      availability: "available",
      source: "provider",
      input: 0,
      output: 0,
      total: 0,
    });
  });

  it("lets mock LLM inject provider, estimated, and unavailable usage", async () => {
    const provider = createMockLlmAdapter({
      tokenUsage: { availability: "available", source: "provider", input: 1, output: 2, total: 3 },
    });
    const unavailable = createMockLlmAdapter({ tokenUsage: unavailableTokenUsage() });
    const estimated = createMockLlmAdapter();

    expectAvailableSource(
      (await provider.complete({ model: "m", prompt: "hello" })).tokenUsage,
    ).toBe("provider");
    expect((await unavailable.complete({ model: "m", prompt: "hello" })).tokenUsage).toEqual({
      availability: "unavailable",
      source: "unavailable",
    });
    expectAvailableSource(
      (await estimated.complete({ model: "m", prompt: "hello" })).tokenUsage,
    ).toBe("estimated");
  });
});

function expectAvailableSource(usage: LlmTokenUsageV1 | { input: number; output: number }) {
  if (!("availability" in usage) || usage.availability !== "available") {
    throw new Error("expected available usage");
  }
  return expect(usage.source);
}
