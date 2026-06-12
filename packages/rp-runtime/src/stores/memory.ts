// In-Memory Store Implementations - RP Runtime

import type {
  TimelineStore,
  ChapterStore,
  LoreStore,
  TrackerStore,
  PutEventRequest,
  QueryEventsRequest,
  GetEventsByChapterRequest,
  PutChapterRequest,
  GetChapterRequest,
  ListChaptersRequest,
  QueryLoreRequest,
  PutLoreEntryRequest,
  GetTrackerRequest,
  ApplyTrackerPatchRequest,
} from "./types.js";
import type { MemoryEvent, Chapter, LoreEntry, TrackerState, TrackerPatch } from "../types.js";

// ============ Helpers ============

const scopeKey = (sessionId: string, worldId: string): string => `${sessionId}::${worldId}`;

const tokenize = (text: string): Set<string> => {
  const normalized = text.toLowerCase();
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/[a-z0-9_]+/g)) {
    tokens.add(match[0]);
  }
  for (const char of normalized.replace(/\s/g, "")) {
    if (/[\u4e00-\u9fff]/u.test(char)) {
      tokens.add(char);
    }
  }
  return tokens;
};

const scoreRelevance = (queryTokens: Set<string>, text: string): number => {
  const textTokens = tokenize(text);
  let score = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) {
      score += token.length > 1 ? 3 : 1;
    }
  }
  return score;
};

// ============ InMemoryTimelineStore ============

export class InMemoryTimelineStore implements TimelineStore {
  private events = new Map<string, MemoryEvent[]>();
  private eventDedup = new Set<string>();

  async putEvent(request: PutEventRequest): Promise<void> {
    const key = scopeKey(request.sessionId, request.worldId);
    const list = this.events.get(key) ?? [];

    // Idempotent: skip if same eventId exists
    const dedupKey = `${key}::${request.event.eventId}`;
    if (this.eventDedup.has(dedupKey)) {
      return;
    }

    list.push(request.event);
    this.events.set(key, list);
    this.eventDedup.add(dedupKey);
  }

