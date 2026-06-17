/**
 * RP Quality Decision Merge — P-15.2
 *
 * Merges Critic Gate result with Novelty report to produce a unified
 * routing decision. The decision port is small (for routing/writer2),
 * the diagnostics port is full (for inspect only).
 *
 * V1 logic:
 * - Critic Gate is authoritative.
 * - Novelty exactDuplicate=true → accepted=false, adds "exact_duplicate" to failedChecks.
 * - attempt=1 + duplicate → revise with novelty revision instruction.
 * - attempt=2 + duplicate → exhausted.
 * - Revision instruction: novelty segment only (V1 simplification).
 */

import type { NodeDefinition, NodeExecutor } from "@awp/workflow-core";
import type { TextNoveltyReportV1 } from "@awp/workflow-stdlib";

// ============ Schemas ============

export const RP_MERGED_QUALITY_DECISION_SCHEMA_ID = "awp.rp-merged-quality-decision.v1";
export const RP_MERGED_QUALITY_DIAGNOSTICS_SCHEMA_ID = "awp.rp-merged-quality-diagnostics.v1";

// ============ Types ============

export type RpMergedQualityDecisionV1 = {
  schemaId: "awp.rp-merged-quality-decision.v1";
  accepted: boolean;
  decision: "accept" | "revise" | "exhausted";
  revisionInstruction?: string;
  failedChecks: string[];
};

export type RpMergedQualityDiagnosticsV1 = {
  schemaId: "awp.rp-merged-quality-diagnostics.v1";
  attempt: number;
  criticGate: {
    accepted: boolean;
    failedChecks: string[];
    revisionInstruction?: string;
  };
  novelty: {
    evaluated: boolean;
    exactDuplicate: boolean;
    reason: string;
    normalizedCurrentLength: number;
    normalizedReferenceLength: number;
  };
  overriddenByNovelty: boolean;
};

// ============ Config ============

export type RpQualityDecisionMergeConfig = {
  attempt: 1 | 2;
  noveltyRevisionInstruction: string;
  maxRevisionInstructionLength: number;
};

export const DEFAULT_MERGE_CONFIG: Omit<RpQualityDecisionMergeConfig, "attempt"> = {
  noveltyRevisionInstruction:
    "本轮正文与上一轮已提交正文重复。请根据玩家最新输入重新生成，并明确推进当前场景，不要复用上一轮正文。",
  maxRevisionInstructionLength: 200,
};

// ============ Gate Result Shape (from rpCriticQualityGate) ============

type CriticGateResult = {
  accepted: boolean;
  decision?: string;
  failedChecks: string[];
  revisionInstruction?: string;
  review?: unknown;
};

// ============ Pure Logic ============

