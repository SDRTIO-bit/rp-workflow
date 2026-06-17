/**
 * Text Novelty Check — P-15.2
 *
 * Pure logic for deterministic exact-duplicate detection.
 * Node definition is in nodes.ts, executor is in executors.ts.
 */

import { normalizeForNovelty } from "./normalize.js";

// ============ Schema ============

export const TEXT_NOVELTY_REPORT_SCHEMA_ID = "awp.text-novelty-report.v1";

export type TextNoveltyReportV1 = {
  schemaId: "awp.text-novelty-report.v1";
  evaluated: boolean;
  exactDuplicate: boolean;
  normalizedCurrentLength: number;
  normalizedReferenceLength: number;
  reason: "no_reference" | "empty_current" | "below_minimum_length" | "exact_duplicate" | "novel";
};

// ============ Config ============

export type TextNoveltyCheckConfig = {
  minNormalizedLength: number;
};

export const DEFAULT_NOVELTY_CONFIG: TextNoveltyCheckConfig = {
  minNormalizedLength: 64,
};

// ============ Pure Logic ============

export function checkNovelty(
  current: string,
  reference: string,
  config: TextNoveltyCheckConfig = DEFAULT_NOVELTY_CONFIG,
): TextNoveltyReportV1 {
  // Reference empty → no_reference
  if (!reference || reference.trim().length === 0) {
    return {
      schemaId: TEXT_NOVELTY_REPORT_SCHEMA_ID,
      evaluated: false,
      exactDuplicate: false,
      normalizedCurrentLength: 0,
      normalizedReferenceLength: 0,
      reason: "no_reference",
    };
  }

  // Current empty → empty_current
  if (!current || current.trim().length === 0) {
    return {
      schemaId: TEXT_NOVELTY_REPORT_SCHEMA_ID,
      evaluated: false,
      exactDuplicate: false,
      normalizedCurrentLength: 0,
      normalizedReferenceLength: 0,
      reason: "empty_current",
    };
  }

  // Normalize both
  const normalizedCurrent = normalizeForNovelty(current);
  const normalizedReference = normalizeForNovelty(reference);

  // Below minimum length → below_minimum_length
  if (
    normalizedCurrent.length < config.minNormalizedLength ||
    normalizedReference.length < config.minNormalizedLength
  ) {
    return {
      schemaId: TEXT_NOVELTY_REPORT_SCHEMA_ID,
      evaluated: false,
      exactDuplicate: false,
      normalizedCurrentLength: normalizedCurrent.length,
      normalizedReferenceLength: normalizedReference.length,
      reason: "below_minimum_length",
    };
  }

  // Exact duplicate check
  if (normalizedCurrent === normalizedReference) {
    return {
      schemaId: TEXT_NOVELTY_REPORT_SCHEMA_ID,
      evaluated: true,
      exactDuplicate: true,
      normalizedCurrentLength: normalizedCurrent.length,
      normalizedReferenceLength: normalizedReference.length,
      reason: "exact_duplicate",
    };
  }

  // Novel
  return {
    schemaId: TEXT_NOVELTY_REPORT_SCHEMA_ID,
    evaluated: true,
    exactDuplicate: false,
    normalizedCurrentLength: normalizedCurrent.length,
    normalizedReferenceLength: normalizedReference.length,
    reason: "novel",
  };
}
