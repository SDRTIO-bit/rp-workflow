# Agent Workflow Platform

A ComfyUI-style generic agent workflow platform. The Official RP Workflow is
the first product template shipped on this platform.

```text
Project state (default entry point for new sessions):
  docs/project-state-through-p15.2.md
  (previous: docs/project-state-through-p15.1.md)

Source-of-truth policy (priority order for resolving conflicts):
  docs/source-of-truth.md
```

Other documentation:

- `docs/HANDOFF.md` — earlier phase handoff (historical).
- `docs/HANDOFF-PHASE-I2.md` — RP runtime integration handoff (historical).
- `docs/rp-playable-mvp-v1.md` — how to run the P-15.1 real-Provider validation.
- `docs/reports/` — per-phase reports.
- `docs/research/`, `docs/superpowers/` — research and design notes.

The frozen code baselines are:

- `phase-rp-narrative-novelty-guard-v1-stable` → `9394493` (P-15.2, current).
- `phase-rp-playable-mvp-v1-stable` → `09d53ac` (P-15.1, prior freeze, not moved).

The current `master` HEAD is `9394493`. Do not move the frozen tags;
new work gets a new phase, a new tag, and a new report under
`docs/reports/`.

## License

See `LICENSE` if present. Otherwise the project is unlicensed and the
default copyright notice in each source file applies.
