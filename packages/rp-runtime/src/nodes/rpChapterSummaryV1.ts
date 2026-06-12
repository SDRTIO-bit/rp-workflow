import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { ParsedInput, WriterOutput, MemoryEvent } from "../types.js";
import { extractScope } from "./utils.js";
import { validateSchema } from "../schemas.js";

/**
 * Configuration for rpChapterSummaryV1 executor.
 */
export interface RpChapterSummaryConfig {
  /** Maximum summary length in characters. Default: 500 */
  maxSummaryLength?: number;
  /** Default chapter ID if not provided in config. Default: "default" */
  defaultChapterId?: string;
}

/**
 * Services for rpChapterSummaryV1 executor.
 */
export interface RpChapterSummaryServices {
  config?: RpChapterSummaryConfig;
}

/**
 * NodeDefinition for rpChapterSummaryV1.
 * Compresses current turn into a MemoryEvent and generates chapter patch.
 */
export const rpChapterSummaryV1Definition: NodeDefinition = {
  type: "rpChapterSummaryV1",
  label: "RP Chapter Summary",
  category: "roleplay",
  description: "Compresses current turn into a memory event and chapter patch",
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
      id: "writerOutput",
      label: "Writer Output",
      dataType: "json",
      direction: "input",
      required: true,
      schemaId: "rp.writer-output.v1",
    },
    {
      id: "memoryEvent",
      label: "Memory Event",
      dataType: "json",
      direction: "output",
      schemaId: "rp.memory-event.v1",
    },
    {
      id: "chapterPatch",
      label: "Chapter Patch",
      dataType: "json",
      direction: "output",
    },
  ],
};

/**
 * Chapter patch structure for updating chapter's event list.
 */
export interface ChapterPatch {
  chapterId: string;
  addEventId: string;
  updateSummary?: string;
}

/**
 * Factory function that creates the executor for rpChapterSummaryV1.
 */
export function createRpChapterSummaryV1Executor(
  services?: RpChapterSummaryServices,
): NodeExecutor {
  const maxSummaryLength = services?.config?.maxSummaryLength ?? 500;
  const defaultChapterId = services?.config?.defaultChapterId ?? "default";

  return async (input: NodeExecutionInput) => {
    const scope = extractScope(input.context);
    const { parsedInput, writerOutput } = input.inputs;

    if (!parsedInput || typeof parsedInput !== "object") {
      throw new Error("rpChapterSummaryV1: parsedInput is required");
    }

    if (!writerOutput || typeof writerOutput !== "object") {
      throw new Error("rpChapterSummaryV1: writerOutput is required");
    }

    const parsed = parsedInput as ParsedInput;
    const writer = writerOutput as WriterOutput;

    // Get chapterId from node config or use default
    const chapterId = (input.node.config?.chapterId as string) ?? defaultChapterId;

    // Generate event ID
    const eventId = `evt-${scope.sessionId}-${scope.turnId}-${Date.now()}`;

    // Build summary from writer output (MVP: truncate, future: LLM summarization)
    const summary = buildSummary(writer.text, maxSummaryLength);

    // Extract entities from parsed input
    const characters = [...parsed.entities.characters];
    const locations = [...parsed.entities.locations];
    const items = [...parsed.entities.items];

    // Extract emotional changes from dialogues (MVP: simple extraction)
    const emotionalChanges = extractEmotionalChanges(parsed);

    // Extract time hints
    const time: string | null =
      parsed.entities.timeHints.length > 0 ? (parsed.entities.timeHints[0] ?? null) : null;

    const memoryEvent: MemoryEvent = {
      eventId,
      sessionId: scope.sessionId,
      worldId: scope.worldId,
      chapterId,
      sourceTurnId: scope.turnId,
      summary,
      characters,
      locations,
      items,
      time,
      emotionalChanges,
      createdAt: new Date().toISOString(),
    };

    // Generate chapter patch
    const chapterPatch: ChapterPatch = {
      chapterId,
      addEventId: eventId,
      updateSummary: summary,
    };

    // Validate memory event
    validateSchema("rp.memory-event.v1", memoryEvent);

    return {
      outputs: { memoryEvent, chapterPatch },
    };
  };
}

/**
 * Build summary from writer output text.
 * MVP: truncate to max length. Future: use LLM for intelligent summarization.
 */
function buildSummary(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  // Truncate at word boundary
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.8) {
    return truncated.slice(0, lastSpace) + "...";
  }
  return truncated + "...";
}

/**
 * Extract emotional changes from parsed input.
 * MVP: simple extraction from dialogue tones.
 */
function extractEmotionalChanges(parsed: ParsedInput): string[] {
  const changes: string[] = [];

  // Extract from dialogue tones
  for (const dialogue of parsed.dialogues) {
    if (dialogue.tone) {
      changes.push(`${dialogue.speaker}: ${dialogue.tone}`);
    }
  }

  // Extract from mood if present
  if (parsed.mood) {
    changes.push(`mood: ${parsed.mood}`);
  }

  return changes;
}
