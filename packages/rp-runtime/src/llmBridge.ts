/**
 * Bridge adapter: routes RP node LLM calls through LlmRouter.
 *
 * V3 (platform baseline): accepts a LlmRouter + workflow-level default config.
 * Per-node model config overrides from node.config.modelConfig are merged
 * at call time via completeWithModelConfig(). This allows Parser and Writer
 * to use different providers and models without duplicating adapter logic.
 *
 * No provider-specific code. OpenCode Go, DeepSeek, and any future provider
 * all go through the same LlmRouter path. API keys and base URLs are never
 * exposed to RP nodes, traces, or outputs.
 */

import type { LlmRouter, NodeModelConfig } from "@awp/agent-runtime";
import type { RpLlmAdapter } from "./nodes/rpWriterV1.js";

/** Extended RP adapter with per-node model config support. */
export interface RpLlmBridge extends RpLlmAdapter {
  /** Complete with per-node modelConfig override. Returns resolved provider/model for trace. */
  completeWithModelConfig(
    prompt: string,
    nodeModelConfig?: NodeModelConfig,
  ): Promise<{
    text: string;
    tokenUsage: { prompt: number; completion: number };
    providerId: string;
    model: string;
  }>;
}

/**
 * Creates an RpLlmBridge backed by a LlmRouter.
 *
 * @param router - The LlmRouter (owns all provider adapters, never exposed to nodes)
 * @param workflowModelConfig - Workflow-level default model config
 */
export function createRpLlmBridge(
  router: LlmRouter,
  workflowModelConfig?: NodeModelConfig,
): RpLlmBridge {
  return {
    provider: "llm-router",
    kind: "llm",

    async complete(prompt: string) {
      const result = await router.completeWithConfig(undefined, workflowModelConfig, prompt);
      return {
        text: result.text,
        tokenUsage: {
          prompt: result.tokenUsage.input,
          completion: result.tokenUsage.output,
        },
      };
    },

    async completeWithModelConfig(prompt: string, nodeModelConfig?: NodeModelConfig) {
      const result = await router.completeWithConfig(nodeModelConfig, workflowModelConfig, prompt);
      const resolved = router.resolveConfig(nodeModelConfig, workflowModelConfig);
      return {
        text: result.text,
        tokenUsage: {
          prompt: result.tokenUsage.input,
          completion: result.tokenUsage.output,
        },
        providerId: resolved.providerId,
        model: resolved.model,
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
