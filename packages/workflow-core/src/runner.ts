import { createExecutionBatches } from "./scheduler";
import { validateWorkflow } from "./validation";
import { nodeRegistry } from "./nodeRegistry";
import type {
  NodeCatalog,
  NodeExecutor,
  NodeRunResult,
  WorkflowDefinition,
  WorkflowRunContext,
  WorkflowRunResult,
} from "./types";

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
