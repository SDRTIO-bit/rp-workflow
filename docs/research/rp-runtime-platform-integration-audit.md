# RP Runtime Platform Integration Audit

> Phase I-1: 只读检查，输出最小接入方案

---

## 1. 实际读取的文件路径

### apps/web

| 文件                                         | 用途                  |
| -------------------------------------------- | --------------------- |
| `apps/web/package.json`                      | 依赖声明              |
| `apps/web/tsconfig.json`                     | TypeScript 引用       |
| `apps/web/src/App.tsx`                       | 主组件，节点注册入口  |
| `apps/web/src/workflowFile.ts`               | 工作流 JSON 导入/导出 |
| `apps/web/src/runWorkflowClient.ts`          | Server API 客户端     |
| `apps/web/src/runtime/localNodeExecutors.ts` | 本地执行器            |

### apps/server

| 文件                                         | 用途                         |
| -------------------------------------------- | ---------------------------- |
| `apps/server/package.json`                   | 依赖声明                     |
| `apps/server/tsconfig.json`                  | TypeScript 引用              |
| `apps/server/src/index.ts`                   | 服务入口，composition root   |
| `apps/server/src/routes/nodes.ts`            | `/api/nodes` 节点列表        |
| `apps/server/src/routes/workflow.ts`         | `/api/run-workflow` 执行路由 |
| `apps/server/src/services/workflowRunner.ts` | 执行器创建和工作流运行       |
| `apps/server/src/services/pluginLoader.ts`   | 插件加载机制                 |

### packages

| 文件                                   | 用途                      |
| -------------------------------------- | ------------------------- |
| `packages/workflow-core/src/runner.ts` | `runWorkflow()` 实现      |
| `packages/workflow-core/src/types.ts`  | `WorkflowRunContext` 定义 |
| `packages/rp-runtime/src/index.ts`     | RP 包导出                 |
| `packages/rp-runtime/package.json`     | RP 包配置                 |

### 根目录

| 文件                  | 用途               |
| --------------------- | ------------------ |
| `package.json`        | workspace 配置     |
| `pnpm-workspace.yaml` | pnpm workspace     |
| `tsconfig.json`       | project references |

---

## 2. 当前 Web 节点注册数据流

```
┌─────────────────────────────────────────────────────────────────┐
│ App.tsx                                                          │
│                                                                   │
│ 1. 初始化:                                                        │
│    builtinNodeDefinitions = Object.values(nodeRegistry)          │
│    nodeDefinitions = useState(builtinNodeDefinitions)            │
│                                                                   │
│ 2. 启动时从 Server 加载:                                          │
│    loadedNodes = await loadNodeManifestsViaServer()              │
│    if (loadedNodes?.length) setNodeDefinitions(loadedNodes)      │
│                                                                   │
│ 3. 构建 runtimeNodeCatalog:                                       │
│    runtimeNodeCatalog = Object.fromEntries(                       │
│      nodeDefinitions.map(d => [d.type, d])                       │
│    )                                                               │
│                                                                   │
│ 4. 用于:                                                          │
│    - validateWorkflow(workflow, runtimeNodeCatalog)              │
│    - 节点面板渲染                                                  │
│    - 端口连接验证                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    GET /api/nodes
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ apps/server/src/routes/nodes.ts                                  │
│                                                                   │
│ return c.json({                                                   │
│   nodes: Object.values(runtimeNodeCatalog),                     │
│   plugins: ...                                                    │
│ })                                                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ apps/server/src/index.ts                                         │
│                                                                   │
│ runtimeNodeCatalog = { ...nodeRegistry, ...pluginCatalog }      │
└─────────────────────────────────────────────────────────────────┘
```

### 关键发现

- 前端**已有**从 Server 动态加载节点定义的机制
- Server 的 `runtimeNodeCatalog` = `nodeRegistry` + `pluginCatalog`
- 如果 Server 注册了 RP 节点，前端会**自动获取**

---

## 3. 当前 Server 执行数据流

