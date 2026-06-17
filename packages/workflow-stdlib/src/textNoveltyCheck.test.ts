/**
 * Text Novelty Check unit tests — P-15.2
 */
import { describe, it, expect } from "vitest";
import { checkNovelty } from "./textNoveltyCheck.js";

describe("checkNovelty", () => {
  // ============ Reference empty ============
  it("returns no_reference when reference is empty string", () => {
    const report = checkNovelty("anything", "");
    expect(report.reason).toBe("no_reference");
    expect(report.evaluated).toBe(false);
    expect(report.exactDuplicate).toBe(false);
  });

  it("returns no_reference when reference is whitespace-only", () => {
    const report = checkNovelty("anything", "   ");
    expect(report.reason).toBe("no_reference");
  });

  // ============ Current empty ============
  it("returns empty_current when current is empty string", () => {
    const report = checkNovelty("", "reference text");
    expect(report.reason).toBe("empty_current");
    expect(report.evaluated).toBe(false);
    expect(report.exactDuplicate).toBe(false);
  });

  it("returns empty_current when current is whitespace-only", () => {
    const report = checkNovelty("  \n  ", "reference text");
    expect(report.reason).toBe("empty_current");
  });

  // ============ Below minimum length ============
  it("returns below_minimum_length when current is too short", () => {
    const shortText = "好".repeat(63);
    const report = checkNovelty(shortText, shortText);
    expect(report.reason).toBe("below_minimum_length");
    expect(report.evaluated).toBe(false);
    expect(report.exactDuplicate).toBe(false);
  });

  it("returns below_minimum_length when reference is too short", () => {
    const shortText = "好".repeat(63);
    const longText = "好".repeat(100);
    const report = checkNovelty(longText, shortText);
    expect(report.reason).toBe("below_minimum_length");
  });

  it("64-char duplicate triggers exact_duplicate (boundary)", () => {
    const text = "好".repeat(64);
    const report = checkNovelty(text, text);
    expect(report.reason).toBe("exact_duplicate");
    expect(report.evaluated).toBe(true);
    expect(report.exactDuplicate).toBe(true);
  });

  it("63-char duplicate does NOT trigger (below minimum)", () => {
    const text = "好".repeat(63);
    const report = checkNovelty(text, text);
    expect(report.reason).toBe("below_minimum_length");
    expect(report.exactDuplicate).toBe(false);
  });

  // ============ Exact duplicate ============
  it("detects exact duplicate of identical text", () => {
    const text = "你好世界".repeat(20);
    const report = checkNovelty(text, text);
    expect(report.reason).toBe("exact_duplicate");
    expect(report.evaluated).toBe(true);
    expect(report.exactDuplicate).toBe(true);
  });

  it("detects duplicate with leading/trailing whitespace", () => {
    const text = "你好世界".repeat(20);
    const report = checkNovelty(text, `  ${text}  `);
    expect(report.reason).toBe("exact_duplicate");
    expect(report.exactDuplicate).toBe(true);
  });

  it("detects duplicate with extra internal whitespace", () => {
    const report = checkNovelty("你好   世界" + "。".repeat(60), "你好 世界" + "。".repeat(60));
    expect(report.reason).toBe("exact_duplicate");
    expect(report.exactDuplicate).toBe(true);
  });

  it("detects duplicate with newline differences", () => {
    const report = checkNovelty("你好\n世界" + "。".repeat(60), "你好 世界" + "。".repeat(60));
    expect(report.reason).toBe("exact_duplicate");
    expect(report.exactDuplicate).toBe(true);
  });

  it("detects duplicate after NFKC normalization", () => {
    // Fullwidth "Ａ" vs halfwidth "A" — after NFKC they match
    const ref = "A" + "好".repeat(63);
    const cur = "\uFF21" + "好".repeat(63); // fullwidth A
    const report = checkNovelty(cur, ref);
    expect(report.reason).toBe("exact_duplicate");
    expect(report.exactDuplicate).toBe(true);
  });

  it("detects duplicate after zero-width character removal", () => {
    const ref = "你好世界" + "。".repeat(60);
    const cur = "你\u200B好\u200C世\u200D界" + "。".repeat(60);
    const report = checkNovelty(cur, ref);
    expect(report.reason).toBe("exact_duplicate");
    expect(report.exactDuplicate).toBe(true);
  });

  // ============ Novel ============
  it("returns novel when Markdown differs (not stripped)", () => {
    const report = checkNovelty("# 你好" + "。".repeat(70), "你好" + "。".repeat(70));
    expect(report.reason).toBe("novel");
    expect(report.exactDuplicate).toBe(false);
  });

  it("returns novel when punctuation differs (not folded)", () => {
    const report = checkNovelty("你好。" + "。".repeat(70), "你好." + "。".repeat(70));
    expect(report.reason).toBe("novel");
    expect(report.exactDuplicate).toBe(false);
  });

  it("returns novel when case differs (not lowered)", () => {
    const report = checkNovelty("Hello" + "好".repeat(60), "hello" + "好".repeat(60));
    expect(report.reason).toBe("novel");
    expect(report.exactDuplicate).toBe(false);
  });

  it("returns novel when one character differs in long Chinese text", () => {
    const ref = "广".repeat(100);
    const cur = "广".repeat(99) + "州";
    const report = checkNovelty(cur, ref);
    expect(report.reason).toBe("novel");
    expect(report.exactDuplicate).toBe(false);
  });

  it("returns novel for completely different text", () => {
    const report = checkNovelty("你好世界".repeat(20), "再见世界".repeat(20));
    expect(report.reason).toBe("novel");
    expect(report.exactDuplicate).toBe(false);
  });

  // ============ Turn 13/14 case (156 chars) ============
  it("detects 156-char Chinese duplicate (turn-13/14 case)", () => {
    const text =
      "广播里的旋律忽然变了调。她侧耳倾听，仿佛在辨认某个遥远的信号。" +
      "空气中有一种微妙的变化，像是旧事在回响，又像是新的脚步声在靠近。" +
      "她低声说：该走了。";
    // Verify it's long enough
    expect(text.length).toBeGreaterThanOrEqual(64);
    const report = checkNovelty(text, text);
    expect(report.reason).toBe("exact_duplicate");
    expect(report.exactDuplicate).toBe(true);
  });

  // ============ Schema ============
  it("always includes schemaId in report", () => {
    const report = checkNovelty("test", "test");
    expect(report.schemaId).toBe("awp.text-novelty-report.v1");
  });

  it("includes normalized lengths in report", () => {
    const report = checkNovelty("  hello  ", "hello");
    expect(report.normalizedCurrentLength).toBe(5);
    expect(report.normalizedReferenceLength).toBe(5);
  });

  // ============ Custom config ============
  it("respects custom minNormalizedLength", () => {
    const text = "好".repeat(10);
    // With default (64), should be below_minimum_length
    const report1 = checkNovelty(text, text);
    expect(report1.reason).toBe("below_minimum_length");

    // With custom (5), should be exact_duplicate
    const report2 = checkNovelty(text, text, { minNormalizedLength: 5 });
    expect(report2.reason).toBe("exact_duplicate");
  });

  it("minNormalizedLength=0 always evaluates", () => {
    const report = checkNovelty("好", "好", { minNormalizedLength: 0 });
    expect(report.reason).toBe("exact_duplicate");
    expect(report.evaluated).toBe(true);
  });

  // ============ Determinism ============
  it("produces identical reports across 100 invocations", () => {
    const text = "你好世界".repeat(20);
    const first = checkNovelty(text, text);
    for (let i = 0; i < 100; i++) {
      const report = checkNovelty(text, text);
      expect(report).toEqual(first);
    }
  });
});
