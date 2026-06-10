export const createExecutors = async (context) => ({
  rpInputParser: async ({ node, inputs }) => {
    const text = String(inputs.text ?? "");
    if (!text.trim()) {
      return {
        outputs: {
          parsed: {
            speech: "",
            action: "",
            intent: "",
            emotion: "",
            entities: [],
            triggers: [],
          },
        },
        metadata: { pluginId: "awp.rp-core" },
      };
    }

    const result = await context.executeAgent({
      nodeId: node.id,
      config: {
        systemPrompt: String(node.config.parseRules ?? "分析玩家输入，提取结构化信息。"),
        skills: [],
        plugins: [],
        outputType: "json",
      },
      inputs: { text },
    });

    try {
      const parsed = JSON.parse(result.text);
      return {
        outputs: {
          parsed: {
            speech: String(parsed.speech ?? ""),
            action: String(parsed.action ?? ""),
            intent: String(parsed.intent ?? ""),
            emotion: String(parsed.emotion ?? ""),
            entities: Array.isArray(parsed.entities) ? parsed.entities.map(String) : [],
            triggers: Array.isArray(parsed.triggers) ? parsed.triggers.map(String) : [],
          },
        },
        metadata: { ...result.metadata, pluginId: "awp.rp-core" },
      };
    } catch {
      return {
        outputs: {
          parsed: {
            speech: text,
            action: "",
            intent: "",
            emotion: "",
            entities: [],
            triggers: [],
          },
        },
        metadata: { pluginId: "awp.rp-core", parseFallback: true },
      };
    }
  },

  worldbookSearch: async ({ node, inputs }) => {
    const entries = await context.readWorldbook();
    const query = String(inputs.query ?? node.config.query ?? "");
    const results = context.rankEntries(query, entries, Number(node.config.limit ?? 4));

    return {
      outputs: {
        results: context.serializeEntries(results),
      },
      metadata: {
        pluginId: "awp.rp-core",
        matchedWorldbookIds: results.map((entry) => entry.id),
        matchedWorldbookTitles: results.map((entry) => entry.title),
        views: [
          {
            id: "worldbook_hits",
            kind: "entry-list",
            title: "命中世界书条目",
            items: results.map((entry) => ({
              id: entry.id,
              title: entry.title,
              summary: String(entry.content ?? "").slice(0, 120),
              tags: entry.tags,
            })),
          },
          {
            id: "search_stats",
            kind: "stats",
            title: "检索统计",
            pairs: [
              { label: "检索词", value: query || "(空)" },
              { label: "命中数", value: results.length },
              { label: "条目总数", value: entries.length },
            ],
          },
        ],
      },
    };
  },

  memoryRecall: async ({ node, inputs }) => {
    const entries = await context.readMemories();
    const query = String(inputs.query ?? node.config.query ?? "");
    const results = context.rankEntries(query, entries, Number(node.config.limit ?? 4));

    return {
      outputs: {
        memories: context.serializeEntries(results),
      },
      metadata: {
        pluginId: "awp.rp-core",
        matchedMemoryIds: results.map((entry) => entry.id),
        matchedMemoryTitles: results.map((entry) => entry.title),
        views: [
          {
            id: "memory_hits",
            kind: "entry-list",
            title: "命中记忆条目",
            items: results.map((entry) => ({
              id: entry.id,
              title: entry.title,
              summary: String(entry.content ?? "").slice(0, 120),
              tags: entry.tags,
            })),
          },
          {
            id: "memory_stats",
            kind: "stats",
            title: "检索统计",
            pairs: [
              { label: "检索词", value: query || "(空)" },
              { label: "命中数", value: results.length },
              { label: "记忆总数", value: entries.length },
            ],
          },
        ],
      },
    };
  },

  rpCharacterCard: async ({ node, inputs }) => ({
    outputs: {
      profile: {
        name: node.config.name,
        persona: node.config.persona,
        voice: node.config.voice,
        boundaries: node.config.boundaries,
        seed: inputs.seed,
      },
    },
    metadata: { pluginId: "awp.rp-core" },
  }),

  rpSceneState: async ({ node, inputs }) => ({
    outputs: {
      state: {
        location: node.config.location,
        mood: node.config.mood,
        stakes: node.config.stakes,
        setup: inputs.setup,
        lore: inputs.lore,
      },
    },
    metadata: { pluginId: "awp.rp-core" },
  }),

  rpDialogueDirector: async ({ node, inputs }) => {
    const result = await context.executeAgent({
      nodeId: node.id,
      config: {
        systemPrompt: [
          "你是 RP 角色扮演对话导演。",
          "必须根据 character、scene、player、memory 输入生成沉浸式中文 RP 回复。",
          "只扮演 NPC 和环境，不替玩家决定行动。",
          "优先遵守角色卡、人设边界、世界书事实和记忆库中的既有关系。",
          String(node.config.replyRules ?? ""),
        ].join("\n"),
        skills: Array.isArray(node.config.skills)
          ? node.config.skills.map(String)
          : ["rp_persona", "rp_player_agency", "rp_continuity", "rp_slow_burn"],
        plugins: Array.isArray(node.config.plugins)
          ? node.config.plugins.map(String)
          : ["worldbook_read", "rp_memory_read"],
        outputType: "draft",
      },
      inputs,
    });

    return {
      outputs: { reply: result.text },
      metadata: { ...result.metadata, pluginId: "awp.rp-core" },
    };
  },

  rpContinuityCheck: async ({ node, inputs }) => {
    const result = await context.executeAgent({
      nodeId: node.id,
      config: {
        model: "mock-pro",
        systemPrompt: `检查 RP 草稿是否保持人设、场景事实、关系连续性和玩家行动权。严格度：${String(
          node.config.strictness ?? "medium",
        )}`,
        skills: Array.isArray(node.config.skills)
          ? node.config.skills.map(String)
          : ["rp_player_agency", "rp_continuity"],
        plugins: [],
        outputType: "analysis",
      },
      inputs,
    });

    return {
      outputs: { notes: result.text },
      metadata: { ...result.metadata, pluginId: "awp.rp-core" },
    };
  },
});
