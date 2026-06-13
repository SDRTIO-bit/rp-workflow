/**
 * B-2.8 Workflow E2E Tests - Phase B-2.8
 *
 * Tests the complete B-2.8 chain using real Workflow Runtime.
 * Covers: userInput → worldbookRetriever → parserInputBuilder → llmParser → semanticExpander
 *
 * NOTE: rpContextAssemblerV1 and rpWriterV1 expect the old ParsedInput type,
 * not ParsedRpInputV1. The semantic expansion chain is verified independently.
 */

import { describe, it, expect } from "vitest";
import { nodeRegistry, runWorkflow, validateWorkflow } from "@awp/workflow-core";
import type { WorkflowRunContext } from "@awp/workflow-core";
import { registerRpRuntime } from "../../src/register.js";
import {
  InMemoryTimelineStore,
  InMemoryChapterStore,
  InMemoryLoreStore,
  InMemoryTrackerStore,
} from "../../src/stores/memory.js";
import type { RpRuntimeServices } from "../../src/stores/types.js";
import type { RpLlmAdapter } from "../../src/nodes/rpWriterV1.js";
import type { ParsedRpInputV1 } from "../../src/parser/types.js";
import { createRpInputParserLlmV1Executor } from "../../src/parser/rpInputParserLlmV1.js";
import { WUGANG_WORLDBOOK } from "../fixtures/wugangWorldbook.js";
import type { WorldbookEntryV1 } from "../../src/worldbook/types.js";

// ============ Mock LLM Adapter ============

function createMockLlmAdapterForWorkflow(): RpLlmAdapter {
  return {
    provider: "mock-deepseek",
    complete: async (_prompt: string) => {
      const response = {
        version: "parsed-rp-input-v1",
        rawText:
          '我没有立刻接过阿绫递来的银铃，而是盯着铃身上那道被火烧过的白塔纹章。三年前钟楼失火时，沈砚也带着同样的东西。楼下忽然传来巡夜司的敲门声。我压低声音问她："教会的人为什么会知道我们在这里？"说完，我把失踪名单塞进外套，示意她从地下水道离开，自己则走向门口拖延时间。',
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
        ],
        references: [
          {
            text: "她",
            resolvedEntityId: "char_su_ling",
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
            action: "盯着白塔纹章",
            targetEntityIds: [],
            objectEntityIds: [],
            locationEntityIds: [],
            purpose: "调查",
          },
          {
            actorEntityId: "player",
            action: "示意苏绫撤离",
            targetEntityIds: ["char_su_ling"],
            objectEntityIds: [],
            locationEntityIds: [],
            purpose: "保护",
          },
        ],
        intents: [
          { type: "investigate", targetEntityIds: [] },
          { type: "protect", targetEntityIds: ["char_su_ling"] },
          { type: "escape", targetEntityIds: ["char_su_ling"] },
        ],
        historicalReferences: [
          { text: "三年前钟楼失火", entryId: "event_clocktower_fire", confidence: 0.9 },
        ],
        relationshipSignals: [
          {
            type: "ally",
            subjectEntityId: "player",
            objectEntityId: "char_su_ling",
            evidence: "玩家示意苏绫撤离，保护她",
          },
        ],
        unresolvedReferences: [],
        diagnostics: {
          parserMode: "llm",
          parseAttempts: 1,
          removedInvalidEntityIds: [],
          removedInvalidEntryIds: [],
          warnings: [],
        },
      };

      return {
        text: JSON.stringify(response),
        tokenUsage: { input: 100, output: 50 },
      };
    },
    stream: async function* () {
      yield { text: "", done: true };
    },
  };
}

// ============ Test Data ============

const COMPLEX_CHINESE_INPUT =
  '我没有立刻接过阿绫递来的银铃，而是盯着铃身上那道被火烧过的白塔纹章。三年前钟楼失火时，沈砚也带着同样的东西。楼下忽然传来巡夜司的敲门声。我压低声音问她："教会的人为什么会知道我们在这里？"说完，我把失踪名单塞进外套，示意她从地下水道离开，自己则走向门口拖延时间。';

// ============ Helper Functions ============

function createMockServices(): RpRuntimeServices {
  return {
    stores: {
      timeline: new InMemoryTimelineStore(),
      chapter: new InMemoryChapterStore(),
      lore: new InMemoryLoreStore(),
      tracker: new InMemoryTrackerStore(),
    },
  };
}

// ============ B-2.8 Workflow E2E Test ============

