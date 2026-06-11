import { Hono } from "hono";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { validateSkillPluginManifest } from "@awp/plugin-sdk";
import {
  loadNodePlugins,
  loadSkillPlugins,
  loadPluginState,
  savePluginState,
  createPluginCatalog,
  reloadPluginRuntime,
  type NodePlugin,
  type PluginState,
  type PluginSummary,
  type SkillItem,
} from "../services/pluginLoader.js";
import { nodeRegistry } from "@awp/workflow-core";
import type { NodeCatalog } from "@awp/workflow-core";

export type PluginRuntime = {
  pluginState: PluginState;
  plugins: NodePlugin[];
  pluginCatalog: NodeCatalog;
  runtimeNodeCatalog: NodeCatalog;
  skillCatalog: SkillItem[];
};

export const createPluginsRoutes = (
  pluginsDir: string,
  pluginStateFile: string,
  getRuntime: () => PluginRuntime,
  setRuntime: (runtime: PluginRuntime) => void,
) => {
  const app = new Hono();

  app.get("/api/plugins", async (c) => {
    const runtime = getRuntime();
    const pluginList: PluginSummary[] = runtime.plugins.map((plugin) => {
      const state = runtime.pluginState[plugin.manifest.id];
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
          const skillManifest = JSON.parse(
            await import("node:fs/promises").then((fs) => fs.readFile(skillManifestPath, "utf8")),
          );
          if (validateSkillPluginManifest(skillManifest).length > 0) continue;
          const state = runtime.pluginState[skillManifest.id];
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
            nodeTypes: [],
            skillCount: skillManifest.skills.length,
          });
        } catch {
          /* no skill.plugin.json in this directory */
        }
      }
    } catch {
      /* ignore readdir errors */
    }

    return c.json({ plugins: pluginList });
  });

  app.post("/api/plugins/:id/enable", async (c) => {
    const pluginId = c.req.param("id");
    const runtime = getRuntime();

    const plugin = runtime.plugins.find((p) => p.manifest.id === pluginId);
    if (!plugin) {
      return c.json({ error: `Plugin not found: ${pluginId}` }, 404);
    }

    const nextEnabled = true;
    runtime.pluginState[pluginId] = {
      ...(runtime.pluginState[pluginId] ?? {}),
      enabled: nextEnabled,
      updatedAt: new Date().toISOString(),
    };

    await savePluginState(pluginStateFile, runtime.pluginState);
    const newRuntime = await reloadPluginRuntime(pluginsDir, runtime.pluginState);
    setRuntime({
      ...runtime,
      ...newRuntime,
      runtimeNodeCatalog: { ...nodeRegistry, ...newRuntime.pluginCatalog },
    });

    const updated = newRuntime.plugins.find((p) => p.manifest.id === pluginId);
    return c.json({
      id: pluginId,
      enabled: nextEnabled,
      manifestEnabled: plugin.manifest.enabled !== false,
      stateSource: "user",
      nodeTypes: updated ? updated.manifest.nodes.map((n) => n.type) : [],
    });
  });

  app.post("/api/plugins/:id/disable", async (c) => {
    const pluginId = c.req.param("id");
    const runtime = getRuntime();

    const plugin = runtime.plugins.find((p) => p.manifest.id === pluginId);
    if (!plugin) {
      return c.json({ error: `Plugin not found: ${pluginId}` }, 404);
    }

    const nextEnabled = false;
    runtime.pluginState[pluginId] = {
      ...(runtime.pluginState[pluginId] ?? {}),
      enabled: nextEnabled,
      updatedAt: new Date().toISOString(),
    };

    await savePluginState(pluginStateFile, runtime.pluginState);
    const newRuntime = await reloadPluginRuntime(pluginsDir, runtime.pluginState);
    setRuntime({
      ...runtime,
      ...newRuntime,
      runtimeNodeCatalog: { ...nodeRegistry, ...newRuntime.pluginCatalog },
    });

    const updated = newRuntime.plugins.find((p) => p.manifest.id === pluginId);
    return c.json({
      id: pluginId,
      enabled: nextEnabled,
      manifestEnabled: plugin.manifest.enabled !== false,
      stateSource: "user",
      nodeTypes: updated ? updated.manifest.nodes.map((n) => n.type) : [],
    });
  });

  return app;
};
