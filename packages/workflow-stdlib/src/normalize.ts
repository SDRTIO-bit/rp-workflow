/**
 * Text Normalization for Novelty Check — P-15.2
 *
 * Pure function: NFKC + zero-width strip + whitespace collapse + trim.
 * No lowercase, no punctuation mapping, no Markdown stripping, no tokenization.
 */

/**
 * Normalize text for novelty comparison.
 *
 * Steps (in order):
 * 1. Unicode NFKC normalization
 * 2. Remove BOM (U+FEFF) and zero-width characters (U+200B, U+200C, U+200D)
 * 3. Collapse consecutive whitespace to single space
 * 4. Trim leading/trailing whitespace
 */
export function normalizeForNovelty(text: string): string {
  // Step 1: NFKC normalization
  let result = text.normalize("NFKC");

  // Step 2: Remove BOM and zero-width characters
  result = result.replace(/[\uFEFF\u200B\u200C\u200D]/g, "");

  // Step 3: Collapse consecutive whitespace to single space
  result = result.replace(/\s+/g, " ");

  // Step 4: Trim
  result = result.trim();

  return result;
}
