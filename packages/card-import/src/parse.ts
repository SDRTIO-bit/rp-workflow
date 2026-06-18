import type { CardParseLimits, SillyTavernCardV3 } from "./types.js";
import { DEFAULT_CARD_PARSE_LIMITS } from "./types.js";

/**
 * Measure the maximum nesting depth of a JSON value.
 */
export function measureJsonDepth(value: unknown): number {
  if (value == null || typeof value !== "object") return 0;
  if (Array.isArray(value)) {
    let max = 0;
    for (const item of value) {
      const d = measureJsonDepth(item);
      if (d > max) max = d;
    }
    return max + 1;
  }
  let max = 0;
  for (const v of Object.values(value as Record<string, unknown>)) {
    const d = measureJsonDepth(v);
    if (d > max) max = d;
  }
  return max + 1;
}

/**
 * Parse raw bytes as a SillyTavern Chara Card V3.
 * Validates spec, structure, and enforces limits.
 */
export function parseSillyTavernCard(
  rawBytes: Uint8Array,
  limitsOverride?: Partial<CardParseLimits>,
): SillyTavernCardV3 {
  const limits = { ...DEFAULT_CARD_PARSE_LIMITS, ...limitsOverride };

  // Size check BEFORE parse
  if (rawBytes.length > limits.maxBytes) {
    throw new CardImportError(
      `File size ${rawBytes.length} exceeds limit ${limits.maxBytes}`,
      "file-too-large",
    );
  }

  // Decode UTF-8
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const text = decoder.decode(rawBytes);

  // Check for replacement characters (non-UTF8 content)
  const hasNonUtf8 = text.includes("\uFFFD");

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CardImportError("Invalid JSON", "invalid-json");
  }

  // Depth check
  const depth = measureJsonDepth(parsed);
  if (depth > limits.maxJsonDepth) {
    throw new CardImportError(
      `JSON depth ${depth} exceeds limit ${limits.maxJsonDepth}`,
      "json-too-deep",
    );
  }

  // Validate shape
  if (parsed == null || typeof parsed !== "object") {
    throw new CardImportError("Card must be a JSON object", "invalid-shape");
  }

  const obj = parsed as Record<string, unknown>;

  // Spec validation
  if (obj.spec !== "chara_card_v3") {
    throw new CardImportError(
      `Unsupported spec: ${String(obj.spec)}. Only chara_card_v3 is supported.`,
      "unsupported-spec",
    );
  }

  // Data validation
  if (obj.data == null || typeof obj.data !== "object") {
    throw new CardImportError("Card must have a data field", "invalid-shape");
  }

  const data = obj.data as Record<string, unknown>;
  if (typeof data.name !== "string" || data.name.length === 0) {
    throw new CardImportError("Card data must have a name field", "invalid-shape");
  }

  // Validate alternate_greetings if present
  if (data.alternate_greetings !== undefined) {
    if (!Array.isArray(data.alternate_greetings)) {
      throw new CardImportError("alternate_greetings must be an array", "invalid-shape");
    }
    if (data.alternate_greetings.length > limits.maxGreetings) {
      throw new CardImportError(
        `Too many greetings: ${data.alternate_greetings.length} exceeds limit ${limits.maxGreetings}`,
        "too-many-greetings",
      );
    }
  }

  // Validate character_book entries count if present
  if (data.character_book !== undefined && data.character_book != null) {
    const book = data.character_book as Record<string, unknown>;
    if (Array.isArray(book.entries) && book.entries.length > limits.maxWorldbookEntries) {
      throw new CardImportError(
        `Too many worldbook entries: ${book.entries.length} exceeds limit ${limits.maxWorldbookEntries}`,
        "too-many-entries",
      );
    }
  }

  const result = parsed as SillyTavernCardV3;

  // Attach non-UTF8 warning flag (caller can check)
  if (hasNonUtf8) {
    (result as unknown as Record<string, unknown>).__nonUtf8Coerced = true;
  }

  return result;
}

/**
 * Check if a parsed card had non-UTF8 content that was coerced.
 */
export function wasNonUtf8Coerced(card: SillyTavernCardV3): boolean {
  return (card as unknown as Record<string, unknown>).__nonUtf8Coerced === true;
}

/**
 * Remove the internal non-UTF8 flag before serialization.
 */
export function stripInternalFlags(card: SillyTavernCardV3): void {
  delete (card as unknown as Record<string, unknown>).__nonUtf8Coerced;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type CardImportErrorCode =
  | "file-too-large"
  | "invalid-json"
  | "json-too-deep"
  | "invalid-shape"
  | "unsupported-spec"
  | "too-many-greetings"
  | "too-many-entries";

export class CardImportError extends Error {
  constructor(
    message: string,
    public readonly code: CardImportErrorCode,
  ) {
    super(message);
    this.name = "CardImportError";
  }
}
