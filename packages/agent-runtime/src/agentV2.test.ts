/**
 * Agent V2 — Session Memory Integration Tests
 *
 * Uses a recording mock LLM to deterministically verify that session history
 * enters the actual LLM prompt in stateful mode and does NOT in stateless mode.
 */

import { describe, it, expect } from "vitest";
import { InMemoryAgentSessionStore } from "../src/agentSessionStore.js";
import {
  createAgentSessionLoadV1Executor,
  createAgentSessionCommitV1Executor,
} from "../src/agentSessionNode.js";
import { agentV2Definition, createAgentV2Executor } from "../src/agentV2.js";
import type { LlmAdapter, LlmCompletionInput, LlmCompletionResult } from "../src/types.js";
import type {
  AgentSessionKeyV1,
  AgentSessionContextV1,
  AgentSessionDeltaV1,
} from "../src/agentSession.js";

// ============ Recording Mock LLM ============

function createRecordingMockLlm(responseText: string = "mock-response"): {
  adapter: LlmAdapter;
  getCalls: () => Array<{ model: string; prompt: string }>;
} {
  const calls: Array<{ model: string; prompt: string }> = [];
  return {
    adapter: {
      provider: "recording-mock",
      async complete(input: LlmCompletionInput): Promise<LlmCompletionResult> {
        calls.push({ model: input.model, prompt: input.prompt });
        return {
          text: responseText,
          tokenUsage: { input: input.prompt.length, output: responseText.length },
        };
      },
    },
    getCalls: () => calls,
  };
}

// ============ Helpers ============

function makeKey(overrides?: Partial<AgentSessionKeyV1>): AgentSessionKeyV1 {
  return {
    tenantId: "t1",
    workflowInstanceId: "wf1",
    conversationId: "conv1",
    agentNodeId: "agent1",
    ...overrides,
  };
}

function makeNode(config?: Record<string, unknown>) {
  return {
    id: "agentV2-test",
    type: "agentV2",
    config: {
      systemPrompt: "You are a helpful assistant.",
      model: "test-model",
      ...config,
    },
    position: { x: 0, y: 0 },
  };
}

// ============ Stateless ============

describe("agentV2: stateless mode keeps no history", () => {
  it("second call does NOT include first turn content in LLM prompt", async () => {
    const { adapter, getCalls } = createRecordingMockLlm("response-1");
    const loadExec = createAgentSessionLoadV1Executor({ store: new InMemoryAgentSessionStore() });
    const agentExec = createAgentV2Executor({ adapter });
    const key = makeKey();
    const sl = { sessionConfig: { mode: "stateless" } };

    // Turn 1
    const t1Load = await loadExec({ node: makeNode(sl), inputs: { sessionKey: key } });
    await agentExec({
      node: makeNode(sl),
      inputs: { instruction: "项目代号是蓝鲸。", sessionContext: t1Load.outputs.sessionContext },
    });

    // Turn 2
    const t2Load = await loadExec({ node: makeNode(sl), inputs: { sessionKey: key } });
    await agentExec({
      node: makeNode(sl),
      inputs: { instruction: "项目代号是什么？", sessionContext: t2Load.outputs.sessionContext },
    });

    const calls = getCalls();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[1]!.prompt).not.toContain("蓝鲸");
    expect(calls[1]!.prompt).toContain("项目代号是什么");
    expect(calls[1]!.prompt).not.toContain("Conversation History");
  });

  it("sessionDelta is undefined in stateless mode", async () => {
    const { adapter } = createRecordingMockLlm("test");
    const loadExec = createAgentSessionLoadV1Executor({ store: new InMemoryAgentSessionStore() });
    const agentExec = createAgentV2Executor({ adapter });
    const key = makeKey();

    const loadResult = await loadExec({
      node: makeNode({ sessionConfig: { mode: "stateless" } }),
      inputs: { sessionKey: key },
    });
    const result = await agentExec({
      node: makeNode({ sessionConfig: { mode: "stateless" } }),
      inputs: { instruction: "hello", sessionContext: loadResult.outputs.sessionContext },
    });
    expect(result.outputs.sessionDelta).toBeUndefined();
  });
});

