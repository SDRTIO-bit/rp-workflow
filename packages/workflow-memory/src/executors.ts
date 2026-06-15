/**
 * Memory Executors — P-5
 */
import type { NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type {
  WorkflowMemoryStore,
  MemoryWriteInputV1,
  MemoryQueryFilterV1,
  MemoryCorpusOutputV1,
  MemoryDeleteInputV1,
} from "./types";

export function createMemoryWriteExecutor(store: WorkflowMemoryStore): NodeExecutor {
  return async (input: NodeExecutionInput) => {
    const node = input.node;
    const config = node.config as Record<string, unknown>;
    const inputs = input.inputs as Record<string, unknown>;

    const writeInput = inputs.input as MemoryWriteInputV1;
    if (!writeInput || !Array.isArray(writeInput.records)) {
      throw new Error("memoryWrite: input must be a valid MemoryWriteInputV1 with records array");
    }

    const namespace = String(config.namespace || writeInput.namespace || "");
    if (!namespace) {
      throw new Error("memoryWrite: namespace is required in node config or input");
    }

    const result = await store.upsert(namespace, writeInput.records);

    return {
      outputs: { output: result },
      metadata: { namespace, count: result.count },
    };
  };
}

export function createMemoryCorpusExecutor(store: WorkflowMemoryStore): NodeExecutor {
  return async (input: NodeExecutionInput) => {
    const node = input.node;
    const config = node.config as Record<string, unknown>;
    const inputs = input.inputs as Record<string, unknown>;

    const namespace = String(config.namespace || "");
    if (!namespace) {
      throw new Error("memoryCorpus: namespace is required in node config");
    }

    const filters = (inputs.filters as MemoryQueryFilterV1 | undefined) ?? undefined;
    const records = await store.list(namespace, filters);

    const corpus: MemoryCorpusOutputV1 = {
      entries: records.map((r) => ({
        id: r.id,
        content: r.content,
        title: r.title,
        type: r.type,
        tags: r.tags,
        entityIds: r.entityIds,
        priority: r.importance,
        metadata: r.metadata,
      })),
      total: records.length,
      namespace,
    };

    return {
      outputs: { corpus },
      metadata: { namespace, total: records.length },
    };
  };
}

export function createMemoryDeleteExecutor(store: WorkflowMemoryStore): NodeExecutor {
  return async (input: NodeExecutionInput) => {
    const node = input.node;
    const config = node.config as Record<string, unknown>;
    const inputs = input.inputs as Record<string, unknown>;

    const deleteInput = inputs.input as MemoryDeleteInputV1;
    if (!deleteInput || !Array.isArray(deleteInput.ids)) {
      throw new Error("memoryDelete: input must be a valid MemoryDeleteInputV1 with ids array");
    }

    const namespace = String(config.namespace || deleteInput.namespace || "");
    if (!namespace) {
      throw new Error("memoryDelete: namespace is required in node config or input");
    }

    const result = await store.delete(namespace, deleteInput.ids);
    return {
      outputs: { output: result },
      metadata: { namespace, deleted: result.deleted },
    };
  };
}
