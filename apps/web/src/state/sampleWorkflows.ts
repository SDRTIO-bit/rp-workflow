import type { WorkflowDefinition } from "@awp/workflow-core";

export const sampleSkills = [
  { id: "world_context", label: "World Context", content: "Extract stable setting facts." },
  { id: "prose", label: "Prose Writing", content: "Write vivid, restrained prose." },
  { id: "consistency", label: "Consistency", content: "Check contradictions and missing facts." },
  {
    id: "rp_persona",
    label: "RP Persona",
    content:
      "Stay in character. Preserve the character card's persona, voice, relationship stance, secrets, and boundaries.",
  },
  {
    id: "rp_player_agency",
    label: "RP Player Agency",
    content:
      "Never decide the player's action, emotion, speech, or intention. Describe NPCs and environment, then leave a clear hook.",
  },
  {
    id: "rp_continuity",
    label: "RP Continuity",
    content:
      "Use worldbook facts and long-term memory as canon. Avoid contradictions, sudden relationship jumps, and unexplained reveals.",
  },
  {
    id: "rp_slow_burn",
    label: "RP Slow Burn",
    content:
      "For mystery roleplay, reveal one meaningful detail per turn. Keep tension, atmosphere, and unanswered questions alive.",
  },
];

export const samplePlugins = [
  {
    id: "mock_search",
    label: "Mock Search",
    description: "Read simulated worldbook entries.",
    tools: [],
  },
  {
    id: "memory_read",
    label: "Memory Read",
    description: "Read simulated long-term memory.",
    tools: [],
  },
  {
    id: "worldbook_read",
    label: "Worldbook Read",
    description:
      "Provides retrieved worldbook entries as canon setting, character, location, and rule context.",
    tools: [],
  },
  {
    id: "rp_memory_read",
    label: "RP Memory Read",
    description:
      "Provides long-term roleplay memory such as player preferences, relationship state, promises, and unresolved hooks.",
    tools: [],
  },
];

export type WorkflowTemplate = {
  id: string;
  label: { zh: string; en: string };
  description: { zh: string; en: string };
  workflow: WorkflowDefinition;
};

export const emptyWorkflow: WorkflowDefinition = {
  id: "empty_workflow",
  name: "Empty workflow",
  version: 1,
  nodes: [],
  edges: [],
};

export const roleplayWorkflow: WorkflowDefinition = {
  id: "rp_memory_worldbook_validation",
  name: "RP with worldbook and memory",
  version: 1,
  nodes: [
    {
      id: "player_turn",
      type: "userInput",
      position: { x: 30, y: 250 },
      config: { text: "我把伞收起来，低声问她：这段广播，是谁录下来的？" },
    },
    {
      id: "rp_character",
      type: "rpCharacterCard",
      position: { x: 320, y: 40 },
      config: {
        name: "雾岛澪",
        persona: "冷静克制的旧车站管理员，知道广播异常的来历。",
        voice: "短句、含蓄、偶尔用反问试探玩家。",
        boundaries: "不替玩家决定行动；不越过已设定关系边界。",
      },
    },
    {
      id: "worldbook_lookup",
      type: "worldbookSearch",
      position: { x: 320, y: 245 },
      config: { query: "", limit: 5 },
    },
    {
      id: "memory_lookup",
      type: "memoryRecall",
      position: { x: 320, y: 430 },
      config: { query: "", limit: 4, scope: "玩家偏好、角色关系、过去互动、未解决承诺" },
    },
    {
      id: "rp_scene",
      type: "rpSceneState",
      position: { x: 640, y: 210 },
      config: {
        location: "废弃车站候车厅",
        mood: "雨夜、旧广播、轻微超自然",
        stakes: "弄清广播为何还在播放，同时避免惊动站内的未知存在。",
      },
    },
    {
      id: "rp_director",
      type: "rpDialogueDirector",
      position: { x: 960, y: 185 },
      config: {
        style: "沉浸式中文 RP",
        replyRules:
          "必须结合世界书和记忆库；只扮演 NPC 和环境；保留玩家行动选择；每轮推进一个清晰变化。",
        skills: ["rp_persona", "rp_player_agency", "rp_continuity", "rp_slow_burn"],
        plugins: ["worldbook_read", "rp_memory_read"],
      },
    },
    {
      id: "rp_check",
      type: "rpContinuityCheck",
      position: { x: 1270, y: 55 },
      config: { strictness: "medium", skills: ["rp_player_agency", "rp_continuity"] },
    },
    {
      id: "rp_output",
      type: "textOutput",
      position: { x: 1280, y: 300 },
      config: {},
    },
  ],
  edges: [
    {
      id: "rp_e1",
      source: "player_turn",
      sourcePort: "text",
      target: "rp_character",
      targetPort: "seed",
    },
    {
      id: "rp_e2",
      source: "player_turn",
      sourcePort: "text",
      target: "worldbook_lookup",
      targetPort: "query",
    },
    {
      id: "rp_e3",
      source: "player_turn",
      sourcePort: "text",
      target: "memory_lookup",
      targetPort: "query",
    },
    {
      id: "rp_e4",
      source: "player_turn",
      sourcePort: "text",
      target: "rp_scene",
      targetPort: "setup",
    },
    {
      id: "rp_e5",
      source: "worldbook_lookup",
      sourcePort: "results",
      target: "rp_scene",
      targetPort: "lore",
    },
    {
      id: "rp_e6",
      source: "rp_character",
      sourcePort: "profile",
      target: "rp_director",
      targetPort: "character",
    },
    {
      id: "rp_e7",
      source: "rp_scene",
      sourcePort: "state",
      target: "rp_director",
      targetPort: "scene",
    },
    {
      id: "rp_e8",
      source: "player_turn",
      sourcePort: "text",
      target: "rp_director",
      targetPort: "player",
    },
    {
      id: "rp_e9",
      source: "memory_lookup",
      sourcePort: "memories",
      target: "rp_director",
      targetPort: "memory",
    },
    {
      id: "rp_e10",
      source: "rp_director",
      sourcePort: "reply",
      target: "rp_check",
      targetPort: "draft",
    },
    {
      id: "rp_e11",
      source: "rp_director",
      sourcePort: "reply",
      target: "rp_output",
      targetPort: "text",
    },
  ],
};

