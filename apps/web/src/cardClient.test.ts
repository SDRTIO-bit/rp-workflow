import { describe, expect, it } from "vitest";
import {
  getCard,
  getCardGreetings,
  importCard,
  initializeCardSession,
  listCards,
  type CardWebError,
} from "./cardClient";

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const expectCardError = async (
  promise: Promise<unknown>,
  expected: { kind: string; retryable: boolean },
) => {
  await expect(promise).rejects.toMatchObject({
    kind: expected.kind,
    retryable: expected.retryable,
  });
};

const sanitizedManifest = {
  cardId: "a".repeat(64),
  sourceFilename: "test-card.json",
  sourceSizeBytes: 1024,
  sourceHash: "a".repeat(64),
  importedAt: "2026-06-16T00:00:00.000Z",
  spec: "chara_card_v3",
  name: "Test Card",
  description: "A test card",
  tags: ["test"],
  worldbookEntryCount: 5,
  worldbookDeferredCount: 0,
  worldbookDisabledCount: 0,
  worldbookBlockedCount: 1,
  worldbookConstantCount: 0,
  alternateGreetingCount: 2,
  defaultGreetingId: "g0",
  capabilities: {
    variablesDetected: false,
    variableSchemaDetected: false,
    initialStateDetected: false,
    patchProtocolDetected: false,
    conditionalEntriesDetected: false,
    runtimeStatus: "unsupported-runtime",
    conditionalEntryCount: 0,
  },
  warnings: [],
  blockedFeatureSummary: [],
  worldbookResourceRef: `card:${"a".repeat(64)}`,
};

describe("importCard", () => {
  it("returns import result on 201 (new card)", async () => {
    const result = await importCard(new File(["{}"], "card.json"), {
      fetcher: async () =>
        jsonResponse(
          {
            cardId: "a".repeat(64),
            alreadyExisted: false,
            manifest: sanitizedManifest,
            defaultGreetingId: "g0",
            greetingCount: 3,
          },
          201,
        ),
    });

    expect(result.alreadyExisted).toBe(false);
    expect(result.manifest.name).toBe("Test Card");
    expect(result.greetingCount).toBe(3);
  });

  it("returns import result on 200 (dedup)", async () => {
    const result = await importCard(new File(["{}"], "card.json"), {
      fetcher: async () =>
        jsonResponse(
          {
            cardId: "a".repeat(64),
            alreadyExisted: true,
            manifest: sanitizedManifest,
            defaultGreetingId: "g0",
            greetingCount: 3,
          },
          200,
        ),
    });

    expect(result.alreadyExisted).toBe(true);
    expect(result.cardId).toBe("a".repeat(64));
  });

  it("sends file as multipart form data", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    await importCard(new File(["{}"], "card.json"), {
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse(
          {
            cardId: "a".repeat(64),
            alreadyExisted: false,
            manifest: sanitizedManifest,
            defaultGreetingId: "g0",
            greetingCount: 1,
          },
          201,
        );
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/cards/import");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBeInstanceOf(FormData);
  });
});

describe("listCards", () => {
  it("returns card list", async () => {
    const result = await listCards({
      fetcher: async () =>
        jsonResponse(
          {
            cards: [
              {
                cardId: "a".repeat(64),
                name: "Test",
                description: null,
                tags: [],
                worldbookEntryCount: 0,
                alternateGreetingCount: 1,
                defaultGreetingId: "g0",
                importedAt: "2026-06-16T00:00:00.000Z",
              },
            ],
          },
          200,
        ),
    });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.name).toBe("Test");
  });
});

describe("getCard", () => {
  it("returns card detail", async () => {
    const result = await getCard("a".repeat(64), {
      fetcher: async () =>
        jsonResponse(
          {
            cardId: "a".repeat(64),
            manifest: sanitizedManifest,
            defaultGreetingId: "g0",
            greetingCount: 3,
          },
          200,
        ),
    });

    expect(result.manifest.name).toBe("Test Card");
  });
});

describe("getCardGreetings", () => {
  it("returns greeting list with cleaned content only", async () => {
    const result = await getCardGreetings("a".repeat(64), {
      fetcher: async () =>
        jsonResponse(
          {
            cardId: "a".repeat(64),
            greetings: [
              {
                greetingId: "g0",
                index: 0,
                label: "Default",
                content: "Hello, traveler!",
                isDefault: true,
              },
            ],
          },
          200,
        ),
    });

    expect(result.greetings).toHaveLength(1);
    expect(result.greetings[0]?.content).toBe("Hello, traveler!");
    expect(result.greetings[0]?.isDefault).toBe(true);
    // Ensure no private fields in the response
    expect(result.greetings[0]).not.toHaveProperty("separatedVariableTags");
    expect(result.greetings[0]).not.toHaveProperty("separatedRemoteRefs");
    expect(result.greetings[0]).not.toHaveProperty("removedFragmentSummary");
  });
});

