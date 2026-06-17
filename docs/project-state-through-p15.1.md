# Project State Through P-15.1

> **Default entry point for new development sessions.** Read this first.
>
> Last updated against: `09d53ac` on `master`, tag `phase-rp-playable-mvp-v1-stable`.
> This document is the only local source of truth for the project's frozen state.
> Anything in this document that conflicts with Git tags / current code / current
> workflows is overridden by Git. See `docs/source-of-truth.md` for the priority
> order.
>
> Per the project's `rp-workflow-comfyui-constraint` memory, the RP chain must
> be expressed through workflow / node / parameter composition. Hard-coding
> RP semantics into the program is forbidden; any code-level change to RP
> behavior must be confirmed with the user first.

## 1. Project Goal

This repository is a **Generic Agent Workflow Platform**.

The Official RP Workflow is the **first product template** shipped on this
platform. It is not a fixed RP application, and it is not a fixed multi-agent
system with one agent per role. The platform's design intent is:

- A ComfyUI-style node and workflow editor at its core.
- Composable nodes, typed ports, deterministic execution.
- Workflow JSON as the formal orchestration artifact.
- Generic agents and specialized agents coexist; the workflow binds them to
  a product (e.g. RP), not the program.
- New product templates (chatbot, document pipeline, etc.) can be authored
  by composing existing nodes, not by forking the runtime.

The Official RP Workflow is the canonical example. Other templates will
follow the same authoring discipline.

## 2. Core Design Principles

These principles are derived from the current code, `Agent-Workflow-Platform-思路记录.md`, and `docs/HANDOFF.md`. They are not invented.

1. **ComfyUI-style nodes and workflows.** Nodes have typed input / output
   ports; the workflow is a directed graph connecting them. The platform
   is the editor + runner; the workflow is the user's program.
2. **Workflow JSON is the formal orchestration.** A workflow under
   `data/workflows/` is the authoritative definition of an end-to-end
   pipeline. It can be reviewed in PRs and pinned by version.
3. **Nodes are replaceable and reusable.** Writer, critic, curator, worldbook,
   memory, retrieval — all are nodes. Swapping a node's parameters or
   replacing it with a different profile does not require runtime changes.
4. **`genericAgent` and `specializedAgent` coexist.** Generic agents hold
   raw LLM calls; specialized agents bind a profile (writer / critic /
   curator / etc.) for type-safety and prompt isolation.
5. **RP is expressed by profile + workflow, not by code.** All RP behavior
   is configured by the RP profiles and the `rp-unified-stateful-production-v1`
   workflow. The runtime stays generic.
6. **Explicit typed ports.** Nodes declare input / output types. Mismatched
   connections are caught at compile time of the workflow.
7. **Agents do not freely read the store.** Session, Worldbook, Memory,
   Checkpoint are accessed through dedicated nodes. Direct ad-hoc reads
   from inside a profile are discouraged.
8. **Layered state.** Session (turn-level) / Worldbook (canon-level) /
   Memory (long-term recall) / Checkpoint (idempotency) are separate
   concerns, with separate stores and separate write paths.
9. **Deterministic gates control side effects.** A "rejected" gate
   deterministically suppresses session commit, memory write, and player
   output. The same is true of the `exhausted-fail` path.
10. **Quality first, but bounded.** Quality is non-negotiable, but revision
    loops, retriever calls, and LLM calls are bounded by Gate thresholds
    and config. Cost and latency budgets are observed.

## 3. Package Responsibilities

Verified against the current workspace (this list is exhaustive — there are
**no other** packages in `packages/`).

