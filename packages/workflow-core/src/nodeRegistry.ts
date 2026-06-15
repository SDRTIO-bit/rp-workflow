import type {
  DataType,
  LegacyPortDefinition,
  LegacyPortMapping,
  NodeCatalog,
  NodeDefinition,
  PortDefinition,
  SchemaCompatResult,
  WirePortDefinition,
  WireType,
} from "./types";
import { isLegacyPort, isWirePort } from "./types";

// ============ Port Factory Helpers ============

/** Create a legacy input port (dataType-based). Used by existing nodes. */
const input = (
  id: string,
  label: string,
  dataType: DataType,
  required = true,
): LegacyPortDefinition => ({
  id,
  label,
  dataType,
  direction: "input",
  required,
});

/** Create a legacy output port (dataType-based). Used by existing nodes. */
const output = (id: string, label: string, dataType: DataType): LegacyPortDefinition => ({
  id,
  label,
  dataType,
  direction: "output",
});

/** Create a wire-native input port. Used by P-1+ nodes. */
const wireInput = (
  id: string,
  label: string,
  wireType: WireType,
  opts?: { required?: boolean; schemaId?: string },
): WirePortDefinition => ({
  id,
  label,
  wireType,
  direction: "input",
  required: opts?.required ?? true,
  ...(opts?.schemaId ? { schemaId: opts.schemaId } : {}),
});

/** Create a wire-native output port. Used by P-1+ nodes. */
const wireOutput = (
  id: string,
  label: string,
  wireType: WireType,
  opts?: { schemaId?: string },
): WirePortDefinition => ({
  id,
  label,
  wireType,
  direction: "output",
  ...(opts?.schemaId ? { schemaId: opts.schemaId } : {}),
});

// ============ Legacy → Wire Mapping Table ============

/**
 * Explicit per-(nodeType, portId) mapping from legacy DataType to WireType.
 * Only ports in this table are eligible for mixed legacy/wire connections.
 * Unregistered legacy ports resolve to undefined.
 */
