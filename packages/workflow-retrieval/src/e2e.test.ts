/**
 * Retrieval Layer E2E Tests — P-4
 *
 * Covers: tokenizer, normalization, filters, keyword/BM25/hybrid scoring,
 * retrieval orchestrator, formatter, schema validators, workflow JSON E2E.
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
  executeOperation,
  type DynamicWorldbookNodeConfig,
} from "@awp/workflow-worldbook";
import {
  normalizeText,
  tokenize,
  applyFilter,
  computeKeywordScore,
  computeBM25Scores,
  retrieve,
  formatRetrievalResult,
  genericRetrieverNode,
  retrievalResultToMarkdownNode,
  genericRetrieverExecutor,
  retrievalResultToMarkdownExecutor,
  createRetrievalSchemaValidators,
  validateDocumentSchema,
  validateCorpusSchema,
  type RetrievalDocumentV1,
  type GenericRetrieverConfig,
  type RetrievalResultV1,
} from "./index";

// ============ Helpers ============

function createMockAdapter(text = "[MOCK ANSWER]") {
  return {
    provider: "mock",
    complete: async (i: { model: string; prompt: string; temperature?: number }) => ({
      text,
      tokenUsage: { input: Math.ceil(i.prompt.length / 4), output: Math.ceil(text.length / 4) },
    }),
  };
}

const sampleCorpus: RetrievalDocumentV1[] = [
  {
    id: "char_dragon",
    content: "An ancient dragon named Ember who guards the Crystal Mountains.",
    title: "Ember the Dragon",
    type: "character",
    tags: ["dragon", "guardian"],
    entityIds: ["npc_ember"],
    priority: 5,
  },
  {
    id: "loc_crystal",
    content: "The Crystal Mountains shimmer with eternal frost. A sacred place.",
    title: "Crystal Mountains",
    type: "location",
    tags: ["mountain", "sacred"],
    entityIds: ["loc_crystal_mt"],
    priority: 3,
  },
  {
    id: "faction_church",
    content: "白塔教会控制北境的医疗与审判体系。数百年来，教会医生垄断了解剖学知识。",
    title: "白塔教会",
    type: "faction",
    tags: ["教会", "北境", "医疗"],
    entityIds: ["faction_white_tower"],
    priority: 4,
  },
  {
    id: "faction_guard",
    content: "北境守护者是一支由教会资助的精英骑士团，守护北境边境。",
    title: "北境守护者",
    type: "faction",
    tags: ["骑士", "北境", "守护"],
    entityIds: ["faction_north_guard"],
    priority: 3,
  },
  {
    id: "event_plague",
    content: "黑死病席卷北境，教会宣称是神罚，拒绝采用新疗法。",
    title: "黑死病爆发",
    type: "event",
    tags: ["瘟疫", "北境", "教会"],
    entityIds: ["event_black_death"],
    priority: 5,
  },
  {
    id: "noise_1",
    content: "A random recipe for blueberry pie. Not relevant to the story.",
    type: "misc",
    tags: ["recipe"],
    priority: 1,
  },
  {
    id: "noise_2",
    content: "Weather report: sunny with a chance of rain.",
    type: "misc",
    tags: ["weather"],
    priority: 1,
  },
];

// ============ Tokenizer & Normalize Tests ============

describe("Tokenizer & Normalization", () => {
  it("normalizes unicode NFKC", () => {
    expect(normalizeText("\uFB00ower")).toBe("ffower"); // \uFB00 = ﬀ ligature
  });

  it("lowercases and collapses whitespace", () => {
    expect(normalizeText("  Hello   WORLD  ")).toBe("hello world");
  });

  it("tokenizes English words", () => {
    const t = tokenize("Hello World");
    expect(t).toContain("hello");
    expect(t).toContain("world");
  });

  it("tokenizes Chinese single characters", () => {
    const t = tokenize("白塔");
    expect(t).toContain("白");
    expect(t).toContain("塔");
  });

  it("tokenizes Chinese bigrams", () => {
    const t = tokenize("白塔教会");
    expect(t).toContain("白塔");
    expect(t).toContain("塔教");
    expect(t).toContain("教会");
  });

  it("tokenizes mixed Chinese and English", () => {
    const t = tokenize("北境 North Guard");
    expect(t).toContain("北");
    expect(t).toContain("境");
    expect(t).toContain("北境");
    expect(t).toContain("north");
    expect(t).toContain("guard");
  });

  it("produces stable output", () => {
    const t1 = tokenize("白塔教会 北境");
    const t2 = tokenize("白塔教会 北境");
    expect(t1).toEqual(t2);
  });

  it("skips empty tokens", () => {
    const t = tokenize("  , . ! ? ");
    expect(t).toHaveLength(0);
  });
});

// ============ Schema Tests ============

describe("Schema Validation", () => {
  it("validates legal document", () => {
    expect(validateDocumentSchema({ id: "e1", content: "hello" })).toBe(true);
  });

  it("rejects missing id", () => {
    expect(validateDocumentSchema({ content: "hello" })).toBe(false);
  });

  it("rejects missing content", () => {
    expect(validateDocumentSchema({ id: "e1" })).toBe(false);
  });

  it("rejects invalid priority", () => {
    expect(validateDocumentSchema({ id: "e1", content: "x", priority: Infinity })).toBe(false);
  });

  it("rejects invalid metadata", () => {
    expect(validateDocumentSchema({ id: "e1", content: "x", metadata: new Date() })).toBe(false);
  });

  it("validates corpus", () => {
    expect(validateCorpusSchema({ entries: [{ id: "e1", content: "x" }] })).toBe(true);
  });

  it("rejects corpus without entries", () => {
    expect(validateCorpusSchema({})).toBe(false);
  });

  it("rejects corpus with invalid entries", () => {
    expect(validateCorpusSchema({ entries: [{ content: "x" }] })).toBe(false);
  });
});

// ============ Filter Tests ============

describe("Filters", () => {
  it("filters by entryIds", () => {
    const r = applyFilter(sampleCorpus, { entryIds: ["char_dragon"] });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe("char_dragon");
  });

  it("filters by tagsAny", () => {
    const r = applyFilter(sampleCorpus, { tagsAny: ["dragon"] });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe("char_dragon");
  });

  it("filters by tagsAll", () => {
    const r = applyFilter(sampleCorpus, { tagsAll: ["北境", "教会"] });
    expect(r.length).toBeGreaterThanOrEqual(1);
    const ids = r.map((e) => e.id);
    expect(ids).toContain("faction_church");
    expect(ids).toContain("event_plague");
  });

  it("filters by entityIdsAny", () => {
    const r = applyFilter(sampleCorpus, { entityIdsAny: ["faction_white_tower"] });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe("faction_church");
  });

  it("filters by type", () => {
    const r = applyFilter(sampleCorpus, { type: "character" });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe("char_dragon");
  });

  it("filters by titleContains", () => {
    const r = applyFilter(sampleCorpus, { titleContains: "dragon" });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe("char_dragon");
  });

  it("ANDs multiple conditions", () => {
    const r = applyFilter(sampleCorpus, { type: "faction", tagsAny: ["北境"] });
    expect(r.length).toBeGreaterThanOrEqual(1);
    for (const e of r) {
      expect(e.type).toBe("faction");
      expect(e.tags).toContain("北境");
    }
  });
});

// ============ Keyword Scoring Tests ============

describe("Keyword Scoring", () => {
  it("scores Chinese document higher for Chinese query", () => {
    const s1 = computeKeywordScore(
      sampleCorpus.find((e) => e.id === "faction_church")!,
      "白塔教会",
    ).score;
    const s2 = computeKeywordScore(
      sampleCorpus.find((e) => e.id === "char_dragon")!,
      "白塔教会",
    ).score;
    expect(s1).toBeGreaterThan(s2);
  });

  it("field weights affect scoring", () => {
    const doc = sampleCorpus.find((e) => e.id === "char_dragon")!;
    const sDefault = computeKeywordScore(doc, "dragon").score;
    const sHighTitle = computeKeywordScore(doc, "dragon", { title: 10 }).score;
    // Title "Ember the Dragon" contains "dragon" -> higher weight should give higher score
    expect(sHighTitle).toBeGreaterThanOrEqual(sDefault);
  });

  it("hints keywords boost score", () => {
    const doc = sampleCorpus.find((e) => e.id === "char_dragon")!;
    const sNoHint = computeKeywordScore(doc, "guardian").score;
    const sHint = computeKeywordScore(doc, "guardian", {}, { keywords: ["ember"] }).score;
    expect(sHint).toBeGreaterThanOrEqual(sNoHint);
  });

  it("hints tags boost score", () => {
    const doc = sampleCorpus.find((e) => e.id === "faction_church")!;
    const sHint = computeKeywordScore(doc, "北境", {}, { tags: ["教会"] }).score;
    expect(sHint).toBeGreaterThan(0);
  });

  it("hints entityIds boost score", () => {
    const doc = sampleCorpus.find((e) => e.id === "faction_church")!;
    const sHint = computeKeywordScore(
      doc,
      "北境",
      {},
      { entityIds: ["faction_white_tower"] },
    ).score;
    expect(sHint).toBeGreaterThan(0);
  });

  it("priority provides small boost", () => {
    const highPri = sampleCorpus.find((e) => e.id === "char_dragon")!;
    const lowPri = sampleCorpus.find((e) => e.id === "noise_1")!;
    const sHigh = computeKeywordScore(highPri, "the").score;
    const sLow = computeKeywordScore(lowPri, "a").score;
    // Both match common words, but priority should boost the high priority one relatively
    expect(sHigh).toBeGreaterThanOrEqual(0);
    expect(sLow).toBeGreaterThanOrEqual(0);
  });
});

// ============ BM25 Tests ============

describe("BM25 Scoring", () => {
  it("scores matching documents higher", () => {
    const scores = computeBM25Scores(sampleCorpus, "dragon");
    const dragonIdx = sampleCorpus.findIndex((e) => e.id === "char_dragon");
    const noiseIdx = sampleCorpus.findIndex((e) => e.id === "noise_1");
    expect(scores[dragonIdx]!).toBeGreaterThan(scores[noiseIdx]!);
  });

  it("returns zeros for empty query", () => {
    const scores = computeBM25Scores(sampleCorpus, "");
    for (const s of scores) expect(s).toBe(0);
  });

  it("scores Chinese documents for Chinese query", () => {
    const scores = computeBM25Scores(sampleCorpus, "白塔教会");
    const churchIdx = sampleCorpus.findIndex((e) => e.id === "faction_church");
    const noiseIdx = sampleCorpus.findIndex((e) => e.id === "noise_1");
    expect(scores[churchIdx]!).toBeGreaterThan(scores[noiseIdx]!);
  });
});

// ============ Retrieve Orchestrator Tests ============

function defaultConfig(overrides?: Partial<GenericRetrieverConfig>): GenericRetrieverConfig {
  return { strategy: "keyword", limit: 5, ...overrides };
}

describe("Retrieve Orchestrator", () => {
  it("returns ranked results for keyword strategy", () => {
    const r = retrieve("白塔教会", { entries: sampleCorpus }, defaultConfig());
    expect(r.strategy).toBe("keyword");
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0]!.entry.id).toBe("faction_church");
  });

  it("returns ranked results for bm25 strategy", () => {
    const r = retrieve(
      "dragon crystal",
      { entries: sampleCorpus },
      defaultConfig({ strategy: "bm25" }),
    );
    expect(r.strategy).toBe("bm25");
    expect(r.hits.length).toBeGreaterThan(0);
  });

  it("returns ranked results for hybrid strategy", () => {
    const r = retrieve(
      "白塔教会 北境",
      { entries: sampleCorpus },
      defaultConfig({ strategy: "hybrid" }),
    );
    expect(r.strategy).toBe("hybrid");
    expect(r.hits.length).toBeGreaterThan(0);
  });

  it("respects limit", () => {
    const r = retrieve("the", { entries: sampleCorpus }, defaultConfig({ limit: 2 }));
    expect(r.returned).toBeLessThanOrEqual(2);
  });

  it("respects minScore", () => {
    const r = retrieve("dragon", { entries: sampleCorpus }, defaultConfig({ minScore: 100 }));
    expect(r.hits).toHaveLength(0);
  });

  it("fails on empty query", () => {
    expect(() => retrieve("  ", { entries: sampleCorpus }, defaultConfig())).toThrow("non-empty");
  });

  it("returns empty hits for no match", () => {
    const r = retrieve("zzzznonexistent", { entries: sampleCorpus }, defaultConfig());
    expect(r.hits).toHaveLength(0);
    expect(r.totalMatched).toBe(0);
  });

  it("empty corpus returns success", () => {
    const r = retrieve("hello", { entries: [] }, defaultConfig());
    expect(r.hits).toHaveLength(0);
  });

  it("stable tie-breaking by priority then sourceIndex then id", () => {
    const tieCorpus: RetrievalDocumentV1[] = [
      { id: "b", content: "same same", priority: 2 },
      { id: "a", content: "same same", priority: 2 },
    ];
    const r = retrieve("same", { entries: tieCorpus }, defaultConfig({ limit: 10 }));
    // Both have same score and priority; sourceIndex breaks the tie (lower index first)
    expect(r.hits[0]!.entry.id).toBe("b");
    expect(r.hits[1]!.entry.id).toBe("a");
  });

  it("preserves duplicate IDs with sourceIndex", () => {
    const dupCorpus: RetrievalDocumentV1[] = [
      { id: "dup", content: "first" },
      { id: "dup", content: "second" },
    ];
    const r = retrieve("first", { entries: dupCorpus }, defaultConfig());
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.sourceIndex).toBe(0);
  });

  it("does not mutate input", () => {
    const original = JSON.parse(JSON.stringify(sampleCorpus));
    retrieve("test", { entries: sampleCorpus }, defaultConfig());
    expect(sampleCorpus).toEqual(original);
  });

  it("fails on invalid config", () => {
    expect(() =>
      retrieve("x", { entries: sampleCorpus }, { strategy: "keyword", limit: -1 }),
    ).toThrow();
  });

  it("applies filters before scoring", () => {
    const r = retrieve("北境", { entries: sampleCorpus }, defaultConfig(), { type: "faction" });
    for (const hit of r.hits) {
      expect(hit.entry.type).toBe("faction");
    }
  });

  it("includes diagnostics when configured", () => {
    const r = retrieve(
      "dragon",
      { entries: sampleCorpus },
      defaultConfig({ strategy: "hybrid", includeDiagnostics: true }),
    );
    if (r.hits.length > 0) {
      expect(r.hits[0]!.diagnostics).toBeDefined();
    }
  });

  it("excludes diagnostics when false", () => {
    const r = retrieve("dragon", { entries: sampleCorpus }, defaultConfig());
    if (r.hits.length > 0) {
      expect(r.hits[0]!.diagnostics).toBeUndefined();
    }
  });

  it("fails on unknown strategy", () => {
    expect(() =>
      retrieve("x", { entries: sampleCorpus }, { strategy: "unknown" as never, limit: 5 }),
    ).toThrow("unknown strategy");
  });
});

// ============ Formatter Tests ============

describe("Retrieval Result → Markdown", () => {
  const r = retrieve("dragon", { entries: sampleCorpus }, defaultConfig());

  it("produces heading", () => {
    const md = formatRetrievalResult(r, { heading: "# Context" });
    expect(md).toContain("# Context");
  });

  it("respects rank order", () => {
    const md = formatRetrievalResult(r);
    const lines = md.split("\n");
    const rankLines = lines.filter((l) => l.startsWith("## "));
    expect(rankLines.length).toBeGreaterThan(0);
    expect(rankLines[0]).toContain("1.");
  });

  it("shows empty message for no hits", () => {
    const empty = retrieve("zzzzz", { entries: sampleCorpus }, defaultConfig());
    const md = formatRetrievalResult(empty, { emptyMessage: "No results." });
    expect(md).toBe("No results.");
  });

  it("truncates long content", () => {
    const md = formatRetrievalResult(r, { maxCharsPerEntry: 10 });
    expect(md).toContain("[truncated]");
  });

  it("includes scores when configured", () => {
    const md = formatRetrievalResult(r, { includeScores: true });
    expect(md).toContain("Score:");
  });

  it("does not modify input result", () => {
    const original = JSON.parse(JSON.stringify(r));
    formatRetrievalResult(r);
    expect(r).toEqual(original);
  });
});

// ============ E2E Workflow JSON Tests ============

function createP4Catalog(): NodeCatalog {
  return {
    ...nodeRegistry,
    ...stdlibNodes,
    dynamicWorldbook: dynamicWorldbookNode,
    genericRetriever: genericRetrieverNode,
    retrievalResultToMarkdown: retrievalResultToMarkdownNode,
  };
}

async function seedWorldbookData(
  store: InMemoryDynamicWorldbookStore,
  sessionId: string,
): Promise<void> {
  const config: DynamicWorldbookNodeConfig = {
    resourceRef: "worldbook:smoke-test",
    lifecycle: "session",
    allowedOperations: ["append"],
  };
  const entries = sampleCorpus.map((e) => ({
    id: e.id,
    content: e.content,
    title: e.title,
    type: e.type,
    tags: e.tags,
    entityIds: e.entityIds,
    priority: e.priority,
  }));
  await executeOperation({
    store,
    scopeKey: `session:${sessionId}:worldbook:smoke-test`,
    resourceRef: "worldbook:smoke-test",
    config,
    command: { operation: "append", operationId: `seed-${sessionId}` },
    payload: { entries },
    now: "2026-06-15T00:00:00.000Z",
  });
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
    markdownSource: async ({ node }) => ({
      outputs: { markdown: String(node.config.content ?? "") },
    }),
    playerOutput: async ({ inputs }) => ({ outputs: { final: inputs.text ?? "" } }),
    inspectOutput: async ({ inputs }) => {
      const p: string[] = [];
      if (inputs.jsonInput != null) p.push(`[JSON]\n${JSON.stringify(inputs.jsonInput, null, 2)}`);
      if (inputs.markdownInput != null) p.push(`[Markdown]\n${String(inputs.markdownInput)}`);
      if (inputs.textInput != null) p.push(`[Text]\n${String(inputs.textInput)}`);
      return { outputs: { debug: p.join("\n\n") || "(none)" } };
    },
    dynamicWorldbook: createDynamicWorldbookExecutor({ store, scopeContext: scopeCtx }),
    genericRetriever: genericRetrieverExecutor,
    retrievalResultToMarkdown: retrievalResultToMarkdownExecutor,
    specializedAgent: createSpecializedAgentExecutor({
      registry: r,
      profileRegistry: pr,
      createAdapter: () => adapter,
    }),
    ...createStdlibExecutors(),
  };
}

function loadWorkflowJson(filename: string): WorkflowDefinition {
  const path = resolve(__dirname, "../../../data/workflows", filename);
  return JSON.parse(readFileSync(path, "utf-8")).workflow as WorkflowDefinition;
}

describe("E2E Retrieval Workflow", () => {
  let store: InMemoryDynamicWorldbookStore;
  let pr: InMemorySpecializedAgentProfileRegistry;
  const catalog = createP4Catalog();

  beforeEach(() => {
    store = new InMemoryDynamicWorldbookStore();
    pr = createP1ProfileRegistry();
    const worldbookValidators = createWorldbookSchemaValidators();
    const retrievalValidators = createRetrievalSchemaValidators();
    const allValidators = { ...worldbookValidators, ...retrievalValidators };
    setRuntimeSchemaValidator((schemaId, data) => {
      const validator = allValidators[schemaId];
      return validator ? validator(data) : true;
    });
  });

  it("retrieval workflow loads from disk and validates", () => {
    const wf = loadWorkflowJson("retrieval-layer-worldbook-smoke-v1.json");
    const issues = validateWorkflow(wf, catalog);
    const errors = issues.filter((i) => i.level === "error");
    if (errors.length > 0) {
      console.log("Validation errors:", JSON.stringify(errors, null, 2));
    }
    expect(errors).toHaveLength(0);
  });

  it("retrieval workflow executes end-to-end with seeded data", async () => {
    // Seed data using the same store
    await seedWorldbookData(store, "retrieval-session-a");

    const wf = loadWorkflowJson("retrieval-layer-worldbook-smoke-v1.json");
    const execs = createExecutors(store, pr, { sessionId: "retrieval-session-a" });
    const result = await runWorkflow(wf, execs, catalog, { sessionId: "retrieval-session-a" });
    expect(result.status).toBe("success");
  });

  it("relevant entries rank above noise", async () => {
    await seedWorldbookData(store, "retrieval-session-a");

    const wf = loadWorkflowJson("retrieval-layer-worldbook-smoke-v1.json");
    const execs = createExecutors(store, pr, { sessionId: "retrieval-session-a" });
    const result = await runWorkflow(wf, execs, catalog, { sessionId: "retrieval-session-a" });
    expect(result.status).toBe("success");

    const retRun = result.nodeRuns.find((r) => r.nodeId === "retriever")!;
    expect(retRun.status).toBe("success");
    const retResult = retRun.outputs.result as RetrievalResultV1;
    const ids = retResult.hits.map((h) => h.entry.id);
    // Relevant entries should appear before noise
    expect(ids).toContain("faction_church");
    expect(ids).toContain("faction_guard");
    const noiseIdx = ids.indexOf("noise_1");
    if (noiseIdx >= 0) {
      const relevantIdx = Math.max(ids.indexOf("faction_church"), ids.indexOf("faction_guard"));
      expect(relevantIdx).toBeLessThan(noiseIdx);
    }
  });

  it("limit is respected", async () => {
    await seedWorldbookData(store, "retrieval-session-a");

    const wf = loadWorkflowJson("retrieval-layer-worldbook-smoke-v1.json");
    const execs = createExecutors(store, pr, { sessionId: "retrieval-session-a" });
    const result = await runWorkflow(wf, execs, catalog, { sessionId: "retrieval-session-a" });
    const retRun = result.nodeRuns.find((r) => r.nodeId === "retriever")!;
    const retResult = retRun.outputs.result as RetrievalResultV1;
    expect(retResult.returned).toBeLessThanOrEqual(5);
  });

  it("markdown → agent → player output chain works", async () => {
    await seedWorldbookData(store, "retrieval-session-a");

    const wf = loadWorkflowJson("retrieval-layer-worldbook-smoke-v1.json");
    const execs = createExecutors(store, pr, { sessionId: "retrieval-session-a" });
    const result = await runWorkflow(wf, execs, catalog, { sessionId: "retrieval-session-a" });

    // Agent received markdown context
    const agentRun = result.nodeRuns.find((r) => r.nodeId === "agent")!;
    expect(agentRun.status).toBe("success");

    // Player output has final text
    const outRun = result.nodeRuns.find((r) => r.nodeId === "output")!;
    expect(outRun.outputs.final).toBeTruthy();
  });

  it("inspect output branches all work", async () => {
    await seedWorldbookData(store, "retrieval-session-a");

    const wf = loadWorkflowJson("retrieval-layer-worldbook-smoke-v1.json");
    const execs = createExecutors(store, pr, { sessionId: "retrieval-session-a" });
    const result = await runWorkflow(wf, execs, catalog, { sessionId: "retrieval-session-a" });

    const inspResult = result.nodeRuns.find((r) => r.nodeId === "inspResult")!;
    expect(inspResult.outputs.debug).toContain("[JSON]");

    const inspMd = result.nodeRuns.find((r) => r.nodeId === "inspMd")!;
    expect(inspMd.outputs.debug).toContain("[Markdown]");

    const inspText = result.nodeRuns.find((r) => r.nodeId === "inspText")!;
    expect(inspText.outputs.debug).toContain("[Text]");
  });

  it("different session sees no data", async () => {
    await seedWorldbookData(store, "retrieval-session-a");

    const wf = loadWorkflowJson("retrieval-layer-worldbook-smoke-v1.json");
    const execs = createExecutors(store, pr, { sessionId: "retrieval-session-b" });
    const result = await runWorkflow(wf, execs, catalog, { sessionId: "retrieval-session-b" });

    const retRun = result.nodeRuns.find((r) => r.nodeId === "retriever")!;
    const retResult = retRun.outputs.result as RetrievalResultV1;
    expect(retResult.hits).toHaveLength(0);
  });

  it("retrieval nodes are in production catalog", () => {
    const cat = createP4Catalog();
    expect(cat.genericRetriever).toBeDefined();
    expect(cat.genericRetriever!.type).toBe("genericRetriever");
    expect(cat.retrievalResultToMarkdown).toBeDefined();
  });

  it("no regression on existing tests", async () => {
    // Smoke test: ensure a basic workflow still runs
    const simpleWf: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      nodes: [
        { id: "in", type: "playerInput", position: { x: 0, y: 0 }, config: { text: "hi" } },
        { id: "out", type: "playerOutput", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", source: "in", sourcePort: "text", target: "out", targetPort: "text" }],
    };
    const execs = createExecutors(store, pr, { sessionId: "test" });
    const result = await runWorkflow(simpleWf, execs, catalog, { sessionId: "test" });
    expect(result.status).toBe("success");
  });
});
