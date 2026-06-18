/**
 * P-15.3A-2.1: Greeting→Writer Session Integration Tests.
 *
 * Coverage (from spec section IV):
 *  1. POST /api/cards/sessions 후, writer-main session에 Greeting이 load됨
 *  2. 첫 /api/rp의 Writer Prompt에 Greeting 正文 포함
 *  3. 첫 /api/rp의 Writer Prompt에 다음 없음:
 *     - greeting-seed marker
 *     - cardId
 *     - contentHash
 *     - "User: null"
 *  4. 첫 /api/rp 후, writer-main session에 최소 2개 assistant history:
 *     - Greeting seed
 *     - Writer response
 *  5. 동일 session init 반복 시 Greeting 중복 추가 없음
 *  6. 동일 session, 다른 greeting → 409
 *  7. 이미 정상 대화 진행 중 session → 409
 *
 * All tests use sanitized fixtures from packages/card-import/__fixtures__.
 */
import { describe, expect, it, beforeAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrap } from "../composition.js";
import type { ServerComposition } from "../composition.js";
import type { Env } from "../env.js";
import type { OfficialRpRequestV1, OfficialRpResponseV1 } from "./officialRpTypes.js";
import { CardImportService } from "../services/cardImportService.js";
import { WRITER_AGENT_NODE_ID, isGreetingSeedTurn } from "./greetingSessionService.js";
import {
  AgentSessionStore,
  sessionContextToMarkdown,
  type AgentSessionKeyV1,
  type AgentSessionContextV1,
} from "@awp/agent-runtime";

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

function loadFixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

function makeTestEnv(cardsDir: string, overrides: Partial<Env> = {}): Env {
  const dataDir = resolve(__dirname, "..", "..", "..", "..", "data");
  return {
    port: 0,
    dataDir,
    pluginsDir: resolve(dataDir, "..", "plugins"),
    deepseekApiKey: undefined,
    deepseekModel: "deepseek-v4-flash",
    openCodeApiKey: undefined,
    openCodeModel: "deepseek-v4-flash",
    nodeEnv: "test",
    rpProviderId: "mock",
    rpModel: "mock-model",
    rpMockOptIn: true,
    workflowMemoryStore: "in-memory",
    workflowMemoryDir: "",
    agentSessionStore: "in-memory",
    agentSessionDir: "",
    rpWorkflowVersion: "unified-v1",
    cardsDir,
    maxCardBytes: 5_242_880,
    maxCardJsonDepth: 64,
    maxCardWorldbookEntries: 2_000,
    maxCardGreetings: 100,
    ...overrides,
  };
}

