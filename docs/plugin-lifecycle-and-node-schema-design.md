# 插件生命周期与节点协议设计

日期：2026-06-10
状态：已确认，待实施

## 总览

5 个阶段，按顺序实施，每块独立验证：

1. 插件生命周期 API
2. 前端插件管理面板
3. 通用节点可观测性框架
4. 节点参数 schema 升级
5. remote-http executor 最小实现

---

## 第 1 块：插件生命周期 API

### 状态持久化

`plugins/plugin-state.json`：

```json
{
  "awp.rp-core": {
    "enabled": false,
    "updatedAt": "2026-06-10T10:00:00.000Z"
  }
}
```

可扩展字段：`permissionsApproved`、`settings`、`pinnedVersion`。

### API

`GET /api/plugins` — 返回所有插件状态（合并 manifest + runtime state）：

```json
{
  "plugins": [
    {
      "id": "awp.rp-core",
      "label": "RP Core Nodes",
      "version": "0.1.0",
      "description": "...",
      "manifestEnabled": true,
      "enabled": false,
      "stateSource": "user",
      "permissions": ["worldbook:read", "memory:read", "model:call"],
      "dependencies": [],
      "compatibility": { "app": ">=0.1.0", "workflowSchema": 1 },
      "nodeTypes": ["worldbookSearch", "memoryRecall", "..."]
    }
  ]
}
```

`POST /api/plugins/:id/enable` — 启用插件
`POST /api/plugins/:id/disable` — 禁用插件

- 写入 `plugin-state.json`
- 调用 `reloadPluginRuntime()` 刷新内存：plugin list、catalog、executors、runtime node catalog
- 返回更新后的插件信息

### 校验增强

禁用插件后，工作流校验提示：

```json
{
  "level": "error",
  "message": "Node type rpDialogueDirector belongs to disabled plugin awp.rp-core"
}
```

---

## 第 2 块：前端插件管理面板

### 入口

顶栏新增按钮「插件」，点击弹出模态框。

### 面板内容

- 插件卡片：名称、版本、状态文案、权限列表、节点类型列表（截断显示）、启用/禁用按钮
- 状态文案根据 `(manifestEnabled, enabled, stateSource)` 生成：
  - 当前启用 · manifest 默认启用
  - 当前启用 · 用户手动启用
  - 当前禁用 · manifest 默认禁用
  - 当前禁用 · 用户手动禁用
- 节点列表格式：`worldbookSearch, memoryRecall, rpDialogueDirector +3`
- 禁用按钮提示：「禁用后，使用该插件节点的工作流将无法运行。」
- 如当前画布包含该插件节点，弹确认：「当前工作流正在使用 N 个该插件节点，禁用后会校验失败。」

### 行为

- 启用/禁用 → 调用 API → 刷新插件列表 + 节点库（不重置画布）
- API 不可用时降级提示：「插件服务不可用，当前使用本地内置节点。」

---

## 第 3 块：通用节点可观测性框架

### Metadata Views Schema

`packages/plugin-sdk/src/index.ts` 新增：

```ts
type MetadataEntryItem = {
  id: string;
  title: string;
  summary?: string;
  tags?: string[];
  metadata?: Record<string, string>;
};

type MetadataStatPair = {
  label: string;
  value: string | number | boolean;
  tone?: "default" | "success" | "warning" | "danger";
};

type MetadataTraceStep = {
  label: string;
  status?: "success" | "error" | "skipped";
  detail?: string;
  durationMs?: number;
};

type NodeRunMetadataView =
  | { id: string; kind: "entry-list"; title: string; items: MetadataEntryItem[] }
  | { id: string; kind: "code"; title: string; content: string; language?: string }
  | { id: string; kind: "stats"; title: string; pairs: MetadataStatPair[] }
  | { id: string; kind: "text"; title: string; content: string }
  | { id: string; kind: "object"; title: string; value: Record<string, unknown> }
  | { id: string; kind: "trace"; title: string; steps: MetadataTraceStep[] };
```

### 插件使用约定

```ts
metadata: {
  pluginId: "awp.rp-core",
  views: [
    { id: "worldbook_hits", kind: "entry-list", title: "命中世界书条目", items: [...] },
    { id: "prompt", kind: "code", title: "完整 Prompt", language: "text", content: "..." },
    { id: "call_stats", kind: "stats", title: "调用统计", pairs: [...] }
  ]
}
```

### 前端渲染

- 检查 `metadata.views`：有则按 view kind 渲染，无则回退 `JSON.stringify`
- 每种 view 右上角独立复制按钮
- 整体复制保留

### 耗时展示

- 运行记录每行：`✓ rpDialogueDirector · 2.3s`
- 节点检查器：状态 / 耗时 / 开始时间 / 结束时间
- 由框架从 `startedAt`/`endedAt` 自动计算，不要求插件声明

