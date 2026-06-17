/**
 * RP Quality Decision Merge tests — P-15.2
 */
import { describe, it, expect } from "vitest";
import {
  mergeQualityDecision,
  type RpQualityDecisionMergeConfig,
} from "./rpQualityDecisionMerge.js";
import type { TextNoveltyReportV1 } from "@awp/workflow-stdlib";

// ============ Helpers ============

function makeGateResult(overrides?: {
  accepted?: boolean;
  failedChecks?: string[];
  revisionInstruction?: string;
}) {
  return {
    accepted: overrides?.accepted ?? true,
    failedChecks: overrides?.failedChecks ?? [],
    revisionInstruction: overrides?.revisionInstruction,
    review: {},
  };
}

function makeNoveltyReport(overrides?: Partial<TextNoveltyReportV1>): TextNoveltyReportV1 {
  return {
    schemaId: "awp.text-novelty-report.v1",
    evaluated: true,
    exactDuplicate: false,
    normalizedCurrentLength: 100,
    normalizedReferenceLength: 100,
    reason: "novel",
    ...overrides,
  };
}

const defaultConfig: RpQualityDecisionMergeConfig = {
  attempt: 1,
  noveltyRevisionInstruction: "本轮正文与上一轮已提交正文重复。请重新生成。",
  maxRevisionInstructionLength: 200,
};

// ============ Tests ============

