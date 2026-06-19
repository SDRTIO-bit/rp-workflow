import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mapWorldbookEntries } from "./worldbookMapper.js";
import type { SillyTavernCardV3 } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "__fixtures__");

function loadFixture(name: string): SillyTavernCardV3 {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

const TEST_CARD_ID = "a".repeat(64);

describe("mapWorldbookEntries", () => {
  it("maps entries from minimal card", () => {
    const card = loadFixture("minimal-v3.json");
    const result = mapWorldbookEntries(card.data.character_book, TEST_CARD_ID);

    expect(result.entries).toHaveLength(1);
    const e0 = result.entries[0]!;
    expect(e0.id).toBe(`card:${TEST_CARD_ID}:e1`);
    expect(e0.content).toContain("Testing Lab");
    expect(e0.metadata.activationPolicy).toBe("retrieval");
    expect(e0.metadata.cardId).toBe(TEST_CARD_ID);
    expect(e0.metadata.importSchemaVersion).toBe(1);
  });

  it("L20: skips disabled entries", () => {
    const card = loadFixture("var-conditions-v3.json");
    const result = mapWorldbookEntries(card.data.character_book, TEST_CARD_ID);

    const disabledEntry = result.entries.find((e) => e.id.includes(":e5"));
    expect(disabledEntry).toBeUndefined();
    expect(result.counts.disabled).toBe(1);
  });

  it("L21: constant entries get always-core policy but are NOT auto-injected", () => {
    const card = loadFixture("minimal-v3.json");
    // Modify entry to be constant
    if (card.data.character_book?.entries?.[0]) {
      card.data.character_book.entries[0].constant = true;
    }
    const result = mapWorldbookEntries(card.data.character_book, TEST_CARD_ID);

    expect(result.entries).toHaveLength(1);
    const e0 = result.entries[0]!;
    expect(e0.metadata.activationPolicy).toBe("always-core");
    expect(e0.metadata.sourceConstant).toBe(true);
    expect(result.counts.constant).toBe(1);

    // Warning should be present
    const warning = result.warnings.find((w) => w.code === "constant-entries-not-auto-injected");
    expect(warning).toBeTruthy();
  });

  it("defers variable-condition entries and blocks script entries", () => {
    const card = loadFixture("var-conditions-v3.json");
    const result = mapWorldbookEntries(card.data.character_book, TEST_CARD_ID);

    // Entries 1 (EJS), 2 (getvar/setvar), 3 (MVU) all have patterns detected
    // EJS is detected as blocked-script; getvar/setvar/MVU as deferred-variable
    expect(result.deferred.length).toBe(3);

    // Entry 2 (getvar) and Entry 3 (MVU) → deferred-variable
    const varDeferred = result.deferred.filter((d) => d.reason === "deferred-variable");
    expect(varDeferred.length).toBeGreaterThanOrEqual(2);

    // Entry 4 is clean → active
    const cleanEntry = result.entries.find((e) => e.id.includes(":e4"));
    expect(cleanEntry).toBeTruthy();
    expect(cleanEntry?.metadata.activationPolicy).toBe("retrieval");
  });

  it("merges keys and secondary_keys into tags", () => {
    const card = loadFixture("minimal-v3.json");
    const result = mapWorldbookEntries(card.data.character_book, TEST_CARD_ID);

    const entry = result.entries[0]!;
    expect(entry.tags).toContain("lab");
    expect(entry.tags).toContain("testing");
    expect(entry.tags).toContain("test");
  });

  it("preserves whitelisted metadata scalars", () => {
    const card = loadFixture("minimal-v3.json");
    const result = mapWorldbookEntries(card.data.character_book, TEST_CARD_ID);

    const meta = result.entries[0]!.metadata;
    expect(meta.sourcePosition).toBe("before_char");
    expect(meta.sourceDepth).toBe(4);
    expect(meta.sourceProbability).toBe(100);
    expect(meta.sourcePreventRecursion).toBe(true);
    expect(meta.sourceUseProbability).toBe(true);
  });

  it("does not copy raw extensions to entry metadata fields", () => {
    const card = loadFixture("var-conditions-v3.json");
    const result = mapWorldbookEntries(card.data.character_book, TEST_CARD_ID);

    // Extensions are stored in sourceExtensions as preserved metadata
    // but NOT copied to top-level DynamicWorldbookEntryV1 fields
    for (const entry of result.entries) {
      expect(entry.metadata.sourceExtensions).toBeDefined();
    }
  });

  it("chunks long entries", () => {
    const card = loadFixture("minimal-v3.json");
    // Make entry content very long
    if (card.data.character_book?.entries?.[0]) {
      card.data.character_book.entries[0].content = "A".repeat(15000);
    }
    const result = mapWorldbookEntries(card.data.character_book, TEST_CARD_ID);

    expect(result.entries.length).toBeGreaterThan(1);
    // Check chunking provenance
    for (const entry of result.entries) {
      expect(entry.metadata.sourceEntryId).toBeTruthy();
      expect(entry.metadata.partIndex).not.toBeNull();
      expect(entry.metadata.partCount).not.toBeNull();
    }

    // Warning should be present
    const warning = result.warnings.find((w) => w.code === "entry-chunked");
    expect(warning).toBeTruthy();
  });

  it("L5: long entry chunking — 10,000+ char entry splits at paragraph boundary, no char loss", () => {
    const card = loadFixture("minimal-v3.json");
    // 12,000 char entry with newlines every 500 chars to force boundary splits
    const original = Array.from({ length: 24 }, (_, i) => `block${i}:${"x".repeat(490)}`).join(
      "\n",
    );
    if (card.data.character_book?.entries?.[0]) {
      card.data.character_book.entries[0].content = original;
    }
    const result = mapWorldbookEntries(card.data.character_book, TEST_CARD_ID);

    expect(result.entries.length).toBeGreaterThan(1);

    // Reassemble: must equal original exactly (no char loss, no duplication)
    const reassembled = result.entries.map((e) => e.content).join("");
    expect(reassembled).toBe(original);

    // Every chunk must respect the 10,000-char limit (workflow-worldbook cap)
    for (const e of result.entries) {
      expect(e.content.length).toBeLessThanOrEqual(10_000);
    }

    // partIndex / partCount consistency
    const counts = result.entries.map((e) => e.metadata.partCount);
    expect(new Set(counts).size).toBe(1); // all chunks agree on total
    for (let i = 0; i < result.entries.length; i++) {
      expect(result.entries[i]!.metadata.partIndex).toBe(i);
    }

    // sourceEntryId is stable across chunks
    const sourceIds = new Set(result.entries.map((e) => e.metadata.sourceEntryId));
    expect(sourceIds.size).toBe(1);
  });

  it("L5: 100,000+ char entry is rejected with error warning, not silently truncated", () => {
    const card = loadFixture("minimal-v3.json");
    const tooLong = "Z".repeat(100_001);
    if (card.data.character_book?.entries?.[0]) {
      card.data.character_book.entries[0].content = tooLong;
    }
    const result = mapWorldbookEntries(card.data.character_book, TEST_CARD_ID);

    // No entry created from the oversized one
    const oversized = result.entries.find((e) => e.content === tooLong);
    expect(oversized).toBeUndefined();

    // An error-level warning must be present
    const rejWarning = result.warnings.find(
      (w) => w.code === "entry-rejected-too-long" && w.severity === "error",
    );
    expect(rejWarning).toBeTruthy();
    expect(rejWarning!.location).toBe("entry:1");
  });

  it("L5: chunk ID format is stable and deterministic across calls", () => {
    const card = loadFixture("minimal-v3.json");
    if (card.data.character_book?.entries?.[0]) {
      card.data.character_book.entries[0].content = "B".repeat(20_000);
    }
    const r1 = mapWorldbookEntries(card.data.character_book, TEST_CARD_ID);
    const r2 = mapWorldbookEntries(card.data.character_book, TEST_CARD_ID);
    expect(r1.entries.map((e) => e.id)).toEqual(r2.entries.map((e) => e.id));
  });

  it("returns empty for undefined book", () => {
    const result = mapWorldbookEntries(undefined, TEST_CARD_ID);
    expect(result.entries).toHaveLength(0);
    expect(result.deferred).toHaveLength(0);
  });

  it("handles array-typed keys and secondary_keys (SillyTavern V3 variant)", () => {
    // Real-world V3 cards may store keys/secondary_keys as string[] instead of comma-separated string.
    const book = {
      entries: [
        {
          uid: 1,
          content: "Array keys entry",
          keys: ["alpha", "beta"],
          secondary_keys: ["gamma", "delta"],
          constant: false,
        },
        {
          uid: 2,
          content: "String keys entry",
          keys: "one, two, three",
          secondary_keys: "four",
          constant: false,
        },
      ],
    };
    const result = mapWorldbookEntries(book, TEST_CARD_ID);

    expect(result.entries).toHaveLength(2);

    // Array-typed keys entry
    const e1 = result.entries.find((e) => e.id.includes(":e1"))!;
    expect(e1.tags).toEqual(["alpha", "beta", "delta", "gamma"]);
    expect(e1.metadata.sourceKeys).toEqual(["alpha", "beta"]);
    expect(e1.metadata.sourceSecondaryKeys).toEqual(["gamma", "delta"]);

    // String-typed keys entry (regression: comma-split still works)
    const e2 = result.entries.find((e) => e.id.includes(":e2"))!;
    expect(e2.tags).toEqual(["four", "one", "three", "two"]);
    expect(e2.metadata.sourceKeys).toEqual(["one", "two", "three"]);
    expect(e2.metadata.sourceSecondaryKeys).toEqual(["four"]);
  });
});
