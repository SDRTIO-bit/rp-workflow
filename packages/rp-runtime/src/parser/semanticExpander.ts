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
 * Parser-field markers that record WHY an entry was added by semantic
 * expansion. Stored in `WorldbookRetrievalProvenance.entryTriggers`.
 */
export const SEMANTIC_TRIGGER_FIELDS = [
  "mentions",
  "references",
  "dialogue-target",
  "action-target",
  "action-object",
  "intent-target",
  "historical-reference",
  "relationship-signal",
] as const;

export type SemanticTriggerField = (typeof SEMANTIC_TRIGGER_FIELDS)[number];

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
  /**
   * Parser-field triggers per entryId. An entry may appear here even if it
   * was later promoted to directHit / deterministicExpansion by the
   * conflict rule in rpSemanticExpanderV1 — we never lose the
   * parser-field-level provenance. Same entryId may map to multiple
   * parser fields (e.g., a character mentioned in dialogue AND
   * targeted by an action). Each list is deduped and stable-ordered.
   */
  entryTriggers: Map<string, SemanticTriggerField[]>;
}

/**
 * Append a parser field to an entry's trigger list, preserving dedup and
 * stable insertion order. Creates the list on first use.
 */
function appendTrigger(
  map: Map<string, SemanticTriggerField[]>,
  entryId: string,
  field: SemanticTriggerField,
): void {
  const existing = map.get(entryId);
  if (existing === undefined) {
    map.set(entryId, [field]);
    return;
  }
  if (!existing.includes(field)) {
    existing.push(field);
  }
}

/**
 * Expand worldbook entries based on validated parser output.
 *
 * Uses:
 * - Resolved entity IDs from mentions
 * - Resolved entry IDs from historical references
 * - Dialogue targets
 * - Action targets and action objects
 * - Intent targets
 * - Relationship signals (subject AND object)
 * - Resolved references (when the reference carries a resolvedEntityId,
 *   we also treat that as a potential expansion target)
 *
 * One-hop expansion only. No infinite recursion.
 *
 * The semantic expansion is non-overlapping with the deterministic set by
 * construction: addEntry is a no-op when the entry is already in the
 * deterministic set. However, the parser-field trigger is still recorded
 * for the entry so the conflict rule downstream does not erase
 * provenance.
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
  const entryTriggers = new Map<string, SemanticTriggerField[]>();

  // Helper: add entry if not already in deterministic set. ALWAYS record
  // the parser-field trigger regardless of whether the entry is added,
  // because the conflict rule downstream may promote it.
  const recordAndMaybeAdd = (
    entryId: string,
    field: SemanticTriggerField,
    source: ExpansionSource,
  ): void => {
    appendTrigger(entryTriggers, entryId, field);
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
      recordAndMaybeAdd(mention.entryId, "mentions", "mention");
    }
  }

  // Expand from historical references
  for (const hr of parsed.historicalReferences) {
    if (hr.entryId) {
      recordAndMaybeAdd(hr.entryId, "historical-reference", "historical-reference");
    }
  }

  // Expand from dialogue targets
  for (const dialogue of parsed.dialogues) {
    for (const targetId of dialogue.targetEntityIds) {
      recordAndMaybeAdd(targetId, "dialogue-target", "dialogue-target");
    }
  }

  // Expand from action targets and action objects
  for (const action of parsed.actions) {
    for (const targetId of action.targetEntityIds) {
      recordAndMaybeAdd(targetId, "action-target", "action-target");
    }
    for (const objectId of action.objectEntityIds) {
      recordAndMaybeAdd(objectId, "action-object", "action-object");
    }
  }

  // Expand from intent targets
  for (const intent of parsed.intents) {
    for (const targetId of intent.targetEntityIds) {
      recordAndMaybeAdd(targetId, "intent-target", "intent-target");
    }
  }

  // Expand from relationship signals
  for (const signal of parsed.relationshipSignals) {
    recordAndMaybeAdd(signal.subjectEntityId, "relationship-signal", "relationship-signal");
    if (signal.objectEntityId) {
      recordAndMaybeAdd(signal.objectEntityId, "relationship-signal", "relationship-signal");
    }
  }

  // Expand from resolved references (pronouns, descriptions)
  for (const reference of parsed.references) {
    if (reference.resolvedEntityId) {
      recordAndMaybeAdd(reference.resolvedEntityId, "references", "mention");
    }
  }

  return { expandedEntries, alreadyRetrieved, expansionSources, entryTriggers };
}
