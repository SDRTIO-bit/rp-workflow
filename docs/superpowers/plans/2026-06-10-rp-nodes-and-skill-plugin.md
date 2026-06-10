# RP 节点（第一批）+ Skill 插件化 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 3 个 RP 节点（rpInputParser、rpContextAssembler、rpMemoryWrite）到 rp-core 插件，并实现独立的 skill.plugin.json manifest 协议替代硬编码 skill。

**Architecture:** Skill 走独立 `skill.plugin.json` manifest（方案 B），与 node.plugin.json 分离管理。3 个新 RP 节点统一走 rp-core 插件（node.plugin.json + executor.mjs）。serve.mjs 新增 `loadSkillPlugins()` 和 `/api/skills`，移除 `sampleSkills`/`samplePlugins` 硬编码。

**Tech Stack:** TypeScript, Node.js, Vitest

---

## File Structure

```
plugins/rp-skills/skill.plugin.json       — Create: 7 个 RP skill 定义
packages/plugin-sdk/src/index.ts           — Modify: SkillPluginManifest, SkillDefinition, validateSkillPluginManifest
apps/web/scripts/serve.mjs                 — Modify: loadSkillPlugins, /api/skills, 去硬编码, _skillCatalog
apps/web/src/runWorkflowClient.ts          — Modify: loadSkillsViaServer, SkillSummary
apps/web/src/App.tsx                       — Modify: agent skill 列表动态加载, 插件面板 skill 插件显示
packages/workflow-core/src/nodeRegistry.ts — Modify: 补充 json 兼容对
plugins/rp-core/node.plugin.json           — Modify: 新增 3 个 node 定义
plugins/rp-core/executor.mjs               — Modify: 新增 3 个 executor 函数
apps/web/src/state/sampleWorkflows.ts      — Modify: 新增 rpFullPipeline 模板
```

---

### Task 1: 新增 Skill 插件类型定义和校验

**Files:**
- Modify: `packages/plugin-sdk/src/index.ts`
- Modify: `packages/plugin-sdk/src/plugin-sdk.test.ts`

**Goal:** 定义 `SkillPluginManifest`、`SkillDefinition` 类型和 `validateSkillPluginManifest()` 校验函数。

- [ ] **Step 1: 新增类型定义**

In `packages/plugin-sdk/src/index.ts`, add after the `PluginDependency` type (after line 43):

```ts
export type SkillDefinition = {
  id: string;
  label: LocalizedText;
  content: LocalizedText;
  category?: string;
  tags?: string[];
};

export type SkillPluginManifest = {
  schemaVersion: 1;
  id: string;
  label: string;
  version: string;
  description?: string;
  author?: string;
  enabled?: boolean;
  compatibility?: PluginCompatibility;
  skills: SkillDefinition[];
};
```

Also add `LocalizedText` import — it's currently not imported. Check if it's already available. Looking at the file, `LocalizedText` is not defined in plugin-sdk. Simpler approach: define `SkillLabel` and `SkillContent` as `{ zh: string; en: string }` inline, or use a local `LocalizedText` type.

Add before the existing types (before `export type PluginPermission`):

```ts
export type LocalizedText = {
  zh: string;
  en: string;
};
```

Then add after `PluginDependency`:

```ts
export type SkillDefinition = {
  id: string;
  label: LocalizedText;
  content: LocalizedText;
  category?: string;
  tags?: string[];
};

export type SkillPluginManifest = {
  schemaVersion: 1;
  id: string;
  label: string;
  version: string;
  description?: string;
  author?: string;
  enabled?: boolean;
  compatibility?: PluginCompatibility;
  skills: SkillDefinition[];
};
```

- [ ] **Step 2: 新增 validateSkillPluginManifest 函数**

Add after `validateNodePluginManifest`:

```ts
export const validateSkillPluginManifest = (manifest: unknown): string[] => {
  const issues: string[] = [];

  if (!isObject(manifest)) {
    return ["skill manifest must be an object"];
  }

  if (manifest.schemaVersion !== 1) {
    issues.push("schemaVersion must be 1");
  }

  for (const key of ["id", "label", "version"] as const) {
    if (typeof manifest[key] !== "string" || manifest[key].trim() === "") {
      issues.push(`${key} must be a non-empty string`);
    }
  }

  if (!Array.isArray(manifest.skills)) {
    issues.push("skills must be an array");
  } else {
    for (const [index, skill] of manifest.skills.entries()) {
      if (!isObject(skill)) {
        issues.push(`skills[${index}] must be an object`);
        continue;
      }
      if (typeof skill.id !== "string" || skill.id.trim() === "") {
        issues.push(`skills[${index}].id must be a non-empty string`);
      }
      if (!isObject(skill.label) || typeof skill.label.zh !== "string" || typeof skill.label.en !== "string") {
        issues.push(`skills[${index}].label must have zh and en strings`);
      }
      if (!isObject(skill.content) || typeof skill.content.zh !== "string" || typeof skill.content.en !== "string") {
        issues.push(`skills[${index}].content must have zh and en strings`);
      }
    }
  }

  return issues;
};
```

- [ ] **Step 3: 新增测试**

In `packages/plugin-sdk/src/plugin-sdk.test.ts`, add after existing tests:

