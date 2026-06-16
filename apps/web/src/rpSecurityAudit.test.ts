import { describe, expect, it } from "vitest";
import {
  createInitialRpSession,
  markRpTurnFailed,
  markRpTurnSucceeded,
  prepareRpTurn,
  serializeRpSession,
  restoreRpSession,
} from "./rpSessionState";

/**
 * P-14 安全审计：验证 sessionStorage 序列化不泄漏敏感数据。
 *
 * 禁止存储的内容：
 * - API key / Authorization
 * - 完整 Prompt
 * - Session History 原始上下文
 * - Worldbook 内容
 * - Memory 内容
 * - Critic JSON
 * - Provider 原始响应
 */

const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /authorization/i,
  /bearer/i,
  /sk-[a-zA-Z0-9]/,
  /secret/i,
  /password/i,
  /credential/i,
];

describe("RP sessionStorage security audit", () => {
  it("serializeRpSession output contains only allowlisted fields", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-audit" });
    const pending = prepareRpTurn(session, "User input text.");
    const failed = markRpTurnFailed(pending, {
      kind: "provider",
      message: "Model service temporarily failed.",
      retryable: true,
      traceId: "trace-internal-xyz",
    });

    const serialized = serializeRpSession(failed);
    const keys = Object.keys(serialized).sort();

    // 只允许这些字段
    const allowedKeys = [
      "memoryNamespace",
      "messages",
      "nextTurnNumber",
      "sessionId",
      "worldbookResourceRef",
    ];
    expect(keys).toEqual(allowedKeys);
  });

  it("serialized output does not contain runtime error state", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-audit" });
    const pending = prepareRpTurn(session, "Test.");
    const failed = markRpTurnFailed(pending, {
      kind: "provider",
      message: "Internal provider detail: OPENAI timeout at us-east-1",
      retryable: true,
      traceId: "trace-secret-123",
    });

    const json = JSON.stringify(serializeRpSession(failed));

    // 不应包含错误详情
    expect(json).not.toContain("Internal provider detail");
    expect(json).not.toContain("OPENAI timeout");
    expect(json).not.toContain("trace-secret-123");
    expect(json).not.toContain("provider");
  });

  it("serialized output does not contain quality or observability data", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-audit" });
    const pending = prepareRpTurn(session, "Test.");
    const succeeded = markRpTurnSucceeded(pending, {
      narrative: "A narrative response.",
      quality: {
        accepted: true,
        exhausted: false,
        writerAttempts: 2,
        criticAttempts: 3,
        revisionApplied: true,
      },
      observability: {
        llmCalls: 5,
        totalLatencyMs: 12000,
        usage: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          unavailableInvocationCount: 0,
        },
        roles: { writer: 2, critic: 2, memoryCurator: 1 },
        budget: { exceeded: false, reasons: [] },
        modelUsage: [
          {
            providerId: "openai",
            model: "gpt-4",
            calls: 5,
            inputTokens: 1000,
            outputTokens: 500,
            totalTokens: 1500,
          },
        ],
      },
    });

    const json = JSON.stringify(serializeRpSession(succeeded));

    // 不应包含 observability 详情
    expect(json).not.toContain("llmCalls");
    expect(json).not.toContain("writerAttempts");
    expect(json).not.toContain("criticAttempts");
    expect(json).not.toContain("modelUsage");
    expect(json).not.toContain("totalLatencyMs");
    expect(json).not.toContain("budget");
  });

  it("serialized output does not contain pendingTurn state", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-audit" });
    const pending = prepareRpTurn(session, "Secret prompt content that should not persist.");

    const json = JSON.stringify(serializeRpSession(pending));

    // pendingTurn 不应被序列化
    expect(json).not.toContain("pendingTurn");
    // 但 user message 中的文本是用户自己输入的，允许保留
    // （这不是 "完整 Prompt"，而是用户操作输入）
  });

  it("serialized output does not contain sensitive patterns", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-audit" });
    const serialized = serializeRpSession(session);
    const json = JSON.stringify(serialized);

    for (const pattern of SENSITIVE_PATTERNS) {
      expect(json).not.toMatch(pattern);
    }
  });

  it("serialized output does not contain worldbook content (only resource ref)", () => {
    const session = createInitialRpSession({
      sessionId: "rp-web-audit",
      worldbookResourceRef: "worldbook:demo",
    });

    const json = JSON.stringify(serializeRpSession(session));

    // 只包含引用，不包含世界书内容
    expect(json).toContain("worldbook:demo");
    expect(json).not.toContain("worldbook content");
    expect(json).not.toContain("entry");
    expect(json).not.toContain("content");
  });

  it("serialized output does not contain memory content (only namespace)", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-audit" });

    const json = JSON.stringify(serializeRpSession(session));

    // 只包含命名空间引用
    expect(json).toContain("rp-session:rp-web-audit");
    // 不包含实际记忆内容
    expect(json).not.toContain("memory content");
  });

  it("restoreRpSession strips injected runtime fields", () => {
    const tampered = {
      sessionId: "rp-web-audit",
      nextTurnNumber: 5,
      messages: [],
      worldbookResourceRef: "worldbook:demo",
      memoryNamespace: "rp-session:rp-web-audit",
      // 注入的敏感字段
      apiKey: "sk-secret-key-12345",
      authorization: "Bearer token-xyz",
      status: "sending",
      pendingTurn: { turnId: "turn-0005", turnNumber: 5, userInput: "injected prompt" },
      lastError: { kind: "provider", message: "secret error", retryable: true },
      lastQuality: {
        accepted: true,
        exhausted: false,
        writerAttempts: 1,
        criticAttempts: 1,
        revisionApplied: false,
      },
      lastObservability: { llmCalls: 10, totalLatencyMs: 50000 },
    };

    const restored = restoreRpSession(tampered);

    // 恢复后不应有注入的字段
    expect(restored).not.toHaveProperty("apiKey");
    expect(restored).not.toHaveProperty("authorization");
    expect(restored.status).toBe("idle");
    expect(restored.pendingTurn).toBeUndefined();
    expect(restored.lastError).toBeUndefined();
    expect(restored.lastQuality).toBeUndefined();
    expect(restored.lastObservability).toBeUndefined();
  });

  it("restoreRpSession rejects non-object values", () => {
    const fallback = createInitialRpSession({ sessionId: "rp-web-fallback" });

    expect(restoreRpSession(null, fallback)).toBe(fallback);
    expect(restoreRpSession(undefined, fallback)).toBe(fallback);
    expect(restoreRpSession("string", fallback)).toBe(fallback);
    expect(restoreRpSession(42, fallback)).toBe(fallback);
  });

  it("restoreRpSession rejects incomplete objects", () => {
    const fallback = createInitialRpSession({ sessionId: "rp-web-fallback" });

    expect(restoreRpSession({ sessionId: "rp-web-x" }, fallback)).toBe(fallback);
    expect(restoreRpSession({ sessionId: "rp-web-x", nextTurnNumber: 1 }, fallback)).toBe(fallback);
  });
});
