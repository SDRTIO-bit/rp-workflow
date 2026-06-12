# RP Runtime 交接文档

> 本文档面向接手 Phase B 及后续工作的 AI 或开发者。
> 生成时间：Phase A 完成后。

---

## 1. 项目概况

### 1.1 项目定位

**Agent Workflow Platform** — 一个 ComfyUI 式智能体工作流平台。

核心理念：平台提供节点、连线、数据类型、工作流保存/加载、Agent 节点包装、skill/插件分配、运行记录。用户负责决定工作流怎么搭，平台负责让这个工作流能运行。

### 1.2 Monorepo 结构

```
agent-workflow-platform/
├── apps/
│   ├── server/              # Express 后端
│   └── web/                 # React 前端
├── packages/
│   ├── workflow-core/       # 节点类型、注册表、调度器、运行器
│   ├── agent-runtime/       # LLM 适配器（mock + deepseek）
│   ├── plugin-sdk/          # 插件/技能定义、执行器工厂
│   ├── memory-core/         # 记忆条目类型、排序算法
│   ├── db/                  # 持久化类型
│   └── rp-runtime/          # 【新增】RP 节点包（Phase A 骨架）
├── docs/
│   └── research/
│       └── aventura-to-rp-workflow-mapping.md  # 参考仓库映射分析
├── references/              # 参考项目（只读）
│   └── references/
│       ├── timeline-memory-master/
│       └── timeline-extension-prompts-master/
├── tsconfig.json            # 根 tsconfig，含 project references
├── pnpm-workspace.yaml      # workspace 配置
└── package.json             # 根脚本
```

### 1.3 技术栈

| 项     | 值                            |
| ------ | ----------------------------- |
| 语言   | TypeScript (strict)           |
| 模块   | ESM (`"type": "module"`)      |
| 构建   | `tsc -b` (composite projects) |
| 测试   | vitest                        |
| 包管理 | npm workspaces                |
| 目标   | ES2022                        |

### 1.4 根命令

```bash
npm run typecheck    # tsc -b --pretty false（全项目类型检查）
npm run build        # 构建所有 workspace
npm run test         # 测试所有 workspace
npm run lint         # eslint
npm run format       # prettier
```

---

## 2. Phase A 完成的工作

### 2.1 workflow-core 改动（4 个文件）

#### `packages/workflow-core/src/types.ts`

新增/修改了 3 处：

```typescript
// 1. PortDefinition 新增 schemaId
export type PortDefinition = {
  id: string;
  label: string;
  direction: PortDirection;
  dataType: DataType;
  required?: boolean;
  schemaId?: string; // ← 新增
};

// 2. 新增 WorkflowRunContext
export type WorkflowRunContext = {
  runId?: string;
  values?: Readonly<Record<string, unknown>>;
};

// 3. NodeExecutionInput 新增 context
export type NodeExecutionInput = {
  node: WorkflowNode;
  inputs: Record<string, unknown>;
  context?: WorkflowRunContext; // ← 新增
};
```

#### `packages/workflow-core/src/nodeRegistry.ts`

- 新增 `validatePortSchemaId()` 函数：schemaId 只能用在 `dataType: "json"` 的端口上
- `areTypesCompatibility()` 增加 2 个可选参数 `sourceSchemaId`、`targetSchemaId`
- 完整兼容矩阵：

| sourceSchemaId | targetSchemaId | 结果                   |
| -------------- | -------------- | ---------------------- |
| 有             | 有             | 相同则允许，不同则禁止 |
| 有             | 无             | 允许（降级）           |
| 无             | 有             | 禁止                   |
| 无             | 无             | 沿用原有规则           |
| 任一存在       | 非 json 类型   | 禁止                   |

#### `packages/workflow-core/src/validation.ts`

- `validateWorkflow()` 现在对每条边检查 schemaId 兼容性
- 错误信息包含双方 schemaId
- 新增端口级 schemaId 约束校验

#### `packages/workflow-core/src/runner.ts`

- `runWorkflow()` 新增第 4 个可选参数 `context?: WorkflowRunContext`
- 同一个 context 对象传递给每个 NodeExecutor
- 不传 context 时行为完全不变（向后兼容）

