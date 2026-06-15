/**
 * Dynamic Worldbook Node Definition — P-3
 *
 * Wire-native node with JSON ports and schemaIds for runtime validation.
 * Registers schema validators for command, payload, entry, result, and status types.
 */
import type { NodeDefinition } from "@awp/workflow-core";

// ============ Schema IDs ============

export const DYNAMIC_WORLDBOOK_COMMAND_SCHEMA = "awp.dynamic-worldbook-command.v1";
export const DYNAMIC_WORLDBOOK_PAYLOAD_SCHEMA = "awp.dynamic-worldbook-payload.v1";
export const DYNAMIC_WORLDBOOK_ENTRY_SCHEMA = "awp.dynamic-worldbook-entry.v1";
export const DYNAMIC_WORLDBOOK_RESULT_SCHEMA = "awp.dynamic-worldbook-result.v1";
export const DYNAMIC_WORLDBOOK_STATUS_SCHEMA = "awp.dynamic-worldbook-status.v1";

// ============ Node Definition ============

export const dynamicWorldbookNode: NodeDefinition = {
  type: "dynamicWorldbook",
  label: "Dynamic Worldbook",
  labelI18n: { zh: "动态世界书", en: "Dynamic Worldbook" },
  category: "knowledge",
  description:
    "Stateful, queryable, writable worldbook with versioning and idempotent operations. " +
    "Accepts a JSON command and optional payload. Outputs result and status on JSON wires.",
  descriptionI18n: {
    zh:
      "带状态、可查询、可写入的动态世界书，支持版本控制和幂等操作。" +
      "接受 JSON command 和可选的 payload，输出 JSON result 和 status。",
    en:
      "Stateful, queryable, writable worldbook with versioning and idempotent operations. " +
      "Accepts a JSON command and optional payload. Outputs result and status on JSON wires.",
  },
  color: "#0891b2",
  panelLayout: "worldbook",
  defaultConfig: {
    resourceRef: "",
    lifecycle: "session",
    allowedOperations: ["query", "filter"],
    allowDelete: false,
  },
  configFields: [
    {
      key: "resourceRef",
      label: { zh: "资源引用", en: "Resource Ref" },
      kind: "text",
      required: true,
      placeholder: { zh: "例如: worldbook:my-world", en: "e.g. worldbook:my-world" },
      help: {
        zh: "标识此节点操作的 Worldbook 资源。相同 resourceRef + lifecycle 共享状态。",
        en: "Identifies the worldbook resource. Same resourceRef + lifecycle shares state.",
      },
    },
    {
      key: "lifecycle",
      label: { zh: "生命周期", en: "Lifecycle" },
      kind: "select",
      options: [
        { label: { zh: "Run（单次运行）", en: "Run (single run)" }, value: "run" },
        { label: { zh: "Session（会话）", en: "Session" }, value: "session" },
      ],
      required: true,
      help: {
        zh: "Run 隔离单次运行；Session 跨多次运行共享。",
        en: "Run isolates per execution; Session shares across multiple runs.",
      },
    },
    {
      key: "allowedOperations",
      label: { zh: "允许的操作", en: "Allowed Operations" },
      kind: "multiselect",
      options: ["query", "filter", "append", "upsert", "merge", "replace", "delete"],
      required: true,
    },
    {
      key: "allowDelete",
      label: { zh: "允许删除", en: "Allow Delete" },
      kind: "boolean",
      help: { zh: "启用 delete 操作需要开启此选项", en: "Required for delete operation" },
    },
    {
      key: "maxEntriesPerWrite",
      label: { zh: "单次写入上限", en: "Max Entries Per Write" },
      kind: "number",
      min: 1,
      max: 10000,
      advanced: true,
    },
  ],
  ports: [
    {
      id: "command",
      label: "Command",
      direction: "input",
      wireType: "json",
      schemaId: DYNAMIC_WORLDBOOK_COMMAND_SCHEMA,
      required: true,
    },
    {
      id: "payload",
      label: "Payload",
      direction: "input",
      wireType: "json",
      schemaId: DYNAMIC_WORLDBOOK_PAYLOAD_SCHEMA,
      required: false,
    },
    {
      id: "result",
      label: "Result",
      direction: "output",
      wireType: "json",
      schemaId: DYNAMIC_WORLDBOOK_RESULT_SCHEMA,
    },
    {
      id: "status",
      label: "Status",
      direction: "output",
      wireType: "json",
      schemaId: DYNAMIC_WORLDBOOK_STATUS_SCHEMA,
    },
  ],
};

