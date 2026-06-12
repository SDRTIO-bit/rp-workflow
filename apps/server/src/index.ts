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
import { nodeRegistry, type NodeCatalog } from "@awp/workflow-core";
import { createRpLlmBridge } from "./services/rpLlmBridge.js";
import {
  registerRpRuntime,
  InMemoryTimelineStore,
  InMemoryChapterStore,
  InMemoryLoreStore,
  InMemoryTrackerStore,
  type RpRuntimeRegistration,
} from "@awp/rp-runtime";
import { createDeepSeekAdapter } from "@awp/agent-runtime";

const app = new Hono();

app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

const env = resolveEnv();
const memoryFile = resolve(env.dataDir, "memories.json");
const worldbookFile = resolve(env.dataDir, "worldbook.json");
const pluginStateFile = join(env.pluginsDir, "plugin-state.json");

// Plugin runtime state
let pluginState: PluginState = {};
let plugins: NodePlugin[] = [];
let pluginCatalog: NodeCatalog = {};
let rpRuntime: RpRuntimeRegistration | null = null;
let runtimeNodeCatalog: NodeCatalog = { ...nodeRegistry };
let skillCatalog: SkillItem[] = [];

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
  apiKey: env.deepseekApiKey ?? "",
  model: env.deepseekModel,
  memoryFile,
  worldbookFile,
  plugins,
  skillCatalog,
  runtimeNodeCatalog,
  rpRuntime,
});
const getLlmConfig = () => ({
  apiKey: env.deepseekApiKey,
  model: env.deepseekModel,
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
    // Create LLM adapter for RP Runtime
    const rpLlmAdapter = env.deepseekApiKey
      ? createRpLlmBridge(createDeepSeekAdapter({ apiKey: env.deepseekApiKey }), env.deepseekModel)
      : undefined;

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

    // Merge catalogs: nodeRegistry + rpCatalog + pluginCatalog
    runtimeNodeCatalog = {
      ...nodeRegistry,
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
      env.deepseekApiKey ? "DeepSeek Agent: enabled" : "DeepSeek Agent: missing DEEPSEEK_API_KEY",
    );
  });
};

start();

export { app };
