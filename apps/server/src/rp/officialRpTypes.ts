/**
 * P-12: Official RP Request & Response Types
 *
 * Stable API contracts exposed to clients.
 * Internal workflow node IDs are NOT part of this contract.
 */

// ── Request ──

export type OfficialRpRequestV1 = {
  sessionId: string;
  turnId: string;

  /** Player input text; may be empty for "continue" scenarios */
  userInput: string;

  worldbook: {
    resourceRef: string;
  };

  memory: {
    namespace: string;
  };

  preset?: {
    text?: string;
  };

  model?: {
    providerId?: string;
    model?: string;
    temperature?: number;
  };

  behavior?: {
    onExhausted?: "return-latest" | "fail";
  };

  /** Per-request workflow version override (allowed values only) */
  workflowVersion?: "unified-v1" | "legacy";
};

// ── Response ──

export type OfficialRpResponseV1 = {
  /** Final visible narrative for the player */
  narrative: string;

  sessionId: string;
  turnId: string;

  workflow: {
    id: string;
    version: number;
    mode: "unified-v1" | "legacy";
  };

  quality?: {
    accepted: boolean;
    exhausted: boolean;
    writerAttempts: number;
    criticAttempts: number;
    revisionApplied: boolean;
  };

  sessionCommit?: {
    committed: boolean;
    deduplicated: boolean;
    conflict?: boolean;
  };

  memoryCommit?: {
    attempted: boolean;
    skipped: boolean;
    written: number;
    deduplicated: boolean;
  };

  traceId: string;
};

// ── Service context ──

export type OfficialRpServiceContext = {
  /** Server-configured workflow version */
  serverWorkflowVersion: "unified-v1" | "legacy";

  /** LLM Router for provider resolution */
  llmRouter: import("@awp/agent-runtime").LlmRouter;

  /** Profile registry for specialized agents */
  profileRegistry: import("@awp/agent-runtime").SpecializedAgentProfileRegistry;

  /** Session, Memory, Worldbook stores */
  sessionStore: import("@awp/agent-runtime").AgentSessionStore;
  memoryStore: import("@awp/workflow-memory").WorkflowMemoryStore;
  worldbookStore: import("@awp/workflow-worldbook").DynamicWorldbookStore;

  /** Node catalog for validation */
  runtimeNodeCatalog: import("@awp/workflow-core").NodeCatalog;

  /** Workflow data directory */
  dataDir: string;

  /** Legacy RP path executor (for legacy fallback) */
  legacyRpExecutor?: LegacyRpExecutor;
};

export type LegacyRpExecutor = (request: OfficialRpRequestV1) => Promise<OfficialRpResponseV1>;
