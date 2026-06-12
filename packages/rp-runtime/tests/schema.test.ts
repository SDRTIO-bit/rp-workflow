import { describe, expect, it } from "vitest";
import { schemaValidators, validateSchema } from "../src/schemas.js";

describe("schema validators", () => {
  it("validates rp.parsed-input.v1", () => {
    const validator = schemaValidators["rp.parsed-input.v1"];
    expect(validator).toBeDefined();

    const valid = {
      rawText: "test input",
      actions: ["walk"],
      dialogues: [{ speaker: "Alice", text: "Hello" }],
      intents: ["greet"],
      entities: { characters: ["Alice"], locations: [], items: [], timeHints: [] },
      parsedAt: "2024-01-01T00:00:00Z",
    };
    expect(validator.validate(valid).valid).toBe(true);
  });

  it("rejects invalid parsed-input", () => {
    const validator = schemaValidators["rp.parsed-input.v1"];
    expect(validator.validate({}).valid).toBe(false);
    expect(validator.validate("string").valid).toBe(false);
    expect(validator.validate(null).valid).toBe(false);
  });

  it("validates rp.timeline-context.v1", () => {
    const validator = schemaValidators["rp.timeline-context.v1"];
    const valid = {
      chapters: [],
      relevantEvents: [],
      totalChapters: 0,
      queryTimeMs: 10,
    };
    expect(validator.validate(valid).valid).toBe(true);
  });

  it("validates rp.lore-context.v1", () => {
    const validator = schemaValidators["rp.lore-context.v1"];
    const valid = {
      entries: [],
      activatedBy: [],
      totalEntries: 0,
    };
    expect(validator.validate(valid).valid).toBe(true);
  });

  it("validates rp.tracker-state.v1", () => {
    const validator = schemaValidators["rp.tracker-state.v1"];
    const valid = {
      sessionId: "s1",
      worldId: "w1",
      characters: [],
      locations: [],
      items: [],
      timeState: {},
      version: 0,
    };
    expect(validator.validate(valid).valid).toBe(true);
  });

  it("validates rp.tracker-patch.v1", () => {
    const validator = schemaValidators["rp.tracker-patch.v1"];
    const valid = {
      sessionId: "s1",
      worldId: "w1",
      sourceTurnId: "t1",
      operations: [],
      timestamp: "2024-01-01T00:00:00Z",
    };
    expect(validator.validate(valid).valid).toBe(true);
  });

  it("validates rp.memory-event.v1", () => {
    const validator = schemaValidators["rp.memory-event.v1"];
    const valid = {
      eventId: "e1",
      sessionId: "s1",
      worldId: "w1",
      chapterId: "c1",
      sourceTurnId: "t1",
      summary: "something happened",
      characters: [],
      locations: [],
      items: [],
      time: null,
      emotionalChanges: [],
      createdAt: "2024-01-01T00:00:00Z",
    };
    expect(validator.validate(valid).valid).toBe(true);
  });

  it("validates rp.assembled-context.v1", () => {
    const validator = schemaValidators["rp.assembled-context.v1"];
    const valid = {
      systemPrompt: "",
      loreSection: "",
      timelineSection: "",
      trackerSection: "",
      recentMessagesSection: "",
      userInputSection: "",
      fullContext: "",
    };
    expect(validator.validate(valid).valid).toBe(true);
  });

  it("validates rp.budget-report.v1", () => {
    const validator = schemaValidators["rp.budget-report.v1"];
    const valid = {
      targetTokens: 3000,
      hardLimitTokens: 4000,
      allocated: {},
      actual: {},
      truncatedSections: [],
      droppedSections: [],
      tokenEstimationMethod: "character_ratio",
      warnings: [],
    };
    expect(validator.validate(valid).valid).toBe(true);
  });

  it("validates rp.writer-output.v1", () => {
    const validator = schemaValidators["rp.writer-output.v1"];
    const valid = {
      text: "narrative text",
      generationMode: "llm",
      metadata: { model: "mock", tokenUsage: { input: 100, output: 50 }, latencyMs: 10 },
    };
    expect(validator.validate(valid).valid).toBe(true);
  });

  it("validateSchema throws on unknown schema", () => {
    expect(() => validateSchema("unknown.schema", {})).toThrow("Unknown schema");
  });

  it("validateSchema throws on invalid data", () => {
    expect(() => validateSchema("rp.parsed-input.v1", {})).toThrow("Schema validation failed");
  });

  it("validateSchema passes on valid data", () => {
    expect(() =>
      validateSchema("rp.parsed-input.v1", {
        rawText: "test",
        actions: [],
        dialogues: [],
        intents: [],
        entities: { characters: [], locations: [], items: [], timeHints: [] },
        parsedAt: "2024-01-01T00:00:00Z",
      }),
    ).not.toThrow();
  });
});
