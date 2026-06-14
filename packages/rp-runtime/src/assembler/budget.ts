/**
 * Shared budget enforcement utilities for RP Context Assemblers.
 *
 * Phase B-2.9: extracted from rpContextAssemblerV1 so that V1 and V2 can
 * share token estimation, priority-based budget enforcement, and warning
 * generation without duplicating logic.
 *
 * Behavior MUST stay identical to V1's previous implementation for the
 * "legacy" V1 path. V2 passes its own priority table and protected-section
 * list to drive the same algorithm with new sections.
 *
 * Pure functions only. No I/O, no state, no closures over services.
 */

export interface BudgetInput {
  /** Map of section key -> rendered text content. */
  sections: Record<string, string>;
  /** Map of section key -> priority (higher = kept first under pressure). */
  priorities: Record<string, number>;
  /** Soft target; we truncate/drop until total is at or below this. */
  targetTokens: number;
  /** Hard ceiling; after soft pass, force-truncate remaining sections. */
  hardLimitTokens: number;
  /** Approximate characters per token for budgeting. */
  charsPerToken: number;
  /** Section keys that must NEVER be dropped or truncated.
   *  For V1 this is `userInputSection`; for V2 this is `rawUserInputSection`
   *  plus any other system-critical key. */
  protectedSections?: ReadonlyArray<string>;
}

export interface BudgetResult {
  finalSections: Record<string, string>;
  truncatedSections: string[];
  droppedSections: string[];
}

/**
 * Estimate token count for a text string. Character-ratio approximation
 * (matches V1's pre-refactor behavior).
 */
export function estimateTokens(text: string, charsPerToken: number): number {
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Enforce a token budget across sections using priority order.
 *
 * Pass 1 (soft target): iterate sections in ascending priority. For each
 *   over-budget section: drop it (if entry fits the remaining excess and
 *   priority is below the protected threshold) or truncate it to fit.
 *   Protected sections are skipped entirely.
 *
 * Pass 2 (hard limit): if the assembled total still exceeds hardLimit,
 *   aggressively truncate each non-protected section to 30% of the hard
 *   limit worth of characters.
 *
 * Stable contract:
 * - Returns `finalSections` containing the same keys as input (content may
 *   be empty if dropped).
 * - Returns `truncatedSections` (modified) and `droppedSections` (cleared
 *   to "") in the order they were processed.
 */
export function enforceBudget(input: BudgetInput): BudgetResult {
  const { sections, priorities, targetTokens, hardLimitTokens, charsPerToken } = input;
  const protectedSections = new Set(input.protectedSections ?? []);

  const sectionTokens: Record<string, number> = {};
  for (const [key, content] of Object.entries(sections)) {
    sectionTokens[key] = estimateTokens(content, charsPerToken);
  }
  const totalTokens = Object.values(sectionTokens).reduce((a, b) => a + b, 0);

  if (totalTokens <= targetTokens) {
    return {
      finalSections: { ...sections },
      truncatedSections: [],
      droppedSections: [],
    };
  }

  // Need to reduce — sort sections by priority ascending (lowest first for removal)
  const sectionEntries = Object.entries(sections).map(([key, content]) => ({
    key,
    content,
    tokens: sectionTokens[key] ?? 0,
    priority: priorities[key] ?? 0,
  }));
  sectionEntries.sort((a, b) => a.priority - b.priority);

  const finalSections: Record<string, string> = { ...sections };
  const truncatedSections: string[] = [];
  const droppedSections: string[] = [];
  let currentTokens = totalTokens;

  for (const entry of sectionEntries) {
    if (currentTokens <= targetTokens) break;
    // Never drop or truncate protected sections
    if (protectedSections.has(entry.key)) continue;

    const excess = currentTokens - targetTokens;
    const entryTokens = entry.tokens;

    // Match V1 behavior: only "drop" a small section if its priority is
    // strictly below the highest non-system priority (effectively 99 in V1).
    // V1 hardcoded "priority < 99"; here we encode the same intent via the
    // "drop below this priority" parameter (default 99 to match V1).
    if (entryTokens <= excess && entry.priority < 99) {
      finalSections[entry.key] = "";
      droppedSections.push(entry.key);
      currentTokens -= entryTokens;
    } else if (entryTokens > 0) {
      const targetChars = Math.max(0, (entryTokens - excess) * charsPerToken);
      if (targetChars < entry.content.length) {
        finalSections[entry.key] = entry.content.slice(0, targetChars) + "... [truncated]";
        truncatedSections.push(entry.key);
        currentTokens = estimateTokens(Object.values(finalSections).join(""), charsPerToken);
      }
    }
  }

  // Final pass: if still over hard limit, force truncate
  const finalTotal = estimateTokens(Object.values(finalSections).join(""), charsPerToken);
  if (finalTotal > hardLimitTokens) {
    for (const entry of sectionEntries) {
      if (protectedSections.has(entry.key)) continue;
      const sectionContent = finalSections[entry.key] ?? "";
      if (sectionContent.length > 0) {
        const maxChars = Math.floor(hardLimitTokens * charsPerToken * 0.3);
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

/**
 * Build a list of human-readable warnings describing the budget outcome.
 */
export function buildBudgetWarnings(
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
