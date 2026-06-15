/**
 * Dynamic Worldbook Core Types — P-3
 *
 * Defines the entry model, command/payload schemas, result/status types,
 * store interface, snapshot type, and node config for the dynamicWorldbook node.
 */

// ============ Entry ============

/** A normalized dynamic worldbook entry. */
export type DynamicWorldbookEntryV1 = {
  id: string;
  content: string;
  title?: string;
  type?: string;
  tags?: string[];
  entityIds?: string[];
  priority?: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

// ============ Command ============

export type DynamicWorldbookOperation =
  | "query"
  | "filter"
  | "append"
  | "upsert"
  | "merge"
  | "replace"
  | "delete";

/** Selector for query/filter/merge/delete operations. */
export type DynamicWorldbookSelectorV1 = {
  entryIds?: string[];
  keywords?: string[];
  tagsAny?: string[];
  entityIdsAny?: string[];
  type?: string;
  titleContains?: string;
};

/**
 * Command carries operation and control info.
 * Data (entries, data, patch) MUST NOT appear here.
 */
export type DynamicWorldbookCommandV1 = {
  operation: DynamicWorldbookOperation;
  selector?: DynamicWorldbookSelectorV1;
  limit?: number;
  mode?: string;
  operationId?: string;
  baseVersion?: number;
};

// ============ Payload ============

/**
 * Payload carries data to write or process.
 * operation/selector MUST NOT appear here.
 */
export type DynamicWorldbookPayloadV1 = {
  entries?: DynamicWorldbookEntryV1[];
  data?: Record<string, unknown>;
  patch?: Record<string, unknown>;
};

// ============ Result ============

export type DynamicWorldbookResultV1 = {
  resourceRef: string;
  version: number;
  entries: DynamicWorldbookEntryV1[];
  total: number;
};

// ============ Status ============

export type DynamicWorldbookStatusV1 = {
  success: true;
  operation: DynamicWorldbookOperation;
  resourceRef: string;
  lifecycle: "run" | "session";
  versionBefore: number;
  versionAfter: number;
  changedCount: number;
  matchedCount: number;
  deduplicated: boolean;
  operationId?: string;
};

// ============ Snapshot ============

export type DynamicWorldbookSnapshotV1 = {
  version: number;
  entries: DynamicWorldbookEntryV1[];
};

// ============ Operation Record (for dedup) ============

export type DynamicWorldbookOperationRecordV1 = {
  operationId: string;
  resourceRef: string;
  scopeKey: string;
  operation: DynamicWorldbookOperation;
  commandHash: string;
  result: DynamicWorldbookResultV1;
  status: DynamicWorldbookStatusV1;
  executedAt: string;
};

// ============ Store Interface ============

export interface DynamicWorldbookStore {
  /** Load a snapshot for a given scope + resource. Creates empty if not exists. */
  load(scopeKey: string, resourceRef: string): Promise<DynamicWorldbookSnapshotV1>;

  /** Save a snapshot. */
  save(scopeKey: string, resourceRef: string, snapshot: DynamicWorldbookSnapshotV1): Promise<void>;

  /** Get an operation record for dedup. Returns undefined if not found. */
  getOperationResult(
    scopeKey: string,
    resourceRef: string,
    operationId: string,
  ): Promise<DynamicWorldbookOperationRecordV1 | undefined>;

  /** Save an operation record for dedup. */
  saveOperationResult(
    scopeKey: string,
    resourceRef: string,
    record: DynamicWorldbookOperationRecordV1,
  ): Promise<void>;
}

// ============ Node Config ============

export type DynamicWorldbookNodeConfig = {
  resourceRef: string;
  lifecycle: "run" | "session" | "project" | "persistent";
  allowedOperations: DynamicWorldbookOperation[];
  allowDelete?: boolean;
  maxEntriesPerWrite?: number;
};

// ============ Lifecycle Scope Key Builder ============

export type DynamicWorldbookScopeResolver = (
  lifecycle: string,
  context: {
    runId?: string;
    sessionId?: string;
    resourceRef: string;
  },
) => string;
