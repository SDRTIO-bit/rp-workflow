import type {
  ActivationPolicy,
  CardImportWarningV1,
  CardParseLimits,
  DeferredWorldbookEntryV1,
  ImportedWorldbookEntryMetadata,
  ImportedWorldbookEntryV1,
  SillyTavernCharacterBook,
  SillyTavernCharacterBookEntry,
} from "./types.js";
import { DEFAULT_CARD_PARSE_LIMITS } from "./types.js";
import { hasBlockedScript, hasVariableCondition, extractVariableRefsPublic } from "./detect.js";

// Store content limit from workflow-worldbook normalizeEntry
const STORE_CONTENT_LIMIT = 10_000;
// Chunk target size (leave headroom below store limit)
const CHUNK_SIZE = 9_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitKeys(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((k) => k.trim()).filter((k) => k.length > 0);
  }
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

function mapType(entry: SillyTavernCharacterBookEntry): string | undefined {
  if (entry.category) return entry.category;
  if (entry.position) return entry.position;
  return undefined;
}

function whitelistExtensions(
  ext: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!ext) return null;
  // Only preserve JSON-compatible scalar values; strip functions etc.
  try {
    return JSON.parse(JSON.stringify(ext));
  } catch {
    return null;
  }
}

/**
 * Deterministic paragraph chunking for long entries.
 * Splits at newline boundaries when possible, falls back to hard split.
 */
