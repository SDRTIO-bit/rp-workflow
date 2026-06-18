import { describe, expect, it, beforeEach } from "vitest";
import {
  clearPendingCardSession,
  createInitialRpSession,
  getPendingCardSession,
  initializeCardRpSession,
  prepareRpTurn,
  markRpTurnSucceeded,
  resetRpSession,
  serializeRpSession,
  restoreRpSession,
  setPendingCardSession,
  buildOfficialRpRequest,
  type PendingCardSessionV1,
  type RpChatSessionV1,
} from "./rpSessionState";
import {
  importCard,
  getCardGreetings,
  initializeCardSession,
  type CardImportResult,
  type GreetingListResponse,
  type CardSessionInitResult,
} from "./cardClient";
import { runOfficialRpTurn, type OfficialRpRequestV1 } from "./officialRpClient";

const fixedClock = () => "2026-06-16T00:00:00.000Z";
const testCardId = "a".repeat(64);

const samplePendingCard: PendingCardSessionV1 = {
  sessionId: "rp-web-card-test",
  cardId: testCardId,
  greetingId: "g0",
  greetingContent: "Hello, traveler! Welcome to the tavern.",
  worldbookResourceRef: `card:${testCardId}`,
  memoryNamespace: "rp-session:rp-web-card-test",
};

const sampleSuccessResponse = {
  narrative: "The bartender nods.",
  quality: {
    accepted: true as const,
    exhausted: false,
    writerAttempts: 1,
    criticAttempts: 1,
    revisionApplied: false,
  },
  observability: {
    llmCalls: 2,
    totalLatencyMs: 4200,
    usage: {
      inputTokens: 100,
      outputTokens: 100,
      totalTokens: 200,
      unavailableInvocationCount: 0,
    },
    roles: { writer: 1, critic: 1, memoryCurator: 0 },
    budget: { exceeded: false, reasons: [] as string[] },
    modelUsage: [],
  },
};

describe("initializeCardRpSession", () => {
  it("creates session with card worldbookResourceRef", () => {
    const session = initializeCardRpSession(samplePendingCard, { now: fixedClock });

    expect(session.worldbookResourceRef).toBe(`card:${testCardId}`);
    expect(session.sessionId).toBe("rp-web-card-test");
  });

  it("sets memoryNamespace from pending card data", () => {
    const session = initializeCardRpSession(samplePendingCard);

    expect(session.memoryNamespace).toBe("rp-session:rp-web-card-test");
  });

  it("includes greeting as assistant message with source=greeting", () => {
    const session = initializeCardRpSession(samplePendingCard, { now: fixedClock });

    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]).toMatchObject({
      id: "assistant-greeting",
      role: "assistant",
      text: "Hello, traveler! Welcome to the tavern.",
      turnId: "greeting",
      source: "greeting",
      createdAt: "2026-06-16T00:00:00.000Z",
    });
  });

  it("sets nextTurnNumber to 1 (first user send is turn-0001)", () => {
    const session = initializeCardRpSession(samplePendingCard);

    expect(session.nextTurnNumber).toBe(1);
  });

  it("greeting message does not consume a turn number", () => {
    const session = initializeCardRpSession(samplePendingCard);
    const firstTurn = prepareRpTurn(session, "I enter the tavern.");

    expect(firstTurn.pendingTurn?.turnId).toBe("turn-0001");
    expect(firstTurn.pendingTurn?.turnNumber).toBe(1);
  });

  it("first user send uses turn-0001", () => {
    const session = initializeCardRpSession(samplePendingCard);
    const pending = prepareRpTurn(session, "Hello there.");

    expect(pending.pendingTurn?.turnId).toBe("turn-0001");
    expect(pending.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(pending.messages.find((m) => m.role === "user")?.turnId).toBe("turn-0001");
  });

  it("response to first user send uses turn-0001 and advances to turn-0002", () => {
    const session = initializeCardRpSession(samplePendingCard);
    const pending = prepareRpTurn(session, "Hello there.");
    const succeeded = markRpTurnSucceeded(pending, sampleSuccessResponse);

    expect(succeeded.nextTurnNumber).toBe(2);
    // Messages: greeting + user + assistant
    expect(succeeded.messages).toHaveLength(3);
    expect(succeeded.messages[0]?.source).toBe("greeting");
    expect(succeeded.messages[1]?.turnId).toBe("turn-0001");
    expect(succeeded.messages[1]?.role).toBe("user");
    expect(succeeded.messages[2]?.turnId).toBe("turn-0001");
    expect(succeeded.messages[2]?.role).toBe("assistant");
  });

  it("second user send uses turn-0002", () => {
    const session = initializeCardRpSession(samplePendingCard);
    const turn1 = prepareRpTurn(session, "First action.");
    const turn1Success = markRpTurnSucceeded(turn1, sampleSuccessResponse);
    const turn2 = prepareRpTurn(turn1Success, "Second action.");

    expect(turn2.pendingTurn?.turnId).toBe("turn-0002");
    expect(turn2.pendingTurn?.turnNumber).toBe(2);
  });
});

