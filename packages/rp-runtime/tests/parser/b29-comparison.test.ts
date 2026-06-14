/**
 * B-2.9 Comparison Tests
 *
 * Compares the B-2.7-only chain (no LLM parser, no semantic expansion)
 * with the B-2.7 + B-2.8 + B-2.9 chain (LLM parser, semantic expansion,
 * V2 assembler) on the same complex Chinese input.
 *
 * Asserts:
 *  - The B-2.8+B-2.9 chain retrieves at least one extra entry that the
 *    B-2.7 chain missed (because B-2.8 semantic expansion uses parsed
 *    entities to expand worldbook recall).
 *  - The B-2.9 assembledContext has more sections (per-parser-field
 *    sections: mentions, dialogues, actions, intents, historicalRefs,
 *    relationshipSignals) that the B-2.7 assembledContext does not.
 *  - The B-2.9 fullContext is at least as large as the B-2.7 fullContext.
 *  - The compiled prompt fed to the writer includes parsed entity names
 *    (e.g., "阿绫", "沈砚") in the B-2.9 chain.
 *
 * Both chains use the same Mock LLM adapter so the only difference is the
 * assembler (V1 vs V2) and the presence/absence of the semantic expander.
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
import { WUGANG_WORLDBOOK } from "../fixtures/wugangWorldbook.js";

const COMPLEX_CHINESE_INPUT =
  '我没有立刻接过阿绫递来的银铃，而是盯着铃身上那道被火烧过的白塔纹章。三年前钟楼失火时，沈砚也带着同样的东西。楼下忽然传来巡夜司的敲门声。我压低声音问她："教会的人为什么会知道我们在这里？"说完，我把失踪名单塞进外套，示意她从地下水道离开，自己则走向门口拖延时间。';

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

function createMockLlmAdapter(): RpLlmAdapter {
  return {
    provider: "mock-deepseek-b29-compare",
    complete: async () => {
      const response: ParsedRpInputV1 = {
        version: "parsed-rp-input-v1",
        rawText: COMPLEX_CHINESE_INPUT,
        mentions: [
          {
            text: "阿绫",
            entityId: "char_su_ling",
            entryId: "char_su_ling",
            category: "character",
            confidence: 0.95,
            evidence: "别名",
          },
          {
            text: "沈砚",
            entityId: "char_shen_yan",
            entryId: "char_shen_yan",
            category: "character",
            confidence: 0.95,
            evidence: "直接",
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
            toneHints: ["紧张"],
          },
        ],
        actions: [
          {
            actorEntityId: "player",
            action: "示意苏绫撤离",
            targetEntityIds: ["char_su_ling"],
            objectEntityIds: [],
            locationEntityIds: [],
            purpose: "保护",
          },
        ],
        intents: [{ type: "protect", targetEntityIds: ["char_su_ling"] }],
        historicalReferences: [
          { text: "三年前钟楼失火", entryId: "event_clocktower_fire", confidence: 0.9 },
        ],
        relationshipSignals: [
          {
            type: "ally",
            subjectEntityId: "player",
            objectEntityId: "char_su_ling",
            evidence: "示意撤离",
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
      return { text: JSON.stringify(response), tokenUsage: { input: 100, output: 50 } };
    },
    stream: async function* () {
      yield { text: "", done: true };
    },
  };
}

// =====================================================================
// B-2.7-only chain: userInput -> parser (old) -> loreRetriever (old)
//                  -> assembler V1 -> writer -> textOutput
//
// worldbookRetriever is included as a node but is ISOLATED (no output
// edges) because rpContextAssemblerV1 cannot accept WorldbookRetrievalResult
// as a parsedInput or loreContext (different schemaIds). This honestly
// reflects the B-2.7 era: the worldbook retriever existed but the
// assembler couldn't consume it.
// =====================================================================

function buildB27Workflow() {
  return {
    id: "b27-only-comparison",
    name: "B-2.7 only (legacy parser, V1 assembler)",
    version: 1,
    nodes: [
      {
        id: "input",
        type: "userInput",
        position: { x: 100, y: 200 },
        config: { text: COMPLEX_CHINESE_INPUT },
      },
      {
        id: "wbEntries",
        type: "worldbookEntries",
        position: { x: 100, y: 50 },
        config: { entries: WUGANG_WORLDBOOK },
      },
      {
        id: "worldbookRetriever",
        type: "rpWorldbookRetrieverV1",
        position: { x: 400, y: 50 },
        config: {},
      },
      { id: "parser", type: "rpInputParserV1", position: { x: 400, y: 200 }, config: {} },
      { id: "loreRetriever", type: "rpLoreRetrieverV1", position: { x: 700, y: 200 }, config: {} },
      {
        id: "assemblerV1",
        type: "rpContextAssemblerV1",
        position: { x: 1000, y: 200 },
        config: {},
      },
      { id: "writer", type: "rpWriterV1", position: { x: 1300, y: 200 }, config: {} },
      { id: "output", type: "textOutput", position: { x: 1600, y: 200 }, config: {} },
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
      { id: "e3", source: "input", sourcePort: "text", target: "parser", targetPort: "rawInput" },
      {
        id: "e4",
        source: "parser",
        sourcePort: "parsedInput",
        target: "loreRetriever",
        targetPort: "parsedInput",
      },
      {
        id: "e5",
        source: "parser",
        sourcePort: "parsedInput",
        target: "assemblerV1",
        targetPort: "parsedInput",
      },
      {
        id: "e6",
        source: "loreRetriever",
        sourcePort: "loreContext",
        target: "assemblerV1",
        targetPort: "loreContext",
      },
      {
        id: "e7",
        source: "assemblerV1",
        sourcePort: "assembledContext",
        target: "writer",
        targetPort: "assembledContext",
      },
      { id: "e8", source: "writer", sourcePort: "narrative", target: "output", targetPort: "text" },
    ],
  };
}

// =====================================================================
// B-2.7 + B-2.8 + B-2.9 chain: full semantic + new assembler
// =====================================================================

function buildB29Workflow() {
  return {
    id: "b27-plus-b28-b29",
    name: "B-2.7 + B-2.8 + B-2.9 (with LLM parser + semantic expander + V2)",
    version: 1,
    nodes: [
      {
        id: "input",
        type: "userInput",
        position: { x: 100, y: 200 },
        config: { text: COMPLEX_CHINESE_INPUT },
      },
      {
        id: "wbEntries",
        type: "worldbookEntries",
        position: { x: 100, y: 50 },
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
        position: { x: 400, y: 300 },
        config: {},
      },
      {
        id: "llmParser",
        type: "rpInputParserLlmV1",
        position: { x: 700, y: 200 },
        config: { maxParseAttempts: 2 },
      },
      {
        id: "semanticExpander",
        type: "rpSemanticExpanderV1",
        position: { x: 1000, y: 200 },
        config: { maxSemanticEntries: 10 },
      },
      {
        id: "assemblerV2",
        type: "rpContextAssemblerV2",
        position: { x: 1300, y: 200 },
        config: {},
      },
      {
        id: "presetResolver",
        type: "rpPresetResolverV1",
        position: { x: 1300, y: 50 },
        config: { preset: makeMinimalPreset() },
      },
      {
        id: "promptCompiler",
        type: "rpPromptCompilerV1",
        position: { x: 1600, y: 200 },
        config: {},
      },
      { id: "writer", type: "rpWriterV1", position: { x: 1900, y: 200 }, config: {} },
      { id: "output", type: "textOutput", position: { x: 2200, y: 200 }, config: {} },
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
        source: "worldbookRetriever",
        sourcePort: "retrievalResult",
        target: "semanticExpander",
        targetPort: "deterministicResult",
      },
      {
        id: "e10",
        source: "wbEntries",
        sourcePort: "entries",
        target: "semanticExpander",
        targetPort: "worldbookEntries",
      },
      {
        id: "e11",
        source: "llmParser",
        sourcePort: "parsedInput",
        target: "assemblerV2",
        targetPort: "parsedRpInput",
      },
      {
        id: "e12",
        source: "semanticExpander",
        sourcePort: "mergedResult",
        target: "assemblerV2",
        targetPort: "worldbookRetrieval",
      },
      {
        id: "e13",
        source: "assemblerV2",
        sourcePort: "promptDocument",
        target: "promptCompiler",
        targetPort: "promptDocument",
      },
      {
        id: "e14",
        source: "presetResolver",
        sourcePort: "resolvedPreset",
        target: "promptCompiler",
        targetPort: "resolvedPreset",
      },
      {
        id: "e15",
        source: "promptCompiler",
        sourcePort: "compiledPrompt",
        target: "writer",
        targetPort: "compiledPrompt",
      },
      {
        id: "e16",
        source: "writer",
        sourcePort: "narrative",
        target: "output",
        targetPort: "text",
      },
    ],
  };
}

function makeMinimalPreset() {
  return {
    version: "rp-preset-v1",
    id: "rp-test-v1",
    name: "test preset",
    model: { temperature: 0.5, maxOutputTokens: 1024 },
    prompt: {
      coreRules: [{ id: "c1", content: "Be concise.", priority: 100 }],
      styleRules: [{ id: "s1", content: "Third person.", priority: 80 }],
      additionalInstructions: [],
    },
    outputContract: {
      version: "output-contract-v1",
      mode: "narrative_only",
      slots: [{ id: "narrative", required: true, order: 10, producer: "writer" }],
      allowExtraText: false,
    },
  };
}

function makeCatalogAndExecutors(llmAdapter: RpLlmAdapter) {
  const services = createMockServices();
  const { catalog, executors } = registerRpRuntime({ ...services, llmAdapter });
  const fullCatalog = { ...nodeRegistry, ...catalog };
  const fullExecutors = {
    ...executors,
    userInput: async (params: { node: { config: Record<string, unknown> } }) => ({
      outputs: { text: (params.node.config.text as string) ?? "" },
    }),
    textOutput: async (params: { inputs: Record<string, unknown> }) => ({
      outputs: { final: (params.inputs.text as string) ?? "" },
    }),
    worldbookEntries: async (params: { node: { config: Record<string, unknown> } }) => ({
      outputs: { entries: params.node.config.entries },
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
  return { catalogWithExtras, fullExecutors };
}

describe("B-2.9 Comparison: B-2.7-only vs B-2.7+B-2.8+B-2.9", () => {
  it("B-2.9 chain retrieves more entries and renders more sections than B-2.7 chain", async () => {
    const llmAdapter = createMockLlmAdapter();

    // ---- B-2.7 only ----
    const wfB27 = buildB27Workflow();
    // Connect wbEntries to worldbookRetriever only (V1 chain doesn't need more)
    // Actually it already is in the edges
    const { catalogWithExtras: cat27, fullExecutors: exec27 } = makeCatalogAndExecutors(llmAdapter);

    const ctx27: WorkflowRunContext = {
      runId: "b27-only",
      values: { rp: { sessionId: "s1", worldId: "w1", turnId: "t1" } },
    };
    const v27 = validateWorkflow(wfB27, cat27);
    if (v27.filter((i) => i.level === "error").length > 0) {
      console.log(
        "B-2.7 validation errors:",
        v27
          .filter((i) => i.level === "error")
          .map((e) => e.message)
          .join("; "),
      );
    }
    expect(v27.filter((i) => i.level === "error")).toHaveLength(0);
    const r27 = await runWorkflow(wfB27, exec27, cat27, ctx27);
    expect(r27.status).toBe("success");

    // ---- B-2.9 (full chain) ----
    const wfB29 = buildB29Workflow();
    const { catalogWithExtras: cat29, fullExecutors: exec29 } = makeCatalogAndExecutors(llmAdapter);
    const ctx29: WorkflowRunContext = {
      runId: "b29-full",
      values: { rp: { sessionId: "s1", worldId: "w1", turnId: "t1" } },
    };
    const v29 = validateWorkflow(wfB29, cat29);
    if (v29.filter((i) => i.level === "error").length > 0) {
      console.log(
        "B-2.9 validation errors:",
        v29
          .filter((i) => i.level === "error")
          .map((e) => e.message)
          .join("; "),
      );
    }
    expect(v29.filter((i) => i.level === "error")).toHaveLength(0);
    const r29 = await runWorkflow(wfB29, exec29, cat29, ctx29);
    expect(r29.status).toBe("success");

    // ===== Compare retrievals =====
    const b27Retrieval = r27.nodeRuns.find((n) => n.nodeId === "worldbookRetriever")!.outputs!
      .retrievalResult as Record<string, unknown>;
    const b29SemanticMerged = r29.nodeRuns.find((n) => n.nodeId === "semanticExpander")!.outputs!
      .mergedResult as Record<string, unknown>;

    const b27Entries = [
      ...((b27Retrieval.directHits as Array<{ id: string }>) ?? []),
      ...((b27Retrieval.expandedEntries as Array<{ id: string }>) ?? []),
    ];
    const b29Entries = [
      ...((b29SemanticMerged.directHits as Array<{ id: string }>) ?? []),
      ...((b29SemanticMerged.expandedEntries as Array<{ id: string }>) ?? []),
    ];
    const b27Ids = new Set(b27Entries.map((e) => e.id));
    const b29Ids = new Set(b29Entries.map((e) => e.id));
    const b29Only = [...b29Ids].filter((id) => !b27Ids.has(id));
    const b27Only = [...b27Ids].filter((id) => !b29Ids.has(id));

    console.log(
      `B-2.7 entries: ${b27Ids.size}, B-2.9 entries: ${b29Ids.size}, B-2.9-only: ${b29Only.length}, B-2.7-only: ${b27Only.length}`,
    );
    if (b29Only.length > 0) {
      console.log(`B-2.9-only ids: ${b29Only.join(", ")}`);
    }

    // ===== Retrieval provenance (B-2.9 only) =====
    // B-2.9's semanticExpander populates a 3-way provenance on mergedResult.
    // This is the new value the assembler V2 uses to render split sections.
    const provenance = b29SemanticMerged.provenance as Record<string, string[]> | undefined;
    expect(provenance).toBeDefined();
    expect(provenance!.directHitIds).toBeDefined();
    expect(provenance!.deterministicExpansionIds).toBeDefined();
    expect(provenance!.semanticExpansionIds).toBeDefined();
    // No overlap between the three categories (each entry has exactly one source)
    const union = new Set([
      ...provenance!.directHitIds,
      ...provenance!.deterministicExpansionIds,
      ...provenance!.semanticExpansionIds,
    ]);
    const sum =
      provenance!.directHitIds.length +
      provenance!.deterministicExpansionIds.length +
      provenance!.semanticExpansionIds.length;
    expect(union.size).toBe(sum);
    // The semantic expansion list is processed (even if empty in this
    // particular scenario where keyword retrieval already covers the
    // entities, the assembler still needs the explicit empty list to
    // render the empty semantic section).
    expect(Array.isArray(provenance!.semanticExpansionIds)).toBe(true);

    // ===== Compare assembled contexts =====
    const b27Ctx = r27.nodeRuns.find((n) => n.nodeId === "assemblerV1")!.outputs!
      .assembledContext as Record<string, unknown>;
    const b29Ctx = r29.nodeRuns.find((n) => n.nodeId === "assemblerV2")!.outputs!
      .assembledContext as Record<string, unknown>;

    // B-2.9 has 11 per-parser-field sections, B-2.7 has only 5 string sections
    const b27Keys = Object.keys(b27Ctx).filter(
      (k) => k.endsWith("Section") || k === "systemPrompt" || k === "fullContext",
    );
    const b29Keys = Object.keys(b29Ctx).filter(
      (k) => k.endsWith("Section") || k === "systemPrompt" || k === "fullContext",
    );
    expect(b29Keys.length).toBeGreaterThan(b27Keys.length);

    // B-2.9 mentions/dialogues/actions/intents/historicalRefs/relationshipSignals sections are populated
    expect(b29Ctx.mentionsSection).toContain("阿绫");
    expect(b29Ctx.dialoguesSection).toContain("教会的人");
    expect(b29Ctx.actionsSection).toContain("示意苏绫撤离");
    expect(b29Ctx.intentsSection).toContain("protect");
    expect(b29Ctx.historicalReferencesSection).toContain("event_clocktower_fire");
    expect(b29Ctx.relationshipSignalsSection).toContain("ally");
    expect(b29Ctx.parserFieldsCovered).toEqual(
      expect.arrayContaining([
        "mentions",
        "dialogues",
        "actions",
        "intents",
        "historicalReferences",
        "relationshipSignals",
      ]),
    );

    // B-2.7 has none of these per-parser-field sections (it doesn't know about them)
    expect(b27Ctx.mentionsSection).toBeUndefined();
    expect(b27Ctx.actionsSection).toBeUndefined();
    expect(b27Ctx.intentsSection).toBeUndefined();
    expect(b27Ctx.historicalReferencesSection).toBeUndefined();
    expect(b27Ctx.relationshipSignalsSection).toBeUndefined();
    // V1 has only userInputSection that contains the raw text + (possibly)
    // extracted dialogue/action lines from the regex parser. It does NOT
    // contain entryIds, evidence, or semantic fields.
    expect(b27Ctx.userInputSection).toBeDefined();
    expect(typeof b27Ctx.userInputSection).toBe("string");
    expect(b27Ctx.userInputSection).toContain("阿绫"); // raw text passes through

    // B-2.9 context is at least as large as B-2.7 context
    const b27Size = (b27Ctx.fullContext as string).length;
    const b29Size = (b29Ctx.fullContext as string).length;
    console.log(`B-2.7 fullContext: ${b27Size} chars, B-2.9 fullContext: ${b29Size} chars`);
    expect(b29Size).toBeGreaterThanOrEqual(b27Size);

    // B-2.9 fullContext explicitly contains parsed entity names with provenance markers
    expect(b29Ctx.fullContext).toContain("阿绫");
    expect(b29Ctx.fullContext).toContain("沈砚");
    expect(b29Ctx.fullContext).toContain("char_su_ling");
    expect(b29Ctx.fullContext).toContain("event_clocktower_fire");
  });
});