export function mergeQualityDecision(
  gateResult: CriticGateResult,
  noveltyReport: TextNoveltyReportV1,
  config: RpQualityDecisionMergeConfig,
): {
  decision: RpMergedQualityDecisionV1;
  diagnostics: RpMergedQualityDiagnosticsV1;
} {
  // Validate gate result
  if (typeof gateResult.accepted !== "boolean") {
    throw new Error("rpQualityDecisionMerge: gateResult.accepted must be a boolean");
  }
  if (!Array.isArray(gateResult.failedChecks)) {
    throw new Error("rpQualityDecisionMerge: gateResult.failedChecks must be an array");
  }

  // Validate novelty report
  if (typeof noveltyReport.exactDuplicate !== "boolean") {
    throw new Error("rpQualityDecisionMerge: noveltyReport.exactDuplicate must be a boolean");
  }
  if (typeof noveltyReport.evaluated !== "boolean") {
    throw new Error("rpQualityDecisionMerge: noveltyReport.evaluated must be a boolean");
  }

  // Validate config
  if (config.attempt !== 1 && config.attempt !== 2) {
    throw new Error(`rpQualityDecisionMerge: attempt must be 1 or 2, got ${config.attempt}`);
  }

  // Start from Critic Gate result
  let accepted = gateResult.accepted;
  const failedChecks = [...gateResult.failedChecks];
  let overriddenByNovelty = false;

  // Novelty override: exact duplicate → force reject
  if (noveltyReport.exactDuplicate) {
    accepted = false;
    if (!failedChecks.includes("exact_duplicate")) {
      failedChecks.push("exact_duplicate");
    }
    overriddenByNovelty = true;
  }

  // Determine decision
  let decision: "accept" | "revise" | "exhausted";
  let revisionInstruction: string | undefined;

  if (accepted) {
    decision = "accept";
  } else if (config.attempt === 1) {
    decision = "revise";
    // Build revision instruction
    if (noveltyReport.exactDuplicate) {
      // Novelty takes priority in V1
      revisionInstruction = truncateInstruction(
        config.noveltyRevisionInstruction,
        config.maxRevisionInstructionLength,
      );
    } else {
      // Use Critic's revision instruction
      revisionInstruction = gateResult.revisionInstruction;
    }
  } else {
    // attempt === 2, not accepted
    decision = "exhausted";
  }

  const decisionPort: RpMergedQualityDecisionV1 = {
    schemaId: RP_MERGED_QUALITY_DECISION_SCHEMA_ID,
    accepted,
    decision,
    failedChecks,
    ...(revisionInstruction !== undefined ? { revisionInstruction } : {}),
  };

  const diagnosticsPort: RpMergedQualityDiagnosticsV1 = {
    schemaId: RP_MERGED_QUALITY_DIAGNOSTICS_SCHEMA_ID,
    attempt: config.attempt,
    criticGate: {
      accepted: gateResult.accepted,
      failedChecks: [...gateResult.failedChecks],
      revisionInstruction: gateResult.revisionInstruction,
    },
    novelty: {
      evaluated: noveltyReport.evaluated,
      exactDuplicate: noveltyReport.exactDuplicate,
      reason: noveltyReport.reason,
      normalizedCurrentLength: noveltyReport.normalizedCurrentLength,
      normalizedReferenceLength: noveltyReport.normalizedReferenceLength,
    },
    overriddenByNovelty,
  };

  return { decision: decisionPort, diagnostics: diagnosticsPort };
}

function truncateInstruction(instruction: string, maxLength: number): string {
  if (instruction.length <= maxLength) {
    return instruction;
  }
  return instruction.slice(0, maxLength);
}

// ============ Node Definition ============

export const rpQualityDecisionMergeNode: NodeDefinition = {
  type: "rpQualityDecisionMerge",
  label: "RP Quality Decision Merge",
  labelI18n: { zh: "RP 质量决策合并", en: "RP Quality Decision Merge" },
  category: "core",
  description:
    "Merges Critic Gate result with Novelty report into a unified routing decision. Deterministic, no LLM.",
  descriptionI18n: {
    zh: "将 Critic Gate 结果与新颖度报告合并为统一路由决策。确定性，不调用 LLM。",
    en: "Merges Critic Gate result with Novelty report into a unified routing decision. Deterministic, no LLM.",
  },
  color: "#a855f7",
  panelLayout: "generic",
  defaultConfig: {
    attempt: 1,
    noveltyRevisionInstruction: DEFAULT_MERGE_CONFIG.noveltyRevisionInstruction,
    maxRevisionInstructionLength: DEFAULT_MERGE_CONFIG.maxRevisionInstructionLength,
  },
  configFields: [
    {
      key: "attempt",
      label: { zh: "尝试次数", en: "Attempt" },
      kind: "select",
      options: [
        { label: { zh: "第 1 次", en: "Attempt 1" }, value: "1" },
        { label: { zh: "第 2 次", en: "Attempt 2" }, value: "2" },
      ],
    },
    {
      key: "noveltyRevisionInstruction",
      label: { zh: "新颖度修订指令", en: "Novelty Revision Instruction" },
      kind: "text",
      help: {
        zh: "当检测到精确重复时发送给 Writer 的指令",
        en: "Instruction sent to Writer when exact duplicate is detected",
      },
    },
    {
      key: "maxRevisionInstructionLength",
      label: { zh: "最大修订指令长度", en: "Max Revision Instruction Length" },
      kind: "number",
      min: 1,
      max: 2000,
      advanced: true,
    },
  ],
  ports: [
    {
      id: "gateResult",
      label: "Gate Result",
      wireType: "json",
      direction: "input",
      required: true,
    },
    {
      id: "noveltyReport",
      label: "Novelty Report",
      wireType: "json",
      direction: "input",
      required: true,
      schemaId: "awp.text-novelty-report.v1",
    },
    {
      id: "decision",
      label: "Decision",
      wireType: "json",
      direction: "output",
      schemaId: RP_MERGED_QUALITY_DECISION_SCHEMA_ID,
    },
    {
      id: "diagnostics",
      label: "Diagnostics",
      wireType: "json",
      direction: "output",
      schemaId: RP_MERGED_QUALITY_DIAGNOSTICS_SCHEMA_ID,
    },
  ],
};

