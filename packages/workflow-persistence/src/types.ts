/**
 * Workflow Persistence & Checkpoint Types — V1
 *
 * Workflow Checkpoint saves Runtime execution state:
 * completedNodeIds, nodeOutputs, pendingNodeIds, status, timestamps.
 * It is NOT: Agent Session, RP Memory, Timeline, Lore, vector memory, Provider cache.
 */

// ============ Checkpoint ============

export interface WorkflowCheckpointV1 {
  checkpointVersion: 1;
  runId: string;
  workflowId: string;
  workflowVersion: number;
  /** Hash of the WorkflowDefinition to detect changes between runs. */
  workflowHash: string;

  status: "running" | "paused" | "failed" | "completed";

  completedNodeIds: string[];
  pendingNodeIds: string[];

  nodeStates: Record<
    string,
    {
      status: "pending" | "running" | "success" | "failed" | "skipped";
      outputs?: Record<string, unknown>;
      error?: SerializedWorkflowError;
      completedAt?: string;
    }
  >;

  startedAt: string;
  updatedAt: string;
}

export interface SerializedWorkflowError {
  message: string;
  code?: string;
  nodeId?: string;
}

export interface WorkflowCheckpointSummaryV1 {
  runId: string;
  workflowId: string;
  status: string;
  startedAt: string;
  updatedAt: string;
}

// ============ Artifact ============

export interface WorkflowArtifactV1 {
  artifactId: string;
  runId: string;
  name: string;
  contentType: string;
  data: string;
  createdAt: string;
}

export interface WorkflowArtifactSummaryV1 {
  artifactId: string;
  runId: string;
  name: string;
  contentType: string;
  createdAt: string;
}

// ============ Checkpoint Hook ============

export interface WorkflowCheckpointHooks {
  /** Called when a run starts. */
  onRunStarted?: (runId: string, checkpoint: WorkflowCheckpointV1) => Promise<void>;
  /** Called after each node completes successfully. */
  onNodeCompleted?: (runId: string, checkpoint: WorkflowCheckpointV1) => Promise<void>;
  /** Called when a node fails. */
  onNodeFailed?: (runId: string, checkpoint: WorkflowCheckpointV1) => Promise<void>;
  /** Called when the run completes (success or final failure). */
  onRunCompleted?: (runId: string, checkpoint: WorkflowCheckpointV1) => Promise<void>;
}

// ============ Store Interfaces ============

export interface WorkflowCheckpointStore {
  save(checkpoint: WorkflowCheckpointV1): Promise<void>;
  load(runId: string): Promise<WorkflowCheckpointV1 | null>;
  delete(runId: string): Promise<void>;
  list(workflowId?: string): Promise<WorkflowCheckpointSummaryV1[]>;
}

export interface WorkflowArtifactStore {
  save(runId: string, artifact: WorkflowArtifactV1): Promise<void>;
  load(runId: string, artifactId: string): Promise<WorkflowArtifactV1 | null>;
  list(runId: string): Promise<WorkflowArtifactSummaryV1[]>;
}

// ============ Node Side-Effect Classification ============

/** Hint for checkpoint-aware execution. Default is "deterministic". */
export type NodeEffectHint = "deterministic" | "idempotent" | "sideEffecting";
