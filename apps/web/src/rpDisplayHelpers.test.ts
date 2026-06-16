import { describe, expect, it } from "vitest";
import { describeRpQuality, formatRpUsage } from "./rpDisplayHelpers";
import type { OfficialRpResponseV1 } from "./officialRpClient";

type Quality = OfficialRpResponseV1["quality"];
type Observability = OfficialRpResponseV1["observability"];

describe("describeRpQuality", () => {
  it("returns 'Quality unavailable' when quality is undefined", () => {
    expect(describeRpQuality(undefined)).toBe("Quality unavailable");
  });

  it("returns 'accepted' for first-pass accepted", () => {
    const quality: Quality = {
      accepted: true,
      exhausted: false,
      writerAttempts: 1,
      criticAttempts: 1,
      revisionApplied: false,
    };
    expect(describeRpQuality(quality)).toBe("Quality: accepted");
  });

  it("returns 'accepted after revision' for revision accepted", () => {
    const quality: Quality = {
      accepted: true,
      exhausted: false,
      writerAttempts: 2,
      criticAttempts: 2,
      revisionApplied: true,
    };
    expect(describeRpQuality(quality)).toBe("Quality: accepted after revision");
  });

  it("returns 'revision limit reached' for exhausted", () => {
    const quality: Quality = {
      accepted: false,
      exhausted: true,
      writerAttempts: 3,
      criticAttempts: 3,
      revisionApplied: true,
    };
    expect(describeRpQuality(quality)).toBe("Quality: revision limit reached");
  });

  it("returns 'not accepted' for rejected but not exhausted", () => {
    const quality: Quality = {
      accepted: false,
      exhausted: false,
      writerAttempts: 1,
      criticAttempts: 1,
      revisionApplied: false,
    };
    expect(describeRpQuality(quality)).toBe("Quality: not accepted");
  });
});

describe("formatRpUsage", () => {
  it("returns 'Usage unavailable' when observability is undefined", () => {
    expect(formatRpUsage(undefined)).toBe("Usage unavailable");
  });

  it("formats complete usage with token count", () => {
    const obs: Observability = {
      llmCalls: 3,
      totalLatencyMs: 5200,
      usage: {
        inputTokens: 500,
        outputTokens: 300,
        totalTokens: 800,
        unavailableInvocationCount: 0,
      },
      roles: { writer: 1, critic: 1, memoryCurator: 1 },
      budget: { exceeded: false, reasons: [] },
      modelUsage: [],
    };
    expect(formatRpUsage(obs)).toBe("3 model calls · 5.2s · 800 tokens");
  });

  it("shows 'Token usage incomplete' when totalTokens is undefined", () => {
    const obs: Observability = {
      llmCalls: 2,
      totalLatencyMs: 3000,
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
        unavailableInvocationCount: 2,
      },
      roles: { writer: 1, critic: 1, memoryCurator: 0 },
      budget: { exceeded: false, reasons: [] },
      modelUsage: [],
    };
    expect(formatRpUsage(obs)).toBe("2 model calls · 3.0s · Token usage incomplete");
  });

  it("shows 'Token usage incomplete' when totalTokens is 0 (boundary fix)", () => {
    const obs: Observability = {
      llmCalls: 2,
      totalLatencyMs: 4000,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        unavailableInvocationCount: 0,
      },
      roles: { writer: 1, critic: 1, memoryCurator: 0 },
      budget: { exceeded: false, reasons: [] },
      modelUsage: [],
    };
    // 修复后：totalTokens=0 不再显示 "0 tokens"
    expect(formatRpUsage(obs)).toBe("2 model calls · 4.0s · Token usage incomplete");
  });

  it("shows 'Token usage incomplete' when some invocations are unavailable", () => {
    const obs: Observability = {
      llmCalls: 4,
      totalLatencyMs: 8000,
      usage: {
        inputTokens: 600,
        outputTokens: 400,
        totalTokens: 1000,
        unavailableInvocationCount: 1,
      },
      roles: { writer: 2, critic: 1, memoryCurator: 1 },
      budget: { exceeded: false, reasons: [] },
      modelUsage: [],
    };
    expect(formatRpUsage(obs)).toBe("4 model calls · 8.0s · Token usage incomplete");
  });

  it("formats large token counts with locale separators", () => {
    const obs: Observability = {
      llmCalls: 5,
      totalLatencyMs: 12000,
      usage: {
        inputTokens: 50000,
        outputTokens: 30000,
        totalTokens: 80000,
        unavailableInvocationCount: 0,
      },
      roles: { writer: 2, critic: 2, memoryCurator: 1 },
      budget: { exceeded: false, reasons: [] },
      modelUsage: [],
    };
    const result = formatRpUsage(obs);
    expect(result).toContain("model calls");
    expect(result).toContain("12.0s");
    // 不同 locale 的千位分隔符可能不同，但不应是 "80000" 无分隔
    expect(result).not.toContain("80000 tokens");
  });
});
