import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { resolve, join } from "node:path";
import { resolveEnv } from "./env.js";
import { createMemoriesRoutes } from "./routes/memories.js";
import { createWorldbookRoutes } from "./routes/worldbook.js";
import { createPluginsRoutes, type PluginRuntime } from "./routes/plugins.js";
import { createSkillsRoutes } from "./routes/skills.js";
import { createNodesRoutes } from "./routes/nodes.js";
import { createTemplatesRoutes } from "./routes/templates.js";
import { createWorkflowRoutes } from "./routes/workflow.js";
import { createLlmRoutes } from "./routes/llm.js";
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
  type SpecializedAgentProfileRegistry,
  type AgentSessionStore,
} from "@awp/agent-runtime";

const app = new Hono();

app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

const env = resolveEnv();
const memoryFile = resolve(env.dataDir, "memories.json");
const worldbookFile = resolve(env.dataDir, "worldbook.json");
const pluginStateFile = join(env.pluginsDir, "plugin-state.json");

// LLM routing state (populated in initPlugins)
let llmRegistry: ProviderRegistry | null = null;
let llmRouter: LlmRouter | null = null;
let pluginState: PluginState = {};
let plugins: NodePlugin[] = [];
let pluginCatalog: NodeCatalog = {};
let rpRuntime: RpRuntimeRegistration | null = null;
let runtimeNodeCatalog: NodeCatalog = { ...nodeRegistry };
let skillCatalog: SkillItem[] = [];
let profileRegistry: SpecializedAgentProfileRegistry | undefined;
let worldbookStore: DynamicWorldbookStore | undefined;
let memoryStore: WorkflowMemoryStore | undefined;
let sessionStore: AgentSessionStore | undefined;

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
const getWorkflowRuntime = () => ({
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
const getLlmConfig = () => ({
  llmRouter: llmRouter!,
  defaultModelConfig: undefined as NodeModelConfig | undefined,
});

// Initialize plugins and RP runtime
const initPlugins = async () => {
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

  // Initialize RP Runtime
  try {
    // Build ProviderRegistry (explicit default, no auto-detection from API keys)
    const registry = new ProviderRegistry(env.defaultProviderId);

    // Initialize P-1 Profile Registry (built-in mock profiles)
    profileRegistry = createP1ProfileRegistry();
    console.log(`Profile Registry: ${profileRegistry.list().length} profiles registered`);

    // Initialize P-3 Dynamic Worldbook Store & Schema Validators
    worldbookStore = new InMemoryDynamicWorldbookStore();
    const worldbookValidators = createWorldbookSchemaValidators();
    const retrievalValidators = createRetrievalSchemaValidators();
    const memoryValidators = createMemorySchemaValidators();
    const allValidators = { ...worldbookValidators, ...retrievalValidators, ...memoryValidators };
    setRuntimeSchemaValidator((schemaId, data) => {
      const validator = allValidators[schemaId];
      return validator ? validator(data) : true; // pass-through for unknown schemas
    });
    console.log("Worldbook Store: in-memory store initialized");
    console.log(
      `Retrieval validators: ${Object.keys(retrievalValidators).length} schemas registered`,
    );
    console.log(`Memory validators: ${Object.keys(memoryValidators).length} schemas registered`);

    // P-5 Memory Store — configurable backend (in-memory or file)
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

    // P-7 Agent Session Store
    sessionStore = new InMemoryAgentSessionStore();
    console.log("Session Store: in-memory store initialized");

    // Register available providers
    if (env.openCodeApiKey) {
      registry.register({
        providerId: "opencode",
        apiKey: env.openCodeApiKey,
        baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
        defaultModel: env.openCodeModel,
        createAdapter: (apiKey, baseUrl) => createOpenCodeAdapter({ apiKey, baseUrl }),
      });
    }
    if (env.deepseekApiKey) {
      registry.register({
        providerId: "deepseek",
        apiKey: env.deepseekApiKey,
        baseUrl: "https://api.deepseek.com",
        defaultModel: env.deepseekModel,
        createAdapter: (apiKey, baseUrl) => createDeepSeekAdapter({ apiKey, baseUrl }),
      });
    }

    const router = new LlmRouter(registry);
    llmRegistry = registry;
    llmRouter = router;

    // Create RP LLM bridge through router (no fixed adapter or model).
    // If no provider is registered, rpLlmAdapter stays undefined → RP Writer
    // operates in echo_fallback mode.
    let rpLlmAdapter: ReturnType<typeof createRpLlmBridge> | undefined;
    try {
      registry.getDefault(); // throws if default provider not registered
      rpLlmAdapter = createRpLlmBridge(router);
    } catch {
      // No LLM provider configured — RP Writer runs in echo_fallback mode
    }

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

    // Check for node type conflicts
    const rpNodeTypes = Object.keys(rpRuntime.catalog);
    const existingNodeTypes = new Set([
      ...Object.keys(nodeRegistry),
      ...Object.keys(pluginCatalog),
    ]);

    const conflicts = rpNodeTypes.filter((type) => existingNodeTypes.has(type));
    if (conflicts.length > 0) {
      throw new Error(
        `RP Runtime node type conflicts with existing nodes: ${conflicts.join(", ")}. ` +
          "Cannot register RP runtime with conflicting node types.",
      );
    }

    // Merge catalogs: nodeRegistry + stdlibNodes + dynamicWorldbook + retrieval + rpCatalog + session nodes + pluginCatalog
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
  } catch (error) {
    console.error("Failed to initialize RP Runtime:", error);
    throw error; // Fail fast on RP runtime initialization error
  }
};

// Register routes
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
app.route("/", createLlmRoutes(getLlmConfig));

// Production static serving
if (env.nodeEnv === "production") {
  app.use("/*", serveStatic({ root: "../web/dist" }));
}

// Start server
const start = async () => {
  await initPlugins();

  serve({ fetch: app.fetch, port: env.port }, (info) => {
    console.log(`@awp/server running at http://127.0.0.1:${info.port}`);
    console.log(
      llmRouter
        ? `LLM Router: defaultProvider=${env.defaultProviderId}, providers=[${[...((llmRegistry as ProviderRegistry).getDefault ? "" : "")]}]`
        : "LLM: no provider configured",
    );
    // Log registered providers
    if (llmRegistry) {
      // Providers are registered; log them
      console.log(
        `LLM providers: ${env.openCodeApiKey ? "opencode " : ""}${env.deepseekApiKey ? "deepseek " : ""}`.trim() ||
          "none",
      );
    }
  });
};

start();

export { app };
