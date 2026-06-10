import type { NodeConfigField, NodeDefinition } from "@awp/workflow-core";

export const isFieldVisible = (
  field: NodeConfigField,
  config: Record<string, unknown>,
): boolean => {
  if (!field.dependsOn) return true;

  const { field: depField, operator = "equals", value: depValue } = field.dependsOn;
  const current = config[depField];

  switch (operator) {
    case "equals":
      return current === depValue;
    case "notEquals":
      return current !== depValue;
    case "includes":
      return Array.isArray(current) && current.includes(depValue);
    case "exists":
      return current !== undefined && current !== null;
    default:
      return true;
  }
};

export const validateNodeConfigField = (
  field: NodeConfigField,
  value: unknown,
  _config: Record<string, unknown>,
): string[] => {
  const issues: string[] = [];

  if (field.required && (value === undefined || value === null || value === "")) {
    issues.push(`${field.label.zh || field.key} 为必填项`);
  }

  if (field.kind === "number" && typeof value === "number") {
    if (field.min !== undefined && value < field.min) {
      issues.push(`最小值为 ${field.min}`);
    }
    if (field.max !== undefined && value > field.max) {
      issues.push(`最大值为 ${field.max}`);
    }
  }

  if (field.kind === "json" && typeof value === "string" && value.trim() !== "") {
    try {
      JSON.parse(value);
    } catch {
      issues.push("JSON 格式无效");
    }
  }

  if ((field.kind === "select" || field.kind === "model") && field.options && typeof value === "string") {
    const optionValues = Array.isArray(field.options)
      ? field.options.map((o) => (typeof o === "string" ? o : o.value))
      : [];
    if (value !== "" && !optionValues.includes(value)) {
      issues.push(`"${String(value)}" 不在可选项中`);
    }
  }

  return issues;
};

export const validateNodeConfig = (
  definition: NodeDefinition | undefined,
  config: Record<string, unknown>,
): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  if (!definition?.configFields) return result;

  for (const field of definition.configFields) {
    if (!isFieldVisible(field, config)) continue;
    const issues = validateNodeConfigField(field, config[field.key], config);
    if (issues.length > 0) {
      result[field.key] = issues;
    }
  }

  return result;
};
