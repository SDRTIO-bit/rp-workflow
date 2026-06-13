/**
 * Worldbook Retriever V1 - Phase B-2.7
 *
 * Deterministic node that retrieves worldbook entries based on user input.
 * No LLM calls, no network requests.
 */

import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { WorldbookEntryV1, WorldbookRetrievalResult, WorldbookVisibility } from "./types.js";
import { WorldbookRuntimeIndex } from "./index.js";

/**
 * Configuration for rpWorldbookRetrieverV1 executor.
 */
export interface RpWorldbookRetrieverConfig {
  /** Maximum number of entries to return. Default: 20 */
  limit?: number;
  /** Maximum tokens for constant entries. Default: 800 */
  constantBudgetTokens?: number;
  /** Characters per token estimate. Default: 4 */
  charsPerToken?: number;
}

/**
 * Services for rpWorldbookRetrieverV1 executor.
 */
export interface RpWorldbookRetrieverServices {
  config?: RpWorldbookRetrieverConfig;
}

/**
 * NodeDefinition for rpWorldbookRetrieverV1.
 */
export const rpWorldbookRetrieverV1Definition: NodeDefinition = {
  type: "rpWorldbookRetrieverV1",
  label: "RP Worldbook Retriever",
  category: "roleplay",
  description: "Retrieves worldbook entries with keyword/alias matching and related expansion",
  color: "#9333ea",
  ports: [
    {
      id: "rawInput",
      label: "Raw Input",
      dataType: "text",
      direction: "input",
      required: true,
    },
    {
      id: "recentMessages",
      label: "Recent Messages",
      dataType: "json",
      direction: "input",
      required: false,
    },
    {
      id: "worldbookEntries",
      label: "Worldbook Entries",
      dataType: "json",
      direction: "input",
      required: true,
    },
    {
      id: "retrievalResult",
      label: "Retrieval Result",
      dataType: "json",
      direction: "output",
    },
  ],
};

/**
 * Factory function that creates the executor for rpWorldbookRetrieverV1.
 */
export function createRpWorldbookRetrieverV1Executor(
  services?: RpWorldbookRetrieverServices,
): NodeExecutor {
  const limit = services?.config?.limit ?? 20;
  const constantBudgetTokens = services?.config?.constantBudgetTokens ?? 800;
  const charsPerToken = services?.config?.charsPerToken ?? 4;

  return async (input: NodeExecutionInput) => {
    const { rawInput, recentMessages, worldbookEntries } = input.inputs;

    if (!rawInput || typeof rawInput !== "string") {
      throw new Error("rpWorldbookRetrieverV1: rawInput is required");
    }

    if (!worldbookEntries || !Array.isArray(worldbookEntries)) {
      throw new Error("rpWorldbookRetrieverV1: worldbookEntries is required");
    }

    const entries = worldbookEntries as WorldbookEntryV1[];
    const messages = (recentMessages as Array<{ text: string }> | undefined) ?? [];

    // Build index
    const index = new WorldbookRuntimeIndex();
    index.build(entries);

    // Extract keywords from user input + recent messages
    const keywords = extractKeywords(rawInput, messages);

    // Find direct matches
    const directMatches = index.findByKeywords(keywords);

    // Separate by activation type
    const constantEntries = index.getConstantEntries();
    const directHits: WorldbookEntryV1[] = [];
    const excludedEntries: WorldbookEntryV1[] = [];

    // Process constant entries (always included)
    for (const entry of constantEntries) {
      if (!entry.constant) continue;
      directHits.push(entry);
    }

    // Process keyword-matched entries
    for (const [entryId, _matchedKeywords] of directMatches) {
      const entry = index.getEntry(entryId);
      if (!entry) continue;

      // Check if entry is constant (already added)
      if (entry.constant) continue;

      // Check selective activation
      if (entry.selective && entry.secondaryKeys) {
        const hasSecondary = entry.secondaryKeys.some((sk) =>
          keywords.some((k) => k.toLowerCase() === sk.toLowerCase()),
        );
        if (!hasSecondary) continue; // Skip if secondary key not matched
      }

      // Check excludes
      if (entry.excludesEntryIds?.some((exId) => directHits.some((h) => h.id === exId))) {
        excludedEntries.push(entry);
        continue;
      }

      directHits.push(entry);
    }

    // Expand via relatedEntryIds (one-hop)
    const expandedEntries: WorldbookEntryV1[] = [];
    const directIds = new Set(directHits.map((e) => e.id));

    for (const entry of directHits) {
      if (!entry.relatedEntryIds) continue;
      for (const relatedId of entry.relatedEntryIds) {
        if (directIds.has(relatedId)) continue; // Already in direct hits
        const relatedEntry = index.getEntry(relatedId);
        if (relatedEntry && !expandedEntries.some((e) => e.id === relatedId)) {
          expandedEntries.push(relatedEntry);
        }
      }
    }

    // Combine and deduplicate
    const allEntries = [...directHits, ...expandedEntries];
    const uniqueEntries = deduplicateById(allEntries);

    // Apply budget to constant entries
    const budgetedEntries = applyBudget(uniqueEntries, constantBudgetTokens, charsPerToken);

    // Apply limit
    const finalEntries = budgetedEntries.slice(0, limit);

    // Partition by visibility
    const byVisibility: Record<WorldbookVisibility, WorldbookEntryV1[]> = {
      public: [],
      hidden: [],
      runtime_only: [],
    };

    for (const entry of finalEntries) {
      byVisibility[entry.visibility].push(entry);
    }

    // Find activated keywords
    const activatedKeywords = keywords.filter((k) =>
      entries.some(
        (e) =>
          e.keys.some((ek) => ek.toLowerCase() === k.toLowerCase()) ||
          e.aliases?.some((a) => a.toLowerCase() === k.toLowerCase()),
      ),
    );

    const result: WorldbookRetrievalResult = {
      directHits,
      expandedEntries,
      excludedEntries,
      activatedKeywords,
      totalEntries: finalEntries.length,
      byVisibility,
    };

    return { outputs: { retrievalResult: result } };
  };
}

