/**
 * Workflow Stdlib Node Definitions — P-2
 *
 * Registers composable context nodes: Merge, Convert, enhanced Sources.
 */

import type { NodeCatalog, WireType } from "@awp/workflow-core";

// ============ Port Helpers ============
function wIn(id: string, label: string, wireType: WireType, required = true) {
  return { id, label, direction: "input" as const, wireType, required };
}

function wOut(id: string, label: string, wireType: WireType) {
  return { id, label, direction: "output" as const, wireType };
}

// ============ Node Definitions ============

export const stdlibNodes: NodeCatalog = {
  // ------- Merge Nodes -------

  jsonMerge: {
    type: "jsonMerge",
    label: "JSON Merge",
    labelI18n: { zh: "JSON 合并", en: "JSON Merge" },
    category: "utility",
    description:
      "Merges two JSON inputs. Supports array-concat, object-shallow, and object-deep modes.",
    descriptionI18n: {
      zh: "合并两个 JSON 输入。支持 array-concat、object-shallow 和 object-deep 三种模式。",
      en: "Merges two JSON inputs. Supports array-concat, object-shallow, and object-deep modes.",
    },
    color: "#475569",
    panelLayout: "generic",
    defaultConfig: { mode: "array-concat" },
    configFields: [
      {
        key: "mode",
        label: { zh: "合并模式", en: "Merge Mode" },
        kind: "select",
        options: [
          { label: { zh: "数组拼接", en: "Array Concat" }, value: "array-concat" },
          { label: { zh: "浅层对象合并", en: "Object Shallow" }, value: "object-shallow" },
          { label: { zh: "深层对象合并", en: "Object Deep" }, value: "object-deep" },
        ],
      },
    ],
    ports: [
      wIn("left", "Left", "json", true),
      wIn("right", "Right", "json", true),
      wOut("result", "Result", "json"),
    ],
  },

  markdownMerge: {
    type: "markdownMerge",
    label: "Markdown Merge",
    labelI18n: { zh: "Markdown 合并", en: "Markdown Merge" },
    category: "utility",
    description:
      "Merges two Markdown inputs with configurable separator and optional section titles.",
    descriptionI18n: {
      zh: "合并两个 Markdown 输入，可配置分隔符和段落标题。",
      en: "Merges two Markdown inputs with configurable separator and optional section titles.",
    },
    color: "#7c3aed",
    panelLayout: "generic",
    defaultConfig: { separator: "\n\n", skipEmpty: true },
    configFields: [
      {
        key: "separator",
        label: { zh: "分隔符", en: "Separator" },
        kind: "text",
        placeholder: { zh: "默认: 双换行", en: "Default: double newline" },
      },
      {
        key: "leftTitle",
        label: { zh: "左侧标题", en: "Left Title" },
        kind: "text",
        placeholder: { zh: "可选", en: "Optional" },
      },
      {
        key: "rightTitle",
        label: { zh: "右侧标题", en: "Right Title" },
        kind: "text",
        placeholder: { zh: "可选", en: "Optional" },
      },
      {
        key: "skipEmpty",
        label: { zh: "跳过空块", en: "Skip Empty" },
        kind: "boolean",
      },
    ],
    ports: [
      wIn("left", "Left", "markdown", true),
      wIn("right", "Right", "markdown", true),
      wOut("result", "Result", "markdown"),
    ],
  },

  textMerge: {
    type: "textMerge",
    label: "Text Merge",
    labelI18n: { zh: "文本合并", en: "Text Merge" },
    category: "utility",
    description: "Merges two Text inputs with configurable separator.",
    descriptionI18n: {
      zh: "合并两个文本输入，可配置分隔符。",
      en: "Merges two Text inputs with configurable separator.",
    },
    color: "#2563eb",
    panelLayout: "generic",
    defaultConfig: { separator: "\n", skipEmpty: true },
    configFields: [
      {
        key: "separator",
        label: { zh: "分隔符", en: "Separator" },
        kind: "text",
        placeholder: { zh: "默认: 换行", en: "Default: newline" },
      },
      {
        key: "skipEmpty",
        label: { zh: "跳过空块", en: "Skip Empty" },
        kind: "boolean",
      },
    ],
    ports: [
      wIn("left", "Left", "text", true),
      wIn("right", "Right", "text", true),
      wOut("result", "Result", "text"),
    ],
  },

  // ------- Conversion Nodes -------

  jsonToMarkdown: {
    type: "jsonToMarkdown",
    label: "JSON → Markdown",
    labelI18n: { zh: "JSON → Markdown", en: "JSON → Markdown" },
    category: "utility",
    description:
      "Converts structured JSON data into a deterministic Markdown representation for Agent reading.",
    descriptionI18n: {
      zh: "将结构化 JSON 数据转换为确定性 Markdown 表示，供 Agent 阅读。",
      en: "Converts structured JSON data into a deterministic Markdown representation for Agent reading.",
    },
    color: "#475569",
    panelLayout: "generic",
    defaultConfig: {},
    configFields: [],
    ports: [wIn("input", "Input", "json", true), wOut("output", "Output", "markdown")],
  },

  markdownToText: {
    type: "markdownToText",
    label: "Markdown → Text",
    labelI18n: { zh: "Markdown → Text", en: "Markdown → Text" },
    category: "utility",
    description:
      "Converts Markdown to plain text by stripping formatting. Deterministic, not LLM-based.",
    descriptionI18n: {
      zh: "将 Markdown 转换为纯文本（去除格式标记）。确定性转换，不调用 LLM。",
      en: "Converts Markdown to plain text by stripping formatting. Deterministic, not LLM-based.",
    },
    color: "#7c3aed",
    panelLayout: "generic",
    defaultConfig: {},
    configFields: [],
    ports: [wIn("input", "Input", "markdown", true), wOut("output", "Output", "text")],
  },
};

/** Merge stdlib nodes into a target catalog. */
export function mergeStdlibNodes(target: NodeCatalog): NodeCatalog {
  return { ...target, ...stdlibNodes };
}
