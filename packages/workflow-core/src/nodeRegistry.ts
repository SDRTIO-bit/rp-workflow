import type { DataType, NodeCatalog, NodeDefinition, PortDefinition } from "./types";

const input = (id: string, label: string, dataType: DataType, required = true): PortDefinition => ({
  id,
  label,
  dataType,
  direction: "input",
  required,
});

const output = (id: string, label: string, dataType: DataType): PortDefinition => ({
  id,
  label,
  dataType,
  direction: "output",
});

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
    color: "#0f766e",
    preview: "Accepts free text and emits user_input for downstream nodes.",
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
    color: "#2563eb",
    preview: "Context + optional instruction -> draft result.",
    quickAdd: true,
    defaultConfig: {
      model: "deepseek-v4-flash",
      systemPrompt: "根据上游信息完成当前 Agent 任务。",
      skills: [],
      plugins: [],
      outputType: "draft",
    },
    configFields: [
      {
        key: "model",
        label: { zh: "模型", en: "Model" },
        kind: "select",
        options: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-reasoner", "mock-pro"],
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
    label: "Text Output",
    labelI18n: { zh: "正文输出", en: "Text Output" },
    category: "core",
    description: "Final text sink used to collect the workflow result.",
    color: "#b45309",
    preview: "Receives draft and emits final_text.",
    ports: [input("text", "Text", "draft"), output("final", "Final", "final_text")],
  },
  debugLog: {
    type: "debugLog",
    label: "Debug Log",
    labelI18n: { zh: "调试日志", en: "Debug Log" },
    category: "core",
    description: "Inspects JSON-like data while designing or debugging a workflow.",
    color: "#64748b",
    preview: "Shows incoming data as formatted debug output.",
    ports: [input("data", "Data", "json", false), output("debug", "Debug", "debug_info")],
  },
  promptTemplate: {
    type: "promptTemplate",
    label: "Prompt Template",
    labelI18n: { zh: "提示词模板", en: "Prompt Template" },
    category: "core",
    description: "Combines source text with a reusable prompt template.",
    color: "#4f46e5",
    preview: "Text source + template -> context prompt.",
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
    color: "#0891b2",
    preview: "Query -> simulated search_result.",
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
    color: "#7c3aed",
    preview: "User query -> ranked worldbook search_result.",
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
    color: "#0e7490",
    preview: "Player turn -> ranked memory context.",
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
    color: "#be123c",
    preview: "Lead text -> business_data profile for sales or lesson planning agents.",
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
    color: "#c2410c",
    preview: "Student profile + context -> lesson draft.",
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
    color: "#0d9488",
    preview: "Goal context -> implementation plan.",
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
    color: "#16a34a",
    preview: "Product context -> UI spec for Build Web Apps workflows.",
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
    color: "#db2777",
    preview: "Script + media asset -> video composition.",
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
    color: "#111827",
    preview: "Tool spec + context -> agent_tool definition.",
    defaultConfig: { provider: "openai", toolName: "custom_tool" },
    configFields: [
      { key: "provider", label: { zh: "提供方", en: "Provider" }, kind: "text" },
      { key: "toolName", label: { zh: "工具名", en: "Tool name" }, kind: "text" },
    ],
    ports: [input("spec", "Spec", "ui_spec"), output("tool", "Tool", "agent_tool")],
  },
  assetPreview: {
    type: "assetPreview",
    label: "Asset Preview",
    labelI18n: { zh: "预览节点", en: "Asset Preview" },
    category: "utility",
    description:
      "Preview-only node for media, UI specs, tool specs, and video composition payloads.",
    color: "#9333ea",
    preview: "Accepts external-node outputs and exposes debug_info without mutating workflow data.",
    quickAdd: true,
    ports: [input("data", "Data", "json", false), output("preview", "Preview", "debug_info")],
  },
  rpCharacterCard: {
    type: "rpCharacterCard",
    label: "RP Character Card",
    labelI18n: { zh: "RP 角色卡", en: "RP Character Card" },
    category: "roleplay",
    description:
      "Builds a stable roleplay character profile with persona, voice, boundaries, and secrets.",
    color: "#a21caf",
    preview: "Character seed -> character_profile.",
    defaultConfig: {
      name: "雾岛澪",
      persona: "冷静克制的旧车站管理员，知道广播异常的来历。",
      voice: "短句、含蓄、偶尔用反问试探玩家。",
      boundaries: "不替玩家决定行动；不越过已设定关系边界。",
    },
    configFields: [
      { key: "name", label: { zh: "角色名", en: "Name" }, kind: "text" },
      { key: "persona", label: { zh: "人设", en: "Persona" }, kind: "textarea" },
      { key: "voice", label: { zh: "口吻", en: "Voice" }, kind: "textarea" },
      { key: "boundaries", label: { zh: "边界", en: "Boundaries" }, kind: "textarea" },
    ],
    ports: [input("seed", "Seed", "user_input"), output("profile", "Profile", "character_profile")],
  },
  rpSceneState: {
    type: "rpSceneState",
    label: "RP Scene State",
    labelI18n: { zh: "RP 场景状态", en: "RP Scene State" },
    category: "roleplay",
    description:
      "Tracks the current location, mood, active stakes, known facts, and unresolved hooks.",
    color: "#7e22ce",
    preview: "Opening setup + optional lore -> scene_state.",
    defaultConfig: {
      location: "废弃车站候车厅",
      mood: "雨夜、旧广播、轻微超自然",
      stakes: "弄清广播为何还在播放，同时避免惊动站内的未知存在。",
    },
    configFields: [
      { key: "location", label: { zh: "地点", en: "Location" }, kind: "text" },
      { key: "mood", label: { zh: "氛围", en: "Mood" }, kind: "text" },
      { key: "stakes", label: { zh: "风险/目标", en: "Stakes" }, kind: "textarea" },
    ],
    ports: [
      input("setup", "Setup", "user_input"),
      input("lore", "Lore", "search_result", false),
      output("state", "State", "scene_state"),
    ],
  },
  rpLoreRecall: {
    type: "rpLoreRecall",
    label: "RP Lore Recall",
    labelI18n: { zh: "RP 设定召回", en: "RP Lore Recall" },
    category: "roleplay",
    description:
      "Retrieves roleplay lore, relationship facts, canon constraints, and unresolved plot hooks.",
    color: "#6d28d9",
    preview: "Player turn -> search_result lore context.",
    defaultConfig: { limit: 5, scope: "角色关系、地点设定、未解决伏笔" },
    configFields: [
      { key: "limit", label: { zh: "返回数量", en: "Limit" }, kind: "number", min: 1, max: 12 },
      { key: "scope", label: { zh: "范围", en: "Scope" }, kind: "text" },
    ],
    ports: [input("query", "Query", "user_input"), output("lore", "Lore", "search_result")],
  },
  rpDialogueDirector: {
    type: "rpDialogueDirector",
    label: "RP Dialogue Director",
    labelI18n: { zh: "RP 对话导演", en: "RP Dialogue Director" },
    category: "roleplay",
    description:
      "Composes the next in-character reply from persona, scene state, player action, and memory.",
    color: "#be185d",
    preview: "Character + scene + player turn -> in-character draft.",
    defaultConfig: {
      style: "沉浸式中文 RP",
      replyRules: "只扮演 NPC 和环境；保留玩家行动选择；每轮推进一个清晰变化。",
    },
    configFields: [
      { key: "style", label: { zh: "风格", en: "Style" }, kind: "text" },
      { key: "replyRules", label: { zh: "回复规则", en: "Reply rules" }, kind: "textarea" },
      { key: "skills", label: { zh: "RP skills", en: "RP skills" }, kind: "tags" },
      { key: "plugins", label: { zh: "RP 插件", en: "RP plugins" }, kind: "tags" },
    ],
    ports: [
      input("character", "Character", "character_profile"),
      input("scene", "Scene", "scene_state"),
      input("player", "Player", "user_input"),
      input("memory", "Memory", "context", false),
      output("reply", "Reply", "draft"),
    ],
  },
  rpContinuityCheck: {
    type: "rpContinuityCheck",
    label: "RP Continuity Check",
    labelI18n: { zh: "RP 连续性检查", en: "RP Continuity Check" },
    category: "roleplay",
    description:
      "Checks whether a draft violates persona, world facts, relationship state, or player agency.",
    color: "#dc2626",
    preview: "RP draft + scene state -> continuity analysis.",
    defaultConfig: { strictness: "medium" },
    configFields: [
      {
        key: "strictness",
        label: { zh: "严格度", en: "Strictness" },
        kind: "select",
        options: ["low", "medium", "high"],
      },
      { key: "skills", label: { zh: "检查 skills", en: "Check skills" }, kind: "tags" },
    ],
    ports: [
      input("draft", "Draft", "draft"),
      input("scene", "Scene", "scene_state", false),
      output("notes", "Notes", "analysis"),
    ],
  },
};

export const findPort = (nodeType: string, portId: string, direction?: "input" | "output") => {
  return findPortInCatalog(nodeRegistry, nodeType, portId, direction);
};

export const findPortInCatalog = (
  catalog: NodeCatalog,
  nodeType: string,
  portId: string,
  direction?: "input" | "output",
) => {
  const definition = catalog[nodeType];
  const port = definition?.ports.find((candidate) => candidate.id === portId);

  if (!port || (direction && port.direction !== direction)) {
    return undefined;
  }

  return port;
};

export const areTypesCompatible = (sourceType: DataType, targetType: DataType): boolean => {
  if (sourceType === targetType) {
    return true;
  }

  const compatible = new Set([
    "user_input:text",
    "user_input:context",
    "text:context",
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
    "analysis:json",
  ]);

  return compatible.has(`${sourceType}:${targetType}`);
};
