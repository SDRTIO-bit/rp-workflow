// RP Runtime Types - Phase A

// ============ Execution Scope ============

export interface RpExecutionScope {
  sessionId: string;
  worldId: string;
  turnId: string;
}

// ============ Memory Event ============

export interface MemoryEvent {
  eventId: string;
  sessionId: string;
  worldId: string;
  chapterId: string;
  sourceTurnId: string;
  summary: string;
  characters: string[];
  locations: string[];
  items: string[];
  time: string | null;
  emotionalChanges: string[];
  createdAt: string;
}

// ============ Chapter ============

export interface Chapter {
  chapterId: string;
  sessionId: string;
  worldId: string;
  title: string;
  summary: string;
  events: string[]; // eventId list
  startedAt: string;
  updatedAt: string;
}

// ============ Lore Entry ============

export type LoreCategory =
  | "character"
  | "location"
  | "item"
  | "relationship"
  | "event"
  | "rule"
  | "custom";

export type LoreActivationMode = "always_on" | "triggered" | "manual_off";

export interface LoreEntry {
  id: string;
  sessionId: string;
  worldId: string;
  title: string;
  content: string;
  keywords: string[];
  category: LoreCategory;
  activationMode: LoreActivationMode;
  priority: number;
}

// ============ Tracker State ============

export interface TrackerState {
  sessionId: string;
  worldId: string;
  characters: CharacterState[];
  locations: LocationState[];
  items: ItemState[];
  timeState: TimeState;
  version: number;
}

export interface CharacterState {
  id: string;
  name: string;
  location?: string;
  mood?: string;
  status?: string;
  relationships: Record<string, string>;
  inventory?: string[];
}

export interface LocationState {
  id: string;
  name: string;
  description?: string;
  occupants?: string[];
}

export interface ItemState {
  id: string;
  name: string;
  owner?: string;
  location?: string;
  status?: string;
}

export interface TimeState {
  currentTime?: string;
  day?: number;
  season?: string;
}

// ============ Tracker Patch ============

export interface TrackerPatch {
  sessionId: string;
  worldId: string;
  sourceTurnId: string;
  operations: PatchOperation[];
  timestamp: string;
}

export interface PatchOperation {
  type: "add" | "update" | "remove";
  target: "characters" | "locations" | "items" | "timeState";
  targetId: string;
  field?: string;
  value?: unknown;
}

// ============ Parsed Input ============

export interface ParsedInput {
  rawText: string;
  actions: string[];
  dialogues: DialogueLine[];
  intents: string[];
  entities: {
    characters: string[];
    locations: string[];
    items: string[];
    timeHints: string[];
  };
  mood?: string;
  parsedAt: string;
}

export interface DialogueLine {
  speaker: string;
  text: string;
  tone?: string;
}

// ============ Timeline Context ============

export interface TimelineContext {
  chapters: ChapterSummary[];
  relevantEvents: TimelineEventResult[];
  totalChapters: number;
  queryTimeMs: number;
}

export interface ChapterSummary {
  chapterId: string;
  summary: string;
  relevanceScore: number;
}

/**
 * Memory event with retrieval scoring metadata.
 */
export interface TimelineEventResult extends MemoryEvent {
  score: number;
  matchedBy: string[];
}

// ============ Lore Context ============

export interface LoreContext {
  entries: LoreEntryResult[];
  activatedBy: string[];
  totalEntries: number;
}

/**
 * Lore entry with retrieval scoring metadata.
 */
export interface LoreEntryResult extends LoreEntry {
  score: number;
  matchedBy: string[];
}

// ============ Assembled Context ============

export interface AssembledContext {
  systemPrompt: string;
  loreSection: string;
  timelineSection: string;
  trackerSection: string;
  recentMessagesSection: string;
  userInputSection: string;
  fullContext: string;
}

// ============ Budget Report ============

export type TokenEstimationMethod = "character_ratio" | "tokenizer";

export interface BudgetReport {
  targetTokens: number;
  hardLimitTokens: number;
  allocated: Record<string, number>;
  actual: Record<string, number>;
  truncatedSections: string[];
  droppedSections: string[];
  tokenEstimationMethod: TokenEstimationMethod;
  warnings: string[];
}

// ============ Writer Output ============

export type GenerationMode = "llm" | "mock" | "echo_fallback";

export interface WriterOutput {
  text: string;
  generationMode: GenerationMode;
  warnings?: string[];
  metadata: {
    model: string;
    tokenUsage: { input: number; output: number; cached?: number };
    latencyMs: number;
  };
}