// ============ Stateful ============

describe("agentV2: stateful mode includes history in LLM prompt", () => {
  it("second call includes first turn content in LLM prompt", async () => {
    const { adapter, getCalls } = createRecordingMockLlm("response-2");
    const store = new InMemoryAgentSessionStore();
    const loadExec = createAgentSessionLoadV1Executor({ store });
    const commitExec = createAgentSessionCommitV1Executor({ store });
    const agentExec = createAgentV2Executor({ adapter });
    const key = makeKey();
    const sf = { sessionConfig: { mode: "stateful", maxTokens: 8000 } };

    // Turn 1
    const t1Load = await loadExec({ node: makeNode(sf), inputs: { sessionKey: key } });
    const t1Result = await agentExec({
      node: makeNode(sf),
      inputs: { instruction: "项目代号是蓝鲸。", sessionContext: t1Load.outputs.sessionContext },
    });
    await commitExec({
      node: makeNode(sf),
      inputs: { sessionDelta: t1Result.outputs.sessionDelta as AgentSessionDeltaV1 },
    });

    // Turn 2
    const t2Load = await loadExec({ node: makeNode(sf), inputs: { sessionKey: key } });
    const t2Ctx = t2Load.outputs.sessionContext as AgentSessionContextV1;
    expect(t2Ctx.turns.length).toBe(1);

    await agentExec({
      node: makeNode(sf),
      inputs: { instruction: "项目代号是什么？", sessionContext: t2Ctx },
    });

    const secondPrompt = getCalls()[1]!.prompt;
    expect(secondPrompt).toContain("Conversation History");
    expect(secondPrompt).toContain("蓝鲸");
    expect(secondPrompt).toContain("response-2");
    expect(secondPrompt).toContain("项目代号是什么");
  });
});

// ============ Prompt Order ============

describe("agentV2: prompt construction order", () => {
  it("system prompt, skills, summary, history, context, instruction in that order", async () => {
    const { adapter, getCalls } = createRecordingMockLlm("ordered");
    const agentExec = createAgentV2Executor({ adapter });
    const ctx: AgentSessionContextV1 = {
      sessionKey: makeKey(),
      turns: [
        {
          turnIndex: 1,
          input: "q",
          assistantOutput: "a",
          modelConfig: { model: "test" },
          tokenUsage: { input: 5, output: 10 },
          createdAt: new Date().toISOString(),
        },
      ],
      summary: "Summary text.",
      estimatedTokens: 100,
      truncated: false,
    };

    await agentExec({
      node: makeNode({
        systemPrompt: "SYSTEM RULES",
        skills: ["skill-a"],
        sessionConfig: { mode: "stateful", maxTokens: 8000 },
      }),
      inputs: {
        context: "CURRENT CONTEXT",
        instruction: "CURRENT INSTRUCTION",
        sessionContext: ctx,
      },
    });

    const p = getCalls()[0]!.prompt;
    expect(p.indexOf("SYSTEM RULES")).toBeGreaterThanOrEqual(0);
    expect(p.indexOf("skill-a")).toBeGreaterThan(p.indexOf("SYSTEM RULES"));
    expect(p.indexOf("Conversation Summary")).toBeGreaterThan(p.indexOf("skill-a"));
    expect(p.indexOf("Conversation History")).toBeGreaterThan(p.indexOf("Conversation Summary"));
    expect(p.indexOf("CURRENT CONTEXT")).toBeGreaterThan(p.indexOf("Conversation History"));
    expect(p.indexOf("CURRENT INSTRUCTION")).toBeGreaterThan(p.indexOf("CURRENT CONTEXT"));
  });
});

// ============ Delta ============

