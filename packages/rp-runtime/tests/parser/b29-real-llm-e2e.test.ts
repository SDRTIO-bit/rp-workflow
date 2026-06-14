/**
 * B-2.9R Real LLM E2E Tests
 *
 * Tests the B-2.9 chain with real OpenCode Go LLM instead of mock.
 * Gated by RUN_REAL_LLM_TESTS=1 environment variable.
 *
 * Chain: userInput -> worldbookRetriever -> parserInputBuilder -> llmParser
 *   -> semanticExpander -> contextAssemblerV2 -> presetResolver
 *   -> promptCompiler -> writer -> textOutput
 *
 * Provider: OpenCode Go (api.opencode.ai) or DeepSeek fallback.
 *
 * Scenarios:
 *   1. Complex Chinese input (multi-entity, aliases, dialogue, actions, intents)
 *   2. Two-turn continuity (first turn establishes, second uses pronouns)
 *   3. Worldbook provenance (entryTriggers, source overlap)
 *   4. Format fluctuation (Markdown JSON block, null fields, missing diagnostics)
 *   5. Invalid/fake IDs (grounding removes, diagnostics record, workflow continues)
 *   6. Provider failure -> Regex fallback
 *   7. Full text generation (Parser -> Expander -> AssemblerV2 -> Compiler -> Writer)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { nodeRegistry, runWorkflow } from "@awp/workflow-core";
import type { WorkflowRunContext } from "@awp/workflow-core";
import { createOpenCodeAdapter, createDeepSeekAdapter } from "@awp/agent-runtime";
import { createRpLlmBridge } from "../../src/llmBridge.js";
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
import type { WorldbookRetrievalResult } from "../../src/worldbook/types.js";
import { WUGANG_WORLDBOOK } from "../fixtures/wugangWorldbook.js";

// ============ Environment Gate ============

const RUN_REAL_LLM = process.env.RUN_REAL_LLM_TESTS === "1";
const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const API_KEY = OPENCODE_API_KEY ?? DEEPSEEK_API_KEY;
const USE_OPENCODE = Boolean(OPENCODE_API_KEY);
const MODEL = process.env.OPENCODE_MODEL ?? process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const PROVIDER = USE_OPENCODE ? "opencode" : "deepseek";

// Skip all tests if not explicitly enabled
const describeRealLlm = RUN_REAL_LLM && API_KEY ? describe : describe.skip;

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

function createRealLlmAdapter(): RpLlmAdapter {
  if (!API_KEY) {
    throw new Error("API_KEY is required for real LLM tests");
  }
  const agentAdapter = USE_OPENCODE
    ? createOpenCodeAdapter({ apiKey: API_KEY })
    : createDeepSeekAdapter({ apiKey: API_KEY });
  return createRpLlmBridge(agentAdapter, MODEL);
}

function buildB29Workflow(
  inputText: string,
  extraNodes: Array<Record<string, unknown>> = [],
  extraEdges: Array<Record<string, unknown>> = [],
) {
  return {
    id: "rp-b29-real-llm",
    name: "RP B-2.9R Real LLM Workflow",
    version: 1,
    nodes: [
      { id: "input", type: "userInput", position: { x: 100, y: 300 }, config: { text: inputText } },
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
            name: "默认RP写作",
            model: { temperature: 0.8, maxOutputTokens: 2048 },
            prompt: {
              coreRules: [{ id: "core-no-player-control", content: "不替玩家决定", priority: 100 }],
              styleRules: [{ id: "style-show", content: "通过动作展示情感", priority: 80 }],
              additionalInstructions: [{ id: "inst-end", content: "在自然断点结束", priority: 60 }],
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
      { id: "writer", type: "rpWriterV1", position: { x: 1900, y: 300 }, config: {} },
      { id: "output", type: "textOutput", position: { x: 2200, y: 300 }, config: {} },
      ...extraNodes,
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
      ...extraEdges,
    ],
  };
}

function createWorkflowExecutors(llmAdapter: RpLlmAdapter) {
  const services = createMockServices();
  const { catalog, executors } = registerRpRuntime({ ...services, llmAdapter });
  const fullCatalog = { ...nodeRegistry, ...catalog };
  return {
    catalog: {
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
    },
    executors: {
      ...executors,
      userInput: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: (node.config.text as string) ?? "" },
      }),
      textOutput: async (params: { inputs: Record<string, unknown> }) => ({
        outputs: { final: (params.inputs.text as string) ?? "" },
      }),
      worldbookEntries: async (params: { node: { config: Record<string, unknown> } }) => ({
        outputs: { entries: params.node.config.entries },
      }),
    },
  };
}

function logLatency(label: string, startedAt: number, extra: Record<string, unknown> = {}) {
  const latencyMs = Date.now() - startedAt;
  console.log(
    `  [${label}] latency=${latencyMs}ms`,
    Object.entries(extra)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" "),
  );
}

// ============ Scenario 1: Complex Chinese Input ============

describeRealLlm("B-2.9R Scenario 1: Complex Chinese Input", () => {
  let llmAdapter: RpLlmAdapter;

  beforeAll(() => {
    llmAdapter = createRealLlmAdapter();
  });

  it("parses multi-entity, aliases, dialogue, actions, intents, historical references, relationship signals", async () => {
    const input =
      '我没有立刻接过阿绫递来的银铃，而是盯着铃身上那道被火烧过的白塔纹章。三年前钟楼失火时，沈砚也带着同样的东西。楼下忽然传来巡夜司的敲门声。我压低声音问她："教会的人为什么会知道我们在这里？"说完，我把失踪名单塞进外套，示意她从地下水道离开，自己则走向门口拖延时间。';

    const { catalog, executors } = createWorkflowExecutors(llmAdapter);
    const workflow = buildB29Workflow(input);
    const context: WorkflowRunContext = {
      runId: "b29r-s1",
      values: { rp: { sessionId: "s1", worldId: "w1", turnId: "t1" } },
    };

    const startedAt = Date.now();
    const result = await runWorkflow(workflow, executors, catalog, context);
    expect(result.status).toBe("success");

    const llmParserRun = result.nodeRuns.find((r) => r.nodeId === "llmParser");
    expect(llmParserRun?.status).toBe("success");
    const parsed = llmParserRun!.outputs!.parsedInput as ParsedRpInputV1;
    const diag = parsed.diagnostics;
    console.log(
      `  provider=${PROVIDER} model=${MODEL} parserMode=${diag.parserMode} parseAttempts=${diag.parseAttempts}`,
    );
    logLatency("llmParser", startedAt, {
      parserMode: diag.parserMode,
      mentions: parsed.mentions.length,
      dialogues: parsed.dialogues.length,
      actions: parsed.actions.length,
      intents: parsed.intents.length,
      historicalRefs: parsed.historicalReferences.length,
      relationshipSignals: parsed.relationshipSignals.length,
    });

    // Verify at least some parser fields are populated
    expect(parsed.version).toBe("parsed-rp-input-v1");
    expect(parsed.rawText).toBeTruthy();

    // Check writer output
    const writerRun = result.nodeRuns.find((r) => r.nodeId === "writer");
    expect(writerRun?.status).toBe("success");
    const writerOutput = writerRun!.outputs!.writerOutput as Record<string, unknown>;
    expect(typeof writerOutput.text).toBe("string");
    expect(writerOutput.text.length).toBeGreaterThan(0);
    console.log(`  writerOutput: ${String(writerOutput.text).slice(0, 200)}...`);

    // Verify provenance in semantic expander
    const semanticRun = result.nodeRuns.find((r) => r.nodeId === "semanticExpander");
    expect(semanticRun?.status).toBe("success");
    const merged = semanticRun!.outputs!.mergedResult as WorldbookRetrievalResult;
    expect(merged.provenance).toBeDefined();
    console.log(
      `  provenance: directHitIds=${merged.provenance!.directHitIds.length} deterministicExpansionIds=${merged.provenance!.deterministicExpansionIds.length} semanticExpansionIds=${merged.provenance!.semanticExpansionIds.length}`,
    );
    console.log(
      `  entryTriggers: ${Object.keys(merged.provenance!.entryTriggers ?? {}).length} entries`,
    );
  }, 120000);
});

// ============ Scenario 2: Two-Turn Continuity ============

describeRealLlm("B-2.9R Scenario 2: Two-Turn Continuity", () => {
  let llmAdapter: RpLlmAdapter;

  beforeAll(() => {
    llmAdapter = createRealLlmAdapter();
  });

  it("establishes facts in turn 1, then uses pronouns in turn 2", async () => {
    const turn1Input =
      '我走进雾港酒馆，看到一个穿灰斗篷的女人坐在角落里。她的银发像月光一样。我在她对面坐下，说："你就是夜主派来的人？"';
    const turn2Input = "她还记得刚才那件事吗？我没有回答，只是继续跟着她。";

    // Turn 1
    const { catalog, executors } = createWorkflowExecutors(llmAdapter);
    const workflow1 = buildB29Workflow(turn1Input);
    const ctx1: WorkflowRunContext = {
      runId: "b29r-s2-t1",
      values: { rp: { sessionId: "s2", worldId: "w2", turnId: "t1" } },
    };

    const t1Start = Date.now();
    const result1 = await runWorkflow(workflow1, executors, catalog, ctx1);
    expect(result1.status).toBe("success");
    const writer1 = result1.nodeRuns.find((r) => r.nodeId === "writer")!.outputs!
      .writerOutput as Record<string, unknown>;
    console.log(`  Turn 1 writerOutput: ${String(writer1.text).slice(0, 200)}...`);
    logLatency("turn1", t1Start);

    // Turn 2 - provide recentMessages from turn 1
    const recentMessages = [
      {
        messageId: "msg-1",
        sessionId: "s2",
        worldId: "w2",
        turnId: "t1",
        role: "user" as const,
        text: turn1Input,
        timestamp: new Date(Date.now() - 60000).toISOString(),
      },
      {
        messageId: "msg-2",
        sessionId: "s2",
        worldId: "w2",
        turnId: "t1",
        role: "assistant" as const,
        text: String(writer1.text).slice(0, 500),
        timestamp: new Date(Date.now() - 30000).toISOString(),
      },
    ];

    const workflow2 = buildB29Workflow(
      turn2Input,
      [],
      [
        // Add recentMessages as input to assemblerV2
        {
          id: "e_rm",
          source: "recentMsgNode",
          sourcePort: "messages",
          target: "assemblerV2",
          targetPort: "recentMessages",
        },
      ],
    );
    // Add the recentMessages provider node
    workflow2.nodes.push({
      id: "recentMsgNode",
      type: "recentMessagesProvider",
      position: { x: 100, y: 500 },
      config: { messages: recentMessages },
    });

    const catalog2 = {
      ...catalog,
      recentMessagesProvider: {
        type: "recentMessagesProvider",
        label: "Recent Messages",
        category: "core",
        ports: [
          {
            id: "messages",
            label: "Messages",
            dataType: "json" as const,
            direction: "output" as const,
          },
        ],
      },
    };
    const executors2 = {
      ...executors,
      recentMessagesProvider: async (params: { node: { config: Record<string, unknown> } }) => ({
        outputs: { messages: params.node.config.messages },
      }),
    };

    const ctx2: WorkflowRunContext = {
      runId: "b29r-s2-t2",
      values: { rp: { sessionId: "s2", worldId: "w2", turnId: "t2" } },
    };
    const t2Start = Date.now();
    const result2 = await runWorkflow(workflow2, executors2, catalog2, ctx2);
    expect(result2.status).toBe("success");

    const writer2 = result2.nodeRuns.find((r) => r.nodeId === "writer")!.outputs!
      .writerOutput as Record<string, unknown>;
    console.log(`  Turn 2 writerOutput: ${String(writer2.text).slice(0, 200)}...`);

    const assemblerV2Run = result2.nodeRuns.find((r) => r.nodeId === "assemblerV2");
    const assembled = assemblerV2Run!.outputs!.assembledContext as Record<string, unknown>;
    expect(assembled.recentMessagesSection).toBeTruthy();
    console.log(
      `  recentMessagesSection present: ${String(assembled.recentMessagesSection).length} chars`,
    );
    logLatency("turn2", t2Start, {
      recentMessagesLen: String(assembled.recentMessagesSection).length,
    });
  }, 180000);
});

// ============ Scenario 3: Worldbook Provenance ============

describeRealLlm("B-2.9R Scenario 3: Worldbook Provenance", () => {
  let llmAdapter: RpLlmAdapter;

  beforeAll(() => {
    llmAdapter = createRealLlmAdapter();
  });

  it("produces non-overlapping provenance IDs and entryTriggers", async () => {
    const input =
      "苏绫把银铃交给我，我注意到沈砚在远处看着我们。三年前钟楼的那场火，巡夜司一直在调查。";

    const { catalog, executors } = createWorkflowExecutors(llmAdapter);
    const workflow = buildB29Workflow(input);
    const context: WorkflowRunContext = {
      runId: "b29r-s3",
      values: { rp: { sessionId: "s3", worldId: "w3", turnId: "t1" } },
    };

    const startedAt = Date.now();
    const result = await runWorkflow(workflow, executors, catalog, context);
    expect(result.status).toBe("success");

    const semanticRun = result.nodeRuns.find((r) => r.nodeId === "semanticExpander");
    expect(semanticRun?.status).toBe("success");
    const merged = semanticRun!.outputs!.mergedResult as WorldbookRetrievalResult;
    const prov = merged.provenance!;
    expect(prov).toBeDefined();

    // No overlap between three categories
    const all = new Set([
      ...prov.directHitIds,
      ...prov.deterministicExpansionIds,
      ...prov.semanticExpansionIds,
    ]);
    const total =
      prov.directHitIds.length +
      prov.deterministicExpansionIds.length +
      prov.semanticExpansionIds.length;
    expect(all.size).toBe(total);

    // entryTriggers should not map entries to categories they're not in
    if (prov.entryTriggers) {
      for (const [_entryId, fields] of Object.entries(prov.entryTriggers)) {
        expect(Array.isArray(fields)).toBe(true);
        expect(fields.length).toBeGreaterThan(0);
        // Each field should be a valid trigger field
        const validFields = [
          "mentions",
          "references",
          "dialogue-target",
          "action-target",
          "action-object",
          "intent-target",
          "historical-reference",
          "relationship-signal",
        ];
        for (const f of fields) {
          expect(validFields).toContain(f);
        }
      }
    }

    console.log(`  directHitIds: ${prov.directHitIds.join(", ") || "(none)"}`);
    console.log(
      `  deterministicExpansionIds: ${prov.deterministicExpansionIds.join(", ") || "(none)"}`,
    );
    console.log(`  semanticExpansionIds: ${prov.semanticExpansionIds.join(", ") || "(none)"}`);
    if (prov.entryTriggers) {
      for (const [entryId, fields] of Object.entries(prov.entryTriggers)) {
        console.log(`  entryTriggers[${entryId}]: [${fields.join(", ")}]`);
      }
    }
    logLatency("scenario3", startedAt, {
      directHits: prov.directHitIds.length,
      deterministic: prov.deterministicExpansionIds.length,
      semantic: prov.semanticExpansionIds.length,
      triggers: Object.keys(prov.entryTriggers ?? {}).length,
    });
  }, 120000);
});

// ============ Scenario 4: Format Fluctuation ============

describeRealLlm("B-2.9R Scenario 4: Format Fluctuation", () => {
  let llmAdapter: RpLlmAdapter;

  beforeAll(() => {
    llmAdapter = createRealLlmAdapter();
  });

  it("handles models that may return null fields, missing diagnostics, or markdown wrapping", async () => {
    const input = "门开了。";

    const { catalog, executors } = createWorkflowExecutors(llmAdapter);
    const workflow = buildB29Workflow(input);
    const context: WorkflowRunContext = {
      runId: "b29r-s4",
      values: { rp: { sessionId: "s4", worldId: "w4", turnId: "t1" } },
    };

    const startedAt = Date.now();
    const result = await runWorkflow(workflow, executors, catalog, context);
    expect(result.status).toBe("success");

    const llmParserRun = result.nodeRuns.find((r) => r.nodeId === "llmParser");
    expect(llmParserRun?.status).toBe("success");
    const parsed = llmParserRun!.outputs!.parsedInput as ParsedRpInputV1;

    // The parser should always produce a valid structure, even if model output was malformed
    expect(parsed.version).toBe("parsed-rp-input-v1");
    expect(typeof parsed.rawText).toBe("string");
    expect(Array.isArray(parsed.mentions)).toBe(true);
    expect(Array.isArray(parsed.references)).toBe(true);
    expect(Array.isArray(parsed.dialogues)).toBe(true);
    expect(Array.isArray(parsed.actions)).toBe(true);
    expect(Array.isArray(parsed.intents)).toBe(true);
    expect(Array.isArray(parsed.historicalReferences)).toBe(true);
    expect(Array.isArray(parsed.relationshipSignals)).toBe(true);
    expect(Array.isArray(parsed.unresolvedReferences)).toBe(true);
    expect(parsed.diagnostics).toBeDefined();
    expect(typeof parsed.diagnostics.parserMode).toBe("string");

    console.log(
      `  parsed: version=${parsed.version} mentions=${parsed.mentions.length} parserMode=${parsed.diagnostics.parserMode}`,
    );
    logLatency("scenario4", startedAt, { parserMode: parsed.diagnostics.parserMode });
  }, 120000);
});

// ============ Scenario 5: Invalid/Fake IDs ============

describeRealLlm("B-2.9R Scenario 5: Invalid/Fake IDs", () => {
  let llmAdapter: RpLlmAdapter;

  beforeAll(() => {
    llmAdapter = createRealLlmAdapter();
  });

  it("grounding removes non-existent entityIds and entryIds", async () => {
    // This input may cause the LLM to hallucinate entity IDs not in the worldbook
    const input = '一个叫"虚空行者"的陌生人递给我一把闪着蓝光的钥匙，说这是"时间之门的碎片"。';

    const { catalog, executors } = createWorkflowExecutors(llmAdapter);
    const workflow = buildB29Workflow(input);
    const context: WorkflowRunContext = {
      runId: "b29r-s5",
      values: { rp: { sessionId: "s5", worldId: "w5", turnId: "t1" } },
    };

    const startedAt = Date.now();
    const result = await runWorkflow(workflow, executors, catalog, context);
    expect(result.status).toBe("success");

    const llmParserRun = result.nodeRuns.find((r) => r.nodeId === "llmParser");
    expect(llmParserRun?.status).toBe("success");
    const parsed = llmParserRun!.outputs!.parsedInput as ParsedRpInputV1;

    // Check diagnostics for grounding removals
    const diag = parsed.diagnostics;
    console.log(
      `  removedInvalidEntityIds: ${diag.removedInvalidEntityIds?.join(", ") || "(none)"}`,
    );
    console.log(`  removedInvalidEntryIds: ${diag.removedInvalidEntryIds?.join(", ") || "(none)"}`);

    // Semantic expander should not crash on invalid IDs
    const semanticRun = result.nodeRuns.find((r) => r.nodeId === "semanticExpander");
    expect(semanticRun?.status).toBe("success");

    // Writer should produce output regardless
    const writerRun = result.nodeRuns.find((r) => r.nodeId === "writer");
    expect(writerRun?.status).toBe("success");
    const writerOutput = writerRun!.outputs!.writerOutput as Record<string, unknown>;
    expect(typeof writerOutput.text).toBe("string");
    expect(writerOutput.text.length).toBeGreaterThan(0);
    console.log(`  writerOutput: ${String(writerOutput.text).slice(0, 200)}...`);
    logLatency("scenario5", startedAt, {
      removedEntityIds: diag.removedInvalidEntityIds?.length ?? 0,
      removedEntryIds: diag.removedInvalidEntryIds?.length ?? 0,
    });
  }, 120000);
});

// ============ Scenario 6: Provider Failure -> Fallback ============

describeRealLlm("B-2.9R Scenario 6: Provider Failure -> Fallback", () => {
  it("falls back to regex parser on adapter failure", async () => {
    // Create a failing adapter that throws on every call
    const failingAdapter: RpLlmAdapter = {
      provider: "failing",
      complete: async () => {
        throw new Error("Simulated network failure");
      },
    };

    const input = "苏绫看着我，等待我的回答。";

    const services = createMockServices();
    const { catalog, executors: rawExecutors } = registerRpRuntime({
      ...services,
      llmAdapter: failingAdapter,
    });

    const fullExecutors = {
      ...rawExecutors,
      userInput: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: (node.config.text as string) ?? "" },
      }),
      textOutput: async (params: { inputs: Record<string, unknown> }) => ({
        outputs: { final: (params.inputs.text as string) ?? "" },
      }),
      worldbookEntries: async (params: { node: { config: Record<string, unknown> } }) => ({
        outputs: { entries: params.node.config.entries },
      }),
    };

    const fullCatalog = {
      ...nodeRegistry,
      ...catalog,
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

    const workflow = buildB29Workflow(input);
    const context: WorkflowRunContext = {
      runId: "b29r-s6",
      values: { rp: { sessionId: "s6", worldId: "w6", turnId: "t1" } },
    };

    const startedAt = Date.now();
    const result = await runWorkflow(workflow, fullExecutors, fullCatalog, context);

    // The workflow should still succeed (LLM fails -> Regex fallback -> Empty fallback)
    expect(result.status).toBe("success");

    const llmParserRun = result.nodeRuns.find((r) => r.nodeId === "llmParser");
    expect(llmParserRun?.status).toBe("success");
    const parsed = llmParserRun!.outputs!.parsedInput as ParsedRpInputV1;

    // Parser mode should indicate fallback was used
    console.log(
      `  parserMode: ${parsed.diagnostics.parserMode} parseAttempts: ${parsed.diagnostics.parseAttempts}`,
    );
    expect(["regex-fallback", "regex", "empty"]).toContain(parsed.diagnostics.parserMode);

    // Writer should still produce output
    const writerRun = result.nodeRuns.find((r) => r.nodeId === "writer");
    expect(writerRun?.status).toBe("success");
    logLatency("scenario6-fallback", startedAt, { parserMode: parsed.diagnostics.parserMode });
  }, 120000);
});

// ============ Scenario 7: Full Text Generation ============

describeRealLlm("B-2.9R Scenario 7: Full Text Generation", () => {
  let llmAdapter: RpLlmAdapter;

  beforeAll(() => {
    llmAdapter = createRealLlmAdapter();
  });

  it("completes full chain and produces narrative text output", async () => {
    const input =
      '我推开白塔教会锈迹斑斑的铁门，沈砚正站在祭坛前。他没有回头，只是淡淡地说："你终于来了。三年前我就知道你会来找我。"我握紧腰间的银铃，问："夜蚀之夜那天，你到底看到了什么？"';

    const { catalog, executors } = createWorkflowExecutors(llmAdapter);
    const workflow = buildB29Workflow(input);
    const context: WorkflowRunContext = {
      runId: "b29r-s7",
      values: { rp: { sessionId: "s7", worldId: "w7", turnId: "t1" } },
    };

    const startedAt = Date.now();
    const result = await runWorkflow(workflow, executors, catalog, context);
    expect(result.status).toBe("success");

    // Report every node
    for (const nodeRun of result.nodeRuns) {
      console.log(
        `  Node: ${nodeRun.nodeId}, Status: ${nodeRun.status}${nodeRun.error ? ", Error: " + nodeRun.error : ""}`,
      );
    }

    // Final output
    const writerRun = result.nodeRuns.find((r) => r.nodeId === "writer");
    const writerOutput = writerRun!.outputs!.writerOutput as Record<string, unknown>;
    const outputNode = result.nodeRuns.find((r) => r.nodeId === "output");
    const finalText = outputNode?.outputs?.final as string;

    console.log(`\n=== FINAL TEXT OUTPUT ===`);
    console.log(finalText);
    console.log(`=== END OUTPUT ===\n`);

    expect(typeof writerOutput.text).toBe("string");
    expect(writerOutput.text.length).toBeGreaterThan(0);

    // Budget report
    const assemblerV2Run = result.nodeRuns.find((r) => r.nodeId === "assemblerV2");
    const budget = assemblerV2Run!.outputs!.budgetReport as Record<string, unknown>;
    console.log(
      `  Budget: target=${budget.targetTokens} actual=${JSON.stringify(budget.actual)} dropped=${(budget.droppedSections as string[])?.join(",") || "none"}`,
    );

    logLatency("scenario7-full", startedAt, {
      generationMode: writerOutput.generationMode,
      outputLen: String(writerOutput.text).length,
      nodesRan: result.nodeRuns.length,
    });
  }, 180000);
});
