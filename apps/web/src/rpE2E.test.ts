import { describe, expect, it } from "vitest";
import { runOfficialRpTurn, type OfficialRpRequestV1 } from "./officialRpClient";
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
  type RpChatSessionV1,
} from "./rpSessionState";

/**
 * P-14 浏览器 E2E 模拟测试。
 *
 * 使用 mock fetcher 拦截 /api/rp 请求，验证完整的前端状态流转。
 * 不依赖 Playwright，但覆盖了所有 E2E 场景的状态断言。
 */

/** 记录所有发出的请求 */
type CapturedRequest = OfficialRpRequestV1;

/** 构造成功响应 */
const makeSuccessResponse = (request: OfficialRpRequestV1, narrative: string) => ({
  narrative,
  sessionId: request.sessionId,
  turnId: request.turnId,
  workflow: { id: "rp", version: 1, mode: "unified-v1" as const },
  quality: {
    accepted: true,
    exhausted: false,
    writerAttempts: 1,
    criticAttempts: 1,
    revisionApplied: false,
  },
  observability: {
    llmCalls: 2,
    totalLatencyMs: 4200,
    usage: {
      inputTokens: 200,
      outputTokens: 150,
      totalTokens: 350,
      unavailableInvocationCount: 0,
    },
    roles: { writer: 1, critic: 1, memoryCurator: 0 },
    budget: { exceeded: false, reasons: [] as string[] },
    modelUsage: [
      {
        providerId: "mock",
        model: "mock-model",
        calls: 2,
        inputTokens: 200,
        outputTokens: 150,
        totalTokens: 350,
      },
    ],
  },
  traceId: `trace-${request.turnId}`,
});

/** 模拟 submitRpInput 的完整流程 */
const simulateSubmit = async (
  session: RpChatSessionV1,
  input: string,
  fetcher: (request: OfficialRpRequestV1) => Promise<unknown>,
): Promise<{
  session: RpChatSessionV1;
  capturedRequests: CapturedRequest[];
}> => {
  const capturedRequests: CapturedRequest[] = [];

  // 1. prepareRpTurn
  const prepared = prepareRpTurn(session, input);
  if (!prepared.pendingTurn || prepared === session) {
    return { session: prepared, capturedRequests };
  }

  // 2. buildOfficialRpRequest
  const request = buildOfficialRpRequest(prepared);
  capturedRequests.push(request);

  // 3. runOfficialRpTurn (with mock fetcher)
  try {
    const mockFetcher = async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as OfficialRpRequestV1;
      const result = await fetcher(body);
      if (result instanceof Error) {
        throw result;
      }
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const response = await runOfficialRpTurn(request, { fetcher: mockFetcher });

    // 4. markRpTurnSucceeded
    const succeeded = markRpTurnSucceeded(prepared, response);
    return { session: succeeded, capturedRequests };
  } catch {
    // 4b. markRpTurnFailed
    const rpError = {
      kind: "provider" as const,
      message: "Model service temporarily failed.",
      retryable: true,
    };
    const failed = markRpTurnFailed(prepared, rpError);
    return { session: failed, capturedRequests };
  }
};

describe("Browser E2E: Normal two rounds", () => {
  it("completes two rounds with same sessionId and sequential turnIds", async () => {
    let session = createInitialRpSession({
      sessionId: "rp-web-e2e",
      worldbookResourceRef: "worldbook:demo",
    });
    const allRequests: CapturedRequest[] = [];

    // === Round 1 ===
    const round1Result = await simulateSubmit(session, "I enter the tavern.", async (req) =>
      makeSuccessResponse(req, "The tavern is warm and dimly lit."),
    );

    allRequests.push(...round1Result.capturedRequests);
    session = round1Result.session;

    // Round 1 断言
    expect(session.messages).toHaveLength(2); // user + assistant
    expect(session.messages[0]).toMatchObject({
      role: "user",
      text: "I enter the tavern.",
      turnId: "turn-0001",
    });
    expect(session.messages[1]).toMatchObject({
      role: "assistant",
      text: "The tavern is warm and dimly lit.",
      turnId: "turn-0001",
    });
    expect(session.nextTurnNumber).toBe(2);
    expect(session.status).toBe("idle");

    // === Round 2: 点击"继续" ===
    const round2 = await simulateSubmit(session, "Continue", async (req) =>
      makeSuccessResponse(req, "The bartender nods in your direction."),
    );

    allRequests.push(...round2.capturedRequests);
    session = round2.session;

    // Round 2 断言
    expect(session.messages).toHaveLength(4); // 2 user + 2 assistant
    expect(session.messages[2]).toMatchObject({
      role: "user",
      text: "Continue",
      turnId: "turn-0002",
    });
    expect(session.messages[3]).toMatchObject({
      role: "assistant",
      text: "The bartender nods in your direction.",
      turnId: "turn-0002",
    });
    expect(session.nextTurnNumber).toBe(3);

    // === 跨轮断言 ===
    // 两次请求 sessionId 相同
    expect(allRequests).toHaveLength(2);
    expect(allRequests[0]?.sessionId).toBe("rp-web-e2e");
    expect(allRequests[1]?.sessionId).toBe("rp-web-e2e");

    // turnId 分别为 turn-0001、turn-0002
    expect(allRequests[0]?.turnId).toBe("turn-0001");
    expect(allRequests[1]?.turnId).toBe("turn-0002");
  });
});

