import type { NodeRunResult, WorkflowDefinition, WorkflowRunResult } from "@awp/workflow-core";
import type { NodeDefinition } from "@awp/workflow-core";
import type { WorkflowTemplate } from "./state/sampleWorkflows";

type Fetcher = typeof fetch;

export type WorkflowStreamEvent =
  | { type: "nodeRun"; run: NodeRunResult }
  | { type: "done"; result: WorkflowRunResult }
  | { type: "token"; nodeId: string; token: string }
  | { type: "error"; error: string };

export const runWorkflowViaServer = async (
  workflow: WorkflowDefinition,
  fetcher: Fetcher = fetch,
): Promise<WorkflowRunResult | undefined> => {
  try {
    const response = await fetcher("/api/run-workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow }),
    });

    if (!response.ok) {
      return undefined;
    }

    return (await response.json()) as WorkflowRunResult;
  } catch {
    return undefined;
  }
};

export const loadNodeManifestsViaServer = async (
  fetcher: Fetcher = fetch,
): Promise<NodeDefinition[] | undefined> => {
  try {
    const response = await fetcher("/api/nodes");
    if (!response.ok) {
      return undefined;
    }
    return ((await response.json()) as { nodes: NodeDefinition[] }).nodes;
  } catch {
    return undefined;
  }
};

export const loadWorkflowTemplatesViaServer = async (
  fetcher: Fetcher = fetch,
): Promise<WorkflowTemplate[] | undefined> => {
  try {
    const response = await fetcher("/api/templates");
    if (!response.ok) {
      return undefined;
    }
    return ((await response.json()) as { templates: WorkflowTemplate[] }).templates;
  } catch {
    return undefined;
  }
};

export const runWorkflowStreamViaServer = async (
  workflow: WorkflowDefinition,
  onEvent: (event: WorkflowStreamEvent) => void,
  fetcher: Fetcher = fetch,
): Promise<WorkflowRunResult | undefined> => {
  try {
    const response = await fetcher("/api/run-workflow-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow }),
    });

    if (!response.ok || !response.body) {
      return undefined;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: WorkflowRunResult | undefined;

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        const event = JSON.parse(line) as WorkflowStreamEvent;
        onEvent(event);
        if (event.type === "done") {
          finalResult = event.result;
        }
      }

      if (done) {
        break;
      }
    }

    if (buffer.trim()) {
      const event = JSON.parse(buffer) as WorkflowStreamEvent;
      onEvent(event);
      if (event.type === "done") {
        finalResult = event.result;
      }
    }

    return finalResult;
  } catch {
    return undefined;
  }
};

export type PluginSummary = {
  id: string;
  label: string;
  version: string;
  description: string;
  author?: string;
  manifestEnabled: boolean;
  enabled: boolean;
  stateSource: "manifest" | "user";
  permissions: string[];
  dependencies: { id: string; versionRange?: string; optional?: boolean }[];
  compatibility: { app?: string; workflowSchema?: number } | null;
  nodeTypes: string[];
};

export const loadPluginsViaServer = async (
  fetcher: Fetcher = fetch,
): Promise<PluginSummary[] | undefined> => {
  try {
    const response = await fetcher("/api/plugins");
    if (!response.ok) return undefined;
    return ((await response.json()) as { plugins: PluginSummary[] }).plugins;
  } catch {
    return undefined;
  }
};

export const enablePluginViaServer = async (
  pluginId: string,
  fetcher: Fetcher = fetch,
): Promise<PluginSummary | undefined> => {
  try {
    const response = await fetcher(`/api/plugins/${encodeURIComponent(pluginId)}/enable`, {
      method: "POST",
    });
    if (!response.ok) return undefined;
    return (await response.json()) as PluginSummary;
  } catch {
    return undefined;
  }
};

export const disablePluginViaServer = async (
  pluginId: string,
  fetcher: Fetcher = fetch,
): Promise<PluginSummary | undefined> => {
  try {
    const response = await fetcher(`/api/plugins/${encodeURIComponent(pluginId)}/disable`, {
      method: "POST",
    });
    if (!response.ok) return undefined;
    return (await response.json()) as PluginSummary;
  } catch {
    return undefined;
  }
};
