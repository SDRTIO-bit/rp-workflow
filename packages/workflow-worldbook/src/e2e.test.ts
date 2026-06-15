/**
 * Dynamic Worldbook E2E Tests — P-3
 *
 * Covers: schema validation, normalization, all 7 operations,
 * permissions, version/idempotency, session isolation,
 * workflow JSON E2E, catalog/executor registration.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateWorkflow,
  runWorkflow,
  nodeRegistry,
  setRuntimeSchemaValidator,
  type WorkflowDefinition,
  type NodeExecutor,
  type NodeCatalog,
} from "@awp/workflow-core";
import { stdlibNodes } from "@awp/workflow-stdlib";
import { createStdlibExecutors } from "@awp/workflow-stdlib";
import {
  ProviderRegistry,
  InMemorySpecializedAgentProfileRegistry,
  createP1ProfileRegistry,
  createSpecializedAgentExecutor,
} from "@awp/agent-runtime";
import {
  InMemoryDynamicWorldbookStore,
  createDynamicWorldbookExecutor,
  dynamicWorldbookNode,
  createWorldbookSchemaValidators,
  normalizeEntry,
  normalizeEntries,
  executeOperation,
  buildScopeKey,
  type DynamicWorldbookCommandV1,
  type DynamicWorldbookPayloadV1,
  type DynamicWorldbookNodeConfig,
} from "./index";

// ============ Helpers ============

function loadWorkflowJson(filename: string): WorkflowDefinition {
  const path = resolve(__dirname, "../../../data/workflows", filename);
  return JSON.parse(readFileSync(path, "utf-8")).workflow as WorkflowDefinition;
}

function createMockAdapter(text = "[MOCK]") {
  return {
    provider: "mock",
    complete: async (i: { model: string; prompt: string; temperature?: number }) => ({
      text,
      tokenUsage: { input: Math.ceil(i.prompt.length / 4), output: Math.ceil(text.length / 4) },
    }),
  };
}

function createP3Catalog(): NodeCatalog {
  return { ...nodeRegistry, ...stdlibNodes, dynamicWorldbook: dynamicWorldbookNode };
}

function createExecutors(
  store: InMemoryDynamicWorldbookStore,
  pr: InMemorySpecializedAgentProfileRegistry,
  scopeCtx: { runId?: string; sessionId?: string } = {},
): Record<string, NodeExecutor> {
  const adapter = createMockAdapter();
  const r = new ProviderRegistry("mock");
  r.register({
    providerId: "mock",
    apiKey: "k",
    baseUrl: "http://x",
    defaultModel: "mock-model",
    createAdapter: () => adapter,
  });

  return {
    jsonSource: async ({ node }) => ({
      outputs: { json: JSON.parse(String(node.config.data ?? "{}")) },
    }),
    playerInput: async ({ node }) => ({
      outputs: { text: String(node.config.text ?? "") },
    }),
    playerOutput: async ({ inputs }) => ({
      outputs: { final: inputs.text ?? "" },
    }),
    inspectOutput: async ({ inputs }) => {
      const p: string[] = [];
      if (inputs.jsonInput != null) p.push(`[JSON]\n${JSON.stringify(inputs.jsonInput, null, 2)}`);
      if (inputs.markdownInput != null) p.push(`[Markdown]\n${String(inputs.markdownInput)}`);
      if (inputs.textInput != null) p.push(`[Text]\n${String(inputs.textInput)}`);
      return { outputs: { debug: p.join("\n\n") || "(none)" } };
    },
    dynamicWorldbook: createDynamicWorldbookExecutor({ store, scopeContext: scopeCtx }),
    genericAgent: (async () => ({
      outputs: { result: "[MOCK AGENT]" },
      metadata: {},
    })) as NodeExecutor,
    specializedAgent: createSpecializedAgentExecutor({
      registry: r,
      profileRegistry: pr,
      createAdapter: () => adapter,
    }),
    ...createStdlibExecutors(),
  };
}

// ============ Schema & Normalization Tests ============

describe("Entry Normalization", () => {
  it("accepts valid entry", () => {
    const r = normalizeEntry({
      id: "e1",
      content: "hello",
      title: "T",
      tags: ["a", "b"],
      priority: 3,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entry.id).toBe("e1");
      expect(r.entry.tags).toEqual(["a", "b"]);
      expect(r.entry.priority).toBe(3);
    }
  });

  it("rejects missing id", () => {
    const r = normalizeEntry({ content: "hello" });
    expect(r.ok).toBe(false);
  });

  it("rejects empty id", () => {
    const r = normalizeEntry({ id: "  ", content: "hello" });
    expect(r.ok).toBe(false);
  });

  it("rejects missing content", () => {
    const r = normalizeEntry({ id: "e1" });
    expect(r.ok).toBe(false);
  });

  it("deduplicates tags", () => {
    const r = normalizeEntry({ id: "e1", content: "x", tags: ["a", "b", "a", "c", "b"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.tags).toEqual(["a", "b", "c"]);
  });

  it("deduplicates entityIds", () => {
    const r = normalizeEntry({ id: "e1", content: "x", entityIds: ["x", "y", "x"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.entityIds).toEqual(["x", "y"]);
  });

  it("does not mutate input", () => {
    const input = { id: "e1", content: "hello", tags: ["a", "b"] };
    const original = { ...input, tags: [...input.tags] };
    normalizeEntry(input);
    expect(input.tags).toEqual(original.tags);
  });

  it("rejects non-plain-object metadata", () => {
    const r = normalizeEntry({ id: "e1", content: "x", metadata: new Date() });
    expect(r.ok).toBe(false);
  });

  it("rejects duplicates in batch", () => {
    const r = normalizeEntries([
      { id: "e1", content: "a" },
      { id: "e1", content: "b" },
    ]);
    expect(r.ok).toBe(false);
  });
});

// ============ Operation Tests ============

describe("Store Operations", () => {
  let store: InMemoryDynamicWorldbookStore;
  let baseCtx: {
    store: InMemoryDynamicWorldbookStore;
    scopeKey: string;
    resourceRef: string;
    config: DynamicWorldbookNodeConfig;
    now: string;
    command: DynamicWorldbookCommandV1;
    payload: DynamicWorldbookPayloadV1;
  };

  beforeEach(() => {
    store = new InMemoryDynamicWorldbookStore();
    baseCtx = {
      store,
      scopeKey: "session:s1:wb:test",
      resourceRef: "wb:test",
      config: {
        resourceRef: "wb:test",
        lifecycle: "session",
        allowedOperations: ["query", "filter", "append", "upsert", "merge", "replace", "delete"],
        allowDelete: true,
      },
      now: "2026-06-15T00:00:00.000Z",
      command: { operation: "query" },
      payload: {},
    };
  });

  it("initial version is 0", async () => {
    const snap = await store.load("s1", "wb:test");
    expect(snap.version).toBe(0);
    expect(snap.entries).toEqual([]);
  });

  it("append adds entries and bumps version", async () => {
    const result = await executeOperation({
      ...baseCtx,
      command: { operation: "append", operationId: "op1" },
      payload: { entries: [{ id: "e1", content: "hello" }] },
    });
    expect(result.status.versionBefore).toBe(0);
    expect(result.status.versionAfter).toBe(1);
    expect(result.status.changedCount).toBe(1);
  });

  it("append rejects duplicate id", async () => {
    await executeOperation({
      ...baseCtx,
      command: { operation: "append", operationId: "op1" },
      payload: { entries: [{ id: "e1", content: "hello" }] },
    });
    await expect(
      executeOperation({
        ...baseCtx,
        command: { operation: "append", operationId: "op2" },
        payload: { entries: [{ id: "e1", content: "dup" }] },
      }),
    ).rejects.toThrow("already exists");
  });

  it("query returns matched entries", async () => {
    await executeOperation({
      ...baseCtx,
      command: { operation: "append", operationId: "op1" },
      payload: {
        entries: [
          { id: "e1", content: "dragon fire", tags: ["dragon"], priority: 5 },
          { id: "e2", content: "crystal cave", tags: ["location"], priority: 3 },
        ],
      },
    });
    const result = await executeOperation({
      ...baseCtx,
      command: { operation: "query", selector: { keywords: ["dragon"] } },
      payload: {},
    });
    expect(result.result.total).toBe(1);
    expect(result.result.entries[0]!.id).toBe("e1");
    expect(result.status.versionAfter).toBe(1); // query doesn't bump version
  });

  it("query does not bump version", async () => {
    await executeOperation({
      ...baseCtx,
      command: { operation: "append", operationId: "op1" },
      payload: { entries: [{ id: "e1", content: "hello" }] },
    });
    const result = await executeOperation({
      ...baseCtx,
      command: { operation: "query" },
      payload: {},
    });
    expect(result.status.versionAfter).toBe(1);
  });

  it("filter performs structured matching", async () => {
    await executeOperation({
      ...baseCtx,
      command: { operation: "append", operationId: "op1" },
      payload: {
        entries: [
          { id: "e1", content: "a", type: "character", tags: ["hero"] },
          { id: "e2", content: "b", type: "location" },
        ],
      },
    });
    const result = await executeOperation({
      ...baseCtx,
      command: { operation: "filter", selector: { type: "character" } },
      payload: {},
    });
    expect(result.result.total).toBe(1);
    expect(result.result.entries[0]!.id).toBe("e1");
  });

  it("upsert inserts new and updates existing", async () => {
    await executeOperation({
      ...baseCtx,
      command: { operation: "append", operationId: "op1" },
      payload: { entries: [{ id: "e1", content: "old", createdAt: "2020-01-01T00:00:00Z" }] },
    });
    const result = await executeOperation({
      ...baseCtx,
      command: { operation: "upsert", operationId: "op2" },
      payload: {
        entries: [
          { id: "e1", content: "new" },
          { id: "e2", content: "brand new" },
        ],
      },
    });
    expect(result.status.changedCount).toBe(2);
    expect(result.status.versionAfter).toBe(2);
    // Verify createdAt preserved for existing
    const snap = await store.load(baseCtx.scopeKey, baseCtx.resourceRef);
    const e1 = snap.entries.find((e) => e.id === "e1")!;
    expect(e1.content).toBe("new");
    expect(e1.createdAt).toBe("2020-01-01T00:00:00Z");
  });

  it("merge updates matching entries", async () => {
    await executeOperation({
      ...baseCtx,
      command: { operation: "append", operationId: "op1" },
      payload: {
        entries: [
          { id: "e1", content: "a", priority: 1 },
          { id: "e2", content: "b", priority: 2 },
        ],
      },
    });
    const result = await executeOperation({
      ...baseCtx,
      command: { operation: "merge", selector: { entryIds: ["e1"] }, operationId: "op2" },
      payload: { patch: { priority: 10, tags: ["updated"] } },
    });
    expect(result.status.changedCount).toBe(1);
    const snap = await store.load(baseCtx.scopeKey, baseCtx.resourceRef);
    const e1 = snap.entries.find((e) => e.id === "e1")!;
    expect(e1.priority).toBe(10);
    expect(e1.tags).toEqual(["updated"]);
    expect(e1.content).toBe("a"); // unchanged
  });

  it("merge rejects id modification", async () => {
    await executeOperation({
      ...baseCtx,
      command: { operation: "append", operationId: "op1" },
      payload: { entries: [{ id: "e1", content: "a" }] },
    });
    await expect(
      executeOperation({
        ...baseCtx,
        command: { operation: "merge", selector: { entryIds: ["e1"] }, operationId: "op2" },
        payload: { patch: { id: "e2" } },
      }),
    ).rejects.toThrow("cannot modify entry id");
  });

  it("replace does full replacement", async () => {
    await executeOperation({
      ...baseCtx,
      command: { operation: "append", operationId: "op1" },
      payload: { entries: [{ id: "e1", content: "a" }] },
    });
    const result = await executeOperation({
      ...baseCtx,
      command: { operation: "replace", operationId: "op2" },
      payload: { entries: [{ id: "e2", content: "b" }] },
    });
    expect(result.status.versionAfter).toBe(2);
    const snap = await store.load(baseCtx.scopeKey, baseCtx.resourceRef);
    expect(snap.entries).toHaveLength(1);
    expect(snap.entries[0]!.id).toBe("e2");
  });

  it("replace rejects selector-based in P-3", async () => {
    await expect(
      executeOperation({
        ...baseCtx,
        command: { operation: "replace", selector: { type: "x" }, operationId: "op1" },
        payload: { entries: [{ id: "e1", content: "a" }] },
      }),
    ).rejects.toThrow("selector-based partial replacement is not supported in P-3 V1");
  });

  it("delete removes entries and bumps version", async () => {
    await executeOperation({
      ...baseCtx,
      command: { operation: "append", operationId: "op1" },
      payload: {
        entries: [
          { id: "e1", content: "a" },
          { id: "e2", content: "b" },
        ],
      },
    });
    const result = await executeOperation({
      ...baseCtx,
      command: { operation: "delete", selector: { entryIds: ["e1"] }, operationId: "op2" },
      payload: {},
    });
    expect(result.status.changedCount).toBe(1);
    expect(result.status.versionAfter).toBe(2);
    const snap = await store.load(baseCtx.scopeKey, baseCtx.resourceRef);
    expect(snap.entries).toHaveLength(1);
  });

  it("delete with no match does not bump version", async () => {
    await executeOperation({
      ...baseCtx,
      command: { operation: "append", operationId: "op1" },
      payload: { entries: [{ id: "e1", content: "a" }] },
    });
    const result = await executeOperation({
      ...baseCtx,
      command: { operation: "delete", selector: { entryIds: ["nonexistent"] }, operationId: "op2" },
      payload: {},
    });
    expect(result.status.changedCount).toBe(0);
    expect(result.status.versionAfter).toBe(1);
  });

  it("rejects command/payload mixing", async () => {
    // Command containing entries
    await expect(
      executeOperation({
        ...baseCtx,
        command: {
          operation: "upsert",
          entries: [] as never,
          operationId: "op1",
        } as DynamicWorldbookCommandV1,
        payload: {},
      }),
    ).rejects.toThrow(/Command must not contain/);
  });

  it("rejects payload containing operation info", async () => {
    await expect(
      executeOperation({
        ...baseCtx,
        command: { operation: "upsert", operationId: "op1" },
        payload: { entries: [], operation: "query" } as DynamicWorldbookPayloadV1,
      }),
    ).rejects.toThrow(/Payload must not contain/);
  });
});

// ============ Permission Tests ============

describe("Permissions", () => {
  let store: InMemoryDynamicWorldbookStore;

  beforeEach(() => {
    store = new InMemoryDynamicWorldbookStore();
  });

  it("rejects operation not in allowedOperations", async () => {
    await expect(
      executeOperation({
        store,
        scopeKey: "run:r1:wb",
        resourceRef: "wb",
        config: {
          resourceRef: "wb",
          lifecycle: "run",
          allowedOperations: ["query"],
          allowDelete: false,
        },
        command: { operation: "upsert", operationId: "op1" },
        payload: { entries: [{ id: "e1", content: "x" }] },
        now: "2026-01-01T00:00:00Z",
      }),
    ).rejects.toThrow("not in allowedOperations");
  });

  it("rejects delete without allowDelete", async () => {
    await expect(
      executeOperation({
        store,
        scopeKey: "run:r1:wb",
        resourceRef: "wb",
        config: {
          resourceRef: "wb",
          lifecycle: "run",
          allowedOperations: ["delete"],
          allowDelete: false,
        },
        command: { operation: "delete", selector: { entryIds: ["e1"] }, operationId: "op1" },
        payload: {},
        now: "2026-01-01T00:00:00Z",
      }),
    ).rejects.toThrow("requires allowDelete");
  });

  it("rejects exceeding maxEntriesPerWrite", async () => {
    await expect(
      executeOperation({
        store,
        scopeKey: "run:r1:wb",
        resourceRef: "wb",
        config: {
          resourceRef: "wb",
          lifecycle: "run",
          allowedOperations: ["append"],
          maxEntriesPerWrite: 1,
        },
        command: { operation: "append", operationId: "op1" },
        payload: {
          entries: [
            { id: "e1", content: "a" },
            { id: "e2", content: "b" },
          ],
        },
        now: "2026-01-01T00:00:00Z",
      }),
    ).rejects.toThrow("exceeding maxEntriesPerWrite");
  });

  it("rejects project lifecycle", async () => {
    await expect(
      executeOperation({
        store,
        scopeKey: "proj:p1:wb",
        resourceRef: "wb",
        config: { resourceRef: "wb", lifecycle: "project" as never, allowedOperations: ["query"] },
        command: { operation: "query" },
        payload: {},
        now: "2026-01-01T00:00:00Z",
      }),
    ).rejects.toThrow("not supported in P-3");
  });
});

// ============ Version & Idempotency Tests ============

describe("Version & Idempotency", () => {
  let store: InMemoryDynamicWorldbookStore;

  beforeEach(() => {
    store = new InMemoryDynamicWorldbookStore();
  });

  const config: DynamicWorldbookNodeConfig = {
    resourceRef: "wb",
    lifecycle: "session",
    allowedOperations: ["append"],
    allowDelete: false,
  };

  it("successful write bumps version", async () => {
    const r = await executeOperation({
      store,
      scopeKey: "session:s1:wb",
      resourceRef: "wb",
      config,
      command: { operation: "append", operationId: "op1" },
      payload: { entries: [{ id: "e1", content: "x" }] },
      now: "2026-01-01T00:00:00Z",
    });
    expect(r.status.versionAfter).toBe(1);
  });

  it("baseVersion match succeeds", async () => {
    await executeOperation({
      store,
      scopeKey: "session:s1:wb",
      resourceRef: "wb",
      config,
      command: { operation: "append", operationId: "op1" },
      payload: { entries: [{ id: "e1", content: "x" }] },
      now: "2026-01-01T00:00:00Z",
    });
    const r = await executeOperation({
      store,
      scopeKey: "session:s1:wb",
      resourceRef: "wb",
      config,
      command: { operation: "append", operationId: "op2", baseVersion: 1 },
      payload: { entries: [{ id: "e2", content: "y" }] },
      now: "2026-01-01T00:00:00Z",
    });
    expect(r.status.versionAfter).toBe(2);
  });

  it("baseVersion conflict fails", async () => {
    await executeOperation({
      store,
      scopeKey: "session:s1:wb",
      resourceRef: "wb",
      config,
      command: { operation: "append", operationId: "op1" },
      payload: { entries: [{ id: "e1", content: "x" }] },
      now: "2026-01-01T00:00:00Z",
    });
    await expect(
      executeOperation({
        store,
        scopeKey: "session:s1:wb",
        resourceRef: "wb",
        config,
        command: { operation: "append", operationId: "op2", baseVersion: 0 },
        payload: { entries: [{ id: "e2", content: "y" }] },
        now: "2026-01-01T00:00:00Z",
      }),
    ).rejects.toThrow("baseVersion mismatch");
  });

  it("operationId dedup returns same result", async () => {
    const r1 = await executeOperation({
      store,
      scopeKey: "session:s1:wb",
      resourceRef: "wb",
      config,
      command: { operation: "append", operationId: "dup1" },
      payload: { entries: [{ id: "e1", content: "x" }] },
      now: "2026-01-01T00:00:00Z",
    });
    expect(r1.status.deduplicated).toBe(false);

    const r2 = await executeOperation({
      store,
      scopeKey: "session:s1:wb",
      resourceRef: "wb",
      config,
      command: { operation: "append", operationId: "dup1" },
      payload: { entries: [{ id: "e1", content: "x" }] },
      now: "2026-01-02T00:00:00Z",
    });
    expect(r2.status.deduplicated).toBe(true);
    expect(r2.status.versionAfter).toBe(r1.status.versionAfter);
  });

  it("same operationId different content fails", async () => {
    await executeOperation({
      store,
      scopeKey: "session:s1:wb",
      resourceRef: "wb",
      config,
      command: { operation: "append", operationId: "dup2" },
      payload: { entries: [{ id: "e1", content: "x" }] },
      now: "2026-01-01T00:00:00Z",
    });
    await expect(
      executeOperation({
        store,
        scopeKey: "session:s1:wb",
        resourceRef: "wb",
        config,
        command: { operation: "append", operationId: "dup2" },
        payload: { entries: [{ id: "e2", content: "y" }] },
        now: "2026-01-02T00:00:00Z",
      }),
    ).rejects.toThrow("different command/payload");
  });
});

// ============ Isolation Tests ============

describe("Isolation", () => {
  let store: InMemoryDynamicWorldbookStore;

  beforeEach(() => {
    store = new InMemoryDynamicWorldbookStore();
  });

  it("same sessionId + resourceRef shares across runs", async () => {
    const config: DynamicWorldbookNodeConfig = {
      resourceRef: "wb:shared",
      lifecycle: "session",
      allowedOperations: ["append"],
    };
    await executeOperation({
      store,
      scopeKey: "session:sa:wb:shared",
      resourceRef: "wb:shared",
      config,
      command: { operation: "append", operationId: "op1" },
      payload: { entries: [{ id: "e1", content: "shared" }] },
      now: "2026-01-01T00:00:00Z",
    });
    // Another "run" with same sessionId
    const snap = await store.load("session:sa:wb:shared", "wb:shared");
    expect(snap.entries).toHaveLength(1);
    expect(snap.entries[0]!.id).toBe("e1");
  });

  it("different sessionId isolated", async () => {
    const config: DynamicWorldbookNodeConfig = {
      resourceRef: "wb:iso",
      lifecycle: "session",
      allowedOperations: ["append"],
    };
    await executeOperation({
      store,
      scopeKey: "session:sa:wb:iso",
      resourceRef: "wb:iso",
      config,
      command: { operation: "append", operationId: "op1" },
      payload: { entries: [{ id: "e1", content: "a" }] },
      now: "2026-01-01T00:00:00Z",
    });
    const snap = await store.load("session:sb:wb:iso", "wb:iso");
    expect(snap.entries).toHaveLength(0);
  });

  it("different resourceRef isolated", async () => {
    const config: DynamicWorldbookNodeConfig = {
      resourceRef: "wb:a",
      lifecycle: "session",
      allowedOperations: ["append"],
    };
    await executeOperation({
      store,
      scopeKey: "session:s1:wb:a",
      resourceRef: "wb:a",
      config,
      command: { operation: "append", operationId: "op1" },
      payload: { entries: [{ id: "e1", content: "a" }] },
      now: "2026-01-01T00:00:00Z",
    });
    const snap = await store.load("session:s1:wb:b", "wb:b");
    expect(snap.entries).toHaveLength(0);
  });

  it("run lifecycle isolated per runId", async () => {
    const config: DynamicWorldbookNodeConfig = {
      resourceRef: "wb:run",
      lifecycle: "run",
      allowedOperations: ["append"],
    };
    await executeOperation({
      store,
      scopeKey: "run:r1:wb:run",
      resourceRef: "wb:run",
      config,
      command: { operation: "append", operationId: "op1" },
      payload: { entries: [{ id: "e1", content: "r1" }] },
      now: "2026-01-01T00:00:00Z",
    });
    const snap = await store.load("run:r2:wb:run", "wb:run");
    expect(snap.entries).toHaveLength(0);
  });

  it("session lifecycle requires sessionId in scope builder", () => {
    expect(() => buildScopeKey("session", { resourceRef: "wb" })).toThrow("sessionId");
  });
});

// ============ E2E Workflow JSON Tests ============

describe("E2E Workflow JSON", () => {
  let store: InMemoryDynamicWorldbookStore;
  let pr: InMemorySpecializedAgentProfileRegistry;
  const catalog = createP3Catalog();

  beforeEach(() => {
    store = new InMemoryDynamicWorldbookStore();
    pr = createP1ProfileRegistry();
    // Register worldbook schema validators
    const worldbookValidators = createWorldbookSchemaValidators();
    setRuntimeSchemaValidator((schemaId, data) => {
      const validator = worldbookValidators[schemaId];
      return validator ? validator(data) : true;
    });
  });

  it("write workflow loads from disk and validates", () => {
    const wf = loadWorkflowJson("dynamic-worldbook-write-smoke-v1.json");
    const issues = validateWorkflow(wf, catalog);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);
  });

  it("write workflow executes successfully", async () => {
    const wf = loadWorkflowJson("dynamic-worldbook-write-smoke-v1.json");
    const execs = createExecutors(store, pr, { sessionId: "session-a" });
    const result = await runWorkflow(wf, execs, catalog, { sessionId: "session-a" });
    expect(result.status).toBe("success");
    // Verify dynamicWorldbook node ran
    const wbRun = result.nodeRuns.find((r) => r.nodeId === "wb")!;
    expect(wbRun.status).toBe("success");
    expect(wbRun.metadata!.versionAfter).toBe(1);
  });

  it("query workflow reads data written by write workflow (same session)", async () => {
    // Write first
    const writeWf = loadWorkflowJson("dynamic-worldbook-write-smoke-v1.json");
    const writeExecs = createExecutors(store, pr, { sessionId: "session-a" });
    const writeResult = await runWorkflow(writeWf, writeExecs, catalog, { sessionId: "session-a" });
    expect(writeResult.status).toBe("success");

    // Query with same store, same sessionId, same resourceRef
    const queryWf = loadWorkflowJson("dynamic-worldbook-query-smoke-v1.json");
    const queryExecs = createExecutors(store, pr, { sessionId: "session-a" });
    const queryResult = await runWorkflow(queryWf, queryExecs, catalog, { sessionId: "session-a" });
    expect(queryResult.status).toBe("success");

    // The worldbook node should return the entry we wrote
    const wbRun = queryResult.nodeRuns.find((r) => r.nodeId === "wb")!;
    expect(wbRun.status).toBe("success");
    const resultOut = wbRun.outputs.result as Record<string, unknown>;
    expect(resultOut.total).toBe(1);
  });

  it("query with different session reads nothing", async () => {
    // Write with session-a
    const writeWf = loadWorkflowJson("dynamic-worldbook-write-smoke-v1.json");
    const writeExecs = createExecutors(store, pr, { sessionId: "session-a" });
    await runWorkflow(writeWf, writeExecs, catalog, { sessionId: "session-a" });

    // Query with session-b (different store scope)
    const queryWf = loadWorkflowJson("dynamic-worldbook-query-smoke-v1.json");
    const queryExecs = createExecutors(store, pr, { sessionId: "session-b" });
    const queryResult = await runWorkflow(queryWf, queryExecs, catalog, { sessionId: "session-b" });
    expect(queryResult.status).toBe("success");

    const wbRun = queryResult.nodeRuns.find((r) => r.nodeId === "wb")!;
    const resultOut = wbRun.outputs.result as Record<string, unknown>;
    expect(resultOut.total).toBe(0);
  });

  it("query workflow produces inspect output", async () => {
    const writeWf = loadWorkflowJson("dynamic-worldbook-write-smoke-v1.json");
    const writeExecs = createExecutors(store, pr, { sessionId: "session-a" });
    await runWorkflow(writeWf, writeExecs, catalog, { sessionId: "session-a" });

    const queryWf = loadWorkflowJson("dynamic-worldbook-query-smoke-v1.json");
    const queryExecs = createExecutors(store, pr, { sessionId: "session-a" });
    const queryResult = await runWorkflow(queryWf, queryExecs, catalog, { sessionId: "session-a" });

    // Inspect result (JSON)
    const inspResult = queryResult.nodeRuns.find((r) => r.nodeId === "inspResult")!;
    expect(inspResult.outputs.debug).toContain("[JSON]");

    // Inspect markdown
    const inspMd = queryResult.nodeRuns.find((r) => r.nodeId === "inspMd")!;
    expect(inspMd.outputs.debug).toContain("[Markdown]");

    // Inspect text (agent output)
    const inspText = queryResult.nodeRuns.find((r) => r.nodeId === "inspText")!;
    expect(inspText.outputs.debug).toContain("[Text]");
  });

  it("dynamicWorldbook is in production catalog", () => {
    const cat = createP3Catalog();
    expect(cat.dynamicWorldbook).toBeDefined();
    expect(cat.dynamicWorldbook!.type).toBe("dynamicWorldbook");
  });
});
