/**
 * Server Composition Root (P-14).
 *
 * This module is the single source of truth for the server's runtime
 * structure. Both the production entry point (`index.ts`) and the HTTP
 * integration tests build the server through `bootstrap()`.
 *
 * Constraints honored here:
 *  - Session / Memory semantics are unchanged.
 *  - Workflow branch algorithm is unchanged.
 *  - Checkpoint format is unchanged.
 *  - Official RP API request/response contract is unchanged.
 *  - No Legacy deletion happens here.
 *
 * What changed in P-14:
 *  - The server is constructed through a single function so the test
 *    harness can drive the real Hono app end-to-end without spawning
 *    a child process. This makes the two-turn `/api/rp` evidence
 *    reproducible from `vitest run`.
 */
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { resolve, join } from "node:path";
import type { Env } from "./env.js";
import { MOCK_MODEL } from "./env.js";
import { createMemoriesRoutes } from "./routes/memories.js";
import { createWorldbookRoutes } from "./routes/worldbook.js";
import { createPluginsRoutes, type PluginRuntime } from "./routes/plugins.js";
import { createSkillsRoutes } from "./routes/skills.js";
import { createNodesRoutes } from "./routes/nodes.js";
import { createTemplatesRoutes } from "./routes/templates.js";
import { createWorkflowRoutes, type WorkflowRuntime } from "./routes/workflow.js";
import { createRpRoutes } from "./routes/rp.js";
import { createLlmRoutes, type LlmConfig } from "./routes/llm.js";
import {
  loadNodePlugins,
  loadSkillPlugins,
  loadPluginState,
  createPluginCatalog,
  type NodePlugin,
  type SkillItem,
  type PluginState,
} from "./services/pluginLoader.js";
import { nodeRegistry, setRuntimeSchemaValidator, type NodeCatalog } from "@awp/workflow-core";
import { stdlibNodes } from "@awp/workflow-stdlib";
import {
  dynamicWorldbookNode,
  InMemoryDynamicWorldbookStore,
  createWorldbookSchemaValidators,
  type DynamicWorldbookStore,
} from "@awp/workflow-worldbook";
import {
  genericRetrieverNode,
  retrievalResultToMarkdownNode,
  createRetrievalSchemaValidators,
} from "@awp/workflow-retrieval";
import {
  memoryWriteNode,
  memoryCorpusNode,
  memoryDeleteNode,
  InMemoryWorkflowMemoryStore,
  FileWorkflowMemoryStore,
  createMemorySchemaValidators,
  type WorkflowMemoryStore,
} from "@awp/workflow-memory";
import { createRpLlmBridge } from "./services/rpLlmBridge.js";
import {
  registerRpRuntime,
  InMemoryTimelineStore,
  InMemoryChapterStore,
  InMemoryLoreStore,
  InMemoryTrackerStore,
  type RpRuntimeRegistration,
} from "@awp/rp-runtime";
import {
  createDeepSeekAdapter,
  createOpenCodeAdapter,
  ProviderRegistry,
  LlmRouter,
  createP1ProfileRegistry,
  rpMemoryCommitPolicyNode,
  rpCriticQualityGateNode,
  rpSideEffectDecisionNode,
  failWorkflowNode,
  InMemoryAgentSessionStore,
  agentSessionLoadV1Definition,
  agentSessionCommitV1Definition,
  type NodeModelConfig,
  type LlmAdapter,
} from "@awp/agent-runtime";
import type { OfficialRpServiceContext } from "./rp/officialRpTypes.js";

/** Optional hooks used only by tests to swap the in-process mock adapter. */
export type CompositionAdapters = {
  /**
   * Factory that returns the LlmAdapter used for the built-in "mock" provider.
   * Defaults to the production mock adapter that returns deterministic text
   * derived from the prompt. Tests may override this to drive specific
   * narratives, but the test suite in this repo uses the production default.
   */
  createMockAdapter?: () => LlmAdapter;
};

export type ServerComposition = {
  app: Hono;
  env: Env;
  /** Snapshot of the current LLM routing state. Useful for assertions. */
  llm: { providerId: string; model: string; registeredProviders: string[] };
  /** Accessor for the Official RP service context (used by /api/rp). */
  getRpServiceContext: () => OfficialRpServiceContext;
  /** Accessor for the LLM routes context (used by /api/llm). */
  getLlmConfig: () => LlmConfig;
  /** Accessor for the workflow routes context (used by /api/workflows). */
  getWorkflowRuntime: () => WorkflowRuntime;
  /** Accessor for the plugins routes context (used by /api/plugins). */
  getPluginRuntime: () => PluginRuntime;
  /** Accessor for the skills routes context (used by /api/skills). */
  getSkillsRuntime: () => { skillCatalog: SkillItem[] };
  /** Accessor for the nodes routes context (used by /api/nodes). */
  getNodesRuntime: () => { runtimeNodeCatalog: NodeCatalog; plugins: NodePlugin[] };
};

