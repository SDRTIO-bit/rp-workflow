/**
 * Prompt Document Types - Phase B-2.6
 *
 * Defines the intermediate representation between Runtime JSON and model prompt.
 * Assembler outputs PromptDocumentV1, Compiler renders it to Markdown.
 */

// ============ Prompt Target ============

/** Which LLM node will consume this document */
export type PromptTarget = "writer" | "parser" | "critic" | "memory";

// ============ Prompt Section Source ============

/** Where this section's data originated */
export type PromptSectionSource =
  | "core_rules"
  | "node_instruction"
  | "preset"
  | "worldbook"
  | "state"
  | "timeline"
  | "memory"
  | "recent_messages"
  | "user_input";

// ============ Prompt Section Visibility ============

/**
 * Controls whether the model can see this section.
 * - "model_visible": included in prompt as-is
 * - "hidden_constraint": included but explicitly marked as "do not reveal"
 * - "runtime_only": stripped from prompt entirely, used only by Runtime
 */
export type PromptSectionVisibility = "model_visible" | "hidden_constraint" | "runtime_only";

// ============ Prompt Trust ============

/** Trust level of the section content */
export type PromptTrust = "system" | "runtime" | "world_data" | "user_content";

// ============ Prompt Section V1 ============

export interface PromptSectionV1 {
  /** Unique identifier for this section */
  id: string;
  /** Human-readable title */
  title: string;
  /** Source origin of this section */
  source: PromptSectionSource;
  /** Section content - string for text, object for structured data */
  content: string | Record<string, unknown>;
  /** Priority - higher = more important, kept first during budget enforcement */
  priority: number;
  /** Optional token budget for this section */
  tokenBudget?: number;
  /** Visibility to the model */
  visibility: PromptSectionVisibility;
  /** Trust level */
  trust: PromptTrust;
  /** Provenance tracking */
  provenance?: {
    /** Node that produced this section */
    nodeId?: string;
    /** Worldbook entry IDs referenced */
    entryIds?: string[];
    /** Preset fragment ID if from preset */
    presetId?: string;
  };
}

// ============ Prompt Document V1 ============

export interface PromptDocumentV1 {
  /** Always "prompt-document-v1" */
  version: "prompt-document-v1";
  /** Target LLM node */
  target: PromptTarget;
  /** Sections ordered by priority */
  sections: PromptSectionV1[];
}

// ============ Compiled Prompt V1 ============

/**
 * Output of the Markdown Prompt Compiler.
 * Separates static prefix (for caching) from dynamic context.
 */
export interface CompiledPromptV1 {
  /** Static prefix - core rules, writer duties, fixed style. Same across turns. */
  staticPrefix: string;
  /** Dynamic context - worldbook, state, timeline, recent messages, user input */
  dynamicContext: string;
  /** Full prompt = staticPrefix + dynamicContext */
  prompt: string;
  /** Output contract from preset */
  outputContract: OutputContractV1;
  /** Compilation diagnostics */
  diagnostics: {
    documentVersion: "prompt-document-v1";
    presetId: string;
    estimatedTokens: number;
    staticPrefixHash: string;
    includedSectionIds: string[];
    skippedRuntimeOnlySectionIds: string[];
    truncatedSectionIds: string[];
    droppedSectionIds: string[];
  };
}

// ============ Output Contract V1 ============

export interface OutputContractV1 {
  /** Always "output-contract-v1" */
  version: "output-contract-v1";
  /** Output mode */
  mode: "narrative_only" | "templated";
  /** Output slots */
  slots: OutputSlotV1[];
  /** Forbidden text patterns */
  forbiddenPatterns?: string[];
  /** Whether extra text beyond slots is allowed */
  allowExtraText: boolean;
}

export interface OutputSlotV1 {
  /** Slot identifier */
  id: string;
  /** Whether this slot is required */
  required: boolean;
  /** Order in the output */
  order: number;
  /** Who produces this slot */
  producer: "writer" | "runtime";
  /** Optional renderer name */
  renderer?: string;
}

// ============ Prompt Fragment V1 ============

/** A reusable fragment of prompt content */
export interface PromptFragmentV1 {
  /** Unique identifier */
  id: string;
  /** The content text */
  content: string;
  /** Priority - higher = more important */
  priority: number;
}
