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
      id: "parser",
      type: "rpInputParserV1",
      position: { x: 320, y: 250 },
      config: {},
    },
    {
      id: "worldbook_lookup",
      type: "worldbookSearch",
      position: { x: 320, y: 40 },
      config: { query: "", limit: 5 },
    },
    {
      id: "memory_lookup",
      type: "memoryRecall",
      position: { x: 320, y: 450 },
      config: { query: "", limit: 4, scope: "玩家偏好、角色关系、过去互动、未解决承诺" },
    },
    {
      id: "timeline_query",
      type: "rpTimelineQueryV1",
      position: { x: 600, y: 40 },
      config: {},
    },
    {
      id: "lore_retriever",
      type: "rpLoreRetrieverV1",
      position: { x: 600, y: 200 },
      config: {},
    },
    {
      id: "assembler",
      type: "rpContextAssemblerV1",
      position: { x: 880, y: 250 },
      config: {},
    },
    {
      id: "writer",
      type: "rpWriterV1",
      position: { x: 1160, y: 250 },
      config: {},
    },
    {
      id: "rp_output",
      type: "textOutput",
      position: { x: 1440, y: 250 },
      config: {},
    },
  ],
  edges: [
    {
      id: "rp_e1",
      source: "player_turn",
      sourcePort: "text",
      target: "parser",
      targetPort: "rawInput",
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
      source: "parser",
      sourcePort: "parsedInput",
      target: "timeline_query",
      targetPort: "parsedInput",
    },
    {
      id: "rp_e5",
      source: "parser",
      sourcePort: "parsedInput",
      target: "lore_retriever",
      targetPort: "parsedInput",
    },
    {
      id: "rp_e6",
      source: "parser",
      sourcePort: "parsedInput",
      target: "assembler",
      targetPort: "parsedInput",
    },
    {
      id: "rp_e7",
      source: "timeline_query",
      sourcePort: "timelineContext",
      target: "assembler",
      targetPort: "timelineContext",
    },
    {
      id: "rp_e8",
      source: "lore_retriever",
      sourcePort: "loreContext",
      target: "assembler",
      targetPort: "loreContext",
    },
    {
      id: "rp_e9",
      source: "assembler",
      sourcePort: "assembledContext",
      target: "writer",
      targetPort: "assembledContext",
    },
    {
      id: "rp_e10",
      source: "writer",
      sourcePort: "narrative",
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
    zh: "完整 RP 工作流：输入解析 → 时间线/设定检索 → 上下文组装 → 写作 → 章节摘要 → Tracker 更新 → 记忆提交",
    en: "Full RP workflow: input parsing → timeline/lore retrieval → context assembly → writing → chapter summary → tracker update → memory commit",
  },
  workflow: {
    id: "rp_full_pipeline",
    name: "RP 完整流水线",
    version: 1,
    nodes: [
      { id: "user_1", type: "userInput", position: { x: 100, y: 200 }, config: { text: "" } },
      {
        id: "parser_1",
        type: "rpInputParserV1",
        position: { x: 360, y: 200 },
        config: {},
      },
      {
        id: "timeline_1",
        type: "rpTimelineQueryV1",
        position: { x: 620, y: 60 },
        config: {},
      },
      {
        id: "lore_1",
        type: "rpLoreRetrieverV1",
        position: { x: 620, y: 200 },
        config: {},
      },
      { id: "assembler_1", type: "rpContextAssemblerV1", position: { x: 880, y: 200 }, config: {} },
      { id: "writer_1", type: "rpWriterV1", position: { x: 1140, y: 200 }, config: {} },
      {
        id: "summary_1",
        type: "rpChapterSummaryV1",
        position: { x: 1400, y: 100 },
        config: {},
      },
      {
        id: "tracker_1",
        type: "rpTrackerUpdateV1",
        position: { x: 1400, y: 300 },
        config: {},
      },
      { id: "commit_1", type: "rpMemoryCommitV1", position: { x: 1660, y: 200 }, config: {} },
      { id: "output_1", type: "textOutput", position: { x: 1400, y: 450 }, config: {} },
    ],
    edges: [
      {
        id: "e1",
        source: "user_1",
        sourcePort: "text",
        target: "parser_1",
        targetPort: "rawInput",
      },
      {
        id: "e2",
        source: "parser_1",
        sourcePort: "parsedInput",
        target: "timeline_1",
        targetPort: "parsedInput",
      },
      {
        id: "e3",
        source: "parser_1",
        sourcePort: "parsedInput",
        target: "lore_1",
        targetPort: "parsedInput",
      },
      {
        id: "e4",
        source: "parser_1",
        sourcePort: "parsedInput",
        target: "assembler_1",
        targetPort: "parsedInput",
      },
      {
        id: "e5",
        source: "timeline_1",
        sourcePort: "timelineContext",
        target: "assembler_1",
        targetPort: "timelineContext",
      },
      {
        id: "e6",
        source: "lore_1",
        sourcePort: "loreContext",
        target: "assembler_1",
        targetPort: "loreContext",
      },
      {
        id: "e7",
        source: "assembler_1",
        sourcePort: "assembledContext",
        target: "writer_1",
        targetPort: "assembledContext",
      },
      {
        id: "e8",
        source: "writer_1",
        sourcePort: "narrative",
        target: "output_1",
        targetPort: "text",
      },
      {
        id: "e9",
        source: "parser_1",
        sourcePort: "parsedInput",
        target: "summary_1",
        targetPort: "parsedInput",
      },
      {
        id: "e10",
        source: "writer_1",
        sourcePort: "writerOutput",
        target: "summary_1",
        targetPort: "writerOutput",
      },
      {
        id: "e11",
        source: "parser_1",
        sourcePort: "parsedInput",
        target: "tracker_1",
        targetPort: "parsedInput",
      },
      {
        id: "e12",
        source: "summary_1",
        sourcePort: "memoryEvent",
        target: "commit_1",
        targetPort: "memoryEvent",
      },
      {
        id: "e13",
        source: "summary_1",
        sourcePort: "chapterPatch",
        target: "commit_1",
        targetPort: "chapterPatch",
      },
      {
        id: "e14",
        source: "tracker_1",
        sourcePort: "trackerPatch",
        target: "commit_1",
        targetPort: "trackerPatch",
      },
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
