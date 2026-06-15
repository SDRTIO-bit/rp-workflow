/**
 * Workflow Stdlib Executors — P-2
 *
 * Deterministic executors for composable context nodes.
 * No LLM calls. Pure functions.
 */

import type { NodeExecutor, ResourceResolver } from "@awp/workflow-core";
import { jsonMerge, type JsonMergeMode } from "./merge";
import { markdownMerge, textMerge } from "./merge";
import { renderJsonToMarkdown } from "./jsonToMarkdown";
import { markdownToText } from "./markdownToText";

// ============ Merge Executors ============

export const jsonMergeExecutor: NodeExecutor = async ({ node, inputs }) => {
  const mode = String(node.config.mode ?? "array-concat") as JsonMergeMode;
  if (!["array-concat", "object-shallow", "object-deep"].includes(mode)) {
    throw new Error(`jsonMerge at "${node.id}": invalid mode "${mode}"`);
  }

  const left = inputs.left;
  const right = inputs.right;

  const result = jsonMerge(node.id, left, right, mode);

  return {
    outputs: { result },
    metadata: { mode, leftType: typeof left, rightType: typeof right },
  };
};

export const markdownMergeExecutor: NodeExecutor = async ({ node, inputs }) => {
  const left = typeof inputs.left === "string" ? inputs.left : String(inputs.left ?? "");
  const right = typeof inputs.right === "string" ? inputs.right : String(inputs.right ?? "");

  const result = markdownMerge(left, right, {
    separator: String(node.config.separator ?? "\n\n"),
    leftTitle: node.config.leftTitle ? String(node.config.leftTitle) : undefined,
    rightTitle: node.config.rightTitle ? String(node.config.rightTitle) : undefined,
    skipEmpty: node.config.skipEmpty !== false,
  });

  return { outputs: { result } };
};

export const textMergeExecutor: NodeExecutor = async ({ node, inputs }) => {
  const left = typeof inputs.left === "string" ? inputs.left : String(inputs.left ?? "");
  const right = typeof inputs.right === "string" ? inputs.right : String(inputs.right ?? "");

  const result = textMerge(left, right, {
    separator: String(node.config.separator ?? "\n"),
    skipEmpty: node.config.skipEmpty !== false,
  });

  return { outputs: { result } };
};

// ============ Conversion Executors ============

export const jsonToMarkdownExecutor: NodeExecutor = async ({ inputs }) => {
  const data = inputs.input;
  const result = renderJsonToMarkdown(data);
  return { outputs: { output: result }, metadata: { inputType: typeof data } };
};

export const markdownToTextExecutor: NodeExecutor = async ({ inputs }) => {
  const input = typeof inputs.input === "string" ? inputs.input : String(inputs.input ?? "");
  const result = markdownToText(input);
  return { outputs: { output: result } };
};

// ============ Source Executors (Enhanced) ============

/**
 * Create an enhanced jsonSource executor that supports both inline and resourceRef sources.
 */
export function createJsonSourceExecutor(resolver?: ResourceResolver): NodeExecutor {
  return async ({ node }) => {
    const sourceMode = String(node.config.sourceMode ?? "inline");

    if (sourceMode === "inline") {
      const raw = String(node.config.data ?? "{}");
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
      return { outputs: { json: data }, metadata: { sourceMode: "inline" } };
    }

    if (sourceMode === "resource") {
      if (!resolver) {
        throw new Error(
          `jsonSource at "${node.id}": resource mode requires a ResourceResolver to be injected`,
        );
      }
      const resourceRef = String(node.config.resourceRef ?? "");
      if (!resourceRef) {
        throw new Error(`jsonSource at "${node.id}": resourceRef is required in resource mode`);
      }
      const data = await resolver(resourceRef);
      // Validate that resolved data is valid JSON
      try {
        JSON.stringify(data);
      } catch {
        throw new Error(
          `jsonSource at "${node.id}": resolved resource "${resourceRef}" is not valid JSON data`,
        );
      }
      return { outputs: { json: data }, metadata: { sourceMode: "resource", resourceRef } };
    }

    throw new Error(`jsonSource at "${node.id}": unknown sourceMode "${sourceMode}"`);
  };
}

/**
 * Create an enhanced markdownSource executor that supports both inline and resourceRef sources.
 */
