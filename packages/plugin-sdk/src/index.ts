import type { NodeDefinition, NodeExecutor } from "@awp/workflow-core";

export type ToolCallInput = {
  toolId: string;
  input: unknown;
};

export type ToolCallResult = {
  ok: boolean;
  output?: unknown;
  error?: string;
};

export type ToolDefinition = {
  id: string;
  label: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  call?: (input: ToolCallInput) => Promise<ToolCallResult>;
};

export type PluginDefinition = {
  id: string;
  label: string;
  description: string;
  tools: ToolDefinition[];
};

export type PluginPermission =
  | "filesystem:read"
  | "filesystem:write"
  | "network"
  | "model:call"
  | "memory:read"
  | "memory:write"
  | "worldbook:read"
  | "worldbook:write";

export type PluginDependency = {
  id: string;
  versionRange?: string;
  optional?: boolean;
};

export type PluginCompatibility = {
  app?: string;
  workflowSchema?: number;
};

export type NodePluginManifest = {
  schemaVersion: 1;
  id: string;
  label: string;
  version: string;
  description?: string;
  author?: string;
  enabled?: boolean;
  compatibility?: PluginCompatibility;
  permissions?: PluginPermission[];
  dependencies?: PluginDependency[];
  nodes: NodeDefinition[];
  executor?: {
    adapter: "local-module" | "remote-http";
    entry: string;
  };
};

export type NodePluginRuntimeContext = {
  readMemories?: () => Promise<unknown[]>;
  readWorldbook?: () => Promise<unknown[]>;
  rankEntries?: (query: string, entries: unknown[], limit: number) => unknown[];
  serializeEntries?: (entries: unknown[]) => string;
  executeAgent?: (input: {
    nodeId: string;
    config: Record<string, unknown>;
    inputs: Record<string, unknown>;
  }) => Promise<{ text: string; metadata?: Record<string, unknown> }>;
  onToken?: (event: { nodeId: string; token: string }) => void;
};

export type MetadataEntryItem = {
  id: string;
  title: string;
  summary?: string;
  tags?: string[];
  metadata?: Record<string, string>;
};

export type MetadataStatPair = {
  label: string;
  value: string | number | boolean;
  tone?: "default" | "success" | "warning" | "danger";
};

export type MetadataTraceStep = {
  label: string;
  status?: "success" | "error" | "skipped";
  detail?: string;
  durationMs?: number;
};

export type NodeRunMetadataView =
  | { id: string; kind: "entry-list"; title: string; items: MetadataEntryItem[] }
  | { id: string; kind: "code"; title: string; content: string; language?: string }
  | { id: string; kind: "stats"; title: string; pairs: MetadataStatPair[] }
  | { id: string; kind: "text"; title: string; content: string }
  | { id: string; kind: "object"; title: string; value: Record<string, unknown> }
  | { id: string; kind: "trace"; title: string; steps: MetadataTraceStep[] };

export type NodeExecutorFactory = (
  context: NodePluginRuntimeContext,
) => Promise<Record<string, NodeExecutor>> | Record<string, NodeExecutor>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const validateNodePluginManifest = (manifest: unknown): string[] => {
  const issues: string[] = [];

  if (!isObject(manifest)) {
    return ["manifest must be an object"];
  }

  if (manifest.schemaVersion !== 1) {
    issues.push("schemaVersion must be 1");
  }

  for (const key of ["id", "label", "version"] as const) {
    if (typeof manifest[key] !== "string" || manifest[key].trim() === "") {
      issues.push(`${key} must be a non-empty string`);
    }
  }

  if (!Array.isArray(manifest.nodes)) {
    issues.push("nodes must be an array");
  } else {
    for (const [index, node] of manifest.nodes.entries()) {
      if (!isObject(node)) {
        issues.push(`nodes[${index}] must be an object`);
        continue;
      }
      if (typeof node.type !== "string" || node.type.trim() === "") {
        issues.push(`nodes[${index}].type must be a non-empty string`);
      }
      if (!Array.isArray(node.ports)) {
        issues.push(`nodes[${index}].ports must be an array`);
      }
    }
  }

  if (manifest.executor !== undefined) {
    if (!isObject(manifest.executor)) {
      issues.push("executor must be an object");
    } else {
      if (
        manifest.executor.adapter !== "local-module" &&
        manifest.executor.adapter !== "remote-http"
      ) {
        issues.push("executor.adapter must be local-module or remote-http");
      }
      if (typeof manifest.executor.entry !== "string" || manifest.executor.entry.trim() === "") {
        issues.push("executor.entry must be a non-empty string");
      }
    }
  }

  return issues;
};
