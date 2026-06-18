# Project State Through P-15.2

> **Default entry point for new development sessions.** Read this first.
>
> Last updated against: `9394493` on `master`, tag
> `phase-rp-narrative-novelty-guard-v1-stable` (new) and previous tag
> `phase-rp-playable-mvp-v1-stable` → `09d53ac` (P-15.1, not moved).
> This document is the only local source of truth for the project's
> frozen state. Anything in this document that conflicts with Git tags
> / current code / current workflows is overridden by Git. See
> `docs/source-of-truth.md` for the priority order.
>
> Per the project's `rp-workflow-comfyui-constraint` memory, the RP
> chain must be expressed through workflow / node / parameter
> composition. Hard-coding RP semantics into the program is forbidden;
> any code-level change to RP behavior must be confirmed with the user
> first.

## 1. Project Goal

This repository is a **Generic Agent Workflow Platform**.

The Official RP Workflow is the **first product template** shipped on
this platform. It is not a fixed RP application, and it is not a fixed
multi-agent system with one agent per role. The platform's design intent
is:

- A ComfyUI-style node and workflow editor at its core.
- Composable nodes, typed ports, deterministic execution.
- Workflow JSON as the formal orchestration artifact.
- Generic agents and specialized agents coexist; the workflow binds them
  to a product (e.g. RP), not the program.
- New product templates (chatbot, document pipeline, etc.) can be
  authored by composing existing nodes, not by forking the runtime.

The Official RP Workflow is the canonical example. Other templates will
follow the same authoring discipline.

## 2. P-15.1 Frozen Result (inherited)

- HEAD before P-15.2 began: `09d53ac`
  (`perf(rp): trim critic and curator production context`).
- P-15.1 20-turn real-Provider validation: 20/20 `acceptedTurns`,
  0 `exhaustedTurns`, 19 `firstPassAccepted`, 1 `revisionAccepted`
  (turn 8). Detail in
  `docs/reports/p15.1-real-20-turn-validation.md` and
  `docs/reports/p15.1-independent-freeze-review.md`.
- P-15.1 warning W-1: turn 14 narrative was byte-identical to turn 13
  (156 normalized chars) — the case P-15.2 was designed to close.
- P-15.1 tag `phase-rp-playable-mvp-v1-stable` → `09d53ac`. **Not
  moved.** A P-15.1 tag move is, by definition, a new phase with its
  own tag.

## 3. P-15.2 New Nodes (three)

P-15.2 adds three node types and one shared extractor instance plus
four inspect nodes. The diff is +3331 / -7 across 23 files (see
`docs/reports/p15.2-independent-acceptance-and-freeze.md` §2 for the
per-commit breakdown).

| Node                              | Type ID                           | Package           | Role                                                                                                                                                                                                                                   |
| --------------------------------- | --------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `textNoveltyCheck`                | `textNoveltyCheck`                | `workflow-stdlib` | Pure, generic, RP-agnostic text-duplication check. NFKC + zero-width strip + whitespace collapse + trim. Default `minNormalizedLength=64`. Emits `awp.text-novelty-report.v1`.                                                         |
| `agentSessionLastAssistantOutput` | `agentSessionLastAssistantOutput` | `agent-runtime`   | Session-aware extractor. Reads `sessionContext.turns` and emits the **previous committed** assistant output (or empty when no prior turn). One shared instance feeds both novelty checks.                                              |
| `rpQualityDecisionMerge`          | `rpQualityDecisionMerge`          | `agent-runtime`   | Merges `gateResult` (Critic Gate) with `noveltyReport`. Two output ports: `decision` (small, for routing / Writer 2 / selector) and `diagnostics` (full, for inspect only). Config carries `attempt` and `noveltyRevisionInstruction`. |

The three node types are deterministic, free of LLM calls, and preserve
the `rpSideEffectDecision` policy as the sole owner of
`allowPlayerOutput` / `allowSessionCommit` / `allowMemoryCommit`. No
Critic prompt template was modified; no third Writer / Critic pass was
introduced; no `rpSideEffectDecision` policy was added.

## 4. Official RP Workflow — Current Data Flow (P-15.2)

Authoritative source: `data/workflows/rp-unified-stateful-production-v1.json`.
This is the workflow bound to `POST /api/rp`.

```text
Input
  → Session Load (agentSessionLoadV1)
  → Agent Session Last Assistant Output          (×1, shared, new in P-15.2)
  → Worldbook Retrieval (dynamicWorldbook + genericRetriever + retrievalResultToMarkdown)
  → Memory Retrieval   (memoryCorpus  + genericRetriever + retrievalResultToMarkdown)
  → Writer 1           (specializedAgent, profileId: rp-writer)
  → Text Novelty Check 1 (textNoveltyCheck)              ─┐
  → Critic 1           (specializedAgent, profileId: rp-critic) ─┐
  → Gate 1             (rpCriticQualityGate)                ─┼─► rpQualityDecisionMerge1
  → [optional] Writer 2  (specializedAgent, profileId: rp-writer, attempt 2)
  → Text Novelty Check 2 (textNoveltyCheck)              ─┐
  → Critic 2           (specializedAgent, profileId: rp-critic) ─┐
  → Gate 2             (rpCriticQualityGate)                ─┼─► rpQualityDecisionMerge2
  → Final Draft Selector (finalDraftSelector)
  → Side Effect Decision (rpSideEffectDecision)
  → Player Output      (playerOutput)            (when allowPlayerOutput)
  → Session Commit     (buildSessionDelta → agentSessionCommitV1)
  → [accepted-only] Curator (specializedAgent, profileId: rp-memory-curator)
  → Memory Policy      (rpMemoryCommitPolicy)
  → Memory Write       (memoryWrite)
  → [rejected path]    failWorkflow (no side effect)
```

