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
  | "media_asset"
  | "video_composition"
  | "ui_spec"
  | "agent_tool"
  | "business_data"
  | "character_profile"
  | "scene_state";

export type PortDirection = "input" | "output";

export type PortDefinition = {
  id: string;
  label: string;
  direction: PortDirection;
  dataType: DataType;
  required?: boolean;
};

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

export type NodeExecutionInput = {
  node: WorkflowNode;
  inputs: Record<string, unknown>;
};

export type NodeExecutionOutput = {
  outputs: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type NodeExecutor = (input: NodeExecutionInput) => Promise<NodeExecutionOutput>;

export type NodeRunResult = {
  nodeId: string;
  status: "success" | "error" | "blocked";
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
