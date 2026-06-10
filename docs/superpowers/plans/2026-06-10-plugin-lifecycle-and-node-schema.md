# Plugin Lifecycle & Node Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 5-phase plugin protocol roadmap: plugin management API, frontend plugin panel, node observability, parameter schema upgrade, and remote-http executor.

**Architecture:** Each phase builds on the previous. Phase 1 converts server-side constants to mutable runtime state with persistence. Phase 2 adds the UI layer. Phase 3 defines a generic metadata view schema for structured node run inspection. Phase 4 upgrades the config field type system with validation. Phase 5 enables remote HTTP executors.

**Tech Stack:** TypeScript, React, Node.js HTTP server, Vitest

---

## File Structure

```
apps/web/scripts/serve.mjs          — Modify: mutable plugin runtime, API endpoints, remote-http
apps/web/src/App.tsx                 — Modify: plugin panel, metadata views, new field kinds, duration
apps/web/src/runWorkflowClient.ts    — Modify: add plugin API client functions
apps/web/src/nodeConfigValidation.ts — Create: config field validation pure functions
apps/web/src/styles.css              — Modify: new UI styles
packages/plugin-sdk/src/index.ts     — Modify: metadata view types, executor timeout, re-exports
packages/workflow-core/src/types.ts  — Modify: NodeConfigField extension, NodeConfigPreset
plugins/plugin-state.json            — Create: initial empty state file
```

---

### Task 1: Prepare mutable runtime state in serve.mjs

**Files:**
- Modify: `apps/web/scripts/serve.mjs:229-234`

**Goal:** Convert `const` plugin runtime variables to `let` so enable/disable can mutate them.

- [ ] **Step 1: Convert const to let for mutable runtime state**

In `apps/web/scripts/serve.mjs`, change lines 229-234 from:

```js
const plugins = await loadNodePlugins();
const pluginCatalog = createPluginCatalog(plugins);
const runtimeNodeCatalog = {
  ...nodeRegistry,
  ...pluginCatalog,
};
```

To:

```js
let plugins = await loadNodePlugins();
let pluginCatalog = createPluginCatalog(plugins);
let runtimeNodeCatalog = {
  ...nodeRegistry,
  ...pluginCatalog,
};
```

- [ ] **Step 2: Verify tests still pass after const→let change**

Run: `npm run test`
Expected: all tests pass (const → let is not a breaking change)

- [ ] **Step 3: Commit**

```bash
git add apps/web/scripts/serve.mjs
git commit -m "refactor: convert plugin runtime state from const to let for mutable lifecycle

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Add plugin state persistence

**Files:**
- Modify: `apps/web/scripts/serve.mjs` (add plugin-state.json read/write + reloadPluginRuntime)
- Create: `plugins/plugin-state.json`

**Goal:** Load and persist runtime plugin state overrides to `plugins/plugin-state.json`.

- [ ] **Step 1: Create initial plugin-state.json**

```bash
echo "{}" > "F:/1/新建文件夹 (2)/plugins/plugin-state.json"
```

- [ ] **Step 2: Add state file path constant and load/save functions**

In `apps/web/scripts/serve.mjs`, after the `pluginsDir` declaration (line 80), add:

```js
const pluginStateFile = join(pluginsDir, "plugin-state.json");

const loadPluginState = async () => {
  try {
    return JSON.parse(await readFile(pluginStateFile, "utf8"));
  } catch {
    return {};
  }
};