### 2.2 新增 @awp/rp-runtime 包

```
packages/rp-runtime/
├── package.json
├── tsconfig.json
├── tsconfig.test.json
├── src/
│   ├── index.ts              # 汇总导出
│   ├── types.ts              # 所有 RP 类型（203 行）
│   ├── schemas.ts            # 9 个 schema validator（219 行）
│   ├── register.ts           # registerRpRuntime()
│   ├── stores/
│   │   ├── types.ts          # Store 接口（100 行）
│   │   ├── memory.ts         # 内存实现（250+ 行）
│   │   └── index.ts
│   └── nodes/
│       └── index.ts          # 空（Phase B 填充）
└── tests/
    ├── schema.test.ts        # 13 个测试
    ├── stores.test.ts        # 17 个测试
    └── register.test.ts      # 5 个测试
```

### 2.3 映射文档

`docs/research/aventura-to-rp-workflow-mapping.md` — 基于实际读取的参考仓库代码，列出每个模块的职责、数据流、对应我方节点、采用/重写/不采用的决策。

### 2.4 验证结果

| 命令                            | 结果                   |
| ------------------------------- | ---------------------- |
| `npm run build` (workflow-core) | ✅                     |
| `npm run test` (workflow-core)  | ✅ 19/19               |
| `npm run build` (rp-runtime)    | ✅                     |
| `npm run test` (rp-runtime)     | ✅ 35/35               |
| `npm run typecheck` (根目录)    | ✅                     |
| `npm run test` (根目录)         | ✅ 全部 workspace 通过 |

---

## 3. 核心架构决策

### 3.1 插件类型系统：schemaId 方案

**不修改 `DataType` 联合类型**。RP 专用类型通过 `dataType: "json" + schemaId` 标识。

```typescript
// 端口定义示例
{
  id: "parsedInput",
  label: "Parsed Input",
  dataType: "json",
  direction: "output",
  schemaId: "rp.parsed-input.v1"
}
```

已注册的 schemaId：

| schemaId                  | 对应类型           |
| ------------------------- | ------------------ |
| `rp.parsed-input.v1`      | `ParsedInput`      |
| `rp.timeline-context.v1`  | `TimelineContext`  |
| `rp.lore-context.v1`      | `LoreContext`      |
| `rp.tracker-state.v1`     | `TrackerState`     |
| `rp.tracker-patch.v1`     | `TrackerPatch`     |
| `rp.memory-event.v1`      | `MemoryEvent`      |
| `rp.assembled-context.v1` | `AssembledContext` |
| `rp.budget-report.v1`     | `BudgetReport`     |
| `rp.writer-output.v1`     | `WriterOutput`     |

### 3.2 注册与运行分离

```
registerRpRuntime(services)   ← 注册阶段，只注入稳定服务
         ↓
{ catalog, executors, schemas }
         ↓
runWorkflow(graph, executors, catalog, context)   ← 运行阶段，传入 scope
```

- **注册阶段**：`registerRpRuntime(services: RpRuntimeServices)` 只接收 Store 等稳定服务
- **运行阶段**：`WorkflowRunContext.values.rp` 携带 `RpExecutionScope`

```typescript
// 运行时从 context 读取 scope
const scope = input.context?.values?.rp as RpExecutionScope | undefined;
// scope = { sessionId, worldId, turnId }
```

**关键约束**：

- 闭包只能捕获 Store，不能捕获 sessionId/worldId
- 每次运行传不同的 context，支持多会话并发
- 不使用全局可变状态，不使用 AsyncLocalStorage

### 3.3 Store 接口设计

所有 Store 方法使用 request object 模式：

```typescript
interface TimelineStore {
  putEvent(request: { sessionId: string; worldId: string; event: MemoryEvent }): Promise<void>;
  queryEvents(request: {
    sessionId: string;
    worldId: string;
    query: string;
    limit: number;
  }): Promise<MemoryEvent[]>;
  getEventsByChapter(request: {
    sessionId: string;
    worldId: string;
    chapterId: string;
  }): Promise<MemoryEvent[]>;
}
```

**幂等约束**：

- `putEvent` 按 `eventId` 去重，相同 eventId 不产生重复记录
- 所有写入按 `sessionId + worldId` 隔离