export function createMarkdownSourceExecutor(resolver?: ResourceResolver): NodeExecutor {
  return async ({ node }) => {
    const sourceMode = String(node.config.sourceMode ?? "inline");

    if (sourceMode === "inline") {
      return {
        outputs: { markdown: String(node.config.content ?? "") },
        metadata: { sourceMode: "inline" },
      };
    }

    if (sourceMode === "resource") {
      if (!resolver) {
        throw new Error(
          `markdownSource at "${node.id}": resource mode requires a ResourceResolver to be injected`,
        );
      }
      const resourceRef = String(node.config.resourceRef ?? "");
      if (!resourceRef) {
        throw new Error(`markdownSource at "${node.id}": resourceRef is required in resource mode`);
      }
      const data = await resolver(resourceRef);
      if (typeof data !== "string") {
        throw new Error(
          `markdownSource at "${node.id}": resolved resource "${resourceRef}" is not a string (got ${typeof data})`,
        );
      }
      return { outputs: { markdown: data }, metadata: { sourceMode: "resource", resourceRef } };
    }

    throw new Error(`markdownSource at "${node.id}": unknown sourceMode "${sourceMode}"`);
  };
}

// ============ P-10: Conditional Routing Executors ============

export const conditionalRouteExecutor: NodeExecutor = async ({ node, inputs }) => {
  const conditionField = String(node.config.conditionField ?? "accepted");
  const condition = inputs.condition as Record<string, unknown> | undefined;

  if (!condition || typeof condition !== "object") {
    throw new Error(`conditionalRoute at "${node.id}": condition input must be a JSON object`);
  }

  const value = condition[conditionField];
  const activeBranch = value === true || value === "accept" ? "accept" : "revise";

  return {
    outputs: {
      activeBranch,
      acceptBranch: condition,
      reviseBranch: condition,
    },
    metadata: { activeBranch, conditionField },
  };
};

export const finalDraftSelectorExecutor: NodeExecutor = async ({ inputs }) => {
  const acceptDraft = typeof inputs.acceptDraft === "string" ? inputs.acceptDraft : undefined;
  const reviseDraft = typeof inputs.reviseDraft === "string" ? inputs.reviseDraft : undefined;

  // Select the non-empty draft. Revise draft takes priority if both present
  // (in practice only one will be non-empty due to branch skipping).
  const finalDraft = reviseDraft || acceptDraft || "";

  return {
    outputs: {
      finalDraft,
    },
    metadata: {
      source: reviseDraft ? "attempt-2" : "attempt-1",
      acceptDraftPresent: acceptDraft !== undefined && acceptDraft.length > 0,
      reviseDraftPresent: reviseDraft !== undefined && reviseDraft.length > 0,
    },
  };
};

// ============ P-11: Session Delta Builder ============

export const buildSessionDeltaExecutor: NodeExecutor = async ({ inputs }) => {
  const sessionKey = inputs.sessionKey as Record<string, unknown> | undefined;
  const playerInput = typeof inputs.playerInput === "string" ? inputs.playerInput : "";
  const finalDraft = typeof inputs.finalDraft === "string" ? inputs.finalDraft : "";
  const agentNodeId = (sessionKey?.agentNodeId as string) ?? "writer-main";
  const turnIndex = (sessionKey?.turnIndex as number) ?? 1;

  const sessionDelta = {
    sessionKey: {
      tenantId: (sessionKey?.tenantId as string) ?? "default",
      workflowInstanceId: (sessionKey?.workflowInstanceId as string) ?? "default",
      conversationId: (sessionKey?.conversationId as string) ?? "default",
      agentNodeId,
    },
    newTurn: {
      turnIndex,
      input: { text: playerInput },
      assistantOutput: finalDraft,
      modelConfig: { model: "workflow" },
      tokenUsage: { input: Math.ceil((playerInput.length + finalDraft.length) / 4), output: Math.ceil(finalDraft.length / 4) },
      createdAt: new Date().toISOString(),
    },
  };

  return { outputs: { sessionDelta } };
};

// ============ Executor Registry ============

/**
 * Create a record of all P-2 stdlib executors.
 */
export function createStdlibExecutors(resolver?: ResourceResolver): Record<string, NodeExecutor> {
  return {
    jsonMerge: jsonMergeExecutor,
    markdownMerge: markdownMergeExecutor,
    textMerge: textMergeExecutor,
    jsonToMarkdown: jsonToMarkdownExecutor,
    markdownToText: markdownToTextExecutor,
    jsonSource: createJsonSourceExecutor(resolver),
    markdownSource: createMarkdownSourceExecutor(resolver),
    conditionalRoute: conditionalRouteExecutor,
    finalDraftSelector: finalDraftSelectorExecutor,
    buildSessionDelta: buildSessionDeltaExecutor,
  };
}
