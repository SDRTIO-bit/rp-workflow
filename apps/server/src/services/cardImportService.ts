/**
 * P-15.3A-2: Server-side Card Import Service.
 *
 * Orchestrates the A-1 foundation (parse, detect, map, manifest, store) for
 * the server's Card HTTP API. Routes call into this service rather than
 * accumulating business logic in the route handler.
 *
 * Pipeline (single, explicit, in this order):
 *   raw file bytes
 *   → size check (CardParseLimits, server-configured)
 *   → parseCardV3
 *   → detect capabilities / blocked features
 *   → extractGreetings
 *   → mapWorldbook
 *   → buildManifest
 *   → FileCardStore.writeCard
 *   → sanitized result
 *
 * Concurrency contract, hash semantics, file layout, and detection all come
 * from the A-1 foundation (packages/card-import). This service is the thin
 * server wrapper that wires the foundation to a request-shaped input.
 *
 * SECURITY: This service NEVER executes card content. Detection is pure
 * pattern matching. No eval, no Function constructor, no script execution.
 */
import {
  buildManifest,
  computeCardId,
  detectBlockedFeatures,
  detectCapabilities,
  extractGreetings,
  FileCardStore,
  mapWorldbookEntries,
  parseSillyTavernCard,
  wasNonUtf8Coerced,
  type CardImportResultV1,
  type CardManifestV1,
  type ImportedGreetingV1,
  type ImportedWorldbookEntryV1,
  type DeferredWorldbookEntryV1,
} from "@awp/card-import";
import { safeFilename } from "@awp/card-import";

/**
 * Public-facing limits, server-configured (from Env). Used to gate the
 * parse step. Limits live on the SERVER and are not derived from the request.
 */
export interface CardImportServiceLimits {
  maxBytes: number;
  maxJsonDepth: number;
  maxWorldbookEntries: number;
  maxGreetings: number;
}

/**
 * Public-facing import result DTO. The HTTP layer wraps this; raw internal
 * fields (source.json paths, deferred content with remote refs, etc.) are
 * filtered out at the route boundary. This service returns the canonical
 * sanitized shape already (no path fields).
 */
export interface CardImportServiceResult {
  cardId: string;
  alreadyExisted: boolean;
  manifest: CardManifestV1;
  greetings: ImportedGreetingV1[];
  worldbook: ImportedWorldbookEntryV1[];
  deferredWorldbook: DeferredWorldbookEntryV1[];
  defaultGreetingId: string | null;
}

/**
 * Error codes surfaced to the HTTP layer. Mapped to status codes by the route.
 */
export type CardImportErrorCode =
  | "file-too-large"
  | "invalid-json"
  | "json-too-deep"
  | "invalid-shape"
  | "unsupported-spec"
  | "too-many-greetings"
  | "too-many-entries"
  | "internal-error";

/**
 * Error type raised by the import service. Routes translate this to HTTP.
 */
export class CardImportServiceError extends Error {
  constructor(
    message: string,
    public readonly code: CardImportErrorCode,
  ) {
    super(message);
    this.name = "CardImportServiceError";
  }
}

/**
 * Server-side Card Import Service.
 *
 * Owns the import pipeline. Stateless: one call = one import. The underlying
 * FileCardStore handles concurrency and content-addressed dedup.
 */
export class CardImportService {
  constructor(
    private readonly store: FileCardStore,
    private readonly limits: CardImportServiceLimits,
  ) {}

  /**
   * Sweep orphaned temp directories on the cards store. Should be called at
   * server startup.
   */
  async sweepOrphanedTempDirs(): Promise<number> {
    return this.store.sweepOrphanedTempDirs();
  }