export const LEGACY_PORT_WIRE_MAP: LegacyPortMapping[] = [
  { nodeType: "userInput", portId: "text", wireType: "text" },
  { nodeType: "textOutput", portId: "text", wireType: "text" },
  { nodeType: "textOutput", portId: "final", wireType: "text" },
  { nodeType: "rpWriterV1", portId: "narrative", wireType: "text" },
  { nodeType: "rpWriterV1", portId: "writerOutput", wireType: "json" },
  { nodeType: "rpWriterV1", portId: "compiledPrompt", wireType: "json" },
  { nodeType: "rpWriterV1", portId: "assembledContext", wireType: "json" },
  { nodeType: "rpPromptCompilerV1", portId: "compiledPrompt", wireType: "json" },
  { nodeType: "rpPromptCompilerV1", portId: "promptDocument", wireType: "json" },
  { nodeType: "rpPromptCompilerV1", portId: "resolvedPreset", wireType: "json" },
  { nodeType: "rpContextAssemblerV2", portId: "promptDocument", wireType: "json" },
  { nodeType: "rpContextAssemblerV2", portId: "assembledContext", wireType: "json" },
  { nodeType: "rpContextAssemblerV2", portId: "budgetReport", wireType: "json" },
  { nodeType: "rpInputParserLlmV1", portId: "parsedInput", wireType: "json" },
  { nodeType: "rpInputParserLlmV1", portId: "parserInput", wireType: "json" },
  { nodeType: "rpInputParserLlmV1", portId: "worldbookEntries", wireType: "json" },
  { nodeType: "rpRecentMessagesV1", portId: "recentMessages", wireType: "json" },
  { nodeType: "rpWorldbookRetrieverV1", portId: "retrievalResult", wireType: "json" },
  { nodeType: "rpWorldbookRetrieverV1", portId: "rawInput", wireType: "text" },
  { nodeType: "rpWorldbookRetrieverV1", portId: "worldbookEntries", wireType: "json" },
  { nodeType: "rpWorldbookRetrieverV1", portId: "recentMessages", wireType: "json" },
  { nodeType: "rpTimelineQueryV1", portId: "parsedInput", wireType: "json" },
  { nodeType: "rpTimelineQueryV1", portId: "timelineContext", wireType: "json" },
  { nodeType: "rpLoreRetrieverV1", portId: "parsedInput", wireType: "json" },
  { nodeType: "rpLoreRetrieverV1", portId: "loreContext", wireType: "json" },
  { nodeType: "rpPresetResolverV1", portId: "preset", wireType: "json" },
  { nodeType: "rpPresetResolverV1", portId: "directives", wireType: "json" },
  { nodeType: "rpPresetResolverV1", portId: "resolvedPreset", wireType: "json" },
  { nodeType: "rpOutputComposerV1", portId: "text", wireType: "text" },
  { nodeType: "rpOutputComposerV1", portId: "composedOutput", wireType: "json" },
  { nodeType: "rpOutputComposerV1", portId: "writerContent", wireType: "json" },
  { nodeType: "rpFormatValidatorV1", portId: "composedOutput", wireType: "json" },
  { nodeType: "rpFormatValidatorV1", portId: "outputContract", wireType: "json" },
  { nodeType: "rpFormatValidatorV1", portId: "validationResult", wireType: "json" },
  { nodeType: "rpChapterSummaryV1", portId: "parsedInput", wireType: "json" },
  { nodeType: "rpChapterSummaryV1", portId: "writerOutput", wireType: "json" },
  { nodeType: "rpChapterSummaryV1", portId: "memoryEvent", wireType: "json" },
  { nodeType: "rpChapterSummaryV1", portId: "chapterPatch", wireType: "json" },
  { nodeType: "rpTrackerUpdateV1", portId: "parsedInput", wireType: "json" },
  { nodeType: "rpTrackerUpdateV1", portId: "currentState", wireType: "json" },
  { nodeType: "rpTrackerUpdateV1", portId: "trackerPatch", wireType: "json" },
  { nodeType: "rpMemoryCommitV1", portId: "memoryEvent", wireType: "json" },
  { nodeType: "rpMemoryCommitV1", portId: "chapterPatch", wireType: "json" },
  { nodeType: "rpMemoryCommitV1", portId: "trackerPatch", wireType: "json" },
  { nodeType: "rpMemoryCommitV1", portId: "commitResult", wireType: "json" },
  { nodeType: "rpSemanticExpanderV1", portId: "parsedInput", wireType: "json" },
  { nodeType: "rpSemanticExpanderV1", portId: "worldbookEntries", wireType: "json" },
  { nodeType: "rpSemanticExpanderV1", portId: "deterministicResult", wireType: "json" },
  { nodeType: "rpSemanticExpanderV1", portId: "mergedResult", wireType: "json" },
  { nodeType: "rpParserInputBuilderV1", portId: "rawInput", wireType: "text" },
  { nodeType: "rpParserInputBuilderV1", portId: "retrievalResult", wireType: "json" },
  { nodeType: "rpParserInputBuilderV1", portId: "worldbookEntries", wireType: "json" },
  { nodeType: "rpParserInputBuilderV1", portId: "recentMessages", wireType: "json" },
  { nodeType: "rpParserInputBuilderV1", portId: "currentLocation", wireType: "text" },
  { nodeType: "rpParserInputBuilderV1", portId: "charactersPresent", wireType: "json" },
  { nodeType: "rpParserInputBuilderV1", portId: "parserInput", wireType: "json" },
  { nodeType: "agentV2", portId: "context", wireType: "markdown" },
  { nodeType: "agentV2", portId: "instruction", wireType: "text" },
  { nodeType: "agentV2", portId: "sessionContext", wireType: "json" },
  { nodeType: "agentV2", portId: "result", wireType: "text" },
  { nodeType: "agentV2", portId: "sessionDelta", wireType: "json" },
  { nodeType: "agentSessionLoadV1", portId: "sessionKey", wireType: "json" },
  { nodeType: "agentSessionLoadV1", portId: "sessionConfig", wireType: "json" },
  { nodeType: "agentSessionLoadV1", portId: "sessionContext", wireType: "json" },
  { nodeType: "agentSessionCommitV1", portId: "sessionDelta", wireType: "json" },
  { nodeType: "agentSessionCommitV1", portId: "sessionConfig", wireType: "json" },
  { nodeType: "agentSessionCommitV1", portId: "commitResult", wireType: "json" },
  { nodeType: "agentSessionClearV1", portId: "sessionKey", wireType: "json" },
  { nodeType: "agentSessionClearV1", portId: "clearResult", wireType: "json" },
  { nodeType: "resourceSource", portId: "entries", wireType: "json" },
  { nodeType: "agent", portId: "context", wireType: "markdown" },
  { nodeType: "agent", portId: "instruction", wireType: "text" },
  { nodeType: "agent", portId: "result", wireType: "text" },
  { nodeType: "debugLog", portId: "data", wireType: "json" },
  { nodeType: "debugLog", portId: "debug", wireType: "json" },
  { nodeType: "preview", portId: "data", wireType: "json" },
  { nodeType: "preview", portId: "preview", wireType: "json" },
  { nodeType: "assetPreview", portId: "data", wireType: "json" },
  { nodeType: "assetPreview", portId: "preview", wireType: "json" },
];

/**
 * Resolve the effective WireType for a port.
 * Wire ports: returns wireType directly (checks catalog first).
 * Legacy ports: looks up in LEGACY_PORT_WIRE_MAP (no catalog check needed).
 * Unregistered legacy ports: returns undefined (cannot connect to wire ports).
 *
 * @param catalog - Optional catalog to check for wire ports. Defaults to nodeRegistry.
 */
export function resolvePortWireType(
  nodeType: string,
  portId: string,
  catalog?: NodeCatalog,
): WireType | undefined {
  const cat = catalog ?? nodeRegistry;

  // Check if the port exists in the catalog — if it's a wire port, return its wireType
  const def = cat[nodeType];
  if (def) {
    const port = def.ports.find((p) => p.id === portId);
    if (port && isWirePort(port)) return port.wireType;
  }

  // Legacy port: look up in mapping table (no catalog requirement)
  const mapping = LEGACY_PORT_WIRE_MAP.find((m) => m.nodeType === nodeType && m.portId === portId);
  return mapping?.wireType;
}

export const nodeCategories: Record<string, { zh: string; en: string }> = {
  core: { zh: "核心节点", en: "Core" },
  knowledge: { zh: "知识节点", en: "Knowledge" },
  roleplay: { zh: "RP 角色扮演", en: "Roleplay" },
  external: { zh: "外来扩展节点", en: "External extensions" },
  utility: { zh: "工具节点", en: "Utility" },
};

