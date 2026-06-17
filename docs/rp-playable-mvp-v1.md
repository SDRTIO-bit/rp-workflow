# RP Playable MVP V1

This pass uses one real provider, one committed worldbook resource file, the official unified RP workflow, and the existing `/rp` page.

## Real Provider

Set `RP_PROVIDER=deepseek`, `RP_MODEL=deepseek-v4-flash`, and `DEEPSEEK_API_KEY` in your local environment. Do not commit `.env` or provider logs.

## Restart-Safe State

Use file stores when validating restart recovery:

```text
AGENT_SESSION_STORE=file
AGENT_SESSION_DIR=./artifacts/rp-mvp-v1/agent-sessions
WORKFLOW_MEMORY_STORE=file
WORKFLOW_MEMORY_DIR=./artifacts/rp-mvp-v1/workflow-memory
```

`AGENT_SESSION_STORE=in-memory` remains the default for lightweight development.

## Twenty-Turn Validation

Build first, then run the gated script:

```bash
npm run build
RUN_REAL_RP_MVP_V1=1 RP_PROVIDER=deepseek node scripts/run-rp-mvp-v1.mjs
```

The script starts the built server, sends 20 turns through `POST /api/rp`, restarts the server after turn 10, continues with the same `sessionId`, and writes ignored evidence to `artifacts/rp-mvp-v1/`.

## Browser QA

For `/rp`, run the built server with the same file store settings, then smoke:

- first real turn
- Continue
- Quality, Usage, and Observability panels
- New Session
- desktop and mobile screenshots

Screenshots and QA summaries belong in `artifacts/rp-mvp-v1/browser/` and must not be committed.