```ts
it("validates a valid skill plugin manifest", () => {
  const manifest = {
    schemaVersion: 1,
    id: "awp.rp-skills",
    label: "RP Skills",
    version: "0.1.0",
    skills: [
      {
        id: "rp_persona",
        label: { zh: "角色扮演", en: "RP Persona" },
        content: { zh: "保持人设", en: "Stay in character" },
      },
    ],
  };
  expect(validateSkillPluginManifest(manifest)).toEqual([]);
});

it("rejects skill manifest with missing skills array", () => {
  const issues = validateSkillPluginManifest({
    schemaVersion: 1,
    id: "awp.test",
    label: "Test",
    version: "0.1.0",
  });
  expect(issues).toContain("skills must be an array");
});

it("rejects skill with missing label zh", () => {
  const issues = validateSkillPluginManifest({
    schemaVersion: 1,
    id: "awp.test",
    label: "Test",
    version: "0.1.0",
    skills: [
      {
        id: "bad_skill",
        label: { en: "Only English" },
        content: { zh: "内容", en: "Content" },
      },
    ],
  });
  expect(issues.length).toBeGreaterThan(0);
});
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run packages/plugin-sdk/src/plugin-sdk.test.ts
```

Expected: 5 tests pass (2 existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-sdk/src/index.ts packages/plugin-sdk/src/plugin-sdk.test.ts
git commit -m "feat: add SkillPluginManifest type and validateSkillPluginManifest

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: 创建 rp-skills skill 插件

**Files:**
- Create: `plugins/rp-skills/skill.plugin.json`

**Goal:** 创建包含 7 个 RP skill 的 skill.plugin.json。

- [ ] **Step 1: Create directory and manifest**

```bash
mkdir -p "F:/1/新建文件夹 (2)/plugins/rp-skills"
```

Then write `plugins/rp-skills/skill.plugin.json`:

```json
{
  "schemaVersion": 1,
  "id": "awp.rp-skills",
  "label": "RP Skills",
  "version": "0.1.0",
  "description": "Roleplay agent skills for persona, continuity, player agency, prose, and world context.",
  "author": "Agent Workflow Platform",
  "enabled": true,
  "compatibility": { "app": ">=0.1.0" },
  "skills": [
    {
      "id": "world_context",
      "label": { "zh": "世界观上下文", "en": "World Context" },
      "content": {
        "zh": "提取和使用稳定的世界观设定。保持与既有世界书事实一致。",
        "en": "Extract and use stable setting facts. Stay consistent with established worldbook canon."
      },
      "category": "knowledge",
      "tags": ["worldbuilding", "canon", "facts"]
    },
    {
      "id": "prose",
      "label": { "zh": "散文写作", "en": "Prose Writing" },
      "content": {
        "zh": "写出生动、克制的中文叙述。避免过度修饰和陈词滥调。",
        "en": "Write vivid, restrained prose. Avoid overwrought descriptions and clichés."
      },
      "category": "writing",
      "tags": ["prose", "style", "narrative"]
    },
    {
      "id": "consistency",
      "label": { "zh": "一致性检查", "en": "Consistency" },
      "content": {
        "zh": "检查是否存在矛盾、遗漏事实或违反已确立的设定。",
        "en": "Check for contradictions, missing facts, or violations of established canon."
      },
      "category": "safety",
      "tags": ["consistency", "logic", "fact-checking"]
    },
    {
      "id": "rp_persona",
      "label": { "zh": "RP 角色扮演", "en": "RP Persona" },
      "content": {
        "zh": "保持角色人设、语气、关系立场、秘密和边界。不打破第四面墙。",
        "en": "Stay in character. Preserve the character card's persona, voice, relationship stance, secrets, and boundaries."
      },
      "category": "roleplay",
      "tags": ["persona", "voice", "immersion"]
    },
    {
      "id": "rp_player_agency",
      "label": { "zh": "玩家行动权保护", "en": "RP Player Agency" },
      "content": {
        "zh": "绝不替玩家决定行动、情绪、发言或意图。只描述 NPC 和环境，然后留出清晰的行动入口。",
        "en": "Never decide the player's action, emotion, speech, or intention. Describe NPCs and environment, then leave a clear hook for the player."
      },
      "category": "safety",
      "tags": ["agency", "boundary", "player"]
    },
    {
      "id": "rp_continuity",
      "label": { "zh": "RP 连续性", "en": "RP Continuity" },
      "content": {
        "zh": "以世界书事实和长期记忆作为正史。避免矛盾、关系跳跃和未经铺垫的揭示。",
        "en": "Use worldbook facts and long-term memory as canon. Avoid contradictions, sudden relationship jumps, and unexplained reveals."
      },
      "category": "roleplay",
      "tags": ["continuity", "canon", "memory"]
    },
    {
      "id": "rp_slow_burn",
      "label": { "zh": "RP 慢热叙事", "en": "RP Slow Burn" },
      "content": {
        "zh": "悬疑类 RP 每轮只揭示一个有意义的细节。保持紧张感、氛围和未回答的问题。",
        "en": "For mystery roleplay, reveal one meaningful detail per turn. Keep tension, atmosphere, and unanswered questions alive."
      },
      "category": "roleplay",
      "tags": ["slow-burn", "mystery", "tension", "pacing"]
    }
  ]
}
```

- [ ] **Step 2: Verify manifest is valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('F:/1/新建文件夹 (2)/plugins/rp-skills/skill.plugin.json','utf8')); console.log('Valid JSON')"
```

- [ ] **Step 3: Commit**

```bash
git add plugins/rp-skills/skill.plugin.json
git commit -m "feat: add rp-skills plugin with 7 skill definitions

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: 服务端 skill 加载和 /api/skills 端点

