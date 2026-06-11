# default-rp-workflow-v1 设计文档

**日期**：2026-06-12
**状态**：待审核

## 目标

基于当前项目已有的 Workflow / Graph / Node / Runtime 能力，新增一组可复用的 RP workflow 专用节点，并用这些节点组装一条官方样板工作流：`default-rp-workflow-v1`。

这不是酒馆类聊天产品，也不是把 RP 管线硬编码进程序。目标是实现“工作流 RP”：用户可以像 ComfyUI 一样，通过节点、端口、连线、配置和模板来搭建、调试、复制、改造 RP 链路。

第一版目标：

```text
用户输入一句 RP 行为
  → 工作流读取角色、场景、世界书、记忆
  → 单核心 Agent 生成 RP 回复
  → 输出 final reply + usedWorldbookEntries + recalledMemories + usedSceneState + debugLog
  → 输出 candidateStatePatch + candidateMemoryPatch，但不提交正式状态
```

## 硬约束

1. 不改核心平台代码。
2. 不把 RP 管线硬编码到程序逻辑中。
3. State / Memory / Worldbook 当前阶段全部只读。
4. 任何节点不得直接写入正式 `data` / `state` / `memories` 文件。
5. 如果需要提出状态变化，只能输出 `candidateStatePatch`。
6. 如果需要提出记忆变化，只能输出 `candidateMemoryPatch`。
7. candidate patch 只进入 debug log / pending output，不自动提交。
8. 后续人工确认、审核通过、自动提交机制另做独立节点或独立阶段。
9. 当前默认样板工作流使用单核心 Agent，但节点接口要兼容未来多 Agent 串联/并联。

## 非目标

第一版不做以下内容：

- 不做完整酒馆 UI。
- 不做 SillyTavern 替代品。
- 不做自动状态提交。
- 不做向量数据库。
- 不做完整多 Agent reviewer / merger 系统。
- 不做插件市场或复杂扩展 API。
- 不修改 `apps/web`、`packages/*` 等核心代码。

## 设计原则

### 工作流 RP，而不是酒馆 RP

酒馆系项目是 RP 领域的先驱，可以借鉴角色卡、世界书、记忆、上下文组装、调试可见性等机制。但本项目目标是 Agent Workflow Platform：RP 能力应以节点包形式接入，让用户通过图来组合能力。

因此，本设计只借鉴机制，不照搬产品形态。

### 节点可复用

`default-rp-workflow-v1` 是官方样板工作流，不是唯一固定管线。`rp-runtime-v1` 中的节点应该能被其他 workflow 复用。

### 单 Agent 当前实现，多 Agent 接口预留

默认工作流第一版只有一个核心生成 Agent：`rpDialogueDirectorV1`。但该 Agent 的输入输出采用结构化协议，未来可以连接多个 writer / reviewer / patch proposer / merge director 节点。

## 推荐新增文件

为避免污染已有 `rp-core`，新增独立插件：

```text
plugins/rp-runtime-v1/
├── node.plugin.json
├── executor.mjs
├── executor.test.mjs
├── demo/
│   ├── characters.json
│   ├── scenes.json
│   ├── worldbook.json
│   └── memories.json
└── workflows/
    └── default-rp-workflow-v1.json
```

可选验收报告：

```text
docs/reports/default-rp-workflow-v1-run.md
```

## 插件定位

`plugins/rp-runtime-v1` 是一个 RP workflow 节点包。

它提供：

- 只读上下文节点
- 上下文组装节点
- 单核心 RP Agent 节点
- 输出渲染与 debug 节点
- demo 数据
- 官方样板 workflow JSON

它不负责：

- 修改正式状态
- 写入正式记忆
- 替代 UI 聊天产品
- 提供全自动 RP 状态系统

## 节点总览

| 节点 type               | 类型         | 职责                                            |
| ----------------------- | ------------ | ----------------------------------------------- |
| `rpInputParserV1`       | 上下文预处理 | 解析玩家本轮行为、意图、语气、目标对象          |
| `characterCardLoaderV1` | 只读上下文   | 读取 demo 角色卡，不修改角色卡                  |
| `sceneStateReaderV1`    | 只读上下文   | 读取 demo 场景状态，不修改正式状态              |
| `worldbookSearchV1`     | 只读上下文   | 检索相关世界书条目，输出 loreContext 和命中条目 |
| `memoryRecallV1`        | 只读上下文   | 召回相关记忆，输出 memoryContext 和召回条目     |
| `rpContextAssemblerV1`  | 上下文组装   | 组装结构化 `rpContextBundle`                    |
| `rpDialogueDirectorV1`  | 核心 Agent   | 生成回复草稿和 candidate patches                |
| `rpOutputRendererV1`    | 输出渲染     | 输出最终 reply、debugLog、pending patches       |

