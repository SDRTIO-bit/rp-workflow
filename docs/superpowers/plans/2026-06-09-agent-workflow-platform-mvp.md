# Agent Workflow Platform MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local visual workflow MVP with multiple independent Agent nodes, DAG parallel execution, cache-aware prompt assembly, and formatter/typecheck/linter verification.

**Architecture:** Use a pnpm TypeScript monorepo with `apps/web` for the React app and focused packages for workflow core, Agent runtime, plugin SDK, and future database models. The first runtime uses mock LLM/plugin behavior so the graph model, permissions, cache prefixing, and UI can be verified before external provider setup.

**Tech Stack:** pnpm, Vite, React, TypeScript, React Flow, Tailwind CSS, ESLint, Prettier, Vitest.

---

## File Structure

- Create `package.json`: root workspace scripts, verification commands, dev dependencies.
- Create `pnpm-workspace.yaml`: workspace package globs.
- Create `tsconfig.base.json`: shared compiler settings.
- Create `.prettierrc.json`: formatter rules.
- Create `.prettierignore`: generated dependency/build ignores.
- Create `eslint.config.js`: flat ESLint config for TypeScript and React.
- Create `apps/web/package.json`: web app scripts and dependencies.
- Create `apps/web/index.html`: Vite entry shell.
- Create `apps/web/src/main.tsx`: React mount.
- Create `apps/web/src/App.tsx`: primary workflow workbench composition.
- Create `apps/web/src/styles.css`: Tailwind and app styling.
- Create `apps/web/src/components/*`: canvas, palette, inspector, run log, and reusable controls.
- Create `apps/web/src/state/sampleWorkflows.ts`: seed workflows.
- Create `packages/workflow-core/*`: schemas, node registry, validation, DAG scheduler, runner, tests.
- Create `packages/agent-runtime/*`: mock LLM adapter, prompt builder, Agent executor, tests.
- Create `packages/plugin-sdk/*`: plugin/tool interfaces.
- Create `packages/db/*`: future persistence models.

## Task 1: Scaffold Monorepo And Triple Verification

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `eslint.config.js`

- [ ] **Step 1: Create root workspace files**

Add root scripts:

```json
{
  "private": true,
  "name": "agent-workflow-platform",
  "version": "0.1.0",
  "type": "module",
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "dev": "pnpm --filter @awp/web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "format": "prettier . --write",
    "format:check": "prettier . --check",
    "typecheck": "tsc -b --pretty false",
    "lint": "eslint .",
    "verify": "pnpm format:check && pnpm typecheck && pnpm lint"
  },
  "devDependencies": {
    "@eslint/js": "^9.28.0",
    "eslint": "^9.28.0",
    "eslint-plugin-react-hooks": "^5.2.0",
    "eslint-plugin-react-refresh": "^0.4.20",
    "globals": "^16.2.0",
    "prettier": "^3.5.3",
    "typescript": "^5.8.3",
    "typescript-eslint": "^8.33.1",
    "vitest": "^3.2.2"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
pnpm install
```

Expected: lockfile created and dependencies installed.

- [ ] **Step 3: Run initial verification**

Run:

```bash
pnpm verify
```

Expected: either passes on empty scaffold or reports package files still to be added. Fix formatting/config problems before moving on.

## Task 2: Implement Workflow Core

**Files:**

- Create: `packages/workflow-core/package.json`
- Create: `packages/workflow-core/tsconfig.json`
- Create: `packages/workflow-core/src/types.ts`
- Create: `packages/workflow-core/src/nodeRegistry.ts`
- Create: `packages/workflow-core/src/validation.ts`
- Create: `packages/workflow-core/src/scheduler.ts`
- Create: `packages/workflow-core/src/runner.ts`
- Create: `packages/workflow-core/src/index.ts`
- Create: `packages/workflow-core/src/workflow-core.test.ts`

- [ ] **Step 1: Define workflow types**

Implement `WorkflowDefinition`, `WorkflowNode`, `WorkflowEdge`, `PortDefinition`, `NodeDefinition`, `WorkflowValidationIssue`, `NodeRunResult`, and `WorkflowRunResult`.

- [ ] **Step 2: Define the MVP node registry**

Add definitions for `userInput`, `agent`, `textOutput`, `debugLog`, `promptTemplate`, and `mockSearch`, including typed input/output ports.

- [ ] **Step 3: Implement validation**

Validation must check duplicate ids, unknown node types, missing edge endpoints, missing ports, incompatible port directions, basic type compatibility, and cycles.

- [ ] **Step 4: Implement DAG scheduler**

Implement ready-node batching so independent nodes are returned together for parallel execution.

- [ ] **Step 5: Implement mock runner**

Implement `runWorkflow` that validates the graph, runs ready batches with `Promise.all`, stores node inputs/outputs, and preserves errors without hiding partial results.

- [ ] **Step 6: Add tests**

