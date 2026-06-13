/**
 * Preset Resolver - Phase B-2.6
 *
 * Resolves a preset with directives into concrete prompt sections.
 * Handles append and override merge strategies.
 */

import type { PromptSectionV1, PromptFragmentV1 } from "../prompt/types.js";
import type { RpPresetV1, ResolvedPresetV1, PresetDirectiveV1, PresetConflictV1 } from "./types.js";

/**
 * Resolve a preset into concrete prompt sections.
 *
 * @param preset - The base preset
 * @param directives - Optional directives to apply (append/override)
 * @returns Resolved preset with merged sections
 */
export function resolvePreset(
  preset: RpPresetV1,
  directives: PresetDirectiveV1[] = [],
): ResolvedPresetV1 {
  const sections: PromptSectionV1[] = [];
  const conflicts: PresetConflictV1[] = [];
  const appliedDirectiveIds: string[] = [];

  // Convert core rules to sections
  for (const fragment of preset.prompt.coreRules) {
    sections.push(fragmentToSection(fragment, "core_rules", preset.id));
  }

  // Convert style rules to sections
  for (const fragment of preset.prompt.styleRules) {
    sections.push(fragmentToSection(fragment, "node_instruction", preset.id));
  }

  // Convert additional instructions to sections
  for (const fragment of preset.prompt.additionalInstructions) {
    sections.push(fragmentToSection(fragment, "node_instruction", preset.id));
  }

  // Apply directives
  for (const directive of directives) {
    if (directive.merge === "append") {
      // Append: add as new section
      sections.push({
        id: directive.fragment.id,
        title: directive.fragment.content.slice(0, 60),
        source: "preset",
        content: directive.fragment.content,
        priority: directive.fragment.priority,
        visibility: "model_visible",
        trust: "world_data",
        provenance: {
          presetId: directive.id,
        },
      });
      appliedDirectiveIds.push(directive.id);
    } else if (directive.merge === "override") {
      // Override: find sections that can be overridden and replace if priority is higher
      const existingIndex = sections.findIndex(
        (s) =>
          s.id === directive.fragment.id ||
          (s.source === "preset" && s.provenance?.presetId !== directive.id),
      );

      if (existingIndex >= 0) {
        const existing = sections[existingIndex];
        if (!existing) continue;

        const targetPriority = existing.priority;
        const overridePriority = directive.priority ?? 0;

        if (overridePriority > targetPriority) {
          conflicts.push({
            targetId: existing.id,
            overriddenFragmentId: existing.provenance?.presetId ?? "unknown",
            overridingFragmentId: directive.fragment.id,
            reason: `Override priority ${overridePriority} > ${targetPriority}`,
          });

          sections[existingIndex] = {
            ...existing,
            content: directive.fragment.content,
            priority: directive.fragment.priority,
            provenance: {
              ...existing.provenance,
              presetId: directive.id,
            },
          };
          appliedDirectiveIds.push(directive.id);
        } else {
          conflicts.push({
            targetId: existing.id,
            overriddenFragmentId: directive.fragment.id,
            overridingFragmentId: existing.provenance?.presetId ?? "unknown",
            reason: `Override priority ${overridePriority} <= ${targetPriority}, not applied`,
          });
        }
      } else {
        // No section found to override - this is a conflict
        conflicts.push({
          targetId: directive.fragment.id,
          overriddenFragmentId: "none",
          overridingFragmentId: directive.fragment.id,
          reason: `No section found to override for target '${directive.target}'`,
        });
      }
    }
  }

  // Build model config
  const modelConfig: Record<string, unknown> = {};
  if (preset.model?.model) modelConfig.model = preset.model.model;
  if (preset.model?.temperature !== undefined) modelConfig.temperature = preset.model.temperature;
  if (preset.model?.maxOutputTokens !== undefined) {
    modelConfig.maxOutputTokens = preset.model.maxOutputTokens;
  }

  return {
    presetId: preset.id,
    modelConfig,
    promptSections: sections,
    outputContract: preset.outputContract,
    diagnostics: {
      appliedDirectiveIds,
      conflicts,
    },
  };
}

function fragmentToSection(
  fragment: PromptFragmentV1,
  source: PromptSectionV1["source"],
  presetId: string,
): PromptSectionV1 {
  return {
    id: fragment.id,
    title: fragment.content.slice(0, 60),
    source,
    content: fragment.content,
    priority: fragment.priority,
    visibility: "model_visible",
    trust: "system",
    provenance: {
      presetId,
    },
  };
}
