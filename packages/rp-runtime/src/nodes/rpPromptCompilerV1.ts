/**
 * RP Prompt Compiler V1 - Phase B-2.6.1
 *
 * Deterministic node that compiles a PromptDocumentV1 into a Markdown prompt.
 */

import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { PromptDocumentV1 } from "../prompt/types.js";
import type { ResolvedPresetV1 } from "../preset/types.js";
import { compilePrompt } from "../prompt/compiler.js";

/**
 * NodeDefinition for rpPromptCompilerV1.
 */
export const rpPromptCompilerV1Definition: NodeDefinition = {
  type: "rpPromptCompilerV1",
  label: "RP Prompt Compiler",
  category: "roleplay",
  description: "Compiles a PromptDocumentV1 into a Markdown prompt for the LLM",
  color: "#9333ea",
  ports: [
    {
      id: "promptDocument",
      label: "Prompt Document",
      dataType: "json",
      direction: "input",
      required: true,
    },
    {
      id: "resolvedPreset",
      label: "Resolved Preset",
      dataType: "json",
      direction: "input",
      required: true,
    },
    {
      id: "compiledPrompt",
      label: "Compiled Prompt",
      dataType: "json",
      direction: "output",
    },
  ],
};

/**
 * Factory function that creates the executor for rpPromptCompilerV1.
 */
export function createRpPromptCompilerV1Executor(): NodeExecutor {
  return async (input: NodeExecutionInput) => {
    const { promptDocument, resolvedPreset } = input.inputs;

    if (!promptDocument || typeof promptDocument !== "object") {
      throw new Error("rpPromptCompilerV1: promptDocument is required");
    }

    if (!resolvedPreset || typeof resolvedPreset !== "object") {
      throw new Error("rpPromptCompilerV1: resolvedPreset is required");
    }

    const doc = promptDocument as PromptDocumentV1;
    const preset = resolvedPreset as ResolvedPresetV1;

    const compiledPrompt = compilePrompt(doc, preset);

    return { outputs: { compiledPrompt } };
  };
}