Tests must cover valid simple workflow, valid parallel fan-out/fan-in workflow, invalid edge, cycle detection, and parallel batching.

- [ ] **Step 7: Verify package**

Run:

```bash
pnpm --filter @awp/workflow-core test
pnpm verify
```

Expected: tests pass and triple verification passes.

## Task 3: Implement Agent Runtime

**Files:**

- Create: `packages/plugin-sdk/package.json`
- Create: `packages/plugin-sdk/tsconfig.json`
- Create: `packages/plugin-sdk/src/index.ts`
- Create: `packages/agent-runtime/package.json`
- Create: `packages/agent-runtime/tsconfig.json`
- Create: `packages/agent-runtime/src/types.ts`
- Create: `packages/agent-runtime/src/promptBuilder.ts`
- Create: `packages/agent-runtime/src/mockLlm.ts`
- Create: `packages/agent-runtime/src/agentExecutor.ts`
- Create: `packages/agent-runtime/src/index.ts`
- Create: `packages/agent-runtime/src/agent-runtime.test.ts`

- [ ] **Step 1: Define plugin/tool interfaces**

Implement `PluginDefinition`, `ToolDefinition`, `ToolCallInput`, and `ToolCallResult`.

- [ ] **Step 2: Define Agent runtime types**

Implement `AgentNodeConfig`, `SkillDefinition`, `AgentExecutionInput`, `AgentExecutionResult`, and `LlmAdapter`.

- [ ] **Step 3: Implement cache-aware prompt builder**

Build output with explicit `cacheablePrefix`, `dynamicSuffix`, `cacheablePrefixHash`, and `dynamicInputHash`.

- [ ] **Step 4: Implement mock LLM adapter**

Return deterministic text based on model, prompt hash, and dynamic input preview.

- [ ] **Step 5: Implement Agent executor**

Expose only granted skills/plugins to the prompt builder and result metadata.

- [ ] **Step 6: Add tests**

Tests must cover stable-before-dynamic ordering, capability isolation, independent cache hashes for different Agent configs, and deterministic mock output.

- [ ] **Step 7: Verify package**

Run:

```bash
pnpm --filter @awp/agent-runtime test
pnpm verify
```

Expected: tests pass and triple verification passes.

## Task 4: Build Web App Workbench

**Files:**

- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tsconfig.node.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/styles.css`
- Create: `apps/web/src/components/WorkflowCanvas.tsx`
- Create: `apps/web/src/components/NodePalette.tsx`
- Create: `apps/web/src/components/InspectorPanel.tsx`
- Create: `apps/web/src/components/RunLogPanel.tsx`
- Create: `apps/web/src/components/Toolbar.tsx`
- Create: `apps/web/src/components/nodes/WorkflowNodeCard.tsx`
- Create: `apps/web/src/state/sampleWorkflows.ts`
- Create: `apps/web/src/state/workflowUi.ts`

- [ ] **Step 1: Create Vite React app files**

Use React + TypeScript + Vite with React Flow and Tailwind.

- [ ] **Step 2: Create workbench layout**

Build a dense tool UI with left palette, center canvas, right inspector, bottom/side run log, and top toolbar.

- [ ] **Step 3: Render seed workflows**

Include simple, retrieval, and parallel multi-Agent samples.

- [ ] **Step 4: Add interactive node configuration**

Allow editing Agent model, prompt, skills, plugins, and output type in local state.

- [ ] **Step 5: Wire runner**

Run the current workflow through `@awp/workflow-core` using mock node executors and show node statuses/logs.

- [ ] **Step 6: Add validation display**

Show schema/graph validation issues separately from runtime logs.

- [ ] **Step 7: Verify app**

Run:

```bash
pnpm --filter @awp/web build
pnpm verify
```

Expected: app builds and triple verification passes.

## Task 5: Browser Verification And Polish

**Files:**

- Modify: `apps/web/src/*`

- [ ] **Step 1: Start dev server**

Run:

```bash
pnpm dev
```

Expected: Vite dev server starts and prints a local URL.

- [ ] **Step 2: Verify core workflow manually**

Open the app, run the parallel sample, and confirm multiple independent Agent nodes execute before the fan-in Agent.

- [ ] **Step 3: Verify responsive layout**

Check desktop and mobile widths for text overflow, panel usability, and canvas visibility.

- [ ] **Step 4: Run triple verification**

Run:

```bash
pnpm verify
```

Expected: formatter check, typecheck, and linter pass.

## Plan Self-Review

- Spec coverage: covers multi-Agent independence, DAG parallel execution, cache-aware prompt assembly, product workflow validation, and engineering triple verification.
- Placeholder scan: no unfinished marker text remains.
- Type consistency: package names use the `@awp/*` convention throughout.
- Scope check: plan implements MVP scaffold and local runtime; external LLM, database persistence, auth, and marketplace are intentionally excluded.
