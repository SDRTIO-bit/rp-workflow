/**
 * Agent Session Last Assistant Output tests — P-15.2
 */
import { describe, it, expect } from "vitest";
import { extractLastAssistantOutput } from "./agentSessionLastAssistantOutput.js";
import type { AgentSessionContextV1, AgentTurnV1 } from "./agentSession.js";

function makeTurn(
  turnIndex: number,
  assistantOutput: string,
  overrides?: Partial<AgentTurnV1>,
): AgentTurnV1 {
  return {
    turnIndex,
    input: { text: "player input" },
    assistantOutput,
    modelConfig: { model: "mock-model" },
    tokenUsage: { input: 10, output: 10 },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSession(turns: AgentTurnV1[]): AgentSessionContextV1 {
  return {
    sessionKey: {
      tenantId: "default",
      workflowInstanceId: "rp-prod-1",
      conversationId: "session-a",
      agentNodeId: "writer-main",
    },
    turns,
    estimatedTokens: 0,
    truncated: false,
  };
}

describe("extractLastAssistantOutput", () => {
  // ============ Empty session ============
  it("returns empty text for empty turns", () => {
    const session = makeSession([]);
    const result = extractLastAssistantOutput(session);
    expect(result.text).toBe("");
    expect(result.meta.turnCount).toBe(0);
    expect(result.meta.sourceTurnIndex).toBeNull();
  });

  // ============ Single turn ============
  it("returns the only turn's output for single-turn session", () => {
    const session = makeSession([makeTurn(1, "第一回合的输出")]);
    const result = extractLastAssistantOutput(session);
    expect(result.text).toBe("第一回合的输出");
    expect(result.meta.turnCount).toBe(1);
    expect(result.meta.sourceTurnIndex).toBe(1);
  });

  // ============ Multiple turns ============
  it("returns the LAST turn's output for multi-turn session", () => {
    const session = makeSession([
      makeTurn(1, "第一回合"),
      makeTurn(2, "第二回合"),
      makeTurn(3, "第三回合"),
    ]);
    const result = extractLastAssistantOutput(session);
    expect(result.text).toBe("第三回合");
    expect(result.meta.turnCount).toBe(3);
    expect(result.meta.sourceTurnIndex).toBe(3);
  });

  // ============ Restart scenario ============
  it("returns same text after restart (deterministic from session store)", () => {
    const session = makeSession([makeTurn(1, "回合一"), makeTurn(2, "回合二")]);
    const result1 = extractLastAssistantOutput(session);
    const result2 = extractLastAssistantOutput(session);
    expect(result1.text).toBe(result2.text);
    expect(result1).toEqual(result2);
  });

  // ============ Return-latest: committed output as reference ============
  it("exhausted-return-latest: last committed output becomes next turn's reference", () => {
    // Turn 13 was committed with this text
    const turn13Text =
      "广播里的旋律忽然变了调。她侧耳倾听，仿佛在辨认某个遥远的信号。" +
      "空气中有一种微妙的变化，像是旧事在回响，又像是新的脚步声在靠近。" +
      "她低声说：该走了。";
    const session = makeSession([makeTurn(13, turn13Text)]);
    const result = extractLastAssistantOutput(session);
    expect(result.text).toBe(turn13Text);
    expect(result.text.length).toBeGreaterThanOrEqual(64);
  });

  // ============ Malformed inputs ============
  it("throws on null sessionContext", () => {
    expect(() => extractLastAssistantOutput(null)).toThrow(
      "sessionContext must be a non-null object",
    );
  });

  it("throws on non-object sessionContext", () => {
    expect(() => extractLastAssistantOutput("string")).toThrow(
      "sessionContext must be a non-null object",
    );
  });

  it("throws when turns is not an array", () => {
    expect(() => extractLastAssistantOutput({ sessionKey: {}, turns: "not-array" })).toThrow(
      "sessionContext.turns must be an array",
    );
  });

  it("throws when turns is undefined", () => {
    expect(() => extractLastAssistantOutput({ sessionKey: {} })).toThrow(
      "sessionContext.turns must be an array",
    );
  });

  it("throws when last turn is not an object", () => {
    expect(() => extractLastAssistantOutput({ sessionKey: {}, turns: ["not-object"] })).toThrow(
      "last turn must be a non-null object",
    );
  });

  it("throws when last turn assistantOutput is non-string non-null", () => {
    expect(() =>
      extractLastAssistantOutput({
        sessionKey: {},
        turns: [{ turnIndex: 1, assistantOutput: 42 }],
      }),
    ).toThrow("assistantOutput must be a string");
  });

  // ============ Null/undefined assistantOutput ============
  it("returns empty string for null assistantOutput", () => {
    const session = {
      sessionKey: {
        tenantId: "default",
        workflowInstanceId: "rp-prod-1",
        conversationId: "session-a",
        agentNodeId: "writer-main",
      },
      turns: [
        {
          turnIndex: 1,
          assistantOutput: null,
          modelConfig: { model: "m" },
          tokenUsage: { input: 0, output: 0 },
          createdAt: "",
          input: {},
        },
      ],
      estimatedTokens: 0,
      truncated: false,
    };
    const result = extractLastAssistantOutput(session);
    expect(result.text).toBe("");
  });

  // ============ Determinism ============
  it("produces identical results across 100 invocations", () => {
    const session = makeSession([makeTurn(1, "回合一"), makeTurn(2, "回合二")]);
    const first = extractLastAssistantOutput(session);
    for (let i = 0; i < 100; i++) {
      expect(extractLastAssistantOutput(session)).toEqual(first);
    }
  });
});
