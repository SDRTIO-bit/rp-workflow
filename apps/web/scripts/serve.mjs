import { createDeepSeekAdapter, executeAgentNode } from "@awp/agent-runtime";
import { rankMemories } from "@awp/memory-core";
import { validateNodePluginManifest, validateSkillPluginManifest } from "@awp/plugin-sdk";
import {
  createExecutionBatches,
  nodeRegistry,
  runWorkflow,
  validateWorkflow,
} from "@awp/workflow-core";
import { workflowTemplates } from "../src/state/sampleWorkflows";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

const port = Number(process.env.PORT ?? 5180);
const host = "127.0.0.1";
const dist = resolve(import.meta.dirname);
const dataDir = resolve(import.meta.dirname, "../../../data");
const pluginsDir = resolve(import.meta.dirname, "../../../plugins");
const pluginStateFile = join(pluginsDir, "plugin-state.json");

const loadPluginState = async () => {
  try {
    return JSON.parse(await readFile(pluginStateFile, "utf8"));
  } catch {
    return {};
  }
};

const savePluginState = async (state) => {
  await mkdir(pluginsDir, { recursive: true });
  await writeFile(pluginStateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const memoryFile = join(dataDir, "memories.json");
const worldbookFile = join(dataDir, "worldbook.json");
const apiKey = process.env.DEEPSEEK_API_KEY;
const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
]);

const readJsonBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const readEntries = async (filePath) => {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
};

const writeEntries = async (filePath, entries) => {
  await mkdir(dataDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
};

const createEntry = (body, prefix, fallbackTitle) => ({
  id: `${prefix}_${Date.now()}`,
  title: String(body.title ?? fallbackTitle),
  content: String(body.content ?? ""),
  tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
  updatedAt: new Date().toISOString(),
});

const updateEntry = (entry, body) => ({
  ...entry,
  title: String(body.title ?? entry.title),
  content: String(body.content ?? entry.content),
  tags: Array.isArray(body.tags) ? body.tags.map(String) : entry.tags,
  updatedAt: new Date().toISOString(),
});

const extractEntityId = (pathname, prefix) => {
  if (!pathname.startsWith(`${prefix}/`)) {
    return undefined;
  }
  const encoded = pathname.slice(prefix.length + 1);
  return encoded ? decodeURIComponent(encoded) : undefined;
};

const extractQuery = (workflow) =>
  workflow.nodes
    .map((node) => [node.config?.text, node.config?.systemPrompt].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n");

const sendJson = (response, status, body) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const serializeSearchResults = (entries) =>
  entries
    .map(
      (entry) =>
        `${entry.title}: ${entry.content}${entry.tags.length ? ` [${entry.tags.join(", ")}]` : ""}`,
    )
    .join("\n");

const loadNodePlugins = async () => {
  let entries = [];
  try {
    entries = await readdir(pluginsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const plugins = [];

  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const manifestPath = join(pluginsDir, entry.name, "node.plugin.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const issues = validateNodePluginManifest(manifest);

      if (issues.length > 0) {
        console.warn(`Skipped node plugin ${entry.name}: ${issues.join("; ")}`);
        continue;
      }

      if (manifest.enabled === false) {
        continue;
      }

      plugins.push({
        manifest,
        baseDir: dirname(manifestPath),
      });
    } catch (error) {
      console.warn(
        `Skipped node plugin ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return plugins;
};

const loadSkillPlugins = async () => {
  let entries = [];
  try {
    entries = await readdir(pluginsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills = [];

  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const manifestPath = join(pluginsDir, entry.name, "skill.plugin.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const issues = validateSkillPluginManifest(manifest);

      if (issues.length > 0) {
        console.warn(`Skipped skill plugin ${entry.name}: ${issues.join("; ")}`);
        continue;
      }

      if (manifest.enabled === false) {
        continue;
      }

      for (const skill of manifest.skills) {
        skills.push({
          id: skill.id,
          label: typeof skill.label === "string" ? skill.label : (skill.label.zh ?? skill.label.en ?? ""),
          content: typeof skill.content === "string" ? skill.content : (skill.content.zh ?? skill.content.en ?? ""),
          category: skill.category,
          tags: skill.tags,
          pluginId: manifest.id,
        });
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(
          `Skipped skill plugin ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return skills;
};

let skillCatalog = [];

const createPluginCatalog = (plugins) =>
  Object.fromEntries(
    plugins.flatMap((plugin) => plugin.manifest.nodes.map((node) => [node.type, node])),
  );

const createPluginExecutors = async (plugins, context) => {
  const executors = {};

  for (const plugin of plugins) {
    const executor = plugin.manifest.executor;
    if (!executor) {
      continue;
    }

    if (executor.adapter === "remote-http") {
      const endpoint = executor.entry;
      const timeoutMs = executor.timeoutMs ?? 30000;

      // Validate URL protocol
      try {
        const parsed = new URL(endpoint);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          console.warn(
            `Skipped executor for ${plugin.manifest.id}: unsupported protocol ${parsed.protocol}`,
          );
          continue;
        }
      } catch {
        console.warn(`Skipped executor for ${plugin.manifest.id}: invalid URL ${endpoint}`);
        continue;
      }

      // Check network permission
      const hasNetwork = (plugin.manifest.permissions ?? []).includes("network");
      if (!hasNetwork) {
        console.warn(
          `Skipped executor for ${plugin.manifest.id}: remote-http requires "network" permission`,
        );
        continue;
      }

      const remoteApiUrl = endpoint;

      for (const nodeDef of plugin.manifest.nodes) {
        executors[nodeDef.type] = async ({ node, inputs }) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);

          try {
            const response = await fetch(remoteApiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                pluginId: plugin.manifest.id,
                nodeType: node.type,
                workflowId: context._workflowId,
                node: { id: node.id, type: node.type, config: node.config },
                inputs,
              }),
              signal: controller.signal,
            });

            clearTimeout(timer);

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (!data || typeof data !== "object") {
              throw new Error("Invalid response: expected JSON object");
            }

            if (data.error) {
              throw new Error(String(data.error));
            }

            if (!data.outputs || typeof data.outputs !== "object") {
              throw new Error("Invalid response: missing outputs object");
            }

            return {
              outputs: data.outputs,
              metadata: data.metadata ?? {},
            };
          } catch (error) {
            clearTimeout(timer);
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(
              `Remote executor ${plugin.manifest.id}/${nodeDef.type} failed at ${remoteApiUrl}: ${message}`,
            );
          }
        };
      }

      continue;
    }

    if (executor.adapter !== "local-module") {
      console.warn(`Skipped executor for ${plugin.manifest.id}: unsupported ${executor.adapter}`);
      continue;
    }

    const modulePath = resolve(plugin.baseDir, executor.entry);
    const module = await import(pathToFileURL(modulePath).href);
    if (typeof module.createExecutors !== "function") {
      console.warn(`Skipped executor for ${plugin.manifest.id}: createExecutors export missing`);
      continue;
    }

    Object.assign(executors, await module.createExecutors(context));
  }

  return executors;
};

