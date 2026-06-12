// Store Interfaces - RP Runtime

import type { MemoryEvent, Chapter, LoreEntry, TrackerState, TrackerPatch } from "../types.js";
import type { RpLlmAdapter } from "../nodes/rpWriterV1.js";
import type { RpWriterConfig } from "../nodes/rpWriterV1.js";
import type { RpAssemblerConfig } from "../nodes/rpContextAssemblerV1.js";

// ============ Request Types ============

export interface PutEventRequest {
  sessionId: string;
  worldId: string;
  event: MemoryEvent;
}

export interface QueryEventsRequest {
  sessionId: string;
  worldId: string;
  query: string;
  limit: number;
}

export interface GetEventsByChapterRequest {
  sessionId: string;
  worldId: string;
  chapterId: string;
}

export interface PutChapterRequest {
  sessionId: string;
  worldId: string;
  chapter: Chapter;
}

export interface GetChapterRequest {
  sessionId: string;
  worldId: string;
  chapterId: string;
}

export interface ListChaptersRequest {
  sessionId: string;
  worldId: string;
}

export interface QueryLoreRequest {
  sessionId: string;
  worldId: string;
  keywords: string[];
  limit: number;
}

export interface PutLoreEntryRequest {
  sessionId: string;
  worldId: string;
  entry: LoreEntry;
}

export interface GetTrackerRequest {
  sessionId: string;
  worldId: string;
}

export interface ApplyTrackerPatchRequest {
  sessionId: string;
  worldId: string;
  patch: TrackerPatch;
}

// ============ Store Interfaces ============

export interface TimelineStore {
  putEvent(request: PutEventRequest): Promise<void>;
  queryEvents(request: QueryEventsRequest): Promise<MemoryEvent[]>;
  getEventsByChapter(request: GetEventsByChapterRequest): Promise<MemoryEvent[]>;
}

export interface ChapterStore {
  putChapter(request: PutChapterRequest): Promise<void>;
  getChapter(request: GetChapterRequest): Promise<Chapter | null>;
  listChapters(request: ListChaptersRequest): Promise<Chapter[]>;
}

export interface LoreStore {
  query(request: QueryLoreRequest): Promise<LoreEntry[]>;
  putEntry(request: PutLoreEntryRequest): Promise<void>;
}

export interface TrackerStore {
  get(request: GetTrackerRequest): Promise<TrackerState>;
  applyPatch(request: ApplyTrackerPatchRequest): Promise<TrackerState>;
}

// ============ Services ============

/**
 * RP Runtime Services - injected at registration time.
 *
 * ALLOWED in closure (stable services):
 * - Store instances
 * - LLM adapter
 * - Config objects
 * - Logger
 *
 * FORBIDDEN in closure (session state):
 * - sessionId
 * - worldId
 * - turnId
 * - Per-run input
 *
 * Session scope is read from NodeExecutionInput.context.values.rp at runtime.
 */
export interface RpRuntimeServices {
  stores: {
    timeline: TimelineStore;
    chapter: ChapterStore;
    lore: LoreStore;
    tracker: TrackerStore;
  };
  /** Optional LLM adapter for writer node. Injected at registration. */
  llmAdapter?: RpLlmAdapter;
  /** Optional config for writer node (fallback behavior). */
  writerConfig?: RpWriterConfig;
  /** Optional config for assembler node (budget limits). */
  assemblerConfig?: RpAssemblerConfig;
}