## 节点契约

### `rpInputParserV1`

**作用**：解析用户本轮 RP 行为、意图、语气、目标对象。

| 方向   | port          | dataType     | 说明           |
| ------ | ------------- | ------------ | -------------- |
| input  | `userInput`   | `user_input` | 玩家原始输入   |
| output | `parsedInput` | `json`       | 结构化解析结果 |

输出示例：

```json
{
  "rawText": "我走到师姐身边，低声问她刚才为什么躲着我。",
  "speech": "刚才为什么躲着我？",
  "action": "走到师姐身边，低声询问",
  "intent": "追问对方回避原因",
  "tone": "低声、谨慎、带关切",
  "targets": ["师姐"],
  "entities": ["师姐"],
  "triggers": ["躲着我", "低声问"]
}
```

第一版实现可规则优先，必要时再考虑 Agent 解析。为了稳定和低成本，默认不要求它必须调用 LLM。

### `characterCardLoaderV1`

**作用**：按 `characterId` / `cardId` 读取角色卡基础设定。只读，不修改角色卡。

| 方向   | port               | dataType            | 说明                                        |
| ------ | ------------------ | ------------------- | ------------------------------------------- |
| input  | `characterId`      | `text`              | 角色 ID，可选；没有输入时使用 config 默认值 |
| output | `characterProfile` | `character_profile` | 结构化角色卡                                |

角色卡结构借鉴酒馆系，但只作为工作流上下文块：

```json
{
  "id": "senior_sister",
  "name": "沈青璃",
  "description": "外门大师姐，冷静克制。",
  "personality": "压抑情绪，习惯转移话题。",
  "scenario": "傍晚演武场，玩家发现她刻意回避。",
  "voice": "短句、含蓄、克制。",
  "boundaries": ["不替玩家行动", "不直接揭开核心秘密"],
  "exampleDialogue": ["“你总是问得太直接。”"],
  "systemPromptHints": ["保持师姐视角", "回避但不冷漠"]
}
```

### `sceneStateReaderV1`

**作用**：按 `sessionId` / `sceneId` 读取当前场景状态。只读，不修改正式状态。

| 方向   | port         | dataType      | 说明          |
| ------ | ------------ | ------------- | ------------- |
| input  | `sessionId`  | `text`        | 会话 ID，可选 |
| input  | `sceneId`    | `text`        | 场景 ID，可选 |
| output | `sceneState` | `scene_state` | 当前场景状态  |

输出示例：

```json
{
  "sessionId": "demo_session",
  "sceneId": "training_hall_evening",
  "location": "傍晚的演武场",
  "time": "黄昏后",
  "mood": "压低声音、若即若离、未说出口的担忧",
  "activeCharacters": ["senior_sister"],
  "stakes": "玩家察觉师姐刻意回避，但她似乎有不能明说的理由。"
}
```

### `worldbookSearchV1`

**作用**：基于 `parsedInput`、`characterProfile`、`sceneState` 检索相关世界书条目。只读，不写世界书。

| 方向   | port                   | dataType            | 说明                 |
| ------ | ---------------------- | ------------------- | -------------------- |
| input  | `parsedInput`          | `json`              | 玩家输入解析结果     |
| input  | `characterProfile`     | `character_profile` | 当前角色卡           |
| input  | `sceneState`           | `scene_state`       | 当前场景状态         |
| output | `loreContext`          | `context`           | 拼接后的世界观上下文 |
| output | `usedWorldbookEntries` | `json`              | 命中的世界书条目列表 |

世界书条目建议格式：

```json
{
  "id": "wb_senior_sister_avoidance",
  "title": "师姐的回避",
  "keys": ["师姐", "躲着", "回避", "低声问"],
  "content": "沈青璃在提到禁地调查时会刻意回避，因为她曾私自进入过禁地。",
  "priority": 80,
  "enabled": true
}
```

输出应保留命中来源：

```json
{
  "usedWorldbookEntries": [
    {
      "id": "wb_senior_sister_avoidance",
      "title": "师姐的回避",
      "matchedKeys": ["师姐", "躲着"],
      "priority": 80,
      "reason": "玩家询问师姐为什么躲避"
    }
  ]
}
```

### `memoryRecallV1`

**作用**：根据玩家输入、sessionId、characterId 召回相关记忆。只读，不写 memories。

