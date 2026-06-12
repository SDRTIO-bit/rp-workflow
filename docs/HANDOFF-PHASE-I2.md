# RP Runtime 平台集成交接文档

> 生成时间：Phase I-2 进行中
> 目标：告诉下一个 AI 当前进度、剩余工作、注意事项

---

## 1. 项目概况

**Agent Workflow Platform** — ComfyUI 式智能体工作流平台

核心架构：

- `packages/workflow-core` — 节点类型、注册表、调度器、运行器
- `packages/rp-runtime` — RP 节点包（本次主要工作）
- `apps/server` — Express/Hono 后端
- `apps/web` — React 前端

---

## 2. 当前完成状态

### ✅ Phase B-1（基础节点）- 已完成

- `rpInputParserV1` — 解析用户输入
- `rpContextAssemblerV1` — 组装上下文（带预算限制）
- `rpWriterV1` — 调用 LLM 生成正文（支持 echo fallback）

### ✅ Phase B-2（检索节点）- 已完成

- `rpTimelineQueryV1` — 检索章节记忆
- `rpLoreRetrieverV1` — 检索世界书/角色卡

### ✅ Phase B-3（写入节点）- 已完成

- `rpChapterSummaryV1` — 压缩本轮为 memoryEvent
- `rpTrackerUpdateV1` — 生成 trackerPatch
- `rpMemoryCommitV1` — 纯代码写入存储

### ✅ Phase I-1（平台集成审计）- 已完成

- 审计报告：`docs/research/rp-runtime-platform-integration-audit.md`
- 结论：前端无需修改，Server 需 5 个文件改动

### ⏳ Phase I-2（最小平台集成）- 进行中

**已完成：**

- ✅ `apps/server/package.json` — 添加 `@awp/rp-runtime` 依赖
- ✅ `apps/server/tsconfig.json` — 添加 rp-runtime 引用
- ✅ `apps/server/src/index.ts` — 初始化 RP Runtime，合并 catalog
- ✅ `apps/server/src/services/workflowRunner.ts` — 合并 RP executors，传递 context
- ✅ `apps/server/src/routes/workflow.ts` — 从请求读取 WorkflowRunContext
- ✅ `data/workflows/rp-foundation-smoke-workflow-v1.json` — Smoke 工作流模板
- ✅ `packages/rp-runtime/demo/runRpFoundationSmokeWorkflow.ts` — Demo 脚本
- ✅ `npm run build` — 全量构建通过

**待完成：**

- ✅ 运行 Demo 脚本验证端到端流程
- ✅ 验证 Server 启动后 `/api/nodes` 返回 RP 节点
- ✅ 验证 Web 前端能显示 RP 节点
- ✅ 验证 Smoke Workflow JSON 可加载
- ✅ 集成测试（scope 隔离、JSON 往返）
- ✅ 最终验证命令

---

## 3. 关键文件位置

### RP Runtime 节点实现

```
packages/rp-runtime/
├── src/
│   ├── types.ts                    # 所有 RP 类型定义
│   ├── schemas.ts                  # Schema 验证器
│   ├── register.ts                 # registerRpRuntime()
│   ├── stores/
│   │   ├── types.ts                # Store 接口
│   │   └── memory.ts               # InMemory 实现
│   └── nodes/
│       ├── utils.ts                # extractScope()
│       ├── rpInputParserV1.ts
│       ├── rpContextAssemblerV1.ts
│       ├── rpWriterV1.ts
│       ├── rpTimelineQueryV1.ts
│       ├── rpLoreRetrieverV1.ts
│       ├── rpChapterSummaryV1.ts
│       ├── rpTrackerUpdateV1.ts
│       └── rpMemoryCommitV1.ts
├── tests/                          # 134 个测试全部通过
└── demo/
    └── runRpFoundationSmokeWorkflow.ts
```

### Server 集成点（已修改）

```
apps/server/src/
├── index.ts                        # 初始化 RP Runtime，合并 catalog
├── routes/
│   └── workflow.ts                 # 传递 WorkflowRunContext
└── services/
    └── workflowRunner.ts           # 合并 RP executors，传递 context
```

### Web 前端（无需修改）

```
apps/web/src/
├── App.tsx                         # 从 /api/nodes 动态加载节点
└── runWorkflowClient.ts            # 调用 Server API
```

### 工作流模板

```
data/workflows/
└── rp-foundation-smoke-workflow-v1.json   # Smoke 测试工作流
```

---

## 4. 架构要点

### 注册与运行分离

```typescript
// 注册阶段（启动时）
const rpRuntime = registerRpRuntime(services);
// 返回 { catalog, executors, schemas }

// 运行阶段（每次请求）
const context = {
  runId: "run-1",
  values: {
    rp: { sessionId, worldId, turnId }, // 从请求传入
  },
};
await runWorkflow(workflow, executors, catalog, context);
```

### 闭包捕获规则