Routing:

- `rpQualityDecisionMerge1.decision` is the new `route.condition` source
  (replacing the old `gate1.result` source). The merge sets
  `accepted = false` if Novelty reports `exact_duplicate` and the
  Critic also fails, OR if Novelty reports `exact_duplicate` and the
  Critic was already going to revise; it then sets `decision =
"revise"` on attempt 1 with `noveltyRevisionInstruction` in the
  `## Data` block, or `decision = "exhausted"` on attempt 2.
- `rpQualityDecisionMerge2.decision` is the new
  `selector.secondGateResult` source (replacing the old `gate2.result`
  source). On attempt 2, the `selector` still reads
  `secondGateResult.accepted === false → loopResult.exhausted = true`
  via the existing `finalDraftSelector` logic.
- Writer 2's `data` port receives `merge1.decision` JSON (the small
  four-field object: `accepted`, `decision`, `revisionInstruction?`,
  `failedChecks`). The `diagnostics` port is wired **only** to
  `inspMerge1` / `inspMerge2` inspect nodes — never to `writer2`,
  `route`, or `selector`. The audit test (R5) and the prompt-capture
  test in `rpNoveltyReplayE2E.test.ts` enforce this.
- First-turn behavior: `sessionContext.turns.length === 0` →
  `agentSessionLastAssistantOutput.text === ""` →
  `textNoveltyCheck.report.reason = "no_reference"`,
  `evaluated = false`, `exactDuplicate = false`; merge follows the
  Critic gate.

## 5. `accepted` / `exhausted` Side Effects

P-15.2 inherits the existing `rpSideEffectDecision` policy. Novelty
Merge does not declare a side-effect policy.

| `loopResult.exhausted` | `behavior.onExhausted`              | `allowPlayerOutput` | `allowSessionCommit`                        | `allowMemoryCommit`                        |
| ---------------------- | ----------------------------------- | ------------------- | ------------------------------------------- | ------------------------------------------ |
| `false` (any reason)   | (n/a)                               | `true`              | `true`                                      | `true` (subject to `rpMemoryCommitPolicy`) |
| `true`                 | `exhausted-return-latest` (default) | `true`              | `true` (commits the latest available draft) | `false`                                    |
| `true`                 | `exhausted-fail`                    | `false`             | `false`                                     | `false`                                    |

When a Writer-2 novelty-exact-duplicate produces `exhausted`:

- `exhausted-return-latest` (default): the player receives the latest
  available draft; session commit happens; memory is not written. The
  `finalDraftSelector` falls back to the previous accepted draft (or
  fails the workflow) when `secondGateResult.accepted === false`. The
  "latest available" draft in this scenario is therefore the prior
  committed one, not the duplicated Writer-2 draft.
- `exhausted-fail`: the workflow fails; no commit, no memory.

## 6. Current HEAD and Tags

```text
master HEAD:           9394493 (test(rp): close p15.2 novelty routing acceptance gaps)
New Tag:               phase-rp-narrative-novelty-guard-v1-stable  → 9394493
Previous Tag (frozen): phase-rp-playable-mvp-v1-stable             → 09d53ac (P-15.1, not moved)
Branch:                master
Worktree:              clean (operator-draft archive moved outside the repo)
```

Both tags are immutable. New work gets a new phase, a new tag, and a
new report under `docs/reports/`.

## 7. Known Risks and Warnings

- **W-1 — cross-turn narrative repeat (P-15.1 → P-15.2 mitigated).**
  P-15.1 turn 14 was byte-identical to turn 13. P-15.2 closes the
  unit-level case via `textNoveltyCheck`. Empirical proof on a real
  Provider is a follow-up short smoke (see §10). Per
  `rp-workflow-comfyui-constraint`, any further mitigation is workflow
  / node / parameter work, not a code change. Confirm with the user
  before any code change.
- **W-2 (new in P-15.2) — Writer 2 `## Data` carries the `schemaId`.**
  The rendered Writer 2 prompt contains the `awp.rp-decision.v1`
  `schemaId` field as part of the `## Data` JSON block. This matches
  the P-15.1 pattern for `gate1.result`. A future preset that wants
  to hide the `schemaId` would do so via prompt-template work, not a
  code change. Non-blocking.
