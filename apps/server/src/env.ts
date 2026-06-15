import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");

export type Env = {
  port: number;
  dataDir: string;
  pluginsDir: string;
  deepseekApiKey: string | undefined;
  deepseekModel: string;
  openCodeApiKey: string | undefined;
  openCodeModel: string;
  /** Explicit default provider. Does NOT auto-detect from available API keys. */
  defaultProviderId: string;
  nodeEnv: string;
  /** Workflow memory store backend: "in-memory" (default) or "file". */
  workflowMemoryStore: "in-memory" | "file";
  /** Directory for file-based memory store. Required when workflowMemoryStore is "file". */
  workflowMemoryDir: string;
  /** Official RP workflow version: "unified-v1" (default) or "legacy". */
  rpWorkflowVersion: "unified-v1" | "legacy";
};

export const resolveEnv = (): Env => ({
  port: Number(process.env.PORT ?? 5180),
  dataDir: process.env.DATA_DIR ?? resolve(__dirname, "..", "..", "..", "data"),
  pluginsDir: process.env.PLUGINS_DIR ?? resolve(__dirname, "..", "..", "..", "plugins"),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  openCodeApiKey: process.env.OPENCODE_API_KEY,
  openCodeModel: process.env.OPENCODE_MODEL ?? "deepseek-v4-flash",
  defaultProviderId: process.env.LLM_DEFAULT_PROVIDER ?? "deepseek",
  nodeEnv: process.env.NODE_ENV ?? "development",
  workflowMemoryStore: (process.env.WORKFLOW_MEMORY_STORE as "in-memory" | "file") ?? "in-memory",
  workflowMemoryDir: process.env.WORKFLOW_MEMORY_DIR ?? "",
  rpWorkflowVersion:
    (process.env.RP_WORKFLOW_VERSION as "unified-v1" | "legacy" | undefined) ?? "unified-v1",
});
