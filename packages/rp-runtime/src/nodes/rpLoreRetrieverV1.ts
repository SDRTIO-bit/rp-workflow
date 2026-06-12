import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { ParsedInput, LoreContext, LoreEntry, LoreEntryResult } from "../types.js";
import type { RpRuntimeServices } from "../stores/types.js";
import { extractScope } from "./utils.js";
import { validateSchema } from "../schemas.js";

/**
 * Configuration for rpLoreRetrieverV1 executor.
 */
export interface RpLoreRetrieverConfig {
  /** Maximum number of lore entries to return. Default: 10 */
  limit?: number;
  /** Maximum tokens for always_on entries. Default: 500 */
  alwaysOnBudgetTokens?: number;
  /** Characters per token estimate. Default: 4 */
  charsPerToken?: number;
}

/**
 * Services for rpLoreRetrieverV1 executor.
 */
export interface RpLoreRetrieverServices {
  stores: RpRuntimeServices["stores"];
  config?: RpLoreRetrieverConfig;
}

/**
 * NodeDefinition for rpLoreRetrieverV1.
 * Retrieves relevant lore entries from lore store based on parsed input.
 *
 * Activation modes:
 * - always_on: Auto-included, subject to token budget
 * - triggered: Matched by keywords and entities
 * - manual_off: Never auto-included
 *
 * Scoring (for triggered entries):
 * - Exact keyword match: +3
 * - Partial keyword match: +1
 * - Title match: +2
 * - Content match: +1
 * - Same score → sort by priority desc, then id for stability
 */
export const rpLoreRetrieverV1Definition: NodeDefinition = {
  type: "rpLoreRetrieverV1",
  label: "RP Lore Retriever",
  category: "roleplay",
  description: "Retrieves relevant lore entries with activation mode filtering",
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
      id: "loreContext",
      label: "Lore Context",
      dataType: "json",
      direction: "output",
      schemaId: "rp.lore-context.v1",
    },
  ],
};

/**
 * Factory function that creates the executor for rpLoreRetrieverV1.
 */
export function createRpLoreRetrieverV1Executor(services: RpLoreRetrieverServices): NodeExecutor {
  const limit = services.config?.limit ?? 10;
  const alwaysOnBudgetTokens = services.config?.alwaysOnBudgetTokens ?? 500;
  const charsPerToken = services.config?.charsPerToken ?? 4;

  return async (input: NodeExecutionInput) => {
    const scope = extractScope(input.context);
    const { parsedInput } = input.inputs;

    if (!parsedInput || typeof parsedInput !== "object") {
      throw new Error("rpLoreRetrieverV1: parsedInput is required");
    }

    const parsed = parsedInput as ParsedInput;

    // Extract keywords for matching
    const keywords = extractKeywords(parsed);
    const queryEntities = {
      characters: parsed.entities.characters.map((c) => c.toLowerCase()),
      locations: parsed.entities.locations.map((l) => l.toLowerCase()),
      items: parsed.entities.items.map((i) => i.toLowerCase()),
    };

    // Query lore store with keywords
    const allEntries = await services.stores.lore.query({
      sessionId: scope.sessionId,
      worldId: scope.worldId,
      keywords,
      limit: limit * 3, // Fetch more to allow filtering
    });

    // Separate by activation mode
    const alwaysOn: LoreEntry[] = [];
    const triggered: LoreEntry[] = [];
    // manual_off entries are not automatically retrieved

    for (const entry of allEntries) {
      if (entry.activationMode === "always_on") {
        alwaysOn.push(entry);
      } else if (entry.activationMode === "triggered") {
        triggered.push(entry);
      }
      // manual_off entries are skipped
    }

    // Apply budget to always_on entries
    const budgetedAlwaysOn = applyAlwaysOnBudget(alwaysOn, alwaysOnBudgetTokens, charsPerToken);

    // Add matchedBy for always_on entries
    const alwaysOnResults: LoreEntryResult[] = budgetedAlwaysOn.map((entry) => ({
      ...entry,
      score: 0, // always_on entries have no relevance score
      matchedBy: ["activation:always_on"],
    }));

    // Score and sort triggered entries
    const scoredTriggered: LoreEntryResult[] = triggered
      .map((entry) => {
        const { score, matchedBy } = calculateRelevanceScore(entry, keywords, queryEntities);
        return { entry, score, matchedBy };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        // Sort by score descending, then by priority descending, then by id for stability
        if (b.score !== a.score) return b.score - a.score;
        if (b.entry.priority !== a.entry.priority) return b.entry.priority - a.entry.priority;
        return a.entry.id.localeCompare(b.entry.id);
      })
      .map((item) => ({
        ...item.entry,
        score: item.score,
        matchedBy: item.matchedBy,
      }));

    // Combine results: always_on first, then triggered
    const combinedEntries: LoreEntryResult[] = [...alwaysOnResults, ...scoredTriggered];

    // Deduplicate by id (shouldn't happen, but safety check)
    const uniqueEntries = deduplicateEntries(combinedEntries);

    // Apply final limit
    const finalEntries = uniqueEntries.slice(0, limit);

    const activatedBy = keywords.filter((k) =>
      finalEntries.some((e) => e.keywords.some((ek) => ek.toLowerCase() === k.toLowerCase())),
    );

    const loreContext: LoreContext = {
      entries: finalEntries,
      activatedBy,
      totalEntries: finalEntries.length,
    };

    validateSchema("rp.lore-context.v1", loreContext);

    return {
      outputs: { loreContext },
    };
  };
}

