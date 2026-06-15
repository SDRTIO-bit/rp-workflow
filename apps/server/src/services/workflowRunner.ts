import {
  createExecutionBatches,
  validateWorkflow,
  type WorkflowDefinition,
  type WorkflowRunResult,
  type NodeExecutor,
  type NodeCatalog,
  type WorkflowRunContext,
  getRuntimeSchemaValidator,
  checkSchemaCompatibility,
  findPortInCatalog,
} from "@awp/workflow-core";
import { isWirePort } from "@awp/workflow-core";
import {
  createDeepSeekAdapter,
  executeAgentNode,
  createGenericAgentExecutor,
  createSpecializedAgentExecutor,
  type SpecializedAgentProfileRegistry,
} from "@awp/agent-runtime";
import { rankMemories } from "@awp/memory-core";
import type { RpRuntimeRegistration } from "@awp/rp-runtime";
import { readEntries } from "./jsonStore.js";
import { createPluginExecutors, type NodePlugin, type SkillItem } from "./pluginLoader.js";

const agentToolDescriptions = [
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

const extractQuery = (workflow: WorkflowDefinition) =>
  workflow.nodes
    .map((node) => [node.config?.text, node.config?.systemPrompt].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n");

const serializeSearchResults = (
  entries: Array<{ title: string; content: string; tags: string[] }>,
) =>
  entries
    .map(
      (entry) =>
        `${entry.title}: ${entry.content}${entry.tags.length ? ` [${entry.tags.join(", ")}]` : ""}`,
    )
    .join("\n");

export type WorkflowRunnerContext = {
  apiKey?: string;
  model?: string;
  llmRouter?: import("@awp/agent-runtime").LlmRouter;
  defaultModelConfig?: import("@awp/agent-runtime").NodeModelConfig;
  memoryFile: string;
  worldbookFile: string;
  plugins: NodePlugin[];
  skillCatalog: SkillItem[];
  pluginCatalog: NodeCatalog;
  rpRuntime: RpRuntimeRegistration | null;
  profileRegistry?: SpecializedAgentProfileRegistry;
};

export const createExecutors = async (
  workflow: WorkflowDefinition,
  context: WorkflowRunnerContext,
  onToken?: (event: { nodeId: string; token: string }) => void,
): Promise<Record<string, NodeExecutor>> => {
  // Use LlmRouter if available, fallback to direct DeepSeek adapter for backward compat
  let adapter: ReturnType<typeof createDeepSeekAdapter>;
  let defaultModel: string;
  if (context.llmRouter) {
    const resolved = context.llmRouter.resolveConfig(context.defaultModelConfig, undefined);
    adapter = context.llmRouter.adapter(resolved.providerId);
    defaultModel = resolved.model;
  } else if (context.apiKey) {
    adapter = createDeepSeekAdapter({ apiKey: context.apiKey });
    defaultModel = context.model ?? "deepseek-v4-flash";
  } else {
    throw new Error("No LLM provider configured. Set OPENCODE_API_KEY or DEEPSEEK_API_KEY.");
  }
  const memories = await readEntries(context.memoryFile);
  const worldbookEntries = await readEntries(context.worldbookFile);
  const relevantMemories = rankMemories(extractQuery(workflow), memories, 4);
  const pluginExecutors = await createPluginExecutors(context.plugins, {
    readMemories: () => readEntries(context.memoryFile),
    readWorldbook: () => readEntries(context.worldbookFile),
    rankEntries: (query, entries, limit) =>
      rankMemories(
        query || extractQuery(workflow),
        entries as Parameters<typeof rankMemories>[1],
        limit,
      ),
    serializeEntries: (entries) =>
      serializeSearchResults(entries as Parameters<typeof serializeSearchResults>[0]),
    executeAgent: async ({ nodeId, config, inputs }) => {
      const selectedModel = String(config.model ?? defaultModel).startsWith("mock-")
        ? String(config.model)
        : String(config.model ?? defaultModel);
      const result = await executeAgentNode(
        {
          nodeId,
          config: {
            model: selectedModel,
            systemPrompt: String(config.systemPrompt ?? ""),
            skills: Array.isArray(config.skills) ? config.skills.map(String) : [],
            plugins: Array.isArray(config.plugins) ? config.plugins.map(String) : [],
            outputType: String(config.outputType ?? "draft"),
          },
          inputs,
          availableSkills: context.skillCatalog,
          availablePlugins: agentToolDescriptions,
        },
        adapter,
        {
          onToken: (token) => onToken?.({ nodeId, token }),
        },
      );

      return {
        text: result.text,
        metadata: result.metadata,
      };
    },
  });

  return {
    userInput: async ({ node }) => ({ outputs: { text: node.config.text ?? "" } }),
    promptTemplate: async ({ node, inputs }) => ({
      outputs: {
        prompt: `${String(node.config.template ?? "")}\n${String(inputs.source ?? "")}`.trim(),
      },
    }),
    mockSearch: async ({ inputs }) => ({
      outputs: {
        results: `Mock search result for: ${String(inputs.query ?? "")}`,
      },
    }),
    worldbookSearch: async ({ node, inputs }) => {
      const query = String(inputs.query ?? node.config.query ?? extractQuery(workflow));
      const results = rankMemories(query, worldbookEntries, Number(node.config.limit ?? 4));
      return {
        outputs: {
          results: serializeSearchResults(results),
        },
        metadata: {
          matchedWorldbookIds: results.map((entry) => entry.id),
          matchedWorldbookTitles: results.map((entry) => entry.title),
        },
      };
    },
    memoryRecall: async ({ node, inputs }) => {
      const query = String(inputs.query ?? node.config.query ?? extractQuery(workflow));
      const results = rankMemories(query, memories, Number(node.config.limit ?? 4));
      return {
        outputs: {
          memories: serializeSearchResults(results),
        },
        metadata: {
          matchedMemoryIds: results.map((entry) => entry.id),
          matchedMemoryTitles: results.map((entry) => entry.title),
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
    rpLoreRecall: async ({ node, inputs }) => {
      const query = String(inputs.query ?? node.config.query ?? extractQuery(workflow));
      const results = rankMemories(query, worldbookEntries, Number(node.config.limit ?? 5));
      return {
        outputs: {
          lore: serializeSearchResults(results),
        },
        metadata: {
          matchedWorldbookIds: results.map((entry) => entry.id),
          matchedWorldbookTitles: results.map((entry) => entry.title),
        },
      };
    },
    rpDialogueDirector: async ({ node, inputs }) => {
      const result = await executeAgentNode(
        {
          nodeId: node.id,
          config: {
            model: defaultModel,
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
          availableSkills: context.skillCatalog,
          availablePlugins: agentToolDescriptions,
        },
        adapter,
        {
          onToken: (token) => onToken?.({ nodeId: node.id, token }),
        },
      );

      return {
        outputs: { reply: result.text },
        metadata: result.metadata,
      };
    },
    rpContinuityCheck: async ({ node, inputs }) => {
      const result = await executeAgentNode({
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
        availableSkills: context.skillCatalog,
        availablePlugins: agentToolDescriptions,
      });

      return {
        outputs: { notes: result.text },
        metadata: result.metadata,
      };
    },
    agent: async ({ node, inputs }) => {
      const result = await executeAgentNode(
        {
          nodeId: node.id,
          config: {
            model: String(node.config.model ?? defaultModel).startsWith("mock-")
              ? String(node.config.model ?? defaultModel)
              : String(node.config.model ?? defaultModel),
            systemPrompt: String(node.config.systemPrompt ?? ""),
            skills: Array.isArray(node.config.skills) ? node.config.skills.map(String) : [],
            plugins: Array.isArray(node.config.plugins) ? node.config.plugins.map(String) : [],
            outputType: String(node.config.outputType ?? "draft"),
          },
          inputs: {
            ...inputs,
            longTermMemory: relevantMemories.map((memory) => ({
              title: memory.title,
              content: memory.content,
              tags: memory.tags,
            })),
          },
          availableSkills: context.skillCatalog,
          availablePlugins: agentToolDescriptions,
        },
        adapter,
        {
          onToken: (token) => onToken?.({ nodeId: node.id, token }),
        },
      );

      return {
        outputs: { result: result.text },
        metadata: result.metadata,
      };
    },
    textOutput: async ({ inputs }) => ({ outputs: { final: inputs.text ?? "" } }),
    debugLog: async ({ inputs }) => ({ outputs: { debug: JSON.stringify(inputs, null, 2) } }),

    // ============ P-1: Wire-Native Node Executors ============

    playerInput: async ({ node }) => ({
      outputs: { text: String(node.config.text ?? "") },
    }),

    markdownSource: async ({ node }) => ({
      outputs: { markdown: String(node.config.content ?? "") },
    }),

    jsonSource: async ({ node }) => {
      const raw = String(node.config.data ?? "{}");
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
      return { outputs: { json: data } };
    },

    playerOutput: async ({ inputs }) => ({
      outputs: { final: inputs.text ?? "" },
    }),

    inspectOutput: async ({ inputs }) => {
      const parts: string[] = [];
      if (inputs.jsonInput !== undefined && inputs.jsonInput !== null) {
        parts.push(`[JSON]\n${JSON.stringify(inputs.jsonInput, null, 2)}`);
      }
      if (inputs.markdownInput !== undefined && inputs.markdownInput !== null) {
        parts.push(`[Markdown]\n${String(inputs.markdownInput)}`);
      }
      if (inputs.textInput !== undefined && inputs.textInput !== null) {
        parts.push(`[Text]\n${String(inputs.textInput)}`);
      }
      return { outputs: { debug: parts.join("\n\n") || "(no inputs connected)" } };
    },

    // Agent executors (P-1) — use LlmRouter or fallback adapter
    genericAgent: context.llmRouter
      ? createGenericAgentExecutor({
          registry: context.llmRouter.providerRegistry,
          profileRegistry: context.profileRegistry,
          createAdapter: (providerId) => context.llmRouter!.adapter(providerId),
          workflowModelConfig: context.defaultModelConfig,
        })
      : ((async () => {
          throw new Error("genericAgent: LlmRouter not configured. Set up LLM providers first.");
        }) as unknown as NodeExecutor),

    specializedAgent: context.llmRouter
      ? createSpecializedAgentExecutor({
          registry: context.llmRouter.providerRegistry,
          profileRegistry: context.profileRegistry,
          createAdapter: (providerId) => context.llmRouter!.adapter(providerId),
          workflowModelConfig: context.defaultModelConfig,
        })
      : ((async () => {
          throw new Error(
            "specializedAgent: LlmRouter not configured. Set up LLM providers first.",
          );
        }) as unknown as NodeExecutor),

    ...pluginExecutors,
    // Merge RP Runtime executors
    ...(context.rpRuntime?.executors ?? {}),
  };
};

export const collectInputs = (
  workflow: WorkflowDefinition,
  nodeId: string,
  outputsByNode: Map<string, Record<string, unknown>>,
): Record<string, unknown> => {
  const inputs: Record<string, unknown> = {};

  for (const edge of workflow.edges.filter((candidate) => candidate.target === nodeId)) {
    inputs[edge.targetPort] = outputsByNode.get(edge.source)?.[edge.sourcePort];
  }

  return inputs;
};

export const runWorkflowStreaming = async (
  workflow: WorkflowDefinition,
  executors: Record<string, NodeExecutor>,
  runtimeNodeCatalog: NodeCatalog,
  onEvent: (event: { type: string; run?: unknown; result?: WorkflowRunResult }) => void,
  workflowContext?: WorkflowRunContext,
): Promise<WorkflowRunResult> => {
  const validationIssues = validateWorkflow(workflow, runtimeNodeCatalog);
  const errorIssues = validationIssues.filter((issue) => issue.level === "error");

  if (errorIssues.length > 0) {
    const result: WorkflowRunResult = {
      workflowId: workflow.id,
      status: "error",
      batches: [],
      nodeRuns: [],
      validationIssues,
    };
    onEvent({ type: "done", result });
    return result;
  }

  const batches = createExecutionBatches(workflow);
  const outputsByNode = new Map<string, Record<string, unknown>>();
  const nodeRuns: WorkflowRunResult["nodeRuns"] = [];
  let hasError = false;

  for (const batch of batches) {
    const batchRuns = await Promise.all(
      batch.map(async (nodeId) => {
        const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) {
          throw new Error(`Missing scheduled node ${nodeId}`);
        }

        const inputs = collectInputs(workflow, nodeId, outputsByNode);
        const startedAt = Date.now();

        // Runtime schema validation for JSON edges with compatible-with-runtime-validation
        const runtimeValidator = getRuntimeSchemaValidator();
        if (runtimeValidator) {
          for (const edge of workflow.edges.filter((e) => e.target === nodeId)) {
            const sourceNode = workflow.nodes.find((n) => n.id === edge.source);
            if (!sourceNode) continue;
            const tPort = findPortInCatalog(runtimeNodeCatalog, nodeId, edge.targetPort, "input");
            const sPort = findPortInCatalog(
              runtimeNodeCatalog,
              sourceNode.type,
              edge.sourcePort,
              "output",
            );
            if (!tPort || !sPort) continue;
            if (!isWirePort(sPort) || !isWirePort(tPort)) continue;
            if (sPort.wireType !== "json" || tPort.wireType !== "json") continue;
            const status = checkSchemaCompatibility(sPort.schemaId, tPort.schemaId);
            if (status !== "compatible-with-runtime-validation") continue;
            if (!tPort.schemaId) continue;
            if (!runtimeValidator(tPort.schemaId, inputs[edge.targetPort])) {
              hasError = true;
              const errorMsg = `Runtime schema validation failed: port "${edge.targetPort}" does not satisfy schema "${tPort.schemaId}"`;
              const errorRun = {
                nodeId,
                status: "error" as const,
                inputs,
                outputs: {},
                startedAt,
                endedAt: Date.now(),
                error: errorMsg,
              };
              return errorRun;
            }
          }
        }

        try {
          const executor = executors[node.type] ?? (async () => ({ outputs: {}, metadata: {} }));
          const execution = await executor({ node, inputs, context: workflowContext });
          outputsByNode.set(nodeId, execution.outputs);
          return {
            nodeId,
            status: "success" as const,
            inputs,
            outputs: execution.outputs,
            metadata: execution.metadata ?? {},
            startedAt,
            endedAt: Date.now(),
          };
        } catch (error) {
          hasError = true;
          return {
            nodeId,
            status: "error" as const,
            inputs,
            outputs: {},
            startedAt,
            endedAt: Date.now(),
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    for (const run of batchRuns) {
      nodeRuns.push(run);
      onEvent({ type: "nodeRun", run });
    }

    if (hasError) {
      break;
    }
  }

  const result: WorkflowRunResult = {
    workflowId: workflow.id,
    status: hasError ? "error" : "success",
    batches,
    nodeRuns,
    validationIssues,
  };

  onEvent({ type: "done", result });
  return result;
};
