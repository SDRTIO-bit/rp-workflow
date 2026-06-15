/**
 * Memory Schema Validators — P-5
 */
import {
  MEMORY_RECORD_SCHEMA,
  MEMORY_WRITE_INPUT_SCHEMA,
  MEMORY_QUERY_INPUT_SCHEMA,
  MEMORY_CORPUS_OUTPUT_SCHEMA,
} from "./types";

function isPlainObject(v: unknown): boolean {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)
  );
}

export function validateRecordSchema(data: unknown): boolean {
  if (!isPlainObject(data)) return false;
  const r = data as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id.trim()) return false;
  if (typeof r.content !== "string") return false;
  // namespace is optional — may come from top-level write input
  if (r.namespace !== undefined && typeof r.namespace !== "string") return false;
  // createdAt/updatedAt are optional — set by store on write
  if (r.createdAt !== undefined && typeof r.createdAt !== "string") return false;
  if (r.updatedAt !== undefined && typeof r.updatedAt !== "string") return false;
  if (
    r.importance !== undefined &&
    (typeof r.importance !== "number" || !Number.isFinite(r.importance))
  )
    return false;
  if (r.tags !== undefined && !Array.isArray(r.tags)) return false;
  if (r.entityIds !== undefined && !Array.isArray(r.entityIds)) return false;
  if (r.metadata !== undefined && !isPlainObject(r.metadata)) return false;
  return true;
}

export function validateWriteInputSchema(data: unknown): boolean {
  if (!isPlainObject(data)) return false;
  const w = data as Record<string, unknown>;
  if (typeof w.namespace !== "string") return false;
  if (!Array.isArray(w.records)) return false;
  for (const r of w.records) {
    if (!validateRecordSchema(r)) return false;
  }
  return true;
}

export function validateQueryInputSchema(data: unknown): boolean {
  if (!isPlainObject(data)) return false;
  const q = data as Record<string, unknown>;
  if (typeof q.namespace !== "string") return false;
  return true;
}

export function validateCorpusOutputSchema(data: unknown): boolean {
  if (!isPlainObject(data)) return false;
  const c = data as Record<string, unknown>;
  if (typeof c.namespace !== "string") return false;
  if (typeof c.total !== "number") return false;
  if (!Array.isArray(c.entries)) return false;
  return true;
}

export function createMemorySchemaValidators(): Record<string, (data: unknown) => boolean> {
  return {
    [MEMORY_RECORD_SCHEMA]: validateRecordSchema,
    [MEMORY_WRITE_INPUT_SCHEMA]: validateWriteInputSchema,
    [MEMORY_QUERY_INPUT_SCHEMA]: validateQueryInputSchema,
    [MEMORY_CORPUS_OUTPUT_SCHEMA]: validateCorpusOutputSchema,
  };
}
