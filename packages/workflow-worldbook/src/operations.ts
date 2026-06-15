/**
 * Dynamic Worldbook Operations Engine — P-3
 *
 * Implements all 7 deterministic operations: query, filter, append,
 * upsert, merge, replace, delete. Handles versioning, dedup, and
 * baseVersion conflict detection.
 */
import type {
  DynamicWorldbookCommandV1,
  DynamicWorldbookPayloadV1,
  DynamicWorldbookEntryV1,
  DynamicWorldbookResultV1,
  DynamicWorldbookStatusV1,
  DynamicWorldbookSnapshotV1,
  DynamicWorldbookStore,
  DynamicWorldbookNodeConfig,
  DynamicWorldbookOperation,
} from "./types";
import { deepClone } from "./normalize";

// ============ Operation Context ============

export type OperationContext = {
  store: DynamicWorldbookStore;
  scopeKey: string;
  resourceRef: string;
  command: DynamicWorldbookCommandV1;
  payload: DynamicWorldbookPayloadV1;
  config: DynamicWorldbookNodeConfig;
  now: string;
};

export type OperationResult = {
  result: DynamicWorldbookResultV1;
  status: DynamicWorldbookStatusV1;
};

// ============ Validation Helpers ============

function validateCommandPayloadSeparation(
  command: DynamicWorldbookCommandV1,
  payload: DynamicWorldbookPayloadV1,
): string | null {
  // Command must not contain data fields
  const forbiddenInCommand = ["entries", "data", "patch"] as const;
  for (const key of forbiddenInCommand) {
    if (key in (command as Record<string, unknown>)) {
      return `Command must not contain "${key}". Data belongs in payload.`;
    }
  }
  // Payload must not contain command fields
  const forbiddenInPayload = [
    "operation",
    "selector",
    "limit",
    "mode",
    "operationId",
    "baseVersion",
  ] as const;
  for (const key of forbiddenInPayload) {
    if (key in (payload as Record<string, unknown>)) {
      return `Payload must not contain "${key}". It belongs in command.`;
    }
  }
  return null;
}

function validatePermission(
  operation: DynamicWorldbookOperation,
  config: DynamicWorldbookNodeConfig,
): string | null {
  if (!config.allowedOperations.includes(operation)) {
    return `Operation "${operation}" is not in allowedOperations: [${config.allowedOperations.join(", ")}]`;
  }
  if (operation === "delete" && config.allowDelete !== true) {
    return `Operation "delete" requires allowDelete: true in node config`;
  }
  return null;
}

function validateLifecycle(lifecycle: string): string | null {
  if (lifecycle === "project" || lifecycle === "persistent") {
    return `Dynamic Worldbook lifecycle "${lifecycle}" is not supported in P-3`;
  }
  if (lifecycle !== "run" && lifecycle !== "session") {
    return `Unknown lifecycle "${lifecycle}"`;
  }
  return null;
}

function validateWriteLimits(
  operation: DynamicWorldbookOperation,
  payload: DynamicWorldbookPayloadV1,
  config: DynamicWorldbookNodeConfig,
): string | null {
  if (
    (operation === "append" || operation === "upsert" || operation === "replace") &&
    config.maxEntriesPerWrite !== undefined &&
    payload.entries &&
    payload.entries.length > config.maxEntriesPerWrite
  ) {
    return `Payload contains ${payload.entries.length} entries, exceeding maxEntriesPerWrite: ${config.maxEntriesPerWrite}`;
  }
  return null;
}

function requireOperationId(
  operation: DynamicWorldbookOperation,
  command: DynamicWorldbookCommandV1,
): string | null {
  const needsId = ["append", "upsert", "merge", "replace", "delete"] as DynamicWorldbookOperation[];
  if (needsId.includes(operation) && !command.operationId) {
    return `Operation "${operation}" requires operationId for idempotency`;
  }
  return null;
}

// ============ Selector Matching ============

