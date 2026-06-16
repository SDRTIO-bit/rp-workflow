import type { WorkflowDefinition } from "./types.js";

export const createExecutionBatches = (workflow: WorkflowDefinition): string[][] => {
  const remaining = new Set(workflow.nodes.map((node) => node.id));
  const completed = new Set<string>();
  const batches: string[][] = [];

  while (remaining.size > 0) {
    const ready = [...remaining].filter((nodeId) =>
      workflow.edges
        .filter((edge) => edge.target === nodeId)
        .every((edge) => completed.has(edge.source)),
    );

    if (ready.length === 0) {
      throw new Error("Workflow graph cannot be scheduled");
    }

    batches.push(ready);
    ready.forEach((nodeId) => {
      remaining.delete(nodeId);
      completed.add(nodeId);
    });
  }

  return batches;
};
