/**
 * Workflow Memory Types — P-5 Generic Memory Library V1
 */
import type { RetrievalCorpusV1 } from "@awp/workflow-retrieval";

// ============ Memory Record ============

export interface MemoryRecordV1 {
  id: string;
  namespace: string;
  content: string;
  title?: string;
  type?: string;
  tags?: string[];
  entityIds?: string[];
  importance?: number;
  source?: {
    workflowId?: string;
    runId?: string;
    nodeId?: string;
  };
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

// ============ Write Input ============

export interface MemoryWriteInputV1 {
  records: MemoryRecordV1[];
  namespace: string;
}

// ============ Write Output ============

export interface MemoryWriteOutputV1 {
  written: MemoryRecordV1[];
  count: number;
}

// ============ Query Input ============

export interface MemoryQueryInputV1 {
  namespace: string;
  filters?: MemoryQueryFilterV1;
}

export interface MemoryQueryFilterV1 {
  ids?: string[];
  tagsAny?: string[];
  tagsAll?: string[];
  type?: string;
  titleContains?: string;
}

// ============ Query Output ============

/** Output compatible with RetrievalCorpusV1 for direct P-4 integration. */
export interface MemoryCorpusOutputV1 extends RetrievalCorpusV1 {
  total: number;
  namespace: string;
}

// ============ Delete Input ============

export interface MemoryDeleteInputV1 {
  namespace: string;
  ids: string[];
}

// ============ Delete Output ============

export interface MemoryDeleteOutputV1 {
  deleted: number;
  ids: string[];
}

// ============ Store Interface ============

export interface WorkflowMemoryStore {
  /** Upsert records. Same namespace+id overwrites. */
  upsert(namespace: string, records: MemoryRecordV1[]): Promise<MemoryWriteOutputV1>;

  /** Get a single record by namespace + id. */
  get(namespace: string, id: string): Promise<MemoryRecordV1 | undefined>;

  /** List records, optionally filtered. */
  list(namespace: string, filters?: MemoryQueryFilterV1): Promise<MemoryRecordV1[]>;

  /** Delete records by namespace + ids. Returns count actually deleted. */
  delete(namespace: string, ids: string[]): Promise<MemoryDeleteOutputV1>;
}

// ============ Schema IDs ============

export const MEMORY_RECORD_SCHEMA = "awp.memory-record.v1";
export const MEMORY_WRITE_INPUT_SCHEMA = "awp.memory-write-input.v1";
export const MEMORY_WRITE_OUTPUT_SCHEMA = "awp.memory-write-output.v1";
export const MEMORY_QUERY_INPUT_SCHEMA = "awp.memory-query-input.v1";
export const MEMORY_CORPUS_OUTPUT_SCHEMA = "awp.memory-corpus-output.v1";
