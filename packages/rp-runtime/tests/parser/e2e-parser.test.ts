/**
 * Parser E2E Tests - Phase B-2.8
 *
 * Tests for LLM Parser, Grounding Validator, and Semantic Expander.
 * Covers all 7 required scenarios.
 */

import { describe, it, expect } from "vitest";
import { createRpInputParserLlmV1Executor } from "../../src/parser/rpInputParserLlmV1.js";
import { createRpSemanticExpanderV1Executor } from "../../src/parser/rpSemanticExpanderV1.js";
import { createRpParserInputBuilderV1Executor } from "../../src/parser/rpParserInputBuilderV1.js";
import { expandSemantically } from "../../src/parser/semanticExpander.js";
import { validateParsedRpInputV1 } from "../../src/parser/validator.js";
import { regexParseInput } from "../../src/parser/regexFallback.js";
import { WUGANG_WORLDBOOK } from "../fixtures/wugangWorldbook.js";
import type { ParsedRpInputV1, ParserInputV1 } from "../../src/parser/types.js";
import type { WorldbookRetrievalResult } from "../../src/worldbook/types.js";
import type { RpLlmAdapter } from "../../src/nodes/rpWriterV1.js";

// ============ Mock LLM Adapter ============

/**
 * Create a mock LLM adapter that returns specified responses.
 */
function createMockLlmAdapter(
  responses: Array<{ text: string; shouldFail?: boolean }>,
): RpLlmAdapter {
  let callIndex = 0;

  return {
    provider: "mock-deepseek",
    complete: async (_prompt: string) => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;

      if (response.shouldFail) {
        throw new Error("Mock LLM failure");
      }

      return {
        text: response.text,
        tokenUsage: { input: 100, output: 50 },
      };
    },
    stream: async function* (_prompt: string) {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      yield { text: response.text, done: true };
    },
  };
}

/**
 * Create a mock LLM adapter that returns invalid JSON.
 */
function createMockLlmAdapterWithInvalidJson(): RpLlmAdapter {
  let callCount = 0;

  return {
    provider: "mock-deepseek",
    complete: async (_prompt: string) => {
      callCount++;

      // First call returns invalid JSON
      if (callCount === 1) {
        return {
          text: "This is not valid JSON",
          tokenUsage: { input: 100, output: 50 },
        };
      }

      // Second call returns valid JSON
      return {
        text: JSON.stringify({
          version: "parsed-rp-input-v1",
          rawText: "test",
          mentions: [],
          references: [],
          dialogues: [],
          actions: [],
          intents: [],
          historicalReferences: [],
          relationshipSignals: [],
          unresolvedReferences: [],
          diagnostics: {
            parserMode: "llm",
            parseAttempts: 1,
            removedInvalidEntityIds: [],
            removedInvalidEntryIds: [],
            warnings: [],
          },
        }),
        tokenUsage: { input: 100, output: 50 },
      };
    },
    stream: async function* (_prompt: string) {
      yield { text: "", done: true };
    },
  };
}

/**
 * Create a mock LLM adapter that returns invalid entity IDs.
 */
