import { hashText } from "./promptBuilder.js";
import type { LlmAdapter, LlmCompletionInput, LlmCompletionResult } from "./types.js";
import type { LlmTokenUsageV1 } from "@awp/workflow-core";

type OpenAiCompatibleUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
};

type LegacyTokenUsage = {
  input?: number;
  output?: number;
  cachedInput?: number;
};

export function unavailableTokenUsage(): LlmTokenUsageV1 {
  return { availability: "unavailable", source: "unavailable" };
}

export function availableTokenUsage(
  input: number,
  output: number,
  source: "provider" | "estimated",
  cachedInput?: number,
): LlmTokenUsageV1 {
  assertToken(input, "input");
  assertToken(output, "output");
  if (cachedInput !== undefined) {
    assertToken(cachedInput, "cachedInput");
  }
  return {
    availability: "available",
    source,
    input,
    output,
    ...(cachedInput !== undefined ? { cachedInput } : {}),
    total: input + output,
  };
}

export function normalizeOpenAiCompatibleUsage(
  usage: OpenAiCompatibleUsage | undefined,
): LlmTokenUsageV1 {
  if (!usage) {
    return unavailableTokenUsage();
  }
  return availableTokenUsage(
    usage.prompt_tokens ?? 0,
    usage.completion_tokens ?? 0,
    "provider",
    usage.prompt_cache_hit_tokens,
  );
}

export function coerceLlmTokenUsage(
  usage: LlmCompletionResult["tokenUsage"] | LegacyTokenUsage | undefined,
  fallback: LlmTokenUsageV1 = unavailableTokenUsage(),
): LlmTokenUsageV1 {
  if (!usage) return fallback;
  if ("availability" in usage) return usage;
  if (typeof usage.input === "number" && typeof usage.output === "number") {
    return availableTokenUsage(usage.input, usage.output, "estimated", usage.cachedInput);
  }
  return fallback;
}

export function getKnownTokenUsage(
  usage: LlmTokenUsageV1,
): { input: number; output: number } | undefined {
  if (usage.availability !== "available") return undefined;
  return { input: usage.input, output: usage.output };
}

export function createMockLlmAdapter(options?: {
  provider?: string;
  text?: string;
  tokenUsage?: LlmTokenUsageV1;
}): LlmAdapter {
  return {
    provider: options?.provider ?? "mock",
    async complete(input: LlmCompletionInput) {
      const promptHash = hashText(input.prompt);
      const preview = input.prompt.slice(-180).replace(/\s+/g, " ").trim();
      const text = options?.text ?? `[mock:${input.model}:${promptHash}] ${preview}`;
      return {
        text,
        tokenUsage:
          options?.tokenUsage ??
          availableTokenUsage(
            Math.ceil(input.prompt.length / 4),
            Math.ceil(text.length / 4),
            "estimated",
            Math.ceil(input.prompt.length / 8),
          ),
      };
    },
  };
}

function assertToken(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`${field} token usage must be a non-negative integer`);
  }
}
