/**
 * RP Format Validator V1 - Phase B-2.6.1
 *
 * Deterministic node that validates output against contract.
 */

import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { OutputContractV1 } from "../prompt/types.js";
import type { ComposedOutputV1 } from "../output/composer.js";
import { validateFormat } from "../output/validator.js";

/**
 * NodeDefinition for rpFormatValidatorV1.
 */
export const rpFormatValidatorV1Definition: NodeDefinition = {
  type: "rpFormatValidatorV1",
  label: "RP Format Validator",
  category: "roleplay",
  description: "Validates composed output against output contract",
  color: "#9333ea",
  ports: [
    {
      id: "composedOutput",
      label: "Composed Output",
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
      id: "validationResult",
      label: "Validation Result",
      dataType: "json",
      direction: "output",
    },
  ],
};

/**
 * Factory function that creates the executor for rpFormatValidatorV1.
 */
export function createRpFormatValidatorV1Executor(): NodeExecutor {
  return async (input: NodeExecutionInput) => {
    const { composedOutput, outputContract } = input.inputs;

    if (!composedOutput || typeof composedOutput !== "object") {
      throw new Error("rpFormatValidatorV1: composedOutput is required");
    }

    const output = composedOutput as ComposedOutputV1;

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

    const validationResult = validateFormat(output, contract ?? defaultContract);

    return { outputs: { validationResult } };
  };
}