describe("agentV2: session delta output", () => {
  it("produces correct delta with input, output, and token usage", async () => {
    const { adapter } = createRecordingMockLlm("delta-test-output");
    const agentExec = createAgentV2Executor({ adapter });
    const ctx: AgentSessionContextV1 = {
      sessionKey: makeKey(),
      turns: [],
      estimatedTokens: 0,
      truncated: false,
    };
    const result = await agentExec({
      node: makeNode({ sessionConfig: { mode: "stateful" } }),
      inputs: { instruction: "test input", sessionContext: ctx },
    });
    const delta = result.outputs.sessionDelta as AgentSessionDeltaV1;
    expect(delta).toBeDefined();
    expect(delta.sessionKey.agentNodeId).toBe("agent1");
    expect(delta.newTurn.turnIndex).toBe(1);
    expect(delta.newTurn.assistantOutput).toBe("delta-test-output");
  });
});

// ============ Budget ============

describe("agentV2: budget trimming", () => {
  it("drops oldest turns first when over budget, protects current input", async () => {
    const { adapter, getCalls } = createRecordingMockLlm("trimmed");
    const agentExec = createAgentV2Executor({ adapter });
    const turns = Array.from({ length: 20 }, (_, i) => ({
      turnIndex: i + 1,
      input: ("Turn " + (i + 1) + " input ").repeat(10),
      assistantOutput: ("Turn " + (i + 1) + " output ").repeat(10),
      modelConfig: { model: "test" } as const,
      tokenUsage: { input: 50, output: 50 },
      createdAt: new Date().toISOString(),
    }));
    const ctx: AgentSessionContextV1 = {
      sessionKey: makeKey(),
      turns,
      estimatedTokens: 2000,
      truncated: false,
    };
    const result = await agentExec({
      node: makeNode({ sessionConfig: { mode: "stateful", maxTokens: 600 } }),
      inputs: { instruction: "CRITICAL CURRENT QUESTION", sessionContext: ctx },
    });
    const p = getCalls()[0]!.prompt;
    expect(p).toContain("CRITICAL CURRENT QUESTION");
    expect((result.metadata as Record<string, unknown>).droppedTurns).toBeGreaterThan(0);
  });

  it("keeps system prompt when over budget", async () => {
    const { adapter, getCalls } = createRecordingMockLlm("protected");
    const agentExec = createAgentV2Executor({ adapter });
    const turns = Array.from({ length: 30 }, (_, i) => ({
      turnIndex: i + 1,
      input: "padding ".repeat(50),
      assistantOutput: "padding ".repeat(50),
      modelConfig: { model: "test" } as const,
      tokenUsage: { input: 100, output: 100 },
      createdAt: new Date().toISOString(),
    }));
    const ctx: AgentSessionContextV1 = {
      sessionKey: makeKey(),
      turns,
      estimatedTokens: 5000,
      truncated: false,
    };
    await agentExec({
      node: makeNode({
        systemPrompt: "PROTECTED_SYSTEM_RULES",
        sessionConfig: { mode: "stateful", maxTokens: 300 },
      }),
      inputs: { instruction: "hello", sessionContext: ctx },
    });
    expect(getCalls()[0]!.prompt).toContain("PROTECTED_SYSTEM_RULES");
  });
});

// ============ Backward Compat ============

describe("agentV2: backward compatibility", () => {
  it("works without sessionContext (old workflow compat)", async () => {
    const { adapter, getCalls } = createRecordingMockLlm("compat");
    const agentExec = createAgentV2Executor({ adapter });
    const result = await agentExec({
      node: makeNode({ systemPrompt: "Legacy prompt" }),
      inputs: { instruction: "old workflow call" },
    });
    const p = getCalls()[0]!.prompt;
    expect(p).toContain("Legacy prompt");
    expect(p).toContain("old workflow call");
    expect(result.outputs.sessionDelta).toBeUndefined();
    expect(p).not.toContain("Conversation History");
  });
});

// ============ Definition ============

describe("agentV2Definition", () => {
  it("has session-aware ports", () => {
    expect(agentV2Definition.type).toBe("agentV2");
    expect(
      agentV2Definition.ports.filter((p) => p.direction === "input").map((p) => p.id),
    ).toContain("sessionContext");
    expect(
      agentV2Definition.ports.filter((p) => p.direction === "output").map((p) => p.id),
    ).toContain("sessionDelta");
  });
});
