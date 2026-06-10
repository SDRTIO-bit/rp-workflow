# RP 节点第一批 + Skill 插件化 — 实施报告

**日期**：2026-06-10
**状态**：已完成，验证通过

---

## 概述

基于已有的插件协议（`node.plugin.json`），完成了两个目标：

1. **RP 节点第一批**：在 `rp-core` 插件中新增 3 个节点（`rpInputParser`、`rpContextAssembler`、`rpMemoryWrite`）
2. **Skill 插件化**：skill 定义脱离 `serve.mjs` 硬编码，走独立 `skill.plugin.json` manifest，通过 API 动态加载

核心原则：所有 RP 能力通过插件协议接入，不在项目文件中硬编码任何节点或 skill。

---

## 变更统计

- **修改文件**：14 个
- **新建文件**：5 个（`skill.plugin.json`、设计文档、实施计划）
- **增量**：+1600 行 / -258 行
- **Commits**：14 个（含文档 2 个）

---

## 第 1 部分：Skill 插件化

### 新增类型与校验（`packages/plugin-sdk/src/index.ts`）

| 类型 | 说明 |
|------|------|
| `LocalizedText` | `{ zh: string; en: string }` 双语文本 |
| `SkillDefinition` | skill 定义：`id`、`label`/`content`（`LocalizedText`）、`category`?、`tags`? |
| `SkillPluginManifest` | `skill.plugin.json` manifest 类型：`schemaVersion: 1`、`id`/`label`/`version`、`skills: SkillDefinition[]` |
| `validateSkillPluginManifest()` | 纯函数校验 manifest 结构合法性 |

### 新建 skill 插件（`plugins/rp-skills/skill.plugin.json`）

包含 7 个 RP skill 定义，全部中英双语：`world_context`、`prose`、`consistency`、`rp_persona`、`rp_player_agency`、`rp_continuity`、`rp_slow_burn`。

### 服务端加载与 API（`apps/web/scripts/serve.mjs`）

- **`loadSkillPlugins()`** — 扫描 `plugins/*/skill.plugin.json`，校验、聚合，附 `pluginId` 来源标记。静默跳过不存在 `skill.plugin.json` 的目录（ENOENT）
- **`GET /api/skills`** — 返回 `{ skills, categories }`
- **`GET /api/plugins`** 扩展 — skill 插件以 `kind: "skill-plugin"` 和 `skillCount` 出现在插件列表中
- **`reloadPluginRuntime()`** — 同步刷新 skillCatalog

### 移除硬编码

- `sampleSkills` 数组（7 个硬编码 skill）已删除
- `samplePlugins` 重命名为 `agentToolDescriptions`（语义更准确）
- 所有 agent executor 的 `availableSkills` 改为从 `skillCatalog` 动态获取

### 前端动态加载（`apps/web/src/runWorkflowClient.ts` + `App.tsx`）

- `SkillSummary` 类型 + `loadSkillsViaServer()` API 函数
- App 启动时从 `/api/skills` 加载 skill 列表到 `skillSummaries` 状态

### 关键修复

- **i18n 展平**：`skill.plugin.json` 中 `label`/`content` 是 `{zh, en}` 对象，但 `agent-runtime` 的 `SkillDefinition` 类型要求 `string`。在 `loadSkillPlugins()` 中做展平处理（zh 优先，en 兜底）

---

## 第 2 部分：RP 节点第一批

### rpInputParser — 玩家输入解析

- **类别**：`roleplay`
- **输入**：`user_input`（玩家原始文本）
- **输出**：`json`（结构化解析结果）
- **配置**：`parseRules`（textarea）、`language`（select: zh/en）
- **实现**：调用 LLM 解析输入 → 提取 `speech`/`action`/`intent`/`emotion`/`entities`/`triggers`，解析失败回退到原文作为 speech
- **颜色**：`#d97706`（橘色）

### rpContextAssembler — 上下文组装

- **类别**：`roleplay`
- **输入**：`parsed`(json)、`character`(character_profile)、`scene`(scene_state)、`worldbook`(context)、`memory`(context)
- **输出**：`context`（组装好的完整 RP 上下文）
- **配置**：`assemblyTemplate`（textarea）、`maxTokens`（number, 500-4000）
- **实现**：纯文本模板拼接，不需要 LLM 调用。占位符 `{character}`/`{scene}`/`{worldbook}`/`{memory}`/`{parsed}` 替换，缺失值标注「暂未提供」，超长截断

### rpMemoryWrite — 记忆写入候选

- **类别**：`memory`
- **输入**：`reply`(draft)、`notes`(analysis)、`parsed`(json, 可选)、`state`(scene_state, 可选)
- **输出**：`json`（记忆候选数组）
- **配置**：`autoWrite`（boolean）、`maxCandidates`（number, 1-10）、`memoryTypes`（multiselect: relationship/preference/promise/lore/hook）
- **实现**：LLM 分析本轮对话 → 提取候选记忆 → 过滤按类型 → 裁剪到上限 → 规范化 title/content/priority
- **输出结构**：`[{ type, title, content, tags, priority }]`

### 连线兼容性补充

在 `nodeRegistry.ts` 的 `areTypesCompatible` 中新增两个兼容对：

| 对 | 用途 |
|----|------|
| `user_input:json` | userInput.text → rpInputParser.parsed 等 |
| `draft:json` | rpDialogueDirector.reply → rpMemoryWrite.reply 等 |

### 工作流模板

新增 `rpFullPipeline` 模板，11 节点、16 条边，完整链路：

```
userInput → rpInputParser ──→ rpContextAssembler ──→ rpDialogueDirector
                          \                          /  ├──→ rpContinuityCheck
                           → worldbookSearch ───────/   │        │
                           → memoryRecall ─────────/    │   ┌────┘
                          /                             ├──→ textOutput
      rpCharacterCard ───/                              └──→ rpMemoryWrite
      rpSceneState ──────/
```

---

## 验证结果

| 检查项 | 结果 |
|--------|------|
| TypeScript 类型检查 | ✅ `tsc -b` 零错误（全 6 个 workspace） |
| 测试套件 | ✅ 61 个测试全部通过 |
| Build | ✅ 全 workspace 构建成功 |
| Prettier 格式化 | ✅ 全部文件符合规范 |
| 服务启动 | ✅ `npm run serve` 正常启动 |
| API `/api/skills` | ✅ 返回 7 个 skill + 4 个 category |
| API `/api/plugins` | ✅ 正确区分 `node-plugin` 和 `skill-plugin` |
| API `/api/nodes` | ✅ 包含 3 个新 RP 节点 |
| 新节点 registry | ✅ `rp-core` 插件 9 个 node type（原 5 + 新增 3 + rpLoreRecall） |

---

## 架构约束

1. **零硬编码**：项目文件中不硬编码任何节点、skill 或扩展定义。所有能力通过插件协议（`node.plugin.json` / `skill.plugin.json`）接入
2. **独立 manifest**：node 和 skill 走不同 manifest，互不耦合
3. **插件管理**：`GET /api/plugins` 面板统一展示 node 和 skill 插件，支持启用/禁用
4. **动态加载**：运行时 `reloadPluginRuntime()` 同步刷新所有插件状态
