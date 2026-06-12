import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { AssembledContext, WriterOutput } from "../types.js";
import { validateSchema } from "../schemas.js";

/**
 * Optional LLM adapter interface for rpWriterV1.
 * When not provided, the node falls back to echo mode (if enabled).
 */
export interface LlmAdapter {
  complete(prompt: string): Promise<{
    text: string;
    tokenUsage: { prompt: number; completion: number };
  }>;
}

/**
 * Configuration for rpWriterV1 executor.
 */
export interface RpWriterConfig {
  /** Enable echo fallback when LLM is unavailable. Default: true */
  enableEchoFallback?: boolean;
}

/**
 * Services for rpWriterV1 executor.
 * Injected at registration time (stable services, no session state).
 */
export interface RpWriterServices {
  llmAdapter?: LlmAdapter;
  config?: RpWriterConfig;
}

/**
 * NodeDefinition for rpWriterV1.
 * Takes assembled context and generates narrative text via LLM.
 */
export const rpWriterV1Definition: NodeDefinition = {
  type: "rpWriterV1",
  label: "RP Writer",
  category: "roleplay",
  description: "Generates narrative text from assembled context using LLM",
  color: "#9333ea",
  ports: [
    {
      id: "assembledContext",
      label: "Assembled Context",
      dataType: "json",
      direction: "input",
      required: true,
      schemaId: "rp.assembled-context.v1",
    },
    {
      id: "writerOutput",
      label: "Writer Output",
      dataType: "json",
      direction: "output",
      schemaId: "rp.writer-output.v1",
    },
    {
      id: "narrative",
      label: "Narrative",
      dataType: "draft",
      direction: "output",
    },
  ],
};

/**
 * Factory function that creates the executor for rpWriterV1.
 *
 * Behavior:
 * - If LLM adapter is available: use it, generationMode = "llm"
 * - If LLM adapter throws and fallback enabled: echo mode, generationMode = "echo_fallback", warnings
 * - If no LLM adapter and fallback enabled: echo mode, generationMode = "echo_fallback", warnings
 * - If no LLM adapter and fallback disabled: throw error
 * - LLM errors are NOT swallowed (re-thrown unless fallback is explicitly enabled)
 */
export function createRpWriterV1Executor(services?: RpWriterServices): NodeExecutor {
  const enableFallback = services?.config?.enableEchoFallback ?? true;

  return async (input: NodeExecutionInput) => {
    const { assembledContext } = input.inputs;

    if (!assembledContext || typeof assembledContext !== "object") {
      throw new Error("rpWriterV1: assembledContext is required");
    }

    const ctx = assembledContext as AssembledContext;

    // Try LLM adapter if available
    if (services?.llmAdapter) {
      try {
        const startTime = Date.now();
        const result = await services.llmAdapter.complete(ctx.fullContext);
        const latencyMs = Date.now() - startTime;

        const output: WriterOutput = {
          text: result.text,
          generationMode: "llm",
          metadata: {
            model: "llm-adapter",
            tokenUsage: {
              input: result.tokenUsage.prompt,
              output: result.tokenUsage.completion,
            },
            latencyMs,
          },
        };

        validateSchema("rp.writer-output.v1", output);
        return { outputs: { writerOutput: output, narrative: output.text } };
      } catch (error) {
        // LLM error: only fallback if explicitly enabled
        if (!enableFallback) {
          throw new Error(
            `rpWriterV1: LLM adapter failed and fallback is disabled: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        // Fall through to echo mode with warning
        return createEchoOutput(ctx, [
          `LLM adapter failed: ${error instanceof Error ? error.message : String(error)}. Using echo fallback.`,
        ]);
      }
    }

    // No LLM adapter
    if (!enableFallback) {
      throw new Error("rpWriterV1: No LLM adapter configured and echo fallback is disabled");
    }

    // Echo fallback
    return createEchoOutput(ctx, ["No LLM adapter configured. Using echo fallback."]);
  };
}

function createEchoOutput(
  ctx: AssembledContext,
  warnings: string[],
): { outputs: { writerOutput: WriterOutput; narrative: string } } {
  const text = ctx.userInputSection || ctx.fullContext;

  const output: WriterOutput = {
    text,
    generationMode: "echo_fallback",
    warnings,
    metadata: {
      model: "echo",
      tokenUsage: { input: 0, output: 0 },
      latencyMs: 0,
    },
  };

  validateSchema("rp.writer-output.v1", output);
  return { outputs: { writerOutput: output, narrative: output.text } };
}
