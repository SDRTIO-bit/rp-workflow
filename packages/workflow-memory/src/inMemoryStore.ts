/**
 * In-Memory Workflow Memory Store — P-5
 */
import type {
  WorkflowMemoryStore,
  MemoryRecordV1,
  MemoryWriteOutputV1,
  MemoryQueryFilterV1,
  MemoryDeleteOutputV1,
} from "./types";

export class InMemoryWorkflowMemoryStore implements WorkflowMemoryStore {
  private records = new Map<string, Map<string, MemoryRecordV1>>();
  private dedupRecords = new Map<
    string,
    Map<string, { operationId: string; requestHash: string }>
  >();

  private ns(namespace: string): Map<string, MemoryRecordV1> {
    let m = this.records.get(namespace);
    if (!m) {
      m = new Map();
      this.records.set(namespace, m);
    }
    return m;
  }

  async upsert(namespace: string, records: MemoryRecordV1[]): Promise<MemoryWriteOutputV1> {
    const ns = this.ns(namespace);
    const written: MemoryRecordV1[] = [];
    const now = new Date().toISOString();

    for (const rec of records) {
      const existing = ns.get(rec.id);
      const updated: MemoryRecordV1 = {
        ...rec,
        createdAt: existing?.createdAt ?? rec.createdAt ?? now,
        updatedAt: now,
      };
      ns.set(rec.id, updated);
      written.push(updated);
    }

    return { written, count: written.length };
  }

  async get(namespace: string, id: string): Promise<MemoryRecordV1 | undefined> {
    return this.ns(namespace).get(id);
  }

  async list(namespace: string, filters?: MemoryQueryFilterV1): Promise<MemoryRecordV1[]> {
    const ns = this.ns(namespace);
    let all = [...ns.values()];

    if (filters) {
      if (filters.ids) all = all.filter((r) => filters.ids!.includes(r.id));
      if (filters.type) all = all.filter((r) => r.type === filters.type);
      if (filters.titleContains)
        all = all.filter((r) =>
          r.title?.toLowerCase().includes(filters.titleContains!.toLowerCase()),
        );
      if (filters.tagsAny?.length)
        all = all.filter((r) => r.tags?.some((t) => filters.tagsAny!.includes(t)));
      if (filters.tagsAll?.length)
        all = all.filter((r) => filters.tagsAll!.every((t) => r.tags?.includes(t)));
    }

    // Stable sort: createdAt desc, then id asc
    all.sort((a, b) => {
      const ca = a.createdAt.localeCompare(b.createdAt);
      if (ca !== 0) return -ca; // newer first
      return a.id.localeCompare(b.id);
    });

    return all;
  }

  async delete(namespace: string, ids: string[]): Promise<MemoryDeleteOutputV1> {
    const ns = this.ns(namespace);
    let deleted = 0;
    for (const id of ids) {
      if (ns.delete(id)) deleted++;
    }
    return { deleted, ids };
  }

  async getDedupRecord(
    namespace: string,
    operationId: string,
  ): Promise<{ operationId: string; requestHash: string } | undefined> {
    return this.dedupRecords.get(namespace)?.get(operationId);
  }

  async saveDedupRecord(
    namespace: string,
    operationId: string,
    requestHash: string,
  ): Promise<void> {
    let ns = this.dedupRecords.get(namespace);
    if (!ns) {
      ns = new Map();
      this.dedupRecords.set(namespace, ns);
    }
    ns.set(operationId, { operationId, requestHash });
  }

  clear(): void {
    this.records.clear();
    this.dedupRecords.clear();
  }
}
