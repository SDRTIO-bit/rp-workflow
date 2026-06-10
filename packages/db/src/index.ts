export type PersistedWorkflow = {
  id: string;
  name: string;
  version: number;
  definition: unknown;
  updatedAt: string;
};

export type PersistedWorkflowRun = {
  id: string;
  workflowId: string;
  status: "success" | "error";
  startedAt: string;
  endedAt?: string;
};
