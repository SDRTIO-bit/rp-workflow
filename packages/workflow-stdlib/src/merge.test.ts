/**
 * Merge Function Tests — P-2
 */
import { describe, expect, it } from "vitest";
import { jsonMerge, markdownMerge, textMerge } from "./merge";

describe("jsonMerge", () => {
  describe("array-concat", () => {
    it("concatenates two arrays preserving order", () => {
      const result = jsonMerge("n1", [1, 2], [3, 4], "array-concat");
      expect(result).toEqual([1, 2, 3, 4]);
    });

    it("handles empty left array", () => {
      const result = jsonMerge("n1", [], [3, 4], "array-concat");
      expect(result).toEqual([3, 4]);
    });

    it("handles empty right array", () => {
      const result = jsonMerge("n1", [1, 2], [], "array-concat");
      expect(result).toEqual([1, 2]);
    });

    it("preserves duplicate items (no dedup)", () => {
      const result = jsonMerge("n1", [{ id: "a" }], [{ id: "a" }], "array-concat");
      expect(result).toEqual([{ id: "a" }, { id: "a" }]);
    });

    it("fails when left is not an array", () => {
      expect(() => jsonMerge("n1", { a: 1 }, [], "array-concat")).toThrow(
        "both inputs must be arrays",
      );
    });

    it("fails when right is not an array", () => {
      expect(() => jsonMerge("n1", [], "not-array", "array-concat")).toThrow(
        "both inputs must be arrays",
      );
    });

    it("fails when left is primitive", () => {
      expect(() => jsonMerge("n1", 42, [], "array-concat")).toThrow("both inputs must be arrays");
    });

    it("is deterministic", () => {
      const a = [{ b: 2, a: 1 }];
      const b = [{ d: 4, c: 3 }];
      const r1 = jsonMerge("n1", a, b, "array-concat");
      const r2 = jsonMerge("n1", a, b, "array-concat");
      expect(r1).toEqual(r2);
    });
  });

  describe("object-shallow", () => {
    it("shallow-merges two objects (right overrides left)", () => {
      const result = jsonMerge("n1", { a: 1, b: 2 }, { b: 3, c: 4 }, "object-shallow");
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it("fails when left is null", () => {
      expect(() => jsonMerge("n1", null, { a: 1 }, "object-shallow")).toThrow(
        "both inputs must be plain objects",
      );
    });

    it("fails when left is array", () => {
      expect(() => jsonMerge("n1", [1], { a: 1 }, "object-shallow")).toThrow(
        "both inputs must be plain objects",
      );
    });

    it("fails when right is primitive", () => {
      expect(() => jsonMerge("n1", { a: 1 }, 42, "object-shallow")).toThrow(
        "both inputs must be plain objects",
      );
    });
  });

  describe("object-deep", () => {
    it("deep-merges nested objects", () => {
      const result = jsonMerge(
        "n1",
        { a: 1, nested: { x: 1, y: 2 } },
        { b: 2, nested: { y: 3, z: 4 } },
        "object-deep",
      );
      expect(result).toEqual({ a: 1, b: 2, nested: { x: 1, y: 3, z: 4 } });
    });

    it("replaces arrays entirely (no concat)", () => {
      const result = jsonMerge("n1", { items: [1, 2] }, { items: [3, 4] }, "object-deep");
      expect(result).toEqual({ items: [3, 4] });
    });

    it("replaces primitives", () => {
      const result = jsonMerge("n1", { value: "left" }, { value: "right" }, "object-deep");
      expect(result).toEqual({ value: "right" });
    });

    it("handles null as regular value", () => {
      const result = jsonMerge("n1", { value: "left" }, { value: null }, "object-deep");
      expect(result).toEqual({ value: null });
    });

    it("fails when not both objects", () => {
      expect(() => jsonMerge("n1", { a: 1 }, [1], "object-deep")).toThrow(
        "both inputs must be plain objects",
      );
    });

    it("is deterministic", () => {
      const r1 = jsonMerge("n1", { a: { c: 2, b: 1 } }, { a: { d: 4 } }, "object-deep");
      const r2 = jsonMerge("n1", { a: { c: 2, b: 1 } }, { a: { d: 4 } }, "object-deep");
      expect(r1).toEqual(r2);
    });
  });
});

describe("markdownMerge", () => {
  it("joins two blocks with default separator", () => {
    const result = markdownMerge("Block A", "Block B");
    expect(result).toBe("Block A\n\nBlock B");
  });

  it("uses custom separator", () => {
    const result = markdownMerge("A", "B", { separator: " | " });
    expect(result).toBe("A | B");
  });

  it("adds section titles", () => {
    const result = markdownMerge("Content A", "Content B", {
      leftTitle: "Section 1",
      rightTitle: "Section 2",
    });
    expect(result).toBe("## Section 1\n\nContent A\n\n## Section 2\n\nContent B");
  });

  it("skips empty blocks by default", () => {
    const result = markdownMerge("A", "  ", {});
    expect(result).toBe("A");
  });

  it("preserves empty blocks when skipEmpty=false", () => {
    const result = markdownMerge("A", "  ", { skipEmpty: false });
    expect(result).toBe("A\n\n  ");
  });

  it("is deterministic", () => {
    const r1 = markdownMerge("hello", "world", { leftTitle: "H", rightTitle: "W" });
    const r2 = markdownMerge("hello", "world", { leftTitle: "H", rightTitle: "W" });
    expect(r1).toBe(r2);
  });
});

describe("textMerge", () => {
  it("joins two text blocks with default separator", () => {
    const result = textMerge("Line 1", "Line 2");
    expect(result).toBe("Line 1\nLine 2");
  });

  it("uses custom separator", () => {
    const result = textMerge("A", "B", { separator: " " });
    expect(result).toBe("A B");
  });

  it("skips empty blocks by default", () => {
    const result = textMerge("A", "", {});
    expect(result).toBe("A");
  });
});