// ============ Runtime Schema Validators ============

/**
 * Validate a Dynamic Worldbook command against its schema.
 */
export function validateCommandSchema(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const c = data as Record<string, unknown>;

  const validOps = ["query", "filter", "append", "upsert", "merge", "replace", "delete"];
  if (typeof c.operation !== "string" || !validOps.includes(c.operation)) return false;

  // Forbidden keys in command
  if ("entries" in c || "data" in c || "patch" in c) return false;

  // selector validation (optional)
  if (c.selector !== undefined) {
    if (typeof c.selector !== "object" || c.selector === null || Array.isArray(c.selector))
      return false;
    const s = c.selector as Record<string, unknown>;
    if (s.entryIds !== undefined && !Array.isArray(s.entryIds)) return false;
    if (s.keywords !== undefined && !Array.isArray(s.keywords)) return false;
    if (s.tagsAny !== undefined && !Array.isArray(s.tagsAny)) return false;
    if (s.entityIdsAny !== undefined && !Array.isArray(s.entityIdsAny)) return false;
    if (s.type !== undefined && typeof s.type !== "string") return false;
    if (s.titleContains !== undefined && typeof s.titleContains !== "string") return false;
  }

  // limit validation
  if (c.limit !== undefined) {
    if (typeof c.limit !== "number" || !Number.isFinite(c.limit) || c.limit <= 0) return false;
  }

  // baseVersion validation
  if (c.baseVersion !== undefined) {
    if (typeof c.baseVersion !== "number" || !Number.isFinite(c.baseVersion) || c.baseVersion < 0)
      return false;
  }

  return true;
}

/**
 * Validate a Dynamic Worldbook payload against its schema.
 */
export function validatePayloadSchema(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const p = data as Record<string, unknown>;

  // Forbidden keys in payload
  if (
    "operation" in p ||
    "selector" in p ||
    "limit" in p ||
    "mode" in p ||
    "operationId" in p ||
    "baseVersion" in p
  )
    return false;

  // entries validation
  if (p.entries !== undefined) {
    if (!Array.isArray(p.entries)) return false;
    for (const entry of p.entries) {
      if (!validateEntrySchema(entry)) return false;
    }
  }

  return true;
}

/**
 * Validate a Dynamic Worldbook entry against its schema.
 */
export function validateEntrySchema(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const e = data as Record<string, unknown>;

  if (typeof e.id !== "string" || e.id.trim().length === 0) return false;
  if (typeof e.content !== "string") return false;

  if (e.priority !== undefined && (typeof e.priority !== "number" || !Number.isFinite(e.priority)))
    return false;
  if (e.tags !== undefined && !Array.isArray(e.tags)) return false;
  if (e.entityIds !== undefined && !Array.isArray(e.entityIds)) return false;
  if (
    e.metadata !== undefined &&
    (typeof e.metadata !== "object" || e.metadata === null || Array.isArray(e.metadata))
  )
    return false;

  return true;
}

/**
 * Validate a Dynamic Worldbook result schema.
 */
export function validateResultSchema(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const r = data as Record<string, unknown>;
  return (
    typeof r.resourceRef === "string" &&
    typeof r.version === "number" &&
    Array.isArray(r.entries) &&
    typeof r.total === "number"
  );
}

/**
 * Validate a Dynamic Worldbook status schema.
 */
export function validateStatusSchema(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const s = data as Record<string, unknown>;
  return (
    s.success === true &&
    typeof s.operation === "string" &&
    typeof s.resourceRef === "string" &&
    (s.lifecycle === "run" || s.lifecycle === "session")
  );
}

/**
 * Create a schema validator map for use with setRuntimeSchemaValidator.
 */
export function createWorldbookSchemaValidators(): Record<string, (data: unknown) => boolean> {
  return {
    [DYNAMIC_WORLDBOOK_COMMAND_SCHEMA]: validateCommandSchema,
    [DYNAMIC_WORLDBOOK_PAYLOAD_SCHEMA]: validatePayloadSchema,
    [DYNAMIC_WORLDBOOK_ENTRY_SCHEMA]: validateEntrySchema,
    [DYNAMIC_WORLDBOOK_RESULT_SCHEMA]: validateResultSchema,
    [DYNAMIC_WORLDBOOK_STATUS_SCHEMA]: validateStatusSchema,
  };
}