  /**
   * Read a card and return its sanitized DTO.
   * Throws CardImportServiceError("not-found", "internal-error") when the
   * card does not exist.
   */
  async getCard(cardId: string): Promise<CardImportServiceResult> {
    if (!isValidCardId(cardId)) {
      throw new CardImportServiceError(
        `Invalid cardId: ${cardId} (must match ^[0-9a-f]{64}$)`,
        "invalid-shape",
      );
    }
    try {
      const entry = await this.store.readCard(cardId);
      return cardStoreEntryToResult(this.store, cardId, entry, false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new CardImportServiceError(`Card not found: ${cardId} (${message})`, "internal-error");
    }
  }

  /**
   * List all cardIds. Returns the sanitized summary list with no private
   * fields (no source.json contents, no paths).
   */
  async listCards(): Promise<CardSummaryV1[]> {
    const cardIds = await this.store.listCards();
    const summaries: CardSummaryV1[] = [];
    for (const cardId of cardIds) {
      try {
        const entry = await this.store.readCard(cardId);
        summaries.push({
          cardId: entry.cardId,
          name: entry.manifest.name,
          description: entry.manifest.description,
          tags: entry.manifest.tags,
          worldbookEntryCount: entry.manifest.worldbookEntryCount,
          alternateGreetingCount: entry.manifest.alternateGreetingCount,
          defaultGreetingId: entry.manifest.defaultGreetingId,
          importedAt: entry.manifest.importedAt,
        });
      } catch {
        // Skip corrupt cards — never expose them.
      }
    }
    return summaries;
  }

  /**
   * Get the sanitized greeting list for a card. Strips separated variable
   * tags, remote refs, and unapplied patch evidence. Greeting content is
   * the only field returned (per spec: "Greeting API 可以返回清理后的 content").
   */
  async getGreetings(cardId: string): Promise<CardGreetingViewV1[]> {
    if (!isValidCardId(cardId)) {
      throw new CardImportServiceError(
        `Invalid cardId: ${cardId} (must match ^[0-9a-f]{64}$)`,
        "invalid-shape",
      );
    }
    let entry;
    try {
      entry = await this.store.readCard(cardId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new CardImportServiceError(`Card not found: ${cardId} (${message})`, "internal-error");
    }
    return entry.greetings.map((g) => ({
      greetingId: g.greetingId,
      index: g.index,
      label: g.label,
      content: g.content,
      isDefault: g.isDefault,
    }));
  }

  /**
   * Import raw card bytes.
   *
   * Steps (all A-1 foundation except the wiring):
   *  1. Validate byte count against server-side limit (NOT request-side).
   *  2. parseSillyTavernCard (size + depth + spec + structural checks).
   *  3. computeCardId (sha256 of raw bytes).
   *  4. detectBlockedFeatures, detectCapabilities.
   *  5. extractGreetings, mapWorldbookEntries.
   *  6. buildManifest.
   *  7. FileCardStore.writeCard (atomic, dedup, integrity-checked).
   *  8. Return sanitized DTO.
   *
   * sourceFilename is treated as metadata only — it does NOT influence
   * cardId, path construction, or any persisted identifier.
   */
  async importCard(rawBytes: Uint8Array, sourceFilename: string): Promise<CardImportServiceResult> {
    // 1. Server-side size limit (single check, before parse)
    if (rawBytes.length > this.limits.maxBytes) {
      throw new CardImportServiceError(
        `File size ${rawBytes.length} exceeds limit ${this.limits.maxBytes}`,
        "file-too-large",
      );
    }

    // 2. Parse (re-checks size, depth, spec, shape)
    let card;
    try {
      card = parseSillyTavernCard(rawBytes, {
        maxBytes: this.limits.maxBytes,
        maxJsonDepth: this.limits.maxJsonDepth,
        maxWorldbookEntries: this.limits.maxWorldbookEntries,
        maxGreetings: this.limits.maxGreetings,
      });
    } catch (err) {
      // Map A-1 CardImportError → server CardImportServiceError
      const code = (err as { code?: string } | null)?.code;
      throw new CardImportServiceError(
        err instanceof Error ? err.message : String(err),
        mapParseErrorCode(code),
      );
    }

    // 3. Compute cardId (sha256 of raw bytes — content-addressed).
    const cardId = computeCardId(rawBytes);

    // 4. Detection
    const blockedFeatures = detectBlockedFeatures(card);
    const entriesRaw = card.data.character_book?.entries ?? [];
    const capabilities = detectCapabilities(card, entriesRaw);

    // 5. Greetings + worldbook
    const { greetings, defaultGreetingId, warnings: greetingWarnings } = extractGreetings(card);
    const {
      entries,
      deferred,
      warnings: wbWarnings,
      counts,
    } = mapWorldbookEntries(card.data.character_book, cardId, {
      maxWorldbookEntries: this.limits.maxWorldbookEntries,
    });

    // 6. Manifest
    const allWarnings = [...greetingWarnings, ...wbWarnings];
    const manifest = buildManifest({
      card,
      cardId,
      sourceFilename: safeFilename(sourceFilename),
      sourceSizeBytes: rawBytes.length,
      greetings,
      defaultGreetingId,
      entries,
      deferred,
      blockedFeatures,
      capabilities,
      warnings: allWarnings,
      counts,
    });

    // 6b. Non-UTF8 coerced → still record (manifest already created;
    // warnings list will surface this at the route layer if needed).
    // wasNonUtf8Coerced() is preserved for future telemetry; not fatal.
    void wasNonUtf8Coerced(card);

    // 7. Atomic write (concurrent-safe, dedup, integrity-checked).
    const importReport = {
      schemaVersion: 1 as const,
      warnings: allWarnings,
      blockedFeatures,
      capabilities,
      generatedAt: new Date().toISOString(),
    };
    const writeResult = await this.store.writeCard(cardId, rawBytes, {
      manifest,
      greetings,
      worldbook: entries,
      deferredWorldbook: deferred,
      importReport,
    });

    // 8. Sanitized DTO
    return {
      cardId,
      alreadyExisted: writeResult.alreadyExisted,
      manifest,
      greetings,
      worldbook: entries,
      deferredWorldbook: deferred,
      defaultGreetingId,
    };
  }
}

// ---------------------------------------------------------------------------
// DTO shapes (public API contract — no internal paths, no third-party text)
// ---------------------------------------------------------------------------

export interface CardSummaryV1 {
  cardId: string;
  name: string;
  description: string | null;
  tags: string[];
  worldbookEntryCount: number;
  alternateGreetingCount: number;
  defaultGreetingId: string | null;
  importedAt: string;
}

export interface CardGreetingViewV1 {
  greetingId: string;
  index: number;
  label: string | null;
  content: string;
  isDefault: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidCardId(cardId: string): boolean {
  return /^[0-9a-f]{64}$/.test(cardId);
}

function mapParseErrorCode(code: string | undefined): CardImportErrorCode {
  switch (code) {
    case "file-too-large":
      return "file-too-large";
    case "invalid-json":
      return "invalid-json";
    case "json-too-deep":
      return "json-too-deep";
    case "unsupported-spec":
      return "unsupported-spec";
    case "too-many-greetings":
      return "too-many-greetings";
    case "too-many-entries":
      return "too-many-entries";
    case "invalid-shape":
      return "invalid-shape";
    default:
      return "internal-error";
  }
}

function cardStoreEntryToResult(
  _store: FileCardStore,
  cardId: string,
  entry: {
    manifest: CardManifestV1;
    greetings: ImportedGreetingV1[];
    worldbook: ImportedWorldbookEntryV1[];
    deferredWorldbook: DeferredWorldbookEntryV1[];
  },
  alreadyExisted: boolean,
): CardImportServiceResult {
  return {
    cardId,
    alreadyExisted,
    manifest: entry.manifest,
    greetings: entry.greetings,
    worldbook: entry.worldbook,
    deferredWorldbook: entry.deferredWorldbook,
    defaultGreetingId: entry.manifest.defaultGreetingId,
  };
}

/**
 * Re-export the A-1 import result type for callers that want the raw shape.
 */
export type { CardImportResultV1 };
