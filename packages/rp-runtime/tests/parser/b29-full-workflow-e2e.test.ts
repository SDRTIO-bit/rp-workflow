/**
 * B-2.9 Full Workflow E2E Tests
 *
 * Tests the B-2.9 chain using the real Workflow Runtime:
 *   userInput -> worldbookRetriever -> parserInputBuilder -> llmParser
 *   -> semanticExpander -> contextAssemblerV2 -> promptCompiler
 *   -> writer -> textOutput
 *
 * Uses Mock LLM adapter (deterministic JSON response), not a real network call.
 * Asserts the assembler V2 receives both new ports and produces
 * a fully-typed AssembledContextV2 + PromptDocument.
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
import { WUGANG_WORLDBOOK } from "../fixtures/wugangWorldbook.js";

// ============ Mock LLM Adapter ============

function createMockLlmAdapterForB29(): RpLlmAdapter {
  return {
    provider: "mock-deepseek-b29",
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

// ============ Helpers ============

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

const COMPLEX_CHINESE_INPUT =
  '我没有立刻接过阿绫递来的银铃，而是盯着铃身上那道被火烧过的白塔纹章。三年前钟楼失火时，沈砚也带着同样的东西。楼下忽然传来巡夜司的敲门声。我压低声音问她："教会的人为什么会知道我们在这里？"说完，我把失踪名单塞进外套，示意她从地下水道离开，自己则走向门口拖延时间。';

// ============ Tests ============

describe("B-2.9 Workflow E2E: Full chain with V2 assembler", () => {
  it("runs userInput -> worldbookRetriever -> parserInputBuilder -> llmParser -> semanticExpander -> contextAssemblerV2 -> promptCompiler -> writer -> textOutput", async () => {
    const services = createMockServices();
    const mockAdapter = createMockLlmAdapterForB29();
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
      textOutput: async (params: { inputs: Record<string, unknown> }) => ({
        outputs: { final: (params.inputs.text as string) ?? "" },
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
      textOutput: {
        type: "textOutput",
        label: "Text Output",
        category: "core",
        ports: [
          { id: "text", label: "Text", dataType: "draft" as const, direction: "input" as const },
          { id: "final", label: "Final", dataType: "text" as const, direction: "output" as const },
        ],
      },
    };

    // Build the workflow graph inline (mirrors the JSON file)
    const workflow = {
      id: "rp-b29-semantic-context-v1",
      name: "RP B-2.9 Semantic Context Workflow",
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
        {
          id: "assemblerV2",
          type: "rpContextAssemblerV2",
          position: { x: 1300, y: 300 },
          config: {},
        },
        {
          id: "presetResolver",
          type: "rpPresetResolverV1",
          position: { x: 1600, y: 150 },
          config: {
            preset: {
              version: "rp-preset-v1",
              id: "rp-default-v1",
              name: "默认 RP 写作",
              model: { temperature: 0.8, maxOutputTokens: 2048 },
              prompt: {
                coreRules: [
                  { id: "core-no-player-control", content: "不替玩家决定", priority: 100 },
                ],
                styleRules: [{ id: "style-show", content: "通过动作展示情感", priority: 80 }],
                additionalInstructions: [
                  { id: "inst-end", content: "在自然断点结束", priority: 60 },
                ],
              },
              outputContract: {
                version: "output-contract-v1",
                mode: "narrative_only",
                slots: [{ id: "narrative", required: true, order: 10, producer: "writer" }],
                allowExtraText: false,
              },
            },
          },
        },
        {
          id: "promptCompiler",
          type: "rpPromptCompilerV1",
          position: { x: 1600, y: 300 },
          config: {},
        },
        {
          id: "writer",
          type: "rpWriterV1",
          position: { x: 1900, y: 300 },
          config: {},
        },
        {
          id: "output",
          type: "textOutput",
          position: { x: 2200, y: 300 },
          config: {},
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
          source: "input",
          sourcePort: "text",
          target: "parserInputBuilder",
          targetPort: "rawInput",
        },
        {
          id: "e3",
          source: "worldbookRetriever",
          sourcePort: "retrievalResult",
          target: "parserInputBuilder",
          targetPort: "retrievalResult",
        },
        {
          id: "e4",
          source: "worldbookRetriever",
          sourcePort: "retrievalResult",
          target: "semanticExpander",
          targetPort: "deterministicResult",
        },
        {
          id: "e5",
          source: "parserInputBuilder",
          sourcePort: "parserInput",
          target: "llmParser",
          targetPort: "parserInput",
        },
        {
          id: "e6",
          source: "llmParser",
          sourcePort: "parsedInput",
          target: "semanticExpander",
          targetPort: "parsedInput",
        },
        {
          id: "e7",
          source: "llmParser",
          sourcePort: "parsedInput",
          target: "assemblerV2",
          targetPort: "parsedRpInput",
        },
        {
          id: "e8",
          source: "semanticExpander",
          sourcePort: "mergedResult",
          target: "assemblerV2",
          targetPort: "worldbookRetrieval",
        },
        {
          id: "e9",
          source: "assemblerV2",
          sourcePort: "promptDocument",
          target: "promptCompiler",
          targetPort: "promptDocument",
        },
        {
          id: "e10",
          source: "presetResolver",
          sourcePort: "resolvedPreset",
          target: "promptCompiler",
          targetPort: "resolvedPreset",
        },
        {
          id: "e11",
          source: "promptCompiler",
          sourcePort: "compiledPrompt",
          target: "writer",
          targetPort: "compiledPrompt",
        },
        {
          id: "e12",
          source: "writer",
          sourcePort: "narrative",
          target: "output",
          targetPort: "text",
        },
      ],
    };

    // worldbookEntries is a fixture-only test node (not in registered catalog)
    const catalogWithWb = {
      ...catalogWithExtras,
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
    const executorsWithWb = {
      ...fullExecutors,
      worldbookEntries: async (params: { node: { config: Record<string, unknown> } }) => ({
        outputs: { entries: params.node.config.entries },
      }),
    };
    // Wire the wbEntries into the workflow
    workflow.edges.push(
      {
        id: "e_wb_1",
        source: "wbEntries",
        sourcePort: "entries",
        target: "worldbookRetriever",
        targetPort: "worldbookEntries",
      },
      {
        id: "e_wb_2",
        source: "wbEntries",
        sourcePort: "entries",
        target: "parserInputBuilder",
        targetPort: "worldbookEntries",
      },
      {
        id: "e_wb_3",
        source: "wbEntries",
        sourcePort: "entries",
        target: "llmParser",
        targetPort: "worldbookEntries",
      },
      {
        id: "e_wb_4",
        source: "wbEntries",
        sourcePort: "entries",
        target: "semanticExpander",
        targetPort: "worldbookEntries",
      },
    );

    const context: WorkflowRunContext = {
      runId: "b29-e2e",
      values: { rp: { sessionId: "session-b29", worldId: "world-b29", turnId: "turn-1" } },
    };

    // Validate
    const validationIssues = validateWorkflow(workflow, catalogWithWb);
    const errorIssues = validationIssues.filter((i) => i.level === "error");
    if (errorIssues.length > 0) {
      console.log("Validation errors:", errorIssues.map((e) => e.message).join("; "));
    }
    expect(errorIssues).toHaveLength(0);

    // Run
    const result = await runWorkflow(workflow, executorsWithWb, catalogWithWb, context);
    if (result.status !== "success") {
      for (const nodeRun of result.nodeRuns) {
        if (nodeRun.status === "error") {
          console.log(`  ${nodeRun.nodeId}: ${JSON.stringify(nodeRun.error)}`);
        }
      }
    }
    expect(result.status).toBe("success");

    // Check key nodes ran
    const llmParserRun = result.nodeRuns.find((r) => r.nodeId === "llmParser");
    const semanticExpanderRun = result.nodeRuns.find((r) => r.nodeId === "semanticExpander");
    const assemblerV2Run = result.nodeRuns.find((r) => r.nodeId === "assemblerV2");
    const writerRun = result.nodeRuns.find((r) => r.nodeId === "writer");

    expect(llmParserRun).toBeDefined();
    expect(llmParserRun!.status).toBe("success");

    expect(semanticExpanderRun).toBeDefined();
    expect(semanticExpanderRun!.status).toBe("success");

    expect(assemblerV2Run).toBeDefined();
    expect(assemblerV2Run!.status).toBe("success");

    expect(writerRun).toBeDefined();
    expect(writerRun!.status).toBe("success");

    // Verify V2 assembler output shape
    const assembled = assemblerV2Run!.outputs!.assembledContext as Record<string, unknown>;
    expect(assembled.version).toBe("assembled-context-v2");
    expect(assembled.mentionsSection).toContain("阿绫");
    expect(assembled.dialoguesSection).toContain("教会的人为什么会知道我们在这里");
    expect(assembled.actionsSection).toContain("示意苏绫撤离");
    expect(assembled.historicalReferencesSection).toContain("event_clocktower_fire");
    expect(assembled.relationshipSignalsSection).toContain("ally");
    expect(assembled.parserFieldsCovered).toEqual(
      expect.arrayContaining([
        "mentions",
        "dialogues",
        "actions",
        "intents",
        "historicalReferences",
        "relationshipSignals",
      ]),
    );

    // Verify provenance in semanticExpander output
    const merged = semanticExpanderRun!.outputs!.mergedResult as Record<string, unknown>;
    const provenance = merged.provenance as Record<string, string[]>;
    expect(provenance).toBeDefined();
    expect(Array.isArray(provenance.directHitIds)).toBe(true);
    expect(Array.isArray(provenance.deterministicExpansionIds)).toBe(true);
    expect(Array.isArray(provenance.semanticExpansionIds)).toBe(true);
    // Sanity: no overlap between the three categories
    const all = new Set([
      ...provenance.directHitIds,
      ...provenance.deterministicExpansionIds,
      ...provenance.semanticExpansionIds,
    ]);
    const total =
      provenance.directHitIds.length +
      provenance.deterministicExpansionIds.length +
      provenance.semanticExpansionIds.length;
    expect(all.size).toBe(total); // no duplicates across categories

    // Verify V2 PromptDocument includes lore with retrievalSource
    const promptDoc = assemblerV2Run!.outputs!.promptDocument as {
      sections: Array<Record<string, unknown>>;
    };
    const loreWithRetrieval = promptDoc.sections.filter(
      (s) => (s.provenance as Record<string, unknown> | undefined)?.retrievalSource,
    );
    // We expect at least one directHit, possibly some deterministic/semantic
    expect(loreWithRetrieval.length).toBeGreaterThan(0);
    for (const section of loreWithRetrieval) {
      const prov = section.provenance as Record<string, unknown>;
      expect(["directHit", "deterministicExpansion", "semanticExpansion"]).toContain(
        prov.retrievalSource,
      );
    }

    // Writer output is a string
    const writerOutput = writerRun!.outputs!.writerOutput as Record<string, unknown>;
    expect(typeof writerOutput.text).toBe("string");
    expect(["llm", "mock", "echo_fallback"]).toContain(writerOutput.generationMode as string);
  });
});
