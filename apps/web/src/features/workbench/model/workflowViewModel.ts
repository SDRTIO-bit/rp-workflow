import {
  findPortInCatalog,
  isWirePort,
  type NodeCatalog,
  type NodeRunResult,
  type PortDefinition,
  type WorkflowDefinition,
} from "@awp/workflow-core";
import { getPortPresentation } from "../../../portPresentation";
import { getEdgeVisualClass, getEdgeVisualLabel } from "./edgeVisuals";

export type PortViewModel = {
  id: string;
  label: string;
  direction: "input" | "output";
  required: boolean;
  schemaId?: string;
  typeLabel: string;
  typeColor: string;
  raw: PortDefinition;
};

export type WorkflowNodeViewModel = {
  id: string;
  type: string;
  title: string;
  category: string;
  description: string;
  summary: string[];
  position: { x: number; y: number };
  inputs: PortViewModel[];
  outputs: PortViewModel[];
  runStatus?: NodeRunResult["status"];
};

export type WorkflowEdgeViewModel = {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
  visualClass: string;
  label: string;
};

export type WorkflowViewModel = {
  nodes: WorkflowNodeViewModel[];
  edges: WorkflowEdgeViewModel[];
};

export const createWorkflowViewModel = (
  workflow: WorkflowDefinition,
  catalog: NodeCatalog,
  runs: NodeRunResult[],
): WorkflowViewModel => {
  const runStatusByNode = new Map(runs.map((run) => [run.nodeId, run.status]));
  const nodes = workflow.nodes.map((node) => {
    const definition = catalog[node.type];
    const ports = definition?.ports ?? [];
    return {
      id: node.id,
      type: node.type,
      title: definition?.label ?? node.type,
      category: definition?.category ?? "unknown",
      description: definition?.description ?? "",
      summary: summarizeConfig(node.config),
      position: { ...node.position },
      inputs: ports.filter((port) => port.direction === "input").map(toPortViewModel),
      outputs: ports.filter((port) => port.direction === "output").map(toPortViewModel),
      runStatus: runStatusByNode.get(node.id),
    };
  });

  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const edges = workflow.edges.flatMap((edge) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode) return [];
    const sourcePort = findPortInCatalog(catalog, sourceNode.type, edge.sourcePort, "output");
    const targetPort = findPortInCatalog(catalog, targetNode.type, edge.targetPort, "input");
    if (!sourcePort || !targetPort) return [];
    return [
      {
        id: edge.id,
        source: edge.source,
        sourcePort: edge.sourcePort,
        target: edge.target,
        targetPort: edge.targetPort,
        visualClass: getEdgeVisualClass(sourcePort),
        label: getEdgeVisualLabel(sourcePort),
      },
    ];
  });

  return { nodes, edges };
};

const toPortViewModel = (port: PortDefinition): PortViewModel => {
  const presentation = getPortPresentation(port);
  return {
    id: port.id,
    label: port.label,
    direction: port.direction,
    required: port.required ?? false,
    ...(port.schemaId ? { schemaId: port.schemaId } : {}),
    typeLabel: isWirePort(port)
      ? presentation.labelEn.replace(" (Wire)", "")
      : presentation.labelEn,
    typeColor: presentation.color,
    raw: port,
  };
};

const summarizeConfig = (config: Record<string, unknown>): string[] =>
  Object.entries(config)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${formatSummaryValue(value)}`);

const formatSummaryValue = (value: unknown): string => {
  if (typeof value === "string") return value.length > 48 ? `${value.slice(0, 45)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} items`;
  return "configured";
};
