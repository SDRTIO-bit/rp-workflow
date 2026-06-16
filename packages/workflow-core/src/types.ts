import type { WorkflowTelemetrySink } from "./telemetry";
import type { WorkflowUsageBudgetController } from "./usageBudget";

export type DataType =
  | "text"
  | "user_input"
  | "context"
  | "search_result"
  | "analysis"
  | "draft"
  | "final_text"
  | "debug_info"
  | "json"
  | "memory"
  | "media_asset"
  | "video_composition"
  | "ui_spec"
  | "agent_tool"
  | "business_data"
  | "character_profile"
  | "scene_state";

export type PortDirection = "input" | "output";

// ============ Wire Types (P-1: Three-Wire Model) ============

/** Three-wire types for the platform. */
export type WireType = "json" | "markdown" | "text";

// ============ Port Definition — Discriminated Union ============

/** Legacy port: uses DataType (17 values). Preserved for backward compatibility. */
export type LegacyPortDefinition = {
  id: string;
  label: string;
  direction: PortDirection;
  dataType: DataType;
  schemaId?: string;
  required?: boolean;
};

/** Wire-native port: uses WireType (3 values). Added in P-1. */
export type WirePortDefinition = {
  id: string;
  label: string;
  direction: PortDirection;
  wireType: WireType;
  schemaId?: string;
  required?: boolean;
};

/** Port definition — discriminated union of legacy and wire-native ports. */
export type PortDefinition = LegacyPortDefinition | WirePortDefinition;

// ============ Type Guards ============

/** Check if a port is a legacy (DataType-based) port. */
export const isLegacyPort = (port: PortDefinition): port is LegacyPortDefinition =>
  "dataType" in port;

/** Check if a port is a wire-native (WireType-based) port. */
export const isWirePort = (port: PortDefinition): port is WirePortDefinition => "wireType" in port;

// ============ Wire Type Compatibility ============

/** Result of JSON schema compatibility check. */
export type SchemaCompatResult =
  | "compatible"
  | "compatible-with-runtime-validation"
  | "incompatible";

/** Resolve a port to its effective WireType.
 *  Wire ports return their wireType directly.
 *  Legacy ports are looked up in the mapping table.
 *  Unregistered legacy ports return undefined.
 */
export type PortWireTypeResolver = (nodeType: string, portId: string) => WireType | undefined;

/** Schema validator callback for runtime validation.
 *  Called when a JSON connection has schemaId mismatch that requires runtime checking.
 *  Returns true if the actual data satisfies the target schema at runtime.
 */
export type RuntimeSchemaValidator = (targetSchemaId: string, data: unknown) => boolean;

// ============ Legacy → Wire Mapping Table ============

/** Individual legacy port mapping entry. */
export type LegacyPortMapping = {
  nodeType: string;
  portId: string;
  wireType: WireType;
};

// ============ Localization ============

export type LocalizedText = {
  zh: string;
  en: string;
};

export type NodeConfigOption = {
  label: LocalizedText;
  value: string;
};

export type NodeConfigPreset = {
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  config: Record<string, unknown>;
};

export type NodeConfigField = {
  key: string;
  label: LocalizedText;
  kind:
    | "text"
    | "textarea"
    | "number"
    | "select"
    | "tags"
    | "boolean"
    | "multiselect"
    | "json"
    | "secret"
    | "model";
  min?: number;
  max?: number;
  options?: string[] | NodeConfigOption[];
  required?: boolean;
  placeholder?: LocalizedText;
  help?: LocalizedText;
  group?: string;
  groupLabel?: LocalizedText;
  advanced?: boolean;
  dependsOn?: {
    field: string;
    operator?: "equals" | "notEquals" | "includes" | "exists";
    value?: unknown;
  };
  source?: "static" | "models";
};

export type NodeDefinition = {
  type: string;
  label: string;
  labelI18n?: LocalizedText;
  category?: string;
  description?: string;
  descriptionI18n?: LocalizedText;
  color?: string;
  preview?: string;
  previewI18n?: LocalizedText;
  defaultConfig?: Record<string, unknown>;
  configFields?: NodeConfigField[];
  quickAdd?: boolean;
  panelLayout?: "agent" | "worldbook" | "memory" | "output" | "preview" | "generic";
  presets?: NodeConfigPreset[];
  ports: PortDefinition[];
};

export type NodeCatalog = Record<string, NodeDefinition>;

export type WorkflowNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type WorkflowValidationIssue = {
  level: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
  portId?: string;
};

export type WorkflowRunContext = {
  runId?: string;
  traceId?: string;
  sessionId?: string;
  telemetrySink?: WorkflowTelemetrySink;
  telemetryWarnings?: string[];
  telemetrySinkFailureMode?: "warn" | "error";
  usageBudgetController?: WorkflowUsageBudgetController;
  values?: Readonly<Record<string, unknown>>;
};

export type NodeExecutionInput = {
  node: WorkflowNode;
  inputs: Record<string, unknown>;
  context?: WorkflowRunContext;
};

export type NodeExecutionOutput = {
  outputs: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type NodeExecutor = (input: NodeExecutionInput) => Promise<NodeExecutionOutput>;

export type NodeRunResult = {
  nodeId: string;
  status: "success" | "error" | "blocked" | "skipped";
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  startedAt: number;
  endedAt: number;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type WorkflowRunResult = {
  workflowId: string;
  status: "success" | "error";
  batches: string[][];
  nodeRuns: NodeRunResult[];
  validationIssues: WorkflowValidationIssue[];
};
