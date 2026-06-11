# default-rp-workflow-v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable `rp-runtime-v1` node plugin and a tested `default-rp-workflow-v1` sample workflow without modifying core platform code.

**Architecture:** Add a new plugin under `plugins/rp-runtime-v1/` containing manifest-defined RP workflow nodes, a local-module executor, demo read-only data, a workflow JSON template, and plugin-level tests. All state/memory/worldbook data is read-only; generated state and memory changes are emitted as pending candidate patches only.

**Tech Stack:** Node plugin manifest JSON, local-module `executor.mjs`, Vitest `.mjs` tests, existing workflow JSON graph format, existing typed ports/data types.

**Reference:** `docs/superpowers/specs/2026-06-12-default-rp-workflow-v1-design.md`

---

## Scope Guardrails

- Do not modify `apps/web`, `packages/*`, `data/*`, or existing `plugins/rp-core` files.
- Only create files inside `plugins/rp-runtime-v1/` and optionally add a validation report under `docs/reports/`.
- Do not write to formal state, worldbook, memories, or project-level data files from any executor.
- Candidate patches must be emitted as outputs/metadata only.
- `default-rp-workflow-v1` must be a workflow JSON file, not hardcoded into UI or runtime.

## File Map

Create these files:

```text
plugins/rp-runtime-v1/node.plugin.json
plugins/rp-runtime-v1/executor.mjs
plugins/rp-runtime-v1/executor.test.mjs
plugins/rp-runtime-v1/demo/characters.json
plugins/rp-runtime-v1/demo/scenes.json
plugins/rp-runtime-v1/demo/worldbook.json
plugins/rp-runtime-v1/demo/memories.json
plugins/rp-runtime-v1/workflows/default-rp-workflow-v1.json
docs/reports/default-rp-workflow-v1-run.md
```

No existing files should be modified for the first implementation pass.

---

## Task 1: Add read-only demo RP data

**Files:**

- Create: `plugins/rp-runtime-v1/demo/characters.json`
- Create: `plugins/rp-runtime-v1/demo/scenes.json`
- Create: `plugins/rp-runtime-v1/demo/worldbook.json`
- Create: `plugins/rp-runtime-v1/demo/memories.json`

- [ ] **Step 1: Create `characters.json`**

```json
[
  {
    "id": "senior_sister",
    "name": "沈青璃",
    "description": "外门大师姐，冷静克制，在师门中以剑术和自律闻名。",
    "personality": "压抑情绪，习惯转移话题。越在意某人，越会用冷静和距离感掩饰。",
    "scenario": "傍晚演武场，玩家发现她刚才刻意避开自己。",
    "voice": "短句、含蓄、克制，偶尔用反问回避真正答案。",
    "boundaries": ["不替玩家行动", "不替玩家说话", "不直接揭开核心秘密", "不突然亲密或关系跳跃"],
    "exampleDialogue": ["“你总是问得太直接。”", "“有些事，不知道反而安全。”"],
    "systemPromptHints": [
      "保持师姐视角",
      "回避但不冷漠",
      "每轮只透露一个关键细节",
      "保留玩家下一步选择"
    ]
  }
]
```

- [ ] **Step 2: Create `scenes.json`**

```json
[
  {
    "sessionId": "demo_session",
    "sceneId": "training_hall_evening",
    "location": "傍晚的演武场",
    "time": "黄昏后",
    "mood": "压低声音、若即若离、未说出口的担忧",
    "activeCharacters": ["senior_sister"],
    "stakes": "玩家察觉师姐刻意回避，但她似乎有不能明说的理由。",
    "visibleFacts": ["演武场已经空了", "师姐刚才避开玩家视线", "远处禁地的钟声响过一次"],
    "hiddenFacts": ["师姐曾私自进入禁地", "她担心玩家也被卷入旧案"]
  }
]
```

- [ ] **Step 3: Create `worldbook.json`**

```json
[
  {
    "id": "wb_senior_sister_avoidance",
    "title": "师姐的回避",
    "keys": ["师姐", "躲着", "回避", "低声问"],
    "content": "沈青璃在提到禁地调查时会刻意回避，因为她曾私自进入过禁地。她不是不信任玩家，而是不想让玩家继续追问会带来危险的问题。",
    "priority": 90,
    "enabled": true,
    "tags": ["角色", "关系", "禁地"]
  },
  {
    "id": "wb_forbidden_ground_case",
    "title": "禁地旧案",
    "keys": ["禁地", "钟声", "旧案", "演武场"],
    "content": "三年前，禁地钟声在无人敲响时响过七次。之后一名内门弟子失踪，门内将此事压下。沈青璃曾暗中调查此事。",
    "priority": 80,
    "enabled": true,
    "tags": ["世界观", "悬疑", "禁地"]
  },
  {
    "id": "wb_player_agency_rule",
    "title": "玩家行动权规则",
    "keys": ["问", "走到", "行动", "玩家"],
    "content": "回复中只能描写 NPC、环境和 NPC 对玩家行动的反应，不能替玩家决定动作、情绪、台词或意图。每轮回复必须留下一个清晰可回应的钩子。",
    "priority": 100,
    "enabled": true,
    "tags": ["规则", "玩家行动权"]
  }
]
```

- [ ] **Step 4: Create `memories.json`**

```json
[
  {
    "id": "mem_senior_sister_recent_distance",
    "type": "relationship",
    "sessionId": "demo_session",
    "characterId": "senior_sister",
    "title": "师姐最近的距离感",
    "content": "最近两次互动中，沈青璃在玩家靠近时转移话题，但并未真正拒绝玩家。她的回避更像是在保护玩家。",
    "tags": ["师姐", "关系", "回避"],
    "updatedAt": "2026-06-12T00:00:00.000Z"
  },
  {
    "id": "mem_player_direct_questioning",
    "type": "preference",
    "sessionId": "demo_session",
    "characterId": "senior_sister",
    "title": "玩家倾向直接追问",
    "content": "玩家在关键情节中倾向于直接询问对方隐藏的原因，但通常会保持低声和克制。",
    "tags": ["玩家偏好", "追问", "克制"],
    "updatedAt": "2026-06-12T00:00:00.000Z"
  }
]
```

- [ ] **Step 5: Verify JSON validity**

Run:

```bash
node -e "for (const f of ['characters','scenes','worldbook','memories']) JSON.parse(require('fs').readFileSync(`plugins/rp-runtime-v1/demo/${f}.json`, 'utf8')); console.log('demo json ok')"
```

Expected:

```text
demo json ok
```

- [ ] **Step 6: Commit**

```bash
git add plugins/rp-runtime-v1/demo
git commit -m "feat(rp-runtime): add read-only demo RP data"
```

---

## Task 2: Add `rp-runtime-v1` node plugin manifest

**Files:**

- Create: `plugins/rp-runtime-v1/node.plugin.json`

- [ ] **Step 1: Write the manifest**