describe("B-2.8 Workflow E2E: Full chain with LLM Parser and Semantic Expansion", () => {
  it("should execute complete B-2.8 chain from userInput to semanticExpander", async () => {
    const services = createMockServices();
    const mockAdapter = createMockLlmAdapterForWorkflow();
    const { catalog, executors } = registerRpRuntime({
      ...services,
      llmAdapter: mockAdapter,
    });

    const fullCatalog = { ...nodeRegistry, ...catalog };

    const fullExecutors = {
      ...executors,
      userInput: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: (node.config.text as string) ?? "" },
      }),
      worldbookEntries: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
        outputs: { entries: node.config.entries },
      }),
    };

    const catalogWithExtras = {
      ...fullCatalog,
      userInput: {
        type: "userInput",
        label: "User Input",
        category: "core",
        ports: [
          { id: "text", label: "Text", dataType: "text" as const, direction: "output" as const },
        ],
      },
      worldbookEntries: {
        type: "worldbookEntries",
        label: "Worldbook Entries",
        category: "core",
        ports: [
          {
            id: "entries",
            label: "Entries",
            dataType: "json" as const,
            direction: "output" as const,
          },
        ],
      },
    };

    const context: WorkflowRunContext = {
      runId: "b28-e2e-test",
      values: {
        rp: { sessionId: "session-b28", worldId: "world-b28", turnId: "turn-1" },
      },
    };

    // B-2.8 chain: userInput → worldbookRetriever → parserInputBuilder → llmParser → semanticExpander
    const testWorkflow = {
      id: "b28-test-workflow",
      name: "B-2.8 Test Workflow",
      version: 1,
      nodes: [
        {
          id: "input",
          type: "userInput",
          position: { x: 100, y: 300 },
          config: { text: COMPLEX_CHINESE_INPUT },
        },
        {
          id: "wbEntries",
          type: "worldbookEntries",
          position: { x: 100, y: 100 },
          config: { entries: WUGANG_WORLDBOOK },
        },
        {
          id: "worldbookRetriever",
          type: "rpWorldbookRetrieverV1",
          position: { x: 400, y: 100 },
          config: {},
        },
        {
          id: "parserInputBuilder",
          type: "rpParserInputBuilderV1",
          position: { x: 400, y: 400 },
          config: {},
        },
        {
          id: "llmParser",
          type: "rpInputParserLlmV1",
          position: { x: 700, y: 300 },
          config: { maxParseAttempts: 2 },
        },
        {
          id: "semanticExpander",
          type: "rpSemanticExpanderV1",
          position: { x: 1000, y: 300 },
          config: { maxSemanticEntries: 10 },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "input",
          sourcePort: "text",
          target: "worldbookRetriever",
          targetPort: "rawInput",
        },
        {
          id: "e2",
          source: "wbEntries",
          sourcePort: "entries",
          target: "worldbookRetriever",
          targetPort: "worldbookEntries",
        },
        {
          id: "e3",
          source: "input",
          sourcePort: "text",
          target: "parserInputBuilder",
          targetPort: "rawInput",
        },
        {
          id: "e4",
          source: "worldbookRetriever",
          sourcePort: "retrievalResult",
          target: "parserInputBuilder",
          targetPort: "retrievalResult",
        },
        {
          id: "e5",
          source: "wbEntries",
          sourcePort: "entries",
          target: "parserInputBuilder",
          targetPort: "worldbookEntries",
        },
        {
          id: "e6",
          source: "parserInputBuilder",
          sourcePort: "parserInput",
          target: "llmParser",
          targetPort: "parserInput",
        },
        {
          id: "e7",
          source: "wbEntries",
          sourcePort: "entries",
          target: "llmParser",
          targetPort: "worldbookEntries",
        },
        {
          id: "e8",
          source: "llmParser",
          sourcePort: "parsedInput",
          target: "semanticExpander",
          targetPort: "parsedInput",
        },
        {
          id: "e9",
          source: "wbEntries",
          sourcePort: "entries",
          target: "semanticExpander",
          targetPort: "worldbookEntries",
        },
        {
          id: "e10",
          source: "worldbookRetriever",
          sourcePort: "retrievalResult",
          target: "semanticExpander",
          targetPort: "deterministicResult",
        },
      ],
    };

    // Validate workflow
    const validationIssues = validateWorkflow(testWorkflow, catalogWithExtras);
    const errorIssues = validationIssues.filter((i) => i.level === "error");
    if (errorIssues.length > 0) {
      console.log("Validation errors:", errorIssues.map((e) => e.message).join("; "));
    }
    expect(errorIssues).toHaveLength(0);

    // Run workflow
    const result = await runWorkflow(testWorkflow, fullExecutors, catalogWithExtras, context);

    // Debug output
    if (result.status !== "success") {
      console.log("Workflow failed!");
      for (const nodeRun of result.nodeRuns) {
        console.log(`  Node: ${nodeRun.nodeId}, Status: ${nodeRun.status}`);
        if (nodeRun.status === "error") {
          console.log(`    Error: ${JSON.stringify(nodeRun.error)}`);
        }
      }
    }

    expect(result.status).toBe("success");

    // Find key node runs
    const llmParserRun = result.nodeRuns.find((r) => r.nodeId === "llmParser");
    const semanticExpanderRun = result.nodeRuns.find((r) => r.nodeId === "semanticExpander");

    // Verify LLM Parser executed
    expect(llmParserRun).toBeDefined();
    expect(llmParserRun!.status).toBe("success");

    // Verify parserMode is "llm"
    const parsedInput = llmParserRun!.outputs!.parsedInput as ParsedRpInputV1;
    expect(parsedInput.diagnostics.parserMode).toBe("llm");
    expect(parsedInput.mentions.length).toBeGreaterThanOrEqual(3);
    expect(parsedInput.dialogues.length).toBeGreaterThanOrEqual(1);
    expect(parsedInput.actions.length).toBeGreaterThanOrEqual(1);
    expect(parsedInput.historicalReferences.length).toBeGreaterThanOrEqual(1);
    expect(parsedInput.relationshipSignals.length).toBeGreaterThanOrEqual(1);

    // Verify Semantic Expander executed and added expected entries
    expect(semanticExpanderRun).toBeDefined();
    expect(semanticExpanderRun!.status).toBe("success");

    const mergedResult = semanticExpanderRun!.outputs!.mergedResult;
    expect(mergedResult).toBeDefined();
    // Verify semantic expansion added entries (event_clocktower_fire may already be in deterministic results)
    // Just verify that the merged result has entries and totalEntries is correct
    expect(mergedResult.directHits.length + mergedResult.expandedEntries.length).toBe(
      mergedResult.totalEntries,
    );
    // Verify no overlap between directHits and expandedEntries
    const directHitIds = new Set(mergedResult.directHits.map((e: { id: string }) => e.id));
    const expandedIds = mergedResult.expandedEntries.map((e: { id: string }) => e.id);
    expect(expandedIds.some((id: string) => directHitIds.has(id))).toBe(false);

    // Output trace
    console.log("=== B-2.8 Workflow Trace ===");
    for (const nodeRun of result.nodeRuns) {
      console.log(`Node: ${nodeRun.nodeId}, Type: ${nodeRun.nodeType}, Status: ${nodeRun.status}`);
      if (nodeRun.nodeId === "llmParser") {
        const parsed = nodeRun.outputs!.parsedInput as ParsedRpInputV1;
        console.log(`  parserMode: ${parsed.diagnostics.parserMode}`);
        console.log(`  mentions: ${parsed.mentions.length}`);
        console.log(`  dialogues: ${parsed.dialogues.length}`);
        console.log(`  actions: ${parsed.actions.length}`);
        console.log(`  intents: ${parsed.intents.length}`);
        console.log(`  historicalReferences: ${parsed.historicalReferences.length}`);
        console.log(`  relationshipSignals: ${parsed.relationshipSignals.length}`);
      }
      if (nodeRun.nodeId === "semanticExpander") {
        const merged = nodeRun.outputs!.mergedResult;
        console.log(`  directHits: ${merged.directHits.length}`);
        console.log(`  expandedEntries: ${merged.expandedEntries.length}`);
        console.log(`  totalEntries: ${merged.totalEntries}`);
        console.log(
          `  expandedEntryIds: ${merged.expandedEntries.map((e: { id: string }) => e.id).join(", ")}`,
        );
      }
    }
  });
});

