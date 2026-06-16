/**
 * Memory Node Definitions — P-5
 */
import type { NodeDefinition } from "@awp/workflow-core";
import {
  MEMORY_WRITE_INPUT_SCHEMA,
  MEMORY_WRITE_OUTPUT_SCHEMA,
  MEMORY_QUERY_INPUT_SCHEMA,
  MEMORY_CORPUS_OUTPUT_SCHEMA,
} from "./types.js";

function wIn(
  id: string,
  label: string,
  wireType: "text" | "json" | "markdown",
  required = true,
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

export const memoryWriteNode: NodeDefinition = {
  type: "memoryWrite",
  label: "Memory Write",
  labelI18n: { zh: "记忆写入", en: "Memory Write" },
  category: "knowledge",
  description: "Writes one or more memory records to a namespace-persisted store.",
  descriptionI18n: {
    zh: "向按 namespace 持久化的存储写入一条或多条记忆记录。",
    en: "Writes one or more memory records to a namespace-persisted store.",
  },
  color: "#0ea5e9",
  panelLayout: "generic",
  defaultConfig: { namespace: "" },
  configFields: [
    {
      key: "namespace",
      label: { zh: "命名空间", en: "Namespace" },
      kind: "text",
      required: true,
    },
  ],
  ports: [
    wIn("input", "Input", "json", true, MEMORY_WRITE_INPUT_SCHEMA),
    wOut("output", "Output", "json", MEMORY_WRITE_OUTPUT_SCHEMA),
  ],
};

export const memoryCorpusNode: NodeDefinition = {
  type: "memoryCorpus",
  label: "Memory Corpus",
  labelI18n: { zh: "记忆语料库", en: "Memory Corpus" },
  category: "knowledge",
  description:
    "Retrieves memory records from a namespace and outputs as RetrievalCorpusV1 for P-4 Retriever integration.",
  descriptionI18n: {
    zh: "从 namespace 检索记忆记录，输出为 RetrievalCorpusV1 供 P-4 检索器使用。",
    en: "Retrieves memory records from a namespace and outputs as RetrievalCorpusV1 for P-4 Retriever integration.",
  },
  color: "#0ea5e9",
  panelLayout: "generic",
  defaultConfig: { namespace: "" },
  configFields: [
    {
      key: "namespace",
      label: { zh: "命名空间", en: "Namespace" },
      kind: "text",
      required: true,
    },
  ],
  ports: [
    wIn("filters", "Filters", "json", false, MEMORY_QUERY_INPUT_SCHEMA),
    wOut("corpus", "Corpus", "json", MEMORY_CORPUS_OUTPUT_SCHEMA),
  ],
};

export const memoryDeleteNode: NodeDefinition = {
  type: "memoryDelete",
  label: "Memory Delete",
  labelI18n: { zh: "记忆删除", en: "Memory Delete" },
  category: "knowledge",
  description: "Deletes memory records from a namespace by ID.",
  descriptionI18n: {
    zh: "按 ID 从 namespace 删除记忆记录。",
    en: "Deletes memory records from a namespace by ID.",
  },
  color: "#ef4444",
  panelLayout: "generic",
  defaultConfig: { namespace: "" },
  configFields: [
    {
      key: "namespace",
      label: { zh: "命名空间", en: "Namespace" },
      kind: "text",
      required: true,
    },
  ],
  ports: [wIn("input", "Input", "json", true), wOut("output", "Output", "json")],
};