**Files:**
- Modify: `apps/web/scripts/serve.mjs`

**Goal:** 新增 `loadSkillPlugins()` 函数、`skillCatalog` 全局变量、`GET /api/skills` 端点，扩展 `GET /api/plugins` 返回 skill 插件。

- [ ] **Step 1: 新增 import 和 loadSkillPlugins 函数**

In `apps/web/scripts/serve.mjs`, add import (after line 3):

```js
import { validateNodePluginManifest, validateSkillPluginManifest } from "@awp/plugin-sdk";
```

Replace the import line 3:
```js
import { validateNodePluginManifest } from "@awp/plugin-sdk";
```

With:
```js
import { validateNodePluginManifest, validateSkillPluginManifest } from "@awp/plugin-sdk";
```

Add `loadSkillPlugins` after `loadNodePlugins` (after line 210):

```js
const loadSkillPlugins = async () => {
  let entries = [];
  try {
    entries = await readdir(pluginsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills = [];

  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const manifestPath = join(pluginsDir, entry.name, "skill.plugin.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const issues = validateSkillPluginManifest(manifest);

      if (issues.length > 0) {
        console.warn(`Skipped skill plugin ${entry.name}: ${issues.join("; ")}`);
        continue;
      }

      if (manifest.enabled === false) {
        continue;
      }

      for (const skill of manifest.skills) {
        skills.push({
          ...skill,
          pluginId: manifest.id,
        });
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(
          `Skipped skill plugin ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return skills;
};
```

- [ ] **Step 2: 新增 skillCatalog 全局变量和加载**

After `loadSkillPlugins` function, add global variable (after line 210, before `let pluginState`):

```js
let skillCatalog = [];
```

After the existing plugin initialization block (after line 259, before `reloadPluginRuntime`):

```js
skillCatalog = await loadSkillPlugins();
```

Update `reloadPluginRuntime` to also reload skills (after line 277):

Add at the end of `reloadPluginRuntime`:
```js
  skillCatalog = await loadSkillPlugins();
```

- [ ] **Step 3: 新增 GET /api/skills 端点**

Add before the `GET /api/plugins` route (before line 643):

```js
if (request.method === "GET" && pathname === "/api/skills") {
  const categories = [...new Set(skillCatalog.map((s) => s.category).filter(Boolean))];
  sendJson(response, 200, {
    skills: skillCatalog,
    categories,
  });
  return;
}
```

- [ ] **Step 4: 扩展 GET /api/plugins 返回 skill 插件**

In the `GET /api/plugins` handler, the current code only iterates `plugins` (node plugins). Add skill plugins by also scanning for `skill.plugin.json` directories. Simpler approach: extend the `/api/plugins` response to include skill plugin summaries.

After the existing `pluginList` construction (after line 666), add skill plugin entries:

```js
// Add skill plugin entries
try {
  const skillDirs = await readdir(pluginsDir, { withFileTypes: true });
  for (const entry of skillDirs.filter((c) => c.isDirectory())) {
    const skillPath = join(pluginsDir, entry.name, "skill.plugin.json");
    try {
      const skillManifest = JSON.parse(await readFile(skillPath, "utf8"));
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
        kind: "skill-plugin",
        manifestEnabled,
        enabled: userOverride ? state.enabled : manifestEnabled,
        stateSource: userOverride ? "user" : "manifest",
        permissions: [],
        dependencies: [],
        compatibility: skillManifest.compatibility ?? null,
        skillCount: skillManifest.skills.length,
      });
    } catch { /* no skill.plugin.json in this dir */ }
  }
} catch { /* ignore read errors */ }
```

- [ ] **Step 5: 在 createExecutors 中使用 skillCatalog**

In `createExecutors`, replace the usage of `sampleSkills` and `samplePlugins` with `skillCatalog`. Find all places where `sampleSkills` is used:

Replace:
```js
availableSkills: sampleSkills,
```

With:
```js
availableSkills: skillCatalog,
```

Do this for all agent node executors: `executeAgent`, `rpDialogueDirector`, `rpContinuityCheck`, and the built-in `agent` node.

Note: `samplePlugins` (the agent tool descriptions like mock_search, memory_read, etc.) are a separate concept from node plugins. They should be kept but renamed to `agentToolDescriptions` for clarity. In this task, keep the existing `samplePlugins` array but consider it legacy agent tool context.

- [ ] **Step 6: Run build and test**

```bash
npm run typecheck
npm run build
```

Fix any type errors.

- [ ] **Step 7: Start server and verify API**

```bash
npm run serve
```

Then in another terminal:
```bash
curl http://127.0.0.1:5180/api/skills
```

Expected: JSON with 7 skills and 4 categories.

```bash
curl http://127.0.0.1:5180/api/plugins
```

Expected: rp-core (kind: node-plugin) + rp-skills (kind: skill-plugin).

- [ ] **Step 8: Commit**

```bash
git add apps/web/scripts/serve.mjs
git commit -m "feat: add loadSkillPlugins and GET /api/skills endpoint

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: 前端 skill 动态加载

**Files:**
- Modify: `apps/web/src/runWorkflowClient.ts`
- Modify: `apps/web/src/App.tsx`

**Goal:** 前端从 `/api/skills` 获取可用 skill 列表，agent 节点配置面板的 skill 字段改为动态加载。

- [ ] **Step 1: 新增前端类型和 API 函数**