| 方向   | port               | dataType  | 说明               |
| ------ | ------------------ | --------- | ------------------ |
| input  | `parsedInput`      | `json`    | 玩家输入解析结果   |
| input  | `sessionId`        | `text`    | 会话 ID            |
| input  | `characterId`      | `text`    | 角色 ID            |
| output | `memoryContext`    | `context` | 拼接后的记忆上下文 |
| output | `recalledMemories` | `json`    | 被召回的记忆条目   |

第一版召回策略为关键词 / 标签匹配。输出中要保留 reason，方便 debug：

```json
{
  "retrievalStrategy": "keyword",
  "recalledMemories": [
    {
      "id": "mem_senior_sister_recent_distance",
      "type": "relationship",
      "content": "师姐最近两次在玩家靠近时转移话题。",
      "reason": "本轮输入再次提到师姐回避。"
    }
  ]
}
```

### `rpContextAssemblerV1`

**作用**：把 parsedInput、characterProfile、sceneState、loreContext、memoryContext 组装为 Writer Agent 可消费的结构化上下文包。

| 方向   | port               | dataType            | 说明             |
| ------ | ------------------ | ------------------- | ---------------- |
| input  | `parsedInput`      | `json`              | 玩家输入解析结果 |
| input  | `characterProfile` | `character_profile` | 角色卡           |
| input  | `sceneState`       | `scene_state`       | 场景状态         |
| input  | `loreContext`      | `context`           | 世界书上下文     |
| input  | `memoryContext`    | `context`           | 记忆上下文       |
| output | `rpContextBundle`  | `json`              | 结构化上下文包   |

输出不是一整段 prompt，而是 blocks：

```json
{
  "blocks": [
    {
      "id": "rp_rules",
      "role": "system",
      "title": "RP 基础规则",
      "content": "不替玩家行动；保持角色；保留钩子。",
      "priority": 100
    },
    {
      "id": "character",
      "role": "system",
      "title": "角色卡",
      "content": "沈青璃是外门大师姐，冷静克制，习惯用短句和反问隐藏真实担忧。",
      "priority": 90
    },
    {
      "id": "scene",
      "role": "system",
      "title": "场景状态",
      "content": "傍晚的演武场只剩两人，玩家察觉师姐刚才刻意避开自己。",
      "priority": 80
    },
    {
      "id": "worldbook",
      "role": "system",
      "title": "世界观上下文",
      "content": "禁地调查牵涉师门旧案，沈青璃曾私自进入禁地，因此会回避相关追问。",
      "priority": 70
    },
    {
      "id": "memory",
      "role": "system",
      "title": "相关记忆",
      "content": "最近两次互动中，师姐在玩家靠近时转移话题，但并未真正拒绝玩家。",
      "priority": 60
    },
    {
      "id": "player_input",
      "role": "user",
      "title": "玩家本轮输入",
      "content": "我走到师姐身边，低声问她刚才为什么躲着我。",
      "priority": 100
    }
  ],
  "usedContext": {
    "characterId": "senior_sister",
    "sceneId": "training_hall_evening",
    "worldbookEntryIds": ["wb_senior_sister_avoidance"],
    "memoryIds": ["mem_senior_sister_recent_distance"]
  }
}
```

### `rpDialogueDirectorV1`

**作用**：核心单 Agent 节点。根据 `rpContextBundle` 生成 RP 回复正文，并提出候选状态 / 记忆 patch。

| 方向   | port                   | dataType | 说明                 |
| ------ | ---------------------- | -------- | -------------------- |
| input  | `rpContextBundle`      | `json`   | 上下文包             |
| output | `replyDraft`           | `draft`  | 回复草稿             |
| output | `candidateStatePatch`  | `json`   | 候选状态变化，不提交 |
| output | `candidateMemoryPatch` | `json`   | 候选记忆变化，不提交 |

配置建议：

```json
{
  "agentRole": "dialogue_director",
  "model": "deepseek-v4-flash",
  "replyRules": "保持角色、保留玩家行动权、每轮只推进一个关键变化。",
  "outputMode": "reply_with_candidate_patches",
  "collaborationMode": "single",
  "skills": ["rp_persona", "rp_player_agency", "rp_continuity", "rp_slow_burn"]
}
```

输出结构兼容未来多 Agent 协作：

