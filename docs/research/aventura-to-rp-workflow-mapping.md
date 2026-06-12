# Aventura / Timeline-Memory to RP Workflow Mapping

This document maps the reference projects' architecture to our RP Workflow node system.

**Reference repositories analyzed:**

- `references/references/timeline-memory-master/` (SillyTavern extension)
- `references/references/timeline-extension-prompts-master/` (prompt presets)

**Note:** The Aventura repository was not found in the local references directory. Only timeline-memory was available.

---

## Files Actually Read

| File Path                                                     | Purpose                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `timeline-memory-master/README.md`                            | Feature overview, architecture description                         |
| `timeline-memory-master/index.js`                             | Extension entry point, event handlers                              |
| `timeline-memory-master/src/memories.js`                      | Core: chapter timeline, summarization, timeline fill, arc analyzer |
| `timeline-memory-master/src/lore-management.js`               | Lorebook CRUD via AI agent session                                 |
| `timeline-memory-master/src/agentic-timeline-fill.js`         | Agentic retrieval with tool calls                                  |
| `timeline-memory-master/src/commands.js`                      | Slash command registration, tool registration                      |
| `timeline-memory-master/src/settings.js`                      | Configuration, presets, prompt templates                           |
| `timeline-extension-prompts-master/Retrieval Management.json` | Prompt preset for agentic retrieval                                |
| `timeline-extension-prompts-master/Lore Management.json`      | Prompt preset for lore management                                  |

---

## Module Mapping

### 1. Chapter Timeline & Summarization

**Reference:** `src/memories.js`

- `timelineData[]` - Array of `{ summary, startMsgId, endMsgId }`
- `addChapterToTimeline()` - Appends chapter to timeline
- `generateChapterSummary()` - Summarizes messages between chapter boundaries
- `summarizeHistoryEntries()` - Chunked summarization for long chapters
- `genSummaryWithSlash()` - LLM call via ConnectionManagerRequestService

**Data flow:**

```
Chat messages → chunk by token limit → LLM summarize → chapter entry → save to chatMetadata.timeline
```

**Our mapping:** `rpChapterSummaryV1` node

- Input: `parsedInput` (user turn), `writerOutput` (AI response), `currentChapter`
- Output: `memoryEvent`, `chapterPatch`
- Decision: **Rewrite** - Reference uses SillyTavern-specific chat metadata; we use generic Store interfaces

---

### 2. Timeline Fill (Static Retrieval)

**Reference:** `src/memories.js`

- `runTimelineFill()` - Generates queries from current context, executes them
- `queryChapter()` / `queryChapters()` - LLM-based Q&A over chapter content
- `validateTimelineFillItems()` - Normalizes query plan JSON

**Data flow:**

```
Current chat + timeline summaries → LLM generates query plan → validate → execute queries → aggregate results → inject via {{timelineResponses}}
```

**Our mapping:** `rpTimelineQueryV1` node

- Input: `parsedInput`, `trackerState` (optional)
- Output: `timelineContext`
- Decision: **Rewrite** - Reference uses macro injection (`{{timelineResponses}}`); we use port-based data flow

---

### 3. Agentic Timeline Fill

**Reference:** `src/agentic-timeline-fill.js`

- Session-based: hides messages, registers tools, triggers LLM loop
- Tools: `query_timeline_chapter`, `query_timeline_chapters`, `list_lorebook_entries`, `end_information_retrieval`
- AI agent decides what to query, when to stop

**Data flow:**

```
Start session → hide messages → register tools → LLM loop → tool calls → end tool → save results → cleanup
```

**Our mapping:** Not directly mapped. Our workflow is DAG-based, not session-based.

- Decision: **Not adopted** - Session management is SillyTavern-specific. Our static retrieval node can be extended later if needed.

---

### 4. Lore Management

**Reference:** `src/lore-management.js`

- `startLoreManagementSession()` - Session lifecycle
- Tools: `list_entries`, `edit_entry` (create/update/delete), `end_lore_management`
- AI reads chapters, compares with lorebook, makes edits

**Data flow:**

```
Start session → list lorebook entries → LLM analyzes → tool calls to create/update/delete entries → end session → save lorebook
```

**Our mapping:** `rpLoreRetrieverV1` (read-only for now)

- Input: `parsedInput`, `trackerState`
- Output: `loreContext`
- Decision: **Partial adoption** - We adopt the read path (query lorebook by keywords). Write path (AI-driven lorebook editing) is deferred to a future phase.

---

### 5. Lorebook / World Info Structure

