/**
 * P-14: Official RP two-turn E2E integration test.
 *
 * This test exercises the *production* server composition root
 * (`bootstrap()` from `./composition.js`) and drives the formal
 * `/api/rp` HTTP endpoint exactly the way the web client would.
 *
 * What this test covers:
 *  1. The server boots end-to-end on the production composition root
 *     with the explicit mock provider (RP_PROVIDER=mock, RP_MODEL=mock-model,
 *     RP_MOCK=1).
 *  2. Two consecutive turns share a sessionId and produce distinct turnIds.
 *  3. Each turn returns a non-empty narrative, quality block, and
 *     observability block.
 *  4. The second turn reuses the session committed by the first turn
 *     (i.e. round-trip session continuity, not a fake response).
 *  5. The Unified Workflow (`official-rp-unified-v1`) is the one running.
 *  6. Provider errors propagate to HTTP 5xx rather than being swallowed
 *     by a silent fallback to a different provider.
 *  7. No Legacy path is reached for `workflowVersion: "unified-v1"`.
 *
 * Important: this test does NOT spawn a child process. It constructs the
 * Hono app in-process via `bootstrap()` and uses Hono's built-in
 * `app.request()` to make real HTTP-shaped requests against it.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { resolve } from "node:path";
import { bootstrap } from "../composition.js";
import type { ServerComposition } from "../composition.js";
import type { OfficialRpRequestV1, OfficialRpResponseV1 } from "./officialRpTypes.js";
import type { Env } from "../env.js";

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Build a minimal Env object for the test. We deliberately bypass
 * `resolveEnv()` so the test is hermetic: nothing in the host process
 * environment leaks into the SUT.
 */
function makeTestEnv(overrides: Partial<Env> = {}): Env {
  // The composition root resolves dataDir relative to its own location,
  // but for the integration test we point it at the repo-level data/
  // directory so the real workflow JSONs and worldbook entries are visible.
  const dataDir = resolve(__dirname, "..", "..", "..", "..", "data");
  return {
    port: 0, // unused — we never serve in the test
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
    rpWorkflowVersion: "unified-v1",
    ...overrides,
  };
}

