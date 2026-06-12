import { describe, it, expect, beforeEach } from "vitest";
import {
  rpMemoryCommitV1Definition,
  createRpMemoryCommitV1Executor,
} from "../../src/nodes/rpMemoryCommitV1.js";
import type { NodeExecutionInput, WorkflowNode } from "@awp/workflow-core";
import {
  InMemoryTimelineStore,
  InMemoryChapterStore,
  InMemoryLoreStore,
  InMemoryTrackerStore,
} from "../../src/stores/memory.js";
import type { MemoryEvent, TrackerPatch } from "../../src/types.js";
import type { ChapterPatch } from "../../src/nodes/rpChapterSummaryV1.js";

function makeNode(): WorkflowNode {
  return {
    id: "memory-commit-1",
    type: "rpMemoryCommitV1",
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

function makeMemoryEvent(overrides?: Partial<MemoryEvent>): MemoryEvent {
  return {
    eventId: "evt-1",
    sessionId: "s1",
    worldId: "w1",
    chapterId: "ch-1",
    sourceTurnId: "t1",
    summary: "Test event summary.",
    characters: [],
    locations: [],
    items: [],
    time: null,
    emotionalChanges: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeChapterPatch(overrides?: Partial<ChapterPatch>): ChapterPatch {
  return {
    chapterId: "ch-1",
    addEventId: "evt-1",
    updateSummary: "Updated summary.",
    ...overrides,
  };
}

function makeTrackerPatch(overrides?: Partial<TrackerPatch>): TrackerPatch {
  return {
    sessionId: "s1",
    worldId: "w1",
    sourceTurnId: "t1",
    operations: [],
    timestamp: new Date().toISOString(),
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

describe("rpMemoryCommitV1Definition", () => {
  it("has correct type, category, and ports", () => {
    expect(rpMemoryCommitV1Definition.type).toBe("rpMemoryCommitV1");
    expect(rpMemoryCommitV1Definition.category).toBe("roleplay");

    const inputPortIds = rpMemoryCommitV1Definition.ports
      .filter((p) => p.direction === "input")
      .map((p) => p.id);
    expect(inputPortIds).toContain("memoryEvent");
    expect(inputPortIds).toContain("chapterPatch");
    expect(inputPortIds).toContain("trackerPatch");

    const outputPortIds = rpMemoryCommitV1Definition.ports
      .filter((p) => p.direction === "output")
      .map((p) => p.id);
    expect(outputPortIds).toContain("commitResult");

    // Verify schemaIds
    const eventPort = rpMemoryCommitV1Definition.ports.find((p) => p.id === "memoryEvent");
    expect(eventPort!.schemaId).toBe("rp.memory-event.v1");

    const patchPort = rpMemoryCommitV1Definition.ports.find((p) => p.id === "trackerPatch");
    expect(patchPort!.schemaId).toBe("rp.tracker-patch.v1");
  });
});

describe("createRpMemoryCommitV1Executor", () => {
  let timelineStore: InMemoryTimelineStore;
  let chapterStore: InMemoryChapterStore;
  let trackerStore: InMemoryTrackerStore;
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
    chapterStore = new InMemoryChapterStore();
    trackerStore = new InMemoryTrackerStore();
    services = {
      stores: {
        timeline: timelineStore,
        chapter: chapterStore,
        lore: new InMemoryLoreStore(),
        tracker: trackerStore,
      },
    };
  });

  it("successfully commits memory event, chapter, and tracker", async () => {
    const executor = createRpMemoryCommitV1Executor(services);
    const memoryEvent = makeMemoryEvent();
    const chapterPatch = makeChapterPatch();
    const trackerPatch = makeTrackerPatch();

    const result = await executor(makeInput({ memoryEvent, chapterPatch, trackerPatch }));

    const commitResult = result.outputs.commitResult as Record<string, unknown>;
    expect(commitResult).toBeDefined();
    expect(commitResult.success).toBe(true);
    expect(commitResult.eventId).toBe("evt-1");
    expect(commitResult.chapterId).toBe("ch-1");
    expect(commitResult.errors).toEqual([]);
    expect(typeof commitResult.committedAt).toBe("string");
  });

  it("writes memory event to timeline store", async () => {
    const executor = createRpMemoryCommitV1Executor(services);
    const memoryEvent = makeMemoryEvent({ eventId: "evt-test" });
    const chapterPatch = makeChapterPatch();
    const trackerPatch = makeTrackerPatch();

    await executor(makeInput({ memoryEvent, chapterPatch, trackerPatch }));

    // Verify event was written
    const events = await timelineStore.getEventsByChapter({
      sessionId: "s1",
      worldId: "w1",
      chapterId: "ch-1",
    });
    expect(events.length).toBe(1);
    expect(events[0].eventId).toBe("evt-test");
  });

  it("creates new chapter when not exists", async () => {
    const executor = createRpMemoryCommitV1Executor(services);
    const memoryEvent = makeMemoryEvent();
    const chapterPatch = makeChapterPatch({ chapterId: "new-chapter" });
    const trackerPatch = makeTrackerPatch();

    await executor(makeInput({ memoryEvent, chapterPatch, trackerPatch }));

    // Verify chapter was created
    const chapter = await chapterStore.getChapter({
      sessionId: "s1",
      worldId: "w1",
      chapterId: "new-chapter",
    });
    expect(chapter).not.toBeNull();
    expect(chapter!.events).toContain("evt-1");
  });

  it("updates existing chapter with new event", async () => {
    // Pre-create chapter
    await chapterStore.putChapter({
      sessionId: "s1",
      worldId: "w1",
      chapter: {
        chapterId: "ch-1",
        sessionId: "s1",
        worldId: "w1",
        title: "Existing Chapter",
        summary: "Old summary",
        events: ["evt-old"],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const executor = createRpMemoryCommitV1Executor(services);
    const memoryEvent = makeMemoryEvent({ eventId: "evt-new" });
    const chapterPatch = makeChapterPatch({ addEventId: "evt-new" });
    const trackerPatch = makeTrackerPatch();

    await executor(makeInput({ memoryEvent, chapterPatch, trackerPatch }));

    // Verify chapter was updated
    const chapter = await chapterStore.getChapter({
      sessionId: "s1",
      worldId: "w1",
      chapterId: "ch-1",
    });
    expect(chapter!.events).toContain("evt-old");
    expect(chapter!.events).toContain("evt-new");
    expect(chapter!.summary).toBe("Updated summary.");
  });

  it("applies tracker patch when operations exist", async () => {
    const executor = createRpMemoryCommitV1Executor(services);
    const memoryEvent = makeMemoryEvent();
    const chapterPatch = makeChapterPatch();
    const trackerPatch = makeTrackerPatch({
      operations: [
        {
          type: "add",
          target: "characters",
          targetId: "char-alice",
          value: { id: "char-alice", name: "Alice", relationships: {} },
        },
      ],
    });

    const result = await executor(makeInput({ memoryEvent, chapterPatch, trackerPatch }));

    const commitResult = result.outputs.commitResult as Record<string, unknown>;
    expect(commitResult.success).toBe(true);
    expect(typeof commitResult.trackerVersion).toBe("number");

    // Verify tracker was updated
    const state = await trackerStore.get({ sessionId: "s1", worldId: "w1" });
    expect(state.characters.length).toBe(1);
    expect(state.characters[0].name).toBe("Alice");
  });

  it("skips tracker update when no operations", async () => {
    const executor = createRpMemoryCommitV1Executor(services);
    const memoryEvent = makeMemoryEvent();
    const chapterPatch = makeChapterPatch();
    const trackerPatch = makeTrackerPatch({ operations: [] });

    const result = await executor(makeInput({ memoryEvent, chapterPatch, trackerPatch }));

    const commitResult = result.outputs.commitResult as Record<string, unknown>;
    expect(commitResult.success).toBe(true);
    expect(commitResult.trackerVersion).toBeUndefined();
  });

  it("isolates commits by sessionId and worldId", async () => {
    const executor = createRpMemoryCommitV1Executor(services);

    // Commit for session A
    await executor(
      makeInput(
        {
          memoryEvent: makeMemoryEvent({
            eventId: "evt-A",
            sessionId: "session-A",
            worldId: "world-A",
          }),
          chapterPatch: makeChapterPatch(),
          trackerPatch: makeTrackerPatch(),
        },
        makeContext("session-A", "world-A"),
      ),
    );

    // Commit for session B
    await executor(
      makeInput(
        {
          memoryEvent: makeMemoryEvent({
            eventId: "evt-B",
            sessionId: "session-B",
            worldId: "world-B",
          }),
          chapterPatch: makeChapterPatch(),
          trackerPatch: makeTrackerPatch(),
        },
        makeContext("session-B", "world-B"),
      ),
    );

    // Verify isolation
    const eventsA = await timelineStore.getEventsByChapter({
      sessionId: "session-A",
      worldId: "world-A",
      chapterId: "ch-1",
    });
    const eventsB = await timelineStore.getEventsByChapter({
      sessionId: "session-B",
      worldId: "world-B",
      chapterId: "ch-1",
    });

    expect(eventsA.length).toBe(1);
    expect(eventsA[0].eventId).toBe("evt-A");
    expect(eventsB.length).toBe(1);
    expect(eventsB[0].eventId).toBe("evt-B");
  });

  it("throws when memoryEvent is missing", async () => {
    const executor = createRpMemoryCommitV1Executor(services);
    const chapterPatch = makeChapterPatch();
    const trackerPatch = makeTrackerPatch();

    await expect(executor(makeInput({ chapterPatch, trackerPatch }))).rejects.toThrow(
      "memoryEvent is required",
    );
  });

  it("throws when chapterPatch is missing", async () => {
    const executor = createRpMemoryCommitV1Executor(services);
    const memoryEvent = makeMemoryEvent();
    const trackerPatch = makeTrackerPatch();

    await expect(executor(makeInput({ memoryEvent, trackerPatch }))).rejects.toThrow(
      "chapterPatch is required",
    );
  });

  it("throws when trackerPatch is missing", async () => {
    const executor = createRpMemoryCommitV1Executor(services);
    const memoryEvent = makeMemoryEvent();
    const chapterPatch = makeChapterPatch();

    await expect(executor(makeInput({ memoryEvent, chapterPatch }))).rejects.toThrow(
      "trackerPatch is required",
    );
  });

  it("throws when context.values.rp is missing", async () => {
    const executor = createRpMemoryCommitV1Executor(services);
    const memoryEvent = makeMemoryEvent();
    const chapterPatch = makeChapterPatch();
    const trackerPatch = makeTrackerPatch();

    await expect(
      executor({
        node: makeNode(),
        inputs: { memoryEvent, chapterPatch, trackerPatch },
        context: undefined,
      }),
    ).rejects.toThrow();
  });
});
