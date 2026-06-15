/**
 * Retrieve Orchestrator — P-4
 *
 * Coordinates: filter → score → rank → limit.
 * Supports keyword, bm25, and hybrid strategies.
 */
import { applyFilter } from "./filters";
import { computeKeywordScore } from "./scoring";
import { computeBM25Scores } from "./bm25";
import type {
  RetrievalCorpusV1,
  RetrievalFilterV1,
  RetrievalHintsV1,
  RetrievalHitV1,
  RetrievalResultV1,
  GenericRetrieverConfig,
  RetrievalFieldWeights,
} from "./types";
import {
  DEFAULT_FIELD_WEIGHTS,
  DEFAULT_PRIORITY_WEIGHT,
  DEFAULT_LIMIT,
  DEFAULT_HYBRID_WEIGHTS,
} from "./types";

export function retrieve(
  query: string,
  corpus: RetrievalCorpusV1,
  config: GenericRetrieverConfig,
  filter?: RetrievalFilterV1,
  hints?: RetrievalHintsV1,
): RetrievalResultV1 {
  const queryTrimmed = query.trim();
  if (queryTrimmed.length === 0) {
    throw new Error("retrieve: query must be a non-empty string after trimming");
  }

  const entries = corpus.entries ?? [];
  const totalCandidates = entries.length;

  // Validate config
  const limit = config.limit ?? DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`retrieve: limit must be a positive integer, got ${limit}`);
  }

  const minScore = config.minScore;
  if (minScore !== undefined && (!Number.isFinite(minScore) || typeof minScore !== "number")) {
    throw new Error(`retrieve: minScore must be a finite number, got ${minScore}`);
  }

  const fieldWeights: Required<RetrievalFieldWeights> = {
    ...DEFAULT_FIELD_WEIGHTS,
    ...config.fieldWeights,
  };
  for (const [key, val] of Object.entries(fieldWeights)) {
    if (typeof val !== "number" || !Number.isFinite(val) || val < 0) {
      throw new Error(
        `retrieve: fieldWeight.${key} must be a non-negative finite number, got ${val}`,
      );
    }
  }

  const priorityWeight = config.priorityWeight ?? DEFAULT_PRIORITY_WEIGHT;
  if (!Number.isFinite(priorityWeight) || priorityWeight < 0) {
    throw new Error(`retrieve: priorityWeight must be non-negative finite, got ${priorityWeight}`);
  }

  // Filter
  const filtered = filter ? applyFilter(entries, filter) : entries;
  const totalAfterFilter = filtered.length;

  // Score
  const strategy = config.strategy;
  const includeDiag = config.includeDiagnostics === true;

  const scored: Array<{
    score: number;
    sourceIndex: number;
    entry: (typeof entries)[number];
    matchedFields: string[];
    matchedTerms: string[];
    diagnostics?: RetrievalHitV1["diagnostics"];
  }> = [];

  if (strategy === "keyword") {
    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i]!;
      const originalIdx = entries.indexOf(entry);
      const ks = computeKeywordScore(
        entry,
        queryTrimmed,
        config.fieldWeights,
        hints,
        priorityWeight,
      );
      if (ks.score > 0) {
        scored.push({
          score: ks.score,
          sourceIndex: originalIdx,
          entry,
          matchedFields: ks.matchedFields,
          matchedTerms: ks.matchedTerms,
          diagnostics: includeDiag ? { keywordScore: ks.score } : undefined,
        });
      }
    }
  } else if (strategy === "bm25") {
    const bm25Scores = computeBM25Scores(filtered, queryTrimmed, config.fieldWeights);
    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i]!;
      const originalIdx = entries.indexOf(entry);
      const bm25 = bm25Scores[i]!;
      const priorityScore = (entry.priority ?? 0) * priorityWeight;
      const total = bm25 + priorityScore;
      if (total > 0) {
        // Get matched fields from keyword scorer (for metadata only)
        const ks = computeKeywordScore(entry, queryTrimmed, config.fieldWeights, hints, 0);
        scored.push({
          score: total,
          sourceIndex: originalIdx,
          entry,
          matchedFields: ks.matchedFields,
          matchedTerms: ks.matchedTerms,
          diagnostics: includeDiag
            ? { bm25Score: bm25, priorityScore, keywordScore: 0 }
            : undefined,
        });
      }
    }
  } else if (strategy === "hybrid") {
    const hw = DEFAULT_HYBRID_WEIGHTS;
    const bm25Scores = computeBM25Scores(filtered, queryTrimmed, config.fieldWeights);
    const maxBM25 = bm25Scores.reduce((a, b) => Math.max(a, b), 1);
    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i]!;
      const originalIdx = entries.indexOf(entry);
      const ks = computeKeywordScore(entry, queryTrimmed, config.fieldWeights, hints, 0);
      const bm25Raw = bm25Scores[i]!;
      const bm25Norm = maxBM25 > 0 ? bm25Raw / maxBM25 : 0;
      const keywordNorm = ks.score > 0 ? ks.score / Math.max(ks.score, 1) : 0;
      const hintScore = ks.score > 0 ? ks.score * 0.1 : 0;
      const priorityScore = (entry.priority ?? 0) * priorityWeight;
      const total =
        keywordNorm * hw.keyword +
        bm25Norm * hw.bm25 +
        (hintScore + priorityScore) * hw.hintsAndPriority;
      if (total > 0) {
        scored.push({
          score: total,
          sourceIndex: originalIdx,
          entry,
          matchedFields: ks.matchedFields,
          matchedTerms: ks.matchedTerms,
          diagnostics: includeDiag
            ? { keywordScore: keywordNorm, bm25Score: bm25Norm, hintScore, priorityScore }
            : undefined,
        });
      }
    }
  } else {
    throw new Error(`retrieve: unknown strategy "${strategy as string}"`);
  }

  // Sort: score desc → priority desc → sourceIndex asc → id asc
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = a.entry.priority ?? 0;
    const pb = b.entry.priority ?? 0;
    if (pb !== pa) return pb - pa;
    if (a.sourceIndex !== b.sourceIndex) return a.sourceIndex - b.sourceIndex;
    return a.entry.id.localeCompare(b.entry.id);
  });

  // Apply minScore
  const finalScored = minScore !== undefined ? scored.filter((s) => s.score >= minScore) : scored;

  const totalMatched = finalScored.length;

  // Apply limit
  const limited = finalScored.slice(0, limit);

  // Build hits
  const hits: RetrievalHitV1[] = limited.map((s, idx) => ({
    rank: idx + 1,
    score: s.score,
    sourceIndex: s.sourceIndex,
    entry: { ...s.entry },
    matchedFields: s.matchedFields,
    matchedTerms: s.matchedTerms,
    diagnostics: s.diagnostics,
  }));

  return {
    query: queryTrimmed,
    strategy,
    totalCandidates,
    totalAfterFilter,
    totalMatched,
    returned: hits.length,
    hits,
  };
}
