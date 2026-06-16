/**
 * RP 面板显示辅助函数 — 从 App.tsx 提取以便独立测试。
 * 负责 Quality/Observability 的人类可读描述。
 */
import type { OfficialRpResponseV1 } from "./officialRpClient";

/** 将 quality 对象转为人类可读的状态描述 */
export const describeRpQuality = (quality: OfficialRpResponseV1["quality"]): string => {
  if (!quality) {
    return "Quality unavailable";
  }
  if (quality.exhausted) {
    return "Quality: revision limit reached";
  }
  if (quality.accepted && quality.revisionApplied) {
    return "Quality: accepted after revision";
  }
  if (quality.accepted) {
    return "Quality: accepted";
  }
  return "Quality: not accepted";
};

/** 将 observability 对象转为人类可读的用量摘要 */
export const formatRpUsage = (observability: OfficialRpResponseV1["observability"]): string => {
  if (!observability) {
    return "Usage unavailable";
  }
  const calls = `${observability.llmCalls} model calls`;
  const latency = `${(observability.totalLatencyMs / 1000).toFixed(1)}s`;
  const usage = observability.usage;

  // 如果 totalTokens 未定义、为 0、或存在不可用调用，均显示不完整
  if (
    usage.totalTokens === undefined ||
    usage.totalTokens <= 0 ||
    usage.unavailableInvocationCount > 0
  ) {
    return `${calls} · ${latency} · Token usage incomplete`;
  }
  return `${calls} · ${latency} · ${usage.totalTokens.toLocaleString()} tokens`;
};
