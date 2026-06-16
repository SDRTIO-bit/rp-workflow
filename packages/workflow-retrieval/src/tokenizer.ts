/**
 * Tokenizer — P-4
 *
 * Deterministic tokenizer for Chinese, English, and mixed text.
 * Does NOT use external segmentation services.
 *
 * Strategy:
 * - English/alphanumeric: consecutive runs form tokens
 * - Chinese: single characters + adjacent bigrams
 * - Empty tokens removed
 * - Output stable and deterministic
 */
import { normalizeText } from "./normalize.js";

const CJK_RANGE =
  /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u{2b740}-\u{2b81f}\u{2b820}-\u{2ceaf}\u3000-\u303f\uff00-\uffef]/u;

const ALPHANUM = /[a-z0-9]/;

export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  if (normalized.length === 0) return [];

  const tokens: string[] = [];
  const chars = [...normalized];
  let i = 0;

  while (i < chars.length) {
    const ch = chars[i]!;

    if (ALPHANUM.test(ch)) {
      // Build alphanumeric run
      let run = "";
      while (i < chars.length && ALPHANUM.test(chars[i]!)) {
        run += chars[i]!;
        i++;
      }
      if (run.length > 0) tokens.push(run);
    } else if (CJK_RANGE.test(ch)) {
      // Chinese character: add single char
      tokens.push(ch);
      // Add bigram with next char if it's also CJK
      if (i + 1 < chars.length && CJK_RANGE.test(chars[i + 1]!)) {
        tokens.push(ch + chars[i + 1]!);
      }
      i++;
    } else {
      // Skip non-alphanumeric, non-CJK (punctuation, spaces, etc.)
      i++;
    }
  }

  return tokens;
}