In `apps/web/src/runWorkflowClient.ts`, add after existing types:

```ts
export type SkillSummary = {
  id: string;
  label: { zh: string; en: string };
  content: { zh: string; en: string };
  category?: string;
  tags?: string[];
  pluginId: string;
};

export const loadSkillsViaServer = async (
  fetcher: Fetcher = fetch,
): Promise<SkillSummary[] | undefined> => {
  try {
    const response = await fetcher("/api/skills");
    if (!response.ok) return undefined;
    return ((await response.json()) as { skills: SkillSummary[] }).skills;
  } catch {
    return undefined;
  }
};
```

- [ ] **Step 2: 更新 App.tsx 中的 skill 加载**

In `apps/web/src/App.tsx`, add import:

```ts
import { loadSkillsViaServer, type SkillSummary } from "./runWorkflowClient";
```

Add state (after existing `useState` declarations):

```ts
const [skillSummaries, setSkillSummaries] = useState<SkillSummary[]>([]);
```

Add `loadSkills` function (after `loadPlugins`):

```ts
const loadSkills = async () => {
  const loaded = await loadSkillsViaServer();
  if (loaded) setSkillSummaries(loaded);
};
```

Add `void loadSkills();` to the `loadRuntimeConfiguration` useEffect.

- [ ] **Step 3: 更新 agent 节点的 skill config 字段**

The agent node's `skills` config field is currently `kind: "tags"` (free text input). For now, keep it as tags but show available skills as hints. This is a minimal change — full multiselect-from-API can be done later.

No config field change needed in this task. The key change is that `availableSkills` injected into LLM prompts now comes from `skillCatalog` (server-side), not `sampleSkills`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/runWorkflowClient.ts apps/web/src/App.tsx
git commit -m "feat: add frontend skill loading from /api/skills

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: 移除 serve.mjs 硬编码 skill

**Files:**
- Modify: `apps/web/scripts/serve.mjs`

**Goal:** 删除 `sampleSkills` 和 `samplePlugins` 硬编码数组，重命名为 `agentToolDescriptions`。所有 agent 节点改为使用 `skillCatalog`。

- [ ] **Step 1: 删除 sampleSkills，保留 agent tool descriptions**

Delete `sampleSkills` array (lines 17-45). Rename `samplePlugins` to `agentToolDescriptions`:

```js
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
    description: "Provides retrieved worldbook entries as canon setting, character, location, and rule context.",
    tools: [],
  },
  {
    id: "rp_memory_read",
    label: "RP Memory Read",
    description: "Provides long-term roleplay memory such as player preferences, relationship state, promises, and unresolved hooks.",
    tools: [],
  },
];
```

- [ ] **Step 2: 更新所有 agent 节点中的 availableSkills**

In `createExecutors`, replace all `availableSkills: sampleSkills` with `availableSkills: skillCatalog`. Replace all `availablePlugins: samplePlugins` with `availablePlugins: agentToolDescriptions`.

Search and update:
- `executeAgent` context: `availableSkills: skillCatalog`
- `rpDialogueDirector`: `availableSkills: skillCatalog`
- `rpContinuityCheck`: `availableSkills: skillCatalog`
- All `availablePlugins: samplePlugins` → `availablePlugins: agentToolDescriptions`

- [ ] **Step 3: Run build**

```bash
npm run typecheck
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/scripts/serve.mjs
git commit -m "refactor: remove hardcoded sampleSkills, use skillCatalog from plugins

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: 补充 json dataType 兼容对

**Files:**
- Modify: `packages/workflow-core/src/nodeRegistry.ts`

**Goal:** 确保新增节点所需的 dataType 兼容对全部注册。

- [ ] **Step 1: 添加缺失的兼容对**

In `areTypesCompatible` (line 393), the `compatible` set already has many json pairs. Add the two missing ones:

```ts
const compatible = new Set([
  "user_input:json",    // ADD: for userInput → rpInputParser
  "draft:json",         // ADD: for rpDialogueDirector → rpMemoryWrite
  // ... existing pairs kept as-is
  "user_input:text",
  "user_input:context",
  // ... (all existing pairs remain)
]);
```

Insert `"user_input:json"` and `"draft:json"` at the beginning of the Set.

- [ ] **Step 2: Run tests**

```bash
npm run test
```

Expected: all existing tests pass (the workflow-core test suite includes compatibility checks).

- [ ] **Step 3: Commit**

```bash
git add packages/workflow-core/src/nodeRegistry.ts
git commit -m "feat: add user_input:json and draft:json dataType compatibility pairs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: 新增 rpInputParser 节点定义和 executor

**Files:**
- Modify: `plugins/rp-core/node.plugin.json`
- Modify: `plugins/rp-core/executor.mjs`

**Goal:** 注册 rpInputParser 节点，实现 executor。

- [ ] **Step 1: 添加 node 定义到 node.plugin.json**

In `plugins/rp-core/node.plugin.json`, add before the `worldbookSearch` entry in the `nodes` array:

```json
{
  "type": "rpInputParser",
  "label": "RP Input Parser",
  "labelI18n": { "zh": "RP 输入解析", "en": "RP Input Parser" },
  "category": "roleplay",
  "description": "Parse raw player input into structured speech, action, intent, emotion, entities, and triggers.",
  "descriptionI18n": {
    "zh": "将玩家原始输入解析为结构化的发言、动作、意图、情绪、实体和触发词。",
    "en": "Parse raw player input into structured speech, action, intent, emotion, entities, and triggers."
  },
  "color": "#d97706",
  "preview": "Outputs parsed JSON with speech, action, intent, emotion, entities, and triggers.",
  "defaultConfig": {
    "parseRules": "分析玩家输入，提取：发言内容、角色动作、玩家意图、情绪标签、提到的实体名称、潜在触发词。输出JSON。",
    "language": "zh"
  },
  "configFields": [
    {
      "key": "parseRules",
      "label": { "zh": "解析指令", "en": "Parse rules" },
      "kind": "textarea"
    },
    {
      "key": "language",
      "label": { "zh": "语言", "en": "Language" },
      "kind": "select",
      "options": ["zh", "en"]
    }
  ],
  "quickAdd": true,
  "ports": [
    { "id": "text", "label": "Text", "direction": "input", "dataType": "user_input", "required": true },
    { "id": "parsed", "label": "Parsed", "direction": "output", "dataType": "json" }
  ]
}
```

- [ ] **Step 2: 添加 executor 到 executor.mjs**

In `plugins/rp-core/executor.mjs`, add before the `worldbookSearch` function in the returned object:

```js
rpInputParser: async ({ node, inputs }) => {
  const text = String(inputs.text ?? "");
  if (!text.trim()) {
    return {
      outputs: {
        parsed: {
          speech: "",
          action: "",
          intent: "",
          emotion: "",
          entities: [],
          triggers: [],
        },
      },
      metadata: { pluginId: "awp.rp-core" },
    };
  }

  const result = await context.executeAgent({
    nodeId: node.id,
    config: {
      systemPrompt: String(node.config.parseRules ?? "分析玩家输入，提取结构化信息。"),
      skills: [],
      plugins: [],
      outputType: "json",
    },
    inputs: { text },
  });

  try {
    const parsed = JSON.parse(result.text);
    return {
      outputs: {
        parsed: {
          speech: String(parsed.speech ?? ""),
          action: String(parsed.action ?? ""),
          intent: String(parsed.intent ?? ""),
          emotion: String(parsed.emotion ?? ""),
          entities: Array.isArray(parsed.entities) ? parsed.entities.map(String) : [],
          triggers: Array.isArray(parsed.triggers) ? parsed.triggers.map(String) : [],
        },
      },
      metadata: { ...result.metadata, pluginId: "awp.rp-core" },
    };
  } catch {
    return {
      outputs: {
        parsed: {
          speech: text,
          action: "",
          intent: "",
          emotion: "",
          entities: [],
          triggers: [],
        },
      },
      metadata: { pluginId: "awp.rp-core", parseFallback: true },
    };
  }
},
```

- [ ] **Step 3: Run build and test**

```bash
npm run typecheck
npm run build
npm run test
```

- [ ] **Step 4: Commit**

```bash
git add plugins/rp-core/node.plugin.json plugins/rp-core/executor.mjs
git commit -m "feat: add rpInputParser node with structured input parsing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: 新增 rpContextAssembler 节点定义和 executor

**Files:**
- Modify: `plugins/rp-core/node.plugin.json`
- Modify: `plugins/rp-core/executor.mjs`

**Goal:** 注册 rpContextAssembler 节点，实现纯文本模板拼接 executor。

- [ ] **Step 1: 添加 node 定义到 node.plugin.json**

Add after `rpInputParser` in the `nodes` array:

```json
{
  "type": "rpContextAssembler",
  "label": "RP Context Assembler",
  "labelI18n": { "zh": "RP 上下文组装", "en": "RP Context Assembler" },
  "category": "roleplay",
  "description": "Assemble character, scene, worldbook, memory, and parsed input into a structured RP context.",
  "descriptionI18n": {
    "zh": "将角色卡、场景、世界书、记忆和解析后的玩家输入组装成结构化 RP 上下文。",
    "en": "Assemble character card, scene state, worldbook hits, memory recall, and parsed input into structured RP context."
  },
  "color": "#d97706",
  "preview": "Outputs assembled RP context string from all upstream sources.",
  "defaultConfig": {
    "assemblyTemplate": "【角色设定】\n{character}\n\n【当前场景】\n{scene}\n\n【世界书设定】\n{worldbook}\n\n【相关记忆】\n{memory}\n\n【玩家输入解析】\n{parsed}\n\n请基于以上上下文进行角色扮演。",
    "maxTokens": 2000
  },
  "configFields": [
    {
      "key": "assemblyTemplate",
      "label": { "zh": "组装模板", "en": "Assembly template" },
      "kind": "textarea"
    },
    {
      "key": "maxTokens",
      "label": { "zh": "Token 上限", "en": "Max tokens" },
      "kind": "number",
      "min": 500,
      "max": 4000
    }
  ],
  "quickAdd": true,
  "ports": [
    { "id": "parsed", "label": "Parsed", "direction": "input", "dataType": "json" },
    { "id": "character", "label": "Character", "direction": "input", "dataType": "character_profile" },
    { "id": "scene", "label": "Scene", "direction": "input", "dataType": "scene_state" },
    { "id": "worldbook", "label": "Worldbook", "direction": "input", "dataType": "context" },
    { "id": "memory", "label": "Memory", "direction": "input", "dataType": "context" },
    { "id": "context", "label": "Context", "direction": "output", "dataType": "context" }
  ]
}
```

- [ ] **Step 2: 添加 executor 到 executor.mjs**

Add before `rpDialogueDirector`:

```js
rpContextAssembler: async ({ node, inputs }) => {
  const template = String(node.config.assemblyTemplate ?? "{character}\n\n{scene}\n\n{worldbook}\n\n{memory}\n\n{parsed}");

  const formatValue = (key, value) => {
    if (value === undefined || value === null || value === "") return `[${key} 暂未提供]`;
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
  };

  const context = template
    .replace(/\{character\}/g, formatValue("角色卡", inputs.character))
    .replace(/\{scene\}/g, formatValue("场景", inputs.scene))
    .replace(/\{worldbook\}/g, formatValue("世界书", inputs.worldbook))
    .replace(/\{memory\}/g, formatValue("记忆", inputs.memory))
    .replace(/\{parsed\}/g, formatValue("解析输入", inputs.parsed));

  const maxTokens = Number(node.config.maxTokens ?? 2000);
  const truncated = context.length > maxTokens * 4
    ? context.slice(0, maxTokens * 4) + "\n\n[上下文已截断]"
    : context;

  return {
    outputs: { context: truncated },
    metadata: {
      pluginId: "awp.rp-core",
      contextLength: context.length,
      truncated: context.length > maxTokens * 4,
    },
  };
},
```

- [ ] **Step 3: Run build and test**

```bash
npm run typecheck
npm run build
npm run test
```

- [ ] **Step 4: Commit**

```bash
git add plugins/rp-core/node.plugin.json plugins/rp-core/executor.mjs
git commit -m "feat: add rpContextAssembler node for structured context assembly

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: 新增 rpMemoryWrite 节点定义和 executor