  async queryEvents(request: QueryEventsRequest): Promise<MemoryEvent[]> {
    const key = scopeKey(request.sessionId, request.worldId);
    const list = this.events.get(key) ?? [];
    const queryTokens = tokenize(request.query);

    const scored = list
      .map((event) => ({
        event,
        score: scoreRelevance(
          queryTokens,
          [event.summary, ...event.characters, ...event.locations].join(" "),
        ),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, request.limit);

    return scored.map((item) => item.event);
  }

  async getEventsByChapter(request: GetEventsByChapterRequest): Promise<MemoryEvent[]> {
    const key = scopeKey(request.sessionId, request.worldId);
    const list = this.events.get(key) ?? [];
    return list.filter((event) => event.chapterId === request.chapterId);
  }
}

// ============ InMemoryChapterStore ============

export class InMemoryChapterStore implements ChapterStore {
  private chapters = new Map<string, Map<string, Chapter>>();

  async putChapter(request: PutChapterRequest): Promise<void> {
    const key = scopeKey(request.sessionId, request.worldId);
    let scope = this.chapters.get(key);
    if (!scope) {
      scope = new Map();
      this.chapters.set(key, scope);
    }
    scope.set(request.chapter.chapterId, request.chapter);
  }

  async getChapter(request: GetChapterRequest): Promise<Chapter | null> {
    const key = scopeKey(request.sessionId, request.worldId);
    const scope = this.chapters.get(key);
    if (!scope) return null;
    return scope.get(request.chapterId) ?? null;
  }

  async listChapters(request: ListChaptersRequest): Promise<Chapter[]> {
    const key = scopeKey(request.sessionId, request.worldId);
    const scope = this.chapters.get(key);
    if (!scope) return [];
    return Array.from(scope.values()).sort(
      (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
    );
  }
}

// ============ InMemoryLoreStore ============

export class InMemoryLoreStore implements LoreStore {
  private entries = new Map<string, Map<string, LoreEntry>>();

  async query(request: QueryLoreRequest): Promise<LoreEntry[]> {
    const key = scopeKey(request.sessionId, request.worldId);
    const scope = this.entries.get(key);
    if (!scope) return [];

    const allEntries = Array.from(scope.values());
    const queryTokens = new Set(request.keywords.map((k) => k.toLowerCase()));

    const scored = allEntries
      .filter((entry) => {
        if (entry.activationMode === "manual_off") return false;
        if (entry.activationMode === "always_on") return true;
        // triggered: match keywords
        const entryTokens = new Set(entry.keywords.map((k) => k.toLowerCase()));
        for (const token of queryTokens) {
          if (entryTokens.has(token)) return true;
        }
        return false;
      })
      .map((entry) => {
        const entryTokens = new Set(entry.keywords.map((k) => k.toLowerCase()));
        let score = entry.priority;
        for (const token of queryTokens) {
          if (entryTokens.has(token)) score += 10;
        }
        return { entry, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, request.limit);

    return scored.map((item) => item.entry);
  }

  async putEntry(request: PutLoreEntryRequest): Promise<void> {
    const key = scopeKey(request.sessionId, request.worldId);
    let scope = this.entries.get(key);
    if (!scope) {
      scope = new Map();
      this.entries.set(key, scope);
    }
    scope.set(request.entry.id, request.entry);
  }
}

// ============ InMemoryTrackerStore ============

const emptyTrackerState = (sessionId: string, worldId: string): TrackerState => ({
  sessionId,
  worldId,
  characters: [],
  locations: [],
  items: [],
  timeState: {},
  version: 0,
});

const applyPatchToState = (state: TrackerState, patch: TrackerPatch): TrackerState => {
  const next = { ...state, version: state.version + 1 };

  for (const op of patch.operations) {
    switch (op.target) {
      case "characters": {
        const idx = next.characters.findIndex((c) => c.id === op.targetId);
        if (op.type === "remove" && idx >= 0) {
          next.characters = next.characters.filter((c) => c.id !== op.targetId);
        } else if (op.type === "add" && idx < 0) {
          next.characters = [...next.characters, op.value as (typeof next.characters)[number]];
        } else if (op.type === "update" && idx >= 0 && op.field) {
          const updated = { ...next.characters[idx]!, [op.field]: op.value };
          next.characters = next.characters.map((c, i) => (i === idx ? updated : c));
        }
        break;
      }
      case "locations": {
        const idx = next.locations.findIndex((l) => l.id === op.targetId);
        if (op.type === "remove" && idx >= 0) {
          next.locations = next.locations.filter((l) => l.id !== op.targetId);
        } else if (op.type === "add" && idx < 0) {
          next.locations = [...next.locations, op.value as (typeof next.locations)[number]];
        } else if (op.type === "update" && idx >= 0 && op.field) {
          const updated = { ...next.locations[idx]!, [op.field]: op.value };
          next.locations = next.locations.map((l, i) => (i === idx ? updated : l));
        }
        break;
      }
      case "items": {
        const idx = next.items.findIndex((i) => i.id === op.targetId);
        if (op.type === "remove" && idx >= 0) {
          next.items = next.items.filter((i) => i.id !== op.targetId);
        } else if (op.type === "add" && idx < 0) {
          next.items = [...next.items, op.value as (typeof next.items)[number]];
        } else if (op.type === "update" && idx >= 0 && op.field) {
          const updated = { ...next.items[idx]!, [op.field]: op.value };
          next.items = next.items.map((i, idx2) => (idx2 === idx ? updated : i));
        }
        break;
      }
      case "timeState": {
        if (op.type === "update" && op.field) {
          next.timeState = { ...next.timeState, [op.field]: op.value };
        }
        break;
      }
    }
  }

  return next;
};

export class InMemoryTrackerStore implements TrackerStore {
  private states = new Map<string, TrackerState>();

  async get(request: GetTrackerRequest): Promise<TrackerState> {
    const key = scopeKey(request.sessionId, request.worldId);
    return this.states.get(key) ?? emptyTrackerState(request.sessionId, request.worldId);
  }

  async applyPatch(request: ApplyTrackerPatchRequest): Promise<TrackerState> {
    const key = scopeKey(request.sessionId, request.worldId);
    const current = this.states.get(key) ?? emptyTrackerState(request.sessionId, request.worldId);
    const next = applyPatchToState(current, request.patch);
    this.states.set(key, next);
    return next;
  }
}
