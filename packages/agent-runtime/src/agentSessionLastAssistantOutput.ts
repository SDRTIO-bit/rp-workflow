/**
 * Agent Session Last Assistant Output — P-15.2
 *
 * Extracts the most recent committed assistant output from a session context.
 * This is the "reference" text for novelty comparison.
 *
 * The extracted text is the previous committed assistant output,
 * not guaranteed to be accepted-only. sessionContext.turns is a
 * committed-body log.
 */

import type { NodeDefinition, NodeExecutor } from "@awp/workflow-core";

// ============ Schema ============

export const AGENT_SESSION_LAST_ASSISTANT_OUTPUT_SCHEMA_ID =
  "awp.agent-session-last-assistant-output.v1";

// ============ Node Definition ============

export const agentSessionLastAssistantOutputNode: NodeDefinition = {
  type: "agentSessionLastAssistantOutput",
  label: "Session Last Assistant Output",
  labelI18n: { zh: "会话最后助手输出", en: "Session Last Assistant Output" },
  category: "core",
  description:
    "Extracts the most recent committed assistant output from session context. Used as reference for novelty check.",
  descriptionI18n: {
    zh: "从会话上下文中提取最近已提交的助手输出。用作新颖度检查的参考。",
    en: "Extracts the most recent committed assistant output from session context. Used as reference for novelty check.",
  },
  color: "#0ea5e9",
  panelLayout: "generic",
  defaultConfig: {},
  configFields: [],
  ports: [
    {
      id: "sessionContext",
      label: "Session Context",
      wireType: "json",
      direction: "input",
      required: true,
      schemaId: "agent.session-context.v1",
    },
    {
      id: "text",
      label: "Text",
      wireType: "text",
      direction: "output",
    },
    {
      id: "meta",
      label: "Meta",
      wireType: "json",
      direction: "output",
    },
  ],
};

// ============ Pure Logic ============

/**
 * Extract the last assistant output from a session context.
 * Returns empty string for empty sessions (no turns).
 * Throws on malformed input.
 */
export function extractLastAssistantOutput(sessionContext: unknown): {
  text: string;
  meta: {
    turnCount: number;
    sourceTurnIndex: number | null;
    sourceTurnId: string | null;
  };
} {
  // Validate sessionContext shape
  if (!sessionContext || typeof sessionContext !== "object") {
    throw new Error("agentSessionLastAssistantOutput: sessionContext must be a non-null object");
  }

  const ctx = sessionContext as Record<string, unknown>;
  const turns = ctx.turns;

  // Validate turns is an array
  if (!Array.isArray(turns)) {
    throw new Error("agentSessionLastAssistantOutput: sessionContext.turns must be an array");
  }

  // Empty session: valid, return empty text
  if (turns.length === 0) {
    return {
      text: "",
      meta: {
        turnCount: 0,
        sourceTurnIndex: null,
        sourceTurnId: null,
      },
    };
  }

  // Get the last turn
  const lastTurn = turns[turns.length - 1] as unknown;

  // Validate last turn structure
  if (!lastTurn || typeof lastTurn !== "object") {
    throw new Error("agentSessionLastAssistantOutput: last turn must be a non-null object");
  }

  const turn = lastTurn as Record<string, unknown>;
  const assistantOutput = turn.assistantOutput;

  // Validate assistantOutput is a string (or coerce from unknown)
  let text: string;
  if (typeof assistantOutput === "string") {
    text = assistantOutput;
  } else if (assistantOutput === null || assistantOutput === undefined) {
    text = "";
  } else {
    // assistantOutput could be unknown type in the schema;
    // we treat non-string, non-null as an error
    throw new Error(
      `agentSessionLastAssistantOutput: last turn assistantOutput must be a string, got ${typeof assistantOutput}`,
    );
  }

  const turnIndex = typeof turn.turnIndex === "number" ? turn.turnIndex : null;

  return {
    text,
    meta: {
      turnCount: turns.length,
      sourceTurnIndex: turnIndex,
      sourceTurnId: null, // turnId is not part of AgentTurnV1 schema
    },
  };
}

// ============ Executor ============

export const agentSessionLastAssistantOutputExecutor: NodeExecutor = async ({ node, inputs }) => {
  const sessionContext = inputs.sessionContext;

  // sessionContext is required
  if (sessionContext === undefined || sessionContext === null) {
    throw new Error(
      `agentSessionLastAssistantOutput at "${node.id}": sessionContext input is required`,
    );
  }

  const result = extractLastAssistantOutput(sessionContext);

  return {
    outputs: {
      text: result.text,
      meta: result.meta,
    },
    metadata: result.meta,
  };
};
