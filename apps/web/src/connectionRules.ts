import {
  areTypesCompatible,
  areWireTypesCompatible,
  findPortInCatalog,
  isLegacyPort,
  isWirePort,
  nodeRegistry,
  type NodeCatalog,
  type WorkflowDefinition,
  type WorkflowEdge,
} from "@awp/workflow-core";
import { getPortPresentation } from "./portPresentation";

export type ConnectionCandidate = Omit<WorkflowEdge, "id">;
export type ConnectionEvaluation = { ok: true } | { ok: false; reason: string };

export const evaluateConnection = (
  workflow: WorkflowDefinition,
  candidate: ConnectionCandidate,
  catalog: NodeCatalog = nodeRegistry,
): ConnectionEvaluation => {
  if (candidate.source === candidate.target) {
    return { ok: false, reason: "不能把节点连接到自己。" };
  }

  const sourceNode = workflow.nodes.find((node) => node.id === candidate.source);
  const targetNode = workflow.nodes.find((node) => node.id === candidate.target);
  if (!sourceNode || !targetNode) {
    return { ok: false, reason: "找不到连线的源节点或目标节点。" };
  }

  const sourcePort = findPortInCatalog(catalog, sourceNode.type, candidate.sourcePort, "output");
  const targetPort = findPortInCatalog(catalog, targetNode.type, candidate.targetPort, "input");
  if (!sourcePort || !targetPort) {
    return { ok: false, reason: "找不到匹配的输入或输出端口。" };
  }

  if (
    workflow.edges.some(
      (edge) => edge.target === candidate.target && edge.targetPort === candidate.targetPort,
    )
  ) {
    return { ok: false, reason: "目标输入端口已经被占用。" };
  }

  // Determine compatibility based on port types
  let compatible: boolean;
  if (isLegacyPort(sourcePort) && isLegacyPort(targetPort)) {
    compatible = areTypesCompatible(sourcePort.dataType, targetPort.dataType);
  } else if (isWirePort(sourcePort) && isWirePort(targetPort)) {
    compatible = areWireTypesCompatible(sourcePort.wireType, targetPort.wireType);
  } else {
    // Mixed legacy/wire — cannot connect directly in the UI
    compatible = false;
  }

  if (!compatible) {
    const sourceType = getPortPresentation(sourcePort).labelZh;
    const targetType = getPortPresentation(targetPort).labelZh;
    return { ok: false, reason: `端口类型不兼容：${sourceType} 不能连接到 ${targetType}。` };
  }

  return { ok: true };
};
