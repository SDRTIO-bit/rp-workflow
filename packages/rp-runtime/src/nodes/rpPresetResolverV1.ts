/**
 * RP Preset Resolver V1 - Phase B-2.6.1
 *
 * Deterministic node that resolves a preset with directives into concrete prompt sections.
 */

import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { RpPresetV1, PresetDirectiveV1 } from "../preset/types.js";
import { resolvePreset } from "../preset/resolver.js";

/**
 * NodeDefinition for rpPresetResolverV1.
 */
export const rpPresetResolverV1Definition: NodeDefinition = {
  type: "rpPresetResolverV1",
  label: "RP Preset Resolver",
  category: "roleplay",
  description: "Resolves a preset with directives into concrete prompt sections",
  color: "#9333ea",
  ports: [
    {
      id: "preset",
      label: "Preset",
      dataType: "json",
      direction: "input",
      required: true,
    },
    {
      id: "directives",
      label: "Directives",
      dataType: "json",
      direction: "input",
      required: false,
    },
    {
      id: "resolvedPreset",
      label: "Resolved Preset",
      dataType: "json",
      direction: "output",
    },
  ],
};

/**
 * Factory function that creates the executor for rpPresetResolverV1.
 */
export function createRpPresetResolverV1Executor(): NodeExecutor {
  return async (input: NodeExecutionInput) => {
    // Support both input and config for preset
    const preset = input.inputs.preset ?? input.node.config?.preset;
    const directives = input.inputs.directives ?? input.node.config?.directives;

    if (!preset || typeof preset !== "object") {
      throw new Error("rpPresetResolverV1: preset is required");
    }

    const rpPreset = preset as RpPresetV1;
    const directiveList = (directives as PresetDirectiveV1[] | undefined) ?? [];

    const resolvedPreset = resolvePreset(rpPreset, directiveList);

    return { outputs: { resolvedPreset } };
  };
}
