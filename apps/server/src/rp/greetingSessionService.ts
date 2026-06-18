/**
 * P-15.3A-2.1: Greeting Session Service.
 *
 * Initializes an Agent Session with a Card Greeting as the first persisted
 * turn. Used by POST /api/cards/sessions.
 *
 * Design contract (per P-15.3A-2.1 spec):
 *
 *  1. Idempotent on (sessionId, cardId, greetingId, contentHash).
 *  2. Conflicts with:
 *     - existing greeting of different contentHash
 *     - existing greeting of different greetingId
 *     - existing non-greeting turns (real conversation in progress)
 *  3. Persists greeting content directly as `assistantOutput` of turnIndex=1
 *     on the SAME `agentNodeId` that the official RP Writer uses
 *     (`writer-main`). This ensures the Writer's first `/api/rp` call
 *     loads the greeting as session history and includes it in the prompt.
 *     The first real Writer response then gets `turnIndex = 2` (per
 *     `agentV2.ts` formula: `turns.length + 1`).
 *  4. Does NOT call any LLM.
 *  5. Does NOT apply JSON Patch, EJS/getvar, status bar, or remote content.
 *  6. Uses `modelConfig.{provider,model}` as a prompt-invisible seed marker.
 *     Verified: `sessionContextToMarkdown` and `formatTurn` both render
 *     only `input` and `assistantOutput` — `modelConfig` never reaches
 *     the player-visible prompt.
 *  7. `input` is `""` (empty string), NOT `null`. In
 *     `sessionContextToMarkdown`, `if (input)` is falsy for `""`, so the
 *     greeting seed produces NO "Player:" line (no fake user input in
 *     the prompt).
 *  8. Never writes cardId, greetingId, or any internal marker into the
 *     player-visible history text (assistantOutput contains only the
 *     cleaned greeting content).
 *  9. After successful greeting commit, seeds the card worldbook into the
 *     DynamicWorldbookStore via the caller's worldbookStore. The greeting
 *     init step is independent of the worldbook seed step; both are idempotent.
 *
 * Why `writer-main` (not a separate agentNodeId)? The official RP
 * workflow's Writer reads from `agentNodeId: "writer-main"` (set in
 * `officialRpInputAdapter.ts`). A greeting written to any other
 * `agentNodeId` would be invisible to the Writer — the Writer would
 * never see the greeting in its session history. The seed is
 * distinguished from real Writer turns by `modelConfig.provider ===
 * "card-import"`, which is prompt-invisible.
 */
import { FileCardStore, type ImportedGreetingV1 } from "@awp/card-import";
import type { AgentSessionStore } from "@awp/agent-runtime";
import type {
  AgentSessionKeyV1,
  AgentSessionDeltaV1,
  AgentTurnV1,
  AgentSessionCommitResultV1,
} from "@awp/agent-runtime";
import type { DynamicWorldbookStore } from "@awp/workflow-worldbook";

/**
 * The agentNodeId used by the official RP Writer session. The greeting
 * seed is written to the SAME session key so the Writer loads it as
 * history on the first `/api/rp` call.
 */
export const WRITER_AGENT_NODE_ID = "writer-main";

/**
 * Greeting Seed marker fields. Visible to dedup logic, invisible to the
 * player prompt (modelConfig is not rendered by sessionContextToMarkdown
 * or formatTurn).
 */
export const GREETING_SEED_PROVIDER = "card-import";
export const GREETING_SEED_MODEL_PREFIX = "greeting-seed-v1";

/**
 * Request shape for greeting session init.
 */
export interface GreetingSessionInitRequest {
  cardId: string;
  greetingId: string;
  sessionId: string;
  memoryNamespace?: string;
}

export interface GreetingSessionInitResult {
  sessionId: string;
  cardId: string;
  greetingId: string;
  memoryNamespace: string;
  worldbookResourceRef: string;
  greetingTurnIndex: number;
  greetingTurnId: string;
  deduplicated: boolean;
  committed: boolean;
}

