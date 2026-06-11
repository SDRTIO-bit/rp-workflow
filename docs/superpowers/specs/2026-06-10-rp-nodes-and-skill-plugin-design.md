# RP 节点（第一批）+ Skill 插件化 — 设计文档

日期：2026-06-10
状态：已确认，待实施

## 总览

子项目 1，覆盖两个目标：

1. **RP 节点第一批**：在 rp-core 插件中新增 3 个节点（rpInputParser、rpContextAssembler、rpMemoryWrite）
2. **Skill 插件化**：skill 定义脱离 serve.mjs 硬编码，走独立 `skill.plugin.json` manifest，通过 API 动态加载

核心原则：所有 RP 能力通过插件协议接入，不在项目文件中硬编码任何节点或 skill。

---

## 第 1 部分：新增 RP 节点

### 1.1 rpInputParser — 玩家输入解析

**目标**：把用户原始输入拆成结构化 JSON，让下游检索和组装更精准。

**端口：**

| 方向   | ID     | dataType   | 说明             |
| ------ | ------ | ---------- | ---------------- |
| input  | text   | user_input | 玩家原始输入文本 |
| output | parsed | json       | 结构化解析结果   |

**输出结构：**

```json
{
  "speech": "玩家说的话",
  "action": "玩家做的动作",
  "intent": "玩家的意图",
  "emotion": "情绪标签",
  "entities": ["提到的实体列表"],
  "triggers": ["潜在触发词"]
}
```

**配置字段：**

| key        | kind     | 说明     | 默认值                                                   |
| ---------- | -------- | -------- | -------------------------------------------------------- |
| parseRules | textarea | 解析指令 | "分析玩家输入，提取发言、动作、意图、情绪、实体、触发词" |
| language   | select   | 语言     | ["zh", "en"]                                             |

**实现方式**：调用 agent-runtime 的 LLM 调用完成解析（system prompt 为解析指令，user prompt 为输入文本）。

### 1.2 rpContextAssembler — 上下文组装

**目标**：把角色卡、场景、世界书、记忆、玩家输入组装成结构化 RP context，替代原来散在 rpDialogueDirector 里的逻辑。

**端口：**

| 方向   | ID        | dataType          | 说明                   |
| ------ | --------- | ----------------- | ---------------------- |
| input  | parsed    | json              | 来自 rpInputParser     |
| input  | character | character_profile | 角色卡                 |
| input  | scene     | scene_state       | 场景状态               |
| input  | worldbook | context           | 世界书命中             |
| input  | memory    | context           | 记忆召回               |
| output | context   | context           | 组装后的完整 RP 上下文 |

**配置字段：**

| key              | kind     | 说明       | 默认值                    |
| ---------------- | -------- | ---------- | ------------------------- |
| assemblyTemplate | textarea | 组装模板   | 预置中文 RP 上下文模板    |
| maxTokens        | number   | token 上限 | 2000（min 500, max 4000） |

**实现方式**：纯文本模板拼接，不需要 LLM 调用。按模板将各部分拼成一段完整 RP context 文本。

### 1.3 rpMemoryWrite — 记忆写入候选

**目标**：每轮结束后判断哪些内容值得写入记忆库，输出候选列表。默认不自动写入。

**端口：**

| 方向   | ID         | dataType    | 说明                   |
| ------ | ---------- | ----------- | ---------------------- |
| input  | reply      | draft       | 导演输出               |
| input  | notes      | analysis    | 连续性检查结果         |
| input  | parsed     | json        | 玩家输入解析（可选）   |
| input  | state      | scene_state | 场景状态（可选）       |
| output | candidates | json        | 建议写入的记忆候选列表 |

**输出结构：**

```json
[
  {
    "type": "relationship",
    "title": "对璃夏的信任度变化",
    "content": "玩家表现出对璃夏的进一步信任...",
    "tags": ["trust", "璃夏"],
    "priority": 3
  }
]
```

**候选类型：** relationship / preference / promise / lore / hook

**配置字段：**

| key           | kind        | 说明         | 默认值                                                    |
| ------------- | ----------- | ------------ | --------------------------------------------------------- |
| autoWrite     | boolean     | 是否自动写入 | false                                                     |
| maxCandidates | number      | 最大候选数   | 5（min 1, max 10）                                        |
| memoryTypes   | multiselect | 启用类型     | ["relationship", "preference", "promise", "lore", "hook"] |

**实现方式**：调用 LLM 分析本轮对话，提取值得记忆的变化。输出候选 JSON 数组，不直接写文件。后续可在前端展示候选列表让用户确认。

### 1.4 新增 dataType

新增 `json` dataType，注册到 `areTypesCompatible`：

```
json:context → true
user_input:json → true
draft:json → true
analysis:json → true
character_profile:json → true
scene_state:json → true
```

### 1.5 文件变更

- **Modify** `plugins/rp-core/node.plugin.json` — 新增 3 个 node 定义
- **Modify** `plugins/rp-core/executor.mjs` — 新增 3 个 executor 函数
- **Modify** `packages/workflow-core/src/nodeRegistry.ts` — 新增 `json` dataType，补充兼容对
- **Modify** `apps/web/src/state/sampleWorkflows.ts` — 新增/更新 RP 工作流模板

---

## 第 2 部分：Skill 插件化

### 2.1 skill.plugin.json 协议

新 manifest 文件类型，放在 `plugins/<plugin-id>/skill.plugin.json`：

