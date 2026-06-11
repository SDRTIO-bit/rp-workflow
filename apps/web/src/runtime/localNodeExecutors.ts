import { executeAgentNode } from "@awp/agent-runtime";
import type { SkillDefinition } from "@awp/agent-runtime";
import type { PluginDefinition } from "@awp/plugin-sdk";
import type { NodeExecutor } from "@awp/workflow-core";

export const createLocalNodeExecutors = ({
  sampleSkills,
  samplePlugins,
}: {
  sampleSkills: SkillDefinition[];
  samplePlugins: PluginDefinition[];
}): Record<string, NodeExecutor> => ({
  userInput: async ({ node }) => ({ outputs: { text: node.config.text ?? "" } }),
  worldbookSearch: async ({ node, inputs }) => ({
    outputs: {
      results: `Worldbook query: ${String(inputs.query ?? node.config.query ?? "")}`,
    },
  }),
  memoryRecall: async ({ node, inputs }) => ({
    outputs: {
      memories: `Memory recall (${String(node.config.scope ?? "general")}): ${String(
        inputs.query ?? node.config.query ?? "",
      )}`,
    },
  }),
  mockSearch: async ({ inputs }) => ({
    outputs: { results: `Mock search result for: ${String(inputs.query ?? "")}` },
  }),
  promptTemplate: async ({ node, inputs }) => ({
    outputs: {
      prompt: `${String(node.config.template ?? "")}\n${String(inputs.source ?? "")}`.trim(),
    },
  }),
  agent: async ({ node, inputs }) => {
    const result = await executeAgentNode({
      nodeId: node.id,
      config: {
        model: String(node.config.model ?? "mock-pro"),
        systemPrompt: String(node.config.systemPrompt ?? ""),
        skills: Array.isArray(node.config.skills) ? node.config.skills.map(String) : [],
        plugins: Array.isArray(node.config.plugins) ? node.config.plugins.map(String) : [],
        outputType: String(node.config.outputType ?? "draft"),
      },
      inputs,
      availableSkills: sampleSkills,
      availablePlugins: samplePlugins,
    });

    return {
      outputs: { result: result.text },
      metadata: result.metadata,
    };
  },
  textOutput: async ({ inputs }) => ({ outputs: { final: inputs.text ?? "" } }),
  debugLog: async ({ inputs }) => ({ outputs: { debug: JSON.stringify(inputs, null, 2) } }),
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
  }),
  rpLoreRecall: async ({ node, inputs }) => ({
    outputs: {
      lore: `RP lore recall (${String(node.config.scope ?? "all")}): ${String(inputs.query ?? "")}`,
    },
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
  }),
  rpDialogueDirector: async ({ node, inputs }) => ({
    outputs: {
      reply: [
        `【${String(node.config.style ?? "RP")}】`,
        "她没有立刻回答，只是看向仍在闪烁的广播灯。",
        "“你听见的是过去，也是现在。”",
        `玩家行动：${String(inputs.player ?? "")}`,
        `规则：${String(node.config.replyRules ?? "")}`,
      ].join("\n"),
    },
    metadata: {
      visibleSkillIds: Array.isArray(node.config.skills) ? node.config.skills.map(String) : [],
      visiblePluginIds: Array.isArray(node.config.plugins) ? node.config.plugins.map(String) : [],
    },
  }),
  rpContinuityCheck: async ({ node, inputs }) => ({
    outputs: {
      notes: `连续性检查(${String(node.config.strictness ?? "medium")}): 保持角色口吻、保留玩家行动权、检查场景事实。\n${String(inputs.draft ?? "")}`,
    },
    metadata: {
      visibleSkillIds: Array.isArray(node.config.skills) ? node.config.skills.map(String) : [],
    },
  }),
  musicSchoolIntake: async ({ node, inputs }) => ({
    outputs: {
      profile: {
        source: node.config.source,
        studentLevel: node.config.studentLevel,
        lead: inputs.lead,
      },
    },
  }),
  lessonPlanGenerator: async ({ node, inputs }) => ({
    outputs: {
      plan: `琴行课纲：${String(node.config.weeks ?? 4)} 周 / ${String(node.config.style ?? "钢琴启蒙")}\n${JSON.stringify(inputs)}`,
    },
  }),
  superpowersPlan: async ({ node, inputs }) => ({
    outputs: {
      plan: `Superpowers ${String(node.config.mode ?? "planning")} plan: ${JSON.stringify(inputs)}`,
    },
  }),
  webAppSpec: async ({ node, inputs }) => ({
    outputs: { spec: { surface: node.config.surface, brief: inputs.brief } },
  }),
  hyperframesComposition: async ({ node, inputs }) => ({
    outputs: {
      composition: {
        aspectRatio: node.config.aspectRatio,
        duration: node.config.duration,
        script: inputs.script,
        asset: inputs.asset,
      },
    },
  }),
  openAiToolAdapter: async ({ node, inputs }) => ({
    outputs: {
      tool: {
        provider: node.config.provider,
        name: node.config.toolName,
        spec: inputs.spec,
      },
    },
  }),
  assetPreview: async ({ inputs }) => ({
    outputs: { preview: JSON.stringify(inputs, null, 2) },
  }),
  preview: async ({ inputs }) => ({
    outputs: { preview: JSON.stringify(inputs.data ?? inputs, null, 2) },
  }),
});
