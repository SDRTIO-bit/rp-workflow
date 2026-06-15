/**
 * Retrieval Node Definitions — P-4
 */
import type { NodeDefinition } from "@awp/workflow-core";
import { RETRIEVAL_FILTER_SCHEMA, RETRIEVAL_HINTS_SCHEMA, RETRIEVAL_RESULT_SCHEMA } from "./types";

function wIn(
  id: string,
  label: string,
  wireType: "text" | "json" | "markdown",
  required: boolean,
  schemaId?: string,
) {
  const base = { id, label, direction: "input" as const, wireType, required };
  return schemaId ? { ...base, schemaId } : base;
}
function wOut(
  id: string,
  label: string,
  wireType: "text" | "json" | "markdown",
  schemaId?: string,
) {
  const base = { id, label, direction: "output" as const, wireType };
  return schemaId ? { ...base, schemaId } : base;
}

export const genericRetrieverNode: NodeDefinition = {
  type: "genericRetriever",
  label: "Generic Retriever",
  labelI18n: { zh: "通用检索器", en: "Generic Retriever" },
  category: "knowledge",
  description:
    "Platform-level retrieval node. Accepts a text query and JSON corpus, applies filters and hints, scores with keyword/BM25/hybrid strategy, and outputs ranked results.",
  descriptionI18n: {
    zh: "平台级检索节点。接受文本查询和 JSON 语料库，应用过滤器和提示词，以 keyword/BM25/hybrid 策略评分并输出排序结果。",
    en: "Platform-level retrieval node. Accepts a text query and JSON corpus, applies filters and hints, scores with keyword/BM25/hybrid strategy, and outputs ranked results.",
  },
  color: "#0891b2",
  panelLayout: "generic",
  defaultConfig: {
    strategy: "keyword",
    limit: 8,
    includeDiagnostics: false,
  },
  configFields: [
    {
      key: "strategy",
      label: { zh: "检索策略", en: "Strategy" },
      kind: "select",
      options: ["keyword", "bm25", "hybrid"],
      required: true,
    },
    {
      key: "limit",
      label: { zh: "返回数量", en: "Limit" },
      kind: "number",
      min: 1,
      max: 100,
    },
    {
      key: "minScore",
      label: { zh: "最低分数", en: "Min Score" },
      kind: "number",
      min: 0,
      advanced: true,
    },
    {
      key: "includeDiagnostics",
      label: { zh: "包含诊断", en: "Include Diagnostics" },
      kind: "boolean",
      advanced: true,
    },
  ],
  ports: [
    wIn("query", "Query", "text", true),
    wIn("corpus", "Corpus", "json", true),
    wIn("filters", "Filters", "json", false, RETRIEVAL_FILTER_SCHEMA),
    wIn("hints", "Hints", "json", false, RETRIEVAL_HINTS_SCHEMA),
    wOut("result", "Result", "json", RETRIEVAL_RESULT_SCHEMA),
  ],
};

export const retrievalResultToMarkdownNode: NodeDefinition = {
  type: "retrievalResultToMarkdown",
  label: "Retrieval Result → Markdown",
  labelI18n: { zh: "检索结果 → Markdown", en: "Retrieval Result → Markdown" },
  category: "utility",
  description: "Converts a RetrievalResultV1 into Agent-readable Markdown. Deterministic, no LLM.",
  descriptionI18n: {
    zh: "将 RetrievalResultV1 转换为 Agent 可读的 Markdown。确定性，不调用 LLM。",
    en: "Converts a RetrievalResultV1 into Agent-readable Markdown. Deterministic, no LLM.",
  },
  color: "#7c3aed",
  panelLayout: "generic",
  defaultConfig: {
    heading: "# Retrieved Context",
    includeScores: false,
    maxCharsPerEntry: 2000,
  },
  configFields: [
    {
      key: "heading",
      label: { zh: "标题", en: "Heading" },
      kind: "text",
    },
    {
      key: "includeScores",
      label: { zh: "包含分数", en: "Include Scores" },
      kind: "boolean",
    },
    {
      key: "maxCharsPerEntry",
      label: { zh: "条目最大字符", en: "Max Chars Per Entry" },
      kind: "number",
      min: 100,
      max: 10000,
      advanced: true,
    },
  ],
  ports: [
    wIn("result", "Result", "json", true, RETRIEVAL_RESULT_SCHEMA),
    wOut("markdown", "Markdown", "markdown"),
  ],
};
