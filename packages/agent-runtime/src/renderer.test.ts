/**
 * JSON → Markdown Renderer Tests — P-1
 */
import { describe, expect, it } from "vitest";
import { renderJsonToMarkdown } from "./renderer.js";

describe("renderJsonToMarkdown", () => {
  it("renders null and undefined as (empty)", () => {
    expect(renderJsonToMarkdown(null)).toBe("(empty)");
    expect(renderJsonToMarkdown(undefined)).toBe("(empty)");
  });

  it("renders primitives as-is", () => {
    expect(renderJsonToMarkdown("hello")).toBe("hello");
    expect(renderJsonToMarkdown(42)).toBe("42");
    expect(renderJsonToMarkdown(true)).toBe("true");
  });

  it("renders empty arrays and objects", () => {
    expect(renderJsonToMarkdown([])).toBe("(empty array)");
    expect(renderJsonToMarkdown({})).toBe("(empty object)");
  });

  it("renders flat objects with sorted keys", () => {
    const result = renderJsonToMarkdown({ name: "Ember", type: "dragon" });
    expect(result).toContain("**name**");
    expect(result).toContain("**type**");
    expect(result).toContain('"Ember"');
    expect(result).toContain('"dragon"');
  });

  it("renders nested objects", () => {
    const result = renderJsonToMarkdown({
      dragon: { name: "Ember", age: 300 },
    });
    expect(result).toContain("**dragon**");
    expect(result).toContain("**name**");
    expect(result).toContain("**age**");
    expect(result).toContain("300");
  });

  it("renders arrays of primitives", () => {
    const result = renderJsonToMarkdown(["red", "blue", "green"]);
    expect(result).toContain('"red"');
    expect(result).toContain('"blue"');
    expect(result).toContain('"green"');
  });

  it("renders arrays of objects", () => {
    const result = renderJsonToMarkdown([{ name: "Ember" }, { name: "Frost" }]);
    expect(result).toContain('name: "Ember"');
    expect(result).toContain('name: "Frost"');
  });

  it("is deterministic (same input = same output)", () => {
    const input = { b: 2, a: 1, c: { z: 3, x: 1 } };
    const r1 = renderJsonToMarkdown(input);
    const r2 = renderJsonToMarkdown(input);
    expect(r1).toBe(r2);
  });

  it("truncates long strings", () => {
    const long = "a".repeat(3000);
    const result = renderJsonToMarkdown({ text: long });
    expect(result).toContain("[truncated]");
    expect(result.length).toBeLessThan(long.length + 100);
  });

  it("handles null values in objects", () => {
    const result = renderJsonToMarkdown({ a: null, b: "ok" });
    expect(result).toContain("**a**");
    expect(result).toContain("null");
    expect(result).toContain("**b**");
  });

  it("skips undefined values in objects", () => {
    const obj: Record<string, unknown> = { a: 1 };
    (obj as Record<string, unknown>).b = undefined;
    const result = renderJsonToMarkdown(obj);
    expect(result).toContain("**a**");
    expect(result).not.toContain("**b**");
  });

  it("handles deeply nested data", () => {
    const input = { level1: { level2: { level3: { value: "deep" } } } };
    const result = renderJsonToMarkdown(input);
    expect(result).toContain("deep");
    expect(result).toContain("**level1**");
  });
});
