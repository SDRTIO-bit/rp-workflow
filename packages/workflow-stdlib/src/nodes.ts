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

  // ============ P-10: Conditional Routing Nodes ============

  conditionalRoute: {
    type: "conditionalRoute",
    label: "Conditional Route",
    labelI18n: { zh: "条件路由", en: "Conditional Route" },
    category: "core",
    description:
      "Evaluates a condition and activates one of two output branches. The inactive branch nodes are skipped by the runner.",
    descriptionI18n: {
      zh: "评估条件并激活两个输出分支之一。非活动分支的节点由运行器跳过。",
      en: "Evaluates a condition and activates one of two output branches. The inactive branch nodes are skipped by the runner.",
    },
    color: "#f59e0b",
    panelLayout: "generic",
    defaultConfig: {
      conditionField: "accepted",
    },
    configFields: [
      {
        key: "conditionField",
        label: { zh: "条件字段", en: "Condition Field" },
        kind: "text",
        placeholder: { zh: "例如: accepted", en: "e.g. accepted" },
        help: {
          zh: "从 condition 输入中读取的布尔字段名",
          en: "Boolean field name to read from condition input",
        },
      },
    ],
    ports: [
      wIn("condition", "Condition", "json", true),
      wOut("activeBranch", "Active Branch", "text"),
      wOut("acceptBranch", "Accept Branch", "json"),
      wOut("reviseBranch", "Revise Branch", "json"),
    ],
  },

  finalDraftSelector: {
    type: "finalDraftSelector",
    label: "Final Draft Selector",
    labelI18n: { zh: "终稿选择器", en: "Final Draft Selector" },
    category: "core",
    description:
      "Merges two branches by selecting the active branch's output. Accepts drafts from both accept and revise branches.",
    descriptionI18n: {
      zh: "通过选择活动分支的输出来合并两个分支。接收来自 accept 和 revise 两个分支的草稿。",
      en: "Merges two branches by selecting the active branch's output. Accepts drafts from both accept and revise branches.",
    },
    color: "#0ea5e9",
    panelLayout: "generic",
    defaultConfig: {},
    configFields: [],
    ports: [
      wIn("acceptDraft", "Accept Draft", "text", false),
      wIn("reviseDraft", "Revise Draft", "text", false),
      wIn("acceptRouting", "Accept Routing", "json", false),
      wOut("finalDraft", "Final Draft", "text"),
    ],
  },

  // ============ P-11: Session Conversion Node ============

  sessionToMarkdown: {
    type: "sessionToMarkdown",
    label: "Session → Markdown",
    labelI18n: { zh: "会话 → Markdown", en: "Session → Markdown" },
    category: "core",
    description:
      "Converts AgentSessionContextV1 JSON into readable markdown for LLM context injection. Deterministic, no LLM.",
    descriptionI18n: {
      zh: "将 AgentSessionContextV1 JSON 转换为可读的 Markdown，供 LLM 上下文注入。确定性转换，不调用 LLM。",
      en: "Converts AgentSessionContextV1 JSON into readable markdown for LLM context injection. Deterministic, no LLM.",
    },
    color: "#0ea5e9",
    panelLayout: "generic",
    defaultConfig: {},
    configFields: [],
    ports: [
      wIn("sessionContext", "Session Context", "json", true),
      wOut("markdown", "Markdown", "markdown"),
    ],
  },

  // ============ P-11: Session Delta Builder ============

  buildSessionDelta: {
    type: "buildSessionDelta",
    label: "Build Session Delta",
    labelI18n: { zh: "构建会话增量", en: "Build Session Delta" },
    category: "core",
    description:
      "Builds an AgentSessionDeltaV1 from session key, player input, final draft, and turn info. Deterministic, no LLM.",
    descriptionI18n: {
      zh: "从会话密钥、玩家输入、最终草稿和回合信息构建 AgentSessionDeltaV1。确定性，不调用 LLM。",
      en: "Builds an AgentSessionDeltaV1 from session key, player input, final draft, and turn info. Deterministic, no LLM.",
    },
    color: "#10b981",
    panelLayout: "generic",
    defaultConfig: {},
    configFields: [],
    ports: [
      wIn("sessionKey", "Session Key", "json", true),
      wIn("playerInput", "Player Input", "text", false),
      wIn("finalDraft", "Final Draft", "text", false),
      wOut("sessionDelta", "Session Delta", "json"),
    ],
  },
};

/** Merge stdlib nodes into a target catalog. */
export function mergeStdlibNodes(target: NodeCatalog): NodeCatalog {
  return { ...target, ...stdlibNodes };
}
