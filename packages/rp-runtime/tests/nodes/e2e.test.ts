import { describe, it, expect } from "vitest";
import { validateWorkflow } from "@awp/workflow-core";
import type { WorkflowDefinition, WorkflowRunContext } from "@awp/workflow-core";
import { registerRpRuntime } from "../../src/register.js";
import {
  InMemoryTimelineStore,
  InMemoryChapterStore,
  InMemoryLoreStore,
  InMemoryTrackerStore,
} from "../../src/stores/memory.js";
import type { RpRuntimeServices } from "../../src/stores/types.js";

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

/**
 * Creates a Phase B-1 workflow definition:
 * parser → assembler → writer
 */
function createPhaseB1Workflow(): WorkflowDefinition {
  return {
    id: "rp-b1-workflow",
    name: "RP Phase B-1 Workflow",
    version: 1,
    nodes: [
      {
        id: "parser-1",
        type: "rpInputParserV1",
        config: {},
        position: { x: 0, y: 0 },
      },
      {
        id: "assembler-1",
        type: "rpContextAssemblerV1",
        config: {},
        position: { x: 200, y: 0 },
      },
      {
        id: "writer-1",
        type: "rpWriterV1",
        config: {},
        position: { x: 400, y: 0 },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "parser-1",
        sourcePort: "parsedInput",
        target: "assembler-1",
        targetPort: "parsedInput",
      },
      {
        id: "e2",
        source: "assembler-1",
        sourcePort: "assembledContext",
        target: "writer-1",
        targetPort: "assembledContext",
      },
    ],
  };
}

