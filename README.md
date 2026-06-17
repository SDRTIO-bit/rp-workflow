# Agent Workflow Platform

A ComfyUI-style generic agent workflow platform. The Official RP Workflow is
the first product template shipped on this platform.

```text
Project state (default entry point for new sessions):
  docs/project-state-through-p15.1.md

Source-of-truth policy (priority order for resolving conflicts):
  docs/source-of-truth.md
```

Other documentation:

- `docs/HANDOFF.md` — earlier phase handoff (historical).
- `docs/HANDOFF-PHASE-I2.md` — RP runtime integration handoff (historical).
- `docs/rp-playable-mvp-v1.md` — how to run the P-15.1 real-Provider validation.
- `docs/reports/` — per-phase reports.
- `docs/research/`, `docs/superpowers/` — research and design notes.

The frozen code baseline is commit `09d53ac`, tagged
`phase-rp-playable-mvp-v1-stable` (annotated, dereferences to
`09d53ac`). The current `master` HEAD is `1dd6608`, a documentation-
only commit on top of the freeze. Do not move the frozen tag; new work
gets a new phase, a new tag, and a new report under `docs/reports/`.

## License

See `LICENSE` if present. Otherwise the project is unlicensed and the
default copyright notice in each source file applies.