function matchesSelector(
  entry: DynamicWorldbookEntryV1,
  selector: NonNullable<DynamicWorldbookCommandV1["selector"]>,
): boolean {
  if (selector.entryIds && !selector.entryIds.includes(entry.id)) return false;
  if (selector.type && entry.type !== selector.type) return false;
  if (
    selector.titleContains &&
    (!entry.title || !entry.title.toLowerCase().includes(selector.titleContains.toLowerCase()))
  )
    return false;
  if (selector.tagsAny && selector.tagsAny.length > 0) {
    if (!entry.tags || !selector.tagsAny.some((t) => entry.tags!.includes(t))) return false;
  }
  if (selector.entityIdsAny && selector.entityIdsAny.length > 0) {
    if (!entry.entityIds || !selector.entityIdsAny.some((e) => entry.entityIds!.includes(e)))
      return false;
  }
  return true;
}

function keywordScore(entry: DynamicWorldbookEntryV1, keywords: string[]): number {
  const searchFields = [
    entry.id.toLowerCase(),
    (entry.title ?? "").toLowerCase(),
    entry.content.toLowerCase(),
    ...(entry.tags ?? []).map((t) => t.toLowerCase()),
    ...(entry.entityIds ?? []).map((e) => e.toLowerCase()),
  ];
  let score = 0;
  for (const kw of keywords) {
    const lower = kw.toLowerCase();
    if (searchFields.some((f) => f.includes(lower))) score++;
  }
  return score;
}

// ============ Operation Implementations ============

async function doQuery(
  ctx: OperationContext,
  snapshot: DynamicWorldbookSnapshotV1,
): Promise<OperationResult> {
  const { command } = ctx;
  const keywords = command.selector?.keywords ?? [];
  let matched = snapshot.entries;

  // Apply non-keyword selector filters
  if (command.selector) {
    matched = matched.filter((e) => matchesSelector(e, command.selector!));
  }

  // Score and sort if keywords present
  if (keywords.length > 0) {
    const scored = matched.map((e) => ({
      entry: e,
      score: keywordScore(e, keywords),
    }));
    // Exclude entries with 0 score (no keyword match)
    const matchedScored = scored.filter((s) => s.score > 0);
    matchedScored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if ((b.entry.priority ?? 0) !== (a.entry.priority ?? 0))
        return (b.entry.priority ?? 0) - (a.entry.priority ?? 0);
      return 0; // Maintain original insertion order via stable sort
    });
    matched = matchedScored.map((s) => s.entry);
  } else {
    // Sort by priority for non-keyword queries
    matched = [...matched].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  // Apply limit
  const limit = command.limit;
  if (limit !== undefined && limit > 0 && limit < matched.length) {
    matched = matched.slice(0, limit);
  }

  return {
    result: {
      resourceRef: ctx.resourceRef,
      version: snapshot.version,
      entries: deepClone(matched),
      total: matched.length,
    },
    status: {
      success: true,
      operation: "query",
      resourceRef: ctx.resourceRef,
      lifecycle: ctx.config.lifecycle as "run" | "session",
      versionBefore: snapshot.version,
      versionAfter: snapshot.version,
      changedCount: 0,
      matchedCount: matched.length,
      deduplicated: false,
    },
  };
}

async function doFilter(
  ctx: OperationContext,
  snapshot: DynamicWorldbookSnapshotV1,
): Promise<OperationResult> {
  const selector = ctx.command.selector ?? {};
  const matched = snapshot.entries.filter((e) => matchesSelector(e, selector));

  return {
    result: {
      resourceRef: ctx.resourceRef,
      version: snapshot.version,
      entries: deepClone(matched),
      total: matched.length,
    },
    status: {
      success: true,
      operation: "filter",
      resourceRef: ctx.resourceRef,
      lifecycle: ctx.config.lifecycle as "run" | "session",
      versionBefore: snapshot.version,
      versionAfter: snapshot.version,
      changedCount: 0,
      matchedCount: matched.length,
      deduplicated: false,
    },
  };
}

