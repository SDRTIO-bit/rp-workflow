/**
 * B-2.9 Formal Workflow JSON E2E
 *
 * Tests that the formal Workflow JSON file is the sole graph definition source:
 *   1. Read JSON from file
 *   2. Parse as WorkflowDefinition
 *   3. Bind resources via resourceRef
 *   4. validateWorkflow
 *   5. runWorkflow
 *   6. Complete trace
 *   7. textOutput
 *
 * This test does NOT construct any graph programmatically.
 * All nodes, edges, and resourceRefs come from the JSON file.
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  nodeRegistry,
  runWorkflow,
  validateWorkflow,
  createStaticResourceResolver,
  createResourceSourceExecutor,
} from "@awp/workflow-core";
import type { WorkflowDefinition, WorkflowRunContext } from "@awp/workflow-core";
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

// ============ Mock LLM ============

function createMockLlmAdapter(): RpLlmAdapter {
  return {
    provider: "mock-b29-json",
    complete: async (_prompt: string) => {
      const response = {
        version: "parsed-rp-input-v1",
        rawText:
          "\u6211\u6ca1\u6709\u7acb\u523b\u63a5\u8fc7\u963f\u7eeb\u9012\u6765\u7684\u94f6\u94c3\uff0c\u800c\u662f\u76ef\u7740\u94c3\u8eab\u4e0a\u90a3\u9053\u88ab\u706b\u70e7\u8fc7\u7684\u767d\u5854\u7eb9\u7ae0\u3002",
        mentions: [
          {
            text: "\u963f\u7eeb",
            entityId: "char_su_ling",
            entryId: "char_su_ling",
            category: "character",
            confidence: 0.95,
            evidence: "\u522b\u540d\u5339\u914d",
          },
          {
            text: "\u6c88\u781a",
            entityId: "char_shen_yan",
            entryId: "char_shen_yan",
            category: "character",
            confidence: 0.95,
            evidence: "\u89d2\u8272\u540d\u79f0\u5339\u914d",
          },
          {
            text: "\u94f6\u94c3",
            entityId: "item_silver_bell",
            entryId: "item_silver_bell",
            category: "item",
            confidence: 0.9,
            evidence: "\u9053\u5177\u540d\u79f0\u5339\u914d",
          },
          {
            text: "\u5de1\u591c\u53f8",
            entityId: "faction_night_patrol",
            entryId: "faction_night_patrol",
            category: "faction",
            confidence: 0.9,
            evidence: "\u52bf\u529b\u540d\u79f0\u5339\u914d",
          },
        ],
        references: [
          {
            text: "\u5979",
            resolvedEntityId: "char_su_ling",
            resolutionSource: "current_input",
            confidence: 0.95,
          },
        ],
        dialogues: [
          {
            speakerEntityId: "player",
            targetEntityIds: ["char_su_ling"],
            text: "\u6559\u4f1a\u7684\u4eba\u4e3a\u4ec0\u4e48\u4f1a\u77e5\u9053\u6211\u4eec\u5728\u8fd9\u91cc\uff1f",
            toneHints: ["\u538b\u4f4e\u58f0\u97f3", "\u7d27\u5f20"],
          },
        ],
        actions: [
          {
            actorEntityId: "player",
            action: "\u76ef\u7740\u767d\u5854\u7eb9\u7ae0",
            targetEntityIds: [],
            objectEntityIds: [],
            locationEntityIds: [],
            purpose: "\u8c03\u67e5",
          },
          {
            actorEntityId: "player",
            action: "\u793a\u610f\u82cf\u7eeb\u64a4\u79bb",
            targetEntityIds: ["char_su_ling"],
            objectEntityIds: [],
            locationEntityIds: [],
            purpose: "\u4fdd\u62a4",
          },
        ],
        intents: [
          { type: "investigate", targetEntityIds: [] },
          { type: "protect", targetEntityIds: ["char_su_ling"] },
          { type: "escape", targetEntityIds: ["char_su_ling"] },
        ],
        historicalReferences: [
          {
            text: "\u4e09\u5e74\u524d\u949f\u697c\u5931\u706b",
            entryId: "event_clocktower_fire",
            confidence: 0.9,
          },
        ],
        relationshipSignals: [
          {
            type: "ally",
            subjectEntityId: "player",
            objectEntityId: "char_su_ling",
            evidence: "\u73a9\u5bb6\u793a\u610f\u82cf\u7eeb\u64a4\u79bb\uff0c\u4fdd\u62a4\u5979",
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

// ============ Test ============

describe("B-2.9 Formal Workflow JSON E2E", () => {
  it("loads JSON from file, binds resources, validates, runs, and produces textOutput", async () => {
    // 1. Read JSON from file
    const jsonPath = resolve(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "data",
      "workflows",
      "rp-b29-semantic-context-workflow-v1.json",
    );
    const raw = await readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      kind: string;
      version: number;
      workflow: WorkflowDefinition;
      resources?: Record<string, unknown>;
    };

    // Verify container format
    expect(parsed.kind).toBe("agent-workflow-platform.workflow");
    const workflow = parsed.workflow;
    expect(workflow.id).toBe("rp-b29-semantic-context-v1");
    expect(workflow.nodes.length).toBeGreaterThanOrEqual(10);
    expect(workflow.edges.length).toBeGreaterThanOrEqual(12);

    // 2. Verify graph structure from JSON
    const nodeTypes = workflow.nodes.map((n) => n.type);
    expect(nodeTypes).toContain("userInput");
    expect(nodeTypes).toContain("resourceSource");
    expect(nodeTypes).toContain("rpWorldbookRetrieverV1");
    expect(nodeTypes).toContain("rpParserInputBuilderV1");
    expect(nodeTypes).toContain("rpInputParserLlmV1");
    expect(nodeTypes).toContain("rpSemanticExpanderV1");
    expect(nodeTypes).toContain("rpContextAssemblerV2");
    expect(nodeTypes).toContain("rpPresetResolverV1");
    expect(nodeTypes).toContain("rpPromptCompilerV1");
    expect(nodeTypes).toContain("rpWriterV1");
    expect(nodeTypes).toContain("textOutput");

    // Verify resourceSource has resourceRef
    const worldbookSource = workflow.nodes.find((n) => n.id === "worldbookSource");
    expect(worldbookSource).toBeDefined();
    expect(worldbookSource!.config.resourceRef).toBe("worldbook:b29-test-world");

    // Verify edges include resourceSource connections
    const wbEdges = workflow.edges.filter((e) => e.source === "worldbookSource");
    expect(wbEdges.length).toBe(4); // to retriever, parserInputBuilder, llmParser, semanticExpander

    // Verify schemaId on critical ports
    const semanticExpanderNode = workflow.nodes.find((n) => n.id === "semanticExpander");
    expect(semanticExpanderNode).toBeDefined();
    const assemblerV2Node = workflow.nodes.find((n) => n.id === "assemblerV2");
    expect(assemblerV2Node).toBeDefined();
    // SchemaIds are on the node definitions in catalog, not in the JSON itself
    // (JSON only stores node type+config; schemaIds come from catalog)

    // 3. Register RP Runtime + Mock LLM
    const services = createMockServices();
    const mockAdapter = createMockLlmAdapter();
    const { catalog: rpCatalog, executors: rpExecutors } = registerRpRuntime({
      ...services,
      llmAdapter: mockAdapter,
    });

    // 4. Build resource bindings
    const resourceResolver = createStaticResourceResolver({
      "worldbook:b29-test-world": WUGANG_WORLDBOOK,
    });
    const resourceSourceExecutor = createResourceSourceExecutor(resourceResolver);

    // 5. Merge catalogs and executors
    const fullCatalog = { ...nodeRegistry, ...rpCatalog };
    const fullExecutors = {
      ...rpExecutors,
      resourceSource: resourceSourceExecutor,
      userInput: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: (node.config.text as string) ?? "" },
      }),
      textOutput: async (params: { inputs: Record<string, unknown> }) => ({
        outputs: { final: (params.inputs.text as string) ?? "" },
      }),
    };

    // 6. Validate
    const validationIssues = validateWorkflow(workflow, fullCatalog);
    const errorIssues = validationIssues.filter((i) => i.level === "error");
    if (errorIssues.length > 0) {
      console.log("Validation errors:", errorIssues.map((e) => e.message).join("; "));
    }
    expect(errorIssues).toHaveLength(0);

    // 7. Run
    const context: WorkflowRunContext = {
      runId: "b29-json-e2e",
      values: { rp: { sessionId: "json-s1", worldId: "json-w1", turnId: "t1" } },
    };
    const result = await runWorkflow(workflow, fullExecutors, fullCatalog, context);

    // 8. Verify
    expect(result.status).toBe("success");

    // Full trace
    console.log("=== Formal JSON Workflow Trace ===");
    for (const nodeRun of result.nodeRuns) {
      console.log(
        `  Node: ${nodeRun.nodeId}, Type: ${workflow.nodes.find((n) => n.id === nodeRun.nodeId)?.type ?? "?"}, Status: ${nodeRun.status}`,
      );
    }

    // Check key nodes
    const worldbookRetriever = result.nodeRuns.find((r) => r.nodeId === "worldbookRetriever");
    expect(worldbookRetriever?.status).toBe("success");

    const llmParserRun = result.nodeRuns.find((r) => r.nodeId === "llmParser");
    expect(llmParserRun?.status).toBe("success");

    const semanticExpanderRun = result.nodeRuns.find((r) => r.nodeId === "semanticExpander");
    expect(semanticExpanderRun?.status).toBe("success");

    const assemblerV2Run = result.nodeRuns.find((r) => r.nodeId === "assemblerV2");
    expect(assemblerV2Run?.status).toBe("success");

    const writerRun = result.nodeRuns.find((r) => r.nodeId === "writer");
    expect(writerRun?.status).toBe("success");

    // Verify V2 assembler output shape
    const assembled = assemblerV2Run!.outputs!.assembledContext as Record<string, unknown>;
    expect(assembled.version).toBe("assembled-context-v2");
    expect(assembled.mentionsSection).toContain("char_su_ling");
    expect(assembled.dialoguesSection).toContain("\u6559\u4f1a\u7684\u4eba\u4e3a\u4ec0\u4e48");

    // Verify provenance in semanticExpander output
    const merged = semanticExpanderRun!.outputs!.mergedResult as Record<string, unknown>;
    const provenance = merged.provenance as Record<string, string[]>;
    expect(provenance).toBeDefined();
    expect(Array.isArray(provenance.directHitIds)).toBe(true);
    expect(Array.isArray(provenance.deterministicExpansionIds)).toBe(true);
    expect(Array.isArray(provenance.semanticExpansionIds)).toBe(true);

    // Verify no overlap between provenance categories
    const all = new Set([
      ...provenance.directHitIds,
      ...provenance.deterministicExpansionIds,
      ...provenance.semanticExpansionIds,
    ]);
    const total =
      provenance.directHitIds.length +
      provenance.deterministicExpansionIds.length +
      provenance.semanticExpansionIds.length;
    expect(all.size).toBe(total);

    // textOutput
    const outputRun = result.nodeRuns.find((r) => r.nodeId === "output");
    expect(outputRun?.status).toBe("success");
    const finalText = outputRun!.outputs!.final as string;
    expect(finalText.length).toBeGreaterThan(0);
    console.log(`\n=== FINAL OUTPUT (first 200 chars) ===`);
    console.log(finalText.slice(0, 200));
    console.log(`=== END ===\n`);
  });
});
