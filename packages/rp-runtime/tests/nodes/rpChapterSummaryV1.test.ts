import { describe, it, expect } from "vitest";
import {
  rpChapterSummaryV1Definition,
  createRpChapterSummaryV1Executor,
} from "../../src/nodes/rpChapterSummaryV1.js";
import type { NodeExecutionInput, WorkflowNode } from "@awp/workflow-core";
import type { ParsedInput, WriterOutput } from "../../src/types.js";

function makeNode(config: Record<string, unknown> = {}): WorkflowNode {
  return {
    id: "chapter-summary-1",
    type: "rpChapterSummaryV1",
    config,
    position: { x: 0, y: 0 },
  };
}

function makeContext(sessionId = "s1", worldId = "w1", turnId = "t1") {
  return {
    runId: "run-1",
    values: {
      rp: { sessionId, worldId, turnId },
    },
  };
}

function makeParsedInput(overrides?: Partial<ParsedInput>): ParsedInput {
  return {
    rawText: "The hero enters the tavern.",
    actions: [],
    dialogues: [],
    intents: [],
    entities: { characters: [], locations: [], items: [], timeHints: [] },
    parsedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWriterOutput(overrides?: Partial<WriterOutput>): WriterOutput {
  return {
    text: "The tavern door creaks open as the hero steps inside...",
    generationMode: "llm",
    metadata: {
      model: "test-model",
      tokenUsage: { input: 100, output: 50 },
      latencyMs: 100,
    },
    ...overrides,
  };
}

function makeInput(
  inputs: Record<string, unknown>,
  node = makeNode(),
  context = makeContext(),
  overrides?: Partial<NodeExecutionInput>,
): NodeExecutionInput {
  return {
    node,
    inputs,
    context,
    ...overrides,
  };
}

describe("rpChapterSummaryV1Definition", () => {
  it("has correct type, category, and ports", () => {
    expect(rpChapterSummaryV1Definition.type).toBe("rpChapterSummaryV1");
    expect(rpChapterSummaryV1Definition.category).toBe("roleplay");

    const inputPortIds = rpChapterSummaryV1Definition.ports
      .filter((p) => p.direction === "input")
      .map((p) => p.id);
    expect(inputPortIds).toContain("parsedInput");
    expect(inputPortIds).toContain("writerOutput");

    const outputPortIds = rpChapterSummaryV1Definition.ports
      .filter((p) => p.direction === "output")
      .map((p) => p.id);
    expect(outputPortIds).toContain("memoryEvent");
    expect(outputPortIds).toContain("chapterPatch");

    const memoryPort = rpChapterSummaryV1Definition.ports.find((p) => p.id === "memoryEvent");
    expect(memoryPort!.dataType).toBe("json");
    expect(memoryPort!.schemaId).toBe("rp.memory-event.v1");
  });
});

describe("createRpChapterSummaryV1Executor", () => {
  it("generates memoryEvent from parsedInput and writerOutput", async () => {
    const executor = createRpChapterSummaryV1Executor();
    const parsedInput = makeParsedInput({
      entities: {
        characters: ["Alice", "Bob"],
        locations: ["tavern"],
        items: ["sword"],
        timeHints: ["evening"],
      },
    });
    const writerOutput = makeWriterOutput();

    const result = await executor(makeInput({ parsedInput, writerOutput }));

    const memoryEvent = result.outputs.memoryEvent as Record<string, unknown>;
    expect(memoryEvent).toBeDefined();
    expect(memoryEvent.sessionId).toBe("s1");
    expect(memoryEvent.worldId).toBe("w1");
    expect(memoryEvent.sourceTurnId).toBe("t1");
    expect(typeof memoryEvent.eventId).toBe("string");
    expect(typeof memoryEvent.summary).toBe("string");
    expect(memoryEvent.characters).toEqual(["Alice", "Bob"]);
    expect(memoryEvent.locations).toEqual(["tavern"]);
    expect(memoryEvent.items).toEqual(["sword"]);
    expect(memoryEvent.time).toBe("evening");
    expect(typeof memoryEvent.createdAt).toBe("string");
  });

  it("generates chapterPatch with correct structure", async () => {
    const executor = createRpChapterSummaryV1Executor();
    const parsedInput = makeParsedInput();
    const writerOutput = makeWriterOutput();

    const result = await executor(
      makeInput({ parsedInput, writerOutput }, makeNode({ chapterId: "ch-1" })),
    );

    const chapterPatch = result.outputs.chapterPatch as Record<string, unknown>;
    expect(chapterPatch).toBeDefined();
    expect(chapterPatch.chapterId).toBe("ch-1");
    expect(typeof chapterPatch.addEventId).toBe("string");
    expect(typeof chapterPatch.updateSummary).toBe("string");
  });

  it("uses default chapterId when not provided in config", async () => {
    const executor = createRpChapterSummaryV1Executor();
    const parsedInput = makeParsedInput();
    const writerOutput = makeWriterOutput();

    const result = await executor(
      makeInput({ parsedInput, writerOutput }, makeNode()), // No chapterId in config
    );

    const chapterPatch = result.outputs.chapterPatch as Record<string, unknown>;
    expect(chapterPatch.chapterId).toBe("default");
  });

  it("truncates long summaries to maxSummaryLength", async () => {
    const executor = createRpChapterSummaryV1Executor({
      config: { maxSummaryLength: 50 },
    });
    const parsedInput = makeParsedInput();
    const writerOutput = makeWriterOutput({
      text: "This is a very long text that should be truncated because it exceeds the maximum summary length configured for this test.",
    });

    const result = await executor(makeInput({ parsedInput, writerOutput }));

    const memoryEvent = result.outputs.memoryEvent as Record<string, unknown>;
    const summary = memoryEvent.summary as string;
    expect(summary.length).toBeLessThanOrEqual(60); // Allow for "..." suffix
    expect(summary).toContain("...");
  });

  it("extracts emotional changes from dialogue tones", async () => {
    const executor = createRpChapterSummaryV1Executor();
    const parsedInput = makeParsedInput({
      dialogues: [
        { speaker: "Alice", text: "Hello!", tone: "happy" },
        { speaker: "Bob", text: "Hi there!", tone: "surprised" },
      ],
    });
    const writerOutput = makeWriterOutput();

    const result = await executor(makeInput({ parsedInput, writerOutput }));

    const memoryEvent = result.outputs.memoryEvent as Record<string, unknown>;
    const emotionalChanges = memoryEvent.emotionalChanges as string[];
    expect(emotionalChanges).toContain("Alice: happy");
    expect(emotionalChanges).toContain("Bob: surprised");
  });

  it("extracts mood from parsedInput", async () => {
    const executor = createRpChapterSummaryV1Executor();
    const parsedInput = makeParsedInput({ mood: "tense" });
    const writerOutput = makeWriterOutput();

    const result = await executor(makeInput({ parsedInput, writerOutput }));

    const memoryEvent = result.outputs.memoryEvent as Record<string, unknown>;
    const emotionalChanges = memoryEvent.emotionalChanges as string[];
    expect(emotionalChanges).toContain("mood: tense");
  });

  it("sets time to null when no timeHints", async () => {
    const executor = createRpChapterSummaryV1Executor();
    const parsedInput = makeParsedInput({
      entities: { characters: [], locations: [], items: [], timeHints: [] },
    });
    const writerOutput = makeWriterOutput();

    const result = await executor(makeInput({ parsedInput, writerOutput }));

    const memoryEvent = result.outputs.memoryEvent as Record<string, unknown>;
    expect(memoryEvent.time).toBeNull();
  });

  it("throws when parsedInput is missing", async () => {
    const executor = createRpChapterSummaryV1Executor();
    const writerOutput = makeWriterOutput();

    await expect(executor(makeInput({ writerOutput }))).rejects.toThrow("parsedInput is required");
  });

  it("throws when writerOutput is missing", async () => {
    const executor = createRpChapterSummaryV1Executor();
    const parsedInput = makeParsedInput();

    await expect(executor(makeInput({ parsedInput }))).rejects.toThrow("writerOutput is required");
  });

  it("throws when context.values.rp is missing", async () => {
    const executor = createRpChapterSummaryV1Executor();
    const parsedInput = makeParsedInput();
    const writerOutput = makeWriterOutput();

    await expect(
      executor({
        node: makeNode(),
        inputs: { parsedInput, writerOutput },
        context: undefined,
      }),
    ).rejects.toThrow();
  });

  it("isolates events by sessionId and worldId", async () => {
    const executor = createRpChapterSummaryV1Executor();
    const parsedInput = makeParsedInput();
    const writerOutput = makeWriterOutput();

    const resultA = await executor(
      makeInput(
        { parsedInput, writerOutput },
        makeNode(),
        makeContext("session-A", "world-A", "t1"),
      ),
    );
    const resultB = await executor(
      makeInput(
        { parsedInput, writerOutput },
        makeNode(),
        makeContext("session-B", "world-B", "t1"),
      ),
    );

    const eventA = resultA.outputs.memoryEvent as Record<string, unknown>;
    const eventB = resultB.outputs.memoryEvent as Record<string, unknown>;

    expect(eventA.sessionId).toBe("session-A");
    expect(eventA.worldId).toBe("world-A");
    expect(eventB.sessionId).toBe("session-B");
    expect(eventB.worldId).toBe("world-B");
  });
});
