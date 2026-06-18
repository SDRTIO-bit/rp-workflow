/**
 * P-15.3A-2: Greeting Session Service Tests.
 *
 * Coverage (from spec section 12, tests 17-25):
 *  17. Greeting directly into Session, no LLM call
 *  18. Identical repeat init is idempotent
 *  19. Same session, different greeting → 409
 *  20. Session with ongoing conversation → 409
 *  21. Greeting not double-appended on repeat
 *  22. memoryNamespace default correct
 *  23. worldbookResourceRef correct
 *  24. JSON Patch inside greeting is NOT applied
 *  25. Greeting marker does NOT enter the Agent Prompt
 *
 * Uses sanitized fixtures from packages/card-import/__fixtures__.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FileCardStore } from "@awp/card-import";
import { InMemoryDynamicWorldbookStore } from "@awp/workflow-worldbook";
import { InMemoryAgentSessionStore } from "@awp/agent-runtime";
import {
  GreetingSessionService,
  WRITER_AGENT_NODE_ID,
  isGreetingSeedTurn,
} from "./greetingSessionService.js";
import { CardImportService } from "../services/cardImportService.js";
import { sessionContextToMarkdown } from "@awp/agent-runtime";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "card-import",
  "src",
  "__fixtures__",
);

async function loadFixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(fixturesDir, name)));
}

const TEST_LIMITS = {
  maxBytes: 5_242_880,
  maxJsonDepth: 64,
  maxWorldbookEntries: 2_000,
  maxGreetings: 100,
};

interface Harness {
  service: GreetingSessionService;
  cardStore: FileCardStore;
  sessionStore: InMemoryAgentSessionStore;
  worldbookStore: InMemoryDynamicWorldbookStore;
  cardImportService: CardImportService;
  tempDir: string;
}

async function buildHarness(): Promise<Harness> {
  const tempDir = await mkdtemp(join(tmpdir(), "awp-greeting-svc-"));
  const cardStore = new FileCardStore(tempDir);
  const cardImportService = new CardImportService(cardStore, TEST_LIMITS);
  const sessionStore = new InMemoryAgentSessionStore();
  const worldbookStore = new InMemoryDynamicWorldbookStore();
  const service = new GreetingSessionService(cardStore, sessionStore, worldbookStore);
  return { service, cardStore, sessionStore, worldbookStore, cardImportService, tempDir };
}

async function importMinimalV3(h: Harness): Promise<string> {
  const bytes = await loadFixtureBytes("minimal-v3.json");
  const result = await h.cardImportService.importCard(bytes, "minimal.json");
  return result.cardId;
}

async function importVarConditions(h: Harness): Promise<string> {
  // This fixture has greetings with {{setvar:...}} tags that should be
  // cleaned out by the greeting cleaner, plus a JSON Patch-shaped extension.
  const bytes = await loadFixtureBytes("var-conditions-v3.json");
  const result = await h.cardImportService.importCard(bytes, "vars.json");
  return result.cardId;
}

describe("GreetingSessionService (P-15.3A-2)", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness();
  });

  afterEach(async () => {
    await rm(h.tempDir, { recursive: true, force: true });
  });

  // ── Test 17: greeting directly into Session, no LLM call ────────────

  it("test 17: greeting is committed directly as assistantOutput; no LLM call is made", async () => {
    const cardId = await importMinimalV3(h);
    const sessionId = "greet-session-001";

    // Sanity: no sessions exist before init
    const before = await h.sessionStore.load({
      tenantId: "default",
      workflowInstanceId: "rp-prod-1",
      conversationId: sessionId,
      agentNodeId: WRITER_AGENT_NODE_ID,
    });
    expect(before).toBeNull();

    const result = await h.service.initSession({
      cardId,
      greetingId: "g0",
      sessionId,
    });

    expect(result.committed).toBe(true);
    expect(result.deduplicated).toBe(false);
    expect(result.greetingTurnIndex).toBe(1);
    expect(result.greetingTurnId).toMatch(/^greeting-seed-v1:/);

    // The session is now persisted with exactly ONE turn
    const after = await h.sessionStore.load({
      tenantId: "default",
      workflowInstanceId: "rp-prod-1",
      conversationId: sessionId,
      agentNodeId: WRITER_AGENT_NODE_ID,
    });
    expect(after).not.toBeNull();
    expect(after!.turns).toHaveLength(1);
    // input is "" (empty string), NOT null. sessionContextToMarkdown's
    // `if (input)` check is falsy for "" → the greeting seed produces
    // NO "Player:" line in the prompt (no "User: null" pollution).
    expect(after!.turns[0]!.input).toBe("");
    expect(typeof after!.turns[0]!.assistantOutput).toBe("string");
    expect((after!.turns[0]!.assistantOutput as string).length).toBeGreaterThan(0);
  });

  // ── Test 18: identical repeat init is idempotent ────────────────────

  it("test 18: identical re-init returns deduplicated=true without re-appending", async () => {
    const cardId = await importMinimalV3(h);
    const sessionId = "greet-session-dedup";

    const r1 = await h.service.initSession({ cardId, greetingId: "g0", sessionId });
    expect(r1.committed).toBe(true);
    expect(r1.deduplicated).toBe(false);

    const r2 = await h.service.initSession({ cardId, greetingId: "g0", sessionId });
    expect(r2.committed).toBe(false);
    expect(r2.deduplicated).toBe(true);
    expect(r2.greetingTurnIndex).toBe(1);
    expect(r2.greetingTurnId).toBe(r1.greetingTurnId);

    // Session has exactly ONE turn (not two)
    const session = await h.sessionStore.load({
      tenantId: "default",
      workflowInstanceId: "rp-prod-1",
      conversationId: sessionId,
      agentNodeId: WRITER_AGENT_NODE_ID,
    });
    expect(session!.turns).toHaveLength(1);
  });

  // ── Test 19: same session, different greetingId → 409 ─────────────

  it("test 19: same session with a different greetingId returns session-conflict", async () => {
    // Use a card with multiple greetings so we have a "different greeting"
    // we can switch to on the same session.
    const multiBytes = await loadFixtureBytes("greetings-v3.json");
    const multiResult = await h.cardImportService.importCard(multiBytes, "multi.json");
    const multiCardId = multiResult.cardId;
    expect(multiResult.greetings.length).toBeGreaterThan(1);

    const sessionId = "greet-session-conflict";
    const r1 = await h.service.initSession({
      cardId: multiCardId,
      greetingId: "g0",
      sessionId,
    });
    expect(r1.committed).toBe(true);

    // Same session, same cardId, DIFFERENT greetingId → must be rejected.
    await expect(
      h.service.initSession({ cardId: multiCardId, greetingId: "g3", sessionId }),
    ).rejects.toMatchObject({ code: "session-conflict" });

    // The session should still have exactly 1 turn — the conflict must NOT
    // append a new turn.
    const session = await h.sessionStore.load({
      tenantId: "default",
      workflowInstanceId: "rp-prod-1",
      conversationId: sessionId,
      agentNodeId: WRITER_AGENT_NODE_ID,
    });
    expect(session!.turns).toHaveLength(1);
  });

  it("test 19b: same session, same greetingId, but a different cardId also returns session-conflict", async () => {
    // The session is "owned" by the card that first seeded it. Switching
    // cards mid-session is refused — the user must create a new session.
    const cardA = await importMinimalV3(h);
    const multiBytes = await loadFixtureBytes("greetings-v3.json");
    const cardB = (await h.cardImportService.importCard(multiBytes, "multi.json")).cardId;

    const sessionId = "greet-session-card-switch";
    const r1 = await h.service.initSession({ cardId: cardA, greetingId: "g0", sessionId });
    expect(r1.committed).toBe(true);

    // Same session, same greetingId, but DIFFERENT card → conflict.
    await expect(
      h.service.initSession({ cardId: cardB, greetingId: "g0", sessionId }),
    ).rejects.toMatchObject({ code: "session-conflict" });
  });

  // ── Test 20: session with ongoing conversation → 409 ───────────────

  it("test 20: a session with a non-greeting turn returns session-conflict", async () => {
    const cardId = await importMinimalV3(h);
    const sessionId = "greet-session-conversation";

    // First commit a greeting (turnIndex 1, marker = card-import)
    await h.service.initSession({ cardId, greetingId: "g0", sessionId });

    // Manually append a non-greeting turn (simulating real conversation)
    // directly to the underlying session store.
    const sessionKey = {
      tenantId: "default",
      workflowInstanceId: "rp-prod-1",
      conversationId: sessionId,
      agentNodeId: WRITER_AGENT_NODE_ID,
    };
    await h.sessionStore.append(sessionKey, {
      sessionKey,
      newTurn: {
        turnIndex: 2,
        input: "player action",
        assistantOutput: "agent reply",
        // NO modelConfig.provider === "card-import" — this is a real turn
        modelConfig: { model: "real-model" },
        tokenUsage: { input: 10, output: 20 },
        createdAt: new Date().toISOString(),
      },
    });

    // Now attempt to (re-)seed the same session with the same greeting.
    // The greeting session service must reject: conversation in progress.
    await expect(
      h.service.initSession({ cardId, greetingId: "g0", sessionId }),
    ).rejects.toMatchObject({ code: "session-conflict" });
  });

  // ── Test 21: greeting not double-appended ──────────────────────────

  it("test 21: 5 identical re-inits leave exactly 1 turn in the session", async () => {
    const cardId = await importMinimalV3(h);
    const sessionId = "greet-session-no-double-append";

    for (let i = 0; i < 5; i++) {
      const r = await h.service.initSession({ cardId, greetingId: "g0", sessionId });
      if (i === 0) {
        expect(r.committed).toBe(true);
        expect(r.deduplicated).toBe(false);
      } else {
        expect(r.committed).toBe(false);
        expect(r.deduplicated).toBe(true);
      }
    }

    const session = await h.sessionStore.load({
      tenantId: "default",
      workflowInstanceId: "rp-prod-1",
      conversationId: sessionId,
      agentNodeId: WRITER_AGENT_NODE_ID,
    });
    expect(session!.turns).toHaveLength(1);
  });

  // ── Test 22: memoryNamespace default correct ───────────────────────

  it("test 22: memoryNamespace defaults to 'rp-session:<sessionId>'", async () => {
    const cardId = await importMinimalV3(h);
    const sessionId = "greet-namespace-default";

    const r1 = await h.service.initSession({ cardId, greetingId: "g0", sessionId });
    expect(r1.memoryNamespace).toBe(`rp-session:${sessionId}`);

    // Explicit namespace passes through unchanged
    const r2 = await h.service.initSession({
      cardId,
      greetingId: "g0",
      sessionId: "greet-namespace-explicit",
      memoryNamespace: "custom-ns:abc",
    });
    expect(r2.memoryNamespace).toBe("custom-ns:abc");
  });

  // ── Test 23: worldbookResourceRef correct ──────────────────────────

  it("test 23: worldbookResourceRef is 'card:<cardId>'", async () => {
    const cardId = await importMinimalV3(h);
    const sessionId = "greet-wb-ref";

    const r = await h.service.initSession({ cardId, greetingId: "g0", sessionId });
    expect(r.worldbookResourceRef).toBe(`card:${cardId}`);
  });

  // ── Test 24: JSON Patch inside greeting is NOT applied ─────────────

  it("test 24: greeting content does not include applied JSON Patch output; cleaned text is stored as-is", async () => {
    const cardId = await importVarConditions(h);
    const sessionId = "greet-no-patch";

    const r = await h.service.initSession({ cardId, greetingId: "g0", sessionId });
    expect(r.committed).toBe(true);

    const session = await h.sessionStore.load({
      tenantId: "default",
      workflowInstanceId: "rp-prod-1",
      conversationId: sessionId,
      agentNodeId: WRITER_AGENT_NODE_ID,
    });
    expect(session).not.toBeNull();
    const assistantOutput = session!.turns[0]!.assistantOutput as string;

    // The original greeting had `{{setvar:mood:happy}}`. The cleaner
    // removes variable-update tags; the stored content should NOT contain
    // the setvar tag.
    expect(assistantOutput).not.toMatch(/setvar:/i);
    // The cleaned greeting text starts with "Welcome to the variable test."
    expect(assistantOutput).toContain("Welcome to the variable test");
    // No {{ ... }} pattern should remain (those were variable tags).
    expect(assistantOutput).not.toMatch(/\{\{[^}]*\}\}/);
  });

  // ── Test 25: greeting marker does NOT enter the Agent Prompt ───────

  it("test 25: modelConfig.marker is prompt-invisible; the session markdown has no cardId/greetingId/marker", async () => {
    const cardId = await importMinimalV3(h);
    const sessionId = "greet-marker-invisible";

    await h.service.initSession({ cardId, greetingId: "g0", sessionId });

    // Load the session from the store (not from the seed-only API)
    const session = await h.sessionStore.load({
      tenantId: "default",
      workflowInstanceId: "rp-prod-1",
      conversationId: sessionId,
      agentNodeId: WRITER_AGENT_NODE_ID,
    });
    expect(session).not.toBeNull();
    const turn = session!.turns[0]!;
    expect(isGreetingSeedTurn(turn)).toBe(true);

    // Render the session through the same markdown renderer the LLM sees
    const markdown = sessionContextToMarkdown(session!);

    // The marker string `greeting-seed-v1:<cardId>:g0:...` must NOT appear
    // in the player-visible prompt.
    expect(markdown).not.toMatch(/greeting-seed-v1/);
    expect(markdown).not.toContain(cardId);
    expect(markdown).not.toMatch(/greeting-seed/);
    expect(markdown).not.toMatch(/card-import/);
    // The greeting content (cleaned) IS in the prompt (as Assistant text)
    const assistantOutput = turn.assistantOutput as string;
    expect(markdown).toContain(assistantOutput.slice(0, 40));
  });

  // ── Bonus: identifier validation ───────────────────────────────────

  it("rejects invalid cardId, sessionId, and greetingId", async () => {
    const cardId = await importMinimalV3(h);
    const baseReq = { cardId, greetingId: "g0", sessionId: "ok-session" };
    await expect(h.service.initSession({ ...baseReq, cardId: "not-a-hash" })).rejects.toMatchObject(
      { code: "invalid-identifier" },
    );
    await expect(
      h.service.initSession({ ...baseReq, sessionId: "has space" }),
    ).rejects.toMatchObject({ code: "invalid-identifier" });
    await expect(h.service.initSession({ ...baseReq, greetingId: "G0" })).rejects.toMatchObject({
      code: "invalid-identifier",
    });
    await expect(h.service.initSession({ ...baseReq, greetingId: "0" })).rejects.toMatchObject({
      code: "invalid-identifier",
    });
  });

  it("returns card-not-found when cardId does not exist", async () => {
    const fakeCardId = "a".repeat(64);
    await expect(
      h.service.initSession({ cardId: fakeCardId, greetingId: "g0", sessionId: "ok" }),
    ).rejects.toMatchObject({ code: "card-not-found" });
  });

  it("returns greeting-not-found when greetingId is not on the card", async () => {
    const cardId = await importMinimalV3(h);
    await expect(
      h.service.initSession({ cardId, greetingId: "g99", sessionId: "ok" }),
    ).rejects.toMatchObject({ code: "greeting-not-found" });
  });
});
