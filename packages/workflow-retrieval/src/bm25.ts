/**
 * BM25-lite Scoring — P-4
 *
 * Standard BM25 implementation with k1=1.2, b=0.75.
 * Field-weighted: builds a weighted virtual text representation.
 *
 * Formula:
 *   score(d, q) = Σ IDF(t) * (f(t,d) * (k1+1)) / (f(t,d) + k1*(1-b+b*|d|/avgdl))
 *
 * Where:
 *   IDF(t) = log((N - n(t) + 0.5) / (n(t) + 0.5) + 1)
 *   N = total documents, n(t) = documents containing token
 *   f(t,d) = weighted frequency of token in document
 *   |d| = weighted document length, avgdl = average weighted doc length
 */
import { tokenize } from "./tokenizer";
import type { RetrievalDocumentV1, RetrievalFieldWeights } from "./types";
import { DEFAULT_FIELD_WEIGHTS } from "./types";

const K1 = 1.2;
const B = 0.75;

interface FieldTokens {
  title: string[];
  content: string[];
  tags: string[];
  entityIds: string[];
  type: string[];
}

function tokenizeFields(
  doc: RetrievalDocumentV1,
  weights: Required<RetrievalFieldWeights>,
): { weightedTokens: string[]; fieldTokens: FieldTokens } {
  const title = tokenize(doc.title ?? "");
  const content = tokenize(doc.content);
  const tags = (doc.tags ?? []).flatMap((t) => tokenize(t));
  const entityIds = (doc.entityIds ?? []).flatMap((e) => tokenize(e));
  const type = doc.type ? tokenize(doc.type) : [];

  const ft: FieldTokens = { title, content, tags, entityIds, type };

  // Build weighted virtual text: repeat each field token by its weight
  const weighted: string[] = [];
  const repeat = (tk: string[], w: number) => {
    const count = Math.round(w);
    for (let i = 0; i < count; i++) weighted.push(...tk);
  };

  repeat(title, weights.title);
  repeat(content, weights.content);
  repeat(tags, weights.tags);
  repeat(entityIds, weights.entityIds);
  repeat(type, weights.type);

  return { weightedTokens: weighted, fieldTokens: ft };
}

export function computeBM25Scores(
  docs: RetrievalDocumentV1[],
  queryText: string,
  fieldWeights: RetrievalFieldWeights = {},
): number[] {
  const weights: Required<RetrievalFieldWeights> = {
    ...DEFAULT_FIELD_WEIGHTS,
    ...fieldWeights,
  };

  const queryTokens = tokenize(queryText);
  if (queryTokens.length === 0) return docs.map(() => 0);

  const N = docs.length;
  if (N === 0) return [];

  // Tokenize all documents with field weights
  const docData = docs.map((d) => tokenizeFields(d, weights));
  const docLengths = docData.map((d) => d.weightedTokens.length);
  const avgdl = docLengths.reduce((a, b) => a + b, 0) / N;

  // Document frequency for each query token
  const tokenDFMap = new Map<string, number>();
  for (const qt of queryTokens) {
    const lq = qt.toLowerCase();
    let count = 0;
    for (const dd of docData) {
      if (dd.weightedTokens.some((t) => t.toLowerCase() === lq)) count++;
    }
    tokenDFMap.set(qt, count);
  }

  // IDF for each token
  const idfs: number[] = queryTokens.map((qt) => {
    const n = tokenDFMap.get(qt) ?? 0;
    return Math.log((N - n + 0.5) / (n + 0.5) + 1);
  });

  // Score each document
  return docs.map((_doc, idx) => {
    let score = 0;
    const dData = docData[idx]!;
    const dl = docLengths[idx]!;
    const weightedLower = dData.weightedTokens.map((t) => t.toLowerCase());

    for (let qi = 0; qi < queryTokens.length; qi++) {
      const qt = queryTokens[qi]!;
      const lqt = qt.toLowerCase();
      const f = weightedLower.filter((t) => t === lqt).length;
      if (f === 0) continue;
      const idf = idfs[qi]!;
      const numerator = f * (K1 + 1);
      const denominator = f + K1 * (1 - B + B * (dl / (avgdl || 1)));
      score += idf * (numerator / denominator);
    }

    return score;
  });
}
