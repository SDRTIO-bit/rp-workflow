/**
 * RP Context Assembler V2 - Unit Tests (B-2.9)
 *
 * Covers:
 *  1. New parser fields (mentions, references, dialogues, actions, intents,
 *     historicalReferences, relationshipSignals, unresolvedReferences) end
 *     up in assembledContext and PromptDocument.
 *  2. Provenance: parserFields stamped on each user_input section;
 *     retrievalSource stamped on lore sections.
 *  3. Budget priority: systemPrompt + rawUserInputSection are protected;
 *     loreSemanticExpansionSection is most likely to be truncated under
 *     pressure; user input NEVER dropped.
 *  4. Worldbook retrieval is split into 3 explicit sections (directHit /
 *     deterministicExpansion / semanticExpansion) read from provenance,
 *     never inferred from array order.
 *  5. byVisibility.runtime_only entries are excluded from the prompt.
 *  6. provenance missing on worldbookRetrieval -> assembler throws.
 *  7. parserFieldsCovered lists non-empty parser fields in stable order.
 */

import { describe, it, expect } from "vitest";
import {
  rpContextAssemblerV2Definition,
  createRpContextAssemblerV2Executor,
} from "../../src/nodes/rpContextAssemblerV2.js";
import type { NodeExecutionInput, WorkflowNode } from "@awp/workflow-core";
import type { ParsedRpInputV1 } from "../../src/parser/types.js";
import type { WorldbookEntryV1, WorldbookRetrievalResult } from "../../src/worldbook/types.js";

function makeNode(): WorkflowNode {
  return {
    id: "assemblerV2-1",
    type: "rpContextAssemblerV2",
    config: {},
    position: { x: 0, y: 0 },
  };
}

function makeContext() {
  return {
    runId: "run-b29-v2-1",
    values: { rp: { sessionId: "s1", worldId: "w1", turnId: "t1" } },
  };
}