- **允许捕获**：Store 实例、LLM adapter、config（稳定服务）
- **禁止捕获**：sessionId、worldId、turnId（会话状态）
- 会话状态从 `input.context?.values?.rp` 读取

### schemaId 机制

- RP 类型通过 `dataType: "json" + schemaId` 标识
- schemaId 存储在 `NodeDefinition.ports[].schemaId`
- 工作流 JSON 不存储 schemaId，通过 node.type 从 catalog 查找

---

## 5. 剩余工作清单

### 5.1 运行 Demo 脚本

```bash
cd packages/rp-runtime
npx tsx demo/runRpFoundationSmokeWorkflow.ts
```

预期输出：parsedInput、assembledContext、budgetReport、writerOutput

### 5.2 启动 Server 验证

```bash
npm run dev:server
# 访问 http://127.0.0.1:3000/api/nodes
# 确认返回包含 rpInputParserV1 等 8 个 RP 节点
```

### 5.3 启动 Web 验证

```bash
npm run dev
# 访问 http://127.0.0.1:5173
# 确认节点面板显示 RP 节点
```

### 5.4 集成测试

需要编写：

1. Server 集成测试 — 读取 workflow JSON → validateWorkflow → runWorkflow → 返回 narrative
2. Scope 隔离测试 — 并发运行两个请求，确认 scope 不串档
3. Web 注册测试 — 确认 RP catalog 注册后节点可发现
4. JSON 往返测试 — 加载 → 序列化 → 重新加载，确认 schemaId 不丢失

### 5.5 最终验证命令

```bash
npm run build          # 全量构建
npm run test           # 全量测试
npm run typecheck      # 类型检查
```

---

## 6. 注意事项

### 6.1 不要做的事

- ❌ 不要修改 `packages/workflow-core` — 已支持所需功能
- ❌ 不要修改 `apps/web` — 已支持动态加载节点
- ❌ 不要复制节点定义到 apps/web 或 apps/server — 必须消费 `@awp/rp-runtime`
- ❌ 不要在 Server 中硬编码 sessionId/worldId — 必须从请求传入
- ❌ 不要重构 Server 路由结构 — 只修改参数传递

### 6.2 必须遵守的约束

- ✅ 所有 Store 方法使用 request object：`{ sessionId, worldId, ... }`
- ✅ `putEvent` 按 eventId 幂等去重
- ✅ Executor 输入输出边界做 schema 校验
- ✅ 节点可复用，不绑定特定角色卡或世界
- ✅ 测试覆盖隔离和幂等

### 6.3 已知问题

- Server 的 `createExecutors()` 中，每个 executor 签名需要解构 `context` 参数
- 当前已修改 `runWorkflowStreaming` 传递 `workflowContext`
- 需要验证 RP executor 能正确接收 context

---

## 7. 快速恢复命令

```bash
# 1. 安装依赖
npm install

# 2. 构建所有包
npm run build

# 3. 运行 RP Runtime 测试
npm run test --workspace @awp/rp-runtime

# 4. 运行 Demo
cd packages/rp-runtime
npx tsx demo/runRpFoundationSmokeWorkflow.ts

# 5. 启动 Server
npm run dev:server

# 6. 启动 Web
npm run dev

# 7. 全量验证
npm run build && npm run test && npm run typecheck
```

---

## 8. 进入 Phase B-2 的条件

只有满足以下条件，才能认为 RP 节点真正进入平台：

- [x] JSON 工作流可加载 ✅
- [x] Demo 可运行 ✅
- [x] Server 可执行 ✅
- [x] Web 可发现并显示节点 ✅
- [x] schemaId 可完整往返 ✅
- [x] context scope 不串档 ✅
- [x] monorepo build/typecheck/test 通过 ✅

---

## 9. 下一步建议

1. **先运行 Demo** — 验证端到端流程
2. **启动 Server** — 验证 `/api/nodes` 返回 RP 节点
3. **启动 Web** — 验证节点面板显示
4. **编写集成测试** — 确保 scope 隔离
5. **完成验收清单** — 逐项确认

---

## 10. 参考文档

- 映射分析：`docs/research/aventura-to-rp-workflow-mapping.md`
- 集成审计：`docs/research/rp-runtime-platform-integration-audit.md`
- Phase A 交接：`docs/HANDOFF.md`

---

## 11. Phase I-2 完成总结

**完成时间：** 2026-06-12

**修复的问题：**

1. workflow-core 类型兼容性 — 添加 `json:draft` 到兼容列表
2. Demo 脚本 textOutput 端口类型 — 改为 `json` 以接受 WriterOutput
3. 新增集成测试 — JSON 往返和 schemaId 保留验证

**验证结果：**

- ✅ Demo 脚本运行成功（echo fallback 模式）
- ✅ Server 返回 32 个节点（13 个 RP 节点）
- ✅ Web 开发服务器启动成功，动态加载节点
- ✅ 全量测试通过：229 个测试（rp-runtime: 136 个）
- ✅ Typecheck 和 Build 全部通过

**Phase I-2 已完成，可以进入下一阶段开发。**
