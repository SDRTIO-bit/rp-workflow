import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");

/**
 * Built-in RP provider ids.
 *
 * - `mock`: in-process deterministic adapter; only accepts model "mock-model".
 * - `deepseek`: real DeepSeek API; rejects model "mock-model".
 * - `opencode`: real OpenCode Go API; rejects model "mock-model".
 *
 * Custom (unknown) provider ids are allowed and bypass the model compatibility
 * rules because they have no built-in defaults.
 */
export type BuiltinProviderId = "mock" | "deepseek" | "opencode";

/**
 * Mock provider's only accepted model identifier.
 * This is the single source of truth for the mock-model constant.
 */
export const MOCK_MODEL = "mock-model";

export type Env = {
  port: number;
  dataDir: string;
  pluginsDir: string;
  deepseekApiKey: string | undefined;
  deepseekModel: string;
  openCodeApiKey: string | undefined;
  openCodeModel: string;
  nodeEnv: string;
  /** Unified RP provider id for the single RP routing path. */
  rpProviderId: string;
  /** Model to use for RP when rpProviderId is the active provider. */
  rpModel: string;
  /** Whether mock integration mode was opted in explicitly via RP_MOCK=1. */
  rpMockOptIn: boolean;
  /** Workflow memory store backend: "in-memory" (default) or "file". */
  workflowMemoryStore: "in-memory" | "file";
  /** Directory for file-based memory store. Required when workflowMemoryStore is "file". */
  workflowMemoryDir: string;
  /** Agent session store backend: "in-memory" (default) or "file". */
  agentSessionStore: "in-memory" | "file";
  /** Directory for file-based agent session store. Required when agentSessionStore is "file". */
  agentSessionDir: string;
  /** Official RP workflow version: "unified-v1" (default) or "legacy". */
  rpWorkflowVersion: "unified-v1" | "legacy";
};

/**
 * Resolve the effective (providerId, model) pair with strict compatibility rules.
 *
 * Rules:
 * - `mock` provider: rpModel MUST be "mock-model" (or unset → defaults to it).
 * - `deepseek` / `opencode` provider: rpModel MUST NOT be "mock-model".
 * - Unknown provider ids: no built-in constraints; pass through.
 *
 * Throws on incompatible pairs with a message that names both the provider and
 * the offending model, so the user can fix their env without guessing.
 */
function resolveRpModel(
  providerId: string,
  modelOverride: string | undefined,
  deepseekModel: string,
  openCodeModel: string,
): string {
  if (providerId === "mock") {
    if (modelOverride !== undefined && modelOverride !== MOCK_MODEL) {
      throw new Error(
        `RP provider "mock" only accepts model "${MOCK_MODEL}", ` +
          `but RP_MODEL="${modelOverride}" was set. ` +
          `Either unset RP_MODEL or use RP_PROVIDER=deepseek for real LLM.`,
      );
    }
    return MOCK_MODEL;
  }

  if (providerId === "deepseek" || providerId === "opencode") {
    if (modelOverride === MOCK_MODEL) {
      throw new Error(
        `RP provider "${providerId}" cannot use model "${MOCK_MODEL}". ` +
          `The mock model is reserved for the built-in mock provider. ` +
          `Unset RP_MODEL to use the provider's default model.`,
      );
    }
    if (modelOverride !== undefined) {
      return modelOverride;
    }
    return providerId === "deepseek" ? deepseekModel : openCodeModel;
  }

  // Custom provider — no built-in constraint. Fall back to deepseekModel if
  // nothing was set, so the value is always a non-empty string.
  return modelOverride ?? deepseekModel;
}

export const resolveEnv = (): Env => {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const deepseekModel = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

  // RP_MOCK=1 is the explicit opt-in for the mock integration path.
  // It is the only acceptable way to use the mock provider in production-like
  // scenarios and must be paired with a non-production NODE_ENV.
  const rpMockOptIn = process.env.RP_MOCK === "1";
  if (rpMockOptIn && nodeEnv === "production") {
    throw new Error(
      `Refusing to start: RP_MOCK=1 is set together with NODE_ENV=production. ` +
        `The mock provider is not allowed in production. ` +
        `Either unset RP_MOCK or set NODE_ENV to a non-production value.`,
    );
  }

  // Resolve rpProviderId.
  //
  // Priority:
  //   1. RP_PROVIDER env (most explicit).
  //   2. RP_MOCK=1 forces "mock".
  //   3. LLM_DEFAULT_PROVIDER env (legacy fallback).
  //   4. NODE_ENV-based default: production → "deepseek", otherwise → "mock".
  //
  // When the implicit dev → "mock" default is used, we surface a warning so
  // operators know to set RP_PROVIDER or RP_MOCK=1 explicitly. The warning
  // does NOT block startup because dev ergonomics are still valuable.
  let rpProviderId: string;
  if (process.env.RP_PROVIDER) {
    rpProviderId = process.env.RP_PROVIDER;
  } else if (rpMockOptIn) {
    rpProviderId = "mock";
  } else if (process.env.LLM_DEFAULT_PROVIDER) {
    rpProviderId = process.env.LLM_DEFAULT_PROVIDER;
  } else {
    rpProviderId = nodeEnv === "production" ? "deepseek" : "mock";
    if (rpProviderId === "mock") {
      console.warn(
        `[env] RP provider defaulted to "mock" (NODE_ENV=${nodeEnv}). ` +
          `For explicit opt-in, set RP_MOCK=1. ` +
          `To use a real LLM, set RP_PROVIDER=deepseek (with DEEPSEEK_API_KEY).`,
      );
    }
  }

  const rpModel = resolveRpModel(
    rpProviderId,
    process.env.RP_MODEL,
    deepseekModel,
    process.env.OPENCODE_MODEL ?? "deepseek-v4-flash",
  );

  return {
    port: Number(process.env.PORT ?? 5180),
    dataDir: process.env.DATA_DIR ?? resolve(__dirname, "..", "..", "..", "data"),
    pluginsDir: process.env.PLUGINS_DIR ?? resolve(__dirname, "..", "..", "..", "plugins"),
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    deepseekModel,
    openCodeApiKey: process.env.OPENCODE_API_KEY,
    openCodeModel: process.env.OPENCODE_MODEL ?? "deepseek-v4-flash",
    nodeEnv,
    rpProviderId,
    rpModel,
    rpMockOptIn,
    workflowMemoryStore: (process.env.WORKFLOW_MEMORY_STORE as "in-memory" | "file") ?? "in-memory",
    workflowMemoryDir: process.env.WORKFLOW_MEMORY_DIR ?? "",
    agentSessionStore: (process.env.AGENT_SESSION_STORE as "in-memory" | "file") ?? "in-memory",
    agentSessionDir: process.env.AGENT_SESSION_DIR ?? "",
    rpWorkflowVersion:
      (process.env.RP_WORKFLOW_VERSION as "unified-v1" | "legacy" | undefined) ?? "unified-v1",
  };
};