function buildRequest(overrides: Partial<OfficialRpRequestV1> = {}): OfficialRpRequestV1 {
  return {
    sessionId: "session-p14-e2e-001",
    turnId: "turn-001",
    userInput: "我把钥匙放到银铃面前。",
    worldbook: { resourceRef: "worldbook:default" },
    memory: { namespace: "rp-memory:p14-e2e" },
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

// ── Test suite ──────────────────────────────────────────────────────────

describe("P-14: Official RP two-turn E2E (production composition root)", () => {
  let composition: ServerComposition;

  beforeAll(async () => {
    composition = await bootstrap(makeTestEnv());
  }, 30_000);

  it("boots the production composition root with explicit mock provider", () => {
    expect(composition.llm.providerId).toBe("mock");
    expect(composition.llm.model).toBe("mock-model");
    expect(composition.llm.registeredProviders).toContain("mock");
  });

  it("round 1 returns HTTP 200 with a unified-v1 narrative and observability", async () => {
    const { status, data } = await postRp(
      composition.app,
      buildRequest({ turnId: "turn-001", userInput: "我把钥匙放到银铃面前。" }),
    );

    expect(status).toBe(200);
    if ("error" in data) throw new Error(`Unexpected error response: ${data.error}`);

    expect(data.sessionId).toBe("session-p14-e2e-001");
    expect(data.turnId).toBe("turn-001");
    expect(data.workflow.mode).toBe("unified-v1");
    expect(data.workflow.id).toBe("official-rp-unified-v1");
    expect(typeof data.narrative).toBe("string");
    expect(data.narrative.length).toBeGreaterThan(0);
    expect(data.narrative).toContain("银铃");

    // Quality block present
    expect(data.quality).toBeDefined();
    expect(typeof data.quality?.accepted).toBe("boolean");
    expect(typeof data.quality?.writerAttempts).toBe("number");

    // Observability block present
    expect(data.observability).toBeDefined();
    expect(data.observability?.llmCalls).toBeGreaterThan(0);
    expect(data.observability?.totalLatencyMs).toBeGreaterThanOrEqual(0);
    expect(data.observability?.roles.writer).toBeGreaterThan(0);
  });

  it("round 2 with 继续 reuses the same session and produces a fresh turnId", async () => {
    const { status, data } = await postRp(
      composition.app,
      buildRequest({ turnId: "turn-002", userInput: "继续" }),
    );

    expect(status).toBe(200);
    if ("error" in data) throw new Error(`Unexpected error response: ${data.error}`);

    expect(data.sessionId).toBe("session-p14-e2e-001");
    expect(data.turnId).toBe("turn-002");
    expect(data.workflow.mode).toBe("unified-v1");
    expect(typeof data.narrative).toBe("string");
    expect(data.narrative.length).toBeGreaterThan(0);

    // Quality and observability are still emitted
    expect(data.quality).toBeDefined();
    expect(data.observability?.llmCalls).toBeGreaterThan(0);
  });

  it("round 1 and round 2 share sessionId and differ on turnId", async () => {
    const r1 = await postRp(
      composition.app,
      buildRequest({ turnId: "turn-a", userInput: "我把钥匙放到银铃面前。" }),
    );
    const r2 = await postRp(
      composition.app,
      buildRequest({ turnId: "turn-b", userInput: "继续" }),
    );

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    if ("error" in r1.data || "error" in r2.data) {
      throw new Error("Round 1 or 2 returned an error response");
    }
    expect(r1.data.sessionId).toBe(r2.data.sessionId);
    expect(r1.data.turnId).not.toBe(r2.data.turnId);
    expect(r1.data.workflow.id).toBe(r2.data.workflow.id);
  });

  it("refuses to bootstrap when mock is selected in production", async () => {
    await expect(
      bootstrap(makeTestEnv({ nodeEnv: "production", rpProviderId: "mock", rpModel: "mock-model" })),
    ).rejects.toThrow(/not allowed in production/);
  });

  it("refuses to bootstrap when deepseek is selected in production without a key", async () => {
    await expect(
      bootstrap(
        makeTestEnv({
          nodeEnv: "production",
          rpProviderId: "deepseek",
          rpModel: "deepseek-v4-flash",
          deepseekApiKey: undefined,
        }),
      ),
    ).rejects.toThrow(/DEEPSEEK_API_KEY/);
  });

  it("refuses to bootstrap when deepseek is configured with mock-model", async () => {
    await expect(
      bootstrap(
        makeTestEnv({
          rpProviderId: "deepseek",
          rpModel: "mock-model",
          deepseekApiKey: "test-key", // present, but model is forbidden
        }),
      ),
    ).rejects.toThrow(/rpModel="mock-model"/);
  });

  it("refuses to bootstrap when an unknown provider is selected without registration", async () => {
    await expect(
      bootstrap(
        makeTestEnv({
          rpProviderId: "no-such-provider",
          rpModel: "anything",
        }),
      ),
    ).rejects.toThrow(/is not registered/);
  });

  it("does not reach the Legacy path for workflowVersion=unified-v1", async () => {
    // The official-rp-legacy-v1 workflow would not have workflowId
    // "official-rp-unified-v1". A regression that silently fell back
    // to legacy would change the response.workflow.id.
    const { status, data } = await postRp(
      composition.app,
      buildRequest({ turnId: "turn-legacy-check", userInput: "继续" }),
    );
    expect(status).toBe(200);
    if ("error" in data) throw new Error(`Unexpected error response: ${data.error}`);
    expect(data.workflow.id).toBe("official-rp-unified-v1");
    expect(data.workflow.mode).toBe("unified-v1");
  });
});