**Files:**
- Modify: `plugins/rp-core/node.plugin.json`
- Modify: `plugins/rp-core/executor.mjs`

**Goal:** 注册 rpMemoryWrite 节点，实现 LLM 驱动的记忆候选生成。

- [ ] **Step 1: 添加 node 定义到 node.plugin.json**

Add as the last entry in the `nodes` array:

```json
{
  "type": "rpMemoryWrite",
  "label": "RP Memory Write",
  "labelI18n": { "zh": "RP 记忆写入", "en": "RP Memory Write" },
  "category": "memory",
  "description": "Analyze the turn and generate memory write candidates for relationship changes, preferences, promises, lore, and hooks.",
  "descriptionI18n": {
    "zh": "分析本轮对话，生成记忆写入候选：关系变化、偏好、承诺、设定揭示、未解决伏笔。",
    "en": "Analyze this turn and generate memory write candidates for relationship changes, preferences, promises, lore reveals, and unresolved hooks."
  },
  "color": "#d97706",
  "preview": "Outputs memory candidate JSON array with type, title, content, tags, and priority.",
  "defaultConfig": {
    "autoWrite": false,
    "maxCandidates": 5,
    "memoryTypes": ["relationship", "preference", "promise", "lore", "hook"]
  },
  "configFields": [
    {
      "key": "autoWrite",
      "label": { "zh": "自动写入", "en": "Auto write" },
      "kind": "boolean"
    },
    {
      "key": "maxCandidates",
      "label": { "zh": "最大候选数", "en": "Max candidates" },
      "kind": "number",
      "min": 1,
      "max": 10
    },
    {
      "key": "memoryTypes",
      "label": { "zh": "记忆类型", "en": "Memory types" },
      "kind": "multiselect",
      "options": [
        { "label": { "zh": "关系变化", "en": "Relationship" }, "value": "relationship" },
        { "label": { "zh": "偏好", "en": "Preference" }, "value": "preference" },
        { "label": { "zh": "承诺", "en": "Promise" }, "value": "promise" },
        { "label": { "zh": "设定揭示", "en": "Lore" }, "value": "lore" },
        { "label": { "zh": "伏笔", "en": "Hook" }, "value": "hook" }
      ]
    }
  ],
  "quickAdd": true,
  "ports": [
    { "id": "reply", "label": "Reply", "direction": "input", "dataType": "draft", "required": true },
    { "id": "notes", "label": "Notes", "direction": "input", "dataType": "analysis", "required": true },
    { "id": "parsed", "label": "Parsed", "direction": "input", "dataType": "json" },
    { "id": "state", "label": "State", "direction": "input", "dataType": "scene_state" },
    { "id": "candidates", "label": "Candidates", "direction": "output", "dataType": "json" }
  ]
}
```

- [ ] **Step 2: 添加 executor 到 executor.mjs**

Add at the end of the returned object (before `rpContinuityCheck`):

