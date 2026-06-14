import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type {
  ParsedInput,
  TimelineContext,
  LoreContext,
  TrackerState,
  RecentMessage,
  AssembledContext,
  BudgetReport,
  TokenEstimationMethod,
} from "../types.js";
import type { PromptDocumentV1, PromptSectionV1 } from "../prompt/types.js";
import { validateSchema } from "../schemas.js";
import { enforceBudget, estimateTokens, buildBudgetWarnings } from "../assembler/budget.js";

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
      id: "recentMessages",
      label: "Recent Messages",
      dataType: "json",
      direction: "input",
      required: false,
    },
    {
      id: "assembledContext",
      label: "Assembled Context",
      dataType: "json",
      direction: "output",
      schemaId: "rp.assembled-context.v1",
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
    const { parsedInput, timelineContext, loreContext, trackerState, recentMessages } =
      input.inputs;

    if (!parsedInput || typeof parsedInput !== "object") {
      throw new Error("rpContextAssemblerV1: parsedInput is required");
    }

    const parsed = parsedInput as ParsedInput;
    const timeline = timelineContext as TimelineContext | undefined;
    const lore = loreContext as LoreContext | undefined;
    const tracker = trackerState as TrackerState | undefined;
    const messages = recentMessages as RecentMessage[] | undefined;

    // Build raw sections
    const sections: Record<string, string> = {
      systemPrompt: buildSystemPrompt(),
      loreSection: buildLoreSection(lore),
      timelineSection: buildTimelineSection(timeline),
      trackerSection: buildTrackerSection(tracker),
      recentMessagesSection: buildRecentMessagesSection(messages, targetTokens, charsPerToken),
      userInputSection: buildUserInputSection(parsed),
    };

    // Apply budget enforcement (B-2.9: shared with V2 via ../assembler/budget).
    // Behavior is identical to the pre-refactor inline implementation;
    // see ../assembler/budget.ts for the algorithm.
    const { finalSections, truncatedSections, droppedSections } = enforceBudget({
      sections,
      priorities: SECTION_PRIORITY,
      targetTokens,
      hardLimitTokens,
      charsPerToken,
      protectedSections: ["userInputSection"],
    });

    // Compute allocated tokens from the original sections (pre-truncation)
    const allocated: Record<string, number> = {};
    for (const [key, content] of Object.entries(sections)) {
      allocated[key] = estimateTokens(content, charsPerToken);
    }

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

    // Validate outputs
    validateSchema("rp.assembled-context.v1", assembledContext);
    validateSchema("rp.budget-report.v1", budgetReport);

    // Build PromptDocumentV1 from sections
    const promptSections: PromptSectionV1[] = [];

    // Add sections from assembled context
    if (assembledContext.systemPrompt) {
      promptSections.push({
        id: "system-prompt",
        title: "System Prompt",
        source: "core_rules",
        content: assembledContext.systemPrompt,
        priority: 100,
        visibility: "model_visible",
        trust: "system",
      });
    }

    if (assembledContext.loreSection) {
      promptSections.push({
        id: "lore-section",
        title: "World & Character Lore",
        source: "worldbook",
        content: assembledContext.loreSection,
        priority: 60,
        visibility: "model_visible",
        trust: "world_data",
      });
    }

    if (assembledContext.timelineSection) {
      promptSections.push({
        id: "timeline-section",
        title: "Story Timeline",
        source: "timeline",
        content: assembledContext.timelineSection,
        priority: 40,
        visibility: "model_visible",
        trust: "world_data",
      });
    }

    if (assembledContext.trackerSection) {
      promptSections.push({
        id: "tracker-section",
        title: "Current State",
        source: "state",
        content: assembledContext.trackerSection,
        priority: 80,
        visibility: "model_visible",
        trust: "runtime",
      });
    }

    if (assembledContext.recentMessagesSection) {
      promptSections.push({
        id: "recent-messages-section",
        title: "Recent Messages",
        source: "recent_messages",
        content: assembledContext.recentMessagesSection,
        priority: 20,
        visibility: "model_visible",
        trust: "world_data",
      });
    }

    if (assembledContext.userInputSection) {
      promptSections.push({
        id: "user-input-section",
        title: "User Input",
        source: "user_input",
        content: assembledContext.userInputSection,
        priority: 99,
        visibility: "model_visible",
        trust: "user_content",
      });
    }

    const promptDocument: PromptDocumentV1 = {
      version: "prompt-document-v1",
      target: "writer",
      sections: promptSections,
    };

    return {
      outputs: { assembledContext, budgetReport, promptDocument },
    };
  };
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

function buildRecentMessagesSection(
  messages: RecentMessage[] | undefined,
  targetTokens: number,
  charsPerToken: number,
): string {
  if (!messages || messages.length === 0) {
    return "";
  }

  // Sort by timestamp ascending (oldest first)
  const sorted = [...messages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Build lines and apply budget: trim oldest messages first, keep most recent
  const lines: string[] = ["[Recent Messages]"];

  // Reserve space for at least the most recent message
  const mostRecent = sorted[sorted.length - 1];
  if (!mostRecent) {
    return "";
  }
  const mostRecentLine = `${mostRecent.role === "user" ? "User" : "Assistant"} (${mostRecent.turnId}): "${mostRecent.text}"`;
  const mostRecentTokens = estimateTokens(mostRecentLine, charsPerToken);

  // Budget for recent messages: max 20% of targetTokens
  const maxRecentTokens = Math.floor(targetTokens * 0.2);

  // If even the most recent message exceeds budget, truncate it
  if (mostRecentTokens > maxRecentTokens) {
    const maxChars = maxRecentTokens * charsPerToken;
    const truncatedText = mostRecent.text.slice(0, maxChars) + "... [truncated]";
    lines.push(
      `${mostRecent.role === "user" ? "User" : "Assistant"} (${mostRecent.turnId}): "${truncatedText}"`,
    );
    return lines.join("\n");
  }

  // Add messages from newest to oldest, stopping when budget is exceeded
  const messageLines: string[] = [];
  let accumulatedTokens = 0;

  for (let i = sorted.length - 1; i >= 0; i--) {
    const msg = sorted[i];
    if (!msg) continue;
    const line = `${msg.role === "user" ? "User" : "Assistant"} (${msg.turnId}): "${msg.text}"`;
    const lineTokens = estimateTokens(line, charsPerToken);

    if (accumulatedTokens + lineTokens > maxRecentTokens) {
      break; // Stop adding older messages
    }

    messageLines.unshift(line);
    accumulatedTokens += lineTokens;
  }

  lines.push(...messageLines);
  return lines.join("\n");
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
