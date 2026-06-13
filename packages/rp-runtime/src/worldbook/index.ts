/**
 * Worldbook Runtime Index - Phase B-2.7
 *
 * Builds an in-memory index for fast keyword/alias lookup.
 * Deterministic: no LLM calls, no network requests.
 */

import type { WorldbookEntryV1 } from "./types.js";

/**
 * In-memory index for fast worldbook retrieval.
 * Maps keywords and aliases to entry IDs.
 */
export class WorldbookRuntimeIndex {
  private entries: Map<string, WorldbookEntryV1> = new Map();
  private keywordIndex: Map<string, Set<string>> = new Map(); // keyword -> entry IDs
  private aliasIndex: Map<string, Set<string>> = new Map(); // alias -> entry IDs

  /**
   * Build index from entries.
   */
  build(entries: WorldbookEntryV1[]): void {
    this.entries.clear();
    this.keywordIndex.clear();
    this.aliasIndex.clear();

    for (const entry of entries) {
      this.entries.set(entry.id, entry);

      // Index primary keys
      for (const key of entry.keys) {
        const lowerKey = key.toLowerCase();
        if (!this.keywordIndex.has(lowerKey)) {
          this.keywordIndex.set(lowerKey, new Set());
        }
        this.keywordIndex.get(lowerKey)!.add(entry.id);
      }

      // Index secondary keys (for selective activation)
      if (entry.secondaryKeys) {
        for (const key of entry.secondaryKeys) {
          const lowerKey = key.toLowerCase();
          if (!this.keywordIndex.has(lowerKey)) {
            this.keywordIndex.set(lowerKey, new Set());
          }
          this.keywordIndex.get(lowerKey)!.add(entry.id);
        }
      }

      // Index aliases
      if (entry.aliases) {
        for (const alias of entry.aliases) {
          const lowerAlias = alias.toLowerCase();
          if (!this.aliasIndex.has(lowerAlias)) {
            this.aliasIndex.set(lowerAlias, new Set());
          }
          this.aliasIndex.get(lowerAlias)!.add(entry.id);
        }
      }
    }
  }

  /**
   * Find entries matching a set of keywords.
   * Returns entry IDs that have at least one keyword match.
   */
  findByKeywords(keywords: string[]): Map<string, string[]> {
    const entryMatches: Map<string, string[]> = new Map(); // entry ID -> matched keywords

    for (const keyword of keywords) {
      const lowerKeyword = keyword.toLowerCase();

      // Check keyword index
      const keywordHits = this.keywordIndex.get(lowerKeyword);
      if (keywordHits) {
        for (const entryId of keywordHits) {
          if (!entryMatches.has(entryId)) {
            entryMatches.set(entryId, []);
          }
          entryMatches.get(entryId)!.push(keyword);
        }
      }

      // Check alias index
      const aliasHits = this.aliasIndex.get(lowerKeyword);
      if (aliasHits) {
        for (const entryId of aliasHits) {
          if (!entryMatches.has(entryId)) {
            entryMatches.set(entryId, []);
          }
          entryMatches.get(entryId)!.push(`alias:${keyword}`);
        }
      }

      // Check partial matches in keyword index (keyword contains token OR token contains keyword)
      for (const [indexKey, entryIds] of this.keywordIndex) {
        if (indexKey === lowerKeyword) continue; // Already exact-matched
        if (indexKey.includes(lowerKeyword) || lowerKeyword.includes(indexKey)) {
          for (const entryId of entryIds) {
            if (!entryMatches.has(entryId)) {
              entryMatches.set(entryId, []);
            }
            entryMatches.get(entryId)!.push(`partial:${keyword}`);
          }
        }
      }

      // Check partial matches in alias index
      for (const [indexKey, entryIds] of this.aliasIndex) {
        if (indexKey === lowerKeyword) continue; // Already exact-matched
        if (indexKey.includes(lowerKeyword) || lowerKeyword.includes(indexKey)) {
          for (const entryId of entryIds) {
            if (!entryMatches.has(entryId)) {
              entryMatches.set(entryId, []);
            }
            entryMatches.get(entryId)!.push(`alias-partial:${keyword}`);
          }
        }
      }
    }

    return entryMatches;
  }

  /**
   * Get entry by ID.
   */
  getEntry(id: string): WorldbookEntryV1 | undefined {
    return this.entries.get(id);
  }

  /**
   * Get all entries.
   */
  getAllEntries(): WorldbookEntryV1[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get constant (always-on) entries.
   */
  getConstantEntries(): WorldbookEntryV1[] {
    return Array.from(this.entries.values()).filter((e) => e.constant);
  }

  /**
   * Get entry count.
   */
  get size(): number {
    return this.entries.size;
  }
}