```js
rpMemoryWrite: async ({ node, inputs }) => {
  const reply = String(inputs.reply ?? "");
  const notes = String(inputs.notes ?? "");
  const parsed = inputs.parsed;
  const memoryTypes = Array.isArray(node.config.memoryTypes)
    ? node.config.memoryTypes.map(String)
    : ["relationship", "preference", "promise", "lore", "hook"];

  if (!reply.trim() && !notes.trim()) {
    return {
      outputs: { candidates: [] },
      metadata: { pluginId: "awp.rp-core", emptyInput: true },
    };
  }

  const result = await context.executeAgent({
    nodeId: node.id,
    config: {
      systemPrompt: [
        "你是 RP 记忆管理助手。分析本轮角色扮演对话，提取值得写入长期记忆的内容。",
        "",
        `启用的记忆类型：${memoryTypes.join("、")}`,
        "",
        "类型说明：",
        "- relationship: 角色之间的关系变化（信任度、亲密感、敌意等）",
        "- preference: 玩家表现出的偏好、习惯或风格",
        "- promise: 角色做出的承诺或约定",
        "- lore: 新揭示的世界观设定或角色背景",
        "- hook: 未解决的伏笔或悬念",
        "",
        "输出格式：严格的 JSON 数组，每个元素包含 type、title、content、tags、priority(1-5)。",
        `最多输出 ${Number(node.config.maxCandidates ?? 5)} 条。`,
        "如果本轮没有值得记录的变化，输出空数组 []。",
      ].join("\n"),
      skills: [],
      plugins: [],
      outputType: "json",
    },
    inputs: {
      reply,
      notes,
      parsed: parsed ? JSON.stringify(parsed) : "",
    },
  });

  try {
    const candidates = JSON.parse(result.text);
    const filtered = (Array.isArray(candidates) ? candidates : [])
      .filter((c) => c && typeof c === "object" && memoryTypes.includes(String(c.type ?? "")))
      .slice(0, Number(node.config.maxCandidates ?? 5))
      .map((c) => ({
        type: String(c.type ?? "lore"),
        title: String(c.title ?? "").slice(0, 120),
        content: String(c.content ?? "").slice(0, 500),
        tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
        priority: Math.max(1, Math.min(5, Number(c.priority ?? 3))),
      }));

    return {
      outputs: { candidates: filtered },
      metadata: {
        ...result.metadata,
        pluginId: "awp.rp-core",
        candidateCount: filtered.length,
      },
    };
  } catch {
    return {
      outputs: { candidates: [] },
      metadata: { pluginId: "awp.rp-core", parseError: true },
    };
  }
},
```

- [ ] **Step 3: Run build and test**

```bash
npm run typecheck
npm run build
npm run test
```

- [ ] **Step 4: Commit**

