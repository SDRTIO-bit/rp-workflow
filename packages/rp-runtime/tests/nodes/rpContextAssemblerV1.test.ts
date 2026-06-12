import { describe, it, expect } from "vitest";
import {
  rpContextAssemblerV1Definition,
  createRpContextAssemblerV1Executor,
} from "../../src/nodes/rpContextAssemblerV1.js";
import type { NodeExecutionInput, WorkflowNode } from "@awp/workflow-core";

function makeNode(): WorkflowNode {
  return {
    id: "assembler-1",
    type: "rpContextAssemblerV1",
    config: {},
    position: { x: 0, y: 0 },
  };
}

function makeContext() {
  return {
    runId: "run-1",
    values: {
      rp: { sessionId: "s1", worldId: "w1", turnId: "t1" },
    },
  };
}

function makeParsedInput(overrides?: Record<string, unknown>) {
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

function makeInput(
  inputs: Record<string, unknown>,
  overrides?: Partial<NodeExecutionInput>,
): NodeExecutionInput {
  return {
    node: makeNode(),
    inputs,
    context: makeContext(),
    ...overrides,
  };
}

describe("rpContextAssemblerV1Definition", () => {
  it("has correct type, category, and ports", () => {
    expect(rpContextAssemblerV1Definition.type).toBe("rpContextAssemblerV1");
    expect(rpContextAssemblerV1Definition.category).toBe("roleplay");

    const inputPortIds = rpContextAssemblerV1Definition.ports
      .filter((p) => p.direction === "input")
      .map((p) => p.id);
    expect(inputPortIds).toContain("parsedInput");
    expect(inputPortIds).toContain("timelineContext");
    expect(inputPortIds).toContain("loreContext");
    expect(inputPortIds).toContain("trackerState");

    const outputPortIds = rpContextAssemblerV1Definition.ports
      .filter((p) => p.direction === "output")
      .map((p) => p.id);
    expect(outputPortIds).toContain("assembledContext");
    expect(outputPortIds).toContain("budgetReport");

    // Verify schemaIds on json ports
    const assembledPort = rpContextAssemblerV1Definition.ports.find(
      (p) => p.id === "assembledContext",
    );
    expect(assembledPort!.dataType).toBe("json");
    expect(assembledPort!.schemaId).toBe("rp.assembled-context.v1");

    const budgetPort = rpContextAssemblerV1Definition.ports.find((p) => p.id === "budgetReport");
    expect(budgetPort!.dataType).toBe("json");
    expect(budgetPort!.schemaId).toBe("rp.budget-report.v1");
  });
});

describe("createRpContextAssemblerV1Executor", () => {
  it("assembles context with only parsedInput (optional inputs absent)", async () => {
    const executor = createRpContextAssemblerV1Executor();
    const parsedInput = makeParsedInput();

    const result = await executor(makeInput({ parsedInput }));

    const assembled = result.outputs.assembledContext as Record<string, unknown>;
    expect(assembled).toBeDefined();
    expect(typeof assembled.systemPrompt).toBe("string");
    expect(typeof assembled.loreSection).toBe("string");
    expect(typeof assembled.timelineSection).toBe("string");
    expect(typeof assembled.trackerSection).toBe("string");
    expect(typeof assembled.recentMessagesSection).toBe("string");
    expect(typeof assembled.userInputSection).toBe("string");
    expect(typeof assembled.fullContext).toBe("string");

    // fullContext should contain userInputSection content
    expect(assembled.fullContext).toContain("The hero enters the tavern.");
  });

  it("includes timeline context when provided", async () => {
    const executor = createRpContextAssemblerV1Executor();
    const parsedInput = makeParsedInput();
    const timelineContext = {
      chapters: [
        {
          chapterId: "ch-1",
          title: "Chapter 1",
          summary: "The adventure begins",
          eventCount: 5,
        },
      ],
      relevantEvents: [],
      totalChapters: 1,
      queryTimeMs: 10,
    };

    const result = await executor(makeInput({ parsedInput, timelineContext }));

    const assembled = result.outputs.assembledContext as Record<string, unknown>;
    expect(assembled.timelineSection).toContain("ch-1");
    expect(assembled.fullContext).toContain("adventure begins");
  });

  it("includes lore context when provided", async () => {
    const executor = createRpContextAssemblerV1Executor();
    const parsedInput = makeParsedInput();
    const loreContext = {
      entries: [
        {
          id: "lore-1",
          sessionId: "s1",
          worldId: "w1",
          title: "Tavern Rules",
          content: "No weapons allowed inside",
          keywords: ["tavern"],
          category: "location",
          activationMode: "triggered",
          priority: 1,
        },
      ],
      activatedBy: ["tavern"],
      totalEntries: 1,
    };

    const result = await executor(makeInput({ parsedInput, loreContext }));

    const assembled = result.outputs.assembledContext as Record<string, unknown>;
    expect(assembled.loreSection).toContain("Tavern Rules");
    expect(assembled.fullContext).toContain("No weapons allowed");
  });

  it("includes tracker state when provided", async () => {
    const executor = createRpContextAssemblerV1Executor();
    const parsedInput = makeParsedInput();
    const trackerState = {
      sessionId: "s1",
      worldId: "w1",
      characters: [
        {
          id: "char-1",
          name: "Alice",
          description: "A brave warrior",
          status: "active",
          attributes: {},
        },
      ],
      locations: [],
      items: [],
      timeState: { currentTime: "evening", dayCount: 1 },
      version: 1,
    };

    const result = await executor(makeInput({ parsedInput, trackerState }));

    const assembled = result.outputs.assembledContext as Record<string, unknown>;
    expect(assembled.trackerSection).toContain("Alice");
    expect(assembled.fullContext).toContain("Alice");
  });

  it("produces a valid budgetReport with new fields", async () => {
    const executor = createRpContextAssemblerV1Executor();
    const parsedInput = makeParsedInput();

    const result = await executor(makeInput({ parsedInput }));

    const budget = result.outputs.budgetReport as Record<string, unknown>;
    expect(budget).toBeDefined();
    expect(typeof budget.targetTokens).toBe("number");
    expect(typeof budget.hardLimitTokens).toBe("number");
    expect(typeof budget.allocated).toBe("object");
    expect(typeof budget.actual).toBe("object");
    expect(Array.isArray(budget.truncatedSections)).toBe(true);
    expect(Array.isArray(budget.droppedSections)).toBe(true);
    expect(budget.tokenEstimationMethod).toBe("character_ratio");
    expect(Array.isArray(budget.warnings)).toBe(true);
  });

  it("throws when parsedInput is missing", async () => {
    const executor = createRpContextAssemblerV1Executor();
    await expect(executor(makeInput({}))).rejects.toThrow();
  });

  it("respects targetTokens config and truncates when exceeded", async () => {
    const executor = createRpContextAssemblerV1Executor({
      config: { targetTokens: 50, hardLimitTokens: 100, charsPerToken: 4 },
    });

    // Create a large lore context to trigger truncation
    const parsedInput = makeParsedInput();
    const largeLore = {
      entries: Array.from({ length: 20 }, (_, i) => ({
        id: `lore-${i}`,
        sessionId: "s1",
        worldId: "w1",
        title: `Lore Entry ${i} with a very long title that takes up space`,
        content: "A".repeat(200),
        keywords: [],
        category: "custom" as const,
        activationMode: "always_on" as const,
        priority: 1,
      })),
      activatedBy: [],
      totalEntries: 20,
    };

    const result = await executor(makeInput({ parsedInput, loreContext: largeLore }));

    const budget = result.outputs.budgetReport as Record<string, unknown>;
    const truncatedSections = budget.truncatedSections as string[];
    const droppedSections = budget.droppedSections as string[];

    // Should have truncated or dropped some sections
    expect(truncatedSections.length + droppedSections.length).toBeGreaterThan(0);

    // User input should never be dropped
    expect(droppedSections).not.toContain("userInputSection");
  });

  it("never drops userInputSection even when over budget", async () => {
    const executor = createRpContextAssemblerV1Executor({
      config: { targetTokens: 10, hardLimitTokens: 20, charsPerToken: 4 },
    });

    const parsedInput = makeParsedInput({
      rawText:
        "This is a very long user input that should never be truncated or dropped no matter what.",
    });

    const result = await executor(makeInput({ parsedInput }));

    const assembled = result.outputs.assembledContext as Record<string, unknown>;
    const budget = result.outputs.budgetReport as Record<string, unknown>;
    const droppedSections = budget.droppedSections as string[];

    // User input section should still contain the original text (possibly truncated but not dropped)
    expect(assembled.userInputSection).toContain("This is a very long user input");
    expect(droppedSections).not.toContain("userInputSection");
  });

  it("uses custom charsPerToken for estimation", async () => {
    const executor = createRpContextAssemblerV1Executor({
      config: { charsPerToken: 2 }, // 2 chars per token = more tokens estimated
    });

    const parsedInput = makeParsedInput();
    const result = await executor(makeInput({ parsedInput }));

    const budget = result.outputs.budgetReport as Record<string, unknown>;
    expect(budget.tokenEstimationMethod).toBe("character_ratio");

    const actual = budget.actual as Record<string, unknown>;
    expect(typeof actual.total).toBe("number");
  });
});
