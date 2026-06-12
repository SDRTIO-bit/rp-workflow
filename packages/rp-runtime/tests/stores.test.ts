import { describe, expect, it } from "vitest";
import {
  InMemoryTimelineStore,
  InMemoryChapterStore,
  InMemoryLoreStore,
  InMemoryTrackerStore,
} from "../src/stores/memory.js";
import type { MemoryEvent, Chapter, LoreEntry, TrackerPatch } from "../src/types.js";

// ============ Helpers ============

const makeEvent = (overrides: Partial<MemoryEvent> = {}): MemoryEvent => ({
  eventId: "e1",
  sessionId: "s1",
  worldId: "w1",
  chapterId: "c1",
  sourceTurnId: "t1",
  summary: "A dramatic encounter in the old station",
  characters: ["Alice"],
  locations: ["station"],
  items: [],
  time: null,
  emotionalChanges: [],
  createdAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

const makeChapter = (overrides: Partial<Chapter> = {}): Chapter => ({
  chapterId: "c1",
  sessionId: "s1",
  worldId: "w1",
  title: "Chapter 1",
  summary: "The beginning",
  events: [],
  startedAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

const makeLore = (overrides: Partial<LoreEntry> = {}): LoreEntry => ({
  id: "l1",
  sessionId: "s1",
  worldId: "w1",
  title: "Alice",
  content: "A mysterious traveler",
  keywords: ["alice", "traveler"],
  category: "character",
  activationMode: "triggered",
  priority: 0,
  ...overrides,
});

// ============ TimelineStore ============

describe("InMemoryTimelineStore", () => {
  it("stores and retrieves events by chapter", async () => {
    const store = new InMemoryTimelineStore();
    const event = makeEvent();
    await store.putEvent({ sessionId: "s1", worldId: "w1", event });

    const result = await store.getEventsByChapter({
      sessionId: "s1",
      worldId: "w1",
      chapterId: "c1",
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.eventId).toBe("e1");
  });

  it("deduplicates by eventId (idempotent putEvent)", async () => {
    const store = new InMemoryTimelineStore();
    const event = makeEvent();
    await store.putEvent({ sessionId: "s1", worldId: "w1", event });
    await store.putEvent({ sessionId: "s1", worldId: "w1", event }); // same eventId

    const result = await store.getEventsByChapter({
      sessionId: "s1",
      worldId: "w1",
      chapterId: "c1",
    });
    expect(result).toHaveLength(1);
  });

  it("isolates events by sessionId + worldId", async () => {
    const store = new InMemoryTimelineStore();
    await store.putEvent({ sessionId: "s1", worldId: "w1", event: makeEvent({ eventId: "e1" }) });
    await store.putEvent({ sessionId: "s2", worldId: "w1", event: makeEvent({ eventId: "e2" }) });

    const r1 = await store.getEventsByChapter({ sessionId: "s1", worldId: "w1", chapterId: "c1" });
    const r2 = await store.getEventsByChapter({ sessionId: "s2", worldId: "w1", chapterId: "c1" });

    expect(r1).toHaveLength(1);
    expect(r1[0]!.eventId).toBe("e1");
    expect(r2).toHaveLength(1);
    expect(r2[0]!.eventId).toBe("e2");
  });

  it("queries events by relevance", async () => {
    const store = new InMemoryTimelineStore();
    await store.putEvent({
      sessionId: "s1",
      worldId: "w1",
      event: makeEvent({ eventId: "e1", summary: "Alice meets Bob at the station" }),
    });
    await store.putEvent({
      sessionId: "s1",
      worldId: "w1",
      event: makeEvent({ eventId: "e2", summary: "A quiet evening at home" }),
    });

    const results = await store.queryEvents({
      sessionId: "s1",
      worldId: "w1",
      query: "alice station",
      limit: 5,
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.eventId).toBe("e1");
  });

  it("returns empty for unknown scope", async () => {
    const store = new InMemoryTimelineStore();
    const result = await store.getEventsByChapter({
      sessionId: "unknown",
      worldId: "unknown",
      chapterId: "c1",
    });
    expect(result).toHaveLength(0);
  });
});

// ============ ChapterStore ============

describe("InMemoryChapterStore", () => {
  it("stores and retrieves chapters", async () => {
    const store = new InMemoryChapterStore();
    const chapter = makeChapter();
    await store.putChapter({ sessionId: "s1", worldId: "w1", chapter });

    const result = await store.getChapter({ sessionId: "s1", worldId: "w1", chapterId: "c1" });
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Chapter 1");
  });

  it("lists chapters sorted by startedAt", async () => {
    const store = new InMemoryChapterStore();
    await store.putChapter({
      sessionId: "s1",
      worldId: "w1",
      chapter: makeChapter({ chapterId: "c2", startedAt: "2024-01-02T00:00:00Z" }),
    });
    await store.putChapter({
      sessionId: "s1",
      worldId: "w1",
      chapter: makeChapter({ chapterId: "c1", startedAt: "2024-01-01T00:00:00Z" }),
    });

    const list = await store.listChapters({ sessionId: "s1", worldId: "w1" });
    expect(list).toHaveLength(2);
    expect(list[0]!.chapterId).toBe("c1");
    expect(list[1]!.chapterId).toBe("c2");
  });

  it("isolates chapters by scope", async () => {
    const store = new InMemoryChapterStore();
    await store.putChapter({
      sessionId: "s1",
      worldId: "w1",
      chapter: makeChapter({ chapterId: "c1" }),
    });
    await store.putChapter({
      sessionId: "s2",
      worldId: "w1",
      chapter: makeChapter({ chapterId: "c2" }),
    });

    const r1 = await store.listChapters({ sessionId: "s1", worldId: "w1" });
    const r2 = await store.listChapters({ sessionId: "s2", worldId: "w1" });

    expect(r1).toHaveLength(1);
    expect(r1[0]!.chapterId).toBe("c1");
    expect(r2).toHaveLength(1);
    expect(r2[0]!.chapterId).toBe("c2");
  });
});

// ============ LoreStore ============

describe("InMemoryLoreStore", () => {
  it("queries triggered entries by keyword match", async () => {
    const store = new InMemoryLoreStore();
    await store.putEntry({ sessionId: "s1", worldId: "w1", entry: makeLore() });
    await store.putEntry({
      sessionId: "s1",
      worldId: "w1",
      entry: makeLore({ id: "l2", title: "Bob", keywords: ["bob"] }),
    });

    const results = await store.query({
      sessionId: "s1",
      worldId: "w1",
      keywords: ["alice"],
      limit: 5,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("l1");
  });

  it("includes always_on entries regardless of keywords", async () => {
    const store = new InMemoryLoreStore();
    await store.putEntry({
      sessionId: "s1",
      worldId: "w1",
      entry: makeLore({ id: "l1", activationMode: "always_on", keywords: [] }),
    });

    const results = await store.query({
      sessionId: "s1",
      worldId: "w1",
      keywords: ["unrelated"],
      limit: 5,
    });
    expect(results).toHaveLength(1);
  });

  it("excludes manual_off entries", async () => {
    const store = new InMemoryLoreStore();
    await store.putEntry({
      sessionId: "s1",
      worldId: "w1",
      entry: makeLore({ id: "l1", activationMode: "manual_off" }),
    });

    const results = await store.query({
      sessionId: "s1",
      worldId: "w1",
      keywords: ["alice"],
      limit: 5,
    });
    expect(results).toHaveLength(0);
  });

  it("isolates entries by scope", async () => {
    const store = new InMemoryLoreStore();
    await store.putEntry({ sessionId: "s1", worldId: "w1", entry: makeLore({ id: "l1" }) });
    await store.putEntry({ sessionId: "s2", worldId: "w1", entry: makeLore({ id: "l2" }) });

    const r1 = await store.query({ sessionId: "s1", worldId: "w1", keywords: ["alice"], limit: 5 });
    const r2 = await store.query({ sessionId: "s2", worldId: "w1", keywords: ["alice"], limit: 5 });

    expect(r1).toHaveLength(1);
    expect(r1[0]!.id).toBe("l1");
    expect(r2).toHaveLength(1);
    expect(r2[0]!.id).toBe("l2");
  });
});

// ============ TrackerStore ============

describe("InMemoryTrackerStore", () => {
  it("returns empty state for new scope", async () => {
    const store = new InMemoryTrackerStore();
    const state = await store.get({ sessionId: "s1", worldId: "w1" });
    expect(state.characters).toHaveLength(0);
    expect(state.version).toBe(0);
  });

  it("applies add operations", async () => {
    const store = new InMemoryTrackerStore();
    const patch: TrackerPatch = {
      sessionId: "s1",
      worldId: "w1",
      sourceTurnId: "t1",
      operations: [
        {
          type: "add",
          target: "characters",
          targetId: "char1",
          value: { id: "char1", name: "Alice", relationships: {} },
        },
      ],
      timestamp: "2024-01-01T00:00:00Z",
    };

    const state = await store.applyPatch({ sessionId: "s1", worldId: "w1", patch });
    expect(state.characters).toHaveLength(1);
    expect(state.characters[0]!.name).toBe("Alice");
    expect(state.version).toBe(1);
  });

  it("applies update operations", async () => {
    const store = new InMemoryTrackerStore();
    // First add
    await store.applyPatch({
      sessionId: "s1",
      worldId: "w1",
      patch: {
        sessionId: "s1",
        worldId: "w1",
        sourceTurnId: "t1",
        operations: [
          {
            type: "add",
            target: "characters",
            targetId: "char1",
            value: { id: "char1", name: "Alice", relationships: {} },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
    });

    // Then update
    const state = await store.applyPatch({
      sessionId: "s1",
      worldId: "w1",
      patch: {
        sessionId: "s1",
        worldId: "w1",
        sourceTurnId: "t2",
        operations: [
          {
            type: "update",
            target: "characters",
            targetId: "char1",
            field: "mood",
            value: "happy",
          },
        ],
        timestamp: "2024-01-01T01:00:00Z",
      },
    });

    expect(state.characters[0]!.mood).toBe("happy");
    expect(state.version).toBe(2);
  });

  it("applies remove operations", async () => {
    const store = new InMemoryTrackerStore();
    await store.applyPatch({
      sessionId: "s1",
      worldId: "w1",
      patch: {
        sessionId: "s1",
        worldId: "w1",
        sourceTurnId: "t1",
        operations: [
          {
            type: "add",
            target: "characters",
            targetId: "char1",
            value: { id: "char1", name: "Alice", relationships: {} },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
    });

    const state = await store.applyPatch({
      sessionId: "s1",
      worldId: "w1",
      patch: {
        sessionId: "s1",
        worldId: "w1",
        sourceTurnId: "t2",
        operations: [{ type: "remove", target: "characters", targetId: "char1" }],
        timestamp: "2024-01-01T01:00:00Z",
      },
    });

    expect(state.characters).toHaveLength(0);
  });

  it("isolates tracker state by scope", async () => {
    const store = new InMemoryTrackerStore();
    await store.applyPatch({
      sessionId: "s1",
      worldId: "w1",
      patch: {
        sessionId: "s1",
        worldId: "w1",
        sourceTurnId: "t1",
        operations: [
          {
            type: "add",
            target: "characters",
            targetId: "char1",
            value: { id: "char1", name: "Alice", relationships: {} },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
    });

    const s1 = await store.get({ sessionId: "s1", worldId: "w1" });
    const s2 = await store.get({ sessionId: "s2", worldId: "w1" });

    expect(s1.characters).toHaveLength(1);
    expect(s2.characters).toHaveLength(0);
  });
});
