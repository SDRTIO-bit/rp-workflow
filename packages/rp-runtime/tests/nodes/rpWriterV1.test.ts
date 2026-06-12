import { describe, it, expect } from "vitest";
import { rpWriterV1Definition, createRpWriterV1Executor } from "../../src/nodes/rpWriterV1.js";
import type { NodeExecutionInput, WorkflowNode } from "@awp/workflow-core";
import type { AssembledContext } from "../../src/types.js";

function makeNode(): WorkflowNode {
  return {
    id: "writer-1",
    type: "rpWriterV1",
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

function makeAssembledContext(overrides?: Partial<AssembledContext>): AssembledContext {
  return {
    systemPrompt: "You are a creative writing assistant.",
    loreSection: "[World Lore]\n- Tavern: A cozy place",
    timelineSection: "[Timeline]\nChapter 1: The Beginning",
    trackerSection: "[State]\nCharacters: Alice",
    recentMessagesSection: "",
    userInputSection: "[User Input]\nThe hero enters the tavern.",
    fullContext:
      "You are a creative writing assistant.\n\n[World Lore]\n- Tavern: A cozy place\n\n[Timeline]\nChapter 1: The Beginning\n\n[State]\nCharacters: Alice\n\n[User Input]\nThe hero enters the tavern.",
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

describe("rpWriterV1Definition", () => {
  it("has correct type, category, and ports", () => {
    expect(rpWriterV1Definition.type).toBe("rpWriterV1");
    expect(rpWriterV1Definition.category).toBe("roleplay");

    const inputPort = rpWriterV1Definition.ports.find((p) => p.id === "assembledContext");
    expect(inputPort).toBeDefined();
    expect(inputPort!.direction).toBe("input");
    expect(inputPort!.dataType).toBe("json");
    expect(inputPort!.schemaId).toBe("rp.assembled-context.v1");

    const outputPort = rpWriterV1Definition.ports.find((p) => p.id === "writerOutput");
    expect(outputPort).toBeDefined();
    expect(outputPort!.direction).toBe("output");
    expect(outputPort!.dataType).toBe("json");
    expect(outputPort!.schemaId).toBe("rp.writer-output.v1");
  });
});

describe("createRpWriterV1Executor", () => {
  it("generates output with generationMode='llm' when LLM adapter succeeds", async () => {
    const mockAdapter = {
      complete: async (_prompt: string) => ({
        text: "The tavern door creaks open as the hero steps inside...",
        tokenUsage: { prompt: 100, completion: 20 },
      }),
    };

    const executor = createRpWriterV1Executor({ llmAdapter: mockAdapter });
    const assembledContext = makeAssembledContext();

    const result = await executor(makeInput({ assembledContext }));

    const output = result.outputs.writerOutput as Record<string, unknown>;
    expect(output).toBeDefined();
    expect(output.generationMode).toBe("llm");
    expect(output.text).toBe("The tavern door creaks open as the hero steps inside...");
    expect(output.warnings).toBeUndefined();

    const metadata = output.metadata as Record<string, unknown>;
    expect(typeof metadata.model).toBe("string");
    expect(typeof metadata.tokenUsage).toBe("object");
    expect(typeof metadata.latencyMs).toBe("number");
  });

  it("falls back to echo mode with generationMode='echo_fallback' and warnings when no LLM adapter", async () => {
    const executor = createRpWriterV1Executor();
    const assembledContext = makeAssembledContext();

    const result = await executor(makeInput({ assembledContext }));

    const output = result.outputs.writerOutput as Record<string, unknown>;
    expect(output).toBeDefined();
    expect(output.generationMode).toBe("echo_fallback");
    expect(typeof output.text).toBe("string");
    expect(output.text).toContain("The hero enters the tavern.");

    const warnings = output.warnings as string[];
    expect(Array.isArray(warnings)).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("No LLM adapter");
  });

  it("throws when fallback is disabled and no LLM adapter", async () => {
    const executor = createRpWriterV1Executor({
      config: { enableEchoFallback: false },
    });
    const assembledContext = makeAssembledContext();

    await expect(executor(makeInput({ assembledContext }))).rejects.toThrow(
      "No LLM adapter configured and echo fallback is disabled",
    );
  });

  it("throws when LLM fails and fallback is disabled", async () => {
    const failingAdapter = {
      complete: async () => {
        throw new Error("LLM service unavailable");
      },
    };

    const executor = createRpWriterV1Executor({
      llmAdapter: failingAdapter,
      config: { enableEchoFallback: false },
    });
    const assembledContext = makeAssembledContext();

    await expect(executor(makeInput({ assembledContext }))).rejects.toThrow(
      "LLM adapter failed and fallback is disabled",
    );
  });

  it("falls back to echo when LLM fails and fallback is enabled", async () => {
    const failingAdapter = {
      complete: async () => {
        throw new Error("LLM service unavailable");
      },
    };

    const executor = createRpWriterV1Executor({
      llmAdapter: failingAdapter,
      config: { enableEchoFallback: true },
    });
    const assembledContext = makeAssembledContext();

    const result = await executor(makeInput({ assembledContext }));

    const output = result.outputs.writerOutput as Record<string, unknown>;
    expect(output.generationMode).toBe("echo_fallback");

    const warnings = output.warnings as string[];
    expect(warnings[0]).toContain("LLM adapter failed");
  });

  it("passes fullContext to LLM adapter", async () => {
    let receivedPrompt = "";
    const mockAdapter = {
      complete: async (prompt: string) => {
        receivedPrompt = prompt;
        return {
          text: "Generated text",
          tokenUsage: { prompt: 50, completion: 10 },
        };
      },
    };

    const executor = createRpWriterV1Executor({ llmAdapter: mockAdapter });
    const assembledContext = makeAssembledContext();

    await executor(makeInput({ assembledContext }));

    expect(receivedPrompt).toContain("creative writing assistant");
    expect(receivedPrompt).toContain("The hero enters the tavern.");
  });

  it("produces valid WriterOutput with correct tokenUsage field names", async () => {
    const mockAdapter = {
      complete: async () => ({
        text: "Some generated text.",
        tokenUsage: { prompt: 10, completion: 5 },
      }),
    };

    const executor = createRpWriterV1Executor({ llmAdapter: mockAdapter });
    const assembledContext = makeAssembledContext();

    const result = await executor(makeInput({ assembledContext }));

    const output = result.outputs.writerOutput as Record<string, unknown>;
    const metadata = output.metadata as Record<string, unknown>;
    const tokenUsage = metadata.tokenUsage as Record<string, unknown>;

    expect(typeof tokenUsage.input).toBe("number");
    expect(typeof tokenUsage.output).toBe("number");
  });

  it("throws when assembledContext is missing", async () => {
    const executor = createRpWriterV1Executor();
    await expect(executor(makeInput({}))).rejects.toThrow();
  });

  it("records latency in metadata", async () => {
    const mockAdapter = {
      complete: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return {
          text: "Text",
          tokenUsage: { prompt: 1, completion: 1 },
        };
      },
    };

    const executor = createRpWriterV1Executor({ llmAdapter: mockAdapter });
    const assembledContext = makeAssembledContext();

    const result = await executor(makeInput({ assembledContext }));

    const output = result.outputs.writerOutput as Record<string, unknown>;
    const metadata = output.metadata as Record<string, unknown>;
    expect(metadata.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
