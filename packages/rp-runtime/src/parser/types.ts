/**
 * Parsed RP Input Types - Phase B-2.8
 *
 * Structured output from the LLM Parser for complex Chinese RP input.
 */

import type { WorldbookCategory } from "../worldbook/types.js";

// ============ Parser Intent Types ============

export type RpIntentTypeV1 =
  | "investigate"
  | "question"
  | "protect"
  | "escape"
  | "delay"
  | "conceal"
  | "confront"
  | "use_item"
  | "move"
  | "observe"
  | "wait";

// ============ Parser Mention ============

export interface ParsedMentionV1 {
  /** Original text from user input */
  text: string;
  /** Resolved entity ID (must exist in worldbook or be "player") */
  entityId?: string;
  /** Resolved entry ID (must exist in worldbook) */
  entryId?: string;
  /** Category of the entity */
  category?: WorldbookCategory;
  /** Confidence score (0-1) */
  confidence: number;
  /** Evidence for this resolution */
  evidence: string;
}

// ============ Resolved Reference ============

export interface ResolvedReferenceV1 {
  /** Original text (pronoun, description, etc.) */
  text: string;
  /** Resolved entity ID */
  resolvedEntityId?: string;
  /** Where the resolution came from */
  resolutionSource: "current_input" | "recent_messages" | "scene" | "unresolved";
  /** Confidence score (0-1) */
  confidence: number;
}

// ============ Parsed Dialogue ============

export interface ParsedDialogueV1 {
  /** Speaker entity ID ("player" or worldbook entity ID) */
  speakerEntityId: "player" | string;
  /** Target entity IDs (who the dialogue is directed at) */
  targetEntityIds: string[];
  /** The dialogue text */
  text: string;
  /** Tone hints */
  toneHints: string[];
}

// ============ Parsed Action ============

export interface ParsedActionV1 {
  /** Actor entity ID ("player" or worldbook entity ID) */
  actorEntityId: "player" | string;
  /** Action description */
  action: string;
  /** Target entity IDs (who the action is directed at) */
  targetEntityIds: string[];
  /** Object entity IDs (what is being acted upon) */
  objectEntityIds: string[];
  /** Location entity IDs */
  locationEntityIds: string[];
  /** Purpose of the action */
  purpose?: string;
}

// ============ Parsed Intent ============

export interface ParsedIntentV1 {
  /** Intent type (from fixed set) */
  type: RpIntentTypeV1;
  /** Target entity IDs */
  targetEntityIds: string[];
}

// ============ Historical Reference ============

export interface HistoricalReferenceV1 {
  /** Original text referencing history */
  text: string;
  /** Resolved entry ID */
  entryId?: string;
  /** Confidence score (0-1) */
  confidence: number;
}

// ============ Relationship Signal ============

export interface RelationshipSignalV1 {
  /** Type of relationship signal */
  type: string;
  /** Subject entity ID */
  subjectEntityId: string;
  /** Object entity ID */
  objectEntityId: string;
  /** Evidence for this signal */
  evidence: string;
}

// ============ Unresolved Reference ============

export interface UnresolvedReferenceV1 {
  /** Original text that couldn't be resolved */
  text: string;
  /** Reason it couldn't be resolved */
  reason: string;
}

// ============ Parsed RP Input V1 ============

export interface ParsedRpInputV1 {
  /** Always "parsed-rp-input-v1" */
  version: "parsed-rp-input-v1";
  /** Original user input text */
  rawText: string;

  /** Entity mentions found in input */
  mentions: ParsedMentionV1[];
  /** Resolved references (pronouns, descriptions) */
  references: ResolvedReferenceV1[];
  /** Dialogues identified */
  dialogues: ParsedDialogueV1[];
  /** Actions identified */
  actions: ParsedActionV1[];
  /** Intents identified */
  intents: ParsedIntentV1[];
  /** Historical references */
  historicalReferences: HistoricalReferenceV1[];
  /** Relationship signals */
  relationshipSignals: RelationshipSignalV1[];

  /** References that couldn't be resolved */
  unresolvedReferences: UnresolvedReferenceV1[];

  /** Parser diagnostics */
  diagnostics: {
    /** Parser mode used */
    parserMode: "llm" | "regex-fallback" | "empty-fallback";
    /** Model used for parsing (only when parserMode is "llm") */
    model?: string;
    /** Number of parse attempts */
    parseAttempts: number;
    /** Entity IDs that were removed (not in worldbook) */
    removedInvalidEntityIds: string[];
    /** Entry IDs that were removed (not in worldbook) */
    removedInvalidEntryIds: string[];
    /** Warnings */
    warnings: string[];
  };
}

// ============ Parser Entity Candidate ============

/**
 * Compact entity candidate for Parser input.
 * Only provides essential info, not full worldbook content.
 */
export interface ParserEntityCandidateV1 {
  entityId: string;
  entryId: string;
  name: string;
  aliases: string[];
  category: WorldbookCategory;
  shortDescription?: string;
}

// ============ Parser Input V1 ============

/**
 * Input to the LLM Parser node.
 */
export interface ParserInputV1 {
  /** Player's raw input text */
  rawInput: string;
  /** Recent messages */
  recentMessages: Array<{ text: string; role: string }>;
  /** Current location */
  currentLocation?: string;
  /** Characters present in scene */
  charactersPresent: string[];
  /** Candidate entities from B-2.7 retrieval */
  candidateEntities: ParserEntityCandidateV1[];
  /** Entry IDs from B-2.7 direct hits */
  directHitEntryIds: string[];
  /** Entry IDs from B-2.7 expansion */
  expandedEntryIds: string[];
}