let pluginState = await loadPluginState();
let plugins = await loadNodePlugins();

// Merge runtime state into plugins
for (const plugin of plugins) {
  const state = pluginState[plugin.manifest.id];
  if (state && typeof state.enabled === "boolean") {
    plugin.manifest.enabled = state.enabled;
  }
}

let pluginCatalog = createPluginCatalog(plugins);
let runtimeNodeCatalog = {
  ...nodeRegistry,
  ...pluginCatalog,
};

skillCatalog = await loadSkillPlugins();

const reloadPluginRuntime = async () => {
  pluginState = await loadPluginState();
  plugins = await loadNodePlugins();

  for (const plugin of plugins) {
    const state = pluginState[plugin.manifest.id];
    if (state && typeof state.enabled === "boolean") {
      plugin.manifest.enabled = state.enabled;
    }
  }

  pluginCatalog = createPluginCatalog(plugins);
  runtimeNodeCatalog = {
    ...nodeRegistry,
    ...pluginCatalog,
  };

  skillCatalog = await loadSkillPlugins();
};

const createExecutors = async (workflow, onToken) => {
  if (!apiKey) {
    throw new Error("缺少环境变量 DEEPSEEK_API_KEY。");
  }

  const adapter = createDeepSeekAdapter({ apiKey });
  const memories = await readEntries(memoryFile);
  const worldbookEntries = await readEntries(worldbookFile);
  const relevantMemories = rankMemories(extractQuery(workflow), memories, 4);
  const pluginExecutors = await createPluginExecutors(plugins, {
    _workflowId: workflow.id,
    readMemories: () => readEntries(memoryFile),
    readWorldbook: () => readEntries(worldbookFile),
    rankEntries: (query, entries, limit) =>
      rankMemories(query || extractQuery(workflow), entries, limit),
    serializeEntries: serializeSearchResults,
    executeAgent: async ({ nodeId, config, inputs }) => {
      const selectedModel = String(config.model ?? model).startsWith("mock-")
        ? String(config.model)
        : String(config.model ?? model);
      const result = await executeAgentNode(
        {
          nodeId,
          config: {
            ...config,
            model: selectedModel,
          },
          inputs,
          availableSkills: skillCatalog,
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
            model,
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
          availableSkills: skillCatalog,
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
        availableSkills: skillCatalog,
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
            model: String(node.config.model ?? model).startsWith("mock-")
              ? model
              : String(node.config.model ?? model),
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
          availableSkills: skillCatalog,
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
    ...pluginExecutors,
  };
};

const collectInputs = (workflow, nodeId, outputsByNode) => {
  const inputs = {};

  for (const edge of workflow.edges.filter((candidate) => candidate.target === nodeId)) {
    inputs[edge.targetPort] = outputsByNode.get(edge.source)?.[edge.sourcePort];
  }

  return inputs;
};

const runWorkflowStreaming = async (workflow, executors, onEvent) => {
  const validationIssues = validateWorkflow(workflow, runtimeNodeCatalog);
  const errorIssues = validationIssues.filter((issue) => issue.level === "error");

  if (errorIssues.length > 0) {
    const result = {
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
  const outputsByNode = new Map();
  const nodeRuns = [];
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

        try {
          const executor = executors[node.type] ?? (async () => ({ outputs: {} }));
          const execution = await executor({ node, inputs });
          outputsByNode.set(nodeId, execution.outputs);
          return {
            nodeId,
            status: "success",
            inputs,
            outputs: execution.outputs,
            metadata: execution.metadata,
            startedAt,
            endedAt: Date.now(),
          };
        } catch (error) {
          hasError = true;
          return {
            nodeId,
            status: "error",
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

  const result = {
    workflowId: workflow.id,
    status: hasError ? "error" : "success",
    batches,
    nodeRuns,
    validationIssues,
  };
  onEvent({ type: "done", result });
  return result;
};

const handleEntryCollection = async (
  request,
  response,
  filePath,
  collectionKey,
  prefix,
  fallbackTitle,
) => {
  const body = await readJsonBody(request);
  const entries = await readEntries(filePath);
  const entry = createEntry(body, prefix, fallbackTitle);
  const nextEntries = [entry, ...entries].slice(0, 300);
  await writeEntries(filePath, nextEntries);
  sendJson(response, 201, { [collectionKey]: nextEntries, entry, memory: entry });
};

const handleEntryItem = async (request, response, filePath, collectionKey, id) => {
  const entries = await readEntries(filePath);

  if (request.method === "PUT") {
    const body = await readJsonBody(request);
    let found = false;
    const nextEntries = entries.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }
      found = true;
      return updateEntry(entry, body);
    });

    if (!found) {
      sendJson(response, 404, { error: "Entry not found" });
      return;
    }

    await writeEntries(filePath, nextEntries);
    sendJson(response, 200, { [collectionKey]: nextEntries });
    return;
  }

  if (request.method === "DELETE") {
    const nextEntries = entries.filter((entry) => entry.id !== id);
    await writeEntries(filePath, nextEntries);
    sendJson(response, 200, { [collectionKey]: nextEntries });
    return;
  }

  sendJson(response, 405, { error: "Method not allowed" });
};

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
  const pathname = requestUrl.pathname;

  try {
    if (request.method === "GET" && pathname === "/api/skills") {
      const categories = [...new Set(skillCatalog.map((s) => s.category).filter(Boolean))];
      sendJson(response, 200, {
        skills: skillCatalog,
        categories,
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/plugins") {
      const pluginList = plugins.map((plugin) => {
        const state = pluginState[plugin.manifest.id];
        const manifestEnabled = plugin.manifest.enabled !== false;
        const userOverride = state && typeof state.enabled === "boolean";
        const effectiveEnabled = userOverride ? state.enabled : manifestEnabled;

        return {
          id: plugin.manifest.id,
          label: plugin.manifest.label,
          version: plugin.manifest.version,
          description: plugin.manifest.description ?? "",
          author: plugin.manifest.author,
          manifestEnabled,
          enabled: effectiveEnabled,
          stateSource: userOverride ? "user" : "manifest",
          permissions: plugin.manifest.permissions ?? [],
          dependencies: plugin.manifest.dependencies ?? [],
          compatibility: plugin.manifest.compatibility ?? null,
          nodeTypes: plugin.manifest.nodes.map((node) => node.type),
        };
      });

      // Also add skill plugin entries
      try {
        const skillDirs = await readdir(pluginsDir, { withFileTypes: true });
        for (const dirEntry of skillDirs.filter((c) => c.isDirectory())) {
          const skillManifestPath = join(pluginsDir, dirEntry.name, "skill.plugin.json");
          try {
            const skillManifest = JSON.parse(await readFile(skillManifestPath, "utf8"));
            if (validateSkillPluginManifest(skillManifest).length > 0) continue;
            const state = pluginState[skillManifest.id];
            const manifestEnabled = skillManifest.enabled !== false;
            const userOverride = state && typeof state.enabled === "boolean";
            pluginList.push({
              id: skillManifest.id,
              label: skillManifest.label,
              version: skillManifest.version,
              description: skillManifest.description ?? "",
              author: skillManifest.author,
              kind: "skill-plugin",
              manifestEnabled,
              enabled: userOverride ? state.enabled : manifestEnabled,
              stateSource: userOverride ? "user" : "manifest",
              permissions: [],
              dependencies: [],
              compatibility: skillManifest.compatibility ?? null,
              skillCount: skillManifest.skills.length,
            });
          } catch { /* no skill.plugin.json in this directory */ }
        }
      } catch { /* ignore readdir errors */ }

      sendJson(response, 200, { plugins: pluginList });
      return;
    }

    const pluginActionMatch = pathname.match(/^\/api\/plugins\/([^/]+)\/(enable|disable)$/);
    if (pluginActionMatch && request.method === "POST") {
      const [, pluginId, action] = pluginActionMatch;

      const plugin = plugins.find((p) => p.manifest.id === pluginId);
      if (!plugin) {
        sendJson(response, 404, { error: `Plugin not found: ${pluginId}` });
        return;
      }

      const nextEnabled = action === "enable";
      pluginState[pluginId] = {
        ...(pluginState[pluginId] ?? {}),
        enabled: nextEnabled,
        updatedAt: new Date().toISOString(),
      };

      await savePluginState(pluginState);
      await reloadPluginRuntime();

      const updated = plugins.find((p) => p.manifest.id === pluginId);
      sendJson(response, 200, {
        id: pluginId,
        enabled: nextEnabled,
        manifestEnabled: plugin.manifest.enabled !== false,
        stateSource: "user",
        nodeTypes: updated ? updated.manifest.nodes.map((n) => n.type) : [],
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/nodes") {
      sendJson(response, 200, {
        nodes: Object.values(runtimeNodeCatalog),
        plugins: plugins.map((plugin) => ({
          id: plugin.manifest.id,
          label: plugin.manifest.label,
          version: plugin.manifest.version,
          description: plugin.manifest.description,
          permissions: plugin.manifest.permissions ?? [],
          dependencies: plugin.manifest.dependencies ?? [],
          nodeTypes: plugin.manifest.nodes.map((node) => node.type),
        })),
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/templates") {
      sendJson(response, 200, { templates: workflowTemplates });
      return;
    }

    if (request.method === "POST" && pathname === "/api/workflows/validate") {
      const body = await readJsonBody(request);
      sendJson(response, 200, { issues: validateWorkflow(body.workflow, runtimeNodeCatalog) });
      return;
    }

    if (request.method === "POST" && pathname === "/api/run-workflow") {
      const body = await readJsonBody(request);
      const result = await runWorkflow(
        body.workflow,
        await createExecutors(body.workflow),
        runtimeNodeCatalog,
      );
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && pathname === "/api/run-workflow-stream") {
      const body = await readJsonBody(request);
      response.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const executors = await createExecutors(body.workflow, (event) => {
        response.write(`${JSON.stringify({ type: "token", ...event })}\n`);
      });
      await runWorkflowStreaming(body.workflow, executors, (event) => {
        response.write(`${JSON.stringify(event)}\n`);
      });
      response.end();
      return;
    }

    if (request.method === "GET" && pathname === "/api/memories") {
      sendJson(response, 200, { memories: await readEntries(memoryFile) });
      return;
    }

    if (request.method === "POST" && pathname === "/api/memories") {
      await handleEntryCollection(request, response, memoryFile, "memories", "mem", "未命名记忆");
      return;
    }

    const memoryId = extractEntityId(pathname, "/api/memories");
    if (memoryId) {
      await handleEntryItem(request, response, memoryFile, "memories", memoryId);
      return;
    }

    if (request.method === "GET" && pathname === "/api/worldbook") {
      sendJson(response, 200, { entries: await readEntries(worldbookFile) });
      return;
    }

    if (request.method === "POST" && pathname === "/api/worldbook") {
      await handleEntryCollection(
        request,
        response,
        worldbookFile,
        "entries",
        "world",
        "未命名设定",
      );
      return;
    }

    const worldbookId = extractEntityId(pathname, "/api/worldbook");
    if (worldbookId) {
      await handleEntryItem(request, response, worldbookFile, "entries", worldbookId);
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    const staticPathname = pathname === "/" ? "/index.html" : pathname;
    const filePath = join(dist, staticPathname.replace(/^\/+/, ""));
    const contentType = contentTypes.get(extname(filePath)) ?? "application/octet-stream";

    await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentType });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (pathname.startsWith("/api/")) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Agent Workflow Platform running at http://${host}:${port}`);
  console.log(apiKey ? "DeepSeek Agent: enabled" : "DeepSeek Agent: missing DEEPSEEK_API_KEY");
});