async function doAppend(
  ctx: OperationContext,
  snapshot: DynamicWorldbookSnapshotV1,
): Promise<OperationResult> {
  const entries = ctx.payload.entries!;
  const existingIds = new Set(snapshot.entries.map((e) => e.id));
  const newIds = new Set(entries.map((e) => e.id));

  // Check for existing IDs
  for (const id of newIds) {
    if (existingIds.has(id)) {
      throw new Error(`append: entry id "${id}" already exists`);
    }
  }

  const now = ctx.now;
  const newEntries = entries.map((e) => ({
    ...e,
    createdAt: e.createdAt ?? now,
    updatedAt: now,
  }));

  const newSnapshot: DynamicWorldbookSnapshotV1 = {
    version: snapshot.version + 1,
    entries: [...snapshot.entries, ...newEntries],
  };

  await ctx.store.save(ctx.scopeKey, ctx.resourceRef, newSnapshot);

  return {
    result: {
      resourceRef: ctx.resourceRef,
      version: newSnapshot.version,
      entries: deepClone(newEntries),
      total: newEntries.length,
    },
    status: {
      success: true,
      operation: "append",
      resourceRef: ctx.resourceRef,
      lifecycle: ctx.config.lifecycle as "run" | "session",
      versionBefore: snapshot.version,
      versionAfter: newSnapshot.version,
      changedCount: newEntries.length,
      matchedCount: newEntries.length,
      deduplicated: false,
      operationId: ctx.command.operationId,
    },
  };
}

async function doUpsert(
  ctx: OperationContext,
  snapshot: DynamicWorldbookSnapshotV1,
): Promise<OperationResult> {
  const entries = ctx.payload.entries!;
  const now = ctx.now;
  const existingMap = new Map(snapshot.entries.map((e) => [e.id, e]));
  let changedCount = 0;

  for (const entry of entries) {
    const existing = existingMap.get(entry.id);
    if (existing) {
      // Replace but preserve createdAt
      existingMap.set(entry.id, {
        ...entry,
        createdAt: existing.createdAt ?? now,
        updatedAt: now,
      });
    } else {
      existingMap.set(entry.id, {
        ...entry,
        createdAt: entry.createdAt ?? now,
        updatedAt: now,
      });
    }
    changedCount++;
  }

  const newSnapshot: DynamicWorldbookSnapshotV1 = {
    version: snapshot.version + 1,
    entries: [...existingMap.values()],
  };

  await ctx.store.save(ctx.scopeKey, ctx.resourceRef, newSnapshot);

  return {
    result: {
      resourceRef: ctx.resourceRef,
      version: newSnapshot.version,
      entries: deepClone(entries.map((e) => existingMap.get(e.id)!)),
      total: entries.length,
    },
    status: {
      success: true,
      operation: "upsert",
      resourceRef: ctx.resourceRef,
      lifecycle: ctx.config.lifecycle as "run" | "session",
      versionBefore: snapshot.version,
      versionAfter: newSnapshot.version,
      changedCount,
      matchedCount: entries.length,
      deduplicated: false,
      operationId: ctx.command.operationId,
    },
  };
}

async function doMerge(
  ctx: OperationContext,
  snapshot: DynamicWorldbookSnapshotV1,
): Promise<OperationResult> {
  const selector = ctx.command.selector;
  if (!selector) {
    throw new Error("merge: selector is required");
  }

  // Find target entries
  const targets = snapshot.entries.filter((e) => matchesSelector(e, selector));
  if (targets.length === 0) {
    throw new Error("merge: selector matched no entries");
  }

  const patch = ctx.payload.patch ?? ctx.payload.data;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("merge: payload must include data or patch as a plain object");
  }

  // Validate merge patch doesn't modify protected fields
  if ("id" in patch) {
    throw new Error("merge: cannot modify entry id via merge");
  }
  if ("createdAt" in patch) {
    throw new Error("merge: cannot modify createdAt via merge");
  }

  const now = ctx.now;
  const newEntries = snapshot.entries.map((e) => {
    if (!targets.some((t) => t.id === e.id)) return e;
    // Shallow merge: patch fields override existing, arrays replace entirely
    return { ...e, ...patch, updatedAt: now };
  });

  const newSnapshot: DynamicWorldbookSnapshotV1 = {
    version: snapshot.version + 1,
    entries: newEntries,
  };

  await ctx.store.save(ctx.scopeKey, ctx.resourceRef, newSnapshot);

  return {
    result: {
      resourceRef: ctx.resourceRef,
      version: newSnapshot.version,
      entries: deepClone(newEntries.filter((e) => targets.some((t) => t.id === e.id))),
      total: targets.length,
    },
    status: {
      success: true,
      operation: "merge",
      resourceRef: ctx.resourceRef,
      lifecycle: ctx.config.lifecycle as "run" | "session",
      versionBefore: snapshot.version,
      versionAfter: newSnapshot.version,
      changedCount: targets.length,
      matchedCount: targets.length,
      deduplicated: false,
      operationId: ctx.command.operationId,
    },
  };
}

