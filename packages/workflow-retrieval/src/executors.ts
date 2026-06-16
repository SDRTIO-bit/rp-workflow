/**
 * Retrieval Executors — P-4
 */
import type { NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import { retrieve } from "./retrieve.js";
import { formatRetrievalResult } from "./formatter.js";
import type {
  RetrievalCorpusV1,
  RetrievalFilterV1,
  RetrievalHintsV1,
  GenericRetrieverConfig,
  RetrievalResultV1,
  RetrievalResultMarkdownConfig,
} from "./types.js";

export const genericRetrieverExecutor: NodeExecutor = async (input: NodeExecutionInput) => {
  const node = input.node;
  const config = node.config as unknown as GenericRetrieverConfig;
  const inputs = input.inputs as Record<string, unknown>;

  const query = typeof inputs.query === "string" ? inputs.query : String(inputs.query ?? "");
  if (query.trim().length === 0) {
    throw new Error("genericRetriever: query must be a non-empty string");
  }

  const corpus = inputs.corpus as RetrievalCorpusV1 | undefined;
  if (!corpus || !Array.isArray(corpus.entries)) {
    throw new Error(
      "genericRetriever: corpus must be a valid RetrievalCorpusV1 with entries array",
    );
  }

  const filter = (inputs.filters as RetrievalFilterV1) ?? undefined;
  const hints = (inputs.hints as RetrievalHintsV1) ?? undefined;

  const result = retrieve(query, corpus, config, filter, hints);

  return {
    outputs: { result },
    metadata: {
      strategy: result.strategy,
      candidateCount: result.totalCandidates,
      afterFilterCount: result.totalAfterFilter,
      matchedCount: result.totalMatched,
      returnedCount: result.returned,
      queryTokenCount: 0, // token counts computed internally, not exposed to trace for brevity
    },
  };
};

export const retrievalResultToMarkdownExecutor: NodeExecutor = async (
  input: NodeExecutionInput,
) => {
  const node = input.node;
  const config = node.config as unknown as RetrievalResultMarkdownConfig;
  const inputs = input.inputs as Record<string, unknown>;

  const result = inputs.result as RetrievalResultV1 | undefined;
  if (!result || !Array.isArray(result.hits)) {
    throw new Error("retrievalResultToMarkdown: input must be a valid RetrievalResultV1");
  }

  const markdown = formatRetrievalResult(result, config);

  return {
    outputs: { markdown },
    metadata: {
      hitCount: result.hits.length,
      returnedCount: result.returned,
    },
  };
};