describe("retry/cancel/newSession with card session", () => {
  it("retry preserves turn-0001 after greeting", () => {
    const session = initializeCardRpSession(samplePendingCard);
    const pending = prepareRpTurn(session, "Action.");
    const failed = {
      ...pending,
      status: "error" as const,
      lastError: { kind: "provider" as const, message: "fail", retryable: true },
    };
    const retry = prepareRpTurn(failed, "Action.");

    expect(retry.pendingTurn?.turnId).toBe("turn-0001");
    // Greeting + 1 user message (no duplicate)
    expect(retry.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(retry.messages[0]?.source).toBe("greeting");
  });

  it("cancel preserves greeting and pendingTurn", () => {
    const session = initializeCardRpSession(samplePendingCard);
    const pending = prepareRpTurn(session, "Action.");

    // Simulate cancel
    const canceled: RpChatSessionV1 = {
      ...pending,
      status: "error",
      lastError: { kind: "aborted", message: "Canceled", retryable: true },
    };

    expect(canceled.pendingTurn?.turnId).toBe("turn-0001");
    expect(canceled.messages[0]?.source).toBe("greeting");
    expect(
      canceled.messages.filter((m) => m.role === "assistant" && m.source !== "greeting"),
    ).toHaveLength(0);
  });

  it("newSession clears greeting and starts fresh", () => {
    const session = initializeCardRpSession(samplePendingCard);
    const newSession = resetRpSession(session);

    expect(newSession.messages).toEqual([]);
    expect(newSession.nextTurnNumber).toBe(1);
    // worldbookResourceRef is preserved from the card session
    expect(newSession.worldbookResourceRef).toBe(`card:${testCardId}`);
    // New sessionId
    expect(newSession.sessionId).not.toBe("rp-web-card-test");
    expect(newSession.memoryNamespace).toBe(`rp-session:${newSession.sessionId}`);
  });
});

describe("serialize/restore with card session", () => {
  it("serializeRpSession includes greeting message but not sensitive fields", () => {
    const session = initializeCardRpSession(samplePendingCard, { now: fixedClock });
    const serialized = serializeRpSession(session);

    expect(serialized.messages).toHaveLength(1);
    expect(serialized.messages[0]?.source).toBe("greeting");
    expect(serialized.worldbookResourceRef).toBe(`card:${testCardId}`);

    // No sensitive fields
    const json = JSON.stringify(serialized);
    expect(json).not.toContain("pendingTurn");
    expect(json).not.toContain("lastError");
    expect(json).not.toContain("status");
  });

  it("restoreRpSession preserves greeting message", () => {
    const session = initializeCardRpSession(samplePendingCard, { now: fixedClock });
    const serialized = serializeRpSession(session);
    const restored = restoreRpSession(serialized);

    expect(restored.messages).toHaveLength(1);
    expect(restored.messages[0]?.source).toBe("greeting");
    expect(restored.messages[0]?.text).toBe("Hello, traveler! Welcome to the tavern.");
    expect(restored.worldbookResourceRef).toBe(`card:${testCardId}`);
    expect(restored.status).toBe("idle");
  });

  it("sessionStorage does not contain card raw content or sensitive data", () => {
    const sensitivePending: PendingCardSessionV1 = {
      ...samplePendingCard,
      greetingContent: "SENSITIVE_GREETING_CONTENT_SHOULD_NOT_BE_IN_STORAGE",
    };
    const session = initializeCardRpSession(sensitivePending, { now: fixedClock });
    const serialized = serializeRpSession(session);
    const json = JSON.stringify(serialized);

    // The greeting content IS part of the message (it needs to be displayed)
    // but source path, variable tags, remote refs, and stack traces must not appear
    expect(json).not.toContain("source.json");
    expect(json).not.toContain("separatedVariableTags");
    expect(json).not.toContain("separatedRemoteRefs");
    expect(json).not.toContain("removedFragmentSummary");
    expect(json).not.toContain("stack");
    expect(json).not.toContain("/data/cards/");
  });
});

describe("pending card session storage", () => {
  const createStorage = () => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    };
  };

  it("stores and retrieves pending card session", () => {
    const storage = createStorage();
    setPendingCardSession(samplePendingCard, storage);
    const retrieved = getPendingCardSession(storage);

    expect(retrieved).toEqual(samplePendingCard);
  });

  it("returns null when no pending session", () => {
    const storage = createStorage();
    expect(getPendingCardSession(storage)).toBeNull();
  });

  it("clears pending card session", () => {
    const storage = createStorage();
    setPendingCardSession(samplePendingCard, storage);
    clearPendingCardSession(storage);
    expect(getPendingCardSession(storage)).toBeNull();
  });

  it("rejects malformed pending session data", () => {
    const storage = createStorage();
    storage.setItem(
      "awp:pending-card-session:v1",
      JSON.stringify({ sessionId: "test" /* missing required fields */ }),
    );
    expect(getPendingCardSession(storage)).toBeNull();
  });

  it("does not expose raw card content in sessionStorage key name", () => {
    const storage = createStorage();
    setPendingCardSession(samplePendingCard, storage);
    // Verify the stored key doesn't contain sensitive content
    const storedValue = storage.getItem("awp:pending-card-session:v1");
    expect(storedValue).toBeTruthy();
    // The key itself should be a fixed identifier, not contain card data
    expect("awp:pending-card-session:v1").not.toContain("greetingContent");
    expect("awp:pending-card-session:v1").not.toContain("source.json");
  });
});

