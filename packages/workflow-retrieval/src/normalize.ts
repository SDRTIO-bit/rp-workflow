/**
 * Text Normalization — P-4
 *
 * Unicode NFKC, lowercasing, whitespace collapse.
 * Handles Chinese, English, and mixed text.
 */
export function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}
