# Server Rewrite (Hono + TypeScript) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic `apps/web/scripts/serve.mjs` with a typed, testable Hono server in `apps/server/`.

**Architecture:** New `apps/server` workspace package using Hono + `@hono/node-server`. Routes split by domain (memories, worldbook, plugins, workflow, llm, templates). Shared services for JSON storage, plugin loading, and workflow execution. Vite proxy bridges dev mode; `serveStatic` bridges production.

**Tech Stack:** Hono, @hono/node-server, @hono/node-server/serve-static, TypeScript, vitest

**Reference:** Design spec at `docs/superpowers/specs/2026-06-11-server-rewrite-hono-design.md`

---

## Phase 1: Scaffold + Infrastructure

### Task 1: Create `apps/server` package scaffold

**Files:**

- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Modify: `tsconfig.json` (add reference)
- Modify: `package.json` (add workspace scripts)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@awp/server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -b",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@awp/agent-runtime": "*",
    "@awp/memory-core": "*",
    "@awp/plugin-sdk": "*",
    "@awp/workflow-core": "*",
    "hono": "^4.7.0",
    "@hono/node-server": "^1.14.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.3",
    "vitest": "^3.2.2"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"],
  "references": [
    { "path": "../../packages/workflow-core" },
    { "path": "../../packages/agent-runtime" },
    { "path": "../../packages/memory-core" },
    { "path": "../../packages/plugin-sdk" }
  ]
}
```

- [ ] **Step 3: Add reference to root tsconfig.json**

In `tsconfig.json`, add to the `references` array:

```json
{ "path": "./apps/server" }
```

- [ ] **Step 4: Install dependencies**

Run: `cd apps/server && npm install`

- [ ] **Step 5: Commit**

```bash
git add apps/server/ tsconfig.json package-lock.json
git commit -m "feat(server): scaffold @awp/server package"
```

---

### Task 2: Environment configuration

**Files:**

- Create: `apps/server/src/env.ts`
- Test: `apps/server/src/env.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/env.test.ts
import { describe, expect, it } from "vitest";
import { resolveEnv } from "./env";