export const parallelWorkflow: WorkflowDefinition = {
  id: "parallel_agents",
  name: "Parallel multi-Agent draft",
  version: 1,
  nodes: [
    {
      id: "input",
      type: "userInput",
      position: { x: 20, y: 160 },
      config: { text: "主角在雨夜回到废弃车站，发现旧广播还在播放。" },
    },
    {
      id: "world_agent",
      type: "agent",
      position: { x: 330, y: 70 },
      config: {
        model: "deepseek-v4-flash",
        systemPrompt: "分析场景中的世界观线索，输出可复用上下文。",
        skills: ["world_context"],
        plugins: ["mock_search"],
        outputType: "analysis",
      },
    },
    {
      id: "character_agent",
      type: "agent",
      position: { x: 330, y: 260 },
      config: {
        model: "deepseek-v4-flash",
        systemPrompt: "分析角色当前心理和行动动机。",
        skills: ["consistency"],
        plugins: ["memory_read"],
        outputType: "analysis",
      },
    },
    {
      id: "writer_agent",
      type: "agent",
      position: { x: 680, y: 165 },
      config: {
        model: "deepseek-v4-flash",
        systemPrompt: "整合上游信息，生成一段正文草稿。",
        skills: ["prose"],
        plugins: [],
        outputType: "draft",
      },
    },
    {
      id: "output",
      type: "textOutput",
      position: { x: 1030, y: 170 },
      config: {},
    },
  ],
  edges: [
    { id: "e1", source: "input", sourcePort: "text", target: "world_agent", targetPort: "context" },
    {
      id: "e2",
      source: "input",
      sourcePort: "text",
      target: "character_agent",
      targetPort: "context",
    },
    {
      id: "e3",
      source: "world_agent",
      sourcePort: "result",
      target: "writer_agent",
      targetPort: "context",
    },
    {
      id: "e4",
      source: "character_agent",
      sourcePort: "result",
      target: "writer_agent",
      targetPort: "instruction",
    },
    {
      id: "e5",
      source: "writer_agent",
      sourcePort: "result",
      target: "output",
      targetPort: "text",
    },
  ],
};

