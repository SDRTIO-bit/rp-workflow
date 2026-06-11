import { Hono } from "hono";
import type { NodeCatalog } from "@awp/workflow-core";
import type { NodePlugin } from "../services/pluginLoader.js";

export type NodesRuntime = {
  runtimeNodeCatalog: NodeCatalog;
  plugins: NodePlugin[];
};

export const createNodesRoutes = (getRuntime: () => NodesRuntime) => {
  const app = new Hono();

  app.get("/api/nodes", async (c) => {
    const runtime = getRuntime();
    return c.json({
      nodes: Object.values(runtime.runtimeNodeCatalog),
      plugins: runtime.plugins.map((plugin) => ({
        id: plugin.manifest.id,
        label: plugin.manifest.label,
        version: plugin.manifest.version,
        description: plugin.manifest.description,
        permissions: plugin.manifest.permissions ?? [],
        dependencies: plugin.manifest.dependencies ?? [],
        nodeTypes: plugin.manifest.nodes.map((node) => node.type),
      })),
    });
  });

  return app;
};