```json
{
  "schemaVersion": 1,
  "id": "awp.rp-runtime-v1",
  "label": "RP Runtime v1 Nodes",
  "version": "0.1.0",
  "description": "Reusable workflow RP nodes for read-only context loading, RP Agent generation, pending candidate patches, and debug rendering.",
  "author": "Agent Workflow Platform",
  "enabled": true,
  "compatibility": {
    "app": ">=0.1.0",
    "workflowSchema": 1
  },
  "permissions": ["model:call"],
  "dependencies": [],
  "executor": {
    "adapter": "local-module",
    "entry": "./executor.mjs"
  },
  "nodes": [
    {
      "type": "rpInputParserV1",
      "label": "RP Input Parser V1",
      "labelI18n": { "zh": "RP 输入解析 V1", "en": "RP Input Parser V1" },
      "category": "roleplay",
      "description": "Parse the player's current RP action into structured intent, tone, targets, and trigger terms.",
      "descriptionI18n": {
        "zh": "解析玩家本轮 RP 行为、意图、语气、目标对象和触发词。",
        "en": "Parse the player's current RP action into structured intent, tone, targets, and trigger terms."
      },
      "color": "#d97706",
      "preview": "userInput -> parsedInput JSON",
      "quickAdd": true,
      "defaultConfig": { "language": "zh", "parserMode": "rule" },
      "configFields": [
        {
          "key": "language",
          "label": { "zh": "语言", "en": "Language" },
          "kind": "select",
          "options": ["zh", "en"]
        },
        {
          "key": "parserMode",
          "label": { "zh": "解析模式", "en": "Parser mode" },
          "kind": "select",
          "options": ["rule"]
        }
      ],
      "ports": [
        {
          "id": "userInput",
          "label": "User Input",
          "direction": "input",
          "dataType": "user_input",
          "required": true
        },
        { "id": "parsedInput", "label": "Parsed Input", "direction": "output", "dataType": "json" }
      ]
    },
    {
      "type": "characterCardLoaderV1",
      "label": "Character Card Loader V1",
      "labelI18n": { "zh": "角色卡读取 V1", "en": "Character Card Loader V1" },
      "category": "roleplay",
      "description": "Read a demo character card by characterId without modifying it.",
      "descriptionI18n": {
        "zh": "按 characterId 只读 demo 角色卡，不修改角色卡。",
        "en": "Read a demo character card by characterId without modifying it."
      },
      "color": "#8f526b",
      "preview": "characterId -> characterProfile",
      "quickAdd": true,
      "defaultConfig": { "characterId": "senior_sister" },
      "configFields": [
        {
          "key": "characterId",
          "label": { "zh": "角色 ID", "en": "Character ID" },
          "kind": "text",
          "required": true
        }
      ],
      "ports": [
        { "id": "characterId", "label": "Character ID", "direction": "input", "dataType": "text" },
        {
          "id": "characterProfile",
          "label": "Character Profile",
          "direction": "output",
          "dataType": "character_profile"
        }
      ]
    },
    {
      "type": "sceneStateReaderV1",
      "label": "Scene State Reader V1",
      "labelI18n": { "zh": "场景状态读取 V1", "en": "Scene State Reader V1" },
      "category": "roleplay",
      "description": "Read a demo scene state by sessionId and sceneId without modifying formal state.",
      "descriptionI18n": {
        "zh": "按 sessionId 和 sceneId 只读 demo 场景状态，不修改正式状态。",
        "en": "Read a demo scene state by sessionId and sceneId without modifying formal state."
      },
      "color": "#596d87",
      "preview": "sessionId + sceneId -> sceneState",
      "quickAdd": true,
      "defaultConfig": { "sessionId": "demo_session", "sceneId": "training_hall_evening" },
      "configFields": [
        {
          "key": "sessionId",
          "label": { "zh": "会话 ID", "en": "Session ID" },
          "kind": "text",
          "required": true
        },
        {
          "key": "sceneId",
          "label": { "zh": "场景 ID", "en": "Scene ID" },
          "kind": "text",
          "required": true
        }
      ],
      "ports": [
        { "id": "sessionId", "label": "Session ID", "direction": "input", "dataType": "text" },
        { "id": "sceneId", "label": "Scene ID", "direction": "input", "dataType": "text" },
        {
          "id": "sceneState",
          "label": "Scene State",
          "direction": "output",
          "dataType": "scene_state"
        }
      ]
    },
    {
      "type": "worldbookSearchV1",
      "label": "Worldbook Search V1",
      "labelI18n": { "zh": "世界书检索 V1", "en": "Worldbook Search V1" },
      "category": "knowledge",
      "description": "Search demo worldbook entries using parsed input, character profile, and scene state.",
      "descriptionI18n": {
        "zh": "基于 parsedInput、角色卡和场景状态检索 demo 世界书条目。",
        "en": "Search demo worldbook entries using parsed input, character profile, and scene state."
      },
      "color": "#2f7d6d",
      "preview": "parsedInput + characterProfile + sceneState -> loreContext + usedWorldbookEntries",
      "quickAdd": true,
      "defaultConfig": { "limit": 4 },
      "configFields": [
        {
          "key": "limit",
          "label": { "zh": "条目数量", "en": "Entry limit" },
          "kind": "number",
          "min": 1,
          "max": 10
        }
      ],
      "ports": [
        {
          "id": "parsedInput",
          "label": "Parsed Input",
          "direction": "input",
          "dataType": "json",
          "required": true
        },
        {
          "id": "characterProfile",
          "label": "Character Profile",
          "direction": "input",
          "dataType": "character_profile"
        },
        {
          "id": "sceneState",
          "label": "Scene State",
          "direction": "input",
          "dataType": "scene_state"
        },
        {
          "id": "loreContext",
          "label": "Lore Context",
          "direction": "output",
          "dataType": "context"
        },
        {
          "id": "usedWorldbookEntries",
          "label": "Used Worldbook Entries",
          "direction": "output",
          "dataType": "json"
        }
      ]
    },
    {
      "type": "memoryRecallV1",
      "label": "Memory Recall V1",
      "labelI18n": { "zh": "记忆召回 V1", "en": "Memory Recall V1" },
      "category": "memory",
      "description": "Recall demo memories using parsed input, sessionId, and characterId. Read-only.",
      "descriptionI18n": {
        "zh": "基于 parsedInput、sessionId 和 characterId 召回 demo 记忆，只读不写入。",
        "en": "Recall demo memories using parsed input, sessionId, and characterId. Read-only."
      },
      "color": "#7b5ea7",
      "preview": "parsedInput + sessionId + characterId -> memoryContext + recalledMemories",
      "quickAdd": true,
      "defaultConfig": { "sessionId": "demo_session", "characterId": "senior_sister", "limit": 4 },
      "configFields": [
        {
          "key": "sessionId",
          "label": { "zh": "会话 ID", "en": "Session ID" },
          "kind": "text",
          "required": true
        },
        {
          "key": "characterId",
          "label": { "zh": "角色 ID", "en": "Character ID" },
          "kind": "text",
          "required": true
        },
        {
          "key": "limit",
          "label": { "zh": "记忆数量", "en": "Memory limit" },
          "kind": "number",
          "min": 1,
          "max": 10
        }
      ],
      "ports": [
        {
          "id": "parsedInput",
          "label": "Parsed Input",
          "direction": "input",
          "dataType": "json",
          "required": true
        },
        { "id": "sessionId", "label": "Session ID", "direction": "input", "dataType": "text" },
        { "id": "characterId", "label": "Character ID", "direction": "input", "dataType": "text" },
        {
          "id": "memoryContext",
          "label": "Memory Context",
          "direction": "output",
          "dataType": "context"
        },
        {
          "id": "recalledMemories",
          "label": "Recalled Memories",
          "direction": "output",
          "dataType": "json"
        }
      ]
    },
    {
      "type": "rpContextAssemblerV1",
      "label": "RP Context Assembler V1",
      "labelI18n": { "zh": "RP 上下文组装 V1", "en": "RP Context Assembler V1" },
      "category": "roleplay",
      "description": "Assemble structured prompt blocks for the RP Agent.",
      "descriptionI18n": {
        "zh": "为 RP Agent 组装结构化 prompt blocks。",
        "en": "Assemble structured prompt blocks for the RP Agent."
      },
      "color": "#d97706",
      "preview": "context parts -> rpContextBundle JSON",
      "quickAdd": true,
      "defaultConfig": { "includeDebugPreview": true },
      "configFields": [
        {
          "key": "includeDebugPreview",
          "label": { "zh": "包含调试预览", "en": "Include debug preview" },
          "kind": "boolean"
        }
      ],
      "ports": [
        {
          "id": "parsedInput",
          "label": "Parsed Input",
          "direction": "input",
          "dataType": "json",
          "required": true
        },
        {
          "id": "characterProfile",
          "label": "Character Profile",
          "direction": "input",
          "dataType": "character_profile",
          "required": true
        },
        {
          "id": "sceneState",
          "label": "Scene State",
          "direction": "input",
          "dataType": "scene_state",
          "required": true
        },
        {
          "id": "loreContext",
          "label": "Lore Context",
          "direction": "input",
          "dataType": "context"
        },
        {
          "id": "memoryContext",
          "label": "Memory Context",
          "direction": "input",
          "dataType": "context"
        },
        {
          "id": "rpContextBundle",
          "label": "RP Context Bundle",
          "direction": "output",
          "dataType": "json"
        }
      ]
    },
    {
      "type": "rpDialogueDirectorV1",
      "label": "RP Dialogue Director V1",
      "labelI18n": { "zh": "RP 对话导演 V1", "en": "RP Dialogue Director V1" },
      "category": "roleplay",
      "description": "Single core RP Agent that generates replyDraft and pending candidate patches.",
      "descriptionI18n": {
        "zh": "单核心 RP Agent，生成回复草稿和 pending 候选补丁。",
        "en": "Single core RP Agent that generates replyDraft and pending candidate patches."
      },
      "panelLayout": "agent",
      "color": "#9a6a3d",
      "preview": "rpContextBundle -> replyDraft + candidate patches",
      "quickAdd": true,
      "defaultConfig": {
        "agentRole": "dialogue_director",
        "model": "deepseek-v4-flash",
        "replyRules": "保持角色、保留玩家行动权、每轮只推进一个关键变化。",
        "outputMode": "reply_with_candidate_patches",
        "collaborationMode": "single",
        "skills": ["rp_persona", "rp_player_agency", "rp_continuity", "rp_slow_burn"]
      },
      "configFields": [
        {
          "key": "agentRole",
          "label": { "zh": "Agent 角色", "en": "Agent role" },
          "kind": "text",
          "required": true
        },
        {
          "key": "model",
          "label": { "zh": "模型", "en": "Model" },
          "kind": "select",
          "options": ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-reasoner", "mock-pro"]
        },
        {
          "key": "replyRules",
          "label": { "zh": "回复规则", "en": "Reply rules" },
          "kind": "textarea"
        },
        {
          "key": "outputMode",
          "label": { "zh": "输出模式", "en": "Output mode" },
          "kind": "select",
          "options": ["reply_with_candidate_patches"]
        },
        {
          "key": "collaborationMode",
          "label": { "zh": "协作模式", "en": "Collaboration mode" },
          "kind": "select",
          "options": ["single"]
        },
        { "key": "skills", "label": { "zh": "Skills", "en": "Skills" }, "kind": "tags" }
      ],
      "ports": [
        {
          "id": "rpContextBundle",
          "label": "RP Context Bundle",
          "direction": "input",
          "dataType": "json",
          "required": true
        },
        { "id": "replyDraft", "label": "Reply Draft", "direction": "output", "dataType": "draft" },
        {
          "id": "candidateStatePatch",
          "label": "Candidate State Patch",
          "direction": "output",
          "dataType": "json"
        },
        {
          "id": "candidateMemoryPatch",
          "label": "Candidate Memory Patch",
          "direction": "output",
          "dataType": "json"
        }
      ]
    },
    {
      "type": "rpOutputRendererV1",
      "label": "RP Output Renderer V1",
      "labelI18n": { "zh": "RP 输出渲染 V1", "en": "RP Output Renderer V1" },
      "category": "roleplay",
      "description": "Render final reply, pending patches, used context, and debug log.",
      "descriptionI18n": {
        "zh": "渲染最终回复、pending patches、使用的上下文和 debug log。",
        "en": "Render final reply, pending patches, used context, and debug log."
      },
      "panelLayout": "output",
      "color": "#dc2626",
      "preview": "replyDraft + debug data -> finalOutput + reply + debugLog",
      "quickAdd": true,
      "defaultConfig": { "includePendingPatches": true, "includeDebugLog": true },
      "configFields": [
        {
          "key": "includePendingPatches",
          "label": { "zh": "包含候选补丁", "en": "Include pending patches" },
          "kind": "boolean"
        },
        {
          "key": "includeDebugLog",
          "label": { "zh": "包含 Debug Log", "en": "Include debug log" },
          "kind": "boolean"
        }
      ],
      "ports": [
        {
          "id": "replyDraft",
          "label": "Reply Draft",
          "direction": "input",
          "dataType": "draft",
          "required": true
        },
        {
          "id": "candidateStatePatch",
          "label": "Candidate State Patch",
          "direction": "input",
          "dataType": "json"
        },
        {
          "id": "candidateMemoryPatch",
          "label": "Candidate Memory Patch",
          "direction": "input",
          "dataType": "json"
        },
        {
          "id": "usedWorldbookEntries",
          "label": "Used Worldbook Entries",
          "direction": "input",
          "dataType": "json"
        },
        {
          "id": "recalledMemories",
          "label": "Recalled Memories",
          "direction": "input",
          "dataType": "json"
        },
        {
          "id": "sceneState",
          "label": "Scene State",
          "direction": "input",
          "dataType": "scene_state"
        },
        { "id": "reply", "label": "Reply", "direction": "output", "dataType": "final_text" },
        { "id": "finalOutput", "label": "Final Output", "direction": "output", "dataType": "json" },
        { "id": "debugLog", "label": "Debug Log", "direction": "output", "dataType": "debug_info" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Validate manifest via Node script**

Run:

```bash
node --input-type=module -e "import { validateNodePluginManifest } from './packages/plugin-sdk/dist/index.js'; const manifest = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile('plugins/rp-runtime-v1/node.plugin.json','utf8'))); const issues = validateNodePluginManifest(manifest); if (issues.length) { console.error(issues); process.exit(1); } console.log('manifest ok')"
```

If `packages/plugin-sdk/dist/index.js` does not exist yet, run:

```bash
npm --workspace @awp/plugin-sdk run build
```

Expected:

```text
manifest ok
```

- [ ] **Step 3: Commit**

```bash
git add plugins/rp-runtime-v1/node.plugin.json
git commit -m "feat(rp-runtime): add node plugin manifest"
```

---

## Task 3: Add executor helpers and context readers

**Files:**

- Create: `plugins/rp-runtime-v1/executor.mjs`
- Create: `plugins/rp-runtime-v1/executor.test.mjs`

- [ ] **Step 1: Create failing tests for data loading and shared debug shape**

Create `plugins/rp-runtime-v1/executor.test.mjs` with this initial content:

```js
import { describe, expect, test } from "vitest";
import { createExecutors } from "./executor.mjs";