export const rpFullPipeline: WorkflowTemplate = {
  id: "rp_full_pipeline",
  label: { zh: "RP 完整流水线", en: "RP Full Pipeline" },
  description: {
    zh: "完整 RP 工作流：输入解析 → 上下文组装 → 对话导演 → 连续性检查 → 记忆写入",
    en: "Full RP workflow: input parsing → context assembly → dialogue director → continuity check → memory write",
  },
  workflow: {
    id: "rp_full_pipeline",
    name: "RP 完整流水线",
    version: 1,
    nodes: [
      { id: "user_1", type: "userInput", position: { x: 100, y: 100 }, config: { text: "" } },
      { id: "parser_1", type: "rpInputParser", position: { x: 360, y: 100 }, config: { language: "zh" } },
      { id: "worldbook_1", type: "worldbookSearch", position: { x: 620, y: 20 }, config: { limit: 4 } },
      { id: "memory_1", type: "memoryRecall", position: { x: 620, y: 180 }, config: { limit: 4 } },
      { id: "char_1", type: "rpCharacterCard", position: { x: 360, y: 280 }, config: {} },
      { id: "scene_1", type: "rpSceneState", position: { x: 100, y: 280 }, config: {} },
      { id: "assembler_1", type: "rpContextAssembler", position: { x: 880, y: 100 }, config: {} },
      { id: "director_1", type: "rpDialogueDirector", position: { x: 1140, y: 100 }, config: {} },
      { id: "check_1", type: "rpContinuityCheck", position: { x: 1400, y: 30 }, config: { strictness: "medium" } },
      { id: "output_1", type: "textOutput", position: { x: 1660, y: 100 }, config: {} },
      { id: "memwrite_1", type: "rpMemoryWrite", position: { x: 1400, y: 230 }, config: { maxCandidates: 5 } },
    ],
    edges: [
      { id: "e1", source: "user_1", sourcePort: "text", target: "parser_1", targetPort: "text" },
      { id: "e2", source: "user_1", sourcePort: "text", target: "worldbook_1", targetPort: "query" },
      { id: "e3", source: "user_1", sourcePort: "text", target: "memory_1", targetPort: "query" },
      { id: "e4", source: "parser_1", sourcePort: "parsed", target: "assembler_1", targetPort: "parsed" },
      { id: "e5", source: "char_1", sourcePort: "profile", target: "assembler_1", targetPort: "character" },
      { id: "e6", source: "scene_1", sourcePort: "state", target: "assembler_1", targetPort: "scene" },
      { id: "e7", source: "worldbook_1", sourcePort: "results", target: "assembler_1", targetPort: "worldbook" },
      { id: "e8", source: "memory_1", sourcePort: "memories", target: "assembler_1", targetPort: "memory" },
      { id: "e9", source: "assembler_1", sourcePort: "context", target: "director_1", targetPort: "memory" },
      { id: "e10", source: "char_1", sourcePort: "profile", target: "director_1", targetPort: "character" },
      { id: "e11", source: "scene_1", sourcePort: "state", target: "director_1", targetPort: "scene" },
      { id: "e12", source: "user_1", sourcePort: "text", target: "director_1", targetPort: "player" },
      { id: "e13", source: "director_1", sourcePort: "reply", target: "check_1", targetPort: "draft" },
      { id: "e14", source: "director_1", sourcePort: "reply", target: "output_1", targetPort: "text" },
      { id: "e15", source: "director_1", sourcePort: "reply", target: "memwrite_1", targetPort: "reply" },
      { id: "e16", source: "check_1", sourcePort: "notes", target: "memwrite_1", targetPort: "notes" },
    ],
  },
};

export const workflowTemplates: WorkflowTemplate[] = [
  {
    id: "rp_memory_worldbook_validation",
    label: { zh: "RP：世界书 + 记忆库", en: "RP: worldbook + memory" },
    description: {
      zh: "读取世界书和长时记忆，根据玩家输入生成角色扮演回复。",
      en: "Reads worldbook and long-term memory, then generates an in-character RP reply.",
    },
    workflow: roleplayWorkflow,
  },
  {
    id: "parallel_agents",
    label: { zh: "多 Agent 并行写作", en: "Parallel multi-agent draft" },
    description: {
      zh: "用两个并行 Agent 分析世界观和角色，再汇总生成正文。",
      en: "Runs two analysis agents in parallel, then merges them into a draft.",
    },
    workflow: parallelWorkflow,
  },
  {
    id: "rp_full_pipeline",
    label: { zh: "RP 完整流水线", en: "RP Full Pipeline" },
    description: {
      zh: "完整 RP 工作流：输入解析 → 上下文组装 → 对话导演 → 连续性检查 → 记忆写入",
      en: "Full RP workflow: input parsing → context assembly → dialogue director → continuity check → memory write",
    },
    workflow: rpFullPipeline.workflow,
  },
];
