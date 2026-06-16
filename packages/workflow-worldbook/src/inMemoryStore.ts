/**
 * In-Memory Dynamic Worldbook Store — P-3
 *
 * Scoped by (scopeKey, resourceRef). Uses Map in memory.
 * Supports operation dedup records.
 */
import type {
  DynamicWorldbookSnapshotV1,
  DynamicWorldbookStore,
  DynamicWorldbookOperationRecordV1,
} from "./types.js";

type StoreScope = `${string}::${string}`;

export class InMemoryDynamicWorldbookStore implements DynamicWorldbookStore {
  private snapshots = new Map<StoreScope, DynamicWorldbookSnapshotV1>();
  private operationRecords = new Map<StoreScope, Map<string, DynamicWorldbookOperationRecordV1>>();

  private scopeKey(scopeKey: string, resourceRef: string): StoreScope {
    return `${scopeKey}::${resourceRef}`;
  }

  async load(scopeKey: string, resourceRef: string): Promise<DynamicWorldbookSnapshotV1> {
    const key = this.scopeKey(scopeKey, resourceRef);
    const existing = this.snapshots.get(key);
    if (existing) {
      // Return deep clone to prevent mutation of stored data
      return {
        version: existing.version,
        entries: existing.entries.map((e) => ({ ...e })),
      };
    }
    return { version: 0, entries: [] };
  }

  async save(
    scopeKey: string,
    resourceRef: string,
    snapshot: DynamicWorldbookSnapshotV1,
  ): Promise<void> {
    const key = this.scopeKey(scopeKey, resourceRef);
    // Deep clone on save to ensure store integrity
    this.snapshots.set(key, {
      version: snapshot.version,
      entries: snapshot.entries.map((e) => ({ ...e })),
    });
  }

  async getOperationResult(
    scopeKey: string,
    resourceRef: string,
    operationId: string,
  ): Promise<DynamicWorldbookOperationRecordV1 | undefined> {
    const key = this.scopeKey(scopeKey, resourceRef);
    const records = this.operationRecords.get(key);
    return records?.get(operationId);
  }

  async saveOperationResult(
    scopeKey: string,
    resourceRef: string,
    record: DynamicWorldbookOperationRecordV1,
  ): Promise<void> {
    const key = this.scopeKey(scopeKey, resourceRef);
    let records = this.operationRecords.get(key);
    if (!records) {
      records = new Map();
      this.operationRecords.set(key, records);
    }
    records.set(record.operationId, { ...record });
  }

  /** Clear all data (for testing). */
  clear(): void {
    this.snapshots.clear();
    this.operationRecords.clear();
  }
}
