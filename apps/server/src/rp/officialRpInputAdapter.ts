/**
 * P-12: Official RP Input Adapter
 *
 * Maps OfficialRpRequestV1 → workflow node configs + WorkflowRunContext.
 *
 * Responsibilities:
 *  1. Validate request
 *  2. Normalize userInput
 *  3. Generate/validate memory namespace
 *  4. Map sessionId, turnId, worldbook resourceRef
 *  5. Map preset, model, onExhausted
 *  6. Generate WorkflowRunContext
 *
 * DOES NOT:
 *  - Call LLM
 *  - Read Session/Memory/Worldbook stores
 *  - Compose Agent Prompt
 *  - Execute Critic or Curator
 */
import type { WorkflowDefinition, WorkflowRunContext } from "@awp/workflow-core";
import type { OfficialRpRequestV1 } from "./officialRpTypes.js";

// ── Validation ──

const VALID_ID_RE = /^[a-zA-Z0-9_\-.:]{1,128}$/;
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS_RE = /[\x00-\x1f\x7f]/;

function validateNonEmpty(field: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`"${field}" is required and must be a non-empty string`);
  }
}

function validateId(field: string, value: string): void {
  if (!VALID_ID_RE.test(value)) {
    throw new ValidationError(`"${field}" must match ${VALID_ID_RE.source}`);
  }
  if (FORBIDDEN_CHARS_RE.test(value)) {
    throw new ValidationError(`"${field}" contains forbidden control characters`);
  }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// ── Input Normalization ──

/** Map legacy "continue" variants to empty-ish input that still triggers the pipeline */
const CONTINUE_VARIANTS = new Set(["继续", "继续剧情", "continue", "go on", "...", "……"]);

function normalizeUserInput(raw: string): string {
  const trimmed = raw.trim();
  if (CONTINUE_VARIANTS.has(trimmed.toLowerCase())) {
    // "continue" → minimal input that still provides turn context
    return "(继续)";
  }
  if (trimmed.length === 0) {
    return "(继续)";
  }
  return trimmed;
}

// ── Main Adapter ──

export type AdaptedWorkflowInput = {
  workflow: WorkflowDefinition;
  context: WorkflowRunContext;
};

/**
 * Adapt an OfficialRpRequestV1 into a runnable workflow + context.
 * Modifies a COPY of the official workflow — never mutates the original file.
 */
export function adaptRpInput(
  request: OfficialRpRequestV1,
  workflow: WorkflowDefinition,
): AdaptedWorkflowInput {
  // 1. Validate
  validateNonEmpty("sessionId", request.sessionId);
  validateId("sessionId", request.sessionId);
  validateNonEmpty("turnId", request.turnId);
  validateId("turnId", request.turnId);
  validateNonEmpty("userInput", request.userInput);
  validateNonEmpty("worldbook.resourceRef", request.worldbook?.resourceRef);
  validateId("worldbook.resourceRef", request.worldbook.resourceRef);
  validateNonEmpty("memory.namespace", request.memory?.namespace);
  validateId("memory.namespace", request.memory.namespace);

  // 2. Validate allowed enum values
  if (request.workflowVersion && !["unified-v1", "legacy"].includes(request.workflowVersion)) {
    throw new ValidationError(`"workflowVersion" must be "unified-v1" or "legacy"`);
  }
  if (
    request.behavior?.onExhausted &&
    !["return-latest", "fail"].includes(request.behavior.onExhausted)
  ) {
    throw new ValidationError(`"behavior.onExhausted" must be "return-latest" or "fail"`);
  }

  // 3. Deep clone workflow to avoid mutating the original
  const wf = JSON.parse(JSON.stringify(workflow)) as WorkflowDefinition;

  // 4. Inject user input into playerInput node
  const playerInputNode = wf.nodes.find((n) => n.id === "input" && n.type === "playerInput");
  if (playerInputNode) {
    playerInputNode.config = {
      ...playerInputNode.config,
      text: normalizeUserInput(request.userInput),
    };
  }

  // 5. Inject turnId
  const turnIdNode = wf.nodes.find((n) => n.id === "turnId" && n.type === "jsonSource");
  if (turnIdNode) {
    turnIdNode.config = { ...turnIdNode.config, data: JSON.stringify(request.turnId) };
  }

  // 6. Inject sessionKey with proper sessionId and agentNodeId
  const sessionKeyNode = wf.nodes.find((n) => n.id === "sessionKey" && n.type === "jsonSource");
  if (sessionKeyNode) {
    sessionKeyNode.config = {
      ...sessionKeyNode.config,
      data: JSON.stringify({
        tenantId: "default",
        workflowInstanceId: "rp-prod-1",
        conversationId: request.sessionId,
        agentNodeId: "writer-main",
      }),
    };
  }

  // 7. Inject memory namespace
  const memCorpusNode = wf.nodes.find((n) => n.id === "memCorpus" && n.type === "memoryCorpus");
  if (memCorpusNode) {
    memCorpusNode.config = { ...memCorpusNode.config, namespace: request.memory.namespace };
  }

  const memPolicyNode = wf.nodes.find(
    (n) => n.id === "memPolicy" && n.type === "rpMemoryCommitPolicy",
  );
  if (memPolicyNode) {
    memPolicyNode.config = { ...memPolicyNode.config, namespace: request.memory.namespace };
  }

  const memWriteNode = wf.nodes.find((n) => n.id === "memWrite" && n.type === "memoryWrite");
  if (memWriteNode) {
    memWriteNode.config = { ...memWriteNode.config, namespace: request.memory.namespace };
  }

  // 8. Inject worldbook resourceRef
  const worldbookNode = wf.nodes.find((n) => n.id === "worldbook" && n.type === "dynamicWorldbook");
  if (worldbookNode) {
    worldbookNode.config = { ...worldbookNode.config, resourceRef: request.worldbook.resourceRef };
  }

  // 9. Inject onExhausted behavior
  if (request.behavior?.onExhausted) {
    const decisionNode = wf.nodes.find(
      (n) => n.id === "decision" && n.type === "rpSideEffectDecision",
    );
    if (decisionNode) {
      decisionNode.config = { ...decisionNode.config, onExhausted: request.behavior.onExhausted };
    }
  }

  // 10. Inject preset if provided
  if (request.preset?.text) {
    const presetNode = wf.nodes.find((n) => n.id === "preset" && n.type === "markdownSource");
    if (presetNode) {
      presetNode.config = { ...presetNode.config, content: request.preset.text };
    }
  }

  // 11. Normalize model overrides for official specialized agents.
  for (const node of wf.nodes) {
    if (node.type !== "specializedAgent") continue;
    const config = { ...(node.config ?? {}) };

    if (request.model?.providerId) {
      config.providerId = request.model.providerId;
    } else {
      delete config.providerId;
    }

    if (request.model?.model) {
      config.modelId = request.model.model;
    } else if (config.modelId === "mock-model") {
      delete config.modelId;
    }

    if (typeof request.model?.temperature === "number") {
      config.temperature = request.model.temperature;
    }

    node.config = config;
  }

  // 12. Build context
  const context: WorkflowRunContext = {
    sessionId: request.sessionId,
    // Inject per-run RP scope for worldbook
    values: {
      rp: {
        sessionId: request.sessionId,
        turnId: request.turnId,
      },
    },
  };

  return { workflow: wf, context };
}
