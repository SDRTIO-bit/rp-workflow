/**
 * Bridge adapter: wraps @awp/agent-runtime LlmAdapter as rp-runtime RpLlmAdapter.
 *
 * The agent-runtime adapter has this interface:
 *   complete(input: { model, prompt, temperature? }): Promise<{ text, tokenUsage }>
 *
 * The rp-runtime RpLlmAdapter has this interface:
 *   complete(prompt: string): Promise<{ text, tokenUsage: { prompt, completion } }>
 *
 * This bridge captures the model name at creation time and translates between the two.
 */

import type { LlmAdapter as AgentLlmAdapter } from "@awp/agent-runtime";
import type { RpLlmAdapter } from "./nodes/rpWriterV1.js";

/**
 * Wraps an agent-runtime LlmAdapter as an rp-runtime RpLlmAdapter.
 *
 * @param agentAdapter - The agent-runtime adapter (e.g., createDeepSeekAdapter result)
 * @param model - Model name to pass to the agent adapter on each complete call
 */
export function createRpLlmBridge(agentAdapter: AgentLlmAdapter, model: string): RpLlmAdapter {
  return {
    provider: agentAdapter.provider,
    kind: "llm",
    async complete(prompt: string) {
      const result = await agentAdapter.complete({ model, prompt });
      return {
        text: result.text,
        tokenUsage: {
          prompt: result.tokenUsage.input,
          completion: result.tokenUsage.output,
        },
      };
    },
  };
}

/**
 * Creates a mock RpLlmAdapter for testing.
 * Returns predefined text without making any network calls.
 */
export function createMockRpLlmAdapter(
  mockText: string = "[MOCK] This is a mock narrative generated without LLM.",
): RpLlmAdapter {
  return {
    provider: "mock",
    kind: "mock",
    async complete(_prompt: string) {
      return {
        text: mockText,
        tokenUsage: { prompt: 0, completion: 0 },
      };
    },
  };
}