export const nodeRegistry: Record<string, NodeDefinition> = {
  userInput: {
    type: "userInput",
    label: "User Input",
    labelI18n: { zh: "用户输入", en: "User Input" },
    category: "core",
    description: "Manual task, brief, or source text entered by the user.",
    descriptionI18n: {
      zh: "用户手动输入的任务、简介或源文本。",
      en: "Manual task, brief, or source text entered by the user.",
    },
    color: "#0f766e",
    preview: "Accepts free text and emits user_input for downstream nodes.",
    previewI18n: {
      zh: "接受自由文本并向下游节点发送 user_input。",
      en: "Accepts free text and emits user_input for downstream nodes.",
    },
    defaultConfig: { text: "在这里输入任务或剧情片段。" },
    configFields: [{ key: "text", label: { zh: "文本", en: "Text" }, kind: "textarea" }],
    ports: [output("text", "Text", "user_input")],
  },
  agent: {
    type: "agent",
    label: "Agent",
    labelI18n: { zh: "Agent 节点", en: "Agent" },
    category: "core",
    description: "Runs an LLM agent with selected skills, plugins, and upstream context.",
    descriptionI18n: {
      zh: "使用选定的 skill、插件和上游上下文运行 LLM agent。",
      en: "Runs an LLM agent with selected skills, plugins, and upstream context.",
    },
    color: "#2563eb",
    preview: "Context + optional instruction -> draft result.",
    previewI18n: {
      zh: "上下文 + 可选指令 → 草稿结果。",
      en: "Context + optional instruction -> draft result.",
    },
    quickAdd: true,
    panelLayout: "agent",
    defaultConfig: {
      systemPrompt: "根据上游信息完成当前 Agent 任务。",
      skills: [],
      plugins: [],
      outputType: "draft",
    },
    configFields: [
      {
        key: "model",
        label: { zh: "模型", en: "Model" },
        kind: "text",
        placeholder: { zh: "例如: deepseek-v4-flash", en: "e.g. deepseek-v4-flash" },
        help: {
          zh: "模型名称由 agent-runtime 的 Provider 配置管理",
          en: "Model name managed by agent-runtime provider config",
        },
      },
      { key: "systemPrompt", label: { zh: "系统提示词", en: "System prompt" }, kind: "textarea" },
      { key: "skills", label: { zh: "可见 skill", en: "Skills" }, kind: "tags" },
      { key: "plugins", label: { zh: "可见插件", en: "Plugins" }, kind: "tags" },
    ],
    ports: [
      input("context", "Context", "context"),
      input("instruction", "Instruction", "text", false),
      output("result", "Result", "draft"),
    ],
  },
  textOutput: {
    type: "textOutput",
    label: "Final Reply",
    labelI18n: { zh: "最终回复", en: "Final Reply" },
    category: "core",
    description:
      "Delivers the final prose output to the user. This is what the end user sees as the workflow result.",
    descriptionI18n: {
      zh: "将最终文本输出发送给用户。这是终端用户看到的工作流结果。",
      en: "Delivers the final prose output to the user. This is what the end user sees as the workflow result.",
    },
    color: "#b45309",
    preview: "Receives draft and emits final_text for the user-facing reply.",
    previewI18n: {
      zh: "接收草稿并输出面向用户的最终回复文本。",
      en: "Receives draft and emits final_text for the user-facing reply.",
    },
    panelLayout: "output",
    defaultConfig: {
      destination: "user",
      displayLabel: "Final Reply",
    },
    configFields: [
      {
        key: "destination",
        label: { zh: "输出目标", en: "Destination" },
        kind: "select",
        options: [
          { label: { zh: "发送给用户", en: "Send to User" }, value: "user" },
          { label: { zh: "导出为文件", en: "Export as File" }, value: "export" },
          { label: { zh: "仅预览", en: "Preview Only" }, value: "preview" },
        ],
      },
      {
        key: "displayLabel",
        label: { zh: "显示标签", en: "Display Label" },
        kind: "text",
      },
    ],
    ports: [input("text", "Text", "draft"), output("final", "Final", "final_text")],
  },
  resourceSource: {
    type: "resourceSource",
    label: "Resource Source",
    labelI18n: { zh: "资源源", en: "Resource Source" },
    category: "core",
    description:
      "Provides data from an external resource identified by resourceRef. The actual data is bound at runtime by a resource resolver.",
    descriptionI18n: {
      zh: "从 resourceRef 标识的外部资源提供数据。实际数据由运行时资源解析器绑定。",
      en: "Provides data from an external resource identified by resourceRef. The actual data is bound at runtime by a resource resolver.",
    },
    color: "#0ea5e9",
    preview: "Binds external data (worldbook, config, fixtures) into the workflow graph.",
    previewI18n: {
      zh: "将外部数据（世界书、配置、测试数据）绑定到工作流图中。",
      en: "Binds external data (worldbook, config, fixtures) into the workflow graph.",
    },
    defaultConfig: { resourceRef: "" },
    configFields: [
      {
        key: "resourceRef",
        label: { zh: "资源引用", en: "Resource Ref" },
        kind: "text",
        placeholder: { zh: "例如：worldbook:b29-test-world", en: "e.g. worldbook:b29-test-world" },
      },
    ],
    ports: [output("entries", "Entries", "json")],
  },
  debugLog: {
    type: "debugLog",
    label: "Debug Log",
    labelI18n: { zh: "调试日志", en: "Debug Log" },
    category: "core",
    description: "Inspects JSON-like data while designing or debugging a workflow.",
    descriptionI18n: {
      zh: "在设计或调试工作流时检查 JSON 类数据。",
      en: "Inspects JSON-like data while designing or debugging a workflow.",
    },
    color: "#64748b",
    preview: "Shows incoming data as formatted debug output.",
    previewI18n: {
      zh: "将输入数据格式化为调试输出。",
      en: "Shows incoming data as formatted debug output.",
    },
    ports: [input("data", "Data", "json", false), output("debug", "Debug", "debug_info")],
  },
  promptTemplate: {
    type: "promptTemplate",
    label: "Prompt Template",
    labelI18n: { zh: "提示词模板", en: "Prompt Template" },
    category: "core",
    description: "Combines source text with a reusable prompt template.",
    descriptionI18n: {
      zh: "将源文本与可复用的提示词模板组合。",
      en: "Combines source text with a reusable prompt template.",
    },
    color: "#4f46e5",
    preview: "Text source + template -> context prompt.",
    previewI18n: {
      zh: "文本源 + 模板 → 上下文提示词。",
      en: "Text source + template -> context prompt.",
    },
    defaultConfig: { template: "请基于以下内容继续处理：" },
    configFields: [{ key: "template", label: { zh: "文本", en: "Text" }, kind: "textarea" }],
    ports: [input("source", "Source", "text"), output("prompt", "Prompt", "context")],
  },
  mockSearch: {
    type: "mockSearch",
    label: "Mock Search",
    labelI18n: { zh: "模拟检索", en: "Mock Search" },
    category: "core",
    description: "Local fake search node for offline workflow tests.",
    descriptionI18n: {
      zh: "本地模拟检索节点，用于离线工作流测试。",
      en: "Local fake search node for offline workflow tests.",
    },
    color: "#0891b2",
    preview: "Query -> simulated search_result.",
    previewI18n: {
      zh: "查询 → 模拟 search_result。",
      en: "Query -> simulated search_result.",
    },
    defaultConfig: { query: "", limit: 4 },
    configFields: [
      { key: "query", label: { zh: "检索词", en: "Query" }, kind: "text" },
      { key: "limit", label: { zh: "返回数量", en: "Limit" }, kind: "number", min: 1, max: 12 },
    ],
    ports: [input("query", "Query", "user_input"), output("results", "Results", "search_result")],
  },
  worldbookSearch: {
    type: "worldbookSearch",
    label: "Worldbook Search",
    labelI18n: { zh: "世界书检索", en: "Worldbook Search" },
    category: "knowledge",
    description: "Searches the local worldbook library and returns context evidence.",
    descriptionI18n: {
      zh: "检索本地世界书库并返回上下文证据。",
      en: "Searches the local worldbook library and returns context evidence.",
    },
    color: "#7c3aed",
    preview: "User query -> ranked worldbook search_result.",
    previewI18n: {
      zh: "用户查询 → 排序后的世界书 search_result。",
      en: "User query -> ranked worldbook search_result.",
    },
    panelLayout: "worldbook",
    defaultConfig: { query: "", limit: 4 },
    configFields: [
      { key: "query", label: { zh: "检索词", en: "Query" }, kind: "text" },
      { key: "limit", label: { zh: "返回数量", en: "Limit" }, kind: "number", min: 1, max: 12 },
    ],
    ports: [input("query", "Query", "user_input"), output("results", "Results", "search_result")],
  },
  memoryRecall: {
    type: "memoryRecall",
    label: "Memory Recall",
    labelI18n: { zh: "记忆召回", en: "Memory Recall" },
    category: "knowledge",
    description:
      "Searches the long-term memory library and returns relevant player, relationship, and prior-scene context.",
    descriptionI18n: {
      zh: "检索长期记忆库并返回相关玩家、关系和历史场景上下文。",
      en: "Searches the long-term memory library and returns relevant player, relationship, and prior-scene context.",
    },
    color: "#0e7490",
    preview: "Player turn -> ranked memory context.",
    previewI18n: {
      zh: "玩家回合 → 排序后的记忆上下文。",
      en: "Player turn -> ranked memory context.",
    },
    panelLayout: "memory",
    defaultConfig: { query: "", limit: 4, scope: "玩家偏好、角色关系、历史互动" },
    configFields: [
      { key: "query", label: { zh: "检索词", en: "Query" }, kind: "text" },
      { key: "limit", label: { zh: "返回数量", en: "Limit" }, kind: "number", min: 1, max: 12 },
      { key: "scope", label: { zh: "范围", en: "Scope" }, kind: "text" },
    ],
    ports: [input("query", "Query", "user_input"), output("memories", "Memories", "context")],
  },
  musicSchoolIntake: {
    type: "musicSchoolIntake",
    label: "Music School Intake",
    labelI18n: { zh: "琴行咨询", en: "Music School Intake" },
    category: "external",
    description: "Normalizes piano-school leads, student goals, age, and preferred schedule.",
    descriptionI18n: {
      zh: "规范化琴行线索、学生目标、年龄和偏好时间。",
      en: "Normalizes piano-school leads, student goals, age, and preferred schedule.",
    },
    color: "#be123c",
    preview: "Lead text -> business_data profile for sales or lesson planning agents.",
    previewI18n: {
      zh: "线索文本 → 供销售或课程规划 agent 使用的 business_data。",
      en: "Lead text -> business_data profile for sales or lesson planning agents.",
    },
    defaultConfig: { source: "琴行咨询", studentLevel: "初学" },
    configFields: [
      { key: "source", label: { zh: "来源", en: "Source" }, kind: "text" },
      { key: "studentLevel", label: { zh: "学生水平", en: "Student level" }, kind: "text" },
    ],
    ports: [input("lead", "Lead", "user_input"), output("profile", "Profile", "business_data")],
  },
  lessonPlanGenerator: {
    type: "lessonPlanGenerator",
    label: "Lesson Plan Generator",
    labelI18n: { zh: "琴行课纲", en: "Lesson Plan" },
    category: "external",
    description: "Creates a structured lesson plan from student profile and teaching context.",
    descriptionI18n: {
      zh: "从学生档案和教学上下文创建结构化课纲。",
      en: "Creates a structured lesson plan from student profile and teaching context.",
    },
    color: "#c2410c",
    preview: "Student profile + context -> lesson draft.",
    previewI18n: {
      zh: "学生档案 + 上下文 → 课纲草稿。",
      en: "Student profile + context -> lesson draft.",
    },
    defaultConfig: { weeks: 4, style: "钢琴启蒙" },
    configFields: [
      { key: "weeks", label: { zh: "周数", en: "Weeks" }, kind: "number", min: 1, max: 52 },
      { key: "style", label: { zh: "风格", en: "Style" }, kind: "text" },
    ],
    ports: [
      input("student", "Student", "business_data"),
      input("context", "Context", "context", false),
      output("plan", "Plan", "draft"),
    ],
  },
  superpowersPlan: {
    type: "superpowersPlan",
    label: "Superpowers Plan",
    labelI18n: { zh: "Superpowers 计划", en: "Superpowers Plan" },
    category: "external",
    description: "Represents an external Superpowers planning or execution discipline node.",
    descriptionI18n: {
      zh: "表示一个外部 Superpowers 规划或执行规程节点。",
      en: "Represents an external Superpowers planning or execution discipline node.",
    },
    color: "#0d9488",
    preview: "Goal context -> implementation plan.",
    previewI18n: {
      zh: "目标上下文 → 实施计划。",
      en: "Goal context -> implementation plan.",
    },
    defaultConfig: { mode: "planning" },
    configFields: [{ key: "mode", label: { zh: "模式", en: "Mode" }, kind: "text" }],
    ports: [input("goal", "Goal", "context"), output("plan", "Plan", "analysis")],
  },
  webAppSpec: {
    type: "webAppSpec",
    label: "Web App Spec",
    labelI18n: { zh: "Web App 规格", en: "Web App Spec" },
    category: "external",
    description: "Turns product intent into a frontend implementation specification.",
    descriptionI18n: {
      zh: "将产品意图转化为前端实现规格说明。",
      en: "Turns product intent into a frontend implementation specification.",
    },
    color: "#16a34a",
    preview: "Product context -> UI spec for Build Web Apps workflows.",
    previewI18n: {
      zh: "产品上下文 → 用于 Build Web Apps 工作流的 UI 规格。",
      en: "Product context -> UI spec for Build Web Apps workflows.",
    },
    defaultConfig: { surface: "dashboard" },
    configFields: [{ key: "surface", label: { zh: "界面类型", en: "Surface" }, kind: "text" }],
    ports: [input("brief", "Brief", "context"), output("spec", "Spec", "ui_spec")],
  },
  hyperframesComposition: {
    type: "hyperframesComposition",
    label: "HyperFrames Composition",
    labelI18n: { zh: "HyperFrames 合成", en: "HyperFrames Composition" },
    category: "external",
    description: "Models a HyperFrames HTML video composition with timing and media assets.",
    descriptionI18n: {
      zh: "使用时间轴和媒体资产对 HyperFrames HTML 视频合成进行建模。",
      en: "Models a HyperFrames HTML video composition with timing and media assets.",
    },
    color: "#db2777",
    preview: "Script + media asset -> video composition.",
    previewI18n: {
      zh: "脚本 + 媒体资产 → 视频合成。",
      en: "Script + media asset -> video composition.",
    },
    defaultConfig: { aspectRatio: "16:9", duration: 8 },
    configFields: [
      { key: "aspectRatio", label: { zh: "画幅", en: "Aspect ratio" }, kind: "text" },
      { key: "duration", label: { zh: "时长", en: "Duration" }, kind: "number", min: 1, max: 600 },
    ],
    ports: [
      input("script", "Script", "draft"),
      input("asset", "Asset", "media_asset", false),
      output("composition", "Composition", "video_composition"),
    ],
  },
  openAiToolAdapter: {
    type: "openAiToolAdapter",
    label: "OpenAI Tool Adapter",
    labelI18n: { zh: "OpenAI 工具适配", en: "OpenAI Tool Adapter" },
    category: "external",
    description: "Describes an OpenAI tool or agent adapter as an external workflow capability.",
    descriptionI18n: {
      zh: "将 OpenAI 工具或 agent 适配器描述为外部工作流能力。",
      en: "Describes an OpenAI tool or agent adapter as an external workflow capability.",
    },
    color: "#111827",
    preview: "Tool spec + context -> agent_tool definition.",
    previewI18n: {
      zh: "工具规格 + 上下文 → agent_tool 定义。",
      en: "Tool spec + context -> agent_tool definition.",
    },
    defaultConfig: { provider: "openai", toolName: "custom_tool" },
    configFields: [
      { key: "provider", label: { zh: "提供方", en: "Provider" }, kind: "text" },
      { key: "toolName", label: { zh: "工具名", en: "Tool name" }, kind: "text" },
    ],
    ports: [input("spec", "Spec", "ui_spec"), output("tool", "Tool", "agent_tool")],
  },
  preview: {
    type: "preview",
    label: "Preview",
    labelI18n: { zh: "通用预览", en: "Preview" },
    category: "utility",
    description: "Universal data inspector — connect any output to preview its contents.",
    descriptionI18n: {
      zh: "通用数据检查器 — 连接任意输出来预览其内容。",
      en: "Universal data inspector — connect any output to preview its contents.",
    },
    color: "#0d9488",
    preview: "Accepts any data type and renders text, JSON, or a structured summary.",
    previewI18n: {
      zh: "接受任意数据类型，渲染为文本、JSON 或结构化摘要。",
      en: "Accepts any data type and renders text, JSON, or a structured summary.",
    },
    quickAdd: true,
    panelLayout: "preview",
    defaultConfig: { displayMode: "auto" },
    configFields: [
      {
        key: "displayMode",
        label: { zh: "显示模式", en: "Display mode" },
        kind: "select",
        options: ["auto", "text", "json", "summary"],
      },
    ],
    ports: [input("data", "Data", "json", false), output("preview", "Preview", "debug_info")],
  },
  assetPreview: {
    type: "assetPreview",
    label: "Asset Preview",
    labelI18n: { zh: "预览节点", en: "Asset Preview" },
    category: "utility",
    description:
      "Preview-only node for media, UI specs, tool specs, and video composition payloads.",
    descriptionI18n: {
      zh: "仅用于预览媒体、UI 规格、工具规格和视频合成数据的节点。",
      en: "Preview-only node for media, UI specs, tool specs, and video composition payloads.",
    },
    color: "#9333ea",
    preview: "Accepts external-node outputs and exposes debug_info without mutating workflow data.",
    previewI18n: {
      zh: "接受外部节点输出并以 debug_info 形式展示，不改写工作流数据。",
      en: "Accepts external-node outputs and exposes debug_info without mutating workflow data.",
    },
    quickAdd: true,
    ports: [input("data", "Data", "json", false), output("preview", "Preview", "debug_info")],
  },

  // ============ P-1: Wire-Native Nodes ============

  playerInput: {
    type: "playerInput",
    label: "Player Input",
    labelI18n: { zh: "玩家输入", en: "Player Input" },
    category: "core",
    description: "Accepts player text input for wire-native workflows.",
    descriptionI18n: {
      zh: "接受玩家文本输入，用于 Wire-native 工作流。",
      en: "Accepts player text input for wire-native workflows.",
    },
    color: "#0f766e",
    preview: "Emits player text on a Text wire.",
    previewI18n: { zh: "通过 Text 线输出玩家文本。", en: "Emits player text on a Text wire." },
    defaultConfig: { text: "" },
    configFields: [{ key: "text", label: { zh: "文本", en: "Text" }, kind: "textarea" }],
    ports: [wireOutput("text", "Text", "text")],
  },

  markdownSource: {
    type: "markdownSource",
    label: "Markdown Source",
    labelI18n: { zh: "Markdown 源", en: "Markdown Source" },
    category: "core",
    description:
      "Provides Markdown content (prompts, instructions, context) for wire-native workflows.",
    descriptionI18n: {
      zh: "为 Wire-native 工作流提供 Markdown 内容（提示词、指令、上下文）。",
      en: "Provides Markdown content (prompts, instructions, context) for wire-native workflows.",
    },
    color: "#7c3aed",
    preview: "Emits Markdown on a Markdown wire.",
    previewI18n: {
      zh: "通过 Markdown 线输出 Markdown 内容。",
      en: "Emits Markdown on a Markdown wire.",
    },
    defaultConfig: { content: "" },
    configFields: [{ key: "content", label: { zh: "内容", en: "Content" }, kind: "textarea" }],
    ports: [wireOutput("markdown", "Markdown", "markdown")],
  },

  jsonSource: {
    type: "jsonSource",
    label: "JSON Source",
    labelI18n: { zh: "JSON 源", en: "JSON Source" },
    category: "core",
    description: "Provides structured JSON data for wire-native workflows.",
    descriptionI18n: {
      zh: "为 Wire-native 工作流提供结构化 JSON 数据。",
      en: "Provides structured JSON data for wire-native workflows.",
    },
    color: "#475569",
    preview: "Emits JSON on a JSON wire.",
    previewI18n: { zh: "通过 JSON 线输出 JSON 数据。", en: "Emits JSON on a JSON wire." },
    defaultConfig: { data: "{}" },
    configFields: [{ key: "data", label: { zh: "数据", en: "Data" }, kind: "json" }],
    ports: [wireOutput("json", "JSON", "json")],
  },

  genericAgent: {
    type: "genericAgent",
    label: "Generic Agent",
    labelI18n: { zh: "通用 Agent", en: "Generic Agent" },
    category: "core",
    description:
      "Fully configurable LLM agent with 4 static input slots. Accepts Text, Markdown, and JSON inputs.",
    descriptionI18n: {
      zh: "完全可配置的 LLM Agent，具有 4 个静态输入槽。接受 Text、Markdown 和 JSON 输入。",
      en: "Fully configurable LLM agent with 4 static input slots. Accepts Text, Markdown, and JSON inputs.",
    },
    color: "#2563eb",
    quickAdd: true,
    panelLayout: "agent",
    defaultConfig: {
      systemPrompt: "You are a helpful assistant.",
      modelId: "",
      temperature: 0.7,
      maxTokens: 2048,
    },
    configFields: [
      {
        key: "providerId",
        label: { zh: "Provider", en: "Provider" },
        kind: "text",
        placeholder: { zh: "例如: deepseek", en: "e.g. deepseek" },
        help: {
          zh: "Provider ID，由 Server Provider Registry 管理",
          en: "Provider ID, managed by Server Provider Registry",
        },
      },
      {
        key: "modelId",
        label: { zh: "模型", en: "Model" },
        kind: "text",
        placeholder: { zh: "例如: deepseek-v4-flash", en: "e.g. deepseek-v4-flash" },
        help: {
          zh: "模型 ID，由 Provider Registry 解析",
          en: "Model ID, resolved by Provider Registry",
        },
      },
      { key: "systemPrompt", label: { zh: "系统提示词", en: "System Prompt" }, kind: "textarea" },
      {
        key: "temperature",
        label: { zh: "温度", en: "Temperature" },
        kind: "number",
        min: 0,
        max: 2,
        advanced: true,
      },
      {
        key: "topP",
        label: { zh: "Top P", en: "Top P" },
        kind: "number",
        min: 0,
        max: 1,
        advanced: true,
      },
      {
        key: "maxTokens",
        label: { zh: "最大 Token", en: "Max Tokens" },
        kind: "number",
        min: 1,
        max: 128000,
        advanced: true,
      },
      {
        key: "timeoutMs",
        label: { zh: "超时(ms)", en: "Timeout (ms)" },
        kind: "number",
        min: 1000,
        max: 300000,
        advanced: true,
      },
      {
        key: "responseFormat",
        label: { zh: "响应格式", en: "Response Format" },
        kind: "select",
        options: ["text", "json_object"],
        advanced: true,
      },
      {
        key: "jsonRendererEnabled",
        label: { zh: "JSON 渲染器", en: "JSON Renderer" },
        kind: "boolean",
        help: {
          zh: "将 data:JSON 输入转为 Markdown 供模型阅读",
          en: "Render data:JSON input to Markdown for the model",
        },
      },
    ],
    ports: [
      wireInput("userInput", "User Input", "text", { required: false }),
      wireInput("instruction", "Instruction", "markdown", { required: false }),
      wireInput("context", "Context", "markdown", { required: false }),
      wireInput("data", "Data", "json", { required: false }),
      wireOutput("result", "Result", "text"),
    ],
  },

  specializedAgent: {
    type: "specializedAgent",
    label: "Specialized Agent",
    labelI18n: { zh: "专用 Agent", en: "Specialized Agent" },
    category: "core",
    description:
      "Profile-driven agent with pre-configured capabilities. Select a profile to load specialized prompts and defaults.",
    descriptionI18n: {
      zh: "基于 Profile 的专用 Agent，具有预配置能力。选择 Profile 以加载专用提示词和默认值。",
      en: "Profile-driven agent with pre-configured capabilities. Select a profile to load specialized prompts and defaults.",
    },
    color: "#7c3aed",
    quickAdd: true,
    panelLayout: "agent",
    defaultConfig: {
      profileId: "",
    },
    configFields: [
      {
        key: "profileId",
        label: { zh: "Profile", en: "Profile" },
        kind: "text",
        required: true,
        placeholder: { zh: "例如: rp-writer", en: "e.g. rp-writer" },
        help: {
          zh: "Profile ID，从 Profile Registry 解析。不在下拉列表中硬编码。",
          en: "Profile ID, resolved from Profile Registry. Not hardcoded in dropdown.",
        },
      },
      {
        key: "providerId",
        label: { zh: "Provider", en: "Provider" },
        kind: "text",
        placeholder: { zh: "覆盖 Profile 默认 Provider", en: "Override profile default provider" },
      },
      {
        key: "modelId",
        label: { zh: "模型", en: "Model" },
        kind: "text",
        placeholder: { zh: "覆盖 Profile 默认模型", en: "Override profile default model" },
      },
      {
        key: "temperature",
        label: { zh: "温度", en: "Temperature" },
        kind: "number",
        min: 0,
        max: 2,
        advanced: true,
        help: { zh: "覆盖 Profile 默认值", en: "Override profile default" },
      },
      {
        key: "maxTokens",
        label: { zh: "最大 Token", en: "Max Tokens" },
        kind: "number",
        min: 1,
        max: 128000,
        advanced: true,
      },
    ],
    ports: [
      wireInput("userInput", "User Input", "text", { required: false }),
      wireInput("instruction", "Instruction", "markdown", { required: false }),
      wireInput("context", "Context", "markdown", { required: false }),
      wireInput("data", "Data", "json", { required: false }),
      wireOutput("result", "Result", "text"),
    ],
  },

  inspectOutput: {
    type: "inspectOutput",
    label: "Inspect Output",
    labelI18n: { zh: "检查输出", en: "Inspect Output" },
    category: "utility",
    description:
      "Displays intermediate data for debugging. Three optional input ports for JSON, Markdown, and Text.",
    descriptionI18n: {
      zh: "显示中间数据用于调试。三个可选输入端口，分别接受 JSON、Markdown 和 Text。",
      en: "Displays intermediate data for debugging. Three optional input ports for JSON, Markdown, and Text.",
    },
    color: "#64748b",
    panelLayout: "preview",
    defaultConfig: { displayMode: "auto" },
    configFields: [
      {
        key: "displayMode",
        label: { zh: "显示模式", en: "Display Mode" },
        kind: "select",
        options: ["auto", "json", "markdown", "text"],
      },
    ],
    ports: [
      wireInput("jsonInput", "JSON Input", "json", { required: false }),
      wireInput("markdownInput", "Markdown Input", "markdown", { required: false }),
      wireInput("textInput", "Text Input", "text", { required: false }),
    ],
  },

  playerOutput: {
    type: "playerOutput",
    label: "Player Output",
    labelI18n: { zh: "玩家输出", en: "Player Output" },
    category: "core",
    description:
      "Delivers final text output to the player. Only accepts Text wire. Does not expose internal data.",
    descriptionI18n: {
      zh: "向玩家发送最终文本输出。仅接受 Text 线。不暴露内部数据。",
      en: "Delivers final text output to the player. Only accepts Text wire. Does not expose internal data.",
    },
    color: "#b45309",
    panelLayout: "output",
    defaultConfig: { displayLabel: "Output" },
    configFields: [
      {
        key: "displayLabel",
        label: { zh: "显示标签", en: "Display Label" },
        kind: "text",
      },
    ],
    ports: [
      wireInput("text", "Text", "text", { required: true }),
      wireOutput("final", "Final", "text"),
    ],
  },
};

