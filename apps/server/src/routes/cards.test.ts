/**
 * P-15.3A-2: Card HTTP Route Tests.
 *
 * Coverage (from spec section 12):
 *  - Import API (tests 1-10):
 *     1. Successful import of minimal V3 fixture
 *     2. Re-importing same file returns same cardId
 *     3. Non-V3 returns 422
 *     4. Corrupt JSON returns 422
 *     5. No `file` field returns 400
 *     6. Multiple file fields rejected
 *     7. Oversize returns 413
 *     8. Wrong Content-Type returns 415
 *     9. Path-traversal filename does not affect storage path
 *    10. Response does not leak absolute paths or private fields
 *  - List / Manifest / Greetings (tests 11-16):
 *    11. List returns only summaries
 *    12. Invalid cardId returns 400
 *    13. Nonexistent Card returns 404
 *    14. Greeting API returns cleaned content only
 *    15. Does not return separatedVariableTags / separatedRemoteRefs
 *    16. Blocked-feature evidence does not enter API
 *
 * All tests use sanitized fixtures from packages/card-import/__fixtures__.
 * Real card content is NEVER read.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { FileCardStore, computeCardId } from "@awp/card-import";
import { InMemoryDynamicWorldbookStore } from "@awp/workflow-worldbook";
import { InMemoryAgentSessionStore } from "@awp/agent-runtime";
import { createCardsRoutes } from "./cards.js";
import { CardImportService } from "../services/cardImportService.js";
import { GreetingSessionService } from "../rp/greetingSessionService.js";

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

function buildHarness(cardsDir: string) {
  const cardStore = new FileCardStore(cardsDir);
  const cardImportService = new CardImportService(cardStore, TEST_LIMITS);
  const sessionStore = new InMemoryAgentSessionStore();
  const worldbookStore = new InMemoryDynamicWorldbookStore();
  const greetingSessionService = new GreetingSessionService(
    cardStore,
    sessionStore,
    worldbookStore,
  );
  const app = new Hono();
  app.route(
    "/",
    createCardsRoutes({
      cardImportService,
      greetingSessionService,
      maxCardBytes: TEST_LIMITS.maxBytes,
    }),
  );
  return { app, cardStore, cardImportService, sessionStore, worldbookStore };
}

/**
 * Copy bytes into a fresh ArrayBuffer. `Blob` accepts `ArrayBuffer`
 * directly as a `BlobPart`, which sidesteps the
 * `Uint8Array<ArrayBufferLike>` vs `ArrayBufferView<ArrayBuffer>`
 * typecheck conflict (the generic constraint requires `ArrayBuffer`,
 * not `ArrayBufferLike`).
 */
function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

async function importAsMultipart(
  app: Hono,
  bytes: Uint8Array,
  filename = "card.json",
  contentType = "application/octet-stream",
): Promise<Response> {
  const form = new FormData();
  // Construct File from the bytes so the multipart boundary is correct.
  const blob = new Blob([toBlobPart(bytes)], { type: contentType });
  form.append("file", blob, filename);
  return app.request("/api/cards/import", {
    method: "POST",
    body: form,
  });
}

