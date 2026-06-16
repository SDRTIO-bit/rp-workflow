import { describe, expect, it } from "vitest";
import { runOfficialRpTurn, type OfficialRpRequestV1 } from "./officialRpClient";

const request: OfficialRpRequestV1 = {
  sessionId: "rp-web-123",
  turnId: "turn-0001",
  userInput: "I place the key on the counter.",
  worldbook: { resourceRef: "worldbook:demo" },
  memory: { namespace: "rp-session:rp-web-123" },
};

describe("runOfficialRpTurn", () => {
  it("posts an official RP turn to /api/rp", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await runOfficialRpTurn(request, {
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({
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
          }),
          { status: 200, headers: { "content-type": "application/json" } },
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

  it("maps network and abort failures without exposing stack traces", async () => {
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
});
