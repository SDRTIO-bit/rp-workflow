/**
 * Schema Validators — P-4
 */
import {
  RETRIEVAL_CORPUS_SCHEMA,
  RETRIEVAL_DOCUMENT_SCHEMA,
  RETRIEVAL_FILTER_SCHEMA,
  RETRIEVAL_HINTS_SCHEMA,
  RETRIEVAL_RESULT_SCHEMA,
} from "./types.js";

export function validateDocumentSchema(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  if (typeof d.id !== "string" || d.id.trim().length === 0) return false;
  if (typeof d.content !== "string") return false;
  if (d.priority !== undefined && (typeof d.priority !== "number" || !Number.isFinite(d.priority)))
    return false;
  if (d.tags !== undefined && !Array.isArray(d.tags)) return false;
  if (d.entityIds !== undefined && !Array.isArray(d.entityIds)) return false;
  if (d.metadata !== undefined && !isPlainObject(d.metadata)) return false;
  return true;
}

function isPlainObject(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

export function validateCorpusSchema(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const c = data as Record<string, unknown>;
  if (!Array.isArray(c.entries)) return false;
  for (const e of c.entries) {
    if (!validateDocumentSchema(e)) return false;
  }
  return true;
}

export function validateFilterSchema(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const f = data as Record<string, unknown>;
  if (f.entryIds !== undefined && !Array.isArray(f.entryIds)) return false;
  if (f.tagsAny !== undefined && !Array.isArray(f.tagsAny)) return false;
  if (f.tagsAll !== undefined && !Array.isArray(f.tagsAll)) return false;
  if (f.entityIdsAny !== undefined && !Array.isArray(f.entityIdsAny)) return false;
  if (f.type !== undefined && typeof f.type !== "string") return false;
  if (f.titleContains !== undefined && typeof f.titleContains !== "string") return false;
  return true;
}

export function validateHintsSchema(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const h = data as Record<string, unknown>;
  if (h.keywords !== undefined && !Array.isArray(h.keywords)) return false;
  if (h.tags !== undefined && !Array.isArray(h.tags)) return false;
  if (h.entityIds !== undefined && !Array.isArray(h.entityIds)) return false;
  return true;
}

export function validateResultSchema(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const r = data as Record<string, unknown>;
  if (typeof r.query !== "string") return false;
  if (!["keyword", "bm25", "hybrid"].includes(r.strategy as string)) return false;
  if (typeof r.totalCandidates !== "number") return false;
  if (!Array.isArray(r.hits)) return false;
  return true;
}

export function createRetrievalSchemaValidators(): Record<string, (data: unknown) => boolean> {
  return {
    [RETRIEVAL_DOCUMENT_SCHEMA]: validateDocumentSchema,
    [RETRIEVAL_CORPUS_SCHEMA]: validateCorpusSchema,
    [RETRIEVAL_FILTER_SCHEMA]: validateFilterSchema,
    [RETRIEVAL_HINTS_SCHEMA]: validateHintsSchema,
    [RETRIEVAL_RESULT_SCHEMA]: validateResultSchema,
  };
}
