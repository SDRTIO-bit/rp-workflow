/**
 * RP Memory Commit Policy Node — P-8
 *
 * Deterministic policy engine that validates, filters, deduplicates,
 * and converts curator candidates into stable MemoryRecordV1 entries.
 * Does NOT call LLM.
 */
import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { MemoryRecordV1, MemoryWriteInputV1 } from "@awp/workflow-memory";

// ============ Types ============

export type RpMemoryCandidateV1 = {
  kind:
    | "event"
    | "relationship-change"
    | "state-change"
    | "commitment"
    | "discovery"
    | "unresolved-thread";
  summary: string;
  entityIds: string[];
  tags?: string[];
  importance: number;
  confidence: number;
  evidence?: string;
};

export type RpCommitPolicyConfig = {
  minImportance: number;
  minConfidence: number;
  maxCandidatesPerTurn: number;
  maxSummaryLength: number;
  namespace: string;
  sessionId?: string;
  writerNodeId?: string;
  turnId?: string;
};

const DEFAULT_CONFIG: RpCommitPolicyConfig = {
  minImportance: 0.5,
  minConfidence: 0.6,
  maxCandidatesPerTurn: 3,
  maxSummaryLength: 200,
  namespace: "rp-memory",
};

const VALID_KINDS = new Set([
  "event",
  "relationship-change",
  "state-change",
  "commitment",
  "discovery",
  "unresolved-thread",
]);

// ============ Validation ============

function validateCandidate(
  c: unknown,
  idx: number,
): { ok: true; candidate: RpMemoryCandidateV1 } | { ok: false; reason: string } {
  if (!c || typeof c !== "object" || Array.isArray(c)) {
    return { ok: false, reason: `[${idx}] not a valid object` };
  }
  const cand = c as Record<string, unknown>;

  if (typeof cand.kind !== "string" || !VALID_KINDS.has(cand.kind)) {
    return { ok: false, reason: `[${idx}] invalid or missing kind: "${String(cand.kind)}"` };
  }
  if (typeof cand.summary !== "string" || !cand.summary.trim()) {
    return { ok: false, reason: `[${idx}] missing or empty summary` };
  }
  if (!Array.isArray(cand.entityIds) || cand.entityIds.length === 0) {
    return { ok: false, reason: `[${idx}] entityIds must be non-empty array` };
  }
  if (
    typeof cand.importance !== "number" ||
    !Number.isFinite(cand.importance) ||
    cand.importance < 0 ||
    cand.importance > 1
  ) {
    return { ok: false, reason: `[${idx}] importance must be 0.0-1.0` };
  }
  if (
    typeof cand.confidence !== "number" ||
    !Number.isFinite(cand.confidence) ||
    cand.confidence < 0 ||
    cand.confidence > 1
  ) {
    return { ok: false, reason: `[${idx}] confidence must be 0.0-1.0` };
  }

  return {
    ok: true,
    candidate: {
      kind: cand.kind as RpMemoryCandidateV1["kind"],
      summary: cand.summary.trim(),
      entityIds: cand.entityIds as string[],
      tags: Array.isArray(cand.tags) ? cand.tags.map(String) : undefined,
      importance: cand.importance,
      confidence: cand.confidence,
      evidence: typeof cand.evidence === "string" ? cand.evidence.slice(0, 150) : undefined,
    },
  };
}

// ============ Fingerprint ============

export function makeStableId(
  sessionId: string,
  writerNodeId: string,
  turnId: string,
  idx: number,
): string {
  return `rp-mem:${sessionId}:${writerNodeId}:turn-${turnId}:cand-${idx}`;
}

export function makeOperationId(sessionId: string, writerNodeId: string, turnId: string): string {
  return `rp-memory-commit:${sessionId}:${writerNodeId}:${turnId}`;
}

// ============ Node Definition ============