async function doReplace(
  ctx: OperationContext,
  snapshot: DynamicWorldbookSnapshotV1,
): Promise<OperationResult> {
  // P-3 V1: selector must be absent/empty for full replacement
  if (ctx.command.selector && Object.keys(ctx.command.selector).length > 0) {
    throw new Error("replace: selector-based partial replacement is not supported in P-3 V1");
  }

  const entries = ctx.payload.entries;
  if (!entries) {
    throw new Error("replace: payload must include entries for full replacement");
  }

  const now = ctx.now;
  const newEntries = entries.map((e) => ({
    ...e,
    createdAt: e.createdAt ?? now,
    updatedAt: now,
  }));

  const newSnapshot: DynamicWorldbookSnapshotV1 = {
    version: snapshot.version + 1,
    entries: newEntries,
  };

  await ctx.store.save(ctx.scopeKey, ctx.resourceRef, newSnapshot);

  return {
    result: {
      resourceRef: ctx.resourceRef,
      version: newSnapshot.version,
      entries: deepClone(newEntries),
      total: newEntries.length,
    },
    status: {
      success: true,
      operation: "replace",
      resourceRef: ctx.resourceRef,
      lifecycle: ctx.config.lifecycle as "run" | "session",
      versionBefore: snapshot.version,
      versionAfter: newSnapshot.version,
      changedCount: newEntries.length,
      matchedCount: newEntries.length,
      deduplicated: false,
      operationId: ctx.command.operationId,
    },
  };
}

async function doDelete(
  ctx: OperationContext,
  snapshot: DynamicWorldbookSnapshotV1,
): Promise<OperationResult> {
  const entryIds = ctx.command.selector?.entryIds;
  if (!entryIds || entryIds.length === 0) {
    throw new Error("delete: selector.entryIds is required");
  }

  const removedIds = new Set(entryIds);
  const newEntries = snapshot.entries.filter((e) => !removedIds.has(e.id));
  const deletedCount = snapshot.entries.length - newEntries.length;

  if (deletedCount === 0) {
    // No entries deleted — return success but don't bump version
    return {
      result: {
        resourceRef: ctx.resourceRef,
        version: snapshot.version,
        entries: [],
        total: 0,
      },
      status: {
        success: true,
        operation: "delete",
        resourceRef: ctx.resourceRef,
        lifecycle: ctx.config.lifecycle as "run" | "session",
        versionBefore: snapshot.version,
        versionAfter: snapshot.version,
        changedCount: 0,
        matchedCount: 0,
        deduplicated: false,
        operationId: ctx.command.operationId,
      },
    };
  }

  const newSnapshot: DynamicWorldbookSnapshotV1 = {
    version: snapshot.version + 1,
    entries: newEntries,
  };

  await ctx.store.save(ctx.scopeKey, ctx.resourceRef, newSnapshot);

  return {
    result: {
      resourceRef: ctx.resourceRef,
      version: newSnapshot.version,
      entries: [],
      total: 0,
    },
    status: {
      success: true,
      operation: "delete",
      resourceRef: ctx.resourceRef,
      lifecycle: ctx.config.lifecycle as "run" | "session",
      versionBefore: snapshot.version,
      versionAfter: newSnapshot.version,
      changedCount: deletedCount,
      matchedCount: deletedCount,
      deduplicated: false,
      operationId: ctx.command.operationId,
    },
  };
}

// ============ Main Operation Dispatcher ============

/**
 * Execute a dynamic worldbook operation.
 *
 * Flow:
 * 1. Validate lifecycle support
 * 2. Validate command/payload separation
 * 3. Validate permissions
 * 4. Validate write limits
 * 5. Resolve scope key
 * 6. Load snapshot
 * 7. Check baseVersion
 * 8. Check operationId dedup
 * 9. Execute operation
 * 10. Save operation record
 */