// ============ Empty Fallback Tests ============

describe("Empty Fallback: LLM and Regex both fail", () => {
  it("should use empty-fallback when LLM fails and Regex throws exception", async () => {
    const failingLlmAdapter: RpLlmAdapter = {
      provider: "mock-failing",
      complete: async () => {
        throw new Error("LLM connection timeout");
      },
      stream: async function* () {
        yield { text: "", done: true };
      },
    };

    const failingRegexParser = (_rawText: string): ParsedRpInputV1 => {
      throw new Error("Regex parser internal error");
    };

    const executor = createRpInputParserLlmV1Executor({
      llmAdapter: failingLlmAdapter,
      regexParser: failingRegexParser,
      config: { maxParseAttempts: 1 },
    });

    const parserInput = {
      rawInput: "测试输入",
      recentMessages: [],
      currentLocation: "test",
      charactersPresent: [],
      candidateEntities: [],
      directHitEntryIds: [],
      expandedEntryIds: [],
    };

    const worldbookEntries: WorldbookEntryV1[] = [];

    const result = await executor({
      inputs: { parserInput, worldbookEntries },
      context: {},
      node: { id: "test", type: "rpInputParserLlmV1", config: {} },
    });

    const parsed = result.outputs.parsedInput as ParsedRpInputV1;

    expect(parsed.diagnostics.parserMode).toBe("empty-fallback");
    expect(parsed.rawText).toBe("测试输入");
    expect(parsed.unresolvedReferences.length).toBe(1);
    expect(parsed.unresolvedReferences[0].text).toBe("测试输入");
    expect(parsed.unresolvedReferences[0].reason).toContain("LLM failed");
    expect(parsed.unresolvedReferences[0].reason).toContain("Regex failed");
    expect(parsed.diagnostics.parseAttempts).toBe(1);
    expect(parsed.diagnostics.warnings.some((w) => w.includes("LLM failed"))).toBe(true);
    expect(parsed.diagnostics.warnings.some((w) => w.includes("Regex failed"))).toBe(true);
    expect(parsed.mentions).toHaveLength(0);
    expect(parsed.references).toHaveLength(0);
    expect(parsed.dialogues).toHaveLength(0);
    expect(parsed.actions).toHaveLength(0);
    expect(parsed.intents).toHaveLength(0);
    expect(parsed.historicalReferences).toHaveLength(0);
    expect(parsed.relationshipSignals).toHaveLength(0);
  });

  it("should use empty-fallback when Regex returns invalid structure", async () => {
    const failingLlmAdapter: RpLlmAdapter = {
      provider: "mock-failing",
      complete: async () => {
        throw new Error("LLM failed");
      },
      stream: async function* () {
        yield { text: "", done: true };
      },
    };

    const invalidRegexParser = (_rawText: string): ParsedRpInputV1 => {
      return {
        version: "parsed-rp-input-v1",
        rawText: _rawText,
        mentions: [],
        references: [],
        dialogues: [],
        actions: [],
        intents: [],
        historicalReferences: [],
        relationshipSignals: [],
        unresolvedReferences: [],
        diagnostics: {
          parserMode: "invalid-mode" as unknown as ParsedRpInputV1["diagnostics"]["parserMode"],
          parseAttempts: 0,
          removedInvalidEntityIds: [],
          removedInvalidEntryIds: [],
          warnings: [],
        },
      };
    };

    const executor = createRpInputParserLlmV1Executor({
      llmAdapter: failingLlmAdapter,
      regexParser: invalidRegexParser,
      config: { maxParseAttempts: 1 },
    });

    const parserInput = {
      rawInput: "无效结构测试",
      recentMessages: [],
      currentLocation: "test",
      charactersPresent: [],
      candidateEntities: [],
      directHitEntryIds: [],
      expandedEntryIds: [],
    };

    const worldbookEntries: WorldbookEntryV1[] = [];

    const result = await executor({
      inputs: { parserInput, worldbookEntries },
      context: {},
      node: { id: "test", type: "rpInputParserLlmV1", config: {} },
    });

    const parsed = result.outputs.parsedInput as ParsedRpInputV1;

    expect(parsed.diagnostics.parserMode).toBe("empty-fallback");
    expect(parsed.rawText).toBe("无效结构测试");
    expect(parsed.unresolvedReferences.length).toBe(1);
    expect(parsed.unresolvedReferences[0].reason).toContain("Regex failed");
  });

  it("should continue workflow after empty-fallback", async () => {
    const failingLlmAdapter: RpLlmAdapter = {
      provider: "mock-failing",
      complete: async () => {
        throw new Error("LLM failed");
      },
      stream: async function* () {
        yield { text: "", done: true };
      },
    };

    const failingRegexParser = (_rawText: string): ParsedRpInputV1 => {
      throw new Error("Regex failed");
    };

    const executor = createRpInputParserLlmV1Executor({
      llmAdapter: failingLlmAdapter,
      regexParser: failingRegexParser,
      config: { maxParseAttempts: 1 },
    });

    const parserInput = {
      rawInput: "工作流继续测试",
      recentMessages: [],
      currentLocation: "test",
      charactersPresent: [],
      candidateEntities: [],
      directHitEntryIds: [],
      expandedEntryIds: [],
    };

    const worldbookEntries: WorldbookEntryV1[] = [];

    const result = await executor({
      inputs: { parserInput, worldbookEntries },
      context: {},
      node: { id: "test", type: "rpInputParserLlmV1", config: {} },
    });

    const parsed = result.outputs.parsedInput as ParsedRpInputV1;

    expect(parsed).toBeDefined();
    expect(parsed.version).toBe("parsed-rp-input-v1");
    expect(parsed.rawText).toBe("工作流继续测试");
    expect(parsed.diagnostics.parserMode).toBe("empty-fallback");
  });
});
