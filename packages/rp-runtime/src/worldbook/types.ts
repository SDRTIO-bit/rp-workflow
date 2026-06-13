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

// ============ Worldbook Retrieval Result ============

export interface WorldbookRetrievalResult {
  /** Directly activated entries */
  directHits: WorldbookEntryV1[];
  /** Entries activated via relatedEntryIds expansion */
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
}
