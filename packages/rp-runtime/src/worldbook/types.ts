/**
 * Worldbook Entry Types - Phase B-2.7
 *
 * Extended worldbook entry type with keys, aliases, selective activation,
 * related entry expansion, and visibility partitioning.
 */

// ============ Worldbook Category ============

export type WorldbookCategory =
  | "character"
  | "location"
  | "item"
  | "relationship"
  | "event"
  | "faction"
  | "world_rule"
  | "secret"
  | "format_instruction"
  | "nsfw_rule"
  | "constant";

// ============ Worldbook Visibility ============

/**
 * Controls how entry content is used:
 * - "public": visible to model as context
 * - "hidden": influences character behavior but not directly stated
 * - "runtime_only": used by Runtime only, never sent to model
 */
export type WorldbookVisibility = "public" | "hidden" | "runtime_only";

// ============ Worldbook Entry V1 ============

export interface WorldbookEntryV1 {
  /** Unique identifier */
  id: string;
  /** Human-readable title */
  title: string;
  /** Entry content (Markdown allowed) */
  content: string;

  /** Primary activation keywords (matched against user input) */
  keys: string[];
  /** Secondary keywords for selective activation (both keys AND secondaryKeys must match) */
  secondaryKeys?: string[];
  /** Alternative names / aliases for this entry */
  aliases?: string[];
  /** If true, requires both keys AND secondaryKeys to activate */
  selective?: boolean;

  /** Category for organization and filtering */
  category: WorldbookCategory;
  /** Priority for ordering (higher = more important) */
  priority: number;
  /** Depth for ordering when scores are equal (lower = deeper/more fundamental) */
  depth?: number;

  /** IDs of related entries to expand (one-hop) */
  relatedEntryIds?: string[];
  /** IDs of entries that should NOT be included when this entry is active */
  excludesEntryIds?: string[];

  /** Visibility to the model */
  visibility: WorldbookVisibility;
  /** Whether this entry is always included (regardless of keyword match) */
  constant?: boolean;
}

// ============ Worldbook Retrieval Provenance (B-2.9) ============

/**
 * Per-entry retrieval source provenance.
 * An entry's source is one of:
 * - directHit: keyword/alias matched in raw input
 * - deterministicExpansion: one-hop expansion via relatedEntryIds
 * - semanticExpansion: B-2.8 semantic expansion from parsed entities
 *
 * Each entry has EXACTLY ONE source. Sources must be set explicitly by the
 * upstream node (rpSemanticExpanderV1) — downstream nodes (rpContextAssemblerV2)
 * MUST NOT infer source from array order or partition.
 *
 * Conflict rule (B-2.9.1, "src conflict" in the audit): directHit wins over
 * deterministicExpansion which wins over semanticExpansion. When an entry
 * qualifies for multiple categories, it is placed in the highest-priority
 * category and removed from the others. The entryTriggers map below
 * records the parser-field-level triggers that the entry would have
 * generated under ANY category, so the conflict does not silently destroy
 * provenance information.
 */
export interface WorldbookRetrievalProvenance {
  /** Entry IDs that ended up in directHits (after conflict resolution). */
  directHitIds: string[];
  /** Entry IDs that ended up in expandedEntries via deterministic expansion. */
  deterministicExpansionIds: string[];
  /** Entry IDs that ended up in expandedEntries via semantic expansion. */
  semanticExpansionIds: string[];

  /**
   * Per-entry parser-field triggers.
   *
   * For every entryId the semantic expander considered (regardless of
   * final retrievalSource after conflict resolution), record which
   * parser fields would have triggered its inclusion. A single entryId
   * may map to multiple parser fields (e.g., "char_su_ling" might be
   * both a `mentions` mention AND a `dialogue-target` AND an
   * `action-target`). Each entry's list is deduped and stable-ordered.
   *
   * Valid parser-field values (B-2.9.1):
   *   "mentions" | "references" | "dialogue-target" | "action-target"
   *   | "action-object" | "intent-target" | "historical-reference"
   *   | "relationship-signal"
   *
   * Entries that are exclusively directHit (e.g., keyword-matched without
   * any parsed entity touching them) are also recorded here when the
   * semantic expander saw them — this preserves the conflict-time trigger
   * information. Pure keyword-only entries (no parser touched them) are
   * NOT recorded, since they carry no parser-field provenance.
   */
  entryTriggers: Record<string, string[]>;
}

// ============ Worldbook Retrieval Result ============

export interface WorldbookRetrievalResult {
  /** Directly activated entries */
  directHits: WorldbookEntryV1[];
  /** Entries activated via relatedEntryIds expansion (B-2.7 deterministic only).
   *  In B-2.8+ outputs, this also mixes in semantic expansion. Downstream
   *  consumers SHOULD use the `provenance` field for explicit per-entry source.
   */
  expandedEntries: WorldbookEntryV1[];
  /** Entries that matched keywords but were excluded by excludesEntryIds */
  excludedEntries: WorldbookEntryV1[];
  /** Keywords that triggered activation */
  activatedKeywords: string[];
  /** Total entries after dedup and budget */
  totalEntries: number;
  /** Entries by visibility partition */
  byVisibility: {
    public: WorldbookEntryV1[];
    hidden: WorldbookEntryV1[];
    runtime_only: WorldbookEntryV1[];
  };
  /** B-2.9: explicit per-entry retrieval source. Optional for B-2.7 outputs. */
  provenance?: WorldbookRetrievalProvenance;
}
