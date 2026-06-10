import type { WorkflowDefinition } from "@awp/workflow-core";

const workflowStorageKey = "awp.workflow";

type MinimalStorage = Pick<Storage, "getItem" | "setItem">;

export const saveWorkflowToStorage = (
  workflow: WorkflowDefinition,
  storage: MinimalStorage = localStorage,
) => {
  storage.setItem(workflowStorageKey, JSON.stringify(workflow));
};

export const loadWorkflowFromStorage = (
  storage: MinimalStorage = localStorage,
): WorkflowDefinition | undefined => {
  const value = storage.getItem(workflowStorageKey);
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as WorkflowDefinition;
  } catch {
    return undefined;
  }
};
