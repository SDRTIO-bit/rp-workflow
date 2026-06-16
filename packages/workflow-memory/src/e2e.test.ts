/**
 * Workflow Memory E2E Tests — P-5 Generic Memory Library V1
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
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
import { stdlibNodes, createStdlibExecutors } from "@awp/workflow-stdlib";
import {
  ProviderRegistry,
  InMemorySpecializedAgentProfileRegistry,
  createP1ProfileRegistry,
  createSpecializedAgentExecutor,
} from "@awp/agent-runtime";
import {
  genericRetrieverNode,
  retrievalResultToMarkdownNode,
  genericRetrieverExecutor,
  retrievalResultToMarkdownExecutor,
} from "@awp/workflow-retrieval";
import {
  InMemoryWorkflowMemoryStore,
  FileWorkflowMemoryStore,
  memoryWriteNode,
  memoryCorpusNode,
  memoryDeleteNode,
  createMemoryWriteExecutor,
  createMemoryCorpusExecutor,
  createMemoryDeleteExecutor,
  createMemorySchemaValidators,
  validateRecordSchema,
  type WorkflowMemoryStore,
  type MemoryRecordV1,
} from "./index.js";

// ============ Helpers ============

const tmpDir = resolve(__dirname, "../../../data");

function createMockAdapter(text = "[MOCK ANSWER]") {
  return {
    provider: "mock",
    complete: async (i: { model: string; prompt: string; temperature?: number }) => ({
      text,
      tokenUsage: { input: Math.ceil(i.prompt.length / 4), output: text.length },
    }),
  };
}

function createP5Catalog(): NodeCatalog {
  return {
    ...nodeRegistry,
    ...stdlibNodes,
    genericRetriever: genericRetrieverNode,
    retrievalResultToMarkdown: retrievalResultToMarkdownNode,
    memoryWrite: memoryWriteNode,
    memoryCorpus: memoryCorpusNode,
    memoryDelete: memoryDeleteNode,
  };
}

function createExecutors(
  store: WorkflowMemoryStore,
  pr: InMemorySpecializedAgentProfileRegistry,
  captureAdapter?: {
    provider: string;
    capturedPrompt: string;
    complete(p: {
      model: string;
      prompt: string;
      temperature?: number;
    }): Promise<{ text: string; tokenUsage: { input: number; output: number } }>;
  },
): Record<string, NodeExecutor> {
  const adapter = captureAdapter ?? createMockAdapter();
  const r = new ProviderRegistry("mock");
  r.register({
    providerId: "mock",
    apiKey: "k",
    baseUrl: "http://x",
    defaultModel: "mock-model",
    createAdapter: () => adapter,
  });

  return {
    ...createStdlibExecutors(),
    jsonSource: async ({ node }) => ({
      outputs: { json: JSON.parse(String(node.config.data ?? "{}")) },
    }),
    playerInput: async ({ node }) => ({
      outputs: { text: String(node.config.text ?? "") },
    }),
    playerOutput: async ({ inputs }) => ({ outputs: { final: inputs.text ?? "" } }),
    inspectOutput: async ({ inputs }) => {
      const p: string[] = [];
      if (inputs.jsonInput != null) p.push(`[JSON]\n${JSON.stringify(inputs.jsonInput, null, 2)}`);
      if (inputs.markdownInput != null) p.push(`[Markdown]\n${String(inputs.markdownInput)}`);
      if (inputs.textInput != null) p.push(`[Text]\n${String(inputs.textInput)}`);
      return { outputs: { debug: p.join("\n\n") || "(none)" } };
    },
    memoryWrite: createMemoryWriteExecutor(store),
    memoryCorpus: createMemoryCorpusExecutor(store),
    memoryDelete: createMemoryDeleteExecutor(store),
    genericRetriever: genericRetrieverExecutor,
    retrievalResultToMarkdown: retrievalResultToMarkdownExecutor,
    specializedAgent: createSpecializedAgentExecutor({
      registry: r,
      profileRegistry: pr,
      createAdapter: () => adapter,
    }),
  };
}
function loadWorkflowJson(filename: string): WorkflowDefinition {
  const path = resolve(__dirname, "../../../data/workflows", filename);
  return JSON.parse(readFileSync(path, "utf-8")).workflow as WorkflowDefinition;
}

// ============ Schema Tests ============

describe("Memory Schema Validation", () => {
  it("validates legal record", () => {
    expect(
      validateRecordSchema({
        id: "r1",
        namespace: "ns",
        content: "hello",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    ).toBe(true);
  });

  it("rejects missing id", () => {
    expect(
      validateRecordSchema({ namespace: "ns", content: "x", createdAt: "t", updatedAt: "t" }),
    ).toBe(false);
  });

  it("rejects invalid importance", () => {
    expect(
      validateRecordSchema({
        id: "r",
        namespace: "ns",
        content: "x",
        importance: Infinity,
        createdAt: "t",
        updatedAt: "t",
      }),
    ).toBe(false);
  });
});

// ============ Store Tests ============

describe("InMemoryWorkflowMemoryStore", () => {
  let store: InMemoryWorkflowMemoryStore;

  beforeEach(() => {
    store = new InMemoryWorkflowMemoryStore();
  });

  it("upserts and retrieves records", async () => {
    const r = await store.upsert("ns", [
      { id: "e1", namespace: "ns", content: "test", createdAt: "t", updatedAt: "t" },
    ]);
    expect(r.count).toBe(1);
    const got = await store.get("ns", "e1");
    expect(got).toBeDefined();
    expect(got!.content).toBe("test");
  });

  it("upsert overwrites by namespace+id", async () => {
    await store.upsert("ns", [
      {
        id: "e1",
        namespace: "ns",
        content: "old",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "t",
      },
    ]);
    await store.upsert("ns", [
      {
        id: "e1",
        namespace: "ns",
        content: "new",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "t",
      },
    ]);
    const got = await store.get("ns", "e1");
    expect(got!.content).toBe("new");
    expect(got!.createdAt).toBe("2025-01-01T00:00:00Z"); // preserved
    expect(got!.updatedAt).not.toBe("t"); // updated to current time
  });

  it("different namespace same id is isolated", async () => {
    await store.upsert("ns-a", [
      { id: "e1", namespace: "ns-a", content: "a", createdAt: "t", updatedAt: "t" },
    ]);
    await store.upsert("ns-b", [
      { id: "e1", namespace: "ns-b", content: "b", createdAt: "t", updatedAt: "t" },
    ]);
    expect((await store.get("ns-a", "e1"))!.content).toBe("a");
    expect((await store.get("ns-b", "e1"))!.content).toBe("b");
  });

  it("list returns records sorted by createdAt desc", async () => {
    await store.upsert("ns", [
      {
        id: "e1",
        namespace: "ns",
        content: "first",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "t",
      },
      {
        id: "e2",
        namespace: "ns",
        content: "second",
        createdAt: "2025-06-01T00:00:00Z",
        updatedAt: "t",
      },
    ]);
    const list = await store.list("ns");
    expect(list[0]!.id).toBe("e2"); // newer first
    expect(list[1]!.id).toBe("e1");
  });

  it("list filters by tagsAny", async () => {
    await store.upsert("ns", [
      { id: "e1", namespace: "ns", content: "a", tags: ["x"], createdAt: "t", updatedAt: "t" },
      { id: "e2", namespace: "ns", content: "b", tags: ["y"], createdAt: "t", updatedAt: "t" },
    ]);
    const r = await store.list("ns", { tagsAny: ["x"] });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe("e1");
  });

  it("delete removes records", async () => {
    await store.upsert("ns", [
      { id: "e1", namespace: "ns", content: "a", createdAt: "t", updatedAt: "t" },
      { id: "e2", namespace: "ns", content: "b", createdAt: "t", updatedAt: "t" },
    ]);
    const r = await store.delete("ns", ["e1"]);
    expect(r.deleted).toBe(1);
    expect(await store.get("ns", "e1")).toBeUndefined();
    expect(await store.get("ns", "e2")).toBeDefined();
  });

  it("delete non-existent returns 0", async () => {
    const r = await store.delete("ns", ["none"]);
    expect(r.deleted).toBe(0);
  });
});

// ============ File Store Tests ============

describe("FileWorkflowMemoryStore", () => {
  const filePath = resolve(tmpDir, "test-memory-store.json");
  let store: FileWorkflowMemoryStore;

  beforeEach(() => {
    try {
      unlinkSync(filePath);
    } catch {
      /* ok */
    }
    try {
      unlinkSync(filePath + ".tmp");
    } catch {
      /* ok */
    }
    store = new FileWorkflowMemoryStore(filePath);
  });
  afterEach(() => {
    try {
      unlinkSync(filePath);
    } catch {
      /* ok */
    }
    try {
      unlinkSync(filePath + ".tmp");
    } catch {
      /* ok */
    }
  });

  it("persists across store instances", async () => {
    await store.upsert("ns", [
      { id: "e1", namespace: "ns", content: "persist", createdAt: "t", updatedAt: "t" },
    ]);

    // Create new store instance (simulates restart)
    const store2 = new FileWorkflowMemoryStore(filePath);
    const got = await store2.get("ns", "e1");
    expect(got).toBeDefined();
    expect(got!.content).toBe("persist");
  });

  it("reports error on corrupted file", async () => {
    writeFileSync(filePath, "not valid json", "utf-8");
    const badStore = new FileWorkflowMemoryStore(filePath);
    await expect(badStore.get("ns", "e1")).rejects.toThrow("corrupted");
  });

  it("upsert and get work correctly", async () => {
    await store.upsert("ns", [
      { id: "e1", namespace: "ns", content: "test", createdAt: "t", updatedAt: "t" },
    ]);
    const got = await store.get("ns", "e1");
    expect(got!.content).toBe("test");
  });

  it("delete removes from file", async () => {
    await store.upsert("ns", [
      { id: "e1", namespace: "ns", content: "x", createdAt: "t", updatedAt: "t" },
    ]);
    await store.delete("ns", ["e1"]);
    expect(await store.get("ns", "e1")).toBeUndefined();
  });

  it("namespace isolation works", async () => {
    await store.upsert("ns-a", [
      { id: "e1", namespace: "ns-a", content: "a", createdAt: "t", updatedAt: "t" },
    ]);
    await store.upsert("ns-b", [
      { id: "e1", namespace: "ns-b", content: "b", createdAt: "t", updatedAt: "t" },
    ]);
    expect((await store.get("ns-a", "e1"))!.content).toBe("a");
    expect((await store.get("ns-b", "e1"))!.content).toBe("b");
  });
});