// ============ Executor ============

export const rpQualityDecisionMergeExecutor: NodeExecutor = async ({ node, inputs }) => {
  const gateResultRaw = inputs.gateResult;
  const noveltyReportRaw = inputs.noveltyReport;

  // Validate required inputs
  if (!gateResultRaw || typeof gateResultRaw !== "object") {
    throw new Error(
      `rpQualityDecisionMerge at "${node.id}": gateResult input must be a JSON object`,
    );
  }
  if (!noveltyReportRaw || typeof noveltyReportRaw !== "object") {
    throw new Error(
      `rpQualityDecisionMerge at "${node.id}": noveltyReport input must be a JSON object`,
    );
  }

  const gateResult = gateResultRaw as CriticGateResult;
  const noveltyReport = noveltyReportRaw as TextNoveltyReportV1;

  // Validate novelty report schema
  if (
    noveltyReport.schemaId !== undefined &&
    noveltyReport.schemaId !== "awp.text-novelty-report.v1"
  ) {
    throw new Error(
      `rpQualityDecisionMerge at "${node.id}": noveltyReport.schemaId must be "awp.text-novelty-report.v1", got "${noveltyReport.schemaId}"`,
    );
  }

  const nodeConfig = node.config as Partial<RpQualityDecisionMergeConfig> | undefined;

  const attempt = nodeConfig?.attempt;
  if (attempt !== 1 && attempt !== 2) {
    throw new Error(
      `rpQualityDecisionMerge at "${node.id}": config.attempt must be 1 or 2, got ${attempt}`,
    );
  }

  const noveltyRevisionInstruction =
    typeof nodeConfig?.noveltyRevisionInstruction === "string"
      ? nodeConfig.noveltyRevisionInstruction
      : DEFAULT_MERGE_CONFIG.noveltyRevisionInstruction;

  const maxRevisionInstructionLength =
    typeof nodeConfig?.maxRevisionInstructionLength === "number"
      ? nodeConfig.maxRevisionInstructionLength
      : DEFAULT_MERGE_CONFIG.maxRevisionInstructionLength;

  // Validate instruction length
  const instructionByteLength = new TextEncoder().encode(noveltyRevisionInstruction).length;
  if (instructionByteLength > maxRevisionInstructionLength) {
    throw new Error(
      `rpQualityDecisionMerge at "${node.id}": noveltyRevisionInstruction exceeds maxRevisionInstructionLength (${instructionByteLength} > ${maxRevisionInstructionLength})`,
    );
  }

  const config: RpQualityDecisionMergeConfig = {
    attempt,
    noveltyRevisionInstruction,
    maxRevisionInstructionLength,
  };

  const { decision, diagnostics } = mergeQualityDecision(gateResult, noveltyReport, config);

  return {
    outputs: { decision, diagnostics },
    metadata: {
      accepted: decision.accepted,
      decision: decision.decision,
      overriddenByNovelty: diagnostics.overriddenByNovelty,
    },
  };
};
