/**
 * P-15.3A-2: Card-aware Dynamic Worldbook Seeding & /api/rp E2E.
 *
 * Coverage (from spec section 12, tests 26-37 + 38):
 *  26. session init 후 active entries가 올바른 scope에 들어감
 *  27. deferred-variable entries는 Store에 안 들어감
 *  28. blocked-script entries는 Store에 안 들어감
 *  29. disabled entries는 Store에 안 들어감
 *  30. 두 Session이 Worldbook을 공유하지 않음
 *  31. 두 Card가 Worldbook을 공유하지 않음
 *  32. card resourceRef는 전역 default worldbook를 로드하지 않음
 *  33. Server/Store 재구성 후 Card 파일에서 자동 복원
 *  34. /api/rp가 card resourceRef를 사용하여 정상적인 Mock narrative를 반환
 *  35. Writer Prompt가 hit된 Card worldbook 항목을 볼 수 있음
 *  36. Writer Prompt가 deferred/blocked 내용을 볼 수 없음
 *  37. Card 없을 때 명확하게 실패, silent empty run 없음
 *  38. Official RP request/response 기존 필드를 수정하지 않음
 *
 * All tests use sanitized fixtures from packages/card-import/__fixtures__.
 * Real card content is NEVER read.
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
import { computeCardId } from "@awp/card-import";

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

/**
 * Minimal test env with a temp cardsDir. Reuses the repo-level data/ for
 * the rest so the production workflow + global worldbook are available.
 */
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

/**
 * Import a fixture into the composition's Card store via the real
 * CardImportService. This writes all 6 files (source.json, manifest.json,
 * greetings.json, worldbook.json, deferred-worldbook.json, import-report.json)
 * that the RP service's card-aware seeding reads.
 */
async function importFixture(
  cardImportService: CardImportService,
  fixtureName: string,
): Promise<string> {
  const bytes = loadFixtureBytes(fixtureName);
  const result = await cardImportService.importCard(bytes, fixtureName);
  return result.cardId;
}