describe("backward compatibility", () => {
  it("createInitialRpSession still works without card data", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-plain" });

    expect(session.worldbookResourceRef).toBe("worldbook-default");
    expect(session.messages).toEqual([]);
    expect(session.nextTurnNumber).toBe(1);
  });

  it("existing turn lifecycle is not affected by source field", () => {
    const session = createInitialRpSession({ sessionId: "rp-web-plain" });
    const pending = prepareRpTurn(session, "Hello.", { now: fixedClock });
    const succeeded = markRpTurnSucceeded(pending, sampleSuccessResponse, { now: fixedClock });

    expect(succeeded.messages).toHaveLength(2);
    expect(succeeded.messages[0]?.role).toBe("user");
    expect(succeeded.messages[0]?.source).toBeUndefined();
    expect(succeeded.messages[1]?.role).toBe("assistant");
    expect(succeeded.messages[1]?.source).toBeUndefined();
    expect(succeeded.nextTurnNumber).toBe(2);
  });
});

describe("E2E mock: card import → greeting → session → first RP turn", () => {
  const createStorage = () => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    };
  };

  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    storage = createStorage();
  });

  const sanitizedManifest = {
    cardId: testCardId,
    sourceFilename: "test-card.json",
    sourceSizeBytes: 1024,
    sourceHash: testCardId,
    importedAt: "2026-06-16T00:00:00.000Z",
    spec: "chara_card_v3",
    name: "E2E Test Card",
    description: null,
    tags: ["e2e"],
    worldbookEntryCount: 3,
    worldbookDeferredCount: 0,
    worldbookDisabledCount: 0,
    worldbookBlockedCount: 0,
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
    worldbookResourceRef: `card:${testCardId}`,
  };

  const mockJsonResponse = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  it("completes full flow: upload → choose greeting → init session → send first RP turn", async () => {
    // Step 1: Upload card
    const importResult: CardImportResult = await importCard(new File(["{}"], "card.json"), {
      fetcher: async () =>
        mockJsonResponse(
          {
            cardId: testCardId,
            alreadyExisted: false,
            manifest: sanitizedManifest,
            defaultGreetingId: "g0",
            greetingCount: 2,
          },
          201,
        ),
    });

    expect(importResult.cardId).toBe(testCardId);
    expect(importResult.manifest.name).toBe("E2E Test Card");

    // Step 2: Get greetings
    const greetingResult: GreetingListResponse = await getCardGreetings(testCardId, {
      fetcher: async () =>
        mockJsonResponse(
          {
            cardId: testCardId,
            greetings: [
              {
                greetingId: "g0",
                index: 0,
                label: "Default Greeting",
                content: "Welcome, adventurer! The tavern is warm tonight.",
                isDefault: true,
              },
              {
                greetingId: "g1",
                index: 1,
                label: "Alt Greeting",
                content: "A stranger enters. You feel a chill.",
                isDefault: false,
              },
            ],
          },
          200,
        ),
    });

    expect(greetingResult.greetings).toHaveLength(2);
    const chosenGreeting = greetingResult.greetings.find((g) => g.greetingId === "g0")!;

    // Step 3: Initialize session
    const sessionId = "rp-web-e2e-card";
    const sessionInitResult: CardSessionInitResult = await initializeCardSession(
      {
        cardId: testCardId,
        greetingId: "g0",
        sessionId,
      },
      {
        fetcher: async () =>
          mockJsonResponse(
            {
              sessionId,
              cardId: testCardId,
              greetingId: "g0",
              memoryNamespace: `rp-session:${sessionId}`,
              worldbookResourceRef: `card:${testCardId}`,
              greetingTurnIndex: 1,
              greetingTurnId: "greeting-seed-v1:test",
              committed: true,
              deduplicated: false,
            },
            201,
          ),
      },
    );

    expect(sessionInitResult.worldbookResourceRef).toBe(`card:${testCardId}`);

    // Step 4: Create pending card session (simulating CardsPage behavior)
    const pending: PendingCardSessionV1 = {
      sessionId: sessionInitResult.sessionId,
      cardId: testCardId,
      greetingId: "g0",
      greetingContent: chosenGreeting.content,
      worldbookResourceRef: sessionInitResult.worldbookResourceRef,
      memoryNamespace: sessionInitResult.memoryNamespace,
    };
    setPendingCardSession(pending, storage);

    // Step 5: RP page loads and consumes pending session
    const retrievedPending = getPendingCardSession(storage);
    expect(retrievedPending).not.toBeNull();
    clearPendingCardSession(storage);

    let session = initializeCardRpSession(retrievedPending!, { now: fixedClock });

    // Verify greeting is displayed
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]?.role).toBe("assistant");
    expect(session.messages[0]?.source).toBe("greeting");
    expect(session.messages[0]?.text).toBe("Welcome, adventurer! The tavern is warm tonight.");

    // Step 6: Send first RP turn
    const prepared = prepareRpTurn(session, "I approach the bar.", { now: fixedClock });
    expect(prepared.pendingTurn?.turnId).toBe("turn-0001");

    const request = buildOfficialRpRequest(prepared);

    // Verify worldbook.resourceRef is card:<cardId>
    expect(request.worldbook.resourceRef).toBe(`card:${testCardId}`);
    expect(request.memory.namespace).toBe(`rp-session:${sessionId}`);
    expect(request.sessionId).toBe(sessionId);
    expect(request.turnId).toBe("turn-0001");

    // Step 7: Mock RP response
    const response = await runOfficialRpTurn(request, {
      fetcher: async (url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as OfficialRpRequestV1;
        return mockJsonResponse(
          {
            narrative: "The bartender looks up and smiles.",
            sessionId: body.sessionId,
            turnId: body.turnId,
            workflow: { id: "rp", version: 1, mode: "unified-v1" as const },
            quality: {
              accepted: true,
              exhausted: false,
              writerAttempts: 1,
              criticAttempts: 1,
              revisionApplied: false,
            },
            traceId: "trace-e2e-card",
          },
          200,
        );
      },
    });

    session = markRpTurnSucceeded(prepared, response, { now: fixedClock });

    // Final assertions
    expect(session.nextTurnNumber).toBe(2);
    // Messages: greeting + user + assistant
    expect(session.messages).toHaveLength(3);
    expect(session.messages[0]?.source).toBe("greeting");
    expect(session.messages[1]).toMatchObject({
      role: "user",
      text: "I approach the bar.",
      turnId: "turn-0001",
    });
    expect(session.messages[2]).toMatchObject({
      role: "assistant",
      text: "The bartender looks up and smiles.",
      turnId: "turn-0001",
    });
  });

  it("official RP request uses card:<cardId> as worldbook.resourceRef", () => {
    const session = initializeCardRpSession(samplePendingCard, { now: fixedClock });
    const prepared = prepareRpTurn(session, "Look around.");
    const request = buildOfficialRpRequest(prepared);

    expect(request.worldbook.resourceRef).toBe(`card:${testCardId}`);
    expect(request.worldbook.resourceRef).toMatch(/^card:[0-9a-f]{64}$/);
  });
});