当前实现：`InMemoryTimelineStore`、`InMemoryChapterStore`、`InMemoryLoreStore`、`InMemoryTrackerStore`（内存 Map）。

---

## 4. 待实现的节点（Phase B）

### 4.1 节点清单

| 节点 type              | 职责                         | 输入端口                                                        | 输出端口                                                           |
| ---------------------- | ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `rpInputParserV1`      | 解析用户输入，提取实体/意图  | `rawInput: json[schemaId]`                                      | `parsedInput: json[schemaId]`                                      |
| `rpTimelineQueryV1`    | 检索相关章节记忆             | `parsedInput: json[schemaId]`                                   | `timelineContext: json[schemaId]`                                  |
| `rpLoreRetrieverV1`    | 检索世界书/角色卡/设定       | `parsedInput: json[schemaId]`                                   | `loreContext: json[schemaId]`                                      |
| `rpTrackerUpdateV1`    | 更新状态追踪（只输出 patch） | `parsedInput: json[schemaId]`, `currentState: json[schemaId]`   | `trackerPatch: json[schemaId]`                                     |
| `rpContextAssemblerV1` | 组装最终上下文               | `parsedInput`, `timelineContext`, `loreContext`, `trackerState` | `assembledContext: json[schemaId]`, `budgetReport: json[schemaId]` |
| `rpWriterV1`           | 调用 LLM 生成正文            | `assembledContext: json[schemaId]`                              | `writerOutput: json[schemaId]`                                     |
| `rpChapterSummaryV1`   | 压缩本轮为 memoryEvent       | `parsedInput`, `writerOutput`                                   | `memoryEvent: json[schemaId]`, `chapterPatch: json`                |
| `rpMemoryCommitV1`     | 写入存储（纯代码，不调模型） | `memoryEvent`, `chapterPatch`, `trackerPatch`                   | `commitResult: json`                                               |

### 4.2 实现顺序建议

```
Phase B-1（最小可运行）:
  rpInputParserV1 → rpContextAssemblerV1 → rpWriterV1
  （输入 → 解析 → 组装 → 生成）

Phase B-2（检索接入）:
  rpTimelineQueryV1, rpLoreRetrieverV1
  （接入 Store，真正检索记忆和世界书）

Phase B-3（写入闭环）:
  rpChapterSummaryV1, rpMemoryCommitV1, rpTrackerUpdateV1
  （记忆写入、状态更新、存储提交）
```

### 4.3 工作流模板

Phase B 完成后需要创建 `data/workflows/default-rp-memory-workflow-v1.json`：

```
userInput → rpInputParserV1 → [rpTimelineQueryV1, rpLoreRetrieverV1, rpTrackerUpdateV1]
                                       ↓
                              rpContextAssemblerV1
                                       ↓
                                 rpWriterV1
                                ↙        ↘
              rpChapterSummaryV1    rpTrackerUpdateV1(后更新)
                    ↓                    ↓
                    └──→ rpMemoryCommitV1 ←──┘
```

### 4.4 节点实现模式

每个节点文件导出两部分：

```typescript
// 1. NodeDefinition（给 catalog 用）
export const rpInputParserV1Definition: NodeDefinition = {
  type: "rpInputParserV1",
  label: "RP Input Parser",
  // ...
  ports: [
    {
      id: "rawInput",
      label: "Raw Input",
      dataType: "json",
      direction: "input",
      schemaId: "rp.user-input.v1",
    },
    {
      id: "parsedInput",
      label: "Parsed Input",
      dataType: "json",
      direction: "output",
      schemaId: "rp.parsed-input.v1",
    },
  ],
};

// 2. Executor 工厂（给 executors 用）
export function createRpInputParserV1Executor(services: RpRuntimeServices): NodeExecutor {
  return async ({ node, inputs, context }) => {
    const scope = extractScope(context);
    const rawText = inputs.rawInput as string;
    // ... 解析逻辑
    validateSchema("rp.parsed-input.v1", parsed);
    return { outputs: { parsedInput: parsed } };
  };
}
```

**从 context 提取 scope 的工具函数**（需要在 Phase B 中创建）：