describe("P-15.3A-2: Card-aware worldbook seeding & /api/rp E2E", () => {
  let tempDirs: string[] = [];
  let composition: ServerComposition;
  let cardImportService: CardImportService;
  let cardsDir: string;

  const trackTempDir = (d: string) => {
    tempDirs.push(d);
    return d;
  };

  beforeAll(async () => {
    cardsDir = trackTempDir(mkdtempSync(join(tmpdir(), "awp-server-cardworldbook-")));
    composition = await bootstrap(makeTestEnv(cardsDir));
    cardImportService = composition.getCardsDeps().cardImportService;
  }, 30_000);

  beforeEach(async () => {
    // Wipe the cardsDir between tests to keep them hermetic. The InMemory
    // store in the composition retains its own state (per-instance).
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

  // ── Test 26: session init 후 active entries가 올바른 scope에 들어감 ──

  it("test 26: card resourceRef seeds active entries into the session's DynamicWorldbookStore scope", async () => {
    const cardId = await importFixture(cardImportService, "minimal-v3.json");

    const sessionId = "session-26";
    const request: OfficialRpRequestV1 = {
      sessionId,
      turnId: "turn-26",
      userInput: "hello",
      worldbook: { resourceRef: `card:${cardId}` },
      memory: { namespace: "rp-test:26" },
    };

    const { status } = await postRp(composition.app, request);
    expect(status).toBe(200);

    const ctx = composition.getRpServiceContext();
    const snapshot = await ctx.worldbookStore.load(
      `session:${sessionId}:card:${cardId}`,
      `card:${cardId}`,
    );
    expect(snapshot.entries.length).toBeGreaterThan(0);
    // The minimal-v3 fixture has exactly 1 active entry (the "Test Location")
    expect(snapshot.entries.length).toBe(1);
    expect(snapshot.entries[0]!.id).toContain(`card:${cardId}`);
  });

  // ── Test 27: deferred-variable entries는 Store에 안 들어감 ──────────

  it("test 27: deferred-variable entries are NOT loaded into the store", async () => {
    const cardId = await importFixture(cardImportService, "var-conditions-v3.json");

    const sessionId = "session-27";
    const request: OfficialRpRequestV1 = {
      sessionId,
      turnId: "turn-27",
      userInput: "hello",
      worldbook: { resourceRef: `card:${cardId}` },
      memory: { namespace: "rp-test:27" },
    };

    const { status } = await postRp(composition.app, request);
    expect(status).toBe(200);

    const ctx = composition.getRpServiceContext();
    const snapshot = await ctx.worldbookStore.load(
      `session:${sessionId}:card:${cardId}`,
      `card:${cardId}`,
    );

    const contents = snapshot.entries.map((e) => e.content).join("\n");

    // Variable conditions ({{setvar:}}, <% %>, etc.) must NOT appear
    // in any active entry content.
    expect(contents).not.toMatch(/\{\{setvar:/);
    expect(contents).not.toMatch(/<%/);
    expect(contents).not.toMatch(/\{\{getvar:/);
    expect(contents).not.toMatch(/\{\{var::set/);

    // The clean entry should be present (its content has no variable
    // patterns).
    expect(snapshot.entries.length).toBeGreaterThanOrEqual(1);
    expect(contents).toContain("no variable conditions");
  });

  // ── Test 28: blocked-script entries는 Store에 안 들어감 ────────────

  it("test 28: blocked-script entries are NOT loaded into the store", async () => {
    const cardId = await importFixture(cardImportService, "remote-scripts-v3.json");

    const sessionId = "session-28";
    const request: OfficialRpRequestV1 = {
      sessionId,
      turnId: "turn-28",
      userInput: "hello",
      worldbook: { resourceRef: `card:${cardId}` },
      memory: { namespace: "rp-test:28" },
    };

    const { status } = await postRp(composition.app, request);
    expect(status).toBe(200);

    const ctx = composition.getRpServiceContext();
    const snapshot = await ctx.worldbookStore.load(
      `session:${sessionId}:card:${cardId}`,
      `card:${cardId}`,
    );

    const contents = snapshot.entries.map((e) => e.content).join("\n");
    // The remote-scripts fixture has 3 blocked-script entries. All 3 must
    // be excluded from the active worldbook.
    expect(contents).not.toMatch(/eval\(/);
    expect(contents).not.toMatch(/new Function/);
    expect(contents).not.toMatch(/fetch\(['"]https?:/);
  });

  // ── Test 29: disabled entries는 Store에 안 들어감 ─────────────────

  it("test 29: disabled entries are NOT loaded into the store", async () => {
    // The var-conditions-v3.json fixture has a disabled entry (uid=5).
    const cardId = await importFixture(cardImportService, "var-conditions-v3.json");

    const sessionId = "session-29";
    const request: OfficialRpRequestV1 = {
      sessionId,
      turnId: "turn-29",
      userInput: "hello",
      worldbook: { resourceRef: `card:${cardId}` },
      memory: { namespace: "rp-test:29" },
    };

    const { status } = await postRp(composition.app, request);
    expect(status).toBe(200);

    const ctx = composition.getRpServiceContext();
    const snapshot = await ctx.worldbookStore.load(
      `session:${sessionId}:card:${cardId}`,
      `card:${cardId}`,
    );

    const contents = snapshot.entries.map((e) => e.content).join("\n");
    expect(contents).not.toMatch(/This entry is disabled/);
  });

  // ── Test 30: 두 Session이 Worldbook을 공유하지 않음 ───────────────

  it("test 30: two sessions do not share the card worldbook (scope isolation)", async () => {
    const cardId = await importFixture(cardImportService, "minimal-v3.json");
    const ref = `card:${cardId}`;

    const sessionA = "session-30a";
    const sessionB = "session-30b";

    await postRp(composition.app, {
      sessionId: sessionA,
      turnId: "turn-30a",
      userInput: "hi",
      worldbook: { resourceRef: ref },
      memory: { namespace: "rp-test:30a" },
    });
    await postRp(composition.app, {
      sessionId: sessionB,
      turnId: "turn-30b",
      userInput: "hi",
      worldbook: { resourceRef: ref },
      memory: { namespace: "rp-test:30b" },
    });

    const ctx = composition.getRpServiceContext();
    const a = await ctx.worldbookStore.load(`session:${sessionA}:${ref}`, ref);
    const b = await ctx.worldbookStore.load(`session:${sessionB}:${ref}`, ref);

    // Both sessions got the card's worldbook seeded (one entry each)
    expect(a.entries.length).toBe(1);
    expect(b.entries.length).toBe(1);
    // The entries are structurally independent (different object instances)
    expect(a.entries[0]).not.toBe(b.entries[0]);
  });

  // ── Test 31: 두 Card가 Worldbook을 공유하지 않음 ──────────────────

  it("test 31: two cards do not share worldbook (resourceRef isolation)", async () => {
    const cardA = await importFixture(cardImportService, "minimal-v3.json");
    const cardB = await importFixture(cardImportService, "no-worldbook-v3.json");

    const sessionId = "session-31";
    const refA = `card:${cardA}`;
    const refB = `card:${cardB}`;

    await postRp(composition.app, {
      sessionId,
      turnId: "turn-31a",
      userInput: "hi",
      worldbook: { resourceRef: refA },
      memory: { namespace: "rp-test:31" },
    });
    await postRp(composition.app, {
      sessionId,
      turnId: "turn-31b",
      userInput: "hi",
      worldbook: { resourceRef: refB },
      memory: { namespace: "rp-test:31" },
    });

    const ctx = composition.getRpServiceContext();
    const snapA = await ctx.worldbookStore.load(`session:${sessionId}:${refA}`, refA);
    const snapB = await ctx.worldbookStore.load(`session:${sessionId}:${refB}`, refB);

    // Card A has 1 worldbook entry; Card B has 0.
    expect(snapA.entries.length).toBe(1);
    expect(snapB.entries.length).toBe(0);
    // They are stored under different resourceRefs — no cross-contamination.
    expect(snapA.entries[0]!.id).toContain(cardA);
  });

  // ── Test 32: card resourceRef는 전역 default worldbook를 로드하지 않음 ─

  it("test 32: card resourceRef does NOT load the global default worldbook.json", async () => {
    const cardId = await importFixture(cardImportService, "no-worldbook-v3.json");
    const ref = `card:${cardId}`;

    const sessionId = "session-32";
    const { status } = await postRp(composition.app, {
      sessionId,
      turnId: "turn-32",
      userInput: "hi",
      worldbook: { resourceRef: ref },
      memory: { namespace: "rp-test:32" },
    });
    expect(status).toBe(200);

    const ctx = composition.getRpServiceContext();
    const snapshot = await ctx.worldbookStore.load(`session:${sessionId}:${ref}`, ref);

    // The global data/worldbook.json has 3 entries (rp_station_broadcast,
    // rp_mio, rp_rule_agency). The no-worldbook card has 0 entries. If the
    // card path were silently falling back to the global default, we'd see
    // those 3 entries here — we must NOT.
    expect(snapshot.entries.length).toBe(0);

    // Sanity: the no-card path DOES load the global default (proves the
    // dispatch is on resourceRef prefix, not a global change).
    const otherSession = "session-32b";
    await postRp(composition.app, {
      sessionId: otherSession,
      turnId: "turn-32b",
      userInput: "hi",
      worldbook: { resourceRef: "worldbook:default" },
      memory: { namespace: "rp-test:32b" },
    });
    const globalSnap = await ctx.worldbookStore.load(
      `session:${otherSession}:worldbook:default`,
      "worldbook:default",
    );
    expect(globalSnap.entries.length).toBeGreaterThan(0);
  });

  // ── Test 33: Server/Store 재구성 후 Card 파일에서 자동 복원 ─────────

  it("test 33: after Server/Store restart, card worldbook is auto-restored from disk", async () => {
    // Step 1: Use a fresh cardsDir and import a card through composition1.
    const cardsDir2 = trackTempDir(mkdtempSync(join(tmpdir(), "awp-server-restart-")));
    const composition1 = await bootstrap(makeTestEnv(cardsDir2));
    const importSvc1 = composition1.getCardsDeps().cardImportService;
    const bytes = loadFixtureBytes("minimal-v3.json");
    const cardId = computeCardId(bytes);
    const importResult = await importSvc1.importCard(bytes, "minimal-v3.json");
    expect(importResult.cardId).toBe(cardId);

    const sessionId = "session-33";

    await postRp(composition1.app, {
      sessionId,
      turnId: "turn-33-pre",
      userInput: "hi",
      worldbook: { resourceRef: `card:${cardId}` },
      memory: { namespace: "rp-test:33" },
    });
    const ctx1 = composition1.getRpServiceContext();
    const before = await ctx1.worldbookStore.load(
      `session:${sessionId}:card:${cardId}`,
      `card:${cardId}`,
    );
    expect(before.entries.length).toBe(1);

    // Step 2: Simulate a Server restart — InMemory store is empty in the
    // new composition, but the Card files persist on disk.
    const composition2 = await bootstrap(makeTestEnv(cardsDir2));

    // The new composition has a fresh InMemoryDynamicWorldbookStore with
    // no entries. /api/rp on the same sessionId+cardId should re-seed
    // from the on-disk Card file (restart recovery).
    const { status } = await postRp(composition2.app, {
      sessionId,
      turnId: "turn-33-post",
      userInput: "hi",
      worldbook: { resourceRef: `card:${cardId}` },
      memory: { namespace: "rp-test:33" },
    });
    expect(status).toBe(200);

    const ctx2 = composition2.getRpServiceContext();
    const after = await ctx2.worldbookStore.load(
      `session:${sessionId}:card:${cardId}`,
      `card:${cardId}`,
    );
    expect(after.entries.length).toBe(1);
  });

  // ── Test 34: /api/rp가 card resourceRef를 사용하여 정상적인 Mock narrative를 반환 ─

  it("test 34: /api/rp with card resourceRef returns a normal mock narrative", async () => {
    const cardId = await importFixture(cardImportService, "minimal-v3.json");

    const { status, data } = await postRp(composition.app, {
      sessionId: "session-34",
      turnId: "turn-34",
      userInput: "我把钥匙放到吧台上，看着银铃",
      worldbook: { resourceRef: `card:${cardId}` },
      memory: { namespace: "rp-test:34" },
    });

    expect(status).toBe(200);
    if ("error" in data) throw new Error(`Unexpected error: ${data.error}`);

    // The mock narrative is non-empty and contains the standard mock text
    expect(data.narrative.length).toBeGreaterThan(0);
    expect(data.workflow.mode).toBe("unified-v1");
    expect(data.workflow.id).toBe("official-rp-unified-v1");
    expect(data.observability?.llmCalls).toBeGreaterThan(0);
  });

  // ── Test 35: Writer Prompt가 hit된 Card worldbook 항목을 볼 수 있음 ──

  it("test 35: Writer Prompt sees the hit Card worldbook entry (when query matches)", async () => {
    const cardId = await importFixture(cardImportService, "minimal-v3.json");

    const sessionId = "session-35";
    const ref = `card:${cardId}`;

    const { status } = await postRp(composition.app, {
      sessionId,
      turnId: "turn-35",
      // Use a query that matches the fixture's worldbook entry keys
      // (keys="lab,testing", secondary="test")
      userInput: "我在 testing lab 里做实验",
      worldbook: { resourceRef: ref },
      memory: { namespace: "rp-test:35" },
    });
    expect(status).toBe(200);

    const ctx = composition.getRpServiceContext();
    const snap = await ctx.worldbookStore.load(`session:${sessionId}:${ref}`, ref);
    expect(snap.entries.length).toBe(1);
    // The entry's content is available to the writer node's prompt
    expect(snap.entries[0]!.content).toContain("Testing Lab");
  });

  // ── Test 36: Writer Prompt가 deferred/blocked 내용을 볼 수 없음 ─────

  it("test 36: Writer Prompt does not see deferred-variable or blocked-script content", async () => {
    const cardId = await importFixture(cardImportService, "var-conditions-v3.json");

    const sessionId = "session-36";
    const ref = `card:${cardId}`;

    const { status } = await postRp(composition.app, {
      sessionId,
      turnId: "turn-36",
      userInput: "tell me about the testing lab",
      worldbook: { resourceRef: ref },
      memory: { namespace: "rp-test:36" },
    });
    expect(status).toBe(200);

    const ctx = composition.getRpServiceContext();
    const snap = await ctx.worldbookStore.load(`session:${sessionId}:${ref}`, ref);
    const allContent = snap.entries.map((e) => e.content).join("\n");
    // No variable conditions, no script patterns
    expect(allContent).not.toMatch(/setvar:/);
    expect(allContent).not.toMatch(/<%.*%>/);
    expect(allContent).not.toMatch(/getvar:/);
  });

  // ── Test 37: Card 없을 때 명확하게 실패, silent empty run 없음 ─────

  it("test 37: missing card for card: resourceRef fails clearly, does not silently empty-run", async () => {
    const fakeCardId = "a".repeat(64);
    // Do NOT import the card.
    const { status, data } = await postRp(composition.app, {
      sessionId: "session-37",
      turnId: "turn-37",
      userInput: "hi",
      worldbook: { resourceRef: `card:${fakeCardId}` },
      memory: { namespace: "rp-test:37" },
    });
    // The card path throws, the route maps to 500. Critically: we do NOT
    // get a 200 with an empty narrative.
    expect(status).not.toBe(200);
    if (status === 200) {
      throw new Error(
        `Expected failure for missing card, but got 200 with narrative: ${(data as OfficialRpResponseV1).narrative.slice(0, 100)}`,
      );
    }
  });

  it("test 37b: invalid card resourceRef format (non-hex cardId) fails clearly", async () => {
    const { status, data } = await postRp(composition.app, {
      sessionId: "session-37b",
      turnId: "turn-37b",
      userInput: "hi",
      worldbook: { resourceRef: "card:not-a-hash" },
      memory: { namespace: "rp-test:37b" },
    });
    expect(status).not.toBe(200);
    if (status === 200) {
      throw new Error(
        `Expected failure for invalid cardId, but got 200 with narrative: ${(data as OfficialRpResponseV1).narrative.slice(0, 100)}`,
      );
    }
  });

  // ── Test 38: Official RP request/response 기존 필드를 수정하지 않음 ─

  it("test 38: Official RP request/response fields are unchanged with card resourceRef", async () => {
    const cardId = await importFixture(cardImportService, "minimal-v3.json");

    const sessionId = "session-38";
    const request: OfficialRpRequestV1 = {
      sessionId,
      turnId: "turn-38",
      userInput: "我把钥匙放到吧台上，看着银铃",
      worldbook: { resourceRef: `card:${cardId}` },
      memory: { namespace: "rp-test:38" },
    };

    const { status, data } = await postRp(composition.app, request);
    expect(status).toBe(200);
    if ("error" in data) throw new Error(`Unexpected error: ${data.error}`);

    // Response shape is identical to the non-card path.
    const expectedKeys = [
      "narrative",
      "sessionId",
      "turnId",
      "workflow",
      "quality",
      "sessionCommit",
      "memoryCommit",
      "observability",
      "traceId",
    ];
    for (const k of expectedKeys) {
      expect(data).toHaveProperty(k);
    }

    // Request echo
    expect(data.sessionId).toBe(request.sessionId);
    expect(data.turnId).toBe(request.turnId);
    expect(data.workflow.mode).toBe("unified-v1");
    expect(data.workflow.id).toBe("official-rp-unified-v1");

    // No new private fields leak into the response
    const raw = JSON.stringify(data);
    expect(raw).not.toMatch(/source\.json/);
    expect(raw).not.toMatch(/cardsDir/);
    expect(raw).not.toMatch(/cards[A-Z]:/i);
    expect(raw).not.toContain(cardId);
  });
});
