/**
 * Checkpoint-Aware Workflow Runner
 *
 * Provides runWorkflowWithCheckpoint (hooks into each node completion)
 * and resumeWorkflow (restore from checkpoint, skip completed nodes).
 */

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

// ============ Workflow Hash ============

export function computeWorkflowHash(workflow: WorkflowDefinition): string {
  const normalized = JSON.stringify({
    id: workflow.id,
    version: workflow.version,
    nodes: workflow.nodes.map((n) => ({ id: n.id, type: n.type })),
    edges: workflow.edges.map((e) => ({
      source: e.source,
      sourcePort: e.sourcePort,
      target: e.target,
      targetPort: e.targetPort,
    })),
  });
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    hash = (hash << 5) - hash + ch;
    hash = hash & hash;
  }
  return `wf_${Math.abs(hash).toString(36)}`;
}

// ============ Checkpoint Types (inline to avoid circular deps) ============

interface LightCheckpoint {
  runId: string;
  workflowId: string;
  workflowHash: string;
  completedNodeIds: string[];
  nodeOutputs: Record<string, Record<string, unknown>>;
}

export interface CheckpointCallbacks {
  onNodeCompleted?: (
    runId: string,
    nodeId: string,
    outputs: Record<string, unknown>,
  ) => Promise<void>;
  onRunCompleted?: (runId: string, status: string) => Promise<void>;
}

// ============ Checkpoint-Aware Run ============

export async function runWorkflowWithCheckpoint(
  workflow: WorkflowDefinition,
  executors: Record<string, NodeExecutor>,
  catalog: NodeCatalog = nodeRegistry,
  context?: WorkflowRunContext,
  callbacks?: CheckpointCallbacks,
  runId?: string,
): Promise<WorkflowRunResult> {
  const id = runId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const validationIssues = validateWorkflow(workflow, catalog);
  const errorIssues = validationIssues.filter((i) => i.level === "error");

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
        const node = workflow.nodes.find((c) => c.id === nodeId);
        if (!node) throw new Error(`Missing scheduled node ${nodeId}`);

        const inputs: Record<string, unknown> = {};
        for (const edge of workflow.edges.filter((e) => e.target === nodeId)) {
          inputs[edge.targetPort] = outputsByNode.get(edge.source)?.[edge.sourcePort];
        }

        const startedAt = Date.now();
        try {
          const executor =
            executors[node.type] ??
            (async ({ node: n, inputs: i }) => ({
              outputs: { result: `Node ${n.id} got ${JSON.stringify(i)}` },
            }));
          const result = await executor({ node, inputs, context });
          outputsByNode.set(nodeId, result.outputs);

          // Fire checkpoint hook
          await callbacks?.onNodeCompleted?.(id, nodeId, result.outputs);

          return {
            nodeId,
            status: "success" as const,
            inputs,
            outputs: result.outputs,
            metadata: {
              ...("metadata" in result ? result.metadata : {}),
              runId: id,
              resumed: false,
            },
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
    if (hasError) break;
  }

  await callbacks?.onRunCompleted?.(id, hasError ? "failed" : "success");

  return {
    workflowId: workflow.id,
    status: hasError ? "error" : "success",
    batches,
    nodeRuns,
    validationIssues,
  };
}

// ============ Resume Workflow ============

export async function resumeWorkflow(
  workflow: WorkflowDefinition,
  executors: Record<string, NodeExecutor>,
  checkpoint: LightCheckpoint,
  catalog: NodeCatalog = nodeRegistry,
  context?: WorkflowRunContext,
  callbacks?: CheckpointCallbacks,
): Promise<WorkflowRunResult> {
  // Verify workflow hasn't changed
  const currentHash = computeWorkflowHash(workflow);
  if (currentHash !== checkpoint.workflowHash) {
    return {
      workflowId: workflow.id,
      status: "error",
      batches: [],
      nodeRuns: [],
      validationIssues: [
        {
          level: "error",
          message: `Workflow hash mismatch: checkpoint=${checkpoint.workflowHash} current=${currentHash}. Workflow definition has changed.`,
        },
      ],
    };
  }

  const validationIssues = validateWorkflow(workflow, catalog);
  const errorIssues = validationIssues.filter((i) => i.level === "error");
  if (errorIssues.length > 0) {
    return {
      workflowId: workflow.id,
      status: "error",
      batches: [],
      nodeRuns: [],
      validationIssues,
    };
  }

  // Restore outputs from checkpoint
  const outputsByNode = new Map<string, Record<string, unknown>>();
  for (const nodeId of checkpoint.completedNodeIds) {
    const outputs = checkpoint.nodeOutputs[nodeId];
    if (outputs) {
      outputsByNode.set(nodeId, outputs);
    }
  }

  const batches = createExecutionBatches(workflow);
  const nodeRuns: NodeRunResult[] = [];
  let hasError = false;

  for (const batch of batches) {
    const batchRuns = await Promise.all(
      batch.map(async (nodeId): Promise<NodeRunResult> => {
        // Skip already-completed nodes
        if (checkpoint.completedNodeIds.includes(nodeId)) {
          return {
            nodeId,
            status: "success" as const,
            inputs: {},
            outputs: outputsByNode.get(nodeId) ?? {},
            metadata: { runId: checkpoint.runId, resumed: true },
            startedAt: Date.now(),
            endedAt: Date.now(),
          };
        }

        const node = workflow.nodes.find((c) => c.id === nodeId);
        if (!node) throw new Error(`Missing scheduled node ${nodeId}`);

        const inputs: Record<string, unknown> = {};
        for (const edge of workflow.edges.filter((e) => e.target === nodeId)) {
          inputs[edge.targetPort] = outputsByNode.get(edge.source)?.[edge.sourcePort];
        }

        const startedAt = Date.now();
        try {
          const executor =
            executors[node.type] ??
            (async ({ node: n, inputs: i }) => ({
              outputs: { result: `Node ${n.id} got ${JSON.stringify(i)}` },
            }));
          const result = await executor({ node, inputs, context });
          outputsByNode.set(nodeId, result.outputs);

          await callbacks?.onNodeCompleted?.(checkpoint.runId, nodeId, result.outputs);

          return {
            nodeId,
            status: "success" as const,
            inputs,
            outputs: result.outputs,
            metadata: {
              ...("metadata" in result ? result.metadata : {}),
              runId: checkpoint.runId,
              resumed: false,
            },
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
    if (hasError) break;
  }

  await callbacks?.onRunCompleted?.(checkpoint.runId, hasError ? "failed" : "success");

  return {
    workflowId: workflow.id,
    status: hasError ? "error" : "success",
    batches,
    nodeRuns,
    validationIssues,
  };
}