- **N-1 — session `tokenUsage` is an estimate** (inherited from
  P-15.1). The session store records small-integer `tokenUsage` for
  the per-turn session delta. It is **not** the Provider's usage. Do
  not use it for billing or quota.
- **N-2 — no per-role input / output token breakdown** (inherited
  from P-15.1). `run-summary.json` records aggregate per-turn
  tokens, not per-call per-role. A future phase may add a per-role
  telemetry node (workflow-layer, not runtime-layer).

## 8. Capabilities That Are **Not** Proven (inherited + new)

- Large-scale concurrency.
- Multi-user account isolation.
- Production database deployment (D1 / Postgres / etc.).
- Distributed execution across nodes.
- A formal `Workflow Resume` API on `POST /api/rp` (the workflow is
  restart-tolerant via the file session store, but there is no public
  resume endpoint beyond sending the same `sessionId`).
- Vector / Embedding semantic memory.
- Supermemory-style layered memory.
- Unbounded agent loops.
- Multi-critic voting.
- A complete plugin marketplace.
- Commercial billing / metering.
- **Near-duplicate similarity as a forced revise trigger** (new
  P-15.2 exclusion). The `reason` enum in `awp.text-novelty-report.v1`
  reserves no near-duplicate value; `exactDuplicate` is the only
  verdict field.
- **Embedding / vector / LLM-judge similarity** (new P-15.2
  exclusion).
- **Window > 1 for reference text** (new P-15.2 exclusion). V1 uses
  the most recent committed turn only.
- **Multi-locale normalization** (new P-15.2 exclusion). V1 is
  language-neutral by design.
- **Real-Provider re-run of the 20-turn corpus** (intentional P-15.2
  freeze). The deterministic-replay fixture in
  `rpNoveltyReplayE2E.test.ts` is the unit-level proof; a real
  Provider smoke is a follow-up.
- **A new `rpSideEffectDecision` policy for "novelty-exhausted ⇒ no
  commit"** (new P-15.2 exclusion). The existing
  `behavior.onExhausted` is the only exhausted side-effect policy.

## 9. New-Session Working Rules (P-15.2)

1. **Read this document first** (`docs/project-state-through-p15.2.md`),
   then `docs/source-of-truth.md`, then the P-15.2 freeze report at
   `docs/reports/p15.2-independent-acceptance-and-freeze.md`. The
   three together establish the local source-of-truth hierarchy.
2. **Check Git before relying on the docs.** `git status`, `git log`,
   `git tag --points-at HEAD` must be the first three commands of any
   working session. Expect to see `9394493` on `master` and both
   stable tags.
3. **Reports do not override the repo.** A phase report is a snapshot
   of the state at the time it was written. If the code, the tag, or
   the test has changed, the repo wins.
4. **Do not modify a frozen tag.** Both
   `phase-rp-narrative-novelty-guard-v1-stable` and
   `phase-rp-playable-mvp-v1-stable` are immutable. New work gets a
   new tag.
5. **New features start a new phase.** Each new phase should:
   - be planned as `P-x.y` with explicit scope,
   - keep its changes reviewable in a single PR,
   - be frozen with its own annotated tag,
   - leave a local Markdown report under `docs/reports/`.
6. **Do not depend on external chat history.** Past phase reports may
   live in an external ChatGPT project; this session cannot read them.
   If something is not in the repo, it does not exist for the purposes
   of automation.
7. **Artifacts do not enter Git.** `artifacts/`, `.env`, local browser
   profiles, and provider logs are git-ignored. Do not propose adding
   them.
8. **Never print secrets.** No API keys, no Bearer tokens, no Provider
   request / response bodies in tracked files. `.env.example` is the
   empty-value template only.
9. **Every phase report must record:**
   - Branch, HEAD, tag (current and previous frozen),
   - Tests added / changed and their real count (not estimates),
   - Quality gates run and their real exit codes,
   - Risks / warnings observed (with the W / N naming used here),
   - Out-of-scope items the phase deliberately did not do.
10. **RP behavior changes go through the workflow.** Per the
    `rp-workflow-comfyui-constraint` memory, modifying the RP chain
    means changing profiles, workflow JSON, or node parameters — not
    hard-coding into the runtime. Any code-level change to RP behavior
    must be confirmed with the user first.

## 10. Next-Phase Recommendations

### 10.1 Short real-Provider smoke under P-15.2 wiring

A 5-turn or fewer real DeepSeek run (P-15.1's `scripts/run-rp-mvp-v1.mjs`
driver is the starting point, with a smaller `MAX_TURNS`). Purpose:
empirically confirm that the V1 novelty check fires against a real
response, not just the deterministic-replay fixture. The
`artifacts/rp-mvp-v1/` evidence should be cross-checked against the
design's R-13-14-A expectations.

### 10.2 P-16 — Agent Node UX & Workflow Configurability

Once the empirical smoke is green, P-16 should focus on the agent-node
configuration surface so workflow authors can tune novelty thresholds,
`noveltyRevisionInstruction`, and per-attempt behavior without editing
production code. The principle stays the same: changes go through
workflow JSON and node config, not through the LLM adapter or profile.