const createMockContext = () => ({
  executeAgent: async ({ nodeId, inputs }) => ({
    text: JSON.stringify({
      agentRole: "dialogue_director",
      agentId: nodeId,
      replyDraft: "沈青璃没有立刻回答。她把袖口从你指尖能碰到的距离移开一点，却没有再退后。",
      candidateStatePatch: {
        target: { sessionId: "demo_session", sceneId: "training_hall_evening" },
        patches: [
          {
            op: "suggest",
            path: "relationship.senior_sister.tension",
            value: "increase",
            reason: "玩家察觉并追问师姐回避。",
          },
        ],
        commitPolicy: "pending",
      },
      candidateMemoryPatch: {
        target: { sessionId: "demo_session", characterId: "senior_sister" },
        candidates: [
          {
            type: "relationship",
            title: "玩家追问师姐回避",
            content: "玩家走到师姐身边，低声询问她刚才为什么躲着自己。",
            tags: ["师姐", "回避", "关系"],
            priority: 3,
            commitPolicy: "pending",
          },
        ],
      },
      rationale: {
        usedBlocks: ["character", "scene", "worldbook", "memory", "player_input"],
        styleChoices: ["克制", "低声", "保留悬念"],
        safetyChecks: ["未替玩家行动", "未直接揭示全部秘密"],
      },
    }),
    metadata: { provider: "mock" },
  }),
});