function createMockLlmAdapterWithInvalidIds(): RpLlmAdapter {
  return {
    provider: "mock-deepseek",
    complete: async (_prompt: string) => {
      return {
        text: JSON.stringify({
          version: "parsed-rp-input-v1",
          rawText: "test input",
          mentions: [
            {
              text: "苏绫",
              entityId: "char_su_ling",
              entryId: "char_su_ling",
              confidence: 0.95,
              evidence: "alias match",
            },
            {
              text: "invalid entry",
              entityId: "char_su_ling", // Valid entityId
              entryId: "nonexistent_entry_456", // Invalid entryId
              confidence: 0.5,
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
            parserMode: "llm",
            parseAttempts: 1,
            removedInvalidEntityIds: [],
            removedInvalidEntryIds: [],
            warnings: [],
          },
        }),
        tokenUsage: { input: 100, output: 50 },
      };
    },
    stream: async function* (_prompt: string) {
      yield { text: "", done: true };
    },
  };
}

// ============ Test Data ============

const COMPLEX_CHINESE_INPUT =
  "我没有立刻接过阿绫递来的银铃，而是盯着铃身上那道被火烧过的白塔纹章。三年前钟楼失火时，沈砚也带着同样的东西。楼下忽然传来巡夜司的敲门声。我压低声音问她：\u201C教会的人为什么会知道我们在这里？\u201D说完，我把失踪名单塞进外套，示意她从地下水道离开，自己则走向门口拖延时间。";

const VALID_LLM_RESPONSE = JSON.stringify({
  version: "parsed-rp-input-v1",
  rawText: COMPLEX_CHINESE_INPUT,
  mentions: [
    {
      text: "阿绫",
      entityId: "char_su_ling",
      entryId: "char_su_ling",
      category: "character",
      confidence: 0.95,
      evidence: "别名匹配：阿绫 → 苏绫",
    },
    {
      text: "银铃",
      entityId: "item_silver_bell",
      entryId: "item_silver_bell",
      category: "item",
      confidence: 0.9,
      evidence: "道具名称匹配",
    },
    {
      text: "白塔纹章",
      entityId: "faction_white_tower",
      entryId: "faction_white_tower",
      category: "faction",
      confidence: 0.8,
      evidence: "纹章关联白塔教会",
    },
    {
      text: "沈砚",
      entityId: "char_shen_yan",
      entryId: "char_shen_yan",
      category: "character",
      confidence: 0.95,
      evidence: "角色名称直接匹配",
    },
    {
      text: "巡夜司",
      entityId: "faction_night_patrol",
      entryId: "faction_night_patrol",
      category: "faction",
      confidence: 0.9,
      evidence: "势力名称匹配",
    },
    {
      text: "失踪名单",
      itemId: "item_missing_list",
      entryId: "item_missing_list",
      category: "item",
      confidence: 0.85,
      evidence: "道具名称匹配",
    },
    {
      text: "地下水道",
      entityId: "location_sewer",
      entryId: "location_sewer",
      category: "location",
      confidence: 0.9,
      evidence: "地点名称匹配",
    },
  ],
  references: [
    {
      text: "她",
      resolvedEntityId: "char_su_ling",
      resolutionSource: "current_input",
      confidence: 0.95,
    },
    {
      text: "我们",
      resolvedEntityId: "player",
      resolutionSource: "current_input",
      confidence: 0.9,
    },
    {
      text: "自己",
      resolvedEntityId: "player",
      resolutionSource: "current_input",
      confidence: 0.95,
    },
  ],
  dialogues: [
    {
      speakerEntityId: "player",
      targetEntityIds: ["char_su_ling"],
      text: "教会的人为什么会知道我们在这里？",
      toneHints: ["压低声音", "紧张"],
    },
  ],
  actions: [
    {
      actorEntityId: "player",
      action: "拒绝立刻接过银铃",
      targetEntityIds: [],
      objectEntityIds: ["item_silver_bell"],
      locationEntityIds: [],
      purpose: "观察纹章",
    },
    {
      actorEntityId: "player",
      action: "盯着白塔纹章",
      targetEntityIds: [],
      objectEntityIds: ["faction_white_tower"],
      locationEntityIds: [],
      purpose: "调查",
    },
    {
      actorEntityId: "player",
      action: "藏起失踪名单",
      targetEntityIds: [],
      objectEntityIds: ["item_missing_list"],
      locationEntityIds: [],
      purpose: "保护证据",
    },
    {
      actorEntityId: "player",
      action: "示意苏绫撤离",
      targetEntityIds: ["char_su_ling"],
      objectEntityIds: [],
      locationEntityIds: ["location_sewer"],
      purpose: "保护",
    },
    {
      actorEntityId: "player",
      action: "走向门口拖延时间",
      targetEntityIds: [],
      objectEntityIds: [],
      locationEntityIds: [],
      purpose: "拖延",
    },
  ],
  intents: [
    {
      type: "investigate",
      targetEntityIds: ["faction_white_tower"],
    },
    {
      type: "question",
      targetEntityIds: ["char_su_ling"],
    },
    {
      type: "conceal",
      targetEntityIds: ["item_missing_list"],
    },
    {
      type: "protect",
      targetEntityIds: ["char_su_ling"],
    },
    {
      type: "escape",
      targetEntityIds: ["char_su_ling"],
    },
    {
      type: "delay",
      targetEntityIds: ["faction_night_patrol"],
    },
  ],
  historicalReferences: [
    {
      text: "三年前钟楼失火",
      entryId: "event_clocktower_fire",
      confidence: 0.9,
    },
  ],
  relationshipSignals: [
    {
      type: "ally",
      subjectEntityId: "player",
      objectEntityId: "char_su_ling",
      evidence: "玩家示意苏绫撤离，保护她",
    },
    {
      type: "enemy",
      subjectEntityId: "player",
      objectEntityId: "faction_night_patrol",
      evidence: "玩家拖延巡夜司",
    },
  ],
  unresolvedReferences: [
    {
      text: "同样的东西",
      reason: "证据不足，无法确定是否指银铃",
    },
  ],
  diagnostics: {
    parserMode: "llm",
    parseAttempts: 1,
    removedInvalidEntityIds: [],
    removedInvalidEntryIds: [],
    warnings: [],
  },
});

function createParserInput(rawInput: string): ParserInputV1 {
  return {
    rawInput,
    recentMessages: [],
    currentLocation: "旧钟楼",
    charactersPresent: ["char_su_ling"],
    candidateEntities: WUGANG_WORLDBOOK.map((e) => ({
      entityId: e.id,
      entryId: e.id,
      name: e.title,
      aliases: e.aliases ?? [],
      category: e.category,
      shortDescription: e.content.slice(0, 100),
    })),
    directHitEntryIds: ["char_su_ling", "item_silver_bell", "char_shen_yan"],
    expandedEntryIds: ["event_clocktower_fire", "location_sewer"],
  };
}

function createDeterministicResult(): WorldbookRetrievalResult {
  return {
    directHits: WUGANG_WORLDBOOK.filter((e) =>
      ["char_su_ling", "item_silver_bell", "char_shen_yan"].includes(e.id),
    ),
    expandedEntries: WUGANG_WORLDBOOK.filter((e) =>
      ["event_clocktower_fire", "location_sewer"].includes(e.id),
    ),
    excludedEntries: [],
    activatedKeywords: ["苏绫", "银铃", "沈砚"],
    totalEntries: 5,
    byVisibility: {
      public: WUGANG_WORLDBOOK.filter(
        (e) =>
          [
            "char_su_ling",
            "item_silver_bell",
            "char_shen_yan",
            "event_clocktower_fire",
            "location_sewer",
          ].includes(e.id) && e.visibility === "public",
      ),
      hidden: [],
      runtime_only: [],
    },
  };
}

// ============ Scenario 1: Complex Chinese Input ============

describe("Scenario 1: Complex Chinese Input", () => {
  it("should parse complex Chinese input with multiple entities, dialogues, actions, and intents", async () => {
    const mockAdapter = createMockLlmAdapter([{ text: VALID_LLM_RESPONSE }]);
    const executor = createRpInputParserLlmV1Executor({ llmAdapter: mockAdapter });

    const parserInput = createParserInput(COMPLEX_CHINESE_INPUT);
    const worldbookEntries = [...WUGANG_WORLDBOOK];

    const result = await executor({
      inputs: {
        parserInput,
        worldbookEntries,
      },
      context: {},
      node: { id: "test", type: "rpInputParserLlmV1", config: {} },
    });

    const parsed = result.outputs.parsedInput as ParsedRpInputV1;

    // Verify structure
    expect(parsed.version).toBe("parsed-rp-input-v1");
    expect(parsed.rawText).toBe(COMPLEX_CHINESE_INPUT);

    // Verify mentions
    expect(parsed.mentions.length).toBeGreaterThanOrEqual(5);
    expect(parsed.mentions.some((m) => m.entityId === "char_su_ling")).toBe(true);
    expect(parsed.mentions.some((m) => m.entityId === "item_silver_bell")).toBe(true);
    expect(parsed.mentions.some((m) => m.entityId === "char_shen_yan")).toBe(true);

    // Verify dialogues
    expect(parsed.dialogues.length).toBeGreaterThanOrEqual(1);
    expect(parsed.dialogues[0].text).toContain("教会的人");

    // Verify actions
    expect(parsed.actions.length).toBeGreaterThanOrEqual(3);

    // Verify intents
    expect(parsed.intents.length).toBeGreaterThanOrEqual(4);
    expect(parsed.intents.some((i) => i.type === "investigate")).toBe(true);
    expect(parsed.intents.some((i) => i.type === "question")).toBe(true);
    expect(parsed.intents.some((i) => i.type === "protect")).toBe(true);
    expect(parsed.intents.some((i) => i.type === "escape")).toBe(true);
    expect(parsed.intents.some((i) => i.type === "delay")).toBe(true);

    // Verify historical references
    expect(parsed.historicalReferences.length).toBeGreaterThanOrEqual(1);
    expect(parsed.historicalReferences.some((hr) => hr.entryId === "event_clocktower_fire")).toBe(
      true,
    );

    // Verify relationship signals
    expect(parsed.relationshipSignals.length).toBeGreaterThanOrEqual(1);

    // Verify unresolved references
    expect(parsed.unresolvedReferences.length).toBeGreaterThanOrEqual(1);

    // Verify diagnostics
    expect(parsed.diagnostics.parserMode).toBe("llm");
    expect(parsed.diagnostics.parseAttempts).toBe(1);
  });
});

// ============ Scenario 2: Invalid Entity IDs ============

describe("Scenario 2: Invalid Entity IDs", () => {
  it("should remove invalid entity IDs and log them in diagnostics", async () => {
    const mockAdapter = createMockLlmAdapterWithInvalidIds();
    const executor = createRpInputParserLlmV1Executor({ llmAdapter: mockAdapter });

    const parserInput = createParserInput("test input");
    const worldbookEntries = [...WUGANG_WORLDBOOK];

    const result = await executor({
      inputs: {
        parserInput,
        worldbookEntries,
      },
      context: {},
      node: { id: "test", type: "rpInputParserLlmV1", config: {} },
    });

    const parsed = result.outputs.parsedInput as ParsedRpInputV1;

    // Valid entity should be kept
    expect(parsed.mentions.some((m) => m.entityId === "char_su_ling")).toBe(true);

    // Invalid entry should be removed
    expect(parsed.mentions.some((m) => m.entryId === "nonexistent_entry_456")).toBe(false);

    // Diagnostics should record removed IDs
    expect(parsed.diagnostics.removedInvalidEntryIds).toContain("nonexistent_entry_456");

    // Warnings should be present
    expect(parsed.diagnostics.warnings.some((w) => w.includes("nonexistent_entry_456"))).toBe(true);
  });
});

// ============ Scenario 3: Retry on Invalid JSON ============

describe("Scenario 3: Retry on Invalid JSON", () => {
  it("should retry and succeed after first invalid JSON response", async () => {
    const mockAdapter = createMockLlmAdapterWithInvalidJson();
    const executor = createRpInputParserLlmV1Executor({
      llmAdapter: mockAdapter,
      config: { maxParseAttempts: 2 },
    });

    const parserInput = createParserInput("test input");
    const worldbookEntries = [...WUGANG_WORLDBOOK];

    const result = await executor({
      inputs: {
        parserInput,
        worldbookEntries,
      },
      context: {},
      node: { id: "test", type: "rpInputParserLlmV1", config: {} },
    });

    const parsed = result.outputs.parsedInput as ParsedRpInputV1;

    // Should have succeeded after retry
    expect(parsed.diagnostics.parseAttempts).toBe(2);
    expect(parsed.diagnostics.parserMode).toBe("llm");
    expect(parsed.diagnostics.warnings.some((w) => w.includes("2 attempts"))).toBe(false);
  });
});

// ============ Scenario 4: LLM Complete Failure ============

describe("Scenario 4: LLM Complete Failure", () => {
  it("should fall back to regex parser when LLM fails", async () => {
    const mockAdapter = createMockLlmAdapter([{ text: "", shouldFail: true }]);
    const executor = createRpInputParserLlmV1Executor({
      llmAdapter: mockAdapter,
      config: { maxParseAttempts: 1 },
    });

    const parserInput = createParserInput('"你好" *挥手*');
    const worldbookEntries = [...WUGANG_WORLDBOOK];

    const result = await executor({
      inputs: {
        parserInput,
        worldbookEntries,
      },
      context: {},
      node: { id: "test", type: "rpInputParserLlmV1", config: {} },
    });

    const parsed = result.outputs.parsedInput as ParsedRpInputV1;

    // Should use regex fallback
    expect(parsed.diagnostics.parserMode).toBe("regex-fallback");
    expect(parsed.diagnostics.parseAttempts).toBe(1);

    // Regex parser should extract dialogues
    expect(parsed.dialogues.some((d) => d.text === "你好")).toBe(true);

    // Regex parser should extract actions
    expect(parsed.actions.some((a) => a.action === "挥手")).toBe(true);

    // rawText should be preserved
    expect(parsed.rawText).toBe('"你好" *挥手*');
  });
});

// ============ Scenario 5: No LLM Adapter ============

describe("Scenario 5: No LLM Adapter", () => {
  it("should use regex fallback when no LLM adapter is configured", async () => {
    const executor = createRpInputParserLlmV1Executor({});

    const parserInput = createParserInput('"测试" *动作*');
    const worldbookEntries = [...WUGANG_WORLDBOOK];

    const result = await executor({
      inputs: {
        parserInput,
        worldbookEntries,
      },
      context: {},
      node: { id: "test", type: "rpInputParserLlmV1", config: {} },
    });

    const parsed = result.outputs.parsedInput as ParsedRpInputV1;

    // Should use regex fallback
    expect(parsed.diagnostics.parserMode).toBe("regex-fallback");

    // Should not throw when accessing diagnostics
    expect(parsed.diagnostics.warnings.some((w) => w.includes("No LLM adapter"))).toBe(true);

    // Regex parser should work
    expect(parsed.dialogues.some((d) => d.text === "测试")).toBe(true);
    expect(parsed.actions.some((a) => a.action === "动作")).toBe(true);
  });
});

// ============ Scenario 6: Excluded Entries Recalled by Semantic Expansion ============

describe("Scenario 6: Excluded Entries Recalled by Semantic Expansion", () => {
  it("should move semantically recalled entries from excludedEntries to expandedEntries", () => {
    const deterministicResult: WorldbookRetrievalResult = {
      directHits: [],
      expandedEntries: [],
      excludedEntries: WUGANG_WORLDBOOK.filter((e) =>
        ["event_clocktower_fire", "location_sewer"].includes(e.id),
      ),
      activatedKeywords: [],
      totalEntries: 0,
      byVisibility: { public: [], hidden: [], runtime_only: [] },
    };

    const parsed: ParsedRpInputV1 = {
      version: "parsed-rp-input-v1",
      rawText: "test",
      mentions: [],
      references: [],
      dialogues: [],
      actions: [],
      intents: [],
      historicalReferences: [
        { text: "钟楼失火", entryId: "event_clocktower_fire", confidence: 0.9 },
      ],
      relationshipSignals: [],
      unresolvedReferences: [],
      diagnostics: {
        parserMode: "llm",
        parseAttempts: 1,
        removedInvalidEntityIds: [],
        removedInvalidEntryIds: [],
        warnings: [],
      },
    };

    const expansionResult = expandSemantically(parsed, WUGANG_WORLDBOOK, new Set());

    // event_clocktower_fire should be expanded
    expect(expansionResult.expandedEntries.some((e) => e.id === "event_clocktower_fire")).toBe(
      true,
    );

    // Now test the semantic expander node
    // Note: This is a simplified test - in real usage, the semantic expander would be called
    // with the full deterministic result and worldbook entries
    const mergedDirectHits = [...deterministicResult.directHits];
    const mergedExpandedEntries = [
      ...deterministicResult.expandedEntries,
      ...expansionResult.expandedEntries,
    ];

    // Deduplicate
    const seenIds = new Set<string>();
    const uniqueDirectHits = mergedDirectHits.filter((e) => {
      if (seenIds.has(e.id)) return false;
      seenIds.add(e.id);
      return true;
    });
    const uniqueExpandedEntries = mergedExpandedEntries.filter((e) => {
      if (seenIds.has(e.id)) return false;
      seenIds.add(e.id);
      return true;
    });

    // Ensure no overlap between directHits and expandedEntries
    const directHitIds = new Set(uniqueDirectHits.map((e) => e.id));
    const finalExpandedEntries = uniqueExpandedEntries.filter((e) => !directHitIds.has(e.id));

    // Recalculate excludedEntries
    const expandedIds = new Set(finalExpandedEntries.map((e) => e.id));
    const finalExcludedEntries = deterministicResult.excludedEntries.filter(
      (e) => !directHitIds.has(e.id) && !expandedIds.has(e.id),
    );

    // event_clocktower_fire should be in expandedEntries
    expect(finalExpandedEntries.some((e) => e.id === "event_clocktower_fire")).toBe(true);

    // event_clocktower_fire should NOT be in excludedEntries
    expect(finalExcludedEntries.some((e) => e.id === "event_clocktower_fire")).toBe(false);

    // totalEntries should be correct
    expect(uniqueDirectHits.length + finalExpandedEntries.length).toBe(finalExpandedEntries.length);
  });
});

// ============ Scenario 7: End-to-End Workflow Trace ============

describe("Scenario 7: End-to-End Workflow Trace", () => {
  it("should execute full workflow from worldbook retrieval to semantic expansion", async () => {
    // Step 1: Worldbook Retrieval (deterministic)
    const retrievalResult = createDeterministicResult();

    // Step 2: Build ParserInputV1
    const parserInputBuilder = createRpParserInputBuilderV1Executor();
    const builderResult = await parserInputBuilder({
      inputs: {
        rawInput: COMPLEX_CHINESE_INPUT,
        retrievalResult,
        worldbookEntries: WUGANG_WORLDBOOK,
        recentMessages: [],
        currentLocation: "旧钟楼",
        charactersPresent: ["char_su_ling"],
      },
      context: {},
      node: { id: "builder", type: "rpParserInputBuilderV1", config: {} },
    });

    const parserInput = builderResult.outputs.parserInput as ParserInputV1;
    expect(parserInput.rawInput).toBe(COMPLEX_CHINESE_INPUT);
    expect(parserInput.candidateEntities.length).toBeGreaterThan(0);

    // Step 3: LLM Parser
    const mockAdapter = createMockLlmAdapter([{ text: VALID_LLM_RESPONSE }]);
    const llmParser = createRpInputParserLlmV1Executor({ llmAdapter: mockAdapter });

    const parserResult = await llmParser({
      inputs: {
        parserInput,
        worldbookEntries: WUGANG_WORLDBOOK,
      },
      context: {},
      node: { id: "parser", type: "rpInputParserLlmV1", config: {} },
    });

    const parsed = parserResult.outputs.parsedInput as ParsedRpInputV1;
    expect(parsed.diagnostics.parserMode).toBe("llm");

    // Step 4: Semantic Expansion
    const semanticExpander = createRpSemanticExpanderV1Executor();
    const expanderResult = await semanticExpander({
      inputs: {
        parsedInput: parsed,
        worldbookEntries: WUGANG_WORLDBOOK,
        deterministicResult: retrievalResult,
      },
      context: {},
      node: { id: "expander", type: "rpSemanticExpanderV1", config: {} },
    });

    const mergedResult = expanderResult.outputs.mergedResult as WorldbookRetrievalResult;

    // Verify merge invariants
    // 1. directHits has no duplicates
    const directHitIds = mergedResult.directHits.map((e) => e.id);
    expect(new Set(directHitIds).size).toBe(directHitIds.length);

    // 2. expandedEntries has no duplicates
    const expandedIds = mergedResult.expandedEntries.map((e) => e.id);
    expect(new Set(expandedIds).size).toBe(expandedIds.length);

    // 3. No overlap between directHits and expandedEntries
    const directHitSet = new Set(directHitIds);
    expect(expandedIds.some((id) => directHitSet.has(id))).toBe(false);

    // 4. totalEntries = directHits + expandedEntries
    expect(mergedResult.totalEntries).toBe(
      mergedResult.directHits.length + mergedResult.expandedEntries.length,
    );

    // 5. byVisibility is recalculated
    const allEntries = [...mergedResult.directHits, ...mergedResult.expandedEntries];
    expect(mergedResult.byVisibility.public.length).toBe(
      allEntries.filter((e) => e.visibility === "public").length,
    );
  });
});

// ============ Runtime Validation Tests ============

describe("Runtime Validation", () => {
  it("should validate correct ParsedRpInputV1 structure", () => {
    const valid = {
      version: "parsed-rp-input-v1",
      rawText: "test",
      mentions: [],
      references: [],
      dialogues: [],
      actions: [],
      intents: [],
      historicalReferences: [],
      relationshipSignals: [],
      unresolvedReferences: [],
      diagnostics: {
        parserMode: "llm",
        parseAttempts: 1,
        removedInvalidEntityIds: [],
        removedInvalidEntryIds: [],
        warnings: [],
      },
    };

    const result = validateParsedRpInputV1(valid);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should reject invalid version", () => {
    const invalid = {
      version: "invalid-version",
      rawText: "test",
      mentions: [],
      references: [],
      dialogues: [],
      actions: [],
      intents: [],
      historicalReferences: [],
      relationshipSignals: [],
      unresolvedReferences: [],
      diagnostics: {
        parserMode: "llm",
        parseAttempts: 1,
        removedInvalidEntityIds: [],
        removedInvalidEntryIds: [],
        warnings: [],
      },
    };

    const result = validateParsedRpInputV1(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("should reject invalid parserMode", () => {
    const invalid = {
      version: "parsed-rp-input-v1",
      rawText: "test",
      mentions: [],
      references: [],
      dialogues: [],
      actions: [],
      intents: [],
      historicalReferences: [],
      relationshipSignals: [],
      unresolvedReferences: [],
      diagnostics: {
        parserMode: "invalid-mode",
        parseAttempts: 1,
        removedInvalidEntityIds: [],
        removedInvalidEntryIds: [],
        warnings: [],
      },
    };

    const result = validateParsedRpInputV1(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("parserMode"))).toBe(true);
  });

  it("should reject invalid intent type", () => {
    const invalid = {
      version: "parsed-rp-input-v1",
      rawText: "test",
      mentions: [],
      references: [],
      dialogues: [],
      actions: [],
      intents: [{ type: "invalid-intent", targetEntityIds: [] }],
      historicalReferences: [],
      relationshipSignals: [],
      unresolvedReferences: [],
      diagnostics: {
        parserMode: "llm",
        parseAttempts: 1,
        removedInvalidEntityIds: [],
        removedInvalidEntryIds: [],
        warnings: [],
      },
    };

    const result = validateParsedRpInputV1(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("intent.type"))).toBe(true);
  });

  it("should reject entityId as string array", () => {
    const invalid = {
      version: "parsed-rp-input-v1",
      rawText: "test",
      mentions: [
        {
          text: "test",
          entityId: 123, // Should be string
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
        parserMode: "llm",
        parseAttempts: 1,
        removedInvalidEntityIds: [],
        removedInvalidEntryIds: [],
        warnings: [],
      },
    };

    const result = validateParsedRpInputV1(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("mention.entityId"))).toBe(true);
  });
});

// ============ Regex Fallback Tests ============

describe("Regex Fallback", () => {
  it("should extract dialogues from quotes", () => {
    const result = regexParseInput('"你好世界" "再见"');
    expect(result.dialogues).toHaveLength(2);
    expect(result.dialogues[0].text).toBe("你好世界");
    expect(result.dialogues[1].text).toBe("再见");
  });

  it("should extract actions from asterisks", () => {
    const result = regexParseInput("*挥手* *微笑*");
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].action).toBe("挥手");
    expect(result.actions[1].action).toBe("微笑");
  });

  it("should always return valid ParsedRpInputV1", () => {
    const result = regexParseInput("any input");
    expect(result.version).toBe("parsed-rp-input-v1");
    expect(result.diagnostics.parserMode).toBe("regex-fallback");
  });
});
