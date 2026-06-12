import { describe, it, expect, beforeEach } from "vitest";
import {
  rpLoreRetrieverV1Definition,
  createRpLoreRetrieverV1Executor,
} from "../../src/nodes/rpLoreRetrieverV1.js";
import type { NodeExecutionInput, WorkflowNode } from "@awp/workflow-core";
import {
  InMemoryTimelineStore,
  InMemoryChapterStore,
  InMemoryLoreStore,
  InMemoryTrackerStore,
} from "../../src/stores/memory.js";
import type { LoreEntry } from "../../src/types.js";

function makeNode(): WorkflowNode {
  return {
    id: "lore-retriever-1",
    type: "rpLoreRetrieverV1",
    config: {},
    position: { x: 0, y: 0 },
  };
}

function makeContext(sessionId = "s1", worldId = "w1", turnId = "t1") {
  return {
    runId: "run-1",
    values: {
      rp: { sessionId, worldId, turnId },
    },
  };
}

function makeParsedInput(overrides?: Record<string, unknown>) {
  return {
    rawText: "The hero enters the tavern.",
    actions: [],
    dialogues: [],
    intents: [],
    entities: { characters: [], locations: [], items: [], timeHints: [] },
    parsedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeInput(
  inputs: Record<string, unknown>,
  context = makeContext(),
  overrides?: Partial<NodeExecutionInput>,
): NodeExecutionInput {
  return {
    node: makeNode(),
    inputs,
    context,
    ...overrides,
  };
}

function makeLoreEntry(overrides: Partial<LoreEntry> = {}): LoreEntry {
  return {
    id: "lore-1",
    sessionId: "s1",
    worldId: "w1",
    title: "Test Lore Entry",
    content: "This is test content for the lore entry.",
    keywords: ["test"],
    category: "custom",
    activationMode: "triggered",
    priority: 1,
    ...overrides,
  };
}

describe("rpLoreRetrieverV1Definition", () => {
  it("has correct type, category, and ports", () => {
    expect(rpLoreRetrieverV1Definition.type).toBe("rpLoreRetrieverV1");
    expect(rpLoreRetrieverV1Definition.category).toBe("roleplay");

    const inputPort = rpLoreRetrieverV1Definition.ports.find((p) => p.id === "parsedInput");
    expect(inputPort).toBeDefined();
    expect(inputPort!.direction).toBe("input");
    expect(inputPort!.dataType).toBe("json");
    expect(inputPort!.schemaId).toBe("rp.parsed-input.v1");

    const outputPort = rpLoreRetrieverV1Definition.ports.find((p) => p.id === "loreContext");
    expect(outputPort).toBeDefined();
    expect(outputPort!.direction).toBe("output");
    expect(outputPort!.dataType).toBe("json");
    expect(outputPort!.schemaId).toBe("rp.lore-context.v1");
  });
});

describe("createRpLoreRetrieverV1Executor", () => {
  let loreStore: InMemoryLoreStore;
  let services: {
    stores: {
      timeline: InMemoryTimelineStore;
      chapter: InMemoryChapterStore;
      lore: InMemoryLoreStore;
      tracker: InMemoryTrackerStore;
    };
  };

  beforeEach(() => {
    loreStore = new InMemoryLoreStore();
    services = {
      stores: {
        timeline: new InMemoryTimelineStore(),
        chapter: new InMemoryChapterStore(),
        lore: loreStore,
        tracker: new InMemoryTrackerStore(),
      },
    };
  });

  it("returns empty loreContext when no entries exist", async () => {
    const executor = createRpLoreRetrieverV1Executor(services);
    const parsedInput = makeParsedInput();

    const result = await executor(makeInput({ parsedInput }));

    const loreContext = result.outputs.loreContext as Record<string, unknown>;
    expect(loreContext).toBeDefined();
    expect(loreContext.entries).toEqual([]);
    expect(loreContext.activatedBy).toEqual([]);
    expect(loreContext.totalEntries).toBe(0);
  });

  it("retrieves triggered entries matching keywords", async () => {
    await loreStore.putEntry({
      sessionId: "s1",
      worldId: "w1",
      entry: makeLoreEntry({
        id: "lore-tavern",
        title: "Tavern Rules",
        content: "No weapons allowed inside the tavern.",
        keywords: ["tavern", "weapons"],
        activationMode: "triggered",
        priority: 5,
      }),
    });

    const executor = createRpLoreRetrieverV1Executor(services);
    const parsedInput = makeParsedInput({
      rawText: "The hero enters the tavern.",
      entities: { characters: [], locations: ["tavern"], items: [], timeHints: [] },
    });

    const result = await executor(makeInput({ parsedInput }));

    const loreContext = result.outputs.loreContext as Record<string, unknown>;
    const entries = loreContext.entries as LoreEntry[];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].id).toBe("lore-tavern");
  });

  it("includes always_on entries within budget", async () => {
    await loreStore.putEntry({
      sessionId: "s1",
      worldId: "w1",
      entry: makeLoreEntry({
        id: "lore-always",
        title: "World Rules",
        content: "These are the basic rules of the world.",
        keywords: ["rules"],
        activationMode: "always_on",
        priority: 10,
      }),
    });

    const executor = createRpLoreRetrieverV1Executor(services);
    const parsedInput = makeParsedInput();

    const result = await executor(makeInput({ parsedInput }));

    const loreContext = result.outputs.loreContext as Record<string, unknown>;
    const entries = loreContext.entries as LoreEntry[];
    expect(entries.length).toBe(1);
    expect(entries[0].id).toBe("lore-always");
  });

  it("excludes manual_off entries", async () => {
    await loreStore.putEntry({
      sessionId: "s1",
      worldId: "w1",
      entry: makeLoreEntry({
        id: "lore-manual",
        title: "Manual Entry",
        content: "This should not be auto-retrieved.",
        keywords: ["manual"],
        activationMode: "manual_off",
        priority: 5,
      }),
    });

    const executor = createRpLoreRetrieverV1Executor(services);
    const parsedInput = makeParsedInput({
      rawText: "manual entry",
    });

    const result = await executor(makeInput({ parsedInput }));

    const loreContext = result.outputs.loreContext as Record<string, unknown>;
    const entries = loreContext.entries as LoreEntry[];
    expect(entries.length).toBe(0);
  });

  it("isolates queries by sessionId and worldId", async () => {
    await loreStore.putEntry({
      sessionId: "session-A",
      worldId: "world-A",
      entry: makeLoreEntry({
        id: "lore-A",
        sessionId: "session-A",
        worldId: "world-A",
        title: "Session A Lore",
        content: "Lore for session A.",
        keywords: ["alpha"],
        activationMode: "triggered",
      }),
    });

    await loreStore.putEntry({
      sessionId: "session-B",
      worldId: "world-B",
      entry: makeLoreEntry({
        id: "lore-B",
        sessionId: "session-B",
        worldId: "world-B",
        title: "Session B Lore",
        content: "Lore for session B.",
        keywords: ["beta"],
        activationMode: "triggered",
      }),
    });

    const executor = createRpLoreRetrieverV1Executor(services);
    const parsedInput = makeParsedInput({
      rawText: "alpha",
      entities: { characters: [], locations: ["alpha"], items: [], timeHints: [] },
    });

    const resultA = await executor(makeInput({ parsedInput }, makeContext("session-A", "world-A")));
    const contextA = resultA.outputs.loreContext as Record<string, unknown>;
    const entriesA = contextA.entries as LoreEntry[];
    expect(entriesA.length).toBe(1);
    expect(entriesA[0].id).toBe("lore-A");

    const parsedInputB = makeParsedInput({
      rawText: "beta",
      entities: { characters: [], locations: ["beta"], items: [], timeHints: [] },
    });
    const resultB = await executor(
      makeInput({ parsedInput: parsedInputB }, makeContext("session-B", "world-B")),
    );
    const contextB = resultB.outputs.loreContext as Record<string, unknown>;
    const entriesB = contextB.entries as LoreEntry[];
    expect(entriesB.length).toBe(1);
    expect(entriesB[0].id).toBe("lore-B");
  });

  it("sorts triggered entries by relevance and priority", async () => {
    await loreStore.putEntry({
      sessionId: "s1",
      worldId: "w1",
      entry: makeLoreEntry({
        id: "lore-low",
        title: "Low Priority",
        content: "Some content.",
        keywords: ["tavern"],
        activationMode: "triggered",
        priority: 1,
      }),
    });

    await loreStore.putEntry({
      sessionId: "s1",
      worldId: "w1",
      entry: makeLoreEntry({
        id: "lore-high",
        title: "High Priority",
        content: "Tavern rules and information.",
        keywords: ["tavern", "rules"],
        activationMode: "triggered",
        priority: 10,
      }),
    });

    const executor = createRpLoreRetrieverV1Executor(services);
    const parsedInput = makeParsedInput({
      rawText: "tavern rules",
      entities: { characters: [], locations: ["tavern"], items: [], timeHints: [] },
    });

    const result = await executor(makeInput({ parsedInput }));

    const loreContext = result.outputs.loreContext as Record<string, unknown>;
    const entries = loreContext.entries as LoreEntry[];
    expect(entries.length).toBe(2);
    // Higher relevance/priority should come first
    expect(entries[0].id).toBe("lore-high");
  });

  it("respects limit config", async () => {
    // Add many entries
    for (let i = 1; i <= 20; i++) {
      await loreStore.putEntry({
        sessionId: "s1",
        worldId: "w1",
        entry: makeLoreEntry({
          id: `lore-${i}`,
          title: `Entry ${i}`,
          content: `Content ${i} with keyword tavern.`,
          keywords: ["tavern"],
          activationMode: "triggered",
          priority: i,
        }),
      });
    }

    const executor = createRpLoreRetrieverV1Executor({
      ...services,
      config: { limit: 5 },
    });

    const parsedInput = makeParsedInput({
      rawText: "tavern",
      entities: { characters: [], locations: ["tavern"], items: [], timeHints: [] },
    });

    const result = await executor(makeInput({ parsedInput }));

    const loreContext = result.outputs.loreContext as Record<string, unknown>;
    const entries = loreContext.entries as LoreEntry[];
    expect(entries.length).toBeLessThanOrEqual(5);
  });

  it("throws when parsedInput is missing", async () => {
    const executor = createRpLoreRetrieverV1Executor(services);
    await expect(executor(makeInput({}))).rejects.toThrow();
  });

  it("throws when context.values.rp is missing", async () => {
    const executor = createRpLoreRetrieverV1Executor(services);
    const parsedInput = makeParsedInput();

    await expect(
      executor({
        node: makeNode(),
        inputs: { parsedInput },
        context: undefined,
      }),
    ).rejects.toThrow();
  });
});
