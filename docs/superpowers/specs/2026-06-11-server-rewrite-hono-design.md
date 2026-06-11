# Server Rewrite: Hono + TypeScript

**日期**: 2026-06-11
**状态**: Approved

## 背景

当前后端 `apps/web/scripts/serve.mjs` 是 983 行原生 Node.js HTTP 服务器，存在以下问题：

- 手动路由匹配（`if/else` 链），无类型安全
- 纯 JavaScript，无 TypeScript 支持
- 不在 monorepo workspace 中，与内部包 `@awp/*` 的依赖关系通过运行时路径解析
- 无测试覆盖
- 静态文件服务、API 路由、业务逻辑全部混在一个文件中

前端已实现所有 API client（`runWorkflowClient.ts`、`memoryClient.ts`、`worldbookClient.ts`），API 契约稳定。需要用 Hono + TypeScript 重写后端，使其成为 monorepo 中的正式包。

## 决策

### 架构：独立 `apps/server` 包

在 monorepo 中新增 `apps/server`，与 `apps/web` 对等。Hono + `@hono/node-server` 作为运行时，TypeScript 编写，直接依赖 `@awp/*` 内部包。

### 数据存储：JSON 文件

延续现有方案，使用 `data/memories.json` 和 `data/worldbook.json`。路径解析策略：`env.ts` 中 `DATA_DIR` 默认值通过 `path.resolve(import.meta.dirname, '../../../data')` 从编译产物目录回溯到项目根，同时支持 `process.env.DATA_DIR` 环境变量覆盖。

### 迁移策略

- 保留 `serve.mjs` 作为参考
- 新代码在 `apps/server/` 独立开发
- 每个路由模块完成后对比 `serve.mjs` 行为验证一致性
- 全部完成后将 `npm run serve` 指向新入口，移除 `serve.mjs`
- 不改动前端代码——API 契约不变

## 包结构

```
apps/server/
├── package.json          # @awp/server
├── tsconfig.json
├── src/
│   ├── index.ts          # 入口：创建 Hono app，启动 @hono/node-server
│   ├── env.ts            # 环境变量：DATA_DIR、DEEPSEEK_API_KEY、DEEPSEEK_MODEL、PORT
│   ├── routes/
│   │   ├── workflow.ts   # POST /api/run-workflow, /api/run-workflow-stream
│   │   ├── memories.ts   # GET/POST /api/memories, PUT/DELETE /api/memories/:id
│   │   ├── worldbook.ts  # GET/POST /api/worldbook, PUT/DELETE /api/worldbook/:id
│   │   ├── plugins.ts    # GET /api/plugins, POST enable/disable, GET /api/skills, GET /api/nodes
│   │   ├── templates.ts  # GET /api/templates
│   │   └── llm.ts        # GET /api/llm/status, POST /api/llm/chat
│   └── services/
│       ├── jsonStore.ts      # JSON 文件读写抽象，基于 env.DATA_DIR
│       ├── pluginLoader.ts   # 插件/技能加载、执行器创建
│       └── workflowRunner.ts # 工作流执行引擎（含流式 NDJSON）
```

## 依赖

```
@awp/server
├── hono
├── @hono/node-server        # Node.js 适配器
├── @hono/node-server/serve-static  # 静态文件服务（生产模式）
├── @awp/workflow-core       # 工作流验证、调度、执行
├── @awp/agent-runtime       # Agent 执行、DeepSeek 适配器
├── @awp/memory-core         # 记忆排序
└── @awp/plugin-sdk          # 插件清单验证
```

## API 路由映射

### 记忆

| 方法   | 路径                | 请求体        | 响应                                              |
| ------ | ------------------- | ------------- | ------------------------------------------------- |
| GET    | `/api/memories`     | —             | `{ memories: MemoryEntry[] }`                     |
| POST   | `/api/memories`     | `MemoryDraft` | `{ memories: MemoryEntry[], entry: MemoryEntry }` |
| PUT    | `/api/memories/:id` | `MemoryDraft` | `{ memories: MemoryEntry[] }`                     |
| DELETE | `/api/memories/:id` | —             | `{ memories: MemoryEntry[] }`                     |

### 世界书

| 方法   | 路径                 | 请求体        | 响应                                             |
| ------ | -------------------- | ------------- | ------------------------------------------------ |
| GET    | `/api/worldbook`     | —             | `{ entries: MemoryEntry[] }`                     |
| POST   | `/api/worldbook`     | `MemoryDraft` | `{ entries: MemoryEntry[], entry: MemoryEntry }` |
| PUT    | `/api/worldbook/:id` | `MemoryDraft` | `{ entries: MemoryEntry[] }`                     |
| DELETE | `/api/worldbook/:id` | —             | `{ entries: MemoryEntry[] }`                     |

### 插件与技能