async function postRp(
  app: ServerComposition["app"],
  body: OfficialRpRequestV1,
): Promise<{ status: number; data: OfficialRpResponseV1 | { error: string } }> {
  const res = await app.request("/api/rp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as OfficialRpResponseV1 | { error: string };
  return { status: res.status, data };
}

async function postCardsSession(
  app: ServerComposition["app"],
  body: { cardId: string; greetingId: string; sessionId: string; memoryNamespace?: string },
): Promise<{
  status: number;
  data:
    | {
        greetingTurnIndex: number;
        greetingTurnId: string;
        committed: boolean;
        deduplicated: boolean;
      }
    | { error: string };
}> {
  const res = await app.request("/api/cards/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as
    | {
        greetingTurnIndex: number;
        greetingTurnId: string;
        committed: boolean;
        deduplicated: boolean;
      }
    | { error: string };
  return { status: res.status, data };
}

async function importFixture(
  cardImportService: CardImportService,
  fixtureName: string,
): Promise<string> {
  const bytes = loadFixtureBytes(fixtureName);
  const result = await cardImportService.importCard(bytes, fixtureName);
  return result.cardId;
}

const writerSessionKey = (sessionId: string): AgentSessionKeyV1 => ({
  tenantId: "default",
  workflowInstanceId: "rp-prod-1",
  conversationId: sessionId,
  agentNodeId: WRITER_AGENT_NODE_ID,
});

// Shared across describe blocks so each suite cleans up its own temp dirs.
const sharedTempDirs: string[] = [];
const trackTempDir = (d: string) => {
  sharedTempDirs.push(d);
  return d;
};

describe("P-15.3A-2.1: Greeting lands in writer-main session", () => {
  let tempDirs = sharedTempDirs;
  let composition: ServerComposition;
  let cardImportService: CardImportService;
  let cardsDir: string;
  let sessionStore: AgentSessionStore;

  beforeAll(async () => {
    cardsDir = trackTempDir(mkdtempSync(join(tmpdir(), "awp-greeting-writer-")));
    composition = await bootstrap(makeTestEnv(cardsDir));
    cardImportService = composition.getCardsDeps().cardImportService;
    sessionStore = composition.getWorkflowRuntime().sessionStore!;
  }, 30_000);

  beforeEach(async () => {
    if (existsSync(cardsDir)) {
      for (const entry of readdirSync(cardsDir)) {
        rmSync(join(cardsDir, entry), { recursive: true, force: true });
      }
    }
  });

  afterEach(() => {
    for (const d of tempDirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
    tempDirs = [];
  });

  // ── Test 1: POST /api/cards/sessions 후, writer-main session에 Greeting이 load됨 ──

  it("test 1: after POST /api/cards/sessions, writer-main session loads the greeting", async () => {
    const cardId = await importFixture(cardImportService, "minimal-v3.json");
    const sessionId = "p21-test-1";

    const res = await postCardsSession(composition.app, {
      cardId,
      greetingId: "g0",
      sessionId,
    });
    expect(res.status).toBe(201);
    if ("error" in res.data) throw new Error(`Unexpected: ${res.data.error}`);

    // The writer-main session (NOT a separate greeting-seed session) must
    // now have exactly 1 turn: the greeting seed.
    const writerSession = await sessionStore.load(writerSessionKey(sessionId));
    expect(writerSession).not.toBeNull();
    expect(writerSession!.turns).toHaveLength(1);
    expect(isGreetingSeedTurn(writerSession!.turns[0]!)).toBe(true);
    expect(writerSession!.turns[0]!.input).toBe("");
    expect(typeof writerSession!.turns[0]!.assistantOutput).toBe("string");
    expect((writerSession!.turns[0]!.assistantOutput as string).length).toBeGreaterThan(0);
  });

  // ── Test 2: 첫 /api/rp의 Writer Prompt에 Greeting 正文 포함 ──────────

  it("test 2: first /api/rp's Writer Prompt contains the greeting body", async () => {
    const cardId = await importFixture(cardImportService, "minimal-v3.json");
    const sessionId = "p21-test-2";

    // Init greeting
    const initRes = await postCardsSession(composition.app, {
      cardId,
      greetingId: "g0",
      sessionId,
    });
    expect(initRes.status).toBe(201);

    // Approach: verify the Writer Prompt indirectly by reading the session
    // store AFTER the first /api/rp. The official RP workflow's sessionMd
    // node calls sessionContextToMarkdown, which reads from the sessionStore.
    // If the greeting is in the sessionStore, it WILL be in the Writer Prompt.
    const rpRes = await postRp(composition.app, {
      sessionId,
      turnId: "turn-0001",
      userInput: "我把钥匙放到吧台上，看着银铃",
      worldbook: { resourceRef: `card:${cardId}` },
      memory: { namespace: "rp-test:2" },
    });
    expect(rpRes.status).toBe(200);
    if ("error" in rpRes.data) throw new Error(`Unexpected: ${rpRes.data.error}`);

    // Now the writer-main session should have 2 turns: greeting seed + writer response.
    const writerSession = await sessionStore.load(writerSessionKey(sessionId));
    expect(writerSession).not.toBeNull();
    expect(writerSession!.turns.length).toBeGreaterThanOrEqual(2);

    // Render the session through the same markdown renderer the Writer sees
    const sessionContext: AgentSessionContextV1 = writerSession!;
    const markdown = sessionContextToMarkdown(sessionContext);

    // The greeting content (minimal-v3 fixture) must appear in the prompt
    expect(markdown).toContain("Welcome to the testing lab");
  });

  // ── Test 3: 첫 /api/rp의 Writer Prompt에 다음 없음 ──────────────────

  it("test 3: first /api/rp's Writer Prompt does NOT contain greeting marker, cardId, contentHash, or 'User: null'", async () => {
    const cardId = await importFixture(cardImportService, "minimal-v3.json");
    const sessionId = "p21-test-3";

    await postCardsSession(composition.app, {
      cardId,
      greetingId: "g0",
      sessionId,
    });

    await postRp(composition.app, {
      sessionId,
      turnId: "turn-0001",
      userInput: "hello",
      worldbook: { resourceRef: `card:${cardId}` },
      memory: { namespace: "rp-test:3" },
    });

    const writerSession = await sessionStore.load(writerSessionKey(sessionId));
    expect(writerSession).not.toBeNull();
    const markdown = sessionContextToMarkdown(writerSession!);

    // No greeting-seed marker
    expect(markdown).not.toMatch(/greeting-seed/);
    // No cardId (64 hex string)
    expect(markdown).not.toContain(cardId);
    // No contentHash pattern (sha_ prefix)
    expect(markdown).not.toMatch(/sha_[a-z0-9]+/);
    // No "User: null" pollution
    expect(markdown).not.toMatch(/User:\s*null/);
    expect(markdown).not.toMatch(/\*\*Player\*\*:\s*null/);
    // No greeting-seed-v1 marker
    expect(markdown).not.toContain("greeting-seed-v1");
  });

  // ── Test 4: 첫 /api/rp 후, writer-main session에 최소 2개 assistant history ──

  it("test 4: after first /api/rp, writer-main session has ≥2 assistant turns (greeting + writer response)", async () => {
    const cardId = await importFixture(cardImportService, "minimal-v3.json");
    const sessionId = "p21-test-4";

    await postCardsSession(composition.app, {
      cardId,
      greetingId: "g0",
      sessionId,
    });

    const rpRes = await postRp(composition.app, {
      sessionId,
      turnId: "turn-0001",
      userInput: "我把钥匙放到吧台上，看着银铃",
      worldbook: { resourceRef: `card:${cardId}` },
      memory: { namespace: "rp-test:4" },
    });
    expect(rpRes.status).toBe(200);
    if ("error" in rpRes.data) throw new Error(`Unexpected: ${rpRes.data.error}`);

    const writerSession = await sessionStore.load(writerSessionKey(sessionId));
    expect(writerSession).not.toBeNull();
    expect(writerSession!.turns.length).toBeGreaterThanOrEqual(2);

    // Turn 1: greeting seed (identified by modelConfig.provider === "card-import")
    const turn1 = writerSession!.turns[0]!;
    expect(isGreetingSeedTurn(turn1)).toBe(true);
    expect(typeof turn1.assistantOutput).toBe("string");
    expect((turn1.assistantOutput as string).length).toBeGreaterThan(0);

    // Turn 2: writer response (NOT a greeting seed)
    const turn2 = writerSession!.turns[1]!;
    expect(isGreetingSeedTurn(turn2)).toBe(false);
    expect(typeof turn2.assistantOutput).toBe("string");
    expect((turn2.assistantOutput as string).length).toBeGreaterThan(0);

    // Greeting content is in turn 1
    expect(turn1.assistantOutput as string).toContain("Welcome to the testing lab");

    // Note: persisted turnIndex is an internal counter, not the API turnId.
    // The spec explicitly says "不要强行让 persisted turnIndex 和 API turnId 对齐".
    // The exact turnIndex values depend on the buildSessionDelta executor's
    // implementation (it reads turnIndex from sessionKey JSON, defaulting to 1).
    // What matters is: (a) greeting is in the session, (b) writer response
    // is appended after, (c) Writer Prompt contains the greeting.
  });

  // ── Test 5: 동일 session init 반복 시 Greeting 중복 추가 없음 ──────

  it("test 5: 3 identical re-inits do not double-append the greeting", async () => {
    const cardId = await importFixture(cardImportService, "minimal-v3.json");
    const sessionId = "p21-test-5";

    for (let i = 0; i < 3; i++) {
      const res = await postCardsSession(composition.app, {
        cardId,
        greetingId: "g0",
        sessionId,
      });
      expect(res.status).toBeLessThan(300);
      if ("error" in res.data) throw new Error(`Unexpected: ${res.data.error}`);
      if (i === 0) {
        expect(res.data.committed).toBe(true);
        expect(res.data.deduplicated).toBe(false);
      } else {
        expect(res.data.committed).toBe(false);
        expect(res.data.deduplicated).toBe(true);
      }
    }

    const writerSession = await sessionStore.load(writerSessionKey(sessionId));
    expect(writerSession!.turns).toHaveLength(1);
  });

  // ── Test 6: 동일 session, 다른 greeting → 409 ────────────────────────

  it("test 6: same session, different greetingId → 409", async () => {
    // Use the multi-greeting fixture so we have a 'g3' to switch to.
    const cardId = await importFixture(cardImportService, "greetings-v3.json");
    const sessionId = "p21-test-6";

    const r1 = await postCardsSession(composition.app, {
      cardId,
      greetingId: "g0",
      sessionId,
    });
    expect(r1.status).toBe(201);

    // Same session, same card, DIFFERENT greetingId → 409
    const r2 = await postCardsSession(composition.app, {
      cardId,
      greetingId: "g3",
      sessionId,
    });
    expect(r2.status).toBe(409);
    if (!("error" in r2.data)) throw new Error("Expected error response");
    expect(r2.data.error).toMatch(/different greeting|conflict/i);
  });

  // ── Test 7: 이미 정상 대화 진행 중 session → 409 ──────────────────────

  it("test 7: session with ongoing conversation → 409", async () => {
    const cardId = await importFixture(cardImportService, "minimal-v3.json");
    const sessionId = "p21-test-7";

    // Init greeting
    const r1 = await postCardsSession(composition.app, {
      cardId,
      greetingId: "g0",
      sessionId,
    });
    expect(r1.status).toBe(201);

    // First /api/rp — creates a real writer turn
    const rpRes = await postRp(composition.app, {
      sessionId,
      turnId: "turn-0001",
      userInput: "hello",
      worldbook: { resourceRef: `card:${cardId}` },
      memory: { namespace: "rp-test:7" },
    });
    expect(rpRes.status).toBe(200);

    // Now try to re-init the same session with the same greeting → 409
    // (conversation is already in progress)
    const r2 = await postCardsSession(composition.app, {
      cardId,
      greetingId: "g0",
      sessionId,
    });
    expect(r2.status).toBe(409);
    if (!("error" in r2.data)) throw new Error("Expected error response");
    expect(r2.data.error).toMatch(/conversation|conflict/i);
  });

  // ── Bonus: sessionContextToMarkdown produces no "Player: null" for empty input ──

  it("bonus: sessionContextToMarkdown skips empty-string input (no 'Player:' line)", async () => {
    const cardId = await importFixture(cardImportService, "minimal-v3.json");
    const sessionId = "p21-test-bonus";

    await postCardsSession(composition.app, {
      cardId,
      greetingId: "g0",
      sessionId,
    });

    const writerSession = await sessionStore.load(writerSessionKey(sessionId));
    const markdown = sessionContextToMarkdown(writerSession!);

    // The greeting seed has input: "" which is falsy → sessionContextToMarkdown
    // skips it. The greeting assistantOutput is rendered as "Agent:".
    expect(markdown).not.toMatch(/\*\*Player\*\*:/);
    expect(markdown).toContain("**Agent**:");
  });
});

// ── /api/rp Card Error Code Tests (spec section V) ──────────────────────

describe("P-15.3A-2.1: /api/rp card error codes", () => {
  let tempDirs: string[] = [];
  let composition: ServerComposition;
  let cardImportService: CardImportService;
  let cardsDir: string;

  beforeAll(async () => {
    cardsDir = trackTempDir(mkdtempSync(join(tmpdir(), "awp-rp-card-errors-")));
    composition = await bootstrap(makeTestEnv(cardsDir));
    cardImportService = composition.getCardsDeps().cardImportService;
  }, 30_000);

  beforeEach(async () => {
    if (existsSync(cardsDir)) {
      for (const entry of readdirSync(cardsDir)) {
        rmSync(join(cardsDir, entry), { recursive: true, force: true });
      }
    }
  });

  afterEach(() => {
    for (const d of tempDirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
    tempDirs = [];
  });

  it("card:<missingCardId> → 404 (not 500, not 200 with empty narrative)", async () => {
    const fakeCardId = "a".repeat(64);
    const { status, data } = await postRp(composition.app, {
      sessionId: "p21-err-1",
      turnId: "turn-0001",
      userInput: "hello",
      worldbook: { resourceRef: `card:${fakeCardId}` },
      memory: { namespace: "rp-test:err-1" },
    });
    expect(status).toBe(404);
    if (!("error" in data)) throw new Error("Expected error response");
    expect(data.error).toMatch(/not found|missing/i);
    // No path leak
    expect(data.error).not.toMatch(/F:\\|C:\\|\/tmp|\/var/);
    // No stack leak
    expect(data.error).not.toMatch(/at \w+\.\w+|Error:/);
  });

  it("card:<malformedId> → 400 or 422", async () => {
    const { status } = await postRp(composition.app, {
      sessionId: "p21-err-2",
      turnId: "turn-0001",
      userInput: "hello",
      worldbook: { resourceRef: "card:not-a-hash" },
      memory: { namespace: "rp-test:err-2" },
    });
    expect([400, 422]).toContain(status);
  });

  it("card hash mismatch / corrupted source → 422 (not 500)", async () => {
    // Import a card, then corrupt its source.json
    const cardId = await importFixture(cardImportService, "minimal-v3.json");
    const { writeFileSync } = await import("node:fs");
    const { join: pjoin } = await import("node:path");
    const sourcePath = pjoin(cardsDir, cardId, "source.json");
    // Replace source.json with bytes that have a different sha256
    writeFileSync(sourcePath, '{"corrupted": true}');

    const { status, data } = await postRp(composition.app, {
      sessionId: "p21-err-3",
      turnId: "turn-0001",
      userInput: "hello",
      worldbook: { resourceRef: `card:${cardId}` },
      memory: { namespace: "rp-test:err-3" },
    });
    expect(status).toBe(422);
    if (!("error" in data)) throw new Error("Expected error response");
    // No path leak
    expect(data.error).not.toMatch(/F:\\|C:\\|\/tmp|\/var/);
    expect(data.error).not.toMatch(/at \w+\.\w+|Error:/);
  });
});
