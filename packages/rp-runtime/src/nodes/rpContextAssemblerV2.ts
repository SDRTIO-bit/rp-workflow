/**
 * RP Context Assembler V2 - Phase B-2.9
 *
 * Assembles ParsedRpInputV1 + WorldbookRetrievalResult into a structured
 * context that preserves the new parser's rich data:
 * - Per-parser-field sections (mentions, references, dialogues, ...)
 * - Worldbook split into 3 explicit retrieval-source sections
 *   (directHit / deterministicExpansion / semanticExpansion) read from
 *   the provenance field, NEVER inferred from array order.
 *
 * V1 is untouched. V2 has its own input ports, output ports, schema, and
 * AssembledContext shape. Old workflows using rpContextAssemblerV1 keep
 * working unchanged.
 *
 * Required inputs:
 * - parsedRpInput (rp.parsed-rp-input.v1)
 * - worldbookRetrieval (rp.worldbook-retrieval-result.v1)
 *
 * Both are required. If worldbookRetrieval.provenance is missing, the
 * assembler throws (no silent fallback to inference).
 *
 * Budget logic is shared with V1 via ../assembler/budget.ts. Priority
 * table is V2-specific; user input is protected.
 */

import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type {
  BudgetReport,
  TokenEstimationMethod,
  RecentMessage,
  TimelineContext,
  TrackerState,
} from "../types.js";
import type { PromptDocumentV1 } from "../prompt/types.js";
import type { ParsedRpInputV1 } from "../parser/types.js";
import type { WorldbookRetrievalResult } from "../worldbook/types.js";
import type { AssembledContextV2 } from "../assembler/types.js";
import { validateSchema } from "../schemas.js";
import { enforceBudget, estimateTokens, buildBudgetWarnings } from "../assembler/budget.js";
import {
  V2_SECTION_PRIORITY,
  buildAllV2Sections,
  buildV2PromptDocument,
  buildSystemPromptV2,
  collectParserFieldsCovered,
  buildTimelineSection,
  buildTrackerSection,
  buildRecentMessagesSection,
} from "../assembler/sectionsV2.js";

/**
 * Configuration for rpContextAssemblerV2 executor.
 */
export interface RpAssemblerV2Config {
  /** Target token budget for assembled context. Default: 3000 */
  targetTokens?: number;
  /** Hard limit - context will be truncated to fit. Default: 4000 */
  hardLimitTokens?: number;
  /** Characters per token estimate. Default: 4 */
  charsPerToken?: number;
}

/**
 * Services for rpContextAssemblerV2 executor.
 */
export interface RpAssemblerV2Services {
  config?: RpAssemblerV2Config;
}

/**
 * NodeDefinition for rpContextAssemblerV2.
 */
export const rpContextAssemblerV2Definition: NodeDefinition = {
  type: "rpContextAssemblerV2",
  label: "RP Context Assembler (V2, B-2.9)",
  category: "roleplay",
  description:
    "Assembles ParsedRpInputV1 + WorldbookRetrievalResult with explicit per-source provenance and per-parser-field sections",
  color: "#a855f7",
  ports: [
    {
      id: "parsedRpInput",
      label: "Parsed RP Input",
      dataType: "json",
      direction: "input",
      required: true,
      schemaId: "rp.parsed-rp-input.v1",
    },
    {
      id: "worldbookRetrieval",
      label: "Worldbook Retrieval",
      dataType: "json",
      direction: "input",
      required: true,
      schemaId: "rp.worldbook-retrieval-result-with-provenance.v1",
    },
    {
      id: "timelineContext",
      label: "Timeline Context",
      dataType: "json",
      direction: "input",
      required: false,
      schemaId: "rp.timeline-context.v1",
    },
    {
      id: "trackerState",
      label: "Tracker State",
      dataType: "json",
      direction: "input",
      required: false,
      schemaId: "rp.tracker-state.v1",
    },
    {
      id: "recentMessages",
      label: "Recent Messages",
      dataType: "json",
      direction: "input",
      required: false,
    },
    {
      id: "assembledContext",
      label: "Assembled Context (V2)",
      dataType: "json",
      direction: "output",
      schemaId: "rp.assembled-context-v2",
    },
    {
      id: "promptDocument",
      label: "Prompt Document",
      dataType: "json",
      direction: "output",
    },
    {
      id: "budgetReport",
      label: "Budget Report",
      dataType: "json",
      direction: "output",
      schemaId: "rp.budget-report.v1",
    },
  ],
};

/**
 * Factory function that creates the executor for rpContextAssemblerV2.
 */