export const rpMemoryCommitPolicyNode: NodeDefinition = {
  type: "rpMemoryCommitPolicy",
  label: "RP Memory Commit Policy",
  labelI18n: { zh: "RP 记忆提交策略", en: "RP Memory Commit Policy" },
  category: "knowledge",
  description:
    "Deterministic policy: validates curator candidates, filters by importance/confidence, deduplicates, and produces stable MemoryWriteInputV1.",
  descriptionI18n: {
    zh: "确定性策略节点：校验策展人候选、按重要性/置信度过滤、去重，生成稳定的 MemoryWriteInputV1。",
    en: "Deterministic policy: validates curator candidates, filters by importance/confidence, deduplicates, and produces stable MemoryWriteInputV1.",
  },
  color: "#0ea5e9",
  panelLayout: "generic",
  defaultConfig: {
    minImportance: 0.5,
    minConfidence: 0.6,
    maxCandidatesPerTurn: 3,
    maxSummaryLength: 200,
    namespace: "rp-memory",
  },
  configFields: [
    {
      key: "minImportance",
      label: { zh: "最低重要性", en: "Min Importance" },
      kind: "number",
      min: 0,
      max: 1,
    },
    {
      key: "minConfidence",
      label: { zh: "最低置信度", en: "Min Confidence" },
      kind: "number",
      min: 0,
      max: 1,
    },
    {
      key: "maxCandidatesPerTurn",
      label: { zh: "每轮最多候选", en: "Max Candidates/Turn" },
      kind: "number",
      min: 1,
      max: 10,
    },
    { key: "namespace", label: { zh: "命名空间", en: "Namespace" }, kind: "text" },
    {
      key: "maxSummaryLength",
      label: { zh: "摘要最大长度", en: "Max Summary Length" },
      kind: "number",
      min: 50,
      max: 500,
      advanced: true,
    },
  ],
  ports: [
    { id: "candidates", label: "Candidates", direction: "input", wireType: "json", required: true },
    {
      id: "sessionKey",
      label: "Session Key",
      direction: "input",
      wireType: "json",
      required: false,
    },
    { id: "accepted", label: "Accepted", direction: "output", wireType: "json" },
    { id: "rejected", label: "Rejected", direction: "output", wireType: "json" },
    { id: "memoryInput", label: "Memory Input", direction: "output", wireType: "json" },
  ],
};

// ============ Executor ============

export const rpMemoryCommitPolicyExecutor: NodeExecutor = async (input: NodeExecutionInput) => {
  const node = input.node;
  const config = { ...DEFAULT_CONFIG, ...(node.config as Partial<RpCommitPolicyConfig>) };
  const inputs = input.inputs as Record<string, unknown>;

  const raw = inputs.candidates;
  let candidates: unknown[];
  if (Array.isArray(raw)) {
    candidates = raw;
  } else if (typeof raw === "string") {
    try {
      candidates = JSON.parse(raw);
    } catch {
      throw new Error("rpMemoryCommitPolicy: candidates must be a valid JSON array");
    }
  } else {
    throw new Error("rpMemoryCommitPolicy: candidates input is required");
  }

  const sessionKey = inputs.sessionKey as Record<string, string> | undefined;
  const sessionId = config.sessionId ?? sessionKey?.conversationId ?? "unknown";
  const writerNodeId = config.writerNodeId ?? sessionKey?.agentNodeId ?? "writer";
  const turnId = config.turnId ?? String(Date.now());

  const accepted: RpMemoryCandidateV1[] = [];
  const rejected: Array<{ candidate: unknown; reason: string }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const result = validateCandidate(candidates[i], i);
    if (!result.ok) {
      rejected.push({ candidate: candidates[i], reason: result.reason });
      continue;
    }
    const c = result.candidate;

    // Threshold checks
    if (c.importance < config.minImportance) {
      rejected.push({
        candidate: c,
        reason: `importance ${c.importance} < min ${config.minImportance}`,
      });
      continue;
    }
    if (c.confidence < config.minConfidence) {
      rejected.push({
        candidate: c,
        reason: `confidence ${c.confidence} < min ${config.minConfidence}`,
      });
      continue;
    }
    if (c.summary.length > config.maxSummaryLength) {
      rejected.push({
        candidate: c,
        reason: `summary length ${c.summary.length} > max ${config.maxSummaryLength}`,
      });
      continue;
    }

    accepted.push(c);
  }

  // Limit
  const limited = accepted.slice(0, config.maxCandidatesPerTurn);

  // Build MemoryRecordV1 entries
  const now = new Date().toISOString();
  const operationId = makeOperationId(sessionId, writerNodeId, turnId);

  const records: MemoryRecordV1[] = limited.map((c, idx) => ({
    id: makeStableId(sessionId, writerNodeId, turnId, idx),
    namespace: config.namespace,
    content: c.summary,
    title: `${c.kind}: ${c.summary.slice(0, 60)}`,
    type: c.kind,
    tags: c.tags,
    entityIds: c.entityIds,
    importance: c.importance,
    createdAt: now,
    updatedAt: now,
    metadata: c.evidence ? { evidence: c.evidence } : undefined,
  }));

  const writeInput: MemoryWriteInputV1 = {
    namespace: config.namespace,
    records,
    operationId,
  };

  return {
    outputs: {
      accepted: limited,
      rejected,
      memoryInput: writeInput,
    },
    metadata: {
      operationId,
      acceptedCount: limited.length,
      rejectedCount: rejected.length,
      totalCandidates: candidates.length,
      sessionId,
      writerNodeId,
      turnId,
    },
  };
};