const savePluginState = async (state) => {
  await mkdir(pluginsDir, { recursive: true });
  await writeFile(pluginStateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};
```

- [ ] **Step 3: Merge plugin state into loaded plugins after loadNodePlugins()**

Replace the plugin loading block (lines 229-234):

```js
let plugins = await loadNodePlugins();
let pluginCatalog = createPluginCatalog(plugins);
let runtimeNodeCatalog = {
  ...nodeRegistry,
  ...pluginCatalog,
};
```

With:

```js
let pluginState = await loadPluginState();
let plugins = await loadNodePlugins();

// Merge runtime state into plugins
for (const plugin of plugins) {
  const state = pluginState[plugin.manifest.id];
  if (state && typeof state.enabled === "boolean") {
    plugin.manifest.enabled = state.enabled;
  }
}

let pluginCatalog = createPluginCatalog(plugins);
let runtimeNodeCatalog = {
  ...nodeRegistry,
  ...pluginCatalog,
};
```

- [ ] **Step 4: Add reloadPluginRuntime function**

Add after the plugin initialization block:

```js
const reloadPluginRuntime = async () => {
  pluginState = await loadPluginState();
  plugins = await loadNodePlugins();

  for (const plugin of plugins) {
    const state = pluginState[plugin.manifest.id];
    if (state && typeof state.enabled === "boolean") {
      plugin.manifest.enabled = state.enabled;
    }
  }

  pluginCatalog = createPluginCatalog(plugins);
  runtimeNodeCatalog = {
    ...nodeRegistry,
    ...pluginCatalog,
  };
};
```

- [ ] **Step 5: Run tests**

Run: `npm run test`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add apps/web/scripts/serve.mjs plugins/plugin-state.json
git commit -m "feat: add plugin state persistence with plugin-state.json

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Add GET /api/plugins endpoint

**Files:**
- Modify: `apps/web/scripts/serve.mjs` (add route handler)

**Goal:** Return merged plugin list with manifest + runtime state.

- [ ] **Step 1: Add GET /api/plugins route**

In the route handler, add before the existing `/api/nodes` route (before line 599):

```js
if (request.method === "GET" && pathname === "/api/plugins") {
  const pluginList = plugins.map((plugin) => {
    const state = pluginState[plugin.manifest.id];
    const manifestEnabled = plugin.manifest.enabled !== false;
    const userOverride = state && typeof state.enabled === "boolean";
    const effectiveEnabled = userOverride ? state.enabled : manifestEnabled;

    return {
      id: plugin.manifest.id,
      label: plugin.manifest.label,
      version: plugin.manifest.version,
      description: plugin.manifest.description ?? "",
      author: plugin.manifest.author,
      manifestEnabled,
      enabled: effectiveEnabled,
      stateSource: userOverride ? "user" : "manifest",
      permissions: plugin.manifest.permissions ?? [],
      dependencies: plugin.manifest.dependencies ?? [],
      compatibility: plugin.manifest.compatibility ?? null,
      nodeTypes: plugin.manifest.nodes.map((node) => node.type),
    };
  });

  sendJson(response, 200, { plugins: pluginList });
  return;
}
```

- [ ] **Step 2: Verify endpoint with curl**

Start server: `npm run serve` (in background), then:

```bash
curl http://127.0.0.1:5180/api/plugins
```

Expected: JSON array with rp-core plugin showing `manifestEnabled: true, enabled: true, stateSource: "manifest"`

- [ ] **Step 3: Stop server and commit**

```bash
git add apps/web/scripts/serve.mjs
git commit -m "feat: add GET /api/plugins endpoint with merged state

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Add enable/disable API endpoints

**Files:**
- Modify: `apps/web/scripts/serve.mjs` (add POST /api/plugins/:id/enable and disable)

**Goal:** Enable/disable plugins at runtime, persist to plugin-state.json, refresh runtime catalog.

- [ ] **Step 1: Add enable/disable route handlers**

Add after the GET /api/plugins route:

```js
const pluginActionMatch = pathname.match(/^\/api\/plugins\/([^/]+)\/(enable|disable)$/);
if (pluginActionMatch && request.method === "POST") {
  const [, pluginId, action] = pluginActionMatch;

  const plugin = plugins.find((p) => p.manifest.id === pluginId);
  if (!plugin) {
    sendJson(response, 404, { error: `Plugin not found: ${pluginId}` });
    return;
  }

  const nextEnabled = action === "enable";
  pluginState[pluginId] = {
    ...(pluginState[pluginId] ?? {}),
    enabled: nextEnabled,
    updatedAt: new Date().toISOString(),
  };

  await savePluginState(pluginState);
  await reloadPluginRuntime();

  const updated = plugins.find((p) => p.manifest.id === pluginId);
  sendJson(response, 200, {
    id: pluginId,
    enabled: nextEnabled,
    manifestEnabled: plugin.manifest.enabled !== false,
    stateSource: "user",
    nodeTypes: updated ? updated.manifest.nodes.map((n) => n.type) : [],
  });
  return;
}
```

- [ ] **Step 2: Verify enable/disable with curl**

Start server, then:

```bash
# Disable rp-core
curl -X POST http://127.0.0.1:5180/api/plugins/awp.rp-core/disable

# Check plugins list
curl http://127.0.0.1:5180/api/plugins
# Expected: rp-core shows enabled: false, stateSource: "user"

# Check nodes — RP nodes should be absent
curl http://127.0.0.1:5180/api/nodes
# Expected: no rpDialogueDirector, worldbookSearch, etc.

# Re-enable
curl -X POST http://127.0.0.1:5180/api/plugins/awp.rp-core/enable

# Check nodes again — RP nodes should be back
curl http://127.0.0.1:5180/api/nodes
```

- [ ] **Step 3: Verify plugin-state.json was written**

```bash
cat "F:/1/新建文件夹 (2)/plugins/plugin-state.json"
```

Expected: `{"awp.rp-core":{"enabled":true,"updatedAt":"..."}}`

- [ ] **Step 4: Add disabled-plugin validation message**

In `packages/workflow-core/src/validation.ts`, the `validateWorkflow` function currently checks `!catalog[node.type]`. This already covers disabled plugins since their nodes are removed from the catalog. No code change needed — the existing "Unknown node type" message is sufficient for v1. Add a note in serve.mjs that when a disabled plugin is re-enabled, `reloadPluginRuntime()` rebuilds the catalog and validation passes again.

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/serve.mjs plugins/plugin-state.json
git commit -m "feat: add POST /api/plugins/:id/enable and disable endpoints

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Add plugin client to frontend

**Files:**
- Modify: `apps/web/src/runWorkflowClient.ts` (add plugin API functions)

**Goal:** Frontend functions to call plugin management APIs.

- [ ] **Step 1: Add plugin API client functions**

In `apps/web/src/runWorkflowClient.ts`, add after the existing functions:

```ts
export type PluginSummary = {
  id: string;
  label: string;
  version: string;
  description: string;
  author?: string;
  manifestEnabled: boolean;
  enabled: boolean;
  stateSource: "manifest" | "user";
  permissions: string[];
  dependencies: { id: string; versionRange?: string; optional?: boolean }[];
  compatibility: { app?: string; workflowSchema?: number } | null;
  nodeTypes: string[];
};

export const loadPluginsViaServer = async (
  fetcher: Fetcher = fetch,
): Promise<PluginSummary[] | undefined> => {
  try {
    const response = await fetcher("/api/plugins");
    if (!response.ok) return undefined;
    return ((await response.json()) as { plugins: PluginSummary[] }).plugins;
  } catch {
    return undefined;
  }
};

export const enablePluginViaServer = async (
  pluginId: string,
  fetcher: Fetcher = fetch,
): Promise<PluginSummary | undefined> => {
  try {
    const response = await fetcher(`/api/plugins/${encodeURIComponent(pluginId)}/enable`, {
      method: "POST",
    });
    if (!response.ok) return undefined;
    return (await response.json()) as PluginSummary;
  } catch {
    return undefined;
  }
};

export const disablePluginViaServer = async (
  pluginId: string,
  fetcher: Fetcher = fetch,
): Promise<PluginSummary | undefined> => {
  try {
    const response = await fetcher(`/api/plugins/${encodeURIComponent(pluginId)}/disable`, {
      method: "POST",
    });
    if (!response.ok) return undefined;
    return (await response.json()) as PluginSummary;
  } catch {
    return undefined;
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/runWorkflowClient.ts
git commit -m "feat: add plugin API client functions to frontend

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Add plugin management modal to App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx` (add plugin button, modal, state)
- Modify: `apps/web/src/styles.css` (modal styles)

**Goal:** Top bar "插件" button opens a modal showing plugin list with enable/disable controls.

- [ ] **Step 1: Add plugin-related state and imports**

In `App.tsx`, add import (near line 54):

```ts
import {
  disablePluginViaServer,
  enablePluginViaServer,
  loadPluginsViaServer,
  type PluginSummary,
} from "./runWorkflowClient";
```

Add state variables after the existing `useState` declarations (after line 316):

```ts
const [pluginSummaries, setPluginSummaries] = useState<PluginSummary[]>([]);
const [showPluginPanel, setShowPluginPanel] = useState(false);
const [pluginPanelError, setPluginPanelError] = useState("");
```

- [ ] **Step 2: Add loadPlugins function and wire into useEffect**

Add after the `loadRuntimeConfiguration` function (after line 397):

```ts
const loadPlugins = async () => {
  const loaded = await loadPluginsViaServer();
  if (loaded) {
    setPluginSummaries(loaded);
    setPluginPanelError("");
  } else {
    setPluginPanelError("插件服务不可用，当前使用本地内置节点。");
  }
};
```

Add `void loadPlugins();` inside the existing `useEffect` `loadRuntimeConfiguration` callback, after the template loading:

```ts
useEffect(() => {
  const loadRuntimeConfiguration = async () => {
    const [loadedNodes, loadedTemplates] = await Promise.all([
      loadNodeManifestsViaServer(),
      loadWorkflowTemplatesViaServer(),
    ]);

    if (loadedNodes?.length) setNodeDefinitions(loadedNodes);
    if (loadedTemplates?.length) setTemplateDefinitions(loadedTemplates);
  };

  void loadRuntimeConfiguration();
}, []);
```

Replace with:

```ts
useEffect(() => {
  const loadRuntimeConfiguration = async () => {
    const [loadedNodes, loadedTemplates] = await Promise.all([
      loadNodeManifestsViaServer(),
      loadWorkflowTemplatesViaServer(),
    ]);

    if (loadedNodes?.length) setNodeDefinitions(loadedNodes);
    if (loadedTemplates?.length) setTemplateDefinitions(loadedTemplates);

    await loadPlugins();
  };

  void loadRuntimeConfiguration();
}, []);
```

- [ ] **Step 3: Add plugin toggle handler**

Add function:

```ts
const handleTogglePlugin = async (plugin: PluginSummary, enable: boolean) => {
  if (!enable) {
    const usedNodeTypes = workflow.nodes
      .map((n) => n.type)
      .filter((t) => plugin.nodeTypes.includes(t));
    if (usedNodeTypes.length > 0) {
      const confirmed = window.confirm(
        language === "zh"
          ? `当前工作流正在使用 ${usedNodeTypes.length} 个该插件节点，禁用后会校验失败。`
          : `The current workflow uses ${usedNodeTypes.length} nodes from this plugin. Disabling will cause validation errors.`,
      );
      if (!confirmed) return;
    }
  }

  const result = enable
    ? await enablePluginViaServer(plugin.id)
    : await disablePluginViaServer(plugin.id);

  if (!result) {
    setRunNotice(
      language === "zh" ? `插件 ${enable ? "启用" : "禁用"} 失败` : `Plugin ${enable ? "enable" : "disable"} failed`,
    );
    return;
  }

  await loadPlugins();
  const [loadedNodes] = await Promise.all([loadNodeManifestsViaServer()]);
  if (loadedNodes?.length) setNodeDefinitions(loadedNodes);
  setRunNotice(
    language === "zh"
      ? `插件 "${plugin.label}" 已${enable ? "启用" : "禁用"}。`
      : `Plugin "${plugin.label}" ${enable ? "enabled" : "disabled"}.`,
  );
};
```

- [ ] **Step 4: Add top bar button**

After the import button in the header (after line 1166), add:

```tsx
<button
  className="secondary-button"
  type="button"
  onClick={() => {
    void loadPlugins();
    setShowPluginPanel(true);
  }}
>
  {language === "zh" ? "插件" : "Plugins"}
</button>
```

- [ ] **Step 5: Add plugin management modal**

Add the modal JSX before the closing `</main>` tag (before line 1509), after the bottom-dock section:

```tsx
{showPluginPanel ? (
  <div className="modal-overlay" onClick={() => setShowPluginPanel(false)}>
    <div className="modal-content plugin-panel" onClick={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <h2>{language === "zh" ? "插件管理" : "Plugin Management"}</h2>
        <button className="modal-close" type="button" onClick={() => setShowPluginPanel(false)}>
          ×
        </button>
      </div>
      {pluginPanelError ? (
        <p className="notice">{pluginPanelError}</p>
      ) : pluginSummaries.length === 0 ? (
        <p className="muted">{language === "zh" ? "没有已安装的插件。" : "No plugins installed."}</p>
      ) : (
        <div className="plugin-card-list">
          {pluginSummaries.map((plugin) => (
            <div key={plugin.id} className={`plugin-card ${plugin.enabled ? "" : "plugin-disabled"}`}>
              <div className="plugin-card-header">
                <strong>{plugin.label}</strong>
                <span className="plugin-version">v{plugin.version}</span>
                <span className={`plugin-status ${plugin.enabled ? "status-on" : "status-off"}`}>
                  {plugin.enabled
                    ? language === "zh" ? "✓ 启用" : "✓ On"
                    : language === "zh" ? "✕ 禁用" : "✕ Off"}
                </span>
              </div>
              <p className="plugin-state-source">
                {plugin.enabled && plugin.stateSource === "manifest" && "默认启用"}
                {!plugin.enabled && plugin.stateSource === "manifest" && "默认禁用"}
                {plugin.enabled && plugin.stateSource === "user" && "用户手动启用"}
                {!plugin.enabled && plugin.stateSource === "user" && "用户手动禁用"}
              </p>
              {plugin.description ? <p className="plugin-desc">{plugin.description}</p> : null}
              <div className="plugin-perms">
                {plugin.permissions.map((perm) => (
                  <code key={perm} className="perm-tag">{perm}</code>
                ))}
              </div>
              <p className="plugin-node-types">
                {language === "zh" ? "节点: " : "Nodes: "}
                {plugin.nodeTypes.slice(0, 3).join(", ")}
                {plugin.nodeTypes.length > 3 ? ` +${plugin.nodeTypes.length - 3}` : ""}
              </p>
              <div className="plugin-card-actions">
                {plugin.enabled ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => handleTogglePlugin(plugin, false)}
                  >
                    {language === "zh" ? "禁用" : "Disable"}
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => handleTogglePlugin(plugin, true)}
                  >
                    {language === "zh" ? "启用" : "Enable"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
) : null}
```

- [ ] **Step 6: Add CSS styles**

In `apps/web/src/styles.css`, append:

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--panel-bg);
  border-radius: 10px;
  padding: 24px;
  max-width: 620px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.modal-header h2 {
  margin: 0;
  font-size: 1.15rem;
}