describe("initializeCardSession", () => {
  it("returns session init result on 201", async () => {
    const result = await initializeCardSession(
      {
        cardId: "a".repeat(64),
        greetingId: "g0",
        sessionId: "rp-web-test",
      },
      {
        fetcher: async () =>
          jsonResponse(
            {
              sessionId: "rp-web-test",
              cardId: "a".repeat(64),
              greetingId: "g0",
              memoryNamespace: "rp-session:rp-web-test",
              worldbookResourceRef: `card:${"a".repeat(64)}`,
              greetingTurnIndex: 1,
              greetingTurnId: "greeting-seed-v1:test",
              committed: true,
              deduplicated: false,
            },
            201,
          ),
      },
    );

    expect(result.committed).toBe(true);
    expect(result.deduplicated).toBe(false);
    expect(result.worldbookResourceRef).toBe(`card:${"a".repeat(64)}`);
    expect(result.memoryNamespace).toBe("rp-session:rp-web-test");
  });

  it("handles deduplicated response (200)", async () => {
    const result = await initializeCardSession(
      {
        cardId: "a".repeat(64),
        greetingId: "g0",
        sessionId: "rp-web-test",
      },
      {
        fetcher: async () =>
          jsonResponse(
            {
              sessionId: "rp-web-test",
              cardId: "a".repeat(64),
              greetingId: "g0",
              memoryNamespace: "rp-session:rp-web-test",
              worldbookResourceRef: `card:${"a".repeat(64)}`,
              greetingTurnIndex: 1,
              greetingTurnId: "greeting-seed-v1:test",
              committed: false,
              deduplicated: true,
            },
            200,
          ),
      },
    );

    expect(result.deduplicated).toBe(true);
    expect(result.committed).toBe(false);
  });
});

describe("error mapping", () => {
  it("maps 400 to validation error", async () => {
    await expectCardError(
      importCard(new File(["{}"], "card.json"), {
        fetcher: async () => jsonResponse({ error: "Missing file field" }, 400),
      }),
      { kind: "validation", retryable: false },
    );
  });

  it("maps 404 to not-found error", async () => {
    await expectCardError(
      getCard("a".repeat(64), {
        fetcher: async () => jsonResponse({ error: "Card not found" }, 404),
      }),
      { kind: "not-found", retryable: false },
    );
  });

  it("maps 409 to conflict error", async () => {
    const error = (await initializeCardSession(
      { cardId: "a".repeat(64), greetingId: "g0", sessionId: "s1" },
      {
        fetcher: async () =>
          jsonResponse({ error: "Session already has a different greeting" }, 409),
      },
    ).catch((e) => e)) as CardWebError;

    expect(error.kind).toBe("conflict");
    expect(error.retryable).toBe(false);
    // Must not expose raw server message
    expect(error.message).not.toContain("already has a different greeting");
  });

  it("maps 413 to file-too-large error", async () => {
    await expectCardError(
      importCard(new File(["{}"], "card.json"), {
        fetcher: async () => jsonResponse({ error: "File size 999 exceeds limit 100" }, 413),
      }),
      { kind: "file-too-large", retryable: false },
    );
  });

  it("maps 415 to unsupported-type error", async () => {
    await expectCardError(
      importCard(new File(["{}"], "card.json"), {
        fetcher: async () => jsonResponse({ error: "Content-Type must be multipart" }, 415),
      }),
      { kind: "unsupported-type", retryable: false },
    );
  });

  it("maps 422 to invalid-card error", async () => {
    await expectCardError(
      importCard(new File(["{}"], "card.json"), {
        fetcher: async () => jsonResponse({ error: "Unsupported spec: v2" }, 422),
      }),
      { kind: "invalid-card", retryable: false },
    );
  });

  it("maps 500 to unknown retryable error", async () => {
    await expectCardError(
      importCard(new File(["{}"], "card.json"), {
        fetcher: async () => jsonResponse({ error: "Internal error" }, 500),
      }),
      { kind: "unknown", retryable: true },
    );
  });

  it("maps network error (TypeError) to network kind", async () => {
    await expect(
      importCard(new File(["{}"], "card.json"), {
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

  it("maps abort error to aborted kind", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      importCard(new File(["{}"], "card.json"), {
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

describe("security: no sensitive data leakage", () => {
  it("does not expose stack traces in error messages", async () => {
    const error = (await importCard(new File(["{}"], "card.json"), {
      fetcher: async () =>
        jsonResponse(
          {
            error:
              "TypeError: Cannot read properties at /home/server/src/cards.ts:42\n  at processTicks",
          },
          500,
        ),
    }).catch((e) => e)) as CardWebError;

    expect(error.message).not.toContain("TypeError");
    expect(error.message).not.toContain("/home/server");
    expect(error.message).not.toContain("cards.ts");
    expect(error.message).not.toContain("processTicks");
  });

  it("does not expose file paths in error messages", async () => {
    const error = (await importCard(new File(["{}"], "card.json"), {
      fetcher: async () => jsonResponse({ error: "ENOENT: /data/cards/abc123/source.json" }, 500),
    }).catch((e) => e)) as CardWebError;

    expect(error.message).not.toContain("/data/cards");
    expect(error.message).not.toContain("source.json");
    expect(error.message).not.toContain("ENOENT");
  });

  it("does not expose raw response body in error messages", async () => {
    const rawBody = '{"error":"internal","debug":{"sql":"SELECT * FROM cards"}}';
    const error = (await importCard(new File(["{}"], "card.json"), {
      fetcher: async () => new Response(rawBody, { status: 500 }),
    }).catch((e) => e)) as CardWebError;

    expect(error.message).not.toContain("SELECT");
    expect(error.message).not.toContain("debug");
    expect(error.message).not.toContain("sql");
  });

  it("handles malformed error body gracefully", async () => {
    await expectCardError(
      importCard(new File(["{}"], "card.json"), {
        fetcher: async () => new Response("not json", { status: 500 }),
      }),
      { kind: "unknown", retryable: true },
    );
  });
});