describe("Card HTTP routes (P-15.3A-2)", () => {
  let tempDir: string;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "awp-server-cards-route-"));
    const harness = buildHarness(tempDir);
    app = harness.app;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Import API tests 1-10 ─────────────────────────────────────────

  it("test 1: imports a minimal V3 card and returns 201 with manifest", async () => {
    const bytes = await loadFixtureBytes("minimal-v3.json");
    const expectedCardId = computeCardId(bytes);

    const res = await importAsMultipart(app, bytes, "minimal.json");
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      cardId: string;
      alreadyExisted: boolean;
      manifest: {
        cardId: string;
        name: string;
        spec: string;
        worldbookEntryCount: number;
        alternateGreetingCount: number;
      };
      defaultGreetingId: string | null;
      greetingCount: number;
    };

    expect(body.cardId).toBe(expectedCardId);
    expect(body.alreadyExisted).toBe(false);
    expect(body.manifest.cardId).toBe(expectedCardId);
    expect(body.manifest.name).toBe("Test Character Alpha");
    expect(body.manifest.spec).toBe("chara_card_v3");
    expect(body.manifest.worldbookEntryCount).toBe(1);
    expect(body.manifest.alternateGreetingCount).toBe(1);
    expect(body.greetingCount).toBe(1);
    expect(body.defaultGreetingId).toBe("g0");
  });

  it("test 2: re-importing the same file returns 200 with alreadyExisted=true and same cardId", async () => {
    const bytes = await loadFixtureBytes("minimal-v3.json");
    const expectedCardId = computeCardId(bytes);

    const res1 = await importAsMultipart(app, bytes);
    expect(res1.status).toBe(201);

    const res2 = await importAsMultipart(app, bytes);
    expect(res2.status).toBe(200);
    const body = (await res2.json()) as { cardId: string; alreadyExisted: boolean };
    expect(body.cardId).toBe(expectedCardId);
    expect(body.alreadyExisted).toBe(true);
  });

  it("test 3: non-V3 spec returns 422", async () => {
    const bytes = await loadFixtureBytes("not-v3.json");
    const res = await importAsMultipart(app, bytes);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/chara_card_v3/);
  });

  it("test 4: corrupt JSON returns 422", async () => {
    const bytes = await loadFixtureBytes("corrupt.json");
    const res = await importAsMultipart(app, bytes);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Invalid JSON|invalid/i);
  });

  it("test 5: missing 'file' field returns 400", async () => {
    const form = new FormData();
    form.append("not_file", "hello");
    const res = await app.request("/api/cards/import", { method: "POST", body: form });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/file/i);
  });

  it("test 6: multiple 'file' fields rejected (unexpected second field)", async () => {
    const bytes = await loadFixtureBytes("minimal-v3.json");
    const form = new FormData();
    form.append("file", new Blob([toBlobPart(bytes)]), "a.json");
    form.append("extra", new Blob([toBlobPart(bytes)]), "b.json");
    const res = await app.request("/api/cards/import", { method: "POST", body: form });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Unexpected field|extra/);
  });

  it("test 7: oversize file returns 413 (via bodyLimit middleware)", async () => {
    // Build bytes larger than 5 MB. We override maxCardBytes in a separate
    // harness so the test is hermetic.
    const tightDir = await mkdtemp(join(tmpdir(), "awp-cards-tight-"));
    try {
      const tightLimits = { ...TEST_LIMITS, maxBytes: 1024 };
      const cardStore = new FileCardStore(tightDir);
      const cardImportService = new CardImportService(cardStore, tightLimits);
      const sessionStore = new InMemoryAgentSessionStore();
      const worldbookStore = new InMemoryDynamicWorldbookStore();
      const greetingSessionService = new GreetingSessionService(
        cardStore,
        sessionStore,
        worldbookStore,
      );
      const tightApp = new Hono();
      tightApp.route(
        "/",
        createCardsRoutes({
          cardImportService,
          greetingSessionService,
          maxCardBytes: 1024,
        }),
      );

      const big = new Uint8Array(4096).fill(0x20); // 4 KB of spaces
      // The body must look like a real V3 to be rejected for size, not for JSON.
      // But since 4KB > 1KB, the bodyLimit middleware fires first.
      const form = new FormData();
      form.append("file", new Blob([big], { type: "application/json" }), "big.json");
      const res = await tightApp.request("/api/cards/import", { method: "POST", body: form });
      expect(res.status).toBe(413);
    } finally {
      await rm(tightDir, { recursive: true, force: true });
    }
  });

  it("test 8: wrong Content-Type returns 415", async () => {
    const res = await app.request("/api/cards/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: "not a file" }),
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/multipart/i);
  });

  it("test 9: path-traversal filename is sanitized; storage path is derived from cardId", async () => {
    const bytes = await loadFixtureBytes("minimal-v3.json");
    const expectedCardId = computeCardId(bytes);

    // Filename with traversal segments. Storage must not reflect this.
    const res = await importAsMultipart(app, bytes, "../../etc/passwd.json");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { cardId: string; manifest: { sourceFilename: string } };
    expect(body.cardId).toBe(expectedCardId);

    // The card directory is named by cardId (64 hex chars), NOT by filename.
    // This is the security property: even if the filename says "../etc/passwd",
    // the on-disk path cannot escape the cardsDir root.
    const entries = await (await import("node:fs/promises")).readdir(tempDir);
    expect(entries).toContain(expectedCardId);
    expect(entries).not.toContain("..");
    expect(entries).not.toContain("etc");
    expect(entries).not.toContain("passwd.json");
    // The on-disk directory contains exactly the 64-hex cardId name
    expect(entries).toHaveLength(1);

    // The manifest's sourceFilename is a sanitized string (slashes and
    // backslashes replaced with '_'). It is a metadata field, NEVER used
    // as a filesystem path; cardId is the only path component.
    expect(body.manifest.sourceFilename).not.toContain("/");
    expect(body.manifest.sourceFilename).not.toContain("\\");
    // After sanitization, no path separators remain.
    expect(body.manifest.sourceFilename.length).toBeGreaterThan(0);
  });

  it("test 10: import response has no absolute paths or private fields", async () => {
    const bytes = await loadFixtureBytes("remote-scripts-v3.json");
    const res = await importAsMultipart(app, bytes);
    expect(res.status).toBe(201);
    const raw = await res.text();

    expect(raw).not.toMatch(/[a-zA-Z]:[\\/].*cards/i); // no Windows-style absolute cards path
    expect(raw).not.toMatch(/source\.json/);
    expect(raw).not.toMatch(/removedFragmentSummary/);
    expect(raw).not.toMatch(/separatedVariableTags/);
    expect(raw).not.toMatch(/separatedRemoteRefs/);
    expect(raw).not.toMatch(/originalContent/);
    expect(raw).not.toMatch(/process\.cwd\(\)/);
    // Evidence snippets are stripped from blockedFeatureSummary
    expect(raw).not.toMatch(/<script src/i);
    expect(raw).not.toMatch(/eval\(/);
  });

  // ── List / Manifest / Greetings (tests 11-16) ─────────────────────

  it("test 11: GET /api/cards returns only summaries (no raw content)", async () => {
    const bytes1 = await loadFixtureBytes("minimal-v3.json");
    const bytes2 = await loadFixtureBytes("no-worldbook-v3.json");
    await importAsMultipart(app, bytes1, "a.json");
    await importAsMultipart(app, bytes2, "b.json");

    const res = await app.request("/api/cards");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cards: Array<{
        cardId: string;
        name: string;
        worldbookEntryCount: number;
        alternateGreetingCount: number;
      }>;
    };
    expect(body.cards).toHaveLength(2);
    expect(body.cards.map((c) => c.name).sort()).toEqual([
      "No Worldbook Character",
      "Test Character Alpha",
    ]);
    // No source.json, no greetings array on the list
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/source\.json/);
    expect(raw).not.toMatch(/greetings/);
  });

  it("test 12: invalid cardId returns 400 (manifest)", async () => {
    const res = await app.request("/api/cards/not-a-hash");
    expect(res.status).toBe(400);
  });

  it("test 12b: invalid cardId returns 400 (greetings)", async () => {
    const res = await app.request("/api/cards/not-a-hash/greetings");
    expect(res.status).toBe(400);
  });

  it("test 13: nonexistent card returns 404 on both manifest and greetings", async () => {
    const fakeId = "a".repeat(64);
    const res1 = await app.request(`/api/cards/${fakeId}`);
    expect(res1.status).toBe(404);
    const res2 = await app.request(`/api/cards/${fakeId}/greetings`);
    expect(res2.status).toBe(404);
  });

  it("test 14: Greeting API returns cleaned content only", async () => {
    // greetings-v3.json has a remote first_mes but alternate_greetings are clean.
    const bytes = await loadFixtureBytes("greetings-v3.json");
    const cardId = computeCardId(bytes);
    const importRes = await importAsMultipart(app, bytes);
    expect(importRes.status).toBe(201);

    const res = await app.request(`/api/cards/${cardId}/greetings`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cardId: string;
      greetings: Array<{
        greetingId: string;
        index: number;
        content: string;
        isDefault: boolean;
        label: string | null;
      }>;
    };
    expect(body.cardId).toBe(cardId);
    expect(body.greetings).toHaveLength(6);
    for (const g of body.greetings) {
      expect(typeof g.content).toBe("string");
      // cleaned content does not include iframes (the first_mes has them
      // but the alternate_greetings do not).
      expect(g.content).not.toMatch(/<iframe/i);
    }
  });

  it("test 15: Greeting API does not return separatedVariableTags, separatedRemoteRefs, or removedFragmentSummary", async () => {
    const bytes = await loadFixtureBytes("var-conditions-v3.json");
    const cardId = computeCardId(bytes);
    const importRes = await importAsMultipart(app, bytes);
    expect(importRes.status).toBe(201);

    const res = await app.request(`/api/cards/${cardId}/greetings`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).not.toMatch(/separatedVariableTags/);
    expect(body).not.toMatch(/separatedRemoteRefs/);
    expect(body).not.toMatch(/removedFragmentSummary/);
    expect(body).not.toMatch(/setvar:/);
    expect(body).not.toMatch(/getvar:/);
  });

  it("test 16: blocked-feature evidence does not enter the manifest API", async () => {
    const bytes = await loadFixtureBytes("remote-scripts-v3.json");
    const cardId = computeCardId(bytes);
    const importRes = await importAsMultipart(app, bytes);
    expect(importRes.status).toBe(201);

    const res = await app.request(`/api/cards/${cardId}`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    // Evidence text patterns must NOT appear in the response
    expect(raw).not.toMatch(/<script src=/);
    expect(raw).not.toMatch(/Function\s*\(\s*['"]return/i);
    // But the COUNT of blocked features IS present (sanitized)
    const body = JSON.parse(raw) as {
      manifest: {
        blockedFeatureSummary: Array<{ code: string; count: number }>;
      };
    };
    expect(Array.isArray(body.manifest.blockedFeatureSummary)).toBe(true);
    expect(body.manifest.blockedFeatureSummary.length).toBeGreaterThan(0);
  });

  it("importing then listing-then-manifesting produces no path leakage at any step", async () => {
    const bytes = await loadFixtureBytes("minimal-v3.json");
    const cardId = computeCardId(bytes);
    await importAsMultipart(app, bytes);

    const listRes = await app.request("/api/cards");
    const listRaw = await listRes.text();
    expect(listRaw).not.toMatch(/source\.json/);
    expect(listRaw).not.toMatch(/cards[A-Z]:/i);

    const manifestRes = await app.request(`/api/cards/${cardId}`);
    const manifestRaw = await manifestRes.text();
    expect(manifestRaw).not.toMatch(/source\.json/);
    expect(manifestRaw).not.toMatch(/originalContent/);
  });
});
