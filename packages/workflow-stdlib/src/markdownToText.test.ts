/**
 * Markdown → Text Converter Tests — P-2
 */
import { describe, expect, it } from "vitest";
import { markdownToText } from "./markdownToText.js";

describe("markdownToText", () => {
  it("strips headers", () => {
    expect(markdownToText("# Hello\n\nWorld")).toBe("Hello\n\nWorld");
    expect(markdownToText("## Section\n\nContent")).toBe("Section\n\nContent");
  });

  it("strips bold and italic", () => {
    expect(markdownToText("**bold** and *italic*")).toBe("bold and italic");
  });

  it("removes images", () => {
    expect(markdownToText("Text ![alt](url.jpg) more")).toBe("Text  more");
  });

  it("strips links keeping text", () => {
    expect(markdownToText("[Click here](https://example.com)")).toBe("Click here");
  });

  it("strips inline code", () => {
    expect(markdownToText("Use `const` keyword")).toBe("Use const keyword");
  });

  it("strips code fences keeping content", () => {
    const input = "Before\n```\nconst x = 1;\n```\nAfter";
    const result = markdownToText(input);
    expect(result).toContain("const x = 1;");
    expect(result).toContain("Before");
    expect(result).toContain("After");
  });

  it("strips list markers", () => {
    expect(markdownToText("- Item 1\n- Item 2")).toBe("Item 1\nItem 2");
    expect(markdownToText("1. First\n2. Second")).toBe("First\nSecond");
  });

  it("strips blockquote", () => {
    expect(markdownToText("> quoted text")).toBe("quoted text");
  });

  it("collapses multiple blank lines", () => {
    expect(markdownToText("A\n\n\n\nB")).toBe("A\n\nB");
  });

  it("returns empty string for empty input", () => {
    expect(markdownToText("")).toBe("");
  });

  it("is deterministic", () => {
    const input = "**bold** and *italic* [link](url)";
    const r1 = markdownToText(input);
    const r2 = markdownToText(input);
    expect(r1).toBe(r2);
  });
});
