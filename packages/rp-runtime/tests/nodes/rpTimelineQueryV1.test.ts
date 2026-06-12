import { describe, it, expect, beforeEach } from "vitest";
import {
  rpTimelineQueryV1Definition,
  createRpTimelineQueryV1Executor,
} from "../../src/nodes/rpTimelineQueryV1.js";
import type { NodeExecutionInput, WorkflowNode } from "@awp/workflow-core";
import {
  InMemoryTimelineStore,
  InMemoryChapterStore,
  InMemoryLoreStore,
  InMemoryTrackerStore,
} from "../../src/stores/memory.js";
import type { MemoryEvent } from "../../src/types.js";

function makeNode(): WorkflowNode {
  return {
    id: "timeline-query-1",
    type: "rpTimelineQueryV1",
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

function makeEvent(overrides: Partial<MemoryEvent> = {}): MemoryEvent {
  return {
    eventId: "evt-1",
    sessionId: "s1",
    worldId: "w1",
    chapterId: "ch-1",
    sourceTurnId: "t-1",
    summary: "A test event summary.",
    characters: [],
    locations: [],
    items: [],
    time: null,
    emotionalChanges: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("rpTimelineQueryV1Definition", () => {
  it("has correct type, category, and ports", () => {
    expect(rpTimelineQueryV1Definition.type).toBe("rpTimelineQueryV1");
    expect(rpTimelineQueryV1Definition.category).toBe("roleplay");

    const inputPort = rpTimelineQueryV1Definition.ports.find((p) => p.id === "parsedInput");
    expect(inputPort).toBeDefined();
    expect(inputPort!.direction).toBe("input");
    expect(inputPort!.dataType).toBe("json");
    expect(inputPort!.schemaId).toBe("rp.parsed-input.v1");

    const outputPort = rpTimelineQueryV1Definition.ports.find((p) => p.id === "timelineContext");
    expect(outputPort).toBeDefined();
    expect(outputPort!.direction).toBe("output");
    expect(outputPort!.dataType).toBe("json");
    expect(outputPort!.schemaId).toBe("rp.timeline-context.v1");
  });
});

describe("createRpTimelineQueryV1Executor", () => {
  let timelineStore: InMemoryTimelineStore;
  let services: {
    stores: {
      timeline: InMemoryTimelineStore;
      chapter: InMemoryChapterStore;
      lore: InMemoryLoreStore;
      tracker: InMemoryTrackerStore;
    };
  };

  beforeEach(() => {
    timelineStore = new InMemoryTimelineStore();
    services = {
      stores: {
        timeline: timelineStore,
        chapter: new InMemoryChapterStore(),
        lore: new InMemoryLoreStore(),
        tracker: new InMemoryTrackerStore(),
      },
    };
  });

  it("returns empty timelineContext when no events exist", async () => {
    const executor = createRpTimelineQueryV1Executor(services);
    const parsedInput = makeParsedInput();

    const result = await executor(makeInput({ parsedInput }));

    const timelineContext = result.outputs.timelineContext as Record<string, unknown>;
    expect(timelineContext).toBeDefined();
    expect(timelineContext.chapters).toEqual([]);
    expect(timelineContext.relevantEvents).toEqual([]);
    expect(timelineContext.totalChapters).toBe(0);
    expect(typeof timelineContext.queryTimeMs).toBe("number");
  });

  it("queries events based on parsed input entities", async () => {
    // Seed some events
    await timelineStore.putEvent({
      sessionId: "s1",
      worldId: "w1",
      event: makeEvent({
        eventId: "evt-1",
        chapterId: "ch-1",
        summary: "Alice enters the tavern and meets Bob.",
        characters: ["Alice", "Bob"],
        locations: ["tavern"],
      }),
    });

    await timelineStore.putEvent({
      sessionId: "s1",
      worldId: "w1",
      event: makeEvent({
        eventId: "evt-2",
        chapterId: "ch-1",
        summary: "They discuss the quest ahead.",
        characters: ["Alice", "Bob"],
      }),
    });

    const executor = createRpTimelineQueryV1Executor(services);
    const parsedInput = makeParsedInput({
      rawText: "Alice walks into the tavern.",
      entities: {
        characters: ["Alice"],
        locations: ["tavern"],
        items: [],
        timeHints: [],
      },
    });

    const result = await executor(makeInput({ parsedInput }));

    const timelineContext = result.outputs.timelineContext as Record<string, unknown>;
    const events = timelineContext.relevantEvents as unknown[];
    expect(events.length).toBeGreaterThan(0);

    const chapters = timelineContext.chapters as unknown[];
    expect(chapters.length).toBeGreaterThan(0);
  });

  it("isolates queries by sessionId and worldId", async () => {
    // Seed events for session A
    await timelineStore.putEvent({
      sessionId: "session-A",
      worldId: "world-A",
      event: makeEvent({
        eventId: "evt-A",
        sessionId: "session-A",
        worldId: "world-A",
        chapterId: "ch-A",
        summary: "Event in session A.",
      }),
    });

    // Seed events for session B
    await timelineStore.putEvent({
      sessionId: "session-B",
      worldId: "world-B",
      event: makeEvent({
        eventId: "evt-B",
        sessionId: "session-B",
        worldId: "world-B",
        chapterId: "ch-B",
        summary: "Event in session B.",
      }),
    });

    const executor = createRpTimelineQueryV1Executor(services);
    const parsedInput = makeParsedInput({ rawText: "Event" });

    // Query session A
    const resultA = await executor(makeInput({ parsedInput }, makeContext("session-A", "world-A")));
    const contextA = resultA.outputs.timelineContext as Record<string, unknown>;
    const eventsA = contextA.relevantEvents as MemoryEvent[];
    expect(eventsA.length).toBe(1);
    expect(eventsA[0].eventId).toBe("evt-A");

    // Query session B
    const resultB = await executor(makeInput({ parsedInput }, makeContext("session-B", "world-B")));
    const contextB = resultB.outputs.timelineContext as Record<string, unknown>;
    const eventsB = contextB.relevantEvents as MemoryEvent[];
    expect(eventsB.length).toBe(1);
    expect(eventsB[0].eventId).toBe("evt-B");
  });

  it("respects chapterLimit config", async () => {
    // Seed events in multiple chapters
    for (let i = 1; i <= 10; i++) {
      await timelineStore.putEvent({
        sessionId: "s1",
        worldId: "w1",
        event: makeEvent({
          eventId: `evt-${i}`,
          chapterId: `ch-${i}`,
          summary: `Event ${i} with keyword tavern.`,
          locations: ["tavern"],
        }),
      });
    }

    const executor = createRpTimelineQueryV1Executor({
      ...services,
      config: { chapterLimit: 3, eventLimit: 50 },
    });

    const parsedInput = makeParsedInput({
      rawText: "tavern",
      entities: { characters: [], locations: ["tavern"], items: [], timeHints: [] },
    });

    const result = await executor(makeInput({ parsedInput }));

    const timelineContext = result.outputs.timelineContext as Record<string, unknown>;
    const chapters = timelineContext.chapters as unknown[];
    expect(chapters.length).toBeLessThanOrEqual(3);
  });

  it("sorts chapters by relevance score descending", async () => {
    // Seed events with different relevance
    await timelineStore.putEvent({
      sessionId: "s1",
      worldId: "w1",
      event: makeEvent({
        eventId: "evt-low",
        chapterId: "ch-low",
        summary: "Unrelated event.",
      }),
    });

    await timelineStore.putEvent({
      sessionId: "s1",
      worldId: "w1",
      event: makeEvent({
        eventId: "evt-high",
        chapterId: "ch-high",
        summary: "Alice meets Bob in the tavern.",
        characters: ["Alice", "Bob"],
        locations: ["tavern"],
      }),
    });

    const executor = createRpTimelineQueryV1Executor(services);
    const parsedInput = makeParsedInput({
      rawText: "Alice tavern",
      entities: { characters: ["Alice"], locations: ["tavern"], items: [], timeHints: [] },
    });

    const result = await executor(makeInput({ parsedInput }));

    const timelineContext = result.outputs.timelineContext as Record<string, unknown>;
    const chapters = timelineContext.chapters as Array<{
      chapterId: string;
      relevanceScore: number;
    }>;

    if (chapters.length >= 2) {
      // Higher relevance should come first
      expect(chapters[0].relevanceScore).toBeGreaterThanOrEqual(chapters[1].relevanceScore);
    }
  });

  it("throws when parsedInput is missing", async () => {
    const executor = createRpTimelineQueryV1Executor(services);
    await expect(executor(makeInput({}))).rejects.toThrow();
  });

  it("throws when context.values.rp is missing", async () => {
    const executor = createRpTimelineQueryV1Executor(services);
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
