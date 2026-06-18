/**
 * P-15.3A-2: Card HTTP Routes.
 *
 * Endpoints:
 *   POST /api/cards/import
 *   GET  /api/cards
 *   GET  /api/cards/:cardId
 *   GET  /api/cards/:cardId/greetings
 *   POST /api/cards/sessions
 *
 * All responses are sanitized DTOs. No internal paths, no source.json
 * contents, no separated variable tags, no remote refs, no extension script
 * content, no JSON Patch text, no Server stacks.
 *
 * The route layer is THIN. Business logic lives in:
 *   - apps/server/src/services/cardImportService.ts
 *   - apps/server/src/rp/greetingSessionService.ts
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { CardImportServiceError } from "../services/cardImportService.js";
import {
  CardImportService,
  type CardSummaryV1,
  type CardGreetingViewV1,
} from "../services/cardImportService.js";
import {
  GreetingSessionService,
  GreetingSessionServiceError,
  type GreetingSessionInitResult,
} from "../rp/greetingSessionService.js";

/**
 * Dependencies the route layer needs. The composition root injects these.
 */
export interface CardsRouteDeps {
  cardImportService: CardImportService;
  greetingSessionService: GreetingSessionService;
  /** Server-configured max bytes (used for Hono body-limit middleware). */
  maxCardBytes: number;
}

/**
 * Card sanitization: strip private fields from a manifest before sending.
 * The manifest already omits absolute paths, but we double-guard against
 * accidental inclusion of:
 *   - evidence strings (blocked-feature pattern samples)
 *   - separatedVariableTags, separatedRemoteRefs
 *   - JSON Patch text
 *   - EJS/getvar expressions
 *   - extension script content
 *
 * Returned shape: a *summary* (counts, capabilities high-level, name, tags,
 * warnings) with private evidence stripped.
 */
interface PublicManifestV1 {
  cardId: string;
  sourceFilename: string;
  sourceSizeBytes: number;
  sourceHash: string;
  importedAt: string;
  spec: string;
  name: string;
  description: string | null;
  tags: string[];
  worldbookEntryCount: number;
  worldbookDeferredCount: number;
  worldbookDisabledCount: number;
  worldbookBlockedCount: number;
  worldbookConstantCount: number;
  alternateGreetingCount: number;
  defaultGreetingId: string | null;
  capabilities: {
    variablesDetected: boolean;
    variableSchemaDetected: boolean;
    initialStateDetected: boolean;
    patchProtocolDetected: boolean;
    conditionalEntriesDetected: boolean;
    runtimeStatus: string;
    /** Counts only — no evidence. */
    conditionalEntryCount: number;
  };
  /** Warnings with public-safe summary (location, code, count). */
  warnings: Array<{
    code: string;
    severity: "info" | "warn" | "error";
    message: string;
    location: string | null;
    count: number | null;
  }>;
  /** Blocked feature counts. Evidence is NEVER returned. */
  blockedFeatureSummary: Array<{
    code: string;
    status: "blocked" | "preserved-not-executed";
    count: number;
  }>;
  worldbookResourceRef: string;
}

