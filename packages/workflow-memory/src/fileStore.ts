/**
 * File Workflow Memory Store — P-5
 *
 * JSON-file-based persistent store. Atomic writes via temp-file + rename.
 * Cross-store-instance readable. Reports clear errors on corruption.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  WorkflowMemoryStore,
  MemoryRecordV1,
  MemoryWriteOutputV1,
  MemoryQueryFilterV1,
  MemoryDeleteOutputV1,
} from "./types";

interface FileData {
  version: 1;
  records: Record<string, Record<string, MemoryRecordV1>>;
  dedup: Record<string, Record<string, { operationId: string; requestHash: string }>>;
}

function emptyData(): FileData {
  return { version: 1, records: {}, dedup: {} };
}

export class FileWorkflowMemoryStore implements WorkflowMemoryStore {
  private filePath: string;
  private data: FileData;
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = emptyData();
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== 1 || typeof parsed.records !== "object") {
          throw new Error(
            `WorkflowMemory file corrupted at "${this.filePath}": invalid structure. Delete the file to reset.`,
          );
        }
        this.data = parsed as FileData;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("corrupted")) throw err;
      throw new Error(
        `WorkflowMemory file corrupted at "${this.filePath}": ${(err as Error).message}. Delete the file to reset.`,
      );
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tmpPath = this.filePath + ".tmp";
    const json = JSON.stringify(this.data, null, 2);
    writeFileSync(tmpPath, json, "utf-8");
    renameSync(tmpPath, this.filePath);
  }

  private nsData(namespace: string): Record<string, MemoryRecordV1> {
    let m = this.data.records[namespace];
    if (!m) {
      m = {};
      this.data.records[namespace] = m;
    }
    return m;
  }

  async upsert(namespace: string, records: MemoryRecordV1[]): Promise<MemoryWriteOutputV1> {
    this.ensureLoaded();
    const ns = this.nsData(namespace);
    const written: MemoryRecordV1[] = [];
    const now = new Date().toISOString();

    for (const rec of records) {
      const existing = ns[rec.id];
      const updated: MemoryRecordV1 = {
        ...rec,
        createdAt: existing?.createdAt ?? rec.createdAt ?? now,
        updatedAt: now,
      };
      ns[rec.id] = updated;
      written.push(updated);
    }

    await this.save();
    return { written, count: written.length };
  }

  async get(namespace: string, id: string): Promise<MemoryRecordV1 | undefined> {
    this.ensureLoaded();
    return this.nsData(namespace)[id];
  }

  async list(namespace: string, filters?: MemoryQueryFilterV1): Promise<MemoryRecordV1[]> {
    this.ensureLoaded();
    const ns = this.nsData(namespace);
    let all = Object.values(ns);

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

    all.sort((a, b) => {
      const ca = a.createdAt.localeCompare(b.createdAt);
      if (ca !== 0) return -ca;
      return a.id.localeCompare(b.id);
    });

    return all;
  }

  async delete(namespace: string, ids: string[]): Promise<MemoryDeleteOutputV1> {
    this.ensureLoaded();
    const ns = this.nsData(namespace);
    let deleted = 0;
    for (const id of ids) {
      if (ns[id]) {
        delete ns[id];
        deleted++;
      }
    }
    if (deleted > 0) await this.save();
    return { deleted, ids };
  }

  /** Re-initialize: drop loaded state so next operation re-reads from file. */
  reload(): void {
    this.loaded = false;
    this.data = emptyData();
  }

  async getDedupRecord(
    namespace: string,
    operationId: string,
  ): Promise<{ operationId: string; requestHash: string } | undefined> {
    this.ensureLoaded();
    return this.data.dedup[namespace]?.[operationId];
  }

  async saveDedupRecord(
    namespace: string,
    operationId: string,
    requestHash: string,
  ): Promise<void> {
    this.ensureLoaded();
    let ns = this.data.dedup[namespace];
    if (!ns) {
      ns = {};
      this.data.dedup[namespace] = ns;
    }
    ns[operationId] = { operationId, requestHash };
    await this.save();
  }
}
