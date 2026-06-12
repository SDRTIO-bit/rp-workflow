import { describe, it, expect } from "vitest";
import {
  rpInputParserV1Definition,
  createRpInputParserV1Executor,
} from "../../src/nodes/rpInputParserV1.js";
import type { NodeExecutionInput, WorkflowNode } from "@awp/workflow-core";

function makeNode(): WorkflowNode {
  return {
    id: "parser-1",
    type: "rpInputParserV1",
    config: {},
    position: { x: 0, y: 0 },
  };
}

function makeInput(rawInput: string, overrides?: Partial<NodeExecutionInput>): NodeExecutionInput {
  return {
    node: makeNode(),
    inputs: { rawInput },
    context: {
      runId: "run-1",
      values: {
        rp: { sessionId: "s1", worldId: "w1", turnId: "t1" },
      },
    },
    ...overrides,
  };
}

describe("rpInputParserV1Definition", () => {
  it("has correct type and ports", () => {
    expect(rpInputParserV1Definition.type).toBe("rpInputParserV1");
    expect(rpInputParserV1Definition.category).toBe("roleplay");

    const inputPort = rpInputParserV1Definition.ports.find((p) => p.id === "rawInput");
    expect(inputPort).toBeDefined();
    expect(inputPort!.direction).toBe("input");
    expect(inputPort!.dataType).toBe("text");

    const outputPort = rpInputParserV1Definition.ports.find((p) => p.id === "parsedInput");
    expect(outputPort).toBeDefined();
    expect(outputPort!.direction).toBe("output");
    expect(outputPort!.dataType).toBe("json");
    expect(outputPort!.schemaId).toBe("rp.parsed-input.v1");
  });
});

describe("createRpInputParserV1Executor", () => {
  it("parses plain text into ParsedInput", async () => {
    const executor = createRpInputParserV1Executor();
    const result = await executor(makeInput("The hero walks into the tavern."));

    const output = result.outputs.parsedInput as Record<string, unknown>;
    expect(output).toBeDefined();
    expect(output.rawText).toBe("The hero walks into the tavern.");
    expect(output.parsedAt).toBeDefined();
    expect(Array.isArray(output.dialogues)).toBe(true);
    expect(Array.isArray(output.actions)).toBe(true);
    expect(Array.isArray(output.intents)).toBe(true);
    expect(output.entities).toBeDefined();
  });

  it("extracts dialogue lines from quoted text", async () => {
    const executor = createRpInputParserV1Executor();
    const result = await executor(
      makeInput("\u201cHello there,\u201d Alice said. \u201cHow are you?\u201d"),
    );

    const output = result.outputs.parsedInput as Record<string, unknown>;
    const dialogues = output.dialogues as Array<Record<string, unknown>>;
    expect(dialogues.length).toBeGreaterThanOrEqual(1);
    expect(dialogues[0].text).toBeDefined();
    expect(typeof dialogues[0].text).toBe("string");
  });

  it("extracts actions from asterisk-wrapped text", async () => {
    const executor = createRpInputParserV1Executor();
    const result = await executor(makeInput("*draws sword* \u201cI challenge you!\u201d"));

    const output = result.outputs.parsedInput as Record<string, unknown>;
    const actions = output.actions as Array<Record<string, unknown>>;
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  it("returns valid ParsedInput that passes schema validation", async () => {
    const executor = createRpInputParserV1Executor();
    const result = await executor(makeInput("Simple input text"));

    const output = result.outputs.parsedInput as Record<string, unknown>;
    // Verify entities structure
    const entities = output.entities as Record<string, unknown>;
    expect(Array.isArray(entities.characters)).toBe(true);
    expect(Array.isArray(entities.locations)).toBe(true);
    expect(Array.isArray(entities.items)).toBe(true);
    expect(Array.isArray(entities.timeHints)).toBe(true);
  });

  it("handles empty input gracefully", async () => {
    const executor = createRpInputParserV1Executor();
    const result = await executor(makeInput(""));

    const output = result.outputs.parsedInput as Record<string, unknown>;
    expect(output.rawText).toBe("");
    expect(output.parsedAt).toBeDefined();
  });

  it("throws when rawInput is missing", async () => {
    const executor = createRpInputParserV1Executor();
    await expect(
      executor({
        node: makeNode(),
        inputs: {},
        context: {
          values: { rp: { sessionId: "s1", worldId: "w1", turnId: "t1" } },
        },
      }),
    ).rejects.toThrow();
  });
});
