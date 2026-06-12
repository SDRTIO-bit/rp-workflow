import { describe, it, expect } from "vitest";
import {
  rpTrackerUpdateV1Definition,
  createRpTrackerUpdateV1Executor,
} from "../../src/nodes/rpTrackerUpdateV1.js";
import type { NodeExecutionInput, WorkflowNode } from "@awp/workflow-core";
import type { ParsedInput, TrackerState } from "../../src/types.js";

function makeNode(): WorkflowNode {
  return {
    id: "tracker-update-1",
    type: "rpTrackerUpdateV1",
    config: {},
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

function makeTrackerState(overrides?: Partial<TrackerState>): TrackerState {
  return {
    sessionId: "s1",
    worldId: "w1",
    characters: [],
    locations: [],
    items: [],
    timeState: {},
    version: 1,
    ...overrides,
  };
}

function makeInput(
  inputs: Record<string, unknown>,
  context = makeContext(),
  overrides?: Partial<NodeExecutionInput>,
): NodeExecutionInput {
  return {
    node: makeNode(),
    inputs,
    context,
    ...overrides,
  };
}

describe("rpTrackerUpdateV1Definition", () => {
  it("has correct type, category, and ports", () => {
    expect(rpTrackerUpdateV1Definition.type).toBe("rpTrackerUpdateV1");
    expect(rpTrackerUpdateV1Definition.category).toBe("roleplay");

    const inputPortIds = rpTrackerUpdateV1Definition.ports
      .filter((p) => p.direction === "input")
      .map((p) => p.id);
    expect(inputPortIds).toContain("parsedInput");
    expect(inputPortIds).toContain("currentState");

    const outputPortIds = rpTrackerUpdateV1Definition.ports
      .filter((p) => p.direction === "output")
      .map((p) => p.id);
    expect(outputPortIds).toContain("trackerPatch");

    const patchPort = rpTrackerUpdateV1Definition.ports.find((p) => p.id === "trackerPatch");
    expect(patchPort!.dataType).toBe("json");
    expect(patchPort!.schemaId).toBe("rp.tracker-patch.v1");
  });
});

describe("createRpTrackerUpdateV1Executor", () => {
  it("generates empty patch when no new entities", async () => {
    const executor = createRpTrackerUpdateV1Executor();
    const parsedInput = makeParsedInput();
    const currentState = makeTrackerState();

    const result = await executor(makeInput({ parsedInput, currentState }));

    const patch = result.outputs.trackerPatch as Record<string, unknown>;
    expect(patch).toBeDefined();
    expect(patch.sessionId).toBe("s1");
    expect(patch.worldId).toBe("w1");
    expect(patch.sourceTurnId).toBe("t1");
    expect(patch.operations).toEqual([]);
    expect(typeof patch.timestamp).toBe("string");
  });

  it("generates add operations for new characters", async () => {
    const executor = createRpTrackerUpdateV1Executor();
    const parsedInput = makeParsedInput({
      entities: { characters: ["Alice", "Bob"], locations: [], items: [], timeHints: [] },
    });
    const currentState = makeTrackerState();

    const result = await executor(makeInput({ parsedInput, currentState }));

    const patch = result.outputs.trackerPatch as Record<string, unknown>;
    const operations = patch.operations as Array<Record<string, unknown>>;
    expect(operations.length).toBe(2);
    expect(operations[0].type).toBe("add");
    expect(operations[0].target).toBe("characters");
    expect(operations[0].targetId).toBe("char-alice");
    expect(operations[1].targetId).toBe("char-bob");
  });

  it("does not add existing characters", async () => {
    const executor = createRpTrackerUpdateV1Executor();
    const parsedInput = makeParsedInput({
      entities: { characters: ["Alice"], locations: [], items: [], timeHints: [] },
    });
    const currentState = makeTrackerState({
      characters: [{ id: "char-alice", name: "Alice", relationships: {} }],
    });

    const result = await executor(makeInput({ parsedInput, currentState }));

    const patch = result.outputs.trackerPatch as Record<string, unknown>;
    const operations = patch.operations as Array<Record<string, unknown>>;
    expect(operations.length).toBe(0);
  });

  it("generates add operations for new locations", async () => {
    const executor = createRpTrackerUpdateV1Executor();
    const parsedInput = makeParsedInput({
      entities: { characters: [], locations: ["tavern", "forest"], items: [], timeHints: [] },
    });
    const currentState = makeTrackerState();

    const result = await executor(makeInput({ parsedInput, currentState }));

    const patch = result.outputs.trackerPatch as Record<string, unknown>;
    const operations = patch.operations as Array<Record<string, unknown>>;
    expect(operations.length).toBe(2);
    expect(operations[0].type).toBe("add");
    expect(operations[0].target).toBe("locations");
    expect(operations[0].targetId).toBe("loc-tavern");
  });

  it("generates add operations for new items", async () => {
    const executor = createRpTrackerUpdateV1Executor();
    const parsedInput = makeParsedInput({
      entities: { characters: [], locations: [], items: ["sword", "shield"], timeHints: [] },
    });
    const currentState = makeTrackerState();

    const result = await executor(makeInput({ parsedInput, currentState }));

    const patch = result.outputs.trackerPatch as Record<string, unknown>;
    const operations = patch.operations as Array<Record<string, unknown>>;
    expect(operations.length).toBe(2);
    expect(operations[0].type).toBe("add");
    expect(operations[0].target).toBe("items");
    expect(operations[0].targetId).toBe("item-sword");
  });

  it("generates update operation for time state", async () => {
    const executor = createRpTrackerUpdateV1Executor();
    const parsedInput = makeParsedInput({
      entities: { characters: [], locations: [], items: [], timeHints: ["evening"] },
    });
    const currentState = makeTrackerState();

    const result = await executor(makeInput({ parsedInput, currentState }));

    const patch = result.outputs.trackerPatch as Record<string, unknown>;
    const operations = patch.operations as Array<Record<string, unknown>>;
    expect(operations.length).toBe(1);
    expect(operations[0].type).toBe("update");
    expect(operations[0].target).toBe("timeState");
    expect(operations[0].field).toBe("currentTime");
    expect(operations[0].value).toBe("evening");
  });

  it("respects autoDetectCharacters=false config", async () => {
    const executor = createRpTrackerUpdateV1Executor({
      config: { autoDetectCharacters: false },
    });
    const parsedInput = makeParsedInput({
      entities: { characters: ["Alice"], locations: ["tavern"], items: [], timeHints: [] },
    });
    const currentState = makeTrackerState();

    const result = await executor(makeInput({ parsedInput, currentState }));

    const patch = result.outputs.trackerPatch as Record<string, unknown>;
    const operations = patch.operations as Array<Record<string, unknown>>;
    // Should only have location, not character
    expect(operations.length).toBe(1);
    expect(operations[0].target).toBe("locations");
  });

  it("respects autoDetectTime=false config", async () => {
    const executor = createRpTrackerUpdateV1Executor({
      config: { autoDetectTime: false },
    });
    const parsedInput = makeParsedInput({
      entities: { characters: [], locations: [], items: [], timeHints: ["evening"] },
    });
    const currentState = makeTrackerState();

    const result = await executor(makeInput({ parsedInput, currentState }));

    const patch = result.outputs.trackerPatch as Record<string, unknown>;
    const operations = patch.operations as Array<Record<string, unknown>>;
    expect(operations.length).toBe(0);
  });

  it("throws when parsedInput is missing", async () => {
    const executor = createRpTrackerUpdateV1Executor();
    const currentState = makeTrackerState();

    await expect(executor(makeInput({ currentState }))).rejects.toThrow("parsedInput is required");
  });

  it("throws when currentState is missing", async () => {
    const executor = createRpTrackerUpdateV1Executor();
    const parsedInput = makeParsedInput();

    await expect(executor(makeInput({ parsedInput }))).rejects.toThrow("currentState is required");
  });

  it("throws when context.values.rp is missing", async () => {
    const executor = createRpTrackerUpdateV1Executor();
    const parsedInput = makeParsedInput();
    const currentState = makeTrackerState();

    await expect(
      executor({
        node: makeNode(),
        inputs: { parsedInput, currentState },
        context: undefined,
      }),
    ).rejects.toThrow();
  });

  it("only outputs patch, not full state", async () => {
    const executor = createRpTrackerUpdateV1Executor();
    const parsedInput = makeParsedInput({
      entities: { characters: ["Alice"], locations: [], items: [], timeHints: [] },
    });
    const currentState = makeTrackerState();

    const result = await executor(makeInput({ parsedInput, currentState }));

    // Verify only trackerPatch is in outputs
    expect(result.outputs.trackerPatch).toBeDefined();
    expect(result.outputs.trackerState).toBeUndefined();
  });
});
