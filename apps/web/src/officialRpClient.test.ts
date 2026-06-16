import { describe, expect, it } from "vitest";
import { runOfficialRpTurn, type OfficialRpRequestV1 } from "./officialRpClient";

const request: OfficialRpRequestV1 = {
  sessionId: "rp-web-123",
  turnId: "turn-0001",
  userInput: "I place the key on the counter.",
  worldbook: { resourceRef: "worldbook:demo" },
  memory: { namespace: "rp-session:rp-web-123" },
};

/** 辅助：构造 JSON 响应 */
const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** 辅助：断言错误的公共属性 */
const expectError = async (
  promise: Promise<unknown>,
  expected: { kind: string; retryable: boolean; messageIncludes?: string },
) => {
  await expect(promise).rejects.toMatchObject({
    kind: expected.kind,
    retryable: expected.retryable,
    ...(expected.messageIncludes ? { message: expect.stringContaining(expected.messageIncludes) } : {}),
  });
};

describe("runOfficialRpTurn", () => {
  it("posts an official RP turn to /api/rp", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await runOfficialRpTurn(request, {
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse(
          {
            narrative: "The clerk glances at the key.",
            sessionId: request.sessionId,
            turnId: request.turnId,
            workflow: { id: "rp", version: 1, mode: "unified-v1" },
            quality: {
              accepted: true,
              exhausted: false,
              writerAttempts: 1,
              criticAttempts: 1,
              revisionApplied: false,
            },
            traceId: "trace_1",
          },
          200,
        );
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/rp");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(request);
    expect(result.narrative).toBe("The clerk glances at the key.");
  });

  // === API 错误映射 ===

  it("maps 400 to validation error (non-retryable)", async () => {
    await expectError(
      runOfficialRpTurn(request, {
        fetcher: async () => jsonResponse({ error: "Invalid sessionId format" }, 400),
      }),
      { kind: "validation", retryable: false },
    );
  });

  it("maps 404 to not-found error (non-retryable)", async () => {
    await expectError(
      runOfficialRpTurn(request, {
        fetcher: async () => jsonResponse({ error: "Worldbook not found" }, 404),
      }),
      { kind: "not-found", retryable: false },
    );
  });

  it("maps 409 to conflict error (non-retryable) with safe message", async () => {
    const error = await runOfficialRpTurn(request, {
      fetcher: async () =>
        jsonResponse({ error: "turn already committed with different input", traceId: "trace-409" }, 409),
    }).catch((e) => e);

    expect(error).toMatchObject({
      kind: "conflict",
      retryable: false,
      traceId: "trace-409",
    });
    // 不暴露原始服务端消息
    expect(error.message).not.toContain("turn already committed");
    expect(error.message).toContain("different content");
  });

  it("maps 422 to validation error (non-retryable)", async () => {
    await expectError(
      runOfficialRpTurn(request, {
        fetcher: async () => jsonResponse({ error: "Schema validation failed" }, 422),
      }),
      { kind: "validation", retryable: false },
    );
  });

  it("maps 409 conflicts to non-retryable turn conflict errors", async () => {
    await expect(
      runOfficialRpTurn(request, {
        fetcher: async () =>
          new Response(JSON.stringify({ error: "turn already committed with different input" }), {
            status: 409,
          }),
      }),
    ).rejects.toMatchObject({
      kind: "conflict",
      message: "Current turn was already submitted with different content. Start a new turn.",
      retryable: false,
    });
  });

  it("maps budget exceeded responses to retryable=false without falling back", async () => {
    await expect(
      runOfficialRpTurn(request, {
        fetcher: async () =>
          new Response(JSON.stringify({ error: "Usage budget exceeded: maxLlmCalls" }), {
            status: 500,
          }),
      }),
    ).rejects.toMatchObject({
      kind: "budget",
      message: "This turn reached the model call or token budget.",
      retryable: false,
    });
  });

  it("maps 500 server error to provider failure (retryable)", async () => {
    await expectError(
      runOfficialRpTurn(request, {
        fetcher: async () => jsonResponse({ error: "Internal server error", traceId: "trace-500" }, 500),
      }),
      { kind: "provider", retryable: true },
    );
  });

  it("maps 502/503 to provider failure (retryable)", async () => {
    for (const status of [502, 503]) {
      await expectError(
        runOfficialRpTurn(request, {
          fetcher: async () => jsonResponse({ error: "Bad gateway" }, status),
        }),
        { kind: "provider", retryable: true },
      );
    }
  });

  it("maps unknown status codes to unknown error (retryable)", async () => {
    await expectError(
      runOfficialRpTurn(request, {
        fetcher: async () => jsonResponse({ error: "Rate limited" }, 429),
      }),
      { kind: "unknown", retryable: true },
    );
  });

  it("maps network failures without exposing stack traces", async () => {
    await expect(
      runOfficialRpTurn(request, {
        fetcher: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    ).rejects.toMatchObject({
      kind: "network",
      message: "Unable to connect to the server.",
      retryable: true,
    });
  });

  it("maps abort errors without exposing internals", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runOfficialRpTurn(request, {
        signal: controller.signal,
        fetcher: async () => {
          throw new DOMException("Aborted", "AbortError");
        },
      }),
    ).rejects.toMatchObject({
      kind: "aborted",
      message: "Request was canceled.",
      retryable: true,
    });
  });

  it("maps unknown thrown errors to unknown kind", async () => {
    await expectError(
      runOfficialRpTurn(request, {
        fetcher: async () => {
          throw new Error("Something completely unexpected");
        },
      }),
      { kind: "unknown", retryable: true },
    );
  });

  // === 安全：错误响应不泄漏内部信息 ===

  it("does not expose raw provider error messages to the caller", async () => {
    const rawProviderMessage = "OPENAI_API_KEY expired: sk-*** internal detail";
    const error = await runOfficialRpTurn(request, {
      fetcher: async () =>
        jsonResponse({ error: rawProviderMessage, traceId: "trace-leak" }, 500),
    }).catch((e) => e);

    // 错误消息是安全的通用描述
    expect(error.message).not.toContain("OPENAI_API_KEY");
    expect(error.message).not.toContain("sk-");
    expect(error.message).not.toContain("internal detail");
    // traceId 允许传递（安全标识符）
    expect(error.traceId).toBe("trace-leak");
  });

  it("handles malformed error body gracefully", async () => {
    await expectError(
      runOfficialRpTurn(request, {
        fetcher: async () =>
          new Response("not json at all", { status: 500 }),
      }),
      { kind: "provider", retryable: true },
    );
  });

  it("preserves traceId from server error responses", async () => {
    const error = await runOfficialRpTurn(request, {
      fetcher: async () =>
        jsonResponse({ error: "Something failed", traceId: "trace-abc-123" }, 500),
    }).catch((e) => e);

    expect(error.traceId).toBe("trace-abc-123");
  });

  it("does not include traceId when server omits it", async () => {
    const error = await runOfficialRpTurn(request, {
      fetcher: async () => jsonResponse({ error: "Bad request" }, 400),
    }).catch((e) => e);

    expect(error.traceId).toBeUndefined();
  });

  // === Budget 优先级 ===

  it("detects budget exceeded before status code mapping", async () => {
    // budget 关键词在 500 响应中应优先匹配为 budget 而非 provider
    await expectError(
      runOfficialRpTurn(request, {
        fetcher: async () =>
          jsonResponse({ error: "budget exceeded: maxTokens" }, 500),
      }),
      { kind: "budget", retryable: false },
    );
  });
});