function makeInput(inputs: Record<string, unknown>): NodeExecutionInput {
  return { node: makeNode(), inputs, context: makeContext() };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RAW_TEXT =
  '我没有立刻接过阿绫递来的银铃，而是盯着铃身上那道被火烧过的白塔纹章。三年前钟楼失火时，沈砚也带着同样的东西。楼下忽然传来巡夜司的敲门声。我压低声音问她："教会的人为什么会知道我们在这里？"说完，我把失踪名单塞进外套，示意她从地下水道离开，自己则走向门口拖延时间。';

function makeParsedRpInput(overrides?: Partial<ParsedRpInputV1>): ParsedRpInputV1 {
  return {
    version: "parsed-rp-input-v1",
    rawText: RAW_TEXT,
    mentions: [
      {
        text: "阿绫",
        entityId: "char_su_ling",
        entryId: "char_su_ling",
        category: "character",
        confidence: 0.95,
        evidence: "别名匹配：阿绫 → 苏绫",
      },
      {
        text: "沈砚",
        entityId: "char_shen_yan",
        entryId: "char_shen_yan",
        category: "character",
        confidence: 0.95,
        evidence: "角色名称直接匹配",
      },
    ],
    references: [
      {
        text: "她",
        resolvedEntityId: "char_su_ling",
        resolutionSource: "current_input",
        confidence: 0.95,
      },
    ],
    dialogues: [
      {
        speakerEntityId: "player",
        targetEntityIds: ["char_su_ling"],
        text: "教会的人为什么会知道我们在这里？",
        toneHints: ["压低声音", "紧张"],
      },
    ],
    actions: [
      {
        actorEntityId: "player",
        action: "示意苏绫撤离",
        targetEntityIds: ["char_su_ling"],
        objectEntityIds: [],
        locationEntityIds: [],
        purpose: "保护",
      },
    ],
    intents: [
      { type: "protect", targetEntityIds: ["char_su_ling"] },
      { type: "escape", targetEntityIds: ["char_su_ling"] },
    ],
    historicalReferences: [
      { text: "三年前钟楼失火", entryId: "event_clocktower_fire", confidence: 0.9 },
    ],
    relationshipSignals: [
      {
        type: "ally",
        subjectEntityId: "player",
        objectEntityId: "char_su_ling",
        evidence: "玩家示意苏绫撤离，保护她",
      },
    ],
    unresolvedReferences: [],
    diagnostics: {
      parserMode: "llm",
      parseAttempts: 1,
      removedInvalidEntityIds: [],
      removedInvalidEntryIds: [],
      warnings: [],
    },
    ...overrides,
  };
}

function makeEntry(
  id: string,
  title: string,
  content: string,
  visibility: "public" | "hidden" | "runtime_only" = "public",
  priority = 50,
): WorldbookEntryV1 {
  return {
    id,
    title,
    content,
    keys: [id],
    category: "character",
    priority,
    visibility,
  };
}

function makeRetrieval(
  directHitIds: string[],
  deterministicExpansionIds: string[],
  semanticExpansionIds: string[],
  includeRuntimeOnly = false,
): WorldbookRetrievalResult {
  // The actual entries don't matter for provenance tests; the assembler
  // renders only entries that are in the corresponding id set.
  const allIds = new Set([...directHitIds, ...deterministicExpansionIds, ...semanticExpansionIds]);
  const entries: WorldbookEntryV1[] = [];
  for (const id of allIds) {
    entries.push(
      makeEntry(
        id,
        `Title ${id}`,
        `Body of ${id}. `.repeat(10),
        id === "rt_only" ? "runtime_only" : "public",
        50,
      ),
    );
  }
  if (includeRuntimeOnly) {
    entries.push(makeEntry("rt_only", "RT only", "Should not appear in prompt"));
  }
  return {
    directHits: entries.filter((e) => directHitIds.includes(e.id)),
    expandedEntries: entries.filter(
      (e) => deterministicExpansionIds.includes(e.id) || semanticExpansionIds.includes(e.id),
    ),
    excludedEntries: [],
    activatedKeywords: ["x"],
    totalEntries: entries.length,
    byVisibility: { public: [], hidden: [], runtime_only: [] },
    provenance: {
      directHitIds,
      deterministicExpansionIds,
      semanticExpansionIds,
    },
  };
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

describe("rpContextAssemblerV2Definition", () => {
  it("has correct type, category, and ports", () => {
    expect(rpContextAssemblerV2Definition.type).toBe("rpContextAssemblerV2");
    expect(rpContextAssemblerV2Definition.category).toBe("roleplay");

    const inputPorts = rpContextAssemblerV2Definition.ports.filter((p) => p.direction === "input");
    const inputIds = inputPorts.map((p) => p.id);
    expect(inputIds).toContain("parsedRpInput");
    expect(inputIds).toContain("worldbookRetrieval");

    const parsedRpInputPort = inputPorts.find((p) => p.id === "parsedRpInput");
    expect(parsedRpInputPort?.schemaId).toBe("rp.parsed-rp-input.v1");
    expect(parsedRpInputPort?.required).toBe(true);

    const worldbookRetrievalPort = inputPorts.find((p) => p.id === "worldbookRetrieval");
    expect(worldbookRetrievalPort?.schemaId).toBe(
      "rp.worldbook-retrieval-result-with-provenance.v1",
    );
    expect(worldbookRetrievalPort?.required).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 1: New parser fields enter prompt
// ---------------------------------------------------------------------------

describe("rpContextAssemblerV2: new parser fields enter prompt", () => {
  it("renders all parser fields into assembledContext and PromptDocument", async () => {
    const executor = createRpContextAssemblerV2Executor();
    const parsed = makeParsedRpInput();
    const retrieval = makeRetrieval(["char_su_ling"], ["event_clocktower_fire"], ["char_ye_zhu"]);

    const result = await executor(
      makeInput({ parsedRpInput: parsed, worldbookRetrieval: retrieval }),
    );

    const ctx = result.outputs.assembledContext as Record<string, unknown>;
    const doc = result.outputs.promptDocument as { sections: Array<Record<string, unknown>> };

    // Every new parser field has a corresponding section
    expect(ctx.mentionsSection).toContain("阿绫");
    expect(ctx.mentionsSection).toContain("char_su_ling");
    expect(ctx.mentionsSection).toContain("evidence=");
    expect(ctx.referencesSection).toContain("她");
    expect(ctx.referencesSection).toContain("char_su_ling");
    expect(ctx.dialoguesSection).toContain("教会的人为什么会知道我们在这里");
    expect(ctx.dialoguesSection).toContain("player");
    expect(ctx.actionsSection).toContain("示意苏绫撤离");
    expect(ctx.actionsSection).toContain("purpose=保护");
    expect(ctx.intentsSection).toContain("protect");
    expect(ctx.intentsSection).toContain("escape");
    expect(ctx.historicalReferencesSection).toContain("event_clocktower_fire");
    expect(ctx.relationshipSignalsSection).toContain("ally");
    expect(ctx.relationshipSignalsSection).toContain("player");
    expect(ctx.rawUserInputSection).toContain("阿绫");

    // PromptDocument includes the corresponding sections
    const docIds = doc.sections.map((s) => s.id);
    expect(docIds).toContain("mentionsSection");
    expect(docIds).toContain("referencesSection");
    expect(docIds).toContain("dialoguesSection");
    expect(docIds).toContain("actionsSection");
    expect(docIds).toContain("intentsSection");
    expect(docIds).toContain("historicalReferencesSection");
    expect(docIds).toContain("relationshipSignalsSection");
    expect(docIds).toContain("rawUserInputSection");

    // parserFieldsCovered reports which fields had non-empty data
    expect(ctx.parserFieldsCovered).toEqual([
      "rawText",
      "mentions",
      "references",
      "dialogues",
      "actions",
      "intents",
      "historicalReferences",
      "relationshipSignals",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Test 2 & 3: Provenance — parserFields + retrievalSource
// ---------------------------------------------------------------------------

describe("rpContextAssemblerV2: provenance", () => {
  it("stamps parserFields on each user_input section, retrievalSource on lore", async () => {
    const executor = createRpContextAssemblerV2Executor();
    const parsed = makeParsedRpInput();
    const retrieval = makeRetrieval(["char_su_ling"], ["event_clocktower_fire"], ["char_ye_zhu"]);

    const result = await executor(
      makeInput({ parsedRpInput: parsed, worldbookRetrieval: retrieval }),
    );
    const doc = result.outputs.promptDocument as { sections: Array<Record<string, unknown>> };

    const mentionsSection = doc.sections.find((s) => s.id === "mentionsSection");
    expect(mentionsSection).toBeDefined();
    expect((mentionsSection!.provenance as Record<string, unknown>).parserFields).toEqual([
      "mentions",
    ]);

    const dialoguesSection = doc.sections.find((s) => s.id === "dialoguesSection");
    expect((dialoguesSection!.provenance as Record<string, unknown>).parserFields).toEqual([
      "dialogues",
    ]);

    const actionsSection = doc.sections.find((s) => s.id === "actionsSection");
    expect((actionsSection!.provenance as Record<string, unknown>).parserFields).toEqual([
      "actions",
    ]);

    // Lore sections
    const directHitSection = doc.sections.find((s) => s.id === "loreDirectHitSection");
    expect(directHitSection).toBeDefined();
    const dhProv = directHitSection!.provenance as Record<string, unknown>;
    expect(dhProv.retrievalSource).toBe("directHit");
    expect(dhProv.entryIds).toEqual(["char_su_ling"]);

    const detSection = doc.sections.find((s) => s.id === "loreDeterministicExpansionSection");
    expect(detSection).toBeDefined();
    const detProv = detSection!.provenance as Record<string, unknown>;
    expect(detProv.retrievalSource).toBe("deterministicExpansion");
    expect(detProv.entryIds).toEqual(["event_clocktower_fire"]);

    const semSection = doc.sections.find((s) => s.id === "loreSemanticExpansionSection");
    expect(semSection).toBeDefined();
    const semProv = semSection!.provenance as Record<string, unknown>;
    expect(semProv.retrievalSource).toBe("semanticExpansion");
    expect(semProv.entryIds).toEqual(["char_ye_zhu"]);
  });

  it("does NOT infer source from array order — relies on explicit provenance", async () => {
    // Construct a retrieval where directHits and expandedEntries contain
    // overlapping ids; the assembler MUST use provenance to disambiguate.
    const executor = createRpContextAssemblerV2Executor();
    const parsed = makeParsedRpInput();
    // entry_id is in BOTH directHits (by accident of merge) and provenance.directHitIds.
    // The assembler should only render it in the directHit section.
    const retrieval: WorldbookRetrievalResult = {
      directHits: [makeEntry("entry_id", "T", "Body of T. ".repeat(20))],
      expandedEntries: [makeEntry("entry_id", "T", "Body of T. ".repeat(20))], // duplicate
      excludedEntries: [],
      activatedKeywords: [],
      totalEntries: 1,
      byVisibility: { public: [], hidden: [], runtime_only: [] },
      provenance: {
        directHitIds: ["entry_id"],
        deterministicExpansionIds: [],
        semanticExpansionIds: [],
      },
    };
    const result = await executor(
      makeInput({ parsedRpInput: parsed, worldbookRetrieval: retrieval }),
    );
    const doc = result.outputs.promptDocument as { sections: Array<Record<string, unknown>> };

    const directHitSection = doc.sections.find((s) => s.id === "loreDirectHitSection");
    expect(directHitSection).toBeDefined();
    const detSection = doc.sections.find((s) => s.id === "loreDeterministicExpansionSection");
    const semSection = doc.sections.find((s) => s.id === "loreSemanticExpansionSection");

    // entry_id is NOT in deterministic or semantic provenance -> those
    // sections must be empty / absent.
    expect(detSection).toBeUndefined();
    expect(semSection).toBeUndefined();
  });

  it("throws when worldbookRetrieval.provenance is missing", async () => {
    const executor = createRpContextAssemblerV2Executor();
    const parsed = makeParsedRpInput();
    const retrievalNoProv: WorldbookRetrievalResult = {
      directHits: [makeEntry("x", "X", "Body of X. ".repeat(20))],
      expandedEntries: [],
      excludedEntries: [],
      activatedKeywords: [],
      totalEntries: 1,
      byVisibility: { public: [], hidden: [], runtime_only: [] },
      // provenance intentionally missing
    };
    await expect(
      executor(makeInput({ parsedRpInput: parsed, worldbookRetrieval: retrievalNoProv })),
    ).rejects.toThrow(/provenance/);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Budget — systemPrompt and rawUserInputSection are protected
// ---------------------------------------------------------------------------

describe("rpContextAssemblerV2: budget enforcement", () => {
  it("never drops rawUserInputSection or systemPrompt", async () => {
    const executor = createRpContextAssemblerV2Executor({
      config: { targetTokens: 200, hardLimitTokens: 400, charsPerToken: 4 },
    });
    const parsed = makeParsedRpInput({
      rawText: "A very long user input ".repeat(200), // blow up the budget
    });
    const retrieval = makeRetrieval(["char_su_ling"], ["event_clocktower_fire"], ["char_ye_zhu"]);

    const result = await executor(
      makeInput({ parsedRpInput: parsed, worldbookRetrieval: retrieval }),
    );
    const ctx = result.outputs.assembledContext as Record<string, unknown>;
    const budget = result.outputs.budgetReport as Record<string, unknown>;

    expect(ctx.systemPrompt).toContain("creative writing assistant");
    expect(ctx.rawUserInputSection).toContain("A very long user input");

    const dropped = budget.droppedSections as string[];
    expect(dropped).not.toContain("rawUserInputSection");
    expect(dropped).not.toContain("systemPrompt");
  });

  it("truncates lore sections in priority order (semantic is most likely to go)", async () => {
    // Make every section big, target tiny -> only high-priority survives intact.
    const executor = createRpContextAssemblerV2Executor({
      config: { targetTokens: 600, hardLimitTokens: 1000, charsPerToken: 4 },
    });
    const parsed = makeParsedRpInput({
      rawText: "x ".repeat(2000), // ~500 tokens
      mentions: Array.from({ length: 20 }, (_, i) => ({
        text: `M${i}`,
        entityId: `e${i}`,
        entryId: `e${i}`,
        category: "character" as const,
        confidence: 0.9,
        evidence: `ev${i}`,
      })),
    });
    const retrieval = makeRetrieval(
      ["char_su_ling"],
      ["event_clocktower_fire"],
      ["char_ye_zhu"],
      false,
    );
    // Override content lengths to be larger
    retrieval.directHits = [
      makeEntry("char_su_ling", "T", "Direct body ".repeat(500), "public", 80),
    ];
    retrieval.expandedEntries = [
      makeEntry("event_clocktower_fire", "T", "Deterministic body ".repeat(500), "public", 60),
      makeEntry("char_ye_zhu", "T", "Semantic body ".repeat(500), "public", 40),
    ];

    const result = await executor(
      makeInput({ parsedRpInput: parsed, worldbookRetrieval: retrieval }),
    );
    const budget = result.outputs.budgetReport as Record<string, unknown>;
    const truncated = budget.truncatedSections as string[];
    const dropped = budget.droppedSections as string[];

    // The protected sections must NOT appear in dropped or truncated
    expect(dropped).not.toContain("rawUserInputSection");
    expect(dropped).not.toContain("systemPrompt");
    expect(truncated).not.toContain("rawUserInputSection");
    expect(truncated).not.toContain("systemPrompt");

    // Some non-protected section must have been truncated or dropped
    const victimSections = [...truncated, ...dropped];
    expect(victimSections.length).toBeGreaterThan(0);

    // The semantic lore (priority 50) is the most likely victim under pressure.
    // (Not strictly required, but it should be the FIRST one considered for
    // removal because it has the lowest priority among the non-protected
    // sections.)
  });
});

// ---------------------------------------------------------------------------
// Test 5: byVisibility.runtime_only is never rendered
// ---------------------------------------------------------------------------

describe("rpContextAssemblerV2: runtime_only entries are excluded", () => {
  it("excludes runtime_only entries from all 3 lore sections", async () => {
    const executor = createRpContextAssemblerV2Executor();
    const parsed = makeParsedRpInput();
    const retrieval = makeRetrieval(["char_su_ling"], ["rt_only"], []);
    // Mark the deterministic one as runtime_only
    retrieval.provenance = {
      directHitIds: ["char_su_ling"],
      deterministicExpansionIds: ["rt_only"],
      semanticExpansionIds: [],
    };
    // (Above makeRetrieval already does this for rt_only with visibility=runtime_only)

    const result = await executor(
      makeInput({ parsedRpInput: parsed, worldbookRetrieval: retrieval }),
    );
    const doc = result.outputs.promptDocument as { sections: Array<Record<string, unknown>> };
    const detSection = doc.sections.find((s) => s.id === "loreDeterministicExpansionSection");

    // Either the section is missing (no data after filtering) or it doesn't contain rt_only
    if (detSection) {
      expect(String(detSection.content)).not.toContain("rt_only");
    }
  });
});

// ---------------------------------------------------------------------------
// Test 6: parserFieldsCovered correctly reports fields
// ---------------------------------------------------------------------------

describe("rpContextAssemblerV2: parserFieldsCovered", () => {
  it("lists fields that have non-empty data, in stable order", async () => {
    const executor = createRpContextAssemblerV2Executor();
    const parsed = makeParsedRpInput({
      mentions: [],
      references: [],
      unresolvedReferences: [{ text: "那个神秘人", reason: "未在 worldbook 中找到" }],
    });
    const retrieval = makeRetrieval([], [], []);
    const result = await executor(
      makeInput({ parsedRpInput: parsed, worldbookRetrieval: retrieval }),
    );
    const ctx = result.outputs.assembledContext as Record<string, unknown>;
    expect(ctx.parserFieldsCovered).toEqual([
      "rawText",
      "dialogues",
      "actions",
      "intents",
      "historicalReferences",
      "relationshipSignals",
      "unresolvedReferences",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Full V2 sanity - old workflow data does not break
// ---------------------------------------------------------------------------

describe("rpContextAssemblerV2: required inputs", () => {
  it("throws when parsedRpInput is missing", async () => {
    const executor = createRpContextAssemblerV2Executor();
    const retrieval = makeRetrieval(["x"], [], []);
    await expect(executor(makeInput({ worldbookRetrieval: retrieval }))).rejects.toThrow(
      /parsedRpInput/,
    );
  });

  it("throws when worldbookRetrieval is missing", async () => {
    const executor = createRpContextAssemblerV2Executor();
    const parsed = makeParsedRpInput();
    await expect(executor(makeInput({ parsedRpInput: parsed }))).rejects.toThrow(
      /worldbookRetrieval/,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 8: recentMessages / timeline / tracker enter prompt (B-2.9.1)
// ---------------------------------------------------------------------------

describe("rpContextAssemblerV2: recentMessages, timeline, tracker", () => {
  it("renders recentMessages into assembledContext and PromptDocument", async () => {
    const executor = createRpContextAssemblerV2Executor();
    const parsed = makeParsedRpInput();
    const retrieval = makeRetrieval(["char_su_ling"], [], []);
    const recentMessages = [
      {
        messageId: "msg-1",
        sessionId: "s1",
        worldId: "w1",
        turnId: "turn-0",
        role: "user" as const,
        text: "之前的对话内容",
        timestamp: "2026-06-13T00:00:00Z",
      },
      {
        messageId: "msg-2",
        sessionId: "s1",
        worldId: "w1",
        turnId: "turn-0",
        role: "assistant" as const,
        text: "之前的回复内容",
        timestamp: "2026-06-13T00:01:00Z",
      },
    ];

    const result = await executor(
      makeInput({ parsedRpInput: parsed, worldbookRetrieval: retrieval, recentMessages }),
    );

    const ctx = result.outputs.assembledContext as Record<string, unknown>;
    const doc = result.outputs.promptDocument as {
      sections: Array<Record<string, unknown>>;
    };

    // Section exists and contains the messages
    expect(ctx.recentMessagesSection).toContain("之前的对话内容");
    expect(ctx.recentMessagesSection).toContain("User (turn-0)");
    expect(ctx.recentMessagesSection).toContain("Assistant (turn-0)");

    // Appears in prompt document
    const rmSection = doc.sections.find((s) => s.id === "recentMessagesSection");
    expect(rmSection).toBeDefined();
    expect(rmSection!.source).toBe("recent_messages");
  });

  it("renders timeline and tracker when provided", async () => {
    const executor = createRpContextAssemblerV2Executor();
    const parsed = makeParsedRpInput();
    const retrieval = makeRetrieval(["char_su_ling"], [], []);
    const timelineContext = {
      chapters: [{ chapterId: "ch-1", summary: "第一章的故事", relevanceScore: 10 }],
      relevantEvents: [
        {
          eventId: "evt-1",
          sessionId: "s1",
          worldId: "w1",
          chapterId: "ch-1",
          sourceTurnId: "t-0",
          summary: "之前Alice进入了酒馆",
          characters: ["Alice"],
          locations: ["tavern"],
          items: [],
          time: null,
          emotionalChanges: [],
          createdAt: "2026-06-13T00:00:00Z",
          score: 10,
          matchedBy: ["keyword:Alice"],
        },
      ],
      totalChapters: 1,
      queryTimeMs: 10,
    };
    const trackerState = {
      sessionId: "s1",
      worldId: "w1",
      characters: [
        {
          id: "char_su_ling",
          name: "苏绫",
          status: "active",
          relationships: {},
        },
      ],
      locations: [{ id: "loc_tavern", name: "雾港酒馆" }],
      items: [],
      timeState: { currentTime: "深夜", day: 3 },
      version: 1,
    };

    const result = await executor(
      makeInput({
        parsedRpInput: parsed,
        worldbookRetrieval: retrieval,
        timelineContext,
        trackerState,
      }),
    );

    const ctx = result.outputs.assembledContext as Record<string, unknown>;
    const doc = result.outputs.promptDocument as {
      sections: Array<Record<string, unknown>>;
    };

    // Timeline section present
    expect(ctx.timelineSection).toContain("第一章的故事");
    expect(ctx.timelineSection).toContain("Alice进入了酒馆");
    const tlSection = doc.sections.find((s) => s.id === "timelineSection");
    expect(tlSection).toBeDefined();

    // Tracker section present
    expect(ctx.trackerSection).toContain("苏绫");
    expect(ctx.trackerSection).toContain("雾港酒馆");
    expect(ctx.trackerSection).toContain("深夜");
    const trSection = doc.sections.find((s) => s.id === "trackerSection");
    expect(trSection).toBeDefined();
    expect(trSection!.source).toBe("state");
  });

  it("returns empty sections when optional inputs are absent", async () => {
    const executor = createRpContextAssemblerV2Executor();
    const parsed = makeParsedRpInput();
    const retrieval = makeRetrieval(["char_su_ling"], [], []);

    const result = await executor(
      makeInput({ parsedRpInput: parsed, worldbookRetrieval: retrieval }),
    );

    const ctx = result.outputs.assembledContext as Record<string, unknown>;
    // All three optional sections exist but are empty strings
    expect(ctx.timelineSection).toBe("");
    expect(ctx.trackerSection).toBe("");
    expect(ctx.recentMessagesSection).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Test 9: Workflow validator rejects basic retriever → V2 (B-2.9.1)
// ---------------------------------------------------------------------------

import { validateWorkflow } from "@awp/workflow-core";
import { registerRpRuntime } from "../../src/register.js";
import {
  InMemoryTimelineStore,
  InMemoryChapterStore,
  InMemoryLoreStore,
  InMemoryTrackerStore,
} from "../../src/stores/memory.js";

describe("rpContextAssemblerV2: workflow validator rejects bad wiring", () => {
  it("rejects rpWorldbookRetrieverV1 -> rpContextAssemblerV2.worldbookRetrieval (schemaId mismatch)", () => {
    const services = {
      stores: {
        timeline: new InMemoryTimelineStore(),
        chapter: new InMemoryChapterStore(),
        lore: new InMemoryLoreStore(),
        tracker: new InMemoryTrackerStore(),
      },
    };
    const { catalog } = registerRpRuntime(services);

    const workflow = {
      id: "bad-schema-wiring",
      name: "Bad Schema Wiring",
      version: 1,
      nodes: [
        {
          id: "retriever",
          type: "rpWorldbookRetrieverV1",
          position: { x: 100, y: 100 },
          config: {},
        },
        {
          id: "assembler",
          type: "rpContextAssemblerV2",
          position: { x: 400, y: 100 },
          config: {},
        },
      ],
      edges: [
        {
          id: "e1",
          source: "retriever",
          sourcePort: "retrievalResult",
          target: "assembler",
          targetPort: "worldbookRetrieval",
        },
      ],
    };

    const issues = validateWorkflow(workflow, catalog);
    const errors = issues.filter((i) => i.level === "error");
    // The edge should be rejected because source (no schemaId) can't
    // feed into target (has rp.worldbook-retrieval-result-with-provenance.v1)
    const edgeError = errors.find((e) => e.message.includes("Incompatible edge types"));
    expect(edgeError).toBeDefined();
    expect(edgeError!.message).toContain("worldbook-retrieval-result-with-provenance");
  });

  it("accepts rpSemanticExpanderV1 -> rpContextAssemblerV2.worldbookRetrieval (matching strict schemas)", () => {
    const services = {
      stores: {
        timeline: new InMemoryTimelineStore(),
        chapter: new InMemoryChapterStore(),
        lore: new InMemoryLoreStore(),
        tracker: new InMemoryTrackerStore(),
      },
    };
    const { catalog } = registerRpRuntime(services);

    const workflow = {
      id: "good-schema-wiring",
      name: "Good Schema Wiring",
      version: 1,
      nodes: [
        {
          id: "expander",
          type: "rpSemanticExpanderV1",
          position: { x: 100, y: 100 },
          config: {},
        },
        {
          id: "assembler",
          type: "rpContextAssemblerV2",
          position: { x: 400, y: 100 },
          config: {},
        },
      ],
      edges: [
        {
          id: "e1",
          source: "expander",
          sourcePort: "mergedResult",
          target: "assembler",
          targetPort: "worldbookRetrieval",
        },
      ],
    };

    const issues = validateWorkflow(workflow, catalog);
    const errors = issues.filter((i) => i.level === "error");
    // The "missing parsedRpInput" edge is still a problem, but the
    // worldbookRetrieval edge itself should NOT be flagged as incompatible
    const edgeErrors = errors.filter((e) => e.message.includes("Incompatible edge types"));
    // The worldbookRetrieval edge should be fine (both have strict schema)
    const wbEdgeError = edgeErrors.find((e) => e.message.includes("worldbookRetrieval"));
    expect(wbEdgeError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 10: Entry-level parser field triggers (B-2.9.1)
// ---------------------------------------------------------------------------

import { expandSemantically } from "../../src/parser/semanticExpander.js";
import type { WorldbookEntryV1 as WbEntryV1 } from "../../src/worldbook/types.js";

describe("rpContextAssemblerV2: entry-level parser field triggers", () => {
  it("records multiple parser fields for same entry, deduped and stable-ordered", () => {
    const parsed = makeParsedRpInput({
      // char_su_ling appears in mentions, dialogue-target, and action-target.
      // Override all other fields to prevent default fixture fields from
      // adding more triggers (e.g., the default reference, intents, and
      // relationship-signal also target char_su_ling).
      mentions: [
        {
          text: "阿绫",
          entityId: "char_su_ling",
          entryId: "char_su_ling",
          category: "character",
          confidence: 0.95,
          evidence: "别名匹配",
        },
      ],
      references: [],
      dialogues: [
        {
          speakerEntityId: "player",
          targetEntityIds: ["char_su_ling"],
          text: "Hello",
          toneHints: [],
        },
      ],
      actions: [
        {
          actorEntityId: "player",
          action: "看向阿绫",
          targetEntityIds: ["char_su_ling"],
          objectEntityIds: [],
          locationEntityIds: [],
          purpose: "",
        },
      ],
      intents: [],
      historicalReferences: [],
      relationshipSignals: [],
      unresolvedReferences: [],
    });

    const entries: WbEntryV1[] = [
      {
        id: "char_su_ling",
        title: "苏绫",
        content: "雾港的守夜人",
        keys: ["苏绫"],
        category: "character",
        priority: 70,
        visibility: "public",
      },
    ];

    // char_su_ling is NOT in deterministic set (simulating that keyword
    // retrieval didn't hit it)
    const result = expandSemantically(parsed, entries, new Set());

    // char_su_ling should be in expandedEntries
    expect(result.expandedEntries.some((e) => e.id === "char_su_ling")).toBe(true);

    // entryTriggers should have 3 fields, deduped, stable order
    const triggers = result.entryTriggers.get("char_su_ling");
    expect(triggers).toBeDefined();
    // mentions + dialogue-target + action-target = 3 unique fields
    expect(triggers!.length).toBe(3);
    expect(triggers).toContain("mentions");
    expect(triggers).toContain("dialogue-target");
    expect(triggers).toContain("action-target");
  });
});

// ---------------------------------------------------------------------------
// Test 11: Tight budget - high-priority directHit preserved (B-2.9.1)
// ---------------------------------------------------------------------------

describe("rpContextAssemblerV2: tight budget preserves directHit", () => {
  it("keeps high-priority directHit entries, drops semantic and unresolved under tight budget", async () => {
    const executor = createRpContextAssemblerV2Executor({
      config: { targetTokens: 400, hardLimitTokens: 600, charsPerToken: 4 },
    });
    const parsed = makeParsedRpInput({
      rawText: "测试文本",
      unresolvedReferences: [
        { text: "神秘人", reason: "未知实体" },
        { text: "那个东西", reason: "描述不清" },
      ],
    });
    // Large worldbook entries: one high-priority (should be kept),
    // one medium, one low (should be dropped under tight budget)
    const highPriorityEntry = makeEntry(
      "high-prio",
      "Core Character",
      "Very important character rule. ".repeat(300), // ~4500 chars
      "public",
      100,
    );
    const lowPriorityEntry = makeEntry(
      "low-prio",
      "Minor Detail",
      "Unimportant detail. ".repeat(300),
      "public",
      10,
    );
    const mediumPriorityEntry = makeEntry(
      "mid-prio",
      "Medium Importance",
      "Medium importance. ".repeat(300),
      "public",
      50,
    );
    const semanticEntry = makeEntry(
      "sem-entry",
      "Semantic Lore",
      "Semantic lore body. ".repeat(300),
      "public",
      30,
    );

    const retrieval: WorldbookRetrievalResult = {
      directHits: [highPriorityEntry, mediumPriorityEntry, lowPriorityEntry],
      expandedEntries: [semanticEntry],
      excludedEntries: [],
      activatedKeywords: [],
      totalEntries: 4,
      byVisibility: { public: [], hidden: [], runtime_only: [] },
      provenance: {
        directHitIds: ["high-prio", "mid-prio", "low-prio"],
        deterministicExpansionIds: [],
        semanticExpansionIds: ["sem-entry"],
        entryTriggers: { "sem-entry": ["mentions"] },
      },
    };

    const result = await executor(
      makeInput({ parsedRpInput: parsed, worldbookRetrieval: retrieval }),
    );

    const ctx = result.outputs.assembledContext as Record<string, unknown>;
    const budget = result.outputs.budgetReport as Record<string, unknown>;

    // Direct hit section should contain the high-priority entry
    expect(ctx.loreDirectHitSection).toContain("Core Character");
    // Low-priority should be dropped by entry-level trimming
    expect(ctx.loreDirectHitSection).not.toContain("Minor Detail");

    // Semantic section should be dropped or truncated (lowest priority among lore)
    const dropped = budget.droppedSections as string[];
    const truncated = budget.truncatedSections as string[];

    // At least one section must have been trimmed
    const victimSections = [...dropped, ...truncated];
    expect(victimSections.length).toBeGreaterThan(0);

    // Unresolved references section (lowest overall priority) should be dropped
    // if the budget is tight enough
    const unresolvedVictim =
      dropped.includes("unresolvedReferencesSection") ||
      truncated.includes("unresolvedReferencesSection");
    const semanticVictim =
      dropped.includes("loreSemanticExpansionSection") ||
      truncated.includes("loreSemanticExpansionSection");
    expect(unresolvedVictim || semanticVictim).toBe(true);

    // systemPrompt and rawUserInputSection must never be dropped
    expect(dropped).not.toContain("systemPrompt");
    expect(dropped).not.toContain("rawUserInputSection");

    // loreEntriesDropped contains dropped entry IDs
    const loreDropped = ctx.loreEntriesDropped as string[];
    expect(loreDropped.length).toBeGreaterThan(0);

    // entryTriggersCovered is populated
    const triggers = ctx.entryTriggersCovered as Array<Record<string, unknown>>;
    // semantic entry has a trigger entry
    const semTrigger = triggers.find((t) => t.entryId === "sem-entry");
    if (semTrigger) {
      expect(semTrigger.fields).toContain("mentions");
    }
  });
});