```json
{
  "schemaVersion": 1,
  "id": "awp.rp-skills",
  "label": "RP Skills",
  "version": "0.1.0",
  "description": "Roleplay agent skills",
  "author": "Agent Workflow Platform",
  "enabled": true,
  "compatibility": { "app": ">=0.1.0" },
  "skills": [
    {
      "id": "rp_persona",
      "label": { "zh": "RP 角色扮演", "en": "RP Persona" },
      "content": {
        "zh": "保持角色人设、语气、关系立场、秘密和边界。不打破第四面墙。",
        "en": "Stay in character. Preserve persona, voice, relationship stance, secrets, and boundaries."
      },
      "category": "roleplay",
      "tags": ["persona", "voice", "immersion"]
    }
  ]
}
```

**Skill 字段：**

| 字段     | 类型          | 必须 | 说明                                    |
| -------- | ------------- | ---- | --------------------------------------- |
| id       | string        | 是   | 唯一标识，agent 节点 config.skills 引用 |
| label    | LocalizedText | 是   | 显示名称                                |
| content  | LocalizedText | 是   | 注入 LLM prompt 的指令文本              |
| category | string        | 否   | 分类，用于前端分组                      |
| tags     | string[]      | 否   | 标签                                    |

**与 node.plugin.json 的区别：**

|              | node.plugin.json       | skill.plugin.json   |
| ------------ | ---------------------- | ------------------- |
| 核心字段     | nodes[] + executor     | skills[]            |
| 执行逻辑     | 有（executor adapter） | 无（纯文本注入）    |
| 权限         | permissions[]          | 不需要              |
| 插件管理面板 | 节点列表               | skill 列表          |
| 启用/禁用    | 影响节点目录           | 影响可用 skill 列表 |

### 2.2 加载流程

serve.mjs 新增 `loadSkillPlugins()`：

1. 扫描 `plugins/*/skill.plugin.json`
2. 校验 `validateSkillPluginManifest()`
3. 跳过 disabled、无效 manifest
4. 合并所有 skills[]，附加 `pluginId` 来源标记
5. 导出 `skillCatalog: SkillDefinition[]`

### 2.3 API

**GET /api/skills** — 返回所有启用插件的 skill 列表：

```json
{
  "skills": [
    {
      "id": "rp_persona",
      "label": { "zh": "RP 角色扮演", "en": "RP Persona" },
      "content": { "zh": "...", "en": "..." },
      "category": "roleplay",
      "tags": ["persona", "voice"],
      "pluginId": "awp.rp-skills"
    }
  ],
  "categories": ["roleplay", "safety", "writing"]
}
```

**GET /api/plugins** — 扩展返回 skill 插件，新增 `kind` 字段：

```json
{
  "plugins": [
    { "id": "awp.rp-core", "kind": "node-plugin", "nodeTypes": [...], ... },
    { "id": "awp.rp-skills", "kind": "skill-plugin", "skillCount": 7, ... }
  ]
}
```

### 2.4 移除硬编码

- serve.mjs 中 `sampleSkills` 数组删除
- serve.mjs 中 `samplePlugins` 数组删除（这些 "plugins" 实际上是给 agent 的上下文工具描述，不是可执行插件。可以保留在 prompt builder 中作为旧兼容，或移到 skill.plugin.json 中作为 type: "tool-description"）
- `createExecutors` 中 agent 节点的 `availableSkills` 改为从 `skillCatalog` 动态获取
- 前端 agent 节点配置面板的 skill 列表改为从 `/api/skills` 获取

### 2.5 文件变更

- **Create** `plugins/rp-skills/skill.plugin.json` — 包含 7 个当前硬编码的 skill 定义
- **Modify** `packages/plugin-sdk/src/index.ts` — 新增 `SkillPluginManifest`、`SkillDefinition` 类型 + `validateSkillPluginManifest()`
- **Modify** `apps/web/scripts/serve.mjs` — 新增 `loadSkillPlugins()`、`GET /api/skills`、移除 `sampleSkills`/`samplePlugins` 硬编码
- **Modify** `apps/web/src/runWorkflowClient.ts` — 新增 `loadSkillsViaServer()` 函数
- **Modify** `apps/web/src/App.tsx` — agent 节点配置面板 skill 列表改为动态加载

---

## 第 3 部分：工作流模板更新

新增/更新 RP 工作流模板 `rpFullPipeline`，完整链路：

```text
userInput
  → rpInputParser
  → rpWorldbookTrigger (预留，第二批实现)
  → worldbookSearch
  → memoryRecall
  → rpCharacterCard
  → rpSceneState
  → rpContextAssembler
  → rpDialogueDirector
  → rpContinuityCheck
  → textOutput
  → rpTurnSummary (预留，第二批实现)
  → rpMemoryWrite
```

第一批模板仅包含已实现的节点（含 `rpInputParser`、`rpContextAssembler`、`rpMemoryWrite`）。

---

## 实施顺序

1. Skill 插件化（类型 + manifest + 加载 + API）
2. 移除 serve.mjs 硬编码 skill
3. 新增 json dataType + 兼容对
4. rpInputParser 节点
5. rpContextAssembler 节点
6. rpMemoryWrite 节点
7. 更新工作流模板
8. 验证：test + build + 浏览器

---

## 验收标准

### RP 节点

- `rpInputParser` 正确输出 `{speech, action, intent, emotion, entities, triggers}` JSON
- `rpContextAssembler` 正确拼接 5 路输入为完整 RP context 文本
- `rpMemoryWrite` 输出候选记忆 JSON 数组（含 type/priority）
- 三个节点均在 rp-core 插件中，可随插件启用/禁用
- `json` dataType 连线兼容性正确

### Skill 插件化

- `skill.plugin.json` manifest 校验通过
- `GET /api/skills` 返回聚合后的 skill 列表
- `GET /api/plugins` 区分 node-plugin / skill-plugin
- serve.mjs 不再硬编码 skill 定义
- Agent 节点通过 API 获取可用 skill 列表
- 插件管理面板展示 skill 插件
- `npm run test` + `npm run build` 通过
