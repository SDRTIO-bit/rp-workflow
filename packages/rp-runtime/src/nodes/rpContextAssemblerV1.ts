import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type {
  ParsedInput,
  TimelineContext,
  LoreContext,
  TrackerState,
  AssembledContext,
  BudgetReport,
  TokenEstimationMethod,
} from "../types.js";
import { validateSchema } from "../schemas.js";

/**
 * Configuration for rpContextAssemblerV1 executor.
 */
export interface RpAssemblerConfig {
  /** Target token budget for assembled context. Default: 3000 */
  targetTokens?: number;
  /** Hard limit - context will be truncated to fit. Default: 4000 */
  hardLimitTokens?: number;
  /** Characters per token estimate. Default: 4 (MVP approximation) */
  charsPerToken?: number;
}

/**
 * Services for rpContextAssemblerV1 executor.
 */
export interface RpAssemblerServices {
  config?: RpAssemblerConfig;
}

/**
 * NodeDefinition for rpContextAssemblerV1.
 * Assembles parsed input, timeline, lore, and tracker into a unified context
 * with budget enforcement.
 */
export const rpContextAssemblerV1Definition: NodeDefinition = {
  type: "rpContextAssemblerV1",
  label: "RP Context Assembler",
  category: "roleplay",
  description:
    "Assembles context from parsed input, timeline, lore, and tracker state with budget enforcement",
  color: "#9333ea",
  ports: [
    {
      id: "parsedInput",
      label: "Parsed Input",
      dataType: "json",
      direction: "input",
      required: true,
      schemaId: "rp.parsed-input.v1",
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
      id: "loreContext",
      label: "Lore Context",
      dataType: "json",
      direction: "input",
      required: false,
      schemaId: "rp.lore-context.v1",
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
      id: "assembledContext",
      label: "Assembled Context",
      dataType: "json",
      direction: "output",
      schemaId: "rp.assembled-context.v1",
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
 * Section priority (higher = more important, kept first).
 * User input is NEVER dropped.
 */
const SECTION_PRIORITY: Record<string, number> = {
  systemPrompt: 100,
  userInput: 99,
  tracker: 80,
  lore: 60,
  timeline: 40,
  recentMessages: 20,
};

/**
 * Factory function that creates the executor for rpContextAssemblerV1.
 */
export function createRpContextAssemblerV1Executor(services?: RpAssemblerServices): NodeExecutor {
  const targetTokens = services?.config?.targetTokens ?? 3000;
  const hardLimitTokens = services?.config?.hardLimitTokens ?? 4000;
  const charsPerToken = services?.config?.charsPerToken ?? 4;
  const tokenEstimationMethod: TokenEstimationMethod = "character_ratio";

  return async (input: NodeExecutionInput) => {
    const { parsedInput, timelineContext, loreContext, trackerState } = input.inputs;

    if (!parsedInput || typeof parsedInput !== "object") {
      throw new Error("rpContextAssemblerV1: parsedInput is required");
    }

    const parsed = parsedInput as ParsedInput;
    const timeline = timelineContext as TimelineContext | undefined;
    const lore = loreContext as LoreContext | undefined;
    const tracker = trackerState as TrackerState | undefined;

    // Build raw sections
    const sections: Record<string, string> = {
      systemPrompt: buildSystemPrompt(),
      loreSection: buildLoreSection(lore),
      timelineSection: buildTimelineSection(timeline),
      trackerSection: buildTrackerSection(tracker),
      recentMessagesSection: buildRecentMessagesSection(),
      userInputSection: buildUserInputSection(parsed),
    };

    // Calculate token estimates for each section
    const sectionTokens: Record<string, number> = {};
    for (const [key, content] of Object.entries(sections)) {
      sectionTokens[key] = estimateTokens(content, charsPerToken);
    }

    // Apply budget enforcement
    const { finalSections, truncatedSections, droppedSections } = enforceBudget(
      sections,
      sectionTokens,
      targetTokens,
      hardLimitTokens,
      charsPerToken,
    );

    // Assemble final context
    const assembledContext: AssembledContext = {
      systemPrompt: finalSections.systemPrompt ?? "",
      loreSection: finalSections.loreSection ?? "",
      timelineSection: finalSections.timelineSection ?? "",
      trackerSection: finalSections.trackerSection ?? "",
      recentMessagesSection: finalSections.recentMessagesSection ?? "",
      userInputSection: finalSections.userInputSection ?? "",
      fullContext: buildFullContext(finalSections),
    };

    // Build budget report
    const actualTokens = estimateTokens(assembledContext.fullContext, charsPerToken);
    const budgetReport: BudgetReport = {
      targetTokens,
      hardLimitTokens,
      allocated: sectionTokens,
      actual: { total: actualTokens },
      truncatedSections,
      droppedSections,
      tokenEstimationMethod,
      warnings: buildWarnings(
        actualTokens,
        targetTokens,
        hardLimitTokens,
        truncatedSections,
        droppedSections,
      ),
    };

    // Validate outputs
    validateSchema("rp.assembled-context.v1", assembledContext);
    validateSchema("rp.budget-report.v1", budgetReport);

    return {
      outputs: { assembledContext, budgetReport },
    };
  };
}

function estimateTokens(text: string, charsPerToken: number): number {
  return Math.ceil(text.length / charsPerToken);
}

interface BudgetResult {
  finalSections: Record<string, string>;
  truncatedSections: string[];
  droppedSections: string[];
}

/**
 * Enforce budget by truncating or dropping sections based on priority.
 * User input is NEVER dropped.
 */
function enforceBudget(
  sections: Record<string, string>,
  sectionTokens: Record<string, number>,
  targetTokens: number,
  hardLimitTokens: number,
  charsPerToken: number,
): BudgetResult {
  const totalTokens = Object.values(sectionTokens).reduce((a, b) => a + b, 0);

  // If within target, no truncation needed
  if (totalTokens <= targetTokens) {
    return {
      finalSections: { ...sections },
      truncatedSections: [],
      droppedSections: [],
    };
  }

  // Need to reduce - sort sections by priority (ascending = lowest priority first)
  const sectionEntries = Object.entries(sections).map(([key, content]) => ({
    key,
    content,
    tokens: sectionTokens[key],
    priority: SECTION_PRIORITY[key] ?? 0,
  }));

  // Sort by priority ascending (lowest priority first for truncation)
  sectionEntries.sort((a, b) => a.priority - b.priority);

  const finalSections: Record<string, string> = { ...sections };
  const truncatedSections: string[] = [];
  const droppedSections: string[] = [];
  let currentTokens = totalTokens;

  for (const entry of sectionEntries) {
    if (currentTokens <= targetTokens) break;

    // Never drop user input
    if (entry.key === "userInputSection") continue;

    const excess = currentTokens - targetTokens;
    const entryTokens = entry.tokens ?? 0;

    if (entryTokens <= excess && entry.priority < 99) {
      // Drop entire section if it's small enough and not critical
      finalSections[entry.key] = "";
      droppedSections.push(entry.key);
      currentTokens -= entryTokens;
    } else if (entryTokens > 0) {
      // Truncate section to fit
      const targetChars = Math.max(0, (entryTokens - excess) * charsPerToken);
      if (targetChars < entry.content.length) {
        finalSections[entry.key] = entry.content.slice(0, targetChars) + "... [truncated]";
        truncatedSections.push(entry.key);
        currentTokens = estimateTokens(Object.values(finalSections).join(""), charsPerToken);
      }
    }
  }

  // Final check: if still over hard limit, aggressively truncate lowest priority
  const finalTotal = estimateTokens(Object.values(finalSections).join(""), charsPerToken);

  if (finalTotal > hardLimitTokens) {
    // Force truncate from lowest priority sections
    for (const entry of sectionEntries) {
      if (entry.key === "userInputSection") continue;
      const sectionContent = finalSections[entry.key] ?? "";
      if (sectionContent.length > 0) {
        const maxChars = Math.floor(hardLimitTokens * charsPerToken * 0.3); // Give 30% to each non-critical
        if (sectionContent.length > maxChars) {
          finalSections[entry.key] = sectionContent.slice(0, maxChars) + "... [hard truncated]";
          if (!truncatedSections.includes(entry.key)) {
            truncatedSections.push(entry.key);
          }
        }
      }
    }
  }

  return { finalSections, truncatedSections, droppedSections };
}

function buildWarnings(
  actualTokens: number,
  targetTokens: number,
  hardLimitTokens: number,
  truncatedSections: string[],
  droppedSections: string[],
): string[] {
  const warnings: string[] = [];

  if (actualTokens > hardLimitTokens) {
    warnings.push(`Context exceeds hard limit: ${actualTokens} > ${hardLimitTokens} tokens`);
  } else if (actualTokens > targetTokens) {
    warnings.push(`Context exceeds target budget: ${actualTokens} > ${targetTokens} tokens`);
  }

  if (truncatedSections.length > 0) {
    warnings.push(`Truncated sections: ${truncatedSections.join(", ")}`);
  }

  if (droppedSections.length > 0) {
    warnings.push(`Dropped sections: ${droppedSections.join(", ")}`);
  }

  return warnings;
}

function buildSystemPrompt(): string {
  return "You are a creative writing assistant for interactive roleplay. Continue the story naturally, maintaining character consistency and world coherence.";
}

function buildLoreSection(lore: LoreContext | undefined): string {
  if (!lore || lore.entries.length === 0) {
    return "";
  }

  const lines = ["[World & Character Lore]"];
  for (const entry of lore.entries) {
    lines.push(`- ${entry.title}: ${entry.content}`);
  }
  return lines.join("\n");
}

function buildTimelineSection(timeline: TimelineContext | undefined): string {
  if (!timeline || timeline.chapters.length === 0) {
    return "";
  }

  const lines = ["[Story Timeline]"];
  for (const chapter of timeline.chapters) {
    lines.push(`Chapter ${chapter.chapterId}:`);
    lines.push(`  Summary: ${chapter.summary}`);
  }
  return lines.join("\n");
}

function buildTrackerSection(tracker: TrackerState | undefined): string {
  if (!tracker) {
    return "";
  }

  const lines = ["[Current State]"];

  if (tracker.characters.length > 0) {
    lines.push("Characters:");
    for (const char of tracker.characters) {
      const status = char.status ? ` (${char.status})` : "";
      lines.push(`  - ${char.name}${status}`);
    }
  }

  if (tracker.locations.length > 0) {
    lines.push("Locations:");
    for (const loc of tracker.locations) {
      lines.push(`  - ${loc.name}`);
    }
  }

  if (tracker.items.length > 0) {
    lines.push("Items:");
    for (const item of tracker.items) {
      lines.push(`  - ${item.name}`);
    }
  }

  return lines.join("\n");
}

function buildRecentMessagesSection(): string {
  // MVP: no recent messages
  return "";
}

function buildUserInputSection(parsed: ParsedInput): string {
  const lines = ["[User Input]"];
  lines.push(parsed.rawText);

  if (parsed.dialogues.length > 0) {
    lines.push("\nDialogues:");
    for (const d of parsed.dialogues) {
      lines.push(`  ${d.speaker}: "${d.text}"`);
    }
  }

  if (parsed.actions.length > 0) {
    lines.push("\nActions:");
    for (const a of parsed.actions) {
      lines.push(`  *${a}*`);
    }
  }

  return lines.join("\n");
}

function buildFullContext(sections: Record<string, string>): string {
  return Object.values(sections)
    .filter((s) => s.length > 0)
    .join("\n\n");
}
