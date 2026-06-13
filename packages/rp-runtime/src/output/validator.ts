/**
 * Format Validator - Phase B-2.6
 *
 * Deterministic format checker that validates output against contract.
 * Does NOT call LLM.
 */

import type { OutputContractV1 } from "../prompt/types.js";
import type { ComposedOutputV1 } from "./composer.js";

// ============ Validation Error Codes ============

export type FormatErrorCode =
  | "MISSING_REQUIRED_SLOT"
  | "UNEXPECTED_EXTRA_TEXT"
  | "FORBIDDEN_PATTERN"
  | "EMPTY_WRITER_OUTPUT";

// ============ Validation Error V1 ============

export interface FormatValidationErrorV1 {
  code: FormatErrorCode;
  slotId?: string;
  detail?: string;
}

// ============ Format Validation Result V1 ============

export interface FormatValidationResultV1 {
  valid: boolean;
  errors: FormatValidationErrorV1[];
}

/**
 * Validate composed output against output contract.
 *
 * @param output - The composed output to validate
 * @param contract - The output contract to validate against
 * @returns Validation result
 */
export function validateFormat(
  output: ComposedOutputV1,
  contract: OutputContractV1,
): FormatValidationResultV1 {
  const errors: FormatValidationErrorV1[] = [];

  // Check for empty writer output
  if (!output.text || output.text.trim().length === 0) {
    errors.push({
      code: "EMPTY_WRITER_OUTPUT",
      detail: "Output text is empty",
    });
  }

  // Check required slots
  for (const slot of contract.slots) {
    const slotValue = output.slotOutputs[slot.id];
    if (slot.required && (!slotValue || slotValue.length === 0)) {
      errors.push({
        code: "MISSING_REQUIRED_SLOT",
        slotId: slot.id,
        detail: `Required slot '${slot.id}' is missing or empty`,
      });
    }
  }

  // Check forbidden patterns
  if (contract.forbiddenPatterns && contract.forbiddenPatterns.length > 0) {
    for (const pattern of contract.forbiddenPatterns) {
      if (output.text.includes(pattern)) {
        errors.push({
          code: "FORBIDDEN_PATTERN",
          detail: `Output contains forbidden pattern: '${pattern}'`,
        });
      }
    }
  }

  // Check extra text (if not allowed)
  if (!contract.allowExtraText && contract.mode === "narrative_only") {
    // In narrative_only mode, the text should equal the narrative slot
    const narrativeSlot = contract.slots.find((s) => s.id === "narrative");
    if (narrativeSlot) {
      const narrativeOutput = output.slotOutputs["narrative"];
      if (narrativeOutput && output.text !== narrativeOutput) {
        errors.push({
          code: "UNEXPECTED_EXTRA_TEXT",
          detail: "Output text differs from narrative slot in narrative_only mode",
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