```json
{
  "agentRole": "dialogue_director",
  "agentId": "director_1",
  "replyDraft": "沈青璃没有立刻回答。她把袖口从你指尖能碰到的距离移开一点，却没有再退后。\n\n“你看见了？”她的声音压得很低，像怕惊动演武场尽头尚未熄灭的灯。“我不是躲你，只是有些话一旦说出口，就不能当作没发生过。”",
  "candidateStatePatch": {
    "target": {
      "sessionId": "demo_session",
      "sceneId": "training_hall_evening"
    },
    "patches": [
      {
        "op": "suggest",
        "path": "relationship.senior_sister.tension",
        "value": "increase",
        "reason": "玩家察觉并追问师姐回避。"
      }
    ],
    "commitPolicy": "pending"
  },
  "candidateMemoryPatch": {
    "target": {
      "sessionId": "demo_session",
      "characterId": "senior_sister"
    },
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
  },
  "rationale": {
    "usedBlocks": ["character", "scene", "worldbook", "memory", "player_input"],
    "styleChoices": ["克制", "低声", "保留悬念"],
    "safetyChecks": ["未替玩家行动", "未直接揭示全部秘密"]
  }
}
```

### `rpOutputRendererV1`

**作用**：输出最终 reply 和 debug log，把 candidate patch 放入 pending output。

| 方向   | port                   | dataType      | 说明           |
| ------ | ---------------------- | ------------- | -------------- |
| input  | `replyDraft`           | `draft`       | 回复草稿       |
| input  | `candidateStatePatch`  | `json`        | 候选状态 patch |
| input  | `candidateMemoryPatch` | `json`        | 候选记忆 patch |
| input  | `usedWorldbookEntries` | `json`        | 命中世界书     |
| input  | `recalledMemories`     | `json`        | 召回记忆       |
| input  | `sceneState`           | `scene_state` | 使用的场景状态 |
| output | `reply`                | `final_text`  | 最终 RP 回复   |
| output | `finalOutput`          | `json`        | 完整输出对象   |
| output | `debugLog`             | `debug_info`  | 调试日志       |

最终输出结构：

```json
{
  "reply": "沈青璃没有立刻回答。她把袖口从你指尖能碰到的距离移开一点，却没有再退后。\n\n“你看见了？”她的声音压得很低，像怕惊动演武场尽头尚未熄灭的灯。“我不是躲你，只是有些话一旦说出口，就不能当作没发生过。”",
  "usedWorldbookEntries": [],
  "recalledMemories": [],
  "usedSceneState": {},
  "pendingPatches": {
    "candidateStatePatch": {},
    "candidateMemoryPatch": {}
  },
  "debugLog": []
}
```

## default-rp-workflow-v1

保存位置：

```text
plugins/rp-runtime-v1/workflows/default-rp-workflow-v1.json
```

图结构：

```text
User Input
  → rpInputParserV1
  → characterCardLoaderV1
  → sceneStateReaderV1
  → worldbookSearchV1
  → memoryRecallV1
  → rpContextAssemblerV1
  → rpDialogueDirectorV1
  → rpOutputRendererV1
```

实际连线：

```text
user_1.text → parser_1.userInput
parser_1.parsedInput → worldbook_1.parsedInput
parser_1.parsedInput → memory_1.parsedInput
parser_1.parsedInput → assembler_1.parsedInput
character_1.characterProfile → worldbook_1.characterProfile
character_1.characterProfile → assembler_1.characterProfile
scene_1.sceneState → worldbook_1.sceneState
scene_1.sceneState → assembler_1.sceneState
scene_1.sceneState → renderer_1.sceneState
worldbook_1.loreContext → assembler_1.loreContext
worldbook_1.usedWorldbookEntries → renderer_1.usedWorldbookEntries
memory_1.memoryContext → assembler_1.memoryContext
memory_1.recalledMemories → renderer_1.recalledMemories
assembler_1.rpContextBundle → director_1.rpContextBundle
director_1.replyDraft → renderer_1.replyDraft
director_1.candidateStatePatch → renderer_1.candidateStatePatch
director_1.candidateMemoryPatch → renderer_1.candidateMemoryPatch
```

## Debug / Trace 规范

每个节点必须输出 metadata：

```json
{
  "pluginId": "awp.rp-runtime-v1",
  "debug": {
    "inputSummary": "parsedInput 包含 1 个目标对象；命中 1 条世界书；召回 1 条关系记忆。",
    "outputSummary": "生成 replyDraft，并输出 1 条 candidateStatePatch 与 1 条 candidateMemoryPatch。",
    "durationMs": 12,
    "error": null
  },
  "views": [
    {
      "id": "trace",
      "kind": "trace",
      "title": "节点执行轨迹",
      "steps": []
    },
    {
      "id": "input_summary",
      "kind": "object",
      "title": "输入摘要",
      "value": {}
    },
    {
      "id": "output_summary",
      "kind": "object",
      "title": "输出摘要",
      "value": {}
    }
  ]
}
```