function chunkContent(content: string, maxChunkSize: number): string[] {
  if (content.length <= maxChunkSize) return [content];

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= maxChunkSize) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline within the last 20% of the chunk
    const sliceEnd = maxChunkSize;
    const searchStart = Math.floor(maxChunkSize * 0.8);
    const slice = remaining.slice(0, sliceEnd);
    const lastNewline = slice.lastIndexOf("\n", sliceEnd);

    let splitAt: number;
    if (lastNewline > searchStart) {
      splitAt = lastNewline + 1;
    } else {
      // Hard split at maxChunkSize
      splitAt = sliceEnd;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

export interface WorldbookMappingResult {
  entries: ImportedWorldbookEntryV1[];
  deferred: DeferredWorldbookEntryV1[];
  warnings: CardImportWarningV1[];
  counts: { disabled: number; blocked: number; constant: number };
}

export function mapWorldbookEntries(
  book: SillyTavernCharacterBook | undefined,
  cardId: string,
  limitsOverride?: Partial<CardParseLimits>,
): WorldbookMappingResult {
  const limits = { ...DEFAULT_CARD_PARSE_LIMITS, ...limitsOverride };
  const entries: ImportedWorldbookEntryV1[] = [];
  const deferred: DeferredWorldbookEntryV1[] = [];
  const warnings: CardImportWarningV1[] = [];
  let disabledCount = 0;
  let blockedCount = 0;
  let constantCount = 0;

  if (!book || !book.entries || book.entries.length === 0) {
    return { entries, deferred, warnings, counts: { disabled: 0, blocked: 0, constant: 0 } };
  }

  const rawEntries = book.entries;

  if (rawEntries.length > limits.maxWorldbookEntries) {
    warnings.push({
      code: "large-entry-count",
      severity: "warn",
      message: `Worldbook has ${rawEntries.length} entries, exceeding limit ${limits.maxWorldbookEntries}`,
      location: "character_book.entries",
      count: rawEntries.length,
    });
  }

  for (let i = 0; i < rawEntries.length; i++) {
    const raw = rawEntries[i];
    if (!raw) continue;
    const uid = raw.uid ?? raw.id ?? i;
    const baseId = `card:${cardId}:e${uid}`;

    // Check disabled
    if (raw.disable === true || raw.enabled === false) {
      disabledCount++;
      warnings.push({
        code: "disabled-entries-skipped",
        severity: "info",
        message: `Disabled entry uid=${uid} skipped`,
        location: `entry:${uid}`,
        count: null,
      });
      continue;
    }

    const rawContent = raw.content || "";

    // Reject oversized entries BEFORE any silent truncation.
    if (rawContent.length > limits.maxEntryContentChars) {
      warnings.push({
        code: "entry-rejected-too-long",
        severity: "error",
        message: `Entry uid=${uid} content length ${rawContent.length} exceeds max ${limits.maxEntryContentChars}, rejected (no silent truncation)`,
        location: `entry:${uid}`,
        count: null,
      });
      continue;
    }

    const content = rawContent;

    // Check blocked script patterns in content
    if (hasBlockedScript(content)) {
      blockedCount++;
      deferred.push({
        sourceEntryUid: uid,
        reason: "blocked-script",
        originalContent: content,
        variableConditionSource: null,
        detectedVariableRefs: [],
        activationPolicy: "blocked-script",
      });
      warnings.push({
        code: "entry-variable-condition-unsupported",
        severity: "warn",
        message: `Entry uid=${uid} contains blocked script patterns, deferred`,
        location: `entry:${uid}`,
        count: null,
      });
      continue;
    }

    // Check variable conditions
    if (hasVariableCondition(content)) {
      const refs = extractVariableRefsPublic(content);
      deferred.push({
        sourceEntryUid: uid,
        reason: "deferred-variable",
        originalContent: content,
        variableConditionSource: content.slice(0, 200),
        detectedVariableRefs: refs,
        activationPolicy: "deferred-variable",
      });
      warnings.push({
        code: "entry-variable-condition-unsupported",
        severity: "warn",
        message: `Entry uid=${uid} has unsupported variable conditions, deferred`,
        location: `entry:${uid}`,
        count: null,
      });
      continue;
    }

    // Determine activation policy
    const isConstant = raw.constant === true;
    const activationPolicy: ActivationPolicy = isConstant ? "always-core" : "retrieval";
    if (isConstant) constantCount++;

    // Build metadata (whitelisted scalars only)
    const metadata: ImportedWorldbookEntryMetadata = {
      sourceEntryUid: uid,
      sourceKeys: splitKeys(raw.keys),
      sourceSecondaryKeys: splitKeys(raw.secondary_keys),
      sourceConstant: isConstant,
      sourceSelective: raw.selective === true,
      sourcePosition: raw.position ?? null,
      sourceDepth: raw.depth ?? null,
      sourceProbability: raw.probability ?? null,
      sourceGroup: raw.group ?? null,
      sourcePreventRecursion: raw.prevent_recursion === true,
      sourceUseProbability: raw.use_probability === true,
      sourceExtensions: whitelistExtensions(raw.extensions),
      sourceEnabled: true,
      unsupportedVariableCondition: false,
      variableConditionSource: null,
      detectedVariableRefs: [],
      cardId,
      importSchemaVersion: 1,
      activationPolicy,
      sourceEntryId: null,
      partIndex: null,
      partCount: null,
    };

    // Merge tags from keys + secondary_keys
    const tags = [...new Set([...metadata.sourceKeys, ...metadata.sourceSecondaryKeys])].sort();

    // Handle long content with chunking
    if (content.length > STORE_CONTENT_LIMIT) {
      if (content.length > limits.maxEntryContentChars) {
        warnings.push({
          code: "entry-rejected-too-long",
          severity: "error",
          message: `Entry uid=${uid} content exceeds ${limits.maxEntryContentChars} chars, rejected`,
          location: `entry:${uid}`,
          count: null,
        });
        continue;
      }

      const chunks = chunkContent(content, CHUNK_SIZE);
      for (let n = 0; n < chunks.length; n++) {
        const partId = `${baseId}:part-${n}`;
        const partMeta: ImportedWorldbookEntryMetadata = {
          ...metadata,
          sourceEntryId: baseId,
          partIndex: n,
          partCount: chunks.length,
        };
        entries.push({
          id: partId,
          content: chunks[n] as string,
          title: (raw.comment || raw.name || "").slice(0, 200),
          type: mapType(raw),
          tags,
          priority: raw.insertion_order ?? raw.priority ?? 0,
          metadata: partMeta as Record<string, unknown> & ImportedWorldbookEntryMetadata,
        });
      }
      warnings.push({
        code: "entry-chunked",
        severity: "info",
        message: `Entry uid=${uid} chunked into ${chunks.length} parts`,
        location: `entry:${uid}`,
        count: chunks.length,
      });
    } else {
      entries.push({
        id: baseId,
        content,
        title: (raw.comment || raw.name || "").slice(0, 200),
        type: mapType(raw),
        tags,
        priority: raw.insertion_order ?? raw.priority ?? 0,
        metadata: metadata as Record<string, unknown> & ImportedWorldbookEntryMetadata,
      });
    }
  }

  // Constant entries warning
  if (constantCount > 0) {
    warnings.push({
      code: "constant-entries-not-auto-injected",
      severity: "warn",
      message: `${constantCount} constant entries are not auto-injected (behavior difference from SillyTavern)`,
      location: null,
      count: constantCount,
    });
  }

  return {
    entries,
    deferred,
    warnings,
    counts: { disabled: disabledCount, blocked: blockedCount, constant: constantCount },
  };
}
