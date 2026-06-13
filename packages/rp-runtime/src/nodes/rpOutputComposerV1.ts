/**
 * RP Output Composer V1 - Phase B-2.6.1
 *
 * Deterministic node that composes final output from Writer content.
 */

import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { OutputContractV1 } from "../prompt/types.js";
import type { WriterContentV1 } from "../output/composer.js";
import { composeOutput } from "../output/composer.js";

/**
 * NodeDefinition for rpOutputComposerV1.
 */
export const rpOutputComposerV1Definition: NodeDefinition = {
  type: "rpOutputComposerV1",
  label: "RP Output Composer",
  category: "roleplay",
  description: "Composes final output from Writer content and output contract",
  color: "#9333ea",
  ports: [
    {
      id: "writerContent",
      label: "Writer Content",
      dataType: "json",
      direction: "input",
      required: true,
    },
    {
      id: "outputContract",
      label: "Output Contract",
      dataType: "json",
      direction: "input",
      required: false,
    },
    {
      id: "composedOutput",
      label: "Composed Output",
      dataType: "json",
      direction: "output",
    },
    {
      id: "text",
      label: "Text",
      dataType: "draft",
      direction: "output",
    },
  ],
};

/**
 * Factory function that creates the executor for rpOutputComposerV1.
 */
export function createRpOutputComposerV1Executor(): NodeExecutor {
  return async (input: NodeExecutionInput) => {
    const { writerContent, outputContract } = input.inputs;

    if (!writerContent || typeof writerContent !== "object") {
      throw new Error("rpOutputComposerV1: writerContent is required");
    }

    const content = writerContent as WriterContentV1;

    // Support both input and config for outputContract
    const contract = (outputContract ?? input.node.config?.outputContract) as
      | OutputContractV1
      | undefined;

    // Use default contract if not provided
    const defaultContract: OutputContractV1 = {
      version: "output-contract-v1",
      mode: "narrative_only",
      slots: [{ id: "narrative", required: true, order: 10, producer: "writer" }],
      allowExtraText: false,
    };

    const composedOutput = composeOutput(content, contract ?? defaultContract);

    return { outputs: { composedOutput, text: composedOutput.text } };
  };
}