```typescript
function extractScope(context: WorkflowRunContext | undefined): RpExecutionScope {
  const rp = context?.values?.rp;
  if (!rp || typeof rp !== "object") {
    throw new Error("Missing rp scope in WorkflowRunContext.values");
  }
  const { sessionId, worldId, turnId } = rp as Record<string, unknown>;
  if (typeof sessionId !== "string" || typeof worldId !== "string" || typeof turnId !== "string") {
    throw new Error("Invalid rp scope: sessionId, worldId, turnId must be strings");
  }
  return { sessionId, worldId, turnId };
}
```

### 4.5 registerRpRuntime 填充

Phase B 需要修改 `register.ts`，将节点定义和执行器填入：

```typescript
export function registerRpRuntime(services: RpRuntimeServices): RpRuntimeRegistration {
  return {
    catalog: {
      rpInputParserV1: rpInputParserV1Definition,
      rpTimelineQueryV1: rpTimelineQueryV1Definition,
      // ...
    },
    executors: {
      rpInputParserV1: createRpInputParserV1Executor(services),
      rpTimelineQueryV1: createRpTimelineQueryV1Executor(services),
      // ...
    },
    schemas: { ...schemaValidators },
  };
}
```

---

## 5. 关键约束清单

### 5.1 不能做的事

| 禁止                                          | 原因                     |
| --------------------------------------------- | ------------------------ |
| 向 `DataType` 联合类型添加 RP 专用类型        | 用 schemaId 方案替代     |
| 在 `registerRpRuntime` 闭包中捕获 sessionId   | scope 属于运行阶段       |
| 节点内部创建全局单例 Store                    | Store 通过 services 注入 |
| 直接修改 workflow-core/agent-runtime 核心逻辑 | 通过接口扩展             |
| 复制参考仓库代码                              | 只借鉴架构思想           |
| 在非 json 端口使用 schemaId                   | 验证会报错               |
| `rpMemoryCommitV1` 调用 LLM                   | 纯代码节点               |
| `rpTrackerUpdateV1` 输出完整 state            | 只输出 patch             |

### 5.2 必须遵守的

| 要求                                | 说明                                |
| ----------------------------------- | ----------------------------------- |
| 所有 Store 方法使用 request object  | `{ sessionId, worldId, ... }`       |
| `putEvent` 按 eventId 幂等去重      | 相同 eventId 不产生重复             |
| Executor 输入输出边界做 schema 校验 | 调用 `validateSchema()`             |
| 节点可复用                          | 不绑定特定角色卡或世界              |
| 包内依赖用 `"*"`                    | npm workspaces 不支持 `workspace:*` |
| 测试覆盖隔离和幂等                  | sessionId/worldId 隔离              |

---

## 6. 参考仓库关键发现

### 6.1 读取过的文件

| 文件                                                  | 关键内容                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `timeline-memory-master/src/memories.js`              | 章节时间线管理、摘要生成、分块逻辑、Timeline Fill、Arc Analyzer |
| `timeline-memory-master/src/lore-management.js`       | AI Agent 自主编辑 lorebook（list/create/update/delete）         |
| `timeline-memory-master/src/agentic-timeline-fill.js` | Agent 式检索（工具调用循环）                                    |
| `timeline-memory-master/src/commands.js`              | 斜杠命令和工具函数注册                                          |
| `timeline-memory-master/src/settings.js`              | 配置管理、预设系统                                              |
| `timeline-extension-prompts-master/*.json`            | 提示词模板参考                                                  |

### 6.2 映射决策

| 参考模块                | 我方节点               | 决策                               |
| ----------------------- | ---------------------- | ---------------------------------- |
| Chapter Timeline        | `rpChapterSummaryV1`   | 重写（用 Store 替代 chatMetadata） |
| Timeline Fill           | `rpTimelineQueryV1`    | 重写（用端口数据流替代宏注入）     |
| Lore Management (read)  | `rpLoreRetrieverV1`    | 部分采用（只读）                   |
| Lore Management (write) | —                      | 延后                               |
| Inject at Depth         | `rpContextAssemblerV1` | 重写（预算制替代深度注入）         |
| Agentic Session         | —                      | 不采用（DAG 不适合会话模型）       |
| Arc Analyzer            | —                      | 延后                               |

