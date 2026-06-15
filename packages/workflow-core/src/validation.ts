import {
  areTypesCompatible,
  areWireTypesCompatible,
  checkSchemaCompatibility,
  findPortInCatalog,
  nodeRegistry,
  resolvePortWireType,
  validatePortSchemaId,
} from "./nodeRegistry";
import { isLegacyPort, isWirePort } from "./types";
import type { NodeCatalog, WorkflowDefinition, WorkflowValidationIssue } from "./types";

export const validateWorkflow = (
  workflow: WorkflowDefinition,
  catalog: NodeCatalog = nodeRegistry,
): WorkflowValidationIssue[] => {
  const issues: WorkflowValidationIssue[] = [];
  const nodeIds = new Set<string>();

  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({ level: "error", message: `Duplicate node id: ${node.id}`, nodeId: node.id });
    }
    nodeIds.add(node.id);

    if (!catalog[node.type]) {
      issues.push({ level: "error", message: `Unknown node type: ${node.type}`, nodeId: node.id });
    }
  }

  for (const edge of workflow.edges) {
    const source = workflow.nodes.find((node) => node.id === edge.source);
    const target = workflow.nodes.find((node) => node.id === edge.target);

    if (!source) {
      issues.push({
        level: "error",
        message: `Missing source node: ${edge.source}`,
        edgeId: edge.id,
      });
      continue;
    }

    if (!target) {
      issues.push({
        level: "error",
        message: `Missing target node: ${edge.target}`,
        edgeId: edge.id,
      });
      continue;
    }

    const sourcePort = findPortInCatalog(catalog, source.type, edge.sourcePort, "output");
    const targetPort = findPortInCatalog(catalog, target.type, edge.targetPort, "input");

    if (!sourcePort) {
      issues.push({
        level: "error",
        message: `Missing output port: ${edge.sourcePort}`,
        edgeId: edge.id,
        nodeId: source.id,
        portId: edge.sourcePort,
      });
      continue;
    }

    if (!targetPort) {
      issues.push({
        level: "error",
        message: `Missing input port: ${edge.targetPort}`,
        edgeId: edge.id,
        nodeId: target.id,
        portId: edge.targetPort,
      });
      continue;
    }

    // Validate schemaId constraints
    const sourceSchemaError = validatePortSchemaId(sourcePort);
    if (sourceSchemaError) {
      issues.push({
        level: "error",
        message: sourceSchemaError,
        nodeId: source.id,
        portId: sourcePort.id,
      });
    }

    const targetSchemaError = validatePortSchemaId(targetPort);
    if (targetSchemaError) {
      issues.push({
        level: "error",
        message: targetSchemaError,
        nodeId: target.id,
        portId: targetPort.id,
      });
    }

    // Determine compatibility path based on port types
    const sourceIsWire = isWirePort(sourcePort);
    const targetIsWire = isWirePort(targetPort);
    const sourceIsLegacy = isLegacyPort(sourcePort);
    const targetIsLegacy = isLegacyPort(targetPort);

    if (sourceIsLegacy && targetIsLegacy) {
      // Legacy → Legacy: use old areTypesCompatible
      if (
        !areTypesCompatible(
          sourcePort.dataType,
          targetPort.dataType,
          sourcePort.schemaId,
          targetPort.schemaId,
        )
      ) {
        const schemaInfo =
          sourcePort.schemaId || targetPort.schemaId
            ? ` [source schemaId: ${sourcePort.schemaId ?? "none"}, target schemaId: ${targetPort.schemaId ?? "none"}]`
            : "";
        issues.push({
          level: "error",
          message: `Incompatible edge types: ${sourcePort.dataType} -> ${targetPort.dataType}${schemaInfo}`,
          edgeId: edge.id,
        });
      }
    } else if (sourceIsWire && targetIsWire) {
      // Wire → Wire: use strict areWireTypesCompatible + schema check
      if (!areWireTypesCompatible(sourcePort.wireType, targetPort.wireType)) {
        issues.push({
          level: "error",
          message: `Incompatible wire types: ${sourcePort.wireType} -> ${targetPort.wireType}`,
          edgeId: edge.id,
        });
      } else if (sourcePort.wireType === "json" && targetPort.wireType === "json") {
        // Same wire type JSON → check schema compatibility
        const schemaResult = checkSchemaCompatibility(sourcePort.schemaId, targetPort.schemaId);
        if (schemaResult === "incompatible") {
          issues.push({
            level: "error",
            message: `Incompatible JSON schemas: source=${sourcePort.schemaId ?? "none"}, target=${targetPort.schemaId ?? "none"}`,
            edgeId: edge.id,
          });
        }
        // "compatible-with-runtime-validation" is not a validation error — it's a runtime concern
      }
    } else {
      // Mixed: try to resolve legacy port to wire type
      const sourceWireType = sourceIsWire
        ? sourcePort.wireType
        : resolvePortWireType(source.type, sourcePort.id);
      const targetWireType = targetIsWire
        ? targetPort.wireType
        : resolvePortWireType(target.type, targetPort.id);

      if (!sourceWireType || !targetWireType) {
        const unresolvable = !sourceWireType
          ? `${source.type}.${sourcePort.id}`
          : `${target.type}.${targetPort.id}`;
        issues.push({
          level: "error",
          message: `Cannot connect legacy port to wire-native port: ${unresolvable} has no wire type mapping`,
          edgeId: edge.id,
        });
      } else if (!areWireTypesCompatible(sourceWireType, targetWireType)) {
        issues.push({
          level: "error",
          message: `Incompatible resolved wire types: ${source.type}.${sourcePort.id} (${sourceWireType}) -> ${target.type}.${targetPort.id} (${targetWireType})`,
          edgeId: edge.id,
        });
      }
    }
  }

  if (hasCycle(workflow)) {
    issues.push({ level: "error", message: "Workflow graph contains a cycle" });
  }

  return issues;
};

export const hasCycle = (workflow: WorkflowDefinition): boolean => {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const adjacency = new Map<string, string[]>();

  for (const node of workflow.nodes) {
    adjacency.set(node.id, []);
  }

  for (const edge of workflow.edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }

    visiting.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  return workflow.nodes.some((node) => visit(node.id));
};
