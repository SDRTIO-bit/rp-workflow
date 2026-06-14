/**
 * RP Context Assembler V2 Types - Phase B-2.9
 *
 * V2 is the new-parser-aware assembler. It produces a different output
 * structure from V1 because it carries:
 * - Per-parser-field sections (mentions, references, dialogues, etc.)
 * - Worldbook split by retrieval source (directHit / deterministic / semantic)
 * - Explicit provenance per PromptSection
 *
 * V1's AssembledContext is preserved untouched. V2 has its own shape and
 * its own schema (`rp.assembled-context-v2`).
 */

import type { BudgetReport } from "../types.js";

/**
 * V2 assembled context. Each section is rendered Markdown. budgetReport
 * reuses V1's BudgetReport type. parserFieldsCovered lists which
 * ParsedRpInputV1 fields found data to render (so callers can verify
 * the assembler did not silently drop anything).
 */
export interface AssembledContextV2 {
  /** Always "assembled-context-v2" */
  version: "assembled-context-v2";
  /** Fixed system instruction for the writer (mirrors V1's systemPrompt). */
  systemPrompt: string;

  // ---------- Parser-derived sections (each may be empty string if no data) ----------
  /** Mentions: original text + entityId + entryId + evidence */
  mentionsSection: string;
  /** Resolved references (pronouns, descriptions) */
  referencesSection: string;
  /** Dialogues with speakerEntityId and targetEntityIds */
  dialoguesSection: string;
  /** Actions with actorEntityId, targetEntityIds, objectEntityIds, locationEntityIds, purpose */
  actionsSection: string;
  /** Intents with type and targetEntityIds */
  intentsSection: string;
  /** Historical references with entryId linkage */
  historicalReferencesSection: string;
  /** Relationship signals (subject -> object with type and evidence) */
  relationshipSignalsSection: string;
  /** Unresolved references with reason */
  unresolvedReferencesSection: string;
  /** Original rawText (always populated if parsedRpInput is provided) */
  rawUserInputSection: string;

  // ---------- Non-parser context sections (B-2.9.1 parity with V1) ----------
  /** Timeline of past chapters/events relevant to the current turn. */
  timelineSection: string;
  /** Current session state (characters, locations, items, time). */
  trackerSection: string;
  /** Recent user/assistant messages for conversational continuity. */
  recentMessagesSection: string;

  // ---------- Worldbook sections (split by retrieval source) ----------
  /** Worldbook entries from keyword direct hit */
  loreDirectHitSection: string;
  /** Worldbook entries from one-hop relatedEntryIds expansion (B-2.7 deterministic) */
  loreDeterministicExpansionSection: string;
  /** Worldbook entries from B-2.8 semantic expansion */
  loreSemanticExpansionSection: string;

  /** Concatenated full context for direct LLM use. */
  fullContext: string;

  /** Budget report (reused from V1 type). */
  budgetReport: BudgetReport;

  /** Which ParsedRpInputV1 fields had non-empty data and were rendered.
   *  Stable order; deduped. Useful for callers to assert coverage. */
  parserFieldsCovered: string[];

  /** Entry-level parser-field triggers that survived the assembled
   *  context. Each entry maps to a stable-ordered, deduped list of
   *  parser fields that contributed. Empty when the semantic expander
   *  was not in the chain. */
  entryTriggersCovered: Array<{ entryId: string; fields: string[] }>;

  /** Entry IDs that were dropped during entry-level lore trimming
   *  (because their section's budget ran out and a lower-priority
   *  entry was kept instead). Always present (possibly empty). */
  loreEntriesDropped: string[];
}