| 方法 | 路径                       | 响应                                                       |
| ---- | -------------------------- | ---------------------------------------------------------- |
| GET  | `/api/plugins`             | `{ plugins: PluginSummary[] }`                             |
| POST | `/api/plugins/:id/enable`  | `{ id, enabled, manifestEnabled, stateSource, nodeTypes }` |
| POST | `/api/plugins/:id/disable` | `{ id, enabled, manifestEnabled, stateSource, nodeTypes }` |
| GET  | `/api/skills`              | `{ skills: SkillSummary[], categories: string[] }`         |
| GET  | `/api/nodes`               | `{ nodes: NodeDefinition[], plugins: PluginMeta[] }`       |

### 工作流

| 方法 | 路径                       | 请求体         | 响应                                    |
| ---- | -------------------------- | -------------- | --------------------------------------- |
| POST | `/api/run-workflow`        | `{ workflow }` | `WorkflowRunResult`                     |
| POST | `/api/run-workflow-stream` | `{ workflow }` | NDJSON 流：`WorkflowStreamEvent`        |
| POST | `/api/workflows/validate`  | `{ workflow }` | `{ issues: WorkflowValidationIssue[] }` |

### 模板

| 方法 | 路径             | 响应                                |
| ---- | ---------------- | ----------------------------------- |
| GET  | `/api/templates` | `{ templates: WorkflowTemplate[] }` |

### LLM 代理

| 方法 | 路径              | 请求体                 | 响应                                     |
| ---- | ----------------- | ---------------------- | ---------------------------------------- |
| GET  | `/api/llm/status` | —                      | `{ configured: boolean, model: string }` |
| POST | `/api/llm/chat`   | `{ messages, model? }` | `{ text, metadata }` 或流式 NDJSON       |

## 开发模式

**双进程开发：**

```
npm run dev
  ├── Vite dev server (5173)    → 前端热更新
  └── Hono API server (5180)    → 后端 API + DeepSeek 代理
```

`apps/web/vite.config.ts` 添加 proxy：

```ts
server: {
  proxy: {
    '/api': 'http://127.0.0.1:5180'
  }
}
```

前端开发时请求 `/api/*` 透明代理到 Hono，无需 CORS 配置。

## 生产模式

`npm run build` 同时构建 web 前端和编译 server。

Hono 在生产环境通过 `serveStatic` 中间件服务前端构建产物，实现单端口全站服务：

```ts
// src/index.ts
import { serveStatic } from "@hono/node-server/serve-static";

if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "../web/dist" }));
}
```

`npm run serve`：启动 Hono 单进程，同时提供 API 和静态文件，完全替代原有 `serve.mjs`。

## 环境变量

| 变量               | 默认值                                                  | 说明              |
| ------------------ | ------------------------------------------------------- | ----------------- |
| `PORT`             | `5180`                                                  | 服务端口          |
| `DATA_DIR`         | `path.resolve(import.meta.dirname, '../../../data')`    | 数据文件目录      |
| `DEEPSEEK_API_KEY` | —                                                       | DeepSeek API 密钥 |
| `DEEPSEEK_MODEL`   | `deepseek-v4-flash`                                     | 默认模型          |
| `PLUGINS_DIR`      | `path.resolve(import.meta.dirname, '../../../plugins')` | 插件目录          |
| `NODE_ENV`         | `development`                                           | 运行环境          |

## 服务层设计

### jsonStore.ts

- `readEntries(filePath: string): Promise<Entry[]>` — 读取 JSON 文件，不存在返回空数组
- `writeEntries(filePath: string, entries: Entry[]): Promise<void>` — 写入 JSON 文件，自动创建目录
- `createEntry(body, prefix, fallbackTitle): Entry` — 创建带 id 和时间戳的条目
- `updateEntry(entry, body): Entry` — 更新条目字段和时间戳

### pluginLoader.ts

- `loadNodePlugins(pluginsDir): Promise<Plugin[]>` — 扫描插件目录，验证 node.plugin.json
- `loadSkillPlugins(pluginsDir): Promise<SkillItem[]>` — 扫描插件目录，验证 skill.plugin.json
- `createPluginCatalog(plugins): NodeCatalog` — 构建节点目录
- `createPluginExecutors(plugins, context): Promise<Record<string, NodeExecutor>>` — 创建插件执行器
- `reloadPluginRuntime(): Promise<void>` — 重新加载插件状态和执行器

### workflowRunner.ts

- `createExecutors(workflow, onToken?): Promise<Record<string, NodeExecutor>>` — 创建全部节点执行器
- `runWorkflowStreaming(workflow, executors, onEvent): Promise<WorkflowRunResult>` — 流式执行工作流
- `collectInputs(workflow, nodeId, outputsByNode): Record<string, unknown>` — 收集节点输入

## 测试策略

- 每个路由模块使用 Hono 的 `app.request()` 进行单元测试
- `jsonStore.ts` 使用临时目录测试文件读写
- `pluginLoader.ts` 使用 mock 插件目录测试加载和验证
- `workflowRunner.ts` 使用 mock LLM 适配器测试执行流程
- 端到端测试：启动 Hono 服务，用 fetch 发送真实 HTTP 请求验证响应格式