---

## 第 4 块：节点参数 schema 升级

### 扩展类型

```ts
type NodeConfigOption = {
  label: LocalizedText;
  value: string;
};

type NodeConfigPreset = {
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  config: Record<string, unknown>;
};

type NodeConfigField = {
  key: string;
  label: LocalizedText;
  kind:
    | "text"
    | "textarea"
    | "number"
    | "select"
    | "tags"
    | "boolean"
    | "multiselect"
    | "json"
    | "secret"
    | "model";
  min?: number;
  max?: number;
  options?: string[] | NodeConfigOption[];
  required?: boolean;
  placeholder?: LocalizedText;
  help?: LocalizedText;
  group?: string;
  groupLabel?: LocalizedText;
  advanced?: boolean;
  dependsOn?: {
    field: string;
    operator?: "equals" | "notEquals" | "includes" | "exists";
    value?: unknown;
  };
  source?: "static" | "models";
};
```

`NodeDefinition` 增加：

```ts
presets?: NodeConfigPreset[];
```

### 新增 kind 渲染

| kind          | 渲染                  | 说明                                      |
| ------------- | --------------------- | ----------------------------------------- |
| `boolean`     | checkbox/toggle       | 值存 boolean                              |
| `multiselect` | 多选标签列表          | 值存 string[]                             |
| `json`        | textarea + 格式化按钮 | 合法 JSON 写入 object，非法仅本地错误提示 |
| `secret`      | password 输入框       | 遮蔽显示，值存 string                     |
| `model`       | select 下拉           | 选项来自静态配置或 `/api/models`          |

### 高级参数折叠

- `advanced !== true`：基本区
- `advanced === true`：收进「高级参数」折叠区
- 如有 `group`，折叠区内按 group 分组

### 参数预设

`NodeDefinition.presets` 定义预设，配置面板顶部渲染预设按钮，点击一键填充所有 config 字段。

### 字段级校验

抽成 `apps/web/src/nodeConfigValidation.ts` 纯函数：

```ts
validateNodeConfigField(field, value, config): string[]
validateNodeConfig(definition, config): Record<string, string[]>
isFieldVisible(field, config): boolean
```

即时校验：required、min/max、JSON 合法性、options 合规。

---

## 第 5 块：remote-http executor

### Manifest 声明

```json
{
  "executor": {
    "adapter": "remote-http",
    "entry": "http://localhost:9100/execute",
    "timeoutMs": 30000
  },
  "permissions": ["network"]
}
```

### 请求格式

```json
POST http://localhost:9100/execute
{
  "pluginId": "my-remote-plugin",
  "nodeType": "worldbookSearch",
  "workflowId": "wf_1",
  "node": {
    "id": "worldbook_1",
    "type": "worldbookSearch",
    "config": { "query": "...", "limit": 4 }
  },
  "inputs": { "query": "..." }
}
```

### 响应格式

成功：

```json
{
  "outputs": { "results": "..." },
  "metadata": {
    "pluginId": "my-remote-plugin",
    "views": []
  }
}
```

失败：

```json
{
  "error": "reason..."
}
```

### 服务端行为

- URL 限制 http/https 协议
- 校验响应 `outputs` 必为 object
- 默认超时 30s，可配置
- 请求失败 → 节点运行报错，含 pluginId/nodeType/URL
- 不传 server context / API key 给远程

---

## 实施顺序与验收标准

### 第 1 块验收

- `GET /api/plugins` 返回合并状态
- `POST /api/plugins/:id/enable` 启用后 plugins 列表 + runtime catalog 刷新
- `POST /api/plugins/:id/disable` 禁用后节点校验报错
- `plugin-state.json` 正确持久化
- `npm run test` 全通过

### 第 2 块验收

- 顶栏「插件」按钮可用
- 模态框展示插件列表（id/version/status/permissions/nodes）
- 启用/禁用按钮功能正常
- 节点库随插件状态刷新
- 禁用含当前工作流节点的插件时提示确认
- API 不可用时降级提示

### 第 3 块验收

- plugins 输出 `metadata.views` 在前端按结构化渲染
- 不包含 views 时回退 JSON 文本
- 每个 view 有独立复制按钮
- 运行记录显示耗时
- 节点检查器显示耗时/状态

### 第 4 块验收

- 5 种新 kind 正确渲染和编辑
- 字段级校验错误正确显示
- 高级参数折叠正常工作
- 参数预设一键填充
- dependsOn 条件显示正确

### 第 5 块验收

- `remote-http` adapter 正确发起 HTTP 请求
- 成功/失败响应正确处理
- URL 协议校验生效
- timeout 生效
- network 权限声明生效