describe("rp-runtime-v1 executor", () => {
  test("createExecutors exposes all node executors", async () => {
    const executors = await createExecutors(createMockContext());
    expect(Object.keys(executors).sort()).toEqual([
      "characterCardLoaderV1",
      "memoryRecallV1",
      "rpContextAssemblerV1",
      "rpDialogueDirectorV1",
      "rpInputParserV1",
      "rpOutputRendererV1",
      "sceneStateReaderV1",
      "worldbookSearchV1",
    ]);
  });

  test("characterCardLoaderV1 reads demo character without writing state", async () => {
    const executors = await createExecutors(createMockContext());
    const result = await executors.characterCardLoaderV1({
      node: {
        id: "character_1",
        type: "characterCardLoaderV1",
        config: { characterId: "senior_sister" },
      },
      inputs: {},
    });
    expect(result.outputs.characterProfile.id).toBe("senior_sister");
    expect(result.outputs.characterProfile.name).toBe("沈青璃");
    expect(result.metadata.pluginId).toBe("awp.rp-runtime-v1");
    expect(result.metadata.debug.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run plugins/rp-runtime-v1/executor.test.mjs
```

Expected: FAIL because `executor.mjs` does not exist.

- [ ] **Step 3: Implement executor helpers and loader nodes**

Create `plugins/rp-runtime-v1/executor.mjs` with this initial implementation:

```js
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = dirname(fileURLToPath(import.meta.url));
const demoDir = join(pluginDir, "demo");

const readJson = async (relativePath) =>
  JSON.parse(await readFile(join(pluginDir, relativePath), "utf8"));

const elapsed = (start) => Date.now() - start;

const summarize = (value, max = 180) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const createMetadata = ({
  nodeId,
  inputSummary,
  outputSummary,
  durationMs,
  error = null,
  extraViews = [],
}) => ({
  pluginId: "awp.rp-runtime-v1",
  debug: { nodeId, inputSummary, outputSummary, durationMs, error },
  views: [
    {
      id: "trace",
      kind: "trace",
      title: "节点执行轨迹",
      steps: [
        {
          label: "执行节点",
          status: error ? "error" : "success",
          detail: error ? String(error) : outputSummary,
          durationMs,
        },
      ],
    },
    { id: "input_summary", kind: "object", title: "输入摘要", value: { summary: inputSummary } },
    { id: "output_summary", kind: "object", title: "输出摘要", value: { summary: outputSummary } },
    ...extraViews,
  ],
});

const normalizeText = (value) => String(value ?? "").trim();

const readCharacters = () => readJson("demo/characters.json");
const readScenes = () => readJson("demo/scenes.json");
const readWorldbook = () => readJson("demo/worldbook.json");
const readMemories = () => readJson("demo/memories.json");

const pickById = (entries, key, id, fallbackId) =>
  entries.find((entry) => String(entry[key]) === String(id || fallbackId)) ??
  entries.find((entry) => String(entry[key]) === String(fallbackId)) ??
  entries[0];

const tokenize = (value) => {
  const text = normalizeText(value).toLowerCase();
  const words = text.match(/[a-z0-9_]+/g) ?? [];
  const chars = Array.from(text).filter((char) => /[一-鿿]/.test(char));
  return [...new Set([...words, ...chars])];
};

const collectQueryText = (...values) => values.map((value) => summarize(value, 400)).join("\n");

const scoreWorldbookEntry = (entry, queryText) => {
  const keys = Array.isArray(entry.keys) ? entry.keys.map(String) : [];
  const matchedKeys = keys.filter((key) => queryText.includes(key));
  const tokenSet = new Set(tokenize(queryText));
  const tokenHits = tokenize(
    `${entry.title} ${entry.content} ${(entry.tags ?? []).join(" ")}`,
  ).filter((token) => tokenSet.has(token)).length;
  return {
    entry,
    matchedKeys,
    score: matchedKeys.length * 10 + tokenHits + Number(entry.priority ?? 0) / 100,
  };
};

const scoreMemory = (memory, queryText, sessionId, characterId) => {
  const tokenSet = new Set(tokenize(queryText));
  const tokenHits = tokenize(
    `${memory.title} ${memory.content} ${(memory.tags ?? []).join(" ")}`,
  ).filter((token) => tokenSet.has(token)).length;
  const sessionBonus = !sessionId || memory.sessionId === sessionId ? 2 : 0;
  const characterBonus = !characterId || memory.characterId === characterId ? 2 : 0;
  return { memory, score: tokenHits + sessionBonus + characterBonus };
};

const parseUserInput = (rawText) => {
  const text = normalizeText(rawText);
  const speechMatch = text.match(/[“\"](.+?)[”\"]/) || text.match(/问她(.+?)[。！？!?]?$/);
  const speech = speechMatch ? normalizeText(speechMatch[1]) : "";
  const targets = ["师姐", "沈青璃"].filter((target) => text.includes(target));
  const triggers = ["躲", "回避", "低声", "禁地", "钟声"].filter((trigger) =>
    text.includes(trigger),
  );
  return {
    rawText: text,
    speech: speech || (text.includes("问") ? text.slice(Math.max(0, text.indexOf("问"))) : ""),
    action: text.replace(speech, "").trim() || text,
    intent: text.includes("为什么") || text.includes("为何") ? "追问原因" : "推进互动",
    tone: text.includes("低声") ? "低声、谨慎、带关切" : "克制、试探",
    targets,
    entities: targets,
    triggers,
  };
};

export const createExecutors = async (context = {}) => ({
  rpInputParserV1: async ({ node, inputs }) => {
    const start = Date.now();
    const rawText = normalizeText(inputs.userInput ?? inputs.text ?? node.config.text);
    const parsedInput = parseUserInput(rawText);
    return {
      outputs: { parsedInput },
      metadata: createMetadata({
        nodeId: node.id,
        inputSummary: `rawText=${summarize(rawText)}`,
        outputSummary: `intent=${parsedInput.intent}; targets=${parsedInput.targets.join(",") || "none"}`,
        durationMs: elapsed(start),
      }),
    };
  },

  characterCardLoaderV1: async ({ node, inputs }) => {
    const start = Date.now();
    const characterId = normalizeText(
      inputs.characterId ?? node.config.characterId ?? "senior_sister",
    );
    const characters = await readCharacters();
    const characterProfile = pickById(characters, "id", characterId, "senior_sister");
    return {
      outputs: { characterProfile },
      metadata: createMetadata({
        nodeId: node.id,
        inputSummary: `characterId=${characterId}`,
        outputSummary: `character=${characterProfile.name}`,
        durationMs: elapsed(start),
        extraViews: [
          { id: "character_profile", kind: "object", title: "角色卡", value: characterProfile },
        ],
      }),
    };
  },

  sceneStateReaderV1: async ({ node, inputs }) => {
    const start = Date.now();
    const sessionId = normalizeText(inputs.sessionId ?? node.config.sessionId ?? "demo_session");
    const sceneId = normalizeText(inputs.sceneId ?? node.config.sceneId ?? "training_hall_evening");
    const scenes = await readScenes();
    const sceneState =
      scenes.find((scene) => scene.sessionId === sessionId && scene.sceneId === sceneId) ??
      scenes.find((scene) => scene.sceneId === sceneId) ??
      scenes[0];
    return {
      outputs: { sceneState },
      metadata: createMetadata({
        nodeId: node.id,
        inputSummary: `sessionId=${sessionId}; sceneId=${sceneId}`,
        outputSummary: `scene=${sceneState.location}`,
        durationMs: elapsed(start),
        extraViews: [{ id: "scene_state", kind: "object", title: "场景状态", value: sceneState }],
      }),
    };
  },
});
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
npx vitest run plugins/rp-runtime-v1/executor.test.mjs
```

Expected: PASS, 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add plugins/rp-runtime-v1/executor.mjs plugins/rp-runtime-v1/executor.test.mjs
git commit -m "feat(rp-runtime): add executor helpers and read-only loader nodes"
```

---

## Task 4: Implement parser, worldbook search, memory recall, and context assembler tests

**Files:**

- Modify: `plugins/rp-runtime-v1/executor.mjs`
- Modify: `plugins/rp-runtime-v1/executor.test.mjs`

- [ ] **Step 1: Add tests**

Append these tests to `plugins/rp-runtime-v1/executor.test.mjs`:

```js
test("rpInputParserV1 parses player input into structured data", async () => {
  const executors = await createExecutors(createMockContext());
  const result = await executors.rpInputParserV1({
    node: { id: "parser_1", type: "rpInputParserV1", config: {} },
    inputs: { userInput: "我走到师姐身边，低声问她刚才为什么躲着我。" },
  });
  expect(result.outputs.parsedInput.rawText).toContain("师姐");
  expect(result.outputs.parsedInput.targets).toContain("师姐");
  expect(result.outputs.parsedInput.triggers).toContain("低声");
  expect(result.metadata.debug.outputSummary).toContain("targets=师姐");
});

test("sceneStateReaderV1 reads demo scene without writing formal state", async () => {
  const executors = await createExecutors(createMockContext());
  const result = await executors.sceneStateReaderV1({
    node: {
      id: "scene_1",
      type: "sceneStateReaderV1",
      config: { sessionId: "demo_session", sceneId: "training_hall_evening" },
    },
    inputs: {},
  });
  expect(result.outputs.sceneState.sceneId).toBe("training_hall_evening");
  expect(result.outputs.sceneState.location).toContain("演武场");
});

test("worldbookSearchV1 returns lore context and used entries", async () => {
  const executors = await createExecutors(createMockContext());
  const parsedInput = {
    rawText: "我走到师姐身边，低声问她刚才为什么躲着我。",
    targets: ["师姐"],
    triggers: ["躲着", "低声问"],
  };
  const character = (
    await executors.characterCardLoaderV1({
      node: {
        id: "character_1",
        type: "characterCardLoaderV1",
        config: { characterId: "senior_sister" },
      },
      inputs: {},
    })
  ).outputs.characterProfile;
  const scene = (
    await executors.sceneStateReaderV1({
      node: { id: "scene_1", type: "sceneStateReaderV1", config: {} },
      inputs: {},
    })
  ).outputs.sceneState;

  const result = await executors.worldbookSearchV1({
    node: { id: "worldbook_1", type: "worldbookSearchV1", config: { limit: 4 } },
    inputs: { parsedInput, characterProfile: character, sceneState: scene },
  });
  expect(result.outputs.loreContext).toContain("沈青璃");
  expect(result.outputs.usedWorldbookEntries.length).toBeGreaterThan(0);
  expect(result.outputs.usedWorldbookEntries[0].id).toBe("wb_senior_sister_avoidance");
});

test("memoryRecallV1 returns memory context and recalled memories", async () => {
  const executors = await createExecutors(createMockContext());
  const result = await executors.memoryRecallV1({
    node: {
      id: "memory_1",
      type: "memoryRecallV1",
      config: { sessionId: "demo_session", characterId: "senior_sister", limit: 4 },
    },
    inputs: {
      parsedInput: { rawText: "我走到师姐身边，低声问她刚才为什么躲着我。", triggers: ["躲着"] },
    },
  });
  expect(result.outputs.memoryContext).toContain("师姐");
  expect(result.outputs.recalledMemories.length).toBeGreaterThan(0);
  expect(result.outputs.recalledMemories[0].reason).toBeTruthy();
});

test("rpContextAssemblerV1 creates reusable prompt blocks", async () => {
  const executors = await createExecutors(createMockContext());
  const parsedInput = { rawText: "我走到师姐身边，低声问她刚才为什么躲着我。", targets: ["师姐"] };
  const characterProfile = (
    await executors.characterCardLoaderV1({
      node: {
        id: "character_1",
        type: "characterCardLoaderV1",
        config: { characterId: "senior_sister" },
      },
      inputs: {},
    })
  ).outputs.characterProfile;
  const sceneState = (
    await executors.sceneStateReaderV1({
      node: { id: "scene_1", type: "sceneStateReaderV1", config: {} },
      inputs: {},
    })
  ).outputs.sceneState;
  const result = await executors.rpContextAssemblerV1({
    node: {
      id: "assembler_1",
      type: "rpContextAssemblerV1",
      config: { includeDebugPreview: true },
    },
    inputs: {
      parsedInput,
      characterProfile,
      sceneState,
      loreContext: "沈青璃曾私自进入禁地，因此会回避相关追问。",
      memoryContext: "师姐最近两次在玩家靠近时转移话题。",
    },
  });
  expect(result.outputs.rpContextBundle.blocks.map((b) => b.id)).toEqual([
    "rp_rules",
    "character",
    "scene",
    "worldbook",
    "memory",
    "player_input",
  ]);
  expect(result.outputs.rpContextBundle.usedContext.characterId).toBe("senior_sister");
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npx vitest run plugins/rp-runtime-v1/executor.test.mjs
```

Expected: FAIL because `worldbookSearchV1`, `memoryRecallV1`, and `rpContextAssemblerV1` are not implemented yet.

- [ ] **Step 3: Add executor implementations**

Add these properties inside the object returned by `createExecutors` in `executor.mjs`:

```js
  worldbookSearchV1: async ({ node, inputs }) => {
    const start = Date.now();
    const limit = Number(node.config.limit ?? 4);
    const queryText = collectQueryText(inputs.parsedInput, inputs.characterProfile, inputs.sceneState);
    const entries = (await readWorldbook()).filter((entry) => entry.enabled !== false);
    const ranked = entries
      .map((entry) => scoreWorldbookEntry(entry, queryText))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const usedWorldbookEntries = ranked.map(({ entry, matchedKeys, score }) => ({
      id: entry.id,
      title: entry.title,
      matchedKeys,
      priority: entry.priority ?? 0,
      score,
      reason: matchedKeys.length
        ? `命中关键词：${matchedKeys.join("、")}`
        : "与输入、角色或场景存在文本相关性。",
      content: entry.content,
      tags: entry.tags ?? [],
    }));
    const loreContext = usedWorldbookEntries.map((entry) => `【${entry.title}】${entry.content}`).join("\n");
    return {
      outputs: { loreContext, usedWorldbookEntries },
      metadata: createMetadata({
        nodeId: node.id,
        inputSummary: `query=${summarize(queryText)}`,
        outputSummary: `worldbookHits=${usedWorldbookEntries.length}`,
        durationMs: elapsed(start),
        extraViews: [
          {
            id: "worldbook_hits",
            kind: "entry-list",
            title: "命中世界书条目",
            items: usedWorldbookEntries.map((entry) => ({
              id: entry.id,
              title: entry.title,
              summary: entry.content.slice(0, 120),
              tags: entry.tags,
              metadata: { reason: entry.reason, score: String(entry.score) },
            })),
          },
          {
            id: "worldbook_stats",
            kind: "stats",
            title: "世界书检索统计",
            pairs: [
              { label: "命中数", value: usedWorldbookEntries.length },
              { label: "候选总数", value: entries.length },
            ],
          },
        ],
      }),
    };
  },

  memoryRecallV1: async ({ node, inputs }) => {
    const start = Date.now();
    const limit = Number(node.config.limit ?? 4);
    const sessionId = normalizeText(inputs.sessionId ?? node.config.sessionId ?? "demo_session");
    const characterId = normalizeText(inputs.characterId ?? node.config.characterId ?? "senior_sister");
    const queryText = collectQueryText(inputs.parsedInput, sessionId, characterId);
    const memories = await readMemories();
    const ranked = memories
      .map((memory) => scoreMemory(memory, queryText, sessionId, characterId))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const recalledMemories = ranked.map(({ memory, score }) => ({
      id: memory.id,
      type: memory.type,
      title: memory.title,
      content: memory.content,
      tags: memory.tags ?? [],
      score,
      reason: memory.content.includes("回避") || memory.content.includes("躲")
        ? "本轮输入涉及回避与距离感。"
        : "与本轮输入、会话或角色相关。",
    }));
    const memoryContext = recalledMemories.map((memory) => `【${memory.title}】${memory.content}`).join("\n");
    return {
      outputs: { memoryContext, recalledMemories },
      metadata: createMetadata({
        nodeId: node.id,
        inputSummary: `sessionId=${sessionId}; characterId=${characterId}; query=${summarize(queryText)}`,
        outputSummary: `memoryHits=${recalledMemories.length}`,
        durationMs: elapsed(start),
        extraViews: [
          {
            id: "memory_hits",
            kind: "entry-list",
            title: "召回记忆",
            items: recalledMemories.map((memory) => ({
              id: memory.id,
              title: memory.title,
              summary: memory.content.slice(0, 120),
              tags: memory.tags,
              metadata: { reason: memory.reason, score: String(memory.score) },
            })),
          },
        ],
      }),
    };
  },

  rpContextAssemblerV1: async ({ node, inputs }) => {
    const start = Date.now();
    const character = inputs.characterProfile ?? {};
    const scene = inputs.sceneState ?? {};
    const parsed = inputs.parsedInput ?? {};
    const blocks = [
      {
        id: "rp_rules",
        role: "system",
        title: "RP 基础规则",
        content: "不替玩家行动；保持角色；保留钩子；每轮只推进一个关键变化。",
        priority: 100,
      },
      {
        id: "character",
        role: "system",
        title: "角色卡",
        content: `${character.name ?? "未知角色"}: ${character.description ?? ""}\n性格：${character.personality ?? ""}\n语气：${character.voice ?? ""}\n边界：${(character.boundaries ?? []).join("；")}`,
        priority: 90,
      },
      {
        id: "scene",
        role: "system",
        title: "场景状态",
        content: `${scene.location ?? "未知地点"} / ${scene.time ?? "未知时间"}\n氛围：${scene.mood ?? ""}\n风险：${scene.stakes ?? ""}`,
        priority: 80,
      },
      {
        id: "worldbook",
        role: "system",
        title: "世界观上下文",
        content: String(inputs.loreContext ?? "[无命中世界书]"),
        priority: 70,
      },
      {
        id: "memory",
        role: "system",
        title: "相关记忆",
        content: String(inputs.memoryContext ?? "[无召回记忆]"),
        priority: 60,
      },
      {
        id: "player_input",
        role: "user",
        title: "玩家本轮输入",
        content: parsed.rawText ?? "",
        priority: 100,
      },
    ];
    const rpContextBundle = {
      blocks,
      usedContext: {
        characterId: character.id,
        sceneId: scene.sceneId,
        sessionId: scene.sessionId,
      },
      assembledPromptPreview: blocks.map((block) => `# ${block.title}\n${block.content}`).join("\n\n"),
    };
    return {
      outputs: { rpContextBundle },
      metadata: createMetadata({
        nodeId: node.id,
        inputSummary: `parsed=${summarize(parsed)}; character=${character.id}; scene=${scene.sceneId}`,
        outputSummary: `blocks=${blocks.length}`,
        durationMs: elapsed(start),
        extraViews: [
          { id: "context_bundle", kind: "object", title: "RP 上下文包", value: rpContextBundle },
          { id: "prompt_preview", kind: "code", title: "Prompt Preview", language: "text", content: rpContextBundle.assembledPromptPreview },
        ],
      }),
    };
  },
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
npx vitest run plugins/rp-runtime-v1/executor.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/rp-runtime-v1/executor.mjs plugins/rp-runtime-v1/executor.test.mjs
git commit -m "feat(rp-runtime): add retrieval and context assembly nodes"
```

---

## Task 5: Implement RP dialogue director and output renderer

**Files:**

- Modify: `plugins/rp-runtime-v1/executor.mjs`
- Modify: `plugins/rp-runtime-v1/executor.test.mjs`

- [ ] **Step 1: Add tests**

Append these tests to `plugins/rp-runtime-v1/executor.test.mjs`:

```js
test("rpDialogueDirectorV1 produces replyDraft and pending candidate patches", async () => {
  const executors = await createExecutors(createMockContext());
  const rpContextBundle = {
    blocks: [
      { id: "character", title: "角色卡", content: "沈青璃冷静克制。" },
      {
        id: "player_input",
        title: "玩家本轮输入",
        content: "我走到师姐身边，低声问她刚才为什么躲着我。",
      },
    ],
    usedContext: {
      sessionId: "demo_session",
      sceneId: "training_hall_evening",
      characterId: "senior_sister",
    },
  };
  const result = await executors.rpDialogueDirectorV1({
    node: {
      id: "director_1",
      type: "rpDialogueDirectorV1",
      config: {
        agentRole: "dialogue_director",
        model: "mock-pro",
        replyRules: "保持角色、保留玩家行动权。",
        skills: ["rp_persona", "rp_player_agency"],
      },
    },
    inputs: { rpContextBundle },
  });
  expect(result.outputs.replyDraft).toContain("沈青璃");
  expect(result.outputs.candidateStatePatch.commitPolicy).toBe("pending");
  expect(result.outputs.candidateMemoryPatch.candidates[0].commitPolicy).toBe("pending");
  expect(result.metadata.debug.outputSummary).toContain("replyDraft");
});

test("rpOutputRendererV1 renders final output without committing patches", async () => {
  const executors = await createExecutors(createMockContext());
  const result = await executors.rpOutputRendererV1({
    node: {
      id: "renderer_1",
      type: "rpOutputRendererV1",
      config: { includePendingPatches: true, includeDebugLog: true },
    },
    inputs: {
      replyDraft: "沈青璃没有立刻回答。",
      candidateStatePatch: { commitPolicy: "pending", patches: [{ path: "relationship.tension" }] },
      candidateMemoryPatch: {
        candidates: [{ title: "玩家追问师姐回避", commitPolicy: "pending" }],
      },
      usedWorldbookEntries: [{ id: "wb_senior_sister_avoidance" }],
      recalledMemories: [{ id: "mem_senior_sister_recent_distance" }],
      sceneState: { sceneId: "training_hall_evening" },
    },
  });
  expect(result.outputs.reply).toBe("沈青璃没有立刻回答。");
  expect(result.outputs.finalOutput.pendingPatches.candidateStatePatch.commitPolicy).toBe(
    "pending",
  );
  expect(result.outputs.finalOutput.usedWorldbookEntries).toHaveLength(1);
  expect(result.outputs.debugLog).toContain("pendingPatches");
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npx vitest run plugins/rp-runtime-v1/executor.test.mjs
```

Expected: FAIL because `rpDialogueDirectorV1` and `rpOutputRendererV1` are not implemented yet.

- [ ] **Step 3: Add implementations**

Add these properties inside `createExecutors` return object:

```js
  rpDialogueDirectorV1: async ({ node, inputs }) => {
    const start = Date.now();
    const rpContextBundle = inputs.rpContextBundle ?? { blocks: [], usedContext: {} };
    const prompt = [
      "你是工作流 RP 的单核心 Dialogue Director Agent。",
      "根据上下文生成一段中文 RP 回复。",
      "必须保持角色，不替玩家行动，不直接揭开全部秘密。",
      "同时输出 candidateStatePatch 和 candidateMemoryPatch；它们只能是 pending，不得提交正式状态。",
      String(node.config.replyRules ?? ""),
      "",
      "上下文 blocks:",
      JSON.stringify(rpContextBundle.blocks ?? [], null, 2),
      "",
      "输出 JSON：{ agentRole, agentId, replyDraft, candidateStatePatch, candidateMemoryPatch, rationale }",
    ].join("\n");

    let parsed;
    if (context.executeAgent) {
      const result = await context.executeAgent({
        nodeId: node.id,
        config: {
          model: node.config.model ?? "mock-pro",
          systemPrompt: prompt,
          skills: Array.isArray(node.config.skills) ? node.config.skills.map(String) : [],
          plugins: [],
          outputType: "json",
        },
        inputs: { rpContextBundle },
      });
      try {
        parsed = JSON.parse(result.text);
      } catch {
        parsed = { replyDraft: result.text, candidateStatePatch: {}, candidateMemoryPatch: {}, rationale: {} };
      }
    } else {
      parsed = {
        agentRole: node.config.agentRole ?? "dialogue_director",
        agentId: node.id,
        replyDraft:
          "沈青璃没有立刻回答。她把袖口从你指尖能碰到的距离移开一点，却没有再退后。\n\n“你看见了？”她的声音压得很低，像怕惊动演武场尽头尚未熄灭的灯。“我不是躲你，只是有些话一旦说出口，就不能当作没发生过。”",
        candidateStatePatch: {
          target: rpContextBundle.usedContext ?? {},
          patches: [
            {
              op: "suggest",
              path: "relationship.senior_sister.tension",
              value: "increase",
              reason: "玩家察觉并追问师姐回避。",
            },
          ],
          commitPolicy: "pending",
        },
        candidateMemoryPatch: {
          target: rpContextBundle.usedContext ?? {},
          candidates: [
            {
              type: "relationship",
              title: "玩家追问师姐回避",
              content: "玩家走到师姐身边，低声询问她刚才为什么躲着自己。",
              tags: ["师姐", "回避", "关系"],
              priority: 3,
              commitPolicy: "pending",
            },
          ],
        },
        rationale: {
          usedBlocks: (rpContextBundle.blocks ?? []).map((block) => block.id).filter(Boolean),
          styleChoices: ["克制", "低声", "保留悬念"],
          safetyChecks: ["未替玩家行动", "未直接揭示全部秘密"],
        },
      };
    }

    const candidateStatePatch = {
      ...(parsed.candidateStatePatch ?? {}),
      commitPolicy: "pending",
    };
    const candidateMemoryPatch = {
      ...(parsed.candidateMemoryPatch ?? {}),
      candidates: Array.isArray(parsed.candidateMemoryPatch?.candidates)
        ? parsed.candidateMemoryPatch.candidates.map((candidate) => ({ ...candidate, commitPolicy: "pending" }))
        : [],
    };

    return {
      outputs: {
        replyDraft: String(parsed.replyDraft ?? ""),
        candidateStatePatch,
        candidateMemoryPatch,
      },
      metadata: createMetadata({
        nodeId: node.id,
        inputSummary: `blocks=${(rpContextBundle.blocks ?? []).length}`,
        outputSummary: `replyDraft + statePatch=${candidateStatePatch.patches?.length ?? 0} + memoryCandidates=${candidateMemoryPatch.candidates.length}`,
        durationMs: elapsed(start),
        extraViews: [
          { id: "candidate_state_patch", kind: "object", title: "Candidate State Patch", value: candidateStatePatch },
          { id: "candidate_memory_patch", kind: "object", title: "Candidate Memory Patch", value: candidateMemoryPatch },
          { id: "agent_rationale", kind: "object", title: "Agent Rationale", value: parsed.rationale ?? {} },
          { id: "prompt_preview", kind: "code", title: "Agent Prompt Preview", language: "text", content: prompt },
        ],
      }),
    };
  },

  rpOutputRendererV1: async ({ node, inputs }) => {
    const start = Date.now();
    const reply = String(inputs.replyDraft ?? "");
    const pendingPatches = {
      candidateStatePatch: inputs.candidateStatePatch ?? { commitPolicy: "pending", patches: [] },
      candidateMemoryPatch: inputs.candidateMemoryPatch ?? { candidates: [] },
    };
    const finalOutput = {
      reply,
      usedWorldbookEntries: Array.isArray(inputs.usedWorldbookEntries) ? inputs.usedWorldbookEntries : [],
      recalledMemories: Array.isArray(inputs.recalledMemories) ? inputs.recalledMemories : [],
      usedSceneState: inputs.sceneState ?? {},
      pendingPatches,
      debugLog: [
        {
          nodeId: node.id,
          type: "rpOutputRendererV1",
          inputSummary: `replyLength=${reply.length}; worldbook=${Array.isArray(inputs.usedWorldbookEntries) ? inputs.usedWorldbookEntries.length : 0}; memories=${Array.isArray(inputs.recalledMemories) ? inputs.recalledMemories.length : 0}`,
          outputSummary: "final reply + pendingPatches + debugLog",
          commitPolicy: "pending_only",
        },
      ],
    };
    const debugLog = JSON.stringify(finalOutput, null, 2);
    return {
      outputs: { reply, finalOutput, debugLog },
      metadata: createMetadata({
        nodeId: node.id,
        inputSummary: `replyLength=${reply.length}`,
        outputSummary: `finalOutput with pendingPatches=${Boolean(node.config.includePendingPatches ?? true)}`,
        durationMs: elapsed(start),
        extraViews: [
          { id: "final_output", kind: "object", title: "Final Output", value: finalOutput },
          { id: "debug_log", kind: "code", title: "Debug Log", language: "json", content: debugLog },
        ],
      }),
    };
  },
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
npx vitest run plugins/rp-runtime-v1/executor.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/rp-runtime-v1/executor.mjs plugins/rp-runtime-v1/executor.test.mjs
git commit -m "feat(rp-runtime): add dialogue director and output renderer"
```

---

## Task 6: Add `default-rp-workflow-v1` workflow JSON

**Files:**

- Create: `plugins/rp-runtime-v1/workflows/default-rp-workflow-v1.json`
- Modify: `plugins/rp-runtime-v1/executor.test.mjs`

- [ ] **Step 1: Create workflow JSON**

```json
{
  "id": "default-rp-workflow-v1",
  "name": "Default RP Workflow v1",
  "version": 1,
  "nodes": [
    {
      "id": "user_1",
      "type": "userInput",
      "position": { "x": 80, "y": 260 },
      "config": { "text": "我走到师姐身边，低声问她刚才为什么躲着我。" }
    },
    {
      "id": "parser_1",
      "type": "rpInputParserV1",
      "position": { "x": 340, "y": 260 },
      "config": { "language": "zh", "parserMode": "rule" }
    },
    {
      "id": "character_1",
      "type": "characterCardLoaderV1",
      "position": { "x": 340, "y": 40 },
      "config": { "characterId": "senior_sister" }
    },
    {
      "id": "scene_1",
      "type": "sceneStateReaderV1",
      "position": { "x": 340, "y": 470 },
      "config": { "sessionId": "demo_session", "sceneId": "training_hall_evening" }
    },
    {
      "id": "worldbook_1",
      "type": "worldbookSearchV1",
      "position": { "x": 650, "y": 140 },
      "config": { "limit": 4 }
    },
    {
      "id": "memory_1",
      "type": "memoryRecallV1",
      "position": { "x": 650, "y": 360 },
      "config": { "sessionId": "demo_session", "characterId": "senior_sister", "limit": 4 }
    },
    {
      "id": "assembler_1",
      "type": "rpContextAssemblerV1",
      "position": { "x": 980, "y": 250 },
      "config": { "includeDebugPreview": true }
    },
    {
      "id": "director_1",
      "type": "rpDialogueDirectorV1",
      "position": { "x": 1300, "y": 250 },
      "config": {
        "agentRole": "dialogue_director",
        "model": "mock-pro",
        "replyRules": "保持角色、保留玩家行动权、每轮只推进一个关键变化。",
        "outputMode": "reply_with_candidate_patches",
        "collaborationMode": "single",
        "skills": ["rp_persona", "rp_player_agency", "rp_continuity", "rp_slow_burn"]
      }
    },
    {
      "id": "renderer_1",
      "type": "rpOutputRendererV1",
      "position": { "x": 1620, "y": 250 },
      "config": { "includePendingPatches": true, "includeDebugLog": true }
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "user_1",
      "sourcePort": "text",
      "target": "parser_1",
      "targetPort": "userInput"
    },
    {
      "id": "e2",
      "source": "parser_1",
      "sourcePort": "parsedInput",
      "target": "worldbook_1",
      "targetPort": "parsedInput"
    },
    {
      "id": "e3",
      "source": "parser_1",
      "sourcePort": "parsedInput",
      "target": "memory_1",
      "targetPort": "parsedInput"
    },
    {
      "id": "e4",
      "source": "parser_1",
      "sourcePort": "parsedInput",
      "target": "assembler_1",
      "targetPort": "parsedInput"
    },
    {
      "id": "e5",
      "source": "character_1",
      "sourcePort": "characterProfile",
      "target": "worldbook_1",
      "targetPort": "characterProfile"
    },
    {
      "id": "e6",
      "source": "character_1",
      "sourcePort": "characterProfile",
      "target": "assembler_1",
      "targetPort": "characterProfile"
    },
    {
      "id": "e7",
      "source": "scene_1",
      "sourcePort": "sceneState",
      "target": "worldbook_1",
      "targetPort": "sceneState"
    },
    {
      "id": "e8",
      "source": "scene_1",
      "sourcePort": "sceneState",
      "target": "assembler_1",
      "targetPort": "sceneState"
    },
    {
      "id": "e9",
      "source": "scene_1",
      "sourcePort": "sceneState",
      "target": "renderer_1",
      "targetPort": "sceneState"
    },
    {
      "id": "e10",
      "source": "worldbook_1",
      "sourcePort": "loreContext",
      "target": "assembler_1",
      "targetPort": "loreContext"
    },
    {
      "id": "e11",
      "source": "worldbook_1",
      "sourcePort": "usedWorldbookEntries",
      "target": "renderer_1",
      "targetPort": "usedWorldbookEntries"
    },
    {
      "id": "e12",
      "source": "memory_1",
      "sourcePort": "memoryContext",
      "target": "assembler_1",
      "targetPort": "memoryContext"
    },
    {
      "id": "e13",
      "source": "memory_1",
      "sourcePort": "recalledMemories",
      "target": "renderer_1",
      "targetPort": "recalledMemories"
    },
    {
      "id": "e14",
      "source": "assembler_1",
      "sourcePort": "rpContextBundle",
      "target": "director_1",
      "targetPort": "rpContextBundle"
    },
    {
      "id": "e15",
      "source": "director_1",
      "sourcePort": "replyDraft",
      "target": "renderer_1",
      "targetPort": "replyDraft"
    },
    {
      "id": "e16",
      "source": "director_1",
      "sourcePort": "candidateStatePatch",
      "target": "renderer_1",
      "targetPort": "candidateStatePatch"
    },
    {
      "id": "e17",
      "source": "director_1",
      "sourcePort": "candidateMemoryPatch",
      "target": "renderer_1",
      "targetPort": "candidateMemoryPatch"
    }
  ]
}
```

- [ ] **Step 2: Add workflow-level test**

Append this to `plugins/rp-runtime-v1/executor.test.mjs`:

```js
import { readFile } from "node:fs/promises";
import { nodeRegistry, runWorkflow } from "@awp/workflow-core";

const loadWorkflow = async () =>
  JSON.parse(
    await readFile(new URL("./workflows/default-rp-workflow-v1.json", import.meta.url), "utf8"),
  );

const collectInputs = (workflow, nodeId, outputsByNode) => {
  const inputs = {};
  for (const edge of workflow.edges.filter((edge) => edge.target === nodeId)) {
    inputs[edge.targetPort] = outputsByNode.get(edge.source)?.[edge.sourcePort];
  }
  return inputs;
};

test("default-rp-workflow-v1 runs end-to-end with plugin executors", async () => {
  const workflow = await loadWorkflow();
  const pluginManifest = JSON.parse(
    await readFile(new URL("./node.plugin.json", import.meta.url), "utf8"),
  );
  const pluginCatalog = Object.fromEntries(pluginManifest.nodes.map((node) => [node.type, node]));
  const catalog = { ...nodeRegistry, ...pluginCatalog };
  const rpExecutors = await createExecutors(createMockContext());
  const executors = {
    ...rpExecutors,
    userInput: async ({ node }) => ({ outputs: { text: node.config.text ?? "" } }),
  };
  const result = await runWorkflow(workflow, executors, catalog);
  expect(result.status).toBe("success");
  const rendererRun = result.nodeRuns.find((run) => run.nodeId === "renderer_1");
  expect(rendererRun.outputs.reply).toContain("沈青璃");
  expect(rendererRun.outputs.finalOutput.usedWorldbookEntries.length).toBeGreaterThan(0);
  expect(rendererRun.outputs.finalOutput.recalledMemories.length).toBeGreaterThan(0);
  expect(rendererRun.outputs.finalOutput.usedSceneState.sceneId).toBe("training_hall_evening");
  expect(rendererRun.outputs.finalOutput.pendingPatches.candidateStatePatch.commitPolicy).toBe(
    "pending",
  );
});
```

- [ ] **Step 3: Run tests and verify they pass**

Run:

```bash
npx vitest run plugins/rp-runtime-v1/executor.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/rp-runtime-v1/workflows/default-rp-workflow-v1.json plugins/rp-runtime-v1/executor.test.mjs
git commit -m "feat(rp-runtime): add default RP workflow v1 template"
```

---

## Task 7: Add run report and final validation

**Files:**

- Create: `docs/reports/default-rp-workflow-v1-run.md`

- [ ] **Step 1: Run plugin tests**

Run:

```bash
npx vitest run plugins/rp-runtime-v1/executor.test.mjs
```

Expected: all tests pass.

- [ ] **Step 2: Run formatting check for new files**

Run:

```bash
npx prettier --check plugins/rp-runtime-v1 docs/reports/default-rp-workflow-v1-run.md
```

Expected: all matched files use Prettier style. If it fails, run:

```bash
npx prettier --write plugins/rp-runtime-v1 docs/reports/default-rp-workflow-v1-run.md
```

- [ ] **Step 3: Create run report**

````markdown
# default-rp-workflow-v1 Run Report

## Test Input

```text
我走到师姐身边，低声问她刚才为什么躲着我。
```
````

## Workflow

`plugins/rp-runtime-v1/workflows/default-rp-workflow-v1.json`

## Node Chain

```text
userInput → rpInputParserV1 → characterCardLoaderV1 / sceneStateReaderV1 / worldbookSearchV1 / memoryRecallV1 → rpContextAssemblerV1 → rpDialogueDirectorV1 → rpOutputRendererV1
```

## Final Reply

```text
沈青璃没有立刻回答。她把袖口从你指尖能碰到的距离移开一点，却没有再退后。

“你看见了？”她的声音压得很低，像怕惊动演武场尽头尚未熄灭的灯。“我不是躲你，只是有些话一旦说出口，就不能当作没发生过。”
```

## usedWorldbookEntries

- `wb_senior_sister_avoidance` — 师姐的回避

## recalledMemories

- `mem_senior_sister_recent_distance` — 师姐最近的距离感

## usedSceneState

- `sessionId`: `demo_session`
- `sceneId`: `training_hall_evening`
- `location`: `傍晚的演武场`

## Pending Patches

### candidateStatePatch

```json
{
  "commitPolicy": "pending",
  "patches": [
    {
      "op": "suggest",
      "path": "relationship.senior_sister.tension",
      "value": "increase",
      "reason": "玩家察觉并追问师姐回避。"
    }
  ]
}
```

### candidateMemoryPatch

```json
{
  "candidates": [
    {
      "type": "relationship",
      "title": "玩家追问师姐回避",
      "content": "玩家走到师姐身边，低声询问她刚才为什么躲着自己。",
      "tags": ["师姐", "回避", "关系"],
      "priority": 3,
      "commitPolicy": "pending"
    }
  ]
}
```

## Debug Log

The renderer output contains `finalOutput.debugLog` with node-level summary data. Each node also returns metadata views with input summary, output summary, trace steps, and structured output previews.

## Validation

Command:

```bash
npx vitest run plugins/rp-runtime-v1/executor.test.mjs
```

Expected result: all tests pass.

## Safety Assertion

No node writes to formal `data`, `state`, or `memories` files. Demo files are read-only inputs. Candidate patches remain in output/debug only.

````

- [ ] **Step 4: Commit**

```bash
git add docs/reports/default-rp-workflow-v1-run.md
git commit -m "docs(rp-runtime): add default RP workflow run report"
````

---

## Self-Review

### Spec Coverage

| Spec requirement                                            | Task                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| New independent `rp-runtime-v1` plugin                      | Task 2                                                      |
| No core code changes                                        | Scope guardrails; all tasks only create plugin/report files |
| Demo character/scene/worldbook/memory                       | Task 1                                                      |
| 8 reusable RP nodes                                         | Task 2 manifest + Tasks 3-5 executor                        |
| State/Memory/Worldbook read-only                            | Tasks 1, 3, 4, 5                                            |
| `candidateStatePatch` / `candidateMemoryPatch` pending only | Task 5                                                      |
| `default-rp-workflow-v1.json`                               | Task 6                                                      |
| End-to-end workflow test                                    | Task 6                                                      |
| Debug metadata/trace                                        | Tasks 3-5                                                   |
| Run report with sample input/output                         | Task 7                                                      |

All requirements are covered.

### Placeholder Scan

No TBD, TODO, “implement later”, or unspecified validation steps. Code snippets contain concrete content.

### Type Consistency

- Manifest node types match executor keys.
- Workflow node `type` values match manifest node types.
- Workflow edge port IDs match manifest port IDs.
- Candidate patch names match spec: `candidateStatePatch`, `candidateMemoryPatch`.
- Output renderer emits `reply`, `finalOutput`, and `debugLog`.