/**
 * Build the production server composition. Idempotent per process: each call
 * returns a fresh Hono app and runtime state.
 */
export async function bootstrap(
  env: Env,
  adapters: CompositionAdapters = {},
): Promise<ServerComposition> {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  const memoryFile = resolve(env.dataDir, "memories.json");
  const worldbookFile = resolve(env.dataDir, "worldbook.json");
  const pluginStateFile = join(env.pluginsDir, "plugin-state.json");

  // ── Runtime state, owned by this composition instance ─────────────────
  let llmRouter: LlmRouter | null = null;
  let pluginState: PluginState = {};
  let plugins: NodePlugin[] = [];
  let pluginCatalog: NodeCatalog = {};
  let rpRuntime: RpRuntimeRegistration | null = null;
  let runtimeNodeCatalog: NodeCatalog = { ...nodeRegistry };
  let skillCatalog: SkillItem[] = [];
  const profileRegistry = createP1ProfileRegistry();
  const worldbookStore: DynamicWorldbookStore = new InMemoryDynamicWorldbookStore();
  let memoryStore: WorkflowMemoryStore | undefined;
  const sessionStore = new InMemoryAgentSessionStore();

  const getPluginRuntime = (): PluginRuntime => ({
    pluginState,
    plugins,
    pluginCatalog,
    runtimeNodeCatalog,
    skillCatalog,
  });
  const setPluginRuntime = (runtime: PluginRuntime) => {
    pluginState = runtime.pluginState;
    plugins = runtime.plugins;
    pluginCatalog = runtime.pluginCatalog;
    runtimeNodeCatalog = runtime.runtimeNodeCatalog;
    skillCatalog = runtime.skillCatalog;
  };
  const getSkillsRuntime = () => ({ skillCatalog });
  const getNodesRuntime = () => ({ runtimeNodeCatalog, plugins });
  const getWorkflowRuntime = (): WorkflowRuntime => ({
    llmRouter: llmRouter!,
    defaultModelConfig: undefined as NodeModelConfig | undefined,
    memoryFile,
    worldbookFile,
    plugins,
    skillCatalog,
    runtimeNodeCatalog,
    rpRuntime,
    profileRegistry,
    worldbookStore,
    memoryStore,
    sessionStore,
  });
  const getLlmConfig = (): LlmConfig => ({
    llmRouter: llmRouter!,
    defaultModelConfig: undefined as NodeModelConfig | undefined,
  });
  const getRpServiceContext = (): OfficialRpServiceContext => ({
    serverWorkflowVersion: env.rpWorkflowVersion,
    llmRouter: llmRouter!,
    profileRegistry,
    sessionStore,
    memoryStore: memoryStore!,
    worldbookStore,
    runtimeNodeCatalog,
    dataDir: env.dataDir,
  });

  // ── Initialize plugins and RP runtime ────────────────────────────────
  try {
    pluginState = await loadPluginState(pluginStateFile);
    plugins = await loadNodePlugins(env.pluginsDir);
    for (const plugin of plugins) {
      const state = pluginState[plugin.manifest.id];
      if (state && typeof state.enabled === "boolean") {
        plugin.manifest.enabled = state.enabled;
      }
    }
    pluginCatalog = createPluginCatalog(plugins);
    skillCatalog = await loadSkillPlugins(env.pluginsDir);
  } catch (error) {
    console.warn("Failed to load plugins:", error);
  }

  // Hard guards — see index.ts comments for the full rationale.
  if (env.nodeEnv === "production" && env.rpProviderId === "mock") {
    throw new Error(
      `Refusing to start: rpProviderId="mock" is not allowed in production. ` +
        `Set RP_PROVIDER=deepseek (or opencode) and provide the matching API key.`,
    );
  }
  if (
    (env.rpProviderId === "deepseek" || env.rpProviderId === "opencode") &&
    env.nodeEnv === "production"
  ) {
    const apiKeyMissing =
      (env.rpProviderId === "deepseek" && !env.deepseekApiKey) ||
      (env.rpProviderId === "opencode" && !env.openCodeApiKey);
    if (apiKeyMissing) {
      throw new Error(
        `Refusing to start: RP provider "${env.rpProviderId}" is selected in production ` +
          `but its API key is missing. ` +
          `Set ${env.rpProviderId === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENCODE_API_KEY"}.`,
      );
    }
  }
  if (env.rpProviderId === "mock" && env.rpModel !== MOCK_MODEL) {
    throw new Error(
      `Provider/model mismatch: rpProviderId="mock" requires rpModel="${MOCK_MODEL}", ` +
        `got "${env.rpModel}".`,
    );
  }
  if (
    (env.rpProviderId === "deepseek" || env.rpProviderId === "opencode") &&
    env.rpModel === MOCK_MODEL
  ) {
    throw new Error(
      `Provider/model mismatch: rpProviderId="${env.rpProviderId}" cannot use ` +
        `rpModel="${MOCK_MODEL}". Unset RP_MODEL to use the provider's default.`,
    );
  }

  const registry = new ProviderRegistry(env.rpProviderId);

  console.log(`Profile Registry: ${profileRegistry.list().length} profiles registered`);

  const worldbookValidators = createWorldbookSchemaValidators();
  const retrievalValidators = createRetrievalSchemaValidators();
  const memoryValidators = createMemorySchemaValidators();
  const allValidators = { ...worldbookValidators, ...retrievalValidators, ...memoryValidators };
  setRuntimeSchemaValidator((schemaId, data) => {
    const validator = allValidators[schemaId];
    return validator ? validator(data) : true;
  });
  console.log("Worldbook Store: in-memory store initialized");
  console.log(
    `Retrieval validators: ${Object.keys(retrievalValidators).length} schemas registered`,
  );
  console.log(`Memory validators: ${Object.keys(memoryValidators).length} schemas registered`);

  if (env.workflowMemoryStore === "file") {
    if (!env.workflowMemoryDir) {
      throw new Error(
        "WORKFLOW_MEMORY_STORE=file requires WORKFLOW_MEMORY_DIR to be set to a non-empty directory path.",
      );
    }
    const memoryDir = resolve(env.workflowMemoryDir);
    const memoryFilePath = join(memoryDir, "workflow-memories.json");
    memoryStore = new FileWorkflowMemoryStore(memoryFilePath);
    console.log(`Memory Store: file store initialized at ${memoryFilePath}`);
  } else if (env.workflowMemoryStore === "in-memory") {
    memoryStore = new InMemoryWorkflowMemoryStore();
    console.log("Memory Store: in-memory store initialized");
  } else {
    throw new Error(
      `Unknown WORKFLOW_MEMORY_STORE: "${env.workflowMemoryStore}". Supported: in-memory, file`,
    );
  }

  console.log("Session Store: in-memory store initialized");

  if (env.rpProviderId === "mock") {
    registry.register({
      providerId: "mock",
      apiKey: "mock-key",
      baseUrl: "mock://local",
      defaultModel: MOCK_MODEL,
      createAdapter: () => (adapters.createMockAdapter ?? createOfficialRpMockAdapter)(),
    });
  }
  if (env.deepseekApiKey) {
    registry.register({
      providerId: "deepseek",
      apiKey: env.deepseekApiKey,
      baseUrl: "https://api.deepseek.com",
      defaultModel: env.rpProviderId === "deepseek" ? env.rpModel : env.deepseekModel,
      createAdapter: (apiKey, baseUrl) => createDeepSeekAdapter({ apiKey, baseUrl }),
    });
  }
  if (env.openCodeApiKey) {
    registry.register({
      providerId: "opencode",
      apiKey: env.openCodeApiKey,
      baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
      defaultModel: env.rpProviderId === "opencode" ? env.rpModel : env.openCodeModel,
      createAdapter: (apiKey, baseUrl) => createOpenCodeAdapter({ apiKey, baseUrl }),
    });
  }

  try {
    registry.getDefault();
  } catch (err) {
    const missingKeyHint =
      env.rpProviderId === "deepseek" && !env.deepseekApiKey
        ? " (DEEPSEEK_API_KEY is not set)"
        : env.rpProviderId === "opencode" && !env.openCodeApiKey
          ? " (OPENCODE_API_KEY is not set)"
          : "";
    throw new Error(
      `RP provider "${env.rpProviderId}" is not registered${missingKeyHint}. ` +
        `Set RP_PROVIDER to one of the registered providers (mock, deepseek, opencode) ` +
        `or configure the required API key.`,
      { cause: err },
    );
  }

  const router = new LlmRouter(registry);
  llmRouter = router;

  const rpLlmAdapter = createRpLlmBridge(router);
  const rpServices = {
    stores: {
      timeline: new InMemoryTimelineStore(),
      chapter: new InMemoryChapterStore(),
      lore: new InMemoryLoreStore(),
      tracker: new InMemoryTrackerStore(),
    },
    llmAdapter: rpLlmAdapter,
    writerConfig: {
      enableEchoFallback: true,
      strictMode: false,
    },
  };
  rpRuntime = registerRpRuntime(rpServices);

  const rpNodeTypes = Object.keys(rpRuntime.catalog);
  const existingNodeTypes = new Set([...Object.keys(nodeRegistry), ...Object.keys(pluginCatalog)]);
  const conflicts = rpNodeTypes.filter((type) => existingNodeTypes.has(type));
  if (conflicts.length > 0) {
    throw new Error(
      `RP Runtime node type conflicts with existing nodes: ${conflicts.join(", ")}. ` +
        "Cannot register RP runtime with conflicting node types.",
    );
  }

  runtimeNodeCatalog = {
    ...nodeRegistry,
    ...stdlibNodes,
    dynamicWorldbook: dynamicWorldbookNode,
    genericRetriever: genericRetrieverNode,
    retrievalResultToMarkdown: retrievalResultToMarkdownNode,
    memoryWrite: memoryWriteNode,
    memoryCorpus: memoryCorpusNode,
    memoryDelete: memoryDeleteNode,
    rpMemoryCommitPolicy: rpMemoryCommitPolicyNode,
    rpCriticQualityGate: rpCriticQualityGateNode,
    rpSideEffectDecision: rpSideEffectDecisionNode,
    failWorkflow: failWorkflowNode,
    agentSessionLoadV1: agentSessionLoadV1Definition,
    agentSessionCommitV1: agentSessionCommitV1Definition,
    ...rpRuntime.catalog,
    ...pluginCatalog,
  };

  console.log(`RP Runtime: registered ${rpNodeTypes.length} node types`);

  // ── Register routes ──────────────────────────────────────────────────
  app.route("/", createMemoriesRoutes(memoryFile));
  app.route("/", createWorldbookRoutes(worldbookFile));
  app.route(
    "/",
    createPluginsRoutes(env.pluginsDir, pluginStateFile, getPluginRuntime, setPluginRuntime),
  );
  app.route("/", createSkillsRoutes(getSkillsRuntime));
  app.route("/", createNodesRoutes(getNodesRuntime));
  app.route("/", createTemplatesRoutes());
  app.route("/", createWorkflowRoutes(getWorkflowRuntime));
  app.route("/", createRpRoutes(getRpServiceContext));
  app.route("/", createLlmRoutes(getLlmConfig));

  if (env.nodeEnv === "production") {
    app.use("/*", serveStatic({ root: "../web/dist" }));
  }

  const registeredProviders = [
    env.rpProviderId === "mock" ? "mock" : "",
    env.deepseekApiKey ? "deepseek" : "",
    env.openCodeApiKey ? "opencode" : "",
  ].filter(Boolean);

  return {
    app,
    env,
    llm: {
      providerId: env.rpProviderId,
      model: env.rpModel,
      registeredProviders,
    },
    getRpServiceContext,
    getLlmConfig,
    getWorkflowRuntime,
    getPluginRuntime,
    getSkillsRuntime,
    getNodesRuntime,
  };
}

