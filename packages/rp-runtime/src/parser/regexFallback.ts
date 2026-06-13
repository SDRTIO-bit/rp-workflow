/**
 * Regex Fallback Parser - Phase B-2.8
 *
 * Deterministic regex-based parser extracted from rpInputParserV1.
 * Used as fallback when LLM Parser fails.
 * Converts regex output to ParsedRpInputV1 format.
 */

import type { ParsedRpInputV1, ParsedDialogueV1, ParsedActionV1 } from "./types.js";

/**
 * Extract dialogues from raw text using regex patterns.
 */
function extractDialogues(rawText: string): ParsedDialogueV1[] {
  const dialogues: ParsedDialogueV1[] = [];

  // Extract dialogues: "text" or "text" or 「text」
  const dialoguePatterns = [
    /[\u0022\u201c\u201d]([^\u0022\u201c\u201d]+)[\u0022\u201c\u201d]/g, // ASCII + curly quotes
    /\u300c([^\u300d]+)\u300d/g, // Japanese quotes
  ];

  for (const pattern of dialoguePatterns) {
    let match;
    while ((match = pattern.exec(rawText)) !== null) {
      const text = match[1];
      if (text !== undefined) {
        dialogues.push({
          speakerEntityId: "player",
          targetEntityIds: [],
          text,
          toneHints: [],
        });
      }
    }
  }

  return dialogues;
}

/**
 * Extract actions from raw text using regex patterns.
 */
function extractActions(rawText: string): ParsedActionV1[] {
  const actions: ParsedActionV1[] = [];

  // Extract actions: *action*
  const actionPattern = /\*([^*]+)\*/g;
  let actionMatch;
  while ((actionMatch = actionPattern.exec(rawText)) !== null) {
    const actionText = actionMatch[1];
    if (actionText !== undefined) {
      actions.push({
        actorEntityId: "player",
        action: actionText,
        targetEntityIds: [],
        objectEntityIds: [],
        locationEntityIds: [],
      });
    }
  }

  return actions;
}

/**
 * Parse raw input using regex and return ParsedRpInputV1.
 *
 * This is a deterministic fallback that:
 * - Extracts dialogues from quotes
 * - Extracts actions from asterisks
 * - Returns empty arrays for complex fields (mentions, intents, etc.)
 *
 * Always succeeds (never returns null).
 */
export function regexParseInput(rawText: string): ParsedRpInputV1 {
  const dialogues = extractDialogues(rawText);
  const actions = extractActions(rawText);

  return {
    version: "parsed-rp-input-v1",
    rawText,
    mentions: [],
    references: [],
    dialogues,
    actions,
    intents: [],
    historicalReferences: [],
    relationshipSignals: [],
    unresolvedReferences: [],
    diagnostics: {
      parserMode: "regex-fallback",
      parseAttempts: 0,
      removedInvalidEntityIds: [],
      removedInvalidEntryIds: [],
      warnings: ["Used regex fallback parser"],
    },
  };
}
