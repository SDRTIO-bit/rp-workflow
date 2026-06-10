import { describe, expect, it } from "vitest";
import { isFieldVisible, validateNodeConfigField, validateNodeConfig } from "./nodeConfigValidation";
import type { NodeConfigField } from "@awp/workflow-core";

describe("isFieldVisible", () => {
  it("returns true for fields without dependsOn", () => {
    const field: NodeConfigField = { key: "name", label: { zh: "名称", en: "Name" }, kind: "text" };
    expect(isFieldVisible(field, {})).toBe(true);
  });

  it("hides field when dependsOn equals check fails", () => {
    const field: NodeConfigField = {
      key: "advanced",
      label: { zh: "高级", en: "Advanced" },
      kind: "text",
      dependsOn: { field: "mode", operator: "equals", value: "advanced" },
    };
    expect(isFieldVisible(field, { mode: "basic" })).toBe(false);
    expect(isFieldVisible(field, { mode: "advanced" })).toBe(true);
  });

  it("supports includes operator", () => {
    const field: NodeConfigField = {
      key: "extra",
      label: { zh: "扩展", en: "Extra" },
      kind: "text",
      dependsOn: { field: "features", operator: "includes", value: "experimental" },
    };
    expect(isFieldVisible(field, { features: ["basic", "experimental"] })).toBe(true);
    expect(isFieldVisible(field, { features: ["basic"] })).toBe(false);
  });

  it("supports exists operator", () => {
    const field: NodeConfigField = {
      key: "notes",
      label: { zh: "备注", en: "Notes" },
      kind: "textarea",
      dependsOn: { field: "hasNotes", operator: "exists" },
    };
    expect(isFieldVisible(field, { hasNotes: "yes" })).toBe(true);
    expect(isFieldVisible(field, { hasNotes: null })).toBe(false);
    expect(isFieldVisible(field, {})).toBe(false);
  });
});

describe("validateNodeConfigField", () => {
  it("flags missing required fields", () => {
    const field: NodeConfigField = { key: "name", label: { zh: "名称", en: "Name" }, kind: "text", required: true };
    expect(validateNodeConfigField(field, "", {})).toContain("名称 为必填项");
  });

  it("flags number out of range", () => {
    const field: NodeConfigField = { key: "count", label: { zh: "数量", en: "Count" }, kind: "number", min: 1, max: 10 };
    expect(validateNodeConfigField(field, 0, {})).toContain("最小值为 1");
    expect(validateNodeConfigField(field, 11, {})).toContain("最大值为 10");
  });

  it("flags invalid JSON", () => {
    const field: NodeConfigField = { key: "data", label: { zh: "数据", en: "Data" }, kind: "json" };
    expect(validateNodeConfigField(field, "{invalid", {})).toContain("JSON 格式无效");
  });

  it("accepts valid JSON string", () => {
    const field: NodeConfigField = { key: "data", label: { zh: "数据", en: "Data" }, kind: "json" };
    expect(validateNodeConfigField(field, '{"a":1}', {})).toEqual([]);
  });
});

describe("validateNodeConfig", () => {
  it("returns empty for valid config", () => {
    const definition = {
      type: "test",
      label: "Test",
      ports: [],
      configFields: [
        { key: "name", label: { zh: "名称", en: "Name" }, kind: "text" as const, required: true },
      ],
    };
    expect(validateNodeConfig(definition, { name: "hello" })).toEqual({});
  });

  it("returns issues per field", () => {
    const definition = {
      type: "test",
      label: "Test",
      ports: [],
      configFields: [
        { key: "name", label: { zh: "名称", en: "Name" }, kind: "text" as const, required: true },
        { key: "count", label: { zh: "数量", en: "Count" }, kind: "number" as const, min: 1, max: 10 },
      ],
    };
    const issues = validateNodeConfig(definition, { name: "", count: 0 });
    expect(Object.keys(issues)).toHaveLength(2);
    expect(issues.name).toBeDefined();
    expect(issues.count).toBeDefined();
  });

  it("skips invisible fields", () => {
    const definition = {
      type: "test",
      label: "Test",
      ports: [],
      configFields: [
        { key: "name", label: { zh: "名称", en: "Name" }, kind: "text" as const, required: true },
        {
          key: "extra",
          label: { zh: "扩展", en: "Extra" },
          kind: "text" as const,
          required: true,
          dependsOn: { field: "mode", operator: "equals" as const, value: "advanced" },
        },
      ],
    };
    const issues = validateNodeConfig(definition, { name: "", mode: "basic" });
    expect(Object.keys(issues)).toHaveLength(1); // only name, extra is not visible
  });
});
