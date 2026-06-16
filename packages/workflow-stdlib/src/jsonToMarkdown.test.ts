/**
 * JSON → Markdown Renderer Tests — P-2 (in stdlib)
 */
import { describe, expect, it } from "vitest";
import { renderJsonToMarkdown } from "./jsonToMarkdown.js";

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
    const result = renderJsonToMarkdown({ dragon: { name: "Ember", age: 300 } });
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

  it("is deterministic", () => {
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
});