.modal-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  color: var(--text-muted);
}

.plugin-card-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.plugin-card {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 14px 16px;
}

.plugin-card.plugin-disabled {
  opacity: 0.7;
}

.plugin-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.plugin-card-header strong {
  font-size: 1.02rem;
}

.plugin-version {
  color: var(--text-muted);
  font-size: 0.82rem;
}

.plugin-status {
  margin-left: auto;
  font-size: 0.85rem;
  font-weight: 600;
}

.plugin-status.status-on {
  color: #16a34a;
}

.plugin-status.status-off {
  color: #dc2626;
}

.plugin-state-source {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin: 2px 0 6px;
}

.plugin-desc {
  font-size: 0.85rem;
  margin: 0 0 8px;
}

.plugin-perms {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.perm-tag {
  font-size: 0.72rem;
  background: var(--code-bg);
  padding: 1px 6px;
  border-radius: 3px;
}

.plugin-node-types {
  font-size: 0.82rem;
  color: var(--text-muted);
  margin: 0 0 10px;
}

.plugin-card-actions {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 7: Build and verify**

```bash
npm run build
npm run serve
```

Open `http://127.0.0.1:5180`, click "插件", verify:
- Modal opens with rp-core plugin info
- Enable/disable buttons work
- Node library refreshes after toggle
- Disabling a plugin whose nodes are on canvas shows confirm dialog

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "feat: add plugin management modal with enable/disable controls

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Define metadata view types in plugin-sdk

**Files:**
- Modify: `packages/plugin-sdk/src/index.ts` (add view types)

**Goal:** Define `NodeRunMetadataView` union type and related types.

- [ ] **Step 1: Add metadata view types**

In `packages/plugin-sdk/src/index.ts`, add after the existing type exports (after line 79):

```ts
export type MetadataEntryItem = {
  id: string;
  title: string;
  summary?: string;
  tags?: string[];
  metadata?: Record<string, string>;
};

export type MetadataStatPair = {
  label: string;
  value: string | number | boolean;
  tone?: "default" | "success" | "warning" | "danger";
};

export type MetadataTraceStep = {
  label: string;
  status?: "success" | "error" | "skipped";
  detail?: string;
  durationMs?: number;
};

export type NodeRunMetadataView =
  | { id: string; kind: "entry-list"; title: string; items: MetadataEntryItem[] }
  | { id: string; kind: "code"; title: string; content: string; language?: string }
  | { id: string; kind: "stats"; title: string; pairs: MetadataStatPair[] }
  | { id: string; kind: "text"; title: string; content: string }
  | { id: string; kind: "object"; title: string; value: Record<string, unknown> }
  | { id: string; kind: "trace"; title: string; steps: MetadataTraceStep[] };
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors (types are additive, no breaking changes)

- [ ] **Step 3: Commit**

```bash
git add packages/plugin-sdk/src/index.ts
git commit -m "feat: add NodeRunMetadataView types for structured observability

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: Add structured view rendering to App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx` (SnapshotBlock upgrade, duration display, copy buttons)
- Modify: `apps/web/src/styles.css` (view styles)

**Goal:** Replace JSON.stringify rendering with structured view rendering when `metadata.views` is present.

- [ ] **Step 1: Add view rendering component**

In `App.tsx`, add a new `MetadataViews` component. Add it before the `PortList` component (before line 1521):

```tsx
function MetadataViews({ views }: { views: Array<{ id: string; kind: string; title: string; [key: string]: unknown }> }) {
  const [copiedId, setCopiedId] = useState<string>();

  const copyViewContent = async (view: { id: string; kind: string; title: string; [key: string]: unknown }) => {
    let text: string;
    switch (view.kind) {
      case "entry-list":
        text = (view.items as Array<{ title: string; summary?: string }>)
          .map((item) => `${item.title}${item.summary ? `: ${item.summary}` : ""}`)
          .join("\n");
        break;
      case "code":
      case "text":
        text = String(view.content ?? "");
        break;
      case "stats":
        text = (view.pairs as Array<{ label: string; value: unknown }>)
          .map((pair) => `${pair.label}: ${String(pair.value)}`)
          .join("\n");
        break;
      case "object":
        text = JSON.stringify(view.value, null, 2);
        break;
      case "trace":
        text = (view.steps as Array<{ label: string; status?: string; detail?: string }>)
          .map((step) => `[${step.status ?? "-"}] ${step.label}${step.detail ? ` — ${step.detail}` : ""}`)
          .join("\n");
        break;
      default:
        text = JSON.stringify(view, null, 2);
    }

    await navigator.clipboard.writeText(text);
    setCopiedId(view.id);
    setTimeout(() => setCopiedId(undefined), 1500);
  };

  return views.map((view) => (
    <details key={view.id} className="metadata-view" open>
      <summary className="metadata-view-header">
        <span>{view.title}</span>
        <button
          className="copy-button"
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void copyViewContent(view);
          }}
        >
          {copiedId === view.id ? "✓" : "📋"}
        </button>
      </summary>
      <div className="metadata-view-body">
        {view.kind === "entry-list" && (
          <ul className="entry-list">
            {(view.items as Array<{ id: string; title: string; summary?: string; tags?: string[] }>).map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                {item.summary ? <span className="entry-summary">{item.summary}</span> : null}
                {item.tags?.length ? (
                  <span className="entry-tags">{item.tags.join(", ")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {view.kind === "code" && (
          <pre className="code-block">
            <code>{String(view.content)}</code>
          </pre>
        )}
        {view.kind === "stats" && (
          <table className="stats-table">
            <tbody>
              {(view.pairs as Array<{ label: string; value: unknown; tone?: string }>).map((pair, i) => (
                <tr key={i} className={pair.tone ? `tone-${pair.tone}` : ""}>
                  <td>{pair.label}</td>
                  <td>{String(pair.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view.kind === "text" && <p className="text-block">{String(view.content)}</p>}
        {view.kind === "object" && (
          <pre className="code-block">
            <code>{JSON.stringify(view.value, null, 2)}</code>
          </pre>
        )}
        {view.kind === "trace" && (
          <ol className="trace-list">
            {(view.steps as Array<{ label: string; status?: string; detail?: string; durationMs?: number }>).map((step, i) => (
              <li key={i} className={`trace-step trace-${step.status ?? "default"}`}>
                <span>{step.label}</span>
                {step.detail ? <span className="trace-detail">{step.detail}</span> : null}
                {step.durationMs !== undefined ? (
                  <span className="trace-duration">{step.durationMs}ms</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  ));
}
```

- [ ] **Step 2: Upgrade SnapshotBlock to use MetadataViews**

Replace the existing `SnapshotBlock` function (line 1512-1518):

```tsx
function SnapshotBlock({ title, value }: { title: string; value: unknown }) {
  const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
  const views = isObject && "views" in value && Array.isArray((value as Record<string, unknown>).views)
    ? (value as { views: Array<{ id: string; kind: string; title: string; [key: string]: unknown }> }).views
    : undefined;

  return (
    <details className="snapshot-block">
      <summary>{title}</summary>
      {views ? (
        <MetadataViews views={views} />
      ) : (
        <pre>{stringifySnapshot(value)}</pre>
      )}
    </details>
  );
}
```

- [ ] **Step 3: Add duration display to run log rows**

In the run log rendering (around line 1488), change the run row to include duration:

```tsx
{run.status === "success" || run.status === "error" ? (
  <span className="run-duration">
    {Math.max(0, run.endedAt - run.startedAt) < 1000
      ? `${Math.max(0, run.endedAt - run.startedAt)}ms`
      : `${((run.endedAt - run.startedAt) / 1000).toFixed(1)}s`}
  </span>
) : null}
```

Add inside the run row `button`, after the `<span>{run.status}</span>`.

- [ ] **Step 4: Add duration to inspector**

In the inspector `nodeRunDetails` section (around line 1406), add before the SnapshotBlocks:

```tsx
{selectedNodeRun ? (
  <div className="run-timing">
    <span className={`run-status-badge run-${selectedNodeRun.status}`}>
      {selectedNodeRun.status === "success" ? "✓" : selectedNodeRun.status === "error" ? "✕" : "⊘"}
    </span>
    <span>
      {language === "zh" ? "耗时 " : "Duration "}
      {Math.max(0, selectedNodeRun.endedAt - selectedNodeRun.startedAt) < 1000
        ? `${Math.max(0, selectedNodeRun.endedAt - selectedNodeRun.startedAt)}ms`
        : `${((selectedNodeRun.endedAt - selectedNodeRun.startedAt) / 1000).toFixed(1)}s`}
    </span>
  </div>
) : null}
```

- [ ] **Step 5: Add CSS for new components**

In `apps/web/src/styles.css`, append:

```css
.metadata-view {
  margin-top: 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.metadata-view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.88rem;
}

.copy-button {
  background: none;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 1px 6px;
}

.metadata-view-body {
  padding: 8px 10px;
  border-top: 1px solid var(--border-color);
}

.entry-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.entry-list li {
  padding: 4px 0;
  border-bottom: 1px solid var(--border-color);
}

.entry-list li:last-child {
  border-bottom: none;
}

.entry-summary {
  display: block;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.entry-tags {
  font-size: 0.72rem;
  color: var(--text-muted);
  display: block;
}

.code-block {
  background: var(--code-bg);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 0.8rem;
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.stats-table {
  width: 100%;
  font-size: 0.85rem;
}

.stats-table td {
  padding: 3px 6px;
}

.stats-table td:first-child {
  font-weight: 600;
  width: 40%;
}

.tone-success td:last-child {
  color: #16a34a;
}

.tone-warning td:last-child {
  color: #d97706;
}

.tone-danger td:last-child {
  color: #dc2626;
}

.text-block {
  font-size: 0.85rem;
  white-space: pre-wrap;
}

.trace-list {
  margin: 0;
  padding-left: 20px;
}

.trace-step {
  padding: 2px 0;
  font-size: 0.82rem;
}

.trace-success { color: #16a34a; }
.trace-error { color: #dc2626; }
.trace-skipped { color: var(--text-muted); }

.trace-detail {
  display: block;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.trace-duration {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-left: 6px;
}

.run-timing {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  margin-bottom: 8px;
  padding: 6px 8px;
  background: var(--code-bg);
  border-radius: 4px;
}

.run-status-badge {
  font-weight: 700;
  width: 20px;
  text-align: center;
}

.run-duration {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-left: auto;
}
```

- [ ] **Step 6: Build and typecheck**

```bash
npm run typecheck
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "feat: add structured metadata view rendering and duration display

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: Add views to rp-core executor

**Files:**
- Modify: `plugins/rp-core/executor.mjs` (add views to metadata)

**Goal:** Demonstrate structured views in the rp-core plugin by adding entry-list and stats views to worldbookSearch and memoryRecall.

- [ ] **Step 1: Add views to worldbookSearch**

Update `worldbookSearch` in `plugins/rp-core/executor.mjs`:

```js
worldbookSearch: async ({ node, inputs }) => {
  const entries = await context.readWorldbook();
  const query = String(inputs.query ?? node.config.query ?? "");
  const results = context.rankEntries(query, entries, Number(node.config.limit ?? 4));

  return {
    outputs: {
      results: context.serializeEntries(results),
    },
    metadata: {
      pluginId: "awp.rp-core",
      matchedWorldbookIds: results.map((entry) => entry.id),
      matchedWorldbookTitles: results.map((entry) => entry.title),
      views: [
        {
          id: "worldbook_hits",
          kind: "entry-list",
          title: "命中世界书条目",
          items: results.map((entry) => ({
            id: entry.id,
            title: entry.title,
            summary: String(entry.content ?? "").slice(0, 120),
            tags: entry.tags,
          })),
        },
        {
          id: "search_stats",
          kind: "stats",
          title: "检索统计",
          pairs: [
            { label: "检索词", value: query || "(空)" },
            { label: "命中数", value: results.length },
            { label: "条目总数", value: entries.length },
          ],
        },
      ],
    },
  };
},
```

- [ ] **Step 2: Add views to memoryRecall**

Update `memoryRecall` in `plugins/rp-core/executor.mjs`:

```js
memoryRecall: async ({ node, inputs }) => {
  const entries = await context.readMemories();
  const query = String(inputs.query ?? node.config.query ?? "");
  const results = context.rankEntries(query, entries, Number(node.config.limit ?? 4));

  return {
    outputs: {
      memories: context.serializeEntries(results),
    },
    metadata: {
      pluginId: "awp.rp-core",
      matchedMemoryIds: results.map((entry) => entry.id),
      matchedMemoryTitles: results.map((entry) => entry.title),
      views: [
        {
          id: "memory_hits",
          kind: "entry-list",
          title: "命中记忆条目",
          items: results.map((entry) => ({
            id: entry.id,
            title: entry.title,
            summary: String(entry.content ?? "").slice(0, 120),
            tags: entry.tags,
          })),
        },
        {
          id: "memory_stats",
          kind: "stats",
          title: "检索统计",
          pairs: [
            { label: "检索词", value: query || "(空)" },
            { label: "命中数", value: results.length },
            { label: "记忆总数", value: entries.length },
          ],
        },
      ],
    },
  };
},
```

The old `matchedWorldbookIds` / `matchedWorldbookTitles` / `matchedMemoryIds` / `matchedMemoryTitles` flat keys remain for backward compatibility — the views are additive.

- [ ] **Step 3: Test views rendering**

```bash
npm run build
npm run serve
```

Open browser, load an RP workflow, run it. Click on worldbookSearch or memoryRecall in the run log. Verify:
- "命中世界书条目" shows as expandable entry-list
- "检索统计" shows as stats table
- Copy button works on each view

- [ ] **Step 4: Commit**

```bash
git add plugins/rp-core/executor.mjs
git commit -m "feat: add structured metadata views to rp-core executor

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: Extend NodeConfigField type in workflow-core

**Files:**
- Modify: `packages/workflow-core/src/types.ts` (extend NodeConfigField, add NodeConfigPreset)

**Goal:** Add new field kinds, options upgrade, validation/visibility fields, presets.

- [ ] **Step 1: Update types.ts**

Replace the existing `NodeConfigField` type (lines 34-41) and add new types:

```ts
export type NodeConfigOption = {
  label: LocalizedText;
  value: string;
};

export type NodeConfigPreset = {
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  config: Record<string, unknown>;
};

export type NodeConfigField = {
  key: string;
  label: LocalizedText;
  kind:
    | "text"
    | "textarea"
    | "number"
    | "select"
    | "tags"
    | "boolean"
    | "multiselect"
    | "json"
    | "secret"
    | "model";
  min?: number;
  max?: number;
  options?: string[] | NodeConfigOption[];
  required?: boolean;
  placeholder?: LocalizedText;
  help?: LocalizedText;
  group?: string;
  groupLabel?: LocalizedText;
  advanced?: boolean;
  dependsOn?: {
    field: string;
    operator?: "equals" | "notEquals" | "includes" | "exists";
    value?: unknown;
  };
  source?: "static" | "models";
};
```

Add `presets` to `NodeDefinition` (line 43-57), add after `quickAdd?`:

```ts
presets?: NodeConfigPreset[];
```

- [ ] **Step 2: Re-export new types from workflow-core index**

In `packages/workflow-core/src/index.ts`, types are already exported via `export * from "./types"`. No change needed.

- [ ] **Step 3: Run typecheck to find breakages**

```bash
npm run typecheck
```

Expected: may have errors in files that construct `NodeConfigField` literals with the old `kind` union (only `"text" | "textarea" | "number" | "select" | "tags"`). These should still typecheck since we only extended the union.

- [ ] **Step 4: Commit**

```bash
git add packages/workflow-core/src/types.ts
git commit -m "feat: extend NodeConfigField with boolean/json/secret/model/multiselect and presets

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 11: Add node config validation functions

**Files:**
- Create: `apps/web/src/nodeConfigValidation.ts`
- Create: `apps/web/src/nodeConfigValidation.test.ts`

**Goal:** Extract validation logic into pure functions, reused by both App.tsx rendering and future server-side validation.

- [ ] **Step 1: Create nodeConfigValidation.ts**

```ts
import type { NodeConfigField, NodeDefinition } from "@awp/workflow-core";

export const isFieldVisible = (
  field: NodeConfigField,
  config: Record<string, unknown>,
): boolean => {
  if (!field.dependsOn) return true;

  const { field: depField, operator = "equals", value: depValue } = field.dependsOn;
  const current = config[depField];

  switch (operator) {
    case "equals":
      return current === depValue;
    case "notEquals":
      return current !== depValue;
    case "includes":
      return Array.isArray(current) && current.includes(depValue);
    case "exists":
      return current !== undefined && current !== null;
    default:
      return true;
  }
};

export const validateNodeConfigField = (
  field: NodeConfigField,
  value: unknown,
  _config: Record<string, unknown>,
): string[] => {
  const issues: string[] = [];

  if (field.required && (value === undefined || value === null || value === "")) {
    issues.push(`${field.label.zh || field.key} 为必填项`);
  }

  if (field.kind === "number" && typeof value === "number") {
    if (field.min !== undefined && value < field.min) {
      issues.push(`最小值为 ${field.min}`);
    }
    if (field.max !== undefined && value > field.max) {
      issues.push(`最大值为 ${field.max}`);
    }
  }

  if (field.kind === "json" && typeof value === "string" && value.trim() !== "") {
    try {
      JSON.parse(value);
    } catch {
      issues.push("JSON 格式无效");
    }
  }

  if ((field.kind === "select" || field.kind === "model") && field.options && typeof value === "string") {
    const optionValues = Array.isArray(field.options)
      ? field.options.map((o) => (typeof o === "string" ? o : o.value))
      : [];
    if (value !== "" && !optionValues.includes(value)) {
      issues.push(`"${String(value)}" 不在可选项中`);
    }
  }

  return issues;
};

export const validateNodeConfig = (
  definition: NodeDefinition | undefined,
  config: Record<string, unknown>,
): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  if (!definition?.configFields) return result;

  for (const field of definition.configFields) {
    if (!isFieldVisible(field, config)) continue;
    const issues = validateNodeConfigField(field, config[field.key], config);
    if (issues.length > 0) {
      result[field.key] = issues;
    }
  }

  return result;
};
```

- [ ] **Step 2: Create tests**

Create `apps/web/src/nodeConfigValidation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isFieldVisible, validateNodeConfigField, validateNodeConfig } from "./nodeConfigValidation";
import type { NodeConfigField } from "@awp/workflow-core";

describe("isFieldVisible", () => {
  it("returns true for fields without dependsOn", () => {
    const field: NodeConfigField = { key: "name", label: { zh: "名称", en: "Name" }, kind: "text" };
    expect(isFieldVisible(field, {})).toBe(true);
  });

  it("hides field when dependsOn equals check fails", () => {
    const field: NodeConfigField = {
      key: "advanced",
      label: { zh: "高级", en: "Advanced" },
      kind: "text",
      dependsOn: { field: "mode", operator: "equals", value: "advanced" },
    };
    expect(isFieldVisible(field, { mode: "basic" })).toBe(false);
    expect(isFieldVisible(field, { mode: "advanced" })).toBe(true);
  });

  it("supports includes operator", () => {
    const field: NodeConfigField = {
      key: "extra",
      label: { zh: "扩展", en: "Extra" },
      kind: "text",
      dependsOn: { field: "features", operator: "includes", value: "experimental" },
    };
    expect(isFieldVisible(field, { features: ["basic", "experimental"] })).toBe(true);
    expect(isFieldVisible(field, { features: ["basic"] })).toBe(false);
  });

  it("supports exists operator", () => {
    const field: NodeConfigField = {
      key: "notes",
      label: { zh: "备注", en: "Notes" },
      kind: "textarea",
      dependsOn: { field: "hasNotes", operator: "exists" },
    };
    expect(isFieldVisible(field, { hasNotes: "yes" })).toBe(true);
    expect(isFieldVisible(field, { hasNotes: null })).toBe(false);
    expect(isFieldVisible(field, {})).toBe(false);
  });
});

describe("validateNodeConfigField", () => {
  it("flags missing required fields", () => {
    const field: NodeConfigField = { key: "name", label: { zh: "名称", en: "Name" }, kind: "text", required: true };
    expect(validateNodeConfigField(field, "", {})).toContain("名称 为必填项");
  });

  it("flags number out of range", () => {
    const field: NodeConfigField = { key: "count", label: { zh: "数量", en: "Count" }, kind: "number", min: 1, max: 10 };
    expect(validateNodeConfigField(field, 0, {})).toContain("最小值为 1");
    expect(validateNodeConfigField(field, 11, {})).toContain("最大值为 10");
  });

  it("flags invalid JSON", () => {
    const field: NodeConfigField = { key: "data", label: { zh: "数据", en: "Data" }, kind: "json" };
    expect(validateNodeConfigField(field, "{invalid", {})).toContain("JSON 格式无效");
  });

  it("accepts valid JSON string", () => {
    const field: NodeConfigField = { key: "data", label: { zh: "数据", en: "Data" }, kind: "json" };
    expect(validateNodeConfigField(field, '{"a":1}', {})).toEqual([]);
  });
});

describe("validateNodeConfig", () => {
  it("returns empty for valid config", () => {
    const definition = {
      type: "test",
      label: "Test",
      ports: [],
      configFields: [
        { key: "name", label: { zh: "名称", en: "Name" }, kind: "text" as const, required: true },
      ],
    };
    expect(validateNodeConfig(definition, { name: "hello" })).toEqual({});
  });

  it("returns issues per field", () => {
    const definition = {
      type: "test",
      label: "Test",
      ports: [],
      configFields: [
        { key: "name", label: { zh: "名称", en: "Name" }, kind: "text" as const, required: true },
        { key: "count", label: { zh: "数量", en: "Count" }, kind: "number" as const, min: 1, max: 10 },
      ],
    };
    const issues = validateNodeConfig(definition, { name: "", count: 0 });
    expect(Object.keys(issues)).toHaveLength(2);
    expect(issues.name).toBeDefined();
    expect(issues.count).toBeDefined();
  });

  it("skips invisible fields", () => {
    const definition = {
      type: "test",
      label: "Test",
      ports: [],
      configFields: [
        { key: "name", label: { zh: "名称", en: "Name" }, kind: "text" as const, required: true },
        {
          key: "extra",
          label: { zh: "扩展", en: "Extra" },
          kind: "text" as const,
          required: true,
          dependsOn: { field: "mode", operator: "equals" as const, value: "advanced" },
        },
      ],
    };
    const issues = validateNodeConfig(definition, { name: "", mode: "basic" });
    expect(Object.keys(issues)).toHaveLength(1); // only name, extra is not visible
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run apps/web/src/nodeConfigValidation.test.ts
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/nodeConfigValidation.ts apps/web/src/nodeConfigValidation.test.ts
git commit -m "feat: add node config validation pure functions with tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 12: Add new field kind renderers to App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx` (renderConfigField upgrade)

**Goal:** Add boolean, multiselect, json, secret, model renderers plus presets, advanced folding, and field-level validation.

- [ ] **Step 1: Add imports**

Add at top of App.tsx:

```ts
import { isFieldVisible, validateNodeConfig, validateNodeConfigField } from "./nodeConfigValidation";
```

- [ ] **Step 2: Rewrite renderConfigField**

Replace the existing `renderConfigField` function (lines 653-715) with:

```tsx
const renderConfigField = (field: NodeConfigField, node: WorkflowNode) => {
  const label = field.label[language];
  const value = node.config[field.key];
  const update = (nextValue: unknown) => updateSelectedConfig(field.key, nextValue);
  const issues = validateNodeConfigField(field, value, node.config);
  const help = field.help?.[language];

  const wrapper = (inner: JSX.Element) => (
    <label key={field.key} className={issues.length > 0 ? "field-error" : ""}>
      <span className="field-label">
        {label}
        {field.required ? <span className="required-mark">*</span> : null}
      </span>
      {help ? <span className="field-help">{help}</span> : null}
      {inner}
      {issues.map((issue, i) => (
        <span key={i} className="field-issue">{issue}</span>
      ))}
    </label>
  );

  if (field.kind === "boolean") {
    return wrapper(
      <div className="boolean-field">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => update(event.target.checked)}
        />
        <span className="boolean-label">{label}</span>
      </div>,
    );
  }

  if (field.kind === "multiselect") {
    const options: { label: string; value: string }[] = Array.isArray(field.options)
      ? field.options.map((o) => (typeof o === "string" ? { label: o, value: o } : { label: o.label[language], value: o.value }))
      : [];
    const selected: string[] = Array.isArray(value) ? value.map(String) : [];

    return wrapper(
      <div className="multiselect-field">
        {options.map((opt) => (
          <label key={opt.value} className="multiselect-option">
            <input
              type="checkbox"
              checked={selected.includes(opt.value)}
              onChange={(e) => {
                update(
                  e.target.checked
                    ? [...selected, opt.value]
                    : selected.filter((v) => v !== opt.value),
                );
              }}
            />
            {opt.label}
          </label>
        ))}
      </div>,
    );
  }

  if (field.kind === "json") {
    const textValue =
      value !== undefined && value !== null
        ? JSON.stringify(value, null, 2)
        : "";
    return wrapper(
      <div className="json-field">
        <textarea
          value={textValue}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              update(parsed);
            } catch {
              // Keep the text in the field but update raw string so validation can flag it
              update(e.target.value);
            }
          }}
        />
        <button
          className="tiny-button"
          type="button"
          onClick={() => {
            try {
              const parsed = JSON.parse(
                typeof value === "string" ? value : JSON.stringify(value ?? {}),
              );
              update(JSON.stringify(parsed, null, 2));
            } catch {
              // Already invalid, skip format
            }
          }}
        >
          {language === "zh" ? "格式化" : "Format"}
        </button>
      </div>,
    );
  }

  if (field.kind === "secret") {
    return wrapper(
      <input
        type="password"
        autoComplete="off"
        value={String(value ?? "")}
        onChange={(event) => update(event.target.value)}
      />,
    );
  }

  if (field.kind === "model") {
    const options: { label: string; value: string }[] = Array.isArray(field.options)
      ? field.options.map((o) => (typeof o === "string" ? { label: o, value: o } : { label: o.label[language], value: o.value }))
      : [
          { label: "DeepSeek V4 Flash", value: "deepseek-v4-flash" },
          { label: "DeepSeek V4 Pro", value: "deepseek-v4-pro" },
          { label: "DeepSeek Reasoner", value: "deepseek-reasoner" },
        ];

    return wrapper(
      <select value={String(value ?? "")} onChange={(event) => update(event.target.value)}>
        {(options).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>,
    );
  }

  if (field.kind === "textarea") {
    return wrapper(
      <textarea value={String(value ?? "")} onChange={(event) => update(event.target.value)} />,
    );
  }

  if (field.kind === "number") {
    return wrapper(
      <input
        type="number"
        min={field.min}
        max={field.max}
        value={String(value ?? "")}
        onChange={(event) => update(Number(event.target.value))}
      />,
    );
  }

  if (field.kind === "select") {
    const options: { label: string; value: string }[] = Array.isArray(field.options)
      ? field.options.map((o) => (typeof o === "string" ? { label: o, value: o } : { label: o.label[language], value: o.value }))
      : [];
    return wrapper(
      <select value={String(value ?? "")} onChange={(event) => update(event.target.value)}>
        {(options).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>,
    );
  }

  if (field.kind === "tags") {
    return wrapper(
      <input
        value={Array.isArray(value) ? value.map(String).join(", ") : String(value ?? "")}
        onChange={(event) => update(toTags(event.target.value))}
      />,
    );
  }

  return wrapper(
    <input value={String(value ?? "")} onChange={(event) => update(event.target.value)} />,
  );
};
```

- [ ] **Step 3: Add presets and advanced folding to inspector**

Replace the config fields rendering section in the inspector (around lines 1402-1404):

```tsx
{getRuntimeNodeConfigFields(selectedNode.type).map((field) =>
  renderConfigField(field, selectedNode),
)}
```

Replace with:

```tsx
{(() => {
  const definition = getRuntimeNodeDefinition(selectedNode.type);
  const presets = definition?.presets;
  const allFields = getRuntimeNodeConfigFields(selectedNode.type);
  const visibleFields = allFields.filter((f) => isFieldVisible(f, selectedNode.config));
  const basicFields = visibleFields.filter((f) => !f.advanced);
  const advancedFields = visibleFields.filter((f) => f.advanced);

  // Group advanced fields by group
  const advancedGroups = new Map<string, NodeConfigField[]>();
  for (const f of advancedFields) {
    const g = f.group ?? "";
    advancedGroups.set(g, [...(advancedGroups.get(g) ?? []), f]);
  }

  return (
    <>
      {presets?.length ? (
        <div className="preset-bar">
          {presets.map((preset) => (
            <button
              key={preset.id}
              className="preset-button"
              type="button"
              title={preset.description?.[language]}
              onClick={() => {
                for (const [k, v] of Object.entries(preset.config)) {
                  updateSelectedConfig(k, v);
                }
              }}
            >
              {preset.label[language]}
            </button>
          ))}
        </div>
      ) : null}
      {basicFields.map((field) => renderConfigField(field, selectedNode))}
      {advancedFields.length > 0 ? (
        <details className="advanced-params">
          <summary>
            {language === "zh" ? "高级参数" : "Advanced"} ({advancedFields.length})
          </summary>
          {Array.from(advancedGroups.entries()).map(([group, fields]) => (
            <div key={group} className="advanced-group">
              {group ? (
                <h4 className="advanced-group-title">
                  {fields[0]?.groupLabel?.[language] ?? group}
                </h4>
              ) : null}
              {fields.map((field) => renderConfigField(field, selectedNode))}
            </div>
          ))}
        </details>
      ) : null}
    </>
  );
})()}
```

- [ ] **Step 4: Add CSS for new field types**

```css
.field-error .field-label { color: #dc2626; }
.required-mark { color: #dc2626; margin-left: 2px; }
.field-help { font-size: 0.75rem; color: var(--text-muted); display: block; }
.field-issue { font-size: 0.75rem; color: #dc2626; display: block; margin-top: 2px; }

.boolean-field { display: flex; align-items: center; gap: 6px; }
.boolean-label { font-size: 0.88rem; }

.multiselect-field { display: flex; flex-wrap: wrap; gap: 6px; }
.multiselect-option { display: flex; align-items: center; gap: 4px; font-size: 0.85rem; }

.json-field { display: flex; gap: 6px; align-items: flex-start; }
.json-field textarea { flex: 1; min-height: 60px; }

.secret-field { display: flex; gap: 6px; }
.secret-field input { flex: 1; }

.preset-bar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.preset-button { font-size: 0.78rem; padding: 3px 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--panel-bg); cursor: pointer; }
.preset-button:hover { background: var(--code-bg); }

.advanced-params { margin-top: 10px; border-top: 1px solid var(--border-color); padding-top: 8px; }
.advanced-params > summary { font-weight: 600; cursor: pointer; font-size: 0.9rem; }
.advanced-group { margin-top: 6px; }
.advanced-group-title { font-size: 0.82rem; color: var(--text-muted); margin: 4px 0; }
```

- [ ] **Step 5: Build and typecheck**

```bash
npm run typecheck
npm run build
```

Fix any type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "feat: add boolean/json/secret/model/multiselect field renderers with presets and advanced folding

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 13: Add remote-http executor support

**Files:**
- Modify: `packages/plugin-sdk/src/index.ts` (add timeoutMs to executor type)
- Modify: `apps/web/scripts/serve.mjs` (add remote-http branch in createPluginExecutors)

**Goal:** Support `"adapter": "remote-http"` in plugin executors.

- [ ] **Step 1: Add timeoutMs to executor type**

In `packages/plugin-sdk/src/index.ts`, update the executor type in `NodePluginManifest` (line 63-66):

```ts
executor?: {
  adapter: "local-module" | "remote-http";
  entry: string;
  timeoutMs?: number;
};
```

- [ ] **Step 2: Add remote-http branch in serve.mjs**

In `createPluginExecutors` function (around line 211-213), change the unsupported adapter handling to implement remote-http:

Replace:

```js
if (executor.adapter !== "local-module") {
  console.warn(`Skipped executor for ${plugin.manifest.id}: unsupported ${executor.adapter}`);
  continue;
}
```

With:

```js
if (executor.adapter === "remote-http") {
  const endpoint = executor.entry;
  const timeoutMs = executor.timeoutMs ?? 30000;

  // Validate URL protocol
  try {
    const parsed = new URL(endpoint);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      console.warn(`Skipped executor for ${plugin.manifest.id}: unsupported protocol ${parsed.protocol}`);
      continue;
    }
  } catch {
    console.warn(`Skipped executor for ${plugin.manifest.id}: invalid URL ${endpoint}`);
    continue;
  }

  // Check network permission
  const hasNetwork = (plugin.manifest.permissions ?? []).includes("network");
  if (!hasNetwork) {
    console.warn(
      `Skipped executor for ${plugin.manifest.id}: remote-http requires "network" permission`,
    );
    continue;
  }

  const remoteApiUrl = endpoint;

  for (const nodeDef of plugin.manifest.nodes) {
    executors[nodeDef.type] = async ({ node, inputs }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(remoteApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pluginId: plugin.manifest.id,
            nodeType: node.type,
            workflowId: context._workflowId,
            node: { id: node.id, type: node.type, config: node.config },
            inputs,
          }),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data || typeof data !== "object") {
          throw new Error("Invalid response: expected JSON object");
        }

        if (data.error) {
          throw new Error(String(data.error));
        }

        if (!data.outputs || typeof data.outputs !== "object") {
          throw new Error("Invalid response: missing outputs object");
        }

        return {
          outputs: data.outputs,
          metadata: data.metadata ?? {},
        };
      } catch (error) {
        clearTimeout(timer);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Remote executor ${plugin.manifest.id}/${nodeDef.type} failed at ${remoteApiUrl}: ${message}`,
        );
      }
    };
  }

  continue;
}

if (executor.adapter !== "local-module") {
  console.warn(`Skipped executor for ${plugin.manifest.id}: unsupported ${executor.adapter}`);
  continue;
}
```

- [ ] **Step 3: Pass _workflowId to context**

In `serve.mjs`, when creating the context for `createPluginExecutors`, add `_workflowId`:

```js
const pluginExecutors = await createPluginExecutors(plugins, {
  _workflowId: workflow.id,
  readMemories: () => readEntries(memoryFile),
  // ... rest unchanged
});
```

Wait — `createPluginExecutors` is called before `workflow` is available (it's called inside `createExecutors` which receives `workflow`). Let me fix this: in `createExecutors`, find the line:

```js
const pluginExecutors = await createPluginExecutors(plugins, {
```

And ensure `_workflowId: workflow.id` is added to the context object.

- [ ] **Step 4: Run tests**

```bash
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-sdk/src/index.ts apps/web/scripts/serve.mjs
git commit -m "feat: add remote-http executor adapter with URL validation and timeout

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 14: Final verification

**Files:** None (verification only)

**Goal:** Run full test suite and build, then manual browser verification.

- [ ] **Step 1: Run full test suite**

```bash
npm run test
```

Expected: all tests pass

- [ ] **Step 2: Run verify (format + typecheck + lint)**

```bash
npm run verify
```

Expected: no errors

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: builds successfully

- [ ] **Step 4: Manual browser verification**

```bash
npm run serve
```

Open `http://127.0.0.1:5180` and verify:

1. **Plugin management**: Click "插件", see rp-core plugin, toggle enable/disable
2. **Node catalog refresh**: Disable rp-core, RP nodes disappear from node library. Re-enable, they return
3. **Template loading**: Load RP template, run workflow
4. **Metadata views**: Click worldbookSearch in run log, see structured entry-list and stats views with copy buttons
5. **Duration display**: Run log rows show duration, inspector shows timing
6. **Field types**: Select a node with config fields — boolean, multiselect, json, secret, model renderers work
7. **Validation**: Empty required fields show red error text
8. **Advanced folding**: Fields marked `advanced: true` are in collapsible section
9. **Presets**: Nodes with presets show preset buttons

- [ ] **Step 5: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: final verification fixes and polish

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