describe("mergeQualityDecision", () => {
  // ============ Critic accept + Novelty pass → accept ============
  it("Critic accept + Novelty pass → accept", () => {
    const result = mergeQualityDecision(
      makeGateResult({ accepted: true }),
      makeNoveltyReport({ exactDuplicate: false, reason: "novel" }),
      defaultConfig,
    );
    expect(result.decision.accepted).toBe(true);
    expect(result.decision.decision).toBe("accept");
    expect(result.decision.failedChecks).toEqual([]);
    expect(result.diagnostics.overriddenByNovelty).toBe(false);
  });

  // ============ Critic revise + Novelty pass → revise ============
  it("Critic revise + Novelty pass → revise with Critic instruction", () => {
    const result = mergeQualityDecision(
      makeGateResult({
        accepted: false,
        failedChecks: ["continuity: 0.5 < 0.7"],
        revisionInstruction: "请改善连贯性。",
      }),
      makeNoveltyReport({ exactDuplicate: false, reason: "novel" }),
      defaultConfig,
    );
    expect(result.decision.accepted).toBe(false);
    expect(result.decision.decision).toBe("revise");
    expect(result.decision.revisionInstruction).toBe("请改善连贯性。");
    expect(result.decision.failedChecks).toContain("continuity: 0.5 < 0.7");
    expect(result.diagnostics.overriddenByNovelty).toBe(false);
  });

  // ============ Critic accept + exact duplicate + attempt 1 → revise ============
  it("Critic accept + exact duplicate + attempt 1 → revise with novelty instruction", () => {
    const result = mergeQualityDecision(
      makeGateResult({ accepted: true }),
      makeNoveltyReport({ exactDuplicate: true, reason: "exact_duplicate" }),
      { ...defaultConfig, attempt: 1 },
    );
    expect(result.decision.accepted).toBe(false);
    expect(result.decision.decision).toBe("revise");
    expect(result.decision.failedChecks).toContain("exact_duplicate");
    expect(result.decision.revisionInstruction).toBe(
      "本轮正文与上一轮已提交正文重复。请重新生成。",
    );
    expect(result.diagnostics.overriddenByNovelty).toBe(true);
  });

  // ============ Critic revise + exact duplicate + attempt 1 → novelty instruction ============
  it("Critic revise + exact duplicate + attempt 1 → novelty instruction (novelty wins in V1)", () => {
    const result = mergeQualityDecision(
      makeGateResult({
        accepted: false,
        failedChecks: ["style: 0.3 < 0.5"],
        revisionInstruction: "请改善风格。",
      }),
      makeNoveltyReport({ exactDuplicate: true, reason: "exact_duplicate" }),
      { ...defaultConfig, attempt: 1 },
    );
    expect(result.decision.accepted).toBe(false);
    expect(result.decision.decision).toBe("revise");
    // V1: novelty instruction wins, not concatenated
    expect(result.decision.revisionInstruction).toBe(
      "本轮正文与上一轮已提交正文重复。请重新生成。",
    );
    expect(result.decision.failedChecks).toContain("style: 0.3 < 0.5");
    expect(result.decision.failedChecks).toContain("exact_duplicate");
    expect(result.diagnostics.overriddenByNovelty).toBe(true);
  });

  // ============ Attempt 2 duplicate → exhausted ============
  it("Attempt 2 + exact duplicate → exhausted", () => {
    const result = mergeQualityDecision(
      makeGateResult({ accepted: true }),
      makeNoveltyReport({ exactDuplicate: true, reason: "exact_duplicate" }),
      { ...defaultConfig, attempt: 2 },
    );
    expect(result.decision.accepted).toBe(false);
    expect(result.decision.decision).toBe("exhausted");
    expect(result.decision.failedChecks).toContain("exact_duplicate");
    expect(result.diagnostics.overriddenByNovelty).toBe(true);
  });

  // ============ Attempt 2 + Critic reject → exhausted ============
  it("Attempt 2 + Critic reject (no duplicate) → exhausted", () => {
    const result = mergeQualityDecision(
      makeGateResult({
        accepted: false,
        failedChecks: ["playerAgency: 0.5 < 0.8"],
        revisionInstruction: "请尊重玩家代理权。",
      }),
      makeNoveltyReport({ exactDuplicate: false, reason: "novel" }),
      { ...defaultConfig, attempt: 2 },
    );
    expect(result.decision.accepted).toBe(false);
    expect(result.decision.decision).toBe("exhausted");
    expect(result.diagnostics.overriddenByNovelty).toBe(false);
  });

  // ============ First turn: no_reference → follows Critic ============
  it("First turn: no_reference → follows Critic gate", () => {
    const result = mergeQualityDecision(
      makeGateResult({ accepted: true }),
      makeNoveltyReport({
        evaluated: false,
        exactDuplicate: false,
        reason: "no_reference",
        normalizedCurrentLength: 0,
        normalizedReferenceLength: 0,
      }),
      defaultConfig,
    );
    expect(result.decision.accepted).toBe(true);
    expect(result.decision.decision).toBe("accept");
    expect(result.diagnostics.overriddenByNovelty).toBe(false);
  });

  // ============ below_minimum_length → follows Critic ============
  it("below_minimum_length → follows Critic gate", () => {
    const result = mergeQualityDecision(
      makeGateResult({ accepted: true }),
      makeNoveltyReport({
        evaluated: false,
        exactDuplicate: false,
        reason: "below_minimum_length",
        normalizedCurrentLength: 30,
        normalizedReferenceLength: 30,
      }),
      defaultConfig,
    );
    expect(result.decision.accepted).toBe(true);
    expect(result.decision.decision).toBe("accept");
  });

  // ============ Instruction truncation ============
  it("truncates revision instruction to maxRevisionInstructionLength", () => {
    const longInstruction = "请重新生成。".repeat(50); // 300 chars
    const result = mergeQualityDecision(
      makeGateResult({ accepted: true }),
      makeNoveltyReport({ exactDuplicate: true, reason: "exact_duplicate" }),
      {
        attempt: 1,
        noveltyRevisionInstruction: longInstruction,
        maxRevisionInstructionLength: 20,
      },
    );
    expect(result.decision.revisionInstruction!.length).toBeLessThanOrEqual(20);
  });

  // ============ Diagnostics do not enter decision ============
  it("diagnostics port contains full evidence but decision port is minimal", () => {
    const result = mergeQualityDecision(
      makeGateResult({
        accepted: false,
        failedChecks: ["continuity: 0.5 < 0.7"],
        revisionInstruction: "请改善连贯性。",
      }),
      makeNoveltyReport({ exactDuplicate: true, reason: "exact_duplicate" }),
      { ...defaultConfig, attempt: 1 },
    );

    // Decision port: minimal
    expect(result.decision.schemaId).toBe("awp.rp-merged-quality-decision.v1");
    expect(Object.keys(result.decision).length).toBeLessThanOrEqual(5);

    // Diagnostics port: full evidence
    expect(result.diagnostics.schemaId).toBe("awp.rp-merged-quality-diagnostics.v1");
    expect(result.diagnostics.criticGate.failedChecks).toContain("continuity: 0.5 < 0.7");
    expect(result.diagnostics.novelty.exactDuplicate).toBe(true);
    expect(result.diagnostics.attempt).toBe(1);
  });

  // ============ Malformed inputs ============
  it("throws on malformed gateResult (missing accepted)", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mergeQualityDecision({ failedChecks: [] } as any, makeNoveltyReport(), defaultConfig),
    ).toThrow("gateResult.accepted must be a boolean");
  });

  it("throws on malformed gateResult (missing failedChecks)", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mergeQualityDecision({ accepted: true } as any, makeNoveltyReport(), defaultConfig),
    ).toThrow("gateResult.failedChecks must be an array");
  });

  it("throws on malformed noveltyReport (missing exactDuplicate)", () => {
    expect(() =>
      mergeQualityDecision(
        makeGateResult(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { schemaId: "awp.text-novelty-report.v1", evaluated: true } as any,
        defaultConfig,
      ),
    ).toThrow("noveltyReport.exactDuplicate must be a boolean");
  });

  it("throws on invalid attempt", () => {
    expect(() =>
      mergeQualityDecision(makeGateResult(), makeNoveltyReport(), {
        ...defaultConfig,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        attempt: 3 as any,
      }),
    ).toThrow("attempt must be 1 or 2");
  });

  // ============ Determinism ============
  it("produces identical results across 100 invocations", () => {
    const gate = makeGateResult({ accepted: false, failedChecks: ["x"] });
    const novelty = makeNoveltyReport({ exactDuplicate: true });
    const first = mergeQualityDecision(gate, novelty, defaultConfig);
    for (let i = 0; i < 100; i++) {
      const result = mergeQualityDecision(gate, novelty, defaultConfig);
      expect(result).toEqual(first);
    }
  });

  // ============ Schema IDs ============
  it("always includes correct schemaIds", () => {
    const result = mergeQualityDecision(makeGateResult(), makeNoveltyReport(), defaultConfig);
    expect(result.decision.schemaId).toBe("awp.rp-merged-quality-decision.v1");
    expect(result.diagnostics.schemaId).toBe("awp.rp-merged-quality-diagnostics.v1");
  });
});