| Package                     | Responsibility                                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@awp/workflow-core`        | Node types, registry, scheduler, runner. The minimum kernel.                                                                                                    |
| `@awp/workflow-stdlib`      | Built-in node implementations: Markdown merge, JSON source, inspection helpers, etc.                                                                            |
| `@awp/agent-runtime`        | LLM adapters (mock + deepseek), session store adapter, retry logic, telemetry hooks.                                                                            |
| `@awp/workflow-retrieval`   | Generic retriever node (keyword strategy), retrieval-result-to-markdown formatter.                                                                              |
| `@awp/workflow-memory`      | Memory corpus node, memory write node, generic memory store contract.                                                                                           |
| `@awp/workflow-worldbook`   | Dynamic worldbook node (query / write with lifecycle and allowedOperations), canonical store.                                                                   |
| `@awp/workflow-persistence` | Persistence types and adapters shared by stores.                                                                                                                |
| `@awp/rp-runtime`           | RP-specific nodes and profiles (writer / critic / curator / rp-critic-quality-gate / rp-side-effect-decision / rp-memory-commit-policy / final-draft-selector). |
| `@awp/memory-core`          | Memory entry types, ranking, importance / confidence scoring.                                                                                                   |
| `@awp/db`                   | DB persistence types. No production D1 / Postgres deployment today.                                                                                             |
| `@awp/plugin-sdk`           | Plugin / skill definition, executor factory.                                                                                                                    |
| `@awp/server`               | Express/Hono backend. Exposes `POST /api/rp`, session endpoints, and serves built web.                                                                          |
| `@awp/web`                  | React frontend. Includes the `/rp` page and the workflow canvas.                                                                                                |

> The `rp-runtime` package hosts the RP node implementations and profiles.
> The runtime itself (`agent-runtime`, `workflow-core`, …) does not contain
> RP-specific logic; RP behavior comes from profile + workflow composition.

## 4. Official RP Workflow

Authoritative source: `data/workflows/rp-unified-stateful-production-v1.json`.
This is the workflow bound to `POST /api/rp`.

Pipeline (in order):

```text
Input
  → Session Load (agentSessionLoadV1)
  → Worldbook Retrieval (dynamicWorldbook + genericRetriever + retrievalResultToMarkdown)
  → Memory Retrieval   (memoryCorpus  + genericRetriever + retrievalResultToMarkdown)
  → Writer 1           (specializedAgent, profileId: rp-writer)
  → Critic 1           (specializedAgent, profileId: rp-critic)
  → Gate 1             (rpCriticQualityGate)
  → [optional] Writer 2  (specializedAgent, profileId: rp-writer, attempt 2)
  → Critic 2           (specializedAgent, profileId: rp-critic)
  → Gate 2             (rpCriticQualityGate)
  → Final Draft Selector (finalDraftSelector)
  → Side Effect Decision (rpSideEffectDecision)
  → Player Output      (playerOutput)            (when allowPlayerOutput)
  → Session Commit     (buildSessionDelta → agentSessionCommitV1)
  → [accepted-only] Curator (specializedAgent, profileId: rp-memory-curator)
  → Memory Policy      (rpMemoryCommitPolicy)
  → Memory Write       (memoryWrite)
  → [rejected path]    failWorkflow (no side effect)