function toPublicManifest(manifest: import("@awp/card-import").CardManifestV1): PublicManifestV1 {
  return {
    cardId: manifest.cardId,
    sourceFilename: manifest.sourceFilename,
    sourceSizeBytes: manifest.sourceSizeBytes,
    sourceHash: manifest.sourceHash,
    importedAt: manifest.importedAt,
    spec: manifest.spec,
    name: manifest.name,
    description: manifest.description,
    tags: manifest.tags,
    worldbookEntryCount: manifest.worldbookEntryCount,
    worldbookDeferredCount: manifest.worldbookDeferredCount,
    worldbookDisabledCount: manifest.worldbookDisabledCount,
    worldbookBlockedCount: manifest.worldbookBlockedCount,
    worldbookConstantCount: manifest.worldbookConstantCount,
    alternateGreetingCount: manifest.alternateGreetingCount,
    defaultGreetingId: manifest.defaultGreetingId,
    capabilities: {
      variablesDetected: manifest.capabilities.variablesDetected,
      variableSchemaDetected: manifest.capabilities.variableSchemaDetected,
      initialStateDetected: manifest.capabilities.initialStateDetected,
      patchProtocolDetected: manifest.capabilities.patchProtocolDetected,
      conditionalEntriesDetected: manifest.capabilities.conditionalEntriesDetected,
      runtimeStatus: manifest.capabilities.runtimeStatus,
      conditionalEntryCount: manifest.capabilities.conditionalEntryIds.length,
    },
    warnings: manifest.warnings.map((w) => ({
      code: w.code,
      severity: w.severity,
      message: w.message,
      location: w.location,
      count: w.count,
    })),
    blockedFeatureSummary: manifest.blockedFeatures.map((b) => ({
      code: b.code,
      status: b.status,
      count: b.count,
    })),
    worldbookResourceRef: manifest.worldbookResourceRef,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createCardsRoutes = (deps: CardsRouteDeps) => {
  const app = new Hono();

  // 9-check pre-filter: Hono body-limit middleware. Rejects requests
  // whose Content-Length exceeds maxCardBytes BEFORE the body is read.
  // Layer 1: server-enforced body limit.
  app.post(
    "/api/cards/import",
    bodyLimit({
      maxSize: deps.maxCardBytes,
      onError: (c) => c.json({ error: "Request body exceeds server limit" }, 413),
    }),
    async (c) => {
      // Layer 2: Content-Type
      const contentType = c.req.header("content-type") ?? "";
      if (!isMultipartFormData(contentType)) {
        return c.json({ error: "Content-Type must be multipart/form-data" }, 415);
      }

      // Layer 3: Content-Length (when present). Body-limit middleware
      // already rejects oversized bodies; this is a defense-in-depth
      // pre-check that does not re-read the body.
      const contentLengthHeader = c.req.header("content-length");
      if (contentLengthHeader !== undefined) {
        const cl = Number(contentLengthHeader);
        if (Number.isFinite(cl) && cl > deps.maxCardBytes) {
          return c.json({ error: "Content-Length exceeds server limit" }, 413);
        }
      }

      // Layer 4: Parse body (multipart). Hono's parseBody() returns
      // FormDataValue (string | File).
      let form: Record<string, string | File>;
      try {
        form = await c.req.parseBody();
      } catch (err) {
        return c.json(
          { error: `Malformed multipart body: ${(err as Error).message ?? "unknown"}` },
          400,
        );
      }

      // Layer 5: exactly one 'file' field, must be a File.
      const fileKeys = Object.keys(form);
      if (fileKeys.length === 0 || !("file" in form)) {
        return c.json({ error: "Missing required 'file' field" }, 400);
      }
      const fileField = form["file"];
      // Reject multi-file: more than one 'file' key (defensive).
      if (fileKeys.length > 1) {
        // Some parsers may collapse duplicates; the safe check is on the
        // raw request body, but at minimum we ensure the field is a File.
      }
      if (!(fileField instanceof File)) {
        return c.json({ error: "'file' must be a binary file upload" }, 400);
      }
      // Reject additional fields entirely (the spec says "only accept one file field").
      for (const key of fileKeys) {
        if (key !== "file") {
          return c.json({ error: `Unexpected field '${key}'; only 'file' is allowed` }, 400);
        }
      }

      // Layer 6: actual File.size
      if (fileField.size > deps.maxCardBytes) {
        return c.json(
          {
            error: `File size ${fileField.size} exceeds limit ${deps.maxCardBytes}`,
          },
          413,
        );
      }

      // Layer 7: read bytes & verify actual size matches File.size.
      const arrayBuffer = await fileField.arrayBuffer();
      const rawBytes = new Uint8Array(arrayBuffer);
      if (rawBytes.length !== fileField.size) {
        return c.json(
          { error: `File size mismatch: header=${fileField.size} actual=${rawBytes.length}` },
          400,
        );
      }

      // Source filename: metadata only. Path-traversal sanitization is
      // delegated to safeFilename in the import service; the on-disk
      // cardId is the SHA-256 of bytes, NOT derived from the filename.
      const sourceFilename = fileField.name ?? "card.json";

      // Layer 8 + 9: structural checks live in the import service
      // (V3 parser: spec, JSON depth, worldbook count, greeting count).
      try {
        const result = await deps.cardImportService.importCard(rawBytes, sourceFilename);
        return c.json(
          {
            cardId: result.cardId,
            alreadyExisted: result.alreadyExisted,
            manifest: toPublicManifest(result.manifest),
            defaultGreetingId: result.defaultGreetingId,
            greetingCount: result.greetings.length,
          },
          result.alreadyExisted ? 200 : 201,
        );
      } catch (err) {
        return mapImportError(c, err);
      }
    },
  );

  // GET /api/cards — list summaries
  app.get("/api/cards", async (c) => {
    try {
      const summaries: CardSummaryV1[] = await deps.cardImportService.listCards();
      return c.json({ cards: summaries });
    } catch (err) {
      return c.json({ error: sanitizeInternalError(err) }, 500);
    }
  });

  // GET /api/cards/:cardId — manifest DTO (no private fields)
  app.get("/api/cards/:cardId", async (c) => {
    const cardId = c.req.param("cardId");
    if (!isValidCardId(cardId)) {
      return c.json({ error: `Invalid cardId: ${cardId}` }, 400);
    }
    try {
      const result = await deps.cardImportService.getCard(cardId);
      return c.json({
        cardId: result.cardId,
        manifest: toPublicManifest(result.manifest),
        defaultGreetingId: result.defaultGreetingId,
        greetingCount: result.greetings.length,
      });
    } catch (err) {
      if (err && typeof err === "object" && "code" in err) {
        const code = (err as { code?: string }).code;
        if (code === "invalid-shape") {
          return c.json({ error: `Invalid cardId: ${cardId}` }, 400);
        }
        if (code === "internal-error") {
          return c.json({ error: "Card not found" }, 404);
        }
      }
      return c.json({ error: sanitizeInternalError(err) }, 500);
    }
  });

  // GET /api/cards/:cardId/greetings — sanitized greeting list
  app.get("/api/cards/:cardId/greetings", async (c) => {
    const cardId = c.req.param("cardId");
    if (!isValidCardId(cardId)) {
      return c.json({ error: `Invalid cardId: ${cardId}` }, 400);
    }
    try {
      const greetings: CardGreetingViewV1[] = await deps.cardImportService.getGreetings(cardId);
      return c.json({
        cardId,
        greetings,
      });
    } catch (err) {
      if (err && typeof err === "object" && "code" in err) {
        const code = (err as { code?: string }).code;
        if (code === "invalid-shape") {
          return c.json({ error: `Invalid cardId: ${cardId}` }, 400);
        }
        if (code === "internal-error") {
          return c.json({ error: "Card not found" }, 404);
        }
      }
      return c.json({ error: sanitizeInternalError(err) }, 500);
    }
  });

  // POST /api/cards/sessions — initialize a session with a greeting seed.
  app.post("/api/cards/sessions", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (!body || typeof body !== "object") {
      return c.json({ error: "Body must be a JSON object" }, 400);
    }
    const req = body as {
      cardId?: unknown;
      greetingId?: unknown;
      sessionId?: unknown;
      memoryNamespace?: unknown;
    };
    if (typeof req.cardId !== "string" || req.cardId.length === 0) {
      return c.json({ error: "cardId is required and must be a string" }, 400);
    }
    if (typeof req.greetingId !== "string" || req.greetingId.length === 0) {
      return c.json({ error: "greetingId is required and must be a string" }, 400);
    }
    if (typeof req.sessionId !== "string" || req.sessionId.length === 0) {
      return c.json({ error: "sessionId is required and must be a string" }, 400);
    }
    if (
      req.memoryNamespace !== undefined &&
      (typeof req.memoryNamespace !== "string" || req.memoryNamespace.length === 0)
    ) {
      return c.json({ error: "memoryNamespace must be a non-empty string when provided" }, 400);
    }

    try {
      const result: GreetingSessionInitResult = await deps.greetingSessionService.initSession({
        cardId: req.cardId,
        greetingId: req.greetingId,
        sessionId: req.sessionId,
        memoryNamespace: typeof req.memoryNamespace === "string" ? req.memoryNamespace : undefined,
      });
      return c.json(
        {
          sessionId: result.sessionId,
          cardId: result.cardId,
          greetingId: result.greetingId,
          memoryNamespace: result.memoryNamespace,
          worldbookResourceRef: result.worldbookResourceRef,
          greetingTurnIndex: result.greetingTurnIndex,
          greetingTurnId: result.greetingTurnId,
          committed: result.committed,
          deduplicated: result.deduplicated,
        },
        result.deduplicated ? 200 : 201,
      );
    } catch (err) {
      return mapGreetingError(c, err);
    }
  });

  return app;
};

// ---------------------------------------------------------------------------
// Error → HTTP mapping
// ---------------------------------------------------------------------------

function mapImportError(c: { json: (b: unknown, s: number) => Response }, err: unknown) {
  const code = (err as CardImportServiceError | null)?.code;
  switch (code) {
    case "file-too-large":
      return c.json({ error: (err as Error).message }, 413);
    case "invalid-json":
    case "json-too-deep":
    case "unsupported-spec":
    case "invalid-shape":
    case "too-many-greetings":
    case "too-many-entries":
      return c.json({ error: (err as Error).message }, 422);
    case "internal-error":
    default:
      return c.json({ error: "Internal card import error" }, 500);
  }
}

function mapGreetingError(c: { json: (b: unknown, s: number) => Response }, err: unknown) {
  if (err instanceof GreetingSessionServiceError) {
    switch (err.code) {
      case "invalid-identifier":
        return c.json({ error: err.message }, 400);
      case "card-not-found":
      case "greeting-not-found":
        return c.json({ error: err.message }, 404);
      case "session-conflict":
        return c.json({ error: err.message }, 409);
      case "card-corrupt":
      case "internal-error":
      case "worldbook-missing":
      default:
        return c.json({ error: "Internal greeting session error" }, 500);
    }
  }
  return c.json({ error: sanitizeInternalError(err) }, 500);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMultipartFormData(contentType: string): boolean {
  return /^multipart\/form-data\b/i.test(contentType);
}

function isValidCardId(cardId: string): boolean {
  return /^[0-9a-f]{64}$/.test(cardId);
}

/**
 * Defensive: never return the raw error message or stack to the client.
 * Internal errors are sanitized to a generic string.
 */
function sanitizeInternalError(_err: unknown): string {
  return "Internal server error";
}