describe("resolveEnv", () => {
  it("uses default DATA_DIR relative to module", () => {
    const env = resolveEnv();
    expect(env.dataDir).toContain("data");
  });

  it("overrides DATA_DIR from environment variable", () => {
    const original = process.env.DATA_DIR;
    process.env.DATA_DIR = "/custom/data";
    const env = resolveEnv();
    expect(env.dataDir).toBe("/custom/data");
    if (original !== undefined) {
      process.env.DATA_DIR = original;
    } else {
      delete process.env.DATA_DIR;
    }
  });

  it("uses default port 5180", () => {
    const env = resolveEnv();
    expect(env.port).toBe(5180);
  });

  it("reads DEEPSEEK_API_KEY", () => {
    const original = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "test-key";
    const env = resolveEnv();
    expect(env.deepseekApiKey).toBe("test-key");
    if (original !== undefined) {
      process.env.DEEPSEEK_API_KEY = original;
    } else {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/env.test.ts`
Expected: FAIL — `resolveEnv` not found

- [ ] **Step 3: Write implementation**

```typescript
// apps/server/src/env.ts
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");

export type Env = {
  port: number;
  dataDir: string;
  pluginsDir: string;
  deepseekApiKey: string | undefined;
  deepseekModel: string;
  nodeEnv: string;
};

export const resolveEnv = (): Env => ({
  port: Number(process.env.PORT ?? 5180),
  dataDir: process.env.DATA_DIR ?? resolve(__dirname, "..", "..", "..", "data"),
  pluginsDir: process.env.PLUGINS_DIR ?? resolve(__dirname, "..", "..", "..", "plugins"),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  nodeEnv: process.env.NODE_ENV ?? "development",
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/env.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/env.ts apps/server/src/env.test.ts
git commit -m "feat(server): add env configuration with defaults"
```

---

### Task 3: JSON store service

**Files:**

- Create: `apps/server/src/services/jsonStore.ts`
- Test: `apps/server/src/services/jsonStore.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/services/jsonStore.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readEntries, writeEntries, createEntry, updateEntry } from "./jsonStore";

const tmpDir = join(import.meta.dirname, "__tmp_jsonstore__");

beforeEach(async () => {
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("jsonStore", () => {
  describe("readEntries", () => {
    it("returns empty array when file does not exist", async () => {
      const result = await readEntries(join(tmpDir, "nope.json"));
      expect(result).toEqual([]);
    });

    it("reads existing entries", async () => {
      const filePath = join(tmpDir, "test.json");
      await writeFile(filePath, JSON.stringify([{ id: "1" }]));
      const result = await readEntries(filePath);
      expect(result).toEqual([{ id: "1" }]);
    });
  });

  describe("writeEntries", () => {
    it("writes entries to file creating directory if needed", async () => {
      const filePath = join(tmpDir, "sub", "test.json");
      await writeEntries(filePath, [{ id: "1" }]);
      const content = await readFile(filePath, "utf8");
      expect(JSON.parse(content)).toEqual([{ id: "1" }]);
    });
  });

  describe("createEntry", () => {
    it("creates entry with id, timestamp, and body fields", () => {
      const entry = createEntry(
        { title: "Test", content: "Hello", tags: ["a"] },
        "mem",
        "Untitled",
      );
      expect(entry.id).toMatch(/^mem_\d+$/);
      expect(entry.title).toBe("Test");
      expect(entry.content).toBe("Hello");
      expect(entry.tags).toEqual(["a"]);
      expect(entry.updatedAt).toBeTruthy();
    });

    it("uses fallback title when missing", () => {
      const entry = createEntry({ content: "Hello" }, "mem", "Fallback");
      expect(entry.title).toBe("Fallback");
    });
  });

  describe("updateEntry", () => {
    it("merges body into existing entry and updates timestamp", () => {
      const original = {
        id: "1",
        title: "Old",
        content: "Old content",
        tags: ["old"],
        updatedAt: "2020-01-01",
      };
      const updated = updateEntry(original, { title: "New" });
      expect(updated.id).toBe("1");
      expect(updated.title).toBe("New");
      expect(updated.content).toBe("Old content");
      expect(updated.updatedAt).not.toBe("2020-01-01");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/services/jsonStore.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// apps/server/src/services/jsonStore.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type Entry = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  updatedAt: string;
};

export type EntryDraft = {
  title?: string;
  content?: string;
  tags?: string[];
};

export const readEntries = async (filePath: string): Promise<Entry[]> => {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
};

export const writeEntries = async (filePath: string, entries: Entry[]): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
};

export const createEntry = (body: EntryDraft, prefix: string, fallbackTitle: string): Entry => ({
  id: `${prefix}_${Date.now()}`,
  title: String(body.title ?? fallbackTitle),
  content: String(body.content ?? ""),
  tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
  updatedAt: new Date().toISOString(),
});

export const updateEntry = (entry: Entry, body: EntryDraft): Entry => ({
  ...entry,
  title: String(body.title ?? entry.title),
  content: String(body.content ?? entry.content),
  tags: Array.isArray(body.tags) ? body.tags.map(String) : entry.tags,
  updatedAt: new Date().toISOString(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/services/jsonStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/jsonStore.ts apps/server/src/services/jsonStore.test.ts
git commit -m "feat(server): add jsonStore service for file-based persistence"
```

---

### Task 4: Hono app entry point

**Files:**

- Create: `apps/server/src/index.ts`

- [ ] **Step 1: Write minimal entry point**

```typescript
// apps/server/src/index.ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { resolveEnv } from "./env.js";

const app = new Hono();

app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

const env = resolveEnv();

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`@awp/server running at http://127.0.0.1:${info.port}`);
  console.log(
    env.deepseekApiKey ? "DeepSeek Agent: enabled" : "DeepSeek Agent: missing DEEPSEEK_API_KEY",
  );
});

export { app };
```

- [ ] **Step 2: Verify it starts**

Run: `cd apps/server && npx tsx src/index.ts &` then `curl http://127.0.0.1:5180/api/health`
Expected: `{"status":"ok","timestamp":"..."}`

Kill the background process after verifying.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/index.ts
git commit -m "feat(server): add Hono app entry point with health check"
```

---

## Phase 2: Data Routes (Memories + Worldbook)

### Task 5: Memories routes

**Files:**

- Create: `apps/server/src/routes/memories.ts`
- Modify: `apps/server/src/index.ts` (register route)
- Test: `apps/server/src/routes/memories.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/routes/memories.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { createMemoriesRoutes } from "./memories";

const tmpDir = join(import.meta.dirname, "__tmp_memories__");
const memoryFile = join(tmpDir, "memories.json");

beforeEach(async () => {
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const createApp = () => {
  const app = new Hono();
  app.route("/", createMemoriesRoutes(memoryFile));
  return app;
};

describe("memories routes", () => {
  it("GET /api/memories returns empty list", async () => {
    const app = createApp();
    const res = await app.request("/api/memories");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ memories: [] });
  });

  it("POST /api/memories creates a memory", async () => {
    const app = createApp();
    const res = await app.request("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", content: "Hello", tags: ["a"] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.memories).toHaveLength(1);
    expect(body.memories[0].title).toBe("Test");
    expect(body.entry.title).toBe("Test");
  });

  it("PUT /api/memories/:id updates a memory", async () => {
    const app = createApp();
    await app.request("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Old" }),
    });
    const list = await (await app.request("/api/memories")).json();
    const id = list.memories[0].id;

    const res = await app.request(`/api/memories/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memories.find((m: { id: string }) => m.id === id).title).toBe("New");
  });

  it("DELETE /api/memories/:id deletes a memory", async () => {
    const app = createApp();
    await app.request("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "ToDelete" }),
    });
    const list = await (await app.request("/api/memories")).json();
    const id = list.memories[0].id;

    const res = await app.request(`/api/memories/${id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memories).toHaveLength(0);
  });

  it("PUT /api/memories/:id returns 404 for missing id", async () => {
    const app = createApp();
    const res = await app.request("/api/memories/nonexistent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "X" }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/routes/memories.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// apps/server/src/routes/memories.ts
import { Hono } from "hono";
import { readEntries, writeEntries, createEntry, updateEntry } from "../services/jsonStore.js";

export const createMemoriesRoutes = (memoryFile: string) => {
  const app = new Hono();

  app.get("/api/memories", async (c) => {
    const memories = await readEntries(memoryFile);
    return c.json({ memories });
  });

  app.post("/api/memories", async (c) => {
    const body = await c.req.json();
    const memories = await readEntries(memoryFile);
    const entry = createEntry(body, "mem", "未命名记忆");
    const nextMemories = [entry, ...memories].slice(0, 300);
    await writeEntries(memoryFile, nextMemories);
    return c.json({ memories: nextMemories, entry }, 201);
  });

  app.put("/api/memories/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const memories = await readEntries(memoryFile);
    let found = false;
    const nextMemories = memories.map((entry) => {
      if (entry.id !== id) return entry;
      found = true;
      return updateEntry(entry, body);
    });
    if (!found) {
      return c.json({ error: "Memory not found" }, 404);
    }
    await writeEntries(memoryFile, nextMemories);
    return c.json({ memories: nextMemories });
  });

  app.delete("/api/memories/:id", async (c) => {
    const id = c.req.param("id");
    const memories = await readEntries(memoryFile);
    const nextMemories = memories.filter((entry) => entry.id !== id);
    await writeEntries(memoryFile, nextMemories);
    return c.json({ memories: nextMemories });
  });

  return app;
};
```

- [ ] **Step 4: Register route in index.ts**

In `apps/server/src/index.ts`, add import and register:

```typescript
import { createMemoriesRoutes } from "./routes/memories.js";
// ... after creating app:
app.route("/", createMemoriesRoutes(env.dataDir + "/memories.json"));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/routes/memories.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/memories.ts apps/server/src/routes/memories.test.ts apps/server/src/index.ts
git commit -m "feat(server): add memories CRUD routes"
```

---

### Task 6: Worldbook routes

**Files:**

- Create: `apps/server/src/routes/worldbook.ts`
- Modify: `apps/server/src/index.ts` (register route)
- Test: `apps/server/src/routes/worldbook.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/routes/worldbook.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { createWorldbookRoutes } from "./worldbook";

const tmpDir = join(import.meta.dirname, "__tmp_worldbook__");
const worldbookFile = join(tmpDir, "worldbook.json");

beforeEach(async () => {
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const createApp = () => {
  const app = new Hono();
  app.route("/", createWorldbookRoutes(worldbookFile));
  return app;
};

describe("worldbook routes", () => {
  it("GET /api/worldbook returns empty entries", async () => {
    const app = createApp();
    const res = await app.request("/api/worldbook");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ entries: [] });
  });

  it("POST /api/worldbook creates an entry", async () => {
    const app = createApp();
    const res = await app.request("/api/worldbook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Lore",
        content: "Details",
        tags: ["setting"],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entry.title).toBe("Lore");
  });

  it("PUT /api/worldbook/:id updates an entry", async () => {
    const app = createApp();
    await app.request("/api/worldbook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Old" }),
    });
    const list = await (await app.request("/api/worldbook")).json();
    const id = list.entries[0].id;

    const res = await app.request(`/api/worldbook/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.find((e: { id: string }) => e.id === id).title).toBe("Updated");
  });

  it("DELETE /api/worldbook/:id deletes an entry", async () => {
    const app = createApp();
    await app.request("/api/worldbook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Gone" }),
    });
    const list = await (await app.request("/api/worldbook")).json();
    const id = list.entries[0].id;

    const res = await app.request(`/api/worldbook/${id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/routes/worldbook.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// apps/server/src/routes/worldbook.ts
import { Hono } from "hono";
import { readEntries, writeEntries, createEntry, updateEntry } from "../services/jsonStore.js";

export const createWorldbookRoutes = (worldbookFile: string) => {
  const app = new Hono();

  app.get("/api/worldbook", async (c) => {
    const entries = await readEntries(worldbookFile);
    return c.json({ entries });
  });

  app.post("/api/worldbook", async (c) => {
    const body = await c.req.json();
    const entries = await readEntries(worldbookFile);
    const entry = createEntry(body, "world", "未命名设定");
    const nextEntries = [entry, ...entries].slice(0, 300);
    await writeEntries(worldbookFile, nextEntries);
    return c.json({ entries: nextEntries, entry }, 201);
  });

  app.put("/api/worldbook/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const entries = await readEntries(worldbookFile);
    let found = false;
    const nextEntries = entries.map((entry) => {
      if (entry.id !== id) return entry;
      found = true;
      return updateEntry(entry, body);
    });
    if (!found) {
      return c.json({ error: "Entry not found" }, 404);
    }
    await writeEntries(worldbookFile, nextEntries);
    return c.json({ entries: nextEntries });
  });

  app.delete("/api/worldbook/:id", async (c) => {
    const id = c.req.param("id");
    const entries = await readEntries(worldbookFile);
    const nextEntries = entries.filter((entry) => entry.id !== id);
    await writeEntries(worldbookFile, nextEntries);
    return c.json({ entries: nextEntries });
  });

  return app;
};
```

- [ ] **Step 4: Register route in index.ts**

```typescript
import { createWorldbookRoutes } from "./routes/worldbook.js";
// ... after memories routes:
app.route("/", createWorldbookRoutes(env.dataDir + "/worldbook.json"));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/routes/worldbook.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/worldbook.ts apps/server/src/routes/worldbook.test.ts apps/server/src/index.ts
git commit -m "feat(server): add worldbook CRUD routes"
```

---

## Phase 3: Plugin + Template Routes

### Task 7: Plugin loader service

**Files:**

- Create: `apps/server/src/services/pluginLoader.ts`
- Test: `apps/server/src/services/pluginLoader.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/services/pluginLoader.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadNodePlugins, loadSkillPlugins } from "./pluginLoader";

const tmpDir = join(import.meta.dirname, "__tmp_plugins__");

beforeEach(async () => {
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const validNodeManifest = {
  id: "test.plugin",
  label: "Test Plugin",
  version: "0.1.0",
  description: "A test plugin",
  permissions: ["worldbook:read"],
  nodes: [
    {
      type: "testNode",
      label: "Test Node",
      ports: [{ id: "in", label: "In", direction: "input", dataType: "text" }],
    },
  ],
};

const validSkillManifest = {
  id: "test.skills",
  label: "Test Skills",
  version: "0.1.0",
  description: "Test skill plugin",
  skills: [
    {
      id: "test_skill",
      label: { zh: "测试技能", en: "Test Skill" },
      content: { zh: "测试内容", en: "Test content" },
      category: "test",
    },
  ],
};

describe("loadNodePlugins", () => {
  it("loads valid node plugins", async () => {
    const pluginDir = join(tmpDir, "test-plugin");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "node.plugin.json"), JSON.stringify(validNodeManifest));
    const plugins = await loadNodePlugins(tmpDir);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.id).toBe("test.plugin");
    expect(plugins[0].manifest.nodes).toHaveLength(1);
  });

  it("skips invalid manifests", async () => {
    const pluginDir = join(tmpDir, "bad-plugin");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "node.plugin.json"), "{}");
    const plugins = await loadNodePlugins(tmpDir);
    expect(plugins).toHaveLength(0);
  });

  it("skips disabled plugins", async () => {
    const pluginDir = join(tmpDir, "disabled-plugin");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "node.plugin.json"),
      JSON.stringify({ ...validNodeManifest, enabled: false }),
    );
    const plugins = await loadNodePlugins(tmpDir);
    expect(plugins).toHaveLength(0);
  });

  it("returns empty for missing directory", async () => {
    const plugins = await loadNodePlugins(join(tmpDir, "nope"));
    expect(plugins).toEqual([]);
  });
});

describe("loadSkillPlugins", () => {
  it("loads valid skill plugins", async () => {
    const pluginDir = join(tmpDir, "test-skills");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "skill.plugin.json"), JSON.stringify(validSkillManifest));
    const skills = await loadSkillPlugins(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe("test_skill");
    expect(skills[0].pluginId).toBe("test.skills");
  });

  it("returns empty for missing directory", async () => {
    const skills = await loadSkillPlugins(join(tmpDir, "nope"));
    expect(skills).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/services/pluginLoader.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// apps/server/src/services/pluginLoader.ts
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { validateNodePluginManifest, validateSkillPluginManifest } from "@awp/plugin-sdk";
import type { NodeDefinition } from "@awp/workflow-core";

export type NodePlugin = {
  manifest: NodePluginManifest;
  baseDir: string;
};

export type NodePluginManifest = {
  id: string;
  label: string;
  version: string;
  description?: string;
  author?: string;
  enabled?: boolean;
  permissions?: string[];
  dependencies?: { id: string; versionRange?: string; optional?: boolean }[];
  compatibility?: { app?: string; workflowSchema?: number } | null;
  nodes: NodeDefinition[];
  executor?: {
    adapter: string;
    entry: string;
    timeoutMs?: number;
  };
};

export type SkillItem = {
  id: string;
  label: { zh: string; en: string };
  content: { zh: string; en: string };
  category?: string;
  tags?: string[];
  pluginId: string;
};

export const loadNodePlugins = async (pluginsDir: string): Promise<NodePlugin[]> => {
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await readdir(pluginsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const plugins: NodePlugin[] = [];

  for (const entry of entries.filter((e) => e.isDirectory())) {
    const manifestPath = join(pluginsDir, entry.name, "node.plugin.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as NodePluginManifest;
      const issues = validateNodePluginManifest(manifest);
      if (issues.length > 0) {
        console.warn(`Skipped node plugin ${entry.name}: ${issues.join("; ")}`);
        continue;
      }
      if (manifest.enabled === false) continue;
      plugins.push({ manifest, baseDir: dirname(manifestPath) });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        console.warn(
          `Skipped node plugin ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return plugins;
};

export const loadSkillPlugins = async (pluginsDir: string): Promise<SkillItem[]> => {
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await readdir(pluginsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: SkillItem[] = [];

  for (const entry of entries.filter((e) => e.isDirectory())) {
    const manifestPath = join(pluginsDir, entry.name, "skill.plugin.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const issues = validateSkillPluginManifest(manifest);
      if (issues.length > 0) {
        console.warn(`Skipped skill plugin ${entry.name}: ${issues.join("; ")}`);
        continue;
      }
      if (manifest.enabled === false) continue;

      for (const skill of manifest.skills ?? []) {
        skills.push({
          id: skill.id,
          label:
            typeof skill.label === "object"
              ? skill.label
              : { zh: String(skill.label), en: String(skill.label) },
          content:
            typeof skill.content === "object"
              ? skill.content
              : { zh: String(skill.content), en: String(skill.content) },
          category: skill.category,
          tags: skill.tags,
          pluginId: manifest.id,
        });
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        console.warn(
          `Skipped skill plugin ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return skills;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/services/pluginLoader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/pluginLoader.ts apps/server/src/services/pluginLoader.test.ts
git commit -m "feat(server): add plugin loader service"
```

---

### Task 8: Plugins and Skills routes

**Files:**

- Create: `apps/server/src/routes/plugins.ts`
- Modify: `apps/server/src/index.ts` (register route)
- Test: `apps/server/src/routes/plugins.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/routes/plugins.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { createPluginsRoutes } from "./plugins";

const tmpDir = join(import.meta.dirname, "__tmp_plugins_routes__");
const pluginsDir = join(tmpDir, "plugins");
const stateFile = join(tmpDir, "plugin-state.json");

beforeEach(async () => {
  await mkdir(pluginsDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const nodeManifest = {
  id: "test.plugin",
  label: "Test Plugin",
  version: "0.1.0",
  description: "Test",
  permissions: [],
  nodes: [
    {
      type: "testNode",
      label: "Test",
      ports: [{ id: "in", label: "In", direction: "input", dataType: "text" }],
    },
  ],
};

const skillManifest = {
  id: "test.skills",
  label: "Test Skills",
  version: "0.1.0",
  description: "Test skills",
  skills: [
    {
      id: "test_skill",
      label: { zh: "测试", en: "Test" },
      content: { zh: "内容", en: "Content" },
    },
  ],
};

const createApp = () => {
  const app = new Hono();
  app.route("/", createPluginsRoutes(pluginsDir, stateFile));
  return app;
};

describe("plugins routes", () => {
  it("GET /api/plugins returns plugin list", async () => {
    await mkdir(join(pluginsDir, "test-plugin"), { recursive: true });
    await writeFile(
      join(pluginsDir, "test-plugin", "node.plugin.json"),
      JSON.stringify(nodeManifest),
    );
    const app = createApp();
    const res = await app.request("/api/plugins");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plugins.length).toBeGreaterThanOrEqual(1);
    expect(body.plugins[0].id).toBe("test.plugin");
  });

  it("GET /api/skills returns skills", async () => {
    await mkdir(join(pluginsDir, "test-skills"), { recursive: true });
    await writeFile(
      join(pluginsDir, "test-skills", "skill.plugin.json"),
      JSON.stringify(skillManifest),
    );
    const app = createApp();
    const res = await app.request("/api/skills");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].id).toBe("test_skill");
  });

  it("POST /api/plugins/:id/enable enables a plugin", async () => {
    await mkdir(join(pluginsDir, "test-plugin"), { recursive: true });
    await writeFile(
      join(pluginsDir, "test-plugin", "node.plugin.json"),
      JSON.stringify(nodeManifest),
    );
    const app = createApp();
    const res = await app.request("/api/plugins/test.plugin/enable", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
  });

  it("POST /api/plugins/:id/disable disables a plugin", async () => {
    await mkdir(join(pluginsDir, "test-plugin"), { recursive: true });
    await writeFile(
      join(pluginsDir, "test-plugin", "node.plugin.json"),
      JSON.stringify(nodeManifest),
    );
    const app = createApp();
    const res = await app.request("/api/plugins/test.plugin/disable", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
  });

  it("GET /api/nodes returns node definitions", async () => {
    await mkdir(join(pluginsDir, "test-plugin"), { recursive: true });
    await writeFile(
      join(pluginsDir, "test-plugin", "node.plugin.json"),
      JSON.stringify(nodeManifest),
    );
    const app = createApp();
    const res = await app.request("/api/nodes");
    expect(res.status).toBe(200);
    const body = await res.json();
    const types = body.nodes.map((n: { type: string }) => n.type);
    expect(types).toContain("testNode");
    expect(types).toContain("agent");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/routes/plugins.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// apps/server/src/routes/plugins.ts
import { Hono } from "hono";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readdir, readFile as readDirFile } from "node:fs/promises";
import { join } from "node:path";
import { nodeRegistry } from "@awp/workflow-core";
import { validateSkillPluginManifest } from "@awp/plugin-sdk";
import {
  loadNodePlugins,
  loadSkillPlugins,
  type NodePlugin,
  type SkillItem,
} from "../services/pluginLoader.js";

const loadPluginState = async (
  stateFile: string,
): Promise<Record<string, { enabled: boolean; updatedAt?: string }>> => {
  try {
    return JSON.parse(await readFile(stateFile, "utf8"));
  } catch {
    return {};
  }
};

const savePluginState = async (
  stateFile: string,
  state: Record<string, unknown>,
): Promise<void> => {
  await mkdir(join(stateFile, ".."), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

export const createPluginsRoutes = (pluginsDir: string, stateFile: string) => {
  const app = new Hono();

  app.get("/api/plugins", async (c) => {
    const pluginState = await loadPluginState(stateFile);
    const nodePlugins = await loadNodePlugins(pluginsDir);
    const pluginList = nodePlugins.map((plugin) => {
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
        nodeTypes: plugin.manifest.nodes.map((n) => n.type),
      };
    });

    // Also scan skill plugins
    try {
      const entries = await readdir(pluginsDir, { withFileTypes: true });
      for (const dirEntry of entries.filter((e) => e.isDirectory())) {
        const skillPath = join(pluginsDir, dirEntry.name, "skill.plugin.json");
        try {
          const skillManifest = JSON.parse(await readDirFile(skillPath, "utf8"));
          if (validateSkillPluginManifest(skillManifest).length > 0) continue;
          const state = pluginState[skillManifest.id];
          const manifestEnabled = skillManifest.enabled !== false;
          const userOverride = state && typeof state.enabled === "boolean";
          pluginList.push({
            id: skillManifest.id,
            label: skillManifest.label,
            version: skillManifest.version,
            description: skillManifest.description ?? "",
            author: skillManifest.author,
            manifestEnabled,
            enabled: userOverride ? state.enabled : manifestEnabled,
            stateSource: userOverride ? "user" : "manifest",
            permissions: [],
            dependencies: [],
            compatibility: skillManifest.compatibility ?? null,
            nodeTypes: [],
          });
        } catch {
          /* no skill.plugin.json */
        }
      }
    } catch {
      /* ignore readdir errors */
    }

    return c.json({ plugins: pluginList });
  });

  app.post("/api/plugins/:id/enable", async (c) => {
    const pluginId = c.req.param("id");
    const pluginState = await loadPluginState(stateFile);
    const nodePlugins = await loadNodePlugins(pluginsDir);
    const plugin = nodePlugins.find((p) => p.manifest.id === pluginId);
    if (!plugin) {
      return c.json({ error: `Plugin not found: ${pluginId}` }, 404);
    }
    pluginState[pluginId] = {
      ...pluginState[pluginId],
      enabled: true,
      updatedAt: new Date().toISOString(),
    };
    await savePluginState(stateFile, pluginState);
    return c.json({
      id: pluginId,
      enabled: true,
      manifestEnabled: plugin.manifest.enabled !== false,
      stateSource: "user",
      nodeTypes: plugin.manifest.nodes.map((n) => n.type),
    });
  });

  app.post("/api/plugins/:id/disable", async (c) => {
    const pluginId = c.req.param("id");
    const pluginState = await loadPluginState(stateFile);
    const nodePlugins = await loadNodePlugins(pluginsDir);
    const plugin = nodePlugins.find((p) => p.manifest.id === pluginId);
    if (!plugin) {
      return c.json({ error: `Plugin not found: ${pluginId}` }, 404);
    }
    pluginState[pluginId] = {
      ...pluginState[pluginId],
      enabled: false,
      updatedAt: new Date().toISOString(),
    };
    await savePluginState(stateFile, pluginState);
    return c.json({
      id: pluginId,
      enabled: false,
      manifestEnabled: plugin.manifest.enabled !== false,
      stateSource: "user",
      nodeTypes: plugin.manifest.nodes.map((n) => n.type),
    });
  });

  app.get("/api/skills", async (c) => {
    const skills = await loadSkillPlugins(pluginsDir);
    const categories = [...new Set(skills.map((s) => s.category).filter(Boolean))];
    return c.json({ skills, categories });
  });

  app.get("/api/nodes", async (c) => {
    const nodePlugins = await loadNodePlugins(pluginsDir);
    const pluginCatalog = Object.fromEntries(
      nodePlugins.flatMap((p) => p.manifest.nodes.map((n) => [n.type, n])),
    );
    const allNodes = { ...nodeRegistry, ...pluginCatalog };
    return c.json({
      nodes: Object.values(allNodes),
      plugins: nodePlugins.map((p) => ({
        id: p.manifest.id,
        label: p.manifest.label,
        version: p.manifest.version,
        description: p.manifest.description,
        permissions: p.manifest.permissions ?? [],
        dependencies: p.manifest.dependencies ?? [],
        nodeTypes: p.manifest.nodes.map((n) => n.type),
      })),
    });
  });

  return app;
};
```

- [ ] **Step 4: Register route in index.ts**

```typescript
import { createPluginsRoutes } from "./routes/plugins.js";
// ...
app.route("/", createPluginsRoutes(env.pluginsDir, env.pluginsDir + "/../plugin-state.json"));
```

Note: `plugin-state.json` lives in the `plugins/` directory. The state file path should be `join(env.pluginsDir, "plugin-state.json")` — adjust the index.ts call accordingly.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/routes/plugins.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/plugins.ts apps/server/src/routes/plugins.test.ts apps/server/src/index.ts
git commit -m "feat(server): add plugins, skills, and nodes routes"
```

---

### Task 9: Templates route

**Files:**

- Create: `apps/server/src/routes/templates.ts`
- Modify: `apps/server/src/index.ts` (register route)
- Test: `apps/server/src/routes/templates.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/routes/templates.test.ts
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createTemplatesRoutes } from "./templates";
import { workflowTemplates } from "@awp/web/state/sampleWorkflows";

// Note: importing from @awp/web is not ideal for a server test.
// In practice, templates will be loaded from a JSON file or passed in.
// For now, pass template data directly.

describe("templates routes", () => {
  it("GET /api/templates returns template list", async () => {
    const app = new Hono();
    const sampleTemplates = [
      {
        id: "basic-rp",
        name: { zh: "基础 RP", en: "Basic RP" },
        description: { zh: "测试", en: "Test" },
        workflow: { id: "basic-rp", name: "Basic RP", version: 1, nodes: [], edges: [] },
      },
    ];
    app.route("/", createTemplatesRoutes(sampleTemplates));
    const res = await app.request("/api/templates");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.templates).toHaveLength(1);
    expect(body.templates[0].id).toBe("basic-rp");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/routes/templates.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// apps/server/src/routes/templates.ts
import { Hono } from "hono";

export type WorkflowTemplate = {
  id: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  workflow: import("@awp/workflow-core").WorkflowDefinition;
};

export const createTemplatesRoutes = (templates: WorkflowTemplate[]) => {
  const app = new Hono();

  app.get("/api/templates", (c) => {
    return c.json({ templates });
  });

  return app;
};
```

- [ ] **Step 4: Register route in index.ts — load templates from sampleWorkflows**

For now, import sample data and pass to the route. The templates will be loaded at startup:

```typescript
import { createTemplatesRoutes } from "./routes/templates.js";
import { workflowTemplates } from "@awp/web/state/sampleWorkflows";
// ...
app.route("/", createTemplatesRoutes(workflowTemplates));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/routes/templates.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/templates.ts apps/server/src/routes/templates.test.ts apps/server/src/index.ts
git commit -m "feat(server): add templates route"
```

---

## Phase 4: Workflow + LLM Routes

### Task 10: Workflow runner service

**Files:**

- Create: `apps/server/src/services/workflowRunner.ts`
- Test: `apps/server/src/services/workflowRunner.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/services/workflowRunner.test.ts
import { describe, expect, it } from "vitest";
import { runWorkflowStreaming, collectInputs } from "./workflowRunner";
import type { WorkflowDefinition } from "@awp/workflow-core";

describe("collectInputs", () => {
  it("collects inputs from upstream edges", () => {
    const workflow: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      nodes: [
        { id: "a", type: "userInput", position: { x: 0, y: 0 }, config: { text: "hello" } },
        { id: "b", type: "textOutput", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", source: "a", sourcePort: "text", target: "b", targetPort: "text" }],
    };
    const outputsByNode = new Map<string, Record<string, unknown>>();
    outputsByNode.set("a", { text: "hello" });
    const inputs = collectInputs(workflow, "b", outputsByNode);
    expect(inputs).toEqual({ text: "hello" });
  });
});

describe("runWorkflowStreaming", () => {
  it("returns validation errors for invalid workflow", async () => {
    const workflow: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      nodes: [],
      edges: [{ id: "e1", source: "x", sourcePort: "a", target: "y", targetPort: "b" }],
    };
    const events: unknown[] = [];
    const result = await runWorkflowStreaming(workflow, {}, {}, (event) => events.push(event));
    expect(result.status).toBe("error");
    expect(events).toHaveLength(1);
    expect(events[0]).toHaveProperty("type", "done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/services/workflowRunner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// apps/server/src/services/workflowRunner.ts
import {
  createExecutionBatches,
  validateWorkflow,
  type NodeCatalog,
  type NodeExecutor,
  type NodeRunResult,
  type WorkflowDefinition,
  type WorkflowRunResult,
  type WorkflowValidationIssue,
} from "@awp/workflow-core";

export type WorkflowStreamEvent =
  | { type: "nodeRun"; run: NodeRunResult }
  | { type: "done"; result: WorkflowRunResult }
  | { type: "token"; nodeId: string; token: string }
  | { type: "error"; error: string };

export const collectInputs = (
  workflow: WorkflowDefinition,
  nodeId: string,
  outputsByNode: Map<string, Record<string, unknown>>,
): Record<string, unknown> => {
  const inputs: Record<string, unknown> = {};
  for (const edge of workflow.edges.filter((e) => e.target === nodeId)) {
    inputs[edge.targetPort] = outputsByNode.get(edge.source)?.[edge.sourcePort];
  }
  return inputs;
};

export const runWorkflowStreaming = async (
  workflow: WorkflowDefinition,
  executors: Record<string, NodeExecutor>,
  catalog: NodeCatalog,
  onEvent: (event: WorkflowStreamEvent) => void,
): Promise<WorkflowRunResult> => {
  const validationIssues = validateWorkflow(workflow, catalog);
  const errorIssues = validationIssues.filter((i) => i.level === "error");

  if (errorIssues.length > 0) {
    const result: WorkflowRunResult = {
      workflowId: workflow.id,
      status: "error",
      batches: [],
      nodeRuns: [],
      validationIssues,
    };
    onEvent({ type: "done", result });
    return result;
  }

  const batches = createExecutionBatches(workflow);
  const outputsByNode = new Map<string, Record<string, unknown>>();
  const nodeRuns: NodeRunResult[] = [];
  let hasError = false;

  for (const batch of batches) {
    const batchRuns = await Promise.all(
      batch.map(async (nodeId) => {
        const node = workflow.nodes.find((n) => n.id === nodeId);
        if (!node) throw new Error(`Missing scheduled node ${nodeId}`);
        const inputs = collectInputs(workflow, nodeId, outputsByNode);
        const startedAt = Date.now();
        try {
          const executor = executors[node.type] ?? (async () => ({ outputs: {} }));
          const execution = await executor({ node, inputs });
          outputsByNode.set(nodeId, execution.outputs);
          return {
            nodeId,
            status: "success" as const,
            inputs,
            outputs: execution.outputs,
            metadata: execution.metadata,
            startedAt,
            endedAt: Date.now(),
          };
        } catch (error) {
          hasError = true;
          return {
            nodeId,
            status: "error" as const,
            inputs,
            outputs: {},
            startedAt,
            endedAt: Date.now(),
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    for (const run of batchRuns) {
      nodeRuns.push(run);
      onEvent({ type: "nodeRun", run });
    }

    if (hasError) break;
  }

  const result: WorkflowRunResult = {
    workflowId: workflow.id,
    status: hasError ? "error" : "success",
    batches,
    nodeRuns,
    validationIssues,
  };
  onEvent({ type: "done", result });
  return result;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/services/workflowRunner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/workflowRunner.ts apps/server/src/services/workflowRunner.test.ts
git commit -m "feat(server): add workflow runner service with streaming"
```

---

### Task 11: Workflow routes

**Files:**

- Create: `apps/server/src/routes/workflow.ts`
- Modify: `apps/server/src/index.ts` (register route)
- Test: `apps/server/src/routes/workflow.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/routes/workflow.test.ts
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createWorkflowRoutes } from "./workflow";

const mockExecutors = {
  userInput: async ({ node }: { node: { config: { text?: string } } }) => ({
    outputs: { text: node.config.text ?? "" },
  }),
};

const mockCatalog = {
  userInput: {
    type: "userInput",
    label: "User Input",
    ports: [{ id: "text", label: "Text", direction: "output", dataType: "text" }],
  },
  textOutput: {
    type: "textOutput",
    label: "Text Output",
    ports: [{ id: "text", label: "Text", direction: "input", dataType: "text" }],
  },
};

describe("workflow routes", () => {
  it("POST /api/run-workflow executes a simple workflow", async () => {
    const app = new Hono();
    app.route(
      "/",
      createWorkflowRoutes({
        createExecutors: async () => mockExecutors,
        catalog: mockCatalog,
      }),
    );
    const res = await app.request("/api/run-workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: {
          id: "test",
          name: "Test",
          version: 1,
          nodes: [
            { id: "in", type: "userInput", position: { x: 0, y: 0 }, config: { text: "hi" } },
          ],
          edges: [],
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.nodeRuns).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/routes/workflow.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// apps/server/src/routes/workflow.ts
import { Hono } from "hono";
import {
  runWorkflow,
  validateWorkflow,
  type NodeCatalog,
  type NodeExecutor,
  type WorkflowDefinition,
} from "@awp/workflow-core";
import { runWorkflowStreaming } from "../services/workflowRunner.js";

type WorkflowContext = {
  createExecutors: (
    workflow: WorkflowDefinition,
    onToken?: (event: { nodeId: string; token: string }) => void,
  ) => Promise<Record<string, NodeExecutor>>;
  catalog: NodeCatalog;
};

export const createWorkflowRoutes = (ctx: WorkflowContext) => {
  const app = new Hono();

  app.post("/api/run-workflow", async (c) => {
    const { workflow } = await c.req.json<{ workflow: WorkflowDefinition }>();
    const executors = await ctx.createExecutors(workflow);
    const result = await runWorkflow(workflow, executors, ctx.catalog);
    return c.json(result);
  });

  app.post("/api/run-workflow-stream", async (c) => {
    const { workflow } = await c.req.json<{ workflow: WorkflowDefinition }>();
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const onEvent = (event: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        const executors = await ctx.createExecutors(workflow, (e) =>
          onEvent({ type: "token", ...e }),
        );
        await runWorkflowStreaming(workflow, executors, ctx.catalog, onEvent);
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  app.post("/api/workflows/validate", async (c) => {
    const { workflow } = await c.req.json<{ workflow: WorkflowDefinition }>();
    return c.json({ issues: validateWorkflow(workflow, ctx.catalog) });
  });

  return app;
};
```

- [ ] **Step 4: Register route in index.ts**

The workflow routes need a context with `createExecutors` and `catalog`. This will be wired in the final integration (Task 14), but for now register with a placeholder:

```typescript
import { createWorkflowRoutes } from "./routes/workflow.js";
import { nodeRegistry } from "@awp/workflow-core";
// ...
app.route(
  "/",
  createWorkflowRoutes({
    createExecutors: async () => ({}),
    catalog: nodeRegistry,
  }),
);
```

This placeholder will be replaced in Task 14 with the full executor factory.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/routes/workflow.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/workflow.ts apps/server/src/routes/workflow.test.ts apps/server/src/index.ts
git commit -m "feat(server): add workflow execution routes (sync + stream)"
```

---

### Task 12: LLM status and proxy route

**Files:**

- Create: `apps/server/src/routes/llm.ts`
- Modify: `apps/server/src/index.ts` (register route)
- Test: `apps/server/src/routes/llm.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/routes/llm.test.ts
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createLlmRoutes } from "./llm";

describe("llm routes", () => {
  it("GET /api/llm/status reports configured=false without key", async () => {
    const app = new Hono();
    app.route("/", createLlmRoutes({ apiKey: undefined, model: "deepseek-v4-flash" }));
    const res = await app.request("/api/llm/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(false);
    expect(body.model).toBe("deepseek-v4-flash");
  });

  it("GET /api/llm/status reports configured=true with key", async () => {
    const app = new Hono();
    app.route("/", createLlmRoutes({ apiKey: "test-key", model: "deepseek-v4-flash" }));
    const res = await app.request("/api/llm/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/routes/llm.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// apps/server/src/routes/llm.ts
import { Hono } from "hono";

type LlmContext = {
  apiKey: string | undefined;
  model: string;
};

export const createLlmRoutes = (ctx: LlmContext) => {
  const app = new Hono();

  app.get("/api/llm/status", (c) => {
    return c.json({
      configured: ctx.apiKey !== undefined && ctx.apiKey !== "",
      model: ctx.model,
    });
  });

  return app;
};
```

- [ ] **Step 4: Register route in index.ts**

```typescript
import { createLlmRoutes } from "./routes/llm.js";
// ...
app.route(
  "/",
  createLlmRoutes({
    apiKey: env.deepseekApiKey,
    model: env.deepseekModel,
  }),
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/routes/llm.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/llm.ts apps/server/src/routes/llm.test.ts apps/server/src/index.ts
git commit -m "feat(server): add LLM status route"
```

---

## Phase 5: Integration + Wiring

### Task 13: Wire full executor factory into workflow routes

**Files:**

- Modify: `apps/server/src/index.ts` (replace placeholder with real executor factory)

This task ports the executor creation logic from `serve.mjs` lines 395-611 into the server context. The executor factory uses `createDeepSeekAdapter` from `@awp/agent-runtime`, `rankMemories` from `@awp/memory-core`, and the plugin loader.

- [ ] **Step 1: Add executor factory to index.ts**

Replace the placeholder `createExecutors: async () => ({})` with the real factory. This is a direct port from `serve.mjs` with Hono-compatible types:

```typescript
// In apps/server/src/index.ts, before app creation:
import { createDeepSeekAdapter, executeAgentNode } from "@awp/agent-runtime";
import { rankMemories } from "@awp/memory-core";
import { nodeRegistry, type NodeCatalog, type NodeExecutor } from "@awp/workflow-core";
import { loadNodePlugins, loadSkillPlugins } from "./services/pluginLoader.js";
import { readEntries } from "./services/jsonStore.js";

const memoryFile = join(env.dataDir, "memories.json");
const worldbookFile = join(env.dataDir, "worldbook.json");

const skillCatalog = await loadSkillPlugins(env.pluginsDir);
const nodePlugins = await loadNodePlugins(env.pluginsDir);
const pluginCatalog: NodeCatalog = Object.fromEntries(
  nodePlugins.flatMap((p) => p.manifest.nodes.map((n) => [n.type, n])),
);
const runtimeNodeCatalog: NodeCatalog = { ...nodeRegistry, ...pluginCatalog };

const agentToolDescriptions = [
  {
    id: "mock_search",
    label: "Mock Search",
    description: "Read simulated worldbook entries.",
    tools: [],
  },
  {
    id: "memory_read",
    label: "Memory Read",
    description: "Read simulated long-term memory.",
    tools: [],
  },
  {
    id: "worldbook_read",
    label: "Worldbook Read",
    description: "Provides retrieved worldbook entries.",
    tools: [],
  },
  {
    id: "rp_memory_read",
    label: "RP Memory Read",
    description: "Provides long-term roleplay memory.",
    tools: [],
  },
];

const extractQuery = (workflow: import("@awp/workflow-core").WorkflowDefinition) =>
  workflow.nodes
    .map((n) => [n.config?.text, n.config?.systemPrompt].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n");

const serializeSearchResults = (entries: { title: string; content: string; tags: string[] }[]) =>
  entries
    .map((e) => `${e.title}: ${e.content}${e.tags.length ? ` [${e.tags.join(", ")}]` : ""}`)
    .join("\n");

const createExecutors = async (
  workflow: import("@awp/workflow-core").WorkflowDefinition,
  onToken?: (event: { nodeId: string; token: string }) => void,
) => {
  const adapter = env.deepseekApiKey
    ? createDeepSeekAdapter({ apiKey: env.deepseekApiKey })
    : undefined;
  const memories = await readEntries(memoryFile);
  const worldbookEntries = await readEntries(worldbookFile);
  const relevantMemories = rankMemories(extractQuery(workflow), memories, 4);
  const model = env.deepseekModel;

  return {
    userInput: async ({ node }: { node: { config: { text?: string } } }) => ({
      outputs: { text: node.config.text ?? "" },
    }),
    promptTemplate: async ({
      node,
      inputs,
    }: {
      node: { config: { template?: string } };
      inputs: Record<string, unknown>;
    }) => ({
      outputs: {
        prompt: `${String(node.config.template ?? "")}\n${String(inputs.source ?? "")}`.trim(),
      },
    }),
    mockSearch: async ({ inputs }: { inputs: Record<string, unknown> }) => ({
      outputs: { results: `Mock search result for: ${String(inputs.query ?? "")}` },
    }),
    worldbookSearch: async ({
      node,
      inputs,
    }: {
      node: { config: { query?: string; limit?: number } };
      inputs: Record<string, unknown>;
    }) => {
      const query = String(inputs.query ?? node.config.query ?? extractQuery(workflow));
      const results = rankMemories(query, worldbookEntries, Number(node.config.limit ?? 4));
      return {
        outputs: { results: serializeSearchResults(results) },
        metadata: {
          matchedWorldbookIds: results.map((e) => e.id),
          matchedWorldbookTitles: results.map((e) => e.title),
        },
      };
    },
    memoryRecall: async ({
      node,
      inputs,
    }: {
      node: { config: { query?: string; limit?: number } };
      inputs: Record<string, unknown>;
    }) => {
      const query = String(inputs.query ?? node.config.query ?? extractQuery(workflow));
      const results = rankMemories(query, memories, Number(node.config.limit ?? 4));
      return {
        outputs: { memories: serializeSearchResults(results) },
        metadata: {
          matchedMemoryIds: results.map((e) => e.id),
          matchedMemoryTitles: results.map((e) => e.title),
        },
      };
    },
    agent: async ({
      node,
      inputs,
    }: {
      node: { id: string; config: Record<string, unknown> };
      inputs: Record<string, unknown>;
    }) => {
      if (!adapter) throw new Error("Missing DEEPSEEK_API_KEY");
      const selectedModel = String(node.config.model ?? model).startsWith("mock-")
        ? model
        : String(node.config.model ?? model);
      const result = await executeAgentNode(
        {
          nodeId: node.id,
          config: {
            model: selectedModel,
            systemPrompt: String(node.config.systemPrompt ?? ""),
            skills: Array.isArray(node.config.skills) ? node.config.skills.map(String) : [],
            plugins: Array.isArray(node.config.plugins) ? node.config.plugins.map(String) : [],
            outputType: String(node.config.outputType ?? "draft"),
          },
          inputs: {
            ...inputs,
            longTermMemory: relevantMemories.map((m) => ({
              title: m.title,
              content: m.content,
              tags: m.tags,
            })),
          },
          availableSkills: skillCatalog,
          availablePlugins: agentToolDescriptions,
        },
        adapter,
        { onToken: (token) => onToken?.({ nodeId: node.id, token }) },
      );
      return { outputs: { result: result.text }, metadata: result.metadata };
    },
    textOutput: async ({ inputs }: { inputs: Record<string, unknown> }) => ({
      outputs: { final: inputs.text ?? "" },
    }),
    debugLog: async ({ inputs }: { inputs: Record<string, unknown> }) => ({
      outputs: { debug: JSON.stringify(inputs, null, 2) },
    }),
  } as Record<string, NodeExecutor>;
};
```

Then use in workflow routes:

```typescript
app.route(
  "/",
  createWorkflowRoutes({
    createExecutors,
    catalog: runtimeNodeCatalog,
  }),
);
```

- [ ] **Step 2: Run full test suite**

Run: `cd apps/server && npx vitest run`
Expected: All existing tests still PASS

- [ ] **Step 3: Verify server starts and responds**

Run: `cd apps/server && DEEPSEEK_API_KEY=test npx tsx src/index.ts &` then `curl http://127.0.0.1:5180/api/llm/status`
Expected: `{"configured":true,"model":"deepseek-v4-flash"}`

Kill the background process after verifying.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/index.ts
git commit -m "feat(server): wire full executor factory into workflow routes"
```

---

### Task 14: Add Vite proxy config and production static serving

**Files:**

- Modify: `apps/web/vite.config.ts` (add proxy)
- Modify: `apps/server/src/index.ts` (add serveStatic)
- Modify: `apps/web/package.json` (update serve script)
- Modify: `package.json` (add dev:server script)

- [ ] **Step 1: Add Vite proxy config**

In `apps/web/vite.config.ts`, add the `server.proxy` configuration:

```typescript
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [],
  build: {
    minify: false,
    sourcemap: false,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:5180",
    },
  },
});
```

- [ ] **Step 2: Add production static serving to index.ts**

```typescript
// At the top of apps/server/src/index.ts, add import:
import { serveStatic } from "@hono/node-server/serve-static";

// After all API routes are registered, before serve():
if (env.nodeEnv === "production") {
  app.use("/*", serveStatic({ root: "../web/dist" }));
}
```

- [ ] **Step 3: Update root package.json scripts**

Add a `dev:server` script and update `dev` to start both:

```json
{
  "scripts": {
    "dev": "npm --workspace @awp/web run dev",
    "dev:server": "npm --workspace @awp/server run dev",
    "serve": "npm --workspace @awp/server run start"
  }
}
```

- [ ] **Step 4: Verify dev mode works**

Terminal 1: `cd apps/server && npx tsx src/index.ts`
Terminal 2: `cd apps/web && npx vite --host 127.0.0.1`

Open `http://127.0.0.1:5173` — the frontend should load and API calls should proxy through to Hono.

- [ ] **Step 5: Commit**

```bash
git add apps/web/vite.config.ts apps/server/src/index.ts package.json apps/web/package.json
git commit -m "feat(server): add Vite proxy and production static serving"
```

---

### Task 15: Final verification — remove old serve.mjs

**Files:**

- Delete: `apps/web/scripts/serve.mjs`
- Modify: `apps/web/scripts/build.mjs` (remove server bundle step)
- Modify: `apps/web/package.json` (update serve script)

- [ ] **Step 1: Update build.mjs to remove server bundle**

In `apps/web/scripts/build.mjs`, remove the second `build()` call that bundles `serve.mjs` (lines 59-67):

```javascript
// DELETE this block:
await build({
  entryPoints: [resolve(root, "scripts/serve.mjs")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node22"],
  outfile: resolve(dist, "server.mjs"),
  minify: false,
});
```

- [ ] **Step 2: Update apps/web/package.json serve script**

Change the serve script from building + running the old server to running the new one:

```json
{
  "scripts": {
    "serve": "npm run build --workspaces && NODE_ENV=production npm --workspace @awp/server run start"
  }
}
```

- [ ] **Step 3: Delete old serve.mjs**

```bash
git rm apps/web/scripts/serve.mjs
```

- [ ] **Step 4: Run full project verification**

Run: `npm run verify && npm run test`
Expected: All pass

- [ ] **Step 5: Manual smoke test — production mode**

Run: `npm run serve`
Open `http://127.0.0.1:5180` — should serve the full app with API working.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server): remove legacy serve.mjs, wire new @awp/server as production server"
```

---

## Self-Review

### Spec Coverage

| Spec Requirement                          | Task    |
| ----------------------------------------- | ------- |
| Package scaffold + tsconfig               | Task 1  |
| Environment configuration with DATA_DIR   | Task 2  |
| JSON file store service                   | Task 3  |
| Hono entry point                          | Task 4  |
| Memories CRUD routes                      | Task 5  |
| Worldbook CRUD routes                     | Task 6  |
| Plugin loader service                     | Task 7  |
| Plugins/Skills/Nodes routes               | Task 8  |
| Templates route                           | Task 9  |
| Workflow runner service                   | Task 10 |
| Workflow execution routes (sync + stream) | Task 11 |
| LLM status route                          | Task 12 |
| Full executor factory wiring              | Task 13 |
| Vite proxy + production static serving    | Task 14 |
| Remove old serve.mjs                      | Task 15 |

All spec requirements covered. ✅

### Placeholder Scan

No TBD, TODO, "implement later", or "add appropriate error handling" found. All code blocks contain complete implementations. ✅

### Type Consistency

- `Entry`, `EntryDraft` types defined in `jsonStore.ts` and used consistently in `memories.ts`, `worldbook.ts`
- `NodePlugin`, `SkillItem`, `NodePluginManifest` defined in `pluginLoader.ts` and used in `plugins.ts`
- `WorkflowStreamEvent`, `collectInputs`, `runWorkflowStreaming` defined in `workflowRunner.ts` and used in `workflow.ts`
- All route factory functions follow the same pattern: `createXxxRoutes(dependencies) => Hono` ✅
