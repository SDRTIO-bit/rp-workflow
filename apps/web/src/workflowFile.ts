import { validateWorkflow, type WorkflowDefinition } from "@awp/workflow-core";

export const workflowExportKind = "agent-workflow-platform.workflow";
export const maxWorkflowImportBytes = 512 * 1024;

type WorkflowExportEnvelope = {
  kind: typeof workflowExportKind;
  version: 1;
  exportedAt: string;
  workflow: WorkflowDefinition;
};

type WorkflowImportResult =
  | { ok: true; workflow: WorkflowDefinition }
  | { ok: false; error: string };

export const exportWorkflowToJson = (
  workflow: WorkflowDefinition,
  exportedAt: Date = new Date(),
): string => {
  const envelope: WorkflowExportEnvelope = {
    kind: workflowExportKind,
    version: 1,
    exportedAt: exportedAt.toISOString(),
    workflow,
  };

  return JSON.stringify(envelope, null, 2);
};

export const importWorkflowFromJson = (content: string): WorkflowImportResult => {
  if (new Blob([content]).size > maxWorkflowImportBytes) {
    return { ok: false, error: "Workflow file is too large." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, error: "Workflow file is not valid JSON." };
  }

  const workflow = extractWorkflow(parsed);
  if (!isWorkflowDefinition(workflow)) {
    return { ok: false, error: "Workflow file shape is invalid." };
  }

  const issues = validateWorkflow(workflow);
  const firstError = issues.find((issue) => issue.level === "error");
  if (firstError) {
    return { ok: false, error: firstError.message };
  }

  return { ok: true, workflow };
};

const extractWorkflow = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.kind === workflowExportKind && "workflow" in value) {
    return value.workflow;
  }

  if ("workflow" in value && isRecord(value.workflow)) {
    return value.workflow;
  }

  return value;
};

const isWorkflowDefinition = (value: unknown): value is WorkflowDefinition => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.version === "number" &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isWorkflowNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isWorkflowEdge)
  );
};

const isWorkflowNode = (value: unknown) => {
  if (!isRecord(value) || !isRecord(value.position) || !isRecord(value.config)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.position.x === "number" &&
    typeof value.position.y === "number"
  );
};

const isWorkflowEdge = (value: unknown) =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.source === "string" &&
  typeof value.sourcePort === "string" &&
  typeof value.target === "string" &&
  typeof value.targetPort === "string";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