检索类节点额外输出：

- `entry-list` view：命中的 worldbook / memory 条目
- `stats` view：检索词、命中数、条目总数

Agent 节点额外输出：

- `code` view：assembled prompt preview
- `object` view：candidate patches
- `stats` view：输出长度、patch 数量、使用 block 数量

## Demo 数据

### `demo/characters.json`

包含一个 demo 角色：`senior_sister`。

### `demo/scenes.json`

包含一个 demo 场景：`training_hall_evening`。

### `demo/worldbook.json`

包含与师姐回避、演武场、禁地调查相关的世界书条目。

### `demo/memories.json`

包含玩家与师姐近期互动、关系变化、未解决伏笔等只读记忆。

## 验收输入

测试输入：

```text
我走到师姐身边，低声问她刚才为什么躲着我。
```

## 验收输出要求

运行 `default-rp-workflow-v1` 后必须能得到：

```json
{
  "reply": "沈青璃没有立刻回答。她把袖口从你指尖能碰到的距离移开一点，却没有再退后。\n\n“你看见了？”她的声音压得很低，像怕惊动演武场尽头尚未熄灭的灯。“我不是躲你，只是有些话一旦说出口，就不能当作没发生过。”",
  "usedWorldbookEntries": [],
  "recalledMemories": [],
  "usedSceneState": {},
  "pendingPatches": {
    "candidateStatePatch": {},
    "candidateMemoryPatch": {}
  },
  "debugLog": []
}
```

并且满足：

1. `reply` 是一段稳定、有状态、有世界观感的 RP 回复。
2. `usedWorldbookEntries` 非空，能解释本轮用了哪些设定。
3. `recalledMemories` 非空，能解释本轮用了哪些记忆。
4. `usedSceneState` 与 demo scene 一致。
5. `candidateStatePatch.commitPolicy === "pending"`。
6. `candidateMemoryPatch` 内所有候选记忆均为 pending。
7. 没有任何节点写入正式 data/state/memories 文件。
8. 每个节点可单独测试。

## 测试策略

### 节点单测

`plugins/rp-runtime-v1/executor.test.mjs` 应至少覆盖：

- `rpInputParserV1` 输出 parsedInput。
- `characterCardLoaderV1` 读取 demo character。
- `sceneStateReaderV1` 读取 demo scene。
- `worldbookSearchV1` 输出 loreContext 和 usedWorldbookEntries。
- `memoryRecallV1` 输出 memoryContext 和 recalledMemories。
- `rpContextAssemblerV1` 输出 blocks 和 usedContext。
- `rpDialogueDirectorV1` 输出 replyDraft 和 candidate patches。
- `rpOutputRendererV1` 输出 finalOutput、reply、debugLog。

### Workflow 测试

可新增一个工作流级测试，加载：

```text
plugins/rp-runtime-v1/workflows/default-rp-workflow-v1.json
```

用 mock context / mock Agent 跑通全链路，断言：

- final reply 存在
- usedWorldbookEntries 非空
- recalledMemories 非空
- pendingPatches 存在
- 未写入任何正式状态文件

## 与未来多 Agent 的兼容

当前默认 workflow 是单核心 Agent，但 `rpDialogueDirectorV1` 输出结构保留：

- `agentRole`
- `agentId`
- `rationale`
- `candidateStatePatch`
- `candidateMemoryPatch`

未来可以连接：

```text
rpContextBundle
  ├→ RPDialogueDirectorV1(agentRole=world_writer)
  ├→ RPDialogueDirectorV1(agentRole=persona_writer)
  └→ RPDialogueDirectorV1(agentRole=memory_sensitive_writer)
       ↓
    RPMergeDirectorV1
       ↓
    RPOutputRendererV1
```

或者：

```text
RPDialogueDirectorV1
  → RPContinuityReviewerV1
  → RPPatchProposerV1
  → RPOutputRendererV1
```

这些是后续扩展，不属于第一版实现范围。

## 设计结论

第一版采用：

```text
独立插件 rp-runtime-v1
+ 8 个可复用 RP workflow 节点
+ demo 只读数据
+ default-rp-workflow-v1 JSON 样板
+ 单核心 Agent
+ candidate patch pending 输出
+ debug trace 全链路可见
```

该方案满足当前目标：

- 不改核心代码
- 不污染正式状态
- 可导入、可运行、可调试、可复制
- 保持工作流 RP 的平台定位
