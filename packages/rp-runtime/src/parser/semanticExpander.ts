/**
 * Semantic Expander - Phase B-2.8
 *
 * Deterministic expansion based on validated ParsedRpInputV1.
 * Does NOT call LLM. Only uses resolved entity IDs to expand worldbook entries.
 *
 * Expansion sources tracked for diagnostics:
 * - mention
 * - historical-reference
 * - dialogue-target
 * - action-target
 * - action-object
 * - intent-target
 * - relationship-signal
 */

import type { ParsedRpInputV1 } from "./types.js";
import type { WorldbookEntryV1 } from "../worldbook/types.js";

/**
 * Expansion source type for diagnostics.
 */
export type ExpansionSource =
  | "mention"
  | "historical-reference"
  | "dialogue-target"
  | "action-target"
  | "action-object"
  | "intent-target"
  | "relationship-signal";

/**
 * Expanded entry with source tracking.
 */
export interface ExpandedEntryWithSource {
  entry: WorldbookEntryV1;
  source: ExpansionSource;
}

/**
 * Semantic expansion result.
 */
export interface SemanticExpansionResult {
  /** Additional entries activated by semantic expansion */
  expandedEntries: WorldbookEntryV1[];
  /** Entry IDs that were already in the deterministic set */
  alreadyRetrieved: string[];
  /** Expansion sources for each entry (for diagnostics) */
  expansionSources: Map<string, ExpansionSource>;
}

/**
 * Expand worldbook entries based on validated parser output.
 *
 * Uses:
 * - Resolved entity IDs from mentions
 * - Resolved entry IDs from historical references
 * - Dialogue targets
 * - Action targets
 * - Intent targets
 * - Relationship signals
 *
 * One-hop expansion only. No infinite recursion.
 */
export function expandSemantically(
  parsed: ParsedRpInputV1,
  worldbookEntries: WorldbookEntryV1[],
  deterministicEntryIds: Set<string>,
): SemanticExpansionResult {
  const entryMap = new Map(worldbookEntries.map((e) => [e.id, e]));
  const expandedEntries: WorldbookEntryV1[] = [];
  const alreadyRetrieved: string[] = [];
  const seenIds = new Set(deterministicEntryIds);
  const expansionSources = new Map<string, ExpansionSource>();

  // Helper to add entry if not seen
  const addEntry = (entryId: string, source: ExpansionSource): void => {
    if (seenIds.has(entryId)) return;
    const entry = entryMap.get(entryId);
    if (entry) {
      expandedEntries.push(entry);
      seenIds.add(entry.id);
      expansionSources.set(entry.id, source);
    }
  };

  // Expand from resolved mentions
  for (const mention of parsed.mentions) {
    if (mention.entryId) {
      addEntry(mention.entryId, "mention");
    }
  }

  // Expand from historical references
  for (const hr of parsed.historicalReferences) {
    if (hr.entryId) {
      addEntry(hr.entryId, "historical-reference");
    }
  }

  // Expand from dialogue targets
  for (const dialogue of parsed.dialogues) {
    for (const targetId of dialogue.targetEntityIds) {
      addEntry(targetId, "dialogue-target");
    }
  }

  // Expand from action targets and objects
  for (const action of parsed.actions) {
    for (const targetId of action.targetEntityIds) {
      addEntry(targetId, "action-target");
    }
    for (const objectId of action.objectEntityIds) {
      addEntry(objectId, "action-object");
    }
  }

  // Expand from intent targets
  for (const intent of parsed.intents) {
    for (const targetId of intent.targetEntityIds) {
      addEntry(targetId, "intent-target");
    }
  }

  // Expand from relationship signals
  for (const signal of parsed.relationshipSignals) {
    addEntry(signal.subjectEntityId, "relationship-signal");
    addEntry(signal.objectEntityId, "relationship-signal");
  }

  return { expandedEntries, alreadyRetrieved, expansionSources };
}