export function createRpContextAssemblerV2Executor(services?: RpAssemblerV2Services): NodeExecutor {
  const targetTokens = services?.config?.targetTokens ?? 3000;
  const hardLimitTokens = services?.config?.hardLimitTokens ?? 4000;
  const charsPerToken = services?.config?.charsPerToken ?? 4;
  const tokenEstimationMethod: TokenEstimationMethod = "character_ratio";

  return async (input: NodeExecutionInput) => {
    const { parsedRpInput, worldbookRetrieval, timelineContext, trackerState, recentMessages } =
      input.inputs;

    if (!parsedRpInput || typeof parsedRpInput !== "object") {
      throw new Error("rpContextAssemblerV2: parsedRpInput is required");
    }
    if (!worldbookRetrieval || typeof worldbookRetrieval !== "object") {
      throw new Error("rpContextAssemblerV2: worldbookRetrieval is required");
    }

    const parsed = parsedRpInput as ParsedRpInputV1;
    const retrieval = worldbookRetrieval as WorldbookRetrievalResult;

    // Validate input schemas
    validateSchema("rp.parsed-rp-input.v1", parsed);
    validateSchema("rp.worldbook-retrieval-result-with-provenance.v1", retrieval);

    // provenance is guaranteed by strict schema validation above; a
    // double-check for runtime safety (catches direct type assertions
    // that bypass the workflow validator).
    if (!retrieval.provenance) {
      throw new Error(
        "rpContextAssemblerV2: worldbookRetrieval.provenance is required. " +
          "The strict schema should have enforced this at validation time.",
      );
    }

    // Per-section soft budgets for entry-level trimming in lore sections.
    // Each lore section gets a % of the total char budget. Entries within
    // a section are sorted by entry.priority DESC; when the section's soft
    // budget is exceeded, the lowest-priority entries are dropped.
    const totalChars = targetTokens * charsPerToken;
    const softBudgetChars = {
      directHit: Math.floor(totalChars * 0.3),
      deterministic: Math.floor(totalChars * 0.2),
      semantic: Math.floor(totalChars * 0.15),
    };

    // Build all section texts (in V2's stable order).
    // Pass soft budgets to lore section builders for entry-level trim.
    const sectionTexts = buildAllV2Sections(parsed, retrieval, softBudgetChars);

    // Build non-Parser-context sections (B-2.9.1 parity with V1)
    const timeline = timelineContext as TimelineContext | undefined;
    const tracker = trackerState as TrackerState | undefined;
    const messages = recentMessages as RecentMessage[] | undefined;
    const nonParserSections: Record<string, string> = {
      timelineSection: buildTimelineSection(timeline).text,
      trackerSection: buildTrackerSection(tracker).text,
      recentMessagesSection: buildRecentMessagesSection(messages).text,
    };

    // Combine all sections
    const sectionsWithSystemPrompt: Record<string, string> = {
      systemPrompt: buildSystemPromptV2(),
      ...sectionTexts,
      ...nonParserSections,
    };

    // Pre-budget allocated tokens
    const allocated: Record<string, number> = {};
    for (const [key, content] of Object.entries(sectionsWithSystemPrompt)) {
      allocated[key] = estimateTokens(content, charsPerToken);
    }

    // Apply shared budget enforcement.
    // Protected: systemPrompt (core rules) and rawUserInputSection.
    const { finalSections, truncatedSections, droppedSections } = enforceBudget({
      sections: sectionsWithSystemPrompt,
      priorities: V2_SECTION_PRIORITY,
      targetTokens,
      hardLimitTokens,
      charsPerToken,
      protectedSections: ["systemPrompt", "rawUserInputSection"],
    });

    // Build the AssembledContextV2 shape
    const fullContext = Object.values(finalSections)
      .filter((s) => s.length > 0)
      .join("\n\n");

    const actualTokens = estimateTokens(fullContext, charsPerToken);
    const budgetReport: BudgetReport = {
      targetTokens,
      hardLimitTokens,
      allocated,
      actual: { total: actualTokens },
      truncatedSections,
      droppedSections,
      tokenEstimationMethod,
      warnings: buildBudgetWarnings(
        actualTokens,
        targetTokens,
        hardLimitTokens,
        truncatedSections,
        droppedSections,
      ),
    };

    // Collect entry-level trigger provenance from the retrieval
    const entryTriggersCovered: Array<{ entryId: string; fields: string[] }> = [];
    const allRetrievedIds = new Set([
      ...(retrieval.provenance.directHitIds ?? []),
      ...(retrieval.provenance.deterministicExpansionIds ?? []),
      ...(retrieval.provenance.semanticExpansionIds ?? []),
    ]);
    if (retrieval.provenance.entryTriggers) {
      for (const [entryId, fields] of Object.entries(retrieval.provenance.entryTriggers)) {
        if (allRetrievedIds.has(entryId)) {
          entryTriggersCovered.push({ entryId, fields });
        }
      }
    }
    // Sort stable for deterministic output
    entryTriggersCovered.sort((a, b) => a.entryId.localeCompare(b.entryId));

    // Build lore entries dropped list from the lore builders' metadata.
    // This is a best-effort diagnostic — the lore builders may not have
    // been called if the worldbookRetrieval was absent (prevented above).
    const loreEntriesDropped = [
      ...(retrieval.provenance.directHitIds.filter(
        (id) => !finalSections.loreDirectHitSection?.includes(`id=${id}`),
      ) ?? []),
    ];

    const assembledContext: AssembledContextV2 = {
      version: "assembled-context-v2",
      systemPrompt: finalSections.systemPrompt ?? "",
      mentionsSection: finalSections.mentionsSection ?? "",
      referencesSection: finalSections.referencesSection ?? "",
      dialoguesSection: finalSections.dialoguesSection ?? "",
      actionsSection: finalSections.actionsSection ?? "",
      intentsSection: finalSections.intentsSection ?? "",
      historicalReferencesSection: finalSections.historicalReferencesSection ?? "",
      relationshipSignalsSection: finalSections.relationshipSignalsSection ?? "",
      unresolvedReferencesSection: finalSections.unresolvedReferencesSection ?? "",
      rawUserInputSection: finalSections.rawUserInputSection ?? "",
      timelineSection: finalSections.timelineSection ?? "",
      trackerSection: finalSections.trackerSection ?? "",
      recentMessagesSection: finalSections.recentMessagesSection ?? "",
      loreDirectHitSection: finalSections.loreDirectHitSection ?? "",
      loreDeterministicExpansionSection: finalSections.loreDeterministicExpansionSection ?? "",
      loreSemanticExpansionSection: finalSections.loreSemanticExpansionSection ?? "",
      fullContext,
      budgetReport,
      parserFieldsCovered: collectParserFieldsCovered(parsed),
      entryTriggersCovered,
      loreEntriesDropped,
    };

    validateSchema("rp.assembled-context-v2", assembledContext);
    validateSchema("rp.budget-report.v1", budgetReport);

    // Build the PromptDocument. This stamps provenance on each section.
    const { sections: promptSections } = buildV2PromptDocument(parsed, retrieval);
    // Add non-parser context sections to the prompt document
    const hasTimeline = timelineContext && typeof timelineContext === "object";
    const hasTracker = trackerState && typeof trackerState === "object";
    const hasRecentMessages = recentMessages && Array.isArray(recentMessages);

    const additionalSections: PromptDocumentV1["sections"] = [
      hasTimeline &&
        finalSections.timelineSection && {
          id: "timelineSection",
          title: "Story Timeline",
          source: "timeline" as const,
          content: finalSections.timelineSection,
          priority: V2_SECTION_PRIORITY.timelineSection ?? 45,
          visibility: "model_visible" as const,
          trust: "world_data" as const,
        },
      hasTracker &&
        finalSections.trackerSection && {
          id: "trackerSection",
          title: "Current State",
          source: "state" as const,
          content: finalSections.trackerSection,
          priority: V2_SECTION_PRIORITY.trackerSection ?? 73,
          visibility: "model_visible" as const,
          trust: "world_data" as const,
        },
      hasRecentMessages &&
        finalSections.recentMessagesSection && {
          id: "recentMessagesSection",
          title: "Recent Messages",
          source: "recent_messages" as const,
          content: finalSections.recentMessagesSection,
          priority: V2_SECTION_PRIORITY.recentMessagesSection ?? 30,
          visibility: "model_visible" as const,
          trust: "world_data" as const,
        },
    ].filter(Boolean) as PromptDocumentV1["sections"];

    const allSections = [...promptSections, ...additionalSections];

    // Post-filter: keep only sections whose content was not fully truncated by budget
    const nonEmpty = allSections.filter((s) => {
      const kept = finalSections[s.id];
      return kept !== undefined && kept.length > 0;
    });

    const promptDocument: PromptDocumentV1 = {
      version: "prompt-document-v1",
      target: "writer",
      sections: nonEmpty,
    };

    return {
      outputs: { assembledContext, promptDocument, budgetReport },
    };
  };
}