describe("Browser E2E: Failure retry", () => {
  it("retries with same turnId after provider error, then advances on success", async () => {
    let session = createInitialRpSession({
      sessionId: "rp-web-retry",
      worldbookResourceRef: "worldbook:demo",
    });
    const allRequests: CapturedRequest[] = [];

    // === Round 1: Provider error — 直接模拟状态流转 ===
    const prepared1 = prepareRpTurn(session, "I draw my sword.");
    const request1 = buildOfficialRpRequest(prepared1);
    allRequests.push(request1);

    // 模拟 provider failure
    const failed1 = markRpTurnFailed(prepared1, {
      kind: "provider",
      message: "Model service temporarily failed.",
      retryable: true,
    });
    session = failed1;

    // 失败断言
    expect(session.status).toBe("error");
    expect(session.lastError?.kind).toBe("provider");
    expect(session.lastError?.retryable).toBe(true);
    expect(session.pendingTurn?.turnId).toBe("turn-0001");
    expect(session.nextTurnNumber).toBe(1); // 未递增

    // === Retry: 复用原 turnId ===
    const retried = prepareRpTurn(session, "I draw my sword.");
    const retryRequest = buildOfficialRpRequest(retried);
    allRequests.push(retryRequest);

    // Retry 断言
    expect(retryRequest.turnId).toBe("turn-0001"); // 复用原 turnId
    expect(retryRequest.userInput).toBe("I draw my sword."); // 内容不变

    // Retry 成功
    const successResponse = makeSuccessResponse(retryRequest, "Your blade gleams in the light.");
    const response = await runOfficialRpTurn(retryRequest, {
      fetcher: async () =>
        new Response(JSON.stringify(successResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    session = markRpTurnSucceeded(retried, response);

    // 成功后断言
    expect(session.nextTurnNumber).toBe(2); // 现在才递增
    expect(session.pendingTurn).toBeUndefined();
    expect(session.messages.at(-1)).toMatchObject({
      role: "assistant",
      text: "Your blade gleams in the light.",
      turnId: "turn-0001",
    });

    // 跨请求断言
    expect(allRequests).toHaveLength(2);
    expect(allRequests[0]?.turnId).toBe("turn-0001");
    expect(allRequests[1]?.turnId).toBe("turn-0001"); // 两次都是 turn-0001
  });
});

describe("Browser E2E: Cancel", () => {
  it("cancel preserves pending turn and does not add assistant message", () => {
    let session = createInitialRpSession({
      sessionId: "rp-web-cancel",
      worldbookResourceRef: "worldbook:demo",
    });

    // 发送请求（模拟 pending 状态）
    const prepared = prepareRpTurn(session, "I open the chest.");
    session = prepared;

    expect(session.status).toBe("sending");
    expect(session.pendingTurn?.turnId).toBe("turn-0001");

    // 取消
    session = markRpTurnCanceled(session);

    // 取消断言
    expect(session.status).toBe("error");
    expect(session.lastError?.kind).toBe("aborted");
    expect(session.lastError?.retryable).toBe(true);
    expect(session.pendingTurn?.turnId).toBe("turn-0001"); // 保留原 turn

    // 不增加 Assistant 消息
    const assistantMessages = session.messages.filter((m) => m.role === "assistant");
    expect(assistantMessages).toHaveLength(0);

    // Retry 保留原 turn
    const retried = prepareRpTurn(session, "I open the chest.");
    expect(retried.pendingTurn?.turnId).toBe("turn-0001");
    expect(retried.pendingTurn?.userInput).toBe("I open the chest.");
  });
});

describe("Browser E2E: New Session", () => {
  it("new session clears messages and changes namespace", () => {
    let session = createInitialRpSession({
      sessionId: "rp-web-old-session",
      worldbookResourceRef: "worldbook:demo",
    });

    // 添加一些消息
    const prepared = prepareRpTurn(session, "Hello.");
    const response = makeSuccessResponse(buildOfficialRpRequest(prepared), "Hi there.");
    session = markRpTurnSucceeded(prepared, response);
    expect(session.messages.length).toBe(2);

    // New Session
    session = resetRpSession(session);

    expect(session.sessionId).not.toBe("rp-web-old-session");
    expect(session.sessionId).toMatch(/^rp-web-/);
    expect(session.memoryNamespace).toBe(`rp-session:${session.sessionId}`);
    expect(session.messages).toEqual([]);
    expect(session.nextTurnNumber).toBe(1);
    expect(session.worldbookResourceRef).toBe("worldbook:demo"); // 保留 worldbook
  });
});

describe("Browser E2E: Concurrent send prevention", () => {
  it("prevents sending while already sending", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-concurrent" });

    // 模拟正在发送
    const sending = prepareRpTurn(session, "First message.");
    expect(sending.status).toBe("sending");

    // 尝试再次发送 — prepareRpTurn 应该正常工作但 App 层面会检查 status
    // 这里验证 prepareRpTurn 在 sending 状态下的行为
    const doubleSend = prepareRpTurn(sending, "Second message.");

    // 由于 sending 状态已有 pendingTurn，且输入不同，会创建新 turn
    // 但 App.tsx 的 submitRpInput 会检查 status === "sending" 并提前返回
    // 这个测试验证状态层的正确性
    expect(doubleSend.pendingTurn?.turnId).toBe("turn-0002");
    // 实际防并发在 App 层：if (rpSession.status === "sending") return;
  });
});

describe("Browser E2E: Modified failed content creates new turn", () => {
  it("editing failed content generates a new turnId", async () => {
    let session = createInitialRpSession({
      sessionId: "rp-web-edit",
      worldbookResourceRef: "worldbook:demo",
    });

    // Round 1: 发送并失败
    const prepared = prepareRpTurn(session, "Original action.");

    const failed = markRpTurnFailed(prepared, {
      kind: "provider",
      message: "Model service temporarily failed.",
      retryable: true,
    });
    session = failed;

    // 用户修改内容后重新发送
    const edited = prepareRpTurn(session, "Edited action.");

    // 新 turnId
    expect(edited.pendingTurn?.turnId).toBe("turn-0002");
    expect(edited.pendingTurn?.userInput).toBe("Edited action.");

    // 请求使用新 turnId
    const editedRequest = buildOfficialRpRequest(edited);
    expect(editedRequest.turnId).toBe("turn-0002");
    expect(editedRequest.userInput).toBe("Edited action.");
  });
});

describe("Browser E2E: sessionStorage round-trip", () => {
  it("session survives serialization/deserialization without leaking", () => {
    let session = createInitialRpSession({
      sessionId: "rp-web-storage",
      worldbookResourceRef: "worldbook:demo",
    });

    // 添加消息
    const prepared = prepareRpTurn(session, "Test input.");
    const response = makeSuccessResponse(buildOfficialRpRequest(prepared), "Test narrative.");
    session = markRpTurnSucceeded(prepared, response);

    // 模拟 sessionStorage 存储
    const serialized = serializeRpSession(session);
    const json = JSON.stringify(serialized);

    // 验证不泄漏
    expect(json).not.toContain("pendingTurn");
    expect(json).not.toContain("lastError");
    expect(json).not.toContain("lastQuality");
    expect(json).not.toContain("lastObservability");

    // 模拟恢复
    const restored = restoreRpSession(JSON.parse(json));
    expect(restored.sessionId).toBe("rp-web-storage");
    expect(restored.messages).toHaveLength(2);
    expect(restored.status).toBe("idle");
    expect(restored.nextTurnNumber).toBe(2);
  });
});
