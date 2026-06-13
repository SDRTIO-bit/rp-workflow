# Parser Audit: Entity Extraction in `rpInputParserV1`

**Date**: 2026-06-12
**Audit Scope**: Entity extraction (characters, locations, items, timeHints) from user input
**File**: `packages/rp-runtime/src/nodes/rpInputParserV1.ts`

---

## 1. Current Behavior

The `parseInput` function extracts **only two things** from raw text:

| Extracted             | Method                                  | Status       |
| --------------------- | --------------------------------------- | ------------ |
| `dialogues`           | Regex `"..."` / \`“...”\` / \`「...」\` | Working      |
| `actions`             | Regex \`_..._\`                         | Working      |
| `intents`             | Hardcoded `[]`                          | Always empty |
| `entities.characters` | Hardcoded `[]`                          | Always empty |
| `entities.locations`  | Hardcoded `[]`                          | Always empty |
| `entities.items`      | Hardcoded `[]`                          | Always empty |
| `entities.timeHints`  | Hardcoded `[]`                          | Always empty |

**Lines 97-101** of the parser:

```typescript
entities: {
  characters: [],
  locations: [],
  items: [],
  timeHints: [],
},
```

The comment on line 57 says: _"Future: replace with LLM-based extraction"_ but in the meantime, the empty arrays are silently passed downstream.

---

## 2. Consumers of `parsedInput.entities`

Three downstream nodes consume `parsedInput.entities`:

### 2a. `rpTimelineQueryV1` (Timeline Query)

- **Line 87-91**: Maps entities to lowercase query arrays
- **Lines 230-251**: Scores events using entity overlap:
  - Character match: **+3** per match
  - Location match: **+2** per match
  - Item match: **+1** per match
- **Impact**: Entity scoring bonus is **always zero**. Timeline relevance relies solely on keyword matches from `rawText` tokens (+1 each, lines 222-227).

### 2b. `rpLoreRetrieverV1` (Lore Retriever)

- **Lines 88-92**: Maps entities to lowercase query arrays
- **Lines 288-301**: Checks entity overlap against lore entry keywords (marked in `matchedBy` but does **not** add score only logged)
- **Impact**: Entity overlap logging is dead. Lore retrieval still works via keyword matching (lines 256-286) which uses `rawText` tokens.

### 2c. `rpTrackerUpdateV1` (Tracker Update)

- **Lines 91-161**: Iterates over `entities.characters`, `entities.locations`, `entities.items` to auto-detect new entities in tracker state. Uses `entities.timeHints` to update time state.
- All four loops are **dead code** they iterate over empty arrays and produce no patch operations.

---

## 3. Mitigating Factor: Keyword Fallback

Both Timeline and Lore consumers also call `extractKeywords`/`extractQueryKeywords`, which:

1. Push entity arrays (empty no-op)
2. Push intents (empty no-op)
3. **Tokenize `rawText`** and push words > 2 characters (this **does** produce useful keywords)

So the **keyword search still functions**, but:

- No structured entity matching means lore entries keyed _only_ by character name (with no overlap with `rawText` tokens) may be missed.
- Timeline scoring loses the +3/+2/+1 entity bonuses events are scored only by flat keyword matches.

---

## 4. Minimal Enhancement Proposal (regex-based, no LLM)

Implement a simple regex-based entity extraction pass that runs **after** dialogue/action extraction. Entities are typically indicated by:

### Characters

- In dialogue attribution patterns: `"Hello," Alice said.` extract `Alice`
- Named after \`_action_\` containing a character name
- Simple heuristic: match capitalized words before `said`/`asked`/`replied`/`shouted`/`whispered` after quoted text

### Locations

- Prepositions + capitalized nouns: `in the Tavern`, `at the Castle`, `to the Forest`
- Pattern: `\b(?:in|at|to|from|through|into|inside|outside|near|behind|under|on)\s+(?:the\s+)?([A-Z][a-z]+)\b`

### Items

- Possessives: `his sword`, `her amulet`, `the ancient key`
- Indefinite articles + noun: `a rusty dagger`, `an old map`
- Pattern: `\b(?:a|an|the|his|her|their|my|your)\s+([a-z]+\s+)?([a-z]+)\b` with POS-like filtering

### What NOT to do

- No LLM calls (expensive, slow, non-deterministic)
- No NER libraries (avoids dependency bloat)
- No training data needed

---

## 5. Test File Coverage

The test file (`rpInputParserV1.test.ts`) verifies:

- Entity arrays exist and are arrays (lines 92-96)
- Does **not** test that entities are populated with actual values

This is correct for the MVP the test allows empty arrays. If entity extraction is added, tests should be extended to cover:

- Character extraction from attribution patterns
- Location extraction from prepositional phrases
- Item extraction from possessives/articles
- Time hint extraction

---

## 6. Recommended Action

| Priority | Action                                                          | Effort   |
| -------- | --------------------------------------------------------------- | -------- |
| P0       | Add regex-based entity extraction to `parseInput`               | ~2 hours |
| P1       | Add entity extraction unit tests                                | ~1 hour  |
| P2       | Check `rpTrackerUpdateV1` currently auto-detection is dead code | ~30 min  |

**Without entity extraction**, the scoring model in Timeline and Lore retrieval is degraded to flat keyword matching only (missing the +3/+2/+1 entity bonuses), and Tracker auto-detection does nothing.
