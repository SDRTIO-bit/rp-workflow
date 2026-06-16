/**
 * Entry Normalization — P-3
 *
 * Validates and normalizes DynamicWorldbookEntryV1 instances.
 * Deep clones input so upstream data is never mutated.
 */
import type { DynamicWorldbookEntryV1 } from "./types.js";

/** Maximum string length for id and content fields. */
const MAX_STRING_LENGTH = 10_000;

/** Errors returned by normalization. */
export type NormalizeError = {
  path: string;
  message: string;
};

/** Result of normalizing a single entry. */
export type NormalizeResult =
  | { ok: true; entry: DynamicWorldbookEntryV1 }
  | { ok: false; errors: NormalizeError[] };

/**
 * Deep-clone and normalize a raw entry.
 * Returns a new object. Does NOT mutate the input.
 */
export function normalizeEntry(raw: unknown): NormalizeResult {
  const errors: NormalizeError[] = [];

  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: [{ path: "$", message: "Entry must be a plain object" }] };
  }

  const obj = raw as Record<string, unknown>;

  // id — required, non-empty string
  const id = obj.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    errors.push({ path: "$.id", message: "Entry id must be a non-empty string" });
    return { ok: false, errors };
  }
  if (id.length > MAX_STRING_LENGTH) {
    errors.push({
      path: "$.id",
      message: `Entry id exceeds max length of ${MAX_STRING_LENGTH}`,
    });
    return { ok: false, errors };
  }

  // content — required, must be a string (allow empty)
  const content = obj.content;
  if (typeof content !== "string") {
    errors.push({ path: "$.content", message: "Entry content must be a string" });
    return { ok: false, errors };
  }
  if (content.length > MAX_STRING_LENGTH) {
    errors.push({
      path: "$.content",
      message: `Entry content exceeds max length of ${MAX_STRING_LENGTH}`,
    });
    return { ok: false, errors };
  }

  const entry: DynamicWorldbookEntryV1 = {
    id: id.trim(),
    content,
  };

  // title — optional string
  if (obj.title !== undefined) {
    if (typeof obj.title !== "string") {
      errors.push({ path: "$.title", message: "title must be a string if provided" });
    } else {
      entry.title = obj.title;
    }
  }

  // type — optional string
  if (obj.type !== undefined) {
    if (typeof obj.type !== "string") {
      errors.push({ path: "$.type", message: "type must be a string if provided" });
    } else {
      entry.type = obj.type;
    }
  }

  // tags — optional array of strings, deduplicated and sorted
  if (obj.tags !== undefined) {
    if (!Array.isArray(obj.tags)) {
      errors.push({ path: "$.tags", message: "tags must be an array if provided" });
    } else {
      const tags: string[] = [];
      for (const tag of obj.tags) {
        if (typeof tag === "string" && tag.length > 0) {
          tags.push(tag);
        }
      }
      entry.tags = [...new Set(tags)].sort();
    }
  }

  // entityIds — optional array of strings, deduplicated and sorted
  if (obj.entityIds !== undefined) {
    if (!Array.isArray(obj.entityIds)) {
      errors.push({ path: "$.entityIds", message: "entityIds must be an array if provided" });
    } else {
      const ids: string[] = [];
      for (const eid of obj.entityIds) {
        if (typeof eid === "string" && eid.length > 0) {
          ids.push(eid);
        }
      }
      entry.entityIds = [...new Set(ids)].sort();
    }
  }

  // priority — optional finite number
  if (obj.priority !== undefined) {
    if (typeof obj.priority !== "number" || !Number.isFinite(obj.priority)) {
      errors.push({ path: "$.priority", message: "priority must be a finite number if provided" });
    } else {
      entry.priority = obj.priority;
    }
  }

  // metadata — optional plain JSON-compatible object
  if (obj.metadata !== undefined) {
    if (!isJsonCompatible(obj.metadata)) {
      errors.push({
        path: "$.metadata",
        message: "metadata must be a JSON-compatible plain object",
      });
    } else {
      entry.metadata = JSON.parse(JSON.stringify(obj.metadata)) as Record<string, unknown>;
    }
  }

  // createdAt / updatedAt — optional ISO strings
  if (obj.createdAt !== undefined) {
    if (typeof obj.createdAt !== "string") {
      errors.push({ path: "$.createdAt", message: "createdAt must be an ISO string if provided" });
    } else {
      entry.createdAt = obj.createdAt;
    }
  }
  if (obj.updatedAt !== undefined) {
    if (typeof obj.updatedAt !== "string") {
      errors.push({ path: "$.updatedAt", message: "updatedAt must be an ISO string if provided" });
    } else {
      entry.updatedAt = obj.updatedAt;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, entry };
}

/**
 * Normalize a batch of entries.
 * Fails entirely if any entry fails normalization.
 */
export function normalizeEntries(raw: unknown[]): NormalizeResult {
  const entries: DynamicWorldbookEntryV1[] = [];
  const ids = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const result = normalizeEntry(raw[i]);
    if (!result.ok) {
      return {
        ok: false,
        errors: result.errors.map((e) => ({
          path: `[${i}]${e.path}`,
          message: e.message,
        })),
      };
    }
    if (ids.has(result.entry.id)) {
      return {
        ok: false,
        errors: [{ path: `[${i}].id`, message: `Duplicate entry id "${result.entry.id}"` }],
      };
    }
    ids.add(result.entry.id);
    entries.push(result.entry);
  }

  return { ok: true, entry: entries as unknown as DynamicWorldbookEntryV1 };
}

// ============ JSON Compatibility Check ============

function isJsonCompatible(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return true;

  if (Array.isArray(value)) {
    return value.every(isJsonCompatible);
  }

  if (typeof value === "object") {
    // Exclude functions, symbols, Date, RegExp, Map, Set, etc.
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) return false;

    return Object.values(value as Record<string, unknown>).every(isJsonCompatible);
  }

  return false;
}

/**
 * Deep clone an object via JSON round-trip.
 * Used to ensure store entries are independent of upstream data.
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