export const validatePortSchemaId = (port: PortDefinition): string | null => {
  // For legacy ports: schemaId only valid on json dataType
  if (isLegacyPort(port)) {
    if (port.schemaId && port.dataType !== "json") {
      return `Port "${port.id}" has schemaId but dataType is "${port.dataType}" (must be "json")`;
    }
    return null;
  }
  // For wire ports: schemaId only valid on json wireType
  if (isWirePort(port)) {
    if (port.schemaId && port.wireType !== "json") {
      return `Port "${port.id}" has schemaId but wireType is "${port.wireType}" (must be "json")`;
    }
    return null;
  }
  return null;
};

export const findPort = (nodeType: string, portId: string, direction?: "input" | "output") => {
  return findPortInCatalog(nodeRegistry, nodeType, portId, direction);
};

export const findPortInCatalog = (
  catalog: NodeCatalog,
  nodeType: string,
  portId: string,
  direction?: "input" | "output",
): PortDefinition | undefined => {
  const definition = catalog[nodeType];
  if (!definition) return undefined;
  const port = definition.ports.find((candidate) => candidate.id === portId);

  if (!port || (direction && port.direction !== direction)) {
    return undefined;
  }

  return port;
};

// ============ Legacy Type Compatibility (unchanged) ============

export const areTypesCompatible = (
  sourceType: DataType,
  targetType: DataType,
  sourceSchemaId?: string,
  targetSchemaId?: string,
): boolean => {
  // schemaId 只能参与 JSON 端口兼容
  if (sourceSchemaId || targetSchemaId) {
    if (sourceType !== "json" || targetType !== "json") {
      return false;
    }

    if (sourceSchemaId && targetSchemaId) {
      return sourceSchemaId === targetSchemaId;
    }

    if (sourceSchemaId && !targetSchemaId) {
      return true;
    }

    // 普通 JSON 或其他类型不能进入带 schemaId 的输入
    return false;
  }

  if (sourceType === targetType) {
    return true;
  }

  if (targetType === "json") {
    return true;
  }

  const compatible = new Set([
    "user_input:text",
    "user_input:json",
    "user_input:context",
    "draft:json",
    "text:context",
    "text:draft",
    "search_result:context",
    "analysis:context",
    "draft:context",
    "draft:text",
    "draft:final_text",
    "json:context",
    "business_data:context",
    "business_data:json",
    "analysis:ui_spec",
    "ui_spec:context",
    "ui_spec:json",
    "ui_spec:agent_tool",
    "draft:video_composition",
    "media_asset:context",
    "media_asset:json",
    "video_composition:json",
    "agent_tool:json",
    "character_profile:context",
    "character_profile:json",
    "scene_state:context",
    "scene_state:json",
    "memory:context",
    "memory:json",
    "analysis:json",
    "text:json",
    "context:json",
    "search_result:json",
    "final_text:json",
    "debug_info:json",
  ]);

  return compatible.has(`${sourceType}:${targetType}`);
};