**Reference:** `src/lore-management.js`

- `listEntries()` - Returns `{ uid, comment, key, keysecondary, content, constant, selective, enabled }`
- Entries are stored in SillyTavern's World Info format
- Keywords trigger activation; constant entries are always active

**Our mapping:** `LoreEntry` type in `rp-runtime/src/types.ts`

- Fields: `id, title, content, keywords, category, activationMode, priority`
- Decision: **Rewrite** - We simplify the structure. No `keysecondary`/`selective` complexity. `activationMode` replaces `constant`/`selective` flags.

---

### 6. Context Injection (Inject at Depth)

**Reference:** `src/memories.js`

- `updateTimelineInjection()` - Builds injection prompt with macros
- Uses `setExtensionPrompt()` with depth and role parameters
- Injection filter prevents injection during internal generations

**Data flow:**

```
Settings + timeline data → macro expansion → setExtensionPrompt(key, prompt, depth, role)
```

**Our mapping:** `rpContextAssemblerV1` node

- Input: `parsedInput`, `timelineContext`, `loreContext`, `trackerState`, `recentMessages`
- Output: `assembledContext`, `budgetReport`
- Decision: **Rewrite** - Reference uses prompt injection at depth; we use explicit assembly with token budget control.

---

### 7. Arc Analyzer

**Reference:** `src/memories.js`

- `analyzeArcs()` - LLM identifies natural chapter boundaries
- Returns JSON array of `{ title, summary, chapterEnd, justification }`
- UI popup lets user select where to end chapters

**Our mapping:** Not mapped in Phase A/B.

- Decision: **Deferred** - Chapter boundary detection is a future feature.

---

### 8. Auto-Summarize

**Reference:** `src/memories.js`

- `checkAutoSummarize()` - Triggers when message count exceeds threshold
- Uses separate LLM profile to select optimal chapter endpoint

**Our mapping:** Not mapped.

- Decision: **Deferred** - Automatic chapter creation is a future feature.

---

### 9. Prompt Presets

**Reference:** `timeline-extension-prompts-master/*.json`

- Complete prompt configurations for different tasks
- Include system prompts, user prompts, model parameters
- Importable/exportable as JSON files

**Our mapping:** Node `configFields` and `defaultConfig`

- Decision: **Not adopted directly** - Our config is per-node, not global presets. Users can save/load workflow templates instead.

---

## Summary Table

| Reference Module        | Our Node               | Decision    | Notes                                  |
| ----------------------- | ---------------------- | ----------- | -------------------------------------- |
| Chapter Timeline        | `rpChapterSummaryV1`   | Rewrite     | Generic Store instead of chat metadata |
| Timeline Fill (static)  | `rpTimelineQueryV1`    | Rewrite     | Port-based data flow instead of macros |
| Timeline Fill (agentic) | —                      | Not adopted | Session model doesn't fit DAG workflow |
| Lore Management (read)  | `rpLoreRetrieverV1`    | Partial     | Read-only for now                      |
| Lore Management (write) | —                      | Deferred    | Future phase                           |
| Lorebook structure      | `LoreEntry` type       | Rewrite     | Simplified, no secondary keys          |
| Inject at Depth         | `rpContextAssemblerV1` | Rewrite     | Explicit assembly with budget          |
| Arc Analyzer            | —                      | Deferred    | Future feature                         |
| Auto-Summarize          | —                      | Deferred    | Future feature                         |
| Prompt Presets          | Node config            | Not adopted | Per-node config instead                |

---

## Key Architectural Differences

| Aspect              | Reference (timeline-memory)    | Our System                                |
| ------------------- | ------------------------------ | ----------------------------------------- |
| Execution model     | Session-based, event-driven    | DAG-based, batch execution                |
| Data flow           | Global state + macro injection | Port-based, explicit edges                |
| Storage             | chatMetadata (per-chat)        | Store interfaces (session/world isolated) |
| Context assembly    | Prompt injection at depth      | Explicit assembly node with budget        |
| Agent orchestration | Tool calls in LLM loop         | Node graph with parallel batches          |
| Configuration       | Global presets                 | Per-node config fields                    |

---

## What We Did NOT Find

- **Aventura repository**: Not present in local references. Only timeline-memory was available.
- **Dynamic world book retrieval**: Reference uses keyword matching, not vector search.
- **Character/location/item trackers**: Reference does not have explicit state tracking. World state is implicit in lorebook entries.
- **Token budget management**: Reference does not have explicit budget control. Context size is managed by SillyTavern core.
