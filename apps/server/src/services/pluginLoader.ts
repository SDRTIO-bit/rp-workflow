import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  validateNodePluginManifest,
  validateSkillPluginManifest,
  type NodePluginManifest,
  type SkillPluginManifest,
  type NodePluginRuntimeContext,
} from "@awp/plugin-sdk";
import type { NodeDefinition, NodeExecutor } from "@awp/workflow-core";

export type NodePlugin = {
  manifest: NodePluginManifest;
  baseDir: string;
};

export type SkillItem = {
  id: string;
  label: string;
  content: string;
  category?: string;
  tags?: string[];
  pluginId: string;
};

export type PluginSummary = {
  id: string;
  label: string;
  version: string;
  description: string;
  author?: string;
  manifestEnabled: boolean;
  enabled: boolean;
  stateSource: "user" | "manifest";
  permissions: string[];
  dependencies: unknown[];
  compatibility: unknown;
  nodeTypes: string[];
  kind?: string;
  skillCount?: number;
};

export type PluginState = Record<string, { enabled: boolean; updatedAt: string }>;

export const loadPluginState = async (pluginStateFile: string): Promise<PluginState> => {
  try {
    return JSON.parse(await readFile(pluginStateFile, "utf8"));
  } catch {
    return {};
  }
};

export const savePluginState = async (
  pluginStateFile: string,
  state: PluginState,
): Promise<void> => {
  await mkdir(dirname(pluginStateFile), { recursive: true });
  await writeFile(pluginStateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

export const loadNodePlugins = async (pluginsDir: string): Promise<NodePlugin[]> => {
  let entries = [];
  try {
    entries = await readdir(pluginsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const plugins: NodePlugin[] = [];

  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const manifestPath = join(pluginsDir, entry.name, "node.plugin.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as NodePluginManifest;
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
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err.code !== "ENOENT") {
        console.warn(`Skipped node plugin ${entry.name}: ${err.message ?? String(error)}`);
      }
    }
  }

  return plugins;
};

export const loadSkillPlugins = async (pluginsDir: string): Promise<SkillItem[]> => {
  let entries = [];
  try {
    entries = await readdir(pluginsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: SkillItem[] = [];

  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const manifestPath = join(pluginsDir, entry.name, "skill.plugin.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as SkillPluginManifest;
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
          label:
            typeof skill.label === "string"
              ? skill.label
              : (skill.label.zh ?? skill.label.en ?? ""),
          content:
            typeof skill.content === "string"
              ? skill.content
              : (skill.content.zh ?? skill.content.en ?? ""),
          category: skill.category,
          tags: skill.tags,
          pluginId: manifest.id,
        });
      }
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err.code !== "ENOENT") {
        console.warn(`Skipped skill plugin ${entry.name}: ${err.message ?? String(error)}`);
      }
    }
  }

  return skills;
};

export const createPluginCatalog = (plugins: NodePlugin[]): Record<string, NodeDefinition> =>
  Object.fromEntries(
    plugins.flatMap((plugin) => plugin.manifest.nodes.map((node) => [node.type, node])),
  );

export const createPluginExecutors = async (
  plugins: NodePlugin[],
  context: NodePluginRuntimeContext,
): Promise<Record<string, NodeExecutor>> => {
  const executors: Record<string, NodeExecutor> = {};

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

export const reloadPluginRuntime = async (
  pluginsDir: string,
  pluginState: PluginState,
): Promise<{
  plugins: NodePlugin[];
  pluginCatalog: Record<string, NodeDefinition>;
  skillCatalog: SkillItem[];
}> => {
  const plugins = await loadNodePlugins(pluginsDir);

  for (const plugin of plugins) {
    const state = pluginState[plugin.manifest.id];
    if (state && typeof state.enabled === "boolean") {
      plugin.manifest.enabled = state.enabled;
    }
  }

  const pluginCatalog = createPluginCatalog(plugins);
  const skillCatalog = await loadSkillPlugins(pluginsDir);

  return { plugins, pluginCatalog, skillCatalog };
};
