import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type {
  ParsedInput,
  TimelineContext,
  ChapterSummary,
  MemoryEvent,
  TimelineEventResult,
} from "../types.js";
import type { RpRuntimeServices } from "../stores/types.js";
import { extractScope } from "./utils.js";
import { validateSchema } from "../schemas.js";

/**
 * Configuration for rpTimelineQueryV1 executor.
 */
export interface RpTimelineQueryConfig {
  /** Maximum number of chapters to return. Default: 5 */
  chapterLimit?: number;
  /** Maximum number of events to return. Default: 20 */
  eventLimit?: number;
}

/**
 * Services for rpTimelineQueryV1 executor.
 */
export interface RpTimelineQueryServices {
  stores: RpRuntimeServices["stores"];
  config?: RpTimelineQueryConfig;
}

/**
 * NodeDefinition for rpTimelineQueryV1.
 * Queries timeline store for relevant chapters and events based on parsed input.
 *
 * Scoring formula (deterministic):
 * - Keyword match in summary: +1 per match
 * - Character entity overlap: +3 per character
 * - Location entity overlap: +2 per location
 * - Item entity overlap: +1 per item
 * - Same score → stable sort by eventId
 */
export const rpTimelineQueryV1Definition: NodeDefinition = {
  type: "rpTimelineQueryV1",
  label: "RP Timeline Query",
  category: "roleplay",
  description: "Queries timeline store for relevant chapters and events with scoring",
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
      direction: "output",
      schemaId: "rp.timeline-context.v1",
    },
  ],
};

/**
 * Factory function that creates the executor for rpTimelineQueryV1.
 */
export function createRpTimelineQueryV1Executor(services: RpTimelineQueryServices): NodeExecutor {
  const chapterLimit = services.config?.chapterLimit ?? 5;
  const eventLimit = services.config?.eventLimit ?? 20;

  return async (input: NodeExecutionInput) => {
    const scope = extractScope(input.context);
    const { parsedInput } = input.inputs;

    if (!parsedInput || typeof parsedInput !== "object") {
      throw new Error("rpTimelineQueryV1: parsedInput is required");
    }

    const parsed = parsedInput as ParsedInput;
    const startTime = Date.now();

    // Extract query keywords from parsed input
    const keywords = extractQueryKeywords(parsed);
    const queryEntities = {
      characters: parsed.entities.characters.map((c) => c.toLowerCase()),
      locations: parsed.entities.locations.map((l) => l.toLowerCase()),
      items: parsed.entities.items.map((i) => i.toLowerCase()),
    };

    // Query timeline store
    const query = keywords.join(" ");
    const events = await services.stores.timeline.queryEvents({
      sessionId: scope.sessionId,
      worldId: scope.worldId,
      query,
      limit: eventLimit * 2, // Fetch more to allow scoring and filtering
    });

    // Score each event with matchedBy
    const scoredEvents: TimelineEventResult[] = events.map((event) => {
      const { score, matchedBy } = calculateEventScore(event, keywords, queryEntities);
      return {
        ...event,
        score,
        matchedBy,
      };
    });

    // Filter events with score > 0, sort by score desc, then eventId for stability
    const relevantEvents = scoredEvents
      .filter((e) => e.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.eventId.localeCompare(b.eventId); // Stable sort
      })
      .slice(0, eventLimit);

    // Group events by chapter and build chapter summaries
    const chapterMap = new Map<string, { chapterId: string; events: TimelineEventResult[] }>();
    for (const event of relevantEvents) {
      const existing = chapterMap.get(event.chapterId);
      if (existing) {
        existing.events.push(event);
      } else {
        chapterMap.set(event.chapterId, { chapterId: event.chapterId, events: [event] });
      }
    }

    // Build chapter summaries with relevance scores
    const chapters: ChapterSummary[] = [];
    for (const [chapterId, data] of chapterMap) {
      const relevanceScore = data.events.reduce((sum, e) => sum + e.score, 0);
      chapters.push({
        chapterId,
        summary: buildChapterSummary(data.events),
        relevanceScore,
      });
    }

    // Sort by relevance score descending, then by chapterId for stability
    chapters.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      return a.chapterId.localeCompare(b.chapterId);
    });

    // Limit chapters
    const limitedChapters = chapters.slice(0, chapterLimit);

    const queryTimeMs = Date.now() - startTime;

    const timelineContext: TimelineContext = {
      chapters: limitedChapters,
      relevantEvents,
      totalChapters: chapters.length,
      queryTimeMs,
    };

    validateSchema("rp.timeline-context.v1", timelineContext);

    return {
      outputs: { timelineContext },
    };
  };
}

/**
 * Extract query keywords from parsed input.
 * Combines entities, intents, and raw text tokens.
 */
function extractQueryKeywords(parsed: ParsedInput): string[] {
  const keywords: string[] = [];

  // Add entities
  keywords.push(...parsed.entities.characters);
  keywords.push(...parsed.entities.locations);
  keywords.push(...parsed.entities.items);
  keywords.push(...parsed.entities.timeHints);

  // Add intents
  keywords.push(...parsed.intents);

  // Extract key tokens from raw text (simple tokenization)
  const tokens = parsed.rawText
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2); // Filter short words

  keywords.push(...tokens);

  // Deduplicate
  return [...new Set(keywords)];
}

/**
 * Calculate relevance score for an event based on keyword and entity matches.
 *
 * Scoring formula:
 * - Keyword match in summary: +1 per match
 * - Character entity overlap: +3 per character
 * - Location entity overlap: +2 per location
 * - Item entity overlap: +1 per item
 *
 * Returns score and matchedBy array for debugging.
 */
function calculateEventScore(
  event: MemoryEvent,
  keywords: string[],
  queryEntities: { characters: string[]; locations: string[]; items: string[] },
): { score: number; matchedBy: string[] } {
  let score = 0;
  const matchedBy: string[] = [];
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  const summary = event.summary.toLowerCase();

  // Keyword matches in summary
  for (const keyword of lowerKeywords) {
    if (summary.includes(keyword)) {
      score += 1;
      matchedBy.push(`keyword:${keyword}`);
    }
  }

  // Character entity overlap (+3 each)
  for (const char of event.characters) {
    if (queryEntities.characters.includes(char.toLowerCase())) {
      score += 3;
      matchedBy.push(`character:${char}`);
    }
  }

  // Location entity overlap (+2 each)
  for (const loc of event.locations) {
    if (queryEntities.locations.includes(loc.toLowerCase())) {
      score += 2;
      matchedBy.push(`location:${loc}`);
    }
  }

  // Item entity overlap (+1 each)
  for (const item of event.items) {
    if (queryEntities.items.includes(item.toLowerCase())) {
      score += 1;
      matchedBy.push(`item:${item}`);
    }
  }

  return { score, matchedBy };
}

/**
 * Build a summary string from chapter events.
 */
function buildChapterSummary(events: TimelineEventResult[]): string {
  if (events.length === 0) return "";

  // Combine event summaries
  const summaries = events.map((e) => e.summary).filter((s) => s.length > 0);
  if (summaries.length === 0) return "";

  // Truncate if too long
  const combined = summaries.join(" ");
  if (combined.length > 500) {
    return combined.slice(0, 497) + "...";
  }
  return combined;
}