// ============ E2E Workflow Tests ============

describe("P-5: Memory Workflow E2E", () => {
  let store: InMemoryWorkflowMemoryStore;
  let pr: InMemorySpecializedAgentProfileRegistry;
  const catalog = createP5Catalog();

  beforeEach(() => {
    store = new InMemoryWorkflowMemoryStore();
    pr = createP1ProfileRegistry();
    const v = createMemorySchemaValidators();
    setRuntimeSchemaValidator((schemaId, data) => {
      const validator = v[schemaId];
      return validator ? validator(data) : true;
    });
  });

  it("write workflow loads from disk and validates", () => {
    const wf = loadWorkflowJson("memory-write-smoke-v1.json");
    const issues = validateWorkflow(wf, catalog);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("recall workflow loads from disk and validates", () => {
    const wf = loadWorkflowJson("memory-recall-smoke-v1.json");
    const issues = validateWorkflow(wf, catalog);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("write workflow executes and persists", async () => {
    const wf = loadWorkflowJson("memory-write-smoke-v1.json");
    const execs = createExecutors(store, pr);
    const result = await runWorkflow(wf, execs, catalog);
    expect(result.status).toBe("success");

    // Verify store has the record
    const record = await store.get("rp-session-001", "mem-key-event");
    expect(record).toBeDefined();
    expect(record!.content).toContain("银铃");
  });

  it("recall workflow retrieves written memory", async () => {
    // Write first
    const writeWf = loadWorkflowJson("memory-write-smoke-v1.json");
    const writeExecs = createExecutors(store, pr);
    await runWorkflow(writeWf, writeExecs, catalog);

    // Recall
    const recallWf = loadWorkflowJson("memory-recall-smoke-v1.json");
    const recallExecs = createExecutors(store, pr);
    const result = await runWorkflow(recallWf, recallExecs, catalog);
    expect(result.status).toBe("success");
  });

  it("recall finds written memory via retriever", async () => {
    await runWorkflow(
      loadWorkflowJson("memory-write-smoke-v1.json"),
      createExecutors(store, pr),
      catalog,
    );

    const result = await runWorkflow(
      loadWorkflowJson("memory-recall-smoke-v1.json"),
      createExecutors(store, pr),
      catalog,
    );

    const retRun = result.nodeRuns.find((r) => r.nodeId === "retriever")!;
    expect(retRun.status).toBe("success");
  });

  it("agent prompt contains retrieved memory content", async () => {
    const capture = {
      provider: "mock",
      capturedPrompt: "",
      async complete(p: { model: string; prompt: string; temperature?: number }) {
        this.capturedPrompt = p.prompt;
        return { text: "[MOCK]", tokenUsage: { input: 10, output: 10 } };
      },
    };

    await runWorkflow(
      loadWorkflowJson("memory-write-smoke-v1.json"),
      createExecutors(store, pr),
      catalog,
    );

    const result = await runWorkflow(
      loadWorkflowJson("memory-recall-smoke-v1.json"),
      createExecutors(store, pr, capture),
      catalog,
    );
    expect(result.status).toBe("success");
    expect(capture.capturedPrompt).toContain("Context");
    expect(capture.capturedPrompt).toMatch(/银铃|钥匙|key/i);
  });

  it("namespace isolation: query ns-a does not see ns-b data", async () => {
    // Write to ns-b
    await store.upsert("rp-session-002", [
      {
        id: "other",
        namespace: "rp-session-002",
        content: "secret data",
        createdAt: "t",
        updatedAt: "t",
      },
    ]);

    // ns-a (rp-session-001) from write workflow
    await runWorkflow(
      loadWorkflowJson("memory-write-smoke-v1.json"),
      createExecutors(store, pr),
      catalog,
    );

    // Recall from rp-session-001 should NOT include rp-session-002 data
    const recallWf = loadWorkflowJson("memory-recall-smoke-v1.json");
    const result = await runWorkflow(recallWf, createExecutors(store, pr), catalog);

    const corpusRun = result.nodeRuns.find((r) => r.nodeId === "corpus")!;
    const corpus = corpusRun.outputs.corpus as { entries: MemoryRecordV1[] };
    const ids = corpus.entries.map((e) => e.id);
    expect(ids).not.toContain("other");
  });

  it("delete removes memory from corpus", async () => {
    await store.upsert("rp-session-001", [
      {
        id: "to-delete",
        namespace: "rp-session-001",
        content: "temp",
        createdAt: "t",
        updatedAt: "t",
      },
    ]);
    const r = await store.delete("rp-session-001", ["to-delete"]);
    expect(r.deleted).toBe(1);

    const list = await store.list("rp-session-001");
    expect(list.find((e) => e.id === "to-delete")).toBeUndefined();
  });

  it("memory nodes in production catalog", () => {
    const cat = createP5Catalog();
    expect(cat.memoryWrite).toBeDefined();
    expect(cat.memoryWrite!.type).toBe("memoryWrite");
    expect(cat.memoryCorpus).toBeDefined();
    expect(cat.memoryDelete).toBeDefined();
  });
});