```
┌─────────────────────────────────────────────────────────────────┐
│ POST /api/run-workflow                                           │
│                                                                   │
│ Body: { workflow: WorkflowDefinition }                          │
│                                                                   │
│ ⚠️ 当前没有传递 WorkflowRunContext                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ apps/server/src/routes/workflow.ts                               │
│                                                                   │
│ const context: WorkflowRunnerContext = { apiKey, model, ... }   │
│ const executors = await createExecutors(workflow, context)      │
│ const result = await runWorkflow(workflow, executors, catalog)  │
│                                                                   │
│ ⚠️ runWorkflow 第 4 个参数 (WorkflowRunContext) 未传递          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ apps/server/src/services/workflowRunner.ts                       │
│                                                                   │
│ createExecutors() 返回 Record<string, NodeExecutor>             │
│                                                                   │
│ 每个 executor 签名:                                               │
│ async ({ node, inputs }) => ({ outputs, metadata })             │
│                                                                   │
│ ⚠️ 没有解构 context 参数                                        │
│ ⚠️ 没有传递 context 给 executor                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 关键问题

1. **Server 不传递 WorkflowRunContext** - RP 节点需要 `context.values.rp` 获取 sessionId/worldId/turnId
2. **Server 没有注册 RP 节点** - `runtimeNodeCatalog` 不包含 RP 节点
3. **Server 没有 RP executors** - `createExecutors()` 不返回 RP 执行器

---

## 4. 当前工作流加载数据流

```
┌─────────────────────────────────────────────────────────────────┐
│ 工作流 JSON 格式                                                  │
│                                                                   │
│ {                                                                 │
│   "kind": "agent-workflow-platform.workflow",                   │
│   "version": 1,                                                   │
│   "workflow": {                                                   │
│     "id": "...",                                                  │
│     "nodes": [{ "id", "type", "config", "position" }],          │
│     "edges": [{ "id", "source", "sourcePort", ... }]            │
│   }                                                               │
│ }                                                                 │
│                                                                   │
│ ⚠️ 当前 schemaId 存储在 PortDefinition 中，不在节点/边中        │
└─────────────────────────────────────────────────────────────────┘
```

### schemaId 存储位置

- `NodeDefinition.ports[].schemaId` - 端口定义中
- 工作流 JSON 只存储 `node.type` 和 `edge.sourcePort/targetPort`
- schemaId 通过 `node.type` 从 catalog 查找

### 结论

- schemaId **不需要**存储在工作流 JSON 中
- 只要节点类型正确，schemaId 会自动从 catalog 获取
- JSON 往返不会丢失 schemaId

---

## 5. RP Runtime 的最小接入点

### Server 接入点

| 接入点             | 文件                                         | 修改内容                                                                   |
| ------------------ | -------------------------------------------- | -------------------------------------------------------------------------- |
| 1. 依赖声明        | `apps/server/package.json`                   | 添加 `@awp/rp-runtime`                                                     |
| 2. TS 引用         | `apps/server/tsconfig.json`                  | 添加 rp-runtime 引用                                                       |
| 3. 初始化 Services | `apps/server/src/index.ts`                   | 创建 `RpRuntimeServices`，调用 `registerRpRuntime()`                       |
| 4. 合并 Catalog    | `apps/server/src/index.ts`                   | `runtimeNodeCatalog = { ...nodeRegistry, ...rpCatalog, ...pluginCatalog }` |
| 5. 注册 Executors  | `apps/server/src/services/workflowRunner.ts` | 在 `createExecutors()` 中合并 RP executors                                 |
| 6. 传递 Context    | `apps/server/src/routes/workflow.ts`         | 从请求读取 context，传递给 `runWorkflow()`                                 |
| 7. Executor 签名   | `apps/server/src/services/workflowRunner.ts` | executor 解构并传递 `context`                                              |

### Web 接入点

| 接入点 | 文件 | 修改内容                                       |
| ------ | ---- | ---------------------------------------------- |
| 无     | -    | 前端已支持从 Server 动态加载节点，**无需修改** |

---

## 6. 必须修改的文件

| 文件                                         | 修改类型      | 原因                            |
| -------------------------------------------- | ------------- | ------------------------------- |
| `apps/server/package.json`                   | 添加依赖      | 引入 `@awp/rp-runtime`          |
| `apps/server/tsconfig.json`                  | 添加引用      | TypeScript 编译需要             |
| `apps/server/src/index.ts`                   | 添加初始化    | 注册 RP runtime services        |
| `apps/server/src/services/workflowRunner.ts` | 修改 executor | 合并 RP executors，传递 context |
| `apps/server/src/routes/workflow.ts`         | 修改路由      | 从请求读取 WorkflowRunContext   |

---

## 7. 可以不修改的文件

| 文件                       | 原因                      |
| -------------------------- | ------------------------- |
| `apps/web/*`               | 前端已支持动态加载节点    |
| `packages/workflow-core/*` | 已支持 WorkflowRunContext |
| `packages/rp-runtime/*`    | 已完成实现                |

---

## 8. 当前阻塞问题

### 无严重架构阻塞

workflow-core 已完整支持：

- `WorkflowRunContext` 类型定义 ✅
- `runWorkflow()` 第 4 参数 context ✅
- `NodeExecutionInput.context` 传递给 executor ✅

Server 需要做的只是：

1. 从请求读取 context
2. 传递给 `runWorkflow()`
3. executor 解构 context 参数

---

## 9. 最小实现计划

### Phase I-2 步骤

1. **添加依赖**
   - `apps/server/package.json`: `"@awp/rp-runtime": "*"`
   - `apps/server/tsconfig.json`: 添加 reference

2. **Server 初始化 RP Runtime**
   - 在 `index.ts` 中创建 `RpRuntimeServices`
   - 调用 `registerRpRuntime(services)`
   - 合并到 `runtimeNodeCatalog`

3. **修改 workflowRunner.ts**
   - `createExecutors()` 返回合并 RP executors
   - 每个 executor 签名改为 `async ({ node, inputs, context }) => ...`

4. **修改 workflow.ts 路由**
   - 从请求 body 读取 `context`
   - 传递给 `runWorkflow(workflow, executors, catalog, context)`

5. **创建 Smoke Workflow JSON**
   - `data/workflows/rp-foundation-smoke-workflow-v1.json`

6. **创建 Demo 脚本**
   - `packages/rp-runtime/demo/runRpFoundationSmokeWorkflow.ts`

---

## 10. 不进行无关重构的理由

| 不重构项          | 理由                                     |
| ----------------- | ---------------------------------------- |
| 前端节点加载机制  | 已支持动态加载，无需修改                 |
| workflow-core API | 已支持 context，无需修改                 |
| 插件系统          | RP 作为内置包直接注册，不走插件机制      |
| Server 路由结构   | 只修改现有路由的参数传递，不改变路由结构 |

---

## 总结

| 维度        | 状态                  |
| ----------- | --------------------- |
| 架构可行性  | ✅ 可行，无阻塞       |
| 前端改动    | ✅ 无需改动           |
| Server 改动 | ⚠️ 5 个文件需要修改   |
| 工作量      | 小，约 100-150 行代码 |
| 风险        | 低，只是扩展现有机制  |

**结论：可以直接进入 Phase I-2 实施最小集成。**
