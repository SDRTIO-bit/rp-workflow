import { describe, expect, it } from "vitest";
import {
  buildOfficialRpRequest,
  createInitialRpSession,
  markRpTurnCanceled,
  markRpTurnFailed,
  markRpTurnSucceeded,
  prepareRpTurn,
  resetRpSession,
  restoreRpSession,
  serializeRpSession,
} from "./rpSessionState";

const fixedClock = () => "2026-06-16T00:00:00.000Z";

const sampleSuccessResponse = {
  narrative: "The door opens into a narrow stairwell.",
  quality: {
    accepted: true as const,
    exhausted: false,
    writerAttempts: 1,
    criticAttempts: 1,
    revisionApplied: false,
  },
  observability: {
    llmCalls: 2,
    totalLatencyMs: 8400,
    usage: {
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      unavailableInvocationCount: 0,
    },
    roles: { writer: 1, critic: 1, memoryCurator: 0 },
    budget: { exceeded: false, reasons: [] as string[] },
    modelUsage: [
      {
        providerId: "mock",
        model: "mock-model",
        calls: 2,
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
      },
    ],
  },
};

describe("RP session state", () => {
  it("creates a stable session id and memory namespace", () => {
    const session = createInitialRpSession({
      sessionId: "rp-web-fixed",
      now: fixedClock,
    });

    expect(session.sessionId).toBe("rp-web-fixed");
    expect(session.memoryNamespace).toBe("rp-session:rp-web-fixed");
    expect(session.nextTurnNumber).toBe(1);
    expect(session.messages).toEqual([]);
  });

  it("reuses the failed turn id and only advances after success", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-fixed" });
    const pending = prepareRpTurn(session, "Open the brass door.", { now: fixedClock });

    expect(pending.pendingTurn?.turnId).toBe("turn-0001");
    expect(pending.nextTurnNumber).toBe(1);

    const failed = markRpTurnFailed(pending, {
      kind: "provider",
      message: "Model service temporarily failed.",
      retryable: true,
    });
    const retry = prepareRpTurn(failed, "Open the brass door.", {
      now: () => "2026-06-16T00:00:01.000Z",
    });

    expect(retry.pendingTurn?.turnId).toBe("turn-0001");
    expect(retry.messages.filter((m) => m.role === "user")).toHaveLength(1);

    const succeeded = markRpTurnSucceeded(retry, sampleSuccessResponse, {
      now: () => "2026-06-16T00:00:02.000Z",
    });

    expect(succeeded.nextTurnNumber).toBe(2);
    expect(succeeded.pendingTurn).toBeUndefined();
    expect(succeeded.messages.at(-1)).toMatchObject({
      role: "assistant",
      text: "The door opens into a narrow stairwell.",
      turnId: "turn-0001",
    });
  });

  it("uses a new turn when failed content changes", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-fixed" });
    const pending = prepareRpTurn(session, "First input");
    const failed = markRpTurnFailed(pending, {
      kind: "provider",
      message: "Model service temporarily failed.",
      retryable: true,
    });
    const edited = prepareRpTurn(failed, "Edited input");

    expect(edited.pendingTurn?.turnId).toBe("turn-0002");
    expect(edited.nextTurnNumber).toBe(1);
    expect(edited.messages).toMatchObject([{ text: "Edited input", turnId: "turn-0002" }]);
  });

  it("builds requests with stable worldbook and memory identity", () => {
    const session = createInitialRpSession({
      sessionId: "rp-web-fixed",
      worldbookResourceRef: "worldbook:demo",
    });
    const pending = prepareRpTurn(session, "Continue");

    expect(buildOfficialRpRequest(pending)).toEqual({
      sessionId: "rp-web-fixed",
      turnId: "turn-0001",
      userInput: "Continue",
      worldbook: { resourceRef: "worldbook:demo" },
      memory: { namespace: "rp-session:rp-web-fixed" },
    });
  });

  it("resets a conversation while preserving the selected worldbook", () => {
    const session = createInitialRpSession({
      sessionId: "rp-web-fixed",
      worldbookResourceRef: "worldbook:demo",
    });
    const next = resetRpSession(session, { sessionId: "rp-web-next" });

    expect(next.sessionId).toBe("rp-web-next");
    expect(next.worldbookResourceRef).toBe("worldbook:demo");
    expect(next.memoryNamespace).toBe("rp-session:rp-web-next");
    expect(next.nextTurnNumber).toBe(1);
    expect(next.messages).toEqual([]);
  });

  // === 补充行为测试 ===

  it("advances to turn-0002 after first round success", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-fixed" });

    // Round 1: 发送并成功
    const round1 = prepareRpTurn(session, "Look around the room.", { now: fixedClock });
    expect(round1.pendingTurn?.turnId).toBe("turn-0001");

    const success1 = markRpTurnSucceeded(round1, sampleSuccessResponse, { now: fixedClock });
    expect(success1.nextTurnNumber).toBe(2);

    // Round 2: 应该使用 turn-0002
    const round2 = prepareRpTurn(success1, "Open the drawer.", { now: fixedClock });
    expect(round2.pendingTurn?.turnId).toBe("turn-0002");
    expect(round2.pendingTurn?.turnNumber).toBe(2);
  });

  it("does not increment turnNumber on failure", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-fixed" });
    const pending = prepareRpTurn(session, "Attempt action.");

    expect(pending.nextTurnNumber).toBe(1);

    const failed = markRpTurnFailed(pending, {
      kind: "provider",
      message: "Model service temporarily failed.",
      retryable: true,
    });

    // 失败后 nextTurnNumber 不应递增
    expect(failed.nextTurnNumber).toBe(1);
  });

  it("retry preserves original turnId and content", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-fixed" });
    const pending = prepareRpTurn(session, "Original input.");

    const failed = markRpTurnFailed(pending, {
      kind: "network",
      message: "Unable to connect to the server.",
      retryable: true,
    });

    // Retry 使用相同输入
    const retry = prepareRpTurn(failed, "Original input.");

    expect(retry.pendingTurn?.turnId).toBe("turn-0001");
    expect(retry.pendingTurn?.userInput).toBe("Original input.");

    // 请求内容不变
    const request = buildOfficialRpRequest(retry);
    expect(request.turnId).toBe("turn-0001");
    expect(request.userInput).toBe("Original input.");
  });

  it("cancel preserves pendingTurn for later retry", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-fixed" });
    const pending = prepareRpTurn(session, "Action.");

    const canceled = markRpTurnCanceled(pending);

    // 取消后保留 pendingTurn
    expect(canceled.pendingTurn).toBeDefined();
    expect(canceled.pendingTurn?.turnId).toBe("turn-0001");
    expect(canceled.pendingTurn?.userInput).toBe("Action.");
    expect(canceled.status).toBe("error");
    expect(canceled.lastError?.kind).toBe("aborted");
    expect(canceled.lastError?.retryable).toBe(true);

    // 可以 retry
    const retry = prepareRpTurn(canceled, "Action.");
    expect(retry.pendingTurn?.turnId).toBe("turn-0001");
  });

  it("cancel does not add assistant message", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-fixed" });
    const pending = prepareRpTurn(session, "Action.");

    const canceled = markRpTurnCanceled(pending);

    // 只有 user 消息，没有 assistant 消息
    const assistantMessages = canceled.messages.filter((m) => m.role === "assistant");
    expect(assistantMessages).toHaveLength(0);
  });

  it("new session clears messages and changes namespace", () => {
    const session = createInitialRpSession({
      sessionId: "rp-web-old",
      worldbookResourceRef: "worldbook:demo",
    });

    // 添加一些消息
    const withTurn = prepareRpTurn(session, "Hello.");
    const withResponse = markRpTurnSucceeded(withTurn, sampleSuccessResponse);
    expect(withResponse.messages.length).toBeGreaterThan(0);

    // New Session
    const newSession = resetRpSession(withResponse);

    expect(newSession.sessionId).not.toBe("rp-web-old");
    expect(newSession.sessionId).toMatch(/^rp-web-/);
    expect(newSession.memoryNamespace).toBe(`rp-session:${newSession.sessionId}`);
    expect(newSession.messages).toEqual([]);
    expect(newSession.nextTurnNumber).toBe(1);
    expect(newSession.pendingTurn).toBeUndefined();
    expect(newSession.worldbookResourceRef).toBe("worldbook:demo");
  });

  it("serializeRpSession excludes runtime state and sensitive fields", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-fixed" });
    const pending = prepareRpTurn(session, "Secret prompt content.");
    const withError = markRpTurnFailed(pending, {
      kind: "provider",
      message: "Model service temporarily failed.",
      retryable: true,
      traceId: "trace-internal-12345",
    });

    const serialized = serializeRpSession(withError);

    // 只包含安全字段
    expect(Object.keys(serialized).sort()).toEqual([
      "memoryNamespace",
      "messages",
      "nextTurnNumber",
      "sessionId",
      "worldbookResourceRef",
    ]);

    // 不包含 status、pendingTurn、lastError、lastQuality、lastObservability
    expect(serialized).not.toHaveProperty("status");
    expect(serialized).not.toHaveProperty("pendingTurn");
    expect(serialized).not.toHaveProperty("lastError");
    expect(serialized).not.toHaveProperty("lastQuality");
    expect(serialized).not.toHaveProperty("lastObservability");
  });

  it("restoreRpSession does not restore sensitive runtime fields", () => {
    const maliciousPayload = {
      sessionId: "rp-web-fixed",
      nextTurnNumber: 3,
      messages: [
        {
          id: "user-turn-0001",
          role: "user",
          text: "Hello",
          turnId: "turn-0001",
          createdAt: "2026-06-16T00:00:00.000Z",
        },
      ],
      worldbookResourceRef: "worldbook:demo",
      memoryNamespace: "rp-session:rp-web-fixed",
      // 尝试注入敏感字段
      status: "sending",
      pendingTurn: { turnId: "turn-0003", turnNumber: 3, userInput: "injected" },
      lastError: { kind: "provider", message: "injected", retryable: true },
      lastQuality: {
        accepted: true,
        exhausted: false,
        writerAttempts: 1,
        criticAttempts: 1,
        revisionApplied: false,
      },
      lastObservability: { llmCalls: 5, totalLatencyMs: 1000 },
    };

    const restored = restoreRpSession(maliciousPayload);

    expect(restored.status).toBe("idle");
    expect(restored.pendingTurn).toBeUndefined();
    expect(restored.lastError).toBeUndefined();
    expect(restored.lastQuality).toBeUndefined();
    expect(restored.lastObservability).toBeUndefined();
  });

  it("prepareRpTurn ignores empty input", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-fixed" });

    expect(prepareRpTurn(session, "")).toBe(session);
    expect(prepareRpTurn(session, "   ")).toBe(session);
  });

  it("prevents duplicate user messages on retry", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-fixed" });
    const pending = prepareRpTurn(session, "Same input.");
    const failed = markRpTurnFailed(pending, {
      kind: "provider",
      message: "fail",
      retryable: true,
    });
    const retry = prepareRpTurn(failed, "Same input.");

    const userMessages = retry.messages.filter((m) => m.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]?.turnId).toBe("turn-0001");
  });
});