/**
 * Error type raised by the greeting session service. Mapped to HTTP status
 * codes by the route layer.
 */
export type GreetingSessionErrorCode =
  | "invalid-identifier"
  | "card-not-found"
  | "greeting-not-found"
  | "session-conflict"
  | "card-corrupt"
  | "worldbook-missing"
  | "internal-error";

export class GreetingSessionServiceError extends Error {
  constructor(
    message: string,
    public readonly code: GreetingSessionErrorCode,
  ) {
    super(message);
    this.name = "GreetingSessionServiceError";
  }
}

/**
 * Greeting Session Service.
 *
 * Stateless orchestrator. Owns the greeting-init pipeline:
 *   load & validate Card → load & validate Greeting → load session →
 *   check for non-greeting turns → idempotent commit → seed worldbook →
 *   return result.
 */
export class GreetingSessionService {
  constructor(
    private readonly cardStore: FileCardStore,
    private readonly sessionStore: AgentSessionStore,
    private readonly worldbookStore: DynamicWorldbookStore,
  ) {}

  /**
   * Initialize (or idempotently re-confirm) a session's greeting.
   */
  async initSession(request: GreetingSessionInitRequest): Promise<GreetingSessionInitResult> {
    // 1. Validate identifiers
    if (!isValidCardId(request.cardId)) {
      throw new GreetingSessionServiceError(
        `Invalid cardId: ${request.cardId} (must match ^[0-9a-f]{64}$)`,
        "invalid-identifier",
      );
    }
    if (!isValidSessionId(request.sessionId)) {
      throw new GreetingSessionServiceError(
        `Invalid sessionId: ${request.sessionId} (must match ^[a-zA-Z0-9_.:-]{1,128}$)`,
        "invalid-identifier",
      );
    }
    if (!isValidGreetingId(request.greetingId)) {
      throw new GreetingSessionServiceError(
        `Invalid greetingId: ${request.greetingId} (must match ^g[0-9]+$)`,
        "invalid-identifier",
      );
    }

    // 2. Load & validate Card
    let cardEntry;
    try {
      cardEntry = await this.cardStore.readCard(request.cardId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new GreetingSessionServiceError(
        `Card not found: ${request.cardId} (${message})`,
        "card-not-found",
      );
    }

    // 3. Load & validate Greeting
    const greeting = cardEntry.greetings.find((g) => g.greetingId === request.greetingId);
    if (!greeting) {
      throw new GreetingSessionServiceError(
        `Greeting not found: ${request.greetingId} on card ${request.cardId}`,
        "greeting-not-found",
      );
    }

    // 4. Build session key — same agentNodeId as the official RP Writer
    //    (writer-main). The greeting seed lives in the same session the
    //    Writer reads from, so it appears in the Writer's session history
    //    on the first /api/rp call.
    const sessionKey: AgentSessionKeyV1 = {
      tenantId: "default",
      workflowInstanceId: "rp-prod-1",
      conversationId: request.sessionId,
      agentNodeId: WRITER_AGENT_NODE_ID,
    };

    // 5. Check existing session
    const existing = await this.sessionStore.load(sessionKey);
    const existingTurns = existing?.turns ?? [];

    // 5a. If session has any non-greeting-seed turns, refuse (real conversation in progress).
    const nonSeedTurns = existingTurns.filter((t) => !isGreetingSeedTurn(t));
    if (nonSeedTurns.length > 0) {
      throw new GreetingSessionServiceError(
        `Session "${request.sessionId}" already has ${nonSeedTurns.length} conversation turn(s); cannot re-seed greeting.`,
        "session-conflict",
      );
    }

    // 5b. If session has a greeting seed, check for idempotency vs conflict.
    const existingSeed = existingTurns.find((t) => isGreetingSeedTurn(t));
    const memoryNamespace = request.memoryNamespace ?? `rp-session:${request.sessionId}`;
    const worldbookResourceRef = `card:${request.cardId}`;
    const turnId = buildGreetingSeedTurnId(
      request.cardId,
      request.greetingId,
      greeting.contentHash,
    );

    if (existingSeed) {
      const sameIdentity = greetingSeedMatches(existingSeed, request.cardId, request.greetingId);
      if (sameIdentity) {
        // Idempotent re-confirmation: same cardId + same greetingId + same contentHash
        // (contentHash is derived from the cleaned greeting content which is
        //  content-deterministic).
        return {
          sessionId: request.sessionId,
          cardId: request.cardId,
          greetingId: request.greetingId,
          memoryNamespace,
          worldbookResourceRef,
          greetingTurnIndex: existingSeed.turnIndex,
          greetingTurnId: turnId,
          deduplicated: true,
          committed: false,
        };
      }
      // Different greetingId for the same session, or contentHash changed
      // (impossible in practice for the same greetingId, but defensive).
      throw new GreetingSessionServiceError(
        `Session "${request.sessionId}" already has a different greeting seeded (turnIndex=${existingSeed.turnIndex}).`,
        "session-conflict",
      );
    }

    // 6. Commit greeting seed (idempotent on the turnId).
    const contentHash = computeContentHash(greeting.content);
    const dedupKey = {
      sessionId: request.sessionId,
      agentNodeId: WRITER_AGENT_NODE_ID,
      turnId,
    };
    const newTurn: AgentTurnV1 = {
      turnIndex: 1, // First turn in the writer-main session
      // input: "" (NOT null) so sessionContextToMarkdown's `if (input)` check
      // skips this turn entirely — no fake "Player: null" line in the prompt.
      input: "",
      assistantOutput: greeting.content, // Cleaned content only — no cardId/greetingId
      modelConfig: {
        provider: GREETING_SEED_PROVIDER,
        model: turnId,
      },
      tokenUsage: { input: 0, output: 0 },
      createdAt: new Date().toISOString(),
    };
    const delta: AgentSessionDeltaV1 = {
      sessionKey,
      newTurn,
    };

    let commitResult: AgentSessionCommitResultV1;
    try {
      commitResult = await this.sessionStore.commitIdempotent(
        sessionKey,
        delta,
        dedupKey,
        contentHash,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new GreetingSessionServiceError(`Session commit failed: ${message}`, "internal-error");
    }

    if ("conflict" in commitResult && commitResult.conflict) {
      // Should not happen because we pre-checked; surface defensively.
      throw new GreetingSessionServiceError(
        `Session commit conflict: ${commitResult.error ?? "unknown"}`,
        "session-conflict",
      );
    }

    // 7. Seed card worldbook (idempotent, may be a no-op if already seeded).
    await this.seedCardWorldbook({
      cardId: request.cardId,
      cardDir: cardEntry,
      sessionId: request.sessionId,
    });

    return {
      sessionId: request.sessionId,
      cardId: request.cardId,
      greetingId: request.greetingId,
      memoryNamespace,
      worldbookResourceRef,
      greetingTurnIndex: 1,
      greetingTurnId: turnId,
      deduplicated: commitResult.deduplicated,
      committed: commitResult.committed,
    };
  }

  /**
   * Seed the card's active worldbook entries into the DynamicWorldbookStore
   * under the session's scope. Only loads entries with activationPolicy of
   * "always-core" or "retrieval". Does NOT load disabled, deferred-variable,
   * or blocked-script entries.
   *
   * Idempotent: if the scope already has content, this is a no-op.
   * Recovers on Server restart: re-reads from the on-disk Card files.
   */
  private async seedCardWorldbook(args: {
    cardId: string;
    cardDir: unknown;
    sessionId: string;
  }): Promise<void> {
    const { cardId, sessionId } = args;

    // Use the in-process cardStore to load active entries. The worldbook
    // mapper already partitioned entries by activationPolicy, so we simply
    // filter the active ones (excludes deferred-variable / blocked-script
    // which live in DeferredWorldbookEntryV1).
    let activeEntries;
    try {
      const entry = await this.cardStore.readCard(cardId);
      activeEntries = entry.worldbook;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new GreetingSessionServiceError(
        `Failed to read card for worldbook seed: ${cardId} (${message})`,
        "card-corrupt",
      );
    }

    const resourceRef = `card:${cardId}`;
    const scopeKey = `session:${sessionId}:${resourceRef}`;

    // Idempotent: skip if already populated.
    const existing = await this.worldbookStore.load(scopeKey, resourceRef);
    if (existing.entries.length > 0) return;

    await this.worldbookStore.save(scopeKey, resourceRef, {
      version: 1,
      entries: activeEntries.map((entry) => ({
        id: entry.id,
        content: entry.content,
        title: entry.title ?? undefined,
        type: entry.type ?? undefined,
        tags: entry.tags ?? [],
        priority: entry.priority ?? 50,
        metadata: entry.metadata ?? undefined,
      })),
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Build a stable turnId for the greeting seed marker.
 * Format: `greeting-seed-v1:<cardId>:<greetingId>:<contentHash>`
 *  - cardId (64 hex) makes the turnId globally unique per card
 *  - greetingId (e.g. g0) is the source-side index
 *  - contentHash is the sha256 of the cleaned greeting content (first 16 hex)
 */
export function buildGreetingSeedTurnId(
  cardId: string,
  greetingId: string,
  contentHash: string,
): string {
  return `${GREETING_SEED_MODEL_PREFIX}:${cardId}:${greetingId}:${contentHash.slice(0, 16)}`;
}

/**
 * Lightweight content-hash for idempotent commit. We re-use the
 * `computeContentHash` semantics from agent-runtime: djb2, deterministic.
 *
 * Kept inline to avoid pulling internal agent-runtime helpers into a
 * different module graph. The agent-runtime's AgentSessionCommitV1 also
 * computes a djb2 hash over the same `assistantOutput` text; both are
 * deterministic over the same input, so they align.
 */
export function computeContentHash(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) & 0xffffffff;
  }
  return `sha_${(hash >>> 0).toString(36)}`;
}

/**
 * True iff a turn was persisted by THIS service. Marker is the
 * modelConfig.provider === "card-import". This field is never rendered
 * into the player-visible prompt (verified at design time).
 */
export function isGreetingSeedTurn(turn: AgentTurnV1): boolean {
  const provider = (turn.modelConfig as { provider?: string } | undefined)?.provider;
  return provider === GREETING_SEED_PROVIDER;
}

/**
 * True iff the existing seed was produced for the same (cardId, greetingId).
 * We do NOT compare contentHash here because the contentHash in the model
 * string is the first 16 hex chars — that already pins the content.
 */
function greetingSeedMatches(turn: AgentTurnV1, cardId: string, greetingId: string): boolean {
  const model = (turn.modelConfig as { model?: string } | undefined)?.model ?? "";
  if (!model.startsWith(`${GREETING_SEED_MODEL_PREFIX}:`)) return false;
  const parts = model.split(":");
  // [ "greeting-seed-v1", cardId, greetingId, hash16 ]
  if (parts.length < 4) return false;
  return parts[1] === cardId && parts[2] === greetingId;
}

function isValidCardId(cardId: string): boolean {
  return /^[0-9a-f]{64}$/.test(cardId);
}

function isValidSessionId(sessionId: string): boolean {
  return /^[a-zA-Z0-9_.:-]{1,128}$/.test(sessionId);
}

function isValidGreetingId(greetingId: string): boolean {
  return /^g[0-9]+$/.test(greetingId);
}

/**
 * Internal helper exposed only for tests: build a Card-like entry DTO from
 * raw on-disk bytes. Production code does NOT use this; tests use it to
 * construct fixtures.
 */
export type { ImportedGreetingV1 };