/**
 * Extract keywords from user input and recent messages.
 */
function extractKeywords(rawInput: string, messages: Array<{ text: string }>): string[] {
  const keywords: string[] = [];

  // Extract from user input
  keywords.push(...tokenizeChineseText(rawInput));

  // Extract from recent messages (last 3)
  const recentMsgs = messages.slice(-3);
  for (const msg of recentMsgs) {
    keywords.push(...tokenizeChineseText(msg.text));
  }

  // Deduplicate
  return [...new Set(keywords)];
}

/**
 * Tokenize Chinese text into keywords.
 * Handles Chinese characters, punctuation, and mixed content.
 */
function tokenizeChineseText(text: string): string[] {
  const tokens: string[] = [];

  // Extract Chinese character sequences (2+ chars)
  const chinesePattern = /[\u4e00-\u9fff]{2,}/g;
  let match;
  while ((match = chinesePattern.exec(text)) !== null) {
    tokens.push(match[0]);
  }

  // Extract quoted content
  const quotePatterns = [
    /[\u201c\u201d]([^\u201c\u201d]+)[\u201c\u201d]/g,
    /「([^\u300d]+)」/g,
    /"([^"]+)"/g,
  ];
  for (const pattern of quotePatterns) {
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) tokens.push(match[1]);
    }
  }

  // Extract English words (3+ chars)
  const englishPattern = /[a-zA-Z]{3,}/g;
  while ((match = englishPattern.exec(text)) !== null) {
    tokens.push(match[0].toLowerCase());
  }

  return tokens;
}

/**
 * Deduplicate entries by ID.
 */
function deduplicateById(entries: WorldbookEntryV1[]): WorldbookEntryV1[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

/**
 * Apply budget constraint to entries.
 * Constant entries are prioritized, then by priority.
 */
function applyBudget(
  entries: WorldbookEntryV1[],
  budgetTokens: number,
  charsPerToken: number,
): WorldbookEntryV1[] {
  // Sort: constants first, then by priority descending
  const sorted = [...entries].sort((a, b) => {
    if (a.constant && !b.constant) return -1;
    if (!a.constant && b.constant) return 1;
    return b.priority - a.priority;
  });

  const result: WorldbookEntryV1[] = [];
  let usedTokens = 0;

  for (const entry of sorted) {
    const entryTokens = Math.ceil(entry.content.length / charsPerToken);
    if (usedTokens + entryTokens <= budgetTokens) {
      result.push(entry);
      usedTokens += entryTokens;
    } else if (entry.constant) {
      // Always include constant entries, even if over budget
      result.push(entry);
      usedTokens += entryTokens;
    }
  }

  return result;
}