export async function executeOperation(ctx: OperationContext): Promise<OperationResult> {
  const { command, payload, config } = ctx;

  // 1. Validate lifecycle
  const lifecycleError = validateLifecycle(config.lifecycle);
  if (lifecycleError) throw new Error(lifecycleError);

  // 2. Validate command/payload separation
  const sepError = validateCommandPayloadSeparation(command, payload);
  if (sepError) throw new Error(sepError);

  // 3. Validate permissions
  const permError = validatePermission(command.operation, config);
  if (permError) throw new Error(permError);

  // 4. Validate operationId requirement (for mutating operations)
  const opIdError = requireOperationId(command.operation, command);
  if (opIdError) throw new Error(opIdError);

  // 5. Validate write limits
  const limitError = validateWriteLimits(command.operation, payload, config);
  if (limitError) throw new Error(limitError);

  // 6. Load snapshot
  const snapshot = await ctx.store.load(ctx.scopeKey, ctx.resourceRef);

  // 7. Check baseVersion
  if (command.baseVersion !== undefined && command.baseVersion !== snapshot.version) {
    throw new Error(
      `baseVersion mismatch: expectedVersion=${command.baseVersion}, ` +
        `actualVersion=${snapshot.version}, resourceRef=${ctx.resourceRef}, ` +
        `operation=${command.operation}`,
    );
  }

  // 8. Check operationId dedup (only for mutating operations)
  const isMutating = ["append", "upsert", "merge", "replace", "delete"].includes(command.operation);
  if (isMutating && command.operationId) {
    const prevRecord = await ctx.store.getOperationResult(
      ctx.scopeKey,
      ctx.resourceRef,
      command.operationId,
    );
    if (prevRecord) {
      // Validate same command content
      const currentHash = hashCommandPayload(command, payload);
      if (prevRecord.commandHash !== currentHash) {
        throw new Error(
          `operationId "${command.operationId}" was previously executed with different command/payload`,
        );
      }
      // Return deduplicated result
      return {
        result: prevRecord.result,
        status: { ...prevRecord.status, deduplicated: true },
      };
    }
  }

  // 9. Execute operation
  let opResult: OperationResult;
  switch (command.operation) {
    case "query":
      opResult = await doQuery(ctx, snapshot);
      break;
    case "filter":
      opResult = await doFilter(ctx, snapshot);
      break;
    case "append":
      opResult = await doAppend(ctx, snapshot);
      break;
    case "upsert":
      opResult = await doUpsert(ctx, snapshot);
      break;
    case "merge":
      opResult = await doMerge(ctx, snapshot);
      break;
    case "replace":
      opResult = await doReplace(ctx, snapshot);
      break;
    case "delete":
      opResult = await doDelete(ctx, snapshot);
      break;
    default:
      throw new Error(`Unknown operation: ${(command as { operation: string }).operation}`);
  }

  // 10. Save operation record for mutating operations
  if (isMutating && command.operationId) {
    const record = {
      operationId: command.operationId,
      resourceRef: ctx.resourceRef,
      scopeKey: ctx.scopeKey,
      operation: command.operation,
      commandHash: hashCommandPayload(command, payload),
      result: opResult.result,
      status: opResult.status,
      executedAt: ctx.now,
    };
    await ctx.store.saveOperationResult(ctx.scopeKey, ctx.resourceRef, record);
  }

  return opResult;
}

// ============ Command Hash ============

function hashCommandPayload(
  command: DynamicWorldbookCommandV1,
  payload: DynamicWorldbookPayloadV1,
): string {
  return JSON.stringify({ command, payload });
}

// ============ Scope Key Builder ============

/**
 * Build a deterministic scope key from lifecycle and context.
 *
 * - "run": keyed by runId + resourceRef
 * - "session": keyed by sessionId + resourceRef (requires sessionId)
 */
export function buildScopeKey(
  lifecycle: string,
  context: { runId?: string; sessionId?: string; resourceRef: string },
): string {
  if (lifecycle === "run") {
    const runId = context.runId ?? "unknown-run";
    return `run:${runId}:${context.resourceRef}`;
  }
  if (lifecycle === "session") {
    if (!context.sessionId) {
      throw new Error("session lifecycle requires sessionId in context");
    }
    return `session:${context.sessionId}:${context.resourceRef}`;
  }
  throw new Error(`Unknown lifecycle: ${lifecycle}`);
}
