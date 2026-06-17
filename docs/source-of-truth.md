# Source-of-Truth Policy

> Companion to `docs/project-state-through-p15.1.md`. This file defines the
> priority order for resolving conflicts between documentation, code, and
> external chat history.

## 1. Priority Order

When two sources disagree, the higher-priority source wins. The list is
exhaustive and ordered most-trusted → least-trusted.

1. **Current Git commit / tag.**
   `git rev-parse --short HEAD`, `git tag --points-at HEAD`, the diff
   between this commit and any ancestor, and the contents of any
   annotated tag object. If a tag is annotated, the tag object itself
   is part of the source of truth.

2. **Current production code and workflow JSON.**
   Everything under `packages/`, `apps/`, `data/workflows/`, plus the
   build outputs the runtime loads. Frozen node shapes, profiles, and
   workflow structure are read from these directories, not from
   documentation.

3. **Current automated tests.**
   `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`,
   `npm run verify`. If a test passes, the behavior it pins is the
   current contract.

4. **Current artifacts** (git-ignored).
   `artifacts/rp-mvp-v1/run-summary.json`, the per-turn JSON files,
   `restart-evidence/`, `agent-sessions/`, `workflow-memory/`. These
   describe the most recent real run, not the design intent.

5. **`docs/project-state-through-p15.1.md`.**
   The project-state document is the only Markdown file treated as a
   first-class source of truth for the project. It must always reflect
   the current Git state.

6. **`docs/reports/*`.**
   Per-phase reports. A report is a snapshot of the state at the time
   it was written. It loses authority as soon as the code, the tag,
   the tests, or the artifacts change in a way the report does not
   reflect.

7. **External chat records (ChatGPT, etc.).**
   The lowest priority. External conversations are not durable, are
   not versioned, and may be deleted or truncated. They are
   **not** an acceptable dependency for any automation, build, or
   release decision.

## 2. Conflict Resolution

When two sources disagree:

- A report that contradicts Git is **wrong**. Update the report (or, if
  the report is a historical snapshot, mark the relevant section as
  "historical; superseded by …").
- A README that contradicts the code is **wrong**. Edit the README.
- Documentation in `docs/` that contradicts the project-state document
  is **wrong**. Project state is the single source of truth for
  project-level claims.
- An external chat record that contradicts the repo is **noise**. It is
  not a dependency; ignore it.

## 3. Document Maintenance Rules

- Every document in `docs/` carries a "Last updated against" line that
  names the Git commit it was authored against. A document without this
  line is incomplete.
- If a commit changes a section of the project that a document covers,
  the next working session must update that document before claiming
  the work is done.
- Frozen phase reports stay frozen; they describe a past state. New
  changes get a new phase, a new tag, and a new report.

## 4. What This Means for New Sessions

- Read the project-state document first.
- Run `git status`, `git rev-parse --short HEAD`, and
  `git tag --points-at HEAD` before opening any other file.
- If you find that a tracked file contradicts the project-state
  document, the project-state document wins — and you should open a
  follow-up to reconcile the file.
- If you find that the project-state document contradicts Git, Git
  wins — and you should open a follow-up to update the project-state
  document.

## 5. Anti-Patterns

These have all been seen during the project's history. They are listed
here so a future session can recognize and avoid them.

- **Treating an external chat as the source of truth.** The chat is a
  scratch pad, not a contract. Anything that matters must land in the
  repo.
- **Hand-editing a frozen report to match a new commit.** A frozen
  report describes a frozen state. If the code changes, write a new
  report; do not rewrite history.
- **Skipping the Git check and trusting the README.** The README is a
  pointer. The pointer is right only if Git is right.
- **Adding `artifacts/` to Git "just this once".** `artifacts/` is
  git-ignored on purpose. The `.gitignore` is part of the source of
  truth.
- **Committing a real `.env`.** Use `.env.example` with empty values
  for templates, and keep the real key outside the repo.
