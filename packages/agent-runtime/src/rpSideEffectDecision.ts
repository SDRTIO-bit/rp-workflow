/**
 * RP Side-Effect Decision Node — P-11.1
 *
 * Deterministic projection node that derives side-effect permissions
 * (player output, session commit, memory commit) from an
 * RpRevisionLoopResultV1. Does NOT call LLM, access Store, or modify
 * the loop result.
 *
 * Also provides failWorkflow — a minimal deterministic node that
 * produces a workflow-level failure.
 */

import type { NodeDefinition, NodeExecutor } from "@awp/workflow-core";
import {
  computeSideEffectDecision,
  type RpRevisionLoopResultV1,
  type RpRevisionFinalizeConfig,
  DEFAULT_FINALIZE_CONFIG,
} from "./rpRevisionLoop.js";

// ============ rpSideEffectDecision ============

export const rpSideEffectDecisionNode: NodeDefinition = {
  type: "rpSideEffectDecision",
  label: "RP Side Effect Decision",
  labelI18n: { zh: "RP 副作用决策", en: "RP Side Effect Decision" },
  category: "core",
  description:
    "Deterministic projection: derives side-effect allow/deny flags from RpRevisionLoopResultV1. No LLM.",
  descriptionI18n: {
    zh: "确定性投影：从 RpRevisionLoopResultV1 推导副作用允许/禁止标志。不调用 LLM。",
    en: "Deterministic projection: derives side-effect allow/deny flags from RpRevisionLoopResultV1. No LLM.",
  },
  color: "#8b5cf6",
  panelLayout: "generic",
  defaultConfig: {
    onExhausted: DEFAULT_FINALIZE_CONFIG.onExhausted,
  },
  configFields: [
    {
      key: "onExhausted",
      label: { zh: "耗尽时行为", en: "On Exhausted" },
      kind: "select",
      options: [
        { label: { zh: "返回最新草稿", en: "Return Latest" }, value: "return-latest" },
        { label: { zh: "失败", en: "Fail" }, value: "fail" },
      ],
    },
  ],
  ports: [
    {
      id: "loopResult",
      label: "Loop Result",
      wireType: "json",
      direction: "input",
      required: true,
    },
    {
      id: "decision",
      label: "Decision",
      wireType: "json",
      direction: "output",
    },
  ],
};

export const rpSideEffectDecisionExecutor: NodeExecutor = async ({ node, inputs }) => {
  const loopResult = inputs.loopResult as RpRevisionLoopResultV1 | undefined;
  if (!loopResult || typeof loopResult !== "object") {
    throw new Error("rpSideEffectDecision: loopResult input is required");
  }

  const nodeConfig = node.config as Record<string, unknown> | undefined;
  const config: RpRevisionFinalizeConfig = {
    onExhausted:
      typeof nodeConfig?.onExhausted === "string" &&
      (nodeConfig.onExhausted === "fail" || nodeConfig.onExhausted === "return-latest")
        ? (nodeConfig.onExhausted as "fail" | "return-latest")
        : DEFAULT_FINALIZE_CONFIG.onExhausted,
  };

  const decision = computeSideEffectDecision(loopResult, config);

  return {
    outputs: { decision },
    metadata: {
      reason: decision.reason,
      accepted: decision.accepted,
      exhausted: decision.exhausted,
      onExhausted: config.onExhausted,
    },
  };
};

// ============ failWorkflow ============

export const failWorkflowNode: NodeDefinition = {
  type: "failWorkflow",
  label: "Fail Workflow",
  labelI18n: { zh: "工作流失败", en: "Fail Workflow" },
  category: "core",
  description:
    "Deterministic node that produces a workflow-level failure. Used for exhausted-fail paths. No LLM.",
  descriptionI18n: {
    zh: "确定性节点，产生工作流级失败。用于 exhausted-fail 路径。不调用 LLM。",
    en: "Deterministic node that produces a workflow-level failure. Used for exhausted-fail paths. No LLM.",
  },
  color: "#ef4444",
  panelLayout: "generic",
  defaultConfig: {
    message: "Workflow failed by failWorkflow node.",
  },
  configFields: [
    {
      key: "message",
      label: { zh: "失败消息", en: "Failure Message" },
      kind: "text",
    },
  ],
  ports: [
    {
      id: "trigger",
      label: "Trigger",
      wireType: "json",
      direction: "input",
      required: false,
    },
    {
      id: "error",
      label: "Error",
      wireType: "json",
      direction: "output",
    },
  ],
};

export const failWorkflowExecutor: NodeExecutor = async ({ node }) => {
  const nodeConfig = node.config as Record<string, unknown> | undefined;
  const message = String(nodeConfig?.message ?? "Workflow failed by failWorkflow node.");

  // Produce a deterministic, structured failure
  throw new Error(`[FAIL_WORKFLOW] ${message}`);
};
