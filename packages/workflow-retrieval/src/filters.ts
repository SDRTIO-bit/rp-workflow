/**
 * Filter Engine — P-4
 *
 * Applies RetrievalFilterV1 to a corpus before scoring.
 * All conditions are ANDed; array internals use ANY or ALL as named.
 */
import type { RetrievalDocumentV1, RetrievalFilterV1 } from "./types";

export function applyFilter(
  entries: RetrievalDocumentV1[],
  filter: RetrievalFilterV1,
): RetrievalDocumentV1[] {
  return entries.filter((entry) => matchesFilter(entry, filter));
}

function matchesFilter(entry: RetrievalDocumentV1, filter: RetrievalFilterV1): boolean {
  // entryIds: exact match
  if (filter.entryIds && !filter.entryIds.includes(entry.id)) return false;

  // tagsAny: at least one tag matches
  if (filter.tagsAny && filter.tagsAny.length > 0) {
    if (!entry.tags || !filter.tagsAny.some((t) => entry.tags!.includes(t))) return false;
  }

  // tagsAll: all must match
  if (filter.tagsAll && filter.tagsAll.length > 0) {
    if (!entry.tags || !filter.tagsAll.every((t) => entry.tags!.includes(t))) return false;
  }

  // entityIdsAny
  if (filter.entityIdsAny && filter.entityIdsAny.length > 0) {
    if (!entry.entityIds || !filter.entityIdsAny.some((e) => entry.entityIds!.includes(e)))
      return false;
  }

  // type: exact, case-insensitive
  if (filter.type !== undefined) {
    if (!entry.type || entry.type.toLowerCase() !== filter.type.toLowerCase()) return false;
  }

  // titleContains: substring, case-insensitive
  if (filter.titleContains !== undefined) {
    if (!entry.title || !entry.title.toLowerCase().includes(filter.titleContains.toLowerCase()))
      return false;
  }

  return true;
}
