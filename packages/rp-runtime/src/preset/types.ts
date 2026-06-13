/**
 * Preset Types - Phase B-2.6
 *
 * Defines presets that configure model behavior, style, and output contracts.
 */

import type { PromptSectionV1, PromptFragmentV1, OutputContractV1 } from "../prompt/types.js";

// Re-export for convenience
export type { PromptFragmentV1 } from "../prompt/types.js";

// ============ RP Preset V1 ============

/**
 * A complete preset for RP generation.
 * Contains model config, prompt rules, style, and output contract.
 */
export interface RpPresetV1 {
  /** Always "rp-preset-v1" */
  version: "rp-preset-v1";
  /** Preset identifier */
  id: string;
  /** Human-readable name */
  name: string;

  /** Model configuration */
  model?: {
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
  };

  /** Prompt configuration */
  prompt: {
    /** Core rules that cannot be overridden */
    coreRules: PromptFragmentV1[];
    /** Style requirements */
    styleRules: PromptFragmentV1[];
    /** Additional instructions */
    additionalInstructions: PromptFragmentV1[];
  };

  /** Output contract */
  outputContract: OutputContractV1;

  /** Retry policy */
  retryPolicy?: {
    maxWriterRetries: number;
    maxFormatRepairs: number;
  };
}

// ============ Resolved Preset V1 ============

/**
 * Result of resolving a preset with directives.
 * Contains the merged prompt sections and any conflicts.
 */
export interface ResolvedPresetV1 {
  /** Preset ID */
  presetId: string;
  /** Resolved model config */
  modelConfig: Record<string, unknown>;
  /** Resolved prompt sections */
  promptSections: PromptSectionV1[];
  /** Output contract */
  outputContract: OutputContractV1;
  /** Diagnostics */
  diagnostics: {
    /** IDs of applied directives */
    appliedDirectiveIds: string[];
    /** Any conflicts detected */
    conflicts: PresetConflictV1[];
  };
}

// ============ Preset Conflict V1 ============

/** A conflict between preset fragments */
export interface PresetConflictV1 {
  /** Target section ID */
  targetId: string;
  /** Fragment that was overridden */
  overriddenFragmentId: string;
  /** Fragment that overrode it */
  overridingFragmentId: string;
  /** Reason for the conflict */
  reason: string;
}

// ============ Preset Directive V1 ============

/**
 * A directive that can modify a preset.
 * Used for worldbook format instructions or runtime overrides.
 */
export interface PresetDirectiveV1 {
  /** Directive ID */
  id: string;
  /** Target preset fragment category */
  target: "core_rules" | "style_rules" | "additional_instructions";
  /** Merge strategy */
  merge: "append" | "override";
  /** Priority - must exceed target to override */
  priority?: number;
  /** The fragment content */
  fragment: PromptFragmentV1;
}