// ============ Wire Type Compatibility (P-1) ============

/**
 * Check strict WireType compatibility.
 * Only same-type connections are allowed. Cross-type is rejected.
 */
export function areWireTypesCompatible(
  sourceWireType: WireType,
  targetWireType: WireType,
): boolean {
  return sourceWireType === targetWireType;
}

/**
 * Check JSON schema compatibility between two ports.
 *
 * Returns:
 * - "compatible": same schemaId, or target has no schemaId
 * - "compatible-with-runtime-validation": source has no schemaId, target has schemaId (runtime check needed)
 * - "incompatible": different schemaIds
 */
export function checkSchemaCompatibility(
  sourceSchemaId: string | undefined,
  targetSchemaId: string | undefined,
): SchemaCompatResult {
  if (sourceSchemaId && targetSchemaId) {
    return sourceSchemaId === targetSchemaId ? "compatible" : "incompatible";
  }
  if (!targetSchemaId) {
    return "compatible";
  }
  // sourceSchemaId is undefined, target has schemaId
  return "compatible-with-runtime-validation";
}

// Runtime schema validator registry — injected by server composition root
let _runtimeSchemaValidator: ((schemaId: string, data: unknown) => boolean) | undefined;

/** Inject a runtime schema validator. Called by server composition root. */
export function setRuntimeSchemaValidator(
  validator: (schemaId: string, data: unknown) => boolean,
): void {
  _runtimeSchemaValidator = validator;
}

/** Get the injected runtime schema validator. */
export function getRuntimeSchemaValidator():
  | ((schemaId: string, data: unknown) => boolean)
  | undefined {
  return _runtimeSchemaValidator;
}