详细映射文档：`docs/research/aventura-to-rp-workflow-mapping.md`

---

## 7. 快速开始

### 7.1 实现第一个节点（rpInputParserV1）

1. 创建 `packages/rp-runtime/src/nodes/rpInputParserV1.ts`
2. 导出 `rpInputParserV1Definition: NodeDefinition` 和 `createRpInputParserV1Executor`
3. 在 `nodes/index.ts` 中导出
4. 在 `register.ts` 中注册到 catalog 和 executors
5. 编写 `tests/rpInputParserV1.test.ts`
6. 运行 `npm run build && npm run test`

### 7.2 MVP 解析器（不需要 LLM）

```typescript
// 最小实现：正则提取
function parseInput(rawText: string): ParsedInput {
  const dialogues: DialogueLine[] = [];
  const dialogueRegex = /["""]([^"""]+)["""]\s*(?:\S+说)?/g;
  let match;
  while ((match = dialogueRegex.exec(rawText)) !== null) {
    dialogues.push({ speaker: "unknown", text: match[1] });
  }

  return {
    rawText,
    actions: [], // MVP: 不提取
    dialogues,
    intents: [], // MVP: 不提取
    entities: { characters: [], locations: [], items: [], timeHints: [] },
    parsedAt: new Date().toISOString(),
  };
}
```

### 7.3 运行 demo（Phase B 完成后）

```typescript
import { runWorkflow } from "@awp/workflow-core";
import { registerRpRuntime, InMemoryTimelineStore, ... } from "@awp/rp-runtime";

const services = {
  stores: {
    timeline: new InMemoryTimelineStore(),
    chapter: new InMemoryChapterStore(),
    lore: new InMemoryLoreStore(),
    tracker: new InMemoryTrackerStore(),
  },
};

const { catalog, executors } = registerRpRuntime(services);

const result = await runWorkflow(
  workflowDefinition,
  executors,
  catalog,
  {
    runId: "demo-run-1",
    values: {
      rp: { sessionId: "session-1", worldId: "world-1", turnId: "turn-1" },
    },
  },
);
```

---

## 8. 文件索引

### 修改的文件（Phase A）

| 文件                                               | 改动摘要                                              |
| -------------------------------------------------- | ----------------------------------------------------- |
| `packages/workflow-core/src/types.ts`              | +`WorkflowRunContext`、+`schemaId`、+`context`        |
| `packages/workflow-core/src/nodeRegistry.ts`       | +`validatePortSchemaId`、重写 `areTypesCompatibility` |
| `packages/workflow-core/src/validation.ts`         | schemaId 校验传入兼容性检查                           |
| `packages/workflow-core/src/runner.ts`             | +`context` 参数                                       |
| `packages/workflow-core/src/workflow-core.test.ts` | +12 个新测试                                          |
| `tsconfig.json`                                    | +rp-runtime reference                                 |

### 新增的文件（Phase A）

| 文件                                               | 用途              |
| -------------------------------------------------- | ----------------- |
| `docs/research/aventura-to-rp-workflow-mapping.md` | 参考仓库映射      |
| `packages/rp-runtime/package.json`                 | 包配置            |
| `packages/rp-runtime/tsconfig.json`                | 构建配置          |
| `packages/rp-runtime/tsconfig.test.json`           | 测试 typecheck    |
| `packages/rp-runtime/src/types.ts`                 | RP 类型定义       |
| `packages/rp-runtime/src/schemas.ts`               | Schema validators |
| `packages/rp-runtime/src/register.ts`              | 注册函数          |
| `packages/rp-runtime/src/stores/types.ts`          | Store 接口        |
| `packages/rp-runtime/src/stores/memory.ts`         | 内存实现          |
| `packages/rp-runtime/src/stores/index.ts`          | Store 导出        |
| `packages/rp-runtime/src/nodes/index.ts`           | 空（Phase B）     |
| `packages/rp-runtime/src/index.ts`                 | 包入口            |
| `packages/rp-runtime/tests/schema.test.ts`         | Schema 测试       |
| `packages/rp-runtime/tests/stores.test.ts`         | Store 测试        |
| `packages/rp-runtime/tests/register.test.ts`       | 注册测试          |
