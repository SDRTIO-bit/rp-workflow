import { describe, it, expect } from "vitest";
import { validateAndGround } from "../../src/parser/grounding.js";
import { expandSemantically } from "../../src/parser/semanticExpander.js";
import { WUGANG_WORLDBOOK } from "../fixtures/wugangWorldbook.js";
import type { ParsedRpInputV1 } from "../../src/parser/types.js";

// ============ Grounding Validator Tests ============

describe("validateAndGround", () => {
  const validEntityIds = ["player", "char_su_ling", "char_shen_yan", "item_silver_bell"];

  it("passes valid mentions through", () => {
    const parsed: ParsedRpInputV1 = {
      version: "parsed-rp-input-v1",
      rawText: "test",
      mentions: [
        { text: "苏绫", entityId: "char_su_ling", confidence: 0.9, evidence: "alias match" },
      ],
      references: [],
      dialogues: [],
      actions: [],
      intents: [],
      historicalReferences: [],
      relationshipSignals: [],
      unresolvedReferences: [],
      diagnostics: {
        parseAttempts: 1,
        removedInvalidEntityIds: [],
        removedInvalidEntryIds: [],
        warnings: [],
      },
    };

    const result = validateAndGround(parsed, WUGANG_WORLDBOOK, validEntityIds);

    expect(result.validated.mentions).toHaveLength(1);
    expect(result.removedEntityIds).toHaveLength(0);
  });

  it("removes invalid entityId", () => {
    const parsed: ParsedRpInputV1 = {
      version: "parsed-rp-input-v1",
      rawText: "test",
      mentions: [
        { text: "unknown", entityId: "nonexistent_entity", confidence: 0.5, evidence: "guess" },
      ],
      references: [],
      dialogues: [],
      actions: [],
      intents: [],
      historicalReferences: [],
      relationshipSignals: [],
      unresolvedReferences: [],
      diagnostics: {
        parseAttempts: 1,
        removedInvalidEntityIds: [],
        removedInvalidEntryIds: [],
        warnings: [],
      },
    };

    const result = validateAndGround(parsed, WUGANG_WORLDBOOK, validEntityIds);

    expect(result.validated.mentions).toHaveLength(0);
    expect(result.removedEntityIds).toContain("nonexistent_entity");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("removes invalid entryId", () => {
    const parsed: ParsedRpInputV1 = {
      version: "parsed-rp-input-v1",
      rawText: "test",
      mentions: [
        {
          text: "test",
          entityId: "char_su_ling",
          entryId: "nonexistent_entry",
          confidence: 0.9,
          evidence: "test",
        },
      ],
      references: [],
      dialogues: [],
      actions: [],
      intents: [],
      historicalReferences: [],
      relationshipSignals: [],
      unresolvedReferences: [],
      diagnostics: {
        parseAttempts: 1,
        removedInvalidEntityIds: [],
        removedInvalidEntryIds: [],
        warnings: [],
      },
    };

    const result = validateAndGround(parsed, WUGANG_WORLDBOOK, validEntityIds);

    expect(result.validated.mentions).toHaveLength(0);
    expect(result.removedEntryIds).toContain("nonexistent_entry");
  });

  it("allows 'player' as valid entityId", () => {
    const parsed: ParsedRpInputV1 = {
      version: "parsed-rp-input-v1",
      rawText: "test",
      mentions: [{ text: "我", entityId: "player", confidence: 0.95, evidence: "pronoun" }],
      references: [],
      dialogues: [],
      actions: [],
      intents: [],
      historicalReferences: [],
      relationshipSignals: [],
      unresolvedReferences: [],
      diagnostics: {
        parseAttempts: 1,
        removedInvalidEntityIds: [],
        removedInvalidEntryIds: [],
        warnings: [],
      },
    };

    const result = validateAndGround(parsed, WUGANG_WORLDBOOK, validEntityIds);

    expect(result.validated.mentions).toHaveLength(1);
    expect(result.removedEntityIds).toHaveLength(0);
  });
});

// ============ Semantic Expander Tests ============

describe("expandSemantically", () => {
  const deterministicIds = new Set(["char_su_ling"]);

  it("expands from resolved mentions", () => {
    const parsed: ParsedRpInputV1 = {
      version: "parsed-rp-input-v1",
      rawText: "test",
      mentions: [
        {
          text: "银铃",
          entityId: "char_su_ling",
          entryId: "item_silver_bell",
          confidence: 0.9,
          evidence: "test",
        },
      ],
      references: [],
      dialogues: [],
      actions: [],
      intents: [],
      historicalReferences: [],
      relationshipSignals: [],
      unresolvedReferences: [],
      diagnostics: {
        parseAttempts: 1,
        removedInvalidEntityIds: [],
        removedInvalidEntryIds: [],
        warnings: [],
      },
    };

    const result = expandSemantically(parsed, WUGANG_WORLDBOOK, deterministicIds);

    expect(result.expandedEntries.some((e) => e.id === "item_silver_bell")).toBe(true);
  });

  it("expands from historical references", () => {
    const parsed: ParsedRpInputV1 = {
      version: "parsed-rp-input-v1",
      rawText: "test",
      mentions: [],
      references: [],
      dialogues: [],
      actions: [],
      intents: [],
      historicalReferences: [
        { text: "三年前钟楼失火", entryId: "event_clocktower_fire", confidence: 0.9 },
      ],
      relationshipSignals: [],
      unresolvedReferences: [],
      diagnostics: {
        parseAttempts: 1,
        removedInvalidEntityIds: [],
        removedInvalidEntryIds: [],
        warnings: [],
      },
    };

    const result = expandSemantically(parsed, WUGANG_WORLDBOOK, deterministicIds);

    expect(result.expandedEntries.some((e) => e.id === "event_clocktower_fire")).toBe(true);
  });

  it("does not duplicate deterministic entries", () => {
    const parsed: ParsedRpInputV1 = {
      version: "parsed-rp-input-v1",
      rawText: "test",
      mentions: [
        {
          text: "苏绫",
          entityId: "char_su_ling",
          entryId: "char_su_ling",
          confidence: 1,
          evidence: "direct",
        },
      ],
      references: [],
      dialogues: [],
      actions: [],
      intents: [],
      historicalReferences: [],
      relationshipSignals: [],
      unresolvedReferences: [],
      diagnostics: {
        parseAttempts: 1,
        removedInvalidEntityIds: [],
        removedInvalidEntryIds: [],
        warnings: [],
      },
    };

    const result = expandSemantically(parsed, WUGANG_WORLDBOOK, deterministicIds);

    // char_su_ling should NOT be in expanded (it's already deterministic)
    expect(result.expandedEntries.some((e) => e.id === "char_su_ling")).toBe(false);
  });
});