```

Notes:

- The branch from `critic1 → gate1` is a `conditionalRoute`. If `gate1`
  accepts, the draft is committed; if it requests revision, the workflow
  runs `writer2 → critic2 → gate2` and the selector picks the final draft.
- The post-output branch routes on `rpSideEffectDecision.allowPlayerOutput`
  for player output, and on `allowMemoryCommit` for the memory curator.
  A rejected side-effect decision does not write anything.
- `critic1` and `critic2` use the worldbook markdown as context (post-5-3
  trimming). They do **not** receive the merged session + memory markdown.
- The `critic2Instruction` builder constructs critic 2's instruction from
  the rubric and `gate1`'s result (the issues to address in the revision).

## 5. Frozen Phase Index

> Reconstructed from `git tag --points-at` and `git log` only. Anything not
> visible from a tag or a commit subject is treated as "historical report
> unavailable; see the Git diff for the implementation".

| Tag                                                  | Subject / focus (verified)                               | Status |
| ---------------------------------------------------- | -------------------------------------------------------- | ------ |
| `phase-platform-foundation-stable`                   | Platform foundation                                      | frozen |
| `phase-three-wire-static-agent-v1-stable`            | Three-wire static agent smoke                            | frozen |
| `phase-b2-stable`                                    | Phase B-2                                                | frozen |
| `phase-b2.8-stable`                                  | Phase B-2.8                                              | frozen |
| `phase-composable-context-v1-stable`                 | Composable context                                       | frozen |
| `phase-retrieval-layer-v1-stable`                    | Retrieval layer                                          | frozen |
| `phase-dynamic-worldbook-core-v1-stable`             | Dynamic worldbook core                                   | frozen |
| `phase-memory-library-v1-stable`                     | Memory library                                           | frozen |
| `phase-rp-writer-real-vertical-slice-v1-stable`      | RP writer real vertical slice                            | frozen |
| `phase-rp-critic-quality-gate-v1-stable`             | RP critic profile + deterministic Quality Gate           | frozen |
| `phase-rp-writer-critic-bounded-loop-v1-stable`      | Deterministic lazy conditional routing                   | frozen |
| `phase-stateful-rp-context-v1-stable`                | Stateful RP context                                      | frozen |
| `phase-unified-stateful-rp-production-v1-stable`     | Unified stateful RP production workflow                  | frozen |
| `phase-rp-memory-commit-policy-v1-stable`            | RP memory commit policy                                  | frozen |
| `phase-rp-side-effect-safety-v1-stable`              | Idempotent session commit semantics                      | frozen |
| `phase-rp-real-vertical-slice-v1-stable`             | RP real vertical slice (end-to-end smoke)                | frozen |
| `phase-official-rp-workflow-migration-v1-stable`     | Official RP workflow registry / service / route          | frozen |
| `phase-runtime-observability-usage-budget-v1-stable` | Observability telemetry and usage budgets                | frozen |
| `phase-official-rp-web-integration-v1-stable`        | Official RP web integration                              | frozen |
| `phase-web-v2-clean-rebuild-stable`                  | Web v2 clean rebuild                                     | frozen |
| `phase-rp-playable-mvp-v1-stable`                    | **RP Playable MVP V1** (current frozen HEAD = `09d53ac`) | frozen |

Historical phase reports (P-4 … P-14) were not committed to the local repo;
they live in an external chat project that this session cannot read. Detailed
implementation for any pre-15.1 phase is therefore taken from the Git diff
for that phase's tag, not from a local report.

## 6. Current Product Capabilities

All items in this list have a real artifact, code path, or test behind them.
They are not aspirational.

- Official `POST /api/rp` is wired through `apps/server` and runs the
  `rp-unified-stateful-production-v1` workflow.
- Unified workflow is the default path. The old smoke workflows under
  `data/workflows/` are kept for testing, not user-facing.
- Multi-turn sessions via the file session store. Each `sessionId` keeps
  the conversation history; turn count and token budget are bounded.
- File session store survives process exit. Restart after turn 10 was
  exercised in P-15.1; turn 11 continued with the same `sessionId`.
- Dynamic worldbook with `query` and `write` operations, lifecycle
  (`session` / …), and `allowedOperations` enforcement.
- Generic memory (corpus + write) with a per-turn `rpMemoryCommitPolicy`
  that gates by `minImportance`, `minConfidence`, and `maxCandidatesPerTurn`.
- Writer + Critic + one revision, with deterministic Gate thresholds
  (`minContinuity`, `minPlayerAgency`, `rejectOnErrorIssue`).
- `accepted` / `exhausted` outcomes with the "rejected" path producing
  **zero** side effect (no session commit, no memory write, no player
  output).
- `accepted`-only Memory Curator. A rejected turn does not feed memory.
- Idempotent session commit and memory write (`commitDedup`, `dedup`,
  `operationId`-style keys). Replay does not double-commit.
- Token / latency observability in `run-summary.json` and the API
  response. Aggregated and per-turn. Per-call Provider usage is preserved.
- Usage budgets in `@awp/agent-runtime` (token and call caps).
- Web UI: `Send` / `Continue` / `Retry` / `Cancel` / `New Session` for `/rp`,
  with desktop and mobile acceptance screenshots in `artifacts/`.
- 20-turn real-Provider run with `deepseek-v4-flash` in
  `artifacts/rp-mvp-v1/`. See `docs/reports/p15.1-real-20-turn-validation.md`.

## 7. P-15.1 Frozen Baseline

```text
Branch: master
HEAD:   09d53ac
Tag:    phase-rp-playable-mvp-v1-stable
```

Detail:

- **20-turn validation report**: `docs/reports/p15.1-real-20-turn-validation.md`
- **Independent freeze review report**: `docs/reports/p15.1-independent-freeze-review.md`
- **Validation driver**: `scripts/run-rp-mvp-v1.mjs`
- **Run artifacts** (git-ignored): `artifacts/rp-mvp-v1/`
  - `run-summary.json` (headline metrics, per-turn snapshot)
  - `narrative-review-extract.md` (turn-by-turn text)
  - `restart-evidence/` (turn 10 server restart logs)
  - `turns/turn-01.json` … `turns/turn-20.json`
  - `agent-sessions/agent-sessions.json`
  - `workflow-memory/workflow-memories.json`

The frozen tag **must not** be moved. Any new work that needs the tag
re-pointed is, by definition, a new phase with its own tag.

## 8. Known Risks and Warnings

These are explicitly **not** P-15.1 blockers. They are tracked so future
phases can address them deliberately.

- **W-1 — cross-turn narrative repeat and ignored user instruction.** Turn
  14 of the P-15.1 run repeats turn 13 verbatim and ignores the player's
  "请区分钥匙旧事与脚步声新事" instruction. Cause: the post-5-3 critic /
  curator soft-threshold relaxation. Remediation, per
  `rp-workflow-comfyui-constraint`: a workflow / node / parameter change
  (e.g. a lightweight "narrative-repetition" gate node), not a code
  change to the LLM adapter or profile. Confirm with the user before any
  code change.
- **N-1 — Session `tokenUsage` is an estimate.** The session store records
  small-integer `tokenUsage` for the per-turn session delta. It is **not**
  the Provider's usage. Do not use it for billing or quota.
- **N-2 — No per-role input / output token breakdown.** The current
  artifact (`run-summary.json`) records aggregate per-turn tokens, not
  per-call per-role. A future phase may add a per-role telemetry node
  (workflow-layer, not runtime-layer).

## 9. Capabilities That Are **Not** Proven

These are explicitly out of scope for P-15.1. Do not claim them in any
report or commit message.

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

## 10. New-Session Working Rules

Any new development session must observe these rules. They are not negotiable.

1. **Read this document first** (`docs/project-state-through-p15.1.md`),
   then `docs/source-of-truth.md`. The two together establish the local
   source-of-truth hierarchy.
2. **Check Git before relying on the docs.** `git status`, `git log`,
   `git tag --points-at HEAD` must be the first three commands of any
   working session.
3. **Reports do not override the repo.** A phase report is a snapshot of
   the state at the time it was written. If the code, the tag, or the
   test has changed, the repo wins.
4. **Do not modify a frozen tag.** The frozen tag
   `phase-rp-playable-mvp-v1-stable` is immutable. New work gets a new
   tag.
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
   - Branch, HEAD, tag,
   - Tests added / changed and their real count (not estimates),
   - Quality gates run and their real exit codes,
   - Risks / warnings observed (with the W / N naming used here),
   - Out-of-scope items the phase deliberately did not do.
10. **RP behavior changes go through the workflow.** Per the
    `rp-workflow-comfyui-constraint` memory, modifying the RP chain
    means changing profiles, workflow JSON, or node parameters — not
    hard-coding into the runtime. Any code-level change to RP behavior
    must be confirmed with the user first.
