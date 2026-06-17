/**
 * Normalization unit tests — P-15.2
 */
import { describe, it, expect } from "vitest";
import { normalizeForNovelty } from "./normalize.js";

describe("normalizeForNovelty", () => {
  it("returns identical text unchanged (after trim)", () => {
    expect(normalizeForNovelty("你好世界")).toBe("你好世界");
  });

  it("strips leading and trailing whitespace", () => {
    expect(normalizeForNovelty(" 你好世界 ")).toBe("你好世界");
    expect(normalizeForNovelty("\n你好世界\t")).toBe("你好世界");
  });

  it("collapses multiple spaces to single space", () => {
    expect(normalizeForNovelty("你好   世界")).toBe("你好 世界");
    expect(normalizeForNovelty("a  b   c")).toBe("a b c");
  });

  it("collapses newlines and tabs to single space", () => {
    expect(normalizeForNovelty("你好\n世界")).toBe("你好 世界");
    expect(normalizeForNovelty("你好\t\t世界")).toBe("你好 世界");
    expect(normalizeForNovelty("你好\n\n\n世界")).toBe("你好 世界");
  });

  it("applies NFKC normalization (fullwidth → halfwidth)", () => {
    // Fullwidth "Ａ" (U+FF21) → halfwidth "A"
    expect(normalizeForNovelty("Ａ")).toBe("A");
    // Fullwidth "１" (U+FF11) → halfwidth "1"
    expect(normalizeForNovelty("１")).toBe("1");
  });

  it("removes BOM (U+FEFF)", () => {
    expect(normalizeForNovelty("\uFEFF你好")).toBe("你好");
    expect(normalizeForNovelty("你\uFEFF好")).toBe("你好");
  });

  it("removes zero-width space (U+200B)", () => {
    expect(normalizeForNovelty("你\u200B好")).toBe("你好");
  });

  it("removes zero-width non-joiner (U+200C)", () => {
    expect(normalizeForNovelty("你\u200C好")).toBe("你好");
  });

  it("removes zero-width joiner (U+200D)", () => {
    expect(normalizeForNovelty("你\u200D好")).toBe("你好");
  });

  it("removes multiple zero-width characters", () => {
    expect(normalizeForNovelty("\u200B\u200C\u200D你\uFEFF好")).toBe("你好");
  });

  it("does NOT lowercase ASCII", () => {
    expect(normalizeForNovelty("Hello")).toBe("Hello");
    expect(normalizeForNovelty("hello")).toBe("hello");
    // They should remain different
    expect(normalizeForNovelty("Hello")).not.toBe(normalizeForNovelty("hello"));
  });

  it("does NOT fold Chinese punctuation", () => {
    // Fullwidth period "。" vs halfwidth "."
    expect(normalizeForNovelty("你好。")).not.toBe(normalizeForNovelty("你好."));
  });

  it("does NOT strip Markdown", () => {
    expect(normalizeForNovelty("# 你好")).toBe("# 你好");
    expect(normalizeForNovelty("**你好**")).toBe("**你好**");
  });

  it("does NOT strip quotes", () => {
    expect(normalizeForNovelty("\u201C你好\u201D")).toBe("\u201C你好\u201D");
    expect(normalizeForNovelty('"你好"')).toBe('"你好"');
  });

  it("handles empty string", () => {
    expect(normalizeForNovelty("")).toBe("");
  });

  it("handles whitespace-only string", () => {
    expect(normalizeForNovelty("   ")).toBe("");
    expect(normalizeForNovelty("\n\t")).toBe("");
  });

  it("handles long Chinese text", () => {
    const longText = "广".repeat(1000);
    expect(normalizeForNovelty(longText)).toBe(longText);
  });
});
