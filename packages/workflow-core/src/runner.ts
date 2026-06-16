import { createExecutionBatches } from "./scheduler.js";
import { validateWorkflow } from "./validation.js";
import { nodeRegistry, getRuntimeSchemaValidator } from "./nodeRegistry.js";
import type {
  NodeCatalog,
  NodeExecutor,
  NodeRunResult,
  WorkflowDefinition,
  WorkflowRunContext,
  WorkflowRunResult,
} from "./types.js";
import { isWirePort } from "./types.js";
import { findPortInCatalog, checkSchemaCompatibility } from "./nodeRegistry.js";

export const runWorkflow = async (
  workflow: WorkflowDefinition,
  executors: Record<string, NodeExecutor>,
  catalog: NodeCatalog = nodeRegistry,
  context?: WorkflowRunContext,
): Promise<WorkflowRunResult> => {
  const validationIssues = validateWorkflow(workflow, catalog);
  const errorIssues = validationIssues.filter((issue) => issue.level === "error");

  if (errorIssues.length > 0) {
    return {
      workflowId: workflow.id,
      status: "error",
      batches: [],
      nodeRuns: [],
      validationIssues,
    };
  }

  const batches = createExecutionBatches(workflow);
  const outputsByNode = new Map<string, Record<string, unknown>>();
  const nodeRuns: NodeRunResult[] = [];
  let hasError = false;

  for (const batch of batches) {
    const batchRuns = await Promise.all(
      batch.map(async (nodeId): Promise<NodeRunResult> => {
        const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) {
          throw new Error(`Missing scheduled node ${nodeId}`);
        }

        const inputs = collectInputs(workflow, nodeId, outputsByNode);
        const startedAt = Date.now();

        // Runtime schema validation for JSON edges with compatible-with-runtime-validation
        const schemaError = validateRuntimeSchemas(
          workflow,
          nodeId,
          inputs,
          outputsByNode,
          catalog,
        );
        if (schemaError) {
          hasError = true;
          return {
            nodeId,
            status: "error",
            inputs,
            outputs: {},
            startedAt,
            endedAt: Date.now(),
            error: schemaError,
          };
        }

        try {
          const executor = executors[node.type] ?? defaultExecutor;
          const result = await executor({ node, inputs, context });
          outputsByNode.set(nodeId, result.outputs);

          return {
            nodeId,
            status: "success",
            inputs,
            outputs: result.outputs,
            metadata: result.metadata,
            startedAt,
            endedAt: Date.now(),
          };
        } catch (error) {
          hasError = true;
          return {
            nodeId,
            status: "error",
            inputs,
            outputs: {},
            startedAt,
            endedAt: Date.now(),
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    nodeRuns.push(...batchRuns);
    if (hasError) {
      break;
    }
  }

  return {
    workflowId: workflow.id,
    status: hasError ? "error" : "success",
    batches,
    nodeRuns,
    validationIssues,
  };
};

const collectInputs = (
  workflow: WorkflowDefinition,
  nodeId: string,
  outputsByNode: Map<string, Record<string, unknown>>,
): Record<string, unknown> => {
  const inputs: Record<string, unknown> = {};

  for (const edge of workflow.edges.filter((candidate) => candidate.target === nodeId)) {
    inputs[edge.targetPort] = outputsByNode.get(edge.source)?.[edge.sourcePort];
  }

  return inputs;
};

const defaultExecutor: NodeExecutor = async ({ node, inputs }) => ({
  outputs: {
    result: `Node ${node.id} received ${JSON.stringify(inputs)}`,
    text: `Node ${node.id} received ${JSON.stringify(inputs)}`,
    final: `Node ${node.id} received ${JSON.stringify(inputs)}`,
  },
});

// ============ Branch-Aware Execution (P-10) ============

/**
 * Compute the set of node IDs reachable from a given source through a specific port.
 * Follows edges from source:sourcePort to downstream targets, transitively.
 */
function reachableFromPort(
  workflow: WorkflowDefinition,
  sourceNodeId: string,
  sourcePortId: string,
): Set<string> {
  const reachable = new Set<string>();
  const queue: string[] = [];

  // Find initial targets
  for (const edge of workflow.edges) {
    if (edge.source === sourceNodeId && edge.sourcePort === sourcePortId) {
      if (!reachable.has(edge.target)) {
        reachable.add(edge.target);
        queue.push(edge.target);
      }
    }
  }

  // BFS
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of workflow.edges) {
      if (edge.source === current && !reachable.has(edge.target)) {
        reachable.add(edge.target);
        queue.push(edge.target);
      }
    }
  }

  return reachable;
}

/**
 * Determine which nodes are in the inactive branch after a conditionalRoute decision.
 * Returns the set of node IDs that should be skipped.
 *
 * A node is skipped if it is reachable from the inactive port
 * AND NOT reachable from the active port (exclusive reachability).
 */
export function computeInactiveBranchNodes(
  workflow: WorkflowDefinition,
  conditionalRouteNodeId: string,
  inactivePort: string,
  activePort: string,
): Set<string> {
  const inactiveReachable = reachableFromPort(workflow, conditionalRouteNodeId, inactivePort);
  const activeReachable = reachableFromPort(workflow, conditionalRouteNodeId, activePort);

  // Nodes exclusively in inactive branch (not also reachable from active branch)
  const exclusive = new Set<string>();
  for (const nodeId of inactiveReachable) {
    if (!activeReachable.has(nodeId)) {
      exclusive.add(nodeId);
    }
  }

  return exclusive;
}

/**
 * Run a workflow with conditional branch support.
 *
 * When a node of type "conditionalRoute" is encountered, its output
 * (on the "activeBranch" port) determines which downstream branch is active.
 * Nodes exclusively in the inactive branch are marked as "skipped".
 *
 * The "finalDraftSelector" node receives from both branches and selects
 * the active branch's output — it is NEVER skipped.
 */
export async function runWorkflowWithBranches(
  workflow: WorkflowDefinition,
  executors: Record<string, NodeExecutor>,
  catalog: NodeCatalog = nodeRegistry,
  context?: WorkflowRunContext,
): Promise<WorkflowRunResult> {
  const validationIssues = validateWorkflow(workflow, catalog);
  const errorIssues = validationIssues.filter((issue) => issue.level === "error");

  if (errorIssues.length > 0) {
    return {
      workflowId: workflow.id,
      status: "error",
      batches: [],
      nodeRuns: [],
      validationIssues,
    };
  }

  const batches = createExecutionBatches(workflow);
  const outputsByNode = new Map<string, Record<string, unknown>>();
  const nodeRuns: NodeRunResult[] = [];
  let hasError = false;
  const inactiveBranchNodes = new Set<string>();

  for (const batch of batches) {
    const batchRuns = await Promise.all(
      batch.map(async (nodeId): Promise<NodeRunResult> => {
        const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) {
          throw new Error(`Missing scheduled node ${nodeId}`);
        }

        // Skip nodes in inactive branch
        if (inactiveBranchNodes.has(nodeId)) {
          const inputs = collectInputs(workflow, nodeId, outputsByNode);
          const startedAt = Date.now();
          return {
            nodeId,
            status: "skipped",
            inputs,
            outputs: {},
            startedAt,
            endedAt: Date.now(),
            metadata: { skippedReason: "inactive-branch" },
          };
        }

        const inputs = collectInputs(workflow, nodeId, outputsByNode);
        const startedAt = Date.now();

        // Runtime schema validation
        const schemaError = validateRuntimeSchemas(
          workflow,
          nodeId,
          inputs,
          outputsByNode,
          catalog,
        );
        if (schemaError) {
          hasError = true;
          return {
            nodeId,
            status: "error",
            inputs,
            outputs: {},
            startedAt,
            endedAt: Date.now(),
            error: schemaError,
          };
        }

        try {
          const executor = executors[node.type] ?? defaultExecutor;
          const result = await executor({ node, inputs, context });
          outputsByNode.set(nodeId, result.outputs);

          // After executing a conditionalRoute, compute inactive branch and ACCUMULATE
          if (node.type === "conditionalRoute") {
            const activeBranch =
              (result.outputs.activeBranch as string) ??
              (result.outputs.decision as string) ??
              "accept";
            const inactivePort = activeBranch === "accept" ? "reviseBranch" : "acceptBranch";
            const newInactive = computeInactiveBranchNodes(
              workflow,
              nodeId,
              inactivePort,
              activeBranch === "accept" ? "acceptBranch" : "reviseBranch",
            );
            // Accumulate: later conditionalRoutes add to the set without clearing prior inactives
            for (const nid of newInactive) {
              inactiveBranchNodes.add(nid);
            }
          }

          return {
            nodeId,
            status: "success" as const,
            inputs,
            outputs: result.outputs,
            metadata: result.metadata,
            startedAt,
            endedAt: Date.now(),
          };
        } catch (error) {
          hasError = true;
          return {
            nodeId,
            status: "error" as const,
            inputs,
            outputs: {},
            startedAt,
            endedAt: Date.now(),
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    nodeRuns.push(...batchRuns);
    if (hasError) {
      break;
    }
  }

  return {
    workflowId: workflow.id,
    status: hasError ? "error" : "success",
    batches,
    nodeRuns,
    validationIssues,
  };
}

/**
 * Validate JSON data at runtime for edges marked compatible-with-runtime-validation.
 * Returns an error string if validation fails, or null if all good.
 */
function validateRuntimeSchemas(
  workflow: WorkflowDefinition,
  nodeId: string,
  inputs: Record<string, unknown>,
  outputsByNode: Map<string, Record<string, unknown>>,
  catalog: NodeCatalog,
): string | null {
  const validator = getRuntimeSchemaValidator();
  if (!validator) return null; // No validator configured — skip runtime check

  const targetNode = workflow.nodes.find((n) => n.id === nodeId);
  if (!targetNode) return null;

  const incomingEdges = workflow.edges.filter((e) => e.target === nodeId);

  for (const edge of incomingEdges) {
    const sourceNode = workflow.nodes.find((n) => n.id === edge.source);
    if (!sourceNode) continue;

    const targetPort = findPortInCatalog(catalog, targetNode.type, edge.targetPort, "input");
    const sourcePort = findPortInCatalog(catalog, sourceNode.type, edge.sourcePort, "output");
    if (!targetPort || !sourcePort) continue;

    // Only check wire-native JSON → JSON edges
    if (!isWirePort(sourcePort) || !isWirePort(targetPort)) continue;
    if (sourcePort.wireType !== "json" || targetPort.wireType !== "json") continue;

    // Only check when compatible-with-runtime-validation
    const schemaStatus = checkSchemaCompatibility(sourcePort.schemaId, targetPort.schemaId);
    if (schemaStatus !== "compatible-with-runtime-validation") continue;

    // Target has schemaId, source doesn't — validate actual data
    if (!targetPort.schemaId) continue;

    const data = inputs[edge.targetPort];
    if (!validator(targetPort.schemaId, data)) {
      return (
        `Runtime schema validation failed: data on port "${edge.targetPort}" ` +
        `does not satisfy schema "${targetPort.schemaId}"`
      );
    }
  }

  return null;
}