```bash
git add plugins/rp-core/node.plugin.json plugins/rp-core/executor.mjs
git commit -m "feat: add rpMemoryWrite node for memory candidate generation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: 更新工作流模板

**Files:**
- Modify: `apps/web/src/state/sampleWorkflows.ts`

**Goal:** 新增 `rpFullPipeline` 工作流模板，包含完整的 RP 工作流链路（第一批可用节点）。

- [ ] **Step 1: 新增 rpFullPipeline 模板**

In `apps/web/src/state/sampleWorkflows.ts`, add a new export `rpFullPipeline`:

```ts
export const rpFullPipeline: WorkflowTemplate = {
  id: "rp_full_pipeline",
  name: "RP 完整流水线",
  nameI18n: { zh: "RP 完整流水线", en: "RP Full Pipeline" },
  description: "完整 RP 工作流：输入解析 → 上下文组装 → 对话导演 → 连续性检查 → 记忆写入",
  descriptionI18n: {
    zh: "完整 RP 工作流：输入解析 → 上下文组装 → 对话导演 → 连续性检查 → 记忆写入",
    en: "Full RP workflow: input parsing → context assembly → dialogue director → continuity check → memory write",
  },
  workflow: {
    id: "rp_full_pipeline",
    name: "RP 完整流水线",
    version: 1,
    nodes: [
      { id: "user_1", type: "userInput", position: { x: 100, y: 100 }, config: { text: "" } },
      { id: "parser_1", type: "rpInputParser", position: { x: 360, y: 100 }, config: { language: "zh" } },
      { id: "worldbook_1", type: "worldbookSearch", position: { x: 620, y: 20 }, config: { limit: 4 } },
      { id: "memory_1", type: "memoryRecall", position: { x: 620, y: 180 }, config: { limit: 4 } },
      { id: "char_1", type: "rpCharacterCard", position: { x: 360, y: 280 }, config: {} },
      { id: "scene_1", type: "rpSceneState", position: { x: 100, y: 280 }, config: {} },
      { id: "assembler_1", type: "rpContextAssembler", position: { x: 880, y: 100 }, config: {} },
      { id: "director_1", type: "rpDialogueDirector", position: { x: 1140, y: 100 }, config: {} },
      { id: "check_1", type: "rpContinuityCheck", position: { x: 1400, y: 30 }, config: { strictness: "medium" } },
      { id: "output_1", type: "textOutput", position: { x: 1660, y: 100 }, config: {} },
      { id: "memwrite_1", type: "rpMemoryWrite", position: { x: 1400, y: 230 }, config: { maxCandidates: 5 } },
    ],
    edges: [
      { id: "e1", source: "user_1", sourcePort: "text", target: "parser_1", targetPort: "text" },
      { id: "e2", source: "parser_1", sourcePort: "parsed", target: "worldbook_1", targetPort: "query" },
      { id: "e3", source: "parser_1", sourcePort: "parsed", target: "memory_1", targetPort: "query" },
      { id: "e4", source: "parser_1", sourcePort: "parsed", target: "assembler_1", targetPort: "parsed" },
      { id: "e5", source: "char_1", sourcePort: "profile", target: "assembler_1", targetPort: "character" },
      { id: "e6", source: "scene_1", sourcePort: "state", target: "assembler_1", targetPort: "scene" },
      { id: "e7", source: "worldbook_1", sourcePort: "results", target: "assembler_1", targetPort: "worldbook" },
      { id: "e8", source: "memory_1", sourcePort: "memories", target: "assembler_1", targetPort: "memory" },
      { id: "e9", source: "assembler_1", sourcePort: "context", target: "director_1", targetPort: "memory" },
      { id: "e10", source: "char_1", sourcePort: "profile", target: "director_1", targetPort: "character" },
      { id: "e11", source: "scene_1", sourcePort: "state", target: "director_1", targetPort: "scene" },
      { id: "e12", source: "user_1", sourcePort: "text", target: "director_1", targetPort: "player" },
      { id: "e13", source: "director_1", sourcePort: "reply", target: "check_1", targetPort: "draft" },
      { id: "e14", source: "check_1", sourcePort: "notes", target: "output_1", targetPort: "text" },
      { id: "e15", source: "director_1", sourcePort: "reply", target: "memwrite_1", targetPort: "reply" },
      { id: "e16", source: "check_1", sourcePort: "notes", target: "memwrite_1", targetPort: "notes" },
    ],
  },
};
```

Note: The port type compatibility must be verified. Check:
- `parser_1.parsed` (json) → `worldbook_1.query` (user_input): needs `json:user_input` — NOT registered! This will fail.

Let me reconsider the edge structure. The `parser_1.parsed` is json type, but `worldbookSearch.query` is `user_input` type. We'd need `json:user_input` compatibility.

For the first version, simplify: connect `userInput.text` directly to `worldbookSearch.query` and `memoryRecall.query` (as in the existing `roleplayWorkflow` template). Use `rpInputParser.parsed` only for `rpContextAssembler.parsed`.

Revised edges:

```ts
edges: [
  { id: "e1", source: "user_1", sourcePort: "text", target: "parser_1", targetPort: "text" },
  { id: "e2", source: "user_1", sourcePort: "text", target: "worldbook_1", targetPort: "query" },
  { id: "e3", source: "user_1", sourcePort: "text", target: "memory_1", targetPort: "query" },
  { id: "e4", source: "parser_1", sourcePort: "parsed", target: "assembler_1", targetPort: "parsed" },
  { id: "e5", source: "char_1", sourcePort: "profile", target: "assembler_1", targetPort: "character" },
  { id: "e6", source: "scene_1", sourcePort: "state", target: "assembler_1", targetPort: "scene" },
  { id: "e7", source: "worldbook_1", sourcePort: "results", target: "assembler_1", targetPort: "worldbook" },
  { id: "e8", source: "memory_1", sourcePort: "memories", target: "assembler_1", targetPort: "memory" },
  { id: "e9", source: "assembler_1", sourcePort: "context", target: "director_1", targetPort: "memory" },
  { id: "e10", source: "char_1", sourcePort: "profile", target: "director_1", targetPort: "character" },
  { id: "e11", source: "scene_1", sourcePort: "state", target: "director_1", targetPort: "scene" },
  { id: "e12", source: "user_1", sourcePort: "text", target: "director_1", targetPort: "player" },
  { id: "e13", source: "director_1", sourcePort: "reply", target: "check_1", targetPort: "draft" },
  { id: "e14", source: "director_1", sourcePort: "reply", target: "output_1", targetPort: "text" },
  { id: "e15", source: "director_1", sourcePort: "reply", target: "memwrite_1", targetPort: "reply" },
  { id: "e16", source: "check_1", sourcePort: "notes", target: "memwrite_1", targetPort: "notes" },
],
```

Also check port compatibility:
- `worldbook_1.results` (search_result) → `assembler_1.worldbook` (context): `search_result:context` ✓
- `memory_1.memories` (context) → `assembler_1.memory` (context): same type ✓
- `assembler_1.context` (context) → `director_1.memory` (context): same type ✓
- `director_1.reply` (draft) → `output_1.text` (draft): same type ✓
- `director_1.reply` (draft) → `check_1.draft` (draft): same type ✓
- `director_1.reply` (draft) → `memwrite_1.reply` (draft): same type ✓
- `check_1.notes` (analysis) → `memwrite_1.notes` (analysis): same type ✓
- `parser_1.parsed` (json) → `assembler_1.parsed` (json): same type ✓

All good.

- [ ] **Step 2: Verify template test**

```bash
npx vitest run apps/web/src/state/sampleWorkflows.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/state/sampleWorkflows.ts
git commit -m "feat: add rpFullPipeline workflow template with complete RP chain

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 11: 最终验证

**Files:** None (verification only)

**Goal:** 全量测试 + 构建 + 浏览器手动验证。

- [ ] **Step 1: Run full test suite**

```bash
npm run test
```

Expected: all tests pass (including new skill manifest tests).

- [ ] **Step 2: Run typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: no errors.

- [ ] **Step 3: Verify API endpoints**

```bash
npm run serve
```

```bash
# Check skills API
curl http://127.0.0.1:5180/api/skills

# Check plugins list includes skill plugin
curl http://127.0.0.1:5180/api/plugins

# Check nodes includes new RP nodes
curl http://127.0.0.1:5180/api/nodes
```

- [ ] **Step 4: Browser manual verification**

Open `http://127.0.0.1:5180`:
1. 节点库中出现 `rpInputParser`、`rpContextAssembler`、`rpMemoryWrite`（橘色，roleplay/memory 分类）
2. 加载 `rpFullPipeline` 模板，工作流完整渲染
3. 运行工作流（需要 DEEPSEEK_API_KEY），验证节点输出
4. 插件管理面板显示 rp-skills（kind: skill-plugin）
5. 禁用 rp-core 后，3 个新节点从节点库消失

- [ ] **Step 5: Final commit (if any fixups)**

```bash
git add -A
git commit -m "chore: final verification fixes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