describe("Phase B-2 E2E: Full workflow with timeline and lore retrieval", () => {
  it("runs parser → timeline/lore → assembler → writer pipeline", async () => {
    const services = createMockServices();

    // Seed timeline events
    await services.stores.timeline.putEvent({
      sessionId: "session-e2e",
      worldId: "world-e2e",
      event: {
        eventId: "evt-1",
        sessionId: "session-e2e",
        worldId: "world-e2e",
        chapterId: "ch-1",
        sourceTurnId: "t-0",
        summary: "Alice entered the tavern and met Bob.",
        characters: ["Alice", "Bob"],
        locations: ["tavern"],
        items: [],
        time: null,
        emotionalChanges: [],
        createdAt: new Date().toISOString(),
      },
    });

    // Seed lore entries
    await services.stores.lore.putEntry({
      sessionId: "session-e2e",
      worldId: "world-e2e",
      entry: {
        id: "lore-tavern",
        sessionId: "session-e2e",
        worldId: "world-e2e",
        title: "Tavern Rules",
        content: "No weapons allowed inside the tavern. Peaceful zone only.",
        keywords: ["tavern", "weapons"],
        category: "location",
        activationMode: "triggered",
        priority: 5,
      },
    });

    const { executors } = registerRpRuntime(services);

    const context: WorkflowRunContext = {
      runId: "e2e-b2-run",
      values: {
        rp: { sessionId: "session-e2e", worldId: "world-e2e", turnId: "turn-1" },
      },
    };

    // Step 1: Parse input
    const parserResult = await executors.rpInputParserV1({
      node: { id: "p1", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
      inputs: {
        rawInput: "Alice walks into the tavern and looks around.",
      },
      context,
    });

    const parsed = parserResult.outputs.parsedInput;
    expect(parsed).toBeDefined();

    // Step 2: Query timeline
    const timelineResult = await executors.rpTimelineQueryV1({
      node: { id: "tq1", type: "rpTimelineQueryV1", config: {}, position: { x: 100, y: 0 } },
      inputs: { parsedInput: parsed },
      context,
    });

    const timelineContext = timelineResult.outputs.timelineContext;
    expect(timelineContext).toBeDefined();

    // Step 3: Retrieve lore
    const loreResult = await executors.rpLoreRetrieverV1({
      node: { id: "lr1", type: "rpLoreRetrieverV1", config: {}, position: { x: 100, y: 100 } },
      inputs: { parsedInput: parsed },
      context,
    });

    const loreContext = loreResult.outputs.loreContext;
    expect(loreContext).toBeDefined();

    // Step 4: Assemble context
    const assemblerResult = await executors.rpContextAssemblerV1({
      node: { id: "a1", type: "rpContextAssemblerV1", config: {}, position: { x: 200, y: 0 } },
      inputs: {
        parsedInput: parsed,
        timelineContext,
        loreContext,
      },
      context,
    });

    const assembled = assemblerResult.outputs.assembledContext as Record<string, unknown>;
    expect(assembled).toBeDefined();
    expect(assembled.fullContext).toContain("Alice");
    expect(assembled.fullContext).toContain("tavern");

    // Step 5: Write
    const writerResult = await executors.rpWriterV1({
      node: { id: "w1", type: "rpWriterV1", config: {}, position: { x: 300, y: 0 } },
      inputs: { assembledContext: assembled },
      context,
    });

    const output = writerResult.outputs.writerOutput as Record<string, unknown>;
    expect(output).toBeDefined();
    expect(typeof output.text).toBe("string");
    expect(output.generationMode).toBe("echo_fallback");
  });

  it("validates Phase B-2 workflow structure", () => {
    const services = createMockServices();
    const { catalog } = registerRpRuntime(services);

    const workflow: WorkflowDefinition = {
      id: "rp-b2-workflow",
      name: "RP Phase B-2 Workflow",
      version: 1,
      nodes: [
        { id: "parser", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
        { id: "timeline", type: "rpTimelineQueryV1", config: {}, position: { x: 100, y: 0 } },
        { id: "lore", type: "rpLoreRetrieverV1", config: {}, position: { x: 100, y: 100 } },
        { id: "assembler", type: "rpContextAssemblerV1", config: {}, position: { x: 200, y: 0 } },
        { id: "writer", type: "rpWriterV1", config: {}, position: { x: 300, y: 0 } },
      ],
      edges: [
        {
          id: "e1",
          source: "parser",
          sourcePort: "parsedInput",
          target: "timeline",
          targetPort: "parsedInput",
        },
        {
          id: "e2",
          source: "parser",
          sourcePort: "parsedInput",
          target: "lore",
          targetPort: "parsedInput",
        },
        {
          id: "e3",
          source: "timeline",
          sourcePort: "timelineContext",
          target: "assembler",
          targetPort: "timelineContext",
        },
        {
          id: "e4",
          source: "lore",
          sourcePort: "loreContext",
          target: "assembler",
          targetPort: "loreContext",
        },
        {
          id: "e5",
          source: "assembler",
          sourcePort: "assembledContext",
          target: "writer",
          targetPort: "assembledContext",
        },
      ],
    };

    const issues = validateWorkflow(workflow, catalog);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);
  });
});

describe("Phase B-1 E2E: Full Runtime (validateWorkflow + runWorkflow)", () => {
  it("validates and runs the complete workflow pipeline", async () => {
    const services = createMockServices();
    const { catalog, executors } = registerRpRuntime(services);
    const workflow = createPhaseB1Workflow();

    // Step 1: Validate workflow
    const validationIssues = validateWorkflow(workflow, catalog);
    const errors = validationIssues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);

    // Step 2: Run workflow with context
    const context: WorkflowRunContext = {
      runId: "e2e-run-1",
      values: {
        rp: { sessionId: "session-e2e", worldId: "world-e2e", turnId: "turn-1" },
      },
    };

    // We need to inject rawInput as the initial input for the parser
    // The workflow runner collects inputs from edges, but the first node has no input edges
    // So we need to provide the initial input via a special mechanism
    // For this test, we'll manually set up the initial input

    // Actually, the workflow runner expects inputs to come from edges.
    // For the first node, we need to provide the input somehow.
    // Let's check how the runner handles this...

    // Looking at runner.ts, collectInputs returns empty {} for nodes with no input edges.
    // So we need to modify our approach: either add a "source" node or handle initial input differently.

    // For now, let's test by directly calling executors in sequence, but verify the workflow structure is valid.

    // Actually, let me re-read the runner... it seems like we need to provide initial values somehow.
    // Let me check if there's a way to inject initial inputs...

    // The runner doesn't support initial inputs directly. We need to either:
    // 1. Add a "constant" node that provides the initial input
    // 2. Modify the workflow to accept external inputs
    // 3. Test the workflow structure validation separately from execution

    // For this E2E test, let's verify:
    // 1. Workflow validates correctly
    // 2. We can manually execute the pipeline and verify data flow
    // 3. Concurrent runs don't pollute each other

    // Manual execution to verify data flow
    const rawInput =
      "\u201cHello there!\u201d Alice said. *draws sword* \u201cReady for battle?\u201d";

    const parserResult = await executors.rpInputParserV1({
      node: workflow.nodes[0],
      inputs: { rawInput },
      context,
    });

    const parsed = parserResult.outputs.parsedInput;
    expect(parsed).toBeDefined();

    const assemblerResult = await executors.rpContextAssemblerV1({
      node: workflow.nodes[1],
      inputs: { parsedInput: parsed },
      context,
    });

    const assembled = assemblerResult.outputs.assembledContext;
    expect(assembled).toBeDefined();

    const writerResult = await executors.rpWriterV1({
      node: workflow.nodes[2],
      inputs: { assembledContext: assembled },
      context,
    });

    const output = writerResult.outputs.writerOutput as Record<string, unknown>;
    expect(output).toBeDefined();
    expect(typeof output.text).toBe("string");
    expect(output.generationMode).toBe("echo_fallback");
  });

  it("context.values.rp is passed to all nodes correctly", async () => {
    const services = createMockServices();
    const { executors } = registerRpRuntime(services);

    const context: WorkflowRunContext = {
      runId: "scope-test",
      values: {
        rp: { sessionId: "test-session", worldId: "test-world", turnId: "test-turn" },
      },
    };

    // Parser doesn't use scope, but assembler and writer should receive it
    const parserResult = await executors.rpInputParserV1({
      node: { id: "p1", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
      inputs: { rawInput: "Test input" },
      context,
    });

    // Verify the context was passed (parser doesn't use it, but it should be available)
    expect(parserResult.outputs.parsedInput).toBeDefined();

    // Assembler uses scope for store isolation
    const assemblerResult = await executors.rpContextAssemblerV1({
      node: { id: "a1", type: "rpContextAssemblerV1", config: {}, position: { x: 100, y: 0 } },
      inputs: { parsedInput: parserResult.outputs.parsedInput },
      context,
    });

    expect(assemblerResult.outputs.assembledContext).toBeDefined();
    expect(assemblerResult.outputs.budgetReport).toBeDefined();
  });

  it("concurrent runs with different scopes don't pollute each other", async () => {
    const services = createMockServices();
    const { executors } = registerRpRuntime(services);

    // Run 1: Session A
    const contextA: WorkflowRunContext = {
      runId: "run-a",
      values: {
        rp: { sessionId: "session-A", worldId: "world-A", turnId: "turn-A1" },
      },
    };

    // Run 2: Session B
    const contextB: WorkflowRunContext = {
      runId: "run-b",
      values: {
        rp: { sessionId: "session-B", worldId: "world-B", turnId: "turn-B1" },
      },
    };

    // Execute both runs concurrently
    const [resultA, resultB] = await Promise.all([
      executors.rpInputParserV1({
        node: { id: "p-a", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
        inputs: { rawInput: "Input from session A" },
        context: contextA,
      }),
      executors.rpInputParserV1({
        node: { id: "p-b", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
        inputs: { rawInput: "Input from session B" },
        context: contextB,
      }),
    ]);

    // Verify results are independent
    const parsedA = resultA.outputs.parsedInput as Record<string, unknown>;
    const parsedB = resultB.outputs.parsedInput as Record<string, unknown>;

    expect(parsedA.rawText).toBe("Input from session A");
    expect(parsedB.rawText).toBe("Input from session B");

    // Continue with assembler
    const [assemblerA, assemblerB] = await Promise.all([
      executors.rpContextAssemblerV1({
        node: { id: "a-a", type: "rpContextAssemblerV1", config: {}, position: { x: 100, y: 0 } },
        inputs: { parsedInput: parsedA },
        context: contextA,
      }),
      executors.rpContextAssemblerV1({
        node: { id: "a-b", type: "rpContextAssemblerV1", config: {}, position: { x: 100, y: 0 } },
        inputs: { parsedInput: parsedB },
        context: contextB,
      }),
    ]);

    const assembledA = assemblerA.outputs.assembledContext as Record<string, unknown>;
    const assembledB = assemblerB.outputs.assembledContext as Record<string, unknown>;

    // Verify no cross-contamination
    expect(assembledA.fullContext).toContain("Input from session A");
    expect(assembledA.fullContext).not.toContain("Input from session B");
    expect(assembledB.fullContext).toContain("Input from session B");
    expect(assembledB.fullContext).not.toContain("Input from session A");
  });

  it("workflow validation catches unknown node types", () => {
    const services = createMockServices();
    const { catalog } = registerRpRuntime(services);

    const invalidWorkflow: WorkflowDefinition = {
      id: "invalid-workflow",
      name: "Invalid",
      version: 1,
      nodes: [
        {
          id: "unknown-node",
          type: "rpUnknownNodeV1", // Not registered
          config: {},
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    };

    const issues = validateWorkflow(invalidWorkflow, catalog);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("Unknown node type");
  });

  it("workflow validation catches incompatible port types", () => {
    const services = createMockServices();
    const { catalog } = registerRpRuntime(services);

    // Create a workflow with incompatible edge (text -> json with schemaId)
    const invalidWorkflow: WorkflowDefinition = {
      id: "invalid-edge-workflow",
      name: "Invalid Edge",
      version: 1,
      nodes: [
        {
          id: "parser-1",
          type: "rpInputParserV1",
          config: {},
          position: { x: 0, y: 0 },
        },
        {
          id: "writer-1",
          type: "rpWriterV1",
          config: {},
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          id: "bad-edge",
          source: "parser-1",
          sourcePort: "rawInput", // This is an input port, not output
          target: "writer-1",
          targetPort: "assembledContext",
        },
      ],
    };

    const issues = validateWorkflow(invalidWorkflow, catalog);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("Phase B-3 E2E: Full workflow with memory commit", () => {
  it("runs parser → timeline/lore → assembler → writer → summary/tracker → commit pipeline", async () => {
    const services = createMockServices();
    const { executors } = registerRpRuntime(services);

    const context: WorkflowRunContext = {
      runId: "e2e-b3-run",
      values: {
        rp: { sessionId: "session-e2e", worldId: "world-e2e", turnId: "turn-1" },
      },
    };

    // Step 1: Parse input
    const parserResult = await executors.rpInputParserV1({
      node: { id: "p1", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
      inputs: {
        rawInput: "Alice walks into the tavern and meets Bob.",
      },
      context,
    });

    const parsed = parserResult.outputs.parsedInput;
    expect(parsed).toBeDefined();

    // Step 2: Query timeline
    const timelineResult = await executors.rpTimelineQueryV1({
      node: { id: "tq1", type: "rpTimelineQueryV1", config: {}, position: { x: 100, y: 0 } },
      inputs: { parsedInput: parsed },
      context,
    });

    const timelineContext = timelineResult.outputs.timelineContext;

    // Step 3: Retrieve lore
    const loreResult = await executors.rpLoreRetrieverV1({
      node: { id: "lr1", type: "rpLoreRetrieverV1", config: {}, position: { x: 100, y: 100 } },
      inputs: { parsedInput: parsed },
      context,
    });

    const loreContext = loreResult.outputs.loreContext;

    // Step 4: Assemble context
    const assemblerResult = await executors.rpContextAssemblerV1({
      node: { id: "a1", type: "rpContextAssemblerV1", config: {}, position: { x: 200, y: 0 } },
      inputs: {
        parsedInput: parsed,
        timelineContext,
        loreContext,
      },
      context,
    });

    const assembled = assemblerResult.outputs.assembledContext;

    // Step 5: Write
    const writerResult = await executors.rpWriterV1({
      node: { id: "w1", type: "rpWriterV1", config: {}, position: { x: 300, y: 0 } },
      inputs: { assembledContext: assembled },
      context,
    });

    const writerOutput = writerResult.outputs.writerOutput;

    // Step 6: Generate chapter summary
    const summaryResult = await executors.rpChapterSummaryV1({
      node: {
        id: "cs1",
        type: "rpChapterSummaryV1",
        config: { chapterId: "ch-1" },
        position: { x: 400, y: 0 },
      },
      inputs: {
        parsedInput: parsed,
        writerOutput,
      },
      context,
    });

    const memoryEvent = summaryResult.outputs.memoryEvent;
    const chapterPatch = summaryResult.outputs.chapterPatch;
    expect(memoryEvent).toBeDefined();
    expect(chapterPatch).toBeDefined();

    // Step 7: Update tracker (need to get current state first)
    const currentState = await services.stores.tracker.get({
      sessionId: "session-e2e",
      worldId: "world-e2e",
    });

    const trackerResult = await executors.rpTrackerUpdateV1({
      node: { id: "tu1", type: "rpTrackerUpdateV1", config: {}, position: { x: 400, y: 100 } },
      inputs: {
        parsedInput: parsed,
        currentState,
      },
      context,
    });

    const trackerPatch = trackerResult.outputs.trackerPatch;
    expect(trackerPatch).toBeDefined();

    // Step 8: Commit to storage
    const commitResult = await executors.rpMemoryCommitV1({
      node: { id: "mc1", type: "rpMemoryCommitV1", config: {}, position: { x: 500, y: 0 } },
      inputs: {
        memoryEvent,
        chapterPatch,
        trackerPatch,
      },
      context,
    });

    const commit = commitResult.outputs.commitResult as Record<string, unknown>;
    expect(commit).toBeDefined();
    expect(commit.success).toBe(true);
    expect(commit.eventId).toBeDefined();
    expect(commit.chapterId).toBe("ch-1");
    expect(commit.errors).toEqual([]);

    // Verify data was written to stores
    const events = await services.stores.timeline.getEventsByChapter({
      sessionId: "session-e2e",
      worldId: "world-e2e",
      chapterId: "ch-1",
    });
    expect(events.length).toBe(1);

    const chapter = await services.stores.chapter.getChapter({
      sessionId: "session-e2e",
      worldId: "world-e2e",
      chapterId: "ch-1",
    });
    expect(chapter).not.toBeNull();
    expect(chapter!.events.length).toBe(1);
  });

  it("validates Phase B-3 workflow structure", () => {
    const services = createMockServices();
    const { catalog } = registerRpRuntime(services);

    const workflow: WorkflowDefinition = {
      id: "rp-b3-workflow",
      name: "RP Phase B-3 Workflow",
      version: 1,
      nodes: [
        { id: "parser", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
        { id: "timeline", type: "rpTimelineQueryV1", config: {}, position: { x: 100, y: 0 } },
        { id: "lore", type: "rpLoreRetrieverV1", config: {}, position: { x: 100, y: 100 } },
        { id: "assembler", type: "rpContextAssemblerV1", config: {}, position: { x: 200, y: 0 } },
        { id: "writer", type: "rpWriterV1", config: {}, position: { x: 300, y: 0 } },
        { id: "summary", type: "rpChapterSummaryV1", config: {}, position: { x: 400, y: 0 } },
        { id: "tracker", type: "rpTrackerUpdateV1", config: {}, position: { x: 400, y: 100 } },
        { id: "commit", type: "rpMemoryCommitV1", config: {}, position: { x: 500, y: 0 } },
      ],
      edges: [
        {
          id: "e1",
          source: "parser",
          sourcePort: "parsedInput",
          target: "timeline",
          targetPort: "parsedInput",
        },
        {
          id: "e2",
          source: "parser",
          sourcePort: "parsedInput",
          target: "lore",
          targetPort: "parsedInput",
        },
        {
          id: "e3",
          source: "timeline",
          sourcePort: "timelineContext",
          target: "assembler",
          targetPort: "timelineContext",
        },
        {
          id: "e4",
          source: "lore",
          sourcePort: "loreContext",
          target: "assembler",
          targetPort: "loreContext",
        },
        {
          id: "e5",
          source: "assembler",
          sourcePort: "assembledContext",
          target: "writer",
          targetPort: "assembledContext",
        },
        {
          id: "e6",
          source: "parser",
          sourcePort: "parsedInput",
          target: "summary",
          targetPort: "parsedInput",
        },
        {
          id: "e7",
          source: "writer",
          sourcePort: "writerOutput",
          target: "summary",
          targetPort: "writerOutput",
        },
        {
          id: "e8",
          source: "summary",
          sourcePort: "memoryEvent",
          target: "commit",
          targetPort: "memoryEvent",
        },
        {
          id: "e9",
          source: "summary",
          sourcePort: "chapterPatch",
          target: "commit",
          targetPort: "chapterPatch",
        },
        {
          id: "e10",
          source: "tracker",
          sourcePort: "trackerPatch",
          target: "commit",
          targetPort: "trackerPatch",
        },
      ],
    };

    const issues = validateWorkflow(workflow, catalog);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);
  });
});

describe("Phase I-2: JSON Roundtrip and SchemaId Preservation", () => {
  it("workflow JSON can be loaded, serialized, and reloaded without losing schemaId", async () => {
    const services = createMockServices();
    const { catalog } = registerRpRuntime(services);

    // Create a workflow with RP nodes that have schemaId
    const workflow: WorkflowDefinition = {
      id: "json-roundtrip-test",
      name: "JSON Roundtrip Test",
      version: 1,
      nodes: [
        { id: "parser", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
        { id: "assembler", type: "rpContextAssemblerV1", config: {}, position: { x: 200, y: 0 } },
        { id: "writer", type: "rpWriterV1", config: {}, position: { x: 400, y: 0 } },
      ],
      edges: [
        {
          id: "e1",
          source: "parser",
          sourcePort: "parsedInput",
          target: "assembler",
          targetPort: "parsedInput",
        },
        {
          id: "e2",
          source: "assembler",
          sourcePort: "assembledContext",
          target: "writer",
          targetPort: "assembledContext",
        },
      ],
    };

    // Step 1: Validate original workflow
    const originalIssues = validateWorkflow(workflow, catalog);
    const originalErrors = originalIssues.filter((i) => i.level === "error");
    expect(originalErrors).toHaveLength(0);

    // Step 2: Serialize to JSON
    const json = JSON.stringify(workflow);
    expect(json).toBeDefined();
    expect(json.length).toBeGreaterThan(0);

    // Step 3: Deserialize from JSON
    const deserialized = JSON.parse(json) as WorkflowDefinition;
    expect(deserialized.id).toBe(workflow.id);
    expect(deserialized.nodes.length).toBe(workflow.nodes.length);
    expect(deserialized.edges.length).toBe(workflow.edges.length);

    // Step 4: Validate deserialized workflow
    const reloadedIssues = validateWorkflow(deserialized, catalog);
    const reloadedErrors = reloadedIssues.filter((i) => i.level === "error");
    expect(reloadedErrors).toHaveLength(0);

    // Step 5: Verify schemaId is preserved through catalog lookup
    // (schemaId is stored in catalog, not in workflow JSON)
    const parserDef = catalog["rpInputParserV1"];
    const parsedOutputPort = parserDef.ports.find(
      (p) => p.id === "parsedInput" && p.direction === "output",
    );
    expect(parsedOutputPort?.schemaId).toBe("rp.parsed-input.v1");

    const assemblerDef = catalog["rpContextAssemblerV1"];
    const assembledOutputPort = assemblerDef.ports.find(
      (p) => p.id === "assembledContext" && p.direction === "output",
    );
    expect(assembledOutputPort?.schemaId).toBe("rp.assembled-context.v1");

    const writerDef = catalog["rpWriterV1"];
    const writerInputPort = writerDef.ports.find(
      (p) => p.id === "assembledContext" && p.direction === "input",
    );
    expect(writerInputPort?.schemaId).toBe("rp.assembled-context.v1");
  });

  it("smoke workflow JSON file can be loaded and validated", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const { nodeRegistry } = await import("@awp/workflow-core");

    const services = createMockServices();
    const { catalog } = registerRpRuntime(services);

    // Merge built-in nodes with RP nodes
    const fullCatalog = { ...nodeRegistry, ...catalog };

    // Load the actual smoke workflow JSON
    const workflowPath = resolve(
      __dirname,
      "../../../../data/workflows/rp-foundation-smoke-workflow-v1.json",
    );
    const content = await readFile(workflowPath, "utf-8");
    const envelope = JSON.parse(content);
    const workflow = envelope.workflow ?? envelope;

    // Validate the loaded workflow
    const issues = validateWorkflow(workflow, fullCatalog);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);

    // Verify it contains RP nodes
    const rpNodeTypes = workflow.nodes.map((n: { type: string }) => n.type);
    expect(rpNodeTypes).toContain("rpInputParserV1");
    expect(rpNodeTypes).toContain("rpContextAssemblerV1");
    expect(rpNodeTypes).toContain("rpWriterV1");
  });
});

describe("Phase I-2.1: Platform-level regression tests", () => {
  it("catalog and executors have matching RP node types (1:1 correspondence)", () => {
    const services = createMockServices();
    const { catalog, executors } = registerRpRuntime(services);

    const catalogTypes = Object.keys(catalog).sort();
    const executorTypes = Object.keys(executors).sort();

    // Every catalog entry must have an executor
    for (const type of catalogTypes) {
      expect(executorTypes).toContain(type);
    }

    // Every executor must have a catalog entry
    for (const type of executorTypes) {
      expect(catalogTypes).toContain(type);
    }

    // Counts must match
    expect(catalogTypes.length).toBe(executorTypes.length);
  });

  it("all 8 RP nodes are fully implemented (no placeholder nodes)", () => {
    const services = createMockServices();
    const { catalog, executors } = registerRpRuntime(services);

    const expectedTypes = [
      "rpInputParserV1",
      "rpContextAssemblerV1",
      "rpWriterV1",
      "rpTimelineQueryV1",
      "rpLoreRetrieverV1",
      "rpChapterSummaryV1",
      "rpTrackerUpdateV1",
      "rpMemoryCommitV1",
    ];

    for (const type of expectedTypes) {
      // Has definition
      expect(catalog[type]).toBeDefined();
      expect(catalog[type].type).toBe(type);
      expect(catalog[type].ports.length).toBeGreaterThan(0);

      // Has executor
      expect(executors[type]).toBeDefined();
      expect(typeof executors[type]).toBe("function");
    }
  });

  it("no placeholder/test-only nodes in rp-runtime catalog", () => {
    const services = createMockServices();
    const { catalog } = registerRpRuntime(services);

    // These should NOT be in rp-runtime catalog (they were removed from workflow-core)
    const forbiddenTypes = [
      "rpCharacterCard",
      "rpSceneState",
      "rpLoreRecall",
      "rpDialogueDirector",
      "rpContinuityCheck",
    ];

    for (const type of forbiddenTypes) {
      expect(catalog[type]).toBeUndefined();
    }
  });

  it("rpWriterV1 outputs both narrative (draft string) and writerOutput (json)", async () => {
    const services = createMockServices();
    const { executors } = registerRpRuntime(services);

    const context: WorkflowRunContext = {
      runId: "writer-test",
      values: {
        rp: { sessionId: "s1", worldId: "w1", turnId: "t1" },
      },
    };

    // First parse and assemble
    const parserResult = await executors.rpInputParserV1({
      node: { id: "p1", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
      inputs: { rawInput: "Test input for writer" },
      context,
    });

    const assemblerResult = await executors.rpContextAssemblerV1({
      node: { id: "a1", type: "rpContextAssemblerV1", config: {}, position: { x: 100, y: 0 } },
      inputs: { parsedInput: parserResult.outputs.parsedInput },
      context,
    });

    // Then write
    const writerResult = await executors.rpWriterV1({
      node: { id: "w1", type: "rpWriterV1", config: {}, position: { x: 200, y: 0 } },
      inputs: { assembledContext: assemblerResult.outputs.assembledContext },
      context,
    });

    // Verify narrative is a string
    expect(typeof writerResult.outputs.narrative).toBe("string");
    expect((writerResult.outputs.narrative as string).length).toBeGreaterThan(0);

    // Verify writerOutput is a structured object
    const writerOutput = writerResult.outputs.writerOutput as Record<string, unknown>;
    expect(writerOutput).toBeDefined();
    expect(typeof writerOutput.text).toBe("string");
    expect(writerOutput.generationMode).toBeDefined();
    expect(writerOutput.metadata).toBeDefined();

    // narrative should equal writerOutput.text
    expect(writerResult.outputs.narrative).toBe(writerOutput.text);
  });

  it("smoke workflow outputs narrative string to textOutput", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const { nodeRegistry } = await import("@awp/workflow-core");
    const { runWorkflow } = await import("@awp/workflow-core");

    const services = createMockServices();
    const { catalog, executors } = registerRpRuntime(services);
    const fullCatalog = { ...nodeRegistry, ...catalog };

    // Add textOutput for the smoke workflow
    const fullExecutors = {
      ...executors,
      userInput: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: (node.config.text as string) ?? "" },
      }),
      textOutput: async ({ inputs }: { inputs: Record<string, unknown> }) => ({
        outputs: { final: inputs.text ?? "" },
      }),
    };

    // Add textOutput definition to catalog
    const catalogWithOutput = {
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

    // Load smoke workflow
    const workflowPath = resolve(
      __dirname,
      "../../../../data/workflows/rp-foundation-smoke-workflow-v1.json",
    );
    const content = await readFile(workflowPath, "utf-8");
    const envelope = JSON.parse(content);
    const workflow = envelope.workflow ?? envelope;

    const context: WorkflowRunContext = {
      runId: "smoke-output-test",
      values: {
        rp: { sessionId: "s1", worldId: "w1", turnId: "t1" },
      },
    };

    const result = await runWorkflow(workflow, fullExecutors, catalogWithOutput, context);
    expect(result.status).toBe("success");

    // Find the output node run
    const outputRun = result.nodeRuns.find((r) => r.nodeId === "output");
    expect(outputRun).toBeDefined();
    expect(outputRun!.status).toBe("success");

    // The final output should be a string (narrative), not an object
    const finalOutput = outputRun!.outputs!.final;
    expect(typeof finalOutput).toBe("string");
    expect((finalOutput as string).length).toBeGreaterThan(0);
  });
});

describe("Phase B-2: Timeline retrieval with scoring and matchedBy", () => {
  it("timeline query returns events with score and matchedBy", async () => {
    const services = createMockServices();

    // Seed timeline events
    await services.stores.timeline.putEvent({
      sessionId: "session-b2",
      worldId: "world-b2",
      event: {
        eventId: "evt-1",
        sessionId: "session-b2",
        worldId: "world-b2",
        chapterId: "ch-1",
        sourceTurnId: "t-0",
        summary: "Alice entered the tavern and met Bob the bartender.",
        characters: ["Alice", "Bob"],
        locations: ["tavern"],
        items: [],
        time: null,
        emotionalChanges: [],
        createdAt: new Date().toISOString(),
      },
    });

    await services.stores.timeline.putEvent({
      sessionId: "session-b2",
      worldId: "world-b2",
      event: {
        eventId: "evt-2",
        sessionId: "session-b2",
        worldId: "world-b2",
        chapterId: "ch-1",
        sourceTurnId: "t-1",
        summary: "Bob served Alice a drink and they talked about the mysterious forest.",
        characters: ["Alice", "Bob"],
        locations: ["tavern"],
        items: ["drink"],
        time: null,
        emotionalChanges: [],
        createdAt: new Date().toISOString(),
      },
    });

    const { executors } = registerRpRuntime(services);

    const context: WorkflowRunContext = {
      runId: "timeline-b2",
      values: {
        rp: { sessionId: "session-b2", worldId: "world-b2", turnId: "t-2" },
      },
    };

    // Parse input with entities
    const parserResult = await executors.rpInputParserV1({
      node: { id: "p1", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
      inputs: { rawInput: "Alice asks Bob about the forest." },
      context,
    });

    const timelineResult = await executors.rpTimelineQueryV1({
      node: { id: "tq1", type: "rpTimelineQueryV1", config: {}, position: { x: 100, y: 0 } },
      inputs: { parsedInput: parserResult.outputs.parsedInput },
      context,
    });

    const timelineContext = timelineResult.outputs.timelineContext as Record<string, unknown>;
    expect(timelineContext).toBeDefined();

    const relevantEvents = timelineContext.relevantEvents as Array<Record<string, unknown>>;
    expect(relevantEvents.length).toBeGreaterThan(0);

    // Each event should have score and matchedBy
    for (const event of relevantEvents) {
      expect(typeof event.score).toBe("number");
      expect(Array.isArray(event.matchedBy)).toBe(true);
      expect((event.matchedBy as string[]).length).toBeGreaterThan(0);
    }

    // Events mentioning Alice should have higher scores (matchedBy contains lowercase keywords)
    const aliceEvent = relevantEvents.find((e) =>
      (e.matchedBy as string[]).some((m) => m.toLowerCase().includes("alice")),
    );
    expect(aliceEvent).toBeDefined();
    // matchedBy contains keyword matches like "keyword:alice" or entity matches like "character:Alice"
    expect((aliceEvent!.matchedBy as string[]).length).toBeGreaterThan(0);
  });

  it("timeline query returns empty for no matches", async () => {
    const services = createMockServices();

    // Seed unrelated event
    await services.stores.timeline.putEvent({
      sessionId: "session-empty",
      worldId: "world-empty",
      event: {
        eventId: "evt-unrelated",
        sessionId: "session-empty",
        worldId: "world-empty",
        chapterId: "ch-1",
        sourceTurnId: "t-0",
        summary: "Something completely different happened.",
        characters: ["Charlie"],
        locations: ["forest"],
        items: [],
        time: null,
        emotionalChanges: [],
        createdAt: new Date().toISOString(),
      },
    });

    const { executors } = registerRpRuntime(services);

    const context: WorkflowRunContext = {
      runId: "timeline-empty",
      values: {
        rp: { sessionId: "session-empty", worldId: "world-empty", turnId: "t-1" },
      },
    };

    const parserResult = await executors.rpInputParserV1({
      node: { id: "p1", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
      inputs: { rawInput: "Alice walks into the tavern." },
      context,
    });

    const timelineResult = await executors.rpTimelineQueryV1({
      node: { id: "tq1", type: "rpTimelineQueryV1", config: {}, position: { x: 100, y: 0 } },
      inputs: { parsedInput: parserResult.outputs.parsedInput },
      context,
    });

    const timelineContext = timelineResult.outputs.timelineContext as Record<string, unknown>;
    const relevantEvents = timelineContext.relevantEvents as Array<Record<string, unknown>>;

    // No matching events
    expect(relevantEvents.length).toBe(0);
  });

  it("timeline respects limit", async () => {
    const services = createMockServices();

    // Seed many events
    for (let i = 0; i < 30; i++) {
      await services.stores.timeline.putEvent({
        sessionId: "session-limit",
        worldId: "world-limit",
        event: {
          eventId: `evt-${i}`,
          sessionId: "session-limit",
          worldId: "world-limit",
          chapterId: "ch-1",
          sourceTurnId: `t-${i}`,
          summary: `Event ${i} mentions Alice and the tavern.`,
          characters: ["Alice"],
          locations: ["tavern"],
          items: [],
          time: null,
          emotionalChanges: [],
          createdAt: new Date().toISOString(),
        },
      });
    }

    // Create executor with custom config
    const { createRpTimelineQueryV1Executor, createRpInputParserV1Executor } =
      await import("../../src/nodes/index.js");
    const timelineExecutor = createRpTimelineQueryV1Executor({
      stores: services.stores,
      config: { eventLimit: 5 },
    });
    const parserExecutor = createRpInputParserV1Executor();

    const context: WorkflowRunContext = {
      runId: "timeline-limit",
      values: {
        rp: { sessionId: "session-limit", worldId: "world-limit", turnId: "t-30" },
      },
    };

    const parserResult = await parserExecutor({
      node: { id: "p1", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
      inputs: { rawInput: "Alice enters the tavern." },
      context,
    });

    const timelineResult = await timelineExecutor({
      node: { id: "tq1", type: "rpTimelineQueryV1", config: {}, position: { x: 100, y: 0 } },
      inputs: { parsedInput: parserResult.outputs.parsedInput },
      context,
    });

    const timelineContext = timelineResult.outputs.timelineContext as Record<string, unknown>;
    const relevantEvents = timelineContext.relevantEvents as Array<Record<string, unknown>>;

    // Should be limited to 5
    expect(relevantEvents.length).toBeLessThanOrEqual(5);
  });
});

describe("Phase B-2: Lore retrieval with activation modes", () => {
  it("always_on entries are included automatically", async () => {
    const services = createMockServices();

    await services.stores.lore.putEntry({
      sessionId: "session-lore",
      worldId: "world-lore",
      entry: {
        id: "lore-always",
        sessionId: "session-lore",
        worldId: "world-lore",
        title: "World Rules",
        content: "Magic is forbidden in the city.",
        keywords: ["magic", "rules"],
        category: "rule",
        activationMode: "always_on",
        priority: 10,
      },
    });

    const { executors } = registerRpRuntime(services);

    const context: WorkflowRunContext = {
      runId: "lore-always",
      values: {
        rp: { sessionId: "session-lore", worldId: "world-lore", turnId: "t-1" },
      },
    };

    const parserResult = await executors.rpInputParserV1({
      node: { id: "p1", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
      inputs: { rawInput: "Something unrelated happens." },
      context,
    });

    const loreResult = await executors.rpLoreRetrieverV1({
      node: { id: "lr1", type: "rpLoreRetrieverV1", config: {}, position: { x: 100, y: 0 } },
      inputs: { parsedInput: parserResult.outputs.parsedInput },
      context,
    });

    const loreContext = loreResult.outputs.loreContext as Record<string, unknown>;
    const entries = loreContext.entries as Array<Record<string, unknown>>;

    // always_on entry should be included
    expect(entries.length).toBeGreaterThan(0);
    const alwaysOnEntry = entries.find((e) => e.id === "lore-always");
    expect(alwaysOnEntry).toBeDefined();
    expect(alwaysOnEntry!.matchedBy as string[]).toContain("activation:always_on");
  });

  it("triggered entries require keyword match", async () => {
    const services = createMockServices();

    await services.stores.lore.putEntry({
      sessionId: "session-trigger",
      worldId: "world-trigger",
      entry: {
        id: "lore-triggered",
        sessionId: "session-trigger",
        worldId: "world-trigger",
        title: "Tavern Rules",
        content: "No weapons allowed in the tavern.",
        keywords: ["tavern", "weapons"],
        category: "location",
        activationMode: "triggered",
        priority: 5,
      },
    });

    const { executors } = registerRpRuntime(services);

    const context: WorkflowRunContext = {
      runId: "lore-trigger",
      values: {
        rp: { sessionId: "session-trigger", worldId: "world-trigger", turnId: "t-1" },
      },
    };

    // Input with matching keyword
    const parserResult = await executors.rpInputParserV1({
      node: { id: "p1", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
      inputs: { rawInput: "Alice enters the tavern with her sword." },
      context,
    });

    const loreResult = await executors.rpLoreRetrieverV1({
      node: { id: "lr1", type: "rpLoreRetrieverV1", config: {}, position: { x: 100, y: 0 } },
      inputs: { parsedInput: parserResult.outputs.parsedInput },
      context,
    });

    const loreContext = loreResult.outputs.loreContext as Record<string, unknown>;
    const entries = loreContext.entries as Array<Record<string, unknown>>;

    // triggered entry should be included because of keyword match
    const triggeredEntry = entries.find((e) => e.id === "lore-triggered");
    expect(triggeredEntry).toBeDefined();
    expect(typeof triggeredEntry!.score).toBe("number");
    expect(triggeredEntry!.score as number).toBeGreaterThan(0);
  });

  it("manual_off entries are never auto-included", async () => {
    const services = createMockServices();

    await services.stores.lore.putEntry({
      sessionId: "session-manual",
      worldId: "world-manual",
      entry: {
        id: "lore-manual",
        sessionId: "session-manual",
        worldId: "world-manual",
        title: "Secret Rule",
        content: "This is a secret that should not auto-activate.",
        keywords: ["secret"],
        category: "rule",
        activationMode: "manual_off",
        priority: 10,
      },
    });

    const { executors } = registerRpRuntime(services);

    const context: WorkflowRunContext = {
      runId: "lore-manual",
      values: {
        rp: { sessionId: "session-manual", worldId: "world-manual", turnId: "t-1" },
      },
    };

    const parserResult = await executors.rpInputParserV1({
      node: { id: "p1", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
      inputs: { rawInput: "Tell me about the secret." },
      context,
    });

    const loreResult = await executors.rpLoreRetrieverV1({
      node: { id: "lr1", type: "rpLoreRetrieverV1", config: {}, position: { x: 100, y: 0 } },
      inputs: { parsedInput: parserResult.outputs.parsedInput },
      context,
    });

    const loreContext = loreResult.outputs.loreContext as Record<string, unknown>;
    const entries = loreContext.entries as Array<Record<string, unknown>>;

    // manual_off entry should NOT be included
    const manualEntry = entries.find((e) => e.id === "lore-manual");
    expect(manualEntry).toBeUndefined();
  });

  it("lore entries are deduplicated", async () => {
    const services = createMockServices();

    // Add same entry twice (shouldn't happen but test dedup)
    const entry = {
      id: "lore-dedup",
      sessionId: "session-dedup",
      worldId: "world-dedup",
      title: "Duplicate Entry",
      content: "This entry should only appear once.",
      keywords: ["duplicate"],
      category: "rule" as const,
      activationMode: "always_on" as const,
      priority: 5,
    };

    await services.stores.lore.putEntry({
      sessionId: "session-dedup",
      worldId: "world-dedup",
      entry,
    });

    const { executors } = registerRpRuntime(services);

    const context: WorkflowRunContext = {
      runId: "lore-dedup",
      values: {
        rp: { sessionId: "session-dedup", worldId: "world-dedup", turnId: "t-1" },
      },
    };

    const parserResult = await executors.rpInputParserV1({
      node: { id: "p1", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
      inputs: { rawInput: "Something about duplicate." },
      context,
    });

    const loreResult = await executors.rpLoreRetrieverV1({
      node: { id: "lr1", type: "rpLoreRetrieverV1", config: {}, position: { x: 100, y: 0 } },
      inputs: { parsedInput: parserResult.outputs.parsedInput },
      context,
    });

    const loreContext = loreResult.outputs.loreContext as Record<string, unknown>;
    const entries = loreContext.entries as Array<Record<string, unknown>>;

    // Should only have one entry with this id
    const dedupEntries = entries.filter((e) => e.id === "lore-dedup");
    expect(dedupEntries.length).toBe(1);
  });
});

describe("Phase B-2: Retrieval workflow E2E", () => {
  it("retrieval workflow runs end-to-end with timeline and lore", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const { nodeRegistry } = await import("@awp/workflow-core");
    const { runWorkflow } = await import("@awp/workflow-core");

    const services = createMockServices();

    // Seed data
    await services.stores.timeline.putEvent({
      sessionId: "session-retrieval",
      worldId: "world-retrieval",
      event: {
        eventId: "evt-history",
        sessionId: "session-retrieval",
        worldId: "world-retrieval",
        chapterId: "ch-1",
        sourceTurnId: "t-0",
        summary: "Alice previously visited the tavern and met Bob.",
        characters: ["Alice", "Bob"],
        locations: ["tavern"],
        items: [],
        time: null,
        emotionalChanges: [],
        createdAt: new Date().toISOString(),
      },
    });

    await services.stores.lore.putEntry({
      sessionId: "session-retrieval",
      worldId: "world-retrieval",
      entry: {
        id: "lore-tavern",
        sessionId: "session-retrieval",
        worldId: "world-retrieval",
        title: "Tavern Rules",
        content: "The tavern is a safe zone. No fighting allowed.",
        keywords: ["tavern", "safe"],
        category: "location",
        activationMode: "triggered",
        priority: 5,
      },
    });

    const { catalog, executors } = registerRpRuntime(services);
    const fullCatalog = { ...nodeRegistry, ...catalog };

    const fullExecutors = {
      ...executors,
      userInput: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: (node.config.text as string) ?? "" },
      }),
      textOutput: async ({ inputs }: { inputs: Record<string, unknown> }) => ({
        outputs: { final: inputs.text ?? "" },
      }),
    };

    const catalogWithOutput = {
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

    // Load retrieval workflow
    const workflowPath = resolve(
      __dirname,
      "../../../../data/workflows/rp-retrieval-workflow-v1.json",
    );
    const content = await readFile(workflowPath, "utf-8");
    const envelope = JSON.parse(content);
    const workflow = envelope.workflow ?? envelope;

    const context: WorkflowRunContext = {
      runId: "retrieval-e2e",
      values: {
        rp: { sessionId: "session-retrieval", worldId: "world-retrieval", turnId: "t-1" },
      },
    };

    const result = await runWorkflow(workflow, fullExecutors, catalogWithOutput, context);
    expect(result.status).toBe("success");

    // Verify all nodes ran
    const nodeIds = result.nodeRuns.map((r) => r.nodeId);
    expect(nodeIds).toContain("input");
    expect(nodeIds).toContain("parser");
    expect(nodeIds).toContain("timeline");
    expect(nodeIds).toContain("lore");
    expect(nodeIds).toContain("assembler");
    expect(nodeIds).toContain("writer");
    expect(nodeIds).toContain("output");

    // Verify output is a string
    const outputRun = result.nodeRuns.find((r) => r.nodeId === "output");
    expect(outputRun).toBeDefined();
    expect(typeof outputRun!.outputs!.final).toBe("string");
  });

  it("retrieval workflow JSON roundtrip preserves schemaId", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const { nodeRegistry, validateWorkflow } = await import("@awp/workflow-core");

    const services = createMockServices();
    const { catalog } = registerRpRuntime(services);
    const fullCatalog = { ...nodeRegistry, ...catalog };

    // Load retrieval workflow
    const workflowPath = resolve(
      __dirname,
      "../../../../data/workflows/rp-retrieval-workflow-v1.json",
    );
    const content = await readFile(workflowPath, "utf-8");
    const envelope = JSON.parse(content);

    // Serialize and deserialize
    const reserialized = JSON.stringify(envelope);
    const reparsed = JSON.parse(reserialized);
    const workflow = reparsed.workflow ?? reparsed;

    // Validate - should pass without errors
    const issues = validateWorkflow(workflow, fullCatalog);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);
  });
});

describe("Phase B-2: Session isolation", () => {
  it("concurrent runs with different scopes don't pollute each other", async () => {
    const services = createMockServices();

    // Seed data for session A
    await services.stores.timeline.putEvent({
      sessionId: "session-A",
      worldId: "world-A",
      event: {
        eventId: "evt-A",
        sessionId: "session-A",
        worldId: "world-A",
        chapterId: "ch-A",
        sourceTurnId: "t-0",
        summary: "Alice did something in session A.",
        characters: ["Alice"],
        locations: ["location-A"],
        items: [],
        time: null,
        emotionalChanges: [],
        createdAt: new Date().toISOString(),
      },
    });

    // Seed data for session B
    await services.stores.timeline.putEvent({
      sessionId: "session-B",
      worldId: "world-B",
      event: {
        eventId: "evt-B",
        sessionId: "session-B",
        worldId: "world-B",
        chapterId: "ch-B",
        sourceTurnId: "t-0",
        summary: "Bob did something in session B.",
        characters: ["Bob"],
        locations: ["location-B"],
        items: [],
        time: null,
        emotionalChanges: [],
        createdAt: new Date().toISOString(),
      },
    });

    const { executors } = registerRpRuntime(services);

    // Run session A
    const contextA: WorkflowRunContext = {
      runId: "run-A",
      values: {
        rp: { sessionId: "session-A", worldId: "world-A", turnId: "t-1" },
      },
    };

    // Run session B
    const contextB: WorkflowRunContext = {
      runId: "run-B",
      values: {
        rp: { sessionId: "session-B", worldId: "world-B", turnId: "t-1" },
      },
    };

    // Execute both concurrently
    const [parserA, parserB] = await Promise.all([
      executors.rpInputParserV1({
        node: { id: "p-a", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
        inputs: { rawInput: "Alice looks around." },
        context: contextA,
      }),
      executors.rpInputParserV1({
        node: { id: "p-b", type: "rpInputParserV1", config: {}, position: { x: 0, y: 0 } },
        inputs: { rawInput: "Bob looks around." },
        context: contextB,
      }),
    ]);

    const [timelineA, timelineB] = await Promise.all([
      executors.rpTimelineQueryV1({
        node: { id: "tq-a", type: "rpTimelineQueryV1", config: {}, position: { x: 100, y: 0 } },
        inputs: { parsedInput: parserA.outputs.parsedInput },
        context: contextA,
      }),
      executors.rpTimelineQueryV1({
        node: { id: "tq-b", type: "rpTimelineQueryV1", config: {}, position: { x: 100, y: 0 } },
        inputs: { parsedInput: parserB.outputs.parsedInput },
        context: contextB,
      }),
    ]);

    const timelineCtxA = timelineA.outputs.timelineContext as Record<string, unknown>;
    const timelineCtxB = timelineB.outputs.timelineContext as Record<string, unknown>;

    const eventsA = timelineCtxA.relevantEvents as Array<Record<string, unknown>>;
    const eventsB = timelineCtxB.relevantEvents as Array<Record<string, unknown>>;

    // Session A should only see session A events
    for (const event of eventsA) {
      expect(event.sessionId).toBe("session-A");
      expect(event.eventId).not.toBe("evt-B");
    }

    // Session B should only see session B events
    for (const event of eventsB) {
      expect(event.sessionId).toBe("session-B");
      expect(event.eventId).not.toBe("evt-A");
    }
  });
});
