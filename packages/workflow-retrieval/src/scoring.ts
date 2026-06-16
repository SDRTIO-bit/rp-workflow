/**
 * Keyword Scoring — P-4
 *
 * Deterministic field-weighted matching. Computes per-document scores
 * based on query substring/token matches across title, content, tags,
 * entityIds, and type fields.
 */
import { tokenize } from "./tokenizer.js";
import { normalizeText } from "./normalize.js";
import type { RetrievalDocumentV1, RetrievalFieldWeights, RetrievalHintsV1 } from "./types.js";
import { DEFAULT_FIELD_WEIGHTS, DEFAULT_PRIORITY_WEIGHT } from "./types.js";

export interface KeywordScoreResult {
  score: number;
  matchedFields: string[];
  matchedTerms: string[];
}

export function computeKeywordScore(
  doc: RetrievalDocumentV1,
  queryText: string,
  fieldWeights: RetrievalFieldWeights = {},
  hints?: RetrievalHintsV1,
  priorityWeight: number = DEFAULT_PRIORITY_WEIGHT,
): KeywordScoreResult {
  const weights: Required<RetrievalFieldWeights> = {
    ...DEFAULT_FIELD_WEIGHTS,
    ...fieldWeights,
  };

  const normalizedQuery = normalizeText(queryText);
  const queryTokens = tokenize(normalizedQuery);
  const queryLower = normalizedQuery.toLowerCase();

  const matchedFields: Set<string> = new Set();
  const matchedTerms: Set<string> = new Set();
  let score = 0;

  // --- Field matching ---

  // Title
  const titleNorm = normalizeText(doc.title ?? "");
  const titleLower = titleNorm.toLowerCase();
  if (titleLower.length > 0) {
    const titleTokens = tokenize(titleNorm);
    const matches = countTokenMatches(titleTokens, queryTokens, matchedTerms);
    if (matches > 0) {
      score += matches * weights.title;
      matchedFields.add("title");
    }
    if (titleLower.includes(queryLower)) {
      score += weights.title * 0.5;
      matchedFields.add("title");
    }
  }

  // Content
  const contentNorm = normalizeText(doc.content);
  const contentLower = contentNorm.toLowerCase();
  const contentTokens = tokenize(contentNorm);
  const contentMatches = countTokenMatches(contentTokens, queryTokens, matchedTerms);
  if (contentMatches > 0) {
    score += contentMatches * weights.content;
    matchedFields.add("content");
  }
  if (contentLower.includes(queryLower)) {
    score += weights.content * 0.3;
    matchedFields.add("content");
  }

  // Tags
  if (doc.tags && doc.tags.length > 0) {
    const tagMatches = doc.tags.filter((t) => {
      const tl = normalizeText(t).toLowerCase();
      return queryTokens.some((qt) => tl.includes(qt)) || queryLower.includes(tl);
    }).length;
    if (tagMatches > 0) {
      score += tagMatches * weights.tags;
      matchedFields.add("tags");
    }
  }

  // Entity IDs
  if (doc.entityIds && doc.entityIds.length > 0) {
    const eidMatches = doc.entityIds.filter((e) => {
      const el = e.toLowerCase();
      return queryTokens.some((qt) => el.includes(qt)) || queryLower.includes(el);
    }).length;
    if (eidMatches > 0) {
      score += eidMatches * weights.entityIds;
      matchedFields.add("entityIds");
    }
  }

  // Type
  if (doc.type) {
    const typeLower = normalizeText(doc.type).toLowerCase();
    if (queryTokens.some((qt) => typeLower.includes(qt)) || queryLower.includes(typeLower)) {
      score += weights.type;
      matchedFields.add("type");
    }
  }

  // --- Hints bonus ---
  if (hints) {
    if (hints.keywords) {
      for (const hk of hints.keywords) {
        const hl = normalizeText(hk).toLowerCase();
        if (contentLower.includes(hl) || titleLower.includes(hl)) {
          score += 0.5;
          matchedTerms.add(hk);
        }
      }
    }
    if (hints.tags && doc.tags) {
      for (const ht of hints.tags) {
        if (doc.tags.some((t) => t.toLowerCase() === ht.toLowerCase())) {
          score += 1.0;
          matchedTerms.add(ht);
        }
      }
    }
    if (hints.entityIds && doc.entityIds) {
      for (const he of hints.entityIds) {
        if (doc.entityIds.some((e) => e.toLowerCase() === he.toLowerCase())) {
          score += 1.0;
          matchedTerms.add(he);
        }
      }
    }
  }

  // --- Priority boost (only if at least one match was found) ---
  if (matchedFields.size > 0 && doc.priority !== undefined && doc.priority > 0) {
    score += doc.priority * priorityWeight;
  }

  return {
    score: Math.max(0, score),
    matchedFields: [...matchedFields].sort(),
    matchedTerms: [...matchedTerms].sort(),
  };
}

function countTokenMatches(
  docTokens: string[],
  queryTokens: string[],
  matchedTerms: Set<string>,
): number {
  let count = 0;
  const docLower = docTokens.map((t) => t.toLowerCase());
  for (const qt of queryTokens) {
    const ql = qt.toLowerCase();
    const matchCount = docLower.filter((dt) => dt === ql).length;
    if (matchCount > 0) {
      count += matchCount;
      matchedTerms.add(qt);
    }
  }
  return count;
}