/**
 * Extract keywords from parsed input for lore matching.
 */
function extractKeywords(parsed: ParsedInput): string[] {
  const keywords: string[] = [];

  // Add entities
  keywords.push(...parsed.entities.characters);
  keywords.push(...parsed.entities.locations);
  keywords.push(...parsed.entities.items);

  // Add intents
  keywords.push(...parsed.intents);

  // Extract key tokens from raw text
  const tokens = parsed.rawText
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  keywords.push(...tokens);

  // Deduplicate
  return [...new Set(keywords)];
}

/**
 * Apply budget constraint to always_on entries.
 * Entries are sorted by priority and truncated if over budget.
 */
function applyAlwaysOnBudget(
  entries: LoreEntry[],
  budgetTokens: number,
  charsPerToken: number,
): LoreEntry[] {
  // Sort by priority descending
  const sorted = [...entries].sort((a, b) => b.priority - a.priority);

  const result: LoreEntry[] = [];
  let usedTokens = 0;

  for (const entry of sorted) {
    const entryTokens = Math.ceil(entry.content.length / charsPerToken);
    if (usedTokens + entryTokens <= budgetTokens) {
      result.push(entry);
      usedTokens += entryTokens;
    } else {
      // Truncate entry to fit remaining budget
      const remainingTokens = budgetTokens - usedTokens;
      if (remainingTokens > 10) {
        // Only include if we can fit at least 10 tokens
        const truncatedContent =
          entry.content.slice(0, remainingTokens * charsPerToken - 20) + "... [truncated]";
        result.push({ ...entry, content: truncatedContent });
        break;
      }
    }
  }

  return result;
}

/**
 * Calculate relevance score for a lore entry based on keyword matches.
 *
 * Scoring formula:
 * - Exact keyword match: +3
 * - Partial keyword match: +1
 * - Title match: +2
 * - Content match: +1
 *
 * Returns score and matchedBy array for debugging.
 */
function calculateRelevanceScore(
  entry: LoreEntry,
  keywords: string[],
  queryEntities: { characters: string[]; locations: string[]; items: string[] },
): { score: number; matchedBy: string[] } {
  let score = 0;
  const matchedBy: string[] = [];
  const lowerKeywords = keywords.map((k) => k.toLowerCase());

  // Check keyword matches
  for (const entryKeyword of entry.keywords) {
    const lowerEntryKeyword = entryKeyword.toLowerCase();
    for (const keyword of lowerKeywords) {
      if (lowerEntryKeyword === keyword) {
        score += 3; // Exact match
        matchedBy.push(`keyword-exact:${entryKeyword}`);
      } else if (lowerEntryKeyword.includes(keyword) || keyword.includes(lowerEntryKeyword)) {
        score += 1; // Partial match
        matchedBy.push(`keyword-partial:${entryKeyword}`);
      }
    }
  }

  // Check title match
  const lowerTitle = entry.title.toLowerCase();
  for (const keyword of lowerKeywords) {
    if (lowerTitle.includes(keyword)) {
      score += 2;
      matchedBy.push(`title:${keyword}`);
    }
  }

  // Check content match
  const lowerContent = entry.content.toLowerCase();
  for (const keyword of lowerKeywords) {
    if (lowerContent.includes(keyword)) {
      score += 1;
      matchedBy.push(`content:${keyword}`);
    }
  }

  // Entity overlap bonuses
  for (const char of queryEntities.characters) {
    if (entry.keywords.some((k) => k.toLowerCase() === char)) {
      matchedBy.push(`entity-character:${char}`);
    }
  }
  for (const loc of queryEntities.locations) {
    if (entry.keywords.some((k) => k.toLowerCase() === loc)) {
      matchedBy.push(`entity-location:${loc}`);
    }
  }
  for (const item of queryEntities.items) {
    if (entry.keywords.some((k) => k.toLowerCase() === item)) {
      matchedBy.push(`entity-item:${item}`);
    }
  }

  return { score, matchedBy: [...new Set(matchedBy)] }; // Deduplicate matchedBy
}

/**
 * Deduplicate entries by id.
 */
function deduplicateEntries(entries: LoreEntryResult[]): LoreEntryResult[] {
  const seen = new Set<string>();
  const result: LoreEntryResult[] = [];

  for (const entry of entries) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      result.push(entry);
    }
  }

  return result;
}