// ── Production mock adapter (deterministic text per prompt) ──────────────

function createOfficialRpMockAdapter(): LlmAdapter {
  return {
    provider: "mock",
    async complete(input) {
      const prompt = input.prompt;
      const text = buildOfficialRpMockText(prompt);
      return {
        text,
        tokenUsage: {
          input: Math.max(1, Math.ceil(prompt.length / 4)),
          output: Math.max(1, Math.ceil(text.length / 4)),
        },
      };
    },
  };
}

function buildOfficialRpMockText(prompt: string): string {
  if (prompt.includes('"decision": "accept" | "revise"')) {
    return JSON.stringify({
      decision: "accept",
      scores: {
        continuity: 0.95,
        characterConsistency: 0.95,
        playerAgency: 0.95,
        knowledgeBoundary: 0.95,
        styleAndFormat: 0.95,
      },
      issues: [],
    });
  }
  if (prompt.includes("Output a JSON array of memory candidates")) {
    return "[]";
  }
  const playerInput = extractLastUserInput(prompt);
  return `银铃垂下眼，看见你放在面前的钥匙。她没有立刻伸手，只让指尖停在银光边缘，像是在确认这份托付的重量。片刻后，她轻声说：“我会记住这一刻。”${playerInput ? `\n\n你的动作仍留在她的视线里：${playerInput}` : ""}`;
}

function extractLastUserInput(prompt: string): string {
  const marker = "## userInput";
  const index = prompt.lastIndexOf(marker);
  if (index < 0) return "";
  const section = prompt.slice(index + marker.length).split("\n## ")[0] ?? "";
  return section.trim().slice(0, 120);
}
