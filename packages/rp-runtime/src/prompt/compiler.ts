/**
 * Markdown Prompt Compiler - Phase B-2.6
 *
 * Compiles a PromptDocumentV1 into a Markdown prompt for the LLM.
 * Separates static prefix (for caching) from dynamic context.
 */

import type { PromptDocumentV1, PromptSectionV1, CompiledPromptV1 } from "./types.js";
import type { ResolvedPresetV1 } from "../preset/types.js";

// Simple hash for static prefix verification
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

// Estimate tokens (character-based approximation)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compile a PromptDocumentV1 into a Markdown prompt.
 *
 * @param document - The prompt document to compile
 * @param resolvedPreset - The resolved preset with sections
 * @returns Compiled prompt with static prefix, dynamic context, and diagnostics
 */
export function compilePrompt(
  document: PromptDocumentV1,
  resolvedPreset: ResolvedPresetV1,
): CompiledPromptV1 {
  const staticSections: string[] = [];
  const dynamicSections: string[] = [];
  const includedSectionIds: string[] = [];
  const skippedRuntimeOnlySectionIds: string[] = [];
  const truncatedSectionIds: string[] = [];
  const droppedSectionIds: string[] = [];

  // Merge preset sections with document sections
  // Preset sections have lower priority (go first in static prefix)
  const allSections = [
    ...resolvedPreset.promptSections.map((s) => ({ ...s, isPreset: true })),
    ...document.sections.map((s) => ({ ...s, isPreset: false })),
  ];

  // Sort by priority descending (highest first)
  allSections.sort((a, b) => b.priority - a.priority);

  // Separate into static (system/trust=system) and dynamic (everything else)
  for (const section of allSections) {
    // Skip runtime_only sections
    if (section.visibility === "runtime_only") {
      skippedRuntimeOnlySectionIds.push(section.id);
      continue;
    }

    // Render section content
    const content = renderSectionContent(section);

    if (
      section.trust === "system" ||
      section.source === "core_rules" ||
      section.source === "preset"
    ) {
      // Static prefix: core rules, preset rules, system instructions
      staticSections.push(content);
      includedSectionIds.push(section.id);
    } else {
      // Dynamic context: worldbook, state, timeline, recent messages, user input
      dynamicSections.push(content);
      includedSectionIds.push(section.id);
    }
  }

  // Build static prefix
  const staticPrefix = staticSections.join("\n\n");

  // Build dynamic context
  const dynamicContext = dynamicSections.join("\n\n");

  // Full prompt
  const prompt = staticPrefix + "\n\n" + dynamicContext;

  // Diagnostics
  const estimatedTokens = estimateTokens(prompt);
  const staticPrefixHash = simpleHash(staticPrefix);

  return {
    staticPrefix,
    dynamicContext,
    prompt,
    outputContract: resolvedPreset.outputContract,
    diagnostics: {
      documentVersion: "prompt-document-v1",
      presetId: resolvedPreset.presetId,
      estimatedTokens,
      staticPrefixHash,
      includedSectionIds,
      skippedRuntimeOnlySectionIds,
      truncatedSectionIds,
      droppedSectionIds,
    },
  };
}

function renderSectionContent(section: PromptSectionV1): string {
  const title = section.title || section.id;

  // Handle hidden_constraint sections
  if (section.visibility === "hidden_constraint") {
    return `## [Hidden Constraints]\n> The following information can influence character behavior but must NOT be directly revealed to the player.\n\n${typeof section.content === "string" ? section.content : JSON.stringify(section.content, null, 2)}`;
  }

  // Render content
  const contentStr =
    typeof section.content === "string"
      ? section.content
      : JSON.stringify(section.content, null, 2);

  return `## ${title}\n\n${contentStr}`;
}
