import { describe, expect, it } from "vitest";
import {
  buildOfficialRpRequest,
  createInitialRpSession,
  markRpTurnFailed,
  markRpTurnSucceeded,
  prepareRpTurn,
  resetRpSession,
} from "./rpSessionState";

describe("RP session state", () => {
  it("creates a stable session id and memory namespace", () => {
    const session = createInitialRpSession({
      sessionId: "rp-web-fixed",
      now: () => "2026-06-16T00:00:00.000Z",
    });

    expect(session.sessionId).toBe("rp-web-fixed");
    expect(session.memoryNamespace).toBe("rp-session:rp-web-fixed");
    expect(session.nextTurnNumber).toBe(1);
    expect(session.messages).toEqual([]);
  });

  it("reuses the failed turn id and only advances after success", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-fixed" });
    const pending = prepareRpTurn(session, "Open the brass door.", {
      now: () => "2026-06-16T00:00:00.000Z",
    });

    expect(pending.pendingTurn?.turnId).toBe("turn-0001");
    expect(pending.nextTurnNumber).toBe(1);
    expect(pending.messages).toMatchObject([
      { role: "user", text: "Open the brass door.", turnId: "turn-0001" },
    ]);

    const failed = markRpTurnFailed(pending, {
      kind: "provider",
      message: "Model service temporarily failed.",
      retryable: true,
    });
    const retry = prepareRpTurn(failed, "Open the brass door.", {
      now: () => "2026-06-16T00:00:01.000Z",
    });

    expect(retry.pendingTurn?.turnId).toBe("turn-0001");
    expect(retry.messages.filter((message) => message.role === "user")).toHaveLength(1);

    const succeeded = markRpTurnSucceeded(
      retry,
      {
        narrative: "The door opens into a narrow stairwell.",
        quality: {
          accepted: true,
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
          budget: { exceeded: false, reasons: [] },
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
      },
      { now: () => "2026-06-16T00:00:02.000Z" },
    );

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
});
