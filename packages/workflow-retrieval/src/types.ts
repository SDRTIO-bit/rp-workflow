/**
 * Retrieval Layer Types — P-4
 *
 * Platform-level, store-independent retrieval model.
 */
import type { WireType } from "@awp/workflow-core";

// ============ Document ============

export type RetrievalDocumentV1 = {
  id: string;
  content: string;
  title?: string;
  type?: string;
  tags?: string[];
  entityIds?: string[];
  priority?: number;
  metadata?: Record<string, unknown>;
};

// ============ Corpus ============

export type RetrievalCorpusV1 = {
  entries: RetrievalDocumentV1[];
};

// ============ Filters & Hints ============

export type RetrievalFilterV1 = {
  entryIds?: string[];
  tagsAny?: string[];
  tagsAll?: string[];
  entityIdsAny?: string[];
  type?: string;
  titleContains?: string;
};

export type RetrievalHintsV1 = {
  keywords?: string[];
  tags?: string[];
  entityIds?: string[];
};

// ============ Strategy ============

export type RetrievalStrategy = "keyword" | "bm25" | "hybrid";

export type RetrievalFieldWeights = {
  title?: number;
  content?: number;
  tags?: number;
  entityIds?: number;
  type?: number;
};

export type GenericRetrieverConfig = {
  strategy: RetrievalStrategy;
  limit: number;
  minScore?: number;
  fieldWeights?: RetrievalFieldWeights;
  priorityWeight?: number;
  includeDiagnostics?: boolean;
};

export const DEFAULT_FIELD_WEIGHTS: Required<RetrievalFieldWeights> = {
  title: 3,
  content: 1,
  tags: 2,
  entityIds: 2,
  type: 1.5,
};

export const DEFAULT_PRIORITY_WEIGHT = 0.05;
export const DEFAULT_LIMIT = 8;
export const DEFAULT_STRATEGY: RetrievalStrategy = "keyword";

// ============ Hit ============

export type RetrievalHitV1 = {
  rank: number;
  score: number;
  sourceIndex: number;
  entry: RetrievalDocumentV1;
  matchedFields: string[];
  matchedTerms: string[];
  diagnostics?: {
    keywordScore?: number;
    bm25Score?: number;
    hintScore?: number;
    priorityScore?: number;
  };
};

// ============ Result ============

export type RetrievalResultV1 = {
  query: string;
  strategy: RetrievalStrategy;
  totalCandidates: number;
  totalAfterFilter: number;
  totalMatched: number;
  returned: number;
  hits: RetrievalHitV1[];
};

// ============ Hybrid Weights ============

export type HybridWeights = {
  keyword: number;
  bm25: number;
  hintsAndPriority: number;
};

export const DEFAULT_HYBRID_WEIGHTS: HybridWeights = {
  keyword: 0.45,
  bm25: 0.45,
  hintsAndPriority: 0.1,
};

// ============ Retrieval Result → Markdown ============

export type RetrievalResultMarkdownConfig = {
  heading?: string;
  includeScores?: boolean;
  includeMetadata?: boolean;
  includeEmptyMessage?: boolean;
  emptyMessage?: string;
  maxEntries?: number;
  maxCharsPerEntry?: number;
};

export const DEFAULT_MARKDOWN_CONFIG: Required<RetrievalResultMarkdownConfig> = {
  heading: "# Retrieved Context",
  includeScores: false,
  includeMetadata: false,
  includeEmptyMessage: true,
  emptyMessage: "(No relevant context found.)",
  maxEntries: 20,
  maxCharsPerEntry: 2000,
};

// ============ Schema IDs ============

export const RETRIEVAL_DOCUMENT_SCHEMA = "awp.retrieval-document.v1";
export const RETRIEVAL_CORPUS_SCHEMA = "awp.retrieval-corpus.v1";
export const RETRIEVAL_FILTER_SCHEMA = "awp.retrieval-filter.v1";
export const RETRIEVAL_HINTS_SCHEMA = "awp.retrieval-hints.v1";
export const RETRIEVAL_RESULT_SCHEMA = "awp.retrieval-result.v1";

// ============ Port Helpers ============

export function wIn(id: string, label: string, wireType: WireType, required = true) {
  return { id, label, direction: "input" as const, wireType, required };
}
export function wOut(id: string, label: string, wireType: WireType) {
  return { id, label, direction: "output" as const, wireType };
}
